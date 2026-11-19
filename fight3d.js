// 3D fight view: copied from keep/rt/web/game.js (look, lights, rival and arms, pose tweening, sounds, sparks); the slot
// page (match.js) drives punches through the exported F object.
// Round 14 juice (owner 2026-11-18T13:44Z "cinematic punches of effective punches when performing well, and dizzy effect
// when getting hit and doing badly"): cinematic zoom only on a big or KO punch (juice on success only, Kao et al. CHI 2024;
// Smash Special Zoom / Finish Zoom), a dazed rival, and a dizzy first-person view when you get hit (Thrill of the Fight
// double vision, vignette and desaturation; Fight Night Round 3 blur and ear ringing). Shake and big effects can be turned
// off (Xbox accessibility guideline 117). Research: ~/ROBLOX/research/research/synthesis/2026-11-18-17-ragdoll-mma-juice-meta-r14.md.
// Models and lighting are read from keep/rt/web/assets (not copied, not modified).
import * as THREE from 'three';
import { GLTFLoader } from './rt/vendor/jsm/loaders/GLTFLoader.js';
import { RectAreaLightUniformsLib } from './rt/vendor/jsm/lights/RectAreaLightUniformsLib.js';
const AS = './rt/assets/';

const QS = new URLSearchParams(location.search);
const STILL = QS.get('still');            // ?still=guard&arms=fp_punch_r : frozen pose for look comparison
const TEST = QS.has('test');
const $ = id => document.getElementById(id);
const stage = $('stage'), world = $('world'), armsLayer = $('armsLayer'), fxCanvas = $('fx'), fx = fxCanvas.getContext('2d');
const cineCv = $('cineCv'), ghost = $('ghost'), gctx = ghost.getContext('2d'), dizzyV = $('dizzyV');   // round-14 juice layers

// ---------------- tuning ----------------
// Look (owner 2026-11-17T22:12Z: "i dont like the lighting or shader, feels very reflective and not well rendered or shadow").
// ?look=old restores the first real-time look for side-by-side comparison; every value below can be overridden by its query key.
const OLD = QS.get('look') === 'old';
const q = (k, d) => +(QS.get(k) ?? d);
const T = {
  exposure: q('exp', OLD ? .80 : .64), area: q('area', OLD ? 1 : .6), key: q('key', OLD ? 1 : 1.3), spot: q('spot', OLD ? 1 : 1),
  hemi: q('hemi', OLD ? .9 : 0), shadow: q('shadow', OLD ? .32 : .42), sat: q('sat', OLD ? 1.3 : .95), con: q('con', OLD ? 1.05 : 1.04),
  coat: q('coat', OLD ? -1 : .1),           // clearcoat; -1 keeps the exported .18 wet-plastic coat
  rough: q('rough', OLD ? 1 : 1.2),         // multiplies the Meshy roughness map (~.31) -> ~.37 satin vinyl
  spec: q('spec', OLD ? 1 : 1),             // specular strength
  env: q('env', OLD ? 0 : .25),             // soft arena environment light (image-based)
  ao: q('ao', OLD ? 0 : 1), aod: q('aod', OLD ? 0 : .9),    // baked crease shadow; aod = how much it also darkens direct light
  soft: q('soft', OLD ? 0 : 10),            // key-light shadow blur (0 = old filtered shadow)
  blob: q('blob', OLD ? 0 : .55),           // contact shadow under the feet
  // AgX (the old look) greys out bright vinyl skin and red leather; Neutral keeps the Cycles colours (skin measured 180/117/80 vs 179/114/78).
  tone: QS.get('tone') ?? (OLD ? 'agx' : 'neutral'),
  jab:   { startup: .055, stop: .075, recover: .13, dmg: 4 },
  cross: { startup: .075, stop: .12,  recover: .17, dmg: 7 },
  counterStop: .17, blockedStop: .03, koStop: .26,
  rivalTel: .42, rivalTelArmor: .34, rivalStrike: .10, rivalDmg: 12, chip: 3, playerHitStop: .11, playerBlockStop: .08,
  buffer: .22, dodge: .34,
};

const FXS = { shake: 1, effects: 1 };   // player settings (Settings sheet): 0 turns screen shake / big effects off
const meta = await (await fetch(AS + 'scene.json')).json();
RectAreaLightUniformsLib.init();
// CSS grade on the 3D layers only (the plate is already graded); the new look needs almost none because Neutral tone mapping keeps colour.
$('rivalCanvas').style.filter = `saturate(${T.sat}) contrast(${T.con})`; $('armsCanvas').style.filter = `saturate(${q('asat', OLD ? 1 + (T.sat - 1) * .3 : .92)}) hue-rotate(${q('ahue', OLD ? 0 : 6)}deg) contrast(${T.con})`;   // ahue > 0 pulls crimson glove red toward orange-red

// ---------------- renderers, cameras, lights ----------------
function renderer(canvas) {
  const r = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'high-performance' });
  r.setClearColor(0x000000, 0); r.outputColorSpace = THREE.SRGBColorSpace;
  r.toneMapping = { agx: THREE.AgXToneMapping, neutral: THREE.NeutralToneMapping, aces: THREE.ACESFilmicToneMapping }[T.tone] ?? THREE.AgXToneMapping;
  r.toneMappingExposure = T.exposure;
  return r;
}
const rivalR = renderer($('rivalCanvas')), armsR = renderer($('armsCanvas'));
rivalR.shadowMap.enabled = true; rivalR.shadowMap.type = T.soft > 0 ? THREE.VSMShadowMap : THREE.PCFShadowMap;
function camera() {
  const c = new THREE.PerspectiveCamera(meta.camera.vfov_deg, meta.camera.aspect, .1, 120);
  c.position.fromArray(meta.camera.pos); c.lookAt(new THREE.Vector3().fromArray(meta.camera.target)); return c;
}
const OS = 1.3, CROWN = q('crown', 1);   // the arena layer is rendered 30% wider than the stage (same centre) so dodges and shake never show an edge
const rivalCam = camera(), armsCam = camera();
rivalCam.fov = 2 * Math.atan(OS * Math.tan(THREE.MathUtils.degToRad(meta.camera.vfov_deg) / 2)) * 180 / Math.PI; rivalCam.updateProjectionMatrix();
// r16, owner 2026-11-18T19:42Z "we dont need to see that much leg i think": the arena camera zooms in about a point near his
// crown, so his head keeps its place under the health bar and the extra size goes downward (less shorts and legs, a bigger
// face). Your gloves have their own camera and stay as they were.
// ZDN then drops the whole view a little so there is room for the dazed stars between his crown and the health bar.
const ZOOM = q('zoom', 1.34), ZP = q('zp', .16), ZDN = q('zdn', .07);
if (ZOOM !== 1) { const FW = 1000, FH = FW / meta.camera.aspect, w = FW / ZOOM, h = FH / ZOOM; rivalCam.setViewOffset(FW, FH, (FW - w) / 2, ZP * FH * (1 - 1 / ZOOM) - ZDN * h, w, h); }
const rivalScene = new THREE.Scene(), armsScene = new THREE.Scene();

function addLights(scene, withShadow) {
  for (const L of meta.lights) {
    const col = new THREE.Color(L.color[0], L.color[1], L.color[2]);
    const pos = new THREE.Vector3().fromArray(L.pos), dir = new THREE.Vector3().fromArray(L.dir);
    if (L.type === 'AREA' && L.name.startsWith('Warm softbox')) {
      // Key light: a wide soft spot so it can cast the rival's shadow on the canvas (area lights cannot).
      const s = new THREE.SpotLight(col, L.watts / Math.PI * T.key, 0, 1.0, 1.0, 2);
      s.position.copy(pos); s.target.position.copy(pos.clone().add(dir)); scene.add(s, s.target);
      if (withShadow) { s.castShadow = true; s.shadow.camera.near = 2; s.shadow.camera.far = 20;
        if (T.soft > 0) { s.shadow.mapSize.set(1024, 1024); s.shadow.radius = T.soft; s.shadow.blurSamples = 16; s.shadow.bias = -.0006; s.shadow.normalBias = .02; }
        else { s.shadow.mapSize.set(2048, 2048); s.shadow.bias = -.0004; s.shadow.radius = 6; s.shadow.normalBias = .04; } }
    } else if (L.type === 'AREA') {
      const A = L.shape === 'DISK' || L.shape === 'ELLIPSE' ? Math.PI * L.size * (L.shape === 'DISK' ? L.size : L.size_y) / 4 : L.size * (L.shape === 'SQUARE' ? L.size : L.size_y);
      const side = Math.sqrt(A);
      const r = new THREE.RectAreaLight(col, L.watts / (Math.PI * A) * T.area, side, side);
      r.position.copy(pos); r.lookAt(pos.clone().add(dir)); scene.add(r);
    } else if (L.type === 'SPOT') {
      const s = new THREE.SpotLight(col, L.watts / (4 * Math.PI) * T.spot, 0, L.spot_size / 2, L.spot_blend, 2);
      s.position.copy(pos); s.target.position.copy(pos.clone().add(dir)); scene.add(s, s.target);
    }
  }
  if (T.hemi > 0) scene.add(new THREE.HemisphereLight(new THREE.Color(.10, .16, .34), new THREE.Color(.03, .06, .14), T.hemi));
}
addLights(rivalScene, true); addLights(armsScene, false);
const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.ShadowMaterial({ opacity: T.shadow }));
floor.rotation.x = -Math.PI / 2; floor.position.y = meta.floor_y + .003; floor.receiveShadow = true; rivalScene.add(floor);

// Soft arena environment: a dim navy dome with a blue canvas below and blurred copies of the Blender area lights, so every
// surface gets wrap-around bounce light and soft highlights instead of a flat ambient (replaces the hemisphere light).
const CENTRE = new THREE.Vector3(.25, 3, 0);
function arenaEnv(r) {
  const s = new THREE.Scene(), R = 40, g = new THREE.SphereGeometry(R, 48, 24), P = g.attributes.position, col = [];
  const top = new THREE.Color(.006, .010, .028), hor = new THREE.Color(.045, .075, .17), flo = new THREE.Color(.05, .10, .24), c = new THREE.Color();
  for (let i = 0; i < P.count; i++) { const y = P.getY(i) / R;
    if (y >= 0) c.copy(hor).lerp(top, Math.min(1, y * 1.8)); else c.copy(hor).lerp(flo, Math.min(1, -y * 4));
    col.push(c.r, c.g, c.b); }
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  const dome = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })); dome.position.copy(CENTRE); s.add(dome);
  for (const L of meta.lights) {
    if (L.type !== 'AREA') continue;
    const A = L.shape === 'DISK' || L.shape === 'ELLIPSE' ? Math.PI * L.size * (L.shape === 'DISK' ? L.size : L.size_y) / 4 : L.size * (L.shape === 'SQUARE' ? L.size : L.size_y);
    const p = new THREE.Mesh(new THREE.CircleGeometry(L.size / 2, 32),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(...L.color).multiplyScalar(L.watts / (Math.PI * A) * .5), side: THREE.DoubleSide }));
    p.position.fromArray(L.pos); p.lookAt(CENTRE); s.add(p);
  }
  const pm = new THREE.PMREMGenerator(r), tex = pm.fromScene(s, .035, .1, 100, { position: CENTRE }).texture; pm.dispose();
  return tex;
}
if (T.env > 0) { rivalScene.environment = arenaEnv(rivalR); armsScene.environment = arenaEnv(armsR); }

// Contact shadow: a soft dark ellipse under each foot (fades as the foot lifts) and a faint one under the body; the key-light shadow alone floats.
// Drawn analytically (no texture) so nothing depends on an image upload.
const blobs = ['L', 'R', 'body'].map(() => { const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, uniforms: { op: { value: T.blob } },
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'uniform float op; varying vec2 vUv; void main() { float d = clamp(1.0 - length(vUv - 0.5) * 2.0, 0.0, 1.0); gl_FragColor = vec4(0.0, 0.0, 0.0, op * pow(d, 1.4)); }' }));
  m.rotation.x = -Math.PI / 2; m.renderOrder = 1; m.visible = T.blob > 0; rivalScene.add(m); return m; });

// ---------------- load models and pose library ----------------
const loader = new GLTFLoader(); const prog = {};
function load(url) {
  return loader.loadAsync(url, e => { prog[url] = e.total ? e.loaded / e.total : 0; const v = Object.values(prog);
    window.__loadPct = Math.round(100 * v.reduce((a, b) => a + b, 0) / 2); window.dispatchEvent(new Event('loadpct')); });
}
const aoTex = url => T.ao > 0 ? new THREE.TextureLoader().loadAsync(url) : null;
const [rivalG, armsG, rivalAO, armsAO] = await Promise.all([load(AS + 'rival.glb'), load(AS + 'arms.glb'),
  aoTex(AS + 'rival_ao.jpg'), aoTex(AS + 'arms_ao.jpg')]);

// Satin vinyl instead of wet plastic: a thin clearcoat, a little more roughness, no metal, and the Blender-baked crease
// occlusion (rest pose, keep/rt/source/bake_ao.py) darkening both bounce and part of the direct light.
// Each material is changed once: the two first-person arms share one material (a per-mesh pass multiplied roughness twice).
function restyle(root, ao) {
  if (OLD) return;
  if (ao) { ao.flipY = false; ao.colorSpace = THREE.NoColorSpace; ao.channel = 0; ao.needsUpdate = true; }
  const k = T.aod.toFixed(3), done = new Set();
  root.traverse(o => { if (!o.isMesh || done.has(o.material)) return; const m = o.material; done.add(m);
    if (T.coat >= 0 && 'clearcoat' in m) m.clearcoat = T.coat;
    m.roughness *= T.rough; m.metalness = 0;
    if ('specularIntensity' in m) m.specularIntensity = T.spec;
    m.envMapIntensity = T.env;
    if (ao && m.map) {
      m.aoMap = ao; m.aoMapIntensity = T.ao;
      m.onBeforeCompile = sh => { sh.fragmentShader = sh.fragmentShader.replace('#include <aomap_fragment>', `#include <aomap_fragment>
#ifdef USE_AOMAP
  reflectedLight.directDiffuse *= mix( 1.0, ambientOcclusion, ${k} );
  reflectedLight.directSpecular *= mix( 1.0, ambientOcclusion, ${k} );
#endif`); };
      m.customProgramCacheKey = () => 'aod' + k;
    }
    m.needsUpdate = true; });
}
restyle(rivalG.scene, rivalAO); restyle(armsG.scene, armsAO);

function poseLibrary(gltf) {
  const byFrame = {}; for (const [n, f] of Object.entries(meta.poses)) byFrame[f] = n;
  const lib = {};
  for (const tr of gltf.animations[0].tracks) {
    const i = tr.name.lastIndexOf('.'), node = tr.name.slice(0, i), prop = tr.name.slice(i + 1), n = tr.getValueSize();
    for (let k = 0; k < tr.times.length; k++) {
      const name = byFrame[Math.round(tr.times[k] * meta.fps)]; if (!name) continue;
      const B = ((lib[name] ??= {})[node] ??= {}); const v = Array.from(tr.values.slice(k * n, k * n + n));
      if (prop === 'quaternion') B.q = new THREE.Quaternion().fromArray(v);
      else if (prop === 'position') B.p = new THREE.Vector3().fromArray(v);
    }
  }
  return lib;
}
function mixPose(a, b, w) {
  const o = {}; for (const k in a) { const A = a[k], B = b[k] || A; o[k] = { q: A.q.clone().slerp(B.q, w), p: A.p.clone().lerp(B.p, w) }; } return o;
}
const ease = { out: t => 1 - (1 - t) * (1 - t), out3: t => 1 - Math.pow(1 - t, 3), in: t => t * t, in3: t => t * t * t, inOut: t => t < .5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2, lin: t => t,
  back: t => 1 + 2.2 * Math.pow(t - 1, 3) + 1.2 * Math.pow(t - 1, 2) };   // back: a small overshoot, then it settles

class Rig {   // a bone set tweened between pose snapshots
  constructor(root, lib, pred) {
    this.bones = []; root.traverse(o => { if (o.isBone && pred(o.name)) this.bones.push(o); });
    this.lib = lib; this.t = 1; this.dur = 1e-4; this.e = ease.out; this.to = null;
    for (const name in lib) for (const b of this.bones) { const s = lib[name][b.name]; if (s) { s.q ??= b.quaternion.clone(); s.p ??= b.position.clone(); } }
  }
  P(name) { const o = {}, s = this.lib[name]; for (const b of this.bones) o[b.name] = s[b.name]; return o; }
  capture() { const o = {}; for (const b of this.bones) o[b.name] = { q: b.quaternion.clone(), p: b.position.clone() }; return o; }
  set(p) { for (const b of this.bones) { const s = p[b.name]; if (s) { b.quaternion.copy(s.q); b.position.copy(s.p); } } }
  go(target, dur, e = ease.out) { this.from = this.capture(); this.to = target; this.t = 0; this.dur = Math.max(dur, 1e-4); this.e = e; }
  update(dt) {
    if (!this.to || this.t >= 1) return; this.t = Math.min(1, this.t + dt / this.dur); const w = this.e(this.t);
    for (const b of this.bones) { const A = this.from[b.name], B = this.to[b.name]; if (!B) continue; b.quaternion.slerpQuaternions(A.q, B.q, w); b.position.lerpVectors(A.p, B.p, w); }
  }
  get done() { return this.t >= 1; }
}

const rivalLib = poseLibrary(rivalG), armsLib = poseLibrary(armsG);
const pivot = new THREE.Vector3(.25, 0, 0);                         // between the rival's feet: KO fall and sway hinge
const rivalHolder = new THREE.Group(); rivalHolder.position.copy(pivot); rivalScene.add(rivalHolder);
rivalG.scene.position.copy(pivot).negate(); rivalHolder.add(rivalG.scene); armsScene.add(armsG.scene);
const rivalMats = new Set();
rivalG.scene.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; rivalMats.add(o.material); } });
armsG.scene.traverse(o => { if (o.isMesh) o.frustumCulled = false; });
for (const m of rivalMats) { m.emissive = new THREE.Color(1, .92, .8); m.emissiveIntensity = 0; }

const rival = new Rig(rivalG.scene, rivalLib, n => !n.startsWith('fp'));
const arm = { L: new Rig(armsG.scene, armsLib, n => n.startsWith('fp') && n.endsWith('L')), R: new Rig(armsG.scene, armsLib, n => n.startsWith('fp') && n.endsWith('R')) };
const RP = name => rival.P(name);
const POSE = {
  guard: RP('guard'), guardB: RP('guard_b'), chamber: RP('chamber'), punch: RP('punch'), whiff: RP('whiff'), block: RP('block'), ko: RP('ko'),
  hit: { R: RP('hit_r'), L: RP('hit_l') },
};
POSE.hitLight = { R: mixPose(POSE.guard, POSE.hit.R, .5), L: mixPose(POSE.guard, POSE.hit.L, .55) };
POSE.blockHit = mixPose(POSE.block, POSE.hit.R, .12);
const AP = { L: n => arm.L.P(n), R: n => arm.R.P(n) };
rival.set(POSE.guard); arm.L.set(AP.L('fp_guard')); arm.R.set(AP.R('fp_guard'));
const feet = ['footL', 'footR'].map(n => rivalG.scene.getObjectByName(n)), pelvisBone = rivalG.scene.getObjectByName('pelvis');
rivalHolder.updateMatrixWorld(true); const footY0 = feet.map(f => f.getWorldPosition(new THREE.Vector3()).y);
const footP = new THREE.Vector3();
function placeBlobs() {   // contact shadows: one per foot (wider than the foot so it shows round the edges, fading as the foot
  if (!(T.blob > 0)) return; rivalHolder.updateMatrixWorld(true);   // lifts) and a faint one under the body between the feet
  feet.forEach((f, i) => { f.getWorldPosition(footP); const lift = Math.max(0, footP.y - footY0[i]), b = blobs[i], s = 1 + lift * .8;
    b.position.set(footP.x, meta.floor_y + .006, footP.z + .2); b.scale.set(1.55 * s, 2.0 * s, 1);
    b.material.uniforms.op.value = T.blob * Math.max(0, 1 - lift / .9); });
  pelvisBone.getWorldPosition(footP); const b = blobs[2];
  b.position.set(footP.x, meta.floor_y + .005, footP.z + .1); b.scale.set(3.6, 2.6, 1); b.material.uniforms.op.value = T.blob * .45 * (1 - foe.fall * .5);
}

// ---------------- his face gets hurt, round by round ----------------
// Owner 2026-11-18T16:51Z: "i think the enemy should look like dmged over raounds like real boxing". A shader on his skin
// (chained after the AO patch) paints bruises, swelling, a brow cut with a blood trickle, a bloody nose and a split lip, in
// stages as his damage goes up (EA UFC 5 / Fight Night: cuts and swelling build over rounds). Spots sit in the mesh's own
// rest space, so they stay on his face whatever pose he is in.
const rivalMesh = (() => { let m = null; rivalG.scene.traverse(o => { if (o.isSkinnedMesh && !m) m = o; }); return m; })();
const headBi = rivalMesh.skeleton.bones.findIndex(b => b.name === 'head'), headBone = rivalMesh.skeleton.bones[headBi];
const HW = new THREE.Matrix4(), HWi = new THREE.Matrix4();
function headMatrix() {   // mesh rest space -> world, for the (rigid) head
  rivalHolder.updateMatrixWorld(true);
  return HW.copy(rivalMesh.matrixWorld).multiply(rivalMesh.bindMatrixInverse).multiply(headBone.matrixWorld)
    .multiply(rivalMesh.skeleton.boneInverses[headBi]).multiply(rivalMesh.bindMatrix);
}
const face = (() => {   // head vertices, a face frame (right, up, toward the camera) and the surface point of each spot
  const g = rivalMesh.geometry, P = g.attributes.position, si = g.attributes.skinIndex, sw = g.attributes.skinWeight, v = new THREE.Vector3();
  const pts = [];
  for (let i = 0; i < P.count; i++) { let w = 0; for (let c = 0; c < 4; c++) if (si.getComponent(i, c) === headBi) w += sw.getComponent(i, c); if (w > .6) pts.push(v.fromBufferAttribute(P, i).clone()); }
  HWi.copy(headMatrix()).invert();
  const C = pts.reduce((a, p) => a.add(p), new THREE.Vector3()).multiplyScalar(1 / pts.length);
  const U = new THREE.Vector3(0, 1, 0).transformDirection(HWi), Fw = new THREE.Vector3().fromArray(meta.camera.pos).applyMatrix4(HWi).sub(C);
  Fw.addScaledVector(U, -Fw.dot(U)).normalize(); const R = new THREE.Vector3().crossVectors(U, Fw).normalize();
  const co = pts.map(p => { const q = p.clone().sub(C); return [q.dot(R), q.dot(U), q.dot(Fw), p]; });
  const sorted = k => co.map(c => c[k]).sort((a, b) => a - b), pc = (a, x) => a[Math.min(a.length - 1, Math.max(0, Math.round(x * (a.length - 1))))];
  const rs = sorted(0), us = sorted(1), hw = (pc(rs, .97) - pc(rs, .03)) / 2, u0 = pc(us, .02), u1 = pc(us, .98), hh = (u1 - u0) / 2, uc = (u0 + u1) / 2;
  const surf = (a, b) => {   // the front-most head vertex at (a, b) in half-width / half-height units
    for (const tol of [.06, .1, .16, .25]) {
      let best = null; for (const c of co) if (Math.abs(c[0] - a * hw) < tol * hw && Math.abs(c[1] - (uc + b * hh)) < tol * hh && (!best || c[2] > best[2])) best = c;
      if (best) return best[3].clone();
    }
    return C.clone().addScaledVector(Fw, hw);
  };
  return { C, U, R, Fw, hw, hh, uc, surf, n: pts.length };
})();
// [across (+ = his left, screen right), up, radius] in half-widths / half-heights of his head; the A side flips by seed.
// Placed from a close-up render of the head (?dev=face).
const FACE = { cheekA: [.42, -.30, .36], eyeA: [.27, -.12, .31], browA: [.26, .14, .28], cheekB: [-.42, -.30, .36],
  nose: [0, -.34, .18], eyeB: [-.27, -.12, .31], cutB: [-.36, -.26, .24] };   // the mouth is under the beard: the last cut is on his cheekbone
const SPOTS = Object.keys(FACE), NS = 8;
const dmgU = { uSpot: { value: Array.from({ length: NS }, () => new THREE.Vector4(0, 0, 0, 1)) }, uDmg: { value: Array.from({ length: NS }, () => new THREE.Vector4()) },
  uCutT: { value: Array.from({ length: NS }, () => new THREE.Vector3(1, 0, 0)) }, uUp: { value: face.U }, uRt: { value: face.R }, uFw: { value: face.Fw }, uFresh: { value: 0 } };
const dmg = { v: 0, to: 0, seed: 1, fresh: 0, shown: -1 };
function placeSpots() {
  const s = dmg.seed;
  SPOTS.forEach((k, i) => { const [a, b, r] = FACE[k], p = face.surf(a * s, b);
    dmgU.uSpot.value[i].set(p.x, p.y, p.z, r * face.hw);
    const ang = k === 'browA' ? .3 * s : k === 'cutB' ? -.45 * s : 0;   // the cuts run along the brow and the cheekbone
    dmgU.uCutT.value[i].copy(face.R).multiplyScalar(Math.cos(ang)).addScaledVector(face.U, Math.sin(ang)).normalize(); });
}
placeSpots();
const ramp = (x, a, b) => Math.max(0, Math.min(1, (x - a) / (b - a)));
function setDamage(L) {   // stages: .15 cheek, .3 eye, .45 brow cut and blood, .6 other cheek and nose blood, .75 other eye and cheek cut
  const D = dmgU.uDmg.value, set = (k, b, sw, cut, bl) => D[SPOTS.indexOf(k)].set(b, sw, cut, bl);
  set('cheekA', ramp(L, .1, .3), ramp(L, .5, .9) * .3, 0, 0);
  set('eyeA', ramp(L, .25, .42), ramp(L, .28, .55) * .75 + ramp(L, .6, .85) * .25, 0, 0);
  set('browA', ramp(L, .4, .55) * .6, ramp(L, .45, .7) * .35, ramp(L, .42, .5), ramp(L, .44, .78));
  set('cheekB', ramp(L, .55, .72), ramp(L, .7, .95) * .3, 0, 0);
  set('nose', ramp(L, .58, .7) * .55, ramp(L, .6, .8) * .3, 0, ramp(L, .6, .9) * .8);
  set('eyeB', ramp(L, .7, .85), ramp(L, .72, .95), 0, 0);
  set('cutB', ramp(L, .72, .82) * .4, ramp(L, .78, .98) * .3, ramp(L, .74, .8), ramp(L, .76, .98) * .7);
}
setDamage(0);
const DMG_VS_HEAD = `uniform vec4 uSpot[${NS}]; uniform vec4 uDmg[${NS}]; varying vec3 vDmgP;\n`;
const DMG_VS = `vDmgP = position;
for (int i = 0; i < ${NS}; i++) { float r = length(position - uSpot[i].xyz) / uSpot[i].w; float k = 1.0 - smoothstep(0.0, 1.0, r);
  transformed += normal * (uDmg[i].y * uSpot[i].w * 0.7 * k * k); }\n`;
const DMG_FS_HEAD = `uniform vec4 uSpot[${NS}]; uniform vec4 uDmg[${NS}]; uniform vec3 uCutT[${NS}]; uniform vec3 uUp; uniform vec3 uRt; uniform vec3 uFw; uniform float uFresh;
varying vec3 vDmgP; float dmgWet = 0.0;\n`;
const DMG_FS = `{
  vec3 col = diffuseColor.rgb;
  for (int i = 0; i < ${NS}; i++) {
    vec4 s = uSpot[i]; vec4 d = uDmg[i];
    if (d.x + d.y + d.z + d.w < 0.001) continue;
    vec3 q = vDmgP - s.xyz; float r = length(q) / s.w;
    if (abs(dot(q, uFw)) / s.w > 1.3) continue;
    float b = clamp(d.x * (1.0 + uFresh * 0.35), 0.0, 1.0) * (1.0 - smoothstep(0.4, 1.0, r));
    vec3 halo = col * vec3(0.74, 0.44, 0.54), core = mix(col * vec3(0.27, 0.11, 0.25), vec3(0.12, 0.03, 0.15), 0.6);
    col = mix(col, mix(halo, core, 1.0 - smoothstep(0.2, 0.85, r)), b);
    float sw = d.y * (1.0 - smoothstep(0.0, 0.85, r));
    col = mix(col, col * vec3(0.92, 0.55, 0.62), sw * 0.55);
    vec3 t = uCutT[i]; float al = dot(q, t) / s.w, ac = length(q - t * dot(q, t)) / s.w, hl = 0.6;
    float cw = 0.1 * (1.0 - pow(clamp(abs(al) / hl, 0.0, 1.0), 2.0)) + 0.004;
    float cut = d.z * step(abs(al), hl) * (1.0 - smoothstep(cw * 0.45, cw, ac));
    float dn = -dot(q, uUp) / s.w, sd = dot(q, uRt) / s.w, len = d.w * 2.4 + 0.001;
    float wob = 0.035 * sin(dn * 8.0 + float(i) * 1.7) + 0.02 * sin(dn * 19.0);
    float bw = 0.16 * (1.0 - 0.55 * clamp(dn / len, 0.0, 1.0)) * (1.0 + 0.4 * smoothstep(len * 0.75, len, dn));
    float blood = d.w * step(-0.05, dn) * (1.0 - smoothstep(len * 0.85, len, dn)) * (1.0 - smoothstep(bw * 0.55, bw, abs(sd - wob)));
    blood = max(blood, d.w * step(abs(al), hl + 0.08) * (1.0 - smoothstep(cw, cw * 2.4 + 0.03, ac)) * d.z);
    col = mix(col, vec3(0.34, 0.012, 0.02), clamp(max(cut, blood * 0.95), 0.0, 1.0));
    dmgWet = max(dmgWet, max(max(blood, cut), sw * 0.35));
  }
  diffuseColor.rgb = col;
}\n`;
for (const m of rivalMats) {   // chained after restyle's AO patch; the cache key keeps the patched program apart
  const prev = m.onBeforeCompile, key = m.customProgramCacheKey.bind(m), base = prev === THREE.Material.prototype.onBeforeCompile;
  m.onBeforeCompile = (sh, r) => {
    if (!base) prev.call(m, sh, r);
    Object.assign(sh.uniforms, dmgU);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\n' + DMG_VS_HEAD).replace('#include <begin_vertex>', '#include <begin_vertex>\n' + DMG_VS);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\n' + DMG_FS_HEAD).replace('#include <map_fragment>', '#include <map_fragment>\n' + DMG_FS)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.16, dmgWet);');
  };
  const k0 = base ? '' : key(); m.customProgramCacheKey = () => k0 + 'dmg1'; m.needsUpdate = true;
}
function tickDamage(rdt) {
  dmg.v += (dmg.to - dmg.v) * (1 - Math.exp(-rdt * 2.6)); if (Math.abs(dmg.to - dmg.v) < .002) dmg.v = dmg.to;
  if (Math.abs(dmg.v - dmg.shown) > .0015) { setDamage(dmg.v); dmg.shown = dmg.v; }
  dmg.fresh *= Math.exp(-rdt * 4); dmgU.uFresh.value = dmg.fresh;
}
// Close-up of his face for the corner screen (between rounds, the TV shot of a cut-up fighter on his stool).
const headCam = new THREE.PerspectiveCamera(18, 1, .1, 60);
const portraitQ = [];
const faceTmp = new THREE.Vector3(), faceTmp2 = new THREE.Vector3(), faceDir = new THREE.Vector3();
function renderPortrait(cv) {
  const c = rivalR.domElement, w = Math.min(cv.width, c.width), h = Math.min(cv.height, c.height); if (!w || !h) return;
  const M = headMatrix(), fc = faceTmp.copy(face.C).addScaledVector(face.U, -face.hh * .1).applyMatrix4(M);
  const edge = faceTmp2.copy(face.C).addScaledVector(face.R, face.hw).applyMatrix4(M), half = edge.distanceTo(fc);
  faceDir.subVectors(rivalCam.position, fc).normalize();
  headCam.aspect = w / h; headCam.position.copy(fc).addScaledVector(faceDir, half * 1.45 / Math.tan(THREE.MathUtils.degToRad(headCam.fov / 2)));
  headCam.up.set(0, 1, 0); headCam.lookAt(fc); headCam.updateProjectionMatrix();
  const pr = rivalR.getPixelRatio(); rivalR.setViewport(0, 0, w / pr, h / pr);
  blobs.forEach(b => { b.userData.v = b.visible; b.visible = false; }); floor.visible = false;
  rivalR.render(rivalScene, headCam);
  const x = cv.getContext('2d'); x.clearRect(0, 0, cv.width, cv.height); x.drawImage(c, 0, c.height - h, w, h, 0, 0, cv.width, cv.height);
  blobs.forEach(b => { b.visible = b.userData.v; }); floor.visible = true; rivalR.setViewport(0, 0, W * OS, H * OS);
}

// ---------------- layout ----------------
let W = 0, H = 0;
// r16 lag check (owner 2026-11-18T19:42Z "also it feels very laggy"): at 2x pixels the 3D layers ran 53 fps with 12% of frames
// at 30; the cap below is the pixel ratio the 3D layers render at (?pr= overrides).
const PR = q('pr', 1.5);
function resize() {
  const r = stage.getBoundingClientRect(); W = r.width; H = r.height; const dpr = Math.min(devicePixelRatio || 1, PR);
  for (const R of [rivalR, armsR]) R.setPixelRatio(dpr);
  rivalR.setSize(W * OS, H * OS, false); armsR.setSize(W, H, false);
  fxCanvas.width = Math.round(W * dpr); fxCanvas.height = Math.round(H * dpr); fx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ghost.width = rivalR.domElement.width; ghost.height = rivalR.domElement.height; cineCv.width = Math.round(W * OS / 2); cineCv.height = Math.round(H * OS / 2);
}
addEventListener('resize', resize);
function project(v, cam) { const p = v.clone().project(cam), k = cam === rivalCam ? OS : 1;
  return { x: ((p.x + 1) / 2 * k - (k - 1) / 2) * W, y: ((1 - p.y) / 2 * k - (k - 1) / 2) * H }; }
const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3();
const armsOff = { x: 0, y: 0 };      // screen offset of the arms layer (shake, dodge, jolt, breathing), set every frame
function gloveScreen(side) {          // centre of the player's glove (wrist + 0.42 along the hand); used to detect motion
  const hand = armsG.scene.getObjectByName('fphand' + side), fore = armsG.scene.getObjectByName('fpforearm' + side);
  armsG.scene.updateMatrixWorld(true); hand.getWorldPosition(tmp); fore.getWorldPosition(tmp2);
  return project(tmp.clone().add(tmp.clone().sub(tmp2).normalize().multiplyScalar(.42)), armsCam);
}
// Glove vertices skinned mostly to each fp hand bone; at contact the deepest ones (furthest from the camera) are the knuckles.
const gloveVerts = { L: [], R: [] };
armsG.scene.traverse(o => { if (!o.isSkinnedMesh) return; const si = o.geometry.attributes.skinIndex, sw = o.geometry.attributes.skinWeight;
  for (const s of ['L', 'R']) { const bi = o.skeleton.bones.findIndex(b => b.name === 'fphand' + s); if (bi < 0) continue;
    for (let i = 0; i < si.count; i += 2) for (let c = 0; c < 4; c++) if (si.getComponent(i, c) === bi && sw.getComponent(i, c) > .6) { gloveVerts[s].push([o, i]); break; } } });
function gloveFace(side) {
  const vs = gloveVerts[side]; if (!vs.length) { const p = gloveScreen(side); return { x: p.x + armsOff.x, y: p.y + armsOff.y }; }
  armsG.scene.updateMatrixWorld(true); const dir = new THREE.Vector3(); armsCam.getWorldDirection(dir);
  const pts = vs.map(([m, i]) => { const v = new THREE.Vector3(); m.getVertexPosition(i, v); v.applyMatrix4(m.matrixWorld); return [v.clone().sub(armsCam.position).dot(dir), v]; });
  pts.sort((a, b) => b[0] - a[0]); const top = pts.slice(0, Math.max(8, Math.round(pts.length * .04))), c = new THREE.Vector3();
  for (const [, v] of top) c.add(v); c.multiplyScalar(1 / top.length);
  const p = project(c, armsCam); return { x: p.x + armsOff.x, y: p.y + armsOff.y };
}
const qtmp = new THREE.Quaternion();
function rivalCrown() {   // on screen: the top of his head and its height (the head bone sits at his jaw; up its own axis to the crown)
  rivalHolder.updateMatrixWorld(true); const b = rivalG.scene.getObjectByName('head'); b.getWorldPosition(tmp); const base = project(tmp, rivalCam);
  tmp2.set(0, CROWN, 0).applyQuaternion(b.getWorldQuaternion(qtmp)); const top = project(tmp.add(tmp2), rivalCam);
  return { x: top.x, y: top.y, h: Math.hypot(top.x - base.x, top.y - base.y) };
}
function rivalPoint(name, along = 0) {
  rivalHolder.updateMatrixWorld(true); const b = rivalG.scene.getObjectByName(name); b.getWorldPosition(tmp);
  if (along) { b.children[0]?.getWorldPosition(tmp2); }
  return project(tmp, rivalCam);
}

// ---------------- audio (synthesised, no files) ----------------
const AU = { ctx: null };
function audioInit() {
  if (AU.ctx) { if (!AU.muted) AU.ctx.resume(); return; }
  const C = AU.ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
  const n = C.createBuffer(1, C.sampleRate * 2, C.sampleRate), d = n.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  AU.lp = C.createBiquadFilter(); AU.lp.type = 'lowpass'; AU.lp.frequency.value = 20000; AU.lp.Q.value = .8; AU.lp.connect(C.destination);
  AU.dry = C.createGain(); AU.dry.connect(C.destination);   // ear ringing and heartbeat are inside your head: not muffled
  AU.noise = n; AU.master = C.createDynamicsCompressor(); AU.master.threshold.value = -10; AU.master.ratio.value = 6; AU.master.connect(AU.lp);
  const sh = C.createWaveShaper(), curve = new Float32Array(1024); for (let i = 0; i < 1024; i++) { const x = i / 511.5 - 1; curve[i] = Math.tanh(x * 3); }
  sh.curve = curve; sh.connect(AU.master); AU.drive = sh;
  // crowd bed: filtered noise, swells on big moments
  const src = C.createBufferSource(); src.buffer = n; src.loop = true; const bp = C.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 650; bp.Q.value = .5;
  const g = C.createGain(); g.gain.value = .035; src.connect(bp).connect(g).connect(AU.master); src.start(); AU.crowd = g; AU.crowdSrc = src;
  loadSamples(C);
  if (AU.muted) C.suspend();
}
function env(g, t, a, peak, dec) { g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + dec); }
function noise(t, dur, type, f, q, peak, a, dec, pan = 0, f2, out) {
  const C = AU.ctx, s = C.createBufferSource(); s.buffer = AU.noise; const b = C.createBiquadFilter(); b.type = type; b.frequency.setValueAtTime(f, t); b.Q.value = q;
  if (f2) b.frequency.exponentialRampToValueAtTime(f2, t + a + dec);
  const g = C.createGain(); env(g, t, a, peak, dec); const p = C.createStereoPanner(); p.pan.value = pan;
  s.connect(b).connect(g).connect(p).connect(out || AU.master); s.start(t, Math.random()); s.stop(t + a + dec + .05);
}
function tone(t, f1, f2, dur, peak, type = 'sine', out, a = .003) {
  const C = AU.ctx, o = C.createOscillator(); o.type = type; o.frequency.setValueAtTime(f1, t); o.frequency.exponentialRampToValueAtTime(f2, t + dur);
  const g = C.createGain(); env(g, t, a, peak, dur); o.connect(g).connect(out || AU.master); o.start(t); o.stop(t + dur + .05);
}
// ---------------- recorded sounds (r16) ----------------
// Owner 2026-11-18T19:42Z "the SFX sounds bad. i thought we have done tests on SFX generation can we get some better higher
// quality sounds": the synth sounds put most of their energy under 100 Hz (punch 150->42 Hz, KO 92->26), which phone and laptop
// speakers cannot play, so what was left was filtered noise. These clips come from the local Stable Audio 3 tool (prompt and
// seed of each in sfx/picks.json), high-passed and level-matched. A family is a small pool: a random take, never the same one
// twice in a row, pitched up or down by up to a semitone (research: no machine-gun repeats). Until they load, or with
// ?oldsfx, the synth sounds below play.
const SMP = { on: !QS.has('oldsfx'), buf: {}, last: {} };
const SMP_FILES = { jab: 3, hook: 3, ko: 1, block: 2, hurt: 2, whoosh: 2, bell: 1, crowd: 1, cheer: 1, tick: 1, tile_red: 1, tile_blue: 1, tile_black: 1, bust: 1, sting: 1, dizzy: 1 };
function loadSamples(C) {
  if (!SMP.on) return;
  for (const [k, n] of Object.entries(SMP_FILES)) for (let i = 1; i <= n; i++)
    fetch(new URL(`sfx/${k}_${i}.wav`, import.meta.url)).then(r => r.ok ? r.arrayBuffer() : Promise.reject(r.status))
      .then(b => C.decodeAudioData(b)).then(a => { (SMP.buf[k] ||= []).push(a); if (k === 'crowd') crowdBed(a); }).catch(() => {});
}
function smp(k, { gain = 1, pan = 0, rate = 1, vary = 1, at = 0, out } = {}) {   // false when that family is not loaded
  const C = AU.ctx, list = SMP.buf[k]; if (!C || !list?.length) return false;
  let i = (Math.random() * list.length) | 0; if (list.length > 1 && i === SMP.last[k]) i = (i + 1) % list.length; SMP.last[k] = i;
  const s = C.createBufferSource(); s.buffer = list[i]; s.playbackRate.value = rate * Math.pow(2, vary * (Math.random() * 2 - 1) / 12);
  const g = C.createGain(); g.gain.value = gain; const p = C.createStereoPanner(); p.pan.value = pan;
  s.connect(g).connect(p).connect(out || AU.master); s.start(C.currentTime + at); return true;
}
function crowdBed(buf) {   // the recorded arena murmur replaces the noise bed (same swell gain, so crowd() still drives it)
  const C = AU.ctx, s = C.createBufferSource(); s.buffer = buf; s.loop = true; const k = C.createGain(); k.gain.value = 2.2;
  s.connect(k).connect(AU.crowd); s.start(); try { AU.crowdSrc.stop(); } catch (e) { /* already stopped */ }
}
function crowdDip() {   // the room goes quiet for the moment before a big punch lands (research: clear the air before a KO)
  if (!AU.ctx) return; const g = AU.crowd.gain, t = AU.ctx.currentTime; g.cancelScheduledValues(t); g.setValueAtTime(g.value, t); g.setTargetAtTime(.006, t, .05);
}
const SFX = {
  whoosh(pan) { if (!AU.ctx || smp('whoosh', { gain: .4, pan, rate: 1.08 })) return; const t = AU.ctx.currentTime; noise(t, .09, 'bandpass', 500, 1.4, .22, .025, .07, pan, 2200); },
  hit(s, pan) {   // s: 0 light .. 1 heavy
    if (!AU.ctx) return; const t = AU.ctx.currentTime;
    if (smp(s > .5 ? 'hook' : 'jab', { gain: .75 + .45 * s, pan, rate: 1.06 - .1 * s })) {   // the clip carries crack and body;
      tone(t, 110 - 20 * s, 48, .1 + .1 * s, .35 + .3 * s);   // a soft sub under it for headphones
      if (s > .5) crowd(.22, 1.1); return; }
    tone(t, 150 - 30 * s, 42, .09 + .1 * s, .9 + .5 * s, 'sine', s > .5 ? AU.drive : null);
    noise(t, .03, 'highpass', 1800, .7, .55 + .25 * s, .001, .03 + .02 * s, pan);
    noise(t, .08, 'bandpass', 900, .8, .5 + .3 * s, .002, .06 + .06 * s, pan);
    if (s > .5) { noise(t, .2, 'lowpass', 300, .7, .6, .002, .16, pan, 0, AU.drive); crowd(.22, 1.1); }
  },
  blocked(pan) { if (!AU.ctx || smp('block', { gain: .7, pan })) return; const t = AU.ctx.currentTime; tone(t, 210, 120, .06, .5); noise(t, .07, 'lowpass', 650, .8, .45, .001, .06, pan); },
  hurt() {
    if (!AU.ctx) return; const t = AU.ctx.currentTime;
    if (smp('hurt', { gain: 1.05, rate: .96 })) { tone(t, 90, 40, .2, .4); tone(t + .02, 2300, 2250, .7, .04, 'sine'); crowd(.18, .9); return; }
    tone(t, 95, 32, .28, 1.3, 'sine', AU.drive); noise(t, .25, 'lowpass', 420, .7, .9, .002, .22); tone(t + .02, 2300, 2250, .7, .04, 'sine'); crowd(.18, .9);
  },
  guardHit() { if (!AU.ctx || smp('block', { gain: .85, rate: .86 })) return; const t = AU.ctx.currentTime; tone(t, 160, 90, .09, .8); noise(t, .08, 'lowpass', 900, .7, .5, .001, .07); },
  tell(armor) {
    if (!AU.ctx) return; const t = AU.ctx.currentTime; noise(t, .12, 'bandpass', armor ? 380 : 700, 4, armor ? .5 : .3, .02, .1);
    if (armor) tone(t, 70, 55, .3, .5, 'triangle');
  },
  whiffBy(dir) { if (!AU.ctx) return; const t = AU.ctx.currentTime; noise(t, .16, 'bandpass', 350, 1.1, .55, .03, .13, -dir * .8, 1600); },
  cineIn() { if (!AU.ctx) return; crowdDip(); },   // r17: the rising swell before a big hit went with the slow motion
  cine(red) {   // the cinematic hit: sub boom, crack and the crowd roar (r17: no pitched-down or falling slow-motion sounds)
    if (!AU.ctx) return; const t = AU.ctx.currentTime;
    if (smp('ko', { gain: 1.15, rate: red ? 1 : 1.04, vary: .5 })) {
      smp('cheer', { gain: red ? .75 : .5, at: .1, vary: .5 }); tone(t, 80, 34, .5, .55); crowd(red ? .9 : .7, red ? 3.2 : 2.2); return; }
    tone(t, 92, 26, .75, 1.7, 'sine', AU.drive); noise(t, .55, 'lowpass', 700, .7, 1.1, .002, .5, 0, 70, AU.drive);
    noise(t, .05, 'highpass', 2600, .7, 1, .001, .05);
    if (red) tone(t + .04, 55, 30, 1.1, .9, 'sine', AU.drive);
    crowd(red ? .9 : .7, red ? 3.2 : 2.2);
  },
  ring(v) { if (!AU.ctx) return; const t = AU.ctx.currentTime; tone(t + .05, 3300, 3260, .6 + 1.3 * v, .028 * v + .01, 'sine', AU.dry, .12); },
  heart(v) { if (!AU.ctx) return; const t = AU.ctx.currentTime; tone(t, 74, 44, .13, .5 + .5 * v, 'sine', AU.dry); tone(t + .17, 66, 40, .15, .35 + .4 * v, 'sine', AU.dry); },
  bell() { if (!AU.ctx) return; if (smp('bell', { gain: .5, vary: 0 })) { smp('bell', { gain: .45, vary: 0, at: .32 }); return; } const t = AU.ctx.currentTime; for (const k of [0, .32]) for (const [f, a] of [[820, .35], [1240, .22], [1660, .14], [2470, .08]]) tone(t + k, f, f * .995, 1.4, a, 'sine', null, .002); },
};
function crowd(peak, dur) { if (!AU.ctx) return; const g = AU.crowd.gain, t = AU.ctx.currentTime; g.cancelScheduledValues(t); g.setValueAtTime(g.value, t); g.linearRampToValueAtTime(peak, t + .12); g.exponentialRampToValueAtTime(.035, t + .12 + dur); }

// ---------------- effects ----------------
const parts = [], rings = [];
function sparks(x, y, s, color = '255,230,140') {
  rings.push({ x, y, t: 0, life: .13 + .07 * s, r0: 18 + 20 * s, r1: 70 + 90 * s, color });
  const n = 8 + Math.round(14 * s);
  for (let i = 0; i < n; i++) { const a = Math.random() * Math.PI * 2, v = (500 + Math.random() * 900) * (.6 + s * .7);
    parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, t: 0, life: .12 + Math.random() * .14, w: 2 + 3 * s, color }); }
}
function drawFx(dt) {
  fx.clearRect(0, 0, W, H); fx.globalCompositeOperation = 'lighter';
  for (let i = rings.length - 1; i >= 0; i--) { const r = rings[i]; r.t += dt; const k = r.t / r.life; if (k >= 1) { rings.splice(i, 1); continue; }
    const rad = r.r0 + (r.r1 - r.r0) * ease.out3(k), g = fx.createRadialGradient(r.x, r.y, 0, r.x, r.y, rad);
    g.addColorStop(0, `rgba(255,255,255,${.95 * (1 - k)})`); g.addColorStop(.35, `rgba(${r.color},${.7 * (1 - k)})`); g.addColorStop(1, `rgba(${r.color},0)`);
    fx.fillStyle = g; fx.beginPath(); fx.arc(r.x, r.y, rad, 0, Math.PI * 2); fx.fill(); }
  for (let i = shocks.length - 1; i >= 0; i--) { const r = shocks[i]; r.t += dt; const k = r.t / r.life; if (k >= 1) { shocks.splice(i, 1); continue; } if (k <= 0) continue;   // the 2nd ring starts late (t < 0)
    fx.strokeStyle = `rgba(255,255,255,${.9 * (1 - k)})`; fx.lineWidth = r.w * (1 - k) + 1; fx.beginPath(); fx.arc(r.x, r.y, r.r1 * ease.out3(k), 0, Math.PI * 2); fx.stroke(); }
  for (let i = parts.length - 1; i >= 0; i--) { const p = parts[i]; p.t += dt; const k = p.t / p.life; if (k >= 1) { parts.splice(i, 1); continue; }
    const x0 = p.x + p.vx * p.t, y0 = p.y + p.vy * p.t, tail = .035; fx.strokeStyle = `rgba(${p.color},${1 - k})`; fx.lineWidth = p.w * (1 - k * .6);
    fx.beginPath(); fx.moveTo(x0 - p.vx * tail, y0 - p.vy * tail); fx.lineTo(x0, y0); fx.stroke(); }
  fx.globalCompositeOperation = 'source-over';
}
const shocks = [];   // thin white shockwave rings (cinematic hits)
// Dazed stars (r16, owner 2026-11-18T19:42Z "the stars look terrible too": flat yellow stars with a thick brown outline,
// all drawn on top of his face). Now one pre-drawn glowing sprite (soft halo, white-hot core to gold to amber, thin dark rim,
// a glint), drawn with depth: stars on the far side of the orbit are smaller, dimmer and fade out where his head would
// cover them; each leaves a short fading trail and throws the odd sparkle. Drawn from a cached sprite, so it costs a few
// drawImage calls a frame.
const STAR = (() => {
  const S = 128, c = document.createElement('canvas'); c.width = c.height = S; const g = c.getContext('2d'), m = S / 2;
  const halo = g.createRadialGradient(m, m, 0, m, m, m); halo.addColorStop(0, 'rgba(255,236,150,.8)'); halo.addColorStop(.38, 'rgba(255,190,60,.34)'); halo.addColorStop(1, 'rgba(255,160,30,0)');
  g.fillStyle = halo; g.fillRect(0, 0, S, S);
  const r = S * .3, path = () => { g.beginPath(); for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, k = i % 2 ? r * .5 : r;
    const x = m + Math.cos(a) * k, y = m + Math.sin(a) * k; if (!i) g.moveTo(x, y); else g.lineTo(x, y); } g.closePath(); };
  g.lineJoin = 'round'; path();   // round joins on the rim soften the points: toy-like, not spiky g.lineWidth = S * .07; g.strokeStyle = 'rgba(120,56,0,.85)'; g.stroke();
  path(); const fill = g.createRadialGradient(m - r * .2, m - r * .3, 0, m, m, r * 1.05);
  fill.addColorStop(0, '#fffef2'); fill.addColorStop(.28, '#fff08a'); fill.addColorStop(.68, '#ffc21a'); fill.addColorStop(1, '#ff8a00'); g.fillStyle = fill; g.fill();
  g.lineWidth = S * .025; g.strokeStyle = 'rgba(255,255,230,.9)'; g.stroke();
  g.fillStyle = 'rgba(255,255,255,.95)'; g.beginPath(); g.ellipse(m - r * .28, m - r * .3, r * .16, r * .09, -.6, 0, Math.PI * 2); g.fill();
  return c;
})();
const TW = { foe: [], you: [] };   // sparkles, one list per orbit; aged on the real clock
function stars(cx, cy, rx, ry, n, size, t, alpha, head = 0, twinkles = TW.foe, tilt = 0) {   // head: half-width of his head on screen (0: nothing to hide behind)
  // tilt: the ring's roll on screen (radians, clockwise), so it sits on his crown like a halo knocked askew (Smash: 15-20 degrees)
  const d = size * 3.1, list = [], tc = Math.cos(tilt), ts = Math.sin(tilt), at = (lx, ly) => [cx + lx * tc - ly * ts, cy + lx * ts + ly * tc];
  for (let i = 0; i < n; i++) { const a = t + i * Math.PI * 2 / n, z = Math.sin(a); list.push({ a, z }); }
  list.sort((p, q) => p.z - q.z);   // far ones first
  // his stars pulse on his clock and stop sparkling while his punch is frozen (r17 stop motion); yours stay on the real clock
  const his = twinkles === TW.foe, clk = his ? G.ft : G.rt, spawn = !(his && frozen());
  fx.save();
  for (const { a, z } of list) {
    const lx = Math.cos(a) * rx, [x, y] = at(lx, z * ry), near = (z + 1) / 2, k = .62 + .38 * near;
    let al = alpha * (.4 + .6 * near);
    if (head && z < 0) al *= Math.min(1, Math.abs(lx) / head) ** 2;   // behind his head: hidden
    if (al < .02) continue;
    for (let j = 3; j >= 1; j--) { const b = a - j * .16 * Math.sign(t || 1), [tx, ty] = at(Math.cos(b) * rx, Math.sin(b) * ry);   // the trail
      fx.globalAlpha = al * .16 * (4 - j) / 3; const td = d * k * (1 - j * .14); fx.drawImage(STAR, tx - td / 2, ty - td / 2, td, td); }
    fx.globalAlpha = al; const sd = d * k * (1 + .06 * Math.sin(clk * 9 + a * 3)); fx.drawImage(STAR, x - sd / 2, y - sd / 2, sd, sd);
    if (spawn && near > .6 && Math.random() < .05) twinkles.push({ x: x + (Math.random() - .5) * size, y: y + (Math.random() - .5) * size, t0: G.rt, s: size * (.25 + Math.random() * .2) });
  }
  fx.globalCompositeOperation = 'lighter';
  for (let i = twinkles.length - 1; i >= 0; i--) { const w = twinkles[i], age = G.rt - w.t0; if (age > .35) { twinkles.splice(i, 1); continue; }
    const e = Math.sin(Math.PI * age / .35), r = w.s * e; fx.globalAlpha = alpha * e; fx.strokeStyle = '#fff6c8'; fx.lineWidth = Math.max(1, r * .18); fx.lineCap = 'round';
    fx.beginPath(); fx.moveTo(w.x - r, w.y); fx.lineTo(w.x + r, w.y); fx.moveTo(w.x, w.y - r); fx.lineTo(w.x, w.y + r); fx.stroke(); }
  fx.restore();
}
// Shake: a sum of two sines with fresh phases per shake instead of white noise (r15 "doesnt feel smooth": random jumps
// every frame read as jitter, a smooth wobble reads as impact).
const shake = { a: 0, dur: 1, t: 1, armsK: .35, p: [0, 0, 0, 0] }, kick = { s: 0 };
function addShake(px, dur, armsK = .35) { px *= FXS.shake; if (px <= 0) return;
  if (px >= shake.a * (1 - shake.t / shake.dur)) { shake.a = px; shake.dur = dur; shake.t = 0; shake.armsK = armsK; shake.p = shake.p.map(() => Math.random() * 6.283); } }
let flashV = 0, vignV = 0, rivalFlash = 0, rivalJitter = 0;
// r17: no slow motion anywhere (owner 2026-11-18T22:01Z "lets not do the slow motion just make it a stop motion then, the sfx
// and animation for slow motion is so weird i want to remove"). Big moments get a short freeze-frame (G.hitstop) instead.

// ---------------- slot-driven fight ----------------
// No rival AI: the rival idles in guard until the page sends punches. Each punch plays the real arm swing; at contact the
// rival snaps into a hit pose (lighter or heavier by damage), with hitstop, sparks, shake and a hit sound.
const G = { hitstop: 0, time: 0, ft: 0, rt: 0 };
// Game clock (ms): moves only while the match is not paused, so every fight timer (his strike, the KO bell, match.js waits)
// stops with the PAUSED sheet. reset() drops every pending job, so nothing from a quit match can run in the next one.
const clock = { ms: 0, jobs: [] };
function after(ms, fn) { const j = { at: clock.ms + Math.max(0, ms), fn }; clock.jobs.push(j); return j; }
function runJobs() {
  const due = clock.jobs.filter(j => j.at <= clock.ms); if (!due.length) return;
  clock.jobs = clock.jobs.filter(j => j.at > clock.ms);
  for (const j of due.sort((a, b) => a.at - b.at)) { try { j.fn(); } catch (e) { console.error(e); } }
}
const foe = { st: 'idle', t: 0, fall: 0, stun: 0, guardUp: false, bob: 0, push: 0, pushV: 0 };
const player = { arms: { L: { st: 'idle', t: 0, load: .1 }, R: { st: 'idle', t: 0, load: .1 } }, jolt: 0, lean: 0 };
// Your punch (r16, owner 2026-11-18T19:42Z "the punching animation should be polished it it doesnt charge back for a punch",
// "overall fighting animation can be polish further"). Four beats, the classic anticipation, action, follow-through: COCK (the
// fist draws back past guard and the shoulder winds), STRIKE (accelerates into contact, a touch past full reach), the contact
// freeze is the hitstop, then RECOIL back to guard with a small settle. The first punch of a row and heavy ones load longer;
// chained punches load short so a row still rolls.
const SP = { L: { cock: .1, startup: .06, recover: .17, pose: 'fp_punch_l' }, R: { cock: .11, startup: .065, recover: .18, pose: 'fp_punch_r' } };
// The load: the joints turn a little past guard, away from the punch, and the shoulder draws back and up so the glove
// stays in view while it loads (straight back alone sank it off the bottom of the screen).
const COCK = q('cock', 1.15), CLIFT = q('clift', .3), CBACK = q('cback', .1), COUT = q('cout', 0), ARMP = {};
for (const s of ['L', 'R']) { const g = AP[s]('fp_guard'), p = AP[s](SP[s].pose), c = mixPose(p, g, COCK), sh = Object.keys(g).find(k => /upper/i.test(k));   // three.js drops the dots: fpupperarmR
  if (c[sh]) { const sg = Math.sign(g[sh].p.x) || (s === 'R' ? 1 : -1); c[sh] = { q: c[sh].q, p: g[sh].p.clone().add(new THREE.Vector3(COUT * sg, CLIFT, CBACK)) }; }
  ARMP[s] = { cock: c, strike: mixPose(g, p, 1.05), guard: g }; }
let last = performance.now();

function foeIdle() { foe.st = 'idle'; foe.t = 0; foe.bob = 0; rival.go(foe.guardUp ? POSE.block : POSE.guard, .2, ease.inOut); }
function punch({ side = 'L', heavy = .3, blocked = false, ko = false, cine: cn = null, chain = false, onContact } = {}) {
  const a = player.arms[side], h = Math.min(1, heavy), big = ko || (cn && !blocked);
  a.st = 'cock'; a.t = 0; a.job = { heavy, blocked, ko, cine: blocked ? null : cn, onContact };
  a.load = SP[side].cock * (chain ? .6 : 1) * (1 + .8 * h + (big ? .6 : 0));   // a KO or cinematic punch loads the longest
  // r16 animation research: a heavy one holds at full load for 2-3 frames before it goes (anticipation you can read);
  // a jab and the second punch of a row go straight through
  a.hold = chain || h < .5 ? 0 : .03 + .03 * h + (big ? .02 : 0);
  if (big) SFX.cineIn();
  arm[side].go(ARMP[side].cock, a.load, ease.out3);
}
function strike(side) {   // the fist leaves: it accelerates all the way into contact
  const a = player.arms[side]; a.st = 'startup'; a.t = 0;
  arm[side].go(ARMP[side].strike, SP[side].startup, ease.in); SFX.whoosh(side === 'L' ? -.4 : .4);
}
function land(side) {
  const a = player.arms[side], j = a.job, at = gloveFace(side), pan = side === 'L' ? -.4 : .4;
  a.st = 'recover'; a.t = 0; arm[side].go(ARMP[side].guard, SP[side].recover * (1 + .4 * Math.min(1, j.heavy)), ease.back);
  foe.push = Math.max(foe.push, j.blocked ? .25 : .45 + .55 * Math.min(1, j.heavy));   // he rocks back from it
  if (foe.st === 'ko') { j.onContact?.(at); return; }
  if (j.blocked) {   // armour: the hit lands on the cover-up
    G.hitstop = T.blockedStop; SFX.blocked(pan); sparks(at.x, at.y, .15, '170,200,255'); addShake(3, .1);
    rival.set(mixPose(rival.capture(), POSE.blockHit, .6)); rival.go(POSE.block, .12);
  } else {
    const h = Math.min(1, j.heavy), full = h > .45 ? POSE.hit[side] : POSE.hitLight[side];
    // r16 research hitstop: jab ~50 ms, heavy ~90 ms, KO 150-200 ms. r17 stop motion: no slow motion after it; the KO and the
    // first big hit of an exchange stop a little longer instead, so a row of heavies does not drag
    G.hitstop = j.ko ? .2 : h > .7 && !G.bigUsed ? .13 : .03 + .07 * h;
    if (h > .7) G.bigUsed = true;
    if (foe.st === 'wind') wind.cut = true;   // your hit breaks his frozen punch; he re-chambers when his punch comes
    rival.set(mixPose(rival.capture(), full, .3 + .2 * h)); rival.go(full, .07 + .05 * h, ease.out);
    rivalJitter = .05 + .08 * h; rivalFlash = .5 + .5 * h; dmg.fresh = Math.min(1, dmg.fresh + .5 + .5 * h);
    SFX.hit(h, pan); sparks(at.x, at.y, h);
    // small hits stay small (research: big shake only for heavy hits); the cinematic adds its own
    addShake(2 + 9 * h, .08 + .12 * h, .25); kick.s = .01 + .028 * h;
    if (h > .7 && FXS.effects) flashV = .14;
    foe.st = 'hurt'; foe.t = 0; foe.stun = .1 + .14 * h;
    if (j.cine) startCine(at, j, side);
  }
  j.onContact?.(at);
  if (j.ko) startKO();
}
// Cinematic hit (r15, owner 2026-11-18T16:51Z "your good move effect doesnt feel smooth"; r17 "lets not do the slow motion just
// make it a stop motion then"): a freeze-frame of 140 ms (200 ms for the KO) while the camera glides in on his head and the
// letterbox slides in, then everything plays on at full speed (the knock-back) and the zoom and bars ease out together.
const cine = { t: 9, dur: 1.0, peak: 0, hx: 0, hy: 0, gx: 0, gy: 0, red: false, ix: 0, iy: 0 };
function startCine(at, j, side) {
  const red = j.cine === 'ko', hd = rivalPoint('head');
  SFX.cine(red); sparks(at.x, at.y, 1.5, red ? '255,190,120' : '200,230,255'); kick.s = .03;
  shocks.push({ x: at.x, y: at.y, t: 0, life: .5, r1: W * .85, w: 7 }, { x: at.x, y: at.y, t: -.08, life: .6, r1: W * 1.2, w: 4 });
  addShake(red ? 20 : 15, .6, .5);
  foe.kb = { t: 0, side: side === 'L' ? 1 : -1, amp: red ? 1.3 : 1 };
  G.hitstop = Math.max(G.hitstop, red ? .2 : .14);
  if (!FXS.effects) return;   // FLASH + ZOOM off: the same freeze, no flash, no zoom
  Object.assign(cine, { t: 0, dur: red ? 1.0 : .9, red, peak: red ? .42 : j.cine === 'dev' ? .36 : .28, hx: hd.x, hy: hd.y, gx: at.x, gy: at.y, ix: at.x, iy: at.y });
  flashV = .5; $('flash').style.background = red ? '#ff5a3c' : '#bfe3ff';
}
function cineK() {   // 0..1 zoom envelope over real time: glide in, hold, ease out
  const k = cine.t, d = cine.dur, h = d * .45; if (k >= d) return 0;
  return k < .18 ? ease.out3(k / .18) : k < h ? 1 : 1 - ease.inOut((k - h) / (d - h));
}
function drawCine(a) {   // the background behind the rival (world layer, under the rival canvas)
  const c = cineCv.getContext('2d'), w = cineCv.width, h = cineCv.height, sx = w / (W * OS), x = (cine.ix + W * (OS - 1) / 2) * sx, y = (cine.iy + H * (OS - 1) / 2) * sx;
  c.clearRect(0, 0, w, h); if (a <= .01) return;
  const g = c.createRadialGradient(x, y, 0, x, y, Math.hypot(w, h) * .7);
  if (cine.red) { g.addColorStop(0, `rgba(255,230,190,${a})`); g.addColorStop(.18, `rgba(255,70,40,${.95 * a})`); g.addColorStop(1, `rgba(70,0,8,${.97 * a})`); }
  else { g.addColorStop(0, `rgba(235,250,255,${a})`); g.addColorStop(.18, `rgba(40,140,255,${.92 * a})`); g.addColorStop(1, `rgba(4,18,80,${.96 * a})`); }
  c.fillStyle = g; c.fillRect(0, 0, w, h);
  c.globalCompositeOperation = 'lighter'; c.fillStyle = `rgba(255,255,255,${.28 * a})`;
  const R = Math.hypot(w, h), n = 34, rot = cine.t * .25;
  for (let i = 0; i < n; i++) { const a0 = rot + i * Math.PI * 2 / n + Math.sin(i * 7.3) * .05, wd = .018 + .02 * ((i * 37) % 5) / 5, r0 = R * (.1 + .06 * ((i * 13) % 4));
    c.beginPath(); c.moveTo(x + Math.cos(a0) * r0, y + Math.sin(a0) * r0);
    c.lineTo(x + Math.cos(a0 - wd) * R, y + Math.sin(a0 - wd) * R); c.lineTo(x + Math.cos(a0 + wd) * R, y + Math.sin(a0 + wd) * R); c.fill(); }
  c.globalCompositeOperation = 'source-over';
}

// Rival daze: stars circle his head and he wobbles (low HP or after a cinematic hit). Street Fighter stun icons.
const daze = { on: false, tw: -9, k: 0 };
// Your dizzy: v jumps on a hit and fades to a floor while your HP is low. Blur + desaturate + tilt + double vision of the
// rival + a dark vignette; hearing goes muffled with a ringing tone; a heartbeat at low HP.
const dz = { v: 0, hold: 0, floor: 0, beat: 0, lp: 20000, filt: '' };
function dizzy(a, hold = .6) { dz.v = Math.max(dz.v, a); dz.hold = Math.max(dz.hold, hold); if (a >= .45) SFX.ring(a); }
function lowHp(k) { dz.floor = Math.max(0, Math.min(.5, k)); }
function startKO() { wind.on = false; foe.st = 'ko'; foe.t = 0;
  rival.go(POSE.ko, .35, ease.out); crowd(.5, 3); after(380, () => SFX.bell()); }
function revive() {   // next rival walks in: stand back up into guard
  foe.fall = 0; foe.kb = null; daze.on = false; daze.k = 0; rivalHolder.rotation.set(0, 0, 0); foe.guardUp = false; rival.set(POSE.guard); foeIdle(); foe.st = 'idle';
  wind.on = false; wind.k = 0; wind.froze = false;
}

// ---------------- his punch: stop motion ----------------
// Owner 2026-11-18T22:01Z "lets not do the slow motion just make it a stop motion then, the sfx and animation for slow motion is
// so weird i want to remove". windup(type, ms): he chambers and throws at full speed (ms after the chamber), then he stops dead
// with his fist in the air: no creep, no hum, no grey-out, his sway and the stars over his head stop too. He stays frozen while
// you PULL, until you PUNCH (or bust); hisLand() finishes the punch at full speed. Looks only: there is no timer.
const wind = { on: false, cut: false, t0: 0, ms: 1, type: 'jab', bump: 0, k: 0, froze: false };
const CH = { jab: mixPose(POSE.guard, POSE.chamber, .6), hook: POSE.chamber, heavy: POSE.chamber };
const CH_MS = { jab: 160, hook: 220, heavy: 240 };   // the chamber before the throw
// how far into the punch his fist gets before the picture stops. r17 polish: was .7/.8/.86, where his fist had already dropped
// behind your left glove and read as a fist at your belly; at about .35 it hangs in front of his chest, big and clearly coming.
// THROW keeps the speed real: the shorter path takes a matching part of the rule ms, so it does not read as slow motion.
const REACH = { jab: .34, hook: .36, heavy: .36 }, THROW = .55;
function windK() { return wind.on ? Math.max(0, Math.min(1, (clock.ms - wind.t0) / wind.ms)) : wind.k; }
function windup(type = 'jab', ms = 300) {
  const k = CH[type] ? type : 'jab';
  Object.assign(wind, { on: true, cut: false, t0: clock.ms + CH_MS[k], ms: Math.max(1, ms * THROW), type: k, bump: 0, k: 0, froze: false });
  foe.st = 'wind'; foe.t = 0; G.bigUsed = false; rival.go(CH[k], CH_MS[k] / 1000, ease.out); SFX.tell(k === 'heavy');
}
const frozen = () => foe.st === 'wind' && wind.froze;
function lurch() {   // a black tile: he twitches closer (looks only)
  if (!wind.on) return; SFX.tell(false); addShake(3, .15, .2);   // r17: he stays frozen; only the camera jolts
}
let dodgeV = { t: 9, dir: 1 };
function hisLand(o = {}) {   // {dmg, big}: resolves at contact
  return new Promise(res => {
    const live = foe.st === 'wind' && !wind.cut, type = wind.type;
    wind.k = windK(); wind.on = false; wind.froze = false;
    if (foe.st === 'ko') { res(); return; }
    foe.st = 'atk'; foe.t = 0;
    const lead = live ? 0 : 150;
    if (!live) { rival.go(CH[type], .15, ease.out); SFX.tell(type === 'heavy'); }
    after(lead, () => { if (foe.st !== 'atk') return; rival.go(POSE.punch, .1, ease.in); SFX.whoosh(0); });
    after(lead + 100, () => {
      if (foe.st === 'ko') { res(); return; }
      const s = Math.min(1, (o.dmg || 5) / 10);   // no guard tile since r17: it always lands in full
      G.hitstop = T.playerHitStop; SFX.hurt(); addShake(o.big ? 22 : 10 + 6 * s, o.big ? .5 : .35, 1); vignV = 1; player.jolt = 1;
      if (FXS.effects) flashV = .25; $('flash').style.background = '#fff';
      dizzy(o.big ? .95 : .4 + .3 * s, o.big ? 1.1 : .45);
      for (const k of ['L', 'R']) arm[k].go(AP[k]('fp_guard'), .12);
      res();
    });
    after(lead + 650, () => { if (foe.st === 'atk') foeIdle(); });
  });
}
function setGuardUp(on) { foe.guardUp = on; if (foe.st === 'idle' || foe.st === 'hurt') rival.go(on ? POSE.block : POSE.guard, on ? .1 : .2, ease.out); }
function rivalStrike(opts = {}) {   // he lands one shot on you (after a punch that did not KO, or after a bust: opts.big)
  return new Promise(res => {
    foe.st = 'atk'; rival.go(POSE.chamber, .3, ease.out); SFX.tell(true);
    after(330, () => { rival.go(POSE.punch, T.rivalStrike, ease.in); SFX.whoosh(0); });
    after(330 + T.rivalStrike * 1000, () => { G.hitstop = T.playerHitStop; SFX.hurt(); addShake(opts.big ? 22 : 15, opts.big ? .5 : .38, 1); vignV = 1; if (FXS.effects) flashV = .25; player.jolt = 1;
      $('flash').style.background = '#fff'; dizzy(opts.big ? .95 : .55, opts.big ? 1.1 : .45);
      for (const s of ['L', 'R']) arm[s].go(AP[s]('fp_guard'), .12); res(); });
    after(1000, () => { foe.st = 'idle'; rival.go(POSE.guard, .4, ease.inOut); });
  });
}
function taunt() { if (foe.st !== 'idle') return; foe.st = 'taunt'; foe.t = 0; rival.go(POSE.chamber, .25, ease.out); SFX.tell(false); }

function update(dt) {
  G.time += dt; if (!frozen()) G.ft += dt;   // G.ft: his own clock (sway, daze), stopped while his punch is frozen
  let leanTo = 0;
  for (const s of ['L', 'R']) { const a = player.arms[s], dir = s === 'L' ? -1 : 1; a.t += dt;
    if (a.st === 'cock' && a.t >= a.load + (a.hold || 0)) strike(s);
    else if (a.st === 'startup' && a.t >= SP[s].startup) land(s);
    else if (a.st === 'recover' && a.t >= SP[s].recover * 1.4) a.st = 'idle';
    // the shoulders turn with it: wind away from the punching side, then drive through toward it
    if (a.st === 'cock') leanTo += -.7 * dir; else if (a.st === 'startup') leanTo += dir; else if (a.st === 'recover' && a.t < .08) leanTo += .6 * dir; }
  player.lean += (leanTo - player.lean) * (1 - Math.exp(-dt * (Math.abs(leanTo) > Math.abs(player.lean) ? 30 : 9)));
  // his body rocks back from your hits and swings forward again (a damped spring, so it settles instead of snapping)
  foe.pushV += (-foe.push * 140 - foe.pushV * 16) * dt; foe.push = Math.max(-.3, foe.push + foe.pushV * dt);
  foe.t += dt;
  const tired = dmg.v;   // a hurt rival bobs slower and deeper
  switch (foe.st) {
    case 'idle': if (rival.done && !foe.guardUp) { foe.bob = Math.min(1, foe.bob + dt / .35); const w = foe.bob * (.5 - .5 * Math.cos(foe.t * Math.PI * 2 / (.9 + .55 * tired))) * (1 + .5 * tired); rival.set(mixPose(POSE.guard, POSE.guardB, Math.min(1.3, w))); } break;
    case 'wind': if (rival.done) { const k = windK(), e = 1 - (1 - k) * (1 - k);   // the throw: fast out, then the stop
      // the stop: one small jolt of the camera so it reads as a freeze-frame and not as the game hanging
      if (k >= 1 && wind.on && !wind.froze) { wind.froze = true; kick.s = Math.max(kick.s, .012); addShake(2.5, .08, .15); }
      rival.set(mixPose(CH[wind.type], POSE.punch, Math.min(.95, REACH[wind.type] * e + wind.bump * .06))); } break;
    case 'hurt': if (foe.t >= foe.stun) { if (wind.on) { foe.st = 'wind'; rival.go(CH[wind.type], .18, ease.out); } else foeIdle(); } break;
    case 'taunt': if (foe.t >= .55) foeIdle(); break;
    case 'ko': if (foe.t > .3) foe.fall = Math.min(1, foe.fall + dt / .65); break;
  }
}

const listeners = [];
// FLASH + ZOOM switched off: drop what is on screen right now. Needed while PAUSED too, when no frame runs to redraw
// (Codex review 2: a cinematic flash paused at .5 stayed on the paused screen and came back at .42 after RESUME).
function fxOff() {
  flashV = 0; $('flash').style.opacity = 0;
  if (cine.lb) { stage.classList.remove('cine'); cine.lb = false; } stage.style.setProperty('--lb', '0%'); cine.lbv = '0.00';
  if (cine.drawn) { drawCine(0); cine.drawn = false; }
  if (ghost.on) { gctx.clearRect(0, 0, ghost.width, ghost.height); ghost.on = false; }
  world.style.filter = ''; dz.filt = ''; world.style.transform = 'none'; armsLayer.style.transform = '';
}
let TSLOW = TEST ? q('tslow', 1) : 1;   // ?test&tslow=.1: the whole fight at a tenth of real speed, for frame-by-frame review shots
const PERF = QS.has('perf') ? (window.__perf = { js: [], gap: [], prev: 0 }) : null;   // ?perf: JS time per frame and frame gaps (r16 lag check)
function frame(now) {
  requestAnimationFrame(frame);   // first, so one bad frame cannot stop the loop
  if (G.paused) { last = now; return; }   // home, PAUSED and other screens: no 3D cost and the game clock stands still
  const pt0 = PERF ? performance.now() : 0; if (PERF) { if (PERF.prev) PERF.gap.push(+(now - PERF.prev).toFixed(1)); PERF.prev = now; }
  clock.ms += Math.min(100, Math.max(0, now - last)) * TSLOW; runJobs();
  const rdt = Math.min(.05, (now - last) / 1000) * TSLOW; last = now;
  G.rt += rdt;
  let dt = rdt;   // no slow motion since r17; the freeze-frame stops everything
  if (G.hitstop > 0) { G.hitstop -= rdt; dt = 0; }
  update(dt); rival.update(dt); arm.L.update(dt); arm.R.update(dt);
  // his own body timers run on his clock: while his punch is frozen the bruise ease (which also leans him as he tires), the
  // hit jitter, the bump and the daze droop all stop with him (r17 polish: they kept settling and he drifted a little)
  const hdt = frozen() ? 0 : rdt;
  tickDamage(hdt);
  const tired = dmg.v, ft = G.ft, sway = foe.st === 'ko' ? 0 : Math.sin(ft * (1.7 - .5 * tired)) * (.05 + .06 * tired);
  rivalJitter *= Math.pow(.0005, hdt); const j = G.hitstop > 0 ? rivalJitter : rivalJitter * .3;
  // his throw: his body leans in behind the fist (and stays there while it is frozen)
  const wk = foe.st === 'wind' ? windK() : 0;
  wind.bump *= Math.pow(.004, hdt);
  // knock-back after a cinematic hit: out and back while time is slowed
  let kbz = 0, kbx = 0;
  if (foe.kb) { const b = foe.kb; b.t += dt; const e = b.t < .08 ? ease.out(b.t / .08) : Math.exp(-(b.t - .08) * 4); kbz = e * b.amp; kbx = e * b.side * b.amp; if (b.t > 1.6) foe.kb = null; }
  const dazed = daze.on && foe.st !== 'ko';
  daze.k += ((dazed ? 1 : 0) - daze.k) * (1 - Math.exp(-hdt * 3.5)); const dk = daze.k;   // eases in and out; r16 "stars look terrible": he now droops and sways with them
  if (dazed) { daze.tw = (daze.tw ?? 0) - rdt; if (daze.tw <= 0) { SFX.dizzy(daze.tw < -1 ? .38 : .2); daze.tw = 3.4; } } else daze.tw = -9;
  const jx = j * (.6 * Math.sin(G.rt * 71) + .4 * Math.sin(G.rt * 113 + 1.3)), jz = j * .5 * Math.sin(G.rt * 89 + 2.1);
  rivalHolder.position.set(pivot.x + sway + jx + kbx * .14 + dk * .07 * Math.sin(ft * 1.15), 0, jz - kbz * .5 + (wk * .55 + wind.bump * .08) * .3 - foe.push * .22);
  rivalHolder.rotation.x = -ease.in(foe.fall) * 1.3 - kbz * .12 + tired * .05 * (1 - foe.fall) - foe.push * .07 + dk * (.05 + .015 * Math.sin(ft * 2.3));
  rivalHolder.rotation.y = kbx * .16 + (foe.st === 'wind' && wind.type === 'hook' ? -.12 * Math.min(1, foe.t / .25) : 0);
  rivalHolder.rotation.z = dk * Math.sin(ft * 1.15) * .075 - kbx * .07;
  placeBlobs();
  rivalFlash = Math.max(0, rivalFlash - rdt * 13);   // a quick warm blink on the hit; at .55 and a slower fade he read as half see-through
  for (const m of rivalMats) { m.emissiveIntensity = rivalFlash * .32; m.emissive.setRGB(1, .9, .78); }
  shake.t += rdt; const sk = shake.t < shake.dur ? shake.a * Math.pow(1 - shake.t / shake.dur, 2) : 0, st = shake.t, p = shake.p;
  const sx = sk * (.6 * Math.sin(st * 57 + p[0]) + .4 * Math.sin(st * 88 + p[1])), sy = sk * (.6 * Math.sin(st * 63 + p[2]) + .4 * Math.sin(st * 97 + p[3]));
  kick.s *= Math.pow(.002, rdt);
  // dodge: you lean out of his punch (the arena slides the other way, your arms follow late)
  dodgeV.t += rdt; const dt0 = dodgeV.t, de = dt0 < .12 ? ease.out(dt0 / .12) : dt0 < .3 ? 1 : dt0 < .75 ? 1 - ease.inOut((dt0 - .3) / .45) : 0;
  const dgx = de * dodgeV.dir * W * .085 * FXS.shake, dgr = de * dodgeV.dir * 4 * FXS.shake;
  // cinematic zoom (toward his head) and letterbox, in real time (it glides in during the freeze-frame)
  cine.t += rdt; const ck = FXS.effects ? cineK() : 0, wz = 1 + kick.s + ck * cine.peak;
  const lb = ck > .01; if (lb !== cine.lb) { stage.classList.toggle('cine', lb); cine.lb = lb; }
  const lbv = (ck * 9).toFixed(2); if (lbv !== cine.lbv) { stage.style.setProperty('--lb', lbv + '%'); cine.lbv = lbv; }
  // dizzy level: jumps on a hit, holds, then fades to the low-HP floor
  if (dz.hold > 0) dz.hold -= rdt;
  else if (dz.v > dz.floor) dz.v = Math.max(dz.floor, dz.v - rdt * .75); else dz.v = Math.min(dz.floor, dz.v + rdt * .5);
  const dv = FXS.effects ? dz.v : 0, tilt = dv * 2.6 * Math.sin(G.time * 1.25) + dgr, drift = dv * W * .014 * Math.sin(G.time * .85);
  if (cine.hx) world.style.transformOrigin = `${cine.hx + W * (OS - 1) / 2}px ${cine.hy + H * (OS - 1) / 2}px`;
  world.style.transform = `translate(${(sx + drift - dgx).toFixed(1)}px,${sy.toFixed(1)}px) scale(${wz.toFixed(4)}) rotate(${tilt.toFixed(2)}deg)`;
  const fl = [];
  if (dv > .03) fl.push(`blur(${(Math.max(0, dv - dz.floor * .6) * 2.8).toFixed(1)}px)`);
  const sat = 1 - .62 * dv; if (sat < .995) fl.push(`saturate(${sat.toFixed(2)})`);
  const filt = fl.join(' ');
  if (filt !== dz.filt) { world.style.filter = filt; dz.filt = filt; }
  player.jolt *= Math.pow(.004, rdt);
  const breathe = Math.sin(G.time * Math.PI * 2 / .9 + 1) * H * .004;
  armsOff.x = sx * shake.armsK + drift * 1.4 + dgx * .35 + player.lean * W * .014;
  armsOff.y = sy * shake.armsK + breathe + player.jolt * H * .07 + dv * H * .012 + de * H * .025 + Math.abs(player.lean) * H * .006;
  if (ck > 0) armsLayer.style.transformOrigin = `${cine.gx}px ${cine.gy}px`;
  armsLayer.style.transform = `translate(${armsOff.x.toFixed(1)}px,${armsOff.y.toFixed(1)}px) scale(${(1 + ck * cine.peak * .5).toFixed(4)}) rotate(${(tilt * .45 + player.lean * 1.3).toFixed(2)}deg)`;
  flashV = Math.max(0, flashV - rdt * (ck > 0 ? 2.2 : 5)); vignV = Math.max(0, vignV - rdt * 2.2);
  $('flash').style.opacity = flashV; $('vignette').style.opacity = vignV;
  // low HP: a heartbeat and a dark vignette that pulses with it (Thrill of the Fight: a permanent vignette while hurt)
  if (dz.floor > 0) { dz.beat -= rdt; if (dz.beat <= 0) { dz.beat = .95 - dz.floor * .7; SFX.heart(dz.floor * 2); dz.pulse = 1; } } else dz.beat = 0;
  dz.pulse = (dz.pulse || 0) * Math.pow(.015, rdt);
  dizzyV.style.opacity = Math.min(1, (FXS.effects ? dz.floor * 1.5 + dz.v * .6 : dz.floor * 1.1) + dz.pulse * .16 * (dz.floor > 0)).toFixed(3);
  if (AU.ctx) { const f = 20000 * Math.pow(500 / 20000, Math.min(1, dz.v * 1.05)); if (Math.abs(f - dz.lp) / dz.lp > .04) { AU.lp.frequency.setTargetAtTime(f, AU.ctx.currentTime, .03); dz.lp = f; } }
  if (ck > 0 || cine.drawn) { drawCine(ck); cine.drawn = ck > 0; }
  while (portraitQ.length) { const q = portraitQ.shift(); try { renderPortrait(q.cv); } catch (e) { console.error(e); } q.res(); }
  rivalR.render(rivalScene, rivalCam); armsR.render(armsScene, armsCam);
  // double vision: a faint copy of the rival drifting off to one side
  if (dv > .05) { gctx.clearRect(0, 0, ghost.width, ghost.height); gctx.globalAlpha = Math.min(.5, dv * .55);
    gctx.drawImage(rivalR.domElement, Math.sin(G.time * 2.1) * dv * ghost.width * .04, Math.cos(G.time * 1.5) * dv * ghost.height * .012); ghost.on = true; }
  else if (ghost.on) { gctx.clearRect(0, 0, ghost.width, ghost.height); ghost.on = false; }
  drawFx(rdt);
  if (daze.k > .03) { const hp = rivalCrown(), x = cine.hx ? cine.hx + (hp.x - cine.hx) * wz : hp.x, y = cine.hx ? cine.hy + (hp.y - cine.hy) * wz : hp.y, hs = hp.h * wz;
    // a ring of stars just over his crown, as wide as his head; the far side hides behind it
    stars(x, y - hs * .16, hs * .82, hs * .2, 3, hs * .2, ft * 3.4, Math.min(1, dk * 1.6), hs * .46, TW.foe, .27 - rivalHolder.rotation.z); }
  if (dv > .4) stars(W / 2, H * .09, W * .21, H * .03, 5, W * .028, -G.time * 2.6, Math.min(1, (dv - .4) * 3), 0, TW.you);
  for (const f of listeners) f(rdt, sk);
  if (PERF) PERF.js.push(+(performance.now() - pt0).toFixed(2));
}

// ---------------- extra sounds for the slot machine ----------------
Object.assign(SFX, {
  tick(p = 0) { if (!AU.ctx || smp('tick', { gain: .32, rate: 1 + p * .25, vary: .4 })) return; const t = AU.ctx.currentTime; tone(t, 1400 + p * 300, 900, .025, .07, 'square'); },
  reelSpin() { if (!AU.ctx) return; const t = AU.ctx.currentTime;   // the reel starts: a short rising whirr under the ticks
    noise(t, .26, 'bandpass', 700, 1.2, .16, .03, .22, 0, 2400); tone(t, 220, 520, .24, .04, 'triangle'); },
  reelStop(n = 0, kind) { if (!AU.ctx) return; const t = AU.ctx.currentTime;   // kind: the colour of the tile that lands
    if (kind && smp('tile_' + kind, { gain: kind === 'black' ? .75 : .55, rate: kind === 'red' ? Math.pow(2, Math.min(n, 6) / 12) : 1, vary: .3 })) return; tone(t, 180 - n * 8, 70, .1, .7, 'sine'); noise(t, .05, 'lowpass', 1200, .7, .35, .001, .05); tone(t, 900 + n * 120, 880 + n * 120, .07, .08, 'triangle'); },
  pop(n = 0) { if (!AU.ctx) return; const t = AU.ctx.currentTime, f = 520 * Math.pow(2, Math.min(n, 18) / 12); tone(t, f, f * 1.01, .12, .16, 'triangle'); tone(t, f * 2, f * 2, .06, .05, 'sine'); },
  boost(kind) { if (!AU.ctx) return; const t = AU.ctx.currentTime, f = kind === 'mul' ? 990 : kind === 'sub' ? 260 : 740;
    tone(t, f, f * (kind === 'sub' ? .7 : 1.5), .16, .14, kind === 'sub' ? 'sawtooth' : 'sine'); if (kind === 'mul') tone(t + .05, f * 1.5, f * 2, .14, .1, 'sine'); },
  sting() { if (AU.ctx) smp('sting', { gain: .4, vary: .3 }); },   // PUNCH pressed: a short brass-and-drum release
  dizzy(v = .35) { if (AU.ctx) smp('dizzy', { gain: v, vary: .5 }); },
  card() { if (!AU.ctx) return; const t = AU.ctx.currentTime; noise(t, .08, 'bandpass', 2500, 1.2, .18, .005, .07); tone(t, 660, 990, .09, .08, 'sine'); },
  pick() { if (!AU.ctx) return; const t = AU.ctx.currentTime; [523, 659, 784, 1046].forEach((f, i) => tone(t + i * .05, f, f, .18, .13, 'triangle')); },
  fanfare() { if (!AU.ctx) return; const t = AU.ctx.currentTime; [[523, 0], [659, .12], [784, .24], [1046, .38], [784, .52], [1046, .62]].forEach(([f, d]) => { tone(t + d, f, f, .32, .2, 'triangle'); tone(t + d, f / 2, f / 2, .3, .1, 'sine'); }); crowd(.45, 2.5); },
  lose() { if (!AU.ctx) return; const t = AU.ctx.currentTime; [[392, 0], [349, .22], [311, .44], [262, .7]].forEach(([f, d]) => tone(t + d, f, f * .98, .4, .18, 'triangle')); },
  chain() { if (!AU.ctx) return; const t = AU.ctx.currentTime; for (let i = 0; i < 4; i++) { tone(t + i * .045, 2400 + Math.random() * 900, 1800, .05, .06, 'square'); } noise(t, .2, 'highpass', 3000, .7, .2, .002, .18); },
  snip() { if (!AU.ctx) return; const t = AU.ctx.currentTime; noise(t, .04, 'highpass', 4000, 1, .4, .001, .04); noise(t + .07, .04, 'highpass', 4500, 1, .35, .001, .04); },
  bigNumber() { if (!AU.ctx) return; if (smp('bust', { gain: .5, vary: 0 })) { crowd(.3, 1.4); return; } const t = AU.ctx.currentTime; tone(t, 220, 110, .3, .5, 'sawtooth', AU.drive); crowd(.3, 1.4); },
});

rival.set(POSE.guard); arm.L.set(AP.L('fp_guard')); arm.R.set(AP.R('fp_guard'));
resize(); requestAnimationFrame(frame);
export const F = {
  punch, revive, setGuardUp, rivalStrike, taunt, resize, audioInit, SFX, crowd, sparks, addShake, dizzy, lowHp,
  daze: on => { daze.on = !!on; }, settings: o => { Object.assign(FXS, o); if (!FXS.effects) fxOff(); }, get cineLen() { return cine.dur; },
  pause(on) { G.paused = !!on; if (AU.ctx) { const g = AU.crowd.gain, t = AU.ctx.currentTime; g.cancelScheduledValues(t); g.setTargetAtTime(on ? 0 : .035, t, .2); } },
  // r15: his punch on the timer, the dodge, his face damage and the corner close-up
  windup, lurch, hisLand, now: () => clock.ms, slow: v => { if (TEST) TSLOW = v; }, armLoad: s => player.arms[s].load,
  sfxLoaded: () => Object.fromEntries(Object.entries(SMP.buf).map(([k, v]) => [k, v.length])),
  windHold() { if (!wind.on) return; wind.k = windK(); wind.on = false; },   // you hit PUNCH: his fist stays where it stopped until hisLand
  damage(k, seed) { const side = seed ? ((seed >>> 0) & 1 ? -1 : 1) : 0;   // the fight seed only picks which side of his face takes the A marks
    if (side && side !== dmg.seed) { dmg.seed = side; placeSpots(); } dmg.to = Math.max(0, Math.min(1, k)); },
  spots: () => ({ side: dmg.seed, hw: face.hw, pts: dmgU.uSpot.value.slice(0, SPOTS.length).map(v => [v.x, v.y, v.z]), fb: face.C.clone().addScaledVector(face.Fw, face.hw).toArray() }),   // for the check: where his face marks sit
  damageNow(k) { dmg.to = dmg.v = Math.max(0, Math.min(1, k)); setDamage(dmg.v); dmg.shown = dmg.v; },
  portrait: cv => new Promise(res => portraitQ.push({ cv, res })),
  reset() {   // new or quit match: drop pending timers and any punch still in the air, clear every effect
    clock.jobs = []; dz.v = 0; dz.hold = 0; dz.floor = 0; cine.t = 9; G.hitstop = 0; flashV = 0; vignV = 0; rivalFlash = 0; shake.t = shake.dur; dodgeV.t = 9;
    dmg.to = dmg.v = 0; dmg.fresh = 0; dmg.seed = Math.random() < .5 ? -1 : 1; placeSpots(); setDamage(0); dmg.shown = 0; portraitQ.length = 0;
    for (const s of ['L', 'R']) { const a = player.arms[s]; a.st = 'idle'; a.t = 0; a.job = null; arm[s].set(AP[s]('fp_guard')); }
    player.lean = 0; foe.push = foe.pushV = 0;
    revive(); },
  // match.js timers on the same pausable clock
  after: (ms, fn) => after(ms, fn),   // returns the job; set job.fn to a no-op to cancel it
  wait: ms => new Promise(r => after(ms, r)),
  mute(on) { AU.muted = !!on; if (AU.ctx) on ? AU.ctx.suspend() : AU.ctx.resume(); },
  onFrame: f => listeners.push(f),
  head: () => rivalPoint('head'),
  state: () => ({ foe: foe.st, fall: foe.fall, hitstop: G.hitstop, cine: cine.t < cine.dur ? cine.t : -1, dizzy: +dz.v.toFixed(2), daze: daze.on,
    wind: wind.on ? +windK().toFixed(3) : -1, froze: frozen(), ft: +G.ft.toFixed(3), speed: G.hitstop > 0 ? 0 : 1, dmg: +dmg.v.toFixed(2), dodge: dodgeV.t < .75 }),
  face,
};
