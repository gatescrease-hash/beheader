/**
 * image.ts
 *
 * This file declares the slot path constants for the image type, and holds no
 * logic.
 *
 * The image primitive is data plus one renderer arm. It stores the picture as
 * a data URL in the document.
 *
 * The file belongs to the engine layer and works on plain data alone. It does
 * not use the DOM, a window or a canvas. That keeps it testable without a
 * browser, and ready for a port to Rust.
 */
export const IMAGE_WIDTH_PATH: readonly string[] = ["width"];
export const IMAGE_HEIGHT_PATH: readonly string[] = ["height"];

export const IMAGE_OPACITY_PATH: readonly string[] = ["opacity"];

export const IMAGE_PRESERVE_ASPECT_PATH: readonly string[] = ["preserveAspect"];

export const IMAGE_PICTURE_ASPECT_PATH: readonly string[] = ["pictureAspect"];

export const IMAGE_SOURCE_PATH: readonly string[] = ["source"];
