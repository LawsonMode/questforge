// Bosses: edge cases around the fights.
//   A. A shutter shut on the Iron Knight / the Giant Worm (plus the doorway's
//      jambs) never traps it: it walks out and keeps fighting.
//   B. With the hero standing in an open doorway, neither boss ever enters
//      it; the knight's charges crash on its edge.
//   C. Real sword swings down onto the knight's helm land when it faces away
//      and tink off the shield when it faces the hero.
//   D. Real bombs: in front of the shield a spark + tink and no damage; behind it they hurt.
//   E. Leaving the room while a boss explodes still counts as its defeat, and
//      its heart container waits on re-entry.
//   F. In a dark room the whole worm glows faintly, the tail brightest.
// The game loop is stopped and ticked by hand wherever timing matters.

const DOORWAY = [{ layer: 'fg', tx: 7, ty: 0, w: 2, h: 1, tile: 0 }];

async function arena(t, cfg) {
  await t.goto('#/');
  await t.eval(async (c) => (await import('/src/dev/arena.ts')).startArena(c), cfg);
  await t.until(() => !!(window.__qf.game && window.__qf.game.services), undefined, 5000);
}

/** Two side-by-side grass rooms (the arena room on the left, an empty one on its right). */
async function twoRooms(t, cfg) {
  await t.goto('#/');
  await t.eval(async (c) => {
    const { buildArenaProject } = await import('/src/dev/arena.ts');
    const { Game } = await import('/src/game/game.ts');
    const project = buildArenaProject(c);
    const w = project.worlds[0];
    const r2 = JSON.parse(JSON.stringify(w.rooms[0]));
    r2.id = 'room2';
    r2.gx = 1;
    r2.entities = [];
    w.rooms.push(r2);
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
  }, cfg);
  await t.until(() => !!(window.__qf.game && window.__qf.game.services), undefined, 5000);
}

/** Draw the current (hand-ticked) moment without advancing it, for the screenshot. */
async function drawnShot(t, label) {
  await t.eval(() => window.__qf.game.render()); // the Game's private frame draw: nothing ticks
  await t.shotCanvas(label);
}

async function shutOnBosses(t) {
  // Knight: standing in the open doorway when the shutter slams shut on it (and its jambs overlap it too).
  await arena(t, {
    theme: 'dungeon', hearts: 10, player: { x: 128, y: 170, dir: 'up' }, tiles: DOORWAY,
    entities: [
      { id: 'door', type: 'obj.door', x: 128, y: 8, props: { dir: 'up', kind: 'shutter', opensWhen: 'trigger' } },
      { id: 'knight', type: 'boss.knight', x: 128, y: 120, props: { hp: 16 } },
    ],
  });
  const k1 = await t.eval(() => {
    const g = window.__qf.game;
    g.stop();
    const s = g.services;
    s.debug.invincible = true;
    const k = s.findEntity('knight');
    const d = s.findEntity('door');
    for (let i = 0; i < 70; i++) s.tick(1 / 60);
    d.setOpen(true, true);
    k.x = 128;
    k.y = 12;
    d.setOpen(false, true);
    const trapped = s.entities.filter((e) => e.solid && e !== k && e.overlaps(k)).map((e) => e.type);
    const at = { x: k.x, y: k.y };
    for (let i = 0; i < 60 * 4; i++) s.tick(1 / 60);
    const out = { moved: +Math.hypot(k.x - at.x, k.y - at.y).toFixed(1), top: +k.top.toFixed(1) };
    let stuns = 0;
    let last = k.aiState;
    for (let i = 0; i < 60 * 25; i++) {
      s.tick(1 / 60);
      if (k.aiState !== last && k.aiState === 'stun') stuns++;
      last = k.aiState;
    }
    return { doorSolid: d.solid, trapped, out, stuns };
  });
  t.log('knight shut in the doorway', k1);
  t.assert(k1.doorSolid && k1.trapped.includes('obj.door'), `the shutter closed on the knight (${k1.trapped.join(', ')})`);
  t.assert(k1.out.moved > 20 && k1.out.top >= 16, `the knight walked out of the doorway (${k1.out.moved} px, top ${k1.out.top})`);
  t.assert(k1.stuns >= 1, `and kept charging into walls (${k1.stuns} stuns in 25 s)`);
  await drawnShot(t, 'knight-freed-from-shutter');

  // Worm: its head shut in the doorway.
  await arena(t, {
    theme: 'dungeon', hearts: 10, player: { x: 60, y: 190, dir: 'up' }, tiles: DOORWAY,
    entities: [
      { id: 'door', type: 'obj.door', x: 128, y: 8, props: { dir: 'up', kind: 'shutter', opensWhen: 'trigger' } },
      { id: 'worm', type: 'boss.worm', x: 128, y: 110, props: { hp: 12, segments: 4 } },
    ],
  });
  const w1 = await t.eval(() => {
    const g = window.__qf.game;
    g.stop();
    const s = g.services;
    s.debug.invincible = true;
    const w = s.findEntity('worm');
    const d = s.findEntity('door');
    for (let i = 0; i < 70; i++) s.tick(1 / 60);
    d.setOpen(true, true);
    w.x = 128;
    w.y = 13;
    w.heading = w.targetHeading = -Math.PI / 2;
    d.setOpen(false, true);
    const trapped = s.entities.filter((e) => e.solid && e.overlaps(w)).map((e) => e.type);
    const at = { x: w.x, y: w.y };
    let maxMove = 0;
    for (let i = 0; i < 60 * 3; i++) {
      s.tick(1 / 60);
      maxMove = Math.max(maxMove, Math.hypot(w.x - at.x, w.y - at.y));
    }
    return { trapped, maxMove: +maxMove.toFixed(1), top: +w.top.toFixed(1) };
  });
  t.log('worm shut in the doorway', w1);
  t.assert(w1.trapped.includes('obj.door'), 'the shutter closed on the worm head');
  t.assert(w1.maxMove > 40 && w1.top >= 16, `the worm crawled out (${w1.maxMove} px, top ${w1.top})`);
  await drawnShot(t, 'worm-freed-from-shutter');
}

async function keepOutOfDoorways(t) {
  for (const type of ['boss.knight', 'boss.worm']) {
    // The hero stands in the open doorway while the boss fights.
    await arena(t, {
      theme: 'dungeon', hearts: 10, player: { x: 128, y: 10, dir: 'down' }, tiles: DOORWAY,
      entities: [
        { id: 'door', type: 'obj.door', x: 128, y: 8, props: { dir: 'up', kind: 'shutter', opensWhen: 'trigger' } },
        { id: 'boss', type, x: 128, y: 150, props: { hp: 16, segments: 4 } },
      ],
    });
    const res = await t.eval(() => {
      const g = window.__qf.game;
      g.stop();
      const s = g.services;
      s.debug.invincible = true;
      const b = s.findEntity('boss');
      const d = s.findEntity('door');
      d.setOpen(true, true);
      let minTop = Infinity;
      let doorCrashes = 0;
      let last = b.aiState;
      // Right in front of the doorway (not a crash into the wall beside it).
      const atDoor = () => Math.abs(b.x - d.x) < d.w / 2 && b.top < d.bottom + 8;
      const tick = () => {
        s.player.place(128, 10, 'down');
        s.tick(1 / 60);
        minTop = Math.min(minTop, b.top);
        if (b.aiState !== last && b.aiState === 'stun' && atDoor()) doorCrashes++;
        last = b.aiState;
      };
      // The worm crawls for 20 s; the knight fights until its first crash at the doorway (the screenshot).
      const knight = b.aiState !== undefined;
      let n = 0;
      while (n < 60 * (knight ? 40 : 20) && !(knight && doorCrashes > 0)) {
        tick();
        n++;
      }
      return { open: !d.solid, doorBottom: d.bottom, minTop: +minTop.toFixed(1), doorCrashes, seconds: +(n / 60).toFixed(1) };
    });
    t.log(`${type} with the hero in an open doorway`, res);
    t.assert(res.open && res.minTop >= res.doorBottom - 0.01, `${type}: never enters the doorway (top >= ${res.doorBottom}, min ${res.minTop})`);
    t.assert(res.minTop < res.doorBottom + 8, `${type}: it did come right up to it (min top ${res.minTop})`);
    if (type === 'boss.knight') t.assert(res.doorCrashes >= 1, `the knight crashes on the doorway's edge (after ${res.seconds} s)`);
    await drawnShot(t, `${type.slice(5)}-kept-out-of-doorway`);
  }
}

async function helmAndBombs(t) {
  await arena(t, {
    theme: 'dungeon', hearts: 10, items: { bombs: 5 }, player: { x: 128, y: 40, dir: 'down' },
    entities: [{ id: 'knight', type: 'boss.knight', x: 128, y: 120, props: { hp: 16 } }],
  });
  await t.eval(() => {
    const g = window.__qf.game;
    g.stop();
    const s = g.services;
    s.debug.invincible = true;
    for (let i = 0; i < 70; i++) s.tick(1 / 60);
    const k = s.findEntity('knight');
    k.intro = 999; // hold it in place: only its facing matters here
    window.__sfx = [];
    const a = s.audio;
    const orig = a.sfx.bind(a);
    a.sfx = (id, o) => { window.__sfx.push(id); orig(id, o); };
    // One simulated press of the sword button per swing (the loop is stopped).
    const inp = s.input;
    window.__press = new Set();
    inp.pressed = (b) => window.__press.has(b);
    inp.held = () => false;
    inp.dir = () => ({ x: 0, y: 0 });
  });

  /** A real swing down at the knight from `gap` px above its centre, the knight facing `facing`. */
  const swing = (gap, facing, frames = 20) => t.eval(([g2, f, n]) => {
    const s = window.__qf.game.services;
    const k = s.findEntity('knight');
    const p = s.player;
    k.hp = 16;
    k.invuln = 0;
    k.facing = f;
    p.place(k.x, k.y - g2, 'down');
    window.__sfx.length = 0;
    window.__press.add('b');
    s.tick(1 / 60);
    window.__press.clear();
    for (let i = 0; i < n; i++) {
      k.facing = f;
      s.tick(1 / 60);
    }
    return { damage: 16 - k.hp, tink: window.__sfx.includes('swordTink'), hit: window.__sfx.includes('bossHit') };
  }, [gap, facing, frames]);

  const away = {};
  for (const gap of [22, 26, 30]) away[gap] = await swing(gap, 'down');
  t.log('real swings onto the helm, knight facing away', away);
  for (const gap of [22, 26, 30]) {
    t.assert(away[gap].damage === 1 && away[gap].hit && !away[gap].tink, `a swing onto the helm from ${gap} px lands, once (${JSON.stringify(away[gap])})`);
  }
  await swing(26, 'down', 3);
  await drawnShot(t, 'helm-hit');
  await t.eval(() => { for (let i = 0; i < 40; i++) window.__qf.game.services.tick(1 / 60); });
  const facing = await swing(26, 'up');
  t.log('real swing onto the helm, knight facing the hero', facing);
  t.assert(facing.damage === 0 && facing.tink, `the shield takes a swing at the helm from the front (${JSON.stringify(facing)})`);

  /** A real bomb `dx` px beside the knight while it faces right. */
  const bomb = (dx) => t.eval(async (bx) => {
    const s = window.__qf.game.services;
    const { Bomb } = await import('/src/game/projectiles/bomb.ts');
    const k = s.findEntity('knight');
    k.hp = 16;
    k.invuln = 0;
    s.player.place(40, 200, 'up');
    window.__sfx.length = 0;
    const fx = [];
    const origFx = s.effect.bind(s);
    s.effect = (sp, an, x, y, o) => { fx.push(sp); return origFx(sp, an, x, y, o); };
    const b = s.spawn(new Bomb(s, k.x + bx, k.y));
    let n = 0;
    while (!b.dead && n++ < 400) {
      k.facing = 'right';
      s.tick(1 / 60);
    }
    for (let i = 0; i < 3; i++) s.tick(1 / 60);
    s.effect = origFx;
    return { damage: 16 - k.hp, sfx: window.__sfx.slice(0, 6), spark: fx.includes('fx.hit') };
  }, dx);
  const front = await bomb(22);
  t.log('real bomb in front of the shield', front);
  t.assert(front.damage === 0 && front.sfx.includes('swordTink') && front.spark, 'a bomb in front of the shield glances off with a spark and a tink');
  await t.eval(() => { for (let i = 0; i < 40; i++) window.__qf.game.services.tick(1 / 60); });
  const back = await bomb(-22);
  t.log('real bomb behind the knight', back);
  t.assert(back.damage === 2 && back.sfx.includes('bossHit') && !back.sfx.includes('swordTink'), 'a bomb behind the knight hurts it (once, no tink)');
}

async function leaveMidDeath(t) {
  for (const type of ['boss.knight', 'boss.worm']) {
    await twoRooms(t, {
      theme: 'grass', walls: false, hearts: 10, player: { x: 236, y: 112, dir: 'right' },
      entities: [{ id: 'boss', type, x: 100, y: 112, props: { hp: 1, segments: 3 } }],
    });
    const res = await t.eval(() => {
      const g = window.__qf.game;
      g.stop();
      const s = g.services;
      s.debug.invincible = true;
      const b = s.findEntity('boss');
      for (let i = 0; i < 70; i++) s.tick(1 / 60);
      b.die();
      for (let i = 0; i < 30; i++) s.tick(1 / 60);
      const dying = b.dying && !b.dead;
      s.player.x = s.room.width + 0.5; // step off the east edge: scroll to room2
      for (let i = 0; i < 120; i++) s.tick(1 / 60);
      const room = s.room.def.id;
      const flag = s.flag('defeated:boss');
      g.warpNow({ world: 'arena', room: 'arena_room', x: 236, y: 112 });
      s.tick(1 / 60);
      const heart = g.services.entities.find((e) => e.id === 'boss-heart' && !e.dead);
      return { dying, room, flag, back: !!g.services.findEntity('boss'), heart: heart ? heart.inst?.props?.item : null };
    });
    t.log(`left the room mid-death (${type})`, res);
    t.assert(res.dying && res.room === 'room2', `${type}: left while it was exploding`);
    t.assert(res.flag && !res.back, `${type}: still defeated after leaving mid-death`);
    t.assert(res.heart === 'heartContainer', `${type}: its heart container waits on re-entry (${res.heart})`);
  }
}

async function darkWorm(t) {
  await arena(t, {
    theme: 'dungeon', dark: true, hearts: 10, player: { x: 40, y: 190, dir: 'up' },
    entities: [{ id: 'worm', type: 'boss.worm', x: 150, y: 100, props: { hp: 12, segments: 4 } }],
  });
  await t.wait(2200);
  const lights = await t.eval(() => {
    const w = window.__qf.game.services.findEntity('worm');
    return [w.light, ...w.parts.map((p) => p.light)];
  });
  t.log('worm lights (head, body..., tail)', lights);
  t.assert(lights.every((l) => l > 0) && lights[lights.length - 1] === Math.max(...lights), 'every piece glows, the tail brightest');
  await t.eval(() => window.__qf.game.stop());
  await t.shotCanvas('dark-worm');
}

export default async function (t) {
  await shutOnBosses(t);
  await keepOutOfDoorways(t);
  await helmAndBombs(t);
  await leaveMidDeath(t);
  await darkWorm(t);
}
