//! Works out what an operator part way through typing an address could have
//! meant.
//!
//! This is the Rust side of `src/engine/complete.ts`. It answers with the
//! candidates and with the text a completion key writes now.
//!
//! Completion runs against the schema rather than against the slots an object
//! carries, for the reason the integrity checks do: a schema declares the slot
//! set, and an object whose slots have drifted from it is a fault rather than a
//! different set of addresses. So a slot the schema declares is offered even
//! where the object is missing it, and the refusal that follows names a real
//! problem instead of the completion hiding it.
//!
//! Matching ignores case, because a name lookup ignores case. A candidate
//! always carries the spelling the document holds, so completing `tab_` against
//! an object named `Table_1` writes `Table_1` rather than the lowercase the
//! operator typed.
//!
//! Every offset and every length here counts UTF-16 code units, which is what
//! a JavaScript string counts. The spans this file reports sit beside the ones
//! the lexer reports, and a host highlights a run of a formula by them, so a
//! byte offset would put the highlight in the wrong place the moment a formula
//! held a character outside the basic plane.

use crate::address::{is_cell_reference_form, to_surface_path};
use crate::formula::lexer::{TokenKind, lex};
use crate::model::{GraphObject, ObjectType};
use crate::primitives::schema::{
    get_object_schema, resolve_derived_slots, resolve_non_derived_slot_paths,
};

/// Whether a candidate names an object or one of its slots.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum CompletionKind {
    Object,
    Slot,
}

impl CompletionKind {
    pub fn as_str(self) -> &'static str {
        match self {
            CompletionKind::Object => "object",
            CompletionKind::Slot => "slot",
        }
    }
}

/// One thing the typed text could become.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Completion {
    /// The whole text that replaces what was typed, such as `table_1.origin.x`.
    pub text: String,
    pub kind: CompletionKind,
}

/// The candidates, and how far the typing can go before a choice is made.
#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct CompletionResult {
    pub candidates: Vec<Completion>,
    /// The longest text every candidate starts with. A completion key writes
    /// this much, which is as far as the typing can go without a choice being
    /// made. It is the whole of a candidate where only one matches.
    pub fill: String,
}

/// A string as the units a JavaScript string counts.
fn units(text: &str) -> Vec<u16> {
    text.encode_utf16().collect()
}

/// A run of units back to text.
fn from_units(units: &[u16]) -> String {
    String::from_utf16_lossy(units)
}

/// The longest run of units that every one of these strings starts with.
pub fn longest_common_prefix(values: &[String]) -> String {
    let Some(first) = values.first().map(|value| units(value)) else {
        return String::new();
    };
    let mut length = first.len();
    for value in values {
        let value = units(value);
        let mut index = 0;
        while index < length && index < value.len() && value[index] == first[index] {
            index += 1;
        }
        length = index;
    }
    from_units(&first[..length])
}

fn result_of(candidates: Vec<Completion>) -> CompletionResult {
    if candidates.is_empty() {
        return CompletionResult::default();
    }
    let texts: Vec<String> = candidates
        .iter()
        .map(|candidate| candidate.text.clone())
        .collect();
    CompletionResult {
        candidates,
        fill: longest_common_prefix(&texts),
    }
}

/// Whether a value begins with a prefix, ignoring case.
///
/// The value is cut to the length of the prefix and then folded, rather than
/// folded and then cut. The two part where a character folds to a different
/// number of units, and the cut-then-fold order is the one `complete.ts` runs.
fn starts_with_ignoring_case(value: &str, prefix: &str) -> bool {
    let prefix_units = units(prefix);
    let value_units = units(value);
    let head = from_units(&value_units[..prefix_units.len().min(value_units.len())]);
    head.to_lowercase() == prefix.to_lowercase()
}

/// Every object whose name starts with what was typed, in document order.
pub fn complete_object_name<A>(partial: &str, objects: &[GraphObject<A>]) -> CompletionResult {
    result_of(
        objects
            .iter()
            .filter(|object| starts_with_ignoring_case(&object.name, partial))
            .map(|object| Completion {
                text: object.name.clone(),
                kind: CompletionKind::Object,
            })
            .collect(),
    )
}

/// The addresses an object carries, as an operator writes them. A table cell
/// appears as `A1` rather than as the `cells.A1` the slot map is keyed by,
/// which is the same surface spelling `format_address` gives back.
pub fn object_slot_paths<A: 'static>(object: &GraphObject<A>) -> Vec<String> {
    let Some(schema) = get_object_schema(object.object_type) else {
        return Vec::new();
    };
    let mut stored = resolve_non_derived_slot_paths(object, &schema.non_derived_slot_paths);
    stored.extend(
        resolve_derived_slots(object, schema.derived_slots)
            .into_iter()
            .map(|entry| entry.path),
    );

    let mut paths: Vec<String> = Vec::new();
    for path in stored {
        let surface = to_surface_path(object.object_type, &path).join(".");
        if !surface.is_empty() && !paths.contains(&surface) {
            paths.push(surface);
        }
    }
    paths
}

/// What a partly typed address could become. Before the first dot it completes
/// an object name, and after it the slots of that object, which is why reaching
/// a whole address takes two completions rather than one.
///
/// A name that is already whole and matches one object alone moves straight on
/// to that object's slots, writing the dot on the way. So an operator completes
/// the object, presses the key again, and is choosing a slot, with none of the
/// punctuation that separates the two typed by hand.
pub fn complete_address<A: 'static>(partial: &str, objects: &[GraphObject<A>]) -> CompletionResult {
    let partial_units = units(partial);
    let dot = partial_units
        .iter()
        .position(|unit| *unit == u16::from(b'.'));

    let Some(dot) = dot else {
        let names = complete_object_name(partial, objects);
        let variables: Vec<Completion> = objects
            .iter()
            .filter(|object| object.object_type == ObjectType::Doc)
            .flat_map(|object| object.slots.keys())
            .filter(|name| starts_with_ignoring_case(name, partial))
            .map(|name| Completion {
                text: name.to_string(),
                kind: CompletionKind::Slot,
            })
            .collect();
        if !variables.is_empty() {
            let mut all = variables;
            all.extend(names.candidates);
            return result_of(all);
        }
        let sole = match names.candidates.as_slice() {
            [only] => Some(only),
            _ => None,
        };
        if let Some(sole) = sole
            && sole.text.to_lowercase() == partial.to_lowercase()
        {
            // The object is settled, so the choice left is which of its slots.
            // The dot is written here rather than by the operator, so the
            // second completion finishes the address on its own.
            return complete_address(&format!("{}.", sole.text), objects);
        }
        return names;
    };

    let object_part = from_units(&partial_units[..dot]);
    let path_part = from_units(&partial_units[dot + 1..]);
    let Some(object) = objects
        .iter()
        .find(|candidate| candidate.name.to_lowercase() == object_part.to_lowercase())
    else {
        return CompletionResult::default();
    };

    result_of(
        object_slot_paths(object)
            .into_iter()
            .filter(|path| starts_with_ignoring_case(path, &path_part))
            .map(|path| Completion {
                text: format!("{}.{}", object.name, path),
                kind: CompletionKind::Slot,
            })
            .collect(),
    )
}

/// One run of a formula that reads like an address, and where it sits. The two
/// offsets count UTF-16 code units from the start of the source.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct FormulaReference {
    pub start: usize,
    pub end: usize,
    pub text: String,
}

/// The runs of a formula that read like an address. A run is a name followed by
/// any number of dotted parts, and a numeric part counts, because a vertex index
/// such as the 0 of `vertex.0.x` lexes as a number rather than as a name.
///
/// A formula that will not lex gives nothing rather than a failure. It is being
/// typed, so it spends most of its life unfinished, and the caller wants the
/// runs it can see rather than a reason it saw none.
pub fn formula_references(source: &str) -> Vec<FormulaReference> {
    let Ok(tokens) = lex(source) else {
        return Vec::new();
    };
    let source_units = units(source);
    let length_of = |text: &str| text.encode_utf16().count();

    let mut runs = Vec::new();
    let mut index = 0;
    while index < tokens.len() {
        let token = &tokens[index];
        if token.kind != TokenKind::Identifier {
            index += 1;
            continue;
        }
        let start = token.start;
        let mut end = token.start + length_of(&token.text);
        index += 1;

        while index + 1 < tokens.len() {
            let dot = &tokens[index];
            let part = &tokens[index + 1];
            let part_is_addressable =
                part.kind == TokenKind::Identifier || matches!(part.kind, TokenKind::Number(_));
            if dot.kind != TokenKind::Dot || !part_is_addressable {
                break;
            }
            end = part.start + length_of(&part.text);
            index += 2;
        }

        runs.push(FormulaReference {
            start,
            end,
            text: from_units(&source_units[start..end.min(source_units.len())]),
        });
    }
    runs
}

/// Whether a run written in a formula names something the document carries. A
/// bare name is one only inside a table cell, where it means a cell of that
/// same table, which is the rule the formula parser already follows.
pub fn formula_reference_resolves<A: 'static>(
    text: &str,
    objects: &[GraphObject<A>],
    table_object_id: Option<&str>,
) -> bool {
    let folded = text.to_lowercase();
    if !text.contains('.') {
        let doc = objects
            .iter()
            .find(|object| object.object_type == ObjectType::Doc);
        if let Some(doc) = doc
            && doc.slots.keys().any(|name| name.to_lowercase() == folded)
        {
            return true;
        }
        let Some(table_object_id) = table_object_id else {
            return false;
        };
        if !is_cell_reference_form(text) {
            return false;
        }
        return objects
            .iter()
            .find(|object| object.id == table_object_id)
            .is_some_and(|table| {
                object_slot_paths(table)
                    .iter()
                    .any(|path| path.to_lowercase() == folded)
            });
    }

    let text_units = units(text);
    let dot = text_units
        .iter()
        .position(|unit| *unit == u16::from(b'.'))
        .expect("the text holds a dot");
    let name = from_units(&text_units[..dot]).to_lowercase();
    let path = from_units(&text_units[dot + 1..]).to_lowercase();
    objects
        .iter()
        .find(|candidate| candidate.name.to_lowercase() == name)
        .is_some_and(|object| {
            object_slot_paths(object)
                .iter()
                .any(|candidate| candidate.to_lowercase() == path)
        })
}

#[cfg(test)]
mod tests {
    use super::{
        Completion, CompletionKind, complete_address, complete_object_name,
        formula_reference_resolves, formula_references, longest_common_prefix, object_slot_paths,
        starts_with_ignoring_case,
    };
    use crate::formula::ast::FormulaAst;
    use crate::model::{GraphObject, ObjectType, Slot, SlotMap, Value};

    fn object(
        id: &str,
        name: &str,
        object_type: ObjectType,
        keys: &[&str],
    ) -> GraphObject<FormulaAst> {
        let mut slots = SlotMap::new();
        for key in keys {
            slots.insert(
                *key,
                Slot::Literal {
                    value: Value::Number(0.0),
                },
            );
        }
        GraphObject {
            id: id.to_string(),
            name: name.to_string(),
            object_type,
            target: None,
            slots,
            ports: None,
            vertex_count: None,
        }
    }

    fn circle(id: &str, name: &str) -> GraphObject<FormulaAst> {
        object(
            id,
            name,
            ObjectType::Circle,
            &["origin.x", "origin.y", "radius"],
        )
    }

    fn texts(candidates: &[Completion]) -> Vec<&str> {
        candidates
            .iter()
            .map(|candidate| candidate.text.as_str())
            .collect()
    }

    /// The fill stops where the candidates part, which is as far as a
    /// completion key can write without a choice being made.
    #[test]
    fn the_fill_reaches_as_far_as_the_candidates_agree() {
        let objects = vec![circle("obj_1", "circle_1"), circle("obj_2", "circle_2")];
        let result = complete_object_name("circ", &objects);
        assert_eq!(texts(&result.candidates), vec!["circle_1", "circle_2"]);
        assert_eq!(result.fill, "circle_");
    }

    /// A candidate carries the spelling the document holds rather than the one
    /// an operator typed, because a name lookup ignores case.
    #[test]
    fn a_candidate_carries_the_spelling_the_document_holds() {
        let objects = vec![circle("obj_1", "Circle_1")];
        let result = complete_object_name("cIrC", &objects);
        assert_eq!(texts(&result.candidates), vec!["Circle_1"]);
        assert_eq!(result.fill, "Circle_1");
    }

    /// A name that is whole and matches one object alone moves on to that
    /// object's slots, with the dot written here rather than by the operator.
    #[test]
    fn a_whole_name_moves_on_to_the_slots() {
        let objects = vec![circle("obj_1", "circle_1")];
        let result = complete_address("circle_1", &objects);
        assert_eq!(result.candidates[0].kind, CompletionKind::Slot);
        assert!(
            result.candidates[0].text.starts_with("circle_1."),
            "the dot is written on the way: {}",
            result.candidates[0].text
        );
    }

    /// A slot the schema declares is offered even where the object is missing
    /// it, so the refusal that follows names a real problem rather than the
    /// completion hiding it.
    #[test]
    fn a_slot_the_object_is_missing_is_still_offered() {
        let bare = object("obj_1", "circle_1", ObjectType::Circle, &[]);
        assert!(
            object_slot_paths(&bare).contains(&"radius".to_string()),
            "the schema declares a radius whatever the object carries"
        );
    }

    /// A value is cut to the length of the prefix and then folded, rather than
    /// folded and then cut. `İ` folds to two units, so folding first would let
    /// a one-unit prefix match against two units of the folded value.
    #[test]
    fn a_prefix_is_matched_by_cutting_before_folding() {
        assert!(starts_with_ignoring_case("Radius", "rad"));
        assert!(!starts_with_ignoring_case("rad", "Radius"));
        assert!(starts_with_ignoring_case("İstanbul", "İ"));
        assert!(
            !starts_with_ignoring_case("İstanbul", "i"),
            "one unit of the value is \"İ\", which does not fold to \"i\""
        );
    }

    /// The longest common prefix is measured in the units a JavaScript string
    /// counts, so a shared run that ends inside a surrogate pair stops at the
    /// unit rather than at the character.
    #[test]
    fn the_longest_common_prefix_counts_the_units_a_javascript_string_counts() {
        let values = vec!["abc".to_string(), "abd".to_string()];
        assert_eq!(longest_common_prefix(&values), "ab");
        assert_eq!(longest_common_prefix(&["only".to_string()]), "only");
        assert_eq!(longest_common_prefix(&[]), "");
        assert_eq!(
            longest_common_prefix(&["alpha".to_string(), "beta".to_string()]),
            ""
        );
    }

    /// The span of a run counts UTF-16 code units from the start of the source,
    /// so a character outside the basic plane moves every later run by the two
    /// units JavaScript counts it as rather than by one character.
    #[test]
    fn a_run_is_spanned_in_the_units_a_javascript_string_counts() {
        let runs = formula_references("\"\u{1F600}\" + circle_1.radius");
        assert_eq!(runs.len(), 1);
        assert_eq!(runs[0].start, 7, "the emoji counts as two units");
        assert_eq!(runs[0].end, 22);
        assert_eq!(runs[0].text, "circle_1.radius");
    }

    /// A formula that will not lex gives nothing rather than a failure,
    /// because it is being typed and spends most of its life unfinished.
    #[test]
    fn a_formula_part_way_through_being_typed_gives_what_runs_it_can() {
        assert_eq!(
            formula_references("circle_1.radius + \"unterminated"),
            vec![]
        );
        assert_eq!(formula_references(""), vec![]);
        assert_eq!(
            formula_references("circle_1.")
                .iter()
                .map(|run| run.text.as_str())
                .collect::<Vec<_>>(),
            vec!["circle_1"],
            "a trailing dot is not part of a run"
        );
    }

    /// A vertex index lexes as a number rather than as a name, and it is still
    /// part of the run around it.
    #[test]
    fn a_numeric_part_belongs_to_the_run() {
        let runs = formula_references("path_1.vertex.0.x");
        assert_eq!(runs.len(), 1);
        assert_eq!(runs[0].text, "path_1.vertex.0.x");
    }

    /// A bare name resolves only inside a table cell, where it means a cell of
    /// that same table, which is the rule the formula parser follows.
    #[test]
    fn a_bare_name_resolves_only_against_the_table_it_sits_in() {
        // The cells a table declares follow from its rows and its columns, so
        // the two carry a size rather than the zero the helper writes.
        let mut table = object(
            "t1",
            "table_1",
            ObjectType::Table,
            &["origin.x", "origin.y", "rows", "cols", "cells.A1"],
        );
        for key in ["rows", "cols"] {
            table.slots.insert(
                key,
                Slot::Literal {
                    value: Value::Number(2.0),
                },
            );
        }
        let objects = vec![table];
        assert!(!formula_reference_resolves("A1", &objects, None));
        assert!(formula_reference_resolves("A1", &objects, Some("t1")));
        assert!(!formula_reference_resolves("Z9", &objects, Some("t1")));
        assert!(
            formula_reference_resolves("table_1.A1", &objects, None),
            "a cell resolves by its surface spelling"
        );
        assert!(
            !formula_reference_resolves("table_1.cells.A1", &objects, None),
            "and not by the key the slot map is built on"
        );
    }
}
