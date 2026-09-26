// Sprite properties column: name / tags, frame size (custom sprites only;
// resizing pads/crops every frame around the bottom centre), origin, palette
// section, and the animations table (frame lists, fps, loop, flipX) with an
// animated preview drawn exactly like the game (origin on the ground point).
// Anims required by the engine (SPRITE_SPECS) are marked and cannot be deleted.
import type { SpriteAnim, SpriteDef } from '../../core/types';
import { spriteById } from '../../core/project';
import { spriteSpec } from '../../content/ids';
import { animFrameIndex } from '../../gfx/imageCache';
import { button, el, promptDialog, textInput, type Child } from '../ui/dom';
import { formatFrameList, parseFrameList } from './frames';
import { icon } from './icons';
import { spriteAsset, type ArtState } from './model';
import { anchorOffset, resizeFrame } from './ops';
import { PaletteEditor, paletteSection, type PaletteEditorHost } from './paletteEditor';
import { smallCanvas } from './raster';
import { isDefaultSprite, spriteUsage } from './usage';
import { checkField, chipEditor, fk, nameField, numField, propRow as row, rebuild, section } from './widgets';

export interface SpritePropsHost extends PaletteEditorHost {
  readonly state: ArtState;
  /** Switch the pixel editor to the origin tool. */
  originTool(): void;
  /** Show another frame on the canvas. */
  selectFrame(index: number): void;
}

const MIN_SIZE = 4;
const MAX_SIZE = 64;
const PREVIEW_PAD = 6;
/** Pause before a non-looping anim replays in the preview (s). */
const REPLAY_GAP = 0.6;
const ANIM_NAME = /^[A-Za-z][A-Za-z0-9_]*$/;

export class SpriteProps {
  readonly element = el('div', { class: 'qf-art-props__inner' });
  private readonly paletteEditor: PaletteEditor;
  private preview: HTMLCanvasElement | null = null;
  private previewScale = 3;

  constructor(private readonly host: SpritePropsHost) {
    this.paletteEditor = new PaletteEditor(host);
  }

  /** The colour editor inside the palette section. */
  get palette(): PaletteEditor {
    return this.paletteEditor;
  }

  private sprite(): SpriteDef | undefined {
    const id = this.host.state.sel.sprite;
    return id === null ? undefined : spriteById(this.host.ctx.project, id);
  }

  /** Rebuild from the selected sprite. */
  render(): void {
    this.preview = null;
    const s = this.sprite();
    if (!s) {
      rebuild(this.element, () => el('div', { class: 'qf-empty' }, 'Select a sprite.'));
      return;
    }
    const st = this.host.state;
    if (st.anim === null || !Object.hasOwn(s.anims, st.anim)) st.anim = Object.keys(s.anims)[0] ?? null;
    rebuild(this.element, () => [
      this.general(s),
      this.geometry(s),
      paletteSection(this.host, this.paletteEditor, spriteAsset(s)),
      this.animations(s),
    ]);
  }

  /** Pixels / palette changed. */
  visuals(): void {
    this.paletteEditor.update();
  }

  /** Animated preview of the selected anim (t in seconds). */
  tick(t: number): void {
    const s = this.sprite();
    const c = this.preview;
    const g = c?.getContext('2d');
    if (!s || !c || !g) return;
    const st = this.host.state;
    const anim = st.anim !== null && Object.hasOwn(s.anims, st.anim) ? s.anims[st.anim] : undefined;
    g.clearRect(0, 0, c.width, c.height);
    const z = this.previewScale;
    const ox = Math.floor(c.width / 2);
    const oy = PREVIEW_PAD + s.oy * z;
    g.fillStyle = 'rgba(0, 0, 0, 0.25)';
    g.fillRect(ox - 6 * z, oy - 1, 12 * z, 2);
    let frame = st.frame;
    if (anim && st.playing) {
      const span = anim.fps > 0 ? anim.frames.length / anim.fps : 1;
      frame = animFrameIndex(anim, anim.loop ? t : t % (span + REPLAY_GAP));
    }
    this.host.ctx.assets.drawSpriteAt(g, s.id, frame, ox, oy, z, { flipX: !!anim?.flipX && st.playing });
    g.fillStyle = 'rgba(88, 200, 240, 0.9)';
    g.fillRect(ox - 3, oy, 7, 1);
    g.fillRect(ox, oy - 3, 1, 7);
  }

  // ------------------------------------------------------------------ sections

  private edit(label: string, mutate: (s: SpriteDef) => void, pixels = false): void {
    const s = this.sprite();
    if (s) this.host.actions.edit('sprite', s.id, `${label} (sprite ${s.id})`, mutate, pixels);
  }

  private general(s: SpriteDef): HTMLDivElement {
    const builtIn = isDefaultSprite(s.id);
    const uses = spriteUsage(this.host.ctx.project, s.id);
    const tags = [...new Set(this.host.ctx.project.sprites.flatMap((x) => x.tags))].sort();
    return section('Sprite',
      row('Name', nameField(() => this.sprite()?.name ?? '', (v) => this.edit('Rename', (d) => { d.name = v; }))),
      row('Id', el('code', { class: 'qf-art-code' }, s.id), builtIn ? el('span', { class: 'qf-badge', title: 'Drawn by the engine: editable, not deletable' }, 'built-in') : null),
      row('Tags', chipEditor(s.tags, (v) => this.edit('Edit tags', (d) => { d.tags = v; }), tags)),
      el('div', { class: 'qf-art-usage', title: uses.join('\n') }, uses.length ? uses.slice(0, 3).join(' · ') + (uses.length > 3 ? ` +${uses.length - 3} more` : '') : 'Not used anywhere yet'));
  }

  private geometry(s: SpriteDef): HTMLDivElement {
    const custom = !isDefaultSprite(s.id);
    const size = custom
      ? [
        fk(numField(s.w, (w) => this.resize(w, s.h), { min: MIN_SIZE, max: MAX_SIZE, integer: true, title: 'Width (px)' }), 'w'),
        el('span', { class: 'qf-muted' }, '×'),
        fk(numField(s.h, (h) => this.resize(s.w, h), { min: MIN_SIZE, max: MAX_SIZE, integer: true, title: 'Height (px)' }), 'h'),
      ]
      : [el('span', null, `${s.w} × ${s.h}`), el('span', { class: 'qf-muted qf-small' }, 'fixed by the engine')];
    return section('Size & origin',
      row('Frame size', size),
      row('Origin',
        fk(numField(s.ox, (v) => this.edit('Origin X', (d) => { d.ox = v; }), { min: 0, max: s.w, integer: true, title: 'Origin x' }), 'ox'),
        fk(numField(s.oy, (v) => this.edit('Origin Y', (d) => { d.oy = v; }), { min: 0, max: s.h, integer: true, title: 'Origin y' }), 'oy')),
      el('div', { class: 'qf-art-help' },
        'The origin lands on the entity position (usually between the feet). ',
        button([icon('origin'), 'Drag it on the canvas'], () => this.host.originTool(), { small: true, kind: 'ghost', title: 'Origin tool (P)' })));
  }

  /** Resize every frame around the bottom centre; the origin follows the art. */
  private resize(w: number, h: number): void {
    const s = this.sprite();
    if (!s || (w === s.w && h === s.h)) return;
    const off = anchorOffset(s.w, s.h, w, h);
    this.edit(`Resize to ${w}×${h}`, (d) => {
      d.frames = d.frames.map((f) => resizeFrame(f, d.w, d.h, w, h, off.x, off.y));
      d.ox = Math.max(0, Math.min(w, d.ox + off.x));
      d.oy = Math.max(0, Math.min(h, d.oy + off.y));
      d.w = w;
      d.h = h;
    }, true);
  }

  private animations(s: SpriteDef): HTMLDivElement {
    const st = this.host.state;
    const required = new Set(Object.keys(spriteSpec(s.id)?.anims ?? {}));
    this.previewScale = Math.max(1, Math.min(4, Math.floor(96 / Math.max(s.w, s.h))));
    const z = this.previewScale;
    const halfW = Math.max(s.ox, s.w - s.ox);
    const preview = smallCanvas(halfW * 2 * z + PREVIEW_PAD * 2, s.h * z + PREVIEW_PAD * 2, 'qf-checker qf-art-anim__canvas');
    this.preview = preview;
    const playing = st.playing;
    const rows = Object.entries(s.anims).map(([name, a]) => this.animRow(s, name, a, required.has(name)));
    return section({ title: 'Animations', extra: button('+ Add', () => void this.addAnim(), { small: true, kind: 'ghost', title: 'Add an animation' }) },
      el('div', { class: 'qf-art-anim qf-art-anim--sticky' }, preview,
        el('div', { class: 'qf-col' },
          el('div', { class: 'qf-small' }, st.anim ?? 'No animation'),
          el('button', {
            class: 'qf-btn qf-btn--small', type: 'button',
            on: { click: () => { st.playing = !st.playing; this.render(); } },
          }, icon(playing ? 'pause' : 'play'), playing ? 'Pause' : 'Play'),
          el('div', { class: 'qf-small qf-muted' }, playing ? 'Click a row to preview it.' : 'Paused: showing the frame being edited.'))),
      el('table', { class: 'qf-art-anims' },
        el('thead', null, el('tr', null,
          el('th', null, 'Name'), el('th', { title: 'Frame indices in play order, e.g. 0,1,2,1' }, 'Frames'),
          el('th', null, 'FPS'), el('th', { title: 'Loop' }, '⟳'), el('th', { title: 'Draw mirrored horizontally' }, '⇋'), el('th', null, ''))),
        el('tbody', null, rows)),
      required.size ? el('div', { class: 'qf-art-anims__legend' }, el('span', { class: 'qf-art-req' }), 'required by the engine (cannot be deleted or renamed)') : null);
  }

  private animRow(s: SpriteDef, name: string, a: SpriteAnim, required: boolean): HTMLTableRowElement {
    const st = this.host.state;
    const update = (label: string, fn: (x: SpriteAnim) => void): void => this.edit(`${label} ${name}`, (d) => {
      const anim = d.anims[name];
      if (anim) fn(anim);
    });
    const frames = fk(textInput(formatFrameList(a.frames), (v) => {
      const list = parseFrameList(v, s.frames.length);
      if (!list) {
        this.host.ctx.toast(`Frames must be indices 0-${s.frames.length - 1}, e.g. 0,1,2,1`, 'error');
        this.render();
        return;
      }
      update('Anim frames', (x) => { x.frames = list; });
    }, { title: `Frame indices 0-${s.frames.length - 1}` }), `anim-${name}-frames`);
    const nameCell: Child = required
      ? el('span', { class: 'qf-art-anims__name', title: `${name} — required by the engine` }, el('span', { class: 'qf-art-req' }), name)
      : fk(textInput(name, (v) => this.renameAnim(name, v), { title: 'Animation name' }), `anim-${name}-name`);
    const tr = el('tr', {
      class: st.anim === name ? 'is-active' : '', dataset: { anim: name },
      title: 'Click to preview this animation and edit its frames',
      on: { click: () => this.pickAnim(name) },
    },
    el('td', null, nameCell),
    el('td', null, frames),
    el('td', null, fk(numField(a.fps, (v) => update('Anim fps', (x) => { x.fps = v; }), { min: 1, max: 60, integer: true, title: 'Frames per second' }), `anim-${name}-fps`)),
    el('td', { title: 'Loop' }, checkField(a.loop, (v) => update('Anim loop', (x) => { x.loop = v; }), '', `anim-${name}-loop`)),
    el('td', { title: 'Mirror horizontally' }, checkField(!!a.flipX, (v) => update('Anim flip', (x) => {
      if (v) x.flipX = true;
      else delete x.flipX;
    }), '', `anim-${name}-flip`)),
    el('td', null, button('×', () => this.deleteAnim(name), {
      small: true, kind: 'ghost', disabled: required, title: required ? 'Required by the engine — cannot be deleted' : `Delete ${name}`,
    })));
    return tr;
  }

  /** Preview an anim; the canvas jumps to its first frame unless it already shows one of its frames. */
  private pickAnim(name: string): void {
    const s = this.sprite();
    const anim = s && Object.hasOwn(s.anims, name) ? s.anims[name] : undefined;
    if (!anim || this.host.state.anim === name) return;
    this.host.state.anim = name;
    this.render();
    const first = anim.frames[0];
    if (first !== undefined && !anim.frames.includes(this.host.state.frame)) this.host.selectFrame(first);
  }

  private async addAnim(): Promise<void> {
    const s = this.sprite();
    if (!s) return;
    const raw = await promptDialog('Name of the new animation (letters, digits, _):', 'anim', { title: 'Add animation', ok: 'Add' });
    const name = raw?.trim();
    if (!name || !this.validName(name, s)) return;
    const frame = Math.min(this.host.state.frame, s.frames.length - 1);
    this.edit(`Add anim ${name}`, (d) => { d.anims[name] = { frames: [frame], fps: 8, loop: true }; });
    this.host.state.anim = name;
    this.render();
  }

  private validName(name: string, s: SpriteDef): boolean {
    if (!ANIM_NAME.test(name)) {
      this.host.ctx.toast('Animation names use letters, digits and _ (starting with a letter).', 'error');
      return false;
    }
    if (Object.hasOwn(s.anims, name)) {
      this.host.ctx.toast(`${s.name} already has an animation called ${name}.`, 'error');
      return false;
    }
    return true;
  }

  private renameAnim(from: string, to: string): void {
    const s = this.sprite();
    const name = to.trim();
    if (!s || name === from) return;
    if (!this.validName(name, s)) {
      this.render();
      return;
    }
    this.edit(`Rename anim ${from}`, (d) => {
      d.anims = Object.fromEntries(Object.entries(d.anims).map(([k, v]) => [k === from ? name : k, v]));
    });
    if (this.host.state.anim === from) this.host.state.anim = name;
    this.render();
  }

  private deleteAnim(name: string): void {
    this.edit(`Delete anim ${name}`, (d) => {
      d.anims = Object.fromEntries(Object.entries(d.anims).filter(([k]) => k !== name));
    });
  }
}
