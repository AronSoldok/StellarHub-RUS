/* StellarHub · Super Optimizer. Interfaz completa con datos simulados; la API mock imita lo que devolverá Python. */
'use strict';
(() => {
const { $, $$, anim, EASE, ic, esc, fmt1, state } = SH;
const wait = ms => new Promise(r => setTimeout(r, ms));
const gb = b => b >= 1e9 ? fmt1(b / 1e9) + ' GB' : Math.max(0, Math.round(b / 1e6)) + ' MB';
const sec = s => fmt1(s) + ' s';
const isMin = () => state.settings.intensity === 'min';

SH.icons.add({
  reg: '<path d="M4 5.5h7v5H4zM13 5.5h7v5h-7zM4 13.5h7v5H4z"/><path d="M15 15.5h3M16.5 14v3"/>',
  scan: '<path d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16"/><path d="M4 12h16"/>',
  service: '<circle cx="12" cy="12" r="3.5"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/>',
  terminal: '<rect x="3" y="4.5" width="18" height="15" rx="2"/><path d="m7 9.5 3 2.5-3 2.5M12.5 15H17"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
});

/* ================= datos (lo que devolverá Python) ================= */
const DB = {
  clean: [
    { id: 'user_temp', g: 'Windows', label: 'Temporales del usuario', size: 2.84e9, files: 18342, def: true, desc: 'Lo que los programas dejan en %TEMP%. Se respetan los de la última hora.', paths: ['C:\\Users\\usuario\\AppData\\Local\\Temp'] },
    { id: 'win_temp', g: 'Windows', label: 'Temporales de Windows', size: .61e9, files: 2210, def: true, admin: true, desc: 'Restos de instalaciones y tareas del sistema.', paths: ['C:\\Windows\\Temp'] },
    { id: 'thumbs', g: 'Windows', label: 'Caché de miniaturas', size: .42e9, files: 14, def: true, desc: 'Windows las vuelve a crear al abrir las carpetas.', paths: ['C:\\Users\\usuario\\AppData\\Local\\Microsoft\\Windows\\Explorer\\thumbcache_*.db'] },
    { id: 'dumps', g: 'Windows', label: 'Volcados de errores e informes', size: 1.37e9, files: 41, def: true, desc: 'Copias de memoria de programas que se cerraron mal. Solo sirven para depurar.', paths: ['C:\\Users\\usuario\\AppData\\Local\\CrashDumps', 'C:\\Windows\\Minidump', 'C:\\ProgramData\\Microsoft\\Windows\\WER'] },
    { id: 'wu', g: 'Windows', label: 'Descargas de Windows Update', size: 2.31e9, files: 512, def: false, admin: true, desc: 'Actualizaciones ya instaladas. Desmarcado: si una falla, Windows tendría que volver a descargarla.', paths: ['C:\\Windows\\SoftwareDistribution\\Download'] },
    { id: 'do', g: 'Windows', label: 'Optimización de distribución', size: 1.18e9, files: 96, def: false, admin: true, desc: 'Trozos de actualizaciones que tu PC comparte con otros equipos.', paths: ['C:\\Windows\\ServiceProfiles\\NetworkService\\AppData\\Local\\Microsoft\\Windows\\DeliveryOptimization'] },
    { id: 'logs', g: 'Windows', label: 'Registros de Windows y programas', size: .29e9, files: 1630, def: true, desc: 'Archivos .log y .etl antiguos.', paths: ['C:\\Windows\\Logs', 'C:\\Windows\\Panther'] },
    { id: 'recycle', g: 'Windows', label: 'Papelera de reciclaje', size: 2.06e9, files: 311, def: true, desc: 'Lo que borraste. Después de vaciarla no se puede recuperar.', paths: ['Todas las unidades'] },
    { id: 'brave', g: 'Navegadores', label: 'Brave', size: 1.94e9, files: 9210, def: true, busy: 'brave.exe', desc: 'Caché de páginas, código y GPU. No toca contraseñas, historial ni pestañas.', paths: ['…\\BraveSoftware\\Brave-Browser\\User Data\\Default\\Cache', '…\\Code Cache', '…\\GPUCache'] },
    { id: 'edge', g: 'Navegadores', label: 'Microsoft Edge', size: .71e9, files: 4022, def: true, desc: 'Caché de páginas, código y GPU.', paths: ['…\\Microsoft\\Edge\\User Data\\Default\\Cache'] },
    { id: 'chrome', g: 'Navegadores', label: 'Google Chrome', size: .38e9, files: 2118, def: true, desc: 'Caché de páginas, código y GPU.', paths: ['…\\Google\\Chrome\\User Data\\Default\\Cache'] },
    { id: 'discord', g: 'Aplicaciones', label: 'Discord', size: .52e9, files: 3311, def: true, desc: 'Imágenes y vídeos ya vistos.', paths: ['C:\\Users\\usuario\\AppData\\Roaming\\discord\\Cache'] },
    { id: 'spotify', g: 'Aplicaciones', label: 'Spotify', size: .88e9, files: 640, def: true, desc: 'Canciones en caché que no están descargadas para escuchar sin conexión.', paths: ['C:\\Users\\usuario\\AppData\\Local\\Spotify\\Data'] },
    { id: 'steam', g: 'Aplicaciones', label: 'Steam (navegador interno)', size: .33e9, files: 2804, def: true, desc: 'Caché de la tienda y la comunidad.', paths: ['C:\\Users\\usuario\\AppData\\Local\\Steam\\htmlcache'] },
    { id: 'shader', g: 'Aplicaciones', label: 'Sombreadores de NVIDIA y DirectX', size: 1.8e9, files: 744, def: false, desc: 'Los juegos los regeneran; tras limpiar, la primera partida puede tardar más en cargar.', paths: ['C:\\Users\\usuario\\AppData\\Local\\NVIDIA\\DXCache', '…\\NVIDIA\\GLCache', '…\\D3DSCache'] },
    { id: 'orphans', g: 'Restos de programas', label: 'Programas desinstalados', size: .96e9, files: 5120, def: true, desc: 'Carpetas que dejaron programas que ya no están instalados.', paths: ['C:\\Users\\usuario\\AppData\\Local\\Movavi Video Editor 26 (640 MB)', 'C:\\Users\\usuario\\AppData\\Roaming\\AutoTunePro9 (212 MB)', 'C:\\ProgramData\\OldUpdaterCache (108 MB)'] },
  ],
  boots: [21.4, 19.8, 22.9, 20.6, 19.1, 21.7, 20.3],
  bios: 7.0,
  /* lo mismo que enseña el Administrador de tareas > Aplicaciones de arranque.
     origin: registro (Run de HKCU/HKLM), carpeta (Inicio), tienda (StartupTask de apps de la Tienda), tarea, servicio */
  startup: [
    { id: 'sechealth', name: 'SecurityHealthSystray.exe', pub: 'Microsoft Corporation', on: true, impact: 'bajo', origin: 'registro', path: 'HKLM\\…\\CurrentVersion\\Run\\SecurityHealth', target: 'C:\\Windows\\System32\\SecurityHealthSystray.exe', note: 'El icono de Seguridad de Windows en la bandeja. Conviene dejarlo.' },
    { id: 'wscript', name: 'wscript.exe', count: 3, pub: '', on: true, impact: 'alto', origin: 'carpeta', review: true, path: 'Carpeta Inicio de tu usuario', target: 'C:\\Windows\\System32\\wscript.exe', note: 'Tres scripts .vbs que se ejecutan al iniciar sesión. Revisa qué son antes de tocarlos: pueden ser tuyos.',
      children: ['%APPDATA%\\Microsoft\\Windows\\Start Menu\\Programs\\Startup\\script 1.vbs', '%APPDATA%\\Microsoft\\Windows\\Start Menu\\Programs\\Startup\\script 2.vbs', '%APPDATA%\\Microsoft\\Windows\\Start Menu\\Programs\\Startup\\script 3.vbs'] },
    { id: 'xbox', name: 'XBOX', pub: 'Microsoft Corporation', on: false, impact: 'ninguno', origin: 'tienda', path: 'StartupTask de la app Xbox' },
    { id: 'copilot', name: 'Copilot', pub: 'Microsoft Corporation', on: false, impact: 'ninguno', origin: 'tienda', path: 'StartupTask de la app Copilot' },
    { id: 'claude', name: 'Claude', pub: 'Anthropic, PBC', on: false, impact: 'ninguno', origin: 'tienda', path: 'StartupTask de la app Claude' },
    { id: 'spotify', name: 'Spotify', pub: 'Spotify AB', on: false, impact: 'ninguno', origin: 'tienda', path: 'StartupTask de la app Spotify' },
    { id: 'phonelink', name: 'Dispositivos móviles', pub: 'Microsoft Windows', on: false, impact: 'ninguno', origin: 'tienda', path: 'StartupTask de Dispositivos móviles' },
    { id: 'yourphone', name: 'Enlace Móvil', pub: 'Microsoft Corporation', on: false, impact: 'ninguno', origin: 'tienda', path: 'StartupTask de Enlace Móvil' },
    { id: 'intelgs', name: 'Intel® Graphics Software', pub: 'INTEL CORP', on: false, impact: 'ninguno', origin: 'tienda', path: 'StartupTask de Intel Graphics Software' },
    { id: 'terminal', name: 'Terminal', pub: 'Microsoft Corporation', on: false, impact: 'ninguno', origin: 'tienda', path: 'StartupTask de Windows Terminal' },
    { id: 'intelgcc', name: 'Intel® Graphics Command Center', pub: 'INTEL CORP', on: false, impact: 'ninguno', origin: 'tienda', path: 'StartupTask de Intel Graphics Command Center' },
    { id: 'teams', name: 'Microsoft Teams', pub: 'Microsoft', on: false, impact: 'ninguno', origin: 'tienda', path: 'StartupTask de Microsoft Teams' },
    { id: 'epic', name: 'EpicGamesLauncher.exe', pub: '', on: false, impact: 'ninguno', origin: 'registro', path: 'HKCU\\…\\CurrentVersion\\Run\\EpicGamesLauncher' },
    { id: 'roblox', name: 'RobloxPlayerBeta.exe', pub: '', on: false, impact: 'ninguno', origin: 'registro', path: 'HKCU\\…\\CurrentVersion\\Run\\Roblox' },
    { id: 'proton', name: 'ProtonVPN.Launcher.exe', pub: '', on: false, impact: 'ninguno', origin: 'registro', path: 'HKCU\\…\\CurrentVersion\\Run\\ProtonVPN' },
    { id: 'dawn', name: 'Dawn (Feather).exe', pub: '', on: false, impact: 'ninguno', origin: 'registro', path: 'HKCU\\…\\CurrentVersion\\Run\\Dawn' },
    { id: 'kpm', name: 'kpm.exe', pub: '', on: false, impact: 'ninguno', origin: 'registro', path: 'HKCU\\…\\CurrentVersion\\Run\\kpm' },
    { id: 'steam', name: 'steam.exe', pub: '', on: false, impact: 'ninguno', origin: 'registro', path: 'HKCU\\…\\CurrentVersion\\Run\\Steam' },
    { id: 'onedrive', name: 'OneDrive.exe', pub: '', on: false, impact: 'ninguno', origin: 'registro', path: 'HKCU\\…\\CurrentVersion\\Run\\OneDrive' },
  ],
  services: [
    { id: 'DiagTrack', name: 'Telemetría de Windows', desc: 'Envía datos de uso y diagnóstico a Microsoft.', run: true, start: 'auto', bal: 'manual', max: 'disabled' },
    { id: 'Spooler', name: 'Cola de impresión', desc: 'Necesaria para imprimir. Tu PC no tiene impresoras instaladas.', run: true, start: 'auto', bal: 'manual', max: 'disabled', warn: 'Si algún día imprimes, vuelve a activarlo.' },
    { id: 'Fax', name: 'Fax', desc: 'Enviar y recibir faxes.', run: false, start: 'manual', bal: 'disabled', max: 'disabled' },
    { id: 'RetailDemo', name: 'Modo demostración de tienda', desc: 'Solo lo usan los PC de exposición.', run: false, start: 'manual', bal: 'disabled', max: 'disabled' },
    { id: 'MapsBroker', name: 'Mapas descargados', desc: 'Actualiza mapas sin conexión de la app Mapas.', run: false, start: 'auto', bal: 'manual', max: 'disabled' },
    { id: 'WerSvc', name: 'Informe de errores', desc: 'Envía a Microsoft los informes cuando algo falla.', run: false, start: 'manual', bal: null, max: 'disabled' },
    { id: 'SysMain', name: 'SysMain (precarga de apps)', desc: 'Carga en memoria las apps que más usas. En un SSD rápido apenas se nota.', run: true, start: 'auto', bal: null, max: 'manual' },
    { id: 'WSearch', name: 'Indexado de búsqueda', desc: 'Prepara el índice para buscar archivos al instante.', run: true, start: 'auto', bal: null, max: 'manual', warn: 'Buscar archivos desde Inicio será más lento.' },
    { id: 'Xbox', name: 'Servicios de Xbox', desc: 'Inicio de sesión, partidas guardadas y red de Xbox Live.', run: false, start: 'manual', bal: null, max: 'disabled', warn: 'Si juegas con Game Pass o la app de Xbox, déjalos.' },
    { id: 'lfsvc', name: 'Geolocalización', desc: 'Da tu ubicación a las apps que la piden.', run: true, start: 'manual', bal: null, max: 'disabled', warn: 'Las apps que usan tu ubicación dejarán de saberla.' },
    { id: 'RemoteRegistry', name: 'Registro remoto', desc: 'Permite cambiar el registro desde otro equipo.', run: false, start: 'disabled', bal: 'disabled', max: 'disabled' },
  ],
  registry: [
    { g: 'Desinstaladores rotos', items: [
      ['HKLM\\…\\Uninstall\\Movavi Video Editor 26', 'El desinstalador C:\\Program Files\\Movavi Video Editor 26\\uninst.exe ya no existe.'],
      ['HKCU\\…\\Uninstall\\AutoTunePro9', 'Apunta a una carpeta que se borró a mano.'] ] },
    { g: 'Rutas de programa rotas', items: [
      ['HKLM\\…\\App Paths\\blender.exe', 'Apunta a Blender 4.1, que ya no está; tienes la 4.2 en otra carpeta.'],
      ['HKLM\\…\\App Paths\\CapCut.exe', 'Apunta a una versión antigua de CapCut.'],
      ['HKCU\\…\\App Paths\\movavi.exe', 'El archivo ya no existe.'] ] },
    { g: 'Tipos de archivo huérfanos', items: [
      ['HKCR\\.mepx', 'Proyecto de Movavi: ningún programa lo abre.'],
      ['HKCR\\.mvd', 'Ningún programa instalado lo abre.'],
      ['HKCR\\Movavi.VideoEditor.26', 'Clase de un programa desinstalado.'],
      ['HKCR\\.atp9', 'Preset de un plugin desinstalado.'],
      ['HKCR\\AutoTunePro9.Preset', 'Clase de un programa desinstalado.'],
      ['HKCR\\.tmpx', 'Extensión sin programa asociado.'] ] },
    { g: 'Inicio que apunta a nada', items: [
      ['HKCU\\…\\Run\\UpdaterHelper', 'Arranca C:\\Users\\usuario\\AppData\\Local\\Temp\\upd_1b2.exe, que no existe.'] ] },
    { g: 'Archivos compartidos inexistentes', items: [
      ['SharedDLLs\\…\\Movavi\\mvcodec.dll', 'El archivo ya no existe.'],
      ['SharedDLLs\\…\\Movavi\\mvfx.dll', 'El archivo ya no existe.'],
      ['SharedDLLs\\…\\Common Files\\VST3\\AutoTune Pro 9.vst3', 'El plugin ya no existe.'],
      ['SharedDLLs\\…\\OldUpdater\\helper.dll', 'El archivo ya no existe.'],
      ['SharedDLLs\\…\\OldUpdater\\net.dll', 'El archivo ya no existe.'] ] },
    { g: 'Menú contextual roto', items: [
      ['HKCR\\*\\shellex\\ContextMenuHandlers\\MovaviShell', 'Añade una entrada que ya no funciona al clic derecho.'],
      ['HKCR\\Directory\\shell\\OpenWithAutoTune', 'El programa ya no existe.'] ] },
  ],
  /* leído de Windows (de ejemplo hasta conectar el motor): modo de energía de Windows 11 al estar enchufado (ac) y con batería (dc),
     efectos visuales (SystemPropertiesPerformance), modo de juego, HAGS y permiso en segundo plano de algunas apps */
  perf: { ac: 'balanced', dc: 'efficiency', visual: 'auto', gameMode: true, hags: true,
    bg: [{ id: 'spotify', n: 'Spotify', v: 'opt' }, { id: 'whatsapp', n: 'WhatsApp', v: 'always' }, { id: 'xbox', n: 'Xbox', v: 'opt' }, { id: 'photos', n: 'Fotos', v: 'never' }] },
};
DB.clean.forEach(c => { c.sel = c.def && !c.busy; });
DB.startup.forEach(s => s.orig = s.on);
DB.services.forEach(s => { s.orig = s.start; s.cur = s.start; });
let regDone = false;

/* ================= motor real =================
   Dentro de la app todo sale de stellarhub/engine/optimizer.py; fuera (navegador) se queda el ejemplo de arriba. */
let REAL = false;
const realP = SH.apiReady.then(a => { REAL = !!a; if (REAL) { DB.clean = []; DB.startup = []; DB.services = []; DB.registry = []; DB.boots = []; DB.bios = null; } return REAL; });
const loaded = {};
const last = { svcBackup: null, regBackup: null, prevAc: null, startupChanged: [] };
/* llamada al motor: si hace falta administrador avisa (sin insistir) y corta */
async function eng(fn, ...a) {
  const r = await SH.engine('optimizer', fn, ...a);
  if (r && r.needAdmin) { SH.requireAdmin('para hacer este cambio en Windows.'); const e = new Error('Necesita el modo administrador'); e.needAdmin = true; throw e; }
  return r;
}
async function engJob(fn, args = [], o = {}) {
  const r = await SH.job('optimizer', fn, args, o);
  if (r && r.needAdmin) { SH.requireAdmin('para hacer este cambio en Windows.'); const e = new Error('Necesita el modo administrador'); e.needAdmin = true; throw e; }
  return r;
}
const LOADERS = {
  async clean() { const r = await engJob('clean_scan'); DB.clean = r.map(c => ({ ...c, sel: c.def && !c.busy && c.size > 0 && (!c.admin || state.admin) })); publishJunk(); },
  async startup() { const r = await engJob('startup_list'); DB.startup = r.items.map(s => ({ ...s, pub: s.pub || '', orig: s.on, path: s.path || '' })); DB.measured = r.measured; },
  async boot() { const r = await eng('boot_info'); DB.bios = r.bios; DB.boots = (r.boots || []).map(b => b.s); },
  async services() { const r = await eng('services_list'); DB.services = r.items.map(s => ({ ...s, orig: s.start, cur: s.start })); },
  async registry() { const r = await engJob('registry_scan'); DB.registry = r.map(g => ({ g: g.g, items: g.items.map(i => [i.k, i.why, i.id]) })); regDone = false; },
  async performance() { const r = await eng('perf_read'); Object.assign(DB.perf, r); },
};
function load(area, force) {
  if (!REAL) return Promise.resolve();
  if (!loaded[area] || force) loaded[area] = LOADERS[area]().catch(e => { console.error('optimizer', area, e); delete loaded[area]; throw e; });
  return loaded[area];
}
function publishJunk() { const gbv = DB.clean.filter(c => c.def).reduce((a, c) => a + c.size, 0) / 1e9; SH.setPending('junk', Math.round(gbv * 10) / 10); }

const API = {
  async analyze(onArea) {
    if (await realP) {
      const areas = { clean: ['clean'], startup: ['startup', 'boot'], services: ['services'], registry: ['registry'], performance: ['performance'] };
      await Promise.all(Object.entries(areas).map(([a, ls]) => Promise.all(ls.map(l => load(l, true).catch(() => {}))).then(() => onArea && onArea(a))));
      return;
    }
    for (const a of ['clean', 'startup', 'services', 'registry', 'performance']) { await wait(520 + Math.random() * 380); onArea && onArea(a); }
  },
  /* limpia; onProgress(c) recibe la categoría con su tamaño actualizado */
  async clean(ids, onProgress) {
    if (REAL) {
      const start = {}; ids.forEach(id => { const c = DB.clean.find(x => x.id === id); if (c) start[id] = c.size; });
      const r = await engJob('clean', [ids], { onProgress: m => { const d = m.data || {}; if (d.id && d.catFreed !== undefined) { const c = DB.clean.find(x => x.id === d.id); if (c) { c.size = Math.max(0, start[d.id] - d.catFreed); c.sel = false; onProgress && onProgress(c); } } } });
      ids.forEach(id => { const c = DB.clean.find(x => x.id === id); if (c && r.per && r.per[id] !== undefined) { c.size = Math.max(0, start[id] - r.per[id]); c.sel = false; } });
      publishJunk(); return r;
    }
    for (const id of ids) { const c = DB.clean.find(x => x.id === id); const steps = 18; const start = c.size;
      for (let i = 1; i <= steps; i++) { await wait(45 + Math.random() * 35); c.size = start * (1 - i / steps); onProgress && onProgress(c); }
      c.size = 0; c.sel = false; }
    return { freed: ids.reduce((a, id) => a + 0, 0) };
  },
};

/* ================= utilidades ================= */
const LOAD_TXT = { clean: 'Midiendo cuánto ocupa cada categoría…', startup: 'Leyendo lo que arranca con Windows…', services: 'Leyendo los servicios…', registry: 'Buscando entradas rotas en el registro…', performance: 'Leyendo los ajustes de Windows…' };
const loadingHTML = tab => `<div class="opt-load"><div class="opt-spin"></div><b>${LOAD_TXT[tab] || 'Cargando…'}</b><span class="muted">Solo mira; no cambia nada.</span>
  <div class="sk-rows" style="width:100%;margin-top:20px">${[46, 38, 52, 30, 44].map((w, i) => `<div class="sk-row"><div class="sk a" style="--dl:${i * .08}s"></div><div class="sk b" style="--w:${w}%;--dl:${i * .08 + .04}s"></div><div class="sk c" style="--dl:${i * .08 + .08}s"></div></div>`).join('')}</div></div>`;
function swap(el, html, after) {
  const a = anim(el, [{ opacity: 1, transform: 'none', filter: 'blur(0px)' }, { opacity: 0, transform: 'translate3d(0,-8px,0)', filter: 'blur(6px)' }], { d: 170 });
  const go = () => { el.innerHTML = html; anim(el, [{ opacity: 0, transform: 'translate3d(0,14px,0)', filter: 'blur(6px)' }, { opacity: 1, transform: 'none', filter: 'blur(0px)' }], { d: 460, e: EASE.spring }); after && after(); };
  a ? a.finished.then(go).catch(go) : go();
}
function tween(from, to, d, fn) {
  const t0 = performance.now(), dur = Math.max(1, d * SH.motion());
  return new Promise(res => { const f = t => { const k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3); fn(from + (to - from) * e); k < 1 ? requestAnimationFrame(f) : res(); }; requestAnimationFrame(f); });
}
const totalSel = () => DB.clean.filter(c => c.sel).reduce((a, c) => a + c.size, 0);
const totalAll = () => DB.clean.reduce((a, c) => a + c.size, 0);
/* altura de barra relativa al arranque más lento, con un mínimo para que siempre se vean */
const bh = s => Math.max(.12, Math.min(1, s / (Math.max(1, ...DB.boots) * 1.08))).toFixed(3);
const bootAvg = () => DB.boots.length ? DB.boots.reduce((a, b) => a + b, 0) / DB.boots.length : 0;
const freeC = () => SH.tele.has && SH.tele.has('diskUsed') && SH.tele.has('diskTotal') ? SH.tele.v.diskTotal - SH.tele.v.diskUsed : 361;
/* segundos aproximados por nivel de impacto (los mismos niveles que usa el Administrador de tareas) */
const IMPACT_S = { alto: 3, medio: 1.5, bajo: .4, ninguno: 0, 'sin medir': 0 };
const impS = s => IMPACT_S[s.impact] * (s.count || 1);
const bootSaved = () => DB.startup.filter(s => s.orig && !s.on).reduce((a, s) => a + impS(s), 0) * .85;
const recStartup = () => DB.startup.filter(s => s.rec && s.on);
const reviewStartup = () => DB.startup.filter(s => s.review && s.on);
const POWER = { efficiency: 'Mejor eficiencia energética', balanced: 'Equilibrado', best: 'Máximo rendimiento' };
const servicePending = p => DB.services.filter(s => s[p] && s[p] !== s.cur);
const regCount = () => regDone ? 0 : DB.registry.reduce((a, g) => a + g.items.length, 0);
const rendered = {};
const refresh = tab => { if (rendered[tab]) try { rendered[tab](); } catch (e) { console.error(e); } };

/* ================= Resumen ================= */
let score = 64;
/* puntuación con lo que hay de verdad: basura, arranque pesado, servicios sobrantes y entradas rotas */
function calcScore() {
  const junk = totalAll() / 1e9, heavy = DB.startup.filter(s => s.on && (s.impact === 'alto' || s.rec)).length, rv = reviewStartup().length;
  const s = 100 - Math.min(25, junk * .8) - Math.min(15, heavy * 4 + rv * 3) - Math.min(10, servicePending('bal').length * 2) - Math.min(10, regCount() * .5);
  return Math.max(25, Math.min(99, Math.round(s)));
}
function projected() {
  const sel = DB.clean.filter(c => c.sel).reduce((a, c) => a + c.size, 0) / 1e9;
  return Math.min(99, score + Math.round(Math.min(25, sel * .8)) + Math.min(15, recStartup().length * 4) + Math.min(10, servicePending('bal').length * 2) + Math.min(10, Math.round(regCount() * .5)));
}
const AREAS = [
  { id: 'clean', n: 'Limpieza', ic: 'broom', tab: 'clean', txt: () => totalAll() > 1e8 ? `${gb(totalAll())} en ${DB.clean.filter(c => c.size > 0).length} categorías` : 'Nada que limpiar', val: () => totalAll() > 1e8 ? gb(totalAll()) : 'Bien', bad: () => totalAll() > 3e9 },
  { id: 'startup', n: 'Arranque', ic: 'bolt', tab: 'startup', txt: () => { const on = DB.startup.filter(s => s.on).length, rv = reviewStartup(); return `${on} de ${DB.startup.length} arrancan con Windows${rv.length ? `; ${rv.reduce((a, s) => a + (s.count || 1), 0)} scripts con impacto alto` : ''}`; }, val: () => reviewStartup().length ? 'Revisar' : 'Bien', bad: () => false },
  { id: 'services', n: 'Servicios', ic: 'service', tab: 'services', txt: () => servicePending('bal').length ? `${servicePending('bal').length} servicios que no usas` : 'Sin cambios recomendados', val: () => servicePending('bal').length || 'Bien', bad: () => false },
  { id: 'registry', n: 'Registro', ic: 'reg', tab: 'registry', txt: () => regCount() ? `${regCount()} entradas rotas` : 'Sin entradas rotas', val: () => regCount() || 'Bien', bad: () => false },
  { id: 'performance', n: 'Rendimiento', ic: 'optimizer', tab: 'performance', txt: () => `Modo de energía al enchufar: ${POWER[DB.perf.ac].toLowerCase()}`, val: () => DB.perf.ac === 'best' ? 'Bien' : 'Mejorable', bad: () => false },
];
const tone = a => a.bad() ? 'bad' : a.val() === 'Bien' ? 'ok' : 'warn';
const areaFill = a => a.bad() ? .45 : ((a.id === 'registry' && regCount()) || (a.id === 'startup' && reviewStartup().length) || (a.id === 'services' && servicePending('bal').length) || (a.id === 'performance' && DB.perf.ac !== 'best')) ? .7 : 1;
function ringSVG() {
  const R = 92, p = ang => [(110 + R * Math.cos(ang)).toFixed(2), (110 + R * Math.sin(ang)).toFixed(2)];
  const segs = AREAS.map((a, i) => { const [x0, y0] = p((-90 + i * 72 + 3) * Math.PI / 180), [x1, y1] = p((-90 + i * 72 + 69) * Math.PI / 180); return `M${x0} ${y0} A${R} ${R} 0 0 1 ${x1} ${y1}`; });
  const L = (R * 66 * Math.PI / 180).toFixed(1);
  return `<svg viewBox="0 0 220 220" class="ring">
    <defs><linearGradient id="optSweep" x1="0" y1="0" x2="1" y2="0"><stop offset="0" style="stop-color:var(--accent2)" stop-opacity="0"/><stop offset="1" style="stop-color:var(--accent2)" stop-opacity=".32"/></linearGradient></defs>
    <circle cx="110" cy="110" r="104" class="tick"/>
    <g class="sweep"><path d="M110 110 L110 12 A98 98 0 0 1 180 40 Z" fill="url(#optSweep)"/></g>
    ${segs.map(d => `<path d="${d}" class="bg"/>`).join('')}
    ${segs.map((d, i) => `<path d="${d}" class="fg" data-seg="${AREAS[i].id}" style="stroke-dasharray:${L};stroke-dashoffset:${L}" data-l="${L}"/>`).join('')}
    <circle cx="110" cy="110" r="70" class="core"/></svg>`;
}
const ovFoot = () => `<div class="ov-foot"><div class="ov-fi"><span class="faint">Última optimización</span><b>${lastRun ? 'Hoy, hace un momento' : 'Nunca desde StellarHub'}</b></div><div class="ov-fi"><span class="faint">Espacio libre en C:</span><b>${SH.fmtInt(freeC() + (lastRun && !REAL ? lastRun.freed / 1e9 : 0))} GB</b></div><div class="ov-fi"><span class="faint">${DB.boots.length ? 'Arranque medio' : 'Tiempo de BIOS'}</span><b>${DB.boots.length ? fmt1(bootAvg() - bootSaved()) + ' s' : DB.bios ? fmt1(DB.bios) + ' s' : '—'}</b></div><button class="ov-auto" data-go-auto>${ic('autopilot')}<span><b>Hazlo solo cada semana</b>Crea una rutina en Autopilot</span>${ic('chev')}</button></div>`;
const findingsHTML = () => `<h4 class="pan-h">Lo que encontramos <em>hace un momento</em></h4><div class="rows">${AREAS.map(a => `<div class="row ov-row" data-area="${a.id}"><span class="ri">${ic(a.ic)}</span><span class="rt"><b>${a.n}</b><span>${esc(a.txt())}</span></span><span class="ov-bar ${tone(a)}"><i style="transform:scaleX(${areaFill(a)})"></i></span><span class="ov-v ${tone(a)}">${a.val()}</span><button class="btn sm ghost" data-tab="${a.tab}">Revisar</button></div>`).join('')}</div>${ovFoot()}`;
let ovEl = null, ovMode = 'findings', running = false;
function renderOverview(el, ctx) {
  ovEl = el; el.classList.add('fill');
  el.innerHTML = `<div class="ov">
    <div class="pan ov-l" data-asm>
      <div class="ring-wrap">${ringSVG()}<div class="ring-c"><b id="optScore">0</b><span id="optScoreLbl">analizando…</span></div></div>
      <div class="ov-state" id="optState">Revisando tu sistema</div>
      <div class="ov-sub muted" id="optSub">Esto no cambia nada; solo mira.</div>
      <button class="btn pri lg ov-cta" id="optAll" disabled>${ic('sparkle')}Optimizar todo</button>
      <button class="btn ghost sm" id="optRescan" hidden>${ic('scan')}Analizar de nuevo</button>
    </div>
    <div class="pan ov-r" data-asm><div id="optRight"><h4 class="pan-h">Lo que encontramos <em>en curso</em></h4><div class="rows">${AREAS.map(a => `<div class="row ov-row pending" data-area="${a.id}"><span class="ri">${ic(a.ic)}</span><span class="rt"><b>${a.n}</b><span class="sk" style="display:block;height:9px;width:${40 + Math.round(Math.random() * 30)}%;margin-top:7px"></span></span><span class="ov-bar"><i style="transform:scaleX(0)"></i></span><span class="ov-v"></span><button class="btn sm ghost" data-tab="${a.tab}" disabled>Revisar</button></div>`).join('')}</div>${ovFoot()}</div></div></div>`;
  $('#optAll', el).addEventListener('click', () => showPlan(el));
  $('#optRescan', el).addEventListener('click', () => analyze(el, true));
  el.addEventListener('click', e => { if (e.target.closest('[data-go-auto]')) { SH.go('autopilot', { tab: 'routines' }); return; } const b = e.target.closest('[data-tab]'); if (b && !b.disabled) ctx.setTab(b.dataset.tab); });
  analyze(el);
  rendered.overview = () => { if (ovMode === 'findings' && !running) { const r = $('#optRight', el); if (r && !$('.ov-row.pending', r)) r.innerHTML = findingsHTML(); } paintRing(el); };
}
function paintRing(el) {
  AREAS.forEach(a => { const p = $(`.fg[data-seg="${a.id}"]`, el); if (!p) return; const to = p.dataset.l * (1 - areaFill(a));
    anim(p, [{ strokeDashoffset: getComputedStyle(p).strokeDashoffset }, { strokeDashoffset: to }], { d: 900 }); p.style.strokeDashoffset = to; p.classList.toggle('bad', a.bad()); });
}
async function analyze(el, again) {
  const sc = $('#optScore', el), lbl = $('#optScoreLbl', el), ring = $('.ring', el);
  $('#optAll', el).disabled = true; $('#optRescan', el).hidden = true; ring.classList.add('scanning');
  $('#optState', el).textContent = 'Revisando tu sistema'; $('#optSub', el).textContent = 'Esto no cambia nada; solo mira.'; lbl.textContent = 'analizando…';
  if (again) { ovMode = 'findings'; const r = $('#optRight', el); r.innerHTML = findingsHTML(); $$('.ov-row', r).forEach(x => { x.classList.add('pending'); $('button', x).disabled = true; });
    $$('.fg', el).forEach(p => { anim(p, [{ strokeDashoffset: getComputedStyle(p).strokeDashoffset }, { strokeDashoffset: p.dataset.l }], { d: 300 }); p.style.strokeDashoffset = p.dataset.l; }); }
  let done = 0;
  await API.analyze(id => {
    done++; const a = AREAS.find(x => x.id === id); const row = $(`.ov-row[data-area="${id}"]`, el); const p = $(`.fg[data-seg="${id}"]`, el);
    const to = p.dataset.l * (1 - areaFill(a)); p.classList.toggle('bad', a.bad());
    anim(p, [{ strokeDashoffset: p.dataset.l }, { strokeDashoffset: to }], { d: 900 }); p.style.strokeDashoffset = to;
    if (row) { row.classList.remove('pending'); $('.rt', row).innerHTML = `<b>${a.n}</b><span>${esc(a.txt())}</span>`;
      const v = $('.ov-v', row); v.textContent = a.val(); v.className = 'ov-v ' + tone(a); $('button', row).disabled = false;
      const ob = $('.ov-bar', row); ob.className = 'ov-bar ' + tone(a); anim($('i', ob), [{ transform: 'scaleX(0)' }, { transform: `scaleX(${areaFill(a)})` }], { d: 800 });
      anim(row, [{ transform: 'translate3d(10px,0,0)', opacity: .4 }, { transform: 'none', opacity: 1 }], { d: 420, e: EASE.spring }); }
    SH.countUp(sc, Math.round(score * done / AREAS.length), 500);
  });
  if (REAL) { score = calcScore(); const r = $('#optRight', el); if (r && ovMode === 'findings') r.innerHTML = findingsHTML(); paintRing(el); }
  ring.classList.remove('scanning'); SH.countUp(sc, score, 600); lbl.textContent = 'de 100';
  const em = $('#optRight .pan-h em', el); if (em) em.textContent = 'hace un momento';
  $('#optState', el).textContent = score >= 85 ? 'Tu PC está en forma' : 'Se puede mejorar bastante';
  $('#optSub', el).textContent = score >= 85 ? 'Nada urgente. Vuelve a analizar cuando quieras.' : `Con «Optimizar todo» llegarías a unos ${REAL ? projected() : 91} puntos.`;
  if (modCtx) { modCtx.setBadge('clean', DB.clean.filter(c => c.size > 1e7).length); modCtx.setBadge('registry', regCount()); }
  ['clean', 'startup', 'services', 'registry', 'performance'].forEach(refresh);
  $('#optAll', el).disabled = false; $('#optRescan', el).hidden = false;
  anim($('#optAll', el), [{ transform: 'scale(.94)' }, { transform: 'scale(1.04)', offset: .5 }, { transform: 'scale(1)' }], { d: 520 });
}
function planSteps() {
  const sel = DB.clean.filter(c => c.sel && c.size > 0); const rec = recStartup(); const svc = servicePending('bal');
  return [
    { id: 'restore', t: 'Crear un punto de restauración', d: 'Para volver atrás si algo no te gusta.', admin: true, lock: true, on: true },
    { id: 'clean', t: `Limpiar ${gb(sel.reduce((a, c) => a + c.size, 0))} de archivos que sobran`, d: `${sel.length} categorías: temporales, cachés, volcados y papelera.`, on: sel.length > 0, dis: !sel.length },
    { id: 'startup', t: `Quitar ${rec.length} apps del arranque`, d: rec.map(r => r.name).join(', ') || 'Nada recomendado', on: rec.length > 0, dis: !rec.length },
    { id: 'services', t: 'Servicios: perfil equilibrado', d: `${svc.length} servicios que no usas pasan a manual o se desactivan.`, admin: true, on: svc.length > 0, dis: !svc.length },
    { id: 'registry', t: `Reparar ${regCount()} entradas rotas del registro`, d: 'Antes se guarda una copia .reg.', admin: true, on: regCount() > 0, dis: !regCount() },
    { id: 'power', t: 'Modo de energía al enchufar: máximo rendimiento', d: 'El mismo ajuste de Configuración > Sistema > Energía. Con batería no cambia.', on: DB.perf.ac !== 'best', dis: DB.perf.ac === 'best' },
  ];
}
function showPlan(el) {
  if (running) return; ovMode = 'plan';
  const steps = planSteps(); const right = $('#optRight', el);
  swap(right, `<h4 class="pan-h">Esto es lo que va a pasar <em>${state.admin ? 'modo administrador' : 'en modo normal algunos pasos se saltan'}</em></h4>
    <div class="plan">${steps.map(s => `<div class="pstep${s.dis ? ' dis' : ''}" data-step="${s.id}"><button class="check${s.on && !s.dis ? ' on' : ''}"${s.lock || s.dis ? ' disabled' : ''} aria-label="${esc(s.t)}">${ic('check')}</button>
      <div class="pt"><b>${esc(s.t)}</b><span>${esc(s.d)}</span></div>${s.admin && !state.admin ? '<span class="chip warn">administrador</span>' : ''}${s.lock ? '<span class="chip">siempre</span>' : ''}</div>`).join('')}</div>
    <div class="plan-acts"><button class="btn pri lg" id="optGo">${ic('play')}Empezar</button><button class="btn ghost" id="optCancel">Cancelar</button></div>`, () => {
    $$('.pstep', right).forEach((r, i) => anim(r, [{ opacity: 0, transform: 'translate3d(16px,0,0)' }, { opacity: 1, transform: 'none' }], { d: 420, delay: 60 + i * 50, e: EASE.spring }));
    $('.plan', right).addEventListener('click', e => { const c = e.target.closest('.check'); if (c && !c.disabled) c.classList.toggle('on'); });
    $('#optCancel', right).addEventListener('click', () => { ovMode = 'findings'; swap(right, findingsHTML()); });
    $('#optGo', right).addEventListener('click', () => {
      const chosen = $$('.pstep', right).filter(r => $('.check', r).classList.contains('on')).map(r => r.dataset.step);
      if (!state.admin && steps.some(s => s.admin && chosen.includes(s.id))) SH.requireAdmin('para crear el punto de restauración, cambiar servicios y reparar el registro. Sin él, esos pasos se saltan.');
      runPlan(el, steps.filter(s => chosen.includes(s.id)));
    });
  });
}
let lastRun = null;
async function runPlan(el, steps) {
  running = true; ovMode = 'run'; const right = $('#optRight', el); $('#optAll', el).disabled = true; $('#optRescan', el).hidden = true;
  const before = { boot: bootSaved(), reg: regCount() };
  swap(right, `<h4 class="pan-h">Optimizando <em id="optFreed">0 MB liberados</em></h4><div class="phases">${steps.map(s => `<div class="phase" data-ph="${s.id}"><span class="ph-dot"></span><div class="pt"><b>${esc(s.t)}</b><span class="ph-msg">En espera</span><div class="bar acc"><span style="transform:scaleX(0)"></span></div></div></div>`).join('')}</div>`);
  await wait(520);
  $('#optState', el).textContent = 'Trabajando…'; $('#optSub', el).textContent = 'Puedes seguir usando el PC mientras tanto.'; $('.ring', el).classList.add('scanning');
  let freed = 0; const log = [];
  for (const s of steps) {
    const ph = $(`.phase[data-ph="${s.id}"]`, right); if (!ph) continue; ph.classList.add('run');
    const bar = $('.bar>span', ph), msg = $('.ph-msg', ph); const setP = p => { bar.style.transform = `scaleX(${p})`; };
    if (s.admin && !state.admin) { msg.textContent = 'Saltado: necesita el modo administrador'; ph.classList.remove('run'); ph.classList.add('skip'); log.push(['skip', s.t]); await wait(260); continue; }
    if (REAL) {
      try { const r = await realStep(s, msg, setP); if (r && r.freed !== undefined) { freed += r.freed; const f = $('#optFreed', el); if (f) f.textContent = `${gb(freed)} liberados`; } log.push(['ok', r && r.log || s.t]); }
      catch (e) { msg.textContent = `No se pudo: ${e.message}`; ph.classList.remove('run'); ph.classList.add('skip'); log.push(['skip', `${s.t}: ${e.message}`]); continue; }
      setP(1); ph.classList.remove('run'); ph.classList.add('done');
      anim($('.ph-dot', ph), [{ transform: 'scale(.4)' }, { transform: 'scale(1.35)', offset: .5 }, { transform: 'scale(1)' }], { d: 420 });
      continue;
    }
    if (s.id === 'restore') { msg.textContent = 'Creando el punto de restauración…'; await tween(0, 1, 1600, setP); msg.textContent = 'Punto «StellarHub, antes de optimizar» creado'; log.push(['ok', 'Punto de restauración']); }
    if (s.id === 'clean') {
      const ids = DB.clean.filter(c => c.sel && c.size > 0 && (!c.admin || state.admin)).map(c => c.id); const start = {}; ids.forEach(id => start[id] = DB.clean.find(c => c.id === id).size);
      const tot = Object.values(start).reduce((a, b) => a + b, 0);
      await API.clean(ids, c => { freed = ids.reduce((a, id) => a + (start[id] - DB.clean.find(x => x.id === id).size), 0); setP(tot ? freed / tot : 1); msg.textContent = `Limpiando ${c.label.toLowerCase()}…`; const f = $('#optFreed', el); if (f) f.textContent = `${gb(freed)} liberados`; });
      msg.textContent = `${gb(freed)} liberados`; log.push(['ok', `Limpieza: ${gb(freed)}`]);
    }
    if (s.id === 'startup') { const rec = recStartup(); for (let i = 0; i < rec.length; i++) { rec[i].on = false; msg.textContent = `Quitando ${rec[i].name} del arranque`; setP((i + 1) / rec.length); await wait(380); } msg.textContent = `${rec.length} apps quitadas del arranque`; log.push(['ok', `Arranque: ${rec.length} apps quitadas`]); }
    if (s.id === 'services') { const sv = servicePending('bal'); for (let i = 0; i < sv.length; i++) { sv[i].cur = sv[i].bal; if (sv[i].cur === 'disabled') sv[i].run = false; msg.textContent = `${sv[i].name}: ${sv[i].bal === 'disabled' ? 'desactivado' : 'manual'}`; setP((i + 1) / sv.length); await wait(300); } msg.textContent = `${sv.length} servicios ajustados`; log.push(['ok', `Servicios: ${sv.length} ajustados`]); }
    if (s.id === 'registry') { msg.textContent = 'Guardando la copia .reg…'; await tween(0, .3, 700, setP); msg.textContent = 'Reparando entradas…'; await tween(.3, 1, 1200, setP); const n = regCount(); regDone = true; msg.textContent = `${n} entradas reparadas; copia en Documentos\\StellarHub\\registro`; log.push(['ok', `Registro: ${n} entradas reparadas`]); }
    if (s.id === 'power') { msg.textContent = 'Cambiando el modo de energía…'; await tween(0, 1, 700, setP); DB.perf.ac = 'best'; msg.textContent = 'Máximo rendimiento al estar enchufado'; log.push(['ok', 'Modo de energía: máximo rendimiento al enchufar']); }
    setP(1); ph.classList.remove('run'); ph.classList.add('done');
    anim($('.ph-dot', ph), [{ transform: 'scale(.4)' }, { transform: 'scale(1.35)', offset: .5 }, { transform: 'scale(1)' }], { d: 420 });
  }
  $('.ring', el).classList.remove('scanning');
  const gained = bootSaved() - before.boot, fixed = before.reg - regCount();
  score = REAL ? calcScore() : Math.min(96, 64 + Math.round(freed / 1e9 * 1.2) + Math.round(gained * 1.1) + (fixed ? 3 : 0) + (DB.perf.ac === 'best' ? 3 : 0) + (servicePending('bal').length ? 0 : 3));
  if (REAL) SH.logActivity('Optimización completa', { sub: `${gb(freed)} liberados`, ic: 'sparkle', go: 'optimizer', tab: 'overview' });
  lastRun = { freed, gained, fixed, log };
  SH.countUp($('#optScore', el), score, 1200); paintRing(el);
  await wait(450);
  ovMode = 'done';
  swap(right, `<h4 class="pan-h">Listo <em>hace un momento</em></h4>
    <div class="result"><div><b class="big" id="rFreed">0</b><span>GB liberados</span></div><div><b class="big" id="rBoot">0</b><span>segundos menos al arrancar</span></div><div><b class="big" id="rFix">0</b><span>entradas reparadas</span></div></div>
    <div class="rows res-log">${log.map(([k, t]) => `<div class="row"><span class="ri ${k}">${ic(k === 'ok' ? 'check' : 'shield')}</span><span class="rt"><b>${esc(t)}</b><span>${k === 'ok' ? 'Hecho' : 'Saltado: activa el modo administrador para hacerlo'}</span></span></div>`).join('')}</div>
    <div class="plan-acts"><button class="btn sec" id="optUndo">${ic('undo')}Deshacer cambios</button><button class="btn ghost" id="optBack">Volver al resumen</button></div>`, () => {
    SH.countUp($('#rFreed', right), freed / 1e9, 1100, 1); SH.countUp($('#rBoot', right), gained, 1100, 1); SH.countUp($('#rFix', right), fixed, 900);
    $$('.res-log .row', right).forEach((r, i) => anim(r, [{ opacity: 0, transform: 'translate3d(0,8px,0)' }, { opacity: 1, transform: 'none' }], { d: 380, delay: 200 + i * 60, e: EASE.spring }));
    $('#optUndo', right).addEventListener('click', () => undo(el)); $('#optBack', right).addEventListener('click', () => { ovMode = 'findings'; swap(right, findingsHTML()); });
  });
  $('#optState', el).textContent = 'Tu PC está en forma'; $('#optSub', el).textContent = 'Los cambios se pueden deshacer desde aquí o con el punto de restauración.';
  $('#optAll', el).disabled = false; $('#optRescan', el).hidden = false; running = false;
  ['clean', 'startup', 'services', 'registry', 'performance'].forEach(refresh);
  SH.toast(`Optimización terminada: ${gb(freed)} liberados.`);
}
/* un paso real de «Optimizar todo» */
async function realStep(s, msg, setP) {
  if (s.id === 'restore') {
    msg.textContent = 'Creando el punto de restauración… (puede tardar un minuto)';
    const r = await engJob('restore_point', ['StellarHub, antes de optimizar'], { onProgress: m => setP(m.pct) });
    if (!r.ok) throw new Error(r.msg || 'Windows no lo creó');
    msg.textContent = 'Punto «StellarHub, antes de optimizar» creado'; return { log: 'Punto de restauración creado' };
  }
  if (s.id === 'clean') {
    const ids = DB.clean.filter(c => c.sel && c.size > 0 && (!c.admin || state.admin)).map(c => c.id);
    const tot = ids.reduce((a, id) => a + DB.clean.find(c => c.id === id).size, 0);
    msg.textContent = 'Limpiando…';
    const r = await API.clean(ids, c => { msg.textContent = `${c.label}: hecho`; });
    setP(1); msg.textContent = `${gb(r.freed)} liberados${r.skipped ? `; ${SH.fmtInt(r.skipped)} archivos en uso se saltaron` : ''}`;
    return { freed: r.freed, log: `Limpieza: ${gb(r.freed)} de ${gb(tot)}` };
  }
  if (s.id === 'startup') {
    const rec = recStartup(); last.startupChanged = [];
    for (let i = 0; i < rec.length; i++) { msg.textContent = `Quitando ${rec[i].name} del arranque`; await eng('startup_set', rec[i].ids, false); rec[i].on = false; last.startupChanged.push(rec[i]); setP((i + 1) / rec.length); }
    msg.textContent = `${rec.length} apps quitadas del arranque`; return { log: `Arranque: ${rec.length} apps quitadas` };
  }
  if (s.id === 'services') {
    const sv = servicePending('bal'); const changes = {}; sv.forEach(x => changes[x.id] = x.bal);
    msg.textContent = 'Cambiando servicios…';
    const r = await eng('services_apply', changes); last.svcBackup = r.backup; await load('services', true);
    msg.textContent = `${sv.length} servicios ajustados${r.ok ? '' : ' (alguno no aceptó el cambio)'}`; return { log: `Servicios: ${sv.length} ajustados` };
  }
  if (s.id === 'registry') {
    const ids = DB.registry.flatMap(g => g.items.map(i => i[2]));
    msg.textContent = 'Guardando la copia .reg y reparando…';
    const r = await engJob('registry_fix', [ids], { onProgress: m => setP(m.pct) }); last.regBackup = r.backup;
    await load('registry', true); regDone = !regCount();
    msg.textContent = `${r.fixed} entradas reparadas; copia en ${r.folder}`; return { log: `Registro: ${r.fixed} entradas reparadas` };
  }
  if (s.id === 'power') {
    last.prevAc = DB.perf.ac; const r = await eng('perf_set', 'ac', 'best'); Object.assign(DB.perf, r);
    msg.textContent = 'Máximo rendimiento al estar enchufado'; return { log: 'Modo de energía: máximo rendimiento al enchufar' };
  }
}
async function undo(el) {
  if (REAL) {
    const errs = [];
    for (const s of last.startupChanged) { try { await eng('startup_set', s.ids, true); s.on = true; } catch (e) { errs.push(s.name); } }
    last.startupChanged = [];
    if (last.svcBackup) { try { await eng('services_undo', last.svcBackup); last.svcBackup = null; await load('services', true); } catch (e) { errs.push('servicios'); } }
    if (last.regBackup) { try { await eng('registry_undo', last.regBackup); last.regBackup = null; await load('registry', true); } catch (e) { errs.push('registro'); } }
    if (last.prevAc && last.prevAc !== DB.perf.ac) { try { Object.assign(DB.perf, await eng('perf_set', 'ac', last.prevAc)); } catch (e) { errs.push('energía'); } }
    score = calcScore(); SH.countUp($('#optScore', el), score, 900);
    ['startup', 'services', 'registry', 'performance'].forEach(refresh); ovMode = 'findings'; swap($('#optRight', el), findingsHTML()); paintRing(el);
    SH.toast(errs.length ? `Deshecho, salvo: ${errs.join(', ')}.` : 'Cambios deshechos. Los archivos borrados no se recuperan.');
    SH.logActivity('Optimización deshecha', { ic: 'restore', go: 'optimizer', tab: 'overview' });
    return;
  }
  DB.startup.forEach(s => s.on = s.orig); DB.services.forEach(s => s.cur = s.orig); regDone = false; DB.perf.ac = 'balanced';
  score = 64 + Math.round((lastRun ? lastRun.freed : 0) / 1e9 * 1.2); SH.countUp($('#optScore', el), score, 900);
  ['startup', 'services', 'registry', 'performance'].forEach(refresh); ovMode = 'findings'; swap($('#optRight', el), findingsHTML()); paintRing(el);
  SH.toast('Cambios deshechos. Los archivos borrados no se recuperan.');
}

/* ================= Limpieza ================= */
function renderClean(el) {
  el.classList.add('fill');
  const groups = [...new Set(DB.clean.map(c => c.g))];
  /* dos columnas reales, equilibradas por número de elementos (las columnas CSS se llevan mal con las animaciones) */
  const cols = [[], []], load = [0, 0];
  groups.map(g => [g, DB.clean.filter(c => c.g === g).length]).sort((x, y) => y[1] - x[1]).forEach(([g, n]) => { const i = load[0] <= load[1] ? 0 : 1; cols[i].push(g); load[i] += n + 1.5; });
  el.innerHTML = `<div class="cl">
    <div class="pan cl-top" data-asm><div class="cl-tot"><span class="muted">Seleccionado</span><div><b class="big" id="clTot">0</b><small class="muted"> GB</small></div></div>
      <div class="cl-meta"><span id="clCount"></span><span class="faint" id="clAllSize"></span></div>
      <div class="cl-acts"><button class="btn ghost sm" id="clRec">Marcar recomendadas</button><button class="btn ghost sm" id="clNone">Desmarcar todo</button><button class="btn pri lg" id="clGo">${ic('broom')}Limpiar seleccionadas</button></div></div>
    <div class="cl-list">${cols.map(col => `<div class="cl-col">${col.map(g => `<div class="cl-g" data-asm><div class="cl-gh">${esc(g)}<em data-g="${esc(g)}"></em></div>${DB.clean.filter(c => c.g === g).map(c => `
      <div class="cl-it" data-id="${c.id}">
        <div class="cl-row"><button class="check" aria-label="${esc(c.label)}">${ic('check')}</button>
          <div class="rt"><b>${esc(c.label)}${c.busy ? ' <span class="chip warn">abierto</span>' : ''}${c.admin && !state.admin ? ' <span class="chip">administrador</span>' : ''}</b><span>${esc(c.desc)}</span></div>
          <span class="cl-size"></span><button class="iconbtn cl-x" aria-label="Ver detalles">${ic('chevd')}</button></div>
        <div class="cl-det"><div><div class="cl-det-in">${c.busy ? `<p class="warn-t">${esc(c.label)} está abierto. Ciérralo para limpiar su caché; si no, se salta.</p>` : ''}<p class="faint">${SH.fmtInt(c.files)} archivos</p>${c.paths.map(p => `<div class="cl-path">${ic('folder')}<span>${esc(p)}</span></div>`).join('')}</div></div></div>
        <div class="cl-prog"><span></span></div></div>`).join('')}</div>`).join('')}</div>`).join('')}</div></div>`;
  const tot = $('#clTot', el);
  const upd = () => { SH.countUp(tot, totalSel() / 1e9, 450, 1); $('#clCount', el).textContent = `${DB.clean.filter(c => c.sel && c.size > 0).length} categorías`; $('#clAllSize', el).textContent = `de ${gb(totalAll())} que se pueden limpiar`; $('#clGo', el).disabled = !totalSel(); };
  function sync() {
    DB.clean.forEach(c => { const it = $(`.cl-it[data-id="${c.id}"]`, el); it.classList.toggle('sel', c.sel); $('.check', it).classList.toggle('on', c.sel); it.classList.toggle('clean', c.size === 0); $('.cl-size', it).textContent = c.size ? gb(c.size) : 'Limpio'; });
    $$('.cl-gh em', el).forEach(e => e.textContent = gb(DB.clean.filter(c => c.g === e.dataset.g).reduce((a, c) => a + c.size, 0))); upd();
  }
  sync();
  el.addEventListener('click', e => {
    const it = e.target.closest('.cl-it'); if (!it) return;
    if (e.target.closest('.cl-x')) { it.classList.toggle('open'); return; }
    if (e.target.closest('.cl-row') && !it.classList.contains('clean') && !it.classList.contains('busyrun')) {
      const c = DB.clean.find(x => x.id === it.dataset.id); c.sel = !c.sel; it.classList.toggle('sel', c.sel); $('.check', it).classList.toggle('on', c.sel); upd(); }
  });
  $('#clRec', el).addEventListener('click', () => { DB.clean.forEach(c => c.sel = c.def && !c.busy && c.size > 0); sync(); });
  $('#clNone', el).addEventListener('click', () => { DB.clean.forEach(c => c.sel = false); sync(); });
  $('#clGo', el).addEventListener('click', async () => {
    let ids = DB.clean.filter(c => c.sel && c.size > 0).map(c => c.id);
    const needAdmin = ids.filter(id => DB.clean.find(c => c.id === id).admin);
    if (needAdmin.length && !state.admin) { SH.requireAdmin('para limpiar los temporales de Windows y las descargas de Windows Update. El resto se limpia igual.'); ids = ids.filter(id => !needAdmin.includes(id)); }
    if (!ids.length) return;
    const go = $('#clGo', el);
    /* lo que no se puede deshacer (vaciar la papelera) pide una segunda pulsación */
    if (ids.includes('recycle') && state.settings.confirmDanger !== false && !go.dataset.sure) {
      go.dataset.sure = '1'; go.innerHTML = `${ic('alert')}Pulsa otra vez: la papelera no se recupera`;
      anim(go, [{ transform: 'translateX(0)' }, { transform: 'translateX(-5px)' }, { transform: 'translateX(5px)' }, { transform: 'translateX(0)' }], { d: 320, keep: true });
      setTimeout(() => { if (go.dataset.sure) { delete go.dataset.sure; go.innerHTML = `${ic('broom')}Limpiar seleccionadas`; } }, 4000); return;
    }
    delete go.dataset.sure;
    go.disabled = true; go.innerHTML = `${ic('broom')}Limpiando…`; let freed = 0;
    for (const id of ids) {
      const it = $(`.cl-it[data-id="${id}"]`, el); it.classList.add('busyrun'); it.scrollIntoView({ block: 'nearest', behavior: isMin() ? 'auto' : 'smooth' });
      const c = DB.clean.find(x => x.id === id); const start = c.size; const pr = $('.cl-prog span', it);
      if (REAL) it.classList.add('indet');
      let r;
      try { r = await API.clean([id], cc => { $('.cl-size', it).textContent = cc.size ? gb(cc.size) : 'Limpio'; pr.style.transform = `scaleX(${(1 - cc.size / start).toFixed(3)})`; tot.textContent = fmt1(totalSel() / 1e9); tot.dataset.v = totalSel() / 1e9; }); }
      catch (e) { it.classList.remove('busyrun', 'indet'); SH.toast(`${c.label}: ${e.message}`); continue; }
      it.classList.remove('indet');
      freed += REAL ? (r.freed || 0) : start; it.classList.remove('busyrun'); if (!c.size) it.classList.add('clean');
      anim($('.cl-size', it), [{ transform: 'scale(.7)', opacity: 0 }, { transform: 'scale(1)', opacity: 1 }], { d: 360, e: EASE.spring });
    }
    go.innerHTML = `${ic('broom')}Limpiar seleccionadas`; sync(); refresh('overview');
    SH.toast(`Liberados ${gb(freed)}.`);
    if (REAL) SH.logActivity('Limpieza hecha', { sub: `${gb(freed)} liberados`, ic: 'broom', go: 'optimizer', tab: 'clean' });
  });
  rendered.clean = sync;
}

/* ================= Arranque ================= */
const ORIGIN = { registro: 'Registro', carpeta: 'Carpeta Inicio', tienda: 'App de la Tienda', tarea: 'Tarea programada', servicio: 'Servicio' };
const IMP_N = { alto: 'Alto', medio: 'Medio', bajo: 'Bajo', ninguno: 'Ninguno', 'sin medir': 'Sin medir' };
const IMP_O = { alto: 0, medio: 1, bajo: 2, ninguno: 3, 'sin medir': 4 };
const bootAdded = () => DB.startup.filter(s => !s.orig && s.on).reduce((a, s) => a + (IMPACT_S[s.impact] || .8) * (s.count || 1), 0);
function renderStartup(el) {
  el.classList.add('fill');
  const DAYS = ['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'hoy'];
  let filter = 'all', q = '';
  const open = new Set();
  el.innerHTML = `<div class="st">
    <div class="st-top">
      <div class="pan st-sum" data-asm><h4>Arrancan con Windows <em>igual que en el Administrador de tareas</em></h4>
        <div class="st-nums"><div><b class="big" id="stOn">0</b><span class="muted">habilitados</span></div><div><b class="big st-off" id="stOff">0</b><span class="muted">deshabilitados</span></div><div><b class="big" id="stBios">${DB.bios == null ? '—' : 0}</b><span class="muted">s de BIOS</span></div></div>
        <div class="st-heavy" id="stHeavy"></div>
        <p class="faint st-note">${REAL && !DB.measured ? 'El impacto lo mide Windows en cada arranque, pero solo deja leerlo en modo administrador: por eso sale «sin medir».' : 'El impacto lo mide Windows en cada arranque. Lo deshabilitado sale como «ninguno» porque no llega a arrancar.'}</p></div>
      <div class="pan st-chart" data-asm><h4>Hasta ver el escritorio <em>${DB.boots.length ? `últimos ${DB.boots.length} arranques` : 'sin datos'}</em></h4>
        ${DB.boots.length ? `<div class="st-cw"><div class="st-hd"><div><span class="muted">Media</span><div><b class="big" id="stNow">0</b><small class="muted"> s</small></div></div>
          <div><span class="muted">Con tus cambios</span><div><b class="big st-new" id="stNew">0</b><small class="muted"> s</small></div></div><span class="st-hint" id="stHint"></span></div>
        <div class="st-bars">${DB.boots.map((b, i) => `<div class="sb"><span style="--h:${bh(b)};--i:${i}"></span><em>${REAL ? '' : DAYS[i]}</em><i>${fmt1(b)}</i></div>`).join('')}<div class="sb est"><span id="stEst" style="--i:7"></span><em>después</em><i id="stEstV"></i></div></div></div>`
        : `<div class="st-nob">${ic('shield')}<div><b>Windows guarda cuánto tarda cada arranque</b><span>Pero solo deja leerlo en modo administrador. Actívalo y aquí verás tus últimos arranques y la estimación con tus cambios.</span></div>${state.admin ? '' : '<button class="btn sec sm" id="stAdm">Activar</button>'}</div>`}</div>
    </div>
    <div class="pan st-tbl" data-asm>
      <div class="st-th"><h4>Programas de inicio <em id="stCount"></em></h4>
        <label class="field st-q">${ic('search')}<input id="stQ" placeholder="Buscar por nombre o editor" autocomplete="off" spellcheck="false"></label>
        <div class="seg" id="stF"><span class="ind"></span><button data-v="all" class="on">Todos</button><button data-v="on">Habilitados</button><button data-v="off">Deshabilitados</button></div>
        <button class="btn ghost sm" id="stTm">${ic('external')}Abrir en el Administrador de tareas</button></div>
      <div class="st-cols"><span>Nombre</span><span>Editor</span><span>Estado</span><span>Impacto</span><span>Origen</span><span></span></div>
      <div class="st-rows" id="stList"></div></div></div>`;
  const list = $('#stList', el);
  const rowHTML = s => `<div class="st-it${s.on ? '' : ' off'}${open.has(s.id) ? ' open' : ''}" data-id="${s.id}">
      <div class="st-r"><span class="st-n"><span class="st-av">${esc(s.name.replace(/[^\p{L}\p{N}]/u, '')[0] || '?')}</span><span class="st-nt"><b>${esc(s.name)}${s.count ? ` <em>(${s.count})</em>` : ''}</b>${s.review && s.on ? '<span class="chip warn">revisa qué es</span>' : ''}</span></span>
        <span class="st-pub">${s.pub ? esc(s.pub) : '<span class="faint">sin editor</span>'}</span>
        <span><span class="chip${s.on ? ' ok' : ''}">${s.on ? 'Habilitado' : 'Deshabilitado'}</span></span>
        <span class="st-imp i-${s.impact.replace(' ', '-')}"><i></i>${IMP_N[s.impact]}</span>
        <span class="st-or">${ORIGIN[s.origin]}</span>
        <button class="toggle${s.on ? ' on' : ''}" aria-label="${esc(s.name)}"><i></i></button></div>
      <div class="st-det"><div><div class="st-det-in">${s.note ? `<p>${esc(s.note)}</p>` : ''}
        <div class="st-path">${ic(s.origin === 'tienda' ? 'store' : s.origin === 'carpeta' ? 'folder' : 'reg')}<span>${esc(s.path)}</span></div>
        ${s.target ? `<div class="st-path">${ic('file')}<span>${esc(s.target)}</span></div>` : ''}
        ${(s.children || []).map(c => `<div class="st-path sub">${ic('file')}<span>${esc(c)}</span></div>`).join('')}
        <button class="btn ghost sm st-loc">${ic('folder')}Abrir ubicación</button></div></div></div></div>`;
  const items = () => DB.startup.filter(s => (filter === 'all' || (filter === 'on' ? s.on : !s.on)) && (!q || (s.name + ' ' + s.pub).toLowerCase().includes(q)))
    .sort((a, b) => (b.on - a.on) || (IMP_O[a.impact] - IMP_O[b.impact]) || a.name.localeCompare(b.name, 'es'));
  const draw = anims => {
    const it = items();
    list.innerHTML = it.length ? it.map(rowHTML).join('') : `<div class="empty"><b>Nada con «${esc(q)}»</b>Prueba con otro nombre.</div>`;
    $('#stCount', el).textContent = `${it.length} de ${DB.startup.length}`;
    if (anims) $$('.st-it', list).forEach((r, i) => anim(r, [{ opacity: 0, transform: 'translate3d(0,8px,0)' }, { opacity: 1, transform: 'none' }], { d: 360, delay: Math.min(i, 14) * 24, e: EASE.spring }));
  };
  const upd = () => {
    const n = bootAvg(), after = n - bootSaved() + bootAdded();
    const on = DB.startup.filter(s => s.on).length;
    SH.countUp($('#stOn', el), on, 500); SH.countUp($('#stOff', el), DB.startup.length - on, 500); if (DB.bios != null) SH.countUp($('#stBios', el), DB.bios, 500, 1);
    if (DB.boots.length) { SH.countUp($('#stNow', el), n, 600, 1); SH.countUp($('#stNew', el), after, 600, 1);
      $('#stEst', el).style.setProperty('--h', bh(after)); $('#stEstV', el).textContent = fmt1(after); }
    const heavy = DB.startup.filter(s => s.on).sort((a, b) => IMP_O[a.impact] - IMP_O[b.impact])[0];
    $('#stHeavy', el).innerHTML = heavy ? `<span class="faint">Lo que más pesa</span><b>${esc(heavy.name)}${heavy.count ? ` (${heavy.count})` : ''}</b><span class="st-imp i-${heavy.impact}"><i></i>impacto ${heavy.impact}</span>` : '';
    const rv = reviewStartup(); if ($('#stHint', el)) $('#stHint', el).textContent =rv.length ? `${rv[0].name} (${rv[0].count || 1}) es lo que más pesa al arrancar.` : bootSaved() > .1 ? `Unos ${fmt1(bootSaved())} s menos que antes.` : 'No hay nada que pese mucho.';
  };
  draw(true); upd();
  list.addEventListener('click', e => {
    const row = e.target.closest('.st-it'); if (!row) return; const s = DB.startup.find(x => x.id === row.dataset.id);
    if (e.target.closest('.st-loc')) { if (REAL) eng('open_location', s.target).then(ok => { if (!ok) SH.toast('Esa ubicación ya no existe.'); }).catch(() => {}); else SH.toast('Abrir la ubicación funciona dentro de la app.'); return; }
    const t = e.target.closest('.toggle');
    if (!t) { if (e.target.closest('.st-r')) { row.classList.toggle('open'); open.has(s.id) ? open.delete(s.id) : open.add(s.id); } return; }
    if ((s.origin === 'servicio' || s.hklm || s.path.startsWith('HKLM')) && !state.admin && !SH.requireAdmin('para cambiar lo que arranca para todos los usuarios.')) return;
    if (s.locked) { SH.toast('Una directiva de Windows controla esta app; no se puede cambiar desde aquí.'); return; }
    const flip = async want => {
      if (REAL) { try { await eng('startup_set', s.ids || [s.id], want); } catch (err) { SH.toast(`${s.name}: ${err.message}`); return false; } }
      s.on = want; draw(false); upd(); refresh('overview'); return true;
    };
    flip(!s.on).then(ok => {
      if (!ok) return;
      if (REAL) SH.logActivity(s.on ? `${s.name} arranca con Windows` : `${s.name} ya no arranca con Windows`, { ic: 'bolt', go: 'optimizer', tab: 'startup' });
      SH.toast(s.on ? `${s.name} vuelve a arrancar con Windows.` : `${s.name} ya no arranca con Windows.`, { action: { label: 'Deshacer', run: () => flip(!s.on) } });
    });
  });
  const adm = $('#stAdm', el); if (adm) adm.addEventListener('click', () => SH.requireAdmin('para leer los tiempos de arranque que guarda Windows.'));
  $('#stQ', el).addEventListener('input', e => { q = e.target.value.trim().toLowerCase(); draw(false); });
  $('#stF', el).addEventListener('click', e => { const b = e.target.closest('button'); if (!b || b.classList.contains('on')) return; $$('#stF button', el).forEach(x => x.classList.toggle('on', x === b)); SH.placeSeg($('#stF', el)); filter = b.dataset.v; draw(true); });
  $('#stTm', el).addEventListener('click', () => { if (REAL) eng('open_startup_page').catch(() => {}); else SH.toast('Abre el Administrador de tareas desde la app.'); });
  requestAnimationFrame(() => SH.placeSeg($('#stF', el), true));
  rendered.startup = () => { draw(false); upd(); };
}

/* ================= Servicios ================= */
const START_N = { auto: 'Automático', manual: 'Manual', disabled: 'Desactivado' };
function renderServices(el) {
  el.classList.add('fill');
  const PROF = { none: ['Sin cambios', 'Todo como lo dejó Windows.'], bal: ['Equilibrado', 'Desactiva lo que seguro no usas: fax, demostración de tienda, telemetría, mapas sin conexión y registro remoto. La impresión solo si no tienes impresoras.'], max: ['Máximo', 'Además pasa a manual el indexado, la precarga de apps, Xbox y la ubicación. Lee los avisos: cada uno tiene un coste.'] };
  let prof = 'none', filter = 'all'; const want = {};
  el.innerHTML = `<div class="sv">
    <div class="pan sv-l" data-asm><h4>Perfil</h4>
      <div class="sv-profs">${Object.entries(PROF).map(([k, [n, d]]) => `<button class="sv-pr${k === prof ? ' on' : ''}" data-v="${k}"><span class="sv-dot"></span><span><b>${n}</b><span>${d}</span></span></button>`).join('')}</div>
      <div class="sv-sum"><div><span class="faint">En marcha ahora</span><b id="svRun">0</b></div><div><span class="faint">Cambios por aplicar</span><b id="svPend">0</b></div></div>
      <div class="sv-acts"><button class="btn pri" id="svApply" disabled>Aplicar cambios</button><button class="btn ghost" id="svReset" title="Volver a los valores de Windows">${ic('undo')}Valores de Windows</button></div></div>
    <div class="pan sv-r" data-asm>
      <div class="sv-th"><h4>Servicios <em>${DB.services.length} que se pueden ajustar sin riesgo</em></h4>
        <div class="seg" id="svF"><span class="ind"></span><button data-v="all" class="on">Todos</button><button data-v="run">En marcha</button><button data-v="chg">Con cambios</button></div></div>
      <div class="sv-cols"><span>Servicio</span><span>Ahora</span><span>Inicio</span><span></span></div>
      <div class="sv-list" id="svList"></div></div></div>`;
  const list = $('#svList', el);
  const draw = anims => {
    const rows = DB.services.filter(s => filter === 'all' || (filter === 'run' ? s.run : (want[s.id] && want[s.id] !== s.cur)));
    list.innerHTML = rows.length ? rows.map(s => { const target = want[s.id] || s.cur; const changed = target !== s.cur;
      return `<div class="sv-it${changed ? ' chg' : ''}" data-id="${s.id}"><span class="ri">${ic('service')}</span>
      <span class="rt"><b>${esc(s.name)} <em class="faint">${esc(s.id)}</em></b><span>${esc(s.desc)}${s.warn ? ` <em class="warn-t">${esc(s.warn)}</em>` : ''}</span></span>
      <span><span class="chip${s.run ? ' ok' : ''}">${s.run ? 'En marcha' : 'Detenido'}</span></span>
      <span class="sv-st">${changed ? `<s>${START_N[s.cur]}</s>` : ''}<span>${START_N[target]}</span></span>
      <button class="toggle${target !== 'disabled' ? ' on' : ''}" aria-label="${esc(s.name)}"><i></i></button></div>`; }).join('') : '<div class="empty"><b>Ningún servicio con cambios</b>Elige un perfil o usa los interruptores.</div>';
    if (anims) $$('.sv-it', list).forEach((r, i) => anim(r, [{ opacity: 0, transform: 'translate3d(0,8px,0)' }, { opacity: 1, transform: 'none' }], { d: 360, delay: i * 26, e: EASE.spring }));
    const n = Object.keys(want).length; const ap = $('#svApply', el); ap.disabled = !n; ap.textContent = n ? `Aplicar ${n} ${n === 1 ? 'cambio' : 'cambios'}` : 'Aplicar cambios';
    $('#svRun', el).textContent = DB.services.filter(s => s.run).length; $('#svPend', el).textContent = n;
  };
  draw(true);
  $('.sv-profs', el).addEventListener('click', e => { const b = e.target.closest('.sv-pr'); if (!b || b.classList.contains('on')) return;
    $$('.sv-pr', el).forEach(x => x.classList.toggle('on', x === b)); prof = b.dataset.v;
    anim($('.sv-dot', b), [{ transform: 'scale(.3)' }, { transform: 'scale(1.3)', offset: .6 }, { transform: 'scale(1)' }], { d: 360 });
    Object.keys(want).forEach(k => delete want[k]); if (prof !== 'none') DB.services.forEach(s => { if (s[prof] && s[prof] !== s.cur) want[s.id] = s[prof]; });
    draw(false); $$('.sv-it.chg', list).forEach((r, i) => anim(r, [{ transform: 'translate3d(8px,0,0)' }, { transform: 'none' }], { d: 420, delay: i * 40, e: EASE.spring })); });
  list.addEventListener('click', e => { const t = e.target.closest('.toggle'); if (!t) return; const s = DB.services.find(x => x.id === t.closest('.sv-it').dataset.id);
    const cur = want[s.id] || s.cur; const nx = cur === 'disabled' ? (s.orig === 'disabled' ? 'manual' : s.orig) : 'disabled'; if (nx === s.cur) delete want[s.id]; else want[s.id] = nx; draw(false); });
  $('#svF', el).addEventListener('click', e => { const b = e.target.closest('button'); if (!b || b.classList.contains('on')) return; $$('#svF button', el).forEach(x => x.classList.toggle('on', x === b)); SH.placeSeg($('#svF', el)); filter = b.dataset.v; draw(true); });
  $('#svApply', el).addEventListener('click', async () => {
    if (!state.admin && !SH.requireAdmin('para cambiar cómo arrancan los servicios de Windows.')) return;
    const ids = Object.keys(want); const ap = $('#svApply', el); ap.disabled = true; ap.textContent = 'Aplicando…';
    if (REAL) {
      let r; try { r = await eng('services_apply', { ...want }); } catch (e) { SH.toast(e.message); draw(false); return; }
      Object.keys(want).forEach(k => delete want[k]); const bid = r.backup; await load('services', true); draw(false); refresh('overview');
      SH.logActivity(`${ids.length} servicios ajustados`, { ic: 'service', go: 'optimizer', tab: 'services' });
      SH.toast(r.ok ? `${ids.length} servicios cambiados.` : 'Algún servicio no aceptó el cambio.', { action: { label: 'Deshacer', run: async () => { try { await eng('services_undo', bid); await load('services', true); draw(false); refresh('overview'); SH.toast('Servicios como estaban.'); } catch (e) { SH.toast(e.message); } } }, ms: 8000 });
      return;
    }
    for (const id of ids) { const s = DB.services.find(x => x.id === id); await wait(220); s.cur = want[id]; if (s.cur === 'disabled') s.run = false; delete want[id]; draw(false); }
    refresh('overview'); SH.toast(`${ids.length} servicios cambiados.`, { action: { label: 'Deshacer', run: () => { DB.services.forEach(s => s.cur = s.orig); draw(false); refresh('overview'); } } });
  });
  $('#svReset', el).addEventListener('click', async () => {
    Object.keys(want).forEach(k => delete want[k]); $$('.sv-pr', el).forEach(x => x.classList.toggle('on', x.dataset.v === 'none')); prof = 'none';
    const changed = DB.services.filter(s => s.cur !== s.orig);
    if (REAL && changed.length) {
      if (!state.admin && !SH.requireAdmin('para cambiar cómo arrancan los servicios de Windows.')) { draw(false); return; }
      const ch = {}; changed.forEach(s => ch[s.id] = s.orig);
      try { await eng('services_apply', ch); await load('services', true); } catch (e) { SH.toast(e.message); }
    } else DB.services.forEach(s => s.cur = s.orig);
    draw(false); refresh('overview'); SH.toast(changed.length ? 'Servicios como estaban al abrir StellarHub.' : 'No había cambios que deshacer.');
  });
  requestAnimationFrame(() => SH.placeSeg($('#svF', el), true));
  rendered.services = () => draw(false);
}

/* ================= Registro ================= */
function renderRegistry(el) {
  const kid = i => i[2] || i[0];
  let sel = new Set(DB.registry.flatMap(g => g.items.map(kid)));
  const draw = () => {
    if (regDone || (REAL && !regCount())) {
      el.innerHTML = `<div class="empty rg-ok">${ic('check')}<b>Sin entradas rotas</b>${last.regBackup ? `La copia de lo que se reparó está en ProgramData\\StellarHub\\optimizer\\registry\\${esc(last.regBackup)}.<div style="margin-top:14px"><button class="btn sec" id="rgUndo">${ic('undo')}Restaurar la copia</button></div>` : REAL ? 'No hay nada que apunte a archivos que ya no existen.' : ''}</div>`;
      const u = $('#rgUndo', el); if (u) u.addEventListener('click', async () => {
        if (REAL) { try { await eng('registry_undo', last.regBackup); last.regBackup = null; await load('registry', true); sel = new Set(DB.registry.flatMap(g => g.items.map(kid))); } catch (e) { SH.toast(e.message); return; } }
        regDone = false; draw(); refresh('overview'); SH.toast('Registro restaurado desde la copia.'); });
      return; }
    el.innerHTML = `<div class="rg">
      <div class="pan rg-note">${ic('info')}<div><b>Qué se arregla aquí</b><span>Limpiar el registro casi no acelera Windows. Aquí solo se tocan entradas rotas de verdad, que apuntan a archivos que ya no existen. Antes se guarda una copia .reg para poder deshacer.</span></div>
        <div class="rg-n"><b id="rgN">${sel.size}</b><span class="muted">elegidas</span></div><button class="btn pri" id="rgGo">${ic('wrench')}Reparar las elegidas</button></div>
      <div class="rg-groups">${DB.registry.map(g => `<div class="pan rg-g"><h4>${esc(g.g)} <em>${g.items.length}</em></h4>${g.items.map(i => `<div class="row rg-it" data-k="${esc(kid(i))}"><button class="check${sel.has(kid(i)) ? ' on' : ''}" aria-label="Elegir">${ic('check')}</button><span class="rt"><b>${esc(i[0])}</b><span>${esc(i[1])}</span></span></div>`).join('')}</div>`).join('')}</div></div>`;
    $$('.rg .pan', el).forEach((p, i) => anim(p, [{ opacity: 0, transform: 'translate3d(0,12px,0)' }, { opacity: 1, transform: 'none' }], { d: 420, delay: i * 45, e: EASE.spring }));
    $('.rg', el).addEventListener('click', e => { const r = e.target.closest('.rg-it'); if (!r) return; const k = r.dataset.k; sel.has(k) ? sel.delete(k) : sel.add(k); $('.check', r).classList.toggle('on', sel.has(k)); $('#rgN', el).textContent = sel.size; $('#rgGo', el).disabled = !sel.size; });
    $('#rgGo', el).addEventListener('click', async () => {
      const needA = REAL ? DB.registry.some(g => g.items.some(i => sel.has(kid(i)) && /^HKLM/i.test(i[0]))) : true;
      if (needA && !state.admin && !SH.requireAdmin('para reparar las entradas del registro del sistema.')) return;
      const b = $('#rgGo', el); b.disabled = true; b.textContent = 'Guardando la copia…';
      if (REAL) {
        const ids = [...sel]; let r;
        try { r = await engJob('registry_fix', [ids], { onProgress: m => { if (m.pct > .02) b.textContent = `Reparando… ${Math.round(m.pct * 100)} %`; } }); }
        catch (e) { SH.toast(e.message); b.disabled = false; b.innerHTML = `${ic('wrench')}Reparar las elegidas`; return; }
        last.regBackup = r.backup;
        for (const row of $$('.rg-it', el).filter(x => sel.has(x.dataset.k))) { anim(row, [{ opacity: 1, transform: 'none' }, { opacity: .25, transform: 'translate3d(18px,0,0)' }], { d: 260 }); }
        await load('registry', true); sel = new Set(DB.registry.flatMap(g => g.items.map(kid))); regDone = !regCount(); refresh('overview'); draw();
        SH.logActivity(`${r.fixed} entradas del registro reparadas`, { sub: 'con copia .reg', ic: 'reg', go: 'optimizer', tab: 'registry' });
        SH.toast(r.failed.length ? `${r.fixed} reparadas; ${r.failed.length} no se pudieron.` : `${r.fixed} entradas reparadas.`, { action: { label: 'Deshacer', run: async () => { try { await eng('registry_undo', r.backup); last.regBackup = null; await load('registry', true); sel = new Set(DB.registry.flatMap(g => g.items.map(kid))); regDone = false; draw(); refresh('overview'); } catch (e) { SH.toast(e.message); } } }, ms: 8000 });
        return;
      }
      await wait(700); b.textContent = 'Reparando…';
      for (const r of $$('.rg-it', el).filter(r => sel.has(r.dataset.k))) { anim(r, [{ opacity: 1, transform: 'none' }, { opacity: .25, transform: 'translate3d(18px,0,0)' }], { d: 260 }); await wait(60); }
      await wait(300); const n = sel.size; regDone = true; refresh('overview'); draw();
      SH.toast(`${n} entradas reparadas.`, { action: { label: 'Deshacer', run: () => { regDone = false; draw(); refresh('overview'); } } });
    });
  };
  draw(); rendered.registry = draw;
}

/* ================= Reparación ================= */
const REPAIRS = [
  { id: 'sfc', ic: 'shield', t: 'Comprobar archivos de Windows', cmd: 'sfc /scannow', d: 'Busca archivos del sistema dañados y los cambia por copias buenas.', when: 'Errores raros, programas de Windows que no abren, pantallazos tras una actualización.', dur: '5 a 15 min', admin: true,
    log: [['Comenzando el examen del sistema. Este proceso tardará algún tiempo.', 0], ['Comenzando la fase de comprobación del examen del sistema.', .05], ['Comprobación 18 % completada.', .18], ['Comprobación 41 % completada.', .41], ['Comprobación 67 % completada.', .67], ['Comprobación 92 % completada.', .92], ['Comprobación 100 % completada.', 1], ['La Protección de recursos de Windows no encontró ninguna infracción de integridad.', 1, 'ok']] },
  { id: 'dism', ic: 'package', t: 'Reparar la imagen de Windows', cmd: 'DISM /Online /Cleanup-Image /RestoreHealth', d: 'Repara la copia de Windows de la que SFC saca los archivos buenos. Usa Windows Update.', when: 'Cuando SFC dice que encontró archivos dañados y no pudo arreglarlos.', dur: '10 a 20 min', admin: true,
    log: [['Herramienta Administración y mantenimiento de imágenes de implementación', 0], ['Versión de imagen: 10.0.26200.7171', .02], ['[=====                      10.0%                          ]', .1], ['[==============             38.4%                          ]', .38], ['[==========================62.3%                          ]', .62], ['[==========================84.9%==========               ]', .85], ['[==========================100.0%==========================]', 1], ['La operación de restauración se completó correctamente.', 1, 'ok']] },
  { id: 'chkdsk', ic: 'ssd', t: 'Revisar el disco', cmd: 'chkdsk C: /scan', d: 'Busca errores del sistema de archivos sin desmontar el disco.', when: 'Archivos que no se abren, carpetas que desaparecen o avisos de disco.', dur: '1 a 3 min', admin: true,
    log: [['El tipo del sistema de archivos es NTFS.', 0], ['Fase 1: examinando la estructura de archivos básica…', .2], ['  1203456 registros de archivos procesados.', .45], ['Fase 2: examinando la vinculación de nombres de archivo…', .6], ['Fase 3: examinando los descriptores de seguridad…', .85], ['Windows examinó el sistema de archivos y no encontró problemas.', 1, 'ok']] },
  { id: 'wu', ic: 'windows', t: 'Reparar Windows Update', cmd: 'net stop wuauserv, ren SoftwareDistribution', d: 'Para los servicios de actualización, renombra su caché y los vuelve a arrancar.', when: 'Actualizaciones que fallan una y otra vez o se quedan al 0 %.', dur: '1 min', admin: true,
    log: [['Deteniendo Windows Update…', .1], ['Deteniendo el servicio de transferencia inteligente (BITS)…', .25], ['Renombrando SoftwareDistribution a SoftwareDistribution.old…', .5], ['Renombrando catroot2…', .65], ['Arrancando los servicios…', .85], ['Windows Update está listo para volver a buscar.', 1, 'ok']] },
  { id: 'net', ic: 'wifi', t: 'Reiniciar la red', cmd: 'netsh winsock reset, netsh int ip reset, ipconfig /flushdns', d: 'Arregla conexiones que no cargan páginas o DNS que fallan.', when: 'Hay Wi-Fi pero las páginas no cargan, o solo fallan algunas webs.', dur: '30 s', admin: true, reboot: true,
    log: [['Vaciando la caché de DNS…', .2], ['Se vació correctamente la caché de resolución de DNS.', .3], ['Restableciendo el catálogo de Winsock…', .55], ['Restablecimiento correcto del catálogo de Winsock.', .7], ['Restableciendo TCP/IP…', .9], ['Hecho. Reinicia el PC para terminar.', 1, 'warn']] },
  { id: 'icons', ic: 'grid', t: 'Reconstruir iconos y fuentes', cmd: 'ie4uinit -show, borrar iconcache_*.db', d: 'Para iconos en blanco o equivocados y fuentes que se ven raras.', when: 'Iconos en blanco, miniaturas viejas o letras que se ven mal.', dur: '20 s',
    log: [['Cerrando el Explorador…', .15], ['Borrando iconcache_*.db (14 archivos)…', .4], ['Borrando la caché de fuentes…', .6], ['Abriendo el Explorador…', .9], ['Iconos reconstruidos.', 1, 'ok']] },
  { id: 'explorer', ic: 'folder', t: 'Reiniciar el Explorador', cmd: 'taskkill /f /im explorer.exe && start explorer', d: 'Si la barra de tareas o el menú Inicio se quedan colgados.', when: 'La barra de tareas no responde o el menú Inicio no abre.', dur: '5 s',
    log: [['Cerrando explorer.exe…', .4], ['Abriendo explorer.exe…', .8], ['Explorador reiniciado.', 1, 'ok']] },
];
function renderRepair(el) {
  el.classList.add('fill');
  let busy = null, cur = REPAIRS[0].id; const logs = {}, status = {};
  el.innerHTML = `<div class="rp">
    <div class="pan rp-l" data-asm><h4>Herramientas <em>${REPAIRS.length}</em></h4><div class="rp-list">${REPAIRS.map(r => `<button class="rp-it${r.id === cur ? ' on' : ''}" data-r="${r.id}"><span class="ri">${ic(r.ic)}</span><span class="rt"><b>${esc(r.t)}</b><span>${esc(r.dur)}${r.admin && !state.admin ? ', administrador' : ''}</span></span><span class="rp-dot"></span></button>`).join('')}</div></div>
    <div class="pan rp-r" data-asm id="rpR"></div></div>`;
  const right = $('#rpR', el);
  const paint = (animate) => {
    const r = REPAIRS.find(x => x.id === cur);
    right.innerHTML = `<div class="rp-h"><span class="rp-big">${ic(r.ic)}</span><div class="rt"><b>${esc(r.t)}</b><span>${esc(r.d)}</span></div><button class="btn pri lg rp-go"${busy ? ' disabled' : ''}>${ic(status[r.id] === 'ok' ? 'restore' : 'play')}${busy === r.id ? 'Ejecutando…' : status[r.id] === 'ok' ? 'Repetir' : 'Ejecutar'}</button></div>
      <div class="rp-facts"><div><span class="faint">Cuándo usarlo</span><b>${esc(r.when)}</b></div><div><span class="faint">Duración</span><b>${esc(r.dur)}</b></div><div><span class="faint">Necesita</span><b>${r.admin ? 'Modo administrador' : 'Nada especial'}${r.reboot ? ', reiniciar' : ''}</b></div></div>
      <div class="bar acc rp-bar"><span style="transform:scaleX(${status[r.id] === 'ok' ? 1 : 0})"></span></div>
      <div class="rp-log"><div class="rp-cmd">${ic('terminal')}<span>${esc(r.cmd)}</span></div>${(logs[r.id] || []).map(([l, , k]) => `<div class="ln${k ? ' ' + k : ''}">${esc(l)}</div>`).join('') || '<div class="ln faint">Pulsa «Ejecutar» para empezar. La salida aparece aquí en vivo.</div>'}</div>`;
    if (animate) $$(':scope > *', right).forEach((c, i) => anim(c, [{ opacity: 0, transform: 'translate3d(14px,0,0)' }, { opacity: 1, transform: 'none' }], { d: 380, delay: i * 40, e: EASE.spring }));
  };
  paint(false);
  $('.rp-list', el).addEventListener('click', e => { const b = e.target.closest('.rp-it'); if (!b || b.dataset.r === cur) return; $$('.rp-it', el).forEach(x => x.classList.toggle('on', x === b)); cur = b.dataset.r; paint(true); });
  right.addEventListener('click', async e => {
    if (!e.target.closest('.rp-go')) return; const r = REPAIRS.find(x => x.id === cur);
    if (busy) { SH.toast('Espera a que termine la reparación en curso.'); return; }
    if (r.admin && !state.admin && !SH.requireAdmin(`para ${r.t.toLowerCase()}.`)) return;
    busy = r.id; logs[r.id] = []; status[r.id] = 'run'; const it = $(`.rp-it[data-r="${r.id}"]`, el); it.classList.remove('ok', 'err'); it.classList.add('run'); paint(false);
    if (REAL) {
      /* salida en vivo: cada línea llega del motor; se pintan juntas una vez por frame */
      let pend = [], raf = 0, pct = 0;
      const flush = () => { raf = 0; if (cur !== r.id) { pend = []; return; } const log = $('.rp-log', right); if (!log) return; const ph = $('.ln.faint', log); if (ph) ph.remove();
        const atEnd = log.scrollHeight - log.scrollTop - log.clientHeight < 40; const frag = document.createDocumentFragment();
        pend.forEach(([l, , k]) => { const d = document.createElement('div'); d.className = 'ln' + (k ? ' ' + k : ''); d.textContent = l; frag.appendChild(d); });
        pend = []; log.appendChild(frag); if (atEnd) log.scrollTop = log.scrollHeight; const bar = $('.rp-bar>span', right); if (bar) bar.style.transform = `scaleX(${pct})`; };
      const push = (line, k) => { const e = [line, pct, k]; logs[r.id].push(e); if (logs[r.id].length > 4000) logs[r.id].splice(0, 1000); pend.push(e); if (!raf) raf = requestAnimationFrame(flush); };
      let res = null, err = null;
      try { res = await engJob('repair', [r.id], { onLog: lines => lines.forEach(l => push(l)), onProgress: m => { pct = m.pct || pct; if (!raf) raf = requestAnimationFrame(flush); } }); }
      catch (e) { err = e; }
      pct = 1;
      if (err) push(err.needAdmin ? 'Necesita el modo administrador.' : `Error: ${err.message}`, 'err');
      else push(res && res.code ? `Terminó con el código ${res.code}. Revisa la salida de arriba.` : (r.reboot ? 'Hecho. Reinicia el PC para terminar.' : 'Hecho.'), res && res.code ? 'warn' : (r.reboot ? 'warn' : 'ok'));
      busy = null; status[r.id] = err ? 'err' : 'ok'; it.classList.remove('run'); it.classList.add(err ? 'err' : 'ok'); if (cur === r.id) paint(false); else $$('.rp-go', right).forEach(b => b.disabled = false);
      if (!err) { SH.logActivity(`${r.t}: hecho`, { ic: r.ic, go: 'optimizer', tab: 'repair' }); SH.toast(r.reboot ? `${r.t}: hecho. Reinicia para terminar.` : `${r.t}: hecho.`); }
      return;
    }
    for (let i = 0; i < r.log.length; i++) { const [line, p, k] = r.log[i]; await wait(i ? 420 + Math.random() * 600 : 300); logs[r.id].push(r.log[i]);
      if (cur === r.id) { const log = $('.rp-log', right); const ph = $('.ln.faint', log); if (ph) ph.remove(); const d = document.createElement('div'); d.className = 'ln' + (k ? ' ' + k : ''); d.textContent = line; log.appendChild(d); log.scrollTop = log.scrollHeight;
        anim(d, [{ opacity: 0, transform: 'translate3d(0,4px,0)' }, { opacity: 1, transform: 'none' }], { d: 220 }); $('.rp-bar>span', right).style.transform = `scaleX(${p})`; } }
    busy = null; status[r.id] = 'ok'; it.classList.remove('run'); it.classList.add('ok'); if (cur === r.id) paint(false); else $$('.rp-go', right).forEach(b => b.disabled = false);
    SH.toast(r.reboot ? `${r.t}: hecho. Reinicia para terminar.` : `${r.t}: hecho.`);
  });
}

/* ================= Rendimiento ================= */
/* Cada ajuste es el mismo de Windows: se lee de donde lo guarda Windows y se cambia ahí. Nada de valores propios. */
function renderPerformance(el) {
  const P = DB.perf;
  const PM = [['efficiency', 'Eficiencia'], ['balanced', 'Equilibrado'], ['best', 'Máximo rendimiento']];
  const VIS = [['auto', 'Que elija Windows'], ['appearance', 'Mejor apariencia'], ['performance', 'Mejor rendimiento']];
  const VIS_N = { auto: 'Dejar que Windows elija', appearance: 'Ajustar para obtener la mejor apariencia', performance: 'Ajustar para obtener el mejor rendimiento' };
  const BG = [['always', 'Siempre'], ['opt', 'Optimizado'], ['never', 'Nunca']];
  const seg = (k, opts, v) => `<div class="seg" data-k="${k}"><span class="ind"></span>${opts.map(([o, n]) => `<button data-v="${o}"${v === o ? ' class="on"' : ''}>${n}</button>`).join('')}</div>`;
  const card = (o) => `<div class="pan pf-c" data-asm data-card="${o.id}">
      <div class="pf-h"><span class="ri">${ic(o.ic)}</span><div class="rt"><b>${o.t}</b><span>${o.where}</span></div></div>
      <div class="pf-now"><span class="faint">Ahora en Windows:</span> <b data-now="${o.id}">${o.now()}</b></div>
      <div class="pf-ctl">${o.ctl}</div>
      <p class="pf-d">${o.d}</p>
      <div class="pf-f">${(o.chips || []).map(c => `<span class="chip">${c}</span>`).join('')}<button class="btn ghost sm" data-open="${o.open}">${ic('external')}${o.openT || 'Abrir en Configuración de Windows'}</button></div></div>`;
  const CARDS = [
    { id: 'power', ic: 'bolt', t: 'Modo de energía', where: 'Configuración › Sistema › Energía y batería', now: () => `Enchufado: ${POWER[P.ac].toLowerCase()}. Con batería: ${POWER[P.dc].toLowerCase()}.`,
      ctl: `<div class="pf-two"><div><span class="faint">Enchufado</span>${seg('ac', PM, P.ac)}</div><div><span class="faint">Con batería</span>${seg('dc', PM, P.dc)}</div></div>
        <div class="pf-plans"><span class="faint">Planes de energía (powercfg /list)</span>${(P.plans && P.plans.length ? P.plans.map(p => [p.name, p.guid, p.on]) : [['Equilibrado', '381b4222-…-a8a1-26dd2ec7e0f0', true], ['Alto rendimiento', 'oculto en equipos con Modern Standby', false], ['Máximo rendimiento', 'oculto en equipos con Modern Standby', false]]).map(([n, g, on]) => `<button class="pf-plan${on ? ' on' : ''}" data-plan="${esc(g)}"><span class="pf-pd"></span><span><b>${esc(n)}</b><small>${esc(g)}</small></span>${on ? '<span class="chip ok">activo</span>' : ''}</button>`).join('')}
        ${P.standby !== false ? `<p class="faint pf-pn">Tu ${SH.PC.type === 'laptop' ? 'portátil' : 'equipo'} usa Modern Standby: Windows solo deja el plan Equilibrado y los modos de arriba lo ajustan por dentro.</p>` : ''}</div>`,
      d: 'Es el control de Windows 11, no un plan propio. «Máximo rendimiento» sube las frecuencias que tu i7-14650HX puede sostener a cambio de más calor y ruido.', chips: ['sin reiniciar'], open: 'ms-settings:powersleep' },
    { id: 'visual', ic: 'eye', t: 'Efectos visuales', where: 'Propiedades del sistema › Opciones avanzadas › Rendimiento', now: () => VIS_N[P.visual],
      ctl: seg('visual', VIS, P.visual), d: '«Mejor rendimiento» quita sombras, animaciones de ventanas y transparencias de Windows. No afecta a las animaciones de StellarHub. En tu equipo la diferencia es pequeña.', chips: ['sin reiniciar'], open: 'sysperf', openT: 'Abrir Opciones de rendimiento' },
    { id: 'game', ic: 'gpu', t: 'Modo de juego', where: 'Configuración › Juegos › Modo de juego', now: () => P.gameMode ? 'Activado' : 'Desactivado',
      ctl: `<div class="pf-tg"><span>Modo de juego</span><button class="toggle${P.gameMode ? ' on' : ''}" data-k="gameMode" aria-label="Modo de juego"><i></i></button></div>`,
      d: 'Windows da prioridad al juego que tienes delante y no instala actualizaciones ni reinicia mientras juegas. Viene activado de serie.', chips: ['sin reiniciar'], open: 'ms-settings:gaming-gamemode' },
    { id: 'hags', ic: 'cpu', t: 'Programación de GPU acelerada por hardware', where: 'Configuración › Sistema › Pantalla › Gráficos', now: () => P.hags === null ? 'La decide Windows (no está fijada)' : P.hags ? 'Activada' : 'Desactivada',
      ctl: `<div class="pf-tg"><span>Programación por hardware</span><button class="toggle${P.hags ? ' on' : ''}" data-k="hags" aria-label="Programación por hardware"><i></i></button></div>`,
      d: 'La RTX 5070 gestiona su propia memoria en vez de hacerlo Windows. Algo menos de latencia en juegos; se necesita para la generación de fotogramas de DLSS.', chips: ['pide reiniciar', 'administrador'], open: 'ms-settings:display-advancedgraphics' },
    { id: 'bg', ic: 'layers', t: 'Apps en segundo plano', where: 'Configuración › Apps › Apps instaladas › Opciones avanzadas', now: () => `${P.bg.filter(a => a.v === 'always').length} con permiso siempre, ${P.bg.filter(a => a.v === 'never').length} sin permiso`,
      ctl: `<div class="pf-bg">${P.bg.map(a => `<div class="pf-bgr"><span>${esc(a.n)}</span>${seg('bg:' + a.id, BG, a.v)}</div>`).join('')}</div>`,
      d: 'Windows 11 ya no tiene un interruptor general: se decide app por app. «Optimizado» deja que Windows las pare cuando hace falta ahorrar batería.', chips: ['por app'], open: 'ms-settings:privacy-backgroundapps' },
  ];
  el.innerHTML = `<div class="pf-wrap"><div class="pan pf-note" data-asm>${ic('info')}<div><b>Son los ajustes de Windows, no unos propios</b><span>Se leen de donde Windows los guarda y se cambian ahí mismo: puedes comprobarlos con «Abrir en Configuración». No mostramos un antes y después inventado; cuando cambies algo, StellarHub medirá el siguiente arranque y el consumo en reposo, y lo verás aquí.</span></div><span class="chip">lo medimos al aplicar</span></div>
    <div class="pf">${CARDS.map(card).join('')}</div></div>`;
  $$('[data-open=""]', el).forEach(b => b.remove());
  const now = () => CARDS.forEach(c => { const n = $(`[data-now="${c.id}"]`, el); if (n && n.textContent !== c.now()) { n.textContent = c.now(); anim(n, [{ opacity: .3, transform: 'translate3d(0,4px,0)' }, { opacity: 1, transform: 'none' }], { d: 300 }); } });
  /* en la app: se cambia en Windows y se vuelve a leer; si Windows no acepta, el control vuelve a como estaba */
  const realSet = async (k, v, revert) => {
    if (!REAL) return true;
    try { const r = k.startsWith('bg:') ? await eng('bg_set', k.slice(3), v) : await eng('perf_set', k, v); if (r && r.plans) Object.assign(P, r); return true; }
    catch (err) { SH.toast(err.message); revert && revert(); return false; }
  };
  el.addEventListener('click', async e => {
    const o = e.target.closest('[data-open]'); if (o) { const u = o.dataset.open; if (u === 'sysperf') SH.call('run_tool', 'perf').then(r => { if (r === undefined) SH.toast('Abre Opciones de rendimiento desde la app.'); }); else SH.call('open_url', u).then(r => { if (r === undefined) SH.toast('Esto abre la Configuración de Windows desde la app.'); }); return; }
    const pl = e.target.closest('[data-plan]'); if (pl && REAL && !pl.classList.contains('on')) { try { Object.assign(P, await eng('power_plan_set', pl.dataset.plan)); $$('.pf-plan', el).forEach(x => { const on = x.dataset.plan === pl.dataset.plan; x.classList.toggle('on', on); }); SH.toast('Plan de energía cambiado.'); } catch (err) { SH.toast(err.message); } return; }
    const sb = e.target.closest('.seg button'); if (sb) { const s = sb.parentElement; if (sb.classList.contains('on')) return; const prevB = $('button.on', s); $$('button', s).forEach(x => x.classList.toggle('on', x === sb)); SH.placeSeg(s);
      const k = s.dataset.k, v = sb.dataset.v;
      const revert = () => { $$('button', s).forEach(x => x.classList.toggle('on', x === prevB)); SH.placeSeg(s); };
      if (!(await realSet(k, v, revert))) return;
      if (k.startsWith('bg:')) { const a = P.bg.find(x => x.id === k.slice(3)); if (a) a.v = v; SH.toast(`${a ? a.n : 'App'}: ${sb.textContent.toLowerCase()} en segundo plano.`); }
      else { P[k] = v; SH.toast(k === 'visual' ? `Efectos visuales: ${sb.textContent.toLowerCase()}.` : `Modo de energía ${k === 'ac' ? 'enchufado' : 'con batería'}: ${sb.textContent.toLowerCase()}.`); }
      if (REAL) SH.logActivity(k === 'visual' ? 'Efectos visuales cambiados' : k.startsWith('bg:') ? 'Permiso en segundo plano cambiado' : 'Modo de energía cambiado', { sub: sb.textContent, ic: 'bolt', go: 'optimizer', tab: 'performance' });
      now(); refresh('overview'); return; }
    const t = e.target.closest('.toggle[data-k]'); if (t) {
      const k = t.dataset.k; if (k === 'hags' && !state.admin && !SH.requireAdmin('para cambiar la programación de la GPU.')) return;
      const want = !P[k]; t.classList.toggle('on', want);
      if (!(await realSet(k, want, () => t.classList.toggle('on', !want)))) return;
      P[k] = want; now(); if (k === 'hags') SH.toast('Se aplicará al reiniciar.'); else SH.toast(`Modo de juego ${want ? 'activado' : 'desactivado'}.`);
    }
  });
  requestAnimationFrame(() => $$('.seg', el).forEach(s => SH.placeSeg(s, true)));
  rendered.performance = () => { $$('.seg[data-k="ac"] button', el).forEach(b => b.classList.toggle('on', b.dataset.v === P.ac)); SH.placeSeg($('.seg[data-k="ac"]', el), true); now(); };
}

/* ================= registro del módulo ================= */
let modCtx = null;
SH.module({
  id: 'optimizer',
  actions(el, ctx) {
    modCtx = ctx;
    el.innerHTML = `<button class="btn ghost" data-a="rescan">${ic('scan')}Analizar</button><button class="btn pri" data-a="all">${ic('sparkle')}Optimizar todo</button>`;
    el.addEventListener('click', e => { const b = e.target.closest('[data-a]'); if (!b) return; ctx.setTab('overview');
      setTimeout(() => { const t = ctx.tabEl('overview'); const btn = t && $(b.dataset.a === 'all' ? '#optAll' : '#optRescan', t); if (btn && !btn.disabled && !btn.hidden) btn.click(); }, 300); });
  },
  real: true,
  async renderTab(tab, el, ctx) {
    const fn = ({ overview: renderOverview, clean: renderClean, startup: renderStartup, services: renderServices, registry: renderRegistry, repair: renderRepair, performance: renderPerformance })[tab];
    const need = { clean: ['clean'], startup: ['startup', 'boot'], services: ['services'], registry: ['registry'], performance: ['performance'] }[tab];
    if (need && await realP) {
      if (need.some(n => !loaded[n])) el.innerHTML = loadingHTML(tab);
      try { await Promise.all(need.map(n => load(n))); }
      catch (e) { el.innerHTML = `<div class="empty"><b>No se pudo leer de Windows</b>${esc(e.message)}<div style="margin-top:14px"><button class="btn sec" id="optRetry">${ic('restore')}Volver a intentarlo</button></div></div>`;
        $('#optRetry', el).addEventListener('click', () => { el.innerHTML = ''; this.renderTab(tab, el, ctx); }); return; }
      el.innerHTML = ''; fn(el, ctx); SH.assemble(el, 0, 30); return;
    }
    fn(el, ctx);
  },
  enter() { if (!modCtx) return; modCtx.setBadge('clean', DB.clean.filter(c => c.size > 0).length); modCtx.setBadge('registry', regCount()); },
  enterTab(tab, el) { if (tab !== 'overview' || !el) return; const r = $('.ring', el); if (r) anim(r, [{ transform: 'rotate(-24deg) scale(.94)', opacity: .5 }, { transform: 'none', opacity: 1 }], { d: 620, e: EASE.spring }); },
});
SH.actions.add([
  { t: 'Optimizar todo', go: 'optimizer', tab: 'overview', ic: 'sparkle' },
  { t: 'Vaciar la papelera y los temporales', go: 'optimizer', tab: 'clean', ic: 'broom' },
  { t: 'Desactivar servicios que no uso', go: 'optimizer', tab: 'services', ic: 'service' },
  { t: 'Reparar entradas rotas del registro', go: 'optimizer', tab: 'registry', ic: 'reg' },
  { t: 'Comprobar archivos de Windows (SFC)', go: 'optimizer', tab: 'repair', ic: 'shield' },
  { t: 'Reiniciar la red y el DNS', go: 'optimizer', tab: 'repair', ic: 'wifi' },
  { t: 'Cambiar el plan de energía', go: 'optimizer', tab: 'performance', ic: 'bolt' },
]);
})();
