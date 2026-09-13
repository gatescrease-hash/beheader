/**
 * image.ts
 *
 * Slot path constants for the image type, and nothing else. There is no logic
 * in this file.
 *
 * An image is data plus one arm in the renderer. The picture itself is stored
 * as a data URL inside the document, so a saved file carries its images with
 * it.
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
