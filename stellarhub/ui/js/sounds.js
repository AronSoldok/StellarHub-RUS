/* StellarHub · interface sounds: the wiring. The engine is SH.sound in core.js (one AudioContext, the settings, the
   rules that keep it to one sound per gesture); this file connects the interface to it with a few delegated listeners,
   so modules only call SH.sound where a sound means something specific (a scan, a delete, an undo...).

   - click: a pointer (or controller) activation of a button, link, dock item, tab or row, unless something more specific
     already sounded for that same click (a toggle, a tab, the dock, a dropdown, a dialog, a delete...).
   - toggle_on / toggle_off: any .toggle or [role=switch]; tab_switch: a segmented control (.seg) changing its choice.
   - panel_open / panel_close: a dialog (the ones gamepad.js traps the focus in) opening or closing, after a click or a key.
   - hover: entering a dock item, a button, a Home tile or a row that is a button, with a real mouse movement (never
     when the page scrolls under a still pointer), at most every 70 ms.
   - unavailable: pressing a disabled button.
   - app_start / admin_granted: once when the window first appears (not after a reload, not when it starts hidden).
   Preloading: the sounds a first click needs are fetched and decoded in idle time after the first paint. */
'use strict';
(() => {
const { $$, state } = SH;
const sound = SH.sound;

/* ---------- preload ---------- */
const COMMON = ['click', 'hover', 'tab_switch', 'navigate', 'toggle_on', 'toggle_off', 'panel_open', 'panel_close', 'dropdown',
  'palette_open', 'toast', 'success', 'error', 'warning', 'unavailable', 'app_exit', 'focus_move'];
const idle = fn => (window.requestIdleCallback ? requestIdleCallback(fn, { timeout: 4000 }) : setTimeout(fn, 1200));
const soundsOn = () => state.settings.sounds !== false && +state.settings.soundVolume > 0;
/* the start sound is needed at once; the rest waits for the first paint and an idle moment */
SH.on('boot', () => {
  if (soundsOn()) sound.preload(['app_start']);
  requestAnimationFrame(() => idle(() => { if (soundsOn()) sound.preload(COMMON); }));
});
SH.on('setting', ({ key, val }) => { if (key === 'sounds' && val) idle(() => sound.preload(COMMON)); });

/* ---------- the window appears ---------- */
SH.on('shown', ({ shown }) => {
  if (!shown) return;  /* started hidden in the tray with Windows: no sound when it is opened later */
  let again = false; try { again = !!sessionStorage.getItem('sh.started'); sessionStorage.setItem('sh.started', '1'); } catch {}
  if (again) return;   /* a reload (language change): it already greeted */
  const s = state.settings, asked = +s.adminAsked || 0;
  if (asked) SH.setSetting('adminAsked', 0);
  /* back as administrator because the user asked for it a moment ago */
  if (state.admin && asked && Date.now() - asked < 180000) sound('admin_granted', { visible: true });
  else sound('app_start', { visible: true });
});

/* ---------- dialogs ---------- */
const MODALS = '.su-ov, .cs-o.on, .hg-dlg, .mdlg, .bk-dq-o, .dq-o';
const vis = el => el.checkVisibility ? el.checkVisibility({ checkVisibilityCSS: true }) : !!el.offsetParent;
const dialogs = () => $$(MODALS).filter(vis);
let known = [];
/* +1 a dialog opened, -1 one closed, 0 nothing changed (the list is remembered for the next call) */
function dialogChange() {
  const now = dialogs(), opened = now.some(d => !known.includes(d)), closed = known.some(d => !now.includes(d) || !d.isConnected);
  known = now;
  return opened ? 1 : closed ? -1 : 0;
}
/* a dialog that opens or closes a moment after a click or a key (it waited for an answer, Esc closed it) */
let gestAt = 0, checks = [];
function afterGesture() {
  gestAt = performance.now(); checks.forEach(clearTimeout);
  checks = [90, 420].map(ms => setTimeout(() => {
    const c = dialogChange(); if (!c) return;
    if (sound.last > gestAt) return;  /* that gesture already made its sound */
    sound(c > 0 ? 'panel_open' : 'panel_close');
  }, ms));
}
addEventListener('pointerdown', afterGesture, { capture: true, passive: true });
addEventListener('keydown', e => { if (e.isTrusted && (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ')) afterGesture(); }, { capture: true, passive: true });
SH.on('boot', () => { if (SH.gamepad) SH.gamepad.onButton(afterGesture); });

/* ---------- clicks ---------- */
const CLICKABLE = 'button, a[href], [role=button], [role=tab], [role=option], [role=menuitem], [role=checkbox], .btn, .dk, .check, summary, label[for]';
const TOGGLE = '.toggle, [role=switch]';
/* what a click looked like before the page handled it (a click made by code inside another one has its own entry) */
const pre = new WeakMap();
const CHOICE = '.seg button, [role=tab]';
addEventListener('click', e => {
  const act = sound.begin();
  dialogChange();
  const el = e.target.closest && e.target.closest(`${TOGGLE}, ${CHOICE}, ${CLICKABLE}`);
  pre.set(e, { act, el, wasOn: !!(el && el.matches(CHOICE) && (el.classList.contains('on') || el.getAttribute('aria-selected') === 'true')) });
}, true);
addEventListener('click', e => {
  const p = pre.get(e);
  if (!p || p.act.claimed || !p.el) { dialogChange(); return; }
  /* real input only: a pointer, a key (Enter or Space on a button), or the controller's A. A click made by code is not. */
  const pad = SH.sound.viaPad === true, trusted = e.isTrusted || pad, pointer = e.detail > 0 || pad;
  if (!trusted) return;  /* (the check after the gesture still hears a dialog it opened or closed: the controller's B) */
  const el = p.el, c = dialogChange();
  if (el.disabled) return;
  if (c > 0) { sound('panel_open'); return; }
  if (c < 0) { sound('panel_close'); return; }
  if (el.matches(TOGGLE)) { const on = el.classList.contains('on') || el.getAttribute('aria-checked') === 'true'; sound(on ? 'toggle_on' : 'toggle_off'); return; }
  if (el.matches(CHOICE)) { if (!p.wasOn) sound('tab_switch'); return; }  /* the choice already made: nothing to say */
  if (pointer) sound('click');
});

/* ---------- a disabled button pressed ---------- */
addEventListener('pointerdown', e => {
  if (e.button !== 0 || !e.isTrusted) return;
  const b = e.target.closest && e.target.closest('button, .btn, [role=button]');
  if (b && (b.disabled || b.getAttribute('aria-disabled') === 'true') && !b.closest('.view:not(.is-on)')) sound('unavailable');
}, { capture: true, passive: true });

/* ---------- hover ---------- */
const HOVER = '.dk, .btn, .bt, button.row, .row[role=button], .row[tabindex="0"], .vcard, .tool, .lang';
let movedAt = -1e9, scrolledAt = -1e9;
addEventListener('pointermove', e => { if (e.isTrusted && (e.movementX || e.movementY)) movedAt = performance.now(); }, { capture: true, passive: true });
addEventListener('scroll', () => { scrolledAt = performance.now(); }, { capture: true, passive: true });
addEventListener('wheel', () => { scrolledAt = performance.now(); }, { capture: true, passive: true });
document.addEventListener('pointerover', e => {
  if (e.pointerType !== 'mouse' || e.buttons || !e.isTrusted) return;
  const el = e.target.closest && e.target.closest(HOVER); if (!el || el.disabled) return;
  if (e.relatedTarget && el.contains(e.relatedTarget)) return;   /* moving inside it, not entering */
  const now = performance.now();
  if (now - movedAt > 60 || now - scrolledAt < 250) return;      /* the page moved under a still pointer */
  if (document.documentElement.classList.contains('pad-mode')) return;
  sound('hover');
}, { passive: true });
})();
