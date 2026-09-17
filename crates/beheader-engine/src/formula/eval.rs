//! Evaluates a tree down to one value, which is the last of the four stages a
//! formula passes through.
//!
//! This is the Rust side of `src/engine/formula/eval.ts`. Evaluation is lazy
//! where dependency extraction is eager. `IF` reads only the branch it takes,
//! and `AND` and `OR` stop as soon as the answer is settled, so a division by
//! zero in a branch nothing reaches never happens. `formula/deps.rs` walks both
//! branches instead, for the reason its own header gives.
//!
//! An error travels out of the first place it appears, so the value a formula
//! answers names the first fault rather than the last. Which operand is read
//! first therefore decides which refusal an operator reads, and the order here
//! is the order the TypeScript uses: a comparison reads both sides before it
//! judges either, while an arithmetic operator judges the left side before it
//! reads the right.

use crate::address::Address;
use crate::formula::ast::{BinaryOperator, FormulaAst, LiteralValue, UnaryOperator};
use crate::formula::functions::{
    EvaluationMode, as_boolean, check_arity, describe_value_type, finite_result, get_function_entry,
};
use crate::model::{ErrorCode, ErrorValue, Value, is_error_value};

/// Reads the value of one slot. An address that names no slot answers `None`,
/// which becomes a `#REF`.
pub type ReadSlot<'a> = &'a dyn Fn(&Address) -> Option<Value>;

/// Reads every value a range covers, or the reason the range cannot be read.
pub type ReadRange<'a> = &'a dyn Fn(&Address, &Address) -> Result<Vec<Value>, ErrorValue>;

fn error(code: ErrorCode, message: &str) -> Value {
    Value::Error(ErrorValue {
        error: code,
        message: message.to_string(),
    })
}

fn type_error(message: String) -> Value {
    Value::Error(ErrorValue {
        error: ErrorCode::Type,
        message,
    })
}

/// The refusal a range gets where the caller supplied no way to read one. The
/// panel that evaluates a lone formula has no table behind it, so it reaches
/// this rather than carrying a reader it cannot build.
fn range_unwired() -> Value {
    error(
        ErrorCode::Parse,
        "range evaluation is not wired in for this caller — no readRange callback was supplied",
    )
}

pub fn evaluate(ast: &FormulaAst, read: ReadSlot, read_range: Option<ReadRange>) -> Value {
    evaluate_node(ast, read, read_range)
}

fn evaluate_node(ast: &FormulaAst, read: ReadSlot, read_range: Option<ReadRange>) -> Value {
    match ast {
        FormulaAst::Literal(LiteralValue::Number(number)) => Value::Number(*number),
        FormulaAst::Literal(LiteralValue::Text(text)) => Value::Text(text.clone()),
        FormulaAst::Literal(LiteralValue::Boolean(boolean)) => Value::Boolean(*boolean),
        FormulaAst::Reference(address) => match read(address) {
            None => error(
                ErrorCode::Ref,
                "formula reference did not resolve to a value",
            ),
            Some(value) => value,
        },
        FormulaAst::Range { .. } => range_unwired(),
        FormulaAst::Error => error(
            ErrorCode::Ref,
            "this reference was invalidated by a repair pass (#REF)",
        ),
        FormulaAst::BinaryOp {
            operator,
            left,
            right,
        } => evaluate_binary(*operator, left, right, read, read_range),
        FormulaAst::UnaryOp { operator, operand } => match operator {
            UnaryOperator::Not => evaluate_not(std::slice::from_ref(operand), read, read_range),
            UnaryOperator::Negate => {
                let value = evaluate_node(operand, read, read_range);
                if is_error_value(&value) {
                    return value;
                }
                match value {
                    Value::Number(number) => finite_result("-", -number),
                    other => type_error(format!(
                        "unary \"-\": operand must be a number, got {}",
                        describe_value_type(&other)
                    )),
                }
            }
        },
        FormulaAst::FunctionCall { name, args } => evaluate_call(name, args, read, read_range),
    }
}

fn evaluate_binary(
    operator: BinaryOperator,
    left: &FormulaAst,
    right: &FormulaAst,
    read: ReadSlot,
    read_range: Option<ReadRange>,
) -> Value {
    match operator {
        BinaryOperator::And => evaluate_all(&[left, right], read, read_range),
        BinaryOperator::Or => evaluate_any(&[left, right], read, read_range),
        BinaryOperator::Equal
        | BinaryOperator::NotEqual
        | BinaryOperator::Less
        | BinaryOperator::Greater
        | BinaryOperator::LessOrEqual
        | BinaryOperator::GreaterOrEqual => {
            evaluate_comparison(operator, left, right, read, read_range)
        }
        _ => evaluate_arithmetic(operator, left, right, read, read_range),
    }
}

/// Compares two values of the same kind. Two values of different kinds are a
/// refusal rather than an answer, so a number never sorts against a word.
fn evaluate_comparison(
    operator: BinaryOperator,
    left: &FormulaAst,
    right: &FormulaAst,
    read: ReadSlot,
    read_range: Option<ReadRange>,
) -> Value {
    let left_value = evaluate_node(left, read, read_range);
    if is_error_value(&left_value) {
        return left_value;
    }
    let right_value = evaluate_node(right, read, read_range);
    if is_error_value(&right_value) {
        return right_value;
    }
    let ordering = match (&left_value, &right_value) {
        (Value::Number(a), Value::Number(b)) => compare(operator, a, b),
        (Value::Text(a), Value::Text(b)) => compare(operator, a, b),
        (Value::Boolean(a), Value::Boolean(b)) => compare(operator, a, b),
        _ => {
            return type_error(format!(
                "cannot compare {} to {}",
                describe_value_type(&left_value),
                describe_value_type(&right_value)
            ));
        }
    };
    Value::Boolean(ordering)
}

/// The answer for one operator over two values that can be ordered. Equality
/// is `==` rather than a total order, so a NaN is unequal to itself the way a
/// JavaScript comparison leaves it.
fn compare<T: PartialOrd + PartialEq>(operator: BinaryOperator, a: &T, b: &T) -> bool {
    match operator {
        BinaryOperator::Equal => a == b,
        BinaryOperator::NotEqual => a != b,
        BinaryOperator::Less => a < b,
        BinaryOperator::Greater => a > b,
        BinaryOperator::LessOrEqual => a <= b,
        BinaryOperator::GreaterOrEqual => a >= b,
        _ => false,
    }
}

fn evaluate_arithmetic(
    operator: BinaryOperator,
    left: &FormulaAst,
    right: &FormulaAst,
    read: ReadSlot,
    read_range: Option<ReadRange>,
) -> Value {
    let name = operator.as_str();
    // The left side is judged before the right is read, so a word on the left
    // is reported even where the right side would also refuse.
    let left_value = evaluate_node(left, read, read_range);
    if is_error_value(&left_value) {
        return left_value;
    }
    let Value::Number(a) = left_value else {
        return type_error(format!(
            "\"{name}\": left operand must be a number, got {}",
            describe_value_type(&left_value)
        ));
    };
    let right_value = evaluate_node(right, read, read_range);
    if is_error_value(&right_value) {
        return right_value;
    }
    let Value::Number(b) = right_value else {
        return type_error(format!(
            "\"{name}\": right operand must be a number, got {}",
            describe_value_type(&right_value)
        ));
    };
    match operator {
        BinaryOperator::Add => finite_result(name, a + b),
        BinaryOperator::Subtract => finite_result(name, a - b),
        BinaryOperator::Multiply => finite_result(name, a * b),
        BinaryOperator::Divide => {
            if b == 0.0 {
                return error(ErrorCode::Div0, "division by zero");
            }
            finite_result(name, a / b)
        }
        BinaryOperator::Remainder => {
            if b == 0.0 {
                return error(ErrorCode::Div0, "modulo by zero");
            }
            // Adding the divisor and taking the remainder again turns the
            // truncated remainder both languages give into one that carries
            // the sign of the divisor.
            finite_result(name, ((a % b) + b) % b)
        }
        BinaryOperator::Power => finite_result(name, a.powf(b)),
        _ => error(
            ErrorCode::Parse,
            &format!("unrecognised binary operator: \"{name}\""),
        ),
    }
}

/// `AND` over its operands, stopping at the first false. A later operand that
/// would refuse is never read once the answer is settled.
fn evaluate_all(operands: &[&FormulaAst], read: ReadSlot, read_range: Option<ReadRange>) -> Value {
    for operand in operands {
        let value = evaluate_node(operand, read, read_range);
        if is_error_value(&value) {
            return value;
        }
        match value {
            Value::Boolean(false) => return Value::Boolean(false),
            Value::Boolean(true) => {}
            other => {
                return type_error(format!(
                    "AND: operand must be a boolean, got {}",
                    describe_value_type(&other)
                ));
            }
        }
    }
    Value::Boolean(true)
}

fn evaluate_any(operands: &[&FormulaAst], read: ReadSlot, read_range: Option<ReadRange>) -> Value {
    for operand in operands {
        let value = evaluate_node(operand, read, read_range);
        if is_error_value(&value) {
            return value;
        }
        match value {
            Value::Boolean(true) => return Value::Boolean(true),
            Value::Boolean(false) => {}
            other => {
                return type_error(format!(
                    "OR: operand must be a boolean, got {}",
                    describe_value_type(&other)
                ));
            }
        }
    }
    Value::Boolean(false)
}

fn evaluate_if(args: &[FormulaAst], read: ReadSlot, read_range: Option<ReadRange>) -> Value {
    let Some(condition) = args.first() else {
        return type_error("IF: missing condition".to_string());
    };
    let condition_value = evaluate_node(condition, read, read_range);
    if is_error_value(&condition_value) {
        return condition_value;
    }
    let Value::Boolean(taken) = condition_value else {
        return type_error(format!(
            "IF: condition must be a boolean, got {}",
            describe_value_type(&condition_value)
        ));
    };
    match args.get(if taken { 1 } else { 2 }) {
        None => type_error(format!(
            "IF: missing {} branch",
            if taken { "true" } else { "false" }
        )),
        Some(branch) => evaluate_node(branch, read, read_range),
    }
}

/// `NOT` as the prefix operator, which reads its operand and then hands the
/// value to the same body the function of that name uses.
fn evaluate_not(args: &[FormulaAst], read: ReadSlot, read_range: Option<ReadRange>) -> Value {
    let Some(operand) = args.first() else {
        return type_error("NOT: missing argument 1".to_string());
    };
    let value = evaluate_node(operand, read, read_range);
    match as_boolean("NOT", 0, Some(&value)) {
        Err(refusal) => refusal,
        Ok(boolean) => Value::Boolean(!boolean),
    }
}

fn evaluate_call(
    name: &str,
    args: &[FormulaAst],
    read: ReadSlot,
    read_range: Option<ReadRange>,
) -> Value {
    let Some(entry) = get_function_entry(name) else {
        return type_error(format!("unknown function \"{name}\""));
    };
    if let Err(message) = check_arity(entry.name, entry.arity, args.len()) {
        return type_error(message);
    }

    if entry.evaluation_mode == EvaluationMode::Lazy {
        return match name {
            "IF" => evaluate_if(args, read, read_range),
            "AND" => evaluate_all(&args.iter().collect::<Vec<_>>(), read, read_range),
            "OR" => evaluate_any(&args.iter().collect::<Vec<_>>(), read, read_range),
            _ => type_error(format!(
                "\"{name}\" is registered lazy but has no evaluator wired in formula/eval.rs (internal error)"
            )),
        };
    }

    let mut values = Vec::new();
    for arg in args {
        if let FormulaAst::Range { start, end } = arg {
            let Some(read_range) = read_range else {
                return range_unwired();
            };
            let cells = match read_range(start, end) {
                Err(refusal) => return Value::Error(refusal),
                Ok(cells) => cells,
            };
            // A range carrying an error answers with that error rather than
            // with the cells around it, so an aggregate never sums past one.
            for cell in cells {
                if is_error_value(&cell) {
                    return cell;
                }
                values.push(cell);
            }
            continue;
        }
        let value = evaluate_node(arg, read, read_range);
        if is_error_value(&value) {
            return value;
        }
        values.push(value);
    }

    match entry.implementation {
        Some(implementation) => implementation(&values),
        None => type_error(format!(
            "\"{name}\" is registered eager but carries no body (internal error)"
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::{ReadSlot, evaluate};
    use crate::address::{Address, AddressableObject};
    use crate::formula::parser::parse_formula;
    use crate::model::{ErrorCode, ErrorValue, ObjectType, Value};

    struct Object;
    impl AddressableObject for Object {
        fn id(&self) -> &str {
            "p1"
        }
        fn name(&self) -> &str {
            "poly"
        }
        fn object_type(&self) -> ObjectType {
            ObjectType::Polygon
        }
        fn slot_keys(&self) -> Vec<&str> {
            vec!["vertices"]
        }
    }

    fn run(source: &str) -> Value {
        run_reading(source, &|_: &Address| None)
    }

    fn run_reading(source: &str, read: ReadSlot) -> Value {
        let objects = [Object];
        let ast = parse_formula(source, &objects, None).expect("the formula parses");
        evaluate(&ast, read, None)
    }

    fn number(source: &str) -> f64 {
        match run(source) {
            Value::Number(number) => number,
            other => panic!("{source} answers a number, not {other:?}"),
        }
    }

    fn refusal(source: &str) -> ErrorValue {
        match run(source) {
            Value::Error(error) => error,
            other => panic!("{source} refuses, and answered {other:?}"),
        }
    }

    #[test]
    fn rounds_a_half_the_way_javascript_rounds_one() {
        // Toward positive infinity, not away from zero, so the negative half
        // answers -2 where the Rust method would answer -3.
        assert_eq!(number("ROUND(2.5, 0)"), 3.0);
        assert_eq!(number("ROUND(-2.5, 0)"), -2.0);
        assert_eq!(number("ROUND(-3.5, 0)"), -3.0);
        // A value that reads as a half in decimal sits below one in binary, so
        // it rounds down, and both engines agree because both hold binary64.
        assert_eq!(number("ROUND(1.005, 2)"), 1.0);
        assert_eq!(number("ROUND(1.23456, 2)"), 1.23);
        assert_eq!(number("ROUND(1234.5678, -2)"), 1200.0);
        // Minus a half rounds to a negative zero, which a result turns plain.
        assert_eq!(number("ROUND(-0.5, 0)"), 0.0);
        assert!(number("ROUND(-0.5, 0)").is_sign_positive());
    }

    #[test]
    fn counts_the_length_of_text_in_the_units_a_javascript_string_counts() {
        assert_eq!(number("LEN(\"abc\")"), 3.0);
        assert_eq!(number("LEN(\"\u{1D518}\")"), 2.0);
        assert_eq!(number("LEN(\"cafe\u{301}\")"), 5.0);
    }

    #[test]
    fn a_remainder_carries_the_sign_of_the_divisor() {
        assert_eq!(number("7 % 3"), 1.0);
        assert_eq!(number("-7 % 3"), 2.0);
        assert_eq!(number("7 % -3"), -2.0);
        assert_eq!(refusal("1 % 0").error, ErrorCode::Div0);
        assert_eq!(refusal("1 / 0").error, ErrorCode::Div0);
    }

    #[test]
    fn a_branch_nothing_takes_is_never_read() {
        // The untaken branch divides by zero, and the answer is the branch
        // that was taken rather than that refusal.
        assert_eq!(run("IF(TRUE, 1, 1 / 0)"), Value::Number(1.0));
        assert_eq!(run("IF(FALSE, 1 / 0, 2)"), Value::Number(2.0));
        assert_eq!(run("AND(FALSE, 1 / 0 = 1)"), Value::Boolean(false));
        assert_eq!(run("OR(TRUE, 1 / 0 = 1)"), Value::Boolean(true));
        assert_eq!(run("FALSE AND 1 / 0 = 1"), Value::Boolean(false));
    }

    #[test]
    fn an_arithmetic_operator_judges_its_left_side_before_reading_its_right() {
        // Both sides are words, and the left is the one the refusal names.
        assert_eq!(
            refusal("\"a\" + \"b\"").message,
            "\"+\": left operand must be a number, got string"
        );
        assert_eq!(
            refusal("1 + \"b\"").message,
            "\"+\": right operand must be a number, got string"
        );
    }

    #[test]
    fn two_values_of_different_kinds_do_not_compare() {
        assert_eq!(run("1 < 2"), Value::Boolean(true));
        assert_eq!(run("\"a\" < \"b\""), Value::Boolean(true));
        assert_eq!(run("TRUE > FALSE"), Value::Boolean(true));
        assert_eq!(
            refusal("1 = \"1\"").message,
            "cannot compare number to string"
        );
    }

    #[test]
    fn a_reference_that_names_no_slot_is_a_reference_error() {
        assert_eq!(refusal("poly.vertices + 1").error, ErrorCode::Ref);

        let held = |_: &Address| Some(Value::Number(2.0));
        assert_eq!(run_reading("poly.vertices + 1", &held), Value::Number(3.0));

        // An error already in a slot travels out rather than being reported
        // again, so the first fault keeps its own wording.
        let broken = |_: &Address| {
            Some(Value::Error(ErrorValue {
                error: ErrorCode::Script,
                message: "held".to_string(),
            }))
        };
        match run_reading("poly.vertices + 1", &broken) {
            Value::Error(error) => {
                assert_eq!(error.error, ErrorCode::Script);
                assert_eq!(error.message, "held");
            }
            other => panic!("the error travels out, and answered {other:?}"),
        }
    }

    #[test]
    fn a_result_the_graph_cannot_store_is_refused() {
        assert_eq!(refusal("SQRT(-1)").error, ErrorCode::Type);
        assert_eq!(
            refusal("SQRT(-1)").message,
            "SQRT: result is not a legal number (NaN)"
        );
    }

    #[test]
    fn a_range_with_no_reader_says_so_rather_than_answering() {
        let error = refusal("SUM(poly.vertices:poly.vertices)");
        assert_eq!(error.error, ErrorCode::Parse);
    }

    #[test]
    fn the_aggregates_fold_the_way_the_registry_declares() {
        assert_eq!(number("SUM(1, 2, 3)"), 6.0);
        assert_eq!(number("MIN(3, 1, 2)"), 1.0);
        assert_eq!(number("MAX(3, 1, 2)"), 3.0);
        assert_eq!(number("AVG(1, 2, 3, 4)"), 2.5);
        assert_eq!(number("PI()"), std::f64::consts::PI);
        assert_eq!(run("CONCAT(\"a\", \"b\")"), Value::Text("ab".to_string()));
    }
}
