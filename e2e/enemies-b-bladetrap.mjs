// Enemies B: blade trap. Sits still; when the hero lines up on its allowed axis
// within `range` tiles it slides out fast (over pits) until a wall, another
// trap or its range, then creeps back home; hemmed in by a solid object it stays
// put, and an object set down in its lane while it is out holds its retract
// until the way clears. Invulnerable, contact damage 2, not needed to clear a
// room. Set in a two-lane corridor walled with DBLOCK tiles.

/** DBLOCK walls above and below lanes ty 6-7, plus a 2x2 pit at tx 6-7. */
const CORRIDOR = [
  { tx: 1, ty: 5, w: 14, tile: 'DBLOCK' },
  { tx: 1, ty: 8, w: 14, tile: 'DBLOCK' },
  { layer: 'bg', tx: 6, ty: 6, tile: 'PIT_NW' },
  { layer: 'bg', tx: 7, ty: 6, tile: 'PIT_NE' },
  { layer: 'bg', tx: 6, ty: 7, tile: 'PIT_SW' },
  { layer: 'bg', tx: 7, ty: 7, tile: 'PIT_SE' },
];
const LANE_Y = 6 * 16 + 8;

async function arena(t, cfg) {
  await t.goto('#/');
  await t.eval(async (c) => (await import('/src/dev/arena.ts')).startArena(c), cfg);
  await t.until(() => !!(window.__qf.game && window.__qf.game.services), undefined, 5000);
}

const trap = (t, id) => t.eval((tid) => {
  const e = window.__qf.game.services.findEntity(tid);
  return e ? { x: e.x, y: e.y, left: e.left, right: e.right, phase: e.phase, facing: e.facing } : null;
}, id);

const phaseIs = (t, id, phase, ms) => t.until(
  ([tid, p]) => window.__qf.game.services.findEntity(tid)?.phase === p, [id, phase], ms,
);

export default async function (t) {
  // Mock Vite's HMR socket so edits elsewhere in the repo can't reload the page mid-scenario.
  await t.page.routeWebSocket(/./, () => {});
  // ---- Hero steps into the trap's lane: it shoots across the pit, hits, stops at the wall, retracts.
  await arena(t, {
    theme: 'dungeon', hearts: 10, player: { x: 200, y: LANE_Y + 16, dir: 'left' },
    tiles: CORRIDOR,
    entities: [{ id: 'bt', type: 'enemy.bladeTrap', x: 24, y: LANE_Y, props: { range: 13 } }],
  });
  await t.wait(900);
  let b = await trap(t, 'bt');
  t.assert(b.phase === 'idle', `waits while the hero is in the other lane (${b.phase})`);
  await t.shotCanvas('armed');
  await t.eval((y) => { window.__qf.game.services.player.place(200, y, 'left'); }, LANE_Y);
  await phaseIs(t, 'bt', 'slide', 1000);
  await t.until(() => window.__qf.game.services.findEntity('bt').x > 104, undefined, 1000);
  b = await trap(t, 'bt');
  t.log('sliding', b);
  t.assert(b.facing === 'right' && b.y === LANE_Y, 'slides straight along the lane');
  await t.shotCanvas('slide-over-pit');
  await phaseIs(t, 'bt', 'hold', 2000);
  b = await trap(t, 'bt');
  const hp = await t.eval(() => window.__qf.game.services.save.hp);
  t.log('hold', b, 'hp', hp);
  t.assert(b.right === 240, `stops flush at the wall (right ${b.right})`);
  t.assert(hp === 18, `blade hit takes a whole heart (hp=${hp})`);
  await t.shotCanvas('at-wall');
  await phaseIs(t, 'bt', 'retract', 1000);
  await t.eval(() => { window.__qf.game.services.player.place(40, 190, 'up'); });
  await t.wait(1500);
  b = await trap(t, 'bt');
  t.log('retracting', b);
  t.assert(b.phase === 'retract' && b.x < 220 && b.x > 120, `creeps back slowly (x ${b.x.toFixed(1)})`);
  await t.shotCanvas('retract');
  await phaseIs(t, 'bt', 'idle', 6000);
  b = await trap(t, 'bt');
  t.assert(b.x === 24 && b.y === LANE_Y, `home again (${b.x},${b.y})`);
  const hurt = await t.eval(() => {
    const s = window.__qf.game.services;
    return s.findEntity('bt').hurt({ damage: 3, kind: 'sword', source: s.player, dx: -1, dy: 0 });
  });
  t.assert(hurt === false, 'invulnerable');
  t.assert(await t.eval(() => window.__qf.game.services.enemiesCleared()), 'does not count toward clearing the room');

  // ---- Two traps facing each other close on the hero and stop against each other.
  await arena(t, {
    theme: 'dungeon', hearts: 10, player: { x: 40, y: 190, dir: 'up' },
    tiles: CORRIDOR,
    entities: [
      { id: 'a', type: 'enemy.bladeTrap', x: 24, y: LANE_Y, props: { range: 14 } },
      { id: 'b', type: 'enemy.bladeTrap', x: 232, y: LANE_Y, props: { range: 14 } },
      { id: 'v', type: 'enemy.bladeTrap', x: 184, y: LANE_Y + 16, props: { axis: 'vertical' } },
    ],
  });
  await t.wait(600);
  await t.eval((y) => { window.__qf.game.services.player.place(144, y + 16, 'up'); }, LANE_Y);
  await t.wait(700);
  t.assert((await trap(t, 'v')).phase === 'idle', 'a vertical-axis trap ignores a hero in its row');
  await t.eval((y) => { window.__qf.game.services.player.place(144, y, 'up'); }, LANE_Y);
  await t.until(() => ['a', 'b'].every((id) => {
    const p = window.__qf.game.services.findEntity(id)?.phase;
    return p === 'hold' || p === 'retract';
  }), undefined, 2000);
  const a = await trap(t, 'a');
  const c = await trap(t, 'b');
  t.log('met', a, c);
  t.assert(Math.abs(a.right - c.left) < 0.5, `traps stop against each other (${a.right} vs ${c.left})`);
  await t.shotCanvas('traps-meet');

  // ---- A block right in front of the trap: it stays put instead of clanking on the spot.
  await arena(t, {
    theme: 'dungeon', hearts: 10, player: { x: 200, y: LANE_Y, dir: 'left' },
    tiles: CORRIDOR,
    entities: [
      { id: 'bt', type: 'enemy.bladeTrap', x: 24, y: LANE_Y, props: { range: 13 } },
      { id: 'blk', type: 'obj.block', x: 40, y: LANE_Y },
    ],
  });
  await t.eval(() => {
    const a = window.__qf.game.services.audio;
    const orig = a.sfx.bind(a);
    window.__sfx = [];
    a.sfx = (id, o) => { window.__sfx.push(id); orig(id, o); };
  });
  await t.wait(1500);
  b = await trap(t, 'bt');
  const clanks = await t.eval(() => window.__sfx.filter((x) => x === 'swordTink').length);
  t.log('hemmed in', b, 'clanks', clanks);
  t.assert(b.phase === 'idle' && b.x === 24, `stays home behind the block (${b.phase}, x ${b.x})`);
  t.assert(clanks === 0, `no clanking on the spot (${clanks})`);
  await t.shotCanvas('hemmed-in');

  // ---- A pot set down in its lane while it is out: the retract stops against it and waits.
  await arena(t, {
    theme: 'dungeon', hearts: 10, player: { x: 200, y: LANE_Y, dir: 'left' },
    tiles: CORRIDOR,
    entities: [{ id: 'bt', type: 'enemy.bladeTrap', x: 24, y: LANE_Y, props: { range: 13 } }],
  });
  await t.eval(() => { window.__qf.game.services.debug.invincible = true; });
  await phaseIs(t, 'bt', 'hold', 3000);
  await t.eval(async (y) => {
    const s = window.__qf.game.services;
    const { createEntity } = await import('/src/game/registry.ts');
    s.spawn(createEntity(s, { id: 'pot1', type: 'obj.pot', x: 152, y, props: {} }));
    s.player.place(40, 190, 'up');
  }, LANE_Y);
  await t.wait(2500);
  const held = await t.eval(() => {
    const s = window.__qf.game.services;
    const e = s.findEntity('bt');
    const p = s.findEntity('pot1');
    return { phase: e.phase, left: e.left, potRight: p.right, overlap: e.overlaps(p) };
  });
  t.log('held by the pot', held);
  t.assert(held.phase === 'retract' && !held.overlap && Math.abs(held.left - held.potRight) < 0.5, `waits flush against the pot (${JSON.stringify(held)})`);
  await t.shotCanvas('held-by-pot');
  await t.eval(() => { window.__qf.game.services.findEntity('pot1').dead = true; });
  await phaseIs(t, 'bt', 'idle', 6000);
  b = await trap(t, 'bt');
  t.assert(b.x === 24 && b.y === LANE_Y, `home once the lane clears (${b.x},${b.y})`);
  await t.shotCanvas('home-after-pot');
}
