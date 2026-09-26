// Per-tile fingerprints of everything that decides how tiles look and collide
// (pixels, palette colours, collision fields). Undo can restore any of these
// without an 'assets' event, so views diff fingerprints to find the tiles whose
// cached rasters are stale, and repaint only the cells showing them.
import type { Project } from '../../core/types';

interface ArtState {
  /** Palette id -> colours. */
  palettes: Map<string, string>;
  /** Tile id -> [palette id, fingerprint of pixels and collision]. */
  tiles: Map<number, [palette: string, stamp: string]>;
}

function snapshot(project: Project): ArtState {
  const palettes = new Map(project.palettes.map((p) => [p.id, p.colors.join(',')] as const));
  const tiles = new Map<number, [string, string]>();
  for (const t of project.tiles) {
    tiles.set(t.id, [t.palette, `${t.collision}:${t.solidMask ?? ''}:${t.ledgeDir ?? ''}|${t.frames.join('|')}`]);
  }
  return { palettes, tiles };
}

/** Ids of tiles that were added, removed or changed between two snapshots (including via their palette). */
function diff(a: ArtState, b: ArtState): number[] {
  const palettes = new Set<string>();
  for (const [id, colors] of b.palettes) if (a.palettes.get(id) !== colors) palettes.add(id);
  for (const id of a.palettes.keys()) if (!b.palettes.has(id)) palettes.add(id);
  const out: number[] = [];
  for (const [id, [palette, stamp]] of b.tiles) {
    const old = a.tiles.get(id);
    if (!old || old[0] !== palette || old[1] !== stamp || palettes.has(palette)) out.push(id);
  }
  for (const id of a.tiles.keys()) if (!b.tiles.has(id)) out.push(id);
  return out;
}

/** Remembers the tile art last seen and reports what changed since. */
export class ArtWatch {
  private last: ArtState;

  constructor(private readonly project: () => Project) {
    this.last = snapshot(project());
  }

  /** Ids of the tiles whose art or collision changed since the last call (or reset); empty when none did. */
  changedTiles(): number[] {
    const next = snapshot(this.project());
    const changed = diff(this.last, next);
    this.last = next;
    return changed;
  }

  /** Record the current art as seen (after a full rebuild). */
  reset(): void {
    this.last = snapshot(this.project());
  }
}
