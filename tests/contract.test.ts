// Contract sanity tests: catalogs are internally consistent and the default
// assets satisfy every spec. These must keep passing as art modules evolve.
import { describe, expect, it } from 'vitest';
import { SPRITE_SPECS, TILE_SPECS, T, VARIANT_PALETTES, ITEM_INFO } from '../src/content/ids';
import { ENTITY_TYPES, defaultProps, entityInfo } from '../src/core/catalog';
import { createDefaultAssets } from '../src/content/art';
import { ITEM_IDS } from '../src/core/types';

describe('tile catalog', () => {
  it('has unique ids and keys', () => {
    const ids = new Set(TILE_SPECS.map((s) => s.id));
    const keys = new Set(TILE_SPECS.map((s) => s.key));
    expect(ids.size).toBe(TILE_SPECS.length);
    expect(keys.size).toBe(TILE_SPECS.length);
    expect(ids.has(0)).toBe(false);
  });
  it('behaviour targets exist', () => {
    for (const s of TILE_SPECS) {
      for (const b of [s.cut, s.lift, s.bomb, s.dash]) if (b) expect(T[b.to], `${s.key} -> ${b.to}`).toBeDefined();
    }
  });
  it('ledges declare a direction', () => {
    for (const s of TILE_SPECS) if (s.collision === 'ledge') expect(s.ledgeDir).toBeDefined();
  });
});

describe('entity catalog', () => {
  it('has unique types with sane props', () => {
    const types = new Set(ENTITY_TYPES.map((e) => e.type));
    expect(types.size).toBe(ENTITY_TYPES.length);
    for (const e of ENTITY_TYPES) {
      const keys = new Set(e.props.map((p) => p.key));
      expect(keys.size, e.type).toBe(e.props.length);
      for (const p of e.props) {
        if (p.kind === 'enum') expect(p.options?.includes(String(p.default)), `${e.type}.${p.key}`).toBe(true);
        if (p.kind === 'item') expect(ITEM_IDS.includes(p.default as never), `${e.type}.${p.key}`).toBe(true);
      }
      expect(entityInfo(e.type)).toBe(e);
      expect(Object.keys(defaultProps(e.type)).length).toBe(e.props.length);
    }
  });
  it('icons reference spec sprites and anims', () => {
    for (const e of ENTITY_TYPES) {
      const spec = SPRITE_SPECS.find((s) => s.id === e.icon.sprite);
      expect(spec, `${e.type} icon sprite ${e.icon.sprite}`).toBeDefined();
      expect(spec!.anims[e.icon.anim], `${e.type} icon anim ${e.icon.anim}`).toBeDefined();
    }
  });
});

describe('items', () => {
  it('every item has info and an icon anim in the item sprite', () => {
    const itemSpec = SPRITE_SPECS.find((s) => s.id === 'item')!;
    for (const id of ITEM_IDS) {
      const info = ITEM_INFO[id];
      expect(info, id).toBeDefined();
      expect(itemSpec.anims[info.icon], `${id} icon ${info.icon}`).toBeDefined();
      if (info.icon2) expect(itemSpec.anims[info.icon2], `${id} icon2`).toBeDefined();
    }
  });
});

describe('default assets satisfy the catalog', () => {
  const assets = createDefaultAssets();
  const palIds = new Set(assets.palettes.map((p) => p.id));

  it('palettes are 16 hex colours', () => {
    for (const p of assets.palettes) {
      expect(p.colors.length, p.id).toBe(16);
      for (const c of p.colors) expect(c, p.id).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it('one tile per spec, valid frames and palettes', () => {
    expect(assets.tiles.length).toBe(TILE_SPECS.length);
    for (const spec of TILE_SPECS) {
      const t = assets.tiles.find((x) => x.id === spec.id);
      expect(t, spec.key).toBeDefined();
      expect(t!.key).toBe(spec.key);
      expect(t!.collision).toBe(spec.collision);
      expect(palIds.has(t!.palette), `${spec.key} palette ${t!.palette}`).toBe(true);
      for (const f of t!.frames) expect(f, spec.key).toMatch(/^[0-9a-f]{256}$/);
      if (spec.animated) expect(t!.frames.length, `${spec.key} should be animated`).toBeGreaterThan(1);
    }
  });

  it('one sprite per spec with every anim and correct frame counts', () => {
    for (const spec of SPRITE_SPECS) {
      const s = assets.sprites.find((x) => x.id === spec.id);
      expect(s, spec.id).toBeDefined();
      expect([s!.w, s!.h, s!.ox, s!.oy], spec.id).toEqual([spec.w, spec.h, spec.ox, spec.oy]);
      expect(palIds.has(s!.palette), `${spec.id} palette ${s!.palette}`).toBe(true);
      for (const f of s!.frames) expect(f.length, spec.id).toBe(spec.w * spec.h);
      for (const [name, a] of Object.entries(spec.anims)) {
        const anim = s!.anims[name];
        expect(anim, `${spec.id}.${name}`).toBeDefined();
        if (!a.flipOf) expect(anim!.frames.length, `${spec.id}.${name}`).toBe(a.frames);
        else expect(anim!.flipX, `${spec.id}.${name} flipX`).toBe(true);
        for (const i of anim!.frames) expect(i < s!.frames.length, `${spec.id}.${name}`).toBe(true);
      }
      for (const sw of spec.swaps ?? []) expect(palIds.has(sw), `${spec.id} swap ${sw}`).toBe(true);
    }
  });

  it('variant palettes exist', () => {
    for (const m of Object.values(VARIANT_PALETTES)) {
      for (const id of Object.values(m)) if (id) expect(palIds.has(id), id).toBe(true);
    }
  });

  it('terrains reference real tiles', () => {
    const tileIds = new Set(assets.tiles.map((t) => t.id));
    for (const tr of assets.terrains) {
      for (const k of ['center', 'n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw', 'ine', 'inw', 'ise', 'isw'] as const) {
        expect(tileIds.has(tr[k]), `${tr.id}.${k}`).toBe(true);
      }
    }
  });
});
