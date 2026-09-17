//! Joins the math language to the graph. It declares the slots a math object
//! carries, the addresses each export reads, and the compute function behind
//! every export.
//!
//! A math object holds its equations in one literal slot named `source`. The
//! names that source defines become derived slots under `out`, the free names
//! it reads become slots under `in`, and each unknown it solves for becomes a
//! slot under `seed`, which is where the search for that unknown starts. All
//! three lists are held in the ports of the object rather than worked out here,
//! because ports change only through a mutation. Evaluation therefore leaves
//! the slot set alone: this file reads ports to say which slots exist, and
//! reads source only to say what they hold.
//!
//! Every export parses the whole source and evaluates the whole program, so a
//! source with four exports parses four times per pass. The simplest correct
//! arrangement is worth more here than the saving, and a cache would have to be
//! invalidated from the one place that writes source.
//!
//! An input port carries a number, because the math language computes over
//! numbers alone. A port holding anything else gives a type error on every
//! export that reads it rather than on the port, since a port is a literal slot
//! and a literal holds whatever an operator typed.
//!
//! The port of `src/engine/primitives/math.ts`.

use std::collections::{BTreeMap, HashMap};

use crate::address::{Address, format_address, parse_address};
use crate::math::ast::{ExportKind, MathProgram, math_export_lines};
use crate::math::eval::{evaluate_math_object, math_address_key};
use crate::math::lexer::MATH_REFERENCE_COMMAND;
use crate::math::names::{MathNames, resolve_math_names};
use crate::math::parser::parse_math;
use crate::measure::{MathStyle, MeasureCapability};
use crate::model::{
    ErrorCode, ErrorValue, GraphObject, GraphObjectPorts, ObjectType, Slot, SlotMap, Value,
    slot_key,
};
use crate::number::to_javascript_text;
use crate::primitives::schema::{
    DerivedSlotCompute, DerivedSlotDependencies, DerivedSlotSchema, SlotComputeInputs,
};

pub fn math_source_path() -> Vec<String> {
    vec!["source".to_string()]
}

pub fn math_display_path() -> Vec<String> {
    vec!["display".to_string()]
}

pub fn math_measured_width_path() -> Vec<String> {
    vec!["measuredWidth".to_string()]
}

pub fn math_measured_height_path() -> Vec<String> {
    vec!["measuredHeight".to_string()]
}

/// What a math object shows when nobody is editing it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MathDisplay {
    Source,
    Value,
    Both,
}

impl MathDisplay {
    pub fn as_str(self) -> &'static str {
        match self {
            MathDisplay::Source => "source",
            MathDisplay::Value => "value",
            MathDisplay::Both => "both",
        }
    }

    pub fn parse(text: &str) -> Option<MathDisplay> {
        match text {
            "source" => Some(MathDisplay::Source),
            "value" => Some(MathDisplay::Value),
            "both" => Some(MathDisplay::Both),
            _ => None,
        }
    }
}

pub const MATH_DISPLAY_VALUES: [MathDisplay; 3] =
    [MathDisplay::Source, MathDisplay::Value, MathDisplay::Both];

pub const MATH_DEFAULT_DISPLAY: MathDisplay = MathDisplay::Source;

/// The size notation is drawn at. It is a constant rather than a slot, because
/// nothing yet reads a font size off a math object and a slot an operator can
/// write is a row in the panel and a field in every saved document. A style
/// slot arrives when something asks for one.
pub const MATH_FONT_SIZE: f64 = 18.0;

/// The space between the notation and the edge of the box around it.
pub const MATH_BOX_PADDING: f64 = 8.0;

/// The size of the box drawn for a source that measures to nothing.
pub const MATH_EMPTY_BOX_WIDTH: f64 = 120.0;
pub const MATH_EMPTY_BOX_HEIGHT: f64 = 40.0;

/// How many significant digits a displayed result carries.
pub const MATH_VALUE_DIGITS: usize = 6;

/// The value a seed takes when a source first solves for the name it belongs
/// to. Zero is where a search starts before an operator moves it, and it is the
/// root nearest the origin that an equation with several of them gives first.
pub fn math_default_seed() -> Value {
    Value::Number(0.0)
}

/// The value an input port takes when the source first names it. It is null
/// rather than a number, because no operator has given the port a value yet and
/// null is the member of the value union that carries the absence of one.
///
/// A number in its place would be read as an answer. A source whose first line
/// is `y = x + 1` would export 1 from an input nobody typed, and a source whose
/// first line is a fraction would export a division by zero, which reads as a
/// fault in the arithmetic rather than as a port waiting to be filled. With
/// null both sources export that the name has no value here, which names the
/// port, and the port is the row an operator fills or the address a link binds.
pub fn math_default_input() -> Value {
    Value::Null
}

pub fn math_in_port_path(name: &str) -> Vec<String> {
    vec!["in".to_string(), name.to_string()]
}

pub fn math_out_port_path(name: &str) -> Vec<String> {
    vec!["out".to_string(), name.to_string()]
}

pub fn math_seed_path(name: &str) -> Vec<String> {
    vec!["seed".to_string(), name.to_string()]
}

fn port_names<A>(object: &GraphObject<A>, which: Port) -> Vec<String> {
    let Some(ports) = object.ports.as_ref() else {
        return Vec::new();
    };
    match which {
        Port::In => ports.input.clone(),
        Port::Out => ports.output.clone(),
        Port::Seed => ports.seed.clone().unwrap_or_default(),
    }
}

#[derive(Clone, Copy)]
enum Port {
    In,
    Out,
    Seed,
}

pub fn enumerate_math_in_paths<A>(object: &GraphObject<A>) -> Vec<Vec<String>> {
    port_names(object, Port::In)
        .iter()
        .map(|name| math_in_port_path(name))
        .collect()
}

pub fn enumerate_math_seed_paths<A>(object: &GraphObject<A>) -> Vec<Vec<String>> {
    port_names(object, Port::Seed)
        .iter()
        .map(|name| math_seed_path(name))
        .collect()
}

/// The source text of an object, or an empty string where the slot is missing
/// or holds something other than a string. An empty source parses to a program
/// with no lines, which exports nothing and reads nothing.
pub fn read_math_source<A>(object: &GraphObject<A>) -> String {
    match object.get_slot(&math_source_path()).map(Slot::value) {
        Some(Value::Text(text)) => text.clone(),
        _ => String::new(),
    }
}

/// Why a source could not be read. The lexer, the parser and the name binder
/// all report the same shape, because a caller acts on all three the same way:
/// it refuses the mutation and shows the line.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MathSourceError {
    pub message: String,
    /// The line of the source the failure happened on, counted from zero.
    pub line: usize,
}

/// Reads a source text and reports the names it implies, or the failure that
/// stopped it. The mutation that writes source calls this to work out the slot
/// set, and a caller that wants to check a source before writing it calls the
/// same function, so the two can never disagree.
pub fn read_math_names(source: &str) -> Result<MathNames, MathSourceError> {
    let program = parse_math(source).map_err(|failure| MathSourceError {
        message: failure.message,
        line: failure.line,
    })?;
    resolve_math_names(&program).map_err(|failure| MathSourceError {
        message: failure.message,
        line: failure.line,
    })
}

/// A name as LaTeX writes it, so an export called `x_ans` reads as x with ans
/// under it rather than as four letters and a low line.
fn name_as_latex(name: &str) -> String {
    let mut parts = name.split('_');
    let Some(head) = parts.next() else {
        return name.to_string();
    };
    let base = if head.chars().count() == 1 {
        head.to_string()
    } else {
        format!("\\operatorname{{{head}}}")
    };
    let rest: Vec<&str> = parts.collect();
    if rest.is_empty() {
        base
    } else {
        format!("{base}_{{{}}}", rest.join("_"))
    }
}

/// Rounds to six significant digits the way `Number(x.toPrecision(6))` does:
/// the digits are written and then read back, so the answer is the double
/// nearest to the shortened decimal rather than one reached by scaling.
fn to_value_digits(value: f64) -> f64 {
    if value == 0.0 || !value.is_finite() {
        return value;
    }
    let written = format!("{:.*e}", MATH_VALUE_DIGITS - 1, value);
    written.parse().unwrap_or(value)
}

/// A number as LaTeX writes it, short enough to read at a glance. A value that
/// is not a number, which is what an error is, reads as the code it carries, so
/// a failed line says so where its result would be.
fn value_as_latex(value: Option<&Value>) -> String {
    match value {
        None => "?".to_string(),
        Some(Value::Error(failure)) => format!("\\text{{{}}}", failure.error.as_str()),
        Some(Value::Number(number)) => to_javascript_text(to_value_digits(*number)),
        Some(_) => "\\text{?}".to_string(),
    }
}

/// The LaTeX a math object draws, for the display setting it carries.
///
/// One function serves the measurement in the engine and the drawing in the
/// render layer. Two of them would drift, and a box measured from one string
/// with another string drawn into it is a box of the wrong size.
///
/// The value form shows one line for each name the source defines, the unknown
/// of an implicit line among them, because an operator who solves for a root
/// reads that root the same way as any other answer. The both form appends the
/// result to the line that produced it, which reads the way an equation does:
/// the working, then an equals sign, then the answer. An implicit line already
/// carries an equals sign of its own, so its result arrives after an arrow and
/// with the name of the unknown in front of it, which keeps the answer from
/// reading as a third side of the equation.
pub fn math_display_latex(
    source: &str,
    display: MathDisplay,
    program: Option<&MathProgram>,
    exports: &BTreeMap<String, Value>,
) -> String {
    let Some(program) = program else {
        return source.to_string();
    };
    if display == MathDisplay::Source {
        return source.to_string();
    }
    let exported = math_export_lines(program);
    if display == MathDisplay::Value {
        if exported.is_empty() {
            return source.to_string();
        }
        return exported
            .iter()
            .map(|line| {
                format!(
                    "{}={}",
                    name_as_latex(&line.name),
                    value_as_latex(exports.get(&line.name))
                )
            })
            .collect::<Vec<_>>()
            .join("\\\\");
    }
    let mut result_by_line: BTreeMap<usize, String> = BTreeMap::new();
    for line in &exported {
        let result = value_as_latex(exports.get(&line.name));
        result_by_line.insert(
            line.source_line,
            if line.kind == ExportKind::Solve {
                format!("\\Rightarrow {}={result}", name_as_latex(&line.name))
            } else {
                format!("={result}")
            },
        );
    }
    source
        .split('\n')
        .enumerate()
        .map(|(index, text)| match result_by_line.get(&index) {
            None => text.to_string(),
            Some(result) => format!("{text}{result}"),
        })
        .filter(|text| !text.trim().is_empty())
        .collect::<Vec<_>>()
        .join("\\\\")
}

fn read_display<A>(object: &GraphObject<A>) -> MathDisplay {
    match object.get_slot(&math_display_path()).map(Slot::value) {
        Some(Value::Text(text)) => MathDisplay::parse(text).unwrap_or(MATH_DEFAULT_DISPLAY),
        _ => MATH_DEFAULT_DISPLAY,
    }
}

/// The LaTeX an object draws right now, read off its own slots. The renderer
/// calls this, and the measured slots call [`math_display_latex`] with the
/// values evaluation has in hand.
pub fn read_math_display_latex<A>(object: &GraphObject<A>) -> String {
    let source = read_math_source(object);
    let display = read_display(object);
    if display == MathDisplay::Source {
        return source;
    }
    let Ok(program) = parse_math(&source) else {
        return source;
    };
    let mut exports = BTreeMap::new();
    for name in port_names(object, Port::Out) {
        if let Some(slot) = object.get_slot(&math_out_port_path(&name)) {
            exports.insert(name, slot.value().clone());
        }
    }
    math_display_latex(&source, display, Some(&program), &exports)
}

fn math_error(message: impl Into<String>) -> Value {
    Value::Error(ErrorValue {
        error: ErrorCode::Math,
        message: message.into(),
    })
}

fn reference_error(message: impl Into<String>) -> Value {
    Value::Error(ErrorValue {
        error: ErrorCode::Ref,
        message: message.into(),
    })
}

fn type_error(message: impl Into<String>) -> Value {
    Value::Error(ErrorValue {
        error: ErrorCode::Type,
        message: message.into(),
    })
}

fn measure_error(message: impl Into<String>) -> Value {
    Value::Error(ErrorValue {
        error: ErrorCode::Measure,
        message: message.into(),
    })
}

/// The source of an object as a string, or the reason it cannot be read.
fn read_source_value<A>(
    object: &GraphObject<A>,
    inputs: &SlotComputeInputs<A>,
) -> Result<String, Value> {
    match inputs.at(object, &math_source_path()) {
        None => Err(reference_error("math: source did not resolve to a value")),
        Some(Value::Error(failure)) => Err(Value::Error(failure)),
        Some(Value::Text(text)) => Ok(text),
        Some(_) => Err(type_error("math: source holds something other than text")),
    }
}

/// Which of the two sizes a measured slot carries.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Axis {
    Width,
    Height,
}

/// The width and the height of the notation, including the padding around it.
/// Both read the source alone, because the notation is drawn from the source
/// and from nothing an input port carries.
///
/// An empty source measures to a box an operator can still see and click,
/// rather than to nothing, so a math object created before anything is typed
/// into it has a place on the canvas.
fn math_measure_compute<A: 'static>(axis: Axis) -> DerivedSlotCompute<A> {
    Box::new(move |object, inputs: &SlotComputeInputs<A>| {
        let source = match read_source_value(object, inputs) {
            Err(failure) => return failure,
            Ok(source) => source,
        };
        if source.trim().is_empty() {
            return Value::Number(if axis == Axis::Width {
                MATH_EMPTY_BOX_WIDTH
            } else {
                MATH_EMPTY_BOX_HEIGHT
            });
        }
        let display = match inputs.at(object, &math_display_path()) {
            Some(Value::Text(text)) => MathDisplay::parse(&text).unwrap_or(MATH_DEFAULT_DISPLAY),
            _ => MATH_DEFAULT_DISPLAY,
        };
        let mut latex = source.clone();
        if display != MathDisplay::Source
            && let Ok(program) = parse_math(&source)
        {
            let mut exports = BTreeMap::new();
            for name in port_names(object, Port::Out) {
                if let Some(value) = inputs.at(object, &math_out_port_path(&name)) {
                    exports.insert(name, value);
                }
            }
            latex = math_display_latex(&source, display, Some(&program), &exports);
        }
        let measurer = inputs
            .real_measurer()
            .filter(|measurer| measurer.capability() == MeasureCapability::TextAndMath);
        let Some(measurer) = measurer else {
            return measure_error(format!(
                "math: {} has no measurer that can size notation wired, so it cannot be measured",
                object.name
            ));
        };
        let Ok(measured) = measurer.measure_math(
            &latex,
            &MathStyle {
                font_size: MATH_FONT_SIZE,
            },
        ) else {
            return measure_error(format!("math: {} could not be measured", object.name));
        };
        let size = if axis == Axis::Width {
            measured.width
        } else {
            measured.height
        };
        if !size.is_finite() {
            return measure_error(format!(
                "math: {} measured to a size that is not a finite number",
                object.name
            ));
        }
        Value::Number(size + MATH_BOX_PADDING * 2.0)
    })
}

/// What a measurement reads. It is the source, the display setting, and every
/// export, because the value forms draw those results and a box has to be the
/// size of what goes in it.
fn math_measure_dependencies<A: 'static>() -> DerivedSlotDependencies<A> {
    DerivedSlotDependencies::Dynamic(Box::new(|object, _objects| {
        let mut addresses = vec![
            Address {
                object_id: object.id.clone(),
                path: math_source_path(),
            },
            Address {
                object_id: object.id.clone(),
                path: math_display_path(),
            },
        ];
        for name in port_names(object, Port::Out) {
            addresses.push(Address {
                object_id: object.id.clone(),
                path: math_out_port_path(&name),
            });
        }
        addresses
    }))
}

pub fn math_measured_slots<A: 'static>() -> Vec<DerivedSlotSchema<A>> {
    vec![
        DerivedSlotSchema {
            path: math_measured_width_path(),
            dependencies: math_measure_dependencies(),
            compute: math_measure_compute(Axis::Width),
        },
        DerivedSlotSchema {
            path: math_measured_height_path(),
            dependencies: math_measure_dependencies(),
            compute: math_measure_compute(Axis::Height),
        },
    ]
}

/// The addresses a source reads out of the document, which the schema declares
/// so the graph carries an edge into every one of them. Reading them means
/// parsing the source, which happens at edge derivation time and never during
/// evaluation, so the slot set stays fixed for a whole pass.
///
/// An address naming a slot that is gone is reported all the same. Leaving it
/// out would drop the edge in silence, and deleting the object a source reads
/// would then quietly break that source instead of being refused with the
/// dependent named, which is the answer section 4 of the spec gives for every
/// other slot.
pub fn math_source_references<A>(object: &GraphObject<A>) -> Vec<Address> {
    read_math_names(&read_math_source(object))
        .map(|names| names.references)
        .unwrap_or_default()
}

/// The addresses a parsed program reads, without going back to the text.
fn collect_program_references(program: &MathProgram) -> Vec<Address> {
    resolve_math_names(program)
        .map(|names| names.references)
        .unwrap_or_default()
}

/// What an export reads: the source, every input port, every seed, and every
/// address the source names. An export depends on all of them rather than on
/// the ones its own line touches, because a line reads the lines above it and
/// working out which of those reach a given export would be a second dependency
/// pass inside the box.
fn math_out_dependencies<A: 'static>() -> DerivedSlotDependencies<A> {
    DerivedSlotDependencies::Dynamic(Box::new(|object, _objects| {
        let mut addresses = vec![Address {
            object_id: object.id.clone(),
            path: math_source_path(),
        }];
        for name in port_names(object, Port::In) {
            addresses.push(Address {
                object_id: object.id.clone(),
                path: math_in_port_path(&name),
            });
        }
        for name in port_names(object, Port::Seed) {
            addresses.push(Address {
                object_id: object.id.clone(),
                path: math_seed_path(&name),
            });
        }
        addresses.extend(math_source_references(object));
        addresses
    }))
}

fn math_output_compute<A: 'static>(export_name: String) -> DerivedSlotCompute<A> {
    Box::new(move |object, inputs: &SlotComputeInputs<A>| {
        let source = match read_source_value(object, inputs) {
            Err(failure) => return failure,
            Ok(source) => source,
        };
        let program = match parse_math(&source) {
            Err(failure) => {
                return math_error(format!(
                    "math: line {} does not parse, and {}",
                    failure.line + 1,
                    failure.message
                ));
            }
            Ok(program) => program,
        };

        let mut gathered: HashMap<String, f64> = HashMap::new();
        for name in port_names(object, Port::In) {
            let Some(value) = inputs.at(object, &math_in_port_path(&name)) else {
                return reference_error(format!("math: in.{name} did not resolve to a value"));
            };
            match value {
                Value::Error(_) => return value,
                // A port nobody has filled yet is left out of the environment
                // rather than refused here, because this loop is read once for
                // the whole object and a refusal would take down every export,
                // including the lines that never name the port. Left out, the
                // name fails on the lines that read it, and the evaluator says
                // which name carried no value.
                Value::Null => continue,
                Value::Number(number) => {
                    gathered.insert(name, number);
                }
                _ => {
                    return type_error(format!(
                        "math: in.{name} holds something other than a number"
                    ));
                }
            }
        }

        let mut references: HashMap<String, f64> = HashMap::new();
        let named = if program.lines.is_empty() {
            Vec::new()
        } else {
            collect_program_references(&program)
        };
        for address in named {
            let key = math_address_key(&address);
            let Some(value) = (inputs.read)(&address) else {
                return reference_error(format!("math: {key} did not resolve to a value"));
            };
            match value {
                Value::Error(_) => return value,
                Value::Number(number) => {
                    references.insert(key, number);
                }
                _ => {
                    return type_error(format!("math: {key} holds something other than a number"));
                }
            }
        }

        let mut seeds: HashMap<String, f64> = HashMap::new();
        for name in port_names(object, Port::Seed) {
            let Some(value) = inputs.at(object, &math_seed_path(&name)) else {
                return reference_error(format!("math: seed.{name} did not resolve to a value"));
            };
            match value {
                Value::Error(_) => return value,
                Value::Number(number) => {
                    seeds.insert(name, number);
                }
                _ => {
                    return type_error(format!(
                        "math: seed.{name} holds something other than a number"
                    ));
                }
            }
        }

        let evaluation = evaluate_math_object(&program, &gathered, &references, &seeds);
        match evaluation.get(&export_name) {
            None => math_error(format!(
                "math: the source no longer defines \"{export_name}\""
            )),
            Some(value) => value.clone(),
        }
    })
}

pub fn enumerate_math_out_derived_slots<A: 'static>(
    object: &GraphObject<A>,
) -> Vec<DerivedSlotSchema<A>> {
    port_names(object, Port::Out)
        .into_iter()
        .map(|name| DerivedSlotSchema {
            path: math_out_port_path(&name),
            dependencies: math_out_dependencies(),
            compute: math_output_compute(name),
        })
        .collect()
}

/// A math object with nothing typed into it yet, carrying every slot its schema
/// declares. The two measured slots are part of that set, so an object built any
/// other way fails the integrity check the moment an edge derives into one.
pub fn create_math_object<A>(id: &str, name: &str, origin_x: f64, origin_y: f64) -> GraphObject<A> {
    use crate::primitives::geometry::{origin_x_path, origin_y_path};
    let mut slots = SlotMap::new();
    slots.insert(
        slot_key(&origin_x_path()),
        Slot::Literal {
            value: Value::Number(origin_x),
        },
    );
    slots.insert(
        slot_key(&origin_y_path()),
        Slot::Literal {
            value: Value::Number(origin_y),
        },
    );
    slots.insert(
        slot_key(&math_source_path()),
        Slot::Literal {
            value: Value::Text(String::new()),
        },
    );
    slots.insert(
        slot_key(&math_display_path()),
        Slot::Literal {
            value: Value::Text(MATH_DEFAULT_DISPLAY.as_str().to_string()),
        },
    );
    for at in [math_measured_width_path(), math_measured_height_path()] {
        slots.insert(slot_key(&at), Slot::Derived { value: Value::Null });
    }
    GraphObject {
        id: id.to_string(),
        name: name.to_string(),
        object_type: ObjectType::Math,
        target: None,
        slots,
        ports: Some(GraphObjectPorts {
            input: Vec::new(),
            output: Vec::new(),
            seed: None,
        }),
        vertex_count: None,
    }
}

/// Rebuilds an object around a new source text: the source slot itself, one
/// input slot for each free name, and one export slot for each defined name.
///
/// A port that survives the edit keeps the slot it had, so an operator who
/// linked an input to a table cell and then edits an unrelated line does not
/// lose that link. A seed keeps its value the same way, because an operator who
/// moved a seed to pick a root has said which root the object returns and a
/// later edit elsewhere in the source is not a change of mind about that. A port
/// the new source stops reading loses its slot, and an export it stops defining
/// loses its slot as well. An outside formula that read that export then fails
/// the integrity check, rather than reading a value that nothing computes.
///
/// The caller checks the source first. A source that does not parse never
/// arrives here, because a half parsed source would take every export away from
/// whatever reads them.
pub fn apply_math_source<A: Clone>(
    object: &GraphObject<A>,
    source: &str,
    names: &MathNames,
) -> GraphObject<A> {
    let mut slots = SlotMap::new();
    let source_key = slot_key(&math_source_path());
    for (key, slot) in object.slots.iter() {
        let is_port_slot =
            key.starts_with("in.") || key.starts_with("out.") || key.starts_with("seed.");
        if !is_port_slot && key != source_key {
            slots.insert(key, slot.clone());
        }
    }
    slots.insert(
        source_key,
        Slot::Literal {
            value: Value::Text(source.to_string()),
        },
    );
    for at in [math_measured_width_path(), math_measured_height_path()] {
        let key = slot_key(&at);
        if !matches!(slots.get(&key), Some(Slot::Derived { .. })) {
            slots.insert(key, Slot::Derived { value: Value::Null });
        }
    }
    for name in &names.inputs {
        let key = slot_key(&math_in_port_path(name));
        let held = object.slots.get(&key).cloned();
        slots.insert(
            key,
            held.unwrap_or(Slot::Literal {
                value: math_default_input(),
            }),
        );
    }
    for name in &names.seeds {
        let key = slot_key(&math_seed_path(name));
        let held = object.slots.get(&key).cloned();
        slots.insert(
            key,
            held.unwrap_or(Slot::Literal {
                value: math_default_seed(),
            }),
        );
    }
    for name in &names.exports {
        let key = slot_key(&math_out_port_path(name));
        let held = object.slots.get(&key).cloned();
        slots.insert(
            key,
            match held {
                Some(Slot::Derived { value }) => Slot::Derived { value },
                _ => Slot::Derived { value: Value::Null },
            },
        );
    }
    GraphObject {
        ports: Some(GraphObjectPorts {
            input: names.inputs.clone(),
            output: names.exports.clone(),
            // The seed family is left off a source that solves for nothing, so
            // an object with no implicit line in it saves the same bytes it
            // saved before a solve was a thing the language could do.
            seed: if names.seeds.is_empty() {
                None
            } else {
                Some(names.seeds.clone())
            },
        }),
        slots,
        ..object.clone()
    }
}

/// Finds every reference macro in a source, so both directions share one scan.
fn rewrite_references(source: &str, rewrite: impl Fn(&str) -> Option<String>) -> String {
    let opening = format!("\\{MATH_REFERENCE_COMMAND}{{");
    let mut out = String::new();
    let mut at = 0usize;
    loop {
        let Some(found) = source[at..].find(&opening) else {
            out.push_str(&source[at..]);
            return out;
        };
        let start = at + found;
        let inside_from = start + opening.len();
        let Some(close_at) = source[inside_from..].find('}') else {
            out.push_str(&source[at..]);
            return out;
        };
        let close = inside_from + close_at;
        let inside = &source[inside_from..close];
        let replaced = rewrite(inside).unwrap_or_else(|| inside.to_string());
        out.push_str(&source[at..start]);
        out.push_str(&opening);
        out.push_str(&replaced);
        out.push('}');
        at = close + 1;
    }
}

/// Rewrites stored address macros without changing the surrounding notation.
pub fn rewrite_math_references(source: &str, rewrite: impl Fn(&Address) -> Address) -> String {
    rewrite_references(source, |inside| {
        let mut parts = inside.split('.');
        let object_id = parts.next()?;
        let path: Vec<String> = parts.map(str::to_string).collect();
        if path.is_empty() {
            return None;
        }
        let address = rewrite(&Address {
            object_id: object_id.to_string(),
            path,
        });
        Some(format!("{}.{}", address.object_id, address.path.join(".")))
    })
}

/// A source as an operator reads it, with each address showing the name its
/// object carries now. The stored form holds an object id, so this is what turns
/// the stored form back into the one a person typed, the same way a formula is
/// shown.
pub fn math_source_with_names<A>(source: &str, objects: &[GraphObject<A>]) -> String {
    rewrite_references(source, |inside| {
        let dot = inside.find('.')?;
        if dot == 0 {
            return None;
        }
        let address = Address {
            object_id: inside[..dot].to_string(),
            path: inside[dot + 1..].split('.').map(str::to_string).collect(),
        };
        format_address(&address, objects).ok()
    })
}

/// A source as it is stored, with each address holding the id of the object it
/// names. An address that names nothing is left as the operator wrote it, so the
/// mutation that writes the source can refuse it and say which one was wrong.
pub fn math_source_with_ids<A>(source: &str, objects: &[GraphObject<A>]) -> String {
    rewrite_references(source, |inside| {
        parse_address(inside, objects)
            .ok()
            .map(|parsed| format!("{}.{}", parsed.object_id, parsed.path.join(".")))
    })
}

/// The addresses a source names that the document does not carry. The mutation
/// that writes a source reads this, so a reference to something absent is
/// refused with the address in the message rather than left to fail later as an
/// edge into a slot that is not there.
pub fn unresolved_math_references<A>(source: &str, objects: &[GraphObject<A>]) -> Vec<String> {
    let Ok(names) = read_math_names(source) else {
        return Vec::new();
    };
    let mut missing = Vec::new();
    for address in &names.references {
        let held = objects
            .iter()
            .find(|candidate| candidate.id == address.object_id)
            .and_then(|object| object.get_slot(&address.path));
        if held.is_none() {
            missing.push(math_address_key(address));
        }
    }
    missing
}

#[cfg(test)]
mod tests {
    use super::*;

    fn object(
        source: &str,
        ports: GraphObjectPorts,
        extra: &[(&str, Slot<()>)],
    ) -> GraphObject<()> {
        let mut held: GraphObject<()> = create_math_object("m1", "eq", 0.0, 0.0);
        held.slots.insert(
            slot_key(&math_source_path()),
            Slot::Literal {
                value: Value::Text(source.to_string()),
            },
        );
        held.ports = Some(ports);
        for (key, slot) in extra {
            held.slots.insert(*key, slot.clone());
        }
        held
    }

    fn ports(input: &[&str], output: &[&str], seed: Option<&[&str]>) -> GraphObjectPorts {
        GraphObjectPorts {
            input: input.iter().map(|name| (*name).to_string()).collect(),
            output: output.iter().map(|name| (*name).to_string()).collect(),
            seed: seed.map(|names| names.iter().map(|name| (*name).to_string()).collect()),
        }
    }

    fn literal(value: Value) -> Slot<()> {
        Slot::Literal { value }
    }

    /// Computes one export against the slots the object carries.
    fn export(held: &GraphObject<()>, name: &str) -> Value {
        let objects = [held.clone()];
        let read = |address: &Address| {
            if address.object_id != held.id {
                return None;
            }
            held.get_slot(&address.path)
                .map(|slot| slot.value().clone())
        };
        let inputs = SlotComputeInputs {
            read: &read,
            read_range: None,
            objects: &objects,
            measurer: None,
        };
        let slots = enumerate_math_out_derived_slots(held);
        let found = slots
            .iter()
            .find(|entry| slot_key(&entry.path) == format!("out.{name}"))
            .expect("the port is declared");
        (found.compute)(held, &inputs)
    }

    /// A source becomes three lists of names, and each list becomes a family of
    /// slots. The ports carry them, so evaluation reads the ports and never the
    /// source to say which slots exist.
    #[test]
    fn a_source_names_its_inputs_exports_and_seeds() {
        let names = read_math_names("y=x+1").expect("the source parses");
        assert_eq!(names.exports, vec!["y"]);
        assert_eq!(names.inputs, vec!["x"]);
        assert!(names.seeds.is_empty());

        let solving = read_math_names("\\solve{x}x^2=4").expect("the source parses");
        assert_eq!(solving.exports, vec!["x"]);
        assert_eq!(solving.seeds, vec!["x"]);
    }

    /// A source that does not parse reports the line it failed on, so the
    /// mutation that would have written it can show that line.
    #[test]
    fn a_source_that_does_not_parse_names_its_line() {
        let failure = read_math_names("y=1\ny=").expect_err("the second line fails");
        assert_eq!(failure.line, 1);
        assert!(!failure.message.is_empty());
    }

    /// A port that survives an edit keeps the slot it had, so an operator who
    /// linked an input and then edits an unrelated line does not lose the link.
    /// A seed keeps its value for the same reason.
    #[test]
    fn an_edit_keeps_the_ports_that_survive_it() {
        let linked = object(
            "y=x+1",
            ports(&["x"], &["y"], None),
            &[
                ("in.x", literal(Value::Number(5.0))),
                ("out.y", Slot::Derived { value: Value::Null }),
            ],
        );
        let names = read_math_names("y=x+2").expect("the source parses");
        let after = apply_math_source(&linked, "y=x+2", &names);
        assert_eq!(
            after.get_slot(&math_in_port_path("x")).map(Slot::value),
            Some(&Value::Number(5.0)),
            "the link an operator made outlives an edit elsewhere"
        );

        let dropped = read_math_names("y=1").expect("the source parses");
        let without = apply_math_source(&linked, "y=1", &dropped);
        assert!(without.get_slot(&math_in_port_path("x")).is_none());
    }

    /// A source that solves for nothing carries no seed family at all, so an
    /// object with no implicit line saves the bytes it saved before a solve was
    /// a thing the language could do.
    #[test]
    fn a_source_with_no_implicit_line_carries_no_seed_family() {
        let seeded = object(
            "\\solve{x}x^2=4",
            ports(&[], &["x"], Some(&["x"])),
            &[("seed.x", literal(Value::Number(3.0)))],
        );
        let kept = read_math_names("\\solve{x}x^2=9").expect("the source parses");
        let after = apply_math_source(&seeded, "\\solve{x}x^2=9", &kept);
        assert_eq!(
            after.get_slot(&math_seed_path("x")).map(Slot::value),
            Some(&Value::Number(3.0)),
            "a seed an operator moved says which root the object returns"
        );
        assert_eq!(
            after.ports.as_ref().and_then(|p| p.seed.clone()),
            Some(vec!["x".to_string()])
        );

        let plain = read_math_names("y=1").expect("the source parses");
        let without = apply_math_source(&seeded, "y=1", &plain);
        assert_eq!(without.ports.as_ref().and_then(|p| p.seed.clone()), None);
        assert!(without.get_slot(&math_seed_path("x")).is_none());
    }

    /// A port nobody has filled is left out of the environment rather than
    /// refused, so a line that never names it still exports a number and the
    /// line that does names the port that is empty.
    #[test]
    fn an_unfilled_port_fails_only_the_lines_that_read_it() {
        let held = object(
            "y=x+1\nz=2",
            ports(&["x"], &["y", "z"], None),
            &[("in.x", literal(Value::Null))],
        );
        let Value::Error(failure) = export(&held, "y") else {
            panic!("the line that reads the port fails");
        };
        assert_eq!(failure.error, ErrorCode::Math);
        assert!(failure.message.contains('x'), "the message names the port");
        assert_eq!(export(&held, "z"), Value::Number(2.0));
    }

    /// A port holding anything but a number gives a type error on every export,
    /// because a port is a literal slot and a literal holds whatever an
    /// operator typed.
    #[test]
    fn a_port_holding_something_else_is_a_type_error() {
        let held = object(
            "y=x+1",
            ports(&["x"], &["y"], None),
            &[("in.x", literal(Value::Text("four".to_string())))],
        );
        let Value::Error(failure) = export(&held, "y") else {
            panic!("a port holding text fails");
        };
        assert_eq!(failure.error, ErrorCode::Type);
        assert_eq!(
            failure.message,
            "math: in.x holds something other than a number"
        );
    }

    /// A port the source no longer defines answers with the reason rather than
    /// with nothing, because the slot is still there until a mutation takes it.
    #[test]
    fn a_port_the_source_dropped_says_so() {
        let held = object("y=1", ports(&[], &["y", "gone"], None), &[]);
        let Value::Error(failure) = export(&held, "gone") else {
            panic!("the port that is gone fails");
        };
        assert_eq!(failure.error, ErrorCode::Math);
        assert_eq!(
            failure.message,
            "math: the source no longer defines \"gone\""
        );
    }

    /// A displayed result carries six significant digits, rounded the way
    /// JavaScript rounds a number written to that many and read back.
    #[test]
    fn a_displayed_result_carries_six_digits() {
        let mut exports = BTreeMap::new();
        exports.insert("y".to_string(), Value::Number(1.0 / 3.0));
        assert_eq!(
            math_display_latex(
                "y=1/3",
                MathDisplay::Value,
                Some(&parse_math("y=1/3").expect("the source parses")),
                &exports
            ),
            "y=0.333333"
        );
        // A half that lands on the sixth digit rounds up, and one below it
        // rounds away, which is what writing the digits and reading them back
        // gives.
        assert_eq!(to_value_digits(999_999.5), 1_000_000.0);
        assert_eq!(to_value_digits(1.000_000_5), 1.0);
        assert_eq!(to_value_digits(0.0), 0.0);
    }

    /// The value form names each export, and the both form appends the result
    /// to the line that produced it. An implicit line already carries an equals
    /// sign, so its result arrives after an arrow instead.
    #[test]
    fn the_two_value_forms_read_as_an_equation_does() {
        let source = "\\solve{x}x^2=4";
        let program = parse_math(source).expect("the source parses");
        let mut exports = BTreeMap::new();
        exports.insert("x".to_string(), Value::Number(2.0));
        assert_eq!(
            math_display_latex(source, MathDisplay::Value, Some(&program), &exports),
            "x=2"
        );
        assert_eq!(
            math_display_latex(source, MathDisplay::Both, Some(&program), &exports),
            "\\solve{x}x^2=4\\Rightarrow x=2"
        );
    }

    /// A name of more than one letter reaches the notation with a subscript or
    /// through the operator form, so an export called `x_ans` reads as x with
    /// ans under it rather than as four letters and a low line.
    #[test]
    fn a_name_reaches_the_notation_as_latex_writes_it() {
        assert_eq!(name_as_latex("x"), "x");
        assert_eq!(name_as_latex("x_ans"), "x_{ans}");
        assert_eq!(name_as_latex("speed"), "\\operatorname{speed}");
        assert_eq!(name_as_latex("v_0_1"), "v_{0_1}");
    }

    /// A source with nothing in it measures to a box an operator can still see
    /// and click, rather than to nothing.
    #[test]
    fn an_empty_source_still_has_a_box() {
        let held = object("   ", ports(&[], &[], None), &[]);
        let objects = [held.clone()];
        let read = |address: &Address| {
            held.get_slot(&address.path)
                .map(|slot| slot.value().clone())
        };
        let inputs = SlotComputeInputs {
            read: &read,
            read_range: None,
            objects: &objects,
            measurer: None,
        };
        let slots = math_measured_slots::<()>();
        assert_eq!(
            (slots[0].compute)(&held, &inputs),
            Value::Number(MATH_EMPTY_BOX_WIDTH)
        );
        assert_eq!(
            (slots[1].compute)(&held, &inputs),
            Value::Number(MATH_EMPTY_BOX_HEIGHT)
        );
    }
}
