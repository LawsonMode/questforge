// Main menu: banner + sample card, new project dialog, import / export round
// trip through the real file input and download, duplicate, delete, 404 pages.
import { readFileSync } from 'node:fs';

const cardSel = (id) => `.qf-menu-card[data-project-id="${id}"]`;
const cardByName = (name) => `.qf-menu-card:has(.qf-menu-card__name:text-is("${name}"))`;

export default async function (t) {
  // Sibling tabs (map/art/dialogue) are developed separately; the shell shows their load
  // errors in place, so a broken sibling module must not fail the shell scenarios.
  t.allowConsole(/\[editor\] the (map|art|dialogue) tab failed to load/);
  t.allowConsole(/^Failed to load resource: the server responded with a status of 500/);
  const { page } = t;
  await t.goto('#/');
  await t.until(() => !document.querySelector('.qf-menu-card[data-project-id="sample"] .qf-menu-card__thumb--loading'), null, 8000);
  await t.wait(500);
  await t.shot('menu');

  const menu = await t.eval(() => ({
    sample: !!document.querySelector('.qf-menu-card[data-project-id="sample"]'),
    banner: (() => {
      const c = document.querySelector('.qf-menu-banner__canvas');
      return c ? { w: c.width, h: c.height, cssW: c.getBoundingClientRect().width } : null;
    })(),
    ctas: [...document.querySelectorAll('.qf-menu-cta__title')].map((n) => n.textContent),
    empty: !!document.querySelector('.qf-menu-empty'),
    footer: document.querySelector('.qf-menu-footer')?.textContent ?? '',
    keys: document.querySelectorAll('.qf-menu-keys dt').length,
  }));
  t.log('menu', menu);
  t.assert(menu.sample, 'the sample adventure has a card');
  t.assert(menu.banner && menu.banner.w > 100 && menu.banner.h === 136, 'the pixel banner canvas is sized');
  t.assert(menu.ctas.includes('Play the sample adventure') && menu.ctas.includes('Build your own'), 'both primary buttons exist');
  t.assert(menu.empty, 'an empty-state card invites creating a project');
  t.assert(/Questforge v\d+\.\d+\.\d+/.test(menu.footer), `footer shows the version (${menu.footer})`);
  t.assert(menu.keys >= 6, 'controls help lists the keys');

  // The banner animates: two frames differ.
  const frames = await t.eval(async () => {
    const c = document.querySelector('.qf-menu-banner__canvas');
    const grab = () => c.getContext('2d').getImageData(0, 90, c.width, 46).data.join(',').length;
    const a = c.toDataURL();
    await new Promise((r) => setTimeout(r, 400));
    return { moved: a !== c.toDataURL(), size: grab() > 0 };
  });
  t.assert(frames.moved, 'the banner animates (hero walking)');

  // ---- new blank project from the dialog, then back to the menu
  await page.click('.qf-menu-new-btn');
  await t.until(() => !!document.querySelector('.qf-modal .qf-menu-new'));
  await t.shot('new-project-dialog');
  await page.fill('.qf-menu-new input[aria-label="Project name"]', 'Menu Test Quest');
  await page.click('.qf-modal__footer .qf-btn--primary');
  await t.until(() => window.__qf.route?.view === 'edit' && window.__qf.ready && !!window.__qf.editor);
  const created = await t.eval(() => window.__qf.route.id);
  t.log('created', created);
  await t.goto('#/');
  await t.until((id) => !!document.querySelector(`.qf-menu-card[data-project-id="${id}"]`), created);
  await t.until(() => !document.querySelector('.qf-menu-card__thumb--loading'), null, 8000);
  const card = await t.eval((id) => {
    const c = document.querySelector(`.qf-menu-card[data-project-id="${id}"]`);
    return { name: c?.querySelector('.qf-menu-card__name')?.textContent, meta: c?.querySelector('.qf-menu-card__meta')?.textContent };
  }, created);
  t.assert(card.name === 'Menu Test Quest', `the new project has a card (${card.name})`);
  t.assert(/1 room/.test(card.meta ?? ''), `card shows the room count (${card.meta})`);

  // ---- export through the real download, then import that file back
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 8000 }),
    page.click(`${cardSel(created)} .qf-menu-card__export`),
  ]);
  const fileName = download.suggestedFilename();
  t.assert(fileName === 'Menu Test Quest.questforge.json', `export downloads a .questforge.json (${fileName})`);
  const json = readFileSync(await download.path(), 'utf8');
  t.assert(JSON.parse(json).name === 'Menu Test Quest', 'exported file contains the project');

  const renamed = json.replace('"name": "Menu Test Quest"', '"name": "Imported Quest"').replace('"name":"Menu Test Quest"', '"name":"Imported Quest"');
  await page.setInputFiles('.qf-menu-projects input[type="file"]', { name: 'imported.questforge.json', mimeType: 'application/json', buffer: Buffer.from(renamed) });
  await t.until(() => [...document.querySelectorAll('.qf-menu-card__name')].some((n) => n.textContent === 'Imported Quest'), null, 8000);
  const importedId = await t.eval(() => [...document.querySelectorAll('.qf-menu-card')]
    .find((c) => c.querySelector('.qf-menu-card__name')?.textContent === 'Imported Quest')?.dataset.projectId);
  t.assert(importedId && importedId !== created, `import stores a copy under a fresh id (${importedId})`);

  // A broken file gives a readable error toast and no card.
  await page.setInputFiles('.qf-menu-projects input[type="file"]', { name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{"nope":1}') });
  await t.until(() => [...document.querySelectorAll('.qf-toast--error')].some((n) => /Couldn't import bad\.json/.test(n.textContent)));

  // ---- duplicate + delete
  await page.click(`${cardSel(created)} .qf-menu-card__duplicate`);
  await t.until(() => [...document.querySelectorAll('.qf-menu-card__name')].some((n) => n.textContent === 'Menu Test Quest (copy)'));
  await t.until(() => !document.querySelector('.qf-menu-card__thumb--loading'), null, 8000);
  await t.wait(300);
  await t.shot('menu-with-projects');

  await page.click(`${cardByName('Menu Test Quest (copy)')} .qf-menu-card__delete`);
  await t.until(() => !!document.querySelector('.qf-modal'));
  await t.shot('delete-confirm');
  await page.click('.qf-modal__footer .qf-btn--danger');
  await t.until(() => ![...document.querySelectorAll('.qf-menu-card__name')].some((n) => n.textContent === 'Menu Test Quest (copy)'));
  const stored = await t.eval(async () => (await (await import('/src/core/storage.ts')).listProjects()).map((m) => m.name).sort());
  t.assert(JSON.stringify(stored) === JSON.stringify(['Imported Quest', 'Menu Test Quest']), `storage matches the cards (${stored})`);

  // Keyboard: the primary buttons are reachable with Tab.
  const focusable = await t.eval(() => {
    document.body.focus();
    return [...document.querySelectorAll('.qf-menu button, .qf-menu a')].filter((n) => n.tabIndex >= 0 && !n.closest('[hidden]')).length;
  });
  t.assert(focusable > 8, `menu actions are keyboard focusable (${focusable})`);

  // ---- narrow (phone) layout
  await page.setViewportSize({ width: 390, height: 844 });
  await t.wait(400);
  const overflow = await t.eval(() => document.querySelector('.qf-menu').scrollWidth - document.querySelector('.qf-menu').clientWidth);
  t.assert(overflow <= 0, `no horizontal scroll at phone width (${overflow}px)`);
  await t.eval(() => { document.querySelector('.qf-menu').scrollTop = 0; });
  await t.wait(200);
  await t.shot('menu-phone');
  await page.setViewportSize({ width: 1024, height: 896 });

  // ---- 404 pages
  await t.goto('#/nowhere');
  const nf = await t.eval(() => ({ msg: document.querySelector('.qf-app-message h1')?.textContent, error: window.__qf.error }));
  t.assert(nf.msg === 'Page not found' && !nf.error, `unknown routes show a not-found page (${nf.msg})`);
  await t.shot('not-found');
  await t.goto('#/edit/p_missing');
  const pnf = await t.eval(() => document.querySelector('.qf-app-message h1')?.textContent);
  t.assert(pnf === 'Project not found', `missing projects show a friendly page (${pnf})`);
  await page.click('.qf-app-message .qf-btn--primary');
  await t.until(() => window.__qf.route?.view === 'menu' && window.__qf.ready);
}
