//! How the engine names one slot on one object, and the two spellings a table
//! cell has.
//!
//! This is the Rust side of `src/engine/address.ts`. An `AddressableObject`
//! trait gives parsing and formatting only the identity, type, and slot names
//! they need, so address handling does not depend on an evaluator.
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

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Address {
    pub object_id: String,
    pub path: Vec<String>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AddressError {
    pub message: String,
}

pub trait AddressableObject {
    fn id(&self) -> &str;
    fn name(&self) -> &str;
    fn object_type(&self) -> ObjectType;
    fn slot_keys(&self) -> Vec<&str>;
}

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

pub fn nearest_name<'a>(
    typed: &str,
    candidates: impl IntoIterator<Item = &'a str>,
) -> Option<&'a str> {
    let target: Vec<u16> = typed.to_lowercase().encode_utf16().collect();
    let mut best = None;
    let mut best_distance = usize::MAX;
    for candidate in candidates {
        let against: Vec<u16> = candidate.to_lowercase().encode_utf16().collect();
        let mut previous: Vec<usize> = (0..=against.len()).collect();
        for (row, target_character) in target.iter().enumerate() {
            let mut current = vec![row + 1];
            for (column, against_character) in against.iter().enumerate() {
                current.push(
                    (current[column] + 1)
                        .min(previous[column + 1] + 1)
                        .min(previous[column] + usize::from(target_character != against_character)),
                );
            }
            previous = current;
        }
        if previous[against.len()] < best_distance {
            best_distance = previous[against.len()];
            best = Some(candidate);
        }
    }
    best
}

pub fn find_object_by_name<'a, T: AddressableObject>(
    name: &str,
    objects: &'a [T],
) -> Option<&'a T> {
    objects
        .iter()
        .find(|object| object.name().eq_ignore_ascii_case(name))
}

pub fn find_object_by_id<'a, T: AddressableObject>(id: &str, objects: &'a [T]) -> Option<&'a T> {
    objects.iter().find(|object| object.id() == id)
}

pub fn is_name_taken<T: AddressableObject>(
    name: &str,
    objects: &[T],
    exclude_id: Option<&str>,
) -> bool {
    objects.iter().any(|object| {
        (Some(object.id()) != exclude_id && object.name().eq_ignore_ascii_case(name))
            || (object.object_type() == ObjectType::Doc
                && object
                    .slot_keys()
                    .iter()
                    .any(|key| key.eq_ignore_ascii_case(name)))
    })
}

pub fn generate_default_name<T: AddressableObject>(prefix: &str, objects: &[T]) -> String {
    for number in 1_u64.. {
        let candidate = format!("{prefix}_{number}");
        if !is_name_taken(&candidate, objects, None) {
            return candidate;
        }
    }
    unreachable!("the name counter cannot exhaust u64")
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

pub fn to_stored_path(object_type: ObjectType, surface_path: &[String]) -> Vec<String> {
    if object_type != ObjectType::Table {
        return surface_path.to_vec();
    }
    match surface_path {
        [cell] if is_cell_reference_form(cell) => vec![
            TABLE_CELL_PATH_PREFIX.to_string(),
            cell.to_ascii_uppercase(),
        ],
        [prefix, cell] if prefix == TABLE_CELL_PATH_PREFIX && is_cell_reference_form(cell) => {
            vec![prefix.clone(), cell.to_ascii_uppercase()]
        }
        _ => surface_path.to_vec(),
    }
}

pub fn bare_cell_address(table_object_id: &str, cell_reference: &str) -> Address {
    Address {
        object_id: table_object_id.to_string(),
        path: vec![
            TABLE_CELL_PATH_PREFIX.to_string(),
            cell_reference.to_ascii_uppercase(),
        ],
    }
}

pub fn parse_address<T: AddressableObject>(
    input: &str,
    objects: &[T],
) -> Result<Address, AddressError> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return Err(AddressError {
            message: "empty address".to_string(),
        });
    }
    let segments: Vec<&str> = trimmed.split('.').collect();
    if segments.iter().any(|segment| segment.is_empty()) {
        return Err(AddressError {
            message: format!("malformed address \"{input}\" — empty segment"),
        });
    }
    if segments.len() < 2 {
        if let Some(doc) = objects
            .iter()
            .find(|object| object.object_type() == ObjectType::Doc)
            && let Some(key) = doc
                .slot_keys()
                .into_iter()
                .find(|key| key.eq_ignore_ascii_case(trimmed))
        {
            return Ok(Address {
                object_id: doc.id().to_string(),
                path: vec![key.to_string()],
            });
        }
        return Err(AddressError {
            message: format!(
                "malformed address \"{input}\" — expected \"name.path\", e.g. \"table_x.A1\""
            ),
        });
    }
    let (name, path) = segments.split_first().expect("the address has segments");
    if let Some(bad) = path.iter().find(|segment| {
        !segment
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_')
    }) {
        return Err(AddressError {
            message: format!("malformed address \"{input}\" — invalid path segment \"{bad}\""),
        });
    }
    let Some(object) = find_object_by_name(name, objects) else {
        let suggestion = nearest_name(name, objects.iter().map(AddressableObject::name))
            .map_or(String::new(), |candidate| {
                format!(" Did you mean \"{candidate}\"?")
            });
        return Err(AddressError {
            message: format!("no object named \"{name}\"{suggestion}"),
        });
    };
    let surface: Vec<String> = path.iter().map(|segment| (*segment).to_string()).collect();
    let mut stored = to_stored_path(object.object_type(), &surface);
    if object.object_type() == ObjectType::Doc
        && stored.len() == 1
        && let Some(key) = object
            .slot_keys()
            .into_iter()
            .find(|key| key.eq_ignore_ascii_case(&stored[0]))
    {
        stored[0] = key.to_string();
    }
    Ok(Address {
        object_id: object.id().to_string(),
        path: stored,
    })
}

pub fn format_address<T: AddressableObject>(
    address: &Address,
    objects: &[T],
) -> Result<String, AddressError> {
    let object = find_object_by_id(&address.object_id, objects).ok_or_else(|| AddressError {
        message: format!("no object with id \"{}\"", address.object_id),
    })?;
    Ok(std::iter::once(object.name().to_string())
        .chain(to_surface_path(object.object_type(), &address.path))
        .collect::<Vec<_>>()
        .join("."))
}

#[cfg(test)]
mod tests {
    use super::{
        Address, AddressableObject, CellCoordinates, bare_cell_address, column_letters_to_index,
        format_address, format_cell_reference, generate_default_name, index_to_column_letters,
        is_cell_reference_form, is_name_taken, is_valid_name, nearest_name, parse_address,
        parse_cell_reference, to_surface_path,
    };
    use crate::model::ObjectType;

    fn path(segments: &[&str]) -> Vec<String> {
        segments
            .iter()
            .map(|segment| (*segment).to_string())
            .collect()
    }

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

    #[test]
    fn resolves_names_cells_and_document_variables() {
        let objects = [
            Object {
                id: "table-id",
                name: "Table_X",
                kind: ObjectType::Table,
                slots: vec!["cells.A1"],
            },
            Object {
                id: "doc-id",
                name: "doc",
                kind: ObjectType::Doc,
                slots: vec!["Speed"],
            },
        ];
        assert_eq!(
            parse_address(" table_x.a1 ", &objects).unwrap(),
            bare_cell_address("table-id", "A1")
        );
        assert_eq!(
            parse_address("speed", &objects).unwrap().path,
            path(&["Speed"])
        );
        assert_eq!(
            format_address(
                &Address {
                    object_id: "table-id".into(),
                    path: path(&["cells", "A1"])
                },
                &objects
            )
            .unwrap(),
            "Table_X.A1"
        );
        assert!(
            parse_address("missing.x", &objects)
                .unwrap_err()
                .message
                .contains("Did you mean")
        );
    }

    #[test]
    fn name_queries_keep_document_order_and_respect_exclusion() {
        let objects = [
            Object {
                id: "one",
                name: "alpha",
                kind: ObjectType::Value,
                slots: vec![],
            },
            Object {
                id: "doc",
                name: "doc",
                kind: ObjectType::Doc,
                slots: vec!["Speed"],
            },
        ];
        assert_eq!(
            nearest_name("ALPH", objects.iter().map(AddressableObject::name)),
            Some("alpha")
        );
        assert!(is_name_taken("speed", &objects, None));
        assert!(!is_name_taken("alpha", &objects, Some("one")));
        assert_eq!(generate_default_name("alpha", &objects), "alpha_1");
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
