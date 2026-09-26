// A crisp canvas showing one sprite frame (item icons, HUD hearts, ...).
import type { AssetCache } from '../gfx/imageCache';
import { pixelCanvas } from '../editor/ui/dom';

/** First frame of `anim` of `sprite`, drawn at an integer CSS scale; empty canvas if unknown. */
export function spriteIcon(assets: AssetCache, sprite: string, anim: string, scale = 1, palette?: string): HTMLCanvasElement {
  const def = assets.spriteDef(sprite);
  const c = pixelCanvas(def?.w ?? 16, def?.h ?? 16, scale);
  const g = c.getContext('2d');
  const frame = assets.animFrame(sprite, anim, 0);
  if (g && frame >= 0) {
    assets.drawSpriteTo(g, sprite, frame, 0, 0, 1, { palette, flipX: assets.anim(sprite, anim)?.flipX });
  }
  c.setAttribute('aria-hidden', 'true');
  return c;
}
