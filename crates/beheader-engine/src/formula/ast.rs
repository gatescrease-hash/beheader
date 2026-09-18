//! The formula node types, with a shape check and a depth check over them.
//!
//! This is the Rust side of `src/engine/formula/ast.ts`. The tree is what the
//! four stages of the formula engine hand each other, and `document.ts` writes
//! it into a saved file as it stands, so the shapes here are the file format
//! and a document written by an older build still has to read.
//!
//! The shape check reads a tree that arrived as JSON, which is why it takes
//! `serde_json::Value` rather than a tree that is already this type. It answers
//! the wording that `src/engine/document.ts` puts in front of an operator, so
//! the description of a bad member matches the TypeScript one word for word.

use serde_json::{Map, Value as Json};

use crate::address::Address;

/// The deepest tree the engine walks. A formula past it is refused rather than
/// evaluated, because the walk is recursive and a deeper one would run out of
/// stack.
pub const MAX_FORMULA_AST_DEPTH: usize = 1000;

/// What a literal node holds, which is the three kinds of value a formula can
/// spell directly.
#[derive(Clone, Debug, PartialEq)]
pub enum LiteralValue {
    Number(f64),
    Text(String),
    Boolean(bool),
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum BinaryOperator {
    Or,
    And,
    Equal,
    NotEqual,
    Less,
    Greater,
    LessOrEqual,
    GreaterOrEqual,
    Add,
    Subtract,
    Multiply,
    Divide,
    Remainder,
    Power,
}

/// The binary operators in the order `src/engine/formula/ast.ts` lists them,
/// which is the order the parser reads precedence from.
pub const BINARY_OPERATORS: [BinaryOperator; 14] = [
    BinaryOperator::Or,
    BinaryOperator::And,
    BinaryOperator::Equal,
    BinaryOperator::NotEqual,
    BinaryOperator::Less,
    BinaryOperator::Greater,
    BinaryOperator::LessOrEqual,
    BinaryOperator::GreaterOrEqual,
    BinaryOperator::Add,
    BinaryOperator::Subtract,
    BinaryOperator::Multiply,
    BinaryOperator::Divide,
    BinaryOperator::Remainder,
    BinaryOperator::Power,
];

impl BinaryOperator {
    pub fn as_str(self) -> &'static str {
        match self {
            BinaryOperator::Or => "OR",
            BinaryOperator::And => "AND",
            BinaryOperator::Equal => "=",
            BinaryOperator::NotEqual => "<>",
            BinaryOperator::Less => "<",
            BinaryOperator::Greater => ">",
            BinaryOperator::LessOrEqual => "<=",
            BinaryOperator::GreaterOrEqual => ">=",
            BinaryOperator::Add => "+",
            BinaryOperator::Subtract => "-",
            BinaryOperator::Multiply => "*",
            BinaryOperator::Divide => "/",
            BinaryOperator::Remainder => "%",
            BinaryOperator::Power => "^",
        }
    }

    pub fn parse(text: &str) -> Option<BinaryOperator> {
        BINARY_OPERATORS
            .into_iter()
            .find(|operator| operator.as_str() == text)
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum UnaryOperator {
    Negate,
    Not,
}

pub const UNARY_OPERATORS: [UnaryOperator; 2] = [UnaryOperator::Negate, UnaryOperator::Not];

impl UnaryOperator {
    pub fn as_str(self) -> &'static str {
        match self {
            UnaryOperator::Negate => "-",
            UnaryOperator::Not => "NOT",
        }
    }

    pub fn parse(text: &str) -> Option<UnaryOperator> {
        UNARY_OPERATORS
            .into_iter()
            .find(|operator| operator.as_str() == text)
    }
}

/// One node of a formula tree.
#[derive(Clone, Debug, PartialEq)]
pub enum FormulaAst {
    Literal(LiteralValue),
    Reference(Address),
    Range {
        start: Address,
        end: Address,
    },
    BinaryOp {
        operator: BinaryOperator,
        left: Box<FormulaAst>,
        right: Box<FormulaAst>,
    },
    UnaryOp {
        operator: UnaryOperator,
        operand: Box<FormulaAst>,
    },
    FunctionCall {
        name: String,
        args: Vec<FormulaAst>,
    },
    /// A reference the parser could not resolve, which evaluates to `#REF`.
    Error,
}

impl FormulaAst {
    pub fn is_reference(&self) -> bool {
        matches!(self, FormulaAst::Reference(_))
    }
}

/// How `describeRaw` in the TypeScript names a member that is the wrong shape.
/// A string is named by the JSON spelling of it, so the quotes are part of the
/// wording an operator reads, and anything with no spelling of its own is
/// named by its kind.
fn describe(raw: Option<&Json>) -> String {
    match raw {
        None => "undefined".to_string(),
        Some(Json::Null) => "null".to_string(),
        Some(Json::String(text)) => Json::String(text.clone()).to_string(),
        Some(Json::Array(_)) => "an array".to_string(),
        Some(Json::Object(_)) => "an object".to_string(),
        Some(Json::Bool(boolean)) => boolean.to_string(),
        Some(Json::Number(number)) => crate::number::to_javascript_text(
            number.as_f64().expect("a JSON number converts to binary64"),
        ),
    }
}

/// The word `typeof` gives, which the refusal for a node that is not an object
/// uses in place of the fuller description above.
fn type_of(raw: Option<&Json>) -> String {
    match raw {
        None => "undefined".to_string(),
        Some(Json::Null) => "null".to_string(),
        Some(Json::Array(_)) => "an array".to_string(),
        Some(Json::String(_)) => "string".to_string(),
        Some(Json::Bool(_)) => "boolean".to_string(),
        Some(Json::Number(_)) => "number".to_string(),
        Some(Json::Object(_)) => "object".to_string(),
    }
}

fn read_address(raw: Option<&Json>) -> Option<Address> {
    let object = match raw {
        Some(Json::Object(object)) => object,
        _ => return None,
    };
    let object_id = object.get("objectId")?.as_str()?.to_string();
    let path = object
        .get("path")?
        .as_array()?
        .iter()
        .map(|segment| segment.as_str().map(str::to_string))
        .collect::<Option<Vec<String>>>()?;
    Some(Address { object_id, path })
}

/// One step of the walk. The walk holds its own stack rather than using the
/// call stack, so the native stack it needs is the same for a tree of one node
/// and a tree of a thousand. The tree arrives from a file, and the limit that
/// bounds its depth is only reached part way down the walk, so a walk that
/// recursed would spend a frame for every node above the limit. A Wasm module
/// is given a stack it cannot grow, which is the reason to spend heap instead.
enum Step<'a> {
    /// Read this node, and push the steps its children need.
    Read { raw: Option<&'a Json>, depth: usize },
    /// Take the two trees the children left, and join them.
    JoinBinary(BinaryOperator),
    /// Take the one tree the child left, and wrap it.
    JoinUnary(UnaryOperator),
    /// Take that many trees, and gather them into a call.
    JoinCall { name: String, arity: usize },
}

fn validate(raw: Option<&Json>, depth: usize) -> Result<FormulaAst, String> {
    let mut steps = vec![Step::Read { raw, depth }];
    let mut built: Vec<FormulaAst> = Vec::new();

    while let Some(step) = steps.pop() {
        match step {
            Step::JoinBinary(operator) => {
                let right = built.pop().expect("the right child left a tree");
                let left = built.pop().expect("the left child left a tree");
                built.push(FormulaAst::BinaryOp {
                    operator,
                    left: Box::new(left),
                    right: Box::new(right),
                });
            }
            Step::JoinUnary(operator) => {
                let operand = built.pop().expect("the operand left a tree");
                built.push(FormulaAst::UnaryOp {
                    operator,
                    operand: Box::new(operand),
                });
            }
            Step::JoinCall { name, arity } => {
                let at = built.len() - arity;
                let args = built.split_off(at);
                built.push(FormulaAst::FunctionCall { name, args });
            }
            Step::Read { raw, depth } => {
                let node: &Map<String, Json> = match raw {
                    Some(Json::Object(object)) => object,
                    other => {
                        return Err(format!(
                            "a formula node must be an object, not {}",
                            type_of(other)
                        ));
                    }
                };

                // Past the limit the TypeScript stops reading and hands back
                // the node it was given. Whatever it hands back is refused
                // straight after by the depth check, which reports any tree
                // this deep as too deep, so the node itself is never looked at
                // again and this side needs no way to hold one.
                if depth > MAX_FORMULA_AST_DEPTH {
                    built.push(FormulaAst::Error);
                    continue;
                }

                match node.get("type").and_then(Json::as_str) {
                    Some("literal") => built.push(FormulaAst::Literal(match node.get("value") {
                        Some(Json::Number(number)) => LiteralValue::Number(
                            number.as_f64().expect("a JSON number converts to binary64"),
                        ),
                        Some(Json::String(text)) => LiteralValue::Text(text.clone()),
                        Some(Json::Bool(boolean)) => LiteralValue::Boolean(*boolean),
                        other => {
                            return Err(format!(
                                "a literal node's value must be a number, string, or boolean, not {}",
                                describe(other)
                            ));
                        }
                    })),
                    Some("reference") => match read_address(node.get("address")) {
                        Some(address) => built.push(FormulaAst::Reference(address)),
                        None => {
                            return Err("a reference node's address must be { objectId: string, path: string[] }".to_string());
                        }
                    },
                    Some("range") => {
                        match (read_address(node.get("start")), read_address(node.get("end"))) {
                            (Some(start), Some(end)) => {
                                built.push(FormulaAst::Range { start, end });
                            }
                            _ => {
                                return Err("a range node's start and end must each be { objectId: string, path: string[] }".to_string());
                            }
                        }
                    }
                    Some("binaryOp") => {
                        let operator = node
                            .get("operator")
                            .and_then(Json::as_str)
                            .and_then(BinaryOperator::parse)
                            .ok_or_else(|| {
                                format!(
                                    "{} is not one of the binary operators",
                                    describe(node.get("operator"))
                                )
                            })?;
                        // The children go on in reverse, so the left one is
                        // read first and a fault in it is the one reported.
                        steps.push(Step::JoinBinary(operator));
                        steps.push(Step::Read {
                            raw: node.get("right"),
                            depth: depth + 1,
                        });
                        steps.push(Step::Read {
                            raw: node.get("left"),
                            depth: depth + 1,
                        });
                    }
                    Some("unaryOp") => {
                        let operator = node
                            .get("operator")
                            .and_then(Json::as_str)
                            .and_then(UnaryOperator::parse)
                            .ok_or_else(|| {
                                format!(
                                    "{} is not one of the prefix operators",
                                    describe(node.get("operator"))
                                )
                            })?;
                        steps.push(Step::JoinUnary(operator));
                        steps.push(Step::Read {
                            raw: node.get("operand"),
                            depth: depth + 1,
                        });
                    }
                    Some("functionCall") => {
                        let name = node
                            .get("name")
                            .and_then(Json::as_str)
                            .ok_or_else(|| {
                                format!(
                                    "a function call's name must be a string, not {}",
                                    describe(node.get("name"))
                                )
                            })?
                            .to_string();
                        let raw_args = match node.get("args") {
                            Some(Json::Array(args)) => args,
                            other => {
                                return Err(format!(
                                    "{name}'s args must be an array, not {}",
                                    describe(other)
                                ));
                            }
                        };
                        steps.push(Step::JoinCall {
                            name,
                            arity: raw_args.len(),
                        });
                        for arg in raw_args.iter().rev() {
                            steps.push(Step::Read {
                                raw: Some(arg),
                                depth: depth + 1,
                            });
                        }
                    }
                    Some("error") => {
                        if node.get("error").and_then(Json::as_str) == Some("#REF") {
                            built.push(FormulaAst::Error);
                        } else {
                            return Err(format!(
                                "an error node's error must be \"#REF\", not {}",
                                describe(node.get("error"))
                            ));
                        }
                    }
                    _ => {
                        return Err(format!(
                            "{} is not a formula node type",
                            describe(node.get("type"))
                        ));
                    }
                }
            }
        }
    }

    Ok(built.pop().expect("the walk left one tree"))
}

pub fn validate_formula_ast_shape(raw: &Json) -> Result<FormulaAst, String> {
    validate(Some(raw), 1)
}

/// Whether any node sits deeper than the limit. This walk holds its own stack
/// for the same reason the one above does.
fn exceeds(ast: &FormulaAst, depth: usize) -> bool {
    let mut pending = vec![(ast, depth)];
    while let Some((ast, depth)) = pending.pop() {
        if depth > MAX_FORMULA_AST_DEPTH {
            return true;
        }
        match ast {
            FormulaAst::Literal(_)
            | FormulaAst::Reference(_)
            | FormulaAst::Range { .. }
            | FormulaAst::Error => {}
            FormulaAst::BinaryOp { left, right, .. } => {
                pending.push((left, depth + 1));
                pending.push((right, depth + 1));
            }
            FormulaAst::UnaryOp { operand, .. } => pending.push((operand, depth + 1)),
            FormulaAst::FunctionCall { args, .. } => {
                for arg in args {
                    pending.push((arg, depth + 1));
                }
            }
        }
    }
    false
}

pub fn exceeds_max_formula_ast_depth(ast: &FormulaAst) -> bool {
    exceeds(ast, 1)
}

/// A tree back to the JSON a saved file holds, with `write_number` deciding
/// how a literal number is spelled.
///
/// A document writes a number as ordinary JSON, because a document holds no
/// number that ordinary JSON cannot carry. The fixtures write one in the
/// tagged form of `crate::wire`, so a tree holding a negative zero arrives at
/// the other engine as the number it left as. The two callers differ in that
/// alone, so the walk is written once and takes the difference as an argument.
pub fn encode_formula_ast_with(ast: &FormulaAst, write_number: &dyn Fn(f64) -> Json) -> Json {
    let mut object = Map::new();
    match ast {
        FormulaAst::Literal(literal) => {
            object.insert("type".to_string(), Json::String("literal".to_string()));
            object.insert(
                "value".to_string(),
                match literal {
                    LiteralValue::Number(number) => write_number(*number),
                    LiteralValue::Text(text) => Json::String(text.clone()),
                    LiteralValue::Boolean(boolean) => Json::Bool(*boolean),
                },
            );
        }
        FormulaAst::Reference(address) => {
            object.insert("type".to_string(), Json::String("reference".to_string()));
            object.insert("address".to_string(), encode_address(address));
        }
        FormulaAst::Range { start, end } => {
            object.insert("type".to_string(), Json::String("range".to_string()));
            object.insert("start".to_string(), encode_address(start));
            object.insert("end".to_string(), encode_address(end));
        }
        FormulaAst::BinaryOp {
            operator,
            left,
            right,
        } => {
            object.insert("type".to_string(), Json::String("binaryOp".to_string()));
            object.insert(
                "operator".to_string(),
                Json::String(operator.as_str().to_string()),
            );
            object.insert(
                "left".to_string(),
                encode_formula_ast_with(left, write_number),
            );
            object.insert(
                "right".to_string(),
                encode_formula_ast_with(right, write_number),
            );
        }
        FormulaAst::UnaryOp { operator, operand } => {
            object.insert("type".to_string(), Json::String("unaryOp".to_string()));
            object.insert(
                "operator".to_string(),
                Json::String(operator.as_str().to_string()),
            );
            object.insert(
                "operand".to_string(),
                encode_formula_ast_with(operand, write_number),
            );
        }
        FormulaAst::FunctionCall { name, args } => {
            object.insert("type".to_string(), Json::String("functionCall".to_string()));
            object.insert("name".to_string(), Json::String(name.clone()));
            object.insert(
                "args".to_string(),
                Json::Array(
                    args.iter()
                        .map(|arg| encode_formula_ast_with(arg, write_number))
                        .collect(),
                ),
            );
        }
        FormulaAst::Error => {
            object.insert("type".to_string(), Json::String("error".to_string()));
            object.insert("error".to_string(), Json::String("#REF".to_string()));
        }
    }
    Json::Object(object)
}

/// An address as the two members a saved file carries it in.
pub fn encode_address(address: &Address) -> Json {
    let mut object = Map::new();
    object.insert(
        "objectId".to_string(),
        Json::String(address.object_id.clone()),
    );
    object.insert(
        "path".to_string(),
        Json::Array(
            address
                .path
                .iter()
                .map(|part| Json::String(part.clone()))
                .collect(),
        ),
    );
    Json::Object(object)
}

#[cfg(test)]
mod tests {
    use super::{
        BinaryOperator, FormulaAst, LiteralValue, MAX_FORMULA_AST_DEPTH, UnaryOperator,
        exceeds_max_formula_ast_depth, validate_formula_ast_shape,
    };
    use serde_json::json;

    /// A chain of prefix minus nodes that deep, around one literal. Each step
    /// moves the tree it has into the next node. Writing it as `json!` with the
    /// tree inside would serialize that tree again for every node, which costs
    /// a walk of its own and says nothing about the code under test.
    fn nested(depth: usize) -> serde_json::Value {
        let mut ast = json!({ "type": "literal", "value": 1 });
        for _ in 0..depth {
            let mut node = serde_json::Map::new();
            node.insert("type".into(), json!("unaryOp"));
            node.insert("operator".into(), json!("-"));
            node.insert("operand".into(), ast);
            ast = serde_json::Value::Object(node);
        }
        ast
    }

    #[test]
    fn reads_each_node_a_formula_is_built_from() {
        assert_eq!(
            validate_formula_ast_shape(&json!({ "type": "literal", "value": "a" })),
            Ok(FormulaAst::Literal(LiteralValue::Text("a".into())))
        );
        assert_eq!(
            validate_formula_ast_shape(&json!({ "type": "error", "error": "#REF" })),
            Ok(FormulaAst::Error)
        );
        let tree = validate_formula_ast_shape(&json!({
            "type": "binaryOp",
            "operator": "<=",
            "left": { "type": "unaryOp", "operator": "NOT", "operand": { "type": "literal", "value": true } },
            "right": { "type": "functionCall", "name": "SUM", "args": [] },
        }))
        .expect("the tree is well shaped");
        match tree {
            FormulaAst::BinaryOp {
                operator,
                left,
                right,
            } => {
                assert_eq!(operator, BinaryOperator::LessOrEqual);
                assert!(matches!(
                    *left,
                    FormulaAst::UnaryOp {
                        operator: UnaryOperator::Not,
                        ..
                    }
                ));
                assert!(matches!(*right, FormulaAst::FunctionCall { .. }));
            }
            other => panic!("the tree is a binary operation, not {other:?}"),
        }
    }

    #[test]
    fn a_refusal_names_the_member_the_way_an_operator_reads_it() {
        // The wording carries the JSON spelling of a string, the printed form
        // of a number, and the kind of anything with no spelling of its own,
        // because it reaches an operator when a document will not open.
        for (raw, reason) in [
            (
                json!({ "type": "bogus" }),
                "\"bogus\" is not a formula node type",
            ),
            (json!({ "type": 7 }), "7 is not a formula node type"),
            (json!({}), "undefined is not a formula node type"),
            (
                json!({ "type": "literal", "value": null }),
                "a literal node's value must be a number, string, or boolean, not null",
            ),
            (
                json!({ "type": "literal", "value": [1] }),
                "a literal node's value must be a number, string, or boolean, not an array",
            ),
            (
                json!({ "type": "binaryOp", "operator": "**", "left": { "type": "literal", "value": 1 }, "right": { "type": "literal", "value": 1 } }),
                "\"**\" is not one of the binary operators",
            ),
            (
                json!({ "type": "functionCall", "name": "SUM", "args": 3 }),
                "SUM's args must be an array, not 3",
            ),
        ] {
            assert_eq!(validate_formula_ast_shape(&raw), Err(reason.to_string()));
        }
    }

    #[test]
    fn a_tree_that_is_not_an_object_is_named_by_its_kind() {
        for (raw, kind) in [
            (json!(null), "null"),
            (json!([]), "an array"),
            (json!("x"), "string"),
            (json!(7), "number"),
            (json!(false), "boolean"),
        ] {
            assert_eq!(
                validate_formula_ast_shape(&raw),
                Err(format!("a formula node must be an object, not {kind}"))
            );
        }
    }

    #[test]
    fn the_depth_check_refuses_a_tree_past_the_limit() {
        let inside = validate_formula_ast_shape(&nested(MAX_FORMULA_AST_DEPTH - 1))
            .expect("the tree is well shaped");
        assert!(!exceeds_max_formula_ast_depth(&inside));

        // One more node puts the deepest literal past the limit, and the shape
        // check still answers a tree rather than a refusal, because the depth
        // is what the check after it reports.
        let over = validate_formula_ast_shape(&nested(MAX_FORMULA_AST_DEPTH))
            .expect("the tree is well shaped");
        assert!(exceeds_max_formula_ast_depth(&over));

        let far = validate_formula_ast_shape(&nested(MAX_FORMULA_AST_DEPTH + 500))
            .expect("the tree is well shaped");
        assert!(exceeds_max_formula_ast_depth(&far));
    }

    #[test]
    fn a_deep_tree_is_read_on_a_small_stack() {
        // Both walks hold their own stack, so the depth of the tree costs heap
        // rather than call frames, and a stack far smaller than the one a
        // browser gives a Wasm module is enough for a tree past the limit.
        let read = std::thread::Builder::new()
            .stack_size(256 * 1024)
            .spawn(|| {
                let raw = nested(MAX_FORMULA_AST_DEPTH + 1000);
                let ast = validate_formula_ast_shape(&raw).expect("the tree is well shaped");
                let too_deep = exceeds_max_formula_ast_depth(&ast);
                // The tree and the JSON behind it are dropped by recursive
                // code that neither walk owns, so the check ends before they
                // go out of scope.
                std::mem::forget(ast);
                std::mem::forget(raw);
                too_deep
            })
            .expect("the thread spawns")
            .join()
            .expect("the walk finished rather than ending the thread");
        assert!(read);
    }

    #[test]
    fn a_reference_knows_itself() {
        let reference = validate_formula_ast_shape(
            &json!({ "type": "reference", "address": { "objectId": "o", "path": ["v"] } }),
        )
        .expect("the tree is well shaped");
        assert!(reference.is_reference());
        assert!(!FormulaAst::Error.is_reference());
    }
}
