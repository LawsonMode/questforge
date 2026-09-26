// Bosses: Iron Knight. Arena = one walled dungeon screen (all of it in view), hero invincible.
// Intro pause -> walks at the hero -> the shield blocks a real frontal sword
// swing (tink, hero pushed back) and a real arrow (the arrow's own clink only)
// while back hits land -> wind-up (pose shows the shielded side) -> straight
// charge -> wall crash stuns it (stars), a real sword swing from the room side
// lands -> enraged below half: crouch telegraph, hop + shockwave slam -> death
// explosions, heart container. Finally a fresh arena checks that hugging a wall
// never earns a free stun (charges slide along the wall they graze).

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
    const origFx = s.effect.bind(s);
    window.__fx = [];
    s.effect = (sp, an, x, y, o) => { window.__fx.push(sp); return origFx(sp, an, x, y, o); };
  });
}

/** Screenshot with the game loop paused, so short-lived frames (flashes, sparks, dust) are caught. */
async function frozenShot(t, label) {
  await t.eval(() => window.__qf.game.stop());
  await t.shotCanvas(label);
  await t.eval(() => window.__qf.game.start());
}

/** Like frozenShot, but on the first frame where the knight's telegraph flash is off (its pose shows). */
async function frozenPoseShot(t, label) {
  await t.eval(async () => {
    const g = window.__qf.game;
    for (let i = 0; i < 30; i++) {
      const k = g.services.findEntity('knight');
      if (!k || k.hitFlash <= 0) break;
      await new Promise((r) => requestAnimationFrame(r));
    }
    g.stop();
  });
  await t.shotCanvas(label);
  await t.eval(() => window.__qf.game.start());
}

const knight = (t) => t.eval(() => {
  const s = window.__qf.game.services;
  const k = s.findEntity('knight');
  if (!k) return null;
  return {
    x: k.x, y: k.y, z: k.z, hp: k.hp, st: k.aiState, facing: k.facing, anim: k.anim, contact: k.contactDamage,
    enraged: k.enraged, dying: k.dying, visible: k.visible, left: k.left, right: k.right, top: k.top, bottom: k.bottom,
    roomW: s.room.width, roomH: s.room.height,
  };
});

/** Put the hero `dist` px from the knight on side `side` ('front' | 'back'), facing it. */
const placeHero = (t, side, dist = 26) => t.eval(([sd, d]) => {
  const s = window.__qf.game.services;
  const k = s.findEntity('knight');
  const v = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[k.facing];
  const m = sd === 'front' ? 1 : -1;
  const toward = { '0,-1': 'down', '0,1': 'up', '-1,0': 'right', '1,0': 'left' }[`${v[0] * m},${v[1] * m}`];
  s.player.place(k.x + v[0] * d * m, k.y + v[1] * d * m, toward);
}, [side, dist]);

/** Direct sword hit on the knight from wherever the hero stands. Returns whether damage landed. */
const swordHit = (t, kind = 'sword', damage = 1) => t.eval(([kd, dmg]) => {
  const s = window.__qf.game.services;
  const k = s.findEntity('knight');
  const p = s.player;
  const len = Math.hypot(k.x - p.x, k.y - p.y) || 1;
  return k.hurt({ damage: dmg, kind: kd, source: p, dx: (k.x - p.x) / len, dy: (k.y - p.y) / len });
}, [kind, damage]);

/** Real sword swing (true = the hero swung). */
async function trySword(t) {
  await t.press('KeyZ', 50);
  const swung = await t.eval(() => {
    const p = window.__qf.game.services.player;
    return p.state === 'attack' || p.state === 'spin' || !!p.swordRect();
  });
  await t.wait(280);
  return swung;
}

const waitState = (t, st, ms) => t.eval(async ([want, timeout]) => {
  const t0 = performance.now();
  while (performance.now() - t0 < timeout) {
    const k = window.__qf.game.services.findEntity('knight');
    if (k && k.aiState === want) return true;
    await new Promise((r) => setTimeout(r, 16));
  }
  return false;
}, [st, ms]);

/**
 * waitState, but the hero steps back to the far corner whenever the walking
 * knight comes close: the invincible hero is never knocked back, so the knight
 * would otherwise walk right into them.
 */
const waitStateAtRange = (t, st, ms) => t.eval(async ([want, timeout]) => {
  const t0 = performance.now();
  while (performance.now() - t0 < timeout) {
    const s = window.__qf.game.services;
    const k = s.findEntity('knight');
    if (k && k.aiState === want) return true;
    const p = s.player;
    if (k && k.aiState === 'walk' && Math.hypot(p.x - k.x, p.y - k.y) < 64) {
      p.place(k.x < 128 ? 210 : 46, k.y < 112 ? 180 : 44, k.x < 128 ? 'left' : 'right');
    }
    await new Promise((r) => setTimeout(r, 16));
  }
  return false;
}, [st, ms]);

const clearLogs = (t) => t.eval(() => { window.__sfx.length = 0; window.__fx.length = 0; });

async function fight(t) {
  await arena(t, {
    theme: 'dungeon', hearts: 10, items: { bow: 1, arrows: 10 },
    player: { x: 56, y: 112, dir: 'right' },
    entities: [{ id: 'knight', type: 'boss.knight', x: 196, y: 112, props: { hp: 8 } }],
  });

  // ---- Intro: stands still ~1 s.
  const k0 = await knight(t);
  await t.wait(500);
  let k = await knight(t);
  t.assert(k.x === k0.x && k.y === k0.y, 'holds still during the intro');
  await t.shotCanvas('knight-intro');

  // ---- Walks toward the hero, shield first.
  await t.wait(1000);
  k = await knight(t);
  t.log('walking', { x: k.x.toFixed(1), st: k.st, facing: k.facing });
  t.assert(k.x < k0.x - 8, `walks toward the hero (${k0.x} -> ${k.x.toFixed(1)})`);
  t.assert(k.facing === 'left', `faces the hero (${k.facing})`);
  t.assert(k.contact === 2, `contact damage 2 (${k.contact})`);
  await frozenShot(t, 'knight-walk');

  // ---- Shield vs a real sword swing from the front: tink, no damage, hero shoved back.
  await clearLogs(t);
  await placeHero(t, 'front');
  const hpA = (await knight(t)).hp;
  const heroBefore = await t.eval(() => window.__qf.game.services.player.x);
  await t.press('KeyZ', 50);
  await t.wait(90);
  await frozenShot(t, 'knight-shield-block');
  await t.wait(200);
  const heroAfter = await t.eval(() => window.__qf.game.services.player.x);
  let sfx = await t.eval(() => window.__sfx.slice());
  k = await knight(t);
  t.log('real sword on the shield: sfx', sfx, 'hero x', heroBefore.toFixed(1), '->', heroAfter.toFixed(1));
  t.assert(sfx.includes('sword'), 'the hero swung');
  t.assert(k.hp === hpA, `shield took no damage (hp ${hpA} -> ${k.hp})`);
  t.assert(sfx.includes('swordTink'), 'block tinks');
  t.assert(Math.abs(heroAfter - heroBefore) > 4, `the shield pushes the hero back (${heroBefore.toFixed(1)} -> ${heroAfter.toFixed(1)})`);

  // ---- A real arrow into the shield: blocked, and only the arrow's own clink (no second tink).
  await t.wait(300);
  if ((await knight(t)).st !== 'walk') await waitState(t, 'walk', 6000);
  await placeHero(t, 'front', 64);
  await t.eval(() => { window.__qf.game.services.save.equipped = 'bow'; });
  await clearLogs(t);
  const hpArrow = (await knight(t)).hp;
  await t.press('KeyC', 60);
  await t.wait(450);
  const arrowLog = await t.eval(() => ({ sfx: window.__sfx.slice(), fx: window.__fx.filter((f) => f === 'fx.hit').length }));
  k = await knight(t);
  t.log('real arrow on the shield', arrowLog);
  t.assert(arrowLog.sfx.includes('arrow') && k.hp === hpArrow, `the shield stops the arrow (hp ${hpArrow} -> ${k.hp})`);
  t.assert(arrowLog.sfx.includes('arrowHit') && !arrowLog.sfx.includes('swordTink') && arrowLog.fx === 1, 'one clink: the arrow\'s own');

  // ---- A hit from behind lands.
  await t.wait(200);
  if ((await knight(t)).st !== 'walk') await waitState(t, 'walk', 6000);
  await placeHero(t, 'back');
  await clearLogs(t);
  const backLanded = await swordHit(t);
  await t.wait(40);
  await frozenShot(t, 'knight-back-hit');
  sfx = await t.eval(() => window.__sfx.slice());
  k = await knight(t);
  t.assert(backLanded && k.hp === hpArrow - 1, `hit from behind lands (hp ${hpArrow} -> ${k.hp})`);
  t.assert(sfx.includes('bossHit'), 'bossHit on damage');
  // Back well away on the open side, so the knight walks, braces and charges at the hero across the room.
  await t.eval(() => {
    const s = window.__qf.game.services;
    const kn = s.findEntity('knight');
    const right = kn.x < 128;
    s.player.place(right ? Math.min(232, kn.x + 110) : Math.max(24, kn.x - 110), kn.y, right ? 'left' : 'right');
  });

  // ---- Wind-up telegraph (the pose shows the shielded side), charge, wall crash -> stun.
  t.assert(await waitState(t, 'windup', 8000), 'winds up for a charge');
  await t.wait(200);
  k = await knight(t);
  t.log('windup', { facing: k.facing, anim: k.anim });
  t.assert(k.anim === (k.facing === 'down' ? 'charge' : `walk_${k.facing}`), `wind-up pose matches the shield side (${k.facing}, ${k.anim})`);
  await frozenPoseShot(t, 'knight-windup');
  t.assert(await waitState(t, 'charge', 3000), 'charges');
  await t.wait(120);
  await frozenShot(t, 'knight-charge');
  // Step aside so the charge hits the wall.
  await t.eval(() => {
    const p = window.__qf.game.services.player;
    p.place(p.x, p.y < 112 ? 190 : 40, 'right');
  });
  t.assert(await waitState(t, 'stun', 4000), 'crashing into the wall stuns it');
  await t.wait(300);
  k = await knight(t);
  t.assert(k.anim === 'stun' && k.contact === 0, `stunned: stun anim, harmless (${k.anim}, ${k.contact})`);
  await frozenShot(t, 'knight-stunned');

  // Stunned: a real sword swing from the room side lands.
  await placeHero(t, 'back', 22);
  const hpB = (await knight(t)).hp;
  await t.press('KeyZ', 50);
  await t.wait(90);
  await frozenShot(t, 'knight-stunned-hit');
  await t.wait(200);
  k = await knight(t);
  const heroOnFloor = await t.eval(() => {
    const s = window.__qf.game.services;
    return !s.room.blocked(s.player.hitbox(), 'walker');
  });
  t.assert(heroOnFloor, 'the hero stands on open floor beside the dazed knight');
  t.assert(k.hp === hpB - 1, `stunned knight takes a real sword hit (hp ${hpB} -> ${k.hp})`);
  await t.eval(() => window.__qf.game.services.player.place(128, 112, 'right'));

  // ---- Enraged (<= 50%): crouch telegraph, hop + shockwave slam.
  while ((await knight(t)).hp > 4) {
    await t.wait(550);
    await placeHero(t, 'back');
    await swordHit(t);
    await t.eval(() => window.__qf.game.services.player.place(128, 180, 'right'));
  }
  k = await knight(t);
  t.assert(k.enraged, `enraged at half health (hp ${k.hp})`);
  // Keep some distance so the slam ring is seen on open floor.
  await t.eval(() => {
    const s = window.__qf.game.services;
    const kn = s.findEntity('knight');
    s.player.place(kn.x < 128 ? 200 : 56, kn.y < 112 ? 170 : 56, 'left');
  });
  let crouched = await waitStateAtRange(t, 'crouch', 12000);
  if (!crouched) {
    t.log('no natural hop-slam within 12 s; starting one for the screenshots');
    await waitState(t, 'walk', 6000);
    await t.eval(() => window.__qf.game.services.findEntity('knight').startHop());
    crouched = true;
  }
  await t.wait(120);
  k = await knight(t);
  t.log('crouch', { z: k.z, anim: k.anim });
  t.assert(k.st === 'crouch' && k.z === 0 && k.anim.startsWith('attack_'), `telegraph: flail raised on the ground first (${k.st}, z ${k.z}, ${k.anim})`);
  await frozenPoseShot(t, 'knight-crouch');
  t.assert(await waitState(t, 'hop', 1500), 'then hops');
  await t.wait(200);
  k = await knight(t);
  t.log('hop', { z: k.z.toFixed(1), anim: k.anim });
  await frozenShot(t, 'knight-hop');
  await waitState(t, 'recover', 2000);
  await t.wait(100);
  const dust = await t.eval(() => window.__qf.game.services.entities.filter((e) => e.sprite === 'fx.dust').length);
  t.assert(dust >= 8, `slam raises a dust ring (${dust} puffs)`);
  await frozenShot(t, 'knight-slam');

  // ---- Stays in the room the whole time.
  k = await knight(t);
  t.assert(k.left >= 15.99 && k.right <= k.roomW - 15.99 && k.top >= 15.99 && k.bottom <= k.roomH - 15.99, 'inside the walls');

  // ---- Death: explosions, heart container, defeated flag.
  await clearLogs(t);
  while ((await knight(t))?.hp > 0) {
    await t.wait(550);
    k = await knight(t);
    if (!k || k.dying) break;
    await placeHero(t, 'back');
    await swordHit(t, 'sword', 2);
    await t.eval(() => window.__qf.game.services.player.place(128, 180, 'right'));
  }
  k = await knight(t);
  t.assert(k && k.dying && k.contact === 0, 'death sequence running, harmless');
  // Step away so the heart container lands on open floor, not under the hero.
  await t.eval(() => {
    const s = window.__qf.game.services;
    const kn = s.findEntity('knight');
    s.player.place(kn.x < 128 ? 210 : 46, kn.y < 112 ? 180 : 44, 'up');
  });
  await t.wait(900);
  await frozenShot(t, 'knight-exploding');
  await t.until(() => !window.__qf.game.services.findEntity('knight'), undefined, 6000);
  await t.wait(250);
  const end = await t.eval(() => {
    const s = window.__qf.game.services;
    const heart = s.entities.find((e) => e.id === 'knight-heart');
    return {
      flag: s.flag('defeated:knight'),
      heart: heart ? { type: heart.type, item: heart.inst?.props?.item, x: heart.x, y: heart.y } : null,
      booms: window.__sfx.filter((x) => x === 'bossDie').length,
      cleared: s.enemiesCleared(),
    };
  });
  t.log('after death', end);
  t.assert(end.flag, 'defeated:knight flag set');
  t.assert(end.booms === 2, `two bossDie rounds for twelve bursts (${end.booms})`);
  t.assert(end.cleared, 'room counts as cleared');
  t.assert(end.heart && end.heart.type === 'obj.pickup' && end.heart.item === 'heartContainer', 'heart container dropped');
  await t.shotCanvas('knight-defeated-heart');
}

/**
 * A hero hugging the bottom wall: the chase keeps the knight flush with that wall, and
 * every stun must still follow a real run-up (simulated with the loop stopped).
 */
async function wallHug(t) {
  await arena(t, {
    theme: 'dungeon', hearts: 10, player: { x: 48, y: 200, dir: 'right' },
    entities: [{ id: 'knight', type: 'boss.knight', x: 180, y: 190, props: { hp: 16 } }],
  });
  const res = await t.eval(() => {
    const g = window.__qf.game;
    g.stop();
    const s = g.services;
    s.debug.invincible = true;
    const k = s.findEntity('knight');
    const crashes = [];
    let last = k.aiState;
    let from = null;
    const step = () => {
      s.tick(1 / 60);
      if (k.aiState === last) return;
      if (k.aiState === 'charge') from = { x: k.x, y: k.y };
      if (k.aiState === 'stun' && from) crashes.push(+Math.hypot(k.x - from.x, k.y - from.y).toFixed(1));
      last = k.aiState;
    };
    for (let i = 0; i < 60 * 30; i++) step();
    // Then stop mid-charge for the screenshot.
    for (let i = 0; i < 60 * 20 && !(k.aiState === 'charge' && k.charged > 24); i++) step();
    return { crashes, charging: k.aiState === 'charge', aim: [+k.aim.x.toFixed(2), +k.aim.y.toFixed(2)], bottom: k.bottom, roomH: s.room.height };
  });
  t.log('wall-hug: px charged before each stun', res.crashes, 'then', { charging: res.charging, aim: res.aim, bottom: res.bottom });
  t.assert(res.crashes.length >= 2, `it keeps charging (${res.crashes.length} crashes in 30 s)`);
  t.assert(res.crashes.every((d) => d >= 16), `no free stuns against the wall it hugs (${res.crashes.join(', ')})`);
  // Draw the simulated moment without advancing it (start() would clear the canvas first).
  await t.eval(() => window.__qf.game.render()); // the Game's private frame draw: nothing ticks
  await t.shotCanvas('knight-wall-hug');
  await t.eval(() => window.__qf.game.start());
}

export default async function (t) {
  await fight(t);
  await wallHug(t);
}
