// Editor shell: the EditorContext implementation (selection, dirty tracking,
// asset invalidation, undo integration, tab switching, location picking).
import { describe, expect, it } from 'vitest';
import type { AssetCache } from '../src/gfx/imageCache';
import type { EditorContext, EditorTabId } from '../src/editor/context';
import type { WarpTarget } from '../src/core/types';
import { ShellContext, hasSaveStatus, type ShellHost } from '../src/editor/shell/context';
import { Autosave, type Timers } from '../src/editor/shell/autosave';
import { createBlankProject, createRoom } from '../src/core/project';

function fakeAssets(): { assets: AssetCache; log: string[] } {
  const log: string[] = [];
  const assets = {
    invalidateAll: () => log.push('all'),
    invalidateTile: (id: number) => log.push(`tile:${id}`),
    invalidateSprite: (id: string) => log.push(`sprite:${id}`),
    invalidatePalette: (id: string) => log.push(`palette:${id}`),
  } as unknown as AssetCache;
  return { assets, log };
}

function setup() {
  const project = createBlankProject('Ctx');
  const timers: Timers & { fns: (() => void)[] } = {
    fns: [],
    set(fn) {
      this.fns.push(fn);
      return this.fns.length;
    },
    clear() {},
  };
  let saves = 0;
  const autosave = new Autosave({ save: async () => { saves++; }, timers });
  const { assets, log } = fakeAssets();
  const shown: EditorTabId[] = [];
  const toasts: string[] = [];
  const host: ShellHost = {
    showTab: (id) => shown.push(id),
    playtest: () => {},
    toast: (msg) => toasts.push(msg),
    tabReady: () => Promise.resolve(),
  };
  const ctx = new ShellContext(project, assets, autosave, host);
  return { project, ctx, autosave, log, shown, toasts, timers, saves: () => saves };
}

describe('ShellContext selection', () => {
  it('starts on the project start room', () => {
    const { ctx, project } = setup();
    expect(ctx.worldId).toBe(project.start.world);
    expect(ctx.roomId).toBe(project.start.room);
    expect(ctx.room()?.id).toBe(project.start.room);
    expect(ctx.world().id).toBe(project.start.world);
    expect(ctx.layer).toBe('bg');
    expect(ctx.entityId).toBeNull();
  });

  it('emits selection events only for real changes', () => {
    const { ctx } = setup();
    const events: string[] = [];
    ctx.bus.on('selection', ({ what }) => events.push(what));
    ctx.selectLayer('fg');
    ctx.selectLayer('fg');
    ctx.selectTile(7);
    ctx.selectTerrain('grass');
    ctx.selectEntityType('enemy.slime');
    ctx.selectEntity('e1');
    expect(events).toEqual(['layer', 'tile', 'tile', 'entityType', 'entity']);
    expect([ctx.layer, ctx.tile, ctx.terrainId, ctx.entityType, ctx.entityId]).toEqual(['fg', 7, 'grass', 'enemy.slime', 'e1']);
  });

  it('selecting another room clears the entity selection', () => {
    const { ctx, project } = setup();
    const world = project.worlds[0]!;
    const other = createRoom({ name: 'Other', gx: 1, gy: 0 });
    world.rooms.push(other);
    ctx.selectEntity('e1');
    const events: string[] = [];
    ctx.bus.on('selection', ({ what }) => events.push(what));
    ctx.selectRoom(world.id, other.id);
    expect(ctx.room()?.id).toBe(other.id);
    expect(ctx.entityId).toBeNull();
    expect(events).toEqual(['room', 'entity']);
  });
});

describe('ShellContext changes', () => {
  it('changed() marks dirty, schedules one autosave and emits project', () => {
    const { ctx, autosave, timers } = setup();
    const seen: unknown[] = [];
    ctx.bus.on('project', (e) => seen.push(e));
    ctx.changed('settings');
    ctx.changed('room', 'r1');
    expect(autosave.status).toBe('dirty');
    expect(autosave.pending).toBe(true);
    expect(timers.fns.length).toBeGreaterThan(0);
    expect(seen).toEqual([{ what: 'settings' }, { what: 'room', id: 'r1' }]);
  });

  it('structural changes drop selections of deleted rooms and entities', () => {
    const { ctx, project } = setup();
    const world = project.worlds[0]!;
    ctx.selectEntity('ghost');
    ctx.changed('entities');
    expect(ctx.entityId).toBeNull();
    world.rooms.length = 0;
    ctx.changed('rooms');
    expect(ctx.roomId).toBeNull();
    expect(ctx.room()).toBeNull();
  });

  it('assetsChanged() invalidates precisely, then emits assets', () => {
    const { ctx, log, autosave } = setup();
    const seen: unknown[] = [];
    ctx.bus.on('assets', (e) => seen.push(e));
    ctx.assetsChanged('tile', 12);
    ctx.assetsChanged('sprite', 'hero');
    ctx.assetsChanged('palette', 'pal.hero');
    ctx.assetsChanged('all');
    ctx.assetsChanged('tile');
    expect(log).toEqual(['tile:12', 'sprite:hero', 'palette:pal.hero', 'all', 'all']);
    expect(seen[0]).toEqual({ kind: 'tile', id: 12 });
    expect(autosave.pending).toBe(true);
  });

  it('undo/redo apply the command, emit undo and mark dirty', () => {
    const { ctx, project, autosave } = setup();
    const labels: string[] = [];
    ctx.bus.on('undo', ({ label }) => labels.push(label));
    expect(ctx.undoLast()).toBe(false);
    project.name = 'After';
    ctx.undo.push({ label: 'Rename', undo: () => { project.name = 'Before'; }, redo: () => { project.name = 'After'; } });
    expect(ctx.undoLast()).toBe(true);
    expect(project.name).toBe('Before');
    expect(ctx.redoLast()).toBe(true);
    expect(project.name).toBe('After');
    expect(ctx.redoLast()).toBe(false);
    expect(labels).toEqual(['Rename', 'Rename']);
    expect(autosave.status).toBe('dirty');
  });

  it('save() stores even when clean', async () => {
    const { ctx, saves } = setup();
    await ctx.save();
    expect(saves()).toBe(1);
  });
});

describe('ShellContext tabs & picking', () => {
  it('switchTab shows the tab and emits only on change', () => {
    const { ctx, shown } = setup();
    const tabs: string[] = [];
    ctx.bus.on('tab', ({ id }) => tabs.push(id));
    ctx.switchTab('art');
    ctx.switchTab('art');
    ctx.switchTab('project');
    expect(shown).toEqual(['art', 'art', 'project']);
    expect(tabs).toEqual(['art', 'project']);
    expect(ctx.activeTab).toBe('project');
  });

  it('pickLocation switches to the map and delegates to the registered picker', async () => {
    const { ctx, shown } = setup();
    const target: WarpTarget = { world: 'w', room: 'r', x: 40, y: 50 };
    const prompts: string[] = [];
    ctx.setLocationPicker(async (p) => {
      prompts.push(p);
      return target;
    });
    ctx.switchTab('project');
    expect(await ctx.pickLocation('Where?')).toEqual(target);
    expect(shown.at(-1)).toBe('map');
    expect(prompts).toEqual(['Where?']);
  });

  it('pickLocation resolves null once the user leaves the map, and ignores a late pick', async () => {
    const { ctx, shown } = setup();
    let pickNow: ((at: WarpTarget | null) => void) | null = null;
    ctx.setLocationPicker(() => new Promise((resolve) => { pickNow = resolve; }));
    const pending = ctx.pickLocation('Where?');
    await Promise.resolve();
    ctx.switchTab('map');
    ctx.switchTab('art');
    expect(await pending).toBeNull();
    expect(shown.at(-1)).toBe('art');
    pickNow!({ world: 'w', room: 'r', x: 1, y: 2 });
    await Promise.resolve();
    expect(ctx.activeTab).toBe('art');
  });

  it('pickLocation waits a tick for the map tab to register, else resolves null with a toast', async () => {
    const { ctx, toasts } = setup();
    expect(await ctx.pickLocation('Where?')).toBeNull();
    expect(toasts).toHaveLength(1);
    ctx.setLocationPicker(async () => null);
    ctx.setLocationPicker(null);
    expect(await ctx.pickLocation('Again')).toBeNull();
  });
});

describe('ShellContext save status', () => {
  it('reports when the project was last stored and notifies listeners', () => {
    const { ctx, project } = setup();
    expect(hasSaveStatus(ctx)).toBe(true);
    expect(ctx.lastSaved).toBe(project.modified);
    const seen: string[] = [];
    const off = ctx.onSaveStatus((s) => seen.push(s));
    project.modified = 123;
    ctx.reportSaveStatus('saved', true);
    expect(seen).toEqual(['saved']);
    expect(ctx.lastSaved).toBe(123);
    off();
    ctx.reportSaveStatus('dirty', true);
    expect(seen).toEqual(['saved']);
  });

  it('has no last save for a copy that was never stored, until it is', () => {
    const project = createBlankProject('Copy');
    const autosave = new Autosave({ save: async () => {} });
    const host: ShellHost = { showTab: () => {}, playtest: () => {}, toast: () => {}, tabReady: () => Promise.resolve() };
    const ctx = new ShellContext(project, fakeAssets().assets, autosave, host, false);
    expect(ctx.lastSaved).toBeNull();
    ctx.reportSaveStatus('saved', true);
    expect(ctx.lastSaved).toBe(project.modified);
    autosave.dispose();
  });

  it('drops status listeners on dispose', () => {
    const { ctx } = setup();
    const seen: string[] = [];
    ctx.onSaveStatus((s) => seen.push(s));
    ctx.dispose();
    ctx.reportSaveStatus('saved', true);
    expect(seen).toEqual([]);
  });

  it('is not claimed by a plain EditorContext', () => {
    expect(hasSaveStatus({} as EditorContext)).toBe(false);
  });
});
