/* StellarHub · ficha emergente de un componente, con datos reales (SH.PC + telemetría + motor).
   Crece desde la pieza pulsada (FLIP) y vuelve a ella al cerrar. SH.openComponent(id, origenOpcional) */
'use strict';
(() => {
const { $, $$, anim, EASE, ic, esc, fmt1, fmtInt, tickers, state } = SH;
const T = SH.tele, v = () => T.v, dash = '—';
const f = (k, fn = x => Math.round(x), suf = '') => T.has(k) ? fn(T.v[k]) + suf : dash;
const comp = id => SH.PC.components.find(x => x.id === id) || { name: id, title: '', rows: [] };
const upt = s => { const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60); return h >= 48 ? `${Math.floor(h / 24)} d ${h % 24} h` : `${h} h ${m} min`; };
const CFG = {
  cpu: { big: () => [f('cpu'), '% de uso'], chart: { key: 'cpu', max: 100, label: 'Uso en el último minuto' },
    stats: () => [['Frecuencia', f('cpuFreq', fmt1, ' GHz')], ['Temperatura', T.has('cpuTemp') ? f('cpuTemp', undefined, ' °C') : (state.admin ? 'no disponible' : 'solo en modo admin')],
      ['Procesos', f('procs', fmtInt)], ['Hilos ocupados', (v().threads || []).filter(t => t > .5).length + ' de ' + (v().threads || []).length]],
    actions: [['Ver en Live Monitor', 'monitor', 'cpu', 'monitor'], ['Qué lo está usando', 'monitor', 'processes', 'list']] },
  gpu: { big: () => [f('gpu'), '% de uso'], chart: { key: 'gpu', max: 100, label: 'Uso en el último minuto' },
    stats: () => [['Temperatura', f('gpuTemp', undefined, ' °C')], ['Consumo', f('gpuPower', undefined, ' W')], ['Memoria de vídeo', T.has('vram') ? `${fmt1(v().vram)} de ${v().vramTotal || '–'} GB` : dash], ['Reloj', f('gpuClock', fmt1, ' GHz')]],
    actions: [['Buscar un driver nuevo', 'drivers', 'updates', 'drivers'], ['Ver en Live Monitor', 'monitor', 'gpu', 'monitor']] },
  ram: { big: () => [f('ram', fmt1), `de ${Math.round(v().ramTotal || 0)} GB en uso`], chart: { key: 'ram', max: () => v().ramTotal || 16, label: 'Uso en el último minuto' },
    stats: () => [['En uso', T.has('ram') ? Math.round(v().ram / (v().ramTotal || 1) * 100) + ' %' : dash], ['Comprometida', f('ramCommit', fmt1, ' GB')], ['En caché', f('ramCache', fmt1, ' GB')],
      ['Ranuras', comp('ram').slots ? `${comp('ram').modules} de ${comp('ram').slots} ocupadas` : dash]],
    actions: [['Qué usa la memoria', 'monitor', 'processes', 'list'], ['Ver en Live Monitor', 'monitor', 'memory', 'monitor']] },
  ssd: { big: () => [T.has('diskTotal') ? Math.round(v().diskTotal - v().diskUsed) : dash, `GB libres de ${v().diskTotal || '–'} en C:`], chart: { key: 'diskRead', label: 'Lectura en el último minuto (MB/s)' },
    stats: () => [['Ocupado', T.has('diskUsed') ? Math.round(v().diskUsed / v().diskTotal * 100) + ' %' : dash], ['Lectura', f('diskRead', fmtInt, ' MB/s')], ['Escritura', f('diskWrite', fmtInt, ' MB/s')], ['Actividad', T.has('diskRead') ? (v().diskRead + v().diskWrite > 50 ? 'alta' : 'baja') : dash]],
    actions: [['Ver qué ocupa', 'storage', 'map', 'storage'], ['Liberar espacio', 'optimizer', 'clean', 'broom']] },
  display: { wide: true, actions: [['Probar la pantalla', 'tester', 'screen', 'display'], ['Ver gráficos', 'monitor', 'gpu', 'monitor']] },
  battery: { big: () => [f('battery'), v().charging ? '% y cargando' : '% de carga'],
    stats: () => [['Salud', f('batteryHealth', undefined, ' %')], ['Consumo', T.has('batteryPower') ? (v().batteryPower > 0 ? '+' : '') + fmt1(v().batteryPower) + ' W' : dash],
      ['Queda', T.has('batterySecs') ? upt(v().batterySecs) : (v().charging ? 'enchufado' : dash)], ['Estado', v().charging ? 'Enchufado' : 'Con batería']],
    meter: () => ({ label: 'Capacidad que conserva', v: (v().batteryHealth || 0) / 100 }),
    actions: [['Ver la batería', 'monitor', 'battery', 'battery']] },
  wifi: { big: () => [f('down', fmt1), 'Mb/s de bajada'], chart: { key: 'down', label: 'Bajada en el último minuto' },
    stats: () => [['Subida', f('up', fmt1, ' Mb/s')], ['Latencia', f('ping', undefined, ' ms')], ['Señal Wi-Fi', f('wifiSignal', undefined, ' %')], ['Enlace', (comp('wifi').rows.find(r => r[0] === 'Enlace') || [, dash])[1]]],
    actions: [['Ver la red', 'monitor', 'network', 'monitor']] },
  audio: { big: () => [String(1 + ((comp('audio').rows[0] || [, ''])[1].split(',').filter(x => x.trim() && x.trim() !== '–').length)), 'dispositivos de audio'],
    list: () => [comp('audio').title, ...((comp('audio').rows[0] || [, ''])[1].split(',').map(s => s.trim()).filter(s => s && s !== '–'))].map(n => ['speaker', n, '']),
    actions: [['Probar altavoces', 'tester', 'speakers', 'speaker'], ['Probar el micrófono', 'tester', 'mic', 'mic']] },
  sys: { big: () => [(SH.PC.os || '').replace(/^Windows \d+ \w+ ?/, '') || SH.PC.os, SH.PC.os],
    stats: () => [['Compilación', (comp('sys').rows.find(r => r[0] === 'Compilación') || [, dash])[1]], ['BIOS', SH.PC.bios || dash], ['Encendido', T.has('uptime') ? upt(v().uptime) : dash], ['Tipo', SH.PC.typeName || dash]],
    actions: [['Buscar actualizaciones', 'updater', 'windows', 'windows'], ['Reparar Windows', 'optimizer', 'repair', 'wrench']] },
};
const ICON = { sys: 'windows', wifi: 'wifi', ssd: 'ssd' };

const root = document.createElement('div'); root.className = 'cs-o'; root.innerHTML = '<div class="cs-scrim"></div><div class="cs" role="dialog" aria-modal="true"></div>';
document.body.appendChild(root);
const sheet = $('.cs', root), scrim = $('.cs-scrim', root);
let open = null, origin = null, chart = null, lastTick = performance.now(), thumbTimer = null;
let lastPointer = null; addEventListener('pointerdown', e => { lastPointer = e.target; }, true);

/* ---------- pantallas: dibujo de cada una con lo que muestra ahora ---------- */
async function displaysHTML() {
  const mons = (comp('display').monitors || []);
  let disp = []; try { disp = await SH.engine('system', 'displays') || []; } catch { disp = []; }
  if (!disp.length) disp = mons.map((m, i) => ({ w: i ? 1920 : 2560, h: i ? 1080 : 1600, hz: 0, primary: !i }));
  /* emparejar: la interna suele ser la de 16:10 o la no principal; si no se sabe, por orden */
  const internalIdx = disp.findIndex(d => Math.abs(d.w / d.h - 1.6) < .02);
  const named = disp.map((d, i) => { const m = (i === internalIdx ? mons.find(x => x.internal) : mons.filter(x => !x.internal)[i > internalIdx && internalIdx >= 0 ? i - 1 : i]) || mons[i] || {}; return { ...d, ...m, idx: i }; });
  const maxW = Math.max(...named.map(d => d.w));
  return `<div class="cs-screens">${named.map(d => {
    const scale = .55 + .45 * d.w / maxW; const name = [d.vendor, d.name || d.code].filter(Boolean).join(' ') || (d.internal ? 'Pantalla del portátil' : 'Monitor');
    return `<figure class="cs-scr${d.internal ? ' internal' : ''}" style="--s:${scale};--ar:${d.w}/${d.h}" data-idx="${d.idx}">
      <div class="frame"><img alt="" data-thumb="${d.idx}"><span class="live">en vivo</span></div>${d.internal ? '<div class="base"></div>' : '<div class="stand"></div>'}
      <figcaption><b>${esc(d.internal ? 'Pantalla del portátil' : 'Monitor externo')}</b><span>${esc(name)}${d.inches ? `, ${d.inches}"` : ''}</span>
      <span>${d.w} × ${d.h}${d.hz ? `, ${d.hz} Hz` : ''}${d.primary ? ', principal' : ''}</span></figcaption></figure>`;
  }).join('')}</div>`;
}
async function refreshThumbs() {
  if (open !== 'display') return;
  const imgs = $$('img[data-thumb]', sheet);
  for (const img of imgs) { const u = await SH.call('screen_thumb', +img.dataset.thumb, 520); if (u && open === 'display') { img.src = u; img.classList.add('on'); } }
  if (open === 'display') thumbTimer = setTimeout(refreshThumbs, 700);
}

async function html(id) {
  const c = comp(id), k = CFG[id] || {};
  const [bv, bl] = k.big ? k.big() : ['', ''];
  const rows = c.rows || [];
  const left = k.wide ? await displaysHTML() : `
        <div class="cs-big"><b id="csBig">${bv}</b><span>${esc(bl)}</span></div>
        ${k.stats ? `<div class="cs-stats">${k.stats().map(([a, b]) => `<div><span>${a}</span><b>${b}</b></div>`).join('')}</div>` : ''}
        ${k.chart ? `<div class="cs-chart"><span>${k.chart.label}</span><canvas></canvas></div>` : ''}
        ${k.meter ? `<div class="cs-meter"><div><span>${k.meter().label}</span><b>${T.has('batteryHealth') ? Math.round(k.meter().v * 100) + ' %' : dash}</b></div><div class="bar ok"><span style="transform:scaleX(0)"></span></div></div>` : ''}
        ${k.list ? `<div class="cs-list">${k.list().map(([i, a, b]) => `<div><span class="ri">${ic(i)}</span><span><b>${esc(a)}</b>${b ? `<small>${esc(b)}</small>` : ''}</span></div>`).join('')}</div>` : ''}`;
  return `<header class="cs-h"><span class="cs-ic">${ic(ICON[id] || id)}</span><div class="cs-t"><span>${esc(c.name)}</span><h2>${esc(c.title)}</h2></div>
      <button class="iconbtn cs-x" aria-label="Cerrar">${ic('x')}</button></header>
    <div class="cs-b${k.wide ? ' wide' : ''}">
      <div class="cs-l">${left}</div>
      <div class="cs-r"><h4>Ficha</h4><dl>${rows.map(([a, b]) => `<dt>${esc(a)}</dt><dd>${esc(b)}</dd>`).join('')}</dl>
        <div class="cs-acts">${(k.actions || []).map(([t, m, tab, i], n) => `<button class="btn ${n ? 'sec' : 'pri'}" data-m="${m}" data-tab="${tab}">${ic(i)}${esc(t)}</button>`).join('')}</div></div>
    </div>`;
}
function update() {
  if (!open) return; const k = CFG[open];
  if (k.big) { const [bv] = k.big(); const b = $('#csBig'); if (b && b.textContent !== String(bv)) b.textContent = bv; }
  if (k.stats) { const st = k.stats(); $$('.cs-stats b', sheet).forEach((b, i) => { const s = st[i]; if (s && b.textContent !== s[1]) b.textContent = s[1]; }); }
  lastTick = performance.now();
}
SH.tele.on(update);
function drawChart(t) {
  if (!open || !chart) return; const k = CFG[open].chart; const c = chart, r = c.getBoundingClientRect(); if (!r.width) return;
  const d = Math.min(2, devicePixelRatio || 1); if (c.width !== Math.round(r.width * d)) { c.width = r.width * d; c.height = r.height * d; }
  const ctx = c.getContext('2d'); ctx.setTransform(d, 0, 0, d, 0, 0); ctx.clearRect(0, 0, r.width, r.height);
  const data = T.hist[k.key].slice(-86); const mx = typeof k.max === 'function' ? k.max() : k.max; const max = mx || Math.max(1, ...data) * 1.15;
  const frac = state.settings.intensity === 'min' ? 0 : Math.min(1, (t - lastTick) / ((+state.settings.teleRate || 1000))); const step = r.width / (data.length - 3);
  const col = getComputedStyle(document.documentElement).getPropertyValue('--accent2').trim() || '#9ED6FF';
  ctx.strokeStyle = 'rgba(170,200,245,.07)'; for (let i = 1; i < 4; i++) { const y = Math.round(r.height * i / 4) + .5; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(r.width, y); ctx.stroke(); }
  ctx.beginPath(); data.forEach((val, i) => { const px = (i - 1 - frac) * step, py = r.height - 3 - Math.min(1, val / max) * (r.height - 10); i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); });
  ctx.strokeStyle = col; ctx.lineWidth = 1.8; ctx.lineJoin = 'round'; ctx.stroke();
  ctx.lineTo(r.width + step, r.height); ctx.lineTo(-step, r.height); ctx.closePath();
  const g = ctx.createLinearGradient(0, 0, 0, r.height); g.addColorStop(0, col + '44'); g.addColorStop(1, col + '00'); ctx.fillStyle = g; ctx.fill();
}
tickers.add((dt, t) => drawChart(t));

function findOrigin(id, given) {
  const ok = el => el && el.isConnected && el.getBoundingClientRect().width > 0;
  if (ok(given)) return given;
  const fromPointer = lastPointer && lastPointer.closest && lastPointer.closest(`[data-comp="${id}"]`);
  if (ok(fromPointer)) return fromPointer;
  return [...document.querySelectorAll(`#v-home [data-comp="${id}"]`)].find(ok) || null;
}
async function openComponent(id, given) {
  if (!CFG[id]) { SH.go('monitor'); return; }
  if (open) close(true);
  open = id; origin = findOrigin(id, given);
  sheet.innerHTML = await html(id); if (open !== id) return;
  chart = $('.cs-chart canvas', sheet); root.classList.add('on'); sheet.classList.toggle('wide', !!CFG[id].wide);
  const to = sheet.getBoundingClientRect();
  anim(scrim, [{ opacity: 0 }, { opacity: 1 }], { d: 260 });
  if (origin) {
    const from = origin.getBoundingClientRect();
    const dx = (from.left + from.width / 2) - (to.left + to.width / 2), dy = (from.top + from.height / 2) - (to.top + to.height / 2);
    anim(sheet, [{ transform: `translate3d(${dx}px,${dy}px,0) scale(${from.width / to.width},${from.height / to.height})`, opacity: .4, borderRadius: '30px' },
      { transform: 'none', opacity: 1, borderRadius: '24px' }], { d: 560, e: EASE.spring });
  } else anim(sheet, [{ transform: 'scale(.9)', opacity: 0, filter: 'blur(8px)' }, { transform: 'none', opacity: 1, filter: 'blur(0px)' }], { d: 420, e: EASE.spring });
  $$('.cs-h > *, .cs-l > *, .cs-r > *, .cs-scr', sheet).forEach((el, i) => anim(el, [{ opacity: 0, transform: 'translate3d(0,10px,0)' }, { opacity: 1, transform: 'none' }], { d: 440, delay: 150 + i * 35, e: EASE.spring }));
  const m = $('.cs-meter .bar>span', sheet); if (m) anim(m, [{ transform: 'scaleX(0)' }, { transform: `scaleX(${CFG[id].meter().v})` }], { d: 900, delay: 300 });
  if (origin) origin.style.visibility = 'hidden';
  if (id === 'display') refreshThumbs();
  setTimeout(() => { const x = $('.cs-x', sheet); x && x.focus({ preventScroll: true }); }, 50);
}
function close(instant) {
  if (!open) return; const was = origin; open = null; chart = null; clearTimeout(thumbTimer);
  if (instant) { root.classList.remove('on'); if (was) was.style.visibility = ''; return; }
  anim(scrim, [{ opacity: 1 }, { opacity: 0 }], { d: 220 });
  $$('.cs-h, .cs-b', sheet).forEach(el => anim(el, [{ opacity: 1 }, { opacity: 0 }], { d: 120 }));
  let a;
  if (was && was.isConnected) {
    const to = sheet.getBoundingClientRect(), from = was.getBoundingClientRect();
    const dx = (from.left + from.width / 2) - (to.left + to.width / 2), dy = (from.top + from.height / 2) - (to.top + to.height / 2);
    a = anim(sheet, [{ transform: 'none', opacity: 1, borderRadius: '24px' }, { transform: `translate3d(${dx}px,${dy}px,0) scale(${from.width / to.width},${from.height / to.height})`, opacity: .3, borderRadius: '30px' }], { d: 380, e: EASE.out });
  } else a = anim(sheet, [{ transform: 'none', opacity: 1 }, { transform: 'scale(.94)', opacity: 0 }], { d: 220 });
  a.finished.then(() => { if (!open) { root.classList.remove('on'); $$('.cs-h, .cs-b', sheet).forEach(el => el.getAnimations().forEach(x => x.cancel())); } if (was) was.style.visibility = ''; }).catch(() => { if (was) was.style.visibility = ''; });
}
root.addEventListener('click', e => {
  if (e.target === scrim || e.target.closest('.cs-x')) { close(); return; }
  const b = e.target.closest('[data-m]'); if (b) { close(); setTimeout(() => SH.go(b.dataset.m, { tab: b.dataset.tab }), 160 * SH.motion()); }
});
addEventListener('keydown', e => { if (open && e.key === 'Escape') { e.stopImmediatePropagation(); close(); } }, true);
SH.on('view', () => { if (open) close(true); });
SH.openComponent = openComponent;
SH.closeComponent = close;
})();
