/* StellarHub · widget siempre visible. Formatos: cuadrícula (2 columnas), fila y lista.
   SH.widgetSize(conf) calcula el tamaño de ventana (lo usa también la ventana principal al abrirlo);
   SH.widgetApply(conf) lo rehace al momento cuando cambian los ajustes. */
'use strict';
(() => {
const { $, $$, anim, EASE, ic, state } = SH;
/* lo que Windows no da (p. ej. temperatura de CPU sin admin) llega null: se muestra "—", nunca 0 */
const ok = x => x !== null && x !== undefined;
const R = (x, f = Math.round) => ok(x) ? f(x) : '—';
/* nombres para el hover de la versión pequeña: corto (cabe en la barra) y completo (tooltip de Windows) */
const NAMES = { cpu: ['CPU', 'Uso del procesador'], cpuTemp: ['CPU °C', 'Temperatura del procesador'], gpu: ['GPU', 'Uso de la tarjeta gráfica'],
  gpuTemp: ['GPU °C', 'Temperatura de la tarjeta gráfica'], gpuPower: ['GPU W', 'Consumo de la tarjeta gráfica'], ram: ['RAM', 'Memoria en uso'],
  vram: ['VRAM', 'Memoria de vídeo en uso'], down: ['Bajada', 'Velocidad de bajada'], up: ['Subida', 'Velocidad de subida'],
  ping: ['Ping', 'Latencia de la conexión'], disk: ['Disco', 'Actividad del disco (lectura + escritura)'] };
const STATS = {
  cpu: { n: 'CPU', ic: 'cpu', h: 'cpu', max: 100, val: v => [R(v.cpu), '%'], hot: v => v.cpu > 90 },
  cpuTemp: { n: 'CPU temp.', ic: 'temp', h: 'cpuTemp', max: 100, val: v => [R(v.cpuTemp), '°C'], hot: v => v.cpuTemp > 88 },
  gpu: { n: 'GPU', ic: 'gpu', h: 'gpu', max: 100, val: v => [R(v.gpu), '%'], hot: v => v.gpu > 95 },
  gpuTemp: { n: 'GPU temp.', ic: 'temp', h: 'gpuTemp', max: 100, val: v => [R(v.gpuTemp), '°C'], hot: v => v.gpuTemp > 84 },
  gpuPower: { n: 'GPU consumo', ic: 'bolt', h: 'gpuPower', max: 120, val: v => [R(v.gpuPower), 'W'], hot: () => false },
  ram: { n: 'RAM', ic: 'ram', h: 'ram', max: 16, val: v => [R(v.ram, SH.fmt1), 'GB'], hot: v => v.ram / v.ramTotal > .9 },
  vram: { n: 'VRAM', ic: 'layers', h: 'vram', max: 8, val: v => [R(v.vram, SH.fmt1), 'GB'], hot: () => false },
  down: { n: 'Bajada', ic: 'download', h: 'down', max: 0, val: v => [R(v.down, SH.fmt1), 'Mb/s'], hot: () => false },
  up: { n: 'Subida', ic: 'upload', h: 'up', max: 0, val: v => [R(v.up, SH.fmt1), 'Mb/s'], hot: () => false },
  ping: { n: 'Latencia', ic: 'globe', h: 'ping', max: 0, val: v => [R(v.ping), 'ms'], hot: v => v.ping > 80 },
  disk: { n: 'Disco', ic: 'ssd', h: 'diskRead', max: 0, val: v => [ok(v.diskRead) ? Math.round(v.diskRead + v.diskWrite) : '—', 'MB/s'], hot: () => false },
};
SH.WIDGET_STATS = STATS;
const DEF = { widgetStats: ['cpu', 'gpu', 'gpuTemp', 'ram', 'down', 'ping'], widgetLayout: 'grid', widgetMode: 'full' };
/* tamaño de la ventana según formato y número de datos */
SH.widgetSize = conf => {
  const n = Math.max(1, (conf.widgetStats || DEF.widgetStats).filter(k => STATS[k]).length), L = conf.widgetLayout || 'grid';
  if (conf.widgetMode === 'mini') return { w: 46 + n * 96 + 84, h: 38 };
  if (L === 'row') return { w: Math.min(900, 24 + n * 112 + (n - 1) * 6), h: 132 };
  if (L === 'list') return { w: 300, h: 56 + n * 32 };
  const rows = Math.ceil(n / 2); return { w: 400, h: 54 + rows * 64 + (rows - 1) * 6 };
};
if (!document.getElementById('rows')) return; // en la ventana principal solo hace falta widgetSize

let rows = [];
function build(conf) {
  const st = Object.assign({}, DEF, conf);
  const root = document.documentElement;
  if (st.accent) root.style.setProperty('--accent', st.accent);
  if (st.accent2) root.style.setProperty('--accent2', st.accent2);
  if (st.theme) root.dataset.theme = st.theme;
  if (st.intensity) root.style.setProperty('--f', SH.FACT[st.intensity]);
  const keys = st.widgetStats.filter(k => STATS[k]);
  const mini = st.widgetMode === 'mini';
  const w = $('#w'); w.className = 'w pywebview-drag-region ' + (mini ? 'M-mini' : 'L-' + (st.widgetLayout || 'grid'));
  const sb = $('#sizeBtn'); sb.title = mini ? 'Versión grande' : 'Versión pequeña';
  sb.innerHTML = mini ? '<svg class="i" viewBox="0 0 24 24"><path d="M14 4h6v6M10 20H4v-6M20 4l-6 6M4 20l6-6"/></svg>' : '<svg class="i" viewBox="0 0 24 24"><path d="M4 14h6v6M20 10h-6V4M14 10l6-6M10 14l-6 6"/></svg>';
  let dot = $('.dot', w); if (mini && !dot) { dot = document.createElement('span'); dot.className = 'dot pywebview-drag-region'; w.prepend(dot); } else if (!mini && dot) dot.remove();
  const nm = k => NAMES[k] || [STATS[k].n, STATS[k].n];
  $('#rows').innerHTML = keys.map(k => mini
    /* pequeña: el número y su nombre comparten hueco; al pasar el ratón el número sube y aparece el nombre */
    ? `<div class="c pywebview-drag-region" data-k="${k}" title="${nm(k)[1]}"><span class="n">${ic(STATS[k].ic)}</span><span class="slot"><span class="v">–</span><span class="lab">${nm(k)[0]}</span></span><canvas></canvas></div>`
    : `<div class="c pywebview-drag-region" data-k="${k}" title="${nm(k)[1]}"><span class="n">${ic(STATS[k].ic)}<span>${STATS[k].n}</span></span><span class="v">–</span><canvas></canvas></div>`).join('');
  rows = keys.map(k => { const el = $(`.c[data-k="${k}"]`); const c = $('canvas', el); return { k, s: STATS[k], el, v: $('.v', el), c, ctx: c.getContext('2d') }; });
  rows.forEach((r, i) => anim(r.el, [{ opacity: 0, transform: 'translate3d(0,8px,0) scale(.97)' }, { opacity: 1, transform: 'none' }], { d: 420, delay: 60 + i * 45, e: EASE.spring }));
  paint(SH.tele.v);
  return st;
}
function draw(r) {
  if (!r.c.offsetParent) return; // versión pequeña: sin gráficas
  const box = r.c.getBoundingClientRect(); const w = Math.max(10, box.width), h = Math.max(10, box.height);
  const d = Math.min(2, devicePixelRatio || 1); if (r.c.width !== Math.round(w * d) || r.c.height !== Math.round(h * d)) { r.c.width = w * d; r.c.height = h * d; }
  const ctx = r.ctx; ctx.setTransform(d, 0, 0, d, 0, 0); ctx.clearRect(0, 0, w, h);
  const data = SH.tele.hist[r.s.h].slice(-48); const max = r.s.max || Math.max(1, ...data) * 1.15;
  const col = getComputedStyle(document.documentElement).getPropertyValue(r.el.classList.contains('hot') ? '--warn' : '--accent2').trim();
  ctx.beginPath(); data.forEach((v, i) => { const x = i / (data.length - 1) * w, y = h - 1.5 - Math.min(1, v / max) * (h - 4); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
  ctx.strokeStyle = col; ctx.lineWidth = 1.4; ctx.lineJoin = 'round'; ctx.stroke();
  ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.closePath(); ctx.globalAlpha = .16; ctx.fillStyle = col; ctx.fill(); ctx.globalAlpha = 1;
}
function paint(v) { rows.forEach(r => { const [a, b] = r.s.val(v); r.v.innerHTML = a === '—' ? '—' : `${a}<small>${b}</small>`; r.el.classList.toggle('hot', !!r.s.hot(v)); draw(r); }); }
SH.tele.on(paint);
/* la ventana se ajusta a su contenido: en la versión pequeña se mide lo que ocupa de verdad (nada se corta) */
function fitWindow(st) {
  requestAnimationFrame(() => {
    paint(SH.tele.v);
    if (st.widgetMode === 'mini') {
      const need = 12 + 7 + 10 + $('#rows').scrollWidth + 10 + $('.hd').scrollWidth + 8;
      SH.call('widget_resize', Math.ceil(need), 38);
    } else { const sz = SH.widgetSize(st); SH.call('widget_resize', sz.w, sz.h); }
  });
}
SH.widgetApply = conf => { const st = build(Object.assign({}, state.settings, conf)); fitWindow(st); };
$('#sizeBtn').addEventListener('click', async () => {
  const next = state.settings.widgetMode === 'mini' ? 'full' : 'mini';
  state.settings.widgetMode = next; await SH.call('widget_mode', next);
  const w = $('#w'); anim(w, [{ opacity: 1 }, { opacity: 0 }], { d: 120 }).finished.then(() => {
    SH.widgetApply({ widgetMode: next }); anim(w, [{ opacity: 0 }, { opacity: 1 }], { d: 260 });
  }).catch(() => {});
});
$('#close').addEventListener('click', () => SH.call('widget_close'));
$('#openMain').addEventListener('click', () => SH.call('show_main'));
(async () => { await SH.loadSettings(); fitWindow(build(state.settings)); })();
})();
