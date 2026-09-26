// Dev/test helper: build a one-room "arena" project and run it in the page.
// Used by e2e scenarios to exercise single behaviours in isolation:
//
//   await t.goto('#/');
//   await t.eval(async (cfg) => (await import('/src/dev/arena.ts')).startArena(cfg), {
//     theme: 'dungeon', items: { sword: 1, bow: 1, arrows: 20 },
//     entities: [{ type: 'enemy.soldier', x: 200, y: 112, props: { variant: 'blue' } }],
//   });
//   await t.wait(500); ... window.__qf.game.services ...
//
// Coordinates are room-local px (entity centres). Tile refs may be numeric ids or keys ('GRASS').
import '../game/entities/index';
import type {
  Dialogue, Dir, EntityInstance, ItemId, LayerName, Project, PropValue, Room, Trigger, World, WorldKind,
} from '../core/types';
import { PROJECT_FORMAT, PROJECT_VERSION, SCREEN_COLS, SCREEN_ROWS, TILE } from '../core/constants';
import { defaultProps } from '../core/catalog';
import { T } from '../content/ids';
import { createDefaultAssets } from '../content/art';
import { Game } from '../game/game';

export interface ArenaEntity {
  type: string;
  x: number;
  y: number;
  id?: string;
  props?: Record<string, PropValue>;
}

export interface ArenaOptions {
  /** Floor & wall style. Default 'grass' (open field, no walls). */
  theme?: 'grass' | 'dungeon' | 'interior';
  /** Room size in screens (default 1x1). */
  gw?: number;
  gh?: number;
  /** Surround with walls (default true for dungeon/interior, false for grass). */
  walls?: boolean;
  entities?: ArenaEntity[];
  /** Extra tiles to paint. */
  tiles?: { layer?: LayerName; tx: number; ty: number; tile: number | string; w?: number; h?: number }[];
  /** Starting items (merged over sword+shield unless noDefaults). */
  items?: Partial<Record<ItemId, number>>;
  noDefaultItems?: boolean;
  hearts?: number;
  player?: { x: number; y: number; dir?: Dir };
  dark?: boolean;
  worldKind?: WorldKind;
  dialogues?: Dialogue[];
  triggers?: Trigger[];
  flags?: string[];
}

function tileId(t: number | string): number {
  if (typeof t === 'number') return t;
  const id = T[t];
  if (id === undefined) throw new Error(`arena: unknown tile key ${t}`);
  return id;
}

/** Build the arena project (pure; no DOM). */
export function buildArenaProject(opts: ArenaOptions = {}): Project {
  const theme = opts.theme ?? 'grass';
  const gw = opts.gw ?? 1;
  const gh = opts.gh ?? 1;
  const cols = gw * SCREEN_COLS;
  const rows = gh * SCREEN_ROWS;
  const floor = theme === 'grass' ? T.GRASS! : theme === 'dungeon' ? T.DFLOOR! : T.WOOD_FLOOR!;
  const bg = new Array<number>(cols * rows).fill(floor);
  const fg = new Array<number>(cols * rows).fill(0);
  const over = new Array<number>(cols * rows).fill(0);
  const walls = opts.walls ?? theme !== 'grass';
  if (walls) {
    const W = theme === 'interior'
      ? { top: T.IWALL_TOP!, bottom: T.IWALL_BOTTOM!, left: T.IWALL_LEFT!, right: T.IWALL_RIGHT!, tl: T.IWALL_TL!, tr: T.IWALL_TR!, bl: T.IWALL_BL!, br: T.IWALL_BR! }
      : theme === 'dungeon'
        ? { top: T.DWALL_TOP!, bottom: T.DWALL_BOTTOM!, left: T.DWALL_LEFT!, right: T.DWALL_RIGHT!, tl: T.DWALL_TL!, tr: T.DWALL_TR!, bl: T.DWALL_BL!, br: T.DWALL_BR! }
        : { top: T.TREE_SMALL!, bottom: T.TREE_SMALL!, left: T.TREE_SMALL!, right: T.TREE_SMALL!, tl: T.TREE_SMALL!, tr: T.TREE_SMALL!, bl: T.TREE_SMALL!, br: T.TREE_SMALL! };
    for (let x = 0; x < cols; x++) {
      fg[x] = W.top;
      fg[(rows - 1) * cols + x] = W.bottom;
    }
    for (let y = 0; y < rows; y++) {
      fg[y * cols] = W.left;
      fg[y * cols + cols - 1] = W.right;
    }
    fg[0] = W.tl;
    fg[cols - 1] = W.tr;
    fg[(rows - 1) * cols] = W.bl;
    fg[rows * cols - 1] = W.br;
  }
  const layers: Record<LayerName, number[]> = { bg, fg, over };
  for (const t of opts.tiles ?? []) {
    const layer = t.layer ?? 'fg';
    for (let dy = 0; dy < (t.h ?? 1); dy++) {
      for (let dx = 0; dx < (t.w ?? 1); dx++) {
        const x = t.tx + dx;
        const y = t.ty + dy;
        if (x >= 0 && y >= 0 && x < cols && y < rows) layers[layer][y * cols + x] = tileId(t.tile);
      }
    }
  }
  const entities: EntityInstance[] = (opts.entities ?? []).map((e, i) => ({
    id: e.id ?? `arena_e${i}`,
    type: e.type,
    x: e.x,
    y: e.y,
    props: { ...defaultProps(e.type), ...(e.props ?? {}) },
  }));
  const room: Room = {
    id: 'arena_room', name: 'Arena', gx: 0, gy: 0, gw, gh, floor: 0, layers, entities,
    triggers: opts.triggers ?? [], music: 'none', dark: opts.dark ?? false,
  };
  const world: World = { id: 'arena', name: 'Arena', kind: opts.worldKind ?? (theme === 'dungeon' ? 'dungeon' : 'overworld'), music: 'none', rooms: [room] };
  const assets = createDefaultAssets();
  const now = Date.now();
  const startItems: Partial<Record<ItemId, number>> = opts.noDefaultItems ? { ...(opts.items ?? {}) } : { sword: 1, shield: 1, ...(opts.items ?? {}) };
  const px = opts.player ?? { x: (cols * TILE) / 2, y: (rows * TILE) / 2 + 24, dir: 'up' as Dir };
  return {
    format: PROJECT_FORMAT, version: PROJECT_VERSION, id: 'arena', name: 'Arena', author: 'dev', description: '',
    created: now, modified: now,
    settings: { title: 'Arena', subtitle: '', startHearts: opts.hearts ?? 6, startItems, titleMusic: 'title' },
    palettes: assets.palettes, tiles: assets.tiles, terrains: assets.terrains, sprites: assets.sprites,
    worlds: [world], dialogues: opts.dialogues ?? [], flags: (opts.flags ?? []).map((name) => ({ name })),
    start: { world: 'arena', room: 'arena_room', x: px.x, y: px.y, dir: px.dir ?? 'up' },
  };
}

/** Replace whatever is mounted with a playtest Game running the arena. */
export function startArena(opts: ArenaOptions = {}): { ok: true } {
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
  const project = buildArenaProject(opts);
  const game = new Game(canvas, project, { mode: 'playtest' });
  if (window.__qf) {
    window.__qf.game = game;
    window.__qf.ready = true;
  }
  game.start();
  canvas.focus();
  return { ok: true };
}
