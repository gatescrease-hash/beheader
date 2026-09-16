//! How the engine names one slot on one object, and the two spellings a table
//! cell has.
//!
//! This is the Rust side of `src/engine/address.ts`. Resolving a name to an
//! object needs the object list, so `parse_address` and `format_address`
//! arrive with the package that ports the graph. What is here is the part that
//! reads a piece of text on its own: whether a name is well formed, whether a
//! segment is a cell reference, and the base twenty six arithmetic that turns
//! column letters into a number and back.
//!
//! The patterns are written out as scans rather than as regular expressions,
//! because the crate has no regular expression dependency and the three
//! patterns of this file are each a run of one character class followed by
//! another.
//!
//! A column index and a row number are both `f64`, which is what the
//! TypeScript engine stores. A row of twenty digits loses precision the same
//! way in both engines, and a Rust `u32` that refused it would refuse a
//! document the TypeScript engine reads.

use crate::model::ObjectType;
use crate::number::to_javascript_text;

/// The segment that a stored cell path begins with.
pub const TABLE_CELL_PATH_PREFIX: &str = "cells";

/// The column and the row a cell reference names, counted from one.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct CellCoordinates {
    pub column: f64,
    pub row: f64,
}

/// Whether a name matches the pattern an object name takes. It answers nothing
/// about a name already in use, which needs the object list.
pub fn is_valid_name(name: &str) -> bool {
    let mut characters = name.chars();
    match characters.next() {
        Some(first) if first.is_ascii_alphabetic() || first == '_' => {}
        _ => return false,
    }
    characters.all(|character| character.is_ascii_alphanumeric() || character == '_')
}

/// Splits a cell reference into its letters and its digits, where the letters
/// are one or more and the digits do not begin with a zero.
fn split_cell_reference(segment: &str) -> Option<(&str, &str)> {
    let letters = segment.len()
        - segment
            .trim_start_matches(|c: char| c.is_ascii_alphabetic())
            .len();
    if letters == 0 {
        return None;
    }
    let (letters, digits) = segment.split_at(letters);
    let mut characters = digits.chars();
    match characters.next() {
        Some(first) if first.is_ascii_digit() && first != '0' => {}
        _ => return None,
    }
    if !characters.all(|character| character.is_ascii_digit()) {
        return None;
    }
    Some((letters, digits))
}

/// Whether a segment is a bare cell reference such as `A1`. Only a formula
/// inside a table writes that form, because the table supplies the object the
/// reference belongs to.
pub fn is_cell_reference_form(segment: &str) -> bool {
    split_cell_reference(segment).is_some()
}

/// Column letters run in base twenty six with no zero digit, so `A` is one,
/// `Z` is twenty six and `AA` is twenty seven. The minus one in each direction
/// carries that offset.
///
/// The arithmetic runs in `f64` rather than in an integer type so that a run
/// of letters long enough to lose precision loses it the same way in both
/// engines.
pub fn column_letters_to_index(column_letters: &str) -> f64 {
    let mut index = 0.0_f64;
    for character in column_letters.chars() {
        let upper = character.to_ascii_uppercase();
        index = index * 26.0 + (f64::from(upper as u32) - 64.0);
    }
    index
}

/// The letters of a column index, which is the inverse of the base twenty six
/// reading above. An index of zero or less has no letters at all.
pub fn index_to_column_letters(index: f64) -> String {
    let mut remaining = index;
    let mut letters = String::new();
    while remaining > 0.0 {
        let digit = (remaining - 1.0) % 26.0;
        let code = 65.0 + digit;
        if let Some(character) = char::from_u32(code as u32) {
            letters.insert(0, character);
        }
        remaining = ((remaining - 1.0) / 26.0).floor();
    }
    letters
}

/// The coordinates a cell reference names, or nothing where the text is not a
/// cell reference at all.
pub fn parse_cell_reference(cell_reference: &str) -> Option<CellCoordinates> {
    let (letters, digits) = split_cell_reference(cell_reference)?;
    Some(CellCoordinates {
        column: column_letters_to_index(letters),
        row: digits.parse::<f64>().unwrap_or(f64::NAN),
    })
}

/// The text of a pair of coordinates, such as `AA12`.
pub fn format_cell_reference(coordinates: CellCoordinates) -> String {
    format!(
        "{}{}",
        index_to_column_letters(coordinates.column),
        to_javascript_text(coordinates.row)
    )
}

/// The spelling an operator reads for a stored path. A table cell is stored as
/// `cells.A1` and read as `A1`, and every other path is the same in both
/// directions.
pub fn to_surface_path(object_type: ObjectType, stored_path: &[String]) -> Vec<String> {
    if object_type != ObjectType::Table
        || stored_path.len() != 2
        || stored_path[0] != TABLE_CELL_PATH_PREFIX
    {
        return stored_path.to_vec();
    }
    let cell_reference = &stored_path[1];
    if !is_cell_reference_form(cell_reference) {
        return stored_path.to_vec();
    }
    vec![cell_reference.clone()]
}

#[cfg(test)]
mod tests {
    use super::{
        CellCoordinates, column_letters_to_index, format_cell_reference, index_to_column_letters,
        is_cell_reference_form, is_valid_name, parse_cell_reference, to_surface_path,
    };
    use crate::model::ObjectType;

    fn path(segments: &[&str]) -> Vec<String> {
        segments
            .iter()
            .map(|segment| (*segment).to_string())
            .collect()
    }

    #[test]
    fn accepts_a_name_that_matches_the_pattern() {
        assert!(is_valid_name("table_x"));
        assert!(is_valid_name("_hidden"));
        assert!(is_valid_name("A1"));
        assert!(!is_valid_name(""));
        assert!(!is_valid_name("1st"));
        assert!(!is_valid_name("has space"));
        assert!(!is_valid_name("has-dash"));
        assert!(!is_valid_name("naïve"));
        assert!(!is_valid_name("astral\u{1F600}"));
    }

    #[test]
    fn reads_a_cell_reference_only_in_the_form_a_table_writes() {
        assert!(is_cell_reference_form("A1"));
        assert!(is_cell_reference_form("aa12"));
        assert!(!is_cell_reference_form("A0"));
        assert!(!is_cell_reference_form("A01"));
        assert!(!is_cell_reference_form("1A"));
        assert!(!is_cell_reference_form("A"));
        assert!(!is_cell_reference_form("1"));
        assert!(!is_cell_reference_form(""));
        assert!(!is_cell_reference_form("A1b"));
    }

    #[test]
    fn counts_columns_in_base_twenty_six_with_no_zero_digit() {
        assert_eq!(column_letters_to_index("A"), 1.0);
        assert_eq!(column_letters_to_index("Z"), 26.0);
        assert_eq!(column_letters_to_index("AA"), 27.0);
        assert_eq!(column_letters_to_index("az"), 52.0);
        assert_eq!(index_to_column_letters(1.0), "A");
        assert_eq!(index_to_column_letters(26.0), "Z");
        assert_eq!(index_to_column_letters(27.0), "AA");
        assert_eq!(index_to_column_letters(702.0), "ZZ");
        assert_eq!(index_to_column_letters(703.0), "AAA");
        assert_eq!(index_to_column_letters(0.0), "");
        assert_eq!(index_to_column_letters(-3.0), "");
    }

    #[test]
    fn the_two_column_readings_are_inverses_over_the_range_a_table_reaches() {
        for index in 1..=2000 {
            let letters = index_to_column_letters(f64::from(index));
            assert_eq!(column_letters_to_index(&letters), f64::from(index));
        }
    }

    #[test]
    fn reads_and_writes_a_cell_reference() {
        assert_eq!(
            parse_cell_reference("AA12"),
            Some(CellCoordinates {
                column: 27.0,
                row: 12.0
            })
        );
        assert_eq!(parse_cell_reference("A0"), None);
        assert_eq!(
            format_cell_reference(CellCoordinates {
                column: 27.0,
                row: 12.0
            }),
            "AA12"
        );
    }

    #[test]
    fn a_stored_cell_path_reads_back_as_the_bare_reference() {
        assert_eq!(
            to_surface_path(ObjectType::Table, &path(&["cells", "A1"])),
            path(&["A1"])
        );
        assert_eq!(
            to_surface_path(ObjectType::Table, &path(&["cells", "nope"])),
            path(&["cells", "nope"])
        );
        assert_eq!(
            to_surface_path(ObjectType::Table, &path(&["rows"])),
            path(&["rows"])
        );
        assert_eq!(
            to_surface_path(ObjectType::Rect, &path(&["cells", "A1"])),
            path(&["cells", "A1"])
        );
    }
}
