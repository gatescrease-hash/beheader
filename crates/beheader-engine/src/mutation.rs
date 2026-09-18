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

use crate::address::{Address, format_address, name_suggestion};
use crate::formula::ast::{FormulaAst, LiteralValue};
use crate::formula::deps::{Dependency, extract_dependencies};
use crate::graph::cycles::{CycleCheck, detect_cycle};
use crate::graph::eval::evaluate;
use crate::graph::{Edge, address_key};
use crate::measure::Measurer;
use crate::model::{
    GraphObject, ObjectType, Point, Slot, Value, has_illegal_number, is_illegal_number,
    resolve_slot, slot_key,
};
use crate::number::to_javascript_text;
use crate::primitives::doc::document_variable_name_problem;
use crate::primitives::schema::{
    derived_slot_dependency_addresses, get_object_schema, resolve_derived_slots,
    resolve_non_derived_slot_paths,
};
use crate::primitives::table::{enumerate_range_cell_addresses, is_in_extent_table_cell_address};

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
}
