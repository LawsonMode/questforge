// =============================================================================
// Engine service interfaces — the seam between the engine core and everything
// that runs inside it (player, enemies, objects, triggers, UI). Implementations:
//   Renderer      -> src/gfx/renderer.ts     (CanvasRenderer)
//   InputState    -> src/input/input.ts      (Input)
//   AudioApi      -> src/audio/audio.ts      (ChipAudio)
//   GameServices  -> src/game/game.ts        (Game.services)
//   RoomRuntime   -> src/game/world.ts       (ActiveRoom)
//   PlayerApi     -> src/game/player/player.ts (Player)
// Units: positions in room-local pixels, time in SECONDS, speeds in px/second.
// =============================================================================
import type { Rect, Vec } from '../core/math';
import type {
  Collision, Dir, DungeonState, ItemId, LayerName, MusicId, Project, Room, SaveData,
  SfxId, TileDef, WarpTarget, World,
} from '../core/types';
import type { DropKind } from '../content/ids';
import type { Entity } from './entity';

// ----------------------------------------------------------------------------
// Input
// ----------------------------------------------------------------------------

/**
 * Abstract SNES pad. Default keyboard map:
 *   arrows / WASD = d-pad, Z or J = b (sword), X or K = a (action: talk/lift/read/dash),
 *   C or L = y (use item), Enter = start (pause/inventory), Shift or M = select (map),
 *   Q = l, E = r, Escape = start (in playtest the host may intercept Escape).
 * Standard-mapping gamepads are supported (A->b sword, B->a action, X->y item ...).
 */
export type Button = 'up' | 'down' | 'left' | 'right' | 'a' | 'b' | 'x' | 'y' | 'l' | 'r' | 'start' | 'select';
export const BUTTONS: readonly Button[] = ['up', 'down', 'left', 'right', 'a', 'b', 'x', 'y', 'l', 'r', 'start', 'select'];

export interface InputState {
  held(b: Button): boolean;
  /** True only on the tick the button went down. */
  pressed(b: Button): boolean;
  /** True only on the tick the button went up. */
  released(b: Button): boolean;
  /** Seconds the button has been held (0 if not held). */
  heldTime(b: Button): number;
  /** D-pad vector, components in {-1, 0, 1}. */
  dir(): Vec;
  anyPressed(): boolean;
  /** Characters typed this tick (for name entry). */
  typed(): string;
}

export interface InputManager extends InputState {
  attach(target: Window | HTMLElement): void;
  detach(): void;
  /** Call exactly once per simulation tick, before game logic. */
  update(): void;
  /** Clear all state (e.g. when focus is lost or a menu opens). */
  reset(): void;
}

// ----------------------------------------------------------------------------
// Audio
// ----------------------------------------------------------------------------

export interface AudioApi {
  /**
   * Play a sound effect. opts.pitch is a frequency multiplier (1 = normal, clamped 0.25-4);
   * opts.volume is a gain multiplier (1 = normal, clamped 0-2). Non-finite values fall back to 1.
   */
  sfx(id: SfxId, opts?: { volume?: number; pitch?: number }): void;
  /** Crossfades/switches to a track; same track = no-op. 'none' stops music. */
  music(id: MusicId | 'none'): void;
  readonly currentMusic: MusicId | 'none';
  /** Temporarily duck music (e.g. item fanfare). */
  duck(seconds: number): void;
  setVolumes(v: { master?: number; music?: number; sfx?: number }): void;
  /** Must be called from a user gesture before sound can play (browser autoplay policy). */
  unlock(): void;
  setMuted(m: boolean): void;
  /** Context state, e.g. to show a "click to enable sound" hint. */
  readonly status?: 'unavailable' | 'locked' | 'suspended' | 'running';
}

// ----------------------------------------------------------------------------
// Rendering
// ----------------------------------------------------------------------------

export interface DrawOpts {
  flipX?: boolean;
  flipY?: boolean;
  alpha?: number;
  /** Palette id override (palette swap). */
  palette?: string;
  /** Draw as a solid white silhouette (damage flash). */
  flash?: boolean;
  /** Screen-space: ignore the camera. */
  screen?: boolean;
}

export interface TextOpts {
  color?: string;
  /** Drop-shadow colour, or false for none. Default dark shadow. */
  shadow?: string | false;
  align?: 'left' | 'center' | 'right';
  /** Text is screen-space by default; set false to draw in world space. */
  screen?: boolean;
}

export interface Light { x: number; y: number; r: number }

export interface Renderer {
  readonly width: number;   // 256
  readonly height: number;  // 224
  /** The low-res backbuffer context (256x224). Use for custom drawing; honour camX/camY yourself. */
  readonly ctx: CanvasRenderingContext2D;
  /** World-space camera offset (integer px) subtracted from world draws. */
  camX: number;
  camY: number;
  /** Seconds; drives tile animation. */
  time: number;
  setProject(p: Project): void;
  clear(color?: string): void;
  /** Draw tile `id` with its top-left at (x, y). id 0 draws nothing. */
  drawTile(id: number, x: number, y: number, opts?: DrawOpts): void;
  /** Draw a sprite frame so its origin lands at (x, y). Missing sprites draw a magenta placeholder. */
  drawSpriteFrame(spriteId: string, frame: number, x: number, y: number, opts?: DrawOpts): void;
  /** Draw the frame of `anim` at time t (seconds since the anim started). Honours the anim's flipX (XOR opts.flipX). */
  drawSpriteAnim(spriteId: string, anim: string, t: number, x: number, y: number, opts?: DrawOpts): void;
  /** Total duration (s) of a non-looping anim (0 if unknown). */
  animDuration(spriteId: string, anim: string): number;
  fillRect(x: number, y: number, w: number, h: number, color: string, opts?: { screen?: boolean; alpha?: number }): void;
  strokeRect(x: number, y: number, w: number, h: number, color: string, opts?: { screen?: boolean; alpha?: number }): void;
  /** 8x8 bitmap font. (x, y) is the top-left of the first glyph (or centre/right per align). */
  drawText(text: string, x: number, y: number, opts?: TextOpts): void;
  measureText(text: string): number;
  /** Soft elliptical ground shadow centred at (x, y) world-space. */
  drawShadow(x: number, y: number, w?: number): void;
  /** Darkness overlay with circular light holes (world-space lights). level 0..1. */
  darkness(level: number, lights: Light[]): void;
  /** Full-screen colour overlay (fades/flashes). */
  overlay(color: string, alpha: number): void;
  /** Blit the backbuffer to the display canvas, integer-scaled and centred. */
  present(): void;
}

// ----------------------------------------------------------------------------
// Combat
// ----------------------------------------------------------------------------

export type DamageKind =
  | 'sword' | 'spin' | 'arrow' | 'bomb' | 'boomerang' | 'hookshot' | 'thrown'
  | 'contact' | 'projectile' | 'fire' | 'beam' | 'spikes' | 'fall';

export interface Hit {
  /** Half-hearts for the player; HP points for enemies. 0 = stun/knock only. */
  damage: number;
  kind: DamageKind;
  source: Entity | null;
  /** Knockback direction (unit vector). */
  dx: number;
  dy: number;
  /** Knockback distance in px (default ~16). */
  knockback?: number;
  /** Stun seconds (boomerang/hookshot). */
  stun?: number;
}

export type MoverKind =
  | 'player'     // solid, deep (unless flippers), ledges (hop); pits are walkable (fall)
  | 'walker'     // solid, deep, pit, ledge all block
  | 'flyer'      // only solid blocks
  | 'projectile' // only solid blocks (flies over water/pits)
  | 'ghost';     // nothing blocks

// ----------------------------------------------------------------------------
// Rooms
// ----------------------------------------------------------------------------

export interface RoomRuntime {
  readonly def: Room;
  readonly world: World;
  readonly cols: number;
  readonly rows: number;
  /** Size in px. */
  readonly width: number;
  readonly height: number;
  tile(layer: LayerName, tx: number, ty: number): number;
  /** Runtime tile change. persist=true records a `tile:` flag so it survives re-entry (bombs, dash). */
  setTile(layer: LayerName, tx: number, ty: number, id: number, persist?: boolean): void;
  tileDef(id: number): TileDef | undefined;
  /**
   * Effective collision at a pixel: a non-zero fg tile decides the whole cell (the open quarters of
   * its solidMask are floor and do NOT fall through to bg); otherwise bg; outside the room = 'solid'.
   */
  collisionAt(px: number, py: number): Collision;
  /** Top-most tile at (tx, ty) that has cut/lift/bomb/dash behaviour (fg first, then bg). */
  interactiveTile(tx: number, ty: number): { layer: LayerName; def: TileDef } | null;
  /** Whether a rect overlaps any tile that blocks this mover kind. */
  blocked(rect: Rect, mover: MoverKind, opts?: { flippers?: boolean }): boolean;
}

// ----------------------------------------------------------------------------
// Events (feed the trigger system)
// ----------------------------------------------------------------------------

export type GameEvent =
  | { type: 'switch'; id: string; on: boolean }
  | { type: 'defeated'; id: string; entityType: string }
  | { type: 'blockPushed'; id: string }
  | { type: 'torchLit'; id: string }
  | { type: 'talk'; id: string }
  | { type: 'itemGet'; item: ItemId }
  | { type: 'chestOpened'; id: string }
  | { type: 'doorOpened'; id: string }
  | { type: 'roomEnter'; room: string };

// ----------------------------------------------------------------------------
// Player
// ----------------------------------------------------------------------------

export type PlayerState =
  | 'normal' | 'attack' | 'spin' | 'charge' | 'lift' | 'carry' | 'push' | 'dash' | 'hurt'
  | 'hop' | 'fall' | 'swim' | 'use' | 'hookshot' | 'itemGet' | 'dead' | 'locked';

export interface PlayerApi extends Entity {
  readonly state: PlayerState;
  /** Entity currently held overhead (lifted pot/bush/rock/block). */
  readonly carrying: Entity | null;
  /** Current sword hitbox while swinging/spinning, else null. */
  swordRect(): Rect | null;
  /**
   * Apply damage from enemies/hazards (handles shield, i-frames, knockback, death).
   * Returns 'hit' if it landed, 'blocked' if the shield stopped it (blockable source hitting the
   * hero's facing side - the projectile should then bounce away/vanish; this also applies during
   * i-frames), 'ignored' otherwise (i-frames, debug invincible, dead, cutscene).
   */
  hurtPlayer(hit: Hit): 'hit' | 'blocked' | 'ignored';
  heal(halfHearts: number): void;
  /** Place the player (room-local px) e.g. after a warp. */
  place(x: number, y: number, facing?: Dir): void;
  /** Hold an item icon overhead for the item-get pose (sprite 'item', anim). */
  showItemGet(icon: string, seconds?: number): void;
  /** Freeze player control (cutscenes, dialogue). */
  setLocked(locked: boolean): void;
  /** Fall into a pit at the current position. */
  fallIntoPit(): void;
}

// ----------------------------------------------------------------------------
// Game services (what entities & UI may call)
// ----------------------------------------------------------------------------

export interface DebugFlags {
  hitboxes: boolean;
  invincible: boolean;
  noclip: boolean;
  fps: boolean;
}

export interface GameServices {
  readonly project: Project;
  readonly input: InputState;
  readonly audio: AudioApi;
  readonly save: SaveData;
  readonly room: RoomRuntime;
  readonly player: PlayerApi;
  /** Gameplay seconds (frozen while paused / in dialogue / transitions). */
  readonly time: number;
  readonly debug: DebugFlags;
  readonly camera: { readonly x: number; readonly y: number; shake(seconds: number, magnitude?: number): void };
  /** Current dungeon state if the current world is a dungeon, else null. */
  readonly dungeon: DungeonState | null;
  /** Live entities in the current room (player included). */
  readonly entities: readonly Entity[];

  spawn<T extends Entity>(e: T): T;
  findEntity(id: string): Entity | undefined;
  entitiesIn(rect: Rect, filter?: (e: Entity) => boolean): Entity[];
  /** Solid entities (other than `self`) overlapping rect — used by Entity.move. */
  solidEntityAt(rect: Rect, self: Entity | null): Entity | null;

  emit(e: GameEvent): void;
  /** Live entities in the room that still count toward 'enemiesCleared'. */
  enemiesRemaining(): number;
  /** True when no countsForClear enemy remains in the current room. */
  enemiesCleared(): boolean;
  /** Open a dialogue by id, or show literal text if no dialogue has that id. Resolves with the chosen option index (-1 if none) when closed. Gameplay pauses meanwhile. */
  dialogue(idOrText: string, opts?: { speaker?: string }): Promise<number>;
  /** Give an item: updates save, plays sound; fanfare=true shows the item-get pose + message. */
  giveItem(item: ItemId, amount?: number, opts?: { fanfare?: boolean }): void;
  hasItem(item: ItemId, min?: number): boolean;
  /** Remove items/ammo/keys/rupees; false if not enough. */
  takeItem(item: ItemId, amount?: number): boolean;
  flag(name: string): boolean;
  setFlag(name: string, value?: boolean): void;
  /** Transition to another place (fade by default). */
  warp(target: WarpTarget, style?: 'fade' | 'iris' | 'none'): void;
  /** Reveal an entity placed with hidden=true (persisted as shown:<id>). */
  showEntity(id: string): void;
  /** Remove an entity (persisted as hidden:<id>). */
  hideEntity(id: string): void;
  /** Spawn loot at a position. 'random' rolls the default table. */
  dropLoot(x: number, y: number, kind?: DropKind): void;
  /** One-shot visual effect: plays `anim` of `sprite` once at (x, y) then disappears. */
  effect(sprite: string, anim: string, x: number, y: number, opts?: { z?: number; palette?: string; above?: boolean }): void;
  /** True if the current room is dark. */
  isDark(): boolean;
  /** Current colour-peg state for this world (false = red raised). */
  pegState(): boolean;
  togglePegs(): void;
}
