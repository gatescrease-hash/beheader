//! The registry of object types. For each type it declares which slots exist
//! and what kind each one is, which makes it the single source of truth for any
//! slot path in the engine.
//!
//! Three places read that truth during one mutation: edge derivation, and the
//! two integrity checks. All three go through the same resolver on purpose. A
//! slot group can be dynamic, meaning its size comes from the object rather
//! than from the type, and a table's cells or a script node's outputs are both
//! dynamic. If those three sites each resolved a dynamic group their own way
//! they would drift apart, the graph would stop being total, and no test would
//! go red to say so.
//!
//! [`SlotOptionSet`] and [`SlotFormatSet`] narrow what a slot accepts. An
//! option set lists every legal value for a slot with few of them. A format
//! names a rule instead, for a slot with too many values to list. Colour is the
//! only format so far: [`is_color_value`] holds the rule, and [`COLOR_NONE`] is
//! the word that writes a null.
//!
//! The value and add types are test fixtures rather than object types an
//! operator can create, and no command word makes one. They stay because they
//! are the smallest case that exercises a derived slot.
//!
//! The registry answers nothing for a type with no entry, which is the same
//! answer the TypeScript gives for a type it has yet to declare.
//!
//! The port of `src/engine/primitives/schema.ts`.

use crate::address::Address;
use crate::formula::eval::ReadRange;
use crate::measure::{MeasureCapability, Measurer};
use crate::model::{ErrorCode, ErrorValue, GraphObject, ObjectType, Value, slot_key};

/// What a derived slot can read while it computes.
///
/// The measurer is the one service the engine takes from its host, under rule
/// 1, and a slot that draws text reads its size through this rather than
/// through a canvas. A pass with no measurer, or one carrying a measurer that
/// answers for nothing, leaves such a slot reporting a measurement error rather
/// than a guessed size, so a headless evaluation cannot leave a box a browser
/// would disagree with.
pub struct SlotComputeInputs<'a, A> {
    pub read: &'a dyn Fn(&Address) -> Option<Value>,
    /// The cells of a range, for a slot holding a formula that names one. A
    /// pass with none refuses such a formula rather than reading the two
    /// endpoints and guessing what lies between them.
    pub read_range: Option<ReadRange<'a>>,
    pub objects: &'a [GraphObject<A>],
    pub measurer: Option<&'a dyn Measurer>,
}

impl<A> SlotComputeInputs<'_, A> {
    /// The value at one path of the object being computed.
    pub fn at(&self, object: &GraphObject<A>, path: &[String]) -> Option<Value> {
        (self.read)(&Address {
            object_id: object.id.clone(),
            path: path.to_vec(),
        })
    }

    /// The measurer, when one is present that answers for something. The
    /// TypeScript tests the context against its null measurer, and the null
    /// measurer here is the one that reports no capability, so the two agree
    /// about which passes can measure.
    pub fn real_measurer(&self) -> Option<&dyn Measurer> {
        self.measurer
            .filter(|measurer| measurer.capability() != MeasureCapability::None)
    }
}

/// What a dynamic dependency list resolves to, against the object that carries
/// the slot and the objects around it.
pub type ResolveDependencies<A> = Box<dyn Fn(&GraphObject<A>, &[GraphObject<A>]) -> Vec<Address>>;

/// The addresses a derived slot reads. A static list belongs to the type, and a
/// dynamic one is resolved against the object.
pub enum DerivedSlotDependencies<A> {
    Static(Vec<Vec<String>>),
    Dynamic(ResolveDependencies<A>),
}

/// What a derived slot computes, from the object and what it can read.
pub type DerivedSlotCompute<A> = Box<dyn Fn(&GraphObject<A>, &SlotComputeInputs<A>) -> Value>;

pub struct DerivedSlotSchema<A> {
    pub path: Vec<String>,
    pub dependencies: DerivedSlotDependencies<A>,
    pub compute: DerivedSlotCompute<A>,
}

/// A group of derived slots. A dynamic group's size comes from the object, so a
/// table's cells and a script node's outputs both arrive this way.
pub enum DerivedSlotGroup<A> {
    Static(Vec<DerivedSlotSchema<A>>),
    Dynamic(EnumerateDerivedSlots<A>),
}

/// How many derived slots an object carries, and which, when the type alone
/// cannot say.
pub type EnumerateDerivedSlots<A> = Box<dyn Fn(&GraphObject<A>) -> Vec<DerivedSlotSchema<A>>>;

/// The literal and formula slot paths of one type, in the same two shapes.
pub enum NonDerivedSlotPathGroup<A> {
    Static(Vec<Vec<String>>),
    Dynamic(EnumerateSlotPaths<A>),
}

/// Which literal and formula slots an object carries, when the type alone
/// cannot say. A table's cells and a doc object's variables both arrive here.
pub type EnumerateSlotPaths<A> = Box<dyn Fn(&GraphObject<A>) -> Vec<Vec<String>>>;

pub struct SlotOptionSet {
    pub path: Vec<String>,
    pub values: Vec<Value>,
    pub labels: Option<Vec<String>>,
}

/// The shape that a free value takes, for a slot with too many values to list.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SlotFormat {
    Color,
}

pub struct SlotFormatSet {
    pub path: Vec<String>,
    pub format: SlotFormat,
}

pub struct ObjectSchema<A> {
    pub object_type: ObjectType,
    pub non_derived_slot_paths: Vec<NonDerivedSlotPathGroup<A>>,
    pub derived_slots: Vec<DerivedSlotGroup<A>>,
    pub slot_options: Vec<SlotOptionSet>,
    pub slot_formats: Vec<SlotFormatSet>,
}

/// The derived slots of one object. A dynamic group resolves against that
/// object. Nothing reads the groups of a schema directly, because the size of a
/// group depends on the object.
pub fn resolve_derived_slots<A>(
    object: &GraphObject<A>,
    groups: Vec<DerivedSlotGroup<A>>,
) -> Vec<DerivedSlotSchema<A>> {
    let mut slots = Vec::new();
    for group in groups {
        match group {
            DerivedSlotGroup::Static(held) => slots.extend(held),
            DerivedSlotGroup::Dynamic(enumerate) => slots.extend(enumerate(object)),
        }
    }
    slots
}

/// The literal and formula slot paths of one object, resolved the same way.
pub fn resolve_non_derived_slot_paths<A>(
    object: &GraphObject<A>,
    groups: &[NonDerivedSlotPathGroup<A>],
) -> Vec<Vec<String>> {
    let mut paths = Vec::new();
    for group in groups {
        match group {
            NonDerivedSlotPathGroup::Static(held) => paths.extend(held.iter().cloned()),
            NonDerivedSlotPathGroup::Dynamic(enumerate) => paths.extend(enumerate(object)),
        }
    }
    paths
}

/// The addresses a derived slot reads. This is the only place a dynamic
/// resolver runs. It runs at edge derivation time, and never during evaluation.
/// So evaluation never changes the slot set.
pub fn derived_slot_dependency_addresses<A>(
    object: &GraphObject<A>,
    dependencies: &DerivedSlotDependencies<A>,
    objects: &[GraphObject<A>],
) -> Vec<Address> {
    match dependencies {
        DerivedSlotDependencies::Static(paths) => paths
            .iter()
            .map(|path| Address {
                object_id: object.id.clone(),
                path: path.clone(),
            })
            .collect(),
        DerivedSlotDependencies::Dynamic(resolve) => resolve(object, objects),
    }
}

/// The word a colour slot takes for no colour at all. It writes null.
pub const COLOR_NONE: &str = "none";

/// True for a value a colour slot accepts.
///
/// A hex colour, in the three, six or eight digit form, or null for no colour.
/// A canvas quietly ignores a colour it cannot read, so a name it does not know
/// paints the colour of the shape before it. Hex is also what a colour picker
/// gives back, so the typed form and the picked form agree exactly.
pub fn is_color_value(value: &Value) -> bool {
    match value {
        Value::Null => true,
        Value::Text(text) => {
            let Some(digits) = text.strip_prefix('#') else {
                return false;
            };
            matches!(digits.len(), 3 | 6 | 8) && digits.bytes().all(|byte| byte.is_ascii_hexdigit())
        }
        _ => false,
    }
}

pub fn find_slot_format(object_type: ObjectType, path: &[String]) -> Option<SlotFormat> {
    let schema = get_object_schema::<()>(object_type)?;
    let key = slot_key(path);
    schema
        .slot_formats
        .iter()
        .find(|entry| slot_key(&entry.path) == key)
        .map(|entry| entry.format)
}

pub fn find_slot_options(object_type: ObjectType, path: &[String]) -> Option<SlotOptionSet> {
    let schema = get_object_schema::<()>(object_type)?;
    let key = slot_key(path);
    schema
        .slot_options
        .into_iter()
        .find(|entry| slot_key(&entry.path) == key)
}

pub fn find_derived_slot_schema<A: 'static>(
    object: &GraphObject<A>,
    path: &[String],
) -> Option<DerivedSlotSchema<A>> {
    let schema = get_object_schema::<A>(object.object_type)?;
    let key = slot_key(path);
    resolve_derived_slots(object, schema.derived_slots)
        .into_iter()
        .find(|entry| slot_key(&entry.path) == key)
}

fn path(segments: &[&str]) -> Vec<String> {
    segments.iter().map(|part| (*part).to_string()).collect()
}

fn type_error(message: impl Into<String>) -> Value {
    Value::Error(ErrorValue {
        error: ErrorCode::Type,
        message: message.into(),
    })
}

fn reference_error(message: impl Into<String>) -> Value {
    Value::Error(ErrorValue {
        error: ErrorCode::Ref,
        message: message.into(),
    })
}

/// The schema for a type.
///
/// Every object type now declares one, so the answer is never nothing. The
/// match below names each of the thirteen rather than ending in a catch-all, so
/// a type added later will not compile until it declares which slots it
/// carries. The answer stays optional because the TypeScript registry is a
/// partial record and a caller of either engine reads the same shape.
pub fn get_object_schema<A: 'static>(object_type: ObjectType) -> Option<ObjectSchema<A>> {
    match object_type {
        ObjectType::Value => Some(value_schema()),
        ObjectType::Add => Some(add_schema()),
        ObjectType::Table => Some(table_schema()),
        ObjectType::Image => Some(image_schema()),
        ObjectType::Circle => Some(circle_schema()),
        ObjectType::Polygon => Some(polygon_schema()),
        ObjectType::Rect => Some(rect_schema()),
        ObjectType::Polyline => Some(polyline_schema()),
        ObjectType::Script => Some(script_schema()),
        ObjectType::Text => Some(text_schema()),
        ObjectType::Math => Some(math_schema()),
        // A variable is a slot an operator named, so the doc object declares
        // whatever slots it holds rather than a fixed set. That makes the set
        // dynamic without breaking the rule that evaluation never changes the
        // slot set: only a mutation writes a variable, and this enumeration
        // reads the slots the object already carries.
        // A copy carries a position and nothing else it could hold a value in.
        // Its address lives in `target`, outside the slot set, so nothing here
        // declares it and the integrity check is what pairs it with a variable.
        ObjectType::Docref => Some(ObjectSchema {
            object_type,
            non_derived_slot_paths: vec![NonDerivedSlotPathGroup::Static(vec![
                crate::primitives::geometry::origin_x_path(),
                crate::primitives::geometry::origin_y_path(),
            ])],
            derived_slots: vec![DerivedSlotGroup::Static(
                crate::primitives::doc::docref_derived_slots(),
            )],
            slot_options: Vec::new(),
            slot_formats: Vec::new(),
        }),
        ObjectType::Doc => Some(ObjectSchema {
            object_type,
            non_derived_slot_paths: vec![NonDerivedSlotPathGroup::Dynamic(Box::new(|object| {
                object
                    .slots
                    .keys()
                    .map(|name| vec![name.to_string()])
                    .collect()
            }))],
            derived_slots: Vec::new(),
            slot_options: Vec::new(),
            slot_formats: Vec::new(),
        }),
    }
}

fn value_schema<A>() -> ObjectSchema<A> {
    ObjectSchema {
        object_type: ObjectType::Value,
        non_derived_slot_paths: vec![NonDerivedSlotPathGroup::Static(vec![path(&["value"])])],
        derived_slots: Vec::new(),
        slot_options: Vec::new(),
        slot_formats: Vec::new(),
    }
}

fn add_schema<A: 'static>() -> ObjectSchema<A> {
    let a = path(&["in", "a"]);
    let b = path(&["in", "b"]);
    ObjectSchema {
        object_type: ObjectType::Add,
        non_derived_slot_paths: vec![NonDerivedSlotPathGroup::Static(vec![a.clone(), b.clone()])],
        derived_slots: vec![DerivedSlotGroup::Static(vec![DerivedSlotSchema {
            path: path(&["out", "result"]),
            dependencies: DerivedSlotDependencies::Static(vec![a.clone(), b.clone()]),
            compute: Box::new(move |object, inputs| {
                let (Some(left), Some(right)) = (inputs.at(object, &a), inputs.at(object, &b))
                else {
                    return reference_error("add: in.a/in.b did not resolve to a value");
                };
                if let Value::Error(_) = left {
                    return left;
                }
                if let Value::Error(_) = right {
                    return right;
                }
                let (Value::Number(left), Value::Number(right)) = (&left, &right) else {
                    return type_error("add: in.a and in.b must both be numbers");
                };
                let sum = left + right;
                if !sum.is_finite() {
                    return type_error(format!(
                        "add: in.a + in.b overflowed to a non-finite number ({})",
                        crate::number::to_javascript_text(sum)
                    ));
                }
                Value::Number(sum)
            }),
        }])],
        slot_options: Vec::new(),
        slot_formats: Vec::new(),
    }
}

fn table_schema<A: 'static>() -> ObjectSchema<A> {
    use crate::primitives::geometry::{origin_x_path, origin_y_path};
    use crate::primitives::table::{
        enumerate_table_cell_slot_paths, table_cols_path, table_rows_path,
    };
    ObjectSchema {
        object_type: ObjectType::Table,
        non_derived_slot_paths: vec![
            NonDerivedSlotPathGroup::Static(vec![
                origin_x_path(),
                origin_y_path(),
                table_rows_path(),
                table_cols_path(),
            ]),
            NonDerivedSlotPathGroup::Dynamic(Box::new(enumerate_table_cell_slot_paths)),
        ],
        derived_slots: Vec::new(),
        slot_options: Vec::new(),
        slot_formats: Vec::new(),
    }
}

fn image_schema<A>() -> ObjectSchema<A> {
    use crate::primitives::geometry::{origin_x_path, origin_y_path};
    use crate::primitives::image::{
        image_height_path, image_opacity_path, image_picture_aspect_path,
        image_preserve_aspect_path, image_source_path, image_width_path,
    };
    ObjectSchema {
        object_type: ObjectType::Image,
        non_derived_slot_paths: vec![NonDerivedSlotPathGroup::Static(vec![
            origin_x_path(),
            origin_y_path(),
            image_width_path(),
            image_height_path(),
            image_opacity_path(),
            image_source_path(),
            image_preserve_aspect_path(),
            image_picture_aspect_path(),
        ])],
        derived_slots: Vec::new(),
        slot_options: vec![SlotOptionSet {
            path: image_preserve_aspect_path(),
            values: vec![Value::Boolean(true), Value::Boolean(false)],
            labels: Some(vec![
                "keep the picture's proportions".to_string(),
                "stretch to fill the box".to_string(),
            ]),
        }],
        slot_formats: Vec::new(),
    }
}

fn geometry_color_formats() -> Vec<SlotFormatSet> {
    vec![
        SlotFormatSet {
            path: path(&["style", "strokeColor"]),
            format: SlotFormat::Color,
        },
        SlotFormatSet {
            path: path(&["style", "fillColor"]),
            format: SlotFormat::Color,
        },
    ]
}

fn circle_schema<A: 'static>() -> ObjectSchema<A> {
    use crate::primitives::geometry::{
        circle_derived_slots, geometry_style_paths, origin_x_path, origin_y_path, radius_path,
    };
    let mut paths = vec![origin_x_path(), origin_y_path(), radius_path()];
    paths.extend(geometry_style_paths());
    ObjectSchema {
        object_type: ObjectType::Circle,
        non_derived_slot_paths: vec![NonDerivedSlotPathGroup::Static(paths)],
        derived_slots: vec![DerivedSlotGroup::Static(circle_derived_slots("circle"))],
        slot_options: Vec::new(),
        slot_formats: geometry_color_formats(),
    }
}

fn polygon_schema<A: 'static>() -> ObjectSchema<A> {
    use crate::primitives::geometry::{
        compute_polygon_vertices_slot, geometry_style_paths, origin_x_path, origin_y_path,
        polygon_rotation_path, polygon_sides_path, radius_path, vertices_derived_slots,
        vertices_path,
    };
    let inputs = vec![
        polygon_sides_path(),
        radius_path(),
        origin_x_path(),
        origin_y_path(),
        polygon_rotation_path(),
    ];
    let mut declared = inputs.clone();
    declared.extend(geometry_style_paths());
    let mut slots = vec![DerivedSlotSchema {
        path: vertices_path(),
        dependencies: DerivedSlotDependencies::Static(inputs),
        compute: Box::new(compute_polygon_vertices_slot),
    }];
    slots.extend(vertices_derived_slots("polygon"));
    ObjectSchema {
        object_type: ObjectType::Polygon,
        non_derived_slot_paths: vec![NonDerivedSlotPathGroup::Static(declared)],
        derived_slots: vec![DerivedSlotGroup::Static(slots)],
        slot_options: Vec::new(),
        slot_formats: geometry_color_formats(),
    }
}

fn rect_schema<A: 'static>() -> ObjectSchema<A> {
    use crate::primitives::geometry::{
        compute_rect_vertices_slot, geometry_style_paths, origin_x_path, origin_y_path,
        rect_height_path, rect_width_path, vertices_derived_slots, vertices_path,
    };
    let inputs = vec![
        origin_x_path(),
        origin_y_path(),
        rect_width_path(),
        rect_height_path(),
    ];
    let mut declared = inputs.clone();
    declared.extend(geometry_style_paths());
    let mut slots = vec![DerivedSlotSchema {
        path: vertices_path(),
        dependencies: DerivedSlotDependencies::Static(inputs),
        compute: Box::new(compute_rect_vertices_slot),
    }];
    slots.extend(vertices_derived_slots("rect"));
    ObjectSchema {
        object_type: ObjectType::Rect,
        non_derived_slot_paths: vec![NonDerivedSlotPathGroup::Static(declared)],
        derived_slots: vec![DerivedSlotGroup::Static(slots)],
        slot_options: Vec::new(),
        slot_formats: geometry_color_formats(),
    }
}

fn polyline_schema<A: 'static>() -> ObjectSchema<A> {
    use crate::primitives::geometry::{
        closed_path, compute_polyline_vertices_slot, enumerate_polyline_vertex_slot_paths,
        geometry_style_paths, path_derived_slots, polyline_vertices_dependencies, vertices_path,
    };
    let mut declared = vec![closed_path()];
    declared.extend(geometry_style_paths());
    let mut slots = vec![DerivedSlotSchema {
        path: vertices_path(),
        dependencies: polyline_vertices_dependencies(),
        compute: Box::new(compute_polyline_vertices_slot),
    }];
    slots.extend(path_derived_slots("polyline"));
    ObjectSchema {
        object_type: ObjectType::Polyline,
        non_derived_slot_paths: vec![
            NonDerivedSlotPathGroup::Static(declared),
            NonDerivedSlotPathGroup::Dynamic(Box::new(enumerate_polyline_vertex_slot_paths)),
        ],
        derived_slots: vec![DerivedSlotGroup::Static(slots)],
        slot_options: vec![SlotOptionSet {
            path: closed_path(),
            values: vec![Value::Boolean(true), Value::Boolean(false)],
            labels: None,
        }],
        slot_formats: geometry_color_formats(),
    }
}

fn text_schema<A: 'static>() -> ObjectSchema<A> {
    use crate::primitives::geometry::{origin_x_path, origin_y_path};
    use crate::primitives::text::{
        compute_measured_height, compute_measured_width, compute_resolved_content,
        resolve_text_dependency_addresses, text_autoresize_path, text_content_path,
        text_height_path, text_measured_height_path, text_measured_width_path,
        text_resolved_content_path, text_style_align_path, text_style_color_path,
        text_style_font_path, text_style_font_size_path, text_style_line_height_path,
        text_width_path,
    };
    // Both measured slots read the same five, so a change to any one of them
    // resizes the box on the next pass.
    let measured_from = || {
        DerivedSlotDependencies::Static(vec![
            text_resolved_content_path(),
            text_width_path(),
            text_style_font_path(),
            text_style_font_size_path(),
            text_style_line_height_path(),
        ])
    };
    ObjectSchema {
        object_type: ObjectType::Text,
        non_derived_slot_paths: vec![NonDerivedSlotPathGroup::Static(vec![
            origin_x_path(),
            origin_y_path(),
            text_content_path(),
            text_width_path(),
            text_height_path(),
            text_autoresize_path(),
            text_style_font_path(),
            text_style_font_size_path(),
            text_style_line_height_path(),
            text_style_color_path(),
            text_style_align_path(),
        ])],
        derived_slots: vec![DerivedSlotGroup::Static(vec![
            DerivedSlotSchema {
                path: text_resolved_content_path(),
                dependencies: DerivedSlotDependencies::Dynamic(Box::new(
                    resolve_text_dependency_addresses,
                )),
                compute: Box::new(compute_resolved_content),
            },
            DerivedSlotSchema {
                path: text_measured_height_path(),
                dependencies: measured_from(),
                compute: Box::new(compute_measured_height),
            },
            DerivedSlotSchema {
                path: text_measured_width_path(),
                dependencies: measured_from(),
                compute: Box::new(compute_measured_width),
            },
        ])],
        slot_options: vec![
            SlotOptionSet {
                path: text_style_align_path(),
                values: vec![
                    Value::Text("left".to_string()),
                    Value::Text("center".to_string()),
                    Value::Text("right".to_string()),
                ],
                labels: None,
            },
            SlotOptionSet {
                path: text_autoresize_path(),
                values: vec![Value::Boolean(true), Value::Boolean(false)],
                labels: Some(vec![
                    "shrink to fit text".to_string(),
                    "keep the size I set".to_string(),
                ]),
            },
        ],
        slot_formats: vec![SlotFormatSet {
            path: text_style_color_path(),
            format: SlotFormat::Color,
        }],
    }
}

fn math_schema<A: 'static>() -> ObjectSchema<A> {
    use crate::primitives::geometry::{origin_x_path, origin_y_path};
    use crate::primitives::math::{
        MATH_DISPLAY_VALUES, enumerate_math_in_paths, enumerate_math_out_derived_slots,
        enumerate_math_seed_paths, math_display_path, math_measured_slots, math_source_path,
    };
    ObjectSchema {
        object_type: ObjectType::Math,
        non_derived_slot_paths: vec![
            NonDerivedSlotPathGroup::Static(vec![
                origin_x_path(),
                origin_y_path(),
                math_source_path(),
                math_display_path(),
            ]),
            NonDerivedSlotPathGroup::Dynamic(Box::new(enumerate_math_in_paths)),
            NonDerivedSlotPathGroup::Dynamic(Box::new(enumerate_math_seed_paths)),
        ],
        derived_slots: vec![
            DerivedSlotGroup::Static(math_measured_slots()),
            DerivedSlotGroup::Dynamic(Box::new(enumerate_math_out_derived_slots)),
        ],
        slot_options: vec![SlotOptionSet {
            path: math_display_path(),
            values: MATH_DISPLAY_VALUES
                .iter()
                .map(|display| Value::Text(display.as_str().to_string()))
                .collect(),
            labels: Some(vec![
                "the formula".to_string(),
                "the result".to_string(),
                "the formula and its result".to_string(),
            ]),
        }],
        slot_formats: Vec::new(),
    }
}

fn script_schema<A: 'static>() -> ObjectSchema<A> {
    use crate::primitives::geometry::{origin_x_path, origin_y_path};
    use crate::script::stub::{
        enumerate_script_in_paths, enumerate_script_out_derived_slots,
        enumerate_script_placeholder_paths, script_language_path, script_source_path,
    };
    ObjectSchema {
        object_type: ObjectType::Script,
        non_derived_slot_paths: vec![
            NonDerivedSlotPathGroup::Static(vec![
                origin_x_path(),
                origin_y_path(),
                script_language_path(),
                script_source_path(),
            ]),
            NonDerivedSlotPathGroup::Dynamic(Box::new(enumerate_script_in_paths)),
            NonDerivedSlotPathGroup::Dynamic(Box::new(enumerate_script_placeholder_paths)),
        ],
        derived_slots: vec![DerivedSlotGroup::Dynamic(Box::new(
            enumerate_script_out_derived_slots,
        ))],
        slot_options: vec![SlotOptionSet {
            path: script_language_path(),
            values: vec![Value::Text("python".to_string())],
            labels: None,
        }],
        slot_formats: Vec::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{GraphObjectPorts, Slot, SlotMap};

    fn object(object_type: ObjectType, slots: &[(&str, Value)]) -> GraphObject<()> {
        let mut held = SlotMap::new();
        for (key, value) in slots {
            held.insert(
                *key,
                Slot::Literal {
                    value: value.clone(),
                },
            );
        }
        GraphObject {
            id: "o1".to_string(),
            name: "thing".to_string(),
            object_type,
            target: None,
            slots: held,
            ports: None,
            vertex_count: None,
        }
    }

    /// Computes every derived slot of an object against the slots it carries,
    /// which is what an evaluation pass does for one object.
    fn derived(object: &GraphObject<()>) -> Vec<(String, Value)> {
        let schema = get_object_schema::<()>(object.object_type).expect("the type is declared");
        let objects = [object.clone()];
        let read = |address: &Address| {
            if address.object_id != object.id {
                return None;
            }
            object
                .get_slot(&address.path)
                .map(|slot| slot.value().clone())
        };
        let inputs = SlotComputeInputs {
            read: &read,
            read_range: None,
            objects: &objects,
            measurer: None,
        };
        resolve_derived_slots(object, schema.derived_slots)
            .into_iter()
            .map(|entry| (slot_key(&entry.path), (entry.compute)(object, &inputs)))
            .collect()
    }

    /// Every object type declares a schema. The match in the registry names
    /// each one rather than ending in a catch-all, so a type added later fails
    /// to compile until it says which slots it carries, and this test says what
    /// that match is for.
    #[test]
    fn every_object_type_is_declared() {
        for object_type in [
            ObjectType::Circle,
            ObjectType::Polygon,
            ObjectType::Polyline,
            ObjectType::Rect,
            ObjectType::Text,
            ObjectType::Table,
            ObjectType::Script,
            ObjectType::Image,
            ObjectType::Math,
            ObjectType::Value,
            ObjectType::Doc,
            ObjectType::Docref,
            ObjectType::Add,
        ] {
            assert!(
                get_object_schema::<()>(object_type).is_some(),
                "{} declares a schema",
                object_type.as_str()
            );
        }
    }

    /// The colour rule takes the three hex forms and null, and nothing else. A
    /// canvas ignores a colour it cannot read, so a name it does not know would
    /// silently paint the colour of the shape before it.
    #[test]
    fn a_colour_slot_takes_hex_and_nothing_else() {
        for text in ["#fff", "#FFF", "#1a1a1a", "#1A1A1AFF"] {
            assert!(is_color_value(&Value::Text(text.to_string())), "{text}");
        }
        for text in ["#12345", "#ggg", "none", "", "red", "#1a1a1a ", "1a1a1a"] {
            assert!(!is_color_value(&Value::Text(text.to_string())), "{text}");
        }
        assert!(is_color_value(&Value::Null));
        assert!(!is_color_value(&Value::Number(5.0)));
    }

    /// A circle answers each of its eight measures in closed form, with no
    /// vertices slot to read.
    #[test]
    fn a_circle_measures_from_its_origin_and_radius() {
        let circle = object(
            ObjectType::Circle,
            &[
                ("origin.x", Value::Number(4.0)),
                ("origin.y", Value::Number(-2.0)),
                ("radius", Value::Number(3.0)),
            ],
        );
        let found = derived(&circle);
        assert_eq!(found.len(), 8);
        assert_eq!(found[0], ("centroid.x".to_string(), Value::Number(4.0)));
        assert_eq!(
            found[2],
            (
                "area".to_string(),
                Value::Number(std::f64::consts::PI * 9.0)
            )
        );
        assert_eq!(found[4], ("bounds.minX".to_string(), Value::Number(1.0)));
    }

    /// A polygon of fewer than three sides has no shape, so the vertices slot
    /// carries the reason rather than an empty list, and every measure that
    /// reads it carries the same error onward.
    #[test]
    fn a_polygon_of_two_sides_reports_why_it_has_no_vertices() {
        let polygon = object(
            ObjectType::Polygon,
            &[
                ("sides", Value::Number(2.0)),
                ("radius", Value::Number(5.0)),
                ("origin.x", Value::Number(0.0)),
                ("origin.y", Value::Number(0.0)),
                ("rotation", Value::Number(0.0)),
            ],
        );
        let found = derived(&polygon);
        let Value::Error(failure) = &found[0].1 else {
            panic!("the vertices slot carries an error");
        };
        assert_eq!(failure.error, ErrorCode::Type);
        assert_eq!(
            failure.message,
            "polygon.vertices: sides must be an integer >= 3"
        );
    }

    /// The closed slot picks which maths runs and never which slots exist, so an
    /// open path declares an area slot and answers it with the reason it has
    /// none.
    #[test]
    fn an_open_path_declares_an_area_and_refuses_to_measure_one() {
        let schema = get_object_schema::<()>(ObjectType::Polyline).expect("a polyline is declared");
        let object = object(ObjectType::Polyline, &[]);
        let paths: Vec<String> = resolve_derived_slots(&object, schema.derived_slots)
            .iter()
            .map(|entry| slot_key(&entry.path))
            .collect();
        assert!(paths.contains(&"area".to_string()));

        let mut open = object.clone();
        open.slots.insert(
            "vertices",
            Slot::Derived {
                value: Value::Points(vec![
                    crate::model::Point { x: 0.0, y: 0.0 },
                    crate::model::Point { x: 3.0, y: 4.0 },
                ]),
            },
        );
        open.slots.insert(
            "closed",
            Slot::Literal {
                value: Value::Boolean(false),
            },
        );
        open.vertex_count = Some(2.0);
        let found: Vec<(String, Value)> = derived(&open);
        let area = found
            .iter()
            .find(|(key, _)| key == "area")
            .expect("an area slot exists either way");
        let Value::Error(failure) = &area.1 else {
            panic!("an open path refuses to measure an area");
        };
        assert_eq!(
            failure.message,
            "polyline.area: an open path has no area. Set closed to true first"
        );
    }

    /// The outputs of a script node are a dynamic group: the ports decide how
    /// many there are, and each one names every input of the node so that adding
    /// an input recomputes all of them.
    #[test]
    fn a_script_declares_one_slot_for_each_port_it_carries() {
        let mut node = object(
            ObjectType::Script,
            &[
                ("in.a", Value::Number(1.0)),
                ("placeholder.out1", Value::Number(7.0)),
            ],
        );
        node.ports = Some(GraphObjectPorts {
            input: vec!["a".to_string()],
            output: vec!["out1".to_string()],
            seed: None,
        });
        let schema = get_object_schema::<()>(ObjectType::Script).expect("a script is declared");
        let declared = resolve_non_derived_slot_paths(&node, &schema.non_derived_slot_paths);
        let keys: Vec<String> = declared.iter().map(|at| slot_key(at)).collect();
        assert!(keys.contains(&"in.a".to_string()));
        assert!(keys.contains(&"placeholder.out1".to_string()));

        let slots = resolve_derived_slots(&node, schema.derived_slots);
        assert_eq!(slots.len(), 1);
        assert_eq!(slot_key(&slots[0].path), "out.out1");
        let reads = derived_slot_dependency_addresses(&node, &slots[0].dependencies, &[]);
        let named: Vec<String> = reads
            .iter()
            .map(|address| slot_key(&address.path))
            .collect();
        assert_eq!(named, vec!["in.a", "placeholder.out1"]);

        assert_eq!(derived(&node)[0].1, Value::Number(7.0));
    }

    /// A doc object declares the variables it holds rather than a fixed set,
    /// which is a dynamic group that reads the slots already there rather than
    /// one that evaluation could grow.
    #[test]
    fn a_doc_declares_the_variables_it_already_holds() {
        let doc = object(
            ObjectType::Doc,
            &[("alpha", Value::Number(1.0)), ("beta", Value::Number(2.0))],
        );
        let schema = get_object_schema::<()>(ObjectType::Doc).expect("a doc is declared");
        let declared = resolve_non_derived_slot_paths(&doc, &schema.non_derived_slot_paths);
        assert_eq!(
            declared,
            vec![vec!["alpha".to_string()], vec!["beta".to_string()]]
        );
    }

    /// An option set lists what a slot takes, and a format names a rule for a
    /// slot with too many values to list.
    #[test]
    fn a_slot_is_narrowed_by_a_list_or_by_a_rule() {
        let closed = find_slot_options(ObjectType::Polyline, &["closed".to_string()])
            .expect("the closed slot lists its two values");
        assert_eq!(
            closed.values,
            vec![Value::Boolean(true), Value::Boolean(false)]
        );
        assert_eq!(
            find_slot_format(
                ObjectType::Polyline,
                &["style".to_string(), "strokeColor".to_string()]
            ),
            Some(SlotFormat::Color)
        );
        assert_eq!(
            find_slot_format(
                ObjectType::Polyline,
                &["style".to_string(), "strokeWidth".to_string()]
            ),
            None
        );
    }
}
