// Bosses: Giant Worm. Arena = one walled dungeon screen, hero invincible.
// Intro pause -> crawls and bounces with the chain trailing the head -> head
// and body tink, the tail takes damage (flash, i-frames, faster) -> real sword
// on the head tinks, a real arrow in the tail lands -> death: bursts from tail
// to head, heart container, defeated flag -> leaving without the heart and
// coming back brings it back (once collected, never again). Then two
// side-by-side rooms: the whole worm stays drawn while its room scrolls away.
// A real swing at the tail is tried first; if the crawling tail slipped out of
// reach, the hit is applied directly with the hero as the source.

async function arena(t, cfg) {
  await t.goto('#/');
  await t.eval(async (c) => (await import('/src/dev/arena.ts')).startArena(c), cfg);
  await t.until(() => !!(window.__qf.game && window.__qf.game.services), undefined, 5000);
  await t.eval(() => {
    const s = window.__qf.game.services;
    s.debug.invincible = true;
    const a = s.audio;
    const orig = a.sfx.bind(a);
    window.__sfx = [];
    a.sfx = (id, o) => { window.__sfx.push(id); orig(id, o); };
  });
}

/** Screenshot with the game loop paused, so short-lived frames (flashes, bursts) are caught. */
async function frozenShot(t, label) {
  await t.eval(() => window.__qf.game.stop());
  await t.shotCanvas(label);
  await t.eval(() => window.__qf.game.start());
}

/**
 * The worm's cruise speed: no new steering decisions (so no random dash), then
 * once any dash or post-hit flinch boost has worn off and the speed has settled.
 */
async function cruiseSpeed(t) {
  const decide = await t.eval(() => {
    const w = window.__qf.game.services.findEntity('worm');
    const before = w.decideT;
    w.decideT = 99;
    return before;
  });
  await t.until(() => window.__qf.game.services.findEntity('worm').dashT === 0, undefined, 3000);
  await t.wait(500);
  return t.eval((d) => {
    const w = window.__qf.game.services.findEntity('worm');
    w.decideT = d;
    return w.speed;
  }, decide);
}

const worm = (t) => t.eval(() => {
  const s = window.__qf.game.services;
  const w = s.findEntity('worm');
  if (!w) return null;
  return {
    x: w.x, y: w.y, hp: w.hp, speed: w.speed, dying: w.dying, dead: w.dead, visible: w.visible,
    parts: w.parts.map((p) => ({ x: p.x, y: p.y, kind: p.kind, dead: p.dead, contact: p.contactDamage })),
    offsets: w.partOffsets, contact: w.contactDamage,
  };
});

/** Hit a worm part (index into parts, -1 = head) with the hero as the source. */
const hitPart = (t, index, kind = 'sword', damage = 1) => t.eval(([i, k, d]) => {
  const s = window.__qf.game.services;
  const w = s.findEntity('worm');
  const e = i < 0 ? w : w.parts[i];
  const p = s.player;
  const len = Math.hypot(e.x - p.x, e.y - p.y) || 1;
  return e.hurt({ damage: d, kind: k, source: p, dx: (e.x - p.x) / len, dy: (e.y - p.y) / len });
}, [index, kind, damage]);

/** Try a real sword swing at the tail: park the hero beside it facing it, press Z. Returns hp lost or null if no sword. */
async function swordAtTail(t) {
  const before = await t.eval(() => {
    const s = window.__qf.game.services;
    const w = s.findEntity('worm');
    const tail = w.parts[w.parts.length - 1];
    const p = s.player;
    // Stand just below the tail, facing up.
    p.place(tail.x, Math.min(tail.y + 18, s.room.height - 24), 'up');
    return w.hp;
  });
  await t.press('KeyZ', 50);
  const swung = await t.eval(() => {
    const p = window.__qf.game.services.player;
    return p.state === 'attack' || p.state === 'spin' || !!p.swordRect();
  });
  // Mid-swing, right below the tail: the hero stands over the tail's shadow, not under the tail.
  await frozenShot(t, 'worm-sword-at-tail');
  await t.wait(300);
  if (!swung) return null;
  const after = await t.eval(() => window.__qf.game.services.findEntity('worm')?.hp ?? 0);
  return before - after;
}

/**
 * Hold the worm still and lay it out straight (head at the top, tail below),
 * then swing the real sword at its head from above and shoot a real arrow up
 * into the tail. Returns hp lost per weapon (null when the player cannot use it yet).
 */
async function realWeapons(t) {
  await t.eval(() => {
    const s = window.__qf.game.services;
    const w = s.findEntity('worm');
    w.intro = 999;
    w.x = 128;
    w.y = 64;
    w.heading = -Math.PI / 2;
    w.path.reset(128, 64, 0, 1);
    w.placeParts();
    s.player.place(128, 36, 'down');
  });
  await t.wait(700); // tail i-frames from any earlier hit run out
  const hp0 = await t.eval(() => {
    window.__sfx.length = 0;
    return window.__qf.game.services.findEntity('worm').hp;
  });
  const swung = await trySwing(t);
  const hp1 = await t.eval(() => window.__qf.game.services.findEntity('worm').hp);
  const tinked = await t.eval(() => window.__sfx.includes('swordTink'));
  const tailY = await t.eval(() => {
    const s = window.__qf.game.services;
    const w = s.findEntity('worm');
    const tail = w.parts[w.parts.length - 1];
    s.player.place(tail.x, tail.y + 48, 'up');
    s.save.equipped = 'bow';
    window.__sfx.length = 0;
    return tail.y;
  });
  await t.wait(100);
  await t.press('KeyC', 60);
  await t.wait(400);
  const shot = await t.eval(() => window.__sfx.includes('arrow'));
  const hp2 = await t.eval(() => window.__qf.game.services.findEntity('worm').hp);
  t.log('arrow', { tailY, shot });
  return { sword: swung ? hp0 - hp1 : null, tinked, arrow: shot ? hp1 - hp2 : null };
}

/** Press the sword button; true if the player actually swung. */
async function trySwing(t) {
  await t.press('KeyZ', 50);
  const swung = await t.eval(() => {
    const p = window.__qf.game.services.player;
    return p.state === 'attack' || p.state === 'spin' || !!p.swordRect();
  });
  await t.wait(300);
  return swung;
}

async function fight(t) {
  await arena(t, {
    theme: 'dungeon', hearts: 10, items: { bow: 1, arrows: 20 },
    player: { x: 128, y: 196, dir: 'up' },
    entities: [{ id: 'worm', type: 'boss.worm', x: 128, y: 90, props: { hp: 8, segments: 4 } }],
  });

  // ---- Intro: holds still for ~1 s, the whole chain laid out.
  let w = await worm(t);
  t.log('spawn', { x: w.x, y: w.y, parts: w.parts.length });
  t.assert(w.parts.length === 5, `4 body segments + tail (${w.parts.length})`);
  t.assert(w.parts[4].kind === 'tail', 'last part is the tail');
  await t.wait(500);
  const w1 = await worm(t);
  t.assert(Math.abs(w1.x - w.x) < 0.01 && Math.abs(w1.y - w.y) < 0.01, 'holds still during the intro');
  await t.shotCanvas('worm-intro');

  // ---- Crawling: the head moves, the parts trail it at their gaps.
  await t.wait(1500);
  w = await worm(t);
  t.assert(Math.hypot(w.x - w1.x, w.y - w1.y) > 10, `head crawled (${w1.x.toFixed(0)},${w1.y.toFixed(0)} -> ${w.x.toFixed(0)},${w.y.toFixed(0)})`);
  const chain = [{ x: w.x, y: w.y }, ...w.parts];
  let prev = 0;
  for (let i = 1; i < chain.length; i++) {
    const gap = w.offsets[i - 1] - prev;
    prev = w.offsets[i - 1];
    const d = Math.hypot(chain[i].x - chain[i - 1].x, chain[i].y - chain[i - 1].y);
    t.assert(d <= gap + 0.01 && d > gap * 0.5, `part ${i} trails at <= its gap (${d.toFixed(1)} / ${gap})`);
  }
  t.assert(w.contact === 2 && w.parts.every((p) => p.contact === 2), 'every part deals 2 on contact');
  await frozenShot(t, 'worm-moving');
  await t.wait(900);
  await frozenShot(t, 'worm-moving-2');

  // Stays in the room (walls are one tile thick).
  let inside = true;
  for (let i = 0; i < 12; i++) {
    await t.wait(250);
    const b = await t.eval(() => {
      const s = window.__qf.game.services;
      const w2 = s.findEntity('worm');
      return [w2, ...w2.parts].every((e) => e.left >= 15.99 && e.top >= 15.99 && e.right <= s.room.width - 15.99 && e.bottom <= s.room.height - 15.99);
    });
    inside &&= b;
  }
  t.assert(inside, 'head and parts stay inside the walls');

  // ---- Immune parts: head and body tink.
  const hp0 = (await worm(t)).hp;
  await t.eval(() => { window.__sfx.length = 0; });
  const headLanded = await hitPart(t, -1);
  await t.wait(250);
  const bodyLanded = await hitPart(t, 1);
  await t.wait(250);
  const boomLanded = await hitPart(t, 4, 'boomerang', 0);
  let sfx = await t.eval(() => window.__sfx.slice());
  w = await worm(t);
  t.assert(!headLanded && !bodyLanded && !boomLanded && w.hp === hp0, `head/body/boomerang do nothing (hp ${hp0} -> ${w.hp})`);
  t.assert(sfx.filter((s) => s === 'swordTink').length >= 2, `immune hits tink (${sfx.join(',')})`);
  await frozenShot(t, 'worm-tink');

  // ---- Weak point: the tail. Real sword first, if the hero has one.
  const calm = await cruiseSpeed(t);
  const swordLoss = await swordAtTail(t);
  t.log('real sword on the tail:', swordLoss === null ? 'no swing' : `hp -${swordLoss}`);
  t.assert(swordLoss !== null, 'the hero swings at the tail');
  let hpNow = (await worm(t)).hp;
  if (swordLoss === null || swordLoss === 0) {
    await t.eval(() => { window.__sfx.length = 0; });
    const landed = await hitPart(t, 4);
    await t.wait(40);
    await frozenShot(t, 'worm-tail-hit');
    sfx = await t.eval(() => window.__sfx.slice());
    w = await worm(t);
    t.assert(landed && w.hp === hpNow - 1, `tail takes damage (hp ${hpNow} -> ${w.hp})`);
    t.assert(sfx.includes('bossHit'), 'bossHit on damage');
    const again = await hitPart(t, 4);
    t.assert(!again, 'tail i-frames block an immediate second hit');
  } else {
    await frozenShot(t, 'worm-tail-hit');
  }
  const faster = await cruiseSpeed(t);
  w = await worm(t);
  t.assert(faster > calm, `speeds up after a tail hit (${calm.toFixed(1)} -> ${faster.toFixed(1)})`);
  await frozenShot(t, 'worm-faster');

  // ---- Real weapons on a held-still worm (its intro timer re-armed): sword on the head tinks, an arrow in the tail lands.
  const real = await realWeapons(t);
  t.log('real weapons', real);
  t.assert(real.sword === 0 && real.tinked, `real sword on the head: no damage, tink (${JSON.stringify(real)})`);
  t.assert(real.arrow > 0, `real arrow in the tail lands (${JSON.stringify(real)})`);
  await frozenShot(t, 'worm-real-arrow');
  await t.eval(() => { window.__qf.game.services.findEntity('worm').intro = 0; });

  // ---- Death: wear it down (arrows too), then bursts tail -> head.
  w = await worm(t);
  hpNow = w.hp;
  while (hpNow > 1) {
    await t.wait(550);
    await hitPart(t, 4, hpNow % 2 ? 'arrow' : 'sword');
    hpNow = (await worm(t)).hp;
  }
  await t.wait(550);
  await hitPart(t, 4);
  w = await worm(t);
  t.assert(w.dying && w.contact === 0, `0 HP starts the death sequence (dying=${w.dying})`);
  await t.until(() => {
    const w2 = window.__qf.game.services.findEntity('worm');
    return w2 && w2.parts.filter((p) => p.dead).length >= 2;
  }, undefined, 3000);
  await frozenShot(t, 'worm-bursting');
  w = await worm(t);
  t.assert(w.parts[4].dead && w.parts[3].dead && !w.parts[0].dead, 'bursts run from the tail toward the head');
  sfx = await t.eval(() => window.__sfx.slice());
  t.assert(sfx.includes('bossDie'), 'bossDie plays');
  await t.until(() => !window.__qf.game.services.findEntity('worm'), undefined, 5000);
  await t.wait(200);
  const end = await t.eval(() => {
    const s = window.__qf.game.services;
    const heart = s.entities.find((e) => e.id === 'worm-heart');
    return {
      flag: s.flag('defeated:worm'),
      heart: heart ? { type: heart.type, x: heart.x, y: heart.y, item: heart.inst?.props?.item } : null,
      cleared: s.enemiesCleared(),
      leftovers: s.entities.filter((e) => e.type.startsWith('boss.worm')).length,
    };
  });
  t.log('after death', end);
  t.assert(end.flag, 'defeated:worm flag set');
  t.assert(end.cleared, 'room counts as cleared');
  t.assert(end.leftovers === 0, `no worm parts or shadows left behind (${end.leftovers})`);
  t.assert(end.heart && end.heart.type === 'obj.pickup' && end.heart.item === 'heartContainer', 'heart container dropped');
  await t.shotCanvas('worm-defeated-heart');

  // Leave without the heart and come back: the worm stays defeated, the heart container returns.
  const reenter = () => t.eval(() => {
    const g = window.__qf.game;
    g.warpNow({ world: 'arena', room: 'arena_room', x: 40, y: 190 });
    const s = g.services;
    const heart = s.entities.find((e) => e.id === 'worm-heart' && !e.dead);
    return { heart: heart ? { x: heart.x, y: heart.y } : null, worm: !!s.findEntity('worm'), maxHp: s.save.maxHp };
  });
  const back = await reenter();
  t.log('re-entry without collecting the heart', back);
  t.assert(!back.worm, 'a defeated worm stays defeated');
  t.assert(back.heart !== null, 'the uncollected heart container comes back');
  if (!back.heart) return;
  // Collect it, then come back once more: collected once, never again.
  await t.eval((h) => window.__qf.game.services.player.place(h.x, h.y + 4, 'up'), back.heart);
  await t.until(() => window.__qf.game.services.flag('pickup:worm-heart'), undefined, 3000);
  await t.wait(200);
  await t.shotCanvas('worm-heart-collected');
  const gained = await t.eval(() => window.__qf.game.services.save.maxHp);
  t.assert(gained === back.maxHp + 2, `the heart container adds a heart (max hp ${back.maxHp} -> ${gained})`);
  // Close the fanfare's message (the hero holds the heart up until then).
  const holdingUp = () => t.eval(() => window.__qf.game.services.player.state === 'itemGet');
  for (let i = 0; i < 12 && (await holdingUp()); i++) {
    await t.press('KeyX', 60);
    await t.wait(250);
  }
  t.assert(!(await holdingUp()), 'the heart container message closes');
  const again = await reenter();
  t.log('re-entry after collecting the heart', again);
  t.assert(again.heart === null && !again.worm, 'a collected heart container never comes back');
}

/** Two side-by-side open rooms, the worm in the left one; the hero walks out while it is alive. */
async function scrollOut(t) {
  await t.goto('#/');
  await t.eval(async (c) => {
    const { buildArenaProject } = await import('/src/dev/arena.ts');
    const { Game } = await import('/src/game/game.ts');
    const project = buildArenaProject(c);
    const w = project.worlds[0];
    const next = JSON.parse(JSON.stringify(w.rooms[0]));
    next.id = 'room2';
    next.gx = 1;
    next.entities = [];
    w.rooms.push(next);
    window.__qf.game?.destroy();
    const root = document.getElementById('app') ?? document.body;
    root.textContent = '';
    const host = document.createElement('div');
    host.className = 'qf-game-host';
    const canvas = document.createElement('canvas');
    canvas.className = 'qf-game-canvas';
    canvas.tabIndex = 0;
    host.appendChild(canvas);
    root.appendChild(host);
    const game = new Game(canvas, project, { mode: 'playtest' });
    window.__qf.game = game;
    game.start();
    canvas.focus();
  }, {
    theme: 'grass', walls: false, hearts: 10, player: { x: 236, y: 112, dir: 'right' },
    entities: [{ id: 'worm', type: 'boss.worm', x: 120, y: 112, props: { hp: 12, segments: 4 } }],
  });
  await t.until(() => !!(window.__qf.game && window.__qf.game.services), undefined, 5000);
  await t.eval(() => { window.__qf.game.services.debug.invincible = true; });
  await t.wait(1500);
  await t.hold(['ArrowRight'], 450);
  const mid = await t.eval(() => {
    const g = window.__qf.game;
    g.stop();
    const s = g.services;
    return { room: s.room.def.id, wormHere: !!s.findEntity('worm') };
  });
  t.log('mid-scroll', mid);
  await t.shotCanvas('worm-scroll-out');
  await t.eval(() => window.__qf.game.start());
  t.assert(mid.room === 'room2' && !mid.wormHere, `scrolling into the next room (${JSON.stringify(mid)})`);
}

export default async function (t) {
  await fight(t);
  await scrollOut(t);
}
