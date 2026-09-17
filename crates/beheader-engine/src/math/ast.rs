//! The node types of the math language, and the shape a parsed source text
//! becomes.
//!
//! This is the Rust side of `src/engine/math/ast.ts`. A program is a list of
//! lines, because a math object holds one equation for each line of its source
//! the way a list of expressions holds one per row. A line either gives a name
//! a value, defines a function, constrains an unknown, or stands as an
//! expression that nothing reads.
//!
//! These types are a separate family from the formula tree in
//! `formula/ast.rs`. The two languages meet at a compute function on a derived
//! slot and nowhere else, so neither parser knows the node types of the other.
//! The math language carries binding forms and a formula carries none, which
//! is why the node sets differ rather than nest.
//!
//! The tree is plain data, with no closure and no live handle in it, so a
//! program survives a trip through JSON and a parse result sits in a mutation
//! batch beside the slots it implies.

use crate::address::Address;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum MathBinaryOperator {
    Add,
    Subtract,
    Multiply,
    Divide,
    Power,
}

pub const MATH_BINARY_OPERATORS: [MathBinaryOperator; 5] = [
    MathBinaryOperator::Add,
    MathBinaryOperator::Subtract,
    MathBinaryOperator::Multiply,
    MathBinaryOperator::Divide,
    MathBinaryOperator::Power,
];

impl MathBinaryOperator {
    pub fn as_str(self) -> &'static str {
        match self {
            MathBinaryOperator::Add => "+",
            MathBinaryOperator::Subtract => "-",
            MathBinaryOperator::Multiply => "*",
            MathBinaryOperator::Divide => "/",
            MathBinaryOperator::Power => "^",
        }
    }

    pub fn parse(text: &str) -> Option<MathBinaryOperator> {
        MATH_BINARY_OPERATORS
            .into_iter()
            .find(|operator| operator.as_str() == text)
    }
}

/// Whether a series adds its terms or multiplies them.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum SeriesOperation {
    Sum,
    Product,
}

impl SeriesOperation {
    pub fn as_str(self) -> &'static str {
        match self {
            SeriesOperation::Sum => "sum",
            SeriesOperation::Product => "product",
        }
    }
}

/// One node of a math expression.
#[derive(Clone, Debug, PartialEq)]
pub enum MathAst {
    Number(f64),
    /// A bare name, local to the object that holds it. The binder in
    /// `math/names.rs` decides for each one whether an enclosing form binds it,
    /// an earlier line defines it, or it is free and becomes an input port.
    Name(String),
    /// A slot of the document, read from notation. Notation multiplies letters
    /// that sit beside each other, so a name of more than one letter cannot be
    /// written plainly and an address arrives wrapped in a macro instead. The
    /// node holds the resolved address, so what it names survives a rename the
    /// same way a formula does.
    Reference(Address),
    Binary {
        operator: MathBinaryOperator,
        left: Box<MathAst>,
        right: Box<MathAst>,
    },
    Negate(Box<MathAst>),
    /// A call of a built-in function such as sin, or of a function an earlier
    /// line of the same object defines. The parser does not tell the two apart,
    /// because a name it cannot resolve yet may be defined further down.
    Call {
        name: String,
        args: Vec<MathAst>,
    },
    /// A definite integral over a range. The variable binds over the body
    /// alone, so a name matching it inside the body reads the integration
    /// variable rather than an input port of the object.
    Integral {
        variable: String,
        lower: Box<MathAst>,
        upper: Box<MathAst>,
        body: Box<MathAst>,
    },
    /// A sum or a product over an integer range. The variable binds the way the
    /// integration variable does, and the bounds are read outside that binding.
    Series {
        operation: SeriesOperation,
        variable: String,
        lower: Box<MathAst>,
        upper: Box<MathAst>,
        body: Box<MathAst>,
    },
}

/// One line of a program.
#[derive(Clone, Debug, PartialEq)]
pub enum MathLine {
    /// A line that gives a name a value, which becomes an export slot.
    /// `source_line` is the line of the source it came from, counted from zero,
    /// because a display that puts a result beside its working has no text of
    /// its own to match against.
    Definition {
        name: String,
        value: MathAst,
        source_line: usize,
    },
    /// A line that defines a function. It creates no slot, because a slot holds
    /// a value and no value is a function. Later lines call it.
    FunctionDefinition {
        name: String,
        parameters: Vec<String>,
        body: MathAst,
    },
    /// A line that constrains an unknown rather than giving a name a value. The
    /// two sides hold the same number when the unknown takes the right value,
    /// and the object finds that value with a search beginning at the seed slot
    /// the unknown carries.
    ///
    /// The unknown is written rather than worked out. Notation gives `x^2+3=y`
    /// no way to say which of its letters the object solves for, and a rule
    /// that read the lines around it would change what this line solves for
    /// when a line above it was edited.
    Solve {
        unknown: String,
        left: MathAst,
        right: MathAst,
        source_line: usize,
    },
    /// A line that computes something and gives it no name. It reads its inputs
    /// like any other line, so it still contributes input ports, and an
    /// operator sees its value in the editor.
    Expression { value: MathAst },
}

/// Which kind of line put a name under `out`, because the two write their
/// result differently.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ExportKind {
    Definition,
    Solve,
}

impl ExportKind {
    pub fn as_str(self) -> &'static str {
        match self {
            ExportKind::Definition => "definition",
            ExportKind::Solve => "solve",
        }
    }
}

/// The name a line puts under `out`, and the line of the source it came from.
/// A definition and a solve both export a name, and a display that writes a
/// result beside the working reads both kinds through this shape rather than
/// telling them apart at every use.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MathExportLine {
    pub name: String,
    pub source_line: usize,
    pub kind: ExportKind,
}

#[derive(Clone, Debug, PartialEq, Default)]
pub struct MathProgram {
    pub lines: Vec<MathLine>,
}

/// The exporting lines of a program, in source order.
pub fn math_export_lines(program: &MathProgram) -> Vec<MathExportLine> {
    program
        .lines
        .iter()
        .filter_map(|line| match line {
            MathLine::Definition {
                name, source_line, ..
            } => Some(MathExportLine {
                name: name.clone(),
                source_line: *source_line,
                kind: ExportKind::Definition,
            }),
            MathLine::Solve {
                unknown,
                source_line,
                ..
            } => Some(MathExportLine {
                name: unknown.clone(),
                source_line: *source_line,
                kind: ExportKind::Solve,
            }),
            _ => None,
        })
        .collect()
}

/// The depth limit on one expression. A program arrives from a text slot, and
/// an evaluator that walks a tree recursively runs out of stack on a tree
/// deeper than this. The parser refuses a deeper expression, so evaluation
/// never meets one.
pub const MATH_MAX_DEPTH: usize = 64;

/// The depth of the deepest branch of an expression, counting the root as 1.
pub fn math_ast_depth(ast: &MathAst) -> usize {
    match ast {
        MathAst::Number(_) | MathAst::Name(_) | MathAst::Reference(_) => 1,
        MathAst::Negate(operand) => 1 + math_ast_depth(operand),
        MathAst::Binary { left, right, .. } => 1 + math_ast_depth(left).max(math_ast_depth(right)),
        MathAst::Call { args, .. } => 1 + args.iter().map(math_ast_depth).max().unwrap_or(0),
        MathAst::Integral {
            lower, upper, body, ..
        }
        | MathAst::Series {
            lower, upper, body, ..
        } => {
            1 + math_ast_depth(lower)
                .max(math_ast_depth(upper))
                .max(math_ast_depth(body))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{
        ExportKind, MathAst, MathBinaryOperator, MathLine, MathProgram, math_ast_depth,
        math_export_lines,
    };

    fn number(value: f64) -> MathAst {
        MathAst::Number(value)
    }

    #[test]
    fn the_depth_of_a_tree_counts_its_deepest_branch() {
        assert_eq!(math_ast_depth(&number(1.0)), 1);
        assert_eq!(math_ast_depth(&MathAst::Negate(Box::new(number(1.0)))), 2);
        let lopsided = MathAst::Binary {
            operator: MathBinaryOperator::Add,
            left: Box::new(number(1.0)),
            right: Box::new(MathAst::Negate(Box::new(MathAst::Negate(Box::new(
                number(2.0),
            ))))),
        };
        assert_eq!(math_ast_depth(&lopsided), 4);
        assert_eq!(
            math_ast_depth(&MathAst::Call {
                name: "sin".into(),
                args: vec![],
            }),
            1
        );
    }

    #[test]
    fn a_definition_and_a_solve_both_export_a_name_in_source_order() {
        let program = MathProgram {
            lines: vec![
                MathLine::FunctionDefinition {
                    name: "f".into(),
                    parameters: vec!["t".into()],
                    body: number(1.0),
                },
                MathLine::Definition {
                    name: "a".into(),
                    value: number(1.0),
                    source_line: 1,
                },
                MathLine::Expression { value: number(2.0) },
                MathLine::Solve {
                    unknown: "x".into(),
                    left: number(1.0),
                    right: number(2.0),
                    source_line: 3,
                },
            ],
        };
        let exported = math_export_lines(&program);
        assert_eq!(
            exported
                .iter()
                .map(|line| (line.name.as_str(), line.source_line, line.kind))
                .collect::<Vec<_>>(),
            [
                ("a", 1, ExportKind::Definition),
                ("x", 3, ExportKind::Solve)
            ]
        );
    }
}
