// Song registry: one original composition per MusicId, built + parsed lazily and cached,
// so a notation or chord-chart typo silences one track instead of breaking app startup.
import type { MusicId } from '../../core/types';
import { parseSong, type Song, type SongSource } from '../mml';
import { boss } from './boss';
import { cave } from './cave';
import { dungeon } from './dungeon';
import { fileSelect } from './fileSelect';
import { forest } from './forest';
import { house } from './house';
import { gameover, victory } from './jingles';
import { overworld } from './overworld';
import { title } from './title';
import { village } from './village';

/** One source builder per MusicId (chord charts expand only when a builder runs). */
export const SONG_SOURCES: Readonly<Record<MusicId, () => SongSource>> = {
  title, overworld, village, forest, dungeon, cave, house, boss, victory, gameover, fileSelect,
};

const cache = new Map<MusicId, Song>();

/** The parsed song for a track (built on first use; throws for an unknown id or invalid notation). */
export function getSong(id: MusicId): Song {
  let song = cache.get(id);
  if (!song) {
    const build = SONG_SOURCES[id] as (() => SongSource) | undefined;
    if (!build) throw new Error(`unknown music id "${id}"`);
    song = parseSong(build(), id);
    cache.set(id, song);
  }
  return song;
}
