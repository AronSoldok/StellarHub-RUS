/* StellarHub · Inicio. Cabecera a todo lo ancho y tres columnas: estado en vivo, componentes (Mosaico o 3D) y
   lo pendiente. Se dibuja al arrancar, con los datos reales del equipo (SH.PC) ya cargados. */
'use strict';
(() => {
const { $, $$, state, Spring, EASE, anim, tickers, ic, PC, registry, motion, esc } = SH;
const home = $('#v-home');
const chev = ic('chev');
const T = SH.tele;
const dash = '—';
const VITALS = [
  { id: 'cpu', ic: 'cpu', n: 'Procesador', val: v => [T.fmt('cpu'), '%'], frac: v => (v.cpu ?? 0) / 100, hot: v => (v.cpuTemp ?? 0) > 90, comp: 'cpu' },
  { id: 'gpu', ic: 'gpu', n: 'Gráficos', val: v => [T.fmt('gpu'), '%'], frac: v => (v.gpu ?? 0) / 100, hot: v => (v.gpuTemp ?? 0) > 85, comp: 'gpu', need: 'gpu' },
  { id: 'gtemp', ic: 'temp', n: 'Temperatura GPU', val: v => [T.fmt('gpuTemp'), '°C'], frac: v => ((v.gpuTemp ?? 25) - 25) / 75, hot: v => (v.gpuTemp ?? 0) > 85, comp: 'gpu', need: 'gpu' },
  { id: 'ram', ic: 'ram', n: 'Memoria', val: v => [T.fmt('ram', SH.fmt1), `de ${Math.round(v.ramTotal || 0)} GB`], frac: v => (v.ram ?? 0) / (v.ramTotal || 1), hot: v => (v.ram ?? 0) / (v.ramTotal || 1) > .92, comp: 'ram' },
  { id: 'vram', ic: 'layers', n: 'Memoria de vídeo', val: v => [T.fmt('vram', SH.fmt1), `de ${v.vramTotal || '–'} GB`], frac: v => (v.vram ?? 0) / (v.vramTotal || 8), hot: () => false, comp: 'gpu', need: 'gpu' },
  { id: 'disk', ic: 'ssd', n: 'Disco C:', val: v => [T.fmt('diskUsed'), `de ${v.diskTotal || '–'} GB`], frac: v => (v.diskUsed ?? 0) / (v.diskTotal || 1), hot: v => (v.diskUsed ?? 0) / (v.diskTotal || 1) > .92, comp: 'ssd' },
  { id: 'net', ic: 'wifi', n: 'Red', val: v => [T.fmt('down', SH.fmt1), 'Mb/s de bajada'], frac: v => Math.min(1, (v.down ?? 0) / 200), hot: () => false, comp: 'wifi' },
  { id: 'bat', ic: 'battery', n: 'Batería', val: v => [T.fmt('battery'), v.charging ? '% cargando' : '%'], frac: v => (v.battery ?? 0) / 100, hot: v => v.battery !== null && v.battery < 15 && !v.charging, comp: 'battery', need: 'battery' },
];
const VARIANT_IC = { bento: 'grid', model3d: 'cube' };
const ago = ts => { const s = (Date.now() - ts) / 1000; if (s < 90) return 'ahora'; if (s < 3600) return `hace ${Math.round(s / 60)} min`; if (s < 86400) return `hace ${Math.round(s / 3600)} h`; const d = Math.round(s / 86400); return d === 1 ? 'ayer' : `hace ${d} días`; };

let rows = [], built = false;
function render() {
  const hasGpu = PC.components.some(c => c.id === 'gpu'), hasBat = PC.components.some(c => c.id === 'battery');
  const vit = VITALS.filter(x => (x.need !== 'gpu' || hasGpu) && (x.need !== 'battery' || hasBat));
  home.innerHTML = `<div class="home-grid">
  <header class="h-head" data-intro>
    <div class="h-id"><div class="model" id="hModel">${esc(PC.model)}</div><div class="sub">${esc(PC.typeName)}${PC.code ? `, modelo ${esc(PC.code)}` : ''}. ${esc(PC.os)}.</div></div>
    <div class="facts">
      <div><b data-count="${PC.facts.drivers ?? ''}">${PC.facts.drivers == null ? dash : 0}</b><span>drivers</span></div>
      <div><b data-count="${PC.facts.programs ?? ''}">${PC.facts.programs == null ? dash : 0}</b><span>programas</span></div>
      <div><b data-count="${PC.facts.freeC ?? ''}">0</b><span>GB libres en C:</span></div>
    </div>
    <div class="h-quick"><button class="btn sec wbtn" data-widget-btn title="Widget siempre visible"><span class="wdot"></span><span class="lbl">Widget</span></button></div>
  </header>

  <aside class="h-col">
    <div class="pan vitals" data-intro><h4>Ahora mismo <em>${T.simulated ? 'datos de ejemplo' : 'en vivo'}</em></h4>
      <div class="vit-list">${vit.map(x => `<button class="vit" data-comp="${x.comp}" data-vit="${x.id}"><span class="vi">${ic(x.ic)}</span><span class="vn">${x.n}</span><span class="vv">${dash}</span><span class="bar"><span></span></span></button>`).join('')}</div>
    </div>
  </aside>

  <section class="h-center">
    <div class="stage-head" data-intro><h4>Componentes</h4><span class="chip">${PC.components.length}</span><div class="vtoggle" id="vswitch"></div></div>
    <div class="stage" id="stage" data-nofade></div>
  </section>

  <aside class="h-col">
    <div class="pan pending" data-intro><h4>Por revisar</h4><div id="pendList"></div></div>
    <div class="pan healthp" data-intro>
      <div class="hh">
        <svg class="g" viewBox="0 0 40 40"><circle cx="20" cy="20" r="16" fill="none" style="stroke:var(--raise2)" stroke-width="4"/><circle id="healthArc" cx="20" cy="20" r="16" fill="none" style="stroke:var(--accent2)" stroke-width="4" stroke-linecap="round" stroke-dasharray="100.5" stroke-dashoffset="100.5"/></svg>
        <div><b id="hTitle">Revisando el sistema…</b><span id="hSub">Un momento</span></div>
      </div>
      <div class="hs">
        <div>Temperaturas<b id="hTemp">${dash}</b></div>
        <div>Encendido<b id="hUp">${dash}</b></div>
        <div>Antivirus<b id="hAv">${dash}</b></div>
        <div>Punto de restauración<b id="hRp">${dash}</b></div>
      </div>
    </div>
    <div class="pan nextp" data-intro>
      <div class="nx-head"><div class="seg" id="nxSeg"><span class="ind"></span><button data-v="next" class="on">Próximamente</button><button data-v="recent">Hace poco</button></div></div>
      <div class="nx-pages"><div class="nx-page on" data-p="next" id="nxNext"></div><div class="nx-page" data-p="recent" id="nxRecent"></div></div>
    </div>
  </aside>
</div>`;
  rows = vit.map(x => { const el = $(`.vit[data-vit="${x.id}"]`); return { x, el, s: new Spring(0, 90, 16), vv: $('.vv', el), bar: $('.bar>span', el) }; });
  renderPending(); renderNext(); renderRecent(); bindNx();
  if (SH.syncWidgetButtons) SH.syncWidgetButtons();
  built = true;
}

/* nombre del modelo siempre en una línea */
const fit = () => { const el = $('#hModel'); if (!el) return; el.style.fontSize = '34px'; const room = innerWidth * .34; let s = 34; while (el.scrollWidth > room && s > 20) { s--; el.style.fontSize = s + 'px'; } };
addEventListener('resize', fit);

/* ---------- estado en vivo ---------- */
const fmtUp = s => { const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60); return h >= 48 ? `${Math.floor(h / 24)} días ${h % 24} h` : h ? `${h} h ${m} min` : `${m} min`; };
function readVitals() {
  if (!built) return; const v = T.v;
  rows.forEach(r => { r.s.t = Math.max(0, Math.min(1, r.x.frac(v) || 0)); const [a, b] = r.x.val(v); r.vv.innerHTML = a === dash ? dash : `${a}<small>${b}</small>`; r.el.classList.toggle('hot', !!r.x.hot(v)); });
  if (T.has('uptime')) $('#hUp').textContent = fmtUp(v.uptime);
  const temps = [T.has('cpuTemp') ? `CPU ${Math.round(v.cpuTemp)} °C` : null, T.has('gpuTemp') ? `GPU ${Math.round(v.gpuTemp)} °C` : null].filter(Boolean);
  const hot = (v.cpuTemp ?? 0) > 90 || (v.gpuTemp ?? 0) > 85;
  $('#hTemp').textContent = temps.length ? `${hot ? 'altas' : 'normales'}, ${temps[0]}` : dash;
}
SH.tele.on(() => { if (state.view === 'home') readVitals(); });
tickers.add(dt => {
  if (!built || (state.view !== 'home' && !SH.homeAnimating)) return;
  rows.forEach(r => { if (r.s.idle && r.drawn) return; r.s.step(dt); r.bar.style.transform = `scaleX(${r.s.v.toFixed(4)})`; r.drawn = true; });
});
home.addEventListener('click', e => {
  const v = e.target.closest('.vit[data-comp]'); if (v) { SH.openComponent(v.dataset.comp, v); return; }
  const p = e.target.closest('[data-go]'); if (p) SH.go(p.dataset.go, { tab: p.dataset.tab });
});

/* ---------- por revisar: lo publican los módulos al revisar (SH.setPending) ---------- */
const PEND = [
  { k: 'drivers', go: 'drivers', tab: 'updates', one: 'driver con actualización', many: 'drivers con actualización', none: 'Drivers al día', unk: 'Buscar drivers nuevos' },
  { k: 'apps', go: 'updater', tab: 'overview', one: 'programa por actualizar', many: 'programas por actualizar', none: 'Programas al día', unk: 'Buscar actualizaciones', alt: true },
  { k: 'junk', go: 'optimizer', tab: 'clean', unit: 'GB', one: 'que se pueden liberar', many: 'que se pueden liberar', none: 'Nada importante que limpiar', unk: 'Analizar qué se puede limpiar' },
];
function renderPending() {
  const box = $('#pendList'); if (!box) return; const p = state.settings.pending || {};
  box.innerHTML = PEND.map(x => {
    const e = p[x.k]; const n = e ? e.n : null;
    if (n == null) return `<button class="pend unk" data-go="${x.go}" data-tab="${x.tab}"><b>${ic('search')}</b><span>${x.unk}<small>sin revisar todavía</small></span>${chev}</button>`;
    if (!n) return `<button class="pend ok" data-go="${x.go}" data-tab="${x.tab}"><b>${ic('check')}</b><span>${x.none}<small>${ago(e.at)}</small></span>${chev}</button>`;
    const num = x.unit ? `${SH.fmt1(n).replace(',0', '')}<small> ${x.unit}</small>` : n;
    return `<button class="pend${x.alt ? ' alt' : ''}" data-go="${x.go}" data-tab="${x.tab}"><b>${num}</b><span>${n === 1 ? x.one : x.many}<small>revisado ${ago(e.at)}</small></span>${chev}</button>`;
  }).join('');
}
SH.on('pending', () => { renderPending(); if (state.view === 'home') $$('#pendList .pend').forEach((el, i) => anim(el, [{ opacity: .4 }, { opacity: 1 }], { d: 400, delay: i * 40, keep: true })); });

/* ---------- salud real ---------- */
async function loadHealth() {
  let h; try { h = await SH.engine('system', 'health'); } catch { h = null; }
  if (!h) { $('#hTitle').textContent = 'Salud del sistema'; $('#hSub').textContent = 'Solo se revisa dentro de la app'; return; }
  const errs = h.deviceErrors || 0; const av = (h.antivirus || []).find(a => !/defender/i.test(a)) || (h.defender ? 'Defender activo' : (h.antivirus || [])[0]);
  const ok = errs === 0 && (av || h.defender);
  $('#hTitle').textContent = ok ? 'Salud del sistema: buena' : `Salud del sistema: ${errs ? 'revisar' : 'sin antivirus'}`;
  $('#hSub').textContent = errs ? `${errs} dispositivo${errs > 1 ? 's' : ''} con error` : 'Sin errores de dispositivos';
  $('#hSub').title = (h.errorNames || []).join('\n');
  $('#hAv').textContent = av || 'Ninguno activo';
  $('#hRp').textContent = h.restore ? ago(Date.parse(h.restore)) : (h.restoreAccess ? 'ninguno' : 'requiere administrador');
  const pct = ok ? .92 : errs ? .62 : .4; anim($('#healthArc'), [{ strokeDashoffset: 100.5 }, { strokeDashoffset: 100.5 * (1 - pct) }], { d: 1200 });
  $('#healthArc').style.stroke = ok ? 'var(--accent2)' : 'var(--warn)';
}

/* ---------- próximamente (rutinas de Autopilot) y hace poco (actividad real) ---------- */
function renderNext() {
  const box = $('#nxNext'); if (!box) return;
  const rs = (state.settings.autopilotRoutines || []).filter(r => r.enabled !== false && !r.paused).slice(0, 3);
  box.innerHTML = rs.length ? rs.map(r => `<button class="nx" data-go="autopilot" data-tab="calendar"><span class="ni">${ic('autopilot')}</span><span class="nt"><b>${esc(r.name || 'Rutina')}</b><span>${esc(r.summary || 'Rutina de Autopilot')}</span></span></button>`).join('')
    : `<div class="nx-empty"><span>No hay rutinas todavía.</span><button class="btn sm sec" data-go="autopilot" data-tab="routines">${ic('plus')}Crear una</button></div>`;
}
function renderRecent() {
  const box = $('#nxRecent'); if (!box) return; const a = (state.settings.activity || []).slice(0, 3);
  box.innerHTML = a.length ? a.map(x => `<button class="nx"${x.go ? ` data-go="${x.go}" data-tab="${x.tab || ''}"` : ''}><span class="ni">${ic(x.ic || 'check')}</span><span class="nt"><b>${esc(x.t)}</b><span>${esc(x.sub || '')}</span></span><span class="nw">${ago(x.at)}</span></button>`).join('')
    : '<div class="nx-empty"><span>Aquí aparecerá lo que hagas con StellarHub.</span></div>';
}
SH.on('setting', ({ key }) => { if (key === 'activity') renderRecent(); if (key === 'autopilotRoutines') renderNext(); });
function bindNx() {
  $('#nxSeg').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b || b.classList.contains('on')) return;
    $$('#nxSeg button').forEach(x => x.classList.toggle('on', x === b)); SH.placeSeg($('#nxSeg'));
    const dir = b.dataset.v === 'recent' ? 1 : -1;
    const from = $('.nx-page.on', home), to = $(`.nx-page[data-p="${b.dataset.v}"]`, home);
    from.classList.remove('on'); to.classList.add('on');
    anim(from, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: `translate3d(${-dir * 30}px,0,0)` }], { d: 200 });
    anim(to, [{ opacity: 0, transform: `translate3d(${dir * 40}px,0,0)` }, { opacity: 1, transform: 'none' }], { d: 460, delay: 40, e: EASE.spring });
  });
  $('#vswitch').addEventListener('click', e => {
    const b = e.target.closest('button[data-v]'); if (!b || b.classList.contains('on')) return;
    $$('#vswitch button').forEach(x => x.classList.toggle('on', x === b)); SH.placeSeg($('#vswitch .seg'));
    SH.setSetting('homeVariant', b.dataset.v);
  });
}

/* ---------- vistas del escenario (Mosaico / 3D) ---------- */
let current = null, currentWrap = null;
const variantList = () => Object.values(registry.variants);
function renderSwitch() {
  const vs = variantList(); const sw = $('#vswitch'); if (!sw) return;
  if (vs.length < 2) { sw.innerHTML = ''; return; }
  sw.innerHTML = `<div class="seg"><span class="ind"></span>${vs.map(v => `<button data-v="${v.id}"${v.id === (current && current.id) ? ' class="on"' : ''}>${ic(VARIANT_IC[v.id] || 'layers')}${esc(v.short || v.name)}</button>`).join('')}</div>`;
  requestAnimationFrame(() => SH.placeSeg($('.seg', sw), true));
}
function mountVariant(id, intro) {
  const stage = $('#stage'); if (!stage) return;
  const def = registry.variants[id] || variantList()[0]; if (!def || def === current) return;
  const old = current, oldWrap = currentWrap;
  current = def; const wrap = document.createElement('div'); wrap.className = 'vwrap'; wrap.dataset.nofade = ''; stage.appendChild(wrap); currentWrap = wrap;
  if (old) {
    try { old.unmount && old.unmount(); } catch (e) { console.error(e); }
    anim(oldWrap, [{ opacity: 1, transform: 'scale(1)', filter: 'blur(0px)' }, { opacity: 0, transform: 'scale(.94)', filter: 'blur(14px)' }], { d: 300, e: EASE.io })
      .finished.then(() => oldWrap.remove()).catch(() => oldWrap.remove());
    anim(wrap, [{ opacity: 0, transform: 'scale(1.05)', filter: 'blur(14px)' }, { opacity: 1, transform: 'scale(1)', filter: 'blur(0px)' }], { d: 520, delay: 100, e: EASE.out });
  }
  const ctx = { PC, tele: SH.tele, openComponent: (cid, el) => SH.openComponent(cid, el), motion, stage, intro: !!intro || !!old };
  try { def.mount(wrap, ctx); } catch (e) { console.error(e); wrap.innerHTML = `<div class="empty"><b>Esta vista falló</b>${esc(e.message)}</div>`; }
  $$('#vswitch button').forEach(x => x.classList.toggle('on', x.dataset.v === def.id)); const sg = $('#vswitch .seg'); if (sg) SH.placeSeg(sg);
}
SH.on('setting', ({ key, val }) => { if (key === 'homeVariant') mountVariant(val); });
SH.on('variant:registered', () => { renderSwitch(); if (!current && built) mountVariant(state.settings.homeVariant, true); });
addEventListener('resize', () => { if (current && current.resize) try { current.resize(); } catch (e) { console.error(e); } });

/* ---------- entrada ---------- */
function intro(back) {
  const base = back ? 140 : 0;
  $$('[data-intro]', home).forEach((el, i) => anim(el, [{ opacity: 0, transform: 'translate3d(0,14px,0)', filter: 'blur(8px)' }, { opacity: 1, transform: 'translate3d(0,0,0)', filter: 'blur(0px)' }], { d: 620, delay: base + (back ? 0 : 420) + i * 60, e: EASE.spring }));
  $$('.vit', home).forEach((el, i) => anim(el, [{ opacity: 0, transform: 'translate3d(-12px,0,0)' }, { opacity: 1, transform: 'translate3d(0,0,0)' }], { d: 480, delay: base + (back ? 60 : 700) + i * 40, e: EASE.spring, keep: true }));
  $$('.pend, .nx', home).forEach((el, i) => anim(el, [{ opacity: 0, transform: 'translate3d(12px,0,0)' }, { opacity: 1, transform: 'translate3d(0,0,0)' }], { d: 480, delay: base + (back ? 60 : 760) + i * 45, e: EASE.spring, keep: true }));
  if (!back) $$('[data-count]', home).forEach(el => { if (el.dataset.count !== '') setTimeout(() => SH.countUp(el, +el.dataset.count), 700 * motion()); });
  if (!back) rows.forEach(r => { r.s.set(0); r.drawn = false; });
  setTimeout(readVitals, (back ? 100 : 850) * motion());
}
SH.on('home:return', () => { renderPending(); renderRecent(); renderNext(); intro(true); if (current && current.onReturn) try { current.onReturn(); } catch (e) { console.error(e); } });
SH.on('boot', () => {
  render();
  if (!registry.variants[state.settings.homeVariant]) SH.setSetting('homeVariant', 'bento');
  (document.fonts ? document.fonts.ready : Promise.resolve()).then(() => { fit(); renderSwitch(); SH.placeSeg($('#nxSeg'), true); mountVariant(state.settings.homeVariant, true); intro(false); loadHealth(); });
});
})();
