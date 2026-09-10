/**
 * props.ts
 *
 * Layer: command. It turns a typed line into mutation calls. It imports from
 * engine and from its own layer.
 *
 * Slot descriptors for the props command and for the properties panel.
 *
 * Both surfaces read one list, so they can never disagree about what an object
 * has.
 */
import {
  findSlotFormat,
  findSlotOptions,
  type SlotFormat,
  formatFormula,
  getObjectSchema,
  getSlot,
  getTableDimensions,
  type GraphObject,
  isErrorValue,
  type Point,
  resolveDerivedSlots,
  type Slot,
  type SlotOptionSet,
  TABLE_CELL_PATH_PREFIX,
  TABLE_TYPE,
  type Value,
} from "../engine/index.ts";

export interface SlotDescriptor {
  readonly path: readonly string[];
  readonly kind: "literal" | "formula" | "derived";
  readonly value: Value;
  readonly formulaSource?: string;
  readonly synthetic?: true;

  readonly options?: SlotOptionSet;
  /** The shape a free value must take. A colour slot opens a picker in the panel. */
  readonly format?: SlotFormat;
}

/** The slot rows for one object. The panel and the props command both read this. */
export function buildSlotDescriptors(object: GraphObject, objects: readonly GraphObject[]): readonly SlotDescriptor[] {
  const schema = getObjectSchema(object.type);
  if (schema === undefined) {
    return [];
  }

  const descriptors: SlotDescriptor[] = [];
  for (const group of schema.nonDerivedSlotPaths) {
    if (group.kind === "dynamic") {
      if (object.type === TABLE_TYPE) {
        descriptors.push(tableCellsSummary(object));
        continue;
      }
      for (const path of group.enumerate(object)) {
        const dynamicSlot = getSlot(object, path);
        if (dynamicSlot === undefined) {
          continue;
        }
        descriptors.push({ ...describeNonDerivedSlot(path, dynamicSlot, objects), ...optionsFor(object, path) });
      }
      continue;
    }
    for (const path of group.paths) {
      const slot = getSlot(object, path);
      if (slot === undefined) {
        continue;
      }
      descriptors.push({ ...describeNonDerivedSlot(path, slot, objects), ...optionsFor(object, path) });
    }
  }
  for (const derived of resolveDerivedSlots(object, schema.derivedSlots)) {
    const slot = getSlot(object, derived.path);
    descriptors.push({ path: derived.path, kind: "derived", value: slot?.value ?? null });
  }
  return descriptors;
}

function optionsFor(object: GraphObject, path: readonly string[]): { options?: SlotOptionSet; format?: SlotFormat } {
  const options = findSlotOptions(object.type, path);
  const format = findSlotFormat(object.type, path);
  return { ...(options === undefined ? {} : { options }), ...(format === undefined ? {} : { format }) };
}

function describeNonDerivedSlot(path: readonly string[], slot: Slot, objects: readonly GraphObject[]): SlotDescriptor {
  switch (slot.kind) {
    case "literal":
      return { path, kind: "literal", value: slot.value };
    case "formula":
      return { path, kind: "formula", value: slot.value, formulaSource: formatFormula(slot.ast, objects) };
    case "derived":
      return { path, kind: "derived", value: slot.value };
    default: {
      const exhaustive: never = slot;
      void exhaustive;
      return { path, kind: "literal", value: null };
    }
  }
}

function tableCellsSummary(object: GraphObject): SlotDescriptor {
  const { rows, cols } = getTableDimensions(object);
  const prefix = `${TABLE_CELL_PATH_PREFIX}.`;
  const written = Object.keys(object.slots).filter((key) => key.startsWith(prefix)).length;
  return {
    path: [TABLE_CELL_PATH_PREFIX],
    kind: "literal",
    value: `${rows}×${cols} grid — ${written} of ${rows * cols} cells written`,
    synthetic: true,
  };
}

export function describeSlotValue(value: Value, options?: { readonly maxDecimals?: number; readonly fullStrings?: boolean }): string {
  if (value === null) {
    return "nothing";
  }
  if (isErrorValue(value)) {
    return `${value.error}: ${value.message}`;
  }
  if (typeof value === "string") {
    return options?.fullStrings === true ? `"${value}"` : elideLongString(value);
  }
  if (typeof value === "boolean") {
    return String(value);
  }
  if (typeof value === "number") {
    return formatDisplayNumber(value, options?.maxDecimals);
  }
  if (Array.isArray(value)) {
    return `${value.length} points`;
  }
  const point = value as Point;
  return `${formatDisplayNumber(point.x, options?.maxDecimals)},${formatDisplayNumber(point.y, options?.maxDecimals)}`;
}

const DISPLAY_STRING_MAX_LENGTH = 80;
const DISPLAY_STRING_HEAD_LENGTH = 40;

function elideLongString(value: string): string {
  if (value.length <= DISPLAY_STRING_MAX_LENGTH) {
    return `"${value}"`;
  }
  return `"${value.slice(0, DISPLAY_STRING_HEAD_LENGTH)}…" (${value.length} characters)`;
}

function formatDisplayNumber(value: number, maxDecimals: number | undefined): string {
  if (maxDecimals === undefined || !Number.isFinite(value)) {
    return String(value);
  }
  const rounded = Number(value.toFixed(maxDecimals));
  if (rounded === 0 && value !== 0) {
    return value.toExponential(maxDecimals);
  }
  return String(rounded);
}
