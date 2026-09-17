/**
 * Layers are graph objects whose style slots can drive any other object.
 * Membership controls organization and visibility. Style inheritance uses
 * ordinary formula references, so evaluation, cycles and saved files share
 * the same rules as references to table cells. This module is pure engine
 * logic and produces operations for the mutation channel.
 */
import { getSlot, type GraphObject, type Slot, type Value } from "./graph/node.ts";
import type { Operation } from "./mutation.ts";

export const LAYER_DEFAULTS: Readonly<Record<string, Value>> = {
  "style.strokeColor": "#1a1a1a", "style.strokeWidth": 1, "style.fillColor": null,
  "style.color": "#1a1a1a", "style.font": "sans-serif", "style.fontSize": 16,
  "style.lineHeight": 20, "style.align": "left", "style.bold": false, "style.italic": false,
  "view.visible": true, "view.order": 0,
};

export const VIEW_PATHS = [["view", "layer"], ["view", "visible"], ["view", "order"]] as const;
export const STYLE_PATHS = Object.keys(LAYER_DEFAULTS).filter(key => key.startsWith("style.")).map(key => key.split("."));

export function createLayer(id: string, name: string): GraphObject {
  return { id, name, type: "layer", slots: Object.fromEntries(Object.entries(LAYER_DEFAULTS).map(([key, value]) => [key, { kind: "literal", value }])) };
}

export function layerId(object: GraphObject): string | undefined {
  const value = getSlot(object, ["view", "layer"])?.value;
  return typeof value === "string" && value !== "" ? value : undefined;
}

export function objectVisible(object: GraphObject, objects: readonly GraphObject[]): boolean {
  if (object.type === "layer" || object.type === "doc" || object.slots["view.visible"]?.value === false) return false;
  const layer = objects.find(item => item.id === layerId(object));
  return layer?.slots["view.visible"]?.value !== false;
}

function order(object: GraphObject | undefined): number {
  const value = object?.slots["view.order"]?.value;
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function displayObjects(objects: readonly GraphObject[]): readonly GraphObject[] {
  return objects.filter(object => objectVisible(object, objects)).sort((a, b) =>
    order(objects.find(item => item.id === layerId(a))) - order(objects.find(item => item.id === layerId(b))) || order(a) - order(b));
}

export function stylePaths(object: GraphObject): readonly (readonly string[])[] {
  if (["circle", "rect", "polygon", "polyline"].includes(object.type)) return STYLE_PATHS.filter(path => ["strokeColor", "strokeWidth", "fillColor"].includes(path[1]!));
  if (["text", "table", "layer"].includes(object.type)) return STYLE_PATHS.filter(path => object.type !== "text" || !["strokeColor", "strokeWidth", "fillColor"].includes(path[1]!));
  return [];
}

export function setLiteral(objectId: string, path: readonly string[], value: Value): Operation {
  return { kind: "setSlot", address: { objectId, path }, slot: { kind: "literal", value } };
}

export function inheritStyle(objectId: string, path: readonly string[], sourceId: string): Operation {
  return { kind: "setSlot", address: { objectId, path }, slot: { kind: "formula", ast: { type: "reference", address: { objectId: sourceId, path } }, value: null } };
}

export function assignLayer(object: GraphObject, layer: GraphObject | undefined): readonly Operation[] {
  const previous = layerId(object);
  const operations: Operation[] = [setLiteral(object.id, ["view", "layer"], layer?.id ?? null)];
  for (const path of stylePaths(object)) {
    const key = path.join(".");
    const slot = object.slots[key];
    const inherited = slot?.kind === "formula" && slot.ast.type === "reference" && slot.ast.address.objectId === previous;
    const defaultValue = object.type === "text" && key === "style.color" ? "#000000" : LAYER_DEFAULTS[key];
    const initialDefault = previous === undefined && (slot === undefined || (slot.kind === "literal" && slot.value === defaultValue));
    if (inherited || initialDefault) {
      operations.push(layer ? inheritStyle(object.id, path, layer.id) : setLiteral(object.id, path, slot?.value ?? LAYER_DEFAULTS[key] ?? null));
    }
  }
  return operations;
}

export function layerProblem(objects: readonly GraphObject[]): string | undefined {
  for (const object of objects) {
    const membership: Slot | undefined = object.slots["view.layer"];
    if (membership && (membership.kind !== "literal" || (membership.value !== null && typeof membership.value !== "string"))) return `${object.name}: layer membership must be a literal layer ID`;
    const id = layerId(object);
    if (id !== undefined && (object.type === "layer" || !objects.some(item => item.id === id && item.type === "layer"))) return `${object.name}: the organizational layer does not exist or would nest layers`;
  }
  return undefined;
}
