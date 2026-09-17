//! The maths of a single path edge, which is a straight line, a circular arc,
//! or a cubic bezier. Two control points make it a bezier. With none of those,
//! a bulge makes it an arc: the bulge is the tangent of a quarter of the
//! included angle, the same number a DXF vertex record carries, so 0 draws a
//! straight line and 1 draws a half circle.
//!
//! Nothing in this file turns a curve into sample points, so the vertices of a
//! shape never grow a point an operator did not place. The circle built from
//! two vertices and two bulges of 1 is the case that proves it.
//!
//! An arc answers every question in closed form. A bezier answers its area, its
//! centroid and its bounding box in closed form too: those integrands are
//! polynomials of degree eight or less, and the five point Gauss-Legendre rule
//! in `integrate_over_curve` is exact up to degree nine, so those are answers
//! rather than estimates. Two questions about a bezier have no closed form for
//! anyone. `bezier_length` halves the curve until its control polygon and its
//! chord agree, and `nearest_fraction_on_bezier` scans the curve coarsely and
//! then narrows the best bracket. Both return a number, and neither one adds a
//! vertex.
//!
//! Every call into a transcendental function goes through a wrapper in
//! [`crate::number`] rather than through the `f64` method, because the method a
//! native build reaches and the one a `wasm32-unknown-unknown` build reaches
//! answer differently. `D-012` in `docs/RUST_PORT.md` holds which of the
//! wrappers also agree with the answers a document carries.
//!
//! The port of `src/engine/primitives/edge.ts`, which the module header of that
//! file describes at greater length.

use crate::model::Point;
use crate::number::{
    js_atan, js_atan2, js_cos, js_hypot, js_max, js_min, js_pow, js_sign, js_sin, js_sqrt, js_tan,
};

/// An edge joins two points of a path. Two control points make it a cubic
/// bezier. With none, a bulge of 0 makes it a straight line and any other
/// bulge makes it an arc.
#[derive(Clone, Debug, PartialEq)]
pub struct PathEdge {
    pub start: Point,
    pub end: Point,
    pub bulge: f64,
    pub controls: Option<[Point; 2]>,
}

/// One cubic, as its four control points. The first and last are the two ends
/// of the edge.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct CubicBezier {
    pub p0: Point,
    pub p1: Point,
    pub p2: Point,
    pub p3: Point,
}

/// The circle a curved edge rides on. A straight edge has none.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ArcGeometry {
    pub center: Point,
    pub radius: f64,
    pub start_angle: f64,
    /// Signed. The arc turns one way at a positive sweep, the other way at a
    /// negative one.
    pub sweep: f64,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct PathBounds {
    pub min_x: f64,
    pub min_y: f64,
    pub max_x: f64,
    pub max_y: f64,
}

/// The bulge of a half circle. Two of these make one full circle from two
/// vertices.
pub const HALF_CIRCLE_BULGE: f64 = 1.0;

const FULL_TURN: f64 = 2.0 * std::f64::consts::PI;

const CARDINAL_ANGLES: [f64; 4] = [
    0.0,
    std::f64::consts::FRAC_PI_2,
    std::f64::consts::PI,
    3.0 * std::f64::consts::FRAC_PI_2,
];

/// How close a control polygon comes to its chord before a length holds still.
const BEZIER_LENGTH_TOLERANCE: f64 = 1e-10;

const BEZIER_LENGTH_MAX_DEPTH: u32 = 24;

/// The coarse scan a nearest point search starts from, before it narrows.
const BEZIER_SCAN_STEPS: u32 = 24;

const BEZIER_NARROW_STEPS: u32 = 60;

/// How many times bisection halves a bracket before it takes the middle.
const ROOT_STEPS: u32 = 60;

/// The bulge of a quarter turn. A straight edge takes it when it becomes an arc.
pub fn quarter_turn_bulge() -> f64 {
    js_tan(std::f64::consts::FRAC_PI_8)
}

fn point(x: f64, y: f64) -> Point {
    Point { x, y }
}

/// The circle under a curved edge, from its two endpoints and its bulge. It
/// answers `None` for a straight edge, for an edge with no length, and for a
/// bezier, because control points win over a bulge.
pub fn arc_of_edge(edge: &PathEdge) -> Option<ArcGeometry> {
    if bezier_of_edge(edge).is_some() {
        return None;
    }
    if !edge.bulge.is_finite() || edge.bulge == 0.0 {
        return None;
    }
    let chord_x = edge.end.x - edge.start.x;
    let chord_y = edge.end.y - edge.start.y;
    let chord = js_hypot(chord_x, chord_y);
    if chord == 0.0 {
        return None;
    }
    let sweep = 4.0 * js_atan(edge.bulge);
    let half_sweep = sweep / 2.0;
    let sine = js_sin(half_sweep).abs();
    if sine == 0.0 {
        return None;
    }
    let radius = chord / (2.0 * sine);
    // The centre sits on the perpendicular bisector of the chord. The sign of
    // the sweep puts it on the correct side, for a minor arc and a major one.
    let offset = js_sign(sweep) * radius * js_cos(half_sweep);
    let center = point(
        (edge.start.x + edge.end.x) / 2.0 - (chord_y / chord) * offset,
        (edge.start.y + edge.end.y) / 2.0 + (chord_x / chord) * offset,
    );
    let start_angle = js_atan2(edge.start.y - center.y, edge.start.x - center.x);
    Some(ArcGeometry {
        center,
        radius,
        start_angle,
        sweep,
    })
}

/// True when the arc passes this angle between its start and its end.
pub fn sweep_covers_angle(arc: &ArcGeometry, angle: f64) -> bool {
    let mut delta = (angle - arc.start_angle) % FULL_TURN;
    if delta < 0.0 {
        delta += FULL_TURN;
    }
    if arc.sweep >= 0.0 {
        delta <= arc.sweep
    } else {
        delta - FULL_TURN >= arc.sweep
    }
}

/// The direction a path travels as it leaves the end of an edge.
///
/// A straight edge leaves along its chord. An arc leaves along the chord turned
/// by half its sweep. A cubic leaves along its last control leg. The result has
/// no set length, because every caller reads an angle from it.
pub fn edge_end_direction(edge: &PathEdge) -> Point {
    let chord = point(edge.end.x - edge.start.x, edge.end.y - edge.start.y);
    if let Some(bezier) = bezier_of_edge(edge) {
        return last_non_zero_leg(&bezier, chord);
    }
    match arc_of_edge(edge) {
        None => chord,
        Some(arc) => turn_by(chord, arc.sweep / 2.0),
    }
}

/// The two handles that draw one edge as a cubic.
///
/// A cubic gives back the handles it already holds. A straight edge gives the
/// handles that draw the same straight line: one third of the chord at each
/// end. So the shape does not move. An arc gives the classic approximation,
/// which is four thirds of the bulge times the radius, along the tangent at
/// each end.
///
/// A cubic cannot hold a circular arc exactly. The approximation is very close
/// for a quarter turn and looser as the sweep grows. So this conversion moves
/// the shape of a long arc a little.
pub fn cubic_handles_for_edge(edge: &PathEdge) -> EdgeHandles {
    if let Some(bezier) = bezier_of_edge(edge) {
        return handles(
            point(bezier.p1.x - bezier.p0.x, bezier.p1.y - bezier.p0.y),
            point(bezier.p2.x - bezier.p3.x, bezier.p2.y - bezier.p3.y),
        );
    }
    let chord_x = edge.end.x - edge.start.x;
    let chord_y = edge.end.y - edge.start.y;
    let Some(arc) = arc_of_edge(edge) else {
        return handles(
            point(chord_x / 3.0, chord_y / 3.0),
            point(-chord_x / 3.0, -chord_y / 3.0),
        );
    };
    let reach = (4.0 / 3.0) * arc.radius * js_tan(arc.sweep / 4.0).abs();
    let start_tangent = unit(turn_by(point(chord_x, chord_y), -arc.sweep / 2.0));
    let end_tangent = unit(turn_by(point(chord_x, chord_y), arc.sweep / 2.0));
    handles(
        point(start_tangent.x * reach, start_tangent.y * reach),
        point(-end_tangent.x * reach, -end_tangent.y * reach),
    )
}

/// The handle leaving one end of an edge and the handle arriving at the other.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct EdgeHandles {
    pub out: Point,
    pub into: Point,
}

/// The pair, with every negative zero turned back into zero. A negative zero
/// reaches a slot from any subtraction of equals, and the mutation rules refuse
/// one as illegal document state.
fn handles(out: Point, into: Point) -> EdgeHandles {
    let plain = |value: f64| if value == 0.0 { 0.0 } else { value };
    EdgeHandles {
        out: point(plain(out.x), plain(out.y)),
        into: point(plain(into.x), plain(into.y)),
    }
}

fn unit(vector: Point) -> Point {
    let length = js_hypot(vector.x, vector.y);
    if length == 0.0 {
        point(0.0, 0.0)
    } else {
        point(vector.x / length, vector.y / length)
    }
}

/// The point halfway along an edge.
///
/// A straight edge answers with the middle of its chord. An arc answers with
/// the point at half its sweep, and a cubic with the point at t of one half. A
/// grip appears at that point, so a drag on it bends the edge.
pub fn edge_midpoint(edge: &PathEdge) -> Point {
    if let Some(bezier) = bezier_of_edge(edge) {
        return bezier_point_at(&bezier, 0.5);
    }
    let chord_mid = point(
        (edge.start.x + edge.end.x) / 2.0,
        (edge.start.y + edge.end.y) / 2.0,
    );
    let Some(arc) = arc_of_edge(edge) else {
        return chord_mid;
    };
    let angle = arc.start_angle + arc.sweep / 2.0;
    point(
        arc.center.x + arc.radius * js_cos(angle),
        arc.center.y + arc.radius * js_sin(angle),
    )
}

/// The bulge of the arc through three points: two ends and one point in
/// between.
///
/// The sagitta of an arc is r minus r times the cosine of half the sweep. The
/// half chord is r times the sine of that same angle. The quotient of the two
/// is the tangent of a quarter of the sweep, which is the bulge itself. So a
/// drag on the middle grip writes an exact bulge, and no search runs.
///
/// The sign follows the same side [`arc_of_edge`] puts its centre on.
pub fn bulge_for_midpoint(start: Point, end: Point, midpoint: Point) -> f64 {
    let chord_x = end.x - start.x;
    let chord_y = end.y - start.y;
    let chord = js_hypot(chord_x, chord_y);
    if chord == 0.0 {
        return 0.0;
    }
    let away_x = midpoint.x - (start.x + end.x) / 2.0;
    let away_y = midpoint.y - (start.y + end.y) / 2.0;
    let sagitta = (away_x * chord_y - away_y * chord_x) / chord;
    sagitta / (chord / 2.0)
}

/// The bulge of the arc that starts at one point, ends at another, and leaves
/// the start along a direction the caller gives.
///
/// The tangent chord angle of a circle is half the included angle. So the
/// signed angle from the direction to the chord is a quarter turn of the arc.
/// The tangent of that quarter turn is the bulge a DXF vertex record carries.
///
/// Two inputs have no arc. A chord of no length is one. A chord that points
/// straight back along the direction is the other, because that arc closes a
/// full circle and never arrives. Each one gives 0, which draws a straight
/// edge.
pub fn bulge_for_tangent_arc(start: Point, end: Point, direction: Point) -> f64 {
    let chord_x = end.x - start.x;
    let chord_y = end.y - start.y;
    let cross = direction.x * chord_y - direction.y * chord_x;
    let dot = direction.x * chord_x + direction.y * chord_y;
    if cross == 0.0 && dot <= 0.0 {
        return 0.0;
    }
    let bulge = js_tan(js_atan2(cross, dot) / 2.0);
    if bulge.is_finite() { bulge } else { 0.0 }
}

fn turn_by(vector: Point, angle: f64) -> Point {
    let cosine = js_cos(angle);
    let sine = js_sin(angle);
    point(
        vector.x * cosine - vector.y * sine,
        vector.x * sine + vector.y * cosine,
    )
}

/// The last leg of a control polygon that has a length, or the chord.
fn last_non_zero_leg(curve: &CubicBezier, chord: Point) -> Point {
    let legs = [
        point(curve.p3.x - curve.p2.x, curve.p3.y - curve.p2.y),
        point(curve.p3.x - curve.p1.x, curve.p3.y - curve.p1.y),
    ];
    legs.into_iter()
        .find(|leg| leg.x != 0.0 || leg.y != 0.0)
        .unwrap_or(chord)
}

/// Five point Gauss-Legendre, mapped onto 0 to 1. A rule with five nodes
/// integrates a polynomial of degree nine exactly. Every area and moment
/// integrand of a cubic is degree eight or less, so these answers are exact
/// and not estimates.
const GAUSS_NODES: [f64; 5] = [
    0.5 - 0.5 * 0.906_179_845_938_664,
    0.5 - 0.5 * 0.538_469_310_105_683_1,
    0.5,
    0.5 + 0.5 * 0.538_469_310_105_683_1,
    0.5 + 0.5 * 0.906_179_845_938_664,
];

const GAUSS_WEIGHTS: [f64; 5] = [
    0.5 * 0.236_926_885_056_189_08,
    0.5 * 0.478_628_670_499_366_47,
    0.5 * 0.568_888_888_888_888_9,
    0.5 * 0.478_628_670_499_366_47,
    0.5 * 0.236_926_885_056_189_08,
];

/// The cubic under an edge, or `None` for an edge with no control points.
pub fn bezier_of_edge(edge: &PathEdge) -> Option<CubicBezier> {
    let [p1, p2] = edge.controls?;
    if !is_finite_point(p1) || !is_finite_point(p2) {
        return None;
    }
    Some(CubicBezier {
        p0: edge.start,
        p1,
        p2,
        p3: edge.end,
    })
}

fn is_finite_point(at: Point) -> bool {
    at.x.is_finite() && at.y.is_finite()
}

/// The straight edge from start to end, written as a cubic. It lets one
/// integrator serve both.
fn chord_as_cubic(start: Point, end: Point) -> CubicBezier {
    let span_x = end.x - start.x;
    let span_y = end.y - start.y;
    CubicBezier {
        p0: start,
        p1: point(start.x + span_x / 3.0, start.y + span_y / 3.0),
        p2: point(
            start.x + (2.0 * span_x) / 3.0,
            start.y + (2.0 * span_y) / 3.0,
        ),
        p3: end,
    }
}

pub fn bezier_point_at(curve: &CubicBezier, t: f64) -> Point {
    let u = 1.0 - t;
    let a = u * u * u;
    let b = 3.0 * u * u * t;
    let c = 3.0 * u * t * t;
    let d = t * t * t;
    point(
        a * curve.p0.x + b * curve.p1.x + c * curve.p2.x + d * curve.p3.x,
        a * curve.p0.y + b * curve.p1.y + c * curve.p2.y + d * curve.p3.y,
    )
}

/// The first derivative, which the area and moment integrands need.
fn bezier_slope_at(curve: &CubicBezier, t: f64) -> Point {
    let u = 1.0 - t;
    let a = 3.0 * u * u;
    let b = 6.0 * u * t;
    let c = 3.0 * t * t;
    point(
        a * (curve.p1.x - curve.p0.x)
            + b * (curve.p2.x - curve.p1.x)
            + c * (curve.p3.x - curve.p2.x),
        a * (curve.p1.y - curve.p0.y)
            + b * (curve.p2.y - curve.p1.y)
            + c * (curve.p3.y - curve.p2.y),
    )
}

fn integrate_over_curve(curve: &CubicBezier, integrand: impl Fn(Point, Point) -> f64) -> f64 {
    let mut total = 0.0;
    for index in 0..GAUSS_NODES.len() {
        let t = GAUSS_NODES[index];
        total +=
            GAUSS_WEIGHTS[index] * integrand(bezier_point_at(curve, t), bezier_slope_at(curve, t));
    }
    total
}

/// Twice the signed area a curve sweeps about the origin. Green's theorem, one
/// edge at a time.
fn curve_doubled_swept_area(curve: &CubicBezier) -> f64 {
    integrate_over_curve(curve, |at, slope| at.x * slope.y - at.y * slope.x)
}

fn curve_moment_x(curve: &CubicBezier) -> f64 {
    integrate_over_curve(curve, |at, slope| at.x * at.x * slope.y)
}

fn curve_moment_y(curve: &CubicBezier) -> f64 {
    -integrate_over_curve(curve, |at, slope| at.y * at.y * slope.x)
}

/// The two halves of a curve, split by De Casteljau. Together they hold the
/// shape of the curve they replace, exactly.
pub fn split_bezier(curve: &CubicBezier, t: f64) -> (CubicBezier, CubicBezier) {
    let a = mix(curve.p0, curve.p1, t);
    let b = mix(curve.p1, curve.p2, t);
    let c = mix(curve.p2, curve.p3, t);
    let d = mix(a, b, t);
    let e = mix(b, c, t);
    let f = mix(d, e, t);
    (
        CubicBezier {
            p0: curve.p0,
            p1: a,
            p2: d,
            p3: f,
        },
        CubicBezier {
            p0: f,
            p1: e,
            p2: c,
            p3: curve.p3,
        },
    )
}

fn mix(from: Point, to: Point, t: f64) -> Point {
    point(from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t)
}

/// A cubic has no closed form for its length, for anybody. This halves the
/// curve until its control polygon and its chord agree, then takes the mean of
/// the two. It returns one number and does not add a vertex.
fn bezier_length(curve: &CubicBezier, depth: u32) -> f64 {
    let chord = js_hypot(curve.p3.x - curve.p0.x, curve.p3.y - curve.p0.y);
    let polygon = js_hypot(curve.p1.x - curve.p0.x, curve.p1.y - curve.p0.y)
        + js_hypot(curve.p2.x - curve.p1.x, curve.p2.y - curve.p1.y)
        + js_hypot(curve.p3.x - curve.p2.x, curve.p3.y - curve.p2.y);
    if depth >= BEZIER_LENGTH_MAX_DEPTH
        || polygon - chord <= BEZIER_LENGTH_TOLERANCE * js_max(1.0, polygon)
    {
        return (chord + polygon) / 2.0;
    }
    let (first, second) = split_bezier(curve, 0.5);
    bezier_length(&first, depth + 1) + bezier_length(&second, depth + 1)
}

/// The values of t inside the edge where one axis of a cubic turns around.
fn turning_points(v0: f64, v1: f64, v2: f64, v3: f64) -> Vec<f64> {
    let a = 3.0 * (-v0 + 3.0 * v1 - 3.0 * v2 + v3);
    let b = 6.0 * (v0 - 2.0 * v1 + v2);
    let c = 3.0 * (v1 - v0);
    let inside = |t: f64| t > 0.0 && t < 1.0;
    if a == 0.0 {
        if b == 0.0 {
            return Vec::new();
        }
        let single = -c / b;
        return if inside(single) {
            vec![single]
        } else {
            Vec::new()
        };
    }
    let discriminant = b * b - 4.0 * a * c;
    if discriminant < 0.0 {
        return Vec::new();
    }
    let root = js_sqrt(discriminant);
    [(-b + root) / (2.0 * a), (-b - root) / (2.0 * a)]
        .into_iter()
        .filter(|t| inside(*t))
        .collect()
}

/// The value of t on a cubic nearest a point. It scans the curve coarsely, then
/// narrows the best bracket. There is no closed form. It returns one number.
fn nearest_fraction_on_bezier(curve: &CubicBezier, at: Point) -> f64 {
    let distance_at = |t: f64| {
        let on = bezier_point_at(curve, t);
        js_hypot(on.x - at.x, on.y - at.y)
    };
    let mut best = 0.0;
    let mut best_distance = f64::INFINITY;
    for step in 0..=BEZIER_SCAN_STEPS {
        let t = f64::from(step) / f64::from(BEZIER_SCAN_STEPS);
        let distance = distance_at(t);
        if distance < best_distance {
            best_distance = distance;
            best = t;
        }
    }
    let mut low = js_max(0.0, best - 1.0 / f64::from(BEZIER_SCAN_STEPS));
    let mut high = js_min(1.0, best + 1.0 / f64::from(BEZIER_SCAN_STEPS));
    for _ in 0..BEZIER_NARROW_STEPS {
        let third = (high - low) / 3.0;
        let left = low + third;
        let right = high - third;
        if distance_at(left) <= distance_at(right) {
            high = right;
        } else {
            low = left;
        }
    }
    (low + high) / 2.0
}

/// The exact length of one edge. An arc gives radius times angle, not a sum of
/// chords.
pub fn edge_length(edge: &PathEdge) -> f64 {
    if let Some(curve) = bezier_of_edge(edge) {
        return bezier_length(&curve, 0);
    }
    match arc_of_edge(edge) {
        None => js_hypot(edge.end.x - edge.start.x, edge.end.y - edge.start.y),
        Some(arc) => (arc.radius * arc.sweep).abs(),
    }
}

/// The doubled area between the chord and the arc. A shoelace over the chords
/// gives the rest of the shape. A straight edge adds nothing here.
pub fn edge_doubled_area_over_chord(edge: &PathEdge) -> f64 {
    if let Some(curve) = bezier_of_edge(edge) {
        return curve_doubled_swept_area(&curve)
            - curve_doubled_swept_area(&chord_as_cubic(edge.start, edge.end));
    }
    match arc_of_edge(edge) {
        None => 0.0,
        Some(arc) => arc.radius * arc.radius * (arc.sweep - js_sin(arc.sweep)),
    }
}

/// The centroid of the piece between the chord and the arc, with its doubled
/// area.
struct LuneMoment {
    at: Point,
    doubled_area: f64,
}

fn edge_lune_moment(edge: &PathEdge) -> Option<LuneMoment> {
    if let Some(curve) = bezier_of_edge(edge) {
        let chord = chord_as_cubic(edge.start, edge.end);
        let doubled_area = curve_doubled_swept_area(&curve) - curve_doubled_swept_area(&chord);
        if doubled_area == 0.0 {
            return None;
        }
        return Some(LuneMoment {
            at: point(
                (curve_moment_x(&curve) - curve_moment_x(&chord)) / doubled_area,
                (curve_moment_y(&curve) - curve_moment_y(&chord)) / doubled_area,
            ),
            doubled_area,
        });
    }
    let arc = arc_of_edge(edge)?;
    let doubled_area = arc.radius * arc.radius * (arc.sweep - js_sin(arc.sweep));
    if doubled_area == 0.0 {
        return None;
    }
    let half_sweep = arc.sweep / 2.0;
    // The exponent goes through `js_pow` rather than three multiplications,
    // because the `**` operator the TypeScript writes is `Math.pow` and the two
    // part for about a quarter of arguments.
    let distance = (4.0 * arc.radius * js_pow(js_sin(half_sweep), 3.0))
        / (3.0 * (arc.sweep - js_sin(arc.sweep)));
    let middle_angle = arc.start_angle + half_sweep;
    Some(LuneMoment {
        at: point(
            arc.center.x + js_cos(middle_angle) * distance,
            arc.center.y + js_sin(middle_angle) * distance,
        ),
        doubled_area,
    })
}

/// Every point one edge contributes to a bounding box: its two ends, plus each
/// quarter point of the circle the arc actually reaches. It is exact.
pub fn edge_extreme_points(edge: &PathEdge) -> Vec<Point> {
    if let Some(curve) = bezier_of_edge(edge) {
        let mut points = vec![edge.start, edge.end];
        for t in turning_points(curve.p0.x, curve.p1.x, curve.p2.x, curve.p3.x) {
            points.push(bezier_point_at(&curve, t));
        }
        for t in turning_points(curve.p0.y, curve.p1.y, curve.p2.y, curve.p3.y) {
            points.push(bezier_point_at(&curve, t));
        }
        return points;
    }
    let Some(arc) = arc_of_edge(edge) else {
        return vec![edge.start, edge.end];
    };
    let mut points = vec![edge.start, edge.end];
    for angle in CARDINAL_ANGLES {
        if sweep_covers_angle(&arc, angle) {
            points.push(point(
                arc.center.x + js_cos(angle) * arc.radius,
                arc.center.y + js_sin(angle) * arc.radius,
            ));
        }
    }
    points
}

/// The distance from a point to a straight edge.
pub fn distance_to_segment(at: Point, start: Point, end: Point) -> f64 {
    let span_x = end.x - start.x;
    let span_y = end.y - start.y;
    let length_squared = span_x * span_x + span_y * span_y;
    if length_squared == 0.0 {
        return js_hypot(at.x - start.x, at.y - start.y);
    }
    let along = js_max(
        0.0,
        js_min(
            1.0,
            ((at.x - start.x) * span_x + (at.y - start.y) * span_y) / length_squared,
        ),
    );
    js_hypot(
        at.x - (start.x + along * span_x),
        at.y - (start.y + along * span_y),
    )
}

/// The distance from a point to one edge. It measures to the true arc, not to a
/// chord.
pub fn distance_to_edge(at: Point, edge: &PathEdge) -> f64 {
    if let Some(curve) = bezier_of_edge(edge) {
        let on = bezier_point_at(&curve, nearest_fraction_on_bezier(&curve, at));
        return js_hypot(on.x - at.x, on.y - at.y);
    }
    let Some(arc) = arc_of_edge(edge) else {
        return distance_to_segment(at, edge.start, edge.end);
    };
    let angle = js_atan2(at.y - arc.center.y, at.x - arc.center.x);
    if sweep_covers_angle(&arc, angle) {
        return (js_hypot(at.x - arc.center.x, at.y - arc.center.y) - arc.radius).abs();
    }
    js_min(
        js_hypot(at.x - edge.start.x, at.y - edge.start.y),
        js_hypot(at.x - edge.end.x, at.y - edge.end.y),
    )
}

/// The edges of a path. Edge i leaves vertex i and carries the bulge of vertex
/// i. A closed path has one edge for each vertex. An open path has one fewer,
/// and the bulge of the last vertex waits, unused, until the path closes.
pub fn build_path_edges(
    vertices: &[Point],
    bulges: &[f64],
    closed: bool,
    handles_in: &[Point],
    handles_out: &[Point],
) -> Vec<PathEdge> {
    let mut edges = Vec::new();
    if vertices.is_empty() {
        return edges;
    }
    let edge_count = if closed {
        vertices.len()
    } else {
        vertices.len() - 1
    };
    for index in 0..edge_count {
        let end_index = (index + 1) % vertices.len();
        let start = vertices[index];
        let end = vertices[end_index];
        let bulge = bulges.get(index).copied().unwrap_or(0.0);
        let controls = controls_from_handles(
            start,
            end,
            handles_out.get(index).copied(),
            handles_in.get(end_index).copied(),
        );
        edges.push(PathEdge {
            start,
            end,
            bulge,
            controls,
        });
    }
    edges
}

/// The two control points of one edge, or `None` when neither end pulls it.
/// A handle is an offset from its own vertex, so a vertex carries its handles
/// when it moves. Two zero handles leave the edge to its bulge.
fn controls_from_handles(
    start: Point,
    end: Point,
    out: Option<Point>,
    into: Option<Point>,
) -> Option<[Point; 2]> {
    let out_x = out.map_or(0.0, |at| at.x);
    let out_y = out.map_or(0.0, |at| at.y);
    let in_x = into.map_or(0.0, |at| at.x);
    let in_y = into.map_or(0.0, |at| at.y);
    if out_x == 0.0 && out_y == 0.0 && in_x == 0.0 && in_y == 0.0 {
        return None;
    }
    Some([
        point(start.x + out_x, start.y + out_y),
        point(end.x + in_x, end.y + in_y),
    ])
}

pub fn path_length(edges: &[PathEdge]) -> f64 {
    let mut total = 0.0;
    for edge in edges {
        total += edge_length(edge);
    }
    total
}

/// The signed area, doubled. A shoelace over the chords, plus one lune for each
/// arc.
pub fn path_doubled_signed_area(edges: &[PathEdge]) -> f64 {
    let mut total = 0.0;
    for edge in edges {
        total += edge.start.x * edge.end.y - edge.end.x * edge.start.y;
        total += edge_doubled_area_over_chord(edge);
    }
    total
}

pub fn path_area(edges: &[PathEdge]) -> f64 {
    path_doubled_signed_area(edges).abs() / 2.0
}

/// The area weighted centroid, arcs included. It adds the moment of the chord
/// polygon to the moment of each lune, then divides by the total area.
pub fn path_centroid(edges: &[PathEdge]) -> Point {
    let mut chord_doubled_area = 0.0;
    let mut chord_moment_x = 0.0;
    let mut chord_moment_y = 0.0;
    let mut lune_doubled_area = 0.0;
    let mut lune_moment_x = 0.0;
    let mut lune_moment_y = 0.0;
    for edge in edges {
        let cross = edge.start.x * edge.end.y - edge.end.x * edge.start.y;
        chord_doubled_area += cross;
        chord_moment_x += (edge.start.x + edge.end.x) * cross;
        chord_moment_y += (edge.start.y + edge.end.y) * cross;
        if let Some(lune) = edge_lune_moment(edge) {
            lune_doubled_area += lune.doubled_area;
            lune_moment_x += lune.doubled_area * lune.at.x;
            lune_moment_y += lune.doubled_area * lune.at.y;
        }
    }
    let total = chord_doubled_area + lune_doubled_area;
    if total == 0.0 {
        return mean_of_ends(edges);
    }
    point(
        (chord_moment_x / 3.0 + lune_moment_x) / total,
        (chord_moment_y / 3.0 + lune_moment_y) / total,
    )
}

fn mean_of_ends(edges: &[PathEdge]) -> Point {
    if edges.is_empty() {
        return point(0.0, 0.0);
    }
    let mut sum_x = 0.0;
    let mut sum_y = 0.0;
    for edge in edges {
        sum_x += edge.start.x;
        sum_y += edge.start.y;
    }
    let count = edges.len() as f64;
    point(sum_x / count, sum_y / count)
}

pub fn path_bounds(edges: &[PathEdge]) -> PathBounds {
    let mut min_x = f64::INFINITY;
    let mut min_y = f64::INFINITY;
    let mut max_x = f64::NEG_INFINITY;
    let mut max_y = f64::NEG_INFINITY;
    for edge in edges {
        for at in edge_extreme_points(edge) {
            min_x = js_min(min_x, at.x);
            min_y = js_min(min_y, at.y);
            max_x = js_max(max_x, at.x);
            max_y = js_max(max_y, at.y);
        }
    }
    if !min_x.is_finite() {
        return PathBounds {
            min_x: 0.0,
            min_y: 0.0,
            max_x: 0.0,
            max_y: 0.0,
        };
    }
    PathBounds {
        min_x,
        min_y,
        max_x,
        max_y,
    }
}

/// Where a split lands on one edge, and every slot the split rewrites.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct EdgeSplit {
    pub at: Point,
    /// How far along the edge the split lands, from 0 at the start to 1 at the
    /// end.
    pub fraction: f64,
    pub first_bulge: f64,
    pub second_bulge: f64,
    /// The four handles. Each one is zero when the edge is straight or an arc.
    pub start_out_handle: Point,
    pub new_in_handle: Point,
    pub new_out_handle: Point,
    pub end_in_handle: Point,
}

const NO_HANDLE: Point = Point { x: 0.0, y: 0.0 };

/// How far along the arc an angle lands, clamped to the two ends of the sweep.
fn fraction_along_arc(arc: &ArcGeometry, angle: f64) -> f64 {
    let mut delta = (angle - arc.start_angle) % FULL_TURN;
    if delta < 0.0 {
        delta += FULL_TURN;
    }
    if arc.sweep == 0.0 {
        return 0.0;
    }
    let signed = if arc.sweep > 0.0 {
        delta
    } else if delta == 0.0 {
        0.0
    } else {
        delta - FULL_TURN
    };
    js_max(0.0, js_min(1.0, signed / arc.sweep))
}

/// Cuts one edge at the point on it nearest the given point. An arc becomes two
/// arcs on the same circle, so the two together hold the shape of the one they
/// replace. Nothing here subdivides an edge evenly. The caller picks the place.
pub fn split_edge_at(edge: &PathEdge, near: Point) -> EdgeSplit {
    if let Some(curve) = bezier_of_edge(edge) {
        let fraction = nearest_fraction_on_bezier(&curve, near);
        let (first, second) = split_bezier(&curve, fraction);
        let at = first.p3;
        return EdgeSplit {
            at,
            fraction,
            first_bulge: 0.0,
            second_bulge: 0.0,
            start_out_handle: point(first.p1.x - edge.start.x, first.p1.y - edge.start.y),
            new_in_handle: point(first.p2.x - at.x, first.p2.y - at.y),
            new_out_handle: point(second.p1.x - at.x, second.p1.y - at.y),
            end_in_handle: point(second.p2.x - edge.end.x, second.p2.y - edge.end.y),
        };
    }
    let Some(arc) = arc_of_edge(edge) else {
        let span_x = edge.end.x - edge.start.x;
        let span_y = edge.end.y - edge.start.y;
        let length_squared = span_x * span_x + span_y * span_y;
        let fraction = if length_squared == 0.0 {
            0.0
        } else {
            js_max(
                0.0,
                js_min(
                    1.0,
                    ((near.x - edge.start.x) * span_x + (near.y - edge.start.y) * span_y)
                        / length_squared,
                ),
            )
        };
        return EdgeSplit {
            at: point(
                edge.start.x + fraction * span_x,
                edge.start.y + fraction * span_y,
            ),
            fraction,
            first_bulge: 0.0,
            second_bulge: 0.0,
            start_out_handle: NO_HANDLE,
            new_in_handle: NO_HANDLE,
            new_out_handle: NO_HANDLE,
            end_in_handle: NO_HANDLE,
        };
    };
    let fraction = fraction_along_arc(&arc, js_atan2(near.y - arc.center.y, near.x - arc.center.x));
    let first_sweep = arc.sweep * fraction;
    let second_sweep = arc.sweep - first_sweep;
    let split_angle = arc.start_angle + first_sweep;
    EdgeSplit {
        at: point(
            arc.center.x + js_cos(split_angle) * arc.radius,
            arc.center.y + js_sin(split_angle) * arc.radius,
        ),
        fraction,
        first_bulge: js_tan(first_sweep / 4.0),
        second_bulge: js_tan(second_sweep / 4.0),
        start_out_handle: NO_HANDLE,
        new_in_handle: NO_HANDLE,
        new_out_handle: NO_HANDLE,
        end_in_handle: NO_HANDLE,
    }
}

/// True when a closed path encloses the point, by the nonzero rule a canvas
/// fills with. It casts one ray along positive x and counts the edges that
/// cross it, each with the direction it crosses. An arc crosses where the ray
/// meets its circle. A cubic crosses at the roots of its own y, on each stretch
/// where that y only rises or only falls.
///
/// An edge counts where the ray meets its start, and not where the ray meets
/// its end. So a vertex two edges share counts once.
///
/// It answers for the edges it gets. An open list winds as though a straight
/// edge closed it, which is what a canvas fill does too. Whether an open path
/// fills at all is the decision of the caller.
pub fn path_contains(at: Point, edges: &[PathEdge]) -> bool {
    let mut winding = 0.0;
    for edge in edges {
        winding += edge_crossings(at, edge);
    }
    winding != 0.0
}

fn edge_crossings(at: Point, edge: &PathEdge) -> f64 {
    if let Some(curve) = bezier_of_edge(edge) {
        return cubic_crossings(at, &curve);
    }
    match arc_of_edge(edge) {
        None => straight_crossings(at, edge),
        Some(arc) => arc_crossings(at, &arc),
    }
}

fn straight_crossings(at: Point, edge: &PathEdge) -> f64 {
    let rise = edge.end.y - edge.start.y;
    if rise == 0.0 {
        return 0.0;
    }
    let t = (at.y - edge.start.y) / rise;
    if !(0.0..1.0).contains(&t) {
        return 0.0;
    }
    let x = edge.start.x + t * (edge.end.x - edge.start.x);
    if x > at.x { js_sign(rise) } else { 0.0 }
}

fn arc_crossings(at: Point, arc: &ArcGeometry) -> f64 {
    let rise = at.y - arc.center.y;
    let half = arc.radius * arc.radius - rise * rise;
    if half <= 0.0 {
        return 0.0;
    }
    let reach = js_sqrt(half);
    let mut winding = 0.0;
    for x in [arc.center.x - reach, arc.center.x + reach] {
        if x <= at.x {
            continue;
        }
        let angle = js_atan2(rise, x - arc.center.x);
        let mut delta = (angle - arc.start_angle) % FULL_TURN;
        if delta < 0.0 {
            delta += FULL_TURN;
        }
        let along = if arc.sweep > 0.0 {
            delta / arc.sweep
        } else if delta == 0.0 {
            0.0
        } else {
            (delta - FULL_TURN) / arc.sweep
        };
        if !(0.0..1.0).contains(&along) {
            continue;
        }
        winding += js_sign(js_cos(angle) * arc.sweep);
    }
    winding
}

fn cubic_crossings(at: Point, curve: &CubicBezier) -> f64 {
    let height_at = |t: f64| bezier_point_at(curve, t).y - at.y;
    let mut boundaries = vec![0.0];
    let mut turns = turning_points(curve.p0.y, curve.p1.y, curve.p2.y, curve.p3.y);
    turns.sort_by(|a, b| a.partial_cmp(b).expect("a turning point is a real number"));
    boundaries.extend(turns);
    boundaries.push(1.0);
    let mut winding = 0.0;
    for piece in 0..boundaries.len().saturating_sub(1) {
        let low = boundaries[piece];
        let high = boundaries[piece + 1];
        let Some(t) = root_between(&height_at, low, high) else {
            continue;
        };
        if !(0.0..1.0).contains(&t) {
            continue;
        }
        if bezier_point_at(curve, t).x <= at.x {
            continue;
        }
        winding += js_sign(bezier_slope_at(curve, t).y);
    }
    winding
}

/// The one root of a function that only rises or only falls between low and
/// high.
fn root_between(height_at: &impl Fn(f64) -> f64, low: f64, high: f64) -> Option<f64> {
    let mut start = low;
    let mut end = high;
    let at_start = height_at(start);
    let at_end = height_at(end);
    if at_start == 0.0 {
        return Some(start);
    }
    if (at_start > 0.0) == (at_end > 0.0) {
        return None;
    }
    let start_is_below = at_start < 0.0;
    for _ in 0..ROOT_STEPS {
        let middle = (start + end) / 2.0;
        if (height_at(middle) < 0.0) == start_is_below {
            start = middle;
        } else {
            end = middle;
        }
    }
    Some((start + end) / 2.0)
}

/// The shortest distance from a point to any edge of a path.
pub fn distance_to_path(at: Point, edges: &[PathEdge]) -> f64 {
    let mut shortest = f64::INFINITY;
    for edge in edges {
        shortest = js_min(shortest, distance_to_edge(at, edge));
    }
    shortest
}

#[cfg(test)]
mod tests {
    use super::*;

    fn straight() -> PathEdge {
        PathEdge {
            start: point(0.0, 0.0),
            end: point(10.0, 0.0),
            bulge: 0.0,
            controls: None,
        }
    }

    fn arc(bulge: f64) -> PathEdge {
        PathEdge {
            bulge,
            ..straight()
        }
    }

    fn cubic() -> PathEdge {
        PathEdge {
            controls: Some([point(0.0, 8.0), point(10.0, 8.0)]),
            ..straight()
        }
    }

    /// Two vertices and two bulges of one. The header calls this the case that
    /// proves no curve turns into sample points: a sampled circle would answer
    /// a little under the true area and a little under the true perimeter, and
    /// these land on the nearest double to each.
    ///
    /// The area is exact at this radius rather than at every radius. A lune
    /// contributes r squared times the sweep less its sine, and the sine of a
    /// sweep of pi is 1.2e-16 rather than 0 because pi is not a double, so the
    /// residue rounds away here and shifts the last digit at a radius of three.
    #[test]
    fn the_circle_of_two_vertices_answers_exactly() {
        let edges = build_path_edges(
            &[point(-5.0, 0.0), point(5.0, 0.0)],
            &[HALF_CIRCLE_BULGE, HALF_CIRCLE_BULGE],
            true,
            &[],
            &[],
        );
        assert_eq!(edges.len(), 2);
        assert_eq!(path_area(&edges), std::f64::consts::PI * 25.0);
        assert_eq!(path_length(&edges), 2.0 * std::f64::consts::PI * 5.0);
        let bounds = path_bounds(&edges);
        assert_eq!(bounds.min_x, -5.0);
        assert_eq!(bounds.max_x, 5.0);
        assert_eq!(bounds.min_y, -5.0);
        assert_eq!(bounds.max_y, 5.0);
    }

    /// A bulge of one is a half circle, so the chord is the diameter and the
    /// radius is half of it.
    #[test]
    fn a_bulge_of_one_rides_on_the_circle_the_chord_spans() {
        let found = arc_of_edge(&arc(HALF_CIRCLE_BULGE)).expect("a bulge gives an arc");
        assert_eq!(found.radius, 5.0);
        assert_eq!(found.sweep, std::f64::consts::PI);
        assert_eq!(
            edge_length(&arc(HALF_CIRCLE_BULGE)),
            std::f64::consts::PI * 5.0
        );
    }

    /// Three edges have no circle under them, and each for its own reason.
    #[test]
    fn three_kinds_of_edge_have_no_arc() {
        assert_eq!(arc_of_edge(&straight()), None);
        assert_eq!(
            arc_of_edge(&cubic()),
            None,
            "control points win over a bulge"
        );
        let no_length = PathEdge {
            end: point(0.0, 0.0),
            bulge: 0.5,
            ..straight()
        };
        assert_eq!(arc_of_edge(&no_length), None);
    }

    /// The handles of a straight edge draw the same straight line, so turning
    /// an edge into a cubic leaves the shape where it was.
    #[test]
    fn a_straight_edge_becomes_a_cubic_without_moving() {
        let handles = cubic_handles_for_edge(&straight());
        assert_eq!(handles.out, point(10.0 / 3.0, 0.0));
        assert_eq!(handles.into, point(-10.0 / 3.0, 0.0));
    }

    /// A negative zero reaches a slot from any subtraction of equals, and the
    /// mutation rules refuse one, so the handles carry a plain zero instead.
    #[test]
    fn a_handle_carries_no_negative_zero() {
        let handles = cubic_handles_for_edge(&PathEdge {
            start: point(0.0, 0.0),
            end: point(0.0, 10.0),
            bulge: 0.0,
            controls: None,
        });
        assert!(handles.out.x.is_sign_positive());
        assert!(handles.into.x.is_sign_positive());
    }

    /// A bulge read back out of a midpoint is the bulge that put the point
    /// there, so a drag on the middle grip writes an exact number and no search
    /// runs.
    #[test]
    fn a_bulge_and_a_midpoint_answer_each_other() {
        for bulge in [0.25, 1.0, -0.5, 2.0] {
            let edge = arc(bulge);
            let middle = edge_midpoint(&edge);
            let read_back = bulge_for_midpoint(edge.start, edge.end, middle);
            assert!(
                (read_back - bulge).abs() < 1e-12,
                "a bulge of {bulge} read back as {read_back}"
            );
        }
    }

    /// The two arcs a split leaves hold the shape of the one they replace, so
    /// the two lengths add up to the length that was there before.
    #[test]
    fn splitting_an_arc_keeps_its_shape() {
        let edge = arc(0.75);
        let split = split_edge_at(&edge, point(5.0, -2.0));
        let first = PathEdge {
            start: edge.start,
            end: split.at,
            bulge: split.first_bulge,
            controls: None,
        };
        let second = PathEdge {
            start: split.at,
            end: edge.end,
            bulge: split.second_bulge,
            controls: None,
        };
        let together = edge_length(&first) + edge_length(&second);
        assert!(
            (together - edge_length(&edge)).abs() < 1e-9,
            "the halves measure {together} and the whole measures {}",
            edge_length(&edge)
        );
    }

    /// The area of a closed path does not follow its winding, and the doubled
    /// signed area does.
    #[test]
    fn winding_reaches_the_signed_area_and_not_the_area() {
        let corners = [
            point(0.0, 0.0),
            point(4.0, 0.0),
            point(4.0, 4.0),
            point(0.0, 4.0),
        ];
        let mut backwards = corners;
        backwards.reverse();
        let one_way = build_path_edges(&corners, &[0.0; 4], true, &[], &[]);
        let other_way = build_path_edges(&backwards, &[0.0; 4], true, &[], &[]);
        assert_eq!(path_area(&one_way), 16.0);
        assert_eq!(path_area(&other_way), 16.0);
        assert_eq!(path_doubled_signed_area(&one_way), 32.0);
        assert_eq!(path_doubled_signed_area(&other_way), -32.0);
    }

    /// An open path has one edge fewer than it has vertices, and the bulge of
    /// its last vertex waits, unused, until the path closes.
    #[test]
    fn closing_a_path_adds_the_edge_back_to_the_start() {
        let corners = [point(0.0, 0.0), point(3.0, 4.0), point(9.0, 4.0)];
        let open = build_path_edges(&corners, &[0.0; 3], false, &[], &[]);
        let closed = build_path_edges(&corners, &[0.0; 3], true, &[], &[]);
        assert_eq!(open.len(), 2);
        assert_eq!(closed.len(), 3);
        assert_eq!(closed[2].end, corners[0]);
    }

    /// Two zero handles leave the edge to its bulge, so an object that carries
    /// handle slots and has not been bent reads as an arc rather than a cubic.
    #[test]
    fn zero_handles_leave_an_edge_to_its_bulge() {
        let edges = build_path_edges(
            &[point(0.0, 0.0), point(10.0, 0.0)],
            &[0.5, 0.0],
            false,
            &[point(0.0, 0.0), point(0.0, 0.0)],
            &[point(0.0, 0.0), point(0.0, 0.0)],
        );
        assert_eq!(edges[0].controls, None);
        assert!(arc_of_edge(&edges[0]).is_some());
    }

    /// The ray counts an edge where it meets the start and not where it meets
    /// the end, so the vertex two edges share counts once and a point level
    /// with it is still inside.
    #[test]
    fn a_shared_vertex_counts_once() {
        let corners = [
            point(0.0, 0.0),
            point(4.0, 0.0),
            point(4.0, 4.0),
            point(0.0, 4.0),
        ];
        let edges = build_path_edges(&corners, &[0.0; 4], true, &[], &[]);
        assert!(path_contains(point(2.0, 2.0), &edges));
        assert!(path_contains(point(-0.0, 2.0), &edges));
        assert!(!path_contains(point(-10.0, -10.0), &edges));
        assert!(!path_contains(point(5.0, 2.0), &edges));
    }

    /// A path with no edges has no extreme point, and the bounds fall back to
    /// the origin rather than to the infinities the search starts from.
    #[test]
    fn an_empty_path_has_bounds_at_the_origin() {
        let bounds = path_bounds(&[]);
        assert_eq!(bounds.min_x, 0.0);
        assert_eq!(bounds.max_x, 0.0);
        assert_eq!(path_centroid(&[]), point(0.0, 0.0));
    }

    /// The bounding box of a cubic reaches the turning point of the curve, which
    /// lies below the control points rather than at them.
    #[test]
    fn a_cubic_reaches_its_turning_point_and_not_its_controls() {
        let points = edge_extreme_points(&cubic());
        let peak = points
            .iter()
            .find(|at| at.y != 0.0)
            .expect("the curve leaves the axis");
        assert_eq!(*peak, point(5.0, 6.0));
    }

    /// A chord pointing straight back along the direction closes a full circle
    /// and never arrives, so it gives the bulge of a straight edge.
    #[test]
    fn a_tangent_arc_that_never_arrives_draws_a_straight_edge() {
        assert_eq!(
            bulge_for_tangent_arc(point(0.0, 0.0), point(10.0, 0.0), point(-1.0, 0.0)),
            0.0
        );
        assert_eq!(
            bulge_for_tangent_arc(point(0.0, 0.0), point(0.0, 0.0), point(1.0, 0.0)),
            0.0
        );
    }
}
