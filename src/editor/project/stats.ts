// Pure summaries for the Project tab: per-world counts, project totals and
// where a validation problem points to. No DOM, unit-tested.
import type { EntityInstance, Project, PropValue, World, WorldKind } from '../../core/types';
import type { Problem } from '../../core/validate';
import { entityInfo, propOf } from '../../core/catalog';
import { findEntityInstance, findWorld, locateRoom, USER_TILE_BASE } from '../../core/project';

/** One row of the worlds summary. */
export interface WorldSummary {
  id: string;
  name: string;
  kind: WorldKind;
  rooms: number;
  screens: number;
  entities: number;
  /** Small keys obtainable in the world (chests, pickups, shop, drops, trigger gifts). */
  smallKeys: number;
  /** Locked doors; linked pairs count once. */
  lockedDoors: number;
  chests: number;
  bigKey: boolean;
  boss: boolean;
}

/** Project-wide totals. */
export interface ProjectStats {
  worlds: number;
  rooms: number;
  screens: number;
  entities: number;
  enemies: number;
  npcs: number;
  objects: number;
  pickups: number;
  triggers: number;
  dialogues: number;
  dialoguePages: number;
  tiles: number;
  customTiles: number;
  sprites: number;
  palettes: number;
  terrains: number;
  flags: number;
}

/** Where a validation problem can be shown. */
export type ProblemTarget =
  | { tab: 'map'; world: string; room: string | null; entity?: string; trigger?: string }
  | { tab: 'dialogue'; dialogue: string }
  | { tab: 'art'; tile?: number }
  | { tab: 'project'; section: 'start' | 'intro' }
  | null;

/** How validateProject words every start-location problem (they carry no marker of their own). */
const START_PROBLEM = /^The start location\b/;

const KEY_CONTAINERS: ReadonlySet<string> = new Set(['obj.chest', 'obj.pickup', 'obj.shopItem']);

function str(e: EntityInstance, key: string): string {
  return String(propOf<PropValue>(e, key, ''));
}

/** Keys granted by one gift (mirrors play: a whole amount >= 0, otherwise 1). */
function giftAmount(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 1;
}

function entityKeys(e: EntityInstance): number {
  if (KEY_CONTAINERS.has(e.type) && str(e, 'item') === 'smallKey') return giftAmount(propOf<PropValue>(e, 'amount', 1));
  if (str(e, 'drop') === 'smallKey') return 1;
  return e.type === 'obj.pot' && str(e, 'contents') === 'smallKey' ? 1 : 0;
}

/** Counts for one world. */
export function summarizeWorld(world: World): WorldSummary {
  const s: WorldSummary = {
    id: world.id, name: world.name, kind: world.kind, rooms: world.rooms.length, screens: 0, entities: 0,
    smallKeys: 0, lockedDoors: 0, chests: 0, bigKey: false, boss: false,
  };
  const links = new Set<string>();
  for (const room of world.rooms) {
    s.screens += room.gw * room.gh;
    s.entities += room.entities.length;
    for (const e of room.entities) {
      s.smallKeys += entityKeys(e);
      if (e.type === 'obj.chest') s.chests++;
      if (KEY_CONTAINERS.has(e.type) && str(e, 'item') === 'bigKey') s.bigKey = true;
      if (entityInfo(e.type)?.category === 'boss') s.boss = true;
      if (e.type === 'obj.door' && str(e, 'kind') === 'locked') {
        const link = str(e, 'link');
        if (link) links.add(link);
        else s.lockedDoors++;
      }
    }
    for (const t of room.triggers) {
      for (const a of t.actions) {
        if (a.kind !== 'giveItem') continue;
        if (a.item === 'smallKey') s.smallKeys += giftAmount(a.amount);
        if (a.item === 'bigKey') s.bigKey = true;
      }
    }
  }
  s.lockedDoors += links.size;
  return s;
}

/** Totals across the whole project. */
export function projectStats(p: Project): ProjectStats {
  const s: ProjectStats = {
    worlds: p.worlds.length, rooms: 0, screens: 0, entities: 0, enemies: 0, npcs: 0, objects: 0, pickups: 0,
    triggers: 0, dialogues: p.dialogues.length, dialoguePages: 0, tiles: p.tiles.length,
    customTiles: p.tiles.filter((t) => t.id >= USER_TILE_BASE).length, sprites: p.sprites.length,
    palettes: p.palettes.length, terrains: p.terrains.length, flags: p.flags.length,
  };
  for (const d of p.dialogues) s.dialoguePages += d.pages.length;
  for (const world of p.worlds) {
    for (const room of world.rooms) {
      s.rooms++;
      s.screens += room.gw * room.gh;
      s.triggers += room.triggers.length;
      s.entities += room.entities.length;
      for (const e of room.entities) {
        const cat = entityInfo(e.type)?.category;
        if (cat === 'enemy' || cat === 'boss') s.enemies++;
        else if (cat === 'npc') s.npcs++;
        else if (cat === 'object') s.objects++;
        else if (cat === 'pickup') s.pickups++;
      }
    }
  }
  return s;
}

/** Problems split by severity (errors first), keeping their original order. */
export function groupProblems(problems: readonly Problem[]): { errors: Problem[]; warnings: Problem[] } {
  return {
    errors: problems.filter((x) => x.level === 'error'),
    warnings: problems.filter((x) => x.level === 'warning'),
  };
}

/** Rows a validation group lists before the rest are summed up ("and N more"): a broken import can report thousands. */
export const MAX_PROBLEM_ROWS = 100;

/** The first `max` items and how many were left out. */
export function capRows<T>(list: readonly T[], max = MAX_PROBLEM_ROWS): { shown: T[]; more: number } {
  const n = Math.max(0, Math.floor(max));
  return { shown: list.slice(0, n), more: Math.max(0, list.length - n) };
}

/** The editor location that shows a problem, or null when there is nothing to jump to. */
export function problemTarget(p: Project, problem: Problem): ProblemTarget {
  // Fixed from the Start location panel ("Pick on map"), not by looking at a room.
  if (START_PROBLEM.test(problem.message)) return { tab: 'project', section: 'start' };
  const w = problem.where;
  if (!w) return null;
  if (w.entity) {
    const found = findEntityInstance(p, w.entity);
    if (found) return { tab: 'map', world: found.world.id, room: found.room.id, entity: w.entity };
  }
  if (w.room) {
    const world = w.world && findWorld(p, w.world)?.rooms.some((r) => r.id === w.room) ? w.world : locateRoom(p, w.room)?.world.id;
    if (world) return w.trigger ? { tab: 'map', world, room: w.room, trigger: w.trigger } : { tab: 'map', world, room: w.room };
  }
  // A missing intro dialogue is fixed by the Intro dialogue setting: there is nothing to open on the Dialogue tab.
  if (w.dialogue && w.dialogue === p.settings.introDialogue && !p.dialogues.some((d) => d.id === w.dialogue)) {
    return { tab: 'project', section: 'intro' };
  }
  if (w.dialogue) return { tab: 'dialogue', dialogue: w.dialogue };
  if (w.world && findWorld(p, w.world)) return { tab: 'map', world: w.world, room: findWorld(p, w.world)?.rooms[0]?.id ?? null };
  if (w.tile !== undefined) return { tab: 'art', tile: w.tile };
  if (w.sprite !== undefined || w.palette !== undefined) return { tab: 'art' };
  return null;
}
