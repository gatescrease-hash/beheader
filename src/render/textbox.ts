/**
 * textbox.ts — How big a `text` object's box is: the ONE rule, for every reader.
 *
 * IMPLEMENTS: §5.6's layout paragraph, as the human re-specified it on
 * 2026-09-02 ("make it work like a text box in Word or PowerPoint"): the box
 * NEVER crops its text, it grows to fit whatever is typed, and an `autoresize`
 * slot decides what happens in the other direction — whether a box shrinks back
 * when the text gets smaller, or stays the size the operator dragged it to.
 * LAYER: render (pure). No canvas, DOM, or window — arithmetic over four
 * numbers and a flag. May import: nothing. NEVER imported by engine/*.
 *
 * WHAT THIS IS
 *   `textBoxSize(inputs)` — the drawn width and height of a `text` object,
 *   from its `width`/`height` slots (the size the operator SET, by dragging a
 *   handle or by `set text_1.width 200`), its measurement (how big the text
 *   actually is), and `autoresize`.
 *
 *   Three readers, and the reason this file exists is that all three must agree
 *   to the pixel or the operator sees the box disagree with its own text:
 *     - `extent.ts` — the committed box (hit test, selection outline, `fit`).
 *     - `renderer.ts` — the box alignment is measured against.
 *     - `editor.ts`/`main.ts` — the LIVE box while the operator is typing,
 *       measured from the typed string instead of `resolvedContent`, which is
 *       what makes the overlay grow under the caret instead of scrolling.
 *
 *   THE RULE, both axes:
 *     - No set size  -> the measurement. The box hugs its text (a click-placed
 *       box in PowerPoint, which widens as you type).
 *     - Set size, text BIGGER  -> the measurement. Text is never cropped and a
 *       scrollbar can never be needed; this is the half the human called
 *       "infuriating" when it cropped instead.
 *     - Set size, text SMALLER -> `autoresize` decides: `true` shrinks to the
 *       text ("resize shape to fit text"), `false` keeps the set size.
 *
 *   WIDTH IS THE ONE ASYMMETRY, and it is deliberate: a numeric `width` is also
 *   the WRAP width (`measure.ts`'s `maxWidth`), so shrinking the box to the
 *   longest line would leave the operator's dragged edge invisible while still
 *   wrapping there. A set width therefore never shrinks — only the height
 *   answers to `autoresize`, exactly as "resize shape to fit text" does in Word.
 *
 * INVARIANTS UPHELD HERE
 *   - Never throws, and always returns two finite positive numbers.
 *   - A non-finite or non-positive input is treated as ABSENT, never propagated
 *     — the same "a bad number does not move furniture" posture `camera.ts` and
 *     `panel.ts` take.
 *   - No slot is read here. Callers narrow their own values (`slots.ts`), so
 *     this file can be driven equally by stored slots and by a live measurement
 *     of text that has not been committed yet.
 *
 * NOT DONE HERE
 *   - MEASURING. The measurement arrives as two numbers, from the
 *     `measuredWidth`/`measuredHeight` derived slots (`extent.ts`) or from a
 *     direct `TextMeasurer.measure` call on the typed string (`main.ts`).
 *   - WHERE the box sits — that is `origin.x`/`origin.y`, and its readers'.
 */

/** The fallback box, reached ONLY when nothing is knowable: no set size and no usable measurement, i.e. no real `TextMeasurer` was wired (`#MEASURE`, D-118 — a test, or `main.ts` failing to get an offscreen 2D context). World units, round and untuned (Rule 5). */
export const TEXT_FALLBACK_BOX_WIDTH = 240;
export const TEXT_FALLBACK_BOX_HEIGHT = 20;

/**
 * What decides a text box's size. Every field is "as read", not "as
 * validated" — a caller hands over whatever the slot or the measurer gave it
 * and this file screens each one, so no caller has to remember the screen.
 */
export interface TextBoxInputs {
  /** The `width` slot when it holds a number; `undefined` for `"auto"`. Doubles as the wrap width. */
  readonly fixedWidth: number | undefined;
  /** The `height` slot when it holds a number; `undefined` for `"auto"`. */
  readonly fixedHeight: number | undefined;
  /** The `autoresize` slot. `true` — the default — lets a set height shrink back to the text. */
  readonly autoresize: boolean;
  /** How wide the text actually laid out (the widest line). */
  readonly measuredWidth: number | undefined;
  /** How tall the text actually laid out (line count × line height). */
  readonly measuredHeight: number | undefined;
}

/** A text box's drawn size, in world units. Both always finite and positive. */
export interface TextBoxSize {
  readonly width: number;
  readonly height: number;
}

/** A finite, positive number or `undefined` — the one screen every input here passes through. */
function usable(value: number | undefined): number | undefined {
  return value !== undefined && Number.isFinite(value) && value > 0 ? value : undefined;
}

/**
 * The drawn size of a `text` object's box — see the file header for the rule
 * and for why width and height are deliberately asymmetric.
 */
export function textBoxSize(inputs: TextBoxInputs): TextBoxSize {
  const fixedWidth = usable(inputs.fixedWidth);
  const fixedHeight = usable(inputs.fixedHeight);
  const measuredWidth = usable(inputs.measuredWidth);
  const measuredHeight = usable(inputs.measuredHeight);

  // Width: a set width is also the wrap width, so it is a FLOOR, never a
  // ceiling. It grows only for text that could not be wrapped into it — a
  // single word longer than the box (`measure.ts` breaks between words only).
  const width =
    fixedWidth !== undefined
      ? Math.max(fixedWidth, measuredWidth ?? 0)
      : (measuredWidth ?? TEXT_FALLBACK_BOX_WIDTH);

  // Height: grows past a set height so text is never cropped; shrinks back
  // below it only when `autoresize` is on.
  const height =
    fixedHeight !== undefined
      ? measuredHeight === undefined
        ? fixedHeight
        : inputs.autoresize
          ? measuredHeight
          : Math.max(fixedHeight, measuredHeight)
      : (measuredHeight ?? TEXT_FALLBACK_BOX_HEIGHT);

  return { width, height };
}
