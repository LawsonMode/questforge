// Smoke test: every top-level route mounts without errors and renders something.
export default async function (t) {
  await t.goto('#/');
  await t.shot('menu');

  await t.goto('#/gallery');
  await t.shot('gallery');

  await t.goto('#/playtest/sample');
  await t.wait(800);
  await t.shotCanvas('playtest-start');
  await t.hold('ArrowRight', 400);
  await t.hold('ArrowDown', 400);
  await t.shotCanvas('playtest-moved');
  const alive = await t.eval(() => !!window.__qf.game);
  t.assert(alive, 'game instance exists on #/playtest/sample');

  await t.goto('#/play/sample');
  await t.wait(600);
  await t.shotCanvas('title');

  await t.goto('#/edit/sample');
  await t.wait(600);
  await t.shot('editor');
}
