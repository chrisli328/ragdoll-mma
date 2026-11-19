// Ragdoll MMA prototype, round 15: the meta game feeds the fight.
// Owner 2026-11-18T16:51Z: "a meaningful 2ndary gameplay meta loop that fits back into the coregame. like training, or upgrading
// moves or equipments" and "each round you kinda of manage your roll deck to adjust strategy and probability".
// What changes the fight:  GYM = train a move (bigger tile; level 3 switches on its trait, which beats one rival) and set how many
//   of each move go in your bag (the black-tile odds move with it);  GEAR = the glove sets your row (slots, multipliers, its
//   special), headgear adds health;  the LADDER = five rivals per circuit, each with one trait; one Gym trait beats each, and every
//   rival drops cards for the move that beats the next one.
// Time frames: seconds = PULL / PUNCH before his punch lands (match.js);  minutes = a 3-round fight;  session = the ladder, training,
//   chests;  day = three drills that read the fight's own stats + a free chest every 4 h;  week = points ladder and the Sunday title
//   fight (the title fight is fake UI).
// Query: ?reset=1 new save, ?auto=1 bot plays (checks), ?seed=N, ?match=N go straight into rival N, ?circuit=N, ?rich=1 demo stock.
import * as L from './logic.js';
import * as M from './match.js';

const QS = new URLSearchParams(location.search);
const AUTO = QS.has('auto');
const $ = id => document.getElementById(id);
const icon = k => 'icons/' + k + '.png';
const S = window.__S;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const fmt = n => n.toLocaleString('en-US');
const MIN = 60e3, HOUR = 60 * MIN, DAY = 24 * HOUR;
let F = null;
const sfx = (k, ...a) => F?.SFX[k]?.(...a);

// ---------------- save ----------------
const KEY = 'rmma-save-v2';
if (QS.get('reset')) localStorage.removeItem(KEY);
const realNow = () => Date.now();
let save;
const now = () => realNow() + (save?.warp || 0);   // the demo "skip time" buttons move this
const dayId = t => Math.floor((t - new Date(t).getTimezoneOffset() * MIN) / DAY);
const weekId = t => Math.floor((dayId(t) + 3) / 7);   // weeks start Monday 00:00
function fresh() {
  const t = realNow(), moves = {};
  const cards0 = { jab: 6, hook: 3, upper: 0 };   // the first win's jab cards make the first TRAIN affordable
  for (const k of L.MOVE_IDS) moves[k] = { lv: L.START_MOVES[k].lv, n: L.START_MOVES[k].n, cards: cards0[k] };
  return { v: 2, coins: 250, gems: 60, moves,
    gloves: { heavy: { own: true, lv: 1, cards: 0 }, rapid: { own: false, lv: 1, cards: 4 }, counter: { own: false, lv: 1, cards: 0 } },
    equip: 'heavy', head: 1,
    circuit: 1, sel: { 1: 0, 2: 0 }, best: { 1: 0, 2: 0 }, stars: {},
    slots: [null, null, null, null], freeAt: t, newSlot: -1,
    day: dayId(t), drills: { prog: {}, claimed: [], all: false },
    week: weekId(t), wkPts: 0,
    seen: {}, settings: { sound: 1, shake: 1, effects: 1 }, warp: 0, plays: 0, wins: 0 };
}
try { save = JSON.parse(localStorage.getItem(KEY)) || fresh(); } catch { save = fresh(); }
if (save.v !== 2) save = fresh();
// r17: the GUARD tile is gone (owner 2026-11-18T22:01Z "i dont like the block ... lets revert that part to old version"). An older
// save keeps everything else; its GUARD copies and cards are dropped, and the bag is topped back up to the minimum with real punches.
if (save.moves.guard) {
  delete save.moves.guard;
  const tot = () => L.MOVE_IDS.reduce((a, k) => a + save.moves[k].n, 0);
  for (const k of L.MOVE_IDS) while (tot() < L.BAG.min && save.moves[k].n < L.maxCopies(k, save.moves[k].lv)) save.moves[k].n++;
  localStorage.setItem(KEY, JSON.stringify(save));
}
const persist = () => localStorage.setItem(KEY, JSON.stringify(save));

// ---------------- tables (first cut; prototype numbers, not tuned on players) ----------------
const TRAIN = { 1: { cards: 8, coins: 100 }, 2: { cards: 16, coins: 250 }, 3: { cards: 32, coins: 600 }, 4: { cards: 64, coins: 1500 } };
const GLOVE_UP = { 1: { cards: 10, coins: 300 }, 2: { cards: 20, coins: 800 }, 3: { cards: 40, coins: 2000 } };
const UNLOCK = 10;
const HEAD = { max: 6, hp: 4, cost: lv => 150 * lv };
const TOP_COPIES = { jab: 5, hook: 4, upper: 3 };   // maxCopies at level 5
const CHEST = {
  wood: { name: 'WOODEN CHEST', img: 'chest-wood', time: 30 * MIN },
  silver: { name: 'SILVER CHEST', img: 'chest-silver', time: 3 * HOUR },
  gold: { name: 'GOLDEN CHEST', img: 'chest-gold', time: 8 * HOUR },
};
const FREE_EVERY = 4 * HOUR;
// each rival's one trait, the Gym trait that beats it, and what he drops (cards for the move that beats the NEXT rival)
const TRAIT = { rookie: 'black', speedy: 'burst', iron: 'shield', bomber: 'dbl', champ: 'crown' };
const KEY_MOVE = { rookie: null, speedy: 'jab', iron: 'hook', bomber: 'upper', champ: 'upper' };   // r17: BOMBER's was GUARD; the sim's best answer to him is upper Lv3
const DROP = ['jab', 'hook', 'upper', 'upper', null];   // the title fight drops glove cards
const coinsFor = (i, c) => (60 + 30 * i + (i === 4 ? 70 : 0)) * c;
const chestFor = (i, c) => (c === 1 ? ['wood', 'wood', 'silver', 'silver', 'gold'] : ['silver', 'silver', 'silver', 'gold', 'gold'])[i];
const DRILLS = [
  { id: 'punches', img: 'jab', name: 'THROW 15 PUNCHES', goal: 15, get: r => r.stats.punches, rw: { cards: ['jab', 5] } },
  { id: 'big', img: 'fire', name: 'LAND A 15+ PUNCH', goal: 1, get: r => r.stats.best >= 15 ? 1 : 0, rw: { cards: ['hook', 4] } },   // r17: was BLOCK 3 PUNCHES
  { id: 'uppers', img: 'uppercut', name: 'LAND 3 UPPERS', goal: 3, get: r => r.stats.uppers, rw: { cards: ['upper', 4] } },
  { id: 'ko', img: 'impact', name: 'WIN BY K.O.', goal: 1, get: r => r.win && r.by === 'ko' ? 1 : 0, rw: { cards: ['hook', 5] } },
  { id: 'wins', img: 'trophy', name: 'WIN 2 FIGHTS', goal: 2, get: r => r.win ? 1 : 0, rw: { coins: 200 } },
  { id: 'clean', img: 'heal', name: 'WIN WITH 50% HP', goal: 1, get: r => r.win && r.hp / r.maxHp >= .5 ? 1 : 0, rw: { gems: 10 } },
];
const NAMES = ['KOKing', 'JabbyJo', 'MiaMauler', 'TinyTank', 'IronMike99', 'SlickRick', 'LeftHookLu', 'BigBenny', 'KnockNora', 'RazorRay', 'PunchyPete', 'DukeDash',
  'GloveGuru', 'CageKid', 'SteelSam', 'RoxyRumble', 'BashBro', 'NinjaNate', 'Hammerhead', 'ZeroZed', 'LilBrawler', 'MadMaxx', 'SnapSally', 'ToughTony', 'QuickQuin',
  'BrickBob', 'VoltVic', 'DizzyDan', 'ChampChi'];
const AV_COL = ['#e8321f', '#2a8ae8', '#3ccf4e', '#c23cff', '#ff9a1c', '#18b8b0', '#e84a9a', '#7a5ae0'];
const RANK = { up: 10, size: 30 };

// ---------------- derived state ----------------
const circLocked = c => c >= 3 || (c === 2 && (save.best[1] || 0) < 5);
const bagTotal = () => L.MOVE_IDS.reduce((a, k) => a + save.moves[k].n, 0);
const bonusHp = () => (save.head - 1) * HEAD.hp;
const movesSetup = () => Object.fromEntries(L.MOVE_IDS.map(k => [k, { lv: save.moves[k].lv, n: save.moves[k].n }]));
const selCirc = () => circLocked(save.circuit) ? 1 : save.circuit;
const selFoe = () => L.foeOf(save.sel[selCirc()] || 0, selCirc());
const canTrain = k => { const m = save.moves[k], c = TRAIN[m.lv]; return !!c && m.cards >= c.cards && save.coins >= c.coins; };
const gloveCanUp = id => { const g = save.gloves[id]; if (!g.own) return g.cards >= UNLOCK; const c = GLOVE_UP[g.lv]; return !!c && g.cards >= c.cards && save.coins >= c.coins; };
const nextGlove = () => L.GLOVE_IDS.find(g => !save.gloves[g].own) || save.equip;
const unlocking = () => save.slots.findIndex(c => c && c.at && c.at > now());
const chestReady = c => c && c.at && c.at <= now();
function shuffled(a, rng = Math.random) { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = (rng() * (i + 1)) | 0; [a[i], a[j]] = [a[j], a[i]]; } return a; }
function todayDrills() { return shuffled(DRILLS, L.rngFrom(save.day * 7919 + 3)).slice(0, 3); }
function tickState() {
  const t = now(), d = dayId(t), w = weekId(t);
  if (d !== save.day) { save.day = d; save.drills = { prog: {}, claimed: [], all: false }; }
  if (w !== save.week) { save.week = w; save.wkPts = 0; }
}
const dur = ms => {
  ms = Math.max(0, ms); const d = Math.floor(ms / DAY), h = Math.floor(ms % DAY / HOUR), m = Math.floor(ms % HOUR / MIN), s = Math.floor(ms % MIN / 1000);
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : m ? `${m}m ${s}s` : `${s}s`;
};
const weekLeft = () => (save.week * 7 + 4) * DAY + new Date().getTimezoneOffset() * MIN - now();
const dayLeft = () => (save.day + 1) * DAY + new Date().getTimezoneOffset() * MIN - now();

// ---------------- rewards ----------------
// rw: { coins, gems, cards: [move, n], gcards: [glove, n], chest }
function grant(rw, from) {
  if (rw.coins) { save.coins += rw.coins; flyRes('coin', from, rw.coins); }
  if (rw.gems) { save.gems += rw.gems; flyRes('gem', from, rw.gems); }
  if (rw.cards) save.moves[rw.cards[0]].cards += rw.cards[1];
  if (rw.gcards) save.gloves[rw.gcards[0]].cards += rw.gcards[1];
  persist(); renderHome();
}
function rwIcon(rw) {   // [icon, value, small corner icon]
  if (rw.coins) return ['coin', fmt(rw.coins)];
  if (rw.gems) return ['gem', rw.gems];
  if (rw.cards) return [L.MOVES[rw.cards[0]].icon, '×' + rw.cards[1], 'card'];
  if (rw.gcards) return [L.GLOVES[rw.gcards[0]].icon, '×' + rw.gcards[1], 'card'];
  if (rw.chest) return [CHEST[rw.chest].img, ''];
  return ['star', ''];
}
const rwHtml = rw => { const [k, v] = rwIcon(rw); return `<span class="rw"><img src="${icon(k)}" alt="">${v}</span>`; };
function rwCard(rw, extra = '') {
  const [k, v, sub] = rwIcon(rw), d = document.createElement('div');
  d.className = 'rwc' + (rw.cards || rw.gcards || rw.chest ? ' gold' : '') + extra;
  d.innerHTML = `<img src="${icon(k)}" alt="">${sub ? `<img class="sub" src="${icon(sub)}" alt="">` : ''}<div class="v">${v}</div>`;
  return d;
}
// chest cards lean to the move that beats the rival you are on, so a chest answers "I keep losing to him"
function rollChest(type) {
  const r = Math.random, foe = selFoe(), key = KEY_MOVE[foe.id] || DROP[save.sel[selCirc()] || 0] || 'jab';
  const [a, b, c] = [key, ...shuffled(L.MOVE_IDS.filter(k => k !== key))];
  const out = [];
  if (type === 'wood') out.push({ coins: 40 + Math.round(r() * 4) * 10 }, { cards: [a, 4] }, { cards: [b, 2] });
  if (type === 'silver') out.push({ coins: 150 }, { cards: [a, 8] }, { cards: [b, 4] }, { cards: [c, 4] }, { gcards: [nextGlove(), 3] });
  if (type === 'gold') {
    out.push({ coins: 400 }, { cards: [a, 12] }, { cards: [b, 8] }, { cards: [c, 6] }, { gcards: [save.equip, 6] });
    const ng = nextGlove(); if (ng !== save.equip) out.push({ gcards: [ng, 4] });
    out.push({ gems: 10 });
  }
  return out;
}
function addChest(type) {   // into the first empty slot; full slots lose it (the reason to come back and open them)
  const i = save.slots.findIndex(c => !c);
  if (i < 0) return -1;
  save.slots[i] = { type, at: 0 }; save.newSlot = i; return i;
}

// ---------------- toast, flying icons, the pointing hand ----------------
let toastT = 0;
function toast(text, k) {
  const t = $('toast'); t.innerHTML = (k ? `<img src="${icon(k)}" alt="">` : '') + text; t.classList.add('on');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), 1600);
}
function flyRes(k, from, n) {
  if (!$('homeView').classList.contains('on')) return;
  const to = { coin: 'resCoin', gem: 'resGem' }[k]; if (!to) return;
  const app = $('app').getBoundingClientRect(), b = $(to).querySelector('img').getBoundingClientRect();
  const a = from?.getBoundingClientRect?.() || { left: app.left + app.width / 2 - 20, top: app.top + app.height / 2, width: 40, height: 40 };
  const cnt = Math.min(8, 3 + Math.floor(Math.log10(n + 1) * 2));
  for (let i = 0; i < cnt; i++) {
    const im = new Image(); im.src = icon(k); im.className = 'flyIcon'; $('app').append(im);
    const x0 = a.left - app.left + a.width / 2 - 18, y0 = a.top - app.top + a.height / 2 - 18, sx = (Math.random() - .5) * 90, sy = (Math.random() - .5) * 60 - 30;
    const x1 = b.left - app.left + b.width / 2 - 18, y1 = b.top - app.top + b.height / 2 - 18;
    im.animate([{ transform: `translate(${x0}px,${y0}px) scale(.4)`, opacity: 0 }, { transform: `translate(${x0 + sx}px,${y0 + sy}px) scale(1.1)`, opacity: 1, offset: .3 },
      { transform: `translate(${x1}px,${y1}px) scale(.8)`, opacity: 1 }], { duration: 650 + i * 45, easing: 'cubic-bezier(.5,0,.6,1)', delay: i * 30 })
      .onfinish = () => { im.remove(); if (i === cnt - 1) { const r = $(to); r.classList.remove('bump'); void r.offsetWidth; r.classList.add('bump'); sfx('pop', 8); } };
  }
}
function pointHand(target) {   // one gold arrow over the next thing to tap (first fight, first training)
  const h = $('hand');
  if (!target || !target.getClientRects().length) { h.classList.remove('on'); h.hidden = true; S.hand = null; return; }
  h.hidden = false;
  const b = target.getBoundingClientRect(), a = $('app').getBoundingClientRect();
  const tip = a.width * .076, onTab = target.classList.contains('tab');   // the arrow tip is 7.6cqw down the box
  const fb = target.id === 'startBtn';   // r17 home A: the glove pill sits right above the middle of FIGHT, so the arrow points into the button's left end
  h.style.left = b.left - a.left + b.width * (fb ? .13 : .5) - h.offsetWidth / 2 + 'px';
  h.style.top = b.top - a.top - tip + b.height * (onTab ? .5 : fb ? .45 : .12) + 'px';   // a tab: the arrow sits inside the bar, not over the page
  h.classList.add('on'); S.hand = target.id || target.dataset.train || target.dataset.tab || target.className;
}
function hints() {   // decided after every render: where the hand points, if anywhere
  if (!$('homeView').classList.contains('on') || S.sheet || chestBusy) return pointHand(null);
  if (save.plays === 0) return pointHand(tab !== 'Fight' ? document.querySelector('.tab[data-tab="Fight"]') : circLocked(save.circuit) ? $('arL') : $('startBtn'));
  if (save.seen.gym !== 'done' && save.wins >= 1) {
    const k = L.MOVE_IDS.find(canTrain);
    if (k) return pointHand(tab === 'Gym' ? document.querySelector(`[data-train="${k}"]`) : document.querySelector('.tab[data-tab="Gym"]'));
  }
  pointHand(null);
}

// ---------------- sheets ----------------
let sheetClose = null;
function openSheet(title, color, html, onClose, opts = {}) {
  $('sheetTitle').className = 'ribbon t ' + (color || ''); $('sheetTitle').textContent = title;
  $('sheetBody').innerHTML = html; $('sheetX').style.display = opts.noX ? 'none' : 'flex';
  $('sheetBg').classList.add('on'); $('sheet').classList.add('on'); sheetClose = onClose || null; sfx('card');
  S.sheet = title; pointHand(null);
  return $('sheetBody');
}
function closeSheet() {
  $('sheetBg').classList.remove('on'); $('sheet').classList.remove('on'); S.sheet = null;
  const f = sheetClose; sheetClose = null; f?.(); hints();
}
$('sheetX').onclick = closeSheet;
$('sheetBg').onclick = () => { if ($('sheetX').style.display !== 'none') closeSheet(); };

// ---------------- home ----------------
let tab = 'Fight';
function goTab(t) {
  tab = t; sfx('tick', .6);
  document.querySelectorAll('.tab').forEach(e => e.classList.toggle('on', e.dataset.tab === t));
  document.querySelectorAll('.pane').forEach(e => e.classList.toggle('on', e.id === 'pane' + t));
  S.tab = t; renderHome();
}
document.querySelectorAll('.tab').forEach(e => e.onclick = () => goTab(e.dataset.tab));
function badge(id, n) { const b = $(id); if (!b) return; b.classList.toggle('on', !!n); b.hidden = !n; if (!b.classList.contains('dot')) b.textContent = n || ''; }
function drillsClaimable() {
  let n = 0; for (const d of todayDrills()) if (!save.drills.claimed.includes(d.id) && (save.drills.prog[d.id] || 0) >= d.goal) n++;
  return n + (save.drills.claimed.length >= 3 && !save.drills.all ? 1 : 0);
}
function renderTop() { $('coinText').textContent = fmt(save.coins); $('gemText').textContent = fmt(save.gems); }
function renderBadges() {
  const tr = L.MOVE_IDS.filter(canTrain).length, gu = L.GLOVE_IDS.filter(gloveCanUp).length;
  badge('bdGym', tr); badge('bdBag', tr); badge('bdGear', gu); badge('bdGlove', gu); badge('bdDrills', drillsClaimable());
  const fr = save.freeAt <= now();
  $('sbFree').classList.toggle('ready', fr); badge('bdFree', fr ? 1 : 0); $('freeTm').textContent = fr ? 'OPEN' : dur(save.freeAt - now());
  $('titleTm').textContent = dur(weekLeft()); $('drillTm').textContent = dur(dayLeft());
}
const statSpan = (k, v, cls = '') => `<span class="${cls}"><img src="${icon(k)}" alt="">${v}</span>`;
function renderFightPane() {
  const c = save.circuit, C = L.CIRCUITS[c - 1], locked = circLocked(c);
  $('chapK').textContent = `CIRCUIT ${c}`; $('chapN').textContent = C.name;
  // r17 home A: the middle of the home is our own 3D boxer (one model for every rival, rendered from the fight scene), dark when locked
  const im = $('islandImg'); $('nextFight').classList.toggle('off', locked);
  im.classList.toggle('lockd', locked); $('chapLock').classList.toggle('on', locked); $('chapLock').hidden = !locked; $('chapLockT').textContent = c === 2 ? 'BEAT THE CHAMP' : 'SOON';
  $('arL').classList.toggle('off', c <= 1); $('arR').classList.toggle('off', c >= 5);
  const lad = $('ladder'), best = save.best[c] || 0, sel = save.sel[c] || 0;
  lad.style.visibility = locked ? 'hidden' : ''; $('foeCard').style.visibility = locked ? 'hidden' : '';
  lad.innerHTML = `<i class="prog" style="width:calc((100% - 12.4cqw) * ${Math.min(best, 4) / 4})"></i>`;
  if (!locked) L.FOES.forEach((fo, i) => {
    const st = save.stars[`${c}-${i}`] || 0, d = document.createElement('div');
    d.className = 'ln' + (i < best ? ' done' : i === best ? ' cur' : ' lock') + (i === sel ? ' sel' : '') + (fo.boss ? ' boss' : '');
    d.dataset.i = i;
    d.innerHTML = `<div class="o"><img src="${icon(TRAIT[fo.id])}" alt=""></div><div class="ls">${i <= best ? [1, 2, 3].map(s => `<img src="${icon('star')}" class="${s <= st ? 'on' : ''}" alt="">`).join('') : ''}</div>`
      + (i === sel ? `<div class="lnm t">${L.foeOf(i, c).name}</div>` : '');
    d.onclick = () => { if (i > best) { toast(`BEAT ${L.foeOf(i - 1, c).name}`, 'lock'); return; } save.sel[c] = i; persist(); sfx('card'); renderHome(); };
    lad.append(d);
  });
  if (!locked) {
    const foe = L.foeOf(sel, c);
    $('fcIcon').src = icon(TRAIT[foe.id]); $('fcName').textContent = foe.name;
    $('fcStats').innerHTML = statSpan('heal', foe.hp) + statSpan('black', '×' + foe.blacks) + (foe.dbl ? statSpan('dbl', '×' + foe.dbl) : '')
      + (foe.guard ? statSpan('shield', '−' + foe.guard, 'cold') : '') + (foe.fast ? statSpan('hourglass', 'FAST', 'cold') : '') + (foe.bustX ? statSpan('burst', 'BUST ×' + foe.bustX, 'hot') : '');
    const km = KEY_MOVE[foe.id], fk = $('fcKey');
    if (!km) { fk.className = 'fk none'; fk.innerHTML = ''; fk.onclick = null; }
    else {
      const Mv = L.MOVES[km], have = L.hasStar(save.moves[km].lv);
      fk.className = 'fk' + (have ? ' have' : ''); fk.innerHTML = `<div class="kr"><img src="${icon(Mv.star.icon)}" alt=""><img src="${icon(Mv.icon)}" alt=""></div><div class="kl">${Mv.star.name}</div>`;
      fk.onclick = () => goGym(km);
    }
  }
  const sb = $('startBtn'); sb.classList.toggle('grey', locked); sb.classList.toggle('pulse', !locked && save.plays === 0);
  const gl = L.gloveOf(save.equip, save.gloves[save.equip].lv);
  $('gcIcon').src = icon(gl.icon); $('gcType').textContent = gl.name; $('gcName').textContent = 'LV ' + gl.lvl; $('navGlove').src = icon(gl.icon); $('bcName').textContent = bagTotal();
  const box = $('chests'); box.innerHTML = '';
  const unl = unlocking();
  save.slots.forEach((ch, i) => {
    const d = document.createElement('div');
    if (!ch) { d.className = 'chest empty'; d.innerHTML = `<img src="${icon('chest-wood')}" alt=""><div class="tm t">EMPTY</div>`; d.onclick = () => toast('WIN FIGHTS FOR CHESTS', 'trophy'); }
    else {
      const ready = chestReady(ch), running = ch.at && !ready;
      d.className = 'chest' + (ready ? ' ready' : '') + (save.newSlot === i ? ' drop' : '');
      d.innerHTML = `<img src="${icon(CHEST[ch.type].img)}" alt=""><div class="tm t">${ready ? 'OPEN' : running ? dur(ch.at - now()) : unl < 0 ? 'UNLOCK' : dur(CHEST[ch.type].time)}</div>`;
      d.onclick = () => chestSlot(i);
    }
    box.append(d);
  });
  if (save.newSlot >= 0) { save.newSlot = -1; persist(); }
}
function renderHome() {
  if (!$('homeView').classList.contains('on')) return;
  tickState(); renderTop(); renderBadges();
  if (tab === 'Fight') renderFightPane();
  if (tab === 'Gym') renderGym();
  if (tab === 'Gear') renderGear();
  if (tab === 'Rank') renderRank();
  requestAnimationFrame(hints);
}
setInterval(() => {
  if (!$('homeView').classList.contains('on')) return;
  tickState(); renderBadges();
  if (tab === 'Fight') renderChestTimers();
  if (tab === 'Rank') { const t = $('rkTm'); if (t) t.textContent = dur(weekLeft()); const u = $('tbTm'); if (u) u.textContent = dur(weekLeft()); }
}, 1000);
function renderChestTimers() {   // cheap 1 s refresh: rebuild only when a timer crosses zero
  const sig = JSON.stringify(save.slots.map(c => c && chestReady(c)));
  if (sig !== renderChestTimers.sig) { renderChestTimers.sig = sig; renderFightPane(); return; }
  const cells = $('chests').children; if (!cells.length) return;
  save.slots.forEach((c, i) => { if (c && c.at && !chestReady(c)) cells[i].querySelector('.tm').textContent = dur(c.at - now()); });
}
// r17 polish: a lock toast from the last circuit ("BEAT SPEEDY") must not hang over the next one's "BEAT THE CHAMP"
const toastOff = () => { clearTimeout(toastT); $('toast').classList.remove('on'); };
$('arL').onclick = () => { if (save.circuit > 1) { save.circuit--; toastOff(); sfx('card'); persist(); renderHome(); } };
$('arR').onclick = () => { if (save.circuit < 5) { save.circuit++; toastOff(); sfx('card'); persist(); renderHome(); } };
$('islandImg').onclick = () => { $('islandImg').animate([{ transform: 'scale(1)' }, { transform: 'scale(1.06)' }, { transform: 'scale(1)' }], { duration: 260 }); sfx('tick', .5); };
$('gloveChip').onclick = () => goTab('Gear');
$('bagChip').onclick = () => goTab('Gym');
$('resCoin').onclick = () => goTab('Shop');
$('resGem').onclick = () => goTab('Shop');
$('me').onclick = () => settingsSheet(false);
$('sbDrills').onclick = () => drillsSheet();
$('sbTitle').onclick = () => titleSheet();
$('sbFree').onclick = () => { if (save.freeAt > now()) { toast('FREE CHEST ' + dur(save.freeAt - now()), 'hourglass'); return; } save.freeAt = now() + FREE_EVERY; persist(); openChest('wood'); };
$('shopWrap').onclick = () => toast('DEMO ONLY', 'lock');

// ---------------- gym: train moves, set the bag ----------------
function tileHtml(k, v, star) {
  const Mv = L.MOVES[k];
  return `<div class="tile"><img src="${icon(Mv.icon)}" alt=""><div class="val num">${v}</div>${star ? `<img class="tr" src="${icon(Mv.star.icon)}" alt="">` : ''}</div>`;
}
function dotsHtml(foe) {
  let h = '';
  for (const k of L.MOVE_IDS) for (let i = 0; i < save.moves[k].n; i++) h += '<i></i>';
  for (let i = 0; i < foe.blacks; i++) h += '<i class="k"></i>';
  for (let i = 0; i < foe.dbl; i++) h += '<i class="d"></i>';
  return h;
}
function renderGym(bumpOdds) {
  const foe = selFoe(), tot = bagTotal(), bl = foe.blacks + foe.dbl, odds = Math.round(bl / (tot + bl) * 100);
  let h = `<div id="bagHead"><div class="r1 t"><img src="${icon('bag')}" alt="">BAG <span class="n">${tot}/${L.BAG.cap}</span>
      <span class="vs"><img src="${icon(TRAIT[foe.id])}" alt="">${foe.name}</span></div>
    <div class="r2"><div class="dots big">${dotsHtml(foe)}</div><div class="odds t ${odds >= 25 ? 'hot' : odds <= 18 ? 'ok' : ''}${bumpOdds ? ' bump' : ''}" id="oddsPill"><i></i>${odds}%</div></div></div>`;
  for (const k of L.MOVE_IDS) {
    const m = save.moves[k], Mv = L.MOVES[k], v = L.moveVal(k, m.lv), cost = TRAIN[m.lv], max = L.maxCopies(k, m.lv), star = L.hasStar(m.lv);
    const plusNo = m.n >= max || tot >= L.BAG.cap, minusNo = m.n <= 0 || tot <= L.BAG.min;
    h += `<div class="mv" data-k="${k}">${tileHtml(k, v, star)}
      <div><div class="nm t">${Mv.name}<span class="lv">LV ${m.lv}</span></div>
        <div class="trait t${star ? '' : ' off'}" data-trait="${k}"><img src="${icon(Mv.star.icon)}" alt="">${Mv.star.name}${star ? '' : '<span class="lk">LV3</span>'}</div>
        ${cost ? `<div class="shards ${m.cards >= cost.cards ? 'rdy' : ''}"><img src="${icon('card')}" alt=""><i style="width:${Math.min(100, m.cards / cost.cards * 100)}%"></i><span>${m.cards}/${cost.cards}</span></div>`
          : `<div class="shards rdy"><img src="${icon('card')}" alt=""><i style="width:100%"></i><span>MAX</span></div>`}</div>
      <div class="rt"><div class="step t"><b class="${minusNo ? 'no' : ''}" data-d="-1">−</b><span>${m.n}</span><b class="${plusNo ? 'no' : ''}" data-d="1">+</b></div>
        ${cost ? `<div class="gbtn sm ${canTrain(k) ? '' : 'grey'} t" data-train="${k}"><img src="${icon('coin')}" alt="">${fmt(cost.coins)}</div>` : '<div class="gbtn sm grey t">MAX</div>'}</div></div>`;
  }
  $('gymList').innerHTML = h;
  const box = $('gymList');
  box.querySelectorAll('.mv').forEach(row => {
    const k = row.dataset.k;
    row.querySelectorAll('.step b').forEach(b => b.onclick = () => setCopies(k, +b.dataset.d));
    row.querySelector('[data-train]')?.addEventListener('click', () => train(k));
    row.querySelector('[data-trait]').onclick = () => toast(L.MOVES[k].star.line, L.MOVES[k].star.icon);
  });
  if (gymFlash) { const r = box.querySelector(`.mv[data-k="${gymFlash}"]`); gymFlash = null; if (r) { r.scrollIntoView({ block: 'center' }); r.classList.add('flash'); } }
}
let gymFlash = null;
function goGym(k) { gymFlash = k; goTab('Gym'); }
function setCopies(k, d) {
  const m = save.moves[k], tot = bagTotal(), max = L.maxCopies(k, m.lv);
  if (d > 0) {
    if (m.n >= max) { toast(max < TOP_COPIES[k] ? 'TRAIN FOR +1' : `MAX ${max}`, max < TOP_COPIES[k] ? 'upgrade' : L.MOVES[k].icon); return; }
    if (tot >= L.BAG.cap) { toast(`BAG FULL ${L.BAG.cap}`, 'bag'); return; }
  } else {
    if (m.n <= 0) return;
    if (tot <= L.BAG.min) { toast(`MIN ${L.BAG.min}`, 'bag'); return; }
  }
  m.n += d; persist(); sfx('tick', d > 0 ? .9 : .5); renderTop(); renderBadges(); renderGym(true);
  const t = $('gymList').querySelector(`.mv[data-k="${k}"] .tile`); t?.classList.add('bump');
}
function train(k) {
  const m = save.moves[k], c = TRAIN[m.lv]; if (!c) return;
  if (m.cards < c.cards) { toast(`NEED ${c.cards}`, 'card'); return; }
  if (save.coins < c.coins) { toast('NOT ENOUGH COINS', 'coin'); return; }
  const v0 = L.moveVal(k, m.lv), max0 = L.maxCopies(k, m.lv);
  m.cards -= c.cards; save.coins -= c.coins; m.lv++;
  if (save.wins >= 1) save.seen.gym = 'done';
  persist(); sfx('boost', 'mul'); trainSheet(k, v0, max0);
}
function trainSheet(k, v0, max0) {
  const m = save.moves[k], Mv = L.MOVES[k], v1 = L.moveVal(k, m.lv), star = L.hasStar(m.lv), newStar = m.lv === L.STAR_LV, more = L.maxCopies(k, m.lv) > max0;
  let h = `<div style="display:flex;flex-direction:column;align-items:center;gap:1cqw">
    <div class="t" style="font-size:7cqw">${Mv.name} <span style="color:var(--gold)">LV ${m.lv}</span></div>`;
  h += v1 !== v0 ? `<div class="upRow">${tileHtml(k, v0, L.hasStar(m.lv - 1))}<span class="ar t">→</span>${tileHtml(k, v1, star)}</div>` : `<div class="upRow">${tileHtml(k, v1, star)}</div>`;
  if (newStar) h += `<div class="newTrait t"><img src="${icon(Mv.star.icon)}" alt=""><div class="n">${Mv.star.name}</div><div class="l">${Mv.star.line}</div></div>`;
  if (more) h += `<div class="plusOne t"><img src="${icon('bag')}" alt="">+1 ${Mv.name}</div>`;
  h += `<div class="gbtn t" id="trOk" style="margin-top:3cqw">OK</div></div>`;
  openSheet(newStar ? 'NEW TRAIT!' : 'LEVEL UP!', 'gold', h, () => renderHome());
  sfx('fanfare'); $('trOk').onclick = closeSheet;
  if (AUTO) setTimeout(() => { if (S.sheet === 'NEW TRAIT!' || S.sheet === 'LEVEL UP!') closeSheet(); }, 900);
}

// ---------------- gear: gloves set the row, headgear adds health ----------------
const miniHtml = mult => `<div class="mini${mult.length > 4 ? ' six' : ''}">${mult.map(x => `<b class="m${x}">×${x}</b>`).join('')}</div>`;
const pips = (n, of) => `<div class="lvp">${Array.from({ length: of }, (_, i) => `<i class="${i < n ? 'on' : ''}"></i>`).join('')}</div>`;
function specials(gl) {
  let h = '';
  if (gl.catches) h += `<span class="sp"><img src="${icon('catch')}" alt="">CATCH ×${gl.catches}${gl.everyExchange ? ' EVERY' : ''}</span>`;
  if (gl.dodgeFrom) h += `<span class="sp"><img src="${icon('slip')}" alt="">${gl.dodgeFrom}+ MISS</span>`;
  return h;
}
function renderGear() {
  let h = `<div class="sect">GLOVES</div>`;
  for (const id of L.GLOVE_IDS) {
    const G = L.GLOVES[id], g = save.gloves[id], gl = L.gloveOf(id, g.lv), eq = save.equip === id, cost = g.own ? GLOVE_UP[g.lv] : null;
    const need = g.own ? cost?.cards || 0 : UNLOCK, full = need && g.cards >= need;
    h += `<div class="glc ${eq ? 'eq' : ''} ${g.own ? '' : 'lockd'}" data-id="${id}">${eq ? '<div class="tag t">ON</div>' : ''}
      <div class="art"><img src="${icon(gl.icon)}" alt="">${g.own ? '' : `<img class="lk" src="${icon('lock')}" alt="">`}</div>
      <div><div class="nm">${gl.name}${pips(g.own ? g.lv : 0, L.GLOVE_MAX)}</div>${miniHtml(gl.mult)}<div>${specials(gl)}</div>
        ${g.lv < L.GLOVE_MAX ? `<div class="ev"><span>LV4</span>→<img src="${icon(G.evo.icon)}" alt="">${G.evo.name}</div>` : ''}
        ${need ? `<div class="shards ${full ? 'rdy' : ''}"><img src="${icon('card')}" alt=""><i style="width:${Math.min(100, g.cards / need * 100)}%"></i><span>${g.cards}/${need}</span></div>` : ''}
        <div class="acts">
          ${!g.own ? (full ? `<div class="gbtn sm t" data-act="unlock">UNLOCK</div>` : `<div class="gbtn sm grey t" data-act="find"><img src="${icon('chest-silver')}" alt="">CHESTS</div>`)
            : `${eq ? '' : `<div class="gbtn sm blue t" data-act="equip">EQUIP</div>`}${cost ? `<div class="gbtn sm ${gloveCanUp(id) ? '' : 'grey'} t" data-act="up"><img src="${icon('coin')}" alt="">${fmt(cost.coins)}</div>` : ''}`}
        </div></div></div>`;
  }
  const hc = HEAD.cost(save.head), hmax = save.head >= HEAD.max;
  h += `<div class="sect">HEADGEAR</div><div class="glc eq" id="headRow"><div class="art"><img src="${icon('headgear')}" alt=""></div>
    <div><div class="nm">HEADGEAR${pips(save.head, HEAD.max)}</div><div class="hp"><img src="${icon('heal')}" alt="">${L.TUNE.maxHp}<span class="bon">+${bonusHp()}</span></div></div>
    <div class="gbtn sm ${hmax || save.coins < hc ? 'grey' : ''} t" id="headUp">${hmax ? 'MAX' : `<img src="${icon('coin')}" alt="">${fmt(hc)}`}</div></div>`;
  $('gearList').innerHTML = h;
  $('gearList').querySelectorAll('[data-act]').forEach(e => e.onclick = () => gloveAct(e.closest('.glc').dataset.id, e.dataset.act));
  $('headUp').onclick = () => {
    if (save.head >= HEAD.max) return;
    if (save.coins < hc) { toast('NOT ENOUGH COINS', 'coin'); return; }
    save.coins -= hc; save.head++; persist(); sfx('boost', 'mul'); sfx('pick'); toast(`+${HEAD.hp}`, 'heal'); renderHome();
    $('headRow')?.animate([{ transform: 'scale(1.06)', filter: 'brightness(1.5)' }, { transform: 'none' }], { duration: 350 });
  };
}
function gloveAct(id, act) {
  const g = save.gloves[id];
  if (act === 'find') { toast('FIND IN CHESTS', 'chest-silver'); return; }
  if (act === 'equip') { save.equip = id; persist(); sfx('pick'); toast(L.gloveOf(id, g.lv).name, L.gloveOf(id, g.lv).icon); renderHome(); return; }
  if (act === 'unlock') { g.own = true; g.cards -= UNLOCK; persist(); gloveSheet(id, 0); return; }
  if (act === 'up') {
    const c = GLOVE_UP[g.lv]; if (!c) return;
    if (g.cards < c.cards) { toast(`NEED ${c.cards}`, 'card'); return; }
    if (save.coins < c.coins) { toast('NOT ENOUGH COINS', 'coin'); return; }
    g.cards -= c.cards; save.coins -= c.coins; g.lv++; persist(); gloveSheet(id, g.lv - 1);
  }
}
function gloveSheet(id, from) {   // the upgrade moment: the slot row changes in front of you
  const g = save.gloves[id], a = from ? L.gloveOf(id, from) : null, b = L.gloveOf(id, g.lv);
  openSheet(b.evo ? 'EVOLVED!' : from ? 'UPGRADED!' : 'UNLOCKED!', 'gold', `<div style="display:flex;flex-direction:column;align-items:center;gap:2cqw">
    <img src="${icon(b.icon)}" alt="" style="width:36cqw;height:36cqw;animation:popIn .5s cubic-bezier(.2,.9,.3,1.4)">
    <div class="t" style="font-size:7cqw;display:flex;align-items:center;gap:2cqw">${b.name}${pips(g.lv, L.GLOVE_MAX)}</div>
    ${a ? `${miniHtml(a.mult)}<div style="font-size:5cqw;opacity:.7">↓</div>` : ''}${miniHtml(b.mult)}<div>${specials(b)}</div>
    <div class="gbtn t" id="glOk" style="margin-top:2cqw">OK</div></div>`, () => renderHome());
  sfx('fanfare'); $('glOk').onclick = closeSheet;
  if (AUTO) setTimeout(() => { if (['EVOLVED!', 'UPGRADED!', 'UNLOCKED!'].includes(S.sheet)) closeSheet(); }, 900);
}

// ---------------- rank: the weekly ladder and the Sunday title fight (fake) ----------------
function rankRows() {
  const w = save.week, start = (w * 7 - 3) * DAY + new Date().getTimezoneOffset() * MIN, k = Math.min(1, Math.max(.05, (now() - start) / (7 * DAY)));
  const rng = L.rngFrom(w * 7919 + 17), rows = NAMES.map((n, i) => ({ n, pts: Math.round((4 + rng() * 70) * (.25 + .75 * k)), c: AV_COL[i % AV_COL.length] }));
  rows.push({ n: 'YOU', pts: save.wkPts, me: true });
  return rows.sort((a, b) => b.pts - a.pts || (a.me ? -1 : 1));
}
function renderRank() {
  const rows = rankRows(), me = rows.findIndex(r => r.me);
  let top = `<div id="titleBan" class="t"><img src="${icon('belt')}" alt=""><div><div class="nm">TITLE FIGHT</div>
      <div class="tm"><img src="${icon('hourglass')}" alt=""><span id="tbTm">${dur(weekLeft())}</span></div>
      <div class="rq"><img src="${icon('lock')}" alt="">TOP ${RANK.up}</div></div></div>
    <div id="lgHead"><img src="${icon('league')}" alt=""><div><div class="nm">THIS WEEK</div><div class="tm"><img src="${icon('hourglass')}" alt=""><span id="rkTm">${dur(weekLeft())}</span></div>
    <div id="lgRew"><div><img src="${icon('chest-gold')}" alt="">1-3</div><div><img src="${icon('chest-silver')}" alt="">4-10</div><div><img src="${icon('chest-wood')}" alt="">11-20</div></div></div></div>`;
  $('rankTop').innerHTML = top;
  let h = '';
  rows.forEach((r, i) => {
    if (i === RANK.up) h += `<div class="lzone up">▲ TITLE FIGHT ▲</div>`;
    h += `<div class="lrow t ${r.me ? 'me' : i < RANK.up ? 'up' : ''}" ${r.me ? 'id="rkMe"' : ''}><div class="rk">${i + 1}</div>
      <div class="av" style="background:${r.c || '#2a5ad8'}">${r.me ? `<img src="${icon('avatar')}" alt="">` : r.n[0]}</div>
      <div>${r.n}</div><div class="tr"><img src="${icon('trophy')}" alt="">${fmt(r.pts)}</div></div>`;
  });
  $('rankList').innerHTML = h;
  $('titleBan').onclick = () => titleSheet();
  if (S.rankScroll !== save.week + ':' + me) { S.rankScroll = save.week + ':' + me; requestAnimationFrame(() => $('rkMe')?.scrollIntoView({ block: 'center' })); }
}
function titleSheet() {   // fake UI: what the week builds to
  const rows = rankRows(), me = rows.findIndex(r => r.me) + 1;
  const body = openSheet('TITLE FIGHT', 'gold', `<div style="display:flex;flex-direction:column;align-items:center;gap:2cqw">
    <img src="${icon('belt')}" alt="" style="width:40cqw;height:40cqw;animation:floaty 2.4s ease-in-out infinite;filter:drop-shadow(0 0 5cqw rgba(255,210,60,.7))">
    <div class="tm"><img src="${icon('hourglass')}" alt="">${dur(weekLeft())}</div>
    <div class="big-reward"><div class="rwc in gold"><img src="${icon('belt')}" alt=""><div class="v">BELT</div></div><div class="rwc in gold"><img src="${icon('chest-gold')}" alt=""><div class="v">×2</div></div>
      <div class="rwc in"><img src="${icon('g-iron')}" alt=""><img class="sub" src="${icon('card')}" alt=""><div class="v">×20</div></div></div>
    <div class="t" style="font-size:5cqw;display:flex;align-items:center;gap:2cqw"><img src="${icon('trophy')}" alt="" style="width:7cqw;height:7cqw">#${me} <span style="opacity:.6">/ TOP ${RANK.up}</span></div>
    <div class="gbtn t ${me <= RANK.up ? 'orange' : 'grey'}" id="tfGo"><img src="${icon('lock')}" alt="">SUNDAY</div></div>`, () => renderHome());
  body.querySelector('#tfGo').onclick = () => toast('DEMO: SUNDAY EVENT', 'belt');
}

// ---------------- daily drills: the fight's own stats ----------------
function drillsSheet() {
  const ds = todayDrills(), d = save.drills, nC = d.claimed.length;
  let h = `<div style="text-align:center"><div class="tm"><img src="${icon('hourglass')}" alt="">${dur(dayLeft())}</div></div>
    <div id="drillAll" class="${nC >= 3 && !d.all ? 'ready' : ''}"><img src="${icon('chest-silver')}" alt=""><div class="pips">${[0, 1, 2].map(i => `<i class="${i < nC ? 'on' : ''}"></i>`).join('')}</div>
      ${d.all ? '<div class="done" style="font-size:6cqw;color:#7dff8a">✓</div>' : `<div class="gbtn sm ${nC >= 3 ? '' : 'grey'} t" id="drAll">OPEN</div>`}</div>`;
  for (const m of ds) {
    const v = Math.min(m.goal, d.prog[m.id] || 0), done = d.claimed.includes(m.id), can = !done && v >= m.goal;
    h += `<div class="mrow"><img src="${icon(m.img)}" alt=""><div><div class="nm">${m.name}</div><div class="pbar"><i style="width:${v / m.goal * 100}%"></i><span>${v}/${m.goal}</span></div></div>
      ${done ? '<div class="done">✓</div>' : `<div class="gbtn sm ${can ? '' : 'grey'} t" data-claim="${m.id}">${rwHtml(m.rw)}</div>`}</div>`;
  }
  const body = openSheet('DRILLS', 'blue', h, () => renderHome());
  body.querySelectorAll('[data-claim]').forEach(e => e.onclick = () => {
    const m = DRILLS.find(x => x.id === e.dataset.claim);
    if ((d.prog[m.id] || 0) < m.goal) { toast(m.name, m.img); return; }
    d.claimed.push(m.id); grant(m.rw, e); sfx('pick');
    if (m.rw.cards) toast(`${L.MOVES[m.rw.cards[0]].name} ×${m.rw.cards[1]}`, 'card');
    drillsSheet();
  });
  body.querySelector('#drAll')?.addEventListener('click', () => {
    if (d.claimed.length < 3) { toast('3 DRILLS', 'missions'); return; }
    d.all = true; persist(); closeSheet(); openChest('silver', () => drillsSheet());
  });
}

// ---------------- chests ----------------
function chestSlot(i) {
  const c = save.slots[i], C = CHEST[c.type];
  if (chestReady(c)) { save.slots[i] = null; persist(); openChest(c.type); return; }
  const left = c.at ? c.at - now() : C.time, gems = Math.max(1, Math.ceil(left / (10 * MIN))), other = unlocking();
  const body = openSheet(C.name, 'gold', `<div style="display:flex;flex-direction:column;align-items:center">
    <img src="${icon(C.img)}" alt="" style="width:40cqw;height:40cqw;animation:floaty 2.4s ease-in-out infinite">
    <div class="tm"><img src="${icon('hourglass')}" alt="">${dur(left)}</div>
    <div style="display:flex;gap:3cqw;margin-top:2cqw">
      ${c.at || other >= 0 ? '' : `<div class="gbtn blue t" id="chStart"><img src="${icon('hourglass')}" alt="">START</div>`}
      <div class="gbtn purple t" id="chGem"><span>OPEN</span><img src="${icon('gem')}" alt="">${gems}</div>
    </div>
    ${!c.at && other >= 0 ? `<div class="demoLbl">ONE AT A TIME</div>` : ''}</div>`);
  const st = body.querySelector('#chStart');
  if (st) st.onclick = () => { c.at = now() + C.time; persist(); closeSheet(); renderHome(); sfx('pick'); };
  body.querySelector('#chGem').onclick = () => {
    if (save.gems < gems) { toast('NOT ENOUGH GEMS', 'gem'); return; }
    save.gems -= gems; save.slots[i] = null; persist(); closeSheet(); openChest(c.type);
  };
}
let chestBusy = false;
async function openChest(type, then) {   // shake, burst, rewards pop one by one, tap to collect
  if (chestBusy) return; chestBusy = true; pointHand(null);
  const rw = rollChest(type), co = $('chestOpen'), box = $('coRew');
  S.phase = 'chest'; S.log.push({ t: Math.round(performance.now()), p: 'chest', type, rw });
  $('coImg').src = icon(CHEST[type].img); box.innerHTML = ''; co.className = 't on'; $('coTap').textContent = 'TAP!';
  let tapped = false; const tap = new Promise(r => co.onclick = () => { if (!tapped) { tapped = true; r(); } });
  await Promise.race([tap, sleep(AUTO ? 300 : 1e9)]);
  co.classList.add('shake'); sfx('boost', 'mul'); await sleep(700);
  co.classList.remove('shake'); co.classList.add('open'); sfx('fanfare');
  for (const r of rw) { const d = rwCard(r); box.append(d); requestAnimationFrame(() => d.classList.add('in')); sfx('pop', 6 + box.children.length * 2); await sleep(260); }
  $('coTap').textContent = 'COLLECT';
  tapped = false; const tap2 = new Promise(r => co.onclick = () => { if (!tapped) { tapped = true; r(); } });
  await Promise.race([tap2, sleep(AUTO ? 900 : 1e9)]);
  co.className = 't'; co.onclick = null;
  chestBusy = false; S.phase = 'home';
  for (const r of rw) grant(r, $('chests'));
  persist(); renderHome(); then?.();
}

// ---------------- settings (home: from the avatar; match: pause) ----------------
function applySettings() { const st = save.settings; F?.settings({ shake: st.shake, effects: st.effects }); F?.mute(!st.sound); }
function demoStock() {
  save.coins += 5000; save.gems += 200;
  for (const k of L.MOVE_IDS) save.moves[k].cards += 40;
  for (const id of L.GLOVE_IDS) save.gloves[id].cards += 30;
  persist(); renderHome();
}
function settingsSheet(inMatch) {
  return new Promise(resolve => {
    const st = save.settings, row = (k, nm, ic) => `<div class="setRow t"><span style="display:flex;align-items:center;gap:2cqw"><img src="${icon(ic)}" alt="" style="width:8cqw;height:8cqw">${nm}</span><div class="tog ${st[k] ? 'on' : ''}" data-k="${k}"></div></div>`;
    let h = row('sound', 'SOUND', 'bell') + row('shake', 'SCREEN SHAKE', 'impact') + row('effects', 'FLASH + ZOOM', 'burst');
    if (inMatch) h += `<div style="display:flex;gap:3cqw;justify-content:center;margin-top:2cqw"><div class="gbtn grey t" id="stQuit">QUIT</div><div class="gbtn t" id="stResume">RESUME</div></div>`;
    else h += `<div class="demoLbl" style="text-align:center">DEMO</div><div class="demoRow"><div class="gbtn sm blue t" id="wH">+1 HOUR</div><div class="gbtn sm blue t" id="wD">+1 DAY</div>
      <div class="gbtn sm orange t" id="wS"><img src="${icon('card')}" alt="">+40</div><div class="gbtn sm grey t" id="wR">RESET</div></div>`;
    let result = 'resume';
    const body = openSheet(inMatch ? 'PAUSED' : 'SETTINGS', 'purple', h, () => { if (inMatch) F?.pause(false); resolve(result); }, { noX: !!inMatch });
    if (inMatch) F?.pause(true);
    body.querySelectorAll('.tog').forEach(e => e.onclick = () => { st[e.dataset.k] = st[e.dataset.k] ? 0 : 1; e.classList.toggle('on', !!st[e.dataset.k]); persist(); applySettings(); sfx('tick', .6); });
    if (inMatch) { body.querySelector('#stResume').onclick = () => { result = 'resume'; closeSheet(); }; body.querySelector('#stQuit').onclick = () => { result = 'quit'; closeSheet(); }; }
    else {
      body.querySelector('#wH').onclick = () => { save.warp += HOUR; persist(); renderHome(); toast('+1 HOUR', 'hourglass'); };
      body.querySelector('#wD').onclick = () => { save.warp += DAY; persist(); renderHome(); toast('+1 DAY', 'calendar'); };
      body.querySelector('#wS').onclick = () => { demoStock(); toast('+40 CARDS', 'card'); };
      body.querySelector('#wR').onclick = () => { localStorage.removeItem(KEY); location.reload(); };
    }
  });
}

// ---------------- the fight ----------------
let playing = false;
function show(view) {
  for (const v of ['loadView', 'homeView', 'matchView']) $(v).classList.toggle('on', v === view);
  S.view = view;
}
$('startBtn').onclick = () => {
  if (playing || chestBusy || S.sheet) return;
  const c = save.circuit;
  if (circLocked(c)) { toast(c === 2 ? 'BEAT THE CHAMP' : 'SOON', 'lock'); return; }
  startFight(c, save.sel[c] || 0);
};
async function startFight(c, i) {
  playing = true; pointHand(null); sfx('bell');
  show('matchView'); F.pause(false); M.layout();
  const g = save.gloves[save.equip], tutorial = !save.seen.tut;
  const seed = QS.get('seed') ? +QS.get('seed') + save.plays : undefined;
  S.fightSetup = { c, i, glove: save.equip, glvl: g.lv, moves: movesSetup(), bonusHp: bonusHp(), tutorial };
  const r = await M.playMatch({ seed, foe: i, circuit: c, glove: save.equip, glvl: g.lv, moves: movesSetup(), bonusHp: bonusHp(), tutorial, onPause: () => settingsSheet(true) });
  playing = false;
  if (r.quit) { goHome('Fight'); return; }
  if (tutorial) save.seen.tut = 1;
  await result(r, c, i);
}
async function result(r, c, i) {
  const foe = L.foeOf(i, c), ko = r.win && r.by === 'ko', hpOk = r.win && r.hp / r.maxHp >= .5;
  const stars = r.win ? 1 + (ko ? 1 : 0) + (hpOk ? 1 : 0) : 0, starFlags = [r.win, ko, hpOk];
  const best = save.best[c] || 0, first = r.win && i === best;
  const coins = r.win ? coinsFor(i, c) : r.draw ? Math.round(coinsFor(i, c) / 2) : 20 * c;
  // he drops cards for the move that beats the next rival; a loss gives cards for the move that beats him
  const km = KEY_MOVE[foe.id], drop = r.win ? DROP[i] : km || DROP[i];
  const nCards = r.win ? (ko ? 7 : 5) : r.draw ? 3 : 2;
  const rws = [{ coins }];
  if (drop) rws.push({ cards: [drop, nCards] }); else rws.push({ gcards: [nextGlove(), r.win ? 6 : 2] });
  if (first) rws.push({ gems: 20 });
  const chest = r.win ? chestFor(i, c) : null, slot = chest ? addChest(chest) : -1;
  for (const x of rws) { if (x.coins) save.coins += x.coins; if (x.gems) save.gems += x.gems; if (x.cards) save.moves[x.cards[0]].cards += x.cards[1]; if (x.gcards) save.gloves[x.gcards[0]].cards += x.gcards[1]; }
  const key = `${c}-${i}`; save.stars[key] = Math.max(save.stars[key] || 0, stars);
  let unlocked = false;
  if (first) { save.best[c] = best + 1; if (i < 4) save.sel[c] = i + 1; else if (c === 1) { unlocked = true; save.circuit = 2; save.sel[2] = 0; } }
  tickState();
  for (const d of todayDrills()) save.drills.prog[d.id] = Math.min(d.goal, (save.drills.prog[d.id] || 0) + d.get(r));
  save.wkPts += r.win ? 3 + (ko ? 1 : 0) + stars : r.draw ? 1 : 0;
  save.plays++; if (r.win) save.wins++;
  persist();
  S.phase = 'result'; S.log.push({ t: Math.round(performance.now()), p: 'result', win: r.win, draw: r.draw, by: r.by, kind: r.kind, round: r.round, stars, rws, chest, slot, foe: foe.id, c });
  // ---- show it ----
  const box = $('result'); box.classList.toggle('lose', !r.win && !r.draw); box.classList.add('on');
  $('resRibbon').textContent = r.win ? 'VICTORY!' : r.draw ? 'DRAW' : 'DEFEAT'; $('resRibbon').className = 'ribbon t ' + (r.win ? 'gold' : r.draw ? 'blue' : '');
  $('resHow').textContent = r.by === 'ko' ? `K.O.  ROUND ${r.round}` : r.draw ? 'JUDGES' : `${r.kind} DECISION`;
  $('resTrophy').style.display = r.win ? '' : 'none';
  const ss = [...$('resStars').children]; ss.forEach(s => s.classList.remove('on')); $('resStars').style.display = r.win ? 'flex' : 'none';
  const rf = $('resFights'); rf.innerHTML = '';
  for (let j = 0; j < 5; j++) { const done = j < save.best[c]; if (j === 4) { const cr = new Image(); cr.src = icon('crown'); if (done) cr.className = 'done'; rf.append(cr); } else { const d = document.createElement('i'); if (done) d.className = 'done'; rf.append(d); } }
  const rw = $('resRew'); rw.innerHTML = '';
  for (const x of rws) rw.append(rwCard(x));
  if (chest) { const d = rwCard({ chest }); if (slot < 0) d.querySelector('.v').textContent = 'FULL'; rw.append(d); }
  // after a loss (or draw): the Gym answer to this rival
  const tip = $('resTip'), needKey = km && !L.hasStar(save.moves[km].lv), anyTrain = L.MOVE_IDS.find(canTrain);
  tip.classList.toggle('on', !r.win); tip.hidden = !!r.win;
  if (needKey) { $('resTipI').src = icon(L.MOVES[km].star.icon); $('resTipT').textContent = `TRAIN ${L.MOVES[km].name}`; tip.onclick = () => { hideResult(); goHome('Gym', km); }; }
  else if (anyTrain) { $('resTipI').src = icon(L.MOVES[anyTrain].icon); $('resTipT').textContent = `TRAIN ${L.MOVES[anyTrain].name}`; tip.onclick = () => { hideResult(); goHome('Gym', anyTrain); }; }
  else { $('resTipI').src = icon(L.gloveOf(save.equip, save.gloves[save.equip].lv).icon); $('resTipT').textContent = 'UPGRADE GEAR'; tip.onclick = () => { hideResult(); goHome('Gear'); }; }
  const next = r.win ? (i < 4 ? [c, i + 1] : unlocked ? [2, 0] : [c, i]) : [c, i];
  $('resNextT').textContent = r.win ? (next[1] !== i || next[0] !== c ? 'NEXT' : 'AGAIN') : 'RETRY';
  r.win ? sfx('fanfare') : sfx('lose');
  await sleep(350);
  for (let j = 0; j < 3 && r.win; j++) { if (starFlags[j]) { ss[j].classList.add('on'); sfx('pop', 8 + j * 4); sfx('boost', 'mul'); } await sleep(330); }
  for (const cEl of rw.children) { cEl.classList.add('in'); sfx('pop', 6); await sleep(200); }
  if (unlocked) toast(`${L.CIRCUITS[1].name} OPEN!`, 'crown');
  $('resHome').onclick = () => { hideResult(); goHome('Fight'); };
  $('resNext').onclick = () => { hideResult(); save.circuit = next[0]; save.sel[next[0]] = next[1]; persist(); goHome('Fight'); setTimeout(() => $('startBtn').onclick(), 250); };
  if (AUTO) setTimeout(() => { if ($('result').classList.contains('on')) $('resHome').onclick(); }, 2600);
}
function hideResult() { $('result').classList.remove('on'); }
function goHome(t = 'Fight', flash) {
  F.pause(true); show('homeView'); S.phase = 'home';
  if (flash) goGym(flash); else goTab(t);
}

// ---------------- boot ----------------
addEventListener('resize', () => { const a = $('app'); a.classList.toggle('short', a.clientHeight / a.clientWidth < 1.95); $('homeLogo').hidden = a.classList.contains('short'); if ($('hand').classList.contains('on')) hints(); });
dispatchEvent(new Event('resize'));
addEventListener('loadpct', () => { const p = window.__loadPct || 0; $('loadFill').style.width = p + '%'; $('loadPct').textContent = p + '%'; });
if (QS.has('rich')) demoStock();
if (QS.get('circuit')) { save.circuit = +QS.get('circuit'); if (save.circuit === 2 && save.best[1] < 5) save.best[1] = 5; persist(); }
S.phase = 'load';
window.__M = { save: () => save, goTab, goGym, show, drillsSheet, titleSheet, settingsSheet, openChest, closeSheet, chestSlot, grant, renderHome, setCopies, train, gloveAct,
  startFight: (c, i) => startFight(c, i), persist, demoStock, hints };
(async () => {
  ({ F } = await import('./fight3d.js'));
  M.attach(F); applySettings(); window.__F = F;
  $('loadFill').style.width = '100%'; $('loadPct').textContent = '100%';
  $('loadView').classList.add('ready'); S.phase = 'loaded';
  const enter = () => {
    $('loadView').onclick = null; F.audioInit(); applySettings(); F.pause(true);
    show('homeView'); goTab('Fight'); S.phase = 'home';
    if (QS.get('match') != null) { const c = selCirc(); setTimeout(() => startFight(c, Math.max(0, Math.min(4, +QS.get('match')))), 300); return; }
    if (AUTO && !QS.has('stay')) setTimeout(() => $('startBtn').onclick(), 900);
  };
  $('loadView').onclick = enter;
  if (AUTO) setTimeout(enter, 300);
})();
