/* Cooling uses its own Python controller: never paused with the monitor charts. */
'use strict';
(() => {
const { t, esc, ic } = SH;
let root, timer, pending = false, data = {}, selected = '', draft = null, dirty = false, generation = 0, polling = false;
const $ = s => root.querySelector(s);
const labels = { auto: t('Automatic'), fixed: t('Fixed speed'), curve: t('Temperature curve') };
const defaultProfile = minimum => ({ mode: 'curve', speed: Math.max(60, minimum), hysteresis: 3, fallRate: 5,
  points: [[30, minimum], [50, Math.max(60, minimum)], [70, Math.max(85, minimum)], [80, 100]] });
const channel = () => (data.channels || []).find(r => r.id === selected);
const copy = v => JSON.parse(JSON.stringify(v));
const message = (text, bad = false) => { $('#coolMessage').textContent = text; $('#coolMessage').classList.toggle('bad', bad); };
async function engine(fn, ...args) {
  const result = await SH.engine('cooling', fn, ...args);
  if (result === undefined) return { channels: [], preview: true };
  return result;
}
function render(el) {
  root = el;
  root.classList.add('cooling-tab');
  root.innerHTML = `<div class="cool-layout">
    <div class="pan cool-list"><h4>${t('Fans')}</h4><div id="coolChannels" class="rows"></div>
      <p class="mnote">${t('Availability depends on the hardware. No additional driver is installed.')}</p>
      <button class="btn sec" id="coolRefresh">${ic('refresh')}${t('Refresh')}</button></div>
    <div class="pan cool-editor"><div id="coolEmpty"></div><div id="coolDetails" hidden>
      <h3 id="coolName"></h3><p class="muted" id="coolSource"></p>
      <p class="mnote">${t('Experimental NVIDIA fan control. Hardware validation is still required.')}</p>
      <div class="cool-readings"><div>${t('Temperature')}<b id="coolTemp">—</b></div><div>${t('Reported fan speed')}<b id="coolSpeed">—</b></div>
      <div>${t('Target speed')}<b id="coolTarget">—</b></div><div>${t('Speed in rpm')}<b id="coolRpm">—</b></div></div>
      <p id="coolState" class="mnote" role="status"></p>
      <div class="cool-options"><label>${t('Control mode')}<select class="field" id="coolMode"><option value="fixed">${labels.fixed}</option><option value="curve">${labels.curve}</option></select></label>
      <label>${t('Fixed speed')} (%)<input class="field" type="number" id="coolFixed" max="100" step="1"></label>
      <label>${t('Temperature hysteresis')} (°C)<input class="field" type="number" id="coolHysteresis" min="0" max="10" step="1"></label>
      <label>${t('Maximum slowdown')} (%/${t('s')})<input class="field" type="number" id="coolFall" min="1" max="20" step="1"></label></div>
      <div id="coolCurve"><svg id="coolPlot" viewBox="0 0 500 180" role="img" aria-label="${esc(t('Temperature curve'))}"></svg>
      <div id="coolPoints" class="cool-points"></div><button class="btn ghost sm" id="coolAdd">${ic('plus')}${t('Add curve point')}</button></div>
      <p class="mnote">${t('Faster cooling responds immediately. Speed decreases gradually to avoid unnecessary noise.')}</p>
      <div class="cool-buttons"><button class="btn sec" id="coolVerify">${t('Verify fan control')}</button><button class="btn pri" id="coolApply">${t('Apply')}</button>
      <button class="btn ghost" id="coolCancel">${t('Discard changes')}</button><button class="btn sec" id="coolAuto">${t('Restore automatic control')}</button></div>
      <p class="mnote">${t('Verification briefly tests the current speed and returns control to the driver. Close other fan control utilities first.')}</p>
      <p class="mnote">${t('Profiles are saved but never applied automatically at startup. Regulation continues while StellarHub is in the notification area.')}</p>
    </div><p id="coolMessage" class="mnote" role="status" aria-live="polite"></p></div></div>`;
  $('#coolRefresh').onclick = () => poll();
  $('#coolMode').onchange = e => { draft.mode = e.target.value; dirty = true; draw(); };
  for (const [id, key] of [['coolFixed', 'speed'], ['coolHysteresis', 'hysteresis'], ['coolFall', 'fallRate']]) {
    $('#' + id).oninput = e => { draft[key] = Number(e.target.value); dirty = true; };
  }
  $('#coolAdd').onclick = () => {
    if (draft.points.length >= 12) return;
    let best = 0;
    for (let i = 1; i < draft.points.length - 1; i++) if (draft.points[i + 1][0] - draft.points[i][0] > draft.points[best + 1][0] - draft.points[best][0]) best = i;
    const a = draft.points[best], b = draft.points[best + 1];
    draft.points.splice(best + 1, 0, [Math.round((a[0] + b[0]) / 2), Math.round((a[1] + b[1]) / 2)]);
    dirty = true; draw();
  };
  $('#coolCancel').onclick = () => { loadDraft(); draw(); message(''); };
  $('#coolVerify').onclick = () => command('verify');
  $('#coolApply').onclick = () => command('apply');
  $('#coolAuto').onclick = () => command('restore');
  $('#coolPlot').addEventListener('pointerdown', e => {
    const handle = e.target.closest('[data-point]'); if (!handle || pending) return;
    const index = Number(handle.dataset.point), svg = $('#coolPlot'); svg.setPointerCapture(e.pointerId);
    const move = ev => {
      const rect = svg.getBoundingClientRect();
      const temperature = Math.round(((ev.clientX - rect.left) / rect.width * 500 - 40) / 4.4);
      const speed = Math.round((145 - (ev.clientY - rect.top) / rect.height * 180) / 1.2);
      const before = draft.points[index - 1], after = draft.points[index + 1];
      draft.points[index] = [Math.max(before ? before[0] + 1 : 0, Math.min(after ? after[0] - 1 : 100, temperature)),
        Math.max(before ? before[1] : channel().minimum, Math.min(after ? after[1] : 100, speed))];
      dirty = true; draw();
    };
    svg.onpointermove = move;
    svg.onpointerup = svg.onpointercancel = () => { svg.onpointermove = null; };
    move(e);
  });
}
function loadDraft() {
  const row = channel();
  draft = copy((data.profiles || {})[selected] || defaultProfile(row.minimum));
  dirty = false;
}
function choose(key) {
  if (dirty) { message(t('Apply or discard the current changes before selecting another fan.'), true); return; }
  selected = key; loadDraft(); draw(); update();
}
function draw() {
  if (!draft) return;
  $('#coolMode').value = draft.mode; $('#coolFixed').value = draft.speed;
  $('#coolFixed').min = channel().minimum;
  $('#coolFixed').disabled = draft.mode !== 'fixed' || pending;
  $('#coolHysteresis').value = draft.hysteresis; $('#coolFall').value = draft.fallRate;
  $('#coolCurve').hidden = draft.mode !== 'curve';
  const svg = $('#coolPlot'), points = draft.points;
  svg.innerHTML = [0, 25, 50, 75, 100].map(n => `<path class="cool-grid" d="M40 ${145 - n * 1.2}H480"/><text x="4" y="${149 - n * 1.2}">${n}%</text>`).join('') +
    [0, 25, 50, 75, 100].map(n => `<text x="${40 + n * 4.4}" y="173" text-anchor="middle">${n}°C</text>`).join('') +
    `<polyline class="cool-line" points="${points.map(([x,y]) => `${40+x*4.4},${145-y*1.2}`).join(' ')}"/>` +
    points.map(([x,y], i) => `<circle class="cool-handle" data-point="${i}" cx="${40+x*4.4}" cy="${145-y*1.2}" r="5"/>`).join('');
  $('#coolPoints').innerHTML = points.map(([temperature, speed], i) => `<div class="cool-point"><label>${t('Temperature')} (°C)<input class="field" type="number" min="0" max="100" step="1" data-index="${i}" data-axis="0" value="${temperature}"></label>
    <label>${t('Fan speed')} (%)<input class="field" type="number" min="${channel().minimum}" max="100" step="1" data-index="${i}" data-axis="1" value="${speed}"></label>
    <button class="btn ghost sm" data-remove="${i}" aria-label="${esc(t('Remove curve point'))}" ${points.length <= 2 ? 'disabled' : ''}>${ic('x')}</button></div>`).join('');
  $('#coolPoints').querySelectorAll('input').forEach(el => { el.onchange = () => { draft.points[+el.dataset.index][+el.dataset.axis] = Number(el.value); dirty = true; draw(); }; });
  $('#coolPoints').querySelectorAll('[data-remove]').forEach(el => { el.onclick = () => { draft.points.splice(+el.dataset.remove, 1); dirty = true; draw(); }; });
}
function update() {
  const rows = data.channels || [], row = channel();
  const list = $('#coolChannels');
  const signature = JSON.stringify([selected, rows.map(r => [r.id, r.name, r.mode])]);
  if (list.dataset.signature !== signature) {
    list.dataset.signature = signature;
    list.innerHTML = rows.map(r => `<button class="row cool-channel ${r.id === selected ? 'selected' : ''}" data-id="${esc(r.id)}"><span class="rt"><b>${esc(r.name)} · ${t('Fan')} ${r.fan}</b><span>${esc(r.source)}</span></span><span class="chip">${esc(labels[r.mode] || labels.auto)}</span></button>`).join('');
    list.querySelectorAll('[data-id]').forEach(el => { el.onclick = () => choose(el.dataset.id); });
  }
  $('#coolDetails').hidden = !row;
  $('#coolEmpty').hidden = !!row;
  if (!row) {
    $('#coolEmpty').innerHTML = SH.emptyState({ art: data.error ? 'error' : data.starting ? 'first' : 'none', title: data.error ? t('Cooling controller unavailable') : data.starting ? t('Detecting fan controllers…') : t('No supported fan controller found'),
      text: data.error ? esc(data.error) : t('This version supports compatible NVIDIA fans through the installed driver. Laptop CPU fans and motherboard controllers require a separate hardware adapter. No fan settings have been changed.') });
  } else {
    root.querySelectorAll('input,select,#coolAdd,[data-remove]').forEach(el => { el.disabled = pending; });
    $('#coolFixed').disabled = pending || (draft && draft.mode !== 'fixed');
    $('#coolHysteresis').disabled = pending || (draft && draft.mode !== 'curve');
    $('#coolName').textContent = `${row.name} · ${t('Fan')} ${row.fan}`;
    $('#coolSource').textContent = `${row.source} · ${t('Minimum speed')}: ${row.minimum}% · ${t('Thermal safeguard')}: ${row.critical} °C`;
    const stale = data.stale || row.error;
    $('#coolTemp').textContent = stale ? '—' : `${row.temperature} °C`;
    $('#coolSpeed').textContent = stale ? '—' : `${row.speed}%`;
    $('#coolTarget').textContent = row.target == null ? '—' : `${row.target}%`;
    $('#coolRpm').textContent = row.rpm == null ? t('Not reported') : `${row.rpm}`;
    $('#coolState').textContent = row.error || (data.stale ? t('Sensor data is stale.') : row.verified ? t('Fan control verified for this session.') : t('Verify support before enabling manual control.'));
    $('#coolVerify').disabled = pending || !!stale || !!row.target;
    $('#coolApply').disabled = pending || !row.verified || !!stale;
    $('#coolAuto').disabled = pending;
    $('#coolCancel').disabled = pending;
  }
  if (data.error) message(data.error, true);
}
async function poll() {
  if (polling) return;
  polling = true;
  const token = generation;
  try {
    const next = await engine('status');
    if (token !== generation) return;
    data = next || { channels: [] };
    if (!channel() && (data.channels || []).length) { selected = data.channels[0].id; loadDraft(); draw(); }
    update();
  } catch (error) { if (token === generation) message(t('Unable to read cooling status.') + ' ' + error.message, true); }
  finally { polling = false; }
}
async function command(op) {
  if (pending) return;
  if (op !== 'restore' && !SH.requireAdmin('to control fans.')) return;
  pending = true; update();
  try {
    const result = await engine(op, selected, ...(op === 'apply' ? [copy(draft)] : []));
    if (op === 'apply') dirty = false;
    message(result.warning || (op === 'restore' ? t('Automatic fan control restored.') : op === 'verify' ? t('Fan control verified for this session.') : t('Cooling profile applied.')));
    await poll();
  } catch (error) { message(t('Cooling command failed.') + ' ' + error.message, true); }
  finally { pending = false; update(); }
}
SH.cooling = { render, enter() { generation++; poll(); clearInterval(timer); timer = setInterval(poll, 2000); },
  leave() { generation++; clearInterval(timer); timer = null; if (root && !pending) SH.engine('cooling', 'release_idle').catch(() => {}); } };
SH.actions.add([{ t: t('Configure fan cooling'), go: 'monitor', tab: 'cooling', ic: 'monitor' }]);
})();
