/**
 * textbox.ts
 *
 * The single rule for how big a text box is.
 *
 * Four places read this rule: the derived `box` slot through box.ts, the
 * renderer that draws the box, the measurer that sizes the text inside it, and
 * main.ts when it places the editor over it. A fifth answer to the same
 * question does not belong anywhere, because a text box that draws at one size
 * and measures at another puts the caret in the wrong place, and a box a
 * formula reads at another size again would aim a connector at nothing.
 *
 * A text object can carry a fixed width or take its width from the text. This
 * file decides which one wins when both are present.
 *
 * Engine-layer code: pure logic with no DOM, window or canvas access, so the
 * tests run headless and the file can move to Rust later.
 */
export const TEXT_FALLBACK_BOX_WIDTH = 240;
export const TEXT_FALLBACK_BOX_HEIGHT = 20;

export interface TextBoxInputs {
  readonly fixedWidth: number | undefined;
  readonly fixedHeight: number | undefined;
  readonly autoresize: boolean;
  readonly measuredWidth: number | undefined;
  readonly measuredHeight: number | undefined;
}

export interface TextBoxSize {
  readonly width: number;
  readonly height: number;
}

function usable(value: number | undefined): number | undefined {
  return value !== undefined && Number.isFinite(value) && value > 0 ? value : undefined;
}

export function textBoxSize(inputs: TextBoxInputs): TextBoxSize {
  const fixedWidth = usable(inputs.fixedWidth);
  const fixedHeight = usable(inputs.fixedHeight);
  const measuredWidth = usable(inputs.measuredWidth);
  const measuredHeight = usable(inputs.measuredHeight);

  const width =
    fixedWidth !== undefined
      ? Math.max(fixedWidth, measuredWidth ?? 0)
      : (measuredWidth ?? TEXT_FALLBACK_BOX_WIDTH);

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
