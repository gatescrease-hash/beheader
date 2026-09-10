/**
 * menu.ts
 *
 * Layer: render. It reads engine state and calls mutations. It does nothing
 * else across that line. The engine must never import this file.
 *
 * The menu a right press opens over a path, and the command line each entry
 * stands for.
 *
 * Every entry is a command an operator can also type. The menu writes the line
 * and the usual command path runs it, so the log shows what happened and the
 * journal records it. Nothing here reaches a mutation on its own.
 *
 * A vertex offers its own removal. An edge offers its three shapes and one new
 * vertex at the point pressed. The press picks the part, so the menu never asks
 * the operator which one they meant.
 */

import { type CameraState, type GraphObject, POLYLINE_TYPE, type Point } from "../engine/index.ts";
import { screenToWorld, type ScreenPoint } from "./camera.ts";
import { edgeShape, gripAt, type EdgeShape } from "./grips.ts";
import { pathEdgeUnder } from "./hittest.ts";

export type PathMenuAction =
  | { readonly kind: "edgetype"; readonly index: number; readonly shape: EdgeShape }
  | { readonly kind: "split"; readonly index: number; readonly point: Point }
  | { readonly kind: "delvertex"; readonly index: number };

export interface PathMenuItem {
  readonly label: string;
  readonly action: PathMenuAction;
  /** True for the shape the edge already has. The menu marks it and offers it anyway. */
  readonly current: boolean;
}

export interface PathMenu {
  readonly objectId: string;
  readonly objectName: string;
  readonly title: string;
  readonly items: readonly PathMenuItem[];
}

const SHAPE_LABELS: Readonly<Record<EdgeShape, string>> = {
  line: "straight",
  arc: "arc",
  curve: "curve",
};

const SHAPE_ORDER: readonly EdgeShape[] = ["line", "arc", "curve"];

/**
 * The menu for a press, or nothing when the press finds no path.
 *
 * It walks the objects backward, so the topmost path wins, the same order the
 * hit test walks. A vertex beats an edge, because a vertex grip sits on the
 * stroke and the operator who presses one means the vertex.
 */
export function pathMenuAt(
  screenPoint: ScreenPoint,
  objects: readonly GraphObject[],
  camera: CameraState,
): PathMenu | undefined {
  for (let index = objects.length - 1; index >= 0; index -= 1) {
    const object = objects[index];
    if (object === undefined || object.type !== POLYLINE_TYPE) {
      continue;
    }
    const grip = gripAt(object, screenPoint, camera);
    if (grip?.kind === "vertex") {
      return vertexMenu(object, grip.index);
    }
    const edge = grip?.kind === "edge" ? grip.index : pathEdgeUnder(object, screenPoint, camera);
    if (edge !== undefined) {
      return edgeMenu(object, edge, screenToWorld(camera, screenPoint));
    }
  }
  return undefined;
}

function vertexMenu(object: GraphObject, index: number): PathMenu {
  return {
    objectId: object.id,
    objectName: object.name,
    title: `vertex ${index}`,
    items: [{ label: "delete this vertex", action: { kind: "delvertex", index }, current: false }],
  };
}

function edgeMenu(object: GraphObject, index: number, point: Point): PathMenu {
  const shape = edgeShape(object, index);
  const items: PathMenuItem[] = SHAPE_ORDER.map((candidate) => ({
    label: SHAPE_LABELS[candidate],
    action: { kind: "edgetype", index, shape: candidate },
    current: candidate === shape,
  }));
  items.push({ label: "add a vertex here", action: { kind: "split", index, point }, current: false });
  return { objectId: object.id, objectName: object.name, title: `edge ${index}`, items };
}

/** How many decimals a point in a command line carries. Enough to land where the press did. */
const MENU_POINT_DECIMALS = 4;

/** The command line one entry stands for. The operator can type the same line. */
export function menuCommandLine(objectName: string, action: PathMenuAction): string {
  switch (action.kind) {
    case "edgetype":
      return `edgetype ${objectName} ${action.index} ${action.shape === "line" ? "line" : action.shape}`;
    case "split":
      return `split ${objectName} ${action.index} ${round(action.point.x)},${round(action.point.y)}`;
    case "delvertex":
      return `delvertex ${objectName} ${action.index}`;
    default: {
      const exhaustive: never = action;
      void exhaustive;
      return "";
    }
  }
}

function round(value: number): number {
  return Number(value.toFixed(MENU_POINT_DECIMALS));
}
