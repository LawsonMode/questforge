// Arena helper smoke: builds a one-room project in the page and runs it.
export default async function (t) {
  await t.goto('#/');
  await t.eval(async (cfg) => (await import('/src/dev/arena.ts')).startArena(cfg), {
    theme: 'dungeon',
    entities: [{ type: 'obj.chest', x: 72, y: 72 }],
    tiles: [{ layer: 'fg', tx: 10, ty: 4, tile: 'PILLAR' }],
  });
  await t.wait(700);
  const info = await t.eval(() => {
    const s = window.__qf.game?.services;
    return s ? { room: s.room.def.id, px: Math.round(s.player.x), py: Math.round(s.player.y), hp: s.save.hp } : null;
  });
  t.log('arena', info);
  t.assert(info && info.room === 'arena_room', 'arena room loaded');
  await t.hold('ArrowUp', 300);
  await t.shotCanvas('arena-dungeon');
}
