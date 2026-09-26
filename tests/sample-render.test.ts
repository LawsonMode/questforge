// Renders every room of the sample adventure to PNG for visual review, plus a
// composite per world floor (to check seams between neighbouring screens):
//   QF_SHEETS=1 npx vitest run tests/sample-render.test.ts   -> e2e-out/sample/
// and close-ups of every overworld screen seam, unmarked, as the scroll shows them.
// Entities are marked: enemies red, NPCs yellow, chests/items gold, doors cyan
// outlines, warps magenta outlines, other objects white.
import { describe, it } from 'vitest';
import { createSampleProject } from '../src/content/sample/sampleProject';
import { entityInfo, footprint } from '../src/core/catalog';
import type { EntityInstance, Project, Room, World } from '../src/core/types';
import { Raster, renderScene, writePng } from './tools/png';

const OUT = 'e2e-out/sample';
type Rgb = [number, number, number];

function markColor(e: EntityInstance): Rgb {
  const cat = entityInfo(e.type)?.category;
  if (cat === 'enemy' || cat === 'boss') return [240, 40, 40];
  if (cat === 'npc') return [255, 230, 40];
  if (cat === 'pickup' || e.type === 'obj.chest') return [255, 170, 0];
  if (e.type === 'obj.door') return [40, 230, 255];
  if (cat === 'marker') return [255, 40, 255];
  return [255, 255, 255];
}

function outline(r: Raster, x: number, y: number, w: number, h: number, c: Rgb): void {
  r.fill(x, y, w, 1, c);
  r.fill(x, y + h - 1, w, 1, c);
  r.fill(x, y, 1, h, c);
  r.fill(x + w - 1, y, 1, h, c);
}

/** Room raster at `scale`, with entity markers unless `marks` is false. */
function drawRoom(p: Project, room: Room, scale: number, marks = true): Raster {
  const cols = room.gw * 16;
  const rows = room.gh * 14;
  const r = renderScene(p.tiles, p.palettes, room.layers, cols, rows, scale);
  for (const e of marks ? room.entities : []) {
    const c = markColor(e);
    const fp = footprint(e);
    if (e.type === 'obj.door' || e.type.startsWith('marker.') || (e.type === 'obj.chest' && e.props.big)) {
      outline(r, Math.round((e.x - fp.w / 2) * scale), Math.round((e.y - fp.h / 2) * scale), fp.w * scale, fp.h * scale, c);
    }
    if (!e.type.startsWith('marker.')) {
      const s = 3 * scale;
      r.fill(Math.round(e.x * scale - s / 2), Math.round(e.y * scale - s / 2), s, s, c);
      if (e.props.hidden === true) outline(r, Math.round(e.x * scale - s), Math.round(e.y * scale - s), s * 2, s * 2, c);
    }
  }
  return r;
}

function blit(dst: Raster, src: Raster, ox: number, oy: number): void {
  for (let y = 0; y < src.h; y++) {
    for (let x = 0; x < src.w; x++) {
      const i = (y * src.w + x) * 4;
      dst.set(ox + x, oy + y, src.data[i]!, src.data[i + 1]!, src.data[i + 2]!);
    }
  }
}

/** A w x h window of `src` starting at (x, y). */
function crop(src: Raster, x: number, y: number, w: number, h: number): Raster {
  const out = new Raster(w, h);
  blit(out, src, -x, -y);
  return out;
}

/** All rooms of one floor laid out on the world grid. */
function composite(p: Project, world: World, floor: number, scale: number, marks = true): Raster | null {
  const rooms = world.rooms.filter((r) => r.floor === floor);
  if (rooms.length === 0) return null;
  const gx0 = Math.min(...rooms.map((r) => r.gx));
  const gy0 = Math.min(...rooms.map((r) => r.gy));
  const gx1 = Math.max(...rooms.map((r) => r.gx + r.gw));
  const gy1 = Math.max(...rooms.map((r) => r.gy + r.gh));
  const sw = 256 * scale;
  const sh = 224 * scale;
  const out = new Raster((gx1 - gx0) * sw, (gy1 - gy0) * sh, [20, 20, 28]);
  for (const room of rooms) blit(out, drawRoom(p, room, scale, marks), (room.gx - gx0) * sw, (room.gy - gy0) * sh);
  return out;
}

/** Tiles shown either side of a seam close-up. */
const SEAM_TILES = 4;

/** Close-ups of every seam between two different screens of an overworld (grid origin 0,0). */
function writeSeams(p: Project, world: World, scale: number): void {
  const r = composite(p, world, 0, scale, false);
  if (!r) return;
  const sw = 256 * scale;
  const sh = 224 * scale;
  const band = SEAM_TILES * 16 * scale;
  const at = (gx: number, gy: number): Room | undefined =>
    world.rooms.find((room) => gx >= room.gx && gx < room.gx + room.gw && gy >= room.gy && gy < room.gy + room.gh);
  for (let gy = 0; gy * sh < r.h; gy++) {
    for (let gx = 0; gx * sw < r.w; gx++) {
      const here = at(gx, gy);
      if (!here) continue;
      if (gy > 0 && at(gx, gy - 1) && at(gx, gy - 1) !== here) {
        writePng(`${OUT}/seam-${world.id}-${gx}-${gy}-top.png`, crop(r, gx * sw, gy * sh - band, sw, band * 2));
      }
      if (gx > 0 && at(gx - 1, gy) && at(gx - 1, gy) !== here) {
        writePng(`${OUT}/seam-${world.id}-${gx}-${gy}-left.png`, crop(r, gx * sw - band, gy * sh, band * 2, sh));
      }
    }
  }
}

describe.skipIf(!process.env.QF_SHEETS)('sample adventure sheets', () => {
  const p = createSampleProject();
  it('renders every room', () => {
    for (const world of p.worlds) {
      for (const room of world.rooms) writePng(`${OUT}/room-${world.id}-${room.id}.png`, drawRoom(p, room, 2));
    }
  });
  it('renders world composites', () => {
    for (const world of p.worlds) {
      if (world.kind === 'interior') continue;
      for (const floor of new Set(world.rooms.map((r) => r.floor))) {
        const r = composite(p, world, floor, 1);
        if (r) writePng(`${OUT}/world-${world.id}-f${floor}.png`, r);
      }
    }
  });
  it('renders the overworld screen seams', () => {
    for (const world of p.worlds) if (world.kind === 'overworld') writeSeams(p, world, 2);
  });
});
