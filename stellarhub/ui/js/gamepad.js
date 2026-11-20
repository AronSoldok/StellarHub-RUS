/* StellarHub · controller navigation: move around the whole app with a gamepad (built for the ROG Ally's Xbox-style pad).
   Standard Gamepad API, polled with requestAnimationFrame ONLY while a controller is connected, the window is visible
   and focused, and the setting is on. Without a controller nothing runs.

   Buttons (standard mapping):  D-pad / left stick move · A select · B back or close · Y search · Menu (Start) settings
   View (Back) Home · LB / RB previous / next tab (or settings section) · LT / RT previous / next module
   Right stick scrolls the area under the focus.

   Modules that need the raw buttons (the Device Tester) call SH.gamepad.capture(). See docs/UI_CONTRACT.md. */
'use strict';
(() => {
const { $, $$, state, anim, EASE, Spring, esc } = SH;
const t = SH.t;
const ROOT = document.documentElement;
const S = () => state.settings;
const enabled = () => S().gamepadNav !== false;
const isMin = () => S().intensity === 'min';

/* ---------- buttons ---------- */
const B = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, VIEW: 8, MENU: 9, LS: 10, RS: 11, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15, GUIDE: 16 };
const NAMES = Object.keys(B);
const DELAY = 380, REPEAT = 125, FAST = 70, STICK = .55, RDZ = .2;

/* ---------- glyphs: Xbox by default, PlayStation letters when the controller says it is one ---------- */
let layout = 'xbox';
const COL = { A: '#7FE0B4', B: '#FF6B7A', X: '#7FB8FF', Y: '#F4C26B' };
const PS = { A: ['✕', '#9ED6FF'], B: ['○', '#FF6B7A'], X: ['□', '#E39BD8'], Y: ['△', '#7FE0B4'], LB: 'L1', RB: 'R1', LT: 'L2', RT: 'R2' };
const svg = (w, inner) => `<svg class="pg" viewBox="0 0 ${w} 24" width="${w}" height="24" aria-hidden="true">${inner}</svg>`;
const pill = (txt, w = 34) => svg(w, `<rect x="1.5" y="4.5" width="${w - 3}" height="15" rx="7.5"/><text x="${w / 2}" y="15.6" text-anchor="middle">${txt}</text>`);
function glyph(name) {
  if (layout === 'ps' && PS[name]) {
    const p = PS[name];
    return Array.isArray(p) ? svg(24, `<circle cx="12" cy="12" r="10" style="--c:${p[1]}" class="face"/><text x="12" y="16.4" text-anchor="middle" style="fill:${p[1]};font-size:12px">${p[0]}</text>`) : pill(p);
  }
  switch (name) {
    case 'A': case 'B': case 'X': case 'Y': return svg(24, `<circle cx="12" cy="12" r="10" class="face" style="--c:${COL[name]}"/><text x="12" y="16.4" text-anchor="middle" style="fill:${COL[name]};font-size:12px">${name}</text>`);
    case 'LB': case 'RB': case 'LT': case 'RT': return pill(name);
    case 'VIEW': return svg(24, `<circle cx="12" cy="12" r="10"/><rect x="6.8" y="9.2" width="7.2" height="5.4" rx="1.2" class="ln"/><path d="M10 9.2V7.8h7.2v5.4H15.8" class="ln"/>`);
    case 'MENU': return svg(24, `<circle cx="12" cy="12" r="10"/><path d="M7.6 9h8.8M7.6 12h8.8M7.6 15h8.8" class="ln"/>`);
    case 'DPAD': return svg(24, `<path d="M9.5 2.5h5v7h7v5h-7v7h-5v-7h-7v-5h7z" class="ln"/>`);
    case 'LS': return svg(24, `<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="4.2" class="dot"/><text x="12" y="-1" display="none">L</text>`);
    case 'RS': return svg(24, `<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="4.2" class="dot"/>`);
  }
  return '';
}
const detectLayout = gp => { layout = /054c|dualsense|dualshock|playstation|sony/i.test(gp && gp.id || '') ? 'ps' : 'xbox'; };

/* ---------- state ---------- */
const pads = new Map();          /* index -> per-pad edge and repeat state */
const listeners = new Set();
let raf = 0, last = 0, mode = false, cur = null, capture = null, lastVal = 0, scopeRoot = null, hintKey = '', lx = NaN, ly = NaN;
const memo = new Map();          /* scope root -> the element that was focused there */
let sessionToast = false;

/* ---------- the focus ring (one element that glides between targets) and the hint bar ---------- */
const ring = document.createElement('div'); ring.id = 'padRing'; ring.setAttribute('aria-hidden', 'true');
ring.innerHTML = '<div class="pr-in"><div class="pr-fr"><b></b></div><i></i></div>';
const hints = document.createElement('div'); hints.id = 'padHints'; hints.setAttribute('role', 'note'); hints.setAttribute('aria-label', t('Controller buttons'));
document.body.append(ring, hints);
const rs = { x: new Spring(0, 420, 32), y: new Spring(0, 420, 32), w: new Spring(40, 420, 32), h: new Spring(40, 420, 32) };
let ringShown = false, ringSnap = true, lastRingStyle = '', frameN = 0;

/* ---------- helpers ---------- */
const TEXTY = new Set(['text', 'search', 'number', 'email', 'url', 'password', 'tel', 'date', 'time', 'datetime-local', 'month', 'week', '']);
const isTextField = el => !!el && ((el.tagName === 'INPUT' && TEXTY.has((el.getAttribute('type') || 'text').toLowerCase())) || el.tagName === 'TEXTAREA' || el.isContentEditable);
const editing = () => isTextField(document.activeElement);
const visible = el => el.checkVisibility ? el.checkVisibility({ checkVisibilityCSS: true }) : !!el.offsetParent;
const rectOf = el => el.getBoundingClientRect();
const SEL = 'a[href],button,input:not([type=hidden]),select,textarea,summary,[tabindex]:not([tabindex="-1"]),[role=button],[role=tab],[role=option],[role=switch],[role=checkbox],[role=menuitem]';
const GUESS = 'div,li,tr,td,label,article,section,canvas,img,span,p,h3,h4';
const SKIP = '.winctl,.rz,#padRing,#padHints,.toasts,#boot,.tip,.csel-hidden';
const OVERLAYS = ['.csel-pop', '.su-ov', '.cs-o.on', '.sc-ov', '.hg-dlg', '.mdlg', '.bk-dq-o', '.dq-o'];
const nativeEl = el => /^(A|BUTTON|INPUT|SELECT|TEXTAREA|SUMMARY|LABEL)$/.test(el.tagName);

/* the topmost open overlay (dialog, sheet, palette, popup), or the whole page */
function scope() {
  if (state.palOpen) return $('#palO');
  if (state.setOpen && !$('#setO').classList.contains('closing')) {
    const over = topOverlay(); const sheet = $('#setO');
    if (over && (+getComputedStyle(over).zIndex || 0) > 60) return over;
    return sheet;
  }
  return topOverlay() || document.body;
}
function topOverlay() {
  let best = null, bz = -1;
  for (const sel of [...OVERLAYS, ...custom]) for (const o of $$(sel)) {
    if (!visible(o)) continue; const cs = getComputedStyle(o); if (cs.pointerEvents === 'none' && o.className.indexOf('sc-ov') < 0) continue;
    const z = (parseInt(cs.zIndex, 10) || 0) + (o.closest('.view') ? 0 : 100); if (z >= bz) { best = o; bz = z; }
  }
  return best;
}
const custom = [];

const viewEl = () => $('#v-' + state.view);
function usable(el, sc) {
  if (!el || !el.isConnected || !visible(el)) return false;
  if (sc && !sc.contains(el)) return false;
  const v = el.closest('.view'); if (v && v !== viewEl()) return false;
  const r = rectOf(el); return r.width > 2 && r.height > 2;
}
/* every focusable or clickable thing in the scope */
function candidates(sc) {
  const out = []; const seen = new Set(); const view = viewEl(); const vh = innerHeight, vw = innerWidth;
  const ok = el => {
    if (seen.has(el) || el.disabled || el.getAttribute('aria-disabled') === 'true' || el.closest('[inert],' + SKIP)) return false;
    const v = el.closest('.view'); if (v && v !== view) return false;
    if (!visible(el)) return false;
    const r = rectOf(el); if (r.width < 3 || r.height < 3) return false;
    if (r.bottom < -vh * 1.5 || r.top > vh * 2.5 || r.right < -vw || r.left > vw * 2) return false;
    return true;
  };
  for (const el of $$(SEL, sc)) { if (ok(el) && getComputedStyle(el).pointerEvents !== 'none') { seen.add(el); out.push(el); } }
  /* cards and rows with a click handler: found by their pointer cursor (the outermost one) */
  const cursor = new Map(); const cur_ = el => { let c = cursor.get(el); if (c === undefined) { c = getComputedStyle(el).cursor === 'pointer'; cursor.set(el, c); } return c; };
  for (const el of $$(GUESS, sc)) {
    if (seen.has(el) || el.closest(SEL) && el.closest(SEL) !== el) continue;
    if (!cur_(el)) continue; const p = el.parentElement; if (p && p !== sc && cur_(p)) continue;
    if (ok(el)) { seen.add(el); out.push(el); }
  }
  /* an outer element holding several others is a layout box, not a target */
  return out.filter(el => { let n = 0; for (const o of out) if (o !== el && el.contains(o) && ++n > 1) return false; return true; });
}

/* ---------- spatial navigation ---------- */
function best(from, list, dir) {
  const f = rectOf(from), fx = f.left + f.width / 2, fy = f.top + f.height / 2; let pick = null, ps = 1e9;
  for (const el of list) {
    if (el === from) continue; const r = rectOf(el), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    let along, alongC, gap, off;
    if (dir === 'right') { alongC = cx - fx; along = r.left - f.right; gap = Math.max(0, r.top - f.bottom, f.top - r.bottom); off = Math.abs(cy - fy); }
    else if (dir === 'left') { alongC = fx - cx; along = f.left - r.right; gap = Math.max(0, r.top - f.bottom, f.top - r.bottom); off = Math.abs(cy - fy); }
    else if (dir === 'down') { alongC = cy - fy; along = r.top - f.bottom; gap = Math.max(0, r.left - f.right, f.left - r.right); off = Math.abs(cx - fx); }
    else { alongC = fy - cy; along = f.top - r.bottom; gap = Math.max(0, r.left - f.right, f.left - r.right); off = Math.abs(cx - fx); }
    if (alongC <= 4) continue;
    const s = Math.max(0, along) + alongC * .15 + gap * 3 + off * .35;
    if (s < ps) { ps = s; pick = el; }
  }
  return pick;
}
function nearestTo(x, y, list) {
  let pick = null, ps = 1e12;
  for (const el of list) { const r = rectOf(el), d = (r.left + r.width / 2 - x) ** 2 + (r.top + r.height / 2 - y) ** 2; if (d < ps) { ps = d; pick = el; } }
  return pick;
}
function initialFor(sc) {
  if (sc.id === 'setO') { const n = $('#sheet nav .on'); if (n) return n; }
  if (sc.id === 'palO') { const n = $('.pal .it.on') || $('.pal .it'); if (n) return n; }
  const list = candidates(sc);
  if (!list.length) return null;
  if (sc === document.body) {
    const v = viewEl(); const inView = list.filter(el => v && v.contains(el));
    const pool = inView.length ? inView : list;
    const tab = v && $('.subnav .on', v); if (state.view !== 'home' && tab && list.includes(tab)) return tab;
    return nearestTo(innerWidth / 2, innerHeight / 2, pool);
  }
  const act = sc.querySelector('.csel-o.on'); if (act && list.includes(act)) return act;
  return list.find(el => el.classList.contains('pri')) || nearestTo(innerWidth / 2, innerHeight / 2, list);
}

/* ---------- scrolling ---------- */
const scrollerOf = el => {
  for (let p = el; p && p !== document.documentElement; p = p.parentElement) {
    const cs = getComputedStyle(p);
    if (/(auto|scroll)/.test(cs.overflowY) && p.scrollHeight > p.clientHeight + 2) return p;
  }
  return null;
};
function reveal(el) {
  const M = 26; const smooth = isMin() ? 'instant' : 'smooth';
  for (let p = el.parentElement; p && p !== document.documentElement; p = p.parentElement) {
    const cs = getComputedStyle(p); const sy = /(auto|scroll)/.test(cs.overflowY) && p.scrollHeight > p.clientHeight + 2, sx = /(auto|scroll)/.test(cs.overflowX) && p.scrollWidth > p.clientWidth + 2;
    if (!sy && !sx) continue;
    const r = rectOf(el), c = rectOf(p); let dy = 0, dx = 0;
    if (sy) { if (r.top < c.top + M) dy = r.top - c.top - M; else if (r.bottom > c.bottom - M) dy = r.bottom - c.bottom + M; if (r.height > c.height - 2 * M && r.top < c.top + M) dy = r.top - c.top - M; }
    if (sx) { if (r.left < c.left + M) dx = r.left - c.left - M; else if (r.right > c.right - M) dx = r.right - c.right + M; }
    if (dx || dy) p.scrollBy({ top: dy, left: dx, behavior: smooth });
  }
}

/* ---------- focus ---------- */
function setCur(el, snap) {
  if (!el) return; cur = el;
  const a = document.activeElement;
  if (isTextField(el)) { if (isTextField(a) && a !== el) a.blur(); }
  else { if (isTextField(a)) a.blur(); try { el.focus({ preventScroll: true }); } catch {} }
  reveal(el); aimRing(snap);
  scrollerCache = null;
}
function aimRing(snap) {
  if (!cur || !ring) return;
  const r = rectOf(cur); rs.x.t = r.left; rs.y.t = r.top; rs.w.t = r.width; rs.h.t = r.height;
  ring.style.setProperty('--rr', getComputedStyle(cur).borderTopLeftRadius || '12px');
  if (snap || !ringShown) { rs.x.set(r.left); rs.y.set(r.top); rs.w.set(r.width); rs.h.set(r.height); ringSnap = true; }
  frameN = 0;
}
function pulse() { const i = $('.pr-in i', ring); if (i && !isMin()) anim(i, [{ transform: 'scale(1)', opacity: .9 }, { transform: 'scale(1.1)', opacity: 0 }], { d: 420, e: EASE.out }); const p = $('.pr-in', ring); if (p) anim(p, [{ transform: 'scale(1)' }, { transform: 'scale(.95)', offset: .3 }, { transform: 'scale(1)' }], { d: 300, e: EASE.spring }); }
function bump(dir) {
  const p = $('.pr-in', ring); if (!p || isMin()) return; const dx = dir === 'left' ? -1 : dir === 'right' ? 1 : 0, dy = dir === 'up' ? -1 : dir === 'down' ? 1 : 0;
  anim(p, [{ transform: 'translate(0,0)' }, { transform: `translate(${dx * 6}px,${dy * 6}px)`, offset: .4 }, { transform: 'translate(0,0)' }], { d: 260, e: EASE.spring });
}
function move(dir) {
  if (editing()) { if (dir !== 'up' && dir !== 'down') return; const a = document.activeElement; cur = a; a.blur(); }
  const sc = scope(); const list = candidates(sc);
  if (cur && cur.tagName === 'INPUT' && cur.type === 'range' && (dir === 'left' || dir === 'right') && usable(cur, sc)) { stepRange(cur, dir === 'right' ? 1 : -1); return; }
  if (!usable(cur, sc)) { const n = initialFor(sc); n && setCur(n, true); return; }
  const n = best(cur, list, dir);
  if (n) setCur(n); else bump(dir);
}
function stepRange(el, d) {
  const step = +el.step || 1, min = +el.min || 0, max = el.max === '' ? 100 : +el.max;
  const v = Math.min(max, Math.max(min, +el.value + d * step * Math.max(1, Math.round((max - min) / step / 20))));
  if (v === +el.value) { bump(d > 0 ? 'right' : 'left'); return; }
  el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); aimRing();
}

/* ---------- actions ---------- */
function click(el) {
  if (nativeEl(el)) { el.click(); return; }
  const r = rectOf(el), o = { bubbles: true, cancelable: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, button: 0, buttons: 1, pointerType: 'mouse', isPrimary: true, view: window };
  el.dispatchEvent(new PointerEvent('pointerdown', o)); el.dispatchEvent(new MouseEvent('mousedown', o));
  el.dispatchEvent(new PointerEvent('pointerup', { ...o, buttons: 0 })); el.dispatchEvent(new MouseEvent('mouseup', { ...o, buttons: 0 })); el.dispatchEvent(new MouseEvent('click', { ...o, buttons: 0 }));
}
function activate() {
  if (editing()) { const a = document.activeElement; if (a.tagName !== 'TEXTAREA') a.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true, cancelable: true })); return; }
  const sc = scope(); let el = cur;
  if (!usable(el, sc)) { const n = initialFor(sc); if (n) setCur(n, true); else if (sc !== document.body) click(sc); return; }
  pulse();
  if (isTextField(el)) { el.focus(); try { el.select(); } catch {} aimRing(); return; }
  if (el.tagName === 'SELECT') { el.focus(); try { el.showPicker && el.showPicker(); } catch {} return; }
  if (el.tagName === 'INPUT' && el.type === 'range') return;
  click(el); sync(90); sync(420);
}
const key = (k, o = {}) => window.dispatchEvent(new KeyboardEvent('keydown', { key: k, code: k === ',' ? 'Comma' : k === 'Escape' ? 'Escape' : 'Key' + k.toUpperCase(), bubbles: true, cancelable: true, ...o }));
function back() {
  if (editing()) { const a = document.activeElement; a.blur(); cur = a; aimRing(); return; }
  if (state.palOpen || state.setOpen) { const over = scope(); if (over.id !== 'palO' && over.id !== 'setO') closeOverlay(over); else key('Escape'); sync(120); return; }
  const over = topOverlay(); if (over) { closeOverlay(over); sync(120); return; }
  const note = $('#adminNote'); if (note && note.classList.contains('on')) { $('#adminNo').click(); return; }
  if (state.view === 'home') { bump('left'); return; }
  const v = state.view, tab = $('#v-' + v + ' .subnav .on'), tb = tab && tab.dataset.tab;
  SH.back(); const t2 = $('#v-' + state.view + ' .subnav .on');
  if (state.view === v && (t2 ? t2.dataset.tab : null) === (tb || null)) SH.go('home');
  sync(120);
}
function closeOverlay(o) {
  if (o.matches('.cs-o') && SH.closeComponent) { SH.closeComponent(); return; }
  const x = $('[data-close],[data-dismiss],.x,[aria-label="Close"]', o); if (x && visible(x)) { x.click(); return; }
  const a = document.activeElement && document.activeElement !== document.body ? document.activeElement : o;
  a.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true, cancelable: true }));
}
function tab(d) {
  if (state.palOpen) return;
  let list, sel;
  if (state.setOpen) { list = $$('#sheet nav [data-sec]'); sel = 'on'; }
  else if (topOverlay()) return;
  else { const nav = $('#v-' + state.view + ' .subnav'); if (!nav) { bump(d < 0 ? 'left' : 'right'); return; } list = $$('[data-tab]', nav); }
  const i = list.findIndex(b => b.classList.contains('on')), j = i + d;
  if (i < 0 || j < 0 || j >= list.length) { bump(d < 0 ? 'left' : 'right'); return; }
  list[j].click(); pulse(); sync(60); setCur(list[j]);
}
function module(d) {
  if (state.palOpen || state.setOpen || topOverlay()) return;
  const ids = $$('#dock .dk').map(b => b.dataset.go), i = ids.indexOf(state.view), j = i + d;
  if (i < 0 || j < 0 || j >= ids.length) { bump(d < 0 ? 'left' : 'right'); return; }
  SH.go(ids[j]); setTimeout(() => { if (!mode) return; const n = initialFor(document.body); n && setCur(n, true); }, 60);
}
const home = () => { if (state.palOpen || state.setOpen) key('Escape'); const o = topOverlay(); if (o) closeOverlay(o); SH.go('home'); setTimeout(() => { if (mode) { const n = initialFor(scope()); n && setCur(n, true); } }, 80); };
const settings = () => { key(',', { ctrlKey: true }); sync(80); sync(400); };
const palette = () => { key('k', { ctrlKey: true }); sync(80); sync(400); };

function press(i) {
  switch (i) {
    case B.A: activate(); break;
    case B.B: back(); break;
    case B.Y: palette(); break;
    case B.LB: tab(-1); break;
    case B.RB: tab(1); break;
    case B.LT: module(-1); break;
    case B.RT: module(1); break;
    case B.VIEW: home(); break;
    case B.MENU: settings(); break;
  }
}

/* ---------- the hint bar ---------- */
function hintItems() {
  const sc = scope();
  if (editing()) return [['A', t('Type text')], ['B', t('Done')]];
  if (state.setOpen && sc.id === 'setO') return [['A', t('Select')], ['B', t('Close')], ['LB RB', t('Sections')], ['MENU', t('Close')]];
  if (state.palOpen) return [['A', t('Open')], ['B', t('Close')], ['Y', t('Close')]];
  if (sc !== document.body) return [['A', t('Select')], ['B', t('Close')]];
  const tabs = $('#v-' + state.view + ' .subnav');
  return [['A', t('Select')], ['B', t('Back')], ...(tabs ? [['LB RB', t('Tabs')]] : []), ['LT RT', t('Modules')], ['Y', t('Search')], ['MENU', t('Settings')], ['VIEW', t('Home')]];
}
function paintHints() {
  hints.classList.toggle('in-sheet', state.setOpen && scope().id === 'setO');
  const items = hintItems(), k = layout + items.map(x => x.join(':')).join('|'); if (k === hintKey) return; hintKey = k;
  hints.innerHTML = items.map(([g, l]) => `<span class="ph">${g.split(' ').map(glyph).join('')}<b>${esc(l)}</b></span>`).join('');
}

/* The hint bar never covers content: while it is up the page reserves room for it (html.pad-hints raises
   --dockspace, see gamepad.css) and the views are told to re-fit. */
function showHints(on) {
  hints.classList.toggle('on', on);
  if (ROOT.classList.contains('pad-hints') === on) return;
  ROOT.classList.toggle('pad-hints', on);
  requestAnimationFrame(() => dispatchEvent(new Event('resize')));
}

/* ---------- mode: the ring and the hints only exist while a controller is being used ---------- */
function setMode(on) {
  if (mode === on) return; mode = on;
  ROOT.classList.toggle('pad-mode', on); ring.classList.toggle('on', on && !capture); showHints(on && !capture);
  if (on) {
    hintKey = ''; paintHints();
    if (!isMin()) anim(hints, [{ opacity: 0, transform: 'translate3d(-50%,10px,0) scale(.96)' }, { opacity: 1, transform: 'translate3d(-50%,0,0) scale(1)' }], { d: 420, e: EASE.spring });
    const sc = scope(); scopeRoot = sc; if (!usable(cur, sc)) { const n = initialFor(sc); if (n) setCur(n, true); } else aimRing(true);
    ringShown = true; ringSnap = true;
    if (!isMin() && cur) anim($('.pr-in', ring), [{ transform: 'scale(1.18)', opacity: 0 }, { transform: 'scale(1)', opacity: 1 }], { d: 460, e: EASE.spring });
  } else ringShown = false;
  SH.emit && SH.emit('gamepad:mode', on);
}
function sync(ms) { setTimeout(() => { if (mode && !capture) validate(true); }, ms || 0); }
function validate(force) {
  const now = performance.now(); if (!force && now - lastVal < 140) return; lastVal = now;
  const sc = scope();
  if (sc !== scopeRoot) {
    if (scopeRoot && cur && cur.isConnected) memo.set(scopeRoot, cur);
    scopeRoot = sc;
    const m = memo.get(sc); const n = sc === document.body && usable(m, sc) ? m : initialFor(sc); if (n) setCur(n, true); else cur = null;
  } else if (!editing() && !usable(cur, sc)) {
    const r = lastRect, n = candidates(sc); const p = r ? nearestTo(r.x, r.y, n) : initialFor(sc); if (p) setCur(p, true); else cur = null;
  }
  paintHints();
}
let lastRect = null;

/* ---------- the loop ---------- */
const shouldRun = () => enabled() && pads.size > 0 && !document.hidden && document.hasFocus();
function kick() {
  if (shouldRun()) { if (!raf) { last = performance.now(); raf = requestAnimationFrame(frame); } }
  else { if (raf) { cancelAnimationFrame(raf); raf = 0; } for (const p of pads.values()) p.primed = false; if (mode) setMode(false); }
}
function frame(ts) {
  raf = 0; if (!shouldRun()) { kick(); return; }
  const dt = Math.min(.05, (ts - last) / 1000); last = ts;
  const list = navigator.getGamepads ? navigator.getGamepads() : []; let any = false;
  for (const gp of list) { if (!gp || !gp.connected) continue; any = true; if (!pads.has(gp.index)) pads.set(gp.index, { btn: [], primed: false, dir: null, next: 0, since: 0, chord: 0 }); poll(gp, ts, dt); }
  if (!any) { pads.clear(); kick(); return; }
  if (mode && !capture) { validate(); tickRing(dt); }
  raf = requestAnimationFrame(frame);
}
function readDir(gp) {
  const b = gp.buttons, dn = i => !!b[i] && (b[i].pressed || b[i].value > .5);
  if (dn(B.UP)) return 'up'; if (dn(B.DOWN)) return 'down'; if (dn(B.LEFT)) return 'left'; if (dn(B.RIGHT)) return 'right';
  const x = gp.axes[0] || 0, y = gp.axes[1] || 0; if (Math.hypot(x, y) < STICK) return null;
  return Math.abs(x) > Math.abs(y) ? (x > 0 ? 'right' : 'left') : (y > 0 ? 'down' : 'up');
}
function poll(gp, ts, dt) {
  const st = pads.get(gp.index); const bs = [];
  for (let i = 0; i <= 16; i++) { const b = gp.buttons[i]; bs[i] = !!b && (b.pressed || b.value > .5); }
  if (!st.primed) { st.btn = bs; st.primed = true; detectLayout(gp); return; }
  const edges = []; for (let i = 0; i <= 16; i++) if (bs[i] && !st.btn[i]) edges.push(i);
  const dir = readDir(gp), rx = gp.axes[2] || 0, ry = gp.axes[3] || 0; st.btn = bs;
  if (edges.length || dir || Math.hypot(rx, ry) > STICK) SH.poke && SH.poke();  /* using the pad counts as activity (the idle calm in shell.js) */
  if (listeners.size) for (const i of edges) for (const fn of listeners) { try { fn({ index: i, name: NAMES[i], pad: gp }); } catch (e) { console.error(e); } }
  if (capture) {
    /* the test owns the buttons; View + Menu held for a second gives them back */
    if (bs[B.VIEW] && bs[B.MENU]) { st.chord += dt; capture.onProgress && capture.onProgress(Math.min(1, st.chord / 1)); if (st.chord >= 1) { st.chord = 0; const c = capture; releaseCapture(); c.onExit && c.onExit(); } }
    else if (st.chord) { st.chord = 0; capture.onProgress && capture.onProgress(0); }
    return;
  }
  const active = edges.length || dir || Math.hypot(rx, ry) > .35;
  if (!mode) { if (active) { setMode(true); st.dir = dir; st.next = ts + DELAY; st.since = ts; } return; }
  for (const i of edges) if (i < 12 || i > 15) { if (listeners.size && consumed) { consumed = false; continue; } press(i); }
  if (dir) {
    if (dir !== st.dir) { st.dir = dir; st.next = ts + DELAY; st.since = ts; move(dir); }
    else if (ts >= st.next) { st.next = ts + (ts - st.since > 1400 ? FAST : REPEAT); move(dir); }
  } else st.dir = null;
  if (Math.hypot(rx, ry) > RDZ) stickScroll(rx, ry, dt);
}
let consumed = false, scrollerCache = null;
function stickScroll(rx, ry, dt) {
  if (editing()) return;
  const k = v => { const a = Math.abs(v); return Math.sign(v) * ((a - RDZ) / (1 - RDZ)) ** 2; };
  if (!scrollerCache || !scrollerCache.isConnected) {
    scrollerCache = (cur && usable(cur) && scrollerOf(cur)) || scrollerOf(document.elementFromPoint(innerWidth / 2, innerHeight / 2) || document.body) || false;
  }
  const s = scrollerCache; if (!s) return;
  s.scrollBy({ top: k(ry) * 1100 * dt, left: k(rx) * 1100 * dt, behavior: 'instant' }); frameN = 0;
}
function tickRing(dt) {
  if (!cur) { ring.classList.remove('has'); return; }
  ring.classList.add('has');
  frameN++;
  /* the target is re-measured every frame for a moment after a move or a scroll, then every few frames */
  if (frameN < 40 || frameN % 8 === 0) {
    if (!cur.isConnected) return;
    const r = rectOf(cur); lastRect = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    rs.x.t = r.left; rs.y.t = r.top; rs.w.t = r.width; rs.h.t = r.height;
  }
  if (ringSnap) { ringSnap = false; rs.x.set(rs.x.t); rs.y.set(rs.y.t); rs.w.set(rs.w.t); rs.h.set(rs.h.t); }
  else { rs.x.step(dt); rs.y.step(dt); rs.w.step(dt); rs.h.step(dt); }
  const st = `translate3d(${rs.x.v.toFixed(1)}px,${rs.y.v.toFixed(1)}px,0)|${Math.max(4, rs.w.v).toFixed(1)}|${Math.max(4, rs.h.v).toFixed(1)}`;
  if (st !== lastRingStyle) { lastRingStyle = st; const [tr, w, h] = st.split('|'); ring.style.transform = tr; ring.style.width = w + 'px'; ring.style.height = h + 'px'; }
}

/* ---------- leaving controller mode: any real mouse, touch or keyboard use ---------- */
const off = () => { if (mode) setMode(false); };
addEventListener('pointermove', e => { if (!e.isTrusted) return; const moved = Math.abs(e.clientX - lx) + Math.abs(e.clientY - ly) > 3; lx = e.clientX; ly = e.clientY; if (moved) off(); }, { capture: true, passive: true });
addEventListener('pointerdown', e => { if (e.isTrusted) off(); }, { capture: true, passive: true });
addEventListener('wheel', e => { if (e.isTrusted) off(); }, { capture: true, passive: true });
addEventListener('keydown', e => { if (e.isTrusted) off(); }, { capture: true });

/* ---------- connection ---------- */
function scan() {
  const l = navigator.getGamepads ? navigator.getGamepads() : [];
  for (const gp of l) if (gp && gp.connected && !pads.has(gp.index)) { pads.set(gp.index, { btn: [], primed: false, dir: null, next: 0, since: 0, chord: 0 }); detectLayout(gp); }
}
addEventListener('gamepadconnected', e => {
  if (!enabled()) return;
  pads.set(e.gamepad.index, { btn: [], primed: false, dir: null, next: 0, since: 0, chord: 0 }); detectLayout(e.gamepad);
  if (!sessionToast && !S().gamepadSeen) { sessionToast = true; SH.setSetting('gamepadSeen', true); SH.toast(t('Controller connected: you can use StellarHub with it'), { group: 'pad', ms: 5200 }); }
  kick();
});
addEventListener('gamepaddisconnected', e => {
  pads.delete(e.gamepad.index); scan();
  if (!pads.size) { if (mode) SH.toast(t('Controller disconnected'), { group: 'pad', ms: 2600 }); setMode(false); }
  kick();
});
addEventListener('focus', () => { scan(); kick(); }); addEventListener('blur', kick);
document.addEventListener('visibilitychange', () => { scan(); kick(); });
SH.on('setting', ({ key }) => { if (key === 'gamepadNav') { if (enabled()) scan(); else { pads.clear(); capture = null; } kick(); } });
SH.on('boot', () => { scan(); kick(); });
/* the ring follows the interface when it changes language, zoom, size */
addEventListener('resize', () => { frameN = 0; });

function releaseCapture() { capture = null; if (mode) { ring.classList.add('on'); showHints(true); hintKey = ''; paintHints(); aimRing(true); } }

/* ---------- modal dialogs: focus trap, inert background, focus back to the trigger ----------
   Generic: whichever dialog is open on top (palette, settings, component sheet, update, confirmations, dialogs inside
   a module) gets the rest of the app made inert, Tab stays inside it, and when it closes the focus goes back to
   what opened it. Works for keyboard users too, with or without a controller. */
const MODALS = ['.su-ov', '.cs-o.on', '.hg-dlg', '.mdlg', '.bk-dq-o', '.dq-o'];
const KEEP = '#toasts,#padRing,#padHints,script,style,link';
let modal = null, opener = null, inerted = [], lastFocus = null, modalTimer = 0;
function modalTop() {
  if (state.palOpen) return $('#palO');
  let b = null, bz = -1;
  for (const sel of MODALS) for (const o of $$(sel)) {
    if (!visible(o)) continue;
    const z = (parseInt(getComputedStyle(o).zIndex, 10) || 0) + (o.closest('.view') || o.closest('#sheet') ? 0 : 100);
    if (z >= bz) { b = o; bz = z; }
  }
  if (b) return b;
  return state.setOpen ? $('#setO') : null;
}
const tabbables = root => $$('a[href],button,input:not([type=hidden]),select,textarea,[tabindex]:not([tabindex="-1"])', root).filter(el => !el.disabled && visible(el) && !el.closest('[inert]'));
function releaseModal() {
  inerted.forEach(el => el.removeAttribute('inert')); inerted = [];
  const o = opener, was = modal; modal = null; opener = null; clearInterval(modalTimer); modalTimer = 0;
  const a = document.activeElement;
  if (o && o.isConnected && visible(o) && (!a || a === document.body || (was && was.contains(a)))) { try { o.focus({ preventScroll: true }); } catch {} }
}
function syncModal() {
  const top = modalTop();
  if (top === modal) return;
  if (modal) releaseModal();
  if (!top) return;
  modal = top; opener = lastFocus && lastFocus.isConnected && !top.contains(lastFocus) ? lastFocus : null;
  for (let n = top; n && n !== document.body; n = n.parentElement) for (const sib of n.parentElement ? n.parentElement.children : []) {
    if (sib !== n && !sib.matches(KEEP) && !sib.hasAttribute('inert')) { sib.setAttribute('inert', ''); inerted.push(sib); }
  }
  const a = document.activeElement;
  if (!a || a === document.body || !top.contains(a)) {
    const l = tabbables(top), f = l.find(el => el.classList.contains('pri')) || l[0];
    if (f && !isTextField(f)) { try { f.focus({ preventScroll: true }); } catch {} }
  }
  if (!modalTimer) modalTimer = setInterval(syncModal, 160);
}
const syncSoon = () => { if (syncSoon.t) return; syncSoon.t = setTimeout(() => { syncSoon.t = 0; syncModal(); }, 60); };
document.addEventListener('focusin', e => { if (!modal && e.target !== document.body && !(e.target.closest && e.target.closest(MODALS.join(',') + ',#palO,#setO'))) lastFocus = e.target; }, true);
addEventListener('keydown', e => {
  if (e.key !== 'Tab' || !modal) return;
  const list = tabbables(modal); if (!list.length) { e.preventDefault(); return; }
  const a = document.activeElement, i = list.indexOf(a);
  if (i < 0) { e.preventDefault(); list[e.shiftKey ? list.length - 1 : 0].focus(); }
  else if (e.shiftKey && i === 0) { e.preventDefault(); list[list.length - 1].focus(); }
  else if (!e.shiftKey && i === list.length - 1) { e.preventDefault(); list[0].focus(); }
}, true);
new MutationObserver(syncSoon).observe(document.body, { childList: true, subtree: true });
['#palO', '#setO'].forEach(q => { const o = $(q); if (o) new MutationObserver(syncSoon).observe(o, { attributes: true, attributeFilter: ['class'] }); });
SH.modal = { sync: syncModal, get open() { return modal; } };

/* ---------- the API for modules ---------- */
SH.gamepad = {
  enabled,
  get active() { return mode; },
  get connected() { return [...(navigator.getGamepads ? navigator.getGamepads() : [])].filter(g => g && g.connected); },
  /* take the buttons away from the navigation (a test that needs to see every press): capture({ onExit, onProgress }).
     The user gets them back by holding View + Menu for a second (onExit runs), or you call release(). */
  capture(o = {}) { capture = o; ring.classList.remove('on'); showHints(false); kick(); },
  release() { if (capture) releaseCapture(); },
  get captured() { return !!capture; },
  /* every button press while a controller is connected: fn({ index, name, pad }) */
  onButton(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  focus(el) { if (el) { cur = null; setCur(el, true); } },
  move, glyph, BUTTONS: B,
  /* extra selectors that count as an overlay (a custom dialog), so the focus stays inside it */
  addOverlay(sel) { custom.push(sel); },
};
})();
