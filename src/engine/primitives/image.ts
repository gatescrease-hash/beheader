/**
 * image.ts
 *
 * Layer: engine. Pure logic. It imports from engine only. It must never
 * touch the DOM, a window, a document, a canvas or the render layer.
 *
 * Slot path constants for the image type. No logic.
 *
 * The image primitive is data plus one renderer arm. It stores the picture as
 * a data URL in the document.
 */
export const IMAGE_WIDTH_PATH: readonly string[] = ["width"];
export const IMAGE_HEIGHT_PATH: readonly string[] = ["height"];

export const IMAGE_OPACITY_PATH: readonly string[] = ["opacity"];

export const IMAGE_PRESERVE_ASPECT_PATH: readonly string[] = ["preserveAspect"];

export const IMAGE_PICTURE_ASPECT_PATH: readonly string[] = ["pictureAspect"];

export const IMAGE_SOURCE_PATH: readonly string[] = ["source"];
