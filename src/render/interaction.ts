/**
 * interaction.ts
 *
 * This layer turns mouse state into mutation calls.
 *
 * A drag writes each component on its own. A literal component moves. A
 * component that a formula drives stays put, and the caller shows a notice
 * that does not block. So an object with a bound x slides up and down only,
 * and an axis constraint follows with no extra code.
 *
 * An object with an origin drags by that origin. A path has none, so it drags
 * by every vertex, under the same per component rule. A vertex a formula
 * drives stays where it is while the rest move. That is how a road holds on
 * to the intersections its ends read.
 *
 * A shift drag on a path edge moves only the two vertices of that edge. The
 * gesture picks its vertices once, at the moment of the press, so the set
 * never changes under the pointer.
 *
 * A selected path grows grips. A press on a vertex grip drags that one
 * vertex. A press on an edge grip bends that edge, and writes vertex.N.bulge.
 * A bend is absolute, read from the ends the edge has now, the same way a
 * resize reads the extent it started with. Both gestures also set the focus,
 * which is the one part of a path the panel expands.
 *
 * A grip answers a plain press only. Shift holds the two meanings it already
 * had, so a shift press on the middle of an edge still moves that segment.
 *
 * A drag never writes object state. It calls the mutation API like everything
 * else.
 *
 * The file belongs to the render layer. It reads engine state and calls
 * mutations, and it crosses that line for nothing else. The engine holds no
 * import of this file, which keeps the drawing code replaceable.
 */
import {
  type Address,
  type CameraState,
  type DerivedSlot,
  type EvalContext,
  extractDependencies,
  formatAddress,
  type FormulaSlot,
  getSlot,
  type GraphObject,
  IMAGE_HEIGHT_PATH,
  IMAGE_PRESERVE_ASPECT_PATH,
  IMAGE_TYPE,
  IMAGE_WIDTH_PATH,
  isAddressError,
  mutate,
  type MutationJournalEntry,
  NULL_EVAL_CONTEXT,
  type Operation,
  ORIGIN_X_PATH,
  ORIGIN_Y_PATH,
  TEXT_AUTORESIZE_PATH,
  TEXT_HEIGHT_PATH,
  TEXT_TYPE,
  vertexBulgePath,
  vertexXPath,
  vertexYPath,
  TEXT_WIDTH_PATH,
} from "../engine/index.ts";
import { screenToWorld, type ScreenPoint, type WorldPoint } from "./camera.ts";
import { objectExtent, type WorldExtent } from "./extent.ts";
import { constrainBoxToRatio, handleEdges, hasResizeHandles, resizeBox, resizeHandleAt, type ResizeHandle } from "./handles.ts";
import { bulgeForGrabbedMidpoint, gripAt, hasPathGrips, sameGrip, type PathGrip } from "./grips.ts";
import { hitTest, pathSegmentUnder } from "./hittest.ts";
import { readBoolean } from "./slots.ts";

export interface DragState {
  readonly objectId: string;
  readonly lastWorldPoint: WorldPoint;
  readonly emittedNotices: readonly string[];
  /** The vertices this drag moves. Undefined for an object that moves by its origin. */
  readonly vertices: readonly number[] | undefined;
}

export interface ResizeState {
  readonly objectId: string;
  readonly handle: ResizeHandle;
  readonly startExtent: WorldExtent;
  readonly startWorldPoint: WorldPoint;
  readonly emittedNotices: readonly string[];
}

/** The one part of one path the operator picked. The panel expands it. */
export interface PathFocus {
  readonly objectId: string;
  readonly grip: PathGrip;
}

export interface BendState {
  readonly objectId: string;
  readonly index: number;
  readonly emittedNotices: readonly string[];
}

export interface InteractionState {
  readonly selectedObjectIds: readonly string[];
  readonly drag: DragState | undefined;
  readonly resize: ResizeState | undefined;
  readonly bend: BendState | undefined;
  readonly focus: PathFocus | undefined;
}

export const INITIAL_INTERACTION_STATE: InteractionState = {
  selectedObjectIds: [],
  drag: undefined,
  resize: undefined,
  bend: undefined,
  focus: undefined,
};

export interface PointerMoveOutcome {
  readonly state: InteractionState;
  readonly objects: readonly GraphObject[];
  readonly journal: readonly MutationJournalEntry[];
  readonly notices: readonly string[];
  readonly rejection: string | undefined;
}

/** Starts a select, a drag or a resize. */
export function pointerDown(
  state: InteractionState,
  screenPoint: ScreenPoint,
  objects: readonly GraphObject[],
  camera: CameraState,
  additive: boolean = false,
): InteractionState {
  const grabbed = resizeGestureAt(state, screenPoint, objects, camera);
  if (grabbed !== undefined) {
    return { ...idle(state), resize: grabbed };
  }

  // A grip belongs to a path the operator already selected, so it takes the
  // press ahead of the hit test. Without that, a press near an edge reselects
  // the object, and the grip never answers. Shift keeps both meanings it
  // already had. An edge grip sits at the middle of an edge, which is where a
  // shift press grabs that segment. The two gestures want the same pixel. A
  // plain press bends the edge. A shift press moves it.
  const grabbedGrip = additive ? undefined : gripGestureAt(state, screenPoint, objects, camera);
  if (grabbedGrip !== undefined) {
    return grabbedGrip;
  }

  const object = hitTest(screenPoint, objects, camera);
  if (object === undefined) {
    if (!additive) {
      return INITIAL_INTERACTION_STATE;
    }
    return state.drag === undefined && state.resize === undefined && state.bend === undefined ? state : idle(state);
  }
  // Shift over an edge of a path grabs that segment. Held anywhere else, it adds
  // the object to the selection, as it always did.
  const segment = additive ? pathSegmentUnder(object, screenPoint, camera) : undefined;
  const grabsSegment = segment !== undefined;
  // A segment grab selects the path outright. Nothing can drag an object that
  // the same press has just taken out of the selection.
  const selectedObjectIds = additive && !grabsSegment ? toggleSelection(state.selectedObjectIds, object.id) : [object.id];
  return {
    selectedObjectIds,
    drag: {
      objectId: object.id,
      lastWorldPoint: screenToWorld(camera, screenPoint),
      emittedNotices: [],
      vertices: segment ?? everyVertexOfPath(object),
    },
    resize: undefined,
    bend: undefined,
    // A press on the body of a path is about the whole path, so it drops the part.
    focus: undefined,
  };
}

/** The state with every gesture ended, and the selection and focus kept. */
function idle(state: InteractionState): InteractionState {
  return {
    selectedObjectIds: state.selectedObjectIds,
    drag: undefined,
    resize: undefined,
    bend: undefined,
    focus: keptFocus(state.focus, state.selectedObjectIds),
  };
}

/** A focus survives while its object is still selected. */
function keptFocus(focus: PathFocus | undefined, selectedObjectIds: readonly string[]): PathFocus | undefined {
  return focus !== undefined && selectedObjectIds.includes(focus.objectId) ? focus : undefined;
}

/**
 * The gesture a press on a grip starts, or nothing.
 *
 * A vertex grip drags one vertex. An edge grip bends one edge. Either way the
 * press also focuses that part.
 */
function gripGestureAt(
  state: InteractionState,
  screenPoint: ScreenPoint,
  objects: readonly GraphObject[],
  camera: CameraState,
): InteractionState | undefined {
  for (let i = state.selectedObjectIds.length - 1; i >= 0; i -= 1) {
    const object = objects.find((candidate) => candidate.id === state.selectedObjectIds[i]);
    if (object === undefined || !hasPathGrips(object)) {
      continue;
    }
    const grip = gripAt(object, screenPoint, camera);
    if (grip === undefined) {
      continue;
    }
    const focus: PathFocus = { objectId: object.id, grip };
    if (grip.kind === "edge") {
      return {
        selectedObjectIds: state.selectedObjectIds,
        drag: undefined,
        resize: undefined,
        bend: { objectId: object.id, index: grip.index, emittedNotices: [] },
        focus,
      };
    }
    return {
      selectedObjectIds: state.selectedObjectIds,
      drag: {
        objectId: object.id,
        lastWorldPoint: screenToWorld(camera, screenPoint),
        emittedNotices: [],
        vertices: [grip.index],
      },
      resize: undefined,
      bend: undefined,
      focus,
    };
  }
  return undefined;
}

/** Focuses one part of a path from outside, which is what a click on a panel row does. */
export function focusPathPart(state: InteractionState, objectId: string, grip: PathGrip): InteractionState {
  const already = state.focus;
  if (already !== undefined && already.objectId === objectId && sameGrip(already.grip, grip)) {
    return { ...state, focus: undefined };
  }
  return {
    selectedObjectIds: state.selectedObjectIds.includes(objectId) ? state.selectedObjectIds : [objectId],
    drag: undefined,
    resize: undefined,
    bend: undefined,
    focus: { objectId, grip },
  };
}

/**
 * Every vertex of a path, or undefined for an object that drags by its origin.
 * An object with neither gets an empty list, and planDrag says so.
 */
function everyVertexOfPath(object: GraphObject): readonly number[] | undefined {
  if (getSlot(object, ORIGIN_X_PATH) !== undefined || getSlot(object, ORIGIN_Y_PATH) !== undefined) {
    return undefined;
  }
  return Array.from({ length: object.vertexCount ?? 0 }, (_unused, index) => index);
}

export function pathGripUnder(
  state: InteractionState,
  screenPoint: ScreenPoint,
  objects: readonly GraphObject[],
  camera: CameraState,
): PathGrip | undefined {
  return gripGestureAt(state, screenPoint, objects, camera)?.focus?.grip;
}

export function resizeHandleUnder(
  state: InteractionState,
  screenPoint: ScreenPoint,
  objects: readonly GraphObject[],
  camera: CameraState,
): ResizeHandle | undefined {
  return resizeGestureAt(state, screenPoint, objects, camera)?.handle;
}

function resizeGestureAt(
  state: InteractionState,
  screenPoint: ScreenPoint,
  objects: readonly GraphObject[],
  camera: CameraState,
): ResizeState | undefined {
  for (let i = state.selectedObjectIds.length - 1; i >= 0; i -= 1) {
    const objectId = state.selectedObjectIds[i];
    const object = objects.find((candidate) => candidate.id === objectId);
    if (object === undefined || !hasResizeHandles(object)) {
      continue;
    }
    const extent = objectExtent(object);
    if (extent === undefined) {
      continue;
    }
    const handle = resizeHandleAt(screenPoint, extent, camera);
    if (handle !== undefined) {
      return {
        objectId: object.id,
        handle,
        startExtent: extent,
        startWorldPoint: screenToWorld(camera, screenPoint),
        emittedNotices: [],
      };
    }
  }
  return undefined;
}

function toggleSelection(selectedObjectIds: readonly string[], objectId: string): readonly string[] {
  return selectedObjectIds.includes(objectId) ? selectedObjectIds.filter((id) => id !== objectId) : [...selectedObjectIds, objectId];
}

/**
 * Continues a drag or a resize. It writes each component on its own, and reports
 * the components a formula drives so the caller can tell the operator.
 */
export function pointerMove(
  state: InteractionState,
  screenPoint: ScreenPoint,
  objects: readonly GraphObject[],
  journal: readonly MutationJournalEntry[],
  camera: CameraState,
  context: EvalContext = NULL_EVAL_CONTEXT,
): PointerMoveOutcome {
  if (state.resize !== undefined) {
    return resizeMove(state, state.resize, screenPoint, objects, journal, camera, context);
  }
  if (state.bend !== undefined) {
    return bendMove(state, state.bend, screenPoint, objects, journal, camera, context);
  }

  const drag = state.drag;
  if (drag === undefined) {
    return { state, objects, journal, notices: [], rejection: undefined };
  }

  const object = objects.find((candidate) => candidate.id === drag.objectId);
  if (object === undefined) {
    return {
      state: idle(state),
      objects,
      journal,
      notices: [`the object being dragged (id "${drag.objectId}") no longer exists — drag ended`],
      rejection: undefined,
    };
  }

  const worldPoint = screenToWorld(camera, screenPoint);
  const deltaX = worldPoint.x - drag.lastWorldPoint.x;
  const deltaY = worldPoint.y - drag.lastWorldPoint.y;
  if (deltaX === 0 && deltaY === 0) {
    return { state, objects, journal, notices: [], rejection: undefined };
  }

  const plan = planDrag(object, objects, deltaX, deltaY, drag.vertices);
  const { fresh: freshNotices, widened: widenedEmittedNotices } = widenEmittedNotices(drag, plan.notices);
  const advanced: InteractionState = {
    ...idle(state),
    drag: { objectId: drag.objectId, lastWorldPoint: worldPoint, emittedNotices: widenedEmittedNotices, vertices: drag.vertices },
  };

  if (plan.operations.length === 0) {
    return { state: advanced, objects, journal, notices: freshNotices, rejection: undefined };
  }

  const result = mutate(objects, plan.operations, journal, context);
  if (!result.ok) {
    if (freshNotices.length === 0) {
      return { state, objects, journal, notices: freshNotices, rejection: result.message };
    }
    const unmoved: InteractionState = {
      ...idle(state),
      drag: {
        objectId: drag.objectId,
        lastWorldPoint: drag.lastWorldPoint,
        emittedNotices: widenedEmittedNotices,
        vertices: drag.vertices,
      },
    };
    return { state: unmoved, objects, journal, notices: freshNotices, rejection: result.message };
  }
  return { state: advanced, objects: result.objects, journal: result.journal, notices: freshNotices, rejection: undefined };
}

/**
 * Continues a bend. It writes vertex.N.bulge so the middle of the edge lands
 * under the pointer.
 *
 * The write is absolute, from the ends the edge holds now. So a bend never sums
 * small steps. A pointer that leaves the canvas and comes back writes the same
 * answer as one that never left.
 */
function bendMove(
  state: InteractionState,
  bend: BendState,
  screenPoint: ScreenPoint,
  objects: readonly GraphObject[],
  journal: readonly MutationJournalEntry[],
  camera: CameraState,
  context: EvalContext,
): PointerMoveOutcome {
  const object = objects.find((candidate) => candidate.id === bend.objectId);
  if (object === undefined) {
    return {
      state: idle(state),
      objects,
      journal,
      notices: [`the path being bent (id "${bend.objectId}") no longer exists — bend ended`],
      rejection: undefined,
    };
  }

  const path = vertexBulgePath(bend.index);
  const bulge = bulgeForGrabbedMidpoint(object, bend.index, screenToWorld(camera, screenPoint));
  const plan = bulge === undefined ? { operations: [], notices: [] } : planBulge(object, objects, path, bulge);
  const fresh = plan.notices.filter((notice) => !bend.emittedNotices.includes(notice));
  const advanced: InteractionState = {
    ...idle(state),
    bend: { ...bend, emittedNotices: fresh.length === 0 ? bend.emittedNotices : [...bend.emittedNotices, ...fresh] },
  };
  if (plan.operations.length === 0) {
    return { state: advanced, objects, journal, notices: fresh, rejection: undefined };
  }
  const result = mutate(objects, plan.operations, journal, context);
  if (!result.ok) {
    return { state: advanced, objects, journal, notices: fresh, rejection: result.message };
  }
  return { state: advanced, objects: result.objects, journal: result.journal, notices: fresh, rejection: undefined };
}

/** An absolute write to one bulge slot, under the same per component rule a drag follows. */
function planBulge(
  object: GraphObject,
  objects: readonly GraphObject[],
  path: readonly string[],
  bulge: number,
): DragPlan {
  const address: Address = { objectId: object.id, path };
  const slot = getSlot(object, path);
  if (slot === undefined) {
    return { operations: [], notices: [`${describeAddress(address, objects)} has no slot to bend`] };
  }
  if (slot.kind !== "literal") {
    return { operations: [], notices: [`${describeAddress(address, objects)} did not bend: ${describeSlotDriver(slot, objects)}`] };
  }
  if (slot.value === bulge) {
    return { operations: [], notices: [] };
  }
  return { operations: [{ kind: "setSlot", address, slot: { kind: "literal", value: bulge } }], notices: [] };
}

function resizeMove(
  state: InteractionState,
  resize: ResizeState,
  screenPoint: ScreenPoint,
  objects: readonly GraphObject[],
  journal: readonly MutationJournalEntry[],
  camera: CameraState,
  context: EvalContext,
): PointerMoveOutcome {
  const object = objects.find((candidate) => candidate.id === resize.objectId);
  if (object === undefined) {
    return {
      state: idle(state),
      objects,
      journal,
      notices: [`the object being resized (id "${resize.objectId}") no longer exists — resize ended`],
      rejection: undefined,
    };
  }

  const worldPoint = screenToWorld(camera, screenPoint);
  const plan = planResize(
    object,
    objects,
    resize,
    worldPoint.x - resize.startWorldPoint.x,
    worldPoint.y - resize.startWorldPoint.y,
  );
  const fresh = plan.notices.filter((notice) => !resize.emittedNotices.includes(notice));
  const advanced: InteractionState = {
    ...idle(state),
    resize: { ...resize, emittedNotices: fresh.length === 0 ? resize.emittedNotices : [...resize.emittedNotices, ...fresh] },
  };
  if (plan.operations.length === 0) {
    return { state: advanced, objects, journal, notices: fresh, rejection: undefined };
  }
  const result = mutate(objects, plan.operations, journal, context);
  if (!result.ok) {
    return { state: advanced, objects, journal, notices: fresh, rejection: result.message };
  }
  return { state: advanced, objects: result.objects, journal: result.journal, notices: fresh, rejection: undefined };
}

interface ResizePlanShape {
  readonly widthPath: readonly string[];
  readonly heightPath: readonly string[];
  readonly keepsRatio: boolean;
  readonly dropsAutoresize: boolean;
}

function resizePlanShape(object: GraphObject): ResizePlanShape | undefined {
  if (object.type === TEXT_TYPE) {
    return { widthPath: TEXT_WIDTH_PATH, heightPath: TEXT_HEIGHT_PATH, keepsRatio: false, dropsAutoresize: true };
  }
  if (object.type === IMAGE_TYPE) {
    return {
      widthPath: IMAGE_WIDTH_PATH,
      heightPath: IMAGE_HEIGHT_PATH,
      keepsRatio: readBoolean(object, IMAGE_PRESERVE_ASPECT_PATH) ?? true,
      dropsAutoresize: false,
    };
  }
  return undefined;
}

function planResize(
  object: GraphObject,
  objects: readonly GraphObject[],
  resize: ResizeState,
  deltaX: number,
  deltaY: number,
): DragPlan {
  const shape = resizePlanShape(object);
  if (shape === undefined) {
    return { operations: [], notices: [] };
  }
  const edges = handleEdges(resize.handle);
  const requested = resizeBox(resize.startExtent, resize.handle, deltaX, deltaY);
  const box = shape.keepsRatio ? constrainBoxToRatio(resize.startExtent, requested, resize.handle) : requested;
  const operations: Operation[] = [];
  const notices: string[] = [];

  const write = (path: readonly string[], value: number | boolean): void => {
    const address: Address = { objectId: object.id, path };
    const slot = getSlot(object, path);
    if (slot !== undefined && slot.kind !== "literal") {
      notices.push(`${describeAddress(address, objects)} did not resize: ${describeSlotDriver(slot, objects)}`);
      return;
    }
    operations.push({ kind: "setSlot", address, slot: { kind: "literal", value } });
  };

  if (edges.left || edges.right || shape.keepsRatio) {
    write(shape.widthPath, box.maxX - box.minX);
    if (edges.left) {
      write(ORIGIN_X_PATH, box.minX);
    }
  }
  if (edges.top || edges.bottom || shape.keepsRatio) {
    write(shape.heightPath, box.maxY - box.minY);
    if (edges.top) {
      write(ORIGIN_Y_PATH, box.minY);
    }
    if (shape.dropsAutoresize && (edges.top || edges.bottom) && readBoolean(object, TEXT_AUTORESIZE_PATH) !== false) {
      write(TEXT_AUTORESIZE_PATH, false);
    }
  }
  return { operations, notices };
}

function widenEmittedNotices(
  drag: DragState,
  notices: readonly string[],
): { readonly fresh: readonly string[]; readonly widened: readonly string[] } {
  const fresh = notices.filter((notice) => !drag.emittedNotices.includes(notice));
  return { fresh, widened: fresh.length === 0 ? drag.emittedNotices : [...drag.emittedNotices, ...fresh] };
}

/** Ends a drag or a resize. */
export function pointerUp(state: InteractionState): InteractionState {
  if (state.drag === undefined && state.resize === undefined && state.bend === undefined) {
    return state;
  }
  return idle(state);
}

export function deselect(): InteractionState {
  return INITIAL_INTERACTION_STATE;
}

interface ComponentPlan {
  readonly operation: Operation | undefined;
  readonly notice: string | undefined;
}

interface DragPlan {
  readonly operations: readonly Operation[];
  readonly notices: readonly string[];
}

/**
 * This is the one planner. The vertices a press picked decide which slots it
 * writes.
 */
function planDrag(
  object: GraphObject,
  objects: readonly GraphObject[],
  deltaX: number,
  deltaY: number,
  vertices: readonly number[] | undefined,
): DragPlan {
  if (vertices === undefined) {
    return gather([planComponent(object, ORIGIN_X_PATH, deltaX, objects), planComponent(object, ORIGIN_Y_PATH, deltaY, objects)]);
  }
  if (vertices.length === 0) {
    return { operations: [], notices: [`${object.name} has no origin and no vertices, so a drag has nothing to move`] };
  }
  return gather(
    vertices.flatMap((index) => [
      planComponent(object, vertexXPath(index), deltaX, objects),
      planComponent(object, vertexYPath(index), deltaY, objects),
    ]),
  );
}

function gather(plans: readonly ComponentPlan[]): DragPlan {
  return {
    operations: plans.flatMap((plan) => (plan.operation === undefined ? [] : [plan.operation])),
    notices: plans.flatMap((plan) => (plan.notice === undefined ? [] : [plan.notice])),
  };
}

function planComponent(object: GraphObject, path: readonly string[], delta: number, objects: readonly GraphObject[]): ComponentPlan {
  if (delta === 0) {
    return { operation: undefined, notice: undefined };
  }
  const address: Address = { objectId: object.id, path };
  const slot = getSlot(object, path);
  if (slot === undefined) {
    return { operation: undefined, notice: `${describeAddress(address, objects)} has no slot to move` };
  }
  if (slot.kind !== "literal") {
    return { operation: undefined, notice: `${describeAddress(address, objects)} did not move: ${describeSlotDriver(slot, objects)}` };
  }
  if (typeof slot.value !== "number") {
    return { operation: undefined, notice: `${describeAddress(address, objects)} did not move: it does not hold a number` };
  }
  return { operation: { kind: "setSlot", address, slot: { kind: "literal", value: slot.value + delta } }, notice: undefined };
}

function describeSlotDriver(slot: FormulaSlot | DerivedSlot, objects: readonly GraphObject[]): string {
  switch (slot.kind) {
    case "derived":
      return "it is a derived slot, computed by its object's schema and never writable";
    case "formula": {
      const sources = [
        ...new Set(
          extractDependencies(slot.ast).map((dependency) =>
            dependency.kind === "reference"
              ? describeAddress(dependency.address, objects)
              : `${describeAddress(dependency.start, objects)}:${describeAddress(dependency.end, objects)}`,
          ),
        ),
      ];
      if (sources.length === 0) {
        return "it is driven by a formula";
      }
      return `it is driven by a formula reading ${sources.join(", ")}`;
    }
    default: {
      const exhaustive: never = slot;
      void exhaustive;
      return "it is not a literal slot";
    }
  }
}

function describeAddress(address: Address, objects: readonly GraphObject[]): string {
  const formatted = formatAddress(address, objects);
  return isAddressError(formatted) ? formatted.message : formatted;
}
