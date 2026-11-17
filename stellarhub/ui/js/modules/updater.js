/* StellarHub · Program Updater.
   Inside the app everything is REAL (stellarhub/engine/updater.py): winget, Windows Update, Store, components, pip and npm.
   Outside the app (browser, design tests) it uses the sample data below, with the same shape. */
'use strict';
(() => {
const { $, $$, state, Spring, EASE, anim, tickers, ic, esc, fmt1 } = SH;
const ID = 'updater';
SH.icons.add({
  arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>',
  pin: '<path d="M9 3.5h6l-1 5.5 3.5 3.5h-11L10 9z"/><path d="M12 12.5V21"/>',
  ban: '<circle cx="12" cy="12" r="8.5"/><path d="m6 6 12 12"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-2.3 6.1"/><path d="M20 4v7h-7"/>',
  plug: '<path d="M9 3v5M15 3v5M6.5 8h11v3a5.5 5.5 0 0 1-11 0z"/><path d="M12 16.5V21"/>',
  gamepad: '<rect x="2.5" y="7" width="19" height="11" rx="5"/><path d="M7.5 10.5v4M5.5 12.5h4M15.5 11.5h.01M18 13.5h.01"/>',
});
let REAL = false;
SH.apiReady.then(a => { REAL = !!a; });

/* ---------------- categories ---------------- */
const CATS = {
  security: { n: 'Security', ic: 'shield', tab: 'windows' },
  apps: { n: 'Apps', ic: 'package', tab: 'apps' },
  windows: { n: 'Windows', ic: 'windows', tab: 'windows' },
  store: { n: 'Store', ic: 'store', tab: 'store' },
  runtimes: { n: 'Components', ic: 'layers', tab: 'runtimes' },
  dev: { n: 'Development', ic: 'code', tab: 'dev' },
};
const CAT_ORDER = ['security', 'apps', 'windows', 'store', 'runtimes', 'dev'];

/* ---------------- sample data (only outside the app) ---------------- */
const N = (o) => ({ admin: false, reboot: false, notes: [], kind: 'mock', ...o });
const ITEMS = [
  N({ id: 'def', cat: 'security', name: 'Microsoft Defender signatures', pub: 'Microsoft', from: '1.441.212.0', to: '1.441.388.0', mb: 82, notes: ['New threat definitions released today.'] }),
  N({ id: 'kb-cu', cat: 'security', name: 'November cumulative update (KB5072033)', pub: 'Windows Update', from: '26200.7019', to: '26200.7171', mb: 412, admin: true, reboot: true, kb: 'KB5072033', notes: ['Fixes 64 vulnerabilities, 3 of them critical.'] }),
  N({ id: 'chrome', cat: 'apps', name: 'Google Chrome', pub: 'Google', from: '131.0.6778.86', to: '131.0.6778.109', mb: 112, color: '#6FA8FF', notes: ['Fixes 7 security bugs.'] }),
  N({ id: 'discord', cat: 'apps', name: 'Discord', pub: 'Discord Inc.', from: '1.0.9172', to: '1.0.9175', mb: 98, color: '#8EA2FF' }),
  N({ id: 'vscode', cat: 'apps', name: 'Visual Studio Code', pub: 'Microsoft', from: '1.106.2', to: '1.107.0', mb: 104, color: '#4FB3FF' }),
  N({ id: '7zip', cat: 'apps', name: '7-Zip', pub: 'Igor Pavlov', from: '24.08', to: '25.01', mb: 1.6, color: '#C9D4E8' }),
  N({ id: 'vlc', cat: 'apps', name: 'VLC media player', pub: 'VideoLAN', from: '3.0.21', to: '3.0.22', mb: 42, color: '#FFB27A' }),
  N({ id: 'obs', cat: 'apps', name: 'OBS Studio', pub: 'OBS Project', from: '31.1.2', to: '32.0.2', mb: 140, color: '#B8C4D9' }),
  N({ id: 'npp', cat: 'apps', name: 'Notepad++', pub: 'Don Ho', from: '8.8.6', to: '8.8.8', mb: 6, color: '#A8D672' }),
  N({ id: 'ssu', cat: 'windows', name: 'Servicing stack update', pub: 'Windows Update', from: '', to: '', mb: 18, admin: true }),
  N({ id: 'kb-prev', cat: 'windows', name: 'November cumulative preview (KB5072590)', pub: 'Windows Update', from: '', to: 'KB5072590', mb: 420, admin: true, reboot: true, optional: true, kb: 'KB5072590' }),
  N({ id: 'terminal', cat: 'store', name: 'Windows Terminal', pub: 'Microsoft Store', from: '1.23.12811', to: '1.23.13013', mb: 36, color: '#C9D4E8' }),
  N({ id: 'dotnet8', cat: 'runtimes', name: '.NET Desktop Runtime 8', pub: 'Microsoft', from: '8.0.21', to: '8.0.22', mb: 55 }),
  N({ id: 'vcredist', cat: 'runtimes', name: 'Visual C++ 2015-2022 (x64)', pub: 'Microsoft', from: '14.44.35211', to: '14.50.35719', mb: 25 }),
  N({ id: 'node', cat: 'dev', name: 'Node.js', pub: 'OpenJS Foundation', from: '24.19.0', to: '24.20.0', mb: 31 }),
  N({ id: 'ghcli', cat: 'dev', name: 'GitHub CLI', pub: 'GitHub', from: '2.102.0', to: '2.104.0', mb: 12 }),
];
const MOCK = {
  apps: () => ({ winget: true, items: ITEMS.filter(i => !['security', 'windows'].includes(i.cat)).map(x => ({ ...x })), pins: {},
    unknown: [{ name: 'FL Studio 2026', pub: 'Image-Line', ver: '26.1.3.5570', url: 'https://www.image-line.com/' }, { name: 'Melodyne 5', pub: 'Celemony', ver: '5.4.2', url: 'https://www.celemony.com/' }, { name: 'iZotope RX 11 Audio Editor', pub: 'iZotope', ver: '11.3.0', url: 'https://www.izotope.com/' }],
    storeOk: [['Calculator', '11.2508.4.0'], ['Snipping Tool', '11.2509.23.0'], ['Notepad', '11.2508.38.0'], ['Paint', '11.2508.361.0']].map(([name, ver]) => ({ name, ver })),
    runtimesOk: [{ name: 'WebView2 Runtime', ver: '157.0.4341.60' }, { name: '.NET Desktop Runtime 9', ver: '9.0.11' }],
    devOk: [{ name: 'Git', ver: '2.56.0' }], ts: Date.now() / 1000 }),
  win: () => ({ updates: ITEMS.filter(i => ['security', 'windows'].includes(i.cat) && i.id !== 'def').map(x => ({ ...x })), reboot: false, pause: null,
    history: [['October cumulative update (KB5068861)', '2026-10-15', true], ['September cumulative preview (KB5066198)', '2026-09-25', false]].map(([t, d, ok]) => ({ t, d, ok, hr: '0x800F0922' })),
    defender: { on: true, sig: '1.441.212.0' }, build: '26200.7019', version: '25H2', product: 'Windows 11 Pro', ts: Date.now() / 1000 }),
  dev: () => ({ python: '3.13.14', pip: [['pip', '26.1.2', '26.3'], ['pywebview', '6.2.1', '6.3.0'], ['pillow', '12.0.0', '12.1.0']], node: '24.19.0', npm: [['typescript', '5.9.3', '6.0.2']], git: '2.56.0', tools: [['WSL', '3.0.5.0']] }),
};
const wait = ms => new Promise(r => setTimeout(r, ms));

/* ---------------- state ---------------- */
const S = { items: [], byId: {}, sel: new Set(), ignored: new Set(), pinned: new Set(), apps: null, win: null, dev: null,
  scanned: false, winScanned: false, devScanned: false, paused: null, reboot: false, errs: {}, prog: {} };
const pending = () => S.items.filter(i => !i.done && !S.ignored.has(i.id) && !S.pinned.has(i.id));
const pendingIn = cat => pending().filter(i => i.cat === cat && !i.optional);
const mb = v => v == null || isNaN(v) ? '—' : v >= 1024 ? fmt1(v / 1024) + ' GB' : (v < 10 ? fmt1(v) : Math.round(v)) + ' MB';
const CAT_COL = { security: 'var(--warn)', windows: 'var(--accent2)', store: 'var(--accent2)', runtimes: 'var(--accent)', dev: 'var(--ok)', apps: 'var(--accent2)' };
const PAL = ['#6FA8FF', '#8EA2FF', '#7FE0B4', '#FFB27A', '#F4C26B', '#A8D672', '#FF8FB1', '#5FD3C6', '#C9D4E8'];
const colorFor = s => PAL[[...String(s)].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7) % PAL.length];
const initial = s => (String(s).replace(/^[^A-Za-z0-9]+/, '')[0] || '?').toUpperCase();
function tile(it) {
  if (it.icon) return `<span class="u-tile img"><img src="${it.icon}" alt="" decoding="async"></span>`;
  if (it.cat === 'apps' || it.cat === 'store' || it.color) { const c = it.color || colorFor(it.name); return `<span class="u-tile" style="--c:${c}">${esc(initial(it.name))}</span>`; }
  return `<span class="u-tile" style="--c:${CAT_COL[it.cat] || 'var(--accent2)'}">${ic((CATS[it.cat] || CATS.apps).ic)}</span>`;
}
const smallTile = (o, fallbackIc = 'package', col = 'var(--mute)') => o.icon ? `<span class="u-tile img sm"><img src="${o.icon}" alt="" decoding="async"></span>` : `<span class="u-tile sm" style="--c:${o.name ? colorFor(o.name) : col}">${o.name ? esc(initial(o.name)) : ic(fallbackIc)}</span>`;
/* "Unknown": winget can't read the installed version, so updating reinstalls the latest one (not in Update all) */
const vers = it => it.unknownVersion
  ? `<span class="u-ver" title="winget can't read the installed version: updating reinstalls the latest one"><span class="u-unk">Unknown</span>${ic('arrow')}<b>${esc(it.to)}</b></span>`
  : it.from ? `<span class="u-ver"><span>${esc(it.from)}</span>${ic('arrow')}<b>${esc(it.to)}</b></span>` : `<span class="u-ver"><b>${esc(it.to || '')}</b></span>`;
const ago = ts => { if (!ts) return 'not yet'; const s = (Date.now() - ts) / 1000; if (s < 60) return 'a moment ago'; if (s < 3600) return `${Math.round(s / 60)} min ago`; if (s < 86400) return `${Math.round(s / 3600)} h ago`; const d = Math.round(s / 86400); return d === 1 ? '1 day ago' : `${d} days ago`; };
const fdate = d => { const t = Date.parse(d); return isNaN(t) ? esc(d) : new Date(t).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' }); };
let ctxRef = null;
function ignoredMap() { return { ...(state.settings.updIgnored || {}) }; }
function setItems() {
  const items = [...((S.apps && S.apps.items) || []), ...((S.win && S.win.updates) || [])];
  /* Defender signatures: only if Defender is the active antivirus */
  const d = S.win && S.win.defender;
  if (REAL && d && d.on) items.unshift({ id: 'defender', kind: 'defender', cat: 'security', name: 'Microsoft Defender signatures', pub: 'Microsoft', from: d.sig || '', to: 'latest', mb: null, admin: false, reboot: false, notes: d.sigDate ? [`Last updated on ${fdate(d.sigDate)}.`] : [] });
  const old = S.byId; S.items = items.map(i => (old[i.id] && old[i.id].done) ? { ...i, done: true } : i);
  S.byId = Object.fromEntries(S.items.map(i => [i.id, i]));
  const ig = ignoredMap(); S.ignored = new Set(S.items.filter(i => ig[i.id] && ig[i.id] === i.to).map(i => i.id));
  S.pinned = new Set(REAL ? Object.keys((S.apps && S.apps.pins) || {}) : [...S.pinned]);
}
function publishPending() {
  const n = pending().filter(i => !i.optional).length;
  if (ctxRef) ctxRef.setBadge('overview', n);
  if (S.scanned) SH.setPending('apps', n);
}
function refreshBadge() { publishPending(); }

/* ---------------- searches (real inside the app) ---------------- */
let pA = null, pW = null, pD = null;
function scanProgress(kind, m) { S.prog[kind] = m; const el = $(`#v-${ID} .u-sub`); if (el && !S.scanned) el.textContent = m.text || 'Searching…'; updateWinWait(); }
function scanApps(force) {
  if (pA && !force) return pA;
  pA = (REAL ? SH.job(ID, 'scan_apps', [], { onProgress: m => scanProgress('apps', m) }) : wait(900).then(MOCK.apps))
    .then(r => { S.errs.apps = null; S.apps = r || { items: [] }; S.scanned = true; setItems(); onData('apps'); return r; })
    .catch(e => { S.errs.apps = e.message; S.scanned = true; S.apps = S.apps || { items: [] }; setItems(); onData('apps'); });
  return pA;
}
function scanWindows(force) {
  if (pW && !force) return pW;
  S.winScanning = true; updateWinWait();
  pW = (REAL ? SH.job(ID, 'scan_windows', [], { onProgress: m => scanProgress('win', m) }) : wait(1600).then(MOCK.win))
    .then(r => { S.errs.win = null; S.win = r; S.winScanned = true; S.winScanning = false; S.reboot = !!r.reboot; S.paused = r.pause ? Date.parse(r.pause) : null; setItems(); onData('win'); return r; })
    .catch(e => { S.errs.win = e.message; S.winScanning = false; S.winScanned = true; onData('win'); });
  return pW;
}
function scanDev(force) {
  if (pD && !force) return pD;
  pD = (REAL ? SH.job(ID, 'scan_dev', [], { onProgress: m => scanProgress('dev', m) }) : wait(700).then(MOCK.dev))
    .then(r => { S.errs.dev = null; S.dev = r; S.devScanned = true; onData('dev'); return r; })
    .catch(e => { S.errs.dev = e.message; S.devScanned = true; onData('dev'); });
  return pD;
}
const ensureScan = () => scanApps();
function onData(kind) {
  rerenderAll(); publishPending(); updateWinWait();
  const v = $(`#v-${ID}`); if (!v) return;
  if (kind === 'win') { const w = $('.tab[data-tab="windows"]', v); if (w && w.dataset.ready) fillWindows(w); }
  if (kind !== 'dev') { const st = $('.tab[data-tab="store"]', v); if (st && st.dataset.ready) fillStore(st); const rt = $('.tab[data-tab="runtimes"]', v); if (rt && rt.dataset.ready) fillRuntimes(rt); }
  if (kind !== 'win') { const d = $('.tab[data-tab="dev"]', v); if (d && d.dataset.ready) fillDev(d); }
  const s = $('.tab[data-tab="schedule"]', v); if (s && s.dataset.ready) renderNext(s, false);
}
function updateWinWait() {
  const p = S.prog.win;
  $$(`#v-${ID} .u-wwait`).forEach(g => {
    g.querySelector('span').textContent = S.winScanning ? (p && p.text) || 'Searching Windows Update…' : '';
    const bar = g.querySelector('.bar>span'); if (bar) bar.style.transform = `scaleX(${(p && p.pct) || .05})`;
    g.classList.toggle('on', !!S.winScanning);
  });
}

/* ---------------- install queue ---------------- */
const Q = { list: [], running: false, paused: false, timer: 0, total: new Spring(0, 80, 17) };
function enqueue(ids) {
  let added = 0;
  ids.forEach(id => { const it = typeof id === 'object' ? id : S.byId[id]; if (!it || it.done || Q.list.some(q => q.it === it && ['queued', 'down', 'inst'].includes(q.st))) return;
    Q.list.push({ it, st: 'queued', p: 0, ph: 0, sp: new Spring(0, 140, 20) }); added++; });
  if (added) { renderQueue(true); startQueue(); }
  return added;
}
function startQueue() {
  if (Q.running) return; Q.askedAdmin = false; Q.running = true; Q.paused = false;
  if (REAL) runQueueReal(); else { clearInterval(Q.timer); Q.timer = setInterval(stepQueue, 60); }
  renderQueueHead();
}
/* --- real: one engine job per item (pause = don't start the next one; cancel = stop the download) --- */
function payload(it) {
  if (it.kind === 'winget') return { kind: 'winget', wid: it.wid, source: it.source, name: it.name };
  if (it.kind === 'wu') return { kind: 'wu', uid: it.uid, name: it.name };
  if (it.kind === 'defender') return { kind: 'defender', name: it.name };
  return { kind: it.kind, pkgs: it.pkgs, name: it.name };
}
async function runQueueReal() {
  for (;;) {
    if (Q.paused) break;
    const cur = Q.list.find(q => q.st === 'queued'); if (!cur) break;
    const it = cur.it;
    if (it.admin && !state.admin) { cur.st = 'admin'; if (!Q.askedAdmin) { Q.askedAdmin = true; SH.requireAdmin('to install Windows updates.'); } updQRow(cur); continue; }
    cur.st = 'down'; cur.p = 0; updQRow(cur); scrollQ(cur);
    const job = SH.job(ID, 'install', [[payload(it)]], { onProgress: m => {
      const s = m.data && m.data.items && m.data.items[0]; if (!s) return;
      const st = s.st === 'queued' ? 'down' : s.st; if (s.mb) cur.mb = s.mb; cur.p = s.p || 0;
      if (st !== cur.st && ['down', 'inst'].includes(st)) { cur.st = st; updQRow(cur); } else updQRow(cur, true);
    }, onLog: lines => { const l = lines.filter(x => x && !/^[\s\-\\|/█▒]+$/.test(x)).pop(); if (l) cur.last = l; } });
    cur.job = job;
    try {
      const res = await job; const s = (res && res.items && res.items[0]) || { st: 'fail', msg: 'No answer from the engine' };
      cur.st = s.st === 'queued' ? 'fail' : s.st; cur.msg = s.msg; if (res && res.reboot) S.reboot = true;
    } catch (e) { cur.st = e.cancelled ? 'cancel' : 'fail'; cur.msg = e.message; }
    if (cur.cancelAfter && cur.st !== 'done') cur.st = 'cancel';
    if (cur.st === 'done') { it.done = true; onItemDone(it); SH.logActivity(`${it.name} updated`, { sub: it.to && it.kind !== 'wu' ? `to version ${it.to}` : (it.kb || ''), ic: 'updater', go: ID, tab: 'apps' }); }
    updQRow(cur);
    if (cur.cancelAfter) { Q.list.forEach(q => { if (q.st === 'queued') { q.st = 'cancel'; updQRow(q); } }); break; }
  }
  Q.running = false; renderQueueHead(); finishedToast(); publishPending();
  if (Q.list.some(q => q.st === 'done' && q.it.kind === 'winget')) setTimeout(() => scanApps(true), 1500);
}
/* --- sample: simulation --- */
function stepQueue() {
  if (Q.paused) return;
  let cur = Q.list.find(q => q.st === 'down' || q.st === 'inst');
  if (!cur) {
    cur = Q.list.find(q => q.st === 'queued');
    if (!cur) { Q.running = false; clearInterval(Q.timer); renderQueueHead(); finishedToast(); return; }
    if (cur.it.admin && !state.admin) { cur.st = 'admin'; if (!Q.askedAdmin) { Q.askedAdmin = true; SH.requireAdmin('to install Windows updates and system components.'); } updQRow(cur); return; }
    cur.st = 'down'; cur.ph = 0; updQRow(cur); scrollQ(cur);
  }
  const it = cur.it, w = it.mb || 40;
  if (cur.st === 'down') { cur.p = Math.min(1, cur.p + .06 / Math.max(.7, Math.min(3.2, w / 70))); if (cur.p >= 1) { cur.st = 'inst'; cur.ph = 0; updQRow(cur); } }
  else { cur.ph += .06 / Math.max(.6, Math.min(2, w / 160)); if (cur.ph >= 1) { cur.st = 'done'; it.done = true; if (it.reboot) S.reboot = true; onItemDone(it); updQRow(cur); } }
  updQRow(cur, true);
}
function finishedToast() {
  const done = Q.list.filter(q => q.st === 'done').length, fail = Q.list.filter(q => q.st === 'fail').length, adm = Q.list.filter(q => q.st === 'admin').length;
  if (!done && !fail && !adm) return;
  let t = `${done} ${done === 1 ? 'update installed' : 'updates installed'}`;
  if (fail) t += `, ${fail} failed`; if (adm) t += `, ${adm} waiting for admin mode`;
  SH.toast(t + '.', S.reboot ? { action: { label: 'Restart now', run: () => SH.toast('Save your work and restart from the Start menu when you can.') }, group: 'upd-done' } : { group: 'upd-done' });
}
function onItemDone(it) {
  S.sel.delete(it.id);
  $$(`#v-${ID} [data-item="${CSS.escape(it.id)}"]`).forEach(row => markDone(row));
  refreshBadge(); updateOverviewCounts(); updateSelBars();
}
function markDone(row) {
  if (row.classList.contains('is-done')) return; row.classList.add('is-done');
  const act = $('.u-act', row); if (act) { act.innerHTML = `<span class="chip ok">${ic('check')}Updated</span>`; anim(act.firstElementChild, [{ opacity: 0, transform: 'scale(.7)' }, { opacity: 1, transform: 'scale(1)' }], { d: 380, e: EASE.spring }); }
  const ck = $('.check', row); if (ck) ck.classList.remove('on');
}
const QST = { queued: 'Queued', down: 'Downloading', inst: 'Installing', done: 'Installed', fail: 'Error', cancel: 'Cancelled', admin: 'Needs admin mode' };
function qRowHTML(q, i) {
  return `<div class="u-qrow st-${q.st}" data-q="${i}">${tile(q.it)}<div class="u-qt"><b>${esc(q.it.name)}</b><span class="u-qs">${qStateText(q)}</span>
    <div class="u-qbar"><span></span></div></div><span class="u-qi">${qIcon(q)}</span></div>`;
}
function qStateText(q) {
  const tot = q.mb || q.it.mb;
  if (q.st === 'down') return tot ? `Downloading, ${mb(tot * q.p)} of ${mb(tot)}` : `Downloading${q.p ? `, ${Math.round(q.p * 100)}%` : '…'}`;
  if (q.st === 'inst') return q.cancelAfter ? 'Installing; will stop when it finishes' : 'Installing…';
  if (q.st === 'fail') return esc(q.msg || 'Error');
  return QST[q.st];
}
function qIcon(q) {
  if (q.st === 'done') return `<svg class="i u-okmark" viewBox="0 0 24 24"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>`;
  if (q.st === 'fail') return `<button class="btn sm sec" data-retry="${Q.list.indexOf(q)}">Retry</button>`;
  if (q.st === 'admin') return `<button class="btn sm sec" data-admin>Turn on</button>`;
  if (q.st === 'down' || q.st === 'inst') return '<span class="u-spin"></span>';
  return '';
}
function updQRow(q, light) {
  const row = $(`#v-${ID} .u-qrow[data-q="${Q.list.indexOf(q)}"]`); if (!row) return;
  const s = $('.u-qs', row), t = qStateText(q); if (s.innerHTML !== t) s.innerHTML = t;
  Q.dirty = true;
  if (light) return;
  row.className = `u-qrow st-${q.st}`; $('.u-qi', row).innerHTML = qIcon(q);
  if (q.st === 'done') { const m = $('.u-okmark', row); if (m) anim(m, [{ strokeDashoffset: 24 }, { strokeDashoffset: 0 }], { d: 420 }); }
  renderQueueHead();
}
function scrollQ(q) { const row = $(`#v-${ID} .u-qrow[data-q="${Q.list.indexOf(q)}"]`); if (row && row.offsetParent) row.scrollIntoView({ block: 'nearest', behavior: state.settings.intensity === 'min' ? 'auto' : 'smooth' }); }
function qProgress() {
  const live = Q.list.filter(q => q.st !== 'cancel'); if (!live.length) return 0;
  const w = q => q.mb || q.it.mb || 50; const tot = live.reduce((a, q) => a + w(q), 0) || 1;
  const got = live.reduce((a, q) => a + (q.st === 'done' ? w(q) : q.st === 'down' ? w(q) * q.p * .8 : q.st === 'inst' ? w(q) * (.8 + .2 * Math.min(1, REAL ? .5 : q.ph)) : 0), 0);
  return got / tot;
}
function renderQueueHead() {
  const box = $(`#v-${ID} .u-queue`); if (!box) return;
  const live = Q.list.filter(q => q.st !== 'cancel'); const done = live.filter(q => q.st === 'done').length;
  $('.u-qnum', box).textContent = live.length ? `${done} of ${live.length} done` : 'Nothing queued';
  const ctl = $('.u-qctl', box);
  const want = Q.running ? (Q.paused ? 'paused' : 'run') : (Q.list.length ? 'idle' : 'empty');
  if (ctl.dataset.mode !== want) {
    ctl.dataset.mode = want;
    ctl.innerHTML = want === 'empty' ? '' : want === 'idle' ? `<button class="btn sm ghost" data-qclear>Clear</button>${Q.list.some(q => q.st === 'queued') ? `<button class="btn sm sec" data-qresume>${ic('play')}Resume</button>` : ''}`
      : `<button class="btn sm sec" data-qpause>${ic(Q.paused ? 'play' : 'pause')}${Q.paused ? 'Resume' : 'Pause'}</button><button class="btn sm ghost" data-qcancel>Cancel</button>`;
    $$('button', ctl).forEach((b, i) => anim(b, [{ opacity: 0, transform: 'scale(.85)' }, { opacity: 1, transform: 'scale(1)' }], { d: 300, delay: i * 40, e: EASE.spring }));
  }
  box.classList.toggle('is-paused', Q.paused);
  Q.dirty = true;
}
function recentHTML() {
  let rows = [];
  if (REAL) {
    rows = (state.settings.activity || []).filter(a => a.go === ID).slice(0, 4).map(a => [a.t, a.sub, ago(a.at)]);
    if (rows.length < 4 && S.win) rows = rows.concat(S.win.history.filter(h => h.ok).slice(0, 4 - rows.length).map(h => [h.t, 'Windows Update', fdate(h.d)]));
  } else rows = [['Brave', 'version 1.84.132', 'yesterday'], ['NVIDIA App', 'version 11.0.5.420', '4 days ago']];
  if (!rows.length) return '';
  return `<div class="u-qrecent"><h5>Recently installed</h5>${rows.map(([n, v, d]) => `<div class="u-qrow st-done"><span class="u-qi"><svg class="i u-okmark" viewBox="0 0 24 24"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg></span><div class="u-qt"><b>${esc(n)}</b><span class="u-qs">${esc(v || '')}</span></div><span class="faint u-qd">${esc(d)}</span></div>`).join('')}</div>`;
}
function renderQueue(animateNew) {
  const box = $(`#v-${ID} .u-queue`); if (!box) return;
  const list = $('.u-qlist', box);
  if (!Q.list.length) { list.innerHTML = `<div class="u-qempty"><span class="u-qei">${ic('download')}</span><b>The queue is empty</b>Check what you want to update or press Update all.</div>${recentHTML()}`; renderQueueHead(); return; }
  if ($('.u-qempty', list)) list.innerHTML = '';
  const known = new Set($$('.u-qrow', list).map(r => r.dataset.q));
  let n = 0;
  Q.list.forEach((q, i) => { if (known.has(String(i))) return; list.insertAdjacentHTML('beforeend', qRowHTML(q, i));
    const row = list.lastElementChild; q.bar = $('.u-qbar>span', row); if (animateNew) anim(row, [{ opacity: 0, transform: 'translate3d(16px,0,0)', filter: 'blur(6px)' }, { opacity: 1, transform: 'none', filter: 'blur(0px)' }], { d: 420, delay: Math.min(n++, 12) * 35, e: EASE.spring }); });
  renderQueueHead();
}
/* queue bars: only written while something moves (no per-frame work when idle) */
tickers.add(dt => {
  if (state.view !== ID || (!Q.running && !Q.dirty)) return;
  const box = $(`#v-${ID} .u-queue`); if (!box || !box.offsetParent) return;
  Q.total.t = qProgress(); Q.total.step(dt);
  let moving = !Q.total.idle;
  const pct = String(Math.round(Math.max(0, Math.min(1, Q.total.v)) * 100)); const pe = $('.u-qpct', box); if (pe.textContent !== pct) pe.textContent = pct;
  $('.u-qtot>span', box).style.transform = `scaleX(${Math.max(0, Math.min(1, Q.total.v)).toFixed(4)})`;
  Q.list.forEach(q => {
    q.sp.t = q.st === 'down' ? q.p : (q.st === 'inst' || q.st === 'done') ? 1 : 0; if (q.sp.idle && q.drawn === q.sp.t) return;
    q.sp.step(dt); moving = true; if (q.bar && q.bar.isConnected) q.bar.style.transform = `scaleX(${Math.max(0, q.sp.v).toFixed(4)})`; q.drawn = q.sp.idle ? q.sp.t : null;
  });
  if (!moving && !Q.running) Q.dirty = false;
});
function queueClicks(e) {
  if (e.target.closest('[data-qpause]')) { Q.paused = !Q.paused; if (!Q.paused && REAL && !Q.running) startQueue(); renderQueueHead(); SH.toast(Q.paused ? (REAL ? 'Stops after what is installing now finishes.' : 'Queue paused.') : 'Resuming.', { group: 'upd-q' }); return true; }
  if (e.target.closest('[data-qresume]')) { Q.paused = false; startQueue(); return true; }
  if (e.target.closest('[data-qcancel]')) {
    Q.list.forEach(q => {
      if (q.st === 'queued') { q.st = 'cancel'; updQRow(q); }
      else if (q.st === 'down' && q.job) q.job.cancel();
      else if (q.st === 'inst') { q.cancelAfter = true; updQRow(q, true); }
      else if (!REAL && ['down', 'inst'].includes(q.st)) { q.st = 'cancel'; updQRow(q); }
    });
    if (!REAL) { Q.running = false; clearInterval(Q.timer); }
    renderQueueHead(); rerenderAll(); SH.toast(REAL && Q.list.some(q => q.cancelAfter) ? 'What is installing now will finish; the rest is cancelled.' : 'Queue cancelled. What was already installed stays.', { group: 'upd-q' }); return true;
  }
  if (e.target.closest('[data-qclear]')) { Q.list = Q.list.filter(q => ['down', 'inst'].includes(q.st)); $(`#v-${ID} .u-qlist`).innerHTML = ''; renderQueue(); return true; }
  const r = e.target.closest('[data-retry]'); if (r) { const q = Q.list[+r.dataset.retry]; q.st = 'queued'; q.p = 0; q.ph = 0; q.msg = null; q.cancelAfter = false; q.sp.set(0); updQRow(q); startQueue(); return true; }
  if (e.target.closest('[data-admin]')) { SH.go('admin'); return true; }
  return false;
}
/* confirm before installing several things at once (inside the app they really change the system) */
function confirmRun(ids, label, go) {
  const list = ids.map(id => S.byId[id] || id).filter(Boolean);
  if (!REAL || list.length <= 1) { go(); return; }
  const v = $(`#v-${ID}`); let d = $('.u-confirm', v); if (d) d.remove();
  d = document.createElement('div'); d.className = 'u-confirm';
  const adm = list.filter(i => i.admin && !state.admin).length, reb = list.some(i => i.reboot);
  d.innerHTML = `<div class="u-cbox pan"><h3>${esc(label)}</h3>
    <p class="muted">${list.length} updates will be installed, one after another. Open programs may close while they install and Windows may ask for permission on some of them.${reb ? ' Some need a restart at the end.' : ''}${adm ? ` ${adm} need admin mode.` : ''}</p>
    <div class="u-clist">${list.slice(0, 8).map(i => `<div>${tile(i)}<span>${esc(i.name)}</span>${vers(i)}</div>`).join('')}${list.length > 8 ? `<div class="faint">and ${list.length - 8} more</div>` : ''}</div>
    <div class="u-cbtns"><button class="btn ghost" data-cno>Not now</button><button class="btn pri" data-cyes>${ic('download')}Update</button></div></div>`;
  v.appendChild(d);
  anim(d, [{ opacity: 0 }, { opacity: 1 }], { d: 200 }); anim($('.u-cbox', d), [{ opacity: 0, transform: 'translate3d(0,14px,0) scale(.96)' }, { opacity: 1, transform: 'none' }], { d: 420, e: EASE.spring });
  const close = () => anim(d, [{ opacity: 1 }, { opacity: 0 }], { d: 160 }).finished.then(() => d.remove()).catch(() => d.remove());
  d.addEventListener('click', e => { if (e.target === d || e.target.closest('[data-cno]')) close(); if (e.target.closest('[data-cyes]')) { close(); go(); } });
}
function updateAll() { const ids = pending().filter(i => !i.optional).map(i => i.id); if (!ids.length) { SH.toast('Everything is up to date.'); return; } confirmRun(ids, 'Update all', () => { goOverview(); enqueue(ids); }); }
function goOverview() { if (ctxRef) ctxRef.setTab('overview'); }

/* ---------------- shared pieces ---------------- */
function itemRow(it, o = {}) {
  const done = it.done; const queued = Q.list.some(q => q.it === it && ['queued', 'down', 'inst'].includes(q.st));
  const notes = it.notes && it.notes.length ? it.notes : null;
  return `<div class="u-row${done ? ' is-done' : ''}" data-item="${esc(it.id)}">
    ${o.check !== false ? `<button class="check${S.sel.has(it.id) ? ' on' : ''}" data-sel="${esc(it.id)}" aria-label="Select ${esc(it.name)}">${ic('check')}</button>` : ''}
    ${tile(it)}
    <button class="u-name" data-notes="${esc(it.id)}" title="See the release notes"><b>${esc(it.name)}</b><span>${esc(it.pub || '')}${it.kb ? `${it.pub ? ', ' : ''}${esc(it.kb)}` : ''}${it.reboot ? ', needs a restart' : ''}</span></button>
    ${vers(it)}<span class="u-size">${mb(it.mb)}</span>
    <span class="u-act">${done ? `<span class="chip ok">${ic('check')}Updated</span>` : queued ? `<button class="btn sm sec" disabled><span class="u-spin"></span>Queued</button>` : `<button class="btn sm sec" data-one="${esc(it.id)}">Update</button>`}${!done && o.menu !== false && it.kind !== 'wu' ? `<button class="iconbtn u-more" data-menu="${esc(it.id)}" aria-label="More options">${ic('dots')}</button>` : ''}</span>
    <div class="u-notes"><div>${notes ? `<ul>${notes.map(n => `<li>${esc(n)}</li>`).join('')}</ul>` : `<ul class="u-nload"><li>${REAL && it.kind === 'winget' ? 'Looking for the release notes…' : 'No release notes from the publisher.'}</li></ul>`}</div></div>
  </div>`;
}
async function toggleNotes(id, root) {
  const row = $(`.u-row[data-item="${CSS.escape(id)}"]`, root); if (!row) return;
  row.classList.toggle('open');
  if (!row.classList.contains('open')) return;
  const it = S.byId[id];
  if (REAL && it && it.kind === 'winget' && !it.notesLoaded) {
    it.notesLoaded = true;
    let r = null; try { r = await SH.engine(ID, 'notes', it.wid); } catch { r = null; }
    it.notes = (r && r.notes) || []; it.notesUrl = r && r.url;
    const ul = $('.u-notes ul', row);
    if (ul) ul.outerHTML = `<ul>${it.notes.length ? it.notes.map(n => `<li>${esc(n)}</li>`).join('') : '<li>The publisher doesn\'t post notes on winget.</li>'}${it.notesUrl ? `<li class="u-nurl"><button class="btn sm ghost" data-url="${esc(it.notesUrl)}">${ic('external')}See the notes on their website</button></li>` : ''}</ul>`;
  }
  $$('li', row).forEach((li, i) => anim(li, [{ opacity: 0, transform: 'translate3d(0,-4px,0)' }, { opacity: 1, transform: 'none' }], { d: 320, delay: 60 + i * 40 }));
}
function toggleSel(id, btn) {
  if (S.sel.has(id)) S.sel.delete(id); else S.sel.add(id);
  $$(`#v-${ID} [data-sel="${CSS.escape(id)}"]`).forEach(b => b.classList.toggle('on', S.sel.has(id)));
  if (btn) anim(btn, [{ transform: 'scale(.82)' }, { transform: 'scale(1)' }], { d: 300, e: EASE.spring });
  updateSelBars();
}
function updateSelBars() {
  $$(`#v-${ID} .u-selbar`).forEach(bar => {
    const n = S.sel.size; const show = n > 0; const was = bar.classList.contains('on');
    $('b', bar).textContent = `${n} selected`;
    if (show !== was) { bar.classList.toggle('on', show); if (show) anim(bar, [{ opacity: 0, transform: 'translate3d(0,8px,0) scale(.97)' }, { opacity: 1, transform: 'none' }], { d: 360, e: EASE.spring }); }
  });
}
const selBar = () => `<div class="u-selbar"><b>0 selected</b><span class="sp"></span><button class="btn sm ghost" data-selclear>Clear selection</button><button class="btn sm pri" data-selgo>${ic('download')}Update selected</button></div>`;

/* context menu */
let menuEl = null;
function openMenu(btn, id) {
  closeMenu(); const it = S.byId[id]; const host = btn.closest('.tab');
  menuEl = document.createElement('div'); menuEl.className = 'u-menu';
  menuEl.innerHTML = `<button data-m="notes">${ic('file')}Release notes</button><button data-m="ignore">${ic('ban')}Ignore version ${esc(it.to)}</button>${it.kind === 'winget' || !REAL ? `<button data-m="pin">${ic('pin')}Stay on ${esc(it.from)}</button>` : ''}`;
  host.appendChild(menuEl);
  const r = btn.getBoundingClientRect(), hr = host.getBoundingClientRect();
  menuEl.style.top = (r.bottom - hr.top + host.scrollTop + 6) + 'px'; menuEl.style.right = Math.max(4, hr.right - r.right) + 'px';
  const up = r.bottom + 6 + menuEl.offsetHeight > hr.bottom - 4;
  if (up) { menuEl.style.top = (r.top - hr.top + host.scrollTop - 6 - menuEl.offsetHeight) + 'px'; menuEl.style.transformOrigin = '90% 100%'; }
  anim(menuEl, [{ opacity: 0, transform: `translate3d(0,${up ? 6 : -6}px,0) scale(.94)` }, { opacity: 1, transform: 'none' }], { d: 260, e: EASE.spring });
  menuEl.addEventListener('click', e => { const b = e.target.closest('[data-m]'); if (!b) return; const m = b.dataset.m; closeMenu();
    if (m === 'notes') toggleNotes(id, host); else hideItem(id, m); });
  menuEl.dataset.id = id;
}
function closeMenu() { if (!menuEl) return; const m = menuEl; menuEl = null; anim(m, [{ opacity: 1 }, { opacity: 0, transform: 'scale(.96)' }], { d: 140 }).finished.then(() => m.remove()).catch(() => m.remove()); }
document.addEventListener('pointerdown', e => { if (menuEl && !e.target.closest('.u-menu') && !e.target.closest('[data-menu]')) closeMenu(); });
document.addEventListener('scroll', e => { if (menuEl && e.target.nodeType === 1 && e.target.closest && e.target.closest(`#v-${ID}`) && !e.target.closest('.u-menu')) closeMenu(); }, true);
async function hideItem(id, how) {
  const it = S.byId[id];
  if (how === 'pin' && REAL) {
    let r; try { r = await SH.engine(ID, 'pin', it.wid); } catch (e) { SH.toast('winget couldn\'t pin the version: ' + e.message); return; }
    if (S.apps) S.apps.pins = { ...(S.apps.pins || {}), [it.id]: it.from };
  }
  if (how === 'ignore') { const ig = ignoredMap(); ig[id] = it.to; SH.setSetting('updIgnored', ig); }
  (how === 'ignore' ? S.ignored : S.pinned).add(id); S.sel.delete(id); updateSelBars();
  $$(`#v-${ID} .u-row[data-item="${CSS.escape(id)}"]`).forEach(row => collapseRow(row));
  refreshBadge(); updateOverviewCounts();
  setTimeout(() => refreshAppsFilter(false), 440);
  SH.toast(how === 'ignore' ? `${it.name}: version ${it.to} is ignored.` : `${it.name} stays on ${it.from}.`, { action: { label: 'Undo', run: () => unhide(id) } });
}
async function unhide(id) {
  const it = S.byId[id];
  if (S.pinned.has(id) && REAL && it && it.wid) { try { await SH.engine(ID, 'unpin', it.wid); } catch { /* carry on */ } if (S.apps && S.apps.pins) delete S.apps.pins[id]; }
  const ig = ignoredMap(); if (ig[id]) { delete ig[id]; SH.setSetting('updIgnored', ig); }
  S.ignored.delete(id); S.pinned.delete(id); rerenderAll();
}
function collapseRow(row) {
  const h = row.offsetHeight;
  anim(row, [{ opacity: 1, transform: 'none', height: h + 'px' }, { opacity: 0, transform: 'translate3d(24px,0,0)', height: h + 'px', offset: .55 }, { opacity: 0, transform: 'translate3d(24px,0,0)', height: '0px', paddingTop: '0px', paddingBottom: '0px' }], { d: 420, e: EASE.out })
    .finished.then(() => row.remove()).catch(() => row.remove());
}
const errBox = (k, what) => S.errs[k] ? `<div class="u-err">${ic('alert')}<span>Couldn\'t ${what}: ${esc(S.errs[k])}</span><button class="btn sm sec" data-rescan="${k}">${ic('refresh')}Retry</button></div>` : '';

/* ---------------- Overview ---------------- */
function renderOverview(el) {
  el.classList.add('fill');
  el.innerHTML = `<div class="u-ov">
    <div class="u-ovl">
      <div class="u-hero" data-asm>
        <div><div class="big"><span class="u-cnt">0</span><small>pending updates</small></div>
        <p class="muted u-sub">Looking for updates…</p></div>
      </div>
      <div class="u-wwait"><span></span><div class="bar"><span></span></div></div>
      ${selBar()}
      <div class="u-errs"></div>
      <div class="u-groups"></div>
    </div>
    <aside class="pan u-queue" data-asm>
      <div class="u-qhead"><h4>Install queue</h4><span class="u-qctl"></span></div>
      <div class="u-qsum"><div class="big"><span class="u-qpct">0</span><small>%</small></div><span class="muted u-qnum">Nothing queued</span></div>
      <div class="bar acc u-qtot"><span></span></div>
      <div class="u-qlist"></div>
    </aside>
  </div>`;
  renderQueue(false);
  const groups = $('.u-groups', el);
  if (!S.scanned) groups.innerHTML = CAT_ORDER.map((c, k) => `<div class="pan u-group" data-asm><div class="u-gh"><span class="sk" style="width:32px;height:32px;border-radius:10px"></span><span class="sk" style="width:${120 + k * 18}px;height:12px"></span></div>${[0, 1].map(i => `<div class="sk-row" style="border:0;padding:8px 4px"><div class="sk a" style="--dl:${i * .1}s"></div><div class="sk b" style="--w:46%"></div><div class="sk c"></div></div>`).join('')}</div>`).join('');
  ensureScan(); scanWindows(); updateWinWait();
  if (S.scanned) { fillGroups(el, true); updateOverviewCounts(true); }
}
function fillGroups(el, animate) {
  const groups = $('.u-groups', el); if (!groups) return;
  const cats = CAT_ORDER.filter(c => S.items.some(i => i.cat === c && !i.optional));
  groups.innerHTML = cats.length ? cats.map(c => groupHTML(c)).join('') : (S.scanned && !S.winScanning ? `<div class="pan u-allok"><span class="u-qei">${ic('check')}</span><b>Everything is up to date</b><span class="muted">winget, the Store and Windows Update have nothing new for this PC.</span></div>` : '');
  const errs = $('.u-errs', el); if (errs) errs.innerHTML = errBox('apps', 'ask winget') + errBox('win', 'search Windows Update');
  if (animate) SH.assemble(groups, 0, 45, '.u-group, .u-allok');
}
function groupHTML(c) {
  const all = S.items.filter(i => i.cat === c && !i.optional && !S.ignored.has(i.id) && !S.pinned.has(i.id));
  const pend = all.filter(i => !i.done);
  const show = all.slice(0, c === 'apps' ? 6 : 4);
  return `<div class="pan u-group${c === 'security' ? ' is-sec' : ''}" data-cat="${c}">
    <div class="u-gh"><span class="u-gi">${ic(CATS[c].ic)}</span><b>${CATS[c].n}</b><span class="chip u-gc${c === 'security' && pend.length ? ' warn' : pend.length ? '' : ' ok'}">${pend.length ? `${pend.length} pending` : 'Up to date'}</span>${c === 'security' && pend.length ? '<span class="faint u-rec">Best installed first</span>' : ''}
      <span class="sp"></span><button class="btn sm ghost" data-gotab="${CATS[c].tab}">See all${ic('chev')}</button>${pend.length ? `<button class="btn sm sec" data-grp="${c}">Update</button>` : ''}</div>
    <div class="u-gl">${show.map(it => itemRow(it, { menu: c === 'apps' })).join('')}</div>
    ${all.length > show.length ? `<button class="u-gmore" data-gotab="${CATS[c].tab}">and ${all.length - show.length} more</button>` : ''}
  </div>`;
}
function updateOverviewCounts(first) {
  const el = $(`#v-${ID} .tab[data-tab="overview"]`); if (!el || !S.scanned) return;
  const p = pending().filter(i => !i.optional); const known = p.filter(i => i.mb != null); const tot = known.reduce((a, i) => a + i.mb, 0);
  const cnt = $('.u-cnt', el); if (cnt && +(cnt.dataset.v || 0) !== p.length) SH.countUp(cnt, p.length, first ? 900 : 400);
  const when = S.apps && S.apps.ts ? ago(S.apps.ts * 1000) : 'just now';
  const sub = $('.u-sub', el); if (sub) sub.textContent = p.length ? `${known.length && tot ? `${mb(tot)} known to download. ` : ''}Last checked ${when}.${S.winScanning ? ' Windows Update is still searching.' : ''}` : `Everything is up to date. Last checked ${when}.${S.winScanning ? ' Windows Update is still searching.' : ''}`;
  $$('.u-group', el).forEach(g => { const c = g.dataset.cat; const n = pendingIn(c).length; const chip = $('.u-gc', g); if (!chip) return; const t = n ? `${n} pending` : 'Up to date';
    if (chip.textContent !== t) { chip.textContent = t; chip.classList.toggle('warn', c === 'security' && !!n); chip.classList.toggle('ok', !n); anim(chip, [{ transform: 'scale(.8)', opacity: .4 }, { transform: 'scale(1)', opacity: 1 }], { d: 360, e: EASE.spring }); } });
}

/* ---------------- Apps ---------------- */
let appsFilter = 'all', appsQuery = '';
function renderApps(el) {
  el.classList.add('fill');
  el.innerHTML = `<div class="u-apps">
    <div class="pan u-list u-fp" data-asm>
      <div class="u-ph"><label class="field u-search">${ic('search')}<input placeholder="Search for an app" spellcheck="false"></label>
        <div class="seg u-filt"><span class="ind"></span><button data-f="all" class="on">Pending</button><button data-f="sel">Selected</button><button data-f="hidden">Ignored and pinned</button></div>
        <span class="sp"></span><span class="faint u-acount"></span></div>
      ${selBar()}
      <div class="tbl-head u-th"><span>App</span><span>Version</span><span>Size</span><span></span></div>
      <div class="u-scroll"><div class="u-applist rows"></div></div>
    </div>
    <aside class="u-aside">
      <div class="pan u-asum" data-asm><h4>With winget <em>the Windows package manager</em></h4>
        <div class="u-asb"><div class="big"><span class="u-apend">0</span><small>pending</small></div><span class="muted u-asz"></span></div>
        <button class="btn pri" data-grp="apps">${ic('download')}Update all</button></div>
      <div class="pan u-unknown u-fp" data-asm><h4>Outside winget <em>updated from their website</em></h4>
        <div class="u-scroll"><div class="rows u-unk"><div class="sk-rows">${[0, 1, 2].map(() => '<div class="sk-row"><div class="sk a"></div><div class="sk b" style="--w:50%"></div></div>').join('')}</div></div></div></div>
    </aside></div>`;
  requestAnimationFrame(() => SH.placeSeg($('.u-filt', el), true));
  $('.u-search input', el).addEventListener('input', e => { appsQuery = e.target.value.trim().toLowerCase(); refreshAppsFilter(true); });
  $('.u-filt', el).addEventListener('click', e => { const b = e.target.closest('button[data-f]'); if (!b || b.classList.contains('on')) return; $$('.u-filt button', el).forEach(x => x.classList.toggle('on', x === b)); SH.placeSeg($('.u-filt', el)); appsFilter = b.dataset.f; refreshAppsFilter(true); });
  ensureScan().then(() => refreshAppsFilter(true));
}
function fillUnknown(el) {
  const box = $('.u-unk', el); if (!box || !S.apps) return;
  const u = S.apps.unknown || [];
  const h4 = $('.u-unknown>h4 em', el); if (h4) h4.textContent = `${u.length} apps, updated from their website`;
  box.innerHTML = u.length ? u.map(x => `<div class="row">${smallTile(x)}<div class="rt"><b>${esc(x.name)}</b><span>${esc(x.pub ? x.pub + ', ' : '')}version ${esc(x.ver || '—')}</span></div>${x.url ? `<button class="iconbtn" data-url="${esc(x.url)}" title="Open their website">${ic('external')}</button>` : ''}</div>`).join('')
    : '<div class="faint u-none">winget recognizes everything you have installed.</div>';
}
function refreshAppsFilter(animate) {
  const el = $(`#v-${ID} .tab[data-tab="apps"]`); if (!el || !S.scanned) return; const list = $('.u-applist', el); if (!list) return;
  fillUnknown(el);
  let apps = S.items.filter(i => i.cat === 'apps');
  if (appsFilter === 'all') apps = apps.filter(i => !S.ignored.has(i.id) && !S.pinned.has(i.id));
  if (appsFilter === 'sel') apps = apps.filter(i => S.sel.has(i.id));
  if (appsFilter === 'hidden') apps = apps.filter(i => S.ignored.has(i.id) || S.pinned.has(i.id));
  if (appsQuery) apps = apps.filter(i => (i.name + ' ' + (i.pub || '')).toLowerCase().includes(appsQuery));
  const html = apps.map(it => appsFilter === 'hidden'
    ? `<div class="u-row" data-item="${esc(it.id)}">${tile(it)}<span class="u-name"><b>${esc(it.name)}</b><span>${S.ignored.has(it.id) ? `You ignore version ${esc(it.to)}` : `Pinned to ${esc(it.from)}`}</span></span>${vers(it)}<span class="u-size">${mb(it.mb)}</span><span class="u-act"><button class="btn sm ghost" data-unhide="${esc(it.id)}">Show again</button></span></div>`
    : itemRow(it)).join('');
  list.innerHTML = html || `<div class="empty"><b>${appsFilter === 'hidden' ? 'You aren\'t ignoring any version' : appsFilter === 'sel' ? 'Nothing selected yet' : appsQuery ? 'No app with that name' : 'Your apps are up to date'}</b>${appsFilter === 'sel' ? 'Check the box next to the apps you want to update.' : ''}</div>${errBox('apps', 'ask winget')}`;
  if (animate) $$('.u-row, .empty', list).slice(0, 14).forEach((r, i) => anim(r, [{ opacity: 0, transform: 'translate3d(0,10px,0)' }, { opacity: 1, transform: 'none' }], { d: 380, delay: i * 28, e: EASE.spring }));
  const pend = pendingIn('apps'); const cnt = $('.u-apend', el);
  if (cnt && +(cnt.dataset.v || 0) !== pend.length) SH.countUp(cnt, pend.length, 600);
  const sz = $('.u-asz', el); if (sz) sz.textContent = pend.length ? 'They install silently, one after another. Windows may ask for permission on some.' : 'Everything winget knows about is up to date.';
  const ac = $('.u-acount', el); if (ac) ac.textContent = `${apps.length} ${apps.length === 1 ? 'app' : 'apps'}`;
  updateSelBars();
}

/* ---------------- Windows ---------------- */
let pauseWeeks = 1;
function renderWindows(el) {
  el.classList.add('fill'); el.dataset.ready = '1';
  el.innerHTML = `<div class="u-win">
    <div class="pan u-wstat" data-asm>
      <span class="u-wlogo">${ic('windows')}</span>
      <div><b class="u-wprod">${esc(SH.PC.os || 'Windows')}</b><span class="muted u-wbuild">Searching Windows Update…</span></div>
      <span class="sp"></span><span class="chip u-rb">No restart needed</span>
      <button class="btn sec" data-wcheck>${ic('refresh')}Check now</button>
    </div>
    <div class="u-wwait"><span></span><div class="bar"><span></span></div></div>
    <div class="u-wcols">
      <div class="u-wmain u-scroll">
        <div class="pan" data-asm><h4>Security <em>installed even when paused</em></h4><div class="u-wl" data-wl="security"></div></div>
        <div class="pan" data-asm><h4>Quality and servicing</h4><div class="u-wl" data-wl="windows"></div></div>
        <div class="pan" data-asm><h4>Optional <em>only if you want them</em></h4><div class="u-wl" data-wl="optional"></div></div>
      </div>
      <div class="u-wside">
        <div class="pan u-pause" data-asm><h4>Pause updates</h4><div class="u-pbody"></div></div>
        <div class="pan u-fp" data-asm><h4>History <em>latest installs</em></h4><div class="u-scroll"><div class="rows u-hist"></div></div></div>
      </div>
    </div></div>`;
  renderPause($('.u-pbody', el));
  const sk = '<div class="sk-row" style="border:0;padding:8px 4px"><div class="sk a"></div><div class="sk b" style="--w:52%"></div><div class="sk c"></div></div>';
  $$('.u-wl', el).forEach(b => { b.innerHTML = sk; });
  scanWindows(); updateWinWait();
  if (S.winScanned) fillWindows(el);
}
function fillWindows(el) {
  const w = S.win; updateWinWait();
  if (!w) { $$('.u-wl', el).forEach(b => { b.innerHTML = errBox('win', 'search Windows Update') || '<div class="faint u-none">No data.</div>'; }); return; }
  $('.u-wprod', el).textContent = `${w.product || 'Windows'} ${w.version || ''}`.trim();
  $('.u-wbuild', el).textContent = `Build ${w.build || '—'}. Last checked ${ago((w.ts || 0) * 1000)}.`;
  const fill = (k, list) => { const box = $(`[data-wl="${k}"]`, el); box.innerHTML = list.length ? list.map(it => itemRow(it, { menu: false })).join('') : `<div class="faint u-none">${k === 'security' ? 'Nothing pending. You\'re protected.' : 'Nothing pending.'}</div>`; $$('.u-row', box).forEach((r, i) => anim(r, [{ opacity: 0, transform: 'translate3d(0,8px,0)' }, { opacity: 1, transform: 'none' }], { d: 360, delay: i * 40, e: EASE.spring })); };
  fill('security', S.items.filter(i => i.cat === 'security' && i.kind !== 'defender'));
  fill('windows', S.items.filter(i => i.cat === 'windows' && !i.optional));
  fill('optional', S.items.filter(i => i.optional));
  setReboot(el); renderPause($('.u-pbody', el));
  const h = $('.u-hist', el);
  h.innerHTML = (w.history || []).length ? w.history.map(x => `<div class="row"><span class="ri ${x.ok ? 'ok' : 'bad'}">${ic(x.ok ? 'check' : 'x')}</span><div class="rt"><b>${esc(x.t)}</b><span>${fdate(x.d)}${x.ok ? '' : `, failed with error ${esc(x.hr || '')}`}</span></div></div>`).join('') : '<div class="faint u-none">Windows has no update history.</div>';
}
function setReboot(el) { const c = $('.u-rb', el); if (!c) return; const t = S.reboot ? 'Restart pending' : 'No restart needed'; if (c.textContent !== t) { c.textContent = t; c.classList.toggle('warn', S.reboot); anim(c, [{ transform: 'scale(.85)' }, { transform: 'scale(1)' }], { d: 360, e: EASE.spring }); } }
function renderPause(box) {
  if (!box) return;
  if (S.paused && S.paused > Date.now()) {
    const d = new Date(S.paused).toLocaleDateString('en-US', { day: 'numeric', month: 'long' });
    box.innerHTML = `<p class="u-pnow"><b>Paused until ${d}</b>Antivirus signatures and critical patches still install.</p><button class="btn sec" data-resume>${ic('play')}Resume now</button>`;
  } else {
    box.innerHTML = `<p class="muted">Windows won\'t install quality updates during this time. It\'s the same as pausing in Settings.</p>
      <div class="seg u-pw"><span class="ind"></span>${[1, 2, 3, 4, 5].map(n => `<button data-w="${n}"${n === pauseWeeks ? ' class="on"' : ''}>${n} wk</button>`).join('')}</div>
      <button class="btn sec" data-pause>${ic('pause')}Pause for ${pauseWeeks === 1 ? '1 week' : pauseWeeks + ' weeks'}</button>`;
    requestAnimationFrame(() => { const s = $('.u-pw', box); if (s) SH.placeSeg(s, true); });
  }
  $$(':scope > *', box).forEach((x, i) => anim(x, [{ opacity: 0, transform: 'translate3d(0,6px,0)' }, { opacity: 1, transform: 'none' }], { d: 340, delay: i * 40, e: EASE.spring }));
}
async function doPause(weeks, el) {
  if (!REAL) { S.paused = weeks ? Date.now() + weeks * 7 * 864e5 : null; renderPause($('.u-pbody', el)); return true; }
  if (!SH.requireAdmin('to pause Windows Update.')) return false;
  let r; try { r = await SH.engine(ID, 'set_pause', weeks); } catch (e) { SH.toast('Couldn\'t do it: ' + e.message); return false; }
  if (r && r.needAdmin) { SH.requireAdmin('to pause Windows Update.'); return false; }
  S.paused = r && r.pause ? Date.parse(r.pause) : null; renderPause($('.u-pbody', el)); return true;
}

/* ---------------- Store ---------------- */
function renderStore(el) {
  el.classList.add('fill'); el.dataset.ready = '1';
  el.innerHTML = `<div class="u-apps">
    <div class="pan u-list u-fp" data-asm>
      <div class="u-ph"><div class="u-pht"><b>Pending</b><span class="muted">The Store updates on its own, but sometimes falls behind. Force it here.</span></div>
        <span class="sp"></span><button class="btn pri" data-grp="store">${ic('download')}Update all</button></div>
      <div class="u-scroll"><div class="u-storelist rows"></div></div>
    </div>
    <aside class="u-aside">
      <div class="pan u-asum" data-asm><h4>Store automatic updates</h4>
        <div class="u-sopt"><span class="u-si">${ic('store')}</span><div><b class="u-sab">On in Windows</b><span>The Store installs new versions on its own when the PC is idle.</span></div><button class="toggle on" data-storeauto aria-label="Store automatic updates"><i></i></button></div></div>
      <div class="pan u-fp" data-asm><h4>Up to date <em class="u-sokn"></em></h4>
        <div class="u-scroll"><div class="rows u-sok"></div></div></div>
    </aside></div>`;
  if (REAL) SH.engine(ID, 'store_auto').then(r => { if (!r) return; const t = $('[data-storeauto]', el); t.classList.toggle('on', !!r.on); $('.u-sab', el).textContent = r.on ? 'On in Windows' : 'Off in Windows'; }).catch(() => {});
  ensureScan().then(() => fillStore(el));
  el.addEventListener('click', async e => {
    const t = e.target.closest('[data-storeauto]'); if (!t) return; const on = !t.classList.contains('on');
    if (REAL) { if (!SH.requireAdmin('to change Store automatic updates.')) return;
      let r; try { r = await SH.engine(ID, 'set_store_auto', on); } catch (er) { SH.toast('Couldn\'t do it: ' + er.message); return; } if (r && r.needAdmin) return; }
    t.classList.toggle('on', on); $('.u-sab', el).textContent = on ? 'On in Windows' : 'Off in Windows';
    SH.toast(on ? 'The Store updates on its own again.' : 'The Store no longer updates on its own.', { action: { label: 'Undo', run: () => t.click() } });
  });
}
function fillStore(el) {
  const box = $('.u-storelist', el); if (!box || !S.scanned) return;
  const list = S.items.filter(i => i.cat === 'store');
  box.innerHTML = list.length ? list.map(it => itemRow(it, { menu: false })).join('') : '<div class="empty"><b>The Store is up to date</b>No Store apps have a new version.</div>';
  $$('.u-row', box).forEach((r, i) => anim(r, [{ opacity: 0, transform: 'translate3d(0,10px,0)' }, { opacity: 1, transform: 'none' }], { d: 380, delay: Math.min(i, 10) * 40, e: EASE.spring }));
  const ok = (S.apps && S.apps.storeOk) || [];
  $('.u-sokn', el).textContent = `${ok.length} apps`;
  $('.u-sok', el).innerHTML = ok.map(x => `<div class="row"><span class="ri ok">${ic('check')}</span><div class="rt"><b>${esc(x.name)}</b><span>version ${esc(x.ver || '—')}</span></div></div>`).join('');
}

/* ---------------- Components ---------------- */
function renderRuntimes(el) {
  el.classList.add('fill'); el.dataset.ready = '1';
  el.innerHTML = `<div class="u-rt"><div class="u-cards u-scroll"></div>
    <aside class="u-aside">
      <div class="pan u-fp" data-asm><h4>Up to date <em class="u-rtn"></em></h4><div class="u-scroll"><div class="rows u-rtok"></div></div></div>
      <div class="pan u-rtnote" data-asm><h4>What these are</h4><p class="muted">Shared pieces that games and apps need to run. Updating them doesn\'t change your apps, it just makes them safer.</p></div>
    </aside></div>`;
  ensureScan(); scanWindows();
  fillRuntimes(el);
}
function fillRuntimes(el) {
  const box = $('.u-cards', el); if (!box) return;
  if (!S.scanned) { box.innerHTML = [0, 1, 2].map(() => '<div class="pan u-card"><div class="sk" style="height:14px;width:60%"></div><div class="sk" style="height:10px;width:40%;margin-top:10px"></div></div>').join(''); return; }
  const card = (it, extra = '') => `<div class="pan u-card" data-item="${esc(it.id)}">
      <div class="u-ch">${tile(it)}<div class="u-cht"><b>${esc(it.name)}</b><span class="muted">${esc(it.pub || '')}</span></div>${it.cat === 'security' ? '<span class="chip warn">Security</span>' : ''}</div>
      ${it.notes && it.notes[0] ? `<p class="u-cnote muted">${esc(it.notes[0])}</p>` : ''}${extra}
      <div class="u-cfoot">${vers(it)}<span class="u-act">${it.done ? `<span class="chip ok">${ic('check')}Updated</span>` : `<button class="btn sm sec" data-one="${esc(it.id)}">Update</button>`}</span></div></div>`;
  const cards = S.items.filter(i => i.cat === 'runtimes').map(it => card(it));
  const def = S.byId.defender || (!REAL && S.byId.def);
  if (def) cards.push(card(def));
  else if (S.win && S.win.defender) { const o = (S.win.defender.others || [])[0];
    cards.push(`<div class="pan u-card"><div class="u-ch"><span class="u-tile" style="--c:var(--ok)">${ic('shield')}</span><div class="u-cht"><b>Antivirus</b><span class="muted">${esc(o || 'Microsoft Defender')}</span></div></div>
      <p class="u-cnote muted">${o ? `${esc(o)} protects this PC and updates its own signatures. Defender is on standby, so its signatures don\'t need updating.` : 'Defender isn\'t active right now.'}</p></div>`); }
  const maker = (SH.PC.maker || '').toLowerCase(); const biosUrl = maker.includes('asus') ? 'https://www.asus.com/support/' : maker.includes('lenovo') ? 'https://pcsupport.lenovo.com/' : maker.includes('dell') ? 'https://www.dell.com/support/' : maker.includes('hp') ? 'https://support.hp.com/' : maker.includes('msi') ? 'https://www.msi.com/support' : '';
  cards.push(`<div class="pan u-card is-bios"><div class="u-ch"><span class="u-tile" style="--c:var(--accent)">${ic('cpu')}</span><div class="u-cht"><b>System BIOS</b><span class="muted">${esc(SH.PC.maker || '')}${SH.PC.bios ? `, version ${esc(SH.PC.bios)}` : ''}</span></div></div>
    <p class="u-cnote muted">The manufacturer publishes the BIOS on its website or in its app (MyASUS, Lenovo Vantage…). StellarHub won\'t install it on its own: a power cut halfway could leave the PC unable to boot.</p>
    <p class="u-warnp">${ic('plug')}If you update it, plug in the charger and don\'t turn the PC off while it installs.</p>
    ${biosUrl ? `<div class="u-cfoot"><span class="sp"></span><button class="btn sm sec" data-url="${biosUrl}">${ic('external')}Open the support website</button></div>` : ''}</div>`);
  box.innerHTML = cards.join('') + errBox('apps', 'ask winget'); SH.assemble(box, 0, 40, '.u-card');
  const ok = (S.apps && S.apps.runtimesOk) || [];
  $('.u-rtn', el).textContent = `${ok.length} components`;
  $('.u-rtok', el).innerHTML = ok.length ? ok.map(u => `<div class="row"><span class="u-tile sm" style="--c:var(--ok)">${ic('layers')}</span><div class="rt"><b>${esc(u.name)}</b><span>version ${esc(u.ver || '—')}</span></div></div>`).join('') : '<div class="faint u-none">Nothing else to show.</div>';
}

/* ---------------- Development ---------------- */
function renderDev(el) {
  el.dataset.ready = '1';
  el.innerHTML = `<div class="u-dev">${[0, 1, 2].map(() => '<div class="pan u-dcol"><div class="sk" style="height:16px;width:50%"></div><div class="sk" style="height:10px;width:70%;margin-top:12px"></div><div class="sk" style="height:10px;width:60%;margin-top:8px"></div></div>').join('')}</div>`;
  ensureScan(); scanDev();
  if (S.devScanned) fillDev(el);
  el.addEventListener('click', e => {
    if (queueClicks(e)) return;
    const one = e.target.closest('[data-one]'); if (one) { if (enqueue([one.dataset.one])) { one.disabled = true; one.innerHTML = '<span class="u-spin"></span>Queued'; SH.toast(`${S.byId[one.dataset.one].name} added to the queue.`, { action: { label: 'See the queue', run: goOverview } }); } return; }
    const url = e.target.closest('[data-url]'); if (url) { SH.call('open_url', url.dataset.url); return; }
    const c = e.target.closest('[data-pkc]'); if (c) { c.classList.toggle('on'); anim(c, [{ transform: 'scale(.82)' }, { transform: 'scale(1)' }], { d: 300, e: EASE.spring }); updCmd(c.closest('.u-dsub')); return; }
    const all = e.target.closest('[data-pkall]'); if (all) { const col = all.closest('.u-dsub'); const ks = $$('.u-pkr .check', col); const on = ks.some(k => !k.classList.contains('on')); ks.forEach(k => k.classList.toggle('on', on)); updCmd(col); return; }
    const g = e.target.closest('[data-pkgo]'); if (g) {
      const col = g.closest('.u-dsub'); const kind = g.dataset.pkgo;
      const names = $$('.u-pkr', col).filter(r => { const k = $('.check', r); return k && k.classList.contains('on'); }).map(r => r.dataset.pk);
      if (!names.length) { SH.toast('Pick at least one package.'); return; }
      const item = { id: `${kind}:${Date.now()}`, kind, pkgs: names, name: `${names.length} ${kind} ${names.length === 1 ? 'package' : 'packages'}`, cat: 'dev', to: '', from: '', pub: kind === 'pip' ? 'Python' : 'Node.js', mb: null, notes: [] };
      confirmRun([item], `Update ${kind} packages`, () => { enqueue([item]); g.disabled = true; g.innerHTML = '<span class="u-spin"></span>Queued'; SH.toast(`${item.name} added to the queue.`, { action: { label: 'See the queue', run: goOverview } }); });
    }
  });
}
function updCmd(col) {
  const kind = col.dataset.kind;
  const names = $$('.u-pkr', col).filter(r => { const k = $('.check', r); return k && k.classList.contains('on'); }).map(r => r.dataset.pk + (kind === 'npm' ? '@latest' : ''));
  const l = $('.u-cmdl', col); if (l) { l.textContent = names.join(' ') || '(nothing selected)'; anim(l, [{ opacity: .3 }, { opacity: 1 }], { d: 260 }); }
}
function fillDev(el) {
  const d = S.dev || {}; const witems = S.items.filter(i => i.cat === 'dev');
  const pkgTable = (list, kind) => `<div class="u-pk">${list.map(([n, a, b]) => `<div class="u-pkr" data-pk="${esc(n)}"><button class="check on" data-pkc aria-label="Select ${esc(n)}">${ic('check')}</button><span class="u-pkn">${esc(n)}</span><span class="u-ver"><span>${esc(a)}</span>${ic('arrow')}<b>${esc(b)}</b></span></div>`).join('')}</div>`;
  const pkgBlock = (list, kind, title, err) => err ? `<div class="u-err">${ic('alert')}<span>${esc(err)}</span></div>` : list.length
    ? `<div class="u-dsub" data-kind="${kind}"><div class="u-dsh"><h5>${title} <em>${list.length}</em></h5><button class="btn sm ghost" data-pkall>All or none</button></div><div class="u-pkwrap u-scroll">${pkgTable(list, kind)}</div>
       <div class="u-cmd faint">${kind === 'pip' ? 'python -m pip install -U ' : 'npm install -g '}<span class="u-cmdl">${list.map(x => x[0] + (kind === 'npm' ? '@latest' : '')).join(' ')}</span></div>
       <button class="btn sm pri" data-pkgo="${kind}">${ic('download')}Update packages</button></div>`
    : `<p class="muted u-dnote">${ic('check')}${kind === 'pip' ? 'All your pip packages are up to date.' : 'No global npm package is out of date.'}</p>`;
  const wrow = it => `<div class="u-row u-drow" data-item="${esc(it.id)}">${tile(it)}<span class="u-name"><b>${esc(it.name)}</b><span>${esc(it.pub || '')}</span></span>${vers(it)}<span class="u-act">${it.done ? `<span class="chip ok">${ic('check')}Updated</span>` : `<button class="btn sm sec" data-one="${esc(it.id)}">Update</button>`}</span></div>`;
  const node = witems.filter(i => /node/i.test(i.wid || i.id || i.name)), other = witems.filter(i => !node.includes(i));
  const okTools = [...(d.git ? [['Git', d.git]] : []), ...((S.apps && S.apps.devOk) || []).filter(x => !/^git$/i.test(x.name)).map(x => [x.name, x.ver]), ...(d.tools || [])];
  const seen = new Set();
  const tools = okTools.filter(([n]) => !seen.has(n.toLowerCase()) && seen.add(n.toLowerCase()) && !other.some(o => o.name.toLowerCase() === n.toLowerCase()));
  el.innerHTML = `<div class="u-dev">
    <div class="pan u-dcol" data-asm><div class="u-dh"><span class="u-tile" style="--c:var(--ok)">${ic('code')}</span><div><b>Python</b><span class="muted">${d.python ? `version ${esc(d.python)}` : S.devScanned ? 'not found' : 'checking…'}</span></div></div>
      ${S.devScanned ? pkgBlock(d.pip || [], 'pip', 'Outdated pip packages', d.pipError) : '<p class="muted u-dnote"><span class="u-spin"></span>Asking pip (takes a few seconds)…</p>'}</div>
    <div class="pan u-dcol" data-asm><div class="u-dh"><span class="u-tile" style="--c:var(--ok)">${ic('code')}</span><div><b>Node.js</b><span class="muted">${d.node ? `version ${esc(d.node)}` : S.devScanned ? 'not installed' : 'checking…'}</span></div></div>
      ${node.map(wrow).join('')}${S.devScanned ? (d.node ? pkgBlock(d.npm || [], 'npm', 'Global npm packages', d.npmError) : '') : '<p class="muted u-dnote"><span class="u-spin"></span>Asking npm…</p>'}</div>
    <div class="pan u-dcol" data-asm><div class="u-dh"><span class="u-tile" style="--c:var(--ok)">${ic('code')}</span><div><b>Git and other tools</b><span class="muted">Updated with winget</span></div></div>
      ${other.map(wrow).join('')}
      <div class="u-dsub"><h5>Up to date</h5><div class="u-pk">${tools.length ? tools.map(([n, v]) => `<div class="u-pkr is-done"><span class="u-pkn">${esc(n)}</span><span class="u-ver"><b>${esc(v || '')}</b></span><span class="chip ok">Up to date</span></div>`).join('') : '<span class="faint">Nothing else installed.</span>'}</div></div>
    </div></div>`;
  SH.assemble(el, 0, 60);
}

/* ---------------- Schedule ---------------- */
const SCHED_DEF = { on: false, freq: 'week', day: 6, from: 3, to: 5, plugged: true, noGame: true, restore: true, idleReboot: true, inc: { apps: true, windows: true, store: true, runtimes: false, dev: false }, exclude: [] };
function sched() { const cur = state.settings.updSchedule || {}; if (!sched.c) sched.c = { ...SCHED_DEF, ...cur, inc: { ...SCHED_DEF.inc, ...(cur.inc || {}) }, exclude: [...(cur.exclude || SCHED_DEF.exclude)] }; return sched.c; }
const saveSched = () => SH.setSetting('updSchedule', JSON.parse(JSON.stringify(sched())));
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const hh = h => String(h).padStart(2, '0') + ':00';
function renderSchedule(el) {
  const s = sched(); el.dataset.ready = '1';
  const tg = (k, label, sub, icn, inc) => `<div class="u-sopt"><span class="u-si">${ic(icn)}</span><div><b>${label}</b>${sub ? `<span>${sub}</span>` : ''}</div><button class="toggle${(inc ? s.inc[k] : s[k]) ? ' on' : ''}" ${inc ? 'data-sinc' : 'data-s'}="${k}" aria-label="${label}"><i></i></button></div>`;
  const auto = (state.settings.activity || []).filter(a => a.go === ID && a.auto).slice(0, 8);
  el.classList.add('fill');
  el.innerHTML = `<div class="u-sch">
    <div class="u-scol u-scroll">
      <div class="pan u-master" data-asm>${tg('on', 'Update automatically', 'Autopilot installs what\'s pending so you don\'t have to remember.', 'autopilot')}</div>
      <div class="u-dep">
      <div class="pan" data-asm><h4>When</h4>
        <div class="u-field"><span>Frequency</span><div class="seg" data-sseg="freq"><span class="ind"></span>${[['day', 'Every day'], ['week', 'Every week'], ['month', 'Every month']].map(([v, l]) => `<button data-v="${v}"${s.freq === v ? ' class="on"' : ''}>${l}</button>`).join('')}</div></div>
        <div class="u-days${s.freq === 'week' ? ' on' : ''}"><div><div class="u-field"><span>Day</span><div class="seg" data-sseg="day"><span class="ind"></span>${DAYS.map((d, i) => `<button data-v="${i}"${s.day === i ? ' class="on"' : ''} title="${d}">${d.slice(0, 2)}</button>`).join('')}</div></div></div></div>
        <div class="u-field u-win24"><span>Time window</span><div class="u-range">
          <div class="u-24"><span class="u-band"></span>${[0, 6, 12, 18, 24].map(h => `<i style="left:${h / 24 * 100}%">${String(h).padStart(2, '0')} h</i>`).join('')}</div>
          <div class="u-rr"><label>From<input type="range" min="0" max="23" value="${s.from}" data-r="from"><b data-rv="from">${hh(s.from)}</b></label><label>To<input type="range" min="1" max="24" value="${s.to}" data-r="to"><b data-rv="to">${hh(s.to)}</b></label></div>
        </div></div>
      </div>
      <div class="pan" data-asm><h4>What gets updated</h4>
        ${tg('apps', 'Apps', 'The ones winget knows.', 'package', 1)}${tg('windows', 'Windows', 'Quality and security. Never the optional ones.', 'windows', 1)}${tg('store', 'Store', null, 'store', 1)}${tg('runtimes', 'Components', '.NET, Visual C++ and Java. Never the BIOS.', 'layers', 1)}${tg('dev', 'Development', 'Node, Git and packages.', 'code', 1)}
      </div>
      <div class="pan" data-asm><h4>Conditions</h4>
        ${tg('plugged', 'Only when the charger is plugged in', null, 'plug')}${tg('noGame', 'Never while you\'re gaming or in full screen', null, 'gamepad')}${tg('restore', 'Create a restore point first', null, 'restore')}${tg('idleReboot', 'Restart only if you\'re not using the PC', null, 'power')}
      </div>
      <div class="pan" data-asm><h4>Never touch</h4><div class="u-excl"></div>
        <div class="u-addx"><button class="btn sm ghost" data-addx>${ic('plus')}Add an app</button></div></div>
      </div>
    </div>
    <div class="u-scol2"><div class="pan u-next" data-asm><h4>Next automatic update</h4><div class="u-nexttxt"></div><div class="u-week"></div>
      <p class="faint u-nfoot">If the PC is off at that time, it runs the next time you turn it on within the window.</p></div>
      <div class="pan u-fp" data-asm><h4>Latest <em>automatic runs</em></h4><div class="u-scroll"><div class="rows">${auto.length ? auto.map(a => `<div class="row"><span class="ri ok">${ic('check')}</span><div class="rt"><b>${esc(a.t)}</b><span>${esc(a.sub || '')}</span></div></div>`).join('') : '<div class="faint u-none">None yet. They\'ll show up here when Autopilot runs them.</div>'}</div></div></div></div>
  </div>`;
  renderExcl(el); applyMaster(el, false); renderNext(el, false); bandSpring.from.set(s.from); bandSpring.to.set(s.to); bandDirty = true;
  requestAnimationFrame(() => $$('.seg', el).forEach(x => SH.placeSeg(x, true)));
  el.addEventListener('click', e => {
    const t = e.target.closest('.toggle[data-s], .toggle[data-sinc]'); if (t) { t.classList.toggle('on'); const on = t.classList.contains('on');
      if (t.dataset.s) sched()[t.dataset.s] = on; else sched().inc[t.dataset.sinc] = on; saveSched(); if (t.dataset.s === 'on') applyMaster(el, true); renderNext(el, true); return; }
    const sb = e.target.closest('[data-sseg] button'); if (sb && !sb.classList.contains('on')) { const sg = sb.parentElement; $$('button', sg).forEach(x => x.classList.toggle('on', x === sb)); SH.placeSeg(sg);
      const k = sg.dataset.sseg; sched()[k] = k === 'day' ? +sb.dataset.v : sb.dataset.v; saveSched();
      if (k === 'freq') { const d = $('.u-days', el); d.classList.toggle('on', sb.dataset.v === 'week'); if (sb.dataset.v === 'week') requestAnimationFrame(() => SH.placeSeg($('[data-sseg="day"]', el), true)); }
      renderNext(el, true); return; }
    const rx = e.target.closest('[data-rmx]'); if (rx) { const n = rx.dataset.rmx; const chip = rx.closest('.chip'); sched().exclude = sched().exclude.filter(x => x !== n); saveSched();
      anim(chip, [{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(.7)' }], { d: 200 }).finished.then(() => renderExcl(el)).catch(() => renderExcl(el)); return; }
    if (e.target.closest('[data-addx]')) { openAddx(el); return; }
    const ax = e.target.closest('[data-ax]'); if (ax) { sched().exclude.push(ax.dataset.ax); saveSched(); closeAddx(el); renderExcl(el, ax.dataset.ax); }
  });
  el.addEventListener('input', e => { const r = e.target.closest('[data-r]'); if (!r) return; const s2 = sched(); const v = +r.value;
    if (r.dataset.r === 'from') { if (v >= s2.to) { s2.to = Math.min(24, v + 1); $('[data-r="to"]', el).value = s2.to; } s2.from = v; } else { if (v <= s2.from) { s2.from = Math.max(0, v - 1); $('[data-r="from"]', el).value = s2.from; } s2.to = v; }
    $('[data-rv="from"]', el).textContent = hh(s2.from); $('[data-rv="to"]', el).textContent = hh(s2.to);
    renderNext(el, true); });
  el.addEventListener('change', e => { if (e.target.closest('[data-r]')) saveSched(); });
}
function renderExcl(el, fresh) {
  const box = $('.u-excl', el); const list = sched().exclude;
  box.innerHTML = list.length ? list.map(n => `<span class="chip u-xchip">${esc(n)}<button data-rmx="${esc(n)}" aria-label="Remove ${esc(n)}">${ic('x')}</button></span>`).join('') : '<span class="faint">You aren\'t excluding any app.</span>';
  if (fresh) { const c = $$('.u-xchip', box).find(x => x.textContent.trim() === fresh); if (c) anim(c, [{ opacity: 0, transform: 'scale(.6)' }, { opacity: 1, transform: 'scale(1)' }], { d: 380, e: EASE.spring }); }
}
function openAddx(el) {
  const host = $('.u-addx', el); if ($('.u-menu', host)) { closeAddx(el); return; }
  const names = [...new Set([...S.items.filter(i => ['apps', 'store', 'dev'].includes(i.cat)).map(i => i.name), ...(((S.apps && S.apps.unknown) || []).map(u => u.name))])];
  const opts = names.filter(n => !sched().exclude.includes(n)).sort((a, b) => a.localeCompare(b));
  const m = document.createElement('div'); m.className = 'u-menu u-addmenu'; m.innerHTML = opts.length ? opts.map(n => `<button data-ax="${esc(n)}">${ic('package')}${esc(n)}</button>`).join('') : `<button disabled>${ic('info')}Check for updates first</button>`;
  host.appendChild(m); anim(m, [{ opacity: 0, transform: 'translate3d(0,-6px,0) scale(.95)' }, { opacity: 1, transform: 'none' }], { d: 260, e: EASE.spring });
}
function closeAddx(el) { const m = $('.u-addx .u-menu', el); if (m) anim(m, [{ opacity: 1 }, { opacity: 0 }], { d: 140 }).finished.then(() => m.remove()).catch(() => m.remove()); }
function applyMaster(el, animate) {
  const on = sched().on; const dep = $('.u-dep', el); dep.classList.toggle('off', !on);
  if (animate) anim(dep, [{ opacity: on ? .4 : 1, filter: on ? 'saturate(.3)' : 'none' }, { opacity: on ? 1 : .4, filter: on ? 'none' : 'saturate(.3)' }], { d: 300, fill: 'none' });
}
function nextRun() {
  const s = sched(); const now = new Date(); const d = new Date(now); d.setMinutes(0, 0, 0); d.setHours(s.from);
  if (s.freq === 'day') { if (d <= now) d.setDate(d.getDate() + 1); }
  else if (s.freq === 'week') { const want = (s.day + 1) % 7; d.setDate(d.getDate() + (want - d.getDay() + 7) % 7); if (d <= now) d.setDate(d.getDate() + 7); }
  else { d.setDate(1); if (d <= now) d.setMonth(d.getMonth() + 1); }
  return d;
}
const bandSpring = { from: new Spring(3, 160, 22), to: new Spring(5, 160, 22) };
let bandDirty = false, bandW = 0;
function renderNext(el, animate) {
  const s = sched(); const t = $('.u-nexttxt', el); if (!t) return;
  const inc = Object.entries(s.inc).filter(([, v]) => v).map(([k]) => k === 'windows' ? 'Windows' : CATS[k].n.toLowerCase());
  const list = inc.length > 1 ? inc.slice(0, -1).join(', ') + ' and ' + inc[inc.length - 1] : inc[0];
  const html = s.on ? `<b>${nextRun().toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'long' })}</b><span>between ${hh(s.from)} and ${hh(s.to)}</span><p class="muted">${inc.length ? 'Includes ' + list + '.' : 'You haven\'t picked anything to update.'}${s.plugged ? ' Only when plugged in.' : ''}</p>`
    : `<b>Off</b><p class="muted">You start updates yourself from the Overview. Turn it on above so Autopilot does it on its own.</p>`;
  if (t.innerHTML !== html) { t.innerHTML = html; if (animate) anim(t, [{ opacity: 0, filter: 'blur(6px)', transform: 'translate3d(0,6px,0)' }, { opacity: 1, filter: 'blur(0px)', transform: 'none' }], { d: 360, e: EASE.spring }); }
  const wk = $('.u-week', el); const nd = (nextRun().getDay() + 6) % 7;
  const days = s.freq === 'day' ? [0, 1, 2, 3, 4, 5, 6] : s.freq === 'week' ? [s.day] : [];
  const prevOn = $$('.u-wd.on', wk).map(x => +x.dataset.d).join();
  wk.innerHTML = DAYS.map((d, i) => `<div class="u-wd${days.includes(i) && s.on ? ' on' : ''}${i === nd && s.on ? ' next' : ''}" data-d="${i}"><span>${d.slice(0, 2)}</span><i></i></div>`).join('');
  if (animate && prevOn !== days.join()) $$('.u-wd.on i', wk).forEach((x, i) => anim(x, [{ transform: 'scale(.2)' }, { transform: 'scale(1)' }], { d: 420, delay: i * 30, e: EASE.spring }));
  bandSpring.from.t = s.from; bandSpring.to.t = s.to; bandDirty = true;
}
addEventListener('resize', () => { bandW = 0; bandDirty = true; });
/* time band: the width is measured once (not every frame) and it only animates while moving */
tickers.add(dt => {
  if (state.view !== ID || !bandDirty) return; const band = $(`#v-${ID} .u-band`); if (!band || !band.offsetParent) return;
  bandSpring.from.step(dt); bandSpring.to.step(dt);
  if (!bandW) bandW = band.parentElement.clientWidth;
  band.style.transform = `translateX(${(bandSpring.from.v / 24 * bandW).toFixed(2)}px) scaleX(${Math.max(.002, (bandSpring.to.v - bandSpring.from.v) / 24).toFixed(4)})`;
  if (bandSpring.from.idle && bandSpring.to.idle) bandDirty = false;
});

/* ---------------- registration ---------------- */
function rerenderAll() {
  const v = $(`#v-${ID}`); if (!v) return;
  const ov = $('.tab[data-tab="overview"]', v); if (ov && $('.u-groups', ov) && S.scanned) { fillGroups(ov, true); updateOverviewCounts(); renderQueue(false); }
  refreshAppsFilter(true); refreshBadge(); updateOverviewCounts();
}
function bindCommon(el) {
  el.addEventListener('click', async e => {
    if (queueClicks(e)) return;
    if (e.target.closest('[data-all]')) { updateAll(); return; }
    const one = e.target.closest('[data-one]'); if (one) { if (enqueue([one.dataset.one])) { one.disabled = true; one.innerHTML = '<span class="u-spin"></span>Queued'; SH.toast(`${S.byId[one.dataset.one].name} added to the queue.`, { action: { label: 'See the queue', run: goOverview }, group: 'upd-add' }); } return; }
    const grp = e.target.closest('[data-grp]'); if (grp) { const ids = pendingIn(grp.dataset.grp).map(i => i.id); if (!ids.length) { SH.toast('That group is already up to date.'); return; } confirmRun(ids, `Update ${CATS[grp.dataset.grp].n.toLowerCase()}`, () => { enqueue(ids); goOverview(); }); return; }
    const sel = e.target.closest('[data-sel]'); if (sel) { toggleSel(sel.dataset.sel, sel); return; }
    if (e.target.closest('[data-selclear]')) { [...S.sel].forEach(id => toggleSel(id)); return; }
    if (e.target.closest('[data-selgo]')) { const ids = [...S.sel]; confirmRun(ids, 'Update selected', () => { [...S.sel].forEach(id => toggleSel(id)); enqueue(ids); goOverview(); }); return; }
    const nt = e.target.closest('[data-notes]'); if (nt) { toggleNotes(nt.dataset.notes, el); return; }
    const mn = e.target.closest('[data-menu]'); if (mn) { if (menuEl && menuEl.dataset.id === mn.dataset.menu) closeMenu(); else openMenu(mn, mn.dataset.menu); return; }
    const gt = e.target.closest('[data-gotab]'); if (gt) { ctxRef.setTab(gt.dataset.gotab); return; }
    const un = e.target.closest('[data-unhide]'); if (un) { collapseRow(un.closest('.u-row')); unhide(un.dataset.unhide); return; }
    const url = e.target.closest('[data-url]'); if (url) { const r = await SH.call('open_url', url.dataset.url); if (r === undefined) SH.toast('The publisher\'s website would open here.'); return; }
    const rs = e.target.closest('[data-rescan]'); if (rs) { const k = rs.dataset.rescan; if (k === 'apps') scanApps(true); else if (k === 'win') scanWindows(true); else scanDev(true); return; }
    const pw = e.target.closest('.u-pw button'); if (pw && !pw.classList.contains('on')) { $$('.u-pw button', el).forEach(x => x.classList.toggle('on', x === pw)); SH.placeSeg($('.u-pw', el)); pauseWeeks = +pw.dataset.w;
      const b = $('[data-pause]', el); b.innerHTML = `${ic('pause')}Pause for ${pauseWeeks === 1 ? '1 week' : pauseWeeks + ' weeks'}`; return; }
    if (e.target.closest('[data-pause]')) { if (await doPause(pauseWeeks, el)) SH.toast('Windows updates paused.', { action: { label: 'Undo', run: () => doPause(0, el) } }); return; }
    if (e.target.closest('[data-resume]')) { if (await doPause(0, el)) SH.toast('Updates resumed.'); return; }
    const wc = e.target.closest('[data-wcheck]'); if (wc) { anim($('svg', wc), [{ transform: 'rotate(0)' }, { transform: 'rotate(360deg)' }], { d: 900, e: EASE.io }); scanWindows(true).then(() => SH.toast(S.items.some(i => i.kind === 'wu' || i.id === 'kb-cu') ? 'There are pending Windows updates.' : 'Windows is up to date.')); }
  });
}
SH.module({
  id: ID, real: true,
  actions(el, ctx) {
    ctxRef = ctx;
    el.innerHTML = `<button class="btn sec" data-check>${ic('refresh')}Check for updates</button><button class="btn pri" data-allh>${ic('download')}Update all</button>`;
    el.addEventListener('click', async e => {
      if (e.target.closest('[data-allh]')) { await ensureScan(); updateAll(); return; }
      const c = e.target.closest('[data-check]'); if (c) { const svg = $('svg', c); const a = anim(svg, [{ transform: 'rotate(0)' }, { transform: 'rotate(360deg)' }], { d: 900, e: EASE.io }); c.disabled = true;
        await Promise.all([scanApps(true), scanWindows(true)]); c.disabled = false;
        SH.toast(`${pending().filter(i => !i.optional).length} pending updates.`, { group: 'upd-check' }); }
    });
  },
  renderTab(tab, el) {
    const R = { overview: renderOverview, apps: renderApps, windows: renderWindows, store: renderStore, runtimes: renderRuntimes, dev: renderDev, schedule: renderSchedule }[tab];
    if (R) R(el);
    if (tab !== 'dev' && tab !== 'schedule') bindCommon(el);
  },
  enterTab(tab, el) {
    if (tab === 'windows' && el) setReboot(el);
    if (tab === 'overview') { renderQueue(false); updateOverviewCounts(); }
    if (tab === 'apps') refreshAppsFilter(false);
  },
  enter() { ensureScan(); },
  leave() { closeMenu(); },
});
/* light background check (winget only, read-only) so Home knows how many there are */
SH.on('boot', () => setTimeout(() => {
  if (!REAL) return; const p = (state.settings.pending || {}).apps;
  if (!p || Date.now() - p.at > 6 * 3600e3) scanApps();
}, 9000));
SH.actions.add([
  { t: 'See the update queue', go: ID, tab: 'overview', ic: 'download' },
  { t: 'Update Python packages', go: ID, tab: 'dev', ic: 'code' },
  { t: 'Pause Windows updates', go: ID, tab: 'windows', ic: 'pause' },
  { t: 'Schedule automatic updates', go: ID, tab: 'schedule', ic: 'calendar' },
  { t: 'See apps winget can\'t update', go: ID, tab: 'apps', ic: 'package' },
]);
})();
