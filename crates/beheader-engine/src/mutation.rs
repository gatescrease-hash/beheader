//! Rebuilds the whole edge set out of stored trees and the schema, checks that
//! the graph the edges describe is one the document can hold, and runs one
//! evaluation pass over it.
//!
//! The edge set is derived from scratch every time. An edge therefore cannot go
//! stale or outlive the slot it pointed at, and nothing outside this file builds
//! one. Slot paths come through the schema resolver, so a dynamic family of
//! slots is enumerated the same way here as in the two integrity checks and in
//! evaluation.
//!
//! The checks run in a fixed order, and the order is the behaviour. An
//! undeclared slot is reported before anything else, because a cycle check over
//! an edge set nobody trusts proves nothing. A dangling reference is reported
//! before a cycle for the same reason.
//!
//! The operations a batch can carry arrive with `RUST-011`. What is here is the
//! derivation, the checks and the pass those operations run between them.
//!
//! The port of the derivation half of `src/engine/mutation.ts`.

use std::collections::HashMap;

use crate::address::{
    Address, TABLE_CELL_PATH_PREFIX, check_name_available, format_address, name_suggestion,
};
use crate::formula::ast::{FormulaAst, LiteralValue};
use crate::formula::deps::{
    Dependency, extract_dependencies, repair_addresses_in_ast, rewrite_addresses_in_ast,
};
use crate::graph::cycles::{CycleCheck, detect_cycle};
use crate::graph::eval::evaluate;
use crate::graph::{Edge, address_key};
use crate::measure::Measurer;
use crate::model::{
    GraphObject, GraphObjectPorts, ObjectType, Point, Slot, SlotMap, Value, has_illegal_number,
    is_illegal_number, is_legal_port_name, resolve_slot, slot_key,
};
use crate::number::to_javascript_text;
use crate::number::{js_max, js_min};
use crate::primitives::doc::document_variable_name_problem;
use crate::primitives::geometry::{
    ExplodeResult, VertexRepair, add_vertex_to_object, delete_vertex_from_object,
    explode_object_to_polyline, insert_vertex_into_object, is_explodable, polyline_edge_count,
    repair_vertex_address_for_delete, shift_vertex_address_for_delete,
    shift_vertex_address_for_insert, split_polyline_edge, vertex_part_paths,
};
use crate::primitives::math::{
    apply_math_source, math_source_path, read_math_names, rewrite_math_references,
    unresolved_math_references,
};
use crate::primitives::schema::{
    derived_slot_dependency_addresses, get_object_schema, resolve_derived_slots,
    resolve_non_derived_slot_paths,
};
use crate::primitives::table::{
    CellRepair, MAX_TABLE_LINES, MIN_TABLE_LINES, RangeRepair, TableAxis, delete_table_line,
    enumerate_range_cell_addresses, get_table_dimensions, insert_table_line,
    is_in_extent_table_cell_address, is_table_dimension_resizable, repair_cell_address_for_delete,
    repair_range_endpoints_for_delete, shift_cell_address_for_insert,
};
use crate::primitives::text::rewrite_text_references;

/// Rebuilds the whole edge set from stored trees and from the schema. It reads
/// slot paths through the schema resolver, and it never takes a key apart.
pub fn derive_edges(objects: &[GraphObject<FormulaAst>]) -> Vec<Edge> {
    let mut edges = Vec::new();
    for object in objects {
        let Some(schema) = get_object_schema::<FormulaAst>(object.object_type) else {
            continue;
        };
        for path in resolve_non_derived_slot_paths(object, &schema.non_derived_slot_paths) {
            let Some(Slot::Formula { ast, .. }) = object.get_slot(&path) else {
                continue;
            };
            let dependent_slot = Address {
                object_id: object.id.clone(),
                path,
            };
            for dependency in extract_dependencies(ast) {
                push_dependency_edges(&mut edges, dependency, &dependent_slot, objects);
            }
        }
        for entry in resolve_derived_slots(object, schema.derived_slots) {
            let dependent_slot = Address {
                object_id: object.id.clone(),
                path: entry.path.clone(),
            };
            for source_slot in
                derived_slot_dependency_addresses(object, &entry.dependencies, objects)
            {
                edges.push(Edge {
                    source_slot,
                    dependent_slot: dependent_slot.clone(),
                });
            }
        }
    }
    edges
}

/// The edges one dependency of one formula contributes.
///
/// An empty cell inside the extent of a real table contributes none, because an
/// empty cell is ordinary state rather than a dangling reference, and a range
/// contributes one edge for each cell that holds something.
fn push_dependency_edges(
    edges: &mut Vec<Edge>,
    dependency: Dependency,
    dependent_slot: &Address,
    objects: &[GraphObject<FormulaAst>],
) {
    match dependency {
        Dependency::Reference(address) => {
            if resolve_slot(&address, objects).is_none()
                && is_in_extent_table_cell_address(&address, objects)
            {
                return;
            }
            edges.push(Edge {
                source_slot: address,
                dependent_slot: dependent_slot.clone(),
            });
        }
        Dependency::Range { start, end } => {
            let Some(table) = objects
                .iter()
                .find(|candidate| candidate.id == start.object_id)
            else {
                edges.push(Edge {
                    source_slot: start,
                    dependent_slot: dependent_slot.clone(),
                });
                return;
            };
            let Ok(cells) = enumerate_range_cell_addresses(&start, &end, table) else {
                edges.push(Edge {
                    source_slot: start,
                    dependent_slot: dependent_slot.clone(),
                });
                return;
            };
            for cell in cells {
                if table.get_slot(&cell.path).is_none() {
                    continue;
                }
                edges.push(Edge {
                    source_slot: cell,
                    dependent_slot: dependent_slot.clone(),
                });
            }
        }
    }
}

/// Why a graph is not one the document can hold.
pub type IntegrityCheck = Result<(), String>;

fn named(address: &Address, objects: &[GraphObject<FormulaAst>]) -> String {
    match format_address(address, objects) {
        Ok(name) => name,
        Err(failure) => failure.message,
    }
}

/// Runs the checks in the order their wording depends on. An undeclared slot
/// comes first, because a later cycle check over an edge set that nobody trusts
/// proves nothing.
pub fn validate_integrity(objects: &[GraphObject<FormulaAst>], edges: &[Edge]) -> IntegrityCheck {
    check_document_shape(objects)?;
    join_problems(find_undeclared_formula_or_derived_slots(objects))?;
    join_problems(find_schema_slot_kind_mismatches(objects))?;
    join_problems(find_dangling_references(objects, edges))?;
    join_problems(find_illegal_slot_values(objects))?;
    Ok(())
}

fn join_problems(problems: Vec<String>) -> IntegrityCheck {
    if problems.is_empty() {
        Ok(())
    } else {
        Err(problems.join("; "))
    }
}

/// The doc object is a singleton under a fixed name, because a bare name
/// resolves against it and a second one would make that resolution a choice. A
/// variable name is checked here as well as at the command, so a document that
/// arrives from a file cannot carry a name a command would have refused.
fn check_document_shape(objects: &[GraphObject<FormulaAst>]) -> IntegrityCheck {
    let docs: Vec<&GraphObject<FormulaAst>> = objects
        .iter()
        .filter(|object| object.object_type == ObjectType::Doc)
        .collect();
    if docs.len() > 1 {
        return Err("the document can have only one doc object".to_string());
    }
    for object in objects {
        if object.object_type != ObjectType::Doc && object.name.to_lowercase() == "doc" {
            return Err("the name doc belongs to the document variables".to_string());
        }
        if object.object_type == ObjectType::Doc {
            if object.name != "doc" {
                return Err("the document variable object is named doc".to_string());
            }
            for name in object.slots.keys() {
                if let Some(problem) = document_variable_name_problem(name, objects, Some(name)) {
                    return Err(problem);
                }
            }
        }
        // A copy holds its address outside the slot set, so the integrity check
        // is the one place that pairs it with a variable that exists. Nothing
        // else carries a target, and a target elsewhere would be state that no
        // evaluation reads.
        if object.object_type == ObjectType::Docref {
            let points_at_a_variable = object.target.as_ref().is_some_and(|target| {
                docs.first().is_some_and(|doc| {
                    target.object_id == doc.id
                        && target.path.len() == 1
                        && doc.get_slot(&target.path).is_some()
                })
            });
            if !points_at_a_variable {
                return Err(format!(
                    "{} must target an existing document variable",
                    object.name
                ));
            }
        } else if object.target.is_some() {
            return Err(format!("{} cannot carry a variable target", object.name));
        }
    }
    Ok(())
}

fn describe_slot<A>(object: &GraphObject<A>, key: &str) -> String {
    format!("{}.{key}", object.name)
}

fn kind_of<A>(slot: &Slot<A>) -> &'static str {
    match slot {
        Slot::Literal { .. } => "literal",
        Slot::Formula { .. } => "formula",
        Slot::Derived { .. } => "derived",
    }
}

/// A formula or derived slot at a path the schema does not declare carries no
/// edges, so it would evaluate against inputs nobody derived.
fn find_undeclared_formula_or_derived_slots(objects: &[GraphObject<FormulaAst>]) -> Vec<String> {
    let mut problems = Vec::new();
    for object in objects {
        let Some(schema) = get_object_schema::<FormulaAst>(object.object_type) else {
            continue;
        };
        let mut declared: Vec<String> =
            resolve_non_derived_slot_paths(object, &schema.non_derived_slot_paths)
                .iter()
                .map(|path| slot_key(path))
                .collect();
        declared.extend(
            resolve_derived_slots(object, schema.derived_slots)
                .iter()
                .map(|entry| slot_key(&entry.path)),
        );
        for (key, slot) in object.slots.iter() {
            let is_computed = matches!(slot, Slot::Formula { .. } | Slot::Derived { .. });
            if is_computed && !declared.iter().any(|held| held == key) {
                problems.push(format!(
                    "{} is a \"{}\" slot that object type \"{}\"'s schema does not declare — its edges were silently omitted",
                    describe_slot(object, key),
                    kind_of(slot),
                    object.object_type.as_str()
                ));
            }
        }
    }
    problems
}

/// A derived slot can never become a literal one, and a literal path can never
/// become derived, because the edge set is derived from the schema and a slot
/// that disagreed with it would be computed by nothing.
fn find_schema_slot_kind_mismatches(objects: &[GraphObject<FormulaAst>]) -> Vec<String> {
    let mut problems = Vec::new();
    for object in objects {
        let Some(schema) = get_object_schema::<FormulaAst>(object.object_type) else {
            continue;
        };
        for entry in resolve_derived_slots(object, schema.derived_slots) {
            let held = object.get_slot(&entry.path);
            if matches!(held, Some(Slot::Derived { .. })) {
                continue;
            }
            let address = Address {
                object_id: object.id.clone(),
                path: entry.path.clone(),
            };
            let reason = match held {
                None => "is missing — deriveEdges still emits an edge into it, pointing at a slot that does not exist".to_string(),
                Some(slot) => format!(
                    "is a \"{}\" slot where its schema declares \"derived\" — derived slots can never be converted",
                    kind_of(slot)
                ),
            };
            problems.push(format!("{} {reason}", named(&address, objects)));
        }
        for path in resolve_non_derived_slot_paths(object, &schema.non_derived_slot_paths) {
            if !matches!(object.get_slot(&path), Some(Slot::Derived { .. })) {
                continue;
            }
            let address = Address {
                object_id: object.id.clone(),
                path,
            };
            problems.push(format!(
                "{} is a \"derived\" slot at a path its schema declares non-derived — derived slots can never be converted",
                named(&address, objects)
            ));
        }
    }
    problems
}

/// An edge whose source is a slot nobody carries. The message names every
/// dependent of that source at once, and offers the nearest slot the object does
/// carry.
fn find_dangling_references(objects: &[GraphObject<FormulaAst>], edges: &[Edge]) -> Vec<String> {
    let mut order: Vec<String> = Vec::new();
    let mut dependents: HashMap<String, Vec<Address>> = HashMap::new();
    let mut sources: HashMap<String, Address> = HashMap::new();
    for edge in edges {
        if resolve_slot(&edge.source_slot, objects).is_some() {
            continue;
        }
        let key = address_key(&edge.source_slot);
        if !dependents.contains_key(&key) {
            order.push(key.clone());
            sources.insert(key.clone(), edge.source_slot.clone());
        }
        dependents
            .entry(key)
            .or_default()
            .push(edge.dependent_slot.clone());
    }

    let mut problems = Vec::new();
    for key in order {
        let holders = &dependents[&key];
        let names: Vec<String> = holders
            .iter()
            .map(|address| named(address, objects))
            .collect();
        let verb = if names.len() == 1 {
            "references"
        } else {
            "reference"
        };
        let source = &sources[&key];
        let object = objects
            .iter()
            .find(|candidate| candidate.id == source.object_id);
        let mut detail = String::new();
        if let Some(object) = object
            && let Some(schema) = get_object_schema::<FormulaAst>(object.object_type)
        {
            let mut candidates: Vec<String> =
                resolve_non_derived_slot_paths(object, &schema.non_derived_slot_paths)
                    .into_iter()
                    .map(|path| {
                        named(
                            &Address {
                                object_id: object.id.clone(),
                                path,
                            },
                            objects,
                        )
                    })
                    .collect();
            candidates.extend(
                resolve_derived_slots(object, schema.derived_slots)
                    .iter()
                    .map(|entry| {
                        named(
                            &Address {
                                object_id: object.id.clone(),
                                path: entry.path.clone(),
                            },
                            objects,
                        )
                    }),
            );
            let typed = named(source, objects);
            let suggestion = name_suggestion(&typed, candidates.iter().map(String::as_str));
            detail = format!(": {typed}{suggestion}");
        }
        problems.push(format!(
            "{} {verb} a slot that does not exist{detail}",
            names.join(", ")
        ));
    }
    problems
}

fn format_illegal_number(number: f64) -> String {
    if number == 0.0 && number.is_sign_negative() {
        "-0".to_string()
    } else {
        to_javascript_text(number)
    }
}

fn describe_point(at: Point) -> String {
    format!(
        "{{ x: {}, y: {} }}",
        format_illegal_number(at.x),
        format_illegal_number(at.y)
    )
}

/// A value as the refusal names it.
///
/// Only a number, a point or a list of points can hold an illegal number, so
/// those three carry a spelling of their own. The rest reach this through the
/// same fallback the TypeScript reaches, which is what `String(value)` writes
/// for each of them, and an object written that way is `[object Object]`.
fn describe_illegal_value(value: &Value) -> String {
    match value {
        Value::Number(number) => format_illegal_number(*number),
        Value::Points(points) => format!(
            "[{}]",
            points
                .iter()
                .map(|at| describe_point(*at))
                .collect::<Vec<_>>()
                .join(", ")
        ),
        Value::Point(at) => describe_point(*at),
        Value::Null => "null".to_string(),
        Value::Boolean(boolean) => boolean.to_string(),
        Value::Text(text) => text.clone(),
        Value::Error(_) => "[object Object]".to_string(),
    }
}

fn collect_illegal_ast_literals(ast: &FormulaAst, out: &mut Vec<f64>) {
    match ast {
        FormulaAst::Literal(LiteralValue::Number(number)) => {
            if is_illegal_number(*number) {
                out.push(*number);
            }
        }
        FormulaAst::Literal(_)
        | FormulaAst::Reference(_)
        | FormulaAst::Range { .. }
        | FormulaAst::Error => {}
        FormulaAst::BinaryOp { left, right, .. } => {
            collect_illegal_ast_literals(left, out);
            collect_illegal_ast_literals(right, out);
        }
        FormulaAst::UnaryOp { operand, .. } => collect_illegal_ast_literals(operand, out),
        FormulaAst::FunctionCall { args, .. } => {
            for arg in args {
                collect_illegal_ast_literals(arg, out);
            }
        }
    }
}

/// A value the graph refuses to hold, in a slot or inside a stored tree. A
/// negative zero and a non-finite number are both refused, because a document
/// that carried one would compare unequal to itself across a save.
fn find_illegal_slot_values(objects: &[GraphObject<FormulaAst>]) -> Vec<String> {
    let mut problems = Vec::new();
    for object in objects {
        for (key, slot) in object.slots.iter() {
            if has_illegal_number(slot.value()) {
                problems.push(format!(
                    "{} holds an illegal value ({}), which is not legal document state",
                    describe_slot(object, key),
                    describe_illegal_value(slot.value())
                ));
            }
            if let Slot::Formula { ast, .. } = slot {
                let mut illegal = Vec::new();
                collect_illegal_ast_literals(ast, &mut illegal);
                if !illegal.is_empty() {
                    problems.push(format!(
                        "{}'s stored formula holds illegal number literal(s) ({}), which is not legal document state",
                        describe_slot(object, key),
                        illegal
                            .iter()
                            .map(|number| format_illegal_number(*number))
                            .collect::<Vec<_>>()
                            .join(", ")
                    ));
                }
            }
        }
    }
    problems
}

/// What one derivation, check and evaluation left behind.
pub type GraphEvaluation = Result<Vec<GraphObject<FormulaAst>>, String>;

/// Derives the edges, checks the graph they describe, refuses a cycle, and
/// evaluates. The three steps run in this order because a cycle check over an
/// edge set the integrity check would have refused proves nothing about the
/// document.
pub fn derive_validate_and_evaluate(
    objects: &[GraphObject<FormulaAst>],
    measurer: Option<&dyn Measurer>,
) -> GraphEvaluation {
    let edges = derive_edges(objects);
    validate_integrity(objects, &edges)?;
    if let CycleCheck::Found(cycle) = detect_cycle(&edges) {
        return Err(format_cycle_rejection(&cycle, objects));
    }
    Ok(evaluate(objects, &edges, measurer))
}

fn format_cycle_rejection(cycle: &[Address], objects: &[GraphObject<FormulaAst>]) -> String {
    let mut names: Vec<String> = cycle
        .iter()
        .map(|address| named(address, objects))
        .collect();
    if let Some(first) = names.first().cloned() {
        names.push(first);
    }
    format!("cyclic dependency: {}", names.join(" → "))
}

/// What a batch asks the document to do.
///
/// The inventory has fifteen members. The families arrive one at a time under
/// `RUST-011`, and this union carries the ones that have landed rather than
/// every name with a body that answers nothing, so what is missing is visible
/// in the type rather than at the first call that meets it.
#[derive(Clone, Debug, PartialEq)]
pub enum Operation {
    CreateObject {
        object: Box<GraphObject<FormulaAst>>,
    },
    SetSlot {
        address: Address,
        slot: Slot<FormulaAst>,
    },
    ClearSlot {
        address: Address,
    },
    RenameObject {
        object_id: String,
        name: String,
    },
    /// Renaming a variable moves the slot and every reader of it in one pass. A
    /// variable has no id behind its name, unlike an object, so the name is the
    /// address and a reader left alone would point at a slot that is gone.
    RenameVariable {
        address: Address,
        name: String,
    },
    /// Removes an object. Without the force flag a formula that read it leaves
    /// the batch refused with the reader named, which is the refusal path of
    /// section 4. With it, every reference into the object is rewritten to a
    /// reference error and the addresses that were rewritten come back for the
    /// caller to report.
    DeleteObject {
        object_id: String,
        force: bool,
    },
    /// Adds one row or column and shifts every cell after it, rewriting the
    /// addresses of every formula that named one of those cells.
    InsertTableLine {
        object_id: String,
        axis: TableAxis,
        index: f64,
    },
    /// Removes one row or column. Every reference into the line that went
    /// becomes a reference error and is reported, because refusing would leave
    /// an operator unable to delete a row that anything reads.
    DeleteTableLine {
        object_id: String,
        axis: TableAxis,
        index: f64,
    },
    /// Adds one port to a node. The name and the value it holds land in one
    /// batch, because the moment an out port exists the integrity check demands
    /// that every address it declares resolves to a real slot.
    AddPort {
        object_id: String,
        family: PortFamily,
        name: String,
    },
    RemovePort {
        object_id: String,
        family: PortFamily,
        name: String,
    },
    /// Writes the source of a math object and rebuilds the slots that source
    /// implies: an input slot for each free name and an export slot for each
    /// name the source defines.
    ///
    /// The slot set changes here, inside a mutation, rather than during
    /// evaluation, so rule 4 holds for an object whose slots come from text an
    /// operator typed. A source that does not parse fails the whole mutation, so
    /// the exports of the last source that did parse stay where their readers
    /// expect them.
    SetMathSource {
        object_id: String,
        source: String,
    },
    AddVertex {
        object_id: String,
        point: Point,
    },
    /// Removes one vertex and renumbers every later one. Without the force flag
    /// a formula naming the exact vertex leaves the batch refused, and with it
    /// that reference becomes a reference error and is reported.
    DeleteVertex {
        object_id: String,
        index: f64,
        force: bool,
    },
    /// Snapshots a preset into an editable polyline. Without the force flag a
    /// formula naming a parameter slot the snapshot drops leaves the batch
    /// refused.
    Explode {
        object_id: String,
        force: bool,
    },
    /// Cuts one edge at the point on it nearest the given point, and puts a
    /// vertex there. An arc becomes two arcs of the same circle, so the shape on
    /// screen holds still. There is no force flag, because an insert loses no
    /// vertex.
    SplitEdge {
        object_id: String,
        index: f64,
        point: Point,
    },
}

/// Which side of a node a port sits on.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PortFamily {
    In,
    Out,
}

impl PortFamily {
    pub fn as_str(self) -> &'static str {
        match self {
            PortFamily::In => "in",
            PortFamily::Out => "out",
        }
    }
}

impl Operation {
    /// The object an operation acts on. A batch reads this to know which
    /// objects have to exist by the time each operation runs.
    fn target_id(&self) -> &str {
        match self {
            Operation::CreateObject { object } => &object.id,
            Operation::SetSlot { address, .. }
            | Operation::ClearSlot { address }
            | Operation::RenameVariable { address, .. } => &address.object_id,
            Operation::RenameObject { object_id, .. }
            | Operation::DeleteObject { object_id, .. }
            | Operation::InsertTableLine { object_id, .. }
            | Operation::DeleteTableLine { object_id, .. }
            | Operation::AddPort { object_id, .. }
            | Operation::RemovePort { object_id, .. }
            | Operation::SetMathSource { object_id, .. }
            | Operation::AddVertex { object_id, .. }
            | Operation::DeleteVertex { object_id, .. }
            | Operation::Explode { object_id, .. }
            | Operation::SplitEdge { object_id, .. } => object_id,
        }
    }

    /// How a refusal names what the operation was trying to do.
    fn describe(&self) -> String {
        match self {
            Operation::CreateObject { object } => {
                format!("attempts to create object id \"{}\"", object.id)
            }
            Operation::RenameObject { object_id, name } => {
                format!("attempts to rename object id \"{object_id}\" to \"{name}\"")
            }
            Operation::DeleteObject { object_id, .. } => {
                format!("attempts to delete object id \"{object_id}\"")
            }
            Operation::InsertTableLine {
                object_id, axis, ..
            } => format!(
                "attempts to insert a {} into object id \"{object_id}\"",
                axis.as_str()
            ),
            Operation::DeleteTableLine {
                object_id, axis, ..
            } => format!(
                "attempts to delete a {} from object id \"{object_id}\"",
                axis.as_str()
            ),
            Operation::AddPort {
                object_id,
                family,
                name,
            } => format!(
                "attempts to add {} port \"{name}\" to object id \"{object_id}\"",
                family.as_str()
            ),
            Operation::RemovePort {
                object_id,
                family,
                name,
            } => format!(
                "attempts to remove {} port \"{name}\" from object id \"{object_id}\"",
                family.as_str()
            ),
            Operation::SetMathSource { object_id, .. } => {
                format!("attempts to write the source of object id \"{object_id}\"")
            }
            Operation::AddVertex { object_id, .. } => {
                format!("attempts to add a vertex to object id \"{object_id}\"")
            }
            Operation::DeleteVertex {
                object_id, index, ..
            } => format!(
                "attempts to delete vertex {} from object id \"{object_id}\"",
                to_javascript_text(*index)
            ),
            Operation::Explode { object_id, .. } => {
                format!("attempts to explode object id \"{object_id}\"")
            }
            Operation::SplitEdge {
                object_id, index, ..
            } => format!(
                "attempts to split edge {} of object id \"{object_id}\"",
                to_javascript_text(*index)
            ),
            Operation::SetSlot { address, .. }
            | Operation::ClearSlot { address }
            | Operation::RenameVariable { address, .. } => format!(
                "targets slot \"{}\" on object id \"{}\"",
                slot_key(&address.path),
                address.object_id
            ),
        }
    }
}

/// One batch that was accepted, as the journal records it.
#[derive(Clone, Debug, PartialEq)]
pub struct MutationJournalEntry {
    pub operations: Vec<Operation>,
}

/// What a batch left behind.
#[derive(Clone, Debug, PartialEq)]
pub struct Mutation {
    pub objects: Vec<GraphObject<FormulaAst>>,
    pub journal: Vec<MutationJournalEntry>,
    /// The addresses a forced repair rewrote to a reference error, for the
    /// caller to report. A batch that forced nothing leaves this empty.
    pub broken_slots: Vec<Address>,
}

pub type MutationResult = Result<Mutation, String>;

/// Runs a batch. It commits in full or leaves the objects and the journal
/// exactly as they arrived, so a refusal at the last operation undoes the first.
///
/// The checks run before any operation is applied, in the order their wording
/// depends on. A missing target is reported first, because every later check
/// reads the objects an operation names.
pub fn mutate(
    objects: &[GraphObject<FormulaAst>],
    operations: &[Operation],
    journal: &[MutationJournalEntry],
    measurer: Option<&dyn Measurer>,
) -> MutationResult {
    if operations.is_empty() {
        return Err("a mutation batch must contain at least one operation".to_string());
    }

    check_targets_exist(objects, operations)?;
    join_problems(find_illegal_operation_payloads(operations, objects))?;
    join_problems(find_invalid_table_resizes(operations, objects))?;
    join_problems(find_illegal_slot_clears(operations, objects))?;
    join_problems(find_invalid_dimension_writes(operations, objects))?;
    join_problems(find_invalid_names(operations, objects))?;
    join_problems(find_invalid_port_operations(operations, objects))?;
    join_problems(find_invalid_math_sources(operations, objects))?;
    join_problems(find_invalid_vertex_operations(operations, objects))?;
    join_problems(find_invalid_explode_operations(operations, objects))?;
    join_problems(find_invalid_split_operations(operations, objects))?;

    // The fold runs one operation at a time against the objects the last one
    // produced, because the refusals below read the state a batch has reached
    // rather than the state it started from. A batch that creates a variable
    // and then renames it has to see the variable the first operation made.
    let mut folded: Vec<GraphObject<FormulaAst>> = objects.to_vec();
    let mut broken_slots: Vec<Address> = Vec::new();
    for operation in operations {
        let target = folded
            .iter()
            .find(|object| object.id == operation.target_id())
            .cloned();
        // Deleting the doc object would take every variable with it under a
        // command that names none of them, so a variable is removed one at a
        // time instead.
        if let Operation::DeleteObject { .. } = operation
            && target
                .as_ref()
                .is_some_and(|held| held.object_type == ObjectType::Doc)
        {
            return Err("document variables are removed individually with delvar".to_string());
        }
        if let Operation::RenameVariable { address, name } = operation {
            let names_a_variable = target.as_ref().is_some_and(|held| {
                held.object_type == ObjectType::Doc
                    && address.path.len() == 1
                    && held.get_slot(&address.path).is_some()
            });
            if !names_a_variable {
                return Err("renameVariable needs an existing document variable".to_string());
            }
            if let Some(problem) = document_variable_name_problem(
                name,
                &folded,
                address.path.first().map(String::as_str),
            ) {
                return Err(problem);
            }
        }
        // Deleting a variable that something reads is refused with the reader
        // named, which is the refusal path of section 4 rather than a reference
        // quietly going nowhere. A copy is not a reader for this purpose: it
        // draws the variable and nothing else, so it goes when the variable
        // goes, which is what the clear branch below does.
        if let Operation::ClearSlot { address } = operation
            && target
                .as_ref()
                .is_some_and(|held| held.object_type == ObjectType::Doc)
        {
            let readers = readers_of(&folded, address);
            if !readers.is_empty() {
                return Err(format!(
                    "{} is read by {}",
                    named(address, &folded),
                    readers.join(", ")
                ));
            }
        }
        let applied = apply_operation(&folded, operation);
        folded = applied.0;
        broken_slots.extend(applied.1);
    }

    let evaluated = derive_validate_and_evaluate(&folded, measurer)?;
    let mut entries = journal.to_vec();
    entries.push(MutationJournalEntry {
        operations: operations.to_vec(),
    });
    Ok(Mutation {
        objects: evaluated.clone(),
        journal: entries,
        broken_slots: surviving(dedupe_addresses(broken_slots), &evaluated),
    })
}

/// The slots that read one address, named the way a refusal names them, with a
/// copy of the variable left out because a copy goes when the variable goes.
fn readers_of(objects: &[GraphObject<FormulaAst>], address: &Address) -> Vec<String> {
    let own = address_key(address);
    let mut seen: Vec<String> = Vec::new();
    for edge in derive_edges(objects) {
        if address_key(&edge.source_slot) != own || address_key(&edge.dependent_slot) == own {
            continue;
        }
        let dependent = objects
            .iter()
            .find(|object| object.id == edge.dependent_slot.object_id);
        if dependent.is_some_and(|object| object.object_type == ObjectType::Docref) {
            continue;
        }
        let name = named(&edge.dependent_slot, objects);
        if !seen.contains(&name) {
            seen.push(name);
        }
    }
    seen
}

fn dedupe_addresses(addresses: Vec<Address>) -> Vec<Address> {
    let mut seen: Vec<String> = Vec::new();
    let mut deduped = Vec::new();
    for address in addresses {
        let key = address_key(&address);
        if seen.contains(&key) {
            continue;
        }
        seen.push(key);
        deduped.push(address);
    }
    deduped
}

/// The repaired addresses that still name a slot after the pass, because one
/// that went with its object is not something a caller can report on.
fn surviving(addresses: Vec<Address>, objects: &[GraphObject<FormulaAst>]) -> Vec<Address> {
    addresses
        .into_iter()
        .filter(|address| {
            objects
                .iter()
                .find(|object| object.id == address.object_id)
                .is_some_and(|object| object.get_slot(&address.path).is_some())
        })
        .collect()
}

/// Every operation names an object that exists by the time it runs. A create
/// adds its id to the set, so a later operation in the same batch can act on the
/// object the create made.
fn check_targets_exist(
    objects: &[GraphObject<FormulaAst>],
    operations: &[Operation],
) -> IntegrityCheck {
    let mut surviving_ids: Vec<String> = objects.iter().map(|object| object.id.clone()).collect();
    let mut problems = Vec::new();
    for (index, operation) in operations.iter().enumerate() {
        let prefix = format!("operation {} of {}", index + 1, operations.len());
        let target = operation.target_id().to_string();
        if let Operation::CreateObject { .. } = operation {
            if surviving_ids.contains(&target) {
                problems.push(format!(
                    "{prefix} attempts to create object id \"{target}\", which ALREADY exists in this document"
                ));
                continue;
            }
            surviving_ids.push(target);
            continue;
        }
        if !surviving_ids.contains(&target) {
            problems.push(format!(
                "{prefix} {}, which does not exist in this document",
                operation.describe()
            ));
            continue;
        }
        if let Operation::DeleteObject { .. } = operation {
            surviving_ids.retain(|held| held != &target);
        }
    }
    join_problems(problems)
}

/// A value the graph refuses to hold cannot enter through an operation either,
/// so the batch is refused before anything is applied rather than after the
/// integrity check finds it in a document that was half rewritten.
fn find_illegal_operation_payloads(
    operations: &[Operation],
    objects: &[GraphObject<FormulaAst>],
) -> Vec<String> {
    let mut problems = Vec::new();
    for (index, operation) in operations.iter().enumerate() {
        let prefix = format!("operation {} of {}", index + 1, operations.len());
        match operation {
            Operation::SetSlot { address, slot } => {
                let name = named(address, objects);
                if has_illegal_number(slot.value()) {
                    problems.push(format!(
                        "{prefix}: {name} would hold an illegal value ({}), which is not legal document state",
                        describe_illegal_value(slot.value())
                    ));
                }
                if let Slot::Formula { ast, .. } = slot {
                    let mut illegal = Vec::new();
                    collect_illegal_ast_literals(ast, &mut illegal);
                    if !illegal.is_empty() {
                        problems.push(format!(
                            "{prefix}: {name}'s formula would hold illegal number literal(s) ({}), which is not legal document state",
                            illegal.iter().map(|number| format_illegal_number(*number)).collect::<Vec<_>>().join(", ")
                        ));
                    }
                }
            }
            Operation::CreateObject { object } => {
                for (key, slot) in object.slots.iter() {
                    if has_illegal_number(slot.value()) {
                        problems.push(format!(
                            "{prefix}: {} would hold an illegal value ({}), which is not legal document state",
                            describe_slot(object, key),
                            describe_illegal_value(slot.value())
                        ));
                    }
                    if let Slot::Formula { ast, .. } = slot {
                        let mut illegal = Vec::new();
                        collect_illegal_ast_literals(ast, &mut illegal);
                        if !illegal.is_empty() {
                            problems.push(format!(
                                "{prefix}: {}'s formula would hold illegal number literal(s) ({}), which is not legal document state",
                                describe_slot(object, key),
                                illegal.iter().map(|number| format_illegal_number(*number)).collect::<Vec<_>>().join(", ")
                            ));
                        }
                    }
                }
            }
            Operation::AddVertex { point, .. } => {
                if has_illegal_number(&Value::Point(*point)) {
                    problems.push(format!(
                        "{prefix}: the new vertex would hold an illegal value ({}), which is not legal document state",
                        describe_illegal_value(&Value::Point(*point))
                    ));
                }
            }
            _ => {}
        }
    }
    problems
}

/// Only a table cell and a document variable may be emptied by removing the
/// slot. Every other slot is declared by a schema, and what an absent one would
/// mean is not settled.
fn find_illegal_slot_clears(
    operations: &[Operation],
    objects: &[GraphObject<FormulaAst>],
) -> Vec<String> {
    let mut problems = Vec::new();
    for (index, operation) in operations.iter().enumerate() {
        let Operation::ClearSlot { address } = operation else {
            continue;
        };
        let from_document = objects
            .iter()
            .find(|candidate| candidate.id == address.object_id);
        let from_create = operations.iter().find_map(|candidate| match candidate {
            Operation::CreateObject { object } if object.id == address.object_id => {
                Some(object.as_ref())
            }
            _ => None,
        });
        let Some(target) = from_document.or(from_create) else {
            continue;
        };
        let path = &address.path;
        let is_cell = target.object_type == ObjectType::Table
            && path.len() == 2
            && path[0] == TABLE_CELL_PATH_PREFIX;
        if is_cell || (target.object_type == ObjectType::Doc && path.len() == 1) {
            continue;
        }
        problems.push(format!(
            "operation {} of {}: {}.{} cannot be cleared — only a table cell may be emptied by removing its slot. Every other slot is schema-declared, and what an absent one means is not settled; write a value there instead",
            index + 1,
            operations.len(),
            target.name,
            slot_key(path)
        ));
    }
    problems
}

/// A name an object takes has to be one a formula could write and one nothing
/// else in the document already answers to. The list is tracked through the
/// batch, so a create and a rename in one batch see each other.
fn find_invalid_names(
    operations: &[Operation],
    objects: &[GraphObject<FormulaAst>],
) -> Vec<String> {
    let mut tracked: Vec<GraphObject<FormulaAst>> = objects.to_vec();
    let mut problems = Vec::new();
    for (index, operation) in operations.iter().enumerate() {
        let prefix = format!("operation {} of {}", index + 1, operations.len());
        match operation {
            Operation::CreateObject { object } => {
                match check_name_available(&object.name, &tracked, None) {
                    Err(message) => problems.push(format!("{prefix} cannot create: {message}")),
                    Ok(()) => tracked.push(object.as_ref().clone()),
                }
            }
            Operation::DeleteObject { object_id, .. } => {
                tracked.retain(|held| held.id != *object_id);
            }
            Operation::RenameObject { object_id, name } => {
                match check_name_available(name, &tracked, Some(object_id)) {
                    Err(message) => problems.push(format!("{prefix} cannot rename: {message}")),
                    Ok(()) => {
                        if let Some(entry) = tracked.iter_mut().find(|held| held.id == *object_id) {
                            entry.name = name.clone();
                        }
                    }
                }
            }
            _ => {}
        }
    }
    problems
}

/// Rewrites every address a stored tree holds, leaving the rest of the slot as
/// it was.
fn rewrite_object_formula_addresses(
    object: &GraphObject<FormulaAst>,
    shift: &impl Fn(&Address) -> Address,
) -> GraphObject<FormulaAst> {
    let mut slots = SlotMap::new();
    for (key, slot) in object.slots.iter() {
        let written = match slot {
            Slot::Formula { ast, value } => Slot::Formula {
                ast: rewrite_addresses_in_ast(ast, shift),
                value: value.clone(),
            },
            other => other.clone(),
        };
        slots.insert(key, written);
    }
    GraphObject {
        slots,
        ..object.clone()
    }
}

/// The vertices a path carries part way through a batch.
struct TrackedVertices {
    name: String,
    object_type: ObjectType,
    count: f64,
}

/// The slots that name one exact vertex, so a delete can say what still reads
/// it. A range never spans a vertex, so only a plain reference is looked for.
fn find_live_vertex_dependents(
    objects: &[GraphObject<FormulaAst>],
    target_object_id: &str,
    index: f64,
) -> Vec<String> {
    let wanted: Vec<String> = vertex_part_paths(index)
        .iter()
        .map(|path| slot_key(path))
        .collect();
    let mut names = Vec::new();
    for object in objects {
        let Some(schema) = get_object_schema::<FormulaAst>(object.object_type) else {
            continue;
        };
        for path in resolve_non_derived_slot_paths(object, &schema.non_derived_slot_paths) {
            let Some(Slot::Formula { ast, .. }) = object.get_slot(&path) else {
                continue;
            };
            let names_this_vertex = extract_dependencies(ast).iter().any(|dependency| {
                matches!(dependency, Dependency::Reference(address)
                    if address.object_id == target_object_id
                        && wanted.contains(&slot_key(&address.path)))
            });
            if names_this_vertex {
                names.push(named(
                    &Address {
                        object_id: object.id.clone(),
                        path,
                    },
                    objects,
                ));
            }
        }
    }
    names
}

fn find_invalid_vertex_operations(
    operations: &[Operation],
    objects: &[GraphObject<FormulaAst>],
) -> Vec<String> {
    let mut tracked: Vec<(String, TrackedVertices)> = Vec::new();
    let mut problems = Vec::new();
    for (index, operation) in operations.iter().enumerate() {
        let (object_id, adding, at, force) = match operation {
            Operation::AddVertex { object_id, .. } => (object_id, true, 0.0, false),
            Operation::DeleteVertex {
                object_id,
                index,
                force,
            } => (object_id, false, *index, *force),
            _ => continue,
        };
        if !tracked.iter().any(|(held, _)| held == object_id) {
            let Some(source) = target_of(objects, operations, object_id) else {
                continue;
            };
            tracked.push((
                object_id.clone(),
                TrackedVertices {
                    name: source.name.clone(),
                    object_type: source.object_type,
                    count: source.vertex_count.unwrap_or(0.0),
                },
            ));
        }
        let state = tracked
            .iter_mut()
            .find(|(held, _)| held == object_id)
            .map(|(_, state)| state)
            .expect("the path was just tracked");
        let prefix = format!("operation {} of {}", index + 1, operations.len());
        if state.object_type != ObjectType::Polyline {
            let verb = if adding { "add" } else { "delete" };
            problems.push(format!(
                "{prefix}: object \"{}\" is a \"{}\", not a polyline, so it has no vertices to {verb}",
                state.name,
                state.object_type.as_str()
            ));
            continue;
        }
        if adding {
            state.count += 1.0;
            continue;
        }
        if at.fract() != 0.0 || !at.is_finite() || at < 0.0 || at >= state.count {
            let bound = if state.count == 0.0 {
                "it has no vertices".to_string()
            } else {
                format!(
                    "must be an integer from 0 to {}",
                    to_javascript_text(state.count - 1.0)
                )
            };
            problems.push(format!(
                "{prefix}: vertex index {} is out of range for \"{}\" (currently {} vertices; {bound})",
                to_javascript_text(at),
                state.name,
                to_javascript_text(state.count)
            ));
            continue;
        }
        if !force {
            let dependents = find_live_vertex_dependents(objects, object_id, at);
            if !dependents.is_empty() {
                let verb = if dependents.len() == 1 {
                    "references"
                } else {
                    "reference"
                };
                problems.push(format!(
                    "{prefix}: {} still {verb} vertex {} of \"{}\"",
                    dependents.join(", "),
                    to_javascript_text(at),
                    state.name
                ));
            }
        }
        state.count -= 1.0;
    }
    problems
}

/// An explode takes a snapshot, so it is refused when there is nothing to
/// snapshot rather than leaving an object with no vertices behind.
fn find_invalid_explode_operations(
    operations: &[Operation],
    objects: &[GraphObject<FormulaAst>],
) -> Vec<String> {
    let mut problems = Vec::new();
    for (index, operation) in operations.iter().enumerate() {
        let Operation::Explode { object_id, .. } = operation else {
            continue;
        };
        let prefix = format!("operation {} of {}", index + 1, operations.len());
        let Some(target) = objects.iter().find(|candidate| &candidate.id == object_id) else {
            continue;
        };
        if !is_explodable(target.object_type) {
            problems.push(format!(
                "{prefix}: object \"{}\" is a \"{}\" — only a circle, a polygon or a rect can be exploded",
                target.name,
                target.object_type.as_str()
            ));
            continue;
        }
        if let ExplodeResult::Refused(message) = explode_object_to_polyline(target, &target.name) {
            problems.push(format!("{prefix}: {message}"));
        }
    }
    problems
}

/// A split reads the vertices a path carries now, the way an explode does, so
/// it is refused rather than doing nothing when that value is not a point list.
fn find_invalid_split_operations(
    operations: &[Operation],
    objects: &[GraphObject<FormulaAst>],
) -> Vec<String> {
    let mut problems = Vec::new();
    for (index, operation) in operations.iter().enumerate() {
        let Operation::SplitEdge {
            object_id,
            index: at,
            point,
        } = operation
        else {
            continue;
        };
        let prefix = format!("operation {} of {}", index + 1, operations.len());
        let Some(target) = objects.iter().find(|candidate| &candidate.id == object_id) else {
            continue;
        };
        if target.object_type != ObjectType::Polyline {
            problems.push(format!(
                "{prefix}: object \"{}\" is a \"{}\", not a polyline, so it has no edge to split",
                target.name,
                target.object_type.as_str()
            ));
            continue;
        }
        let edges = polyline_edge_count(target);
        if at.fract() != 0.0 || !at.is_finite() || *at < 0.0 || *at >= edges {
            let bound = if edges == 0.0 {
                "it has no edges".to_string()
            } else {
                format!(
                    "must be an integer from 0 to {}",
                    to_javascript_text(edges - 1.0)
                )
            };
            problems.push(format!(
                "{prefix}: edge index {} is out of range for \"{}\" (currently {} edges; {bound})",
                to_javascript_text(*at),
                target.name,
                to_javascript_text(edges)
            ));
            continue;
        }
        if split_polyline_edge(target, *at as usize, *point).is_none() {
            problems.push(format!(
                "{prefix}: \"{}\".vertices did not resolve to a point list, so edge {} cannot be cut",
                target.name,
                to_javascript_text(*at)
            ));
        }
    }
    problems
}

/// The slot keys an object carried and no longer does, which an explode uses to
/// find the references its snapshot left pointing at nothing.
fn removed_slot_keys<A>(before: &GraphObject<A>, after: &GraphObject<A>) -> Vec<String> {
    before
        .slots
        .keys()
        .filter(|key| after.slots.get(key).is_none())
        .map(str::to_string)
        .collect()
}

/// The ports a node carries part way through a batch, so two port operations on
/// one node each see what the other left.
struct TrackedPorts {
    input: Vec<String>,
    output: Vec<String>,
}

impl TrackedPorts {
    fn of<A>(object: &GraphObject<A>) -> TrackedPorts {
        let held = object.ports.as_ref();
        TrackedPorts {
            input: held.map(|ports| ports.input.clone()).unwrap_or_default(),
            output: held.map(|ports| ports.output.clone()).unwrap_or_default(),
        }
    }

    fn family(&mut self, family: PortFamily) -> &mut Vec<String> {
        match family {
            PortFamily::In => &mut self.input,
            PortFamily::Out => &mut self.output,
        }
    }
}

/// A port name is one a slot path can carry, and a family holds each name once.
fn find_invalid_port_operations(
    operations: &[Operation],
    objects: &[GraphObject<FormulaAst>],
) -> Vec<String> {
    let mut tracked: Vec<(String, TrackedPorts)> = objects
        .iter()
        .map(|object| (object.id.clone(), TrackedPorts::of(object)))
        .collect();
    let mut problems = Vec::new();
    for (index, operation) in operations.iter().enumerate() {
        match operation {
            Operation::CreateObject { object } => {
                tracked.retain(|(held, _)| held != &object.id);
                tracked.push((object.id.clone(), TrackedPorts::of(object.as_ref())));
                continue;
            }
            Operation::DeleteObject { object_id, .. } => {
                tracked.retain(|(held, _)| held != object_id);
                continue;
            }
            _ => {}
        }
        let (object_id, family, name, is_add) = match operation {
            Operation::AddPort {
                object_id,
                family,
                name,
            } => (object_id, *family, name, true),
            Operation::RemovePort {
                object_id,
                family,
                name,
            } => (object_id, *family, name, false),
            _ => continue,
        };
        let prefix = format!("operation {} of {}", index + 1, operations.len());
        let Some((_, ports)) = tracked.iter_mut().find(|(held, _)| held == object_id) else {
            continue;
        };
        let held = ports.family(family);
        if is_add {
            if !is_legal_port_name(name) {
                problems.push(format!(
                    "{prefix} attempts to add a port named \"{name}\", which is not a legal port name (letters, digits and underscore only)"
                ));
                continue;
            }
            if held.iter().any(|existing| existing == name) {
                problems.push(format!(
                    "{prefix} attempts to add {} port \"{name}\", which already exists",
                    family.as_str()
                ));
                continue;
            }
            held.push(name.clone());
            continue;
        }
        if !held.iter().any(|existing| existing == name) {
            problems.push(format!(
                "{prefix} attempts to remove {} port \"{name}\", which does not exist",
                family.as_str()
            ));
            continue;
        }
        held.retain(|existing| existing != name);
    }
    problems
}

/// Checks every math source in the batch before any of it applies. A source that
/// does not parse names the line it failed on, because an operator reading the
/// message is looking at the source in front of them.
///
/// A write to the source slot that is not a source operation is refused here
/// too. A plain write would leave the ports of the last source behind, so the
/// object would export names its source no longer defines.
fn find_invalid_math_sources(
    operations: &[Operation],
    objects: &[GraphObject<FormulaAst>],
) -> Vec<String> {
    // The batch is walked in order, because a source can name an object the same
    // batch creates, and a check against the document as it stood before would
    // refuse it for naming something that is about to exist.
    let mut present: Vec<GraphObject<FormulaAst>> = objects.to_vec();
    let mut problems = Vec::new();
    for (index, operation) in operations.iter().enumerate() {
        let prefix = format!("operation {} of {}", index + 1, operations.len());
        match operation {
            Operation::CreateObject { object } => {
                present.retain(|held| held.id != object.id);
                present.push(object.as_ref().clone());
            }
            Operation::DeleteObject { object_id, .. } => {
                present.retain(|held| &held.id != object_id);
            }
            Operation::SetSlot { address, .. }
                if slot_key(&address.path) == slot_key(&math_source_path()) =>
            {
                if let Some(target) = present
                    .iter()
                    .find(|held| held.id == address.object_id)
                    .filter(|held| held.object_type == ObjectType::Math)
                {
                    problems.push(format!(
                        "{prefix} writes {}.source directly, which would leave its ports behind. Editing the equations rebuilds them",
                        target.name
                    ));
                }
            }
            Operation::SetMathSource { object_id, source } => {
                let object_type = present
                    .iter()
                    .find(|held| &held.id == object_id)
                    .map(|held| held.object_type);
                if let Some(object_type) = object_type
                    && object_type != ObjectType::Math
                {
                    problems.push(format!(
                        "{prefix} attempts to write a math source onto an object of type \"{}\", which holds no equations",
                        object_type.as_str()
                    ));
                    continue;
                }
                match read_math_names(source) {
                    Err(failure) => problems.push(format!(
                        "{prefix} carries a source that does not read: line {}, {}",
                        failure.line + 1,
                        failure.message
                    )),
                    Ok(_) => {
                        let missing = unresolved_math_references(source, &present);
                        if !missing.is_empty() {
                            problems.push(format!(
                                "{prefix} names {}, which this document does not carry",
                                missing.join(", ")
                            ));
                        }
                    }
                }
            }
            _ => {}
        }
    }
    problems
}

/// The object an operation names, whether it is already in the document or is
/// being created by an earlier operation of the same batch.
fn target_of<'a>(
    objects: &'a [GraphObject<FormulaAst>],
    operations: &'a [Operation],
    object_id: &str,
) -> Option<&'a GraphObject<FormulaAst>> {
    objects
        .iter()
        .find(|candidate| candidate.id == object_id)
        .or_else(|| {
            operations.iter().find_map(|candidate| match candidate {
                Operation::CreateObject { object } if object.id == object_id => {
                    Some(object.as_ref())
                }
                _ => None,
            })
        })
}

/// The size a table has reached partway through a batch, so two resizes of one
/// table in one batch each see what the other left.
struct TrackedTable {
    name: String,
    is_table: bool,
    rows_resizable: bool,
    cols_resizable: bool,
    rows: f64,
    cols: f64,
}

/// A resize names a table, an axis it can still resize, and a line inside the
/// extent that axis has when the operation runs.
fn find_invalid_table_resizes(
    operations: &[Operation],
    objects: &[GraphObject<FormulaAst>],
) -> Vec<String> {
    let mut tracked: Vec<(String, TrackedTable)> = Vec::new();
    let mut problems = Vec::new();
    for (index, operation) in operations.iter().enumerate() {
        let (object_id, axis, at, is_insert) = match operation {
            Operation::InsertTableLine {
                object_id,
                axis,
                index,
            } => (object_id, *axis, *index, true),
            Operation::DeleteTableLine {
                object_id,
                axis,
                index,
            } => (object_id, *axis, *index, false),
            _ => continue,
        };
        if !tracked.iter().any(|(held, _)| held == object_id) {
            let Some(source) = target_of(objects, operations, object_id) else {
                continue;
            };
            let size = get_table_dimensions(source);
            tracked.push((
                object_id.clone(),
                TrackedTable {
                    name: source.name.clone(),
                    is_table: source.object_type == ObjectType::Table,
                    rows_resizable: is_table_dimension_resizable(source, TableAxis::Row),
                    cols_resizable: is_table_dimension_resizable(source, TableAxis::Column),
                    rows: size.rows,
                    cols: size.cols,
                },
            ));
        }
        let state = tracked
            .iter_mut()
            .find(|(held, _)| held == object_id)
            .map(|(_, state)| state)
            .expect("the table was just tracked");
        let prefix = format!("operation {} of {}", index + 1, operations.len());
        let verb = if is_insert { "insertion" } else { "deletion" };
        if !state.is_table {
            problems.push(format!(
                "{prefix}: object \"{}\" is not a table, so its {}s cannot be resized",
                state.name,
                axis.as_str()
            ));
            continue;
        }
        let mut immovable: Vec<&str> = Vec::new();
        if !state.rows_resizable {
            immovable.push("rows");
        }
        if !state.cols_resizable {
            immovable.push("cols");
        }
        if !immovable.is_empty() {
            let agreement = if immovable.len() > 1 {
                "slots are"
            } else {
                "slot is"
            };
            problems.push(format!(
                "{prefix}: \"{}\"'s {} {agreement} not \"literal\" — its extent cannot be coherently resized on any axis",
                state.name,
                immovable.join(" and ")
            ));
            continue;
        }
        let bound = match axis {
            TableAxis::Row => state.rows,
            TableAxis::Column => state.cols,
        };
        let highest = if is_insert { bound + 1.0 } else { bound };
        if at.fract() != 0.0 || !at.is_finite() || at < 1.0 || at > highest {
            problems.push(format!(
                "{prefix}: {} {verb} index {} is out of range for \"{}\" (currently {} {}s; must be an integer from 1 to {})",
                axis.as_str(),
                to_javascript_text(at),
                state.name,
                to_javascript_text(bound),
                axis.as_str(),
                to_javascript_text(highest)
            ));
            continue;
        }
        let delta = if is_insert { 1.0 } else { -1.0 };
        match axis {
            TableAxis::Row => state.rows += delta,
            TableAxis::Column => state.cols += delta,
        }
    }
    problems
}

/// Which dimension a path names, when it names one.
fn dimension_path_name(path: &[String]) -> Option<&'static str> {
    if path.len() != 1 {
        return None;
    }
    match path[0].as_str() {
        "rows" => Some("rows"),
        "cols" => Some("cols"),
        _ => None,
    }
}

/// A size slot holds a whole number inside the allowed range, as a literal. A
/// formula there would let evaluation resize the table, which would make the
/// slot set follow a value rather than a mutation.
fn describe_dimension_write_problem(slot: &Slot<FormulaAst>) -> Option<String> {
    let Slot::Literal { value } = slot else {
        return Some(match slot {
            Slot::Formula { .. } => "a formula".to_string(),
            other => format!("a \"{}\" slot", kind_of(other)),
        });
    };
    match value {
        Value::Number(number)
            if number.fract() == 0.0
                && number.is_finite()
                && *number >= MIN_TABLE_LINES
                && *number <= MAX_TABLE_LINES =>
        {
            None
        }
        other => Some(describe_dimension_slot_value(other)),
    }
}

fn describe_dimension_slot_value(value: &Value) -> String {
    match value {
        Value::Number(number) => format_illegal_number(*number),
        Value::Text(text) => serde_json::Value::String(text.clone()).to_string(),
        Value::Point(_) | Value::Points(_) => "a point value".to_string(),
        Value::Null => "null".to_string(),
        Value::Boolean(boolean) => boolean.to_string(),
        Value::Error(_) => "[object Object]".to_string(),
    }
}

fn find_invalid_dimension_writes(
    operations: &[Operation],
    objects: &[GraphObject<FormulaAst>],
) -> Vec<String> {
    let mut problems = Vec::new();
    for (index, operation) in operations.iter().enumerate() {
        let Operation::SetSlot { address, slot } = operation else {
            continue;
        };
        let Some(axis_name) = dimension_path_name(&address.path) else {
            continue;
        };
        let Some(target) = target_of(objects, operations, &address.object_id) else {
            continue;
        };
        if target.object_type != ObjectType::Table {
            continue;
        }
        let Some(problem) = describe_dimension_write_problem(slot) else {
            continue;
        };
        problems.push(format!(
            "operation {} of {}: {}.{axis_name} must be a whole number from {} to {} held as a literal. A formula there would let evaluation resize the table. Got: {problem}",
            index + 1,
            operations.len(),
            target.name,
            to_javascript_text(MIN_TABLE_LINES),
            to_javascript_text(MAX_TABLE_LINES)
        ));
    }
    problems
}

/// The declared path a stored key names, which a broken slot is reported under.
///
/// A key is the path joined by dots, and a path is what an address carries, so
/// the schema is asked which declared path this key spells rather than the key
/// being taken apart on a dot that a segment could hold.
fn resolve_slot_path_for_key(object: &GraphObject<FormulaAst>, key: &str) -> Option<Vec<String>> {
    let schema = get_object_schema::<FormulaAst>(object.object_type)?;
    resolve_non_derived_slot_paths(object, &schema.non_derived_slot_paths)
        .into_iter()
        .find(|path| slot_key(path) == key)
}

/// Rewrites every address a stored tree holds, turning one that cannot be
/// repaired into a reference error, and reports each slot that lost one.
fn repair_object_formula_addresses(
    object: &GraphObject<FormulaAst>,
    repair_reference: &impl Fn(&Address) -> Option<Address>,
    repair_range: &impl Fn(&Address, &Address) -> Option<(Address, Address)>,
) -> (GraphObject<FormulaAst>, Vec<Address>) {
    let mut slots = SlotMap::new();
    let mut broken = Vec::new();
    for (key, slot) in object.slots.iter() {
        let Slot::Formula { ast, value } = slot else {
            slots.insert(key, slot.clone());
            continue;
        };
        // The two repairs report through a cell rather than a return, because a
        // tree is walked once and a slot is broken by any one address in it.
        let broke = std::cell::Cell::new(false);
        let tracked_reference = |address: &Address| {
            let repaired = repair_reference(address);
            if repaired.is_none() {
                broke.set(true);
            }
            repaired
        };
        let tracked_range = |start: &Address, end: &Address| {
            let repaired = repair_range(start, end);
            if repaired.is_none() {
                broke.set(true);
            }
            repaired
        };
        slots.insert(
            key,
            Slot::Formula {
                ast: repair_addresses_in_ast(ast, &tracked_reference, &tracked_range),
                value: value.clone(),
            },
        );
        if broke.get()
            && let Some(path) = resolve_slot_path_for_key(object, key)
        {
            broken.push(Address {
                object_id: object.id.clone(),
                path,
            });
        }
    }
    (
        GraphObject {
            slots,
            ..object.clone()
        },
        broken,
    )
}

/// Applies one operation to the objects the last one produced, and reports any
/// address a forced repair rewrote.
fn apply_operation(
    objects: &[GraphObject<FormulaAst>],
    operation: &Operation,
) -> (Vec<GraphObject<FormulaAst>>, Vec<Address>) {
    match operation {
        Operation::CreateObject { object } => {
            let mut after = objects.to_vec();
            after.push(object.as_ref().clone());
            (after, Vec::new())
        }
        Operation::RenameObject { object_id, name } => (
            objects
                .iter()
                .map(|object| {
                    if object.id == *object_id {
                        GraphObject {
                            name: name.clone(),
                            ..object.clone()
                        }
                    } else {
                        object.clone()
                    }
                })
                .collect(),
            Vec::new(),
        ),
        Operation::SetSlot { address, slot } => (
            objects
                .iter()
                .map(|object| {
                    if object.id != address.object_id {
                        return object.clone();
                    }
                    let mut slots = object.slots.clone();
                    slots.insert(slot_key(&address.path), slot.clone());
                    GraphObject {
                        slots,
                        ..object.clone()
                    }
                })
                .collect(),
            Vec::new(),
        ),
        Operation::ClearSlot { address } => {
            let key = slot_key(&address.path);
            // A copy of the cleared slot goes with it. A copy is an object with
            // no value of its own, so one left behind would draw an address that
            // resolves to nothing, and the integrity check would refuse the
            // whole mutation rather than let the variable go.
            let survivors: Vec<&GraphObject<FormulaAst>> = objects
                .iter()
                .filter(|object| {
                    !(object.object_type == ObjectType::Docref
                        && object.target.as_ref().is_some_and(|target| {
                            target.object_id == address.object_id && slot_key(&target.path) == key
                        }))
                })
                .collect();
            (
                survivors
                    .into_iter()
                    .map(|object| {
                        if object.id != address.object_id {
                            return object.clone();
                        }
                        let mut slots = SlotMap::new();
                        for (held, slot) in object.slots.iter() {
                            if held != key {
                                slots.insert(held, slot.clone());
                            }
                        }
                        GraphObject {
                            slots,
                            ..object.clone()
                        }
                    })
                    .collect(),
                Vec::new(),
            )
        }
        Operation::AddVertex { object_id, point } => (
            objects
                .iter()
                .map(|object| {
                    if object.id == *object_id {
                        add_vertex_to_object(object, *point)
                    } else {
                        object.clone()
                    }
                })
                .collect(),
            Vec::new(),
        ),
        Operation::DeleteVertex {
            object_id,
            index,
            force,
        } => {
            let Some(target) = objects.iter().find(|object| object.id == *object_id) else {
                return (objects.to_vec(), Vec::new());
            };
            let resized = delete_vertex_from_object(target, *index);
            if !force {
                let shift =
                    |address: &Address| shift_vertex_address_for_delete(address, object_id, *index);
                return (
                    objects
                        .iter()
                        .map(|object| {
                            let held = if object.id == *object_id {
                                resized.clone()
                            } else {
                                object.clone()
                            };
                            rewrite_object_formula_addresses(&held, &shift)
                        })
                        .collect(),
                    Vec::new(),
                );
            }
            let repair_reference = |address: &Address| match repair_vertex_address_for_delete(
                address, object_id, *index,
            ) {
                VertexRepair::Deleted => None,
                VertexRepair::Address(found) => Some(found),
            };
            // A vertex address never spans a range, so a range passes through.
            let pass_through = |start: &Address, end: &Address| Some((start.clone(), end.clone()));
            let mut after = Vec::new();
            let mut broken = Vec::new();
            for object in objects {
                let held = if object.id == *object_id {
                    resized.clone()
                } else {
                    object.clone()
                };
                let repaired =
                    repair_object_formula_addresses(&held, &repair_reference, &pass_through);
                broken.extend(repaired.1);
                after.push(repaired.0);
            }
            (after, broken)
        }
        Operation::SplitEdge {
            object_id,
            index,
            point,
        } => {
            let Some(target) = objects.iter().find(|object| object.id == *object_id) else {
                return (objects.to_vec(), Vec::new());
            };
            let Some(split) = split_polyline_edge(target, *index as usize, *point) else {
                return (objects.to_vec(), Vec::new());
            };
            let inserted = index + 1.0;
            let grown = insert_vertex_into_object(target, *index, &split);
            let shift =
                |address: &Address| shift_vertex_address_for_insert(address, object_id, inserted);
            (
                objects
                    .iter()
                    .map(|object| {
                        let held = if object.id == *object_id {
                            grown.clone()
                        } else {
                            object.clone()
                        };
                        rewrite_object_formula_addresses(&held, &shift)
                    })
                    .collect(),
                Vec::new(),
            )
        }
        Operation::Explode { object_id, force } => {
            let Some(target) = objects.iter().find(|object| object.id == *object_id) else {
                return (objects.to_vec(), Vec::new());
            };
            let ExplodeResult::Exploded(exploded) =
                explode_object_to_polyline(target, &target.name)
            else {
                return (objects.to_vec(), Vec::new());
            };
            if !force {
                return (
                    objects
                        .iter()
                        .map(|object| {
                            if object.id == *object_id {
                                *exploded.clone()
                            } else {
                                object.clone()
                            }
                        })
                        .collect(),
                    Vec::new(),
                );
            }
            let removed = removed_slot_keys(target, exploded.as_ref());
            let repair_reference = |address: &Address| {
                if address.object_id == *object_id && removed.contains(&slot_key(&address.path)) {
                    None
                } else {
                    Some(address.clone())
                }
            };
            let pass_through = |start: &Address, end: &Address| Some((start.clone(), end.clone()));
            let mut after = Vec::new();
            let mut broken = Vec::new();
            for object in objects {
                let held = if object.id == *object_id {
                    *exploded.clone()
                } else {
                    object.clone()
                };
                let repaired =
                    repair_object_formula_addresses(&held, &repair_reference, &pass_through);
                broken.extend(repaired.1);
                after.push(repaired.0);
            }
            (after, broken)
        }
        Operation::AddPort {
            object_id,
            family,
            name,
        } => (
            objects
                .iter()
                .map(|object| {
                    if object.id != *object_id {
                        return object.clone();
                    }
                    let mut ports = object.ports.clone().unwrap_or(GraphObjectPorts {
                        input: Vec::new(),
                        output: Vec::new(),
                        seed: None,
                    });
                    match family {
                        PortFamily::In => ports.input.push(name.clone()),
                        PortFamily::Out => ports.output.push(name.clone()),
                    }
                    GraphObject {
                        ports: Some(ports),
                        ..object.clone()
                    }
                })
                .collect(),
            Vec::new(),
        ),
        Operation::RemovePort {
            object_id,
            family,
            name,
        } => {
            let key = slot_key(&[family.as_str().to_string(), name.clone()]);
            (
                objects
                    .iter()
                    .map(|object| {
                        if object.id != *object_id {
                            return object.clone();
                        }
                        let mut ports = object.ports.clone().unwrap_or(GraphObjectPorts {
                            input: Vec::new(),
                            output: Vec::new(),
                            seed: None,
                        });
                        match family {
                            PortFamily::In => ports.input.retain(|held| held != name),
                            PortFamily::Out => ports.output.retain(|held| held != name),
                        }
                        let mut slots = SlotMap::new();
                        for (held, slot) in object.slots.iter() {
                            if held != key {
                                slots.insert(held, slot.clone());
                            }
                        }
                        GraphObject {
                            ports: Some(ports),
                            slots,
                            ..object.clone()
                        }
                    })
                    .collect(),
                Vec::new(),
            )
        }
        Operation::SetMathSource { object_id, source } => (
            objects
                .iter()
                .map(|object| {
                    if object.id != *object_id {
                        return object.clone();
                    }
                    match read_math_names(source) {
                        // A source that does not read never reaches here,
                        // because the check above refuses the whole batch.
                        Err(_) => object.clone(),
                        Ok(names) => apply_math_source(object, source, &names),
                    }
                })
                .collect(),
            Vec::new(),
        ),
        Operation::InsertTableLine {
            object_id,
            axis,
            index,
        } => {
            let Some(target) = objects.iter().find(|object| object.id == *object_id) else {
                return (objects.to_vec(), Vec::new());
            };
            let size = get_table_dimensions(target);
            let bound = match axis {
                TableAxis::Row => size.rows,
                TableAxis::Column => size.cols,
            };
            let clamped = js_max(1.0, js_min(*index, bound + 1.0));
            let shift = |address: &Address| {
                shift_cell_address_for_insert(address, object_id, *axis, clamped)
            };
            (
                objects
                    .iter()
                    .map(|object| {
                        let resized = if object.id == *object_id {
                            insert_table_line(object, *axis, clamped)
                        } else {
                            object.clone()
                        };
                        rewrite_object_formula_addresses(&resized, &shift)
                    })
                    .collect(),
                Vec::new(),
            )
        }
        Operation::DeleteTableLine {
            object_id,
            axis,
            index,
        } => {
            if !objects.iter().any(|object| object.id == *object_id) {
                return (objects.to_vec(), Vec::new());
            }
            let repair_reference = |address: &Address| match repair_cell_address_for_delete(
                address, object_id, *axis, *index,
            ) {
                CellRepair::Deleted => None,
                CellRepair::Address(found) => Some(found),
            };
            let repair_range =
                |start: &Address, end: &Address| match repair_range_endpoints_for_delete(
                    start, end, object_id, *axis, *index,
                ) {
                    RangeRepair::Deleted => None,
                    RangeRepair::Endpoints { start, end } => Some((start, end)),
                };
            let mut after = Vec::new();
            let mut broken = Vec::new();
            for object in objects {
                let resized = if object.id == *object_id {
                    delete_table_line(object, *axis, *index)
                } else {
                    object.clone()
                };
                let repaired =
                    repair_object_formula_addresses(&resized, &repair_reference, &repair_range);
                broken.extend(repaired.1);
                after.push(repaired.0);
            }
            (after, broken)
        }
        Operation::DeleteObject { object_id, force } => {
            if !force {
                return (
                    objects
                        .iter()
                        .filter(|object| object.id != *object_id)
                        .cloned()
                        .collect(),
                    Vec::new(),
                );
            }
            let repair_reference = |address: &Address| {
                if address.object_id == *object_id {
                    None
                } else {
                    Some(address.clone())
                }
            };
            let repair_range = |start: &Address, end: &Address| {
                if start.object_id == *object_id || end.object_id == *object_id {
                    None
                } else {
                    Some((start.clone(), end.clone()))
                }
            };
            let mut after = Vec::new();
            let mut broken = Vec::new();
            for object in objects {
                let repaired =
                    repair_object_formula_addresses(object, &repair_reference, &repair_range);
                broken.extend(repaired.1);
                if repaired.0.id != *object_id {
                    after.push(repaired.0);
                }
            }
            (after, broken)
        }
        Operation::RenameVariable { address, name } => {
            let own = address_key(address);
            let shift = move |held: &Address| -> Address {
                if address_key(held) == own {
                    Address {
                        object_id: held.object_id.clone(),
                        path: vec![name.clone()],
                    }
                } else {
                    held.clone()
                }
            };
            let old_name = address.path.first().cloned().unwrap_or_default();
            let renamed: Vec<GraphObject<FormulaAst>> = objects
                .iter()
                .map(|object| {
                    if object.id != address.object_id {
                        return object.clone();
                    }
                    let mut slots = SlotMap::new();
                    for (key, slot) in object.slots.iter() {
                        let written = if key == old_name { name.as_str() } else { key };
                        slots.insert(written, slot.clone());
                    }
                    GraphObject {
                        slots,
                        ..object.clone()
                    }
                })
                .collect();
            let after = renamed
                .iter()
                .map(|object| {
                    let mut rewritten = rewrite_object_formula_addresses(object, &shift);
                    // A text content and a math source are literal text holding
                    // addresses the formula rewrite cannot see, so each is
                    // rewritten through the primitive that knows where an
                    // address sits inside it.
                    if object.object_type == ObjectType::Text
                        && let Some(Slot::Literal {
                            value: Value::Text(content),
                        }) = rewritten.get_slot(&["content".to_string()])
                    {
                        let moved = rewrite_text_references(content, objects, &renamed, &shift);
                        rewritten.slots.insert(
                            "content",
                            Slot::Literal {
                                value: Value::Text(moved),
                            },
                        );
                    }
                    if object.object_type == ObjectType::Math
                        && let Some(Slot::Literal {
                            value: Value::Text(source),
                        }) = rewritten.get_slot(&["source".to_string()])
                    {
                        let moved = rewrite_math_references(source, &shift);
                        rewritten.slots.insert(
                            "source",
                            Slot::Literal {
                                value: Value::Text(moved),
                            },
                        );
                    }
                    GraphObject {
                        target: object.target.as_ref().map(&shift),
                        ..rewritten
                    }
                })
                .collect();
            (after, Vec::new())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::formula::parser::parse_formula;
    use crate::model::{ObjectType, SlotMap};

    fn value_object(id: &str, name: &str, value: Value) -> GraphObject<FormulaAst> {
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

    /// The same object with its one slot holding a formula instead, parsed
    /// against the objects around it.
    fn formula_object(
        id: &str,
        name: &str,
        source: &str,
        objects: &[GraphObject<FormulaAst>],
    ) -> GraphObject<FormulaAst> {
        let ast = parse_formula(source, objects, None).expect("the formula parses");
        let mut held = value_object(id, name, Value::Null);
        held.slots.insert(
            "value",
            Slot::Formula {
                ast,
                value: Value::Null,
            },
        );
        held
    }

    fn evaluated(objects: &[GraphObject<FormulaAst>], id: &str, key: &str) -> Value {
        let result = derive_validate_and_evaluate(objects, None).expect("the pass runs");
        result
            .iter()
            .find(|object| object.id == id)
            .and_then(|object| object.slots.get(key))
            .map(|slot| slot.value().clone())
            .expect("the slot is there")
    }

    /// A slot always reads inputs that have already been recomputed, so a chain
    /// settles in one pass rather than one link per pass.
    #[test]
    fn a_chain_settles_in_one_pass() {
        let first = value_object("v1", "a", Value::Number(1.0));
        let second = formula_object("v2", "b", "a.value + 1", std::slice::from_ref(&first));
        let third = formula_object("v3", "c", "b.value + 1", &[first.clone(), second.clone()]);
        let objects = vec![first, second, third];
        assert_eq!(evaluated(&objects, "v3", "value"), Value::Number(3.0));
    }

    /// A formula that cannot be computed leaves an error value in its own slot
    /// and the pass carries on, so one broken formula cannot blank the rest.
    #[test]
    fn one_broken_formula_leaves_the_rest_standing() {
        let first = value_object("v1", "a", Value::Text("text".to_string()));
        let broken = formula_object("v2", "b", "a.value + 1", std::slice::from_ref(&first));
        let sound = value_object("v3", "c", Value::Number(9.0));
        let objects = vec![first, broken, sound];
        assert!(matches!(
            evaluated(&objects, "v2", "value"),
            Value::Error(_)
        ));
        assert_eq!(evaluated(&objects, "v3", "value"), Value::Number(9.0));
    }

    /// A pass writes values and never the slot set, which is rule 4.
    #[test]
    fn a_pass_leaves_the_slot_set_alone() {
        let first = value_object("v1", "a", Value::Number(1.0));
        let second = formula_object("v2", "b", "a.value + 1", std::slice::from_ref(&first));
        let objects = vec![first, second];
        let before: Vec<Vec<String>> = objects
            .iter()
            .map(|object| object.slots.keys().map(str::to_string).collect())
            .collect();
        let after = derive_validate_and_evaluate(&objects, None).expect("the pass runs");
        let keys: Vec<Vec<String>> = after
            .iter()
            .map(|object| object.slots.keys().map(str::to_string).collect())
            .collect();
        assert_eq!(keys, before);
    }

    /// A cycle is refused with every slot around the loop named, and the chain
    /// closes back on the slot it started from.
    #[test]
    fn a_cycle_is_refused_with_the_loop_spelled_out() {
        let placeholder = value_object("v1", "a", Value::Number(0.0));
        let second = formula_object("v2", "b", "a.value + 1", std::slice::from_ref(&placeholder));
        let first = formula_object("v1", "a", "b.value + 1", std::slice::from_ref(&second));
        let objects = vec![first, second];
        let failure = derive_validate_and_evaluate(&objects, None).expect_err("a loop is refused");
        assert!(
            failure.starts_with("cyclic dependency: "),
            "the refusal names the loop: {failure}"
        );
        assert_eq!(failure.matches("a.value").count(), 2, "the chain closes");
    }

    /// An undeclared slot is reported before a dangling reference, because a
    /// check over an edge set nobody trusts proves nothing.
    #[test]
    fn an_undeclared_slot_is_reported_before_a_dangling_reference() {
        let first = value_object("v1", "a", Value::Number(1.0));
        let mut second = formula_object("v2", "b", "a.value", std::slice::from_ref(&first));
        // Both faults at once: a formula at a path the schema does not declare,
        // and that same formula reading a slot nobody carries.
        let ast = parse_formula("a.value", std::slice::from_ref(&first), None)
            .expect("the formula parses");
        second.slots.insert(
            "extra",
            Slot::Formula {
                ast,
                value: Value::Null,
            },
        );
        let objects = vec![first, second];
        let failure = validate_integrity(&objects, &derive_edges(&objects))
            .expect_err("the undeclared slot is refused");
        assert!(
            failure.contains("schema does not declare"),
            "the first check reports first: {failure}"
        );
    }

    /// A value the graph refuses to hold is named with the spelling an operator
    /// would recognise, and a negative zero is one of them.
    #[test]
    fn an_illegal_value_is_named_as_it_was_written() {
        let objects = vec![value_object("v1", "a", Value::Number(-0.0))];
        let failure = validate_integrity(&objects, &[]).expect_err("a negative zero is refused");
        assert_eq!(
            failure,
            "a.value holds an illegal value (-0), which is not legal document state"
        );
    }

    /// An empty cell inside the extent of a real table reads as zero rather than
    /// as a missing slot, so a sum across a sparse row answers rather than
    /// refusing, and no edge is derived into a cell that holds nothing.
    #[test]
    fn an_empty_cell_inside_a_table_reads_as_zero() {
        let mut slots = SlotMap::new();
        slots.insert(
            "rows",
            Slot::Literal {
                value: Value::Number(1.0),
            },
        );
        slots.insert(
            "cols",
            Slot::Literal {
                value: Value::Number(2.0),
            },
        );
        slots.insert(
            "cells.A1",
            Slot::Literal {
                value: Value::Number(5.0),
            },
        );
        let grid = GraphObject {
            id: "t1".to_string(),
            name: "grid".to_string(),
            object_type: ObjectType::Table,
            target: None,
            slots,
            ports: None,
            vertex_count: None,
        };
        let reader = formula_object("v1", "total", "grid.B1 + 1", std::slice::from_ref(&grid));
        let objects = vec![grid, reader];
        let edges = derive_edges(&objects);
        assert!(
            edges
                .iter()
                .all(|edge| edge.source_slot.path != vec!["cells".to_string(), "B1".to_string()]),
            "an empty cell inside the extent carries no edge"
        );
        assert_eq!(evaluated(&objects, "v1", "value"), Value::Number(1.0));
    }

    fn doc_object(names: &[(&str, f64)]) -> GraphObject<FormulaAst> {
        let mut slots = SlotMap::new();
        for (name, held) in names {
            slots.insert(
                *name,
                Slot::Literal {
                    value: Value::Number(*held),
                },
            );
        }
        GraphObject {
            id: "d1".to_string(),
            name: "doc".to_string(),
            object_type: ObjectType::Doc,
            target: None,
            slots,
            ports: None,
            vertex_count: None,
        }
    }

    /// A batch commits in full or leaves the objects and the journal exactly as
    /// they arrived, so a refusal at the last operation undoes the first.
    #[test]
    fn a_refusal_at_the_end_undoes_the_start() {
        let objects = vec![value_object("v1", "a", Value::Number(1.0))];
        let operations = vec![
            Operation::SetSlot {
                address: Address {
                    object_id: "v1".to_string(),
                    path: vec!["value".to_string()],
                },
                slot: Slot::Literal {
                    value: Value::Number(9.0),
                },
            },
            Operation::SetSlot {
                address: Address {
                    object_id: "gone".to_string(),
                    path: vec!["value".to_string()],
                },
                slot: Slot::Literal {
                    value: Value::Number(1.0),
                },
            },
        ];
        assert!(mutate(&objects, &operations, &[], None).is_err());
        assert_eq!(
            objects[0].get_slot(&["value".to_string()]).map(Slot::value),
            Some(&Value::Number(1.0)),
            "the objects the caller holds are untouched"
        );
    }

    /// One successful batch appends exactly one journal entry, and a refused one
    /// appends none.
    #[test]
    fn one_batch_appends_one_entry() {
        let objects = vec![value_object("v1", "a", Value::Number(1.0))];
        let set = Operation::SetSlot {
            address: Address {
                object_id: "v1".to_string(),
                path: vec!["value".to_string()],
            },
            slot: Slot::Literal {
                value: Value::Number(9.0),
            },
        };
        let result = mutate(&objects, &[set.clone(), set], &[], None).expect("the batch commits");
        assert_eq!(result.journal.len(), 1, "one batch, one entry");
        assert_eq!(result.journal[0].operations.len(), 2);
        assert!(mutate(&objects, &[], &[], None).is_err());
    }

    /// A batch sees the objects it has made so far, so a create and a write to
    /// what it created land together.
    #[test]
    fn a_batch_sees_what_it_has_already_made() {
        let objects = vec![value_object("v1", "a", Value::Number(1.0))];
        let operations = vec![
            Operation::CreateObject {
                object: Box::new(value_object("v2", "b", Value::Number(5.0))),
            },
            Operation::SetSlot {
                address: Address {
                    object_id: "v2".to_string(),
                    path: vec!["value".to_string()],
                },
                slot: Slot::Literal {
                    value: Value::Number(6.0),
                },
            },
        ];
        let result = mutate(&objects, &operations, &[], None).expect("the batch commits");
        assert_eq!(
            result
                .objects
                .iter()
                .find(|object| object.id == "v2")
                .and_then(|object| object.slots.get("value"))
                .map(Slot::value),
            Some(&Value::Number(6.0))
        );
    }

    /// Renaming a variable moves the slot and every tree that read it, because a
    /// variable has no id behind its name and a reader left alone would point at
    /// a slot that is gone.
    #[test]
    fn renaming_a_variable_moves_its_readers_with_it() {
        let doc = doc_object(&[("alpha", 1.0)]);
        let reader = formula_object("v2", "b", "alpha + 1", std::slice::from_ref(&doc));
        let objects = vec![doc, reader];
        let result = mutate(
            &objects,
            &[Operation::RenameVariable {
                address: Address {
                    object_id: "d1".to_string(),
                    path: vec!["alpha".to_string()],
                },
                name: "gamma".to_string(),
            }],
            &[],
            None,
        )
        .expect("the rename commits");
        let doc = result
            .objects
            .iter()
            .find(|object| object.id == "d1")
            .expect("the doc object is there");
        assert!(doc.slots.get("gamma").is_some(), "the slot moved");
        assert!(doc.slots.get("alpha").is_none(), "and left nothing behind");
        assert_eq!(
            result
                .objects
                .iter()
                .find(|object| object.id == "v2")
                .and_then(|object| object.slots.get("value"))
                .map(Slot::value),
            Some(&Value::Number(2.0)),
            "the reader still reads it"
        );
    }

    /// Clearing a variable that something reads is refused with the reader
    /// named, rather than leaving a reference pointing at nothing.
    #[test]
    fn clearing_a_variable_a_formula_reads_is_refused() {
        let doc = doc_object(&[("alpha", 1.0)]);
        let reader = formula_object("v2", "b", "alpha + 1", std::slice::from_ref(&doc));
        let objects = vec![doc, reader];
        let failure = mutate(
            &objects,
            &[Operation::ClearSlot {
                address: Address {
                    object_id: "d1".to_string(),
                    path: vec!["alpha".to_string()],
                },
            }],
            &[],
            None,
        )
        .expect_err("a variable something reads stays");
        assert_eq!(failure, "doc.alpha is read by b.value");
    }

    /// Only a table cell and a document variable may be emptied by removing the
    /// slot, because every other slot is declared by a schema and what an absent
    /// one would mean is not settled.
    #[test]
    fn a_schema_declared_slot_cannot_be_cleared() {
        let objects = vec![value_object("v1", "a", Value::Number(1.0))];
        let failure = mutate(
            &objects,
            &[Operation::ClearSlot {
                address: Address {
                    object_id: "v1".to_string(),
                    path: vec!["value".to_string()],
                },
            }],
            &[],
            None,
        )
        .expect_err("a declared slot stays");
        assert!(failure.contains("cannot be cleared"), "{failure}");
    }

    /// A value the graph refuses to hold is refused before anything is applied,
    /// rather than after the integrity check finds it in a document that was
    /// half rewritten.
    #[test]
    fn an_illegal_payload_is_refused_before_it_lands() {
        let objects = vec![value_object("v1", "a", Value::Number(1.0))];
        let failure = mutate(
            &objects,
            &[Operation::SetSlot {
                address: Address {
                    object_id: "v1".to_string(),
                    path: vec!["value".to_string()],
                },
                slot: Slot::Literal {
                    value: Value::Number(-0.0),
                },
            }],
            &[],
            None,
        )
        .expect_err("a negative zero is refused");
        assert_eq!(
            failure,
            "operation 1 of 1: a.value would hold an illegal value (-0), which is not legal document state"
        );
    }

    /// Deleting an object a formula reads is refused with the reader named,
    /// which is the refusal path of section 4 rather than a reference quietly
    /// going nowhere.
    #[test]
    fn deleting_something_that_is_read_is_refused() {
        let first = value_object("v1", "a", Value::Number(1.0));
        let reader = formula_object("v2", "b", "a.value + 1", std::slice::from_ref(&first));
        let objects = vec![first, reader];
        let failure = mutate(
            &objects,
            &[Operation::DeleteObject {
                object_id: "v1".to_string(),
                force: false,
            }],
            &[],
            None,
        )
        .expect_err("a read object stays");
        assert!(
            failure.contains("b.value"),
            "the reader is named: {failure}"
        );
    }

    /// A forced delete rewrites every reference into the object to a reference
    /// error and reports the addresses it rewrote, so the caller can tell an
    /// operator which formulas it broke.
    #[test]
    fn a_forced_delete_reports_what_it_broke() {
        let first = value_object("v1", "a", Value::Number(1.0));
        let one = formula_object("v2", "b", "a.value + 1", std::slice::from_ref(&first));
        let two = formula_object("v3", "c", "a.value * 2", std::slice::from_ref(&first));
        let objects = vec![first, one, two];
        let result = mutate(
            &objects,
            &[Operation::DeleteObject {
                object_id: "v1".to_string(),
                force: true,
            }],
            &[],
            None,
        )
        .expect("a forced delete commits");
        let broken: Vec<String> = result
            .broken_slots
            .iter()
            .map(|address| format!("{}.{}", address.object_id, slot_key(&address.path)))
            .collect();
        assert_eq!(broken, vec!["v2.value", "v3.value"]);
        assert!(result.objects.iter().all(|object| object.id != "v1"));
    }

    /// A broken slot that went with its own object is left out of the report,
    /// because a caller cannot show an operator a slot that is no longer there.
    #[test]
    fn a_broken_slot_that_went_is_not_reported() {
        let first = value_object("v1", "a", Value::Number(1.0));
        let reader = formula_object("v2", "b", "a.value + 1", std::slice::from_ref(&first));
        let objects = vec![first, reader];
        let result = mutate(
            &objects,
            &[
                Operation::DeleteObject {
                    object_id: "v1".to_string(),
                    force: true,
                },
                Operation::DeleteObject {
                    object_id: "v2".to_string(),
                    force: false,
                },
            ],
            &[],
            None,
        )
        .expect("both deletes commit");
        assert!(result.objects.is_empty());
        assert!(
            result.broken_slots.is_empty(),
            "nothing is left to report on"
        );
    }

    /// Deleting the doc object would take every variable with it under a
    /// command that names none of them.
    #[test]
    fn the_doc_object_is_not_deleted_whole() {
        let objects = vec![doc_object(&[("alpha", 1.0)])];
        let failure = mutate(
            &objects,
            &[Operation::DeleteObject {
                object_id: "d1".to_string(),
                force: false,
            }],
            &[],
            None,
        )
        .expect_err("the doc object stays");
        assert_eq!(
            failure,
            "document variables are removed individually with delvar"
        );
    }

    /// A name freed by a delete is available to a create in the same batch,
    /// because the check tracks the names through the batch rather than reading
    /// the document it started from.
    #[test]
    fn a_delete_frees_its_name_for_the_same_batch() {
        let objects = vec![value_object("v1", "a", Value::Number(1.0))];
        let result = mutate(
            &objects,
            &[
                Operation::DeleteObject {
                    object_id: "v1".to_string(),
                    force: false,
                },
                Operation::CreateObject {
                    object: Box::new(value_object("v2", "a", Value::Number(5.0))),
                },
            ],
            &[],
            None,
        )
        .expect("the batch commits");
        assert_eq!(result.objects.len(), 1);
        assert_eq!(result.objects[0].id, "v2");
        assert_eq!(result.objects[0].name, "a");
    }

    fn grid() -> GraphObject<FormulaAst> {
        let mut slots = SlotMap::new();
        for (key, held) in [("rows", 3.0), ("cols", 3.0)] {
            slots.insert(
                key,
                Slot::Literal {
                    value: Value::Number(held),
                },
            );
        }
        for (key, held) in [("cells.A1", 1.0), ("cells.B2", 2.0), ("cells.C3", 3.0)] {
            slots.insert(
                key,
                Slot::Literal {
                    value: Value::Number(held),
                },
            );
        }
        GraphObject {
            id: "t1".to_string(),
            name: "grid".to_string(),
            object_type: ObjectType::Table,
            target: None,
            slots,
            ports: None,
            vertex_count: None,
        }
    }

    fn cell_keys(objects: &[GraphObject<FormulaAst>]) -> Vec<String> {
        objects
            .iter()
            .find(|object| object.id == "t1")
            .map(|object| {
                object
                    .slots
                    .keys()
                    .filter(|key| key.starts_with("cells."))
                    .map(str::to_string)
                    .collect()
            })
            .unwrap_or_default()
    }

    /// An insert moves every cell at or after the line down one, and a delete
    /// drops the line and pulls the rest up.
    #[test]
    fn a_resize_moves_the_cells_on_one_side_of_the_line() {
        let objects = vec![grid()];
        let inserted = mutate(
            &objects,
            &[Operation::InsertTableLine {
                object_id: "t1".to_string(),
                axis: TableAxis::Row,
                index: 1.0,
            }],
            &[],
            None,
        )
        .expect("the insert commits");
        assert_eq!(
            cell_keys(&inserted.objects),
            ["cells.A2", "cells.B3", "cells.C4"]
        );

        let deleted = mutate(
            &objects,
            &[Operation::DeleteTableLine {
                object_id: "t1".to_string(),
                axis: TableAxis::Row,
                index: 2.0,
            }],
            &[],
            None,
        )
        .expect("the delete commits");
        assert_eq!(cell_keys(&deleted.objects), ["cells.A1", "cells.C2"]);
    }

    /// A formula that read a cell the resize moved is rewritten, so it goes on
    /// reading the same cell under its new name.
    #[test]
    fn a_resize_rewrites_the_formulas_that_read_it() {
        let table = grid();
        let reader = formula_object("v1", "total", "grid.C3 + 1", std::slice::from_ref(&table));
        let objects = vec![table, reader];
        let result = mutate(
            &objects,
            &[Operation::InsertTableLine {
                object_id: "t1".to_string(),
                axis: TableAxis::Row,
                index: 1.0,
            }],
            &[],
            None,
        )
        .expect("the insert commits");
        assert!(result.broken_slots.is_empty());
        assert_eq!(
            result
                .objects
                .iter()
                .find(|object| object.id == "v1")
                .and_then(|object| object.slots.get("value"))
                .map(Slot::value),
            Some(&Value::Number(4.0)),
            "the formula follows the cell it read"
        );
    }

    /// Deleting a line something reads repairs rather than refusing, because
    /// refusing would leave an operator unable to delete a row that anything
    /// reads. The address that broke comes back for the caller to report.
    #[test]
    fn deleting_a_line_that_is_read_repairs_and_reports() {
        let table = grid();
        let reader = formula_object("v1", "total", "grid.C3 + 1", std::slice::from_ref(&table));
        let objects = vec![table, reader];
        let result = mutate(
            &objects,
            &[Operation::DeleteTableLine {
                object_id: "t1".to_string(),
                axis: TableAxis::Row,
                index: 3.0,
            }],
            &[],
            None,
        )
        .expect("the delete commits");
        let broken: Vec<String> = result
            .broken_slots
            .iter()
            .map(|address| format!("{}.{}", address.object_id, slot_key(&address.path)))
            .collect();
        assert_eq!(broken, vec!["v1.value"]);
    }

    /// Two resizes of one table in one batch each see what the other left, so
    /// the second is checked against the extent the first produced.
    #[test]
    fn two_resizes_in_one_batch_see_each_other() {
        let objects = vec![grid()];
        let operations = vec![
            Operation::InsertTableLine {
                object_id: "t1".to_string(),
                axis: TableAxis::Row,
                index: 1.0,
            },
            Operation::InsertTableLine {
                object_id: "t1".to_string(),
                axis: TableAxis::Row,
                index: 5.0,
            },
        ];
        // A row 5 is past the extent of three, and inside the extent of four the
        // first insert leaves.
        assert!(mutate(&objects, &operations, &[], None).is_ok());
        assert!(
            mutate(&objects, std::slice::from_ref(&operations[1]), &[], None).is_err(),
            "on its own the second insert is out of range"
        );
    }

    /// A size slot holds a literal whole number inside the range. A formula
    /// there would let evaluation resize the table, which would make the slot
    /// set follow a value rather than a mutation.
    #[test]
    fn a_size_slot_takes_a_literal_whole_number() {
        let objects = vec![grid()];
        let write = |value: Value| {
            mutate(
                &objects,
                &[Operation::SetSlot {
                    address: Address {
                        object_id: "t1".to_string(),
                        path: vec!["rows".to_string()],
                    },
                    slot: Slot::Literal { value },
                }],
                &[],
                None,
            )
        };
        assert!(write(Value::Number(4.0)).is_ok());
        for refused in [
            Value::Number(0.0),
            Value::Number(1001.0),
            Value::Number(2.5),
            Value::Text("four".to_string()),
            Value::Null,
            Value::Boolean(true),
        ] {
            let failure = write(refused.clone()).expect_err("{refused:?} is refused");
            assert!(
                failure.contains("must be a whole number from 1 to 1000 held as a literal"),
                "{failure}"
            );
        }
    }

    fn script_node(input: &[&str], output: &[&str]) -> GraphObject<FormulaAst> {
        let mut slots = SlotMap::new();
        for (key, value) in [("language", "python"), ("source", "pass")] {
            slots.insert(
                key,
                Slot::Literal {
                    value: Value::Text(value.to_string()),
                },
            );
        }
        GraphObject {
            id: "s1".to_string(),
            name: "node".to_string(),
            object_type: ObjectType::Script,
            target: None,
            slots,
            ports: Some(GraphObjectPorts {
                input: input.iter().map(|name| (*name).to_string()).collect(),
                output: output.iter().map(|name| (*name).to_string()).collect(),
                seed: None,
            }),
            vertex_count: None,
        }
    }

    fn at(object_id: &str, path: &[&str]) -> Address {
        Address {
            object_id: object_id.to_string(),
            path: path.iter().map(|part| (*part).to_string()).collect(),
        }
    }

    /// Adding a port is two operations that have to land in one batch: the name
    /// and the value. The moment an out port exists the integrity check demands
    /// every address it declares resolves, so adding one on its own fails.
    #[test]
    fn a_port_and_what_it_holds_land_together() {
        let objects = vec![script_node(&[], &[])];
        let name_only = mutate(
            &objects,
            &[Operation::AddPort {
                object_id: "s1".to_string(),
                family: PortFamily::Out,
                name: "r".to_string(),
            }],
            &[],
            None,
        );
        assert!(
            name_only.is_err(),
            "a name on its own leaves a slot missing"
        );

        let together = mutate(
            &objects,
            &[
                Operation::AddPort {
                    object_id: "s1".to_string(),
                    family: PortFamily::Out,
                    name: "r".to_string(),
                },
                Operation::SetSlot {
                    address: at("s1", &["placeholder", "r"]),
                    slot: Slot::Literal {
                        value: Value::Number(5.0),
                    },
                },
                Operation::SetSlot {
                    address: at("s1", &["out", "r"]),
                    slot: Slot::Derived { value: Value::Null },
                },
            ],
            &[],
            None,
        )
        .expect("the three together commit");
        assert_eq!(
            together.objects[0].slots.get("out.r").map(Slot::value),
            Some(&Value::Number(5.0)),
            "the stub answers the placeholder"
        );
    }

    /// A family holds each name once, and the two families are separate, so one
    /// name can sit on each side of a node.
    #[test]
    fn a_family_holds_each_name_once() {
        let objects = vec![script_node(&["a"], &[])];
        let again = mutate(
            &objects,
            &[Operation::AddPort {
                object_id: "s1".to_string(),
                family: PortFamily::In,
                name: "a".to_string(),
            }],
            &[],
            None,
        )
        .expect_err("a name twice in one family is refused");
        assert!(again.contains("already exists"), "{again}");

        let other_family = mutate(
            &objects,
            &[Operation::RemovePort {
                object_id: "s1".to_string(),
                family: PortFamily::Out,
                name: "a".to_string(),
            }],
            &[],
            None,
        )
        .expect_err("the other family does not hold it");
        assert!(other_family.contains("does not exist"), "{other_family}");
    }

    /// Writing a math source rebuilds the slots that source implies, and a port
    /// that survives the edit keeps the slot it had.
    #[test]
    fn a_math_source_rebuilds_the_slots_it_implies() {
        let mut node: GraphObject<FormulaAst> =
            crate::primitives::math::create_math_object("m1", "eq", 0.0, 0.0);
        node.ports = Some(GraphObjectPorts {
            input: vec!["x".to_string()],
            output: vec!["y".to_string()],
            seed: None,
        });
        node.slots.insert(
            "in.x",
            Slot::Literal {
                value: Value::Number(5.0),
            },
        );
        node.slots
            .insert("out.y", Slot::Derived { value: Value::Null });
        node.slots.insert(
            "source",
            Slot::Literal {
                value: Value::Text("y=x+1".to_string()),
            },
        );
        let objects = vec![node];
        let result = mutate(
            &objects,
            &[Operation::SetMathSource {
                object_id: "m1".to_string(),
                source: "y=x+2".to_string(),
            }],
            &[],
            None,
        )
        .expect("the source commits");
        assert_eq!(
            result.objects[0].slots.get("in.x").map(Slot::value),
            Some(&Value::Number(5.0)),
            "the link an operator made outlives the edit"
        );
        assert_eq!(
            result.objects[0].slots.get("out.y").map(Slot::value),
            Some(&Value::Number(7.0))
        );
    }

    /// A source that does not read fails the whole mutation, so the exports of
    /// the last source that did read stay where their readers expect them.
    #[test]
    fn a_source_that_does_not_read_changes_nothing() {
        let node: GraphObject<FormulaAst> =
            crate::primitives::math::create_math_object("m1", "eq", 0.0, 0.0);
        let objects = vec![node];
        let failure = mutate(
            &objects,
            &[Operation::SetMathSource {
                object_id: "m1".to_string(),
                source: "y=1\ny=".to_string(),
            }],
            &[],
            None,
        )
        .expect_err("a source that does not read is refused");
        assert!(
            failure.contains("carries a source that does not read: line 2"),
            "the message names the line an operator is looking at: {failure}"
        );
    }

    /// Only the source operation may write that slot. A plain write would leave
    /// the ports of the last source behind, so the object would export names its
    /// source no longer defines.
    #[test]
    fn the_source_slot_takes_no_plain_write() {
        let node: GraphObject<FormulaAst> =
            crate::primitives::math::create_math_object("m1", "eq", 0.0, 0.0);
        let objects = vec![node];
        let failure = mutate(
            &objects,
            &[Operation::SetSlot {
                address: at("m1", &["source"]),
                slot: Slot::Literal {
                    value: Value::Text("y=9".to_string()),
                },
            }],
            &[],
            None,
        )
        .expect_err("a plain write is refused");
        assert!(
            failure.contains("would leave its ports behind"),
            "{failure}"
        );
    }

    fn square() -> GraphObject<FormulaAst> {
        let corners = [(0.0, 0.0), (4.0, 0.0), (4.0, 4.0), (0.0, 4.0)];
        let mut slots = SlotMap::new();
        for (index, (x, y)) in corners.iter().enumerate() {
            for (suffix, held) in [
                ("x", *x),
                ("y", *y),
                ("bulge", 0.0),
                ("handle.in.x", 0.0),
                ("handle.in.y", 0.0),
                ("handle.out.x", 0.0),
                ("handle.out.y", 0.0),
            ] {
                slots.insert(
                    format!("vertex.{index}.{suffix}"),
                    Slot::Literal {
                        value: Value::Number(held),
                    },
                );
            }
        }
        slots.insert(
            "closed",
            Slot::Literal {
                value: Value::Boolean(true),
            },
        );
        slots.insert(
            "vertices",
            Slot::Derived {
                value: Value::Points(
                    corners
                        .iter()
                        .map(|(x, y)| Point { x: *x, y: *y })
                        .collect(),
                ),
            },
        );
        for key in [
            "centroid.x",
            "centroid.y",
            "area",
            "length",
            "bounds.minX",
            "bounds.minY",
            "bounds.maxX",
            "bounds.maxY",
            "style.strokeColor",
            "style.strokeWidth",
            "style.fillColor",
        ] {
            let slot = if key.starts_with("style") {
                Slot::Literal { value: Value::Null }
            } else {
                Slot::Derived { value: Value::Null }
            };
            slots.insert(key, slot);
        }
        GraphObject {
            id: "p1".to_string(),
            name: "path".to_string(),
            object_type: ObjectType::Polyline,
            target: None,
            slots,
            ports: None,
            vertex_count: Some(4.0),
        }
    }

    /// A vertex a formula names cannot go without the force flag, and with it
    /// the reference becomes a reference error and is reported.
    #[test]
    fn a_vertex_something_names_needs_the_force_flag() {
        let path = square();
        let reader = formula_object(
            "v1",
            "total",
            "path.vertex.2.x",
            std::slice::from_ref(&path),
        );
        let objects = vec![path, reader];
        let refused = mutate(
            &objects,
            &[Operation::DeleteVertex {
                object_id: "p1".to_string(),
                index: 2.0,
                force: false,
            }],
            &[],
            None,
        )
        .expect_err("a named vertex stays");
        assert!(
            refused.contains("still references vertex 2"),
            "the reader is named: {refused}"
        );

        let forced = mutate(
            &objects,
            &[Operation::DeleteVertex {
                object_id: "p1".to_string(),
                index: 2.0,
                force: true,
            }],
            &[],
            None,
        )
        .expect("a forced delete commits");
        assert_eq!(
            forced
                .broken_slots
                .iter()
                .map(|address| address.object_id.clone())
                .collect::<Vec<_>>(),
            vec!["v1"]
        );
    }

    /// A reference to a vertex after the one that went moves down an index
    /// rather than breaking, so a formula that named a survivor keeps reading it.
    #[test]
    fn a_reference_past_the_deleted_vertex_moves_down() {
        let path = square();
        let reader = formula_object(
            "v1",
            "total",
            "path.vertex.2.x",
            std::slice::from_ref(&path),
        );
        let objects = vec![path, reader];
        let result = mutate(
            &objects,
            &[Operation::DeleteVertex {
                object_id: "p1".to_string(),
                index: 0.0,
                force: false,
            }],
            &[],
            None,
        )
        .expect("the delete commits");
        assert!(result.broken_slots.is_empty());
        assert_eq!(
            result
                .objects
                .iter()
                .find(|object| object.id == "v1")
                .and_then(|object| object.slots.get("value"))
                .map(Slot::value),
            Some(&Value::Number(4.0)),
            "the formula follows the vertex it named, now at index 1 rather than 2"
        );
    }

    /// A split cuts one edge at the point on it nearest the one given, and puts
    /// a vertex there, so an insert loses no vertex and needs no force flag.
    #[test]
    fn a_split_puts_a_vertex_on_the_edge() {
        let objects = vec![square()];
        let result = mutate(
            &objects,
            &[Operation::SplitEdge {
                object_id: "p1".to_string(),
                index: 0.0,
                point: Point { x: 2.0, y: -1.0 },
            }],
            &[],
            None,
        )
        .expect("the split commits");
        assert_eq!(result.objects[0].vertex_count, Some(5.0));
        assert_eq!(
            result.objects[0].slots.get("vertex.1.x").map(Slot::value),
            Some(&Value::Number(2.0)),
            "the new vertex sits on the edge it cut"
        );
    }

    /// Only the three closed presets explode, and an explode reads the vertices
    /// the object carries now, so one with nothing to snapshot is refused.
    #[test]
    fn only_a_closed_preset_explodes() {
        let objects = vec![square()];
        let failure = mutate(
            &objects,
            &[Operation::Explode {
                object_id: "p1".to_string(),
                force: false,
            }],
            &[],
            None,
        )
        .expect_err("a polyline is already an editable path");
        assert!(
            failure.contains("only a circle, a polygon or a rect can be exploded"),
            "{failure}"
        );
    }

    /// A vertex count is tracked through the batch, so a delete past what the
    /// batch has left is refused against the count it reached.
    #[test]
    fn a_batch_counts_the_vertices_it_has_left() {
        let objects = vec![square()];
        let operations = vec![
            Operation::DeleteVertex {
                object_id: "p1".to_string(),
                index: 0.0,
                force: false,
            },
            Operation::DeleteVertex {
                object_id: "p1".to_string(),
                index: 3.0,
                force: false,
            },
        ];
        let failure = mutate(&objects, &operations, &[], None)
            .expect_err("three vertices have no index three");
        assert!(failure.contains("currently 3 vertices"), "{failure}");
    }
}
