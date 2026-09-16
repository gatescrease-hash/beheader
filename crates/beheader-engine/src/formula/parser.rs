//! Turns tokens into a tree by recursive descent, which is the second of the
//! four stages, after the lexer and before dependency extraction.
//!
//! This is the Rust side of `src/engine/formula/parser.ts`. An object name is
//! resolved to an ID here rather than at evaluation time, so a formula naming
//! an object that does not exist fails to parse even where the reference sits
//! in the branch of an `IF` that nothing takes. Resolving early is also what
//! lets a rename leave stored formulas alone, because the tree holds the ID.
//!
//! Two limits bound the work. A nesting limit stops a deeply nested input
//! before the descent exhausts the stack, and it counts only the two tiers
//! that can nest without consuming an operator. A chain of one operator, such
//! as a long sum, passes that limit untouched and builds a tree that leans to
//! the left, so the walk that places ranges holds its own stack and reports
//! the tree as too deep at the same count the TypeScript reports it at.

use crate::address::{
    Address, AddressableObject, bare_cell_address, is_cell_reference_form, parse_address,
};
use crate::formula::ast::{BinaryOperator, FormulaAst, LiteralValue, MAX_FORMULA_AST_DEPTH};
use crate::formula::functions::{accepts_range_argument, check_arity, get_function_entry};
use crate::formula::lexer::{LexError, Token, TokenKind, lex};
use crate::model::ErrorCode;

/// How deep the descent goes before it refuses the input. It counts a step at
/// the prefix tier and at the primary tier, which are the two that recur
/// without consuming an operator.
pub const MAX_FORMULA_PARSE_DEPTH: usize = 256;

/// Why the source does not parse, with the offset the fault begins at.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ParseError {
    pub error: ErrorCode,
    pub message: String,
    pub start: usize,
}

impl ParseError {
    fn at(message: String, start: usize) -> Self {
        Self {
            error: ErrorCode::Parse,
            message,
            start,
        }
    }
}

impl From<LexError> for ParseError {
    fn from(error: LexError) -> Self {
        ParseError::at(error.message, error.start)
    }
}

type Parsed = Result<FormulaAst, ParseError>;

struct Parser<'a, T: AddressableObject> {
    tokens: &'a [Token],
    position: usize,
    depth: usize,
    objects: &'a [T],
    table_object_id: Option<&'a str>,
}

impl<'a, T: AddressableObject> Parser<'a, T> {
    fn peek(&self) -> &Token {
        &self.tokens[self.position]
    }

    /// The token that far ahead, or the last one where the source runs out,
    /// which is what a lookahead past the end reads in the TypeScript.
    fn peek_at(&self, offset: usize) -> &Token {
        let index = self.position + offset;
        &self.tokens[index.min(self.tokens.len() - 1)]
    }

    fn advance(&mut self) -> Token {
        let token = self.peek().clone();
        if token.kind != TokenKind::Eof {
            self.position += 1;
        }
        token
    }

    fn unexpected(&self, token: &Token, expected: &str) -> ParseError {
        let found = if token.kind == TokenKind::Eof {
            "end of formula".to_string()
        } else {
            format!("\"{}\"", token.text)
        };
        ParseError::at(format!("expected {expected}, found {found}"), token.start)
    }

    fn expect(&mut self, kind: &TokenKind, description: &str) -> Result<Token, ParseError> {
        let token = self.peek().clone();
        if &token.kind != kind {
            return Err(self.unexpected(&token, description));
        }
        Ok(self.advance())
    }

    /// One tier of left-associative operators, which reads the tier under it
    /// and then joins as many operators of its own as follow.
    fn left_associative(
        &mut self,
        next: fn(&mut Self) -> Parsed,
        operator: fn(&TokenKind) -> Option<BinaryOperator>,
    ) -> Parsed {
        let mut left = next(self)?;
        while let Some(operator) = operator(&self.peek().kind) {
            self.advance();
            let right = next(self)?;
            left = FormulaAst::BinaryOp {
                operator,
                left: Box::new(left),
                right: Box::new(right),
            };
        }
        Ok(left)
    }

    fn or_expr(&mut self) -> Parsed {
        self.left_associative(Self::and_expr, |kind| match kind {
            TokenKind::Or => Some(BinaryOperator::Or),
            _ => None,
        })
    }

    fn and_expr(&mut self) -> Parsed {
        self.left_associative(Self::comparison_expr, |kind| match kind {
            TokenKind::And => Some(BinaryOperator::And),
            _ => None,
        })
    }

    fn comparison_expr(&mut self) -> Parsed {
        self.left_associative(Self::additive_expr, |kind| match kind {
            TokenKind::Eq => Some(BinaryOperator::Equal),
            TokenKind::Ne => Some(BinaryOperator::NotEqual),
            TokenKind::Lt => Some(BinaryOperator::Less),
            TokenKind::Gt => Some(BinaryOperator::Greater),
            TokenKind::Le => Some(BinaryOperator::LessOrEqual),
            TokenKind::Ge => Some(BinaryOperator::GreaterOrEqual),
            _ => None,
        })
    }

    fn additive_expr(&mut self) -> Parsed {
        self.left_associative(Self::multiplicative_expr, |kind| match kind {
            TokenKind::Plus => Some(BinaryOperator::Add),
            TokenKind::Minus => Some(BinaryOperator::Subtract),
            _ => None,
        })
    }

    fn multiplicative_expr(&mut self) -> Parsed {
        self.left_associative(Self::power_expr, |kind| match kind {
            TokenKind::Star => Some(BinaryOperator::Multiply),
            TokenKind::Slash => Some(BinaryOperator::Divide),
            TokenKind::Percent => Some(BinaryOperator::Remainder),
            _ => None,
        })
    }

    fn power_expr(&mut self) -> Parsed {
        self.left_associative(Self::unary_expr, |kind| match kind {
            TokenKind::Caret => Some(BinaryOperator::Power),
            _ => None,
        })
    }

    /// Counts one nesting step, refuses the input where the count is past the
    /// limit, and gives the step back whichever way the tier answered.
    fn nesting_step(&mut self, tier: fn(&mut Self) -> Parsed) -> Parsed {
        self.depth += 1;
        let result = if self.depth > MAX_FORMULA_PARSE_DEPTH {
            Err(ParseError::at(
                format!(
                    "formula nests too deeply (limit {MAX_FORMULA_PARSE_DEPTH} nesting steps); split it across cells, or over several slots"
                ),
                self.peek().start,
            ))
        } else {
            tier(self)
        };
        self.depth -= 1;
        result
    }

    fn unary_expr(&mut self) -> Parsed {
        self.nesting_step(Self::unary_expr_inner)
    }

    fn unary_expr_inner(&mut self) -> Parsed {
        match self.peek().kind {
            TokenKind::Minus => {
                self.advance();
                Ok(FormulaAst::UnaryOp {
                    operator: crate::formula::ast::UnaryOperator::Negate,
                    operand: Box::new(self.unary_expr()?),
                })
            }
            // `NOT` followed by a bracket is the function of that name, so only
            // the bare word is the prefix operator.
            TokenKind::Not if self.peek_at(1).kind != TokenKind::LParen => {
                self.advance();
                Ok(FormulaAst::UnaryOp {
                    operator: crate::formula::ast::UnaryOperator::Not,
                    operand: Box::new(self.unary_expr()?),
                })
            }
            _ => self.primary_expr(),
        }
    }

    fn primary_expr(&mut self) -> Parsed {
        self.nesting_step(Self::primary_expr_inner)
    }

    fn primary_expr_inner(&mut self) -> Parsed {
        let token = self.peek().clone();
        match &token.kind {
            TokenKind::Number(number) => {
                self.advance();
                Ok(FormulaAst::Literal(LiteralValue::Number(*number)))
            }
            TokenKind::Text(text) => {
                self.advance();
                Ok(FormulaAst::Literal(LiteralValue::Text(text.clone())))
            }
            TokenKind::Boolean(boolean) => {
                self.advance();
                Ok(FormulaAst::Literal(LiteralValue::Boolean(*boolean)))
            }
            TokenKind::LParen => {
                self.advance();
                let inner = self.or_expr()?;
                self.expect(&TokenKind::RParen, "\")\"")?;
                Ok(inner)
            }
            kind if is_function_name(kind) && self.peek_at(1).kind == TokenKind::LParen => {
                self.function_call_expr(token.text.clone())
            }
            TokenKind::Identifier => self.reference_or_range_expr(),
            _ => Err(self.unexpected(&token, "an expression")),
        }
    }

    fn function_call_expr(&mut self, name: String) -> Parsed {
        let name_token = self.advance();
        self.expect(&TokenKind::LParen, "\"(\"")?;

        let mut args = Vec::new();
        if self.peek().kind != TokenKind::RParen {
            args.push(self.or_expr()?);
            while self.peek().kind == TokenKind::Comma {
                self.advance();
                args.push(self.or_expr()?);
            }
        }
        self.expect(&TokenKind::RParen, "\")\" to close the argument list")?;

        let entry = get_function_entry(&name).ok_or_else(|| {
            ParseError::at(format!("unknown function \"{name}\""), name_token.start)
        })?;
        check_arity(entry.name, entry.arity, args.len())
            .map_err(|message| ParseError::at(message, name_token.start))?;

        Ok(FormulaAst::FunctionCall { name, args })
    }

    fn reference_or_range_expr(&mut self) -> Parsed {
        let start = self.reference_address()?;
        if self.peek().kind == TokenKind::Colon {
            self.advance();
            let end = self.reference_address()?;
            return Ok(FormulaAst::Range { start, end });
        }
        Ok(FormulaAst::Reference(start))
    }

    fn reference_address(&mut self) -> Result<Address, ParseError> {
        let start_token = self.peek().clone();

        let mut segments = vec![self.path_segment()?];
        while self.peek().kind == TokenKind::Dot {
            self.advance();
            segments.push(self.path_segment()?);
        }

        // Inside a table, a bare cell reference names a cell of that table, so
        // it resolves with no object name in front of it.
        if let [only] = segments.as_slice()
            && let Some(table) = self.table_object_id
            && is_cell_reference_form(only)
        {
            return Ok(bare_cell_address(table, only));
        }

        parse_address(&segments.join("."), self.objects)
            .map_err(|error| ParseError::at(error.message, start_token.start))
    }

    fn path_segment(&mut self) -> Result<String, ParseError> {
        let token = self.peek().clone();
        match token.kind {
            TokenKind::Identifier | TokenKind::Number(_) => {
                self.advance();
                Ok(token.text)
            }
            _ => Err(self.unexpected(&token, "a name or path segment")),
        }
    }
}

/// Whether a token can name a function. The three word operators can, because
/// `AND(a, b)` is the function and `a AND b` is the operator.
fn is_function_name(kind: &TokenKind) -> bool {
    matches!(
        kind,
        TokenKind::Identifier | TokenKind::And | TokenKind::Or | TokenKind::Not
    )
}

/// Where a range is legal, and whether the tree is deeper than the format
/// allows. The walk holds its own stack, because a chain of one operator
/// builds a tree that leans to the left as far as the input is long, and the
/// limit that stops it is reached part way down.
fn validate_range_placement(ast: &FormulaAst) -> Result<(), ParseError> {
    let mut pending = vec![(ast, false, 1usize)];
    while let Some((node, is_direct_aggregate_argument, depth)) = pending.pop() {
        if depth > MAX_FORMULA_AST_DEPTH {
            return Err(ParseError::at(
                format!(
                    "formula has more than {MAX_FORMULA_AST_DEPTH} nested operations; split it across cells, or use SUM over a range"
                ),
                0,
            ));
        }
        match node {
            FormulaAst::Range { start, end } => {
                if !is_direct_aggregate_argument {
                    return Err(ParseError::at(
                        "a range (e.g. A1:B4) is only legal as a direct argument to an aggregate function (SUM, MIN, MAX, AVG)".to_string(),
                        0,
                    ));
                }
                if start.object_id != end.object_id {
                    return Err(ParseError::at(
                        "a range's two endpoints must be cells in the same table".to_string(),
                        0,
                    ));
                }
            }
            FormulaAst::Literal(_) | FormulaAst::Reference(_) | FormulaAst::Error => {}
            FormulaAst::BinaryOp { left, right, .. } => {
                // The right side goes on first, so the left is taken off first
                // and a fault in it is the one reported.
                pending.push((right, false, depth + 1));
                pending.push((left, false, depth + 1));
            }
            FormulaAst::UnaryOp { operand, .. } => pending.push((operand, false, depth + 1)),
            FormulaAst::FunctionCall { name, args } => {
                let aggregate = accepts_range_argument(name);
                for arg in args.iter().rev() {
                    pending.push((arg, aggregate, depth + 1));
                }
            }
        }
    }
    Ok(())
}

pub fn parse_formula_tokens<T: AddressableObject>(
    tokens: &[Token],
    objects: &[T],
    table_object_id: Option<&str>,
) -> Parsed {
    let mut parser = Parser {
        tokens,
        position: 0,
        depth: 0,
        objects,
        table_object_id,
    };

    if parser.peek().kind == TokenKind::Eof {
        return Err(ParseError::at(
            "empty formula".to_string(),
            parser.peek().start,
        ));
    }

    let ast = parser.or_expr()?;

    let trailing = parser.peek();
    if trailing.kind != TokenKind::Eof {
        return Err(ParseError::at(
            format!(
                "unexpected trailing input starting at \"{}\"",
                trailing.text
            ),
            trailing.start,
        ));
    }

    validate_range_placement(&ast)?;
    Ok(ast)
}

pub fn parse_formula<T: AddressableObject>(
    source: &str,
    objects: &[T],
    table_object_id: Option<&str>,
) -> Parsed {
    let tokens = lex(source)?;
    parse_formula_tokens(&tokens, objects, table_object_id)
}

#[cfg(test)]
mod tests {
    use super::{MAX_FORMULA_PARSE_DEPTH, parse_formula};
    use crate::address::AddressableObject;
    use crate::formula::ast::{BinaryOperator, FormulaAst, LiteralValue};
    use crate::model::{ErrorCode, ObjectType};

    struct Object {
        id: &'static str,
        name: &'static str,
        kind: ObjectType,
        slots: Vec<&'static str>,
    }

    impl AddressableObject for Object {
        fn id(&self) -> &str {
            self.id
        }
        fn name(&self) -> &str {
            self.name
        }
        fn object_type(&self) -> ObjectType {
            self.kind
        }
        fn slot_keys(&self) -> Vec<&str> {
            self.slots.clone()
        }
    }

    fn document() -> [Object; 2] {
        [
            Object {
                id: "t1",
                name: "table_x",
                kind: ObjectType::Table,
                slots: vec!["cells.A1", "cells.B2"],
            },
            Object {
                id: "p1",
                name: "poly",
                kind: ObjectType::Polygon,
                slots: vec!["vertices"],
            },
        ]
    }

    fn parse(source: &str) -> Result<FormulaAst, String> {
        parse_formula(source, &document(), None).map_err(|error| error.message)
    }

    #[test]
    fn reads_precedence_and_associativity_the_way_the_tiers_declare_them() {
        // A product binds tighter than a sum, so the product is the right
        // child rather than the root.
        match parse("1 + 2 * 3").expect("the formula parses") {
            FormulaAst::BinaryOp {
                operator, right, ..
            } => {
                assert_eq!(operator, BinaryOperator::Add);
                assert!(matches!(
                    *right,
                    FormulaAst::BinaryOp {
                        operator: BinaryOperator::Multiply,
                        ..
                    }
                ));
            }
            other => panic!("the root is a sum, not {other:?}"),
        }

        // Every tier reads from the left, power included, so the left child of
        // `2 ^ 3 ^ 2` is itself a power.
        match parse("2 ^ 3 ^ 2").expect("the formula parses") {
            FormulaAst::BinaryOp { left, .. } => assert!(matches!(
                *left,
                FormulaAst::BinaryOp {
                    operator: BinaryOperator::Power,
                    ..
                }
            )),
            other => panic!("the root is a power, not {other:?}"),
        }
    }

    #[test]
    fn a_word_operator_is_a_function_where_a_bracket_follows_it() {
        assert!(matches!(
            parse("NOT(TRUE)").expect("the formula parses"),
            FormulaAst::FunctionCall { .. }
        ));
        assert!(matches!(
            parse("NOT TRUE").expect("the formula parses"),
            FormulaAst::UnaryOp { .. }
        ));
    }

    #[test]
    fn a_name_is_resolved_to_an_id_while_parsing() {
        match parse("poly.vertices").expect("the formula parses") {
            FormulaAst::Reference(address) => {
                assert_eq!(address.object_id, "p1");
                assert_eq!(address.path, ["vertices"]);
            }
            other => panic!("the tree is a reference, not {other:?}"),
        }
        // A cell takes its stored spelling, so the tree holds the path the
        // graph keys the slot by rather than the one an operator typed.
        match parse("table_x.a1").expect("the formula parses") {
            FormulaAst::Reference(address) => assert_eq!(address.path, ["cells", "A1"]),
            other => panic!("the tree is a reference, not {other:?}"),
        }
        assert_eq!(
            parse("nope.x"),
            Err("no object named \"nope\" Did you mean \"poly\"?".to_string())
        );
    }

    #[test]
    fn a_bare_cell_reference_needs_the_table_around_it() {
        let inside = parse_formula("A1", &document(), Some("t1")).expect("the formula parses");
        match inside {
            FormulaAst::Reference(address) => {
                assert_eq!(address.object_id, "t1");
                assert_eq!(address.path, ["cells", "A1"]);
            }
            other => panic!("the tree is a reference, not {other:?}"),
        }
        assert!(parse("A1").is_err());
    }

    #[test]
    fn a_range_is_legal_only_where_an_aggregate_takes_it() {
        assert!(parse("SUM(table_x.A1:table_x.B2)").is_ok());
        assert_eq!(
            parse("table_x.A1:table_x.B2"),
            Err("a range (e.g. A1:B4) is only legal as a direct argument to an aggregate function (SUM, MIN, MAX, AVG)".to_string())
        );
        assert_eq!(
            parse("SUM(table_x.A1:poly.vertices)"),
            Err("a range's two endpoints must be cells in the same table".to_string())
        );
    }

    #[test]
    fn an_argument_count_is_checked_against_the_registry() {
        assert_eq!(
            parse("ROUND(1)"),
            Err("ROUND expects exactly 2 arguments, got 1".to_string())
        );
        assert_eq!(
            parse("NOPE(1)"),
            Err("unknown function \"NOPE\"".to_string())
        );
        assert_eq!(parse("sum(1)"), Err("unknown function \"sum\"".to_string()));
    }

    #[test]
    fn a_refusal_carries_the_parse_code_and_the_offset_of_the_fault() {
        let error =
            parse_formula("1 + ", &document(), None).expect_err("the formula is incomplete");
        assert_eq!(error.error, ErrorCode::Parse);
        assert_eq!(
            error.message,
            "expected an expression, found end of formula"
        );
        assert_eq!(error.start, 4);

        // A fault the lexer finds keeps the offset the lexer gave it.
        let lexical = parse_formula("1 @ 2", &document(), None).expect_err("the source refuses");
        assert_eq!(lexical.error, ErrorCode::Parse);
        assert_eq!(lexical.start, 2);
    }

    #[test]
    fn an_empty_formula_is_refused_rather_than_read_as_nothing() {
        assert_eq!(parse(""), Err("empty formula".to_string()));
        assert_eq!(parse("   "), Err("empty formula".to_string()));
    }

    #[test]
    fn nesting_past_the_limit_is_refused() {
        let inside = format!(
            "{}1{}",
            "(".repeat(MAX_FORMULA_PARSE_DEPTH / 2 - 1),
            ")".repeat(MAX_FORMULA_PARSE_DEPTH / 2 - 1)
        );
        assert!(parse(&inside).is_ok());

        let past = format!(
            "{}1{}",
            "(".repeat(MAX_FORMULA_PARSE_DEPTH),
            ")".repeat(MAX_FORMULA_PARSE_DEPTH)
        );
        assert_eq!(
            parse(&past),
            Err(format!(
                "formula nests too deeply (limit {MAX_FORMULA_PARSE_DEPTH} nesting steps); split it across cells, or over several slots"
            ))
        );
    }

    #[test]
    fn a_long_chain_of_one_operator_is_refused_by_the_depth_of_its_tree() {
        // A chain spends no nesting step, because each term is one step that
        // is given back. It builds a tree leaning to the left as far as the
        // chain is long, which the walk over the tree is what refuses.
        let chain: String = std::iter::repeat_n("1", 1100)
            .collect::<Vec<_>>()
            .join(" + ");
        assert_eq!(
            parse(&chain),
            Err("formula has more than 1000 nested operations; split it across cells, or use SUM over a range".to_string())
        );

        let short: String = std::iter::repeat_n("1", 50).collect::<Vec<_>>().join(" + ");
        assert!(matches!(
            parse(&short).expect("the formula parses"),
            FormulaAst::BinaryOp { .. }
        ));
    }

    #[test]
    fn a_literal_keeps_the_value_the_lexer_read() {
        assert_eq!(
            parse("2.5").expect("the formula parses"),
            FormulaAst::Literal(LiteralValue::Number(2.5))
        );
        assert_eq!(
            parse("\"a\\\"b\"").expect("the formula parses"),
            FormulaAst::Literal(LiteralValue::Text("a\"b".to_string()))
        );
    }
}
