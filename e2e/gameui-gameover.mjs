// Game UI e2e: game over. Lethal damage (debug invincibility off) -> red wash,
// fade, "GAME OVER" letters, CONTINUE / SAVE & QUIT; CONTINUE resumes play with
// restored hearts.
const state = (t) => t.eval(() => window.__qf.game.state);

export default async function (t) {
  await t.goto('#/playtest/test');
  await t.until(() => window.__qf.game && window.__qf.game.services);
  await t.wait(300);
  const result = await t.eval(() => {
    const s = window.__qf.game.services;
    s.debug.invincible = false;
    return s.player.hurtPlayer({ damage: 99, kind: 'contact', source: null, dx: 0, dy: 1 });
  });
  t.assert(result === 'hit', `the lethal hit lands (${result})`);
  await t.until(() => window.__qf.game.state === 'gameOver', undefined, 8000);
  const music = await t.eval(() => window.__qf.game.services.audio.currentMusic);
  t.assert(music === 'gameover', `game over music plays (${music})`);
  await t.wait(500);
  await t.shotCanvas('red-wash');
  await t.wait(1300);
  await t.shotCanvas('letters');
  await t.wait(1000);
  await t.shotCanvas('menu');
  await t.press('ArrowDown');
  await t.wait(100);
  await t.shotCanvas('menu-save-quit');
  await t.press('ArrowUp');
  await t.wait(100);
  await t.press('KeyX');
  await t.until(() => window.__qf.game.state !== 'gameOver', undefined, 3000);
  await t.wait(400);
  const after = await t.eval(() => ({ state: window.__qf.game.state, hp: window.__qf.game.services.save.hp }));
  t.log('after continue', after);
  t.assert(after.state === 'playing' || after.state === 'transition', `CONTINUE resumes play (${after.state})`);
  t.assert(after.hp > 0, `hearts are restored (${after.hp})`);
  await t.shotCanvas('continued');
  t.assert((await state(t)) !== 'gameOver', 'the game over screen is gone');
}
