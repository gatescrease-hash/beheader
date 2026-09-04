/**
 * renderer.ts — Canvas2D immediate-mode renderer: clear, apply the camera
 * transform, draw every object.
 *
 * IMPLEMENTS: PROJECT_BRIEF §5.9 ("Immediate mode. Every invalidation: clear,
 * apply camera transform, draw every visible object in z-order. No retained
 * scene graph, no diffing.") and §5.4's rendering clause ("fixed-size cells,
 * grid lines, numbers right-aligned and strings left-aligned"). Not on §6.2's
 * load-bearing list — this file only CONSUMES the graph.
 * LAYER: render. Touches Canvas2D directly — the one layer Rule 1 does not
 * bind (Rule 1 is `engine/`-only). May import: engine/* (read-only), own
 * layer. NEVER imported by engine/*.
 *
 * WHAT THIS IS
 *   `renderDocument(ctx, viewportWidth, viewportHeight, objects, camera,
 *   selectedObjectIds?, panelledObjectIds?, editing?, images?)` — the one
 *   exported entry point, a
 *   pure function of its arguments. It takes `objects`, not a whole engine
 *   `Document`: this file draws graph state, and the narrow argument both
 *   keeps it testable and sidesteps `Document` colliding with the DOM's own
 *   global `Document` type, which this file — unlike `engine/document.ts` —
 *   sits alongside.
 *
 *   THREE passes, in this order:
 *     1. Clear the WHOLE viewport in screen space (transform reset to
 *        identity FIRST — see `clearScreen`).
 *     2. Set the camera transform ONCE and draw every object, then — for
 *        every id in `selectedObjectIds` that names one of them (**D-100**
 *        clause 8 widens this from one id to a list) — that object's
 *        selection highlight, in RAW WORLD-SPACE coordinates — letting the
 *        canvas transform do the conversion. No draw call in this pass ever
 *        calls `worldToScreen` itself. The transform is derived from
 *        `camera.ts`'s OWN `worldToScreen` rather than a second hand-written
 *        copy of the formula (D-010): this file may never compute a
 *        different world<->screen mapping than `camera.ts` does.
 *     3. Reset to identity again and draw every object's SCREEN-SPACE chrome
 *        — a name label (D-092 clause 1), an error badge, a formula-driven
 *        indicator (§5.9, D-068) — each converted through `worldToScreen`
 *        explicitly, because chrome text must stay a constant size regardless
 *        of zoom, unlike the geometry in pass 2. Every id in `panelledObjectIds`
 *        (**D-106** clause 5) has its name label suppressed here: its name
 *        moves into its properties panel's header, which `main.ts` draws.
 *        Its badge and ticks still draw — they mark the shape, and the panel
 *        says the same in words.
 *
 *   `selectedObjectIds` (the highlight) and `panelledObjectIds` (the name
 *   suppression) are DELIBERATELY two separate lists, not one collapsed back
 *   together (**D-106** clause 5): a selected object whose panel has been
 *   DISMISSED keeps its highlight — the operator is still working with it —
 *   but gets its canvas name label back, because nothing else is showing it
 *   any more. `panelledObjectIds` defaults to `selectedObjectIds`, which is
 *   what keeps every pre-D-106 call site (every test written before this
 *   ruling, and any future one that has no reason to dismiss a panel) meaning
 *   "the panel follows the selection" without passing a second argument.
 *
 *   The highlight is drawn in a SEPARATE pass after every object (not
 *   inline with pass 2's per-object loop) so it is never occluded by a LATER
 *   object in z-order — array order is z-order (below), and a selected
 *   object is not always the last one drawn.
 *
 *   Z-ORDER is `objects`' array order. The brief names z-order but gives
 *   objects no explicit z field, so array order (creation order, absent a
 *   reorder command that does not exist) is the disclosed, reversible
 *   reading — Rule 5's "dumbest correct implementation." `hittest.ts` reads
 *   it the same way, from the other end.
 *
 *   Two §5.5 clauses that are deliberate and must not be normalised away:
 *   `circle` draws a TRUE ARC from `origin`/`radius` ("the renderer still
 *   draws a true arc"), never the polygonal `vertices` approximation that
 *   slot exists for; `polygon`/`rect` read `vertices` and stroke the closed
 *   path it describes ("consumers always read `vertices`"). Every type with
 *   no schema or visual definition yet draws nothing, rather than a
 *   placeholder.
 *
 * INVARIANTS UPHELD HERE
 *   - Never throws. A missing, wrong-typed, or `ErrorValue` input makes that
 *     ONE object draw nothing — it does not abort the loop or blank the rest
 *     of the frame.
 *   - No engine state is written here (Rule 2) — every function below only
 *     READS `GraphObject`/`Value` and calls `ctx` methods.
 *   - `ctx` is left holding IDENTITY on return, not the camera transform —
 *     the screen-space chrome pass below resets it last, which is what makes
 *     this safe for a caller to draw further screen-space chrome after
 *     (D-092-REVIEW's own D-092, `main.ts` draws none today). The former
 *     HAZARD note here (D-068 said "owned by whichever cycle first draws
 *     screen-space chrome") is THIS cycle and is now closed by construction.
 *   - **A selection highlight, an error badge, and a table's grid extent are
 *     each derived from the SAME reads `drawObject`/`drawTable` already make**
 *     (D-010) — never a second, independently computed outline or box that
 *     could disagree with what is actually drawn.
 *
 * NOT DONE HERE
 *   - **D-090's prompt-sequence preview** (the marker-and-shape a live
 *     `circle`/`polygon`/`rect` prompt would produce). Needs `state.pending`,
 *     which is `main.ts`'s and does not reach this file yet — a separate
 *     cycle, deliberately (0092-REVIEW §5).
 *   - **The formula-driven indicator is read NARROWLY**, as the two
 *     component slots a drag can actually move (`render/interaction.ts`'s
 *     per-component rule): `origin.x`/`origin.y`. A future per-vertex drag
 *     path or a `style` slot bound to a formula gets no indicator yet — this
 *     file has no general "every writable slot on this object" enumeration,
 *     and inventing one is a bigger cycle than D-068 asked for.
 *   - `style` slots (§5.5's `Path` shape) — `geometry.ts` declares none yet,
 *     so every shape draws with one disclosed default stroke, and the
 *     selection highlight and chrome text below are equally untuned (Rule 5).
 *   - `script` objects (no VISUAL definition here — §5.8's labelled box with
 *     ports is a separate future slice, **D-142** clause 3) and `polyline`'s
 *     per-vertex shape (deferred with `explode`) draw no body AND no chrome —
 *     `chromeAnchorPoint` returns `undefined` for every type with no extent.
 *     `image` DOES draw now (**D-142**): `drawImage` strokes the object's
 *     `width` x `height` box and fits the decoded picture inside it, preserving
 *     its aspect ratio; the decoded bitmap arrives through the injected
 *     `ImageBitmaps` (`render/images.ts`), because Rule 1 keeps a `Map` of live
 *     `HTMLImageElement`s out of `engine/` and this file takes it as an argument
 *     rather than holding one. A missing `ImageBitmaps` — every test that does
 *     not pass one — draws the frame and no picture.
 *     `text` DOES draw now (entry 0138): `drawText` paints the layout
 *     `render/measure.ts`'s `layOutText` returns for `resolvedContent`, from
 *     `origin` (top-left), wrapping at a numeric `width` slot and honouring
 *     `style.font`/`fontSize`/`lineHeight`/`color`/`align`. Its chrome and
 *     selection highlight fall out of `extent.ts`'s `text` extent.
 *   - CHOOSING the fonts markdown-lite draws in. §5.6's markup IS honoured
 *     (entry 0160) — but which font a `**bold**` or a `# heading` becomes is
 *     `measure.ts`'s, so the measured box and the drawn ink come from one
 *     answer (D-010). This file sets `ctx.font` to the string each laid-out
 *     run already carries, and decides nothing about it.
 *   - CROPPING, in any form. §5.6's `overflow` enum is gone (the human's
 *     2026-09-02 ruling): a text box grows to hold its text — `render/
 *     textbox.ts` is that rule — so there is never anything outside the box to
 *     clip or ellipsise, and `drawText` consults no such slot.
 *   - Any bound on `rows`/`cols`/`sides` — a carried known problem; one fix
 *     covers drawing and evaluation together.
 */
import { getSlot, isErrorValue, TABLE_TYPE, type GraphObject, type Point, type Value } from "../engine/graph/node.ts";
// Type-only, and one direction: `editor.ts` says what the in-place editor is
// open on, and this file is one of its readers (D-010 — never a second,
// narrower spelling of "which cell is being edited"). `editor.ts` does not
// import this file, so there is no cycle.
import type { EditorTarget } from "./editor.ts";
import { ORIGIN_X_PATH, ORIGIN_Y_PATH, RADIUS_PATH, VERTICES_PATH } from "../engine/primitives/geometry.ts";
import { getTableDimensions } from "../engine/primitives/table.ts";
import {
  TEXT_AUTORESIZE_PATH,
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
} from "../engine/primitives/text.ts";
import { IMAGE_OPACITY_PATH, IMAGE_SOURCE_PATH } from "../engine/primitives/image.ts";
import { formatCellReference, indexToColumnLetters, TABLE_CELL_PATH_PREFIX } from "../engine/address.ts";
import type { CameraState } from "../engine/document.ts";
import { worldToScreen } from "./camera.ts";
import type { ImageBitmaps } from "./images.ts";
import { handlePoint, hasResizeHandles, RESIZE_HANDLES, RESIZE_HANDLE_SIZE_SCREEN } from "./handles.ts";
import { layOutText } from "./measure.ts";
import { asPointArray, readBoolean, readNumber, readText, TABLE_CELL_HEIGHT, TABLE_CELL_WIDTH } from "./slots.ts";
import { textBoxSize } from "./textbox.ts";
// D-066's one extent, reused as the chrome anchor (see `chromeAnchorPoint`).
// `extent.ts` and `slots.ts` are D-093's split: neither this file nor
// `hittest.ts` imports the other any more, so there is no cycle to flag here.
import { objectExtent } from "./extent.ts";

/**
 * World-unit defaults — no `style` slot exists yet (see file header). Round,
 * untuned (Rule 5).
 *
 * PROVISIONAL(Q-012): the WIDTH is in world units, so it scales with zoom —
 * 1 world unit is 0.01 screen px at `MIN_ZOOM` and 100 px at `MAX_ZOOM`.
 * §5.5 puts `strokeWidth` inside the shape's own `style` (a property of the
 * shape, not of the view), which is why this is the taken reading; the cycle
 * that declares real `style` slots settles it.
 */
const DEFAULT_SHAPE_STROKE_STYLE = "#1a1a1a";
const DEFAULT_SHAPE_STROKE_WIDTH = 1;

// §5.4's fixed cell size (`TABLE_CELL_WIDTH`/`TABLE_CELL_HEIGHT`) moved to
// `slots.ts` at D-093's split — `hittest.ts` and `extent.ts` need the SAME
// constants (D-010) and this file no longer defines them, only imports them.
const TABLE_CELL_TEXT_PADDING = 4;
const TABLE_GRID_STROKE_STYLE = "#999999";
const TABLE_CELL_TEXT_STYLE = "#1a1a1a";
const TABLE_CELL_FONT = "14px sans-serif";

/**
 * Fallbacks for a `text` object whose `style.*` slots are absent — reachable
 * only from a hand-built test fixture, since `command/commands.ts`'s `createText`
 * always supplies all five (its own `DEFAULT_TEXT_*`). They exist so `drawText`
 * never feeds `ctx.font` a `NaN` size or `undefined` family; a real `text`
 * object draws with its OWN slot values. World units (Q-012's provisional (a),
 * like `TABLE_CELL_FONT`), round and untuned (Rule 5).
 */
const DEFAULT_TEXT_FILL_STYLE = "#1a1a1a";
const DEFAULT_TEXT_FONT_FAMILY = "sans-serif";
const DEFAULT_TEXT_FONT_SIZE = 16;
const DEFAULT_TEXT_LINE_HEIGHT = 20;

/**
 * §5.7's `image` frame — the object's own box, stroked whether or not a picture
 * has been chosen or decoded yet.
 *
 * It is what makes `imageExtent`'s "the box is the extent, always" honest under
 * D-066: an image is a real object occupying `width` x `height` from the moment
 * it is created, so it is drawn from that moment and is selectable from that
 * moment. Without it, an image whose picker was dismissed, whose file was not a
 * picture, or whose decode has not landed yet would be an invisible click
 * target — the state **D-142** refused, merely moved one step later.
 *
 * Grey and one world unit wide, the same untuned reading `TABLE_GRID_STROKE_STYLE`
 * takes (Rule 5, PROVISIONAL(Q-012) like every other world-unit width here). It
 * is one constant and one `strokeRect` to delete if the operator would rather see
 * a bare picture.
 */
const IMAGE_FRAME_STROKE_STYLE = "#999999";

/**
 * §5.7's `opacity`, for a slot holding something unusable — missing, an
 * `ErrorValue`, a string. Fully opaque, which is `command/commands.ts`'s own
 * `DEFAULT_IMAGE_OPACITY`; not imported from there because `render/` may not
 * import `command/`, and a picture that vanished because its slot was broken
 * would be indistinguishable from one that never decoded.
 */
const DEFAULT_IMAGE_OPACITY = 1;

/**
 * §5.7: "draw at a position with width/height, preserve aspect ratio by
 * default." Draws the object's frame, then — once `images` has a decoded
 * picture for its `source` — that picture, fitted inside the frame.
 *
 * The box comes from `extent.ts`'s `objectExtent`, not from a second reading of
 * `origin`/`width`/`height` here: D-066 makes the drawn box and the click box one
 * box, and taking them from one function is what makes that structural rather
 * than a thing two files must agree about (D-010). An object with no extent
 * draws nothing at all.
 *
 * `opacity` is CLAMPED here rather than refused at write time — D-140 clause 3:
 * the slot is unbounded document state and the renderer clamps what it paints,
 * exactly as `resolveTextStyle` does for an unknown `style.align`. The frame is
 * drawn at full opacity deliberately: it is the object's box, not part of the
 * picture, so `set image_1.opacity 0` hides the picture without losing the object.
 *
 * Never throws: a missing/wrong-typed `source`, a decode still in flight, and a
 * decode that failed are one case here — no picture yet, frame only.
 */
function drawImage(ctx: CanvasRenderingContext2D, object: GraphObject, images: ImageBitmaps | undefined): void {
  const box = objectExtent(object);
  if (box === undefined) {
    return;
  }
  const boxWidth = box.maxX - box.minX;
  const boxHeight = box.maxY - box.minY;
  ctx.strokeStyle = IMAGE_FRAME_STROKE_STYLE;
  ctx.lineWidth = DEFAULT_SHAPE_STROKE_WIDTH;
  ctx.strokeRect(box.minX, box.minY, boxWidth, boxHeight);

  const source = readText(object, IMAGE_SOURCE_PATH);
  if (source === undefined || images === undefined) {
    return;
  }
  const bitmap = images.bitmapFor(source);
  if (bitmap === undefined) {
    return;
  }
  const fitted = fitBitmapIntoBox(boxWidth, boxHeight, bitmap.naturalWidth, bitmap.naturalHeight);
  const opacity = readNumber(object, IMAGE_OPACITY_PATH) ?? DEFAULT_IMAGE_OPACITY;
  const previousAlpha = ctx.globalAlpha;
  ctx.globalAlpha = Number.isFinite(opacity) ? Math.min(1, Math.max(0, opacity)) : DEFAULT_IMAGE_OPACITY;
  ctx.drawImage(bitmap.image, box.minX + fitted.x, box.minY + fitted.y, fitted.width, fitted.height);
  // Restored rather than set to 1: every other draw call in this file assumes it
  // owns nothing about `ctx` beyond what it sets itself, and leaving a
  // half-transparent context behind would fade whichever object is drawn next.
  ctx.globalAlpha = previousAlpha;
}

/**
 * §5.7's "preserve aspect ratio by default", as arithmetic: the largest box with
 * the picture's own proportions that fits inside `boxWidth` x `boxHeight`,
 * centred in it. Offsets are relative to the box's top-left corner.
 *
 * PROVISIONAL(Q-027): this reads §5.7's clause as a permanent property of how a
 * picture is DRAWN — the `width`/`height` slots bound the picture and its
 * proportions are never distorted, at any size the operator sets. The other
 * reading is that the clause is about the size a picture is first given: write
 * the decoded natural size into the two slots at load time and let the operator
 * distort them afterwards. That reading needs the natural size to reach a SLOT,
 * which 0172-REVIEW §8 named as the load-bearing half of the question, so it is
 * asked rather than taken (Q-027). This one is reversible in this one function.
 *
 * A non-positive or non-finite natural size cannot yield a ratio, so the picture
 * simply fills the box — unreachable through `images.ts`, which refuses such a
 * decode, and total rather than assumed away.
 */
function fitBitmapIntoBox(
  boxWidth: number,
  boxHeight: number,
  naturalWidth: number,
  naturalHeight: number,
): { readonly x: number; readonly y: number; readonly width: number; readonly height: number } {
  if (!(naturalWidth > 0) || !(naturalHeight > 0) || !Number.isFinite(naturalWidth) || !Number.isFinite(naturalHeight)) {
    return { x: 0, y: 0, width: boxWidth, height: boxHeight };
  }
  const scale = Math.min(boxWidth / naturalWidth, boxHeight / naturalHeight);
  const width = naturalWidth * scale;
  const height = naturalHeight * scale;
  return { x: (boxWidth - width) / 2, y: (boxHeight - height) / 2, width, height };
}

/**
 * §5.9's selection highlight (D-068): the SAME path/box `drawObject` built
 * for the selected object, re-stroked in this style. World units, like every
 * other stroke width above (PROVISIONAL(Q-012)) — a screen-space-fixed ring
 * would read as "at this point," not "around this shape."
 */
const SELECTION_HIGHLIGHT_STYLE = "#2456c9";
const SELECTION_HIGHLIGHT_WIDTH = DEFAULT_SHAPE_STROKE_WIDTH * 3;

/**
 * A resize grabber's paint (the human's 2026-09-02 text-box rework): a white
 * square outlined in the selection colour, so it reads as part of the selection
 * and stays visible over dark ink and light canvas alike. SCREEN pixels, like
 * every other chrome constant — its SIZE lives in `handles.ts`, next to the hit
 * test that must agree with it (D-010).
 */
const RESIZE_HANDLE_FILL_STYLE = "#ffffff";
const RESIZE_HANDLE_STROKE_WIDTH_SCREEN = 1;

/**
 * Screen-space chrome (D-092 clause 1, D-068's badge and indicator) — SCREEN
 * pixels, deliberately not PROVISIONAL(Q-012)'s world-unit reading: chrome
 * text must stay one legible size at any zoom, which is the whole reason
 * `drawObjectChrome` runs in its own identity-transform pass (file header).
 * All four constants are Rule 5's "dumbest correct implementation" — chosen,
 * not measured, same as every other constant in this file.
 */
const CHROME_ANCHOR_MARGIN_SCREEN = 6;
const CHROME_GAP_SCREEN = 6;
const CHROME_FONT = "12px sans-serif";
const CHROME_LABEL_STYLE = "#1a1a1a";
const CHROME_ERROR_BADGE_STYLE = "#c0392b";
const CHROME_FORMULA_TICK_STYLE = "#2456c9";

/**
 * A table's A1 row/column headers (the human's 2026-09-02 request: *"we need to
 * add table row/column references in a graphical way for table objects. Almost
 * like in the same font and size as the object title, but centered over each row
 * and column persistently"*).
 *
 * Screen-space, in `CHROME_FONT` — the operator asked for the title's font and
 * size, and constant-size-at-any-zoom is what the chrome pass is for. The one
 * deviation from "same as the title" is COLOUR: a muted grey, so the headers
 * read as the sheet's furniture rather than as another object's name sitting on
 * the canvas. Easy to revert to `CHROME_LABEL_STYLE` if that reads wrong on
 * screen.
 *
 * `MIN_CELL_SCREEN` is the smallest a cell may appear before its header is
 * skipped on that axis. Constant-size labels over a shrinking grid eventually
 * overlap into a smear, and an unreadable smear is worse than nothing; each axis
 * is tested separately, because zoom is uniform but cells are not square.
 * Untuned, like every other constant here (Rule 5).
 */
const TABLE_HEADER_MARGIN_SCREEN = 4;
const TABLE_HEADER_LABEL_STYLE = "#6b7280";
const TABLE_HEADER_MIN_CELL_SCREEN = 14;

/** How much room a type's headers take ABOVE its drawn top edge, so `drawObjectChrome` can lift the name label clear of them instead of printing one on top of the other. Zero for every type but `table`. */
function chromeTopReservedScreen(object: GraphObject): number {
  return object.type === TABLE_TYPE ? CHROME_FONT_SIZE_SCREEN + TABLE_HEADER_MARGIN_SCREEN : 0;
}

/** `CHROME_FONT`'s size in screen pixels, spelled once. Only `chromeTopReservedScreen` needs the number rather than the shorthand — a second literal `12` would be free to drift from the font string. */
const CHROME_FONT_SIZE_SCREEN = 12;

/**
 * Clears `viewportWidth` x `viewportHeight` in SCREEN space. MUST run with the
 * transform at identity — `ctx.clearRect` is itself subject to the current
 * transform (same as every other draw call), so clearing BEFORE the camera
 * transform is applied is what makes this clear the whole visible canvas
 * regardless of the current pan/zoom, rather than a camera-warped rectangle
 * that misses corners at any zoom other than 1.
 */
function clearScreen(ctx: CanvasRenderingContext2D, viewportWidth: number, viewportHeight: number): void {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, viewportWidth, viewportHeight);
}

/**
 * §5.9's whole sequence, widened by D-068/D-092/D-100/D-106: clear, apply the
 * camera transform, draw every object in z-order (array order — see file
 * header), draw every selected object's highlight, then reset to identity and
 * draw every object's screen-space chrome. An empty list, or one holding only
 * stale ids (D-023-shaped), draws no highlight and suppresses no label;
 * never throws.
 */
export function renderDocument(
  ctx: CanvasRenderingContext2D,
  viewportWidth: number,
  viewportHeight: number,
  objects: readonly GraphObject[],
  camera: CameraState,
  selectedObjectIds: readonly string[] = [],
  panelledObjectIds: readonly string[] = selectedObjectIds,
  editing: EditorTarget | undefined = undefined,
  images: ImageBitmaps | undefined = undefined,
): void {
  clearScreen(ctx, viewportWidth, viewportHeight);

  // WHAT the in-place editor is open on decides what this frame must NOT draw
  // underneath it, and the two receivers differ (the human's 2026-09-02 report
  // that a table cell ghosted while a `text` box did not):
  //
  //   - a `text` object is skipped WHOLE — body, highlight and grabbers — because
  //     the overlay replaces all three and grows past the committed extent;
  //   - a `table` keeps everything but the ONE cell's value. Its grid, its other
  //     cells, its highlight and its chrome are not the overlay's job and must
  //     stay on screen (D-125 clause 1: a cell editor covers one cell).
  const editingTextId = editing?.kind === "text" ? editing.objectId : undefined;
  const editingCellOn = (objectId: string): string | undefined =>
    editing?.kind === "cell" && editing.objectId === objectId ? editing.cell : undefined;

  // The camera transform, built from camera.ts's OWN worldToScreen rather than
  // a second copy of `screen = (world - camera) * zoom` (D-010; see header).
  // setTransform(a,b,c,d,e,f): x' = a*x + c*y + e, y' = b*x + d*y + f — with
  // a=d=zoom, b=c=0, (e,f) = worldToScreen(camera, {0,0}), this is EXACTLY
  // worldToScreen for every subsequent world-space draw call.
  const screenOrigin = worldToScreen(camera, { x: 0, y: 0 });
  ctx.setTransform(camera.zoom, 0, 0, camera.zoom, screenOrigin.x, screenOrigin.y);

  for (const object of objects) {
    // The in-place editor's overlay IS this object's text while it is open (the
    // human's 2026-09-02 rework: "there is no difference between how the text
    // looks when you're not editing it and how it looks when you are"). Drawing
    // underneath it would double every glyph the moment the two disagree — and
    // they disagree by design, because the overlay holds the RAW source being
    // typed while this draws the RESOLVED content of the last commit.
    if (object.id === editingTextId) {
      continue;
    }
    drawObject(ctx, object, editingCellOn(object.id), images);
  }

  // D-100 clause 8: every selected id, not just one. A `Set` so a duplicate
  // (never produced by `interaction.ts`'s own toggle, but not this file's to
  // assume) cannot double-stroke a highlight.
  const selectedIds = new Set(selectedObjectIds);

  // Drawn LAST in world space, in DOCUMENT order — never inline with the loop
  // above — so a highlight is never occluded by a later object in z-order
  // (file header).
  for (const object of objects) {
    // The object being edited is skipped here too, for the same reason its text
    // is: its committed extent is not the box on screen right now — the overlay
    // grows with what is being typed — so this outline would sit at the last
    // commit's size while the operator watches the box move away from it. The
    // overlay carries its own outline (`index.html`'s `.text-editor`).
    if (selectedIds.has(object.id) && object.id !== editingTextId) {
      drawSelectionHighlight(ctx, object);
    }
  }

  // Screen-space chrome: a fresh identity reset (clearScreen's own reasoning
  // applies again — a transform-warped label is not screen-space), then one
  // explicit worldToScreen per object (file header's pass 3).
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  // D-106 clause 5: a SEPARATE set from `selectedIds` — see file header.
  const panelledIds = new Set(panelledObjectIds);
  for (const object of objects) {
    // D-094 clause 3, generalised by D-100 clause 8, narrowed again by D-106
    // clause 4: a PANELLED object's NAME moves into its properties panel's
    // header, so it is not also drawn on the canvas. A selected-but-dismissed
    // object is NOT in `panelledIds` and gets its name back. Its badge and
    // ticks are never suppressed either way.
    drawObjectChrome(ctx, camera, object, panelledIds.has(object.id));
    // A table's A1 headers, NEVER suppressed (2026-09-02) — unlike the name,
    // which moves into the panel, nothing else on screen says which column is
    // `C`. See `drawTableHeaders`.
    drawTableHeaders(ctx, camera, object);
  }

  // The resize grabbers, last of all and still at identity: they are the one
  // piece of chrome an operator AIMS at, so nothing may cover them, and
  // `handles.ts` hit-tests them in this same screen space (D-010).
  //
  // Not on the object being edited: they would sit at its committed size while
  // the overlay shows a growing one, and there is no gesture that could reach
  // them anyway — a press on the canvas commits the edit first. This is also
  // what Word does: a box with the caret in it shows no sizing handles.
  for (const object of objects) {
    if (selectedIds.has(object.id) && object.id !== editingTextId) {
      drawResizeHandles(ctx, camera, object);
    }
  }
}

/**
 * The eight grabbers on a selected text box (the human's 2026-09-02 rework),
 * drawn in SCREEN space so they stay one comfortable size at every zoom — the
 * same reasoning the name label and error badge are drawn this way, and the
 * space `handles.ts`'s `resizeHandleAt` tests a press in.
 *
 * Nothing for an object type that has no grabbers, or one with no drawn extent
 * to hang them on (an empty `text` box — D-066); never throws.
 */
function drawResizeHandles(ctx: CanvasRenderingContext2D, camera: CameraState, object: GraphObject): void {
  if (!hasResizeHandles(object)) {
    return;
  }
  const extent = objectExtent(object);
  if (extent === undefined) {
    return;
  }
  const half = RESIZE_HANDLE_SIZE_SCREEN / 2;
  ctx.fillStyle = RESIZE_HANDLE_FILL_STYLE;
  ctx.strokeStyle = SELECTION_HIGHLIGHT_STYLE;
  ctx.lineWidth = RESIZE_HANDLE_STROKE_WIDTH_SCREEN;
  for (const handle of RESIZE_HANDLES) {
    const centre = worldToScreen(camera, handlePoint(extent, handle));
    ctx.fillRect(centre.x - half, centre.y - half, RESIZE_HANDLE_SIZE_SCREEN, RESIZE_HANDLE_SIZE_SCREEN);
    ctx.strokeRect(centre.x - half, centre.y - half, RESIZE_HANDLE_SIZE_SCREEN, RESIZE_HANDLE_SIZE_SCREEN);
  }
}

/** Dispatches by `ObjectType` (§5.1's own switch-not-dispatch-table style, PROCESS_BRIEF §5.5). Every unsupported type draws nothing — see file header. */
function drawObject(ctx: CanvasRenderingContext2D, object: GraphObject, editingCell: string | undefined, images: ImageBitmaps | undefined): void {
  switch (object.type) {
    case "circle":
      drawCircle(ctx, object);
      return;
    case "polygon":
    case "rect":
      drawVerticesShape(ctx, object);
      return;
    case "table":
      drawTable(ctx, object, editingCell);
      return;
    case "text":
      drawText(ctx, object);
      return;
    case "image":
      drawImage(ctx, object, images);
      return;
    case "polyline":
    case "script":
    case "value":
    case "add":
      return; // No visual definition yet (see file header's NOT DONE HERE).
    default: {
      // Compile-time exhaustiveness, WITHOUT a throw — the same arm every other
      // discriminated-union switch in this codebase carries (`formula/deps.ts`,
      // `formula/eval.ts`, `formula/parser.ts`, `mutation.ts`). It is what makes
      // a NEW `ObjectType` a compile error here instead of an object that
      // silently draws nothing: §5.5's `polyline` and §5.6's `text` are both
      // already promised, so this arm has a caller coming (0062-REVIEW edit 1).
      const exhaustive: never = object.type;
      void exhaustive;
      return;
    }
  }
}

/**
 * Builds (but does not stroke) §5.5's circle path — `ctx.beginPath()` /
 * `ctx.arc(...)` — from `origin.x`/`origin.y`/`radius` directly, never
 * `vertices` (§5.5: "the renderer still draws a true arc"). Returns whether a
 * path was built, so both `drawCircle` and `drawSelectionHighlight` (D-068)
 * stroke the exact SAME path in different styles rather than each computing
 * their own (D-010) — the highlight can never disagree with what is drawn.
 * `false` for a missing/wrong-typed/negative radius; never throws.
 */
function buildCirclePath(ctx: CanvasRenderingContext2D, object: GraphObject): boolean {
  const originX = readNumber(object, ORIGIN_X_PATH);
  const originY = readNumber(object, ORIGIN_Y_PATH);
  const radius = readNumber(object, RADIUS_PATH);
  if (originX === undefined || originY === undefined || radius === undefined || radius < 0) {
    return false;
  }
  ctx.beginPath();
  ctx.arc(originX, originY, radius, 0, Math.PI * 2);
  return true;
}

function drawCircle(ctx: CanvasRenderingContext2D, object: GraphObject): void {
  if (!buildCirclePath(ctx, object)) {
    return;
  }
  ctx.strokeStyle = DEFAULT_SHAPE_STROKE_STYLE;
  ctx.lineWidth = DEFAULT_SHAPE_STROKE_WIDTH;
  ctx.stroke();
}

/**
 * Builds (but does not stroke) `polygon`/`rect`'s closed path (§5.5:
 * "Consumers always read `vertices`") — the same D-010 split `buildCirclePath`
 * documents above. `false` for a missing, wrong-typed, `ErrorValue`, or empty
 * `vertices`; never throws.
 */
function buildVerticesPath(ctx: CanvasRenderingContext2D, object: GraphObject): boolean {
  const vertices = asPointArray(getSlot(object, VERTICES_PATH)?.value);
  const first = vertices?.[0];
  if (vertices === undefined || first === undefined) {
    return false;
  }
  ctx.beginPath();
  ctx.moveTo(first.x, first.y);
  for (let i = 1; i < vertices.length; i += 1) {
    const vertex = vertices[i];
    if (vertex === undefined) {
      continue; // noUncheckedIndexedAccess artifact only — `i` is always in range.
    }
    ctx.lineTo(vertex.x, vertex.y);
  }
  ctx.closePath();
  return true;
}

function drawVerticesShape(ctx: CanvasRenderingContext2D, object: GraphObject): void {
  if (!buildVerticesPath(ctx, object)) {
    return;
  }
  ctx.strokeStyle = DEFAULT_SHAPE_STROKE_STYLE;
  ctx.lineWidth = DEFAULT_SHAPE_STROKE_WIDTH;
  ctx.stroke();
}

/**
 * §5.4: "fixed-size cells, grid lines... Formula bar / in-place editing" (the
 * latter is `render/interaction.ts`'s job, not built here). Draws every cell
 * in `1..rows x 1..cols` (`getTableDimensions`, D-046-safe) as a bordered
 * rectangle plus its current value, positioned from `origin.x`/`origin.y` —
 * the same two paths every geometry preset uses, and the ones `TABLE_SCHEMA`
 * declares, so one object never has two positions. A table hand-built without
 * them falls back to `(0, 0)` rather than declining to draw, because a
 * missing coordinate is not a reason to hide a grid that has an extent.
 * Never throws.
 */
function drawTable(ctx: CanvasRenderingContext2D, object: GraphObject, editingCell: string | undefined): void {
  const originX = readNumber(object, ORIGIN_X_PATH) ?? 0;
  const originY = readNumber(object, ORIGIN_Y_PATH) ?? 0;
  const { rows, cols } = getTableDimensions(object);

  ctx.font = TABLE_CELL_FONT;
  for (let row = 1; row <= rows; row += 1) {
    for (let column = 1; column <= cols; column += 1) {
      const cellLeft = originX + (column - 1) * TABLE_CELL_WIDTH;
      const cellTop = originY + (row - 1) * TABLE_CELL_HEIGHT;

      ctx.strokeStyle = TABLE_GRID_STROKE_STYLE;
      ctx.lineWidth = DEFAULT_SHAPE_STROKE_WIDTH;
      ctx.strokeRect(cellLeft, cellTop, TABLE_CELL_WIDTH, TABLE_CELL_HEIGHT);

      const reference = formatCellReference({ column, row });
      // The in-place editor's overlay IS this cell's text while it is open (the
      // human's 2026-09-02 report: *"the current value of the cell doesn't get
      // hidden when the editor value is being displayed... ghosting of
      // text/numbers on top of each other"*). The two disagree BY DESIGN — the
      // overlay holds the raw SOURCE being typed while this draws the last
      // commit's VALUE, so `=A1*2` sits on top of `84` — and a `text` object
      // has been skipped for exactly this reason since the rework. The GRID
      // still draws: unlike a text box, the cell's rectangle is not the
      // overlay's job, and dropping it would leave a hole in the table.
      if (reference === editingCell) {
        continue;
      }
      const cellPath = [TABLE_CELL_PATH_PREFIX, reference];
      drawCellText(ctx, getSlot(object, cellPath)?.value, cellLeft, cellTop);
    }
  }
}

/**
 * §5.4: "numbers right-aligned and strings left-aligned." Everything that is
 * not a number (string, boolean, a Point/Point[], an ErrorValue) is left-
 * aligned — the brief draws only the number/string line, so this file
 * extends it the same direction for the other members of `Value` (§5.1) a
 * cell can legally hold, rather than inventing a THIRD alignment rule.
 * Draws nothing for an unset cell (`undefined`, D-047's ordinary "legally
 * empty" case) or a `null` value (§5.1) — both display as blank.
 */
function drawCellText(ctx: CanvasRenderingContext2D, value: Value | undefined, cellLeft: number, cellTop: number): void {
  if (value === undefined) {
    return;
  }
  const formatted = formatCellValue(value);
  if (formatted === null) {
    return;
  }
  ctx.fillStyle = TABLE_CELL_TEXT_STYLE;
  ctx.textBaseline = "middle";
  const y = cellTop + TABLE_CELL_HEIGHT / 2;
  if (typeof value === "number") {
    ctx.textAlign = "right";
    ctx.fillText(formatted, cellLeft + TABLE_CELL_WIDTH - TABLE_CELL_TEXT_PADDING, y);
  } else {
    ctx.textAlign = "left";
    ctx.fillText(formatted, cellLeft + TABLE_CELL_TEXT_PADDING, y);
  }
}

/**
 * Every member of `Value` (§5.1) to its cell display text, or `null` for a
 * blank cell — exhaustive by construction (TypeScript narrows `value` to
 * `Point`, the one arm with no explicit check, only after every other arm has
 * returned). An `ErrorValue` displays its bare code (`"#REF"`) — this is NOT
 * yet §5.9's "error badge" (file header); it is the same even-handed
 * treatment every other `Value` member gets, so a broken cell is legible
 * rather than silently blank. `Point`/`Point[]` are not expected to reach a
 * table cell in practice (nothing wires geometry into one yet), but the
 * function stays total over the whole union rather than assuming that.
 */
function formatCellValue(value: Value): string | null {
  if (value === null) {
    return null;
  }
  if (typeof value === "number") {
    return String(value);
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "boolean") {
    return value ? "TRUE" : "FALSE";
  }
  if (isErrorValue(value)) {
    return value.error;
  }
  if (Array.isArray(value)) {
    return `[${value.length} points]`;
  }
  // Every other member of Value is ruled out above; TypeScript's negative
  // narrowing across Array.isArray's `arg is any[]` guard does not itself
  // land on the remaining `Point` here, so the cast is explicit — the same
  // "rule out the rest, then cast" shape graph/node.ts's own `hasIllegalNumber`
  // uses for this identical remaining case.
  const point = value as Point;
  return `(${point.x}, ${point.y})`;
}

// ---------------------------------------------------------------------------
// Text (§5.6) — entry 0138. World space, under the camera transform like every
// other object body: font size is in world units and scales with zoom (Q-012's
// provisional (a), the same reading `drawTable`'s font takes).
// ---------------------------------------------------------------------------

/** One `text` object's paint-relevant style, every field defaulted so `drawText`'s arithmetic and `ctx.font` are always valid (see `DEFAULT_TEXT_*`). */
interface ResolvedTextStyle {
  readonly family: string;
  readonly fontSize: number;
  readonly lineHeight: number;
  readonly color: string;
  readonly align: "left" | "center" | "right";
}

/**
 * Reads `style.font`/`fontSize`/`lineHeight`/`color`/`align` off `object`,
 * falling back per field. `align` is clamped to the three §5.6 values a
 * `ctx.textAlign` can be here (`left`/`center`/`right`); anything else — an
 * unknown string, a formula result — reads as `left`, the default.
 */
function resolveTextStyle(object: GraphObject): ResolvedTextStyle {
  const fontSize = readNumber(object, TEXT_STYLE_FONT_SIZE_PATH);
  const lineHeight = readNumber(object, TEXT_STYLE_LINE_HEIGHT_PATH);
  const align = readText(object, TEXT_STYLE_ALIGN_PATH);
  return {
    family: readText(object, TEXT_STYLE_FONT_PATH) ?? DEFAULT_TEXT_FONT_FAMILY,
    fontSize: fontSize !== undefined && fontSize > 0 ? fontSize : DEFAULT_TEXT_FONT_SIZE,
    lineHeight: lineHeight !== undefined && lineHeight > 0 ? lineHeight : DEFAULT_TEXT_LINE_HEIGHT,
    color: readText(object, TEXT_STYLE_COLOR_PATH) ?? DEFAULT_TEXT_FILL_STYLE,
    align: align === "center" || align === "right" ? align : "left",
  };
}

/** Where a line of `lineWidth` starts, measured from the box's left edge — §5.6's three alignments as arithmetic. Kept here rather than in `measure.ts` because it needs the BOX width, which is `textbox.ts`'s answer and not the layout's. */
function alignmentOffset(align: "left" | "center" | "right", boxWidth: number, lineWidth: number): number {
  if (align === "center") {
    return (boxWidth - lineWidth) / 2;
  }
  if (align === "right") {
    return boxWidth - lineWidth;
  }
  return 0;
}

/**
 * §5.6: draws a `text` object's `resolvedContent` from `origin` (its top-left,
 * the same meaning `rect`/`table` give `origin`), wrapping at the `width` slot
 * when it holds a positive number (§5.6's "fixed width + auto height (wrap, grow
 * down) is the default"; `"auto"` — or any non-number — means no wrap), with
 * §5.6's markdown-lite honoured.
 *
 * Layout goes through `render/measure.ts`'s `layOutText` with THIS ctx's
 * `measureText`, so the drawn lines, their fonts and their widths are exactly
 * the ones `measuredWidth`/`measuredHeight` were measured from (D-010) — while
 * the object's `style.*` slots are usable, which they are for every object
 * `createText` builds. A broken style makes the two files fall back differently
 * and their line counts can then disagree; see `measure.ts`'s header.
 * `resolvedContent` already carries any `!`-marked broken span (D-116 and D-117,
 * engine-side) — this function just draws what it is given, markup and all.
 *
 * Every run is placed at an absolute x, so `ctx.textAlign` is always `left` and
 * §5.6's alignment is arithmetic: a line made of two fonts has no single anchor
 * a canvas alignment could measure from. There is no `overflow` slot to consult
 * and no cropping of any kind: the box grows to hold its text
 * (`render/textbox.ts`). Draws nothing for an unset, non-string, or empty
 * `resolvedContent` (an empty text object takes no ink, matching `measure.ts`'s
 * zero box); a `style.*` slot that is missing or holds a non-usable value falls
 * back per `resolveTextStyle` rather than blanking the text. Never throws.
 */
function drawText(ctx: CanvasRenderingContext2D, object: GraphObject): void {
  const resolved = readText(object, TEXT_RESOLVED_CONTENT_PATH);
  if (resolved === undefined) {
    return;
  }
  const style = resolveTextStyle(object);
  const originX = readNumber(object, ORIGIN_X_PATH) ?? 0;
  const originY = readNumber(object, ORIGIN_Y_PATH) ?? 0;

  const fixedWidth = readNumber(object, TEXT_WIDTH_PATH);
  const wrapWidth = fixedWidth !== undefined && fixedWidth > 0 ? fixedWidth : undefined;
  const layout = layOutText({
    text: resolved,
    style: { font: style.family, fontSize: style.fontSize, lineHeight: style.lineHeight },
    wrapWidth,
    // The canvas is the surface markup is FOR — the measurer that feeds
    // `measuredWidth`/`measuredHeight` reads it the same way, which is what
    // keeps the box around this ink (`createCanvas2dTextMeasurer`).
    markup: true,
    measureRun: (text, font) => {
      ctx.font = font;
      return ctx.measureText(text).width;
    },
  });

  // Alignment needs the box's width, and it must be the SAME width
  // `extent.ts` bounds this object with — otherwise centred text sits off its
  // own selection outline. `textbox.ts` is that one rule (D-010); this call
  // supplies it the same four slot reads `extent.ts` does.
  const { width: boxWidth } = textBoxSize({
    fixedWidth,
    fixedHeight: readNumber(object, TEXT_HEIGHT_PATH),
    autoresize: readBoolean(object, TEXT_AUTORESIZE_PATH) ?? true,
    measuredWidth: readNumber(object, TEXT_MEASURED_WIDTH_PATH),
    measuredHeight: readNumber(object, TEXT_MEASURED_HEIGHT_PATH),
  });

  ctx.fillStyle = style.color;
  ctx.textBaseline = "top";
  ctx.textAlign = "left";
  for (const line of layout.lines) {
    const lineLeft = originX + alignmentOffset(style.align, boxWidth, line.width);
    for (const run of line.runs) {
      ctx.font = run.font;
      ctx.fillText(run.text, lineLeft + run.x, originY + line.top);
    }
  }
}

// ---------------------------------------------------------------------------
// Selection highlight (§5.9, D-068) — world space, drawn last (see caller)
// ---------------------------------------------------------------------------

/**
 * Re-strokes the SAME path/box `drawObject` built for `object`, in
 * `SELECTION_HIGHLIGHT_STYLE` — never a second, independently computed
 * outline (D-010; see `buildCirclePath`/`buildVerticesPath`). A `table` has
 * no single stroked path (a grid of cells), so it is highlighted as its whole
 * drawn extent instead, read the same way `drawTable` positions the grid —
 * including the `?? 0` fallback, so the highlight can never sit somewhere
 * other than where the grid is actually drawn. Draws nothing for a type with
 * no visual definition yet (file header); never throws.
 */
function drawSelectionHighlight(ctx: CanvasRenderingContext2D, object: GraphObject): void {
  switch (object.type) {
    case "circle": {
      if (buildCirclePath(ctx, object)) {
        strokeHighlight(ctx);
      }
      return;
    }
    case "polygon":
    case "rect": {
      if (buildVerticesPath(ctx, object)) {
        strokeHighlight(ctx);
      }
      return;
    }
    case "table": {
      const originX = readNumber(object, ORIGIN_X_PATH) ?? 0;
      const originY = readNumber(object, ORIGIN_Y_PATH) ?? 0;
      const { rows, cols } = getTableDimensions(object);
      const width = cols * TABLE_CELL_WIDTH;
      const height = rows * TABLE_CELL_HEIGHT;
      if (width <= 0 || height <= 0) {
        return; // Same guard drawTable's own grid loop is un-enterable under.
      }
      ctx.strokeStyle = SELECTION_HIGHLIGHT_STYLE;
      ctx.lineWidth = SELECTION_HIGHLIGHT_WIDTH;
      ctx.strokeRect(originX, originY, width, height);
      return;
    }
    case "text":
    case "image": {
      // The SAME box `drawText`/`drawImage` draw into and `hittest.ts` clicks
      // against — `extent.ts`'s `objectExtent` (D-066/D-010), not a second
      // reading.
      const extent = objectExtent(object);
      if (extent === undefined) {
        return; // No resolved content, or no positive box — nothing drawn, nothing to highlight.
      }
      ctx.strokeStyle = SELECTION_HIGHLIGHT_STYLE;
      ctx.lineWidth = SELECTION_HIGHLIGHT_WIDTH;
      ctx.strokeRect(extent.minX, extent.minY, extent.maxX - extent.minX, extent.maxY - extent.minY);
      return;
    }
    case "polyline":
    case "script":
    case "value":
    case "add":
      return; // Nothing drawn for these yet (file header) — nothing to highlight.
    default: {
      const exhaustive: never = object.type;
      void exhaustive;
      return;
    }
  }
}

function strokeHighlight(ctx: CanvasRenderingContext2D): void {
  ctx.strokeStyle = SELECTION_HIGHLIGHT_STYLE;
  ctx.lineWidth = SELECTION_HIGHLIGHT_WIDTH;
  ctx.stroke();
}

// ---------------------------------------------------------------------------
// Screen-space chrome (D-092 clause 1, D-068's badge and indicator)
// ---------------------------------------------------------------------------

/**
 * Where an object's chrome hangs from: the TOP-CENTRE of its drawn extent,
 * in world space.
 *
 * **Why the extent and NOT `origin.x`/`origin.y`.** `origin` does not mean the
 * same thing across types — it is a circle's and a polygon's CENTRE but a
 * rect's and a table's TOP-LEFT CORNER (`primitives/geometry.ts`). Entry 0093
 * anchored to it and the result, seen in a browser for the first time at entry
 * 0094, was a table labelled above its grid like a title and a circle labelled
 * *inside itself*. Each was 6px above its own anchor, so every test passed; the
 * defect was in what the anchor MEANT, which is not a thing an offset
 * assertion can catch.
 *
 * The drawn extent is the one quantity that means the same for every type, and
 * D-066 already rules that the drawn extent and the clickable extent are ONE
 * extent — so this reuses `extent.ts`'s `objectExtent` rather than computing a
 * second reading of the same question (D-010). `undefined` for an object that
 * draws nothing, which is exactly the set that has no extent.
 *
 * A consequence worth stating: chrome now appears precisely when an object has
 * a drawn extent, so a hand-built shape with an `origin` but no `vertices`
 * slot gets neither body nor label (it previously got a label). For any object
 * built through `mutate`, `vertices` is a schema-declared derived slot and is
 * always present, so this is a fixture-only difference.
 */
function chromeAnchorPoint(object: GraphObject): Point | undefined {
  const extent = objectExtent(object);
  if (extent === undefined) {
    return undefined;
  }
  // Y grows DOWNWARD in this coordinate system (`drawTable`'s own row layout),
  // so `minY` is the object's TOP edge.
  return { x: (extent.minX + extent.maxX) / 2, y: extent.minY };
}

/**
 * Whether ANY slot on `object` currently holds an `ErrorValue` — §5.9's
 * "error badge on objects holding ErrorValues," read exactly as written: any
 * slot, not only the ones this file happens to draw from (a table cell's
 * formula can be broken while `origin`/`rows`/`cols` are perfectly fine).
 */
function objectHasError(object: GraphObject): boolean {
  return Object.values(object.slots).some((slot) => isErrorValue(slot.value));
}

/**
 * One object's screen-space chrome, laid out as ONE line above the object's
 * top edge: `[•x •y] name [!]`.
 *
 * All three pieces share a baseline and none is drawn inside the shape —
 * entry 0093 put the ticks BELOW the anchor, which under the old centre-anchor
 * meant inside a circle and under the new top-anchor would mean inside every
 * shape. The horizontal offsets are MEASURED off the name (`ctx.measureText`)
 * rather than assumed, so a long name pushes the badge and the ticks out
 * instead of colliding with them.
 *
 * Draws nothing for an object with no anchor point (see `chromeAnchorPoint`);
 * never throws.
 *
 * `suppressName` (D-094 clause 3) omits ONLY the name label — the badge and the
 * ticks still draw. With no name drawn there is no name width to measure, so
 * `halfName` is 0 and the badge and ticks sit a gap either side of the anchor.
 */
function drawObjectChrome(ctx: CanvasRenderingContext2D, camera: CameraState, object: GraphObject, suppressName: boolean): void {
  const anchor = chromeAnchorPoint(object);
  if (anchor === undefined) {
    return;
  }
  const screen = worldToScreen(camera, anchor);
  // A table's column headers occupy the band immediately above its top edge
  // (2026-09-02), so the name label starts above THEM rather than on top of
  // them. Zero for every other type, which is why this is a function of the
  // object and not a second constant.
  const baseline = screen.y - CHROME_ANCHOR_MARGIN_SCREEN - chromeTopReservedScreen(object);

  ctx.font = CHROME_FONT;
  ctx.textBaseline = "bottom";

  // D-092 clause 1: a name for every object, screen-space and always on
  // (Rule 5 — no hover or toggle mechanism yet), EXCEPT the selected one,
  // whose name is in the properties panel's header instead (D-094 clause 3).
  ctx.fillStyle = CHROME_LABEL_STYLE;
  ctx.textAlign = "center";
  if (!suppressName) {
    ctx.fillText(object.name, screen.x, baseline);
  }

  const halfName = suppressName ? 0 : ctx.measureText(object.name).width / 2;

  // §5.9's error badge. A bare "!" in the error colour, to the RIGHT of the
  // name — Rule 5's dumbest correct reading; a drawn icon is `style`-slots-era.
  if (objectHasError(object)) {
    ctx.fillStyle = CHROME_ERROR_BADGE_STYLE;
    ctx.textAlign = "left";
    ctx.fillText("!", screen.x + halfName + CHROME_GAP_SCREEN, baseline);
  }

  const ticks = formulaDrivenTicks(object);
  if (ticks !== "") {
    // To the LEFT of the name, right-aligned so it grows away from it.
    ctx.fillStyle = CHROME_FORMULA_TICK_STYLE;
    ctx.textAlign = "right";
    ctx.fillText(ticks, screen.x - halfName - CHROME_GAP_SCREEN, baseline);
  }
}

/**
 * A table's A1 row and column headers — `A B C …` centred over each column and
 * `1 2 3 …` beside each row (the human's 2026-09-02 request).
 *
 * **Always drawn, for every table, and never suppressed.** That is the explicit
 * ask (*"they should stay when the prop window comes up, not get hidden like the
 * title does"*) and it is also the right rule: the name label moves INTO the
 * properties panel when one opens, so suppressing it loses nothing, whereas
 * nothing anywhere else tells the operator which column is `C`. They are what
 * makes `set table_1.C4` a thing you can aim at rather than count out.
 *
 * The letters come from `address.ts`'s own `indexToColumnLetters` — the exact
 * function `formatCellReference` uses to build the reference a click on that
 * cell resolves to (D-010). A header that said `C` over a column whose cells
 * were `cells.D*` would be worse than no header at all, and only sharing the
 * function makes that impossible.
 *
 * Screen space, at identity, like the rest of the chrome pass: positions come
 * from `worldToScreen` per label, so the text stays one legible size while the
 * grid under it scales. Skipped per axis when the cells have shrunk below
 * `TABLE_HEADER_MIN_CELL_SCREEN` — see that constant. Never throws; draws
 * nothing for a table with no extent.
 */
function drawTableHeaders(ctx: CanvasRenderingContext2D, camera: CameraState, object: GraphObject): void {
  if (object.type !== TABLE_TYPE) {
    return;
  }
  const originX = readNumber(object, ORIGIN_X_PATH) ?? 0;
  const originY = readNumber(object, ORIGIN_Y_PATH) ?? 0;
  const { rows, cols } = getTableDimensions(object);
  const topLeft = worldToScreen(camera, { x: originX, y: originY });
  // The screen size of ONE cell, measured as the distance between two world
  // points rather than by multiplying by `camera.zoom` — the same "never a
  // second copy of the mapping" rule the camera transform itself follows
  // (D-010), and it stays correct if the camera ever gains a non-uniform scale.
  const cellCorner = worldToScreen(camera, { x: originX + TABLE_CELL_WIDTH, y: originY + TABLE_CELL_HEIGHT });
  const cellWidthScreen = cellCorner.x - topLeft.x;
  const cellHeightScreen = cellCorner.y - topLeft.y;

  ctx.font = CHROME_FONT;
  ctx.fillStyle = TABLE_HEADER_LABEL_STYLE;

  if (cellWidthScreen >= TABLE_HEADER_MIN_CELL_SCREEN) {
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    for (let column = 1; column <= cols; column += 1) {
      const centreX = topLeft.x + (column - 0.5) * cellWidthScreen;
      ctx.fillText(indexToColumnLetters(column), centreX, topLeft.y - TABLE_HEADER_MARGIN_SCREEN);
    }
  }

  if (cellHeightScreen >= TABLE_HEADER_MIN_CELL_SCREEN) {
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (let row = 1; row <= rows; row += 1) {
      const centreY = topLeft.y + (row - 0.5) * cellHeightScreen;
      ctx.fillText(String(row), topLeft.x - TABLE_HEADER_MARGIN_SCREEN, centreY);
    }
  }
}

/**
 * §5.9's "a subtle indicator on slots that are formula-driven rather than
 * literal", as the text to draw — `""` when neither axis is driven.
 *
 * Read NARROWLY, for now, as the two component slots a drag can actually move
 * (`render/interaction.ts`'s per-component rule): `origin.x` and `origin.y`
 * (file header's NOT DONE HERE). Neither is ever `derived` (no schema declares
 * them so), so `"formula"` is the one kind that needs marking — a drag skips
 * exactly that kind, and the operator has had no other way to learn which axis
 * is the one that will not move.
 */
function formulaDrivenTicks(object: GraphObject): string {
  const xDriven = getSlot(object, ORIGIN_X_PATH)?.kind === "formula";
  const yDriven = getSlot(object, ORIGIN_Y_PATH)?.kind === "formula";
  if (xDriven && yDriven) {
    return "•x •y";
  }
  if (xDriven) {
    return "•x";
  }
  return yDriven ? "•y" : "";
}
