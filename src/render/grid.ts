/**
 * World-aligned grid spacing grows by decades as the camera zooms out.
 * Two scales fade together so crossing a spacing threshold stays continuous.
 * The drawing adapter returns CSS geometry and never changes document state.
 */
import type { CameraState } from "../engine/index.ts";
import { worldToScreen } from "./camera.ts";

export function gridGeometry(camera: CameraState, ratio = 1) {
  const scale = camera.zoom / ratio;
  const power = Math.floor(Math.log10(80 / scale));
  const step = 10 ** power;
  const spacing = step * scale;
  const opacity = Math.max(0, Math.min(1, (spacing - 8) / 36));
  const origin = worldToScreen(camera, { x: 0, y: 0 });
  return { spacing, opacity, x: origin.x / ratio, y: origin.y / ratio };
}
