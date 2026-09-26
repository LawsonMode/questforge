// Inline inspector warnings for a placed entity (pure: no DOM): dangling
// references, unreachable setups and misconfigured puzzle pieces.
import type { Dir, EntityInstance, ItemId, Project, PropValue, Room, World } from '../../core/types';
import { entityInfo, footprint, propOf, type PropSchema } from '../../core/catalog';
import { findRoom, neighborRoom, roomCols, roomRows } from '../../core/project';
import { DIRS, OPPOSITE } from '../../core/math';
import { ITEM_INFO } from '../../content/ids';
import { SCREEN_H, SCREEN_W, TILE } from '../../core/constants';
import { forEachRoom } from './refs';
import { asWarpTarget, entityLabel, itemName } from './labels';

/** Items that only make sense inside a dungeon world (tracked per dungeon). */
function dungeonOnly(item: string): boolean {
  const kind = ITEM_INFO[item as ItemId]?.kind;
  return kind === 'dungeon' || kind === 'prize';
}

function propWarning(p: Project, world: World, room: Room, s: PropSchema, v: PropValue): string | null {
  switch (s.kind) {
    case 'dialogue':
      return typeof v === 'string' && v && !p.dialogues.some((d) => d.id === v) ? `${s.label}: the dialogue no longer exists.` : null;
    case 'entity':
      return typeof v === 'string' && v && !room.entities.some((e) => e.id === v) ? `${s.label}: entity ${v} is not in this room.` : null;
    case 'warp': {
      const t = asWarpTarget(v);
      if (!t) return `${s.label}: no destination yet. Use “Pick on map”.`;
      return findRoom(p, t.world, t.room) ? null : `${s.label}: the destination room no longer exists.`;
    }
    case 'item':
      return typeof v === 'string' && dungeonOnly(v) && world.kind !== 'dungeon'
        ? `${s.label}: ${itemName(v)} only works inside a dungeon world.` : null;
    default:
      return null;
  }
}

// ---------------------------------------------------------------- doors

function doorWall(inst: EntityInstance): Dir {
  const d = propOf<PropValue>(inst, 'dir', 'up');
  return DIRS.includes(d as Dir) ? (d as Dir) : 'up';
}

function doorLink(inst: EntityInstance): string {
  return String(propOf<PropValue>(inst, 'link', '')).trim();
}

/** A shutter that starts open and shuts behind the player. */
function closesOnEnter(inst: EntityInstance): boolean {
  return propOf<PropValue>(inst, 'kind', 'locked') === 'shutter' && propOf<PropValue>(inst, 'closeOnEnter', false) === true;
}

/** Whether the door can be shut when the player walks in through its doorway (unless its flag is set). */
function closable(inst: EntityInstance): boolean {
  return propOf<PropValue>(inst, 'kind', 'locked') !== 'open' && !closesOnEnter(inst);
}

/** Number of doors in the whole project sharing `link` (including `self`). */
function doorsWithLink(p: Project, link: string): number {
  let n = 0;
  forEachRoom(p, (_w, room) => {
    for (const e of room.entities) if (e.type === 'obj.door' && doorLink(e) === link) n++;
  });
  return n;
}

/** Doors in the whole project that can be shut and share `link` (including `self`). */
function closableDoorsWithLink(p: Project, link: string): number {
  let n = 0;
  forEachRoom(p, (_w, room) => {
    for (const e of room.entities) if (e.type === 'obj.door' && closable(e) && doorLink(e) === link) n++;
  });
  return n;
}

/** World-grid px of a door centre along its wall (x for top/bottom walls, y for side walls). */
function alongWall(room: Room, inst: EntityInstance, wall: Dir): number {
  return wall === 'up' || wall === 'down' ? room.gx * SCREEN_W + inst.x : room.gy * SCREEN_H + inst.y;
}

/** Whether the door sits on the edge of the room its wall names (not on an inner wall). */
function onRoomEdge(room: Room, inst: EntityInstance, wall: Dir): boolean {
  switch (wall) {
    case 'up': return inst.y <= TILE;
    case 'down': return inst.y >= roomRows(room) * TILE - TILE;
    case 'left': return inst.x <= TILE;
    case 'right': return inst.x >= roomCols(room) * TILE - TILE;
  }
}

/**
 * The door on the far side of `inst`'s doorway: a door on the facing wall of the
 * neighbouring room across `inst`'s wall, within a tile of the mirrored position.
 */
export function matchingDoor(world: World, room: Room, inst: EntityInstance): { room: Room; door: EntityInstance } | undefined {
  const wall = doorWall(inst);
  if (!onRoomEdge(room, inst, wall)) return undefined;
  const next = neighborRoom(world, room, wall, wall === 'up' || wall === 'down' ? inst.x : inst.y);
  if (!next || next === room) return undefined;
  const at = alongWall(room, inst, wall);
  const facing = OPPOSITE[wall];
  let best: EntityInstance | undefined;
  let bestDist = TILE;
  for (const e of next.entities) {
    if (e.type !== 'obj.door' || doorWall(e) !== facing || !onRoomEdge(next, e, facing)) continue;
    const dist = Math.abs(alongWall(next, e, facing) - at);
    if (dist <= bestDist) {
      best = e;
      bestDist = dist;
    }
  }
  return best ? { room: next, door: best } : undefined;
}

/**
 * Doors that can both be shut must share a Link, or the player who opens one
 * walks into the other still closed. A close-on-enter shutter must not share
 * one: once any door with its link opens it spawns open and never shuts. A
 * locked door's link is for the two sides of one doorway: shared by more
 * doors (or by two in one room, e.g. a duplicated door) one key opens them all.
 */
function linkWarning(p: Project, world: World, room: Room, inst: EntityInstance): string | null {
  const link = doorLink(inst);
  if (closesOnEnter(inst)) {
    return link && doorsWithLink(p, link) > 1
      ? `Shares link “${link}” with another door: once that door opens, this close-on-enter shutter starts open and never shuts behind the player.`
      : null;
  }
  if (!closable(inst)) return null;
  if (link && propOf<PropValue>(inst, 'kind', 'locked') === 'locked') {
    const sharing = closableDoorsWithLink(p, link) - 1;
    const sameRoom = room.entities.some((e) => e !== inst && e.type === 'obj.door' && closable(e) && doorLink(e) === link);
    if (sharing > 1 || sameRoom) {
      return `Shares link “${link}” with ${sharing} other door${sharing === 1 ? '' : 's'}: one small key opens all of them. A link is meant for the two sides of one doorway.`;
    }
  }
  const far = matchingDoor(world, room, inst);
  if (!far || !closable(far.door)) return null;
  const farLink = doorLink(far.door);
  const where = `${entityLabel(far.door)} in ${far.room.name || far.room.id}`;
  if (!link) return `No link: the door on the other side (${where}) opens separately. Give both the same Link so opening one opens the other.`;
  if (farLink !== link) {
    return `The door on the other side (${where}) uses ${farLink ? `link “${farLink}”` : 'no link'}, so it stays shut when this one opens. Give both the same Link.`;
  }
  return null;
}

function doorWarnings(p: Project, world: World, room: Room, inst: EntityInstance): string[] {
  const out: string[] = [];
  const linkMsg = linkWarning(p, world, room, inst);
  if (linkMsg) out.push(linkMsg);
  if (propOf<PropValue>(inst, 'kind', 'locked') === 'shutter' && propOf<PropValue>(inst, 'opensWhen', 'trigger') === 'trigger') {
    const opened = room.triggers.some((t) => t.actions.some((a) => a.kind === 'openDoor' && a.target === inst.id));
    // A door sharing the link (e.g. one a trigger opens in the next room) can open it too.
    const link = doorLink(inst);
    const linked = link !== '' && doorsWithLink(p, link) > 1;
    if (!opened && !linked) out.push('This shutter opens by trigger, but no trigger in this room opens it.');
  }
  return out;
}

function typeWarnings(p: Project, world: World, room: Room, inst: EntityInstance): string[] {
  switch (inst.type) {
    case 'obj.door':
      return doorWarnings(p, world, room, inst);
    case 'obj.chest':
      return propOf(inst, 'big', false) && world.kind !== 'dungeon'
        ? ['Big chests open with a dungeon Big Key; outside a dungeon this one can never be opened.'] : [];
    case 'npc.person': {
      const talks = room.triggers.some((t) => t.on === 'talk' && t.source === inst.id);
      return !propOf(inst, 'dialogue', '') && !talks ? ['Says nothing: pick a dialogue or add a “talk” trigger for this person.'] : [];
    }
    case 'obj.sign':
      return !propOf(inst, 'dialogue', '') && !String(propOf<PropValue>(inst, 'text', '')).trim() ? ['Blank sign: give it a dialogue or some text.'] : [];
    default:
      return [];
  }
}

/** Warnings for one placed entity (empty = looks fine). */
export function entityWarnings(p: Project, world: World, room: Room, inst: EntityInstance): string[] {
  const info = entityInfo(inst.type);
  if (!info) return [`Unknown entity type “${inst.type}”: the game will skip it.`];
  const out: string[] = [];
  const { w, h } = footprint(inst);
  const roomW = roomCols(room) * TILE;
  const roomH = roomRows(room) * TILE;
  if (inst.x + w / 2 <= 0 || inst.y + h / 2 <= 0 || inst.x - w / 2 >= roomW || inst.y - h / 2 >= roomH) {
    out.push('Outside the room: the player can never reach it.');
  }
  for (const s of info.props) {
    const msg = propWarning(p, world, room, s, propOf<PropValue>(inst, s.key, s.default));
    if (msg) out.push(msg);
  }
  out.push(...typeWarnings(p, world, room, inst));
  if (propOf<PropValue>(inst, 'hidden', false) === true) {
    const shown = room.triggers.some((t) => t.actions.some((a) => a.kind === 'showEntity' && a.target === inst.id));
    if (!shown) out.push('Hidden, but no trigger in this room shows it (add a “Show entity” action).');
  }
  return out;
}
