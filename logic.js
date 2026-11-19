// Round 17 rules (owner 2026-11-18T16:51Z: rounds, he looks hurt round by round, and between rounds you change your bag with
// easy cards; 2026-11-18T19:42Z: no timer, you always go first; 2026-11-18T22:01Z "lets not do the slow motion just make it a
// stop motion then" and "i dont like the block its making it more complicated actually and not fun to play lets revert that
// part to old version": no blue GUARD tile any more, his punch lands in full every exchange he is still standing, as in round
// 14). Pure rules, shared by the page (match.js) and the balance sim (keep/rt/source/game_sim.mjs). No DOM here. Your moves
// (levels, how many of each in the bag) and your glove level come from the Gym and Gear screens (meta.js) through newFight(setup).
//
// A fight is 3 rounds of 3 exchanges. One exchange:
//   he throws a punch you can see (JAB, HOOK or HEAVY with its damage); the picture stops with his fist in the air (stop
//   motion) and waits for you
//   PULL draws one tile from your bag (the reel spins PULL_MS; a tap while it spins slams it to a stop):
//     red punch -> next slot of your combo row (each slot has the glove's multiplier)
//     black     -> a lamp (a double black lights both); 2 lamps = BUST: your row is lost and his punch lands
//   PUNCH (any time, automatic when the row is full or the bag is empty): your row hits him first; if he is still up, his
//   punch lands in full.
// After rounds 1 and 2 you sit in the corner: a little health back, his next round's punches shown, and 1 of 3 cards
// (add a punch, train a punch, cut a black) for this fight. No KO after round 3: the judges score each round 10-9.

export const ROUNDS = 3, EXCH = 3, LAMPS = 2;
export const PULL_MS = 340;           // one pull: the reel spins and the tile flies this long (no timer, so it is only pace)

// ---------------- your moves (the Gym levels them; level 3 switches on the star trait) ----------------
export const MOVES = {
  jab:   { name: 'JAB',   icon: 'jab',      base: 2, star: { id: 'quick',   name: 'QUICK',   icon: 'energy',    line: 'Spins twice as fast' } },
  hook:  { name: 'HOOK',  icon: 'hook',     base: 3, star: { id: 'breaker', name: 'BREAKER', icon: 'impact',    line: 'Goes through his guard' } },
  upper: { name: 'UPPER', icon: 'uppercut', base: 4, star: { id: 'stun',    name: 'STUN',    icon: 'hourglass', line: 'His next punch is slower' } },
};
export const MOVE_IDS = ['jab', 'hook', 'upper'];
export const STAR_LV = 3, MAX_LV = 5;
export const LV_ADD = [0, 1, 1, 2, 3];   // level 3 gives the star trait instead of more power
export const moveVal = (k, lv) => MOVES[k].base + LV_ADD[Math.max(1, Math.min(MAX_LV, lv)) - 1];
export const hasStar = lv => lv >= STAR_LV;
// how many of a move fit in your bag (UPPER copies open up with levels), and the bag's size limits
export function maxCopies(k, lv) { return k === 'jab' ? 5 : k === 'hook' ? 4 : Math.min(3, lv); }
export const BAG = { min: 8, cap: 12 };
export const START_MOVES = { jab: { lv: 1, n: 4 }, hook: { lv: 1, n: 3 }, upper: { lv: 1, n: 1 } };

// ---------------- his punches ----------------
// ms: how long his throw takes at full speed before the picture stops with his fist in the air (stop motion, r17); looks
// only, there is no timer
export const HIS = {
  jab:   { name: 'JAB',   icon: 'his-jab',   ms: 240 },
  hook:  { name: 'HOOK',  icon: 'his-hook',  ms: 300 },
  heavy: { name: 'HEAVY', icon: 'his-heavy', ms: 360 },
};

// ---------------- gloves (Gear): the row rule. Level 4 is the evolved glove ----------------
export const GLOVES = {
  heavy: {
    name: 'HEAVY', icon: 'g-heavy', line: 'Short row, every slot x2',
    lv: [{ mult: [2, 2, 2] }, { mult: [2, 2, 3] }, { mult: [2, 3, 3] }],
    evo: { name: 'IRON', icon: 'g-iron', mult: [2, 3, 3, 4], line: 'A 4th slot: x4' },
  },
  rapid: {
    name: 'RAPID', icon: 'g-rapid', line: 'Longer row, small hits',
    lv: [{ mult: [1, 1, 2, 3], spin: .6 }, { mult: [1, 2, 2, 3], spin: .6 }, { mult: [2, 2, 2, 3], spin: .55 }],
    evo: { name: 'STORM', icon: 'g-storm', mult: [2, 2, 3, 3, 3], spin: .5, dodgeFrom: 3, line: 'After 3 punches, blacks miss' },
  },
  counter: {
    name: 'COUNTER', icon: 'g-counter', line: 'Catch the black that busts you',
    // round 16's rows; ?bal=r17 swaps in the rebalance (see "balance sets" below)
    lv: [{ mult: [1, 1, 1], catches: 1 }, { mult: [1, 1, 2], catches: 1 }, { mult: [1, 2, 2], catches: 1 }],
    evo: { name: 'MIRROR', icon: 'g-mirror', mult: [2, 2, 2], catches: 1, everyExchange: true, line: 'Catch in every exchange' },
  },
};
export const GLOVE_IDS = ['heavy', 'rapid', 'counter'];
export const GLOVE_MAX = 4;
export function gloveOf(id, lvl) {
  const G = GLOVES[id], evo = lvl >= GLOVE_MAX, b = evo ? G.evo : G.lv[Math.max(1, Math.min(3, lvl)) - 1];
  return { id, lvl, evo, name: evo ? G.evo.name : G.name, icon: evo ? G.evo.icon : G.icon,
    mult: b.mult, slots: b.mult.length, spin: b.spin || 1, catches: b.catches || 0, everyExchange: !!b.everyExchange, dodgeFrom: b.dodgeFrom || 0 };
}

// ---------------- rivals: a circuit is 5 rivals, the 5th is the title fight ----------------
// plan[r] = his three punches in round r (shown before the round and in the corner, so you can plan your bag)
// round 16's damage; ?bal=r17 swaps in the rebalance (see "balance sets" below)
export const FOES = [
  { id: 'rookie', name: 'ROOKIE',    hp: 38, blacks: 3, dbl: 0, guard: 0, dmg: { jab: 3, hook: 5, heavy: 7 },
    plan: [['jab', 'jab', 'hook'], ['jab', 'hook', 'hook'], ['hook', 'jab', 'heavy']] },
  { id: 'speedy', name: 'SPEEDY',    hp: 44, blacks: 3, dbl: 0, guard: 0, fast: .75, dmg: { jab: 4, hook: 5, heavy: 7 },
    plan: [['jab', 'jab', 'jab'], ['jab', 'hook', 'jab'], ['jab', 'jab', 'hook']] },
  { id: 'iron',   name: 'IRONHEAD',  hp: 50, blacks: 3, dbl: 0, guard: 4, dmg: { jab: 3, hook: 6, heavy: 8 },
    plan: [['hook', 'jab', 'hook'], ['hook', 'hook', 'jab'], ['heavy', 'hook', 'hook']] },
  { id: 'bomber', name: 'BOMBER',    hp: 54, blacks: 3, dbl: 1, guard: 0, dmg: { jab: 3, hook: 6, heavy: 10 },
    plan: [['hook', 'heavy', 'jab'], ['heavy', 'hook', 'heavy'], ['heavy', 'heavy', 'hook']] },
  { id: 'champ',  name: 'THE CHAMP', hp: 66, blacks: 4, dbl: 1, guard: 2, boss: true, dmg: { jab: 4, hook: 6, heavy: 10 },
    plan: [['jab', 'hook', 'heavy'], ['hook', 'heavy', 'jab'], ['heavy', 'hook', 'heavy']] },
];
export const CIRCUITS = [
  { n: 1, name: 'STREET GYM', hpK: 1, dmgAdd: 0, names: ['ROOKIE', 'SPEEDY', 'IRONHEAD', 'BOMBER', 'THE CHAMP'] },
  { n: 2, name: 'DOCK YARD', hpK: 1.5, dmgAdd: 2, names: ['DOCKHAND', 'QUICK HOOKS', 'ANCHOR', 'CRANE', 'THE ADMIRAL'] },
  { n: 3, name: 'NEON CLUB', locked: true }, { n: 4, name: 'STEEL CAGE', locked: true }, { n: 5, name: 'CHAMPION ARENA', locked: true },
];
export function foeOf(i, circuit = 1) {
  const f = FOES[i], C = CIRCUITS[circuit - 1], dmg = {};
  for (const k in f.dmg) dmg[k] = f.dmg[k] + C.dmgAdd;
  return { ...f, name: C.names[i], hp: Math.round(f.hp * C.hpK), dmg, circuit };
}
export const TUNE = { maxHp: 40, corner: 6, koBonus: 8, cutMin: 1, stunK: 1.4 };   // stunK: his punch after a STUN uppercut

// ---------------- balance sets (round 17) ----------------
// The owner asked for the guard tile to go (2026-11-18T22:01Z); numbers were not part of that. 'r16' (the default) keeps round 16's
// numbers exactly. With no guard his punch lands in full every exchange, so in the sim COUNTER loses to IRONHEAD's and THE CHAMP's
// armour (1% and 2%) and circuit 2 ANCHOR drops to 32% at start. 'r17' (?bal=r17) is the agent's rebalance for that, NOT approved,
// waiting for the owner's pick: COUNTER one step up each level (112/122/222, MIRROR 223), BOMBER heavy 9, THE CHAMP hook 5 and
// heavy 9, circuit 2 adds +1 a punch.
export const BAL_SETS = {
  r16: { counter: [[1, 1, 1], [1, 1, 2], [1, 2, 2]], mirror: [2, 2, 2], bomber: { heavy: 10 }, champ: { hook: 6, heavy: 10 }, c2: 2 },
  r17: { counter: [[1, 1, 2], [1, 2, 2], [2, 2, 2]], mirror: [2, 2, 3], bomber: { heavy: 9 }, champ: { hook: 5, heavy: 9 }, c2: 1 },
};
export const BAL = { set: 'r16' };
export function useBalance(set) {
  const b = BAL_SETS[set]; if (!b) throw new Error('unknown balance set ' + set);
  GLOVES.counter.lv.forEach((l, i) => { l.mult = b.counter[i].slice(); }); GLOVES.counter.evo.mult = b.mirror.slice();
  Object.assign(FOES.find(x => x.id === 'bomber').dmg, b.bomber); Object.assign(FOES.find(x => x.id === 'champ').dmg, b.champ);
  CIRCUITS[1].dmgAdd = b.c2; BAL.set = set;
}
if (typeof location !== 'undefined' && new URLSearchParams(location.search).get('bal') === 'r17') useBalance('r17');

// ---------------- trait sets (round 16) ----------------
// Three traits were about the timer: the QUICK jab spun twice as fast, a STUN uppercut made his next punch slower, SPEEDY's
// punches came faster. With the timer gone (owner 2026-11-18T19:42Z) they only change pace. 'old' (the default) keeps them
// exactly as they were. 'new' (?traits=new) is the agent's replacement, NOT approved, waiting for the owner's pick:
// STEADY jab puts a lit lamp out, STUN halves his next punch, SPEEDY hits twice when you bust.
export const TRAIT_SETS = {
  old: { jab: { ...MOVES.jab.star }, upper: { ...MOVES.upper.star }, speedy: { fast: .75 }, stunK: 1.4 },
  new: { jab: { id: 'steady', name: 'STEADY', icon: 'heal', line: 'A jab puts out a lamp' },
         upper: { id: 'stun', name: 'STUN', icon: 'stars', line: 'His next punch: half damage' }, speedy: { bustX: 2 }, stunK: .5 },
};
export const TRAITS = { set: 'old' };
export function useTraits(set) {
  const s = TRAIT_SETS[set]; if (!s) throw new Error('unknown trait set ' + set);
  MOVES.jab.star = { ...s.jab }; MOVES.upper.star = { ...s.upper };
  const sp = FOES.find(x => x.id === 'speedy'); delete sp.fast; delete sp.bustX; Object.assign(sp, s.speedy);
  TUNE.stunK = s.stunK; TRAITS.set = set;
}
if (typeof location !== 'undefined' && new URLSearchParams(location.search).get('traits') === 'new') useTraits('new');
const steadyOn = f => TRAITS.set === 'new' && starOn(f, 'jab');   // 'new' STEADY jab
const quickOn = f => TRAITS.set === 'old' && starOn(f, 'jab');    // 'old' QUICK jab (pace only now)

// ---------------- random ----------------
export function rngFrom(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function shuffle(arr, rng) { for (let i = arr.length - 1; i > 0; i--) { const j = (rng() * (i + 1)) | 0; [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; }

// ---------------- a fight ----------------
// setup: { foe (index), circuit, glove, glvl, moves: { jab: { lv, n }, ... }, bonusHp, script }
// script (tutorial): per exchange, the first tiles in draw order, e.g. [['jab','hook'], ['hook','jab'], ...]; the rest of
// the pile stays random under them
export function newFight(seed = (Math.random() * 1e9) | 0, setup = {}) {
  const moves = setup.moves || START_MOVES, maxHp = TUNE.maxHp + (setup.bonusHp || 0);
  const f = { seed, rng: rngFrom(seed), foe: foeOf(setup.foe || 0, setup.circuit || 1), glove: setup.glove || 'heavy', glvl: setup.glvl || 1,
    moves: JSON.parse(JSON.stringify(moves)), train: { jab: 0, hook: 0, upper: 0 }, bag: [], nextId: 1, cut: 0,
    hp: maxHp, maxHp, round: 1, ex: -1, x: null, rounds: [{ dealt: 0, taken: 0 }], script: setup.script || null, nEx: 0, stunNext: false,
    stats: { busts: 0, punches: 0, best: 0, uppers: 0, catches: 0, dealt: 0, taken: 0, exchanges: 0 }, picks: [], over: null };
  f.foe.hpLeft = f.foe.hp;
  for (const k of MOVE_IDS) for (let i = 0; i < (f.moves[k]?.n || 0); i++) addTile(f, k);   // an old save's GUARD is not a move any more: skipped
  f.catchesLeft = gloveNow(f).catches;
  return f;
}
function addTile(f, k) { const t = { id: f.nextId++, k }; f.bag.push(t); return t; }
export const tileVal = (f, k) => moveVal(k, f.moves[k]?.lv || 1) + (f.train[k] || 0);
export const starOn = (f, k) => hasStar(f.moves[k]?.lv || 1);
export const gloveNow = f => gloveOf(f.glove, f.glvl);
export function foeBlacks(f) {
  let b = f.foe.blacks, d = f.foe.dbl, c = f.cut;
  while (c > 0 && d > 0 && b + d > TUNE.cutMin) { d--; c--; }   // a cut takes the double black first
  while (c > 0 && b > 0 && b + d > TUNE.cutMin) { b--; c--; }
  return { blacks: b, dbl: d };
}
// his punch for exchange e of round r
export function hisPunch(f, r = f.round, e = f.ex) {
  const k = f.foe.plan[r - 1][e], base = HIS[k];
  return { k, name: base.name, icon: base.icon, dmg: f.foe.dmg[k], ms: Math.round(base.ms * (f.foe.fast || 1)) };   // 'old' SPEEDY: throws faster (looks only)
}

export function startExchange(f) {
  f.ex++;
  const g = gloveNow(f), his = hisPunch(f), { blacks, dbl } = foeBlacks(f);
  let pile = f.bag.map(t => ({ ...t, red: true, v: tileVal(f, t.k) }));
  for (let i = 0; i < blacks; i++) pile.push({ id: -1 - i, k: 'black', lamps: 1 });
  for (let i = 0; i < dbl; i++) pile.push({ id: -100 - i, k: 'dbl', lamps: 2 });
  shuffle(pile, f.rng);
  const sc = f.script?.[f.nEx];
  if (sc) {   // tutorial: these come out first, in this order (the pile pops from the end)
    const top = [];
    for (const k of sc) { const i = pile.findIndex(t => t.k === k); if (i >= 0) top.push(pile.splice(i, 1)[0]); }
    pile = pile.concat(top.reverse());
  }
  if (g.everyExchange) f.catchesLeft = g.catches;
  const half = f.stunNext && TRAITS.set === 'new', slow = f.stunNext && TRAITS.set === 'old';
  const dmg = half ? Math.ceil(his.dmg * TUNE.stunK) : his.dmg;   // 'new' STUN uppercut: this punch does half
  const ms = slow ? Math.round(his.ms * TUNE.stunK) : his.ms;      // 'old' STUN uppercut: he throws it slower (looks only)
  f.x = { his: { ...his, dmg, ms, full: his.dmg, stunned: f.stunNext }, pile, combo: [], lamps: 0, over: false };
  f.stunNext = false; f.nEx++; f.stats.exchanges++;
  return f.x;
}
// what is still in the bag this exchange (shown on the machine, so the odds are visible)
export function bagLeft(f) {
  let red = 0, black = 0, dbl = 0;
  for (const t of f.x.pile) { if (t.red) red++; else if (t.k === 'dbl') dbl++; else black++; }
  return { red, black, dbl, total: f.x.pile.length };
}
// the whole bag with this fight's blacks (corner and Gym: the odds bar)
export function bagMix(f) {
  const { blacks, dbl } = foeBlacks(f), red = f.bag.length;
  return { red, black: blacks, dbl, total: red + blacks + dbl };
}

// PULL one tile. `auto` = the page must PUNCH now (row full or bag empty); 'bust' = the exchange is lost (call bustHit).
export function pull(f) {
  const X = f.x, g = gloveNow(f);
  if (X.over || !X.pile.length) throw new Error('pull after exchange end');
  const t = X.pile.pop(), empty = !X.pile.length;
  if (t.red) {
    const slot = X.combo.length; X.combo.push({ ...t, m: g.mult[slot] });
    const cool = t.k === 'jab' && X.lamps > 0 && steadyOn(f);   // 'new' STEADY jab: one lit lamp goes out
    if (cool) X.lamps--;
    return { t: 'red', tile: t, slot, m: g.mult[slot], cool, lamps: X.lamps, auto: X.combo.length >= g.slots || empty };
  }
  const lamps0 = X.lamps;
  if (g.dodgeFrom && X.combo.length >= g.dodgeFrom) return { t: 'dodge', tile: t, lamps: X.lamps, lamps0, auto: empty && X.combo.length > 0, empty };
  if (lamps0 + t.lamps >= LAMPS && f.catchesLeft > 0) {            // COUNTER glove: catch the black that would bust you
    f.catchesLeft--; f.stats.catches++;
    X.lamps = LAMPS - 1;
    const slot = X.combo.length, made = { id: 'c' + f.stats.catches, k: 'caught', v: X.his.dmg, red: true };
    X.combo.push({ ...made, m: g.mult[slot] });
    return { t: 'catch', tile: t, made, slot, m: g.mult[slot], lamps: X.lamps, lamps0, auto: X.combo.length >= g.slots || empty };
  }
  X.lamps = Math.min(LAMPS, lamps0 + t.lamps);
  if (X.lamps >= LAMPS) { X.over = true; f.stats.busts++; return { t: 'bust', tile: t, lamps: X.lamps, lamps0, lost: X.combo.slice() }; }
  return { t: 'black', tile: t, lamps: X.lamps, lamps0, auto: empty && X.combo.length > 0, empty };
}
// how long the reel spins for this tile (pace only; 'old' QUICK jab spins twice as fast)
export const pullMs = (f, tile) => Math.round(PULL_MS * gloveNow(f).spin * (tile?.k === 'jab' && quickOn(f) ? .5 : 1));

// your row's damage if you punched now (his guard, BREAKER hooks) and what his punch would do (all of it, if he is still up)
export function preview(f) {
  const X = f.x, guard = f.foe.guard || 0, brk = starOn(f, 'hook');
  const parts = X.combo.map(c => ({ v: c.v, m: c.m, d: c.v * c.m, k: c.k, thru: brk && c.k === 'hook' }));
  const raw = parts.reduce((a, p) => a + p.d, 0), soft = parts.reduce((a, p) => a + (p.thru ? 0 : p.d), 0);
  const blocked = Math.min(guard, soft), total = raw - blocked;
  return { parts, raw, guard, blocked, total, taken: X.his.dmg };
}
// how the row's total lands punch by punch (the page shows these numbers): his guard takes from the soft parts first
// (a BREAKER hook goes through)
export function split(p) {
  let gl = p.blocked; const base = p.parts.map(q => { if (q.thru) return { d: q.d, a: 0 }; const a = Math.min(gl, q.d); gl -= a; return { d: q.d - a, a }; });
  return { shown: base.map(b => b.d), absorbed: base.map(b => b.a) };
}
// PUNCH: your row first, then (if he is still up) his punch in full. Returns what happened, in order, for the page to play.
export function commit(f) {
  const X = f.x, p = preview(f), R = f.rounds[f.round - 1];
  X.over = true;
  const out = { ...p, ...split(p), dealt: 0, ko: false, down: false, taken: 0 };
  const you = () => {
    if (!X.combo.length) return;
    let hp = f.foe.hpLeft;
    for (let i = 0; i < p.parts.length; i++) {   // punch by punch, as the page plays it: the one that knocks him out ends the row
      const d = Math.min(out.shown[i], hp); hp -= d; f.stats.punches++;
      if (p.parts[i].k === 'upper' && d > 0) f.stats.uppers++;
      if (d > 0 && hp <= 0) break;
    }
    out.dealt = Math.min(f.foe.hpLeft, p.total); f.foe.hpLeft -= out.dealt; R.dealt += out.dealt; f.stats.dealt += out.dealt;
    f.stats.best = Math.max(f.stats.best, p.total);
    if (starOn(f, 'upper') && X.combo.some(c => c.k === 'upper')) f.stunNext = true;
    if (f.foe.hpLeft <= 0) out.ko = true;
  };
  const him = () => {
    if (out.ko) return;
    out.taken = p.taken; f.hp = Math.max(0, f.hp - p.taken); R.taken += p.taken; f.stats.taken += p.taken;
    if (f.hp <= 0) out.down = true;
  };
  you(); him();
  out.hp = f.hp; out.foeHp = f.foe.hpLeft;
  if (out.ko) f.over = { win: true, by: 'ko', round: f.round }; else if (out.down) f.over = { win: false, by: 'ko', round: f.round };
  return out;
}
// a bust: the row is gone, his punch lands in full ('new' SPEEDY: twice)
export function bustHit(f) {
  const X = f.x, R = f.rounds[f.round - 1], dmg = X.his.dmg * (f.foe.bustX || 1);
  f.hp = Math.max(0, f.hp - dmg); R.taken += dmg; f.stats.taken += dmg;
  if (f.hp <= 0) f.over = { win: false, by: 'ko', round: f.round };
  return { taken: dmg, hits: f.foe.bustX || 1, hp: f.hp, down: f.hp <= 0 };
}
// after an exchange: 'next' (same round), 'corner' (between rounds), 'judges' (after round 3), or 'over' (a KO)
export function afterExchange(f) {
  if (f.over) return 'over';
  if (f.ex < EXCH - 1) return 'next';
  return f.round < ROUNDS ? 'corner' : 'judges';
}

// ---------------- the corner ----------------
// a little health back, then three cards for this fight only: add a punch, train a punch, and a cut (or another punch card)
export function corner(f) {
  const hp0 = f.hp; f.hp = Math.min(f.maxHp, f.hp + TUNE.corner);
  const r = f.rng, have = k => f.bag.some(t => t.k === k), out = [];
  const adds = f.bag.length < BAG.cap + 2 ? ['hook', 'upper', 'jab'].map(k => ({ t: 'add', k })) : [];
  const trains = ['jab', 'hook', 'upper'].filter(have).map(k => ({ t: 'train', k }));
  const pickOne = (list, not = []) => { const l = list.filter(c => !not.some(n => n.t === c.t && n.k === c.k)); return l[(r() * l.length) | 0]; };
  out.push(pickOne(adds.length ? adds : trains));
  out.push(pickOne(trains, out) || pickOne(adds, out));
  const { blacks, dbl } = foeBlacks(f);
  out.push(blacks + dbl > TUNE.cutMin ? { t: 'cut' } : pickOne(adds.concat(trains), out));
  return { hp0, hp: f.hp, cards: out, next: f.foe.plan[f.round].map(k => ({ k, dmg: f.foe.dmg[k] })) };
}
export function pickCorner(f, card) {
  f.picks.push(card.t + (card.k ? ':' + card.k : ''));
  if (card.t === 'add') addTile(f, card.k);
  else if (card.t === 'train') f.train[card.k]++;
  else if (card.t === 'cut') f.cut++;
  f.round++; f.ex = -1; f.rounds.push({ dealt: 0, taken: 0 });
  const g = gloveNow(f); if (!g.everyExchange) f.catchesLeft = g.catches;
}
// what a card does to the bag (for the card picture and the odds bar)
export function cardPreview(f, card) {
  const a = bagMix(f);
  if (card.t === 'add') { const b = { ...a, total: a.total + 1, red: a.red + 1 }; return { before: a, after: b, v: tileVal(f, card.k), n0: f.bag.filter(t => t.k === card.k).length }; }
  if (card.t === 'cut') { f.cut++; const b = bagMix(f); f.cut--; return { before: a, after: b }; }
  const v = tileVal(f, card.k); return { before: a, after: a, v0: v, v1: v + 1, n0: f.bag.filter(t => t.k === card.k).length };
}

// ---------------- the judges (no KO after 3 rounds) ----------------
// each round 10-9 to whoever did more damage in it (10-10 when even); the third judge can see a close round the other way
export function judges(f) {
  const cards = [0, 1, 2].map(j => {
    let you = 0, him = 0;
    f.rounds.slice(0, ROUNDS).forEach(R => {
      let d = R.dealt - R.taken;
      if (j === 2 && d !== 0 && Math.abs(d) <= 2 && f.rng() < .5) d = -d;
      if (d > 0) { you += 10; him += 9; } else if (d < 0) { you += 9; him += 10; } else { you += 10; him += 10; }
    });
    return { you, him };
  });
  const yes = cards.filter(c => c.you > c.him).length, no = cards.filter(c => c.him > c.you).length;
  const win = yes > no, draw = yes === no;
  const kind = draw ? 'DRAW' : (yes === 3 || no === 3) ? 'UNANIMOUS' : (yes === 2 && no === 0) || (no === 2 && yes === 0) ? 'MAJORITY' : 'SPLIT';
  f.over = { win, draw, by: 'decision', kind, cards, round: ROUNDS };
  return f.over;
}

// ---------------- the smart player (sim and ?auto=1) ----------------
// Exact best stop for this exchange: expected damage dealt (capped at his HP, plus a KO bonus) minus damage taken.
// Everything it uses is on screen. No timer since round 16.
export function bestMove(f) {
  const X = f.x, g = gloveNow(f), foe = f.foe, his = X.his;
  if (!X.pile.length) return 'punch';
  const brk = starOn(f, 'hook'), steady = steadyOn(f), bustDmg = his.dmg * (foe.bustX || 1);
  const types = new Map();
  for (const t of X.pile) { const key = t.red ? `r${t.k}${t.v}` : t.k; const e = types.get(key) || { t, n: 0 }; e.n++; types.set(key, e); }
  const T = [...types.values()];
  // how much a point of his damage on you is worth against a point of yours on him: more careful when you are low
  const lam = Math.max(.7, Math.min(2.2, (foe.hpLeft / Math.max(1, foe.hp)) / Math.max(.15, f.hp / f.maxHp)));
  const score = (soft, thru, slot) => {
    if (!slot) return -lam * his.dmg;
    const dealt = soft + thru - Math.min(foe.guard || 0, soft), ko = dealt >= foe.hpLeft;
    return Math.min(dealt, foe.hpLeft) + (ko ? TUNE.koBonus : 0) - (ko ? 0 : lam * his.dmg);
  };
  const memo = new Map();
  const left = () => { let m = 0; for (const e of T) m += e.n; return m; };
  function pullV(slot, lamps, soft, thru, c) {
    const n = left(); if (!n) return -Infinity;
    const key = T.map(e => e.n).join(',') + `|${slot}|${lamps}|${soft}|${thru}|${c}`;
    if (memo.has(key)) return memo.get(key);
    let ev = 0;
    for (const e of T) {
      if (!e.n) continue;
      const p = e.n / n, t = e.t; e.n--;
      const more = left() > 0, go = (s, l, so, th, cc) => { const st = score(so, th, s); return s >= g.slots || !more ? st : Math.max(st, pullV(s, l, so, th, cc)); };
      let r;
      if (t.red) { const d = t.v * g.mult[slot], hk = brk && t.k === 'hook'; r = go(slot + 1, steady && t.k === 'jab' ? Math.max(0, lamps - 1) : lamps, soft + (hk ? 0 : d), thru + (hk ? d : 0), c); }
      else if (g.dodgeFrom && slot >= g.dodgeFrom) r = go(slot, lamps, soft, thru, c);
      else if (lamps + t.lamps >= LAMPS && c > 0) r = go(slot + 1, LAMPS - 1, soft + his.dmg * g.mult[slot], thru, c - 1);
      else if (lamps + t.lamps >= LAMPS) r = -lam * bustDmg;
      else r = go(slot, lamps + t.lamps, soft, thru, c);
      e.n++; ev += p * r;
    }
    memo.set(key, ev); return ev;
  }
  let soft0 = 0, thru0 = 0; for (const c of X.combo) { const d = c.v * c.m; if (brk && c.k === 'hook') thru0 += d; else soft0 += d; }
  const stop = score(soft0, thru0, X.combo.length), pv = pullV(X.combo.length, X.lamps, soft0, thru0, f.catchesLeft);
  return pv > stop + 1e-9 ? 'pull' : 'punch';
}
// corner pick for the smart player: cut when blacks are many, otherwise hit harder
export function bestPick(f, cards) {
  const mix = bagMix(f), blackShare = (mix.black + mix.dbl * 2) / mix.total;
  const val = c => {
    if (c.t === 'cut') return 3 + blackShare * 14;
    if (c.t === 'train') return 3 + f.bag.filter(t => t.k === c.k).length * .55;
    return c.k === 'upper' ? 4.6 : c.k === 'hook' ? 4 : 2.6;
  };
  return cards.slice().sort((a, b) => val(b) - val(a))[0];
}
