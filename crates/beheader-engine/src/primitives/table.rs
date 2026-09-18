//! Cell address arithmetic, range expansion, and the passes that resize a table
//! by a row or a column.
//!
//! A range expands to concrete cells at edge derivation time, using the size
//! the table has right then, so an expansion cannot go stale behind a resize.
//!
//! An empty cell produces no edge, whether a range covers it or a bare
//! reference names it. That is normal state rather than a dangling reference,
//! and it is why a sparse table is cheap: a thousand empty cells cost nothing
//! to store and nothing to evaluate.
//!
//! Deleting a row or a column repairs instead of refusing. It rewrites every
//! reference that pointed into the deleted line to `#REF` and reports what it
//! broke, because refusing would leave an operator unable to delete a row that
//! anything reads.
//!
//! A row or column count is read as a whole number that is not negative, and
//! anything else reads as zero. A formula in a dimension slot reads as zero
//! too, which is what holds a table that drives its own size from resizing
//! itself.
//!
//! The port of `src/engine/primitives/table.ts`.

use crate::address::{
    Address, CellCoordinates, TABLE_CELL_PATH_PREFIX, format_cell_reference, parse_cell_reference,
};
use crate::model::{GraphObject, ObjectType, Slot, SlotMap, Value, slot_key};
use crate::number::{js_max, js_min};

pub const MIN_TABLE_LINES: f64 = 1.0;
pub const MAX_TABLE_LINES: f64 = 1000.0;

pub const DEFAULT_TABLE_ROWS: f64 = 8.0;
pub const DEFAULT_TABLE_COLS: f64 = 8.0;

/// Which of the two directions a resize runs along.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TableAxis {
    Row,
    Column,
}

impl TableAxis {
    pub fn as_str(self) -> &'static str {
        match self {
            TableAxis::Row => "row",
            TableAxis::Column => "column",
        }
    }
}

/// Why a range did not expand to a list of cells.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RangeEnumerationError {
    pub message: String,
}

pub fn table_rows_path() -> Vec<String> {
    vec!["rows".to_string()]
}

pub fn table_cols_path() -> Vec<String> {
    vec!["cols".to_string()]
}

fn cell_path(coordinates: CellCoordinates) -> Vec<String> {
    vec![
        TABLE_CELL_PATH_PREFIX.to_string(),
        format_cell_reference(coordinates),
    ]
}

pub fn cell_address_to_coordinates(address: &Address) -> Option<CellCoordinates> {
    if address.path.len() != 2 || address.path[0] != TABLE_CELL_PATH_PREFIX {
        return None;
    }
    parse_cell_reference(&address.path[1])
}

/// The row and column count of a table.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct TableDimensions {
    pub rows: f64,
    pub cols: f64,
}

/// A dimension as a count of lines. A slot holding anything but a literal whole
/// number that is not negative reads as zero, so a table whose size is driven
/// by a formula declares no cells rather than a number of them that evaluation
/// would have to settle first.
fn read_table_dimension<A>(object: &GraphObject<A>, at: &[String]) -> f64 {
    let Some(Slot::Literal { value }) = object.get_slot(at) else {
        return 0.0;
    };
    match value {
        Value::Number(held) if held.fract() == 0.0 && held.is_finite() && *held >= 0.0 => *held,
        _ => 0.0,
    }
}

/// Reads the row and column count out of the dimension slots.
pub fn get_table_dimensions<A>(object: &GraphObject<A>) -> TableDimensions {
    TableDimensions {
        rows: read_table_dimension(object, &table_rows_path()),
        cols: read_table_dimension(object, &table_cols_path()),
    }
}

/// True when the address names a cell inside the current size of a real table.
/// An empty cell inside the extent is normal state, not a dangling reference.
pub fn is_in_extent_table_cell_address<A>(address: &Address, objects: &[GraphObject<A>]) -> bool {
    let Some(coordinates) = cell_address_to_coordinates(address) else {
        return false;
    };
    let Some(table) = objects
        .iter()
        .find(|candidate| candidate.id == address.object_id)
    else {
        return false;
    };
    if table.object_type != ObjectType::Table {
        return false;
    }
    let size = get_table_dimensions(table);
    coordinates.row <= size.rows && coordinates.column <= size.cols
}

/// Expands a range to the cells inside it, from the size the table has now. It
/// answers a reference error when the range does not resolve.
pub fn enumerate_range_cell_addresses<A>(
    start: &Address,
    end: &Address,
    table: &GraphObject<A>,
) -> Result<Vec<Address>, RangeEnumerationError> {
    if start.object_id != end.object_id {
        return Err(RangeEnumerationError {
            message: "a range's two endpoints must be cells in the same table".to_string(),
        });
    }
    let (Some(from), Some(to)) = (
        cell_address_to_coordinates(start),
        cell_address_to_coordinates(end),
    ) else {
        return Err(RangeEnumerationError {
            message: "a range endpoint is not a table cell address".to_string(),
        });
    };
    let size = get_table_dimensions(table);
    let min_row = js_min(from.row, to.row);
    let max_row = js_min(js_max(from.row, to.row), size.rows);
    let min_column = js_min(from.column, to.column);
    let max_column = js_min(js_max(from.column, to.column), size.cols);

    let mut addresses = Vec::new();
    let mut row = min_row;
    while row <= max_row {
        let mut column = min_column;
        while column <= max_column {
            addresses.push(Address {
                object_id: start.object_id.clone(),
                path: cell_path(CellCoordinates { column, row }),
            });
            column += 1.0;
        }
        row += 1.0;
    }
    Ok(addresses)
}

/// Every cell slot path inside the current size, in row order.
pub fn enumerate_table_cell_slot_paths<A>(object: &GraphObject<A>) -> Vec<Vec<String>> {
    let size = get_table_dimensions(object);
    let mut paths = Vec::new();
    let mut row = 1.0f64;
    while row <= size.rows {
        let mut column = 1.0f64;
        while column <= size.cols {
            paths.push(cell_path(CellCoordinates { column, row }));
            column += 1.0;
        }
        row += 1.0;
    }
    paths
}

/// True when the axis can still be resized. A dimension driven by a formula
/// cannot, because the resize writes a literal over it.
pub fn is_table_dimension_resizable<A>(object: &GraphObject<A>, axis: TableAxis) -> bool {
    let at = match axis {
        TableAxis::Row => table_rows_path(),
        TableAxis::Column => table_cols_path(),
    };
    matches!(object.get_slot(&at), None | Some(Slot::Literal { .. }))
}

fn shift_coordinates(coordinates: CellCoordinates, axis: TableAxis, index: f64) -> CellCoordinates {
    match axis {
        TableAxis::Row if coordinates.row >= index => CellCoordinates {
            column: coordinates.column,
            row: coordinates.row + 1.0,
        },
        TableAxis::Column if coordinates.column >= index => CellCoordinates {
            column: coordinates.column + 1.0,
            row: coordinates.row,
        },
        _ => coordinates,
    }
}

pub fn shift_cell_address_for_insert(
    address: &Address,
    table_id: &str,
    axis: TableAxis,
    index: f64,
) -> Address {
    if address.object_id != table_id {
        return address.clone();
    }
    let Some(coordinates) = cell_address_to_coordinates(address) else {
        return address.clone();
    };
    let shifted = shift_coordinates(coordinates, axis, index);
    if shifted == coordinates {
        return address.clone();
    }
    Address {
        object_id: address.object_id.clone(),
        path: cell_path(shifted),
    }
}

/// What a forced repair leaves behind: an address, or the mark that the line it
/// named has gone.
#[derive(Clone, Debug, PartialEq)]
pub enum CellRepair {
    Address(Address),
    Deleted,
}

/// What a range repair leaves behind: two endpoints, or the mark that the whole
/// range sat in the line that went.
#[derive(Clone, Debug, PartialEq)]
pub enum RangeRepair {
    Endpoints { start: Address, end: Address },
    Deleted,
}

/// Adds one row or column and shifts every cell after it.
pub fn insert_table_line<A: Clone>(
    object: &GraphObject<A>,
    axis: TableAxis,
    index: f64,
) -> GraphObject<A> {
    let size = get_table_dimensions(object);
    let bound = match axis {
        TableAxis::Row => size.rows,
        TableAxis::Column => size.cols,
    };
    let clamped = js_max(1.0, js_min(index, bound + 1.0));
    let mut slots = object.slots.clone();
    write_dimensions(
        &mut slots,
        match axis {
            TableAxis::Row => size.rows + 1.0,
            TableAxis::Column => size.rows,
        },
        match axis {
            TableAxis::Column => size.cols + 1.0,
            TableAxis::Row => size.cols,
        },
    );
    let moved = take_cells(object, &mut slots);
    for (coordinates, slot) in moved {
        let shifted = shift_coordinates(coordinates, axis, clamped);
        slots.insert(slot_key(&cell_path(shifted)), slot);
    }
    GraphObject {
        slots,
        ..object.clone()
    }
}

/// Removes one row or column. Every cell in the line that went is dropped, and
/// the caller repairs the references that pointed into it.
pub fn delete_table_line<A: Clone>(
    object: &GraphObject<A>,
    axis: TableAxis,
    index: f64,
) -> GraphObject<A> {
    let size = get_table_dimensions(object);
    let mut slots = object.slots.clone();
    write_dimensions(
        &mut slots,
        match axis {
            TableAxis::Row => js_max(0.0, size.rows - 1.0),
            TableAxis::Column => size.rows,
        },
        match axis {
            TableAxis::Column => js_max(0.0, size.cols - 1.0),
            TableAxis::Row => size.cols,
        },
    );
    let moved = take_cells(object, &mut slots);
    for (coordinates, slot) in moved {
        if let Some(shifted) = shift_coordinates_for_delete(coordinates, axis, index) {
            slots.insert(slot_key(&cell_path(shifted)), slot);
        }
    }
    GraphObject {
        slots,
        ..object.clone()
    }
}

fn write_dimensions<A>(slots: &mut SlotMap<A>, rows: f64, cols: f64) {
    slots.insert(
        slot_key(&table_rows_path()),
        Slot::Literal {
            value: Value::Number(rows),
        },
    );
    slots.insert(
        slot_key(&table_cols_path()),
        Slot::Literal {
            value: Value::Number(cols),
        },
    );
}

/// Takes every cell inside the old size out of the map, with the coordinates it
/// held. The slots come back out so the caller can write them at their new
/// places, which lands them after everything that is not a cell.
fn take_cells<A: Clone>(
    object: &GraphObject<A>,
    slots: &mut SlotMap<A>,
) -> Vec<(CellCoordinates, Slot<A>)> {
    let mut taken = Vec::new();
    for at in enumerate_table_cell_slot_paths(object) {
        let Some(slot) = object.get_slot(&at) else {
            continue;
        };
        slots.remove(&slot_key(&at));
        if let Some(coordinates) = parse_cell_reference(&at[1]) {
            taken.push((coordinates, slot.clone()));
        }
    }
    taken
}

fn shift_coordinates_for_delete(
    coordinates: CellCoordinates,
    axis: TableAxis,
    index: f64,
) -> Option<CellCoordinates> {
    let along = match axis {
        TableAxis::Row => coordinates.row,
        TableAxis::Column => coordinates.column,
    };
    if along == index {
        return None;
    }
    if along > index {
        return Some(match axis {
            TableAxis::Row => CellCoordinates {
                column: coordinates.column,
                row: coordinates.row - 1.0,
            },
            TableAxis::Column => CellCoordinates {
                column: coordinates.column - 1.0,
                row: coordinates.row,
            },
        });
    }
    Some(coordinates)
}

pub fn repair_cell_address_for_delete(
    address: &Address,
    table_id: &str,
    axis: TableAxis,
    index: f64,
) -> CellRepair {
    if address.object_id != table_id {
        return CellRepair::Address(address.clone());
    }
    let Some(coordinates) = cell_address_to_coordinates(address) else {
        return CellRepair::Address(address.clone());
    };
    let Some(shifted) = shift_coordinates_for_delete(coordinates, axis, index) else {
        return CellRepair::Deleted;
    };
    if shifted == coordinates {
        return CellRepair::Address(address.clone());
    }
    CellRepair::Address(Address {
        object_id: address.object_id.clone(),
        path: cell_path(shifted),
    })
}

/// Where an endpoint lands when the line it sits in goes. An endpoint before
/// the line stays, one after it moves down, and one inside it collapses onto
/// whichever side of the line the other endpoint leaves standing.
fn clamp_range_endpoint_value(this_value: f64, other_value: f64, index: f64) -> f64 {
    if this_value < index {
        return this_value;
    }
    if this_value > index {
        return this_value - 1.0;
    }
    if other_value > index {
        index
    } else {
        index - 1.0
    }
}

pub fn repair_range_endpoints_for_delete(
    start: &Address,
    end: &Address,
    table_id: &str,
    axis: TableAxis,
    index: f64,
) -> RangeRepair {
    let unchanged = RangeRepair::Endpoints {
        start: start.clone(),
        end: end.clone(),
    };
    if start.object_id != table_id || end.object_id != table_id {
        return unchanged;
    }
    let (Some(from), Some(to)) = (
        cell_address_to_coordinates(start),
        cell_address_to_coordinates(end),
    ) else {
        return unchanged;
    };
    let along = |coordinates: CellCoordinates| match axis {
        TableAxis::Row => coordinates.row,
        TableAxis::Column => coordinates.column,
    };
    if along(from) == index && along(to) == index {
        return RangeRepair::Deleted;
    }
    let new_start = clamp_range_endpoint_value(along(from), along(to), index);
    let new_end = clamp_range_endpoint_value(along(to), along(from), index);
    let placed = |coordinates: CellCoordinates, value: f64| match axis {
        TableAxis::Row => CellCoordinates {
            column: coordinates.column,
            row: value,
        },
        TableAxis::Column => CellCoordinates {
            column: value,
            row: coordinates.row,
        },
    };
    RangeRepair::Endpoints {
        start: Address {
            object_id: start.object_id.clone(),
            path: cell_path(placed(from, new_start)),
        },
        end: Address {
            object_id: end.object_id.clone(),
            path: cell_path(placed(to, new_end)),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn table(rows: f64, cols: f64, cells: &[(&str, f64)]) -> GraphObject<()> {
        let mut slots = SlotMap::new();
        slots.insert(
            "rows",
            Slot::Literal {
                value: Value::Number(rows),
            },
        );
        slots.insert(
            "cols",
            Slot::Literal {
                value: Value::Number(cols),
            },
        );
        for (reference, held) in cells {
            slots.insert(
                format!("cells.{reference}"),
                Slot::Literal {
                    value: Value::Number(*held),
                },
            );
        }
        GraphObject {
            id: "t1".to_string(),
            name: "grid".to_string(),
            object_type: ObjectType::Table,
            target: None,
            slots,
            ports: None,
            vertex_count: None,
        }
    }

    fn cell(reference: &str) -> Address {
        Address {
            object_id: "t1".to_string(),
            path: vec![TABLE_CELL_PATH_PREFIX.to_string(), reference.to_string()],
        }
    }

    /// The cells come out in row order, which is the order a table draws them
    /// and the order a completion offers them.
    #[test]
    fn the_cells_come_out_in_row_order() {
        let paths = enumerate_table_cell_slot_paths(&table(2.0, 3.0, &[]));
        let names: Vec<&str> = paths.iter().map(|at| at[1].as_str()).collect();
        assert_eq!(names, vec!["A1", "B1", "C1", "A2", "B2", "C2"]);
    }

    /// A size that is not a literal whole number that is not negative declares
    /// no cells at all. A table sized by a formula is the case that matters: a
    /// count read from an evaluation that has yet to settle would let evaluation
    /// decide the slot set.
    #[test]
    fn a_size_the_schema_cannot_trust_declares_no_cells() {
        let mut driven = table(3.0, 3.0, &[]);
        driven.slots.insert(
            "rows",
            Slot::Derived {
                value: Value::Number(3.0),
            },
        );
        assert_eq!(get_table_dimensions(&driven).rows, 0.0);
        assert!(enumerate_table_cell_slot_paths(&driven).is_empty());
        assert!(!is_table_dimension_resizable(&driven, TableAxis::Row));
        assert!(is_table_dimension_resizable(&driven, TableAxis::Column));

        for held in [2.5, -1.0, f64::INFINITY] {
            assert_eq!(get_table_dimensions(&table(held, 3.0, &[])).rows, 0.0);
        }
    }

    /// A range reaches the cells between its two corners whichever corner comes
    /// first, and no further than the size the table has now.
    #[test]
    fn a_range_normalises_its_corners_and_stops_at_the_edge() {
        let grid = table(3.0, 3.0, &[]);
        let names = |start: &str, end: &str| {
            enumerate_range_cell_addresses(&cell(start), &cell(end), &grid)
                .expect("the range resolves")
                .iter()
                .map(|address| address.path[1].clone())
                .collect::<Vec<_>>()
        };
        assert_eq!(names("A1", "B2"), vec!["A1", "B1", "A2", "B2"]);
        assert_eq!(names("B2", "A1"), names("A1", "B2"));
        assert_eq!(names("A1", "Z9").len(), 9, "the range stops at the extent");
    }

    /// Two endpoints in different tables name no range, because a range walks
    /// one grid.
    #[test]
    fn a_range_across_two_tables_is_refused() {
        let elsewhere = Address {
            object_id: "t2".to_string(),
            path: vec![TABLE_CELL_PATH_PREFIX.to_string(), "B2".to_string()],
        };
        let failure =
            enumerate_range_cell_addresses(&cell("A1"), &elsewhere, &table(3.0, 3.0, &[]))
                .expect_err("two tables name no range");
        assert_eq!(
            failure.message,
            "a range's two endpoints must be cells in the same table"
        );
    }

    /// An insert moves the cells at or after the line down one and leaves the
    /// ones before it alone, and a delete drops the line and pulls the rest up.
    #[test]
    fn a_resize_moves_the_cells_on_one_side_of_the_line() {
        let grid = table(3.0, 3.0, &[("A1", 1.0), ("A2", 2.0), ("A3", 3.0)]);
        let inserted = insert_table_line(&grid, TableAxis::Row, 2.0);
        assert_eq!(get_table_dimensions(&inserted).rows, 4.0);
        let keys: Vec<&str> = inserted.slots.keys().collect();
        assert!(keys.contains(&"cells.A1"));
        assert!(keys.contains(&"cells.A3"));
        assert!(keys.contains(&"cells.A4"));
        assert!(!keys.contains(&"cells.A2"));

        let deleted = delete_table_line(&grid, TableAxis::Row, 2.0);
        assert_eq!(get_table_dimensions(&deleted).rows, 2.0);
        let keys: Vec<&str> = deleted.slots.keys().collect();
        assert!(keys.contains(&"cells.A1"));
        assert!(keys.contains(&"cells.A2"));
        assert!(!keys.contains(&"cells.A3"));
        assert_eq!(
            deleted.get_slot(&["cells".to_string(), "A2".to_string()]),
            Some(&Slot::Literal {
                value: Value::Number(3.0)
            }),
            "the row that was third became the second and kept its own value"
        );
    }

    /// A reference into the line that went is marked, and one after it moves up.
    #[test]
    fn a_delete_marks_the_line_that_went() {
        assert_eq!(
            repair_cell_address_for_delete(&cell("B2"), "t1", TableAxis::Row, 2.0),
            CellRepair::Deleted
        );
        assert_eq!(
            repair_cell_address_for_delete(&cell("B3"), "t1", TableAxis::Row, 2.0),
            CellRepair::Address(cell("B2"))
        );
        assert_eq!(
            repair_cell_address_for_delete(&cell("B1"), "t1", TableAxis::Row, 2.0),
            CellRepair::Address(cell("B1"))
        );
    }

    /// A range that sat entirely in the line that went is marked. One that
    /// straddles it collapses onto whichever side the other endpoint leaves
    /// standing.
    #[test]
    fn a_range_collapses_onto_the_side_that_survives() {
        let repaired = |start: &str, end: &str| {
            repair_range_endpoints_for_delete(&cell(start), &cell(end), "t1", TableAxis::Row, 2.0)
        };
        assert_eq!(repaired("A2", "C2"), RangeRepair::Deleted);
        assert_eq!(
            repaired("A1", "C3"),
            RangeRepair::Endpoints {
                start: cell("A1"),
                end: cell("C2"),
            }
        );
        assert_eq!(
            repaired("A2", "C3"),
            RangeRepair::Endpoints {
                start: cell("A2"),
                end: cell("C2"),
            }
        );
    }

    /// A cell inside the size of a real table is ordinary state even when it
    /// holds nothing, and a cell past the edge is not.
    #[test]
    fn an_empty_cell_inside_the_extent_is_ordinary_state() {
        let objects = [table(3.0, 3.0, &[])];
        assert!(is_in_extent_table_cell_address(&cell("C3"), &objects));
        assert!(!is_in_extent_table_cell_address(&cell("D3"), &objects));
        assert!(!is_in_extent_table_cell_address(&cell("A4"), &objects));
    }
}
