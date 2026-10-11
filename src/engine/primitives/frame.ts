/**
 * frame.ts
 *
 * The slot paths and defaults of a frame, which marks a region of the canvas
 * and gives it a name. There is no logic in this file.
 *
 * A frame owns nothing. What lies inside it is worked out from the boxes on the
 * canvas when a move needs it, and never stored, so the frame's slots describe
 * the region alone: where it sits, how large it is, and how it looks.
 *
 * Engine-layer code: pure logic with no DOM, window or canvas access, so the
 * tests run headless and the file can move to Rust later.
 */
export const FRAME_WIDTH_PATH: readonly string[] = ["width"];
export const FRAME_HEIGHT_PATH: readonly string[] = ["height"];

export const DEFAULT_FRAME_WIDTH = 800;
export const DEFAULT_FRAME_HEIGHT = 600;

/** The sheet colour of a new frame, a shade lighter than the canvas behind it. */
export const DEFAULT_FRAME_FILL = "#fffdf7";

/** The border colour of a new frame, the colour of the lines in the shell. */
export const DEFAULT_FRAME_STROKE = "#d3cab5";
