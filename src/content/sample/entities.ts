// Entity, warp and trigger factories for the sample adventure. Positions are
// given in tiles (placed at the tile centre) unless a name says otherwise.
import type {
  Action, Condition, Dir, EntityInstance, ItemId, PropValue, Trigger, TriggerOn, WarpTarget,
} from '../../core/types';
import type { DropKind } from '../ids';
import { defaultProps } from '../../core/catalog';
import { TILE } from '../../core/constants';

/** Pixel centre of tile `t`. */
export function px(t: number): number {
  return t * TILE + TILE / 2;
}

/** Instance with the catalog defaults merged under `props` (pixel position). */
export function ent(id: string, type: string, x: number, y: number, props: Record<string, PropValue> = {}): EntityInstance {
  return { id, type, x, y, props: { ...defaultProps(type), ...props } };
}

/**
 * The same entity moved half a tile right (and half a tile down with `down`): centred
 * on the seam between its tile and the next, or on the 2x2 block its tile starts.
 */
export function centred(e: EntityInstance, down = false): EntityInstance {
  return { ...e, x: e.x + TILE / 2, y: down ? e.y + TILE / 2 : e.y };
}

/** Warp destination at a tile centre. */
export function spot(world: string, room: string, tx: number, ty: number, dir: Dir): WarpTarget {
  return { world, room, x: px(tx), y: px(ty), dir };
}

/** Small chest (opened from below); `hidden` ones appear through a showEntity trigger. */
export function chest(id: string, tx: number, ty: number, item: ItemId, amount: number, hidden = false): EntityInstance {
  return ent(id, 'obj.chest', px(tx), px(ty), { item, amount, big: false, hidden });
}

/** Big chest covering tiles tx and tx+1. */
export function bigChest(id: string, tx: number, ty: number, item: ItemId, amount: number): EntityInstance {
  return ent(id, 'obj.chest', (tx + 1) * TILE, px(ty), { item, amount, big: true, hidden: false });
}

/** Placed item on the ground (collected once). */
export function pickup(id: string, tx: number, ty: number, item: ItemId, amount: number): EntityInstance {
  return ent(id, 'obj.pickup', px(tx), px(ty), { item, amount });
}

/** Look, name, words and movement of a townsperson. */
export interface NpcOpts {
  sprite: string;
  name: string;
  dialogue?: string;
  behavior?: 'still' | 'wander' | 'pace';
  facing?: Dir;
  hidden?: boolean;
}

/** A townsperson (npc.person). */
export function npc(id: string, tx: number, ty: number, o: NpcOpts): EntityInstance {
  return ent(id, 'npc.person', px(tx), px(ty), {
    sprite: o.sprite, name: o.name, dialogue: o.dialogue ?? '', behavior: o.behavior ?? 'still',
    facing: o.facing ?? 'down', hidden: o.hidden ?? false,
  });
}

/** A readable sign (read from below); `hidden` ones appear through a showEntity trigger. */
export function sign(id: string, tx: number, ty: number, dialogue: string, hidden = false): EntityInstance {
  return ent(id, 'obj.sign', px(tx), px(ty), { dialogue, hidden });
}

/** Any enemy or boss type, with its props. */
export function enemy(id: string, type: string, tx: number, ty: number, props: Record<string, PropValue> = {}): EntityInstance {
  return ent(id, type, px(tx), px(ty), props);
}

/** obj.door kinds. */
export type DoorKind = 'locked' | 'bigKey' | 'shutter' | 'bombable' | 'open';

/** Door link and shutter rules. */
export interface DoorOpts {
  link?: string;
  opensWhen?: 'trigger' | 'enemiesCleared' | 'never';
  closeOnEnter?: boolean;
}

/** Door centred on the 2-tile doorway of a one-screen room's `dir` wall. */
export function door(id: string, dir: Dir, kind: DoorKind, o: DoorOpts = {}): EntityInstance {
  const at: Record<Dir, [number, number]> = {
    up: [8 * TILE, TILE / 2], down: [8 * TILE, 13 * TILE + TILE / 2],
    left: [TILE / 2, 7 * TILE], right: [15 * TILE + TILE / 2, 7 * TILE],
  };
  const [x, y] = at[dir];
  return ent(id, 'obj.door', x, y, {
    dir, kind, link: o.link ?? '', opensWhen: o.opensWhen ?? 'trigger', closeOnEnter: o.closeOnEnter ?? false,
  });
}

/** Warp zone size (tiles), sound, transition and respawn behaviour. */
export interface WarpOpts {
  w?: number;
  h?: number;
  sound?: 'stairs' | 'door' | 'none';
  transition?: 'fade' | 'iris' | 'none';
  setRespawn?: boolean;
}

/** Invisible warp zone centred at pixel (x, y), `w` x `h` tiles. */
export function warp(id: string, x: number, y: number, target: WarpTarget, o: WarpOpts = {}): EntityInstance {
  return ent(id, 'marker.warp', x, y, {
    target, transition: o.transition ?? 'fade', sound: o.sound ?? 'stairs',
    w: o.w ?? 1, h: o.h ?? 1, setRespawn: o.setRespawn ?? true,
  });
}

/** Brazier; `burnTime` > 0 makes a lit torch go out again. */
export function torch(id: string, tx: number, ty: number, lit = false, burnTime = 0): EntityInstance {
  return ent(id, 'obj.torch', px(tx), px(ty), { lit, burnTime });
}

/** Push block; 'once' blocks lock after one push, `dir` limits the push direction. */
export function block(id: string, tx: number, ty: number, pushes: 'once' | 'free', dir: Dir | 'any' = 'any'): EntityInstance {
  return ent(id, 'obj.block', px(tx), px(ty), { pushes, dir, heavy: false });
}

/** Floor switch pressed by the hero or a block/pot. */
export function floorSwitch(id: string, tx: number, ty: number, mode: 'once' | 'hold' | 'toggle'): EntityInstance {
  return ent(id, 'obj.switch', px(tx), px(ty), { mode });
}

/** Colour peg (raised when its colour is active). */
export function peg(id: string, tx: number, ty: number, color: 'red' | 'blue'): EntityInstance {
  return ent(id, 'obj.peg', px(tx), px(ty), { color });
}

/** Liftable pot with fixed contents (respawns on every visit). */
export function pot(id: string, tx: number, ty: number, contents: DropKind): EntityInstance {
  return ent(id, 'obj.pot', px(tx), px(ty), { contents });
}

/** Shop item bought with the action button. */
export function shopItem(id: string, tx: number, ty: number, item: ItemId, amount: number, price: number): EntityInstance {
  return ent(id, 'obj.shopItem', px(tx), px(ty), { item, amount, price });
}

/** once / talk source of a trigger. */
export interface TriggerOpts {
  once?: boolean;
  source?: string;
}

/** Room trigger. */
export function trigger(
  id: string, name: string, on: TriggerOn, conditions: Condition[], actions: Action[], o: TriggerOpts = {},
): Trigger {
  const t: Trigger = { id, name, on, conditions, actions, once: o.once ?? false };
  if (o.source) t.source = o.source;
  return t;
}
