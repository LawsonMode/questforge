// Game UI e2e: triggers in the arena and the test project. (1) stepping on a
// floor switch opens a shutter through an 'auto' trigger (switch -> openDoor +
// secret); (2) clearing the enemies reveals a hidden chest (enemiesCleared ->
// showEntity); (3) an 'enter' trigger records its once flag when it fires, runs
// a dialogue (in a box at the bottom), then sets a flag; (4) a flagged choice in
// a trigger dialogue sets its flag, and the box moves to the top while the hero
// is low on the screen; (5) an 'enter' trigger of a room reached by an edge
// scroll runs only once the scroll is over; (6) collecting a dungeon crystal
// plays the default dungeon-complete flow (one item-get message naming the
// prize, then the victory jingle), moves the respawn point out and warps outside.
const arena = (t, cfg) => t.eval(async (c) => (await import('/src/dev/arena.ts')).startArena(c), cfg);
const svc = (t, fn, arg) => t.eval(fn, arg);
const gameState = (t) => t.eval(() => window.__qf.game && window.__qf.game.state);

async function clearDialogues(t, max = 20) {
  for (let i = 0; i < max && (await gameState(t)) === 'dialogue'; i++) {
    await t.hold(['KeyX'], 250);
    await t.wait(80);
  }
}

/** Text lines of the dialogue box currently shown (the session's box internals), or null. */
const shownDialogue = (t) => svc(t, () => {
  const box = window.__qf.game.services.dialogueBox;
  const req = box && box.current;
  return req ? { lines: req.boxes[box.boxIndex].lines, position: req.position } : null;
});

export default async function (t) {
  await t.goto('#/');

  // (1) Floor switch -> shutter.
  await arena(t, {
    theme: 'dungeon',
    player: { x: 128, y: 184, dir: 'up' },
    entities: [
      { id: 'door', type: 'obj.door', x: 128, y: 8, props: { dir: 'up', kind: 'shutter', opensWhen: 'trigger' } },
      { id: 'sw', type: 'obj.switch', x: 128, y: 120, props: { mode: 'once' } },
    ],
    triggers: [{
      id: 'tr_switch', name: 'Switch opens shutter', on: 'auto', once: true,
      conditions: [{ kind: 'switch', target: 'sw', on: true }],
      actions: [{ kind: 'openDoor', target: 'door' }, { kind: 'secret' }],
    }],
  });
  await t.until(() => window.__qf.game && window.__qf.game.services);
  await t.wait(300);
  const before = await svc(t, () => {
    const d = window.__qf.game.services.findEntity('door');
    return d ? { solid: d.solid } : null;
  });
  t.assert(!!before && before.solid, `the shutter starts closed (${JSON.stringify(before)})`);
  await t.shotCanvas('switch-before');
  await t.hold(['ArrowUp'], 800);
  await t.wait(400);
  const after = await svc(t, () => {
    const s = window.__qf.game.services;
    const d = s.findEntity('door');
    return { solid: d && d.solid, fired: s.flag('trigger:tr_switch'), doorFlag: s.flag('door:door'), y: s.player.y };
  });
  t.log('after stepping on the switch', after);
  t.assert(after.fired, 'the switch trigger fired');
  t.assert(after.solid === false && after.doorFlag, 'the shutter opened (and persisted)');
  await t.shotCanvas('switch-after');

  // (2) Enemies cleared -> hidden chest appears.
  await arena(t, {
    theme: 'dungeon',
    player: { x: 128, y: 184, dir: 'up' },
    entities: [
      { id: 'e1', type: 'enemy.soldier', x: 64, y: 64, props: { behavior: 'guard' } },
      { id: 'e2', type: 'enemy.soldier', x: 192, y: 64, props: { behavior: 'guard' } },
      { id: 'chest', type: 'obj.chest', x: 128, y: 104, props: { hidden: true, item: 'rupees', amount: 20 } },
    ],
    triggers: [{
      id: 'tr_clear', name: 'Cleared -> chest', on: 'auto', once: true,
      conditions: [{ kind: 'enemiesCleared' }],
      actions: [{ kind: 'showEntity', target: 'chest' }, { kind: 'secret' }],
    }],
  });
  await t.until(() => window.__qf.game && window.__qf.game.services && window.__qf.game.services.room.def.id === 'arena_room');
  await t.wait(300);
  const hiddenAtStart = await svc(t, () => !window.__qf.game.services.findEntity('chest'));
  t.assert(hiddenAtStart, 'the chest is hidden while enemies remain');
  await svc(t, () => {
    const s = window.__qf.game.services;
    s.debug.invincible = true;
    for (const id of ['e1', 'e2']) {
      const e = s.findEntity(id);
      if (e) e.die();
    }
  });
  await t.wait(500);
  const chest = await svc(t, () => {
    const s = window.__qf.game.services;
    return { present: !!s.findEntity('chest'), shown: s.flag('shown:chest'), remaining: s.enemiesRemaining() };
  });
  t.log('after clearing', chest);
  t.assert(chest.remaining === 0 && chest.present && chest.shown, 'the hidden chest appears once the room is cleared');
  await t.shotCanvas('cleared-chest');

  // (3) Enter trigger: once flag at once, dialogue, then a flag.
  await arena(t, {
    theme: 'interior',
    player: { x: 128, y: 100, dir: 'up' },
    dialogues: [{ id: 'd_hello', name: 'Hello', pages: [{ speaker: 'Voice', text: 'Welcome, {name}. The door behind you has closed.' }] }],
    triggers: [{
      id: 'tr_enter', name: 'Greeting', on: 'enter', once: true, conditions: [],
      actions: [{ kind: 'dialogue', dialogue: 'd_hello' }, { kind: 'setFlag', flag: 'greeted', value: true }],
    }],
  });
  await t.until(() => window.__qf.game && window.__qf.game.services);
  await t.wait(400);
  const greeting = await svc(t, () => {
    const s = window.__qf.game.services;
    return { state: window.__qf.game.state, greeted: s.flag('greeted'), once: s.flag('trigger:tr_enter') };
  });
  t.assert(greeting.state === 'dialogue' && !greeting.greeted, `the enter trigger opens its dialogue first (${JSON.stringify(greeting)})`);
  t.assert(greeting.once, 'the once flag is recorded as soon as the trigger fires');
  await t.wait(1200);
  const greetingBox = await shownDialogue(t);
  t.assert(greetingBox && greetingBox.position === 'bottom', `the box sits at the bottom while the hero stands high (${JSON.stringify(greetingBox)})`);
  await t.shotCanvas('enter-dialogue');
  await clearDialogues(t);
  await t.wait(200);
  const greeted = await svc(t, () => window.__qf.game.services.flag('greeted'));
  t.assert(greeted, 'the action after the dialogue ran once it closed');

  // (4) A flagged choice (hero low on the screen).
  await arena(t, {
    theme: 'dungeon',
    player: { x: 128, y: 192, dir: 'up' },
    dialogues: [{
      id: 'd_ask', name: 'Ask',
      pages: [{ speaker: 'Guard', text: 'Will you help us, {name}?', choice: { options: ['Gladly', 'No way'], flag: 'agreed' } }],
    }],
    triggers: [{
      id: 'tr_ask', name: 'Ask', on: 'enter', once: true, conditions: [],
      actions: [{ kind: 'dialogue', dialogue: 'd_ask' }, { kind: 'setFlag', flag: 'asked', value: true }],
    }],
  });
  await t.until(() => window.__qf.game && window.__qf.game.state === 'dialogue');
  // Mashing right away never answers: the options ignore input until they have been seen.
  await t.press('KeyX');
  await t.wait(1200);
  const asking = await shownDialogue(t);
  t.log('choice box', asking);
  t.assert(asking && asking.lines.join(' ').includes('Will you help'), 'the question is still up after mashing');
  t.assert(asking && asking.position === 'top', `the box moves to the top while the hero is low on the screen (${JSON.stringify(asking)})`);
  await t.shotCanvas('choice');
  await t.press('KeyX');
  await t.wait(300);
  const answer = await svc(t, () => ({ agreed: window.__qf.game.services.flag('agreed'), asked: window.__qf.game.services.flag('asked') }));
  t.assert(answer.agreed && answer.asked, `choosing option 0 sets the choice flag (${JSON.stringify(answer)})`);

  // (5) 'enter' trigger of a room reached by an edge scroll: nothing runs mid-scroll.
  await t.goto('#/playtest/test');
  await t.until(() => window.__qf.game && window.__qf.game.services);
  await t.wait(300);
  await svc(t, () => {
    const g = window.__qf.game;
    const s = g.services;
    window.__trLog = [];
    const sfx = s.audio.sfx.bind(s.audio);
    s.audio.sfx = (id, o) => {
      if (id === 'secret' || id === 'door') window.__trLog.push(`${id}@${g.state}`);
      return sfx(id, o);
    };
    const lake = s.project.worlds.find((w) => w.id === 'ow').rooms.find((r) => r.id === 'ow_lake');
    lake.triggers.push({
      id: 'tr_slam', name: 'Ambush slam', on: 'enter', once: false, conditions: [],
      actions: [{ kind: 'sound', sfx: 'door' }, { kind: 'wait', seconds: 0.1 }, { kind: 'secret' }],
    });
    s.player.place(244, 120, 'right');
  });
  await t.page.keyboard.down('ArrowRight');
  await t.wait(200);
  const midScroll = await svc(t, () => ({ state: window.__qf.game.state, log: window.__trLog.slice() }));
  await t.page.keyboard.up('ArrowRight');
  await t.wait(1200);
  const afterScroll = await svc(t, () => ({ room: window.__qf.game.services.room.def.id, log: window.__trLog.slice() }));
  t.log('enter trigger around the scroll', midScroll, afterScroll);
  t.assert(midScroll.state === 'transition' && midScroll.log.length === 0, `nothing runs mid-scroll (${JSON.stringify(midScroll)})`);
  t.assert(afterScroll.room === 'ow_lake' && afterScroll.log.join() === 'door@playing,secret@playing',
    `the enter trigger runs once the room is on screen (${JSON.stringify(afterScroll)})`);

  // (6) Dungeon completion in the test project.
  await t.eval(() => window.__qf.game.warpNow({ world: 'dg', room: 'dg_entry', x: 128, y: 120, dir: 'up' }));
  await t.wait(200);
  await svc(t, () => {
    window.__qf.game.services.save.respawn = { world: 'dg', room: 'dg_entry', x: 128, y: 184, dir: 'up' };
    window.__qf.game.services.giveItem('crystal', 1, { fanfare: true });
  });
  await t.wait(300);
  const underMessage = await svc(t, () => window.__qf.game.services.audio.currentMusic);
  t.assert(underMessage !== 'victory', `the jingle waits for the item-get message (the fanfare plays alone) (${underMessage})`);
  const respawn = await svc(t, () => window.__qf.game.services.save.respawn);
  t.assert(respawn.world === 'ow' && respawn.room === 'ow_cross', `the respawn point moves out of the dungeon (${JSON.stringify(respawn)})`);
  await t.wait(900);
  const engineMessage = await shownDialogue(t);
  t.log('crystal message', engineMessage);
  t.assert(engineMessage && engineMessage.lines.join(' ').includes('You got the Test Dungeon Crystal!'), 'the item-get message names the prize');
  await t.shotCanvas('crystal-message');
  await clearDialogues(t);
  await t.wait(300);
  const jingle = await svc(t, () => ({ music: window.__qf.game.services.audio.currentMusic, state: window.__qf.game.state }));
  t.assert(jingle.music === 'victory' && jingle.state === 'playing', `then the victory jingle, and no second message (${JSON.stringify(jingle)})`);
  await t.until(() => window.__qf.game.services.room.def.id === 'ow_cross', undefined, 6000).catch(() => {});
  const room = await svc(t, () => window.__qf.game.services.room.def.id);
  t.assert(room === 'ow_cross', `the hero is warped out through the entrance warp (${room})`);
  await t.wait(300);
  await t.shotCanvas('outside');
}
