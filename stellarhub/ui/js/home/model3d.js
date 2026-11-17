/* StellarHub · "3D model" Home view: a real 3D laptop (three.js, bundled) that you rotate by dragging.
   Hovering a component in the list moves the camera to it, makes the shell translucent and lights up the part. */
'use strict';
(() => {
const { $, $$, Spring, EASE, anim, tickers, ic, state, esc } = SH;
let THREE = null, threeP = null;
const loadThree = () => (threeP ||= import(new URL('vendor/three.module.min.js', document.baseURI).href).then(m => (THREE = m)));
function webglOK() { try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch { return false; } }
const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim() || '#ffffff';

/* measurements (scene units) */
const BW = 3.6, BD = 2.5, BH = 0.13, LT = 0.07, OPEN = -1.92;
/* where each component is and where to look at it from */
const SPOTS = {
  cpu: { pos: [-0.35, 0.055, -0.62], size: [0.42, 0.035, 0.42], az: 0.2, el: 1.0, dist: 8.4, inside: true },
  gpu: { pos: [0.45, 0.055, -0.6], size: [0.5, 0.035, 0.42], az: -0.15, el: 1.0, dist: 8.4, inside: true },
  ram: { pos: [-0.3, 0.045, 0.05], size: [0.9, 0.025, 0.22], az: 0.15, el: 1.08, dist: 8.4, inside: true },
  ssd: { pos: [0.78, 0.04, 0.12], size: [0.7, 0.02, 0.18], az: -0.25, el: 1.08, dist: 8.4, inside: true },
  wifi: { pos: [1.25, 0.04, -0.25], size: [0.28, 0.02, 0.22], az: -0.45, el: 1.0, dist: 8.4, inside: true },
  battery: { pos: [0, 0.05, 0.74], size: [2.6, 0.06, 0.7], az: 0.05, el: 1.12, dist: 8.8, inside: true },
  audio: { pos: [1.58, 0.135, -0.52], size: [0.16, 0.01, 0.9], az: 0.55, el: 0.72, dist: 8.2, inside: false, mirror: true },
  display: { screen: true, az: 0.05, el: 0.2, dist: 8.4 },
  sys: { screen: true, az: -0.3, el: 0.24, dist: 8.4 },
};
const POSE = { az: 0.58, el: 0.36, dist: 10.4, target: [0, 0.55, -0.2] };

/* ---------- view state ---------- */
let root = null, mounted = false, token = 0, ctxRef = null, timers = [], unsubLook = null, ro = null;
let R = null; // everything three.js lives here so it can be released
const S = {
  az: new Spring(POSE.az, 60, 13), el: new Spring(POSE.el, 60, 13), dist: new Spring(POSE.dist, 50, 12),
  tx: new Spring(POSE.target[0], 60, 13), ty: new Spring(POSE.target[1], 60, 13), tz: new Spring(POSE.target[2], 60, 13),
  offAz: new Spring(0, 26, 7), offEl: new Spring(0, 26, 7), lid: new Spring(0, 34, 7.5), shell: new Spring(1, 90, 16),
  screen: new Spring(0, 40, 12), zoom: new Spring(1, 70, 14),
};
let focused = null, leaveT = 0, dragging = false, lastX = 0, lastY = 0, lastT = 0, idleT = 0, vAz = 0, vEl = 0;
const halo = {}; // id -> {mat, spring}

/* ---------- hand-made canvas textures ---------- */
function screenCanvas() {
  const c = document.createElement('canvas'); c.width = 1024; c.height = 640; const g = c.getContext('2d');
  const a = css('--accent'), b = css('--accent2');
  const bg = g.createLinearGradient(0, 0, 1024, 640); bg.addColorStop(0, '#08122a'); bg.addColorStop(.6, '#0f1d3a'); bg.addColorStop(1, '#1b1630'); g.fillStyle = bg; g.fillRect(0, 0, 1024, 640);
  const glow = g.createRadialGradient(780, 560, 10, 780, 560, 520); glow.addColorStop(0, a + '55'); glow.addColorStop(1, a + '00'); g.fillStyle = glow; g.fillRect(0, 0, 1024, 640);
  let s = 7; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 180; i++) { g.globalAlpha = .25 + rnd() * .7; g.fillStyle = '#dbeaff'; g.beginPath(); g.arc(rnd() * 1024, rnd() * 600, rnd() * 1.6 + .3, 0, 6.283); g.fill(); }
  g.globalAlpha = 1; g.save(); g.translate(512, 290); g.rotate(-.16);
  g.strokeStyle = b; g.globalAlpha = .55; g.lineWidth = 3; g.beginPath(); g.ellipse(0, 0, 250, 82, 0, 0, 6.283); g.stroke();
  g.strokeStyle = a; g.globalAlpha = .45; g.lineWidth = 2; g.beginPath(); g.ellipse(0, 0, 160, 52, 0, 0, 6.283); g.stroke(); g.restore();
  g.globalAlpha = 1; const pl = g.createRadialGradient(498, 278, 4, 512, 290, 46); pl.addColorStop(0, '#ffffff'); pl.addColorStop(.25, a); pl.addColorStop(1, a + '00');
  g.fillStyle = pl; g.beginPath(); g.arc(512, 290, 46, 0, 6.283); g.fill();
  g.fillStyle = b; g.beginPath(); g.arc(730, 250, 9, 0, 6.283); g.fill();
  g.fillStyle = 'rgba(10,16,30,.92)'; g.fillRect(0, 600, 1024, 40);
  for (let i = 0; i < 6; i++) { g.fillStyle = i === 0 ? b : 'rgba(150,180,230,.5)'; g.fillRect(420 + i * 32, 610, 20, 20); }
  return c;
}
function envCanvas() {
  const c = document.createElement('canvas'); c.width = 512; c.height = 256; const g = c.getContext('2d');
  g.fillStyle = '#070b16'; g.fillRect(0, 0, 512, 256);
  const box = (x, y, w, h, col, al) => { const gr = g.createRadialGradient(x, y, 2, x, y, Math.max(w, h)); gr.addColorStop(0, col); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.globalAlpha = al; g.fillStyle = gr; g.fillRect(x - w, y - h, w * 2, h * 2); };
  box(256, 40, 120, 40, '#ffffff', .9); box(120, 110, 70, 60, css('--accent'), .32); box(400, 110, 70, 60, css('--accent2'), .38); box(256, 230, 200, 30, '#1a2440', 1);
  g.globalAlpha = 1; return c;
}
function shadowCanvas() {
  const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d');
  const gr = g.createRadialGradient(128, 128, 10, 128, 128, 128); gr.addColorStop(0, 'rgba(0,0,0,.75)'); gr.addColorStop(.55, 'rgba(0,0,0,.35)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 256, 256); return c;
}

/* ---------- scene construction ---------- */
function roundedSlab(w, d, h, r, bevel) {
  const s = new THREE.Shape(), x = -w / 2, y = -d / 2;
  s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r); s.lineTo(x + w, y + d - r);
  s.quadraticCurveTo(x + w, y + d, x + w - r, y + d); s.lineTo(x + r, y + d); s.quadraticCurveTo(x, y + d, x, y + d - r); s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
  const g = new THREE.ExtrudeGeometry(s, { depth: Math.max(.001, h - 2 * bevel), bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 3, curveSegments: 10 });
  g.rotateX(-Math.PI / 2); g.translate(0, bevel, 0); return g;
}
function build(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(2, devicePixelRatio || 1)); renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.15;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, .1, 100);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const R0 = { renderer, scene, camera, pmrem, tex: [] };

  const accent = new THREE.Color(css('--accent')), accent2 = new THREE.Color(css('--accent2'));
  const mat = {
    shell: new THREE.MeshStandardMaterial({ color: 0x2c3448, metalness: .62, roughness: .42, transparent: true, envMapIntensity: .55 }),
    under: new THREE.MeshStandardMaterial({ color: 0x161c2a, metalness: .6, roughness: .55 }),
    lid: new THREE.MeshStandardMaterial({ color: 0x2a3245, metalness: .7, roughness: .36, envMapIntensity: .6 }),
    keys: new THREE.MeshStandardMaterial({ color: 0x111725, metalness: .25, roughness: .55, transparent: true }),
    tray: new THREE.MeshStandardMaterial({ color: 0x0a0e18, metalness: .3, roughness: .7, transparent: true }),
    bezel: new THREE.MeshStandardMaterial({ color: 0x04060b, metalness: .2, roughness: .22 }),
    pad: new THREE.MeshStandardMaterial({ color: 0x232b3d, metalness: .55, roughness: .28, transparent: true }),
    pcb: new THREE.MeshStandardMaterial({ color: 0x0f1c33, metalness: .3, roughness: .65 }),
    chip: new THREE.MeshStandardMaterial({ color: 0x232c42, metalness: .55, roughness: .32 }),
    copper: new THREE.MeshStandardMaterial({ color: 0xb8764f, metalness: 1, roughness: .33 }),
    battery: new THREE.MeshStandardMaterial({ color: 0x1b2537, metalness: .4, roughness: .5 }),
    fan: new THREE.MeshStandardMaterial({ color: 0x252e42, metalness: .4, roughness: .45 }),
    port: new THREE.MeshStandardMaterial({ color: 0x05070c, metalness: .2, roughness: .6 }),
    grille: new THREE.MeshStandardMaterial({ color: 0x0b0f1a, metalness: .3, roughness: .6, transparent: true }),
    glow: new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: .32, blending: THREE.AdditiveBlending, depthWrite: false }),
  };
  R0.mat = mat;
  const screenTex = new THREE.CanvasTexture(screenCanvas()); screenTex.colorSpace = THREE.SRGBColorSpace; screenTex.anisotropy = 4; R0.tex.push(screenTex);
  mat.screen = new THREE.MeshBasicMaterial({ map: screenTex, toneMapped: false, color: 0x000000 });
  R0.screenTex = screenTex;

  // environment for the metallic reflections
  setEnv(R0);

  // lights: key, two rim lights in the accent colors and a soft fill
  const key = new THREE.DirectionalLight(0xffffff, 2.1); key.position.set(4, 6.5, 5); scene.add(key);
  const rimA = new THREE.DirectionalLight(accent, 1.3); rimA.position.set(-5, 1.1, -4.5); scene.add(rimA);
  const rimB = new THREE.DirectionalLight(accent2, 1.2); rimB.position.set(5.5, 1.0, -5); scene.add(rimB);
  const hemi = new THREE.HemisphereLight(0x9ed6ff, 0x05070c, .35); scene.add(hemi);
  R0.lights = { rimA, rimB };

  const laptop = new THREE.Group(); scene.add(laptop); R0.laptop = laptop;

  // contact shadow
  const shTex = new THREE.CanvasTexture(shadowCanvas()); R0.tex.push(shTex);
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(6.4, 4.6), new THREE.MeshBasicMaterial({ map: shTex, transparent: true, depthWrite: false, opacity: .9 }));
  shadow.rotation.x = -Math.PI / 2; shadow.position.y = -.004; laptop.add(shadow);

  // base: opaque bottom + top shell that can turn translucent
  const under = new THREE.Mesh(roundedSlab(BW - .04, BD - .04, .03, .11, .01), mat.under); laptop.add(under);
  const shell = new THREE.Mesh(roundedSlab(BW, BD, BH, .12, .026), mat.shell); shell.renderOrder = 2; laptop.add(shell);

  // internals
  const inner = new THREE.Group(); laptop.add(inner); R0.inner = inner;
  const pcb = new THREE.Mesh(new THREE.BoxGeometry(3.1, .012, 1.3), mat.pcb); pcb.position.set(0, .036, -.42); inner.add(pcb);
  const parts = {};
  for (const id of ['cpu', 'gpu', 'ram', 'ssd', 'wifi', 'battery']) {
    const sp = SPOTS[id]; const m = new THREE.Mesh(new THREE.BoxGeometry(...sp.size), id === 'battery' ? mat.battery : mat.chip.clone());
    m.position.set(...sp.pos); inner.add(m); parts[id] = m;
  }
  const die = (x, z, s) => { const d = new THREE.Mesh(new THREE.BoxGeometry(s, .012, s), mat.chip); d.position.set(x, .08, z); inner.add(d); };
  die(-.35, -.62, .2); die(.45, -.6, .24);
  // heat pipes to the fans
  const pipe = (pts) => { const curve = new THREE.CatmullRomCurve3(pts.map(p => new THREE.Vector3(...p))); const m = new THREE.Mesh(new THREE.TubeGeometry(curve, 30, .028, 8, false), mat.copper); inner.add(m); };
  pipe([[-.35, .09, -.6], [-.8, .09, -.7], [-1.3, .09, -.8]]); pipe([[.45, .09, -.58], [.9, .09, -.7], [1.3, .09, -.8]]); pipe([[-.3, .09, -.52], [.1, .09, -.48], [.4, .09, -.52]]);
  // fans
  R0.fans = [];
  for (const x of [-1.3, 1.3]) {
    const g = new THREE.Group(); g.position.set(x, .06, -.8); inner.add(g);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(.34, .02, 8, 40), mat.fan); ring.rotation.x = Math.PI / 2; g.add(ring);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(.08, .08, .05, 20), mat.fan); g.add(hub);
    const blades = new THREE.Group(); g.add(blades);
    for (let i = 0; i < 11; i++) { const b = new THREE.Mesh(new THREE.BoxGeometry(.24, .006, .07), mat.fan); b.position.set(.17, 0, 0); b.rotation.x = .35; const arm = new THREE.Group(); arm.rotation.y = i / 11 * Math.PI * 2; arm.add(b); blades.add(arm); }
    R0.fans.push(blades);
  }
  // battery cells
  for (let i = 1; i < 4; i++) { const l = new THREE.Mesh(new THREE.BoxGeometry(.012, .062, .66), mat.under); l.position.set(-1.3 + i * .65, .052, .74); inner.add(l); }

  // keyboard
  const cols = 15, rows = 6, kw = .165, kd = .128, px = 2.76 / cols, pz = .88 / rows;
  const keyGeo = new THREE.BoxGeometry(kw, .022, kd);
  const keys = new THREE.InstancedMesh(keyGeo, mat.keys, cols * rows); const dummy = new THREE.Object3D(); let n = 0;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    if (r === rows - 1 && c >= 4 && c <= 10) continue;
    dummy.position.set(-1.38 + px / 2 + c * px, BH + .012, -1.0 + pz / 2 + r * pz); dummy.updateMatrix(); keys.setMatrixAt(n++, dummy.matrix);
  }
  keys.count = n; keys.renderOrder = 3; laptop.add(keys);
  const space = new THREE.Mesh(new THREE.BoxGeometry(px * 7 - .02, .022, kd), mat.keys); space.position.set(-1.38 + px * 4 + px * 3.5, BH + .012, -1.0 + pz / 2 + (rows - 1) * pz); space.renderOrder = 3; laptop.add(space);
  const tray = new THREE.Mesh(new THREE.PlaneGeometry(2.86, .98), mat.tray); tray.rotation.x = -Math.PI / 2; tray.position.set(0, BH + .0015, -.56); tray.renderOrder = 2; laptop.add(tray);
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(2.8, .92), mat.glow); glow.rotation.x = -Math.PI / 2; glow.position.set(0, BH + .003, -.56); glow.renderOrder = 3; laptop.add(glow);
  const pad = new THREE.Mesh(roundedSlab(1.18, .66, .006, .05, .002), mat.pad); pad.position.set(0, BH, .56); pad.renderOrder = 3; laptop.add(pad);
  // speakers
  for (const x of [-1.58, 1.58]) { const g = new THREE.Mesh(new THREE.PlaneGeometry(.16, .9), mat.grille); g.rotation.x = -Math.PI / 2; g.position.set(x, BH + .002, -.52); g.renderOrder = 3; laptop.add(g); }
  // rear vents and ports
  for (let i = 0; i < 18; i++) { const v = new THREE.Mesh(new THREE.BoxGeometry(.06, .05, .02), mat.port); v.position.set(-1.2 + i * .14, .065, -BD / 2 - .002); laptop.add(v); }
  for (const [z, w] of [[-.6, .14], [-.3, .1], [0, .1], [.3, .06]]) { const p = new THREE.Mesh(new THREE.BoxGeometry(.02, .045, w), mat.port); p.position.set(-BW / 2 - .002, .065, z); laptop.add(p); }
  for (const [z, w] of [[-.4, .1], [-.1, .1]]) { const p = new THREE.Mesh(new THREE.BoxGeometry(.02, .045, w), mat.port); p.position.set(BW / 2 + .002, .065, z); laptop.add(p); }

  // hinge and lid
  const hinge = new THREE.Mesh(new THREE.CylinderGeometry(.05, .05, 2.6, 16), mat.under); hinge.rotation.z = Math.PI / 2; hinge.position.set(0, BH, -BD / 2 + .06); laptop.add(hinge);
  const lidPivot = new THREE.Group(); lidPivot.position.set(0, BH, -BD / 2 + .02); laptop.add(lidPivot); R0.lidPivot = lidPivot;
  const LD = BD - .05;
  const lid = new THREE.Mesh(roundedSlab(BW, LD, LT, .12, .02), mat.lid); lid.position.set(0, 0, LD / 2); lidPivot.add(lid);
  const bezel = new THREE.Mesh(new THREE.PlaneGeometry(BW - .1, LD - .1), mat.bezel); bezel.rotation.x = Math.PI / 2; bezel.position.set(0, -.0012, LD / 2); lidPivot.add(bezel);
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(3.32, 2.08), mat.screen); screen.rotation.x = Math.PI / 2; screen.position.set(0, -.0024, LD / 2 + .08); lidPivot.add(screen);
  R0.screen = screen;

  // highlight halos (one per component)
  const haloMat = () => new THREE.MeshBasicMaterial({ color: accent.clone(), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false });
  for (const id of ['cpu', 'gpu', 'ram', 'ssd', 'wifi', 'battery']) {
    const sp = SPOTS[id]; const m = new THREE.Mesh(new THREE.BoxGeometry(sp.size[0] * 1.12, sp.size[1] + .04, sp.size[2] * 1.12), haloMat());
    m.position.set(...sp.pos); m.renderOrder = 10; inner.add(m); halo[id] = { mat: m.material, s: new Spring(0, 90, 15), part: parts[id] };
  }
  { const hm = haloMat(); for (const x of [-1.58, 1.58]) { const m = new THREE.Mesh(new THREE.PlaneGeometry(.2, .96), hm); m.rotation.x = -Math.PI / 2; m.position.set(x, BH + .006, -.52); m.renderOrder = 10; laptop.add(m); } halo.audio = { mat: hm, s: new Spring(0, 90, 15) }; }
  { const hm = new THREE.LineBasicMaterial({ color: accent.clone(), transparent: true, opacity: 0, depthTest: false });
    const edge = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.PlaneGeometry(3.4, 2.16)), hm); edge.rotation.x = Math.PI / 2; edge.position.set(0, -.004, LD / 2 + .08); edge.renderOrder = 10; lidPivot.add(edge);
    halo.display = { mat: hm, s: new Spring(0, 90, 15) }; }
  { const hm = haloMat(); const bar = new THREE.Mesh(new THREE.PlaneGeometry(3.32, .14), hm); bar.rotation.x = Math.PI / 2; bar.position.set(0, -.005, LD / 2 + .08 - 1.04 + .07); bar.renderOrder = 10; lidPivot.add(bar); halo.sys = { mat: hm, s: new Spring(0, 90, 15) }; }

  R0.shellMats = [mat.shell, mat.keys, mat.tray, mat.pad, mat.grille];
  R0.glowMat = mat.glow;
  return R0;
}
function setEnv(R0) {
  const et = new THREE.CanvasTexture(envCanvas()); et.mapping = THREE.EquirectangularReflectionMapping; et.colorSpace = THREE.SRGBColorSpace;
  const rt = R0.pmrem.fromEquirectangular(et); et.dispose();
  if (R0.envRT) R0.envRT.dispose(); R0.envRT = rt; R0.scene.environment = rt.texture;
}
function refreshLook() {
  if (!R) return;
  const a = new THREE.Color(css('--accent')), b = new THREE.Color(css('--accent2'));
  R.lights.rimA.color.copy(a); R.lights.rimB.color.copy(b); R.glowMat.color.copy(a);
  Object.values(halo).forEach(h => h.mat.color.copy(a));
  const c = screenCanvas(); R.screenTex.image = c; R.screenTex.needsUpdate = true;
  setEnv(R); dirty = true;
}

/* ---------- camera and interaction ---------- */
let dirty = true;
const tmpV = () => new THREE.Vector3();
function focus(id) {
  clearTimeout(leaveT); if (focused === id) return; focused = id;
  $$('.m3-row', root).forEach(r => r.classList.toggle('on', r.dataset.comp === id));
  const sp = id && SPOTS[id];
  Object.entries(halo).forEach(([k, h]) => { h.s.t = k === id ? 1 : 0; });
  if (!sp) { S.az.t = POSE.az; S.el.t = POSE.el; S.dist.t = POSE.dist; [S.tx.t, S.ty.t, S.tz.t] = POSE.target; S.shell.t = 1; return; }
  S.az.t = sp.az; S.el.t = sp.el; S.dist.t = sp.dist; S.offAz.t = 0; S.offEl.t = 0;
  if (sp.screen && R) { const w = tmpV(); R.screen.getWorldPosition(w); S.tx.t = w.x; S.ty.t = w.y; S.tz.t = w.z; }
  else { S.tx.t = sp.mirror ? 0 : sp.pos[0]; S.ty.t = .1; S.tz.t = sp.pos[2]; }
  S.shell.t = sp.inside ? .1 : 1;
}
function unfocusSoon() { clearTimeout(leaveT); leaveT = setTimeout(() => focus(null), 220); }

function onDown(e) {
  if (e.button !== 0) return; dragging = true; lastX = e.clientX; lastY = e.clientY; lastT = performance.now(); vAz = vEl = 0;
  root.classList.add('grabbing'); addEventListener('pointermove', onMove); addEventListener('pointerup', onUp); clearTimeout(idleT);
}
function onMove(e) {
  if (!dragging) return; const now = performance.now(), dt = Math.max(1, now - lastT) / 1000;
  const dAz = -(e.clientX - lastX) * .0085, dEl = (e.clientY - lastY) * .0055;
  S.offAz.set(S.offAz.v + dAz); S.offEl.set(Math.max(-.3, Math.min(.85, S.offEl.v + dEl)));
  vAz = dAz / dt; vEl = dEl / dt; lastX = e.clientX; lastY = e.clientY; lastT = now; dirty = true;
}
function onUp() {
  dragging = false; root && root.classList.remove('grabbing'); removeEventListener('pointermove', onMove); removeEventListener('pointerup', onUp);
  // inertia: keeps spinning a little and slows down; then returns to its pose on its own
  S.offAz.vel = vAz * .9; S.offAz.t = S.offAz.v + vAz * .22; S.offEl.vel = vEl * .6; S.offEl.t = Math.max(-.3, Math.min(.85, S.offEl.v + vEl * .1));
  clearTimeout(idleT); idleT = setTimeout(() => { S.offAz.t = 0; S.offEl.t = 0; }, 1700);
}
function onWheel(e) { e.preventDefault(); S.zoom.t = Math.max(.68, Math.min(1.35, S.zoom.t * Math.exp(e.deltaY * .0011))); dirty = true; }

function resize() {
  if (!R || !root) return; const cv = R.renderer.domElement; const w = root.clientWidth, h = root.clientHeight; if (!w || !h) return;
  R.renderer.setSize(w, h, false); R.camera.aspect = w / h;
  const list = $('.m3-list', root); const shift = list ? (list.offsetWidth + 16) / 2 : 0;
  R.camera.setViewOffset(w, h, -shift, 0, w, h); R.camera.updateProjectionMatrix();
  R.fit = Math.max(.85, Math.min(1.15, 1.1 / Math.max(.4, (w - shift * 2) / h))); dirty = true;
}

function frame(dt, t) {
  if (!mounted || !R || (state.view !== 'home' && !SH.homeAnimating)) return;
  const moving = state.settings.intensity !== 'min';
  let active = dragging || moving;
  for (const k in S) { const s = S[k]; const before = s.v; s.step(dt); if (Math.abs(s.v - before) > 1e-5) active = true; }
  for (const k in halo) { const h = halo[k]; const b = h.s.v; h.s.step(dt); if (Math.abs(h.s.v - b) > 1e-5) active = true; }
  if (!active && !dirty) return;
  dirty = false;
  // orbit camera around the target
  const az = S.az.v + S.offAz.v, el = Math.max(.05, Math.min(1.35, S.el.v + S.offEl.v)), d = S.dist.v * S.zoom.v * (R.fit || 1);
  const c = R.camera; c.position.set(S.tx.v + d * Math.sin(az) * Math.cos(el), S.ty.v + d * Math.sin(el), S.tz.v + d * Math.cos(az) * Math.cos(el));
  c.lookAt(S.tx.v, S.ty.v, S.tz.v);
  // lid, screen, shell
  R.lidPivot.rotation.x = S.lid.v;
  const on = Math.max(0, Math.min(1, S.screen.v)); R.mat.screen.color.setScalar(on);
  const op = Math.max(.08, Math.min(1, S.shell.v));
  R.shellMats.forEach(m => { m.opacity = op; m.depthWrite = op > .95; });
  R.glowMat.opacity = .32 * op;
  // highlights, with a soft pulse
  const pulse = moving ? .78 + .22 * Math.sin(t / 260) : 1;
  for (const k in halo) { const h = halo[k]; const v = Math.max(0, h.s.v); h.mat.opacity = (k === 'display' ? .95 : .55) * v * pulse; if (h.part && h.part.material.emissive) { h.part.material.emissive.copy(h.mat.color).multiplyScalar(.5 * v); } }
  // floating and fans
  if (moving) {
    R.laptop.position.y = Math.sin(t / 1500) * .035;
    if (!dragging && !focused) R.laptop.rotation.y = Math.sin(t / 3200) * .025;
    /* Windows does not report fan rpm (they arrive as null): the fans follow the load. Never NaN, which breaks the scene */
    const v = SH.tele.v, rpm = (f, load) => (f != null && !Number.isNaN(f)) ? f : 900 + (load || 0) * 32;
    R.fans[0].rotation.y += dt * rpm(v.fanCpu, v.cpu) / 60 * .9; R.fans[1].rotation.y -= dt * rpm(v.fanGpu, v.gpu) / 60 * .9;
  }
  R.renderer.render(R.scene, c);
}

/* ---------- surrounding UI ---------- */
function listHTML(PC) {
  return `<div class="pan m3-list"><h4>Components</h4>${PC.components.map(c => `<button class="m3-row" data-comp="${c.id}"><span class="ci">${ic(c.id === 'sys' ? 'windows' : c.id)}</span><span class="ct"><b>${esc(c.name)}</b><span>${esc(c.title)}</span></span></button>`).join('')}</div>`;
}
function fallbackSVG() {
  return `<svg class="m3-fallback" viewBox="0 0 420 300" aria-label="Laptop">
    <defs><linearGradient id="m3l" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2a3550"/><stop offset="1" stop-color="#1a2236"/></linearGradient>
    <linearGradient id="m3s" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0d1a30"/><stop offset="1" style="stop-color:color-mix(in oklab,var(--accent) 30%,#0d1a30)"/></linearGradient>
    <radialGradient id="m3sh"><stop offset="0" stop-color="#000" stop-opacity=".6"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient></defs>
    <ellipse cx="210" cy="276" rx="210" ry="22" fill="url(#m3sh)"/>
    <polygon points="76,6 344,6 354,198 66,198" fill="url(#m3l)" stroke="#3a4766"/><polygon points="92,22 328,22 336,186 84,186" fill="url(#m3s)"/>
    <ellipse cx="210" cy="104" rx="90" ry="28" fill="none" style="stroke:var(--accent2)" stroke-opacity=".5" transform="rotate(-8 210 104)"/><circle cx="210" cy="104" r="13" style="fill:var(--accent)"/>
    <polygon points="66,198 354,198 402,262 18,262" fill="#1e273c" stroke="#3a4766"/><polygon points="18,262 402,262 398,274 22,274" fill="#121828"/>
    <polygon points="110,206 310,206 330,238 90,238" fill="#0c111e"/><polygon points="168,242 252,242 256,257 164,257" fill="#263049"/></svg>`;
}

SH.homeVariant({
  id: 'model3d', name: '3D model', short: '3D',
  desc: 'Your PC in 3D: drag to rotate it and hover a component to see where it is.',
  mount(el, ctx) {
    mounted = true; ctxRef = ctx; const my = ++token;
    root = document.createElement('div'); root.className = 'hv-model3d'; el.appendChild(root);
    root.innerHTML = `<div class="m3-stage"></div>${listHTML(ctx.PC)}<div class="m3-hint">Drag to rotate it. Scroll to zoom in.</div>`;
    const list = $('.m3-list', root);
    list.addEventListener('pointerover', e => { const r = e.target.closest('.m3-row'); if (r) focus(r.dataset.comp); });
    list.addEventListener('pointerleave', unfocusSoon);
    list.addEventListener('click', e => { const r = e.target.closest('.m3-row'); if (r) ctx.openComponent(r.dataset.comp, r); });
    if (ctx.intro) {
      /* the list fills the stage height (top:0/bottom:0): it only slides in sideways, without the -50% from when it was centered */
      anim(list, [{ opacity: 0, transform: 'translate3d(-18px,0,0)', filter: 'blur(8px)' }, { opacity: 1, transform: 'none', filter: 'blur(0px)' }], { d: 560, delay: 500, e: EASE.spring });
      $$('.m3-row', list).forEach((r, i) => anim(r, [{ opacity: 0, transform: 'translate3d(-10px,0,0)' }, { opacity: 1, transform: 'none' }], { d: 420, delay: 620 + i * 40, e: EASE.spring }));
      anim($('.m3-hint', root), [{ opacity: 0 }, { opacity: 1 }], { d: 500, delay: 1600 });
    }
    const stage = $('.m3-stage', root);
    if (!webglOK()) { stage.innerHTML = fallbackSVG(); stage.classList.add('flat'); return; }
    loadThree().then(() => {
      if (!mounted || my !== token) return;
      const cv = document.createElement('canvas'); cv.className = 'm3-canvas'; stage.appendChild(cv);
      try { R = build(cv); } catch (e) { console.warn('StellarHub: no 3D', e); R = null; cv.remove(); stage.innerHTML = fallbackSVG(); stage.classList.add('flat'); return; }
      cv.addEventListener('pointerdown', onDown); cv.addEventListener('wheel', onWheel, { passive: false });
      cv.addEventListener('dblclick', () => { S.zoom.t = 1; S.offAz.t = 0; S.offEl.t = 0; });
      ro = new ResizeObserver(resize); ro.observe(root); resize();
      unsubLook = SH.on('look', refreshLook);
      // entrance: camera from afar, the lid opens and the screen lights up
      focused = null; Object.values(halo).forEach(h => h.s.set(0));
      S.az.set(POSE.az + (ctx.intro ? .7 : 0)); S.el.set(POSE.el + (ctx.intro ? .25 : 0)); S.dist.set(POSE.dist * (ctx.intro ? 1.6 : 1));
      S.az.t = POSE.az; S.el.t = POSE.el; S.dist.t = POSE.dist; [S.tx.t, S.ty.t, S.tz.t] = POSE.target; S.tx.set(S.tx.t); S.ty.set(S.ty.t); S.tz.set(S.tz.t);
      S.offAz.set(0); S.offEl.set(0); S.zoom.set(1); S.shell.set(1);
      if (ctx.intro) {
        S.lid.set(0); S.screen.set(0);
        anim(cv, [{ opacity: 0, filter: 'blur(12px)' }, { opacity: 1, filter: 'blur(0px)' }], { d: 800, e: EASE.out });
        timers.push(setTimeout(() => { S.lid.t = OPEN; }, 380 * SH.motion()));
        timers.push(setTimeout(() => { S.screen.t = 1; }, 900 * SH.motion()));
      } else { S.lid.set(OPEN); S.screen.set(1); }
      dirty = true; tickers.add(frame);
    }).catch(e => { console.warn('StellarHub: could not load three.js', e); if (mounted && my === token) { stage.innerHTML = fallbackSVG(); stage.classList.add('flat'); } });
  },
  unmount() {
    mounted = false; token++; tickers.delete(frame); timers.forEach(clearTimeout); timers = []; clearTimeout(leaveT); clearTimeout(idleT);
    removeEventListener('pointermove', onMove); removeEventListener('pointerup', onUp); dragging = false;
    if (unsubLook) unsubLook(); unsubLook = null; if (ro) ro.disconnect(); ro = null;
    if (R) {
      R.scene.traverse(o => {
        if (o.geometry) o.geometry.dispose();
        const ms = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
        ms.forEach(m => { for (const k in m) { const v = m[k]; if (v && v.isTexture) v.dispose(); } m.dispose(); });
      });
      R.tex.forEach(t => t.dispose()); if (R.envRT) R.envRT.dispose(); R.pmrem.dispose();
      R.renderer.dispose(); try { R.renderer.forceContextLoss(); } catch {}
      R = null;
    }
    Object.keys(halo).forEach(k => delete halo[k]); focused = null; root = null; ctxRef = null;
  },
  resize,
  onReturn() { if (!R) return; S.dist.v = S.dist.v * 1.25; S.az.v += .25; dirty = true; },
});
})();
