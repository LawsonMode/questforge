// One save file being played: implements GameServices, loads rooms, runs the
// per-tick gameplay rules (entities, contact damage, touches, triggers, room
// edges, pits, death), and the in-game sub-states (playing, paused, dialogue,
// transition, game over). The Game (game.ts) owns the loop and the screens
// before gameplay starts. When the gamepad in use is unplugged (controllerLost),
// the pause menu opens by itself as soon as the game may pause, with a notice
// that stays until the next press. OWNER: engine agent.
import type {
  DialoguePage, Dir, DungeonState, EntityInstance, ItemId, MusicId, Project, Room, SaveData, SfxId, WarpTarget, World,
} from '../core/types';
import type { AudioApi, DebugFlags, GameEvent, GameServices, InputState, Light, Renderer } from './api';
import type { DropKind } from '../content/ids';
import { ITEM_INFO } from '../content/ids';
import { DIRS, clamp, type Rect, type Vec } from '../core/math';
import { entityInfo, propOf } from '../core/catalog';
import { dialogueById, findRoom, findWorld, neighborRoom } from '../core/project';
import { applyItem, dungeonState, hasItem, isKnownItem, itemLevel, prizeName, takeItem } from './state';
import { createEntity } from './registry';
import type { Entity } from './entity';
import { ActiveRoom } from './world';
import { Camera } from './camera';
import { Player } from './player/player';
import { interactTarget } from './player/reach';
import { Effect, type EffectOptions } from './effects';
import { dropLoot } from './loot';
import { drawDebugOverlay, drawScene } from './render';
import { findFreeSpot, nearestFreeCell } from './spot';
import { SCREEN_H, TILE } from '../core/constants';
import {
  ScrollTransition, WarpTransition, edgeAlong, edgeExit, roomOffset, roomSizePx, roomsAlongScroll, scrollCameraEnd,
  scrollEntry, type WarpStyle,
} from './transitions';
import { TriggerSystem } from './triggers';
import { DIALOGUE_SPANS, DialogueBox, type DialoguePosition } from './ui/dialogueBox';
import { PauseMenu } from './ui/pauseMenu';
import { GameOverScreen } from './ui/gameOver';
import { drawHud } from './ui/hud';
import { rumble } from '../input/devices';

/** What the session needs from its host (the Game). */
export interface SessionHost {
  readonly mode: 'play' | 'playtest';
  /** Persist the save (resolves immediately in playtest, which never persists). */
  persist(save: SaveData): Promise<void>;
  /** Leave the game (back to the menu / editor). */
  exit(): void;
}

export type SessionMode = 'playing' | 'paused' | 'dialogue' | 'transition' | 'gameOver';

/** What the scroll draws of the room being left (plus other rooms its camera passes over). */
interface ScrollSnapshot {
  room: ActiveRoom;
  /** The old room's entities plus the player (drawn at its interpolated position). */
  entities: Entity[];
  others: { room: ActiveRoom; offset: Vec }[];
}

/** Max camera catch-up per tick (px) — faster than any hero movement, so it only shows after scrolls. */
const CAMERA_STEP = 4;
/** Camera focus sits this far above the hitbox centre (the hero sprite is taller than its footprint). */
const FOCUS_DY = 6;
const LOW_HEALTH_BEEP = 0.8;
const LANTERN_RADIUS = 44;
const BARE_LIGHT_RADIUS = 18;
/** Pit falls without a pitTarget cost one heart. */
const PIT_DAMAGE = 2;
/** Neither the enemy nor the hero may be this high (px) for contact damage. */
const CONTACT_MAX_Z = 8;
/**
 * How far (px) the hero is nudged, pixel by pixel, out of something solid that
 * ended up on top of them; past that the nearest free tile anywhere in the room.
 */
const UNSTICK_RADIUS = 24;
/** After a failed unstick search (nowhere to go), wait this long (s) before searching again from the same spot. */
const UNSTICK_RETRY = 0.5;
/** Floor (px square) a returning heart container needs under it. */
const LEFT_HEART_SIZE = 12;
/** Screen span of a standing figure's sprite around its hitbox centre (16x24 art with its origin 18 px down). */
const SPRITE_ABOVE = 18;
const SPRITE_BELOW = 6;
const NO_ENTITIES: readonly Entity[] = [];

const HEART_ITEMS: ReadonlySet<ItemId> = new Set(['heart', 'heartContainer', 'heartPiece', 'fairy']);

export class Session implements GameServices {
  readonly project: Project;
  readonly input: InputState;
  readonly audio: AudioApi;
  readonly save: SaveData;
  readonly debug: DebugFlags;
  readonly camera = new Camera();
  readonly player: Player;
  private list: Entity[] = [];
  /** Snapshot of `list` iterated per tick (entities may spawn/remove others while ticking). */
  private readonly tickList: Entity[] = [];
  private roomRt!: ActiveRoom;
  private clock = 0;
  private readonly host: SessionHost;
  private readonly triggers: TriggerSystem;
  private readonly dialogueBox: DialogueBox;
  private readonly pauseMenu: PauseMenu;
  private readonly gameOverScreen: GameOverScreen;
  private transition: ScrollTransition | WarpTransition | null = null;
  private scrollFrom: ScrollSnapshot | null = null;
  private pendingWarp: { target: WarpTarget; style: WarpStyle | 'none' } | null = null;
  private paused = false;
  private over = false;
  private exited = false;
  /** The gamepad in use was unplugged: pause (with the notice) as soon as the game may. */
  private padLost = false;
  private entry: WarpTarget = { world: '', room: '', x: 0, y: 0 };
  /** Ids of entities defeated during this room visit (enemiesCleared bookkeeping). */
  private readonly defeated = new Set<string>();
  private beepT = 0;
  /** Where the last unstick search found nowhere to go, and when it may run again (it is costly). */
  private unstickRetry: { x: number; y: number; at: number } | null = null;
  /** Unknown item ids already reported (hand-edited projects), so each warns once. */
  private readonly warnedItems = new Set<string>();
  /**
   * True while enterRoom spawns the room's placed entities: objects created then
   * are part of the room, anything created later was revealed mid-room (see
   * objects/base.ts spawnedMidRoom).
   */
  spawningRoom = false;

  constructor(
    host: SessionHost, project: Project, input: InputState, audio: AudioApi, save: SaveData, debug: DebugFlags,
    start: WarpTarget,
  ) {
    this.host = host;
    this.project = project;
    this.input = input;
    this.audio = audio;
    this.save = save;
    this.debug = debug;
    this.player = new Player(this);
    this.triggers = new TriggerSystem(this);
    this.dialogueBox = new DialogueBox(project, audio);
    this.gameOverScreen = new GameOverScreen(audio);
    this.warpNow(start);
    // Built once a room exists so the menu may read room/dungeon state right away.
    this.pauseMenu = new PauseMenu(this, { persists: host.mode === 'play', exitChord: host.mode === 'playtest' });
  }

  // ------------------------------------------------------------------ state

  get room(): ActiveRoom {
    return this.roomRt;
  }

  get entities(): readonly Entity[] {
    return this.list;
  }

  get time(): number {
    return this.clock;
  }

  get dungeon(): DungeonState | null {
    const w = this.roomRt.world;
    return w.kind === 'dungeon' ? dungeonState(this.save, w.id) : null;
  }

  get mode(): SessionMode {
    if (this.over) return 'gameOver';
    if (this.transition) return 'transition';
    if (this.dialogueBox.active) return 'dialogue';
    if (this.paused) return 'paused';
    return 'playing';
  }

  /** Live enemies that still count toward the 'enemiesCleared' condition. */
  enemiesRemaining(): number {
    return this.list.filter((e) => e.countsForClear && !e.dead && !this.defeated.has(e.id)).length;
  }

  enemiesCleared(): boolean {
    return this.enemiesRemaining() === 0;
  }

  // ------------------------------------------------------------------ rooms

  /** Load a place instantly (no transition): new room, spawns, player placement, triggers, music. */
  warpNow(target: WarpTarget): void {
    const loc = this.locate(target);
    this.enterRoom(loc.world, loc.room, loc.target);
  }

  /** Resolve a target; a missing world/room falls back to the project start (with a warning for the maker). */
  private locate(target: WarpTarget): { world: World; room: Room; target: WarpTarget } {
    const tryTarget = (t: WarpTarget) => {
      const world = findWorld(this.project, t.world);
      const room = world ? findRoom(this.project, t.world, t.room) : undefined;
      return world && room ? { world, room, target: t } : null;
    };
    const found = tryTarget(target);
    if (found) return found;
    console.warn(`[game] no room "${target.room}" in world "${target.world}"; going to the project start instead.`);
    const start = tryTarget(this.project.start);
    if (start) return start;
    const world = this.project.worlds.find((w) => w.rooms.length > 0);
    const room = world?.rooms[0];
    if (!world || !room) throw new Error('This project has no rooms to play.');
    const size = roomSizePx(room);
    return { world, room, target: { world: world.id, room: room.id, x: size.w / 2, y: size.h / 2 } };
  }

  /**
   * Switch to `room`: spawn its entities, then put the player at the free spot
   * nearest `target` (searching along `along` first — the edge a scroll enters by).
   */
  private enterRoom(world: World, room: Room, target: WarpTarget, along?: 'x' | 'y'): void {
    for (const e of this.list) if (e !== this.player) e.onRemove?.();
    this.roomRt = new ActiveRoom(this.project, world, room, this.save.flags);
    this.list = [this.player];
    this.defeated.clear();
    this.unstickRetry = null;
    this.player.place(target.x, target.y, target.dir);
    this.spawningRoom = true;
    try {
      for (const inst of room.entities) this.spawnPlaced(inst);
    } finally {
      this.spawningRoom = false;
    }
    const spot = this.freeSpotNear(target.x, target.y, along);
    if (spot.x !== this.player.x || spot.y !== this.player.y) this.player.place(spot.x, spot.y);
    this.entry = { world: world.id, room: room.id, x: spot.x, y: spot.y, dir: target.dir ?? this.player.facing };
    if (world.kind === 'dungeon') {
      const ds = dungeonState(this.save, world.id);
      if (!ds.visited.includes(room.id)) ds.visited.push(room.id);
    }
    this.playRoomMusic();
    this.followCamera(true);
    this.triggers.enterRoom(room);
    this.emit({ type: 'roomEnter', room: room.id });
  }

  /** Placed-instance skip rules: hidden until shown, hidden by trigger. */
  private hiddenPlaced(inst: EntityInstance): boolean {
    if (propOf<boolean>(inst, 'hidden', false) === true && !this.flag(`shown:${inst.id}`)) return true;
    return this.flag(`hidden:${inst.id}`);
  }

  private spawnPlaced(inst: EntityInstance): void {
    if (this.hiddenPlaced(inst)) return;
    const info = entityInfo(inst.type);
    if (info?.persistDefeat === true && this.flag(`defeated:${inst.id}`)) {
      if (info.category === 'boss') this.spawnLeftHeart(inst);
      return;
    }
    const e = createEntity(this, inst);
    if (e) this.list.push(e);
  }

  /**
   * A defeated boss stays gone, but a heart container the hero left behind
   * comes back where the boss was placed (bosses drop it as the placed pickup
   * `<id>-heart`, collected once through its pickup flag).
   */
  private spawnLeftHeart(boss: EntityInstance): void {
    const id = `${boss.id}-heart`;
    if (propOf<boolean>(boss, 'dropHeart', true) === false || this.flag(`pickup:${id}`)) return;
    const h = LEFT_HEART_SIZE / 2;
    const floor = (x: number, y: number): boolean =>
      !this.roomRt.blocked({ x: x - h, y: y - h, w: LEFT_HEART_SIZE, h: LEFT_HEART_SIZE }, 'walker');
    const at = findFreeSpot(floor, Math.round(boss.x), Math.round(boss.y)) ?? boss;
    const e = createEntity(this, {
      id, type: 'obj.pickup', x: at.x, y: at.y, props: { item: 'heartContainer', amount: 1, hidden: false },
    });
    if (e) this.list.push(e);
  }

  /**
   * The room's music; a boss theme only while one of the room's bosses is
   * still unbeaten (a cleared lair plays its world's music).
   */
  private playRoomMusic(): void {
    const m = this.roomMusic();
    this.audio.music(m === 'boss' && this.roomBossesBeaten() ? this.clearedMusic() : m);
  }

  private roomMusic(): MusicId | 'none' {
    const m = this.roomRt.def.music;
    return m === undefined || m === 'inherit' ? this.roomRt.world.music : m;
  }

  /** What a boss room plays once its bosses are beaten: the world's music (silence if that is the boss theme too). */
  private clearedMusic(): MusicId | 'none' {
    const w = this.roomRt.world.music;
    return w === 'boss' ? 'none' : w;
  }

  /** Every boss placed in the room has been defeated (false for a room without bosses). */
  private roomBossesBeaten(): boolean {
    const bosses = this.roomRt.def.entities.filter((i) => entityInfo(i.type)?.category === 'boss');
    return bosses.length > 0 && bosses.every((i) => this.flag(`defeated:${i.id}`));
  }

  /** The last boss of a boss-theme room just fell: its theme stops looping. */
  private endBossMusic(id: string, entityType: string): void {
    if (entityInfo(entityType)?.category !== 'boss' || this.roomMusic() !== 'boss') return;
    const another = this.list.some((e) => !e.dead && e.id !== id && entityInfo(e.type)?.category === 'boss');
    if (!another) this.audio.music(this.clearedMusic());
  }

  /**
   * Where the player can stand nearest (x, y) in the current room: inside it,
   * not blocked (tiles, solid entities) and not over a pit - close by, else the
   * nearest free tile anywhere in the room. Falls back to the clamped point when
   * nothing fits at all (or in noclip).
   */
  private freeSpotNear(x: number, y: number, along?: 'x' | 'y'): Vec {
    const p = this.player;
    const cx = clamp(x, p.w / 2, this.roomRt.width - p.w / 2);
    const cy = clamp(y, p.h / 2, this.roomRt.height - p.h / 2);
    if (this.debug.noclip) return { x: cx, y: cy };
    return findFreeSpot(this.spotFree, cx, cy, { along }) ?? this.freeCellNear(cx, cy) ?? { x: cx, y: cy };
  }

  /** The free tile centre nearest (x, y) anywhere in the room, or null. */
  private freeCellNear(x: number, y: number): Vec | null {
    return nearestFreeCell(this.spotFree, x, y, this.roomRt.cols, this.roomRt.rows, TILE);
  }

  private readonly spotFree = (x: number, y: number): boolean => {
    const p = this.player;
    const room = this.roomRt;
    if (x - p.w / 2 < 0 || y - p.h / 2 < 0 || x + p.w / 2 > room.width || y + p.h / 2 > room.height) return false;
    return !p.isBlockedAt(x, y) && room.collisionAt(x, y) !== 'pit';
  };

  /** Frame the hero: snap (room entry) or catch up by at most CAMERA_STEP px (after scrolls). */
  private followCamera(snap = false): void {
    const p = this.player;
    const fx = Math.round(p.x);
    const fy = Math.round(p.y) - FOCUS_DY;
    if (snap) this.camera.follow(fx, fy, this.roomRt.width, this.roomRt.height);
    else this.camera.approach(fx, fy, this.roomRt.width, this.roomRt.height, CAMERA_STEP);
  }

  // ------------------------------------------------------------------ tick

  tick(dt: number): void {
    if (this.exited) return;
    this.save.playTime += dt;
    if (this.padLost) this.pauseForLostPad();
    if (this.over) this.tickGameOver(dt);
    else if (this.transition) this.tickTransition(dt);
    else if (this.dialogueBox.active) this.dialogueBox.update(dt, this.input);
    else if (this.paused) this.tickPause(dt);
    else this.tickPlay(dt);
  }

  private tickPlay(dt: number): void {
    if (this.canPause() && (this.input.pressed('start') || this.input.pressed('select')) && !this.exitChordHeld()) {
      this.openPause(this.input.pressed('start') ? 'items' : 'map');
      return;
    }
    this.clock += dt;
    this.camera.update(dt);
    for (const e of this.snapshotList()) {
      if (e.dead) continue;
      e.tickCommon(dt);
      if (e.stun <= 0 || e.ignoresStun) e.update(dt);
    }
    this.keepPlayerFree();
    this.applyContactDamage();
    this.touchPlayer();
    this.triggers.update(dt);
    this.removeDead();
    this.afterPlayerMoved();
    if (!this.transition) this.processPendingWarp();
    if (!this.transition) this.followCamera();
    this.lowHealthBeep(dt);
  }

  /** The live list copied into a reused array, safe to iterate while entities spawn or die. */
  private snapshotList(): readonly Entity[] {
    const out = this.tickList;
    out.length = 0;
    for (const e of this.list) out.push(e);
    return out;
  }

  /**
   * Safety net: if something solid ends up on top of the walking hero (a door
   * closing, a moved block, odd room data), move them to the nearest free spot:
   * a nudge of up to UNSTICK_RADIUS px, else (with a poof) the nearest free tile
   * anywhere in the room, so the hero can never be left embedded. (Raised pegs
   * are walked off instead, see Player.isBlockedAt.) A search that finds nowhere
   * to go is not repeated from the same spot for UNSTICK_RETRY seconds.
   */
  private keepPlayerFree(): void {
    const p = this.player;
    const st = p.state;
    if ((st !== 'normal' && st !== 'swim' && st !== 'locked') || this.debug.noclip) return;
    if (!p.isBlockedAt(p.x, p.y)) {
      this.unstickRetry = null;
      return;
    }
    const x = Math.round(p.x);
    const y = Math.round(p.y);
    const retry = this.unstickRetry;
    if (retry && retry.x === x && retry.y === y && this.clock < retry.at) return;
    const near = findFreeSpot(this.spotFree, x, y, { maxRadius: UNSTICK_RADIUS });
    const spot = near ?? this.freeCellNear(x, y);
    if (!spot) {
      this.unstickRetry = { x, y, at: this.clock + UNSTICK_RETRY };
      return;
    }
    this.unstickRetry = null;
    p.x = spot.x;
    p.y = spot.y;
    if (!near) this.effect('fx.poof', 'play', spot.x, spot.y);
  }

  /** Playtest: Start + Select held together is the host's exit chord (game.ts), not a pause. */
  private exitChordHeld(): boolean {
    return this.host.mode === 'playtest' && this.input.held('start') && this.input.held('select');
  }

  /** Not while dying/falling/holding an item up, nor mid trigger sequence (a save must not split one). */
  private canPause(): boolean {
    const st = this.player.state;
    return st !== 'dead' && st !== 'fall' && st !== 'itemGet' && !this.triggers.busy;
  }

  private openPause(page: 'items' | 'map'): void {
    this.pauseMenu.open(page);
    this.paused = true;
  }

  /** The gamepad in use was unplugged: the pause menu opens (ALttP / Switch style) once the game may pause. */
  controllerLost(): void {
    if (!this.exited && !this.over) this.padLost = true;
  }

  /**
   * Open the menu with the CONTROLLER DISCONNECTED notice, or put the notice on
   * the menu already open. Mid-dialogue, mid-transition or mid-sequence it waits;
   * a press meanwhile (the player carrying on with the keyboard) cancels it.
   */
  private pauseForLostPad(): void {
    if (this.over) {
      this.padLost = false;
      return;
    }
    if (this.paused) this.pauseMenu.showDisconnected();
    else if (!this.transition && !this.dialogueBox.active && this.canPause()) {
      this.openPause('items');
      this.pauseMenu.showDisconnected();
    } else if (!this.input.anyPressed()) return;
    this.padLost = false;
  }

  private tickPause(dt: number): void {
    const res = this.pauseMenu.update(dt, this.input);
    if (res === 'save') void this.host.persist(this.save);
    if (res === 'saveQuit') {
      this.saveAndQuit();
      return;
    }
    if (res === 'resume' || !this.pauseMenu.active) this.paused = false;
  }

  private tickTransition(dt: number): void {
    const t = this.transition!;
    t.update(dt);
    if (t instanceof ScrollTransition) this.player.animT += dt;
    if (!t.done) return;
    this.transition = null;
    this.scrollFrom = null;
    if (t instanceof ScrollTransition) this.camera.set(t.setup.toCam.x, t.setup.toCam.y);
  }

  private tickGameOver(dt: number): void {
    const res = this.gameOverScreen.update(dt, this.input);
    if (res === 'continue') this.continueAfterDeath();
    else if (res === 'saveQuit') {
      this.save.hp = this.continueHp();
      this.saveAndQuit();
    }
  }

  /**
   * Quitting leaves the room like any room exit: the same teardown as enterRoom
   * runs first, so what a room exit records (a boss still in its death bursts
   * counts as defeated) is in the save.
   */
  private saveAndQuit(): void {
    this.exited = true;
    for (const e of this.list) if (e !== this.player) e.onRemove?.();
    void this.host.persist(this.save).then(() => this.host.exit());
  }

  private continueHp(): number {
    return Math.min(this.save.maxHp, Math.max(6, this.project.settings.startHearts * 2));
  }

  private enterGameOver(): void {
    this.over = true;
    this.pendingWarp = null;
    this.save.deaths += 1;
    this.gameOverScreen.reset();
    this.audio.music('gameover');
  }

  private continueAfterDeath(): void {
    this.over = false;
    this.save.hp = this.continueHp();
    this.player.revive();
    this.warpNow(this.save.respawn);
  }

  private applyContactDamage(): void {
    const p = this.player;
    if (p.state === 'dead' || p.z >= CONTACT_MAX_Z) return;
    for (const e of this.list) {
      if (e.team !== 'enemy' || e.contactDamage <= 0 || e.dead || e.stun > 0 || e.z >= CONTACT_MAX_Z) continue;
      if (!boxesOverlap(e, p.x - p.w / 2, p.y - p.h / 2, p.w, p.h)) continue;
      const dx = p.x - e.x;
      const dy = p.y - e.y;
      const len = Math.hypot(dx, dy);
      p.hurtPlayer({
        damage: e.contactDamage, kind: 'contact', source: e, dx: len > 0 ? dx / len : 0, dy: len > 0 ? dy / len : 0,
      });
    }
  }

  private touchPlayer(): void {
    const p = this.player;
    if (!p.visible || p.state === 'dead' || p.state === 'fall') return;
    for (const e of this.snapshotList()) {
      if (e !== p && !e.dead && e.onPlayerTouch && e.overlaps(p)) e.onPlayerTouch();
    }
  }

  private removeDead(): void {
    if (!this.list.some((e) => e.dead)) return;
    const alive: Entity[] = [];
    for (const e of this.list) {
      if (e.dead && e !== this.player) e.onRemove?.();
      else alive.push(e);
    }
    this.list = alive;
  }

  private lowHealthBeep(dt: number): void {
    const hp = this.save.hp;
    if (hp <= 0 || hp > 2 || this.player.state === 'dead') {
      this.beepT = 0;
      return;
    }
    this.beepT -= dt;
    if (this.beepT > 0) return;
    this.beepT = LOW_HEALTH_BEEP;
    this.audio.sfx('lowHealth');
  }

  // ------------------------------------------------------------------ hero vs world

  private afterPlayerMoved(): void {
    const p = this.player;
    if (p.deathDone) this.enterGameOver();
    else if (p.pitFallDone) this.resolvePitFall();
    else if (!this.pendingWarp) this.checkRoomEdges();
  }

  private resolvePitFall(): void {
    if (this.pendingWarp) return;
    const pt = this.roomRt.def.pitTarget;
    if (pt) {
      this.pendingWarp = { target: pt, style: 'fade' };
      return;
    }
    // The entry point may have been covered since (a pushed block): take the nearest free spot.
    const spot = this.freeSpotNear(this.entry.x, this.entry.y);
    this.player.place(spot.x, spot.y, this.entry.dir);
    this.followCamera(true);
    this.player.hurtPlayer({ damage: PIT_DAMAGE, kind: 'fall', source: null, dx: 0, dy: 0, knockback: 0 });
  }

  /**
   * Stepping past an edge: scroll into the neighbour once the hitbox centre has
   * crossed it; with no neighbour there, keep the hitbox inside the room.
   */
  private checkRoomEdges(): void {
    const p = this.player;
    const st = p.state;
    if (st === 'dead' || st === 'fall' || st === 'hop') return;
    const room = this.roomRt;
    const crossed = edgeExit(p.x, p.y, room.width, room.height);
    for (const dir of DIRS) {
      if (!this.pokesOut(dir)) continue;
      const along = edgeAlong(dir, p.x, p.y, room.width, room.height);
      const next = neighborRoom(room.world, room.def, dir, along);
      if (!next) this.clampInside(dir);
      else if (crossed === dir) {
        this.startScroll(next, dir);
        return;
      }
    }
  }

  private pokesOut(dir: Dir): boolean {
    const p = this.player;
    switch (dir) {
      case 'up': return p.y - p.h / 2 < 0;
      case 'down': return p.y + p.h / 2 > this.roomRt.height;
      case 'left': return p.x - p.w / 2 < 0;
      case 'right': return p.x + p.w / 2 > this.roomRt.width;
    }
  }

  private clampInside(dir: Dir): void {
    const p = this.player;
    switch (dir) {
      case 'up': p.y = p.h / 2; break;
      case 'down': p.y = this.roomRt.height - p.h / 2; break;
      case 'left': p.x = p.w / 2; break;
      case 'right': p.x = this.roomRt.width - p.w / 2; break;
    }
  }

  /**
   * Edge scroll into `next`: load it (the player lands on the free spot nearest
   * the edge crossing), then slide both rooms across while everything is frozen.
   */
  private startScroll(next: Room, dir: Dir): void {
    const from = this.roomRt;
    const p = this.player;
    const offset = roomOffset(from.def, next);
    const fromCam = { x: this.camera.x, y: this.camera.y };
    const playerFrom = { x: p.x, y: p.y };
    const swimming = p.state === 'swim';
    const leaving = this.list.filter((e) => e !== p);
    leaving.push(p);
    const entry = scrollEntry(from.def, next, dir, p.x, p.y);
    const along = dir === 'up' || dir === 'down' ? 'x' : 'y';
    this.enterRoom(from.world, next, { world: from.world.id, room: next.id, x: entry.x, y: entry.y, dir: p.facing }, along);
    const land = { x: p.x, y: p.y };
    const focus = { x: Math.round(land.x), y: Math.round(land.y) - FOCUS_DY };
    const toCam = scrollCameraEnd(dir, fromCam, offset, focus, next);
    const others = roomsAlongScroll(from.world, from.def, next, fromCam, toCam).map((o) => ({
      room: new ActiveRoom(this.project, from.world, o.room, this.save.flags),
      offset: o.offset,
    }));
    this.scrollFrom = { room: from, entities: leaving, others };
    p.playDir(swimming ? 'swim' : p.carrying ? 'carry' : 'walk');
    this.transition = new ScrollTransition({ fromCam, toCam, offset, playerFrom, playerTo: land });
  }

  private processPendingWarp(): void {
    const w = this.pendingWarp;
    if (!w) return;
    this.pendingWarp = null;
    if (w.style === 'none') this.warpNow(w.target);
    else this.transition = new WarpTransition(w.style, () => this.warpNow(w.target));
  }

  // ------------------------------------------------------------------ GameServices

  spawn<T extends Entity>(e: T): T {
    if (!this.list.includes(e)) this.list.push(e);
    return e;
  }

  findEntity(id: string): Entity | undefined {
    return this.list.find((e) => e.id === id && !e.dead);
  }

  entitiesIn(rect: Rect, filter?: (e: Entity) => boolean): Entity[] {
    const out: Entity[] = [];
    for (const e of this.list) {
      if (!e.dead && boxesOverlap(e, rect.x, rect.y, rect.w, rect.h) && (!filter || filter(e))) out.push(e);
    }
    return out;
  }

  /** Runs for every 1 px movement sub-step: a plain scan without allocations. */
  solidEntityAt(rect: Rect, self: Entity | null): Entity | null {
    for (const e of this.list) {
      if (e.solid && e !== self && !e.dead && boxesOverlap(e, rect.x, rect.y, rect.w, rect.h)) return e;
    }
    return null;
  }

  emit(e: GameEvent): void {
    if (e.type === 'defeated') {
      this.defeated.add(e.id);
      this.endBossMusic(e.id, e.entityType);
    }
    this.triggers.handle(e);
  }

  /**
   * opts.speaker labels every page without a speaker of its own. The box goes
   * where it hides neither the hero nor whoever the hero faces (the speaker), see
   * dialogueSide; a flagged choice sets its flag (option 0 = true) as soon as it
   * is picked.
   */
  dialogue(idOrText: string, opts?: { speaker?: string }): Promise<number> {
    const d = dialogueById(this.project, idOrText);
    const speaker = opts?.speaker;
    const pages: DialoguePage[] = d ? d.pages : [{ text: idOrText }];
    return this.dialogueBox.open(speaker ? pages.map((pg) => (pg.speaker ? pg : { ...pg, speaker })) : pages, {
      name: this.save.name,
      position: this.dialogueSide(),
      onChoice: (page, i) => {
        if (page.choice?.flag) this.setFlag(page.choice.flag, i === 0);
      },
    });
  }

  /**
   * The screen side for a dialogue box: the one covering less of the hero and of
   * the entity the hero faces (an NPC or sign being talked to - for 'talk'
   * trigger dialogues the hero still faces it), the hero counting double. A tie
   * goes to the top while the hero is in the lower half of the screen.
   */
  private dialogueSide(): DialoguePosition {
    const camY = this.camera.y;
    const heroY = this.player.y - camY;
    const target = interactTarget(this, this.player);
    const targetY = target ? target.y - camY : null;
    const cost = (side: DialoguePosition): number => {
      const [top, bottom] = DIALOGUE_SPANS[side];
      const covers = (y: number): boolean => y - SPRITE_ABOVE < bottom && y + SPRITE_BELOW > top;
      return (covers(heroY) ? 2 : 0) + (targetY !== null && covers(targetY) ? 1 : 0);
    };
    const top = cost('top');
    const bottom = cost('bottom');
    if (top !== bottom) return top < bottom ? 'top' : 'bottom';
    return heroY > SCREEN_H / 2 ? 'top' : 'bottom';
  }

  /**
   * Unknown item ids (hand-edited or imported projects) give nothing and warn
   * once. In a dungeon the crystal's message names the world's prize (e.g. "You
   * got the Sun Crystal!") and always shows - quietly when no fanfare was asked
   * for - since it is the dungeon's one completion message.
   */
  giveItem(item: ItemId, amount?: number, opts?: { fanfare?: boolean }): void {
    if (!isKnownItem(item)) {
      this.warnUnknownItem(item);
      return;
    }
    const applied = applyItem(this.save, this.roomRt.world.id, item, amount);
    const prize = item === 'crystal' && this.roomRt.world.kind === 'dungeon';
    const message = prize ? `You got the ${prizeName(this.roomRt.world)}!` : applied.message;
    if (opts?.fanfare) {
      this.audio.sfx('fanfare');
      rumble('tap');
      this.audio.duck(2);
      this.player.showItemGet(this.itemIcon(item));
      void this.dialogue(message).then(() => this.player.finishItemGet());
    } else {
      this.audio.sfx(itemSfx(item));
      if (prize && this.player.state !== 'dead') void this.dialogue(message);
    }
    this.emit({ type: 'itemGet', item });
  }

  private warnUnknownItem(item: string): void {
    if (this.warnedItems.has(item)) return;
    this.warnedItems.add(item);
    console.warn(`[game] there is no item "${item}"; nothing was given.`);
  }

  private itemIcon(item: ItemId): string {
    const info = ITEM_INFO[item];
    return info.icon2 && itemLevel(this.save, item) >= 2 ? info.icon2 : info.icon;
  }

  hasItem(item: ItemId, min?: number): boolean {
    return hasItem(this.save, this.roomRt.world.id, item, min);
  }

  takeItem(item: ItemId, amount?: number): boolean {
    return takeItem(this.save, this.roomRt.world.id, item, amount);
  }

  flag(name: string): boolean {
    return Object.hasOwn(this.save.flags, name) && this.save.flags[name] === true;
  }

  /** Flags are own keys whatever their name ("__proto__" too: defineProperty never touches the prototype). */
  setFlag(name: string, value = true): void {
    if (value) Object.defineProperty(this.save.flags, name, { value: true, enumerable: true, writable: true, configurable: true });
    else delete this.save.flags[name];
  }

  /** Queued; starts on the next gameplay tick — after any running transition (e.g. an 'enter' trigger mid-warp). */
  warp(target: WarpTarget, style: WarpStyle | 'none' = 'fade'): void {
    if (this.over) return;
    this.pendingWarp = { target, style };
  }

  showEntity(id: string): void {
    this.setFlag(`hidden:${id}`, false);
    this.setFlag(`shown:${id}`, true);
    if (this.findEntity(id)) return;
    const inst = this.roomRt.def.entities.find((i) => i.id === id);
    if (inst) this.spawnPlaced(inst);
  }

  hideEntity(id: string): void {
    this.setFlag(`shown:${id}`, false);
    this.setFlag(`hidden:${id}`, true);
    const e = this.findEntity(id);
    if (e && e !== this.player) e.dead = true;
  }

  dropLoot(x: number, y: number, kind?: DropKind): void {
    dropLoot(this, x, y, kind);
  }

  effect(sprite: string, anim: string, x: number, y: number, opts?: EffectOptions): void {
    this.spawn(new Effect(this, sprite, anim, x, y, opts));
  }

  isDark(): boolean {
    return this.roomRt.def.dark === true;
  }

  pegState(): boolean {
    return this.flag(`pegs:${this.roomRt.world.id}`);
  }

  togglePegs(): void {
    this.setFlag(`pegs:${this.roomRt.world.id}`, !this.pegState());
  }

  // ------------------------------------------------------------------ drawing

  draw(r: Renderer, fps: number): void {
    r.clear('#000000');
    // Shake jitter only moves while gameplay runs; frozen states draw the steady camera.
    const live = this.mode === 'playing';
    const camX = live ? this.camera.renderX : this.camera.x;
    const camY = live ? this.camera.renderY : this.camera.y;
    const t = this.transition;
    if (t instanceof ScrollTransition && this.scrollFrom) {
      const from = this.scrollFrom;
      t.draw(
        (cx, cy, hero) => {
          for (const o of from.others) drawScene(r, o.room, NO_ENTITIES, cx - o.offset.x, cy - o.offset.y);
          this.drawSceneWithHeroAt(r, from.room, from.entities, cx, cy, hero);
        },
        (cx, cy, hero) => this.drawSceneWithHeroAt(r, this.roomRt, this.list, cx, cy, hero),
      );
    } else {
      drawScene(r, this.roomRt, this.list, camX, camY, { lights: this.heroLights(this.player.x, this.player.y) });
    }
    r.camX = camX;
    r.camY = camY;
    drawHud(r, this);
    this.dialogueBox.draw(r);
    if (this.paused) this.pauseMenu.draw(r);
    if (t instanceof WarpTransition) {
      t.drawOverlay(r, { x: this.player.x - r.camX, y: this.player.y - FOCUS_DY - r.camY });
    }
    if (this.over) this.gameOverScreen.draw(r);
    const d = this.debug;
    if (d.hitboxes || d.fps || d.invincible || d.noclip) {
      drawDebugOverlay(r, this.list, this.player.swordRect(), d, fps);
    }
  }

  /**
   * Draw a room scene (whose entity list includes the player) with the player
   * temporarily at `at` (that room's px) — the scroll's interpolated position —
   * so it sorts, sits under the 'over' layer and lights dark rooms correctly.
   * The i-frame flicker is suppressed meanwhile: invuln is frozen with the rest
   * of the world, so a hidden flicker phase would hide the hero for the whole slide.
   */
  private drawSceneWithHeroAt(
    r: Renderer, room: ActiveRoom, entities: readonly Entity[], camX: number, camY: number, at: Vec,
  ): void {
    const p = this.player;
    const { x, y, invuln } = p;
    p.x = at.x;
    p.y = at.y;
    p.invuln = 0;
    try {
      drawScene(r, room, entities, camX, camY, { lights: this.heroLights(at.x, at.y) });
    } finally {
      p.x = x;
      p.y = y;
      p.invuln = invuln;
    }
  }

  private heroLights(x: number, y: number): Light[] {
    return [{ x, y: y - FOCUS_DY, r: this.hasItem('lantern') ? LANTERN_RADIUS : BARE_LIGHT_RADIUS }];
  }
}

/** Whether `e`'s hitbox overlaps the box (x, y, w, h): rectsOverlap(e.hitbox(), box) without allocating. */
function boxesOverlap(e: Entity, x: number, y: number, w: number, h: number): boolean {
  const left = e.x - e.w / 2;
  const top = e.y - e.h / 2;
  return left < x + w && left + e.w > x && top < y + h && top + e.h > y;
}

function itemSfx(item: ItemId): SfxId {
  if (item === 'rupees') return 'rupee';
  return HEART_ITEMS.has(item) ? 'heart' : 'item';
}
