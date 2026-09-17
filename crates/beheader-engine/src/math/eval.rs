//! Evaluates a parsed program over a set of input values, which is the last of
//! the four stages of the math language: lexer, parser, names and eval.
//!
//! This is the Rust side of `src/engine/math/eval.ts`. `evaluate_math_object`
//! is the seam the whole language sits behind. The graph evaluator calls it
//! through a compute function on a derived slot and knows nothing about an
//! equation, the same arrangement a script node gets.
//!
//! Each exported line has a shared budget of expression visits. Nested series,
//! integrals, function calls and solver samples spend the same budget, so their
//! individual loop limits cannot multiply into an unbounded workload.
//!
//! An integral uses Simpson's rule over a fixed even number of intervals rather
//! than an adaptive count, because an adaptive rule reaches a different answer
//! as the tolerance changes and evaluation runs again on every mutation. A
//! value that moved on its own between two frames would read as a fault in the
//! document rather than in the quadrature.
//!
//! A number that leaves an operation non-finite becomes an error value, because
//! a slot holding an infinity spreads it silently through everything that reads
//! it.
//!
//! An implicit line is solved by search rather than by algebra. The difference
//! between the two sides is a function of the unknown, and the solve looks
//! outward from the seed for a place where that difference changes sign, then
//! halves that interval down. The search reads one snapshot of the inputs from
//! its first step to its last, runs a fixed number of steps whatever the
//! equation, and starts from a value a slot carries rather than from a guess.
//!
//! The cost of finding a root that way is that a root the curve touches without
//! crossing, such as the one of `(x-2)^2 = 0`, is invisible to a sign change
//! and gives an error value instead. A search over a function this language can
//! build out of an integral and a series has no algebra to call on, and a curve
//! that comes back from zero without passing through it is rare beside one that
//! crosses.

use std::collections::HashMap;

use crate::address::Address;
use crate::math::ast::{MathAst, MathBinaryOperator, MathLine, MathProgram, SeriesOperation};
use crate::model::{ErrorCode, ErrorValue, Value};
use crate::number::{
    js_acos, js_asin, js_atan, js_cos, js_cosh, js_exp, js_ln, js_log10, js_max, js_min, js_pow,
    js_round, js_sign, js_sin, js_sinh, js_sqrt, js_tan, js_tanh, to_javascript_text,
};

/// The number of intervals Simpson's rule divides an integral into.
pub const MATH_QUADRATURE_INTERVALS: usize = 512;

/// The largest number of terms a sum or a product runs over. A range wider than
/// this is a mistake rather than an intention, and the limit keeps one line of
/// a source from stalling the evaluation pass.
pub const MATH_MAX_SERIES_TERMS: f64 = 100_000.0;

/// The deepest chain of function calls an evaluation follows. `math/names.rs`
/// refuses a source whose functions call each other in a circle, so a program
/// that arrives through a parse stays far below this. The limit covers a
/// program built by hand instead, and it keeps termination a property of this
/// function rather than of the caller.
pub const MATH_MAX_CALL_DEPTH: usize = 64;

/// A line can visit this many expressions before returning a math error.
pub const MATH_MAX_EVALUATION_STEPS: usize = 1_000_000;

/// How many rings the search for a root looks through before it gives up. Each
/// ring is twice as far from the seed as the one before it, so the last of this
/// many reaches about 2^51 times the scale of the seed, which is past the point
/// where a double carries whole numbers exactly.
pub const MATH_SOLVE_RINGS: usize = 60;

/// The radius of the first ring, as a fraction of the scale of the seed. It is
/// small enough that a root close to the seed lands in an early ring, and the
/// doubling covers the distance to a far one in few enough steps.
pub const MATH_SOLVE_FIRST_RADIUS: f64 = 1.0 / 256.0;

/// How many times the search halves an interval that holds a root. Each step
/// halves the width, so this many take any starting interval below the spacing
/// between two neighbouring doubles.
pub const MATH_SOLVE_BISECTIONS: usize = 80;

/// Why an evaluation stopped. A budget failure is told apart from the rest
/// because the search for a root steps over a place the equation cannot be read
/// and must not step over one that spent the budget.
#[derive(Clone, Debug, PartialEq)]
enum Failure {
    Eval(ErrorValue),
    Budget(ErrorValue),
}

impl Failure {
    fn value(self) -> ErrorValue {
        match self {
            Failure::Eval(value) | Failure::Budget(value) => value,
        }
    }
}

fn math_error(message: String) -> Failure {
    Failure::Eval(ErrorValue {
        error: ErrorCode::Math,
        message,
    })
}

type Evaluated = Result<f64, Failure>;

/// The value a result takes, where a number that is not finite stops the line.
/// A zero comes back positive, because a negative zero is a value no operator
/// asked for and none reads.
fn check_finite(result: f64, what: &str) -> Evaluated {
    if !result.is_finite() {
        return Err(math_error(format!(
            "{what} gave a result that is not a finite number"
        )));
    }
    Ok(if result == 0.0 { 0.0 } else { result })
}

fn unary_function(name: &str) -> Option<fn(f64) -> f64> {
    Some(match name {
        "sin" => js_sin,
        "cos" => js_cos,
        "tan" => js_tan,
        "arcsin" => js_asin,
        "arccos" => js_acos,
        "arctan" => js_atan,
        "sinh" => js_sinh,
        "cosh" => js_cosh,
        "tanh" => js_tanh,
        "ln" => js_ln,
        "log" => js_log10,
        "exp" => js_exp,
        "sqrt" => js_sqrt,
        "abs" => f64::abs,
        "floor" => f64::floor,
        "ceil" => f64::ceil,
        // Both of these answer differently in Rust, so the JavaScript spelling
        // is the one a document carries.
        "round" => js_round,
        "sign" => js_sign,
        _ => return None,
    })
}

fn binary_function(name: &str) -> Option<fn(f64, f64) -> f64> {
    Some(match name {
        "min" => js_min,
        "max" => js_max,
        "mod" => |a: f64, b: f64| a - b * (a / b).floor(),
        _ => return None,
    })
}

/// Whether a number is a whole one a double carries exactly, which is what a
/// series needs of its bounds.
fn is_safe_integer(value: f64) -> bool {
    value.is_finite() && value.fract() == 0.0 && value.abs() <= 9_007_199_254_740_991.0
}

/// The one spelling of an address this language keys a value by. The graph has
/// its own key for an edge, and this one stays inside the box, so a change to
/// either leaves the other alone.
pub fn math_address_key(address: &Address) -> String {
    format!("{}.{}", address.object_id, address.path.join("."))
}

/// The value of each name a source defines, keyed by that name.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct MathEvaluation {
    pub exports: Vec<(String, Value)>,
}

impl MathEvaluation {
    pub fn get(&self, name: &str) -> Option<&Value> {
        self.exports
            .iter()
            .find(|(held, _)| held == name)
            .map(|(_, value)| value)
    }
}

/// The two sides of an implicit line and the unknown they constrain, which the
/// search passes from step to step as one thing.
#[derive(Clone, Copy)]
struct Equation<'a> {
    unknown: &'a str,
    left: &'a MathAst,
    right: &'a MathAst,
}

struct Evaluator<'a> {
    budget: usize,
    references: &'a HashMap<String, f64>,
    functions: HashMap<String, (Vec<String>, MathAst)>,
}

impl Evaluator<'_> {
    fn spend(&mut self) -> Result<(), Failure> {
        if self.budget == 0 {
            return Err(Failure::Budget(ErrorValue {
                error: ErrorCode::Math,
                message: format!(
                    "the line exceeds its budget of {MATH_MAX_EVALUATION_STEPS} expression evaluations"
                ),
            }));
        }
        self.budget -= 1;
        Ok(())
    }

    fn eval(&mut self, ast: &MathAst, values: &HashMap<String, f64>, depth: usize) -> Evaluated {
        self.spend()?;
        match ast {
            MathAst::Number(value) => Ok(*value),
            MathAst::Name(name) => values
                .get(name)
                .copied()
                .ok_or_else(|| math_error(format!("\"{name}\" has no value here"))),
            MathAst::Reference(address) => {
                let key = math_address_key(address);
                self.references.get(&key).copied().ok_or_else(|| {
                    math_error(format!("the address \"{key}\" carries no number here"))
                })
            }
            MathAst::Negate(operand) => {
                let value = self.eval(operand, values, depth)?;
                check_finite(-value, "a negation")
            }
            MathAst::Binary {
                operator,
                left,
                right,
            } => {
                let a = self.eval(left, values, depth)?;
                let b = self.eval(right, values, depth)?;
                match operator {
                    MathBinaryOperator::Add => check_finite(a + b, "an addition"),
                    MathBinaryOperator::Subtract => check_finite(a - b, "a subtraction"),
                    MathBinaryOperator::Multiply => check_finite(a * b, "a multiplication"),
                    MathBinaryOperator::Divide => {
                        if b == 0.0 {
                            return Err(Failure::Eval(ErrorValue {
                                error: ErrorCode::Div0,
                                message: "a division by zero".to_string(),
                            }));
                        }
                        check_finite(a / b, "a division")
                    }
                    MathBinaryOperator::Power => check_finite(js_pow(a, b), "a power"),
                }
            }
            MathAst::Call { name, args } => self.eval_call(name, args, values, depth),
            MathAst::Integral { .. } => self.eval_integral(ast, values, depth),
            MathAst::Series { .. } => self.eval_series(ast, values, depth),
        }
    }

    fn eval_call(
        &mut self,
        name: &str,
        args: &[MathAst],
        values: &HashMap<String, f64>,
        depth: usize,
    ) -> Evaluated {
        if let Some((parameters, body)) = self.functions.get(name).cloned() {
            if depth >= MATH_MAX_CALL_DEPTH {
                return Err(math_error(format!(
                    "a chain of {MATH_MAX_CALL_DEPTH} function calls is deeper than this language runs"
                )));
            }
            let mut inner = values.clone();
            for (index, parameter) in parameters.iter().enumerate() {
                let Some(argument) = args.get(index) else {
                    return Err(math_error(format!(
                        "\"{name}\" was called with too few arguments"
                    )));
                };
                let value = self.eval(argument, values, depth)?;
                inner.insert(parameter.clone(), value);
            }
            return self.eval(&body, &inner, depth + 1);
        }

        if let Some(unary) = unary_function(name) {
            let Some(argument) = args.first() else {
                return Err(math_error(format!("\"{name}\" takes one argument")));
            };
            let value = self.eval(argument, values, depth)?;
            return check_finite(unary(value), &format!("\"{name}\""));
        }

        if let Some(binary) = binary_function(name) {
            let (Some(first), Some(second)) = (args.first(), args.get(1)) else {
                return Err(math_error(format!("\"{name}\" takes two arguments")));
            };
            let a = self.eval(first, values, depth)?;
            let b = self.eval(second, values, depth)?;
            return check_finite(binary(a, b), &format!("\"{name}\""));
        }

        Err(math_error(format!(
            "\"{name}\" is not a function this language knows"
        )))
    }

    /// One value of the body of a binding form, with the variable set to `at`.
    fn eval_at(
        &mut self,
        body: &MathAst,
        variable: &str,
        at: f64,
        values: &HashMap<String, f64>,
        depth: usize,
    ) -> Evaluated {
        let mut inner = values.clone();
        inner.insert(variable.to_string(), at);
        self.eval(body, &inner, depth)
    }

    fn eval_integral(
        &mut self,
        ast: &MathAst,
        values: &HashMap<String, f64>,
        depth: usize,
    ) -> Evaluated {
        let MathAst::Integral {
            variable,
            lower,
            upper,
            body,
        } = ast
        else {
            return Err(math_error("an integral was expected here".to_string()));
        };
        let from = self.eval(lower, values, depth)?;
        let to = self.eval(upper, values, depth)?;
        if from == to {
            return Ok(0.0);
        }

        let intervals = MATH_QUADRATURE_INTERVALS;
        let width = (to - from) / intervals as f64;
        let mut total = self.eval_at(body, variable, from, values, depth)?
            + self.eval_at(body, variable, to, values, depth)?;

        for step in 1..intervals {
            let weight = if step % 2 == 0 { 2.0 } else { 4.0 };
            let at = from + step as f64 * width;
            total += weight * self.eval_at(body, variable, at, values, depth)?;
        }

        check_finite(total * width / 3.0, "an integral")
    }

    fn eval_series(
        &mut self,
        ast: &MathAst,
        values: &HashMap<String, f64>,
        depth: usize,
    ) -> Evaluated {
        let MathAst::Series {
            operation,
            variable,
            lower,
            upper,
            body,
        } = ast
        else {
            return Err(math_error("a series was expected here".to_string()));
        };
        let operation = *operation;
        let word = operation.as_str();
        let from = self.eval(lower, values, depth)?;
        let to = self.eval(upper, values, depth)?;

        if !is_safe_integer(from) || !is_safe_integer(to) {
            return Err(math_error(format!(
                "a {word} runs between two safe whole numbers, and this one runs between {} and {}",
                to_javascript_text(from),
                to_javascript_text(to)
            )));
        }
        let empty = if operation == SeriesOperation::Sum {
            0.0
        } else {
            1.0
        };
        if to < from {
            return Ok(empty);
        }
        let terms = to - from + 1.0;
        if terms > MATH_MAX_SERIES_TERMS {
            return Err(math_error(format!(
                "a {word} over {} terms is wider than the limit of {}",
                to_javascript_text(terms),
                to_javascript_text(MATH_MAX_SERIES_TERMS)
            )));
        }

        let mut total = empty;
        for index in 0..terms as u64 {
            let step = from + index as f64;
            let term = self.eval_at(body, variable, step, values, depth)?;
            total = if operation == SeriesOperation::Sum {
                total + term
            } else {
                total * term
            };
        }
        check_finite(total, &format!("a {word}"))
    }

    /// The difference between the two sides of an equation at one value of the
    /// unknown. A root of this is a value that makes the equation true.
    fn residual_at(
        &mut self,
        equation: Equation<'_>,
        at: f64,
        values: &HashMap<String, f64>,
    ) -> Evaluated {
        let mut inner = values.clone();
        inner.insert(equation.unknown.to_string(), at);
        let a = self.eval(equation.left, &inner, 0)?;
        let b = self.eval(equation.right, &inner, 0)?;
        check_finite(a - b, "an equation")
    }

    /// The difference at one value, or nothing where the equation has no value
    /// there. A square root of a negative and a division by zero each happen at
    /// some values of the unknown and not others, so a place the equation
    /// cannot be read is one the search steps over rather than a failure of the
    /// whole solve. A spent budget is not stepped over.
    fn residual_or_nothing(
        &mut self,
        equation: Equation<'_>,
        at: f64,
        values: &HashMap<String, f64>,
    ) -> Result<Option<f64>, Failure> {
        match self.residual_at(equation, at, values) {
            Ok(value) => Ok(Some(value)),
            Err(Failure::Budget(value)) => Err(Failure::Budget(value)),
            Err(Failure::Eval(_)) => Ok(None),
        }
    }

    /// The value between two points the difference changes sign across, found
    /// by halving a fixed number of times. A midpoint the equation cannot be
    /// read at stops the halving, because the interval has come apart and no
    /// smaller one is left to look in.
    fn bisect(
        &mut self,
        equation: Equation<'_>,
        lower: f64,
        upper: f64,
        at_lower: f64,
        values: &HashMap<String, f64>,
    ) -> Evaluated {
        let mut low = lower;
        let mut high = upper;
        let mut at_low = at_lower;

        for _ in 0..MATH_SOLVE_BISECTIONS {
            let middle = (low + high) / 2.0;
            if middle == low || middle == high {
                break;
            }
            let at_middle = self.residual_at(equation, middle, values)?;
            if at_middle == 0.0 {
                return Ok(middle);
            }
            if (at_middle > 0.0) == (at_low > 0.0) {
                low = middle;
                at_low = at_middle;
            } else {
                high = middle;
            }
        }
        Ok((low + high) / 2.0)
    }

    /// The value of the unknown that satisfies one implicit line, looked for
    /// outward from the seed.
    ///
    /// The search walks rings of doubling radius around the seed and watches
    /// both ends of each. A ring whose ends carry differences of opposite sign
    /// holds a root between them, and both sides are checked before either
    /// answer is taken, so the nearer of two roots at a similar distance is the
    /// one that comes back.
    ///
    /// Two roots inside one ring on the same side hide each other, because the
    /// two ends then carry the same sign. A smaller first radius narrows that
    /// window without closing it, and a seed near the root an operator wants is
    /// what closes it.
    fn solve(
        &mut self,
        equation: Equation<'_>,
        seed: f64,
        values: &HashMap<String, f64>,
    ) -> Evaluated {
        let at_seed = self.residual_at(equation, seed, values)?;
        if at_seed == 0.0 {
            return Ok(seed);
        }

        // The radius grows with the size of the seed, so a search around a
        // million takes its steps in units of a million rather than crawling
        // out in fractions.
        let scale = seed.abs().max(1.0);
        let mut inside_radius = 0.0;
        let mut at_inside_above = Some(at_seed);
        let mut at_inside_below = Some(at_seed);

        for ring in 0..MATH_SOLVE_RINGS {
            let radius = MATH_SOLVE_FIRST_RADIUS * scale * 2f64.powi(ring as i32);
            if !radius.is_finite() {
                break;
            }
            let above = seed + radius;
            let below = seed - radius;
            let at_above = self.residual_or_nothing(equation, above, values)?;
            let at_below = self.residual_or_nothing(equation, below, values)?;

            let mut found: Option<f64> = None;
            if let (Some(at_above), Some(inside)) = (at_above, at_inside_above)
                && (at_above == 0.0 || (at_above > 0.0) != (inside > 0.0))
            {
                found = Some(if at_above == 0.0 {
                    above
                } else {
                    self.bisect(equation, seed + inside_radius, above, inside, values)?
                });
            }
            if let (Some(at_below), Some(inside)) = (at_below, at_inside_below)
                && (at_below == 0.0 || (at_below > 0.0) != (inside > 0.0))
            {
                let root = if at_below == 0.0 {
                    below
                } else {
                    self.bisect(equation, below, seed - inside_radius, at_below, values)?
                };
                if found.is_none_or(|held| (root - seed).abs() < (held - seed).abs()) {
                    found = Some(root);
                }
            }
            if let Some(found) = found {
                return Ok(found);
            }

            inside_radius = radius;
            at_inside_above = at_above;
            at_inside_below = at_below;
        }

        Err(math_error(format!(
            "the equation for \"{}\" has no place within {MATH_SOLVE_RINGS} doublings of the seed where its two sides cross, so this line has no root the search can reach. A seed nearer the answer finds a root the search stepped over",
            equation.unknown
        )))
    }
}

/// Runs a program over its inputs and returns the value of every name it
/// defines. A line that fails puts an error value on the name it defines and
/// leaves the lines around it alone, because an error on one export is ordinary
/// state rather than a reason to refuse the rest.
///
/// The inputs, the references and the seeds are read into maps before the first
/// line runs, so every line and every step of a solve reads the same numbers. A
/// seed a source names and the caller leaves out is read as zero, which is
/// where a search starts before an operator has moved it.
///
/// This is the one function between the math language and the graph. Nothing
/// above it reads a node type of the language, and nothing below it reads a
/// slot.
pub fn evaluate_math_object(
    program: &MathProgram,
    inputs: &HashMap<String, f64>,
    references: &HashMap<String, f64>,
    seeds: &HashMap<String, f64>,
) -> MathEvaluation {
    let mut values = inputs.clone();
    let mut functions: HashMap<String, (Vec<String>, MathAst)> = HashMap::new();
    let mut exports: Vec<(String, Value)> = Vec::new();

    for line in &program.lines {
        match line {
            MathLine::FunctionDefinition {
                name,
                parameters,
                body,
            } => {
                functions.insert(name.clone(), (parameters.clone(), body.clone()));
            }
            MathLine::Expression { .. } => {}
            MathLine::Definition { name, value, .. } => {
                let mut evaluator = Evaluator {
                    budget: MATH_MAX_EVALUATION_STEPS,
                    references,
                    functions: functions.clone(),
                };
                match evaluator.eval(value, &values, 0) {
                    Ok(number) => {
                        values.insert(name.clone(), number);
                        exports.push((name.clone(), Value::Number(number)));
                    }
                    Err(failure) => exports.push((name.clone(), Value::Error(failure.value()))),
                }
            }
            MathLine::Solve {
                unknown,
                left,
                right,
                ..
            } => {
                let mut evaluator = Evaluator {
                    budget: MATH_MAX_EVALUATION_STEPS,
                    references,
                    functions: functions.clone(),
                };
                let seed = seeds.get(unknown).copied().unwrap_or(0.0);
                let equation = Equation {
                    unknown,
                    left,
                    right,
                };
                match evaluator.solve(equation, seed, &values) {
                    Ok(number) => {
                        values.insert(unknown.clone(), number);
                        exports.push((unknown.clone(), Value::Number(number)));
                    }
                    Err(failure) => exports.push((unknown.clone(), Value::Error(failure.value()))),
                }
            }
        }
    }

    MathEvaluation { exports }
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use super::{MATH_SOLVE_RINGS, evaluate_math_object, math_address_key};
    use crate::address::Address;
    use crate::math::parser::parse_math;
    use crate::model::{ErrorCode, Value};

    fn run(source: &str) -> Vec<(String, Value)> {
        run_with(source, &[], &[], &[])
    }

    fn run_with(
        source: &str,
        inputs: &[(&str, f64)],
        references: &[(&str, f64)],
        seeds: &[(&str, f64)],
    ) -> Vec<(String, Value)> {
        let map = |pairs: &[(&str, f64)]| -> HashMap<String, f64> {
            pairs
                .iter()
                .map(|(name, value)| ((*name).to_string(), *value))
                .collect()
        };
        let program = parse_math(source).expect("the source parses");
        evaluate_math_object(&program, &map(inputs), &map(references), &map(seeds)).exports
    }

    fn number(source: &str) -> f64 {
        match run(source).first().expect("there is an export").1.clone() {
            Value::Number(number) => number,
            other => panic!("{source} answers a number, not {other:?}"),
        }
    }

    fn refusal(source: &str) -> ErrorCode {
        match run(source).first().expect("there is an export").1.clone() {
            Value::Error(error) => error.error,
            other => panic!("{source} refuses, and answered {other:?}"),
        }
    }

    #[test]
    fn the_built_ins_whose_rust_answer_differs_give_the_javascript_one() {
        // A half rounds toward positive infinity, a zero keeps its sign rather
        // than becoming one, and a modulus follows the divisor.
        assert_eq!(number("y=\\round(2.5)"), 3.0);
        assert_eq!(number("y=\\round(-2.5)"), -2.0);
        assert_eq!(number("y=\\sign(0)"), 0.0);
        assert_eq!(number("y=\\sign(-3)"), -1.0);
        assert_eq!(number("y=\\mod(-7,3)"), 2.0);
        assert_eq!(number("y=\\min(3,1)"), 1.0);
        assert_eq!(number("y=\\log(100)"), 2.0);
    }

    #[test]
    fn a_result_that_is_not_finite_stops_the_line() {
        assert_eq!(refusal("y=1/0"), ErrorCode::Div0);
        assert_eq!(refusal("y=\\sqrt{-1}"), ErrorCode::Math);
        // A zero comes back positive, because a negative zero is a value no
        // operator asked for and none reads.
        assert!(number("y=0*-1").is_sign_positive());
    }

    #[test]
    fn a_line_reads_the_values_the_lines_above_it_defined() {
        let exports = run("a=2\nb=a*3");
        assert_eq!(
            exports,
            [
                ("a".to_string(), Value::Number(2.0)),
                ("b".to_string(), Value::Number(6.0))
            ]
        );
    }

    #[test]
    fn a_failing_line_leaves_the_lines_around_it_alone() {
        let exports = run("a=1/0\nb=2");
        assert!(matches!(exports[0].1, Value::Error(_)));
        assert_eq!(exports[1].1, Value::Number(2.0));
    }

    #[test]
    fn a_series_folds_its_terms_and_an_empty_one_answers_its_unit() {
        assert_eq!(number("y=\\sum_{i=1}^{5}i"), 15.0);
        assert_eq!(number("y=\\prod_{i=1}^{5}i"), 120.0);
        // An upper bound below the lower runs over nothing, which sums to zero
        // and multiplies to one.
        assert_eq!(number("y=\\sum_{i=5}^{1}i"), 0.0);
        assert_eq!(number("y=\\prod_{i=5}^{1}i"), 1.0);
    }

    #[test]
    fn a_series_needs_whole_bounds_and_stays_inside_its_width() {
        let fractional = run_with("y=\\sum_{i=1}^{n}i", &[("n", 2.5)], &[], &[]);
        assert!(matches!(fractional[0].1, Value::Error(_)));
        let wide = run_with("y=\\sum_{i=1}^{n}i", &[("n", 200_000.0)], &[], &[]);
        assert!(matches!(wide[0].1, Value::Error(_)));
    }

    #[test]
    fn an_integral_runs_a_fixed_rule_rather_than_an_adaptive_one() {
        // A fixed count answers the same number on every pass, so a value that
        // moved between two frames would be a fault in the document.
        assert_eq!(number("y=\\int_{0}^{2}1\\,dx"), 2.0);
        assert_eq!(number("y=\\int_{0}^{1}x\\,dx"), 0.5);
        assert_eq!(number("y=\\int_{2}^{2}x\\,dx"), 0.0);
        // Running the bounds the other way turns the sign.
        assert_eq!(number("y=\\int_{1}^{0}x\\,dx"), -0.5);
        // Simpson's rule over a square is exact, and over a sine it is not, so
        // the second carries the error the rule leaves at this interval count.
        assert_eq!(number("y=\\int_{0}^{1}x^2\\,dx"), 1.0 / 3.0);
        assert!((number("y=\\int_{0}^{\\pi}\\sin(x)\\,dx") - 2.0).abs() < 1e-9);
    }

    #[test]
    fn a_solve_looks_outward_from_its_seed_and_takes_the_nearer_root() {
        assert_eq!(
            run_with("\\solve{x}x^2=4", &[], &[], &[("x", 1.0)])[0].1,
            Value::Number(2.0)
        );
        assert_eq!(
            run_with("\\solve{x}x^2=4", &[], &[], &[("x", -1.0)])[0].1,
            Value::Number(-2.0)
        );
        // A seed already on the root is the answer without a search.
        assert_eq!(
            run_with("\\solve{x}x=3", &[], &[], &[("x", 3.0)])[0].1,
            Value::Number(3.0)
        );
        // With no seed the search starts at zero.
        assert_eq!(run("\\solve{x}x+2=5")[0].1, Value::Number(3.0));
    }

    #[test]
    fn an_equation_with_no_crossing_answers_an_error() {
        let refused = run("\\solve{x}x^2+1=0");
        match &refused[0].1 {
            Value::Error(error) => {
                assert_eq!(error.error, ErrorCode::Math);
                assert!(
                    error.message.contains(&MATH_SOLVE_RINGS.to_string()),
                    "{}",
                    error.message
                );
            }
            other => panic!("the line refuses, and answered {other:?}"),
        }
    }

    #[test]
    fn a_later_line_reads_the_value_a_solve_found() {
        let exports = run("\\solve{x}x+2=5\nz=x*10");
        assert_eq!(exports[0].1, Value::Number(3.0));
        assert_eq!(exports[1].1, Value::Number(30.0));
    }

    #[test]
    fn a_function_binds_its_parameters_over_its_body() {
        assert_eq!(number("f(t)=t*2\ny=f(3)"), 6.0);
        assert_eq!(number("f(a,b)=a+b\ny=f(2,3)"), 5.0);
        assert_eq!(number("f(t)=t*2\ng(t)=f(t)+1\ny=g(3)"), 7.0);
        assert_eq!(
            run_with("f(t)=t*k\ny=f(3)", &[("k", 5.0)], &[], &[])[0].1,
            Value::Number(15.0)
        );
    }

    #[test]
    fn an_address_is_read_by_the_key_this_language_holds_one_by() {
        let address = Address {
            object_id: "o".to_string(),
            path: vec!["v".to_string()],
        };
        assert_eq!(math_address_key(&address), "o.v");
        assert_eq!(
            run_with("y=\\gpref{o.v}+1", &[], &[("o.v", 41.0)], &[])[0].1,
            Value::Number(42.0)
        );
        // An address the caller left out has no number here.
        assert!(matches!(run("y=\\gpref{o.v}+1")[0].1, Value::Error(_)));
    }

    #[test]
    fn an_expression_line_and_a_function_line_export_nothing() {
        assert!(run("1+1").is_empty());
        assert!(run("f(t)=t").is_empty());
        assert!(run("").is_empty());
    }
}
