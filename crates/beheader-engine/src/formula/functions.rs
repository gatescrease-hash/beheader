//! The name, the argument count and the two habits of every built-in function.
//!
//! This is the signature half of `src/engine/formula/functions.ts`. What a
//! function computes arrives with the package that ports evaluation, because
//! the parser needs only what it checks at parse time: that the name exists,
//! that the argument count suits it, and whether a range may be handed to it.
//!
//! The table is written out rather than generated, so a reader sees the whole
//! surface of the language in one place. The shared fixtures ask both engines
//! about every name in it, which is what catches the table drifting from the
//! TypeScript one.

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
    Strict,
    Lazy,
}

/// What the parser knows about one function.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct FunctionSignature {
    pub name: &'static str,
    pub arity: Arity,
    /// Whether a range, such as `A1:B4`, is a legal argument. Only the four
    /// aggregates take one, and the parser refuses a range anywhere else.
    pub accepts_range_argument: bool,
    pub evaluation_mode: EvaluationMode,
}

const fn strict(name: &'static str, arity: Arity) -> FunctionSignature {
    FunctionSignature {
        name,
        arity,
        accepts_range_argument: false,
        evaluation_mode: EvaluationMode::Strict,
    }
}

const fn lazy(name: &'static str, arity: Arity) -> FunctionSignature {
    FunctionSignature {
        name,
        arity,
        accepts_range_argument: false,
        evaluation_mode: EvaluationMode::Lazy,
    }
}

const fn aggregate(name: &'static str) -> FunctionSignature {
    FunctionSignature {
        name,
        arity: Arity::AtLeast(1),
        accepts_range_argument: true,
        evaluation_mode: EvaluationMode::Strict,
    }
}

/// Every function the language has, in the order the TypeScript registry
/// declares them.
pub const FUNCTION_REGISTRY: [FunctionSignature; 23] = [
    lazy("IF", Arity::Exact(3)),
    lazy("AND", Arity::AtLeast(1)),
    lazy("OR", Arity::AtLeast(1)),
    strict("NOT", Arity::Exact(1)),
    aggregate("SUM"),
    aggregate("MIN"),
    aggregate("MAX"),
    aggregate("AVG"),
    strict("ABS", Arity::Exact(1)),
    strict("ROUND", Arity::Exact(2)),
    strict("FLOOR", Arity::Exact(1)),
    strict("CEIL", Arity::Exact(1)),
    strict("SQRT", Arity::Exact(1)),
    strict("POW", Arity::Exact(2)),
    strict("CONCAT", Arity::AtLeast(1)),
    strict("LEN", Arity::Exact(1)),
    strict("PI", Arity::Exact(0)),
    strict("SIN", Arity::Exact(1)),
    strict("COS", Arity::Exact(1)),
    strict("TAN", Arity::Exact(1)),
    strict("ATAN2", Arity::Exact(2)),
    strict("DEG", Arity::Exact(1)),
    strict("RAD", Arity::Exact(1)),
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
