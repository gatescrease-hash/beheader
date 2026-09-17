//! Slot path constants for the image type, and nothing else. There is no logic
//! in this file.
//!
//! An image is data plus one arm in the renderer. The picture itself is stored
//! as a data URL inside the document, so a saved file carries its images with
//! it.
//!
//! The port of `src/engine/primitives/image.ts`.

fn path(segments: &[&str]) -> Vec<String> {
    segments.iter().map(|part| (*part).to_string()).collect()
}

pub fn image_width_path() -> Vec<String> {
    path(&["width"])
}

pub fn image_height_path() -> Vec<String> {
    path(&["height"])
}

pub fn image_opacity_path() -> Vec<String> {
    path(&["opacity"])
}

pub fn image_preserve_aspect_path() -> Vec<String> {
    path(&["preserveAspect"])
}

pub fn image_picture_aspect_path() -> Vec<String> {
    path(&["pictureAspect"])
}

pub fn image_source_path() -> Vec<String> {
    path(&["source"])
}
