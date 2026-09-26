// Release checks: the menu footer shows the package version; the sound toggle
// of the menu hub and of the editor's playtest bar share one stored setting
// with the in-game audio (mute survives a reload and reaches the running game);
// a game that fails to start leaves the error screen visible (no game host
// covering it).

const readToggle = (sel) => {
  const b = document.querySelector(sel);
  return b ? { text: b.textContent.trim(), muted: b.classList.contains('is-muted') } : null;
};
const stored = () => JSON.parse(localStorage.getItem('questforge:sound') ?? 'null');

export default async function (t) {
  const { page } = t;
  t.allowConsole(/release-check: start failed on purpose/);

  // ---- menu hub (each scenario runs in a fresh browser context: nothing stored yet): version footer + sound toggle
  await t.goto('#/');
  const version = await t.eval(() => document.querySelector('.qf-menu-footer')?.textContent ?? '');
  t.assert(/Questforge v1\.0\.0/.test(version), `the footer shows v1.0.0 (${version})`);
  let menuToggle = await t.eval(readToggle, '.qf-menu-sound');
  t.assert(menuToggle && menuToggle.text === 'Sound on' && !menuToggle.muted, `menu toggle starts on (${JSON.stringify(menuToggle)})`);
  await page.click('.qf-menu-sound');
  menuToggle = await t.eval(readToggle, '.qf-menu-sound');
  t.assert(menuToggle.text === 'Sound off' && menuToggle.muted, `menu toggle mutes (${JSON.stringify(menuToggle)})`);
  const afterMenu = await t.eval(stored);
  t.assert(afterMenu && afterMenu.muted === true && afterMenu.music === 4 && afterMenu.sfx === 4, `mute stored in the shared setting (${JSON.stringify(afterMenu)})`);
  await t.shot('menu-sound-off');
  await page.reload();
  await t.until(() => window.__qf.ready, null, 8000);
  menuToggle = await t.eval(readToggle, '.qf-menu-sound');
  t.assert(menuToggle.muted, 'the mute survives a reload');

  // ---- the game picks the stored mute up
  await t.goto('#/play/sample');
  await t.until(() => window.__qf.game, null, 8000);
  // The title screen already runs on the shared audio (Game.audio === getAudio()).
  const gameMuted = await t.eval(() => window.__qf.game.audio.muted);
  t.assert(gameMuted === true, `a started game is muted (${gameMuted})`);

  // ---- editor playtest bar: same state, and toggling reaches the running game
  await t.goto('#/edit/sample');
  await page.keyboard.press('F5');
  await t.until(() => !!document.querySelector('.qf-playtest') && !!window.__qf.game?.services, null, 8000);
  await t.wait(300);
  let barToggle = await t.eval(readToggle, '.qf-playtest__sound');
  t.assert(barToggle && barToggle.muted && barToggle.text === 'Sound off', `playtest toggle shows the stored mute (${JSON.stringify(barToggle)})`);
  await page.click('.qf-playtest__sound');
  await t.until(() => window.__qf.game?.services?.audio?.muted === false, null, 3000);
  barToggle = await t.eval(readToggle, '.qf-playtest__sound');
  const afterBar = await t.eval(stored);
  const focus = await t.eval(() => document.activeElement?.classList.contains('qf-game-canvas') ?? false);
  t.assert(!barToggle.muted && barToggle.text === 'Sound on', `playtest toggle turns sound on (${JSON.stringify(barToggle)})`);
  t.assert(afterBar && afterBar.muted === false, `stored as on (${JSON.stringify(afterBar)})`);
  t.assert(focus, 'the game canvas gets the keyboard back after the click');
  await t.shot('playtest-bar-sound');
  await page.keyboard.press('Escape');
  await t.until(() => !document.querySelector('.qf-playtest'), null, 5000);

  // ---- a game whose start throws: the error screen is shown, not covered by the game host
  await t.goto('#/play/sample');
  await t.until(() => window.__qf.game, null, 8000);
  await t.eval(() => {
    const proto = Object.getPrototypeOf(window.__qf.game);
    window.__releaseGame = { proto, start: proto.start };
    proto.start = function () { throw new Error('release-check: start failed on purpose'); };
  });
  await t.goto('#/');
  await t.eval(() => { location.hash = '#/play/sample'; });
  await t.until(() => !!document.querySelector('.qf-app-error'), null, 8000);
  const failed = await t.eval(() => ({
    error: document.querySelector('.qf-app-error')?.textContent ?? '',
    host: !!document.querySelector('.qf-game-host'),
    game: window.__qf.game,
    visible: (() => {
      const r = document.querySelector('.qf-app-error')?.getBoundingClientRect();
      if (!r) return false;
      const top = document.elementFromPoint(r.x + r.width / 2, r.y + Math.min(20, r.height / 2));
      return !!top?.closest('.qf-app-error');
    })(),
  }));
  t.assert(/start failed on purpose/.test(failed.error), 'the error screen names the failure');
  t.assert(!failed.host && failed.game === null, `no game host or half-started game is left (${JSON.stringify({ host: failed.host, game: failed.game })})`);
  t.assert(failed.visible, 'the error screen is on top');
  await t.shot('start-failure');
  await t.eval(() => {
    window.__releaseGame.proto.start = window.__releaseGame.start;
    location.hash = '#/';
  });
  await t.until(() => window.__qf.ready, null, 8000);
  await t.goto('#/play/sample');
  t.assert(await t.eval(() => !!window.__qf.game && !document.querySelector('.qf-app-error')), 'games start again once start is restored');
  await t.eval(() => localStorage.removeItem('questforge:sound'));
}
