//! The data model the rest of the crate is built from: the value a slot can
//! hold, the seven error codes, the thirteen object types, and the key that a
//! slot path joins into.
//!
//! This is the Rust side of `src/engine/graph/node.ts`. The formula payload of
//! a slot is generic until the syntax package supplies its AST. That keeps the
//! graph model complete without using unvalidated JSON as a temporary AST.
//!
//! A number is `f64` because the TypeScript graph stores binary64 and two
//! engines that disagree about the width of a number disagree about every
//! value derived from one. The two numbers that the graph refuses, a
//! non-finite one and a negative zero, are still representable here, because
//! the refusal is a check the engine runs rather than a shape the type makes
//! impossible, and a check that cannot be fed its input cannot be tested.

use std::fmt;

use crate::address::Address;

/// A point in world coordinates, which is the value a vertex slot holds.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Point {
    pub x: f64,
    pub y: f64,
}

/// The seven error codes a slot value carries.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ErrorCode {
    Ref,
    Type,
    Div0,
    Parse,
    Script,
    Measure,
    Math,
}

impl ErrorCode {
    /// The spelling the document format and every operator message use.
    pub fn as_str(self) -> &'static str {
        match self {
            ErrorCode::Ref => "#REF",
            ErrorCode::Type => "#TYPE",
            ErrorCode::Div0 => "#DIV0",
            ErrorCode::Parse => "#PARSE",
            ErrorCode::Script => "#SCRIPT",
            ErrorCode::Measure => "#MEASURE",
            ErrorCode::Math => "#MATH",
        }
    }

    pub fn parse(text: &str) -> Option<ErrorCode> {
        match text {
            "#REF" => Some(ErrorCode::Ref),
            "#TYPE" => Some(ErrorCode::Type),
            "#DIV0" => Some(ErrorCode::Div0),
            "#PARSE" => Some(ErrorCode::Parse),
            "#SCRIPT" => Some(ErrorCode::Script),
            "#MEASURE" => Some(ErrorCode::Measure),
            "#MATH" => Some(ErrorCode::Math),
            _ => None,
        }
    }
}

impl fmt::Display for ErrorCode {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.as_str())
    }
}

/// An error that reached a slot, with the wording an operator reads.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ErrorValue {
    pub error: ErrorCode,
    pub message: String,
}

/// What one slot holds.
#[derive(Clone, Debug, PartialEq)]
pub enum Value {
    Number(f64),
    Text(String),
    Boolean(bool),
    Point(Point),
    Points(Vec<Point>),
    Null,
    Error(ErrorValue),
}

/// One addressable value on an object. The formula package supplies `A`, so
/// unvalidated JSON never stands in for an expression tree.
#[derive(Clone, Debug, PartialEq)]
pub enum Slot<A> {
    Literal { value: Value },
    Formula { ast: A, value: Value },
    Derived { value: Value },
}

impl<A> Slot<A> {
    pub fn value(&self) -> &Value {
        match self {
            Slot::Literal { value } | Slot::Formula { value, .. } | Slot::Derived { value } => {
                value
            }
        }
    }
}

/// The slots of an object, in the order they were added.
///
/// `src/engine/graph/node.ts` holds slots in a plain object, and the keys of
/// one come back in insertion order. Three behaviours read that order. The
/// topological pass in `src/engine/graph/eval.ts` seeds its node map from it,
/// so it settles which of two slots that depend on nothing reports a cycle
/// first. The schema in `src/engine/primitives/schema.ts` enumerates slot
/// paths in it for completion. A rename in `src/engine/mutation.ts` rebuilds
/// the map entry by entry, which leaves the renamed slot where it was. A
/// sorted map answers all three differently, so the order a caller writes is
/// the order this gives back.
///
/// Lookup walks the entries, because a document holds few slots per object and
/// the simpler structure is the one whose order is easy to see.
#[derive(Clone, Debug, PartialEq)]
pub struct SlotMap<A> {
    entries: Vec<(String, Slot<A>)>,
}

impl<A> SlotMap<A> {
    pub fn new() -> Self {
        Self {
            entries: Vec::new(),
        }
    }

    /// Adds a slot, or replaces one that the key already names. A replacement
    /// stays where the first write to that key put it, which is what an
    /// assignment to an existing key does in JavaScript.
    pub fn insert(&mut self, key: impl Into<String>, slot: Slot<A>) -> Option<Slot<A>> {
        let key = key.into();
        match self.entries.iter_mut().find(|(held, _)| *held == key) {
            Some((_, held)) => Some(std::mem::replace(held, slot)),
            None => {
                self.entries.push((key, slot));
                None
            }
        }
    }

    pub fn get(&self, key: &str) -> Option<&Slot<A>> {
        self.entries
            .iter()
            .find(|(held, _)| held == key)
            .map(|(_, slot)| slot)
    }

    pub fn keys(&self) -> impl Iterator<Item = &str> {
        self.entries.iter().map(|(key, _)| key.as_str())
    }

    pub fn iter(&self) -> impl Iterator<Item = (&str, &Slot<A>)> {
        self.entries.iter().map(|(key, slot)| (key.as_str(), slot))
    }

    pub fn len(&self) -> usize {
        self.entries.len()
    }

    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }
}

impl<A> Default for SlotMap<A> {
    fn default() -> Self {
        Self::new()
    }
}

impl<A, K: Into<String>> FromIterator<(K, Slot<A>)> for SlotMap<A> {
    fn from_iter<I: IntoIterator<Item = (K, Slot<A>)>>(pairs: I) -> Self {
        let mut map = Self::new();
        for (key, slot) in pairs {
            map.insert(key, slot);
        }
        map
    }
}

/// Ordered port names carried outside the slot set.
#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct GraphObjectPorts {
    pub input: Vec<String>,
    pub output: Vec<String>,
    pub seed: Option<Vec<String>>,
}

/// One object in the dependency graph.
#[derive(Clone, Debug, PartialEq)]
pub struct GraphObject<A> {
    pub id: String,
    pub name: String,
    pub object_type: ObjectType,
    pub target: Option<Address>,
    pub slots: SlotMap<A>,
    pub ports: Option<GraphObjectPorts>,
    pub vertex_count: Option<f64>,
}

impl<A> GraphObject<A> {
    pub fn get_slot(&self, path: &[String]) -> Option<&Slot<A>> {
        self.slots.get(&slot_key(path))
    }
}

impl<A> crate::address::AddressableObject for GraphObject<A> {
    fn id(&self) -> &str {
        &self.id
    }
    fn name(&self) -> &str {
        &self.name
    }
    fn object_type(&self) -> ObjectType {
        self.object_type
    }
    fn slot_keys(&self) -> Vec<&str> {
        self.slots.keys().collect()
    }
}

pub fn resolve_slot<'a, A>(
    address: &Address,
    objects: &'a [GraphObject<A>],
) -> Option<&'a Slot<A>> {
    objects
        .iter()
        .find(|object| object.id == address.object_id)?
        .get_slot(&address.path)
}

pub fn is_legal_port_name(name: &str) -> bool {
    !name.is_empty()
        && name
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || character == '_')
}

/// Whether a value is the error kind, which is the branch that every other
/// test of a value has to take first. An error value is an object with an
/// error member, and a point is an object without one, so a test that reads
/// the coordinates first would read an error as a point with no coordinates.
pub fn is_error_value(value: &Value) -> bool {
    matches!(value, Value::Error(_))
}

/// Whether a number is one the graph refuses to store. A non-finite number has
/// no place in a document that serializes to JSON, and a negative zero
/// compares equal to zero while printing and dividing differently, so both are
/// refused at the boundary rather than left to surprise a reader later.
pub fn is_illegal_number(number: f64) -> bool {
    !number.is_finite() || (number == 0.0 && number.is_sign_negative())
}

/// Whether any number inside a value is one the graph refuses. A text, a
/// boolean, a null and an error carry no number, so each of those is legal
/// whatever it holds.
pub fn has_illegal_number(value: &Value) -> bool {
    match value {
        Value::Number(number) => is_illegal_number(*number),
        Value::Point(point) => is_illegal_number(point.x) || is_illegal_number(point.y),
        Value::Points(points) => points
            .iter()
            .any(|point| is_illegal_number(point.x) || is_illegal_number(point.y)),
        Value::Text(_) | Value::Boolean(_) | Value::Null | Value::Error(_) => false,
    }
}

/// The thirteen kinds of object a document holds.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ObjectType {
    Circle,
    Polygon,
    Polyline,
    Rect,
    Text,
    Table,
    Script,
    Image,
    Math,
    Value,
    Doc,
    Docref,
    Add,
}

impl ObjectType {
    pub fn as_str(self) -> &'static str {
        match self {
            ObjectType::Circle => "circle",
            ObjectType::Polygon => "polygon",
            ObjectType::Polyline => "polyline",
            ObjectType::Rect => "rect",
            ObjectType::Text => "text",
            ObjectType::Table => "table",
            ObjectType::Script => "script",
            ObjectType::Image => "image",
            ObjectType::Math => "math",
            ObjectType::Value => "value",
            ObjectType::Doc => "doc",
            ObjectType::Docref => "docref",
            ObjectType::Add => "add",
        }
    }

    pub fn parse(text: &str) -> Option<ObjectType> {
        match text {
            "circle" => Some(ObjectType::Circle),
            "polygon" => Some(ObjectType::Polygon),
            "polyline" => Some(ObjectType::Polyline),
            "rect" => Some(ObjectType::Rect),
            "text" => Some(ObjectType::Text),
            "table" => Some(ObjectType::Table),
            "script" => Some(ObjectType::Script),
            "image" => Some(ObjectType::Image),
            "math" => Some(ObjectType::Math),
            "value" => Some(ObjectType::Value),
            "doc" => Some(ObjectType::Doc),
            "docref" => Some(ObjectType::Docref),
            "add" => Some(ObjectType::Add),
            _ => None,
        }
    }
}

impl fmt::Display for ObjectType {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.as_str())
    }
}

/// Joins a slot path into the one string an object keys its slots by.
///
/// There is no inverse, and writing one would be a mistake, because a segment
/// can hold the separator and a key cannot be split back into a path
/// reliably. Code that needs a path asks the schema for it.
pub fn slot_key(path: &[String]) -> String {
    path.join(".")
}

#[cfg(test)]
mod tests {
    use super::{
        ErrorCode, ErrorValue, GraphObject, GraphObjectPorts, ObjectType, Point, Slot, SlotMap,
        Value, has_illegal_number, is_error_value, is_illegal_number, is_legal_port_name,
        resolve_slot, slot_key,
    };
    use crate::address::Address;

    fn path(segments: &[&str]) -> Vec<String> {
        segments
            .iter()
            .map(|segment| (*segment).to_string())
            .collect()
    }

    #[test]
    fn joins_a_path_into_a_key() {
        assert_eq!(slot_key(&path(&["vertex", "0", "x"])), "vertex.0.x");
        assert_eq!(slot_key(&path(&["radius"])), "radius");
        assert_eq!(slot_key(&[]), "");
    }

    #[test]
    fn an_object_distinguishes_a_missing_slot_from_a_null_value() {
        let object = GraphObject::<()> {
            id: "obj_1".into(),
            name: "value_1".into(),
            object_type: ObjectType::Value,
            target: None,
            slots: SlotMap::from_iter([("value", Slot::Literal { value: Value::Null })]),
            ports: Some(GraphObjectPorts {
                input: vec!["factor".into()],
                output: vec!["result".into()],
                seed: None,
            }),
            vertex_count: None,
        };
        let address = Address {
            object_id: "obj_1".into(),
            path: path(&["value"]),
        };
        assert_eq!(
            resolve_slot(&address, std::slice::from_ref(&object)).map(Slot::value),
            Some(&Value::Null)
        );
        assert!(object.get_slot(&path(&["missing"])).is_none());
    }

    #[test]
    fn slots_come_back_in_the_order_they_were_written() {
        let mut slots = SlotMap::<()>::new();
        for key in ["y", "x", "vertices"] {
            slots.insert(key, Slot::Literal { value: Value::Null });
        }
        assert_eq!(slots.keys().collect::<Vec<_>>(), ["y", "x", "vertices"]);

        // A second write to a key reports the slot it displaced and leaves the
        // key where the first write put it, so a rewritten slot does not move
        // ahead of one written after it.
        let displaced = slots.insert(
            "y",
            Slot::Literal {
                value: Value::Number(1.0),
            },
        );
        assert_eq!(displaced, Some(Slot::Literal { value: Value::Null }));
        assert_eq!(slots.keys().collect::<Vec<_>>(), ["y", "x", "vertices"]);

        // A rename rebuilds the map entry by entry, which is how
        // `src/engine/mutation.ts` renames a slot, and the new key holds the
        // place the old one had.
        let renamed: SlotMap<()> = slots
            .iter()
            .map(|(key, slot)| (if key == "x" { "width" } else { key }, slot.clone()))
            .collect();
        assert_eq!(
            renamed.keys().collect::<Vec<_>>(),
            ["y", "width", "vertices"]
        );
    }

    #[test]
    fn a_port_name_is_one_nonempty_ascii_path_segment() {
        assert!(is_legal_port_name("speed_2"));
        for bad in ["", "a.b", "my-port", "café"] {
            assert!(!is_legal_port_name(bad));
        }
    }

    #[test]
    fn a_segment_holding_the_separator_makes_a_key_that_cannot_be_split_back() {
        assert_eq!(
            slot_key(&path(&["a.b", "c"])),
            slot_key(&path(&["a", "b.c"]))
        );
    }

    #[test]
    fn refuses_the_two_kinds_of_number_the_graph_cannot_store() {
        assert!(is_illegal_number(f64::NAN));
        assert!(is_illegal_number(f64::INFINITY));
        assert!(is_illegal_number(f64::NEG_INFINITY));
        assert!(is_illegal_number(-0.0));
        assert!(!is_illegal_number(0.0));
        assert!(!is_illegal_number(-1.5));
    }

    #[test]
    fn reads_every_number_inside_a_value() {
        assert!(has_illegal_number(&Value::Number(f64::NAN)));
        assert!(has_illegal_number(&Value::Point(Point { x: 1.0, y: -0.0 })));
        assert!(has_illegal_number(&Value::Points(vec![
            Point { x: 1.0, y: 2.0 },
            Point {
                x: f64::INFINITY,
                y: 2.0
            },
        ])));
        assert!(!has_illegal_number(&Value::Points(vec![])));
        assert!(!has_illegal_number(&Value::Text("NaN".to_string())));
        assert!(!has_illegal_number(&Value::Null));
    }

    #[test]
    fn an_error_value_carries_no_number_to_refuse() {
        let error = Value::Error(ErrorValue {
            error: ErrorCode::Div0,
            message: "division by zero".to_string(),
        });
        assert!(is_error_value(&error));
        assert!(!has_illegal_number(&error));
        assert!(!is_error_value(&Value::Point(Point { x: 0.0, y: 0.0 })));
    }

    #[test]
    fn every_error_code_and_object_type_reads_back_from_its_spelling() {
        for code in [
            ErrorCode::Ref,
            ErrorCode::Type,
            ErrorCode::Div0,
            ErrorCode::Parse,
            ErrorCode::Script,
            ErrorCode::Measure,
            ErrorCode::Math,
        ] {
            assert_eq!(ErrorCode::parse(code.as_str()), Some(code));
        }
        for object_type in [
            ObjectType::Circle,
            ObjectType::Polygon,
            ObjectType::Polyline,
            ObjectType::Rect,
            ObjectType::Text,
            ObjectType::Table,
            ObjectType::Script,
            ObjectType::Image,
            ObjectType::Math,
            ObjectType::Value,
            ObjectType::Doc,
            ObjectType::Docref,
            ObjectType::Add,
        ] {
            assert_eq!(ObjectType::parse(object_type.as_str()), Some(object_type));
        }
        assert_eq!(ErrorCode::parse("#NOPE"), None);
        assert_eq!(ObjectType::parse("sphere"), None);
    }
}
