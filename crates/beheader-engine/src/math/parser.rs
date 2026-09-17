//! Turns the tokens of one math source into a program, which is the second of
//! the four stages of the math language: lexer, parser, names and eval.
//!
//! This is the Rust side of `src/engine/math/parser.ts`. The parser runs over
//! the source twice. The first pass reads the head of every line and collects
//! the names the source defines as functions, and the second parses each line
//! with that set in hand. Two passes are what makes `f(x+1)` readable: whether
//! a name in front of a bracket calls a function or multiplies by one rests on
//! a definition that may appear further down, and one pass reaching that
//! bracket has not seen it yet.
//!
//! Juxtaposition is multiplication, the way it is on paper, so `2x` and `xy`
//! and `2\sin(x)` all parse as products. That rule leaves a differential
//! ambiguous, because the `dx` closing an integral would otherwise read as `d`
//! times `x`. The integrand parses under a flag that ends a product at an
//! identifier named `d` that another identifier follows, and the integral takes
//! the pair. A name spelled `d` inside an integrand is the cost of that rule.
//!
//! A line opening with the solve command is an implicit line: the unknown the
//! command names, then an equation with that unknown somewhere in it. It is the
//! one line shape whose two sides both parse as expressions, because an equals
//! sign elsewhere separates a name from its value.

use std::collections::HashSet;

use crate::address::Address;
use crate::math::ast::{
    MATH_MAX_DEPTH, MathAst, MathBinaryOperator, MathLine, MathProgram, SeriesOperation,
    math_ast_depth,
};
use crate::math::lexer::{MathToken, MathTokenType, tokenize_math};

/// Why a source does not parse, with the line it happened on counted from zero.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MathParseError {
    pub message: String,
    pub line: usize,
}

/// The functions every program can call without defining them, with the number
/// of arguments each takes. A call of a name outside this set and outside the
/// function definitions of the same source is an unknown function, which
/// `math/names.rs` reports.
pub const MATH_BUILT_IN_FUNCTIONS: [(&str, usize); 21] = [
    ("sin", 1),
    ("cos", 1),
    ("tan", 1),
    ("arcsin", 1),
    ("arccos", 1),
    ("arctan", 1),
    ("sinh", 1),
    ("cosh", 1),
    ("tanh", 1),
    ("ln", 1),
    ("log", 1),
    ("exp", 1),
    ("sqrt", 1),
    ("abs", 1),
    ("floor", 1),
    ("ceil", 1),
    ("round", 1),
    ("sign", 1),
    ("min", 2),
    ("max", 2),
    ("mod", 2),
];

pub fn built_in_arity(name: &str) -> Option<usize> {
    MATH_BUILT_IN_FUNCTIONS
        .iter()
        .find(|(held, _)| *held == name)
        .map(|(_, arity)| *arity)
}

/// The commands that name a constant rather than an operation.
fn command_constant(name: &str) -> Option<f64> {
    match name {
        "pi" => Some(std::f64::consts::PI),
        "tau" => Some(std::f64::consts::PI * 2.0),
        _ => None,
    }
}

/// The commands that spell a product or a quotient.
fn command_operator(name: &str) -> Option<MathBinaryOperator> {
    match name {
        "cdot" | "times" => Some(MathBinaryOperator::Multiply),
        "div" => Some(MathBinaryOperator::Divide),
        _ => None,
    }
}

type Parsed<T> = Result<T, String>;

struct Cursor<'a> {
    tokens: &'a [MathToken],
    index: usize,
    /// How many absolute value bars enclose the cursor. A bar both opens and
    /// closes, so inside a pair the next bar is the closing one rather than the
    /// start of another operand, and juxtaposition leaves it alone.
    bars: usize,
    /// How many brackets and groups enclose the cursor, which bounds recursion.
    depth: usize,
    functions: &'a HashSet<String>,
}

/// How a refusal names the token it found, where the end of the line has no
/// text of its own to quote.
fn found(token: &MathToken) -> &str {
    if token.text.is_empty() {
        "the end of the line"
    } else {
        &token.text
    }
}

impl<'a> Cursor<'a> {
    fn peek(&self) -> &MathToken {
        &self.tokens[self.index]
    }

    fn peek_at(&self, offset: usize) -> Option<&MathToken> {
        self.tokens.get(self.index + offset)
    }

    fn advance(&mut self) -> MathToken {
        let current = self.peek().clone();
        if current.kind != MathTokenType::Eof {
            self.index += 1;
        }
        current
    }

    fn expect(&mut self, kind: MathTokenType, what: &str) -> Parsed<MathToken> {
        let current = self.peek().clone();
        if current.kind != kind {
            return Err(format!(
                "{what} was expected, and \"{}\" is there instead",
                found(&current)
            ));
        }
        Ok(self.advance())
    }

    fn is_function(&self, name: &str) -> bool {
        self.functions.contains(name) || built_in_arity(name).is_some()
    }

    /// Whether the cursor sits on the differential that closes an integrand,
    /// which is an identifier named `d` that another identifier follows.
    fn at_differential(&self) -> bool {
        self.peek().kind == MathTokenType::Identifier
            && self.peek().name == "d"
            && self
                .peek_at(1)
                .is_some_and(|after| after.kind == MathTokenType::Identifier)
    }

    fn parse_expression(&mut self, stop_at_differential: bool) -> Parsed<MathAst> {
        self.parse_additive(stop_at_differential)
    }

    fn parse_additive(&mut self, stop_at_differential: bool) -> Parsed<MathAst> {
        let mut left = self.parse_multiplicative(stop_at_differential)?;
        loop {
            let operator = match self.peek().kind {
                MathTokenType::Plus => MathBinaryOperator::Add,
                MathTokenType::Minus => MathBinaryOperator::Subtract,
                _ => return Ok(left),
            };
            self.advance();
            let right = self.parse_multiplicative(stop_at_differential)?;
            left = MathAst::Binary {
                operator,
                left: Box::new(left),
                right: Box::new(right),
            };
        }
    }

    fn parse_multiplicative(&mut self, stop_at_differential: bool) -> Parsed<MathAst> {
        let mut left = self.parse_unary(stop_at_differential)?;
        loop {
            let current = self.peek().clone();

            let explicit = match current.kind {
                MathTokenType::Star => Some(MathBinaryOperator::Multiply),
                MathTokenType::Slash => Some(MathBinaryOperator::Divide),
                MathTokenType::Command => command_operator(&current.name),
                _ => None,
            };
            if let Some(operator) = explicit {
                self.advance();
                let right = self.parse_unary(stop_at_differential)?;
                left = MathAst::Binary {
                    operator,
                    left: Box::new(left),
                    right: Box::new(right),
                };
                continue;
            }

            if stop_at_differential && self.at_differential() {
                return Ok(left);
            }

            // Two operands beside each other multiply, which is what notation
            // means by them. A bar inside a pair closes that pair instead.
            let closing_bar = current.kind == MathTokenType::Bar && self.bars > 0;
            if starts_operand(&current) && !closing_bar {
                let right = self.parse_unary(stop_at_differential)?;
                left = MathAst::Binary {
                    operator: MathBinaryOperator::Multiply,
                    left: Box::new(left),
                    right: Box::new(right),
                };
                continue;
            }

            return Ok(left);
        }
    }

    fn parse_unary(&mut self, stop_at_differential: bool) -> Parsed<MathAst> {
        match self.peek().kind {
            MathTokenType::Minus => {
                self.advance();
                Ok(MathAst::Negate(Box::new(
                    self.parse_unary(stop_at_differential)?,
                )))
            }
            MathTokenType::Plus => {
                self.advance();
                self.parse_unary(stop_at_differential)
            }
            _ => self.parse_power(stop_at_differential),
        }
    }

    fn parse_power(&mut self, stop_at_differential: bool) -> Parsed<MathAst> {
        let base = self.parse_atom()?;
        if self.peek().kind != MathTokenType::Caret {
            return Ok(base);
        }
        self.advance();
        // An exponent is read from the right, so 2^3^2 is 2^(3^2). It parses at
        // the prefix level, which leaves a product outside it: 2^2x is (2^2)x.
        let exponent = self.parse_unary(stop_at_differential)?;
        Ok(MathAst::Binary {
            operator: MathBinaryOperator::Power,
            left: Box::new(base),
            right: Box::new(exponent),
        })
    }

    /// A braced group, which is how LaTeX delimits an argument.
    fn parse_group(&mut self) -> Parsed<MathAst> {
        self.expect(MathTokenType::LBrace, "an opening brace")?;
        let inner = self.parse_expression(false)?;
        self.expect(MathTokenType::RBrace, "a closing brace")?;
        Ok(inner)
    }

    /// One bound of a range. LaTeX braces a bound of more than one character
    /// and leaves a single character bare, so both forms arrive here.
    fn parse_bound(&mut self) -> Parsed<MathAst> {
        if self.peek().kind == MathTokenType::LBrace {
            return self.parse_group();
        }
        self.parse_atom()
    }

    fn parse_integral(&mut self) -> Parsed<MathAst> {
        self.expect(
            MathTokenType::Underscore,
            "a lower bound after the integral sign",
        )?;
        let lower = self.parse_bound()?;
        self.expect(MathTokenType::Caret, "an upper bound after the lower bound")?;
        let upper = self.parse_bound()?;
        let body = self.parse_expression(true)?;
        if !self.at_differential() {
            return Err(
                "an integral ends with a differential such as dx, which names the variable it integrates over"
                    .to_string(),
            );
        }
        self.advance();
        let variable = self.advance();
        Ok(MathAst::Integral {
            variable: variable.name,
            lower: Box::new(lower),
            upper: Box::new(upper),
            body: Box::new(body),
        })
    }

    fn parse_series(&mut self, operation: SeriesOperation) -> Parsed<MathAst> {
        let word = operation.as_str();
        self.expect(
            MathTokenType::Underscore,
            &format!("a lower bound after the {word} sign"),
        )?;
        self.expect(
            MathTokenType::LBrace,
            "an opening brace around the lower bound",
        )?;
        let variable = self.expect(
            MathTokenType::Identifier,
            &format!("the variable the {word} runs over"),
        )?;
        self.expect(
            MathTokenType::Equals,
            "an equals sign between the variable and its first value",
        )?;
        let lower = self.parse_expression(false)?;
        self.expect(
            MathTokenType::RBrace,
            "a closing brace around the lower bound",
        )?;
        self.expect(MathTokenType::Caret, "an upper bound after the lower bound")?;
        let upper = self.parse_bound()?;
        let body = self.parse_multiplicative(false)?;
        Ok(MathAst::Series {
            operation,
            variable: variable.name,
            lower: Box::new(lower),
            upper: Box::new(upper),
            body: Box::new(body),
        })
    }

    fn parse_call_arguments(&mut self) -> Parsed<Vec<MathAst>> {
        self.expect(
            MathTokenType::LParen,
            "an opening bracket after a function name",
        )?;
        let mut args = Vec::new();
        if self.peek().kind != MathTokenType::RParen {
            args.push(self.parse_expression(false)?);
            while self.peek().kind == MathTokenType::Comma {
                self.advance();
                args.push(self.parse_expression(false)?);
            }
        }
        self.expect(
            MathTokenType::RParen,
            "a closing bracket after the arguments",
        )?;
        Ok(args)
    }

    fn parse_command_atom(&mut self, token: &MathToken) -> Parsed<MathAst> {
        if let Some(constant) = command_constant(&token.name) {
            return Ok(MathAst::Number(constant));
        }

        match token.name.as_str() {
            "frac" | "dfrac" | "tfrac" => {
                let numerator = self.parse_group()?;
                let denominator = self.parse_group()?;
                Ok(MathAst::Binary {
                    operator: MathBinaryOperator::Divide,
                    left: Box::new(numerator),
                    right: Box::new(denominator),
                })
            }
            "sqrt" => {
                if self.peek().kind == MathTokenType::LBracket {
                    self.advance();
                    let degree = self.parse_expression(false)?;
                    self.expect(
                        MathTokenType::RBracket,
                        "a closing bracket after the root degree",
                    )?;
                    let radicand = self.parse_group()?;
                    // A root of degree n is a power of one over n, which the
                    // evaluator already knows how to take.
                    return Ok(MathAst::Binary {
                        operator: MathBinaryOperator::Power,
                        left: Box::new(radicand),
                        right: Box::new(MathAst::Binary {
                            operator: MathBinaryOperator::Divide,
                            left: Box::new(MathAst::Number(1.0)),
                            right: Box::new(degree),
                        }),
                    });
                }
                Ok(MathAst::Call {
                    name: "sqrt".to_string(),
                    args: vec![self.parse_group()?],
                })
            }
            "int" => self.parse_integral(),
            "sum" => self.parse_series(SeriesOperation::Sum),
            "prod" => self.parse_series(SeriesOperation::Product),
            name if built_in_arity(name).is_some() => Ok(MathAst::Call {
                name: name.to_string(),
                args: self.parse_call_arguments()?,
            }),
            name => Err(format!(
                "\"\\{name}\" is not a command this formula language reads"
            )),
        }
    }

    fn parse_atom(&mut self) -> Parsed<MathAst> {
        if self.depth > MATH_MAX_DEPTH {
            return Err(format!(
                "this line nests deeper than {MATH_MAX_DEPTH} levels"
            ));
        }
        self.depth += 1;
        let parsed = self.parse_atom_inner();
        self.depth -= 1;
        parsed
    }

    fn parse_atom_inner(&mut self) -> Parsed<MathAst> {
        let current = self.advance();

        match current.kind {
            MathTokenType::Number => Ok(MathAst::Number(current.value)),
            MathTokenType::Reference => {
                let Some(dot) = current.name.find('.') else {
                    return Err(address_refusal(&current.name));
                };
                if dot == 0 || dot == current.name.len() - 1 {
                    return Err(address_refusal(&current.name));
                }
                // The stored spelling carries the object id, so reading it
                // works with no list of objects and a rename rewrites nothing.
                Ok(MathAst::Reference(Address {
                    object_id: current.name[..dot].to_string(),
                    path: current.name[dot + 1..]
                        .split('.')
                        .map(str::to_string)
                        .collect(),
                }))
            }
            MathTokenType::Identifier => {
                if self.is_function(&current.name) && self.peek().kind == MathTokenType::LParen {
                    return Ok(MathAst::Call {
                        name: current.name,
                        args: self.parse_call_arguments()?,
                    });
                }
                Ok(MathAst::Name(current.name))
            }
            MathTokenType::LParen => {
                let inner = self.parse_expression(false)?;
                self.expect(MathTokenType::RParen, "a closing bracket")?;
                Ok(inner)
            }
            MathTokenType::LBrace => {
                let inner = self.parse_expression(false)?;
                self.expect(MathTokenType::RBrace, "a closing brace")?;
                Ok(inner)
            }
            MathTokenType::Bar => {
                self.bars += 1;
                let inner = self.parse_expression(false);
                self.bars -= 1;
                let inner = inner?;
                self.expect(MathTokenType::Bar, "a closing bar around an absolute value")?;
                Ok(MathAst::Call {
                    name: "abs".to_string(),
                    args: vec![inner],
                })
            }
            MathTokenType::Command => self.parse_command_atom(&current),
            _ => Err(format!(
                "a value was expected, and \"{}\" is there instead",
                found(&current)
            )),
        }
    }
}

fn address_refusal(name: &str) -> String {
    format!("\"{name}\" is not an address, which names an object and then a slot of it")
}

/// Whether a token can open an operand, which is what juxtaposition needs.
fn starts_operand(token: &MathToken) -> bool {
    match token.kind {
        MathTokenType::Number
        | MathTokenType::Identifier
        | MathTokenType::LParen
        | MathTokenType::Bar
        | MathTokenType::Reference => true,
        MathTokenType::Command => command_operator(&token.name).is_none(),
        _ => false,
    }
}

/// The head of one line, and the function it defines. This is the first of the
/// two passes, so it runs before any expression parses and looks at nothing
/// beyond the bracket list.
fn function_definition_name(tokens: &[MathToken]) -> Option<String> {
    let kind = |at: usize| tokens.get(at).map(|token| token.kind);
    if kind(0) != Some(MathTokenType::Identifier) || kind(1) != Some(MathTokenType::LParen) {
        return None;
    }
    let mut at = 2;
    if kind(at) == Some(MathTokenType::Identifier) {
        at += 1;
        while kind(at) == Some(MathTokenType::Comma)
            && kind(at + 1) == Some(MathTokenType::Identifier)
        {
            at += 2;
        }
    }
    if kind(at) != Some(MathTokenType::RParen) || kind(at + 1) != Some(MathTokenType::Equals) {
        return None;
    }
    tokens.first().map(|token| token.name.clone())
}

fn parse_line(
    tokens: &[MathToken],
    functions: &HashSet<String>,
    source_line: usize,
) -> Parsed<MathLine> {
    let mut cursor = Cursor {
        tokens,
        index: 0,
        bars: 0,
        depth: 0,
        functions,
    };

    if tokens.first().map(|token| token.kind) == Some(MathTokenType::Solve) {
        let unknown = cursor.advance().name;
        let left = cursor.parse_expression(false)?;
        cursor.expect(
            MathTokenType::Equals,
            "an equals sign between the two sides of the equation",
        )?;
        let right = cursor.parse_expression(false)?;
        cursor.expect(MathTokenType::Eof, "the end of the line")?;
        return Ok(MathLine::Solve {
            unknown,
            left,
            right,
            source_line,
        });
    }

    if let Some(name) = function_definition_name(tokens) {
        cursor.advance();
        cursor.advance();
        let mut parameters: Vec<String> = Vec::new();
        if cursor.peek().kind == MathTokenType::Identifier {
            parameters.push(cursor.advance().name);
            while cursor.peek().kind == MathTokenType::Comma {
                cursor.advance();
                parameters.push(
                    cursor
                        .expect(MathTokenType::Identifier, "a parameter name")?
                        .name,
                );
            }
        }
        cursor.expect(
            MathTokenType::RParen,
            "a closing bracket after the parameters",
        )?;
        cursor.expect(
            MathTokenType::Equals,
            "an equals sign after the parameter list",
        )?;
        let body = cursor.parse_expression(false)?;
        cursor.expect(MathTokenType::Eof, "the end of the line")?;
        let unique: HashSet<&String> = parameters.iter().collect();
        if unique.len() != parameters.len() {
            return Err(format!(
                "the parameters of \"{name}\" repeat a name, and each one names a different value"
            ));
        }
        return Ok(MathLine::FunctionDefinition {
            name,
            parameters,
            body,
        });
    }

    let kind = |at: usize| tokens.get(at).map(|token| token.kind);
    if kind(0) == Some(MathTokenType::Identifier) && kind(1) == Some(MathTokenType::Equals) {
        let name = cursor.advance().name;
        cursor.advance();
        let value = cursor.parse_expression(false)?;
        cursor.expect(MathTokenType::Eof, "the end of the line")?;
        return Ok(MathLine::Definition {
            name,
            value,
            source_line,
        });
    }

    // A line with an equals sign that matched no definition head is almost
    // always a name of more than one letter, because juxtaposition is
    // multiplication and abc reads as a product of three names. Reporting the
    // equals sign as a surprise would describe the symptom rather than the
    // mistake.
    if tokens
        .iter()
        .any(|token| token.kind == MathTokenType::Equals)
        && kind(0) == Some(MathTokenType::Identifier)
        && kind(1) == Some(MathTokenType::Identifier)
    {
        let leading: Vec<&str> = tokens
            .iter()
            .filter(|token| token.kind == MathTokenType::Identifier)
            .take(3)
            .map(|token| token.name.as_str())
            .collect();
        return Err(format!(
            "a definition names one value before the equals sign, and \"{}\" reads as {}, \
because letters beside each other multiply. A name of more than one letter takes a subscript such as x_{{ans}}, \
or the \\operatorname form",
            leading.concat(),
            leading.join(" times ")
        ));
    }

    let value = cursor.parse_expression(false)?;
    cursor.expect(MathTokenType::Eof, "the end of the line")?;
    Ok(MathLine::Expression { value })
}

/// Parses a whole math source into a program, or reports the first line that
/// could not be read. A blank line is dropped rather than refused, so an
/// operator can space a source out.
pub fn parse_math(source: &str) -> Result<MathProgram, MathParseError> {
    let mut token_lines: Vec<(Vec<MathToken>, usize)> = Vec::new();

    for (index, raw) in source.split('\n').enumerate() {
        if raw.trim().is_empty() {
            continue;
        }
        match tokenize_math(raw) {
            Err(error) => {
                return Err(MathParseError {
                    message: error.message,
                    line: index,
                });
            }
            Ok(tokens) => token_lines.push((tokens, index)),
        }
    }

    let functions: HashSet<String> = token_lines
        .iter()
        .filter_map(|(tokens, _)| function_definition_name(tokens))
        .collect();

    let mut lines = Vec::new();
    for (tokens, index) in &token_lines {
        let line = parse_line(tokens, &functions, *index).map_err(|message| MathParseError {
            message,
            line: *index,
        })?;
        let bodies: Vec<&MathAst> = match &line {
            MathLine::Solve { left, right, .. } => vec![left, right],
            MathLine::FunctionDefinition { body, .. } => vec![body],
            MathLine::Definition { value, .. } | MathLine::Expression { value } => vec![value],
        };
        if bodies.iter().map(|body| math_ast_depth(body)).max() > Some(MATH_MAX_DEPTH) {
            return Err(MathParseError {
                message: format!("this line nests deeper than {MATH_MAX_DEPTH} levels"),
                line: *index,
            });
        }
        lines.push(line);
    }

    Ok(MathProgram { lines })
}

#[cfg(test)]
mod tests {
    use super::{MATH_BUILT_IN_FUNCTIONS, built_in_arity, parse_math};
    use crate::math::ast::{MathAst, MathBinaryOperator, MathLine, SeriesOperation};

    /// The shape of an expression, written the way a reader checks one.
    fn shape(ast: &MathAst) -> String {
        match ast {
            MathAst::Number(value) => format!("{value}"),
            MathAst::Name(name) => name.clone(),
            MathAst::Reference(address) => format!("ref({})", address.object_id),
            MathAst::Binary {
                operator,
                left,
                right,
            } => format!("({}{}{})", shape(left), operator.as_str(), shape(right)),
            MathAst::Negate(operand) => format!("-{}", shape(operand)),
            MathAst::Call { name, args } => format!(
                "{name}({})",
                args.iter().map(shape).collect::<Vec<_>>().join(",")
            ),
            MathAst::Integral { variable, body, .. } => {
                format!("int_{variable}({})", shape(body))
            }
            MathAst::Series {
                operation,
                variable,
                body,
                ..
            } => format!("{}_{variable}({})", operation.as_str(), shape(body)),
        }
    }

    fn first(source: &str) -> String {
        let program = parse_math(source).expect("the source parses");
        match program.lines.first().expect("there is a line") {
            MathLine::Definition { value, .. } | MathLine::Expression { value } => shape(value),
            MathLine::FunctionDefinition { body, .. } => shape(body),
            MathLine::Solve { left, .. } => shape(left),
        }
    }

    fn refusal(source: &str) -> String {
        parse_math(source)
            .expect_err("the source does not parse")
            .message
    }

    #[test]
    fn two_things_beside_each_other_multiply() {
        assert_eq!(first("2x"), "(2*x)");
        assert_eq!(first("xy"), "(x*y)");
        assert_eq!(first("2(x+1)"), "(2*(x+1))");
        assert_eq!(first("(1+2)3"), "((1+2)*3)");
    }

    #[test]
    fn a_name_in_front_of_a_bracket_calls_a_function_defined_anywhere_in_the_source() {
        // The definition sits below the call, so one pass reaching that bracket
        // would read a product instead.
        assert_eq!(first("f(x+1)\nf(t)=t"), "f((x+1))");
        // With nothing defining it, the same text is a product.
        assert_eq!(first("g(x+1)"), "(g*(x+1))");
        assert_eq!(first("\\sin(x)"), "sin(x)");
        // Typed bare, those three letters are three names beside each other,
        // because only a command or a wrapping makes a name of more than one
        // letter. A wrapped spelling reaches the built-in.
        assert_eq!(first("sin(x)"), "(((s*i)*n)*x)");
        assert_eq!(first("\\operatorname{sin}(x)"), "sin(x)");
    }

    #[test]
    fn an_exponent_is_read_from_the_right_and_leaves_a_product_outside_it() {
        assert_eq!(first("2^3^2"), "(2^(3^2))");
        assert_eq!(first("2^2x"), "((2^2)*x)");
    }

    #[test]
    fn a_root_of_a_degree_is_a_power_of_one_over_it() {
        assert_eq!(first("\\sqrt[3]{8}"), "(8^(1/3))");
        assert_eq!(first("\\sqrt{4}"), "sqrt(4)");
    }

    #[test]
    fn a_bar_inside_a_pair_closes_that_pair_rather_than_opening_another() {
        assert_eq!(first("|x|+|y|"), "(abs(x)+abs(y))");
        assert_eq!(first("|x-y|"), "abs((x-y))");
    }

    #[test]
    fn an_integral_takes_its_variable_from_the_differential_that_closes_it() {
        assert_eq!(first("\\int_{0}^{1}x\\,dx"), "int_x(x)");
        assert_eq!(first("\\int_0^1x\\,dx"), "int_x(x)");
        assert_eq!(
            refusal("\\int_{0}^{1}x"),
            "an integral ends with a differential such as dx, which names the variable it integrates over"
        );
    }

    #[test]
    fn a_series_takes_its_variable_from_its_lower_bound_and_its_body_stops_at_a_sum() {
        assert_eq!(first("\\sum_{i=1}^{n}i"), "sum_i(i)");
        assert_eq!(first("\\prod_{i=1}^{n}i"), "product_i(i)");
        // The body parses at the product level, so a plus after it belongs to
        // the expression around the series rather than to its body.
        assert_eq!(first("\\sum_{i=1}^{n}i+1"), "(sum_i(i)+1)");
    }

    #[test]
    fn an_address_keeps_the_object_id_the_source_spelled() {
        match parse_math("\\gpref{obj_1.cells.A1}")
            .expect("the source parses")
            .lines
            .first()
            .expect("there is a line")
        {
            MathLine::Expression {
                value: MathAst::Reference(address),
            } => {
                assert_eq!(address.object_id, "obj_1");
                assert_eq!(address.path, ["cells", "A1"]);
            }
            other => panic!("the line is a reference, not {other:?}"),
        }
        assert!(parse_math("\\gpref{obj_1}").is_err());
        assert!(parse_math("\\gpref{obj_1.}").is_err());
    }

    #[test]
    fn a_line_naming_two_letters_is_told_what_it_reads_as() {
        // Reporting the equals sign as a surprise would name the symptom, so
        // the refusal names the product the letters make instead.
        let message = refusal("xy=2");
        assert!(message.contains("\"xy\" reads as x times y"), "{message}");
        assert!(message.contains("x_{ans}"), "{message}");
        let three = refusal("abc=2");
        assert!(
            three.contains("\"abc\" reads as a times b times c"),
            "{three}"
        );
    }

    #[test]
    fn a_blank_line_is_dropped_and_the_rest_keep_their_numbers() {
        let program = parse_math("y=1\n\nz=2").expect("the source parses");
        assert_eq!(program.lines.len(), 2);
        match (&program.lines[0], &program.lines[1]) {
            (
                MathLine::Definition {
                    name: first_name,
                    source_line: first_line,
                    ..
                },
                MathLine::Definition {
                    name: second_name,
                    source_line: second_line,
                    ..
                },
            ) => {
                assert_eq!((first_name.as_str(), *first_line), ("y", 0));
                // The blank line is line 1 of the source, so the line below it
                // keeps 2 rather than moving up to 1.
                assert_eq!((second_name.as_str(), *second_line), ("z", 2));
            }
            other => panic!("both lines are definitions, not {other:?}"),
        }
        assert_eq!(parse_math("").expect("the source parses").lines.len(), 0);
    }

    #[test]
    fn a_function_definition_names_each_parameter_once() {
        match parse_math("f(a,b)=a+b")
            .expect("the source parses")
            .lines
            .first()
            .expect("there is a line")
        {
            MathLine::FunctionDefinition {
                name, parameters, ..
            } => {
                assert_eq!(name, "f");
                assert_eq!(parameters, &["a".to_string(), "b".to_string()]);
            }
            other => panic!("the line defines a function, not {other:?}"),
        }
        assert_eq!(
            refusal("f(a,a)=a"),
            "the parameters of \"f\" repeat a name, and each one names a different value"
        );
    }

    #[test]
    fn an_implicit_line_carries_the_unknown_it_was_written_with() {
        match parse_math("\\solve{x}x^2=4")
            .expect("the source parses")
            .lines
            .first()
            .expect("there is a line")
        {
            MathLine::Solve {
                unknown,
                left,
                right,
                ..
            } => {
                assert_eq!(unknown, "x");
                assert_eq!(shape(left), "(x^2)");
                assert_eq!(shape(right), "4");
            }
            other => panic!("the line is a solve, not {other:?}"),
        }
    }

    #[test]
    fn a_line_deeper_than_the_limit_is_refused() {
        let deep = format!("{}1{}", "(".repeat(70), ")".repeat(70));
        assert_eq!(refusal(&deep), "this line nests deeper than 64 levels");
    }

    #[test]
    fn the_built_in_table_answers_by_name() {
        assert_eq!(built_in_arity("sin"), Some(1));
        assert_eq!(built_in_arity("mod"), Some(2));
        assert_eq!(built_in_arity("nope"), None);
        assert_eq!(MATH_BUILT_IN_FUNCTIONS.len(), 21);
    }

    #[test]
    fn a_series_operation_names_itself_the_way_the_shapes_read() {
        assert_eq!(SeriesOperation::Sum.as_str(), "sum");
        assert_eq!(SeriesOperation::Product.as_str(), "product");
        assert_eq!(MathBinaryOperator::Power.as_str(), "^");
    }
}
