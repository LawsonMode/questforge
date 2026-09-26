# Claude Context — Zelda Clone / "Questforge" (v1.1.0)

Browser-based 16-bit top-down action-adventure **maker + player** in the spirit of *A Link to the Past*.
One app, two halves: the **game** (sword, items, 12 enemies, 2 bosses, dungeons, puzzles, SNES-style 256×224
pixel rendering, chiptune audio) and the **builder** (map & room editor, entity/puzzle placement, trigger and
dialogue editors, pixel-art editor, playtest). Ships the sample adventure "The Hollow Crown" (id `sample`).
Playable end to end with a gamepad (1.1.0): device-aware button labels and glyphs, rumble, Swap A/B, hub pad navigation.
TypeScript + Vite, Canvas 2D, WebAudio, no runtime dependencies; projects save to IndexedDB and export as
`.questforge.json`. Standalone (non-5bot). All art, music, names and story are original — never copy Nintendo
assets or trademarks (item display names are Questforge's own: Grapple Claw, Stone Gauntlet, Gems, Heart Vessel,
Heart Shard; internal ids stay `hookshot`, `glove`, `rupees`, ...).

## Version location
`package.json` → `version` (single canonical spot; the menu footer imports it and shows "Questforge v1.1.0").

## Files
- `README.md` — user-facing overview: features, controls, quick start, editor guide, file format, testing.
- `ARCHITECTURE.md` — **the build contract**: units, engine rules, module ownership, frozen contract files,
  contract changes since the freeze, persistence, feel targets, routes. Read first.
- `docs/screenshots/` — README screenshots (copied from `e2e-out/`).
- `src/main.ts` — hash router (`#/`, `#/play/<id>`, `#/playtest/<id>?w=&r=&x=&y=`, `#/edit/<id>`, `#/gallery`); `window.__qf`.
- `src/core/` — data model (`types.ts`), entity catalog (`catalog.ts`), project helpers, migrate/validate, autotile,
  storage (IndexedDB projects + saves, localStorage settings), shared primitives, `stub.ts` (unused marker).
- `src/content/` — default content catalog (`ids.ts`: tile/sprite/item ids + `ITEM_INFO`), procedural original art
  (`art/`), sample adventure (`sample/`), `testProject.ts`.
- `src/gfx/`, `src/input/`, `src/audio/` — renderer, bitmap font (incl. the PlayStation button glyphs), asset cache,
  gallery; input; chip synth, SFX & songs.
- `src/input/devices.ts` — **shared controller module**: device in use (keyboard / pad family), button labels & glyphs,
  `{btn:x}` token substitution, controller prefs (`controller` setting: vibration, swap A/B), rumble. Labels change with
  the device: build hint text at draw time (`src/game/keys.ts` `liveText`). Documented in ARCHITECTURE.md → Controllers.
- `src/game/` — engine (`game.ts`, `session.ts`, `world.ts`, `render.ts`, camera/transitions/effects), `entity.ts` base
  class, `player/`, `projectiles/`, `entities/` (enemies/bosses/objects/npcs), `triggers.ts`, `state.ts` (save rules,
  item messages, `DEFAULT_HERO_NAME`), `soundPrefs.ts` (the shared `sound` setting), in-game `ui/` (incl.
  `controlsPage.ts` — the pause menu's CONTROLS page — and `menuInput.ts` — menu auto-repeat, pad Start vs Enter).
- `src/editor/` — editor shell (`editor.ts`, `shell/` incl. `playtest.ts`), `map/`, `entities/` (entity + trigger
  editors), `dialogue/`, `art/`, `project/`; `ui/dom.ts` toolkit + `ui.css`; `undo.ts`, `context.ts`.
- `src/app/` — menu hub (`menu.ts`), project cards, new-project dialog, routes (`nav.ts`), `soundToggle.ts`,
  `padNav.ts` (DOM pad navigation for the menu, message pages and gallery), `padBanner.ts` (the hub's controller
  banner), `controls.ts` (device-aware control lists shared by the menu, editor help and playtest bar).
- `src/dev/arena.ts` — e2e helper: `startArena(opts)` builds & runs a one-room project in the page.
- `tests/` — Vitest unit tests (`<area>-*.test.ts`, `release-*.test.ts`); `tests/tools/` — node PNG renderer
  (`png.ts`) + opt-in asset sheets (`QF_SHEETS=1`).
- `e2e/` — headless-Chrome scenarios; `scripts/e2e.mjs` — the harness (API in its header). Screenshots and reports land
  in `e2e-out/<scenario>/` (gitignored).
- `e2e/lib/fakepad.mjs` — fake gamepads for e2e (`installFakePad` before `t.goto`, `padPress` / `padHold` / `padStick`,
  `window.__fakePad.disconnect()`, `window.__fakePadRumble`); `e2e/lib/` files are helpers, not scenarios.

## How to run
```
npm install
npm run dev                  # http://localhost:5173
npm run build                # typecheck + static build in dist/ (relative base)
npm run typecheck            # tsc for src and tests
npx vitest run               # unit tests
node scripts/e2e.mjs --all   # e2e (uses installed Chrome/Edge via playwright-core; QF_BROWSER overrides)
```

## Gotchas / constraints
- `tsconfig` sets `useDefineForClassFields: false` so Entity subclasses can re-declare fields with initialisers.
- Sim is fixed 60 Hz; `dt` is seconds. Positions are room-local px at the hitbox centre.
- Default tile ids in `src/content/ids.ts` are baked into saved projects — never renumber them; add new ones.
- Source files use CRLF line endings.
- `#/play/<id>` starts on the title screen (`game.services` is null until a file is chosen); `#/playtest/<id>` starts
  in gameplay.
- GitHub: **LawsonMode/questforge** (public). Every push to `main` runs `.github/workflows/deploy.yml` (vitest + build) and
  publishes to GitHub Pages: https://lawsonmode.github.io/questforge/ . Push only when Chad asks.
