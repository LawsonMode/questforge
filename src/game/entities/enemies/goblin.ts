// Spear Goblin (enemy.goblin): a sturdy brute that walks the four directions
// and, when lined up with the hero within ~6 tiles, plants its feet in the
// throw pose and hurls a spear the shield can block. A hit breaks its stance.
import type { Dir, EntityInstance } from '../../../core/types';
import type { GameServices } from '../../api';
import { DIR_VEC } from '../../../core/math';
import { TILE } from '../../../core/constants';
import { registerEntity } from '../../registry';
import { Enemy, lineOfSight, rowColumnDir } from './common';

const HP = 4;
const CONTACT_DAMAGE = 2;
const WALK_SPEED = 30;
const THROW_RANGE = 6 * TILE;
/** Cross-axis tolerance (px) for "lined up". */
const ALIGN_TOL = 8;
/** Throw pose held before the spear leaves, and the standing pause after (s). */
const AIM_TIME = 0.3;
const RECOVER_TIME = 0.4;
const THROW_COOLDOWN = 1.5;
/** After taking a hit it can't start another throw for this long (s). */
const STAGGER_COOLDOWN = 0.8;
const SPEAR_SPEED = 150;
const SPEAR_DAMAGE = 2;
/** The spear appears this far in front of the goblin's centre, at about the raised fist's height (px). */
const MUZZLE = 10;
const SPEAR_HEIGHT = 10;

type GoblinState = 'walk' | 'aim' | 'recover';

/** The spear goblin. */
export class Goblin extends Enemy {
  private st: GoblinState = 'walk';
  private stT = 0;
  private cooldown = 0;

  constructor(game: GameServices, inst: EntityInstance | null) {
    super(game, inst, 'enemy.goblin');
    this.sprite = 'enemy.goblin';
    this.hp = HP;
    this.maxHp = HP;
    this.touchDamage = CONTACT_DAMAGE;
    this.playDir('walk');
  }

  /** Current behaviour phase (tests & debugging). */
  get phase(): GoblinState {
    return this.st;
  }

  protected think(dt: number): void {
    this.stT += dt;
    this.cooldown = Math.max(0, this.cooldown - dt);
    switch (this.st) {
      case 'walk':
        // Recoiling from a hit: it slides back still facing its attacker.
        if (this.kbTime <= 0) this.walk(dt);
        break;
      case 'aim':
        if (this.stT >= AIM_TIME) this.throwSpear();
        break;
      case 'recover':
        // Standing pose while the spear flies (the throw pose would show a second raised spear).
        this.holdFrame(`walk_${this.facing}`);
        if (this.stT >= RECOVER_TIME) this.enter('walk');
        break;
    }
  }

  /** Getting hit breaks the stance and delays the next throw. */
  protected override onHurt(): void {
    this.cooldown = Math.max(this.cooldown, STAGGER_COOLDOWN);
    if (this.st !== 'walk') this.enter('walk');
  }

  private walk(dt: number): void {
    const line = this.cooldown <= 0 ? this.spotHero() : null;
    if (line) {
      this.facing = line;
      this.enter('aim');
      return;
    }
    this.wander(dt, WALK_SPEED);
    this.playDir('walk');
  }

  private spotHero(): Dir | null {
    if (!this.heroTargetable()) return null;
    const p = this.hero;
    const line = rowColumnDir(this, p, 'both', THROW_RANGE, ALIGN_TOL);
    return line && lineOfSight(this.game.room, this.x, this.y, p.x, p.y) ? line : null;
  }

  private throwSpear(): void {
    const v = DIR_VEC[this.facing];
    const at = this.ahead(MUZZLE);
    this.shoot({
      sprite: 'proj.spear', x: at.x, y: at.y, vx: v.x * SPEAR_SPEED, vy: v.y * SPEAR_SPEED,
      damage: SPEAR_DAMAGE, blockable: true, size: 8, height: SPEAR_HEIGHT,
    });
    this.game.audio.sfx('throw');
    this.cooldown = THROW_COOLDOWN;
    this.enter('recover');
  }

  private enter(st: GoblinState): void {
    this.st = st;
    this.stT = 0;
    if (st === 'aim') this.playDir('throw');
    else if (st === 'recover') this.holdFrame(`walk_${this.facing}`);
    else this.playDir('walk');
  }
}

registerEntity('enemy.goblin', (game, inst) => new Goblin(game, inst));
