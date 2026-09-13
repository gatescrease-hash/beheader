/**
 * image.ts
 *
 * Slot path constants for the image type are all this file holds. No logic
 * joins them.
 *
 * The image primitive is data plus one renderer arm. It stores the picture as
 * a data URL in the document.
 *
 * Engine-layer code: pure logic with no DOM, window or canvas access, so the
 * tests run headless and the file can move to Rust later.
 */
export const IMAGE_WIDTH_PATH: readonly string[] = ["width"];
export const IMAGE_HEIGHT_PATH: readonly string[] = ["height"];

export const IMAGE_OPACITY_PATH: readonly string[] = ["opacity"];

export const IMAGE_PRESERVE_ASPECT_PATH: readonly string[] = ["preserveAspect"];

export const IMAGE_PICTURE_ASPECT_PATH: readonly string[] = ["pictureAspect"];

export const IMAGE_SOURCE_PATH: readonly string[] = ["source"];
