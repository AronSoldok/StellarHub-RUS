/* StellarHub · Autopilot: rutinas de mantenimiento automático.
   Empieza vacío. Cada rutina = Cuándo (disparadores) → Solo si (condiciones) → Qué hace (acciones en orden) → Después → Avisos.
   Se guarda en los ajustes (autopilotRoutines, autopilotLog, autopilotNotify). La ejecución todavía es simulada. */
'use strict';
(() => {
const { $, $$, anim, EASE, ic, esc, fmt1, state } = SH;
const wait = ms => new Promise(r => setTimeout(r, ms));
SH.icons.add({
  drag: '<path d="M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01"/>',
  up: '<path d="m6 15 6-6 6 6"/>', down: '<path d="m6 9 6 6 6-6"/>',
  dup: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5.5A1.5 1.5 0 0 0 14.5 4h-9A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H8"/>',
  plug: '<path d="M9 3v5M15 3v5M6.5 8h11v3a5.5 5.5 0 0 1-11 0zM12 16.5V21"/>', moon: '<path d="M19.5 14.5A8 8 0 0 1 9.5 4.5a8 8 0 1 0 10 10z"/>',
  gamepad: '<rect x="2.5" y="7" width="19" height="11" rx="5.5"/><path d="M7 11v3M5.5 12.5h3M15.5 11.5h.01M17.5 13.5h.01"/>',
  flask: '<path d="M9.5 3h5M10.5 3v6L5 19a1.5 1.5 0 0 0 1.3 2h11.4a1.5 1.5 0 0 0 1.3-2L13.5 9V3"/><path d="M7.5 15h9"/>',
});

/* ================= utilidades de texto y fecha ================= */
const DAYS = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
const DAYN = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];
const DAYP = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábados', 'domingos'];
const DAYS3 = ['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom'];
const MONL = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const MON3 = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const pad = n => String(n).padStart(2, '0');
const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const tomorrow = () => { const d = new Date(); d.setDate(d.getDate() + 1); return iso(d); };
const fmtDate = s => { if (!s) return 'una fecha sin elegir'; const [, m, d] = s.split('-').map(Number); return `${d} de ${MONL[m - 1]}`; };
const cap = s => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
const join = (a, c = ' y ') => a.length <= 1 ? (a[0] || '') : a.slice(0, -1).join(', ') + c + a[a.length - 1];
const norm = s => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const clone = o => JSON.parse(JSON.stringify(o));
function daysText(days) {
  const d = [...days].sort((a, b) => a - b);
  if (!d.length) return 'ningún día';
  if (d.length === 7) return 'cada día';
  if (d.length === 5 && d.every((x, i) => x === i)) return 'de lunes a viernes';
  if (d.length === 2 && d[0] === 5 && d[1] === 6) return 'los fines de semana';
  return d.length === 1 ? 'cada ' + DAYN[d[0]] : 'los ' + join(d.map(i => DAYP[i]));
}
function relDay(d) {
  const a = new Date(); a.setHours(0, 0, 0, 0); const b = new Date(d); b.setHours(0, 0, 0, 0); const diff = Math.round((b - a) / 864e5);
  return diff === 0 ? 'hoy' : diff === 1 ? 'mañana' : diff > 1 && diff < 7 ? 'el ' + DAYN[(d.getDay() + 6) % 7] : `el ${d.getDate()} de ${MONL[d.getMonth()]}`;
}
function pastDay(d) {
  const a = new Date(); a.setHours(0, 0, 0, 0); const b = new Date(d); b.setHours(0, 0, 0, 0); const diff = Math.round((a - b) / 864e5);
  return diff === 0 ? 'Hoy' : diff === 1 ? 'Ayer' : diff < 7 ? cap('el ' + DAYN[(d.getDay() + 6) % 7]) : `${d.getDate()} de ${MONL[d.getMonth()]}`;
}
const hm = d => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

/* ================= catálogos ================= */
const APPS = ['Steam', 'Epic Games', 'FL Studio', 'Brave', 'Discord', 'OBS Studio', 'Medal', 'Spotify', 'OneDrive', 'Cualquier juego'];
const CLEAN = ['Temporales de Windows', 'Temporales del usuario', 'Cachés de navegadores', 'Miniaturas', 'Volcados de errores', 'Restos de Windows Update', 'Optimización de distribución', 'Cachés de sombreadores', 'Registros antiguos', 'Restos de programas'];
const DRIVES = [['C:', 'C:'], ['D:', 'D:']];
const opts = o => o.map(x => Array.isArray(x) ? x : [x, x]);
const num = (def, min, max, unit, label, step) => ({ type: 'num', def, min, max, unit, label, step });

const TRIG = [
  ['Fecha y hora', [
    { k: 'once', t: 'Una sola vez', ic: 'calendar', sched: 1, p: { date: { type: 'date', def: tomorrow, label: 'El día' }, time: { type: 'time', def: '10:00', label: 'a las' } }, say: p => `el ${fmtDate(p.date)} a las ${p.time}` },
    { k: 'daily', t: 'Cada día', ic: 'clock', sched: 1, p: { time: { type: 'time', def: '09:00', label: 'A las' } }, say: p => `cada día a las ${p.time}` },
    { k: 'weekdays', t: 'Días concretos de la semana', ic: 'calendar', sched: 1, p: { days: { type: 'days', def: [6] }, time: { type: 'time', def: '10:00', label: 'a las' } }, say: p => `${daysText(p.days)} a las ${p.time}` },
    { k: 'everyN', t: 'Cada cierto número de horas', ic: 'restore', sched: 1, p: { hours: num(6, 1, 72, 'h', 'Cada') }, say: p => `cada ${p.hours} ${+p.hours === 1 ? 'hora' : 'horas'}` },
    { k: 'monthly', t: 'Una vez al mes', ic: 'calendar', sched: 1, p: {
        mode: { type: 'select', def: 'day', opts: [['day', 'El día'], ['first', 'El primer'], ['last', 'El último']] },
        day: { ...num(1, 1, 28, ''), show: p => p.mode === 'day' },
        weekday: { type: 'select', def: '0', opts: DAYN.map((d, i) => [String(i), d]), show: p => p.mode !== 'day' },
        time: { type: 'time', def: '09:00', label: 'a las' } },
      say: p => p.mode === 'day' ? `el día ${p.day} de cada mes a las ${p.time}` : `el ${p.mode === 'first' ? 'primer' : 'último'} ${DAYN[+p.weekday]} de cada mes a las ${p.time}` },
  ]],
  ['Sesión y sistema', [
    { k: 'boot', t: 'Al iniciar Windows', ic: 'power', p: { delay: num(2, 0, 30, 'min', 'Esperar') }, say: p => `al iniciar Windows${+p.delay ? ` (tras ${p.delay} min)` : ''}` },
    { k: 'login', t: 'Al iniciar sesión', ic: 'user', say: () => 'al iniciar sesión' },
    { k: 'lock', t: 'Al bloquear el PC', ic: 'lock', say: () => 'al bloquear el PC' },
    { k: 'unlock', t: 'Al desbloquear el PC', ic: 'lock', say: () => 'al desbloquear el PC' },
    { k: 'idle', t: 'Tras un rato sin usarlo', ic: 'moon', p: { min: num(15, 1, 240, 'min', 'Tras') }, say: p => `tras ${p.min} min sin usar el PC` },
    { k: 'shutdown', t: 'Al apagar', ic: 'power', say: () => 'al apagar el PC' },
  ]],
  ['Energía', [
    { k: 'plugIn', t: 'Al enchufar el cargador', ic: 'plug', say: () => 'al enchufar el cargador' },
    { k: 'plugOut', t: 'Al desenchufar el cargador', ic: 'battery', say: () => 'al desenchufar el cargador' },
    { k: 'batteryBelow', t: 'Batería por debajo de un nivel', ic: 'battery', p: { pct: num(20, 5, 95, '%', 'Por debajo del', 5) }, say: p => `cuando la batería baja del ${p.pct} %` },
  ]],
  ['Discos y archivos', [
    { k: 'diskBelow', t: 'Poco espacio libre en un disco', ic: 'ssd', p: { drive: { type: 'select', def: 'C:', opts: DRIVES, label: 'Disco' }, gb: num(50, 5, 500, 'GB', 'con menos de', 5) }, say: p => `cuando ${p.drive} tiene menos de ${p.gb} GB libres` },
    { k: 'download', t: 'Al terminar una descarga', ic: 'download', p: { folder: { type: 'text', def: 'Descargas', label: 'En la carpeta', ph: 'Descargas' } }, say: p => `al terminar una descarga en ${p.folder || 'una carpeta'}` },
  ]],
  ['Novedades', [
    { k: 'newDrivers', t: 'Hay drivers nuevos', ic: 'drivers', say: () => 'cuando aparecen drivers nuevos' },
    { k: 'newUpdates', t: 'Hay programas por actualizar', ic: 'updater', say: () => 'cuando hay programas por actualizar' },
  ]],
  ['Red', [
    { k: 'wifi', t: 'Al conectarse a una red Wi-Fi', ic: 'wifi', p: { ssid: { type: 'text', def: 'Casa', label: 'Red', ph: 'Nombre de la red' } }, say: p => `al conectarse a «${p.ssid || 'una red'}»` },
  ]],
  ['Programas', [
    { k: 'appOpen', t: 'Al abrir un programa', ic: 'play', p: { app: { type: 'select', def: 'Steam', opts: APPS } }, say: p => `al abrir ${p.app}` },
    { k: 'appClose', t: 'Al cerrar un programa', ic: 'stop', p: { app: { type: 'select', def: 'Steam', opts: APPS } }, say: p => `al cerrar ${p.app}` },
  ]],
  ['Rendimiento y temperatura', [
    { k: 'temp', t: 'Temperatura alta', ic: 'temp', p: { sensor: { type: 'select', def: 'gpu', opts: [['cpu', 'Procesador'], ['gpu', 'Gráfica']] }, deg: num(85, 60, 100, '°C', 'por encima de'), min: num(3, 1, 30, 'min', 'durante') },
      say: p => `si ${p.sensor === 'cpu' ? 'el procesador' : 'la gráfica'} pasa de ${p.deg} °C durante ${p.min} min` },
    { k: 'ram', t: 'Memoria casi llena', ic: 'ram', p: { pct: num(90, 50, 98, '%', 'Por encima del'), min: num(2, 1, 30, 'min', 'durante') }, say: p => `si la memoria pasa del ${p.pct} % durante ${p.min} min` },
  ]],
];
const COND = [
  ['Energía', [
    { k: 'plugged', t: 'Está enchufado', ic: 'plug', say: () => 'está enchufado' },
    { k: 'battery', t: 'Batería suficiente', ic: 'battery', p: { pct: num(50, 10, 100, '%', 'Al menos al', 5) }, say: p => `la batería está al ${p.pct} % o más` },
  ]],
  ['Uso del PC', [
    { k: 'idle', t: 'No lo estás usando', ic: 'moon', p: { min: num(5, 1, 120, 'min', 'Desde hace') }, say: p => `no lo usas desde hace ${p.min} min` },
    { k: 'noFull', t: 'Nada a pantalla completa', ic: 'gamepad', say: () => 'no hay un juego ni un vídeo a pantalla completa' },
    { k: 'cpu', t: 'El procesador está tranquilo', ic: 'cpu', p: { pct: num(30, 5, 90, '%', 'Por debajo del', 5) }, say: p => `el procesador va por debajo del ${p.pct} %` },
    { k: 'noMeeting', t: 'No hay una llamada en curso', ic: 'mic', say: () => 'no estás en una llamada' },
  ]],
  ['Horario', [
    { k: 'window', t: 'Dentro de una franja horaria', ic: 'clock', p: { from: { type: 'time', def: '22:00', label: 'De' }, to: { type: 'time', def: '08:00', label: 'a' } }, say: p => `son entre las ${p.from} y las ${p.to}` },
    { k: 'days', t: 'Solo ciertos días', ic: 'calendar', p: { days: { type: 'days', def: [0, 1, 2, 3, 4] } }, say: p => `es ${daysText(p.days).replace(/^cada /, '')}` },
  ]],
  ['Red', [
    { k: 'unmetered', t: 'La conexión no es de uso medido', ic: 'globe', say: () => 'la conexión no es de uso medido' },
    { k: 'onWifi', t: 'Conectado a una Wi-Fi concreta', ic: 'wifi', p: { ssid: { type: 'text', def: 'Casa', label: 'Red', ph: 'Nombre de la red' } }, say: p => `estás en la Wi-Fi «${p.ssid || '…'}»` },
  ]],
  ['Espacio', [
    { k: 'junk', t: 'Hay bastante basura', ic: 'broom', p: { gb: num(5, 1, 100, 'GB', 'Al menos') }, say: p => `hay ${p.gb} GB de basura o más` },
    { k: 'diskFree', t: 'Queda poco espacio', ic: 'ssd', p: { drive: { type: 'select', def: 'C:', opts: DRIVES, label: 'Disco' }, gb: num(100, 5, 900, 'GB', 'con menos de', 5) }, say: p => `${p.drive} tiene menos de ${p.gb} GB libres` },
  ]],
  ['Sistema', [
    { k: 'admin', t: 'Hay permisos de administrador', ic: 'shield', say: () => 'StellarHub está en modo administrador' },
    { k: 'notSince', t: 'No se ejecutó hace poco', ic: 'restore', p: { hours: num(24, 1, 720, 'h', 'En las últimas') }, say: p => `no se ejecutó en las últimas ${p.hours} h` },
    { k: 'app', t: 'Un programa está abierto o cerrado', ic: 'grid', p: { app: { type: 'select', def: 'FL Studio', opts: APPS }, st: { type: 'select', def: 'closed', opts: [['closed', 'está cerrado'], ['open', 'está abierto']] } }, say: p => `${p.app} ${p.st === 'open' ? 'está abierto' : 'está cerrado'}` },
  ]],
];
const ACT = [
  ['Limpieza', [
    { k: 'clean', t: 'Limpiar temporales y cachés', ic: 'broom', mod: 'Super Optimizer', est: 90, p: { cats: { type: 'multi', def: CLEAN.slice(0, 6), opts: CLEAN } }, say: p => p.cats.length === CLEAN.length ? 'limpiar todo lo que sobra' : `limpiar ${p.cats.length} ${p.cats.length === 1 ? 'categoría' : 'categorías'}` },
    { k: 'recycle', t: 'Vaciar la papelera', ic: 'trash', mod: 'Super Optimizer', est: 10, say: () => 'vaciar la papelera' },
    { k: 'oldDl', t: 'Retirar descargas antiguas', ic: 'download', mod: 'Super Optimizer', est: 20, p: { days: num(30, 7, 365, 'días', 'Más viejas de'), to: { type: 'select', def: 'bin', opts: [['bin', 'a la papelera'], ['quar', 'a la cuarentena']], label: 'Moverlas' } }, say: p => `mover ${p.to === 'bin' ? 'a la papelera' : 'a la cuarentena'} las descargas de más de ${p.days} días` },
    { k: 'quar', t: 'Vaciar la cuarentena', ic: 'restore', mod: 'Program Remover', est: 15, p: { age: num(14, 0, 90, 'días', 'Lo que tenga más de') }, say: p => `vaciar de la cuarentena lo que tenga más de ${p.age} días` },
    { k: 'dupes', t: 'Buscar archivos duplicados', ic: 'copy', mod: 'Storage Checker', est: 240, p: { min: num(50, 1, 2000, 'MB', 'Mayores de', 10) }, say: p => `buscar duplicados de más de ${p.min} MB` },
  ]],
  ['Drivers', [
    { k: 'drvScan', t: 'Buscar drivers nuevos', ic: 'drivers', mod: 'Driver Updater', est: 60, say: () => 'buscar drivers nuevos' },
    { k: 'drvInstall', t: 'Instalar drivers', ic: 'download', mod: 'Driver Updater', admin: 1, est: 300, p: { mode: { type: 'select', def: 'ask', opts: [['ask', 'Preguntarme antes'], ['rec', 'Solo los recomendados'], ['all', 'Todos los nuevos']] } }, decide: p => p.mode === 'ask', say: p => p.mode === 'ask' ? 'preparar los drivers nuevos y preguntarte' : `instalar ${p.mode === 'rec' ? 'los drivers recomendados' : 'todos los drivers nuevos'}` },
    { k: 'drvBackup', t: 'Copia de seguridad de los drivers', ic: 'package', mod: 'Driver Updater', est: 120, p: { keep: num(3, 1, 20, 'copias', 'Guardar las últimas') }, say: p => `copiar los drivers (guardando ${p.keep} ${+p.keep === 1 ? 'copia' : 'copias'})` },
  ]],
  ['Actualizaciones', [
    { k: 'apps', t: 'Actualizar programas', ic: 'updater', mod: 'Program Updater', est: 240, p: { scope: { type: 'select', def: 'all', opts: [['all', 'Todos'], ['sec', 'Solo los de seguridad'], ['list', 'Solo algunos']], label: 'Cuáles' }, list: { type: 'multi', def: ['Brave', 'Discord'], opts: APPS.slice(0, 9), show: p => p.scope === 'list' } },
      say: p => p.scope === 'all' ? 'actualizar todos los programas' : p.scope === 'sec' ? 'instalar las actualizaciones de seguridad' : `actualizar ${join(p.list || []) || 'los programas que elijas'}` },
    { k: 'winUpd', t: 'Windows Update', ic: 'windows', mod: 'Program Updater', admin: 1, est: 600, p: { mode: { type: 'select', def: 'search', opts: [['search', 'Solo buscar'], ['download', 'Buscar y descargar'], ['install', 'Instalar']] } }, say: p => ({ search: 'buscar actualizaciones de Windows', download: 'descargar las actualizaciones de Windows', install: 'instalar las actualizaciones de Windows' })[p.mode] },
    { k: 'store', t: 'Actualizar las apps de la Tienda', ic: 'store', mod: 'Program Updater', est: 120, say: () => 'actualizar las apps de la Tienda' },
    { k: 'defender', t: 'Actualizar las firmas de Defender', ic: 'shield', mod: 'Program Updater', est: 30, say: () => 'actualizar las firmas de Defender' },
  ]],
  ['Mantenimiento de Windows', [
    { k: 'restore', t: 'Crear un punto de restauración', ic: 'restore', mod: 'Super Optimizer', admin: 1, est: 45, say: () => 'crear un punto de restauración' },
    { k: 'sfc', t: 'Comprobar los archivos de Windows', ic: 'shield', mod: 'Super Optimizer', admin: 1, est: 900, p: { kind: { type: 'select', def: 'sfc', opts: [['sfc', 'SFC'], ['dism', 'DISM'], ['both', 'SFC y DISM']] } }, say: p => `comprobar Windows con ${p.kind === 'both' ? 'SFC y DISM' : p.kind.toUpperCase()}` },
    { k: 'net', t: 'Reparar la red', ic: 'globe', mod: 'Super Optimizer', est: 20, p: { kind: { type: 'select', def: 'dns', opts: [['dns', 'Vaciar la caché DNS'], ['full', 'Reinicio completo de red']] } }, say: p => p.kind === 'dns' ? 'vaciar la caché DNS' : 'reiniciar la red por completo' },
    { k: 'explorer', t: 'Reiniciar el Explorador', ic: 'folder', mod: 'Super Optimizer', est: 5, say: () => 'reiniciar el Explorador' },
    { k: 'scanDisk', t: 'Analizar un disco', ic: 'storage', mod: 'Storage Checker', est: 60, p: { drive: { type: 'select', def: 'C:', opts: DRIVES, label: 'Disco' }, gb: num(10, 1, 200, 'GB', 'Avisar si creció más de') }, say: p => `analizar ${p.drive} y avisar si creció más de ${p.gb} GB` },
  ]],
  ['Rendimiento', [
    { k: 'plan', t: 'Cambiar el plan de energía', ic: 'optimizer', mod: 'Super Optimizer', est: 2, p: { plan: { type: 'select', def: 'high', opts: [['saver', 'Ahorro'], ['balanced', 'Equilibrado'], ['high', 'Alto rendimiento'], ['max', 'Máximo']] } }, say: p => `poner el plan ${({ saver: 'de ahorro', balanced: 'equilibrado', high: 'de alto rendimiento', max: 'máximo' })[p.plan]}` },
    { k: 'game', t: 'Modo juego', ic: 'gamepad', mod: 'Super Optimizer', est: 2, p: { on: { type: 'select', def: 'on', opts: [['on', 'Activar'], ['off', 'Desactivar']] } }, say: p => `${p.on === 'on' ? 'activar' : 'desactivar'} el modo juego` },
    { k: 'closeApp', t: 'Cerrar un programa', ic: 'x', mod: 'Sistema', est: 3, p: { app: { type: 'select', def: 'OneDrive', opts: APPS } }, say: p => `cerrar ${p.app}` },
    { k: 'openApp', t: 'Abrir un programa o archivo', ic: 'external', mod: 'Sistema', est: 3, p: { path: { type: 'text', def: '', label: 'Ruta', ph: 'C:\\Program Files\\…' } }, say: p => p.path ? `abrir ${p.path.split(/[\\/]/).pop()}` : 'abrir un programa' },
    { k: 'cmd', t: 'Ejecutar un comando o script', ic: 'code', mod: 'Sistema', est: 10, p: { cmd: { type: 'text', def: '', label: 'Comando', ph: 'powershell -File limpieza.ps1' }, as: { type: 'select', def: 'user', opts: [['user', 'Como tu usuario'], ['admin', 'Como administrador']] } }, say: p => p.cmd ? `ejecutar «${p.cmd.length > 30 ? p.cmd.slice(0, 30) + '…' : p.cmd}»` : 'ejecutar un comando' },
  ]],
  ['StellarHub y avisos', [
    { k: 'widget', t: 'Abrir o cerrar el widget', ic: 'monitor', mod: 'StellarHub', est: 1, p: { st: { type: 'select', def: 'open', opts: [['open', 'Abrirlo'], ['close', 'Cerrarlo']] } }, say: p => `${p.st === 'open' ? 'abrir' : 'cerrar'} el widget` },
    { k: 'mute', t: 'Silenciar las notificaciones', ic: 'bell', mod: 'Windows', est: 1, p: { min: num(60, 5, 480, 'min', 'Durante', 5) }, say: p => `silenciar las notificaciones ${p.min} min` },
  ]],
  ['Control y energía', [
    { k: 'wait', t: 'Esperar antes de seguir', ic: 'clock', mod: 'Control', est: 0, p: { min: num(5, 1, 120, 'min', 'Esperar') }, say: p => `esperar ${p.min} min` },
    { k: 'power', t: 'Suspender, reiniciar o apagar', ic: 'power', mod: 'Windows', est: 0, p: { what: { type: 'select', def: 'sleep', opts: [['sleep', 'Suspender'], ['restart', 'Reiniciar'], ['off', 'Apagar']] }, count: num(60, 0, 600, 's', 'Cuenta atrás', 10) },
      say: p => `${({ sleep: 'suspender', restart: 'reiniciar', off: 'apagar' })[p.what]} el PC${+p.count ? ` (con ${p.count} s para cancelar)` : ''}` },
  ]],
];
const CAT = { t: TRIG, c: COND, a: ACT };
const byK = { t: {}, c: {}, a: {} };
Object.entries(CAT).forEach(([s, groups]) => groups.forEach(([g, items]) => items.forEach(d => { d.g = g; byK[s][d.k] = d; })));
const sayOf = (s, x) => { const d = byK[s][x.k]; return d ? d.say(x.p) : ''; };
function newItem(s, k, over) {
  const d = byK[s][k]; const p = {};
  Object.entries(d.p || {}).forEach(([n, spec]) => { p[n] = typeof spec.def === 'function' ? spec.def() : clone(spec.def); });
  return { k, p: { ...p, ...(over || {}) } };
}

/* ================= rutinas y estado ================= */
const COLORS = ['var(--accent2)', 'var(--accent)', 'var(--ok)', 'var(--warn)', '#C9A7FF', '#FF8FB1'];
const NOTD = { when: 'decide', toast: true, tray: true, sound: false, weekly: true };
const AFTERD = { onFail: 'continue', retries: 2, tomorrow: true, limit: 60, report: true, okThen: 'none', failThen: 'none', okRoutine: '', failRoutine: '' };
let uid = Date.now() % 100000;
const mk = o => ({ id: 'r' + (uid++), on: true, name: 'Nueva rutina', color: 0, priority: 'normal', pausedUntil: '', triggers: [], condMode: 'all', conds: [], acts: [],
  after: { ...AFTERD }, notify: { ...NOTD }, ...o });
const T = (k, p) => newItem('t', k, p), C = (k, p) => newItem('c', k, p), A = (k, p) => newItem('a', k, p);
const TEMPLATES = [
  { n: 'Mantenimiento semanal', d: 'Los domingos a las 10: punto de restauración, limpieza, drivers y programas.', ic: 'sparkle',
    r: () => mk({ name: 'Mantenimiento semanal', color: 0, triggers: [T('weekdays', { days: [6], time: '10:00' })], conds: [C('plugged'), C('noFull')], acts: [A('restore'), A('clean'), A('drvScan'), A('apps')] }) },
  { n: 'Cuando falte espacio', d: 'Si a C: le quedan menos de 50 GB: limpieza a fondo, papelera y descargas viejas.', ic: 'ssd',
    r: () => mk({ name: 'Liberar espacio', color: 1, triggers: [T('diskBelow')], acts: [A('clean', { cats: [...CLEAN] }), A('recycle'), A('oldDl')], notify: { ...NOTD, when: 'always' } }) },
  { n: 'Modo noche', d: 'A las 3 con el PC enchufado: Windows y programas al día, y luego suspender.', ic: 'moon',
    r: () => mk({ name: 'Modo noche', color: 4, triggers: [T('daily', { time: '03:00' })], conds: [C('plugged'), C('idle', { min: 30 })], acts: [A('restore'), A('winUpd', { mode: 'install' }), A('apps'), A('power', { what: 'sleep', count: 120 })], notify: { ...NOTD, when: 'errors' } }) },
  { n: 'Antes de jugar', d: 'Al abrir Steam: alto rendimiento, modo juego y notificaciones en silencio.', ic: 'gamepad',
    r: () => mk({ name: 'Antes de jugar', color: 3, triggers: [T('appOpen', { app: 'Steam' })], acts: [A('plan', { plan: 'high' }), A('game'), A('closeApp', { app: 'OneDrive' }), A('mute', { min: 180 })], notify: { ...NOTD, when: 'never' } }) },
  { n: 'Al desenchufar', d: 'Sin cargador: plan de ahorro y fuera lo que gasta batería en segundo plano.', ic: 'battery',
    r: () => mk({ name: 'Ahorro con batería', color: 2, triggers: [T('plugOut')], acts: [A('plan', { plan: 'saver' }), A('closeApp', { app: 'OneDrive' }), A('widget', { st: 'close' })], notify: { ...NOTD, when: 'never' } }) },
  { n: 'Drivers el primer lunes', d: 'El primer lunes de cada mes: copia de los drivers y búsqueda de nuevos.', ic: 'drivers',
    r: () => mk({ name: 'Drivers del mes', color: 5, triggers: [T('monthly', { mode: 'first', weekday: '0', time: '09:00' })], conds: [C('plugged')], acts: [A('drvBackup'), A('drvScan'), A('drvInstall')] }) },
  { n: 'Vigilar el calor', d: 'Si la gráfica pasa de 85 °C durante 3 minutos, baja el plan de energía y te avisa.', ic: 'temp',
    r: () => mk({ name: 'Vigilar el calor', color: 1, triggers: [T('temp')], acts: [A('plan', { plan: 'balanced' })], notify: { ...NOTD, when: 'always' } }) },
  { n: 'Limpieza ligera diaria', d: 'Tras 15 minutos sin usar el PC, si hay más de 2 GB de basura.', ic: 'broom',
    r: () => mk({ name: 'Limpieza ligera', color: 2, triggers: [T('idle', { min: 15 })], conds: [C('junk', { gb: 2 }), C('notSince', { hours: 20 })], acts: [A('clean'), A('recycle')], notify: { ...NOTD, when: 'never' } }) },
];

let R = null, LOG = null, NT = null, sel = null, step = 't';
const openGroups = { t: new Set(['Fecha y hora']), c: new Set(['Energía', 'Uso del PC']), a: new Set(['Limpieza']) };
const query = { t: '', c: '', a: '' };
function ensure() {
  if (R) return;
  const st = state.settings;
  if (st.autopilotSchema !== 2) {           // las rutinas de ejemplo de la versión anterior se descartan una vez
    R = []; LOG = [];
    SH.setSetting('autopilotRoutines', []); SH.setSetting('autopilotLog', []); SH.setSetting('autopilotSchema', 2);
  } else {
    R = Array.isArray(st.autopilotRoutines) ? clone(st.autopilotRoutines) : [];
    LOG = (Array.isArray(st.autopilotLog) ? st.autopilotLog : []).map(l => ({ ...l, when: new Date(l.when) }));
  }
  R.forEach(r => { r.after = { ...AFTERD, ...(r.after || {}) }; r.notify = { ...NOTD, ...(r.notify || {}) }; });
  sel = R[0] && R[0].id;
  NT = { toast: true, tray: true, sound: false, when: 'decide', quiet: true, qFrom: '23:00', qTo: '08:00', noGame: true, weekly: true, weeklyDay: 6, batterySaver: true, ...(st.autopilotNotify || {}) };
}
let saveT = 0;
const save = () => { clearTimeout(saveT); saveT = setTimeout(() => SH.setSetting('autopilotRoutines', clone(R)), 350); };
const saveLog = () => SH.setSetting('autopilotLog', LOG.slice(0, 100).map(l => ({ ...l, when: l.when.toISOString(), fresh: false })));
const saveNT = () => SH.setSetting('autopilotNotify', { ...NT });
const cur = () => R.find(r => r.id === sel);
const colorOf = r => COLORS[(r.color || 0) % COLORS.length];
const listOf = (r, s) => s === 't' ? r.triggers : s === 'c' ? r.conds : r.acts;

/* ================= textos de una rutina ================= */
function summary(r) {
  const t = r.triggers.map(x => sayOf('t', x)), c = r.conds.map(x => sayOf('c', x)), a = r.acts.filter(x => x.k !== 'wait').map(x => sayOf('a', x));
  if (!t.length && !a.length) return 'Esta rutina todavía está vacía. Empieza por «Cuándo» y luego elige «Qué hace».';
  let s = t.length ? cap(join(t, ' o ')) : 'Sin momento elegido todavía';
  if (c.length) s += `, si ${join(c, r.condMode === 'all' ? ' y ' : ' o ')}`;
  s += ': ' + (a.length ? (a.length > 3 ? `${a.slice(0, 3).join(', ')} y ${a.length - 3} más` : join(a)) : 'todavía no hace nada') + '.';
  s += ' ' + ({ always: 'Te avisa siempre.', decide: 'Te avisa solo si hay algo que decidir.', errors: 'Te avisa solo si algo falla.', never: 'No te avisa.' })[r.notify.when];
  if (r.pausedUntil) s += ` En pausa hasta el ${fmtDate(r.pausedUntil)}.`;
  return s;
}
function problems(r) {
  const p = [];
  if (!r.triggers.length) p.push(['t', 'Elige cuándo se ejecuta']);
  if (!r.acts.length) p.push(['a', 'Añade al menos una acción']);
  r.triggers.forEach(x => {
    if (x.k === 'weekdays' && !x.p.days.length) p.push(['t', 'Marca al menos un día de la semana']);
    if (x.k === 'once' && new Date(x.p.date + 'T' + x.p.time) < new Date()) p.push(['t', 'La fecha de «Una sola vez» ya pasó']);
    if (x.k === 'wifi' && !String(x.p.ssid).trim()) p.push(['t', 'Escribe el nombre de la red Wi-Fi']);
    if (x.k === 'download' && !String(x.p.folder).trim()) p.push(['t', 'Indica la carpeta de las descargas']);
  });
  r.conds.forEach(x => { if (x.k === 'days' && !x.p.days.length) p.push(['c', 'Marca al menos un día en «Solo ciertos días»']); if (x.k === 'onWifi' && !String(x.p.ssid).trim()) p.push(['c', 'Escribe el nombre de la red Wi-Fi']); });
  r.acts.forEach(x => {
    if (x.k === 'openApp' && !String(x.p.path).trim()) p.push(['a', 'Indica qué programa o archivo abrir']);
    if (x.k === 'cmd' && !String(x.p.cmd).trim()) p.push(['a', 'Escribe el comando que se ejecuta']);
    if (x.k === 'clean' && !x.p.cats.length) p.push(['a', 'Elige al menos una categoría para limpiar']);
    if (x.k === 'apps' && x.p.scope === 'list' && !(x.p.list || []).length) p.push(['a', 'Elige qué programas actualizar']);
  });
  if (r.after.okThen === 'routine' && !R.some(o => o.id === r.after.okRoutine)) p.push(['after', 'Elige qué rutina se ejecuta al terminar']);
  if (r.after.failThen === 'routine' && !R.some(o => o.id === r.after.failRoutine)) p.push(['after', 'Elige qué rutina se ejecuta si algo falla']);
  return p;
}
/* próximas ejecuciones con hora */
function occ(r, from, to) {
  if (!r.on) return [];
  const out = [], pz = r.pausedUntil ? new Date(r.pausedUntil + 'T23:59') : null;
  r.triggers.forEach(x => {
    const d = byK.t[x.k]; if (!d || !d.sched) return;
    if (x.k === 'everyN') { const s = new Date(from); s.setMinutes(0, 0, 0); let n = 0;
      for (let t = new Date(s); t < to && n < 60; t = new Date(t.getTime() + x.p.hours * 36e5), n++) if (t >= from) out.push({ d: new Date(t), x }); return; }
    if (x.k === 'once') { const t = new Date(x.p.date + 'T' + x.p.time); if (t >= from && t < to) out.push({ d: t, x }); return; }
    const [hh, mm] = (x.p.time || '00:00').split(':').map(Number);
    const day = new Date(from); day.setHours(0, 0, 0, 0);
    for (; day < to; day.setDate(day.getDate() + 1)) {
      const wd = (day.getDay() + 6) % 7; let ok = false;
      if (x.k === 'daily') ok = true;
      else if (x.k === 'weekdays') ok = x.p.days.includes(wd);
      else if (x.k === 'monthly') {
        if (x.p.mode === 'day') ok = day.getDate() === +x.p.day;
        else if (wd === +x.p.weekday) { if (x.p.mode === 'first') ok = day.getDate() <= 7; else { const n = new Date(day); n.setDate(n.getDate() + 7); ok = n.getMonth() !== day.getMonth(); } }
      }
      if (ok) { const t = new Date(day); t.setHours(hh, mm, 0, 0); if (t >= from) out.push({ d: t, x }); }
    }
  });
  return out.filter(o => !pz || o.d > pz).sort((a, b) => a.d - b.d);
}
function nextText(r) {
  if (!r.on) return 'Desactivada';
  if (!r.triggers.length) return 'Sin momento elegido';
  const now = new Date(); const n = occ(r, now, new Date(now.getTime() + 70 * 864e5))[0];
  const free = r.triggers.find(x => !byK.t[x.k].sched);
  if (n) return `Próxima: ${relDay(n.d)} a las ${hm(n.d)}`;
  if (r.pausedUntil) return `En pausa hasta el ${fmtDate(r.pausedUntil)}`;
  return free ? cap(sayOf('t', free)) : 'Sin próxima fecha';
}

/* ================= controles ================= */
const segH = (key, list, val, cls = '') => `<div class="seg ${cls}" data-seg="${key}"><span class="ind"></span>${list.map(([v, n]) => `<button data-v="${v}"${String(val) === String(v) ? ' class="on"' : ''}>${n}</button>`).join('')}</div>`;
const togH = (attr, on, label) => `<button class="toggle${on ? ' on' : ''}" ${attr} aria-label="${esc(label)}"><i></i></button>`;
function paramH(s, i, k, spec, v) {
  const path = `${s}:${i}:${k}`; const lab = spec.label ? `<span class="pl">${esc(spec.label)}</span>` : '';
  switch (spec.type) {
    case 'time': return `<label class="pp">${lab}<input type="time" class="field pi" data-path="${path}" value="${esc(v)}"></label>`;
    case 'date': return `<label class="pp">${lab}<input type="date" class="field pi" data-path="${path}" value="${esc(v)}" min="${iso(new Date())}"></label>`;
    case 'text': return `<label class="pp grow">${lab}<input type="text" class="field pi" data-path="${path}" value="${esc(v)}" placeholder="${esc(spec.ph || '')}" spellcheck="false"></label>`;
    case 'num': return `<span class="pp">${lab}<span class="ap-num"><button data-step="-1" data-path="${path}" aria-label="Menos">${ic('minus')}</button><input type="number" class="pi" data-path="${path}" value="${v}" min="${spec.min}" max="${spec.max}" step="${spec.step || 1}"><em>${esc(spec.unit || '')}</em><button data-step="1" data-path="${path}" aria-label="Más">${ic('plus')}</button></span></span>`;
    case 'select': return `<label class="pp">${lab}<span class="ap-selw"><select class="pi" data-path="${path}">${opts(spec.opts).map(([ov, ol]) => `<option value="${esc(ov)}"${String(v) === String(ov) ? ' selected' : ''}>${esc(ol)}</option>`).join('')}</select>${ic('chevd')}</span></label>`;
    case 'days': return `<span class="pp">${lab}<span class="ap-days">${DAYS.map((d, j) => `<button class="ap-day${v.includes(j) ? ' on' : ''}" data-path="${path}" data-day="${j}" title="${DAYN[j]}">${d}</button>`).join('')}</span></span>`;
    case 'multi': return `<span class="pp wide">${lab}<span class="ap-multi">${opts(spec.opts).map(([ov, ol]) => `<button class="ap-mc${v.includes(ov) ? ' on' : ''}" data-path="${path}" data-opt="${esc(ov)}">${ic('check')}${esc(ol)}</button>`).join('')}</span></span>`;
  }
  return '';
}
function itemH(s, x, i, n) {
  const d = byK[s][x.k]; if (!d) return '';
  const ps = Object.entries(d.p || {}).filter(([, spec]) => !spec.show || spec.show(x.p));
  const isA = s === 'a';
  return `<div class="si" data-i="${i}" data-k="${x.k}">
    ${isA ? `<span class="si-grip" title="Arrastra para cambiar el orden">${ic('drag')}</span>` : ''}
    <span class="si-ic">${isA ? `<em>${i + 1}</em>` : ic(d.ic)}</span>
    <div class="si-b"><div class="si-t"><b>${esc(d.t)}</b>${d.mod ? `<em>${esc(d.mod)}</em>` : ''}${d.admin ? '<span class="chip">administrador</span>' : ''}${d.decide && d.decide(x.p) ? '<span class="chip acc">te pregunta</span>' : ''}</div>
      ${ps.length ? `<div class="si-p">${ps.map(([k, spec]) => paramH(s, i, k, spec, x.p[k])).join('')}</div>` : ''}
      ${ps.length ? `<div class="si-say">${esc(cap(d.say(x.p)))}</div>` : ''}</div>
    <div class="si-tools">${isA ? `<button class="iconbtn" data-mv="-1"${i === 0 ? ' disabled' : ''} title="Subir">${ic('up')}</button><button class="iconbtn" data-mv="1"${i === n - 1 ? ' disabled' : ''} title="Bajar">${ic('down')}</button>` : ''}<button class="iconbtn" data-rm title="Quitar">${ic('x')}</button></div>
  </div>`;
}

/* ================= pestaña Rutinas ================= */
let rEl = null;
const STEPS = [
  { id: 't', n: 'Cuándo', ic: 'clock', help: 'Elige uno o varios momentos. Se ejecuta con el primero que ocurra.' },
  { id: 'c', n: 'Solo si', ic: 'filter', help: 'Opcional. Si no se cumplen, la rutina espera a la próxima vez.' },
  { id: 'a', n: 'Qué hace', ic: 'list', help: 'Se hace en orden, de arriba abajo. Arrastra desde los puntos para reordenar.' },
  { id: 'after', n: 'Después', ic: 'restore', help: 'Qué pasa si algo falla y qué hacer al terminar.' },
  { id: 'n', n: 'Avisos', ic: 'bell', help: 'Cuándo y cómo te avisa esta rutina. Las horas de silencio se ajustan en la pestaña Avisos.' },
];
const stepCount = (r, s) => s === 't' ? r.triggers.length : s === 'c' ? r.conds.length : s === 'a' ? r.acts.length : 0;

function renderRoutines(el) { ensure(); rEl = el; el.classList.add('fill'); drawRoutines(); }
function drawRoutines() {
  const el = rEl; if (!el) return;
  if (!R.length) {
    el.innerHTML = `<div class="ap-empty pan" data-asm>
      <div class="ape-hero">
        <div class="ape-art" aria-hidden="true"><svg viewBox="0 0 120 120"><ellipse cx="60" cy="60" rx="50" ry="20" class="o1"/><ellipse cx="60" cy="60" rx="34" ry="14" class="o2"/><circle cx="60" cy="60" r="10" class="c0"/><circle r="4" class="p1"><animateMotion dur="9s" repeatCount="indefinite" path="M110,60 A50,20 0 1,1 10,60 A50,20 0 1,1 110,60"/></circle><circle r="3" class="p2"><animateMotion dur="6s" repeatCount="indefinite" path="M26,60 A34,14 0 1,0 94,60 A34,14 0 1,0 26,60"/></circle></svg></div>
        <h2>Crea tu primera rutina</h2>
        <p>Una rutina hace el mantenimiento por ti. Tú eliges cuándo, con qué condiciones y qué hace; StellarHub se encarga del resto.</p>
        <div class="ape-btns"><button class="btn pri lg" data-new>${ic('plus')}Rutina en blanco</button></div>
      </div>
      <div class="ape-tpls"><span class="ape-l">O empieza con una plantilla</span><div class="ape-grid">${TEMPLATES.map((t, i) => `<button class="ape-t" data-tpl="${i}"><span class="ape-ti">${ic(t.ic)}</span><b>${esc(t.n)}</b><span>${esc(t.d)}</span></button>`).join('')}</div></div>
    </div>`;
    const svg = $('.ape-art svg', el); if (svg && state.settings.intensity === 'min') svg.pauseAnimations();
    $$('.ape-t', el).forEach((b, i) => anim(b, [{ opacity: 0, transform: 'translate3d(0,12px,0) scale(.97)' }, { opacity: 1, transform: 'none' }], { d: 460, delay: 200 + i * 45, e: EASE.spring, keep: true }));
    return;
  }
  if (!cur()) sel = R[0].id;
  el.innerHTML = `<div class="ap">
    <div class="ap-side">
      <div class="pan ap-listp"><div class="pan-h">Tus rutinas <em id="apCount"></em></div><div class="ap-cards" id="apList"></div></div>
      <div class="pan ap-tplp"><button class="ap-tplh" id="apTplH">${ic('sparkle')}<span>Añadir desde una plantilla</span>${ic('chevd')}</button>
        <div class="ap-tplb"><div><div class="ap-tpls">${TEMPLATES.map((t, i) => `<button class="ap-t" data-tpl="${i}"><span class="ape-ti">${ic(t.ic)}</span><span><b>${esc(t.n)}</b><span>${esc(t.d)}</span></span></button>`).join('')}</div></div></div></div>
    </div>
    <div class="pan ap-ed" id="apEd"></div></div>`;
  drawList(true); drawEditor(false);
  $('#apList', el).addEventListener('click', e => {
    const card = e.target.closest('.ap-card'); if (!card) return; const r = R.find(x => x.id === card.dataset.id); if (!r) return;
    if (e.target.closest('.toggle')) { r.on = !r.on; e.target.closest('.toggle').classList.toggle('on', r.on); card.classList.toggle('off', !r.on); $('.ap-next', card).textContent = nextText(r); save(); if (r.id === sel) refreshMeta(); SH.toast(r.on ? `«${r.name}» activada.` : `«${r.name}» desactivada.`); return; }
    if (r.id !== sel) { sel = r.id; $$('.ap-card', el).forEach(c => c.classList.toggle('sel', c.dataset.id === sel)); drawEditor(false); }
  });
  $('#apTplH', el).addEventListener('click', e => { const p = e.currentTarget.parentElement; p.classList.toggle('open'); });
}
function cardH(r) {
  const bad = problems(r).length;
  const t = r.triggers.length ? cap(sayOf('t', r.triggers[0])) + (r.triggers.length > 1 ? ` y ${r.triggers.length - 1} más` : '') : 'Sin momento elegido';
  return `<div class="ap-card${r.id === sel ? ' sel' : ''}${r.on ? '' : ' off'}" data-id="${r.id}" style="--c:${colorOf(r)}"><i class="ap-dot"></i>
    <div class="ap-ct"><b>${esc(r.name)}${r.priority === 'high' ? ' <span class="ap-pr">alta</span>' : ''}</b><span>${esc(t)}</span><span class="ap-next${bad ? ' warn' : ''}">${bad ? 'Incompleta: ' + esc(problems(r)[0][1].toLowerCase()) : esc(nextText(r))}</span></div>
    ${togH('', r.on, 'Activar ' + r.name)}</div>`;
}
function drawList(anims) {
  const list = $('#apList', rEl); if (!list) return;
  $('#apCount', rEl).textContent = `${R.filter(r => r.on).length} de ${R.length} activas`;
  list.innerHTML = R.map(cardH).join('');
  if (anims) $$('.ap-card', list).forEach((c, i) => anim(c, [{ opacity: 0, transform: 'translate3d(-10px,0,0)' }, { opacity: 1, transform: 'none' }], { d: 380, delay: i * 35, e: EASE.spring, keep: true }));
}
function refreshCard(r) { const c = $(`.ap-card[data-id="${r.id}"]`, rEl); if (!c) return; const t = document.createElement('div'); t.innerHTML = cardH(r); const n = t.firstElementChild; c.replaceWith(n); $('#apCount', rEl).textContent = `${R.filter(x => x.on).length} de ${R.length} activas`; }
function addRoutine(r, quiet) {
  const first = !R.length; R.unshift(r); sel = r.id; step = r.triggers.length ? 't' : 't'; save();
  if (first) { drawRoutines(); } else { drawList(); drawEditor(false); }
  const c = $(`.ap-card[data-id="${r.id}"]`, rEl); if (c) anim(c, [{ opacity: 0, transform: 'translate3d(0,-12px,0) scale(.95)', filter: 'blur(6px)' }, { opacity: 1, transform: 'none', filter: 'blur(0px)' }], { d: 520, e: EASE.spring });
  if (!quiet) SH.toast(`«${r.name}» creada.`);
  if (calDirty) calDirty();
}

/* ---------- editor ---------- */
function drawEditor(soft) {
  const ed = $('#apEd', rEl); const r = cur(); if (!ed) return;
  if (!r) { ed.innerHTML = `<div class="empty"><b>Elige una rutina</b>O crea una nueva arriba a la derecha.</div>`; return; }
  const html = `
    <div class="ape-head">
      <button class="ap-sw" style="--c:${colorOf(r)}" title="Cambiar el color" aria-label="Cambiar el color"></button>
      <input class="ap-name" id="apName" value="${esc(r.name)}" maxlength="48" spellcheck="false" aria-label="Nombre de la rutina">
      <div class="ape-tools">
        <button class="btn ghost sm" id="apDry" title="Muestra qué haría ahora mismo, sin hacer nada">${ic('flask')}<span class="lbl">Probar en seco</span></button>
        <button class="btn sec sm" id="apRun" title="Ejecutar ahora">${ic('play')}<span class="lbl">Ejecutar ahora</span></button>
        <div class="ap-more"><button class="iconbtn" id="apMore" aria-label="Más opciones">${ic('dots')}</button>
          <div class="ap-menu" id="apMenu" hidden>
            <button data-m="dup">${ic('dup')}Duplicar</button>
            <div class="ap-mpause"><span>${ic('pause')}Pausar hasta</span><input type="date" class="field" id="apPauseD" value="${esc(r.pausedUntil || '')}" min="${iso(new Date())}"></div>
            ${r.pausedUntil ? `<button data-m="unpause">${ic('play')}Quitar la pausa</button>` : ''}
            <button data-m="color">${ic('palette')}Cambiar el color</button>
            <button data-m="del" class="danger">${ic('trash')}Borrar</button>
          </div></div>
      </div>
    </div>
    <p class="ap-sum" id="apSum">${esc(summary(r))}</p>
    <nav class="ap-steps" id="apSteps"><span class="ind"></span>${STEPS.map((s, i) => `<button data-step="${s.id}"${s.id === step ? ' class="on"' : ''}><span class="sn">${ic(s.ic)}</span><span class="sl">${s.n}</span><em data-c="${s.id}"></em></button>`).join('')}</nav>
    <div class="ap-stage" id="apStage"></div>
    <footer class="ape-foot" id="apFoot"></footer>
    <div class="ap-dry" id="apDryP" hidden></div>`;
  const done = () => {
    ed.innerHTML = html; refreshMeta(); refreshCounts(); drawStage(0); refreshFoot(); bindEditor(ed);
    requestAnimationFrame(() => placeStepInd(true));
  };
  if (soft) { done(); return; }
  const a = anim(ed, [{ opacity: 1, transform: 'none', filter: 'blur(0px)' }, { opacity: 0, transform: 'translate3d(14px,0,0)', filter: 'blur(5px)' }], { d: ed.childElementCount ? 140 : 1 });
  const go = () => { done(); anim(ed, [{ opacity: 0, transform: 'translate3d(-14px,0,0)', filter: 'blur(5px)' }, { opacity: 1, transform: 'none', filter: 'blur(0px)' }], { d: 420, e: EASE.spring }); };
  a ? a.finished.then(go).catch(go) : go();
}
function refreshMeta() { refreshFoot(); }
function refreshCounts() { const r = cur(); $$('#apSteps [data-c]', rEl).forEach(e => { const n = stepCount(r, e.dataset.c); e.textContent = n || ''; e.hidden = !n; }); const bad = new Set(problems(r).map(p => p[0])); $$('#apSteps button', rEl).forEach(b => b.classList.toggle('bad', bad.has(b.dataset.step))); }
function refreshFoot() {
  const r = cur(), f = $('#apFoot', rEl); if (!f || !r) return; const p = problems(r); const i = STEPS.findIndex(s => s.id === step);
  f.innerHTML = `<div class="apf-st">${p.length ? `<span class="chip warn">${ic('alert')}Incompleta</span><button class="apf-go" data-go="${p[0][0]}">${esc(p[0][1])}</button>${p.length > 1 ? `<span class="faint">y ${p.length - 1} más</span>` : ''}`
      : `${r.on ? `<span class="chip ok">${ic('check')}Lista para funcionar</span>` : `<span class="chip">Desactivada</span>`}${r.pausedUntil ? `<span class="chip warn">${ic('pause')}En pausa hasta el ${esc(fmtDate(r.pausedUntil))}</span>` : ''}<span class="faint apf-next">${esc(r.on ? nextText(r) : 'Actívala en la lista para que funcione.')}</span>`}</div>
    <div class="apf-nav"><button class="btn ghost sm" data-nav="-1"${i === 0 ? ' disabled' : ''}>Anterior</button><button class="btn sec sm" data-nav="1">${i === STEPS.length - 1 ? 'Listo' : 'Siguiente: ' + STEPS[i + 1].n}</button></div>`;
}
function placeStepInd(snap) {
  const nav = $('#apSteps', rEl); if (!nav) return; const b = $(`button[data-step="${step}"]`, nav), ind = $('.ind', nav); if (!b) return;
  const x = b.offsetLeft, w = b.offsetWidth;
  if (snap || !ind.dataset.x) { ind.getAnimations().forEach(a => a.cancel()); ind.style.width = w + 'px'; ind.style.transform = `translateX(${x}px)`; }
  else anim(ind, [{ transform: `translateX(${ind.dataset.x}px)`, width: ind.dataset.w + 'px' }, { transform: `translateX(${x}px)`, width: w + 'px' }], { d: 420, e: EASE.spring });
  ind.dataset.x = x; ind.dataset.w = w;
}
function setStep(s) {
  if (s === step) return; const old = STEPS.findIndex(x => x.id === step), ni = STEPS.findIndex(x => x.id === s); step = s;
  $$('#apSteps button', rEl).forEach(b => b.classList.toggle('on', b.dataset.step === s)); placeStepInd(); drawStage(ni > old ? 1 : -1); refreshFoot();
}
function changed(opt = {}) {
  const r = cur(); save();
  const s = $('#apSum', rEl); if (s) { const t = summary(r); if (s.textContent !== t) { s.textContent = t; anim(s, [{ opacity: .45 }, { opacity: 1 }], { d: 260 }); } }
  refreshCounts(); refreshFoot(); refreshCard(r); if (opt.meta) refreshMeta(); if (calDirty) calDirty();
}

/* ---------- escenario de cada paso ---------- */
function catH(s) {
  const q = norm(query[s].trim());
  const html = CAT[s].map(([g, items]) => {
    const f = items.filter(d => !q || norm(d.t + ' ' + g + ' ' + (d.mod || '')).includes(q)); if (!f.length) return '';
    const open = q || openGroups[s].has(g); const used = new Set(listOf(cur(), s).map(x => x.k));
    return `<div class="cg${open ? ' open' : ''}" data-g="${esc(g)}"><button class="cg-h"><span>${esc(g)}</span><em>${f.length}</em>${ic('chevd')}</button>
      <div class="cg-b"><div>${f.map(d => `<button class="cg-it" data-add="${d.k}"><span class="cg-ic">${ic(d.ic)}</span><span class="cg-t">${esc(d.t)}${d.admin ? '<i>administrador</i>' : ''}</span>${used.has(d.k) ? '<em>añadido</em>' : ''}${ic('plus')}</button>`).join('')}</div></div></div>`;
  }).join('');
  return html || `<div class="empty cg-none"><b>Nada con «${esc(query[s])}»</b>Prueba con otra palabra.</div>`;
}
function stageCatalogH(s) {
  const r = cur(), list = listOf(r, s), meta = STEPS.find(x => x.id === s);
  const head = s === 'c' && list.length > 1 ? `<div class="st-mode"><span>Se cumple si</span>${segH('condMode', [['all', 'todas'], ['any', 'alguna']], r.condMode, 'sm')}</div>` : '';
  const emptyTxt = { t: ['Todavía no tiene un momento', 'Elige en el catálogo cuándo debe ejecutarse.'], c: ['Sin condiciones', 'Se ejecutará siempre que llegue su momento. Añade condiciones si quieres más control.'], a: ['Todavía no hace nada', 'Añade acciones desde el catálogo. Se harán en el orden de la lista.'] }[s];
  return `<div class="st-grid">
    <div class="st-sel"><div class="st-h"><b>${s === 't' ? 'Momentos elegidos' : s === 'c' ? 'Condiciones' : 'Acciones, en orden'}</b><span class="faint">${esc(meta.help)}</span></div>${head}
      <div class="st-list" id="stList">${list.length ? list.map((x, i) => itemH(s, x, i, list.length)).join('') : `<div class="st-empty"><span>${ic(meta.ic)}</span><b>${emptyTxt[0]}</b><p>${emptyTxt[1]}</p></div>`}</div></div>
    <div class="st-cat"><div class="field st-q">${ic('search')}<input id="stQ" placeholder="Buscar en el catálogo" value="${esc(query[s])}" spellcheck="false" autocomplete="off"></div>
      <div class="st-groups" id="stGroups">${catH(s)}</div></div>
  </div>`;
}
function stageAfterH() {
  const r = cur(), a = r.after; const others = R.filter(o => o.id !== r.id);
  const rsel = (k, v) => `<span class="ap-selw"><select class="pi" data-after="${k}">${others.length ? others.map(o => `<option value="${o.id}"${v === o.id ? ' selected' : ''}>${esc(o.name)}</option>`).join('') : '<option value="">No hay otras rutinas</option>'}</select>${ic('chevd')}</span>`;
  return `<div class="st-cards">
    <div class="sc"><b>Si una acción falla</b><span class="faint">Por ejemplo, si un programa no se puede actualizar porque está abierto.</span>
      ${segH('onFail', [['continue', 'Seguir con la siguiente'], ['stop', 'Parar la rutina'], ['retry', 'Reintentar']], a.onFail)}
      <div class="sc-row${a.onFail === 'retry' ? '' : ' dis'}"><span>Reintentos</span><span class="ap-num"><button data-astep="-1" data-after="retries">${ic('minus')}</button><input type="number" class="pi" data-after="retries" value="${a.retries}" min="1" max="5"><em>veces</em><button data-astep="1" data-after="retries">${ic('plus')}</button></span></div></div>
    <div class="sc"><b>Si no se pudo ejecutar</b><span class="faint">Porque el PC estaba apagado o no se cumplían las condiciones.</span>
      <div class="sc-row"><span>Intentarlo al día siguiente</span>${togH('data-atog="tomorrow"', a.tomorrow, 'Intentarlo al día siguiente')}</div>
      <div class="sc-row"><span>Cancelar si tarda más de</span><span class="ap-num"><button data-astep="-15" data-after="limit">${ic('minus')}</button><input type="number" class="pi" data-after="limit" value="${a.limit}" min="15" max="480" step="15"><em>min</em><button data-astep="15" data-after="limit">${ic('plus')}</button></span></div></div>
    <div class="sc"><b>Al terminar bien</b><span class="faint">Algo más que hacer cuando todo salió como esperabas.</span>
      ${segH('okThen', [['none', 'Nada'], ['sleep', 'Suspender'], ['off', 'Apagar'], ['routine', 'Otra rutina']], a.okThen)}
      <div class="sc-row${a.okThen === 'routine' ? '' : ' hid'}"><span>Ejecutar</span>${rsel('okRoutine', a.okRoutine)}</div></div>
    <div class="sc"><b>Si algo falla</b><span class="faint">Qué hacer cuando al menos una acción no salió bien.</span>
      ${segH('failThen', [['none', 'Nada'], ['notify', 'Avisarme siempre'], ['routine', 'Otra rutina']], a.failThen)}
      <div class="sc-row${a.failThen === 'routine' ? '' : ' hid'}"><span>Ejecutar</span>${rsel('failRoutine', a.failRoutine)}</div></div>
    <div class="sc"><b>Prioridad</b><span class="faint">Si dos rutinas coinciden, va primero la de prioridad más alta.</span>
      ${segH('priority', [['low', 'Baja'], ['normal', 'Normal'], ['high', 'Alta']], r.priority)}</div>
    <div class="sc"><div class="sc-row"><span><b>Guardar un informe en el registro</b><span class="faint">Paso a paso, con lo que se hizo, cuánto tardó y lo que liberó.</span></span>${togH('data-atog="report"', a.report, 'Guardar un informe')}</div></div>
  </div>`;
}
function stageNotifyH() {
  const n = cur().notify;
  return `<div class="st-cards two">
    <div class="sc"><b>Cuándo te avisa</b><span class="faint">Solo para esta rutina.</span>
      ${segH('nwhen', [['always', 'Siempre'], ['decide', 'Si hay que decidir'], ['errors', 'Si algo falla'], ['never', 'Nunca']], n.when)}
      <div class="sc-row"><span>Notificación de Windows</span>${togH('data-ntog="toast"', n.toast, 'Notificación de Windows')}</div>
      <div class="sc-row"><span>Punto en el icono de la bandeja</span>${togH('data-ntog="tray"', n.tray, 'Punto en la bandeja')}</div>
      <div class="sc-row"><span>Sonido suave</span>${togH('data-ntog="sound"', n.sound, 'Sonido')}</div>
      <div class="sc-row"><span>Incluirla en el resumen semanal</span>${togH('data-ntog="weekly"', n.weekly, 'Resumen semanal')}</div></div>
    <div class="sc prev"><b>Así se vería</b><div class="nt-desk sm"><div class="nt-toast" id="stPrev"></div><div class="nt-tray"><span class="nt-ti">${ic('home')}<i id="stDot"></i></span><span class="faint">${hm(new Date())}</span></div></div></div>
  </div>`;
}
function previewToastH(when, sound, name) {
  const msg = when === 'errors' ? ['Algo no salió bien', `«${name}»: Spotify no se pudo actualizar porque estaba abierto.`]
    : when === 'decide' ? ['2 drivers esperan tu visto bueno', `«${name}» terminó lo demás: 4,2 GB liberados.`]
    : when === 'never' ? ['Sin avisos', 'Esta rutina trabaja en silencio. Lo verás todo en el registro.']
    : [`«${name}» terminada`, '4,2 GB liberados y 3 programas actualizados.'];
  return `<div class="nt-th"><span class="nt-ai">${ic('autopilot')}</span><span>StellarHub</span>${sound ? `<span class="nt-snd">${ic('speaker')}</span>` : ''}</div><b>${esc(msg[0])}</b><span>${esc(msg[1])}</span>${when === 'decide' ? '<div class="nt-tb"><span>Revisar</span><span>Más tarde</span></div>' : ''}`;
}
function drawStage(dir) {
  const st = $('#apStage', rEl); if (!st) return;
  const html = step === 'after' ? stageAfterH() : step === 'n' ? stageNotifyH() : stageCatalogH(step);
  st.innerHTML = html;
  if (step === 'n') { const n = cur().notify, p = $('#stPrev', st); p.innerHTML = previewToastH(n.when, n.sound, cur().name); p.classList.toggle('off', !n.toast || n.when === 'never'); $('#stDot', st).classList.toggle('on', n.tray && n.when !== 'never'); }
  requestAnimationFrame(() => $$('.seg', st).forEach(s => SH.placeSeg(s, true)));
  if (dir) {
    anim(st, [{ opacity: 0, transform: `translate3d(${dir * 34}px,0,0)`, filter: 'blur(6px)' }, { opacity: 1, transform: 'none', filter: 'blur(0px)' }], { d: 440, e: EASE.spring });
    $$('.si, .sc, .cg', st).forEach((x, i) => anim(x, [{ opacity: 0, transform: 'translate3d(0,8px,0)' }, { opacity: 1, transform: 'none' }], { d: 380, delay: 60 + Math.min(i, 10) * 30, e: EASE.spring, keep: true }));
  }
}
function redrawList(flashI) {
  const r = cur(), list = listOf(r, step), box = $('#stList', rEl); if (!box) return;
  const meta = STEPS.find(x => x.id === step);
  if (!list.length) { drawStage(0); return; }
  box.innerHTML = list.map((x, i) => itemH(step, x, i, list.length)).join('');
  if (step === 'c') { const sg = $('.st-sel', rEl); const has = $('.st-mode', sg); if (list.length > 1 && !has) drawStage(0); else if (list.length <= 1 && has) has.remove(); }
  if (flashI !== undefined) { const n = $(`.si[data-i="${flashI}"]`, box); if (n) { anim(n, [{ opacity: 0, transform: 'translate3d(0,10px,0) scale(.97)' }, { opacity: 1, transform: 'none' }], { d: 440, e: EASE.spring }); n.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } }
  void meta;
}
function refreshItem(i) {
  const r = cur(), list = listOf(r, step), n = $(`#stList .si[data-i="${i}"]`, rEl); if (!n) return;
  const t = document.createElement('div'); t.innerHTML = itemH(step, list[i], i, list.length); const fresh = t.firstElementChild; n.replaceWith(fresh);
  const p = $('.si-p', fresh); if (p) anim(p, [{ opacity: .4 }, { opacity: 1 }], { d: 260 });
}
function updateSay(i) { const r = cur(), x = listOf(r, step)[i], n = $(`#stList .si[data-i="${i}"] .si-say`, rEl); if (n && x) n.textContent = cap(byK[step][x.k].say(x.p)); }
function setParam(path, raw) {
  const [s, si, k] = path.split(':'); const i = +si; const r = cur(), x = listOf(r, s)[i]; if (!x) return;
  const spec = byK[s][x.k].p[k]; let v = raw;
  if (spec.type === 'num') { const stp = spec.step || 1; v = Math.round(+raw / stp) * stp; if (!isFinite(v)) v = spec.def; v = Math.max(spec.min, Math.min(spec.max, v)); }
  x.p[k] = v;
  const deps = Object.values(byK[s][x.k].p).some(z => z.show);
  if (deps && spec.type === 'select') refreshItem(i); else updateSay(i);
  changed();
  return v;
}

/* ---------- arrastrar para reordenar acciones ---------- */
function startDrag(e, item) {
  e.preventDefault(); const box = item.parentElement; const items = [...box.children]; const idx = items.indexOf(item);
  const h = item.offsetHeight + 8; const y0 = e.clientY; let to = idx;
  item.classList.add('drag'); box.classList.add('dragging');
  const move = ev => {
    const dy = ev.clientY - y0; item.style.transform = `translate3d(0,${dy}px,0) scale(1.015)`;
    to = Math.max(0, Math.min(items.length - 1, idx + Math.round(dy / h)));
    items.forEach((it, i) => { if (it === item) return; let s = 0; if (idx < to && i > idx && i <= to) s = -h; if (idx > to && i < idx && i >= to) s = h; it.style.transform = s ? `translate3d(0,${s}px,0)` : ''; });
  };
  const up = () => {
    removeEventListener('pointermove', move); removeEventListener('pointerup', up);
    box.classList.remove('dragging'); item.classList.remove('drag'); items.forEach(it => it.style.transform = '');
    if (to !== idx) { const r = cur(); const [a] = r.acts.splice(idx, 1); r.acts.splice(to, 0, a); redrawList(); changed(); const n = $(`#stList .si[data-i="${to}"]`, rEl); if (n) anim(n, [{ transform: 'scale(1.02)' }, { transform: 'none' }], { d: 300, e: EASE.spring }); }
  };
  addEventListener('pointermove', move); addEventListener('pointerup', up);
}

/* ---------- eventos del editor ---------- */
function bindEditor(ed) {
  const r = () => cur();
  $('#apName', ed).addEventListener('input', e => { r().name = e.target.value.trim() || 'Sin nombre'; changed(); });
  const recolor = () => { const x = r(); x.color = ((x.color || 0) + 1) % COLORS.length; const sw = $('.ap-sw', ed); sw.style.setProperty('--c', colorOf(x)); anim(sw, [{ transform: 'scale(.6)' }, { transform: 'scale(1)' }], { d: 380, e: EASE.spring }); changed(); };
  $('.ap-sw', ed).addEventListener('click', recolor);
  $('#apSteps', ed).addEventListener('click', e => { const b = e.target.closest('[data-step]'); if (b) setStep(b.dataset.step); });
  $('#apFoot', ed).addEventListener('click', e => {
    const g = e.target.closest('[data-go]'); if (g) { setStep(g.dataset.go); return; }
    const n = e.target.closest('[data-nav]'); if (!n || n.disabled) return; const i = STEPS.findIndex(s => s.id === step) + +n.dataset.nav;
    if (i >= STEPS.length) { const p = problems(r()); SH.toast(p.length ? `Todavía falta: ${p[0][1].toLowerCase()}.` : `«${r().name}» está lista y guardada.`); return; }
    if (i >= 0) setStep(STEPS[i].id);
  });
  /* menú de más opciones */
  const menu = $('#apMenu', ed);
  $('#apMore', ed).addEventListener('click', e => { e.stopPropagation(); if (!menu.hidden) { closeMenu(); return; } menu.hidden = false; anim(menu, [{ opacity: 0, transform: 'translate3d(0,-6px,0) scale(.96)' }, { opacity: 1, transform: 'none' }], { d: 260, e: EASE.spring }); });
  menu.addEventListener('click', e => {
    const b = e.target.closest('[data-m]'); if (!b) return; const x = r();
    if (b.dataset.m === 'dup') { closeMenu(); addRoutine({ ...clone(x), id: 'r' + (uid++), name: x.name + ' (copia)' }); }
    if (b.dataset.m === 'color') { recolor(); }
    if (b.dataset.m === 'unpause') { x.pausedUntil = ''; closeMenu(); changed({ meta: true }); drawEditor(true); SH.toast(`«${x.name}» vuelve a estar en marcha.`); }
    if (b.dataset.m === 'del') { closeMenu(); delRoutine(x); }
  });
  $('#apPauseD', ed).addEventListener('change', e => { const x = r(); x.pausedUntil = e.target.value; changed({ meta: true }); SH.toast(x.pausedUntil ? `«${x.name}» en pausa hasta el ${fmtDate(x.pausedUntil)}.` : 'Pausa quitada.'); closeMenu(); setTimeout(() => drawEditor(true), 160); });
  $('#apRun', ed).addEventListener('click', () => runNow(r()));
  $('#apDry', ed).addEventListener('click', () => dryRun(r()));

  /* escenario: catálogo, elementos y ajustes */
  const st = $('#apStage', ed);
  st.addEventListener('input', e => {
    if (e.target.id === 'stQ') { query[step] = e.target.value; const g = $('#stGroups', st); g.innerHTML = catH(step); $$('.cg-it', g).forEach((b, i) => anim(b, [{ opacity: 0 }, { opacity: 1 }], { d: 200, delay: Math.min(i, 12) * 14 })); return; }
    const p = e.target.closest('[data-path]'); if (p && (p.type === 'text')) setParam(p.dataset.path, p.value);
  });
  st.addEventListener('change', e => {
    const p = e.target.closest('[data-path]'); if (p && p.tagName !== 'BUTTON' && p.type !== 'text') { const v = setParam(p.dataset.path, p.value); if (p.type === 'number') p.value = v; return; }
    const a = e.target.closest('[data-after]'); if (a && a.tagName !== 'BUTTON') { const x = r(); const k = a.dataset.after; x.after[k] = a.type === 'number' ? Math.max(+a.min, Math.min(+a.max, +a.value || +a.min)) : a.value; if (a.type === 'number') a.value = x.after[k]; changed(); }
  });
  st.addEventListener('pointerdown', e => { const g = e.target.closest('.si-grip'); if (g && step === 'a') startDrag(e, g.closest('.si')); });
  st.addEventListener('click', e => {
    const x = r();
    const add = e.target.closest('[data-add]'); if (add) {
      const list = listOf(x, step); list.push(newItem(step, add.dataset.add)); const i = list.length - 1;
      if (list.length === 1 || (step === 'c' && list.length === 2)) drawStage(0); else redrawList(i);
      if (list.length === 1) { const n = $(`#stList .si`, st); if (n) anim(n, [{ opacity: 0, transform: 'translate3d(0,10px,0) scale(.97)' }, { opacity: 1, transform: 'none' }], { d: 440, e: EASE.spring }); }
      const em = add.querySelector('em'); if (!em) add.insertAdjacentHTML('beforeend', '<em>añadido</em>');
      anim(add, [{ transform: 'scale(.97)' }, { transform: 'none' }], { d: 260, e: EASE.spring });
      changed(); return;
    }
    const gh = e.target.closest('.cg-h'); if (gh) { const g = gh.parentElement; g.classList.toggle('open'); const name = g.dataset.g; openGroups[step][g.classList.contains('open') ? 'add' : 'delete'](name); return; }
    const si = e.target.closest('.si');
    if (si) {
      const i = +si.dataset.i, list = listOf(x, step);
      if (e.target.closest('[data-rm]')) { anim(si, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translate3d(24px,0,0) scale(.97)' }], { d: 200 }).finished.then(() => { list.splice(i, 1); if (!list.length || (step === 'c' && list.length === 1)) drawStage(0); else redrawList(); const g = $('#stGroups', st); if (g) g.innerHTML = catH(step); changed(); }).catch(() => {}); return; }
      const mv = e.target.closest('[data-mv]'); if (mv && !mv.disabled) { const j = i + +mv.dataset.mv; [list[i], list[j]] = [list[j], list[i]]; redrawList(); const n = $(`#stList .si[data-i="${j}"]`, st); if (n) anim(n, [{ transform: `translate3d(0,${-mv.dataset.mv * 40}px,0)` }, { transform: 'none' }], { d: 420, e: EASE.spring }); changed(); return; }
      const sb = e.target.closest('[data-step]'); if (sb && sb.dataset.path) { const inp = $(`input[data-path="${sb.dataset.path}"]`, si); const spec = byK[step][list[i].k].p[sb.dataset.path.split(':')[2]]; const v = setParam(sb.dataset.path, +inp.value + (+sb.dataset.step) * (spec.step || 1)); inp.value = v; anim(inp, [{ transform: 'scale(1.12)' }, { transform: 'none' }], { d: 260, e: EASE.spring }); return; }
      const day = e.target.closest('.ap-day'); if (day) { const [, , k] = day.dataset.path.split(':'); const arr = list[i].p[k]; const d = +day.dataset.day; const at = arr.indexOf(d); if (at >= 0) arr.splice(at, 1); else arr.push(d); day.classList.toggle('on', arr.includes(d)); anim(day, [{ transform: 'scale(.85)' }, { transform: 'scale(1)' }], { d: 300, e: EASE.spring }); updateSay(i); changed(); return; }
      const mc = e.target.closest('.ap-mc'); if (mc) { const [, , k] = mc.dataset.path.split(':'); const arr = list[i].p[k]; const o = mc.dataset.opt; const at = arr.indexOf(o); if (at >= 0) arr.splice(at, 1); else arr.push(o); mc.classList.toggle('on', arr.includes(o)); updateSay(i); changed(); return; }
    }
    const sg = e.target.closest('.seg button'); if (sg && !sg.classList.contains('on')) {
      const s = sg.parentElement; $$('button', s).forEach(b => b.classList.toggle('on', b === sg)); SH.placeSeg(s); const k = s.dataset.seg, v = sg.dataset.v;
      if (k === 'condMode') { x.condMode = v; changed(); }
      else if (k === 'priority') { x.priority = v; changed(); }
      else if (k === 'nwhen') { x.notify.when = v; const p = $('#stPrev', st); p.innerHTML = previewToastH(v, x.notify.sound, x.name); p.classList.toggle('off', !x.notify.toast || v === 'never'); $('#stDot', st).classList.toggle('on', x.notify.tray && v !== 'never'); anim(p, [{ opacity: 0, transform: 'translate3d(30px,0,0)' }, { opacity: 1, transform: 'none' }], { d: 420, e: EASE.spring }); changed(); }
      else { x.after[k] = v; const row = $(`[data-after="${k === 'okThen' ? 'okRoutine' : k === 'failThen' ? 'failRoutine' : 'retries'}"]`, st); const box = row && row.closest('.sc-row');
        if (box) { const show = (k === 'onFail' && v === 'retry') || ((k === 'okThen' || k === 'failThen') && v === 'routine'); box.classList.toggle(k === 'onFail' ? 'dis' : 'hid', !show); if (show && k !== 'onFail') { const se = $('select', box); if (se && se.value) x.after[k === 'okThen' ? 'okRoutine' : 'failRoutine'] = se.value; } }
        changed(); }
      return;
    }
    const as = e.target.closest('[data-astep]'); if (as) { const k = as.dataset.after; const inp = $(`input[data-after="${k}"]`, st); const v = Math.max(+inp.min, Math.min(+inp.max, +inp.value + +as.dataset.astep)); inp.value = v; x.after[k] = v; anim(inp, [{ transform: 'scale(1.12)' }, { transform: 'none' }], { d: 260, e: EASE.spring }); changed(); return; }
    const at = e.target.closest('[data-atog]'); if (at) { const k = at.dataset.atog; x.after[k] = !x.after[k]; at.classList.toggle('on', x.after[k]); changed(); return; }
    const nt = e.target.closest('[data-ntog]'); if (nt) { const k = nt.dataset.ntog; x.notify[k] = !x.notify[k]; nt.classList.toggle('on', x.notify[k]); const p = $('#stPrev', st); if (p) { p.innerHTML = previewToastH(x.notify.when, x.notify.sound, x.name); p.classList.toggle('off', !x.notify.toast || x.notify.when === 'never'); $('#stDot', st).classList.toggle('on', x.notify.tray && x.notify.when !== 'never'); } changed(); return; }
  });
}
function closeMenu() {
  const menu = rEl && $('#apMenu', rEl); if (!menu || menu.hidden) return;
  anim(menu, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translate3d(0,-4px,0) scale(.97)' }], { d: 140 }).finished.then(() => { menu.hidden = true; }).catch(() => { menu.hidden = true; });
}
document.addEventListener('pointerdown', ev => { if (rEl && !ev.target.closest('.ap-more')) closeMenu(); });
function delRoutine(x) {
  const i = R.indexOf(x); const card = $(`.ap-card[data-id="${x.id}"]`, rEl);
  const go = () => { R.splice(i, 1); sel = R[0] && R[0].id; save(); drawRoutines(); if (calDirty) calDirty();
    SH.toast(`«${x.name}» borrada.`, { action: { label: 'Deshacer', run: () => { R.splice(i, 0, x); sel = x.id; save(); drawRoutines(); if (calDirty) calDirty(); } } }); };
  card ? anim(card, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translate3d(-20px,0,0) scale(.96)' }], { d: 220 }).finished.then(go).catch(go) : go();
}

/* ---------- probar en seco y ejecutar ---------- */
function evalCond(x) {
  const v = SH.tele.v, p = x.p, now = new Date(), wd = (now.getDay() + 6) % 7, t = hm(now);
  switch (x.k) {
    case 'plugged': return [!!v.charging, v.charging ? 'sí, está enchufado' : 'no, va con batería'];
    case 'battery': return [v.battery >= p.pct, `la batería está al ${Math.round(v.battery)} %`];
    case 'idle': return [false, 'lo estás usando ahora mismo'];
    case 'noFull': return [true, 'no hay nada a pantalla completa'];
    case 'cpu': return [v.cpu < p.pct, `el procesador va al ${Math.round(v.cpu)} %`];
    case 'noMeeting': return [true, 'micrófono y cámara libres'];
    case 'window': { const inW = p.from <= p.to ? (t >= p.from && t < p.to) : (t >= p.from || t < p.to); return [inW, `ahora son las ${t}`]; }
    case 'days': return [p.days.includes(wd), `hoy es ${DAYN[wd]}`];
    case 'unmetered': return [true, 'la conexión es normal'];
    case 'onWifi': return [p.ssid.toLowerCase() === 'casa', `estás en «Casa»`];
    case 'junk': return [18.6 >= p.gb, 'hay 18,6 GB de basura'];
    case 'diskFree': return [(p.drive === 'C:' ? 361 : 820) < p.gb, `${p.drive} tiene ${p.drive === 'C:' ? 361 : 820} GB libres`];
    case 'admin': return [!!state.admin, state.admin ? 'StellarHub es administrador' : 'StellarHub está en modo normal'];
    case 'notSince': { const last = LOG.find(l => l.rid === cur().id); const h = last ? (Date.now() - last.when) / 36e5 : Infinity; return [h >= p.hours, last ? `se ejecutó hace ${Math.max(1, Math.round(h))} h` : 'no se ha ejecutado nunca']; }
    case 'app': return [p.st === 'closed', `${p.app} está cerrado`];
  }
  return [true, ''];
}
const fmtDur = s => s < 60 ? `${Math.max(1, Math.round(s))} s` : `${Math.round(s / 60)} min`;
async function dryRun(r) {
  const box = $('#apDryP', rEl); if (!box) return;
  const ev = r.conds.map(x => [x, ...evalCond(x)]); const ok = !ev.length || (r.condMode === 'all' ? ev.every(e => e[1]) : ev.some(e => e[1]));
  const total = r.acts.reduce((s, x) => s + (x.k === 'wait' ? x.p.min * 60 : (byK.a[x.k].est || 10)), 0);
  const needsAdmin = r.acts.filter(x => byK.a[x.k].admin);
  box.innerHTML = `<div class="dry-h"><span class="dry-i">${ic('flask')}</span><div><b>Prueba en seco</b><span>Así iría si se disparase ahora. No se hace nada de verdad.</span></div><button class="iconbtn" data-close aria-label="Cerrar">${ic('x')}</button></div>
    <div class="dry-b">
      <div class="dry-s"><span class="dry-k">Cuándo</span>${r.triggers.length ? r.triggers.map(x => `<div class="dry-l">${ic(byK.t[x.k].ic)}<span>${esc(cap(sayOf('t', x)))}</span></div>`).join('') : '<div class="dry-l bad">' + ic('alert') + '<span>No tiene ningún momento elegido</span></div>'}</div>
      <div class="dry-s"><span class="dry-k">Condiciones${ev.length > 1 ? (r.condMode === 'all' ? ', todas' : ', alguna') : ''}</span>${ev.length ? ev.map(([x, o, d]) => `<div class="dry-l ${o ? 'ok' : 'bad'}">${ic(o ? 'check' : 'x')}<span>${esc(cap(sayOf('c', x)))}<em>${esc(d)}</em></span></div>`).join('') : '<div class="dry-l ok">' + ic('check') + '<span>Sin condiciones: siempre se ejecuta</span></div>'}</div>
      <div class="dry-verdict ${ok && r.acts.length ? 'ok' : 'bad'}">${ok ? (r.acts.length ? 'Se ejecutaría ahora.' : 'Se ejecutaría, pero no tiene acciones.') : 'Ahora no se ejecutaría: alguna condición no se cumple.'}</div>
      <div class="dry-s"><span class="dry-k">Haría, en este orden${r.acts.length ? `, unos ${fmtDur(total)}` : ''}</span>${r.acts.map((x, i) => `<div class="dry-l n">${'<em class="dn">' + (i + 1) + '</em>'}<span>${esc(cap(sayOf('a', x)))}${byK.a[x.k].admin && !state.admin ? '<em>se saltaría: necesita administrador</em>' : byK.a[x.k].decide && byK.a[x.k].decide(x.p) ? '<em>te preguntaría antes</em>' : ''}</span></div>`).join('') || '<div class="dry-l faint"><span>Nada todavía</span></div>'}</div>
      ${needsAdmin.length && !state.admin ? `<div class="dry-note">${ic('shield')}<span>${needsAdmin.length} ${needsAdmin.length === 1 ? 'acción necesita' : 'acciones necesitan'} el modo administrador. Actívalo para que se hagan.</span><button class="btn sec sm" data-admin>Activar</button></div>` : ''}
    </div>`;
  box.hidden = false;
  anim(box, [{ opacity: 0, transform: 'translate3d(0,14px,0) scale(.98)', filter: 'blur(6px)' }, { opacity: 1, transform: 'none', filter: 'blur(0px)' }], { d: 440, e: EASE.spring });
  $$('.dry-l, .dry-verdict, .dry-note', box).forEach((x, i) => anim(x, [{ opacity: 0, transform: 'translate3d(-8px,0,0)' }, { opacity: 1, transform: 'none' }], { d: 360, delay: 120 + i * 70, e: EASE.spring, keep: true }));
  box.onclick = e => {
    if (e.target.closest('[data-admin]')) { SH.go('admin'); return; }
    if (e.target.closest('[data-close]')) anim(box, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translate3d(0,10px,0) scale(.98)' }], { d: 180 }).finished.then(() => { box.hidden = true; }).catch(() => { box.hidden = true; });
  };
}
async function runNow(r) {
  if (!r.acts.length) { SH.toast('Esta rutina todavía no hace nada. Añádele una acción.', { action: { label: 'Añadir', run: () => setStep('a') } }); return; }
  const b = $('#apRun', rEl); const card = () => $(`.ap-card[data-id="${r.id}"]`, rEl);
  if (b) b.disabled = true; card() && card().classList.add('running');
  const steps = []; let gb = 0, upd = 0;
  for (let i = 0; i < r.acts.length; i++) {
    const x = r.acts[i], d = byK.a[x.k];
    const bb = $('#apRun', rEl); if (bb) bb.innerHTML = `${ic('clock')}<span class="lbl">Paso ${i + 1} de ${r.acts.length}</span>`;
    await wait(x.k === 'wait' ? 500 : 520 + Math.random() * 700);
    if (d.admin && !state.admin) { steps.push(['skip', `${cap(sayOf('a', x))}: se saltó, necesita el modo administrador`]); continue; }
    if (d.decide && d.decide(x.p)) { steps.push(['decide', `${cap(sayOf('a', x))}: 2 esperan tu visto bueno`]); continue; }
    if (x.k === 'clean') { const g = 1.2 + Math.random() * 5; gb += g; steps.push(['ok', `Limpieza: ${fmt1(g)} GB liberados`]); continue; }
    if (x.k === 'apps') { upd += 3; steps.push(['ok', 'Programas: 3 actualizados']); continue; }
    steps.push(['ok', `${cap(sayOf('a', x))}: hecho (simulado)`]);
  }
  const st = steps.some(s => s[0] === 'bad') ? 'bad' : steps.some(s => s[0] === 'skip' || s[0] === 'decide') ? 'warn' : 'ok';
  const res = []; if (gb) res.push(`${fmt1(gb)} GB liberados`); if (upd) res.push(`${upd} programas actualizados`); const sk = steps.filter(s => s[0] === 'skip').length; if (sk) res.push(`${sk} ${sk === 1 ? 'paso saltado' : 'pasos saltados'}`);
  LOG.unshift({ rid: r.id, when: new Date(), name: r.name, color: r.color || 0, st, gb, upd, manual: true, res: res.length ? res : ['Hecho'], steps, fresh: true });
  saveLog();
  const bb = $('#apRun', rEl); if (bb) { bb.disabled = false; bb.innerHTML = `${ic('play')}<span class="lbl">Ejecutar ahora</span>`; }
  card() && card().classList.remove('running'); refreshCard(r); refreshMeta();
  if (lEl) drawLog(true); if (mctx) mctx.setBadge('log', LOG.filter(l => l.st === 'warn' || l.st === 'bad').length);
  SH.toast(`«${r.name}» terminada.`, { action: { label: 'Ver el registro', run: () => SH.go('autopilot', { tab: 'log' }) } });
}

/* ================= Calendario ================= */
let calOff = 0, cEl = null, calDirty = null;
function weekStart(off) { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7) + off * 7); return d; }
function renderCalendar(el) {
  ensure(); cEl = el; el.classList.add('fill');
  el.innerHTML = `<div class="cal">
    <div class="pan cal-main" data-asm>
      <div class="cal-bar"><button class="iconbtn" data-w="-1" aria-label="Semana anterior">${ic('chev')}</button><button class="iconbtn" data-w="1" aria-label="Semana siguiente">${ic('chev')}</button>
        <b class="cal-t" id="calT"></b><button class="btn ghost sm" data-w="0">Hoy</button><span class="faint cal-legend" id="calLeg"></span></div>
      <div class="cal-grid" id="calGrid"></div></div>
    <div class="cal-side">
      <div class="pan cal-up" data-asm><div class="pan-h">Esta semana</div><div class="cal-ul" id="calUp"></div></div>
      <div class="pan cal-fr" data-asm><div class="pan-h">Sin hora fija</div><div class="cal-ul" id="calFree"></div></div></div></div>`;
  $('.cal-bar', el).addEventListener('click', e => { const b = e.target.closest('[data-w]'); if (!b) return; const w = +b.dataset.w; const dir = w === 0 ? (calOff > 0 ? -1 : 1) : w; if (w === 0 && calOff === 0) return; calOff = w === 0 ? 0 : calOff + w; drawCal(dir); });
  el.addEventListener('click', e => { if (e.target.closest('[data-new]')) newRoutine(); const ev = e.target.closest('[data-rid]'); if (ev) { sel = ev.dataset.rid; SH.go('autopilot', { tab: 'routines' }); setTimeout(() => { if (rEl) drawRoutines(); }, 60); } });
  calDirty = () => { if (cEl && cEl.classList.contains('on')) drawCal(0); };
  drawCal(0);
}
function drawCal(dir) {
  const el = cEl; const ws = weekStart(calOff), we = new Date(ws); we.setDate(we.getDate() + 7);
  const last = new Date(we); last.setDate(last.getDate() - 1);
  $('#calT', el).textContent = `${ws.getDate()} ${MON3[ws.getMonth()]} – ${last.getDate()} ${MON3[last.getMonth()]} ${last.getFullYear()}`;
  const today = new Date(); const todayIdx = calOff === 0 ? (today.getDay() + 6) % 7 : -1;
  const ev = []; R.forEach(r => { const perDay = {}; occ(r, ws, we).forEach(o => { const k = o.d.toDateString(); perDay[k] = (perDay[k] || 0) + 1; if (perDay[k] <= 6) ev.push({ r, d: o.d }); }); });
  const minH = ev.length ? Math.min(6, ...ev.map(e => e.d.getHours())) : 6; const H0 = minH, H1 = 24;
  const hours = Array.from({ length: H1 - H0 }, (_, i) => H0 + i);
  const grid = $('#calGrid', el);
  grid.style.setProperty('--rows', H1 - H0);
  grid.innerHTML = `<div class="cg-head"><span></span>${DAYS3.map((d, i) => { const x = new Date(ws); x.setDate(x.getDate() + i); return `<span class="${i === todayIdx ? 'today' : ''}">${d} <b>${x.getDate()}</b></span>`; }).join('')}</div>
    <div class="cg-body"><div class="cg-hours">${hours.map(h => `<span>${pad(h)}:00</span>`).join('')}</div>
    ${DAYS3.map((_, i) => `<div class="cg-col${i === todayIdx ? ' today' : ''}">${ev.filter(e => (e.d.getDay() + 6) % 7 === i).map(e => { const h = e.d.getHours() + e.d.getMinutes() / 60; const past = e.d < today;
      return `<button class="cg-ev${past ? ' past' : ''}" data-rid="${e.r.id}" style="--top:${((h - H0) / (H1 - H0) * 100).toFixed(3)}%;--c:${colorOf(e.r)}"><b>${hm(e.d)}</b><span>${esc(e.r.name)}</span>
        <span class="cg-tip"><b>${esc(e.r.name)}</b>${e.r.acts.slice(0, 5).map(a => `<span>${esc(cap(sayOf('a', a)))}</span>`).join('')}${e.r.acts.length > 5 ? `<span>y ${e.r.acts.length - 5} más</span>` : ''}</span></button>`; }).join('')}
      ${i === todayIdx ? `<i class="cg-now" style="--top:${(Math.max(0, Math.min(1, (today.getHours() + today.getMinutes() / 60 - H0) / (H1 - H0))) * 100).toFixed(3)}%"></i>` : ''}</div>`).join('')}</div>
    ${!R.length ? `<div class="cal-empty"><span>${ic('calendar')}</span><b>Aún no hay nada programado</b><p>Cuando crees rutinas con fecha u hora, aparecerán aquí.</p><button class="btn pri" data-new>${ic('plus')}Crear una rutina</button></div>` : ''}`;
  const up = ev.filter(e => e.d >= today).sort((a, b) => a.d - b.d);
  $('#calUp', el).innerHTML = up.length ? up.slice(0, 12).map(e => `<button class="cal-row" data-rid="${e.r.id}" style="--c:${colorOf(e.r)}"><i></i><div><b>${esc(e.r.name)}</b><span>${esc(cap(relDay(e.d)))} a las ${hm(e.d)}</span></div></button>`).join('')
    : `<div class="cal-none">${R.length ? 'Nada más esta semana.' : 'Sin rutinas todavía.'}</div>`;
  const free = R.filter(r => r.on && r.triggers.some(x => !byK.t[x.k].sched));
  $('#calFree', el).innerHTML = free.length ? free.map(r => `<button class="cal-row" data-rid="${r.id}" style="--c:${colorOf(r)}"><i></i><div><b>${esc(r.name)}</b><span>${esc(cap(join(r.triggers.filter(x => !byK.t[x.k].sched).map(x => sayOf('t', x)), ' o ')))}</span></div></button>`).join('')
    : `<div class="cal-none">Las rutinas que dependen de algo que pasa (encender el PC, desenchufar, abrir un programa…) aparecerán aquí.</div>`;
  $('#calLeg', el).textContent = ev.length ? `${ev.length} ${ev.length === 1 ? 'ejecución' : 'ejecuciones'} esta semana` : 'Nada programado esta semana';
  if (dir) anim(grid, [{ opacity: 0, transform: `translate3d(${dir * 40}px,0,0)`, filter: 'blur(6px)' }, { opacity: 1, transform: 'none', filter: 'blur(0px)' }], { d: 440, e: EASE.spring });
  $$('.cg-ev', grid).forEach((e, i) => anim(e, [{ opacity: 0, transform: 'scale(.85)' }, { opacity: 1, transform: 'none' }], { d: 380, delay: 80 + i * 30, e: EASE.spring, keep: true }));
  const em = $('.cal-empty', grid); if (em) anim(em, [{ opacity: 0, transform: 'translate3d(-50%,-46%,0) scale(.96)' }, { opacity: 1, transform: 'translate3d(-50%,-50%,0)' }], { d: 520, delay: 120, e: EASE.spring });
}

/* ================= Avisos (generales) ================= */
function renderNotify(el) {
  ensure();
  const row = (k, n, d) => `<div class="nt-row"><div class="rt"><b>${n}</b>${d ? `<span>${d}</span>` : ''}</div>${togH(`data-nt="${k}"`, NT[k], n)}</div>`;
  el.innerHTML = `<div class="nt">
    <div class="pan nt-a" data-asm><div class="pan-h">Dónde te avisa</div>
      ${row('toast', 'Notificación de Windows', 'Abajo a la derecha, como las de cualquier app.')}${row('tray', 'Punto en el icono de la bandeja', 'Discreto: un punto de color hasta que lo abras.')}${row('sound', 'Sonido suave', 'Solo al terminar o si hay algo que decidir.')}</div>
    <div class="pan nt-b" data-asm><div class="pan-h">Cuándo, si la rutina no dice otra cosa</div>
      ${segH('when', [['always', 'Siempre'], ['decide', 'Si hay que decidir'], ['errors', 'Si algo falla']], NT.when)}<p class="faint nt-p" id="ntWhenD"></p>
      ${row('batterySaver', 'Menos avisos con batería', 'Con el ahorro de batería de Windows, solo lo importante.')}</div>
    <div class="pan nt-prev" data-asm><div class="pan-h">Vista previa</div><div class="nt-desk"><div class="nt-toast" id="ntPrev"></div><div class="nt-tray"><span class="nt-ti">${ic('home')}<i id="ntDot"></i></span><span class="faint">${hm(new Date())}</span></div></div></div>
    <div class="pan nt-c" data-asm><div class="pan-h">Silencio</div>
      ${row('quiet', 'Horas de silencio', 'Las rutinas se ejecutan igual, pero sin avisar.')}
      <div class="nt-q${NT.quiet ? '' : ' dis'}" id="ntQ"><label>De <input type="time" class="field" data-q="qFrom" value="${NT.qFrom}"></label><label>a <input type="time" class="field" data-q="qTo" value="${NT.qTo}"></label></div>
      ${row('noGame', 'No molestar mientras juegas', 'Ni avisos ni rutinas pesadas con algo a pantalla completa.')}</div>
    <div class="pan nt-d" data-asm><div class="pan-h">Resumen semanal</div>
      ${row('weekly', 'Un aviso con todo lo de la semana', 'Lo que hicieron tus rutinas, lo liberado y lo pendiente.')}
      <div class="nt-wd${NT.weekly ? '' : ' dis'}" id="ntWd"><span class="faint">El</span>${segH('weeklyDay', DAYS.map((d, i) => [i, d]), NT.weeklyDay)}</div></div>
  </div>`;
  const WHEN_D = { always: 'Un aviso cada vez que termina una rutina.', decide: 'Solo cuando hay algo que confirmar, como instalar un driver. Lo demás pasa en silencio.', errors: 'Solo si algo no salió bien. Lo demás lo verás en el registro.' };
  const preview = anim0 => { const p = $('#ntPrev', el);
    p.innerHTML = previewToastH(NT.when, NT.sound, 'Mantenimiento semanal'); p.classList.toggle('off', !NT.toast);
    if (NT.toast && anim0) anim(p, [{ opacity: 0, transform: 'translate3d(40px,0,0)' }, { opacity: 1, transform: 'none' }], { d: 480, e: EASE.spring });
    $('#ntDot', el).classList.toggle('on', NT.tray); $('#ntWhenD', el).textContent = WHEN_D[NT.when]; };
  preview(true);
  el.addEventListener('click', e => {
    const t = e.target.closest('[data-nt]'); if (t) { const k = t.dataset.nt; NT[k] = !NT[k]; t.classList.toggle('on', NT[k]); if (k === 'quiet') $('#ntQ', el).classList.toggle('dis', !NT.quiet); if (k === 'weekly') $('#ntWd', el).classList.toggle('dis', !NT.weekly); saveNT(); preview(['toast', 'sound'].includes(k)); return; }
    const b = e.target.closest('.seg button'); if (b) { const s = b.parentElement; if (b.classList.contains('on')) return; $$('button', s).forEach(x => x.classList.toggle('on', x === b)); SH.placeSeg(s); NT[s.dataset.seg] = s.dataset.seg === 'weeklyDay' ? +b.dataset.v : b.dataset.v; saveNT(); preview(s.dataset.seg === 'when'); }
  });
  $$('[data-q]', el).forEach(i => i.addEventListener('change', e => { NT[i.dataset.q] = e.target.value; saveNT(); }));
  requestAnimationFrame(() => $$('.seg', el).forEach(s => SH.placeSeg(s, true)));
}

/* ================= Registro ================= */
let lEl = null, logFilter = 'all';
function renderLog(el) {
  ensure(); lEl = el; el.classList.add('fill');
  el.innerHTML = `<div class="lgw">
    <div class="pan lg-main" data-asm><div class="lg-h"><div class="pan-h">Ejecuciones</div>${segH('f', [['all', 'Todas'], ['issues', 'Con avisos o fallos']], logFilter, 'sm')}</div><div id="lgList" class="lg-list"></div></div>
    <div class="lg-side">
      <div class="pan lg-st" data-asm><div class="pan-h">Este mes</div>
        <div class="lg-n"><b class="big" id="lgN">0</b><span>ejecuciones</span></div>
        <div class="lg-n"><b class="big" id="lgGB">0</b><span>GB liberados</span></div>
        <div class="lg-n"><b class="big" id="lgU">0</b><span>programas y drivers al día</span></div>
        <div class="lg-n"><b class="big" id="lgW">0</b><span>con avisos o fallos</span></div></div>
      <div class="pan lg-by" data-asm><div class="pan-h">Por rutina</div><div id="lgBy" class="lg-byl"></div></div>
    </div></div>`;
  const s = $('.lg-h .seg', el);
  s.addEventListener('click', e => { const b = e.target.closest('button'); if (!b || b.classList.contains('on')) return; $$('button', s).forEach(x => x.classList.toggle('on', x === b)); SH.placeSeg(s); logFilter = b.dataset.v; drawLog(true); });
  $('#lgList', el).addEventListener('click', e => { if (e.target.closest('[data-goto]')) { SH.go('autopilot', { tab: 'routines' }); return; } const h = e.target.closest('.lg-hd'); if (h) h.parentElement.classList.toggle('open'); });
  requestAnimationFrame(() => SH.placeSeg(s, true));
  drawLog(false);
}
function drawLog(anims) {
  const el = lEl; if (!el) return;
  const items = LOG.filter(l => logFilter === 'all' || l.st !== 'ok');
  const ST = { ok: ['ok', 'Hecho'], warn: ['warn', 'Con avisos'], skip: ['', 'Saltada'], bad: ['bad', 'Falló'] };
  const SI = { ok: 'check', decide: 'info', skip: 'clock', bad: 'alert' };
  let day = '', html = '';
  items.forEach(l => { const dl = pastDay(l.when); if (dl !== day) { day = dl; html += `<div class="lg-day">${esc(dl)}</div>`; }
    html += `<div class="lg-it${l.fresh ? ' fresh' : ''}" style="--c:${COLORS[(l.color || 0) % COLORS.length]}"><button class="lg-hd"><span class="lg-t">${hm(l.when)}</span><i class="lg-dot"></i><span class="rt"><b>${esc(l.name)}${l.manual ? ' <em>a mano</em>' : ''}</b><span>${l.res.map(esc).join(', ')}</span></span><span class="chip ${ST[l.st][0]}">${ST[l.st][1]}</span>${ic('chevd')}</button>
      <div class="lg-d"><div><div class="lg-steps">${l.steps.map(([k, t]) => `<div class="lg-s ${k}">${ic(SI[k] || 'check')}<span>${esc(t)}</span></div>`).join('')}</div></div></div></div>`; });
  const list = $('#lgList', el);
  list.innerHTML = html || (LOG.length
    ? '<div class="lg-empty"><span>' + ic('check') + '</span><b>Nada con avisos ni fallos</b><p>Todo lo que se ejecutó salió bien.</p></div>'
    : `<div class="lg-empty"><span>${ic('list')}</span><b>Todavía no se ha ejecutado nada</b><p>Cuando una rutina se ejecute, aquí verás qué hizo, paso a paso: lo liberado, lo actualizado y lo que necesitó tu visto bueno.</p><button class="btn sec" data-goto>${ic('autopilot')}Ir a las rutinas</button></div>`);
  LOG.forEach(l => l.fresh = false);
  if (anims) $$('.lg-it, .lg-day', list).forEach((x, i) => anim(x, [{ opacity: 0, transform: 'translate3d(0,8px,0)' }, { opacity: 1, transform: 'none' }], { d: 380, delay: Math.min(i, 12) * 28, e: EASE.spring }));
  const now = new Date(); const month = LOG.filter(l => l.when.getMonth() === now.getMonth() && l.when.getFullYear() === now.getFullYear());
  const n = month.length, gb = month.reduce((s, l) => s + (l.gb || 0), 0), u = month.reduce((s, l) => s + (l.upd || 0), 0), w = month.filter(l => l.st !== 'ok').length;
  const setN = (id, v, dec) => { const e = $(id, el); if (+e.dataset.v !== v) SH.countUp(e, v, 800, dec); };
  setN('#lgN', n); setN('#lgGB', +gb.toFixed(1), 1); setN('#lgU', u); setN('#lgW', w);
  const by = {}; LOG.forEach(l => { by[l.name] = by[l.name] || { n: 0, c: l.color || 0 }; by[l.name].n++; });
  const ent = Object.entries(by).sort((a, b) => b[1].n - a[1].n); const max = ent.length ? ent[0][1].n : 1;
  $('#lgBy', el).innerHTML = ent.length ? ent.map(([name, v]) => `<div class="lg-bi" style="--c:${COLORS[v.c % COLORS.length]}"><div><b>${esc(name)}</b><span>${v.n} ${v.n === 1 ? 'vez' : 'veces'}</span></div><span class="bar"><span style="transform:scaleX(${(v.n / max).toFixed(3)})"></span></span></div>`).join('')
    : '<div class="cal-none">Cuando haya ejecuciones, verás aquí cuántas veces corrió cada rutina.</div>';
}

/* ================= registro del módulo ================= */
let mctx = null;
function newRoutine() {
  ensure(); if (mctx) mctx.setTab('routines');
  const make = () => { if (!rEl) return; step = 't'; addRoutine(mk({ color: R.length % COLORS.length }), true);
    setTimeout(() => { const n = $('#apName', rEl); if (n) { n.focus(); n.select(); } }, 480); };
  rEl ? setTimeout(make, 60) : setTimeout(make, 380);
}
document.addEventListener('click', e => { if (rEl && rEl.isConnected && e.target.closest('#v-autopilot .ap-empty [data-new]')) newRoutine(); const t = e.target.closest('#v-autopilot [data-tpl]'); if (t && rEl) { step = 't'; addRoutine(TEMPLATES[+t.dataset.tpl].r()); } });
SH.module({
  id: 'autopilot',
  actions(el, ctx) {
    mctx = ctx; el.innerHTML = `<button class="btn pri" id="apNew">${ic('plus')}Nueva rutina</button>`;
    $('#apNew', el).addEventListener('click', newRoutine);
  },
  renderTab(tab, el) { ({ routines: renderRoutines, calendar: renderCalendar, notify: renderNotify, log: renderLog })[tab](el); },
  enterTab(tab) {
    if (tab === 'calendar' && cEl) drawCal(0);
    if (tab === 'routines' && rEl) { if (R.length && $('#apList', rEl)) { drawList(); refreshMeta(); } else drawRoutines(); }
    if (tab === 'log' && lEl) drawLog(false);
  },
  enter() { ensure(); if (mctx) mctx.setBadge('log', LOG.filter(l => l.st === 'warn' || l.st === 'bad').length); },
});
SH.actions.add([
  { t: 'Crear una rutina automática', go: 'autopilot', tab: 'routines', ic: 'autopilot' },
  { t: 'Ver cuándo se ejecutan las rutinas', go: 'autopilot', tab: 'calendar', ic: 'calendar' },
  { t: 'Cambiar cómo me avisa Autopilot', go: 'autopilot', tab: 'notify', ic: 'bell' },
  { t: 'Ver lo que hizo Autopilot', go: 'autopilot', tab: 'log', ic: 'list' },
]);
})();
