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
  assignLayer, createLayer, displayObjects, inheritStyle, layerId, mintObjectId, setLiteral, stylePaths,
  type Operation, formatCellReference, parseCellReference, getTableDimensions,
  createEmptyDocument,
  computePolygonVertices,
  deriveValidateAndEvaluate,
  MATH_FONT_SIZE,
  mathSourceWithIds,
  mathSourceWithNames,
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
import { DEFAULT_IMAGE_EXTENT, MAX_POLYGON_SIDES, executeCommand, type CommandEffect } from "./command/commands.ts";
import { findCommandSpec, isPromptPoint, parseCommandBoolean, parseCommandNumber, type ClearCommand, type DeleteCommand, type SetFormulaCommand, type SetLiteralCommand, type UnlinkCommand } from "./command/parser.ts";
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
import { gridGeometry } from "./render/grid.ts";
import { tableLayout, tableCellAt, cellStyle } from "./render/table-layout.ts";
import { writeLayerTree } from "./render/layer-manager.ts";
import { createRichText, insertVariable, type RichTextElement } from "./render/rich-text.ts";
import { placePropertiesPanel, type PanelPlacement } from "./render/panel.ts";
import { fitBitmapIntoBox, renderDocument, type PathPreview } from "./render/renderer.ts";
import { menuCommandLine, pathMenuAt, type PathMenu } from "./render/menu.ts";
import { edgeShape, type EdgeShape, type PathGrip } from "./render/grips.ts";
import { createImageBitmapCache, decodeBitmap } from "./render/images.ts";
import { readNumber } from "./render/slots.ts";
import "mathlive";
import type { MathfieldElement } from "mathlive";
import "mathlive/static.css";
import "mathlive/fonts.css";
import "./workspace.css";
import { createCanvas2dTextMeasurer, createSourceTextMeasurer } from "./render/measure.ts";
import { createMathMeasurer, MATH_MACROS, mathMarkup, mathOverlayPlacement, readMathDrawnLatex, readMathLatex } from "./render/math.ts";
import { hitTest } from "./render/hittest.ts";
import { worldToScreen } from "./render/camera.ts";
import type { TextMathRun } from "./render/renderer.ts";
import {
  classifyCommandLine,
  classifyFormulaField,
  completeCommandLine,
  completeInFormulaField,
  type FieldEdit,
  type LineSpan,
} from "./command/complete.ts";

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
 * Path commands supply their own points and bulges. Shape commands use their
 * picked origin and the pointer to show the next size before it is committed.
 */
export function promptPreview(state: AppState): PathPreview | undefined {
  const pending = state.pending;
  if (pending === undefined) {
    return undefined;
  }
  const shape = findCommandSpec(pending.commandName)?.previewFromPrompts?.(pending.answers, state.pointer);
  if (shape !== undefined) {
    return shape.points.length === 0 ? undefined : { points: shape.points, bulges: shape.bulges, closed: shape.closed };
  }
  const { commandName, answers } = pending;
  const anchor = answers.center ?? answers.corner ?? answers.origin ?? answers.position;
  const cursor = state.pointer;
  if (anchor !== undefined && isPromptPoint(anchor)) {
    const markers = [anchor];
    if (cursor && (commandName === "circle" || commandName === "polygon")) {
      const radius = Math.hypot(cursor.x - anchor.x, cursor.y - anchor.y);
      const sides = answers.sides;
      const points = commandName === "circle"
        ? [{ x: anchor.x + radius, y: anchor.y }, { x: anchor.x - radius, y: anchor.y }]
          : typeof sides === "number" && Number.isInteger(sides) && sides >= 3 && sides <= MAX_POLYGON_SIDES
          ? computePolygonVertices(sides, radius, anchor, 0) : [];
      return { points, bulges: commandName === "circle" ? [1, 1] : [], closed: true, markers,
        guide: { from: anchor, to: cursor, label: `Radius ${Number(radius.toFixed(2))}` } };
    }
    if (cursor && commandName === "rect") {
      return { points: [anchor, { x: cursor.x, y: anchor.y }, cursor, { x: anchor.x, y: cursor.y }],
        bulges: [], closed: true, markers: [anchor, cursor],
        guide: { from: anchor, to: cursor, label: `${Number(Math.abs(cursor.x - anchor.x).toFixed(2))} × ${Number(Math.abs(cursor.y - anchor.y).toFixed(2))}` } };
    }
    return { points: [anchor], bulges: [], closed: false, markers };
  }
  const step = findCommandSpec(commandName)?.prompts?.[pending.stepIndex];
  return cursor && step?.accepts === "point"
    ? { points: [cursor], bulges: [], closed: false }
    : undefined;
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
  const line = fits ? describeZoom(fitted.zoom, fitted.zoom) : `the document's extent is a single point — centred it at zoom ${roundedZoom(fitted.zoom)}`;
  return withLog(withCamera(state, fitted), [line]);
}

/**
 * The zoom as a line an operator reads. A zoom reached by repeated steps is a
 * float of full precision, such as 2.6584615384615384, and the command dock
 * shows the newest line for as long as it stays the newest. Four decimals
 * hold two neighbouring steps apart and leave the rest of the digits off.
 */
function roundedZoom(zoom: number): number {
  return Number(zoom.toFixed(4));
}

function describeZoom(actual: number, requested: number): string {
  return actual === requested
    ? `zoom is now ${roundedZoom(actual)}`
    : `zoom is now ${roundedZoom(actual)} — clamped to the ${MIN_ZOOM}-${MAX_ZOOM} range`;
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
    return respondToPrompt({ ...state, pointer: world }, { kind: "picked", point: { x: world.x, y: world.y } }, viewport, context);
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
    editSeed: descriptor.formulaSource === undefined ? describeSlotValue(descriptor.value, { fullStrings: true }) : `=${descriptor.formulaSource}`,
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
  if (target.kind === "docref") {
    const host = state.document.objects.find((candidate) => candidate.id === object.target?.objectId);
    const slot = host === undefined || object.target === undefined ? undefined : getSlot(host, object.target.path);
    return slot === undefined ? "" : slot.kind === "formula" ? `=${formatFormula(slot.ast, state.document.objects)}` : cellLiteralSeed(slot.value);
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
  const stored = mathSourceWithIds(latex, state.document.objects);
  if (readMathLatex(object) === stored) {
    return state;
  }

  const echoed = withLog(state, [`> ${object.name} = "${latex}"`]);
  const result = mutate(
    echoed.document.objects,
    [{ kind: "setMathSource", objectId, source: stored }],
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

/**
 * Commits what an operator typed into a copy on the canvas.
 *
 * The write goes to the variable rather than to the copy the editor sits on,
 * which is the one way this editor differs from the table cell of section 7.
 * A copy is an object with no value of its own, so every other copy of the
 * variable moves in the same pass.
 *
 * An empty field writes an empty value rather than clearing the slot, because
 * clearing a variable is `delvar`, and an operator who selected the text and
 * deleted it has not asked for the variable and its other copies to go.
 */
export function commitVariableCopy(state: AppState, objectId: string, raw: string, context: EvalContext = NULL_EVAL_CONTEXT): AppState {
  if (raw === editorSeed(state, { kind: "docref", objectId })) {
    return state;
  }
  const copy = state.document.objects.find((object) => object.id === objectId);
  const doc = state.document.objects.find((object) => object.id === copy?.target?.objectId);
  if (copy?.type !== "docref" || copy.target === undefined || doc === undefined) {
    return state;
  }
  const target = `${doc.name}.${copy.target.path[0]}`;
  const command = raw.trim() === "" ? { kind: "set" as const, target, value: "" } : buildCellCommand(target, raw);
  return runPanelCommand(state, command, context);
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
  /**
   * What a completion key should write in this field. It arrives as a function
   * because the document lives inside start and a row is built outside it.
   */
  readonly onComplete?: (value: string, cursor: number) => FieldEdit | undefined;
  /** Which runs of this field named something, for the same reason. */
  readonly onMarks?: (value: string) => readonly LineSpan[];
}

/**
 * Writes text into a layer with a marked element around each span, built out of
 * text nodes and elements rather than out of markup, so what an operator typed
 * can never be read as markup.
 *
 * The command line and the cell editor both mark through this, so a mark reads
 * the same wherever it appears.
 */
function writeMarks(layer: HTMLElement, text: string, spans: readonly LineSpan[]): void {
  layer.textContent = "";
  let at = 0;
  for (const span of spans) {
    if (span.start > at) {
      layer.appendChild(document.createTextNode(text.slice(at, span.start)));
    }
    const mark = document.createElement("span");
    mark.className = `mark--${span.kind}`;
    mark.textContent = text.slice(span.start, span.end);
    layer.appendChild(mark);
    at = span.end;
  }
  if (at < text.length) {
    layer.appendChild(document.createTextNode(text.slice(at)));
  }
}

/** How many candidates the list shows before it says how many are left. */
const CANDIDATE_LIMIT = 12;

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
  const measureMathForLayout = (latex: string, fontSize: number): { width: number; height: number } =>
    measureMath(latex, { fontSize });
  const evalContext: EvalContext =
    measureContext === null
      ? NULL_EVAL_CONTEXT
      : { measurer: createCanvas2dTextMeasurer(measureContext, measureMathForLayout) };
  const sourceMeasurer = measureContext === null ? evalContext.measurer : createSourceTextMeasurer(measureContext);

  let state = initialAppState(createEmptyDocument(), ["Beheader. Type a command, or a command word alone to be prompted."]);
  let pan: PanGesture | undefined;
  let spaceHeld = false;
  let openMenu: { readonly menu: PathMenu; readonly at: ScreenPoint } | undefined;
  let menuElement: HTMLElement | undefined;
  const panelElements = new Map<string, HTMLElement>();
  let panelDrag: PanelDragGesture | undefined;
  let openEditor: { readonly objectId: string; readonly path: string } | undefined;
  let inPlaceEditor: EditorTarget | undefined;
  let inPlaceElement: HTMLTextAreaElement | HTMLInputElement | RichTextElement | undefined;
  let activeCell: { objectId: string; cell: string } | undefined;
  let tableResize: { objectId: string; axis: "column" | "row"; index: number; start: number; size: number; value: number } | undefined;
  let quickObjectId: string | undefined;
  const pinnedPanels = new Map<string, PanelPlacement>();
  const threads = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  threads.classList.add("property-threads");
  panelsContainer.append(threads);
  const cursor = document.createElement("div"); cursor.className = "canvas-cursor";
  canvas.parentElement?.append(cursor);
  const cellHighlight = document.createElement("div"); cellHighlight.className = "cell-highlight";
  canvas.parentElement?.append(cellHighlight);
  let gridVisible = true;
  let inPlaceMirror: HTMLElement | undefined;
  let inPlaceEditorFromCreation = false;
  const editorLayer: HTMLElement = canvas.parentElement ?? panelsContainer;
  const mathOverlays = new Map<string, HTMLElement>();
  const commandMirror = document.querySelector<HTMLElement>("#command-mirror") ?? undefined;
  const candidateList = document.createElement("div");
  candidateList.className = "candidates";
  candidateList.hidden = true;
  input.parentElement?.insertBefore(candidateList, input);
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
    const grid = gridGeometry(state.document.camera, ratio);
    const stage = canvas.parentElement!;
    stage.style.setProperty("--grid-step", `${grid.spacing}px`);
    stage.style.setProperty("--grid-major", `${grid.spacing * 10}px`);
    stage.style.setProperty("--grid-opacity", String(grid.opacity * 0.12));
    stage.style.setProperty("--grid-x", `${grid.x}px`);
    stage.style.setProperty("--grid-y", `${grid.y}px`);
    stage.classList.toggle("grid-off", !gridVisible);
    const panelledIds = panelledObjectIds();
    const report = renderDocument(
      context,
      canvas.width,
      canvas.height,
      tableResize ? state.document.objects.map(object => object.id === tableResize!.objectId ? { ...object, slots: { ...object.slots, [`${tableResize!.axis === "column" ? "columns" : "rowsizes"}.${tableResize!.index}.${tableResize!.axis === "column" ? "width" : "height"}`]: { kind: "literal" as const, value: tableResize!.value } } } : object) : state.document.objects,
      state.document.camera,
      state.interaction.selectedObjectIds,
      panelledIds,
      inPlaceEditor,
      imageBitmaps,
      promptPreview(state),
      state.interaction.focus?.grip,
      measureMathForLayout,
    );
    updatePanels(panelledIds);
    updateMathOverlays(report.mathRuns);
    updateEditor();
    paintCommandLine();
    updateWorkspace();
    updateFormatToolbar();
    cellHighlight.hidden = true;
    const editedCell = activeCell;
    const cellObject = editedCell && displayObjects(state.document.objects).find(object => object.id === editedCell.objectId && state.interaction.selectedObjectIds.includes(object.id));
    if (activeCell && cellObject && !tableResize) {
      const placement = editorPlacement({ kind: "cell", ...activeCell }, cellObject, state.document.camera, ratio);
      cellHighlight.hidden = false;
      cellHighlight.style.left = `${placement.left}px`; cellHighlight.style.top = `${placement.top}px`;
      cellHighlight.style.width = `${placement.width * placement.scale}px`; cellHighlight.style.height = `${placement.height * placement.scale}px`;
    }
  };

  /**
   * Puts one element over each math object and moves it with the camera. The
   * canvas pass has already drawn the box under it, so the two agree on where
   * the object is by taking the same world box.
   */
  const updateMathOverlays = (textRuns: readonly TextMathRun[] = []): void => {
    const ratio = window.devicePixelRatio > 0 ? window.devicePixelRatio : 1;
    const live = new Set<string>();

    for (const object of displayObjects(state.document.objects)) {
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
      const drawn = mathSourceWithNames(readMathDrawnLatex(object), state.document.objects);
      const editing = object.id === editingMathId;
      element.classList.toggle("math-overlay--editing", editing);

      if (editing) {
        if (mathField === undefined || element.firstChild !== mathField) {
          element.innerHTML = "";
          mathField = buildMathField(object.id, mathSourceWithNames(latex, state.document.objects));
          element.appendChild(mathField);
          (mathField as MathfieldElement).mathVirtualKeyboardPolicy = "manual";
          window.mathVirtualKeyboard.hide();
          applyMathFieldMacros(mathField);
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

    // A run of notation inside a text object reaches the screen the same way a
    // math object does, and it is placed from the box the drawing pass reported
    // rather than from a layout worked out again here.
    for (const run of textRuns) {
      const key = `${run.objectId}#${run.index}`;
      live.add(key);

      let element = mathOverlays.get(key);
      if (element === undefined) {
        element = document.createElement("div");
        element.className = "math-overlay math-overlay--in-text";
        editorLayer.appendChild(element);
        mathOverlays.set(key, element);
      }

      if (element.dataset["latex"] !== run.latex) {
        element.innerHTML = mathMarkup(run.latex);
        element.dataset["latex"] = run.latex;
      }
      const topLeft = worldToScreen(state.document.camera, { x: run.x, y: run.y });
      element.style.left = `${topLeft.x / ratio}px`;
      element.style.top = `${topLeft.y / ratio}px`;
      element.style.width = `${run.width}px`;
      element.style.height = `${run.height}px`;
      element.style.padding = "0";
      element.style.fontSize = `${run.fontSize}px`;
      element.style.transform = `scale(${state.document.camera.zoom / ratio})`;
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

  /**
   * Gives a field the macros of this program on top of the ones MathLive
   * ships, so an address and a solve command draw the way they do in the
   * static form rather than in the red MathLive keeps for a command it has
   * never heard of.
   *
   * It runs after the field is in the page, because both the read and the
   * write of that property throw on a field that is not mounted yet.
   */
  const applyMathFieldMacros = (field: HTMLElement): void => {
    const withMacros = field as unknown as { macros: Record<string, string> };
    withMacros.macros = { ...withMacros.macros, ...MATH_MACROS };
  };

  const closeMathEditor = (): void => {
    editingMathId = undefined;
    mathField = undefined;
    window.mathVirtualKeyboard.hide();
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
   * Measures every piece of notation again and evaluates the document against
   * the new sizes. Notation measured before its fonts arrive comes out about a
   * sixth too narrow, so the box left for it is too small until this runs.
   *
   * It looks at every object rather than at the math objects alone. A text
   * object holding a run of notation is measured the same way and goes just as
   * wrong, and a guard that named the math type left that case behind.
   *
   * It evaluates rather than mutating, because nothing about the document has
   * changed. Only the size of what was already there is now known properly, so
   * there is nothing for the journal to record.
   */
  const remeasureMath = (): void => {
    if (state.document.objects.length === 0) {
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
    const selected = state.interaction.selectedObjectIds;
    if (selected.length) quickObjectId = selected[selected.length - 1];
    const candidates = [...new Set([...pinnedPanels.keys(), ...(quickObjectId ? [quickObjectId] : [])])];
    for (const objectId of candidates) {
      const object = state.document.objects.find((candidate) => candidate.id === objectId);
      const extent = object === undefined ? undefined : (object.type === "doc" || object.type === "layer") ? { minX: 0, minY: 0, maxX: 0, maxY: 0 } : objectExtent(object);
      if (object === undefined || extent === undefined || panelUiState(state, objectId).dismissed) {
        continue;
      }
      ids.push(objectId);
    }
    return ids;
  };

  const updatePanels = (panelledIds: readonly string[]): void => {
    const shown = new Set(panelledIds);
    threads.replaceChildren();
    if (openEditor !== undefined && !shown.has(openEditor.objectId)) {
      openEditor = undefined;
    }
    for (const objectId of panelledIds) {
      const object = state.document.objects.find((candidate) => candidate.id === objectId);
      const extent = object === undefined ? undefined : (object.type === "doc" || object.type === "layer") ? { minX: 0, minY: 0, maxX: 0, maxY: 0 } : objectExtent(object);
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
        addStyleSources(element, object);
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
      const bounds = canvas.getBoundingClientRect();
      const position = pinnedPanels.get(objectId) ?? { left: Math.max(8, bounds.width - Math.min(320, bounds.width - 16) - 12), top: 12 };
      placePanelElement(element, extent, { left: Math.max(0, Math.min(position.left, bounds.width - element.offsetWidth)), top: Math.max(0, Math.min(position.top, bounds.height - Math.min(element.offsetHeight, bounds.height))) });
      if (pinnedPanels.has(objectId) && displayObjects(state.document.objects).some(item => item.id === objectId)) {
        const ratio = canvas.width / bounds.width;
        const anchor = worldToScreen(state.document.camera, { x: (extent.minX + extent.maxX) / 2, y: (extent.minY + extent.maxY) / 2 });
        const rect = element.getBoundingClientRect();
        const line = document.createElementNS(threads.namespaceURI, "line");
        line.setAttribute("x1", String(anchor.x / ratio)); line.setAttribute("y1", String(anchor.y / ratio));
        line.setAttribute("x2", String(rect.left - bounds.left + rect.width / 2)); line.setAttribute("y2", String(rect.top - bounds.top + 14));
        threads.append(line);
      }
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
    onComplete: (value: string, cursor: number) => completeInFormulaField(value, cursor, state.document.objects),
    onMarks: (value: string) => classifyFormulaField(value, state.document.objects),
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
    if (inPlaceMirror !== undefined) {
      const element = inPlaceMirror;
      inPlaceMirror = undefined;
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
        : target.kind === "docref" ? commitVariableCopy(state, target.objectId, raw, evalContext)
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

  const buildInPlaceElement = (target: EditorTarget, style: EditorTextStyle): HTMLTextAreaElement | HTMLInputElement | RichTextElement => {
    const keydown = (event: KeyboardEvent): void => {
      event.stopPropagation();
      if ((event.ctrlKey || event.metaKey) && ["b", "i"].includes(event.key.toLowerCase())) {
        event.preventDefault(); formatEmphasis(event.key.toLowerCase() === "b" ? "bold" : "italic"); return;
      }
      if ((event.key === "Tab" || event.key === "Enter") && target.kind === "cell" && !inPlaceElement?.value.trim().startsWith("=")) {
        event.preventDefault(); navigateCell(target, event.key === "Tab" ? "column" : "row", event.shiftKey ? -1 : 1); return;
      }
      if (event.key === "Tab" && target.kind !== "text") {
        event.preventDefault();
        applyFieldCompletion(event.currentTarget as HTMLInputElement, (value, cursor) =>
          completeInFormulaField(value, cursor, state.document.objects, target.kind === "cell" ? target.objectId : undefined),
        );
      } else if (event.key === "Escape") {
        event.preventDefault();
        cancelInPlace();
      } else if (event.key === "Enter" && target.kind !== "text") {
        event.preventDefault();
        commitInPlace();
      }
    };
    const grow = (): void => {
      paint();
    };
    const markAsTyped = (): void => {
      paintCellEditor();
    };
    const followScroll = (): void => {
      if (inPlaceMirror !== undefined && inPlaceElement !== undefined) {
        inPlaceMirror.scrollLeft = inPlaceElement.scrollLeft;
      }
    };
    if (target.kind === "text") {
      const area = createRichText(editorSeed(state, target));
      area.addEventListener("keydown", keydown);
      area.addEventListener("input", grow);
      area.addEventListener("blur", event => {
        if (area.contains(event.relatedTarget as Node) || (event.relatedTarget as HTMLElement | null)?.closest(".format-toolbar, .variable-picker")) return;
        commitInPlace();
      });
      return area;
    }
    const field = document.createElement("input");
    field.type = "text";
    field.className = "text-editor";
    field.value = editorSeed(state, target);
    field.addEventListener("keydown", keydown);
    field.addEventListener("input", markAsTyped);
    field.addEventListener("scroll", followScroll);
    field.addEventListener("blur", event => { if (!(event.relatedTarget as HTMLElement | null)?.closest(".format-toolbar")) commitInPlace(); });
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
      if (inPlaceEditor.kind !== "text") {
        inPlaceMirror = document.createElement("div");
        inPlaceMirror.className = "text-editor text-editor--mirror";
        inPlaceMirror.setAttribute("aria-hidden", "true");
        editorLayer.appendChild(inPlaceMirror);
      }
      inPlaceElement = buildInPlaceElement(inPlaceEditor, style);
      editorLayer.appendChild(inPlaceElement);
      inPlaceElement.focus();
      inPlaceElement.select();
    }
    const liveSize =
      inPlaceEditor.kind === "text"
        ? editorTextBoxSize(object, inPlaceElement.value, style, evalContext.measurer)
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
    const cellFormatting = inPlaceEditor.kind === "cell" ? cellStyle(object, inPlaceEditor.cell) : undefined;
    inPlaceElement.style.fontWeight = (cellFormatting?.bold ?? object.slots["style.bold"]?.value) === true ? "bold" : "normal";
    inPlaceElement.style.fontStyle = (cellFormatting?.italic ?? object.slots["style.italic"]?.value) === true ? "italic" : "normal";
    inPlaceElement.style.transformOrigin = "0 0";
    inPlaceElement.style.transform = `scale(${placement.scale})`;

    if (inPlaceMirror !== undefined) {
      // Every property that decides where a glyph falls is copied from the
      // field rather than worked out again, so the two cannot disagree.
      for (const property of ["left", "top", "width", "height", "fontSize", "fontFamily", "fontWeight", "fontStyle", "lineHeight", "textAlign", "transformOrigin", "transform"] as const) {
        inPlaceMirror.style[property] = inPlaceElement.style[property];
      }
      paintCellEditor();
    }
  };

  /**
   * Marks the addresses in the cell being edited. A cell holds a formula only
   * where it opens with an equals sign, so a field of plain text is marked
   * nowhere, which is what tells an operator the program read it as text.
   */
  const paintCellEditor = (): void => {
    if (inPlaceMirror === undefined || inPlaceElement === undefined || inPlaceEditor === undefined || inPlaceEditor.kind === "text") {
      return;
    }
    const value = inPlaceElement.value;
    const spans = classifyFormulaField(value, state.document.objects, inPlaceEditor.kind === "cell" ? inPlaceEditor.objectId : undefined);
    writeMarks(inPlaceMirror, value, spans);
    // A cell is narrow, so a formula of any length scrolls the field sideways
    // while it is typed. A layer that stayed put would sit under whichever
    // letters happened to be in view rather than under the ones it marks.
    inPlaceMirror.scrollLeft = inPlaceElement.scrollLeft;
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

  const applyOperations = (operations: readonly Operation[]): void => {
    if (!operations.length) return;
    const result = mutate(state.document.objects, operations, state.document.journal, evalContext);
    apply(result.ok ? { ...state, document: { ...state.document, objects: result.objects, journal: result.journal } } : logLine(state, result.message));
  };

  const addStyleSources = (element: HTMLElement, object: GraphObject): void => {
    for (const path of stylePaths(object)) {
      const key = path.join(".");
      const row = element.querySelector<HTMLElement>(`.panel-row[data-path="${key}"]`);
      if (!row) continue;
      const select = document.createElement("select");
      select.className = "property-source";
      select.setAttribute("aria-label", `Source for ${object.name}.${key}`);
      select.add(new Option("Local override", "local"));
      const own = layerId(object);
      for (const layer of state.document.objects.filter(item => item.type === "layer" && item.id !== object.id)) {
        select.add(new Option(`${layer.id === own ? "By layer" : "From"}: ${layer.name}`, layer.id));
      }
      const slot = getSlot(object, path);
      select.value = slot?.kind === "formula" && slot.ast.type === "reference" && state.document.objects.some(item => item.type === "layer" && item.id === (slot.ast.type === "reference" ? slot.ast.address.objectId : "")) ? slot.ast.address.objectId : "local";
      select.addEventListener("change", () => {
        const selected = state.interaction.selectedObjectIds.includes(object.id) ? state.document.objects.filter(item => state.interaction.selectedObjectIds.includes(item.id) && stylePaths(item).some(candidate => candidate.join(".") === key)) : [object];
        applyOperations(selected.map(item => select.value === "local" ? setLiteral(item.id, path, getSlot(item, path)?.value ?? null) : inheritStyle(item.id, path, select.value)));
      });
      row.append(select);
    }
  };

  const formatToolbar = document.createElement("div");
  formatToolbar.className = "format-toolbar";
  formatToolbar.setAttribute("role", "toolbar");
  formatToolbar.setAttribute("aria-label", "Text and table formatting");
  formatToolbar.innerHTML = `<span class="format-target"></span>
    <button type="button" data-format="bold" aria-label="Bold (Ctrl+B)"><b>B</b></button>
    <button type="button" data-format="italic" aria-label="Italic (Ctrl+I)"><i>I</i></button>
    <input type="number" min="1" max="300" step="1" data-format="fontSize" aria-label="Font size" title="Font size">
    <select data-format="align" aria-label="Text alignment"><option value="left">Left</option><option value="center">Center</option><option value="right">Right</option></select>
    <input type="color" data-format="color" aria-label="Text color" title="Text color">
    <input type="color" data-format="fillColor" aria-label="Cell fill color" title="Cell fill color">
    <select data-format="format" aria-label="Number format"><option value="general">General</option><option value="decimal">0.00</option><option value="percent">0.0%</option></select>
    <button type="button" data-format="variable">ƒx</button>`;
  editorLayer.append(formatToolbar);
  let savedTextRange: Range | undefined;
  const formattingTarget = (): GraphObject | undefined => {
    const id = inPlaceEditor?.objectId ?? state.interaction.selectedObjectIds[state.interaction.selectedObjectIds.length - 1];
    return state.document.objects.find(object => object.id === id && (object.type === "text" || object.type === "table"));
  };
  const formatPath = (object: GraphObject, key: string): readonly string[] => object.type === "table" && activeCell?.objectId === object.id ? ["cellStyle", activeCell.cell, key] : ["style", key];
  const restoreTextSelection = (): void => {
    if (inPlaceEditor?.kind !== "text" || !inPlaceElement) return;
    inPlaceElement.focus();
    if (savedTextRange && inPlaceElement.contains(savedTextRange.commonAncestorContainer)) {
      const selection = window.getSelection(); selection?.removeAllRanges(); selection?.addRange(savedTextRange);
    }
  };
  const formatEmphasis = (key: "bold" | "italic"): void => {
    if (inPlaceEditor?.kind === "text") {
      restoreTextSelection(); document.execCommand(key); savedTextRange = window.getSelection()?.rangeCount ? window.getSelection()!.getRangeAt(0).cloneRange() : undefined;
      updateFormatToolbar(); return;
    }
    const object = formattingTarget();
    if (!object) return;
    const path = formatPath(object, key);
    const value = getSlot(object, path)?.value ?? (object.type === "table" && activeCell?.objectId === object.id ? cellStyle(object, activeCell.cell)[key] : false);
    applyOperations([setLiteral(object.id, path, value !== true)]);
  };
  formatToolbar.addEventListener("pointerdown", event => {
    if (inPlaceEditor?.kind === "text") {
      const selection = window.getSelection();
      savedTextRange = selection?.rangeCount ? selection.getRangeAt(0).cloneRange() : undefined;
    }
    if ((event.target as HTMLElement).closest("button")) event.preventDefault();
  });
  formatToolbar.addEventListener("click", event => {
    const key = (event.target as HTMLElement).closest<HTMLElement>("[data-format]")?.dataset.format;
    if (key === "bold" || key === "italic") formatEmphasis(key);
    if (key === "variable" && inPlaceEditor?.kind === "text") openVariablePicker();
  });
  formatToolbar.addEventListener("change", event => {
    const field = event.target as HTMLInputElement;
    const object = formattingTarget();
    if (!object || !field.dataset.format) return;
    const key = field.dataset.format;
    const value = key === "fontSize" ? Number(field.value) : field.value;
    if (key === "fontSize" && (!(Number(value) > 0) || Number(value) > 300)) return;
    const operations: Operation[] = [setLiteral(object.id, formatPath(object, key), value)];
    if (key === "fontSize" && object.type === "text") operations.push(setLiteral(object.id, ["style", "lineHeight"], Number(value) * 1.25));
    applyOperations(operations);
    restoreTextSelection();
    inPlaceElement?.focus();
  });
  const updateFormatToolbar = (): void => {
    const object = formattingTarget();
    formatToolbar.hidden = object === undefined;
    if (!object) return;
    formatToolbar.querySelector(".format-target")!.textContent = object.type === "table" && activeCell?.objectId === object.id ? `${object.name} · ${activeCell.cell}` : object.name;
    for (const field of Array.from(formatToolbar.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLButtonElement>("[data-format]"))) {
      const key = field.dataset.format!;
      const value = getSlot(object, formatPath(object, key))?.value ?? object.slots[`style.${key}`]?.value;
      if (field instanceof HTMLButtonElement) {
        field.hidden = key === "variable" && inPlaceEditor?.kind !== "text";
        field.title = key === "variable" ? "Insert a live value" : field.getAttribute("aria-label") ?? "";
        if (key !== "variable") field.setAttribute("aria-pressed", String(inPlaceEditor?.kind === "text" ? document.queryCommandState(key) : value === true));
      } else {
        field.hidden = object.type !== "table" && ["fillColor", "format"].includes(key);
        if (document.activeElement !== field) field.value = String(value ?? (key === "fontSize" ? object.type === "table" ? 14 : 16 : key === "align" ? "left" : key === "format" ? "general" : "#1a1a1a"));
      }
    }
  };
  const openVariablePicker = (): void => {
    if (!inPlaceElement || inPlaceEditor?.kind !== "text") return;
    const area = inPlaceElement;
    const selection = window.getSelection();
    if (selection?.rangeCount) savedTextRange = selection.getRangeAt(0).cloneRange();
    const picker = document.createElement("form"); picker.className = "variable-picker";
    const field = document.createElement("input"); field.placeholder = "table_1.A1 or an expression"; field.setAttribute("aria-label", "Insert live value");
    const choices = document.createElement("div"); choices.className = "variable-choices";
    const insert = document.createElement("button"); insert.textContent = "Insert value";
    const cancel = document.createElement("button"); cancel.type = "button"; cancel.textContent = "Cancel";
    const close = () => { picker.remove(); restoreTextSelection(); };
    cancel.addEventListener("click", close);
    field.addEventListener("keydown", event => { event.stopPropagation(); if (event.key === "Escape") { event.preventDefault(); close(); } });
    const updateChoices = () => {
      choices.replaceChildren();
      const completion = completeInFormulaField(`= ${field.value}`, field.value.length + 2, state.document.objects);
      for (const value of completion?.candidates.slice(0, 12) ?? []) {
        const button = document.createElement("button"); button.type = "button"; button.textContent = value;
        button.addEventListener("click", () => { field.value = value; field.focus(); updateChoices(); }); choices.append(button);
      }
    };
    field.addEventListener("input", updateChoices);
    picker.append(field, choices, insert, cancel); editorLayer.append(picker); field.focus(); updateChoices();
    picker.addEventListener("submit", event => { event.preventDefault(); if (!field.value.trim()) return; const expression = field.value.trim(); close(); insertVariable(area, expression); paint(); });
  };
  const navigateCell = (target: Extract<EditorTarget, { kind: "cell" }>, axis: "column" | "row", delta: number): void => {
    const object = state.document.objects.find(item => item.id === target.objectId);
    if (!object) return;
    const { rows, cols } = getTableDimensions(object);
    const coordinates = parseCellReference(target.cell)!;
    let index = (coordinates.row - 1) * cols + coordinates.column - 1 + (axis === "column" ? delta : delta * cols);
    index = Math.max(0, Math.min(rows * cols - 1, index));
    commitInPlace();
    const cell = formatCellReference({ column: index % cols + 1, row: Math.floor(index / cols) + 1 });
    activeCell = { objectId: object.id, cell }; inPlaceEditor = { kind: "cell", ...activeCell }; paint();
  };

  document.addEventListener("selectionchange", () => {
    if (inPlaceEditor?.kind === "text" && document.activeElement === inPlaceElement) { savedTextRange = undefined; updateFormatToolbar(); }
  });
  document.querySelector("#grid-toggle")?.addEventListener("click", event => {
    gridVisible = !gridVisible; (event.currentTarget as HTMLElement).setAttribute("aria-pressed", String(gridVisible)); paint();
  });
  window.addEventListener("resize", paint);

  const objectList = document.querySelector<HTMLElement>("#object-list");
  const objectSearch = document.querySelector<HTMLInputElement>("#object-search");
  const status = document.querySelector<HTMLElement>("#command-status");
  const history: string[] = [];
  let historyIndex = 0;
  let historyDraft = "";
  let objectListKey = "";

  const updateWorkspace = (): void => {
    const pending = state.pending;
    const welcome = document.querySelector<HTMLElement>("#welcome");
    if (welcome) welcome.hidden = state.document.objects.length > 0 || pending !== undefined;
    const cancel = document.querySelector<HTMLElement>("#cancel-command");
    if (cancel) cancel.hidden = pending === undefined;
    const keyboardToggle = document.querySelector<HTMLButtonElement>("#math-keyboard-toggle");
    if (keyboardToggle) {
      const visible = window.mathVirtualKeyboard.visible;
      keyboardToggle.hidden = editingMathId === undefined && !visible;
      keyboardToggle.textContent = visible ? "Hide keyboard" : "Math keyboard";
      keyboardToggle.setAttribute("aria-expanded", String(visible));
    }
    if (status) status.textContent = pending
      ? `${pending.commandName} · ${state.log[state.log.length - 1] ?? "Follow the prompt"}`
      : state.log.length > 1 ? state.log[state.log.length - 1] ?? "Ready" : "Ready";
    input.placeholder = pending ? "Enter a value or pick a point…" : "Type a command…";
    for (const button of Array.from(document.querySelectorAll<HTMLButtonElement>(".tool-grid button"))) {
      button.setAttribute("aria-pressed", String(button.dataset.command === pending?.commandName));
    }
    const zoom = document.querySelector<HTMLElement>("#zoom-level");
    if (zoom) zoom.textContent = `${Math.round(state.document.camera.zoom * 100)}%`;
    const selected = state.interaction.selectedObjectIds;
    const count = document.querySelector<HTMLElement>("#object-count");
    if (count) count.textContent = String(state.document.objects.length);
    const query = objectSearch?.value.toLowerCase().trim() ?? "";
    const key = JSON.stringify([state.document.objects.map(({ id, name, type, slots }) => [id, name, type, slots["view.layer"], slots["view.visible"], slots["view.order"]]), selected, query]);
    if (objectList && key !== objectListKey) {
      objectListKey = key;
      writeLayerTree(objectList, state.document.objects, selected, query, {
        select: (id, extend) => {
          commitInPlace();
          const ids = extend ? selected.includes(id) ? selected.filter(item => item !== id) : [...selected, id] : [id];
          apply(withInteraction(state, { ...state.interaction, selectedObjectIds: ids }));
        },
        mutate: applyOperations,
        create: name => {
          const minted = mintObjectId(state.document);
          if ("ok" in minted) { apply(logLine(state, minted.message)); return; }
          const result = mutate(state.document.objects, [{ kind: "createObject", object: createLayer(minted.id, name) }], state.document.journal, evalContext);
          if (!result.ok) { apply(logLine(state, result.message)); return; }
          apply({ ...state, document: { ...state.document, objects: result.objects, journal: result.journal, nextObjectId: minted.nextObjectId }, interaction: { ...state.interaction, selectedObjectIds: [minted.id] } });
        },
        rename: (id, name) => { objectListKey = ""; applyOperations([{ kind: "renameObject", objectId: id, name }]); },
      });

    }
  };

  const runWorkspaceCommand = (line: string): void => {
    commitInPlace();
    commitMathEditor();
    if (state.pending) state = escape(state);
    input.value = "";
    showCandidates([]);
    if (status) status.dataset.error = "false";
    applyTransition(submitLine(state, line, viewport(), evalContext));
    input.focus();
  };
  for (const button of Array.from(document.querySelectorAll<HTMLButtonElement>("[data-command]"))) {
    button.addEventListener("click", () => runWorkspaceCommand(button.dataset.command ?? ""));
  }
  objectSearch?.addEventListener("input", updateWorkspace);
  const keyboardToggle = document.querySelector<HTMLButtonElement>("#math-keyboard-toggle");
  keyboardToggle?.addEventListener("pointerdown", event => event.preventDefault());
  keyboardToggle?.addEventListener("click", () => {
    if (window.mathVirtualKeyboard.visible) window.mathVirtualKeyboard.hide();
    else window.mathVirtualKeyboard.show();
    updateWorkspace();
  });
  window.mathVirtualKeyboard.addEventListener("virtual-keyboard-toggle", updateWorkspace);
  document.querySelector("#cancel-command")?.addEventListener("click", () => {
    input.value = "";
    apply(escape(state));
    input.focus();
  });
  const sidebar = document.querySelector<HTMLElement>("#sidebar")!;
  const sidebarShow = document.querySelector<HTMLButtonElement>("#sidebar-show")!;
  const sidebarResize = document.querySelector<HTMLElement>("#sidebar-resize")!;
  let sidebarMode = window.innerWidth <= 560 ? "compact" : "full";
  const sidebarWidths: Record<string, number> = { full: 208, compact: 140 };
  const sizeSidebar = (): void => {
    const minimum = sidebarMode === "full" ? 184 : 120;
    const maximum = Math.min(420, Math.max(minimum, window.innerWidth - 220));
    const width = Math.min(maximum, sidebarWidths[sidebarMode] ?? 208);
    sidebar.style.width = `${width}px`;
    sidebarResize.setAttribute("aria-valuemax", String(maximum));
    sidebarResize.setAttribute("aria-valuemin", String(minimum));
    sidebarResize.setAttribute("aria-valuenow", String(width));
    requestAnimationFrame(paint);
  };
  const setSidebarMode = (mode: string): void => {
    sidebar.hidden = mode === "hidden";
    if (!sidebar.hidden) sidebarMode = mode;
    sidebar.dataset.mode = sidebarMode;
    sidebarShow.setAttribute("aria-expanded", String(!sidebar.hidden));
    for (const button of Array.from(document.querySelectorAll<HTMLButtonElement>("[data-sidebar-mode]"))) {
      button.setAttribute("aria-pressed", String(button.dataset.sidebarMode === mode));
    }
    sizeSidebar();
  };
  document.querySelectorAll<HTMLButtonElement>("[data-sidebar-mode]").forEach(button => {
    button.addEventListener("click", () => {
      setSidebarMode(button.dataset.sidebarMode!);
      if (sidebar.hidden) sidebarShow.focus();
    });
  });
  sidebarShow.addEventListener("click", () => setSidebarMode(sidebar.hidden ? sidebarMode : "hidden"));
  let sidebarDragOffset = 0;
  sidebarResize.addEventListener("pointerdown", event => {
    if (event.button !== 0) return;
    event.preventDefault();
    sidebarResize.focus();
    sidebarDragOffset = sidebar.getBoundingClientRect().right - event.clientX;
    sidebarResize.setPointerCapture(event.pointerId);
  });
  sidebarResize.addEventListener("pointermove", event => {
    if (!sidebarResize.hasPointerCapture(event.pointerId)) return;
    sidebarWidths[sidebarMode] = Math.max(Number(sidebarResize.getAttribute("aria-valuemin")), Math.min(Number(sidebarResize.getAttribute("aria-valuemax")), event.clientX + sidebarDragOffset - sidebar.getBoundingClientRect().left));
    sizeSidebar();
  });
  sidebarResize.addEventListener("pointerup", event => {
    if (sidebarResize.hasPointerCapture(event.pointerId)) sidebarResize.releasePointerCapture(event.pointerId);
  });
  sidebarResize.addEventListener("keydown", event => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    const maximum = Number(sidebarResize.getAttribute("aria-valuemax"));
    const minimum = Number(sidebarResize.getAttribute("aria-valuemin"));
    const width = sidebar.getBoundingClientRect().width;
    sidebarWidths[sidebarMode] = event.key === "Home" ? minimum : event.key === "End" ? maximum
      : Math.max(minimum, Math.min(maximum, width + (event.key === "ArrowLeft" ? -10 : 10)));
    sizeSidebar();
  });
  window.addEventListener("resize", sizeSidebar);
  setSidebarMode(sidebarMode);
  const help = document.querySelector<HTMLElement>("#help-panel");
  const helpToggle = document.querySelector<HTMLButtonElement>("#help-toggle");
  const setHelp = (open: boolean): void => {
    if (help) help.hidden = !open;
    helpToggle?.setAttribute("aria-expanded", String(open));
    if (!open) helpToggle?.focus();
  };
  helpToggle?.addEventListener("click", () => setHelp(help?.hidden ?? false));
  document.querySelector("#help-close")?.addEventListener("click", () => setHelp(false));
  document.querySelector("#history-toggle")?.addEventListener("click", (event) => {
    logElement.hidden = !logElement.hidden;
    (event.currentTarget as HTMLElement).setAttribute("aria-expanded", String(!logElement.hidden));
    // A hidden element measures zero, so the scroll to the last line that
    // drawLog runs after each command had no effect while the panel was shut.
    // Drawing the log again on the way open puts the newest lines in view,
    // which are the ones an operator opens the panel to read.
    drawLog(logElement, state.log);
    paint();
  });

  input.addEventListener("input", () => {
    paintCommandLine();
  });

  input.addEventListener("scroll", () => {
    if (commandMirror !== undefined) {
      commandMirror.scrollLeft = input.scrollLeft;
    }
  });

  input.addEventListener("keydown", (event: KeyboardEvent) => {
    if ((event.key === "ArrowUp" || event.key === "ArrowDown") && history.length > 0 && state.pending === undefined) {
      event.preventDefault();
      if (historyIndex === history.length) historyDraft = input.value;
      historyIndex = Math.max(0, Math.min(history.length, historyIndex + (event.key === "ArrowUp" ? -1 : 1)));
      input.value = history[historyIndex] ?? historyDraft;
      input.setSelectionRange(input.value.length, input.value.length);
      paintCommandLine();
      return;
    }
    if (event.key === "Tab") {
      event.preventDefault();
      completeAtCursor();
      return;
    }
    if (event.key === "Escape") {
      showCandidates([]);
      return;
    }
    if (event.key !== "Enter") {
      showCandidates([]);
      return;
    }
    const line = input.value;
    if (line.trim() === "" && state.pending === undefined) return;
    if (state.pending === undefined && line.trim() !== "") {
      if (history[history.length - 1] !== line) history.push(line);
      historyIndex = history.length;
      historyDraft = "";
    }
    const outcome = submitLine(state, line, viewport(), evalContext);
    if (status) status.dataset.error = String(outcome.refused);
    if (!outcome.refused) {
      input.value = "";
    }
    showCandidates([]);
    applyTransition(outcome);
  });

  /**
   * Writes as much of a completion as the candidates agree on, and shows what
   * is left to choose between. A completion that writes nothing new has run out
   * of agreement, and the list is then the whole of what it can offer.
   */
  const completeAtCursor = (): void => {
    const cursor = input.selectionStart ?? input.value.length;
    const completion = completeCommandLine(input.value, cursor, state.document.objects);
    if (completion === undefined) {
      showCandidates([]);
      return;
    }

    const typed = input.value.slice(completion.from, cursor);
    if (completion.fill !== "" && completion.fill !== typed) {
      const before = input.value.slice(0, completion.from);
      const after = input.value.slice(completion.to);
      input.value = `${before}${completion.fill}${after}`;
      const caret = completion.from + completion.fill.length;
      input.setSelectionRange(caret, caret);
    }

    showCandidates(completion.candidates.length > 1 ? completion.candidates : []);
    paintCommandLine();
  };

  /**
   * Paints a ground behind each run of the command line that named something.
   * It builds the layer out of text nodes and elements rather than out of
   * markup, so a line an operator typed can never be read as markup.
   *
   * The layer scrolls with the input, because an input scrolls sideways once
   * the line outgrows it and a mark that stayed put would sit under the wrong
   * letters.
   */
  const paintCommandLine = (): void => {
    if (commandMirror === undefined) {
      return;
    }
    writeMarks(commandMirror, input.value, classifyCommandLine(input.value, state.document.objects));
    commandMirror.scrollLeft = input.scrollLeft;
  };

  const showCandidates = (candidates: readonly string[]): void => {
    if (candidates.length === 0) {
      candidateList.textContent = "";
      candidateList.hidden = true;
      return;
    }
    candidateList.replaceChildren();
    for (const candidate of candidates.slice(0, CANDIDATE_LIMIT)) {
      const button = document.createElement("button"); button.type = "button"; button.textContent = candidate;
      button.addEventListener("pointerdown", event => event.preventDefault());
      button.addEventListener("click", () => {
        const completion = completeCommandLine(input.value, input.selectionStart ?? input.value.length, state.document.objects);
        if (!completion) return;
        input.value = input.value.slice(0, completion.from) + candidate + input.value.slice(completion.to);
        const caret = completion.from + candidate.length; input.setSelectionRange(caret, caret);
        input.focus(); showCandidates([]); paintCommandLine();
      });
      candidateList.append(button);
    }
    if (candidates.length > CANDIDATE_LIMIT) {
      candidateList.append(document.createTextNode(`   and ${candidates.length - CANDIDATE_LIMIT} more`));
    }
    candidateList.hidden = false;
  };

  window.addEventListener("keydown", (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      if (help && !help.hidden) {
        setHelp(false);
        return;
      }
      closeMenu();
      apply(escape(state));
      return;
    }
    const target = event.target as HTMLElement;
    const editing = target.matches("input, textarea, select, math-field, [contenteditable]");
    if ((!editing || (target === input && input.value === "")) && (event.ctrlKey || event.metaKey) && ["b", "i"].includes(event.key.toLowerCase())) {
      event.preventDefault(); formatEmphasis(event.key.toLowerCase() === "b" ? "bold" : "italic"); return;
    }
    if (activeCell && state.interaction.selectedObjectIds.includes(activeCell.objectId) && (!editing || (target === input && input.value === "")) && ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "F2"].includes(event.key)) {
      event.preventDefault();
      if (event.key === "F2") { inPlaceEditor = { kind: "cell", ...activeCell }; paint(); }
      else navigateCell({ kind: "cell", ...activeCell }, ["ArrowLeft", "ArrowRight"].includes(event.key) ? "column" : "row", ["ArrowLeft", "ArrowUp"].includes(event.key) ? -1 : 1);
      return;
    }
    if (event.key === " " && input.value === "" && (!editing || target === input)) {
      event.preventDefault();
      spaceHeld = true;
    }
  });
  window.addEventListener("keyup", (event: KeyboardEvent) => {
    if (event.key === " ") {
      spaceHeld = false;
    }
  });

  const tableBoundaryAt = (point: ScreenPoint): typeof tableResize => {
    const world = screenToWorld(state.document.camera, point);
    const tolerance = 5 * window.devicePixelRatio / state.document.camera.zoom;
    for (const object of [...displayObjects(state.document.objects)].reverse()) {
      if (object.type !== "table" || !state.interaction.selectedObjectIds.includes(object.id)) continue;
      const layout = tableLayout(object);
      const x = world.x - (readNumber(object, ["origin", "x"]) ?? 0);
      const y = world.y - (readNumber(object, ["origin", "y"]) ?? 0);
      if (y >= 0 && y <= layout.height) {
        const index = layout.x.findIndex((edge, i) => i > 0 && Math.abs(x - edge) < tolerance);
        if (index > 0 && object.slots[`columns.${index}.width`]?.kind !== "formula") return { objectId: object.id, axis: "column", index, start: world.x, size: layout.widths[index - 1]!, value: layout.widths[index - 1]! };
      }
      if (x >= 0 && x <= layout.width) {
        const index = layout.y.findIndex((edge, i) => i > 0 && Math.abs(y - edge) < tolerance);
        if (index > 0 && object.slots[`rowsizes.${index}.height`]?.kind !== "formula") return { objectId: object.id, axis: "row", index, start: world.y, size: layout.heights[index - 1]!, value: layout.heights[index - 1]! };
      }
    }
    return undefined;
  };

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
    if (event.button !== 0) return;
    tableResize = tableBoundaryAt(point);
    if (tableResize) return;
    const cell = editorTargetAt(point, state.document.objects, state.document.camera);
    activeCell = cell?.kind === "cell" ? { objectId: cell.objectId, cell: cell.cell } : undefined;
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
    if (target.kind === "cell") activeCell = { objectId: target.objectId, cell: target.cell };
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
    const bounds = canvas.getBoundingClientRect();
    cursor.style.left = `${event.clientX - bounds.left}px`;
    cursor.style.top = `${event.clientY - bounds.top}px`;
    if (tableResize) {
      const world = screenToWorld(state.document.camera, point);
      tableResize.value = Math.max(tableResize.axis === "column" ? 24 : 20, Math.round(tableResize.size + (tableResize.axis === "column" ? world.x : world.y) - tableResize.start));
      paint(); return;
    }
    if (pan !== undefined) {
      apply(panByScreen(state, point.x - pan.lastScreenX, point.y - pan.lastScreenY));
      pan = { lastScreenX: point.x, lastScreenY: point.y };
      return;
    }
    const overHandle = resizeHandleUnder(state.interaction, point, state.document.objects, state.document.camera);
    const overGrip = pathGripUnder(state.interaction, point, state.document.objects, state.document.camera);
    const boundary = tableBoundaryAt(point);
    canvas.style.cursor = boundary ? boundary.axis === "column" ? "col-resize" : "row-resize" : overHandle !== undefined ? resizeCursor(overHandle) : overGrip === undefined ? "" : "pointer";
    apply(pointerMoveTo(state, point, evalContext));
  });

  const endGesture = (event: PointerEvent): void => {
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    if (tableResize) {
      const resize = tableResize; tableResize = undefined;
      if (event.type !== "pointercancel" && resize.value !== resize.size) applyOperations([setLiteral(resize.objectId, [resize.axis === "column" ? "columns" : "rowsizes", String(resize.index), resize.axis === "column" ? "width" : "height"], resize.value)]);
    }
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
    const insideOpenEditor = target.closest(".panel-row__input, .panel-row__choice, .panel-row__color, .property-source") !== null;
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
    pinnedPanels.set(panelDrag.objectId, { left: event.clientX - bounds.left - panelDrag.offsetLeft, top: event.clientY - bounds.top - panelDrag.offsetTop });
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
        pinnedPanels.delete(objectId);
        if (quickObjectId === objectId) quickObjectId = undefined;
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
    // Only the mutation that rebuilds the ports may write a math source, so a
    // text field on that row would look writable and refuse every write. The
    // row opens the editor that can write it instead.
    if (path === "source" && state.document.objects.find((object) => object.id === objectId)?.type === "math") {
      openMathEditor(objectId);
      return;
    }
    if (clip.getAttribute("data-action") === "unlink") {
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
    rule.textContent = "Calculated";
    rule.title = "Read-only values calculated from the inputs above";
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
  element.dataset.kind = row.synthetic ? "summary" : row.kind;

  const path = document.createElement("span");
  path.className = "panel-row__path";
  path.textContent = ({ "style.strokeColor": "stroke", "style.strokeWidth": "stroke width", "style.fillColor": "fill" } as Record<string, string>)[row.path] ?? row.path;
  path.title = row.path;

  const right = document.createElement("span");
  right.className = "panel-row__right";
  if (editing !== undefined && editing.path === row.path) {
    right.append(panelEditInput(row.editSeed, editing.handlers));
  } else if (row.choices !== undefined) {
    right.append(panelClipElement(row));
    right.append(panelChoiceSelect(row.choices));
  } else {
    if (row.picker) {
      right.append(panelPickElement(row));
    } else if (!derived && !row.synthetic) {
      right.append(panelClipElement(row));
      if (row.kind === "formula") {
        const unlink = document.createElement("button");
        unlink.type = "button";
        unlink.className = "panel-clip panel-unlink";
        unlink.dataset.action = "unlink";
        unlink.textContent = "Unlink";
        unlink.title = `Disconnect ${row.path} and keep its current value`;
        unlink.setAttribute("aria-label", `Unlink ${row.path} and keep its current value`);
        right.append(unlink);
      }
    }
    if (row.color !== undefined) {
      right.append(panelColorElement(row.path, row.color));
    }
    const value = document.createElement("span");
    value.className = "panel-row__value";
    value.textContent = row.formulaSource === undefined ? (row.kind === "literal" && row.value === "nothing" ? "" : row.value) : `= ${row.formulaSource}  (${row.value})`;
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
    const label = choices.labels[index] ?? "";
    option.textContent = ({ "the formula": "Formula", "the result": "Result", "the formula and its result": "Formula + result" } as Record<string, string>)[label] ?? label;
    select.append(option);
  }
  select.selectedIndex = choices.selectedIndex;
  return select;
}

function panelClipElement(row: PanelRow): HTMLElement {
  const clip = document.createElement("button");
  clip.type = "button";
  clip.className = row.kind === "formula" ? "panel-clip panel-clip--formula" : "panel-clip panel-clip--literal";
  const unset = row.kind === "literal" && row.value === "nothing";
  if (unset) clip.classList.add("panel-clip--unset");
  clip.textContent = row.kind === "formula" ? "ƒx" : unset ? "Unset" : "Value";
  clip.title = row.kind === "formula" ? "Driven by a formula · click to edit" : unset ? "No value assigned · click to set a value or formula" : "Fixed value · click to edit or enter a formula";
  clip.setAttribute("aria-label", row.kind === "formula" ? `Edit formula for ${row.path}` : `Edit value for ${row.path}`);
  return clip;
}

function panelPickElement(row: PanelRow): HTMLElement {
  const pick = document.createElement("span");
  pick.className = "panel-pick";
  pick.textContent = "📁 choose…";
  pick.setAttribute("aria-label", `choose a picture for ${row.path}`);
  return pick;
}

function panelEditInput(seed: string, handlers: PanelEditHandlers): HTMLElement {
  const field = document.createElement("span");
  field.className = "panel-row__field";

  const mirror = document.createElement("div");
  mirror.className = "panel-row__mirror";
  mirror.setAttribute("aria-hidden", "true");

  const input = document.createElement("input");
  input.type = "text";
  input.className = "panel-row__input";
  input.value = seed;

  const mark = (): void => {
    writeMarks(mirror, input.value, handlers.onMarks?.(input.value) ?? []);
    mirror.scrollLeft = input.scrollLeft;
  };

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
    if (event.key === "Tab") {
      event.preventDefault();
      applyFieldCompletion(input, handlers.onComplete);
      mark();
    } else if (event.key === "Enter") {
      commit();
    } else if (event.key === "Escape") {
      cancel();
    }
  });
  input.addEventListener("input", mark);
  input.addEventListener("scroll", mark);
  input.addEventListener("blur", cancel);

  field.append(mirror, input);
  mark();
  return field;
}

/**
 * Writes a completion into a field and puts the caret after it. A field that
 * offers none is left as it was, so the key does nothing rather than something
 * surprising.
 */
function applyFieldCompletion(
  field: HTMLInputElement,
  complete: ((value: string, cursor: number) => FieldEdit | undefined) | undefined,
): void {
  if (complete === undefined) {
    return;
  }
  const edit = complete(field.value, field.selectionStart ?? field.value.length);
  if (edit === undefined) {
    return;
  }
  field.value = edit.value;
  field.setSelectionRange(edit.caret, edit.caret);
}

function downloadDocument(state: Document): void {
  const url = URL.createObjectURL(new Blob([saveDocument(state)], { type: "application/json" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "beheader.json";
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
