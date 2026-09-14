/**
 * main.ts
 *
 * The only file that owns the browser. It holds AppState, finds the real
 * DOM elements, and wires the engine, the renderer and the command line to
 * each other.
 *
 * Almost everything in this file is a pure transition: a function from
 * AppState and an event to a new AppState, with no DOM call inside it.
 * submitLine, pointerDownAt, wheelZoomAt and the rest are all that shape.
 * That is why a file of this size has a full test suite that runs without a
 * browser. Keeping it that way costs nothing: new logic belongs in a
 * transition, and the DOM work belongs at the edge where the transitions
 * are called.
 *
 * buildPanelModel groups a path by its parts. A vertex owns seven slots, so
 * a flat list of rows gave a four vertex path 32 rows and buried the four
 * rows belonging to the object itself. The model instead holds the object's
 * own modifiable rows, one PanelPartRow for each vertex, and the derived
 * rows below a rule. A part row carries the index, the position, and a chip
 * showing the shape of the edge that leaves it. It opens into its own slot
 * rows only while the interaction layer has that part focused, and the four
 * handle slots stay hidden until a handle actually turns the edge into a
 * curve.
 *
 * The in place editor mounts inside #stage rather than #panels. The overlay
 * is laid out in world units and one transform scales it, so mounting it in
 * the panel container would scale it twice.
 */
import {
  type CameraState,
  createEmptyDocument,
  deriveValidateAndEvaluate,
  mutate,
  type Document,
  type EvalContext,
  formatFormula,
  getSlot,
  type GraphObject,
  IMAGE_HEIGHT_PATH,
  IMAGE_PICTURE_ASPECT_PATH,
  IMAGE_PRESERVE_ASPECT_PATH,
  IMAGE_SOURCE_PATH,
  IMAGE_TYPE,
  IMAGE_WIDTH_PATH,
  loadDocument,
  NULL_EVAL_CONTEXT,
  saveDocument,
  isColorValue,
  polylineEdgeCount,
  slotKey,
  VERTEX_PART_SUFFIXES,
  vertexPartPath,
  vertexPartPaths,
  TEXT_CONTENT_PATH,
  type Value,
} from "./engine/index.ts";
import { DEFAULT_IMAGE_EXTENT, executeCommand, type CommandEffect } from "./command/commands.ts";
import { findCommandSpec, parseCommandBoolean, parseCommandNumber, type ClearCommand, type DeleteCommand, type SetFormulaCommand, type SetLiteralCommand, type UnlinkCommand } from "./command/parser.ts";
import { beginCommand, cancelCommand, respond, type CommandSession, type PendingCommand, type PromptResponse } from "./command/prompt.ts";
import { buildSlotDescriptors, describeSlotValue, type SlotDescriptor } from "./command/props.ts";
import { clampCamera, clampZoom, panByScreenDelta, screenToWorld, zoomAtScreenPoint, MAX_ZOOM, MIN_ZOOM, type ScreenPoint, type WorldPoint } from "./render/camera.ts";
import {
  editorPlacement,
  editorTargetAt,
  editorTextBoxSize,
  editorTextStyle,
  type EditorTarget,
  type EditorTextStyle,
} from "./render/editor.ts";
import { documentExtent, objectExtent, type WorldExtent } from "./render/extent.ts";
import {
  deselect,
  pointerDown,
  pointerMove,
  pointerUp,
  focusPathPart,
  pathGripUnder,
  resizeHandleUnder,
  INITIAL_INTERACTION_STATE,
  type InteractionState,
} from "./render/interaction.ts";
import { resizeCursor } from "./render/handles.ts";
import { placePropertiesPanel, type PanelPlacement } from "./render/panel.ts";
import { fitBitmapIntoBox, renderDocument, type PathPreview } from "./render/renderer.ts";
import { menuCommandLine, pathMenuAt, type PathMenu } from "./render/menu.ts";
import { edgeShape, type EdgeShape, type PathGrip } from "./render/grips.ts";
import { createImageBitmapCache, decodeBitmap } from "./render/images.ts";
import { readNumber } from "./render/slots.ts";
import "mathlive";
import "mathlive/static.css";
import "mathlive/fonts.css";
import { createCanvas2dTextMeasurer, createSourceTextMeasurer } from "./render/measure.ts";
import { createMathMeasurer, mathMarkup, mathOverlayPlacement, readMathDrawnLatex, readMathLatex } from "./render/math.ts";
import { hitTest } from "./render/hittest.ts";

export interface Viewport {
  readonly width: number;
  readonly height: number;
}

export interface PanelUiState {
  readonly dismissed: boolean;
  readonly manualPosition: PanelPlacement | undefined;
}

const DEFAULT_PANEL_UI_STATE: PanelUiState = { dismissed: false, manualPosition: undefined };

export type PanelUiRegistry = Readonly<Record<string, PanelUiState>>;

export interface AppState {
  readonly document: Document;
  readonly interaction: InteractionState;
  readonly pending: PendingCommand | undefined;
  readonly log: readonly string[];
  readonly panels: PanelUiRegistry;
  /** Where the pointer sits in world units. A half finished command draws to it. */
  readonly pointer: WorldPoint | undefined;
}

export type FileRequest = "save" | "load";

export interface AppTransition {
  readonly state: AppState;
  readonly fileRequest: FileRequest | undefined;
  readonly refused: boolean;
  readonly openEditor?: EditorTarget;

  readonly pickImageFor?: string;
}

export function initialAppState(document: Document, log: readonly string[] = []): AppState {
  return {
    document: { ...document, camera: clampCamera(document.camera) },
    interaction: INITIAL_INTERACTION_STATE,
    pending: undefined,
    pointer: undefined,
    log,
    panels: {},
  };
}

function withCamera(state: AppState, camera: CameraState): AppState {
  return { ...state, document: { ...state.document, camera } };
}

function withLog(state: AppState, lines: readonly string[]): AppState {
  return lines.length === 0 ? state : { ...state, log: [...state.log, ...lines] };
}

function withInteraction(state: AppState, interaction: InteractionState): AppState {
  return { ...state, interaction, panels: prunePanelsToSelection(state.panels, interaction.selectedObjectIds) };
}

function prunePanelsToSelection(panels: PanelUiRegistry, selectedObjectIds: readonly string[]): PanelUiRegistry {
  const selected = new Set(selectedObjectIds);
  const kept = Object.entries(panels).filter(([objectId]) => selected.has(objectId));
  return kept.length === Object.keys(panels).length ? panels : Object.fromEntries(kept);
}

function panelUiState(state: AppState, objectId: string): PanelUiState {
  return state.panels[objectId] ?? DEFAULT_PANEL_UI_STATE;
}

export function dismissPanel(state: AppState, objectId: string): AppState {
  if (!state.interaction.selectedObjectIds.includes(objectId)) {
    return state;
  }
  return { ...state, panels: { ...state.panels, [objectId]: { ...panelUiState(state, objectId), dismissed: true } } };
}

export function movePanel(state: AppState, objectId: string, position: PanelPlacement): AppState {
  if (!state.interaction.selectedObjectIds.includes(objectId)) {
    return state;
  }
  return { ...state, panels: { ...state.panels, [objectId]: { ...panelUiState(state, objectId), manualPosition: position } } };
}

function transition(state: AppState, refused: boolean = false): AppTransition {
  return { state, fileRequest: undefined, refused };
}

export function submitLine(
  state: AppState,
  line: string,
  viewport: Viewport,
  context: EvalContext = NULL_EVAL_CONTEXT,
): AppTransition {
  const echoed = withLog(state, [`> ${line}`]);
  if (state.pending !== undefined) {
    return advance(echoed, respond(state.pending, { kind: "typed", text: line }), viewport, context);
  }
  return advance(echoed, beginCommand(line), viewport, context);
}

export function respondToPrompt(
  state: AppState,
  response: PromptResponse,
  viewport: Viewport,
  context: EvalContext = NULL_EVAL_CONTEXT,
): AppTransition {
  if (state.pending === undefined) {
    return transition(state);
  }
  return advance(state, respond(state.pending, response), viewport, context);
}

/**
 * The shape a half finished command draws now, or nothing.
 *
 * The command layer knows what its own answers mean, so it builds the points
 * and the bulges. This function only carries the pointer across.
 */
export function promptPreview(state: AppState): PathPreview | undefined {
  const pending = state.pending;
  if (pending === undefined) {
    return undefined;
  }
  const shape = findCommandSpec(pending.commandName)?.previewFromPrompts?.(pending.answers, state.pointer);
  return shape === undefined || shape.points.length === 0
    ? undefined
    : { points: shape.points, bulges: shape.bulges, closed: shape.closed };
}

export function escape(state: AppState): AppState {
  const cancelled = state.pending === undefined ? state : withLog({ ...state, pending: undefined }, [sessionMessage(cancelCommand())]);
  return withInteraction(cancelled, deselect());
}

function advance(state: AppState, session: CommandSession, viewport: Viewport, context: EvalContext): AppTransition {
  switch (session.status) {
    case "complete": {
      const cleared: AppState = { ...state, pending: undefined };
      const outcome = executeCommand(session.command, cleared.document, context);
      if (!outcome.ok) {
        return transition(withLog(cleared, [outcome.message]), true);
      }
      const executed = withLog({ ...cleared, document: outcome.document }, outcome.lines);
      if (outcome.effect !== undefined) {
        return performEffect(outcome.effect, executed, viewport);
      }
      if (session.command.kind === "text" && session.command.content === "" && outcome.createdObjectId !== undefined) {
        return { state: executed, fileRequest: undefined, refused: false, openEditor: { kind: "text", objectId: outcome.createdObjectId } };
      }
      if (session.command.kind === "image" && outcome.createdObjectId !== undefined) {
        return { state: executed, fileRequest: undefined, refused: false, pickImageFor: outcome.createdObjectId };
      }
      return transition(executed);
    }
    case "prompting":
      return transition(withLog({ ...state, pending: session.pending }, sessionLines(session)), session.error !== undefined);
    case "failed":
    case "cancelled":
      return transition(withLog({ ...state, pending: undefined }, [sessionMessage(session)]), true);
    default: {
      const exhaustive: never = session;
      void exhaustive;
      return transition(state);
    }
  }
}

function sessionLines(session: Extract<CommandSession, { status: "prompting" }>): readonly string[] {
  return session.error === undefined ? [session.message] : [session.error, session.message];
}

function sessionMessage(session: CommandSession): string {
  switch (session.status) {
    case "failed":
      return session.message;
    case "cancelled":
      return "cancelled";
    case "prompting":
      return session.message;
    case "complete":
      return "";
    default: {
      const exhaustive: never = session;
      void exhaustive;
      return "";
    }
  }
}

export const FIT_VIEWPORT_FRACTION = 0.9;

export const WHEEL_ZOOM_STEP = 1.1;

export function performEffect(effect: CommandEffect, state: AppState, viewport: Viewport): AppTransition {
  switch (effect.kind) {
    case "select":
      return transition(withInteraction(state, { ...INITIAL_INTERACTION_STATE, selectedObjectIds: [effect.objectId] }));
    case "zoom":
      return transition(zoomBy(state, effect.factor, viewport));
    case "fit":
      return transition(fitToDocument(state, viewport));
    case "save":
      return { state, fileRequest: "save", refused: false };
    case "load":
      return { state, fileRequest: "load", refused: false };
    default: {
      const exhaustive: never = effect;
      void exhaustive;
      return transition(state);
    }
  }
}

function zoomBy(state: AppState, factor: number, viewport: Viewport): AppState {
  const camera = state.document.camera;
  const requested = camera.zoom * factor;
  const zoomed = zoomAtScreenPoint(camera, { x: viewport.width / 2, y: viewport.height / 2 }, requested);
  return withLog(withCamera(state, zoomed), [describeZoom(zoomed.zoom, requested)]);
}

function fitToDocument(state: AppState, viewport: Viewport): AppState {
  const camera = state.document.camera;
  const extent = documentExtent(state.document.objects);
  if (extent === undefined) {
    return withLog(state, ["nothing on the canvas has an extent to fit to"]);
  }
  const width = extent.maxX - extent.minX;
  const height = extent.maxY - extent.minY;
  const fits = (width > 0 || height > 0) && viewport.width > 0 && viewport.height > 0;
  const zoom = fits
    ? clampZoom(Math.min((viewport.width * FIT_VIEWPORT_FRACTION) / width, (viewport.height * FIT_VIEWPORT_FRACTION) / height), camera.zoom)
    : camera.zoom;
  const centreX = (extent.minX + extent.maxX) / 2;
  const centreY = (extent.minY + extent.maxY) / 2;
  const fitted = clampCamera({ x: centreX - viewport.width / (2 * zoom), y: centreY - viewport.height / (2 * zoom), zoom });
  const line = fits ? describeZoom(fitted.zoom, fitted.zoom) : `the document's extent is a single point — centred it at zoom ${fitted.zoom}`;
  return withLog(withCamera(state, fitted), [line]);
}

function describeZoom(actual: number, requested: number): string {
  return actual === requested ? `zoom is now ${actual}` : `zoom is now ${actual} — clamped to the ${MIN_ZOOM}-${MAX_ZOOM} range`;
}

export function pointerDownAt(
  state: AppState,
  screenPoint: ScreenPoint,
  viewport: Viewport,
  additive: boolean = false,
  context: EvalContext = NULL_EVAL_CONTEXT,
): AppTransition {
  if (state.pending !== undefined) {
    const world = screenToWorld(state.document.camera, screenPoint);
    return respondToPrompt(state, { kind: "picked", point: { x: world.x, y: world.y } }, viewport, context);
  }
  return transition(withInteraction(state, pointerDown(state.interaction, screenPoint, state.document.objects, state.document.camera, additive)));
}

export function pointerMoveTo(
  state: AppState,
  screenPoint: ScreenPoint,
  context: EvalContext = NULL_EVAL_CONTEXT,
): AppState {
  const outcome = pointerMove(
    state.interaction,
    screenPoint,
    state.document.objects,
    state.document.journal,
    state.document.camera,
    context,
  );
  const moved: AppState = {
    ...state,
    document: { ...state.document, objects: outcome.objects, journal: outcome.journal },
    interaction: outcome.state,
    pointer: screenToWorld(state.document.camera, screenPoint),
  };
  const lines = outcome.rejection === undefined ? outcome.notices : [...outcome.notices, outcome.rejection];
  return withLog(moved, lines);
}

export function pointerUpNow(state: AppState): AppState {
  return { ...state, interaction: pointerUp(state.interaction) };
}

export function wheelZoomAt(state: AppState, screenPoint: ScreenPoint, wheelDeltaY: number): AppState {
  const camera = state.document.camera;
  const factor = wheelDeltaY < 0 ? WHEEL_ZOOM_STEP : 1 / WHEEL_ZOOM_STEP;
  return withCamera(state, zoomAtScreenPoint(camera, screenPoint, camera.zoom * factor));
}

export function panByScreen(state: AppState, dxScreen: number, dyScreen: number): AppState {
  return withCamera(state, panByScreenDelta(state.document.camera, dxScreen, dyScreen));
}

export function logLine(state: AppState, line: string): AppState {
  return withLog(state, [line]);
}

export function replaceDocument(state: AppState, document: Document, line: string): AppState {
  return withLog(initialAppState(document, state.log), [line]);
}

export interface PanelRow {
  readonly path: string;
  readonly value: string;
  readonly editSeed: string;
  readonly formulaSource: string | undefined;
  readonly kind: "literal" | "formula" | "derived";
  readonly synthetic: boolean;

  readonly picker: boolean;

  readonly choices: PanelRowChoices | undefined;

  /** The colour a swatch shows, for a literal colour slot. Undefined for every other row. */
  readonly color: PanelRowColor | undefined;
}

export interface PanelRowColor {
  /**
   * What the picker opens on. A slot with no colour opens on black.
   */
  readonly seed: string;
  /**
   * True when the slot has no colour at all.
   */
  readonly none: boolean;
}

export interface PanelRowChoices {
  readonly labels: readonly string[];
  readonly values: readonly (number | string | boolean)[];
  readonly selectedIndex: number;
}

/** Which part of one vertex row the operator opened, if either. */
export type PanelPartFocus = "none" | "vertex" | "edge";

/**
 * One vertex of a path, as one row.
 *
 * A vertex owns seven slots. Seven rows for each vertex buries the four rows
 * the object itself has, and the panel then grows past the drawing it
 * describes. So a vertex reads as one line: its index, where it is, and a chip
 * for the shape of the edge it leaves. A click on either half opens that part.
 */
export interface PanelPartRow {
  readonly index: number;
  readonly position: string;
  /** The shape of the edge that leaves this vertex. The last vertex of an open path has none. */
  readonly shape: EdgeShape | undefined;
  /** True while a literal holds both halves of the position, so a drag can move it. */
  readonly free: boolean;
  readonly focus: PanelPartFocus;
  /** The slot rows the open part shows. Empty while the part is shut. */
  readonly rows: readonly PanelRow[];
}

export interface PanelModel {
  readonly header: string;
  readonly modifiable: readonly PanelRow[];
  readonly parts: readonly PanelPartRow[];
  readonly derived: readonly PanelRow[];
}

export function buildPanelModel(
  object: GraphObject,
  objects: readonly GraphObject[],
  focus: PathGrip | undefined = undefined,
): PanelModel {
  const descriptors = buildSlotDescriptors(object, objects);
  const rowOf = (descriptor: SlotDescriptor): PanelRow => ({
    path: slotKey(descriptor.path),
    picker: isPictureSourceRow(object, descriptor),
    value: isPictureSourceRow(object, descriptor) ? describePictureSource(descriptor.value) : describeSlotValue(descriptor.value, { maxDecimals: 4 }),
    editSeed: describeSlotValue(descriptor.value, { fullStrings: true }),
    formulaSource: descriptor.formulaSource,
    kind: descriptor.kind,
    synthetic: descriptor.synthetic === true,
    choices: resolveChoices(descriptor),
    color: resolveColor(descriptor),
  });

  const byKey = new Map(descriptors.map((descriptor) => [slotKey(descriptor.path), descriptor]));
  const vertexKeys = new Set<string>();
  const parts: PanelPartRow[] = [];
  for (let index = 0; index < (object.vertexCount ?? 0); index += 1) {
    for (const path of vertexPartPaths(index)) {
      vertexKeys.add(slotKey(path));
    }
    parts.push(buildPartRow(object, index, byKey, rowOf, focus));
  }

  const modifiable = descriptors.filter((descriptor) => descriptor.kind !== "derived" && !vertexKeys.has(slotKey(descriptor.path)));
  return {
    header: object.name,
    modifiable: modifiable.map(rowOf),
    parts,
    derived: descriptors.filter((descriptor) => descriptor.kind === "derived").map(rowOf),
  };
}

function buildPartRow(
  object: GraphObject,
  index: number,
  byKey: ReadonlyMap<string, SlotDescriptor>,
  rowOf: (descriptor: SlotDescriptor) => PanelRow,
  focus: PathGrip | undefined,
): PanelPartRow {
  const at = (suffix: readonly string[]): SlotDescriptor | undefined => byKey.get(slotKey(vertexPartPath(index, suffix)));
  const held = (suffix: readonly string[]): SlotDescriptor[] => {
    const found = at(suffix);
    return found === undefined ? [] : [found];
  };
  const shape = edgeShape(object, index);
  // The four handle slots are 0 on nearly every vertex. They stay out of
  // sight until a handle turns the edge into a curve.
  const curveSuffixes = shape === "curve" ? VERTEX_PART_SUFFIXES.slice(2) : [["bulge"]];
  const partFocus: PanelPartFocus =
    focus === undefined || focus.index !== index ? "none" : focus.kind === "vertex" ? "vertex" : "edge";
  const open =
    partFocus === "vertex"
      ? [...held(["x"]), ...held(["y"])]
      : partFocus === "edge"
        ? curveSuffixes.flatMap((suffix) => held(suffix))
        : [];
  return {
    index,
    position: describePartPosition(at(["x"])?.value, at(["y"])?.value),
    shape: index < polylineEdgeCount(object) ? shape : undefined,
    free: at(["x"])?.kind === "literal" && at(["y"])?.kind === "literal",
    focus: partFocus,
    rows: open.map(rowOf),
  };
}

function describePartPosition(x: Value | undefined, y: Value | undefined): string {
  return `${describeSlotValue(x ?? null, { maxDecimals: 2 })}, ${describeSlotValue(y ?? null, { maxDecimals: 2 })}`;
}

/**
 * The swatch a colour row shows, or nothing.
 *
 * Only a literal gets one. A formula drives its own value, and a swatch that
 * silently replaced a formula is the one gesture the panel does not offer.
 */
function resolveColor(descriptor: SlotDescriptor): PanelRowColor | undefined {
  if (descriptor.format !== "color" || descriptor.kind !== "literal") {
    return undefined;
  }
  const value = descriptor.value;
  return typeof value === "string" && isColorValue(value)
    ? { seed: value, none: false }
    : { seed: "#000000", none: value === null };
}

function isPictureSourceRow(object: GraphObject, descriptor: SlotDescriptor): boolean {
  return object.type === IMAGE_TYPE && descriptor.kind === "literal" && slotKey(descriptor.path) === slotKey(IMAGE_SOURCE_PATH);
}

function describePictureSource(value: Value): string {
  if (typeof value !== "string" || value === "") {
    return "no picture chosen";
  }
  const match = /^data:([^;,]*)[;,]/.exec(value);
  if (match === null) {
    return describeSlotValue(value);
  }
  const kind = (match[1] ?? "").replace(/^image\//, "").toUpperCase();
  const kilobytes = Math.round((value.length * 3) / 4 / 1024);
  return `${kind === "" ? "picture" : `${kind} picture`} · about ${kilobytes} KB`;
}

function resolveChoices(descriptor: SlotDescriptor): PanelRowChoices | undefined {
  if (descriptor.options === undefined || descriptor.kind !== "literal") {
    return undefined;
  }
  const { values, labels } = descriptor.options;
  return {
    values,
    labels: values.map((value, index) => labels?.[index] ?? String(value)),
    selectedIndex: values.findIndex((value) => value === descriptor.value),
  };
}

function panelSlotAddress(objectName: string, path: string): string {
  return `${objectName}.${path}`;
}

function buildPanelSetCommand(target: string, raw: string): SetLiteralCommand | SetFormulaCommand {
  const trimmed = raw.trim();
  const asNumber = parseCommandNumber(trimmed);
  if (asNumber !== undefined) {
    return { kind: "set", target, value: asNumber };
  }
  const expression = trimmed.startsWith("=") ? trimmed.slice(1) : trimmed;
  return { kind: "set-formula", target, source: `=${expression}` };
}

function describePanelCommand(command: SetLiteralCommand | SetFormulaCommand | UnlinkCommand | ClearCommand | DeleteCommand): string {
  switch (command.kind) {
    case "set":
      return `set ${command.target} ${typeof command.value === "boolean" ? (command.value ? "TRUE" : "FALSE") : command.value}`;
    case "set-formula":
      return `set ${command.target} ${command.source}`;
    case "unlink":
      return `unlink ${command.target}`;
    case "clear":
      return `clear ${command.target}`;
    case "delete":
      return `delete ${command.target}`;
    default: {
      const exhaustive: never = command;
      void exhaustive;
      return "";
    }
  }
}

function runPanelCommand(
  state: AppState,
  command: SetLiteralCommand | SetFormulaCommand | UnlinkCommand | ClearCommand | DeleteCommand,
  context: EvalContext,
): AppState {
  const echoed = withLog(state, [`> ${describePanelCommand(command)}`]);
  const outcome = executeCommand(command, echoed.document, context);
  if (!outcome.ok) {
    return withLog(echoed, [outcome.message]);
  }
  return withLog({ ...echoed, document: outcome.document }, outcome.lines);
}

export function commitPanelEdit(
  state: AppState,
  objectId: string,
  path: string,
  raw: string,
  context: EvalContext = NULL_EVAL_CONTEXT,
): AppState {
  const object = state.document.objects.find((candidate) => candidate.id === objectId);
  if (object === undefined) {
    return state;
  }
  return runPanelCommand(state, buildPanelSetCommand(panelSlotAddress(object.name, path), raw), context);
}

export function commitPanelChoice(
  state: AppState,
  objectId: string,
  path: string,
  value: number | string | boolean,
  context: EvalContext = NULL_EVAL_CONTEXT,
): AppState {
  const object = state.document.objects.find((candidate) => candidate.id === objectId);
  if (object === undefined) {
    return state;
  }
  const written = runPanelCommand(state, { kind: "set", target: panelSlotAddress(object.name, path), value }, context);
  return restorePictureAspect(written, objectId, context);
}

export function unlinkPanelSlot(
  state: AppState,
  objectId: string,
  path: string,
  context: EvalContext = NULL_EVAL_CONTEXT,
): AppState {
  const object = state.document.objects.find((candidate) => candidate.id === objectId);
  if (object === undefined) {
    return state;
  }
  return runPanelCommand(state, { kind: "unlink", target: panelSlotAddress(object.name, path) }, context);
}

const TABLE_CELL_PREFIX = "cells";

export function editorSeed(state: AppState, target: EditorTarget): string {
  const object = state.document.objects.find((candidate) => candidate.id === target.objectId);
  if (object === undefined) {
    return "";
  }
  if (target.kind === "text") {
    const value = getSlot(object, TEXT_CONTENT_PATH)?.value;
    return typeof value === "string" ? value : "";
  }
  const slot = getSlot(object, [TABLE_CELL_PREFIX, target.cell]);
  if (slot === undefined) {
    return "";
  }
  return slot.kind === "formula" ? `=${formatFormula(slot.ast, state.document.objects, object.id)}` : cellLiteralSeed(slot.value);
}

function cellLiteralSeed(value: Value): string {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number") {
    return String(value);
  }
  if (typeof value === "boolean") {
    return value ? "TRUE" : "FALSE";
  }
  return "";
}

export function commitTextContent(
  state: AppState,
  objectId: string,
  raw: string,
  context: EvalContext = NULL_EVAL_CONTEXT,
): AppState {
  const object = state.document.objects.find((candidate) => candidate.id === objectId);
  if (object === undefined) {
    return state;
  }
  return runPanelCommand(state, { kind: "set", target: panelSlotAddress(object.name, slotKey(TEXT_CONTENT_PATH)), value: raw }, context);
}

/**
 * Writes a new source onto a math object, through the mutation that rebuilds
 * the slots the source implies. It goes straight to that mutation rather than
 * through a set command, because writing the source slot on its own would
 * leave the ports of the last source behind.
 *
 * A source that does not read leaves the object as it was and says so, which
 * is the same answer the command line gives for the same text.
 */
export function commitMathSource(
  state: AppState,
  objectId: string,
  latex: string,
  context: EvalContext = NULL_EVAL_CONTEXT,
): AppState {
  const object = state.document.objects.find((candidate) => candidate.id === objectId);
  if (object === undefined) {
    return state;
  }
  if (readMathLatex(object) === latex) {
    return state;
  }

  const echoed = withLog(state, [`> ${object.name} = "${latex}"`]);
  const result = mutate(
    echoed.document.objects,
    [{ kind: "setMathSource", objectId, source: latex }],
    echoed.document.journal,
    context,
  );
  if (!result.ok) {
    return withLog(echoed, [result.message]);
  }
  return withLog(
    { ...echoed, document: { ...echoed.document, objects: result.objects, journal: result.journal } },
    [`${object.name} holds ${result.objects.find((entry) => entry.id === objectId)?.ports?.out.length ?? 0} value(s)`],
  );
}

export function pictureBoxSize(naturalWidth: number, naturalHeight: number): { readonly width: number; readonly height: number } {
  const usable =
    naturalWidth > 0 && naturalHeight > 0 && Number.isFinite(naturalWidth) && Number.isFinite(naturalHeight);
  if (!usable) {
    return { width: DEFAULT_IMAGE_EXTENT, height: DEFAULT_IMAGE_EXTENT };
  }
  const scale = DEFAULT_IMAGE_EXTENT / Math.max(naturalWidth, naturalHeight);
  return { width: naturalWidth * scale, height: naturalHeight * scale };
}

export function commitImagePicture(
  state: AppState,
  objectId: string,
  dataUrl: string,
  natural: { readonly naturalWidth: number; readonly naturalHeight: number } | undefined,
  context: EvalContext = NULL_EVAL_CONTEXT,
): AppState {
  const object = state.document.objects.find((candidate) => candidate.id === objectId);
  if (object === undefined || dataUrl === "") {
    return state;
  }
  const box = natural === undefined ? undefined : pictureBoxSize(natural.naturalWidth, natural.naturalHeight);
  const aspect = natural === undefined ? 0 : usableAspect(natural.naturalWidth, natural.naturalHeight);
  const shape =
    natural === undefined
      ? "did not decode, box unchanged"
      : `${natural.naturalWidth}x${natural.naturalHeight}, box ${round(box?.width)}x${round(box?.height)}`;
  const writes = [
    { path: IMAGE_SOURCE_PATH, value: dataUrl },
    ...(box === undefined
      ? []
      : [
          { path: IMAGE_WIDTH_PATH, value: box.width },
          { path: IMAGE_HEIGHT_PATH, value: box.height },
          { path: IMAGE_PICTURE_ASPECT_PATH, value: aspect },
        ]),
  ];
  const echoed = withLog(state, [`> picture into ${object.name} — ${dataUrl.length} characters, ${shape}`]);
  return commitGestureWrites(echoed, object, writes, context);
}

function round(value: number | undefined): string {
  return value === undefined ? "?" : String(Math.round(value * 100) / 100);
}

function commitGestureWrites(
  state: AppState,
  object: GraphObject,
  entries: readonly { readonly path: readonly string[]; readonly value: number | string | boolean }[],
  context: EvalContext,
): AppState {
  let next = state;
  for (const entry of entries) {
    const slot = getSlot(object, entry.path);
    if (slot !== undefined && slot.kind !== "literal") {
      const driver = slot.kind === "derived" ? "schema" : "formula";
      next = withLog(next, [`${object.name}.${slotKey(entry.path)} left alone: it is driven by a ${driver} (unlink it first)`]);
      continue;
    }
    const command: SetLiteralCommand = { kind: "set", target: panelSlotAddress(object.name, slotKey(entry.path)), value: entry.value };
    const outcome = executeCommand(command, next.document, context);
    next = outcome.ok ? { ...next, document: outcome.document } : withLog(next, [outcome.message]);
  }
  return next;
}

function usableAspect(naturalWidth: number, naturalHeight: number): number {
  if (!(naturalWidth > 0) || !(naturalHeight > 0) || !Number.isFinite(naturalWidth) || !Number.isFinite(naturalHeight)) {
    return 0;
  }
  return naturalWidth / naturalHeight;
}

export function restorePictureAspect(state: AppState, objectId: string, context: EvalContext = NULL_EVAL_CONTEXT): AppState {
  const object = state.document.objects.find((candidate) => candidate.id === objectId);
  if (object === undefined || object.type !== IMAGE_TYPE) {
    return state;
  }
  if (getSlot(object, IMAGE_PRESERVE_ASPECT_PATH)?.value === false) {
    return state;
  }
  const aspect = readNumber(object, IMAGE_PICTURE_ASPECT_PATH) ?? 0;
  const width = readNumber(object, IMAGE_WIDTH_PATH);
  const height = readNumber(object, IMAGE_HEIGHT_PATH);
  if (usableAspect(aspect, 1) === 0 || width === undefined || height === undefined || !(width > 0) || !(height > 0)) {
    return state;
  }
  const fitted = fitBitmapIntoBox(width, height, aspect, 1);
  if (fitted.width === width && fitted.height === height) {
    return state;
  }
  const echoed = withLog(state, [`> ${object.name} back to the picture's proportions — box ${round(fitted.width)}x${round(fitted.height)}`]);
  return commitGestureWrites(
    echoed,
    object,
    [
      { path: IMAGE_WIDTH_PATH, value: fitted.width },
      { path: IMAGE_HEIGHT_PATH, value: fitted.height },
    ],
    context,
  );
}

export function abandonCreatedTextBox(
  state: AppState,
  objectId: string,
  context: EvalContext = NULL_EVAL_CONTEXT,
): AppState {
  const object = state.document.objects.find((candidate) => candidate.id === objectId);
  if (object === undefined) {
    return state;
  }
  const content = getSlot(object, TEXT_CONTENT_PATH)?.value;
  if (typeof content === "string" && content !== "") {
    return state;
  }
  return runPanelCommand(state, { kind: "delete", target: object.name, force: false }, context);
}

export function commitTableCell(
  state: AppState,
  objectId: string,
  cell: string,
  raw: string,
  context: EvalContext = NULL_EVAL_CONTEXT,
): AppState {
  const object = state.document.objects.find((candidate) => candidate.id === objectId);
  if (object === undefined) {
    return state;
  }
  return runPanelCommand(state, buildCellCommand(panelSlotAddress(object.name, cell), raw), context);
}

function buildCellCommand(target: string, raw: string): SetLiteralCommand | SetFormulaCommand | ClearCommand {
  const trimmed = raw.trim();
  if (trimmed === "") {
    return { kind: "clear", target };
  }
  if (trimmed.startsWith("=")) {
    return { kind: "set-formula", target, source: trimmed };
  }
  const asNumber = parseCommandNumber(trimmed);
  if (asNumber !== undefined) {
    return { kind: "set", target, value: asNumber };
  }
  const asBoolean = parseCommandBoolean(trimmed);
  if (asBoolean !== undefined) {
    return { kind: "set", target, value: asBoolean };
  }
  return { kind: "set", target, value: trimmed };
}

interface PanGesture {
  readonly lastScreenX: number;
  readonly lastScreenY: number;
}

interface PanelDragGesture {
  readonly objectId: string;
  readonly offsetLeft: number;
  readonly offsetTop: number;
}

interface PanelEditHandlers {
  readonly onCommit: (raw: string) => void;
  readonly onCancel: () => void;
}

interface PanelRowEdit {
  readonly path: string;
  readonly handlers: PanelEditHandlers;
}

function start(canvas: HTMLCanvasElement, logElement: HTMLElement, input: HTMLInputElement, panelsContainer: HTMLElement): void {
  const context = canvas.getContext("2d");
  if (context === null) {
    logElement.textContent = "this browser gave no 2D canvas context — nothing can be drawn";
    return;
  }

  const measureContext = document.createElement("canvas").getContext("2d");

  // Notation is laid out by a real element, because its size follows the fonts
  // of the page. The element sits outside the flow so that measuring it moves
  // nothing an operator can see.
  const mathMeasureHost = document.createElement("div");
  mathMeasureHost.className = "math-measure";
  document.body.appendChild(mathMeasureHost);

  const measureMath = createMathMeasurer(mathMeasureHost);
  const evalContext: EvalContext =
    measureContext === null
      ? NULL_EVAL_CONTEXT
      : { measurer: { ...createCanvas2dTextMeasurer(measureContext), measureMath } };
  const sourceMeasurer = measureContext === null ? evalContext.measurer : createSourceTextMeasurer(measureContext);

  let state = initialAppState(createEmptyDocument(), ["Graphpaper. Type a command, or a command word alone to be prompted."]);
  let pan: PanGesture | undefined;
  let spaceHeld = false;
  let openMenu: { readonly menu: PathMenu; readonly at: ScreenPoint } | undefined;
  let menuElement: HTMLElement | undefined;
  const panelElements = new Map<string, HTMLElement>();
  let panelDrag: PanelDragGesture | undefined;
  let openEditor: { readonly objectId: string; readonly path: string } | undefined;
  let inPlaceEditor: EditorTarget | undefined;
  let inPlaceElement: HTMLTextAreaElement | HTMLInputElement | undefined;
  let inPlaceEditorFromCreation = false;
  const editorLayer: HTMLElement = canvas.parentElement ?? panelsContainer;
  const mathOverlays = new Map<string, HTMLElement>();
  let editingMathId: string | undefined;
  let mathField: HTMLElement & { value: string } | undefined;
  const imageBitmaps = createImageBitmapCache(() => paint());

  const viewport = (): Viewport => ({ width: canvas.width, height: canvas.height });

  const screenPointOf = (event: MouseEvent): ScreenPoint => {
    const bounds = canvas.getBoundingClientRect();
    const ratioX = bounds.width > 0 ? canvas.width / bounds.width : 1;
    const ratioY = bounds.height > 0 ? canvas.height / bounds.height : 1;
    return { x: (event.clientX - bounds.left) * ratioX, y: (event.clientY - bounds.top) * ratioY };
  };

  const paint = (): void => {
    const ratio = window.devicePixelRatio > 0 ? window.devicePixelRatio : 1;
    const backingWidth = Math.round(canvas.clientWidth * ratio);
    const backingHeight = Math.round(canvas.clientHeight * ratio);
    if (canvas.width !== backingWidth || canvas.height !== backingHeight) {
      canvas.width = backingWidth;
      canvas.height = backingHeight;
    }
    const panelledIds = panelledObjectIds();
    renderDocument(
      context,
      canvas.width,
      canvas.height,
      state.document.objects,
      state.document.camera,
      state.interaction.selectedObjectIds,
      panelledIds,
      inPlaceEditor,
      imageBitmaps,
      promptPreview(state),
      state.interaction.focus?.grip,
    );
    updatePanels(panelledIds);
    updateMathOverlays();
    updateEditor();
  };

  /**
   * Puts one element over each math object and moves it with the camera. The
   * canvas pass has already drawn the box under it, so the two agree on where
   * the object is by taking the same world box.
   */
  const updateMathOverlays = (): void => {
    const ratio = window.devicePixelRatio > 0 ? window.devicePixelRatio : 1;
    const live = new Set<string>();

    for (const object of state.document.objects) {
      if (object.type !== "math") {
        continue;
      }
      const placement = mathOverlayPlacement(object, state.document.camera, ratio);
      if (placement === undefined) {
        continue;
      }
      live.add(object.id);

      let element = mathOverlays.get(object.id);
      if (element === undefined) {
        element = document.createElement("div");
        element.className = "math-overlay";
        editorLayer.appendChild(element);
        mathOverlays.set(object.id, element);
      }

      const latex = readMathLatex(object);
      const drawn = readMathDrawnLatex(object);
      const editing = object.id === editingMathId;
      element.classList.toggle("math-overlay--editing", editing);

      if (editing) {
        if (mathField === undefined || element.firstChild !== mathField) {
          element.innerHTML = "";
          mathField = buildMathField(object.id, latex);
          element.appendChild(mathField);
          delete element.dataset["latex"];
          mathField.focus();
        }
      } else if (element.dataset["latex"] !== drawn) {
        element.innerHTML = mathMarkup(drawn);
        element.dataset["latex"] = drawn;
      }
      element.style.left = `${placement.left}px`;
      element.style.top = `${placement.top}px`;
      element.style.width = `${placement.width}px`;
      element.style.height = `${placement.height}px`;
      element.style.padding = `${placement.padding}px`;
      element.style.fontSize = `${placement.fontSize}px`;
      element.style.transform = `scale(${placement.scale})`;
    }

    for (const [objectId, element] of [...mathOverlays]) {
      if (!live.has(objectId)) {
        element.remove();
        mathOverlays.delete(objectId);
      }
    }
  };

  /**
   * Builds the editable field for one math object. It is a MathLive element,
   * so an operator types the notation the way they would in Desmos rather than
   * writing LaTeX by hand, and its value is the LaTeX either way.
   *
   * A keystroke stops here rather than reaching the command line, which holds
   * focus for everything else on the page.
   */
  const buildMathField = (objectId: string, latex: string): HTMLElement & { value: string } => {
    const field = document.createElement("math-field") as HTMLElement & { value: string };
    field.className = "math-field";
    field.value = latex;
    field.setAttribute("math-virtual-keyboard-policy", "manual");

    field.addEventListener("keydown", (event) => {
      event.stopPropagation();
      const key = (event as KeyboardEvent).key;
      if (key === "Escape") {
        event.preventDefault();
        closeMathEditor();
        paint();
      } else if (key === "Enter") {
        event.preventDefault();
        commitMathEditor();
      }
    });
    field.addEventListener("blur", () => {
      commitMathEditor();
    });
    return field;
  };

  const closeMathEditor = (): void => {
    editingMathId = undefined;
    mathField = undefined;
    input.focus();
  };

  const commitMathEditor = (): void => {
    const objectId = editingMathId;
    const field = mathField;
    if (objectId === undefined || field === undefined) {
      return;
    }
    const latex = field.value;
    closeMathEditor();
    apply(commitMathSource(state, objectId, latex, evalContext));
  };

  const openMathEditor = (objectId: string): void => {
    editingMathId = objectId;
    mathField = undefined;
    paint();
  };

  /**
   * Measures every math object again and evaluates the document against the
   * new sizes. Notation measured before its fonts arrive comes out about a
   * sixth too narrow, so the box drawn around it is too small until this runs.
   *
   * It evaluates rather than mutating, because nothing about the document has
   * changed. Only the size of what was already there is now known properly, so
   * there is nothing for the journal to record.
   */
  const remeasureMath = (): void => {
    if (!state.document.objects.some((object) => object.type === "math")) {
      return;
    }
    measureMath.forget();
    const evaluated = deriveValidateAndEvaluate(state.document.objects, evalContext);
    if (!evaluated.ok) {
      return;
    }
    state = { ...state, document: { ...state.document, objects: evaluated.objects } };
    paint();
  };

  // A font finishing arrival changes what notation measures, and fonts arrive
  // after the first frame has already been drawn.
  if (typeof document.fonts?.addEventListener === "function") {
    document.fonts.addEventListener("loadingdone", () => {
      remeasureMath();
    });
  }

  const panelledObjectIds = (): readonly string[] => {
    const ids: string[] = [];
    for (const objectId of state.interaction.selectedObjectIds) {
      const object = state.document.objects.find((candidate) => candidate.id === objectId);
      const extent = object === undefined ? undefined : objectExtent(object);
      if (object === undefined || extent === undefined || panelUiState(state, objectId).dismissed) {
        continue;
      }
      ids.push(objectId);
    }
    return ids;
  };

  const updatePanels = (panelledIds: readonly string[]): void => {
    const shown = new Set(panelledIds);
    if (openEditor !== undefined && !shown.has(openEditor.objectId)) {
      openEditor = undefined;
    }
    for (const objectId of panelledIds) {
      const object = state.document.objects.find((candidate) => candidate.id === objectId);
      const extent = object === undefined ? undefined : objectExtent(object);
      if (object === undefined || extent === undefined) {
        continue;
      }
      const element = panelElement(objectId);
      const editing: PanelRowEdit | undefined =
        openEditor !== undefined && openEditor.objectId === objectId
          ? { path: openEditor.path, handlers: panelEditHandlers(objectId, openEditor.path) }
          : undefined;
      const alreadyShowingThisEditor = editing !== undefined && element.dataset.editingPath === editing.path;
      const holdsFocusedChoice =
        document.activeElement !== null &&
        element.contains(document.activeElement) &&
        document.activeElement.classList.contains("panel-row__choice");
      if (!alreadyShowingThisEditor && !holdsFocusedChoice) {
        const focus = state.interaction.focus?.objectId === objectId ? state.interaction.focus.grip : undefined;
        writePanel(element, buildPanelModel(object, state.document.objects, focus), editing);
        element.dataset.editingPath = editing?.path ?? "";
        if (editing !== undefined) {
          const opened = element.querySelector<HTMLInputElement>(".panel-row__input");
          if (opened === null) {
            openEditor = undefined;
          } else {
            opened.focus();
            opened.select();
          }
        }
      }
      placePanelElement(element, extent, panelUiState(state, objectId).manualPosition);
    }
    for (const [objectId, element] of panelElements) {
      if (!shown.has(objectId)) {
        element.remove();
        panelElements.delete(objectId);
      }
    }
  };

  const panelEditHandlers = (objectId: string, path: string): PanelEditHandlers => ({
    onCommit: (raw: string) => {
      openEditor = undefined;
      input.focus();
      apply(commitPanelEdit(state, objectId, path, raw, evalContext));
    },
    onCancel: () => {
      if (openEditor === undefined || openEditor.objectId !== objectId || openEditor.path !== path) {
        return;
      }
      openEditor = undefined;
      input.focus();
      paint();
    },
  });

  const panelElement = (objectId: string): HTMLElement => {
    const existing = panelElements.get(objectId);
    if (existing !== undefined) {
      return existing;
    }
    const element = document.createElement("div");
    element.className = "panel";
    element.dataset.objectId = objectId;
    panelsContainer.appendChild(element);
    panelElements.set(objectId, element);
    return element;
  };

  const placePanelElement = (element: HTMLElement, extent: WorldExtent, manualPosition: PanelPlacement | undefined): void => {
    if (manualPosition !== undefined) {
      element.style.left = `${manualPosition.left}px`;
      element.style.top = `${manualPosition.top}px`;
      return;
    }
    const bounds = canvas.getBoundingClientRect();
    const ratio = bounds.width > 0 ? canvas.width / bounds.width : 1;
    const panelRect = element.getBoundingClientRect();
    const placement = placePropertiesPanel(
      extent,
      state.document.camera,
      ratio,
      { width: bounds.width, height: bounds.height },
      { width: panelRect.width, height: panelRect.height },
    );
    element.style.left = `${placement.left}px`;
    element.style.top = `${placement.top}px`;
  };

  const removeInPlaceElement = (): void => {
    if (inPlaceElement !== undefined) {
      const element = inPlaceElement;
      inPlaceElement = undefined;
      element.remove();
    }
  };

  const closeInPlaceEditor = (): void => {
    inPlaceEditor = undefined;
    inPlaceEditorFromCreation = false;
    removeInPlaceElement();
  };

  const commitInPlace = (): void => {
    const target = inPlaceEditor;
    const element = inPlaceElement;
    if (target === undefined || element === undefined) {
      return;
    }
    const raw = element.value;
    const fromCreation = inPlaceEditorFromCreation;
    closeInPlaceEditor();
    input.focus();
    if (fromCreation && target.kind === "text" && raw === "") {
      apply(abandonCreatedTextBox(state, target.objectId, evalContext));
      return;
    }
    apply(
      target.kind === "text"
        ? commitTextContent(state, target.objectId, raw, evalContext)
        : commitTableCell(state, target.objectId, target.cell, raw, evalContext),
    );
  };

  const cancelInPlace = (): void => {
    if (inPlaceEditor === undefined) {
      return;
    }
    const target = inPlaceEditor;
    const fromCreation = inPlaceEditorFromCreation;
    closeInPlaceEditor();
    input.focus();
    if (fromCreation && target.kind === "text") {
      apply(abandonCreatedTextBox(state, target.objectId, evalContext));
      return;
    }
    paint();
  };

  const buildInPlaceElement = (target: EditorTarget, style: EditorTextStyle): HTMLTextAreaElement | HTMLInputElement => {
    const keydown = (event: KeyboardEvent): void => {
      event.stopPropagation();
      if (event.key === "Escape") {
        event.preventDefault();
        cancelInPlace();
      } else if (event.key === "Enter" && target.kind === "cell") {
        event.preventDefault();
        commitInPlace();
      }
    };
    const grow = (): void => {
      paint();
    };
    if (target.kind === "text") {
      const area = document.createElement("textarea");
      area.className = "text-editor";
      area.wrap = style.wraps ? "soft" : "off";
      area.value = editorSeed(state, target);
      area.addEventListener("keydown", keydown);
      area.addEventListener("input", grow);
      area.addEventListener("blur", commitInPlace);
      return area;
    }
    const field = document.createElement("input");
    field.type = "text";
    field.className = "text-editor";
    field.value = editorSeed(state, target);
    field.addEventListener("keydown", keydown);
    field.addEventListener("blur", commitInPlace);
    return field;
  };

  const updateEditor = (): void => {
    if (inPlaceEditor === undefined) {
      removeInPlaceElement();
      return;
    }
    const object = state.document.objects.find((candidate) => candidate.id === inPlaceEditor?.objectId);
    if (object === undefined) {
      closeInPlaceEditor();
      return;
    }
    const bounds = canvas.getBoundingClientRect();
    const ratio = bounds.width > 0 ? canvas.width / bounds.width : 1;
    const style = editorTextStyle(inPlaceEditor, object, state.document.camera, ratio);
    if (inPlaceElement === undefined) {
      inPlaceElement = buildInPlaceElement(inPlaceEditor, style);
      editorLayer.appendChild(inPlaceElement);
      inPlaceElement.focus();
      inPlaceElement.select();
    }
    const liveSize =
      inPlaceEditor.kind === "text"
        ? editorTextBoxSize(object, inPlaceElement.value, style, sourceMeasurer)
        : undefined;
    const placement = editorPlacement(inPlaceEditor, object, state.document.camera, ratio, liveSize);
    inPlaceElement.style.left = `${placement.left}px`;
    inPlaceElement.style.top = `${placement.top}px`;
    inPlaceElement.style.width = `${placement.width}px`;
    inPlaceElement.style.height = `${placement.height}px`;
    inPlaceElement.style.fontSize = `${style.fontSize}px`;
    inPlaceElement.style.fontFamily = style.fontFamily;
    inPlaceElement.style.lineHeight = `${style.lineHeight}px`;
    inPlaceElement.style.textAlign = style.textAlign;
    inPlaceElement.style.color = style.color;
    inPlaceElement.style.transformOrigin = "0 0";
    inPlaceElement.style.transform = `scale(${placement.scale})`;
  };

  const apply = (next: AppState): void => {
    state = next;
    drawLog(logElement, state.log);
    paint();
  };

  const applyTransition = (next: AppTransition): void => {
    if (next.openEditor !== undefined) {
      inPlaceEditor = next.openEditor;
      inPlaceEditorFromCreation = true;
    }
    apply(next.state);
    if (next.fileRequest === "save") {
      downloadDocument(state.document);
    } else if (next.fileRequest === "load") {
      openDocument(
        (loaded, line) => apply(replaceDocument(state, loaded, line)),
        (message) => apply(logLine(state, message)),
        evalContext,
      );
    }
    if (next.pickImageFor !== undefined) {
      const objectId = next.pickImageFor;
      choosePicture(
        (dataUrl) =>
          decodeBitmap(dataUrl, (bitmap) => apply(commitImagePicture(state, objectId, dataUrl, bitmap, evalContext))),
        (message) => apply(logLine(state, message)),
      );
    }
  };

  window.addEventListener("resize", paint);

  input.addEventListener("keydown", (event: KeyboardEvent) => {
    if (event.key !== "Enter") {
      return;
    }
    const line = input.value;
    const outcome = submitLine(state, line, viewport(), evalContext);
    if (!outcome.refused) {
      input.value = "";
    }
    applyTransition(outcome);
  });

  window.addEventListener("keydown", (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      closeMenu();
      apply(escape(state));
      return;
    }
    if (event.key === " " && input.value === "") {
      event.preventDefault();
      spaceHeld = true;
    }
  });
  window.addEventListener("keyup", (event: KeyboardEvent) => {
    if (event.key === " ") {
      spaceHeld = false;
    }
  });

  canvas.addEventListener("pointerdown", (event: PointerEvent) => {
    event.preventDefault();
    canvas.setPointerCapture(event.pointerId);
    const point = screenPointOf(event);
    if (event.button === 1 || spaceHeld) {
      if (inPlaceEditor === undefined) {
        input.focus();
      }
      pan = { lastScreenX: point.x, lastScreenY: point.y };
      return;
    }
    input.focus();
    if (inPlaceEditor !== undefined) {
      commitInPlace();
    }
    applyTransition(pointerDownAt(state, point, viewport(), event.shiftKey, evalContext));
  });

  canvas.addEventListener("dblclick", (event: MouseEvent) => {
    const point = screenPointOf(event);

    // A math object edits through its own overlay rather than the text editor,
    // because the field is a MathLive element and the text editor is a
    // textarea holding a string.
    const underPointer = hitTest(point, state.document.objects, state.document.camera);
    if (underPointer?.type === "math") {
      openMathEditor(underPointer.id);
      return;
    }

    const target = editorTargetAt(point, state.document.objects, state.document.camera);
    if (target === undefined) {
      return;
    }
    inPlaceEditor = target;
    inPlaceEditorFromCreation = false;
    paint();
  });

  const closeMenu = (): void => {
    openMenu = undefined;
    if (menuElement !== undefined) {
      menuElement.remove();
      menuElement = undefined;
    }
  };

  /**
   * Runs one menu entry as the command line it stands for. The log then shows
   * the same line the operator can type, and every refusal reads the same way.
   */
  const runMenuAction = (menu: PathMenu, index: number): void => {
    const item = menu.items[index];
    closeMenu();
    if (item === undefined) {
      return;
    }
    input.focus();
    applyTransition(submitLine(state, menuCommandLine(menu.objectName, item.action), viewport(), evalContext));
  };

  canvas.addEventListener("contextmenu", (event: MouseEvent) => {
    event.preventDefault();
    const at = screenPointOf(event);
    const menu = pathMenuAt(at, state.document.objects, state.document.camera);
    closeMenu();
    if (menu === undefined) {
      return;
    }
    openMenu = { menu, at };
    menuElement = writeContextMenu(menu, at, (index) => runMenuAction(menu, index));
    panelsContainer.appendChild(menuElement);
  });

  canvas.addEventListener("pointermove", (event: PointerEvent) => {
    const point = screenPointOf(event);
    if (pan !== undefined) {
      apply(panByScreen(state, point.x - pan.lastScreenX, point.y - pan.lastScreenY));
      pan = { lastScreenX: point.x, lastScreenY: point.y };
      return;
    }
    const overHandle = resizeHandleUnder(state.interaction, point, state.document.objects, state.document.camera);
    const overGrip = pathGripUnder(state.interaction, point, state.document.objects, state.document.camera);
    canvas.style.cursor = overHandle !== undefined ? resizeCursor(overHandle) : overGrip === undefined ? "" : "pointer";
    apply(pointerMoveTo(state, point, evalContext));
  });

  const endGesture = (event: PointerEvent): void => {
    canvas.releasePointerCapture(event.pointerId);
    pan = undefined;
    apply(pointerUpNow(state));
  };
  canvas.addEventListener("pointerup", endGesture);
  canvas.addEventListener("pointercancel", endGesture);

  window.addEventListener("pointerdown", (event: PointerEvent) => {
    if (openMenu !== undefined && (event.target as HTMLElement).closest(".context-menu") === null) {
      closeMenu();
    }
  });

  canvas.addEventListener(
    "wheel",
    (event: WheelEvent) => {
      event.preventDefault();
      apply(wheelZoomAt(state, screenPointOf(event), event.deltaY));
    },
    { passive: false },
  );

  panelsContainer.addEventListener("pointerdown", (event: PointerEvent) => {
    const target = event.target as HTMLElement;
    const insideOpenEditor = target.closest(".panel-row__input, .panel-row__choice, .panel-row__color") !== null;
    if (!insideOpenEditor) {
      event.preventDefault();
    }
    if (openEditor === undefined && !insideOpenEditor) {
      input.focus();
    }
    if (target.closest(".panel-dismiss") !== null) {
      return;
    }
    const header = target.closest(".panel-header");
    const element = header === null ? null : (header.closest(".panel") as HTMLElement | null);
    const objectId = element?.dataset.objectId;
    if (element === null || objectId === undefined) {
      return;
    }
    const bounds = element.getBoundingClientRect();
    panelDrag = { objectId, offsetLeft: event.clientX - bounds.left, offsetTop: event.clientY - bounds.top };
  });

  window.addEventListener("pointermove", (event: PointerEvent) => {
    if (panelDrag === undefined) {
      return;
    }
    const bounds = canvas.getBoundingClientRect();
    apply(
      movePanel(state, panelDrag.objectId, {
        left: event.clientX - bounds.left - panelDrag.offsetLeft,
        top: event.clientY - bounds.top - panelDrag.offsetTop,
      }),
    );
  });
  const endPanelDrag = (): void => {
    panelDrag = undefined;
  };
  window.addEventListener("pointerup", endPanelDrag);
  window.addEventListener("pointercancel", endPanelDrag);

  panelsContainer.addEventListener("click", (event: MouseEvent) => {
    const target = event.target as HTMLElement;
    const partButton = target.closest("[data-part]") as HTMLElement | null;
    if (partButton !== null) {
      const row = partButton.closest(".panel-part") as HTMLElement | null;
      const objectId = (partButton.closest(".panel") as HTMLElement | null)?.dataset.objectId;
      const index = Number(row?.dataset.index);
      if (objectId !== undefined && Number.isInteger(index)) {
        const kind = partButton.dataset.part === "edge" ? "edge" : "vertex";
        apply(withInteraction(state, focusPathPart(state.interaction, objectId, { kind, index })));
      }
      return;
    }
    const dismissButton = target.closest(".panel-dismiss");
    if (dismissButton !== null) {
      const element = dismissButton.closest(".panel") as HTMLElement | null;
      const objectId = element?.dataset.objectId;
      if (objectId !== undefined) {
        apply(dismissPanel(state, objectId));
      }
      return;
    }

    const pick = target.closest(".panel-pick");
    if (pick !== null) {
      const objectId = (pick.closest(".panel") as HTMLElement | null)?.dataset.objectId;
      if (objectId !== undefined) {
        choosePicture(
          (dataUrl) =>
            decodeBitmap(dataUrl, (bitmap) => apply(commitImagePicture(state, objectId, dataUrl, bitmap, evalContext))),
          (message) => apply(logLine(state, message)),
        );
      }
      return;
    }

    const clip = target.closest(".panel-clip");
    if (clip === null) {
      return;
    }
    const rowElement = clip.closest(".panel-row") as HTMLElement | null;
    const panelNode = clip.closest(".panel") as HTMLElement | null;
    const objectId = panelNode?.dataset.objectId;
    const path = rowElement?.dataset.path;
    if (objectId === undefined || path === undefined) {
      return;
    }
    if (clip.classList.contains("panel-clip--formula")) {
      apply(unlinkPanelSlot(state, objectId, path, evalContext));
      return;
    }
    openEditor = { objectId, path };
    paint();
  });

  panelsContainer.addEventListener("change", (event: Event) => {
    const swatch = (event.target as HTMLElement).closest(".panel-row__color") as HTMLInputElement | null;
    if (swatch !== null) {
      const rowElement = swatch.closest(".panel-row") as HTMLElement | null;
      const objectId = (swatch.closest(".panel") as HTMLElement | null)?.dataset.objectId;
      const path = rowElement?.dataset.path;
      if (objectId !== undefined && path !== undefined) {
        apply(commitPanelChoice(state, objectId, path, swatch.value, evalContext));
      }
      return;
    }
    const select = (event.target as HTMLElement).closest(".panel-row__choice") as HTMLSelectElement | null;
    if (select === null) {
      return;
    }
    const rowElement = select.closest(".panel-row") as HTMLElement | null;
    const objectId = (select.closest(".panel") as HTMLElement | null)?.dataset.objectId;
    const path = rowElement?.dataset.path;
    const object = state.document.objects.find((candidate) => candidate.id === objectId);
    if (objectId === undefined || path === undefined || object === undefined) {
      return;
    }
    const model = buildPanelModel(object, state.document.objects);
    const row = [...model.modifiable, ...model.derived].find((candidate) => candidate.path === path);
    const chosen = row?.choices?.values[Number(select.value)];
    if (chosen === undefined) {
      return;
    }
    apply(commitPanelChoice(state, objectId, path, chosen, evalContext));
  });

  apply(state);
  input.focus();
}

function drawLog(logElement: HTMLElement, lines: readonly string[]): void {
  logElement.textContent = lines.join("\n");
  logElement.scrollTop = logElement.scrollHeight;
}

/**
 * The menu element for one press. Each entry is a button, and the caller runs
 * the command line it stands for. The entry for the shape an edge already has
 * carries a mark. It stays live, because a second ask for it is harmless.
 */
function writeContextMenu(menu: PathMenu, at: ScreenPoint, onChoose: (index: number) => void): HTMLElement {
  const element = document.createElement("div");
  element.className = "context-menu";
  element.style.left = `${at.x}px`;
  element.style.top = `${at.y}px`;

  const title = document.createElement("div");
  title.className = "context-menu__title";
  title.textContent = `${menu.objectName} ${menu.title}`;
  element.append(title);

  menu.items.forEach((item, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = item.current ? "context-menu__item context-menu__item--current" : "context-menu__item";
    button.textContent = item.current ? `\u2713 ${item.label}` : item.label;
    button.addEventListener("click", () => {
      onChoose(index);
    });
    element.append(button);
  });
  return element;
}

function writePanel(panelElement: HTMLElement, model: PanelModel, editing: PanelRowEdit | undefined): void {
  const header = document.createElement("div");
  header.className = "panel-header";
  const name = document.createElement("span");
  name.className = "panel-header__name";
  name.textContent = model.header;
  const dismiss = document.createElement("button");
  dismiss.type = "button";
  dismiss.className = "panel-dismiss";
  dismiss.textContent = "×";
  dismiss.setAttribute("aria-label", `hide the ${model.header} panel`);
  header.append(name, dismiss);
  const children: HTMLElement[] = [header];

  for (const row of model.modifiable) {
    children.push(panelRowElement(row, false, editing));
  }
  if (model.parts.length > 0) {
    const rule = document.createElement("div");
    rule.className = "panel-thin-rule";
    children.push(rule);
    const list = document.createElement("div");
    list.className = "panel-parts";
    for (const part of model.parts) {
      list.append(...panelPartElements(part, editing));
    }
    children.push(list);
  }
  if (model.derived.length > 0) {
    const rule = document.createElement("div");
    rule.className = "panel-rule";
    children.push(rule);
    for (const row of model.derived) {
      children.push(panelRowElement(row, true, editing));
    }
  }
  panelElement.replaceChildren(...children);
}

/** The chip that names the shape of one edge. A reader cannot tell it from the slots. */
const EDGE_SHAPE_CHIPS: Readonly<Record<EdgeShape, { readonly glyph: string; readonly title: string }>> = {
  line: { glyph: "\u2014", title: "straight edge" },
  arc: { glyph: "\u25DD", title: "arc, from a bulge" },
  curve: { glyph: "\u223F", title: "cubic curve, from a handle" },
};

/**
 * One vertex row, and the slot rows it opens to.
 *
 * The index and the position open the vertex. The chip opens the edge that
 * leaves it. So one row carries two targets, and the panel holds one line for
 * each vertex rather than seven.
 */
function panelPartElements(part: PanelPartRow, editing: PanelRowEdit | undefined): readonly HTMLElement[] {
  const element = document.createElement("div");
  element.className = part.focus === "none" ? "panel-part" : "panel-part panel-part--open";
  element.dataset.index = String(part.index);

  const vertex = document.createElement("button");
  vertex.type = "button";
  vertex.className = part.free ? "panel-part__vertex" : "panel-part__vertex panel-part__vertex--held";
  vertex.dataset.part = "vertex";
  vertex.title = part.free ? `vertex ${part.index}` : `vertex ${part.index}, which a formula holds`;
  const index = document.createElement("span");
  index.className = "panel-part__index";
  index.textContent = String(part.index);
  const position = document.createElement("span");
  position.className = "panel-part__position";
  position.textContent = part.position;
  vertex.append(index, position);
  element.append(vertex);

  const shape = part.shape;
  if (shape !== undefined) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "panel-part__chip";
    chip.dataset.part = "edge";
    chip.dataset.shape = shape;
    chip.textContent = EDGE_SHAPE_CHIPS[shape].glyph;
    chip.title = `edge ${part.index}: ${EDGE_SHAPE_CHIPS[shape].title}`;
    element.append(chip);
  }

  return [element, ...part.rows.map((row) => panelRowElement(row, false, editing, true))];
}

function panelRowElement(row: PanelRow, derived: boolean, editing: PanelRowEdit | undefined, nested = false): HTMLElement {
  const element = document.createElement("div");
  element.className = derived ? "panel-row panel-row--derived" : "panel-row";
  if (nested) {
    element.className = `${element.className} panel-row--nested`;
  }
  element.dataset.path = row.path;

  const path = document.createElement("span");
  path.className = "panel-row__path";
  path.textContent = row.path;

  const right = document.createElement("span");
  right.className = "panel-row__right";
  if (row.choices !== undefined) {
    right.append(panelChoiceSelect(row.choices));
  } else if (editing !== undefined && editing.path === row.path) {
    right.append(panelEditInput(row.editSeed, editing.handlers));
  } else {
    if (row.picker) {
      right.append(panelPickElement(row));
    } else if (!derived && !row.synthetic) {
      right.append(panelClipElement(row));
    }
    if (row.color !== undefined) {
      right.append(panelColorElement(row.path, row.color));
    }
    const value = document.createElement("span");
    value.className = "panel-row__value";
    value.textContent = row.formulaSource === undefined ? row.value : `= ${row.formulaSource}  (${row.value})`;
    right.append(value);
  }

  element.append(path, right);
  return element;
}

/**
 * The swatch of a colour row. It is a real colour input, sized down to a
 * square, so the browser opens its own wheel. The operator never types a hex
 * string to pick a colour.
 */
function panelColorElement(path: string, color: PanelRowColor): HTMLInputElement {
  const swatch = document.createElement("input");
  swatch.type = "color";
  swatch.className = color.none ? "panel-row__color panel-row__color--none" : "panel-row__color";
  swatch.value = color.seed;
  swatch.title = color.none ? `choose a colour for ${path}` : `change the colour of ${path}`;
  swatch.setAttribute("aria-label", `colour for ${path}`);
  return swatch;
}

function panelChoiceSelect(choices: PanelRowChoices): HTMLSelectElement {
  const select = document.createElement("select");
  select.className = "panel-row__choice";
  for (let index = 0; index < choices.labels.length; index += 1) {
    const option = document.createElement("option");
    option.value = String(index);
    option.textContent = choices.labels[index] ?? "";
    select.append(option);
  }
  select.selectedIndex = choices.selectedIndex;
  return select;
}

function panelClipElement(row: PanelRow): HTMLElement {
  const clip = document.createElement("span");
  clip.className = row.kind === "formula" ? "panel-clip panel-clip--formula" : "panel-clip panel-clip--literal";
  clip.textContent = "📎";
  clip.setAttribute("aria-label", row.kind === "formula" ? `unlink ${row.path} — it is driven by a formula` : `edit ${row.path}`);
  return clip;
}

function panelPickElement(row: PanelRow): HTMLElement {
  const pick = document.createElement("span");
  pick.className = "panel-pick";
  pick.textContent = "📁 choose…";
  pick.setAttribute("aria-label", `choose a picture for ${row.path}`);
  return pick;
}

function panelEditInput(seed: string, handlers: PanelEditHandlers): HTMLInputElement {
  const input = document.createElement("input");
  input.type = "text";
  input.className = "panel-row__input";
  input.value = seed;
  let settled = false;
  const commit = (): void => {
    if (settled) {
      return;
    }
    settled = true;
    handlers.onCommit(input.value);
  };
  const cancel = (): void => {
    if (settled) {
      return;
    }
    settled = true;
    handlers.onCancel();
  };
  input.addEventListener("keydown", (event: KeyboardEvent) => {
    event.stopPropagation();
    if (event.key === "Enter") {
      commit();
    } else if (event.key === "Escape") {
      cancel();
    }
  });
  input.addEventListener("blur", cancel);
  return input;
}

function downloadDocument(state: Document): void {
  const url = URL.createObjectURL(new Blob([saveDocument(state)], { type: "application/json" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "graphpaper.json";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function openDocument(
  onLoaded: (loaded: Document, line: string) => void,
  onRefused: (message: string) => void,
  context: EvalContext,
): void {
  const picker = document.createElement("input");
  picker.type = "file";
  picker.accept = "application/json,.json";
  picker.addEventListener("change", () => {
    const file = picker.files?.[0];
    if (file === undefined) {
      return;
    }
    void file
      .text()
      .then((text) => {
        const result = loadDocument(text, context);
        if (result.ok) {
          onLoaded(result.document, `loaded ${file.name}`);
          return;
        }
        onRefused(result.message);
      })
      .catch((error: unknown) => {
        const reason = error instanceof Error ? error.message : String(error);
        onRefused(`could not read ${file.name}: ${reason}`);
      });
  });
  picker.click();
}

function choosePicture(onChosen: (dataUrl: string) => void, onRefused: (message: string) => void): void {
  const picker = document.createElement("input");
  picker.type = "file";
  picker.accept = "image/*";
  picker.addEventListener("change", () => {
    const file = picker.files?.[0];
    if (file === undefined) {
      return;
    }
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      if (typeof reader.result !== "string") {
        onRefused(`could not read ${file.name} as a data URL`);
        return;
      }
      onChosen(reader.result);
    });
    reader.addEventListener("error", () => {
      onRefused(`could not read ${file.name}`);
    });
    reader.readAsDataURL(file);
  });
  picker.click();
}

if (typeof document !== "undefined") {
  const canvas = document.querySelector<HTMLCanvasElement>("#canvas");
  const logElement = document.querySelector<HTMLElement>("#log");
  const input = document.querySelector<HTMLInputElement>("#command");
  const panelsContainer = document.querySelector<HTMLElement>("#panels");
  if (canvas !== null && logElement !== null && input !== null && panelsContainer !== null) {
    start(canvas, logElement, input, panelsContainer);
  }
}
