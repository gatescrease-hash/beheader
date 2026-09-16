//! The addresses a formula can read, and the two rewrites a resize asks of a
//! stored tree.
//!
//! This is the Rust side of `src/engine/formula/deps.ts`. `extract_dependencies`
//! is eager and total: for an `IF` it answers the addresses in both branches,
//! not only the branch that is live now. Which branch is live rests on a value
//! that evaluation has not produced yet and that changes as the document
//! changes, so a graph subscribed to the live branch alone would stop updating
//! the moment the condition flipped. `formula/eval.rs` reads lazily, which is
//! the right trade in that direction.
//!
//! The two rewrites serve a table resize. One shifts an address where rows or
//! columns move, and the other turns an address that no longer exists into a
//! `#REF` node. Both take what to do with one address from the caller, because
//! which row moved where is what the table primitive knows and this file does
//! not.

use crate::address::Address;
use crate::formula::ast::FormulaAst;

/// One address a formula reads, either on its own or as the ends of a range.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Dependency {
    Reference(Address),
    Range { start: Address, end: Address },
}

/// Every address the tree can read, in the order the source names them. The
/// walk holds its own stack, because a tree read back from a file is as deep
/// as the format allows.
pub fn extract_dependencies(ast: &FormulaAst) -> Vec<Dependency> {
    let mut dependencies = Vec::new();
    let mut pending = vec![ast];
    while let Some(node) = pending.pop() {
        match node {
            FormulaAst::Literal(_) | FormulaAst::Error => {}
            FormulaAst::Reference(address) => {
                dependencies.push(Dependency::Reference(address.clone()));
            }
            FormulaAst::Range { start, end } => dependencies.push(Dependency::Range {
                start: start.clone(),
                end: end.clone(),
            }),
            // The children go on in reverse, so they come off in the order the
            // source names them.
            FormulaAst::BinaryOp { left, right, .. } => {
                pending.push(right);
                pending.push(left);
            }
            FormulaAst::UnaryOp { operand, .. } => pending.push(operand),
            FormulaAst::FunctionCall { args, .. } => {
                for arg in args.iter().rev() {
                    pending.push(arg);
                }
            }
        }
    }
    dependencies
}

/// Shifts every address in a tree. A table insert uses this.
pub fn rewrite_addresses_in_ast(
    ast: &FormulaAst,
    rewrite: &impl Fn(&Address) -> Address,
) -> FormulaAst {
    match ast {
        FormulaAst::Literal(_) | FormulaAst::Error => ast.clone(),
        FormulaAst::Reference(address) => FormulaAst::Reference(rewrite(address)),
        FormulaAst::Range { start, end } => FormulaAst::Range {
            start: rewrite(start),
            end: rewrite(end),
        },
        FormulaAst::BinaryOp {
            operator,
            left,
            right,
        } => FormulaAst::BinaryOp {
            operator: *operator,
            left: Box::new(rewrite_addresses_in_ast(left, rewrite)),
            right: Box::new(rewrite_addresses_in_ast(right, rewrite)),
        },
        FormulaAst::UnaryOp { operator, operand } => FormulaAst::UnaryOp {
            operator: *operator,
            operand: Box::new(rewrite_addresses_in_ast(operand, rewrite)),
        },
        FormulaAst::FunctionCall { name, args } => FormulaAst::FunctionCall {
            name: name.clone(),
            args: args
                .iter()
                .map(|arg| rewrite_addresses_in_ast(arg, rewrite))
                .collect(),
        },
    }
}

/// Turns an address that no longer resolves into a `#REF` node. A table delete
/// uses this. A repair that answers `None` is one the caller found deleted.
pub fn repair_addresses_in_ast(
    ast: &FormulaAst,
    repair_reference: &impl Fn(&Address) -> Option<Address>,
    repair_range: &impl Fn(&Address, &Address) -> Option<(Address, Address)>,
) -> FormulaAst {
    match ast {
        FormulaAst::Literal(_) | FormulaAst::Error => ast.clone(),
        FormulaAst::Reference(address) => match repair_reference(address) {
            None => FormulaAst::Error,
            Some(address) => FormulaAst::Reference(address),
        },
        FormulaAst::Range { start, end } => match repair_range(start, end) {
            None => FormulaAst::Error,
            Some((start, end)) => FormulaAst::Range { start, end },
        },
        FormulaAst::BinaryOp {
            operator,
            left,
            right,
        } => FormulaAst::BinaryOp {
            operator: *operator,
            left: Box::new(repair_addresses_in_ast(
                left,
                repair_reference,
                repair_range,
            )),
            right: Box::new(repair_addresses_in_ast(
                right,
                repair_reference,
                repair_range,
            )),
        },
        FormulaAst::UnaryOp { operator, operand } => FormulaAst::UnaryOp {
            operator: *operator,
            operand: Box::new(repair_addresses_in_ast(
                operand,
                repair_reference,
                repair_range,
            )),
        },
        FormulaAst::FunctionCall { name, args } => FormulaAst::FunctionCall {
            name: name.clone(),
            args: args
                .iter()
                .map(|arg| repair_addresses_in_ast(arg, repair_reference, repair_range))
                .collect(),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::{
        Dependency, extract_dependencies, repair_addresses_in_ast, rewrite_addresses_in_ast,
    };
    use crate::address::Address;
    use crate::formula::ast::{BinaryOperator, FormulaAst, LiteralValue};

    fn address(object_id: &str) -> Address {
        Address {
            object_id: object_id.to_string(),
            path: vec!["value".to_string()],
        }
    }

    fn reference(object_id: &str) -> FormulaAst {
        FormulaAst::Reference(address(object_id))
    }

    fn call(name: &str, args: Vec<FormulaAst>) -> FormulaAst {
        FormulaAst::FunctionCall {
            name: name.to_string(),
            args,
        }
    }

    #[test]
    fn reads_both_branches_of_a_conditional() {
        // Which branch is live rests on a value evaluation has not produced,
        // so both are subscribed to and the graph keeps updating when the
        // condition flips.
        let tree = call(
            "IF",
            vec![reference("cond"), reference("then"), reference("else")],
        );
        assert_eq!(
            extract_dependencies(&tree),
            [
                Dependency::Reference(address("cond")),
                Dependency::Reference(address("then")),
                Dependency::Reference(address("else")),
            ]
        );
    }

    #[test]
    fn lists_addresses_in_the_order_the_source_names_them() {
        let tree = FormulaAst::BinaryOp {
            operator: BinaryOperator::Add,
            left: Box::new(reference("first")),
            right: Box::new(call("SUM", vec![reference("second"), reference("third")])),
        };
        let named: Vec<String> = extract_dependencies(&tree)
            .iter()
            .map(|dependency| match dependency {
                Dependency::Reference(address) => address.object_id.clone(),
                Dependency::Range { start, .. } => start.object_id.clone(),
            })
            .collect();
        assert_eq!(named, ["first", "second", "third"]);
    }

    #[test]
    fn a_name_read_twice_is_listed_twice() {
        let tree = FormulaAst::BinaryOp {
            operator: BinaryOperator::Add,
            left: Box::new(reference("same")),
            right: Box::new(reference("same")),
        };
        assert_eq!(extract_dependencies(&tree).len(), 2);
    }

    #[test]
    fn a_tree_with_nothing_to_read_answers_nothing() {
        assert_eq!(
            extract_dependencies(&FormulaAst::Literal(LiteralValue::Number(1.0))),
            []
        );
        assert_eq!(extract_dependencies(&FormulaAst::Error), []);
    }

    #[test]
    fn a_range_is_one_dependency_carrying_both_ends() {
        let tree = FormulaAst::Range {
            start: address("t"),
            end: address("t"),
        };
        assert_eq!(
            extract_dependencies(&tree),
            [Dependency::Range {
                start: address("t"),
                end: address("t")
            }]
        );
    }

    #[test]
    fn a_rewrite_reaches_every_address_and_leaves_the_rest_alone() {
        let tree = FormulaAst::BinaryOp {
            operator: BinaryOperator::Add,
            left: Box::new(reference("old")),
            right: Box::new(call(
                "SUM",
                vec![
                    FormulaAst::Range {
                        start: address("old"),
                        end: address("old"),
                    },
                    FormulaAst::Literal(LiteralValue::Number(1.0)),
                ],
            )),
        };
        let moved = rewrite_addresses_in_ast(&tree, &|held: &Address| Address {
            object_id: "new".to_string(),
            path: held.path.clone(),
        });
        for dependency in extract_dependencies(&moved) {
            match dependency {
                Dependency::Reference(held) => assert_eq!(held.object_id, "new"),
                Dependency::Range { start, end } => {
                    assert_eq!(start.object_id, "new");
                    assert_eq!(end.object_id, "new");
                }
            }
        }
        // The literal beside them is the tree it was.
        match moved {
            FormulaAst::BinaryOp { right, .. } => match *right {
                FormulaAst::FunctionCall { args, .. } => {
                    assert_eq!(args[1], FormulaAst::Literal(LiteralValue::Number(1.0)))
                }
                other => panic!("the right side is a call, not {other:?}"),
            },
            other => panic!("the tree is a sum, not {other:?}"),
        }
    }

    #[test]
    fn a_deleted_address_becomes_an_error_node() {
        let tree = FormulaAst::BinaryOp {
            operator: BinaryOperator::Add,
            left: Box::new(reference("gone")),
            right: Box::new(reference("kept")),
        };
        let repaired = repair_addresses_in_ast(
            &tree,
            &|held: &Address| {
                if held.object_id == "gone" {
                    None
                } else {
                    Some(held.clone())
                }
            },
            &|start: &Address, end: &Address| Some((start.clone(), end.clone())),
        );
        match repaired {
            FormulaAst::BinaryOp { left, right, .. } => {
                assert_eq!(*left, FormulaAst::Error);
                assert_eq!(*right, reference("kept"));
            }
            other => panic!("the tree is a sum, not {other:?}"),
        }
    }

    #[test]
    fn a_range_with_one_end_deleted_goes_the_way_a_reference_does() {
        let tree = FormulaAst::Range {
            start: address("kept"),
            end: address("gone"),
        };
        let repaired = repair_addresses_in_ast(
            &tree,
            &|held: &Address| Some(held.clone()),
            &|start: &Address, end: &Address| {
                if start.object_id == "gone" || end.object_id == "gone" {
                    None
                } else {
                    Some((start.clone(), end.clone()))
                }
            },
        );
        assert_eq!(repaired, FormulaAst::Error);
    }
}
