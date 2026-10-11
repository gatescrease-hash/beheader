/**
 * World-aligned grid spacing grows by decades as the camera zooms out.
 * Two scales fade together so crossing a spacing threshold stays continuous.
 * The drawing adapter returns CSS geometry and never changes document state.
 */
import type { CameraState } from "../engine/index.ts";
import { worldToScreen } from "./camera.ts";

/**
 * The world distance between two lines of the grid the canvas shows: the
 * power of ten that spans about 80 CSS pixels or less at this zoom. The
 * camera maps world units to device pixels, so the device pixel ratio turns
 * that into CSS pixels first.
 */
export function gridWorldStep(camera: CameraState, ratio = 1): number {
  return 10 ** Math.floor(Math.log10(80 / (camera.zoom / ratio)));
}

export function gridGeometry(camera: CameraState, ratio = 1) {
  const scale = camera.zoom / ratio;
  const step = gridWorldStep(camera, ratio);
  const spacing = step * scale;
  const opacity = Math.max(0, Math.min(1, (spacing - 8) / 36));
  const origin = worldToScreen(camera, { x: 0, y: 0 });
  return { spacing, opacity, x: origin.x / ratio, y: origin.y / ratio };
}
