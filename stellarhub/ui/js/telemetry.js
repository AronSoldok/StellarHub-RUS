/* StellarHub · telemetría compartida.
   Dentro de la app los datos son REALES: Python los manda con SH.tele.push({...}) (stellarhub/engine/telemetry.py).
   Fuera de la app (navegador, pruebas) se simulan para poder diseñar.
   Lo que Windows no da llega como null: la interfaz debe mostrar "—" (usa SH.tele.fmt / SH.tele.has).
   Uso: SH.tele.v (valores actuales), SH.tele.hist[clave] (últimos 120), SH.tele.on(fn) (cada actualización). */
'use strict';
(() => {
const rw = (v, lo, hi, j) => Math.max(lo, Math.min(hi, v + (Math.random() - .5) * j));
const v = {
  cpu: 14, cpuTemp: 61, cpuFreq: 3.9, threads: Array.from({ length: 24 }, () => .15),
  gpu: 8, gpuTemp: 52, gpuPower: 30, gpuClock: 1.2, vram: 3.1, vramTotal: 8, igpu: 4,
  ram: 9.4, ramTotal: 15.6, ramCache: 3.2, ramCommit: 14.1, procs: 280,
  diskRead: 40, diskWrite: 12, diskUsed: 592, diskTotal: 953, diskTemp: 41,
  down: 12, up: 1.4, ping: 18, wifiSignal: 82,
  battery: 100, charging: true, batteryPower: 0, batteryHealth: 97, fanCpu: 2600, fanGpu: 2400,
  uptime: 3 * 3600 + 1240,
};
const KEYS = ['cpu', 'cpuTemp', 'cpuFreq', 'gpu', 'gpuTemp', 'gpuPower', 'vram', 'ram', 'diskRead', 'diskWrite', 'down', 'up', 'ping', 'battery', 'batteryPower'];
const hist = {}; KEYS.forEach(k => hist[k] = Array(120).fill(v[k] ?? 0));
const subs = new Set();
const emit = () => subs.forEach(fn => { try { fn(v); } catch (e) { console.error(e); } });
const record = () => KEYS.forEach(k => { hist[k].push(v[k] ?? 0); hist[k].shift(); });

/* ---------- simulación (solo fuera de la app) ---------- */
let burst = 0;
function tick() {
  if (Math.random() < .07) burst = 5;
  const b = burst > 0 ? (burst--, 26) : 0;
  v.cpu = Math.max(2, Math.min(99, rw(v.cpu * .85 + 12 * .15, 3, 96, 14) + b * .6));
  v.gpu = Math.max(0, Math.min(99, rw(v.gpu * .88 + 10 * .12, 1, 98, 12) + b));
  v.gpuTemp = rw(46 + v.gpu * .38, 38, 87, 2); v.gpuPower = rw(14 + v.gpu * 1.1, 6, 115, 4); v.gpuClock = rw(.9 + v.gpu / 100 * 1.6, .3, 2.6, .1);
  v.cpuFreq = rw(2.6 + v.cpu / 100 * 2.4, 2.2, 5.2, .2); v.cpuTemp = rw(50 + v.cpu * .34, 42, 94, 2);
  v.vram = rw(v.vram, 2.4, 6.8, .3); v.ram = rw(v.ram, 8.6, 11.8, .25); v.ramCommit = v.ram + 4.6; v.igpu = rw(v.igpu, 1, 30, 4);
  v.down = Math.max(.2, rw(v.down, .2, 180, Math.random() < .15 ? 90 : 10)); v.up = rw(v.up, .1, 24, 2); v.ping = rw(v.ping, 9, 60, 6);
  v.diskRead = rw(v.diskRead, 0, 900, Math.random() < .12 ? 600 : 40); v.diskWrite = rw(v.diskWrite, 0, 500, Math.random() < .1 ? 300 : 20);
  v.threads = v.threads.map((t, i) => Math.max(.02, Math.min(1, v.cpu / 100 + (Math.random() - .5) * .5 + (i < 16 ? .08 : -.04))));
  v.fanCpu = Math.round(rw(1800 + v.cpu * 32, 0, 5600, 120)); v.fanGpu = Math.round(rw(1700 + v.gpu * 34, 0, 5600, 120));
  v.uptime += .7;
  record(); emit();
}
let timer = setInterval(tick, 700);

/* ---------- real ---------- */
function goReal() {
  if (!SH.tele.simulated) return;
  SH.tele.simulated = false; clearInterval(timer); timer = null;
  ['cpuTemp', 'fanCpu', 'fanGpu', 'wifiSignal', 'diskTemp', 'igpu'].forEach(k => { v[k] = null; });
}
function push(d) {
  goReal();
  for (const k in d) v[k] = d[k];
  record(); emit();
}
const has = k => v[k] !== null && v[k] !== undefined;
/* formatea o devuelve "—" si Windows no da ese dato */
const fmt = (k, f = x => Math.round(x)) => has(k) ? f(v[k]) : '—';
SH.tele = {
  v, hist, has, fmt, push, simulated: true,
  on(fn) { subs.add(fn); return () => subs.delete(fn); },
  setRate(ms) { SH.call('tele_rate', ms); if (timer) { clearInterval(timer); timer = setInterval(tick, Math.max(250, ms * .7)); } },
};
/* dentro de la app: real desde el primer momento (aunque la primera muestra tarde un poco) */
SH.apiReady.then(a => { if (a) goReal(); });
SH.on && SH.on('boot', () => SH.tele.setRate(+(SH.state.settings.teleRate || 1000)));
})();
