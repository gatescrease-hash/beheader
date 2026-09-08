/**
 * image.ts — The `image` primitive's slot paths (PROJECT_BRIEF §5.7).
 *
 * IMPLEMENTS: PROJECT_BRIEF §5.7 ("Load via file picker, store as a data URL in the
 * document ... draw at a position with width/height, preserve aspect ratio by
 * default. Slots: origin.x, origin.y, width, height, opacity.").
 * LAYER: engine (pure). May import: engine/* only.
 *        NEVER imports: DOM, window, document, canvas, render/*.
 *
 * WHAT THIS IS
 *   The path constants an `image` object's slots live at, and nothing else. §5.7 is
 *   the smallest primitive in the brief: every slot is an ordinary `literal`-by-
 *   default value with no computation over it, so unlike `geometry.ts` and `text.ts`
 *   this file declares no compute function and `IMAGE_SCHEMA` has no `derivedSlots`.
 *
 *   EIGHT slots, of which §5.7 names five: `origin.x`/`origin.y`, `width`/`height`,
 *   `opacity`, plus `source` (D-140), `preserveAspect` (the human's Q-027 ruling at
 *   entry 0173) and `pictureAspect` (**D-144**). Each of the three additions has its
 *   own doc comment below saying why §5.7's five-name list could not hold it.
 *
 *   `origin.x`/`origin.y` are NOT declared here. They are `geometry.ts`'s
 *   `ORIGIN_X_PATH`/`ORIGIN_Y_PATH`, the identical spelling every positioned object
 *   already uses (D-121's reasoning for `text`, applied unchanged): `render/
 *   interaction.ts`'s per-component origin drag and a `link image_1.origin.x <cell>`
 *   then work with no image-specific code anywhere.
 *
 *   `source` is a SIXTH slot §5.7's own list does not name — see its doc comment for
 *   why the data URL has nowhere else it could live, and entry 0165 for the
 *   disclosure.
 *
 * INVARIANTS UPHELD HERE
 *   - Paths only. Nothing here reads an object, resolves an address, or computes a
 *     value, so there is nothing that could throw.
 *   - No slot here sizes a slot family, so D-046/D-097 do not reach this type: an
 *     `image` object's slot set is fixed at eight for every image, forever (Rule 6),
 *     and `IMAGE_SCHEMA`'s one `static` group is the correct declaration rather than
 *     merely the convenient one.
 *
 * NOT DONE HERE
 *   - Wiring these paths into the registry — `primitives/schema.ts`'s `IMAGE_SCHEMA`.
 *   - Creation defaults for `width`/`height`/`opacity`/`source`/`preserveAspect`. A
 *     creation command carries its own values (`command/commands.ts`'s
 *     `DEFAULT_IMAGE_*`), the same split `text`'s `DEFAULT_TEXT_*` already uses.
 *   - DRAWING an image, decoding a data URL, or reading a file. All three are
 *     `render/`'s and `main.ts`'s, on the far side of Rule 1.
 *   - ENFORCING `preserveAspect`. This file declares the path; what the flag MEANS
 *     is two render-layer behaviours (`renderer.ts` fits or stretches the picture,
 *     `interaction.ts` constrains or frees a grabber drag), because both need the
 *     decoded bitmap's NATURAL size or a screen gesture, neither of which is engine
 *     state. Nothing here reads the flag.
 */

/**
 * §5.7's `width`/`height` — the world-space box the image is drawn into, in the same
 * units `rect`'s `width`/`height` use.
 *
 * Declared here rather than imported from `geometry.ts`'s `RECT_WIDTH_PATH`/
 * `RECT_HEIGHT_PATH` for the reason `primitives/text.ts` declares its own pair: the
 * PATH STRING is deliberately the same word across types (one spelling of "width" on
 * the whole address surface), but a constant named for `rect` has no business being
 * read as an image's, and each type's domain differs (`text`'s admits `"auto"`).
 */
export const IMAGE_WIDTH_PATH: readonly string[] = ["width"];
export const IMAGE_HEIGHT_PATH: readonly string[] = ["height"];

/**
 * §5.7's `opacity`. Deliberately UNBOUNDED as document state: it sizes no slot
 * family, so D-070's "a count is bounded before an `Operation` exists" reasoning does
 * not reach it, and D-097's write-time gate has nothing to protect. A value outside
 * 0..1 is legitimate state that the renderer clamps when it paints — the same posture
 * `style.align` already takes (`render/renderer.ts`'s `resolveTextStyle`).
 */
export const IMAGE_OPACITY_PATH: readonly string[] = ["opacity"];

/**
 * §5.7's "preserve aspect ratio by default", as a slot the operator can turn
 * OFF — the human's ruling on **Q-027**, given on screen at entry 0173: *"There
 * should be a property toggle for 'preserve aspect ratio'. When toggled,
 * resizing preserves ratio. When untoggled, resizing distorts aspect ratio."*
 *
 * It is document state rather than a render-layer constant because it is the
 * operator's choice about one object, exactly as `text`'s `autoresize` is, and
 * it is read by two different layers for two different gestures: `render/
 * renderer.ts` decides whether a picture is FITTED inside its box or STRETCHED
 * to fill it, and `render/interaction.ts` decides whether a grabber drag keeps
 * the box's proportions.
 *
 * A MISSING slot reads as `true` at every site (`readBoolean(...) ?? true`),
 * which is what "by default" means in §5.7's own sentence and what lets a
 * document saved before this slot existed load and behave as it did —
 * **D-126**'s lesson, applied to a non-derived slot.
 */
export const IMAGE_PRESERVE_ASPECT_PATH: readonly string[] = ["preserveAspect"];

/**
 * The chosen picture's OWN proportions — its decoded `naturalWidth` divided by its
 * `naturalHeight` — remembered so a box the operator has since distorted can be put
 * back to them (**D-144**).
 *
 * **Why this is stored rather than re-derived.** The ratio is a property of the
 * picture, and the picture is decoded pixels living in `render/images.ts`'s cache —
 * outside the document, rebuilt from `source` on every load, and not there at all
 * until a decode lands. Toggling `preserveAspect` back on just after a document
 * loads would therefore restore nothing, silently, which is the failure D-127
 * clause 5 refuses. A number in a slot is available the instant the document is,
 * needs no decode, and survives save/load like every other slot.
 *
 * `0` — and a missing slot, and any non-finite or non-positive value — all mean "no
 * picture whose shape is known", and every reader applies the same
 * `> 0 && Number.isFinite` screen `pictureBoxSize` already uses. That is what a
 * freshly created `image` carries, and what a hand-typed `set image_1.source
 * "data:…"` leaves behind: `main.ts`'s pick gesture is the only writer, so a source
 * set by hand records no ratio and offers no restore — D-144's accepted cost.
 *
 * Not a DERIVED slot, and it could not be one: a compute function is engine code
 * (Rule 1) and no engine code may decode a picture. It is an ordinary `literal` a
 * gesture writes, exactly as `width`/`height` are after a pick.
 */
export const IMAGE_PICTURE_ASPECT_PATH: readonly string[] = ["pictureAspect"];

/**
 * The image's own content: §5.7's "store as a data URL in the document".
 *
 * NOT in §5.7's five-name slot list, and that omission cannot be honoured — the data
 * URL has to be somewhere, and a `literal` `string` slot is the only home this data
 * model offers. A `GraphObject` is `{ id, name, type, slots }` (`graph/node.ts`), so
 * "in the document" means "in a slot"; §5.1's `Value` union admits `string`; and
 * §5.6's `text` primitive already stores its own raw content in exactly this shape
 * (`TEXT_CONTENT_PATH`). Disclosed as a deviation at entry 0165.
 *
 * Unlike `text`'s `content`, this slot is NOT narrowed to `literal` (D-122): nothing
 * parses a data URL for embedded references, so a formula-driven `source` reading a
 * URL out of a cell tracks its dependencies through the ordinary edge set and needs
 * no guard. The empty string is the ordinary "no picture yet" state a freshly created
 * `image` object carries.
 */
export const IMAGE_SOURCE_PATH: readonly string[] = ["source"];
