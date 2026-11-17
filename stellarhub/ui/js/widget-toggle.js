/* StellarHub · el widget desde la ventana principal: abrir/cerrar (barra superior, Inicio, Ajustes, paleta),
   estado sincronizado con la bandeja y cambios de ajustes aplicados al momento. */
'use strict';
(() => {
const { $, $$, state } = SH;
SH.widgetOn = false;
function syncButtons() {
  $$('[data-widget-btn]').forEach(b => { b.classList.toggle('on', SH.widgetOn); b.setAttribute('aria-pressed', SH.widgetOn); });
  $$('.toggle[data-act="widget"]').forEach(t => t.classList.toggle('on', SH.widgetOn));
}
async function toggleWidget(quiet) {
  const sz = SH.widgetSize(state.settings);
  const r = await SH.call('widget_toggle', sz.w, sz.h);
  if (r === undefined) { SH.toast('El widget solo se abre dentro de la app.'); return; }
  SH.widgetOn = !!r; syncButtons();
  if (quiet !== true) SH.toast(r ? 'Widget abierto. Arrástralo a donde quieras.' : 'Widget cerrado.', { group: 'widget' });
}
/* al arrancar: solo si lo pide el ajuste o si estaba abierto al cerrar (en una instalación nueva, apagado) */
SH.on('boot', () => { const s = state.settings; if (s.widgetOnStart || s.widgetWasOpen) setTimeout(() => SH.call('widget_is_open').then(v => { if (v === false) toggleWidget(true); }), 1500); });
SH.on('widget-mode', m => { const s = $('.seg[data-key="widgetMode"]'); if (s) { $$('button', s).forEach(x => x.classList.toggle('on', x.dataset.v === m)); SH.placeSeg(s); } });
SH.on('widget', d => { SH.widgetOn = !!(d && d.on); syncButtons(); });
SH.apiReady.then(() => SH.call('widget_is_open')).then(v => { SH.widgetOn = !!v; syncButtons(); });
/* cualquier cambio que afecte al widget se le manda al momento */
const KEYS = /^(widget|accent|theme|intensity)/;
SH.on('setting', ({ key }) => {
  if (!KEYS.test(key) || !SH.widgetOn) return;
  const s = state.settings;
  SH.call('widget_update', { widgetStats: s.widgetStats, widgetLayout: s.widgetLayout, widgetMode: s.widgetMode, accent: s.accent, accent2: s.accent2, theme: s.theme, intensity: s.intensity });
});
$('#widgetBtn').setAttribute('data-widget-btn', '');
$('#widgetBtn').addEventListener('click', toggleWidget);
document.addEventListener('click', e => { const b = e.target.closest('[data-widget-btn]'); if (b && b.id !== 'widgetBtn') toggleWidget(); });
SH.toggleWidget = toggleWidget; SH.syncWidgetButtons = syncButtons;
SH.actions.add([{ t: 'Abrir o cerrar el widget siempre visible', run: toggleWidget, ic: 'monitor' }]);
})();
