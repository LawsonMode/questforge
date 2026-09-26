// =============================================================================
// Entity catalog — every placeable entity type, its editor metadata and its
// property schema. Game behaviours (src/game/entities/**) implement these
// types; the editor inspector renders forms from `props`; the sample project
// places instances with these props. Keys & prop names here are the contract.
// =============================================================================
import type { EntityInstance, PropValue } from './types';
import { DROP_KINDS, NPC_SPRITES } from '../content/ids';
import { ITEM_IDS } from './types';

export type PropKind =
  | 'string'    // single-line text
  | 'text'      // multi-line text
  | 'number'
  | 'bool'
  | 'enum'      // one of `options`
  | 'item'      // ItemId
  | 'dialogue'  // Dialogue id ('' = none)
  | 'entity'    // entity id in the same room ('' = none); `entityFilter` = type prefix
  | 'flag'      // flag name
  | 'warp'      // WarpTarget | null
  | 'music';    // MusicId | 'none' | 'inherit'

export interface PropSchema {
  key: string;
  label: string;
  kind: PropKind;
  default: PropValue;
  options?: readonly string[];
  min?: number;
  max?: number;
  entityFilter?: string;
  help?: string;
}

export type EntityCategory = 'enemy' | 'boss' | 'npc' | 'object' | 'pickup' | 'marker';

export interface EntityTypeInfo {
  type: string;
  name: string;
  category: EntityCategory;
  description: string;
  /** Sprite + anim used by the editor palette and when drawing placed instances. */
  icon: { sprite: string; anim: string; palette?: string };
  /** Footprint (px) for editor hit-testing & the default runtime hitbox. */
  size: { w: number; h: number };
  props: PropSchema[];
  /** Must be defeated for the 'enemiesCleared' condition (default: category enemy/boss). */
  countsForClear?: boolean;
  /** Once defeated, never respawns (persisted as flag defeated:<id>). */
  persistDefeat?: boolean;
  /** Width/height props (in tiles) resize the footprint: markers. */
  resizable?: boolean;
}

const DIR_OPTS = ['up', 'down', 'left', 'right'] as const;
const P = {
  drop: (def = 'random'): PropSchema => ({ key: 'drop', label: 'Drops', kind: 'enum', default: def, options: DROP_KINDS, help: 'Loot left behind when defeated.' }),
  hidden: (): PropSchema => ({ key: 'hidden', label: 'Hidden', kind: 'bool', default: false, help: 'Not present until a trigger shows it (showEntity).' }),
  facing: (def = 'down'): PropSchema => ({ key: 'facing', label: 'Facing', kind: 'enum', default: def, options: DIR_OPTS }),
};

export const ENTITY_TYPES: readonly EntityTypeInfo[] = [
  // ------------------------------------------------------------------ enemies
  {
    type: 'enemy.soldier', name: 'Soldier', category: 'enemy', description: 'Sword soldier. Patrols, then chases when it sees you.',
    icon: { sprite: 'enemy.soldier', anim: 'walk_down' }, size: { w: 12, h: 12 },
    props: [
      { key: 'variant', label: 'Variant', kind: 'enum', default: 'green', options: ['green', 'blue', 'red'], help: 'green 2HP, blue 4HP, red 6HP & faster.' },
      { key: 'behavior', label: 'Behaviour', kind: 'enum', default: 'patrol', options: ['patrol', 'guard', 'chase'] },
      P.facing(), P.drop(), P.hidden(),
    ],
  },
  {
    type: 'enemy.archer', name: 'Archer', category: 'enemy', description: 'Keeps its distance and shoots arrows when lined up.',
    icon: { sprite: 'enemy.archer', anim: 'walk_down' }, size: { w: 12, h: 12 },
    props: [{ key: 'variant', label: 'Variant', kind: 'enum', default: 'green', options: ['green', 'blue'] }, P.facing(), P.drop(), P.hidden()],
  },
  {
    type: 'enemy.spitter', name: 'Rock Spitter', category: 'enemy', description: 'Wanders and spits rocks. Shield blocks rocks.',
    icon: { sprite: 'enemy.spitter', anim: 'walk_down' }, size: { w: 12, h: 12 },
    props: [{ key: 'variant', label: 'Variant', kind: 'enum', default: 'red', options: ['red', 'blue'], help: 'blue fires 3-rock bursts.' }, P.drop(), P.hidden()],
  },
  {
    type: 'enemy.bat', name: 'Bat', category: 'enemy', description: 'Erratic flier. Flies over pits and water.',
    icon: { sprite: 'enemy.bat', anim: 'fly' }, size: { w: 10, h: 8 },
    props: [{ key: 'sleeping', label: 'Sleeping', kind: 'bool', default: false, help: 'Rests until you come near.' }, P.drop(), P.hidden()],
  },
  {
    type: 'enemy.skeleton', name: 'Skeleton', category: 'enemy', description: 'Hops toward you and leaps back from sword swings; sometimes throws bones.',
    icon: { sprite: 'enemy.skeleton', anim: 'walk' }, size: { w: 12, h: 12 },
    props: [{ key: 'throws', label: 'Throws bones', kind: 'bool', default: true }, P.drop(), P.hidden()],
  },
  {
    type: 'enemy.slime', name: 'Slime', category: 'enemy', description: 'Hopping blob. Big slimes can split in two.',
    icon: { sprite: 'enemy.slime', anim: 'idle' }, size: { w: 12, h: 10 },
    props: [
      { key: 'variant', label: 'Variant', kind: 'enum', default: 'green', options: ['green', 'red', 'blue'] },
      { key: 'size', label: 'Size', kind: 'enum', default: 'big', options: ['big', 'small'] },
      { key: 'split', label: 'Splits', kind: 'bool', default: true, help: 'Big slime splits into two small ones.' },
      P.drop(), P.hidden(),
    ],
  },
  {
    type: 'enemy.goblin', name: 'Spear Goblin', category: 'enemy', description: 'Tough brute that throws spears when lined up.',
    icon: { sprite: 'enemy.goblin', anim: 'walk_down' }, size: { w: 12, h: 12 },
    props: [P.facing(), P.drop(), P.hidden()],
  },
  {
    type: 'enemy.beetle', name: 'Shell Beetle', category: 'enemy', description: 'Invulnerable. Sword hits knock it far back — push it into a pit.',
    icon: { sprite: 'enemy.beetle', anim: 'walk' }, size: { w: 14, h: 12 },
    props: [P.drop('none'), P.hidden()],
  },
  {
    type: 'enemy.eye', name: 'Eye Statue', category: 'enemy', description: 'Invulnerable sentry. Its eye sweeps around and fires a beam when it spots you.',
    icon: { sprite: 'enemy.eye', anim: 's' }, size: { w: 16, h: 16 }, countsForClear: false,
    props: [
      { key: 'cooldown', label: 'Cooldown (s)', kind: 'number', default: 2, min: 0.5, max: 10 },
      {
        key: 'facing', label: 'Starts facing', kind: 'enum', default: 'auto', options: ['auto', ...DIR_OPTS],
        help: 'auto = a start direction picked from its id, so neighbouring statues sweep out of step.',
      },
    ],
  },
  {
    type: 'enemy.snake', name: 'Snake', category: 'enemy', description: 'Slithers, then dashes when lined up with you.',
    icon: { sprite: 'enemy.snake', anim: 'walk_down' }, size: { w: 12, h: 10 },
    props: [P.drop(), P.hidden()],
  },
  {
    type: 'enemy.bladeTrap', name: 'Blade Trap', category: 'enemy', description: 'Invulnerable. Slides at you when you line up, then retracts.',
    icon: { sprite: 'enemy.bladeTrap', anim: 'idle' }, size: { w: 16, h: 16 }, countsForClear: false,
    props: [
      { key: 'axis', label: 'Axis', kind: 'enum', default: 'both', options: ['both', 'horizontal', 'vertical'] },
      { key: 'range', label: 'Range (tiles)', kind: 'number', default: 6, min: 1, max: 32 },
    ],
  },
  {
    type: 'enemy.ghost', name: 'Ghost', category: 'enemy', description: 'Drifts through walls; fades out and can only be hurt while visible.',
    icon: { sprite: 'enemy.ghost', anim: 'float' }, size: { w: 12, h: 12 },
    props: [P.drop(), P.hidden()],
  },
  // ------------------------------------------------------------------ bosses
  {
    type: 'boss.worm', name: 'Giant Worm', category: 'boss', description: 'Segmented worm that bounces around the arena. Only its glowing tail is vulnerable.',
    icon: { sprite: 'boss.worm', anim: 'head' }, size: { w: 24, h: 24 }, persistDefeat: true,
    props: [
      { key: 'hp', label: 'Health', kind: 'number', default: 12, min: 1, max: 99 },
      { key: 'segments', label: 'Segments', kind: 'number', default: 4, min: 2, max: 8 },
      { key: 'dropHeart', label: 'Drops heart vessel', kind: 'bool', default: true },
      P.hidden(),
    ],
  },
  {
    type: 'boss.knight', name: 'Iron Knight', category: 'boss', description: 'Charges at you; crashing into a wall stuns it — strike then. Shield blocks frontal hits.',
    icon: { sprite: 'boss.knight', anim: 'walk_down' }, size: { w: 24, h: 20 }, persistDefeat: true,
    props: [
      { key: 'hp', label: 'Health', kind: 'number', default: 16, min: 1, max: 99 },
      { key: 'dropHeart', label: 'Drops heart vessel', kind: 'bool', default: true },
      P.hidden(),
    ],
  },
  // ------------------------------------------------------------------ npcs
  {
    type: 'npc.person', name: 'Person', category: 'npc', description: 'Talks when you press the action button facing them.',
    icon: { sprite: 'npc.villager', anim: 'idle_down' }, size: { w: 12, h: 12 },
    props: [
      { key: 'sprite', label: 'Look', kind: 'enum', default: 'npc.villager', options: NPC_SPRITES },
      { key: 'name', label: 'Name', kind: 'string', default: '' },
      { key: 'dialogue', label: 'Dialogue', kind: 'dialogue', default: '' },
      { key: 'behavior', label: 'Behaviour', kind: 'enum', default: 'still', options: ['still', 'wander', 'pace'] },
      P.facing(), P.hidden(),
    ],
  },
  // ------------------------------------------------------------------ objects
  {
    type: 'obj.chest', name: 'Chest', category: 'object', description: 'Open facing it from below. Big chests need the big key.',
    icon: { sprite: 'obj.chest', anim: 'closed' }, size: { w: 16, h: 16 },
    props: [
      { key: 'item', label: 'Contents', kind: 'item', default: 'rupees' },
      { key: 'amount', label: 'Amount', kind: 'number', default: 1, min: 1, max: 999, help: 'Count for gems/bombs/arrows/keys; level for sword/gauntlet/boomerang.' },
      { key: 'big', label: 'Big chest', kind: 'bool', default: false },
      P.hidden(),
    ],
  },
  {
    type: 'obj.sign', name: 'Sign', category: 'object', description: 'Readable sign. Can be lifted and thrown.',
    icon: { sprite: 'obj.sign', anim: 'idle' }, size: { w: 16, h: 16 },
    props: [
      { key: 'dialogue', label: 'Dialogue', kind: 'dialogue', default: '' },
      { key: 'text', label: 'Text (if no dialogue)', kind: 'text', default: 'Welcome, traveller!' },
      P.hidden(),
    ],
  },
  {
    type: 'obj.door', name: 'Door', category: 'object', description: 'Doorway on a room wall. Place its centre on the wall edge. Doors with the same Link share their open state.',
    icon: { sprite: 'obj.doorNS', anim: 'locked_up' }, size: { w: 32, h: 16 },
    props: [
      { key: 'dir', label: 'Wall', kind: 'enum', default: 'up', options: DIR_OPTS, help: 'Which wall of the room the door sits on.' },
      { key: 'kind', label: 'Kind', kind: 'enum', default: 'locked', options: ['locked', 'bigKey', 'shutter', 'bombable', 'open'] },
      { key: 'link', label: 'Link', kind: 'string', default: '', help: 'Shared id with the matching door in the next room.' },
      { key: 'opensWhen', label: 'Shutter opens when', kind: 'enum', default: 'trigger', options: ['trigger', 'enemiesCleared', 'never'] },
      { key: 'closeOnEnter', label: 'Shutter closes on enter', kind: 'bool', default: false },
    ],
  },
  {
    type: 'obj.block', name: 'Push Block', category: 'object', description: 'Push by walking into it. Can hold down switches.',
    icon: { sprite: 'obj.block', anim: 'idle' }, size: { w: 16, h: 16 },
    props: [
      { key: 'pushes', label: 'Pushes', kind: 'enum', default: 'once', options: ['once', 'free'] },
      { key: 'dir', label: 'Direction', kind: 'enum', default: 'any', options: ['any', ...DIR_OPTS] },
      { key: 'heavy', label: 'Heavy (needs Stone Gauntlet)', kind: 'bool', default: false },
    ],
  },
  {
    type: 'obj.switch', name: 'Floor Switch', category: 'object', description: 'Pressed by standing on it or by a block/pot.',
    icon: { sprite: 'obj.switch', anim: 'up' }, size: { w: 16, h: 16 },
    props: [{ key: 'mode', label: 'Mode', kind: 'enum', default: 'once', options: ['once', 'hold', 'toggle'] }],
  },
  {
    type: 'obj.crystalSwitch', name: 'Crystal Switch', category: 'object', description: 'Strike it to swap which colour pegs are raised (per dungeon).',
    icon: { sprite: 'obj.crystalSwitch', anim: 'red' }, size: { w: 16, h: 16 }, props: [],
  },
  {
    type: 'obj.peg', name: 'Colour Peg', category: 'object', description: 'Raised (solid) when its colour is active.',
    icon: { sprite: 'obj.peg', anim: 'red_up' }, size: { w: 16, h: 16 },
    props: [{ key: 'color', label: 'Colour', kind: 'enum', default: 'red', options: ['red', 'blue'] }],
  },
  {
    type: 'obj.torch', name: 'Torch', category: 'object', description: 'Light it with the lantern. Lit torches light dark rooms.',
    icon: { sprite: 'obj.torch', anim: 'unlit' }, size: { w: 16, h: 16 },
    props: [
      { key: 'lit', label: 'Starts lit', kind: 'bool', default: false },
      { key: 'burnTime', label: 'Burn time (s, 0 = forever)', kind: 'number', default: 0, min: 0, max: 120 },
    ],
  },
  {
    type: 'obj.pot', name: 'Pot', category: 'object', description: 'Lift and throw. Breaks and drops its contents.',
    icon: { sprite: 'obj.pot', anim: 'idle' }, size: { w: 16, h: 16 },
    props: [{ key: 'contents', label: 'Contents', kind: 'enum', default: 'random', options: DROP_KINDS }],
  },
  {
    type: 'obj.pickup', name: 'Item', category: 'pickup', description: 'An item lying on the ground. Collected once.',
    icon: { sprite: 'pickup', anim: 'smallKey' }, size: { w: 12, h: 12 },
    props: [
      { key: 'item', label: 'Item', kind: 'item', default: 'smallKey' },
      { key: 'amount', label: 'Amount', kind: 'number', default: 1, min: 1, max: 999 },
      P.hidden(),
    ],
  },
  {
    type: 'obj.shopItem', name: 'Shop Item', category: 'pickup', description: 'Buy with the action button. Price shown below.',
    icon: { sprite: 'item', anim: 'bombs' }, size: { w: 16, h: 16 },
    props: [
      { key: 'item', label: 'Item', kind: 'item', default: 'bombs' },
      { key: 'amount', label: 'Amount', kind: 'number', default: 5, min: 1, max: 999 },
      { key: 'price', label: 'Price', kind: 'number', default: 30, min: 0, max: 999 },
    ],
  },
  // ------------------------------------------------------------------ markers
  {
    type: 'marker.warp', name: 'Warp', category: 'marker', description: 'Invisible zone that moves the player to another place (doors, stairs, caves).',
    icon: { sprite: 'editor.icons', anim: 'warp' }, size: { w: 16, h: 16 }, resizable: true,
    props: [
      { key: 'target', label: 'Destination', kind: 'warp', default: null },
      { key: 'transition', label: 'Transition', kind: 'enum', default: 'fade', options: ['fade', 'iris', 'none'] },
      { key: 'sound', label: 'Sound', kind: 'enum', default: 'stairs', options: ['stairs', 'door', 'none'] },
      { key: 'w', label: 'Width (tiles)', kind: 'number', default: 1, min: 1, max: 64 },
      { key: 'h', label: 'Height (tiles)', kind: 'number', default: 1, min: 1, max: 56 },
      { key: 'setRespawn', label: 'Set as respawn point', kind: 'bool', default: true, help: 'Continue/death returns here (entrances).' },
    ],
  },
  {
    type: 'marker.region', name: 'Region', category: 'marker', description: 'Named area for trigger "inRegion" conditions.',
    icon: { sprite: 'editor.icons', anim: 'region' }, size: { w: 16, h: 16 }, resizable: true,
    props: [
      { key: 'name', label: 'Name', kind: 'string', default: 'region' },
      { key: 'w', label: 'Width (tiles)', kind: 'number', default: 2, min: 1, max: 64 },
      { key: 'h', label: 'Height (tiles)', kind: 'number', default: 2, min: 1, max: 56 },
    ],
  },
];

const byType = new Map(ENTITY_TYPES.map((e) => [e.type, e]));

export function entityInfo(type: string): EntityTypeInfo | undefined {
  return byType.get(type);
}

/** Default props for a type (fresh object). */
export function defaultProps(type: string): Record<string, PropValue> {
  const info = byType.get(type);
  const out: Record<string, PropValue> = {};
  for (const p of info?.props ?? []) {
    const d = p.default;
    out[p.key] = d !== null && typeof d === 'object' ? { ...d } : d;
  }
  return out;
}

/** Read a prop with fallback to the catalog default, then to `fallback`. */
export function propOf<T extends PropValue>(inst: EntityInstance | null | undefined, key: string, fallback: T): T {
  if (inst && key in inst.props) {
    const v = inst.props[key];
    if (v !== undefined) return v as T;
  }
  const schema = inst ? byType.get(inst.type)?.props.find((p) => p.key === key) : undefined;
  if (schema && schema.default !== undefined) return schema.default as T;
  return fallback;
}

/** Whether instances of this type count toward 'enemiesCleared'. */
export function countsForClear(type: string): boolean {
  const info = byType.get(type);
  if (!info) return false;
  if (info.countsForClear !== undefined) return info.countsForClear;
  return info.category === 'enemy' || info.category === 'boss';
}

/** Editor/runtime footprint for an instance (markers use w/h props in tiles). */
export function footprint(inst: EntityInstance): { w: number; h: number } {
  const info = byType.get(inst.type);
  if (info?.resizable) {
    return { w: Number(propOf(inst, 'w', 1)) * 16, h: Number(propOf(inst, 'h', 1)) * 16 };
  }
  if (inst.type === 'obj.door') {
    const dir = String(propOf<PropValue>(inst, 'dir', 'up'));
    return dir === 'left' || dir === 'right' ? { w: 16, h: 32 } : { w: 32, h: 16 };
  }
  if (inst.type === 'obj.chest' && propOf(inst, 'big', false)) return { w: 32, h: 16 };
  return info?.size ?? { w: 16, h: 16 };
}

export const ITEM_OPTIONS = ITEM_IDS;
