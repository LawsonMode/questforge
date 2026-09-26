// Tile properties column: name / key / tags, collision (solid-mask quarters,
// ledge direction), cut / lift / bomb / dash behaviours with target tiles,
// animation timing with a live preview, and the palette section.
import type { Collision, Dir, TileDef } from '../../core/types';
import { COLLISIONS } from '../../core/types';
import { TILE } from '../../core/constants';
import { tileById } from '../../core/project';
import { T } from '../../content/ids';
import { DEFAULT_TILE_FRAME_TIME } from '../../gfx/imageCache';
import { button, el, select, textInput, type Child } from '../ui/dom';
import { icon } from './icons';
import type { ArtState } from './model';
import { PaletteEditor, paletteSection, type PaletteEditorHost } from './paletteEditor';
import { smallCanvas } from './raster';
import { isDefaultTile, tileUsage } from './usage';
import { checkField, chipEditor, fk, nameField, numField, propRow as row, rebuild, section, tilePicker } from './widgets';

export interface TilePropsHost extends PaletteEditorHost {
  readonly state: ArtState;
}

type Behaviour = 'cut' | 'lift' | 'bomb' | 'dash';

const BEHAVIOURS: readonly { key: Behaviour; label: string; help: string }[] = [
  { key: 'cut', label: 'Cut by the sword', help: 'Turns into the target tile when slashed.' },
  { key: 'lift', label: 'Liftable', help: 'The hero lifts it (action button) and the tile becomes the target.' },
  { key: 'bomb', label: 'Bombable', help: 'A bomb blast turns it into the target (persistently).' },
  { key: 'dash', label: 'Dash-breakable', help: 'A boots dash into it turns it into the target.' },
];

const COLLISION_HELP: Readonly<Record<Collision, string>> = {
  floor: 'Walkable.',
  solid: 'Wall. Toggle quarters below for partial walls.',
  shallow: 'Walkable water (splash, slight slow).',
  deep: 'Deep water: blocks unless the hero has flippers.',
  pit: 'Hole: the hero falls in.',
  ledge: 'One-way drop: the hero hops over it moving in the ledge direction.',
  hurt: 'Walkable but damages (spikes).',
  tallgrass: 'Walkable, drawn over the feet, cuttable.',
  stairs: 'Walkable, slows movement slightly.',
};

const MASK_QUARTERS = ['Top-left', 'Top-right', 'Bottom-left', 'Bottom-right'] as const;
const DIRS: readonly Dir[] = ['up', 'down', 'left', 'right'];

/** Tag families used to guess a sensible "turns into" tile. */
const FAMILIES = ['dungeon', 'interior', 'cave', 'overworld'] as const;

export class TileProps {
  readonly element = el('div', { class: 'qf-art-props__inner' });
  private readonly paletteEditor: PaletteEditor;
  private readonly redraws: (() => void)[] = [];
  private preview: HTMLCanvasElement | null = null;

  constructor(private readonly host: TilePropsHost) {
    this.paletteEditor = new PaletteEditor(host);
  }

  /** The colour editor inside the palette section (the palette strip can select its index). */
  get palette(): PaletteEditor {
    return this.paletteEditor;
  }

  private tile(): TileDef | undefined {
    const id = this.host.state.sel.tile;
    return id === null ? undefined : tileById(this.host.ctx.project, id);
  }

  /** Rebuild from the selected tile. */
  render(): void {
    this.redraws.length = 0;
    this.preview = null;
    const t = this.tile();
    if (!t) {
      rebuild(this.element, () => el('div', { class: 'qf-empty' }, 'Select a tile.'));
      return;
    }
    rebuild(this.element, () => [
      this.general(t),
      paletteSection(this.host, this.paletteEditor, { kind: 'tile', id: t.id, w: TILE, h: TILE, palette: t.palette, frames: t.frames }),
      this.animation(t),
      this.collision(t),
      this.behaviours(t),
    ]);
  }

  /** Pixels / palette changed: redraw canvases and pickers. */
  visuals(): void {
    for (const fn of this.redraws) fn();
    this.paletteEditor.update();
  }

  /** Animated preview (t in seconds). */
  tick(t: number): void {
    const tile = this.tile();
    const c = this.preview;
    const g = c?.getContext('2d');
    if (!tile || !c || !g) return;
    const frame = this.host.state.playing ? this.host.ctx.assets.tileFrameAt(tile.id, t) : this.host.state.frame;
    const img = this.host.ctx.assets.tile(tile.id, frame);
    g.clearRect(0, 0, c.width, c.height);
    if (img) g.drawImage(img, 0, 0, c.width, c.height);
  }

  // ------------------------------------------------------------------ sections

  private edit(label: string, mutate: (t: TileDef) => void, pixels = false): void {
    const t = this.tile();
    if (t) this.host.actions.edit('tile', t.id, `${label} (tile ${t.key})`, mutate, pixels);
  }

  private general(t: TileDef): HTMLDivElement {
    const builtIn = isDefaultTile(t.id);
    const key = builtIn
      ? el('code', { class: 'qf-art-code', title: 'Built-in tiles keep their key (code and content refer to it)' }, t.key)
      : fk(textInput(t.key, (v) => this.setKey(v), { title: 'Unique programmatic key (A-Z, 0-9, _)' }), 'key');
    const tags = [...new Set(this.host.ctx.project.tiles.flatMap((x) => x.tags))].sort();
    const uses = tileUsage(this.host.ctx.project, t.id);
    return section('Tile',
      row('Name', nameField(() => this.tile()?.name ?? '', (v) => this.edit('Rename', (d) => { d.name = v; }))),
      row('Key', key),
      row('Id', el('code', { class: 'qf-art-code' }, String(t.id)), builtIn ? el('span', { class: 'qf-badge' }, 'built-in') : null),
      row('Tags', chipEditor(t.tags, (v) => this.edit('Edit tags', (d) => { d.tags = v; }), tags)),
      el('div', { class: 'qf-art-usage', title: uses.join('\n') }, uses.length ? `Used in ${uses.length} place${uses.length === 1 ? '' : 's'} (hover for details)` : 'Not used anywhere yet'),
      el('div', { class: 'qf-row' }, button('Use as map brush', () => {
        this.host.ctx.selectTile(t.id);
        this.host.ctx.toast(`Map brush: ${t.name}`, 'success');
      }, { small: true, title: 'Paint with this tile on the Map tab' })));
  }

  private setKey(value: string): void {
    const t = this.tile();
    if (!t) return;
    const key = value.trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_');
    if (!key || key === t.key) return this.render();
    if (this.host.ctx.project.tiles.some((x) => x !== t && x.key === key)) {
      this.host.ctx.toast(`Another tile already uses the key ${key}`, 'error');
      return this.render();
    }
    this.edit('Change key', (d) => { d.key = key; });
  }

  private animation(t: TileDef): HTMLDivElement {
    const preview = smallCanvas(TILE * 3, TILE * 3, 'qf-checker qf-art-anim__canvas');
    this.preview = preview;
    const playing = this.host.state.playing;
    const toggle = el('button', {
      class: 'qf-btn qf-btn--small', type: 'button', title: playing ? 'Pause (shows the frame being edited)' : 'Play the animation',
      on: { click: () => { this.host.state.playing = !this.host.state.playing; this.render(); } },
    }, icon(playing ? 'pause' : 'play'), playing ? 'Pause' : 'Play');
    const frameTime = t.frameTime ?? DEFAULT_TILE_FRAME_TIME;
    return section('Animation',
      el('div', { class: 'qf-art-anim' }, preview,
        el('div', { class: 'qf-col' },
          el('div', { class: 'qf-small qf-muted' }, t.frames.length > 1 ? `${t.frames.length} frames` : 'Single frame — add frames in the strip under the canvas to animate.'),
          el('label', { class: 'qf-row qf-art-nowrap' }, el('span', { class: 'qf-small' }, 'Seconds / frame'),
            fk(numField(frameTime, (v) => this.edit('Frame time', (d) => {
              if (v === DEFAULT_TILE_FRAME_TIME) delete d.frameTime;
              else d.frameTime = v;
            }), { min: 0.05, max: 5, step: 0.05, title: 'Seconds each frame is shown' }), 'frameTime')),
          toggle)));
  }

  private collision(t: TileDef): HTMLDivElement {
    const setCollision = (c: Collision): void => this.edit('Collision', (d) => {
      d.collision = c;
      if (c !== 'solid') delete d.solidMask;
      if (c === 'ledge') d.ledgeDir ??= 'down';
      else delete d.ledgeDir;
    });
    const children: Child[] = [
      row('Collision', fk(select(COLLISIONS, t.collision, setCollision), 'collision')),
      el('div', { class: 'qf-art-help' }, COLLISION_HELP[t.collision]),
    ];
    if (t.collision === 'solid') children.push(this.maskEditor(t));
    if (t.collision === 'ledge') {
      children.push(row('Hop direction', fk(select(DIRS, t.ledgeDir ?? 'down', (d) => this.edit('Ledge direction', (x) => { x.ledgeDir = d; })), 'ledge')));
    }
    return section('Collision', children);
  }

  /** 2x2 solid-quarter toggles over the tile image. */
  private maskEditor(t: TileDef): HTMLDivElement {
    const mask = t.solidMask ?? 15;
    const canvas = smallCanvas(TILE, TILE, 'qf-checker qf-art-mask__img');
    const draw = (): void => {
      const g = canvas.getContext('2d');
      const img = this.host.ctx.assets.tile(t.id, this.host.state.frame);
      if (!g) return;
      g.clearRect(0, 0, TILE, TILE);
      if (img) g.drawImage(img, 0, 0);
    };
    draw();
    this.redraws.push(draw);
    const quarters = MASK_QUARTERS.map((name, bit) => {
      const on = (mask & (1 << bit)) !== 0;
      return el('button', {
        class: `qf-art-mask__q${on ? ' is-on' : ''}`, type: 'button', dataset: { bit: String(bit) },
        title: `${name}: ${on ? 'solid' : 'walkable'} (click to toggle)`,
        on: {
          click: () => this.edit('Solid mask', (d) => {
            const next = (d.solidMask ?? 15) ^ (1 << bit);
            if (next === 15) delete d.solidMask;
            else d.solidMask = next;
          }),
        },
      });
    });
    return el('div', { class: 'qf-art-mask' },
      el('div', { class: 'qf-art-mask__box' }, canvas, el('div', { class: 'qf-art-mask__grid' }, quarters)),
      el('div', { class: 'qf-art-help' }, mask === 15 ? 'Fully solid. Click a quarter to make it walkable.' : 'Red quarters are solid; the rest is walkable.'));
  }

  private behaviours(t: TileDef): HTMLDivElement {
    return section('Behaviours', BEHAVIOURS.map((b) => this.behaviour(t, b)));
  }

  private behaviour(t: TileDef, b: (typeof BEHAVIOURS)[number]): HTMLDivElement {
    const cur = t[b.key];
    const enable = (on: boolean): void => this.edit(on ? `Enable ${b.key}` : `Disable ${b.key}`, (d) => {
      if (!on) {
        delete d[b.key];
        return;
      }
      const to = this.defaultTarget(d);
      if (b.key === 'lift') d.lift = { to, weight: 0 };
      else d[b.key] = { to };
    });
    const head = el('div', { class: 'qf-art-beh__head', title: b.help }, checkField(!!cur, enable, b.label, `beh-${b.key}`));
    if (!cur) return el('div', { class: 'qf-art-beh' }, head);
    const picker = tilePicker(this.host.ctx, {
      value: cur.to, allowNone: true, title: 'Tile it turns into',
      onChange: (id) => this.edit(`${b.key} target`, (d) => {
        const beh = d[b.key];
        if (beh) beh.to = id;
      }),
    });
    fk(picker, `beh-${b.key}-to`);
    this.redraws.push(() => picker.setValue(cur.to));
    const extra: Child[] = [];
    if (b.key === 'lift' && t.lift) {
      extra.push(row('Weight', fk(select([
        { value: '0', label: '0 — no gauntlet needed' }, { value: '1', label: '1 — stone gauntlet' }, { value: '2', label: '2 — stone gauntlet (level 2)' },
      ], String(t.lift.weight), (v) => this.edit('Lift weight', (d) => { if (d.lift) d.lift.weight = Number(v) as 0 | 1 | 2; })), 'beh-weight')));
    }
    if ((b.key === 'lift' && t.lift) || (b.key === 'cut' && t.cut)) {
      const drops = b.key === 'lift' ? !!t.lift?.drops : !!t.cut?.drops;
      extra.push(checkField(drops, (v) => this.edit(`${b.key} drops`, (d) => {
        const beh = b.key === 'lift' ? d.lift : d.cut;
        if (!beh) return;
        if (v) beh.drops = true;
        else delete beh.drops;
      }), 'Drops random loot', `beh-${b.key}-drops`));
    }
    return el('div', { class: 'qf-art-beh is-on' }, head, row('Turns into', picker), extra);
  }

  /** Another ground tile of the same family (dungeon floor for dungeon tiles, ...), else grass, else none. */
  private defaultTarget(t: TileDef): number {
    const family = FAMILIES.find((f) => t.tags.includes(f));
    const ground = family
      ? this.host.ctx.project.tiles.find((x) => x.id !== t.id && x.tags.includes('ground') && x.tags.includes(family))
      : undefined;
    if (ground) return ground.id;
    return T.GRASS !== undefined && T.GRASS !== t.id ? T.GRASS : 0;
  }
}
