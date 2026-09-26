// Objects: markers and people — a warp between two rooms of a custom 2-room
// project (fade, respawn point, no bounce-back when arriving on a warp), a region
// marker, NPCs (still/wander/pace, talking with a name plate, 'talk' event) and a
// sign read from the front only.

/** Build a two-world project from two arena configs and run it (room B lives in world 'w2'). */
async function twoRooms(t, a, b) {
  await t.goto('#/');
  await t.eval(async ([ca, cb]) => {
    const { buildArenaProject } = await import('/src/dev/arena.ts');
    const { Game } = await import('/src/game/game.ts');
    const p = buildArenaProject(ca);
    const second = buildArenaProject(cb).worlds[0];
    p.worlds.push({ ...second, id: 'w2', name: 'Cellar', rooms: [{ ...second.rooms[0], id: 'roomB', name: 'Cellar' }] });
    window.__qf?.game?.destroy();
    const root = document.getElementById('app') ?? document.body;
    root.textContent = '';
    const host = document.createElement('div');
    host.className = 'qf-game-host';
    const canvas = document.createElement('canvas');
    canvas.className = 'qf-game-canvas';
    canvas.tabIndex = 0;
    host.appendChild(canvas);
    root.appendChild(host);
    const game = new Game(canvas, p, { mode: 'playtest' });
    window.__qf.game = game;
    window.__qf.ready = true;
    game.start();
    canvas.focus();
  }, [a, b]);
  await t.until(() => !!(window.__qf.game && window.__qf.game.services), undefined, 5000);
  await t.eval(() => { window.S = () => window.__qf.game.services; });
  await t.wait(150);
}

async function arena(t, cfg) {
  await t.goto('#/');
  await t.eval(async (c) => (await import('/src/dev/arena.ts')).startArena(c), cfg);
  await t.until(() => !!(window.__qf.game && window.__qf.game.services), undefined, 5000);
  // Page-side shorthand used inside t.eval callbacks.
  await t.eval(() => { window.S = () => window.__qf.game.services; });
  await t.wait(150);
}

const where = (t) => t.eval(() => ({ room: S().room.def.id, world: S().room.world.id, x: S().player.x, y: S().player.y, game: window.__qf.game.state }));

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
  // ---------------------------------------------------------------- warp between two rooms
  const toCellar = { world: 'w2', room: 'roomB', x: 120, y: 150, dir: 'up' };
  const toField = { world: 'arena', room: 'arena_room', x: 150, y: 112, dir: 'left' };
  await twoRooms(t,
    {
      theme: 'grass', player: { x: 100, y: 104, dir: 'right' },
      tiles: [{ layer: 'fg', tx: 12, ty: 6, tile: 'STAIRS_DOWN' }],
      entities: [
        { id: 'down', type: 'marker.warp', x: 200, y: 104, props: { target: toCellar, sound: 'stairs', transition: 'fade' } },
        { id: 'zone', type: 'marker.region', x: 64, y: 64, props: { name: 'grove', w: 3, h: 2 } },
      ],
    },
    {
      theme: 'dungeon',
      tiles: [{ layer: 'fg', tx: 7, ty: 9, tile: 'DSTAIRS_UP' }],
      entities: [{ id: 'up', type: 'marker.warp', x: 120, y: 152, props: { target: toField, sound: 'stairs', setRespawn: false } }],
    });
  const markers = await t.eval(() => S().entities.filter((e) => e.type.startsWith('marker.')).map((e) => ({ id: e.id, visible: e.visible, w: e.w, h: e.h })));
  t.assert(markers.length === 2 && markers.every((m) => !m.visible), `markers are invisible (${JSON.stringify(markers)})`);
  t.assert(await t.eval(() => { const z = S().findEntity('zone'); return z.contains(64, 64) && !z.contains(100, 64) && z.name === 'grove'; }), 'region rect and name');
  await t.eval(() => { window.__qf.game.setDebug?.({ hitboxes: true }); S().debug.hitboxes = true; });
  await t.shotCanvas('field-warp-hitboxes');
  await t.eval(() => { S().debug.hitboxes = false; });
  await t.hold(['ArrowRight'], 1200);
  await t.shotCanvas('warp-fading');
  await t.until(() => S().room.def.id === 'roomB' && window.__qf.game.state === 'playing', undefined, 3000).catch(() => {});
  let w = await where(t);
  t.assert(w.room === 'roomB' && w.world === 'w2', `warped into the cellar (${JSON.stringify(w)})`);
  t.assert(Math.abs(w.x - 120) < 1 && Math.abs(w.y - 150) < 1, `placed at the warp target (${w.x},${w.y})`);
  const respawn = await t.eval(() => S().save.respawn);
  t.assert(respawn.room === 'roomB', `warp set the respawn point (${JSON.stringify(respawn)})`);
  // Arrived standing inside the cellar's own warp: it must not fire until the hero steps out.
  await t.wait(800);
  w = await where(t);
  t.assert(w.room === 'roomB', `no bounce back while standing on the arrival warp (${w.room})`);
  await t.shotCanvas('cellar-arrived');
  await t.hold(['ArrowUp'], 350);
  await t.hold(['ArrowDown'], 380);
  await t.until(() => S().room.def.id === 'arena_room' && window.__qf.game.state === 'playing', undefined, 3000).catch(() => {});
  w = await where(t);
  t.assert(w.room === 'arena_room', `stepping out and back onto the warp returns to the field (${JSON.stringify(w)})`);
  const respawn2 = await t.eval(() => S().save.respawn.room);
  t.assert(respawn2 === 'roomB', `setRespawn=false keeps the old respawn (${respawn2})`);
  await t.shotCanvas('back-in-field');

  // ---------------------------------------------------------------- NPCs + sign
  await arena(t, {
    theme: 'interior', player: { x: 128, y: 170, dir: 'up' },
    dialogues: [{ id: 'dlg_elder', name: 'Elder', pages: [{ speaker: 'Elder', text: 'The old well hides more than water.' }] }],
    entities: [
      { id: 'elder', type: 'npc.person', x: 128, y: 120, props: { sprite: 'npc.elder', name: 'Elder', dialogue: 'dlg_elder', behavior: 'still', facing: 'down' } },
      { id: 'kid', type: 'npc.person', x: 60, y: 80, props: { sprite: 'npc.child', name: 'Pip', dialogue: 'Tag! You are it!', behavior: 'wander' } },
      { id: 'guard', type: 'npc.person', x: 180, y: 60, props: { sprite: 'npc.guard', name: 'Guard', dialogue: 'Halt!', behavior: 'pace', facing: 'down' } },
      { id: 'sign', type: 'obj.sign', x: 200, y: 160, props: { text: 'Mind the step.' } },
    ],
  });
  await t.eval(() => {
    const s = S();
    window.__events = [];
    const orig = s.emit.bind(s);
    s.emit = (e) => { window.__events.push(e); orig(e); };
  });
  await t.wait(1500);
  const moved = await t.eval(() => {
    const g = S().findEntity('guard');
    return { gy: g.y, gAnim: g.anim, kid: [S().findEntity('kid').x, S().findEntity('kid').y] };
  });
  t.log('npcs after 1.5 s', moved);
  t.assert(moved.gy > 60, `pacing guard walks along its facing (${moved.gy})`);
  await t.shotCanvas('npcs');
  await t.hold(['ArrowUp'], 400);
  const how = await interact(t, 'elder');
  t.log('npc interaction via', how);
  await t.wait(600);
  const talk = await t.eval(() => ({ game: window.__qf.game.state, facing: S().findEntity('elder').facing, talking: S().findEntity('elder').talking }));
  t.assert(talk.game === 'dialogue' && talk.facing === 'down' && talk.talking, `elder talks facing the hero (${JSON.stringify(talk)})`);
  await t.shotCanvas('npc-dialogue');
  await closeDialogue(t);
  await t.wait(100);
  const ev = await t.eval(() => window.__events.filter((e) => e.type === 'talk'));
  t.assert(ev.some((e) => e.id === 'elder'), `talk event after the dialogue (${JSON.stringify(ev)})`);
  // Talk to the pacing guard from the side: it turns to face the hero.
  await t.eval(() => {
    const g = S().findEntity('guard');
    S().player.place(g.x - 15, g.y, 'right');
  });
  await t.wait(50);
  await interact(t, 'guard');
  await t.wait(400);
  const guard = await t.eval(() => ({ facing: S().findEntity('guard').facing, game: window.__qf.game.state }));
  t.assert(guard.facing === 'left' && guard.game === 'dialogue', `guard turns to the hero and speaks (${JSON.stringify(guard)})`);
  await t.shotCanvas('guard-dialogue');
  await closeDialogue(t);
  // Sign: read from the front; from the side the action lifts it instead.
  await t.eval(() => S().player.place(200, 175, 'up'));
  await t.wait(50);
  await interact(t, 'sign');
  await t.wait(500);
  t.assert((await t.eval(() => window.__qf.game.state)) === 'dialogue', 'sign read from the front');
  await t.shotCanvas('sign-read');
  await closeDialogue(t);
  await t.eval(() => S().player.place(182, 160, 'right'));
  await t.wait(50);
  const sideRead = await t.eval(() => S().findEntity('sign').onInteract());
  t.assert(sideRead === false, 'sign is not read from the side');
  await t.press('KeyX', 60);
  await t.wait(400);
  const side = await t.eval(() => ({ game: window.__qf.game.state, st: S().player.state, sign: !!S().findEntity('sign') }));
  t.log('side action on the sign', side);
  t.assert(side.game !== 'dialogue', `no text from the side (${JSON.stringify(side)})`);
  if (!side.sign) await t.shotCanvas('sign-lifted');
}
