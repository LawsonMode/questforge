// Text in the game's own bitmap font for the app chrome (logo, banner).
import { GLYPH_H, drawText, measureText } from '../gfx/font';

/** Colours of pixel-font text. */
export interface PixelTextStyle {
  color: string;
  /** 1px outline around every glyph. */
  outline?: string;
  /** Drop shadow offset (1, 1) behind the outline. */
  shadow?: string;
}

/** Size in px of `text` drawn with a style (outline/shadow add a border). */
export function pixelTextSize(text: string, style: PixelTextStyle): { w: number; h: number } {
  const pad = (style.outline ? 2 : 0) + (style.shadow ? 1 : 0);
  return { w: measureText(text) + pad, h: GLYPH_H + pad };
}

/** Draw styled text with its box's top-left at (x, y), in native pixels. */
export function drawPixelText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, style: PixelTextStyle): void {
  const o = style.outline ? 1 : 0;
  if (style.shadow) {
    const s = style.outline ? 1 : 0;
    for (let dy = -s; dy <= s; dy++) {
      for (let dx = -s; dx <= s; dx++) drawText(ctx, text, x + o + dx + 1, y + o + dy + 1, style.shadow);
    }
  }
  if (style.outline) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) if (dx || dy) drawText(ctx, text, x + o + dx, y + o + dy, style.outline);
    }
  }
  drawText(ctx, text, x + o, y + o, style.color);
}

/** A crisp canvas showing styled text, CSS-scaled by an integer factor. */
export function pixelTextCanvas(text: string, style: PixelTextStyle, scale = 2): HTMLCanvasElement {
  const { w, h } = pixelTextSize(text, style);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  c.className = 'qf-canvas';
  c.style.width = `${w * scale}px`;
  c.style.height = `${h * scale}px`;
  const ctx = c.getContext('2d');
  if (ctx) drawPixelText(ctx, text, 0, 0, style);
  c.setAttribute('role', 'img');
  c.setAttribute('aria-label', text);
  return c;
}
