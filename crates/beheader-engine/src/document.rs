//! Saves a document to JSON and loads it back.
//!
//! This is the Rust side of `src/engine/document.ts`. The shape on disk is a
//! `formatVersion`, the objects, the journal, the camera and the
//! `nextObjectId` counter, and the version is 1. A file carrying any other
//! version is refused rather than read under a guess at what an older shape
//! meant.
//!
//! A derived value never reaches the file. A load runs a whole evaluation pass
//! to build the derived values again, so a schema that gains a derived slot
//! still reads a file written before that slot existed.
//!
//! A load goes through `crate::mutation::mutate` rather than trusting the
//! JSON, so a corrupt file meets the same integrity and cycle checks that a
//! bad command meets. `ports` and `vertex_count` are rebuilt by hand, because
//! each sits beside the slot map rather than inside it.
//!
//! The counter is a non-negative safe integer above every generated `obj_` ID
//! in the current objects and in the creation or deletion entries of the
//! journal, deleted objects included. The largest safe integer is an exhausted
//! counter: it saves and loads, and minting from it is refused, which keeps
//! the last document readable with no ID minted twice.
//!
//! Two places part from the TypeScript loader, both recorded under `D-007` in
//! `docs/RUST_PORT.md`. An object whose `type` names no schema is refused
//! here, where TypeScript carries the string through: `ObjectType` holds the
//! thirteen types the schema registry declares, and the registry matches on
//! all of them with no arm left over, so a type outside that set has no
//! meaning to give an operator. The journal, by contrast, is held as the raw
//! JSON it arrived as and each entry is read only when a replay reaches it,
//! which is what `crate::journal` does, so a file whose journal TypeScript
//! keeps comes back from a Rust save with that journal unchanged.

use serde_json::{Map, Value as Json};

use crate::formula::ast::{
    FormulaAst, MAX_FORMULA_AST_DEPTH, encode_formula_ast_with, exceeds_max_formula_ast_depth,
    validate_formula_ast_shape,
};
use crate::graph::eval::evaluate;
use crate::measure::Measurer;
use crate::model::{
    GraphObject, GraphObjectPorts, ObjectType, Slot, SlotMap, Value, is_illegal_number,
    is_legal_port_name, slot_key,
};
use crate::mutation::{Operation, mutate};
use crate::primitives::schema::{get_object_schema, resolve_derived_slots};
use crate::wire::decode_value;

/// The one version this build reads and writes.
pub const FORMAT_VERSION: u64 = 1;

/// Where the canvas is looking.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct CameraState {
    pub x: f64,
    pub y: f64,
    pub zoom: f64,
}

const DEFAULT_CAMERA: CameraState = CameraState {
    x: 0.0,
    y: 0.0,
    zoom: 1.0,
};

/// A whole document: the objects, the history behind them, and the two pieces
/// of state that sit outside the graph.
///
/// The journal holds the JSON each entry arrived as rather than a decoded
/// batch. A loaded journal is structurally permissive in TypeScript, which a
/// decode at load time would narrow, so the entries travel as they are and
/// `crate::journal` reads one when a replay reaches it.
#[derive(Clone, Debug, PartialEq)]
pub struct Document {
    pub format_version: u64,
    pub next_object_id: f64,
    pub objects: Vec<GraphObject<FormulaAst>>,
    pub journal: Vec<Json>,
    pub camera: CameraState,
}

pub fn create_empty_document() -> Document {
    Document {
        format_version: FORMAT_VERSION,
        next_object_id: 1.0,
        objects: Vec::new(),
        journal: Vec::new(),
        camera: DEFAULT_CAMERA,
    }
}

/// The ID minted, and the counter that follows it.
#[derive(Clone, Debug, PartialEq)]
pub struct MintedObjectId {
    pub id: String,
    pub next_object_id: f64,
}

/// The largest integer a binary64 counts one at a time, which is where the
/// counter stops.
const MAX_SAFE_INTEGER: f64 = 9_007_199_254_740_991.0;

fn is_safe_integer(number: f64) -> bool {
    number.fract() == 0.0 && number.is_finite() && number.abs() <= MAX_SAFE_INTEGER
}

/// Makes the next object ID, or refuses when the counter cannot advance with
/// an ID no earlier object took.
pub fn mint_object_id(document: &Document) -> Result<MintedObjectId, String> {
    let counter = document.next_object_id;
    if !is_safe_integer(counter)
        || counter < 0.0
        || (counter == 0.0 && counter.is_sign_negative())
        || counter >= MAX_SAFE_INTEGER
    {
        return Err("the document has exhausted its safe object ID counter".to_string());
    }
    Ok(MintedObjectId {
        id: format!("obj_{}", crate::number::to_javascript_text(counter)),
        next_object_id: counter + 1.0,
    })
}

/// Turns a document into the JSON a file holds. A derived value never reaches
/// it, because a load computes every derived value again.
pub fn serialize_document(document: &Document) -> Json {
    let mut object = Map::new();
    object.insert(
        "formatVersion".to_string(),
        Json::Number(document.format_version.into()),
    );
    object.insert(
        "nextObjectId".to_string(),
        plain_number(document.next_object_id),
    );
    object.insert(
        "objects".to_string(),
        Json::Array(document.objects.iter().map(serialize_object).collect()),
    );
    object.insert("journal".to_string(), Json::Array(document.journal.clone()));
    object.insert("camera".to_string(), encode_camera(document.camera));
    Json::Object(object)
}

/// A number as ordinary JSON. A document holds no number that ordinary JSON
/// cannot carry, because every one of those is refused at the boundary, so the
/// tagged form of `crate::wire` has no place in a file.
///
/// A whole number is written as an integer, which is the spelling
/// `JSON.stringify` gives it. `serde_json` writes a whole `f64` with a
/// fractional part, so a counter of 3 would reach the file as `3.0` and a file
/// written by the two engines would differ everywhere a whole number stands.
fn plain_number(number: f64) -> Json {
    if number.fract() == 0.0 && number.abs() <= MAX_SAFE_INTEGER {
        return Json::Number((number as i64).into());
    }
    serde_json::Number::from_f64(number)
        .map(Json::Number)
        .unwrap_or(Json::Null)
}

/// A stored value as a file holds it. It parts from `crate::wire::encode_value`
/// in writing every number through `plain_number`, because the tagged form
/// belongs to the fixtures and a whole number belongs in a file without a
/// fractional part.
fn encode_document_value(value: &Value) -> Json {
    let point = |point: &crate::model::Point| {
        let mut object = Map::new();
        object.insert("x".to_string(), plain_number(point.x));
        object.insert("y".to_string(), plain_number(point.y));
        Json::Object(object)
    };
    match value {
        Value::Null => Json::Null,
        Value::Boolean(boolean) => Json::Bool(*boolean),
        Value::Number(number) => plain_number(*number),
        Value::Text(text) => Json::String(text.clone()),
        Value::Point(held) => point(held),
        Value::Points(points) => Json::Array(points.iter().map(point).collect()),
        Value::Error(error) => {
            let mut object = Map::new();
            object.insert(
                "error".to_string(),
                Json::String(error.error.as_str().to_string()),
            );
            object.insert("message".to_string(), Json::String(error.message.clone()));
            Json::Object(object)
        }
    }
}

fn encode_camera(camera: CameraState) -> Json {
    let mut object = Map::new();
    object.insert("x".to_string(), plain_number(camera.x));
    object.insert("y".to_string(), plain_number(camera.y));
    object.insert("zoom".to_string(), plain_number(camera.zoom));
    Json::Object(object)
}

fn serialize_object(object: &GraphObject<FormulaAst>) -> Json {
    let mut slots = Map::new();
    for (key, slot) in object.slots.iter() {
        slots.insert(key.to_string(), serialize_slot(slot));
    }

    let mut written = Map::new();
    written.insert("id".to_string(), Json::String(object.id.clone()));
    written.insert("name".to_string(), Json::String(object.name.clone()));
    written.insert(
        "type".to_string(),
        Json::String(object.object_type.as_str().to_string()),
    );
    written.insert("slots".to_string(), Json::Object(slots));
    if let Some(ports) = &object.ports {
        written.insert("ports".to_string(), encode_ports(ports));
    }
    if let Some(vertex_count) = object.vertex_count {
        written.insert("vertexCount".to_string(), plain_number(vertex_count));
    }
    if let Some(target) = &object.target {
        written.insert(
            "target".to_string(),
            crate::formula::ast::encode_address(target),
        );
    }
    Json::Object(written)
}

fn encode_ports(ports: &GraphObjectPorts) -> Json {
    let names = |list: &[String]| {
        Json::Array(
            list.iter()
                .map(|name| Json::String(name.clone()))
                .collect::<Vec<_>>(),
        )
    };
    let mut object = Map::new();
    object.insert("in".to_string(), names(&ports.input));
    object.insert("out".to_string(), names(&ports.output));
    if let Some(seed) = &ports.seed {
        object.insert("seed".to_string(), names(seed));
    }
    Json::Object(object)
}

fn serialize_slot(slot: &Slot<FormulaAst>) -> Json {
    let mut object = Map::new();
    match slot {
        Slot::Literal { value } => {
            object.insert("kind".to_string(), Json::String("literal".to_string()));
            object.insert("value".to_string(), encode_document_value(value));
        }
        Slot::Formula { ast, value } => {
            object.insert("kind".to_string(), Json::String("formula".to_string()));
            object.insert(
                "ast".to_string(),
                encode_formula_ast_with(ast, &plain_number),
            );
            object.insert("value".to_string(), encode_document_value(value));
        }
        Slot::Derived { .. } => {
            object.insert("kind".to_string(), Json::String("derived".to_string()));
        }
    }
    Json::Object(object)
}

/// A document as the text a file holds.
pub fn save_document(document: &Document) -> String {
    serialize_document(document).to_string()
}

/// Reads a document from the text of a file.
pub fn load_document(json: &str, measurer: Option<&dyn Measurer>) -> Result<Document, String> {
    let parsed: Json = serde_json::from_str(json)
        .map_err(|error| format!("document is not valid JSON: {error}"))?;
    deserialize_document(&parsed, measurer)
}

/// A member as a refusal quotes it. A member that is absent reads as
/// `undefined`, which is what `JSON.stringify` of a missing one gives the
/// TypeScript message, and a member that is present reads as its JSON.
fn describe_json_member(member: Option<&Json>) -> String {
    match member {
        None => "undefined".to_string(),
        Some(json) => json.to_string(),
    }
}

/// What a piece of JSON is, in the words a refusal uses.
fn describe_type(json: &Json) -> &'static str {
    match json {
        Json::Null => "null",
        Json::Array(_) => "an array",
        Json::Bool(_) => "a boolean",
        Json::Number(_) => "a number",
        Json::String(_) => "a string",
        Json::Object(_) => "an object",
    }
}

/// Whether any number anywhere under a piece of JSON is one a document cannot
/// hold. The walk carries its own list because a loaded journal nests as deep
/// as its writer nested it, which is deeper than a recursive walk would reach.
fn raw_contains_illegal_number(raw: &Json) -> bool {
    let mut pending = vec![raw];
    while let Some(json) = pending.pop() {
        match json {
            Json::Number(number) => {
                // A non-finite number has no JSON spelling, so one can only
                // arrive as a literal the parser read as infinity.
                match number.as_f64() {
                    Some(value) if is_illegal_number(value) => return true,
                    None => return true,
                    Some(_) => {}
                }
            }
            Json::Array(items) => pending.extend(items.iter()),
            Json::Object(members) => pending.extend(members.values()),
            _ => {}
        }
    }
    false
}

/// Whether the counter would mint an ID that an object or a journal entry has
/// already taken. A creation entry reserves its ID even after the object it
/// made has been deleted, so a deleted ID is never handed out again.
fn counter_reuses_id(counter: f64, objects: &[GraphObject<FormulaAst>], journal: &[Json]) -> bool {
    let mut ids: Vec<&str> = objects.iter().map(|object| object.id.as_str()).collect();
    for entry in journal {
        let Some(operations) = entry.get("operations").and_then(Json::as_array) else {
            continue;
        };
        for operation in operations {
            match operation.get("kind").and_then(Json::as_str) {
                Some("createObject") => {
                    if let Some(id) = operation
                        .get("object")
                        .and_then(|object| object.get("id"))
                        .and_then(Json::as_str)
                    {
                        ids.push(id);
                    }
                }
                Some("deleteObject") => {
                    if let Some(id) = operation.get("objectId").and_then(Json::as_str) {
                        ids.push(id);
                    }
                }
                _ => {}
            }
        }
    }
    ids.iter().any(|id| match generated_id_number(id) {
        // The comparison is on the digits rather than on a number, because an
        // ID past the safe range rounds to the counter it should sit above.
        Some(digits) => digits_at_least(digits, counter),
        None => false,
    })
}

/// The digits of a generated ID, for an ID that was generated. Only `obj_`
/// followed by a decimal integer with no leading zero reserves a counter
/// value, so a name an operator typed never holds the counter back.
fn generated_id_number(id: &str) -> Option<&str> {
    let digits = id.strip_prefix("obj_")?;
    if digits.is_empty() || !digits.bytes().all(|byte| byte.is_ascii_digit()) {
        return None;
    }
    if digits.len() > 1 && digits.starts_with('0') {
        return None;
    }
    Some(digits)
}

/// Whether the digits of an ID name a number at or above the counter, compared
/// as text so an ID longer than a binary64 counts still compares whole.
fn digits_at_least(digits: &str, counter: f64) -> bool {
    let counter_digits = crate::number::to_javascript_text(counter);
    if !counter_digits.bytes().all(|byte| byte.is_ascii_digit()) {
        return false;
    }
    match digits.len().cmp(&counter_digits.len()) {
        std::cmp::Ordering::Greater => true,
        std::cmp::Ordering::Less => false,
        std::cmp::Ordering::Equal => digits >= counter_digits.as_str(),
    }
}

/// Turns JSON back into a document. It goes through the mutation channel, so a
/// bad file meets the checks a bad command meets.
pub fn deserialize_document(
    raw: &Json,
    measurer: Option<&dyn Measurer>,
) -> Result<Document, String> {
    let Json::Object(members) = raw else {
        return Err(format!(
            "a document must be a JSON object, not {}",
            describe_type(raw)
        ));
    };

    let version = members.get("formatVersion");
    if version.and_then(Json::as_u64) != Some(FORMAT_VERSION) {
        return Err(format!(
            "unsupported document formatVersion {} — this build only reads formatVersion {FORMAT_VERSION}",
            describe_json_member(version)
        ));
    }

    let counter = members
        .get("nextObjectId")
        .and_then(Json::as_f64)
        .filter(|counter| {
            is_safe_integer(*counter) && *counter >= 0.0 && !is_illegal_number(*counter)
        })
        .ok_or_else(|| {
            "nextObjectId must be a non-negative safe integer, and not -0".to_string()
        })?;

    let Some(raw_objects) = members.get("objects").and_then(Json::as_array) else {
        return Err("objects must be an array".to_string());
    };
    let Some(raw_journal) = members.get("journal").and_then(Json::as_array) else {
        return Err("journal must be an array".to_string());
    };
    if raw_contains_illegal_number(&Json::Array(raw_journal.clone())) {
        return Err(
            "journal contains an illegal number (non-finite, or -0), which is not legal document state"
                .to_string(),
        );
    }

    let camera = reconstruct_camera(members.get("camera").unwrap_or(&Json::Null))?;

    let mut reconstructed = Vec::with_capacity(raw_objects.len());
    for (index, raw_object) in raw_objects.iter().enumerate() {
        reconstructed.push(reconstruct_object(raw_object, index)?);
    }

    // The objects go in through createObject so that a file meets the same
    // integrity and cycle checks a command meets, and so that the evaluation
    // pass builds every derived value the file left out.
    let objects = if reconstructed.is_empty() {
        Vec::new()
    } else {
        let operations: Vec<Operation> = reconstructed
            .iter()
            .map(|object| Operation::CreateObject {
                object: Box::new(object.clone()),
            })
            .collect();
        mutate(&[], &operations, &[], measurer)?.objects
    };

    if counter_reuses_id(counter, &reconstructed, raw_journal) {
        return Err(
            "nextObjectId must be greater than every allocated obj_ ID in the objects and journal"
                .to_string(),
        );
    }

    Ok(Document {
        format_version: FORMAT_VERSION,
        next_object_id: counter,
        objects,
        journal: raw_journal.clone(),
        camera,
    })
}

fn reconstruct_camera(raw: &Json) -> Result<CameraState, String> {
    let shape =
        "camera must be an object with numeric x, y, and zoom (see CameraState's doc comment)";
    let Json::Object(members) = raw else {
        return Err(shape.to_string());
    };
    let read = |name: &str| members.get(name).and_then(Json::as_f64);
    let (Some(x), Some(y), Some(zoom)) = (read("x"), read("y"), read("zoom")) else {
        return Err(shape.to_string());
    };
    if is_illegal_number(x) || is_illegal_number(y) || is_illegal_number(zoom) {
        return Err(
            "camera holds an illegal number (non-finite, or -0), which is not legal document state"
                .to_string(),
        );
    }
    Ok(CameraState { x, y, zoom })
}

fn reconstruct_object(raw: &Json, index: usize) -> Result<GraphObject<FormulaAst>, String> {
    let Json::Object(members) = raw else {
        return Err(format!("objects[{index}] must be an object"));
    };
    let text = |name: &str| members.get(name).and_then(Json::as_str);
    let (Some(id), Some(name), Some(type_name)) = (text("id"), text("name"), text("type")) else {
        return Err(format!(
            "objects[{index}] must have a string id, name, and type"
        ));
    };

    // The thirteen types the schema registry declares are the whole set, so a
    // type outside it names no slots and computes no derived value. TypeScript
    // carries the string through; this refuses, under D-007.
    let object_type = ObjectType::parse(type_name).ok_or_else(|| {
        format!("{name}.type is \"{type_name}\", which names no object type this build knows")
    })?;

    let Some(raw_slots) = members.get("slots").and_then(Json::as_object) else {
        return Err(format!("{name}.slots must be an object"));
    };
    let mut slots = SlotMap::new();
    for (key, raw_slot) in raw_slots.iter() {
        slots.insert(key, reconstruct_slot(raw_slot, name, key)?);
    }

    let ports = reconstruct_ports(members.get("ports"), name)?;
    let vertex_count = reconstruct_vertex_count(members.get("vertexCount"), name)?;
    let target = reconstruct_target(members.get("target"), name)?;

    let object = GraphObject {
        id: id.to_string(),
        name: name.to_string(),
        object_type,
        target,
        slots,
        ports,
        vertex_count,
    };
    Ok(GraphObject {
        slots: with_schema_derived_slots(&object),
        ..object
    })
}

fn reconstruct_target(
    raw: Option<&Json>,
    object_name: &str,
) -> Result<Option<crate::address::Address>, String> {
    // A member that is present and null is refused rather than read as
    // absent, because `raw.target !== undefined` in the TypeScript loader
    // sends null into the shape check.
    let Some(raw) = raw else {
        return Ok(None);
    };
    let shape = format!("{object_name}.target must be an address");
    let object_id = raw
        .get("objectId")
        .and_then(Json::as_str)
        .ok_or_else(|| shape.clone())?;
    let parts = raw
        .get("path")
        .and_then(Json::as_array)
        .ok_or_else(|| shape.clone())?;
    let mut path = Vec::with_capacity(parts.len());
    for part in parts {
        path.push(part.as_str().ok_or_else(|| shape.clone())?.to_string());
    }
    Ok(Some(crate::address::Address {
        object_id: object_id.to_string(),
        path,
    }))
}

fn reconstruct_vertex_count(raw: Option<&Json>, object_name: &str) -> Result<Option<f64>, String> {
    let Some(raw) = raw else {
        return Ok(None);
    };
    let count = raw.as_f64().filter(|count| {
        count.fract() == 0.0 && count.is_finite() && *count >= 0.0 && !is_illegal_number(*count)
    });
    count
        .map(Some)
        .ok_or_else(|| format!("{object_name}.vertexCount must be a non-negative integer"))
}

fn reconstruct_ports(
    raw: Option<&Json>,
    object_name: &str,
) -> Result<Option<GraphObjectPorts>, String> {
    let Some(raw) = raw else {
        return Ok(None);
    };
    let shape =
        format!("{object_name}.ports must be an object with array \"in\" and \"out\" fields");
    let Some(members) = raw.as_object() else {
        return Err(shape);
    };
    let (Some(input), Some(output)) = (
        members.get("in").and_then(Json::as_array),
        members.get("out").and_then(Json::as_array),
    ) else {
        return Err(shape);
    };
    let raw_seed = members.get("seed");
    let seed = match raw_seed {
        None => None,
        Some(seed) => Some(seed.as_array().ok_or_else(|| {
            format!("{object_name}.ports.seed must be an array of names where it is present")
        })?),
    };

    let mut families: Vec<(&str, &Vec<Json>)> = vec![("in", input), ("out", output)];
    if let Some(seed) = seed {
        families.push(("seed", seed));
    }
    let mut read = Vec::new();
    for (family, names) in families {
        let mut seen: Vec<&str> = Vec::new();
        for raw_name in names {
            let name = raw_name.as_str().filter(|name| is_legal_port_name(name)).ok_or_else(|| {
                format!(
                    "{object_name}.ports.{family} holds an illegal port name (must contain only letters, digits, and underscore)"
                )
            })?;
            if seen.contains(&name) {
                return Err(format!(
                    "{object_name}.ports.{family} names \"{name}\" more than once"
                ));
            }
            seen.push(name);
        }
        read.push(seen.iter().map(|name| name.to_string()).collect::<Vec<_>>());
    }
    let mut families = read.into_iter();
    Ok(Some(GraphObjectPorts {
        input: families.next().unwrap_or_default(),
        output: families.next().unwrap_or_default(),
        seed: families.next(),
    }))
}

/// The slot map a loaded object carries: the slots the file held, less any
/// derived slot the schema no longer declares, plus an empty one for every
/// derived slot the schema declares that the file did not hold.
fn with_schema_derived_slots(object: &GraphObject<FormulaAst>) -> SlotMap<FormulaAst> {
    let Some(schema) = get_object_schema(object.object_type) else {
        return object.slots.clone();
    };
    let derived = resolve_derived_slots(object, schema.derived_slots);
    let declared: Vec<String> = derived.iter().map(|entry| slot_key(&entry.path)).collect();

    let mut rebuilt = SlotMap::new();
    for (key, slot) in object.slots.iter() {
        if matches!(slot, Slot::Derived { .. }) && !declared.contains(&key.to_string()) {
            continue;
        }
        rebuilt.insert(key, slot.clone());
    }
    for key in declared {
        if rebuilt.get(&key).is_none() {
            rebuilt.insert(key, Slot::Derived { value: Value::Null });
        }
    }
    rebuilt
}

fn reconstruct_slot(raw: &Json, object_name: &str, key: &str) -> Result<Slot<FormulaAst>, String> {
    let Some(members) = raw.as_object() else {
        return Err(format!("{object_name}.{key} must be an object"));
    };
    match members.get("kind").and_then(Json::as_str) {
        Some("literal") => {
            let Some(value) = members.get("value") else {
                return Err(format!(
                    "{object_name}.{key} (literal) is missing its value"
                ));
            };
            Ok(Slot::Literal {
                value: decode_document_value(value)?,
            })
        }
        Some("formula") => {
            let Some(raw_ast) = members.get("ast") else {
                return Err(format!("{object_name}.{key} (formula) is missing its ast"));
            };
            let ast = validate_formula_ast_shape(raw_ast)
                .map_err(|reason| format!("{object_name}.{key} (formula): {reason}"))?;
            if exceeds_max_formula_ast_depth(&ast) {
                return Err(format!(
                    "{object_name}.{key}: formula has more than {MAX_FORMULA_AST_DEPTH} nested operations; split it across cells, or use SUM over a range"
                ));
            }
            let value = match members.get("value") {
                Some(value) => decode_document_value(value)?,
                None => Value::Null,
            };
            Ok(Slot::Formula { ast, value })
        }
        Some("derived") => Ok(Slot::Derived { value: Value::Null }),
        _ => Err(format!(
            "{object_name}.{key} has an unrecognised slot kind {}",
            describe_json_member(members.get("kind"))
        )),
    }
}

/// A stored value, read as the plain JSON a file holds rather than as the
/// tagged form the fixtures carry. The refusals that a value in a file has to
/// meet are the ones `mutate` runs after the load, so this reads the shape and
/// leaves the judgment there.
fn decode_document_value(raw: &Json) -> Result<Value, String> {
    decode_value(raw).map_err(|error| error.message)
}

/// The objects a document holds, with every derived value computed again. A
/// load already runs this through `mutate`; a caller that has built a document
/// some other way uses this to bring the derived values up to date.
pub fn evaluate_document(
    document: &Document,
    measurer: Option<&dyn Measurer>,
) -> Vec<GraphObject<FormulaAst>> {
    let edges = crate::mutation::derive_edges(&document.objects);
    evaluate(&document.objects, &edges, measurer)
}

#[cfg(test)]
mod tests {
    use super::{
        CameraState, Document, FORMAT_VERSION, MintedObjectId, create_empty_document,
        deserialize_document, load_document, mint_object_id, save_document,
    };
    use serde_json::{Value as Json, json};

    fn value_document() -> Json {
        json!({
            "formatVersion": 1,
            "nextObjectId": 2,
            "camera": { "x": 0, "y": 0, "zoom": 1 },
            "journal": [],
            "objects": [{
                "id": "obj_1",
                "name": "w",
                "type": "value",
                "slots": { "value": { "kind": "literal", "value": 3 } },
            }],
        })
    }

    /// An empty document starts at the version and the counter a first mint
    /// reads, which is what `createEmptyDocument` promises its caller.
    #[test]
    fn an_empty_document_starts_where_the_first_mint_reads() {
        let document = create_empty_document();
        assert_eq!(document.format_version, FORMAT_VERSION);
        assert_eq!(document.next_object_id, 1.0);
        assert!(document.objects.is_empty());
        assert!(document.journal.is_empty());
        assert_eq!(
            document.camera,
            CameraState {
                x: 0.0,
                y: 0.0,
                zoom: 1.0
            }
        );
        assert_eq!(
            mint_object_id(&document),
            Ok(MintedObjectId {
                id: "obj_1".to_string(),
                next_object_id: 2.0,
            })
        );
    }

    /// A whole number reaches the file as an integer. `serde_json` writes a
    /// whole `f64` with a fractional part, which would put `3.0` where the
    /// TypeScript engine writes `3` and make the two engines' files differ
    /// everywhere a whole number stands.
    #[test]
    fn a_whole_number_is_written_without_a_fractional_part() {
        let document = deserialize_document(&value_document(), None).expect("the document loads");
        let text = save_document(&document);
        assert!(
            text.contains("\"nextObjectId\":2,"),
            "the counter is written as an integer: {text}"
        );
        assert!(
            text.contains("\"value\":3"),
            "a whole literal is written as an integer: {text}"
        );
        assert!(!text.contains(".0"), "no number carries a bare .0: {text}");
    }

    /// A derived value never reaches the file, because a load computes every
    /// one again and a file written before a schema gained a slot still reads.
    #[test]
    fn a_saved_file_carries_no_derived_value() {
        let rect = json!({
            "formatVersion": 1,
            "nextObjectId": 2,
            "camera": { "x": 0, "y": 0, "zoom": 1 },
            "journal": [],
            "objects": [{
                "id": "obj_1",
                "name": "box",
                "type": "rect",
                "slots": {
                    "origin.x": { "kind": "literal", "value": 0 },
                    "origin.y": { "kind": "literal", "value": 0 },
                    "width": { "kind": "literal", "value": 4 },
                    "height": { "kind": "literal", "value": 3 },
                },
            }],
        });
        let document = deserialize_document(&rect, None).expect("the document loads");
        let area = document.objects[0]
            .get_slot(&["area".to_string()])
            .expect("the schema declares an area");
        assert_eq!(area.value(), &crate::model::Value::Number(12.0));

        let text = save_document(&document);
        assert!(
            text.contains("{\"kind\":\"derived\"}"),
            "a derived slot is written as its kind alone: {text}"
        );
        assert!(
            !text.contains("\"kind\":\"derived\",\"value\""),
            "no derived slot carries a value: {text}"
        );
    }

    /// An object whose type names no schema is refused, where the TypeScript
    /// loader carries the string through. `ObjectType` holds the thirteen
    /// types the registry declares, and a type outside that set has no slots
    /// to name and no derived value to compute. `D-007` records the choice.
    #[test]
    fn an_object_type_no_schema_declares_is_refused() {
        let mut raw = value_document();
        raw["objects"][0]["type"] = json!("nonsense");
        assert_eq!(
            deserialize_document(&raw, None),
            Err("w.type is \"nonsense\", which names no object type this build knows".to_string())
        );
    }

    /// A file whose text is not JSON is refused with the reason the parser
    /// gives. The two engines part on that reason, because each reads its own
    /// JSON parser's wording, and `D-007` records that as well.
    #[test]
    fn text_that_is_not_json_is_refused_with_the_parsers_reason() {
        let refusal = load_document("{oh no", None).expect_err("the text is not JSON");
        assert!(
            refusal.starts_with("document is not valid JSON: "),
            "the refusal names the parser's reason: {refusal}"
        );
    }

    /// A number JSON cannot spell back is refused before it reaches a slot.
    /// The TypeScript parser reads `1e999` as infinity and the document
    /// decoder refuses it there; `serde_json` refuses the literal itself, so
    /// the two engines refuse the same file with different wording.
    #[test]
    fn a_literal_past_the_range_of_a_binary64_is_refused() {
        let refusal = load_document(
            "{\"formatVersion\":1,\"nextObjectId\":1,\"objects\":[],\"camera\":{\"x\":0,\"y\":0,\"zoom\":1},\"journal\":[{\"operations\":[{\"kind\":\"setSlot\",\"slot\":{\"kind\":\"literal\",\"value\":1e999}}]}]}",
            None,
        )
        .expect_err("the literal is out of range");
        assert!(
            refusal.starts_with("document is not valid JSON: "),
            "the parser refuses the literal: {refusal}"
        );
    }

    /// The counter stops at the largest safe integer rather than minting an ID
    /// a later one could repeat, and the document it stops on still saves and
    /// loads.
    #[test]
    fn an_exhausted_counter_still_round_trips() {
        let mut raw = value_document();
        raw["nextObjectId"] = json!(9_007_199_254_740_991u64);
        let document = deserialize_document(&raw, None).expect("the document loads");
        assert_eq!(
            mint_object_id(&document),
            Err("the document has exhausted its safe object ID counter".to_string())
        );
        let again = load_document(&save_document(&document), None).expect("it loads again");
        assert_eq!(again.next_object_id, 9_007_199_254_740_991.0);
    }

    /// An ID longer than a binary64 counts is compared by its digits. Read as
    /// a number it would round to the counter it has to sit above, and the
    /// file would load with a counter that mints an ID an object already has.
    #[test]
    fn an_id_past_the_safe_range_is_compared_by_its_digits() {
        let mut raw = value_document();
        raw["objects"][0]["id"] = json!("obj_9007199254740993");
        raw["nextObjectId"] = json!(9_007_199_254_740_991u64);
        assert_eq!(
            deserialize_document(&raw, None),
            Err(
                "nextObjectId must be greater than every allocated obj_ ID in the objects and journal"
                    .to_string()
            )
        );
    }

    /// A journal reaches a save as the JSON it arrived as. A loaded journal is
    /// permissive by design, so a file the TypeScript engine keeps comes back
    /// from a Rust save with the same entries.
    #[test]
    fn a_journal_that_holds_no_batch_survives_a_save() {
        let mut raw = value_document();
        raw["journal"] = json!(["garbage", 42, null]);
        let document = deserialize_document(&raw, None).expect("the document loads");
        assert_eq!(
            document.journal,
            vec![json!("garbage"), json!(42), Json::Null]
        );
        let again = load_document(&save_document(&document), None).expect("it loads again");
        assert_eq!(again.journal, document.journal);
    }

    /// The slots come back in the order the file listed them, because slot
    /// order settles which of two slots reports a cycle first and what order
    /// completion offers them in.
    #[test]
    fn the_slots_of_a_loaded_object_keep_the_order_the_file_listed() {
        let raw = json!({
            "formatVersion": 1,
            "nextObjectId": 2,
            "camera": { "x": 0, "y": 0, "zoom": 1 },
            "journal": [],
            "objects": [{
                "id": "obj_1",
                "name": "box",
                "type": "rect",
                "slots": {
                    "width": { "kind": "literal", "value": 4 },
                    "area": { "kind": "derived" },
                    "origin.x": { "kind": "literal", "value": 0 },
                    "origin.y": { "kind": "literal", "value": 0 },
                    "height": { "kind": "literal", "value": 3 },
                },
            }],
        });
        let document = deserialize_document(&raw, None).expect("the document loads");
        let keys: Vec<&str> = document.objects[0].slots.keys().collect();
        assert_eq!(
            &keys[..5],
            &["width", "area", "origin.x", "origin.y", "height"],
            "the five the file listed keep their order, and the schema's rest follow"
        );
    }

    /// A document with no object skips the mutation channel, because a batch
    /// with no operation is one `mutate` refuses.
    #[test]
    fn a_document_with_no_object_loads() {
        let empty = json!({
            "formatVersion": 1,
            "nextObjectId": 1,
            "camera": { "x": 0, "y": 0, "zoom": 1 },
            "journal": [],
            "objects": [],
        });
        assert_eq!(
            deserialize_document(&empty, None),
            Ok(Document {
                format_version: 1,
                next_object_id: 1.0,
                objects: Vec::new(),
                journal: Vec::new(),
                camera: CameraState {
                    x: 0.0,
                    y: 0.0,
                    zoom: 1.0
                },
            })
        );
    }
}
