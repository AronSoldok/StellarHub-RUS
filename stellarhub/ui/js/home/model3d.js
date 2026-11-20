/* StellarHub · "3D model" Home view: a detailed 3D model of the laptop (ASUS TUF Gaming F16) that you rotate by dragging.
   Hovering a component in the list moves the camera to it. For the parts inside, the top case lifts and turns to glass
   (x-ray) so the board, the fans (spinning with the real telemetry), the heat pipes and the battery show, and the part lights up.
   The screen shows a small live dashboard. Everything is procedural (geometry and canvas textures): no external assets. */
'use strict';
(() => {
const { $, $$, Spring, EASE, anim, tickers, ic, state, esc } = SH;
let THREE = null, threeP = null;
const loadThree = () => (threeP ||= import(new URL('vendor/three.module.min.js', document.baseURI).href).then(m => (THREE = m)));
/* WebGL available? And is it a software renderer (no GPU: WebView2 fallback)? Then the scene is drawn lighter. */
let softGL = false;
function webglOK() {
  try {
    const c = document.createElement('canvas'), gl = c.getContext('webgl2') || c.getContext('webgl'); if (!gl) return false;
    const ext = gl.getExtension('WEBGL_debug_renderer_info'), name = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : '';
    softGL = /swiftshader|llvmpipe|softpipe|software|basic render/i.test(name);
    const lose = gl.getExtension('WEBGL_lose_context'); if (lose) lose.loseContext();
    return true;
  } catch { return false; }
}
const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim() || '#ffffff';
const fin = (x, d = null) => (typeof x === 'number' && Number.isFinite(x)) ? x : d; // telemetry can be null: never NaN
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const TAU = Math.PI * 2;

/* measurements (scene units: 1 = 10 cm; the F16 is 354 × 251 mm) */
const BW = 3.56, BD = 2.5, BH = .16, SEAM = .045, LT = .062, LD = 2.4, OPEN = -1.92;
const PIV = { y: BH + .03, z: -BD / 2 + .07 };                 // lid hinge
const KU = .162, KGAP = .03, KX0 = -19.25 * KU / 2, KZ0 = -.93; // keyboard: key pitch, left and rear edges
const KW = 19.25 * KU, KD = 5.62 * KU;
const TP = { x: KX0 + 7.25 * KU, z: .48, w: 1.26, d: .78 };     // trackpad, centered under the space bar
const SCR = { w: 3.42, h: 2.1375, z: LD - .075 - 2.1375 / 2 };  // 16:10 panel inside thin bezels
const LIFT = .34;                                               // how far the top case rises in x-ray
/* where each component is and where to look at it from */
const SPOTS = {
  cpu: { pos: [-.42, .07, -.55], size: [.4, .02, .36], az: .2, el: 1.0, dist: 7.6, inside: true },
  gpu: { pos: [.42, .07, -.55], size: [.5, .02, .44], az: -.15, el: 1.0, dist: 7.6, inside: true },
  ram: { pos: [-.45, .066, -.13], size: [.72, .02, .3], az: .15, el: 1.08, dist: 7.6, inside: true },
  ssd: { pos: [.43, .066, -.1], size: [.8, .02, .22], az: -.25, el: 1.08, dist: 7.6, inside: true },
  wifi: { pos: [1.06, .066, -.06], size: [.3, .02, .22], az: -.45, el: 1.0, dist: 7.4, inside: true },
  battery: { pos: [0, .08, .66], size: [2.7, .06, .9], az: .05, el: 1.12, dist: 8.6, inside: true },
  audio: { pos: [0, BH, -1.035], size: [1.3, .01, .09], az: .3, el: .8, dist: 7.6, inside: false, mirror: true },
  display: { screen: true, az: .05, el: .2, dist: 8.2 },
  sys: { screen: true, az: -.3, el: .24, dist: 8.2 },
};
let POSE = { az: .58, el: .36, dist: 8.7, target: [0, .5, -.15] };

/* ---------- view state ---------- */
let root = null, mounted = false, token = 0, ctxRef = null, timers = [], unsubLook = null, unsubTele = null, ro = null;
let R = null; // everything three.js lives here so it can be released
const S = {
  az: new Spring(POSE.az, 60, 13), el: new Spring(POSE.el, 60, 13), dist: new Spring(POSE.dist, 50, 12),
  tx: new Spring(POSE.target[0], 60, 13), ty: new Spring(POSE.target[1], 60, 13), tz: new Spring(POSE.target[2], 60, 13),
  offAz: new Spring(0, 26, 7), offEl: new Spring(0, 26, 7), lid: new Spring(0, 34, 7.5), shell: new Spring(1, 70, 15),
  screen: new Spring(0, 40, 12), zoom: new Spring(1, 70, 14), kb: new Spring(0, 30, 10),
};
const POSE_L = POSE, isTower = () => !!(ctxRef && ctxRef.PC && ctxRef.PC.type === 'desktop');
let SP = SPOTS;
let focused = null, leaveT = 0, dragging = false, lastX = 0, lastY = 0, lastT = 0, idleT = 0, vAz = 0, vEl = 0;
const halo = {}; // id -> {mats, k, s, part}

/* ---------- small helpers ---------- */
const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
function rgba(col, a) {
  const h = new THREE.Color(col).getHexString();
  return `rgba(${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)},${a})`;
}
function glow(g, x, y, r, col) { const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, col); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2); }
function noise(g, w, h, a, seed = 3) {
  const t = mk(128, 128), tg = t.getContext('2d'), id = tg.createImageData(128, 128); let s = seed;
  for (let i = 0; i < id.data.length; i += 4) { s = (s * 16807) % 2147483647; const v = s & 255; id.data[i] = id.data[i + 1] = id.data[i + 2] = v; id.data[i + 3] = 255 * a; }
  tg.putImageData(id, 0, 0); g.save(); g.globalCompositeOperation = 'overlay'; g.fillStyle = g.createPattern(t, 'repeat'); g.fillRect(0, 0, w, h); g.restore();
}
const FONT = (w, px, fam = 'Onest') => `${w} ${px}px ${fam}, 'Segoe UI', system-ui, sans-serif`;

/* rounded rectangle outline (xz plane), offset inwards by `inset`, with outward normals */
function rrect(w, d, r, inset, seg) {
  const hw = w / 2 - r, hd = d / 2 - r, rr = Math.max(.0005, r - inset), out = [], C = [[hw, hd], [-hw, hd], [-hw, -hd], [hw, -hd]];
  for (let k = 0; k < 4; k++) for (let i = 0; i <= seg; i++) {
    const a = (k + i / seg) * Math.PI / 2, nx = Math.cos(a), nz = Math.sin(a);
    out.push({ x: C[k][0] + nx * rr, z: C[k][1] + nz * rr, nx, nz });
  }
  return out;
}
/* a slab lofted through profile stations [[y, inset], ...] (bottom to top): crisp chamfers, smooth corners.
   Groups: 0 top cap (planar uv, canvas top = rear), 1 walls, 2 bottom cap. */
function loft(w, d, r, st, seg = 6, caps = 3) {
  const P = [], N = [], U = [], g = new THREE.BufferGeometry();
  const rings = st.map(s => rrect(w, d, r, s[1], seg)), n = rings[0].length;
  const v = (p, y, nx, ny, nz, u, vv) => { P.push(p.x, y, p.z); N.push(nx, ny, nz); U.push(u, vv); };
  const cu = p => [p.x / w + .5, .5 - p.z / d], O = { x: 0, z: 0 };
  const cap = (ring, y, up) => {
    const ny = up ? 1 : -1;
    for (let j = 0; j < n; j++) { const a = ring[j], b = ring[(j + 1) % n], p = up ? b : a, q = up ? a : b; v(O, y, 0, ny, 0, .5, .5); v(p, y, 0, ny, 0, ...cu(p)); v(q, y, 0, ny, 0, ...cu(q)); }
  };
  if (caps & 2) cap(rings[rings.length - 1], st[st.length - 1][0], true);
  let s0 = P.length / 3; g.addGroup(0, s0, 0);
  for (let s = 0; s < st.length - 1; s++) {
    const [ya, ia] = st[s], [yb, ib] = st[s + 1]; let no = yb - ya, nu = ib - ia; const l = Math.hypot(no, nu) || 1; no /= l; nu /= l;
    const A = rings[s], B = rings[s + 1], nv = p => [p.nx * no, nu, p.nz * no];
    for (let j = 0; j < n; j++) {
      const j1 = (j + 1) % n, a0 = A[j], a1 = A[j1], b0 = B[j], b1 = B[j1];
      v(a0, ya, ...nv(a0), j / n, 0); v(b0, yb, ...nv(b0), j / n, 1); v(a1, ya, ...nv(a1), (j + 1) / n, 0);
      v(a1, ya, ...nv(a1), (j + 1) / n, 0); v(b0, yb, ...nv(b0), j / n, 1); v(b1, yb, ...nv(b1), (j + 1) / n, 1);
    }
  }
  g.addGroup(s0, P.length / 3 - s0, 1); s0 = P.length / 3;
  if (caps & 1) cap(rings[0], st[0][0], false);
  g.addGroup(s0, P.length / 3 - s0, 2);
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
  return g;
}
/* merges geometries into one (one draw call); the inputs are released */
function merge(list) {
  const parts = list.filter(Boolean).map(g => { const n = g.index ? g.toNonIndexed() : g; if (n !== g) g.dispose(); return n; });
  let len = 0; parts.forEach(p => { len += p.attributes.position.count; });
  const pos = new Float32Array(len * 3), nor = new Float32Array(len * 3), uv = new Float32Array(len * 2); let o = 0;
  for (const p of parts) {
    const c = p.attributes.position.count; pos.set(p.attributes.position.array, o * 3);
    if (p.attributes.normal) nor.set(p.attributes.normal.array, o * 3);
    if (p.attributes.uv) uv.set(p.attributes.uv.array, o * 2);
    o += c; p.dispose();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}
const box = (w, h, d, x, y, z, ry = 0, rz = 0) => { const g = new THREE.BoxGeometry(w, h, d); if (rz) g.rotateZ(rz); if (ry) g.rotateY(ry); g.translate(x, y, z); return g; };
const at = (g, x, y, z) => { g.translate(x, y, z); return g; };
const shape = pts => { const s = new THREE.Shape(); pts.forEach(([x, y], i) => i ? s.lineTo(x, y) : s.moveTo(x, y)); s.closePath(); return s; };
const rshape = (w, h, r) => { const s = new THREE.Shape(), x = -w / 2, y = -h / 2; r = Math.min(r, w / 2, h / 2); s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.absarc(x + w - r, y + r, r, -Math.PI / 2, 0); s.lineTo(x + w, y + h - r); s.absarc(x + w - r, y + h - r, r, 0, Math.PI / 2); s.lineTo(x + r, y + h); s.absarc(x + r, y + h - r, r, Math.PI / 2, Math.PI); s.lineTo(x, y + r); s.absarc(x + r, y + r, r, Math.PI, Math.PI * 1.5); return s; };
const para = (w, h, sl) => shape([[-w / 2 + sl, h / 2], [-w / 2, -h / 2], [w / 2 - sl, -h / 2], [w / 2, h / 2]]); // TUF-style slanted opening
/* a flat shape stuck on a side wall: side 'L' (x = -BW/2), 'R' (x = +BW/2) or 'B' (rear, z = -BD/2); u runs along the wall */
function onWall(sh, side, u, y, out = .0015, curve = 8) {
  const g = new THREE.ShapeGeometry(sh, curve);
  if (side === 'L') { g.rotateY(-Math.PI / 2); g.translate(-BW / 2 - out, y, u); }
  else if (side === 'R') { g.rotateY(Math.PI / 2); g.translate(BW / 2 + out, y, -u); }
  else { g.rotateY(Math.PI); g.translate(-u, y, -BD / 2 - out); }
  return g;
}
function canvasTex(c, color = true, aniso = 1) {
  const t = new THREE.CanvasTexture(c); if (color) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = aniso; R0tex.push(t); return t;
}
let R0tex = [];

/* ---------- keyboard layout (full size with numpad and arrow cluster) ---------- */
function keyLayout() {
  const L = 'QWERTYUIOP'.split(''), M = 'ASDFGHJKL'.split(''), Z = 'ZXCVBNM'.split('');
  const one = a => a.map(k => [k, 1]);
  const rows = [
    { h: .62, main: one(['Esc', 'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12', 'Ins', 'Del']), pad: one(['Home', 'PgUp', 'PgDn', 'End']) },
    { h: 1, main: [...one(['`', '1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-', '=']), ['Backspace', 2]], pad: one(['Num', '/', '*', '−']) },
    { h: 1, main: [['Tab', 1.5], ...one([...L, '[', ']']), ['\\', 1.5]], pad: [['7', 1], ['8', 1], ['9', 1], ['+', 1, 2]] },
    { h: 1, main: [['Caps', 1.75], ...one([...M, ';', "'"]), ['Enter', 2.25]], pad: one(['4', '5', '6']) },
    { h: 1, main: [['Shift', 2.25], ...one([...Z, ',', '.', '/']), ['Shift', 2.75]], pad: [['1', 1], ['2', 1], ['3', 1], ['Enter', 1, 2]] },
    { h: 1, main: [['Ctrl', 1.25], ['Fn', 1], ['WIN', 1], ['Alt', 1.25], ['', 5.5], ['Alt', 1], ['Ctrl', 1], ['←', 1], ['↑', 1, 'u'], ['↓', 1, 'd'], ['→', 1]], pad: [['0', 2], ['.', 1]] },
  ];
  const keys = []; let z = KZ0;
  rows.forEach(row => {
    const place = (list, x0) => { let x = x0; list.forEach(([l, w, tall]) => {
      const half = tall === 'u' || tall === 'd', d = (tall === 2 ? 2 : half ? row.h / 2 : row.h) * KU, zc = tall === 'd' ? z + d * 1.5 : z + d / 2;
      keys.push({ l, x: KX0 + (x + w / 2) * KU, z: zc, w: w * KU - KGAP, d: d - (half ? KGAP * .6 : KGAP) }); if (tall !== 'u') x += w;
    }); };
    place(row.main, 0); place(row.pad, 15.25); z += row.h * KU;
  });
  return keys;
}

/* ---------- hand-made canvas textures ---------- */
function deckCanvas(keys) {
  const W = 1536, H = Math.round(W * BD / BW), c = mk(W, H), g = c.getContext('2d');
  const X = x => (x / BW + .5) * W, Z = z => (z / BD + .5) * H, U = W / BW;
  const gr = g.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, '#454b57'); gr.addColorStop(1, '#3a404b'); g.fillStyle = gr; g.fillRect(0, 0, W, H);
  noise(g, W, H, .05);
  // keyboard plate
  g.fillStyle = '#0d1015'; g.beginPath(); g.roundRect(X(KX0 - .035), Z(KZ0 - .03), (KW + .07) * U, (KD + .06) * U, 10); g.fill();
  g.strokeStyle = 'rgba(255,255,255,.07)'; g.lineWidth = 2; g.stroke();
  // speaker and intake perforation above the keyboard, in two halves
  g.fillStyle = '#0b0d12';
  for (let z = -1.075, row = 0; z < -.995; z += .016, row++) for (let x = -1.42 + (row % 2) * .009; x < 1.42; x += .018) { if (Math.abs(x) < .14) continue; g.beginPath(); g.arc(X(x), Z(z), 2.6, 0, TAU); g.fill(); }
  // small angular accent lines at the corners of the palm rest (TUF-like)
  g.strokeStyle = 'rgba(255,255,255,.06)'; g.lineWidth = 2;
  g.beginPath(); g.moveTo(X(-1.66), Z(1.0)); g.lineTo(X(-1.5), Z(1.14)); g.lineTo(X(-1.1), Z(1.14)); g.stroke();
  g.beginPath(); g.moveTo(X(1.66), Z(1.0)); g.lineTo(X(1.5), Z(1.14)); g.lineTo(X(1.1), Z(1.14)); g.stroke();
  // soft occlusion around the trackpad
  g.save(); g.filter = 'blur(6px)'; g.strokeStyle = 'rgba(0,0,0,.35)'; g.lineWidth = 6; g.beginPath(); g.roundRect(X(TP.x - TP.w / 2), Z(TP.z - TP.d / 2), TP.w * U, TP.d * U, 18); g.stroke(); g.restore();
  return c;
}
function lidCanvas() {
  const W = 1024, H = Math.round(W * LD / BW), c = mk(W, H), g = c.getContext('2d');
  g.translate(W, H); g.rotate(Math.PI); // the canvas is seen from behind and upside down: draw it rotated
  const gr = g.createLinearGradient(0, 0, W, H); gr.addColorStop(0, '#464c58'); gr.addColorStop(1, '#383e49'); g.fillStyle = gr; g.fillRect(0, 0, W, H);
  // the angular split of the TUF lid: a darker panel cut diagonally
  g.fillStyle = 'rgba(12,15,22,.24)'; g.beginPath(); g.moveTo(W * .6, 0); g.lineTo(W, 0); g.lineTo(W, H); g.lineTo(W * .47, H); g.closePath(); g.fill();
  g.strokeStyle = 'rgba(230,236,248,.16)'; g.lineWidth = 2; g.beginPath(); g.moveTo(W * .6, 0); g.lineTo(W * .47, H); g.stroke();
  g.strokeStyle = 'rgba(230,236,248,.07)'; g.beginPath(); g.moveTo(W * .63, 0); g.lineTo(W * .5, H); g.stroke();
  noise(g, W, H, .06, 11);
  // emblem: angular shield outline and wordmark
  const cx = W * .5, cy = H * .44, s = 44;
  g.strokeStyle = 'rgba(214,224,240,.62)'; g.lineWidth = 3; g.lineJoin = 'miter';
  g.beginPath(); g.moveTo(cx - s * 1.2, cy - s * .7); g.lineTo(cx + s * 1.2, cy - s * .7); g.lineTo(cx + s * .95, cy + s * .25); g.lineTo(cx, cy + s * .95); g.lineTo(cx - s * .95, cy + s * .25); g.closePath(); g.stroke();
  g.beginPath(); g.moveTo(cx - s * .62, cy - s * .32); g.lineTo(cx + s * .62, cy - s * .32); g.moveTo(cx, cy - s * .32); g.lineTo(cx, cy + s * .55); g.stroke();
  g.fillStyle = 'rgba(214,224,240,.5)'; g.font = FONT(600, 20, 'Unbounded'); g.textAlign = 'center'; g.letterSpacing = '8px'; g.fillText('TUF GAMING', cx + 4, cy + s * 1.9);
  return c;
}
function pcbCanvas(w, d, label = 'FX608JPR  MAIN BOARD  REV 1.0') {
  const W = 1024, H = Math.round(W * d / w), c = mk(W, H), g = c.getContext('2d');
  g.fillStyle = '#0b1f24'; g.fillRect(0, 0, W, H);
  let s = 5; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  g.lineCap = 'round';
  for (let i = 0; i < 220; i++) { // traces: 45° routed copper lines
    let x = rnd() * W, y = rnd() * H; g.strokeStyle = `rgba(${150 + rnd() * 60},${120 + rnd() * 40},70,${.12 + rnd() * .14})`; g.lineWidth = 1 + rnd() * 1.5; g.beginPath(); g.moveTo(x, y);
    for (let k = 0; k < 3; k++) { const L = 20 + rnd() * 90, dir = Math.floor(rnd() * 8) * Math.PI / 4; x += Math.cos(dir) * L; y += Math.sin(dir) * L; g.lineTo(x, y); } g.stroke();
  }
  g.fillStyle = 'rgba(205,170,100,.35)'; for (let i = 0; i < 500; i++) { g.beginPath(); g.arc(rnd() * W, rnd() * H, 1.3, 0, TAU); g.fill(); }
  for (let i = 0; i < 170; i++) { g.fillStyle = rnd() < .5 ? 'rgba(20,24,30,.9)' : 'rgba(160,140,110,.55)'; g.fillRect(rnd() * W, rnd() * H, 6 + rnd() * 10, 4 + rnd() * 5); }
  g.fillStyle = 'rgba(230,236,245,.32)'; g.font = FONT(500, 13); for (let i = 0; i < 26; i++) g.fillText(['C', 'R', 'U', 'L', 'Q'][i % 5] + Math.floor(rnd() * 900 + 100), rnd() * W, rnd() * H);
  g.font = FONT(600, 18); g.fillStyle = 'rgba(230,236,245,.4)'; g.fillText(label, 24, H - 20);
  return c;
}
function labelCanvas(w, d, base, draw) { const W = 512, H = Math.max(16, Math.round(W * d / w)), c = mk(W, H), g = c.getContext('2d'); g.fillStyle = base; g.fillRect(0, 0, W, H); draw(g, W, H); return c; }
const compTitle = (id, d) => { const c = ctxRef && ctxRef.PC && (ctxRef.PC.components || []).find(x => x.id === id); return (c && c.title) || d; };
function kbCanvases(keys) {
  const W = 2048, H = Math.round(W * (KD + .1) / (KW + .1)), sc = W / (KW + .1);
  const X = x => (x - KX0 + .05) * sc, Z = z => (z - KZ0 + .05) * sc;
  const glowC = mk(W / 2, H / 2), gg = glowC.getContext('2d'); gg.scale(.5, .5);
  gg.fillStyle = '#000'; gg.fillRect(0, 0, W, H); gg.filter = 'blur(7px)'; gg.fillStyle = '#fff';
  keys.forEach(k => { gg.beginPath(); gg.roundRect(X(k.x - k.w / 2) - 4, Z(k.z - k.d / 2) - 4, k.w * sc + 8, k.d * sc + 8, 10); gg.fill(); });
  const legC = mk(W, H), g = legC.getContext('2d'); g.fillStyle = '#000'; g.fillRect(0, 0, W, H); g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
  keys.forEach(k => {
    const cx = X(k.x), cy = Z(k.z), long = k.l.length > 1 && !/^F\d+$/.test(k.l) && !'←→↑↓−'.includes(k.l);
    if (k.l === 'WIN') { const s = 9; [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([a, b]) => g.fillRect(cx + (a < 0 ? -s - 1 : 1), cy + (b < 0 ? -s - 1 : 1), s, s)); return; }
    if (!k.l) return;
    g.font = FONT(k.l.length === 1 ? 600 : 500, long ? 17 : k.d < .1 ? 16 : 25);
    if (long) { g.textAlign = 'left'; g.fillText(k.l, X(k.x - k.w / 2) + 12, Z(k.z + k.d / 2) - 16); g.textAlign = 'center'; }
    else g.fillText(k.l, cx, cy);
  });
  return { glowC, legC };
}
function screenBG(W, H) {
  const c = mk(W, H), g = c.getContext('2d'), a = css('--accent'), b = css('--accent2');
  const gr = g.createLinearGradient(0, 0, W, H); gr.addColorStop(0, '#050b1a'); gr.addColorStop(.55, '#0a1430'); gr.addColorStop(1, '#161131'); g.fillStyle = gr; g.fillRect(0, 0, W, H);
  glow(g, W * .9, H * 1.05, W * .62, rgba(a, .34)); glow(g, W * .06, -H * .05, W * .5, rgba(b, .2));
  let s = 7; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 160; i++) { g.globalAlpha = .2 + rnd() * .6; g.fillStyle = '#dbeaff'; g.beginPath(); g.arc(rnd() * W, rnd() * H, rnd() * 1.3 + .3, 0, TAU); g.fill(); }
  g.globalAlpha = 1; g.save(); g.translate(W * .8, H * .2); g.rotate(-.3); g.lineWidth = 2;
  g.strokeStyle = rgba(b, .16); g.beginPath(); g.ellipse(0, 0, 330, 96, 0, 0, TAU); g.stroke();
  g.strokeStyle = rgba(a, .14); g.beginPath(); g.ellipse(0, 0, 210, 62, 0, 0, TAU); g.stroke(); g.restore();
  // glass cards
  const card = (x, y, w, h) => { g.fillStyle = 'rgba(150,180,235,.07)'; g.strokeStyle = 'rgba(170,200,250,.12)'; g.lineWidth = 1.5; g.beginPath(); g.roundRect(x, y, w, h, 22); g.fill(); g.stroke(); };
  card(44, 136, 610, 300); card(676, 136, 304, 300); card(44, 456, 936, 124);
  // taskbar
  g.fillStyle = 'rgba(8,13,26,.86)'; g.fillRect(0, H - 40, W, 40); g.fillStyle = 'rgba(170,200,250,.1)'; g.fillRect(0, H - 40, W, 1);
  const ix = W / 2 - 4 * 34; for (let i = 0; i < 8; i++) {
    const x = ix + i * 34, y = H - 30;
    if (i === 0) { g.fillStyle = b; [[0, 0], [11, 0], [0, 11], [11, 11]].forEach(([p, q]) => g.fillRect(x + 1 + p, y + 1 + q, 9, 9)); continue; }
    g.fillStyle = ['', a, '#6aa8ff', '#f5c46b', '#8fe3b0', '#c9a7ff', 'rgba(200,215,240,.55)', b][i]; g.globalAlpha = .85; g.beginPath(); g.roundRect(x, y, 20, 20, 6); g.fill(); g.globalAlpha = 1;
  }
  g.fillStyle = 'rgba(232,237,246,.5)'; g.fillRect(ix + 34 * 3 + 6, H - 6, 8, 2);
  return c;
}
function shadowCanvas() {
  const c = mk(512, 512), g = c.getContext('2d');
  g.filter = 'blur(26px)'; g.fillStyle = 'rgba(0,0,0,.62)'; g.beginPath(); g.roundRect(256 - 180, 256 - 170, 360, 340, 40); g.fill();
  g.filter = 'blur(7px)'; g.fillStyle = 'rgba(0,0,0,.7)'; g.beginPath(); g.roundRect(256 - 166, 256 - 152, 332, 304, 22); g.fill();
  return c;
}
function haloCanvas() {
  const c = mk(128, 128), g = c.getContext('2d');
  g.filter = 'blur(7px)'; g.fillStyle = 'rgba(255,255,255,.3)'; g.beginPath(); g.roundRect(10, 10, 108, 108, 12); g.fill();
  g.filter = 'blur(3px)'; g.strokeStyle = 'rgba(255,255,255,.7)'; g.lineWidth = 4; g.beginPath(); g.roundRect(14, 14, 100, 100, 9); g.stroke();
  g.filter = 'none'; g.strokeStyle = 'rgba(255,255,255,.95)'; g.lineWidth = 1.5; g.beginPath(); g.roundRect(14, 14, 100, 100, 9); g.stroke();
  return c;
}

/* ---------- the live screen: a small dashboard, redrawn a few times per second ---------- */
function drawScreen() {
  const sc = R.scr, g = sc.g, W = sc.c.width, H = sc.c.height, v = SH.tele.v || {}, a = sc.a, b = sc.b;
  const cpu = fin(v.cpu), gpu = fin(v.gpu);
  g.drawImage(sc.bg, 0, 0);
  g.textBaseline = 'alphabetic'; g.textAlign = 'left';
  // header
  g.fillStyle = '#e8edf6'; g.font = FONT(600, 24, 'Unbounded'); g.fillText('StellarHub', 50, 70);
  g.fillStyle = 'rgba(232,237,246,.55)'; g.font = FONT(500, 16); g.fillText((ctxRef && ctxRef.PC && ctxRef.PC.model) || 'ASUS TUF Gaming F16', 50, 98);
  const now = new Date(); g.textAlign = 'right'; g.fillStyle = '#f2f5fb'; g.font = FONT(500, 54, 'Unbounded');
  g.fillText(now.toLocaleTimeString(SH.i18n.locale, { hour: 'numeric', minute: '2-digit', hour12: false }), W - 46, 88);
  g.fillStyle = 'rgba(232,237,246,.55)'; g.font = FONT(500, 16); g.fillText(now.toLocaleDateString(SH.i18n.locale, { weekday: 'long', month: 'long', day: 'numeric' }), W - 48, 114);
  // gauges
  const gauge = (cx, cy, r, val, label, sub) => {
    const a0 = Math.PI * .75, a1 = Math.PI * 2.25; g.lineCap = 'round'; g.lineWidth = 15;
    g.strokeStyle = 'rgba(160,190,240,.13)'; g.beginPath(); g.arc(cx, cy, r, a0, a1); g.stroke();
    if (val != null) { const gr = g.createLinearGradient(cx - r, cy + r, cx + r, cy - r); gr.addColorStop(0, b); gr.addColorStop(1, a); g.strokeStyle = gr; g.beginPath(); g.arc(cx, cy, r, a0, a0 + (a1 - a0) * clamp(val / 100, .005, 1)); g.stroke(); }
    g.textAlign = 'center'; g.fillStyle = '#f2f5fb'; g.font = FONT(600, 38, 'Unbounded'); g.fillText(val == null ? '—' : Math.round(val) + '%', cx, cy + 12);
    g.fillStyle = 'rgba(232,237,246,.85)'; g.font = FONT(600, 17); g.fillText(label, cx, cy + r + 4);
    g.fillStyle = 'rgba(232,237,246,.5)'; g.font = FONT(500, 15); g.fillText(sub, cx, cy + r + 26);
  };
  const deg = k => { const x = fin(v[k]); return x == null ? '—' : Math.round(x) + ' °C'; };
  gauge(160, 268, 76, cpu, SH.t('Processor'), deg('cpuTemp')); gauge(370, 268, 76, gpu, SH.t('Graphics'), deg('gpuTemp'));
  // memory bars
  const bar = (y, label, used, total, unit) => {
    g.textAlign = 'left'; g.fillStyle = 'rgba(232,237,246,.55)'; g.font = FONT(500, 14); g.fillText(label, 478, y);
    g.fillStyle = '#f2f5fb'; g.font = FONT(600, 17); g.fillText(used == null ? '—' : `${used >= 100 ? Math.round(used) : SH.fmt1(used)}${total ? ' / ' + Math.round(total) : ''} ${unit}`, 478, y + 23);
    g.fillStyle = 'rgba(160,190,240,.13)'; g.beginPath(); g.roundRect(478, y + 33, 150, 6, 3); g.fill();
    if (used != null && total) { g.fillStyle = b; g.beginPath(); g.roundRect(478, y + 33, Math.max(6, 150 * clamp(used / total, 0, 1)), 6, 3); g.fill(); }
  };
  bar(178, SH.t('Memory'), fin(v.ram), fin(v.ramTotal), 'GB'); bar(246, SH.t('Video memory'), fin(v.vram), fin(v.vramTotal), 'GB'); bar(314, SH.t('Drive C:'), fin(v.diskUsed), fin(v.diskTotal), 'GB');
  g.textAlign = 'left'; g.fillStyle = 'rgba(232,237,246,.5)'; g.font = FONT(500, 14); g.fillText(fin(v.cpuFreq) != null ? `CPU ${SH.fmt1(v.cpuFreq)} GHz` : 'CPU —', 478, 404);
  // right card: fans, network, battery
  const row = (y, label, val) => { g.textAlign = 'left'; g.fillStyle = 'rgba(232,237,246,.6)'; g.font = FONT(500, 16); g.fillText(label, 704, y); g.textAlign = 'right'; g.fillStyle = '#f2f5fb'; g.font = FONT(600, 18); g.fillText(val, 952, y); };
  const fc = fin(v.fanCpu), fg = fin(v.fanGpu), dn = fin(v.down), up = fin(v.up), bt = fin(v.battery), pw = fin(v.gpuPower);
  row(184, SH.t('CPU fan'), fc == null ? '—' : SH.fmtInt(fc) + ' rpm');
  row(226, SH.t('GPU fan'), fg == null ? '—' : Math.round(fg) + ' %');
  row(268, SH.t('GPU power'), pw == null ? '—' : Math.round(pw) + ' W');
  row(310, SH.t('Download'), dn == null ? '—' : SH.fmt1(dn) + ' Mb/s');
  row(352, SH.t('Upload'), up == null ? '—' : SH.fmt1(up) + ' Mb/s');
  if (ctxRef && ctxRef.PC && ctxRef.PC.type === 'desktop') row(394, SH.t('Uptime'), fin(v.uptime) == null ? '—' : SH.fmtUptime(v.uptime)); // a desktop has no battery
  else row(394, SH.t('Battery'), bt == null ? '—' : Math.round(bt) + ' %' + (v.charging ? '  ⚡' : ''));
  // history chart
  const hist = (SH.tele.hist || {}), X0 = 70, Y0 = 566, CW = 884, CH = 74;
  g.textAlign = 'left'; g.fillStyle = 'rgba(232,237,246,.6)'; g.font = FONT(500, 15); g.fillText(SH.t('Last 2 minutes'), 70, 484);
  const line = (arr, col, fill) => {
    if (!Array.isArray(arr) || arr.length < 2) return; const n = arr.length;
    g.beginPath(); arr.forEach((y, i) => { const px = X0 + i / (n - 1) * CW, py = Y0 - clamp(fin(y, 0), 0, 100) / 100 * CH; i ? g.lineTo(px, py) : g.moveTo(px, py); });
    g.strokeStyle = col; g.lineWidth = 2.5; g.lineJoin = 'round'; g.stroke();
    if (fill) { g.lineTo(X0 + CW, Y0); g.lineTo(X0, Y0); g.closePath(); const gr = g.createLinearGradient(0, Y0 - CH, 0, Y0); gr.addColorStop(0, rgba(col, .32)); gr.addColorStop(1, rgba(col, 0)); g.fillStyle = gr; g.fill(); }
  };
  line(hist.gpu, b, false); line(hist.cpu, a, true);
  g.textAlign = 'right'; g.font = FONT(600, 14); g.fillStyle = a; g.fillText('● CPU', 900, 484); g.fillStyle = b; g.fillText('● GPU', 956, 484);
  // taskbar clock
  g.textAlign = 'right'; g.fillStyle = 'rgba(232,237,246,.8)'; g.font = FONT(500, 13); g.fillText(now.toLocaleTimeString(SH.i18n.locale, { hour: 'numeric', minute: '2-digit', hour12: false }), W - 16, H - 15);
  R.screenTex.needsUpdate = true;
  if (R.ledCharge) R.ledCharge.color.set(v.charging ? '#ffb14a' : '#5ad07a');
}

/* ---------- environment: a small studio "room" baked into a PMREM (soft boxes in the accent colors) ---------- */
function setEnv(R0) {
  const s = new THREE.Scene(), trash = [];
  const m = (col, k, side = THREE.FrontSide) => { const mm = new THREE.MeshBasicMaterial({ color: new THREE.Color(col).multiplyScalar(k), side }); trash.push(mm); return mm; };
  const room = new THREE.Mesh(new THREE.BoxGeometry(14, 9, 14), m('#0a1122', 1, THREE.BackSide)); room.position.y = 2.5; s.add(room); trash.push(room.geometry);
  const panel = (w, h, p, col, k) => { const g = new THREE.PlaneGeometry(w, h); trash.push(g); const me = new THREE.Mesh(g, m(col, k, THREE.DoubleSide)); me.position.set(...p); me.lookAt(0, .5, 0); s.add(me); };
  panel(6, 2.4, [0, 6.6, 2], '#ffffff', 3.2);          // key soft box above
  panel(2.2, 1.2, [4.5, 3.5, 4.5], '#ffffff', 2.2);    // front-right
  panel(1.2, 1.7, [-6.8, .35, -1.5], css('--accent'), 2.6);  // coral strip, low on the left: catches edges, not the deck
  panel(1.2, 1.7, [6.8, .35, -1.5], css('--accent2'), 2.6);  // ice strip, low on the right
  panel(9, 2.2, [0, -1.2, -6.5], '#5d74a6', .9);       // soft low panel behind: lights the back of the lid
  panel(9, 1.4, [0, -1.4, 6.5], '#2a3550', .8);        // faint floor bounce in front
  panel(12, 7, [0, -4.4, -3], '#4a5d88', 1.3);         // broad floor glow behind: the lid back reflects it
  const rt = R0.pmrem.fromScene(s, .035);
  trash.forEach(x => x.dispose());
  if (R0.envRT) R0.envRT.dispose(); R0.envRT = rt; R0.scene.environment = rt.texture;
}

/* ---------- scene construction ---------- */
function build(canvas) {
  R0tex = [];
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: !softGL, alpha: true, powerPreference: state.lite ? 'low-power' : 'high-performance' });
  const dpr = Math.min(softGL || state.lite ? 1 : 1.5, devicePixelRatio || 1);
  renderer.setPixelRatio(dpr); renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.1;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, .1, 100);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const R0 = { renderer, scene, camera, pmrem, tex: R0tex, dpr, dpr0: dpr, acc: 0, fa: 0, fn: 0, t0: performance.now(), scrT: 1, scrNew: true, scrMin: -1, scr: null };
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const accent = new THREE.Color(css('--accent')), accent2 = new THREE.Color(css('--accent2'));
  setEnv(R0);

  const keys = keyLayout();
  const std = o => new THREE.MeshStandardMaterial(o);
  const mat = {
    deck: std({ map: canvasTex(deckCanvas(keys), true, aniso), metalness: .4, roughness: .5, envMapIntensity: 1 }),
    side: std({ color: 0x3c424d, metalness: .62, roughness: .36, envMapIntensity: 1 }),
    under: std({ color: 0x191d25, metalness: .35, roughness: .62 }),
    keys: std({ color: 0x171a21, metalness: .1, roughness: .5, envMapIntensity: .7 }),
    pad: std({ color: 0x525a68, metalness: .4, roughness: .24, envMapIntensity: 1 }),
    lidOut: std({ map: canvasTex(lidCanvas(), true, aniso), metalness: .45, roughness: .42, envMapIntensity: 1.3 }),
    lidSide: std({ color: 0x3f4550, metalness: .62, roughness: .36 }),
    bezel: std({ color: 0x040507, metalness: 0, roughness: .16, envMapIntensity: .8 }),
    hinge: std({ color: 0x1b1f27, metalness: .75, roughness: .3 }),
    port: std({ color: 0x030406, metalness: .1, roughness: .85 }),
    rim: std({ color: 0x9aa4b4, metalness: 1, roughness: .3 }),
    tongue: std({ color: 0x23272f, metalness: .2, roughness: .6 }),
    rubber: std({ color: 0x0a0c10, metalness: 0, roughness: .95 }),
    pcbBase: std({ color: 0x0b1f24, metalness: .2, roughness: .6 }),
    die: std({ color: 0x0e1118, metalness: .6, roughness: .14 }),
    smd: std({ color: 0x2a2f38, metalness: .4, roughness: .5 }),
    copper: std({ color: 0xc98256, metalness: 1, roughness: .28 }),
    alu: std({ color: 0xa3acba, metalness: 1, roughness: .36 }),
    fan: std({ color: 0x343b48, metalness: .25, roughness: .42, side: THREE.DoubleSide }),
    cable: std({ color: 0x15181e, metalness: .1, roughness: .7 }),
    speaker: std({ color: 0x12151b, metalness: .2, roughness: .7 }),
  };
  R0.mat = mat;
  // the top case (deck, keys, trackpad) can turn to glass and lift for the x-ray
  const shellMats = [mat.deck, mat.side, mat.keys, mat.pad, mat.port, mat.rim, mat.tongue];
  shellMats.forEach(m => { m.transparent = false; });

  // lights: key, two low rim lights in the accent colors and a faint hemisphere (the studio environment does the fill)
  const key = new THREE.DirectionalLight(0xffffff, 1.5); key.position.set(3.5, 6.5, 4.5); scene.add(key);
  const rimA = new THREE.DirectionalLight(accent, 1.6); rimA.position.set(-5.5, .25, -4.5); scene.add(rimA);
  const rimB = new THREE.DirectionalLight(accent2, 1.6); rimB.position.set(5.5, .25, -5); scene.add(rimB);
  scene.add(new THREE.HemisphereLight(0x9ed6ff, 0x05070c, .4));
  R0.lights = { rimA, rimB };

  const laptop = new THREE.Group(); scene.add(laptop); R0.laptop = laptop;

  // soft contact shadow on the "floor" (does not float with the laptop) + a faint one behind for the lid
  const shTex = canvasTex(shadowCanvas(), false);
  const ground = new THREE.Group(); ground.position.y = -.016; scene.add(ground); R0.ground = ground;
  const shMat = new THREE.MeshBasicMaterial({ map: shTex, transparent: true, depthWrite: false, opacity: .9, toneMapped: false });
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(BW * 1.42, BD * 1.5), shMat); shadow.rotation.x = -Math.PI / 2; ground.add(shadow); R0.shadow = shadow;
  const lidShMat = new THREE.MeshBasicMaterial({ map: shTex, transparent: true, depthWrite: false, opacity: 0, toneMapped: false });
  const lidSh = new THREE.Mesh(new THREE.PlaneGeometry(BW * 1.3, 1.6), lidShMat); lidSh.rotation.x = -Math.PI / 2; lidSh.position.set(0, .001, -BD / 2 - .45); ground.add(lidSh); R0.lidSh = lidSh;

  /* ---- base: bottom cover (always solid) ---- */
  const under = new THREE.Mesh(loft(BW, BD, .17, [[0, .05], [.014, .012], [SEAM, 0]], 8), mat.under); laptop.add(under);
  // rubber feet
  const feet = merge([at(loft(2.7, .075, .037, [[-.014, .006], [-.004, 0], [0, 0]], 4, 1), 0, 0, -1.02), at(loft(2.9, .075, .037, [[-.014, .006], [-.004, 0], [0, 0]], 4, 1), 0, 0, 1.0)]);
  laptop.add(new THREE.Mesh(feet, mat.rubber));

  /* ---- top case ---- */
  const top = new THREE.Group(); laptop.add(top); R0.top = top;
  const caseMesh = new THREE.Mesh(loft(BW, BD, .17, [[SEAM, 0], [BH - .02, 0], [BH - .007, .0045], [BH, .016]], 8, 2), [mat.deck, mat.side, mat.side]); top.add(caseMesh);
  // keycaps (one merged mesh), each with a soft top chamfer
  const kGeos = keys.map(k => at(loft(k.w, k.d, .018, [[BH - .004, 0], [BH + .019, 0], [BH + .027, .0075]], 2, 2), k.x, 0, k.z));
  const keysMesh = new THREE.Mesh(merge(kGeos), mat.keys); top.add(keysMesh); R0.keysMesh = keysMesh;
  // per-key backlight: light bleeding around the caps + glowing legends, in a slow coral → ice wave
  const { glowC, legC } = kbCanvases(keys);
  const glowTex = canvasTex(glowC, false), legTex = canvasTex(legC, false, aniso);
  const kbUni = { uA: { value: accent.clone() }, uB: { value: accent2.clone() }, uT: { value: 0 }, uOn: { value: 0 } };
  const kbMat = (map, gain, white, poly) => new THREE.ShaderMaterial({
    uniforms: { ...kbUni, uMap: { value: map }, uGain: { value: gain }, uWhite: { value: white } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform sampler2D uMap; uniform vec3 uA, uB; uniform float uT, uOn, uGain, uWhite; varying vec2 vUv;
      void main(){ float m = texture2D(uMap, vUv).r; float w = .5 + .5 * sin((vUv.x * 1.15 - vUv.y * .35) * 6.2832 - uT);
        vec3 c = mix(mix(uA, uB, smoothstep(.1, .9, w)), vec3(1.), uWhite); gl_FragColor = vec4(c * m * uGain * uOn, 1.);
        #include <colorspace_fragment>
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
    polygonOffset: poly, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  const kbGlowMat = kbMat(glowTex, 1.25, 0, false), kbLegMat = kbMat(legTex, 1.15, .3, true);
  R0.kbMats = [kbGlowMat, kbLegMat]; R0.kbUni = kbUni;
  const kbPlane = (y, m) => { const p = new THREE.Mesh(new THREE.PlaneGeometry(KW + .1, KD + .1), m); p.rotation.x = -Math.PI / 2; p.position.set(KX0 + KW / 2, y, KZ0 + KD / 2); top.add(p); return p; };
  R0.kbPlanes = [kbPlane(BH + .0012, kbGlowMat), kbPlane(BH + .0276, kbLegMat)]; R0.kbPlanes[1].renderOrder = 4;
  // trackpad, slightly proud of the deck with a bright chamfer
  const pad = new THREE.Mesh(loft(TP.w, TP.d, .06, [[BH - .004, 0], [BH + .0008, 0], [BH + .0022, .006]], 6, 2), mat.pad); pad.position.set(TP.x, 0, TP.z); top.add(pad);
  // status LEDs above the keyboard (power, charging, airplane)
  const ledGeo = new THREE.CylinderGeometry(.007, .007, .004, 10);
  const ledMat = c => new THREE.MeshBasicMaterial({ color: c, toneMapped: false, transparent: true });
  const leds = [['#e9f3ff', -1.6], ['#5ad07a', -1.56], ['#3b4252', -1.52]].map(([c, x]) => { const m = new THREE.Mesh(ledGeo, ledMat(c)); m.position.set(x, BH + .001, -1.035); top.add(m); return m; });
  R0.ledCharge = leds[1].material; R0.ledMats = leds.map(l => l.material);
  // ports (left: DC-in, RJ45, HDMI, 2× USB-C, USB-A, audio; right: USB-A) and TUF-style slanted vents
  const PY = .094, holes = [], rims = [], tongues = [];
  const ringShape = (w, h, r, t) => { const s = rshape(w + t * 2, h + t * 2, r + t); s.holes.push(rshape(w, h, r)); return s; };
  const circ = r => { const s = new THREE.Shape(); s.absarc(0, 0, r, 0, TAU); return s; };
  const port = (side, u, kind) => {
    if (kind === 'dc') { holes.push(onWall(circ(.026), side, u, PY)); rims.push(onWall((() => { const s = circ(.032); s.holes.push(circ(.026)); return s; })(), side, u, PY, .002, 16)); tongues.push(onWall(circ(.009), side, u, PY, .0025)); }
    if (kind === 'rj') { holes.push(onWall(shape([[-.062, .036], [-.062, -.016], [-.03, -.036], [.03, -.036], [.062, -.016], [.062, .036]]), side, u, PY)); tongues.push(onWall(rshape(.07, .012, .003), side, u, PY + .022, .0025)); }
    if (kind === 'hdmi') { holes.push(onWall(shape([[-.06, .02], [.06, .02], [.06, -.004], [.045, -.02], [-.045, -.02], [-.06, -.004]]), side, u, PY)); tongues.push(onWall(rshape(.085, .01, .002), side, u, PY + .003, .0025)); }
    if (kind === 'c') { holes.push(onWall(rshape(.07, .022, .011), side, u, PY)); rims.push(onWall(ringShape(.07, .022, .011, .004), side, u, PY, .002, 10)); tongues.push(onWall(rshape(.046, .007, .0035), side, u, PY, .0025)); }
    if (kind === 'a') { holes.push(onWall(rshape(.11, .04, .004), side, u, PY)); tongues.push(onWall(rshape(.09, .013, .002), side, u, PY + .007, .0025)); }
    if (kind === 'jack') { holes.push(onWall(circ(.014), side, u, PY)); rims.push(onWall((() => { const s = circ(.019); s.holes.push(circ(.014)); return s; })(), side, u, PY, .002, 16)); }
  };
  [[-.36, 'dc'], [-.18, 'rj'], [.0, 'hdmi'], [.15, 'c'], [.27, 'c'], [.43, 'a'], [.62, 'jack']].forEach(([u, k]) => port('L', u, k));
  port('R', -.2, 'a');
  // side and rear exhausts: dark slanted openings with grille bars in the chassis color
  const bars = [];
  for (const side of ['L', 'R']) for (let i = 0; i < 9; i++) holes.push(onWall(para(.044, .062, .016), side, side === 'L' ? -1.06 + i * .066 : 1.06 - i * .066, .098));
  for (const s of [-1, 1]) {
    holes.push(onWall(para(.74, .07, .035), 'B', s * 1.2, .098));
    for (let i = 0; i < 22; i++) bars.push(box(.007, .066, .006, s * 1.2 - .345 + i * .033, .098, -BD / 2 - .003, 0, -.42));
  }
  top.add(new THREE.Mesh(merge(holes), mat.port), new THREE.Mesh(merge(rims), mat.rim), new THREE.Mesh(merge(tongues), mat.tongue), new THREE.Mesh(merge(bars), mat.side));
  // glass outline of the top case, only seen in x-ray
  const outline = (() => {
    const P = []; const ring = (y, ins) => { const r = rrect(BW, BD, .17, ins, 8); r.forEach((p, i) => { const q = r[(i + 1) % r.length]; P.push(p.x, y, p.z, q.x, y, q.z); }); return r; };
    ring(SEAM, 0); ring(BH - .02, 0); ring(BH, .016);
    for (const [x, z] of [[1, 1], [-1, 1], [-1, -1], [1, -1]]) { const px = x * (BW / 2 - .05), pz = z * (BD / 2 - .05); P.push(px, SEAM, pz, px, BH, pz); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    return new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: accent2.clone(), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
  })();
  outline.visible = false; top.add(outline); R0.outline = outline;

  /* ---- internals (seen in x-ray) ---- */
  const inner = new THREE.Group(); laptop.add(inner); R0.inner = inner;
  const BRD = { w: 2.3, d: 1.24, x: 0, z: -.5 };
  inner.add(new THREE.Mesh(at(loft(BRD.w, BRD.d, .05, [[SEAM, 0], [SEAM + .01, 0]], 3), BRD.x, 0, BRD.z), [std({ map: canvasTex(pcbCanvas(BRD.w, BRD.d), true, aniso), metalness: .25, roughness: .55 }), mat.pcbBase, mat.pcbBase]));
  const Y0 = SEAM + .01, parts = {}, chips = [], smd = [];
  const partMat = (col, rough = .45, metal = .3, map = null) => std({ color: map ? 0xffffff : col, roughness: rough, metalness: metal, map });
  const addPart = (id, geo, m) => { const me = new THREE.Mesh(geo, m); inner.add(me); parts[id] = me; return me; };
  // CPU: substrate + bare die + capacitors; GPU: substrate + die + 4 GDDR7 packages
  addPart('cpu', at(loft(.38, .34, .012, [[Y0, 0], [Y0 + .01, 0]], 2), -.42, 0, -.55), partMat(0x1f4a38, .5, .2));
  chips.push(at(loft(.22, .13, .006, [[Y0 + .01, 0], [Y0 + .02, 0], [Y0 + .022, .003]], 2), -.42, 0, -.56));
  for (let i = 0; i < 10; i++) smd.push(box(.018, .008, .01, -.58 + (i % 5) * .08, Y0 + .014, i < 5 ? -.405 : -.695));
  addPart('gpu', at(loft(.48, .42, .012, [[Y0, 0], [Y0 + .01, 0]], 2), .42, 0, -.55), partMat(0x1f4a38, .5, .2));
  chips.push(at(loft(.23, .21, .006, [[Y0 + .01, 0], [Y0 + .021, 0], [Y0 + .023, .003]], 2), .42, 0, -.55));
  for (const [dx, dz] of [[-.19, -.12], [-.19, .12], [.19, -.12], [.19, .12]]) chips.push(box(.075, .012, .11, .42 + dx, Y0 + .016, -.55 + dz));
  for (let i = 0; i < 8; i++) smd.push(box(.02, .008, .012, .26 + i * .045, Y0 + .014, -.31));
  // RAM: SO-DIMM connector + 16 GB module with chips and a label
  smd.push(box(.74, .03, .04, -.45, Y0 + .015, -.29));
  addPart('ram', at(loft(.7, .28, .01, [[Y0 + .022, 0], [Y0 + .028, 0]], 2), -.45, 0, -.13), [partMat(0x16362c, .5, .2, canvasTex(labelCanvas(.7, .28, '#16362c', (g, W, H) => {
    g.fillStyle = '#c9a65a'; for (let i = 0; i < 40; i++) g.fillRect(8 + i * 12.4, 2, 7, 12);
    g.fillStyle = '#e6e9ee'; g.fillRect(W * .58, H * .32, W * .36, H * .46); g.fillStyle = '#1a1f28'; g.font = FONT(700, 20); g.fillText(compTitle('ram', '16 GB DDR5'), W * .6, H * .52); g.font = FONT(500, 14); g.fillText('SODIMM 5600', W * .6, H * .7);
  }))), mat.pcbBase, mat.pcbBase]);
  for (let i = 0; i < 4; i++) chips.push(box(.075, .01, .11, -.72 + i * .085, Y0 + .033, -.12));
  // SSD: M.2 2280 with controller, NAND and a label
  smd.push(box(.05, .028, .2, .02, Y0 + .014, -.1));
  addPart('ssd', at(loft(.8, .22, .01, [[Y0 + .006, 0], [Y0 + .012, 0]], 2), .43, 0, -.1), [partMat(0x101318, .45, .3, canvasTex(labelCanvas(.8, .22, '#0f1216', (g, W, H) => {
    g.fillStyle = '#c9a65a'; for (let i = 0; i < 8; i++) g.fillRect(2, 10 + i * 13, 10, 8);
    g.fillStyle = '#e8ebf0'; g.fillRect(W * .2, H * .14, W * .7, H * .72); g.fillStyle = '#12161d'; g.font = FONT(700, 18); g.fillText(compTitle('ssd', 'NVMe SSD 1 TB'), W * .23, H * .46); g.font = FONT(500, 13); g.fillText('M.2 2280  NVMe  PCIe 4.0', W * .23, H * .72);
  }))), mat.pcbBase, mat.pcbBase]);
  // Wi-Fi card with its shield and the two antenna leads that run to the hinge
  addPart('wifi', at(loft(.3, .22, .01, [[Y0 + .004, 0], [Y0 + .01, 0]], 2), 1.06, 0, -.06), partMat(0x173a2e, .5, .2));
  chips.push(box(.18, .012, .14, 1.04, Y0 + .016, -.06));
  const cables = [];
  for (const dz of [-.03, .03]) cables.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([[1.18, Y0 + .02, -.06 + dz], [1.42, Y0 + .03, -.1 + dz], [1.68, Y0 + .03, -.3], [1.69, Y0 + .03, -1.0], [1.5, Y0 + .06, -1.18 + dz]].map(p => new THREE.Vector3(...p))), 30, .007, 5, false));
  // battery: 90 Wh pack wrapped in black film with a printed label
  addPart('battery', at(loft(2.7, .9, .04, [[SEAM, 0], [SEAM + .058, 0], [SEAM + .062, .004]], 4, 2), 0, 0, .66), [partMat(0x14181f, .6, .15, canvasTex(labelCanvas(2.7, .9, '#262d3a', (g, W, H) => {
    g.strokeStyle = 'rgba(255,255,255,.07)'; g.lineWidth = 2; for (let i = 1; i < 4; i++) { g.beginPath(); g.moveTo(W * i / 4, 6); g.lineTo(W * i / 4, H - 6); g.stroke(); }
    g.fillStyle = 'rgba(230,236,245,.85)'; g.fillRect(W * .36, H * .3, W * .28, H * .4); g.fillStyle = '#14181f'; g.font = FONT(700, 15); g.fillText('Li-ion  ' + compTitle('battery', '90 Wh').split(',')[0], W * .38, H * .48); g.font = FONT(500, 10); g.fillText('15.48 V  ·  4 cells', W * .38, H * .62);
  }))), mat.under, mat.under]);
  // speakers at the front corners
  const spk = [box(.24, .05, .36, -1.55, SEAM + .025, .7), box(.24, .05, .36, 1.55, SEAM + .025, .7)];
  inner.add(new THREE.Mesh(merge(spk), mat.speaker), new THREE.Mesh(merge(chips), mat.die), new THREE.Mesh(merge(smd), mat.smd), new THREE.Mesh(merge(cables), mat.cable));
  // cooling: two fans with many thin curved blades, fin stacks at the rear and sides, flattened copper heat pipes
  R0.fans = []; R0.fanBlur = [];
  const fins = [], pipes = [], housings = [];
  const bladesGeo = () => {
    const P = [], nB = 37, r0 = .1, r1 = .33, h = .03, seg = 5;
    for (let i = 0; i < nB; i++) {
      const a0 = i / nB * TAU, pts = [];
      for (let k = 0; k <= seg; k++) { const f = k / seg, r = r0 + (r1 - r0) * f, a = a0 + f * .6; pts.push([r * Math.cos(a), r * Math.sin(a)]); }
      for (let k = 0; k < seg; k++) { const [x0, z0] = pts[k], [x1, z1] = pts[k + 1]; P.push(x0, -h, z0, x0, h, z0, x1, -h, z1, x1, -h, z1, x0, h, z0, x1, h, z1); }
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.computeVertexNormals(); return g;
  };
  const blurTex = canvasTex((() => { const c = mk(128, 128), g = c.getContext('2d'); const gr = g.createRadialGradient(64, 64, 14, 64, 64, 62); gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(.3, 'rgba(255,255,255,.55)'); gr.addColorStop(.9, 'rgba(255,255,255,.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 128, 128); return c; })(), false);
  for (const s of [-1, 1]) {
    const cx = s * 1.2, cz = -.6, fy = SEAM + .05;
    // housing: rounded body, open ring wall, top plate with the intake hole
    housings.push(at(loft(.82, .82, .2, [[SEAM, 0], [SEAM + .006, 0]], 6), cx, 0, cz));
    const wall = new THREE.CylinderGeometry(.37, .37, .085, 40, 1, true); wall.translate(cx, SEAM + .045, cz); housings.push(wall);
    const plateS = rshape(.82, .82, .2); const hole = new THREE.Path(); hole.absarc(0, 0, .25, 0, TAU, true); plateS.holes.push(hole);
    const plate = new THREE.ShapeGeometry(plateS, 24); plate.rotateX(-Math.PI / 2); plate.translate(cx, SEAM + .09, cz); housings.push(plate);
    const bl = new THREE.Group(); bl.position.set(cx, fy, cz); inner.add(bl);
    bl.add(new THREE.Mesh(bladesGeo(), mat.fan));
    const hub = merge([new THREE.CylinderGeometry(.1, .1, .066, 28), at(new THREE.CylinderGeometry(.06, .06, .002, 24), 0, .034, 0)]); bl.add(new THREE.Mesh(hub, mat.fan));
    const ringM = new THREE.Mesh(new THREE.TorusGeometry(.085, .004, 6, 32), mat.alu); ringM.rotation.x = Math.PI / 2; ringM.position.y = .034; bl.add(ringM);
    R0.fans.push(bl);
    const fb = new THREE.Mesh(new THREE.CircleGeometry(.34, 32), new THREE.MeshBasicMaterial({ map: blurTex, color: 0x8d9ab0, transparent: true, opacity: 0, depthWrite: false })); fb.rotation.x = -Math.PI / 2; fb.position.set(cx, fy + .032, cz); inner.add(fb); R0.fanBlur.push(fb);
    // fin stacks: rear (behind the fan) and side
    for (let i = 0; i < 30; i++) fins.push(box(.005, .07, .13, cx - .31 + i * .0214, SEAM + .045, -1.12));
    for (let i = 0; i < 20; i++) fins.push(box(.13, .07, .005, s * 1.62, SEAM + .045, cz - .26 + i * .027));
    // heat pipes: die → rear fins, die → side fins
    const die = s < 0 ? [-.42, -.55] : [.42, -.55], py = SEAM + .05;
    const pipe = pts => { const g = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map(([x, z]) => new THREE.Vector3(x, 0, z))), 40, .021, 8, false); g.scale(1, .5, 1); g.translate(0, py, 0); pipes.push(g); };
    pipe([[die[0] + s * .13, die[1] - .08], [die[0] + s * .38, die[1] - .3], [cx - s * .05, -1.0], [cx + s * .25, -1.07]]);
    pipe([[die[0] + s * .13, die[1] + .05], [die[0] + s * .42, die[1] + .2], [s * 1.25, -.28], [s * 1.6, -.4], [s * 1.62, -.7]]);
  }
  { const g = new THREE.TubeGeometry(new THREE.CatmullRomCurve3([[-.42, -.74], [-.1, -.8], [.1, -.8], [.42, -.79]].map(([x, z]) => new THREE.Vector3(x, 0, z))), 30, .021, 8, false); g.scale(1, .5, 1); g.translate(0, SEAM + .05, 0); pipes.push(g); }
  inner.add(new THREE.Mesh(merge(housings), mat.fan), new THREE.Mesh(merge(fins), mat.alu), new THREE.Mesh(merge(pipes), mat.copper));
  inner.visible = false;

  /* ---- hinge and lid ---- */
  const hingeG = merge([(() => { const g = new THREE.CylinderGeometry(.046, .046, 2.86, 24); g.rotateZ(Math.PI / 2); return g; })(),
    ...[-1, 1].map(s => { const g = new THREE.CylinderGeometry(.052, .052, .3, 24); g.rotateZ(Math.PI / 2); g.translate(s * 1.36, 0, 0); return g; })]);
  const hinge = new THREE.Mesh(hingeG, mat.hinge); hinge.position.set(0, PIV.y - .012, PIV.z); laptop.add(hinge);
  const lidPivot = new THREE.Group(); lidPivot.position.set(0, PIV.y, PIV.z); laptop.add(lidPivot); R0.lidPivot = lidPivot;
  const lid = new THREE.Mesh(loft(BW, LD, .15, [[0, .005], [.007, 0], [LT - .014, 0], [LT, .017]], 8), [mat.lidOut, mat.lidSide, mat.lidSide]); lid.position.z = LD / 2; lidPivot.add(lid);
  const bezel = new THREE.Mesh(new THREE.ShapeGeometry(rshape(BW - .03, LD - .03, .135), 8), mat.bezel); bezel.rotation.x = Math.PI / 2; bezel.position.set(0, -.0008, LD / 2); lidPivot.add(bezel);
  // live screen
  const scrC = mk(1024, 640); R0.scr = { c: scrC, g: scrC.getContext('2d'), bg: screenBG(1024, 640), a: css('--accent'), b: css('--accent2') };
  const screenTex = canvasTex(scrC, true, 1); screenTex.generateMipmaps = false; screenTex.minFilter = THREE.LinearFilter; R0.screenTex = screenTex;
  mat.screen = new THREE.MeshBasicMaterial({ map: screenTex, toneMapped: false, color: 0x000000 });
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(SCR.w, SCR.h), mat.screen); screen.rotation.x = Math.PI / 2; screen.position.set(0, -.0016, SCR.z); lidPivot.add(screen); R0.screen = screen;
  // webcam
  const cam = new THREE.Mesh(merge([new THREE.CircleGeometry(.014, 20), at(new THREE.CircleGeometry(.006, 16), 0, 0, .0004)]), std({ color: 0x0b0e14, metalness: .3, roughness: .1 }));
  cam.rotation.x = Math.PI / 2; cam.position.set(0, -.0018, LD - .038); lidPivot.add(cam);

  /* ---- highlights: soft glow + bright frame, seen through the glass ---- */
  const hTex = canvasTex(haloCanvas(), false);
  const hMat = () => new THREE.MeshBasicMaterial({ map: hTex, color: accent.clone(), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, toneMapped: false });
  const hPlane = (parent, w, d, x, y, z, rx = -Math.PI / 2, m = hMat()) => { const p = new THREE.Mesh(new THREE.PlaneGeometry(w, d), m); p.rotation.x = rx; p.position.set(x, y, z); p.renderOrder = 10; p.visible = false; parent.add(p); return p; };
  for (const id of ['cpu', 'gpu', 'ram', 'ssd', 'wifi', 'battery']) {
    const sp = SPOTS[id], p = hPlane(inner, sp.size[0] * 1.3 + .06, sp.size[2] * 1.3 + .06, sp.pos[0], sp.pos[1] + .03, sp.pos[2]);
    const pm = parts[id].material; const m0 = Array.isArray(pm) ? pm[0] : pm;
    halo[id] = { mats: [p.material], meshes: [p], k: id === 'battery' ? .55 : 1, s: new Spring(0, 90, 15), part: m0 };
  }
  { const m = hMat(); const ms = [-1, 1].map(s => hPlane(top, 1.5, .2, s * .76, BH + .004, -1.035, -Math.PI / 2, m)); halo.audio = { mats: [m], meshes: ms, k: 1.6, s: new Spring(0, 90, 15) }; }
  { const p = hPlane(lidPivot, SCR.w * 1.2, SCR.h * 1.22, 0, -.004, SCR.z, Math.PI / 2); halo.display = { mats: [p.material], meshes: [p], k: .7, s: new Spring(0, 90, 15) }; }
  { const p = hPlane(lidPivot, SCR.w * 1.1, .2, 0, -.004, SCR.z - SCR.h / 2 + .067, Math.PI / 2); halo.sys = { mats: [p.material], meshes: [p], k: .9, s: new Spring(0, 90, 15) }; }

  R0.shellMats = shellMats;
  return R0;
}
function refreshLook() {
  if (!R) return;
  const a = new THREE.Color(css('--accent')), b = new THREE.Color(css('--accent2'));
  R.lights.rimA.color.copy(a); R.lights.rimB.color.copy(b); R.outline.material.color.copy(b);
  R.kbUni.uA.value.copy(a); R.kbUni.uB.value.copy(b); R.kbMats.forEach(m => { m.uniforms.uA.value.copy(a); m.uniforms.uB.value.copy(b); });
  Object.values(halo).forEach(h => h.mats.forEach(m => m.color.copy(a)));
  R.scr.bg = screenBG(R.scr.c.width, R.scr.c.height); R.scr.a = css('--accent'); R.scr.b = css('--accent2'); R.scrNew = true;
  if (R.onLook) R.onLook(a, b);
  setEnv(R); dirty = true;
}

/* ---------- camera and interaction ---------- */
let dirty = true;
function focus(id) {
  clearTimeout(leaveT); if (focused === id) return; focused = id;
  $$('.m3-row', root).forEach(r => r.classList.toggle('on', r.dataset.comp === id));
  const sp = id && SP[id];
  Object.entries(halo).forEach(([k, h]) => { h.s.t = k === id ? 1 : 0; });
  if (!sp) { S.az.t = POSE.az; S.el.t = POSE.el; S.dist.t = POSE.dist; [S.tx.t, S.ty.t, S.tz.t] = POSE.target; S.shell.t = 1; return; }
  S.az.t = sp.az; S.el.t = sp.el; S.dist.t = sp.dist; S.offAz.t = 0; S.offEl.t = 0;
  if (sp.screen && R) { const w = new THREE.Vector3(); R.screen.getWorldPosition(w); S.tx.t = w.x; S.ty.t = w.y; S.tz.t = w.z; }
  else if (sp.tg) [S.tx.t, S.ty.t, S.tz.t] = sp.tg;
  else { S.tx.t = sp.mirror ? 0 : sp.pos[0]; S.ty.t = .1; S.tz.t = sp.pos[2]; }
  S.shell.t = sp.inside ? 0 : 1;
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
  if (performance.now() - lastT > 80) { vAz = 0; vEl = 0; }
  S.offAz.vel = vAz * .9; S.offAz.t = S.offAz.v + vAz * .22; S.offEl.vel = vEl * .6; S.offEl.t = Math.max(-.3, Math.min(.85, S.offEl.v + vEl * .1));
  clearTimeout(idleT); idleT = setTimeout(() => { S.offAz.t = 0; S.offEl.t = 0; }, 1700);
}
function onWheel(e) { e.preventDefault(); S.zoom.t = Math.max(.68, Math.min(1.35, S.zoom.t * Math.exp(e.deltaY * .0011))); dirty = true; }

function resize() {
  if (!R || !root) return; const w = root.clientWidth, h = root.clientHeight; if (!w || !h) return;
  R.w = w; R.h = h; R.renderer.setSize(w, h, false); R.camera.aspect = w / h;
  const list = $('.m3-list', root); const shift = list ? (list.offsetWidth + 16) / 2 : 0;
  R.camera.setViewOffset(w, h, -shift, 0, w, h); R.camera.updateProjectionMatrix();
  R.fit = Math.max(.85, Math.min(1.15, 1.1 / Math.max(.4, (w - shift * 2) / h))); dirty = true;
}
/* if the GPU cannot keep up (integrated graphics), render fewer pixels: measured, never read from the layout */
function adapt(dt) {
  if (SH.homeAnimating || R.lowFps || performance.now() - R.t0 < 3000) return;
  R.fa += dt; R.fn++; if (R.fn < 90) return;
  const avg = R.fa / R.fn; R.fa = R.fn = 0;
  if (avg <= 1 / 44) return;
  if (R.dpr > .75) { R.dpr = Math.max(.75, R.dpr - .25); R.renderer.setPixelRatio(R.dpr); if (R.w) R.renderer.setSize(R.w, R.h, false); }
  else R.lowFps = true;
}

/* on battery: render at 1x and, below, at most 30 fps; the idle floating stops (the scene only renders when it changes) */
SH.on('power', () => {
  if (!R) return; const d = state.lite ? Math.min(R.dpr, 1) : Math.min(R.dpr0, devicePixelRatio || 1, 1.5);
  if (d !== R.dpr) { R.dpr = d; R.renderer.setPixelRatio(d); if (R.w) R.renderer.setSize(R.w, R.h, false); }
  R.lowFps = false; R.fa = R.fn = 0; dirty = true;
});
function frame(dt, t) {
  if (!mounted || !R || (state.view !== 'home' && !SH.homeAnimating)) return;
  const lite = state.lite, moving = SH.effInt() !== 'min' && !lite;
  let active = dragging || moving;
  let springs = false;
  for (const k in S) { const s = S[k]; const before = s.v; s.step(dt); if (Math.abs(s.v - before) > 1e-5) springs = true; }
  for (const k in halo) { const h = halo[k]; const b = h.s.v; h.s.step(dt); if (Math.abs(h.s.v - b) > 1e-5) springs = true; }
  active = active || springs;
  // the screen dashboard is redrawn only when new telemetry arrives or the clock changes (never every frame)
  R.scrT += dt;
  if (R.scrT > .25 && S.screen.v > .02) { const m = new Date().getMinutes(); if (R.scrNew || m !== R.scrMin) { R.scrT = 0; R.scrNew = false; R.scrMin = m; drawScreen(); dirty = true; } }
  if (!active && !dirty) return;
  if (moving) adapt(dt);
  /* the slow floating (and the fans) need 30 fps, not 60; the frame time they skip is added to the next one */
  R.acc += dt; const still = !dragging && !springs && !dirty;
  if (R.acc < (still || lite ? .031 : 0)) return;
  const dtr = R.acc; R.acc = 0;
  if (R.lowFps && !dragging && !springs && !dirty && (R.skip = !R.skip)) return;
  dirty = false;
  // orbit camera around the target
  const az = S.az.v + S.offAz.v, el = clamp(S.el.v + S.offEl.v, .05, 1.35), d = S.dist.v * S.zoom.v * (R.fit || 1);
  const c = R.camera; c.position.set(S.tx.v + d * Math.sin(az) * Math.cos(el), S.ty.v + d * Math.sin(el), S.tz.v + d * Math.cos(az) * Math.cos(el));
  c.lookAt(S.tx.v, S.ty.v, S.tz.v);
  // lid, screen, keyboard light
  R.lidPivot.rotation.x = S.lid.v;
  const open = clamp(S.lid.v / OPEN, 0, 1.1);
  R.lidSh.material.opacity = .5 * clamp(open, 0, 1);
  const on = clamp(S.screen.v, 0, 1); R.mat.screen.color.setScalar(on);
  // x-ray: the top case lifts and turns to glass, the internals show
  const sh = clamp(S.shell.v, 0, 1.05), op = .1 + .9 * clamp(sh, 0, 1), xr = 1 - clamp(sh, 0, 1);
  R.top.position.y = LIFT * xr;
  const glassy = op < .995;
  R.shellMats.forEach(m => { m.opacity = m === R.mat.keys || m === R.mat.pad ? op * op : op; if (m.transparent !== glassy) { m.transparent = glassy; m.needsUpdate = true; } m.depthWrite = !glassy; });
  R.ledMats.forEach(m => { m.opacity = op; });
  R.inner.visible = R.tower || xr > .015;
  R.outline.visible = xr > .015; R.outline.material.opacity = .55 * xr;
  R.kbUni.uOn.value = clamp(S.kb.v, 0, 1.2) * op * op * op; R.kbPlanes.forEach(p => { p.visible = R.kbUni.uOn.value > .004; });
  R.keysMesh.visible = op > .16;
  // highlights, with a soft pulse
  const pulse = moving ? .8 + .2 * Math.sin(t / 260) : 1;
  for (const k in halo) {
    const h = halo[k], v = Math.max(0, h.s.v), vis = v > .003;
    h.meshes.forEach(m => { m.visible = vis; }); h.mats.forEach(m => { m.opacity = h.k * v * pulse; });
    if (h.part && h.part.emissive) h.part.emissive.copy(h.mats[0].color).multiplyScalar(.45 * v);
  }
  // floating, keyboard wave and fans
  if (moving) {
    const fy = Math.sin(t / 1500) * .035; R.laptop.position.y = fy;
    if (!dragging && !focused) R.laptop.rotation.y = Math.sin(t / 3200) * .025;
    R.ground.rotation.y = R.laptop.rotation.y;
    R.shadow.material.opacity = .9 - fy * 3; R.shadow.scale.setScalar(1 + fy * 1.2);
    R.kbMats.forEach(m => { m.uniforms.uT.value = t / 1000 * .55; });
    if (R.inner.visible) {
      /* Windows may not report fan speed (null): then the fans follow the load. fanCpu is rpm, fanGpu is percent */
      const v = SH.tele.v || {};
      const rpmOf = (f, load) => f != null ? f : 1500 + fin(load, 0) * 32;
      const rpm = [rpmOf(fin(v.fanCpu), v.cpu), rpmOf(fin(v.fanGpu) != null ? fin(v.fanGpu) * 55 : null, v.gpu)];
      R.fans.forEach((f, i) => { const r = clamp(rpm[i % 2], 0, 7000); f.rotation.y += (i ? -1 : 1) * dtr * r / 6000 * 1.5 * TAU; R.fanBlur[i].material.opacity = .32 * clamp(r / 5000, 0, 1) * xr; });
    }
  }
  R.renderer.render(R.scene, c);
}

/* ---------- desktop tower: a custom ATX tower (glass side and front, vertical GPU, AIO cooler) and its monitor ----------
   Same interface as build(): it returns an R with the fields frame() and the rest of the view use (the laptop-only ones are
   inert dummies). Scene units: 1 = 10 cm. x: side to side (the glass is the -x side), y: up, z: front (+) to rear (-). */
const TW = { w: 2.1, h: 4.5, d: 4.4 };
const POSE_T = { az: -.78, el: .17, dist: 16.2, target: [2.3, 2.3, .4] };
const SPOTS_T = {
  cpu: { tg: [.7, 2.7, -1], az: -1.05, el: .12, dist: 6.6 },
  gpu: { tg: [-.55, 1.5, -.5], az: -.95, el: .1, dist: 7.6 },
  ram: { tg: [.8, 2.7, -.05], az: -1.0, el: .1, dist: 6.4 },
  ssd: { tg: [.9, 2.2, -1.05], az: -1.0, el: .15, dist: 5.8 },
  wifi: { tg: [.9, 3.1, -1.75], az: -1.05, el: .2, dist: 6.2 },
  audio: { tg: [.9, 2.55, -1.75], az: -1.05, el: .15, dist: 6.2 },
  display: { screen: true, az: -.18, el: .1, dist: 9.4 },
  sys: { screen: true, az: -.35, el: .16, dist: 9.4 },
};
function fanBlades(nB = 9, r0 = .13, r1 = .56, sweep = .9) {
  const P = [], seg = 5;
  for (let i = 0; i < nB; i++) {
    const a0 = i / nB * TAU, pts = [];
    for (let k = 0; k <= seg; k++) { const f = k / seg, r = r0 + (r1 - r0) * f, a = a0 + f * sweep, wd = .5 * Math.sin(Math.PI * (.1 + .8 * f)) + .05; pts.push([r * Math.cos(a), r * Math.sin(a), r * Math.cos(a + wd), r * Math.sin(a + wd)]); }
    for (let k = 0; k < seg; k++) { const p = pts[k], q = pts[k + 1]; P.push(p[0], 0, p[1], p[2], 0, p[3], q[0], 0, q[1], q[0], 0, q[1], p[2], 0, p[3], q[2], 0, q[3]); }
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.computeVertexNormals(); return g;
}
function buildTower(canvas) {
  R0tex = [];
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: !softGL, alpha: true, powerPreference: state.lite ? 'low-power' : 'high-performance' });
  const dpr = Math.min(softGL || state.lite ? 1 : 1.5, devicePixelRatio || 1);
  renderer.setPixelRatio(dpr); renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.1;
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(30, 1, .1, 100), pmrem = new THREE.PMREMGenerator(renderer);
  const R0 = { renderer, scene, camera, pmrem, tex: R0tex, dpr, dpr0: dpr, acc: 0, fa: 0, fn: 0, t0: performance.now(), scrT: 1, scrNew: true, scrMin: -1, scr: null, tower: true };
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const accent = new THREE.Color(css('--accent')), accent2 = new THREE.Color(css('--accent2'));
  setEnv(R0);
  const std = o => new THREE.MeshStandardMaterial(o);
  const basic = c => new THREE.MeshBasicMaterial({ color: c, toneMapped: false });
  const mat = {
    case: std({ color: 0x1a1e26, metalness: .75, roughness: .42 }),
    shroud: std({ color: 0x232833, metalness: .6, roughness: .45 }),
    glass: std({ color: 0xaec2dc, metalness: 0, roughness: .05, transparent: true, opacity: .09, envMapIntensity: 1.8, depthWrite: false }),
    pcbBase: std({ color: 0x0b1f24, metalness: .2, roughness: .6 }),
    sink: std({ color: 0x2c323e, metalness: .85, roughness: .33 }),
    alu: std({ color: 0xa3acba, metalness: 1, roughness: .36 }),
    card: std({ color: 0x161a22, metalness: .55, roughness: .38 }),
    fan: std({ color: 0x3a4250, metalness: .3, roughness: .4, side: THREE.DoubleSide }),
    tube: std({ color: 0x0f1217, metalness: .1, roughness: .55 }),
    dimm: std({ color: 0x20252f, metalness: .7, roughness: .35 }),
    bezel: std({ color: 0x07080b, metalness: .2, roughness: .3 }),
    rgbA: basic(accent.clone()), rgbB: basic(accent2.clone()),
  };
  R0.mat = mat;
  const key = new THREE.DirectionalLight(0xffffff, 1.5); key.position.set(-3.5, 6.5, 6.5); scene.add(key);
  const rimA = new THREE.DirectionalLight(accent, 1.6); rimA.position.set(5.5, .25, -4.5); scene.add(rimA);
  const rimB = new THREE.DirectionalLight(accent2, 1.6); rimB.position.set(-5.5, .25, -5); scene.add(rimB);
  scene.add(new THREE.HemisphereLight(0x9ed6ff, 0x05070c, .4));
  R0.lights = { rimA, rimB };

  const rig = new THREE.Group(); scene.add(rig); R0.laptop = rig;               // everything that floats together
  const ground = new THREE.Group(); ground.position.y = -.016; scene.add(ground); R0.ground = ground;
  const shTex = canvasTex(shadowCanvas(), false);
  const shMat = new THREE.MeshBasicMaterial({ map: shTex, transparent: true, depthWrite: false, opacity: .9, toneMapped: false });
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(12.5, 7), shMat); shadow.rotation.x = -Math.PI / 2; shadow.position.x = 1.9; ground.add(shadow); R0.shadow = shadow;
  R0.lidSh = new THREE.Mesh(new THREE.PlaneGeometry(.01, .01), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0 }));
  // laptop-only pieces frame() still touches
  R0.lidPivot = new THREE.Object3D(); R0.top = new THREE.Group(); R0.shellMats = []; R0.ledMats = []; R0.kbMats = []; R0.kbPlanes = []; R0.keysMesh = { visible: true };
  R0.kbUni = { uA: { value: new THREE.Color() }, uB: { value: new THREE.Color() }, uT: { value: 0 }, uOn: { value: 0 } };
  R0.outline = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: accent2.clone(), transparent: true, opacity: 0 })); R0.outline.visible = false;

  /* ---- the case: dark steel frame with a tempered-glass side and front ---- */
  const T = new THREE.Group(); T.position.y = .14; rig.add(T);
  const { w, h, d } = TW, hw = w / 2, hd = d / 2;
  const shell = [box(w, .08, d, 0, .04, 0), box(w, .08, d, 0, h - .04, 0), box(w, h, .06, 0, h / 2, -hd + .03), box(.06, h, d, hw - .03, h / 2, 0),
    box(.07, h, .07, -hw + .035, h / 2, hd - .035), box(.07, h, .07, -hw + .035, h / 2, -hd + .035), box(.07, h, .07, hw - .035, h / 2, hd - .035), box(w, .07, .07, 0, h - .035, hd - .035), box(w, .07, .07, 0, .035, hd - .035),
    ...[[-1, -1], [-1, 1], [1, -1], [1, 1]].map(([a, b]) => box(.2, .14, .2, a * (hw - .25), -.07, b * (hd - .25)))];
  T.add(new THREE.Mesh(merge(shell), mat.case));
  const glassL = new THREE.Mesh(new THREE.PlaneGeometry(d - .14, h - .14), mat.glass); glassL.rotation.y = -Math.PI / 2; glassL.position.set(-hw + .012, h / 2, 0); glassL.renderOrder = 8; T.add(glassL);
  const glassF = new THREE.Mesh(new THREE.PlaneGeometry(w - .14, h - .14), mat.glass); glassF.position.set(0, h / 2, hd - .012); glassF.renderOrder = 8; T.add(glassF);
  // RGB trim along the front edge of the glass
  T.add(new THREE.Mesh(box(.02, h - .3, .02, -hw + .06, h / 2, hd - .06), mat.rgbA));

  const inner = new THREE.Group(); T.add(inner); R0.inner = inner;
  // power supply shroud with a lit edge
  inner.add(new THREE.Mesh(merge([box(w - .12, .78, 3.5, -.02, .47, -.4), box(w - .3, .03, 3.2, -.02, .87, -.4)]), mat.shroud));
  inner.add(new THREE.Mesh(box(.02, .02, 3.0, -hw + .1, .88, -.5), mat.rgbB));
  // motherboard on the right wall, facing the glass
  const BX = .955, BZ = -.475, BY = 2.2;
  inner.add(new THREE.Mesh(box(.04, 2.44, 3.05, BX + .02, BY, BZ), mat.pcbBase));
  const pcbTex = canvasTex(pcbCanvas(3.05, 2.44, (ctxRef && ctxRef.PC && ctxRef.PC.model) || ''), true, aniso);
  const pcb = new THREE.Mesh(new THREE.PlaneGeometry(3.05, 2.44), std({ map: pcbTex, metalness: .25, roughness: .55 })); pcb.rotation.y = -Math.PI / 2; pcb.position.set(BX - .001, BY, BZ); inner.add(pcb);
  // VRM / I-O cover at the rear, heatsink along the top, chipset plate
  const sink = [box(.26, 1.3, .5, BX - .13, 2.78, -1.72), box(.22, .2, 1.5, BX - .11, 3.31, -1.1), box(.12, .5, .5, BX - .06, 1.6, .15)];
  inner.add(new THREE.Mesh(merge(sink), mat.sink));
  const io = []; for (let i = 0; i < 9; i++) io.push(box(.012, .03, .46, BX - .265, 2.28 + i * .12, -1.72));
  inner.add(new THREE.Mesh(merge(io), mat.alu));
  // M.2 SSD under its heatsink
  inner.add(new THREE.Mesh(box(.09, .17, .95, BX - .05, 2.15, -1.05), mat.alu));
  inner.add(new THREE.Mesh(box(.02, .1, .8, BX - .1, 2.15, -1.05), mat.sink));
  // RAM: two modules with a lit top edge, two empty slots
  const dimmG = [], rgbG = [];
  for (const z of [-.14, .1]) { dimmG.push(box(.32, 1.33, .09, BX - .16, 2.7, z)); rgbG.push(box(.3, .02, .06, BX - .17, 3.37, z)); rgbG.push(box(.015, 1.2, .03, BX - .325, 2.7, z)); }
  for (const z of [-.38, .34]) dimmG.push(box(.02, 1.33, .09, BX - .02, 2.7, z));
  inner.add(new THREE.Mesh(merge(dimmG), mat.dimm), new THREE.Mesh(merge(rgbG), mat.rgbA));
  // AIO: pump head on the CPU and two tubes to the front radiator
  const pumpG = new THREE.CylinderGeometry(.38, .38, .34, 40); pumpG.rotateZ(Math.PI / 2); pumpG.translate(.75, 2.72, -1);
  inner.add(new THREE.Mesh(pumpG, mat.card));
  const cap = new THREE.CircleGeometry(.3, 40); cap.rotateY(-Math.PI / 2); cap.translate(.575, 2.72, -1); inner.add(new THREE.Mesh(cap, mat.rgbB));
  const capDark = new THREE.CircleGeometry(.2, 32); capDark.rotateY(-Math.PI / 2); capDark.translate(.572, 2.72, -1); inner.add(new THREE.Mesh(capDark, std({ color: 0x0b0e14, metalness: .4, roughness: .2 })));
  const tube = pts => new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map(p => new THREE.Vector3(...p))), 50, .052, 8, false);
  inner.add(new THREE.Mesh(merge([tube([[.6, 2.95, -.8], [.35, 3.4, -.3], [.12, 3.8, .9], [.3, 4.12, 1.45]]), tube([[.6, 2.5, -.8], [.15, 3.1, -.2], [-.1, 3.7, .9], [-.2, 4.12, 1.45]])]), mat.tube));
  // front radiator
  inner.add(new THREE.Mesh(box(1.2, 3.55, .3, 0, 2.58, 1.53), mat.sink));
  // GPU mounted vertically near the glass: shroud, lit strip, backplate edge
  inner.add(new THREE.Mesh(merge([box(.4, 1.1, 2.8, -.55, 1.5, -.5), box(.05, 1.3, .07, -.55, 1.5, -1.95)]), mat.card));
  inner.add(new THREE.Mesh(box(.015, .03, 2.7, -.755, 2.03, -.5), mat.rgbA));
  inner.add(new THREE.Mesh(box(.02, .26, 1.1, -.76, 1.0, -1.35), mat.alu));
  // fans: static ring + spinning blades. Facing: 'x' = toward the glass (-x), 'z' = toward the front (+z), 'r' = toward the rear
  const bladeG = fanBlades(), hubG = new THREE.CylinderGeometry(.15, .15, .06, 24), ringG = new THREE.TorusGeometry(.6, .018, 6, 48);
  const blurTex = canvasTex((() => { const c = mk(128, 128), g = c.getContext('2d'); const gr = g.createRadialGradient(64, 64, 14, 64, 64, 62); gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(.3, 'rgba(255,255,255,.5)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 128, 128); return c; })(), false);
  R0.fans = []; R0.fanBlur = [];
  const fan = (x, y, z, face, rgb, r = 1) => {
    const wr = new THREE.Group(); wr.position.set(x, y, z); wr.scale.setScalar(r);
    if (face === 'x') wr.rotation.z = Math.PI / 2; else if (face === 'z') wr.rotation.x = Math.PI / 2; else wr.rotation.x = -Math.PI / 2;
    const sp = new THREE.Group(); sp.add(new THREE.Mesh(bladeG, mat.fan), new THREE.Mesh(hubG, mat.card)); wr.add(sp);
    const ring = new THREE.Mesh(ringG, rgb); ring.rotation.x = Math.PI / 2; wr.add(ring);
    const hubCap = new THREE.Mesh(new THREE.CircleGeometry(.07, 20), rgb); hubCap.rotation.x = -Math.PI / 2; hubCap.position.y = .032; wr.add(hubCap);
    const fb = new THREE.Mesh(new THREE.CircleGeometry(.58, 32), new THREE.MeshBasicMaterial({ map: blurTex, color: 0x8d9ab0, transparent: true, opacity: 0, depthWrite: false })); fb.rotation.x = -Math.PI / 2; fb.position.y = .04; wr.add(fb);
    inner.add(wr); R0.fans.push(sp); R0.fanBlur.push(fb);
  };
  fan(-.775, 1.5, -1.2, 'x', mat.rgbA, .78); fan(-.775, 1.5, -.2, 'x', mat.rgbA, .78);   // GPU
  for (const y of [1.4, 2.58, 3.76]) fan(0, y, 1.83, 'z', mat.rgbB, 1);                  // radiator, front
  fan(.25, 3.55, -1.98, 'r', mat.rgbB, .9);                                                // rear exhaust

  /* ---- the monitor: its screen carries the live dashboard ---- */
  const M = new THREE.Group(); M.position.set(4.6, 0, 1.7); M.rotation.y = -.3; rig.add(M);
  const MW = 5.2, MH = 3.25, MY = 2.5;
  M.add(new THREE.Mesh(merge([box(MW + .16, MH + .16, .12, 0, MY, 0), box(.4, 1.05, .1, 0, .6, -.12), box(1.8, .05, 1.0, 0, .025, -.08)]), mat.bezel));
  const scrC = mk(1024, 640); R0.scr = { c: scrC, g: scrC.getContext('2d'), bg: screenBG(1024, 640), a: css('--accent'), b: css('--accent2') };
  const screenTex = canvasTex(scrC, true, 1); screenTex.generateMipmaps = false; screenTex.minFilter = THREE.LinearFilter; R0.screenTex = screenTex;
  mat.screen = new THREE.MeshBasicMaterial({ map: screenTex, toneMapped: false, color: 0x000000 });
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(MW, MH), mat.screen); screen.position.set(0, MY, .062); M.add(screen); R0.screen = screen;

  /* ---- highlights: soft glow + bright frame ---- */
  const hTex = canvasTex(haloCanvas(), false);
  const hMat = () => new THREE.MeshBasicMaterial({ map: hTex, color: accent.clone(), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, toneMapped: false });
  const hPlane = (parent, pw, ph, x, y, z, ry = -Math.PI / 2) => { const p = new THREE.Mesh(new THREE.PlaneGeometry(pw, ph), hMat()); p.rotation.y = ry; p.position.set(x, y, z); p.renderOrder = 10; p.visible = false; parent.add(p); return p; };
  const hs = (id, p, k = 1) => { halo[id] = { mats: [p.material], meshes: [p], k, s: new Spring(0, 90, 15) }; };
  hs('cpu', hPlane(inner, 1.15, 1.15, .5, 2.72, -1)); hs('gpu', hPlane(inner, 3.2, 1.5, -.78, 1.5, -.5)); hs('ram', hPlane(inner, .75, 1.7, .6, 2.7, 0)); hs('ssd', hPlane(inner, 1.3, .42, .86, 2.15, -1.05));
  hs('wifi', hPlane(inner, .62, .36, .7, 3.1, -1.72)); hs('audio', hPlane(inner, .62, .36, .7, 2.5, -1.72));
  hs('display', hPlane(M, MW * 1.08, MH * 1.1, 0, MY, .07, 0), .7); hs('sys', hPlane(M, MW * .92, .4, 0, MY - MH / 2 + .22, .07, 0), .9);
  R0.onLook = (a, b) => { mat.rgbA.color.copy(a); mat.rgbB.color.copy(b); };
  return R0;
}

/* ---------- surrounding UI ---------- */
function listHTML(PC) {
  return `<div class="pan m3-list"><h4>${SH.t('Components')}</h4>${PC.components.map(c => `<button class="m3-row" data-comp="${c.id}"><span class="ci">${ic(c.id === 'sys' ? 'windows' : c.id)}</span><span class="ct"><b>${esc(c.name)}</b><span>${esc(c.title)}</span></span></button>`).join('')}</div>`;
}
function fallbackTowerSVG() {
  return `<svg class="m3-fallback" viewBox="0 0 420 300" aria-label="${SH.t('Tower')}">
    <defs><linearGradient id="m3t" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2a3550"/><stop offset="1" stop-color="#1a2236"/></linearGradient>
    <linearGradient id="m3m" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0d1a30"/><stop offset="1" style="stop-color:color-mix(in oklab,var(--accent) 30%,#0d1a30)"/></linearGradient>
    <radialGradient id="m3th"><stop offset="0" stop-color="#000" stop-opacity=".6"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient></defs>
    <ellipse cx="220" cy="276" rx="200" ry="18" fill="url(#m3th)"/>
    <rect x="40" y="30" width="110" height="236" rx="8" fill="url(#m3t)" stroke="#3a4766"/>
    ${[78, 130, 182].map(y => `<circle cx="95" cy="${y}" r="21" fill="none" style="stroke:var(--accent2)" stroke-opacity=".7"/><circle cx="95" cy="${y}" r="5" style="fill:var(--accent)"/>`).join('')}
    <rect x="196" y="70" width="200" height="124" rx="6" fill="#0c111e" stroke="#3a4766"/><rect x="202" y="76" width="188" height="112" rx="3" fill="url(#m3m)"/>
    <ellipse cx="296" cy="132" rx="60" ry="20" fill="none" style="stroke:var(--accent2)" stroke-opacity=".5" transform="rotate(-8 296 132)"/><circle cx="296" cy="132" r="9" style="fill:var(--accent)"/>
    <rect x="288" y="194" width="16" height="44" fill="#1e273c"/><rect x="250" y="238" width="92" height="8" rx="3" fill="#263049"/></svg>`;
}
function fallbackSVG() {
  return `<svg class="m3-fallback" viewBox="0 0 420 300" aria-label="${SH.t('Laptop')}">
    <defs><linearGradient id="m3l" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2a3550"/><stop offset="1" stop-color="#1a2236"/></linearGradient>
    <linearGradient id="m3s" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0d1a30"/><stop offset="1" style="stop-color:color-mix(in oklab,var(--accent) 30%,#0d1a30)"/></linearGradient>
    <radialGradient id="m3sh"><stop offset="0" stop-color="#000" stop-opacity=".6"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient></defs>
    <ellipse cx="210" cy="276" rx="210" ry="22" fill="url(#m3sh)"/>
    <polygon points="76,6 344,6 354,198 66,198" fill="url(#m3l)" stroke="#3a4766"/><polygon points="92,22 328,22 336,186 84,186" fill="url(#m3s)"/>
    <ellipse cx="210" cy="104" rx="90" ry="28" fill="none" style="stroke:var(--accent2)" stroke-opacity=".5" transform="rotate(-8 210 104)"/><circle cx="210" cy="104" r="13" style="fill:var(--accent)"/>
    <polygon points="66,198 354,198 402,262 18,262" fill="#1e273c" stroke="#3a4766"/><polygon points="18,262 402,262 398,274 22,274" fill="#121828"/>
    <polygon points="110,206 310,206 330,238 90,238" fill="#0c111e"/><polygon points="168,242 252,242 256,257 164,257" fill="#263049"/></svg>`;
}
function release() {
  if (!R) return;
  R.scene.traverse(o => {
    if (o.geometry) o.geometry.dispose();
    const ms = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
    ms.forEach(m => { for (const k in m) { const v = m[k]; if (v && v.isTexture) v.dispose(); } m.dispose(); });
  });
  R.tex.forEach(t => t.dispose()); if (R.envRT) R.envRT.dispose(); R.pmrem.dispose();
  R.renderer.dispose(); try { R.renderer.forceContextLoss(); } catch {}
  R = null;
}

SH.homeVariant({
  id: 'model3d', name: SH.t('3D model'), short: '3D',
  desc: SH.t('Your PC in 3D: drag to rotate it and hover a component to see where it is.'),
  mount(el, ctx) {
    mounted = true; ctxRef = ctx; const my = ++token;
    root = document.createElement('div'); root.className = 'hv-model3d'; el.appendChild(root);
    root.innerHTML = `<div class="m3-stage"></div>${listHTML(ctx.PC)}<div class="m3-hint">${SH.t('Drag to rotate it. Scroll to zoom in.')}</div>`;
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
    if (!webglOK()) { stage.innerHTML = isTower() ? fallbackTowerSVG() : fallbackSVG(); stage.classList.add('flat'); return; }
    loadThree().then(() => {
      if (!mounted || my !== token) return;
      if (isTower()) { POSE = POSE_T; SP = SPOTS_T; } else { POSE = POSE_L; SP = SPOTS; }
      const cv = document.createElement('canvas'); cv.className = 'm3-canvas'; stage.appendChild(cv);
      try { R = isTower() ? buildTower(cv) : build(cv); } catch (e) { console.warn('StellarHub: no 3D', e); release(); R = null; cv.remove(); stage.innerHTML = isTower() ? fallbackTowerSVG() : fallbackSVG(); stage.classList.add('flat'); return; }
      cv.addEventListener('pointerdown', onDown); cv.addEventListener('wheel', onWheel, { passive: false });
      cv.addEventListener('dblclick', () => { S.zoom.t = 1; S.offAz.t = 0; S.offEl.t = 0; });
      ro = new ResizeObserver(resize); ro.observe(root); resize();
      unsubLook = SH.on('look', refreshLook); unsubTele = SH.tele.on(() => { if (R) R.scrNew = true; });
      // entrance: camera from afar, the lid opens, the screen lights up, then the keyboard
      focused = null; Object.values(halo).forEach(h => h.s.set(0));
      S.az.set(POSE.az + (ctx.intro ? .7 : 0)); S.el.set(POSE.el + (ctx.intro ? .25 : 0)); S.dist.set(POSE.dist * (ctx.intro ? 1.6 : 1));
      S.az.t = POSE.az; S.el.t = POSE.el; S.dist.t = POSE.dist; [S.tx.t, S.ty.t, S.tz.t] = POSE.target; S.tx.set(S.tx.t); S.ty.set(S.ty.t); S.tz.set(S.tz.t);
      S.offAz.set(0); S.offEl.set(0); S.zoom.set(1); S.shell.set(1);
      if (ctx.intro) {
        S.lid.set(0); S.screen.set(0); S.kb.set(0);
        anim(cv, [{ opacity: 0, filter: 'blur(12px)' }, { opacity: 1, filter: 'blur(0px)' }], { d: 800, e: EASE.out });
        timers.push(setTimeout(() => { S.lid.t = OPEN; }, 380 * SH.motion()));
        timers.push(setTimeout(() => { S.screen.t = 1; }, 900 * SH.motion()));
        timers.push(setTimeout(() => { S.kb.t = 1; }, 1250 * SH.motion()));
      } else { S.lid.set(OPEN); S.screen.set(1); S.kb.set(1); }
      R.scrT = 1; R.scrNew = true; dirty = true; tickers.add(frame);
    }).catch(e => { console.warn('StellarHub: could not load three.js', e); if (mounted && my === token) { stage.innerHTML = isTower() ? fallbackTowerSVG() : fallbackSVG(); stage.classList.add('flat'); } });
  },
  unmount() {
    mounted = false; token++; tickers.delete(frame); timers.forEach(clearTimeout); timers = []; clearTimeout(leaveT); clearTimeout(idleT);
    removeEventListener('pointermove', onMove); removeEventListener('pointerup', onUp); dragging = false;
    if (unsubLook) unsubLook(); unsubLook = null; if (unsubTele) unsubTele(); unsubTele = null; if (ro) ro.disconnect(); ro = null;
    release();
    POSE = POSE_L; SP = SPOTS; Object.keys(halo).forEach(k => delete halo[k]); focused = null; root = null; ctxRef = null;
  },
  resize,
  onReturn() { if (!R) return; S.dist.v = S.dist.v * 1.25; S.az.v += .25; dirty = true; },
});
})();
