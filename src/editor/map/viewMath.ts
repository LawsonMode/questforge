// Room canvas view transform (pure). The canvas backing store is in device
// pixels. From 100% up, art pixels are drawn at an integer device scale so pixel
// art stays crisp on fractional devicePixelRatio screens; the 25% / 50% levels
// (for surveying big rooms) use fractional scales, which the canvas draws
// smoothed. `pan` is where the room's top-left corner lands, in device pixels.

/** Zoom levels (CSS pixels per art pixel), smallest first. */
export const ZOOM_LEVELS: readonly number[] = [0.25, 0.5, 1, 2, 3, 4, 5, 6];
const MIN_ZOOM = ZOOM_LEVELS[0]!;

export interface View {
  /** Zoom level, one of ZOOM_LEVELS. */
  zoom: number;
  panX: number;
  panY: number;
}

/** Device pixels per art pixel for a zoom level (an integer from 100% up). */
export function deviceScale(zoom: number, dpr: number): number {
  return zoom >= 1 ? Math.max(1, Math.round(zoom * dpr)) : zoom * dpr;
}

/** The supported zoom level nearest to `zoom`. */
export function clampZoom(zoom: number): number {
  let best = MIN_ZOOM;
  for (const z of ZOOM_LEVELS) if (Math.abs(z - zoom) < Math.abs(best - zoom)) best = z;
  return best;
}

/** The zoom level `steps` levels above (positive) or below `zoom`, clamped to the range. */
export function stepZoom(zoom: number, steps: number): number {
  const i = ZOOM_LEVELS.indexOf(clampZoom(zoom));
  return ZOOM_LEVELS[Math.max(0, Math.min(ZOOM_LEVELS.length - 1, i + steps))]!;
}

/** Change zoom keeping the art pixel under device point (dx, dy) fixed. */
export function zoomAround(v: View, zoom: number, dpr: number, dx: number, dy: number): View {
  const next = clampZoom(zoom);
  const s0 = deviceScale(v.zoom, dpr);
  const s1 = deviceScale(next, dpr);
  const ax = (dx - v.panX) / s0;
  const ay = (dy - v.panY) / s0;
  return { zoom: next, panX: Math.round(dx - ax * s1), panY: Math.round(dy - ay * s1) };
}

/** Largest zoom that shows the whole w x h (art px) area plus `margin` device px, centred. */
export function fitView(w: number, h: number, canvasW: number, canvasH: number, dpr: number, margin: number): View {
  let zoom = MIN_ZOOM;
  for (let i = ZOOM_LEVELS.length - 1; i > 0; i--) {
    const s = deviceScale(ZOOM_LEVELS[i]!, dpr);
    if (w * s + margin * 2 <= canvasW && h * s + margin * 2 <= canvasH) {
      zoom = ZOOM_LEVELS[i]!;
      break;
    }
  }
  const s = deviceScale(zoom, dpr);
  return { zoom, panX: Math.round((canvasW - w * s) / 2), panY: Math.round((canvasH - h * s) / 2) };
}

/** Device point -> art pixel coordinates (fractional). */
export function toArt(v: View, dpr: number, dx: number, dy: number): { x: number; y: number } {
  const s = deviceScale(v.zoom, dpr);
  return { x: (dx - v.panX) / s, y: (dy - v.panY) / s };
}
