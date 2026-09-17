//! The document variable and the copy of one that sits on the canvas. Section
//! 13 of the spec describes both.
//!
//! A variable is one slot at the top of a singleton object named `doc`, which
//! has no origin and never draws. The slot is an ordinary graph slot, so a
//! variable holds a literal or a formula and takes part in dependency
//! derivation, the cycle check and the journal without a case of its own.
//!
//! A copy is a second object that carries a position and an address and nothing
//! else. Its value, its width and its height are all derived, so two copies of
//! one variable are two objects reading one slot and neither holds a value that
//! could drift from the other. Deleting a copy deletes a drawing, and the
//! variable it read is untouched.
//!
//! A name a variable may not take is refused here rather than at each caller,
//! because every one of these collisions would otherwise be silent: a reserved
//! word of the formula language would shadow the word, a name of the `A1` form
//! would be read as a cell of the enclosing table, and a name an object carries
//! would make a bare reference ambiguous.
//!
//! The port of `src/engine/primitives/doc.ts`.

use crate::address::{Address, is_cell_reference_form, is_valid_name};
use crate::formula::functions::get_function_entry;
use crate::formula::lexer::RESERVED_WORDS;
use crate::measure::TextStyle;
use crate::model::{ErrorCode, ErrorValue, GraphObject, ObjectType, Point, Value};
use crate::number::to_javascript_text;
use crate::primitives::schema::{DerivedSlotDependencies, DerivedSlotSchema, SlotComputeInputs};

/// A copy draws in a monospaced font, so the name, the equals sign and the
/// value line up down a column of copies instead of drifting with the width of
/// whatever glyphs each value happens to use.
pub fn docref_style() -> TextStyle {
    TextStyle {
        font: "monospace".to_string(),
        font_size: 16.0,
        line_height: 20.0,
    }
}

/// The names JavaScript already carries on the prototype of a plain object. A
/// variable becomes a key of such an object in the TypeScript engine, so one of
/// these would read as a slot that nobody wrote. The Rust engine holds its
/// slots in a list and has no such prototype, and it refuses the same twelve
/// names anyway, because the two engines share one document and a name one of
/// them refuses cannot be allowed to exist in a file the other one wrote.
const OBJECT_PROTOTYPE_NAMES: [&str; 12] = [
    "constructor",
    "__defineGetter__",
    "__defineSetter__",
    "hasOwnProperty",
    "__lookupGetter__",
    "__lookupSetter__",
    "isPrototypeOf",
    "propertyIsEnumerable",
    "toString",
    "valueOf",
    "__proto__",
    "toLocaleString",
];

/// The reason a name cannot become a variable, or nothing when it can.
/// `exclude` names the variable being renamed, which may keep its own spelling.
///
/// The comparisons ignore case, because a bare name resolves without regard to
/// case and two variables that differed only in case would resolve to whichever
/// came first.
pub fn document_variable_name_problem<A>(
    name: &str,
    objects: &[GraphObject<A>],
    exclude: Option<&str>,
) -> Option<String> {
    if !is_valid_name(name) {
        return Some(format!("\"{name}\" is not a valid variable name"));
    }
    let folded = name.to_lowercase();
    if OBJECT_PROTOTYPE_NAMES
        .iter()
        .any(|key| key.to_lowercase() == folded)
    {
        return Some(format!("\"{name}\" is reserved for object storage"));
    }
    let shouted = name.to_uppercase();
    if RESERVED_WORDS.contains(&shouted.as_str()) || get_function_entry(&shouted).is_some() {
        return Some(format!("\"{name}\" is a reserved formula word"));
    }
    if is_cell_reference_form(name) {
        return Some(format!("\"{name}\" looks like a table cell"));
    }
    if folded == "doc" {
        return Some(format!(
            "the name \"{name}\" is already in use by an object"
        ));
    }
    if objects
        .iter()
        .any(|object| object.object_type != ObjectType::Doc && object.name.to_lowercase() == folded)
    {
        return Some(format!(
            "the name \"{name}\" is already in use by an object"
        ));
    }
    let held = objects
        .iter()
        .find(|object| object.object_type == ObjectType::Doc);
    if let Some(doc) = held
        && doc
            .slots
            .keys()
            .any(|key| Some(key) != exclude && key.to_lowercase() == folded)
    {
        return Some(format!("the variable \"{name}\" already exists"));
    }
    None
}

/// The line a copy draws, as `name = value`.
///
/// A value with a line break or a tab in it is drawn with that character
/// escaped, because the canvas draws one line and an unescaped break would run
/// the rest of the value off the end of the box the measurement produced. An
/// error draws as its code alone, so a long message cannot stretch the box past
/// whatever sits beside it.
pub fn docref_label(target: Option<&Address>, value: &Value) -> String {
    let shown = match value {
        Value::Null => "nothing".to_string(),
        Value::Error(failure) => failure.error.as_str().to_string(),
        Value::Point(at) => json_point(*at),
        Value::Points(points) => {
            let drawn: Vec<String> = points.iter().map(|at| json_point(*at)).collect();
            format!("[{}]", drawn.join(","))
        }
        Value::Number(number) => escape_line_breaks(&to_javascript_text(*number)),
        Value::Boolean(boolean) => escape_line_breaks(if *boolean { "true" } else { "false" }),
        Value::Text(text) => escape_line_breaks(text),
    };
    let named = target
        .and_then(|address| address.path.first())
        .map_or("?", String::as_str);
    format!("{named} = {shown}")
}

/// A point as `JSON.stringify` writes one: the two members in the order a point
/// literal declares them, with a number that is not finite written as null
/// because JSON has no spelling for one.
fn json_point(at: Point) -> String {
    format!(
        "{{\"x\":{},\"y\":{}}}",
        json_number(at.x),
        json_number(at.y)
    )
}

fn json_number(number: f64) -> String {
    if number.is_finite() {
        to_javascript_text(number)
    } else {
        "null".to_string()
    }
}

fn escape_line_breaks(text: &str) -> String {
    text.replace('\r', "\\r")
        .replace('\n', "\\n")
        .replace('\t', "\\t")
}

fn measure_error(message: &str) -> Value {
    Value::Error(ErrorValue {
        error: ErrorCode::Measure,
        message: message.to_string(),
    })
}

fn value_path() -> Vec<String> {
    vec!["value".to_string()]
}

/// The three derived slots of a copy.
///
/// `value` depends on whatever address the copy carries, so the dependency is
/// dynamic: a copy that has lost its target declares no dependency rather than
/// one that cannot resolve. The two measured slots depend on `value` alone, so a
/// copy resizes when the variable moves.
///
/// Measurement goes through the injected measurer of rule 1 rather than through
/// a canvas, and a pass with no real measurer gives a measurement error instead
/// of a guess, so a headless evaluation cannot leave a box that a browser would
/// disagree with.
pub fn docref_derived_slots<A: 'static>() -> Vec<DerivedSlotSchema<A>> {
    let mut slots = vec![DerivedSlotSchema {
        path: value_path(),
        dependencies: DerivedSlotDependencies::Dynamic(Box::new(|object, _objects| {
            object
                .target
                .as_ref()
                .map(|target| vec![target.clone()])
                .unwrap_or_default()
        })),
        compute: Box::new(
            |object, inputs: &SlotComputeInputs<A>| match &object.target {
                None => Value::Error(ErrorValue {
                    error: ErrorCode::Ref,
                    message: "copy has no target".to_string(),
                }),
                Some(target) => (inputs.read)(target).unwrap_or(Value::Null),
            },
        ),
    }];
    for wanted in [Measured::Width, Measured::Height] {
        slots.push(DerivedSlotSchema {
            path: vec![wanted.slot_name().to_string()],
            dependencies: DerivedSlotDependencies::Static(vec![value_path()]),
            compute: Box::new(move |object, inputs: &SlotComputeInputs<A>| {
                let Some(measurer) = inputs.real_measurer() else {
                    return measure_error("variable copy needs text measurement");
                };
                let held = inputs.at(object, &value_path()).unwrap_or(Value::Null);
                let label = docref_label(object.target.as_ref(), &held);
                // A measurer that fails is a fault in the host rather than in
                // the document, and an error value leaves the rest of the graph
                // evaluating.
                let Ok(size) = measurer.measure(&label, &docref_style(), None) else {
                    return measure_error("variable copy could not be measured");
                };
                let dimension = match wanted {
                    Measured::Width => size.width,
                    Measured::Height => size.height,
                };
                if dimension.is_finite() && dimension >= 0.0 {
                    Value::Number(dimension)
                } else {
                    measure_error("variable copy measurement is invalid")
                }
            }),
        });
    }
    slots
}

/// Which of the two sizes a measured slot carries.
#[derive(Clone, Copy)]
enum Measured {
    Width,
    Height,
}

impl Measured {
    fn slot_name(self) -> &'static str {
        match self {
            Measured::Width => "measuredWidth",
            Measured::Height => "measuredHeight",
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{Slot, SlotMap};

    fn object(id: &str, name: &str, object_type: ObjectType, slots: &[&str]) -> GraphObject<()> {
        let mut held = SlotMap::new();
        for key in slots {
            held.insert(*key, Slot::Literal { value: Value::Null });
        }
        GraphObject {
            id: id.to_string(),
            name: name.to_string(),
            object_type,
            target: None,
            slots: held,
            ports: None,
            vertex_count: None,
        }
    }

    fn document() -> Vec<GraphObject<()>> {
        vec![
            object("doc", "doc", ObjectType::Doc, &["alpha", "Beta"]),
            object("o1", "wheel", ObjectType::Circle, &[]),
        ]
    }

    fn problem(name: &str) -> Option<String> {
        document_variable_name_problem(name, &document(), None)
    }

    /// The seven reasons a name is refused, each in the order the checks run,
    /// so a name that trips two of them reports the first.
    #[test]
    fn a_name_is_refused_for_the_first_reason_it_meets() {
        assert_eq!(
            problem("1abc"),
            Some("\"1abc\" is not a valid variable name".to_string())
        );
        assert_eq!(
            problem("toString"),
            Some("\"toString\" is reserved for object storage".to_string())
        );
        assert_eq!(
            problem("SUM"),
            Some("\"SUM\" is a reserved formula word".to_string())
        );
        assert_eq!(
            problem("A1"),
            Some("\"A1\" looks like a table cell".to_string())
        );
        assert_eq!(
            problem("doc"),
            Some("the name \"doc\" is already in use by an object".to_string())
        );
        assert_eq!(
            problem("wheel"),
            Some("the name \"wheel\" is already in use by an object".to_string())
        );
        assert_eq!(
            problem("alpha"),
            Some("the variable \"alpha\" already exists".to_string())
        );
        assert_eq!(problem("delta"), None);
    }

    /// A bare reference resolves without regard to case, so two variables that
    /// differed only in case would resolve to whichever came first.
    #[test]
    fn a_name_collides_without_regard_to_case() {
        assert!(problem("ALPHA").is_some());
        assert!(problem("beta").is_some());
        assert!(problem("WHEEL").is_some());
        assert!(problem("Sum").is_some());
    }

    /// A rename may keep its own spelling, and may not take the spelling of
    /// another variable.
    #[test]
    fn a_rename_may_keep_the_name_it_already_has() {
        let objects = document();
        assert_eq!(
            document_variable_name_problem("alpha", &objects, Some("alpha")),
            None
        );
        assert!(document_variable_name_problem("alpha", &objects, Some("Beta")).is_some());
    }

    /// A value with a line break in it is drawn with that character escaped,
    /// because the canvas draws one line and an unescaped break would run the
    /// rest of the value off the end of the box the measurement produced.
    #[test]
    fn a_label_escapes_what_would_run_off_the_box() {
        let target = Address {
            object_id: "doc".to_string(),
            path: vec!["alpha".to_string()],
        };
        let label = |value: Value| docref_label(Some(&target), &value);
        assert_eq!(label(Value::Number(42.0)), "alpha = 42");
        assert_eq!(label(Value::Null), "alpha = nothing");
        assert_eq!(
            label(Value::Text("two\nlines".to_string())),
            "alpha = two\\nlines"
        );
        assert_eq!(
            label(Value::Text("a\ttab\rand a return".to_string())),
            "alpha = a\\ttab\\rand a return"
        );
    }

    /// An error draws as its code alone, so a long message cannot stretch the
    /// box past whatever sits beside it.
    #[test]
    fn a_label_shows_an_error_code_without_its_message() {
        let target = Address {
            object_id: "doc".to_string(),
            path: vec!["alpha".to_string()],
        };
        let failure = Value::Error(ErrorValue {
            error: ErrorCode::Ref,
            message: "a message long enough to stretch the box a good way".to_string(),
        });
        assert_eq!(docref_label(Some(&target), &failure), "alpha = #REF");
    }

    /// A point and a list of points draw as the JSON JavaScript writes for one,
    /// with the two members in the order a point declares them and a number
    /// that is not finite written as null.
    #[test]
    fn a_label_writes_a_point_as_javascript_writes_one() {
        let label = |value: Value| docref_label(None, &value);
        assert_eq!(
            label(Value::Point(Point { x: 1.0, y: 2.0 })),
            "? = {\"x\":1,\"y\":2}"
        );
        assert_eq!(
            label(Value::Point(Point { x: -0.0, y: 1e21 })),
            "? = {\"x\":0,\"y\":1e+21}"
        );
        assert_eq!(
            label(Value::Point(Point {
                x: f64::NAN,
                y: f64::INFINITY
            })),
            "? = {\"x\":null,\"y\":null}"
        );
        assert_eq!(
            label(Value::Points(vec![
                Point { x: 1.0, y: 2.0 },
                Point { x: 3.0, y: 4.0 }
            ])),
            "? = [{\"x\":1,\"y\":2},{\"x\":3,\"y\":4}]"
        );
        assert_eq!(label(Value::Points(Vec::new())), "? = []");
    }

    /// A copy that has lost its target draws a question mark where the name
    /// would go, so the drawing says which copy needs attention.
    #[test]
    fn a_copy_with_no_target_draws_a_question_mark() {
        assert_eq!(docref_label(None, &Value::Number(1.0)), "? = 1");
    }
}
