/* StellarHub · Super Optimizer. Full UI; outside the app it uses sample data shaped like what Python returns. */
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

/* ================= data (the shape Python returns) ================= */
const DB = {
  clean: [
    { id: 'user_temp', g: 'Windows', label: 'User temporary files', size: 2.84e9, files: 18342, def: true, temp: true, keptSize: 3.1e9, keptCount: 4,
      desc: 'Files programs leave in %TEMP%. Folders used recently or by a running program are kept.', paths: ['C:\\Users\\usuario\\AppData\\Local\\Temp'],
      rows: [
        { name: 'chrome_installer_old', path: 'C:\\Users\\usuario\\AppData\\Local\\Temp\\chrome_installer_old', short: '%USERPROFILE%\\AppData\\Local\\Temp\\chrome_installer_old', kind: 'dir', size: 1.62e9, files: 412, status: 'clean', reason: '' },
        { name: 'nvidia_logs', path: 'C:\\Users\\usuario\\AppData\\Local\\Temp\\nvidia_logs', short: '%USERPROFILE%\\AppData\\Local\\Temp\\nvidia_logs', kind: 'dir', size: .74e9, files: 15210, status: 'clean', reason: '' },
        { name: '(files directly in this folder)', path: 'C:\\Users\\usuario\\AppData\\Local\\Temp', short: '%USERPROFILE%\\AppData\\Local\\Temp', kind: 'files', size: .48e9, files: 2720, status: 'clean', reason: '' },
        { name: 'build_tool_work', path: 'C:\\Users\\usuario\\AppData\\Local\\Temp\\build_tool_work', short: '%USERPROFILE%\\AppData\\Local\\Temp\\build_tool_work', kind: 'dir', size: 2.05e9, files: 3800, status: 'in_use', reason: 'In use by python.exe' },
        { name: 'WinGet', path: 'C:\\Users\\usuario\\AppData\\Local\\Temp\\WinGet', short: '%USERPROFILE%\\AppData\\Local\\Temp\\WinGet', kind: 'dir', size: .63e9, files: 2, status: 'recent', reason: 'Used recently' },
        { name: 'project_review', path: 'C:\\Users\\usuario\\AppData\\Local\\Temp\\project_review', short: '%USERPROFILE%\\AppData\\Local\\Temp\\project_review', kind: 'dir', size: .4e9, files: 1959, status: 'excluded', reason: 'You chose to always keep it' },
        { name: 'node_modules', path: 'C:\\Users\\usuario\\AppData\\Local\\Temp\\link', short: '%USERPROFILE%\\AppData\\Local\\Temp\\link', kind: 'link', size: 0, files: 0, status: 'link', reason: 'Link to another folder: never followed' },
      ] },
    { id: 'win_temp', g: 'Windows', label: 'Windows temporary files', size: .61e9, files: 2210, def: true, admin: true, desc: 'Leftovers from installations and system tasks.', paths: ['C:\\Windows\\Temp'] },
    { id: 'thumbs', g: 'Windows', label: 'Thumbnail cache', size: .42e9, files: 14, def: true, desc: 'Windows rebuilds it when you open folders.', paths: ['C:\\Users\\usuario\\AppData\\Local\\Microsoft\\Windows\\Explorer\\thumbcache_*.db'] },
    { id: 'dumps', g: 'Windows', label: 'Crash dumps and error reports', size: 1.37e9, files: 41, def: true, desc: 'Memory copies of programs that crashed. Only useful for debugging.', paths: ['C:\\Users\\usuario\\AppData\\Local\\CrashDumps', 'C:\\Windows\\Minidump', 'C:\\ProgramData\\Microsoft\\Windows\\WER'] },
    { id: 'wu', g: 'Windows', label: 'Windows Update downloads', size: 2.31e9, files: 512, def: false, admin: true, desc: 'Updates already installed. Unchecked by default: if one fails, Windows would have to download it again.', paths: ['C:\\Windows\\SoftwareDistribution\\Download'] },
    { id: 'do', g: 'Windows', label: 'Delivery Optimization', size: 1.18e9, files: 96, def: false, admin: true, desc: 'Pieces of updates your PC shares with other computers.', paths: ['C:\\Windows\\ServiceProfiles\\NetworkService\\AppData\\Local\\Microsoft\\Windows\\DeliveryOptimization'] },
    { id: 'logs', g: 'Windows', label: 'Windows and app logs', size: .29e9, files: 1630, def: true, desc: 'Old .log and .etl files.', paths: ['C:\\Windows\\Logs', 'C:\\Windows\\Panther'] },
    { id: 'recycle', g: 'Windows', label: 'Recycle Bin', size: 2.06e9, files: 311, def: true, desc: "Things you deleted. Once emptied, they can't be recovered.", paths: ['All drives'] },
    { id: 'brave', g: 'Browsers', label: 'Brave', size: 1.94e9, files: 9210, def: true, busy: 'brave.exe', desc: "Page, code and GPU cache. Doesn't touch passwords, history or tabs.", paths: ['…\\BraveSoftware\\Brave-Browser\\User Data\\Default\\Cache', '…\\Code Cache', '…\\GPUCache'] },
    { id: 'edge', g: 'Browsers', label: 'Microsoft Edge', size: .71e9, files: 4022, def: true, desc: 'Page, code and GPU cache.', paths: ['…\\Microsoft\\Edge\\User Data\\Default\\Cache'] },
    { id: 'chrome', g: 'Browsers', label: 'Google Chrome', size: .38e9, files: 2118, def: true, desc: 'Page, code and GPU cache.', paths: ['…\\Google\\Chrome\\User Data\\Default\\Cache'] },
    { id: 'discord', g: 'Apps', label: 'Discord', size: .52e9, files: 3311, def: true, desc: "Images and videos you've already seen.", paths: ['C:\\Users\\usuario\\AppData\\Roaming\\discord\\Cache'] },
    { id: 'spotify', g: 'Apps', label: 'Spotify', size: .88e9, files: 640, def: true, desc: "Cached songs that aren't downloaded for offline listening.", paths: ['C:\\Users\\usuario\\AppData\\Local\\Spotify\\Data'] },
    { id: 'steam', g: 'Apps', label: 'Steam (built-in browser)', size: .33e9, files: 2804, def: true, desc: 'Store and community cache.', paths: ['C:\\Users\\usuario\\AppData\\Local\\Steam\\htmlcache'] },
    { id: 'shader', g: 'Apps', label: 'NVIDIA and DirectX shader cache', size: 1.8e9, files: 744, def: false, desc: 'Games rebuild it; after cleaning, the first session may take longer to load.', paths: ['C:\\Users\\usuario\\AppData\\Local\\NVIDIA\\DXCache', '…\\NVIDIA\\GLCache', '…\\D3DSCache'] },
    { id: 'orphans', g: 'Program leftovers', label: 'Uninstalled programs', size: .96e9, files: 5120, def: true, desc: 'Folders left behind by programs that are no longer installed.', paths: ['C:\\Users\\usuario\\AppData\\Local\\Movavi Video Editor 26 (640 MB)', 'C:\\Users\\usuario\\AppData\\Roaming\\AutoTunePro9 (212 MB)', 'C:\\ProgramData\\OldUpdaterCache (108 MB)'] },
  ],
  boots: [21.4, 19.8, 22.9, 20.6, 19.1, 21.7, 20.3],
  bios: 7.0,
  /* the same as Task Manager > Startup apps.
     origin: registry (HKCU/HKLM Run), folder (Startup folder), store (Store app StartupTask), task, service */
  startup: [
    { id: 'sechealth', name: 'SecurityHealthSystray.exe', pub: 'Microsoft Corporation', on: true, impact: 'low', origin: 'registry', path: 'HKLM\\…\\CurrentVersion\\Run\\SecurityHealth', target: 'C:\\Windows\\System32\\SecurityHealthSystray.exe', note: 'The Windows Security icon in the system tray. Best left on.' },
    { id: 'wscript', name: 'wscript.exe', count: 3, pub: '', on: true, impact: 'high', origin: 'folder', review: true, path: 'Your Startup folder', target: 'C:\\Windows\\System32\\wscript.exe', note: 'Three .vbs scripts that run when you sign in. Check what they are before touching them: they may be yours.',
      children: ['%APPDATA%\\Microsoft\\Windows\\Start Menu\\Programs\\Startup\\script 1.vbs', '%APPDATA%\\Microsoft\\Windows\\Start Menu\\Programs\\Startup\\script 2.vbs', '%APPDATA%\\Microsoft\\Windows\\Start Menu\\Programs\\Startup\\script 3.vbs'] },
    { id: 'xbox', name: 'XBOX', pub: 'Microsoft Corporation', on: false, impact: 'none', origin: 'store', path: 'Xbox app StartupTask' },
    { id: 'copilot', name: 'Copilot', pub: 'Microsoft Corporation', on: false, impact: 'none', origin: 'store', path: 'Copilot app StartupTask' },
    { id: 'claude', name: 'Claude', pub: 'Anthropic, PBC', on: false, impact: 'none', origin: 'store', path: 'Claude app StartupTask' },
    { id: 'spotify', name: 'Spotify', pub: 'Spotify AB', on: false, impact: 'none', origin: 'store', path: 'Spotify app StartupTask' },
    { id: 'phonelink', name: 'Mobile devices', pub: 'Microsoft Windows', on: false, impact: 'none', origin: 'store', path: 'Mobile devices StartupTask' },
    { id: 'yourphone', name: 'Phone Link', pub: 'Microsoft Corporation', on: false, impact: 'none', origin: 'store', path: 'Phone Link StartupTask' },
    { id: 'intelgs', name: 'Intel® Graphics Software', pub: 'INTEL CORP', on: false, impact: 'none', origin: 'store', path: 'Intel Graphics Software StartupTask' },
    { id: 'terminal', name: 'Terminal', pub: 'Microsoft Corporation', on: false, impact: 'none', origin: 'store', path: 'Windows Terminal StartupTask' },
    { id: 'intelgcc', name: 'Intel® Graphics Command Center', pub: 'INTEL CORP', on: false, impact: 'none', origin: 'store', path: 'Intel Graphics Command Center StartupTask' },
    { id: 'teams', name: 'Microsoft Teams', pub: 'Microsoft', on: false, impact: 'none', origin: 'store', path: 'Microsoft Teams StartupTask' },
    { id: 'epic', name: 'EpicGamesLauncher.exe', pub: '', on: false, impact: 'none', origin: 'registry', path: 'HKCU\\…\\CurrentVersion\\Run\\EpicGamesLauncher' },
    { id: 'roblox', name: 'RobloxPlayerBeta.exe', pub: '', on: false, impact: 'none', origin: 'registry', path: 'HKCU\\…\\CurrentVersion\\Run\\Roblox' },
    { id: 'proton', name: 'ProtonVPN.Launcher.exe', pub: '', on: false, impact: 'none', origin: 'registry', path: 'HKCU\\…\\CurrentVersion\\Run\\ProtonVPN' },
    { id: 'dawn', name: 'Dawn (Feather).exe', pub: '', on: false, impact: 'none', origin: 'registry', path: 'HKCU\\…\\CurrentVersion\\Run\\Dawn' },
    { id: 'kpm', name: 'kpm.exe', pub: '', on: false, impact: 'none', origin: 'registry', path: 'HKCU\\…\\CurrentVersion\\Run\\kpm' },
    { id: 'steam', name: 'steam.exe', pub: '', on: false, impact: 'none', origin: 'registry', path: 'HKCU\\…\\CurrentVersion\\Run\\Steam' },
    { id: 'onedrive', name: 'OneDrive.exe', pub: '', on: false, impact: 'none', origin: 'registry', path: 'HKCU\\…\\CurrentVersion\\Run\\OneDrive' },
  ],
  services: [
    { id: 'DiagTrack', name: 'Windows telemetry', desc: 'Sends usage and diagnostic data to Microsoft.', run: true, start: 'auto', bal: 'manual', max: 'disabled' },
    { id: 'Spooler', name: 'Print spooler', desc: 'Needed to print. Your PC has no printers installed.', run: true, start: 'auto', bal: 'manual', max: 'disabled', warn: 'If you ever need to print, turn it back on.' },
    { id: 'Fax', name: 'Fax', desc: 'Send and receive faxes.', run: false, start: 'manual', bal: 'disabled', max: 'disabled' },
    { id: 'RetailDemo', name: 'Retail demo mode', desc: 'Only used by display PCs in stores.', run: false, start: 'manual', bal: 'disabled', max: 'disabled' },
    { id: 'MapsBroker', name: 'Downloaded maps', desc: 'Updates offline maps for the Maps app.', run: false, start: 'auto', bal: 'manual', max: 'disabled' },
    { id: 'WerSvc', name: 'Error reporting', desc: 'Sends reports to Microsoft when something fails.', run: false, start: 'manual', bal: null, max: 'disabled' },
    { id: 'SysMain', name: 'SysMain (app preloading)', desc: "Loads the apps you use most into memory. On a fast SSD it's barely noticeable.", run: true, start: 'auto', bal: null, max: 'manual' },
    { id: 'WSearch', name: 'Search indexing', desc: 'Builds the index that makes file search instant.', run: true, start: 'auto', bal: null, max: 'manual', warn: 'Searching for files from Start will be slower.' },
    { id: 'Xbox', name: 'Xbox services', desc: 'Xbox Live sign-in, saved games and networking.', run: false, start: 'manual', bal: null, max: 'disabled', warn: 'If you play with Game Pass or the Xbox app, leave them on.' },
    { id: 'lfsvc', name: 'Geolocation', desc: 'Gives your location to apps that ask for it.', run: true, start: 'manual', bal: null, max: 'disabled', warn: 'Apps that use your location will no longer know it.' },
    { id: 'RemoteRegistry', name: 'Remote registry', desc: "Lets another computer change this PC's registry.", run: false, start: 'disabled', bal: 'disabled', max: 'disabled' },
  ],
  registry: [
    { g: 'Broken uninstallers', items: [
      ['HKLM\\…\\Uninstall\\Movavi Video Editor 26', 'The uninstaller C:\\Program Files\\Movavi Video Editor 26\\uninst.exe no longer exists.'],
      ['HKCU\\…\\Uninstall\\AutoTunePro9', 'Points to a folder that was deleted by hand.'] ] },
    { g: 'Broken app paths', items: [
      ['HKLM\\…\\App Paths\\blender.exe', 'Points to Blender 4.1, which is gone; you have 4.2 in another folder.'],
      ['HKLM\\…\\App Paths\\CapCut.exe', 'Points to an old version of CapCut.'],
      ['HKCU\\…\\App Paths\\movavi.exe', 'The file no longer exists.'] ] },
    { g: 'Orphaned file types', items: [
      ['HKCR\\.mepx', 'Movavi project: no program opens it.'],
      ['HKCR\\.mvd', 'No installed program opens it.'],
      ['HKCR\\Movavi.VideoEditor.26', 'Class of an uninstalled program.'],
      ['HKCR\\.atp9', 'Preset of an uninstalled plugin.'],
      ['HKCR\\AutoTunePro9.Preset', 'Class of an uninstalled program.'],
      ['HKCR\\.tmpx', 'Extension with no associated program.'] ] },
    { g: 'Startup entries pointing nowhere', items: [
      ['HKCU\\…\\Run\\UpdaterHelper', "Starts C:\\Users\\usuario\\AppData\\Local\\Temp\\upd_1b2.exe, which doesn't exist."] ] },
    { g: 'Missing shared files', items: [
      ['SharedDLLs\\…\\Movavi\\mvcodec.dll', 'The file no longer exists.'],
      ['SharedDLLs\\…\\Movavi\\mvfx.dll', 'The file no longer exists.'],
      ['SharedDLLs\\…\\Common Files\\VST3\\AutoTune Pro 9.vst3', 'The plugin no longer exists.'],
      ['SharedDLLs\\…\\OldUpdater\\helper.dll', 'The file no longer exists.'],
      ['SharedDLLs\\…\\OldUpdater\\net.dll', 'The file no longer exists.'] ] },
    { g: 'Broken context menu entries', items: [
      ['HKCR\\*\\shellex\\ContextMenuHandlers\\MovaviShell', 'Adds an entry that no longer works to the right-click menu.'],
      ['HKCR\\Directory\\shell\\OpenWithAutoTune', 'The program no longer exists.'] ] },
  ],
  /* read from Windows (sample outside the app): Windows 11 power mode when plugged in (ac) and on battery (dc),
     visual effects (SystemPropertiesPerformance), game mode, HAGS and background permission of some apps */
  perf: { ac: 'balanced', dc: 'efficiency', visual: 'auto', gameMode: true, hags: true,
    bg: [{ id: 'spotify', n: 'Spotify', v: 'opt' }, { id: 'whatsapp', n: 'WhatsApp', v: 'always' }, { id: 'xbox', n: 'Xbox', v: 'opt' }, { id: 'photos', n: 'Photos', v: 'never' }] },
};
DB.clean.forEach(c => { c.sel = c.def && !c.busy; });
DB.startup.forEach(s => s.orig = s.on);
DB.services.forEach(s => { s.orig = s.start; s.cur = s.start; });
let regDone = false;

/* ================= real engine =================
   Inside the app everything comes from stellarhub/engine/optimizer.py; outside (browser) the sample above stays. */
let REAL = false;
const realP = SH.apiReady.then(a => { REAL = !!a; if (REAL) { DB.clean = []; DB.startup = []; DB.services = []; DB.registry = []; DB.boots = []; DB.bios = null; } return REAL; });
const loaded = {};
const last = { svcBackup: null, regBackup: null, prevAc: null, startupChanged: [] };
/* engine call: if administrator rights are needed it says so (without nagging) and stops */
async function eng(fn, ...a) {
  const r = await SH.engine('optimizer', fn, ...a);
  if (r && r.needAdmin) { SH.requireAdmin('to make this change in Windows.'); const e = new Error('Needs administrator mode'); e.needAdmin = true; throw e; }
  return r;
}
async function engJob(fn, args = [], o = {}) {
  const r = await SH.job('optimizer', fn, args, o);
  if (r && r.needAdmin) { SH.requireAdmin('to make this change in Windows.'); const e = new Error('Needs administrator mode'); e.needAdmin = true; throw e; }
  return r;
}
const LOADERS = {
  async clean() { const r = await engJob('clean_scan', [cleanOpts()]); DB.clean = r.map(c => ({ ...c })); DB.clean.forEach(c => { applySkips(c); c.sel = c.def && !c.busy && c.size > 0 && (!c.admin || state.admin); }); publishJunk(); },
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
/* temp folders: how many days to keep (setting cleanTempDays), folders skipped always (setting cleanExclusions)
   and folders unchecked only for this run. Rows come from the engine, one per first-level folder of the temp folder. */
const DAY_CHOICES = [1, 7, 30];
const tempDays = () => DAY_CHOICES.includes(+state.settings.cleanTempDays) ? +state.settings.cleanTempDays : 7;
const permEx = () => Array.isArray(state.settings.cleanExclusions) ? state.settings.cleanExclusions : [];
const skipNow = new Set();
const rowKey = r => r.kind === 'files' ? 'loose:' + r.path : r.path;
const cleanOpts = () => ({ days: tempDays(), exclude: [...permEx(), ...skipNow] });
/* a temp category's size is the sum of the rows that will really be emptied */
function applySkips(c) { if (!c.rows) return; const go = c.rows.filter(r => r.status === 'clean' && !skipNow.has(rowKey(r))); c.size = go.reduce((a, r) => a + r.size, 0); c.files = go.reduce((a, r) => a + r.files, 0); }
DB.clean.forEach(applySkips);
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
  /* cleans; onCat(c) gets each category once it is done, onStatus(d) the live numbers (deleted, total, freed,
     current, rate, eta) several times a second; ctl.cancel() is filled in so the caller can stop it */
  async clean(ids, onCat, onStatus, ctl = {}) {
    const start = {}; ids.forEach(id => { const c = DB.clean.find(x => x.id === id); if (c) start[id] = c.size; });
    const finish = (id, freedHere) => { const c = DB.clean.find(x => x.id === id); if (!c || c._done) return; c._done = true; c.size = Math.max(0, start[id] - freedHere); c.sel = false;
      if (c.rows) c.rows.forEach(r => { if (r.status === 'clean' && !skipNow.has(rowKey(r))) { r.status = 'done'; r.reason = 'Cleaned'; } });
      onCat && onCat(c); };
    ids.forEach(id => { const c = DB.clean.find(x => x.id === id); if (c) delete c._done; });
    if (REAL) {
      const p = SH.job('optimizer', 'clean', [ids, cleanOpts()], { onProgress: m => { const d = m.data || {}; try { onStatus && onStatus(d); } catch (e) { console.error(e); }
        if (d.id && d.catFreed !== undefined && start[d.id] !== undefined) finish(d.id, d.catFreed); } });
      ctl.cancel = () => p.cancel();
      const r = await p;
      if (r && r.needAdmin) { SH.requireAdmin('to make this change in Windows.'); const e = new Error('Needs administrator mode'); e.needAdmin = true; throw e; }
      Object.entries(r.per || {}).forEach(([id, f]) => finish(id, f));
      publishJunk(); return r;
    }
    /* sample mode: the same shape of numbers, slowed down so the progress can be seen */
    let stop = false; ctl.cancel = () => { stop = true; };
    const total = ids.reduce((a, id) => a + (DB.clean.find(x => x.id === id).files || 0), 0), totalBytes = ids.reduce((a, id) => a + start[id], 0);
    let deleted = 0, freed = 0; const t0 = performance.now();
    for (const id of ids) { if (stop) break; const c = DB.clean.find(x => x.id === id); const steps = 24, cf = c.files || 0, cs = start[id];
      for (let i = 1; i <= steps && !stop; i++) { await wait(60 + Math.random() * 50); deleted += cf / steps; freed += cs / steps; c.size = cs * (1 - i / steps);
        const el = (performance.now() - t0) / 1000, rate = deleted / Math.max(.001, el);
        onStatus && onStatus({ deleted: Math.round(deleted), total, freed, totalBytes, skipped: 0, current: (c.rows && c.rows[0] ? c.rows[0].short : c.paths[0]) || c.label, rate: Math.round(rate), eta: rate > 1 ? Math.round((total - deleted) / rate) : null }); }
      if (!stop) finish(id, cs); }
    publishJunk(); return { freed, deleted: Math.round(deleted), skipped: 0, cancelled: stop, per: {}, busyCats: [], skippedCats: [] };
  },
};

/* ================= helpers ================= */
const LOAD_TXT = { clean: 'Measuring how much each category takes…', startup: 'Reading what starts with Windows…', services: 'Reading services…', registry: 'Looking for broken registry entries…', performance: 'Reading Windows settings…' };
const loadingHTML = tab => `<div class="opt-load"><div class="opt-spin"></div><b>${LOAD_TXT[tab] || 'Loading…'}</b><span class="muted">Read-only; nothing changes.</span>
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
/* bar height relative to the slowest boot, with a minimum so they're always visible */
const bh = s => Math.max(.12, Math.min(1, s / (Math.max(1, ...DB.boots) * 1.08))).toFixed(3);
const bootAvg = () => DB.boots.length ? DB.boots.reduce((a, b) => a + b, 0) / DB.boots.length : 0;
const freeC = () => SH.tele.has && SH.tele.has('diskUsed') && SH.tele.has('diskTotal') ? SH.tele.v.diskTotal - SH.tele.v.diskUsed : 361;
/* approximate seconds per impact level (the same levels Task Manager uses) */
const IMPACT_S = { high: 3, medium: 1.5, low: .4, none: 0, unmeasured: 0 };
const impS = s => IMPACT_S[s.impact] * (s.count || 1);
const bootSaved = () => DB.startup.filter(s => s.orig && !s.on).reduce((a, s) => a + impS(s), 0) * .85;
const recStartup = () => DB.startup.filter(s => s.rec && s.on);
const reviewStartup = () => DB.startup.filter(s => s.review && s.on);
const POWER = { efficiency: 'Best power efficiency', balanced: 'Balanced', best: 'Best performance' };
const servicePending = p => DB.services.filter(s => s[p] && s[p] !== s.cur);
const regCount = () => regDone ? 0 : DB.registry.reduce((a, g) => a + g.items.length, 0);
const rendered = {};
const refresh = tab => { if (rendered[tab]) try { rendered[tab](); } catch (e) { console.error(e); } };

/* ================= Overview ================= */
let score = 64;
/* score from what's really there: junk, heavy startup, unneeded services and broken entries */
function calcScore() {
  const junk = totalAll() / 1e9, heavy = DB.startup.filter(s => s.on && (s.impact === 'high' || s.rec)).length, rv = reviewStartup().length;
  const s = 100 - Math.min(25, junk * .8) - Math.min(15, heavy * 4 + rv * 3) - Math.min(10, servicePending('bal').length * 2) - Math.min(10, regCount() * .5);
  return Math.max(25, Math.min(99, Math.round(s)));
}
function projected() {
  const sel = DB.clean.filter(c => c.sel).reduce((a, c) => a + c.size, 0) / 1e9;
  return Math.min(99, score + Math.round(Math.min(25, sel * .8)) + Math.min(15, recStartup().length * 4) + Math.min(10, servicePending('bal').length * 2) + Math.min(10, Math.round(regCount() * .5)));
}
const AREAS = [
  { id: 'clean', n: 'Cleanup', ic: 'broom', tab: 'clean', txt: () => totalAll() > 1e8 ? `${gb(totalAll())} in ${DB.clean.filter(c => c.size > 0).length} categories` : 'Nothing to clean', val: () => totalAll() > 1e8 ? gb(totalAll()) : 'Good', bad: () => totalAll() > 3e9 },
  { id: 'startup', n: 'Startup', ic: 'bolt', tab: 'startup', txt: () => { const on = DB.startup.filter(s => s.on).length, rv = reviewStartup(); return `${on} of ${DB.startup.length} start with Windows${rv.length ? `; ${rv.reduce((a, s) => a + (s.count || 1), 0)} high-impact scripts` : ''}`; }, val: () => reviewStartup().length ? 'Review' : 'Good', bad: () => false },
  { id: 'services', n: 'Services', ic: 'service', tab: 'services', txt: () => servicePending('bal').length ? `${servicePending('bal').length} services you don't use` : 'No recommended changes', val: () => servicePending('bal').length || 'Good', bad: () => false },
  { id: 'registry', n: 'Registry', ic: 'reg', tab: 'registry', txt: () => regCount() ? `${regCount()} broken entries` : 'No broken entries', val: () => regCount() || 'Good', bad: () => false },
  { id: 'performance', n: 'Performance', ic: 'optimizer', tab: 'performance', txt: () => `Power mode when plugged in: ${POWER[DB.perf.ac].toLowerCase()}`, val: () => DB.perf.ac === 'best' ? 'Good' : 'Could be better', bad: () => false },
];
const tone = a => a.bad() ? 'bad' : a.val() === 'Good' ? 'ok' : 'warn';
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
const ovFoot = () => `<div class="ov-foot"><div class="ov-fi"><span class="faint">Last optimization</span><b>${lastRun ? 'Today, just now' : 'Never from StellarHub'}</b></div><div class="ov-fi"><span class="faint">Free space on C:</span><b>${SH.fmtInt(freeC() + (lastRun && !REAL ? lastRun.freed / 1e9 : 0))} GB</b></div><div class="ov-fi"><span class="faint">${DB.boots.length ? 'Average boot' : 'BIOS time'}</span><b>${DB.boots.length ? fmt1(bootAvg() - bootSaved()) + ' s' : DB.bios ? fmt1(DB.bios) + ' s' : '—'}</b></div><button class="ov-auto" data-go-auto>${ic('autopilot')}<span><b>Do it automatically every week</b>Create an Autopilot routine</span>${ic('chev')}</button></div>`;
const findingsHTML = () => `<h4 class="pan-h">What we found <em>just now</em></h4><div class="rows">${AREAS.map(a => `<div class="row ov-row" data-area="${a.id}"><span class="ri">${ic(a.ic)}</span><span class="rt"><b>${a.n}</b><span>${esc(a.txt())}</span></span><span class="ov-bar ${tone(a)}"><i style="transform:scaleX(${areaFill(a)})"></i></span><span class="ov-v ${tone(a)}">${a.val()}</span><button class="btn sm ghost" data-tab="${a.tab}">Review</button></div>`).join('')}</div>${ovFoot()}`;
let ovEl = null, ovMode = 'findings', running = false;
function renderOverview(el, ctx) {
  ovEl = el; el.classList.add('fill');
  el.innerHTML = `<div class="ov">
    <div class="pan ov-l" data-asm>
      <div class="ring-wrap">${ringSVG()}<div class="ring-c"><b id="optScore">0</b><span id="optScoreLbl">analyzing…</span></div></div>
      <div class="ov-state" id="optState">Checking your system</div>
      <div class="ov-sub muted" id="optSub">This is read-only; nothing changes.</div>
      <button class="btn pri lg ov-cta" id="optAll" disabled>${ic('sparkle')}Optimize everything</button>
      <button class="btn ghost sm" id="optRescan" hidden>${ic('scan')}Analyze again</button>
    </div>
    <div class="pan ov-r" data-asm><div id="optRight"><h4 class="pan-h">What we found <em>in progress</em></h4><div class="rows">${AREAS.map(a => `<div class="row ov-row pending" data-area="${a.id}"><span class="ri">${ic(a.ic)}</span><span class="rt"><b>${a.n}</b><span class="sk" style="display:block;height:9px;width:${40 + Math.round(Math.random() * 30)}%;margin-top:7px"></span></span><span class="ov-bar"><i style="transform:scaleX(0)"></i></span><span class="ov-v"></span><button class="btn sm ghost" data-tab="${a.tab}" disabled>Review</button></div>`).join('')}</div>${ovFoot()}</div></div></div>`;
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
  $('#optState', el).textContent = 'Checking your system'; $('#optSub', el).textContent = 'This is read-only; nothing changes.'; lbl.textContent = 'analyzing…';
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
  ring.classList.remove('scanning'); SH.countUp(sc, score, 600); lbl.textContent = 'out of 100';
  const em = $('#optRight .pan-h em', el); if (em) em.textContent = 'just now';
  $('#optState', el).textContent = score >= 85 ? 'Your PC is in good shape' : 'There is room to improve';
  $('#optSub', el).textContent = score >= 85 ? 'Nothing urgent. Analyze again whenever you like.' : `“Optimize everything” would get you to about ${REAL ? projected() : 91} points.`;
  if (modCtx) { modCtx.setBadge('clean', DB.clean.filter(c => c.size > 1e7).length); modCtx.setBadge('registry', regCount()); }
  ['clean', 'startup', 'services', 'registry', 'performance'].forEach(refresh);
  $('#optAll', el).disabled = false; $('#optRescan', el).hidden = false;
  anim($('#optAll', el), [{ transform: 'scale(.94)' }, { transform: 'scale(1.04)', offset: .5 }, { transform: 'scale(1)' }], { d: 520 });
}
function planSteps() {
  const sel = DB.clean.filter(c => c.sel && c.size > 0); const rec = recStartup(); const svc = servicePending('bal');
  return [
    { id: 'restore', t: 'Create a restore point', d: "To go back if you don't like something.", admin: true, lock: true, on: true },
    { id: 'clean', t: `Clean ${gb(sel.reduce((a, c) => a + c.size, 0))} of unneeded files`, d: `${sel.length} categories: temporary files, caches, dumps and the Recycle Bin.`, on: sel.length > 0, dis: !sel.length },
    { id: 'startup', t: `Remove ${rec.length} apps from startup`, d: rec.map(r => r.name).join(', ') || 'Nothing recommended', on: rec.length > 0, dis: !rec.length },
    { id: 'services', t: 'Services: balanced profile', d: `${svc.length} services you don't use are set to manual or disabled.`, admin: true, on: svc.length > 0, dis: !svc.length },
    { id: 'registry', t: `Fix ${regCount()} broken registry entries`, d: 'A .reg backup is saved first.', admin: true, on: regCount() > 0, dis: !regCount() },
    { id: 'power', t: 'Power mode when plugged in: best performance', d: 'The same setting as Settings > System > Power. Battery mode stays as it is.', on: DB.perf.ac !== 'best', dis: DB.perf.ac === 'best' },
  ];
}
function showPlan(el) {
  if (running) return; ovMode = 'plan';
  const steps = planSteps(); const right = $('#optRight', el);
  swap(right, `<h4 class="pan-h">Here's what will happen <em>${state.admin ? 'administrator mode' : 'in normal mode some steps are skipped'}</em></h4>
    <div class="plan">${steps.map(s => `<div class="pstep${s.dis ? ' dis' : ''}" data-step="${s.id}"><button class="check${s.on && !s.dis ? ' on' : ''}"${s.lock || s.dis ? ' disabled' : ''} aria-label="${esc(s.t)}">${ic('check')}</button>
      <div class="pt"><b>${esc(s.t)}</b><span>${esc(s.d)}</span></div>${s.admin && !state.admin ? '<span class="chip warn">administrator</span>' : ''}${s.lock ? '<span class="chip">always</span>' : ''}</div>`).join('')}</div>
    <div class="plan-acts"><button class="btn pri lg" id="optGo">${ic('play')}Start</button><button class="btn ghost" id="optCancel">Cancel</button></div>`, () => {
    $$('.pstep', right).forEach((r, i) => anim(r, [{ opacity: 0, transform: 'translate3d(16px,0,0)' }, { opacity: 1, transform: 'none' }], { d: 420, delay: 60 + i * 50, e: EASE.spring }));
    $('.plan', right).addEventListener('click', e => { const c = e.target.closest('.check'); if (c && !c.disabled) c.classList.toggle('on'); });
    $('#optCancel', right).addEventListener('click', () => { ovMode = 'findings'; swap(right, findingsHTML()); });
    $('#optGo', right).addEventListener('click', () => {
      const chosen = $$('.pstep', right).filter(r => $('.check', r).classList.contains('on')).map(r => r.dataset.step);
      if (!state.admin && steps.some(s => s.admin && chosen.includes(s.id))) SH.requireAdmin('to create the restore point, change services and fix the registry. Without it, those steps are skipped.');
      runPlan(el, steps.filter(s => chosen.includes(s.id)));
    });
  });
}
let lastRun = null;
async function runPlan(el, steps) {
  running = true; ovMode = 'run'; const right = $('#optRight', el); $('#optAll', el).disabled = true; $('#optRescan', el).hidden = true;
  const before = { boot: bootSaved(), reg: regCount() };
  swap(right, `<h4 class="pan-h">Optimizing <em id="optFreed">0 MB freed</em></h4><div class="phases">${steps.map(s => `<div class="phase" data-ph="${s.id}"><span class="ph-dot"></span><div class="pt"><b>${esc(s.t)}</b><span class="ph-msg">Waiting</span><div class="bar acc"><span style="transform:scaleX(0)"></span></div></div></div>`).join('')}</div>`);
  await wait(520);
  $('#optState', el).textContent = 'Working…'; $('#optSub', el).textContent = 'You can keep using your PC in the meantime.'; $('.ring', el).classList.add('scanning');
  let freed = 0; const log = [];
  for (const s of steps) {
    const ph = $(`.phase[data-ph="${s.id}"]`, right); if (!ph) continue; ph.classList.add('run');
    const bar = $('.bar>span', ph), msg = $('.ph-msg', ph); const setP = p => { bar.style.transform = `scaleX(${p})`; };
    if (s.admin && !state.admin) { msg.textContent = 'Skipped: needs administrator mode'; ph.classList.remove('run'); ph.classList.add('skip'); log.push(['skip', s.t]); await wait(260); continue; }
    if (REAL) {
      try { const r = await realStep(s, msg, setP); if (r && r.freed !== undefined) { freed += r.freed; const f = $('#optFreed', el); if (f) f.textContent = `${gb(freed)} freed`; } log.push(['ok', r && r.log || s.t]); }
      catch (e) { msg.textContent = `Couldn't do it: ${e.message}`; ph.classList.remove('run'); ph.classList.add('skip'); log.push(['skip', `${s.t}: ${e.message}`]); continue; }
      setP(1); ph.classList.remove('run'); ph.classList.add('done');
      anim($('.ph-dot', ph), [{ transform: 'scale(.4)' }, { transform: 'scale(1.35)', offset: .5 }, { transform: 'scale(1)' }], { d: 420 });
      continue;
    }
    if (s.id === 'restore') { msg.textContent = 'Creating the restore point…'; await tween(0, 1, 1600, setP); msg.textContent = 'Restore point “StellarHub, before optimizing” created'; log.push(['ok', 'Restore point']); }
    if (s.id === 'clean') {
      const ids = DB.clean.filter(c => c.sel && c.size > 0 && (!c.admin || state.admin)).map(c => c.id); const start = {}; ids.forEach(id => start[id] = DB.clean.find(c => c.id === id).size);
      const tot = Object.values(start).reduce((a, b) => a + b, 0);
      await API.clean(ids, null, d => { freed = d.freed || 0; setP(d.total ? d.deleted / d.total : 0); msg.textContent = `Deleted ${SH.fmtInt(d.deleted)} of ${SH.fmtInt(d.total)} files`; const f = $('#optFreed', el); if (f) f.textContent = `${gb(freed)} freed`; });
      msg.textContent = `${gb(freed)} freed`; log.push(['ok', `Cleanup: ${gb(freed)}`]);
    }
    if (s.id === 'startup') { const rec = recStartup(); for (let i = 0; i < rec.length; i++) { rec[i].on = false; msg.textContent = `Removing ${rec[i].name} from startup`; setP((i + 1) / rec.length); await wait(380); } msg.textContent = `${rec.length} apps removed from startup`; log.push(['ok', `Startup: ${rec.length} apps removed`]); }
    if (s.id === 'services') { const sv = servicePending('bal'); for (let i = 0; i < sv.length; i++) { sv[i].cur = sv[i].bal; if (sv[i].cur === 'disabled') sv[i].run = false; msg.textContent = `${sv[i].name}: ${sv[i].bal === 'disabled' ? 'disabled' : 'manual'}`; setP((i + 1) / sv.length); await wait(300); } msg.textContent = `${sv.length} services adjusted`; log.push(['ok', `Services: ${sv.length} adjusted`]); }
    if (s.id === 'registry') { msg.textContent = 'Saving the .reg backup…'; await tween(0, .3, 700, setP); msg.textContent = 'Fixing entries…'; await tween(.3, 1, 1200, setP); const n = regCount(); regDone = true; msg.textContent = `${n} entries fixed; backup in Documents\\StellarHub\\registry`; log.push(['ok', `Registry: ${n} entries fixed`]); }
    if (s.id === 'power') { msg.textContent = 'Changing the power mode…'; await tween(0, 1, 700, setP); DB.perf.ac = 'best'; msg.textContent = 'Best performance when plugged in'; log.push(['ok', 'Power mode: best performance when plugged in']); }
    setP(1); ph.classList.remove('run'); ph.classList.add('done');
    anim($('.ph-dot', ph), [{ transform: 'scale(.4)' }, { transform: 'scale(1.35)', offset: .5 }, { transform: 'scale(1)' }], { d: 420 });
  }
  $('.ring', el).classList.remove('scanning');
  const gained = bootSaved() - before.boot, fixed = before.reg - regCount();
  score = REAL ? calcScore() : Math.min(96, 64 + Math.round(freed / 1e9 * 1.2) + Math.round(gained * 1.1) + (fixed ? 3 : 0) + (DB.perf.ac === 'best' ? 3 : 0) + (servicePending('bal').length ? 0 : 3));
  if (REAL) SH.logActivity('Optimization complete', { sub: `${gb(freed)} freed`, ic: 'sparkle', go: 'optimizer', tab: 'overview' });
  lastRun = { freed, gained, fixed, log };
  SH.countUp($('#optScore', el), score, 1200); paintRing(el);
  await wait(450);
  ovMode = 'done';
  swap(right, `<h4 class="pan-h">Done <em>just now</em></h4>
    <div class="result"><div><b class="big" id="rFreed">0</b><span>GB freed</span></div><div><b class="big" id="rBoot">0</b><span>seconds faster boot</span></div><div><b class="big" id="rFix">0</b><span>entries fixed</span></div></div>
    <div class="rows res-log">${log.map(([k, t]) => `<div class="row"><span class="ri ${k}">${ic(k === 'ok' ? 'check' : 'shield')}</span><span class="rt"><b>${esc(t)}</b><span>${k === 'ok' ? 'Done' : 'Skipped: turn on administrator mode to do it'}</span></span></div>`).join('')}</div>
    <div class="plan-acts"><button class="btn sec" id="optUndo">${ic('undo')}Undo changes</button><button class="btn ghost" id="optBack">Back to overview</button></div>`, () => {
    SH.countUp($('#rFreed', right), freed / 1e9, 1100, 1); SH.countUp($('#rBoot', right), gained, 1100, 1); SH.countUp($('#rFix', right), fixed, 900);
    $$('.res-log .row', right).forEach((r, i) => anim(r, [{ opacity: 0, transform: 'translate3d(0,8px,0)' }, { opacity: 1, transform: 'none' }], { d: 380, delay: 200 + i * 60, e: EASE.spring }));
    $('#optUndo', right).addEventListener('click', () => undo(el)); $('#optBack', right).addEventListener('click', () => { ovMode = 'findings'; swap(right, findingsHTML()); });
  });
  $('#optState', el).textContent = 'Your PC is in good shape'; $('#optSub', el).textContent = 'Changes can be undone from here or with the restore point.';
  $('#optAll', el).disabled = false; $('#optRescan', el).hidden = false; running = false;
  ['clean', 'startup', 'services', 'registry', 'performance'].forEach(refresh);
  SH.toast(`Optimization finished: ${gb(freed)} freed.`);
}
/* one real step of “Optimize everything” */
async function realStep(s, msg, setP) {
  if (s.id === 'restore') {
    msg.textContent = 'Creating the restore point… (it can take a minute)';
    const r = await engJob('restore_point', ['StellarHub, before optimizing'], { onProgress: m => setP(m.pct) });
    if (!r.ok) throw new Error(r.msg || "Windows didn't create it");
    msg.textContent = 'Restore point “StellarHub, before optimizing” created'; return { log: 'Restore point created' };
  }
  if (s.id === 'clean') {
    const ids = DB.clean.filter(c => c.sel && c.size > 0 && (!c.admin || state.admin)).map(c => c.id);
    const tot = ids.reduce((a, id) => a + DB.clean.find(c => c.id === id).size, 0);
    msg.textContent = 'Cleaning…';
    const r = await API.clean(ids, null, d => { if (!d.total) { msg.textContent = 'Checking which folders running programs are using…'; return; }
      setP(Math.min(.99, (d.deleted + (d.skipped || 0)) / d.total)); msg.textContent = `Deleted ${SH.fmtInt(d.deleted)} of ${SH.fmtInt(d.total)} files · ${gb(d.freed || 0)} freed`; });
    setP(1); msg.textContent = `${gb(r.freed)} freed${r.skipped ? `; ${SH.fmtInt(r.skipped)} files in use were skipped` : ''}`;
    return { freed: r.freed, log: `Cleanup: ${gb(r.freed)} of ${gb(tot)}` };
  }
  if (s.id === 'startup') {
    const rec = recStartup(); last.startupChanged = [];
    for (let i = 0; i < rec.length; i++) { msg.textContent = `Removing ${rec[i].name} from startup`; await eng('startup_set', rec[i].ids, false); rec[i].on = false; last.startupChanged.push(rec[i]); setP((i + 1) / rec.length); }
    msg.textContent = `${rec.length} apps removed from startup`; return { log: `Startup: ${rec.length} apps removed` };
  }
  if (s.id === 'services') {
    const sv = servicePending('bal'); const changes = {}; sv.forEach(x => changes[x.id] = x.bal);
    msg.textContent = 'Changing services…';
    const r = await eng('services_apply', changes); last.svcBackup = r.backup; await load('services', true);
    msg.textContent = `${sv.length} services adjusted${r.ok ? '' : " (one didn't accept the change)"}`; return { log: `Services: ${sv.length} adjusted` };
  }
  if (s.id === 'registry') {
    const ids = DB.registry.flatMap(g => g.items.map(i => i[2]));
    msg.textContent = 'Saving the .reg backup and fixing…';
    const r = await engJob('registry_fix', [ids], { onProgress: m => setP(m.pct) }); last.regBackup = r.backup;
    await load('registry', true); regDone = !regCount();
    msg.textContent = `${r.fixed} entries fixed; backup in ${r.folder}`; return { log: `Registry: ${r.fixed} entries fixed` };
  }
  if (s.id === 'power') {
    last.prevAc = DB.perf.ac; const r = await eng('perf_set', 'ac', 'best'); Object.assign(DB.perf, r);
    msg.textContent = 'Best performance when plugged in'; return { log: 'Power mode: best performance when plugged in' };
  }
}
async function undo(el) {
  if (REAL) {
    const errs = [];
    for (const s of last.startupChanged) { try { await eng('startup_set', s.ids, true); s.on = true; } catch (e) { errs.push(s.name); } }
    last.startupChanged = [];
    if (last.svcBackup) { try { await eng('services_undo', last.svcBackup); last.svcBackup = null; await load('services', true); } catch (e) { errs.push('services'); } }
    if (last.regBackup) { try { await eng('registry_undo', last.regBackup); last.regBackup = null; await load('registry', true); } catch (e) { errs.push('registry'); } }
    if (last.prevAc && last.prevAc !== DB.perf.ac) { try { Object.assign(DB.perf, await eng('perf_set', 'ac', last.prevAc)); } catch (e) { errs.push('power'); } }
    score = calcScore(); SH.countUp($('#optScore', el), score, 900);
    ['startup', 'services', 'registry', 'performance'].forEach(refresh); ovMode = 'findings'; swap($('#optRight', el), findingsHTML()); paintRing(el);
    SH.toast(errs.length ? `Undone, except: ${errs.join(', ')}.` : "Changes undone. Deleted files can't be recovered.");
    SH.logActivity('Optimization undone', { ic: 'restore', go: 'optimizer', tab: 'overview' });
    return;
  }
  DB.startup.forEach(s => s.on = s.orig); DB.services.forEach(s => s.cur = s.orig); regDone = false; DB.perf.ac = 'balanced';
  score = 64 + Math.round((lastRun ? lastRun.freed : 0) / 1e9 * 1.2); SH.countUp($('#optScore', el), score, 900);
  ['startup', 'services', 'registry', 'performance'].forEach(refresh); ovMode = 'findings'; swap($('#optRight', el), findingsHTML()); paintRing(el);
  SH.toast("Changes undone. Deleted files can't be recovered.");
}

/* ================= Cleanup ================= */
const ST_CHIP = { in_use: ['warn', 'in use'], recent: ['', 'recent'], excluded: ['', 'skipped'], link: ['', 'link'], done: ['ok', 'cleaned'] };
const ROWS_SHOWN = 80;
const dur = s => s == null ? '' : s < 60 ? `${Math.max(1, Math.round(s))} s` : s < 3600 ? `${Math.floor(s / 60)} min ${Math.round(s % 60)} s` : `${Math.floor(s / 3600)} h ${Math.round(s % 3600 / 60)} min`;
/* the per-folder preview of a temp category: what will be emptied, what is kept and why */
function tempDetHTML(c) {
  const rows = c.rows || [], perm = permEx();
  const kept = rows.filter(r => r.status !== 'clean' && r.status !== 'done');
  const keptSize = kept.reduce((a, r) => a + r.size, 0);
  const days = tempDays();
  const row = r => {
    const k = rowKey(r), can = r.status === 'clean', on = can && !skipNow.has(k), chip = ST_CHIP[r.status], isPerm = perm.includes(k);
    const act = isPerm ? `<button class="btn ghost xs" data-unperm="${esc(k)}">Stop skipping</button>`
      : (can || r.status === 'recent' || r.status === 'in_use') ? `<button class="btn ghost xs" data-perm="${esc(k)}">Always skip</button>` : '<span></span>';
    return `<div class="cl-tr${can ? '' : ' kept'}${on ? ' on' : ''}" data-k="${esc(k)}">
      <button class="check${on ? ' on' : ''}"${can ? '' : ' disabled'} aria-label="${esc(r.name)}">${ic('check')}</button>
      <div class="cl-tn"><b title="${esc(r.path)}">${esc(r.name)}${chip ? ` <span class="chip ${chip[0]}">${chip[1]}</span>` : ''}</b><span>${esc(r.reason || (r.kind === 'files' ? 'Loose files older than the limit' : 'Nothing inside changed recently'))}</span></div>
      <span class="cl-tf faint">${r.kind === 'link' ? '' : SH.fmtInt(r.files) + ' files'}</span><span class="cl-ts">${r.kind === 'link' ? '' : gb(r.size)}</span>${act}</div>`;
  };
  const others = perm.filter(k => !rows.some(r => rowKey(r) === k));
  return `<p class="cl-rule">${ic('shield')}<span>Folders changed in the last <b>${days} day${days > 1 ? 's' : ''}</b>, folders a running program uses and links to other places are kept whole.${kept.length ? ` Keeping ${kept.length} folder${kept.length > 1 ? 's' : ''} (${gb(keptSize)}).` : ''} Uncheck a folder to keep it this time.</span></p>
    <div class="cl-tbl">${rows.slice(0, ROWS_SHOWN).map(row).join('')}${rows.length > ROWS_SHOWN ? `<p class="faint cl-more">and ${rows.length - ROWS_SHOWN} more small folders</p>` : ''}${rows.length ? '' : '<p class="faint">Nothing here.</p>'}</div>
    ${others.length ? `<div class="cl-perm"><span class="muted">Always skipped</span>${others.map(k => `<div class="cl-pi"><span title="${esc(k)}">${esc(k.replace(/^loose:/, 'Loose files in '))}</span><button class="btn ghost xs" data-unperm="${esc(k)}">Remove</button></div>`).join('')}</div>` : ''}`;
}
function renderClean(el) {
  el.classList.add('fill');
  const groups = [...new Set(DB.clean.map(c => c.g))];
  /* two real columns, balanced by item count (CSS columns don't get along with animations) */
  const cols = [[], []], load = [0, 0];
  groups.map(g => [g, DB.clean.filter(c => c.g === g).reduce((a, c) => a + 1 + (c.rows ? 3 : 0), 0)]).sort((x, y) => y[1] - x[1]).forEach(([g, n]) => { const i = load[0] <= load[1] ? 0 : 1; cols[i].push(g); load[i] += n + 1.5; });
  const days = tempDays();
  const detHTML = c => (c.busy ? `<p class="warn-t">${esc(c.label)} is open. Close it to clean its cache; otherwise it's skipped.</p>` : '') + (c.rows ? tempDetHTML(c)
    : `<p class="faint">${SH.fmtInt(c.files)} files</p>${c.paths.map(p => `<div class="cl-path">${ic('folder')}<span>${esc(p)}</span></div>`).join('')}`);
  el.innerHTML = `<div class="cl">
    <div class="pan cl-top" data-asm><div class="cl-tot"><span class="muted">Selected</span><div><b class="big" id="clTot">0</b><small class="muted"> GB</small></div></div>
      <div class="cl-meta"><span id="clCount"></span><span class="faint" id="clAllSize"></span></div>
      <div class="cl-days"><span class="muted">Keep temp files from the last</span><div class="seg" id="clDays"><span class="ind"></span>${DAY_CHOICES.map(d => `<button data-v="${d}"${d === days ? ' class="on"' : ''}>${d} day${d > 1 ? 's' : ''}</button>`).join('')}</div></div>
      <div class="cl-acts"><button class="btn ghost sm" id="clRec">Select recommended</button><button class="btn ghost sm" id="clNone">Clear selection</button><button class="btn pri lg" id="clGo">${ic('broom')}Clean selected</button></div></div>
    <div class="pan cl-run" id="clRun" hidden><div class="cl-run-h"><b id="clRunT">Getting ready…</b><span class="faint" id="clRunE"></span><button class="btn ghost sm" id="clCancel">${ic('stop')}Cancel</button></div>
      <div class="cl-bar"><span></span></div>
      <div class="cl-run-s"><span id="clRunF"></span><span id="clRunR"></span><span id="clRunK"></span></div><div class="cl-run-c faint" id="clRunC"></div></div>
    <div class="cl-list">${cols.map(col => `<div class="cl-col">${col.map(g => `<div class="cl-g" data-asm><div class="cl-gh">${esc(g)}<em data-g="${esc(g)}"></em></div>${DB.clean.filter(c => c.g === g).map(c => `
      <div class="cl-it${c.rows && c.id === 'user_temp' ? ' open' : ''}" data-id="${c.id}">
        <div class="cl-row"><button class="check" aria-label="${esc(c.label)}">${ic('check')}</button>
          <div class="rt"><b>${esc(c.label)}${c.busy ? ' <span class="chip warn">open</span>' : ''}${c.admin && !state.admin ? ' <span class="chip">administrator</span>' : ''}</b><span>${esc(c.desc)}</span></div>
          <span class="cl-size"></span><button class="iconbtn cl-x" aria-label="Show details">${ic('chevd')}</button></div>
        <div class="cl-det"><div><div class="cl-det-in">${detHTML(c)}</div></div></div>
        <div class="cl-prog"><span></span></div></div>`).join('')}</div>`).join('')}</div>`).join('')}</div></div>`;
  const tot = $('#clTot', el);
  let busy = false;
  const upd = () => { SH.countUp(tot, totalSel() / 1e9, 450, 1); $('#clCount', el).textContent = `${DB.clean.filter(c => c.sel && c.size > 0).length} categories`; $('#clAllSize', el).textContent = `of ${gb(totalAll())} that can be cleaned`; $('#clGo', el).disabled = busy || !totalSel(); };
  function sync() {
    DB.clean.forEach(c => { const it = $(`.cl-it[data-id="${c.id}"]`, el); if (!it) return; it.classList.toggle('sel', c.sel); $('.check', it).classList.toggle('on', c.sel); it.classList.toggle('clean', c.size === 0); $('.cl-size', it).textContent = c.size ? gb(c.size) : 'Clean'; });
    $$('.cl-gh em', el).forEach(e => e.textContent = gb(DB.clean.filter(c => c.g === e.dataset.g).reduce((a, c) => a + c.size, 0))); upd();
  }
  const redrawTemp = c => { const box = $(`.cl-it[data-id="${c.id}"] .cl-det-in`, el); if (box) box.innerHTML = detHTML(c); };
  /* changing the days or removing an exclusion needs a fresh look at the folders */
  async function rescan() {
    if (!REAL) { renderClean(el); SH.assemble(el, 0, 30); return; }
    el.innerHTML = loadingHTML('clean');
    try { await load('clean', true); } catch (e) { SH.toast(`Couldn't measure: ${e.message}`); }
    el.innerHTML = ''; renderClean(el); SH.assemble(el, 0, 30);
  }
  sync();
  requestAnimationFrame(() => { const sg = $('#clDays', el); if (sg) SH.placeSeg(sg, true); });
  if (el._clClick) el.removeEventListener('click', el._clClick);
  el._clClick = e => {
    if (busy && !e.target.closest('#clCancel, .cl-x')) return;
    const db = e.target.closest('#clDays button');
    if (db) { if (db.classList.contains('on')) return; $$('#clDays button', el).forEach(x => x.classList.toggle('on', x === db)); SH.placeSeg($('#clDays', el)); SH.setSetting('cleanTempDays', +db.dataset.v); setTimeout(rescan, 220); return; }
    const pb = e.target.closest('[data-perm]');
    if (pb) {
      const k = pb.dataset.perm; SH.setSetting('cleanExclusions', [...permEx().filter(x => x !== k), k]); skipNow.delete(k);
      DB.clean.forEach(c => { if (!c.rows) return; c.rows.forEach(r => { if (rowKey(r) === k && r.status === 'clean') { r.status = 'excluded'; r.reason = 'You chose to always keep it'; } }); applySkips(c); if (!c.size) c.sel = false; redrawTemp(c); });
      sync(); SH.toast('It will always be skipped. You can undo it here.'); return;
    }
    const ub = e.target.closest('[data-unperm]');
    if (ub) { SH.setSetting('cleanExclusions', permEx().filter(x => x !== ub.dataset.unperm)); rescan(); return; }
    const tr = e.target.closest('.cl-tr');
    if (tr) {
      if (tr.classList.contains('kept')) return;
      const k = tr.dataset.k; if (skipNow.has(k)) skipNow.delete(k); else skipNow.add(k);
      const on = !skipNow.has(k); tr.classList.toggle('on', on); $('.check', tr).classList.toggle('on', on);
      const c = DB.clean.find(x => x.id === tr.closest('.cl-it').dataset.id); applySkips(c); if (!c.size) c.sel = false; sync(); return;
    }
    const it = e.target.closest('.cl-it'); if (!it) return;
    if (e.target.closest('.cl-x')) { it.classList.toggle('open'); return; }
    if (e.target.closest('.cl-row') && !it.classList.contains('clean') && !it.classList.contains('busyrun')) {
      const c = DB.clean.find(x => x.id === it.dataset.id); c.sel = !c.sel; it.classList.toggle('sel', c.sel); $('.check', it).classList.toggle('on', c.sel); upd(); }
  };
  el.addEventListener('click', el._clClick);
  $('#clRec', el).addEventListener('click', () => { if (busy) return; DB.clean.forEach(c => c.sel = c.def && !c.busy && c.size > 0); sync(); });
  $('#clNone', el).addEventListener('click', () => { if (busy) return; DB.clean.forEach(c => c.sel = false); sync(); });
  $('#clGo', el).addEventListener('click', async () => {
    if (busy) return;
    let ids = DB.clean.filter(c => c.sel && c.size > 0).map(c => c.id);
    const needAdmin = ids.filter(id => DB.clean.find(c => c.id === id).admin);
    if (needAdmin.length && !state.admin) { SH.requireAdmin('to clean Windows temporary files and Windows Update downloads. Everything else is cleaned anyway.'); ids = ids.filter(id => !needAdmin.includes(id)); }
    if (!ids.length) return;
    const go = $('#clGo', el);
    /* what can't be undone (emptying the Recycle Bin) needs a second click */
    if (ids.includes('recycle') && state.settings.confirmDanger !== false && !go.dataset.sure) {
      go.dataset.sure = '1'; go.innerHTML = `${ic('alert')}Click again: the Recycle Bin can't be recovered`;
      anim(go, [{ transform: 'translateX(0)' }, { transform: 'translateX(-5px)' }, { transform: 'translateX(5px)' }, { transform: 'translateX(0)' }], { d: 320, keep: true });
      setTimeout(() => { if (go.dataset.sure) { delete go.dataset.sure; go.innerHTML = `${ic('broom')}Clean selected`; } }, 4000); return;
    }
    delete go.dataset.sure;
    busy = true; el.classList.add('cl-busy'); go.disabled = true; go.innerHTML = `${ic('broom')}Cleaning…`;
    /* the engine goes through the categories in this order, skipping the apps that are open */
    const queue = ids.filter(id => !DB.clean.find(c => c.id === id).busy);
    const mark = () => {
      $$('.cl-it.busyrun', el).forEach(x => x.classList.remove('busyrun', 'indet'));
      const cur = queue.find(id => !DB.clean.find(c => c.id === id)._done), it = cur && $(`.cl-it[data-id="${cur}"]`, el);
      if (it) { it.classList.add('busyrun', 'indet'); it.scrollIntoView({ block: 'nearest', behavior: isMin() ? 'auto' : 'smooth' }); }
    };
    const run = $('#clRun', el); run.hidden = false; run.classList.remove('done');
    anim(run, [{ opacity: 0, transform: 'translate3d(0,-8px,0)' }, { opacity: 1, transform: 'none' }], { d: 360, e: EASE.spring });
    const bar = $('.cl-bar span', run), T = $('#clRunT', run), F = $('#clRunF', run), R = $('#clRunR', run), K = $('#clRunK', run), C = $('#clRunC', run), E = $('#clRunE', run);
    const cancelBtn = $('#clCancel', run); cancelBtn.disabled = false; cancelBtn.innerHTML = `${ic('stop')}Cancel`;
    run.classList.add('indet'); bar.style.transform = ''; T.textContent = 'Checking which folders running programs are using…';
    F.textContent = R.textContent = K.textContent = C.textContent = E.textContent = '';
    const ctl = {};
    cancelBtn.onclick = () => { if (ctl.cancel) ctl.cancel(); cancelBtn.disabled = true; cancelBtn.textContent = 'Stopping…'; };
    ids.forEach(id => { delete DB.clean.find(c => c.id === id)._done; });
    mark();
    const status = d => {
      if (!d.total) return;
      run.classList.remove('indet');
      const pct = Math.min(1, (d.deleted + (d.skipped || 0)) / d.total);
      bar.style.transform = `scaleX(${pct.toFixed(4)})`;
      T.textContent = `Deleted ${SH.fmtInt(d.deleted)} of ${SH.fmtInt(d.total)} files`;
      F.textContent = `${gb(d.freed || 0)} of ${gb(d.totalBytes || 0)} freed`;
      R.textContent = d.rate ? `${SH.fmtInt(d.rate)} files/s` : '';
      K.textContent = d.skipped ? `${SH.fmtInt(d.skipped)} in use, skipped` : '';
      E.textContent = d.eta != null && pct < 1 ? `about ${dur(d.eta)} left` : '';
      if (d.current) C.textContent = `Now: ${d.current}`;
      tot.textContent = fmt1(totalSel() / 1e9); tot.dataset.v = totalSel() / 1e9;
    };
    const onCat = c => {
      const it = $(`.cl-it[data-id="${c.id}"]`, el);
      if (it) { $('.cl-size', it).textContent = c.size ? gb(c.size) : 'Clean'; if (!c.size) it.classList.add('clean'); if (c.rows) redrawTemp(c);
        anim($('.cl-size', it), [{ transform: 'scale(.7)', opacity: 0 }, { transform: 'scale(1)', opacity: 1 }], { d: 360, e: EASE.spring }); }
      mark();
    };
    let r = null;
    try { r = await API.clean(ids, onCat, status, ctl); }
    catch (e) { SH.toast(`Cleanup: ${e.message}`); }
    busy = false; el.classList.remove('cl-busy'); $$('.cl-it.busyrun', el).forEach(x => x.classList.remove('busyrun', 'indet'));
    go.innerHTML = `${ic('broom')}Clean selected`; sync(); refresh('overview');
    run.classList.remove('indet'); run.classList.add('done'); cancelBtn.disabled = false; cancelBtn.innerHTML = `${ic('x')}Close`; cancelBtn.onclick = () => { run.hidden = true; };
    if (!r) { T.textContent = 'Cleanup stopped'; return; }
    const freed = r.freed || 0;
    const open = (r.busyCats || []).map(id => (DB.clean.find(c => c.id === id) || {}).label).filter(Boolean);
    T.textContent = r.cancelled ? `Stopped. ${gb(freed)} freed before cancelling` : `Done. ${gb(freed)} freed`;
    F.textContent = `${SH.fmtInt(r.deleted || 0)} files deleted`; R.textContent = ''; E.textContent = '';
    K.textContent = r.skipped ? `${SH.fmtInt(r.skipped)} files in use were skipped` : '';
    C.textContent = open.length ? `Skipped because they're open: ${open.join(', ')}` : '';
    if (!r.cancelled) bar.style.transform = 'scaleX(1)';
    SH.toast(r.cancelled ? `Stopped. Freed ${gb(freed)}.` : `Freed ${gb(freed)}.`);
    if (REAL) SH.logActivity(r.cancelled ? 'Cleanup stopped' : 'Cleanup done', { sub: `${gb(freed)} freed`, ic: 'broom', go: 'optimizer', tab: 'clean' });
  });
  rendered.clean = sync;
}

/* ================= Startup ================= */
const ORIGIN = { registry: 'Registry', folder: 'Startup folder', store: 'Store app', task: 'Scheduled task', service: 'Service' };
const IMP_N = { high: 'High', medium: 'Medium', low: 'Low', none: 'None', unmeasured: 'Not measured' };
const IMP_O = { high: 0, medium: 1, low: 2, none: 3, unmeasured: 4 };
const bootAdded = () => DB.startup.filter(s => !s.orig && s.on).reduce((a, s) => a + (IMPACT_S[s.impact] || .8) * (s.count || 1), 0);
function renderStartup(el) {
  el.classList.add('fill');
  const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Today'];
  let filter = 'all', q = '';
  const open = new Set();
  el.innerHTML = `<div class="st">
    <div class="st-top">
      <div class="pan st-sum" data-asm><h4>Start with Windows <em>same as in Task Manager</em></h4>
        <div class="st-nums"><div><b class="big" id="stOn">0</b><span class="muted">enabled</span></div><div><b class="big st-off" id="stOff">0</b><span class="muted">disabled</span></div><div><b class="big" id="stBios">${DB.bios == null ? '—' : 0}</b><span class="muted">s of BIOS</span></div></div>
        <div class="st-heavy" id="stHeavy"></div>
        <p class="faint st-note">${REAL && !DB.measured ? 'Windows measures the impact on every boot, but only lets you read it in administrator mode: that\'s why it says “not measured”.' : 'Windows measures the impact on every boot. Disabled items show “none” because they never start.'}</p></div>
      <div class="pan st-chart" data-asm><h4>Until the desktop appears <em>${DB.boots.length ? `last ${DB.boots.length} boots` : 'no data'}</em></h4>
        ${DB.boots.length ? `<div class="st-cw"><div class="st-hd"><div><span class="muted">Average</span><div><b class="big" id="stNow">0</b><small class="muted"> s</small></div></div>
          <div><span class="muted">With your changes</span><div><b class="big st-new" id="stNew">0</b><small class="muted"> s</small></div></div><span class="st-hint" id="stHint"></span></div>
        <div class="st-bars">${DB.boots.map((b, i) => `<div class="sb"><span style="--h:${bh(b)};--i:${i}"></span><em>${REAL ? '' : DAYS[i]}</em><i>${fmt1(b)}</i></div>`).join('')}<div class="sb est"><span id="stEst" style="--i:7"></span><em>after</em><i id="stEstV"></i></div></div></div>`
        : `<div class="st-nob">${ic('shield')}<div><b>Windows records how long each boot takes</b><span>But it only lets you read it in administrator mode. Turn it on to see your latest boots and the estimate with your changes here.</span></div>${state.admin ? '' : '<button class="btn sec sm" id="stAdm">Turn on</button>'}</div>`}</div>
    </div>
    <div class="pan st-tbl" data-asm>
      <div class="st-th"><h4>Startup programs <em id="stCount"></em></h4>
        <label class="field st-q">${ic('search')}<input id="stQ" placeholder="Search by name or publisher" autocomplete="off" spellcheck="false"></label>
        <div class="seg" id="stF"><span class="ind"></span><button data-v="all" class="on">All</button><button data-v="on">Enabled</button><button data-v="off">Disabled</button></div>
        <button class="btn ghost sm" id="stTm">${ic('external')}Open in Task Manager</button></div>
      <div class="st-cols"><span>Name</span><span>Publisher</span><span>Status</span><span>Impact</span><span>Source</span><span></span></div>
      <div class="st-rows" id="stList"></div></div></div>`;
  const list = $('#stList', el);
  const rowHTML = s => `<div class="st-it${s.on ? '' : ' off'}${open.has(s.id) ? ' open' : ''}" data-id="${s.id}">
      <div class="st-r"><span class="st-n"><span class="st-av">${esc(s.name.replace(/[^\p{L}\p{N}]/u, '')[0] || '?')}</span><span class="st-nt"><b>${esc(s.name)}${s.count ? ` <em>(${s.count})</em>` : ''}</b>${s.review && s.on ? '<span class="chip warn">check what it is</span>' : ''}</span></span>
        <span class="st-pub">${s.pub ? esc(s.pub) : '<span class="faint">no publisher</span>'}</span>
        <span><span class="chip${s.on ? ' ok' : ''}">${s.on ? 'Enabled' : 'Disabled'}</span></span>
        <span class="st-imp i-${s.impact.replace(' ', '-')}"><i></i>${IMP_N[s.impact]}</span>
        <span class="st-or">${ORIGIN[s.origin]}</span>
        <button class="toggle${s.on ? ' on' : ''}" aria-label="${esc(s.name)}"><i></i></button></div>
      <div class="st-det"><div><div class="st-det-in">${s.note ? `<p>${esc(s.note)}</p>` : ''}
        <div class="st-path">${ic(s.origin === 'store' ? 'store' : s.origin === 'folder' ? 'folder' : 'reg')}<span>${esc(s.path)}</span></div>
        ${s.target ? `<div class="st-path">${ic('file')}<span>${esc(s.target)}</span></div>` : ''}
        ${(s.children || []).map(c => `<div class="st-path sub">${ic('file')}<span>${esc(c)}</span></div>`).join('')}
        <button class="btn ghost sm st-loc">${ic('folder')}Open location</button></div></div></div></div>`;
  const items = () => DB.startup.filter(s => (filter === 'all' || (filter === 'on' ? s.on : !s.on)) && (!q || (s.name + ' ' + s.pub).toLowerCase().includes(q)))
    .sort((a, b) => (b.on - a.on) || (IMP_O[a.impact] - IMP_O[b.impact]) || a.name.localeCompare(b.name, 'en'));
  const draw = anims => {
    const it = items();
    list.innerHTML = it.length ? it.map(rowHTML).join('') : `<div class="empty"><b>Nothing matches “${esc(q)}”</b>Try another name.</div>`;
    $('#stCount', el).textContent = `${it.length} of ${DB.startup.length}`;
    if (anims) $$('.st-it', list).forEach((r, i) => anim(r, [{ opacity: 0, transform: 'translate3d(0,8px,0)' }, { opacity: 1, transform: 'none' }], { d: 360, delay: Math.min(i, 14) * 24, e: EASE.spring }));
  };
  const upd = () => {
    const n = bootAvg(), after = n - bootSaved() + bootAdded();
    const on = DB.startup.filter(s => s.on).length;
    SH.countUp($('#stOn', el), on, 500); SH.countUp($('#stOff', el), DB.startup.length - on, 500); if (DB.bios != null) SH.countUp($('#stBios', el), DB.bios, 500, 1);
    if (DB.boots.length) { SH.countUp($('#stNow', el), n, 600, 1); SH.countUp($('#stNew', el), after, 600, 1);
      $('#stEst', el).style.setProperty('--h', bh(after)); $('#stEstV', el).textContent = fmt1(after); }
    const heavy = DB.startup.filter(s => s.on).sort((a, b) => IMP_O[a.impact] - IMP_O[b.impact])[0];
    $('#stHeavy', el).innerHTML = heavy ? `<span class="faint">Heaviest</span><b>${esc(heavy.name)}${heavy.count ? ` (${heavy.count})` : ''}</b><span class="st-imp i-${heavy.impact}"><i></i>${IMP_N[heavy.impact].toLowerCase()} impact</span>` : '';
    const rv = reviewStartup(); if ($('#stHint', el)) $('#stHint', el).textContent =rv.length ? `${rv[0].name} (${rv[0].count || 1}) is the heaviest at startup.` : bootSaved() > .1 ? `About ${fmt1(bootSaved())} s less than before.` : 'Nothing is weighing it down much.';
  };
  draw(true); upd();
  list.addEventListener('click', e => {
    const row = e.target.closest('.st-it'); if (!row) return; const s = DB.startup.find(x => x.id === row.dataset.id);
    if (e.target.closest('.st-loc')) { if (REAL) eng('open_location', s.target).then(ok => { if (!ok) SH.toast('That location no longer exists.'); }).catch(() => {}); else SH.toast('Opening the location works inside the app.'); return; }
    const t = e.target.closest('.toggle');
    if (!t) { if (e.target.closest('.st-r')) { row.classList.toggle('open'); open.has(s.id) ? open.delete(s.id) : open.add(s.id); } return; }
    if ((s.origin === 'service' || s.hklm || s.path.startsWith('HKLM')) && !state.admin && !SH.requireAdmin('to change what starts for all users.')) return;
    if (s.locked) { SH.toast("A Windows policy controls this app; it can't be changed from here."); return; }
    const flip = async want => {
      if (REAL) { try { await eng('startup_set', s.ids || [s.id], want); } catch (err) { SH.toast(`${s.name}: ${err.message}`); return false; } }
      s.on = want; draw(false); upd(); refresh('overview'); return true;
    };
    flip(!s.on).then(ok => {
      if (!ok) return;
      if (REAL) SH.logActivity(s.on ? `${s.name} starts with Windows` : `${s.name} no longer starts with Windows`, { ic: 'bolt', go: 'optimizer', tab: 'startup' });
      SH.toast(s.on ? `${s.name} starts with Windows again.` : `${s.name} no longer starts with Windows.`, { action: { label: 'Undo', run: () => flip(!s.on) } });
    });
  });
  const adm = $('#stAdm', el); if (adm) adm.addEventListener('click', () => SH.requireAdmin('to read the boot times Windows records.'));
  $('#stQ', el).addEventListener('input', e => { q = e.target.value.trim().toLowerCase(); draw(false); });
  $('#stF', el).addEventListener('click', e => { const b = e.target.closest('button'); if (!b || b.classList.contains('on')) return; $$('#stF button', el).forEach(x => x.classList.toggle('on', x === b)); SH.placeSeg($('#stF', el)); filter = b.dataset.v; draw(true); });
  $('#stTm', el).addEventListener('click', () => { if (REAL) eng('open_startup_page').catch(() => {}); else SH.toast('Open Task Manager from inside the app.'); });
  requestAnimationFrame(() => SH.placeSeg($('#stF', el), true));
  rendered.startup = () => { draw(false); upd(); };
}

/* ================= Services ================= */
const START_N = { auto: 'Automatic', manual: 'Manual', disabled: 'Disabled' };
function renderServices(el) {
  el.classList.add('fill');
  const PROF = { none: ['No changes', 'Everything as Windows left it.'], bal: ['Balanced', "Turns off what you surely don't use: fax, retail demo, telemetry, offline maps and remote registry. Printing only if you have no printers."], max: ['Maximum', 'Also sets indexing, app preloading, Xbox and location to manual. Read the warnings: each one has a cost.'] };
  let prof = 'none', filter = 'all'; const want = {};
  el.innerHTML = `<div class="sv">
    <div class="pan sv-l" data-asm><h4>Profile</h4>
      <div class="sv-profs">${Object.entries(PROF).map(([k, [n, d]]) => `<button class="sv-pr${k === prof ? ' on' : ''}" data-v="${k}"><span class="sv-dot"></span><span><b>${n}</b><span>${d}</span></span></button>`).join('')}</div>
      <div class="sv-sum"><div><span class="faint">Running now</span><b id="svRun">0</b></div><div><span class="faint">Pending changes</span><b id="svPend">0</b></div></div>
      <div class="sv-acts"><button class="btn pri" id="svApply" disabled>Apply changes</button><button class="btn ghost" id="svReset" title="Go back to the Windows defaults">${ic('undo')}Windows defaults</button></div></div>
    <div class="pan sv-r" data-asm>
      <div class="sv-th"><h4>Services <em>${DB.services.length} that can be adjusted safely</em></h4>
        <div class="seg" id="svF"><span class="ind"></span><button data-v="all" class="on">All</button><button data-v="run">Running</button><button data-v="chg">Changed</button></div></div>
      <div class="sv-cols"><span>Service</span><span>Now</span><span>Startup</span><span></span></div>
      <div class="sv-list" id="svList"></div></div></div>`;
  const list = $('#svList', el);
  const draw = anims => {
    const rows = DB.services.filter(s => filter === 'all' || (filter === 'run' ? s.run : (want[s.id] && want[s.id] !== s.cur)));
    list.innerHTML = rows.length ? rows.map(s => { const target = want[s.id] || s.cur; const changed = target !== s.cur;
      return `<div class="sv-it${changed ? ' chg' : ''}" data-id="${s.id}"><span class="ri">${ic('service')}</span>
      <span class="rt"><b>${esc(s.name)} <em class="faint">${esc(s.id)}</em></b><span>${esc(s.desc)}${s.warn ? ` <em class="warn-t">${esc(s.warn)}</em>` : ''}</span></span>
      <span><span class="chip${s.run ? ' ok' : ''}">${s.run ? 'Running' : 'Stopped'}</span></span>
      <span class="sv-st">${changed ? `<s>${START_N[s.cur]}</s>` : ''}<span>${START_N[target]}</span></span>
      <button class="toggle${target !== 'disabled' ? ' on' : ''}" aria-label="${esc(s.name)}"><i></i></button></div>`; }).join('') : '<div class="empty"><b>No services with changes</b>Pick a profile or use the switches.</div>';
    if (anims) $$('.sv-it', list).forEach((r, i) => anim(r, [{ opacity: 0, transform: 'translate3d(0,8px,0)' }, { opacity: 1, transform: 'none' }], { d: 360, delay: i * 26, e: EASE.spring }));
    const n = Object.keys(want).length; const ap = $('#svApply', el); ap.disabled = !n; ap.textContent = n ? `Apply ${n} ${n === 1 ? 'change' : 'changes'}` : 'Apply changes';
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
    if (!state.admin && !SH.requireAdmin('to change how Windows services start.')) return;
    const ids = Object.keys(want); const ap = $('#svApply', el); ap.disabled = true; ap.textContent = 'Applying…';
    if (REAL) {
      let r; try { r = await eng('services_apply', { ...want }); } catch (e) { SH.toast(e.message); draw(false); return; }
      Object.keys(want).forEach(k => delete want[k]); const bid = r.backup; await load('services', true); draw(false); refresh('overview');
      SH.logActivity(`${ids.length} services adjusted`, { ic: 'service', go: 'optimizer', tab: 'services' });
      SH.toast(r.ok ? `${ids.length} services changed.` : "A service didn't accept the change.", { action: { label: 'Undo', run: async () => { try { await eng('services_undo', bid); await load('services', true); draw(false); refresh('overview'); SH.toast('Services restored.'); } catch (e) { SH.toast(e.message); } } }, ms: 8000 });
      return;
    }
    for (const id of ids) { const s = DB.services.find(x => x.id === id); await wait(220); s.cur = want[id]; if (s.cur === 'disabled') s.run = false; delete want[id]; draw(false); }
    refresh('overview'); SH.toast(`${ids.length} services changed.`, { action: { label: 'Undo', run: () => { DB.services.forEach(s => s.cur = s.orig); draw(false); refresh('overview'); } } });
  });
  $('#svReset', el).addEventListener('click', async () => {
    Object.keys(want).forEach(k => delete want[k]); $$('.sv-pr', el).forEach(x => x.classList.toggle('on', x.dataset.v === 'none')); prof = 'none';
    const changed = DB.services.filter(s => s.cur !== s.orig);
    if (REAL && changed.length) {
      if (!state.admin && !SH.requireAdmin('to change how Windows services start.')) { draw(false); return; }
      const ch = {}; changed.forEach(s => ch[s.id] = s.orig);
      try { await eng('services_apply', ch); await load('services', true); } catch (e) { SH.toast(e.message); }
    } else DB.services.forEach(s => s.cur = s.orig);
    draw(false); refresh('overview'); SH.toast(changed.length ? 'Services are back to how they were when StellarHub opened.' : 'There were no changes to undo.');
  });
  requestAnimationFrame(() => SH.placeSeg($('#svF', el), true));
  rendered.services = () => draw(false);
}

/* ================= Registry ================= */
function renderRegistry(el) {
  const kid = i => i[2] || i[0];
  let sel = new Set(DB.registry.flatMap(g => g.items.map(kid)));
  const draw = () => {
    if (regDone || (REAL && !regCount())) {
      el.innerHTML = `<div class="empty rg-ok">${ic('check')}<b>No broken entries</b>${last.regBackup ? `The backup of what was fixed is in ProgramData\\StellarHub\\optimizer\\registry\\${esc(last.regBackup)}.<div style="margin-top:14px"><button class="btn sec" id="rgUndo">${ic('undo')}Restore the backup</button></div>` : REAL ? 'Nothing points to files that no longer exist.' : ''}</div>`;
      const u = $('#rgUndo', el); if (u) u.addEventListener('click', async () => {
        if (REAL) { try { await eng('registry_undo', last.regBackup); last.regBackup = null; await load('registry', true); sel = new Set(DB.registry.flatMap(g => g.items.map(kid))); } catch (e) { SH.toast(e.message); return; } }
        regDone = false; draw(); refresh('overview'); SH.toast('Registry restored from the backup.'); });
      return; }
    el.innerHTML = `<div class="rg">
      <div class="pan rg-note">${ic('info')}<div><b>What gets fixed here</b><span>Cleaning the registry barely speeds up Windows. Only genuinely broken entries are touched here, the ones pointing to files that no longer exist. A .reg backup is saved first so you can undo.</span></div>
        <div class="rg-n"><b id="rgN">${sel.size}</b><span class="muted">selected</span></div><button class="btn pri" id="rgGo">${ic('wrench')}Fix selected</button></div>
      <div class="rg-groups">${DB.registry.map(g => `<div class="pan rg-g"><h4>${esc(g.g)} <em>${g.items.length}</em></h4>${g.items.map(i => `<div class="row rg-it" data-k="${esc(kid(i))}"><button class="check${sel.has(kid(i)) ? ' on' : ''}" aria-label="Select">${ic('check')}</button><span class="rt"><b>${esc(i[0])}</b><span>${esc(i[1])}</span></span></div>`).join('')}</div>`).join('')}</div></div>`;
    $$('.rg .pan', el).forEach((p, i) => anim(p, [{ opacity: 0, transform: 'translate3d(0,12px,0)' }, { opacity: 1, transform: 'none' }], { d: 420, delay: i * 45, e: EASE.spring }));
    $('.rg', el).addEventListener('click', e => { const r = e.target.closest('.rg-it'); if (!r) return; const k = r.dataset.k; sel.has(k) ? sel.delete(k) : sel.add(k); $('.check', r).classList.toggle('on', sel.has(k)); $('#rgN', el).textContent = sel.size; $('#rgGo', el).disabled = !sel.size; });
    $('#rgGo', el).addEventListener('click', async () => {
      const needA = REAL ? DB.registry.some(g => g.items.some(i => sel.has(kid(i)) && /^HKLM/i.test(i[0]))) : true;
      if (needA && !state.admin && !SH.requireAdmin('to fix system registry entries.')) return;
      const b = $('#rgGo', el); b.disabled = true; b.textContent = 'Saving the backup…';
      if (REAL) {
        const ids = [...sel]; let r;
        try { r = await engJob('registry_fix', [ids], { onProgress: m => { if (m.pct > .02) b.textContent = `Fixing… ${Math.round(m.pct * 100)}%`; } }); }
        catch (e) { SH.toast(e.message); b.disabled = false; b.innerHTML = `${ic('wrench')}Fix selected`; return; }
        last.regBackup = r.backup;
        for (const row of $$('.rg-it', el).filter(x => sel.has(x.dataset.k))) { anim(row, [{ opacity: 1, transform: 'none' }, { opacity: .25, transform: 'translate3d(18px,0,0)' }], { d: 260 }); }
        await load('registry', true); sel = new Set(DB.registry.flatMap(g => g.items.map(kid))); regDone = !regCount(); refresh('overview'); draw();
        SH.logActivity(`${r.fixed} registry entries fixed`, { sub: 'with a .reg backup', ic: 'reg', go: 'optimizer', tab: 'registry' });
        SH.toast(r.failed.length ? `${r.fixed} fixed; ${r.failed.length} couldn't be fixed.` : `${r.fixed} entries fixed.`, { action: { label: 'Undo', run: async () => { try { await eng('registry_undo', r.backup); last.regBackup = null; await load('registry', true); sel = new Set(DB.registry.flatMap(g => g.items.map(kid))); regDone = false; draw(); refresh('overview'); } catch (e) { SH.toast(e.message); } } }, ms: 8000 });
        return;
      }
      await wait(700); b.textContent = 'Fixing…';
      for (const r of $$('.rg-it', el).filter(r => sel.has(r.dataset.k))) { anim(r, [{ opacity: 1, transform: 'none' }, { opacity: .25, transform: 'translate3d(18px,0,0)' }], { d: 260 }); await wait(60); }
      await wait(300); const n = sel.size; regDone = true; refresh('overview'); draw();
      SH.toast(`${n} entries fixed.`, { action: { label: 'Undo', run: () => { regDone = false; draw(); refresh('overview'); } } });
    });
  };
  draw(); rendered.registry = draw;
}

/* ================= Repair ================= */
const REPAIRS = [
  { id: 'sfc', ic: 'shield', t: 'Check Windows files', cmd: 'sfc /scannow', d: 'Looks for damaged system files and replaces them with good copies.', when: "Odd errors, Windows apps that won't open, blue screens after an update.", dur: '5 to 15 min', admin: true,
    log: [['Beginning system scan. This process will take some time.', 0], ['Beginning verification phase of system scan.', .05], ['Verification 18% complete.', .18], ['Verification 41% complete.', .41], ['Verification 67% complete.', .67], ['Verification 92% complete.', .92], ['Verification 100% complete.', 1], ['Windows Resource Protection did not find any integrity violations.', 1, 'ok']] },
  { id: 'dism', ic: 'package', t: 'Repair the Windows image', cmd: 'DISM /Online /Cleanup-Image /RestoreHealth', d: 'Repairs the copy of Windows that SFC takes good files from. Uses Windows Update.', when: "When SFC says it found damaged files and couldn't fix them.", dur: '10 to 20 min', admin: true,
    log: [['Deployment Image Servicing and Management tool', 0], ['Image Version: 10.0.26200.7171', .02], ['[=====                      10.0%                          ]', .1], ['[==============             38.4%                          ]', .38], ['[==========================62.3%                          ]', .62], ['[==========================84.9%==========               ]', .85], ['[==========================100.0%==========================]', 1], ['The restore operation completed successfully.', 1, 'ok']] },
  { id: 'chkdsk', ic: 'ssd', t: 'Check the disk', cmd: 'chkdsk C: /scan', d: 'Looks for file system errors without unmounting the disk.', when: "Files that won't open, folders that disappear or disk warnings.", dur: '1 to 3 min', admin: true,
    log: [['The type of the file system is NTFS.', 0], ['Stage 1: Examining basic file system structure…', .2], ['  1203456 file records processed.', .45], ['Stage 2: Examining file name linkage…', .6], ['Stage 3: Examining security descriptors…', .85], ['Windows has scanned the file system and found no problems.', 1, 'ok']] },
  { id: 'wu', ic: 'windows', t: 'Repair Windows Update', cmd: 'net stop wuauserv, ren SoftwareDistribution', d: 'Stops the update services, renames their cache and starts them again.', when: 'Updates that fail again and again or get stuck at 0%.', dur: '1 min', admin: true,
    log: [['Stopping Windows Update…', .1], ['Stopping the Background Intelligent Transfer Service (BITS)…', .25], ['Renaming SoftwareDistribution to SoftwareDistribution.old…', .5], ['Renaming catroot2…', .65], ['Starting the services…', .85], ['Windows Update is ready to search again.', 1, 'ok']] },
  { id: 'net', ic: 'wifi', t: 'Reset the network', cmd: 'netsh winsock reset, netsh int ip reset, ipconfig /flushdns', d: "Fixes connections that don't load pages or failing DNS.", when: "There's Wi-Fi but pages don't load, or only some sites fail.", dur: '30 s', admin: true, reboot: true,
    log: [['Flushing the DNS cache…', .2], ['Successfully flushed the DNS Resolver Cache.', .3], ['Resetting the Winsock catalog…', .55], ['Successfully reset the Winsock Catalog.', .7], ['Resetting TCP/IP…', .9], ['Done. Restart the PC to finish.', 1, 'warn']] },
  { id: 'icons', ic: 'grid', t: 'Rebuild icons and fonts', cmd: 'ie4uinit -show, delete iconcache_*.db', d: 'For blank or wrong icons and fonts that look odd.', when: 'Blank icons, stale thumbnails or text that looks wrong.', dur: '20 s',
    log: [['Closing File Explorer…', .15], ['Deleting iconcache_*.db (14 files)…', .4], ['Deleting the font cache…', .6], ['Opening File Explorer…', .9], ['Icons rebuilt.', 1, 'ok']] },
  { id: 'explorer', ic: 'folder', t: 'Restart File Explorer', cmd: 'taskkill /f /im explorer.exe && start explorer', d: 'If the taskbar or the Start menu hangs.', when: "The taskbar doesn't respond or the Start menu won't open.", dur: '5 s',
    log: [['Closing explorer.exe…', .4], ['Opening explorer.exe…', .8], ['File Explorer restarted.', 1, 'ok']] },
];
function renderRepair(el) {
  el.classList.add('fill');
  let busy = null, cur = REPAIRS[0].id; const logs = {}, status = {};
  el.innerHTML = `<div class="rp">
    <div class="pan rp-l" data-asm><h4>Tools <em>${REPAIRS.length}</em></h4><div class="rp-list">${REPAIRS.map(r => `<button class="rp-it${r.id === cur ? ' on' : ''}" data-r="${r.id}"><span class="ri">${ic(r.ic)}</span><span class="rt"><b>${esc(r.t)}</b><span>${esc(r.dur)}${r.admin && !state.admin ? ', administrator' : ''}</span></span><span class="rp-dot"></span></button>`).join('')}</div></div>
    <div class="pan rp-r" data-asm id="rpR"></div></div>`;
  const right = $('#rpR', el);
  const paint = (animate) => {
    const r = REPAIRS.find(x => x.id === cur);
    right.innerHTML = `<div class="rp-h"><span class="rp-big">${ic(r.ic)}</span><div class="rt"><b>${esc(r.t)}</b><span>${esc(r.d)}</span></div><button class="btn pri lg rp-go"${busy ? ' disabled' : ''}>${ic(status[r.id] === 'ok' ? 'restore' : 'play')}${busy === r.id ? 'Running…' : status[r.id] === 'ok' ? 'Run again' : 'Run'}</button></div>
      <div class="rp-facts"><div><span class="faint">When to use it</span><b>${esc(r.when)}</b></div><div><span class="faint">Duration</span><b>${esc(r.dur)}</b></div><div><span class="faint">Needs</span><b>${r.admin ? 'Administrator mode' : 'Nothing special'}${r.reboot ? ', a restart' : ''}</b></div></div>
      <div class="bar acc rp-bar"><span style="transform:scaleX(${status[r.id] === 'ok' ? 1 : 0})"></span></div>
      <div class="rp-log"><div class="rp-cmd">${ic('terminal')}<span>${esc(r.cmd)}</span></div>${(logs[r.id] || []).map(([l, , k]) => `<div class="ln${k ? ' ' + k : ''}">${esc(l)}</div>`).join('') || '<div class="ln faint">Click “Run” to start. The output shows up here live.</div>'}</div>`;
    if (animate) $$(':scope > *', right).forEach((c, i) => anim(c, [{ opacity: 0, transform: 'translate3d(14px,0,0)' }, { opacity: 1, transform: 'none' }], { d: 380, delay: i * 40, e: EASE.spring }));
  };
  paint(false);
  $('.rp-list', el).addEventListener('click', e => { const b = e.target.closest('.rp-it'); if (!b || b.dataset.r === cur) return; $$('.rp-it', el).forEach(x => x.classList.toggle('on', x === b)); cur = b.dataset.r; paint(true); });
  right.addEventListener('click', async e => {
    if (!e.target.closest('.rp-go')) return; const r = REPAIRS.find(x => x.id === cur);
    if (busy) { SH.toast('Wait for the current repair to finish.'); return; }
    if (r.admin && !state.admin && !SH.requireAdmin(`to ${r.t.charAt(0).toLowerCase() + r.t.slice(1)}.`)) return;
    busy = r.id; logs[r.id] = []; status[r.id] = 'run'; const it = $(`.rp-it[data-r="${r.id}"]`, el); it.classList.remove('ok', 'err'); it.classList.add('run'); paint(false);
    if (REAL) {
      /* live output: every line comes from the engine; they're painted together once per frame */
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
      if (err) push(err.needAdmin ? 'Needs administrator mode.' : `Error: ${err.message}`, 'err');
      else push(res && res.code ? `Finished with code ${res.code}. Check the output above.` : (r.reboot ? 'Done. Restart the PC to finish.' : 'Done.'), res && res.code ? 'warn' : (r.reboot ? 'warn' : 'ok'));
      busy = null; status[r.id] = err ? 'err' : 'ok'; it.classList.remove('run'); it.classList.add(err ? 'err' : 'ok'); if (cur === r.id) paint(false); else $$('.rp-go', right).forEach(b => b.disabled = false);
      if (!err) { SH.logActivity(`${r.t}: done`, { ic: r.ic, go: 'optimizer', tab: 'repair' }); SH.toast(r.reboot ? `${r.t}: done. Restart to finish.` : `${r.t}: done.`); }
      return;
    }
    for (let i = 0; i < r.log.length; i++) { const [line, p, k] = r.log[i]; await wait(i ? 420 + Math.random() * 600 : 300); logs[r.id].push(r.log[i]);
      if (cur === r.id) { const log = $('.rp-log', right); const ph = $('.ln.faint', log); if (ph) ph.remove(); const d = document.createElement('div'); d.className = 'ln' + (k ? ' ' + k : ''); d.textContent = line; log.appendChild(d); log.scrollTop = log.scrollHeight;
        anim(d, [{ opacity: 0, transform: 'translate3d(0,4px,0)' }, { opacity: 1, transform: 'none' }], { d: 220 }); $('.rp-bar>span', right).style.transform = `scaleX(${p})`; } }
    busy = null; status[r.id] = 'ok'; it.classList.remove('run'); it.classList.add('ok'); if (cur === r.id) paint(false); else $$('.rp-go', right).forEach(b => b.disabled = false);
    SH.toast(r.reboot ? `${r.t}: done. Restart to finish.` : `${r.t}: done.`);
  });
}

/* ================= Performance ================= */
/* Every setting is Windows' own: it's read from where Windows stores it and changed there. No settings of our own. */
function renderPerformance(el) {
  const P = DB.perf;
  const PM = [['efficiency', 'Efficiency'], ['balanced', 'Balanced'], ['best', 'Best performance']];
  const VIS = [['auto', 'Let Windows choose'], ['appearance', 'Best appearance'], ['performance', 'Best performance']];
  const VIS_N = { auto: 'Let Windows choose what’s best', appearance: 'Adjust for best appearance', performance: 'Adjust for best performance' };
  const BG = [['always', 'Always'], ['opt', 'Power optimized'], ['never', 'Never']];
  const seg = (k, opts, v) => `<div class="seg" data-k="${k}"><span class="ind"></span>${opts.map(([o, n]) => `<button data-v="${o}"${v === o ? ' class="on"' : ''}>${n}</button>`).join('')}</div>`;
  const card = (o) => `<div class="pan pf-c" data-asm data-card="${o.id}">
      <div class="pf-h"><span class="ri">${ic(o.ic)}</span><div class="rt"><b>${o.t}</b><span>${o.where}</span></div></div>
      <div class="pf-now"><span class="faint">Now in Windows:</span> <b data-now="${o.id}">${o.now()}</b></div>
      <div class="pf-ctl">${o.ctl}</div>
      <p class="pf-d">${o.d}</p>
      <div class="pf-f">${(o.chips || []).map(c => `<span class="chip">${c}</span>`).join('')}<button class="btn ghost sm" data-open="${o.open}">${ic('external')}${o.openT || 'Open in Windows Settings'}</button></div></div>`;
  const CARDS = [
    { id: 'power', ic: 'bolt', t: 'Power mode', where: 'Settings › System › Power & battery', now: () => `Plugged in: ${POWER[P.ac].toLowerCase()}. On battery: ${POWER[P.dc].toLowerCase()}.`,
      ctl: `<div class="pf-two"><div><span class="faint">Plugged in</span>${seg('ac', PM, P.ac)}</div><div><span class="faint">On battery</span>${seg('dc', PM, P.dc)}</div></div>
        <div class="pf-plans"><span class="faint">Power plans (powercfg /list)</span>${(P.plans && P.plans.length ? P.plans.map(p => [p.name, p.guid, p.on]) : [['Balanced', '381b4222-…-a8a1-26dd2ec7e0f0', true], ['High performance', 'hidden on PCs with Modern Standby', false], ['Ultimate performance', 'hidden on PCs with Modern Standby', false]]).map(([n, g, on]) => `<button class="pf-plan${on ? ' on' : ''}" data-plan="${esc(g)}"><span class="pf-pd"></span><span><b>${esc(n)}</b><small>${esc(g)}</small></span>${on ? '<span class="chip ok">active</span>' : ''}</button>`).join('')}
        ${P.standby !== false ? `<p class="faint pf-pn">Your ${SH.PC.type === 'laptop' ? 'laptop' : 'PC'} uses Modern Standby: Windows only keeps the Balanced plan and the modes above tune it from the inside.</p>` : ''}</div>`,
      d: 'This is the Windows 11 control, not a plan of our own. “Best performance” raises the clock speeds your processor can sustain, at the cost of more heat and noise.', chips: ['no restart'], open: 'ms-settings:powersleep' },
    { id: 'visual', ic: 'eye', t: 'Visual effects', where: 'System Properties › Advanced › Performance', now: () => VIS_N[P.visual],
      ctl: seg('visual', VIS, P.visual), d: '“Best performance” removes Windows shadows, window animations and transparency. It doesn’t affect StellarHub’s animations. On your PC the difference is small.', chips: ['no restart'], open: 'sysperf', openT: 'Open Performance Options' },
    { id: 'game', ic: 'gpu', t: 'Game Mode', where: 'Settings › Gaming › Game Mode', now: () => P.gameMode ? 'On' : 'Off',
      ctl: `<div class="pf-tg"><span>Game Mode</span><button class="toggle${P.gameMode ? ' on' : ''}" data-k="gameMode" aria-label="Game Mode"><i></i></button></div>`,
      d: 'Windows prioritizes the game in front of you and doesn’t install updates or restart while you play. It’s on by default.', chips: ['no restart'], open: 'ms-settings:gaming-gamemode' },
    { id: 'hags', ic: 'cpu', t: 'Hardware-accelerated GPU scheduling', where: 'Settings › System › Display › Graphics', now: () => P.hags === null ? 'Windows decides (not set)' : P.hags ? 'On' : 'Off',
      ctl: `<div class="pf-tg"><span>Hardware scheduling</span><button class="toggle${P.hags ? ' on' : ''}" data-k="hags" aria-label="Hardware scheduling"><i></i></button></div>`,
      d: 'The graphics card manages its own memory instead of Windows doing it. Slightly lower latency in games; needed for DLSS frame generation.', chips: ['needs a restart', 'administrator'], open: 'ms-settings:display-advancedgraphics' },
    { id: 'bg', ic: 'layers', t: 'Background apps', where: 'Settings › Apps › Installed apps › Advanced options', now: () => `${P.bg.filter(a => a.v === 'always').length} always allowed, ${P.bg.filter(a => a.v === 'never').length} not allowed`,
      ctl: `<div class="pf-bg">${P.bg.map(a => `<div class="pf-bgr"><span>${esc(a.n)}</span>${seg('bg:' + a.id, BG, a.v)}</div>`).join('')}</div>`,
      d: 'Windows 11 no longer has a global switch: it’s decided app by app. “Power optimized” lets Windows stop them when it needs to save battery.', chips: ['per app'], open: 'ms-settings:privacy-backgroundapps' },
  ];
  el.innerHTML = `<div class="pf-wrap"><div class="pan pf-note" data-asm>${ic('info')}<div><b>These are Windows’ own settings, not ours</b><span>They’re read from where Windows stores them and changed right there: you can check them with “Open in Settings”. We don’t show a made-up before and after; when you change something, StellarHub will measure the next boot and idle power draw, and you’ll see it here.</span></div><span class="chip">measured when applied</span></div>
    <div class="pf">${CARDS.map(card).join('')}</div></div>`;
  $$('[data-open=""]', el).forEach(b => b.remove());
  const now = () => CARDS.forEach(c => { const n = $(`[data-now="${c.id}"]`, el); if (n && n.textContent !== c.now()) { n.textContent = c.now(); anim(n, [{ opacity: .3, transform: 'translate3d(0,4px,0)' }, { opacity: 1, transform: 'none' }], { d: 300 }); } });
  /* in the app: it's changed in Windows and read back; if Windows doesn't accept it, the control goes back to how it was */
  const realSet = async (k, v, revert) => {
    if (!REAL) return true;
    try { const r = k.startsWith('bg:') ? await eng('bg_set', k.slice(3), v) : await eng('perf_set', k, v); if (r && r.plans) Object.assign(P, r); return true; }
    catch (err) { SH.toast(err.message); revert && revert(); return false; }
  };
  el.addEventListener('click', async e => {
    const o = e.target.closest('[data-open]'); if (o) { const u = o.dataset.open; if (u === 'sysperf') SH.call('run_tool', 'perf').then(r => { if (r === undefined) SH.toast('Open Performance Options from inside the app.'); }); else SH.call('open_url', u).then(r => { if (r === undefined) SH.toast('This opens Windows Settings from inside the app.'); }); return; }
    const pl = e.target.closest('[data-plan]'); if (pl && REAL && !pl.classList.contains('on')) { try { Object.assign(P, await eng('power_plan_set', pl.dataset.plan)); $$('.pf-plan', el).forEach(x => { const on = x.dataset.plan === pl.dataset.plan; x.classList.toggle('on', on); }); SH.toast('Power plan changed.'); } catch (err) { SH.toast(err.message); } return; }
    const sb = e.target.closest('.seg button'); if (sb) { const s = sb.parentElement; if (sb.classList.contains('on')) return; const prevB = $('button.on', s); $$('button', s).forEach(x => x.classList.toggle('on', x === sb)); SH.placeSeg(s);
      const k = s.dataset.k, v = sb.dataset.v;
      const revert = () => { $$('button', s).forEach(x => x.classList.toggle('on', x === prevB)); SH.placeSeg(s); };
      if (!(await realSet(k, v, revert))) return;
      if (k.startsWith('bg:')) { const a = P.bg.find(x => x.id === k.slice(3)); if (a) a.v = v; SH.toast(`${a ? a.n : 'App'}: ${sb.textContent.toLowerCase()} in the background.`); }
      else { P[k] = v; SH.toast(k === 'visual' ? `Visual effects: ${sb.textContent.toLowerCase()}.` : `Power mode ${k === 'ac' ? 'when plugged in' : 'on battery'}: ${sb.textContent.toLowerCase()}.`); }
      if (REAL) SH.logActivity(k === 'visual' ? 'Visual effects changed' : k.startsWith('bg:') ? 'Background permission changed' : 'Power mode changed', { sub: sb.textContent, ic: 'bolt', go: 'optimizer', tab: 'performance' });
      now(); refresh('overview'); return; }
    const t = e.target.closest('.toggle[data-k]'); if (t) {
      const k = t.dataset.k; if (k === 'hags' && !state.admin && !SH.requireAdmin('to change GPU scheduling.')) return;
      const want = !P[k]; t.classList.toggle('on', want);
      if (!(await realSet(k, want, () => t.classList.toggle('on', !want)))) return;
      P[k] = want; now(); if (k === 'hags') SH.toast('It will apply after a restart.'); else SH.toast(`Game Mode ${want ? 'on' : 'off'}.`);
    }
  });
  requestAnimationFrame(() => $$('.seg', el).forEach(s => SH.placeSeg(s, true)));
  rendered.performance = () => { $$('.seg[data-k="ac"] button', el).forEach(b => b.classList.toggle('on', b.dataset.v === P.ac)); SH.placeSeg($('.seg[data-k="ac"]', el), true); now(); };
}

/* ================= module registration ================= */
let modCtx = null;
SH.module({
  id: 'optimizer',
  actions(el, ctx) {
    modCtx = ctx;
    el.innerHTML = `<button class="btn ghost" data-a="rescan">${ic('scan')}Analyze</button><button class="btn pri" data-a="all">${ic('sparkle')}Optimize everything</button>`;
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
      catch (e) { el.innerHTML = `<div class="empty"><b>Couldn't read from Windows</b>${esc(e.message)}<div style="margin-top:14px"><button class="btn sec" id="optRetry">${ic('restore')}Try again</button></div></div>`;
        $('#optRetry', el).addEventListener('click', () => { el.innerHTML = ''; this.renderTab(tab, el, ctx); }); return; }
      el.innerHTML = ''; fn(el, ctx); SH.assemble(el, 0, 30); return;
    }
    fn(el, ctx);
  },
  enter() { if (!modCtx) return; modCtx.setBadge('clean', DB.clean.filter(c => c.size > 0).length); modCtx.setBadge('registry', regCount()); },
  enterTab(tab, el) { if (tab !== 'overview' || !el) return; const r = $('.ring', el); if (r) anim(r, [{ transform: 'rotate(-24deg) scale(.94)', opacity: .5 }, { transform: 'none', opacity: 1 }], { d: 620, e: EASE.spring }); },
});
SH.actions.add([
  { t: 'Optimize everything', go: 'optimizer', tab: 'overview', ic: 'sparkle' },
  { t: 'Empty the Recycle Bin and temporary files', go: 'optimizer', tab: 'clean', ic: 'broom' },
  { t: "Turn off services I don't use", go: 'optimizer', tab: 'services', ic: 'service' },
  { t: 'Fix broken registry entries', go: 'optimizer', tab: 'registry', ic: 'reg' },
  { t: 'Check Windows files (SFC)', go: 'optimizer', tab: 'repair', ic: 'shield' },
  { t: 'Reset the network and DNS', go: 'optimizer', tab: 'repair', ic: 'wifi' },
  { t: 'Change the power plan', go: 'optimizer', tab: 'performance', ic: 'bolt' },
]);
})();
