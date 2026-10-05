// Proposed mastery levels (1-4) per skill, worked out from the learning log.
// Pure. Levels are never stored: they are recomputed from the evidence, so the
// rules can improve without editing anyone's data, and the teacher (in Quark)
// confirms or adjusts them. Each level lists the events that prove it.
//
// Integrity rules:
// - Levels 1-2 may use any work; levels 3-4 count only triggers the student
//   wrote themselves (facts.authored === 'self'), not ones that came with the
//   sample, an import or a copy of one.
// - "Playtested" means a playtest ran after the work it vouches for.
// - Levels never go down when more events arrive (every rule only adds).
import type { LearningEvent } from './log';
import { LEVEL_NAMES, SKILLS, type Level, type SkillId } from './standards';

export interface SkillLevel {
  skill: SkillId;
  level: Level;
  /** Why: one line per level reached. */
  reasons: string[];
  /** Event ids that prove the level. */
  evidence: string[];
}

type Ev = LearningEvent;

function strings(e: Ev, key: string): string[] {
  const v = e.result?.facts?.[key];
  return Array.isArray(v) ? v : [];
}

function num(e: Ev, key: string): number {
  const v = e.result?.facts?.[key];
  return typeof v === 'number' ? v : 0;
}

function str(e: Ev, key: string): string {
  const v = e.result?.facts?.[key];
  return typeof v === 'string' ? v : '';
}

function flag(e: Ev, key: string): boolean {
  return e.result?.facts?.[key] === true;
}

const self = (e: Ev): boolean => str(e, 'authored') === 'self';
const refOf = (e: Ev): string => `${e.context.projectId}:${e.object.ref ?? ''}`;
const roomOf = (e: Ev): string => `${e.context.projectId}:${e.context.roomId ?? ''}`;

/** Collects the outcome for one skill: the highest level whose test passed, with reasons and evidence. */
class Ladder {
  level: Level = 0;
  readonly reasons: string[] = [];
  readonly evidence = new Set<string>();

  constructor(readonly skill: SkillId) {}

  /** Reach `level` if `proof` is non-empty (proof = the events that show it). */
  step(level: Level, proof: readonly Ev[] | null, reason: string): boolean {
    if (!proof || proof.length === 0 || level !== this.level + 1) return false;
    this.level = level;
    this.reasons.push(`${LEVEL_NAMES[level]}: ${reason}`);
    for (const e of proof) this.evidence.add(e.id);
    return true;
  }

  result(): SkillLevel {
    return { skill: this.skill, level: this.level, reasons: this.reasons, evidence: [...this.evidence] };
  }
}

/** Events of one activity, oldest first. */
function of(events: readonly Ev[], activity: string): Ev[] {
  return events.filter((e) => e.object.activity === activity);
}

/**
 * The first prefix of `list` (oldest first) at which `met` holds, as the events
 * that prove it (null when it never holds).
 */
function firstMet(list: readonly Ev[], met: (prefix: readonly Ev[]) => Ev[] | null): Ev[] | null {
  for (let i = 1; i <= list.length; i++) {
    const proof = met(list.slice(0, i));
    if (proof) return proof;
  }
  return null;
}

/** The first playtest after every event of `proof` (null when none). */
function playtestAfter(playtests: readonly Ev[], proof: readonly Ev[] | null): Ev | null {
  if (!proof || proof.length === 0) return null;
  const last = proof.reduce((t, e) => (e.time > t ? e.time : t), '');
  return playtests.find((p) => p.time > last) ?? null;
}

/** `proof` plus the playtest after it, or null. */
function tested(playtests: readonly Ev[], proof: Ev[] | null): Ev[] | null {
  const pt = playtestAfter(playtests, proof);
  return pt && proof ? [...proof, pt] : null;
}

function inputsOf(e: Ev): string[] {
  const on = str(e, 'on');
  return [...(on && on !== 'auto' ? [`event:${on}`] : []), ...strings(e, 'conditionKinds')];
}

/** Two different triggers where one sets a flag the other reads. */
function flagChain(list: readonly Ev[]): Ev[] | null {
  for (const a of list) {
    for (const f of strings(a, 'setsFlags')) {
      const b = list.find((x) => refOf(x) !== refOf(a) && strings(x, 'readsFlags').includes(f));
      if (b) return [a, b];
    }
  }
  return null;
}

function distinct<T>(xs: readonly T[]): number {
  return new Set(xs).size;
}

function ioLevel(built: Ev[], playtests: Ev[]): SkillLevel {
  const l = new Ladder('prog.io');
  const mine = built.filter(self);
  if (!l.step(1, built.slice(0, 1), 'built a working trigger.')) return l.result();
  const two = firstMet(built, (pre) => (distinct(pre.flatMap(inputsOf)) >= 2 ? pre.filter((e) => inputsOf(e).length > 0) : null));
  if (!l.step(2, two, 'triggers respond to two or more kinds of event or input.')) return l.result();
  const rich = firstMet(mine, (pre) => {
    const ons = distinct(pre.map((e) => str(e, 'on')));
    const ins = distinct(pre.flatMap(inputsOf));
    const outs = distinct(pre.flatMap((e) => strings(e, 'actionKinds')));
    return ons >= 2 && ins >= 3 && outs >= 3 ? [...pre] : null;
  });
  if (!l.step(3, tested(playtests, rich), 'two or more kinds of event, three kinds of input and three kinds of output in their own triggers, playtested.')) return l.result();
  const chain = firstMet(mine, (pre) => {
    const c = flagChain(pre);
    return c && distinct(pre.map(roomOf)) >= 2 ? [...pre] : null;
  });
  l.step(4, tested(playtests, chain), 'chained their triggers through a flag across two or more rooms, playtested.');
  return l.result();
}

function selectionLevel(built: Ev[], playtests: Ev[]): SkillLevel {
  const l = new Ladder('prog.selection');
  const conditional = built.filter((e) => num(e, 'conditions') > 0);
  const mine = conditional.filter(self);
  if (!l.step(1, conditional.slice(0, 1), 'built a working trigger with a condition.')) return l.result();
  const kinds = firstMet(conditional, (pre) => (distinct(pre.flatMap((e) => strings(e, 'conditionKinds'))) >= 2 ? [...pre] : null));
  if (!l.step(2, kinds, 'uses two or more kinds of condition.')) return l.result();
  const compound = mine.find((e) => num(e, 'conditions') >= 2 || flag(e, 'negated'));
  if (!l.step(3, tested(playtests, compound ? [compound] : null), 'wrote a compound ("and") or "not" condition, playtested.')) return l.result();
  const machine = firstMet(mine, (pre) => {
    const c = flagChain(pre);
    const neg = pre.find((e) => flag(e, 'negated'));
    return c && neg ? [...c, neg] : null;
  });
  l.step(4, tested(playtests, machine), 'built a flag state machine (one trigger sets a flag another tests, with a "not" test), playtested.');
  return l.result();
}

function sequenceLevel(built: Ev[], playtests: Ev[]): SkillLevel {
  const l = new Ladder('prog.sequence');
  const multi = built.filter((e) => num(e, 'actions') >= 2);
  if (!l.step(1, multi.slice(0, 1), 'built a working trigger with two or more actions in order.')) return l.result();
  const three = multi.find((e) => num(e, 'actions') >= 3 && distinct(strings(e, 'actionKinds')) >= 2);
  if (!l.step(2, three ? [three] : null, 'built a sequence of three or more actions of two or more kinds.')) return l.result();
  const timed = multi.filter((e) => self(e) && flag(e, 'blockingThenMore'));
  if (!l.step(3, tested(playtests, timed.slice(0, 1)), 'wrote a sequence with a wait or dialogue step followed by more actions, playtested.')) return l.result();
  const many = firstMet(timed, (pre) => (distinct(pre.map(refOf)) >= 3 && distinct(pre.map(roomOf)) >= 2 ? [...pre] : null));
  l.step(4, tested(playtests, many), 'wrote three or more timed sequences across two or more rooms, playtested.');
  return l.result();
}

function traceLevel(events: readonly Ev[], built: Ev[]): SkillLevel {
  const l = new Ladder('prog.trace');
  const viewed = of(events, 'qf.code.viewed');
  if (!l.step(1, viewed.slice(0, 1), 'opened a trigger\'s code view.')) return l.result();
  const mineRefs = new Set(built.filter(self).map(refOf));
  const read = firstMet(viewed, (pre) => (distinct(pre.map(refOf)) >= 3 && pre.some((e) => mineRefs.has(refOf(e))) ? [...pre] : null));
  l.step(2, read, 'read the code of three or more triggers, including their own.');
  return l.result();
}

function debugLevel(events: readonly Ev[], playtests: Ev[]): SkillLevel {
  const l = new Ladder('prog.debug');
  const fixed = of(events, 'qf.trigger.fixed');
  if (!l.step(1, playtests.slice(0, 1), 'ran a playtest.')) return l.result();
  if (!l.step(2, fixed.slice(0, 1), 'fixed a trigger the editor flagged as broken.')) return l.result();
  const two = firstMet(fixed, (pre) => (distinct(pre.map(refOf)) >= 2 ? [...pre] : null));
  if (!l.step(3, tested(playtests, two), 'fixed two or more broken triggers, playtested.')) return l.result();
  const checked = fixed.filter((f) => playtestAfter(playtests, [f]));
  const four = firstMet(checked, (pre) => (pre.length >= 4 && distinct(pre.map(roomOf)) >= 2 ? [...pre] : null));
  l.step(4, four ? [...four, ...four.map((f) => playtestAfter(playtests, [f])!)] : null,
    'fixed four or more problems across two or more rooms, each followed by a playtest.');
  return l.result();
}

function imagesLevel(events: readonly Ev[]): SkillLevel {
  const l = new Ladder('data.images');
  const inspected = of(events, 'qf.pixels.inspected');
  const drawn = of(events, 'qf.pixels.drawn');
  const palette = of(events, 'qf.palette.edited');
  if (!l.step(1, inspected.slice(0, 1), 'opened "Under the hood" for an image.')) return l.result();
  if (!l.step(2, drawn.slice(0, 1), 'drew pixel art.')) return l.result();
  const all = inspected[0] && drawn[0] && palette[0] ? [inspected[0], drawn[0], palette[0]] : null;
  if (!l.step(3, all, 'drew pixel art, changed palette colours and inspected the bits.')) return l.result();
  const tile = drawn.find((e) => str(e, 'assetKind') === 'tile');
  const sprite = drawn.find((e) => str(e, 'assetKind') === 'sprite');
  const anim = drawn.find((e) => self(e) && num(e, 'frames') >= 2);
  l.step(4, tile && sprite ? [tile, sprite] : anim ? [anim] : null, 'did it for both a tile and a sprite, or animated their own asset.');
  return l.result();
}

/** Proposed level for every skill in the catalog (events in any order). */
export function proposeLevels(events: readonly LearningEvent[]): SkillLevel[] {
  const sorted = [...events].sort((a, b) => a.time.localeCompare(b.time));
  const built = of(sorted, 'qf.trigger.built');
  const playtests = of(sorted, 'qf.playtest.run');
  const byId: Record<SkillId, SkillLevel> = {
    'prog.io': ioLevel(built, playtests),
    'prog.selection': selectionLevel(built, playtests),
    'prog.sequence': sequenceLevel(built, playtests),
    'prog.trace': traceLevel(sorted, built),
    'prog.debug': debugLevel(sorted, playtests),
    'data.images': imagesLevel(sorted),
  };
  return SKILLS.map((s) => byId[s.id]);
}
