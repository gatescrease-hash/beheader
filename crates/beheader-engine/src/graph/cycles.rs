//! Finds a cycle in the edge set with a depth first search, so that the
//! mutation layer can refuse a mutation that would make one.
//!
//! A cycle is always an error here and never something to resolve. When a
//! search finds one it answers with every slot around the loop in order,
//! because the operator cannot fix a circular reference without seeing which
//! slots take part in it.
//!
//! The search runs from scratch over the whole edge set on every mutation. This
//! code is unoptimized for the sake of simplicity, and it has no incremental
//! mode. An explicit stack keeps depth first order without consuming a call
//! frame for each dependent slot in a long chain.
//!
//! The port of `src/engine/graph/cycles.ts`.

use std::collections::HashMap;

use crate::address::Address;
use crate::graph::{Edge, address_key};

/// What a search found. A cycle carries every slot around the loop, in the
/// order the search met them.
#[derive(Clone, Debug, PartialEq)]
pub enum CycleCheck {
    None,
    Found(Vec<Address>),
}

/// One frame of the search: the node it sits on, and how many of that node's
/// arcs it has taken.
struct Frame {
    key: String,
    address: Address,
    next: usize,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Color {
    White,
    Gray,
    Black,
}

/// Searches the whole edge set. On a cycle it answers with every slot in it, in
/// order.
pub fn detect_cycle(edges: &[Edge]) -> CycleCheck {
    // The nodes are kept in the order the edge set first names them, because
    // which cycle a search reports first follows from where it starts.
    let mut node_order: Vec<String> = Vec::new();
    let mut nodes: HashMap<String, Address> = HashMap::new();
    let mut outgoing: HashMap<String, Vec<Address>> = HashMap::new();

    let note = |address: &Address,
                node_order: &mut Vec<String>,
                nodes: &mut HashMap<String, Address>,
                outgoing: &mut HashMap<String, Vec<Address>>|
     -> String {
        let key = address_key(address);
        if !nodes.contains_key(&key) {
            node_order.push(key.clone());
            nodes.insert(key.clone(), address.clone());
            outgoing.insert(key.clone(), Vec::new());
        }
        key
    };

    for edge in edges {
        note(
            &edge.dependent_slot,
            &mut node_order,
            &mut nodes,
            &mut outgoing,
        );
        let source = note(
            &edge.source_slot,
            &mut node_order,
            &mut nodes,
            &mut outgoing,
        );
        outgoing
            .entry(source)
            .or_default()
            .push(edge.dependent_slot.clone());
    }

    let mut colors: HashMap<String, Color> = HashMap::new();
    let color_of = |colors: &HashMap<String, Color>, key: &str| -> Color {
        colors.get(key).copied().unwrap_or(Color::White)
    };

    let mut stack: Vec<Frame> = Vec::new();
    for key in &node_order {
        if color_of(&colors, key) != Color::White {
            continue;
        }
        colors.insert(key.clone(), Color::Gray);
        stack.push(Frame {
            key: key.clone(),
            address: nodes[key].clone(),
            next: 0,
        });
        while let Some(frame) = stack.last_mut() {
            let taken = frame.next;
            frame.next += 1;
            let frame_key = frame.key.clone();
            let neighbour = outgoing.get(&frame_key).and_then(|arcs| arcs.get(taken));
            let Some(neighbour) = neighbour.cloned() else {
                colors.insert(frame_key, Color::Black);
                stack.pop();
                continue;
            };
            let neighbour_key = address_key(&neighbour);
            match color_of(&colors, &neighbour_key) {
                Color::Gray => {
                    let start = stack
                        .iter()
                        .position(|entry| entry.key == neighbour_key)
                        .unwrap_or(0);
                    return CycleCheck::Found(
                        stack[start..]
                            .iter()
                            .map(|entry| entry.address.clone())
                            .collect(),
                    );
                }
                Color::White => {
                    colors.insert(neighbour_key.clone(), Color::Gray);
                    stack.push(Frame {
                        key: neighbour_key,
                        address: neighbour,
                        next: 0,
                    });
                }
                Color::Black => {}
            }
        }
    }

    CycleCheck::None
}

#[cfg(test)]
mod tests {
    use super::*;

    fn at(object_id: &str, path: &str) -> Address {
        Address {
            object_id: object_id.to_string(),
            path: vec![path.to_string()],
        }
    }

    fn edge(from: (&str, &str), to: (&str, &str)) -> Edge {
        Edge {
            source_slot: at(from.0, from.1),
            dependent_slot: at(to.0, to.1),
        }
    }

    #[test]
    fn a_chain_with_no_loop_in_it_has_no_cycle() {
        let edges = vec![
            edge(("a", "value"), ("b", "value")),
            edge(("b", "value"), ("c", "value")),
        ];
        assert_eq!(detect_cycle(&edges), CycleCheck::None);
        assert_eq!(detect_cycle(&[]), CycleCheck::None);
    }

    /// A cycle answers with every slot around the loop, in order, because the
    /// operator cannot fix a circular reference without seeing which slots take
    /// part in it.
    ///
    /// The loop starts at `b` rather than at `a` because the nodes are noted in
    /// the order the edge set first names them, and each edge names its
    /// dependent before its source. Which slot a loop is reported from follows
    /// from that, so the order is pinned here rather than left to be discovered
    /// by whoever reads a refusal.
    #[test]
    fn a_loop_answers_with_every_slot_in_it() {
        let edges = vec![
            edge(("a", "value"), ("b", "value")),
            edge(("b", "value"), ("c", "value")),
            edge(("c", "value"), ("a", "value")),
        ];
        let CycleCheck::Found(cycle) = detect_cycle(&edges) else {
            panic!("the loop is found");
        };
        let named: Vec<&str> = cycle
            .iter()
            .map(|address| address.object_id.as_str())
            .collect();
        assert_eq!(named, vec!["b", "c", "a"]);
    }

    /// A slot that reads itself is a loop of one.
    #[test]
    fn a_slot_that_reads_itself_is_a_loop() {
        let CycleCheck::Found(cycle) = detect_cycle(&[edge(("a", "value"), ("a", "value"))]) else {
            panic!("the loop is found");
        };
        assert_eq!(cycle.len(), 1);
    }

    /// A diamond has two paths to one slot and no loop, so a search that marked
    /// a node visited once and never cleared it would report a cycle here.
    #[test]
    fn two_paths_to_one_slot_are_not_a_loop() {
        let edges = vec![
            edge(("a", "value"), ("b", "value")),
            edge(("a", "value"), ("c", "value")),
            edge(("b", "value"), ("d", "value")),
            edge(("c", "value"), ("d", "value")),
        ];
        assert_eq!(detect_cycle(&edges), CycleCheck::None);
    }

    /// The search carries its own stack, so a chain longer than a call stack
    /// would hold still answers.
    #[test]
    fn a_long_chain_costs_no_call_frames() {
        let mut edges = Vec::new();
        for index in 0..50_000 {
            edges.push(edge(
                (&format!("n{index}"), "value"),
                (&format!("n{}", index + 1), "value"),
            ));
        }
        assert_eq!(detect_cycle(&edges), CycleCheck::None);
        edges.push(edge(("n50000", "value"), ("n0", "value")));
        assert!(matches!(detect_cycle(&edges), CycleCheck::Found(_)));
    }
}
