// Project validation & migration. OWNER: data agent.
import type {
  Action, Collision, Condition, Dialogue, DialoguePage, Dir, EntityInstance, FlagDef, ItemId, LayerName, MusicId,
  Palette, Project, ProjectSettings, PropValue, Room, SfxId, SpriteAnim, SpriteDef, Terrain, TileDef, Trigger, TriggerOn,
  WarpTarget, World, WorldKind,
} from './types';
import { COLLISIONS, ITEM_IDS, LAYERS, MUSIC_IDS, SFX_IDS } from './types';
import {
  MAX_HEARTS, MAX_ROOM_SCREENS, PALETTE_SIZE, PROJECT_FORMAT, PROJECT_VERSION, SCREEN_COLS, SCREEN_H, SCREEN_ROWS,
  SCREEN_W, TILE,
} from './constants';
import { clamp } from './math';
import { countsForClear, defaultProps, ENTITY_TYPES, entityInfo, propOf, type PropSchema } from './catalog';
import { ITEM_INFO, SPRITE_SPECS, TILE_SPECS, VARIANT_PALETTES } from '../content/ids';
import { createDefaultAssets, type DefaultAssets } from '../content/art';
import {
  clampScreens, defaultSettings, defaultWorldMusic, findRoom, findWorld, locateRoom, newId, resizeLayerData,
  roomCols, roomRows,
} from './project';

export interface Problem {
  level: 'error' | 'warning';
  message: string;
  where?: {
    world?: string; room?: string; entity?: string; trigger?: string;
    tile?: number; sprite?: string; palette?: string; dialogue?: string;
  };
}

type Where = NonNullable<Problem['where']>;

const TERRAIN_PIECES = ['center', 'n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw', 'ine', 'inw', 'ise', 'isw'] as const;
const DIRS: readonly string[] = ['up', 'down', 'left', 'right'];
const WORLD_KINDS: readonly string[] = ['overworld', 'dungeon', 'interior'];
const TRIGGER_ONS: readonly string[] = ['auto', 'enter', 'talk'];
const HEX_COLOR = /^#[0-9a-f]{6}$/;
const HEX_PIXELS = /^[0-9a-f]*$/;
/** Start items that only make sense when picked up in play. */
const NO_START_EFFECT = new Set(['health', 'dungeon', 'prize']);
/** Condition kinds that name an entity in the trigger's room, with the expected type (if any). */
const CONDITION_TARGET_TYPES: Readonly<Record<string, string | null>> = {
  switch: 'obj.switch', inRegion: 'marker.region', blockPushed: 'obj.block', defeated: null,
};
const ACTION_TARGET_TYPES: Readonly<Record<string, string | null>> = {
  openDoor: 'obj.door', closeDoor: 'obj.door', showEntity: null, hideEntity: null,
};
/** Largest sprite frame edge in px (matches the art editor's size limit). */
export const MAX_SPRITE_SIZE = 64;
/** Room grid positions (screens) are kept to +-this on import; real worlds are a few dozen screens wide. */
export const MAX_GRID = 256;
/** Room floors are kept to this range (the editor offers -9..9). */
export const MAX_FLOOR = 99;
/** Longest dialogue page text kept on import (~30 dialogue boxes; bounds layout work for signs and the editor preview). */
export const MAX_PAGE_TEXT = 4000;
/** Overlapping-room reports per world before the rest are summarised in one problem. */
const MAX_OVERLAP_REPORTS = 50;
/** Tile ids / sprite ids the engine and content reference by id (restored when a file lacks them). */
const BUILTIN_TILE_IDS: ReadonlySet<number> = new Set(TILE_SPECS.map((s) => s.id));
const BUILTIN_SPRITE_IDS: ReadonlySet<string> = new Set(SPRITE_SPECS.map((s) => s.id));
/** Palettes referenced by id from code: palette swaps, sprite level colours and entity icons. */
const ENGINE_PALETTE_IDS: readonly string[] = [...new Set([
  ...Object.values(VARIANT_PALETTES).flatMap((v) => Object.values(v)).filter((x): x is string => typeof x === 'string'),
  ...SPRITE_SPECS.flatMap((s) => s.swaps ?? []),
  ...ENTITY_TYPES.map((e) => e.icon.palette).filter((x): x is string => typeof x === 'string'),
])];

/** A reason the project cannot be opened at all (null when usable). */
export function usabilityError(p: Project): string | null {
  if (p.worlds.length === 0) return 'This project has no worlds, so there is nothing to play or edit.';
  return null;
}

// ============================================================================
// Validation
// ============================================================================

interface Located { world: World; room: Room; entity: EntityInstance }

interface Ctx {
  p: Project;
  out: Problem[];
  tiles: Map<number, TileDef>;
  palettes: Set<string>;
  dialogues: Set<string>;
  /** First occurrence of every entity id. */
  entities: Map<string, Located>;
}

function report(ctx: Ctx, level: Problem['level'], message: string, where?: Where): void {
  ctx.out.push(where ? { level, message, where } : { level, message });
}

function isItemId(v: unknown): v is ItemId {
  return typeof v === 'string' && (ITEM_IDS as readonly string[]).includes(v);
}

function isMusic(v: unknown, extra: readonly string[]): boolean {
  return typeof v === 'string' && ((MUSIC_IDS as readonly string[]).includes(v) || extra.includes(v));
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function isWarpShape(v: unknown): v is WarpTarget {
  return isObj(v) && typeof v.world === 'string' && typeof v.room === 'string' && isFiniteNumber(v.x) && isFiniteNumber(v.y);
}

/** Values that occur more than once. */
function duplicates<K>(keys: Iterable<K>): K[] {
  const seen = new Set<K>();
  const dup = new Set<K>();
  for (const k of keys) {
    if (seen.has(k)) dup.add(k);
    seen.add(k);
  }
  return [...dup];
}

function reportDuplicates<K extends string | number>(
  ctx: Ctx, keys: K[], label: string, where: (k: K) => Where | undefined, level: Problem['level'] = 'error',
): void {
  for (const k of duplicates(keys)) report(ctx, level, `Duplicate ${label} "${k}".`, where(k));
}

/** Effective collision at a room pixel (fg wins when non-zero; bg 0 = void = solid; solidMask quarters honoured). */
function collisionAt(ctx: Ctx, room: Room, x: number, y: number): Collision {
  const tx = Math.floor(x / TILE);
  const ty = Math.floor(y / TILE);
  const i = ty * roomCols(room) + tx;
  const fg = room.layers.fg[i] ?? 0;
  const id = fg !== 0 ? fg : room.layers.bg[i] ?? 0;
  if (id === 0) return 'solid';
  const def = ctx.tiles.get(id);
  if (!def) return 'floor';
  if (def.collision !== 'solid' || def.solidMask === undefined) return def.collision;
  const quarter = (Math.floor(y / 8) % 2) * 2 + (Math.floor(x / 8) % 2);
  return def.solidMask & (1 << quarter) ? 'solid' : 'floor';
}

/**
 * What makes a room pixel a bad place to put the hero ("void", "solid", "deep water", "pit"),
 * or null for walkable ground. Used for the start location and every warp destination.
 */
function unsafeGround(ctx: Ctx, room: Room, x: number, y: number): string | null {
  const i = Math.floor(y / TILE) * roomCols(room) + Math.floor(x / TILE);
  if ((room.layers.fg[i] ?? 0) === 0 && (room.layers.bg[i] ?? 0) === 0) return 'void';
  const c = collisionAt(ctx, room, x, y);
  if (c === 'solid' || c === 'pit') return c;
  return c === 'deep' ? 'deep water' : null;
}

/** Whether room-local pixel (x, y) lies inside the room: [0, width) x [0, height). */
function insideRoom(room: Room, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < roomCols(room) * TILE && y < roomRows(room) * TILE;
}

/**
 * Check a warp destination; missing world/room is an error, landing outside the
 * room or on void / solid / deep-water / pit ground (where the hero would be
 * stuck, drown or fall) a warning.
 */
function checkWarp(ctx: Ctx, target: unknown, label: string, where: Where): void {
  if (!isWarpShape(target)) {
    report(ctx, 'error', `${label} is not a valid destination (needs world, room, x and y).`, where);
    return;
  }
  if (!findWorld(ctx.p, target.world)) {
    report(ctx, 'error', `${label} points to a missing world "${target.world}".`, where);
    return;
  }
  const room = findRoom(ctx.p, target.world, target.room);
  if (!room) {
    const elsewhere = locateRoom(ctx.p, target.room);
    const hint = elsewhere ? ` (that room is in world "${elsewhere.world.name}")` : '';
    report(ctx, 'error', `${label} points to a missing room "${target.room}"${hint}.`, where);
    return;
  }
  if (!insideRoom(room, target.x, target.y)) {
    report(ctx, 'warning', `${label} lands outside room "${room.name}" (${target.x}, ${target.y}).`, where);
  } else {
    const ground = unsafeGround(ctx, room, target.x, target.y);
    if (ground) report(ctx, 'warning', `${label} lands on a ${ground} tile in room "${room.name}" (${target.x}, ${target.y}).`, where);
  }
  if (target.dir !== undefined && !DIRS.includes(target.dir)) {
    report(ctx, 'warning', `${label} has an invalid facing "${String(target.dir)}".`, where);
  }
}

/**
 * Structural + referential checks: layer sizes, unknown tile ids, frame sizes,
 * palette refs, overlapping rooms, duplicate ids, dangling dialogue/entity/warp
 * references in props & triggers, start location validity, unknown entity types.
 */
export function validateProject(p: Project): Problem[] {
  const ctx: Ctx = {
    p,
    out: [],
    tiles: new Map(),
    palettes: new Set(p.palettes.map((x) => x.id)),
    dialogues: new Set(p.dialogues.map((d) => d.id)),
    entities: new Map(),
  };
  for (const t of p.tiles) if (!ctx.tiles.has(t.id)) ctx.tiles.set(t.id, t);
  for (const world of p.worlds) {
    for (const room of world.rooms) {
      for (const entity of room.entities) if (!ctx.entities.has(entity.id)) ctx.entities.set(entity.id, { world, room, entity });
    }
  }
  const fatal = usabilityError(p);
  if (fatal) report(ctx, 'error', fatal);
  validateSettings(ctx);
  validatePalettes(ctx);
  validateTiles(ctx);
  validateTerrains(ctx);
  validateSprites(ctx);
  validateDialogues(ctx);
  validateFlags(ctx);
  validateWorlds(ctx);
  validateStart(ctx);
  return ctx.out;
}

// ---------------------------------------------------------------- settings

function validateSettings(ctx: Ctx): void {
  const s = ctx.p.settings;
  if (!Number.isInteger(s.startHearts) || s.startHearts < 1 || s.startHearts > MAX_HEARTS) {
    report(ctx, 'error', `Starting hearts must be a whole number from 1 to ${MAX_HEARTS} (is ${s.startHearts}).`);
  }
  for (const [key, value] of Object.entries(s.startItems)) {
    if (!isItemId(key)) {
      report(ctx, 'error', `Unknown starting item "${key}".`);
    } else if (!isFiniteNumber(value) || value < 1) {
      report(ctx, 'warning', `Starting item "${key}" has no amount (${String(value)}).`);
    } else if (NO_START_EFFECT.has(ITEM_INFO[key].kind)) {
      report(ctx, 'warning', `Starting item "${ITEM_INFO[key].name}" has no effect at game start.`);
    }
  }
  if (s.introDialogue && !ctx.dialogues.has(s.introDialogue)) {
    report(ctx, 'error', `Intro dialogue "${s.introDialogue}" does not exist.`, { dialogue: s.introDialogue });
  }
  if (!isMusic(s.titleMusic, [])) report(ctx, 'error', `Unknown title music "${s.titleMusic}".`);
}

// ---------------------------------------------------------------- assets

function validatePalettes(ctx: Ctx): void {
  reportDuplicates(ctx, ctx.p.palettes.map((x) => x.id), 'palette id', (id) => ({ palette: id }));
  for (const pal of ctx.p.palettes) {
    const where = { palette: pal.id };
    if (pal.colors.length !== 16) report(ctx, 'error', `Palette "${pal.name}" has ${pal.colors.length} colours (needs 16).`, where);
    const bad = pal.colors.find((c) => !HEX_COLOR.test(c));
    if (bad !== undefined) report(ctx, 'error', `Palette "${pal.name}" has an invalid colour "${bad}" (use #rrggbb).`, where);
  }
}

/** Index of the first frame that is not exactly `size` lowercase hex digits, or -1. */
function badFrame(frames: readonly string[], size: number): number {
  return frames.findIndex((f) => typeof f !== 'string' || f.length !== size || !HEX_PIXELS.test(f));
}

function validateTiles(ctx: Ctx): void {
  const tiles = ctx.p.tiles;
  reportDuplicates(ctx, tiles.map((t) => t.id), 'tile id', (id) => ({ tile: id }));
  reportDuplicates(ctx, tiles.map((t) => t.key), 'tile key', () => undefined, 'warning');
  for (const t of tiles) {
    const where = { tile: t.id };
    const label = `Tile "${t.name}" (${t.id})`;
    if (!Number.isInteger(t.id) || t.id < 1) report(ctx, 'error', `${label} must have a whole-number id of 1 or more.`, where);
    if (!ctx.palettes.has(t.palette)) report(ctx, 'error', `${label} uses a missing palette "${t.palette}".`, where);
    if (t.frames.length === 0) report(ctx, 'error', `${label} has no frames.`, where);
    const bad = badFrame(t.frames, TILE * TILE);
    if (bad >= 0) report(ctx, 'error', `${label} frame ${bad} must be 256 hex digits.`, where);
    if (!COLLISIONS.includes(t.collision)) report(ctx, 'error', `${label} has an unknown collision "${t.collision}".`, where);
    if (t.collision === 'ledge' && !t.ledgeDir) report(ctx, 'warning', `${label} is a ledge without a hop direction.`, where);
    for (const [name, b] of [['cut', t.cut], ['lift', t.lift], ['bomb', t.bomb], ['dash', t.dash]] as const) {
      if (b && b.to !== 0 && !ctx.tiles.has(b.to)) {
        report(ctx, 'error', `${label} ${name} behaviour turns into a missing tile ${b.to}.`, where);
      }
    }
  }
}

function validateTerrains(ctx: Ctx): void {
  reportDuplicates(ctx, ctx.p.terrains.map((t) => t.id), 'terrain id', () => undefined);
  for (const tr of ctx.p.terrains) {
    if (!LAYERS.includes(tr.layer)) report(ctx, 'error', `Terrain "${tr.name}" uses an unknown layer "${tr.layer}".`);
    const missing = TERRAIN_PIECES.filter((k) => !ctx.tiles.has(tr[k]));
    if (missing.length > 0) report(ctx, 'error', `Terrain "${tr.name}" references missing tiles for: ${missing.join(', ')}.`);
  }
}

function validateSprites(ctx: Ctx): void {
  reportDuplicates(ctx, ctx.p.sprites.map((s) => s.id), 'sprite id', (id) => ({ sprite: id }));
  const have = new Set(ctx.p.sprites.map((s) => s.id));
  const missing = [...BUILTIN_SPRITE_IDS].filter((id) => !have.has(id));
  if (missing.length > 0) {
    const shown = missing.slice(0, 5).join(', ') + (missing.length > 5 ? `, ... (${missing.length} in all)` : '');
    report(ctx, 'warning', `Built-in sprite${missing.length === 1 ? '' : 's'} missing (drawn as placeholders): ${shown}.`,
      { sprite: missing[0] });
  }
  for (const s of ctx.p.sprites) {
    const where = { sprite: s.id };
    const label = `Sprite "${s.name}"`;
    if (!ctx.palettes.has(s.palette)) report(ctx, 'error', `${label} uses a missing palette "${s.palette}".`, where);
    if (!Number.isInteger(s.w) || !Number.isInteger(s.h) || s.w < 1 || s.h < 1) {
      report(ctx, 'error', `${label} has an invalid frame size ${s.w}x${s.h}.`, where);
      continue;
    }
    const bad = badFrame(s.frames, s.w * s.h);
    if (bad >= 0) report(ctx, 'error', `${label} frame ${bad} must be ${s.w * s.h} hex digits (${s.w}x${s.h}).`, where);
    for (const [name, anim] of Object.entries(s.anims)) {
      if (!isObj(anim) || !Array.isArray(anim.frames)) {
        report(ctx, 'error', `${label} animation "${name}" is malformed (needs a list of frames).`, where);
        continue;
      }
      if (anim.frames.length === 0) report(ctx, 'warning', `${label} animation "${name}" has no frames.`, where);
      const out = anim.frames.find((i) => !Number.isInteger(i) || i < 0 || i >= s.frames.length);
      if (out !== undefined) report(ctx, 'error', `${label} animation "${name}" uses frame ${out}, which does not exist.`, where);
      if (!(anim.fps > 0)) report(ctx, 'warning', `${label} animation "${name}" needs a speed above 0 fps.`, where);
    }
  }
}

// ---------------------------------------------------------------- dialogue & flags

function validateDialogues(ctx: Ctx): void {
  reportDuplicates(ctx, ctx.p.dialogues.map((d) => d.id), 'dialogue id', (id) => ({ dialogue: id }));
  for (const d of ctx.p.dialogues) {
    const where = { dialogue: d.id };
    if (d.pages.length === 0) report(ctx, 'warning', `Dialogue "${d.name}" has no pages.`, where);
    d.pages.forEach((page, i) => {
      if (typeof page.text !== 'string') report(ctx, 'error', `Dialogue "${d.name}" page ${i + 1} has no text.`, where);
      else if (page.text.length > MAX_PAGE_TEXT) {
        report(ctx, 'warning',
          `Dialogue "${d.name}" page ${i + 1} is ${page.text.length} characters long; only the first ${MAX_PAGE_TEXT} are kept when the project is loaded. Split it into more pages.`,
          where);
      }
      const n = page.choice?.options.length;
      if (n !== undefined && (n < 2 || n > 3)) {
        report(ctx, 'warning', `Dialogue "${d.name}" page ${i + 1} choice should have 2-3 options (has ${n}).`, where);
      }
    });
  }
}

function validateFlags(ctx: Ctx): void {
  reportDuplicates(ctx, ctx.p.flags.map((f) => f.name), 'flag', () => undefined, 'warning');
  if (ctx.p.flags.some((f) => !f.name)) report(ctx, 'warning', 'A flag has an empty name.');
}

// ---------------------------------------------------------------- worlds & rooms

function validateWorlds(ctx: Ctx): void {
  const { p } = ctx;
  const rooms = p.worlds.flatMap((w) => w.rooms);
  if (p.worlds.length > 0 && rooms.length === 0) report(ctx, 'error', 'This project has no rooms.');
  reportDuplicates(ctx, p.worlds.map((w) => w.id), 'world id', (id) => ({ world: id }));
  reportDuplicates(ctx, rooms.map((r) => r.id), 'room id', (id) => ({ room: id }));
  reportDuplicates(ctx, rooms.flatMap((r) => r.entities.map((e) => e.id)), 'entity id', (id) => ({ entity: id }));
  reportDuplicates(ctx, rooms.flatMap((r) => r.triggers.map((t) => t.id)), 'trigger id', (id) => ({ trigger: id }));
  for (const world of p.worlds) {
    const where = { world: world.id };
    if (!WORLD_KINDS.includes(world.kind)) report(ctx, 'error', `World "${world.name}" has an unknown kind "${world.kind}".`, where);
    if (!isMusic(world.music, ['none'])) report(ctx, 'error', `World "${world.name}" has unknown music "${world.music}".`, where);
    if (world.prizeName !== undefined) {
      if (typeof world.prizeName !== 'string') {
        report(ctx, 'error', `World "${world.name}" prize name should be text.`, where);
      } else if (world.kind !== 'dungeon' && world.prizeName.trim()) {
        report(ctx, 'warning', `World "${world.name}" has a prize name, but only dungeon worlds have a prize.`, where);
      }
    }
    validateOverlaps(ctx, world);
    for (const room of world.rooms) validateRoom(ctx, world, room);
    validateDungeonKeys(ctx, world);
  }
  validateDoorLinks(ctx);
}

/**
 * Each room that overlaps an earlier room on the same floor is reported once (naming the first
 * such room), at most MAX_OVERLAP_REPORTS per world; the rest are summarised in one problem.
 * So n stacked rooms give at most ~50 problems instead of n(n-1)/2.
 */
function validateOverlaps(ctx: Ctx, world: World): void {
  const rooms = world.rooms;
  let reported = 0;
  let more = 0;
  for (let i = 1; i < rooms.length; i++) {
    const a = rooms[i]!;
    for (let j = 0; j < i; j++) {
      const b = rooms[j]!;
      if (a.floor === b.floor && a.gx < b.gx + b.gw && a.gx + a.gw > b.gx && a.gy < b.gy + b.gh && a.gy + a.gh > b.gy) {
        if (reported < MAX_OVERLAP_REPORTS) {
          report(ctx, 'error', `Rooms "${b.name}" and "${a.name}" overlap on floor ${a.floor} of "${world.name}".`,
            { world: world.id, room: a.id });
          reported++;
        } else {
          more++;
        }
        break;
      }
    }
  }
  if (more > 0) {
    report(ctx, 'error', `${more} more overlapping room${more === 1 ? '' : 's'} in "${world.name}".`, { world: world.id });
  }
}

/** Door open/unlock state is the project-wide flag door:<link>, so a link shared across worlds couples those doors. */
function validateDoorLinks(ctx: Ctx): void {
  const firstWorld = new Map<string, World>();
  const warned = new Set<string>();
  for (const world of ctx.p.worlds) {
    for (const room of world.rooms) {
      for (const e of room.entities) {
        if (e.type !== 'obj.door') continue;
        const link = propStr(e, 'link').trim();
        if (!link || warned.has(link)) continue;
        const first = firstWorld.get(link);
        if (!first) {
          firstWorld.set(link, world);
        } else if (first !== world) {
          warned.add(link);
          report(ctx, 'warning',
            `Door link "${link}" is used in worlds "${first.name}" and "${world.name}"; those doors share one open/locked state.`,
            { world: world.id, room: room.id, entity: e.id });
        }
      }
    }
  }
}

function validateRoom(ctx: Ctx, world: World, room: Room): void {
  const where = { world: world.id, room: room.id };
  const label = `Room "${room.name}"`;
  for (const [axis, v] of [['width', room.gw], ['height', room.gh]] as const) {
    if (!Number.isInteger(v) || v < 1 || v > MAX_ROOM_SCREENS) {
      report(ctx, 'error', `${label} ${axis} must be 1-${MAX_ROOM_SCREENS} screens (is ${v}).`, where);
    }
  }
  if (!Number.isInteger(room.floor)) report(ctx, 'warning', `${label} floor should be a whole number (is ${room.floor}).`, where);
  const cells = roomCols(room) * roomRows(room);
  for (const layer of LAYERS) validateLayer(ctx, room, layer, cells, where);
  if (room.music !== undefined && !isMusic(room.music, ['none', 'inherit'])) {
    report(ctx, 'error', `${label} has unknown music "${room.music}".`, where);
  }
  if (room.pitTarget !== undefined) checkWarp(ctx, room.pitTarget, `${label} pit destination`, where);
  for (const e of room.entities) validateEntity(ctx, world, room, e);
  for (const t of room.triggers) validateTrigger(ctx, world, room, t);
}

function validateLayer(ctx: Ctx, room: Room, layer: LayerName, cells: number, where: Where): void {
  const data = room.layers[layer];
  if (!Array.isArray(data)) {
    report(ctx, 'error', `Room "${room.name}" is missing its ${layer} layer.`, where);
    return;
  }
  if (data.length !== cells) {
    report(ctx, 'error', `Room "${room.name}" ${layer} layer has ${data.length} cells (needs ${cells}).`, where);
  }
  const unknown = new Set<number>();
  for (const id of data) if (id !== 0 && !ctx.tiles.has(id)) unknown.add(id);
  if (unknown.size > 0) {
    const ids = [...unknown];
    const shown = ids.slice(0, 5).join(', ') + (ids.length > 5 ? ', ...' : '');
    report(ctx, 'error', `Room "${room.name}" ${layer} layer uses unknown tile ids: ${shown}.`, { ...where, tile: ids[0] });
  }
}

// ---------------------------------------------------------------- entities

function validateEntity(ctx: Ctx, world: World, room: Room, e: EntityInstance): void {
  const where = { world: world.id, room: room.id, entity: e.id };
  const info = entityInfo(e.type);
  if (!info) {
    report(ctx, 'error', `Entity "${e.id}" in room "${room.name}" has an unknown type "${e.type}".`, where);
    return;
  }
  const label = `${info.name} "${e.id}" in room "${room.name}"`;
  if (!isFiniteNumber(e.x) || !isFiniteNumber(e.y) || !insideRoom(room, e.x, e.y)) {
    report(ctx, 'warning', `${label} is outside the room (${e.x}, ${e.y}).`, where);
  }
  for (const schema of info.props) {
    const value = e.props[schema.key];
    if (value !== undefined) validateProp(ctx, room, schema, value, `${label} "${schema.label}"`, where);
  }
  const itemProp = info.props.find((schema) => schema.kind === 'item');
  if (itemProp && info.props.some((schema) => schema.key === 'amount')) {
    checkItemAmount(ctx, propOf<PropValue>(e, itemProp.key, null), propOf<PropValue>(e, 'amount', null), label, where);
  }
  if (e.type === 'marker.warp' && (e.props.target === null || e.props.target === undefined)) {
    report(ctx, 'warning', `${label} has no destination.`, where);
  }
}

function validateProp(ctx: Ctx, room: Room, schema: PropSchema, value: unknown, label: string, where: Where): void {
  const wrongType = (what: string): void => report(ctx, 'error', `${label} should be ${what}.`, where);
  switch (schema.kind) {
    case 'string':
    case 'text':
    case 'flag':
      if (typeof value !== 'string') wrongType('text');
      return;
    case 'bool':
      if (typeof value !== 'boolean') wrongType('true or false');
      return;
    case 'number':
      if (!isFiniteNumber(value)) wrongType('a number');
      else if ((schema.min !== undefined && value < schema.min) || (schema.max !== undefined && value > schema.max)) {
        report(ctx, 'warning', `${label} is ${value}, outside ${schema.min ?? '-inf'}..${schema.max ?? 'inf'}.`, where);
      }
      return;
    case 'enum':
      if (typeof value !== 'string' || !schema.options?.includes(value)) {
        report(ctx, 'error', `${label} has an invalid option "${String(value)}" (expected ${schema.options?.join(' / ')}).`, where);
      }
      return;
    case 'item':
      if (!isItemId(value)) report(ctx, 'error', `${label} names an unknown item "${String(value)}".`, where);
      return;
    case 'music':
      if (!isMusic(value, ['none', 'inherit'])) report(ctx, 'error', `${label} names unknown music "${String(value)}".`, where);
      return;
    case 'dialogue':
      if (typeof value !== 'string') wrongType('a dialogue id');
      else if (value && !ctx.dialogues.has(value)) report(ctx, 'error', `${label} uses a missing dialogue "${value}".`, where);
      return;
    case 'entity':
      if (typeof value !== 'string') wrongType('an entity id');
      else if (value) checkEntityRef(ctx, room, value, schema.entityFilter ?? null, label, where, true);
      return;
    case 'warp':
      if (value !== null) checkWarp(ctx, value, label, where);
      return;
  }
}

/**
 * Warn about item amounts with surprising effects in play (see state.applyItem): for small keys
 * the amount is the number of keys, for Sword / Stone Gauntlet / Boomerang it is the level given.
 */
function checkItemAmount(ctx: Ctx, item: unknown, amount: unknown, label: string, where: Where): void {
  if (!isItemId(item) || !isFiniteNumber(amount)) return;
  const info = ITEM_INFO[item];
  if (item === 'smallKey' && amount > 1) {
    report(ctx, 'warning', `${label} gives ${amount} Small Keys (the amount is the number of keys).`, where);
  } else if (info.maxLevel > 1 && amount > info.maxLevel) {
    report(ctx, 'warning',
      `${label} gives the level-${info.maxLevel} ${info.name} straight away (for this item the amount is the level, 1-${info.maxLevel}).`,
      where);
  }
}

/**
 * Check a reference to an entity. Missing everywhere is an error; in another
 * room is an error when `sameRoom` is required, else fine. A type mismatch is a warning.
 */
function checkEntityRef(
  ctx: Ctx, room: Room, id: string, type: string | null, label: string, where: Where, sameRoom: boolean,
): void {
  const found = ctx.entities.get(id);
  if (!found) {
    report(ctx, 'error', `${label} refers to a missing entity "${id}".`, where);
    return;
  }
  if (sameRoom && found.room !== room) {
    report(ctx, 'error', `${label} refers to entity "${id}" in another room ("${found.room.name}").`, where);
    return;
  }
  if (type && !found.entity.type.startsWith(type)) {
    report(ctx, 'warning', `${label} expects a ${type} but "${id}" is a ${found.entity.type}.`, where);
  }
}

// ---------------------------------------------------------------- triggers

function validateTrigger(ctx: Ctx, world: World, room: Room, t: Trigger): void {
  const where = { world: world.id, room: room.id, trigger: t.id };
  const label = `Trigger "${t.name}" in room "${room.name}"`;
  if (!TRIGGER_ONS.includes(t.on)) report(ctx, 'error', `${label} has an unknown "when" setting "${t.on}".`, where);
  if (t.on === 'talk') {
    if (!t.source) report(ctx, 'error', `${label} fires on talk but has no source entity.`, where);
    else checkEntityRef(ctx, room, t.source, null, `${label} source`, where, true);
  }
  t.conditions.forEach((c, i) => validateCondition(ctx, room, c, `${label} condition ${i + 1}`, where));
  if (t.actions.length === 0) report(ctx, 'warning', `${label} has no actions.`, where);
  t.actions.forEach((a, i) => validateAction(ctx, room, a, `${label} action ${i + 1}`, where));
}

function validateCondition(ctx: Ctx, room: Room, c: Condition, label: string, where: Where): void {
  switch (c.kind) {
    case 'switch':
    case 'inRegion':
    case 'defeated':
    case 'blockPushed':
      if (!c.target) report(ctx, 'error', `${label} (${c.kind}) has no target.`, where);
      else checkEntityRef(ctx, room, c.target, CONDITION_TARGET_TYPES[c.kind] ?? null, `${label} (${c.kind})`, where, true);
      return;
    case 'flag':
      if (!c.flag) report(ctx, 'error', `${label} checks an empty flag name.`, where);
      return;
    case 'hasItem':
      if (!isItemId(c.item)) report(ctx, 'error', `${label} checks an unknown item "${String(c.item)}".`, where);
      return;
    case 'enemiesCleared':
      if (!room.entities.some((e) => countsForClear(e.type))) {
        report(ctx, 'warning', `${label} waits for enemies to be cleared, but the room has none.`, where);
      }
      return;
    case 'torchesLit':
      if (!room.entities.some((e) => e.type === 'obj.torch')) {
        report(ctx, 'warning', `${label} waits for torches, but the room has none.`, where);
      }
      return;
    default:
      report(ctx, 'error', `${label} has an unknown kind "${(c as { kind: unknown }).kind}".`, where);
  }
}

function validateAction(ctx: Ctx, room: Room, a: Action, label: string, where: Where): void {
  switch (a.kind) {
    case 'openDoor':
    case 'closeDoor':
    case 'showEntity':
    case 'hideEntity':
      if (!a.target) report(ctx, 'error', `${label} (${a.kind}) has no target.`, where);
      else checkEntityRef(ctx, room, a.target, ACTION_TARGET_TYPES[a.kind] ?? null, `${label} (${a.kind})`, where, false);
      return;
    case 'setFlag':
      if (!a.flag) report(ctx, 'error', `${label} sets an empty flag name.`, where);
      return;
    case 'dialogue':
      if (!ctx.dialogues.has(a.dialogue)) report(ctx, 'error', `${label} uses a missing dialogue "${a.dialogue}".`, where);
      return;
    case 'giveItem':
    case 'takeItem':
      if (!isItemId(a.item)) report(ctx, 'error', `${label} uses an unknown item "${String(a.item)}".`, where);
      if (!isFiniteNumber(a.amount)) report(ctx, 'error', `${label} needs a numeric amount.`, where);
      if (a.kind === 'giveItem') checkItemAmount(ctx, a.item, a.amount, `${label} (giveItem)`, where);
      return;
    case 'setTile':
      validateSetTile(ctx, room, a, label, where);
      return;
    case 'sound':
      if (!(SFX_IDS as readonly string[]).includes(a.sfx)) report(ctx, 'error', `${label} plays an unknown sound "${a.sfx}".`, where);
      return;
    case 'music':
      if (!isMusic(a.music, ['none'])) report(ctx, 'error', `${label} plays unknown music "${a.music}".`, where);
      return;
    case 'warp':
      checkWarp(ctx, a.target, `${label} (warp)`, where);
      return;
    case 'heal':
    case 'shake':
    case 'wait': {
      const n = a.kind === 'heal' ? a.amount : a.seconds;
      if (!isFiniteNumber(n) || n < 0) report(ctx, 'error', `${label} (${a.kind}) needs a number of 0 or more.`, where);
      return;
    }
    case 'secret':
      return;
    default:
      report(ctx, 'error', `${label} has an unknown kind "${(a as { kind: unknown }).kind}".`, where);
  }
}

function validateSetTile(ctx: Ctx, room: Room, a: Extract<Action, { kind: 'setTile' }>, label: string, where: Where): void {
  if (!LAYERS.includes(a.layer)) report(ctx, 'error', `${label} uses an unknown layer "${a.layer}".`, where);
  if (a.tile !== 0 && !ctx.tiles.has(a.tile)) report(ctx, 'error', `${label} places a missing tile ${a.tile}.`, { ...where, tile: a.tile });
  const inside = Number.isInteger(a.tx) && Number.isInteger(a.ty)
    && a.tx >= 0 && a.ty >= 0 && a.tx < roomCols(room) && a.ty < roomRows(room);
  if (!inside) report(ctx, 'error', `${label} targets tile (${a.tx}, ${a.ty}) outside the room.`, where);
}

// ---------------------------------------------------------------- dungeon keys & start

/** A prop as a string (catalog default when unset). */
function propStr(e: EntityInstance, key: string): string {
  return String(propOf<PropValue>(e, key, ''));
}

/** Keys a gift of `amount` gives in play (mirrors state.applyItem: whole amount >= 0, else 1). */
function keysGiven(amount: unknown): number {
  return isFiniteNumber(amount) && amount >= 0 ? Math.floor(amount) : 1;
}

/**
 * Small keys obtainable in a world (chests, pickups, shop, drops, trigger gifts). Amounts count
 * as given in play; checkItemAmount separately warns when one gift holds several keys.
 */
function smallKeysAvailable(world: World): number {
  let keys = 0;
  for (const room of world.rooms) {
    for (const e of room.entities) {
      if ((e.type === 'obj.chest' || e.type === 'obj.pickup' || e.type === 'obj.shopItem')
        && propStr(e, 'item') === 'smallKey') {
        keys += keysGiven(propOf<PropValue>(e, 'amount', 1));
      } else if (propStr(e, 'drop') === 'smallKey' || (e.type === 'obj.pot' && propStr(e, 'contents') === 'smallKey')) {
        keys++;
      }
    }
    for (const t of room.triggers) {
      for (const a of t.actions) if (a.kind === 'giveItem' && a.item === 'smallKey') keys += keysGiven(a.amount);
    }
  }
  return keys;
}

/** Locked doors in a world; linked door pairs count once. */
function lockedDoors(world: World): number {
  const links = new Set<string>();
  let unlinked = 0;
  for (const room of world.rooms) {
    for (const e of room.entities) {
      if (e.type !== 'obj.door' || propStr(e, 'kind') !== 'locked') continue;
      const link = propStr(e, 'link');
      if (link) links.add(link);
      else unlinked++;
    }
  }
  return links.size + unlinked;
}

function validateDungeonKeys(ctx: Ctx, world: World): void {
  if (world.kind !== 'dungeon') return;
  const doors = lockedDoors(world);
  const keys = smallKeysAvailable(world);
  if (doors > keys) {
    report(ctx, 'warning', `Dungeon "${world.name}" has ${doors} locked door(s) but only ${keys} small key(s).`, { world: world.id });
  }
}

function validateStart(ctx: Ctx): void {
  const s = ctx.p.start;
  if (!findWorld(ctx.p, s.world)) {
    report(ctx, 'error', `The start location uses a missing world "${s.world}".`);
    return;
  }
  const room = findRoom(ctx.p, s.world, s.room);
  const where = { world: s.world, room: s.room };
  if (!room) {
    report(ctx, 'error', `The start location uses a missing room "${s.room}".`, where);
    return;
  }
  if (!isFiniteNumber(s.x) || !isFiniteNumber(s.y) || s.x < 0 || s.y < 0
    || s.x >= roomCols(room) * TILE || s.y >= roomRows(room) * TILE) {
    report(ctx, 'error', `The start location (${s.x}, ${s.y}) is outside room "${room.name}".`, where);
    return;
  }
  const ground = unsafeGround(ctx, room, s.x, s.y);
  if (ground) report(ctx, 'warning', `The start location is on a ${ground} tile in room "${room.name}".`, where);
}

// ============================================================================
// Migration
// ============================================================================

type Obj = Record<string, unknown>;

function isObj(v: unknown): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function str(v: unknown, fallback: string): string {
  return typeof v === 'string' ? v : fallback;
}

/** Non-empty string or a fresh id. */
function idOr(v: unknown, prefix: string): string {
  return typeof v === 'string' && v ? v : newId(prefix);
}

function num(v: unknown, fallback: number): number {
  return isFiniteNumber(v) ? v : fallback;
}

function objects(v: unknown): Obj[] {
  return Array.isArray(v) ? v.filter(isObj) : [];
}

function strings(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

function oneOf<T extends string>(v: unknown, options: readonly string[], fallback: T): T {
  return typeof v === 'string' && options.includes(v) ? (v as T) : fallback;
}

/** A layer cell as a tile id: numbers and numeric strings are kept, anything else becomes 0. */
function cellId(x: unknown): number {
  const n = typeof x === 'string' && x.trim() !== '' ? Number(x) : x;
  return isFiniteNumber(n) && n >= 0 ? Math.floor(n) : 0;
}

/** Tile-id array of exactly `cols*rows` cells; re-laid-out if it matched the original room size. */
function migrateLayer(v: unknown, from: { cols: number; rows: number }, cols: number, rows: number): number[] {
  const src = (Array.isArray(v) ? v : []).map(cellId);
  if (src.length === from.cols * from.rows && (from.cols !== cols || from.rows !== rows)) {
    return resizeLayerData(src, from.cols, from.rows, cols, rows, 0);
  }
  const out = src.slice(0, cols * rows);
  while (out.length < cols * rows) out.push(0);
  return out;
}

/** Keys that must never be copied from a file onto a plain object (prototype setters). */
const UNSAFE_KEYS: ReadonlySet<string> = new Set(['__proto__', 'constructor', 'prototype']);

/** Own enumerable entries of a parsed JSON object, minus prototype-affecting keys. */
function safeEntries(o: Obj): [string, unknown][] {
  return Object.entries(o).filter(([k]) => !UNSAFE_KEYS.has(k));
}

/** Shallow copy without prototype-affecting keys (JSON.parse makes "__proto__" an own key; spreading it is unsafe). */
function plain(o: Obj): Obj {
  return Object.fromEntries(safeEntries(o));
}

function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback;
}

/** A warp target with only its known fields (null if it is not one). */
function warpOf(v: unknown): WarpTarget | null {
  if (!isWarpShape(v)) return null;
  const w: WarpTarget = { world: v.world, room: v.room, x: v.x, y: v.y };
  if (typeof v.dir === 'string' && DIRS.includes(v.dir)) w.dir = v.dir;
  return w;
}

/** A prop value as PropValue: primitives are kept, a warp object is cleaned, anything else is dropped. */
function propValue(v: unknown): PropValue | undefined {
  if (v === null || typeof v === 'string' || typeof v === 'boolean') return v;
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  return warpOf(v) ?? undefined;
}

function migrateEntity(o: Obj): EntityInstance {
  const type = str(o.type, '');
  const props: EntityInstance['props'] = defaultProps(type);
  if (isObj(o.props)) {
    for (const [k, v] of safeEntries(o.props)) {
      const value = propValue(v);
      if (value !== undefined) props[k] = value;
    }
  }
  return { id: idOr(o.id, 'e'), type, x: num(o.x, 0), y: num(o.y, 0), props };
}

/**
 * A trigger condition with only its kind's fields, type-checked. Unknown kinds are kept as a bare
 * `{ kind }` (the engine treats them as never holding, validation reports them): dropping a condition
 * would make its trigger fire more often than the author intended.
 */
function migrateCondition(o: Obj): Condition {
  const kind = str(o.kind, '');
  switch (kind) {
    case 'enemiesCleared':
    case 'torchesLit':
      return { kind };
    case 'switch':
      return { kind, target: str(o.target, ''), on: bool(o.on, true) };
    case 'flag':
      return { kind, flag: str(o.flag, ''), value: bool(o.value, true) };
    case 'hasItem':
      return { kind, item: str(o.item, '') as ItemId, min: num(o.min, 1) };
    case 'inRegion':
    case 'defeated':
    case 'blockPushed':
      return { kind, target: str(o.target, '') };
    default:
      return { kind: kind || 'unknown' } as unknown as Condition;
  }
}

/** A trigger action with only its kind's fields, type-checked; null (dropped) when it cannot run safely. */
function migrateAction(o: Obj): Action | null {
  const kind = str(o.kind, '');
  switch (kind) {
    case 'openDoor':
    case 'closeDoor':
    case 'showEntity':
    case 'hideEntity':
      return { kind, target: str(o.target, '') };
    case 'setFlag':
      return { kind, flag: str(o.flag, ''), value: bool(o.value, true) };
    case 'dialogue':
      return { kind, dialogue: str(o.dialogue, '') };
    case 'giveItem':
    case 'takeItem':
      return isItemId(o.item) ? { kind, item: o.item, amount: num(o.amount, 1) } : null;
    case 'setTile':
      if (typeof o.layer !== 'string' || !(LAYERS as readonly string[]).includes(o.layer)) return null;
      return {
        kind, layer: o.layer as LayerName, tx: Math.round(num(o.tx, 0)), ty: Math.round(num(o.ty, 0)), tile: cellId(o.tile),
      };
    case 'sound':
      return typeof o.sfx === 'string' && (SFX_IDS as readonly string[]).includes(o.sfx) ? { kind, sfx: o.sfx as SfxId } : null;
    case 'music':
      return isMusic(o.music, ['none']) ? { kind, music: o.music as MusicId | 'none' } : null;
    case 'secret':
      return { kind };
    case 'warp': {
      const target = warpOf(o.target);
      return target ? { kind, target } : null;
    }
    case 'heal':
      return { kind, amount: Math.max(0, num(o.amount, 2)) };
    case 'shake':
    case 'wait':
      return { kind, seconds: Math.max(0, num(o.seconds, 0)) };
    default:
      return null;
  }
}

function migrateTrigger(o: Obj): Trigger {
  const id = idOr(o.id, 't');
  const t: Trigger = {
    id,
    name: str(o.name, id),
    on: oneOf<TriggerOn>(o.on, TRIGGER_ONS, 'auto'),
    conditions: objects(o.conditions).map(migrateCondition),
    actions: objects(o.actions).map(migrateAction).filter((a): a is Action => a !== null),
    once: o.once === true,
  };
  if (typeof o.source === 'string' && o.source) t.source = o.source;
  return t;
}

function migrateRoom(o: Obj, index: number): Room {
  const gw = clampScreens(num(o.gw, 1));
  const gh = clampScreens(num(o.gh, 1));
  const cols = gw * SCREEN_COLS;
  const rows = gh * SCREEN_ROWS;
  const from = {
    cols: Math.max(1, Math.round(num(o.gw, gw))) * SCREEN_COLS,
    rows: Math.max(1, Math.round(num(o.gh, gh))) * SCREEN_ROWS,
  };
  const src = isObj(o.layers) ? o.layers : {};
  const layers = {} as Record<LayerName, number[]>;
  for (const layer of LAYERS) layers[layer] = migrateLayer(src[layer], from, cols, rows);
  const room: Room = {
    id: idOr(o.id, 'r'),
    name: str(o.name, `Room ${index + 1}`),
    gx: clamp(Math.round(num(o.gx, 0)), -MAX_GRID, MAX_GRID),
    gy: clamp(Math.round(num(o.gy, 0)), -MAX_GRID, MAX_GRID),
    gw,
    gh,
    floor: clamp(Math.round(num(o.floor, 0)), -MAX_FLOOR, MAX_FLOOR),
    layers,
    entities: objects(o.entities).map(migrateEntity),
    triggers: objects(o.triggers).map(migrateTrigger),
    music: isMusic(o.music, ['none', 'inherit']) ? (o.music as Room['music']) : 'inherit',
  };
  if (o.dark === true) room.dark = true;
  const pit = warpOf(o.pitTarget);
  if (pit) room.pitTarget = pit;
  return room;
}

function migrateWorld(o: Obj, index: number): World {
  const kind = oneOf<WorldKind>(o.kind, WORLD_KINDS, 'overworld');
  const world: World = {
    id: idOr(o.id, 'w'),
    name: str(o.name, `World ${index + 1}`),
    kind,
    music: isMusic(o.music, ['none']) ? (o.music as MusicId | 'none') : defaultWorldMusic(kind),
    rooms: objects(o.rooms).map(migrateRoom),
  };
  if (typeof o.prizeName === 'string' && o.prizeName.trim()) world.prizeName = o.prizeName;
  return world;
}

function migrateSettings(v: unknown, name: string): ProjectSettings {
  const d = defaultSettings(name);
  if (!isObj(v)) return d;
  const s: ProjectSettings = {
    title: str(v.title, d.title),
    subtitle: str(v.subtitle, d.subtitle),
    startHearts: clamp(Math.round(num(v.startHearts, d.startHearts)), 1, MAX_HEARTS),
    startItems: isObj(v.startItems)
      ? Object.fromEntries(Object.entries(v.startItems).filter(([k, n]) => isItemId(k) && isFiniteNumber(n)))
      : d.startItems,
    titleMusic: oneOf<MusicId>(v.titleMusic, MUSIC_IDS, d.titleMusic),
  };
  if (typeof v.introDialogue === 'string' && v.introDialogue) s.introDialogue = v.introDialogue;
  return s;
}

function migratePage(o: Obj): DialoguePage {
  const page: DialoguePage = { text: str(o.text, '').slice(0, MAX_PAGE_TEXT) };
  if (typeof o.speaker === 'string' && o.speaker) page.speaker = o.speaker;
  if (isObj(o.choice)) {
    page.choice = { options: strings(o.choice.options) };
    if (typeof o.choice.flag === 'string' && o.choice.flag) page.choice.flag = o.choice.flag;
  }
  return page;
}

function migrateDialogue(o: Obj): Dialogue {
  const id = idOr(o.id, 'd');
  return { id, name: str(o.name, id), pages: objects(o.pages).map(migratePage) };
}

function migrateFlags(v: unknown): FlagDef[] {
  const out: FlagDef[] = [];
  for (const f of Array.isArray(v) ? v : []) {
    if (typeof f === 'string') out.push({ name: f });
    else if (isObj(f) && typeof f.name === 'string') {
      out.push(typeof f.description === 'string' ? { name: f.name, description: f.description } : { name: f.name });
    }
  }
  return out;
}

/** Pixel frames: strings only, lower-cased hex. */
function frames(v: unknown): string[] {
  return strings(v).map((f) => f.toLowerCase());
}

/** A tile behaviour ({ to, ... }) with a valid target tile id; undefined when absent or malformed. */
function behaviour(v: unknown, lift: boolean): Obj | undefined {
  if (!isObj(v)) return undefined;
  const b: Obj = { to: cellId(v.to) };
  if (lift) b.weight = clamp(Math.round(num(v.weight, 0)), 0, 2);
  if (typeof v.drops === 'boolean') b.drops = v.drops;
  return b;
}

function migrateTile(o: Obj): TileDef {
  const key = str(o.key, `TILE_${String(o.id)}`);
  const t = {
    ...plain(o),
    key,
    name: str(o.name, key),
    frames: frames(o.frames),
    collision: oneOf<Collision>(o.collision, COLLISIONS, 'floor'),
    tags: strings(o.tags),
  } as TileDef & Obj;
  for (const name of ['cut', 'lift', 'bomb', 'dash'] as const) {
    const b = behaviour(o[name], name === 'lift');
    if (b) t[name] = b as never;
    else delete t[name];
  }
  return t;
}

function migrateAnim(o: Obj): SpriteAnim {
  const anim: SpriteAnim = {
    frames: Array.isArray(o.frames) ? o.frames.filter(isFiniteNumber) : [],
    fps: num(o.fps, 8),
    loop: o.loop !== false,
  };
  if (typeof o.flipX === 'boolean') anim.flipX = o.flipX;
  return anim;
}

/** A frame edge: a whole number of px in 1..MAX_SPRITE_SIZE (the rasteriser cannot draw anything else). */
function spriteSize(v: unknown): number {
  return clamp(Math.round(num(v, TILE)), 1, MAX_SPRITE_SIZE);
}

function migrateSprite(o: Obj): SpriteDef {
  const id = idOr(o.id, 's');
  const w = spriteSize(o.w);
  const h = spriteSize(o.h);
  const anims = isObj(o.anims)
    ? Object.fromEntries(safeEntries(o.anims).filter((kv): kv is [string, Obj] => isObj(kv[1])).map(([k, a]) => [k, migrateAnim(a)]))
    : {};
  return {
    ...plain(o),
    id,
    name: str(o.name, id),
    palette: str(o.palette, ''),
    w,
    h,
    ox: num(o.ox, Math.floor(w / 2)),
    oy: num(o.oy, Math.floor(h / 2)),
    frames: frames(o.frames),
    anims,
    tags: strings(o.tags),
  };
}

function migrateTerrain(o: Obj): Terrain {
  const id = idOr(o.id, 'terrain');
  const terrain = { id, name: str(o.name, id), layer: oneOf<LayerName>(o.layer, LAYERS, 'bg') } as Terrain;
  for (const piece of TERRAIN_PIECES) terrain[piece] = cellId(o[piece]);
  return terrain;
}

const HEX6 = /^#?([0-9a-f]{6})$/i;
const HEX3 = /^#?([0-9a-f])([0-9a-f])([0-9a-f])$/i;

/**
 * A palette colour as lowercase "#rrggbb" ("#rgb" and a missing '#' are accepted); anything else is
 * black. Colours reach CSS in the editor, so a value such as url(...) must never survive import.
 */
export function normalizeHexColor(v: unknown): string {
  if (typeof v !== 'string') return '#000000';
  const s = v.trim();
  const m6 = HEX6.exec(s);
  if (m6) return `#${m6[1]!.toLowerCase()}`;
  const m3 = HEX3.exec(s);
  if (m3) return `#${m3[1]}${m3[1]}${m3[2]}${m3[2]}${m3[3]}${m3[3]}`.toLowerCase();
  return '#000000';
}

function migratePalette(o: Obj): Palette {
  const raw = Array.isArray(o.colors) ? o.colors : [];
  return {
    ...plain(o),
    id: idOr(o.id, 'pal'),
    name: str(o.name, str(o.id, 'Palette')),
    colors: Array.from({ length: PALETTE_SIZE }, (_, i) => normalizeHexColor(raw[i])),
  } as Palette;
}

function migrateStart(v: unknown, worlds: World[]): WarpTarget {
  if (isObj(v) && typeof v.world === 'string' && typeof v.room === 'string') {
    const start: WarpTarget = { world: v.world, room: v.room, x: num(v.x, SCREEN_W / 2), y: num(v.y, SCREEN_H / 2) };
    if (typeof v.dir === 'string' && DIRS.includes(v.dir)) start.dir = v.dir as Dir;
    return start;
  }
  const world = worlds.find((w) => w.rooms.length > 0) ?? worlds[0];
  return { world: world?.id ?? '', room: world?.rooms[0]?.id ?? '', x: SCREEN_W / 2, y: SCREEN_H / 2, dir: 'down' };
}

/**
 * Append the default entries whose built-in ids are missing from `list` (a partial or older file):
 * the engine draws built-ins by id and the art editor cannot recreate them. Built-in ids never
 * collide with user ids (user tiles start at USER_TILE_BASE; sprite ids are distinct strings).
 * Default assets are only generated when something is actually missing. Returns true if it added any.
 */
function restoreBuiltins<T, K>(list: T[], key: (v: T) => K, builtins: ReadonlySet<K>, defaults: () => T[]): boolean {
  const have = new Set(list.map(key));
  if ([...builtins].every((k) => have.has(k))) return false;
  let added = false;
  for (const d of defaults()) {
    const k = key(d);
    if (builtins.has(k) && !have.has(k)) {
      list.push(d);
      have.add(k);
      added = true;
    }
  }
  return added;
}

/**
 * Append missing default palettes that something still references (a tile, a sprite, a palette swap
 * or an entity icon). Unreferenced default palettes stay deleted if the author removed them.
 */
function restorePalettes(palettes: Palette[], tiles: TileDef[], sprites: SpriteDef[], assets: () => DefaultAssets): void {
  const have = new Set(palettes.map((p) => p.id));
  const wanted = new Set<string>(ENGINE_PALETTE_IDS);
  for (const t of tiles) if (typeof t.palette === 'string') wanted.add(t.palette);
  for (const s of sprites) wanted.add(s.palette);
  if ([...wanted].every((id) => have.has(id))) return;
  for (const p of assets().palettes) {
    if (wanted.has(p.id) && !have.has(p.id)) {
      palettes.push(p);
      have.add(p.id);
    }
  }
}

/**
 * Accept any older/partial project JSON value and return a current-version Project (fills defaults).
 * Throws if not a project, or if it was saved by a newer Questforge (its data could be lost).
 */
export function migrateProject(raw: unknown): Project {
  if (!isObj(raw)) throw new Error('This is not a Questforge project (expected a JSON object).');
  if (raw.format !== undefined && raw.format !== PROJECT_FORMAT) {
    throw new Error(`This is not a Questforge project (its format is "${String(raw.format)}").`);
  }
  if (raw.format === undefined && !Array.isArray(raw.worlds)) {
    throw new Error('This is not a Questforge project (it has no "format" or "worlds").');
  }
  if (isFiniteNumber(raw.version) && raw.version > PROJECT_VERSION) {
    throw new Error(`This project was made with a newer version of Questforge (format v${raw.version}); update the app to open it.`);
  }
  let src: Obj;
  try {
    src = structuredClone(raw);
  } catch {
    throw new Error('This project contains data that is not plain JSON.');
  }
  let defaults: DefaultAssets | undefined;
  const assets = (): DefaultAssets => (defaults ??= createDefaultAssets());
  const name = str(src.name, 'Untitled');
  const tiles = Array.isArray(src.tiles) ? objects(src.tiles).map(migrateTile) : assets().tiles;
  if (restoreBuiltins(tiles, (t) => t.id, BUILTIN_TILE_IDS, () => assets().tiles)) {
    tiles.sort((a, b) => (typeof a.id === 'number' && typeof b.id === 'number' ? a.id - b.id : 0));
  }
  const tileIds = new Set(tiles.map((t) => t.id));
  const sprites = Array.isArray(src.sprites) ? objects(src.sprites).map(migrateSprite) : assets().sprites;
  restoreBuiltins(sprites, (s) => s.id, BUILTIN_SPRITE_IDS, () => assets().sprites);
  const palettes = Array.isArray(src.palettes) ? objects(src.palettes).map(migratePalette) : assets().palettes;
  restorePalettes(palettes, tiles, sprites, assets);
  const worlds = objects(src.worlds).map(migrateWorld);
  const now = Date.now();
  return {
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    id: idOr(src.id, 'p'),
    name,
    author: str(src.author, ''),
    description: str(src.description, ''),
    created: num(src.created, now),
    modified: num(src.modified, now),
    settings: migrateSettings(src.settings, name),
    palettes,
    tiles,
    terrains: Array.isArray(src.terrains)
      ? objects(src.terrains).map(migrateTerrain)
      : assets().terrains.filter((tr) => TERRAIN_PIECES.every((k) => tileIds.has(tr[k]))),
    sprites,
    worlds,
    dialogues: objects(src.dialogues).map(migrateDialogue),
    flags: migrateFlags(src.flags),
    start: migrateStart(src.start, worlds),
  };
}
