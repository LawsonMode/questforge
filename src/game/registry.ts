// Entity type registry. Behaviour modules call registerEntity() at import time;
// src/game/entities/index.ts imports every behaviour module so the registry is
// populated before the engine spawns anything.
import type { EntityInstance } from '../core/types';
import type { GameServices } from './api';
import type { Entity } from './entity';

export type EntityFactory = (game: GameServices, inst: EntityInstance) => Entity;

const factories = new Map<string, EntityFactory>();
const warned = new Set<string>();

export function registerEntity(type: string, factory: EntityFactory): void {
  if (factories.has(type)) console.warn(`[registry] entity type "${type}" registered twice; last wins`);
  factories.set(type, factory);
}

/** Create a runtime entity for a placed instance; null (with one warning) for unknown types. */
export function createEntity(game: GameServices, inst: EntityInstance): Entity | null {
  const f = factories.get(inst.type);
  if (!f) {
    if (!warned.has(inst.type)) {
      warned.add(inst.type);
      console.warn(`[registry] no behaviour registered for entity type "${inst.type}"`);
    }
    return null;
  }
  return f(game, inst);
}

export function isRegistered(type: string): boolean {
  return factories.has(type);
}

