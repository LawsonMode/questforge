# Questforge — Architecture & Build Contract

Questforge is a browser-based **16-bit top-down action-adventure maker and player** in the spirit of
*A Link to the Past*: a full game engine (sword, items, enemies, dungeons, puzzles, bosses) plus a
builder (map/screen editor, entity & puzzle placement, pixel-art editor, dialogue & trigger editors).
Everything — art, music, names, story — is **original**. Never copy Nintendo assets, melodies,
sprite pixels or trademarks (no "Zelda", "Link", "Hyrule", "Triforce", "Ganon", Master Sword…).

## Stack & commands
- TypeScript 7 (strict) + Vite 8, Canvas 2D, WebAudio. No runtime dependencies. Vitest 5 for unit tests.
- `npm run dev` — dev server · `npm run build` — typecheck + production build to `dist/` (relative base, GitHub-Pages ready)
- `npx tsc --noEmit` — typecheck · `npx vitest run [file]` — unit tests
- `node scripts/e2e.mjs <scenario…>` — headless Chrome e2e (see header of `scripts/e2e.mjs`); screenshots land in
  `e2e-out/<scenario>/NN-label.png` and can be viewed with an image viewer / the Read tool. `--all` runs everything.

## Geometry, time & units (non-negotiable)
- Screen **256×224**, tiles **16×16**, one "screen" = **16×14 tiles**. Rooms are `gw×gh` screens (1..4 each).
- Positions are **room-local pixels**; an entity's `(x, y)` is the **centre of its hitbox footprint**. `z` = height above ground.
- Fixed **60 Hz** simulation. `update(dt)` always gets `dt = 1/60` **seconds**. All durations in seconds, speeds in px/second.
- Health in **half-hearts** (`hp`, `maxHp`); damage values to the player are half-hearts.
- Layers: `bg` (ground) → `fg` (objects on the ground; a non-zero fg tile's collision overrides bg) → sprites → `over` (drawn above sprites, no collision).
- bg tile id 0 = void (black, solid). Tile ids are numbers; default tiles use the fixed ids in `src/content/ids.ts`; user tiles start at 1000.

## Contract files (FROZEN — do not edit; request changes in your final report)
| File | What it defines |
|---|---|
| `src/core/types.ts` | The entire JSON data model (Project, Room, TileDef, SpriteDef, Trigger, Dialogue, SaveData…) |
| `src/core/catalog.ts` | Every entity type, editor metadata, **prop schemas** (keys/defaults/options) |
| `src/content/ids.ts` | Tile ids+semantics (`TILE_SPECS`, `T`), sprite ids+required anims (`SPRITE_SPECS`), items (`ITEM_INFO`), palette swaps, drops |
| `src/game/api.ts` | Engine service interfaces: Renderer, InputState, AudioApi, GameServices, RoomRuntime, PlayerApi, Hit, GameEvent |
| `src/game/entity.ts` | Entity base class (movement w/ corner sliding, knockback, i-frames, anim, draw, hurt/die) |
| `src/game/registry.ts` | `registerEntity(type, factory)` / `createEntity` |
| `src/editor/context.ts` | EditorContext + events + Panel |
| `src/editor/ui/dom.ts`, `ui.css`, `src/editor/undo.ts` | Shared UI toolkit, theme tokens, undo stack |
| `src/content/art/{pixelgrid,build,placeholder,index}.ts` | Pixel authoring helper, spec→def builders, placeholder art, asset assembly |
| `src/core/constants.ts`, `math.ts`, `rng.ts`, `events.ts`, `stub.ts` | Shared primitives |
| `scripts/e2e.mjs`, `tests/contract.test.ts`, `tests/tools/*` | Test harness, contract tests, node PNG sheet renderer |
| `src/dev/arena.ts` | e2e helper: `startArena(opts)` builds & runs a one-room project in the page |

During the build, stub functions threw `NOT_IMPLEMENTED: …` until their owner implemented them. At 1.0.0 every contract
function is implemented: `notImplemented()` stays defined in `src/core/stub.ts` as the marker and **nothing calls it**
(`grep -r "notImplemented(" src` finds only its definition). **Keep every exported signature exactly**; you may add
exports, private helpers, and new files inside the areas you own.

### Contract changes since the first freeze (all additive unless noted)
- `types.ts`: `World.prizeName?` — a dungeon's prize name (e.g. "Sun Crystal"; default "<world name> Crystal"), used
  by the item-get message ("You got the Sun Crystal!"), the pause map and the editor's world panel.
- `ids.ts`: `ITEM_INFO` display names are Questforge's own — Grapple Claw (id `hookshot`), Stone Gauntlet (`glove`),
  Gems (`rupees`), Heart Vessel (`heartContainer`), Heart Shard (`heartPiece`), Dash Boots, Magic Jar. **Internal ids
  never change** (they are baked into saved projects); every visible string uses the display names
  (`tests/release-naming.test.ts` guards this).
- `api.ts`: `AudioApi` has `currentMusic`, `setVolumes` and `setMuted`; the player's sound preferences are applied through them.
- Removed at release (provably unused): `math.centered`, `math.rectUnion`, `dom.colorInput` (colours must go through the
  palette sanitiser), `registry.registeredTypes`, `constants.APP_NAME`, `build.ACTOR_SPRITE_TAGS`.

## Module ownership
| Area | Files (owner may add new files under these paths) | Agent |
|---|---|---|
| Graphics | `src/gfx/**` (palette, pixels, imageCache, renderer, font, gallery) | gfx |
| Input & audio | `src/input/**`, `src/audio/**` (synth, SFX, **original** chiptune tracks for every MusicId) | io |
| Data | `src/core/project.ts`, `validate.ts`, `autotile.ts`, `storage.ts`, `src/game/state.ts` | data |
| Engine | `src/game/game.ts`, `session.ts` (GameServices), `render.ts`, `world.ts`, `camera.ts`, `transitions.ts`, `effects.ts`, `loot.ts`, `spot.ts`, `src/game/player/**` (wave A: locomotion), `src/content/testProject.ts` | engine |
| Tile art | `src/content/art/tiles.ts` (+ `tiles-*.ts`) | tile-art |
| Core sprite art | `src/content/art/sprites-core.ts` (+ `core-*.ts`) | core-art |
| Actor sprite art | `src/content/art/sprites-actors.ts` (+ `actors-*.ts`) | actor-art |
| Player & items (wave B) | `src/game/player/**`, `src/game/projectiles/**`, `src/game/entities/objects/liftable.ts` | player |
| Enemies (wave B) | `src/game/entities/enemies/**` | enemies |
| Bosses (wave B) | `src/game/entities/bosses/**` | bosses |
| Objects & NPCs (wave B) | `src/game/entities/objects/**` (except liftable.ts), `src/game/entities/npcs/**` | objects |
| Triggers & game UI (wave B) | `src/game/triggers.ts`, `src/game/ui/**` | gameui |
| Editor shell (wave B) | `src/editor/editor.ts`, `src/editor/project/**`, `src/app/**`, `src/main.ts` | shell |
| Map editor (wave B) | `src/editor/map/**` | map |
| Entity/trigger/dialogue editors (wave B) | `src/editor/entities/**`, `src/editor/dialogue/**` | entities-ed |
| Art editor (wave B) | `src/editor/art/**` | art-ed |
| Sample adventure (wave B) | `src/content/sample/**` | sample |

Tests: put unit tests in `tests/<area>-*.test.ts`, e2e scenarios in `e2e/<area>-*.mjs`. Only edit files you own.

## Engine contract (see `src/game/entity.ts` header and `src/game/api.ts`)
- Per tick: input.update → (dialogue | pause | transition | gameplay). Gameplay: every entity `tickCommon(dt)` then
  `update(dt)` (skipped while `stun > 0` unless `ignoresStun`) → contact damage (team `enemy`, `contactDamage > 0`,
  overlapping the player, `z < 8`, not stunned) → `onPlayerTouch()` → triggers.update → remove `dead` entities → camera.
- Draw: bg → fg → `ground` entities → `normal` entities sorted by `y + sortBias` → `over` layer → `above` entities →
  darkness (dark rooms; lights = player lantern radius if owned & equipped-or-owned, lit torches, `light > 0` entities) → HUD → dialogue → menus → transition overlay.
- Room entry spawns placed instances via `createEntity`, skipping: `hidden: true` unless flag `shown:<id>`;
  flag `hidden:<id>`; `persistDefeat` types with flag `defeated:<id>` (a defeated boss's heart container `<id>-heart`
  comes back in its place until flag `pickup:<id>-heart`); collected pickups/opened chests handle their own flags.
- Dialogue boxes go to the side of the screen (top or bottom) that hides neither the hero nor the speaker the hero faces; a flagged choice sets its flag
  (option 0 = true) when picked. The pause menu can't open while a trigger sequence runs (a save never splits one).
- Edge transitions: walking off a room edge finds `neighborRoom(world, room, dir, along)`; ALttP-style **scroll** (~0.6 s)
  keeping the player's position along the edge. No neighbour = the edge is a wall. Warps/stairs use a **fade** (~0.5 s total).
- The player respawns (death/continue, pit without `pitTarget`) at the last **room entry point** in the current room,
  or `save.respawn` after death. Pit fall = 1 heart (2 half-hearts) damage.
- Persistent world state uses flags (conventions listed on `SaveData` in types.ts).
- Defence in depth against hand-edited / imported data: `ActiveRoom` layer maps have a null prototype and ignore unknown
  layer names, fractional cells and non-integer tile ids; trigger `setTile` actions with a bad layer / cell / tile are
  skipped with one warning; heals and hits with non-finite amounts change nothing.

## Persistence
- Projects and save games (3 slots per project) live in IndexedDB (`questforge` database), with an in-memory fallback
  when IndexedDB is blocked. Imports go through `migrateProject` (sanitise, clamp — e.g. room grid positions to ±256
  screens, floors to ±99, colours to `#rrggbb`) and `validateProject` (errors / warnings, including warps and the
  start location landing on void, solid, deep-water or pit ground).
- Per-browser settings use `getSetting` / `setSetting` (localStorage, key prefix `questforge:`). `sound` holds
  `{ music, sfx, muted }`: the pause menu's SOUND panel sets the levels, the menu hub and editor playtest bar toggles set
  `muted` (`src/game/soundPrefs.ts`, `src/app/soundToggle.ts`).

## Feel targets (ALttP-like tuning)
- Hero walk **88 px/s** (diagonal normalised ×0.75 per axis ≈ ALttP), dash **180 px/s** after a 0.35 s wind-up.
- Sword swing **0.26 s** (3 anim frames, arc hitbox sweeping 90–180° in front, reach ~20 px); hold ≥ **0.8 s** → spin attack (360°, 2× damage).
- Player i-frames **1.0 s** (flicker), knockback **16 px over 0.15 s**. Enemy i-frames 0.3 s.
- Ledge hop: 0.35 s arc, lands ≥ 1 tile past the ledge. Lift 0.2 s, throw arc ~4 tiles, breaks on impact.
- Room scroll transition 0.6 s; entities frozen during transitions, enemies respawn on re-entry.
- Low-health beep when hp ≤ 2 half-hearts (not every frame; ~every 0.8 s).

## Controls
Arrows/WASD move · **Z** sword · **X** action (talk / read / lift / throw / dash / open) · **C** use item ·
**Enter** pause & inventory · **Shift/M** map · **Q/E** flip pause pages · Escape leaves playtest. Alternates: J/K/L for
Z/X/C, Space = action. Gamepad: standard mapping. Editor: F5 playtest (Shift+F5 from the selected room), Ctrl+S, Ctrl+Z/Y,
1–4 tabs, ? help.

## Routes (e2e + menu)
`#/` menu · `#/play/<id|sample>` · `#/playtest/<id|sample>?w=&r=&x=&y=` · `#/edit/<id|sample>` · `#/gallery`.
`window.__qf` exposes `{ route, game, editor, ready, error }`; `Game.services` exposes GameServices for tests.

## Legal / originality checklist
Original pixel art (don't trace ALttP sprites), original melodies (no Zelda themes, no "secret found" jingle copy),
original names (hero = "the Hero"; world = "Ellendor"; sample story "The Hollow Crown").
