// The visible canvas behind CanvasRenderer.present(). OWNER: gfx agent.
//
// Keeps the canvas backing store at its CSS box size in device pixels and blits
// the 256x224 backbuffer integer-scaled, centred and letterboxed. Size tracking
// uses a ResizeObserver (the exact device-pixel-content-box where supported), so
// present() does not force a layout each frame; without ResizeObserver the CSS
// box is polled every present().
import { backingSize, deviceSize, presentLayout, type PresentLayout } from './layout';

/** The display canvas of a CanvasRenderer: backing-store sizing plus the integer-scaled present blit. */
export class DisplaySurface {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly layout: PresentLayout = { scale: 1, x: 0, y: 0, w: 0, h: 0 };
  private observer: ResizeObserver | null = null;
  private measured = false;
  /** Last measured CSS content box (px). */
  private cssW = 0;
  private cssH = 0;
  /** Exact device-pixel box reported by the observer; 0 = derive from CSS x devicePixelRatio. */
  private devW = 0;
  private devH = 0;
  private warned = false;

  /**
   * `canvas` must be sized by CSS (e.g. width/height 100% of a sized host) and
   * have no padding or border. A canvas without an author CSS size would take
   * its CSS box from the backing store and grow on every refit; that case is
   * detected and the canvas is pinned to its current CSS size (with a warning).
   */
  constructor(canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D is not available in this browser');
    this.canvas = canvas;
    this.ctx = ctx;
  }

  /** Re-read the CSS box now (e.g. on window resize or after a style change) and refit the backing store. */
  refit(): void {
    this.measureNow();
    this.apply();
  }

  /** Blit `source` integer-scaled and centred, filling the letterbox bars black. */
  present(source: HTMLCanvasElement): void {
    this.observe();
    if (!this.observer || !this.measured) this.measureNow();
    this.apply();
    const W = this.canvas.width;
    const H = this.canvas.height;
    if (W <= 0 || H <= 0) return;
    const L = presentLayout(W, H, this.layout);
    const ctx = this.ctx;
    ctx.imageSmoothingEnabled = false; // resizing the canvas resets context state
    ctx.fillStyle = '#000';
    if (L.x > 0) {
      ctx.fillRect(0, 0, L.x, H);
      ctx.fillRect(L.x + L.w, 0, W - L.x - L.w, H);
    }
    if (L.y > 0) {
      ctx.fillRect(0, 0, W, L.y);
      ctx.fillRect(0, L.y + L.h, W, H - L.y - L.h);
    }
    ctx.drawImage(source, L.x, L.y, L.w, L.h);
  }

  /** Stop observing the canvas (also happens automatically once it leaves the document). */
  dispose(): void {
    this.observer?.disconnect();
    this.observer = null;
    this.measured = false;
  }

  private observe(): void {
    if (this.observer || typeof ResizeObserver === 'undefined' || !this.canvas.isConnected) return;
    const ro = new ResizeObserver((entries) => this.onResize(entries));
    try {
      ro.observe(this.canvas, { box: 'device-pixel-content-box' });
    } catch {
      ro.observe(this.canvas); // browsers without device-pixel-content-box
    }
    this.observer = ro;
  }

  private onResize(entries: ResizeObserverEntry[]): void {
    const e = entries[entries.length - 1];
    if (!e) return;
    if (!this.canvas.isConnected) {
      this.dispose();
      return;
    }
    const box = e.contentBoxSize?.[0];
    this.cssW = box ? box.inlineSize : e.contentRect.width;
    this.cssH = box ? box.blockSize : e.contentRect.height;
    const dev = e.devicePixelContentBoxSize?.[0];
    this.devW = dev ? dev.inlineSize : 0;
    this.devH = dev ? dev.blockSize : 0;
    this.measured = true;
  }

  /** Synchronous measurement (forces layout); keeps the exact device size if the CSS box is unchanged. */
  private measureNow(): void {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (Math.abs(w - this.cssW) >= 1 || Math.abs(h - this.cssH) >= 1) {
      this.devW = 0;
      this.devH = 0;
    }
    this.cssW = w;
    this.cssH = h;
    this.measured = true;
  }

  private apply(): void {
    const dpr = window.devicePixelRatio;
    const W = deviceSize(this.devW, this.cssW, dpr);
    const H = deviceSize(this.devH, this.cssH, dpr);
    if (W <= 0 || H <= 0) return; // hidden or detached: keep the current size
    if (W !== this.canvas.width || H !== this.canvas.height) this.resizeBacking(W, H, dpr);
  }

  /** Set the backing size; if the CSS box followed it (no author CSS size), pin that box so it cannot feed back. */
  private resizeBacking(W: number, H: number, dpr: number): void {
    const c = this.canvas;
    const beforeW = c.clientWidth;
    const beforeH = c.clientHeight;
    c.width = W;
    c.height = H;
    const followedW = Math.abs(c.clientWidth - beforeW) >= 1;
    const followedH = Math.abs(c.clientHeight - beforeH) >= 1;
    if (!followedW && !followedH) return;
    if (followedW) {
      c.style.width = `${beforeW}px`;
      this.cssW = beforeW;
      this.devW = 0;
      c.width = backingSize(beforeW, dpr) || W;
    }
    if (followedH) {
      c.style.height = `${beforeH}px`;
      this.cssH = beforeH;
      this.devH = 0;
      c.height = backingSize(beforeH, dpr) || H;
    }
    if (!this.warned) {
      this.warned = true;
      console.warn(`CanvasRenderer: the display canvas has no CSS size; pinned it to ${beforeW}x${beforeH} CSS px. `
        + 'Size it with CSS (e.g. width/height 100% of a sized host).');
    }
  }
}
