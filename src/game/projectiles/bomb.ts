// A placed bomb: fuse ~1.6 s (blinking faster near the end), liftable and
// throwable like a pot (it keeps ticking in the hero's hands), then explodes:
// every entity within BLAST_RADIUS takes a 'bomb' hit (the hero too), bombable
// tiles open for good, cuttable tiles are cut, the camera shakes and the pad
// rumbles (hard when the hero is close). A bomb resting over a pit or deep water
// is lost (it drops in / splashes) without a blast.
import type { Entity } from '../entity';
import type { GameServices, Hit, Renderer } from '../api';
import { normalize } from '../../core/math';
import { rumble } from '../../input/devices';
import { Carried } from './carried';
import { circleHitsRect, strike } from './targets';
import { bombOpenAt, cellsInCircle, cutTileAt } from './tiles';

/** Seconds from placing to the blast. */
export const BOMB_FUSE = 1.6;
/** Blast radius (px). */
export const BLAST_RADIUS = 20;
/** Blast damage: HP to enemies, half-hearts to the hero. */
export const BLAST_DAMAGE = 2;
/** A blast this close (px) to the hero rumbles the pad hard; farther away, a light tap. */
const RUMBLE_NEAR = 48;
/** The fuse anim runs this much faster in the last FAST_FUSE seconds. */
const FAST_FUSE = 0.5;
const FAST_FUSE_RATE = 3;

export class Bomb extends Carried {
  private fuse = BOMB_FUSE;
  private fuseT = 0;

  constructor(game: GameServices, x: number, y: number) {
    super(game, 'bomb', x, y);
    this.w = 10;
    this.h = 10;
    this.sprite = 'obj.bomb';
    this.anim = 'fuse';
    this.liftWeight = 0;
  }

  override update(dt: number): void {
    super.update(dt);
    if (this.mode === 'ground' && this.z <= 0 && this.sinks()) return;
    this.fuse -= dt;
    this.fuseT += this.fuse < FAST_FUSE ? dt * FAST_FUSE_RATE : dt;
    if (this.fuse <= 0) this.explode();
  }

  /** Blow up now (fuse out, or set off early). */
  explode(): void {
    if (this.dead) return;
    this.dead = true;
    const game = this.game;
    const cx = this.x;
    const cy = this.y - this.z;
    game.effect('fx.explosion', 'play', cx, cy, { above: true });
    game.audio.sfx('explode');
    game.camera.shake(0.35, 3);
    const hero = game.player;
    rumble(Math.hypot(hero.x - cx, hero.y - this.y) <= RUMBLE_NEAR ? 'heavy' : 'tap');
    this.blastEntities(cx, this.y);
    this.blastTiles(cx, this.y);
  }

  protected blow(): null {
    return null;
  }

  /** Thrown into something: stop and drop there. */
  protected onImpact(_target: Entity | null): void {
    this.dropHere();
  }

  protected onGround(): void {
    // Rests where it landed (unless that is a pit or water: see update); the fuse keeps burning.
  }

  protected drawBody(r: Renderer, x: number, y: number): void {
    r.drawSpriteAnim(this.sprite, this.anim, this.fuseT, x, y);
  }

  private blastEntities(cx: number, cy: number): void {
    const game = this.game;
    for (const e of [...game.entities]) {
      if (e === this || e.dead || !circleHitsRect(cx, cy, BLAST_RADIUS, e.hitbox())) continue;
      const away = e.x === cx && e.y === cy ? { x: 0, y: 1 } : normalize(e.x - cx, e.y - cy);
      const hit: Hit = { damage: BLAST_DAMAGE, kind: 'bomb', source: this, dx: away.x, dy: away.y };
      if (e === game.player) game.player.hurtPlayer(hit);
      else strike(e, hit);
    }
  }

  private blastTiles(cx: number, cy: number): void {
    const game = this.game;
    let opened = false;
    let cut = false;
    for (const c of cellsInCircle(cx, cy, BLAST_RADIUS)) {
      if (bombOpenAt(game, c.tx, c.ty)) opened = true;
      else if (cutTileAt(game, c.tx, c.ty)) cut = true;
    }
    if (opened) game.audio.sfx('secret');
    else if (cut) game.audio.sfx('cut');
  }
}
