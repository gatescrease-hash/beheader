//! Works out what the names in a parsed program mean, which is the third of
//! the four stages of the math language: lexer, parser, names and eval.
//!
//! This is the Rust side of `src/engine/math/names.ts`. Every bare name falls
//! into one of four groups, and the group decides what the object does with it.
//!
//! A bound name comes from an enclosing form. An integral binds the variable of
//! its differential over its integrand, a series binds the variable of its
//! range over its body, and a function definition binds its parameters over its
//! body. A bound name never reaches the slot set, because the value belongs to
//! the form rather than to the document, so the `x` of an integral over
//! `sin(x_input)` arrives with no port while `x_input` brings one.
//!
//! The unknown of an implicit line is bound over both sides of that line and
//! defined from the line down, so it takes an export slot without taking an
//! input port, and a later line reads the value the solve found. It also takes
//! a seed slot, which is where the search for that value starts.
//!
//! A defined name comes from an earlier line of the same source and becomes an
//! export slot under `out`. Earlier is the whole rule: a line reads the names
//! above it and never the names below it, so a circle of definitions inside one
//! object cannot be written and the evaluator runs with no ordering pass.
//!
//! A free name is neither, and it becomes an input port under `in`.
//!
//! A called name resolves against the built-in table and the function
//! definitions of the same source. A call of anything else is reported here
//! rather than at evaluation time, so a source that cannot work fails the
//! mutation instead of filling every export with an error.

use std::collections::HashSet;

use crate::address::Address;
use crate::math::ast::{MathAst, MathLine, MathProgram};
use crate::math::parser::built_in_arity;
use crate::model::is_legal_port_name;

/// Why a program's names do not work, with the line it happened on.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MathNameError {
    pub message: String,
    pub line: usize,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct MathNames {
    /// The document addresses the source reads, in the order it first reads
    /// them.
    pub references: Vec<Address>,
    /// The names the source defines, under `out`, in the order the lines define
    /// them.
    pub exports: Vec<String>,
    /// The free names, under `in`, in the order the source first reads them.
    pub inputs: Vec<String>,
    /// The functions the source defines, each with no slot of its own.
    pub functions: Vec<String>,
    /// The unknowns the source solves for, under `seed`, in line order.
    pub seeds: Vec<String>,
}

/// What one line of the walk collects. The names a form binds are passed down
/// rather than held here, because a binding reaches the body of that form and
/// nothing outside it.
struct Binder {
    defined: HashSet<String>,
    exports: Vec<String>,
    /// The functions of earlier lines, with the argument count of each.
    functions: Vec<(String, usize)>,
    /// Every function the source defines, in the order it defines them, for a
    /// message about one defined below and for the answer this returns.
    all_functions: Vec<String>,
    inputs: Vec<String>,
    seen_inputs: HashSet<String>,
    references: Vec<Address>,
    seen_references: HashSet<String>,
    seeds: Vec<String>,
}

impl Binder {
    fn arity_of(&self, name: &str) -> Option<usize> {
        self.functions
            .iter()
            .find(|(held, _)| held == name)
            .map(|(_, arity)| *arity)
            .or_else(|| built_in_arity(name))
    }

    fn defines_function(&self, name: &str) -> bool {
        self.all_functions.iter().any(|held| held == name)
    }

    /// Walks one expression and records every free name it reads.
    fn walk(&mut self, ast: &MathAst, bound: &HashSet<String>) -> Result<(), String> {
        match ast {
            MathAst::Number(_) => Ok(()),
            MathAst::Reference(address) => {
                let key = format!("{}.{}", address.object_id, address.path.join("."));
                if self.seen_references.insert(key) {
                    self.references.push(address.clone());
                }
                Ok(())
            }
            MathAst::Name(name) => {
                if bound.contains(name) || self.defined.contains(name) {
                    return Ok(());
                }
                if self.defines_function(name) {
                    return Err(format!(
                        "\"{name}\" names a function of this object, and a function has no value of its own"
                    ));
                }
                if !is_legal_port_name(name) {
                    return Err(format!(
                        "\"{name}\" holds a character that an input port name cannot carry"
                    ));
                }
                if self.seen_inputs.insert(name.clone()) {
                    self.inputs.push(name.clone());
                }
                Ok(())
            }
            MathAst::Negate(operand) => self.walk(operand, bound),
            MathAst::Binary { left, right, .. } => {
                self.walk(left, bound)?;
                self.walk(right, bound)
            }
            MathAst::Call { name, args } => {
                let Some(arity) = self.arity_of(name) else {
                    if self.defines_function(name) {
                        return Err(format!(
                            "\"{name}\" is defined below this line, and a line calls the functions above it alone, so a function never calls itself"
                        ));
                    }
                    return Err(format!(
                        "\"{name}\" is not a function this object defines or this language knows"
                    ));
                };
                if args.len() != arity {
                    let plural = if arity == 1 { "" } else { "s" };
                    return Err(format!(
                        "\"{name}\" takes {arity} argument{plural}, and this call passes {}",
                        args.len()
                    ));
                }
                for argument in args {
                    self.walk(argument, bound)?;
                }
                Ok(())
            }
            MathAst::Integral {
                variable,
                lower,
                upper,
                body,
            }
            | MathAst::Series {
                variable,
                lower,
                upper,
                body,
                ..
            } => {
                // A bound holds the value the variable runs between, so it
                // reads the names around the form rather than the variable the
                // form binds.
                self.walk(lower, bound)?;
                self.walk(upper, bound)?;
                let mut inside = bound.clone();
                inside.insert(variable.clone());
                self.walk(body, &inside)
            }
        }
    }

    /// The refusals a name takes before it can become an export. A definition
    /// and the unknown of an implicit line both land under `out`, so both go
    /// through this one check and the two can never come to differ.
    fn refuse_export_name(&self, name: &str) -> Option<String> {
        if self.defined.contains(name) {
            return Some(format!(
                "\"{name}\" is defined twice, and a name carries one value"
            ));
        }
        if self.defines_function(name) {
            return Some(format!(
                "\"{name}\" is both a function and a value of this object"
            ));
        }
        if !is_legal_port_name(name) {
            return Some(format!(
                "\"{name}\" holds a character that an export name cannot carry"
            ));
        }
        if self.seen_inputs.contains(name) {
            return Some(format!(
                "\"{name}\" is read above the line that defines it, and a line reads the names above it alone"
            ));
        }
        None
    }
}

/// Whether an expression reads a name that nothing inside it binds. The unknown
/// of an implicit line has to appear in the equation this way, because an
/// equation that never reads it does not constrain it.
fn reads_name(ast: &MathAst, name: &str) -> bool {
    match ast {
        MathAst::Number(_) | MathAst::Reference(_) => false,
        MathAst::Name(held) => held == name,
        MathAst::Negate(operand) => reads_name(operand, name),
        MathAst::Binary { left, right, .. } => reads_name(left, name) || reads_name(right, name),
        MathAst::Call { args, .. } => args.iter().any(|argument| reads_name(argument, name)),
        MathAst::Integral {
            variable,
            lower,
            upper,
            body,
        }
        | MathAst::Series {
            variable,
            lower,
            upper,
            body,
            ..
        } => {
            reads_name(lower, name)
                || reads_name(upper, name)
                || (variable != name && reads_name(body, name))
        }
    }
}

/// Reads a program and reports the names it exports, the names it needs and the
/// functions it defines. A name that breaks a rule of the language stops the
/// whole read, because a source whose slot set cannot be worked out is one the
/// mutation refuses.
pub fn resolve_math_names(program: &MathProgram) -> Result<MathNames, MathNameError> {
    let mut binder = Binder {
        defined: HashSet::new(),
        exports: Vec::new(),
        functions: Vec::new(),
        all_functions: Vec::new(),
        inputs: Vec::new(),
        seen_inputs: HashSet::new(),
        references: Vec::new(),
        seen_references: HashSet::new(),
        seeds: Vec::new(),
    };

    for (index, line) in program.lines.iter().enumerate() {
        if let MathLine::FunctionDefinition { name, .. } = line {
            if binder.defines_function(name) {
                return Err(MathNameError {
                    message: format!("\"{name}\" is defined as a function twice"),
                    line: index,
                });
            }
            binder.all_functions.push(name.clone());
        }
    }

    for (index, line) in program.lines.iter().enumerate() {
        let at = |message: String| MathNameError {
            message,
            line: index,
        };
        let empty = HashSet::new();

        match line {
            MathLine::FunctionDefinition {
                name,
                parameters,
                body,
            } => {
                let bound: HashSet<String> = parameters.iter().cloned().collect();
                binder.walk(body, &bound).map_err(at)?;
                binder.functions.push((name.clone(), parameters.len()));
            }
            MathLine::Expression { value } => {
                binder.walk(value, &empty).map_err(at)?;
            }
            MathLine::Solve {
                unknown,
                left,
                right,
                ..
            } => {
                if let Some(refusal) = binder.refuse_export_name(unknown) {
                    return Err(at(refusal));
                }
                if !reads_name(left, unknown) && !reads_name(right, unknown) {
                    return Err(at(format!(
                        "this line solves for \"{unknown}\", and the equation on it never reads \"{unknown}\""
                    )));
                }
                // The unknown is bound over the equation rather than free in
                // it, so it arrives with no input port. The solve gives it a
                // value, and a port would offer a second one.
                let bound: HashSet<String> = std::iter::once(unknown.clone()).collect();
                binder.walk(left, &bound).map_err(at)?;
                binder.walk(right, &bound).map_err(at)?;
                binder.defined.insert(unknown.clone());
                binder.exports.push(unknown.clone());
                binder.seeds.push(unknown.clone());
            }
            MathLine::Definition { name, value, .. } => {
                if let Some(refusal) = binder.refuse_export_name(name) {
                    return Err(at(refusal));
                }
                binder.walk(value, &empty).map_err(at)?;
                binder.defined.insert(name.clone());
                binder.exports.push(name.clone());
            }
        }
    }

    Ok(MathNames {
        references: binder.references,
        exports: binder.exports,
        inputs: binder.inputs,
        functions: binder.all_functions,
        seeds: binder.seeds,
    })
}

#[cfg(test)]
mod tests {
    use super::{MathNames, resolve_math_names};
    use crate::math::parser::parse_math;

    fn names(source: &str) -> MathNames {
        let program = parse_math(source).expect("the source parses");
        resolve_math_names(&program).expect("the names resolve")
    }

    fn refusal(source: &str) -> String {
        let program = parse_math(source).expect("the source parses");
        resolve_math_names(&program)
            .expect_err("the names do not resolve")
            .message
    }

    #[test]
    fn a_free_name_becomes_an_input_in_the_order_it_is_first_read() {
        let resolved = names("y=x+z+x");
        assert_eq!(resolved.exports, ["y"]);
        assert_eq!(resolved.inputs, ["x", "z"]);
    }

    #[test]
    fn a_name_an_earlier_line_defines_is_not_an_input() {
        let resolved = names("a=1\nb=a+1");
        assert_eq!(resolved.exports, ["a", "b"]);
        assert!(resolved.inputs.is_empty());

        // A line reads the names above it alone, so the same two lines the
        // other way round name something that is not yet defined.
        assert_eq!(
            refusal("b=a+1\na=1"),
            "\"a\" is read above the line that defines it, and a line reads the names above it alone"
        );
    }

    #[test]
    fn a_form_binds_its_variable_over_its_body_and_brings_no_port() {
        assert!(names("y=\\int_{0}^{1}x\\,dx").inputs.is_empty());
        assert!(names("y=\\sum_{i=1}^{2}i").inputs.is_empty());
        assert!(names("f(t)=t*2\ny=f(3)").inputs.is_empty());

        // A bound holds the value the variable runs between, so it reads the
        // names around the form rather than the one the form binds.
        assert_eq!(names("y=\\sum_{i=1}^{n}i").inputs, ["n"]);
        assert_eq!(names("y=\\sum_{i=1}^{n}i*k").inputs, ["n", "k"]);
        assert_eq!(names("f(t)=t*k\ny=f(3)").inputs, ["k"]);
    }

    #[test]
    fn an_implicit_line_exports_and_seeds_its_unknown_without_a_port() {
        let resolved = names("\\solve{x}x+1=y");
        assert_eq!(resolved.exports, ["x"]);
        assert_eq!(resolved.seeds, ["x"]);
        // The solve gives the unknown a value, and a port would offer a second.
        assert_eq!(resolved.inputs, ["y"]);

        assert_eq!(
            refusal("\\solve{x}1=2"),
            "this line solves for \"x\", and the equation on it never reads \"x\""
        );
        // A name that only appears bound inside the equation does not
        // constrain the unknown either.
        assert!(refusal("\\solve{x}\\sum_{x=1}^{2}x=4").contains("never reads"));
    }

    #[test]
    fn an_address_is_listed_once_in_the_order_it_is_first_read() {
        let resolved = names("y=\\gpref{b.v}+\\gpref{a.v}+\\gpref{b.v}");
        assert_eq!(
            resolved
                .references
                .iter()
                .map(|address| address.object_id.as_str())
                .collect::<Vec<_>>(),
            ["b", "a"]
        );
    }

    #[test]
    fn a_function_is_reported_where_the_source_cannot_satisfy_the_call() {
        assert_eq!(
            refusal("f(t)=t\nf(t)=t"),
            "\"f\" is defined as a function twice"
        );
        assert_eq!(
            refusal("y=f(1)\nf(t)=t"),
            "\"f\" is defined below this line, and a line calls the functions above it alone, so a function never calls itself"
        );
        assert_eq!(
            refusal("f(a,b)=a\ny=f(1)"),
            "\"f\" takes 2 arguments, and this call passes 1"
        );
        assert_eq!(
            refusal("y=\\sin(1,2)"),
            "\"sin\" takes 1 argument, and this call passes 2"
        );
    }

    #[test]
    fn a_function_and_a_value_cannot_share_a_name() {
        assert_eq!(
            refusal("f(t)=t\ny=f"),
            "\"f\" names a function of this object, and a function has no value of its own"
        );
        assert_eq!(
            refusal("f(t)=t\nf=1"),
            "\"f\" is both a function and a value of this object"
        );
        assert_eq!(
            refusal("a=1\na=2"),
            "\"a\" is defined twice, and a name carries one value"
        );
    }

    #[test]
    fn a_line_with_no_name_still_contributes_the_names_it_reads() {
        let resolved = names("x+y");
        assert!(resolved.exports.is_empty());
        assert_eq!(resolved.inputs, ["x", "y"]);
        assert_eq!(
            resolve_math_names(&parse_math("").expect("the source parses")),
            Ok(MathNames::default())
        );
    }

    #[test]
    fn the_functions_a_source_defines_come_back_in_the_order_it_defines_them() {
        let resolved = names("g(t)=t\nf(t)=t\ny=f(1)+g(2)");
        assert_eq!(resolved.functions, ["g", "f"]);
        assert_eq!(resolved.exports, ["y"]);
    }
}
