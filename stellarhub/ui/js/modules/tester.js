/* StellarHub · Device Tester: teclado, pantalla, altavoces, micrófono, cámara y ratón. Todo funciona de verdad en el navegador. */
'use strict';
(() => {
const { $, $$, anim, EASE, ic, esc, fmt1, state, tickers } = SH;
let curTab = null;
const active = t => state.view === 'tester' && curTab === t;
const isMin = () => state.settings.intensity === 'min';
SH.icons.add({
  wave: '<path d="M3 12h2l2-6 3 12 3-9 2 6 2-3h4"/>',
  rec: '<circle cx="12" cy="12" r="6.5"/>',
  shot: '<path d="M8 4.5 6.5 7H4a1.5 1.5 0 0 0-1.5 1.5v9A1.5 1.5 0 0 0 4 19h16a1.5 1.5 0 0 0 1.5-1.5v-9A1.5 1.5 0 0 0 20 7h-2.5L16 4.5z"/><circle cx="12" cy="13" r="3.5"/>',
  fullscreen: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  reset: '<path d="M4 12a8 8 0 1 0 2.3-5.6L4 8.5"/><path d="M4 4v4.5h4.5"/>',
});

/* ========================= Teclado ========================= */
/* Distribuciones reales en unidades de tecla (1 u = una letra). Cada tecla: código físico (KeyboardEvent.code), texto, x, y, ancho, alto. */
const KB_NAMES = {
  es: { Escape: 'Esc', Backspace: 'Retroceso', Tab: 'Tab', CapsLock: 'Bloq Mayús', Enter: 'Intro', ShiftLeft: 'Mayús', ShiftRight: 'Mayús', ControlLeft: 'Ctrl', ControlRight: 'Ctrl', MetaLeft: 'Win', MetaRight: 'Win', AltLeft: 'Alt', AltRight: 'Alt Gr', ContextMenu: 'Menú', Space: '', Fn: 'Fn', PrintScreen: 'Impr', ScrollLock: 'Bl Despl', Pause: 'Pausa', Insert: 'Insert', Delete: 'Supr', Home: 'Inicio', End: 'Fin', PageUp: 'Re Pág', PageDown: 'Av Pág', NumLock: 'Bloq Num', NumpadEnter: 'Intro' },
  en: { Escape: 'Esc', Backspace: 'Backspace', Tab: 'Tab', CapsLock: 'Caps Lock', Enter: 'Enter', ShiftLeft: 'Shift', ShiftRight: 'Shift', ControlLeft: 'Ctrl', ControlRight: 'Ctrl', MetaLeft: 'Win', MetaRight: 'Win', AltLeft: 'Alt', AltRight: 'AltGr', ContextMenu: 'Menu', Space: '', Fn: 'Fn', PrintScreen: 'PrtSc', ScrollLock: 'ScrLk', Pause: 'Pause', Insert: 'Ins', Delete: 'Del', Home: 'Home', End: 'End', PageUp: 'PgUp', PageDown: 'PgDn', NumLock: 'Num', NumpadEnter: 'Enter' },
};
const KB_COMMON = { ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', NumpadDivide: '/', NumpadMultiply: '*', NumpadSubtract: '−', NumpadAdd: '+', NumpadDecimal: ',', Numpad0: '0', Numpad1: '1', Numpad2: '2', Numpad3: '3', Numpad4: '4', Numpad5: '5', Numpad6: '6', Numpad7: '7', Numpad8: '8', Numpad9: '9' };
const KB_LANGS = {
  'es-ES': { n: 'Español (España)', iso: true, names: 'es', map: { Backquote: 'º', Minus: "'", Equal: '¡', BracketLeft: '`', BracketRight: '+', Semicolon: 'Ñ', Quote: '´', Backslash: 'Ç', IntlBackslash: '<', Comma: ',', Period: '.', Slash: '-' } },
  'es-419': { n: 'Español (Latinoamérica)', iso: true, names: 'es', map: { Backquote: '|', Minus: "'", Equal: '¿', BracketLeft: '´', BracketRight: '+', Semicolon: 'Ñ', Quote: '{', Backslash: '}', IntlBackslash: '<', Comma: ',', Period: '.', Slash: '-' } },
  'en-US': { n: 'Inglés (EE. UU.)', iso: false, names: 'en', map: { Backquote: '`', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', AltRight: 'Alt' } },
  'en-GB': { n: 'Inglés (Reino Unido)', iso: true, names: 'en', map: { Backquote: '`', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Semicolon: ';', Quote: "'", Backslash: '#', IntlBackslash: '\\', Comma: ',', Period: '.', Slash: '/' } },
  'fr-FR': { n: 'Francés', iso: true, names: 'en', map: { Backquote: '²', Digit1: '&', Digit2: 'é', Digit3: '"', Digit4: "'", Digit5: '(', Digit6: '-', Digit7: 'è', Digit8: '_', Digit9: 'ç', Digit0: 'à', Minus: ')', Equal: '=', KeyQ: 'A', KeyW: 'Z', KeyA: 'Q', KeyZ: 'W', Semicolon: 'M', KeyM: ',', Comma: ';', Period: ':', Slash: '!', BracketLeft: '^', BracketRight: '$', Quote: 'ù', Backslash: '*', IntlBackslash: '<' } },
  'de-DE': { n: 'Alemán', iso: true, names: 'en', map: { Backquote: '^', Minus: 'ß', Equal: '´', KeyY: 'Z', KeyZ: 'Y', BracketLeft: 'Ü', BracketRight: '+', Semicolon: 'Ö', Quote: 'Ä', Backslash: '#', IntlBackslash: '<', Comma: ',', Period: '.', Slash: '-' } },
  'pt-BR': { n: 'Portugués (Brasil)', iso: true, abnt: true, names: 'en', map: { Backquote: "'", Minus: '-', Equal: '=', BracketLeft: '´', BracketRight: '[', Semicolon: 'Ç', Quote: '~', Backslash: ']', IntlBackslash: '\\', Comma: ',', Period: '.', Slash: ';', IntlRo: '/' } },
};
const KB_FORMATS = { laptop: 'Portátil', full: 'Completo 100 %', tkl: 'TKL 80 %', p75: '75 %', p65: '65 %' };
function kbLabel(L, c) { return L.map[c] ?? KB_COMMON[c] ?? KB_NAMES[L.names][c] ?? (c.startsWith('Key') ? c.slice(3) : c.startsWith('Digit') ? c.slice(5) : /^F\d+$/.test(c) ? c : c); }
function kbLayout(fmt, lang) {
  const L = KB_LANGS[lang] || KB_LANGS['es-ES']; const K = [];
  const add = (code, x, y, w = 1, h = 1, cls = '') => K.push({ code, label: kbLabel(L, code), x, y, w, h, cls });
  const main = (y0, shiftEnd) => {
    add('Backquote', 0, y0); '1234567890'.split('').forEach((d, i) => add('Digit' + d, 1 + i, y0)); add('Minus', 11, y0); add('Equal', 12, y0); add('Backspace', 13, y0, 2);
    let y = y0 + 1; add('Tab', 0, y, 1.5); 'QWERTYUIOP'.split('').forEach((c, i) => add('Key' + c, 1.5 + i, y)); add('BracketLeft', 11.5, y); add('BracketRight', 12.5, y);
    if (L.iso) add('Enter', 13.5, y, 1.5, 1, 'iso-a'); else add('Backslash', 13.5, y, 1.5);
    y = y0 + 2; add('CapsLock', 0, y, 1.75); 'ASDFGHJKL'.split('').forEach((c, i) => add('Key' + c, 1.75 + i, y)); add('Semicolon', 10.75, y); add('Quote', 11.75, y);
    if (L.iso) { add('Backslash', 12.75, y); add('Enter', 13.75, y, 1.25, 1, 'iso-b'); } else add('Enter', 12.75, y, 2.25);
    y = y0 + 3; let x;
    if (L.iso) { add('ShiftLeft', 0, y, 1.25); add('IntlBackslash', 1.25, y); x = 2.25; } else { add('ShiftLeft', 0, y, 2.25); x = 2.25; }
    'ZXCVBNM'.split('').forEach((c, i) => add('Key' + c, x + i, y)); add('Comma', x + 7, y); add('Period', x + 8, y); add('Slash', x + 9, y); x += 10;
    if (L.abnt) { add('IntlRo', x, y); x += 1; }
    add('ShiftRight', x, y, shiftEnd - x);
    return y0 + 4;
  };
  const fnRow = (y, h, keys) => keys.forEach(([c, x, w = 1]) => add(c, x, y, w, h, 'fn'));
  let W = 15, H = 6;
  if (fmt === 'laptop') {
    fnRow(0, .7, [['Escape', 0], ...Array.from({ length: 12 }, (_, i) => ['F' + (i + 1), 1 + i]), ['PrintScreen', 13], ['Delete', 14]]);
    const y = main(.9, 15);
    add('ControlLeft', 0, y, 1.25); add('Fn', 1.25, y); add('MetaLeft', 2.25, y); add('AltLeft', 3.25, y, 1.25); add('Space', 4.5, y, 5.5); add('AltRight', 10, y); add('ControlRight', 11, y);
    add('ArrowLeft', 12, y + .5, 1, .5, 'half'); add('ArrowUp', 13, y, 1, .5, 'half'); add('ArrowDown', 13, y + .5, 1, .5, 'half'); add('ArrowRight', 14, y + .5, 1, .5, 'half');
    W = 15; H = y + 1;
  } else if (fmt === 'full' || fmt === 'tkl') {
    fnRow(0, 1, [['Escape', 0], ...[1, 2, 3, 4].map(i => ['F' + i, 1 + i]), ...[5, 6, 7, 8].map(i => ['F' + i, 1.5 + i]), ...[9, 10, 11, 12].map(i => ['F' + i, 2 + i]), ['PrintScreen', 15.25], ['ScrollLock', 16.25], ['Pause', 17.25]]);
    const y = main(1.5, 15);
    [['ControlLeft', 1.25], ['MetaLeft', 1.25], ['AltLeft', 1.25], ['Space', 6.25], ['AltRight', 1.25], ['MetaRight', 1.25], ['ContextMenu', 1.25], ['ControlRight', 1.25]].reduce((x, [c, w]) => { add(c, x, y, w); return x + w; }, 0);
    add('Insert', 15.25, 1.5); add('Home', 16.25, 1.5); add('PageUp', 17.25, 1.5); add('Delete', 15.25, 2.5); add('End', 16.25, 2.5); add('PageDown', 17.25, 2.5);
    add('ArrowUp', 16.25, y - 1); add('ArrowLeft', 15.25, y); add('ArrowDown', 16.25, y); add('ArrowRight', 17.25, y);
    W = 18.25; H = y + 1;
    if (fmt === 'full') {
      const nx = 18.5;
      add('NumLock', nx, 1.5); add('NumpadDivide', nx + 1, 1.5); add('NumpadMultiply', nx + 2, 1.5); add('NumpadSubtract', nx + 3, 1.5);
      add('Numpad7', nx, 2.5); add('Numpad8', nx + 1, 2.5); add('Numpad9', nx + 2, 2.5); add('NumpadAdd', nx + 3, 2.5, 1, 2);
      add('Numpad4', nx, 3.5); add('Numpad5', nx + 1, 3.5); add('Numpad6', nx + 2, 3.5);
      add('Numpad1', nx, 4.5); add('Numpad2', nx + 1, 4.5); add('Numpad3', nx + 2, 4.5); add('NumpadEnter', nx + 3, 4.5, 1, 2);
      add('Numpad0', nx, 5.5, 2); add('NumpadDecimal', nx + 2, 5.5);
      W = 22.5;
    }
  } else {
    const has75 = fmt === 'p75'; let y0 = 0;
    if (has75) { fnRow(0, 1, [['Escape', 0], ...Array.from({ length: 12 }, (_, i) => ['F' + (i + 1), 1 + i]), ['PrintScreen', 13], ['Insert', 14], ['Delete', 15]]); y0 = 1.15; }
    const y = main(y0, 14);
    if (!has75) { K.splice(K.findIndex(k => k.code === 'Backquote'), 1); add('Escape', 0, y0); }
    add(has75 ? 'Home' : 'Delete', 15, y0); add('PageUp', 15, y0 + 1); add('PageDown', 15, y0 + 2); add('ArrowUp', 14, y0 + 3); add('End', 15, y0 + 3);
    [['ControlLeft', 1.25], ['MetaLeft', 1.25], ['AltLeft', 1.25], ['Space', 6.25], ['AltRight', 1], ['Fn', 1], ['ControlRight', 1]].reduce((x, [c, w]) => { add(c, x, y, w); return x + w; }, 0);
    add('ArrowLeft', 13, y); add('ArrowDown', 14, y); add('ArrowRight', 15, y);
    W = 16; H = y + 1;
  }
  return { keys: K, W, H, count: new Set(K.map(k => k.code).filter(c => c !== 'Fn')).size };
}
const kb = { capturing: false, tested: new Set(), down: new Map(), lastUp: {}, maxRoll: 0, chatter: new Set(), stuck: new Set(), escT: 0, presses: 0, layout: null, detected: null, sugNum: false };
const kbFmt = () => state.settings.testerKbFormat || 'laptop';
const kbLang = () => state.settings.testerKbLang || kb.detected || 'es-ES';
function kbKeysHTML() {
  const lay = kb.layout = kbLayout(kbFmt(), kbLang());
  return lay.keys.map(k => `<div class="k${k.code === 'Fn' ? ' nd' : ''}${k.label && k.label.length > 3 ? ' sm' : ''}${k.cls ? ' ' + k.cls : ''}${kb.tested.has(k.code) ? ' done' : ''}" data-code="${k.code}" style="--x:${k.x};--y:${k.y};--w:${k.w};--h:${k.h}"><span>${esc(k.label)}</span>${k.code === 'Escape' ? '<i class="esc-ring"></i>' : ''}</div>`).join('');
}
function kbFit(el) {
  const st = $('#kbStage', el), box = $('#kbKeys', el); if (!st || !box || !kb.layout) return;
  const u = Math.max(18, Math.min(st.clientWidth / kb.layout.W, st.clientHeight / kb.layout.H, 78));
  box.style.setProperty('--u', u + 'px'); box.style.width = (u * kb.layout.W) + 'px'; box.style.height = (u * kb.layout.H) + 'px';
}
function kbRebuild(el, animate) {
  const box = $('#kbKeys', el); box.innerHTML = kbKeysHTML(); kbFit(el);
  $('#kbTot', el).textContent = `de ${kb.layout.count} teclas`; updKb(el);
  if (animate) $$('.k', box).forEach((k, i) => anim(k, [{ opacity: 0, transform: 'scale(.6)' }, { opacity: 1, transform: 'none' }], { d: 380, delay: Math.min(i * 4, 260), e: EASE.spring }));
}
async function kbDetect(el) {
  try {
    if (!navigator.keyboard || !navigator.keyboard.getLayoutMap) return;
    const m = await navigator.keyboard.getLayoutMap(); const g = c => (m.get(c) || '').toLowerCase();
    const d = g('KeyQ') === 'a' ? 'fr-FR' : g('KeyY') === 'z' ? 'de-DE' : g('Semicolon') === 'ñ' ? (g('Backquote') === 'º' ? 'es-ES' : 'es-419') : g('Semicolon') === 'ç' ? 'pt-BR' : g('Backslash') === '#' ? 'en-GB' : 'en-US';
    kb.detected = d; const chip = $('#kbDet', el);
    if (chip) { chip.hidden = false; chip.innerHTML = `${ic('check')}Windows usa ${esc(KB_LANGS[d].n)}`; }
    if (!state.settings.testerKbLang && d !== 'es-ES') { $('#kbLang', el).value = d; kbRebuild(el, true); }
  } catch {}
}
function renderKeyboard(el) {
  el.classList.add('fill');
  el.innerHTML = `<div class="kb">
    <div class="pan kb-board" data-asm>
      <div class="kb-top"><div class="seg" id="kbFmt"><span class="ind"></span>${Object.entries(KB_FORMATS).map(([k, n]) => `<button data-v="${k}"${kbFmt() === k ? ' class="on"' : ''}>${n}</button>`).join('')}</div>
        <label class="field kb-lang">${ic('globe')}<select id="kbLang">${Object.entries(KB_LANGS).map(([k, l]) => `<option value="${k}"${kbLang() === k ? ' selected' : ''}>${l.n}</option>`).join('')}</select></label>
        <span class="chip ok kb-det" id="kbDet" hidden></span></div>
      <div class="kb-sug" id="kbSug" hidden>${ic('info')}<span>Has pulsado una tecla del teclado numérico. ¿Cambiamos al formato completo?</span><button class="btn sec sm" id="kbSugYes">Cambiar a 100 %</button><button class="btn ghost sm" id="kbSugNo">No</button></div>
      <div class="kb-stage" id="kbStage"><div class="kb-keys" id="kbKeys"></div></div>
      <div class="kb-cover" id="kbCover"><div><b>Pulsa «Empezar» y luego cada tecla</b><span>Mientras dura la prueba, StellarHub no reacciona a sus atajos. Mantén Esc un segundo para salir. Windows se reserva Win + algo, Alt + Tab y Fn.</span><button class="btn pri lg" id="kbStart">${ic('keyboard')}Empezar</button></div></div></div>
    <div class="kb-side">
      <div class="pan" data-asm><h4>Progreso</h4><div class="kb-n"><b class="big" id="kbN">0</b><span class="muted" id="kbTot">de 0 teclas</span></div><div class="bar" style="margin-top:12px"><span id="kbBar" style="transform:scaleX(0)"></span></div></div>
      <div class="pan kb-stats" data-asm>
        <div><span class="muted">Teclas a la vez (máximo)</span><b id="kbRoll">0</b></div>
        <div><span class="muted">Pulsaciones</span><b id="kbPress">0</b></div>
        <div><span class="muted">Última tecla</span><b id="kbLast">–</b></div></div>
      <div class="pan kb-wp" data-asm><h4>Avisos</h4><div id="kbWarn" class="kb-warn"><span class="faint">Nada raro por ahora.</span></div></div>
      <div class="kb-acts" data-asm><button class="btn sec" id="kbReset">${ic('reset')}Reiniciar</button><button class="btn ghost" id="kbStop" hidden>Terminar la prueba</button></div>
    </div></div>`;
  kb.el = el;
  kbRebuild(el, false);
  new ResizeObserver(() => kbFit(el)).observe($('#kbStage', el));
  requestAnimationFrame(() => SH.placeSeg($('#kbFmt', el), true));
  $('#kbFmt', el).addEventListener('click', e => { const b = e.target.closest('button'); if (!b || b.classList.contains('on')) return; $$('#kbFmt button', el).forEach(x => x.classList.toggle('on', x === b)); SH.placeSeg($('#kbFmt', el)); SH.setSetting('testerKbFormat', b.dataset.v); kbRebuild(el, true); });
  $('#kbLang', el).addEventListener('change', e => { SH.setSetting('testerKbLang', e.target.value); kbRebuild(el, true); });
  $('#kbSugYes', el).addEventListener('click', () => { const b = $('#kbFmt [data-v="full"]', el); b && b.click(); hideSug(el); });
  $('#kbSugNo', el).addEventListener('click', () => { kb.sugNum = true; hideSug(el); });
  $('#kbStart', el).addEventListener('click', () => setCapture(el, true));
  $('#kbStop', el).addEventListener('click', () => setCapture(el, false));
  $('#kbReset', el).addEventListener('click', () => { kb.tested.clear(); kb.down.clear(); kb.chatter.clear(); kb.stuck.clear(); kb.maxRoll = 0; kb.presses = 0; $$('.k', el).forEach(k => k.classList.remove('done', 'down', 'warn')); updKb(el); SH.toast('Prueba de teclado reiniciada.'); });
  kbDetect(el);
}
function showSug(el) { const s = $('#kbSug', el); if (!s || !s.hidden) return; s.hidden = false; anim(s, [{ opacity: 0, transform: 'translate3d(0,-6px,0)' }, { opacity: 1, transform: 'none' }], { d: 320, e: EASE.spring }); kbFit(el); }
function hideSug(el) { const s = $('#kbSug', el); if (s) s.hidden = true; kbFit(el); }
function setCapture(el, on) {
  kb.capturing = on; const cov = $('#kbCover', el);
  if (on) { anim(cov, [{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(1.04)' }], { d: 260 }).finished.then(() => { if (kb.capturing) cov.hidden = true; }).catch(() => {}); }
  else { cov.hidden = false; anim(cov, [{ opacity: 0 }, { opacity: 1 }], { d: 260 }); $('#kbCover b', el).textContent = kb.layout && kb.tested.size >= kb.layout.count ? 'Todas las teclas funcionan' : 'Prueba en pausa'; $('#kbStart', el).innerHTML = `${ic('keyboard')}Seguir probando`; }
  $('#kbStop', el).hidden = !on;
}
const keyEls = code => kb.el ? $$(`.k[data-code="${code}"]`, kb.el) : [];
function updKb(el) {
  if (!el || !kb.layout) return; const n = [...kb.tested].filter(c => kb.layout.keys.some(k => k.code === c)).length; const nEl = $('#kbN', el);
  if (+nEl.textContent !== n) { nEl.textContent = n; anim(nEl, [{ transform: 'translateY(-4px)', opacity: .5 }, { transform: 'none', opacity: 1 }], { d: 220 }); }
  $('#kbBar', el).style.transform = `scaleX(${(n / kb.layout.count).toFixed(3)})`; $('#kbRoll', el).textContent = kb.maxRoll; $('#kbPress', el).textContent = SH.fmtInt(kb.presses);
  const w = [...[...kb.stuck].map(c => `<div class="chip warn">${ic('alert')}${esc(c)} lleva más de 5 s pulsada</div>`), ...[...kb.chatter].map(c => `<div class="chip bad">${ic('alert')}${esc(c)}: posible rebote (doble pulsación muy rápida)</div>`)];
  $('#kbWarn', el).innerHTML = w.length ? w.join('') : '<span class="faint">Nada raro por ahora.</span>';
}
/* La tecla Windows: Windows se queda su keyup (abre Inicio, Win+algo…), así que se suelta en cuanto llega
   cualquier evento sin metaKey, al perder el foco o tras 1,5 s. Nunca cuenta como «atascada». */
const META = ['MetaLeft', 'MetaRight', 'OSLeft', 'OSRight'];
function keyUpVisual(code) {
  keyEls(code).forEach(k => { k.classList.remove('down', 'warn'); k.getAnimations().forEach(x => { if (!(window.CSSTransition && x instanceof CSSTransition)) x.cancel(); }); anim(k, [{ transform: 'translateY(2px) scale(.95)' }, { transform: 'translateY(0) scale(1)' }], { d: 260, e: EASE.spring, keep: true }); });
}
function releaseMeta() { META.forEach(c => { if (kb.down.has(c)) { kb.down.delete(c); kb.lastUp[c] = performance.now(); kb.stuck.delete(c); keyUpVisual(c); } }); }
/* Impr Pant: el navegador solo entrega su keyup; se cuenta como pulsación completa */
function virtualPress(code, e) {
  kb.presses++; const fresh = !kb.tested.has(code); kb.tested.add(code);
  keyEls(code).forEach(k => { k.classList.add('done'); anim(k, [{ transform: 'translateY(0) scale(1)' }, { transform: 'translateY(2px) scale(.95)' }, { transform: 'translateY(0) scale(1)' }], { d: 320, e: EASE.out, keep: true });
    if (fresh && !isMin()) { const r = document.createElement('i'); r.className = 'rip'; k.appendChild(r); anim(r, [{ transform: 'scale(.2)', opacity: .8 }, { transform: 'scale(2.6)', opacity: 0 }], { d: 520 }).finished.then(() => r.remove()).catch(() => r.remove()); } });
  $('#kbLast', kb.el).textContent = `${e.key || code}  (${code})`;
}
addEventListener('keydown', e => {
  if (!kb.capturing || !active('keyboard')) return;
  e.preventDefault(); e.stopImmediatePropagation();
  const code = e.code || e.key; if (!e.metaKey && !META.includes(code)) releaseMeta(); if (e.repeat) return;
  const now = performance.now(); if (kb.lastUp[code] && now - kb.lastUp[code] < 35) kb.chatter.add(code);
  kb.down.set(code, now); kb.presses++; kb.maxRoll = Math.max(kb.maxRoll, kb.down.size);
  if (code.startsWith('Numpad') && kbFmt() !== 'full' && !kb.sugNum) showSug(kb.el);
  const ks = keyEls(code); const fresh = !kb.tested.has(code); kb.tested.add(code);
  ks.forEach(k => { k.classList.add('down', 'done'); anim(k, [{ transform: 'translateY(0) scale(1)' }, { transform: 'translateY(2px) scale(.95)' }], { d: 70, e: EASE.out, keep: true });
    if (fresh && !isMin()) { const r = document.createElement('i'); r.className = 'rip'; k.appendChild(r); anim(r, [{ transform: 'scale(.2)', opacity: .8 }, { transform: 'scale(2.6)', opacity: 0 }], { d: 520 }).finished.then(() => r.remove()).catch(() => r.remove()); } });
  $('#kbLast', kb.el).textContent = (e.key === ' ' ? 'Espacio' : e.key.length === 1 ? e.key.toUpperCase() : e.key) + (code !== e.key ? `  (${code})` : '');
  if (code === 'Escape') kb.escT = now;
  updKb(kb.el);
}, true);
addEventListener('keyup', e => {
  if (!kb.capturing || !active('keyboard')) return;
  e.preventDefault(); e.stopImmediatePropagation();
  const code = e.code || e.key;
  if (code === 'PrintScreen' && !kb.down.has(code)) { virtualPress(code, e); updKb(kb.el); return; }
  kb.down.delete(code); kb.lastUp[code] = performance.now(); kb.stuck.delete(code);
  keyUpVisual(code);
  if (!e.metaKey) releaseMeta();
  if (code === 'Escape') { kb.escT = 0; const r = $('.esc-ring', kb.el); if (r) r.style.transform = 'scaleX(0)'; }
  updKb(kb.el);
}, true);
addEventListener('blur', () => { kb.down.clear(); if (kb.el) $$('.k.down', kb.el).forEach(k => k.classList.remove('down', 'warn')); });
document.addEventListener('visibilitychange', () => { if (document.hidden) releaseMeta(); });
tickers.add(() => {
  if (!kb.capturing || !active('keyboard')) return; const now = performance.now();
  if (kb.escT) { const p = Math.min(1, (now - kb.escT) / 1000); const r = $('.esc-ring', kb.el); if (r) r.style.transform = `scaleX(${p})`; if (p >= 1) { kb.escT = 0; kb.down.clear(); $$('.k.down', kb.el).forEach(k => k.classList.remove('down')); setCapture(kb.el, false); } }
  let ch = false;
  kb.down.forEach((t, c) => { if (META.includes(c) && now - t > 1500) { releaseMeta(); ch = true; } });
  kb.down.forEach((t, c) => { if (c !== 'Escape' && !META.includes(c) && now - t > 5000 && !kb.stuck.has(c)) { kb.stuck.add(c); ch = true; keyEls(c).forEach(k => k.classList.add('warn')); } }); if (ch) updKb(kb.el);
});

/* ========================= Pantalla ========================= */
const SCREENS = [
  { n: 'Negro', bg: '#000', why: 'Busca puntos de luz: píxeles encendidos que no se apagan.' },
  { n: 'Blanco', bg: '#fff', why: 'Busca puntos oscuros: píxeles muertos.' },
  { n: 'Rojo', bg: '#f00', why: 'Un subpíxel rojo roto se ve como un punto negro.' },
  { n: 'Verde', bg: '#0f0', why: 'Un subpíxel verde roto se ve como un punto negro.' },
  { n: 'Azul', bg: '#00f', why: 'Un subpíxel azul roto se ve como un punto negro.' },
  { n: 'Gris medio', bg: '#808080', why: 'Busca manchas o zonas más claras: uniformidad del panel.' },
  { n: 'Degradado', bg: 'linear-gradient(90deg,#000,#fff)', why: 'Debe verse suave, sin escalones marcados.' },
  { n: 'Colores', bg: 'linear-gradient(90deg,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00)', why: 'Transiciones suaves entre todos los colores.' },
  { n: 'Cuadrícula', bg: 'repeating-linear-gradient(0deg,#fff 0 1px,#000 1px 40px),repeating-linear-gradient(90deg,#fff 0 1px,transparent 1px 40px)', why: 'Las líneas deben ser rectas y nítidas hasta los bordes.' },
];
const scr = { seen: new Set(), i: 0, ov: null, hz: 0, frames: [] };
function renderScreen(el) {
  el.classList.add('fill');
  el.innerHTML = `<div class="sc">
    <div class="pan sc-main" data-asm><div class="sc-hd"><div><h4>Píxeles muertos y uniformidad</h4><p class="muted">Se abre a pantalla completa. Clic, Espacio o flechas para cambiar de color. Esc para salir.</p></div>
      <button class="btn pri lg" id="scGo">${ic('fullscreen')}Empezar a pantalla completa</button></div>
      <div class="sc-tiles">${SCREENS.map((s, i) => `<button class="sc-t" data-i="${i}" style="--bg:${s.bg}"><span class="sw"></span><b>${s.n}</b><i class="sc-ok">${ic('check')}</i></button>`).join('')}</div>
      <div class="sc-n faint" id="scN">Has visto 0 de ${SCREENS.length}</div></div>
    <div class="sc-side">
      <div class="pan" data-asm><h4>Frecuencia de refresco</h4><div class="kb-n"><b class="big" id="scHz">–</b><span class="muted">Hz medidos</span></div><p class="faint sc-p">Tu panel interno anuncia 165 Hz y el monitor externo 144 Hz. Si sale mucho menos, revisa la frecuencia en Configuración de pantalla.</p></div>
      <div class="pan sc-mp" data-asm><h4>Nitidez en movimiento</h4><div class="sc-motion"><span id="scBall"></span></div><p class="faint sc-p">El bloque debe moverse sin estela ni saltos.</p></div>
    </div></div>`;
  $('#scGo', el).addEventListener('click', () => openScreen(el, 0));
  $('.sc-tiles', el).addEventListener('click', e => { const t = e.target.closest('.sc-t'); if (t) openScreen(el, +t.dataset.i); });
  scr.el = el;
}
function markSeen(i) { scr.seen.add(i); if (!scr.el) return; const t = $(`.sc-t[data-i="${i}"]`, scr.el); if (t && !t.classList.contains('seen')) { t.classList.add('seen'); } $('#scN', scr.el).textContent = `Has visto ${scr.seen.size} de ${SCREENS.length}`; }
function openScreen(el, i) {
  if (scr.ov) return;
  const ov = document.createElement('div'); ov.className = 'sc-ov'; ov.innerHTML = '<div class="sc-hint"><b></b><span></span><em>Clic o flechas para cambiar, Esc para salir</em></div>';
  document.body.appendChild(ov); scr.ov = ov; scr.i = i;
  const show = (j, dir = 1) => { scr.i = (j + SCREENS.length) % SCREENS.length; const s = SCREENS[scr.i]; ov.style.background = s.bg; markSeen(scr.i);
    const h = $('.sc-hint', ov); $('b', h).textContent = s.n; $('span', h).textContent = s.why; h.classList.toggle('dark', ['Blanco', 'Verde', 'Gris medio'].includes(s.n));
    anim(h, [{ opacity: 0, transform: `translate3d(${dir * 20}px,0,0)` }, { opacity: 1, transform: 'none', offset: .15 }, { opacity: 1, offset: .75 }, { opacity: 0 }], { d: 2600 }); };
  const close = () => { if (!scr.ov) return; removeEventListener('keydown', onKey, true); document.removeEventListener('fullscreenchange', onFs);
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    anim(ov, [{ opacity: 1 }, { opacity: 0 }], { d: 200 }).finished.then(() => ov.remove()).catch(() => ov.remove()); scr.ov = null; };
  const onKey = e => { e.preventDefault(); e.stopImmediatePropagation(); if (e.type !== 'keydown') return;
    if (e.key === 'Escape') close(); else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') show(scr.i - 1, -1); else if (['ArrowRight', 'ArrowDown', ' ', 'Enter'].includes(e.key)) show(scr.i + 1, 1); };
  const onFs = () => { if (!document.fullscreenElement) close(); };
  addEventListener('keydown', onKey, true);
  ov.addEventListener('click', () => show(scr.i + 1, 1)); ov.addEventListener('contextmenu', e => { e.preventDefault(); show(scr.i - 1, -1); });
  anim(ov, [{ opacity: 0 }, { opacity: 1 }], { d: 220 });
  const req = ov.requestFullscreen ? ov.requestFullscreen() : null;
  if (req && req.then) req.then(() => document.addEventListener('fullscreenchange', onFs)).catch(() => {});
  show(i);
}
tickers.add((dt, t) => {
  if (!active('screen')) { scr.frames.length = 0; return; }
  scr.frames.push(t); while (scr.frames.length && t - scr.frames[0] > 1000) scr.frames.shift();
  if (scr.frames.length > 10) { const hz = Math.round((scr.frames.length - 1) / ((scr.frames[scr.frames.length - 1] - scr.frames[0]) / 1000)); if (Math.abs(hz - scr.hz) > 1) { scr.hz = hz; const e = $('#scHz', scr.el); if (e) e.textContent = hz; } }
  const b = scr.el && $('#scBall', scr.el); if (b && !isMin()) { const w = b.parentElement.clientWidth - 40; const x = (Math.sin(t / 700) * .5 + .5) * w; b.style.transform = `translate3d(${x.toFixed(1)}px,0,0)`; }
});

/* ========================= Altavoces ========================= */
const au = { ctx: null, vol: .5, sweep: null, playing: null };
function audioCtx() { if (!au.ctx) { const C = window.AudioContext || window.webkitAudioContext; if (!C) return null; au.ctx = new C(); } if (au.ctx.state === 'suspended') au.ctx.resume(); return au.ctx; }
function renderSpeakers(el) {
  el.classList.add('fill');
  el.innerHTML = `<div class="sp">
    <div class="pan sp-stage" data-asm>
      <div class="sp-spk" data-side="L"><div class="sp-cone"><i></i><i></i><i></i><span></span></div><b>Izquierdo</b></div>
      <div class="sp-mid"><div class="sp-btns">
        <button class="btn sec lg" data-play="L">${ic('speaker')}Izquierdo</button><button class="btn pri lg" data-play="C">${ic('speaker')}Los dos</button><button class="btn sec lg" data-play="R">${ic('speaker')}Derecho</button></div>
        <p class="faint">Cada botón toca tres notas. Si suenan en el lado equivocado, los cables o la configuración están invertidos.</p>
        <label class="sp-vol"><span class="muted">Volumen de la prueba</span><input type="range" min="0" max="100" value="50" id="spVol"><b id="spVolV">50 %</b></label></div>
      <div class="sp-spk" data-side="R"><div class="sp-cone"><i></i><i></i><i></i><span></span></div><b>Derecho</b></div>
    </div>
    <div class="pan sp-sweep" data-asm><div class="sp-sh"><div><h4>Barrido de frecuencias</h4><p class="muted">De 20 Hz a 20 kHz en 12 segundos. Fíjate dónde empiezas y dejas de oírlo, y si algo vibra o zumba.</p></div>
      <button class="btn sec" id="spSweep">${ic('wave')}Empezar el barrido</button></div>
      <div class="sp-scale"><div class="sp-track"><span id="spProg"></span><i id="spHead"></i></div><div class="sp-ticks">${['20 Hz', '100 Hz', '1 kHz', '5 kHz', '20 kHz'].map(t => `<span>${t}</span>`).join('')}</div></div>
      <div class="sp-now"><b class="big" id="spHz">20 Hz</b><span class="muted" id="spHzL">listo para empezar</span><span class="chip warn sp-tip">${ic('alert')}Baja el volumen antes: los agudos pueden molestar</span></div></div></div>`;
  au.el = el;
  $('#spVol', el).addEventListener('input', e => { au.vol = e.target.value / 100; $('#spVolV', el).textContent = e.target.value + ' %'; if (au.sweep) au.sweep.g.gain.value = au.vol * .25; });
  $('.sp-btns', el).addEventListener('click', e => { const b = e.target.closest('[data-play]'); if (b) playSide(b.dataset.play); });
  $('#spSweep', el).addEventListener('click', () => au.sweep ? stopSweep() : startSweep());
}
function cone(side, on) { const s = au.el && $(`.sp-spk[data-side="${side}"]`, au.el); if (s) s.classList.toggle('play', on); }
function playSide(side) {
  const c = audioCtx(); if (!c) { SH.toast('Este equipo no permite reproducir audio aquí.'); return; }
  const pan = c.createStereoPanner ? c.createStereoPanner() : null; if (pan) pan.pan.value = side === 'L' ? -1 : side === 'R' ? 1 : 0;
  const out = c.createGain(); out.gain.value = au.vol * .35; (pan ? (out.connect(pan), pan) : out).connect(c.destination);
  [523.25, 659.25, 783.99].forEach((f, i) => { const o = c.createOscillator(), g = c.createGain(); o.type = 'sine'; o.frequency.value = f; const t0 = c.currentTime + i * .22;
    g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(1, t0 + .02); g.gain.exponentialRampToValueAtTime(.001, t0 + .5); o.connect(g).connect(out); o.start(t0); o.stop(t0 + .55); });
  const sides = side === 'C' ? ['L', 'R'] : [side]; sides.forEach(s => cone(s, true)); clearTimeout(au.playing); au.playing = setTimeout(() => sides.forEach(s => cone(s, false)), 1050);
}
function startSweep() {
  const c = audioCtx(); if (!c) return; const o = c.createOscillator(), g = c.createGain(); o.type = 'sine'; g.gain.value = au.vol * .25;
  const T = 12, t0 = c.currentTime; o.frequency.setValueAtTime(20, t0); o.frequency.exponentialRampToValueAtTime(20000, t0 + T); o.connect(g).connect(c.destination); o.start(); o.stop(t0 + T);
  au.sweep = { o, g, t0, T }; $('#spHzL', au.el).textContent = 'sonando ahora'; o.onended = () => stopSweep(true); $('#spSweep', au.el).innerHTML = `${ic('stop')}Parar`; cone('L', true); cone('R', true);
}
function stopSweep(ended) {
  if (!au.sweep) return; try { au.sweep.o.onended = null; au.sweep.o.stop(); } catch {} au.sweep = null; cone('L', false); cone('R', false);
  if (au.el) { $('#spSweep', au.el).innerHTML = `${ic('wave')}Empezar el barrido`; $('#spHzL', au.el).textContent = ended ? 'barrido terminado' : 'parado'; }
}
tickers.add(() => {
  if (!au.sweep || !au.el) return; const k = Math.min(1, (au.ctx.currentTime - au.sweep.t0) / au.sweep.T); const f = 20 * Math.pow(1000, k);
  $('#spHz', au.el).textContent = f >= 1000 ? fmt1(f / 1000) + ' kHz' : Math.round(f) + ' Hz';
  $('#spProg', au.el).style.transform = `scaleX(${k.toFixed(4)})`; $('#spHead', au.el).style.left = (k * 100).toFixed(2) + '%';
});
function closeAudio() { stopSweep(); if (au.ctx) { au.ctx.close().catch(() => {}); au.ctx = null; } }

/* ========================= Micrófono ========================= */
const mic = { stream: null, an: null, ctx: null, buf: null, peak: 0, lvl: 0, rec: null };
/* errores de cámara y micrófono: título, explicación y si hace falta ir a Configuración de Windows */
const denied = e => !!e && (e.name === 'NotAllowedError' || e.name === 'SecurityError');
const MEDIA_ERR = (e, what) => {
  const page = what === 'el micrófono' ? 'Micrófono' : 'Cámara';
  if (denied(e)) return { t: 'Falta el permiso', m: `Se denegó el acceso a ${what} y Windows no vuelve a preguntar. Ábrelo en Configuración > Privacidad y seguridad > ${page}, activa el acceso y también «Permitir que las aplicaciones de escritorio accedan». Luego vuelve a intentarlo.` };
  if (e && (e.name === 'NotFoundError' || e.name === 'OverconstrainedError')) return { t: what === 'el micrófono' ? 'No hay ningún micrófono' : 'No hay ninguna cámara', m: `Windows no encuentra ${what === 'el micrófono' ? 'ningún micrófono conectado' : 'ninguna cámara conectada'}. Si es USB, conéctalo y vuelve a intentarlo.` };
  if (e && e.name === 'NotReadableError') return { t: `${what === 'el micrófono' ? 'El micrófono' : 'La cámara'} está ocupad${what === 'el micrófono' ? 'o' : 'a'}`, m: `Otro programa está usando ${what} (Discord, OBS, Teams…). Ciérralo y vuelve a intentarlo.` };
  return { t: `No se pudo abrir ${what}`, m: e && e.message ? e.message : 'Error desconocido.' };
};
const PRIV = { mic: 'ms-settings:privacy-microphone', cam: 'ms-settings:privacy-webcam' };
const openPriv = k => SH.call('open_url', PRIV[k]).then(r => { if (r === undefined) SH.toast('Esto abre la Configuración de Windows desde la app.'); });
function renderMic(el) {
  el.classList.add('fill');
  el.innerHTML = `<div class="mc">
    <div class="pan mc-main" data-asm>
      <div class="mc-state" id="mcState"><div class="mc-ico">${ic('mic')}</div><b>Prueba tu micrófono</b><span class="muted">Verás el nivel y la forma de onda en vivo. Nada se graba ni se envía a ningún sitio.</span><div class="mc-btns"><button class="btn pri lg" id="mcGo">${ic('mic')}Permitir el micrófono</button><button class="btn sec lg" id="mcPerm" hidden>${ic('external')}Abrir permisos de Windows</button></div></div>
      <div class="mc-live" id="mcLive" hidden><canvas id="mcWave"></canvas>
        <div class="mc-meter"><div class="mc-bar"><span id="mcLvl"></span><i id="mcPeak"></i></div><div class="mc-db"><b id="mcDb">–</b><span class="muted">dB</span></div></div></div></div>
    <div class="mc-side">
      <div class="pan" data-asm><h4>Dispositivo</h4><select class="field mc-sel" id="mcDev" disabled><option>Sin permiso todavía</option></select><div class="mc-info faint" id="mcInfo"></div></div>
      <div class="pan mc-recp" data-asm><h4>Escúchate</h4><p class="muted mc-p">Graba 5 segundos y se reproducen solos. Así sabes cómo te oyen los demás.</p>
        <button class="btn sec" id="mcRec" disabled>${ic('rec')}Grabar 5 s</button><div class="bar acc mc-recbar"><span id="mcRecP" style="transform:scaleX(0)"></span></div></div>
      <button class="btn ghost" id="mcStop" hidden data-asm>Apagar el micrófono</button></div></div>`;
  mic.el = el;
  $('#mcGo', el).addEventListener('click', () => startMic());
  $('#mcPerm', el).addEventListener('click', () => openPriv('mic'));
  $('#mcDev', el).addEventListener('change', e => startMic(e.target.value));
  $('#mcStop', el).addEventListener('click', () => { stopMic(); showMicState(); });
  $('#mcRec', el).addEventListener('click', recordMic);
}
function showMicState(err, bad, e) {
  const el = mic.el; if (!el) return; $('#mcLive', el).hidden = true; const st = $('#mcState', el); st.hidden = false; st.classList.toggle('bad', !!bad);
  $('#mcPerm', el).hidden = !denied(e);
  if (err) { $('b', st).textContent = err.t; $(':scope > span', st).textContent = err.m; $('#mcGo', st).innerHTML = `${ic('restore')}Volver a intentarlo`; }
  $('#mcStop', el).hidden = true; $('#mcRec', el).disabled = true;
  anim(st, [{ opacity: 0, transform: 'scale(.97)' }, { opacity: 1, transform: 'none' }], { d: 320, e: EASE.spring });
}
async function startMic(deviceId) {
  stopMic(); const el = mic.el;
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { showMicState({ t: 'Sin acceso al micrófono', m: 'Este entorno no da acceso al micrófono.' }, true); return; }
  const go = $('#mcGo', el); go.disabled = true; go.textContent = 'Esperando permiso…';
  try {
    mic.stream = await navigator.mediaDevices.getUserMedia({ audio: deviceId ? { deviceId: { exact: deviceId } } : true });
    if (!active('mic')) { stopMic(); return; }
    const C = window.AudioContext || window.webkitAudioContext; mic.ctx = new C(); const src = mic.ctx.createMediaStreamSource(mic.stream);
    mic.an = mic.ctx.createAnalyser(); mic.an.fftSize = 2048; src.connect(mic.an); mic.buf = new Float32Array(mic.an.fftSize);
    const tr = mic.stream.getAudioTracks()[0]; const s = tr.getSettings ? tr.getSettings() : {};
    $('#mcInfo', el).textContent = [s.sampleRate ? `${SH.fmtInt(s.sampleRate)} Hz` : '', s.channelCount ? `${s.channelCount === 1 ? 'mono' : s.channelCount + ' canales'}` : '', s.echoCancellation ? 'con cancelación de eco' : ''].filter(Boolean).join(', ');
    const devs = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'audioinput');
    const sel = $('#mcDev', el); sel.disabled = false; sel.innerHTML = devs.map((d, i) => `<option value="${esc(d.deviceId)}"${d.deviceId === s.deviceId ? ' selected' : ''}>${esc(d.label || 'Micrófono ' + (i + 1))}</option>`).join('');
    $('#mcState', el).hidden = true; const live = $('#mcLive', el); live.hidden = false; $('#mcStop', el).hidden = false; $('#mcRec', el).disabled = !window.MediaRecorder;
    anim(live, [{ opacity: 0, transform: 'scale(.97)' }, { opacity: 1, transform: 'none' }], { d: 360, e: EASE.spring });
  } catch (e) { stopMic(); showMicState(MEDIA_ERR(e, 'el micrófono'), true, e); }
  finally { go.disabled = false; }
}
function stopMic() {
  if (mic.rec && mic.rec.state === 'recording') try { mic.rec.stop(); } catch {}
  if (mic.stream) mic.stream.getTracks().forEach(t => t.stop()); mic.stream = null;
  if (mic.ctx) mic.ctx.close().catch(() => {}); mic.ctx = null; mic.an = null;
}
function recordMic() {
  if (!mic.stream || !window.MediaRecorder) return; const el = mic.el; const b = $('#mcRec', el); const chunks = [];
  const r = new MediaRecorder(mic.stream); mic.rec = r; r.ondataavailable = e => chunks.push(e.data);
  r.onstop = () => { const url = URL.createObjectURL(new Blob(chunks, { type: r.mimeType })); const a = new Audio(url); b.innerHTML = `${ic('speaker')}Reproduciendo…`;
    a.onended = () => { b.disabled = false; b.innerHTML = `${ic('rec')}Grabar 5 s`; URL.revokeObjectURL(url); }; a.play().catch(() => { b.disabled = false; b.innerHTML = `${ic('rec')}Grabar 5 s`; }); };
  r.start(); b.disabled = true; b.innerHTML = `${ic('rec')}Grabando…`; const p = $('#mcRecP', el); p.style.transition = 'none'; p.style.transform = 'scaleX(0)';
  requestAnimationFrame(() => { p.style.transition = 'transform 5s linear'; p.style.transform = 'scaleX(1)'; });
  setTimeout(() => { if (r.state === 'recording') r.stop(); }, 5000);
}
tickers.add(dt => {
  if (!mic.an || !mic.el || !active('mic')) return; mic.an.getFloatTimeDomainData(mic.buf);
  let sum = 0, pk = 0; for (let i = 0; i < mic.buf.length; i++) { const v = mic.buf[i]; sum += v * v; pk = Math.max(pk, Math.abs(v)); }
  const rms = Math.sqrt(sum / mic.buf.length); const db = 20 * Math.log10(Math.max(rms, 1e-5)); const lv = Math.max(0, Math.min(1, (db + 60) / 60));
  mic.lvl += (lv - mic.lvl) * Math.min(1, dt * 18); mic.peak = Math.max(mic.peak - dt * .35, lv);
  $('#mcLvl', mic.el).style.transform = `scaleX(${mic.lvl.toFixed(3)})`; $('#mcPeak', mic.el).style.left = (mic.peak * 100).toFixed(1) + '%'; $('#mcDb', mic.el).textContent = db < -59 ? '−∞' : Math.round(db);
  const c = $('#mcWave', mic.el); const w = c.clientWidth, h = c.clientHeight; const d = Math.min(2, devicePixelRatio || 1); if (c.width !== Math.round(w * d)) { c.width = w * d; c.height = h * d; }
  const x = c.getContext('2d'); x.setTransform(d, 0, 0, d, 0, 0); x.clearRect(0, 0, w, h);
  const col = getComputedStyle(SH.ROOT).getPropertyValue('--accent2').trim() || '#9ED6FF';
  x.strokeStyle = 'rgba(170,200,245,.12)'; x.beginPath(); x.moveTo(0, h / 2); x.lineTo(w, h / 2); x.stroke();
  x.strokeStyle = col; x.lineWidth = 2; x.beginPath(); const step = mic.buf.length / w;
  for (let i = 0; i < w; i++) { const v = mic.buf[Math.floor(i * step)] || 0; const y = h / 2 - v * h * .45 * 2.2; i ? x.lineTo(i, y) : x.moveTo(i, y); } x.stroke();
});

/* ========================= Cámara ========================= */
const cam = { stream: null, mirror: true };
function renderCamera(el) {
  el.classList.add('fill');
  el.innerHTML = `<div class="cm">
    <div class="pan cm-main" data-asm><div class="cm-frame" id="cmFrame"><video id="cmVid" playsinline muted></video><div class="cm-flash"></div>
      <div class="mc-state" id="cmState"><div class="mc-ico">${ic('camera')}</div><b>Prueba tu cámara</b><span class="muted">Verás la imagen en vivo, su resolución y sus fotogramas por segundo. Nada sale de tu PC.</span><div class="mc-btns"><button class="btn pri lg" id="cmGo">${ic('camera')}Encender la cámara</button><button class="btn sec lg" id="cmPerm" hidden>${ic('external')}Abrir permisos de Windows</button></div></div></div></div>
    <div class="mc-side">
      <div class="pan" data-asm><h4>Cámara</h4><select class="field mc-sel" id="cmDev" disabled><option>Sin permiso todavía</option></select>
        <div class="cm-specs"><div><span class="faint">Resolución</span><b id="cmRes">–</b></div><div><span class="faint">Fotogramas</span><b id="cmFps">–</b></div></div>
        <div class="cm-row"><span>Imagen de espejo</span><button class="toggle on" id="cmMir" aria-label="Espejo"><i></i></button></div></div>
      <div class="pan cm-shotp" data-asm><h4>Capturas</h4><button class="btn sec" id="cmShot" disabled>${ic('shot')}Capturar</button><div class="cm-shots" id="cmShots"><span class="faint">Aparecerán aquí. No se guardan.</span></div></div>
      <button class="btn ghost" id="cmStop" hidden>Apagar la cámara</button></div></div>`;
  cam.el = el;
  $('#cmGo', el).addEventListener('click', () => startCam());
  $('#cmPerm', el).addEventListener('click', () => openPriv('cam'));
  $('#cmDev', el).addEventListener('change', e => startCam(e.target.value));
  $('#cmStop', el).addEventListener('click', () => { stopCam(); camState(); });
  $('#cmMir', el).addEventListener('click', e => { cam.mirror = !cam.mirror; e.currentTarget.classList.toggle('on', cam.mirror); $('#cmFrame', el).classList.toggle('mirror', cam.mirror); });
  $('#cmShot', el).addEventListener('click', shot);
}
function camState(err, e) {
  const el = cam.el; if (!el) return; const st = $('#cmState', el); st.hidden = false; st.classList.toggle('bad', !!err);
  $('#cmPerm', el).hidden = !denied(e);
  if (err) { $('b', st).textContent = err.t; $(':scope > span', st).textContent = err.m; $('#cmGo', st).innerHTML = `${ic('restore')}Volver a intentarlo`; }
  $('#cmStop', el).hidden = true; $('#cmShot', el).disabled = true; $('#cmRes', el).textContent = '–'; $('#cmFps', el).textContent = '–';
  anim(st, [{ opacity: 0, transform: 'scale(.97)' }, { opacity: 1, transform: 'none' }], { d: 320, e: EASE.spring });
}
async function startCam(deviceId) {
  stopCam(); const el = cam.el;
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { camState({ t: 'Sin acceso a la cámara', m: 'Este entorno no da acceso a la cámara.' }); return; }
  const go = $('#cmGo', el); go.disabled = true; go.textContent = 'Esperando permiso…';
  try {
    cam.stream = await navigator.mediaDevices.getUserMedia({ video: deviceId ? { deviceId: { exact: deviceId }, width: { ideal: 1920 }, height: { ideal: 1080 } } : { width: { ideal: 1920 }, height: { ideal: 1080 } } });
    if (!active('camera')) { stopCam(); return; }
    const v = $('#cmVid', el); v.srcObject = cam.stream; await v.play().catch(() => {});
    const s = cam.stream.getVideoTracks()[0].getSettings(); $('#cmRes', el).textContent = s.width ? `${s.width} × ${s.height}` : '–'; $('#cmFps', el).textContent = s.frameRate ? Math.round(s.frameRate) + ' por segundo' : '–';
    const devs = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'videoinput'); const sel = $('#cmDev', el); sel.disabled = false;
    sel.innerHTML = devs.map((d, i) => `<option value="${esc(d.deviceId)}"${d.deviceId === s.deviceId ? ' selected' : ''}>${esc(d.label || 'Cámara ' + (i + 1))}</option>`).join('');
    const st = $('#cmState', el); anim(st, [{ opacity: 1 }, { opacity: 0, transform: 'scale(1.03)' }], { d: 240 }).finished.then(() => { if (cam.stream) st.hidden = true; }).catch(() => {});
    $('#cmFrame', el).classList.add('on'); $('#cmFrame', el).classList.toggle('mirror', cam.mirror); $('#cmStop', el).hidden = false; $('#cmShot', el).disabled = false;
  } catch (e) { stopCam(); camState(MEDIA_ERR(e, 'la cámara'), e); }
  finally { go.disabled = false; }
}
function stopCam() { if (cam.stream) cam.stream.getTracks().forEach(t => t.stop()); cam.stream = null; if (cam.el) { const v = $('#cmVid', cam.el); v.srcObject = null; $('#cmFrame', cam.el).classList.remove('on'); } }
function shot() {
  const el = cam.el, v = $('#cmVid', el); if (!v.videoWidth) return; const c = document.createElement('canvas'); c.width = 320; c.height = Math.round(320 * v.videoHeight / v.videoWidth);
  const x = c.getContext('2d'); if (cam.mirror) { x.translate(c.width, 0); x.scale(-1, 1); } x.drawImage(v, 0, 0, c.width, c.height);
  const box = $('#cmShots', el); const ph = $('.faint', box); if (ph) ph.remove(); const img = document.createElement('img'); img.src = c.toDataURL('image/jpeg', .85); box.prepend(img);
  while (box.children.length > 6) box.lastChild.remove();
  anim($('.cm-flash', el), [{ opacity: .85 }, { opacity: 0 }], { d: 380 }); anim(img, [{ opacity: 0, transform: 'scale(.6) rotate(-6deg)' }, { opacity: 1, transform: 'none' }], { d: 480, e: EASE.spring });
}

/* ========================= Ratón ========================= */
const ms = { count: { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0 }, wheelUp: 0, wheelDown: 0, dbl: 0, last: {}, bounce: new Set(), pts: [], evs: [], hz: 0, dirty: false };
const BTN = { 0: 'Izquierdo', 1: 'Rueda (clic)', 2: 'Derecho', 3: 'Lateral atrás', 4: 'Lateral adelante' };
function mouseSVG() {
  return `<svg viewBox="0 0 120 190" class="ms-svg">
    <path class="ms-body" d="M60 6c30 0 50 22 50 58v62c0 32-22 58-50 58S10 158 10 126V64C10 28 30 6 60 6z"/>
    <path class="ms-b" data-b="0" d="M58 8C32 9 12 30 12 64v12h46z"/><path class="ms-b" data-b="2" d="M62 8c26 1 46 22 46 56v12H62z"/>
    <rect class="ms-b ms-wheel" data-b="1" x="53" y="26" width="14" height="30" rx="7"/>
    <path class="ms-arrow" data-w="up" d="M60 14l-5 6h10z"/><path class="ms-arrow" data-w="down" d="M60 68l-5-6h10z"/>
    <rect class="ms-b" data-b="4" x="4" y="84" width="8" height="18" rx="3"/><rect class="ms-b" data-b="3" x="4" y="106" width="8" height="18" rx="3"/></svg>`;
}
function renderMouse(el) {
  el.classList.add('fill');
  el.innerHTML = `<div class="ms">
    <div class="pan ms-cps" data-asm id="msCps"><h4>Test de CPS <em>clics por segundo</em></h4>
      <div class="cps-pad" id="cpsPad"><svg class="cps-ring" viewBox="0 0 120 120"><circle class="bg" cx="60" cy="60" r="52"/><circle class="fg" id="cpsArc" cx="60" cy="60" r="52"/></svg>
        <div class="cps-num"><b id="cpsNow">0,0</b><span id="cpsMsg">Pasa el ratón por aquí y clica lo más rápido que puedas</span></div></div>
      <canvas id="cpsCv"></canvas>
      <div class="cps-stats"><div><span class="muted">Último</span><b id="cpsLast">–</b></div><div><span class="muted">Récord</span><b id="cpsBest">${cps.best ? fmtCps(cps.best) : '–'}</b></div><div><span class="muted">Clics</span><b id="cpsN">0</b></div></div></div>
    <div class="pan ms-area" data-asm id="msArea"><canvas id="msCv"></canvas><div class="ms-hint" id="msHint"><b>Haz clic con cada botón, gira la rueda y mueve el ratón aquí</b><span class="muted">Dentro de este recuadro los botones laterales no hacen «atrás» ni «adelante».</span></div></div>
    <div class="ms-side">
      <div class="pan ms-dia" data-asm>${mouseSVG()}<div class="ms-cnt">${[0, 2, 1, 3, 4].map(b => `<div data-c="${b}"><span class="muted">${BTN[b]}</span><b>0</b></div>`).join('')}<div data-c="wu"><span class="muted">Rueda arriba</span><b>0</b></div><div data-c="wd"><span class="muted">Rueda abajo</span><b>0</b></div></div></div>
      <div class="pan ms-stats" data-asm><div><span class="muted">Frecuencia de sondeo</span><b id="msHz">–</b></div><div><span class="muted">Dobles clics</span><b id="msDbl">0</b></div><div class="ms-w" id="msWarn"><span class="faint">Sin rebotes detectados.</span></div></div>
      <button class="btn sec" id="msReset" data-asm>${ic('reset')}Reiniciar</button></div></div>`;
  ms.el = el; const area = $('#msArea', el);
  const hideHint = () => { const h = $('#msHint', el); if (h && !h.classList.contains('gone')) { h.classList.add('gone'); anim(h, [{ opacity: 1 }, { opacity: 0, transform: 'scale(.96)' }], { d: 240 }); } };
  area.addEventListener('pointerdown', e => { e.preventDefault(); hideHint(); const b = e.button; const now = performance.now();
    if (ms.last[b] && now - ms.last[b] < 60) { ms.bounce.add(b); } ms.last[b] = now; ms.count[b] = (ms.count[b] || 0) + 1; flash(b); ripple(e); updMouse(); });
  area.addEventListener('pointerup', e => { if (e.button === 3 || e.button === 4) e.preventDefault(); });
  area.addEventListener('mouseup', e => { if (e.button === 3 || e.button === 4) e.preventDefault(); });
  area.addEventListener('auxclick', e => e.preventDefault()); area.addEventListener('contextmenu', e => e.preventDefault());
  area.addEventListener('dblclick', () => { ms.dbl++; updMouse(); });
  area.addEventListener('wheel', e => { e.preventDefault(); hideHint(); if (e.deltaY < 0) { ms.wheelUp++; flashW('up'); } else if (e.deltaY > 0) { ms.wheelDown++; flashW('down'); } updMouse(); }, { passive: false });
  area.addEventListener('pointermove', e => { const r = area.getBoundingClientRect(); const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e]; const now = performance.now();
    evs.forEach(ev => { ms.pts.push({ x: ev.clientX - r.left, y: ev.clientY - r.top, t: now }); ms.evs.push(now); }); ms.dirty = true; });
  $('#msReset', el).addEventListener('click', () => { Object.keys(ms.count).forEach(k => ms.count[k] = 0); ms.wheelUp = ms.wheelDown = ms.dbl = 0; ms.bounce.clear(); ms.last = {}; updMouse(); });
  /* test de CPS: el primer clic abre una ventana de 5 s; se mide en vivo y al terminar queda el resultado */
  const pad = $('#cpsPad', el); cps.el = el;
  pad.addEventListener('pointerenter', () => pad.classList.add('hot'));
  pad.addEventListener('pointerleave', () => pad.classList.remove('hot'));
  pad.addEventListener('contextmenu', e => e.preventDefault());
  pad.addEventListener('pointerdown', e => {
    if (e.button !== 0) return; e.preventDefault();
    const now = performance.now();
    if (!cps.running) { if (now < cps.cool) return; cps.running = true; cps.t0 = now; cps.clicks = []; $('#cpsMsg', el).textContent = 'Sigue, sigue…'; pad.classList.remove('done'); }
    cps.clicks.push(now - cps.t0); $('#cpsN', el).textContent = cps.clicks.length;
    const b = $('#cpsNow', el); anim(b, [{ transform: 'scale(1.12)' }, { transform: 'scale(1)' }], { d: 160, keep: true });
    if (!isMin()) { const r = pad.getBoundingClientRect(); const d = document.createElement('i'); d.className = 'cps-rip'; d.style.left = (e.clientX - r.left) + 'px'; d.style.top = (e.clientY - r.top) + 'px'; pad.appendChild(d);
      anim(d, [{ transform: 'translate(-50%,-50%) scale(.3)', opacity: .8 }, { transform: 'translate(-50%,-50%) scale(1.6)', opacity: 0 }], { d: 420 }).finished.then(() => d.remove()).catch(() => d.remove()); }
    drawCps();
  });
  drawCps();
}
const CPS_WIN = 5000;
const cps = { running: false, t0: 0, clicks: [], cool: 0, best: 0, el: null, shown: 0 };
const fmtCps = v => v.toLocaleString('es', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
SH.on('boot', () => { cps.best = +(state.settings.cpsBest || 0); const b = cps.el && $('#cpsBest', cps.el); if (b && cps.best) b.textContent = fmtCps(cps.best); });
/* barras de clics por cada medio segundo; se dibuja solo cuando hay un clic nuevo o termina la prueba */
function drawCps() {
  const c = cps.el && $('#cpsCv', cps.el); if (!c) return;
  const w = c.clientWidth, h = c.clientHeight, d = Math.min(2, devicePixelRatio || 1); if (!w) return;
  if (c.width !== Math.round(w * d)) { c.width = w * d; c.height = h * d; }
  const x = c.getContext('2d'); x.setTransform(d, 0, 0, d, 0, 0); x.clearRect(0, 0, w, h);
  const N = 10, bins = Array(N).fill(0); cps.clicks.forEach(t => { const i = Math.min(N - 1, Math.floor(t / (CPS_WIN / N))); bins[i]++; });
  const max = Math.max(4, ...bins), bw = w / N, col = getComputedStyle(SH.ROOT).getPropertyValue('--accent').trim() || '#FF7A66';
  x.fillStyle = col;
  bins.forEach((v, i) => { const bh = v / max * (h - 4); x.globalAlpha = v ? .9 : .15; const y = h - Math.max(2, bh); x.beginPath(); x.roundRect ? x.roundRect(i * bw + 2, y, bw - 4, Math.max(2, bh), 3) : x.rect(i * bw + 2, y, bw - 4, Math.max(2, bh)); x.fill(); });
  x.globalAlpha = 1;
}
tickers.add(() => {
  if (!cps.running || !active('mouse') || !cps.el) return;
  const el = cps.el, now = performance.now(), t = now - cps.t0, p = Math.min(1, t / CPS_WIN);
  const arc = $('#cpsArc', el); if (arc) arc.style.strokeDashoffset = (326.7 * (1 - p)).toFixed(1);
  const v = cps.clicks.length / Math.max(.25, t / 1000); if (Math.abs(v - cps.shown) > .04) { cps.shown = v; $('#cpsNow', el).textContent = fmtCps(v); }
  if (p >= 1) {
    cps.running = false; cps.cool = now + 700; const res = cps.clicks.length / (CPS_WIN / 1000); cps.shown = res;
    $('#cpsNow', el).textContent = fmtCps(res); $('#cpsLast', el).textContent = fmtCps(res);
    const rec = res > cps.best; if (rec) { cps.best = res; $('#cpsBest', el).textContent = fmtCps(res); SH.setSetting('cpsBest', res); }
    $('#cpsMsg', el).textContent = rec ? '¡Nuevo récord! Clica para repetir.' : 'Clica para repetir.';
    $('#cpsPad', el).classList.add('done'); anim($('#cpsNow', el), [{ transform: 'scale(1)' }, { transform: 'scale(1.18)', offset: .4 }, { transform: 'scale(1)' }], { d: 480, e: EASE.spring, keep: true });
    drawCps();
  }
});
function flash(b) { const p = ms.el && $(`.ms-b[data-b="${b}"]`, ms.el); if (!p) return; p.classList.add('hit'); anim(p, [{ opacity: 1 }, { opacity: .55 }], { d: 600 }); }
function flashW(dir) { const a = $(`.ms-arrow[data-w="${dir}"]`, ms.el); if (!a) return; a.classList.add('hit'); anim(a, [{ opacity: 1, transform: `translateY(${dir === 'up' ? -3 : 3}px)` }, { opacity: .35, transform: 'none' }], { d: 420 }); }
function ripple(e) { if (isMin()) return; const area = $('#msArea', ms.el); const r = area.getBoundingClientRect(); const d = document.createElement('i'); d.className = 'ms-rip b' + e.button; d.style.left = (e.clientX - r.left) + 'px'; d.style.top = (e.clientY - r.top) + 'px'; area.appendChild(d);
  anim(d, [{ transform: 'translate(-50%,-50%) scale(.2)', opacity: .9 }, { transform: 'translate(-50%,-50%) scale(1)', opacity: 0 }], { d: 600 }).finished.then(() => d.remove()).catch(() => d.remove()); }
function updMouse() {
  const el = ms.el; if (!el) return;
  const set = (k, v) => { const b = $(`[data-c="${k}"] b`, el); if (b && b.textContent !== String(v)) { b.textContent = v; anim(b, [{ transform: 'scale(1.3)', color: 'var(--accent)' }, { transform: 'none', color: 'var(--ink)' }], { d: 380 }); } };
  [0, 1, 2, 3, 4].forEach(b => set(b, ms.count[b] || 0)); set('wu', ms.wheelUp); set('wd', ms.wheelDown); $('#msDbl', el).textContent = ms.dbl;
  $('#msWarn', el).innerHTML = ms.bounce.size ? [...ms.bounce].map(b => `<div class="chip bad">${ic('alert')}${BTN[b]}: dos pulsaciones en menos de 60 ms. Puede ser un botón que rebota.</div>`).join('') : '<span class="faint">Sin rebotes detectados.</span>';
}
tickers.add(() => {
  if (!active('mouse') || !ms.el) return; const now = performance.now();
  while (ms.evs.length && now - ms.evs[0] > 500) ms.evs.shift();
  const hz = ms.evs.length > 20 ? Math.round(ms.evs.length * 2) : 0; if (hz !== ms.hz) { ms.hz = hz; $('#msHz', ms.el).textContent = hz ? `~${hz} Hz` : 'mueve el ratón'; }
  const life = isMin() ? 150 : 700; while (ms.pts.length && now - ms.pts[0].t > life) { ms.pts.shift(); ms.dirty = true; }
  if (!ms.dirty) return; ms.dirty = ms.pts.length > 0;
  const c = $('#msCv', ms.el); const w = c.clientWidth, h = c.clientHeight, d = Math.min(2, devicePixelRatio || 1); if (c.width !== Math.round(w * d)) { c.width = w * d; c.height = h * d; }
  const x = c.getContext('2d'); x.setTransform(d, 0, 0, d, 0, 0); x.clearRect(0, 0, w, h);
  const col = getComputedStyle(SH.ROOT).getPropertyValue('--accent2').trim() || '#9ED6FF'; x.lineCap = 'round';
  for (let i = 1; i < ms.pts.length; i++) { const a = ms.pts[i - 1], b = ms.pts[i]; const k = 1 - (now - b.t) / life; x.strokeStyle = col; x.globalAlpha = Math.max(0, k); x.lineWidth = 1 + k * 4; x.beginPath(); x.moveTo(a.x, a.y); x.lineTo(b.x, b.y); x.stroke(); }
  x.globalAlpha = 1;
});

/* ========================= registro ========================= */
const RENDER = { keyboard: renderKeyboard, screen: renderScreen, speakers: renderSpeakers, mic: renderMic, camera: renderCamera, mouse: renderMouse };
function release(tab) {
  if (tab === 'keyboard' && kb.capturing && kb.el) setCapture(kb.el, false);
  if (tab === 'speakers') closeAudio();
  if (tab === 'mic') { stopMic(); if (mic.el) showMicState(); }
  if (tab === 'camera') { stopCam(); if (cam.el && !$('#cmState', cam.el).classList.contains('bad')) camState(); }
}
SH.module({
  id: 'tester',
  actions(el) { el.innerHTML = `<span class="chip">${ic('info')}Las pruebas no cambian nada en tu PC</span>`; },
  renderTab(tab, el) { RENDER[tab](el); },
  enterTab(tab) { curTab = tab; },
  leaveTab(tab) { release(tab); if (curTab === tab) curTab = null; },
  leave() { if (curTab) release(curTab); curTab = null; },
  enter() {},
});
SH.on('view', ({ to }) => { if (to === 'tester') { const t = $('#v-tester .subnav .on'); curTab = t ? t.dataset.tab : 'keyboard'; } });
SH.actions.add([
  { t: 'Probar los altavoces izquierdo y derecho', go: 'tester', tab: 'speakers', ic: 'speaker' },
  { t: 'Probar el micrófono', go: 'tester', tab: 'mic', ic: 'mic' },
  { t: 'Probar la cámara', go: 'tester', tab: 'camera', ic: 'camera' },
  { t: 'Probar los botones del ratón', go: 'tester', tab: 'mouse', ic: 'mouse' },
  { t: 'Medir los Hz de la pantalla', go: 'tester', tab: 'screen', ic: 'display' },
]);
})();
