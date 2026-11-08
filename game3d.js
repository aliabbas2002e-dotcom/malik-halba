import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
const isTouch = matchMedia('(pointer:coarse)').matches;
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, isTouch ? 1.25 : 1.75));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.localClippingEnabled = true;

const scene = new THREE.Scene();
scene.background = new THREE.Color('#10121f');
const camera = new THREE.PerspectiveCamera(32, 1, .5, 200);
const camDir = new THREE.Vector3(0, .68, .73).normalize();
const camTarget = new THREE.Vector3(0, .4, .5);

const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(renderer), .04).texture;
scene.add(new THREE.HemisphereLight('#aeb9e8', '#5a4228', .45));
const sun = new THREE.DirectionalLight('#ffdcaa', 2.6);
sun.position.set(9, 22, 10);
sun.castShadow = true;
sun.shadow.mapSize.set(isTouch ? 1024 : 2048, isTouch ? 1024 : 2048);
Object.assign(sun.shadow.camera, { left: -17, right: 17, top: 13, bottom: -13, near: 1, far: 60 });
sun.shadow.bias = -.0006;
sun.shadow.normalBias = .03;
scene.add(sun);

const px2x = x => (x - 480) / 40, px2z = y => (y - 310) / 40;
const damp = (v, t, r, dt) => v + (t - v) * Math.min(1, r * dt);
const TAU = Math.PI * 2;
const lerp = (a, b, k) => a + (b - a) * k;
function lerpA(a, b, k) { let d = b - a; while (d > Math.PI) d -= TAU; while (d < -Math.PI) d += TAU; return a + d * k; }

/* ---------- assets ---------- */
const NAMES = ['arena', 'king', 'fighter', 'sword', 'spear', 'bow', 'hammer', 'potion'];
const MODEL = {};
const loader = new GLTFLoader();
await Promise.all(NAMES.map(n => loader.loadAsync('assets/' + n + '.glb').then(g => { MODEL[n] = g.scene; })));
for (const n of NAMES) MODEL[n].traverse(o => { if (o.isMesh && o.material) o.material.envMapIntensity = o.material.metalness > .5 ? 1 : .12; });
const WMODEL = [null, 'sword', 'spear', 'bow', 'hammer'];
const GRIP = [0, 2.0, 2.77, 1.57, 1.6];
const HOLD = [-.45, -1, -1.2, -1.57, -1];

MODEL.arena.traverse(o => { if (o.isMesh) { o.receiveShadow = true; o.castShadow = !/^b_(sand|under|base)/.test(o.name); } });
scene.add(MODEL.arena);

function glowTex() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d'), r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(.3, 'rgba(255,255,255,.45)'); r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r; g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
const GLOW = glowTex();
function glow(color, size) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: GLOW, color, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
  s.scale.setScalar(size); return s;
}
const torches = [[-12.05, 7.8], [12.05, 7.8], [-12.05, -7.8], [12.05, -7.8], [-6, -7.85], [6, -7.85], [-6, 7.85], [6, 7.85]]
  .map(([x, z]) => { const s = glow('#ff8a2a', 3.4); s.position.set(x, 3.6, z); scene.add(s); return s; });

/* ---------- zone ---------- */
const clip = [new THREE.Plane(new THREE.Vector3(1, 0, 0), 12), new THREE.Plane(new THREE.Vector3(-1, 0, 0), 12),
  new THREE.Plane(new THREE.Vector3(0, 0, 1), 7.75), new THREE.Plane(new THREE.Vector3(0, 0, -1), 7.75)];
const zoneGround = new THREE.Mesh(new THREE.RingGeometry(1, 40, 96),
  new THREE.MeshBasicMaterial({ color: '#ff2d2d', transparent: true, opacity: .3, depthWrite: false, clippingPlanes: clip }));
zoneGround.rotation.x = -Math.PI / 2; zoneGround.position.set(0, .3, -.5); scene.add(zoneGround);
const zoneWall = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 3.4, 96, 1, true),
  new THREE.MeshBasicMaterial({ color: '#ff4a3a', transparent: true, opacity: .2, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending, clippingPlanes: clip }));
zoneWall.position.set(0, 1.8, -.5); scene.add(zoneWall);

/* ---------- particles ---------- */
const PN = 420, ppos = new Float32Array(PN * 3), pcol = new Float32Array(PN * 3), P = [];
for (let i = 0; i < PN; i++) { P.push({ l: 0, m: 1, vx: 0, vy: 0, vz: 0, g: 0, r: 1, gc: 1, b: 1 }); ppos[i * 3 + 1] = -50; }
const pgeo = new THREE.BufferGeometry();
pgeo.setAttribute('position', new THREE.BufferAttribute(ppos, 3));
pgeo.setAttribute('color', new THREE.BufferAttribute(pcol, 3));
const points = new THREE.Points(pgeo, new THREE.PointsMaterial({ size: .24, map: GLOW, vertexColors: true, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
points.frustumCulled = false; scene.add(points);
let pi = 0;
const tmpC = new THREE.Color();
function burst(x, y, z, n, col, sp, grav, life) {
  tmpC.set(col);
  for (let i = 0; i < n; i++) {
    const p = P[pi], a = Math.random() * TAU, u = Math.random() * sp;
    p.l = p.m = life * (.5 + Math.random() * .7); p.vx = Math.cos(a) * u; p.vz = Math.sin(a) * u; p.vy = Math.random() * sp * 1.1; p.g = grav;
    p.r = tmpC.r; p.gc = tmpC.g; p.b = tmpC.b;
    ppos[pi * 3] = x; ppos[pi * 3 + 1] = y; ppos[pi * 3 + 2] = z;
    pi = (pi + 1) % PN;
  }
}
function stepParticles(dt) {
  for (let i = 0; i < PN; i++) {
    const p = P[i];
    if (p.l <= 0) { ppos[i * 3 + 1] = -50; continue; }
    p.l -= dt; p.vy -= p.g * dt;
    ppos[i * 3] += p.vx * dt; ppos[i * 3 + 1] = Math.max(.15, ppos[i * 3 + 1] + p.vy * dt); ppos[i * 3 + 2] += p.vz * dt;
    const k = Math.max(0, p.l / p.m);
    pcol[i * 3] = p.r * k; pcol[i * 3 + 1] = p.gc * k; pcol[i * 3 + 2] = p.b * k;
  }
  pgeo.attributes.position.needsUpdate = true; pgeo.attributes.color.needsUpdate = true;
}

/* ---------- characters ---------- */
const labels = document.getElementById('labels');
const ACT = {};
function weaponModel(w) { return w && WMODEL[w] ? MODEL[WMODEL[w]].clone(true) : null; }
function shadowed(o) { o.traverse(c => { if (c.isMesh) { c.castShadow = true; c.receiveShadow = true; } }); }

function buildActor(i, p, role) {
  const root = new THREE.Group();
  const body = MODEL[role === 0 ? 'king' : 'fighter'].clone(true);
  const col = new THREE.Color(TC[p.t]);
  const tm = {};
  body.traverse(o => {
    if (o.isMesh && o.material.name === 'team') { tm.m = tm.m || o.material.clone(); tm.m.color.copy(col); o.material = tm.m; }
  });
  shadowed(body);
  body.scale.setScalar(role === 0 ? 1.28 : 1.2);
  root.add(body);
  const ring = new THREE.Mesh(new THREE.RingGeometry(.62, .78, 40), new THREE.MeshBasicMaterial({ color: p.id === pid ? '#ffffff' : col, transparent: true, opacity: p.id === pid ? .95 : .6, depthWrite: false }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = .06; root.add(ring);
  const shield = new THREE.Group();
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(.5, .5, .07, 28), new THREE.MeshStandardMaterial({ color: col, metalness: .3, roughness: .4 }));
  const rim = new THREE.Mesh(new THREE.TorusGeometry(.5, .05, 8, 28), new THREE.MeshStandardMaterial({ color: '#f2b632', metalness: 1, roughness: .3 }));
  disc.rotation.x = Math.PI / 2; shield.add(disc, rim); shield.position.set(0, 1.25, .78); shield.visible = false; shadowed(shield); root.add(shield);
  scene.add(root);
  const label = document.createElement('div'); label.className = 'lb';
  const nm = document.createElement('b'); nm.textContent = (role === 0 ? '♛ ' : '') + p.n; nm.style.color = TC[p.t];
  const bar = document.createElement('i'); const fill = document.createElement('u'); bar.append(fill); label.append(nm, bar); labels.append(label);
  return {
    key: p.id + role + p.t, root, body, shield, label, fill, ph: 0, mv: 0, x: 0, y: 0, dead: 0, w: -1, ring,
    legL: body.getObjectByName('leg_L'), legR: body.getObjectByName('leg_R'), armL: body.getObjectByName('arm_L'), armR: body.getObjectByName('arm_R'),
    torso: body.getObjectByName('torso'), head: body.getObjectByName('head'), socket: body.getObjectByName('hand_socket'), wm: null
  };
}
function actor(i, p, role) {
  let a = ACT[i], key = p.id + role + p.t;
  if (a && a.key !== key) { disposeActor(i); a = null; }
  if (!a) a = ACT[i] = buildActor(i, p, role);
  return a;
}
function disposeActor(i) { const a = ACT[i]; if (!a) return; scene.remove(a.root); a.label.remove(); delete ACT[i]; }
function setWeapon(a, w) {
  if (a.w === w) return; a.w = w;
  if (a.wm) a.socket.remove(a.wm);
  a.wm = weaponModel(w);
  if (a.wm) { shadowed(a.wm); a.wm.rotation.x = GRIP[w]; a.socket.add(a.wm); }
}
function inBase(x, y) { return BASES.some(b => x > b[0] && x < b[0] + b[2] && y > b[1] && y < b[1] + b[3]); }

function animate(a, e, i, idx, dt, now, swing) {
  const alive = e.f & 1;
  a.label.style.display = alive ? '' : 'none';
  if (!alive) {
    a.dead += dt; a.ring.visible = false;
    a.body.rotation.x = Math.min(Math.PI / 2, a.dead * 7);
    a.root.visible = a.dead < 1.1;
    a.root.position.y -= a.dead > .6 ? dt * .6 : 0;
    return;
  }
  a.dead = 0; a.root.visible = true; a.ring.visible = true; a.body.rotation.x = 0;
  const sp = Math.hypot(e.x - a.x, e.y - a.y) / Math.max(dt, .001);
  a.x = e.x; a.y = e.y;
  a.mv = damp(a.mv, sp > 18 ? 1 : 0, 12, dt);
  a.ph += dt * (sp / 24 + 2);
  a.root.position.set(px2x(e.x), inBase(e.x, e.y) ? .23 : .12, px2z(e.y));
  a.root.rotation.y = Math.atan2(Math.cos(e.a), Math.sin(e.a));
  const leg = Math.sin(a.ph) * .75 * a.mv;
  a.legL.rotation.x = leg; a.legR.rotation.x = -leg;
  a.body.position.y = Math.abs(Math.sin(a.ph)) * .09 * a.mv + Math.sin(now / 420 + i) * .012;
  a.torso.rotation.x = damp(a.torso.rotation.x, (e.f & 4 ? .6 : .1 * a.mv), 14, dt);
  a.armL.rotation.x = e.f & 2 ? -1.5 : -leg * .7;
  setWeapon(a, e.w);
  a.shield.visible = !!(e.f & 2);
  let th = HOLD[e.w], yaw = 0;
  if (a.wm) a.wm.position.set(0, 0, 0);
  if (i === idx && charging) { const c = Math.min(1, (performance.now() - pressAt) / 450); th = lerp(th, -2.75, c); yaw = -.5 * c; }
  if (swing) {
    const k = Math.min(1, swing.t / swing.life);
    if (e.w === 2) { const s = Math.sin(k * Math.PI); if (a.wm) a.wm.position.y = 0; th = HOLD[2]; a.armR.position.z = 0; a.body.position.z = s * .15; if (a.wm) a.wm.translateY(s * 1.3); }
    else if (e.w === 3) th = HOLD[3] + Math.sin(k * Math.PI) * .25;
    else { th = lerp(-2.7, -.15, Math.pow(k, .55)); yaw = lerp(.75, -.85, k); }
  }
  a.armR.rotation.x = th + Math.sin(now / 500 + i) * .03;
  a.torso.rotation.y = damp(a.torso.rotation.y, yaw, 26, dt);
  if (a.head) a.head.rotation.z = e.f & 8 ? Math.sin(now / 45) * .35 : 0;
  a.root.rotation.z = e.f & 8 ? Math.sin(now / 60) * .06 : 0;
  if (e.f & 4 && Math.random() < .7) burst(a.root.position.x, .3, a.root.position.z, 1, '#c9a06a', 1.6, 2, .45);
  else if (a.mv > .7 && Math.random() < .06) burst(a.root.position.x, .2, a.root.position.z, 1, '#a88858', .7, .5, .4);
  const max = STAT[e.r].hp, pct = Math.max(0, Math.min(100, e.hp / max * 100));
  a.fill.style.width = pct + '%'; a.fill.style.background = pct > 35 ? '#6fe08a' : '#ff5a5a';
  tv.set(a.root.position.x, e.r === 0 ? 3.75 : 3.2, a.root.position.z).project(camera);
  a.label.style.transform = `translate(-50%,-100%) translate(${(tv.x + 1) / 2 * innerWidth + shX}px,${(1 - tv.y) / 2 * innerHeight + shY}px)`;
}

/* ---------- pickups & arrows ---------- */
const PK = new Map();
function syncPickups(list, now, dt) {
  const seen = new Set();
  for (const q of list) {
    const k = q[0] + '_' + q[1]; seen.add(k);
    let g = PK.get(k);
    if (g && g.ty !== q[2]) { scene.remove(g.o); PK.delete(k); g = null; }
    if (!g) {
      const o = new THREE.Group(), name = q[2] === 5 ? 'potion' : WMODEL[q[2]], m = MODEL[name].clone(true); shadowed(m);
      if (q[2] !== 5) { m.rotation.z = .5; m.scale.setScalar(q[2] === 2 ? .62 : .85); m.position.y = q[2] === 2 ? -.3 : -.2; }
      o.add(m);
      const c = q[2] === 5 ? '#4dff9a' : q[2] === 4 ? '#ffb020' : '#ff8ab8', gl = glow(c, q[2] === 4 ? 3 : 1.5); gl.material.opacity = .45; gl.position.y = .3; o.add(gl);
      o.position.set(px2x(q[0]), 0, px2z(q[1])); scene.add(o);
      g = { o, m, ty: q[2] }; PK.set(k, g);
    }
    g.m.rotation.y += dt * 1.6; g.o.position.y = .65 + Math.sin(now / 380 + q[0]) * .13;
  }
  for (const [k, g] of PK) if (!seen.has(k)) { scene.remove(g.o); PK.delete(k); }
}
const arrowGeo = new THREE.CylinderGeometry(.035, .035, 1, 6); arrowGeo.rotateZ(Math.PI / 2);
const arrowMat = new THREE.MeshBasicMaterial({ color: '#ffe9b8' }), arrows = [];
function syncArrows(list) {
  while (arrows.length < list.length) { const m = new THREE.Mesh(arrowGeo, arrowMat); m.add(glow('#ffc060', .9)); scene.add(m); arrows.push(m); }
  arrows.forEach((m, i) => { const b = list[i]; m.visible = !!b; if (b) { m.position.set(px2x(b[0]), 1.15, px2z(b[1])); m.rotation.y = -b[2] / 100; } });
}

/* ---------- swing arcs ---------- */
const arcs = [];
function spawnArc(f, a) {
  const w = WP[f.w]; if (w.bow) return;
  const r = (w.r + 8) / 40, half = (w.arc || 1) / 2;
  const geo = new THREE.RingGeometry(r * .45, r, 24, 1, -half, half * 2);
  const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: f.h ? '#ff9c4a' : f.w === 4 ? '#ffc84a' : '#ffffff', transparent: true, opacity: .55, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }));
  m.rotation.set(Math.PI / 2, 0, f.a);
  m.position.set(a.root.position.x, 1.05, a.root.position.z); scene.add(m); arcs.push({ m, t: 0, life: f.life + .06 });
}
function stepArcs(dt) {
  for (let i = arcs.length - 1; i >= 0; i--) {
    const a = arcs[i]; a.t += dt; a.m.material.opacity = .55 * (1 - a.t / a.life);
    if (a.t >= a.life) { scene.remove(a.m); a.m.geometry.dispose(); a.m.material.dispose(); arcs.splice(i, 1); }
  }
}

/* ---------- damage numbers ---------- */
function floatText(x, y, txt, big) {
  tv.set(px2x(x), 2.4, px2z(y)).project(camera);
  const d = document.createElement('div'); d.className = 'dmg' + (big ? ' big' : ''); d.textContent = txt;
  d.style.left = (tv.x + 1) / 2 * innerWidth + 'px'; d.style.top = (1 - tv.y) / 2 * innerHeight + 'px';
  labels.append(d); setTimeout(() => d.remove(), 720);
}

function fit() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false); camera.aspect = w / h;
  const t = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  fitD = Math.max(15.5 / (t * camera.aspect), 11.4 / t);
  camera.updateProjectionMatrix();
}
let fitD = 40, shX = 0, shY = 0;
const tv = new THREE.Vector3(), ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), gp = new THREE.Plane(new THREE.Vector3(0, 1, 0), -1), hit = new THREE.Vector3();
addEventListener('resize', fit); fit();
window.R3 = { resize: fit };

let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(.05, (now - last) / 1000); last = now;
  if (!document.getElementById('game').classList.contains('on') || !V.cur) return;
  readKeys();
  const s = V.cur, p = V.prev, k = A.host ? 1 : Math.max(0, Math.min(1, (now - V.at) / 125)), idx = myIdx();
  const ents = s.e.map((e, i) => { const o = (p.e && p.e[i]) || e; return { x: lerp(o[0], e[0], k), y: lerp(o[1], e[1], k), a: lerpA(o[2] / 100, e[2] / 100, k), hp: e[3], f: e[4], w: e[5], rr: e[6], r: e[7] }; });

  if (idx >= 0 && ents[idx] && ents[idx].f & 1) {
    const me = ents[idx], sv = s.e[idx];
    if (!A.host && s.ph === 'fight' && !(sv[4] & 8)) {
      if (!V.me) V.me = { x: sv[0], y: sv[1] };
      const st = STAT[sv[7]]; let sp = st.sp * (inp.b ? .45 : 1); V.dashT -= dt;
      if (V.dashT > 0) sp = st.sp * 3.1;
      let mx = inp.x, my = inp.y;
      if (V.dashT > 0 && Math.hypot(mx, my) < .1) { mx = Math.cos(inp.a); my = Math.sin(inp.a); }
      V.me.x += mx * sp * dt; V.me.y += my * sp * dt; collide(V.me);
      const ex = sv[0] - V.me.x, ey = sv[1] - V.me.y;
      if (Math.hypot(ex, ey) > 130) { V.me.x = sv[0]; V.me.y = sv[1]; } else { const c = Math.min(1, dt * 5); V.me.x += ex * c; V.me.y += ey * c; }
      me.x = V.me.x; me.y = V.me.y;
    } else if (!A.host) V.me = { x: me.x, y: me.y };
    V.dashCd = Math.max(0, V.dashCd - dt);
    if (touchMode) {
      let best = null, bd = 320;
      ents.forEach((e, i) => { if (i === idx || !(e.f & 1) || !A.players[i] || A.players[i].t === A.players[idx].t) return; const d = Math.hypot(e.x - me.x, e.y - me.y); if (d < bd) { bd = d; best = e; } });
      if (best) inp.a = Math.atan2(best.y - me.y, best.x - me.x); else if (Math.hypot(inp.x, inp.y) > .2) inp.a = Math.atan2(inp.y, inp.x);
    } else {
      ndc.set(mouse.x / innerWidth * 2 - 1, -(mouse.y / innerHeight * 2 - 1));
      ray.setFromCamera(ndc, camera);
      if (ray.ray.intersectPlane(gp, hit)) inp.a = Math.atan2(hit.z * 40 + 310 - me.y, hit.x * 40 + 480 - me.x);
    }
    me.a = inp.a;
  }
  pushInput(false);

  V.shake = Math.max(0, V.shake - dt);
  const am = V.shake > 0 ? V.shake / .3 : 0;
  const j1 = (Math.random() - .5) * .5 * am, j2 = (Math.random() - .5) * .5 * am;
  shX = j1 * 22; shY = j2 * 22;
  camera.position.copy(camTarget).addScaledVector(camDir, fitD); camera.position.x += j1; camera.position.z += j2;
  camera.lookAt(camTarget.x + j1, camTarget.y, camTarget.z + j2);
  camera.updateMatrixWorld();

  const z = s.z / 40, show = z < 16;
  zoneGround.visible = zoneWall.visible = show;
  if (show) { zoneGround.scale.set(z, z, 1); zoneWall.scale.set(z, 1, z); zoneWall.material.opacity = .16 + Math.sin(now / 240) * .05; }
  torches.forEach((t, i) => { t.scale.setScalar(3.1 + Math.sin(now / 90 + i * 2) * .3 + Math.sin(now / 37 + i) * .15); });

  ents.forEach((e, i) => {
    const pl = A.players[i]; if (!pl) return;
    const a = actor(i, pl, e.r);
    let sw = null; for (const f of V.fx) if (f.k === 's' && f.i === i) { sw = f; break; }
    animate(a, e, i, idx, dt, now, sw);
  });
  for (const i in ACT) if (+i >= ents.length || !A.players[i]) disposeActor(i);

  for (const f of V.fx) {
    if (f.init) continue; f.init = 1;
    if (f.k === 's' && ACT[f.i]) spawnArc(f, ACT[f.i]);
    else if (f.k === 'h') { burst(px2x(f.x), 1.2, px2z(f.y), f.b ? 26 : 12, f.b ? '#ff8a3a' : '#ffe08a', f.b ? 6 : 4, 11, .5); floatText(f.x, f.y, f.txt, f.b); }
    else if (f.k === 'b') { burst(px2x(f.x), 1, px2z(f.y), 44, '#ffcf6a', 7, 9, .8); burst(px2x(f.x), .4, px2z(f.y), 20, '#b89468', 3, 1, .7); }
  }
  V.fx = V.fx.filter(f => (f.t += dt) < f.life);
  syncPickups(s.pk, now, dt); syncArrows(s.pj); stepArcs(dt); stepParticles(dt);
  renderer.render(scene, camera);
}
requestAnimationFrame(frame);
window.__r3ready = true;
