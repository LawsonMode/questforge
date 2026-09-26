// Objects: pickups of every kind collected by walking over them (rupees 1/5/20,
// heart, bombs, arrows, magic, small key), fanfare pickups (heart container),
// a drifting fairy, the crystal claim (freeze + sparkle burst + item get), loot
// drops popping in and vanishing, a hidden key revealed mid-room, the pot entity
// (lift if the player supports it) and a shop purchase.

async function arena(t, cfg) {
  await t.goto('#/');
  await t.eval(async (c) => (await import('/src/dev/arena.ts')).startArena(c), cfg);
  await t.until(() => !!(window.__qf.game && window.__qf.game.services), undefined, 5000);
  // Page-side shorthand used inside t.eval callbacks.
  await t.eval(() => { window.S = () => window.__qf.game.services; });
  await t.wait(150);
}

const save = (t) => t.eval(() => {
  const s = S().save;
  return { hp: s.hp, maxHp: s.maxHp, rupees: s.rupees, bombs: s.bombs, arrows: s.arrows, magic: s.magic, keys: S().dungeon?.keys ?? s.dungeons.arena?.keys ?? 0, crystals: s.crystals };
});
const alive = (t, id) => t.eval((eid) => !!S().findEntity(eid), id);

async function closeDialogue(t) {
  for (let i = 0; i < 12; i++) {
    if ((await t.eval(() => window.__qf.game.state)) !== 'dialogue') return;
    await t.press('KeyX', 50);
    await t.wait(150);
  }
}

/** Action button on an entity; falls back to onInteract() when the player has no interaction yet. */
async function interact(t, id) {
  await t.eval((eid) => {
    const e = S().findEntity(eid);
    const orig = e.onInteract.bind(e);
    e.__calls = 0;
    e.onInteract = () => { e.__calls++; return orig(); };
  }, id);
  await t.press('KeyX', 60);
  await t.wait(120);
  if ((await t.eval((eid) => S().entities.find((x) => x.id === eid)?.__calls ?? 0, id)) > 0) return 'button';
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
  // ---------------------------------------------------------------- quiet pickups in a row
  const row = [
    ['r1', 'rupees', 1], ['r5', 'rupees', 5], ['r20', 'rupees', 20], ['hrt', 'heart', 1],
    ['bmb', 'bombs', 5], ['arw', 'arrows', 10], ['mag', 'magic', 16], ['key', 'smallKey', 1],
  ];
  await arena(t, {
    theme: 'grass', player: { x: 16, y: 112, dir: 'right' }, hearts: 6,
    entities: [
      ...row.map(([id, item, amount], i) => ({ id, type: 'obj.pickup', x: 40 + i * 24, y: 112, props: { item, amount } })),
      { id: 'small', type: 'obj.pickup', x: 88, y: 64, props: { item: 'magic', amount: 8 } },
      { id: 'fairy', type: 'obj.pickup', x: 200, y: 56, props: { item: 'fairy', amount: 1 } },
      { id: 'hc', type: 'obj.pickup', x: 40, y: 176, props: { item: 'heartContainer', amount: 1 } },
      { id: 'hk', type: 'obj.pickup', x: 128, y: 176, props: { item: 'smallKey', amount: 1, hidden: true } },
    ],
  });
  await t.eval(() => { const s = S().save; s.hp = 6; s.magic = 0; });
  const before = await save(t);
  await t.shotCanvas('pickups-row');
  await t.hold(['ArrowRight'], 1200);
  await t.shotCanvas('pickups-collecting');
  await t.hold(['ArrowRight'], 1500);
  const after = await save(t);
  t.log('before', before, 'after', after);
  t.assert(after.rupees === before.rupees + 26, `rupees +1 +5 +20 (${before.rupees} -> ${after.rupees})`);
  t.assert(after.hp === before.hp + 2, `heart restores one heart (${before.hp} -> ${after.hp})`);
  t.assert(after.bombs === 5 && after.arrows === 10 && after.magic === 16, `bombs/arrows/magic refilled (${after.bombs}/${after.arrows}/${after.magic})`);
  t.assert(after.keys === 1, `small key counted (${after.keys})`);
  t.assert((await t.eval(() => window.__qf.game.state)) === 'playing', 'quiet pickups show no item-get message');
  for (const [id] of row) t.assert(!(await alive(t, id)), `${id} collected`);
  t.assert(await t.eval(() => S().flag('pickup:r20') && S().flag('pickup:key')), 'placed pickups flagged');

  // Fairy drifts, then heals.
  const f0 = await t.eval(() => { const f = S().findEntity('fairy'); return { x: f.x, y: f.y, z: f.z }; });
  await t.wait(700);
  const f1 = await t.eval(() => { const f = S().findEntity('fairy'); return { x: f.x, y: f.y, z: f.z }; });
  t.assert(Math.hypot(f1.x - f0.x, f1.y - f0.y) > 2 && f1.z > 4, `fairy flies around (${JSON.stringify([f0, f1])})`);
  await t.shotCanvas('fairy-floating');
  await t.eval(() => { S().save.hp = 2; S().findEntity('fairy').collect(); });
  await t.wait(100);
  const healed = await save(t);
  t.assert(healed.hp === 12 && !(await alive(t, 'fairy')), `fairy heals 7 hearts, capped (${healed.hp})`);

  // Heart container: item-get fanfare.
  await t.eval(() => S().player.place(40, 150, 'down'));
  await t.hold(['ArrowDown'], 400);
  await t.wait(300);
  const hc = await save(t);
  t.assert(hc.maxHp === 14 && (await t.eval(() => window.__qf.game.state)) === 'dialogue', `heart container adds a heart with a message (maxHp=${hc.maxHp})`);
  await t.wait(400);
  await t.shotCanvas('heart-container-get');
  await closeDialogue(t);

  // Hidden key revealed mid-room drops in with a sparkle.
  await t.eval(() => { S().player.place(80, 176, 'right'); S().showEntity('hk'); });
  await t.wait(120);
  const falling = await t.eval(() => S().findEntity('hk')?.z ?? -1);
  t.assert(falling > 5, `revealed key falls in from above (z=${falling})`);
  await t.shotCanvas('hidden-key-revealed');
  await t.wait(800);
  await t.hold(['ArrowRight'], 600);
  const k2 = await save(t);
  t.assert(k2.keys === 2, `revealed key collected (${k2.keys})`);

  // ---------------------------------------------------------------- loot drops
  await t.eval(() => { S().player.place(40, 60, 'right'); S().dropLoot(120, 60, 'rupee20'); S().dropLoot(72, 60, 'heart'); });
  await t.wait(80);
  const loot = await t.eval(() => S().entities.filter((e) => e.type === 'obj.pickup' && e.transient).map((e) => ({ id: e.id, z: e.z, anim: e.anim })));
  t.assert(loot.length === 2 && loot.some((l) => l.z > 1), `loot pops in with a bounce (${JSON.stringify(loot)})`);
  await t.shotCanvas('loot-pop');
  await t.eval(() => { S().save.hp = 4; });
  await t.hold(['ArrowRight'], 450);
  const lootHp = await save(t);
  t.assert(lootHp.hp === 6, `heart drop collected (${lootHp.hp})`);
  await t.eval(() => S().player.place(40, 150, 'down'));
  await t.wait(7300);
  await t.shotCanvas('loot-blinking');
  const still = await t.eval(() => S().entities.filter((e) => e.type === 'obj.pickup' && e.transient).length);
  t.assert(still === 1, `rupee drop still there at ~7.5 s (${still})`);
  await t.wait(2800);
  const gone = await t.eval(() => S().entities.filter((e) => e.type === 'obj.pickup' && e.transient).length);
  t.assert(gone === 0, `loot vanished by 10 s (${gone})`);
  t.assert(!(await t.eval(() => Object.keys(S().save.flags).some((f) => f.startsWith('pickup:loot')))), 'loot sets no flag');

  // ---------------------------------------------------------------- crystal
  await arena(t, {
    theme: 'dungeon', player: { x: 128, y: 170, dir: 'up' },
    entities: [{ id: 'cr', type: 'obj.pickup', x: 128, y: 110, props: { item: 'crystal', amount: 1 } }],
  });
  await t.wait(600);
  await t.shotCanvas('crystal-floating');
  await t.hold(['ArrowUp'], 650);
  await t.wait(60);
  const claim = await t.eval(() => ({ claiming: S().findEntity('cr')?.claiming ?? false, st: S().player.state }));
  t.assert(claim.claiming && claim.st === 'locked', `crystal claim freezes the hero (${JSON.stringify(claim)})`);
  await t.shotCanvas('crystal-claim-sparkles');
  await t.wait(1100);
  const prize = await t.eval(() => ({ crystals: S().save.crystals, flag: S().flag('crystal:arena'), game: window.__qf.game.state, st: S().player.state }));
  t.assert(prize.crystals === 1 && prize.flag && prize.game === 'dialogue', `crystal given with the fanfare (${JSON.stringify(prize)})`);
  await t.shotCanvas('crystal-get');
  await closeDialogue(t);
  await t.wait(500);
  // In a dungeon the dungeon-complete flow then holds the hero through the victory jingle and warps out.
  const held = await t.eval(() => ({ st: S().player.state, music: S().audio.currentMusic }));
  t.assert(held.st === 'locked' && held.music === 'victory', `held still for the victory jingle (${JSON.stringify(held)})`);
  await t.until(() => window.__qf.game.services.player.state !== 'locked', undefined, 6000);
  t.assert((await t.eval(() => S().player.state)) !== 'locked', 'hero unfrozen after the claim and the dungeon-complete warp');

  // ---------------------------------------------------------------- pot entity
  await arena(t, {
    theme: 'dungeon', player: { x: 128, y: 150, dir: 'up' },
    entities: [
      { id: 'pot', type: 'obj.pot', x: 128, y: 120, props: { contents: 'rupee5' } },
      { id: 'sw', type: 'obj.switch', x: 64, y: 120, props: { mode: 'hold' } },
      { id: 'pot2', type: 'obj.pot', x: 64, y: 120, props: { contents: 'none' } },
    ],
  });
  await t.wait(100);
  const lift = await t.eval(() => S().findEntity('pot').onLift());
  t.assert(lift.sprite === 'obj.pot' && lift.anim === 'idle' && lift.drop === 'rupee5', `pot onLift output (${JSON.stringify(lift)})`);
  t.assert(await t.eval(() => S().findEntity('sw').on), 'a pot resting on a switch holds it down');
  await t.hold(['ArrowUp'], 250);
  await t.press('KeyX', 60);
  await t.wait(400);
  const carry = await t.eval(() => ({ st: S().player.state, carrying: S().player.carrying?.type ?? null, pot: !!S().findEntity('pot') }));
  t.log('pot lift attempt', carry);
  if (carry.st === 'carry' || carry.st === 'lift' || carry.carrying) {
    await t.shotCanvas('pot-carried');
    await t.press('KeyX', 60);
    await t.wait(700);
    await t.shotCanvas('pot-thrown');
  } else {
    t.log('player lifting not available yet; checked onLift only');
  }

  // ---------------------------------------------------------------- shop
  await arena(t, {
    theme: 'interior', player: { x: 96, y: 130, dir: 'up' },
    entities: [
      { id: 'bombsForSale', type: 'obj.shopItem', x: 96, y: 88, props: { item: 'bombs', amount: 5, price: 30 } },
      { id: 'heartForSale', type: 'obj.shopItem', x: 128, y: 88, props: { item: 'heart', amount: 1, price: 10 } },
      { id: 'bowForSale', type: 'obj.shopItem', x: 160, y: 88, props: { item: 'bow', amount: 1, price: 120 } },
    ],
  });
  await t.eval(() => S().giveItem('rupees', 50));
  await t.wait(100);
  await t.shotCanvas('shop');
  await t.hold(['ArrowUp'], 400);
  const how = await interact(t, 'bombsForSale');
  t.log('shop interaction via', how);
  await t.wait(200);
  const bought = await save(t);
  t.assert(bought.rupees === 20 && bought.bombs === 5, `bought 5 bombs for 30 (${bought.rupees} rupees, ${bought.bombs} bombs)`);
  t.assert(await alive(t, 'bombsForSale'), 'shop item restocks (still there)');
  await t.eval(() => S().player.place(160, 102, 'up'));
  await t.wait(100);
  await interact(t, 'bowForSale');
  await t.wait(500);
  const broke = await t.eval(() => ({ game: window.__qf.game.state, bow: S().save.items.bow ?? 0, rupees: S().save.rupees }));
  t.assert(broke.game === 'dialogue' && broke.bow === 0 && broke.rupees === 20, `refused without enough gems (${JSON.stringify(broke)})`);
  await t.shotCanvas('shop-not-enough');
  await closeDialogue(t);
}
