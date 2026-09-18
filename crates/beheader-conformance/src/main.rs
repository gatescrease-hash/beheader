//! Answers the shared conformance fixtures with the Rust engine.
//!
//! The runner reads every fixture under a directory, answers each case in it,
//! and writes one results file. A matching runner over the TypeScript engine
//! writes the same shape from the same fixtures, and tools/conformance-compare
//! puts the two side by side.
//!
//! A call this crate has no implementation for is answered `unsupported` and
//! never `ok`. Most of the engine is still TypeScript alone, so a runner that
//! quietly returned a default would report the port as finished while it was
//! barely started.
//!
//!   cargo run -p beheader-conformance -- --fixtures <dir> --out <file>
//!   cargo run -p beheader-conformance -- --calls
//!
//! The process gives exit code 1 when a fixture file is unreadable or
//! malformed, because a fixture nobody can read is a gap in the comparison
//! rather than a case that passed.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::ExitCode;

use beheader_engine::address::{
    Address, AddressError, AddressableObject, CellCoordinates, column_letters_to_index,
    format_address, format_cell_reference, index_to_column_letters, is_cell_reference_form,
    is_valid_name, nearest_name, parse_address, parse_cell_reference, to_surface_path,
};
use beheader_engine::formula::ast::{
    FormulaAst, LiteralValue, exceeds_max_formula_ast_depth, validate_formula_ast_shape,
};
use beheader_engine::formula::deps::{
    Dependency, extract_dependencies, repair_addresses_in_ast, rewrite_addresses_in_ast,
};
use beheader_engine::formula::eval::evaluate;
use beheader_engine::formula::format::format_formula;
use beheader_engine::formula::lexer::{TokenKind, lex};
use beheader_engine::formula::parser::parse_formula;
use beheader_engine::graph::address_key;
use beheader_engine::graph::cycles::{CycleCheck, detect_cycle};
use beheader_engine::math::ast::{MathAst, MathLine, MathProgram};
use beheader_engine::math::eval::evaluate_math_object;
use beheader_engine::math::lexer::tokenize_math;
use beheader_engine::math::names::resolve_math_names;
use beheader_engine::math::parser::parse_math;
use beheader_engine::measure::{
    MathStyle, MeasureCapability, MeasureError, Measurement, Measurer, TextStyle,
};
use beheader_engine::model::{
    ErrorCode, ErrorValue, GraphObject, GraphObjectPorts, ObjectType, Point, Slot, SlotMap, Value,
    has_illegal_number, is_error_value, is_illegal_number, is_legal_port_name, slot_key,
};
use beheader_engine::mutation::{
    Operation, derive_edges, derive_validate_and_evaluate, mutate, validate_integrity,
};
use beheader_engine::number::{
    js_acos, js_asin, js_atan, js_atan2, js_cos, js_cosh, js_exp, js_hypot, js_ln, js_log10,
    js_pow, js_sin, js_sinh, js_sqrt, js_tan, js_tanh, to_javascript_text,
};
use beheader_engine::primitives::doc::{docref_label, document_variable_name_problem};
use beheader_engine::primitives::edge::{
    ArcGeometry, PathEdge, arc_of_edge, bezier_of_edge, build_path_edges, bulge_for_midpoint,
    bulge_for_tangent_arc, cubic_handles_for_edge, distance_to_edge, distance_to_path,
    distance_to_segment, edge_doubled_area_over_chord, edge_end_direction, edge_extreme_points,
    edge_length, edge_midpoint, path_area, path_bounds, path_centroid, path_contains,
    path_doubled_signed_area, path_length, split_edge_at, sweep_covers_angle,
};
use beheader_engine::primitives::geometry::{
    ExplodeResult, VertexRepair, add_vertex_to_object, compute_area, compute_bounds,
    compute_centroid, compute_open_path_length, compute_perimeter_length, compute_polygon_vertices,
    compute_rect_vertices, compute_vertex_mean, delete_vertex_from_object,
    enumerate_polyline_coordinate_slot_paths, enumerate_polyline_vertex_slot_paths,
    explode_object_to_polyline, insert_vertex_into_object, path_edges_of_object,
    polyline_edge_count, repair_vertex_address_for_delete, shift_vertex_address_for_delete,
    shift_vertex_address_for_insert, split_polyline_edge,
};
use beheader_engine::primitives::math::{
    apply_math_source, create_math_object, math_source_references, math_source_with_ids,
    math_source_with_names, read_math_display_latex, read_math_names, rewrite_math_references,
    unresolved_math_references,
};
use beheader_engine::primitives::schema::{
    SlotComputeInputs, SlotFormat, derived_slot_dependency_addresses, find_slot_format,
    find_slot_options, get_object_schema, is_color_value, resolve_derived_slots,
    resolve_non_derived_slot_paths,
};
use beheader_engine::primitives::table::{
    CellRepair, RangeRepair, TableAxis, cell_address_to_coordinates, delete_table_line,
    enumerate_range_cell_addresses, enumerate_table_cell_slot_paths, get_table_dimensions,
    insert_table_line, is_in_extent_table_cell_address, is_table_dimension_resizable,
    repair_cell_address_for_delete, repair_range_endpoints_for_delete,
    shift_cell_address_for_insert,
};
use beheader_engine::primitives::text::{
    Block, evaluate_block_tree, extract_text_dependencies, match_math_marker_at,
    parse_text_content, resolve_text_dependency_addresses,
};
use beheader_engine::wire::{
    decode_number, decode_point, decode_value, encode_number, encode_point, encode_value,
};
use serde_json::{Map, Value as Json, json};

/// The version of the results shape this runner writes.
const RUNNER_VERSION: u64 = 1;

/// The fixture shape this runner reads.
const FIXTURE_VERSION: u64 = 1;

/// The calls the Rust engine can answer. Anything else in a fixture comes back
/// unsupported, which is what the comparison report counts as coverage the
/// port has yet to reach.
const SUPPORTED_CALLS: &[&str] = &[
    "addressKey",
    "columnLettersToIndex",
    "extractDependencies",
    "formatAddress",
    "formatCellReference",
    "formatFormula",
    "hasIllegalNumber",
    "indexToColumnLetters",
    "isCellReferenceForm",
    "isErrorValue",
    "isIllegalNumber",
    "isLegalPortName",
    "isValidName",
    "lex",
    "nearestName",
    "nestedFormulaDepth",
    "numberToText",
    "parseAddress",
    "parseCellReference",
    "parseFormula",
    "parseMath",
    "resolveMathNames",
    "parseThenFormat",
    "repairAddressesInAst",
    "rewriteAddressesInAst",
    "slotKey",
    "tokenizeMath",
    "toSurfacePath",
    "validateFormulaAstShape",
    "valueRoundTrip",
];

/// What one case produced.
enum Outcome {
    Ok(Json),
    /// The arguments were outside the declared domain of the call. Both
    /// runners word this the same way, so a difference in the wording is a
    /// difference between the two adapters rather than between the engines.
    Bad(String),
    Unsupported(String),
}

impl Outcome {
    fn to_json(&self) -> Json {
        match self {
            Outcome::Ok(value) => json!({ "status": "ok", "value": value }),
            Outcome::Bad(detail) => json!({ "status": "error", "detail": detail }),
            Outcome::Unsupported(detail) => json!({ "status": "unsupported", "detail": detail }),
        }
    }
}

type Answer = Result<Json, String>;

/// One object an address resolves against. A fixture gives the slot names as a
/// list, because `serde_json` holds the members of an object in a sorted map
/// and the order of the slot names is part of what the comparison asks about.
struct FixtureObject {
    id: String,
    name: String,
    object_type: ObjectType,
    slot_keys: Vec<String>,
}

impl AddressableObject for FixtureObject {
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
        self.slot_keys.iter().map(String::as_str).collect()
    }
}

fn object_list_argument(
    args: &Map<String, Json>,
    name: &str,
) -> Result<Vec<FixtureObject>, String> {
    let shape =
        || format!("the argument \"{name}\" is a list of objects with an id, a name and a type");
    argument(args, name)?
        .as_array()
        .ok_or_else(shape)?
        .iter()
        .map(|entry| {
            let object = entry.as_object().ok_or_else(shape)?;
            let text = |key: &str| object.get(key).and_then(Json::as_str).ok_or_else(shape);
            Ok(FixtureObject {
                id: text("id")?.to_string(),
                name: text("name")?.to_string(),
                object_type: ObjectType::parse(text("type")?).ok_or_else(shape)?,
                slot_keys: match object.get("slotKeys") {
                    None => Vec::new(),
                    Some(keys) => keys
                        .as_array()
                        .ok_or_else(shape)?
                        .iter()
                        .map(|key| key.as_str().map(str::to_string).ok_or_else(shape))
                        .collect::<Result<Vec<_>, _>>()?,
                },
            })
        })
        .collect()
}

fn text_list_argument(args: &Map<String, Json>, name: &str) -> Result<Vec<String>, String> {
    let shape = || format!("the argument \"{name}\" is a list of strings");
    argument(args, name)?
        .as_array()
        .ok_or_else(shape)?
        .iter()
        .map(|entry| entry.as_str().map(str::to_string).ok_or_else(shape))
        .collect()
}

fn address_argument(args: &Map<String, Json>, name: &str) -> Result<Address, String> {
    let shape = || format!("the argument \"{name}\" is an address with an objectId and a path");
    let object = argument(args, name)?.as_object().ok_or_else(shape)?;
    Ok(Address {
        object_id: object
            .get("objectId")
            .and_then(Json::as_str)
            .ok_or_else(shape)?
            .to_string(),
        path: path_argument(object, "path")?,
    })
}

/// The one shape both spellings of an address answer take, so a comparison of
/// two engines reads one field set whether the call succeeded or refused.
fn encode_address_error(error: &AddressError) -> Json {
    json!({ "error": error.error.as_str(), "message": error.message })
}

/// A math expression as JSON, with every number in the tagged form.
fn encode_math_ast(ast: &MathAst) -> Json {
    match ast {
        MathAst::Number(value) => json!({ "type": "number", "value": encode_number(*value) }),
        MathAst::Name(name) => json!({ "type": "name", "name": name }),
        MathAst::Reference(address) => {
            json!({ "type": "reference", "address": encode_address(address) })
        }
        MathAst::Binary {
            operator,
            left,
            right,
        } => json!({
            "type": "binary",
            "operator": operator.as_str(),
            "left": encode_math_ast(left),
            "right": encode_math_ast(right),
        }),
        MathAst::Negate(operand) => {
            json!({ "type": "negate", "operand": encode_math_ast(operand) })
        }
        MathAst::Call { name, args } => json!({
            "type": "call",
            "name": name,
            "args": args.iter().map(encode_math_ast).collect::<Vec<_>>(),
        }),
        MathAst::Integral {
            variable,
            lower,
            upper,
            body,
        } => json!({
            "type": "integral",
            "variable": variable,
            "lower": encode_math_ast(lower),
            "upper": encode_math_ast(upper),
            "body": encode_math_ast(body),
        }),
        MathAst::Series {
            operation,
            variable,
            lower,
            upper,
            body,
        } => json!({
            "type": "series",
            "operation": operation.as_str(),
            "variable": variable,
            "lower": encode_math_ast(lower),
            "upper": encode_math_ast(upper),
            "body": encode_math_ast(body),
        }),
    }
}

fn encode_math_line(line: &MathLine) -> Json {
    match line {
        MathLine::Definition {
            name,
            value,
            source_line,
        } => json!({
            "type": "definition",
            "name": name,
            "value": encode_math_ast(value),
            "sourceLine": source_line,
        }),
        MathLine::FunctionDefinition {
            name,
            parameters,
            body,
        } => json!({
            "type": "functionDefinition",
            "name": name,
            "parameters": parameters,
            "body": encode_math_ast(body),
        }),
        MathLine::Solve {
            unknown,
            left,
            right,
            source_line,
        } => json!({
            "type": "solve",
            "unknown": unknown,
            "left": encode_math_ast(left),
            "right": encode_math_ast(right),
            "sourceLine": source_line,
        }),
        MathLine::Expression { value } => {
            json!({ "type": "expression", "value": encode_math_ast(value) })
        }
    }
}

fn encode_math_program(program: &MathProgram) -> Json {
    json!({ "lines": program.lines.iter().map(encode_math_line).collect::<Vec<_>>() })
}

fn encode_address(address: &Address) -> Json {
    json!({ "objectId": address.object_id, "path": address.path })
}

/// A formula tree as JSON, with a literal number carried in the tagged form the
/// fixtures use so a tree holding 1e21 compares by the text both engines print.
fn encode_ast(ast: &FormulaAst) -> Json {
    let address = encode_address;
    match ast {
        FormulaAst::Literal(LiteralValue::Number(number)) => {
            json!({ "type": "literal", "value": encode_number(*number) })
        }
        FormulaAst::Literal(LiteralValue::Text(text)) => {
            json!({ "type": "literal", "value": text })
        }
        FormulaAst::Literal(LiteralValue::Boolean(boolean)) => {
            json!({ "type": "literal", "value": boolean })
        }
        FormulaAst::Reference(reference) => {
            json!({ "type": "reference", "address": address(reference) })
        }
        FormulaAst::Range { start, end } => {
            json!({ "type": "range", "start": address(start), "end": address(end) })
        }
        FormulaAst::BinaryOp {
            operator,
            left,
            right,
        } => json!({
            "type": "binaryOp",
            "operator": operator.as_str(),
            "left": encode_ast(left),
            "right": encode_ast(right),
        }),
        FormulaAst::UnaryOp { operator, operand } => json!({
            "type": "unaryOp",
            "operator": operator.as_str(),
            "operand": encode_ast(operand),
        }),
        FormulaAst::FunctionCall { name, args } => json!({
            "type": "functionCall",
            "name": name,
            "args": args.iter().map(encode_ast).collect::<Vec<_>>(),
        }),
        FormulaAst::Error => json!({ "type": "error", "error": "#REF" }),
    }
}

/// A chain of prefix minus nodes that deep, around one literal. Each step moves
/// the tree it has into the next node, because writing it as `json!` with the
/// tree inside would serialize that tree again for every node.
fn nested_ast(depth: usize) -> Json {
    let mut ast = json!({ "type": "literal", "value": 1 });
    for _ in 0..depth {
        let mut node = Map::new();
        node.insert("type".into(), json!("unaryOp"));
        node.insert("operator".into(), json!("-"));
        node.insert("operand".into(), ast);
        ast = Json::Object(node);
    }
    ast
}

/// The key a case declares a slot or a range end under, which both runners
/// build the same way so the same address reads the same value.
fn address_text(address: &Address) -> String {
    format!("{}::{}", address.object_id, address.path.join("."))
}

fn declared_slots(
    args: &Map<String, Json>,
) -> Result<Vec<(String, beheader_engine::model::Value)>, String> {
    let mut slots = Vec::new();
    let Some(Json::Array(declared)) = args.get("slots") else {
        return Ok(slots);
    };
    for entry in declared {
        let entry = entry.as_object().ok_or_else(|| {
            "each slot is an object with an objectId, a path and a value".to_string()
        })?;
        let address = address_argument_from(entry)?;
        let value = decode_value(
            entry
                .get("value")
                .ok_or_else(|| "each slot carries a value".to_string())?,
        )
        .map_err(|error| format!("a slot holds a value the engine can hold: {error}"))?;
        slots.push((address_text(&address), value));
    }
    Ok(slots)
}

type RangeAnswer = Result<Vec<beheader_engine::model::Value>, ErrorValue>;

fn declared_ranges(args: &Map<String, Json>) -> Result<Vec<(String, RangeAnswer)>, String> {
    let mut ranges = Vec::new();
    let Some(Json::Array(declared)) = args.get("ranges") else {
        return Ok(ranges);
    };
    for entry in declared {
        let entry = entry
            .as_object()
            .ok_or_else(|| "each range is an object with a start and an end".to_string())?;
        let start = address_argument(entry, "start")?;
        let end = address_argument(entry, "end")?;
        let answer = match entry.get("error").and_then(Json::as_str) {
            Some(code) => Err(ErrorValue {
                error: ErrorCode::parse(code)
                    .ok_or_else(|| "a range refusal names one of the error codes".to_string())?,
                message: entry
                    .get("message")
                    .and_then(Json::as_str)
                    .unwrap_or_default()
                    .to_string(),
            }),
            None => Ok(entry
                .get("values")
                .and_then(Json::as_array)
                .ok_or_else(|| "a range that does not refuse carries values".to_string())?
                .iter()
                .map(|value| {
                    decode_value(value).map_err(|error| {
                        format!("a range holds values the engine can hold: {error}")
                    })
                })
                .collect::<Result<Vec<_>, _>>()?),
        };
        ranges.push((
            format!("{}:{}", address_text(&start), address_text(&end)),
            answer,
        ));
    }
    Ok(ranges)
}

/// An address spelled directly on an object, rather than under a named member.
fn address_argument_from(object: &Map<String, Json>) -> Result<Address, String> {
    Ok(Address {
        object_id: object
            .get("objectId")
            .and_then(Json::as_str)
            .ok_or_else(|| "the slot names an objectId".to_string())?
            .to_string(),
        path: path_argument(object, "path")?,
    })
}

fn missing(name: &str) -> String {
    format!("the argument \"{name}\" is missing")
}

fn argument<'a>(args: &'a Map<String, Json>, name: &str) -> Result<&'a Json, String> {
    args.get(name).ok_or_else(|| missing(name))
}

fn text_argument(args: &Map<String, Json>, name: &str) -> Result<String, String> {
    argument(args, name)?
        .as_str()
        .map(str::to_string)
        .ok_or_else(|| format!("the argument \"{name}\" is text"))
}

fn number_argument(args: &Map<String, Json>, name: &str) -> Result<f64, String> {
    let json = argument(args, name)?;
    decode_number(json).map_err(|_| format!("the argument \"{name}\" is a number"))
}

fn safe_integer_argument(args: &Map<String, Json>, name: &str) -> Result<f64, String> {
    let number = number_argument(args, name)?;
    let safe = number.fract() == 0.0 && number.abs() <= 9_007_199_254_740_991.0;
    if safe {
        Ok(number)
    } else {
        Err(format!("the argument \"{name}\" is a safe integer"))
    }
}

fn path_argument(args: &Map<String, Json>, name: &str) -> Result<Vec<String>, String> {
    let items = argument(args, name)?
        .as_array()
        .ok_or_else(|| format!("the argument \"{name}\" is a list of text segments"))?;
    items
        .iter()
        .map(|item| {
            item.as_str()
                .map(str::to_string)
                .ok_or_else(|| format!("the argument \"{name}\" is a list of text segments"))
        })
        .collect()
}

fn object_type_argument(args: &Map<String, Json>, name: &str) -> Result<ObjectType, String> {
    let text = text_argument(args, name)?;
    ObjectType::parse(&text)
        .ok_or_else(|| format!("the argument \"{name}\" is one of the thirteen object types"))
}

fn value_argument(
    args: &Map<String, Json>,
    name: &str,
) -> Result<beheader_engine::model::Value, String> {
    let json = argument(args, name)?;
    decode_value(json)
        .map_err(|error| format!("the argument \"{name}\" is a value the engine can hold: {error}"))
}

/// The arithmetic behind a named function, as one of the two shapes a caller
/// can apply. The engine reaches each of these through a wrapper rather than
/// through the method its target supplies, so this runner asks the same
/// question the engine would.
enum Arithmetic {
    OfOne(fn(f64) -> f64),
    OfTwo(fn(f64, f64) -> f64),
}

fn arithmetic(name: &str) -> Option<Arithmetic> {
    Some(match name {
        "sin" => Arithmetic::OfOne(js_sin),
        "cos" => Arithmetic::OfOne(js_cos),
        "tan" => Arithmetic::OfOne(js_tan),
        "asin" => Arithmetic::OfOne(js_asin),
        "acos" => Arithmetic::OfOne(js_acos),
        "atan" => Arithmetic::OfOne(js_atan),
        "sinh" => Arithmetic::OfOne(js_sinh),
        "cosh" => Arithmetic::OfOne(js_cosh),
        "tanh" => Arithmetic::OfOne(js_tanh),
        "ln" => Arithmetic::OfOne(js_ln),
        "log10" => Arithmetic::OfOne(js_log10),
        "exp" => Arithmetic::OfOne(js_exp),
        "sqrt" => Arithmetic::OfOne(js_sqrt),
        "atan2" => Arithmetic::OfTwo(js_atan2),
        "hypot" => Arithmetic::OfTwo(js_hypot),
        "pow" => Arithmetic::OfTwo(js_pow),
        _ => return None,
    })
}

/* ------------------------------------------------------------------ */
/* Geometry arguments and answers                                      */
/* ------------------------------------------------------------------ */

fn point_from(json: &Json, name: &str) -> Result<Point, String> {
    decode_point(json).map_err(|_| format!("the argument \"{name}\" is a point"))
}

fn point_argument(args: &Map<String, Json>, name: &str) -> Result<Point, String> {
    point_from(argument(args, name)?, name)
}

fn point_list_argument(args: &Map<String, Json>, name: &str) -> Result<Vec<Point>, String> {
    let Some(value) = args.get(name) else {
        return Ok(Vec::new());
    };
    let items = value
        .as_array()
        .ok_or_else(|| format!("the argument \"{name}\" is a list of points"))?;
    items.iter().map(|entry| point_from(entry, name)).collect()
}

fn number_list_argument(args: &Map<String, Json>, name: &str) -> Result<Vec<f64>, String> {
    let Some(value) = args.get(name) else {
        return Ok(Vec::new());
    };
    let items = value
        .as_array()
        .ok_or_else(|| format!("the argument \"{name}\" is a list of numbers"))?;
    items
        .iter()
        .map(|entry| {
            decode_number(entry)
                .map_err(|_| format!("the argument \"{name}\" is a list of numbers"))
        })
        .collect()
}

fn boolean_argument(args: &Map<String, Json>, name: &str) -> Result<bool, String> {
    argument(args, name)?
        .as_bool()
        .ok_or_else(|| format!("the argument \"{name}\" is a boolean"))
}

/// One edge from its four fields. The controls are absent for a straight edge
/// and an arc, because a pair of control points wins over a bulge and an edge
/// that carries both would never reach its bulge.
fn edge_argument(args: &Map<String, Json>, name: &str) -> Result<PathEdge, String> {
    let object = argument(args, name)?
        .as_object()
        .ok_or_else(|| format!("the argument \"{name}\" is an edge"))?;
    let start = point_from(
        object
            .get("start")
            .ok_or_else(|| format!("the argument \"{name}\" is an edge"))?,
        name,
    )?;
    let end = point_from(
        object
            .get("end")
            .ok_or_else(|| format!("the argument \"{name}\" is an edge"))?,
        name,
    )?;
    let bulge = match object.get("bulge") {
        None => 0.0,
        Some(json) => {
            decode_number(json).map_err(|_| format!("the argument \"{name}\" is an edge"))?
        }
    };
    let controls = match object.get("controls") {
        None | Some(Json::Null) => None,
        Some(json) => {
            let items = json
                .as_array()
                .filter(|items| items.len() == 2)
                .ok_or_else(|| {
                    format!("the argument \"{name}\" carries two control points or none")
                })?;
            Some([point_from(&items[0], name)?, point_from(&items[1], name)?])
        }
    };
    Ok(PathEdge {
        start,
        end,
        bulge,
        controls,
    })
}

/// The edges of a path, from the slots a polyline stores.
fn path_edges_argument(args: &Map<String, Json>) -> Result<Vec<PathEdge>, String> {
    Ok(build_path_edges(
        &point_list_argument(args, "vertices")?,
        &number_list_argument(args, "bulges")?,
        boolean_argument(args, "closed")?,
        &point_list_argument(args, "handlesIn")?,
        &point_list_argument(args, "handlesOut")?,
    ))
}

fn encode_arc(arc: Option<ArcGeometry>) -> Json {
    match arc {
        None => Json::Null,
        Some(arc) => json!({
            "center": encode_point(arc.center),
            "radius": encode_number(arc.radius),
            "startAngle": encode_number(arc.start_angle),
            "sweep": encode_number(arc.sweep),
        }),
    }
}

/// A shape as a fixture states it: the object fields, and the slots as an
/// ordered list rather than as a JSON object. Slot order is observable in
/// drawing and completion, `serde_json` holds the
/// members of an object in a sorted map and JavaScript keeps the order they
/// were written in, so a fixture that wrote the slots as an object would
/// compare the two JSON readers rather than the two engines.
fn shape_object_argument(
    args: &Map<String, Json>,
    name: &str,
) -> Result<GraphObject<FormulaAst>, String> {
    let object = argument(args, name)?
        .as_object()
        .ok_or_else(|| format!("the argument \"{name}\" is an object with an id and a type"))?;
    let id = object
        .get("id")
        .and_then(Json::as_str)
        .ok_or_else(|| format!("the argument \"{name}\" is an object with an id and a type"))?;
    let object_type = object
        .get("type")
        .and_then(Json::as_str)
        .and_then(ObjectType::parse)
        .ok_or_else(|| format!("the argument \"{name}\" is an object with an id and a type"))?;
    let mut slots = SlotMap::new();
    if let Some(entries) = object.get("slots").and_then(Json::as_array) {
        for entry in entries {
            let entry = entry
                .as_object()
                .ok_or_else(|| format!("the argument \"{name}\" carries slots with a key each"))?;
            let key = entry
                .get("key")
                .and_then(Json::as_str)
                .ok_or_else(|| format!("the argument \"{name}\" carries slots with a key each"))?;
            let value = decode_value(entry.get("value").unwrap_or(&Json::Null))
                .map_err(|failure| failure.message)?;
            let slot = match entry.get("kind").and_then(Json::as_str) {
                Some("derived") => Slot::Derived { value },
                _ => Slot::Literal { value },
            };
            slots.insert(key, slot);
        }
    }
    let vertex_count = match object.get("vertexCount") {
        None | Some(Json::Null) => None,
        Some(json) => Some(decode_number(json).map_err(|failure| failure.message)?),
    };
    Ok(GraphObject {
        id: id.to_string(),
        name: object
            .get("name")
            .and_then(Json::as_str)
            .unwrap_or(id)
            .to_string(),
        object_type,
        target: match object.get("target") {
            None | Some(Json::Null) => None,
            Some(held) => {
                let mut one = Map::new();
                one.insert("target".to_string(), held.clone());
                Some(address_argument(&one, "target")?)
            }
        },
        slots,
        ports: object.get("ports").and_then(Json::as_object).map(|ports| {
            let named = |key: &str| {
                ports
                    .get(key)
                    .and_then(Json::as_array)
                    .map(|names| {
                        names
                            .iter()
                            .filter_map(|name| name.as_str().map(str::to_string))
                            .collect()
                    })
                    .unwrap_or_default()
            };
            GraphObjectPorts {
                input: named("in"),
                output: named("out"),
                // A source that solves for nothing arrives with no seed
                // family, so an absent list stays absent rather than becoming
                // an empty one.
                seed: ports.get("seed").and_then(Json::as_array).map(|names| {
                    names
                        .iter()
                        .filter_map(|name| name.as_str().map(str::to_string))
                        .collect()
                }),
            }
        }),
        vertex_count,
    })
}

/// Several shapes, read the same way one is, and then a second pass that parses
/// every formula against the whole list. A formula names objects by the names
/// they carry, so it cannot be parsed until every object in the case exists.
fn shape_object_list_argument(
    args: &Map<String, Json>,
    name: &str,
) -> Result<Vec<GraphObject<FormulaAst>>, String> {
    let items = argument(args, name)?
        .as_array()
        .ok_or_else(|| format!("the argument \"{name}\" is a list of objects"))?
        .clone();
    let mut objects = Vec::new();
    for item in &items {
        let mut one = Map::new();
        one.insert("object".to_string(), item.clone());
        objects.push(shape_object_argument(&one, "object")?);
    }
    for (index, item) in items.iter().enumerate() {
        let Some(slots) = item.get("slots").and_then(Json::as_array) else {
            continue;
        };
        for slot in slots {
            let (Some(key), Some(source)) = (
                slot.get("key").and_then(Json::as_str),
                slot.get("formula").and_then(Json::as_str),
            ) else {
                continue;
            };
            let ast = parse_formula(source, &objects, None).map_err(|failure| {
                format!(
                    "the formula \"{source}\" does not parse: {}",
                    failure.message
                )
            })?;
            objects[index].slots.insert(
                key,
                Slot::Formula {
                    ast,
                    value: Value::Null,
                },
            );
        }
    }
    Ok(objects)
}

/// A shape back out, with its slots in the order they sit in.
fn encode_shape_object(object: &GraphObject<FormulaAst>) -> Json {
    json!({
        "id": object.id,
        "name": object.name,
        "type": object.object_type.as_str(),
        "vertexCount": match object.vertex_count {
            None => Json::Null,
            Some(count) => encode_number(count),
        },
        "slots": object
            .slots
            .iter()
            .map(|(key, slot)| json!({
                "key": key,
                "kind": match slot {
                    Slot::Literal { .. } => "literal",
                    Slot::Formula { .. } => "formula",
                    Slot::Derived { .. } => "derived",
                },
                "value": encode_value(slot.value()),
            }))
            .collect::<Vec<_>>(),
    })
}

fn encode_edge(edge: &PathEdge) -> Json {
    json!({
        "start": encode_point(edge.start),
        "end": encode_point(edge.end),
        "bulge": encode_number(edge.bulge),
        "controls": match edge.controls {
            None => Json::Null,
            Some([one, two]) => json!([encode_point(one), encode_point(two)]),
        },
    })
}

/// A measurer whose host has gone, which is what a closed page looks like.
struct FailingMeasurer;

impl Measurer for FailingMeasurer {
    fn capability(&self) -> MeasureCapability {
        MeasureCapability::TextAndMath
    }

    fn measure(
        &self,
        _text: &str,
        _style: &TextStyle,
        _max_width: Option<f64>,
    ) -> Result<Measurement, MeasureError> {
        Err(MeasureError::HostFailed("the host has gone".to_string()))
    }

    fn measure_math(&self, _latex: &str, _style: &MathStyle) -> Result<Measurement, MeasureError> {
        Err(MeasureError::HostFailed("the host has gone".to_string()))
    }
}

/// The axis a table resize runs along.
fn table_axis_argument(args: &Map<String, Json>) -> Result<TableAxis, String> {
    match text_argument(args, "axis")?.as_str() {
        "row" => Ok(TableAxis::Row),
        "column" => Ok(TableAxis::Column),
        _ => Err("the argument \"axis\" is \"row\" or \"column\"".to_string()),
    }
}

/// A measurer whose answer follows from the text alone, so both engines can be
/// asked what a copy of a variable measures. A width counts the units a
/// JavaScript string counts, so a label holding a character outside the basic
/// plane measures two units wide rather than one.
struct FakeMeasurer;

impl Measurer for FakeMeasurer {
    fn capability(&self) -> MeasureCapability {
        MeasureCapability::TextAndMath
    }

    fn measure(
        &self,
        text: &str,
        style: &TextStyle,
        _max_width: Option<f64>,
    ) -> Result<Measurement, MeasureError> {
        Ok(Measurement {
            width: text.encode_utf16().count() as f64 * style.font_size * 0.6,
            height: style.line_height,
        })
    }

    fn measure_math(&self, latex: &str, style: &MathStyle) -> Result<Measurement, MeasureError> {
        Ok(Measurement {
            width: latex.encode_utf16().count() as f64 * style.font_size * 0.5,
            height: style.font_size * 1.5,
        })
    }
}

/// A block tree as JSON, with each node naming its own kind.
fn encode_block(block: &Block) -> Json {
    match block {
        Block::Text(value) => json!({ "type": "text", "value": value }),
        Block::Math(run) => json!({
            "type": "math",
            "latex": run.latex,
            "display": run.display,
            "source": run.source,
        }),
        Block::Formula(ast) => json!({ "type": "formula", "ast": encode_ast(ast) }),
        Block::Conditional {
            condition,
            true_branch,
            false_branch,
        } => json!({
            "type": "conditional",
            "condition": encode_ast(condition),
            "trueBranch": true_branch.iter().map(encode_block).collect::<Vec<_>>(),
            "falseBranch": false_branch.iter().map(encode_block).collect::<Vec<_>>(),
        }),
        Block::Error {
            message,
            source,
            start,
            orphaned,
        } => json!({
            "type": "error",
            "message": message,
            "source": source,
            "start": start,
            "orphaned": orphaned.iter().map(encode_block).collect::<Vec<_>>(),
        }),
    }
}

fn encode_dependency(dependency: &Dependency) -> Json {
    match dependency {
        Dependency::Reference(address) => json!({
            "kind": "reference",
            "address": encode_address(address),
        }),
        Dependency::Range { start, end } => json!({
            "kind": "range",
            "start": encode_address(start),
            "end": encode_address(end),
        }),
    }
}

/// The operations a case asks for. A slot or an object inside one is read the
/// same way a case reads one on its own, and a formula is parsed against the
/// objects the batch starts from.
fn operations_argument(
    args: &Map<String, Json>,
    objects: &[GraphObject<FormulaAst>],
) -> Result<Vec<Operation>, String> {
    let listed = argument(args, "operations")?
        .as_array()
        .ok_or_else(|| "the argument \"operations\" is a list of operations".to_string())?;
    let mut operations = Vec::new();
    for entry in listed {
        let held = entry
            .as_object()
            .ok_or_else(|| "an operation is an object with a kind".to_string())?;
        let kind = held
            .get("kind")
            .and_then(Json::as_str)
            .ok_or_else(|| "an operation is an object with a kind".to_string())?;
        operations.push(match kind {
            "createObject" => {
                let mut one = Map::new();
                one.insert(
                    "o".to_string(),
                    Json::Array(vec![held.get("object").cloned().unwrap_or(Json::Null)]),
                );
                let built = shape_object_list_argument(&one, "o")?;
                Operation::CreateObject {
                    object: Box::new(built.into_iter().next().expect("one object")),
                }
            }
            "setSlot" => {
                let address = address_argument(held, "address")?;
                let slot_json = held
                    .get("slot")
                    .and_then(Json::as_object)
                    .ok_or_else(|| "a setSlot operation carries a slot".to_string())?;
                let slot = match slot_json.get("formula").and_then(Json::as_str) {
                    Some(source) => Slot::Formula {
                        ast: parse_formula(source, objects, None).map_err(|failure| {
                            format!(
                                "the formula \"{source}\" does not parse: {}",
                                failure.message
                            )
                        })?,
                        value: Value::Null,
                    },
                    None => {
                        let value = decode_value(slot_json.get("value").unwrap_or(&Json::Null))
                            .map_err(|failure| failure.message)?;
                        match slot_json.get("kind").and_then(Json::as_str) {
                            Some("derived") => Slot::Derived { value },
                            _ => Slot::Literal { value },
                        }
                    }
                };
                Operation::SetSlot { address, slot }
            }
            "clearSlot" => Operation::ClearSlot {
                address: address_argument(held, "address")?,
            },
            "deleteObject" => Operation::DeleteObject {
                object_id: text_argument(held, "objectId")?,
                force: held.get("force").and_then(Json::as_bool).unwrap_or(false),
            },
            "insertTableLine" | "deleteTableLine" => {
                let object_id = text_argument(held, "objectId")?;
                let axis = table_axis_argument(held)?;
                let index = number_argument(held, "index")?;
                if kind == "insertTableLine" {
                    Operation::InsertTableLine {
                        object_id,
                        axis,
                        index,
                    }
                } else {
                    Operation::DeleteTableLine {
                        object_id,
                        axis,
                        index,
                    }
                }
            }
            "renameObject" => Operation::RenameObject {
                object_id: text_argument(held, "objectId")?,
                name: text_argument(held, "name")?,
            },
            "renameVariable" => Operation::RenameVariable {
                address: address_argument(held, "address")?,
                name: text_argument(held, "name")?,
            },
            other => return Err(format!("no operation named \"{other}\"")),
        });
    }
    Ok(operations)
}

fn answer(call: &str, args: &Map<String, Json>) -> Option<Answer> {
    let result: Answer = match call {
        "numberToText" => {
            number_argument(args, "number").map(|number| json!(to_javascript_text(number)))
        }
        "mutateBatch" => shape_object_list_argument(args, "objects").and_then(|objects| {
            let operations = operations_argument(args, &objects)?;
            let fake = FakeMeasurer;
            let failing = FailingMeasurer;
            let measurer: Option<&dyn Measurer> = match args.get("measurer").and_then(Json::as_str) {
                Some("fake") => Some(&fake),
                Some("failing") => Some(&failing),
                _ => None,
            };
            Ok(match mutate(&objects, &operations, &[], measurer) {
                Err(message) => json!({
                    "ok": false,
                    "message": message,
                    "objects": objects.iter().map(encode_shape_object).collect::<Vec<_>>(),
                }),
                Ok(result) => json!({
                    "ok": true,
                    "objects": result.objects.iter().map(encode_shape_object).collect::<Vec<_>>(),
                    "journalLength": result.journal.len(),
                    "brokenSlots": result.broken_slots.iter().map(encode_address).collect::<Vec<_>>(),
                }),
            })
        }),
        "graphEdges" => shape_object_list_argument(args, "objects").map(|objects| {
            json!(
                derive_edges(&objects)
                    .iter()
                    .map(|edge| json!({
                        "source": encode_address(&edge.source_slot),
                        "dependent": encode_address(&edge.dependent_slot),
                    }))
                    .collect::<Vec<_>>()
            )
        }),
        "graphIntegrity" => shape_object_list_argument(args, "objects").map(|objects| {
            let edges = derive_edges(&objects);
            match validate_integrity(&objects, &edges) {
                Ok(()) => json!({ "ok": true }),
                Err(message) => json!({ "ok": false, "message": message }),
            }
        }),
        "graphCycle" => {
            shape_object_list_argument(args, "objects").map(|objects| {
                match detect_cycle(&derive_edges(&objects)) {
                    CycleCheck::None => json!({ "cycle": Json::Null }),
                    CycleCheck::Found(cycle) => json!({
                        "cycle": cycle.iter().map(encode_address).collect::<Vec<_>>(),
                    }),
                }
            })
        }
        "graphPass" => shape_object_list_argument(args, "objects").map(|objects| {
            let fake = FakeMeasurer;
            let measurer: Option<&dyn Measurer> = match args.get("measurer").and_then(Json::as_str)
            {
                Some("fake") => Some(&fake),
                _ => None,
            };
            match derive_validate_and_evaluate(&objects, measurer) {
                Ok(evaluated) => json!({
                    "ok": true,
                    "objects": evaluated.iter().map(encode_shape_object).collect::<Vec<_>>(),
                }),
                Err(message) => json!({ "ok": false, "message": message }),
            }
        }),
        "mathNames" => text_argument(args, "source").map(|source| match read_math_names(&source) {
            Err(failure) => json!({
                "ok": false,
                "message": failure.message,
                "line": failure.line,
            }),
            Ok(names) => json!({
                "ok": true,
                "references": names.references.iter().map(encode_address).collect::<Vec<_>>(),
                "exports": names.exports,
                "inputs": names.inputs,
                "functions": names.functions,
                "seeds": names.seeds,
            }),
        }),
        "mathApplySource" => shape_object_argument(args, "object").and_then(|object| {
            let source = text_argument(args, "source")?;
            Ok(match read_math_names(&source) {
                Err(failure) => json!({
                    "ok": false,
                    "message": failure.message,
                    "line": failure.line,
                }),
                Ok(names) => json!({
                    "ok": true,
                    "object": encode_shape_object(&apply_math_source(&object, &source, &names)),
                }),
            })
        }),
        "mathDisplay" => shape_object_argument(args, "object")
            .map(|object| json!(read_math_display_latex(&object))),
        "mathSourceAddresses" => shape_object_argument(args, "object").and_then(|object| {
            let objects = shape_object_list_argument(args, "objects")?;
            let source = match object.get_slot(&["source".to_string()]).map(Slot::value) {
                Some(Value::Text(text)) => text.clone(),
                _ => String::new(),
            };
            Ok(json!({
                "references": math_source_references(&object)
                    .iter()
                    .map(encode_address)
                    .collect::<Vec<_>>(),
                "unresolved": unresolved_math_references(&source, &objects),
            }))
        }),
        "mathSourceSpelling" => text_argument(args, "source").and_then(|source| {
            let objects = shape_object_list_argument(args, "objects")?;
            Ok(json!({
                "withNames": math_source_with_names(&source, &objects),
                "withIds": math_source_with_ids(&source, &objects),
                "shifted": rewrite_math_references(&source, |address| {
                    let mut path = address.path.clone();
                    path.push("moved".to_string());
                    Address {
                        object_id: address.object_id.clone(),
                        path,
                    }
                }),
            }))
        }),
        "mathNewObject" => text_argument(args, "name").map(|name| {
            encode_shape_object(&create_math_object::<FormulaAst>("m1", &name, 0.0, 0.0))
        }),
        "parseTextContent" => text_argument(args, "content").and_then(|content| {
            let objects = shape_object_list_argument(args, "objects")?;
            Ok(json!(
                parse_text_content(&content, &objects)
                    .iter()
                    .map(encode_block)
                    .collect::<Vec<_>>()
            ))
        }),
        "textDependencies" => text_argument(args, "content").and_then(|content| {
            let objects = shape_object_list_argument(args, "objects")?;
            let blocks = parse_text_content(&content, &objects);
            Ok(json!(
                extract_text_dependencies(&blocks)
                    .iter()
                    .map(encode_dependency)
                    .collect::<Vec<_>>()
            ))
        }),
        "resolveTextDependencies" => shape_object_argument(args, "object").and_then(|object| {
            let objects = shape_object_list_argument(args, "objects")?;
            Ok(json!(
                resolve_text_dependency_addresses(&object, &objects)
                    .iter()
                    .map(encode_address)
                    .collect::<Vec<_>>()
            ))
        }),
        "evaluateTextContent" => text_argument(args, "content").and_then(|content| {
            let objects = shape_object_list_argument(args, "objects")?;
            let blocks = parse_text_content(&content, &objects);
            let read = |address: &Address| {
                objects
                    .iter()
                    .find(|candidate| candidate.id == address.object_id)
                    .and_then(|object| object.get_slot(&address.path))
                    .map(|slot| slot.value().clone())
            };
            Ok(json!(evaluate_block_tree(&blocks, &read, None)))
        }),
        "mathMarker" => text_argument(args, "content").and_then(|content| {
            let at = safe_integer_argument(args, "at")?;
            Ok(match match_math_marker_at(&content, at as usize) {
                None => Json::Null,
                Some(found) => json!({
                    "latex": found.latex,
                    "display": found.display,
                    "end": found.end,
                }),
            })
        }),
        "documentVariableName" => text_argument(args, "name").and_then(|name| {
            let objects = shape_object_list_argument(args, "objects")?;
            let exclude = match args.get("exclude") {
                None | Some(Json::Null) => None,
                Some(_) => Some(text_argument(args, "exclude")?),
            };
            Ok(
                match document_variable_name_problem(&name, &objects, exclude.as_deref()) {
                    None => Json::Null,
                    Some(problem) => Json::String(problem),
                },
            )
        }),
        "docrefLabel" => value_argument(args, "value").and_then(|value| {
            let target = match args.get("target") {
                None | Some(Json::Null) => None,
                Some(_) => Some(address_argument(args, "target")?),
            };
            Ok(json!(docref_label(target.as_ref(), &value)))
        }),
        "objectSchema" => shape_object_argument(args, "object").map(|object| {
            let Some(schema) = get_object_schema::<FormulaAst>(object.object_type) else {
                return json!({ "declared": false });
            };
            let objects = [object.clone()];
            let derived = resolve_derived_slots(&object, schema.derived_slots)
                .into_iter()
                .map(|entry| {
                    json!({
                        "path": entry.path,
                        "dependencies": derived_slot_dependency_addresses(
                            &object, &entry.dependencies, &objects,
                        )
                        .iter()
                        .map(encode_address)
                        .collect::<Vec<_>>(),
                    })
                })
                .collect::<Vec<_>>();
            json!({
                "declared": true,
                "nonDerived": resolve_non_derived_slot_paths(
                    &object, &schema.non_derived_slot_paths,
                ),
                "derived": derived,
                "options": schema
                    .slot_options
                    .iter()
                    .map(|entry| json!({
                        "path": entry.path,
                        "values": entry.values.iter().map(encode_value).collect::<Vec<_>>(),
                        "labels": match &entry.labels {
                            None => Json::Null,
                            Some(labels) => json!(labels),
                        },
                    }))
                    .collect::<Vec<_>>(),
                "formats": schema
                    .slot_formats
                    .iter()
                    .map(|entry| json!({
                        "path": entry.path,
                        "format": match entry.format { SlotFormat::Color => "color" },
                    }))
                    .collect::<Vec<_>>(),
            })
        }),
        "computeDerivedSlots" => shape_object_argument(args, "object").map(|object| {
            let Some(schema) = get_object_schema::<FormulaAst>(object.object_type) else {
                return json!({ "declared": false });
            };
            let objects = [object.clone()];
            let read = |address: &Address| {
                if address.object_id != object.id {
                    return None;
                }
                object
                    .get_slot(&address.path)
                    .map(|slot| slot.value().clone())
            };
            let fake = FakeMeasurer;
            let failing = FailingMeasurer;
            // A case naming no measurer gets none, which is what leaves a
            // measured slot reporting a measurement error rather than a guessed
            // size.
            let measurer: Option<&dyn Measurer> = match args.get("measurer").and_then(Json::as_str)
            {
                Some("fake") => Some(&fake),
                Some("failing") => Some(&failing),
                _ => None,
            };
            let inputs = SlotComputeInputs {
                read: &read,
                read_range: None,
                objects: &objects,
                measurer,
            };
            json!({
                "declared": true,
                "values": resolve_derived_slots(&object, schema.derived_slots)
                    .into_iter()
                    .map(|entry| json!({
                        "path": entry.path,
                        "value": encode_value(&(entry.compute)(&object, &inputs)),
                    }))
                    .collect::<Vec<_>>(),
            })
        }),
        "slotNarrowing" => object_type_argument(args, "type").and_then(|object_type| {
            let at = path_argument(args, "path")?;
            Ok(json!({
                "format": match find_slot_format(object_type, &at) {
                    None => Json::Null,
                    Some(SlotFormat::Color) => Json::String("color".to_string()),
                },
                "options": match find_slot_options(object_type, &at) {
                    None => Json::Null,
                    Some(found) => json!({
                        "values": found.values.iter().map(encode_value).collect::<Vec<_>>(),
                        "labels": match found.labels {
                            None => Json::Null,
                            Some(labels) => json!(labels),
                        },
                    }),
                },
            }))
        }),
        "colorValue" => value_argument(args, "value").map(|value| json!(is_color_value(&value))),
        "tableCellPaths" => shape_object_argument(args, "object").map(|object| {
            let size = get_table_dimensions(&object);
            json!({
                "rows": encode_number(size.rows),
                "cols": encode_number(size.cols),
                "cells": enumerate_table_cell_slot_paths(&object),
                "rowsResizable": is_table_dimension_resizable(&object, TableAxis::Row),
                "columnsResizable": is_table_dimension_resizable(&object, TableAxis::Column),
            })
        }),
        "tableRange" => shape_object_argument(args, "object").and_then(|object| {
            let start = address_argument(args, "start")?;
            let end = address_argument(args, "end")?;
            Ok(
                match enumerate_range_cell_addresses(&start, &end, &object) {
                    Err(failure) => json!({ "error": "#REF", "message": failure.message }),
                    Ok(cells) => json!({
                        "cells": cells.iter().map(encode_address).collect::<Vec<_>>(),
                    }),
                },
            )
        }),
        "tableResize" => shape_object_argument(args, "object").and_then(|object| {
            let axis = table_axis_argument(args)?;
            let index = number_argument(args, "index")?;
            Ok(json!({
                "inserted": encode_shape_object(&insert_table_line(&object, axis, index)),
                "deleted": encode_shape_object(&delete_table_line(&object, axis, index)),
            }))
        }),
        "tableAddressRewrite" => address_argument(args, "address").and_then(|address| {
            let table_id = text_argument(args, "tableId")?;
            let axis = table_axis_argument(args)?;
            let index = number_argument(args, "index")?;
            let end = address_argument(args, "end")?;
            Ok(json!({
                "coordinates": match cell_address_to_coordinates(&address) {
                    None => Json::Null,
                    Some(found) => json!({
                        "column": encode_number(found.column),
                        "row": encode_number(found.row),
                    }),
                },
                "forInsert": encode_address(&shift_cell_address_for_insert(
                    &address, &table_id, axis, index,
                )),
                "repaired": match repair_cell_address_for_delete(&address, &table_id, axis, index) {
                    CellRepair::Deleted => Json::String("deleted".to_string()),
                    CellRepair::Address(found) => encode_address(&found),
                },
                "range": match repair_range_endpoints_for_delete(
                    &address, &end, &table_id, axis, index,
                ) {
                    RangeRepair::Deleted => Json::String("deleted".to_string()),
                    RangeRepair::Endpoints { start, end } => json!({
                        "start": encode_address(&start),
                        "end": encode_address(&end),
                    }),
                },
            }))
        }),
        "tableCellInExtent" => address_argument(args, "address").and_then(|address| {
            Ok(json!(is_in_extent_table_cell_address(
                &address,
                &[shape_object_argument(args, "object")?]
            )))
        }),
        "computePresetVertices" => text_argument(args, "shape").and_then(|shape| {
            let vertices = match shape.as_str() {
                "polygon" => compute_polygon_vertices(
                    number_argument(args, "sides")?,
                    number_argument(args, "radius")?,
                    point_argument(args, "origin")?,
                    number_argument(args, "rotation")?,
                ),
                "rect" => compute_rect_vertices(
                    point_argument(args, "origin")?,
                    number_argument(args, "width")?,
                    number_argument(args, "height")?,
                ),
                _ => return Err("the argument \"shape\" is \"polygon\" or \"rect\"".to_string()),
            };
            Ok(json!(
                vertices.into_iter().map(encode_point).collect::<Vec<_>>()
            ))
        }),
        "verticesMetrics" => point_list_argument(args, "vertices").map(|vertices| {
            let bounds = compute_bounds(&vertices);
            json!({
                "area": encode_number(compute_area(&vertices)),
                "centroid": encode_point(compute_centroid(&vertices)),
                "vertexMean": encode_point(compute_vertex_mean(&vertices)),
                "perimeterLength": encode_number(compute_perimeter_length(&vertices)),
                "openPathLength": encode_number(compute_open_path_length(&vertices)),
                "bounds": {
                    "minX": encode_number(bounds.min_x),
                    "minY": encode_number(bounds.min_y),
                    "maxX": encode_number(bounds.max_x),
                    "maxY": encode_number(bounds.max_y),
                },
            })
        }),
        "vertexSlotPaths" => shape_object_argument(args, "object").map(|object| {
            json!({
                "everyPart": enumerate_polyline_vertex_slot_paths(&object),
                "coordinates": enumerate_polyline_coordinate_slot_paths(&object),
                "edgeCount": encode_number(polyline_edge_count(&object)),
                "edges": path_edges_of_object(&object)
                    .iter()
                    .map(encode_edge)
                    .collect::<Vec<_>>(),
            })
        }),
        "addVertex" => shape_object_argument(args, "object").and_then(|object| {
            Ok(encode_shape_object(&add_vertex_to_object(
                &object,
                point_argument(args, "point")?,
            )))
        }),
        "deleteVertex" => shape_object_argument(args, "object").and_then(|object| {
            Ok(encode_shape_object(&delete_vertex_from_object(
                &object,
                number_argument(args, "index")?,
            )))
        }),
        "insertVertex" => shape_object_argument(args, "object").and_then(|object| {
            let edge_index = number_argument(args, "edgeIndex")?;
            let near = point_argument(args, "near")?;
            // The index reaches the list as a whole number or not at all, and a
            // fixture that names a fractional edge finds no edge there, which
            // is what the TypeScript indexing answers for one too.
            let found = usize::try_from(edge_index as i64)
                .ok()
                .filter(|_| edge_index.fract() == 0.0 && edge_index >= 0.0)
                .and_then(|index| split_polyline_edge(&object, index, near));
            Ok(match found {
                None => json!({ "split": false }),
                Some(split) => json!({
                    "split": true,
                    "object": encode_shape_object(&insert_vertex_into_object(
                        &object, edge_index, &split,
                    )),
                }),
            })
        }),
        "explodeObject" => shape_object_argument(args, "object").and_then(|object| {
            let label = text_argument(args, "label")?;
            Ok(match explode_object_to_polyline(&object, &label) {
                ExplodeResult::Exploded(exploded) => {
                    json!({ "ok": true, "object": encode_shape_object(&exploded) })
                }
                ExplodeResult::Refused(message) => json!({ "ok": false, "message": message }),
            })
        }),
        "vertexAddressRewrite" => address_argument(args, "address").and_then(|address| {
            let object_id = text_argument(args, "objectId")?;
            let index = number_argument(args, "index")?;
            Ok(json!({
                "forInsert": encode_address(&shift_vertex_address_for_insert(
                    &address, &object_id, index,
                )),
                "forDelete": encode_address(&shift_vertex_address_for_delete(
                    &address, &object_id, index,
                )),
                "repaired": match repair_vertex_address_for_delete(&address, &object_id, index) {
                    VertexRepair::Deleted => Json::String("deleted".to_string()),
                    VertexRepair::Address(found) => encode_address(&found),
                },
            }))
        }),
        "edgeAnswers" => edge_argument(args, "edge").map(|edge| {
            let handles = cubic_handles_for_edge(&edge);
            json!({
                "arc": encode_arc(arc_of_edge(&edge)),
                "isBezier": bezier_of_edge(&edge).is_some(),
                "length": encode_number(edge_length(&edge)),
                "doubledAreaOverChord": encode_number(edge_doubled_area_over_chord(&edge)),
                "midpoint": encode_point(edge_midpoint(&edge)),
                "endDirection": encode_point(edge_end_direction(&edge)),
                "handleOut": encode_point(handles.out),
                "handleIn": encode_point(handles.into),
                "extremePoints": edge_extreme_points(&edge)
                    .into_iter()
                    .map(encode_point)
                    .collect::<Vec<_>>(),
            })
        }),
        "pathAnswers" => path_edges_argument(args).map(|edges| {
            let bounds = path_bounds(&edges);
            json!({
                "edgeCount": edges.len(),
                "length": encode_number(path_length(&edges)),
                "area": encode_number(path_area(&edges)),
                "doubledSignedArea": encode_number(path_doubled_signed_area(&edges)),
                "centroid": encode_point(path_centroid(&edges)),
                "bounds": {
                    "minX": encode_number(bounds.min_x),
                    "minY": encode_number(bounds.min_y),
                    "maxX": encode_number(bounds.max_x),
                    "maxY": encode_number(bounds.max_y),
                },
            })
        }),
        "splitEdge" => edge_argument(args, "edge").and_then(|edge| {
            let split = split_edge_at(&edge, point_argument(args, "near")?);
            Ok(json!({
                "point": encode_point(split.at),
                "fraction": encode_number(split.fraction),
                "firstBulge": encode_number(split.first_bulge),
                "secondBulge": encode_number(split.second_bulge),
                "startOutHandle": encode_point(split.start_out_handle),
                "newInHandle": encode_point(split.new_in_handle),
                "newOutHandle": encode_point(split.new_out_handle),
                "endInHandle": encode_point(split.end_in_handle),
            }))
        }),
        "pathContains" => point_argument(args, "point")
            .and_then(|at| Ok(json!(path_contains(at, &path_edges_argument(args)?)))),
        "distanceToPath" => point_argument(args, "point").and_then(|at| {
            Ok(encode_number(distance_to_path(
                at,
                &path_edges_argument(args)?,
            )))
        }),
        "distanceToEdge" => point_argument(args, "point").and_then(|at| {
            Ok(encode_number(distance_to_edge(
                at,
                &edge_argument(args, "edge")?,
            )))
        }),
        "distanceToSegment" => point_argument(args, "point").and_then(|at| {
            Ok(encode_number(distance_to_segment(
                at,
                point_argument(args, "start")?,
                point_argument(args, "end")?,
            )))
        }),
        "bulgeForMidpoint" => point_argument(args, "start").and_then(|start| {
            Ok(encode_number(bulge_for_midpoint(
                start,
                point_argument(args, "end")?,
                point_argument(args, "midpoint")?,
            )))
        }),
        "bulgeForTangentArc" => point_argument(args, "start").and_then(|start| {
            Ok(encode_number(bulge_for_tangent_arc(
                start,
                point_argument(args, "end")?,
                point_argument(args, "direction")?,
            )))
        }),
        "sweepCoversAngle" => edge_argument(args, "edge").and_then(|edge| {
            let arc = arc_of_edge(&edge).ok_or_else(|| {
                "the argument \"edge\" is an edge that rides on a circle".to_string()
            })?;
            Ok(json!(sweep_covers_angle(
                &arc,
                number_argument(args, "angle")?
            )))
        }),
        "javascriptArithmetic" => text_argument(args, "function").and_then(|name| {
            let implementation =
                arithmetic(&name).ok_or_else(|| format!("no arithmetic named \"{name}\""))?;
            let x = number_argument(args, "x")?;
            let value = match implementation {
                Arithmetic::OfOne(of_one) => of_one(x),
                Arithmetic::OfTwo(of_two) => of_two(x, number_argument(args, "y")?),
            };
            Ok(encode_number(value))
        }),
        "slotKey" => path_argument(args, "path").map(|path| json!(slot_key(&path))),
        "isValidName" => text_argument(args, "name").map(|name| json!(is_valid_name(&name))),
        "isCellReferenceForm" => {
            text_argument(args, "segment").map(|segment| json!(is_cell_reference_form(&segment)))
        }
        "parseCellReference" => text_argument(args, "reference").map(|reference| {
            match parse_cell_reference(&reference) {
                None => Json::Null,
                Some(coordinates) => json!({
                    "column": encode_number(coordinates.column),
                    "row": encode_number(coordinates.row),
                }),
            }
        }),
        "formatCellReference" => safe_integer_argument(args, "column").and_then(|column| {
            number_argument(args, "row")
                .map(|row| json!(format_cell_reference(CellCoordinates { column, row })))
        }),
        "columnLettersToIndex" => ascii_letters_argument(args, "letters")
            .map(|letters| encode_number(column_letters_to_index(&letters))),
        "indexToColumnLetters" => {
            safe_integer_argument(args, "index").map(|index| json!(index_to_column_letters(index)))
        }
        "toSurfacePath" => object_type_argument(args, "type").and_then(|object_type| {
            path_argument(args, "path").map(|path| json!(to_surface_path(object_type, &path)))
        }),
        "isErrorValue" => value_argument(args, "value").map(|value| json!(is_error_value(&value))),
        "isIllegalNumber" => {
            number_argument(args, "number").map(|number| json!(is_illegal_number(number)))
        }
        "hasIllegalNumber" => {
            value_argument(args, "value").map(|value| json!(has_illegal_number(&value)))
        }
        "valueRoundTrip" => value_argument(args, "value").map(|value| encode_value(&value)),
        "validateFormulaAstShape" => {
            argument(args, "ast").map(|raw| match validate_formula_ast_shape(raw) {
                Ok(ast) => json!({ "ok": true, "ast": encode_ast(&ast) }),
                Err(reason) => json!({ "ok": false, "reason": reason }),
            })
        }
        "nestedFormulaDepth" => safe_integer_argument(args, "depth").map(|depth| {
            match validate_formula_ast_shape(&nested_ast(depth as usize)) {
                Ok(ast) => {
                    json!({ "ok": true, "exceeds": exceeds_max_formula_ast_depth(&ast) })
                }
                Err(reason) => json!({ "ok": false, "reason": reason }),
            }
        }),
        "evaluateFormula" => text_argument(args, "source").and_then(|source| {
            let objects = object_list_argument(args, "objects")?;
            let table = match args.get("tableObjectId") {
                None => None,
                Some(_) => Some(text_argument(args, "tableObjectId")?),
            };
            let parsed = match parse_formula(&source, &objects, table.as_deref()) {
                Err(error) => {
                    return Ok(json!({
                        "error": error.error.as_str(),
                        "message": error.message,
                        "start": error.start,
                    }));
                }
                Ok(parsed) => parsed,
            };
            let slots = declared_slots(args)?;
            let read = |address: &Address| {
                let key = address_text(address);
                slots
                    .iter()
                    .find(|(held, _)| *held == key)
                    .map(|(_, value)| value.clone())
            };
            let ranges = declared_ranges(args)?;
            let read_range = |start: &Address, end: &Address| {
                let key = format!("{}:{}", address_text(start), address_text(end));
                match ranges.iter().find(|(held, _)| *held == key) {
                    None => Err(ErrorValue {
                        error: ErrorCode::Ref,
                        message: "the case declared no values for this range".to_string(),
                    }),
                    Some((_, answer)) => answer.clone(),
                }
            };
            let value = if args.contains_key("ranges") {
                evaluate(&parsed, &read, Some(&read_range))
            } else {
                evaluate(&parsed, &read, None)
            };
            Ok(encode_value(&value))
        }),
        "evaluateMathObject" => text_argument(args, "source").and_then(|source| {
            let program = match parse_math(&source) {
                Err(error) => {
                    return Ok(json!({
                        "error": "#PARSE",
                        "message": error.message,
                        "line": error.line,
                    }));
                }
                Ok(program) => program,
            };
            let numbers = |name: &str| -> Result<std::collections::HashMap<String, f64>, String> {
                match args.get(name) {
                    None => Ok(std::collections::HashMap::new()),
                    Some(Json::Object(held)) => held
                        .iter()
                        .map(|(key, value)| {
                            decode_number(value)
                                .map(|number| (key.clone(), number))
                                .map_err(|error| {
                                    format!("the argument \"{name}\" holds numbers: {error}")
                                })
                        })
                        .collect(),
                    Some(_) => Err(format!("the argument \"{name}\" is an object of numbers")),
                }
            };
            let evaluation = evaluate_math_object(
                &program,
                &numbers("inputs")?,
                &numbers("references")?,
                &numbers("seeds")?,
            );
            Ok(Json::Array(
                evaluation
                    .exports
                    .iter()
                    .map(|(name, value)| json!([name, encode_value(value)]))
                    .collect(),
            ))
        }),
        "resolveMathNames" => text_argument(args, "source").map(|source| {
            let program = match parse_math(&source) {
                Err(error) => {
                    return json!({
                        "error": "#PARSE",
                        "message": error.message,
                        "line": error.line,
                    });
                }
                Ok(program) => program,
            };
            match resolve_math_names(&program) {
                Err(error) => json!({
                    "error": "#PARSE",
                    "message": error.message,
                    "line": error.line,
                }),
                Ok(names) => json!({
                    "references": names.references.iter().map(encode_address).collect::<Vec<_>>(),
                    "exports": names.exports,
                    "inputs": names.inputs,
                    "functions": names.functions,
                    "seeds": names.seeds,
                }),
            }
        }),
        "parseMath" => text_argument(args, "source").map(|source| match parse_math(&source) {
            Err(error) => json!({
                "error": "#PARSE",
                "message": error.message,
                "line": error.line,
            }),
            Ok(program) => encode_math_program(&program),
        }),
        "tokenizeMath" => {
            text_argument(args, "source").map(|source| match tokenize_math(&source) {
                Err(error) => json!({
                    "error": "#PARSE",
                    "message": error.message,
                    "start": error.start,
                }),
                Ok(tokens) => Json::Array(
                    tokens
                        .iter()
                        .map(|token| {
                            json!({
                                "type": token.kind.as_str(),
                                "text": token.text,
                                "start": token.start,
                                "value": encode_number(token.value),
                                "name": token.name,
                            })
                        })
                        .collect(),
                ),
            })
        }
        "extractDependencies" => {
            argument(args, "ast")
                .cloned()
                .map(|raw| {
                    match validate_formula_ast_shape(&raw) {
                Err(reason) => json!({ "ok": false, "reason": reason }),
                Ok(ast) => Json::Array(
                    extract_dependencies(&ast)
                        .iter()
                        .map(|dependency| match dependency {
                            Dependency::Reference(address) => {
                                json!({ "kind": "reference", "address": encode_address(address) })
                            }
                            Dependency::Range { start, end } => json!({
                                "kind": "range",
                                "start": encode_address(start),
                                "end": encode_address(end),
                            }),
                        })
                        .collect(),
                ),
            }
                })
        }
        "rewriteAddressesInAst" => argument(args, "ast").cloned().and_then(|raw| {
            let from = text_argument(args, "fromObjectId")?;
            let to = text_argument(args, "toObjectId")?;
            Ok(match validate_formula_ast_shape(&raw) {
                Err(reason) => json!({ "ok": false, "reason": reason }),
                Ok(ast) => encode_ast(&rewrite_addresses_in_ast(&ast, &|address: &Address| {
                    if address.object_id == from {
                        Address {
                            object_id: to.clone(),
                            path: address.path.clone(),
                        }
                    } else {
                        address.clone()
                    }
                })),
            })
        }),
        "repairAddressesInAst" => argument(args, "ast").cloned().and_then(|raw| {
            let deleted = text_argument(args, "deletedObjectId")?;
            Ok(match validate_formula_ast_shape(&raw) {
                Err(reason) => json!({ "ok": false, "reason": reason }),
                Ok(ast) => encode_ast(&repair_addresses_in_ast(
                    &ast,
                    &|address: &Address| {
                        if address.object_id == deleted {
                            None
                        } else {
                            Some(address.clone())
                        }
                    },
                    &|start: &Address, end: &Address| {
                        if start.object_id == deleted || end.object_id == deleted {
                            None
                        } else {
                            Some((start.clone(), end.clone()))
                        }
                    },
                )),
            })
        }),
        "formatFormula" => argument(args, "ast").cloned().and_then(|raw| {
            object_list_argument(args, "objects").and_then(|objects| {
                let relative = match args.get("relativeToObjectId") {
                    None => None,
                    Some(_) => Some(text_argument(args, "relativeToObjectId")?),
                };
                Ok(match validate_formula_ast_shape(&raw) {
                    Err(reason) => json!({ "ok": false, "reason": reason }),
                    Ok(ast) => json!(format_formula(&ast, &objects, relative.as_deref())),
                })
            })
        }),
        "parseThenFormat" => text_argument(args, "source").and_then(|source| {
            object_list_argument(args, "objects").and_then(|objects| {
                let table = match args.get("tableObjectId") {
                    None => None,
                    Some(_) => Some(text_argument(args, "tableObjectId")?),
                };
                Ok(match parse_formula(&source, &objects, table.as_deref()) {
                    Err(error) => json!({
                        "error": error.error.as_str(),
                        "message": error.message,
                        "start": error.start,
                    }),
                    Ok(parsed) => {
                        let printed = format_formula(&parsed, &objects, table.as_deref());
                        let again = parse_formula(&printed, &objects, table.as_deref());
                        json!({
                            "printed": printed,
                            "reparsedEqual": again.is_ok_and(|again| again == parsed),
                        })
                    }
                })
            })
        }),
        "parseFormula" => text_argument(args, "source").and_then(|source| {
            object_list_argument(args, "objects").and_then(|objects| {
                let table = match args.get("tableObjectId") {
                    None => None,
                    Some(_) => Some(text_argument(args, "tableObjectId")?),
                };
                Ok(match parse_formula(&source, &objects, table.as_deref()) {
                    Ok(ast) => encode_ast(&ast),
                    Err(error) => json!({
                        "error": error.error.as_str(),
                        "message": error.message,
                        "start": error.start,
                    }),
                })
            })
        }),
        "lex" => text_argument(args, "source").map(|source| match lex(&source) {
            Err(error) => json!({
                "error": "#PARSE",
                "message": error.message,
                "start": error.start,
            }),
            Ok(tokens) => Json::Array(
                tokens
                    .iter()
                    .map(|token| {
                        let mut held = Map::new();
                        held.insert("type".into(), json!(token.kind.as_str()));
                        held.insert("text".into(), json!(token.text));
                        held.insert("start".into(), json!(token.start));
                        match &token.kind {
                            TokenKind::Number(number) => {
                                held.insert("value".into(), encode_number(*number));
                            }
                            TokenKind::Text(text) => {
                                held.insert("value".into(), json!(text));
                            }
                            TokenKind::Boolean(boolean) => {
                                held.insert("value".into(), json!(boolean));
                            }
                            _ => {}
                        }
                        Json::Object(held)
                    })
                    .collect(),
            ),
        }),
        "isLegalPortName" => {
            text_argument(args, "name").map(|name| json!(is_legal_port_name(&name)))
        }
        "nearestName" => text_argument(args, "typed").and_then(|typed| {
            text_list_argument(args, "candidates").map(|candidates| {
                match nearest_name(&typed, candidates.iter().map(String::as_str)) {
                    None => Json::Null,
                    Some(nearest) => json!(nearest),
                }
            })
        }),
        "addressKey" => {
            address_argument(args, "address").map(|address| json!(address_key(&address)))
        }
        "parseAddress" => text_argument(args, "input").and_then(|input| {
            object_list_argument(args, "objects").map(|objects| {
                match parse_address(&input, &objects) {
                    Ok(address) => encode_address(&address),
                    Err(error) => encode_address_error(&error),
                }
            })
        }),
        "formatAddress" => address_argument(args, "address").and_then(|address| {
            object_list_argument(args, "objects").map(|objects| {
                match format_address(&address, &objects) {
                    Ok(text) => json!(text),
                    Err(error) => encode_address_error(&error),
                }
            })
        }),
        _ => return None,
    };
    Some(result)
}

fn ascii_letters_argument(args: &Map<String, Json>, name: &str) -> Result<String, String> {
    let text = text_argument(args, name)?;
    if text
        .chars()
        .all(|character| character.is_ascii_alphabetic())
    {
        Ok(text)
    } else {
        Err(format!(
            "the argument \"{name}\" holds only letters from the ASCII alphabet"
        ))
    }
}

fn run_case(call: &str, args: &Map<String, Json>) -> Outcome {
    match answer(call, args) {
        None => Outcome::Unsupported(format!(
            "the call \"{call}\" has no Rust implementation yet"
        )),
        Some(Ok(value)) => Outcome::Ok(value),
        Some(Err(detail)) => Outcome::Bad(detail),
    }
}

/// Every fixture file under a directory, in the order their names sort, so two
/// runs over the same directory produce the same report.
fn fixture_files(directory: &Path) -> Result<Vec<PathBuf>, String> {
    let entries =
        fs::read_dir(directory).map_err(|error| format!("{}: {error}", directory.display()))?;
    let mut files = Vec::new();
    for entry in entries {
        let entry = entry.map_err(|error| format!("{}: {error}", directory.display()))?;
        let path = entry.path();
        if path
            .extension()
            .is_some_and(|extension| extension == "json")
        {
            files.push(path);
        }
    }
    files.sort();
    Ok(files)
}

fn read_fixture(path: &Path) -> Result<Json, String> {
    let text = fs::read_to_string(path).map_err(|error| format!("{}: {error}", path.display()))?;
    let document: Json =
        serde_json::from_str(&text).map_err(|error| format!("{}: {error}", path.display()))?;
    let version = document.get("fixtureVersion").and_then(Json::as_u64);
    if version != Some(FIXTURE_VERSION) {
        return Err(format!(
            "{}: the fixture version is {:?} and this runner reads version {FIXTURE_VERSION}",
            path.display(),
            version
        ));
    }
    if document.get("id").and_then(Json::as_str).is_none() {
        return Err(format!("{}: the fixture has no id", path.display()));
    }
    if document.get("cases").and_then(Json::as_array).is_none() {
        return Err(format!(
            "{}: the fixture has no list of cases",
            path.display()
        ));
    }
    Ok(document)
}

fn run_fixture(document: &Json, path: &Path, results: &mut Vec<Json>) -> Result<(), String> {
    let id = document["id"].as_str().expect("a fixture id is text");
    for (index, case) in document["cases"]
        .as_array()
        .expect("a fixture holds a list of cases")
        .iter()
        .enumerate()
    {
        let call = case
            .get("call")
            .and_then(Json::as_str)
            .ok_or_else(|| format!("{}: case {index} of {id} names no call", path.display()))?;
        let empty = Map::new();
        let args = match case.get("args") {
            None => &empty,
            Some(Json::Object(object)) => object,
            Some(_) => {
                return Err(format!(
                    "{}: case {index} of {id} carries arguments that are not an object",
                    path.display()
                ));
            }
        };
        results.push(json!({
            "fixture": id,
            "case": index,
            "name": case.get("name").and_then(Json::as_str).unwrap_or(""),
            "call": call,
            "outcome": run_case(call, args).to_json(),
        }));
    }
    Ok(())
}

fn option(name: &str) -> Option<String> {
    let mut arguments = std::env::args().skip(1);
    while let Some(argument) = arguments.next() {
        if argument == format!("--{name}") {
            return arguments.next();
        }
        if let Some(value) = argument.strip_prefix(&format!("--{name}=")) {
            return Some(value.to_string());
        }
    }
    None
}

fn run() -> Result<(), String> {
    if std::env::args().any(|argument| argument == "--calls") {
        println!("{}", json!({ "engine": "rust", "calls": SUPPORTED_CALLS }));
        return Ok(());
    }
    let fixtures = option("fixtures").ok_or("the --fixtures option names the directory to read")?;
    let out = option("out").ok_or("the --out option names the results file to write")?;

    let mut results = Vec::new();
    let files = fixture_files(Path::new(&fixtures))?;
    if files.is_empty() {
        return Err(format!("{fixtures}: no fixture files"));
    }
    for file in &files {
        let document = read_fixture(file)?;
        run_fixture(&document, file, &mut results)?;
    }

    let report = json!({
        "engine": "rust",
        "runnerVersion": RUNNER_VERSION,
        "supportedCalls": SUPPORTED_CALLS,
        "results": results,
    });
    fs::write(
        &out,
        format!(
            "{}\n",
            serde_json::to_string_pretty(&report).map_err(|error| error.to_string())?
        ),
    )
    .map_err(|error| format!("{out}: {error}"))?;
    eprintln!(
        "rust runner: {} cases from {} fixtures",
        results.len(),
        files.len()
    );
    Ok(())
}

fn main() -> ExitCode {
    match run() {
        Ok(()) => ExitCode::SUCCESS,
        Err(message) => {
            eprintln!("{message}");
            ExitCode::FAILURE
        }
    }
}
