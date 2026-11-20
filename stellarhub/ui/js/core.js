/* StellarHub · core: utilities, animation engine, icons, PC data and module registry.
   Everything hangs off window.SH. See docs/UI_CONTRACT.md for how modules and Home views are written. */
'use strict';
(() => {
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const ROOT = document.documentElement;
/* SH.t remembers its last results (text -> English key + vars) so SH.logActivity can store what a line says
   in English and translate it when it is shown, whatever language it was written in. Cheap: 64 entries. */
const _recent = new Map();
if (window.SH && SH.t && !SH.t._rec) {
  const _t0 = SH.t;
  SH.t = (s, v) => { const r = _t0(s, v); if (typeof s === 'string' && r) { _recent.delete(r); _recent.set(r, [s, v && typeof v === 'object' ? { ...v } : v]); if (_recent.size > 64) _recent.delete(_recent.keys().next().value); } return r; };
  SH.t._rec = true;
}
const t = (window.SH && SH.t) || (s => s); // i18n.js ran first
const reduceMQ = matchMedia('(prefers-reduced-motion: reduce)');

/* ---------- state and settings ---------- */
const DEFAULTS = {
  theme: 'deep', accent: '#FF7A66', accent2: '#9ED6FF', zoom: 'auto', intensity: reduceMQ.matches ? 'min' : 'max',
  stars: true, camera: true, parallax: true, homeVariant: 'bento', adminHints: true, trayOnClose: true,
  startWithWindows: false, autoUpdate: true, autoUpdateFeatures: true, skipVersion: '', language: 'auto', density: 'comfortable', sounds: false,
  widgetStats: ['cpu', 'gpu', 'gpuTemp', 'ram', 'down', 'ping'], widgetLayout: 'grid',
  starCount: 400, starSpeed: 1.5, starBright: 1.2, widgetMode: 'full', widgetWasOpen: false, alwaysAdmin: false, twinkle: true, shooting: true, nebula: 1, animSpeed: 1, panelAlpha: 1.75, corners: 'mid',
  countUp: true, startView: 'home', quickActions: true, confirmDanger: true, teleRate: '1000', measurePing: true, lastView: 'home', batterySaver: true, lightMode: 'auto', registryCleaner: false,
};
const state = { view: 'home', admin: false, palOpen: false, setOpen: false, version: '0.2.0', settings: { ...DEFAULTS }, lite: false };
const FACT = { max: 1, normal: .72, min: .3 };
const ORBIT = { max: 1, normal: .55, min: 0 };
/* state.lite: lighter effects are on (setting lightMode: automatic = on battery or integrated graphics only, always, never; telemetry.js sets it). The intensity the
   user chose stays as it is in the settings; effInt() is the one the animations use: one step lower while lite. */
const effInt = () => { const i = state.settings.intensity; return state.lite && i === 'max' ? 'normal' : i; };
const motion = () => FACT[effInt()] ?? 1;

/* simple events between parts of the UI */
const bus = {};
const on = (ev, fn) => { (bus[ev] ||= new Set()).add(fn); return () => bus[ev].delete(fn); };
const emit = (ev, data) => (bus[ev] || []).forEach(fn => { try { fn(data); } catch (e) { console.error(e); } });

/* bridge to Python (window.pywebview.api); outside the app it falls back to localStorage */
const api = () => (window.pywebview && window.pywebview.api) || null;
/* Inside the app (WebView2 always exposes window.chrome.webview) the bridge to Python can take several seconds on
   a slow start (elevated relaunch, first launch while Defender scans the files): wait for it, polling as a fallback
   in case the ready event fired before this script ran. In a normal browser there is no bridge: sample mode. */
const IN_APP = !!(window.chrome && window.chrome.webview);
const apiReady = new Promise(res => {
  if (api()) return res(api());
  addEventListener('pywebviewready', () => res(api()), { once: true });
  if (!IN_APP) { setTimeout(() => res(api()), 1200); return; }
  const t0 = Date.now(), poll = setInterval(() => {
    if (api() || Date.now() - t0 > 60000) { clearInterval(poll); res(api()); }
  }, 100);
});
async function call(name, ...args) {
  const a = await apiReady;
  if (!a) return undefined;
  /* pywebview can announce the API before all its methods are attached (seen right after relaunching as
     administrator): wait for the method instead of answering "nothing" to whoever asked first */
  const api = () => (window.pywebview && window.pywebview.api) || a;
  for (let i = 0; typeof api()[name] !== 'function' && i < 60; i++) await new Promise(r => setTimeout(r, 100));
  const target = api();
  if (typeof target[name] !== 'function') { console.error(`API method missing: ${name}`); return undefined; }
  try { return await target[name](...args); } catch (e) { console.error(name, e); return undefined; }
}
/* UI errors -> app log */
const reportErr = m => { try { if (window.pywebview && window.pywebview.api && window.pywebview.api.log_js_error) window.pywebview.api.log_js_error(String(m)); } catch {} };
addEventListener('error', e => reportErr(`${e.message} @ ${(e.filename || '').split('/').pop()}:${e.lineno}`));
addEventListener('unhandledrejection', e => reportErr(`promise: ${e.reason && (e.reason.stack || e.reason.message) || e.reason}`));
const _cerr = console.error.bind(console); console.error = (...a) => { _cerr(...a); reportErr(a.map(x => x && x.stack || x).join(' ')); };

/* real engine (stellarhub/engine/<mod>.py). Outside the app these return undefined: the module uses its sample mode.
   SH.engine('drivers', 'list') -> data (throws Error if the engine fails)
   SH.job('drivers', 'search', [args], { onProgress(msg), onLog(lines) }) -> promise with the result; .cancel() */
async function engine(mod, fn, ...args) {
  const r = await call('engine', mod, fn, args);
  if (r === undefined) return undefined;
  if (!r.ok) throw new Error(r.error || t('the engine failed'));
  return r.data;
}
const jobWaiters = new Map();
/* A job can send its updates (even its end) before the answer to "start it" reaches the page and the waiter exists:
   a fast or cached job would otherwise never resolve. Updates for ids nobody waits for yet are kept for a moment. */
const jobEarly = new Map();
function jobDeliver(w, m) {
  if (m.kind === 'progress' || m.kind === 'end') { try { w.o.onProgress && w.o.onProgress(m); } catch (e) { console.error(e); } }
  if (m.log && w.o.onLog) { try { w.o.onLog(m.log); } catch (e) { console.error(e); } }
  if (m.kind === 'end') {
    if (m.state === 'done') w.res(m.result); else if (m.state === 'cancelled') w.rej(Object.assign(new Error('cancelled'), { cancelled: true }));
    else w.rej(new Error((m.result && m.result.error) || t('the task failed')));
  }
}
on('job', m => {
  const w = jobWaiters.get(m.id);
  if (!w) {
    let e = jobEarly.get(m.id);
    if (!e) { e = []; jobEarly.set(m.id, e); setTimeout(() => jobEarly.delete(m.id), 20000); }
    if (e.length < 200 || m.kind === 'end') e.push(m);
    return;
  }
  if (m.kind === 'end') jobWaiters.delete(m.id);
  jobDeliver(w, m);
});
function job(mod, fn, args = [], o = {}) {
  let id = null, cancelWanted = false;
  const p = new Promise(async (res, rej) => {
    const r = await call('engine_job', mod, fn, args);
    if (r === undefined) { res(undefined); return; }
    if (!r.ok) { rej(new Error(r.error)); return; }
    id = r.id; const w = { res, rej, o }; jobWaiters.set(id, w); if (cancelWanted) call('job_cancel', id);
    const early = jobEarly.get(id);
    if (early) { jobEarly.delete(id); for (const m of early) { if (m.kind === 'end') jobWaiters.delete(id); jobDeliver(w, m); } }
  });
  p.cancel = () => { cancelWanted = true; if (id) call('job_cancel', id); };
  return p;
}
/* Saved settings come from disk (an older build, a hand-edited file): never trust their types. Keys that have a
   default must have the same type (numbers also inside their range); keys without one (the lists and maps the
   modules keep) must have the shape below. Anything else falls back to the default, or is dropped, key by key. */
const RANGE = { starCount: [0, 3000], starSpeed: [0, 5], starBright: [0, 3], nebula: [0, 3], animSpeed: [.25, 3], panelAlpha: [0, 3] };
const ENUM = { intensity: ['max', 'normal', 'min'], lightMode: ['auto', 'always', 'never'], widgetLayout: ['grid', 'list', 'row'] };
const SHAPE = { activity: 'a', hangarKits: 'a', cleanExclusions: 'a', autopilotRoutines: 'a', autopilotLog: 'a',
  pending: 'o', updIgnored: 'o', updSchedule: 'o', testerKbMissing: 'o', autopilotNotify: 'o', cpsBest: 'n', autopilotSchema: 'n' };
const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
function sanitizeSettings(saved) {
  const out = {};
  if (!isObj(saved)) return out;
  for (const [k, v] of Object.entries(saved)) {
    if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
    if (k in DEFAULTS) {
      const d = DEFAULTS[k];
      if (Array.isArray(d)) { if (Array.isArray(v)) out[k] = typeof d[0] === 'string' ? v.filter(x => typeof x === 'string') : v; }
      else if (typeof d === 'number') { if (typeof v === 'number' && isFinite(v)) { const r = RANGE[k]; out[k] = r ? Math.min(r[1], Math.max(r[0], v)) : v; } }
      else if (typeof d === 'boolean') { if (typeof v === 'boolean') out[k] = v; }
      else if (typeof d === 'string') { if (typeof v === 'string' && (!ENUM[k] || ENUM[k].includes(v))) out[k] = v; }
      else out[k] = v;
    } else if (SHAPE[k]) {
      const sh = SHAPE[k];
      if (sh === 'a' ? Array.isArray(v) : sh === 'o' ? isObj(v) : typeof v === 'number' && isFinite(v)) out[k] = v;
    } else out[k] = v;
  }
  return out;
}
async function loadSettings() {
  let saved = await call('settings_get');
  const inApp = saved !== undefined;
  if (saved === undefined) { try { saved = JSON.parse(localStorage.getItem('sh.settings') || '{}'); } catch { saved = {}; } }
  Object.assign(state.settings, sanitizeSettings(saved));
  /* before the three-way "Lighter effects" choice there was a yes/no (batterySaver): no becomes Never, yes is Automatic */
  if (saved && typeof saved === 'object' && saved.lightMode === undefined && saved.batterySaver === false) state.settings.lightMode = 'never';
  /* the registry cleaner is opt-in (setting registryCleaner, default off). Someone upgrading, with no such key saved yet,
     keeps it on only if they already have registry-fix backups; the answer is saved so this runs once. */
  if (inApp && isObj(saved) && typeof saved.registryCleaner !== 'boolean') {
    let had = false; try { had = (await engine('optimizer', 'registry_backups_exist')) === true; } catch {}
    state.settings.registryCleaner = had; call('settings_set', { registryCleaner: had });
  }
  /* the language lives in the settings; i18n.js read a local copy to translate before this point. If they differ
     (first start after installing in another language, or changed elsewhere), switch once. */
  const L = window.SH && SH.i18n;
  if (L) {
    const pref = state.settings.language || 'auto';
    if (pref !== L.pref) {
      L.remember(pref);
      let ok = false; try { ok = localStorage.getItem('sh.lang') === pref; } catch {}
      if (ok && L.resolve(pref) !== L.lang) location.reload(); // only if it really changes, and never in a loop
    }
  }
}
function setSetting(key, val) {
  if (state.settings[key] === val) return;
  state.settings[key] = val;
  call('settings_set', { [key]: val }).then(r => {
    if (r === undefined) { try { localStorage.setItem('sh.settings', JSON.stringify(state.settings)); } catch {} }
  });
  emit('setting', { key, val });
}

/* ---------- springs ---------- */
class Spring {
  constructor(v = 0, k = 170, c = 24) { this.v = v; this.t = v; this.vel = 0; this.k = k; this.c = c; }
  set(v) { this.v = this.t = v; this.vel = 0; return this; }
  step(dt) {
    const it = effInt();
    if (it === 'min') { this.v = this.t; this.vel = 0; return this.v; }
    const k = it === 'normal' ? this.k * 1.5 : this.k, c = it === 'normal' ? this.c * 1.22 : this.c;
    const n = Math.ceil(dt / 0.008), h = dt / n;
    for (let i = 0; i < n; i++) { const a = -k * (this.v - this.t) - c * this.vel; this.vel += a * h; this.v += this.vel * h; }
    return this.v;
  }
  get idle() { return Math.abs(this.v - this.t) < 1e-3 && Math.abs(this.vel) < 1e-3; }
}
function springEase(k = 180, c = 19) {
  let x = 0, v = 0; const pts = []; const h = 1 / 60;
  for (let i = 0; i <= 60; i++) { pts.push(+x.toFixed(4)); for (let j = 0; j < 4; j++) { const a = -k * (x - 1) - c * v; v += a * h / 4; x += v * h / 4; } }
  pts[pts.length - 1] = 1; return `linear(${pts.join(',')})`;
}
/* springs keep the orbital, living feel but are damped (about 0.85) so they settle instead of wobbling */
const EASE = { out: 'cubic-bezier(.16,1,.3,1)', io: 'cubic-bezier(.62,0,.18,1)', spring: springEase(180, 22.5), soft: springEase(120, 19), snappy: springEase(300, 30),
  glide: springEase(150, 22) /* settles without overshoot: smooth view and tab changes */ };

/* WAAPI with the motion intensity applied. Cancels whatever the element was animating (interruptible). */
function anim(el, kf, o = {}) {
  if (!el) return null;
  /* only animations made with anim() are interrupted; CSS transitions carry on */
  if (!o.keep) el.getAnimations().forEach(a => { if (typeof CSSTransition !== 'undefined' && a instanceof CSSTransition) return; try { a.commitStyles(); } catch {} a.cancel(); });
  const d = Math.max(1, (o.d ?? 400) * motion());
  /* blur() on a big animated layer costs a full-size shader pass every frame: on battery the same entrance runs without it */
  if (Array.isArray(kf) && kf.some(k => k.filter)) {
    /* and on a big surface (a view, the settings sheet: more than about 280,000 px) the blur is never worth it, lite or not */
    let big = state.lite; if (!big) { const r = el.getBoundingClientRect(); big = r.width * r.height > 280000; }
    if (big) kf = kf.map(({ filter, ...k }) => k);
  }
  return el.animate(kf, { duration: d, delay: (o.delay || 0) * motion(), easing: o.e || EASE.out, fill: o.fill || 'both' });
}
/* staggered entrance of everything marked [data-asm] inside a container */
function assemble(root, base = 0, step = 40, sel = '[data-asm]') {
  $$(sel, root).forEach((el, i) => anim(el, [
    { opacity: 0, transform: 'translate3d(0,14px,0) scale(.97)' },
    { opacity: 1, transform: 'translate3d(0,0,0) scale(1)' }
  ], { d: 520, delay: base + Math.min(i, 14) * step, e: EASE.spring }));
}

/* single per-frame animation loop */
const tickers = new Set(); let last = performance.now();
/* The tickers (springs, charts, the 3D scene) do not need the display's refresh rate: on a 144 or 165 Hz laptop screen
   every extra frame is a full-window composite for the GPU. They run at most ~70 times a second, ~30 on battery. */
function loop(t) {
  if (t - last < (state.lite ? 28 : 12)) { requestAnimationFrame(loop); return; }
  const dt = Math.min(.05, (t - last) / 1000); last = t; for (const fn of tickers) { try { fn(dt, t); } catch (e) { console.error(e); tickers.delete(fn); } } requestAnimationFrame(loop); }
requestAnimationFrame(loop);

/* ---------- formatting ---------- */
/* numbers follow the interface language (1,234.5 in English, 1.234,5 in Spanish...) */
const LOCALE = (window.SH && SH.i18n && SH.i18n.locale) || 'en-US';
const fmt1 = v => (+v).toLocaleString(LOCALE, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const fmtInt = v => Math.round(+v).toLocaleString(LOCALE);
function fmtBytes(b) { const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0; while (b >= 1024 && i < u.length - 1) { b /= 1024; i++; } return (i ? fmt1(b) : Math.round(b)) + ' ' + u[i]; }
function countUp(el, to, d = 900, dec = 0) {
  if (state.settings.countUp === false) { el.textContent = dec ? fmt1(to) : fmtInt(to); el.dataset.v = to; return; }
  const t0 = performance.now(), dur = Math.max(1, d * motion()); const from = +(el.dataset.v || 0);
  const f = t => { const k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 4), v = from + (to - from) * e;
    el.textContent = dec ? fmt1(v) : fmtInt(v); if (k < 1) requestAnimationFrame(f); else el.dataset.v = to; };
  requestAnimationFrame(f);
}
/* rolling number (odometer): when the text changes, each character that differs slides to its next value (the old one
   up and out, the new one in from below; the other way when the number goes down). Compositor only (transform and
   opacity through WAAPI). Every character sits in a clipped, fixed-width cell, so only the outgoing and the incoming
   glyph can ever be seen and nothing shifts sideways. A counter that is fed many times a second is coalesced: the
   element shows the latest value at most every ~200 ms, and any roll still under way is cancelled first, so animations
   never stack and no stale glyph is left behind. Plain text while the lighter mode is on, at intensity "minimum" or when
   the count-up setting is off.   SH.rollNumber(el, 77390, { format: SH.fmtInt }); a string is shown as it is. */
const ROLL_GAP = 240;
/* a counter fed many times a second (files read during a scan) does not roll: every digit changes on every update,
   so a roll would only ever show half-moved glyphs. It counts up instead, frame by frame, easing toward the latest
   value: it never jumps and only one value is ever on screen.   SH.rollNumber(el, n, { tick: true }) */
function tickTo(el, value, o) {
  const f = o.format || fmtInt;
  if (el._rn) { if (el._rn.timer) clearTimeout(el._rn.timer); el._rn = null; el.textContent = f(+(el.dataset.v || 0)); }
  let tk = el._tk;
  if (!tk) { tk = el._tk = { cur: value, to: value, raf: 0 }; el.textContent = f(value); return; }
  tk.to = value; tk.f = f;
  if (tk.raf) return;
  let prev = performance.now();
  const step = now => {
    const dt = Math.min(.1, (now - prev) / 1000); prev = now;
    const gap = tk.to - tk.cur;
    tk.cur = Math.abs(gap) < 1 ? tk.to : tk.cur + gap * (1 - Math.exp(-dt * 9));   /* ~90% of the way in a quarter second */
    el.textContent = tk.f(Math.round(tk.cur));
    tk.raf = tk.cur === tk.to || el._tk !== tk ? 0 : requestAnimationFrame(step);
  };
  tk.raf = requestAnimationFrame(step);
}
function rollNumber(el, value, o = {}) {
  if (!el) return;
  const num = typeof value === 'number' && isFinite(value);
  const fast = num && o.tick && !(state.lite || effInt() === 'min' || state.settings.countUp === false || o.plain || document.hidden);
  if (fast) { el.dataset.v = value; tickTo(el, value, o); return; }
  if (el._tk) { if (el._tk.raf) cancelAnimationFrame(el._tk.raf); el._tk = null; }
  const txt = num ? (o.format || fmtInt)(value) : String(value);
  if (num) el.dataset.v = value;
  let rn = el._rn;
  if (rn && rn.cols && (!rn.cols.length || rn.cols[0].el.parentNode !== el)) rn = el._rn = null; /* something else rewrote the element */
  const plain = state.lite || effInt() === 'min' || state.settings.countUp === false || o.plain || document.hidden;
  if (rn && rn.timer) { rn.next = { txt, num: num ? value : null, o }; return; } /* a newer value replaces the waiting one */
  if (rn && rn.txt === txt && (rn.cols || el.textContent === txt)) return;
  if (!rn || plain || !rn.cols) {
    if (plain) { el.textContent = txt; el._rn = { txt, num: num ? value : null, cols: null, t: performance.now() }; }
    else { build(el, txt); el._rn.num = num ? value : null; }
    return;
  }
  const wait = rn.t + ROLL_GAP - performance.now();
  if (wait > 4) {
    rn.next = { txt, num: num ? value : null, o };
    rn.timer = setTimeout(() => { const n = rn.next; rn.timer = 0; rn.next = null; if (el._rn === rn && n) rollNumber(el, n.num != null ? n.num : n.txt, { ...n.o, format: n.num != null ? () => n.txt : undefined }); }, wait);
    return;
  }
  const cols = rn.cols, old = rn.txt, nw = Array.from(txt), od = Array.from(old);
  const dir = num && rn.num != null && value < rn.num ? -1 : 1, dur = (o.d ?? 230) * motion(), dy = dir * (effInt() === 'normal' ? 60 : 85);
  const mk = ch => { const e = document.createElement('rn-c'), cur = document.createElement('rn-n'); setCh(e, ch); cur.textContent = ch; e.appendChild(cur); return { el: e, cur, anim: null, ghost: null }; };
  const out = [];
  for (let k = 1; k <= Math.max(nw.length, od.length); k++) {
    const a = od[od.length - k], b = nw[nw.length - k], c = cols[od.length - k];
    if (b === undefined) { if (c) { c.anim && c.anim.cancel(); c.el.remove(); } continue; }
    if (a === b && c) { out.unshift(c); continue; }
    if (a === undefined || !c) {
      const col = mk(b); el.insertBefore(col.el, el.firstChild); out.unshift(col);
      col.el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: dur * .7, easing: 'ease-out' });
      continue;
    }
    /* clean state first: whatever was still moving in this cell is dropped */
    if (c.anim) { try { c.anim.cancel(); } catch {} c.anim = null; }
    c.el.querySelectorAll('rn-g').forEach(g => g.remove());
    const g = document.createElement('rn-g'); g.textContent = a; c.el.appendChild(g);
    c.cur.textContent = b; setCh(c.el, b);
    const ease = { duration: dur, easing: EASE.out, fill: 'both' };
    const ga = g.animate([{ opacity: 1, transform: 'translate3d(0,0,0)', offset: 0 }, { opacity: 0, transform: `translate3d(0,${-dy * .6}%,0)`, offset: .42 }, { opacity: 0, transform: `translate3d(0,${-dy}%,0)`, offset: 1 }], ease);
    ga.onfinish = () => g.remove();
    c.anim = c.cur.animate([{ opacity: 0, transform: `translate3d(0,${dy}%,0)`, offset: 0 }, { opacity: 0, transform: `translate3d(0,${dy * .6}%,0)`, offset: .38 }, { opacity: 1, transform: 'translate3d(0,0,0)', offset: 1 }], ease);
    c.anim.onfinish = () => { if (c.anim) { try { c.anim.cancel(); } catch {} c.anim = null; } };
    out.unshift(c);
  }
  el.setAttribute('aria-label', txt);
  rn.cols = out; rn.txt = txt; rn.num = num ? value : null; rn.t = performance.now();
}
const setCh = (e, ch) => { e.dataset.c = ch; if (/\d/.test(ch)) e.dataset.d = ''; else delete e.dataset.d; };
function build(el, txt) {
  el.textContent = ''; el.setAttribute('aria-label', txt); el.style.whiteSpace = 'nowrap'; /* columns are atomic: never wrap between them */
  const cols = Array.from(txt).map(ch => {
    const e = document.createElement('rn-c'), cur = document.createElement('rn-n'); setCh(e, ch); e.setAttribute('aria-hidden', 'true');
    cur.textContent = ch; e.appendChild(cur); el.appendChild(e);
    return { el: e, cur, anim: null, ghost: null };
  });
  el._rn = { txt, num: null, cols, t: performance.now(), timer: 0, next: null };
}
/* shrinks the font size until the text fits on one line */
function fitText(el, max, min = 14) {
  if (!el || !el.parentElement) return;
  el.style.whiteSpace = 'nowrap'; let s = max; el.style.fontSize = s + 'px';
  const w = el.parentElement.clientWidth;
  while (el.scrollWidth > w && s > min) { s -= 1; el.style.fontSize = s + 'px'; }
}
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ---------- icons (24×24 stroke) ---------- */
const P = {
  home: '<circle cx="12" cy="12" r="3"/><ellipse cx="12" cy="12" rx="9.5" ry="4" transform="rotate(-22 12 12)"/>',
  monitor: '<path d="M3 12h3.5l2.5-6 4 12 2.5-6H21"/>',
  drivers: '<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4"/><path d="M12 9v6m-2.5-2.5L12 15l2.5-2.5"/>',
  remover: '<path d="M4 7h16M9 7V4.5h6V7M6.5 7l1 13h9l1-13"/><path d="M10 11v5M14 11v5"/>',
  updater: '<path d="M20 11a8 8 0 0 0-14.7-4.4L4 8"/><path d="M4 4v4h4"/><path d="M4 13a8 8 0 0 0 14.7 4.4L20 16"/><path d="M20 20v-4h-4"/>',
  storage: '<rect x="3" y="3" width="18" height="18" rx="2.5"/><path d="M12 3v18M12 12h9M16.5 12v9"/>',
  optimizer: '<path d="M5 18a8 8 0 1 1 14 0"/><path d="m12 13 4-5"/><circle cx="12" cy="13" r="1.4"/>',
  tester: '<rect x="2.5" y="6" width="19" height="12" rx="2.5"/><path d="M6.5 10h.01M10 10h.01M14 10h.01M17.5 10h.01M7 14h10"/>',
  hangar: '<path d="M2.5 20.5h19"/><path d="M4 20.5v-9a8 6.5 0 0 1 16 0v9"/><path d="M8.5 20.5V14h7v6.5"/><path d="M12 14v6.5M8 8.5h8"/>',
  privacy: '<path d="M12 2.8 19.5 6v5.6c0 4.4-3.1 8.2-7.5 9.6-4.4-1.4-7.5-5.2-7.5-9.6V6Z"/><rect x="9.2" y="11" width="5.6" height="4.6" rx="1"/><path d="M10.4 11V9.6a1.6 1.6 0 0 1 3.2 0V11"/>',
  benchmark: '<circle cx="12" cy="13.5" r="7.5"/><path d="M10 2.5h4M12 2.5V6M18.2 6.8l1.6-1.6"/><path d="m12 13.5 3.2-3.2"/><circle cx="12" cy="13.5" r=".6"/>',
  autopilot: '<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5v3M12 17.5v3M3.5 12h3M17.5 12h3"/><path d="m9.5 14.5 1.6-4.2 4.2-1.6-1.6 4.2z"/>',
  cpu: '<rect x="6" y="6" width="12" height="12" rx="2"/><rect x="9.5" y="9.5" width="5" height="5" rx=".8"/><path d="M9 2.5V6M15 2.5V6M9 18v3.5M15 18v3.5M2.5 9H6M2.5 15H6M18 9h3.5M18 15h3.5"/>',
  gpu: '<rect x="2.5" y="6" width="19" height="11" rx="2"/><circle cx="9" cy="11.5" r="3"/><path d="M15 9.5h3.5M15 13h3.5M5 17v2.5M9 17v2.5"/>',
  ram: '<rect x="2.5" y="7" width="19" height="9" rx="1.5"/><path d="M6 10v3M10 10v3M14 10v3M18 10v3M2.5 19h19M7 16v3M17 16v3"/>',
  ssd: '<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M7 15h6"/><circle cx="16.5" cy="15" r="1"/><path d="M7 9h10"/>',
  display: '<rect x="2.5" y="4" width="19" height="12.5" rx="2"/><path d="M8.5 20.5h7M12 16.5v4"/>',
  battery: '<rect x="2.5" y="7" width="17" height="10" rx="2.2"/><path d="M21.5 10.5v3"/><path d="M6 10.5v3M9.5 10.5v3M13 10.5v3"/>',
  wifi: '<path d="M2.5 9a14 14 0 0 1 19 0"/><path d="M5.5 12.5a9.5 9.5 0 0 1 13 0"/><path d="M8.7 16a5 5 0 0 1 6.6 0"/><circle cx="12" cy="19.2" r=".9"/>',
  sys: '<path d="m12 3 9 4.5-9 4.5-9-4.5z"/><path d="m3 12 9 4.5 9-4.5"/><path d="m3 16.5 9 4.5 9-4.5"/>',
  audio: '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>',
  temp: '<path d="M10 14.5V5a2 2 0 1 1 4 0v9.5a4 4 0 1 1-4 0z"/><path d="M12 10v6.5"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  shield: '<path d="M12 3 4.5 6v5.5c0 4.5 3.2 8 7.5 9.5 4.3-1.5 7.5-5 7.5-9.5V6z"/><path d="m9 12 2 2 4-4"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/>',
  speaker: '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>',
  camera: '<rect x="3" y="6.5" width="13" height="11" rx="2"/><path d="m16 10.5 5-3v9l-5-3"/>',
  mouse: '<rect x="6" y="3" width="12" height="18" rx="6"/><path d="M12 7v3"/>',
  broom: '<path d="m14 4 6 6M12.5 8.5 4 17l3 3 8.5-8.5"/><path d="M15.5 8.5 11 4"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>',
  chev: '<path d="m9 6 6 6-6 6"/>', chevd: '<path d="m6 9 6 6 6-6"/>', x: '<path d="M6 6l12 12M18 6 6 18"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>', plus: '<path d="M12 5v14M5 12h14"/>', minus: '<path d="M5 12h14"/>',
  dots: '<circle cx="5.5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="18.5" cy="12" r="1"/>',
  alert: '<path d="M12 3.5 2.5 20h19z"/><path d="M12 10v4.5M12 17.5h.01"/>', info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.5h.01"/>',
  play: '<path d="M7 5v14l12-7z"/>', pause: '<path d="M8 5v14M16 5v14"/>', stop: '<rect x="6" y="6" width="12" height="12" rx="1.5"/>',
  folder: '<path d="M3 6.5A1.5 1.5 0 0 1 4.5 5H9l2 2.5h8.5A1.5 1.5 0 0 1 21 9v9.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5z"/>',
  file: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/>', clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  restore: '<path d="M4 12a8 8 0 1 0 2.3-5.6L4 8.5"/><path d="M4 4v4.5h4.5"/><path d="M12 8v4l3 2"/>',
  download: '<path d="M12 4v11m-4.5-4.5L12 15l4.5-4.5"/><path d="M4.5 19.5h15"/>', upload: '<path d="M12 20V9m-4.5 4.5L12 9l4.5 4.5"/><path d="M4.5 4.5h15"/>',
  target: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4"/><path d="M12 1.5v4M12 18.5v4M1.5 12h4M18.5 12h4"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
  bolt: '<path d="M13 2.5 4.5 13.5H12L11 21.5l8.5-11H12z"/>', wrench: '<path d="M14.5 6.5a4 4 0 0 0 5 5L12 19a2.1 2.1 0 0 1-3-3z"/><path d="M14.5 6.5 17 4l3 3-2.5 2.5"/>',
  list: '<path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/>', grid: '<rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.5"/>',
  store: '<path d="M4 8h16l-1 12H5z"/><path d="M9 8V6.5a3 3 0 0 1 6 0V8"/>', windows: '<rect x="3.5" y="3.5" width="7.5" height="7.5" rx="1"/><rect x="13" y="3.5" width="7.5" height="7.5" rx="1"/><rect x="3.5" y="13" width="7.5" height="7.5" rx="1"/><rect x="13" y="13" width="7.5" height="7.5" rx="1"/>',
  code: '<path d="m8.5 7-5 5 5 5M15.5 7l5 5-5 5"/>', package: '<path d="m12 3 8.5 4.5v9L12 21l-8.5-4.5v-9z"/><path d="M3.5 7.5 12 12l8.5-4.5M12 12v9"/>',
  power: '<path d="M12 3v8"/><path d="M6.5 6.5a7.5 7.5 0 1 0 11 0"/>', sliders: '<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>',
  sparkle: '<path d="M12 3.5 13.8 10.2 20.5 12 13.8 13.8 12 20.5 10.2 13.8 3.5 12 10.2 10.2z"/>', copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5.5A1.5 1.5 0 0 0 14.5 4h-9A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H8"/>',
  external: '<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>', trash: '<path d="M4 7h16M9 7V4.5h6V7M6.5 7l1 13h9l1-13"/>',
  filter: '<path d="M3.5 5h17l-6.5 8v6l-4-2v-4z"/>', sort: '<path d="M7 4v16m-3.5-3.5L7 20l3.5-3.5M17 20V4m-3.5 3.5L17 4l3.5 3.5"/>',
  bell: '<path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>', tray: '<path d="M3.5 13.5h5l1.5 2.5h4l1.5-2.5h5"/><path d="M5.5 5h13l2 8.5V19H3.5v-5.5z"/>',
  keyboard: '<rect x="2.5" y="6" width="19" height="12" rx="2.5"/><path d="M6.5 10h.01M10 10h.01M14 10h.01M17.5 10h.01M7 14h10"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/>', user: '<circle cx="12" cy="8" r="4"/><path d="M4 20.5a8 8 0 0 1 16 0"/>',
  palette: '<path d="M12 3.5a8.5 8.5 0 0 0 0 17c1.3 0 1.8-1 1.3-2-.6-1.2.2-2.5 1.6-2.5H17a3.5 3.5 0 0 0 3.5-3.5c0-5-3.8-9-8.5-9z"/><circle cx="7.5" cy="11" r="1"/><circle cx="10" cy="7.5" r="1"/><circle cx="14.5" cy="7.5" r="1"/>',
  globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.5 2.5 3.5 5.5 3.5 8.5s-1 6-3.5 8.5c-2.5-2.5-3.5-5.5-3.5-8.5s1-6 3.5-8.5z"/>',
  layers: '<path d="m12 3 9 4.5-9 4.5-9-4.5z"/><path d="m3 12 9 4.5 9-4.5"/><path d="m3 16.5 9 4.5 9-4.5"/>',
  cube: '<path d="m12 2.8 8.5 4.7v9L12 21.2l-8.5-4.7v-9z"/><path d="m3.5 7.5 8.5 4.7 8.5-4.7M12 12.2v9"/>',
};
const ic = (n, cls = 'i') => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">${P[n] || P.dots}</svg>`;
const icons = { add(o) { Object.assign(P, o); }, has: n => n in P };

/* ---------- empty states: one component for "all done", "nothing found", "nothing yet" and "could not read" ----------
   SH.emptyState({ art, title, text, action, small }) returns the HTML (title and text are ready-made HTML: escape what is not yours).
   art: 'ok' (all done / clean: a planet with a check), 'none' (nothing matches: an orbit with its moon missing),
        'first' (first use / nothing yet: a lone star in its orbit), 'error' (could not read: a planet off its orbit).
   action: { label, id?, data? ('data-retry="x"'), go? ('module/tab': opens it by itself), click? (a selector: clicks that element, e.g. the header button), icon?, pri? } renders a button; listen to it yourself unless it has go.
   cls: an extra class for the module's own sizing.
   small: tighter version for lists and side panels. */
const ES_ART = {
  ok: '<path class="o" d="M16 44a44 12 0 0 1 88 0" transform="rotate(-16 60 44)"/><circle class="p" cx="60" cy="40" r="17"/><path class="c" d="m52.5 40.5 5.5 5.5 10-11"/><path class="o" d="M16 44a44 12 0 0 0 88 0" transform="rotate(-16 60 44)"/><circle class="m" cx="101" cy="33" r="3"/>',
  none: '<path class="o d" d="M16 44a44 12 0 0 1 88 0" transform="rotate(-16 60 44)"/><circle class="p" cx="60" cy="40" r="17"/><path class="o d" d="M16 44a44 12 0 0 0 88 0" transform="rotate(-16 60 44)"/><path class="c" d="M55.4 36.2a4.8 4.8 0 1 1 6.7 4.4c-1.4.7-2.1 1.5-2.1 3M60 47.8v.01"/><circle class="m e" cx="101" cy="33" r="3"/>',
  first: '<ellipse class="o d" cx="60" cy="40" rx="44" ry="13" transform="rotate(-16 60 40)"/><path class="p s" d="M60 22.5 63.6 36.4 77.5 40 63.6 43.6 60 57.5 56.4 43.6 42.5 40 56.4 36.4z"/><circle class="m" cx="96" cy="49" r="3"/>',
  error: '<path class="o d" d="M16 44a44 12 0 0 1 88 0" transform="rotate(-16 60 44)"/><circle class="p" cx="52" cy="44" r="16"/><path class="c" d="m46 36 4 5.5-4 4 5 5"/><path class="o d" d="M18 58a44 12 0 0 0 70 5" transform="rotate(-16 60 44)"/><circle class="m e" cx="100" cy="23" r="3"/>',
};
const ES_STARS = '<path class="t" d="M14 14v6M11 17h6M104 58v5M101.5 60.5h5"/><circle class="t f" cx="27" cy="62" r="1.2"/><circle class="t f" cx="94" cy="12" r="1.2"/><circle class="t f" cx="8" cy="40" r="1"/><circle class="t f" cx="113" cy="38" r="1"/>';
const emptyArt = (art = 'none') => `<svg class="es-art" viewBox="0 0 120 76" aria-hidden="true">${ES_STARS}${ES_ART[art] || ES_ART.none}</svg>`;
const emptyState = ({ art = 'none', title = '', text = '', action, small = false, cls = '' } = {}) => {
  const a = action && action.label ? `<div class="es-act"><button class="btn ${action.pri ? 'pri' : 'sec'} sm"${action.id ? ` id="${action.id}"` : ''}${action.go ? ` data-es-go="${action.go}"` : ''}${action.click ? ` data-es-click="${action.click}"` : ''}${action.data ? ' ' + action.data : ''}>${action.icon ? ic(action.icon) : ''}${esc(action.label)}</button></div>` : '';
  return `<div class="empty es es-${art}${small ? ' es-sm' : ''}${cls ? ' ' + cls : ''}">${emptyArt(art)}${title ? `<b>${title}</b>` : ''}${text ? `<p>${text}</p>` : ''}${a}</div>`;
};

/* ---------- the PC (sample data; inside the app it is replaced by the real data from Python) ----------
   Component names, titles, values and typeName arrive translated; the row LABELS (rows[i][0]) stay in English because
   code looks rows up by them: translate them where they are shown, SH.t(label). */
const PC = {
  model: 'ASUS TUF Gaming F16', code: 'FX608JPR', type: 'laptop', typeName: t('Laptop'), maker: 'ASUSTeK',
  os: 'Windows 11 Pro 25H2', build: '26200', bios: 'FX608JPR.312',
  facts: { drivers: 303, programs: 116, freeC: 361 },
  components: [
    { id: 'cpu', name: t('Processor'), title: 'Intel Core i7-14650HX', rows: [['Cores', t('{n} ({p} performance, {e} efficient)', { n: 16, p: 8, e: 8 })], ['Threads', '24'], ['Max frequency', '5.2 GHz'], ['Cache', '30 MB']] },
    { id: 'gpu', name: t('Graphics'), title: 'NVIDIA GeForce RTX 5070 Laptop', rows: [['Memory', '8 GB GDDR7'], ['Integrated', 'Intel UHD Graphics'], ['Driver', '32.0.16.1742']] },
    { id: 'ram', name: t('Memory'), title: '16 GB DDR5', rows: [['Speed', '5600 MT/s'], ['Manufacturer', 'Samsung'], ['Modules', t('{n} × {size} GB, {free} free slot', { n: 1, size: 16, free: 1 })]] },
    { id: 'ssd', name: t('Storage'), title: 'WD PC SN5000S 1 TB', rows: [['Type', 'NVMe SSD'], ['Used', '592 GB'], ['Free', '361 GB']], bar: .62 },
    { id: 'display', name: t('Displays'), title: t('{n} inch, {res}', { n: 16, res: '2560 × 1600' }), rows: [['Refresh rate', '165 Hz'], ['External', '1920 × 1080, 144 Hz']] },
    { id: 'battery', name: t('Battery'), title: t('{wh} Wh, {pct}% health', { wh: 90, pct: 97 }), rows: [['Current capacity', '87.2 Wh'], ['Status', t('Good')]], bar: .97 },
    { id: 'wifi', name: t('Network'), title: 'Wi-Fi 6E', rows: [['Adapter', 'Realtek 8852CE'], ['Link', '1.2 Gb/s']] },
    { id: 'audio', name: t('Audio'), title: 'Realtek High Definition Audio', rows: [['Others', 'NVIDIA HD Audio, USB Audio']] },
    { id: 'sys', name: t('System'), title: 'Windows 11 Pro 25H2', rows: [['Build', '26200'], ['BIOS', 'FX608JPR.312']] },
  ],
};

/* ---------- modules: master list (the dock, the palette and the views come from here) ---------- */
const MODS0 = [
  { id: 'home', name: 'Home', icon: 'home' },
  { id: 'monitor', name: 'Live Monitor', icon: 'monitor', desc: 'Your PC in real time: usage, temperatures, network, battery and health.',
    tabs: [['overview', 'Overview'], ['cpu', 'Processor'], ['gpu', 'Graphics'], ['memory', 'Memory'], ['disks', 'Disks'], ['network', 'Network'], ['battery', 'Battery'], ['processes', 'Processes'], ['health', 'Health']] },
  { id: 'drivers', name: 'Driver Updater', icon: 'drivers', desc: 'Your drivers, new versions from Windows Update and backups.',
    tabs: [['updates', 'Updates'], ['all', 'All drivers'], ['problems', 'Problems'], ['backup', 'Backup'], ['history', 'History']] },
  { id: 'remover', name: 'Program Remover', icon: 'remover', desc: 'Uninstall programs and clear everything they leave behind, with a quarantine to undo.',
    tabs: [['programs', 'Programs'], ['batch', 'Batch'], ['watch', 'Watched install'], ['quarantine', 'Quarantine'], ['history', 'History']] },
  { id: 'updater', name: 'Program Updater', icon: 'updater', desc: 'Programs, Windows, Store and components up to date, in a single queue.',
    tabs: [['overview', 'Overview'], ['apps', 'Programs'], ['windows', 'Windows'], ['store', 'Store'], ['runtimes', 'Components'], ['dev', 'Development'], ['schedule', 'Schedule']] },
  { id: 'hangar', name: 'App Hangar', icon: 'hangar', real: true, desc: 'Pick the apps you want and install them all at once.',
    tabs: [['catalog', 'Catalog'], ['kits', 'Kits'], ['queue', 'Queue'], ['history', 'History']] },
  { id: 'storage', name: 'Storage Checker', icon: 'storage', desc: 'What every folder on your drives takes up, on a map you can explore.',
    tabs: [['map', 'Map'], ['tree', 'Folders'], ['types', 'File types'], ['largest', 'Largest'], ['duplicates', 'Duplicates'], ['compare', 'Compare']] },
  { id: 'optimizer', name: 'Super Optimizer', icon: 'optimizer', desc: 'Clean, repair and speed up Windows. Always with a restore point and undo.',
    tabs: [['overview', 'Overview'], ['clean', 'Cleanup'], ['startup', 'Startup'], ['services', 'Services'], ['registry', 'Registry', () => !!state.settings.registryCleaner], ['repair', 'Repair'], ['performance', 'Performance'], ['debloat', 'Debloat']] },
  { id: 'privacy', name: 'Privacy & Security', icon: 'privacy', real: true, desc: 'What can see you, what is open and how well Windows protects you.',
    tabs: [['overview', 'Overview'], ['permissions', 'App permissions'], ['protection', 'Protection'], ['network', 'Network'], ['tracking', 'Tracking'], ['persistence', 'Auto-starts']] },
  { id: 'benchmark', name: 'Benchmark Testing', icon: 'benchmark', real: true, desc: 'Measure every component, stress-test it and get a score for your PC.',
    tabs: [['overview', 'Overview'], ['cpu', 'Processor'], ['gpu', 'Graphics'], ['memory', 'Memory'], ['disk', 'Disks'], ['network', 'Network'], ['stress', 'Stress test'], ['history', 'History']] },
  { id: 'tester', name: 'Device Tester', icon: 'tester', real: true, desc: 'Test your keyboard, screen, speakers, microphone, camera, mouse and game controller.',
    tabs: [['keyboard', 'Keyboard'], ['screen', 'Screen'], ['speakers', 'Speakers'], ['mic', 'Microphone'], ['camera', 'Camera'], ['mouse', 'Mouse'], ['controller', 'Controller']] },
  { id: 'autopilot', name: 'Autopilot', icon: 'autopilot', real: true, desc: 'Automatic maintenance: you set the rules, StellarHub follows them.',
    tabs: [['routines', 'Routines'], ['calendar', 'Calendar'], ['notify', 'Notifications'], ['log', 'Log']] },
];
/* names, descriptions and tab names in the interface language (ids stay as they are) */
const MODS = MODS0.map(m => ({ ...m, name: t(m.name), desc: m.desc && t(m.desc), tabs: m.tabs && m.tabs.map(([id, n, when]) => when ? [id, t(n), when] : [id, t(n)]) }));
const modById = id => MODS.find(m => m.id === id);

/* registry of modules and Home views (filled in by the files in js/modules and js/home) */
const registry = { modules: {}, variants: {}, actions: [] };
function module(def) { registry.modules[def.id] = def; emit('module:registered', def); }
function homeVariant(def) { registry.variants[def.id] = def; emit('variant:registered', def); }
const actions = { add(list) { registry.actions.push(...list); }, all: () => registry.actions };

/* ---------- activity and pending items (modules feed them; Home shows them) ----------
   SH.logActivity('Brave updated', { sub: 'to version 1.85', ic: 'updater', go: 'updater', tab: 'apps' })
   SH.setPending('drivers', 4)   // keys: drivers, apps, junk (in GB) */
function logActivity(text, o = {}) {
  const list = (state.settings.activity || []).slice(0, 39);
  const src = x => { const r = x && _recent.get(x); return r ? (r[1] ? [r[0], r[1]] : [r[0]]) : undefined; };
  /* t / sub: the text as it was written (kept for old readers); k / sk: English key + vars, translated when shown */
  const e = { t: text, sub: o.sub || '', ic: o.ic || 'check', go: o.go || '', tab: o.tab || '', at: Date.now() };
  const k = src(text), sk = src(o.sub); if (k) e.k = k; if (sk) e.sk = sk;
  list.unshift(e);
  state.settings.activity = undefined; setSetting('activity', list);
}
/* an activity entry as {t, sub} in the interface language. Old entries (plain strings) show as they are. */
function activityText(e) {
  const tr = (p, plain) => p ? t(p[0], p[1]) : (plain ? t(plain) : '');
  return { t: tr(e.k, e.t), sub: tr(e.sk, e.sub) };
}
/* "8 days 11 h" / "5 h 20 min" / "12 min", the same everywhere (Home, Live Monitor) and in the interface language */
function fmtUptime(s) {
  s = +s; if (!isFinite(s) || s < 0) return '—';
  const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60);
  return h >= 48 ? t('{d} days {h} h', { d: Math.floor(h / 24), h: h % 24 }) : h ? t('{h} h {m} min', { h, m }) : t('{n} min', { n: m });
}
function setPending(key, n) {
  const p = { ...(state.settings.pending || {}) }; p[key] = { n, at: Date.now() };
  state.settings.pending = undefined; setSetting('pending', p); emit('pending', p);
}

/* ---------- automatic fade on scrollable areas ---------- */
const sfSet = new Set();
function sfUpdate(el) { sfApply(el, el.scrollHeight - el.clientHeight, el.scrollTop); }
/* All the reads first, then all the writes: a class written inside the loop made the next read force a new layout
   (hundreds of layouts per scan on a big list). */
function sfScan(root) {
  if (!root) return;
  const found = [], stack = [root];
  /* The walk prunes whole subtrees that are not rendered (display:none tabs, rows skipped by content-visibility:auto):
     reading a size inside a skipped row forces that row to lay out, one by one. */
  const vis = Element.prototype.checkVisibility ? el => el.checkVisibility({ contentVisibilityAuto: true }) : () => true;
  for (let el; (el = stack.pop());) {
    if (!vis(el)) continue;
    for (let c = el.lastElementChild; c; c = c.previousElementSibling) stack.push(c);
    /* cheapest tests first: only an element that really overflows gets its style read */
    if (sfSet.has(el) || !el.clientHeight || el.scrollHeight - el.clientHeight <= 2 || el.closest('[data-nofade]')) continue;
    const cs = getComputedStyle(el);
    if (!/(auto|scroll)/.test(cs.overflowY)) continue;
    const plain = cs.backgroundColor === 'rgba(0, 0, 0, 0)' && parseFloat(cs.borderBottomWidth) === 0;
    if (!plain || el.dataset.nofade !== undefined) continue;
    found.push(el);
  }
  for (const el of found) { el.classList.add('sf'); sfSet.add(el); }
  const live = [];
  sfSet.forEach(el => { if (!el.isConnected) sfSet.delete(el); else live.push(el); });
  const m = live.map(el => [el.scrollHeight - el.clientHeight, el.scrollTop]);
  live.forEach((el, i) => sfApply(el, m[i][0], m[i][1]));
}
function sfApply(el, max, top) {
  if (max <= 2) { el.classList.remove('sf-t', 'sf-b'); return; }
  el.classList.toggle('sf-t', top > 2); el.classList.toggle('sf-b', top < max - 2);
}
addEventListener('scroll', e => { const el = e.target; if (el.nodeType === 1 && sfSet.has(el)) sfUpdate(el); }, true);
addEventListener('resize', () => { const l = [...sfSet], m = l.map(el => [el.scrollHeight - el.clientHeight, el.scrollTop]); l.forEach((el, i) => sfApply(el, m[i][0], m[i][1])); });
/* the scan reads the style of every element: it only runs when something was added to the page (or the view or tab changed) */
let sfDirty = 2;
new MutationObserver(ms => { if (!sfDirty && ms.some(m => [...m.addedNodes].some(n => n.nodeType === 1))) sfDirty = 2; }).observe(document.documentElement, { childList: true, subtree: true });
on('view', () => { sfDirty = 2; }); on('tab', () => { sfDirty = 2; });
setInterval(() => {
  if (!sfDirty || document.hidden) return; sfDirty--;
  const v = document.querySelector('.view.is-on'); if (v) sfScan(v); const s = document.querySelector('.overlay.on .sheet .body'); if (s) sfScan(s);
}, 1200);

/* the next-step button of an empty state can open a module tab by itself: data-es-go="module/tab" */
addEventListener('click', e => {
  const b = e.target.closest && e.target.closest('[data-es-go],[data-es-click]'); if (!b) return;
  if (b.dataset.esGo) { const [m, tab] = b.dataset.esGo.split('/'); SH.go(m, tab ? { tab } : {}); } else { const t = document.querySelector(b.dataset.esClick); if (t) t.click(); }
});

/* ---------- charts: one look for every canvas chart (Live Monitor, Benchmark) ----------
   Gridlines: n-1 inner hairlines (--line). Y labels: 11.5 px --faint, sitting on their gridline at the left edge (only when
   the plot is at least 96 px tall). X labels: the same style in the bottom corners. Tooltip: a deep glass box with a
   hairline, 8 px corners, 11.5 px text, one line per series and the time last, placed beside the cursor line.
   Charts reserve CHART.xpad px under the plot for the x labels. */
const chartKit = (() => {
  let cc = null;
  const col = () => cc || (cc = (() => { const cs = getComputedStyle(document.documentElement), o = {}; ['line', 'faint', 'mute', 'ink', 'deep'].forEach(k => { o[k] = cs.getPropertyValue('--' + k).trim(); }); return o; })());
  on('look', () => { cc = null; setTimeout(() => { cc = null; }, 60); });
  const FONT = '11.5px Onest, "Microsoft YaHei UI", system-ui, sans-serif';
  const alpha = (c, a) => `color-mix(in srgb, ${c} ${Math.round(a * 100)}%, transparent)`;
  return {
    FONT, xpad: 17,
    grid(x, L, R, T, B, n = 4) { x.strokeStyle = col().line; x.lineWidth = 1; for (let i = 1; i < n; i++) { const y = Math.round(T + (B - T) * i / n) + .5; x.beginPath(); x.moveTo(L, y); x.lineTo(R, y); x.stroke(); } },
    /* y labels from hi (top) to lo (bottom), one per gridline plus the top one */
    ticks(x, L, T, B, n, hi, lo, fmt) {
      if (B - T < 96) return; x.save(); x.font = FONT; x.fillStyle = col().faint; x.textAlign = 'left'; x.textBaseline = 'alphabetic';
      x.lineJoin = 'round'; x.lineWidth = 3; x.strokeStyle = col().deep;
      for (let i = 0; i < n; i++) { const tx = fmt(hi - (hi - lo) * i / n), ty = i ? Math.round(T + (B - T) * i / n) - 4 : T + 12; x.globalAlpha = .85; x.strokeText(tx, L + 3, ty); x.globalAlpha = 1; x.fillText(tx, L + 3, ty); }
      x.restore();
    },
    xlabels(x, L, R, h, a, b) { x.save(); x.font = FONT; x.fillStyle = col().faint; x.textBaseline = 'alphabetic'; x.textAlign = 'left'; if (a) x.fillText(a, L + 3, h - 4); x.textAlign = 'right'; if (b) x.fillText(b, R - 3, h - 4); x.restore(); },
    /* lines: [[color, text], ...]; px: the cursor x; returns nothing */
    tip(x, px, W, T, lines) {
      x.save(); x.font = '500 ' + FONT; const c = col();
      const tw = Math.max(...lines.map(l => x.measureText(l[1]).width)) + 20, bh = lines.length * 17 + 10, bx = px + 14 + tw > W ? px - 14 - tw : px + 14;
      x.fillStyle = c.deep; x.globalAlpha = .95; x.beginPath(); x.roundRect(bx, T, tw, bh, 8); x.fill(); x.globalAlpha = .16; x.strokeStyle = c.ink; x.lineWidth = 1; x.stroke(); x.globalAlpha = 1;
      x.textAlign = 'left'; x.textBaseline = 'alphabetic'; lines.forEach((l, i) => { x.fillStyle = l[0]; x.fillText(l[1], bx + 10, T + 18 + i * 17); });
      x.restore();
    },
    cursor(x, px, T, B) { x.save(); x.strokeStyle = col().ink; x.globalAlpha = .22; x.lineWidth = 1; x.beginPath(); x.moveTo(Math.round(px) + .5, T); x.lineTo(Math.round(px) + .5, B); x.stroke(); x.restore(); },
  };
})();

/* i18n.js ran first and already put SH.t and SH.i18n here: keep them */
window.SH = Object.assign(window.SH || {}, {
  $, $$, ROOT, state, DEFAULTS, FACT, ORBIT, motion, effInt, on, emit, call, apiReady, loadSettings, setSetting,
  engine, job, logActivity, activityText, fmtUptime, setPending, Spring, springEase, EASE, anim, assemble, tickers, fmt1, fmtInt, fmtBytes, countUp, rollNumber, fitText, esc,
  ic, icons, emptyState, emptyArt, chartKit, PC, MODS, modById, registry, module, homeVariant, actions,
  go: () => {}, toast: () => {}, openComponent: () => {}, sfScan,
  /* the window coming in after the start screen, and going away when StellarHub closes, updates or reopens as
     administrator (app.py calls these): a short fade instead of a cut */
  enter() {
    if (state.settings.intensity === 'min') return;
    document.documentElement.animate([{ opacity: 0, transform: 'scale(1.012)' }, { opacity: 1, transform: 'none' }],
      { duration: 380, easing: 'cubic-bezier(.2,.8,.2,1)' });
  },
  leave() {
    const a = document.documentElement.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'scale(.985)' }],
      { duration: state.settings.intensity === 'min' ? 80 : 240, easing: 'cubic-bezier(.4,0,.6,1)', fill: 'forwards' });
    return a.finished;
  },
});
})();
