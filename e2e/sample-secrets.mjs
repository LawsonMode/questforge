// The valley's optional side paths on #/playtest/sample: walk into Juno's shop
// through its door, get turned away without rupees, buy bombs, take the Keep
// Gate's west exit onto the Stonecrag terrace and read its sign, hop its one-way
// ledges (west and south), bomb the cracked cliff wall open, fetch the Piece of
// Heart from the hidden cave, check the mouth stays open, hop the lower ledge down
// to the meadow, climb the plateau stairs to the second piece, pick up the third
// in Whisperwood and open the fourth in the Deepwood clearing: a whole new heart.
// Screenshots land in e2e-out/sample-secrets/.
import { boxText, closeDialogues, px, snap, startSample, walkInto, warpTo } from './sample-opening.mjs';

const OW = 'ellendor';
const CAVE_MOUTH = { tx: 5, ty: 2 };
const CAVE_ENTRANCE_TILE = 20;

const bgTile = (t, tx, ty) => t.eval(([x, y]) => window.__qf.game.services.room.tile('bg', x, y), [tx, ty]);

async function shopping(t) {
  await warpTo(t, OW, 'ow_village', px(18), px(5), 'up');
  t.assert(await walkInto(t, 'ArrowUp', 'in_shop'), 'walked through the shop door');
  await t.shotCanvas('shop');

  await warpTo(t, 'ellendor_homes', 'in_shop', px(10), px(8), 'up');
  await t.press('KeyX');
  await t.wait(500);
  t.assert((await t.eval(() => window.__qf.game.state)) !== 'playing', 'no rupees: Juno explains the price');
  await t.shotCanvas('shop-too-poor');
  await closeDialogues(t);
  const broke = await t.eval(snap);
  t.assert(broke.rupees === 0 && !broke.items.heart, 'nothing bought without rupees');

  await t.eval(() => window.__qf.game.services.giveItem('rupees', 25));
  await warpTo(t, 'ellendor_homes', 'in_shop', px(5), px(8), 'up');
  await t.press('KeyX');
  await t.wait(500);
  await t.shotCanvas('shop-bought-bombs');
  await closeDialogues(t);
  const s = await t.eval(snap);
  t.assert(s.bombs === 5 && s.rupees === 5, `bought 5 bombs for 20 rupees (bombs ${s.bombs}, rupees ${s.rupees})`);

  await warpTo(t, 'ellendor_homes', 'in_shop', 128, px(10), 'down');
  t.assert(await walkInto(t, 'ArrowDown', 'ow_village'), 'walked out of the shop');
}

async function terraceAndBomb(t) {
  await warpTo(t, OW, 'ow_keep_gate', px(1), px(4), 'left');
  t.assert(await walkInto(t, 'ArrowLeft', 'ow_cliffs', 4000), 'walked west from the Keep Gate onto the Stonecrag terrace');
  await t.shotCanvas('terrace');
  await warpTo(t, OW, 'ow_cliffs', px(14), px(5), 'up');
  await t.press('KeyX');
  await t.wait(500);
  const sign = await boxText(t);
  t.assert(sign !== null && sign.includes('STONECRAG'), `the terrace sign names the cliffs (${sign})`);
  await closeDialogues(t);

  // Row 4: the ledge tile beside the mountain ground (nothing may block its landing).
  await warpTo(t, OW, 'ow_cliffs', px(9), px(4), 'left');
  await t.hold('ArrowLeft', 900);
  await t.wait(300);
  let s = await t.eval(snap);
  t.assert(s.x < 7 * 16, `hopped west over the ledge (x=${s.x})`);
  await t.hold('ArrowRight', 400);
  t.assert((await t.eval(snap)).x < 7 * 16, 'the ledge is one-way: no climbing back up');

  // The terrace's south ledge drops onto the grass strip in front of the plateau.
  await warpTo(t, OW, 'ow_cliffs', px(12), px(5), 'down');
  await t.hold('ArrowDown', 700);
  await t.wait(300);
  s = await t.eval(snap);
  t.assert(s.y > 6 * 16 && s.y < 8 * 16, `hopped the south ledge onto the strip (y=${s.y})`);
  await t.shotCanvas('terrace-south-ledge');
  await t.hold('ArrowUp', 400);
  t.assert((await t.eval(snap)).y > 6 * 16, 'no climbing back onto the terrace');

  t.assert((await bgTile(t, CAVE_MOUTH.tx, CAVE_MOUTH.ty)) !== CAVE_ENTRANCE_TILE, 'the cliff wall starts closed');
  await warpTo(t, OW, 'ow_cliffs', px(CAVE_MOUTH.tx), px(CAVE_MOUTH.ty + 1), 'up');
  await t.eval(() => { window.__qf.game.services.save.equipped = 'bombs'; });
  await t.press('KeyC');
  await t.wait(150);
  await t.hold('ArrowDown', 450);
  await t.wait(1900);
  await t.shotCanvas('wall-bombed');
  s = await t.eval(snap);
  t.assert((await bgTile(t, CAVE_MOUTH.tx, CAVE_MOUTH.ty)) === CAVE_ENTRANCE_TILE, 'the bomb blew the cave mouth open');
  t.assert(s.bombs === 4, `one bomb spent (bombs ${s.bombs})`);
}

async function hiddenCave(t) {
  await warpTo(t, OW, 'ow_cliffs', px(CAVE_MOUTH.tx), px(CAVE_MOUTH.ty + 1) + 4, 'up');
  t.assert(await walkInto(t, 'ArrowUp', 'in_cave'), 'walked into the hidden cave');
  await t.wait(300);
  await t.shotCanvas('cave');

  await warpTo(t, 'ellendor_homes', 'in_cave', px(7), px(5), 'up');
  await t.press('KeyX');
  await t.wait(600);
  await t.shotCanvas('heart-piece');
  await closeDialogues(t);
  t.assert((await t.eval(snap)).heartPieces === 1, 'the cave chest held a Heart Shard');

  await warpTo(t, 'ellendor_homes', 'in_cave', 128, px(12), 'down');
  t.assert(await walkInto(t, 'ArrowDown', 'ow_cliffs'), 'walked back out of the cave');
  const s = await t.eval(snap);
  t.assert(Math.abs(s.x - px(CAVE_MOUTH.tx)) < 12 && s.y > px(CAVE_MOUTH.ty), `outside the cave mouth (${s.x}, ${s.y})`);
  t.assert((await bgTile(t, CAVE_MOUTH.tx, CAVE_MOUTH.ty)) === CAVE_ENTRANCE_TILE, 'the cave mouth stays open');
}

async function ledgeAndPlateau(t) {
  // Column 3: the ledge's west end, clear of the sign that once stood on its landing.
  await warpTo(t, OW, 'ow_cliffs', px(3), px(10), 'down');
  t.assert(await walkInto(t, 'ArrowDown', 'ow_meadow'), 'hopped the lower ledge and walked on into the meadow');

  await warpTo(t, OW, 'ow_cliffs', px(11), px(12), 'up');
  await t.hold('ArrowUp', 450);
  await t.wait(200);
  const y = (await t.eval(snap)).y;
  t.assert(y < px(11), `climbed the plateau stairs (y=${y})`);
  await warpTo(t, OW, 'ow_cliffs', px(12), px(10), 'up');
  await t.press('KeyX');
  await t.wait(500);
  await t.shotCanvas('plateau-chest');
  await closeDialogues(t);
  t.assert((await t.eval(snap)).heartPieces === 2, 'the plateau chest held the second Heart Shard');
}

async function forestPieces(t) {
  await warpTo(t, OW, 'ow_whisperwood', px(4), px(12), 'left');
  await t.hold('ArrowLeft', 500);
  await t.wait(400);
  await t.shotCanvas('whisperwood-piece');
  await closeDialogues(t);
  t.assert((await t.eval(snap)).heartPieces === 3, 'a Heart Shard hid behind the Whisperwood tree');

  const before = (await t.eval(snap)).maxHp;
  await warpTo(t, OW, 'ow_deepwood', px(10), px(4), 'up');
  await t.press('KeyX');
  await t.wait(600);
  await t.shotCanvas('deepwood-piece');
  await closeDialogues(t);
  const s = await t.eval(snap);
  t.assert(s.heartPieces === 0 && s.maxHp === before + 2, `four pieces made a new heart (max hp ${before} -> ${s.maxHp})`);
}

export default async function (t) {
  await startSample(t);
  await t.eval(() => {
    const sv = window.__qf.game.services;
    sv.giveItem('sword', 1);
    sv.setFlag('gotSword', true);
    // Scripted walking ignores the snakes and spitters on the cliffs.
    sv.debug.invincible = true;
  });
  await shopping(t);
  await terraceAndBomb(t);
  await hiddenCave(t);
  await ledgeAndPlateau(t);
  await forestPieces(t);
}
