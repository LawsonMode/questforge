// Objects: the rules that keep rooms fair — push blocks never seal a doorway or
// stairs, open doorways keep their stone jambs solid, a key pot leaves a one-time
// key that never times out (nor do enemy key drops), the shop refuses purchases
// that would give nothing, pegs never rise under an enemy, an NPC interrupted
// mid-step lingers after a talk, the hero's body reaches pickups just above its
// feet, and a reveal in a room whose only object is a door still sparkles.

async function arena(t, cfg) {
  await t.goto('#/');
  await t.eval(async (c) => (await import('/src/dev/arena.ts')).startArena(c), cfg);
  await t.until(() => !!(window.__qf.game && window.__qf.game.services), undefined, 5000);
  // Page-side shorthand used inside t.eval callbacks.
  await t.eval(() => { window.S = () => window.__qf.game.services; });
  await t.wait(150);
}

const hero = (t) => t.eval(() => ({ x: S().player.x, y: S().player.y, st: S().player.state }));

/** Count calls to a hook on an entity (to tell real input from a direct call). */
const spy = (t, id, hook) => t.eval(([eid, h]) => {
  const e = S().findEntity(eid);
  const orig = e[h].bind(e);
  e.__calls = 0;
  e[h] = (...a) => { e.__calls++; return orig(...a); };
}, [id, hook]);
const calls = (t, id) => t.eval((eid) => S().entities.find((x) => x.id === eid)?.__calls ?? 0, id);

/** Record every sound effect played from now on (fresh page per arena, so wrapping once is safe). */
const recordSfx = (t) => t.eval(() => {
  const a = S().audio;
  const orig = a.sfx.bind(a);
  window.__sfx = [];
  a.sfx = (id, o) => { window.__sfx.push(id); orig(id, o); };
});

async function closeDialogue(t) {
  for (let i = 0; i < 12; i++) {
    if ((await t.eval(() => window.__qf.game.state)) !== 'dialogue') return;
    await t.press('KeyX', 50);
    await t.wait(150);
  }
}

/** Action button on an entity; falls back to onInteract() when the button did not reach it. */
async function interact(t, id) {
  await spy(t, id, 'onInteract');
  await t.press('KeyX', 60);
  await t.wait(120);
  if ((await calls(t, id)) > 0) return 'button';
  await t.eval((eid) => S().findEntity(eid).onInteract(), id);
  await t.wait(60);
  return 'direct';
}

/**
 * Other agents saving files mid-run make Vite full-reload the page; mock its HMR
 * socket for this page (kept open, no server) so the scenario can't be reloaded.
 */
const isolateFromHmr = (t) => t.page.routeWebSocket(() => true, () => {});

export default async function (t) {
  await isolateFromHmr(t);
  // ---------------------------------------------------------------- blocks never seal an exit
  await arena(t, {
    theme: 'dungeon', worldKind: 'dungeon', player: { x: 128, y: 70, dir: 'up' },
    tiles: [{ layer: 'bg', tx: 9, ty: 9, tile: 'DSTAIRS_DOWN' }],
    entities: [
      { id: 'door', type: 'obj.door', x: 128, y: 8, props: { dir: 'up', kind: 'open' } },
      { id: 'b1', type: 'obj.block', x: 128, y: 24, props: { pushes: 'once' } },
      { id: 'b2', type: 'obj.block', x: 136, y: 152, props: { pushes: 'once' } },
      { id: 'stairs', type: 'marker.warp', x: 152, y: 152, props: { target: { world: 'arena', room: 'arena_room', x: 60, y: 180 } } },
    ],
  });
  await spy(t, 'b1', 'onPush');
  await t.hold(['ArrowUp'], 1200);
  const push1 = await calls(t, 'b1');
  const b1 = await t.eval(() => { const b = S().findEntity('b1'); return [b.x, b.y]; });
  t.log('pushes into the doorway', push1);
  t.assert(push1 > 0, 'the hero really pushed the block (real input)');
  t.assert(b1[0] === 128 && b1[1] === 24, `block refuses to enter the open doorway (${b1})`);
  await t.eval(() => S().player.place(100, 70, 'right'));
  await t.wait(80);
  await t.shotCanvas('block-stays-out-of-doorway');
  await t.eval(() => S().player.place(110, 152, 'right'));
  await spy(t, 'b2', 'onPush');
  await t.hold(['ArrowRight'], 1100);
  const b2 = await t.eval(() => { const b = S().findEntity('b2'); return { at: [b.x, b.y], covered: S().findEntity('stairs').contains(b.x, b.y) }; });
  t.assert((await calls(t, 'b2')) > 0 && b2.at[0] === 136 && !b2.covered, `block refuses the stairs warp (${JSON.stringify(b2)})`);
  await t.shotCanvas('block-stays-off-stairs');

  // ---------------------------------------------------------------- doorway jambs
  await arena(t, {
    theme: 'dungeon', player: { x: 113, y: 60, dir: 'up' },
    entities: [{ id: 'door', type: 'obj.door', x: 128, y: 8, props: { dir: 'up', kind: 'open' } }],
  });
  await t.hold(['ArrowUp'], 900);
  const offCentre = await hero(t);
  t.assert(offCentre.y > 20, `a hero 5 px onto the jamb is stopped by the frame (${JSON.stringify(offCentre)})`);
  await t.eval(() => S().player.place(118, 60, 'up'));
  await t.hold(['ArrowUp'], 900);
  const funnelled = await hero(t);
  t.assert(funnelled.y < 16 && funnelled.x >= 123.5 && funnelled.x <= 132.5, `a hero slightly off-centre is funnelled into the gap (${JSON.stringify(funnelled)})`);
  await t.shotCanvas('hero-in-doorway-gap');
  await t.eval(() => { S().debug.hitboxes = true; });
  await t.wait(50);
  await t.shotCanvas('doorway-jamb-hitboxes');
  await t.eval(() => { S().debug.hitboxes = false; });

  // ---------------------------------------------------------------- key pot + enemy key drop
  await arena(t, {
    theme: 'dungeon', worldKind: 'dungeon', player: { x: 128, y: 130, dir: 'up' },
    entities: [
      { id: 'kpot', type: 'obj.pot', x: 128, y: 104, props: { contents: 'smallKey' } },
      { id: 'ksold', type: 'enemy.soldier', x: 48, y: 48, props: { behavior: 'guard', facing: 'down', drop: 'smallKey' } },
    ],
  });
  await t.eval(() => { S().debug.invincible = true; S().findEntity('ksold').die(); });
  await t.hold(['ArrowUp'], 300);
  await t.press('KeyX', 60);
  await t.wait(450);
  const lifted = await t.eval(() => {
    const k = S().findEntity('kpot-key');
    const d = S().findEntity('ksold-key');
    return { st: S().player.state, key: k ? { x: k.x, y: k.y, z: k.z, transient: k.transient } : null, drop: d ? { item: d.item, transient: d.transient } : null };
  });
  t.log('pot lifted', lifted);
  t.assert(lifted.st === 'carry' && lifted.key && lifted.key.x === 128 && lifted.key.y === 104 && lifted.key.z === 0 && !lifted.key.transient,
    `lifting the key pot leaves a placed key on its spot (${JSON.stringify(lifted)})`);
  t.assert(lifted.drop?.item === 'smallKey' && !lifted.drop.transient, `the soldier left its key as a placed pickup (${JSON.stringify(lifted.drop)})`);
  // Carry the pot away before throwing it, so the key stays on the floor while we wait.
  await t.hold(['ArrowDown'], 400);
  await t.shotCanvas('key-left-where-the-pot-stood');
  await t.press('KeyX', 60);
  await t.wait(10800);
  const later = await t.eval(() => ({ potKey: !!S().findEntity('kpot-key'), dropKey: !!S().findEntity('ksold-key') }));
  t.assert(later.potKey && later.dropKey, `neither key timed out after 11 s (${JSON.stringify(later)})`);
  await t.shotCanvas('keys-still-there-after-11s');
  await t.eval(() => S().player.place(128, 118, 'up'));
  await t.hold(['ArrowUp'], 300);
  await t.eval(() => S().player.place(48, 70, 'up'));
  await t.hold(['ArrowUp'], 400);
  const keys = await t.eval(() => ({ keys: S().dungeon.keys, flag: S().flag('pickup:kpot-key') && S().flag('pickup:ksold-key') }));
  t.assert(keys.keys === 2 && keys.flag, `both keys collected by walking onto them (${JSON.stringify(keys)})`);
  await t.eval(() => window.__qf.game.warpNow({ world: 'arena', room: 'arena_room', x: 128, y: 130, dir: 'up' }));
  await t.wait(200);
  const pot = await t.eval(() => S().findEntity('kpot')?.contents ?? null);
  t.assert(pot === 'random', `after re-entry the pot holds ordinary loot, not another key (${pot})`);

  // ---------------------------------------------------------------- shop refusals
  await arena(t, {
    theme: 'interior', player: { x: 96, y: 102, dir: 'up' },
    entities: [
      { id: 'bombsForSale', type: 'obj.shopItem', x: 96, y: 88, props: { item: 'bombs', amount: 5, price: 30 } },
      { id: 'bowForSale', type: 'obj.shopItem', x: 160, y: 88, props: { item: 'bow', amount: 1, price: 120 } },
    ],
  });
  await t.eval(() => { const s = S().save; s.rupees = 300; s.bombs = s.maxBombs; s.items.bombs = 1; s.items.bow = 1; });
  await recordSfx(t);
  let how = await interact(t, 'bombsForSale');
  await t.wait(400);
  const full = await t.eval(() => ({ rupees: S().save.rupees, game: window.__qf.game.state, sfx: window.__sfx }));
  t.log('full-bombs purchase via', how, full);
  t.assert(full.rupees === 300 && full.game === 'dialogue' && full.sfx.includes('error'), `no charge when bombs are full (${JSON.stringify(full)})`);
  await t.shotCanvas('shop-cant-carry-more');
  await closeDialogue(t);
  await t.eval(() => S().player.place(160, 102, 'up'));
  await t.wait(100);
  how = await interact(t, 'bowForSale');
  await t.wait(400);
  const owned = await t.eval(() => ({ rupees: S().save.rupees, game: window.__qf.game.state, st: S().player.state }));
  t.assert(owned.rupees === 300 && owned.game === 'dialogue' && owned.st !== 'itemGet', `an owned bow is not sold again (${JSON.stringify(owned)})`);
  await t.shotCanvas('shop-already-owned');
  await closeDialogue(t);

  // ---------------------------------------------------------------- pegs never trap an enemy
  await arena(t, {
    theme: 'dungeon', player: { x: 56, y: 126, dir: 'up' },
    entities: [
      { id: 'cs', type: 'obj.crystalSwitch', x: 56, y: 104 },
      { id: 'peg', type: 'obj.peg', x: 168, y: 104, props: { color: 'blue' } },
      { id: 'foe', type: 'enemy.soldier', x: 168, y: 104, props: { behavior: 'guard', facing: 'down', drop: 'none' } },
    ],
  });
  // Freeze the soldier's AI on its post (stunned), so only the peg rule is tested.
  await t.eval(() => { S().debug.invincible = true; S().findEntity('foe').stun = 60; });
  await t.press('KeyZ', 60);
  await t.wait(300);
  const peg = await t.eval(() => {
    const p = S().findEntity('peg');
    const f = S().findEntity('foe');
    return { pegState: S().pegState(), raised: p.raised, anim: p.anim, stuck: f.isBlockedAt(f.x, f.y) };
  });
  t.assert(peg.pegState && !peg.raised && peg.anim === 'blue_down' && !peg.stuck, `peg waits under the soldier (${JSON.stringify(peg)})`);
  await t.shotCanvas('peg-waits-under-soldier');
  await t.eval(() => { const f = S().findEntity('foe'); f.x = 200; f.y = 160; });
  await t.wait(100);
  t.assert(await t.eval(() => S().findEntity('peg').raised), 'peg rises once the soldier has moved off');
  await t.shotCanvas('peg-risen');

  // ---------------------------------------------------------------- NPC lingers after a talk
  await arena(t, {
    theme: 'interior', player: { x: 40, y: 200, dir: 'up' },
    entities: [{ id: 'w', type: 'npc.person', x: 128, y: 100, props: { behavior: 'wander', sprite: 'npc.child', name: 'Pip', dialogue: 'Hello!' } }],
  });
  await t.until(() => S().findEntity('w').anim.startsWith('walk'), undefined, 8000);
  const talk = await t.eval(() => {
    const e = S().findEntity('w');
    const back = { up: [0, 1], down: [0, -1], left: [1, 0], right: [-1, 0] }[e.facing];
    S().player.place(e.x + back[0] * 16, e.y + back[1] * 16);
    e.onInteract();
    return { faced: e.facing };
  });
  await t.wait(200);
  await closeDialogue(t);
  const trail = [];
  for (let i = 0; i < 8; i++) {
    trail.push(await t.eval(() => { const e = S().findEntity('w'); return [Math.round(e.x * 10) / 10, Math.round(e.y * 10) / 10, e.facing]; }));
    await t.wait(100);
  }
  t.log('npc after the talk', talk, trail);
  t.assert(trail.every((p) => p[0] === trail[0][0] && p[1] === trail[0][1] && p[2] === talk.faced), `the NPC lingers facing the hero (${JSON.stringify(trail)})`);

  // ---------------------------------------------------------------- body reach + reveal in a door-only room
  await arena(t, {
    theme: 'dungeon', player: { x: 128, y: 170, dir: 'up' },
    entities: [
      { id: 'door', type: 'obj.door', x: 128, y: 8, props: { dir: 'up', kind: 'open' } },
      { id: 'hrt', type: 'obj.pickup', x: 128, y: 100, props: { item: 'heart', amount: 1 } },
      { id: 'hc', type: 'obj.chest', x: 200, y: 72, props: { item: 'rupees', amount: 5, hidden: true } },
    ],
  });
  await t.eval(() => {
    const s = S();
    const orig = s.giveItem.bind(s);
    window.__gotAt = null;
    s.giveItem = (...a) => { window.__gotAt = window.__gotAt ?? s.player.y; orig(...a); };
  });
  await t.hold(['ArrowUp'], 900);
  const gotAt = await t.eval(() => window.__gotAt);
  const gap = gotAt - 6 - 105;
  t.assert(gotAt !== null && gap > 0 && gap <= 8.5, `heart taken as the hero's body meets it (hitbox gap ${gap?.toFixed?.(1)} px)`);
  await recordSfx(t);
  await t.eval(() => { S().player.animT = 0; S().showEntity('hc'); });
  await t.wait(100);
  const reveal = await t.eval(() => window.__sfx);
  t.assert(reveal.includes('secret'), `a chest revealed in a door-only room sparkles (${JSON.stringify(reveal)})`);
  await t.shotCanvas('chest-revealed-sparkle');
}
