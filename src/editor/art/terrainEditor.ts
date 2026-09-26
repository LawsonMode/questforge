// Terrain editor: the 13 autotile slots of a terrain brush as tile pickers laid
// out where each piece sits, plus a live demo blob (with a notch and spurs, so
// every edge, outer and inner corner shows) painted with the AssetCache.
import type { LayerName, Terrain } from '../../core/types';
import type { EditorContext } from '../context';
import { LAYERS } from '../../core/types';
import { TILE } from '../../core/constants';
import { NB, resolveTerrainTile } from '../../core/autotile';
import { T } from '../../content/ids';
import type { TerrainPiece } from '../../gfx/artCheck';
import { button, el, select } from '../ui/dom';
import type { ArtActions } from './model';
import { fk, nameField, propRow, section, tilePicker } from './widgets';

const DEMO_COLS = 12;
const DEMO_ROWS = 9;
const DEMO_SCALE = 2;

/** Slot grid: [piece, label, column, row] (outer ring on the left, inner corners on the right). */
const SLOTS: readonly [TerrainPiece, string, number, number][] = [
  ['nw', 'NW corner', 1, 1], ['n', 'N edge', 2, 1], ['ne', 'NE corner', 3, 1],
  ['w', 'W edge', 1, 2], ['center', 'Centre', 2, 2], ['e', 'E edge', 3, 2],
  ['sw', 'SW corner', 1, 3], ['s', 'S edge', 2, 3], ['se', 'SE corner', 3, 3],
  ['inw', 'Inner NW', 5, 1], ['ine', 'Inner NE', 6, 1],
  ['isw', 'Inner SW', 5, 2], ['ise', 'Inner SE', 6, 2],
];

/** Demo shape: a block with a notch (inner NE) plus spurs on top (inner NW) and bottom (inner SW / SE). */
function inBlob(x: number, y: number): boolean {
  const block = x >= 2 && x <= 9 && y >= 2 && y <= 6 && !(x >= 7 && y <= 3);
  return block || (x >= 3 && x <= 4 && y === 1) || (x >= 4 && x <= 5 && y === 7);
}

const NEIGHBOURS: readonly [number, number, number][] = [
  [0, -1, NB.N], [1, -1, NB.NE], [1, 0, NB.E], [1, 1, NB.SE], [0, 1, NB.S], [-1, 1, NB.SW], [-1, 0, NB.W], [-1, -1, NB.NW],
];

/** Tile ids of the demo scene: the terrain piece per blob cell (0 outside). */
export function demoPieces(terrain: Terrain): number[] {
  const out: number[] = [];
  for (let y = 0; y < DEMO_ROWS; y++) {
    for (let x = 0; x < DEMO_COLS; x++) {
      if (!inBlob(x, y)) {
        out.push(0);
        continue;
      }
      let mask = 0;
      for (const [dx, dy, bit] of NEIGHBOURS) if (inBlob(x + dx, y + dy)) mask |= bit;
      out.push(resolveTerrainTile(terrain, mask));
    }
  }
  return out;
}

export interface TerrainHost {
  readonly ctx: EditorContext;
  readonly actions: ArtActions;
}

/** Centre view for the Terrains sub-tab. */
export class TerrainView {
  readonly element: HTMLDivElement;
  private readonly slots = el('div', { class: 'qf-art-tslots' });
  private readonly demo: HTMLCanvasElement;
  private readonly body = el('div', { class: 'qf-art-tv__body' });
  private readonly empty = el('div', { class: 'qf-empty' }, 'Select a terrain on the left, or add one.');
  private terrainId: string | null = null;
  /** Ground under the demo blob (view state only). */
  private ground: number;
  private groundPicker: ReturnType<typeof tilePicker>;
  private pickers: { picker: ReturnType<typeof tilePicker>; piece: TerrainPiece }[] = [];

  constructor(private readonly host: TerrainHost) {
    this.ground = T.GRASS ?? 0;
    this.demo = el('canvas', { class: 'qf-canvas qf-art-tv__demo' });
    this.demo.width = DEMO_COLS * TILE;
    this.demo.height = DEMO_ROWS * TILE;
    this.demo.style.width = `${DEMO_COLS * TILE * DEMO_SCALE}px`;
    this.demo.style.height = `${DEMO_ROWS * TILE * DEMO_SCALE}px`;
    this.groundPicker = tilePicker(host.ctx, {
      value: this.ground, title: 'Tile drawn around the demo blob',
      onChange: (id) => { this.ground = id; this.draw(0); },
    });
    this.body.append(
      section('Pieces', el('p', { class: 'qf-art-help' },
        'Each painted cell picks a piece from its neighbours: edges where one side leaves the terrain, outer corners where two do, inner corners where only a diagonal does.'),
      this.slots),
      section({ title: 'Live demo', extra: el('span', { class: 'qf-row qf-art-nowrap qf-small' }, 'Around:', this.groundPicker) }, this.demo));
    this.element = el('div', { class: 'qf-art-tv' }, this.body, this.empty);
  }

  private terrain(): Terrain | undefined {
    return this.host.ctx.project.terrains.find((t) => t.id === this.terrainId);
  }

  /** Show a terrain (null = none). */
  render(id: string | null): void {
    if (id !== this.terrainId) {
      this.terrainId = id;
      const tr = this.terrain();
      if (tr) this.ground = this.guessGround(tr);
      this.groundPicker.setValue(this.ground);
    }
    const tr = this.terrain();
    this.body.hidden = !tr;
    this.empty.hidden = !!tr;
    if (!tr) return;
    this.pickers = [];
    this.slots.replaceChildren(...SLOTS.map(([piece, label, col, row]) => {
      const picker = tilePicker(this.host.ctx, {
        value: tr[piece], title: `${label} piece`,
        onChange: (v) => this.host.actions.edit('terrain', tr.id, `Terrain ${tr.name}: ${label}`, (d) => { d[piece] = v; }),
      });
      fk(picker, `slot-${piece}`);
      this.pickers.push({ picker, piece });
      return el('div', { class: 'qf-art-tslot', style: { gridColumn: String(col), gridRow: String(row) }, dataset: { piece } },
        el('span', { class: 'qf-art-tslot__label' }, label), picker);
    }));
    this.draw(0);
  }

  /** Tile pixels changed: redraw pickers and the demo. */
  visuals(): void {
    const tr = this.terrain();
    if (!tr) return;
    for (const { picker, piece } of this.pickers) picker.setValue(tr[piece]);
    this.groundPicker.setValue(this.ground);
    this.draw(0);
  }

  /** Animated demo (water ripples, ...). */
  tick(t: number): void {
    if (this.terrain()) this.draw(t);
  }

  private draw(t: number): void {
    const tr = this.terrain();
    const g = this.demo.getContext('2d');
    if (!tr || !g) return;
    const assets = this.host.ctx.assets;
    g.imageSmoothingEnabled = false;
    g.fillStyle = '#000';
    g.fillRect(0, 0, this.demo.width, this.demo.height);
    const pieces = demoPieces(tr);
    pieces.forEach((id, i) => {
      const x = (i % DEMO_COLS) * TILE;
      const y = Math.floor(i / DEMO_COLS) * TILE;
      if (id === 0 || tr.layer !== 'bg') assets.drawTileTo(g, this.ground, x, y, 1, t);
      if (id !== 0) assets.drawTileTo(g, id, x, y, 1, t);
    });
  }

  /** Ground of the same family as the centre piece (dungeon floor for dungeon terrains, ...). */
  private guessGround(tr: Terrain): number {
    const centre = this.host.ctx.assets.tileDef(tr.center);
    const tiles = this.host.ctx.project.tiles;
    const family = centre?.tags.find((tag) => ['dungeon', 'interior', 'cave'].includes(tag));
    const ground = family ? tiles.find((x) => x.tags.includes('ground') && x.tags.includes(family)) : undefined;
    return ground?.id ?? T.GRASS ?? tiles[0]?.id ?? 0;
  }
}

/** Right column for a terrain: name, id, layer, map-brush shortcut. */
export function terrainProps(host: TerrainHost, tr: Terrain): HTMLDivElement[] {
  const { ctx, actions } = host;
  const edit = (label: string, fn: (d: Terrain) => void): void => actions.edit('terrain', tr.id, `${label} (terrain ${tr.name})`, fn);
  return [
    section('Terrain',
      propRow('Name', nameField(() => ctx.project.terrains.find((t) => t.id === tr.id)?.name ?? tr.name, (v) => edit('Rename', (d) => { d.name = v; }))),
      propRow('Id', el('code', { class: 'qf-art-code' }, tr.id)),
      propRow('Layer', fk(select<LayerName>(LAYERS, tr.layer, (v) => edit('Layer', (d) => { d.layer = v; }), { title: 'Room layer the brush paints on' }), 'layer')),
      el('div', { class: 'qf-row' }, button('Use as map brush', () => {
        ctx.selectTerrain(tr.id);
        ctx.toast(`Map terrain brush: ${tr.name}`, 'success');
      }, { small: true, title: 'Paint this terrain on the Map tab' }))),
    section('Tips', el('p', { class: 'qf-muted qf-small' },
      'Keep painted areas at least 2 tiles wide: a 13-piece set cannot border both sides of a 1-tile strip.')),
  ];
}
