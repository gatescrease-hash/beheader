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
use beheader_engine::formula::format::format_formula;
use beheader_engine::formula::lexer::{TokenKind, lex};
use beheader_engine::formula::parser::parse_formula;
use beheader_engine::graph::address_key;
use beheader_engine::model::{
    ObjectType, has_illegal_number, is_error_value, is_illegal_number, is_legal_port_name, slot_key,
};
use beheader_engine::number::to_javascript_text;
use beheader_engine::wire::{decode_number, decode_value, encode_number, encode_value};
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
    "formatAddress",
    "formatFormula",
    "formatCellReference",
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
    "parseFormula",
    "parseThenFormat",
    "parseCellReference",
    "slotKey",
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

fn encode_address(address: &Address) -> Json {
    json!({ "objectId": address.object_id, "path": address.path })
}

/// A formula tree as JSON, with a literal number carried in the tagged form the
/// fixtures use so a tree holding 1e21 compares by the text both engines print.
fn encode_ast(ast: &FormulaAst) -> Json {
    fn address(address: &beheader_engine::address::Address) -> Json {
        json!({ "objectId": address.object_id, "path": address.path })
    }
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

fn answer(call: &str, args: &Map<String, Json>) -> Option<Answer> {
    let result: Answer = match call {
        "numberToText" => {
            number_argument(args, "number").map(|number| json!(to_javascript_text(number)))
        }
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
                Ok(ast) => json!({ "ok": true, "exceeds": exceeds_max_formula_ast_depth(&ast) }),
                Err(reason) => json!({ "ok": false, "reason": reason }),
            }
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
