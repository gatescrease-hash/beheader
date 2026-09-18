//! Reads back the append-only journal that `crate::mutation` writes.
//!
//! This is the Rust side of `src/engine/journal.ts` and of
//! `src/engine/journal-entry.ts`. A replay rebuilds the objects of a document
//! as they stood after any entry, by running those entries over an empty
//! document, one `mutate` call per entry with no snapshots. An undo is a
//! replay through `journal.len() - 1`.
//!
//! An entry that does not replay stops the whole replay and reports its index,
//! rather than handing back a document built halfway.
//!
//! A replay restores objects alone. The counter and the camera never reach the
//! journal, so a caller tracks those two itself. A journal is also only a true
//! history for a document whose every change went through `mutate`, which
//! `journal_is_complete` is the question for: it replays everything and
//! compares what comes out against the objects it was given.
//!
//! A loaded journal holds whatever JSON the file carried, so an entry is read
//! here before it reaches `mutate`. The wording of each refusal is the wording
//! `src/engine/journal-entry.ts` gives, which is written out in both engines
//! rather than left to the runtime: the TypeScript replay used to hand an
//! operator the text of a JavaScript TypeError, which has no Rust counterpart.
//! `D-006` and `D-007` in `docs/RUST_PORT.md` record that choice.

use serde_json::Value as Json;

use crate::address::Address;
use crate::formula::ast::{FormulaAst, validate_formula_ast_shape};
use crate::measure::Measurer;
use crate::model::{GraphObject, ObjectType, Point, Slot, SlotMap, Value};
use crate::mutation::{Operation, PortFamily, mutate};
use crate::primitives::table::TableAxis;
use crate::wire::decode_value;

/// Why a replay stopped, and the entry it stopped at. The index is `-1` for a
/// stopping point that names no entry.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ReplayError {
    pub message: String,
    pub entry: i64,
}

/// The objects as they stood after the first `through` entries. A `through` of
/// 0 gives the empty document every journal starts from.
pub fn replay_journal(
    journal: &[Json],
    through: f64,
    measurer: Option<&dyn Measurer>,
) -> Result<Vec<GraphObject<FormulaAst>>, ReplayError> {
    let length = journal.len();
    let whole = through.fract() == 0.0 && through.is_finite();
    if !whole || through < 0.0 || through > length as f64 {
        return Err(ReplayError {
            message: format!(
                "a replay must stop at a whole entry count from 0 to {length}, got {}",
                crate::number::to_javascript_text(through)
            ),
            entry: -1,
        });
    }

    let mut objects: Vec<GraphObject<FormulaAst>> = Vec::new();
    for (index, entry) in journal.iter().take(through as usize).enumerate() {
        let refuse = |reason: String| ReplayError {
            message: format!("journal entry {index} did not replay: {reason}"),
            entry: index as i64,
        };
        let operations = decode_entry(entry).map_err(&refuse)?;
        objects = mutate(&objects, &operations, &[], measurer)
            .map_err(refuse)?
            .objects;
    }
    Ok(objects)
}

/// True when a whole replay rebuilds exactly the objects given, which is the
/// question an undo asks before it offers to step back.
pub fn journal_is_complete(
    objects: &[GraphObject<FormulaAst>],
    journal: &[Json],
    measurer: Option<&dyn Measurer>,
) -> bool {
    match replay_journal(journal, journal.len() as f64, measurer) {
        Ok(replayed) => replayed == objects,
        Err(_) => false,
    }
}

/// The batch one loaded entry holds, or the reason it holds none.
pub fn decode_entry(entry: &Json) -> Result<Vec<Operation>, String> {
    let Some(operations) = entry.get("operations").and_then(Json::as_array) else {
        return Err("an entry is an object with an \"operations\" array".to_string());
    };
    operations
        .iter()
        .enumerate()
        .map(|(index, operation)| decode_operation(operation, index))
        .collect()
}

/// A member as a refusal quotes it, with a missing one reading as undefined.
fn quote(member: Option<&Json>) -> String {
    match member {
        None => "undefined".to_string(),
        Some(json) => json.to_string(),
    }
}

fn decode_operation(operation: &Json, index: usize) -> Result<Operation, String> {
    let Some(members) = operation.as_object() else {
        return Err(format!("operation {index} is an object"));
    };
    let kind = members.get("kind").and_then(Json::as_str);
    let Some(kind) = kind else {
        return Err(format!(
            "operation {index} has an unrecognised kind {}",
            quote(members.get("kind"))
        ));
    };
    let at = |reason: &str| format!("operation {index} ({kind}) {reason}");

    let text = |member: &str| -> Result<String, String> {
        match operation.get(member).and_then(Json::as_str) {
            Some(text) => Ok(text.to_string()),
            None => Err(at(&format!(
                "has a string \"{member}\", not {}",
                quote(operation.get(member))
            ))),
        }
    };
    let number = |member: &str| -> Result<f64, String> {
        match operation.get(member).and_then(Json::as_f64) {
            Some(number) => Ok(number),
            None => Err(at(&format!(
                "has a number \"{member}\", not {}",
                quote(operation.get(member))
            ))),
        }
    };
    let force = || -> Result<bool, String> {
        match operation.get("force") {
            None => Ok(false),
            Some(Json::Bool(flag)) => Ok(*flag),
            other => Err(at(&format!(
                "has a boolean \"force\" where it has one, not {}",
                quote(other)
            ))),
        }
    };
    let point = |member: &str| decode_point(operation.get(member), member, &at);
    let address = || decode_address(operation.get("address"), &at);

    match kind {
        "createObject" => {
            let Some(object) = operation.get("object").filter(|object| object.is_object()) else {
                return Err(at("has an \"object\""));
            };
            Ok(Operation::CreateObject {
                object: Box::new(decode_object_payload(object, index)?),
            })
        }
        "setSlot" => Ok(Operation::SetSlot {
            address: address()?,
            slot: match operation.get("slot") {
                None => return Err(at("has a \"slot\"")),
                Some(slot) => {
                    decode_slot(Some(slot), &|reason: &str| at(&format!("slot {reason}")))?
                }
            },
        }),
        "clearSlot" => Ok(Operation::ClearSlot {
            address: address()?,
        }),
        "renameVariable" => Ok(Operation::RenameVariable {
            address: address()?,
            name: text("name")?,
        }),
        "renameObject" => Ok(Operation::RenameObject {
            object_id: text("objectId")?,
            name: text("name")?,
        }),
        "deleteObject" => Ok(Operation::DeleteObject {
            object_id: text("objectId")?,
            force: force()?,
        }),
        "explode" => Ok(Operation::Explode {
            object_id: text("objectId")?,
            force: force()?,
        }),
        "insertTableLine" | "deleteTableLine" => {
            let object_id = text("objectId")?;
            let axis = match operation.get("axis").and_then(Json::as_str) {
                Some("row") => TableAxis::Row,
                Some("column") => TableAxis::Column,
                _ => {
                    return Err(at(&format!(
                        "sets \"axis\" to \"row\" or \"column\", not {}",
                        quote(operation.get("axis"))
                    )));
                }
            };
            let line = number("index")?;
            Ok(if kind == "insertTableLine" {
                Operation::InsertTableLine {
                    object_id,
                    axis,
                    index: line,
                }
            } else {
                Operation::DeleteTableLine {
                    object_id,
                    axis,
                    index: line,
                }
            })
        }
        "addPort" | "removePort" => {
            let object_id = text("objectId")?;
            let family = match operation.get("family").and_then(Json::as_str) {
                Some("in") => PortFamily::In,
                Some("out") => PortFamily::Out,
                _ => {
                    return Err(at(&format!(
                        "sets \"family\" to \"in\" or \"out\", not {}",
                        quote(operation.get("family"))
                    )));
                }
            };
            let name = text("name")?;
            Ok(if kind == "addPort" {
                Operation::AddPort {
                    object_id,
                    family,
                    name,
                }
            } else {
                Operation::RemovePort {
                    object_id,
                    family,
                    name,
                }
            })
        }
        "setMathSource" => Ok(Operation::SetMathSource {
            object_id: text("objectId")?,
            source: text("source")?,
        }),
        "addVertex" => Ok(Operation::AddVertex {
            object_id: text("objectId")?,
            point: point("point")?,
        }),
        "deleteVertex" => Ok(Operation::DeleteVertex {
            object_id: text("objectId")?,
            index: number("index")?,
            force: force()?,
        }),
        "splitEdge" => Ok(Operation::SplitEdge {
            object_id: text("objectId")?,
            index: number("index")?,
            point: point("point")?,
        }),
        _ => Err(format!(
            "operation {index} has an unrecognised kind {}",
            quote(members.get("kind"))
        )),
    }
}

fn decode_address(raw: Option<&Json>, at: &dyn Fn(&str) -> String) -> Result<Address, String> {
    let shape = || at("has an \"address\" with a string objectId and a path of strings");
    let Some(raw) = raw else {
        return Err(shape());
    };
    let object_id = raw
        .get("objectId")
        .and_then(Json::as_str)
        .ok_or_else(shape)?;
    let parts = raw.get("path").and_then(Json::as_array).ok_or_else(shape)?;
    let mut path = Vec::with_capacity(parts.len());
    for part in parts {
        path.push(part.as_str().ok_or_else(shape)?.to_string());
    }
    Ok(Address {
        object_id: object_id.to_string(),
        path,
    })
}

fn decode_point(
    raw: Option<&Json>,
    member: &str,
    at: &dyn Fn(&str) -> String,
) -> Result<Point, String> {
    let shape = || at(&format!("has a \"{member}\" with a numeric x and y"));
    let Some(raw) = raw else {
        return Err(shape());
    };
    let (Some(x), Some(y)) = (
        raw.get("x").and_then(Json::as_f64),
        raw.get("y").and_then(Json::as_f64),
    ) else {
        return Err(shape());
    };
    Ok(Point { x, y })
}

/// How a slot falls short, as a phrase its caller puts after the name of the
/// slot. A `setSlot` operation names it "slot", and an object payload names it
/// by its key, so the phrase arrives with no name of its own.
fn decode_slot(
    raw: Option<&Json>,
    at: &dyn Fn(&str) -> String,
) -> Result<Slot<FormulaAst>, String> {
    let Some(raw) = raw.filter(|slot| slot.is_object()) else {
        return Err(at("is an object"));
    };
    match raw.get("kind").and_then(Json::as_str) {
        Some("literal") => {
            let Some(value) = raw.get("value") else {
                return Err(at("is a literal with no value"));
            };
            Ok(Slot::Literal {
                value: decode_stored_value(value)?,
            })
        }
        Some("formula") => {
            let Some(ast) = raw.get("ast") else {
                return Err(at("is a formula with no ast"));
            };
            let ast = validate_formula_ast_shape(ast)
                .map_err(|reason| at(&format!("is a formula whose ast {reason}")))?;
            let value = match raw.get("value") {
                Some(value) => decode_stored_value(value)?,
                None => Value::Null,
            };
            Ok(Slot::Formula { ast, value })
        }
        Some("derived") => Ok(Slot::Derived { value: Value::Null }),
        _ => Err(at(&format!(
            "is of an unrecognised kind {}",
            quote(raw.get("kind"))
        ))),
    }
}

fn decode_stored_value(raw: &Json) -> Result<Value, String> {
    decode_value(raw).map_err(|error| error.message)
}

/// The object a `createObject` entry carries. Every member beside the slot map
/// is read here, because a walk that did not know the shape could not tell a
/// port list from a slot.
fn decode_object_payload(raw: &Json, index: usize) -> Result<GraphObject<FormulaAst>, String> {
    let at = |reason: &str| format!("operation {index} (createObject) object {reason}");
    let text = |member: &str| raw.get(member).and_then(Json::as_str);
    let (Some(id), Some(name), Some(type_name)) = (text("id"), text("name"), text("type")) else {
        return Err(at("has a string id, name, and type"));
    };
    let Some(object_type) = ObjectType::parse(type_name) else {
        return Err(at(&format!(
            "has a type of \"{type_name}\", which names no object type this build knows"
        )));
    };
    let Some(raw_slots) = raw.get("slots").and_then(Json::as_object) else {
        return Err(at("has a \"slots\" object"));
    };

    let mut slots = SlotMap::new();
    for (key, raw_slot) in raw_slots.iter() {
        let slot = decode_slot(Some(raw_slot), &|reason: &str| {
            at(&format!("slot \"{key}\" {reason}"))
        })?;
        slots.insert(key, slot);
    }

    Ok(GraphObject {
        id: id.to_string(),
        name: name.to_string(),
        object_type,
        target: decode_optional_address(raw.get("target"), &at)?,
        slots,
        ports: decode_optional_ports(raw.get("ports"), &at)?,
        vertex_count: match raw.get("vertexCount") {
            None => None,
            Some(count) => Some(count.as_f64().ok_or_else(|| {
                at(&format!(
                    "has a number \"vertexCount\" where it has one, not {}",
                    quote(raw.get("vertexCount"))
                ))
            })?),
        },
    })
}

fn decode_optional_address(
    raw: Option<&Json>,
    at: &dyn Fn(&str) -> String,
) -> Result<Option<Address>, String> {
    let Some(raw) = raw else {
        return Ok(None);
    };
    decode_address(Some(raw), &|_| {
        at("has a \"target\" with a string objectId and a path of strings")
    })
    .map(Some)
}

fn decode_optional_ports(
    raw: Option<&Json>,
    at: &dyn Fn(&str) -> String,
) -> Result<Option<crate::model::GraphObjectPorts>, String> {
    let Some(raw) = raw else {
        return Ok(None);
    };
    let names = |member: &str| -> Option<Vec<String>> {
        Some(
            raw.get(member)?
                .as_array()?
                .iter()
                .filter_map(|name| name.as_str().map(str::to_string))
                .collect(),
        )
    };
    let (Some(input), Some(output)) = (names("in"), names("out")) else {
        return Err(at("has \"ports\" with an \"in\" list and an \"out\" list"));
    };
    Ok(Some(crate::model::GraphObjectPorts {
        input,
        output,
        seed: names("seed"),
    }))
}

#[cfg(test)]
mod tests {
    use super::{decode_entry, journal_is_complete, replay_journal};
    use crate::document::deserialize_document;
    use serde_json::{Value as Json, json};

    /// The three entries a document reached its state through: a value, a rect
    /// that reads nothing, and a write that widens the rect.
    fn built() -> Vec<Json> {
        vec![
            json!({ "operations": [{
                "kind": "createObject",
                "object": {
                    "id": "obj_1", "name": "w", "type": "value",
                    "slots": { "value": { "kind": "literal", "value": 4 } },
                },
            }]}),
            json!({ "operations": [{
                "kind": "createObject",
                "object": {
                    "id": "obj_2", "name": "box", "type": "rect",
                    "slots": {
                        "origin.x": { "kind": "literal", "value": 0 },
                        "origin.y": { "kind": "literal", "value": 0 },
                        "width": { "kind": "literal", "value": 4 },
                        "height": { "kind": "literal", "value": 3 },
                        "vertices": { "kind": "derived" },
                        "centroid.x": { "kind": "derived" },
                        "centroid.y": { "kind": "derived" },
                        "area": { "kind": "derived" },
                        "length": { "kind": "derived" },
                        "bounds.minX": { "kind": "derived" },
                        "bounds.minY": { "kind": "derived" },
                        "bounds.maxX": { "kind": "derived" },
                        "bounds.maxY": { "kind": "derived" },
                    },
                },
            }]}),
            json!({ "operations": [{
                "kind": "setSlot",
                "address": { "objectId": "obj_2", "path": ["width"] },
                "slot": { "kind": "literal", "value": 10 },
            }]}),
        ]
    }

    fn area_of(objects: &[crate::model::GraphObject<crate::formula::ast::FormulaAst>]) -> f64 {
        match objects
            .iter()
            .find(|object| object.name == "box")
            .and_then(|object| object.get_slot(&["area".to_string()]))
            .map(crate::model::Slot::value)
        {
            Some(crate::model::Value::Number(area)) => *area,
            other => panic!("the rect carries an area, and carried {other:?}"),
        }
    }

    /// A whole replay rebuilds the derived values too, so the rect that the
    /// last entry widened answers the area of the width it was widened to.
    #[test]
    fn a_whole_replay_rebuilds_the_derived_values() {
        let objects = replay_journal(&built(), 3.0, None).expect("the journal replays");
        assert_eq!(objects.len(), 2);
        assert_eq!(area_of(&objects), 30.0, "ten wide and three high");
    }

    /// A replay one entry short is what one step of undo reads, so the rect
    /// answers the area it had before the last write.
    #[test]
    fn a_replay_one_entry_short_is_one_step_of_undo() {
        let objects = replay_journal(&built(), 2.0, None).expect("the journal replays");
        assert_eq!(area_of(&objects), 12.0, "four wide and three high");
    }

    /// A replay through zero gives the empty document every journal starts
    /// from, whatever the journal holds after it.
    #[test]
    fn a_replay_through_zero_gives_the_document_every_journal_starts_from() {
        assert!(
            replay_journal(&built(), 0.0, None)
                .expect("a replay through zero reads no entry")
                .is_empty()
        );
    }

    /// A stopping point that is not a whole entry count in range names the
    /// range rather than guessing at what was meant, and it names no entry.
    #[test]
    fn a_stopping_point_outside_the_range_names_the_range() {
        for through in [-1.0, 1.5, 4.0] {
            let refusal = replay_journal(&built(), through, None).expect_err("it is refused");
            assert_eq!(refusal.entry, -1);
            assert!(
                refusal.message.contains("from 0 to 3"),
                "the refusal names the range: {}",
                refusal.message
            );
        }
    }

    /// An entry that does not replay stops the whole replay and names its
    /// index, rather than handing back a document built halfway.
    #[test]
    fn an_entry_that_does_not_replay_names_its_index() {
        let mut journal = built();
        journal[1] = Json::Null;
        let refusal = replay_journal(&journal, 3.0, None).expect_err("entry 1 is not a batch");
        assert_eq!(refusal.entry, 1);
        assert_eq!(
            refusal.message,
            "journal entry 1 did not replay: an entry is an object with an \"operations\" array"
        );
    }

    /// A refusal carries a sentence about the file. The TypeScript replay used
    /// to hand an operator the text of a JavaScript TypeError, which is the
    /// shape of the interpreter rather than the shape of the file.
    #[test]
    fn a_malformed_entry_is_refused_in_the_words_of_the_file() {
        for (entry, expected) in [
            (
                json!({ "operations": [null] }),
                "journal entry 0 did not replay: operation 0 is an object",
            ),
            (
                json!({ "operations": [{ "kind": "createObject" }] }),
                "journal entry 0 did not replay: operation 0 (createObject) has an \"object\"",
            ),
            (
                json!({ "operations": [{ "kind": "frobnicate" }] }),
                "journal entry 0 did not replay: operation 0 has an unrecognised kind \"frobnicate\"",
            ),
        ] {
            let refusal = replay_journal(&[entry], 1.0, None).expect_err("it is refused");
            assert_eq!(refusal.message, expected);
        }
    }

    /// An object whose type names no schema is refused where the payload is
    /// read, which is the same narrowing the document loader makes under
    /// `D-007`.
    #[test]
    fn a_payload_naming_no_object_type_is_refused() {
        let entry = json!({ "operations": [{
            "kind": "createObject",
            "object": { "id": "obj_1", "name": "w", "type": "nonsense", "slots": {} },
        }]});
        let refusal = decode_entry(&entry).expect_err("the type names no schema");
        assert_eq!(
            refusal,
            "operation 0 (createObject) object has a type of \"nonsense\", which names no object type this build knows"
        );
    }

    /// A journal is complete when a whole replay rebuilds exactly the objects
    /// it is given, which is the question an undo asks before it steps back.
    #[test]
    fn completeness_is_whether_the_replay_rebuilds_the_objects_given() {
        let raw = json!({
            "formatVersion": 1,
            "nextObjectId": 3,
            "camera": { "x": 0, "y": 0, "zoom": 1 },
            "journal": built(),
            "objects": [],
        });
        let document = deserialize_document(&raw, None).expect("the document loads");
        let replayed = replay_journal(&document.journal, 3.0, None).expect("it replays");

        assert!(journal_is_complete(&replayed, &document.journal, None));
        assert!(
            !journal_is_complete(&[], &document.journal, None),
            "a journal that rebuilds two objects does not account for none"
        );
        assert!(
            !journal_is_complete(&replayed, &[json!("garbage")], None),
            "a journal that does not replay accounts for nothing"
        );
    }
}
