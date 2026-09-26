// obj.door — a 2-tile doorway on a room wall (x, y = its centre on the wall row;
// hitbox = the whole doorway). Solid while closed. Kinds:
//   locked    walking into it (facing it) with a small key: key used, sfx unlock, opens
//   bigKey    same, needs the dungeon big key (not consumed)
//   shutter   opensWhen 'enemiesCleared' / 'trigger' (setOpen) / 'never';
//             closeOnEnter: starts open and shuts once the hero is 24 px inside
//   bombable  looks like cracked wall; a bomb hit blows it open (sfx secret)
//   open      frame only, never solid
// Opening any door persists flag door:<link || id>; doors check it on spawn, so
// both sides of a link open together and nothing soft-locks. The doorway's cells
// are made walkable on spawn (walls painted under a door would block it forever);
// two solid jambs at its ends keep the stone frame solid, so an open doorway is
// passed through its middle like the opening drawn in the art. Opening/closing
// slides the door panel into the wall over 0.15 s. OWNER: objects agent.
import type { Dir, EntityInstance, SfxId } from '../../../core/types';
import type { GameServices, Hit, Renderer, RoomRuntime } from '../../api';
import { DIR_VEC, OPPOSITE, type Rect, type Vec, rectsOverlap } from '../../../core/math';
import { TILE } from '../../../core/constants';
import { T } from '../../../content/ids';
import { registerEntity } from '../../registry';
import { Companion, ObjectEntity, frontProbe } from './base';

export type DoorKind = 'locked' | 'bigKey' | 'shutter' | 'bombable' | 'open';
export type ShutterRule = 'trigger' | 'enemiesCleared' | 'never';

const KINDS: readonly DoorKind[] = ['locked', 'bigKey', 'shutter', 'bombable', 'open'];
const RULES: readonly ShutterRule[] = ['trigger', 'enemiesCleared', 'never'];
const DIRS: readonly Dir[] = ['up', 'down', 'left', 'right'];
/** Seconds the panel takes to slide open or shut. */
export const DOOR_SLIDE_TIME = 0.15;
/** A closeOnEnter shutter shuts once the hero's centre is this far (px) past the doorway. */
export const CLOSE_DEPTH = 24;
/** How far in front of the hero (px) a locked door counts as "walked into". */
const BUMP_REACH = 2;
/**
 * Width (px) of the solid stone jamb at each end of a doorway: 32 - 2 * 6 leaves
 * a 20 px passage, 1 px wider per side than the 18 px opening drawn in the art.
 */
export const JAMB = 6;
/** Tile collisions a carved doorway may copy as its floor. */
const FLOORS: ReadonlySet<string> = new Set(['floor', 'stairs', 'shallow']);

/** Save flag shared by every door with the same link (or this door alone). */
export function doorFlag(id: string, link: string): string {
  return `door:${link.trim() || id}`;
}

/** Sprite id for a door on wall `dir`. */
export function doorSprite(dir: Dir): string {
  return dir === 'left' || dir === 'right' ? 'obj.doorEW' : 'obj.doorNS';
}

/** Anim name: cracked/bombed for bombable doors, open_<dir> for every other opened door. */
export function doorAnim(kind: DoorKind, dir: Dir, open: boolean): string {
  if (kind === 'bombable') return `${open ? 'bombed' : 'cracked'}_${dir}`;
  return `${open || kind === 'open' ? 'open' : kind}_${dir}`;
}

/** How far (px) a point lies inside the room past the doorway's room-side edge (<= 0: in or behind it). */
export function depthInside(dir: Dir, door: Rect, x: number, y: number): number {
  switch (dir) {
    case 'up': return y - (door.y + door.h);
    case 'down': return door.y - y;
    case 'left': return x - (door.x + door.w);
    case 'right': return door.x - x;
  }
}

/**
 * Make the doorway's cells walkable so only the door entity decides whether it can be
 * passed: solid fg tiles are cleared and a solid/void bg becomes the floor found just
 * inside the room (default dungeon floor). Runtime only; redone on every room entry.
 */
export function carveDoorway(room: RoomRuntime, rect: Rect, dir: Dir): void {
  const inward = DIR_VEC[OPPOSITE[dir]];
  const tx1 = Math.ceil((rect.x + rect.w) / TILE) - 1;
  const ty1 = Math.ceil((rect.y + rect.h) / TILE) - 1;
  for (let ty = Math.floor(rect.y / TILE); ty <= ty1; ty++) {
    for (let tx = Math.floor(rect.x / TILE); tx <= tx1; tx++) {
      const fg = room.tile('fg', tx, ty);
      if (fg !== 0 && room.tileDef(fg)?.collision === 'solid') room.setTile('fg', tx, ty, 0);
      const bg = room.tile('bg', tx, ty);
      if (bg === 0 || room.tileDef(bg)?.collision === 'solid') room.setTile('bg', tx, ty, floorInside(room, tx, ty, inward));
    }
  }
}

/** The first walkable bg tile up to 3 cells inward of (tx, ty), else the default dungeon floor. */
function floorInside(room: RoomRuntime, tx: number, ty: number, inward: Vec): number {
  for (let i = 1; i <= 3; i++) {
    const id = room.tile('bg', tx + inward.x * i, ty + inward.y * i);
    const c = room.tileDef(id)?.collision;
    if (c && FLOORS.has(c)) return id;
  }
  return T.DFLOOR;
}

function pick<T extends string>(v: unknown, options: readonly T[], fallback: T): T {
  return options.includes(v as T) ? (v as T) : fallback;
}

export class Door extends ObjectEntity {
  readonly kind: DoorKind;
  /** The wall the door sits on (the hero faces this way to walk through it). */
  readonly wall: Dir;
  readonly rule: ShutterRule;
  readonly closeOnEnter: boolean;
  readonly flagName: string;
  private opened: boolean;
  /** Seconds left of the open/close slide (0 = at rest). */
  private slideT = 0;
  /** A locked bump already buzzed during the current push (reset when the hero lets go). */
  private bumped = false;
  private firstTick = true;

  constructor(game: GameServices, inst: EntityInstance) {
    super(game, inst);
    this.kind = pick(this.prop<string>('kind', 'locked'), KINDS, 'locked');
    this.wall = pick(this.prop<string>('dir', 'up'), DIRS, 'up');
    this.rule = pick(this.prop<string>('opensWhen', 'trigger'), RULES, 'trigger');
    this.closeOnEnter = this.kind === 'shutter' && this.prop<boolean>('closeOnEnter', false) === true;
    this.flagName = doorFlag(this.id, String(this.prop<string>('link', '')));
    this.sprite = doorSprite(this.wall);
    this.drawLayer = 'ground';
    this.opened = this.kind === 'open' || this.closeOnEnter || game.flag(this.flagName);
    this.solid = !this.opened;
    this.anim = doorAnim(this.kind, this.wall, this.opened);
    carveDoorway(game.room, this.hitbox(), this.wall);
    game.spawn(new DoorJamb(this, -1));
    game.spawn(new DoorJamb(this, 1));
  }

  get isOpen(): boolean {
    return this.opened;
  }

  /** Trigger actions openDoor/closeDoor. Opening persists; closing lasts for this visit. */
  override setOpen(open: boolean, instant = false): void {
    if (open) this.open(instant ? null : 'door', !instant);
    else this.close(!instant);
  }

  override update(dt: number): void {
    this.slideT = Math.max(0, this.slideT - dt);
    if (this.kind === 'locked' || this.kind === 'bigKey') this.updateLock();
    else if (this.kind === 'shutter') this.updateShutter();
    this.firstTick = false;
  }

  override draw(r: Renderer): void {
    if (this.slideT <= 0) {
      r.drawSpriteAnim(this.sprite, this.anim, this.animT, Math.round(this.x), Math.round(this.y));
      return;
    }
    const progress = 1 - this.slideT / DOOR_SLIDE_TIME;
    const depth = this.wall === 'up' || this.wall === 'down' ? this.h : this.w;
    const offset = Math.round((this.opened ? progress : 1 - progress) * depth);
    const out = DIR_VEC[this.wall];
    r.drawSpriteAnim(this.sprite, doorAnim(this.kind, this.wall, true), 0, Math.round(this.x), Math.round(this.y));
    const ctx = r.ctx;
    ctx.save();
    try {
      ctx.beginPath();
      ctx.rect(Math.round(this.left) - Math.round(r.camX), Math.round(this.top) - Math.round(r.camY), this.w, this.h);
      ctx.clip();
      const closed = doorAnim(this.kind, this.wall, false);
      r.drawSpriteAnim(this.sprite, closed, 0, Math.round(this.x + out.x * offset), Math.round(this.y + out.y * offset));
    } finally {
      ctx.restore();
    }
  }

  /** Open (persisting the flag): optional sound, animated slide, linked doors in this room follow. */
  protected open(sound: SfxId | null, animate: boolean): void {
    if (this.opened) return;
    this.opened = true;
    this.solid = false;
    this.play(doorAnim(this.kind, this.wall, true));
    this.slideT = animate ? DOOR_SLIDE_TIME : 0;
    this.game.setFlag(this.flagName, true);
    if (sound) this.game.audio.sfx(sound);
    this.game.emit({ type: 'doorOpened', id: this.id });
    for (const e of this.game.entities) {
      if (e !== this && e instanceof Door && e.flagName === this.flagName) e.open(null, animate);
    }
  }

  private close(animate: boolean): void {
    if (!this.opened || this.kind === 'open') return;
    this.opened = false;
    this.solid = true;
    this.play(doorAnim(this.kind, this.wall, false));
    this.slideT = animate ? DOOR_SLIDE_TIME : 0;
    if (animate) this.game.audio.sfx('door');
  }

  /** Locked / big-key doors open when the hero walks into them holding the right key. */
  private updateLock(): void {
    if (this.opened) return;
    if (!this.heroPushing()) {
      this.bumped = false;
      return;
    }
    const game = this.game;
    const unlocked = this.kind === 'bigKey' ? game.hasItem('bigKey') : game.takeItem('smallKey', 1);
    if (unlocked) {
      this.open('unlock', true);
    } else if (!this.bumped) {
      this.bumped = true;
      game.audio.sfx('locked');
    }
  }

  private heroPushing(): boolean {
    const p = this.game.player;
    if (p.state !== 'normal' && p.state !== 'push') return false;
    if (p.facing !== this.wall || !this.game.input.held(this.wall)) return false;
    return rectsOverlap(frontProbe(p, BUMP_REACH), this.hitbox());
  }

  private updateShutter(): void {
    const game = this.game;
    const cleared = this.rule === 'enemiesCleared' && game.enemiesCleared();
    if (!this.opened) {
      // A room with no enemies at all starts with its shutter already open.
      if (cleared) this.open(this.firstTick ? null : 'door', !this.firstTick);
      return;
    }
    if (!this.closeOnEnter || cleared || game.flag(this.flagName)) return;
    const p = game.player;
    if (depthInside(this.wall, this.hitbox(), p.x, p.y) >= CLOSE_DEPTH && !this.overlaps(p)) this.close(true);
  }
}

/** One end of a doorway's stone frame: invisible, solid, not hookable; goes with its door. */
export class DoorJamb extends Companion<Door> {
  /** @param end -1 = the left/top end of the doorway, 1 = the right/bottom end. */
  constructor(door: Door, end: -1 | 1) {
    super(door, 'door.jamb');
    this.visible = false;
    this.solid = true;
    const horizontal = door.wall === 'up' || door.wall === 'down';
    const offset = end * ((horizontal ? door.w : door.h) - JAMB) / 2;
    this.x = horizontal ? door.x + offset : door.x;
    this.y = horizontal ? door.y : door.y + offset;
    this.w = horizontal ? JAMB : door.w;
    this.h = horizontal ? door.h : JAMB;
  }
}

/** A cracked wall that a bomb blast opens (the only door kind that reacts to attacks). */
export class BombableDoor extends Door {
  override hurt(hit: Hit): boolean {
    if (hit.kind !== 'bomb' || this.isOpen) return false;
    this.open('secret', false);
    return true;
  }
}

registerEntity('obj.door', (game, inst) =>
  inst.props['kind'] === 'bombable' ? new BombableDoor(game, inst) : new Door(game, inst));
