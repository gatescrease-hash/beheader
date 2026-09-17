//! The vertex maths behind every shape: where the corners of a preset fall,
//! and how centroid, area, length and bounds are derived from them.
//!
//! A preset such as a polygon has one derived vertices slot rather than a slot
//! for each corner. Changing sides from 5 to 6 therefore changes a value and
//! leaves the slot set alone, which is what evaluation requires: only a
//! mutation may add or remove a slot.
//!
//! A polyline stores a slot for each vertex instead, at paths like
//! `vertex.0.x`. A vertex owns seven slots: x, y, the bulge of the edge leaving
//! it, and the x and y of a handle in each direction. [`VERTEX_PART_SUFFIXES`]
//! lists all seven, and a delete and a split move them as one group.
//!
//! Two vertex enumerations sit side by side, and they are not interchangeable.
//! [`enumerate_polyline_vertex_slot_paths`] lists all the slots of each vertex
//! and declares the schema. [`enumerate_polyline_coordinate_slot_paths`] lists
//! only x and y, and the derived vertices slot depends on that shorter one,
//! because bending an edge moves no point.
//!
//! Growing and shrinking a path splits across four functions.
//! [`add_vertex_to_object`] and [`delete_vertex_from_object`] change the
//! storage. [`shift_vertex_address_for_delete`] moves a surviving vertex down
//! an index, and [`repair_vertex_address_for_delete`] marks the exact vertex
//! that went, so the mutation layer can turn a reference to it into `#REF`.
//! [`insert_vertex_into_object`] and [`shift_vertex_address_for_insert`] serve
//! a split instead, and an insert loses no vertex, so a reference only ever
//! shifts up and a split works without a force flag at all.
//!
//! A vertex index reaches a slot path as the text JavaScript prints for it,
//! through [`crate::number::to_javascript_text`], and the count a path carries
//! is a number rather than a whole one. A document that holds a count of two
//! and a half reaches slots named `vertex.2.5.x` in the TypeScript, so the port
//! carries the count as `f64` and counts the same way rather than rounding it
//! first and parting from the engine it replaces.
//!
//! The port of `src/engine/primitives/geometry.ts`, which the module header of
//! that file describes at greater length.

use crate::address::Address;
use crate::model::{GraphObject, ObjectType, Point, Slot, Value, slot_key};
use crate::number::{js_cos, js_hypot, js_sin, to_javascript_text};
use crate::primitives::edge::{
    EdgeSplit, HALF_CIRCLE_BULGE, PathEdge, build_path_edges, split_edge_at,
};

pub const VERTEX_PATH_PREFIX: &str = "vertex";

/// The seven slots of one vertex. Two coordinates, the bulge of the edge after
/// it, and one handle for each direction. A delete and a split move all seven
/// together.
pub const VERTEX_PART_SUFFIXES: [&[&str]; 7] = [
    &["x"],
    &["y"],
    &["bulge"],
    &["handle", "in", "x"],
    &["handle", "in", "y"],
    &["handle", "out", "x"],
    &["handle", "out", "y"],
];

/// The bulge and handle slots. A change to one of these bends an edge and moves
/// no point. The list is the tail of [`VERTEX_PART_SUFFIXES`] rather than a
/// copy of it, so the two cannot drift apart and leave a vertex with a part
/// that one of them knows about.
fn curve_part_suffixes() -> &'static [&'static [&'static str]] {
    &VERTEX_PART_SUFFIXES[2..]
}

pub const MIN_POLYGON_SIDES: f64 = 3.0;

pub const MIN_POLYLINE_VERTICES: f64 = 2.0;

fn path(segments: &[&str]) -> Vec<String> {
    segments
        .iter()
        .map(|segment| (*segment).to_string())
        .collect()
}

pub fn origin_x_path() -> Vec<String> {
    path(&["origin", "x"])
}

pub fn origin_y_path() -> Vec<String> {
    path(&["origin", "y"])
}

pub fn radius_path() -> Vec<String> {
    path(&["radius"])
}

pub fn closed_path() -> Vec<String> {
    path(&["closed"])
}

pub fn vertices_path() -> Vec<String> {
    path(&["vertices"])
}

/// The three style slots every shape carries. A formula can drive each one, so
/// a table cell can colour a shape. They hold plain data here. The render layer
/// decides what a colour string means, because the engine knows no canvas.
pub fn geometry_style_paths() -> Vec<Vec<String>> {
    vec![
        path(&["style", "strokeColor"]),
        path(&["style", "strokeWidth"]),
        path(&["style", "fillColor"]),
    ]
}

/// The slot path of one part of one vertex, such as its y or one of its
/// handles.
pub fn vertex_part_path(index: f64, suffix: &[&str]) -> Vec<String> {
    let mut segments = vec![VERTEX_PATH_PREFIX.to_string(), to_javascript_text(index)];
    segments.extend(suffix.iter().map(|part| (*part).to_string()));
    segments
}

/// Every slot path of one vertex. A delete moves or breaks all seven together.
pub fn vertex_part_paths(index: f64) -> Vec<Vec<String>> {
    VERTEX_PART_SUFFIXES
        .iter()
        .map(|suffix| vertex_part_path(index, suffix))
        .collect()
}

/// The literal slot path of one vertex coordinate, such as `vertex.0.x`.
pub fn vertex_x_path(index: f64) -> Vec<String> {
    vertex_part_path(index, &["x"])
}

pub fn vertex_y_path(index: f64) -> Vec<String> {
    vertex_part_path(index, &["y"])
}

/// The curvature of the edge that leaves this vertex, as a DXF file states it.
/// A DXF vertex record carries the bulge of the edge after it, and so does this
/// one. So a path with N vertices carries N bulges, and the last one belongs to
/// the edge home to vertex 0. That edge draws only when closed is true, and the
/// slot exists at every value of closed. So evaluation changes a value and
/// never the slot set.
pub fn vertex_bulge_path(index: f64) -> Vec<String> {
    vertex_part_path(index, &["bulge"])
}

/// The x and y of one handle of one vertex.
pub struct HandlePaths {
    pub x: Vec<String>,
    pub y: Vec<String>,
}

/// The handle that pulls the edge which arrives at this vertex, as an offset
/// from it. The handle of the vertex before it pulls the same edge, from the
/// other end.
pub fn vertex_handle_in_paths(index: f64) -> HandlePaths {
    HandlePaths {
        x: vertex_part_path(index, &["handle", "in", "x"]),
        y: vertex_part_path(index, &["handle", "in", "y"]),
    }
}

/// The handle that pulls the edge which leaves this vertex, as an offset from
/// it.
pub fn vertex_handle_out_paths(index: f64) -> HandlePaths {
    HandlePaths {
        x: vertex_part_path(index, &["handle", "out", "x"]),
        y: vertex_part_path(index, &["handle", "out", "y"]),
    }
}

/// The indices a count reaches, counted the way the TypeScript loop counts
/// them. A count of two and a half reaches 0, 1 and 2, because the loop tests
/// the index against the count rather than against a rounded one.
fn vertex_indices(count: f64) -> impl Iterator<Item = f64> {
    let mut index = 0.0f64;
    std::iter::from_fn(move || {
        if index < count {
            let current = index;
            index += 1.0;
            Some(current)
        } else {
            None
        }
    })
}

fn vertex_count_of<A>(object: &GraphObject<A>) -> f64 {
    object.vertex_count.unwrap_or(0.0)
}

pub fn compute_polygon_vertices(
    sides: f64,
    radius: f64,
    origin: Point,
    rotation: f64,
) -> Vec<Point> {
    let mut vertices = Vec::new();
    for index in vertex_indices(sides) {
        let angle = rotation + (index * 2.0 * std::f64::consts::PI) / sides;
        vertices.push(Point {
            x: origin.x + radius * js_cos(angle),
            y: origin.y + radius * js_sin(angle),
        });
    }
    vertices
}

pub fn compute_rect_vertices(origin: Point, width: f64, height: f64) -> Vec<Point> {
    vec![
        Point {
            x: origin.x,
            y: origin.y,
        },
        Point {
            x: origin.x + width,
            y: origin.y,
        },
        Point {
            x: origin.x + width,
            y: origin.y + height,
        },
        Point {
            x: origin.x,
            y: origin.y + height,
        },
    ]
}

/// Each vertex paired with the one after it, closing back to the first. A
/// shoelace walks these.
fn edge_pairs(vertices: &[Point]) -> Vec<(Point, Point)> {
    let mut pairs = Vec::new();
    for index in 0..vertices.len() {
        pairs.push((vertices[index], vertices[(index + 1) % vertices.len()]));
    }
    pairs
}

fn compute_signed_area_doubled(vertices: &[Point]) -> f64 {
    let mut sum = 0.0;
    for (a, b) in edge_pairs(vertices) {
        sum += a.x * b.y - b.x * a.y;
    }
    sum
}

pub fn compute_area(vertices: &[Point]) -> f64 {
    compute_signed_area_doubled(vertices).abs() / 2.0
}

pub fn compute_centroid(vertices: &[Point]) -> Point {
    let doubled_area = compute_signed_area_doubled(vertices);
    if doubled_area == 0.0 {
        return compute_vertex_mean(vertices);
    }
    let mut weighted_x = 0.0;
    let mut weighted_y = 0.0;
    for (a, b) in edge_pairs(vertices) {
        let cross = a.x * b.y - b.x * a.y;
        weighted_x += (a.x + b.x) * cross;
        weighted_y += (a.y + b.y) * cross;
    }
    let six_signed_area = 3.0 * doubled_area;
    Point {
        x: weighted_x / six_signed_area,
        y: weighted_y / six_signed_area,
    }
}

pub fn compute_vertex_mean(vertices: &[Point]) -> Point {
    if vertices.is_empty() {
        return Point { x: 0.0, y: 0.0 };
    }
    let mut sum_x = 0.0;
    let mut sum_y = 0.0;
    for vertex in vertices {
        sum_x += vertex.x;
        sum_y += vertex.y;
    }
    let count = vertices.len() as f64;
    Point {
        x: sum_x / count,
        y: sum_y / count,
    }
}

pub fn compute_perimeter_length(vertices: &[Point]) -> f64 {
    let mut total = 0.0;
    for (a, b) in edge_pairs(vertices) {
        total += js_hypot(b.x - a.x, b.y - a.y);
    }
    total
}

/// The length of an open path. It sums each segment once and never closes the
/// last gap.
pub fn compute_open_path_length(vertices: &[Point]) -> f64 {
    let mut total = 0.0;
    for index in 0..vertices.len().saturating_sub(1) {
        let a = vertices[index];
        let b = vertices[index + 1];
        total += js_hypot(b.x - a.x, b.y - a.y);
    }
    total
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct VertexBounds {
    pub min_x: f64,
    pub min_y: f64,
    pub max_x: f64,
    pub max_y: f64,
}

/// The box around a list of points. It starts from the first point rather than
/// from the infinities, so a list holding a NaN keeps the bounds it had before
/// that point rather than answering NaN everywhere.
pub fn compute_bounds(vertices: &[Point]) -> VertexBounds {
    let Some(first) = vertices.first() else {
        return VertexBounds {
            min_x: 0.0,
            min_y: 0.0,
            max_x: 0.0,
            max_y: 0.0,
        };
    };
    let mut bounds = VertexBounds {
        min_x: first.x,
        min_y: first.y,
        max_x: first.x,
        max_y: first.y,
    };
    for vertex in vertices {
        if vertex.x < bounds.min_x {
            bounds.min_x = vertex.x;
        }
        if vertex.x > bounds.max_x {
            bounds.max_x = vertex.x;
        }
        if vertex.y < bounds.min_y {
            bounds.min_y = vertex.y;
        }
        if vertex.y > bounds.max_y {
            bounds.max_y = vertex.y;
        }
    }
    bounds
}

/// The `vertex.N.x` and `vertex.N.y` paths a polyline declares now, with every
/// other part of each vertex between them. The count comes from `vertex_count`,
/// a field on the object itself and not a slot, because the count changes only
/// through a vertex being added or deleted.
pub fn enumerate_polyline_vertex_slot_paths<A>(object: &GraphObject<A>) -> Vec<Vec<String>> {
    let mut paths = Vec::new();
    for index in vertex_indices(vertex_count_of(object)) {
        for suffix in VERTEX_PART_SUFFIXES {
            paths.push(vertex_part_path(index, suffix));
        }
    }
    paths
}

/// The bulge and handle slots this object carries now. A path built before one
/// of them existed carries none, and reads as 0 there.
pub fn existing_curve_paths<A>(object: &GraphObject<A>) -> Vec<Vec<String>> {
    let mut paths = Vec::new();
    for index in vertex_indices(vertex_count_of(object)) {
        for suffix in curve_part_suffixes() {
            let candidate = vertex_part_path(index, suffix);
            if object.get_slot(&candidate).is_some() {
                paths.push(candidate);
            }
        }
    }
    paths
}

/// The two coordinate slots of every vertex, and no bulge. The vertices slot
/// holds the points an operator placed, so a change to the curvature of an edge
/// leaves it alone.
pub fn enumerate_polyline_coordinate_slot_paths<A>(object: &GraphObject<A>) -> Vec<Vec<String>> {
    let mut paths = Vec::new();
    for index in vertex_indices(vertex_count_of(object)) {
        paths.push(vertex_x_path(index));
        paths.push(vertex_y_path(index));
    }
    paths
}

/// The edges of a path, read straight off its slots. The render layer builds a
/// canvas path and a hit test from these. It never reads a sample point,
/// because none exists.
pub fn path_edges_of_object<A>(object: &GraphObject<A>) -> Vec<PathEdge> {
    let Some(Value::Points(vertices)) = object.get_slot(&vertices_path()).map(Slot::value) else {
        return Vec::new();
    };
    if vertices.is_empty() {
        return Vec::new();
    }
    let number = |at: &[String]| match object.get_slot(at).map(Slot::value) {
        Some(Value::Number(held)) if held.is_finite() => *held,
        _ => 0.0,
    };
    let mut bulges = Vec::new();
    let mut handles_in = Vec::new();
    let mut handles_out = Vec::new();
    for index in 0..vertices.len() {
        let at = index as f64;
        let handle_in = vertex_handle_in_paths(at);
        let handle_out = vertex_handle_out_paths(at);
        bulges.push(number(&vertex_bulge_path(at)));
        handles_in.push(Point {
            x: number(&handle_in.x),
            y: number(&handle_in.y),
        });
        handles_out.push(Point {
            x: number(&handle_out.x),
            y: number(&handle_out.y),
        });
    }
    let closed = matches!(
        object.get_slot(&closed_path()).map(Slot::value),
        Some(Value::Boolean(true))
    );
    build_path_edges(vertices, &bulges, closed, &handles_in, &handles_out)
}

/// The number of edges this path has now. A closed path has one for each
/// vertex. An open path has one fewer, because it never walks home to vertex 0.
pub fn polyline_edge_count<A>(object: &GraphObject<A>) -> f64 {
    let count = vertex_count_of(object);
    if matches!(
        object.get_slot(&closed_path()).map(Slot::value),
        Some(Value::Boolean(true))
    ) {
        return count;
    }
    crate::number::js_max(0.0, count - 1.0)
}

/// Cuts edge index at the point on it nearest the given point, and puts a new
/// vertex there. An arc becomes two arcs of the same circle, so the shape on
/// screen does not move. It answers `None` when the edge does not exist.
pub fn split_polyline_edge<A>(
    object: &GraphObject<A>,
    index: usize,
    near: Point,
) -> Option<EdgeSplit> {
    let edges = path_edges_of_object(object);
    edges.get(index).map(|edge| split_edge_at(edge, near))
}

/// One vertex with a straight edge after it and no handles. Every part written,
/// none left absent.
fn straight_vertex_slots<A>(index: f64, at: Point) -> Vec<(String, Slot<A>)> {
    let handle_in = vertex_handle_in_paths(index);
    let handle_out = vertex_handle_out_paths(index);
    vec![
        (slot_key(&vertex_x_path(index)), literal(at.x)),
        (slot_key(&vertex_y_path(index)), literal(at.y)),
        (slot_key(&vertex_bulge_path(index)), literal(0.0)),
        (slot_key(&handle_in.x), literal(0.0)),
        (slot_key(&handle_in.y), literal(0.0)),
        (slot_key(&handle_out.x), literal(0.0)),
        (slot_key(&handle_out.y), literal(0.0)),
    ]
}

fn literal<A>(value: f64) -> Slot<A> {
    Slot::Literal {
        value: Value::Number(value),
    }
}

/// Appends one vertex at the end. No vertex slot moves, so no reference
/// elsewhere needs a rewrite. The new vertex gets a straight edge. No bulge
/// already on the path moves. So a curve an operator drew keeps its shape, and
/// only the edge home to vertex 0 becomes straight.
pub fn add_vertex_to_object<A: Clone>(object: &GraphObject<A>, at: Point) -> GraphObject<A> {
    let count = vertex_count_of(object);
    let mut slots = object.slots.clone();
    for (key, slot) in straight_vertex_slots(count, at) {
        slots.insert(key, slot);
    }
    GraphObject {
        vertex_count: Some(count + 1.0),
        slots,
        ..object.clone()
    }
}

/// Takes every vertex slot out of the map, so the ones written back land in
/// their new order. A slot for an index beyond the count stays where it was,
/// because the loop that removes them counts the vertices the object declares.
fn without_vertex_slots<A: Clone>(object: &GraphObject<A>) -> crate::model::SlotMap<A> {
    let mut slots = object.slots.clone();
    for index in vertex_indices(vertex_count_of(object)) {
        for at in vertex_part_paths(index) {
            slots.remove(&slot_key(&at));
        }
    }
    slots
}

/// Puts one vertex at the index after the split edge and moves every vertex at
/// or after it up one. The vertex before the new one takes the first bulge, and
/// the new one takes the second. An insert drops no vertex, so a reference only
/// ever needs a shift.
pub fn insert_vertex_into_object<A: Clone>(
    object: &GraphObject<A>,
    edge_index: f64,
    split: &EdgeSplit,
) -> GraphObject<A> {
    let insert_index = edge_index + 1.0;
    let count = vertex_count_of(object);
    let mut slots = without_vertex_slots(object);
    for index in vertex_indices(count) {
        let moved = if index < insert_index {
            index
        } else {
            index + 1.0
        };
        for suffix in VERTEX_PART_SUFFIXES {
            if let Some(slot) = object.get_slot(&vertex_part_path(index, suffix)) {
                slots.insert(slot_key(&vertex_part_path(moved, suffix)), slot.clone());
            }
        }
    }
    // A count of zero leaves this NaN, in Rust as in JavaScript, and every
    // comparison below then takes its false branch.
    let end_index = (edge_index + 1.0) % count;
    let shifted_end = if end_index >= insert_index {
        end_index + 1.0
    } else {
        end_index
    };
    let mut write = |at: Vec<String>, value: f64| {
        slots.insert(slot_key(&at), literal(value));
    };
    write(vertex_bulge_path(edge_index), split.first_bulge);
    write(
        vertex_handle_out_paths(edge_index).x,
        split.start_out_handle.x,
    );
    write(
        vertex_handle_out_paths(edge_index).y,
        split.start_out_handle.y,
    );
    write(vertex_x_path(insert_index), split.at.x);
    write(vertex_y_path(insert_index), split.at.y);
    write(vertex_bulge_path(insert_index), split.second_bulge);
    write(
        vertex_handle_in_paths(insert_index).x,
        split.new_in_handle.x,
    );
    write(
        vertex_handle_in_paths(insert_index).y,
        split.new_in_handle.y,
    );
    write(
        vertex_handle_out_paths(insert_index).x,
        split.new_out_handle.x,
    );
    write(
        vertex_handle_out_paths(insert_index).y,
        split.new_out_handle.y,
    );
    write(vertex_handle_in_paths(shifted_end).x, split.end_in_handle.x);
    write(vertex_handle_in_paths(shifted_end).y, split.end_in_handle.y);
    GraphObject {
        vertex_count: Some(count + 1.0),
        slots,
        ..object.clone()
    }
}

/// Removes one vertex and renumbers every later one down by one, in storage.
pub fn delete_vertex_from_object<A: Clone>(object: &GraphObject<A>, index: f64) -> GraphObject<A> {
    let count = vertex_count_of(object);
    let mut slots = without_vertex_slots(object);
    for held in vertex_indices(count) {
        if held == index {
            continue;
        }
        let moved = if held < index { held } else { held - 1.0 };
        for suffix in VERTEX_PART_SUFFIXES {
            if let Some(slot) = object.get_slot(&vertex_part_path(held, suffix)) {
                slots.insert(slot_key(&vertex_part_path(moved, suffix)), slot.clone());
            }
        }
    }
    GraphObject {
        vertex_count: Some(crate::number::js_max(0.0, count - 1.0)),
        slots,
        ..object.clone()
    }
}

/// Which vertex an address names, and which of the seven parts of it.
struct VertexAddress {
    index: f64,
    suffix: &'static [&'static str],
}

/// The address as a vertex part, or nothing when it names something else.
///
/// The index segment has to be the text JavaScript would print for the number
/// it holds, so `vertex.01.x` and `vertex.1.0.x` name no vertex. The
/// TypeScript states that as a round trip through `Number` and `String`, and
/// the accepted set is the same one a run of digits reaches, because every
/// other spelling either fails the round trip or fails the whole number test
/// below.
fn as_vertex_address(address: &Address, object_id: &str) -> Option<VertexAddress> {
    if address.object_id != object_id {
        return None;
    }
    let segments = &address.path;
    if segments.len() < 3 || segments[0] != VERTEX_PATH_PREFIX {
        return None;
    }
    let rest = &segments[2..];
    let suffix = VERTEX_PART_SUFFIXES.into_iter().find(|candidate| {
        candidate.len() == rest.len() && candidate.iter().zip(rest).all(|(a, b)| a == b)
    })?;
    let index_text = &segments[1];
    if index_text.is_empty() || !index_text.bytes().all(|byte| byte.is_ascii_digit()) {
        return None;
    }
    let index: f64 = index_text.parse().ok()?;
    if to_javascript_text(index) != *index_text {
        return None;
    }
    if index.fract() != 0.0 || index < 0.0 {
        return None;
    }
    Some(VertexAddress { index, suffix })
}

fn vertex_address_at(object_id: &str, index: f64, suffix: &[&str]) -> Address {
    Address {
        object_id: object_id.to_string(),
        path: vertex_part_path(index, suffix),
    }
}

/// Moves a reference to the new vertex, or to any vertex after it, up one
/// index. An insert loses no vertex, so this never breaks a reference. There is
/// no force path, unlike a delete.
pub fn shift_vertex_address_for_insert(
    address: &Address,
    object_id: &str,
    inserted_index: f64,
) -> Address {
    match as_vertex_address(address, object_id) {
        Some(found) if found.index >= inserted_index => {
            vertex_address_at(object_id, found.index + 1.0, found.suffix)
        }
        _ => address.clone(),
    }
}

/// Shifts a reference to a vertex after the deleted one down by one index. A
/// reference to the deleted vertex itself, or to an earlier one, passes through
/// unchanged. The refusal for a live reference to the exact vertex marked for
/// removal happens earlier, in the mutation layer, before this function ever
/// runs. A call that reaches this function only shifts the survivors.
pub fn shift_vertex_address_for_delete(
    address: &Address,
    object_id: &str,
    deleted_index: f64,
) -> Address {
    match as_vertex_address(address, object_id) {
        Some(found) if found.index > deleted_index => {
            vertex_address_at(object_id, found.index - 1.0, found.suffix)
        }
        _ => address.clone(),
    }
}

/// What a forced repair leaves behind: an address, or the mark that the vertex
/// it named has gone.
#[derive(Clone, Debug, PartialEq)]
pub enum VertexRepair {
    Address(Address),
    Deleted,
}

/// The force path shifts every vertex after the deleted one, the same as
/// [`shift_vertex_address_for_delete`]. It also marks a reference to the
/// deleted vertex itself, so the caller rewrites it to `#REF`.
pub fn repair_vertex_address_for_delete(
    address: &Address,
    object_id: &str,
    deleted_index: f64,
) -> VertexRepair {
    let Some(found) = as_vertex_address(address, object_id) else {
        return VertexRepair::Address(address.clone());
    };
    if found.index == deleted_index {
        return VertexRepair::Deleted;
    }
    if found.index > deleted_index {
        return VertexRepair::Address(vertex_address_at(
            object_id,
            found.index - 1.0,
            found.suffix,
        ));
    }
    VertexRepair::Address(address.clone())
}

/// A vertex address never spans a range. The formula language has no range
/// syntax for one.
pub fn pass_through_vertex_range_for_delete(start: &Address, end: &Address) -> (Address, Address) {
    (start.clone(), end.clone())
}

/// The preset types an explode accepts. A polyline is already an editable path,
/// and each of the three is a closed shape, so area survives an explode with
/// the same value.
pub const EXPLODABLE_TYPES: [ObjectType; 3] =
    [ObjectType::Circle, ObjectType::Polygon, ObjectType::Rect];

pub fn is_explodable(object_type: ObjectType) -> bool {
    EXPLODABLE_TYPES.contains(&object_type)
}

/// A snapshot that became a polyline, or the reason nothing could be taken.
pub enum ExplodeResult<A> {
    Exploded(Box<GraphObject<A>>),
    Refused(String),
}

fn polyline_derived_paths() -> Vec<Vec<String>> {
    vec![
        vertices_path(),
        path(&["centroid", "x"]),
        path(&["centroid", "y"]),
        path(&["area"]),
        path(&["length"]),
        path(&["bounds", "minX"]),
        path(&["bounds", "minY"]),
        path(&["bounds", "maxX"]),
        path(&["bounds", "maxY"]),
    ]
}

/// Snapshots a preset's current vertices into a fresh polyline object, same id
/// and name. The parameter slots, being origin, radius, sides and the rest, are
/// gone. The new path closes, because every preset it accepts is a closed
/// shape. So vertices, centroid, area, length and bounds all survive at the
/// same paths, and so does the style. A formula that reads one of them does not
/// need repair.
pub fn explode_object_to_polyline<A: Clone>(
    object: &GraphObject<A>,
    label: &str,
) -> ExplodeResult<A> {
    if object.object_type == ObjectType::Circle {
        return explode_circle_to_polyline(object, label);
    }
    let held = object.get_slot(&vertices_path()).map(Slot::value);
    match held {
        None => ExplodeResult::Refused(format!(
            "{label}: vertices did not resolve to a value, so there is nothing to snapshot"
        )),
        Some(Value::Error(failure)) => ExplodeResult::Refused(format!(
            "{label}: vertices holds an error ({}: {}), so there is nothing to snapshot",
            failure.error.as_str(),
            failure.message
        )),
        Some(Value::Points(vertices)) if !vertices.is_empty() => {
            let bulges = vec![0.0; vertices.len()];
            ExplodeResult::Exploded(Box::new(build_exploded_polyline(
                object,
                &vertices.clone(),
                &bulges,
            )))
        }
        Some(_) => ExplodeResult::Refused(format!(
            "{label}: vertices is not a point list, so there is nothing to snapshot"
        )),
    }
}

/// A circle explodes into two vertices across its diameter, joined by two half
/// circles. That path is the same circle, to the last decimal. There is no
/// point list to snapshot, because a circle carries none.
fn explode_circle_to_polyline<A: Clone>(object: &GraphObject<A>, label: &str) -> ExplodeResult<A> {
    let number = |at: Vec<String>| match object.get_slot(&at).map(Slot::value) {
        Some(Value::Number(held)) => Some(*held),
        _ => None,
    };
    let (Some(origin_x), Some(origin_y), Some(radius)) = (
        number(origin_x_path()),
        number(origin_y_path()),
        number(radius_path()),
    ) else {
        return ExplodeResult::Refused(format!(
            "{label}: origin and radius must each hold a number, so there is nothing to explode"
        ));
    };
    // A radius that is not a number fails this as well as one that is zero or
    // negative, which is what the negated comparison in the TypeScript does.
    if radius.is_nan() || radius <= 0.0 {
        return ExplodeResult::Refused(format!(
            "{label}: the radius must be more than 0, so there is nothing to explode"
        ));
    }
    let vertices = [
        Point {
            x: origin_x - radius,
            y: origin_y,
        },
        Point {
            x: origin_x + radius,
            y: origin_y,
        },
    ];
    ExplodeResult::Exploded(Box::new(build_exploded_polyline(
        object,
        &vertices,
        &[HALF_CIRCLE_BULGE, HALF_CIRCLE_BULGE],
    )))
}

fn build_exploded_polyline<A: Clone>(
    object: &GraphObject<A>,
    vertices: &[Point],
    bulges: &[f64],
) -> GraphObject<A> {
    let mut slots = crate::model::SlotMap::new();
    for (index, vertex) in vertices.iter().enumerate() {
        let at = index as f64;
        for (key, slot) in straight_vertex_slots(at, *vertex) {
            slots.insert(key, slot);
        }
        slots.insert(
            slot_key(&vertex_bulge_path(at)),
            literal(bulges.get(index).copied().unwrap_or(0.0)),
        );
    }
    slots.insert(
        slot_key(&closed_path()),
        Slot::Literal {
            value: Value::Boolean(true),
        },
    );
    // A polyline declares the style slots at the same paths a preset does, so
    // they cross an explode untouched. An operator keeps the colour they chose,
    // and a formula that drives one does not need repair.
    for at in geometry_style_paths() {
        if let Some(slot) = object.get_slot(&at) {
            slots.insert(slot_key(&at), slot.clone());
        }
    }
    for at in polyline_derived_paths() {
        slots.insert(slot_key(&at), Slot::Derived { value: Value::Null });
    }
    GraphObject {
        id: object.id.clone(),
        name: object.name.clone(),
        object_type: ObjectType::Polyline,
        target: None,
        slots,
        ports: None,
        vertex_count: Some(vertices.len() as f64),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{ObjectType, SlotMap};

    /// A polyline with three vertices, each part written, and the slots in the
    /// order a fresh path writes them.
    fn polyline(count: f64) -> GraphObject<()> {
        let mut slots = SlotMap::new();
        for index in vertex_indices(count) {
            for (key, slot) in straight_vertex_slots::<()>(index, Point { x: index, y: 0.0 }) {
                slots.insert(key, slot);
            }
        }
        GraphObject {
            id: "p1".to_string(),
            name: "path".to_string(),
            object_type: ObjectType::Polyline,
            target: None,
            slots,
            ports: None,
            vertex_count: Some(count),
        }
    }

    fn address(path: &[&str]) -> Address {
        Address {
            object_id: "p1".to_string(),
            path: path.iter().map(|part| (*part).to_string()).collect(),
        }
    }

    /// A square of side four, walked one way and then the other. The area does
    /// not follow the winding and the centroid sits at the middle either way.
    #[test]
    fn a_square_measures_the_same_wound_either_way() {
        let corners = [
            Point { x: 0.0, y: 0.0 },
            Point { x: 4.0, y: 0.0 },
            Point { x: 4.0, y: 4.0 },
            Point { x: 0.0, y: 4.0 },
        ];
        let mut backwards = corners;
        backwards.reverse();
        assert_eq!(compute_area(&corners), 16.0);
        assert_eq!(compute_area(&backwards), 16.0);
        assert_eq!(compute_centroid(&corners), Point { x: 2.0, y: 2.0 });
        assert_eq!(compute_centroid(&backwards), Point { x: 2.0, y: 2.0 });
        assert_eq!(compute_perimeter_length(&corners), 16.0);
        assert_eq!(compute_open_path_length(&corners), 12.0);
    }

    /// Points on one line enclose nothing, so the centroid falls back to the
    /// plain mean rather than dividing by an area of zero.
    #[test]
    fn a_shape_with_no_area_takes_the_mean_of_its_points() {
        let line = [
            Point { x: 0.0, y: 0.0 },
            Point { x: 1.0, y: 1.0 },
            Point { x: 2.0, y: 2.0 },
        ];
        assert_eq!(compute_area(&line), 0.0);
        assert_eq!(compute_centroid(&line), Point { x: 1.0, y: 1.0 });
    }

    /// A polygon of four sides at no rotation puts its first corner at the
    /// radius along x, and the four corners span the diameter each way.
    #[test]
    fn a_polygon_puts_its_corners_on_its_circle() {
        let corners = compute_polygon_vertices(4.0, 10.0, Point { x: 0.0, y: 0.0 }, 0.0);
        assert_eq!(corners.len(), 4);
        assert_eq!(corners[0], Point { x: 10.0, y: 0.0 });
        let bounds = compute_bounds(&corners);
        assert_eq!(bounds.min_x, -10.0);
        assert_eq!(bounds.max_x, 10.0);
    }

    /// The count is a number rather than a whole one, so a document holding two
    /// and a half vertices reaches three of them and the last is named after
    /// the number JavaScript prints.
    #[test]
    fn a_count_that_is_not_whole_reaches_the_indices_the_loop_reaches() {
        assert_eq!(vertex_indices(2.5).collect::<Vec<_>>(), vec![0.0, 1.0, 2.0]);
        assert_eq!(vertex_part_path(2.5, &["x"]), vec!["vertex", "2.5", "x"]);
        assert_eq!(vertex_part_path(10.0, &["x"]), vec!["vertex", "10", "x"]);
    }

    /// A delete takes every vertex slot out and writes the survivors back, so
    /// they come back renumbered and in order rather than staying where the old
    /// order left them.
    #[test]
    fn a_delete_renumbers_the_survivors_and_reorders_their_slots() {
        let object = polyline(3.0);
        let after = delete_vertex_from_object(&object, 1.0);
        assert_eq!(after.vertex_count, Some(2.0));
        let keys: Vec<&str> = after.slots.keys().collect();
        assert_eq!(keys[0], "vertex.0.x");
        assert_eq!(keys[7], "vertex.1.x");
        assert_eq!(keys.len(), 14);
        // Vertex 2 held an x of two and became vertex 1, so the survivor
        // carries its own coordinate rather than the one of the vertex it
        // replaced.
        assert_eq!(
            after.get_slot(&vertex_x_path(1.0)).map(Slot::value),
            Some(&Value::Number(2.0))
        );
    }

    /// An added vertex lands at the end, so no slot already on the path moves
    /// and no reference anywhere needs a rewrite.
    #[test]
    fn an_added_vertex_moves_nothing_that_was_there() {
        let object = polyline(2.0);
        let before: Vec<String> = object.slots.keys().map(str::to_string).collect();
        let after = add_vertex_to_object(&object, Point { x: 9.0, y: 9.0 });
        let keys: Vec<String> = after.slots.keys().map(str::to_string).collect();
        assert_eq!(after.vertex_count, Some(3.0));
        assert_eq!(&keys[..before.len()], &before[..]);
        assert_eq!(
            after.get_slot(&vertex_x_path(2.0)).map(Slot::value),
            Some(&Value::Number(9.0))
        );
    }

    /// A reference to a vertex after the one that went moves down an index, and
    /// a reference to the vertex itself is marked so the caller can turn it into
    /// a reference error.
    #[test]
    fn a_delete_shifts_the_survivors_and_marks_the_vertex_that_went() {
        let held = address(&["vertex", "2", "bulge"]);
        assert_eq!(
            shift_vertex_address_for_delete(&held, "p1", 1.0).path,
            vec!["vertex", "1", "bulge"]
        );
        assert_eq!(
            repair_vertex_address_for_delete(&address(&["vertex", "1", "x"]), "p1", 1.0),
            VertexRepair::Deleted
        );
        assert_eq!(
            repair_vertex_address_for_delete(&address(&["vertex", "0", "x"]), "p1", 1.0),
            VertexRepair::Address(address(&["vertex", "0", "x"]))
        );
    }

    /// An insert loses no vertex, so a reference only ever shifts up, and one
    /// to an earlier vertex passes through.
    #[test]
    fn an_insert_only_ever_shifts_a_reference_up() {
        assert_eq!(
            shift_vertex_address_for_insert(&address(&["vertex", "1", "x"]), "p1", 1.0).path,
            vec!["vertex", "2", "x"]
        );
        assert_eq!(
            shift_vertex_address_for_insert(&address(&["vertex", "0", "x"]), "p1", 1.0).path,
            vec!["vertex", "0", "x"]
        );
    }

    /// An index segment has to be the text JavaScript prints for the number it
    /// holds, so a padded one, a decimal one and an exponent one name no vertex
    /// and pass through every rewrite untouched.
    #[test]
    fn only_a_canonical_index_names_a_vertex() {
        for spelling in ["01", "1.0", "1e2", "-1", "", " 1", "0x1"] {
            let held = address(&["vertex", spelling, "x"]);
            assert_eq!(
                shift_vertex_address_for_delete(&held, "p1", 0.0),
                held,
                "the index \"{spelling}\" names no vertex"
            );
        }
        // A reference belonging to another object is left alone as well.
        let elsewhere = Address {
            object_id: "p2".to_string(),
            path: vertex_x_path(2.0),
        };
        assert_eq!(
            shift_vertex_address_for_delete(&elsewhere, "p1", 0.0),
            elsewhere
        );
    }

    /// A circle explodes into two vertices across its diameter joined by two
    /// half circles, which is the same circle rather than an approximation of
    /// one.
    #[test]
    fn a_circle_explodes_into_the_same_circle() {
        let mut slots = SlotMap::new();
        slots.insert(slot_key(&origin_x_path()), literal::<()>(4.0));
        slots.insert(slot_key(&origin_y_path()), literal(-2.0));
        slots.insert(slot_key(&radius_path()), literal(3.0));
        let circle = GraphObject {
            id: "c1".to_string(),
            name: "wheel".to_string(),
            object_type: ObjectType::Circle,
            target: None,
            slots,
            ports: None,
            vertex_count: None,
        };
        let ExplodeResult::Exploded(exploded) = explode_object_to_polyline(&circle, "shape") else {
            panic!("a circle with a radius explodes");
        };
        assert_eq!(exploded.object_type, ObjectType::Polyline);
        assert_eq!(exploded.vertex_count, Some(2.0));
        let edges = {
            let mut with_points = *exploded.clone();
            with_points.slots.insert(
                slot_key(&vertices_path()),
                Slot::Literal {
                    value: Value::Points(vec![
                        Point { x: 1.0, y: -2.0 },
                        Point { x: 7.0, y: -2.0 },
                    ]),
                },
            );
            path_edges_of_object(&with_points)
        };
        assert_eq!(edges.len(), 2);
        // The area comes within a part in 10^15 of pi times nine rather than
        // landing on it. A lune contributes r squared times the sweep less its
        // sine, and the sine of a sweep of pi is 1.2e-16 rather than 0, because
        // pi itself is not a double. The residue rounds away at some radii and
        // shifts the last digit at others, so the test states the size of it.
        let area = crate::primitives::edge::path_area(&edges);
        let exact = std::f64::consts::PI * 9.0;
        assert!(
            ((area - exact) / exact).abs() < 1e-15,
            "the exploded circle measures {area} against {exact}"
        );
    }

    /// Only the three closed presets explode. A polyline is already an editable
    /// path, and a text object has no vertices to snapshot.
    #[test]
    fn three_presets_explode_and_the_rest_do_not() {
        assert!(is_explodable(ObjectType::Circle));
        assert!(is_explodable(ObjectType::Polygon));
        assert!(is_explodable(ObjectType::Rect));
        assert!(!is_explodable(ObjectType::Polyline));
        assert!(!is_explodable(ObjectType::Text));
    }
}
