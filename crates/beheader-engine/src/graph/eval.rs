//! Evaluates the whole document. It sorts every slot into dependency order and
//! then evaluates each one in turn, so a slot always reads inputs that have
//! already been recomputed. The depth first sort uses an explicit stack, so long
//! dependency chains keep their traversal order without exhausting a call stack.
//!
//! The three kinds of slot go through this single pass. A literal answers with
//! the value it stores, a formula evaluates its tree, and a derived slot calls
//! the compute function its schema declares. Because all three take the same
//! path, a derived value is never one evaluation behind the literal that feeds
//! it.
//!
//! Evaluation never fails. A formula that cannot be computed leaves an error
//! value in its own slot and the pass carries on, so one broken formula cannot
//! blank the rest of the document.
//!
//! Nothing here knows about any object type. A script node is one more derived
//! slot as far as this file is concerned, so a new primitive can arrive with no
//! change to the evaluator.
//!
//! The pass reads the slot set and never writes it, which is rule 4. It answers
//! with the objects it was given, each slot carrying its new value and the same
//! key it arrived under.
//!
//! The port of `src/engine/graph/eval.ts`.

use std::collections::{HashMap, HashSet};

use crate::address::Address;
use crate::formula::ast::FormulaAst;
use crate::formula::eval::evaluate as evaluate_formula_ast;
use crate::graph::{Edge, address_key};
use crate::measure::Measurer;
use crate::model::{ErrorCode, ErrorValue, GraphObject, Slot, Value, slot_key};
use crate::primitives::schema::{
    DerivedSlotSchema, SlotComputeInputs, get_object_schema, resolve_derived_slots,
};
use crate::primitives::table::{enumerate_range_cell_addresses, is_in_extent_table_cell_address};

/// One slot of one object, named the way a traversal names it.
struct Node {
    object_index: usize,
    key: String,
}

/// Evaluates every slot of every object, in topological order. It answers with
/// the new object list. A failure becomes an error value in a slot, and the pass
/// carries on, because one bad formula does not stop the rest.
pub fn evaluate(
    objects: &[GraphObject<FormulaAst>],
    edges: &[Edge],
    measurer: Option<&dyn Measurer>,
) -> Vec<GraphObject<FormulaAst>> {
    // The nodes are kept in the order the objects carry their slots, because
    // the order a depth first sort starts from decides the order two slots that
    // do not depend on one another are evaluated in.
    let mut node_order: Vec<String> = Vec::new();
    let mut nodes: HashMap<String, Node> = HashMap::new();
    for (object_index, object) in objects.iter().enumerate() {
        for (key, _) in object.slots.iter() {
            let node_key = format!("{}::{}", object.id, key);
            if let std::collections::hash_map::Entry::Vacant(slot) = nodes.entry(node_key.clone()) {
                node_order.push(node_key);
                slot.insert(Node {
                    object_index,
                    key: key.to_string(),
                });
            }
        }
    }

    let mut outgoing: HashMap<String, Vec<String>> = HashMap::new();
    for edge in edges {
        outgoing
            .entry(address_key(&edge.source_slot))
            .or_default()
            .push(address_key(&edge.dependent_slot));
    }

    let mut visited: HashSet<String> = HashSet::new();
    let mut postorder: Vec<String> = Vec::new();
    let mut stack: Vec<(String, usize)> = Vec::new();
    for node_key in &node_order {
        if visited.contains(node_key) {
            continue;
        }
        visited.insert(node_key.clone());
        stack.push((node_key.clone(), 0));
        while let Some((key, next)) = stack.last_mut() {
            let taken = *next;
            *next += 1;
            let key = key.clone();
            let neighbour = outgoing.get(&key).and_then(|arcs| arcs.get(taken)).cloned();
            match neighbour {
                None => {
                    postorder.push(key);
                    stack.pop();
                }
                Some(neighbour) => {
                    if visited.insert(neighbour.clone()) {
                        stack.push((neighbour, 0));
                    }
                }
            }
        }
    }
    postorder.reverse();

    let mut evaluated: HashMap<String, Value> = HashMap::new();
    let mut updated: HashMap<String, Vec<(String, Slot<FormulaAst>)>> = HashMap::new();

    for node_key in &postorder {
        let Some(node) = nodes.get(node_key) else {
            continue;
        };
        let object = &objects[node.object_index];
        let Some(slot) = object.slots.get(&node.key) else {
            continue;
        };
        let value = evaluate_slot(
            object, &node.key, slot, objects, edges, &evaluated, measurer,
        );
        evaluated.insert(node_key.clone(), value.clone());
        updated
            .entry(object.id.clone())
            .or_default()
            .push((node.key.clone(), next_slot(slot, value)));
    }

    objects
        .iter()
        .map(|object| {
            let mut slots = object.slots.clone();
            if let Some(written) = updated.get(&object.id) {
                for (key, slot) in written {
                    slots.insert(key.as_str(), slot.clone());
                }
            }
            GraphObject {
                slots,
                ..object.clone()
            }
        })
        .collect()
}

fn evaluate_slot(
    object: &GraphObject<FormulaAst>,
    key: &str,
    slot: &Slot<FormulaAst>,
    objects: &[GraphObject<FormulaAst>],
    edges: &[Edge],
    evaluated: &HashMap<String, Value>,
    measurer: Option<&dyn Measurer>,
) -> Value {
    match slot {
        Slot::Literal { value } => value.clone(),
        Slot::Formula { ast, .. } => evaluate_formula(ast, objects, evaluated),
        Slot::Derived { .. } => {
            evaluate_derived_slot(object, key, objects, edges, evaluated, measurer)
        }
    }
}

/// The slot a pass leaves behind. A literal keeps what it stores, and the other
/// two carry the value the pass computed.
fn next_slot(slot: &Slot<FormulaAst>, value: Value) -> Slot<FormulaAst> {
    match slot {
        Slot::Literal { .. } => slot.clone(),
        Slot::Formula { ast, .. } => Slot::Formula {
            ast: ast.clone(),
            value,
        },
        Slot::Derived { .. } => Slot::Derived { value },
    }
}

/// True for a cell inside the size of a real table that holds nothing. Such a
/// cell reads as zero rather than as a missing slot, because an empty cell is
/// ordinary state and a sum across a sparse row would otherwise refuse.
fn is_empty_in_extent_cell(
    address: &Address,
    held: Option<&Value>,
    objects: &[GraphObject<FormulaAst>],
) -> bool {
    matches!(held, None | Some(Value::Null)) && is_in_extent_table_cell_address(address, objects)
}

fn evaluate_formula(
    ast: &FormulaAst,
    objects: &[GraphObject<FormulaAst>],
    evaluated: &HashMap<String, Value>,
) -> Value {
    let read = |address: &Address| {
        let held = evaluated.get(&address_key(address));
        if is_empty_in_extent_cell(address, held, objects) {
            return Some(Value::Number(0.0));
        }
        held.cloned()
    };
    let read_range = range_reader(objects, evaluated);
    evaluate_formula_ast(ast, &read, Some(&read_range))
}

/// The cells of a range, as the pass has them so far.
fn range_reader<'a>(
    objects: &'a [GraphObject<FormulaAst>],
    evaluated: &'a HashMap<String, Value>,
) -> impl Fn(&Address, &Address) -> Result<Vec<Value>, ErrorValue> + 'a {
    move |start, end| {
        let Some(table) = objects
            .iter()
            .find(|candidate| candidate.id == start.object_id)
        else {
            return Err(ErrorValue {
                error: ErrorCode::Ref,
                message: "a range references an object that does not exist".to_string(),
            });
        };
        let cells =
            enumerate_range_cell_addresses(start, end, table).map_err(|failure| ErrorValue {
                error: ErrorCode::Ref,
                message: failure.message,
            })?;
        let mut values = Vec::new();
        for cell in cells {
            match evaluated.get(&address_key(&cell)) {
                None | Some(Value::Null) => continue,
                Some(value) => values.push(value.clone()),
            }
        }
        Ok(values)
    }
}

fn evaluate_derived_slot(
    object: &GraphObject<FormulaAst>,
    key: &str,
    objects: &[GraphObject<FormulaAst>],
    edges: &[Edge],
    evaluated: &HashMap<String, Value>,
    measurer: Option<&dyn Measurer>,
) -> Value {
    let declared = get_object_schema::<FormulaAst>(object.object_type)
        .map(|schema| resolve_derived_slots(object, schema.derived_slots));
    let found = declared.and_then(|slots| find_derived_slot_by_key(slots, key));
    let Some(entry) = found else {
        return Value::Error(ErrorValue {
            error: ErrorCode::Ref,
            message: format!(
                "no schema entry declares a derived slot \"{key}\" on type \"{}\"",
                object.object_type.as_str()
            ),
        });
    };

    // A compute function reads only what its schema declared, so a dependency
    // the schema left out cannot reach it by accident and leave the graph
    // carrying an edge nobody derived.
    let own_key = address_key(&Address {
        object_id: object.id.clone(),
        path: entry.path.clone(),
    });
    let declared_keys: HashSet<String> = edges
        .iter()
        .filter(|edge| address_key(&edge.dependent_slot) == own_key)
        .map(|edge| address_key(&edge.source_slot))
        .collect();

    let read = |address: &Address| {
        let as_key = address_key(address);
        let held = evaluated.get(&as_key);
        if is_empty_in_extent_cell(address, held, objects) {
            return Some(Value::Number(0.0));
        }
        if !declared_keys.contains(&as_key) {
            return Some(Value::Error(ErrorValue {
                error: ErrorCode::Ref,
                message:
                    "derived slot's compute function read an address outside its declared dependencies"
                        .to_string(),
            }));
        }
        held.cloned()
    };
    let read_range = range_reader(objects, evaluated);
    let inputs = SlotComputeInputs {
        read: &read,
        read_range: Some(&read_range),
        objects,
        measurer,
    };
    (entry.compute)(object, &inputs)
}

fn find_derived_slot_by_key(
    slots: Vec<DerivedSlotSchema<FormulaAst>>,
    key: &str,
) -> Option<DerivedSlotSchema<FormulaAst>> {
    slots.into_iter().find(|entry| slot_key(&entry.path) == key)
}
