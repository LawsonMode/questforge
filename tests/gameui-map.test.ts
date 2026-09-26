// Pause map helpers: floor labels and where an interior room sits on the
// overworld (the doorway warp the indoor map page marks).
import { describe, expect, it } from 'vitest';
import type { EntityInstance, Project, Room, WarpTarget, World } from '../src/core/types';
import { floorLabel, interiorDoorway } from '../src/game/ui/pauseMap';

function room(id: string, entities: EntityInstance[] = []): Room {
  return { id, name: id, gx: 0, gy: 0, gw: 1, gh: 1, floor: 0, layers: { bg: [], fg: [], over: [] }, entities, triggers: [] };
}

function warp(id: string, x: number, y: number, target: WarpTarget): EntityInstance {
  return { id, type: 'marker.warp', x, y, props: { target } };
}

function world(id: string, kind: World['kind'], rooms: Room[]): World {
  return { id, name: id, kind, music: 'overworld', rooms };
}

describe('pause map', () => {
  it('labels floors 1F, 2F and B1', () => {
    expect([floorLabel(0), floorLabel(1), floorLabel(-1)]).toEqual(['1F', '2F', 'B1']);
  });

  it('finds the overworld doorway of an interior room, else of its world, else none', () => {
    const house = world('house', 'interior', [room('hall'), room('attic'), room('cellar')]);
    const town = room('town', [
      warp('toAttic', 40, 60, { world: 'house', room: 'attic', x: 0, y: 0 }),
      warp('toHall', 120, 90, { world: 'house', room: 'hall', x: 0, y: 0 }),
    ]);
    const field = world('field', 'overworld', [town]);
    const cave = world('cave', 'interior', [room('den')]);
    // A warp from another interior never counts as an overworld doorway.
    const shop = world('shop', 'interior', [room('back', [warp('toDen', 8, 8, { world: 'cave', room: 'den', x: 0, y: 0 })])]);
    const project = { worlds: [house, field, cave, shop] } as unknown as Project;
    const hall = interiorDoorway(project, house, 'hall');
    expect(hall?.world).toBe(field);
    expect(hall?.room).toBe(town);
    expect(hall?.at).toEqual({ x: 120, y: 90 });
    expect(interiorDoorway(project, house, 'cellar')?.at).toEqual({ x: 40, y: 60 });
    expect(interiorDoorway(project, cave, 'den')).toBeNull();
  });
});
