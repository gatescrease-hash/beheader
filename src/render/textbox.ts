/**
 * textbox.ts
 *
 * One rule decides how big a text box is, and this file holds it.
 *
 * Three files read this rule. A fourth answer to the same question does not
 * belong here. A fixed width and a measured width can disagree, and this file
 * decides which one wins.
 *
 * The file belongs to the render layer. It reads engine state and calls
 * mutations, and it crosses that line for nothing else. The engine holds no
 * import of this file, which keeps the drawing code replaceable.
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
