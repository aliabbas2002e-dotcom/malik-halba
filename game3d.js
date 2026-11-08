import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const canvas = document.getElementById('c');
const isTouch = matchMedia('(pointer:coarse)').matches;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, isTouch ? 1.25 : 1.75));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.12;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.localClippingEnabled = true;

const scene = new THREE.Scene();
scene.background = new THREE.Color('#0b0c1a');
scene.fog = new THREE.Fog('#2a1a30', 48, 150);
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(renderer), .04).texture;
const camera = new THREE.PerspectiveCamera(58, 1, .2, 320);

scene.add(new THREE.HemisphereLight('#8fa2e0', '#4a3526', .62));
const sun = new THREE.DirectionalLight('#ffc48a', 2.15);
sun.position.set(-12, 18, 9);
sun.castShadow = true;
sun.shadow.mapSize.set(isTouch ? 1024 : 2048, isTouch ? 1024 : 2048);
Object.assign(sun.shadow.camera, { left: -26, right: 26, top: 20, bottom: -20, near: 1, far: 80 });
sun.shadow.bias = -.0006;
sun.shadow.normalBias = .03;
scene.add(sun);

const px2x = x => (x - 680) / 40, px2z = y => (y - 440) / 40;
const damp = (v, t, r, dt) => v + (t - v) * Math.min(1, r * dt);
const TAU = Math.PI * 2;
const lerp = (a, b, k) => a + (b - a) * k;
const clampN = (v, a, b) => Math.max(a, Math.min(b, v));
function lerpA(a, b, k) { let d = b - a; while (d > Math.PI) d -= TAU; while (d < -Math.PI) d += TAU; return a + d * k; }

/* ---------- surface shading ---------- */
const NOISE = `
float h21(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}
float vn(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(h21(i),h21(i+vec2(1,0)),f.x),mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),f.x),f.y);}
float fbm(vec2 p){float a=.5,s=0.;for(int i=0;i<${isTouch ? 2 : 4};i++){s+=a*vn(p);p*=2.1;a*=.5;}return s;}`;
function detail(mat, scale, amount) {
  if (mat.userData.detail) return; mat.userData.detail = 1;
  mat.onBeforeCompile = s => {
    s.vertexShader = 'varying vec3 vWP;\n' + s.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      vec4 wp0=vec4(position,1.);
      #ifdef USE_INSTANCING
      wp0=instanceMatrix*wp0;
      #endif
      vWP=(modelMatrix*wp0).xyz;`);
    s.fragmentShader = 'varying vec3 vWP;\n' + NOISE + '\n' + s.fragmentShader
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec2 wuv=vWP.xz+vWP.y*.6;
        float dn=fbm(wuv*${scale.toFixed(2)});
        float dc=fbm(wuv*${(scale * 5).toFixed(2)});
        diffuseColor.rgb*=mix(${(1 - amount).toFixed(2)},${(1 + amount * .55).toFixed(2)},dn)*mix(.9,1.08,dc);`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor=clamp(roughnessFactor*mix(.82,1.12,dc),.05,1.);`);
  };
  mat.customProgramCacheKey = () => 'd' + scale + amount;
  mat.envMapIntensity = .12;
}
function rim(mat) {
  mat.onBeforeCompile = s => {
    s.fragmentShader = s.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      float rimF=pow(1.-saturate(dot(normal,normalize(vViewPosition))),2.6);
      totalEmissiveRadiance+=diffuseColor.rgb*rimF*1.1;`);
  };
  mat.customProgramCacheKey = () => 'rim';
}

/* ---------- assets ---------- */
const NAMES = ['arena', 'king', 'fighter', 'sword', 'spear', 'bow', 'hammer', 'potion'];
const MODEL = {};
const loader = new GLTFLoader();
loader.setDRACOLoader(new DRACOLoader().setDecoderPath('https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/libs/draco/gltf/'));
await Promise.all(NAMES.map(n => loader.loadAsync('assets/' + n + '.glb').then(g => { MODEL[n] = g.scene; })));
for (const n of NAMES) MODEL[n].traverse(o => { if (o.isMesh && o.material) o.material.envMapIntensity = o.material.metalness > .5 ? 1.15 : .14; });
const WMODEL = [null, 'sword', 'spear', 'bow', 'hammer'];
const GRIP = [0, 2.0, 2.77, 1.57, 1.6];
const HOLD = [-.45, -1, -1.2, -1.57, -1];

MODEL.arena.traverse(o => {
  if (!o.isMesh) return;
  o.receiveShadow = true; o.castShadow = !/^b_(sand|under|base)/.test(o.name);
  const n = o.material.name || '';
  if (n === 'stone0') o.material.color.set('#f0e4d4');
  else if (n === 'stone1') o.material.color.set('#c9bcae');
  else if (n === 'stone2') o.material.color.set('#a69a92');
  else if (n === 'capstone') o.material.color.set('#fff4e4');
  else if (/^base/.test(n)) detail(o.material, 2.2, .3);
});
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
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: GLOW, color, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: false }));
  s.scale.setScalar(size); return s;
}
const TORCH = [[-17.05, 10.8], [17.05, 10.8], [-17.05, -10.8], [17.05, -10.8], [-7.5, -10.85], [7.5, -10.85], [-7.5, 10.85], [7.5, 10.85]];
const torches = TORCH.map(([x, z]) => { const s = glow('#ff8a2a', 3.4); s.position.set(x, 3.6, z); scene.add(s); return s; });
const tLights = (isTouch ? [TORCH[4], TORCH[7]] : [TORCH[0], TORCH[1], TORCH[4], TORCH[5], TORCH[6], TORCH[7]]).map(([x, z]) => {
  const l = new THREE.PointLight('#ff9140', 44, 19, 1.7); l.position.set(x * .97, 3.3, z * .96); scene.add(l); return l;
});

/* ---------- world around the arena ---------- */
const crowdU = { value: 0 }, cheer = { v: 0 };
await (async function world() {
  const sky = new THREE.Mesh(new THREE.SphereGeometry(190, 32, 18), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    vertexShader: 'varying vec3 p;void main(){p=normalize(position);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
    fragmentShader: 'varying vec3 p;void main(){float h=clamp(p.y,0.,1.);vec3 c=mix(vec3(.62,.24,.2),vec3(.2,.11,.27),smoothstep(0.,.16,h));c=mix(c,vec3(.03,.04,.13),smoothstep(.1,.55,h));gl_FragColor=vec4(c,1.);}'
  }));
  scene.add(sky);
  const sp = [], N = isTouch ? 260 : 620;
  for (let i = 0; i < N; i++) { const a = Math.random() * TAU, y = .18 + Math.random() * .82, r = Math.sqrt(1 - y * y); sp.push(Math.cos(a) * r * 180, y * 180, Math.sin(a) * r * 180); }
  const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
  scene.add(new THREE.Points(sg, new THREE.PointsMaterial({ color: '#dfe6ff', size: 1.1, sizeAttenuation: true, map: GLOW, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false })));
  const moon = glow('#ffd9b0', 20); moon.position.set(-60, 62, -130); scene.add(moon);
  const disc = new THREE.Mesh(new THREE.CircleGeometry(7.5, 40), new THREE.MeshBasicMaterial({ color: '#ffe8cf', fog: false }));
  disc.position.copy(moon.position); disc.lookAt(0, 0, 0); scene.add(disc);

  const ground = new THREE.Mesh(new THREE.CircleGeometry(190, 48), new THREE.MeshStandardMaterial({ color: '#2c2230', roughness: 1 }));
  ground.rotation.x = -Math.PI / 2; ground.position.y = -.7; scene.add(ground);
  const mt = new THREE.MeshStandardMaterial({ color: '#1c1830', roughness: 1, flatShading: true });
  const mg = new THREE.ConeGeometry(1, 1, 5);
  const mountains = new THREE.InstancedMesh(mg, mt, 46), mm = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
  for (let i = 0; i < 46; i++) {
    const a = i / 46 * TAU + Math.random() * .1, r = 88 + Math.random() * 42, h = 16 + Math.random() * 30, w = 14 + Math.random() * 18;
    e.set(0, Math.random() * 3, 0); q.setFromEuler(e); mm.compose(new THREE.Vector3(Math.cos(a) * r, h / 2 - 1, Math.sin(a) * r), q, new THREE.Vector3(w, h, w)); mountains.setMatrixAt(i, mm);
  }
  scene.add(mountains);

  const seats = await (await fetch('assets/seats.json')).json();
  const pts = isTouch ? seats.filter((_, i) => i % 3 === 0) : seats;
  const bodyG = new THREE.CapsuleGeometry(.23, .34, 3, 8), headG = new THREE.SphereGeometry(.19, 10, 8);
  const pal = ['#8b7cf6', '#2fc79c', '#f0784a', '#d8c6a4', '#7c6a58', '#b34a4a', '#4e6f9c', '#e0b050'].map(c => new THREE.Color(c));
  const skin = ['#e8b48c', '#c98f64', '#a06f4c'].map(c => new THREE.Color(c));
  const mk = col => {
    const m = new THREE.MeshStandardMaterial({ color: col, roughness: .9 });
    m.onBeforeCompile = s => {
      s.uniforms.uT = crowdU;
      s.vertexShader = 'uniform float uT;\n' + s.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
        #ifdef USE_INSTANCING
        float ph=instanceMatrix[3].x*3.1+instanceMatrix[3].z*1.7;
        transformed.y+=abs(sin(uT*(2.+fract(ph)*2.)+ph))*.17;
        #endif`);
    };
    return m;
  };
  const body = new THREE.InstancedMesh(bodyG, mk('#ffffff'), pts.length), head = new THREE.InstancedMesh(headG, mk('#ffffff'), pts.length);
  pts.forEach((p, i) => {
    mm.makeTranslation(p[0], p[1] + .42, p[2]); body.setMatrixAt(i, mm); body.setColorAt(i, pal[i * 7 % pal.length]);
    mm.makeTranslation(p[0], p[1] + .96, p[2]); head.setMatrixAt(i, mm); head.setColorAt(i, skin[i % 3]);
  });
  scene.add(body, head);
})();

/* ---------- zone ---------- */
const clip = [new THREE.Plane(new THREE.Vector3(1, 0, 0), 17), new THREE.Plane(new THREE.Vector3(-1, 0, 0), 17),
  new THREE.Plane(new THREE.Vector3(0, 0, 1), 11), new THREE.Plane(new THREE.Vector3(0, 0, -1), 11)];
const zoneGround = new THREE.Mesh(new THREE.RingGeometry(1, 40, 96),
  new THREE.MeshBasicMaterial({ color: '#ff2d2d', transparent: true, opacity: .3, depthWrite: false, clippingPlanes: clip, fog: false }));
zoneGround.rotation.x = -Math.PI / 2; zoneGround.position.set(0, .3, -.7); scene.add(zoneGround);
const zoneTex = (() => {
  const c = document.createElement('canvas'); c.width = 512; c.height = 128; const g = c.getContext('2d');
  const v = g.createLinearGradient(0, 0, 0, 128); v.addColorStop(0, '#000'); v.addColorStop(.55, '#777'); v.addColorStop(1, '#fff');
  g.fillStyle = v; g.fillRect(0, 0, 512, 128); g.globalCompositeOperation = 'multiply';
  for (let x = 0; x < 512; x += 4) { const k = 120 + Math.random() * 135 | 0; g.fillStyle = `rgb(${k},${k},${k})`; g.fillRect(x, 0, 4, 128); }
  const t = new THREE.CanvasTexture(c); t.wrapS = THREE.RepeatWrapping; t.repeat.x = 5; return t;
})();
const zoneWall = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 6, 96, 1, true),
  new THREE.MeshBasicMaterial({ color: '#ff4a3a', alphaMap: zoneTex, transparent: true, opacity: .8, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending, clippingPlanes: clip, fog: false }));
zoneWall.position.set(0, 3.1, -.5); scene.add(zoneWall);

/* ---------- particles ---------- */
const PN = isTouch ? 320 : 700, ppos = new Float32Array(PN * 3), pcol = new Float32Array(PN * 3), P = [];
for (let i = 0; i < PN; i++) { P.push({ l: 0, m: 1, vx: 0, vy: 0, vz: 0, g: 0, r: 1, gc: 1, b: 1 }); ppos[i * 3 + 1] = -50; }
const pgeo = new THREE.BufferGeometry();
pgeo.setAttribute('position', new THREE.BufferAttribute(ppos, 3));
pgeo.setAttribute('color', new THREE.BufferAttribute(pcol, 3));
const points = new THREE.Points(pgeo, new THREE.PointsMaterial({ size: .2, map: GLOW, vertexColors: true, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: false }));
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
function ambientFx(now, dt) {
  crowdU.value += dt * (1 + cheer.v * 2.4); cheer.v = Math.max(0, cheer.v - dt * .45);
  torches.forEach((t, i) => {
    t.scale.setScalar(3.1 + Math.sin(now / 90 + i * 2) * .3 + Math.sin(now / 37 + i) * .15);
    if (Math.random() < (isTouch ? .12 : .3)) { const p = t.position; burst(p.x, 3.5, p.z, 1, '#ff9a3a', .5, -1.8, 1.3); }
  });
  tLights.forEach((l, i) => { l.intensity = 30 + Math.sin(now / 80 + i * 1.7) * 5 + Math.sin(now / 33 + i) * 3; });
  if (Math.random() < .25) burst((Math.random() - .5) * 32, .5 + Math.random() * 3, (Math.random() - .5) * 20, 1, '#b89468', .12, -.05, 2.4);
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
    if (o.isMesh && o.material.name === 'team') {
      if (!tm.m) { tm.m = o.material.clone(); tm.m.color.copy(col); tm.m.emissive = new THREE.Color('#000'); rim(tm.m); }
      o.material = tm.m;
    }
  });
  shadowed(body);
  body.scale.setScalar(role === 0 ? 1.28 : 1.2);
  root.add(body);
  const mine = p.id === pid;
  const ring = new THREE.Mesh(new THREE.RingGeometry(.66, .84, 40), new THREE.MeshBasicMaterial({ color: mine ? '#ffffff' : col, transparent: true, opacity: mine ? .9 : .75, depthWrite: false, fog: false }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = .06; root.add(ring);
  const beacon = role === 0 && !mine ? glow(col, 2.6) : null;
  if (beacon) { beacon.position.y = 3.5; root.add(beacon); }
  const shield = new THREE.Group();
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(.62, .62, .08, 28), new THREE.MeshStandardMaterial({ color: col, metalness: .35, roughness: .35 }));
  const rimM = new THREE.Mesh(new THREE.TorusGeometry(.62, .06, 8, 32), new THREE.MeshStandardMaterial({ color: '#f2b632', metalness: 1, roughness: .28 }));
  disc.rotation.x = Math.PI / 2; shield.add(disc, rimM); shield.position.set(0, 1.5, 1); shield.visible = false; shadowed(shield); root.add(shield);
  scene.add(root);
  const label = document.createElement('div'); label.className = 'lb';
  const nm = document.createElement('b'); nm.textContent = (role === 0 ? '♛ ' : '') + p.n; nm.style.color = TC[p.t];
  const bar = document.createElement('i'); const fill = document.createElement('u'); bar.append(fill); label.append(nm, bar); labels.append(label);
  return {
    key: p.id + role + p.t, root, body, shield, label, fill, ph: 0, mv: 0, x: 0, y: 0, dead: 0, w: -1, ring, tm: tm.m, flash: 0, mine,
    legL: body.getObjectByName('leg_L'), legR: body.getObjectByName('leg_R'), armL: body.getObjectByName('arm_L'), armR: body.getObjectByName('arm_R'),
    torso: body.getObjectByName('torso'), head: body.getObjectByName('head'), socket: body.getObjectByName('hand_socket'), wm: null
  };
}
function actor(i, p, role) {
  let a = ACT[i]; const key = p.id + role + p.t;
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
  a.label.style.display = alive && !a.mine ? '' : 'none';
  a.flash = Math.max(0, a.flash - dt * 5.5);
  if (a.tm) a.tm.emissive.setRGB(a.flash * 2.2, a.flash * 2.2, a.flash * 2.2);
  if (!alive) {
    a.dead += dt; a.ring.visible = false;
    a.body.rotation.x = Math.min(Math.PI / 2, a.dead * 7);
    a.root.visible = a.dead < 1.2;
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
  a.body.position.z = 0;
  if (i === idx && charging) { const c = Math.min(1, (performance.now() - pressAt) / 450); th = lerp(th, -2.75, c); yaw = -.5 * c; }
  if (swing) {
    const k = Math.min(1, swing.t / swing.life);
    if (e.w === 2) { const s = Math.sin(k * Math.PI); th = HOLD[2]; a.body.position.z = s * .15; if (a.wm) a.wm.translateY(s * 1.3); }
    else if (e.w === 3) th = HOLD[3] + Math.sin(k * Math.PI) * .25;
    else { th = lerp(-2.7, -.15, Math.pow(k, .55)); yaw = lerp(.75, -.85, k); }
  }
  a.armR.rotation.x = th + Math.sin(now / 500 + i) * .03;
  a.torso.rotation.y = damp(a.torso.rotation.y, yaw, 26, dt);
  if (a.head) a.head.rotation.z = e.f & 8 ? Math.sin(now / 45) * .35 : 0;
  a.root.rotation.z = e.f & 8 ? Math.sin(now / 60) * .06 : 0;
  if (e.f & 4 && Math.random() < .7) burst(a.root.position.x, .3, a.root.position.z, 1, '#c9a06a', 1.6, 2, .45);
  else if (a.mv > .7 && Math.random() < .06) burst(a.root.position.x, .2, a.root.position.z, 1, '#a88858', .7, .5, .4);
  if (a.mine) return;
  const max = STAT[e.r].hp, pct = clampN(e.hp / max * 100, 0, 100);
  a.fill.style.width = pct + '%'; a.fill.style.background = pct > 35 ? '#6fe08a' : '#ff5a5a';
  tv.set(a.root.position.x, e.r === 0 ? 3.85 : 3.3, a.root.position.z).project(camera);
  if (tv.z > 1 || Math.abs(tv.x) > 1.1) { a.label.style.display = 'none'; return; }
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

/* ---------- swing arcs & shockwaves ---------- */
const arcs = [];
function spawnArc(f, a) {
  const w = WP[f.w]; if (w.bow) return;
  const r = (w.r + 8) / 40, half = (w.arc || 1) / 2;
  const geo = new THREE.RingGeometry(r * .45, r, 24, 1, -half, half * 2);
  const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: f.h ? '#ff9c4a' : f.w === 4 ? '#ffc84a' : '#ffffff', transparent: true, opacity: .55, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
  m.rotation.set(Math.PI / 2, 0, f.a);
  m.position.set(a.root.position.x, 1.3, a.root.position.z); scene.add(m); arcs.push({ m, t: 0, life: f.life + .06, o: .55 });
}
function shock(x, z, col, life, size) {
  const m = new THREE.Mesh(new THREE.RingGeometry(.86, 1, 48), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: .8, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
  m.rotation.x = -Math.PI / 2; m.position.set(x, .35, z); scene.add(m); arcs.push({ m, t: 0, life, o: .8, grow: size });
}
function stepArcs(dt) {
  for (let i = arcs.length - 1; i >= 0; i--) {
    const a = arcs[i]; a.t += dt; const k = a.t / a.life; a.m.material.opacity = a.o * (1 - k);
    if (a.grow) a.m.scale.setScalar(.4 + a.grow * Math.sqrt(k));
    if (a.t >= a.life) { scene.remove(a.m); a.m.geometry.dispose(); a.m.material.dispose(); arcs.splice(i, 1); }
  }
}
function floatText(x, y, txt, big) {
  tv.set(px2x(x), 2.9, px2z(y)).project(camera); if (tv.z > 1) return;
  const d = document.createElement('div'); d.className = 'dmg' + (big ? ' big' : ''); d.textContent = txt;
  d.style.left = (tv.x + 1) / 2 * innerWidth + 'px'; d.style.top = (1 - tv.y) / 2 * innerHeight + 'px';
  labels.append(d); setTimeout(() => d.remove(), 720);
}

/* ---------- menu showcase ---------- */
const SHOW = [[0, 0, -2.3, 1.2, 4], [1, 0, 2.3, 1.2, 1], [2, 0, 0, 2.2, 2], [0, 1, -4.1, 2.3, 1], [1, 1, 4.1, 2.3, 2]].map(([t, r, x, z, w], i) => {
  const a = buildActor(-1 - i, { id: 'show' + i, n: '', t }, r);
  a.label.remove(); a.ring.visible = false; a.root.position.set(x, .3, z - .8); setWeapon(a, w); return a;
});
function showcase(v, now) {
  SHOW.forEach((a, i) => {
    a.root.visible = v; if (!v) return;
    a.body.position.y = Math.sin(now / 480 + i) * .025;
    a.armR.rotation.x = -1 + Math.sin(now / 620 + i * 2) * .1;
    a.torso.rotation.y = Math.sin(now / 900 + i) * .12;
  });
}

/* ---------- HUD ---------- */
const hud = document.getElementById('hud'), meCard = document.getElementById('me'), xh = document.getElementById('xh'), gameEl = document.getElementById('game');
const HR = { key: '', pips: {}, crowns: {} };
function ensureHud() {
  const key = A.players.map(p => p.id + p.t + p.r).join();
  if (HR.key === key) return; HR.key = key; HR.pips = {}; HR.crowns = {}; hud.textContent = '';
  const clock = document.createElement('div'); clock.className = 'clock';
  HR.round = document.createElement('small'); HR.time = document.createElement('b'); clock.append(HR.round, HR.time);
  const teams = [...new Set(A.players.map(p => p.t))].sort();
  const plate = t => {
    const d = document.createElement('div'); d.className = 'tp'; d.style.setProperty('--tc', TC[t]);
    const top = document.createElement('div'); top.className = 'tpt';
    const n = document.createElement('b'); n.textContent = TN[t];
    const c = document.createElement('span'); c.className = 'crs'; HR.crowns[t] = [0, 1, 2].map(() => { const s = document.createElement('i'); s.textContent = '♛'; c.append(s); return s; });
    top.append(n, c); d.append(top);
    A.players.map((p, i) => [p, i]).filter(([p]) => p.t === t).sort((x, y) => x[0].r - y[0].r).forEach(([p, i]) => {
      const r = document.createElement('div'); r.className = 'pip' + (p.r === 0 ? ' k' : '');
      const l = document.createElement('em'); l.textContent = p.n; const b = document.createElement('i'); const u = document.createElement('u'); b.append(u); r.append(l, b); d.append(r); HR.pips[i] = { r, u };
    });
    return d;
  };
  const mid = Math.ceil(teams.length / 2);
  teams.slice(0, mid).forEach(t => hud.append(plate(t))); hud.append(clock); teams.slice(mid).forEach(t => hud.append(plate(t)));
}
function txt(el, v) { if (el.textContent !== v) el.textContent = v; }
function updateHud(s, ents, idx) {
  ensureHud();
  txt(HR.round, 'الجولة ' + s.rn);
  txt(HR.time, s.ph === 'fight' ? (s.tm >= 25 && s.z > 110 ? 'الحلقة تصغر' : String(Math.floor(s.tm / 60)).padStart(2, '0') + ':' + String(s.tm % 60).padStart(2, '0')) : '—');
  for (const t in HR.crowns) HR.crowns[t].forEach((c, i) => c.classList.toggle('on', i < s.cr[t]));
  ents.forEach((e, i) => {
    const p = HR.pips[i]; if (!p) return;
    p.u.style.width = clampN(e.hp / STAT[e.r].hp * 100, 0, 100) + '%'; p.r.classList.toggle('dead', !(e.f & 1));
  });
  const me = idx >= 0 ? ents[idx] : null, alive = me && me.f & 1;
  meCard.style.display = me ? '' : 'none';
  xh.style.display = alive && s.ph === 'fight' ? '' : 'none';
  if (me) {
    const max = STAT[me.r].hp, pct = clampN(me.hp / max * 100, 0, 100);
    txt(document.getElementById('mRole'), (me.r === 0 ? '♛ ' : '') + RN[me.r]);
    txt(document.getElementById('mWp'), WP[me.w].n);
    txt(document.getElementById('mHp'), String(Math.max(0, me.hp)));
    const f = document.getElementById('mFill'); f.style.width = pct + '%'; f.style.background = pct > 35 ? 'linear-gradient(90deg,#3dbb68,#8ef0a6)' : 'linear-gradient(90deg,#c9333a,#ff7a6a)';
    document.getElementById('mDash').style.width = (1 - V.dashCd / 1.3) * 100 + '%';
    gameEl.classList.toggle('low', !!alive && pct < 30);
    const out = !!alive && s.ph === 'fight' && Math.hypot(me.x - CX, me.y - CY) > s.z;
    gameEl.classList.toggle('out', out);
    const dn = document.getElementById('dead');
    txt(dn, !alive && s.ph === 'fight' ? (me.rr > 0 ? 'ترجع بعد ' + me.rr : 'فريقك طلع من الجولة · تتفرج') : '');
  }
  const lock = document.getElementById('lock');
  lock.style.display = !isTouch && s.ph !== 'over' && document.pointerLockElement !== canvas ? '' : 'none';
}

/* ---------- third-person look ---------- */
const look = { pitch: .16 };
const camPos = new THREE.Vector3(0, 17, 15), camLook = new THREE.Vector3(0, 0, 0), wantPos = new THREE.Vector3(), wantLook = new THREE.Vector3();
document.addEventListener('mousemove', e => {
  if (document.pointerLockElement !== canvas) return;
  inp.a += e.movementX * .0028; look.pitch = clampN(look.pitch + e.movementY * .0017, -.1, .5);
});
const lookT = { id: null, x: 0, y: 0 };
canvas.addEventListener('touchstart', e => { if (lookT.id !== null) return; const t = e.changedTouches[0]; lookT.id = t.identifier; lookT.x = t.clientX; lookT.y = t.clientY; e.preventDefault(); }, { passive: false });
canvas.addEventListener('touchmove', e => {
  for (const t of e.changedTouches) if (t.identifier === lookT.id) {
    inp.a += (t.clientX - lookT.x) * .0075; look.pitch = clampN(look.pitch + (t.clientY - lookT.y) * .004, -.1, .5); lookT.x = t.clientX; lookT.y = t.clientY;
  }
  e.preventDefault();
}, { passive: false });
const lookEnd = e => { for (const t of e.changedTouches) if (t.identifier === lookT.id) lookT.id = null; };
canvas.addEventListener('touchend', lookEnd); canvas.addEventListener('touchcancel', lookEnd);

let lastEnts = null;
function assist() {
  if (!isTouch || !lastEnts || !V.cur) return;
  const idx = myIdx(), me = lastEnts[idx]; if (!me || !(me.f & 1)) return;
  let best = null, bd = 240;
  lastEnts.forEach((e, i) => {
    if (i === idx || !(e.f & 1) || !A.players[i] || A.players[i].t === A.players[idx].t) return;
    const d = Math.hypot(e.x - me.x, e.y - me.y), an = Math.abs(lerpA(0, Math.atan2(e.y - me.y, e.x - me.x) - inp.a, 1));
    if (d < bd && an < .8) { bd = d; best = e; }
  });
  if (best) inp.a = Math.atan2(best.y - me.y, best.x - me.x);
}

/* ---------- output ---------- */
let composer = null;
if (!isTouch) {
  composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: 4 }));
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(new UnrealBloomPass(new THREE.Vector2(innerWidth / 2, innerHeight / 2), .42, .55, 1.05));
  composer.addPass(new OutputPass());
}
function fit() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false); if (composer) { composer.setPixelRatio(renderer.getPixelRatio()); composer.setSize(w, h); }
  camera.aspect = w / h; camera.updateProjectionMatrix();
}
let shX = 0, shY = 0;
const tv = new THREE.Vector3();
addEventListener('resize', fit); fit();
window.R3 = { resize: fit, assist };
const draw = () => composer ? composer.render() : renderer.render(scene, camera);

let last = performance.now(), wasMenu = true;
function menuFrame(now, dt) {
  if (!wasMenu) {
    wasMenu = true; for (const i in ACT) disposeActor(i); syncPickups([], now, dt); syncArrows([]);
    zoneGround.visible = zoneWall.visible = false;
  }
  showcase(true, now);
  const wide = innerWidth > 860, t = now / 9000, r = 7, cx = wide ? 2.2 : 0;
  camera.position.set(Math.sin(t) * 1.6 + cx * .4, 2.6 + Math.sin(t * .7) * .2, r);
  camera.lookAt(cx, 2.1, -.8);
  ambientFx(now, dt); stepParticles(dt); draw();
}
zoneGround.visible = zoneWall.visible = false;

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(.05, (now - last) / 1000); last = now;
  if (!gameEl.classList.contains('on') || !V.cur) { menuFrame(now, dt); return; }
  if (wasMenu) { wasMenu = false; showcase(false, now); camPos.set(0, 17, 15); camLook.set(0, 0, 0); HR.key = ''; }
  const s = V.cur, p = V.prev, k = A.host ? 1 : Math.max(0, Math.min(1, (now - V.at) / 125)), idx = myIdx();
  if (idx >= 0 && s.e[idx] && s.ph === 'ready') inp.a = s.e[idx][2] / 100;
  readKeys();
  const ents = s.e.map((e, i) => { const o = (p.e && p.e[i]) || e; return { x: lerp(o[0], e[0], k), y: lerp(o[1], e[1], k), a: lerpA(o[2] / 100, e[2] / 100, k), hp: e[3], f: e[4], w: e[5], rr: e[6], r: e[7] }; });
  lastEnts = ents;

  const me = idx >= 0 ? ents[idx] : null, alive = me && me.f & 1;
  if (alive) {
    const sv = s.e[idx];
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
    me.a = inp.a;
  }
  pushInput(false);

  V.shake = Math.max(0, V.shake - dt);
  const am = V.shake > 0 ? V.shake / .3 : 0, j1 = (Math.random() - .5) * .34 * am, j2 = (Math.random() - .5) * .34 * am;
  shX = j1 * 30; shY = j2 * 30;

  if (alive) {
    const a = inp.a, c = Math.cos(a), sn = Math.sin(a), mx = px2x(me.x), mz = px2z(me.y), rx = -sn, rz = c, D = 8.2, H = 4.5 + look.pitch * 5.2, SH = 1.55;
    wantPos.set(clampN(mx - c * D + rx * SH, -16.5, 16.5), H, clampN(mz - sn * D + rz * SH, -10.55, 10.55));
    wantLook.set(mx + c * 11 + rx * SH, 2.3 - look.pitch * 11, mz + sn * 11 + rz * SH);
    camPos.lerp(wantPos, Math.min(1, dt * 16)); camLook.lerp(wantLook, Math.min(1, dt * 26));
  } else {
    wantPos.set(0, 15.5, 13.5); wantLook.set(0, 0, -.5);
    camPos.lerp(wantPos, Math.min(1, dt * 2.2)); camLook.lerp(wantLook, Math.min(1, dt * 3));
  }
  camera.position.copy(camPos); camera.position.x += j1; camera.position.y += j2;
  camera.lookAt(camLook);
  camera.updateMatrixWorld();

  const z = s.z / 40, show = z < 22;
  zoneGround.visible = zoneWall.visible = show;
  if (show) { zoneGround.scale.set(z, z, 1); zoneWall.scale.set(z, 1, z); zoneTex.offset.x = now / 6000; zoneWall.material.opacity = .62 + Math.sin(now / 240) * .14; }
  ambientFx(now, dt);

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
    else if (f.k === 'h') {
      const x = px2x(f.x), z2 = px2z(f.y);
      burst(x, 1.5, z2, f.b ? 34 : 14, f.b ? '#ff8a3a' : '#ffe08a', f.b ? 6.5 : 4, 11, .55); floatText(f.x, f.y, f.txt, f.b);
      for (const i in ACT) { const a = ACT[i]; if (Math.hypot(a.root.position.x - x, a.root.position.z - z2) < 1.1) a.flash = 1; }
      if (f.b) shock(x, z2, '#ffb060', .4, 4);
    } else if (f.k === 'b') {
      const x = px2x(f.x), z2 = px2z(f.y);
      burst(x, 1.2, z2, 60, '#ffcf6a', 7.5, 9, .9); burst(x, .4, z2, 24, '#b89468', 3, 1, .7); shock(x, z2, '#ffd98a', .6, 7); cheer.v = 1;
    }
  }
  V.fx = V.fx.filter(f => (f.t += dt) < f.life);
  syncPickups(s.pk, now, dt); syncArrows(s.pj); stepArcs(dt); stepParticles(dt);
  updateHud(s, ents, idx);
  draw();
}
requestAnimationFrame(frame);
window.__r3ready = true;
