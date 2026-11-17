/* StellarHub · armazón: estrellas, dock, navegación entre vistas y pestañas, paleta, ajustes, modo admin y avisos. */
'use strict';
(() => {
const { $, $$, ROOT, state, Spring, EASE, anim, assemble, tickers, ic, MODS, modById, registry, motion, esc } = SH;
const S = () => state.settings;

/* ================= estrellas ================= */
const cv = $('#stars'), cx = cv.getContext('2d'); let SW = 0, SH_ = 0, DPR = 1;
let stars = [];
const star = () => ({ x: Math.random(), y: Math.random(), z: .15 + Math.random() * .85, r: Math.random() * 1.1 + .25, p: Math.random() * 6.28, tw: .4 + Math.random() * 1.4 });
function makeStars(n) { n = Math.max(0, Math.round(n || 0)); if (n > stars.length) stars = stars.concat(Array.from({ length: n - stars.length }, star)); else stars = stars.slice(0, n); }
makeStars(240);
const shooters = []; let nextShot = performance.now() + 4000;
const warp = new Spring(0, 70, 13);
const mouse = { x: new Spring(0, 40, 12), y: new Spring(0, 40, 12) };
function sizeStars() { DPR = Math.min(2, devicePixelRatio || 1); SW = innerWidth; SH_ = innerHeight; cv.width = SW * DPR; cv.height = SH_ * DPR; }
sizeStars(); addEventListener('resize', sizeStars);
addEventListener('pointermove', e => { mouse.x.t = (e.clientX / innerWidth - .5) * 2; mouse.y.t = (e.clientY / innerHeight - .5) * 2; });
const starAlpha = new Spring(0, 40, 12); starAlpha.t = 1;
tickers.add((dt, t) => {
  mouse.x.step(dt); mouse.y.step(dt); warp.step(dt); starAlpha.t = S().stars ? 1 : 0; starAlpha.step(dt);
  cx.setTransform(DPR, 0, 0, DPR, 0, 0); cx.clearRect(0, 0, SW, SH_);
  if (starAlpha.v < .01) return;
  const st = S(), moving = st.intensity !== 'min'; const drift = moving ? dt * .004 * SH.ORBIT[st.intensity] * st.starSpeed : 0;
  const par = st.parallax && moving ? 1 : 0, bright = st.starBright || 1;
  const cxs = SW / 2, cys = SH_ * .52; const w = warp.v;
  /* estrellas fugaces */
  if (st.shooting && moving && t > nextShot) {
    nextShot = t + 7000 + Math.random() * 11000;
    const a = .35 + Math.random() * .35, sp = 900 + Math.random() * 500;
    shooters.push({ x: Math.random() * SW * .8 + SW * .1, y: Math.random() * SH_ * .35, vx: Math.cos(a) * sp * (Math.random() < .5 ? -1 : 1), vy: Math.sin(a) * sp, life: 0, max: .7 + Math.random() * .4 });
  }
  for (let i = shooters.length - 1; i >= 0; i--) {
    const sh = shooters[i]; sh.life += dt; sh.x += sh.vx * dt; sh.y += sh.vy * dt;
    const k = sh.life / sh.max; if (k >= 1) { shooters.splice(i, 1); continue; }
    const fade = Math.sin(k * Math.PI), tail = .12;
    const g = cx.createLinearGradient(sh.x, sh.y, sh.x - sh.vx * tail, sh.y - sh.vy * tail);
    g.addColorStop(0, `rgba(230,242,255,${.9 * fade * starAlpha.v})`); g.addColorStop(1, 'rgba(230,242,255,0)');
    cx.globalAlpha = 1; cx.strokeStyle = g; cx.lineWidth = 1.4; cx.beginPath(); cx.moveTo(sh.x, sh.y); cx.lineTo(sh.x - sh.vx * tail, sh.y - sh.vy * tail); cx.stroke();
  }
  for (const s of stars) {
    s.x -= drift * s.z; if (s.x < 0) s.x += 1;
    const x = s.x * SW - mouse.x.v * 22 * s.z * par, y = s.y * SH_ - mouse.y.v * 16 * s.z * par;
    const tw = moving && st.twinkle ? (.65 + .35 * Math.sin(t / 1000 * s.tw + s.p)) : .8;
    cx.globalAlpha = Math.min(1, (.25 + .6 * s.z) * tw * starAlpha.v * bright);
    if (Math.abs(w) > .02) {
      const dx = x - cxs, dy = y - cys, len = w * s.z * .22;
      cx.strokeStyle = s.z > .7 ? '#cfe6ff' : '#9fb6d8'; cx.lineWidth = s.r; cx.beginPath(); cx.moveTo(x, y); cx.lineTo(x + dx * len, y + dy * len); cx.stroke();
    } else { cx.fillStyle = s.z > .75 ? '#e6f2ff' : '#a9bddc'; cx.beginPath(); cx.arc(x, y, s.r * s.z + .2, 0, 6.283); cx.fill(); }
  }
  cx.globalAlpha = 1;
});
SH.mouse = mouse; SH.warp = warp;

/* ================= dock ================= */
const DOCK = ['home', '|', 'monitor', 'drivers', 'remover', 'updater', 'storage', 'optimizer', 'tester', '|', 'autopilot'];
const dock = $('#dock');
dock.innerHTML = DOCK.map(id => id === '|' ? '<span class="sep"></span>' : (m => `<button class="dk${id === 'home' ? ' on' : ''}" data-go="${id}" aria-label="${m.name}">${ic(m.icon)}<span class="tip">${m.name}</span></button>`)(modById(id))).join('') + '<span class="dot" id="dockDot"></span>';
const BASE = 52, GROW = .3;
const dks = $$('.dk', dock).map(el => ({ el, s: new Spring(1, 320, 24) }));
const dotX = new Spring(0, 260, 24); let dockMouse = null;
dock.addEventListener('pointermove', e => dockMouse = e.clientX);
dock.addEventListener('pointerleave', () => dockMouse = null);
tickers.add(dt => {
  for (const d of dks) {
    let t = 1;
    if (dockMouse !== null && S().intensity !== 'min') {
      const r = d.el.getBoundingClientRect(); const dist = Math.abs(dockMouse - (r.left + r.width / 2));
      t = 1 + GROW * Math.max(0, 1 - dist / 140);
    }
    d.s.t = t; d.s.step(dt);
    const px = (BASE * d.s.v).toFixed(2) + 'px';
    if (d.el.style.width !== px) { d.el.style.width = px; d.el.style.height = px; d.el.firstElementChild.style.transform = `scale(${(.85 + .15 * d.s.v).toFixed(4)})`; }
  }
  /* el punto del dock: se mide solo si el dock se está moviendo o cambió el módulo (medir en cada frame
     fuerza a recalcular toda la página y baja los fps al hacer scroll) */
  const dockMoving = dockMouse !== null || dks.some(d => !d.s.idle);
  if (dockMoving || dotDirty) { const on = $('.dk.on', dock); if (on) dotX.t = on.offsetLeft + on.offsetWidth / 2 - 9; dotDirty = false; }
  if (!dotX.idle || dockMoving) { dotX.step(dt); $('#dockDot').style.transform = `translateX(${dotX.v.toFixed(2)}px)`; }
});
let dotDirty = true;
SH.on('view', () => { dotDirty = true; });
addEventListener('resize', () => { dotDirty = true; });
dock.addEventListener('click', e => { const b = e.target.closest('[data-go]'); if (b) go(b.dataset.go); });

/* ================= módulos: vistas y pestañas ================= */
const views = $('#views');
const modState = {}; // id -> {tab, rendered:Set, ix, iw}
function tabsOf(m) { const def = registry.modules[m.id] || {}; return (def.tabs || m.tabs || []).map(t => Array.isArray(t) ? { id: t[0], name: t[1] } : t); }
function skeletonFor(i) {
  const r = k => `<div class="sk-row" data-asm><div class="sk a" style="--dl:${k * .08}s"></div><div class="sk b" style="--w:${[38, 52, 30, 46, 41, 27, 49][k % 7]}%;--dl:${k * .08 + .04}s"></div><div class="sk c" style="--dl:${k * .08 + .08}s"></div></div>`;
  return `<div class="sk-rows">${Array.from({ length: 6 + (i % 3) }, (_, k) => r(k)).join('')}</div>`;
}
function buildModule(m) {
  let s = $('#v-' + m.id);
  if (!s) { s = document.createElement('section'); s.className = 'view'; s.id = 'v-' + m.id; s.dataset.view = m.id; views.appendChild(s); }
  const def = registry.modules[m.id] || {}; const tabs = tabsOf(m);
  const sample = !(m.real || def.real) ? '<span class="chip warn" title="Todavía no está conectado al motor real: lo que ves es de ejemplo y no refleja tu PC">Datos de ejemplo</span>' : '';
  s.innerHTML = `<div class="mod"><header class="mhead" data-asm><div class="ttl"><h1>${esc(def.name || m.name)}${sample}</h1><p>${esc(def.desc || m.desc || '')}</p></div><div class="acts"></div></header>
    ${tabs.length > 1 ? `<nav class="subnav" data-asm role="tablist"><span class="ind"></span>${tabs.map((t, i) => `<button role="tab" data-tab="${t.id}"${i === 0 ? ' class="on"' : ''}>${esc(t.name)}<span class="bd" hidden></span></button>`).join('')}</nav>` : ''}
    <div class="tabs">${tabs.map((t, i) => `<div class="tab${i === 0 ? ' on' : ''}" data-tab="${t.id}" role="tabpanel"></div>`).join('')}</div></div>`;
  modState[m.id] = { tab: tabs[0] && tabs[0].id, rendered: new Set(), ix: new Spring(0, 300, 28), iw: new Spring(0, 300, 28), placed: false };
  const ctx = ctxFor(m);
  if (def.actions) { try { def.actions($('.acts', s), ctx); } catch (e) { console.error(e); } }
  const nav = $('.subnav', s);
  if (nav) nav.addEventListener('click', e => { const b = e.target.closest('[data-tab]'); if (b) setTab(m.id, b.dataset.tab); });
}
function ctxFor(m) {
  return {
    mod: m, go, el: () => $('#v-' + m.id),
    tabEl: id => $(`#v-${m.id} .tab[data-tab="${id}"]`),
    setTab: id => setTab(m.id, id),
    setBadge(tabId, n) { const b = $(`#v-${m.id} .subnav [data-tab="${tabId}"] .bd`); if (!b) return; b.hidden = !n; tabDirty = true; if (n) { b.textContent = n; anim(b, [{ transform: 'scale(.4)' }, { transform: 'scale(1)' }], { d: 380, e: EASE.spring }); } },
  };
}
function renderTab(mid, tabId) {
  const ms = modState[mid]; const el = $(`#v-${mid} .tab[data-tab="${tabId}"]`); if (!el || ms.rendered.has(tabId)) return el;
  ms.rendered.add(tabId);
  const def = registry.modules[mid];
  if (def && def.renderTab) { try { def.renderTab(tabId, el, ctxFor(modById(mid))); } catch (e) { console.error(e); el.innerHTML = `<div class="empty"><b>Esta pestaña falló al cargar</b>${esc(e.message)}</div>`; } }
  else el.innerHTML = skeletonFor(tabId.length);
  return el;
}
function placeTabInd(mid, snap) {
  const ms = modState[mid]; const s = $('#v-' + mid); const b = s && $(`.subnav [data-tab="${ms.tab}"]`, s); if (!b) return;
  ms.ix.t = b.offsetLeft; ms.iw.t = b.offsetWidth; if (snap || !ms.placed) { ms.ix.set(ms.ix.t); ms.iw.set(ms.iw.t); ms.placed = true; }
}
/* el indicador de pestañas solo mide al cambiar de pestaña/vista/tamaño y solo escribe mientras se mueve */
let tabDirty = true;
SH.on('view', () => { tabDirty = true; }); SH.on('tab', () => { tabDirty = true; }); SH.on('look', () => { tabDirty = true; });
addEventListener('resize', () => { tabDirty = true; });
tickers.add(dt => {
  const ms = modState[state.view]; if (!ms) return;
  if (tabDirty) { placeTabInd(state.view); tabDirty = false; ms.moving = true; }
  if (!ms.moving) return;
  const ind = $(`#v-${state.view} .subnav .ind`); if (!ind) return;
  ms.ix.step(dt); ms.iw.step(dt);
  const stretch = Math.min(28, Math.abs(ms.ix.vel) * .035);
  ind.style.width = (ms.iw.v + stretch).toFixed(2) + 'px'; ind.style.transform = `translateX(${(ms.ix.v - (ms.ix.vel > 0 ? 0 : stretch)).toFixed(2)}px)`;
  if (ms.ix.idle && ms.iw.idle) ms.moving = false;
});
function setTab(mid, tabId, quiet) {
  const ms = modState[mid]; if (!ms || ms.tab === tabId) return;
  const s = $('#v-' + mid); const tabs = tabsOf(modById(mid)); const oldI = tabs.findIndex(t => t.id === ms.tab), newI = tabs.findIndex(t => t.id === tabId);
  if (newI < 0) return;
  const def = registry.modules[mid] || {};
  const from = $(`.tab[data-tab="${ms.tab}"]`, s); const fresh = !ms.rendered.has(tabId); const to = renderTab(mid, tabId);
  if (def.leaveTab) try { def.leaveTab(ms.tab, from); } catch (e) { console.error(e); }
  const prev = ms.tab; ms.tab = tabId;
  $$('.subnav [data-tab]', s).forEach(b => b.classList.toggle('on', b.dataset.tab === tabId));
  const dir = newI > oldI ? 1 : -1;
  to.getAnimations().forEach(a => a.cancel()); to.style.transform = to.style.filter = to.style.opacity = '';
  to.classList.add('on');
  if (!quiet) {
    const a = anim(from, [{ opacity: 1, transform: 'translate3d(0,0,0)', filter: 'blur(0px)' }, { opacity: 0, transform: `translate3d(${-dir * 28}px,0,0)`, filter: 'blur(6px)' }], { d: 200, e: EASE.out });
    a && a.finished.then(() => { if (ms.tab !== prev) from.classList.remove('on'); }).catch(() => {});
    anim(to, [{ opacity: 0, transform: `translate3d(${dir * 40}px,0,0)`, filter: 'blur(8px)' }, { opacity: 1, transform: 'translate3d(0,0,0)', filter: 'blur(0px)' }], { d: 480, delay: 40, e: EASE.spring });
    if (fresh) assemble(to, 80, 32);
  } else { from.classList.remove('on'); }
  if (def.enterTab) try { def.enterTab(tabId, to, ctxFor(modById(mid))); } catch (e) { console.error(e); }
  SH.emit('tab', { mod: mid, tab: tabId });
  if (!quiet) pushHist();
}

/* ================= historial: atrás y adelante (botones laterales del ratón, Alt+flechas) ================= */
const hist = [{ view: 'home', tab: null }]; let hIdx = 0, fromHist = false;
function pushHist() {
  if (fromHist) return;
  const e = { view: state.view, tab: modState[state.view] ? modState[state.view].tab : null }, cur = hist[hIdx];
  if (cur && cur.view === e.view && cur.tab === e.tab) return;
  hist.splice(hIdx + 1); hist.push(e); if (hist.length > 80) hist.shift(); hIdx = hist.length - 1;
}
function travel(d) {
  if (state.palOpen) { closePal(); return; } if (state.setOpen) { closeSettings(); return; }
  const i = hIdx + d; if (i < 0 || i >= hist.length) { const dk = $('.dk.on', dock); dk && anim(dk, [{ transform: 'translateX(0)' }, { transform: `translateX(${d * -4}px)` }, { transform: 'translateX(0)' }], { d: 260, keep: true }); return; }
  hIdx = i; const e = hist[i]; fromHist = true;
  try { if (e.view === state.view) { if (e.tab) setTab(e.view, e.tab); } else go(e.view, { tab: e.tab }); } finally { fromHist = false; }
}
SH.back = () => travel(-1); SH.forward = () => travel(1);
const ownsMouse = e => e.target.closest && e.target.closest('#v-tester .tab[data-tab="mouse"]');
addEventListener('mousedown', e => { if ((e.button === 3 || e.button === 4) && !ownsMouse(e)) e.preventDefault(); });
addEventListener('mouseup', e => {
  if (e.button !== 3 && e.button !== 4) return; if (ownsMouse(e)) return; e.preventDefault();
  if (document.querySelector('.cs-o.on')) { SH.closeComponent && SH.closeComponent(); return; }
  travel(e.button === 3 ? -1 : 1);
});
addEventListener('keydown', e => { if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) { e.preventDefault(); travel(e.key === 'ArrowLeft' ? -1 : 1); } });

/* ================= navegación con cámara ================= */
let navToken = 0; SH.homeAnimating = false;
const viewEl = n => $('#v-' + n);
function go(name, opts = {}) {
  if (name === 'settings') { openSettings(opts.section); return; }
  if (name === 'admin') { askAdmin(); return; }
  const m = modById(name); if (!m) return;
  if (name === state.view) { if (opts.tab) setTab(name, opts.tab); return; }
  const token = ++navToken; const fromName = state.view, from = viewEl(fromName), to = viewEl(name);
  const fromDef = registry.modules[fromName]; if (fromDef) { try { fromDef.leave && fromDef.leave(); fromDef.leaveTab && fromDef.leaveTab(modState[fromName].tab); } catch (e) { console.error(e); } }
  state.view = name; SH.emit('view', { from: fromName, to: name });
  $$('.dk', dock).forEach(b => b.classList.toggle('on', b.dataset.go === name));
  if (modState[name]) {
    /* al volver a un módulo se abre su pestaña principal (salvo que se pida otra o se venga del historial) */
    const want = opts.tab || (fromHist ? null : (tabsOf(m)[0] || {}).id);
    if (want && want !== modState[name].tab) setTab(name, want, true);
    renderTab(name, modState[name].tab);
  }
  /* la vista que entra parte limpia: sin restos de una salida anterior (blur, escala, opacidad) */
  to.getAnimations().forEach(a => a.cancel()); to.style.transform = to.style.filter = to.style.opacity = '';
  to.classList.add('is-on');
  const cam = S().camera && S().intensity !== 'min';
  let outA;
  if (fromName === 'home') {
    SH.homeAnimating = true;
    if (cam) { warp.t = 1; setTimeout(() => { warp.t = 0; }, 260 * motion()); }
    outA = anim(from, [{ opacity: 1, transform: 'scale(1)', filter: 'blur(0px)' }, { opacity: 0, transform: `scale(${cam ? 2.4 : 1.05})`, filter: 'blur(16px)' }], { d: cam ? 560 : 260, e: EASE.io });
    anim(to, [{ opacity: 1 }, { opacity: 1 }], { d: 1 }); assemble(to, cam ? 200 : 60);
  } else if (name === 'home') {
    SH.homeAnimating = true;
    if (cam) { warp.t = -.8; setTimeout(() => { warp.t = 0; }, 240 * motion()); }
    outA = anim(from, [{ opacity: 1, transform: 'scale(1)', filter: 'blur(0px)' }, { opacity: 0, transform: 'scale(.86)', filter: 'blur(10px)' }], { d: 300, e: EASE.out });
    anim(to, [{ opacity: 0, transform: `scale(${cam ? 2.4 : 1.04})`, filter: 'blur(16px)' }, { opacity: 1, transform: 'scale(1)', filter: 'blur(0px)' }], { d: cam ? 640 : 320, delay: 60, e: EASE.out });
    SH.emit('home:return');
  } else {
    if (cam) { warp.t = .45; setTimeout(() => { warp.t = 0; }, 180 * motion()); }
    outA = anim(from, [{ opacity: 1, transform: 'scale(1)', filter: 'blur(0px)' }, { opacity: 0, transform: `scale(${cam ? 1.3 : 1.03})`, filter: 'blur(12px)' }], { d: 380, e: EASE.io });
    anim(to, [{ opacity: 1 }, { opacity: 1 }], { d: 1 }); assemble(to, 120);
  }
  const def = registry.modules[name];
  if (def) { try { def.enter && def.enter(); def.enterTab && def.enterTab(modState[name].tab, $(`#v-${name} .tab[data-tab="${modState[name].tab}"]`), ctxFor(m)); } catch (e) { console.error(e); } }
  if (outA) outA.finished.then(() => { if (token === navToken && state.view !== fromName) from.classList.remove('is-on'); if (token === navToken) SH.homeAnimating = false; }).catch(() => {});
  $$('.view.is-on').forEach(v => { if (v !== to && v !== from) v.classList.remove('is-on'); });
  pushHist();
}
SH.go = go;
const COMP_TAB = { cpu: 'cpu', gpu: 'gpu', ram: 'memory', ssd: 'disks', wifi: 'network', battery: 'battery', display: 'overview', audio: 'overview', sys: 'health' };
SH.openComponent = id => go('monitor', { tab: COMP_TAB[id] || 'overview' });
$('#brand').addEventListener('click', () => go('home'));

/* ================= paleta de comandos ================= */
const BUILTIN = [
  { t: 'Buscar drivers nuevos', go: 'drivers', tab: 'updates', ic: 'drivers' },
  { t: 'Hacer copia de seguridad de los drivers', go: 'drivers', tab: 'backup', ic: 'download' },
  { t: 'Desinstalar un programa', go: 'remover', tab: 'programs', ic: 'remover' },
  { t: 'Restaurar algo de la cuarentena', go: 'remover', tab: 'quarantine', ic: 'restore' },
  { t: 'Actualizar todos los programas', go: 'updater', tab: 'overview', ic: 'updater' },
  { t: 'Buscar actualizaciones de Windows', go: 'updater', tab: 'windows', ic: 'windows' },
  { t: 'Qué ocupa el disco C:', go: 'storage', tab: 'map', ic: 'storage' },
  { t: 'Buscar archivos duplicados', go: 'storage', tab: 'duplicates', ic: 'copy' },
  { t: 'Limpiar archivos temporales', go: 'optimizer', tab: 'clean', ic: 'broom' },
  { t: 'Acelerar el arranque de Windows', go: 'optimizer', tab: 'startup', ic: 'bolt' },
  { t: 'Reparar Windows', go: 'optimizer', tab: 'repair', ic: 'wrench' },
  { t: 'Ver la temperatura de la GPU', go: 'monitor', tab: 'gpu', ic: 'temp' },
  { t: 'Ver qué programas gastan más memoria', go: 'monitor', tab: 'processes', ic: 'ram' },
  { t: 'Salud de la batería', go: 'monitor', tab: 'battery', ic: 'battery' },
  { t: 'Probar el teclado', go: 'tester', tab: 'keyboard', ic: 'keyboard' },
  { t: 'Buscar píxeles muertos', go: 'tester', tab: 'screen', ic: 'display' },
  { t: 'Crear una rutina automática', go: 'autopilot', tab: 'routines', ic: 'autopilot' },
  { t: 'Activar el modo administrador', go: 'admin', ic: 'shield' },
  { t: 'Cambiar el tema y el color', go: 'settings', section: 'look', ic: 'palette' },
  { t: 'Cambiar el tamaño de la interfaz', go: 'settings', section: 'look', ic: 'sliders' },
  { t: 'Cambiar la intensidad de las animaciones', go: 'settings', section: 'motion', ic: 'sparkle' },
  { t: 'Cambiar la vista de Inicio', go: 'settings', section: 'home', ic: 'layers' },
  { t: 'Buscar actualizaciones de StellarHub', go: 'settings', section: 'updates', ic: 'download' },
];
function paletteItems() {
  const list = [];
  MODS.forEach(m => list.push({ t: m.name, go: m.id, ic: m.icon, g: 'Módulos' }));
  MODS.forEach(m => tabsOf(m).forEach(t => list.push({ t: t.name, path: m.name, go: m.id, tab: t.id, ic: m.icon, g: 'Secciones' })));
  [...BUILTIN, ...registry.actions].forEach(a => list.push({ ...a, g: 'Acciones' }));
  return list;
}
const norm = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
let palList = [], palIdx = 0; const hlY = new Spring(0, 420, 30);
function renderPal(q) {
  const n = norm(q.trim()); const all = paletteItems();
  palList = n ? all.filter(i => n.split(/\s+/).every(w => norm(i.t + ' ' + (i.path || '')).includes(w))) : all.filter(i => i.g !== 'Secciones');
  palList = palList.slice(0, 40); palIdx = 0; const res = $('#palRes');
  if (!palList.length) { res.innerHTML = `<div class="empty">No hay nada con «${esc(q)}». Prueba con «drivers», «disco» o «limpiar».</div>`; return; }
  let html = '<div class="hl" id="palHl"></div>', g = '';
  palList.forEach((it, i) => { if (it.g !== g) { g = it.g; html += `<div class="grp">${g}</div>`; }
    html += `<button class="it" data-i="${i}"><span class="ic">${ic(it.ic)}</span>${it.path ? `<span class="path">${esc(it.path)}</span>` : ''}${esc(it.t)}<small>${it.g === 'Acciones' ? 'Hacer' : 'Abrir'}</small></button>`; });
  res.innerHTML = html;
  $$('.it', res).forEach((el, i) => anim(el, [{ opacity: 0, transform: 'translate3d(0,6px,0)' }, { opacity: 1, transform: 'translate3d(0,0,0)' }], { d: 260, delay: Math.min(i, 8) * 22 }));
  setPalIdx(0, true);
}
function setPalIdx(i, snap) {
  if (!palList.length) return; palIdx = (i + palList.length) % palList.length;
  const items = $$('#palRes .it'); items.forEach((el, k) => el.classList.toggle('on', k === palIdx));
  const el = items[palIdx]; hlY.t = el.offsetTop; if (snap) hlY.set(hlY.t);
  el.scrollIntoView({ block: 'nearest' });
}
tickers.add(dt => { if (!state.palOpen) return; const h = $('#palHl'); if (!h) return; hlY.step(dt); h.style.transform = `translateY(${hlY.v.toFixed(2)}px)`; });
function openPal() {
  if (state.setOpen) closeSettings();
  state.palOpen = true; const o = $('#palO'); o.classList.add('on');
  anim($('.scrim', o), [{ opacity: 0 }, { opacity: 1 }], { d: 220 });
  anim($('#pal'), [{ opacity: 0, transform: 'translate3d(0,-14px,0) scale(.95)', filter: 'blur(8px)' }, { opacity: 1, transform: 'translate3d(0,0,0) scale(1)', filter: 'blur(0px)' }], { d: 380, e: EASE.spring });
  const inp = $('#palIn'); inp.value = ''; renderPal(''); setTimeout(() => inp.focus(), 10);
}
function closePal() {
  if (!state.palOpen) return; state.palOpen = false; const o = $('#palO');
  anim($('.scrim', o), [{ opacity: 1 }, { opacity: 0 }], { d: 160 });
  const a = anim($('#pal'), [{ opacity: 1, transform: 'translate3d(0,0,0) scale(1)', filter: 'blur(0px)' }, { opacity: 0, transform: 'translate3d(0,-8px,0) scale(.97)', filter: 'blur(4px)' }], { d: 160 });
  a.finished.then(() => { if (!state.palOpen) o.classList.remove('on'); }).catch(() => {});
}
$('#searchBtn').addEventListener('click', openPal);
$('#palIn').addEventListener('input', e => renderPal(e.target.value));
$('#palRes').addEventListener('click', e => { const b = e.target.closest('.it'); if (b) runItem(palList[+b.dataset.i]); });
$('#palRes').addEventListener('pointermove', e => { const b = e.target.closest('.it'); if (b && +b.dataset.i !== palIdx) setPalIdx(+b.dataset.i); });
function runItem(it) { if (!it) return; closePal(); setTimeout(() => { if (it.run) it.run(); else go(it.go, { tab: it.tab, section: it.section }); }, 90 * motion()); }
SH.openPalette = openPal;

/* ================= ajustes ================= */
const ACCENTS = [['#FF7A66', '#9ED6FF', 'Coral y hielo'], ['#9ED6FF', '#FF9E7A', 'Hielo y coral'], ['#F4C26B', '#8FD3E8', 'Ámbar'], ['#7FE0B4', '#FFB08A', 'Menta'], ['#FF8FB1', '#A6E3FF', 'Rosa'], ['#C9D4E8', '#FF7A66', 'Plata']];
const ZOOMS = [['1', '100 %'], ['1.1', '110 %'], ['1.15', '115 %'], ['1.25', '125 %'], ['1.4', '140 %']];
const SECTIONS = [['look', 'Apariencia', 'palette'], ['background', 'Fondo', 'sparkle'], ['motion', 'Animación', 'play'], ['home', 'Inicio', 'home'], ['widget', 'Widget', 'monitor'], ['general', 'General', 'sliders'], ['tools', 'Herramientas', 'wrench'], ['data', 'Datos', 'folder'], ['keys', 'Atajos', 'keyboard'], ['admin', 'Administrador', 'shield'], ['updates', 'Actualizaciones', 'download'], ['about', 'Acerca de', 'info']];
const seg = (key, opts) => `<div class="seg" data-key="${key}"><span class="ind"></span>${opts.map(([v, l]) => `<button data-v="${v}"${String(S()[key]) === v ? ' class="on"' : ''}>${l}</button>`).join('')}</div>`;
const tog = (key, label, sub) => `<div class="set inline"><div class="lbl"><div>${label}${sub ? `<span>${sub}</span>` : ''}</div></div><button class="toggle${S()[key] ? ' on' : ''}" data-key="${key}" aria-label="${label}"><i></i></button></div>`;
/* deslizador: valor en vivo, guarda al soltar */
const rng = (key, label, sub, min, max, step, fmt) => `<div class="set"><div class="lbl"><div>${label}${sub ? `<span>${sub}</span>` : ''}</div><b class="rv" data-rv="${key}">${fmt(S()[key])}</b></div>
  <input type="range" class="rng" data-key="${key}" min="${min}" max="${max}" step="${step}" value="${S()[key]}" style="--p:${(S()[key] - min) / (max - min) * 100}%"></div>`;
const RNG_FMT = { starCount: v => v == 0 ? 'ninguna' : v, starSpeed: v => SH.fmt1(v) + '×', starBright: v => Math.round(v * 100) + ' %', nebula: v => Math.round(v * 100) + ' %', animSpeed: v => SH.fmt1(v) + '×', panelAlpha: v => Math.round(v * 100) + ' %' };
const TOOLS = [['devmgmt', 'Administrador de dispositivos', 'drivers'], ['services', 'Servicios', 'sliders'], ['eventvwr', 'Visor de eventos', 'list'], ['taskschd', 'Programador de tareas', 'calendar'],
  ['diskmgmt', 'Administración de discos', 'ssd'], ['taskmgr', 'Administrador de tareas', 'monitor'], ['resmon', 'Monitor de recursos', 'monitor'], ['msinfo32', 'Información del sistema', 'info'],
  ['msconfig', 'Configuración del sistema', 'gear'], ['regedit', 'Editor del registro', 'code'], ['sysdm', 'Propiedades del sistema', 'windows'], ['perf', 'Efectos visuales', 'sparkle'],
  ['powercfg', 'Opciones de energía', 'power'], ['ncpa', 'Conexiones de red', 'wifi'], ['appwiz', 'Programas y características', 'package'], ['control', 'Panel de control', 'grid'],
  ['cleanmgr', 'Liberador de espacio', 'broom'], ['dfrgui', 'Optimizar unidades', 'storage'], ['rstrui', 'Restaurar sistema', 'restore'], ['cmd', 'Símbolo del sistema', 'code'], ['powershell', 'PowerShell', 'code']];
const INT_HINT = { max: 'Todo se mueve: estrellas, viajes de cámara y transiciones completas.', normal: 'Animaciones más cortas y estrellas más lentas.', min: 'Transiciones breves. Las estrellas se quedan quietas.' };
function sectionHTML(id) {
  const st = S();
  switch (id) {
    case 'look': return `<h3>Apariencia</h3><p>Cómo se ve StellarHub.</p>
      <div class="set"><div class="lbl">Tema</div>${seg('theme', [['deep', 'Espacio profundo'], ['dusk', 'Crepúsculo'], ['eclipse', 'Eclipse']])}</div>
      <div class="set"><div class="lbl">Colores</div><div class="sw-row" id="swatches">${ACCENTS.map(([a, b, n]) => `<button class="swatch${st.accent === a && st.accent2 === b ? ' on' : ''}" style="--s:${a};--s2:${b}" data-a="${a}" data-b="${b}" aria-label="${n}" title="${n}"></button>`).join('')}
        <button class="swatch custom${ACCENTS.some(([a, b]) => st.accent === a && st.accent2 === b) ? '' : ' on'}" id="swCustom" style="--s:${st.accent};--s2:${st.accent2}" aria-label="Colores propios" title="Colores propios"><span>${ic('plus')}</span></button></div>
        <div class="cpick-row" id="cpickRow"${ACCENTS.some(([a, b]) => st.accent === a && st.accent2 === b) ? ' hidden' : ''}><span>Principal</span><input type="color" data-color="accent" value="${st.accent}" aria-label="Color principal"><span>Secundario</span><input type="color" data-color="accent2" value="${st.accent2}" aria-label="Color secundario"></div></div>
      <div class="set"><div class="lbl"><div>Tamaño de la interfaz<span>Automático pone el que mejor va con tu pantalla (${Math.round(autoZoom * 100)} %).</span></div><button class="btn sm sec" data-act="autozoom">${ic('sparkle')}Automático</button></div>${seg('zoom', ZOOMS)}</div>
      <div class="set"><div class="lbl">Densidad</div>${seg('density', [['comfortable', 'Cómoda'], ['compact', 'Compacta']])}</div>
      <div class="set"><div class="lbl">Esquinas</div>${seg('corners', [['soft', 'Muy redondas'], ['mid', 'Redondas'], ['sharp', 'Rectas']])}</div>
      ${rng('panelAlpha', 'Paneles más sólidos', 'Súbelo para que las estrellas se vean menos detrás de los paneles.', 1, 2, .05, RNG_FMT.panelAlpha)}`;
    case 'background': return `<h3>Fondo</h3><p>El espacio que hay detrás de todo.</p>
      ${tog('stars', 'Polvo de estrellas', 'El fondo animado.')}
      ${rng('starCount', 'Cantidad de estrellas', '', 0, 900, 10, RNG_FMT.starCount)}
      ${rng('starSpeed', 'Velocidad de deriva', 'Lo rápido que se desplazan.', 0, 4, .1, RNG_FMT.starSpeed)}
      ${rng('starBright', 'Brillo', '', .2, 2, .05, RNG_FMT.starBright)}
      ${tog('twinkle', 'Parpadeo', 'Las estrellas titilan suavemente.')}
      ${tog('shooting', 'Estrellas fugaces', 'De vez en cuando cruza una.')}
      ${rng('nebula', 'Nebulosa', 'El resplandor de color en las esquinas.', 0, 2, .05, RNG_FMT.nebula)}`;
    case 'motion': return `<h3>Animación</h3><p>Cuánto se mueve la interfaz.</p>
      <div class="set"><div class="lbl">Intensidad</div>${seg('intensity', [['max', 'Máxima'], ['normal', 'Normal'], ['min', 'Mínima']])}<div class="hint" id="intHint">${INT_HINT[st.intensity]}</div></div>
      ${rng('animSpeed', 'Velocidad', 'Más bajo, animaciones más lentas y cinematográficas.', .5, 2, .1, RNG_FMT.animSpeed)}
      ${tog('camera', 'Viajes de cámara', 'El zoom que atraviesa la escena al cambiar de módulo.')}
      ${tog('parallax', 'Profundidad con el ratón', 'Las capas se mueven un poco al mover el ratón.')}
      ${tog('countUp', 'Números que cuentan', 'Las cifras suben hasta su valor al aparecer.')}`;
    case 'home': return `<h3>Inicio</h3><p>Lo que ves al abrir StellarHub.</p>
      <div class="set"><div class="lbl">Vista del equipo</div><div class="vcards" id="vcards">${variantCards()}</div></div>
      <div class="set"><div class="lbl"><div>Al abrir la app<span>Dónde empiezas cada vez.</span></div></div>${seg('startView', [['home', 'Inicio'], ['monitor', 'Live Monitor'], ['last', 'Donde lo dejé']])}</div>
      ${tog('quickActions', 'Acciones rápidas', 'Los botones de la cabecera de Inicio.')}`;
    case 'widget': {
      const W = [['cpu', 'Uso de CPU'], ['cpuTemp', 'Temperatura de CPU'], ['gpu', 'Uso de GPU'], ['gpuTemp', 'Temperatura de GPU'], ['gpuPower', 'Consumo de la GPU'], ['ram', 'Memoria'], ['vram', 'Memoria de vídeo'], ['down', 'Bajada'], ['up', 'Subida'], ['ping', 'Latencia'], ['disk', 'Actividad del disco']];
      const on = st.widgetStats;
      return `<h3>Widget</h3><p>Una ventanita siempre visible, por encima de todo, con los datos que elijas. Arrástrala a donde quieras. Los cambios se aplican al momento.</p>
      <div class="set inline"><div class="lbl"><div>Widget<span>También desde Inicio, la barra superior y la bandeja.</span></div></div><button class="toggle${SH.widgetOn ? ' on' : ''}" data-act="widget" aria-label="Widget"><i></i></button></div>
      <div class="set"><div class="lbl"><div>Tamaño<span>La pequeña es una barra fina con los números; la grande trae gráficas. También se cambia desde el propio widget.</span></div></div>${seg('widgetMode', [['mini', 'Pequeña'], ['full', 'Grande']])}</div>
      <div class="set"><div class="lbl">Formato de la versión grande</div>${seg('widgetLayout', [['grid', 'Cuadrícula'], ['row', 'Fila'], ['list', 'Lista']])}</div>
      <div class="set"><div class="lbl">Qué muestra</div>
        ${W.map(([k, n]) => `<div class="set inline" style="padding:8px 0;border:0"><div class="lbl">${n}</div><button class="toggle${on.includes(k) ? ' on' : ''}" data-wstat="${k}" aria-label="${n}"><i></i></button></div>`).join('')}</div>
      ${tog('widgetOnStart', 'Abrirlo siempre al iniciar StellarHub', 'Si lo dejas apagado, se abre solo si estaba abierto la última vez.')}`;
    }
    case 'general': return `<h3>General</h3><p>Cómo se comporta la app.</p>
      ${tog('startWithWindows', 'Abrir al iniciar Windows', 'Empieza oculta en la bandeja, sin ventana.')}
      ${tog('trayOnClose', 'Cerrar a la bandeja', 'La X oculta la ventana; StellarHub sigue en la bandeja. Para salir: clic derecho en el icono > Salir.')}
      ${tog('sounds', 'Sonidos', 'Un sonido suave al terminar tareas largas.')}
      ${tog('confirmDanger', 'Pedir confirmación en lo que no se puede deshacer', 'Lo demás siempre tiene botón de deshacer.')}
      <div class="set"><div class="lbl"><div>Frecuencia de los datos en vivo<span>Más rápido es más fluido; más lento gasta menos.</span></div></div>${seg('teleRate', [['500', 'Rápida'], ['1000', 'Normal'], ['2000', 'Ahorro']])}</div>
      <div class="set"><div class="lbl">Idioma</div>${seg('language', [['es', 'Español'], ['en', 'English']])}</div>`;
    case 'tools': return `<h3>Herramientas de Windows</h3><p>Las herramientas del sistema que suelen estar escondidas, a un clic.</p>
      <div class="tools">${TOOLS.map(([k, n, i]) => `<button class="tool" data-tool="${k}"><span class="ti">${ic(i)}</span>${n}</button>`).join('')}</div>`;
    case 'data': return `<h3>Datos</h3><p>Tus ajustes y los datos que guarda StellarHub en este equipo.</p>
      <div class="set inline"><div class="lbl"><div>Exportar los ajustes<span>Un archivo .json para llevarlos a otro PC.</span></div></div><button class="btn sec" data-act="export">${ic('upload')}Exportar</button></div>
      <div class="set inline"><div class="lbl"><div>Importar ajustes<span>Desde un archivo exportado antes.</span></div></div><button class="btn sec" data-act="import">${ic('download')}Importar</button></div>
      <div class="set inline"><div class="lbl"><div>Carpeta de datos<span>Ajustes, registros y cuarentena.</span></div></div><button class="btn sec" data-act="datadir">${ic('folder')}Abrir</button></div>
      <div class="set inline"><div class="lbl"><div>Restablecer los ajustes<span>Vuelve todo a como venía. Se puede deshacer.</span></div></div><button class="btn danger" data-act="reset">Restablecer</button></div>`;
    case 'keys': return `<h3>Atajos</h3><p>Para moverte sin ratón.</p>
      <div class="keys">${[['Ctrl K', 'Buscar una herramienta o acción'], ['Ctrl ,', 'Abrir los ajustes'], ['Ctrl 1 a 9', 'Ir a un módulo'], ['Alt ← / Alt →', 'Atrás y adelante'], ['Botones laterales del ratón', 'Atrás y adelante'], ['Esc', 'Cerrar o volver a Inicio'], ['Doble clic en la barra superior', 'Maximizar o restaurar']].map(([k, d]) => `<div><kbd>${k}</kbd><span>${d}</span></div>`).join('')}</div>`;
    case 'admin': return `<h3>Administrador</h3><p>Instalar drivers, limpiar archivos del sistema y reparar Windows necesita permisos de administrador. Sin ellos, StellarHub funciona en modo limitado.</p>
      <div class="set inline"><div class="lbl"><div>Estado<span>${state.admin ? 'StellarHub está en modo administrador.' : 'Ahora mismo estás en modo normal.'}</span></div></div>${state.admin ? '<span class="chip ok">Administrador</span>' : '<button class="btn pri" data-act="admin">Activar</button>'}</div>
      ${tog('alwaysAdmin', 'Abrir siempre como administrador', 'Se activa al dar permisos. Windows no vuelve a preguntar en cada arranque (se usa una tarea programada).')}
      ${tog('adminHints', 'Sugerir el modo administrador', 'Un aviso discreto cuando una función lo necesita.')}`;
    case 'updates': return `<h3>Actualizaciones</h3><p>StellarHub se actualiza desde su repositorio de GitHub.</p>
      <div class="set inline"><div class="lbl"><div>Versión instalada<span>StellarHub ${state.version}</span></div></div><button class="btn sec" data-act="checkupd">${ic('updater')}Buscar ahora</button></div>
      ${tog('autoUpdate', 'Buscar actualizaciones solo', 'Al abrir la app y una vez al día.')}`;
    case 'about': return `<div class="about-h"><svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="3.2" style="fill:var(--accent)"/><ellipse cx="12" cy="12" rx="10" ry="4" transform="rotate(-24 12 12)" style="stroke:var(--accent2)" stroke-width="1.4"/><circle cx="20.2" cy="8.3" r="1.5" style="fill:var(--accent2)"/></svg>
        <div><h3>StellarHub</h3><p>Versión ${state.version}. El centro de control de tu PC.</p></div></div>
      <div class="set inline"><div class="lbl"><div>Creado por<span>Esteban Arosemena y Claude</span></div></div></div>
      <div class="set inline"><div class="lbl"><div>Código fuente<span>Software libre con licencia GNU GPLv3. github.com/Chivitos100/StellarHub</span></div></div><button class="btn sec" data-act="github">${ic('external')}Abrir en GitHub</button></div>
      <div class="set"><div class="lbl"><div>Lenguajes<span>Cuánto código hay de cada uno.</span></div></div><div id="langs" class="langs"><div class="sk" style="height:10px"></div></div></div>
      <div class="set inline"><div class="lbl"><div>Hecho con<span>Python, pywebview y WebView2; three.js para el modelo 3D; fuentes Unbounded y Onest.</span></div></div></div>
      <div class="set inline"><div class="lbl"><div>Este equipo<span>${esc(SH.PC.model)}, ${esc(SH.PC.os)}</span></div></div></div>`;
  }
  return '';
}
function variantCards() {
  const vs = Object.values(registry.variants);
  if (!vs.length) return '<div class="muted">Todavía no hay vistas instaladas.</div>';
  return vs.map(v => `<button class="vcard${S().homeVariant === v.id ? ' on' : ''}" data-variant="${v.id}"><b>${esc(v.name)}</b><span>${esc(v.desc || '')}</span></button>`).join('');
}
SH.on('variant:registered', () => { const c = $('#vcards'); if (c) c.innerHTML = variantCards(); });
let secOn = 'look'; const secInd = new Spring(0, 380, 30);
const sheet = $('#sheet');
sheet.innerHTML = `<nav><h2>Ajustes</h2><span class="ind" id="secInd"></span>${SECTIONS.map(([id, n, i]) => `<button data-sec="${id}"${id === secOn ? ' class="on"' : ''}>${ic(i)}${n}</button>`).join('')}<div class="ver">StellarHub ${state.version}</div></nav>
  <div class="body" id="setBody"></div><button class="iconbtn x" data-close aria-label="Cerrar">${ic('x')}</button>`;
function showSection(id, first) {
  secOn = id; $$('nav [data-sec]', sheet).forEach(b => b.classList.toggle('on', b.dataset.sec === id));
  const b = $(`nav [data-sec="${id}"]`, sheet); secInd.t = b.offsetTop; if (first) secInd.set(secInd.t);
  const body = $('#setBody'); body.innerHTML = `<div class="sec">${sectionHTML(id)}</div>`;
  $$('.sec > *', body).forEach((el, i) => anim(el, [{ opacity: 0, transform: 'translate3d(14px,0,0)' }, { opacity: 1, transform: 'translate3d(0,0,0)' }], { d: 380, delay: 30 + i * 35, e: EASE.spring }));
  requestAnimationFrame(() => $$('.seg', body).forEach(s => placeSeg(s, true)));
  if (id === 'about') renderLangs();
}
tickers.add(dt => { if (!state.setOpen) return; secInd.step(dt); $('#secInd').style.transform = `translateY(${secInd.v.toFixed(2)}px)`; });
sheet.addEventListener('click', e => {
  const sec = e.target.closest('[data-sec]'); if (sec) { if (sec.dataset.sec !== secOn) showSection(sec.dataset.sec); return; }
  const sb = e.target.closest('.seg button'); if (sb) { const s = sb.parentElement; if (sb.classList.contains('on')) return; $$('button', s).forEach(x => x.classList.toggle('on', x === sb)); placeSeg(s); applySetting(s.dataset.key, sb.dataset.v); return; }
  const ws = e.target.closest('.toggle[data-wstat]'); if (ws) {
    ws.classList.toggle('on'); const list = $$('.toggle[data-wstat]', sheet).filter(x => x.classList.contains('on')).map(x => x.dataset.wstat);
    if (!list.length) { ws.classList.add('on'); toast('El widget necesita al menos un dato.'); return; }
    SH.setSetting('widgetStats', list); return;
  }
  const t = e.target.closest('.toggle[data-key]'); if (t) { t.classList.toggle('on'); applySetting(t.dataset.key, t.classList.contains('on')); return; }
  const swc = e.target.closest('#swCustom'); if (swc) {
    $$('.swatch', sheet).forEach(x => x.classList.toggle('on', x === swc)); const row = $('#cpickRow');
    if (row.hidden) { row.hidden = false; anim(row, [{ opacity: 0, transform: 'translate3d(0,-6px,0)' }, { opacity: 1, transform: 'none' }], { d: 320, e: EASE.spring }); }
    return;
  }
  const sw = e.target.closest('.swatch'); if (sw) { $$('.swatch', sheet).forEach(x => x.classList.toggle('on', x === sw)); SH.setSetting('accent', sw.dataset.a); SH.setSetting('accent2', sw.dataset.b); applyLook(); return; }
  const vc = e.target.closest('[data-variant]'); if (vc) { $$('[data-variant]', sheet).forEach(x => x.classList.toggle('on', x === vc)); applySetting('homeVariant', vc.dataset.variant); return; }
  const tool = e.target.closest('[data-tool]'); if (tool) { SH.call('run_tool', tool.dataset.tool).then(r => r === undefined ? toast('Solo funciona dentro de la app.') : !r && toast('Windows no pudo abrir esa herramienta.')); return; }
  const act = e.target.closest('[data-act]'); if (act) runAct(act.dataset.act);
});
async function runAct(a) {
  if (a === 'admin') askAdmin(true);
  else if (a === 'checkupd') toast('Estás en la última versión.');
  else if (a === 'github') { if (await SH.call('open_url', 'https://github.com/Chivitos100/StellarHub') === undefined) window.open('https://github.com/Chivitos100/StellarHub'); }
  else if (a === 'autozoom') {
    const v = String(autoZoom); const s = $('.seg[data-key="zoom"]', sheet);
    if (s) { $$('button', s).forEach(x => x.classList.toggle('on', x.dataset.v === v)); placeSeg(s); }
    SH.setSetting('zoom', v); applyZoom(); toast(`Tamaño automático: ${Math.round(autoZoom * 100)} %.`);
  }
  else if (a === 'widget' && SH.toggleWidget) SH.toggleWidget();
  else if (a === 'datadir') { if (await SH.call('open_data_dir') === undefined) toast('Solo funciona dentro de la app.'); }
  else if (a === 'export') { const p = await SH.call('export_settings'); if (p) toast('Ajustes exportados.'); }
  else if (a === 'import') {
    const d = await SH.call('import_settings'); if (d === false) toast('Ese archivo no tiene ajustes válidos.');
    else if (d) { Object.assign(state.settings, d); applyAll(); showSection(secOn); toast('Ajustes importados.'); }
  } else if (a === 'reset') {
    const old = { ...state.settings }; await SH.call('reset_settings'); try { localStorage.removeItem('sh.settings'); } catch {}
    Object.keys(state.settings).forEach(k => delete state.settings[k]); Object.assign(state.settings, SH.DEFAULTS); applyAll(); showSection(secOn);
    toast('Ajustes restablecidos.', { action: { label: 'Deshacer', run: async () => { await SH.call('settings_set', old); Object.assign(state.settings, old); applyAll(); showSection(secOn); } }, ms: 7000 });
  }
}
sheet.addEventListener('input', e => {
  const r = e.target.closest('.rng'); if (r) { const k = r.dataset.key, v = +r.value; r.style.setProperty('--p', (v - r.min) / (r.max - r.min) * 100 + '%');
    const lab = $(`[data-rv="${k}"]`, sheet); if (lab) lab.textContent = RNG_FMT[k](v); state.settings[k] = v; applyLook(); return; }
  const c = e.target.closest('input[data-color]'); if (c) { state.settings[c.dataset.color] = c.value; applyLook(); }
});
sheet.addEventListener('change', e => {
  const r = e.target.closest('.rng'); if (r) { state.settings[r.dataset.key] = undefined; SH.setSetting(r.dataset.key, +r.value); return; }
  const c = e.target.closest('input[data-color]'); if (c) { state.settings[c.dataset.color] = undefined; SH.setSetting(c.dataset.color, c.value); $$('.swatch', sheet).forEach(x => x.classList.remove('on')); }
});
function placeSeg(s, snap) {
  const on = $('button.on', s), ind = $('.ind', s); if (!on) return;
  ind.style.width = on.offsetWidth + 'px'; const x = on.offsetLeft - 3;
  if (snap || !ind.dataset.x) { ind.getAnimations().forEach(a => a.cancel()); ind.style.transform = `translateX(${x}px)`; ind.dataset.x = x; return; }
  anim(ind, [{ transform: `translateX(${ind.dataset.x}px) scaleX(1)` }, { transform: `translateX(${(+ind.dataset.x + x) / 2}px) scaleX(1.12)`, offset: .45 }, { transform: `translateX(${x}px) scaleX(1)` }], { d: 380 });
  ind.dataset.x = x;
}
SH.placeSeg = placeSeg;
function applySetting(key, val) {
  if (key === 'zoom' || key === 'theme' || key === 'density' || key === 'language' || key === 'intensity') { SH.setSetting(key, val); }
  else SH.setSetting(key, val);
  if (key === 'intensity') { applyLook(); const h = $('#intHint'); if (h) { h.textContent = INT_HINT[val]; anim(h, [{ opacity: 0, transform: 'translate3d(0,4px,0)' }, { opacity: 1, transform: 'none' }], { d: 260 }); } }
  if (['theme', 'density', 'corners', 'twinkle', 'shooting', 'quickActions', 'countUp'].includes(key)) applyLook();
  if (key === 'zoom') applyZoom();
  if (key === 'startWithWindows') SH.call('set_autostart', !!val).then(r => { if (r === false) toast('Windows no dejó cambiar el inicio automático.'); });
  if (key === 'teleRate' && SH.tele.setRate) SH.tele.setRate(+val);
  if (key === 'alwaysAdmin') SH.call('set_always_admin', !!val).then(r => { if (r === false) toast('No se pudo preparar el arranque como administrador.'); });
  if (key === 'language' && val === 'en') toast('El inglés llegará en una próxima versión.');
}
let autoZoom = 1;
function computeAutoZoom() { const w = screen.width; autoZoom = w >= 1880 ? 1.25 : w >= 1680 ? 1.15 : w >= 1480 ? 1.1 : 1; }
function applyZoom() { if (S().zoom === 'auto' || !ZOOMS.some(z => z[0] === String(S().zoom))) { S().zoom = String(autoZoom); } SH.call('set_zoom', +S().zoom); }
function applyLook() {
  const st = S(); ROOT.dataset.theme = st.theme; ROOT.dataset.density = st.density; ROOT.dataset.int = st.intensity; ROOT.dataset.corners = st.corners;
  ROOT.dataset.quick = st.quickActions ? 'on' : 'off';
  ROOT.style.setProperty('--f', SH.FACT[st.intensity] / (st.animSpeed || 1)); ROOT.style.setProperty('--accent', st.accent); ROOT.style.setProperty('--accent2', st.accent2);
  ROOT.style.setProperty('--pa', st.panelAlpha); ROOT.style.setProperty('--neb', st.nebula);
  if (stars.length !== st.starCount) makeStars(st.starCount);
  SH.emit('look');
}
function applyAll() { applyLook(); applyZoom(); }
function openSettings(section) {
  if (state.palOpen) closePal();
  state.setOpen = true; const o = $('#setO'); o.classList.add('on');
  anim($('.scrim', o), [{ opacity: 0 }, { opacity: 1 }], { d: 240 });
  anim(sheet, [{ opacity: 0, transform: 'translate3d(48px,0,0) scale(.97)', filter: 'blur(8px)' }, { opacity: 1, transform: 'translate3d(0,0,0) scale(1)', filter: 'blur(0px)' }], { d: 460, e: EASE.spring });
  requestAnimationFrame(() => showSection(section || secOn, true));
}
function closeSettings() {
  if (!state.setOpen) return; state.setOpen = false; const o = $('#setO');
  anim($('.scrim', o), [{ opacity: 1 }, { opacity: 0 }], { d: 200 });
  const a = anim(sheet, [{ opacity: 1, transform: 'translate3d(0,0,0)' }, { opacity: 0, transform: 'translate3d(36px,0,0)' }], { d: 220, e: EASE.io });
  a.finished.then(() => { if (!state.setOpen) o.classList.remove('on'); }).catch(() => {});
}
$('#gearBtn').addEventListener('click', () => state.setOpen ? closeSettings() : openSettings());
$$('.overlay').forEach(o => o.addEventListener('click', e => { if (e.target.closest('[data-close]')) o.id === 'palO' ? closePal() : closeSettings(); }));

/* ================= modo administrador ================= */
const note = $('#adminNote'); let noteShown = false, lastHint = 0;
function showNote(reason) {
  if (state.admin || noteShown) return; noteShown = true; lastHint = Date.now();
  $('#noteReason').textContent = reason || 'para instalar drivers, limpiar archivos del sistema y reparar Windows. Sin él, StellarHub funciona en modo limitado.';
  note.classList.add('on');
  anim(note, [{ opacity: 0, transform: 'translate3d(0,-8px,0) scale(.94)', filter: 'blur(6px)' }, { opacity: 1, transform: 'translate3d(0,0,0) scale(1)', filter: 'blur(0px)' }], { d: 420, e: EASE.spring });
}
function hideNote() {
  if (!noteShown) return; noteShown = false; note.classList.remove('on');
  anim(note, [{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'translate3d(0,-6px,0) scale(.96)' }], { d: 180 });
  if ($('#noteNever').classList.contains('on')) SH.setSetting('adminHints', false);
}
/* lo usan los módulos antes de algo que necesita permisos: sugiere sin insistir (como mucho una vez cada 10 min) */
SH.requireAdmin = reason => { if (state.admin) return true; if (S().adminHints && Date.now() - lastHint > 600000) showNote(reason); else toast('Esto necesita el modo administrador.', { action: { label: 'Activar', run: () => askAdmin(true) } }); return false; };
async function askAdmin(direct) {
  if (state.admin) return; if (!direct && !noteShown) { showNote(); return; }
  hideNote();
  /* el permiso queda permanente (se puede quitar en Ajustes > Administrador) */
  state.settings.alwaysAdmin = true; await SH.call('settings_set', { alwaysAdmin: true });
  const r = await SH.call('relaunch_admin');
  if (r === true) toast('Abriendo StellarHub como administrador…');
  else if (r === false) toast('Windows no dio el permiso. Sigues en modo normal.');
  else { setAdmin(true); toast('Modo administrador (simulado fuera de la app).'); }
}
function setAdmin(on) {
  state.admin = on; const pill = $('#modePill'); pill.classList.toggle('admin', on); const txt = $('#modeTxt');
  anim(txt, [{ opacity: 1, transform: 'none', filter: 'blur(0px)' }, { opacity: 0, transform: 'translate3d(0,-8px,0)', filter: 'blur(4px)' }], { d: 160 }).finished.then(() => {
    txt.textContent = on ? 'Modo administrador' : 'Modo normal';
    anim(txt, [{ opacity: 0, transform: 'translate3d(0,8px,0)', filter: 'blur(4px)' }, { opacity: 1, transform: 'none', filter: 'blur(0px)' }], { d: 300, e: EASE.spring });
  }).catch(() => {});
  anim(pill, [{ transform: 'scale(1)' }, { transform: 'scale(1.08)', offset: .35 }, { transform: 'scale(1)' }], { d: 460 });
}
$('#modePill').addEventListener('click', () => { if (state.admin) { openSettings('admin'); return; } noteShown ? hideNote() : showNote(); });
$('#adminYes').addEventListener('click', () => askAdmin(true));
$('#adminNo').addEventListener('click', hideNote);
$('#noteNever').addEventListener('click', e => e.currentTarget.classList.toggle('on'));

/* ================= avisos ================= */
/* abajo a la derecha, como mucho 3 a la vez; si llega uno que ya está, se refresca en vez de apilarse.
   Abrir/cerrar lo mismo (p. ej. el widget) sustituye al aviso anterior del mismo grupo. */
const MAX_TOASTS = 3;
function toast(text, o = {}) {
  const box = $('#toasts'); const group = o.group || text;
  const same = [...box.children].find(x => x.dataset.group === group && !x.dataset.dead);
  if (same) {
    same.querySelector('span').textContent = text; clearTimeout(same._timer); same._timer = setTimeout(same._kill, o.ms || 3600);
    anim(same, [{ transform: 'scale(1)' }, { transform: 'scale(1.04)', offset: .4 }, { transform: 'scale(1)' }], { d: 320, keep: true });
    return;
  }
  const t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status'); t.dataset.group = group;
  t.innerHTML = `<span>${esc(text)}</span>${o.action ? `<button class="btn sm">${esc(o.action.label)}</button>` : ''}`;
  if (o.action) $('button', t).addEventListener('click', () => { o.action.run(); kill(); });
  box.appendChild(t);
  anim(t, [{ opacity: 0, transform: 'translate3d(24px,0,0) scale(.94)', filter: 'blur(6px)' }, { opacity: 1, transform: 'none', filter: 'blur(0px)' }], { d: 440, e: EASE.spring });
  function kill() { if (t.dataset.dead) return; t.dataset.dead = '1'; clearTimeout(t._timer);
    anim(t, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translate3d(24px,0,0) scale(.96)' }], { d: 220 }).finished.then(() => t.remove()).catch(() => t.remove()); }
  t._kill = kill; t._timer = setTimeout(kill, o.ms || 3600);
  const live = [...box.children].filter(x => !x.dataset.dead); if (live.length > MAX_TOASTS) live.slice(0, live.length - MAX_TOASTS).forEach(x => x._kill && x._kill());
}
async function renderLangs() {
  const el = $('#langs'); if (!el) return;
  const COL = { Python: '#3572A5', JavaScript: '#F1E05A', CSS: '#663399', HTML: '#E34C26' };
  const d = await SH.call('project_stats') || { JavaScript: 520000, CSS: 140000, Python: 60000, HTML: 14000 };
  const tot = Object.values(d).reduce((a, b) => a + b, 0) || 1; const rows = Object.entries(d).sort((a, b) => b[1] - a[1]);
  el.innerHTML = `<div class="lbar">${rows.map(([k, v]) => `<span style="flex:${v};background:${COL[k] || 'var(--mute)'}"></span>`).join('')}</div>
    <div class="llist">${rows.map(([k, v]) => `<span><i style="background:${COL[k] || 'var(--mute)'}"></i>${k} <b>${SH.fmt1(v / tot * 100)} %</b></span>`).join('')}</div>`;
  $$('.lbar span', el).forEach((s, i) => anim(s, [{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }], { d: 700, delay: i * 90, e: EASE.out }));
}
SH.toast = toast;

/* ================= teclado ================= */
const ORDER = DOCK.filter(x => x !== '|');
addEventListener('keydown', e => {
  const k = e.key.toLowerCase();
  if ((e.ctrlKey || e.metaKey) && k === 'k') { e.preventDefault(); state.palOpen ? closePal() : openPal(); return; }
  if ((e.ctrlKey || e.metaKey) && k === ',') { e.preventDefault(); state.setOpen ? closeSettings() : openSettings(); return; }
  if ((e.ctrlKey || e.metaKey) && /^[1-9]$/.test(k)) { e.preventDefault(); const id = ORDER[+k - 1]; if (id) go(id); return; }
  if (e.key === 'Escape') { if (state.palOpen) closePal(); else if (state.setOpen) closeSettings(); else if (noteShown) hideNote(); else if (state.view !== 'home') go('home'); return; }
  if (state.palOpen) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setPalIdx(palIdx + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setPalIdx(palIdx - 1); }
    else if (e.key === 'Enter') { e.preventDefault(); runItem(palList[palIdx]); }
  }
});

/* ================= arranque ================= */
SH.boot = async () => {
  computeAutoZoom();
  await SH.loadSettings();
  const [info, pc] = await Promise.all([SH.call('info'), SH.call('pc_info')]);
  if (pc && pc.components) { Object.assign(SH.PC, pc); SH.PC.real = true; }
  if (info) { state.version = info.version; if (info.admin) { state.admin = true; $('#modePill').classList.add('admin'); $('#modeTxt').textContent = 'Modo administrador'; } }
  applyLook(); applyZoom();
  MODS.filter(m => m.id !== 'home').forEach(buildModule);
  SH.on('module:registered', def => { if (def.id !== 'home' && modById(def.id)) buildModule(modById(def.id)); });
  anim($('.top'), [{ opacity: 0, transform: 'translate3d(0,-10px,0)' }, { opacity: 1, transform: 'none' }], { d: 600, delay: 300 });
  anim(dock, [{ opacity: 0, transform: 'translateX(-50%) translate3d(0,30px,0) scale(.9)' }, { opacity: 1, transform: 'translateX(-50%) translate3d(0,0,0) scale(1)' }], { d: 800, delay: 900, e: EASE.spring });
  if (!state.admin && S().adminHints) setTimeout(() => showNote(), 4200);
  SH.emit('boot');
  /* rutas para pruebas: #drivers/all abre esa pestaña, #drivers/* recorre todas, #home=xray fuerza una vista de inicio */
  const h = decodeURIComponent(location.hash.slice(1));
  const hv = h.match(/^home=(\w+)$/); if (hv) setTimeout(() => SH.setSetting('homeVariant', hv[1]), 50);
  SH.on('view', d => SH.setSetting('lastView', d.to));
  const sv = S().startView === 'last' ? S().lastView : S().startView;
  if (!h && sv && sv !== 'home' && modById(sv)) setTimeout(() => go(sv), 700);
  const hm = h.match(/^(\w+)(?:\/([\w*]+))?$/);
  if (hm && modById(hm[1]) && hm[1] !== 'home') setTimeout(() => {
    if (hm[2] === '*') { go(hm[1]); tabsOf(modById(hm[1])).forEach((t, i) => setTimeout(() => setTab(hm[1], t.id), 300 * i)); }
    else go(hm[1], { tab: hm[2] });
  }, 100);
};
})();
