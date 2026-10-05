// Watches the editor and records learning evidence: the triggers a student
// gets working (with their code as the work sample), broken triggers they fix,
// pixel and palette edits, playtests, and the "code" / "under the hood" views.
// Listens on the editor bus only, so no panel has to know about it (the views
// and the shell call the note* helpers for what the bus does not carry).
//
// Authorship: what the project holds when the editor opens is the baseline.
// A trigger counts as the student's own ('self') when it was made in the
// editor and is not an unchanged copy of baseline work, or when the log already
// credits it to them; one that came with the project (the sample, an import) and
// was then changed is 'modified'. Unchanged baseline work is never recorded.
import type { EditorContext } from '../editor/context';
import type { Project, Room, Trigger } from '../core/types';
import { triggerIssues } from '../editor/entities/triggerText';
import { triggerCode } from '../editor/entities/triggerCode';
import { listLearning, recordLearning, setLearningContext, type Facts } from './log';

/** Quiet time after the last edit before triggers are looked at again (ms). */
const SCAN_DELAY = 1500;
/** Quiet time after the last pixel edit of one asset before it is recorded (ms). */
const ASSET_DELAY = 2500;

type Authored = 'self' | 'inherited' | 'modified';

/** Learning facts about one trigger (what levels.ts reads). */
export function triggerFacts(t: Trigger, authored: 'self' | 'modified'): Facts {
  const blocking = t.actions.findIndex((a) => a.kind === 'wait' || a.kind === 'dialogue');
  return {
    on: t.on,
    once: t.once,
    conditions: t.conditions.length,
    conditionKinds: [...new Set(t.conditions.map((c) => c.kind))],
    actions: t.actions.length,
    actionKinds: [...new Set(t.actions.map((a) => a.kind))],
    negated: t.conditions.some((c) => (c.kind === 'flag' && !c.value) || (c.kind === 'switch' && !c.on)),
    blockingThenMore: blocking >= 0 && blocking < t.actions.length - 1,
    setsFlags: [...new Set(t.actions.flatMap((a) => (a.kind === 'setFlag' && a.flag.trim() ? [a.flag.trim()] : [])))],
    readsFlags: [...new Set(t.conditions.flatMap((c) => (c.kind === 'flag' && c.flag.trim() ? [c.flag.trim()] : [])))],
    authored,
  };
}

interface TriggerState {
  body: string;
  working: boolean;
  /** The trigger broke after working, or came broken with the project: making it work counts as a fix. */
  fixable: boolean;
  authored: Authored;
}

function eachTrigger(p: Project, fn: (room: Room, t: Trigger, ref: string) => void): void {
  for (const w of p.worlds) for (const r of w.rooms) for (const t of r.triggers) fn(r, t, `${r.id}/${t.id}`);
}

function working(p: Project, room: Room, t: Trigger): boolean {
  return t.actions.length > 0 && triggerIssues(p, room, t).length === 0;
}

/** Pixel content of a tile / sprite (null when gone). */
function assetPixels(p: Project, key: string): { data: string; first: string; frames: number; name: string; kind: 'tile' | 'sprite' } | null {
  const [kind, id] = [key.slice(0, key.indexOf(':')), key.slice(key.indexOf(':') + 1)];
  const a = kind === 'tile' ? p.tiles.find((t) => String(t.id) === id) : kind === 'sprite' ? p.sprites.find((s) => s.id === id) : undefined;
  if (!a) return null;
  return { data: a.frames.join('|'), first: a.frames[0] ?? '', frames: a.frames.length, name: a.name, kind: kind as 'tile' | 'sprite' };
}

function paletteColours(p: Project, id: string): string | null {
  return p.palettes.find((x) => x.id === id)?.colors.join(',') ?? null;
}

/** Palette indices used by pixel data (transparent 0 excluded). */
function coloursUsed(data: string): number {
  return new Set(data.replace(/[|0]/g, '')).size;
}

// Session-wide de-duplication for the "looked at it" notes.
const viewed = new Set<string>();

class EditorObserver {
  private readonly triggers = new Map<string, TriggerState>();
  /** Bodies of baseline triggers that are not the student's: copying one unchanged is not new work. */
  private readonly inheritedBodies = new Set<string>();
  private readonly assets = new Map<string, string>();
  private readonly baselineAssets = new Set<string>();
  private readonly palettes = new Map<string, string>();
  private readonly assetTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private scanTimer: ReturnType<typeof setTimeout> | undefined;
  /** A scan was asked for (it waits for the baseline when that is still loading). */
  private scanPending = false;
  private ready = false;
  private readonly offs: (() => void)[] = [];

  constructor(private readonly ctx: EditorContext) {
    const p = ctx.project;
    setLearningContext({ projectId: () => ctx.project.id, projectName: () => ctx.project.name, mode: 'editor' });
    for (const t of p.tiles) this.baselineAssets.add(`tile:${t.id}`);
    for (const s of p.sprites) this.baselineAssets.add(`sprite:${s.id}`);
    for (const key of this.baselineAssets) this.assets.set(key, assetPixels(p, key)?.data ?? '');
    for (const pal of p.palettes) this.palettes.set(pal.id, pal.colors.join(','));
    this.offs.push(
      ctx.bus.on('project', ({ what }) => {
        if (what === 'triggers' || what === 'entities' || what === 'dialogues' || what === 'tiles'
          || what === 'room' || what === 'rooms' || what === 'worlds' || what === 'all') this.schedule();
      }),
      ctx.bus.on('undo', () => this.schedule()),
      ctx.bus.on('assets', ({ kind, id }) => {
        if (id === undefined) return;
        if (kind === 'palette') this.later(`palette:${id}`);
        else if (kind === 'tile' || kind === 'sprite') this.later(`${kind}:${id}`);
      }),
    );
    void this.loadBaseline();
  }

  /** Read who wrote what from the log, then take the trigger baseline. */
  private async loadBaseline(): Promise<void> {
    const credited = new Map<string, 'self' | 'modified'>();
    try {
      for (const e of await listLearning()) {
        if (e.context.projectId !== this.ctx.project.id || e.object.activity !== 'qf.trigger.built' || !e.object.ref) continue;
        const a = e.result?.facts?.authored;
        if (a === 'self' || a === 'modified') credited.set(e.object.ref, a);
      }
    } catch {
      // No log: everything already in the project counts as baseline.
    }
    const p = this.ctx.project;
    eachTrigger(p, (room, t, ref) => {
      const body = triggerCode(p, room, t, false);
      const authored = credited.get(ref) ?? 'inherited';
      const ok = working(p, room, t);
      this.triggers.set(ref, { body, working: ok, fixable: !ok, authored });
      if (authored === 'inherited') this.inheritedBodies.add(body);
    });
    this.ready = true;
    if (this.scanPending) this.scan();
  }

  private schedule(): void {
    clearTimeout(this.scanTimer);
    this.scanPending = true;
    this.scanTimer = setTimeout(() => this.scan(), SCAN_DELAY);
  }

  /** Look at every trigger and record the ones that started working or changed while working. */
  scan(): void {
    clearTimeout(this.scanTimer);
    this.scanTimer = undefined;
    this.scanPending = true;
    if (!this.ready) return;
    this.scanPending = false;
    const p = this.ctx.project;
    eachTrigger(p, (room, t, ref) => {
      const body = triggerCode(p, room, t, false);
      const ok = working(p, room, t);
      let s = this.triggers.get(ref);
      if (!s) {
        // New in this session: an unchanged copy of baseline work is not new work.
        const copy = this.inheritedBodies.has(body);
        s = { body: copy ? body : '', working: false, fixable: false, authored: copy ? 'inherited' : 'self' };
        this.triggers.set(ref, s);
      }
      if (s.working && !ok) s.fixable = true;
      if (ok && body !== s.body) {
        if (s.authored === 'inherited') s.authored = 'modified';
        const authored = s.authored === 'self' ? 'self' : 'modified';
        const data = {
          ref, name: t.name || t.id, roomId: room.id,
          response: triggerCode(p, room, t), facts: triggerFacts(t, authored),
        };
        if (s.fixable) recordLearning('qf.trigger.fixed', data);
        recordLearning('qf.trigger.built', data);
        s.body = body;
        s.fixable = false;
      } else if (ok && s.fixable) {
        // Fixed back to the code it had while it last worked (e.g. a deleted target put back).
        recordLearning('qf.trigger.fixed', {
          ref, name: t.name || t.id, roomId: room.id, response: triggerCode(p, room, t),
          facts: triggerFacts(t, s.authored === 'self' ? 'self' : 'modified'),
        });
        s.fixable = false;
      }
      s.working = ok;
    });
  }

  private later(key: string): void {
    clearTimeout(this.assetTimers.get(key));
    this.assetTimers.set(key, setTimeout(() => this.recordAsset(key), ASSET_DELAY));
  }

  private recordAsset(key: string): void {
    this.assetTimers.delete(key);
    const p = this.ctx.project;
    if (key.startsWith('palette:')) {
      const id = key.slice('palette:'.length);
      const colours = paletteColours(p, id);
      if (colours === null || colours === this.palettes.get(id)) return;
      const before = (this.palettes.get(id) ?? '').split(',');
      const now = colours.split(',');
      this.palettes.set(id, colours);
      recordLearning('qf.palette.edited', {
        ref: key, name: p.palettes.find((x) => x.id === id)?.name ?? id, response: colours,
        facts: { paletteId: id, changed: now.filter((c, i) => c !== before[i]).length },
      });
      return;
    }
    const a = assetPixels(p, key);
    if (!a || a.data === this.assets.get(key)) return;
    this.assets.set(key, a.data);
    recordLearning('qf.pixels.drawn', {
      ref: key, name: a.name, response: a.first,
      facts: {
        assetKind: a.kind, frames: a.frames, colours: coloursUsed(a.data),
        authored: this.baselineAssets.has(key) ? 'modified' : 'self',
      },
    });
  }

  destroy(): void {
    for (const off of this.offs.splice(0)) off();
    if (this.scanPending && this.ready) this.scan();
    clearTimeout(this.scanTimer);
    for (const key of [...this.assetTimers.keys()]) {
      clearTimeout(this.assetTimers.get(key));
      this.recordAsset(key);
    }
    setLearningContext(null);
  }
}

let current: EditorObserver | null = null;

/** Start recording for an open editor; returns the stop function (which records pending edits first). */
export function observeEditor(ctx: EditorContext): () => void {
  current?.destroy();
  const obs = new EditorObserver(ctx);
  current = obs;
  return () => {
    obs.destroy();
    if (current === obs) current = null;
  };
}

/** The student opened a trigger's code view (once per trigger per page load). */
export function noteCodeViewed(room: Room, t: Trigger): void {
  const ref = `${room.id}/${t.id}`;
  if (!current || viewed.has(`code:${ref}`)) return;
  viewed.add(`code:${ref}`);
  recordLearning('qf.code.viewed', { ref, name: t.name || t.id, roomId: room.id });
}

/** The student opened "Under the hood" on an image (once per asset per page load). */
export function noteInspected(kind: 'tile' | 'sprite', id: string | number, name: string): void {
  const ref = `${kind}:${id}`;
  if (!current || viewed.has(`hood:${ref}`)) return;
  viewed.add(`hood:${ref}`);
  recordLearning('qf.pixels.inspected', { ref, name, facts: { assetKind: kind } });
}

/** A playtest started (pending trigger edits are recorded first, so the playtest comes after them). */
export function notePlaytest(roomId?: string): void {
  if (!current) return;
  current.scan();
  recordLearning('qf.playtest.run', { ref: roomId, roomId });
}

/** The project was exported as a file. */
export function noteExported(): void {
  if (!current) return;
  recordLearning('qf.project.exported', {});
}
