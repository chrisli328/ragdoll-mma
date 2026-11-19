// One fight of the round-17 rules (logic.js), driven by meta.js: 3 rounds of 3 exchanges against one rival.
// Owner 2026-11-18T16:51Z: rounds; he looks more hurt round by round; between rounds the corner with easy cards; and a tutorial
// that teaches by doing (a hand, a dimmed screen and one or two words) instead of a page of words. 2026-11-18T19:42Z: no timer.
// 2026-11-18T22:01Z "lets not do the slow motion just make it a stop motion then": he throws at full speed and the picture stops
// with his fist in the air until you PUNCH; "i dont like the block ... lets revert that part to old version": no guard tile, his
// punch lands in full every exchange he is still up (round 14).
// meta.js calls playMatch({ seed, foe, circuit, glove, glvl, moves, bonusHp, tutorial, onPause }) and gets the result.
// Query: ?auto=1 (smart bot plays), ?speed=K, ?autowait=ms (bot tap delay inside an exchange), ?hints (tutorial while auto).
import * as L from './logic.js';

const QS = new URLSearchParams(location.search);
const AUTO = QS.has('auto');
const SPEED = Math.max(.25, +(QS.get('speed') || 1));
const AUTO_TAP = +(QS.get('autowait') || 220);      // the bot's delay before each tap inside an exchange (rule ms)
const AUTO_PANEL = 1100;                             // and on the intro, corner and judges panels
const $ = id => document.getElementById(id);
const icon = k => 'icons/' + k + '.png';
const dur = ms => ms / SPEED;
// Every fight timer runs on the 3D game clock (stops while PAUSED). gen counts matches: a continuation from a quit match
// never resumes (live() leaves it waiting forever) and F.reset() drops its pending timers.
let gen = 0;
const HANG = () => new Promise(() => {});
const live = p => { const g = gen; return p.then(v => g === gen ? v : HANG(), e => g === gen ? Promise.reject(e) : HANG()); };
const wait = ms => live(F.wait(dur(ms)));
const later = (fn, ms) => F.after(ms, fn);
// a wait that a tap on the fight ends early (after a short floor so the tap that started it does not skip it); paused or
// teaching, the tap does nothing
const waitTap = (ms, floor = 200) => live(new Promise(res => { const t0 = performance.now(), fight = $('fight');
  let done = false; const fin = () => { if (done) return; done = true; fight.removeEventListener('pointerdown', tap); res(); };
  const tap = () => { if (performance.now() - t0 >= floor && !S.sheet && !S.teach) fin(); };
  fight.addEventListener('pointerdown', tap); F.wait(dur(ms)).then(fin); }));
const el = (tag, cls, html) => { const d = document.createElement(tag); if (cls) d.className = cls; if (html != null) d.innerHTML = html; return d; };
const img = (k, cls) => { const i = new Image(); i.src = icon(k); i.alt = ''; if (cls) i.className = cls; return i; };
const S = window.__S ||= { phase: 'load', log: [], errors: [], run: null };
S.cardEl = c => cardEl(c);   // for the page check: draw one corner card from the current fight
const setPhase = (p, extra) => { S.phase = p; S.log.push({ t: Math.round(performance.now()), p, ...extra }); };
function retrigger(node, cls) { node.classList.remove(cls); void node.offsetWidth; node.classList.add(cls); }
const show = (id, on = true) => $(id).classList.toggle('show', on);

// the tutorial fight: these tiles come out first (exchange 1: two punches; 2: three punches; 3: a punch, then two blacks)
const TUT_SCRIPT = [['jab', 'hook'], ['hook', 'jab', 'upper'], ['hook', 'black', 'black']];

let F = null, f = null, busy = true, canAct = false, opts = {}, finish = null;
let queued = null, pulling = null;   // a tap during a pull: slams the reel and runs right after it (input buffer)
const taught = new Set();        // tutorial steps already shown this session

export function attach(x) { F = x; F.onFrame(frame); }

// ---------------- layout ----------------
// The 3D stage keeps 9:10 with the rival's head just under the HUD; short phones get a smaller machine.
export function layout() {
  const app = $('app'); app.classList.toggle('short', app.clientHeight / app.clientWidth < 1.95);
  $('homeLogo').hidden = app.classList.contains('short');   // short phones drop the big home logo (an attribute, not a descendant CSS rule)
  const fight = $('fight'), hud = $('hud'), stage = $('stage');
  const W = fight.clientWidth, FH = fight.clientHeight, hudB = hud.offsetTop + hud.offsetHeight;
  if (!W || !FH) return;
  const Sh = Math.min(W * 10 / 9, (FH - hudB) / .78), top = Math.max(hudB - .12 * Sh, FH - Sh);
  Object.assign(stage.style, { width: Sh * .9 + 'px', height: Sh + 'px', left: (W - Sh * .9) / 2 + 'px', top: top + 'px' });
  stage.classList.toggle('narrow', Sh * .9 < W - 2);
  F?.resize();
}
addEventListener('resize', () => { if (f) layout(); });

// ---------------- every frame: the number over his head ----------------
function frame() {
  if (!f || !$('matchView').classList.contains('on')) return;
  placeFoeHit();
}
function placeFoeHit() {   // his punch floats beside his head while it is coming
  const st = $('stage'), p = F.head(), c = $('foeHit');
  c.style.left = st.offsetLeft + p.x + st.clientWidth * .2 + 'px'; c.style.top = st.offsetTop + p.y + st.clientHeight * .02 + 'px';
  const s = F.state();
  c.classList.toggle('show', !!f.x && !f.x.over && s.foe !== 'ko' && s.cine < 0 && !document.querySelector('#matchView .full.show'));
}

// ---------------- HUD ----------------
function bar(fill, trail, text, hp, max, instant) {
  const k = Math.max(0, hp / max);
  fill.style.transition = instant ? 'none' : 'transform .08s'; trail.style.transition = instant ? 'none' : 'transform .45s .25s';
  fill.style.transform = trail.style.transform = `scaleX(${k})`; text.textContent = `${Math.max(0, hp)} / ${max}`;
}
function setFoeHp(hp, instant) { bar($('hpFill'), $('hpTrail'), $('hpText'), hp, f.foe.hp, instant); F.daze(hp > 0 && hp <= f.foe.hp * .3); }
function setYouHp(hp, instant) {
  bar($('youFill'), $('youTrail'), $('youText'), hp, f.maxHp, instant);
  $('youWrap').classList.toggle('low', hp <= f.maxHp * .3);
  F.lowHp(hp <= 0 ? 0 : hp <= f.maxHp * .15 ? .32 : hp <= f.maxHp * .3 ? .22 : 0);   // hurt: a lasting dark edge and a heartbeat
}
function drawPips() {   // ROUND n and one dot per exchange
  const p = $('path'); p.innerHTML = '';
  p.append(el('b', 'num', 'R' + f.round));
  for (let i = 0; i < L.EXCH; i++) p.append(el('i', i < f.ex || (i === f.ex && f.x?.over) ? 'done' : i === f.ex ? 'now' : ''));
}
function drawFoe() {
  $('rivalName').textContent = f.foe.name;
  $('guardChip').style.display = f.foe.guard ? 'inline-flex' : 'none'; $('guardText').textContent = f.foe.guard;
}
// his face shows the fight: a share of the health he lost, plus a little more each round (owner: "the enemy should look like
// dmged over raounds like real boxing")
const faceK = () => Math.min(1, (1 - f.foe.hpLeft / f.foe.hp) * .85 + (f.round - 1) * .12);

// ---------------- the machine ----------------
const lamps = () => [...$('lampPill').querySelectorAll('.lamp')];
let slotEls = [];
function drawGlove() {
  const g = L.gloveNow(f); $('gloveIcon').src = icon(g.icon); $('gloveName').textContent = g.name; $('gloveBadge').classList.toggle('evo', g.evo);
  const tr = $('gloveTrack'); tr.innerHTML = ''; for (let i = 0; i < L.GLOVE_MAX; i++) tr.append(el('i', i < f.glvl ? 'on' : ''));
}
function drawCatches() {
  const g = L.gloveNow(f), c = $('catches'); c.innerHTML = ''; c.classList.toggle('on', g.catches > 0);
  for (let i = 0; i < g.catches; i++) c.append(img('catch', i >= f.catchesLeft ? 'used' : ''));
}
function drawSlots() {
  const g = L.gloveNow(f), box = $('slots'); box.querySelectorAll('.slot').forEach(s => s.remove()); box.dataset.n = g.slots;
  slotEls = g.mult.map((m, i) => {
    const s = el('div', 'slot m' + m + (g.dodgeFrom && i >= g.dodgeFrom ? ' zone' : ''));
    if (g.dodgeFrom && i >= g.dodgeFrom) s.append(img(g.icon, 'zap'));
    s.append(el('div', 'mul', '×' + m)); box.append(s); return s;
  });
  markNext();
}
function clearRow() { slotEls.forEach(s => { s.querySelectorAll('.tile,.dmg').forEach(n => n.remove()); s.classList.remove('spent', 'lost', 'hit'); }); }
function markNext() { const X = f.x, n = X ? X.combo.length : 0; slotEls.forEach((s, i) => s.classList.toggle('next', !!X && !X.over && i === n)); }
function tileEl(t) {
  let d;
  if (t.k === 'caught') { d = el('div', 'tile caught'); d.append(img('catch'), el('div', 'val num', t.v)); return d; }
  const M = L.MOVES[t.k];
  if (!M) { d = el('div', 'tile foe'); d.append(img(t.k === 'dbl' ? 'dbl' : 'black')); return d; }
  d = el('div', 'tile'); d.append(img(M.icon), el('div', 'val num', t.v));
  if (f && L.starOn(f, t.k)) d.append(img(M.star.icon, 'tr'));   // the Gym's star trait shows on the tile
  return d;
}
function setLamps(n) {   // the lamps the next black (or a double) would light pulse
  const X = f.x, b = X ? L.bagLeft(f) : { dbl: 0 }, ls = lamps();
  ls.forEach((l, i) => { l.classList.toggle('on', i < n); l.classList.toggle('warn', !!X && !X.over && i >= n && (n >= 1 || b.dbl > 0)); });
}
function updateBag(bumpIt) {
  const b = f.x ? L.bagLeft(f) : L.bagMix(f), { dbl } = L.foeBlacks(f);
  const set = (id, v) => { const e = $(id); if (e.textContent !== String(v)) { e.textContent = v; if (bumpIt) retrigger(e.parentNode, 'bump'); } e.parentNode.classList.toggle('zero', !v); };
  set('bagRed', b.red); set('bagBlack', b.black); set('bagDbl', b.dbl);
  $('bagDblRow').style.display = dbl > 0 ? '' : 'none';
}
// his punch: what you will take if he is still up after your row (no guard tile since round 17)
function drawDef(bumpIt) {
  const X = f.x, his = X?.his;
  if (!his) { $('defBox').classList.add('idle'); return; }
  $('defBox').classList.remove('idle');
  $('defHisIcon').src = icon(his.icon); $('defHisN').textContent = '−' + his.dmg;
  $('foeHitIcon').src = icon(his.icon); $('foeHitN').textContent = '−' + his.dmg;
  if (bumpIt) { retrigger($('defBox'), 'bump'); retrigger($('foeHit'), 'go'); }
}
const strip = $('strip');
function reelIdle() { strip.getAnimations().forEach(a => a.cancel()); strip.innerHTML = ''; const x = el('div', 'face idle'); x.append(img('bag')); strip.append(x); }
async function spinReel(t, ms) {
  const H = $('reel').clientHeight, n = 5, pool = f.bag.map(b => b.k).concat(['black', 'black']);
  strip.getAnimations().forEach(a => a.cancel()); strip.innerHTML = '';
  for (let i = 0; i < n - 1; i++) { const k = pool[(Math.random() * pool.length) | 0], x = el('div', 'face'); x.append(tileEl(k === 'black' ? { k } : { k, v: L.tileVal(f, k) })); strip.append(x); }
  const last = el('div', 'face'), tile = tileEl(t); last.append(tile); strip.append(last);
  $('reel').classList.add('spin'); F.SFX.reelSpin();
  const ticks = [0, .22, .44, .62].map((q, i) => later(() => F.SFX.tick(i * .2), ms * q));
  await live(track(strip.animate([{ transform: 'translateY(0)' }, { transform: `translateY(${-(n - 1) * H - H * .1}px)`, offset: .82 }, { transform: `translateY(${-(n - 1) * H}px)` }],
    { duration: ms, easing: 'cubic-bezier(.35,.1,.3,1)', fill: 'forwards' })).finished);
  ticks.forEach(j => { j.fn = () => {}; }); $('reel').classList.remove('spin'); F.SFX.reelStop(f.x.combo.length, t.red ? 'red' : 'black');
  retrigger(tile, 'lit');
  return tile;
}
// a pull's animations; a tap while they run slams them (x4 speed) and queues that tap (Balatro and slot games: tap to skip)
function track(a) { if (pulling) { pulling.anims.push(a); if (pulling.slam) a.playbackRate = 4; } return a; }
function slam() { if (!pulling || pulling.slam) return; pulling.slam = true; pulling.anims.forEach(a => { if (a.playState === 'running') a.playbackRate = 4; }); }
function flyTo(src, to, ms = 300, lift = 30) {   // a copy of `src` flies to `to`; resolves on arrival
  const app = $('app').getBoundingClientRect(), a = src.getBoundingClientRect(), b = to.getBoundingClientRect();
  const c = src.cloneNode(true); c.classList.add('flyTile'); c.classList.remove('lit');
  Object.assign(c.style, { left: a.left - app.left + 'px', top: a.top - app.top + 'px', width: a.width + 'px', height: a.height + 'px' }); $('app').append(c);
  const dx = b.left + b.width / 2 - a.left - a.width / 2, dy = b.top + b.height / 2 - a.top - a.height / 2, s = Math.min(b.width / a.width, b.height / a.height);
  return live(track(c.animate([{ transform: 'none' }, { transform: `translate(${dx * .5}px,${dy * .5 - lift}px) scale(${(1 + s) / 2 * 1.08})`, offset: .45 }, { transform: `translate(${dx}px,${dy}px) scale(${s})` }],
    { duration: ms, easing: 'ease-in-out', fill: 'forwards' })).finished.then(() => c.remove()));
}

// ---------------- buttons and the odds ----------------
function risk() {
  const X = f.x, g = L.gloveNow(f);
  if (!X || X.over || !X.pile.length) return null;
  if (g.dodgeFrom && X.combo.length >= g.dodgeFrom) return { safe: 'dodge' };
  let bust = 0; for (const t of X.pile) if (!t.red && X.lamps + t.lamps >= L.LAMPS) bust++;
  if (!bust) return null;
  if (f.catchesLeft > 0) return { safe: 'catch' };
  return { p: bust / X.pile.length };
}
function updateButtons(on) {
  const X = f.x, live0 = !!X && !X.over, p = live0 ? L.preview(f) : null, pull = $('pull'), pb = $('punchBtn'), r = risk();
  pull.classList.toggle('off', !on || !live0 || !X.pile.length);
  const n = live0 ? X.combo.length : 0;
  pb.classList.toggle('off', !on || !n);
  pb.querySelector('.tot').style.display = n ? '' : 'none';
  $('punchTot').textContent = p ? p.total : 0;
  const g = $('punchGuard'); g.hidden = !(p && p.blocked > 0 && n > 0);
  g.innerHTML = p && p.blocked ? `<img src="${icon('shield')}" alt="" style="width:3.6cqw;height:3.6cqw;vertical-align:-.6cqw"> −${p.blocked}` : '';
  const kill = n > 0 && p.total >= f.foe.hpLeft;
  pb.classList.toggle('kill', kill); pb.classList.toggle('ready', kill && on);
  pb.querySelector('.big').textContent = kill ? 'KO!' : 'PUNCH';
  const rk = $('risk'); rk.hidden = !r; rk.classList.toggle('safe', !!r?.safe);
  pull.classList.toggle('risky', !!r && !r.safe && r.p >= .25);
  if (r?.safe === 'catch') { $('riskIcon').src = icon('catch'); $('riskText').textContent = 'SAFE'; }
  else if (r?.safe === 'dodge') { $('riskIcon').src = icon(L.gloveNow(f).icon); $('riskText').textContent = 'MISS'; }
  else if (r) { $('riskIcon').src = icon('burst'); $('riskText').textContent = Math.round(r.p * 100) + '%'; }
}

// ---------------- the tutorial: a dimmed screen with a hole, a hand and one or two words ----------------
// The game clock stops (F.pause) so his punch waits; a tap on the lit part goes on (and does the thing it points at).
function teach(key, targets, word, o = {}) {
  if (!opts.tutorial || taught.has(key) || (AUTO && !QS.has('hints'))) return null;
  taught.add(key); S.teach = key; setPhase('teach', { key });
  F.pause(true);
  const app = $('app').getBoundingClientRect(), rs = [].concat(targets).map(t => t.getBoundingClientRect());
  const x0 = Math.min(...rs.map(r => r.left)) - app.left, y0 = Math.min(...rs.map(r => r.top)) - app.top;
  const x1 = Math.max(...rs.map(r => r.right)) - app.left, y1 = Math.max(...rs.map(r => r.bottom)) - app.top, pad = app.width * .018;
  const hole = $('teachHole'), T = $('teach'), w = $('teachWord'), hand = $('teachHand');
  Object.assign(hole.style, { left: x0 - pad + 'px', top: y0 - pad + 'px', width: x1 - x0 + pad * 2 + 'px', height: y1 - y0 + pad * 2 + 'px' });
  w.textContent = word; w.style.left = '0px'; T.hidden = false;
  const ww = w.offsetWidth, cx = Math.max(ww / 2 + 8, Math.min(app.width - ww / 2 - 8, (x0 + x1) / 2)), above = !o.below && y0 > app.height * .3;
  w.style.left = cx + 'px'; w.style.top = (above ? y0 - pad * 3.6 : y1 + pad * 2.2 + w.offsetHeight) + 'px';
  const hx = o.hand ? o.hand.getBoundingClientRect() : null;
  hand.style.left = (hx ? hx.left - app.left + hx.width / 2 : (x0 + x1) / 2) + 'px'; hand.style.top = (hx ? hx.top - app.top + hx.height * .3 : y0 + Math.min(y1 - y0, app.width * .2) * .35) + 'px';
  F.SFX.card();
  return new Promise(res => {
    let done = false;
    const close = e => {
      if (done) return; done = true; T.hidden = true; T.onclick = null; S.teach = null; F.pause(false); res(true);
      if (e) document.elementFromPoint(e.clientX, e.clientY)?.closest('.btn,.card')?.click();   // the tap does what the hand points at
      else o.act?.();
    };
    T.onclick = e => {
      const inside = e.clientX >= x0 + app.left - pad && e.clientX <= x1 + app.left + pad && e.clientY >= y0 + app.top - pad && e.clientY <= y1 + app.top + pad;
      if (o.any || inside) close(inside ? e : { clientX: -1, clientY: -1 });
    };
    if (AUTO) setTimeout(() => close(null), AUTO_PANEL);
  });
}
function teachOff() { if (S.teach) { $('teach').hidden = true; $('teach').onclick = null; S.teach = null; F.pause(false); } }

// ---------------- pops and callouts ----------------
function callout(text, color = '#fff', ms = 900, cls = '') {
  const c = $('callout'); c.textContent = text; c.style.color = color; c.className = 'num ' + cls;
  c.animate([{ opacity: 0, transform: 'scale(2.2)' }, { opacity: 1, transform: 'scale(.95)', offset: .16 }, { opacity: 1, transform: 'scale(1)', offset: .78 }, { opacity: 0, transform: 'scale(1.1)' }],
    { duration: dur(ms), easing: 'ease-out' });
}
function pop(x, y, text, cls = '', jitter = 18, ms = 950, rise = 1) {   // rise < 1: drifts up less (the combo total stays under his HP bar)
  const p = el('div', 'pop num ' + cls, text); p.style.left = x + (Math.random() - .5) * jitter * 2 + 'px'; p.style.top = y + (Math.random() - .5) * jitter + 'px'; $('pops').append(p);
  const dx = (Math.random() - .5) * 40 * rise, ty = k => `${-50 - k * rise}%`;
  p.animate([{ transform: 'translate(-50%,-50%) scale(.3)', opacity: 0 }, { transform: `translate(-50%,${ty(40)}) scale(1.25)`, opacity: 1, offset: .15 },
    { transform: `translate(calc(-50% + ${dx}px),${ty(110)}) scale(1)`, opacity: 1, offset: .7 }, { transform: `translate(calc(-50% + ${dx}px),${ty(170)}) scale(.9)`, opacity: 0 }],
    { duration: dur(ms), easing: 'ease-out' }).onfinish = () => p.remove();
}
function stagePt(at) { const s = $('stage'); return { x: s.offsetLeft + at.x, y: s.offsetTop + at.y }; }
function inFight(node) { const a = $('fight').getBoundingClientRect(), r = node.getBoundingClientRect(); return { x: r.left - a.left + r.width / 2, y: r.top - a.top + r.height / 2 }; }

// ---------------- one exchange ----------------
async function exchange() {
  const X = L.startExchange(f), his = X.his;
  clearRow(); reelIdle(); drawCatches(); updateBag(true); setLamps(0); drawDef(false); drawPips(); markNext(); updateButtons(false);
  F.damage(faceK(), f.seed);
  setPhase('exchange', { round: f.round, ex: f.ex, his: his.k, dmg: his.dmg, ms: his.ms, stunned: his.stunned, foeHp: f.foe.hpLeft, hp: f.hp });
  if (f.ex === 0) { callout('ROUND ' + f.round, '#fff', 900); F.SFX.bell(); await waitTap(850); }
  retrigger($('foeHit'), 'go'); retrigger($('defBox'), 'bump');
  if (his.stunned) { const c = inFight($('foeHit')); pop(c.x, c.y - 20, L.TRAITS.set === 'new' ? '½' : 'SLOW', 'block', 0); }
  F.windup(his.k, dur(his.ms));   // he throws at full speed, then the picture stops with his fist in the air until you PUNCH
  ready();
}
async function ready() {
  busy = false; canAct = true; updateButtons(true); markNext(); setLamps(f.x.lamps);
  const X = f.x, p = L.preview(f);
  setPhase('ready', { round: f.round, ex: f.ex, combo: X.combo.length, lamps: X.lamps, total: p.total, foeHp: f.foe.hpLeft, hp: f.hp });
  const q = queued; queued = null;
  if (q === 'pull' && X.pile.length) return doPull();
  if (q === 'punch' && X.combo.length) return doPunch();
  const g = gen;
  if (f.nEx === 1 && !X.combo.length) {
    await teach('his', [$('foeHit'), $('defBox')], 'HIS PUNCH', { any: true, hand: $('foeHit') });
    if (g !== gen) return;
    if (await teach('pull', $('pull'), 'PULL', { act: () => doPull() })) return;
  } else if (f.nEx === 1 && X.combo.length >= 2) {
    if (await teach('punch', $('punchBtn'), 'PUNCH FIRST!', { act: () => doPunch() })) return;
  } else if (X.combo.length && p.total >= f.foe.hpLeft) {
    if (await teach('kill', $('punchBtn'), 'K.O.!', { act: () => doPunch() })) return;
  }
  if (AUTO) later(bot, dur(AUTO_TAP));
}
function bot() {
  if (!f?.x || f.x.over || !canAct || busy) return;
  if (S.sheet || S.teach) { setTimeout(bot, 300); return; }   // waits while paused
  const X = f.x, canPull = X.pile.length > 0;
  let m = canPull ? L.bestMove(f) : 'punch';
  if (m === 'punch' && !X.combo.length) { if (!canPull) return; m = 'pull'; }   // nothing to throw: pull
  m === 'pull' ? doPull() : doPunch();
}
async function doPull() {
  const X = f?.x;
  if (pulling && X && !X.over) { queued = 'pull'; slam(); retrigger($('pull'), 'bump'); return; }   // tapped again mid-pull
  if (busy || !canAct || !X || X.over || !X.pile.length) return;
  busy = true; canAct = false; updateButtons(false); retrigger($('pull'), 'bump');
  const ev = L.pull(f), ms = dur(L.pullMs(f, ev.tile));   // the reel and the fly take exactly the rule's pull time
  pulling = { anims: [], slam: false };
  setPhase('pull', { t: ev.t, lamps: X.lamps, combo: X.combo.length });
  const face = await spinReel(ev.tile, ms * .62), fly = ms * .38 / (pulling?.slam ? 4 : 1);
  updateBag(true);
  if (ev.t === 'red' || ev.t === 'catch') await toSlot(ev, face, fly);
  else if (ev.t === 'black') await toLamp(ev, face, fly);
  else if (ev.t === 'dodge') await dodge(face, fly);
  else if (ev.t === 'bust') { pulling = null; queued = null; return bust(ev, face); }
  pulling = null;
  if (ev.auto || !X.pile.length) {   // row full or bag empty: it goes now
    queued = null;
    if (!X.combo.length) return ready();
    callout(X.combo.length >= L.gloveNow(f).slots ? 'FULL!' : 'EMPTY!', 'var(--gold)', 600, 'soft'); return doPunch(true);
  }
  ready();
}
async function toSlot(ev, face, ms) {
  const s = slotEls[ev.slot], X = f.x;
  if (ev.t === 'catch') {        // his black turns into your punch
    F.SFX.chain(); callout('CAUGHT!', 'var(--blue)', 800);
    const caught = tileEl(ev.made); face.replaceWith(caught); retrigger(caught, 'lit'); face = caught;
    drawCatches(); setLamps(ev.lamps);
  }
  await flyTo(face, s, ms);
  const c = X.combo[ev.slot]; s.append(tileEl(c)); s.append(el('div', 'dmg num', c.v * ev.m));
  retrigger(s, 'hit'); F.SFX.pop(ev.slot * 2 + 2);
  if (ev.cool) { const l = lamps()[ev.lamps]; setLamps(ev.lamps); if (l) retrigger(l, 'cool'); F.SFX.boost('mul'); }   // STEADY jab: a lamp goes out
  if (ev.m >= 3) F.SFX.boost('mul');
  reelIdle(); updateButtons(false); retrigger($('punchTot'), 'bump'); markNext();
}
async function toLamp(ev, face, ms) {
  const ls = lamps(), lit = ls.slice(ev.lamps0, ev.lamps);
  F.lurch();   // he twitches closer
  await flyTo(face, lit[lit.length - 1] || ls[L.LAMPS - 1], ms, 20);
  setLamps(ev.lamps); lit.forEach(l => retrigger(l, 'boom')); F.SFX.guardHit();
  reelIdle(); updateButtons(false);
  await teach('lamp', $('lampPill'), '2 = BUST', { any: true });
}
async function dodge(face, ms) {
  F.SFX.whiffBy(1); callout('MISS', 'var(--cyan)', 700);
  face.animate([{ transform: 'none', opacity: 1 }, { transform: 'translateX(60%) rotate(25deg)', opacity: 0 }], { duration: ms, easing: 'ease-in', fill: 'forwards' });
  await wait(ms * SPEED); reelIdle();
}
async function bust(ev, face) {
  setPhase('bust', { lost: ev.lost.length });
  const ls = lamps();
  await flyTo(face, ls[L.LAMPS - 1], 200, 10);
  setLamps(L.LAMPS); ls.forEach(l => retrigger(l, 'boom'));
  retrigger($('machine'), 'shake'); retrigger($('bottom'), 'wobble'); F.SFX.bigNumber(); callout('BUST!', '#ff6a55', 900);
  F.dizzy(.35, .35);   // doing badly: the view swims before his punch lands
  slotEls.forEach(s => s.querySelector('.tile') && retrigger(s, 'lost'));
  updateButtons(false);
  const r = L.bustHit(f), each = f.x.his.dmg, hp0 = r.hp + r.taken, c = inFight($('youWrap'));
  await wait(300);
  for (let i = 0; i < r.hits; i++) {   // SPEEDY: two hits
    if (i) { await wait(160); F.windup(f.x.his.k, 1); }
    await live(F.hisLand({ dmg: each, big: true }));
    pop(c.x + (r.hits > 1 ? (i ? 30 : -30) : 0), c.y - 24, '-' + each, 'hurt', 4); setYouHp(Math.max(0, hp0 - each * (i + 1))); retrigger($('you'), 'shake');
  }
  if (r.hits > 1) callout('×' + r.hits, '#ff6a55', 800);
  await wait(700);
  if (r.down) return down();
  afterEx();
}
// The cinematic: only for a punch that does well (Kao et al. CHI 2024: juice on success raised play time, always-on juice did not).
function cineFor(total, willKO) {
  if (willKO) return { k: 'ko', word: 'K.O.!' };
  if (total < Math.max(15, Math.round(f.foe.hp * .4))) return null;
  return total >= 40 ? { k: 'dev', word: 'DEVASTATING!' } : total >= 25 ? { k: 'dev', word: 'CRUSHING!' } : { k: 'great', word: 'GREAT!' };
}
async function doPunch(auto) {
  const X = f?.x;
  if (!X || X.over) return;
  if (!auto && (busy || !canAct || !X.combo.length)) return;
  busy = true; canAct = false; queued = null; F.windHold(); updateButtons(false); F.SFX.sting();
  resolveEx(L.commit(f));
}
async function resolveEx(res) {
  setPhase('commit', { total: res.total, dealt: res.dealt, taken: res.taken, ko: res.ko, down: res.down, blocked: res.blocked });
  await yourHits(res); if (!res.ko) { await hisHits(res); if (res.down) return down(); }
  if (res.ko) return ko();
  afterEx();
}
async function yourHits(res) {
  const parts = res.parts; if (!parts.length) return;
  const shown = res.shown, absorbedBy = res.absorbed;   // the rules split the total punch by punch (L.split)
  let hp = res.foeHp + res.dealt, sum = 0, cined = null;
  if (res.blocked) F.setGuardUp(true);
  for (let i = 0; i < parts.length; i++) {
    const dmg = Math.min(shown[i], hp), willKO = res.ko && dmg > 0 && hp - dmg <= 0, last = i === parts.length - 1, s = slotEls[i], absorbed = absorbedBy[i];
    const cn = (willKO || last) && dmg > 0 ? cineFor(res.total, willKO) : null;
    if (cn) cined = cn;
    retrigger(s, 'hit');
    await live(new Promise(r => F.punch({ side: i % 2 ? 'R' : 'L', heavy: Math.min(1, .15 + dmg / 14 + (last ? .15 : 0)), blocked: dmg === 0, ko: willKO, cine: cn?.k, chain: i > 0, onContact: at => {
      const p = stagePt(at);
      if (i === 0 && $('callout').classList.contains('soft')) $('callout').getAnimations().forEach(a => a.finish());   // FULL! clears as the first number lands
      if (absorbed) pop(p.x - 40, p.y - 30, `−${absorbed}`, 'block');
      if (dmg) { hp -= dmg; sum += dmg; pop(p.x, p.y, '-' + dmg, dmg >= 12 ? 'big' : ''); setFoeHp(Math.max(0, hp)); F.SFX.pop(i * 2 + 4); }
      if (cn && !willKO) callout(cn.word, cn.k === 'great' ? '#bfe3ff' : 'var(--gold)', 1150, 'cine');
      s.classList.add('spent'); r();
    } })));
    if (willKO) break;
    await wait(last ? 0 : 40);   // the next fist's own draw-back fills the gap
  }
  F.setGuardUp(false);
  setPhase('punch', { total: res.total, ko: res.ko, n: parts.length, cine: cined?.k || null });
  if (parts.length > 1 && sum && !res.ko) { const c = inFight($('stage')); later(() => pop(c.x, c.y * .55, `= ${res.dealt}`, 'big', 0, 950, .3), cined ? 600 : 0); }
  if (!res.ko) await wait(cined ? F.cineLen * 1000 + 250 : 380);
}
async function hisHits(res) {
  const X = f.x, his = X.his;
  setPhase('hit', { his: his.k, dmg: his.dmg, taken: res.taken });
  retrigger($('foeHit'), 'go');
  await live(F.hisLand({ dmg: his.dmg, big: false }));
  const c = inFight($('youWrap'));
  pop(c.x, c.y - 24, '-' + res.taken, 'hurt', 4); retrigger($('you'), 'shake');
  setYouHp(res.hp);
  await wait(620);
}
async function afterEx() {
  F.damage(faceK(), f.seed); drawPips(); setLamps(f.x.lamps); markNext();
  await wait(420);
  const a = L.afterExchange(f);
  if (a === 'next') return exchange();
  if (a === 'corner') { await cornerPanel(); return exchange(); }
  if (a === 'judges') return judgesPanel();
}
async function ko() {
  setPhase('ko', { round: f.round, ex: f.ex });
  callout('K.O.!', 'var(--gold)', 1400, 'cine'); F.SFX.fanfare(); F.damage(Math.max(faceK(), .8), f.seed);
  await wait(2000);
  end();
}
async function down() {
  setPhase('down', { round: f.round });
  callout('DOWN!', '#ff6a55', 1200); F.SFX.lose(); F.dizzy(1, 1.4);
  await wait(1600);
  end();
}

// ---------------- the corner: his face, your health back, his next punches, one card ----------------
const LANE = { red: ['bag', 'PUNCH'], cut: ['safe', 'SAFE'] };
function bagDots(mix, o = {}) {   // your bag, one square per tile: red punches, his blacks
  const d = el('div', 'dots');
  const put = (cls, n) => { for (let i = 0; i < n; i++) d.append(el('i', cls)); };
  put('r', mix.red); if (o.add === 'r') d.append(el('i', 'r new'));
  put('k', mix.black); if (o.cut === 'k') d.append(el('i', 'k gone'));
  put('d', mix.dbl); if (o.cut === 'd') d.append(el('i', 'd gone'));
  return d;
}
function cardEl(c) {
  const P = L.cardPreview(f, c), M = L.MOVES[c.k], kind = c.t === 'cut' ? 'cut' : 'red';
  const [cls, lane] = LANE[kind], d = el('div', 'card ' + cls), art = el('div', 'art'), fx = el('div', 'fx');
  d.append(el('div', 'lane', lane), art);
  let name = '';
  if (c.t === 'add') {
    art.append(tileEl({ k: c.k, v: P.v }), img('add', 'o')); name = `+1 ${M.name}`;
    fx.append(bagDots(P.before, { add: 'r' }));
  } else if (c.t === 'train') {
    art.append(img(M.icon), img('upgrade', 'o')); name = `${M.name} +1`;
    const row = el('div', 'row'); row.append(tileEl({ k: c.k, v: P.v0 }), el('span', 'ar', '→'), tileEl({ k: c.k, v: P.v1 })); fx.append(row);
    fx.append(el('div', 'note num', '×' + P.n0));
  } else {
    art.append(tileEl({ k: 'black' }), img('scissors', 'o')); name = '−1 BLACK';
    const a = P.before, b = P.after, cut = a.dbl > b.dbl ? 'd' : 'k', bb = { ...b };
    fx.append(bagDots(bb, { cut }));
  }
  d.append(el('div', 'nm', name), fx);
  return d;
}
function punchChip(k, dmg) { const s = el('span', 'pc'); s.append(img(L.HIS[k].icon), el('span', 'num', dmg)); return s; }
function cornerPanel() {
  return live(new Promise(async resolve => {
    const R = f.rounds[f.round - 1], c = L.corner(f), won = R.dealt > R.taken ? 'you' : R.dealt < R.taken ? 'him' : 'even';
    setPhase('corner', { round: f.round, cards: c.cards.map(x => x.t + (x.k ? ':' + x.k : '')), hp0: c.hp0, hp: c.hp, dealt: R.dealt, taken: R.taken });
    F.SFX.bell(); F.lowHp(0);
    $('cnTitle').textContent = 'ROUND ' + f.round;
    const sc = $('cnScore'); sc.innerHTML = '';
    const side = (k, v, w) => { const s = el('div', 'sc ' + (w ? 'won' : '')); s.append(img(k), el('span', 'num', v)); return s; };
    sc.append(side('jab', R.dealt, won === 'you'), el('span', 'vs num', won === 'you' ? '10-9' : won === 'him' ? '9-10' : '10-10'), side('his-hook', R.taken, won === 'him'));
    const hp = $('cnHp'); hp.innerHTML = ''; hp.append(img('heal'), el('span', 'num', c.hp0), el('span', 'ar', '→'), el('span', 'num heal', c.hp));
    const nx = $('cnNext'); nx.innerHTML = ''; nx.append(el('span', 'lab', 'NEXT')); c.next.forEach(n => nx.append(punchChip(n.k, n.dmg)));
    const fh = $('cnFoeHp'); fh.style.transform = `scaleX(${f.foe.hpLeft / f.foe.hp})`;
    const box = $('cnCards'); box.innerHTML = '';
    const els = c.cards.map((x, i) => { const d = cardEl(x); box.append(d); later(() => { d.classList.add('in'); F.SFX.card(); }, dur(380 + i * 120)); return d; });
    show('corner');
    later(() => setYouHp(c.hp), dur(500));
    await live(F.portrait($('cnFace')));     // the 3D keeps running here: the close-up renders on the next frame
    await wait(800);
    let done = false;
    const choose = i => {
      if (done) return; done = true; F.SFX.pick();
      els.forEach((d, j) => d.classList.add(j === i ? 'chosen' : 'gone'));
      L.pickCorner(f, c.cards[i]); setPhase('picked', { card: f.picks[f.picks.length - 1], round: f.round });
      later(() => { show('corner', false); updateBag(false); later(resolve, dur(260)); }, dur(520));
    };
    els.forEach((d, i) => d.onclick = () => choose(i));
    await teach('card', box, 'PICK 1', { any: true, below: true, hand: els[1] || els[0] });
    if (AUTO) later(() => choose(c.cards.indexOf(L.bestPick(f, c.cards))), dur(AUTO_PANEL));
  }));
}

// ---------------- the judges (no KO after three rounds) ----------------
function judgesPanel() {
  return live(new Promise(async resolve => {
    const o = L.judges(f);
    setPhase('judges', { kind: o.kind, win: o.win, draw: o.draw, cards: o.cards });
    F.SFX.bell(); F.lowHp(0);
    const box = $('jdCards'); box.innerHTML = ''; $('jdKind').textContent = ''; $('jdRes').textContent = ''; $('jdRes').className = 'ribbon t'; $('jdRes').style.visibility = 'hidden';
    $('jdBtn').classList.add('wait');
    const els = o.cards.map(cd => {
      const d = el('div', 'jc'); d.append(img('scorecard'));
      const n = el('div', 'nums'); n.append(el('span', 'num ' + (cd.you > cd.him ? 'w' : ''), cd.you), el('span', 'dash', '-'), el('span', 'num ' + (cd.him > cd.you ? 'w' : ''), cd.him));
      d.append(n); box.append(d); return d;
    });
    show('judges');
    await live(F.portrait($('jdFace')));
    for (let i = 0; i < els.length; i++) { await wait(650); els[i].classList.add('in'); F.SFX.card(); }
    await wait(600);
    $('jdKind').textContent = o.kind; retrigger($('jdKind'), 'bump');
    const r = $('jdRes'); r.textContent = o.draw ? 'DRAW' : o.win ? 'YOU WIN!' : 'YOU LOSE'; r.classList.add(o.draw ? 'blue' : o.win ? 'gold' : 'red'); r.style.visibility = 'visible'; retrigger(r, 'bump');
    o.win ? F.SFX.fanfare() : F.SFX.lose();
    $('jdBtn').classList.remove('wait');
    let done = false;
    const go = () => { if (done) return; done = true; show('judges', false); later(() => { resolve(); end(); }, dur(260)); };
    $('jdBtn').onclick = go;
    if (AUTO) later(go, dur(AUTO_PANEL));
  }));
}

// ---------------- the walk-out ----------------
const TRAIT = { rookie: 'black', speedy: 'hourglass', iron: 'shield', bomber: 'dbl', champ: 'crown' };
const NEW = {   // the one new thing each rival brings (an icon and a few words)
  speedy: () => ['hourglass', 'FAST PUNCHES'],
  iron: x => ['shield', `GUARD −${x.guard}`],
  bomber: () => ['dbl', 'DOUBLE BLACK'],
  champ: () => ['crown', 'THE BOSS'],
};
function drawCircuit(box, at) {
  box.innerHTML = '';
  L.FOES.forEach((x, i) => {
    const r = L.foeOf(i, f.foe.circuit), n = el('div', 'node' + (r.boss ? ' boss' : '') + (i < at ? ' done' : i === at ? ' now' : '')), b = el('div', 'ball');
    b.append(img(TRAIT[r.id])); n.append(b, el('div', 'nm', r.name)); box.append(n);
  });
}
function intro() {
  return live(new Promise(resolve => {
    const x = f.foe, b = L.foeBlacks(f), C = L.CIRCUITS[x.circuit - 1];
    setPhase('intro', { foe: x.id, name: x.name, hp: x.hp, blacks: b.blacks, dbl: b.dbl });
    drawCircuit($('introPath'), opts.foe || 0); $('introName').textContent = x.name;
    $('introTag').textContent = `${C.name}  ${(opts.foe || 0) + 1}/5`;
    const st = $('introStats'); st.innerHTML = '';
    const stat = (node, v, cls = '') => { const d = el('div', 'stat ' + cls); d.append(node, el('div', 'num', v)); st.append(d); };
    const hpi = el('div', 'hpi'); hpi.append(el('i')); stat(hpi, x.hp);
    stat(img(b.dbl ? 'dbl' : 'black'), b.dbl ? `${b.blacks}+${b.dbl}` : b.blacks, 'hot');
    if (x.guard) stat(img('shield'), x.guard, 'cold');
    const pl = $('introPlan'); pl.innerHTML = ''; pl.append(el('span', 'lab', 'R1')); x.plan[0].forEach(k => pl.append(punchChip(k, x.dmg[k])));
    const nw = NEW[x.id]?.(x); $('introNew').innerHTML = nw ? `<img src="${icon(nw[0])}" alt="">${nw[1]}` : '';
    show('intro');
    let done = false;
    const go = () => { if (done) return; done = true; show('intro', false); F.SFX.bell(); later(resolve, dur(250)); };
    $('fightBtn').onclick = go;
    if (AUTO) later(go, dur(AUTO_PANEL));
  }));
}

function result() {
  const o = f.over || { win: false, by: 'ko', round: f.round };
  return { win: !!o.win, draw: !!o.draw, by: o.by, kind: o.kind || 'KO', round: o.round, cards: o.cards || null, foe: opts.foe || 0, circuit: f.foe.circuit,
    name: f.foe.name, stats: { ...f.stats }, hp: f.hp, maxHp: f.maxHp, rounds: f.rounds.slice(0, L.ROUNDS), picks: f.picks.slice(), quit: false };
}
function end() {
  canAct = false; busy = true; queued = null; pulling = null; teachOff(); F.lowHp(0);
  const res = result();
  setPhase(res.win ? 'win' : 'lose', res);
  const fin = finish; finish = null; f = S.run = null; fin?.(res);
}
function drawFight(instant) {
  drawFoe(); setFoeHp(f.foe.hpLeft, instant); setYouHp(f.hp, instant); drawPips();
  drawGlove(); drawCatches(); drawSlots(); clearRow(); reelIdle(); updateBag(false); setLamps(0); drawDef(false); updateButtons(false);
}

// act on touch-down, not on release (r16 "feels very laggy": a click waits for the finger to lift); a click with no
// touch-down before it (the tutorial's pass-through tap, keyboard) still works
function press(node, fn) {
  let downAt = -1e9;
  node.addEventListener('pointerdown', e => { if (e.button > 0) return; downAt = performance.now(); fn(); });
  node.addEventListener('click', () => { if (performance.now() - downAt > 700) fn(); });
}
press($('pull'), () => doPull());
press($('punchBtn'), () => { if (pulling && f?.x && !f.x.over) { queued = 'punch'; slam(); return; } doPunch(); });
$('pauseBtn').addEventListener('click', async () => {
  if (!f || !opts.onPause || S.sheet || S.teach) return;   // not on top of another sheet
  // freeze the match screen's own animations too (reel, flying tiles, pops); the 3D and every timer stop with F.pause
  const mv = $('matchView'), held = document.getAnimations().filter(a => { const t = a.effect?.target; return a.playState === 'running' && t && (mv.contains(t) || t.classList?.contains('flyTile')); });
  held.forEach(a => a.pause());
  const r = await opts.onPause();
  let fin = null, res = null;
  if (r === 'quit' && f) { fin = finish; finish = null; res = { ...result(), win: false, quit: true };
    gen++; F.reset();   // the quit match's continuations stay parked (live) and its timers are gone
    ['corner', 'judges', 'intro'].forEach(id => show(id, false));
    canAct = false; busy = true; queued = null; pulling = null; f = S.run = null; F.lowHp(0); setPhase('quit'); }
  held.forEach(a => { if (a.playState === 'paused') a.play(); });   // after a quit they just finish off-screen
  fin?.(res);
});

export function playMatch(o) {
  opts = o; gen++; queued = null; pulling = null; teachOff();
  f = S.run = L.newFight(o.seed ?? ((Math.random() * 1e9) | 0), { foe: o.foe || 0, circuit: o.circuit || 1, glove: o.glove, glvl: o.glvl, moves: o.moves, bonusHp: o.bonusHp,
    script: o.tutorial ? TUT_SCRIPT : null });
  return new Promise(res => {
    finish = res; F.reset(); F.damageNow(0); drawFight(true); layout();
    intro().then(exchange);
  });
}
