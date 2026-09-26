// Room trigger engine: evaluates Trigger conditions and runs actions (see
// Trigger/Condition/Action in core/types.ts). OWNER: triggers+UI agent.
//
// When triggers fire:
//   'auto'  on the rising edge of "all conditions hold", checked every gameplay
//           tick (the edge state restarts at false on every room entry, so a
//           trigger whose conditions already hold fires once on arrival);
//   'enter' once per room entry: chosen in enterRoom() (the engine's later
//           'roomEnter' event is ignored) and started by the next update() - the
//           first gameplay tick in the new room, i.e. after its scroll or fade;
//   'talk'  on a 'talk' event whose id === trigger.source.
// 'enter' and 'talk' triggers are all checked against the state at the moment
// of the event before any of them fires, so one trigger's quick actions (a
// setFlag, say) never make a sibling fire on the same event.
// A once-trigger records flag trigger:<id> the moment it fires, so a save made
// while its sequence runs can never replay its rewards; no trigger restarts
// while its own sequence still runs. If the hero dies mid-sequence, flush()
// applies the rest of its lasting effects at once (see flush).
//
// Actions run in order. 'dialogue' blocks until the box closes, 'wait' blocks for
// its seconds of gameplay time, 'warp' blocks until the next room is entered,
// and a giveItem with a fanfare yields until its item-get message is gone
// (gameplay, and so update(), is frozen while any dialogue shows - that is also
// what locks the hero during dialogue). A flagged choice sets its flag as it is
// picked (the session's dialogue() does that), so the next action already sees
// the answer. A sequence keeps running across rooms; its setTile actions still
// change the room it started in. Missing targets log one warning each and the
// sequence carries on; so does a giveItem naming an item that does not exist
// (hand-edited or imported projects): one warning, nothing given.
//
// Dungeon completion: when a 'crystal' itemGet happens in a dungeon world and no
// trigger of the current room deals with the crystal (tests hasItem 'crystal' or
// flag crystal:<worldId>, or gives the crystal itself) and no running sequence
// gives it, the default flow runs with the hero held still: once the engine's
// item-get message ("You got the <prize name>!", the one completion message) has
// closed, the victory jingle, a pause for it, then a fade-warp out. The exit is
// the target of a marker.warp leading out of the dungeon - an overworld target
// first, else an interior one;
// the room the dungeon was entered by (its first visited room) is searched
// first, then the others in order. Without such a warp: project.start. A
// respawn point still inside the finished dungeon moves to the exit.
import type { Action, Condition, ItemId, Room, Trigger, WarpTarget, World } from '../core/types';
import { LAYERS } from '../core/types';
import type { GameEvent, GameServices } from './api';
import type { Entity } from './entity';
import { findEntityInstance } from '../core/project';
import { footprint, propOf } from '../core/catalog';
import { rectContains } from '../core/math';
import { SCREEN_COLS, SCREEN_ROWS } from '../core/constants';
import { crystalFlag, isKnownItem } from './state';
import { ActiveRoom } from './world';

/** Items given by a giveItem action without the item-get fanfare (quiet refills). */
const QUIET_ITEMS: ReadonlySet<ItemId> = new Set(['rupees', 'heart', 'arrows', 'bombs', 'magic', 'fairy', 'smallKey']);
/** Actions whose effect outlasts the sequence: the ones flush() still applies. */
const LASTING: ReadonlySet<Action['kind']> = new Set([
  'openDoor', 'closeDoor', 'showEntity', 'hideEntity', 'setFlag', 'giveItem', 'takeItem', 'setTile',
]);
/** A warp action gives up waiting for the new room after this long (s): e.g. a warp refused on game over. */
const WARP_TIMEOUT = 3;
/**
 * Dungeon completion: a beat after the item-get message closes before the jingle
 * (trigger waits only run in gameplay, so it starts once the box is gone rather
 * than under the item fanfare), then the jingle's time before the exit warp (s).
 */
export const CRYSTAL_JINGLE_DELAY = 0.1;
export const CRYSTAL_EXIT_DELAY = 2.5;
const NO_TRIGGERS: readonly Trigger[] = [];

/** One running action sequence. */
interface Run {
  trigger: Trigger;
  actions: readonly Action[];
  /** The room the sequence started in (its setTile actions change that room). */
  world: World;
  room: Room;
  index: number;
  /** Seconds left on a 'wait' (or on the warp timeout while `awaitingRoom`). */
  wait: number;
  /** Blocked on a dialogue promise. */
  awaitingDialogue: boolean;
  /** Blocked until the next room entry (after a warp). */
  awaitingRoom: boolean;
  /** Resume on the next tick (after a fanfare dialogue). */
  yielded: boolean;
  /** The hero is held still until the sequence ends (dungeon completion). */
  locksHero: boolean;
}

export class TriggerSystem {
  private readonly game: GameServices;
  private room: Room | null = null;
  private readonly runs: Run[] = [];
  /** Reused copy of `runs` for iterating while sequences start and finish. */
  private readonly runScratch: Run[] = [];
  /** 'enter' triggers chosen on the last room entry, started by the next update(). */
  private pendingEnter: readonly Trigger[] = NO_TRIGGERS;
  /** Last evaluated condition result per 'auto' trigger id (rising-edge detection). */
  private readonly autoPrev = new Map<string, boolean>();
  /** Latest known state per (floor) switch id this visit. */
  private readonly switches = new Map<string, boolean>();
  /** Entity ids defeated / pushed / lit during this room visit. */
  private readonly defeated = new Set<string>();
  private readonly pushed = new Set<string>();
  private readonly litTorches = new Set<string>();
  /** The room has had at least one countsForClear enemy during this visit. */
  private hadEnemies = false;
  /** game.enemiesCleared() for the current update (null = not asked yet). */
  private clearedNow: boolean | null = null;
  /** flush() is applying effects (a crystal given then starts no completion flow). */
  private flushing = false;
  private readonly warned = new Set<string>();

  constructor(game: GameServices) {
    this.game = game;
  }

  /** True while an action sequence is running (the engine should not allow saving meanwhile). */
  get busy(): boolean {
    return this.runs.length > 0;
  }

  /** Called after a room's entities are spawned: resets per-room edge state, picks the 'enter' triggers. */
  enterRoom(room: Room): void {
    this.room = room;
    this.autoPrev.clear();
    this.switches.clear();
    this.defeated.clear();
    this.pushed.clear();
    this.litTorches.clear();
    this.clearedNow = null;
    this.hadEnemies = this.game.enemiesRemaining() > 0;
    for (const e of this.game.entities) {
      const state = exposedSwitchState(e);
      if (state !== null) this.switches.set(e.id, state);
    }
    for (const run of this.runs) {
      if (!run.awaitingRoom) continue;
      run.awaitingRoom = false;
      run.wait = 0;
    }
    this.pendingEnter = room.triggers.filter((t) => t.on === 'enter' && this.eligible(t));
  }

  /** Feed a game event (talk, switch, defeated, ...). */
  handle(e: GameEvent): void {
    switch (e.type) {
      case 'switch':
        this.switches.set(e.id, e.on);
        break;
      case 'defeated':
        this.defeated.add(e.id);
        break;
      case 'blockPushed':
        this.pushed.add(e.id);
        break;
      case 'torchLit':
        this.litTorches.add(e.id);
        break;
      case 'talk':
        this.fireAll(this.roomTriggers().filter((t) => t.on === 'talk' && t.source === e.id && this.eligible(t)));
        break;
      case 'itemGet':
        if (e.item === 'crystal' && !this.flushing) this.onCrystal();
        break;
      default:
        break;
    }
  }

  /**
   * Every gameplay tick: advance running sequences, start the pending 'enter'
   * triggers, evaluate 'auto' triggers. While the hero is dying nothing starts
   * and running sequences are flushed.
   */
  update(dt: number): void {
    this.clearedNow = null;
    if (this.game.player.state === 'dead') {
      this.pendingEnter = NO_TRIGGERS;
      this.flush();
      return;
    }
    if (!this.hadEnemies && this.game.enemiesRemaining() > 0) this.hadEnemies = true;
    this.advanceRuns(dt);
    if (this.pendingEnter.length > 0) {
      const due = this.pendingEnter;
      this.pendingEnter = NO_TRIGGERS;
      this.fireAll(due);
    }
    for (const t of this.roomTriggers()) {
      if (t.on !== 'auto') continue;
      const now = this.conditionsHold(t);
      const before = this.autoPrev.get(t.id) ?? false;
      this.autoPrev.set(t.id, now);
      if (now && !before && this.canFire(t)) this.start(t, t.actions);
    }
  }

  /**
   * End every running sequence at once, keeping only its lasting effects: the
   * remaining door, entity, flag, tile and item actions run immediately (items
   * without a fanfare); dialogue, waits, sounds, music, shakes, heals and warps
   * are dropped. Runs when the hero dies mid-sequence; the engine may also call
   * it right before persisting a save.
   */
  flush(): void {
    if (this.runs.length === 0) return;
    const runs = this.runs.splice(0);
    this.flushing = true;
    try {
      for (const run of runs) {
        while (run.index < run.actions.length) this.executeLasting(run, run.actions[run.index++]!);
        this.release(run);
      }
    } finally {
      this.flushing = false;
    }
  }

  // ------------------------------------------------------------------ firing

  private roomTriggers(): readonly Trigger[] {
    return this.room?.triggers ?? NO_TRIGGERS;
  }

  private canFire(t: Trigger): boolean {
    if (t.once && this.game.flag(onceFlag(t))) return false;
    return !this.runs.some((r) => r.trigger === t);
  }

  private eligible(t: Trigger): boolean {
    return this.canFire(t) && this.conditionsHold(t);
  }

  /** Fire triggers chosen beforehand (so none of them sees another's effects first). */
  private fireAll(due: readonly Trigger[]): void {
    for (const t of due) this.start(t, t.actions);
  }

  private start(trigger: Trigger, actions: readonly Action[], locksHero = false): void {
    const g = this.game;
    if (trigger.once) g.setFlag(onceFlag(trigger), true);
    const run: Run = {
      trigger, actions, world: g.room.world, room: g.room.def,
      index: 0, wait: 0, awaitingDialogue: false, awaitingRoom: false, yielded: false, locksHero,
    };
    if (locksHero) g.player.setLocked(true);
    this.runs.push(run);
    this.step(run);
  }

  /** A sequence is over: let go of the hero if it held him. */
  private release(run: Run): void {
    if (run.locksHero) this.game.player.setLocked(false);
  }

  private advanceRuns(dt: number): void {
    if (this.runs.length === 0) return;
    const runs = this.runScratch;
    for (const run of this.runs) runs.push(run);
    for (const run of runs) {
      if (run.awaitingDialogue) continue;
      if (run.wait > 0) {
        run.wait = Math.max(0, run.wait - dt);
        if (run.wait > 0) continue;
      }
      // A finished wait, a fanfare yield or an expired warp timeout: carry on.
      run.yielded = false;
      run.awaitingRoom = false;
      this.step(run);
    }
    runs.length = 0;
  }

  /** Execute actions until one blocks or the sequence ends. */
  private step(run: Run): void {
    while (run.index < run.actions.length) {
      const action = run.actions[run.index++]!;
      this.execute(run, action);
      if (run.awaitingDialogue || run.awaitingRoom || run.yielded || run.wait > 0) return;
    }
    const i = this.runs.indexOf(run);
    if (i >= 0) this.runs.splice(i, 1);
    this.release(run);
  }

  // ------------------------------------------------------------------ conditions

  private conditionsHold(t: Trigger): boolean {
    for (const c of t.conditions) if (!this.holds(t, c)) return false;
    return true;
  }

  private holds(t: Trigger, c: Condition): boolean {
    const g = this.game;
    switch (c.kind) {
      case 'enemiesCleared':
        return this.hadEnemies && this.enemiesCleared();
      case 'switch': {
        const state = this.switchState(t, c.target);
        return state !== null && state === c.on;
      }
      case 'torchesLit':
        return this.torchesLit();
      case 'flag':
        return g.flag(c.flag) === c.value;
      case 'hasItem':
        return g.hasItem(c.item, c.min);
      case 'inRegion':
        return this.inRegion(t, c.target);
      case 'defeated':
        if (this.defeated.has(c.target) || g.flag(`defeated:${c.target}`)) return true;
        this.checkTarget(t, c.target);
        return false;
      case 'blockPushed':
        if (this.pushed.has(c.target)) return true;
        this.checkTarget(t, c.target);
        return false;
      default:
        this.warnOnce(`cond:${t.id}:${(c as { kind: string }).kind}`, `trigger "${t.name}" has an unknown condition`);
        return false;
    }
  }

  /** The engine's enemiesCleared(), asked at most once per update. */
  private enemiesCleared(): boolean {
    this.clearedNow ??= this.game.enemiesCleared();
    return this.clearedNow;
  }

  /**
   * A switch's state; null if unknown. A crystal switch is always the world's
   * peg state (every crystal switch toggles the same pegs); a floor switch is its
   * latest event this visit, else what the entity exposes.
   */
  private switchState(t: Trigger, id: string): boolean | null {
    const e = this.game.findEntity(id);
    const type = e?.type ?? this.room?.entities.find((i) => i.id === id)?.type;
    if (type === 'obj.crystalSwitch') return this.game.pegState();
    const known = this.switches.get(id);
    if (known !== undefined) return known;
    const exposed = e ? exposedSwitchState(e) : null;
    if (exposed !== null) return exposed;
    if (e) return false;
    this.checkTarget(t, id);
    return null;
  }

  /** All torches of the room are lit (a room without torches never counts as lit). */
  private torchesLit(): boolean {
    let torches = 0;
    for (const e of this.game.entities) {
      if (e.type !== 'obj.torch' || e.dead) continue;
      torches++;
      const lit = (e as unknown as { lit?: unknown }).lit;
      if (!(typeof lit === 'boolean' ? lit : this.litTorches.has(e.id))) return false;
    }
    return torches > 0;
  }

  private inRegion(t: Trigger, id: string): boolean {
    const p = this.game.player;
    const inst = this.room?.entities.find((i) => i.id === id);
    if (inst) {
      const size = footprint(inst);
      return rectContains({ x: inst.x - size.w / 2, y: inst.y - size.h / 2, w: size.w, h: size.h }, p.x, p.y);
    }
    const e = this.game.findEntity(id);
    if (e) return rectContains(e.hitbox(), p.x, p.y);
    this.checkTarget(t, id);
    return false;
  }

  /** Warn (once) when a condition names an entity that is not in this room. */
  private checkTarget(t: Trigger, id: string): void {
    if (this.room?.entities.some((i) => i.id === id) || this.game.findEntity(id)) return;
    this.warnOnce(`target:${t.id}:${id}`, `trigger "${t.name}" refers to "${id}", which is not in this room`);
  }

  // ------------------------------------------------------------------ actions

  private execute(run: Run, a: Action): void {
    const g = this.game;
    switch (a.kind) {
      case 'openDoor':
      case 'closeDoor':
        this.setDoor(run.trigger, a.target, a.kind === 'openDoor');
        break;
      case 'showEntity':
      case 'hideEntity':
        if (!findEntityInstance(g.project, a.target) && !g.findEntity(a.target)) {
          this.warnMissing(run.trigger, a.target);
          break;
        }
        if (a.kind === 'showEntity') g.showEntity(a.target);
        else g.hideEntity(a.target);
        break;
      case 'setFlag':
        g.setFlag(a.flag, a.value);
        break;
      case 'dialogue':
        this.showDialogue(run, a.dialogue);
        break;
      case 'giveItem': {
        if (!this.knownItem(run.trigger, a.item)) break;
        const fanfare = !QUIET_ITEMS.has(a.item);
        g.giveItem(a.item, a.amount, { fanfare });
        if (fanfare) run.yielded = true;
        break;
      }
      case 'takeItem':
        g.takeItem(a.item, a.amount);
        break;
      case 'setTile':
        this.setTile(run, a);
        break;
      case 'sound':
        g.audio.sfx(a.sfx);
        break;
      case 'music':
        g.audio.music(a.music);
        break;
      case 'secret':
        g.audio.sfx('secret');
        break;
      case 'warp':
        g.warp(a.target);
        run.awaitingRoom = true;
        run.wait = WARP_TIMEOUT;
        break;
      case 'heal':
        g.player.heal(a.amount);
        break;
      case 'shake':
        g.camera.shake(a.seconds);
        break;
      case 'wait':
        run.wait = Math.max(0, a.seconds);
        break;
      default:
        this.warnOnce(`action:${run.trigger.id}:${(a as { kind: string }).kind}`, `trigger "${run.trigger.name}" has an unknown action`);
    }
  }

  /** flush(): a lasting action right away (an item without its fanfare); anything else is dropped. */
  private executeLasting(run: Run, a: Action): void {
    if (!LASTING.has(a.kind)) return;
    if (a.kind !== 'giveItem') this.execute(run, a);
    else if (this.knownItem(run.trigger, a.item)) this.game.giveItem(a.item, a.amount);
  }

  /** Whether a giveItem names a real item; warns (once) and skips it otherwise. */
  private knownItem(t: Trigger, item: string): boolean {
    if (isKnownItem(item)) return true;
    this.warnOnce(`item:${t.id}:${item}`, `trigger "${t.name}" gives "${item}", which is not an item; skipped`);
    return false;
  }

  /** Open/close a live door; a door elsewhere gets its persistent door:<link|id> flag instead. */
  private setDoor(t: Trigger, id: string, open: boolean): void {
    const g = this.game;
    const e = g.findEntity(id);
    if (e?.setOpen) {
      e.setOpen(open);
      return;
    }
    const found = findEntityInstance(g.project, id);
    if (found?.entity.type === 'obj.door' && !e) {
      const link = String(propOf(found.entity, 'link', '')).trim() || id;
      g.setFlag(`door:${link}`, open);
      return;
    }
    this.warnMissing(t, id);
  }

  /** Show a dialogue and block the run until it closes. */
  private showDialogue(run: Run, id: string): void {
    run.awaitingDialogue = true;
    const done = (): void => {
      run.awaitingDialogue = false;
    };
    this.game.dialogue(id).then(done, done);
  }

  /** Persistent tile change in the run's own room: live when the hero is there, else only its tile flag. */
  private setTile(run: Run, a: Extract<Action, { kind: 'setTile' }>): void {
    const { room, world } = run;
    const t = run.trigger;
    if (!Number.isInteger(a.tx) || !Number.isInteger(a.ty)
      || a.tx < 0 || a.ty < 0 || a.tx >= room.gw * SCREEN_COLS || a.ty >= room.gh * SCREEN_ROWS) {
      this.warnOnce(`tile:${t.id}:${a.tx},${a.ty}`, `trigger "${t.name}" sets tile (${a.tx}, ${a.ty}) outside the room`);
      return;
    }
    if (!(LAYERS as readonly string[]).includes(a.layer) || !Number.isInteger(a.tile) || a.tile < 0) {
      this.warnOnce(`tile:${t.id}:${String(a.layer)}:${a.tile}`, `trigger "${t.name}" sets an invalid tile (${String(a.layer)} = ${a.tile})`);
      return;
    }
    const g = this.game;
    const live = g.room;
    const target = live.def.id === room.id && live.world.id === world.id
      ? live
      : new ActiveRoom(g.project, world, room, g.save.flags);
    target.setTile(a.layer, a.tx, a.ty, a.tile, true);
  }

  // ------------------------------------------------------------------ dungeon completion

  private onCrystal(): void {
    const g = this.game;
    const world = g.room.world;
    if (world.kind !== 'dungeon' || this.crystalHandled(world)) return;
    const exit = dungeonExit(world, g.dungeon?.visited[0], g.project.start, g.project.worlds);
    if (g.save.respawn.world === world.id) g.save.respawn = { ...exit };
    const trigger: Trigger = {
      id: `dungeon-complete:${world.id}`, name: 'Dungeon complete', on: 'auto', conditions: [], actions: [], once: false,
    };
    this.start(trigger, [
      { kind: 'wait', seconds: CRYSTAL_JINGLE_DELAY },
      { kind: 'music', music: 'victory' },
      { kind: 'wait', seconds: CRYSTAL_EXIT_DELAY },
      { kind: 'warp', target: exit },
    ], true);
  }

  /** A room trigger or a running sequence takes care of the crystal itself. */
  private crystalHandled(world: World): boolean {
    const flag = crystalFlag(world.id);
    const givesCrystal = (actions: readonly Action[]): boolean =>
      actions.some((a) => a.kind === 'giveItem' && a.item === 'crystal');
    const mentions = (t: Trigger): boolean => givesCrystal(t.actions) || t.conditions.some((c) =>
      (c.kind === 'hasItem' && c.item === 'crystal') || (c.kind === 'flag' && c.flag === flag));
    return this.roomTriggers().some(mentions) || this.runs.some((r) => givesCrystal(r.actions));
  }

  // ------------------------------------------------------------------ warnings

  private warnMissing(t: Trigger, id: string): void {
    this.warnOnce(`missing:${t.id}:${id}`, `trigger "${t.name}": no entity "${id}" to act on`);
  }

  private warnOnce(key: string, message: string): void {
    if (this.warned.has(key)) return;
    this.warned.add(key);
    console.warn(`[triggers] ${message}`);
  }
}

/** The save flag recording that a once-trigger has fired. */
function onceFlag(t: Trigger): string {
  return `trigger:${t.id}`;
}

/** A switch entity's own on/off state when it exposes one (boolean `on` or `pressed`), else null. */
function exposedSwitchState(e: Entity): boolean | null {
  const s = e as unknown as { on?: unknown; pressed?: unknown };
  if (typeof s.on === 'boolean') return s.on;
  if (typeof s.pressed === 'boolean') return s.pressed;
  return null;
}

/** Preference of a warp destination world as a dungeon exit (lower is better; null = never). */
function exitRank(worlds: readonly World[], worldId: string): number | null {
  const kind = worlds.find((w) => w.id === worldId)?.kind;
  return kind === 'overworld' ? 0 : kind === 'interior' ? 1 : null;
}

/**
 * Where a completed dungeon sends the hero: the target of a marker.warp leading
 * out of the dungeon world - into an overworld first, else into an interior
 * (never into another dungeon or a missing world) - searching the entry room
 * first, then the other rooms in order; `fallback` when there is none.
 */
export function dungeonExit(
  world: World, entryRoomId: string | undefined, fallback: WarpTarget, worlds: readonly World[],
): WarpTarget {
  const rooms = [...world.rooms].sort((a, b) => Number(b.id === entryRoomId) - Number(a.id === entryRoomId));
  let best: WarpTarget | null = null;
  let bestRank = Infinity;
  for (const room of rooms) {
    for (const inst of room.entities) {
      if (inst.type !== 'marker.warp') continue;
      const target = inst.props['target'];
      if (!target || typeof target !== 'object' || target.world === world.id) continue;
      const rank = exitRank(worlds, target.world);
      if (rank === null || rank >= bestRank) continue;
      if (rank === 0) return { ...target };
      best = target;
      bestRank = rank;
    }
  }
  return { ...(best ?? fallback) };
}
