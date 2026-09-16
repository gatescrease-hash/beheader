//! Turns a tree back into source text, under whatever each object is called
//! now.
//!
//! This is the Rust side of `src/engine/formula/format.ts`. The properties
//! panel and the props command both print a formula through here, so an
//! operator who renames an object reads the new name in every formula that
//! names it, with nothing rewriting a stored tree.
//!
//! Brackets go in where they are needed to read the text back as the same
//! tree, and nowhere else. Each tier carries the precedence its parent
//! demands, and the right side of an operator demands one higher, which is
//! what keeps `1 - (2 - 3)` from printing as `1 - 2 - 3`.

use crate::address::{
    Address, AddressableObject, TABLE_CELL_PATH_PREFIX, format_address, is_cell_reference_form,
};
use crate::formula::ast::{
    BinaryOperator, FormulaAst, LiteralValue, MAX_FORMULA_AST_DEPTH, UnaryOperator,
};
use crate::number::to_javascript_text;

/// What a tree deeper than the limit prints as, in place of the rest of it.
const DEPTH_ELISION: &str = "...";

const UNARY_PRECEDENCE: u8 = 7;
const ATOM_PRECEDENCE: u8 = 8;

fn binary_precedence(operator: BinaryOperator) -> u8 {
    match operator {
        BinaryOperator::Or => 1,
        BinaryOperator::And => 2,
        BinaryOperator::Equal
        | BinaryOperator::NotEqual
        | BinaryOperator::Less
        | BinaryOperator::Greater
        | BinaryOperator::LessOrEqual
        | BinaryOperator::GreaterOrEqual => 3,
        BinaryOperator::Add | BinaryOperator::Subtract => 4,
        BinaryOperator::Multiply | BinaryOperator::Divide | BinaryOperator::Remainder => 5,
        BinaryOperator::Power => 6,
    }
}

/// The bare cell reference for an address that names a cell of the object the
/// formula is being read inside, which is how a table prints its own cells.
fn relative_cell_reference(address: &Address, relative_to: Option<&str>) -> Option<String> {
    if relative_to != Some(address.object_id.as_str()) {
        return None;
    }
    match address.path.as_slice() {
        [prefix, cell] if prefix == TABLE_CELL_PATH_PREFIX && is_cell_reference_form(cell) => {
            Some(cell.clone())
        }
        _ => None,
    }
}

fn format_one_address<T: AddressableObject>(
    address: &Address,
    objects: &[T],
    relative_to: Option<&str>,
) -> String {
    if let Some(relative) = relative_cell_reference(address, relative_to) {
        return relative;
    }
    // An address naming an object the document no longer holds prints as the
    // refusal, because the panel that shows a formula has nowhere else to put
    // one and an operator reading it needs to know which name went missing.
    match format_address(address, objects) {
        Ok(text) => text,
        Err(error) => error.message,
    }
}

fn format_literal(value: &LiteralValue) -> String {
    match value {
        LiteralValue::Text(text) => format!("\"{}\"", text.replace('"', "\\\"")),
        LiteralValue::Boolean(true) => "TRUE".to_string(),
        LiteralValue::Boolean(false) => "FALSE".to_string(),
        LiteralValue::Number(number) => to_javascript_text(*number),
    }
}

fn parenthesize_if_looser(text: String, precedence: u8, minimum: u8) -> String {
    if precedence < minimum {
        format!("({text})")
    } else {
        text
    }
}

fn format_node<T: AddressableObject>(
    ast: &FormulaAst,
    objects: &[T],
    minimum_precedence: u8,
    depth: usize,
    relative_to: Option<&str>,
) -> String {
    if depth > MAX_FORMULA_AST_DEPTH {
        return DEPTH_ELISION.to_string();
    }
    match ast {
        FormulaAst::Literal(value) => format_literal(value),
        FormulaAst::Reference(address) => format_one_address(address, objects, relative_to),
        FormulaAst::Range { start, end } => {
            match (
                relative_cell_reference(start, relative_to),
                relative_cell_reference(end, relative_to),
            ) {
                (Some(start), Some(end)) => format!("{start}:{end}"),
                // One end that needs its object name makes both print with
                // one, so the two ends of a range read alike.
                _ => format!(
                    "{}:{}",
                    format_one_address(start, objects, None),
                    format_one_address(end, objects, None)
                ),
            }
        }
        FormulaAst::BinaryOp {
            operator,
            left,
            right,
        } => {
            let precedence = binary_precedence(*operator);
            let left = format_node(left, objects, precedence, depth + 1, relative_to);
            let right = format_node(right, objects, precedence + 1, depth + 1, relative_to);
            parenthesize_if_looser(
                format!("{left} {} {right}", operator.as_str()),
                precedence,
                minimum_precedence,
            )
        }
        FormulaAst::UnaryOp { operator, operand } => {
            let operand = format_node(operand, objects, ATOM_PRECEDENCE, depth + 1, relative_to);
            let separator = if *operator == UnaryOperator::Not {
                " "
            } else {
                ""
            };
            parenthesize_if_looser(
                format!("{}{separator}{operand}", operator.as_str()),
                UNARY_PRECEDENCE,
                minimum_precedence,
            )
        }
        FormulaAst::FunctionCall { name, args } => {
            let args: Vec<String> = args
                .iter()
                .map(|argument| format_node(argument, objects, 0, depth + 1, relative_to))
                .collect();
            format!("{name}({})", args.join(", "))
        }
        FormulaAst::Error => "#REF".to_string(),
    }
}

/// The source text for a tree, with every object named as it is named now.
pub fn format_formula<T: AddressableObject>(
    ast: &FormulaAst,
    objects: &[T],
    relative_to_object_id: Option<&str>,
) -> String {
    format_node(ast, objects, 0, 1, relative_to_object_id)
}

#[cfg(test)]
mod tests {
    use super::format_formula;
    use crate::address::AddressableObject;
    use crate::formula::parser::parse_formula;
    use crate::model::ObjectType;

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

    fn round_trip(source: &str) -> String {
        let objects = document();
        let ast = parse_formula(source, &objects, None).expect("the formula parses");
        format_formula(&ast, &objects, None)
    }

    #[test]
    fn puts_brackets_only_where_reading_the_text_back_needs_them() {
        assert_eq!(round_trip("1 + 2 * 3"), "1 + 2 * 3");
        assert_eq!(round_trip("(1 + 2) * 3"), "(1 + 2) * 3");
        // The right side of an operator asks for one precedence higher, so a
        // subtraction on the right keeps its brackets and one on the left
        // gives them up.
        assert_eq!(round_trip("1 - (2 - 3)"), "1 - (2 - 3)");
        assert_eq!(round_trip("(1 - 2) - 3"), "1 - 2 - 3");
        assert_eq!(
            round_trip("TRUE OR (TRUE AND FALSE)"),
            "TRUE OR TRUE AND FALSE"
        );
        assert_eq!(
            round_trip("(TRUE OR TRUE) AND FALSE"),
            "(TRUE OR TRUE) AND FALSE"
        );
    }

    #[test]
    fn a_prefix_operator_takes_a_space_only_where_it_is_a_word() {
        assert_eq!(round_trip("-2"), "-2");
        assert_eq!(round_trip("NOT TRUE"), "NOT TRUE");
        assert_eq!(round_trip("-(2 * 3)"), "-(2 * 3)");
    }

    #[test]
    fn an_object_is_named_the_way_the_document_names_it_now() {
        let objects = document();
        let ast = parse_formula("poly.vertices", &objects, None).expect("the formula parses");
        let renamed = [
            Object {
                id: "t1",
                name: "table_x",
                kind: ObjectType::Table,
                slots: vec!["cells.A1"],
            },
            Object {
                id: "p1",
                name: "outline",
                kind: ObjectType::Polygon,
                slots: vec!["vertices"],
            },
        ];
        // Nothing rewrote the tree, which holds the ID, so the new name comes
        // from the object list handed to the printer.
        assert_eq!(format_formula(&ast, &renamed, None), "outline.vertices");
    }

    #[test]
    fn a_cell_of_the_object_being_read_prints_bare() {
        let objects = document();
        let ast = parse_formula("table_x.A1", &objects, None).expect("the formula parses");
        assert_eq!(format_formula(&ast, &objects, Some("t1")), "A1");
        assert_eq!(format_formula(&ast, &objects, Some("p1")), "table_x.A1");
        assert_eq!(format_formula(&ast, &objects, None), "table_x.A1");
    }

    #[test]
    fn a_range_prints_bare_only_where_both_ends_are_in_the_object_being_read() {
        let objects = document();
        let inside = parse_formula("SUM(A1:B2)", &objects, Some("t1")).expect("the formula parses");
        assert_eq!(format_formula(&inside, &objects, Some("t1")), "SUM(A1:B2)");
        assert_eq!(
            format_formula(&inside, &objects, None),
            "SUM(table_x.A1:table_x.B2)"
        );
    }

    #[test]
    fn an_object_the_document_no_longer_holds_prints_as_the_refusal() {
        let objects = document();
        let ast = parse_formula("poly.vertices", &objects, None).expect("the formula parses");
        let without: [Object; 0] = [];
        assert_eq!(
            format_formula(&ast, &without, None),
            "no object with id \"p1\""
        );
    }

    #[test]
    fn a_text_literal_keeps_its_quote_escaped() {
        assert_eq!(round_trip("\"a\\\"b\""), "\"a\\\"b\"");
        assert_eq!(round_trip("\"plain\""), "\"plain\"");
    }

    #[test]
    fn a_number_prints_the_way_javascript_prints_one() {
        assert_eq!(round_trip("1.5 + 2"), "1.5 + 2");
        // Below the boundary JavaScript writes an exponent, and the lexer has
        // no exponent form, so this text does not read back. The fault
        // predates the port and both engines keep it, which the
        // formula.format fixture records.
        assert_eq!(round_trip("0.0000001 + 1"), "1e-7 + 1");
        let objects = document();
        assert!(parse_formula("1e-7 + 1", &objects, None).is_err());
    }
}
