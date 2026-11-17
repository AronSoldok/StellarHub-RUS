/* StellarHub · marco propio de la ventana: arrastrar desde la barra superior, bordes para redimensionar,
   doble clic para maximizar y los tres botones. Fuera de la app (navegador) no hace nada. */
'use strict';
(() => {
const { $, $$, anim, EASE } = SH;
const top = $('.top');
const NOT_DRAG = 'button, input, a, .search, .note, .mode, [data-nodrag]';
function setMax(max) {
  document.body.classList.toggle('win-max', !!max);
  const b = $('#winMax'); if (!b) return;
  b.innerHTML = max
    ? '<svg class="i" viewBox="0 0 24 24"><rect x="7" y="9" width="10" height="10" rx="1.6"/><path d="M10 9V6.6A1.6 1.6 0 0 1 11.6 5H17.4A1.6 1.6 0 0 1 19 6.6v5.8A1.6 1.6 0 0 1 17.4 14H17"/></svg>'
    : '<svg class="i" viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="1.8"/></svg>';
  b.setAttribute('aria-label', max ? 'Restaurar' : 'Maximizar'); b.title = b.getAttribute('aria-label');
  anim($('svg', b), [{ transform: 'scale(.6)', opacity: 0 }, { transform: 'scale(1)', opacity: 1 }], { d: 260, e: EASE.spring });
}
SH.on('win', d => setMax(d && d.max));
SH.apiReady.then(async a => {
  const st = a && await SH.call('win_state');
  if (!st || !st.frameless) return;
  document.body.classList.add('frameless'); setMax(st.max);
  top.addEventListener('mousedown', e => { if (e.button !== 0 || e.detail > 1 || e.target.closest(NOT_DRAG)) return; SH.call('win_drag'); });
  top.addEventListener('dblclick', e => { if (e.target.closest(NOT_DRAG)) return; SH.call('win_toggle_max'); });
  $$('.rz').forEach(h => h.addEventListener('mousedown', e => { if (e.button === 0) { e.preventDefault(); SH.call('win_resize', h.dataset.edge); } }));
  $('#winMin').addEventListener('click', () => SH.call('win_min'));
  $('#winMax').addEventListener('click', () => SH.call('win_toggle_max'));
  $('#winClose').addEventListener('click', () => SH.call('win_close'));
});
})();
