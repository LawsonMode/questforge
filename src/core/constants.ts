// Global engine constants. SNES-era geometry: 256x224 screen, 16x16 tiles.

/** Tile edge length in pixels. */
export const TILE = 16;
/** Native render resolution (SNES). */
export const SCREEN_W = 256;
export const SCREEN_H = 224;
/** One "screen" of a room, in tiles. Rooms are gw x gh screens. */
export const SCREEN_COLS = 16;
export const SCREEN_ROWS = 14;
/** Maximum room size in screens along each axis. */
export const MAX_ROOM_SCREENS = 4;

/** Fixed simulation rate. Entity update() always receives dt = STEP (seconds). */
export const FPS = 60;
export const STEP = 1 / FPS;

/** Palettes are SNES-style: 16 entries, index 0 transparent. */
export const PALETTE_SIZE = 16;

export const PROJECT_FORMAT = 'questforge';
export const PROJECT_VERSION = 1;
export const SAVE_VERSION = 1;
export const SAVE_SLOTS = 3;

/** Health is stored in half-heart units. */
export const HP_PER_HEART = 2;
export const MAX_HEARTS = 20;
export const MAX_RUPEES = 999;
export const DEFAULT_MAX_MAGIC = 32;
export const DEFAULT_MAX_BOMBS = 10;
export const DEFAULT_MAX_ARROWS = 30;

/** Id of the built-in sample adventure (never stored; regenerated from code). */
export const SAMPLE_PROJECT_ID = 'sample';
