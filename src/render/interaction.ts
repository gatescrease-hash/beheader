/**
 * interaction.ts
 *
 * Turns pointer state into mutation calls. Nothing here writes object state
 * directly.
 *
 * A drag writes each coordinate separately, and constrained dragging follows
 * from that alone. A literal coordinate moves. A
 * coordinate a formula drives stays where it is, and the caller shows a notice
 * that does not block the drag. So an object whose x is bound to a formula
 * slides up and down only, and nobody had to write an axis constraint.
 *
 * An object with an origin drags by that origin. A path has no origin, so it
 * drags by every vertex under the same per coordinate rule. A vertex that a
 * formula drives stays put while the rest move, which is how a road keeps hold
 * of the intersections its ends read.
 *
 * A shift press over an edge grabs that segment and moves only its two
 * vertices. pointerDown picks the vertex list once, at the moment of the
 * press, and DragState holds it, so the set cannot change under the pointer
 * mid drag.
 *
 * A selected path also grows grips. A press on a vertex grip drags that
 * vertex. A press on an edge grip bends the edge and writes vertex.N.bulge
 * absolutely, from the ends the edge has now, the same way a resize reads the
 * extent it started with. A bend therefore never drifts. Both gestures set
 * InteractionState.focus, which is the one part of the path the properties
 * panel expands.
 *
 * A grip answers a plain press only, so shift keeps both meanings it already
 * had.
 *
 * A press on an object already selected leaves the selection alone, and the
 * drag that follows moves every selected unit, each through planMove. The
 * click lands on the release instead, and only when the pointer never passed
 * the drag threshold: a plain click selects the pressed object alone, and a
 * shift click takes it out. So one press serves both a drag of many objects
 * and a click that picks one of them. Until the pointer travels
 * DRAG_THRESHOLD_SCREEN_PIXELS a drag writes nothing, so a click that wobbles
 * moves nothing either.
 *
 * A press on empty canvas arms a selection box, and marquee.ts decides what the
 * box takes. The selection follows the box on every move, from the selection
 * the press started with, so the release only ends the gesture.
 *
 * Render-layer code: it reads engine state and calls mutations, and crosses
 * that line for nothing else. Nothing in the engine imports this file, so a
 * GPU renderer can replace the whole layer later.
 */
import {
  type Address,
  ancestorGroups,
  displayObjects,
  groupDescendants,
  type CameraState,
  type DerivedSlot,
  type EvalContext,
  extractDependencies,
  formatAddress,
  type FormulaSlot,
  getSlot,
  type GraphObject,
  FRAME_HEIGHT_PATH,
  FRAME_TYPE,
  FRAME_WIDTH_PATH,
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
  SLIDER_VALUE_PATH,
  vertexBulgePath,
  vertexXPath,
  vertexYPath,
  TEXT_WIDTH_PATH,
} from "../engine/index.ts";
import { screenToWorld, type ScreenPoint, type WorldPoint } from "./camera.ts";
import { groupBoundary, objectExtent, type WorldExtent } from "./extent.ts";
import { constrainBoxToRatio, handleEdges, hasResizeHandles, resizeBox, resizeHandleAt, type ResizeHandle } from "./handles.ts";
import { bulgeForGrabbedMidpoint, gripAt, hasPathGrips, sameGrip, type PathGrip } from "./grips.ts";
import { hitTest, pathSegmentUnder, STROKE_HIT_TOLERANCE_SCREEN_PIXELS } from "./hittest.ts";
import { canvasUnits, marqueeBox, marqueeMode, marqueeUnits } from "./marquee.ts";
import { readBoolean, readNumber } from "./slots.ts";
import { SNAP_TOLERANCE_SCREEN_PIXELS, snapTargets, snapTravel, type Guide, type SnapTargets } from "./snap.ts";
import { onSliderTrack, sliderLayout, sliderValueUnder } from "./slider-layout.ts";

/**
 * How far a press travels, in screen pixels, before it drags or draws a box.
 * A shorter travel is a click.
 */
export const DRAG_THRESHOLD_SCREEN_PIXELS = 3;

export interface DragState {
  readonly objectId: string;
  readonly lastWorldPoint: WorldPoint;
  readonly emittedNotices: readonly string[];
  /** The vertices this drag moves. Undefined for an object that moves by its origin. */
  readonly vertices: readonly number[] | undefined;
  /**
   * The other objects the drag moves whole: the rest of the selection, less
   * any object inside a selected group, which moves with the group.
   */
  readonly carried: readonly string[];
  /** False until the pointer passes the drag threshold, and the drag writes nothing until then. */
  readonly moved: boolean;
  /**
   * What a release does to the selection when the pointer never passed the
   * threshold, after a press on an object that was already selected. "alone"
   * selects that object by itself, and "out" takes it out of the selection.
   */
  readonly click: { readonly objectId: string; readonly selects: "alone" | "out" } | undefined;
  /** The world point of the press, which the travel of the pointer counts from. */
  readonly pressWorldPoint: WorldPoint;
  /** The travel the drag has written so far, which a snap makes differ from the travel of the pointer. */
  readonly applied: { readonly x: number; readonly y: number };
  /** What the drag snaps against, worked out once at the press. */
  readonly snap: SnapTargets | undefined;
  /** The lines the moved box sits on now, which the canvas draws as guides. */
  readonly guides: readonly Guide[];
}

/** How a move snaps, when it snaps at all: the step of the grid the canvas shows, in world units. */
export interface SnapSettings {
  readonly gridStep: number;
}

/** A selection box on its way, in world units. */
export interface MarqueeState {
  readonly start: WorldPoint;
  readonly end: WorldPoint;
  /** The selection the box adds to: the selection at the press for a shift box, and nothing otherwise. */
  readonly base: readonly string[];
  /** False until the pointer passes the drag threshold. A box that never does is a click on empty canvas. */
  readonly drawn: boolean;
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

/** A drag of a slider's knob, which writes the slider's value from the pointer. */
export interface KnobState {
  readonly objectId: string;
  readonly emittedNotices: readonly string[];
}

export interface InteractionState {
  readonly selectedObjectIds: readonly string[];
  readonly drag: DragState | undefined;
  readonly resize: ResizeState | undefined;
  readonly bend: BendState | undefined;
  readonly focus: PathFocus | undefined;
  readonly marquee: MarqueeState | undefined;
  readonly knob: KnobState | undefined;
}

export const INITIAL_INTERACTION_STATE: InteractionState = {
  selectedObjectIds: [],
  drag: undefined,
  resize: undefined,
  bend: undefined,
  focus: undefined,
  marquee: undefined,
  knob: undefined,
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

  const worldPoint = screenToWorld(camera, screenPoint);
  const hit = hitTest(screenPoint, objects, camera);
  // A plain press on the track of a slider grabs its knob, on any slider, since
  // the knob is what the slider is for. The selection follows the press as it
  // would for any object, and shift keeps its meaning.
  const knob = hit !== undefined && hit.type === "slider" && !additive ? sliderLayout(hit) : undefined;
  if (hit !== undefined && knob !== undefined && onSliderTrack(knob, worldPoint, STROKE_HIT_TOLERANCE_SCREEN_PIXELS / camera.zoom)) {
    const level = groupLevelUnder(hit, objects, state.selectedObjectIds);
    const selectedObjectIds = state.selectedObjectIds.includes(level.id) ? state.selectedObjectIds : [level.id];
    return { ...INITIAL_INTERACTION_STATE, selectedObjectIds, knob: { objectId: hit.id, emittedNotices: [] } };
  }
  if (hit === undefined) {
    // A plain press clears the selection at once, as a click on empty canvas
    // always did, and a shift press keeps it for the box to add to.
    const base = additive ? state.selectedObjectIds : [];
    return {
      ...idle(state),
      selectedObjectIds: base,
      focus: additive ? keptFocus(state.focus, base) : undefined,
      marquee: { start: worldPoint, end: worldPoint, base, drawn: false },
    };
  }
  // A press inside a group takes the outermost group, or whichever level of
  // the way down is already selected, so a selected group drags as a whole and
  // a member reached by a double click or by name stays the one selected.
  const object = groupLevelUnder(hit, objects, state.selectedObjectIds);
  // Shift over an edge of a path grabs that segment, while the path is the
  // only thing selected or nothing is. With other objects selected, shift
  // means what it means everywhere else, so a selection of many can take a
  // path in and out by its stroke.
  const alone = state.selectedObjectIds.length === 0 || (state.selectedObjectIds.length === 1 && state.selectedObjectIds[0] === object.id);
  const segment = additive && alone && object === hit ? pathSegmentUnder(object, screenPoint, camera) : undefined;
  // A segment grab selects the path outright, so the drag moves the two ends
  // of that edge and nothing else.
  if (segment !== undefined) {
    return {
      ...INITIAL_INTERACTION_STATE,
      selectedObjectIds: [object.id],
      drag: { ...pressAt(worldPoint, pointSnapTargets(object, segment, objects)), objectId: object.id, vertices: segment, carried: [], click: undefined },
    };
  }
  const already = state.selectedObjectIds.includes(object.id);
  const selectedObjectIds = already ? state.selectedObjectIds : additive ? [...state.selectedObjectIds, object.id] : [object.id];
  const click = !already ? undefined : additive ? "out" : selectedObjectIds.length > 1 ? "alone" : undefined;
  // The drag moves units. The pressed object is one, unless a group around it
  // is selected as well, and then that group moves it.
  const units = withFrameContents(objects, movingUnits(objects, selectedObjectIds));
  const lead = units.find((unit) => unit.id === object.id) ?? units.find((unit) => groupDescendants(unit.id, objects).some((member) => member.id === object.id)) ?? object;
  const moving = units.length === 0 ? [lead] : units;
  return {
    selectedObjectIds,
    drag: {
      ...pressAt(worldPoint, unitSnapTargets(moving, objects)),
      objectId: lead.id,
      vertices: everyVertexOfPath(lead),
      carried: units.filter((unit) => unit.id !== lead.id).map((unit) => unit.id),
      click: click === undefined ? undefined : { objectId: object.id, selects: click },
    },
    resize: undefined,
    bend: undefined,
    // A press on the body of a path is about the whole path, so it drops the part.
    focus: undefined,
    marquee: undefined,
    knob: undefined,
  };
}

/** The parts of a drag that every press starts the same way. */
function pressAt(worldPoint: WorldPoint, snap: SnapTargets | undefined): Pick<DragState, "lastWorldPoint" | "emittedNotices" | "moved" | "pressWorldPoint" | "applied" | "snap" | "guides"> {
  return { lastWorldPoint: worldPoint, emittedNotices: [], moved: false, pressWorldPoint: worldPoint, applied: { x: 0, y: 0 }, snap, guides: [] };
}

function unionOf(boxes: readonly (WorldExtent | undefined)[]): WorldExtent | undefined {
  let union: WorldExtent | undefined;
  for (const box of boxes) {
    if (box === undefined) continue;
    union = union === undefined
      ? box
      : { minX: Math.min(union.minX, box.minX), minY: Math.min(union.minY, box.minY), maxX: Math.max(union.maxX, box.maxX), maxY: Math.max(union.maxY, box.maxY) };
  }
  return union;
}

/**
 * The boxes a drag lines up with: every object on show that the drag leaves
 * where it is, a group by the outline it draws. A group around a moving object
 * offers nothing, because its outline stretches with the object.
 */
function standingBoxes(objects: readonly GraphObject[], moving: ReadonlySet<string>): readonly WorldExtent[] {
  const byId = new Map(objects.map((object) => [object.id, object]));
  const stretching = new Set<string>();
  for (const id of moving) {
    const object = byId.get(id);
    if (object !== undefined) for (const group of ancestorGroups(object, (groupId) => byId.get(groupId))) stretching.add(group.id);
  }
  return displayObjects(objects)
    .filter((object) => !moving.has(object.id) && !stretching.has(object.id))
    .map((object) => (object.type === "group" ? groupBoundary(object, objects) : objectExtent(object)))
    .filter((box): box is WorldExtent => box !== undefined);
}

/**
 * What a drag of whole objects snaps against. A moving group counts by the box
 * its members fill, because its outline is padding around them.
 */
function unitSnapTargets(units: readonly GraphObject[], objects: readonly GraphObject[]): SnapTargets | undefined {
  const moving = new Set<string>();
  const boxes: (WorldExtent | undefined)[] = [];
  for (const unit of units) {
    moving.add(unit.id);
    const members = groupDescendants(unit.id, objects);
    for (const member of members) moving.add(member.id);
    const content = unionOf(members.filter((member) => member.type !== "group").map(objectExtent));
    boxes.push(unit.type === "group" ? content ?? objectExtent(unit) : objectExtent(unit));
  }
  const box = unionOf(boxes);
  if (box === undefined) {
    return undefined;
  }
  const writes = (deltaX: number, deltaY: number): boolean => units.some((unit) => planMove(unit, objects, deltaX, deltaY).operations.length > 0);
  return snapTargets(box, standingBoxes(objects, moving), writes(1, 0), writes(0, 1));
}

/**
 * What a drag of some vertices of a path snaps against: the box of those
 * points, against everything else on show and the other vertices of the same
 * path, so a path can square up against itself.
 */
function pointSnapTargets(object: GraphObject, vertices: readonly number[], objects: readonly GraphObject[]): SnapTargets | undefined {
  const pointAt = (index: number): WorldExtent | undefined => {
    const x = readNumber(object, vertexXPath(index));
    const y = readNumber(object, vertexYPath(index));
    return x === undefined || y === undefined ? undefined : { minX: x, minY: y, maxX: x, maxY: y };
  };
  const box = unionOf(vertices.map(pointAt));
  if (box === undefined) {
    return undefined;
  }
  const others = Array.from({ length: object.vertexCount ?? 0 }, (_unused, index) => index)
    .filter((index) => !vertices.includes(index))
    .map(pointAt)
    .filter((point): point is WorldExtent => point !== undefined);
  const writes = (deltaX: number, deltaY: number): boolean => planDrag(object, objects, deltaX, deltaY, vertices).operations.length > 0;
  return snapTargets(box, [...standingBoxes(objects, new Set([object.id])), ...others], writes(1, 0), writes(0, 1));
}

/**
 * The units a move of these units takes along: each one, and, for each frame
 * among them, every unit on show whose box lies wholly inside the frame now.
 * A frame inside a moving frame lies inside it, so it comes along with what it
 * holds. A unit half inside stays, because a frame that took half of something
 * would pull a drawing apart. A group counts by the outline it draws.
 */
export function withFrameContents(objects: readonly GraphObject[], units: readonly GraphObject[]): readonly GraphObject[] {
  const frames = units.map((unit) => (unit.type === "frame" ? objectExtent(unit) : undefined)).filter((box): box is WorldExtent => box !== undefined);
  if (frames.length === 0) {
    return units;
  }
  const taken = new Set(units.map((unit) => unit.id));
  const result = [...units];
  for (const unit of canvasUnits(objects)) {
    if (taken.has(unit.id)) continue;
    const box = unit.type === "group" ? groupBoundary(unit, objects) : objectExtent(unit);
    if (box !== undefined && frames.some((frame) => box.minX >= frame.minX && box.maxX <= frame.maxX && box.minY >= frame.minY && box.maxY <= frame.maxY)) {
      taken.add(unit.id);
      result.push(unit);
    }
  }
  return result;
}

/**
 * The objects that move when these are selected: each selected object, less
 * any object with a selected group around it, which moves with that group,
 * and less the variable holder and the layers, which have no place to move.
 */
export function movingUnits(objects: readonly GraphObject[], selectedObjectIds: readonly string[]): readonly GraphObject[] {
  const selected = new Set(selectedObjectIds);
  const byId = new Map(objects.map((object) => [object.id, object]));
  return selectedObjectIds
    .map((id) => byId.get(id))
    .filter((object): object is GraphObject => object !== undefined && object.type !== "doc" && object.type !== "layer")
    .filter((object) => !ancestorGroups(object, (id) => byId.get(id)).some((group) => selected.has(group.id)));
}

/**
 * The writes that move the selection by a delta, as an arrow key does: every
 * moving unit through planMove, under the rule a drag follows.
 */
export function planNudge(objects: readonly GraphObject[], selectedObjectIds: readonly string[], deltaX: number, deltaY: number): DragPlan {
  const plan = joinPlans(withFrameContents(objects, movingUnits(objects, selectedObjectIds)).map((unit) => planMove(unit, objects, deltaX, deltaY)));
  // A step of 0.1 adds in binary, so 100.2 and 0.1 make 100.30000000000001.
  // Each written value keeps as many decimals as the step or the value before
  // it had, which drops that error and nothing the operator wrote.
  const stepDecimals = Math.max(decimalsOf(Math.abs(deltaX)), decimalsOf(Math.abs(deltaY)));
  const byId = new Map(objects.map((object) => [object.id, object]));
  return {
    ...plan,
    operations: plan.operations.map((operation) => {
      if (operation.kind !== "setSlot" || operation.slot.kind !== "literal" || typeof operation.slot.value !== "number") return operation;
      const before = byId.get(operation.address.objectId);
      const previous = before === undefined ? undefined : getSlot(before, operation.address.path)?.value;
      const decimals = Math.min(MAX_NUDGE_DECIMALS, Math.max(stepDecimals, typeof previous === "number" ? decimalsOf(previous) : 0));
      return { ...operation, slot: { kind: "literal", value: Number(operation.slot.value.toFixed(decimals)) } };
    }),
  };
}

/** The most decimals a nudged value keeps, which is past what an operator types and short of what a binary number holds. */
const MAX_NUDGE_DECIMALS = 12;

/** The decimals in the shortest text of a number, and the most a nudge keeps for one written in exponent form. */
function decimalsOf(value: number): number {
  const text = String(value);
  if (text.includes("e")) return MAX_NUDGE_DECIMALS;
  const point = text.indexOf(".");
  return point < 0 ? 0 : text.length - point - 1;
}

/**
 * The groups around an object from the outermost inward, then the object
 * itself: the levels a press can select.
 */
export function groupPath(object: GraphObject, objects: readonly GraphObject[]): readonly GraphObject[] {
  const byId = (id: string) => objects.find((candidate) => candidate.id === id);
  return [...ancestorGroups(object, byId)].reverse().concat(object);
}

/** The level of the path under a press that it selects: the deepest one already selected, or the outermost. */
export function groupLevelUnder(object: GraphObject, objects: readonly GraphObject[], selectedObjectIds: readonly string[]): GraphObject {
  const path = groupPath(object, objects);
  for (let index = path.length - 1; index >= 0; index -= 1) {
    if (selectedObjectIds.includes(path[index]!.id)) {
      return path[index]!;
    }
  }
  return path[0]!;
}

/**
 * The level a double click on an object goes to: one below the deepest level
 * already selected, or undefined when the object itself is selected.
 */
export function groupLevelInside(object: GraphObject, objects: readonly GraphObject[], selectedObjectIds: readonly string[]): GraphObject | undefined {
  const path = groupPath(object, objects);
  let selected = -1;
  path.forEach((level, index) => {
    if (selectedObjectIds.includes(level.id)) selected = index;
  });
  return selected === path.length - 1 ? undefined : path[selected + 1];
}

/** The state with every gesture ended, and the selection and focus kept. */
function idle(state: InteractionState): InteractionState {
  return {
    selectedObjectIds: state.selectedObjectIds,
    drag: undefined,
    resize: undefined,
    bend: undefined,
    focus: keptFocus(state.focus, state.selectedObjectIds),
    marquee: undefined,
    knob: undefined,
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
        marquee: undefined,
        knob: undefined,
      };
    }
    return {
      selectedObjectIds: state.selectedObjectIds,
      drag: {
        ...pressAt(screenToWorld(camera, screenPoint), pointSnapTargets(object, [grip.index], objects)),
        objectId: object.id,
        vertices: [grip.index],
        carried: [],
        click: undefined,
      },
      resize: undefined,
      bend: undefined,
      focus,
      marquee: undefined,
      knob: undefined,
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
    marquee: undefined,
    knob: undefined,
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

/** The slider whose track lies under a screen point, which a plain press there would set. */
export function sliderTrackUnder(screenPoint: ScreenPoint, objects: readonly GraphObject[], camera: CameraState): GraphObject | undefined {
  const hit = hitTest(screenPoint, objects, camera);
  const layout = hit?.type === "slider" ? sliderLayout(hit) : undefined;
  return layout !== undefined && onSliderTrack(layout, screenToWorld(camera, screenPoint), STROKE_HIT_TOLERANCE_SCREEN_PIXELS / camera.zoom) ? hit : undefined;
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

/**
 * Continues a drag, a resize, a bend or a selection box. A drag writes each
 * component on its own, and reports the components a formula drives so the
 * caller can tell the operator.
 */
export function pointerMove(
  state: InteractionState,
  screenPoint: ScreenPoint,
  objects: readonly GraphObject[],
  journal: readonly MutationJournalEntry[],
  camera: CameraState,
  context: EvalContext = NULL_EVAL_CONTEXT,
  snapping?: SnapSettings,
): PointerMoveOutcome {
  if (state.resize !== undefined) {
    return resizeMove(state, state.resize, screenPoint, objects, journal, camera, context);
  }
  if (state.bend !== undefined) {
    return bendMove(state, state.bend, screenPoint, objects, journal, camera, context);
  }
  if (state.knob !== undefined) {
    return knobMove(state, state.knob, screenPoint, objects, journal, camera, context);
  }
  if (state.marquee !== undefined) {
    return { state: marqueeMove(state, state.marquee, screenToWorld(camera, screenPoint), objects, camera), objects, journal, notices: [], rejection: undefined };
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
  if (worldPoint.x === drag.lastWorldPoint.x && worldPoint.y === drag.lastWorldPoint.y) {
    return { state, objects, journal, notices: [], rejection: undefined };
  }
  const travel = { x: worldPoint.x - drag.pressWorldPoint.x, y: worldPoint.y - drag.pressWorldPoint.y };
  if (!drag.moved && Math.hypot(travel.x, travel.y) * camera.zoom < DRAG_THRESHOLD_SCREEN_PIXELS) {
    return { state, objects, journal, notices: [], rejection: undefined };
  }
  // The snap works from the whole travel since the press, and the frame writes
  // only the difference from what the drag has written already.
  const landed = snapping !== undefined && drag.snap !== undefined
    ? snapTravel(drag.snap, travel, SNAP_TOLERANCE_SCREEN_PIXELS / camera.zoom, snapping.gridStep)
    : { travel, guides: [] };
  const deltaX = landed.travel.x - drag.applied.x;
  const deltaY = landed.travel.y - drag.applied.y;
  const following: DragState = { ...drag, lastWorldPoint: worldPoint, moved: true, guides: landed.guides };
  if (deltaX === 0 && deltaY === 0) {
    return { state: { ...idle(state), drag: following }, objects, journal, notices: [], rejection: undefined };
  }

  const wanted = new Set(drag.carried);
  const carried = wanted.size === 0 ? [] : objects.filter((candidate) => wanted.has(candidate.id));
  const plan = joinPlans([
    object.type === "group" ? planMove(object, objects, deltaX, deltaY) : planDrag(object, objects, deltaX, deltaY, drag.vertices),
    ...carried.map((each) => planMove(each, objects, deltaX, deltaY)),
  ]);
  const { fresh: freshNotices, widened: widenedEmittedNotices } = widenEmittedNotices(drag, plan.notices);
  const advanced: InteractionState = {
    ...idle(state),
    drag: { ...following, applied: landed.travel, emittedNotices: widenedEmittedNotices },
  };

  if (plan.operations.length === 0) {
    return { state: advanced, objects, journal, notices: freshNotices, rejection: undefined };
  }

  const result = mutate(objects, plan.operations, journal, context);
  if (!result.ok) {
    // A refused step leaves the objects where they were, and the next step
    // measures from the same point, so it tries the whole distance again.
    if (freshNotices.length === 0) {
      return { state, objects, journal, notices: freshNotices, rejection: result.message };
    }
    const unmoved: InteractionState = { ...idle(state), drag: { ...drag, emittedNotices: widenedEmittedNotices } };
    return { state: unmoved, objects, journal, notices: freshNotices, rejection: result.message };
  }
  return { state: advanced, objects: result.objects, journal: result.journal, notices: freshNotices, rejection: undefined };
}

/**
 * Continues a selection box. Once the pointer passes the threshold, the
 * selection becomes the base the press started with plus every unit the box
 * takes, so the operator sees what a release keeps before releasing.
 */
function marqueeMove(state: InteractionState, marquee: MarqueeState, end: WorldPoint, objects: readonly GraphObject[], camera: CameraState): InteractionState {
  const drawn = marquee.drawn || Math.hypot(end.x - marquee.start.x, end.y - marquee.start.y) * camera.zoom >= DRAG_THRESHOLD_SCREEN_PIXELS;
  const next: MarqueeState = { ...marquee, end, drawn };
  if (!drawn) {
    return { ...state, marquee: next };
  }
  const taken = marqueeUnits(objects, marqueeBox(marquee.start, end), marqueeMode(marquee.start, end));
  const chosen = [...marquee.base, ...taken.filter((id) => !marquee.base.includes(id))];
  const unchanged = chosen.length === state.selectedObjectIds.length && chosen.every((id, index) => state.selectedObjectIds[index] === id);
  const selectedObjectIds = unchanged ? state.selectedObjectIds : chosen;
  return { ...state, selectedObjectIds, focus: keptFocus(state.focus, selectedObjectIds), marquee: next };
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
  const plan = bulge === undefined ? { operations: [], notices: [] } : planAbsoluteWrite(object, objects, path, bulge, "bend");
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

/**
 * An absolute write to one slot, a bulge or a slider's value, under the same
 * per component rule a drag follows: a slot a formula drives holds still and
 * gives a notice that names what drives it.
 */
function planAbsoluteWrite(
  object: GraphObject,
  objects: readonly GraphObject[],
  path: readonly string[],
  value: number,
  verb: "bend" | "move",
): DragPlan {
  const address: Address = { objectId: object.id, path };
  const slot = getSlot(object, path);
  if (slot === undefined) {
    return { operations: [], notices: [`${describeAddress(address, objects)} has no slot to ${verb}`] };
  }
  if (slot.kind !== "literal") {
    return { operations: [], notices: [`${describeAddress(address, objects)} did not ${verb}: ${describeSlotDriver(slot, objects)}`] };
  }
  if (slot.value === value) {
    return { operations: [], notices: [] };
  }
  return { operations: [{ kind: "setSlot", address, slot: { kind: "literal", value } }], notices: [] };
}

/**
 * Continues a drag of a slider's knob. It writes `value` from where the pointer
 * is along the track, held to the ends and rounded to the step, and the write
 * is absolute, so the knob stays under the pointer.
 */
function knobMove(
  state: InteractionState,
  knob: KnobState,
  screenPoint: ScreenPoint,
  objects: readonly GraphObject[],
  journal: readonly MutationJournalEntry[],
  camera: CameraState,
  context: EvalContext,
): PointerMoveOutcome {
  const object = objects.find((candidate) => candidate.id === knob.objectId);
  const layout = object === undefined ? undefined : sliderLayout(object);
  if (object === undefined || layout === undefined) {
    return {
      state: idle(state),
      objects,
      journal,
      notices: [`the slider being set (id "${knob.objectId}") no longer exists — drag ended`],
      rejection: undefined,
    };
  }
  const plan = planAbsoluteWrite(object, objects, SLIDER_VALUE_PATH, sliderValueUnder(layout, screenToWorld(camera, screenPoint).x), "move");
  const fresh = plan.notices.filter((notice) => !knob.emittedNotices.includes(notice));
  const advanced: InteractionState = {
    ...idle(state),
    knob: { ...knob, emittedNotices: fresh.length === 0 ? knob.emittedNotices : [...knob.emittedNotices, ...fresh] },
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
  if (object.type === FRAME_TYPE) {
    return { widthPath: FRAME_WIDTH_PATH, heightPath: FRAME_HEIGHT_PATH, keepsRatio: false, dropsAutoresize: false };
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

/**
 * Ends a drag, a resize, a bend or a selection box. A drag that never passed
 * the threshold after a press on a selected object is a click, and the click
 * lands here, unless the browser cancelled the press.
 */
export function pointerUp(state: InteractionState, cancelled: boolean = false): InteractionState {
  if (state.drag === undefined && state.resize === undefined && state.bend === undefined && state.marquee === undefined && state.knob === undefined) {
    return state;
  }
  // A cancelled press is no click, so it leaves the selection as it was.
  const click = state.drag !== undefined && !state.drag.moved && !cancelled ? state.drag.click : undefined;
  if (click === undefined) {
    return idle(state);
  }
  const selectedObjectIds = click.selects === "alone" ? [click.objectId] : state.selectedObjectIds.filter((id) => id !== click.objectId);
  return idle({ ...state, selectedObjectIds });
}

export function deselect(): InteractionState {
  return INITIAL_INTERACTION_STATE;
}

interface ComponentPlan {
  readonly operation: Operation | undefined;
  readonly notice: string | undefined;
}

export interface DragPlan {
  readonly operations: readonly Operation[];
  readonly notices: readonly string[];
}

/**
 * The writes that move a whole object by a delta, as a drag of it does: its
 * origin, or every vertex of a path with no origin, and a group with
 * everything in it. A slot a formula drives holds still and gives a notice.
 * Arrangement moves objects through this, so it follows the rule of a drag.
 */
export function planMove(object: GraphObject, objects: readonly GraphObject[], deltaX: number, deltaY: number): DragPlan {
  const moved = object.type === "group" ? [object, ...groupDescendants(object.id, objects)] : [object];
  return joinPlans(moved.map((each) => planDrag(each, objects, deltaX, deltaY, everyVertexOfPath(each))));
}

/** One plan holding the writes and notices of several, which is how a group moves with everything in it. */
function joinPlans(plans: readonly DragPlan[]): DragPlan {
  return { operations: plans.flatMap((plan) => plan.operations), notices: plans.flatMap((plan) => plan.notices) };
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
