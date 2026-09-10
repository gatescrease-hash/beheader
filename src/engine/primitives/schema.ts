/**
 * schema.ts
 *
 * Layer: engine. Pure logic. It imports from engine only. It must never
 * touch the DOM, a window, a document, a canvas or the render layer.
 *
 * The registry of object types. For each type it declares which slots exist
 * and which kind each one has.
 *
 * This file is the single source of truth for a slot path. Three sites read it
 * in one mutation pass: edge derivation, and two integrity checks. All three
 * must go through the same resolver. Three sites that resolve a dynamic slot
 * family on their own will drift, and no test goes red when they do.
 *
 * A slot group is static or dynamic. A dynamic group resolves per object,
 * because its size comes from the state of that object. A table cells.* group
 * and a script out.* group are both dynamic.
 *
 * The value and add types are test fixtures from the first phase. Keep them.
 * They are the smallest case that exercises a derived slot.
 */
import type { Address } from "../address.ts";
import type { EvalContext } from "../eval-context.ts";
import type { ReadRange } from "../formula/eval.ts";
import { isErrorValue, slotKey, type GraphObject, type ObjectType, type Value } from "../graph/node.ts";
import {
  circleDerivedSlots,
  CLOSED_PATH,
  GEOMETRY_STYLE_PATHS,
  STYLE_FILL_COLOR_PATH,
  STYLE_STROKE_COLOR_PATH,
  computePolygonVerticesSlot,
  computePolylineVerticesSlot,
  computeRectVerticesSlot,
  enumeratePolylineVertexSlotPaths,
  ORIGIN_X_PATH,
  ORIGIN_Y_PATH,
  pathDerivedSlots,
  POLYGON_ROTATION_PATH,
  POLYGON_SIDES_PATH,
  polylineVerticesDependencies,
  RADIUS_PATH,
  RECT_HEIGHT_PATH,
  RECT_WIDTH_PATH,
  VERTICES_PATH,
  verticesDerivedSlots,
} from "./geometry.ts";
import { IMAGE_HEIGHT_PATH, IMAGE_OPACITY_PATH, IMAGE_PICTURE_ASPECT_PATH, IMAGE_PRESERVE_ASPECT_PATH, IMAGE_SOURCE_PATH, IMAGE_WIDTH_PATH } from "./image.ts";
import {
  enumerateScriptInPaths,
  enumerateScriptOutDerivedSlots,
  enumerateScriptPlaceholderPaths,
  SCRIPT_LANGUAGE_PATH,
  SCRIPT_SOURCE_PATH,
} from "../script/stub.ts";
import { enumerateTableCellSlotPaths, TABLE_COLS_PATH, TABLE_ROWS_PATH } from "./table.ts";
import {
  computeMeasuredHeight,
  computeMeasuredWidth,
  computeResolvedContent,
  resolveTextDependencyAddresses,
  TEXT_AUTORESIZE_PATH,
  TEXT_CONTENT_PATH,
  TEXT_HEIGHT_PATH,
  TEXT_MEASURED_HEIGHT_PATH,
  TEXT_MEASURED_WIDTH_PATH,
  TEXT_RESOLVED_CONTENT_PATH,
  TEXT_STYLE_ALIGN_PATH,
  TEXT_STYLE_COLOR_PATH,
  TEXT_STYLE_FONT_PATH,
  TEXT_STYLE_FONT_SIZE_PATH,
  TEXT_STYLE_LINE_HEIGHT_PATH,
  TEXT_WIDTH_PATH,
} from "./text.ts";

export type DerivedSlotDependencies =
  | { readonly kind: "static"; readonly paths: readonly (readonly string[])[] }
  | {
      readonly kind: "dynamic";
      readonly resolve: (object: GraphObject, objects: readonly GraphObject[]) => readonly Address[];
    };

export type DerivedSlotCompute = (
  object: GraphObject,
  read: (address: Address) => Value | undefined,
  context?: EvalContext,
  deps?: DerivedSlotComputeDeps,
) => Value;

export interface DerivedSlotComputeDeps {
  readonly readRange?: ReadRange;
  readonly objects: readonly GraphObject[];
}

export interface DerivedSlotSchema {
  readonly path: readonly string[];
  readonly dependencies: DerivedSlotDependencies;
  readonly compute: DerivedSlotCompute;
}

export type DerivedSlotGroup =
  | { readonly kind: "static"; readonly slots: readonly DerivedSlotSchema[] }
  | { readonly kind: "dynamic"; readonly enumerate: (object: GraphObject) => readonly DerivedSlotSchema[] };

/**
 * The derived slots of one object. A dynamic group resolves against that object.
 * Never read schema.derivedSlots directly. The size of a group depends on the object.
 */
export function resolveDerivedSlots(
  object: GraphObject,
  groups: readonly DerivedSlotGroup[],
): readonly DerivedSlotSchema[] {
  const slots: DerivedSlotSchema[] = [];
  for (const group of groups) {
    if (group.kind === "static") {
      for (const slot of group.slots) {
        slots.push(slot);
      }
    } else {
      for (const slot of group.enumerate(object)) {
        slots.push(slot);
      }
    }
  }
  return slots;
}

export type NonDerivedSlotPathGroup =
  | { readonly kind: "static"; readonly paths: readonly (readonly string[])[] }
  | { readonly kind: "dynamic"; readonly enumerate: (object: GraphObject) => readonly (readonly string[])[] };

/** The literal and formula slot paths of one object, resolved the same way. */
export function resolveNonDerivedSlotPaths(
  object: GraphObject,
  groups: readonly NonDerivedSlotPathGroup[],
): readonly (readonly string[])[] {
  const paths: (readonly string[])[] = [];
  for (const group of groups) {
    if (group.kind === "static") {
      paths.push(...group.paths);
    } else {
      for (const path of group.enumerate(object)) {
        paths.push(path);
      }
    }
  }
  return paths;
}

export interface ObjectSchema {
  readonly type: ObjectType;
  readonly nonDerivedSlotPaths: readonly NonDerivedSlotPathGroup[];
  readonly derivedSlots: readonly DerivedSlotGroup[];

  readonly slotOptions?: readonly SlotOptionSet[];
  readonly slotFormats?: readonly SlotFormatSet[];
}

export interface SlotOptionSet {
  readonly path: readonly string[];
  readonly values: readonly (number | string | boolean)[];
  readonly labels?: readonly string[];
}

/**
 * The shape a free value must take. An option set names every value a slot
 * accepts. A format names a rule instead, for a slot with too many values to
 * list.
 */
export type SlotFormat = "color";

export interface SlotFormatSet {
  readonly path: readonly string[];
  readonly format: SlotFormat;
}

/** The word a colour slot takes for no colour at all. It writes null. */
export const COLOR_NONE = "none";

const HEX_COLOR_PATTERN = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

/**
 * True for a value a colour slot accepts.
 *
 * A hex colour, in the three, six or eight digit form, or null for no colour.
 * A canvas quietly ignores a colour it cannot read, so a name it does not know
 * paints the colour of the shape before it. Hex is also what a colour picker
 * gives back, so the typed form and the picked form agree exactly.
 */
export function isColorValue(value: Value): boolean {
  return value === null || (typeof value === "string" && HEX_COLOR_PATTERN.test(value));
}

export function findSlotFormat(type: ObjectType, path: readonly string[]): SlotFormat | undefined {
  const schema = getObjectSchema(type);
  if (schema?.slotFormats === undefined) {
    return undefined;
  }
  const key = slotKey(path);
  return schema.slotFormats.find((entry) => slotKey(entry.path) === key)?.format;
}

/**
 * The addresses a derived slot reads. This is the only place a dynamic resolver runs.
 * It runs at edge derivation time, never during evaluation. That is what keeps Rule 4 true.
 */
export function derivedSlotDependencyAddresses(
  object: GraphObject,
  dependencies: DerivedSlotDependencies,
  objects: readonly GraphObject[] = [],
): readonly Address[] {
  if (dependencies.kind === "static") {
    return dependencies.paths.map((path) => ({ objectId: object.id, path }));
  }
  return dependencies.resolve(object, objects);
}

const VALUE_VALUE_PATH: readonly string[] = ["value"];

const VALUE_SCHEMA: ObjectSchema = {
  type: "value",
  nonDerivedSlotPaths: [{ kind: "static", paths: [VALUE_VALUE_PATH] }],
  derivedSlots: [],
};

const ADD_IN_A_PATH: readonly string[] = ["in", "a"];
const ADD_IN_B_PATH: readonly string[] = ["in", "b"];
const ADD_OUT_RESULT_PATH: readonly string[] = ["out", "result"];

const ADD_SCHEMA: ObjectSchema = {
  type: "add",
  nonDerivedSlotPaths: [{ kind: "static", paths: [ADD_IN_A_PATH, ADD_IN_B_PATH] }],
  derivedSlots: [
    { kind: "static", slots: [
    {
      path: ADD_OUT_RESULT_PATH,
      dependencies: {
        kind: "static",
        paths: [ADD_IN_A_PATH, ADD_IN_B_PATH],
      },
      compute: (object, read) => {
        const a = read({ objectId: object.id, path: ADD_IN_A_PATH });
        const b = read({ objectId: object.id, path: ADD_IN_B_PATH });
        if (a === undefined || b === undefined) {
          return { error: "#REF", message: "add: in.a/in.b did not resolve to a value" };
        }
        if (isErrorValue(a)) {
          return a;
        }
        if (isErrorValue(b)) {
          return b;
        }
        if (typeof a !== "number" || typeof b !== "number") {
          return { error: "#TYPE", message: "add: in.a and in.b must both be numbers" };
        }
        const sum = a + b;
        if (!Number.isFinite(sum)) {
          return { error: "#TYPE", message: `add: in.a + in.b overflowed to a non-finite number (${sum})` };
        }
        return sum;
      },
    },
  ] },
  ],
};

const TABLE_SCHEMA: ObjectSchema = {
  type: "table",
  nonDerivedSlotPaths: [
    { kind: "static", paths: [ORIGIN_X_PATH, ORIGIN_Y_PATH, TABLE_ROWS_PATH, TABLE_COLS_PATH] },
    { kind: "dynamic", enumerate: enumerateTableCellSlotPaths },
  ],
  derivedSlots: [],
};

const GEOMETRY_COLOR_FORMATS: readonly SlotFormatSet[] = [
  { path: STYLE_STROKE_COLOR_PATH, format: "color" },
  { path: STYLE_FILL_COLOR_PATH, format: "color" },
];

const CIRCLE_SCHEMA: ObjectSchema = {
  type: "circle",
  slotFormats: GEOMETRY_COLOR_FORMATS,
  nonDerivedSlotPaths: [{ kind: "static", paths: [ORIGIN_X_PATH, ORIGIN_Y_PATH, RADIUS_PATH, ...GEOMETRY_STYLE_PATHS] }],
  derivedSlots: [{ kind: "static", slots: [...circleDerivedSlots("circle")] }],
};

const POLYGON_SCHEMA: ObjectSchema = {
  type: "polygon",
  slotFormats: GEOMETRY_COLOR_FORMATS,
  nonDerivedSlotPaths: [
    { kind: "static", paths: [POLYGON_SIDES_PATH, RADIUS_PATH, ORIGIN_X_PATH, ORIGIN_Y_PATH, POLYGON_ROTATION_PATH, ...GEOMETRY_STYLE_PATHS] },
  ],
  derivedSlots: [{ kind: "static", slots: [
    {
      path: VERTICES_PATH,
      dependencies: { kind: "static", paths: [POLYGON_SIDES_PATH, RADIUS_PATH, ORIGIN_X_PATH, ORIGIN_Y_PATH, POLYGON_ROTATION_PATH] },
      compute: computePolygonVerticesSlot,
    },
    ...verticesDerivedSlots("polygon"),
  ] }],
};

const RECT_SCHEMA: ObjectSchema = {
  type: "rect",
  slotFormats: GEOMETRY_COLOR_FORMATS,
  nonDerivedSlotPaths: [
    { kind: "static", paths: [ORIGIN_X_PATH, ORIGIN_Y_PATH, RECT_WIDTH_PATH, RECT_HEIGHT_PATH, ...GEOMETRY_STYLE_PATHS] },
  ],
  derivedSlots: [{ kind: "static", slots: [
    {
      path: VERTICES_PATH,
      dependencies: { kind: "static", paths: [ORIGIN_X_PATH, ORIGIN_Y_PATH, RECT_WIDTH_PATH, RECT_HEIGHT_PATH] },
      compute: computeRectVerticesSlot,
    },
    ...verticesDerivedSlots("rect"),
  ] }],
};

const POLYLINE_SCHEMA: ObjectSchema = {
  type: "polyline",
  slotOptions: [{ path: CLOSED_PATH, values: [true, false] }],
  slotFormats: GEOMETRY_COLOR_FORMATS,
  nonDerivedSlotPaths: [
    { kind: "static", paths: [CLOSED_PATH, ...GEOMETRY_STYLE_PATHS] },
    { kind: "dynamic", enumerate: enumeratePolylineVertexSlotPaths },
  ],
  derivedSlots: [{ kind: "static", slots: [
    { path: VERTICES_PATH, dependencies: polylineVerticesDependencies, compute: computePolylineVerticesSlot },
    ...pathDerivedSlots("polyline"),
  ] }],
};

const TEXT_SCHEMA: ObjectSchema = {
  type: "text",
  slotFormats: [{ path: TEXT_STYLE_COLOR_PATH, format: "color" }],
  nonDerivedSlotPaths: [
    {
      kind: "static",
      paths: [
        ORIGIN_X_PATH,
        ORIGIN_Y_PATH,
        TEXT_CONTENT_PATH,
        TEXT_WIDTH_PATH,
        TEXT_HEIGHT_PATH,
        TEXT_AUTORESIZE_PATH,
        TEXT_STYLE_FONT_PATH,
        TEXT_STYLE_FONT_SIZE_PATH,
        TEXT_STYLE_LINE_HEIGHT_PATH,
        TEXT_STYLE_COLOR_PATH,
        TEXT_STYLE_ALIGN_PATH,
      ],
    },
  ],
  slotOptions: [
    { path: TEXT_STYLE_ALIGN_PATH, values: ["left", "center", "right"] },
    {
      path: TEXT_AUTORESIZE_PATH,
      values: [true, false],
      labels: ["shrink to fit text", "keep the size I set"],
    },
  ],
  derivedSlots: [{ kind: "static", slots: [
    {
      path: TEXT_RESOLVED_CONTENT_PATH,
      dependencies: { kind: "dynamic", resolve: resolveTextDependencyAddresses },
      compute: computeResolvedContent,
    },
    {
      path: TEXT_MEASURED_HEIGHT_PATH,
      dependencies: {
        kind: "static",
        paths: [
          TEXT_RESOLVED_CONTENT_PATH,
          TEXT_WIDTH_PATH,
          TEXT_STYLE_FONT_PATH,
          TEXT_STYLE_FONT_SIZE_PATH,
          TEXT_STYLE_LINE_HEIGHT_PATH,
        ],
      },
      compute: computeMeasuredHeight,
    },
    {
      path: TEXT_MEASURED_WIDTH_PATH,
      dependencies: {
        kind: "static",
        paths: [
          TEXT_RESOLVED_CONTENT_PATH,
          TEXT_WIDTH_PATH,
          TEXT_STYLE_FONT_PATH,
          TEXT_STYLE_FONT_SIZE_PATH,
          TEXT_STYLE_LINE_HEIGHT_PATH,
        ],
      },
      compute: computeMeasuredWidth,
    },
  ] }],
};

const IMAGE_SCHEMA: ObjectSchema = {
  type: "image",
  nonDerivedSlotPaths: [
    {
      kind: "static",
      paths: [
        ORIGIN_X_PATH,
        ORIGIN_Y_PATH,
        IMAGE_WIDTH_PATH,
        IMAGE_HEIGHT_PATH,
        IMAGE_OPACITY_PATH,
        IMAGE_SOURCE_PATH,
        IMAGE_PRESERVE_ASPECT_PATH,
        IMAGE_PICTURE_ASPECT_PATH,
      ],
    },
  ],
  slotOptions: [
    {
      path: IMAGE_PRESERVE_ASPECT_PATH,
      values: [true, false],
      labels: ["keep the picture's proportions", "stretch to fill the box"],
    },
  ],
  derivedSlots: [],
};

const SCRIPT_SCHEMA: ObjectSchema = {
  type: "script",
  nonDerivedSlotPaths: [
    { kind: "static", paths: [ORIGIN_X_PATH, ORIGIN_Y_PATH, SCRIPT_LANGUAGE_PATH, SCRIPT_SOURCE_PATH] },
    { kind: "dynamic", enumerate: enumerateScriptInPaths },
    { kind: "dynamic", enumerate: enumerateScriptPlaceholderPaths },
  ],
  derivedSlots: [{ kind: "dynamic", enumerate: enumerateScriptOutDerivedSlots }],
  slotOptions: [{ path: SCRIPT_LANGUAGE_PATH, values: ["python"] }],
};

const SCHEMAS: Partial<Record<ObjectType, ObjectSchema>> = {
  value: VALUE_SCHEMA,
  add: ADD_SCHEMA,
  table: TABLE_SCHEMA,
  circle: CIRCLE_SCHEMA,
  polygon: POLYGON_SCHEMA,
  polyline: POLYLINE_SCHEMA,
  rect: RECT_SCHEMA,
  text: TEXT_SCHEMA,
  image: IMAGE_SCHEMA,
  script: SCRIPT_SCHEMA,
};

/** The schema for a type, or undefined for a type with no entry yet. */
export function getObjectSchema(type: ObjectType): ObjectSchema | undefined {
  return SCHEMAS[type];
}

export function findSlotOptions(type: ObjectType, path: readonly string[]): SlotOptionSet | undefined {
  const schema = getObjectSchema(type);
  if (schema?.slotOptions === undefined) {
    return undefined;
  }
  const key = slotKey(path);
  return schema.slotOptions.find((entry) => slotKey(entry.path) === key);
}

export function findDerivedSlotSchema(
  object: GraphObject,
  path: readonly string[],
): DerivedSlotSchema | undefined {
  const schema = getObjectSchema(object.type);
  if (schema === undefined) {
    return undefined;
  }
  const key = slotKey(path);
  return resolveDerivedSlots(object, schema.derivedSlots).find((entry) => slotKey(entry.path) === key);
}
