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
use crate::formula::deps::{Dependency, extract_dependencies, rewrite_addresses_in_ast};
use crate::graph::cycles::{CycleCheck, detect_cycle};
use crate::graph::eval::evaluate;
use crate::graph::{Edge, address_key};
use crate::measure::Measurer;
use crate::model::{
    GraphObject, ObjectType, Point, Slot, SlotMap, Value, has_illegal_number, is_illegal_number,
    resolve_slot, slot_key,
};
use crate::number::to_javascript_text;
use crate::primitives::doc::document_variable_name_problem;
use crate::primitives::math::rewrite_math_references;
use crate::primitives::schema::{
    derived_slot_dependency_addresses, get_object_schema, resolve_derived_slots,
    resolve_non_derived_slot_paths,
};
use crate::primitives::table::{enumerate_range_cell_addresses, is_in_extent_table_cell_address};
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
            Operation::RenameObject { object_id, .. } => object_id,
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
    join_problems(find_illegal_slot_clears(operations, objects))?;
    join_problems(find_invalid_names(operations, objects))?;

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
}
