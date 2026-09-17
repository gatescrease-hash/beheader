//! The registry of built-in functions: the name, the argument count, the two
//! habits, and what each one computes.
//!
//! This is the Rust side of `src/engine/formula/functions.ts`. Two entries are
//! lazy rather than eager. `IF` and the two short-circuiting operators take
//! their arguments unevaluated, because `IF` leaves the branch it does not take
//! alone, so `formula/eval.rs` holds their bodies and the table holds none.
//!
//! The table is written out rather than generated, so a reader sees the whole
//! surface of the language in one place. The shared fixtures ask both engines
//! about every name in it, which is what catches the table drifting from the
//! TypeScript one.
//!
//! Three habits of JavaScript are reproduced here on purpose, because a
//! document carries the answers they gave. `js_round` rounds a half toward
//! positive infinity where Rust rounds it away from zero, so `ROUND(-2.5, 0)`
//! is -2 rather than -3. `LEN` counts UTF-16 code units, so a character
//! outside the basic plane counts as two. `js_min` and `js_max` answer NaN
//! where either side is NaN, where the Rust methods answer the other side.

use crate::model::{ErrorCode, ErrorValue, Value, is_illegal_number};
use crate::number::{js_atan2, js_cos, js_max, js_min, js_pow, js_round, js_sin, js_tan};

/// The word a refusal uses for the kind of value it was handed.
pub fn describe_value_type(value: &Value) -> &'static str {
    match value {
        Value::Null => "null",
        Value::Points(_) => "a point array",
        Value::Point(_) => "a point",
        Value::Number(_) => "number",
        Value::Text(_) => "string",
        Value::Boolean(_) => "boolean",
        Value::Error(_) => "object",
    }
}

fn type_error(message: String) -> Value {
    Value::Error(ErrorValue {
        error: ErrorCode::Type,
        message,
    })
}

/// The argument as a number, or the refusal that names why it is not one. An
/// argument that is already an error travels out unchanged, so the first fault
/// in a formula is the one an operator reads.
fn as_number(name: &str, index: usize, value: Option<&Value>) -> Result<f64, Value> {
    match value {
        None => Err(type_error(format!(
            "{name}: missing argument {}",
            index + 1
        ))),
        Some(Value::Error(_)) => Err(value.expect("the value is an error").clone()),
        Some(Value::Number(number)) => Ok(*number),
        Some(other) => Err(type_error(format!(
            "{name}: argument {} must be a number, got {}",
            index + 1,
            describe_value_type(other)
        ))),
    }
}

fn as_text(name: &str, index: usize, value: Option<&Value>) -> Result<String, Value> {
    match value {
        None => Err(type_error(format!(
            "{name}: missing argument {}",
            index + 1
        ))),
        Some(Value::Error(_)) => Err(value.expect("the value is an error").clone()),
        Some(Value::Text(text)) => Ok(text.clone()),
        Some(other) => Err(type_error(format!(
            "{name}: argument {} must be a string, got {}",
            index + 1,
            describe_value_type(other)
        ))),
    }
}

pub fn as_boolean(name: &str, index: usize, value: Option<&Value>) -> Result<bool, Value> {
    match value {
        None => Err(type_error(format!(
            "{name}: missing argument {}",
            index + 1
        ))),
        Some(Value::Error(_)) => Err(value.expect("the value is an error").clone()),
        Some(Value::Boolean(boolean)) => Ok(*boolean),
        Some(other) => Err(type_error(format!(
            "{name}: argument {} must be a boolean, got {}",
            index + 1,
            describe_value_type(other)
        ))),
    }
}

fn as_number_list(name: &str, args: &[Value]) -> Result<Vec<f64>, Value> {
    args.iter()
        .enumerate()
        .map(|(index, value)| as_number(name, index, Some(value)))
        .collect()
}

/// The value a result takes, where a number the graph cannot store becomes a
/// refusal. A negative zero is the one such number that becomes a plain zero
/// instead, because it is a value an operator never asked for and never reads.
pub fn finite_result(name: &str, value: f64) -> Value {
    if is_illegal_number(value) {
        if value == 0.0 {
            return Value::Number(0.0);
        }
        return type_error(format!(
            "{name}: result is not a legal number ({})",
            crate::number::to_javascript_text(value)
        ));
    }
    Value::Number(value)
}

/// How many arguments a function takes.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Arity {
    Exact(usize),
    AtLeast(usize),
}

/// Whether the evaluator reads every argument before the call, or leaves that
/// to the function. `IF` takes the branch it needs and leaves the other, so an
/// error in an untaken branch never reaches a value.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum EvaluationMode {
    Eager,
    Lazy,
}

/// One function: what the parser checks about it, and what it computes. A lazy
/// entry carries no body, because the evaluator holds the three that exist.
#[derive(Clone, Copy, Debug)]
pub struct FunctionSignature {
    pub name: &'static str,
    pub arity: Arity,
    /// Whether a range, such as `A1:B4`, is a legal argument. Only the four
    /// aggregates take one, and the parser refuses a range anywhere else.
    pub accepts_range_argument: bool,
    pub evaluation_mode: EvaluationMode,
    pub implementation: Option<fn(&[Value]) -> Value>,
}

impl PartialEq for FunctionSignature {
    /// Two entries are the same where the parser cannot tell them apart. A
    /// function pointer has no equality worth comparing.
    fn eq(&self, other: &Self) -> bool {
        self.name == other.name
            && self.arity == other.arity
            && self.accepts_range_argument == other.accepts_range_argument
            && self.evaluation_mode == other.evaluation_mode
    }
}

const fn eager(
    name: &'static str,
    arity: Arity,
    implementation: fn(&[Value]) -> Value,
) -> FunctionSignature {
    FunctionSignature {
        name,
        arity,
        accepts_range_argument: false,
        evaluation_mode: EvaluationMode::Eager,
        implementation: Some(implementation),
    }
}

const fn lazy(name: &'static str, arity: Arity) -> FunctionSignature {
    FunctionSignature {
        name,
        arity,
        accepts_range_argument: false,
        evaluation_mode: EvaluationMode::Lazy,
        implementation: None,
    }
}

const fn aggregate(name: &'static str, implementation: fn(&[Value]) -> Value) -> FunctionSignature {
    FunctionSignature {
        name,
        arity: Arity::AtLeast(1),
        accepts_range_argument: true,
        evaluation_mode: EvaluationMode::Eager,
        implementation: Some(implementation),
    }
}

/// One argument, coerced and handed to a body that takes a single number.
fn one_number(name: &'static str, args: &[Value], compute: fn(f64) -> f64) -> Value {
    match as_number(name, 0, args.first()) {
        Err(error) => error,
        Ok(x) => finite_result(name, compute(x)),
    }
}

/// Two arguments, coerced in order so the first fault is the one reported.
fn two_numbers(name: &'static str, args: &[Value], compute: fn(f64, f64) -> f64) -> Value {
    let first = match as_number(name, 0, args.first()) {
        Err(error) => return error,
        Ok(x) => x,
    };
    match as_number(name, 1, args.get(1)) {
        Err(error) => error,
        Ok(second) => finite_result(name, compute(first, second)),
    }
}

fn fold_numbers(name: &'static str, args: &[Value], fold: fn(&[f64]) -> f64) -> Value {
    match as_number_list(name, args) {
        Err(error) => error,
        Ok(numbers) => finite_result(name, fold(&numbers)),
    }
}

/// Every function the language has, in the order the TypeScript registry
/// declares them.
pub const FUNCTION_REGISTRY: [FunctionSignature; 23] = [
    lazy("IF", Arity::Exact(3)),
    lazy("AND", Arity::AtLeast(1)),
    lazy("OR", Arity::AtLeast(1)),
    eager("NOT", Arity::Exact(1), |args| {
        match as_boolean("NOT", 0, args.first()) {
            Err(error) => error,
            Ok(boolean) => Value::Boolean(!boolean),
        }
    }),
    aggregate("SUM", |args| {
        fold_numbers("SUM", args, |numbers| numbers.iter().sum())
    }),
    aggregate("MIN", |args| {
        fold_numbers("MIN", args, |numbers| {
            numbers.iter().fold(f64::INFINITY, |min, n| js_min(min, *n))
        })
    }),
    aggregate("MAX", |args| {
        fold_numbers("MAX", args, |numbers| {
            numbers
                .iter()
                .fold(f64::NEG_INFINITY, |max, n| js_max(max, *n))
        })
    }),
    aggregate("AVG", |args| {
        fold_numbers("AVG", args, |numbers| {
            numbers.iter().sum::<f64>() / numbers.len() as f64
        })
    }),
    eager("ABS", Arity::Exact(1), |args| {
        one_number("ABS", args, f64::abs)
    }),
    eager("ROUND", Arity::Exact(2), |args| {
        two_numbers("ROUND", args, |n, digits| {
            let factor = js_pow(10.0, digits);
            js_round(n * factor) / factor
        })
    }),
    eager("FLOOR", Arity::Exact(1), |args| {
        one_number("FLOOR", args, f64::floor)
    }),
    eager("CEIL", Arity::Exact(1), |args| {
        one_number("CEIL", args, f64::ceil)
    }),
    eager("SQRT", Arity::Exact(1), |args| {
        one_number("SQRT", args, f64::sqrt)
    }),
    eager("POW", Arity::Exact(2), |args| {
        two_numbers("POW", args, js_pow)
    }),
    eager("CONCAT", Arity::AtLeast(1), |args| {
        let mut joined = String::new();
        for (index, value) in args.iter().enumerate() {
            match as_text("CONCAT", index, Some(value)) {
                Err(error) => return error,
                Ok(text) => joined.push_str(&text),
            }
        }
        Value::Text(joined)
    }),
    eager("LEN", Arity::Exact(1), |args| {
        match as_text("LEN", 0, args.first()) {
            Err(error) => error,
            // A JavaScript string counts its length in UTF-16 code units, so a
            // character outside the basic plane counts as the two it is
            // written with.
            Ok(text) => finite_result("LEN", text.encode_utf16().count() as f64),
        }
    }),
    eager("PI", Arity::Exact(0), |_| {
        Value::Number(std::f64::consts::PI)
    }),
    eager("SIN", Arity::Exact(1), |args| {
        one_number("SIN", args, js_sin)
    }),
    eager("COS", Arity::Exact(1), |args| {
        one_number("COS", args, js_cos)
    }),
    eager("TAN", Arity::Exact(1), |args| {
        one_number("TAN", args, js_tan)
    }),
    eager("ATAN2", Arity::Exact(2), |args| {
        two_numbers("ATAN2", args, js_atan2)
    }),
    eager("DEG", Arity::Exact(1), |args| {
        one_number("DEG", args, |radians| {
            radians * 180.0 / std::f64::consts::PI
        })
    }),
    eager("RAD", Arity::Exact(1), |args| {
        one_number("RAD", args, |degrees| {
            degrees * std::f64::consts::PI / 180.0
        })
    }),
];

/// The function of that name, where the spelling matches exactly. A name in
/// another case is a different name, and no function answers to one.
pub fn get_function_entry(name: &str) -> Option<&'static FunctionSignature> {
    FUNCTION_REGISTRY.iter().find(|entry| entry.name == name)
}

pub fn accepts_range_argument(name: &str) -> bool {
    get_function_entry(name).is_some_and(|entry| entry.accepts_range_argument)
}

pub fn is_lazy_function(name: &str) -> bool {
    get_function_entry(name).is_some_and(|entry| entry.evaluation_mode == EvaluationMode::Lazy)
}

/// Tests the argument count for a function against its declared arity.
pub fn check_arity(name: &str, arity: Arity, argument_count: usize) -> Result<(), String> {
    let (count, word) = match arity {
        Arity::Exact(count) => (count, "exactly"),
        Arity::AtLeast(count) => (count, "at least"),
    };
    let wrong = match arity {
        Arity::Exact(count) => argument_count != count,
        Arity::AtLeast(count) => argument_count < count,
    };
    if wrong {
        let plural = if count == 1 { "" } else { "s" };
        return Err(format!(
            "{name} expects {word} {count} argument{plural}, got {argument_count}"
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{Arity, FUNCTION_REGISTRY, check_arity, get_function_entry};

    #[test]
    fn every_name_in_the_table_is_found_by_its_own_spelling() {
        for entry in FUNCTION_REGISTRY {
            assert_eq!(get_function_entry(entry.name), Some(&entry));
        }
        assert_eq!(get_function_entry("sum"), None);
        assert_eq!(get_function_entry("NOPE"), None);
    }

    #[test]
    fn the_four_aggregates_are_the_ones_that_take_a_range() {
        let taking: Vec<&str> = FUNCTION_REGISTRY
            .iter()
            .filter(|entry| entry.accepts_range_argument)
            .map(|entry| entry.name)
            .collect();
        assert_eq!(taking, ["SUM", "MIN", "MAX", "AVG"]);
    }

    #[test]
    fn a_wrong_argument_count_is_worded_with_the_number_it_got() {
        assert_eq!(
            check_arity("ROUND", Arity::Exact(2), 1),
            Err("ROUND expects exactly 2 arguments, got 1".to_string())
        );
        assert_eq!(
            check_arity("NOT", Arity::Exact(1), 2),
            Err("NOT expects exactly 1 argument, got 2".to_string())
        );
        assert_eq!(
            check_arity("SUM", Arity::AtLeast(1), 0),
            Err("SUM expects at least 1 argument, got 0".to_string())
        );
        assert_eq!(check_arity("PI", Arity::Exact(0), 0), Ok(()));
        assert_eq!(check_arity("SUM", Arity::AtLeast(1), 9), Ok(()));
    }
}
