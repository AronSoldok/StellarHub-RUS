/* StellarHub · "Mosaic" Home view: one tile per component, in different sizes, each with its own
   illustration and a live stat. Tiles tilt with the mouse and the illustration comes alive on hover. */
'use strict';
(() => {
const { $, $$, Spring, EASE, anim, tickers, esc, fmt1 } = SH;

/* ---------- illustrations ---------- */
function fanSVG(cx, cy, r, cls) {
  let b = ''; for (let i = 0; i < 9; i++) b += `<path d="M${cx} ${cy - r * .28} C ${cx + r * .3} ${cy - r * .45} ${cx + r * .5} ${cy - r * .75} ${cx + r * .25} ${cy - r * .95} C ${cx + r * .1} ${cy - r * .7} ${cx - r * .05} ${cy - r * .5} ${cx} ${cy - r * .28} Z" transform="rotate(${i * 40} ${cx} ${cy})"/>`;
  return `<circle class="ring" cx="${cx}" cy="${cy}" r="${r + 4}"/><g class="${cls}" style="transform-origin:${cx}px ${cy}px">${b}<circle class="hub" cx="${cx}" cy="${cy}" r="${r * .26}"/></g>`;
}
const ART = {
  gpu: () => `<svg viewBox="0 0 320 150" class="art-gpu">
    <rect class="bracket" x="2" y="16" width="12" height="112" rx="3"/>
    <rect class="body" x="14" y="12" width="296" height="104" rx="14"/>
    <path class="strip" d="M30 14 H294"/>
    ${Array.from({ length: 30 }, (_, i) => `<line class="fin" x1="${40 + i * 8.6}" y1="20" x2="${40 + i * 8.6}" y2="30"/>`).join('')}
    ${fanSVG(100, 68, 40, 'gfan')}${fanSVG(222, 68, 40, 'gfan')}
    <rect class="gold" x="66" y="116" width="150" height="12" rx="2"/>
    ${Array.from({ length: 18 }, (_, i) => `<rect class="pin" x="${70 + i * 8}" y="119" width="4" height="7" rx="1"/>`).join('')}
  </svg>`,
  cpu: () => {
    let pads = ''; for (let i = 0; i < 14; i++) { const p = 30 + i * 10; pads += `<rect class="pad" x="${p}" y="22" width="5" height="5"/><rect class="pad" x="${p}" y="173" width="5" height="5"/><rect class="pad" x="22" y="${p}" width="5" height="5"/><rect class="pad" x="173" y="${p}" width="5" height="5"/>`; }
    let th = ''; for (let i = 0; i < 24; i++) { const big = i < 8; const c = big ? i % 4 : (i - 8) % 4, r = big ? Math.floor(i / 4) : 2 + Math.floor((i - 8) / 4);
      th += `<rect class="th${big ? ' p' : ''}" data-th="${i}" x="${62 + c * 19.5}" y="${big ? 58 + r * 19 : 98 + (r - 2) * 11.5}" width="16" height="${big ? 16 : 9}" rx="2"/>`; }
    return `<svg viewBox="0 0 200 200" class="art-cpu">
      <rect class="sub" x="14" y="14" width="172" height="172" rx="12"/>${pads}
      <rect class="cap" x="36" y="40" width="10" height="5" rx="1"/><rect class="cap" x="154" y="150" width="10" height="5" rx="1"/><rect class="cap" x="36" y="154" width="10" height="5" rx="1"/>
      <rect class="die" x="54" y="50" width="92" height="104" rx="5"/>${th}
      <circle class="pulse" cx="100" cy="100" r="70"/>
    </svg>`;
  },
  ram: () => `<svg viewBox="0 0 200 84" class="art-ram">
    <path class="pcb" d="M6 14 H194 V60 H112 V66 H104 V60 H6 Z"/>
    ${[0, 1, 2, 3].map(i => `<rect class="mchip" x="${16 + i * 44}" y="22" width="34" height="26" rx="2"/>`).join('')}
    ${Array.from({ length: 30 }, (_, i) => `<rect class="pin" x="${10 + i * 6.1 + (i > 15 ? 6 : 0)}" y="62" width="3.4" height="10" rx=".8"/>`).join('')}
    <circle class="hole" cx="10" cy="22" r="2.6"/>
  </svg>`,
  ssd: () => `<svg viewBox="0 0 200 60" class="art-ssd">
    <path class="pcb" d="M4 16 H182 A12 12 0 0 1 182 44 H4 V34 H8 V26 H4 Z"/>
    <rect class="mchip" x="18" y="21" width="30" height="18" rx="2"/><rect class="mchip" x="56" y="20" width="44" height="20" rx="2"/><rect class="mchip" x="108" y="20" width="44" height="20" rx="2"/>
    <circle class="led" cx="164" cy="30" r="3"/><circle class="hole" cx="186" cy="30" r="4"/>
  </svg>`,
  dsp: () => `<svg viewBox="0 0 280 120" class="art-dsp">
    <rect class="frame" x="8" y="6" width="164" height="104" rx="8"/><rect class="screen" x="15" y="13" width="150" height="90" rx="4"/>
    <rect class="sweep" x="15" y="13" width="40" height="90"/>
    <text x="90" y="62" text-anchor="middle">2560 × 1600</text>
    <rect class="frame" x="186" y="24" width="88" height="56" rx="5"/><rect class="screen" x="191" y="29" width="78" height="46" rx="3"/>
    <path class="stand" d="M230 80 V94 M214 96 H246"/>
    <text x="230" y="56" text-anchor="middle" class="sm">1920 × 1080</text>
  </svg>`,
  bat: () => `<svg viewBox="0 0 130 64" class="art-bat">
    <rect class="body" x="4" y="8" width="108" height="48" rx="10"/><rect class="term" x="114" y="22" width="9" height="20" rx="3"/>
    <rect class="fill" x="11" y="15" width="94" height="34" rx="5"/>
    <path class="bolt" d="M62 18 L50 34 H60 L56 47 L70 29 H60 Z"/>
  </svg>`,
  wif: () => `<svg viewBox="0 0 100 74" class="art-wif">
    <path class="arc a3" d="M8 30 A58 58 0 0 1 92 30"/><path class="arc a2" d="M22 44 A38 38 0 0 1 78 44"/><path class="arc a1" d="M36 57 A19 19 0 0 1 64 57"/><circle class="dotw" cx="50" cy="66" r="4.5"/>
  </svg>`,
  aud: () => `<svg viewBox="0 0 110 70" class="art-aud">
    ${[18, 34, 46, 28, 40, 22, 30].map((h, i) => `<rect class="eq" style="--d:${i * 70}ms" x="${8 + i * 14}" y="${62 - h}" width="8" height="${h}" rx="3"/>`).join('')}
  </svg>`,
  sys: () => `<svg viewBox="0 0 100 80" class="art-sys">
    <path class="lay l3" d="M50 46 L90 60 L50 74 L10 60 Z"/><path class="lay l2" d="M50 30 L90 44 L50 58 L10 44 Z"/><path class="lay l1" d="M50 14 L90 28 L50 42 L10 28 Z"/>
  </svg>`,
};

/* ---------- tiles ---------- */
/* order and size: GPU and CPU large (2×2); displays wide (2×1); the rest 1×1. Only the ones this PC has. */
const TILES = [
  { area: 'gpu', comp: 'gpu', kind: 'hero', big: true },
  { area: 'cpu', comp: 'cpu', kind: 'chip', big: true },
  { area: 'ram', comp: 'ram', kind: 'plain' },
  { area: 'ssd', comp: 'ssd', kind: 'plain' },
  { area: 'dsp', comp: 'display', kind: 'open', wide: true },
  { area: 'bat', comp: 'battery', kind: 'plain' },
  { area: 'wif', comp: 'wifi', kind: 'deep' },
  { area: 'aud', comp: 'audio', kind: 'deep' },
  { area: 'sys', comp: 'sys', kind: 'plain' },
];
const dash = '<span class="na">—</span>';
const nil = x => x == null || Number.isNaN(x);
const comp = id => SH.PC.components.find(x => x.id === id);
/* "a and b" / "a, b and c" in the interface language */
const andList = a => a.length < 2 ? a.join('') : SH.t('{a} and {b}', { a: a.slice(0, -1).join(', '), b: a[a.length - 1] });
const rowv = (id, label) => ((comp(id) || {}).rows || []).find(r => r[0] === label)?.[1] || '';
/* short titles built from the real data (the full one stays in the tooltip) */
function shortTitle(t, c) {
  const title = c.title || '';
  switch (t.area) {
    case 'ram': return title;
    case 'ssd': { const w = title.split(/\s+/).filter(x => !/[-_]/.test(x) && !/^\d+(\.\d+)?$/.test(x) && x !== 'TB' && x.toUpperCase() !== 'PC'); const cap = (title.match(/(\d+(?:[.,]\d+)?)\s*TB/) || [])[0]; return [w.slice(0, 2).join(' '), cap].filter(Boolean).join(', '); }
    case 'dsp': { const m = c.monitors || []; if (m.length > 1) return SH.t('{n} displays', { n: m.length }); if (!m[0]) return title;
      return m[0].inches ? (m[0].internal ? SH.t('{n}" laptop screen', { n: m[0].inches }) : SH.t('{n}" external', { n: m[0].inches })) : (m[0].internal ? SH.t('laptop screen') : SH.t('external')); }
    case 'bat': return SH.PC.real ? title : title.split(/[,，]/)[0]; // the sample title adds the health after a comma
    case 'wif': return /6E/i.test(title) ? 'Wi-Fi 6E' : /wi-?fi ?7|BE\d/i.test(title) ? 'Wi-Fi 7' : /wi-?fi ?6|AX\d/i.test(title) ? 'Wi-Fi 6' : /wi-?fi|wireless|802\.11/i.test(title) ? 'Wi-Fi' : /ethernet|gbe|lan/i.test(title) ? 'Ethernet' : title.split(/\s+/).slice(0, 2).join(' ');
    case 'aud': return title.replace(/\(R\)|\(TM\)/g, '').replace(/High Definition Audio/i, 'HD Audio').replace(/Dispositivo de audio|USB Audio Device/i, 'Audio').trim();
    case 'sys': return (SH.PC.os || title).replace(/\s+\d{2}H\d$/, '');
    case 'gpu': return title.replace(/\s+GPU$/i, '').replace(/^NVIDIA GeForce /i, 'GeForce ').replace(/\(R\)|\(TM\)/g, '');
    default: return title.replace(/\(R\)|\(TM\)/g, '');
  }
}
/* 4-column grid with no gaps: large tiles on top (2 rows), the rest in rows of 4 cells;
   if the last row comes up short, its last tile stretches to the end */
function layout(list) {
  const big = list.filter(t => t.big), small = list.filter(t => !t.big);
  const rows = [], rowH = [];
  if (big.length === 2) { rows.push(['gpu', 'gpu', 'cpu', 'cpu'], ['gpu', 'gpu', 'cpu', 'cpu']); rowH.push('1fr', '1fr'); }
  else if (big.length === 1) {
    const B = big[0].area, side = small.filter(t => !t.wide).splice(0, 4);
    side.forEach(t => small.splice(small.indexOf(t), 1));
    const sa = side.map(t => t.area); while (sa.length < 4) sa.push(sa[sa.length - 1] || B);
    rows.push([B, B, sa[0], sa[1]], [B, B, sa[2], sa[3]]); rowH.push('1fr', '1fr');
  }
  let cur = [];
  const flush = () => { if (!cur.length) return; while (cur.length < 4) cur.push(cur[cur.length - 1]); rows.push(cur); rowH.push('.82fr'); cur = []; };
  small.forEach(t => {
    const need = t.wide ? 2 : 1;
    if (cur.length + need > 4) flush();
    for (let i = 0; i < need; i++) cur.push(t.area);
  });
  flush();
  return { areas: rows.map(r => `"${r.join(' ')}"`).join(' '), rows: rowH.join(' ') };
}
function liveHTML(area) {
  switch (area) {
    case 'gpu': return `<div class="nums"><div><b class="n" data-l="gpu">–</b><small>${SH.t('% usage')}</small></div><div><b data-l="gtemp">–</b><small>°C</small></div><div><b data-l="gpow">–</b><small>W</small></div></div>
      <div class="lbar"><span>${SH.t('Video memory')}</span><em data-l="vram">–</em></div><div class="bar"><span data-b="vram"></span></div>`;
    case 'cpu': return `<div class="nums"><div><b class="n" data-l="cpu">–</b><small>${SH.t('% usage')}</small></div><div><b data-l="freq">–</b><small>GHz</small></div><div><b data-l="ctemp">–</b><small>°C</small></div></div>`;
    case 'ram': return `<div class="lbar"><span>${SH.t('{used} of {total} GB', { used: '<b data-l="ram">–</b>', total: '<span data-l="ramt">–</span>' })}</span></div><div class="bar"><span data-b="ram"></span></div>`;
    case 'ssd': return `<div class="lbar"><span>${SH.t('{n} GB free', { n: '<b data-l="free">–</b>' })}</span></div><div class="bar acc"><span data-b="disk"></span></div>`;
    case 'dsp': return `<div class="lbar"><span data-l="dsp">${esc(andList(((comp('display') || {}).rows || []).map(r => r[1])) || '—')}</span></div>`;
    case 'bat': return `<div class="lbar"><span>${SH.t('Health {n}', { n: '<b data-l="bath">–</b>' })}</span></div>`;
    case 'wif': return `<div class="lbar"><span><b data-l="down">–</b> Mb/s</span></div>`;
    case 'aud': { const n = 1 + (rowv('audio', 'Others').split(',').filter(x => x.trim() && x.trim() !== '–').length); return `<div class="lbar"><span>${n > 1 ? SH.t('{n} devices', { n }) : SH.t('{n} device', { n })}</span></div>`; }
    case 'sys': return `<div class="lbar"><span>${SH.t('Up {time}', { time: '<b data-l="up">–</b>' })}</span></div>`;
  }
  return '';
}
function uptime(s) { const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60); return h ? `${h} h ${m} min` : `${m} min`; }

let root = null, tick = null, offs = [], tiles = [];
const gfan = { a: 0, sp: new Spring(0, 30, 10), boost: new Spring(0, 60, 14) };
const bars = { vram: new Spring(0, 60, 14), ram: new Spring(0, 60, 14), disk: new Spring(0, 60, 14) };

function mount(el, ctx) {
  root = document.createElement('div'); root.className = 'hv-bento'; el.appendChild(root);
  const list = TILES.filter(t => comp(t.comp));
  const L = layout(list); root.style.gridTemplateAreas = L.areas; root.style.gridTemplateRows = L.rows;
  root.innerHTML = list.map(t => {
    const c = comp(t.comp);
    return `<div class="bt k-${t.kind} a-${t.area}" style="grid-area:${t.area}" data-comp="${t.comp}" tabindex="0" role="button" aria-label="${esc(c.name)}: ${esc(c.title)}">
      <div class="tilt"><div class="glow"></div><div class="art">${ART[t.area]()}</div>
      <div class="meta"><span class="k">${esc(c.name)}</span><b class="t" title="${esc(c.title)}">${esc(shortTitle(t, c))}</b><div class="live">${liveHTML(t.area)}</div></div></div></div>`;
  }).join('');
  /* the display drawing with the real resolutions */
  if (SH.engine) SH.engine('system', 'displays').then(ds => {
    if (!ds || !root) return; const tx = $$('.art-dsp text', root); const sorted = ds.slice().sort((x, y) => y.w * y.h - x.w * x.h);
    tx.forEach((e, i) => { e.textContent = sorted[i] ? `${sorted[i].w} × ${sorted[i].h}` : ''; });
    if (ds.length < 2) $$('.art-dsp .frame, .art-dsp .screen, .art-dsp .stand', root).slice(2).forEach(e => { e.style.display = 'none'; });
  }).catch(() => {});
  tiles = $$('.bt', root).map(b => ({ b, tilt: $('.tilt', b), rx: new Spring(0, 170, 18), ry: new Spring(0, 170, 18), lift: new Spring(0, 200, 20) }));
  tiles.forEach(t => {
    t.b.addEventListener('pointermove', e => {
      if (SH.state.settings.intensity === 'min') return;
      const r = t.b.getBoundingClientRect(); const nx = (e.clientX - r.left) / r.width * 2 - 1, ny = (e.clientY - r.top) / r.height * 2 - 1;
      const big = r.width > 260 ? .6 : 1;
      t.rx.t = -ny * 7 * big; t.ry.t = nx * 9 * big; t.lift.t = 1;
      t.b.style.setProperty('--mx', ((nx + 1) * 50).toFixed(1) + '%'); t.b.style.setProperty('--my', ((ny + 1) * 50).toFixed(1) + '%');
    });
    t.b.addEventListener('pointerenter', () => { t.b.classList.add('hot'); if (t.b.dataset.comp === 'gpu') gfan.boost.t = 1; });
    t.b.addEventListener('pointerleave', () => { t.b.classList.remove('hot'); t.rx.t = 0; t.ry.t = 0; t.lift.t = 0; if (t.b.dataset.comp === 'gpu') gfan.boost.t = 0; });
    t.b.addEventListener('click', () => ctx.openComponent(t.b.dataset.comp, t.b));
    t.b.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); ctx.openComponent(t.b.dataset.comp); } });
    t.b.addEventListener('pointerdown', () => anim(t.b, [{ transform: 'scale(1)' }, { transform: 'scale(.97)', offset: .4 }, { transform: 'scale(1)' }], { d: 320, e: EASE.out }));
  });
  offs.push(SH.tele.on(read)); read();
  const fans = $$('.gfan', root);
  tick = dt => {
    if (!root || (SH.state.view !== 'home' && !SH.homeAnimating)) return;
    const still = SH.state.settings.intensity === 'min';
    const fv = SH.tele.v.fanGpu, gu = SH.tele.v.gpu; gfan.sp.t = still ? 0 : !nil(fv) ? fv / 100 * 1.1 : .15 + (gu || 0) / 100 * .9; gfan.sp.step(dt); gfan.boost.step(dt);
    if (!still) { gfan.a = (gfan.a + (gfan.sp.v + gfan.boost.v * 1.6) * 360 * dt) % 360; fans.forEach(f => { f.style.transform = `rotate(${gfan.a.toFixed(2)}deg)`; }); }
    for (const k in bars) { bars[k].step(dt); const e = $(`[data-b="${k}"]`, root); if (e) e.style.transform = `scaleX(${Math.max(0, bars[k].v).toFixed(4)})`; }
    for (const t of tiles) {
      t.rx.step(dt); t.ry.step(dt); t.lift.step(dt);
      if (Math.abs(t.rx.v) + Math.abs(t.ry.v) + t.lift.v > .002 || !t.rest) {
        t.tilt.style.transform = `rotateX(${t.rx.v.toFixed(3)}deg) rotateY(${t.ry.v.toFixed(3)}deg) translateZ(${(t.lift.v * 14).toFixed(2)}px)`;
        t.rest = Math.abs(t.rx.v) + Math.abs(t.ry.v) + t.lift.v <= .002;
      }
    }
  };
  tickers.add(tick);
  if (ctx.intro) intro(false);
}
function read() {
  if (!root) return; const v = SH.tele.v;
  /* null = Windows does not provide this stat: "—", never 0 */
  const set = (k, x, f = Math.round) => { const e = $(`[data-l="${k}"]`, root); if (!e) return; const t = nil(x) ? '—' : f(x); if (e.textContent !== String(t)) e.textContent = t; e.classList.toggle('na', nil(x)); };
  set('gpu', v.gpu); set('gtemp', v.gpuTemp); set('gpow', v.gpuPower);
  const ve = $('[data-l="vram"]', root); if (ve) ve.textContent = nil(v.vram) ? '—' : SH.t('{used} of {total} GB', { used: fmt1(v.vram), total: v.vramTotal || '–' });
  set('cpu', v.cpu); set('freq', v.cpuFreq, fmt1); set('ctemp', v.cpuTemp);
  const ct = $('[data-l="ctemp"]', root); if (ct) ct.parentElement.title = nil(v.cpuTemp) ? (SH.state.admin ? SH.t('Windows does not report this processor\'s temperature') : SH.t('The CPU temperature is only visible in administrator mode')) : '';
  set('ram', v.ram, fmt1); set('ramt', v.ramTotal, x => Math.round(x)); set('free', nil(v.diskTotal) ? null : v.diskTotal - v.diskUsed);
  set('down', v.down, fmt1); set('up', v.uptime, uptime); set('bat', v.battery); set('bath', nil(v.batteryHealth) ? null : v.batteryHealth, x => x + ' %');
  bars.vram.t = (v.vram || 0) / (v.vramTotal || 8); bars.ram.t = (v.ram || 0) / (v.ramTotal || 1); bars.disk.t = (v.diskUsed || 0) / (v.diskTotal || 1);
  const th = v.threads || []; $$('.th', root).forEach((e, i) => { const l = th[i] || 0; e.style.opacity = (.18 + .82 * l).toFixed(3); e.classList.toggle('busy', l > .75); });
}
function intro(quick) {
  if (!root) return;
  tiles.forEach((t, i) => anim(t.b, [
    { opacity: 0, transform: `perspective(1000px) translate3d(0,${quick ? 10 : 26}px,${quick ? -60 : -220}px) rotateX(${quick ? 4 : 16}deg)`, filter: 'blur(10px)' },
    { opacity: 1, transform: 'perspective(1000px) translate3d(0,0,0) rotateX(0deg)', filter: 'blur(0px)' }
  ], { d: quick ? 520 : 820, delay: (quick ? 40 : 260) + i * (quick ? 30 : 70), e: EASE.spring }));
  if (!quick) {
    for (const k in bars) bars[k].set(0);
    const fill = $('.art-bat .fill', root); if (fill) anim(fill, [{ transform: 'scaleX(0)' }, { transform: 'scaleX(.97)' }], { d: 1400, delay: 900, e: EASE.out });
    gfan.sp.set(0);
  }
}
function unmount() {
  if (tick) tickers.delete(tick); tick = null; offs.forEach(f => f()); offs = []; tiles = []; root = null;
}

SH.homeVariant({
  id: 'bento', name: SH.t('Mosaic'), short: SH.t('Mosaic'),
  desc: SH.t('One tile per component, with its live stat.'),
  mount, unmount, resize() {}, onReturn() { intro(true); },
});
})();
