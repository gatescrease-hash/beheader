//! The text primitive: the parser that turns content into a block tree, the
//! dependency walker over that tree, and the three compute functions behind
//! `resolvedContent`, `measuredHeight` and `measuredWidth`.
//!
//! Text is literal until a block opens. `{= expression }` inserts a value, and
//! `{? condition }` ... `{:}` ... `{?}` is a conditional. Blocks nest.
//!
//! The dependency walker was the first dynamic resolver in the codebase. It
//! re-parses content on every edge derivation rather than caching, because
//! editing a single character can change which slots the text reads. Like the
//! formula dependency walker it reports both arms of a conditional, so flipping
//! the condition does not leave the object subscribed to the wrong one.
//!
//! A text box never crops its contents. When a word is too long for the width,
//! the measurer breaks the word. There is no overflow slot and no plan for one:
//! a person settled that question against eight earlier rulings, and correcting
//! the code back toward any of them would undo the decision rather than fix a
//! bug.
//!
//! The scanner walks the units a JavaScript string counts rather than the
//! characters Rust counts, because the offset an error block carries is one of
//! those units and a document holding a character outside the basic plane would
//! otherwise report a different one. Every slice it takes starts and ends at 0,
//! at the length, or at an ASCII brace, and no surrogate equals an ASCII unit,
//! so a slice never cuts a character in half.
//!
//! The port of `src/engine/primitives/text.ts`.

use crate::address::{Address, AddressableObject};
use crate::formula::ast::FormulaAst;
use crate::formula::deps::{Dependency, extract_dependencies};
use crate::formula::eval::{ReadRange, ReadSlot, evaluate as evaluate_formula_ast};
use crate::formula::parser::parse_formula;
use crate::measure::{Measurement, TextStyle};
use crate::model::{
    ErrorCode, ErrorValue, GraphObject, Slot, Value, has_illegal_number, resolve_slot,
};
use crate::number::to_javascript_text;
use crate::primitives::schema::SlotComputeInputs;
use crate::primitives::table::{enumerate_range_cell_addresses, is_in_extent_table_cell_address};

/// A run of mathematical notation inside text. The block holds the LaTeX and
/// the marker it was written with, and it evaluates to nothing: notation is
/// drawn rather than computed, so the run reaches the layout as the text it was
/// typed as and the two readers of that layout draw it.
#[derive(Clone, Debug, PartialEq)]
pub struct MathRun {
    pub latex: String,
    /// True for a run that takes a line of its own, false for one that sits
    /// inside a line of prose.
    pub display: bool,
    /// The marker as it was written, which is what the resolved content
    /// carries.
    pub source: String,
}

/// A block of a text object's content.
#[derive(Clone, Debug, PartialEq)]
pub enum Block {
    Text(String),
    Formula(FormulaAst),
    Conditional {
        condition: FormulaAst,
        true_branch: Vec<Block>,
        false_branch: Vec<Block>,
    },
    Math(MathRun),
    /// A block that did not parse. It carries what an operator typed, where it
    /// started, and the blocks that were inside it, so the dependency walker
    /// still reports what a broken conditional reads.
    Error {
        message: String,
        source: String,
        start: usize,
        orphaned: Vec<Block>,
    },
}

pub const MAX_BLOCK_TREE_DEPTH: usize = 64;

/// The two markers that open notation: one for a line of its own, one inline.
pub const MATH_DISPLAY_OPEN: &str = "{$$";
pub const MATH_INLINE_OPEN: &str = "{$";

/// Where a run of notation ends, and what it holds.
#[derive(Clone, Debug, PartialEq)]
pub struct MathMarker {
    pub latex: String,
    pub display: bool,
    /// The index just past the closing brace.
    pub end: usize,
}

/// The whitespace JavaScript trims, which is not the set Rust trims.
///
/// `String.prototype.trim` takes the ECMAScript WhiteSpace and LineTerminator
/// sets, which hold the byte order mark and leave the next line character
/// alone. The Rust `char::is_whitespace` property is the other way round on
/// both. A run of notation written after a byte order mark would otherwise keep
/// it here and lose it in the other engine.
fn is_javascript_space(unit: u16) -> bool {
    match unit {
        0x0009 | 0x000A | 0x000B | 0x000C | 0x000D | 0x0020 | 0x00A0 | 0x2028 | 0x2029 | 0xFEFF => {
            true
        }
        // Every other space separator, which a surrogate half never is.
        _ => char::from_u32(u32::from(unit))
            .is_some_and(|character| character.is_whitespace() && character != '\u{0085}'),
    }
}

fn js_trim(units: &[u16]) -> &[u16] {
    let mut start = 0;
    let mut end = units.len();
    while start < end && is_javascript_space(units[start]) {
        start += 1;
    }
    while end > start && is_javascript_space(units[end - 1]) {
        end -= 1;
    }
    &units[start..end]
}

/// A run of units as text. Every boundary the scanner takes falls at 0, at the
/// length, or at an ASCII brace, and no surrogate half equals an ASCII unit, so
/// this never cuts a character in half.
fn text_of(units: &[u16]) -> String {
    String::from_utf16_lossy(units)
}

fn units_of(text: &str) -> Vec<u16> {
    text.encode_utf16().collect()
}

fn starts_with(units: &[u16], marker: &str, at: usize) -> bool {
    let wanted = units_of(marker);
    units.len() >= at + wanted.len() && units[at..at + wanted.len()] == wanted[..]
}

/// The first closing brace that is not inside a quoted string, from `at`.
///
/// A formula may hold a text literal, and a brace inside one closes nothing. A
/// backslash before a quote inside a string escapes it.
fn find_unquoted_brace(units: &[u16], at: usize) -> Option<usize> {
    const QUOTE: u16 = b'"' as u16;
    const BACKSLASH: u16 = b'\\' as u16;
    const CLOSE: u16 = b'}' as u16;
    let mut index = at;
    let mut in_string = false;
    while index < units.len() {
        let unit = units[index];
        if in_string {
            if unit == BACKSLASH && units.get(index + 1) == Some(&QUOTE) {
                index += 2;
                continue;
            }
            if unit == QUOTE {
                in_string = false;
            }
            index += 1;
            continue;
        }
        if unit == QUOTE {
            in_string = true;
            index += 1;
            continue;
        }
        if unit == CLOSE {
            return Some(index);
        }
        index += 1;
    }
    None
}

/// Reads a run of notation that starts at `at`, or reports none.
///
/// The braces are counted rather than scanned for the first closing one,
/// because notation is full of them: the denominator of a fraction sits inside
/// a pair of its own, and stopping at the first would cut the run in half.
///
/// This is the one reader of the syntax. The block tree calls it to keep
/// notation out of the reach of a formula marker, and the markdown layer calls
/// it again on the resolved text, and two scanners of one syntax would drift.
pub fn match_math_marker_at(content: &str, at: usize) -> Option<MathMarker> {
    match_math_marker_in(&units_of(content), at)
}

fn match_math_marker_in(units: &[u16], at: usize) -> Option<MathMarker> {
    const OPEN: u16 = b'{' as u16;
    const CLOSE: u16 = b'}' as u16;
    let display = starts_with(units, MATH_DISPLAY_OPEN, at);
    let inline = !display && starts_with(units, MATH_INLINE_OPEN, at);
    if !display && !inline {
        return None;
    }
    let from = at
        + if display {
            MATH_DISPLAY_OPEN.len()
        } else {
            MATH_INLINE_OPEN.len()
        };
    let mut depth = 1;
    let mut index = from;
    while index < units.len() {
        match units[index] {
            OPEN => depth += 1,
            CLOSE => {
                depth -= 1;
                if depth == 0 {
                    return Some(MathMarker {
                        latex: text_of(js_trim(&units[from..index])),
                        display,
                        end: index + 1,
                    });
                }
            }
            _ => {}
        }
        index += 1;
    }
    None
}

/// What a `{` opens, when it opens anything.
#[derive(Clone, Debug)]
enum Marker {
    FormulaOpen { source: String, end: usize },
    ConditionalOpen { source: String, end: usize },
    ConditionalElse { end: usize },
    ConditionalClose { end: usize },
    Math { math: MathMarker, end: usize },
}

impl Marker {
    fn end(&self) -> usize {
        match self {
            Marker::FormulaOpen { end, .. }
            | Marker::ConditionalOpen { end, .. }
            | Marker::ConditionalElse { end }
            | Marker::ConditionalClose { end }
            | Marker::Math { end, .. } => *end,
        }
    }
}

fn match_marker_at(units: &[u16], at: usize) -> Option<Marker> {
    const DOLLAR: u16 = b'$' as u16;
    const EQUALS: u16 = b'=' as u16;
    const QUESTION: u16 = b'?' as u16;
    const COLON: u16 = b':' as u16;
    const CLOSE: u16 = b'}' as u16;
    let second = units.get(at + 1).copied();
    if second == Some(DOLLAR) {
        let math = match_math_marker_in(units, at)?;
        let end = math.end;
        return Some(Marker::Math { math, end });
    }
    if second == Some(EQUALS) {
        let close = find_unquoted_brace(units, at + 2)?;
        return Some(Marker::FormulaOpen {
            source: text_of(&units[at + 2..close]),
            end: close + 1,
        });
    }
    if second == Some(QUESTION) {
        if units.get(at + 2) == Some(&CLOSE) {
            return Some(Marker::ConditionalClose { end: at + 3 });
        }
        let close = find_unquoted_brace(units, at + 2)?;
        return Some(Marker::ConditionalOpen {
            source: text_of(&units[at + 2..close]),
            end: close + 1,
        });
    }
    if second == Some(COLON) && units.get(at + 2) == Some(&CLOSE) {
        return Some(Marker::ConditionalElse { end: at + 3 });
    }
    None
}

/// Where a run of blocks stopped.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum SequenceTerminator {
    Else,
    Close,
    Eof,
}

struct TextParseState<'a, T> {
    units: &'a [u16],
    objects: &'a [T],
    at: usize,
    depth: usize,
}

fn parse_block_sequence<T: AddressableObject>(
    state: &mut TextParseState<'_, T>,
) -> (Vec<Block>, SequenceTerminator) {
    const OPEN: u16 = b'{' as u16;
    let mut blocks = Vec::new();
    let mut text_start = state.at;

    while state.at < state.units.len() {
        if state.units[state.at] != OPEN {
            state.at += 1;
            continue;
        }
        let Some(marker) = match_marker_at(state.units, state.at) else {
            state.at += 1;
            continue;
        };
        if state.at > text_start {
            blocks.push(Block::Text(text_of(&state.units[text_start..state.at])));
        }
        match marker {
            Marker::ConditionalElse { end } => {
                state.at = end;
                return (blocks, SequenceTerminator::Else);
            }
            Marker::ConditionalClose { end } => {
                state.at = end;
                return (blocks, SequenceTerminator::Close);
            }
            Marker::Math { math, end } => {
                blocks.push(Block::Math(MathRun {
                    latex: math.latex,
                    display: math.display,
                    source: text_of(&state.units[state.at..end]),
                }));
                state.at = end;
                text_start = state.at;
            }
            Marker::FormulaOpen { ref source, end } => {
                let span_start = state.at;
                state.at = end;
                // A text block names no enclosing table, so a bare cell
                // reference inside one reads as a name rather than as a cell.
                blocks.push(match parse_formula(source, state.objects, None) {
                    Err(failure) => Block::Error {
                        message: failure.message,
                        source: text_of(&state.units[span_start..end]),
                        start: span_start,
                        orphaned: Vec::new(),
                    },
                    Ok(ast) => Block::Formula(ast),
                });
                text_start = state.at;
            }
            Marker::ConditionalOpen { ref source, .. } => {
                let span_start = state.at;
                state.at = marker.end();
                let source = source.clone();
                blocks.extend(parse_conditional(state, &source, span_start));
                text_start = state.at;
            }
        }
    }
    if state.at > text_start {
        blocks.push(Block::Text(text_of(&state.units[text_start..state.at])));
    }
    (blocks, SequenceTerminator::Eof)
}

fn parse_conditional<T: AddressableObject>(
    state: &mut TextParseState<'_, T>,
    condition_source: &str,
    span_start: usize,
) -> Vec<Block> {
    if state.depth >= MAX_BLOCK_TREE_DEPTH {
        return vec![Block::Error {
            message: format!("text conditional nests too deeply (limit {MAX_BLOCK_TREE_DEPTH})"),
            source: text_of(&state.units[span_start..state.at]),
            start: span_start,
            orphaned: Vec::new(),
        }];
    }
    state.depth += 1;
    let (true_branch, terminator) = parse_block_sequence(state);
    let mut false_branch = Vec::new();
    let mut unclosed = terminator == SequenceTerminator::Eof;
    if terminator == SequenceTerminator::Else {
        let (blocks, closing) = parse_block_sequence(state);
        false_branch = blocks;
        unclosed = closing == SequenceTerminator::Eof;
    }
    state.depth -= 1;
    let span = text_of(&state.units[span_start..state.at]);
    finish_conditional(
        condition_source,
        span,
        span_start,
        state.objects,
        true_branch,
        false_branch,
        unclosed,
    )
}

#[allow(clippy::too_many_arguments)]
fn finish_conditional<T: AddressableObject>(
    condition_source: &str,
    span: String,
    span_start: usize,
    objects: &[T],
    true_branch: Vec<Block>,
    false_branch: Vec<Block>,
    unclosed: bool,
) -> Vec<Block> {
    let mut orphaned = true_branch.clone();
    orphaned.extend(false_branch.clone());
    let condition = match parse_formula(condition_source, objects, None) {
        Err(failure) => {
            return vec![Block::Error {
                message: failure.message,
                source: span,
                start: span_start,
                orphaned,
            }];
        }
        Ok(ast) => ast,
    };
    if unclosed {
        return vec![Block::Error {
            message: "unclosed {? ... } conditional (no matching {?})".to_string(),
            source: span,
            start: span_start,
            orphaned,
        }];
    }
    vec![Block::Conditional {
        condition,
        true_branch,
        false_branch,
    }]
}

/// Parses content into the block tree. It never fails. A bad block becomes an
/// error block.
pub fn parse_text_content<T: AddressableObject>(content: &str, objects: &[T]) -> Vec<Block> {
    let units = units_of(content);
    let mut state = TextParseState {
        units: &units,
        objects,
        at: 0,
        depth: 0,
    };
    let mut blocks = Vec::new();
    loop {
        let (sequence, terminator) = parse_block_sequence(&mut state);
        blocks.extend(sequence);
        if terminator == SequenceTerminator::Eof {
            return blocks;
        }
        // A closing marker with nothing open is prose rather than a fault, so
        // it reaches the resolved content as the characters an operator typed.
        blocks.push(Block::Text(
            if terminator == SequenceTerminator::Else {
                "{:}"
            } else {
                "{?}"
            }
            .to_string(),
        ));
    }
}

/// Every address the block tree names, from both branches of every conditional.
pub fn extract_text_dependencies(blocks: &[Block]) -> Vec<Dependency> {
    let mut dependencies = Vec::new();
    for block in blocks {
        match block {
            Block::Text(_) | Block::Math(_) => {}
            Block::Error { orphaned, .. } => {
                dependencies.extend(extract_text_dependencies(orphaned));
            }
            Block::Formula(ast) => dependencies.extend(extract_dependencies(ast)),
            Block::Conditional {
                condition,
                true_branch,
                false_branch,
            } => {
                dependencies.extend(extract_dependencies(condition));
                dependencies.extend(extract_text_dependencies(true_branch));
                dependencies.extend(extract_text_dependencies(false_branch));
            }
        }
    }
    dependencies
}

/// The mark a span that did not resolve carries into the drawn text.
const BROKEN_SPAN_MARK: &str = "!";

fn render_runtime_error(value: &ErrorValue) -> String {
    format!("{BROKEN_SPAN_MARK}{}", value.error.as_str())
}

/// A value as it reaches the drawn text, or the reason it cannot. A point has
/// no spelling that a line of prose could carry back, so it refuses rather than
/// drawing something an operator could not have typed.
fn format_value_for_embedding(value: &Value) -> Result<String, ErrorValue> {
    match value {
        Value::Error(failure) => Err(failure.clone()),
        Value::Null => Ok(String::new()),
        Value::Number(number) => Ok(to_javascript_text(*number)),
        Value::Text(text) => Ok(text.clone()),
        Value::Boolean(boolean) => Ok(if *boolean { "TRUE" } else { "FALSE" }.to_string()),
        Value::Point(_) | Value::Points(_) => Err(ErrorValue {
            error: ErrorCode::Type,
            message: format!(
                "cannot embed {} in text; read a scalar component instead",
                if matches!(value, Value::Points(_)) {
                    "a point array"
                } else {
                    "a point"
                }
            ),
        }),
    }
}

fn describe_condition_type(value: &Value) -> &'static str {
    match value {
        Value::Null => "null",
        Value::Points(_) => "a point array",
        Value::Point(_) => "a point",
        Value::Number(_) => "number",
        Value::Text(_) => "string",
        Value::Boolean(_) => "boolean",
        Value::Error(_) => "object",
    }
}

fn evaluate_blocks(blocks: &[Block], read: ReadSlot, read_range: Option<ReadRange>) -> String {
    let mut result = String::new();
    for block in blocks {
        match block {
            Block::Text(value) => result.push_str(value),
            Block::Math(run) => result.push_str(&run.source),
            Block::Error { source, .. } => {
                result.push_str(BROKEN_SPAN_MARK);
                result.push_str(source);
            }
            Block::Formula(ast) => {
                let value = evaluate_formula_ast(ast, read, read_range);
                match format_value_for_embedding(&value) {
                    Err(failure) => result.push_str(&render_runtime_error(&failure)),
                    Ok(text) => result.push_str(&text),
                }
            }
            Block::Conditional {
                condition,
                true_branch,
                false_branch,
            } => {
                let value = evaluate_formula_ast(condition, read, read_range);
                match value {
                    Value::Error(failure) => {
                        result.push_str(&render_runtime_error(&failure));
                    }
                    Value::Boolean(taken) => {
                        let branch = if taken { true_branch } else { false_branch };
                        result.push_str(&evaluate_blocks(branch, read, read_range));
                    }
                    other => {
                        result.push_str(&render_runtime_error(&ErrorValue {
                            error: ErrorCode::Type,
                            message: format!(
                                "text conditional's condition must evaluate to a boolean, got {}",
                                describe_condition_type(&other)
                            ),
                        }));
                    }
                }
            }
        }
    }
    result
}

/// Evaluates the tree to a string. A conditional takes one branch only.
pub fn evaluate_block_tree(
    blocks: &[Block],
    read: ReadSlot,
    read_range: Option<ReadRange>,
) -> String {
    evaluate_blocks(blocks, read, read_range)
}

fn path(segments: &[&str]) -> Vec<String> {
    segments.iter().map(|part| (*part).to_string()).collect()
}

pub fn text_content_path() -> Vec<String> {
    path(&["content"])
}

pub fn text_width_path() -> Vec<String> {
    path(&["width"])
}

pub fn text_height_path() -> Vec<String> {
    path(&["height"])
}

pub fn text_autoresize_path() -> Vec<String> {
    path(&["autoresize"])
}

pub fn text_style_font_path() -> Vec<String> {
    path(&["style", "font"])
}

pub fn text_style_font_size_path() -> Vec<String> {
    path(&["style", "fontSize"])
}

pub fn text_style_line_height_path() -> Vec<String> {
    path(&["style", "lineHeight"])
}

pub fn text_style_color_path() -> Vec<String> {
    path(&["style", "color"])
}

pub fn text_style_align_path() -> Vec<String> {
    path(&["style", "align"])
}

pub fn text_resolved_content_path() -> Vec<String> {
    path(&["resolvedContent"])
}

pub fn text_measured_height_path() -> Vec<String> {
    path(&["measuredHeight"])
}

pub fn text_measured_width_path() -> Vec<String> {
    path(&["measuredWidth"])
}

/// Every address a text object reads, from the content it holds right now.
///
/// The content slot itself comes first, so a change to the text re-derives the
/// rest. A cell inside the extent of a real table that holds nothing is left
/// out, because an empty cell is ordinary state rather than a dangling
/// reference, and a range reports only the cells that hold something.
pub fn resolve_text_dependency_addresses<A>(
    object: &GraphObject<A>,
    objects: &[GraphObject<A>],
) -> Vec<Address> {
    let mut addresses = vec![Address {
        object_id: object.id.clone(),
        path: text_content_path(),
    }];
    let Some(Slot::Literal {
        value: Value::Text(content),
    }) = object.get_slot(&text_content_path())
    else {
        return addresses;
    };
    let blocks = parse_text_content(content, objects);
    for dependency in extract_text_dependencies(&blocks) {
        match dependency {
            Dependency::Reference(address) => {
                if resolve_slot(&address, objects).is_none()
                    && is_in_extent_table_cell_address(&address, objects)
                {
                    continue;
                }
                addresses.push(address);
            }
            Dependency::Range { start, end } => {
                let Some(table) = objects
                    .iter()
                    .find(|candidate| candidate.id == start.object_id)
                else {
                    addresses.push(start);
                    continue;
                };
                let Ok(cells) = enumerate_range_cell_addresses(&start, &end, table) else {
                    addresses.push(start);
                    continue;
                };
                for cell in cells {
                    if table.get_slot(&cell.path).is_some() {
                        addresses.push(cell);
                    }
                }
            }
        }
    }
    addresses
}

/// The content with every block resolved, which is what the layout reads.
pub fn compute_resolved_content<A>(
    object: &GraphObject<A>,
    inputs: &SlotComputeInputs<A>,
) -> Value {
    let raw = inputs.at(object, &text_content_path());
    if let Some(Value::Error(failure)) = raw {
        return Value::Error(failure);
    }
    let content = match raw {
        Some(Value::Text(text)) => text,
        _ => String::new(),
    };
    let blocks = parse_text_content(&content, inputs.objects);
    Value::Text(evaluate_block_tree(&blocks, inputs.read, inputs.read_range))
}

/// The box the laid out text takes, or the reason it cannot be measured.
fn measure_text_box<A>(
    object: &GraphObject<A>,
    inputs: &SlotComputeInputs<A>,
    slot_label: &str,
) -> Result<Measurement, ErrorValue> {
    let resolved = inputs.at(object, &text_resolved_content_path());
    let width = inputs.at(object, &text_width_path());
    let font = inputs.at(object, &text_style_font_path());
    let font_size = inputs.at(object, &text_style_font_size_path());
    let line_height = inputs.at(object, &text_style_line_height_path());

    // An error upstream is reported as it stands rather than as a measurement
    // failure, so an operator reads the fault they can fix.
    for upstream in [&resolved, &width, &font, &font_size, &line_height] {
        if let Some(Value::Error(failure)) = upstream {
            return Err(failure.clone());
        }
    }

    let Some(measurer) = inputs.real_measurer() else {
        return Err(ErrorValue {
            error: ErrorCode::Measure,
            message: format!(
                "{slot_label}: {} has no real text measurer wired (only the null EvalContext) — cannot measure",
                object.name
            ),
        });
    };

    let (Some(Value::Text(font)), Some(Value::Number(font_size)), Some(Value::Number(line_height))) =
        (&font, &font_size, &line_height)
    else {
        return Err(ErrorValue {
            error: ErrorCode::Type,
            message: format!(
                "{slot_label}: {} needs style.font (string) and style.fontSize / style.lineHeight (numbers)",
                object.name
            ),
        });
    };
    let style = TextStyle {
        font: font.clone(),
        font_size: *font_size,
        line_height: *line_height,
    };
    let text = match &resolved {
        Some(Value::Text(text)) => text.as_str(),
        _ => "",
    };
    let max_width = match width {
        Some(Value::Number(held)) => Some(held),
        _ => None,
    };

    // A measurer that fails is a fault in the host rather than in the document,
    // and an error value leaves the rest of the graph evaluating. A variable
    // copy answers the same way, under `D-013`.
    let Ok(measured) = measurer.measure(text, &style, max_width) else {
        return Err(ErrorValue {
            error: ErrorCode::Measure,
            message: format!("{slot_label}: {} could not be measured", object.name),
        });
    };
    if has_illegal_number(&Value::Number(measured.width))
        || has_illegal_number(&Value::Number(measured.height))
    {
        return Err(ErrorValue {
            error: ErrorCode::Type,
            message: format!(
                "{slot_label}: {}'s text measurer returned a non-finite box (width {}, height {})",
                object.name,
                to_javascript_text(measured.width),
                to_javascript_text(measured.height)
            ),
        });
    }
    Ok(measured)
}

/// Height of the laid out text. It needs the measurer from the evaluation pass.
pub fn compute_measured_height<A>(object: &GraphObject<A>, inputs: &SlotComputeInputs<A>) -> Value {
    match measure_text_box(object, inputs, "measuredHeight") {
        Ok(measured) => Value::Number(measured.height),
        Err(failure) => Value::Error(failure),
    }
}

/// Width of the laid out text. It needs the measurer from the evaluation pass.
pub fn compute_measured_width<A>(object: &GraphObject<A>, inputs: &SlotComputeInputs<A>) -> Value {
    match measure_text_box(object, inputs, "measuredWidth") {
        Ok(measured) => Value::Number(measured.width),
        Err(failure) => Value::Error(failure),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{ObjectType, SlotMap};

    fn object(id: &str, name: &str, value: Value) -> GraphObject<FormulaAst> {
        let mut slots = SlotMap::new();
        slots.insert("value", Slot::Literal { value });
        GraphObject {
            id: id.to_string(),
            name: name.to_string(),
            object_type: ObjectType::Value,
            target: None,
            slots,
            ports: None,
            vertex_count: None,
        }
    }

    fn document() -> Vec<GraphObject<FormulaAst>> {
        vec![
            object("v1", "total", Value::Number(7.0)),
            object("f1", "flag", Value::Boolean(true)),
        ]
    }

    fn resolved(content: &str) -> String {
        let objects = document();
        let blocks = parse_text_content(content, &objects);
        let read = |address: &Address| {
            objects
                .iter()
                .find(|candidate| candidate.id == address.object_id)
                .and_then(|object| object.get_slot(&address.path))
                .map(|slot| slot.value().clone())
        };
        evaluate_block_tree(&blocks, &read, None)
    }

    /// Text is literal until a block opens, and a brace that opens nothing is
    /// prose.
    #[test]
    fn text_is_literal_until_a_block_opens() {
        assert_eq!(resolved("plain text"), "plain text");
        assert_eq!(
            resolved("a brace { that opens nothing"),
            "a brace { that opens nothing"
        );
        assert_eq!(resolved("{= total.value }"), "7");
        assert_eq!(resolved("before {= total.value } after"), "before 7 after");
    }

    /// A conditional draws one branch, and a condition that is not a boolean
    /// marks the span rather than choosing one.
    #[test]
    fn a_conditional_draws_one_branch() {
        assert_eq!(resolved("{? flag.value }yes{:}no{?}"), "yes");
        assert_eq!(resolved("{? total.value }yes{:}no{?}"), "!#TYPE");
    }

    /// Both arms of a conditional are reported, so flipping the condition does
    /// not leave the object subscribed to the arm it no longer draws.
    #[test]
    fn both_arms_of_a_conditional_are_subscribed_to() {
        let objects = document();
        let blocks = parse_text_content(
            "{? flag.value }{= total.value }{:}{= flag.value }{?}",
            &objects,
        );
        let named: Vec<String> = extract_text_dependencies(&blocks)
            .iter()
            .map(|dependency| match dependency {
                Dependency::Reference(address) => address.object_id.clone(),
                Dependency::Range { start, .. } => start.object_id.clone(),
            })
            .collect();
        assert_eq!(named, vec!["f1", "v1", "f1"]);
    }

    /// A conditional that never closes becomes an error block, and the blocks
    /// inside it are kept so the walker still reports what they read.
    #[test]
    fn an_unclosed_conditional_keeps_what_it_held() {
        let objects = document();
        let blocks = parse_text_content("{? flag.value }{= total.value }", &objects);
        let Some(Block::Error {
            message, orphaned, ..
        }) = blocks.first()
        else {
            panic!("an unclosed conditional is an error block");
        };
        assert_eq!(message, "unclosed {? ... } conditional (no matching {?})");
        assert_eq!(orphaned.len(), 1);
        assert_eq!(extract_text_dependencies(&blocks).len(), 1);
    }

    /// The braces of a run of notation are counted rather than scanned for the
    /// first closing one, because the denominator of a fraction sits inside a
    /// pair of its own.
    #[test]
    fn notation_counts_its_braces() {
        let found = match_math_marker_at("{$ \\frac{a}{b} }", 0).expect("a run of notation");
        assert_eq!(found.latex, "\\frac{a}{b}");
        assert!(!found.display);
        assert_eq!(found.end, 16);
        let block = match_math_marker_at("{$$ y }", 0).expect("a run of its own");
        assert!(block.display);
        assert_eq!(match_math_marker_at("{$ unclosed {", 0), None);
        assert_eq!(match_math_marker_at("not math", 0), None);
    }

    /// A run of notation is trimmed with the whitespace JavaScript trims, which
    /// holds the byte order mark and leaves the next line character alone. The
    /// Rust set is the other way round on both.
    #[test]
    fn notation_is_trimmed_the_way_javascript_trims() {
        let marked = format!("{{${}marked{}}}", '\u{feff}', '\u{feff}');
        assert_eq!(
            match_math_marker_at(&marked, 0).expect("a run").latex,
            "marked"
        );
        let next_line = format!("{{${}kept{}}}", '\u{85}', '\u{85}');
        assert_eq!(
            match_math_marker_at(&next_line, 0).expect("a run").latex,
            "\u{85}kept\u{85}"
        );
    }

    /// Notation reaches the resolved content as the text it was typed as,
    /// because notation is drawn rather than computed.
    #[test]
    fn notation_reaches_the_drawn_text_unchanged() {
        assert_eq!(resolved("prose {$ x } end"), "prose {$ x } end");
    }

    /// A brace inside a quoted string closes no block, so a formula holding one
    /// parses rather than being cut in half.
    #[test]
    fn a_brace_inside_a_string_closes_nothing() {
        let objects = document();
        let blocks = parse_text_content("{= \"a } brace\" }", &objects);
        assert_eq!(blocks.len(), 1);
        assert!(matches!(blocks[0], Block::Formula(_)));
        assert_eq!(resolved("{= \"a } brace\" }"), "a } brace");
    }

    /// The offset an error block carries counts the units a JavaScript string
    /// counts, so a character outside the basic plane before it moves the
    /// offset by two rather than by one.
    #[test]
    fn an_offset_counts_the_units_javascript_counts() {
        let objects = document();
        let blocks = parse_text_content(&format!("{} {{= 1 + }}", '\u{1d11e}'), &objects);
        let Some(Block::Error { start, .. }) = blocks
            .iter()
            .find(|block| matches!(block, Block::Error { .. }))
        else {
            panic!("the formula does not parse");
        };
        assert_eq!(*start, 3, "two units for the clef and one for the space");
    }

    /// A point has no spelling a line of prose could carry back, so embedding
    /// one marks the span rather than drawing something nobody typed.
    #[test]
    fn a_point_refuses_to_be_embedded() {
        let mut objects = document();
        objects.push(object(
            "p1",
            "corner",
            Value::Point(crate::model::Point { x: 1.0, y: 2.0 }),
        ));
        let blocks = parse_text_content("{= corner.value }", &objects);
        let read = |address: &Address| {
            objects
                .iter()
                .find(|candidate| candidate.id == address.object_id)
                .and_then(|object| object.get_slot(&address.path))
                .map(|slot| slot.value().clone())
        };
        assert_eq!(evaluate_block_tree(&blocks, &read, None), "!#TYPE");
    }

    /// A tree nested past the limit stops rather than running out of stack, and
    /// the block that stops it says which limit it met.
    #[test]
    fn a_tree_stops_at_the_nesting_limit() {
        let objects = document();
        let content = "{? flag.value }".repeat(MAX_BLOCK_TREE_DEPTH + 6)
            + "x"
            + &"{?}".repeat(MAX_BLOCK_TREE_DEPTH + 6);
        let blocks = parse_text_content(&content, &objects);
        let printed = format!("{blocks:?}");
        assert!(
            printed.contains(&format!(
                "text conditional nests too deeply (limit {MAX_BLOCK_TREE_DEPTH})"
            )),
            "the tree reports the limit it met"
        );
    }
}
