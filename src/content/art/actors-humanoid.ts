// Body-part helpers for 16x24 characters (soldiers, archers, goblins, NPCs).
// Frame layout: feet on row 22 with the outline on row 23, so the 12x12
// hitbox (origin 8,18) covers the bottom 12 rows. Upper bodies are authored as
// ASCII per facing; legs are generated per facing and walk phase, and walk
// frames add a body dip, swinging arms and a swaying robe hem.
import { art, FrameBank, moved, OUT, type Ramp } from './actors-kit';
import { PixelGrid } from './pixelgrid';

/** Authored facings; `left` anims are mirrored from `right` by the catalog. */
export type Facing = 'down' | 'up' | 'right';
export const FACINGS: readonly Facing[] = ['down', 'up', 'right'];
/**
 * 0 = standing; 1 / 2 = the two walk frames (front: alternate lifted foot,
 * profile: stride then passing pose).
 */
export type Phase = 0 | 1 | 2;

export const CHAR_W = 16;
export const CHAR_H = 24;
/** Last interior row of the feet (the outline sits on the row below). */
const FOOT = CHAR_H - 2;

/** A 16x24 layer from ASCII rows placed starting at row `top` (see `art`). */
export function overlay(rows: readonly string[], top: number): PixelGrid {
  const g = new PixelGrid(CHAR_W, CHAR_H);
  return g.blit(art(CHAR_W, rows), 0, top);
}

/** How a character's legs look. */
export interface LegStyle {
  /** First leg row (just below the tunic / hem). */
  hip: number;
  pants: Ramp;
  boots: Ramp;
  /**
   * Robe or long skirt: the first row of the hem, which sways on walk frames.
   * Only the feet peek out below it.
   */
  robe?: number;
}

function frontLegs(g: PixelGrid, f: Facing, phase: Phase, st: LegStyle): void {
  const [pd, pm] = st.pants;
  const [bd, bm, bl] = st.boots;
  for (const side of [-1, 1] as const) {
    const lifted = phase !== 0 && (phase === 1 ? side > 0 : side < 0);
    // The stepping foot rises (less under a robe, where the hem hides it) and tucks in.
    const bottom = FOOT - (lifted ? (st.robe === undefined ? 2 : 1) : 0);
    const tuck = lifted ? -side : 0;
    const px = (side < 0 ? 5 : 9) + tuck;
    if (st.robe === undefined) {
      for (let y = st.hip; y <= bottom - 2; y++) g.set(px, y, pm).set(px + 1, y, pd);
    }
    const bx = (side < 0 ? 4 : 9) + tuck;
    const top = bottom - 1;
    if (f === 'down') {
      g.set(bx, top, side < 0 ? bl : bm).set(bx + 1, top, bm).set(bx + 2, top, side < 0 ? bm : bd);
      g.set(bx, bottom, bm).set(bx + 1, bottom, bd).set(bx + 2, bottom, bd);
    } else {
      g.set(bx, top, bm).set(bx + 1, top, bm).set(bx + 2, top, bd);
      g.set(bx, bottom, bd).set(bx + 1, bottom, bd).set(bx + 2, bottom, bd);
    }
    if (lifted) for (let x = bx; x < bx + 3; x++) g.set(x, bottom, bd);
  }
}

/** One profile leg: pants columns per row (from the hip), boot toe column and lift. */
function sideLeg(g: PixelGrid, st: LegStyle, xs: readonly number[], toe: number, lift: number, far: boolean): void {
  const [pd, pm] = st.pants;
  const [bd, bm, bl] = st.boots;
  const bottom = FOOT - lift;
  if (st.robe === undefined) {
    for (let y = st.hip, i = 0; y <= bottom - 2; y++, i++) {
      const x = xs[Math.min(i, xs.length - 1)]!;
      g.set(x, y, far ? pd : pm).set(x + 1, y, pd);
    }
  }
  // Boot: ankle row two px wide ending at the toe-1, sole row three px to the toe.
  g.set(toe - 2, bottom - 1, far ? bd : bm).set(toe - 1, bottom - 1, far ? bd : bm);
  g.set(toe - 2, bottom, bd).set(toe - 1, bottom, far ? bd : bm).set(toe, bottom, far ? bm : bl);
}

function sideLegs(g: PixelGrid, phase: Phase, st: LegStyle): void {
  if (phase === 0) {
    sideLeg(g, st, [6], 9, 0, true);
    sideLeg(g, st, [7], 10, 0, false);
  } else if (phase === 1) {
    // Stride: far leg pushing off behind, near leg reaching forward.
    sideLeg(g, st, [6, 5], 6, 1, true);
    sideLeg(g, st, [7, 8], 11, 0, false);
  } else {
    // Passing: near leg planted underneath, far leg swinging through, heel up.
    sideLeg(g, st, [7, 7], 9, 1, true);
    sideLeg(g, st, [7, 7], 10, 0, false);
    g.set(5, FOOT - 1, st.boots[0]);
  }
}

/** Legs for a facing and phase on a transparent 16x24 grid. */
export function legs(f: Facing, phase: Phase, st: LegStyle): PixelGrid {
  const g = new PixelGrid(CHAR_W, CHAR_H);
  if (f === 'right') sideLegs(g, phase, st);
  else frontLegs(g, f, phase, st);
  return g;
}

/**
 * A free arm in body art: columns x0..x1 and rows y0..y1 (inclusive), where
 * y0 is the first row below the shoulder and y1 a spare row below the hand.
 */
export type Arm = readonly [x0: number, x1: number, y0: number, y1: number];

/** A character: upper-body art per facing plus a leg style. */
export interface Figure {
  body: Readonly<Record<Facing, PixelGrid>>;
  legs: LegStyle;
  /** Optional per-facing layer drawn over everything (weapons, canes). */
  over?: Partial<Record<Facing, PixelGrid>>;
  /** Optional per-facing layer drawn behind the body (items held on the far side). */
  under?: Partial<Record<Facing, PixelGrid>>;
  /** Free (empty-handed) front / back view arms that swing on walk frames. */
  arms?: Partial<Record<'down' | 'up', readonly Arm[]>>;
}

/** Per-frame overrides for `figureFrame`. */
export interface FrameExtras {
  /** Replacement body art (attack / throw poses). */
  body?: PixelGrid;
  /** Replacement top layer (null = none); undefined keeps the figure's default. */
  over?: PixelGrid | null;
  /** Replacement back layer (null = none); undefined keeps the figure's default. */
  under?: PixelGrid | null;
}

/** Compose one outlined 16x24 frame of a figure: back layer, legs, body, then the top layer. */
export function figureFrame(fig: Figure, f: Facing, phase: Phase, ex: FrameExtras = {}): PixelGrid {
  const g = new PixelGrid(CHAR_W, CHAR_H);
  const under = ex.under === undefined ? fig.under?.[f] : ex.under;
  if (under) g.blit(under, 0, 0);
  g.blit(legs(f, phase, fig.legs), 0, 0);
  g.blit(ex.body ?? fig.body[f], 0, 0);
  const over = ex.over === undefined ? fig.over?.[f] : ex.over;
  if (over) g.blit(over, 0, 0);
  return g.outline(OUT);
}

/** Move an arm 1px along its swing, clipped to its rectangle: +1 reaches down, -1 draws up. */
function swingArm(g: PixelGrid, [x0, x1, y0, y1]: Arm, dy: 1 | -1): void {
  const src = g.clone();
  for (let y = dy > 0 ? y0 + 1 : y0; y <= y1; y++) {
    const from = y - dy;
    for (let x = x0; x <= x1; x++) g.set(x, y, from <= y1 ? src.get(x, from) : 0);
  }
}

/** Shift every row from `top` down sideways by dx (a swaying hem). */
function sway(g: PixelGrid, top: number, dx: number): void {
  const src = g.clone();
  for (let y = top; y < g.h; y++) for (let x = 0; x < g.w; x++) g.set(x, y, src.get(x - dx, y));
}

/**
 * Drop the rows above `limit` by 1px (the body sinking onto the planted leg);
 * the last of them lands on top of row `limit`, which keeps its own pixels.
 */
function dip(g: PixelGrid, limit: number): PixelGrid {
  const lower = new PixelGrid(g.w, g.h);
  const upper = new PixelGrid(g.w, g.h);
  for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) (y < limit ? upper : lower).set(x, y, g.get(x, y));
  return lower.blit(upper, 0, 1);
}

/** A layer moved down with the dipping body, never below the feet. */
function dipLayer(g: PixelGrid | undefined): PixelGrid | undefined {
  if (!g) return undefined;
  const d = moved(g, 0, 1);
  d.fill(0, FOOT + 1, d.w, d.h - FOOT - 1, 0);
  return d;
}

/**
 * One walk frame: phase 1 is the stride (body dips 1px), phase 2 the passing
 * pose. Free arms swing against the legs (front / back) and robes sway.
 */
export function walkFrame(fig: Figure, f: Facing, phase: 1 | 2): PixelGrid {
  const body = fig.body[f].clone();
  const hem = fig.legs.robe;
  if (f !== 'right') {
    for (const a of fig.arms?.[f] ?? []) {
      // Phase 1 lifts the viewer-right foot: the viewer-left arm swings forward
      // (toward the camera when facing down, away from it when facing up).
      const leftSide = a[0] + a[1] < CHAR_W - 1;
      const forward = leftSide === (phase === 1);
      swingArm(body, a, forward === (f === 'down') ? 1 : -1);
    }
  }
  if (hem !== undefined) sway(body, hem, phase === 1 ? 1 : -1);
  if (phase === 2) return figureFrame(fig, f, phase, { body });
  return figureFrame(fig, f, phase, {
    body: dip(body, hem ?? CHAR_H),
    over: dipLayer(fig.over?.[f]),
    under: dipLayer(fig.under?.[f]),
  });
}

/** Add the two-frame `walk_down/_up/_right` anims (phases 1 and 2). */
export function addWalk(bank: FrameBank, fig: Figure): void {
  for (const f of FACINGS) bank.add(`walk_${f}`, walkFrame(fig, f, 1), walkFrame(fig, f, 2));
}

/** Add the single-frame `idle_down/_up/_right` anims. */
export function addIdle(bank: FrameBank, fig: Figure): void {
  for (const f of FACINGS) bank.add(`idle_${f}`, figureFrame(fig, f, 0));
}
