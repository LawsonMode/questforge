// Objects: chests (small + big, item get with fanfare, persistence flag) and every
// door kind — locked door opened with a key picked up off the floor, shutter that
// opens once the room's enemies are cleared, bombable wall blown open by a bomb
// hit, closeOnEnter shutter shutting behind the hero and reopened by a trigger.
// Interaction uses the real action button when the player supports it, else calls
// onInteract() directly (logged).
async function arena(t, cfg) {
  await t.goto('#/');
  await t.eval(async (c) => (await import('/src/dev/arena.ts')).startArena(c), cfg);
  await t.until(() => !!(window.__qf.game && window.__qf.game.services), undefined, 5000);
  // Page-side shorthand used inside t.eval callbacks.
  await t.eval(() => { window.S = () => window.__qf.game.services; });
  await t.wait(150);
}

const ent = (t, id) => t.eval((eid) => {
  const e = window.__qf.game.services.entities.find((x) => x.id === eid);
  return e ? { x: e.x, y: e.y, anim: e.anim, solid: e.solid, open: e.isOpen ?? null, dead: e.dead } : null;
}, id);

/** Action button on an entity; falls back to onInteract() when the player has no interaction yet. */
async function interact(t, id) {
  await t.eval((eid) => {
    const e = window.__qf.game.services.findEntity(eid);
    const orig = e.onInteract.bind(e);
    e.__calls = 0;
    e.onInteract = () => { e.__calls++; return orig(); };
  }, id);
  await t.press('KeyX', 60);
  await t.wait(120);
  const calls = await t.eval((eid) => window.__qf.game.services.entities.find((x) => x.id === eid)?.__calls ?? 0, id);
  if (calls > 0) return 'button';
  await t.eval((eid) => window.__qf.game.services.entities.find((x) => x.id === eid).onInteract(), id);
  await t.wait(60);
  return 'direct';
}

/** Close any open dialogue (item-get messages). */
async function closeDialogue(t) {
  for (let i = 0; i < 12; i++) {
    if ((await t.eval(() => window.__qf.game.state)) !== 'dialogue') return;
    await t.press('KeyX', 50);
    await t.wait(150);
  }
}

/**
 * Other agents saving files mid-run make Vite full-reload the page; mock its HMR
 * socket for this page (kept open, no server) so the scenario can't be reloaded.
 */
const isolateFromHmr = (t) => t.page.routeWebSocket(() => true, () => {});

export default async function (t) {
  await isolateFromHmr(t);
  // ---------------------------------------------------------------- chests
  await arena(t, {
    theme: 'dungeon', player: { x: 128, y: 120, dir: 'up' },
    entities: [
      { id: 'chest', type: 'obj.chest', x: 128, y: 72, props: { item: 'bow', amount: 1 } },
      { id: 'rupeeChest', type: 'obj.chest', x: 200, y: 72, props: { item: 'rupees', amount: 20 } },
      { id: 'big', type: 'obj.chest', x: 56, y: 72, props: { item: 'hookshot', big: true } },
    ],
  });
  await t.shotCanvas('chests-closed');
  await t.hold(['ArrowUp'], 500);
  const p = await t.eval(() => ({ y: S().player.y, st: S().player.state }));
  t.assert(Math.abs(p.y - 86) < 1.5, `hero stops against the chest's bottom edge (y=${p.y})`);
  let how = await interact(t, 'chest');
  t.log('chest interaction via', how);
  await t.wait(250);
  let c = await ent(t, 'chest');
  const got = await t.eval(() => ({ bow: S().save.items.bow ?? 0, flag: S().flag('chest:chest'), st: S().player.state, game: window.__qf.game.state }));
  t.assert(c.open && c.anim === 'open', `chest opened (${JSON.stringify(c)})`);
  t.assert(got.bow === 1 && got.flag, `bow given and chest flagged (${JSON.stringify(got)})`);
  t.assert(got.game === 'dialogue', `item-get message shown (${got.game})`);
  await t.wait(500);
  await t.shotCanvas('chest-item-get');
  await closeDialogue(t);
  await t.wait(400);
  how = await interact(t, 'chest');
  const again = await t.eval(() => S().save.items.bow);
  t.assert(again === 1, 'an opened chest gives nothing more');

  // Rupee chest: amount passed unchanged.
  await t.eval(() => S().player.place(200, 86, 'up'));
  await t.wait(100);
  await interact(t, 'rupeeChest');
  await t.wait(200);
  const rupees = await t.eval(() => S().save.rupees);
  t.assert(rupees === 20, `rupee chest gives 20 (${rupees})`);
  await closeDialogue(t);

  // Big chest: locked without the big key, opens with it.
  await t.eval(() => S().player.place(56, 86, 'up'));
  await t.wait(100);
  await interact(t, 'big');
  await t.wait(400);
  let state = await t.eval(() => window.__qf.game.state);
  c = await ent(t, 'big');
  t.assert(state === 'dialogue' && !c.open, `big chest refuses without the big key (${state}, open=${c.open})`);
  await t.shotCanvas('big-chest-locked');
  await closeDialogue(t);
  await t.eval(() => S().giveItem('bigKey', 1));
  await closeDialogue(t);
  await t.wait(400);
  await interact(t, 'big');
  await t.wait(600);
  c = await ent(t, 'big');
  const hook = await t.eval(() => S().save.items.hookshot ?? 0);
  t.assert(c.open && hook === 1, `big chest opens with the big key (open=${c.open}, hookshot=${hook})`);
  await t.shotCanvas('big-chest-open');
  await closeDialogue(t);

  // Re-entering keeps chests open.
  await t.eval(() => window.__qf.game.warpNow({ world: 'arena', room: 'arena_room', x: 128, y: 150, dir: 'up' }));
  await t.wait(200);
  c = await ent(t, 'chest');
  t.assert(c && c.open, 'chest stays open after re-entry');
  await t.shotCanvas('chests-after-reentry');

  // ---------------------------------------------------------------- locked door + key pickup
  await arena(t, {
    theme: 'dungeon', player: { x: 128, y: 190, dir: 'up' },
    entities: [
      { id: 'lock', type: 'obj.door', x: 128, y: 8, props: { dir: 'up', kind: 'locked', link: 'L' } },
      { id: 'key', type: 'obj.pickup', x: 128, y: 150, props: { item: 'smallKey', amount: 1 } },
    ],
  });
  await t.shotCanvas('locked-door-and-key');
  await t.hold(['ArrowUp'], 450);
  const keys = await t.eval(() => S().dungeon?.keys ?? -1);
  t.assert(keys === 1, `key picked up by walking over it (keys=${keys})`);
  t.assert(await t.eval(() => S().flag('pickup:key')), 'placed key flagged pickup:key');
  await t.hold(['ArrowUp'], 1600);
  const lock = await ent(t, 'lock');
  const after = await t.eval(() => ({ keys: S().dungeon.keys, flag: S().flag('door:L'), y: S().player.y }));
  t.assert(lock.open && !lock.solid, `walking into the locked door opens it (${JSON.stringify(lock)})`);
  t.assert(after.keys === 0 && after.flag, `key used, door:L flagged (${JSON.stringify(after)})`);
  t.assert(after.y < 16, `hero walks into the doorway (y=${after.y.toFixed(1)})`);
  await t.shotCanvas('locked-door-open');

  // ---------------------------------------------------------------- shutter + bombable + closeOnEnter
  await arena(t, {
    theme: 'dungeon', player: { x: 128, y: 150, dir: 'up' },
    entities: [
      { id: 'shut', type: 'obj.door', x: 8, y: 112, props: { dir: 'left', kind: 'shutter', opensWhen: 'enemiesCleared' } },
      { id: 'crack', type: 'obj.door', x: 248, y: 112, props: { dir: 'right', kind: 'bombable' } },
      { id: 'boss', type: 'obj.door', x: 128, y: 216, props: { dir: 'down', kind: 'bigKey' } },
      { id: 'foe', type: 'enemy.soldier', x: 200, y: 56, props: { behavior: 'guard', facing: 'down', drop: 'none' } },
    ],
  });
  await t.wait(300);
  let sh = await ent(t, 'shut');
  t.assert(sh && !sh.open && sh.solid, `shutter closed while an enemy lives (${JSON.stringify(sh)})`);
  await t.shotCanvas('shutter-cracked-bigkey-closed');
  await t.eval(() => {
    const e = S().findEntity('foe');
    e.hurt({ damage: 99, kind: 'sword', source: S().player, dx: 0, dy: -1 });
  });
  await t.wait(40);
  await t.shotCanvas('shutter-sliding');
  await t.wait(500);
  sh = await ent(t, 'shut');
  t.assert(sh.open && !sh.solid && sh.anim === 'open_left', `shutter opens once enemies are cleared (${JSON.stringify(sh)})`);
  const crackBefore = await ent(t, 'crack');
  t.assert(crackBefore.anim === 'cracked_right' && crackBefore.solid, 'bombable wall starts cracked and solid');
  await t.eval(() => {
    const s = S();
    const d = s.findEntity('crack');
    for (const e of s.entitiesIn({ x: d.x - 24, y: d.y - 20, w: 40, h: 40 })) {
      e.hurt({ damage: 2, kind: 'bomb', source: null, dx: 1, dy: 0 });
    }
    s.effect('fx.explosion', 'play', d.x - 12, d.y);
  });
  await t.wait(60);
  await t.shotCanvas('bomb-blast');
  await t.wait(500);
  const crack = await ent(t, 'crack');
  t.assert(crack.open && !crack.solid && crack.anim === 'bombed_right', `bomb opens the cracked wall (${JSON.stringify(crack)})`);
  t.assert(await t.eval(() => S().flag('door:crack')), 'bombed wall persisted');
  await t.shotCanvas('shutter-open-wall-bombed');

  await arena(t, {
    theme: 'dungeon', player: { x: 128, y: 26, dir: 'down' },
    entities: [{ id: 'trap', type: 'obj.door', x: 128, y: 8, props: { dir: 'up', kind: 'shutter', opensWhen: 'trigger', closeOnEnter: true } }],
  });
  let trap = await ent(t, 'trap');
  t.assert(trap.open, 'closeOnEnter shutter starts open');
  await t.shotCanvas('trap-open');
  await t.hold(['ArrowDown'], 450);
  await t.wait(300);
  trap = await ent(t, 'trap');
  t.assert(!trap.open && trap.solid, `shutter shut behind the hero (${JSON.stringify(trap)})`);
  await t.shotCanvas('trap-shut');
  await t.eval(() => S().findEntity('trap').setOpen(true));
  await t.wait(400);
  trap = await ent(t, 'trap');
  t.assert(trap.open, 'setOpen(true) (trigger openDoor) reopens it');
  await t.shotCanvas('trap-reopened');
}
