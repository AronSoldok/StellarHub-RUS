/* StellarHub · Driver Updater. Inside the app everything is real (stellarhub/engine/drivers.py): the
   Win32_PnPSignedDriver inventory, search and install through Windows Update, problems, backups with pnputil,
   history and stored versions. Outside the app (browser, design tests) it uses the sample data below. */
'use strict';
(() => {
const { $, $$, anim, EASE, Spring, tickers, ic, esc, fmt1 } = SH;
const t = SH.t;
const wait = ms => new Promise(r => setTimeout(r, ms));
const TODAY = new Date();
let REAL = false; SH.apiReady.then(a => { REAL = !!a; });
SH.icons.add({
  bt: '<path d="m7 7 10 10-5 4.5V2.5L17 7 7 17"/>',
  usb: '<path d="M12 21V4m0 0-2.5 3M12 4l2.5 3"/><path d="M12 15 7.5 12V9.5M12 17l4.5-3v-2.5"/><circle cx="7.5" cy="8.5" r="1.2"/><rect x="15.5" y="10" width="2" height="2"/><circle cx="12" cy="20" r="1.4"/>',
  chip: '<rect x="5" y="5" width="14" height="14" rx="2"/><path d="M9 9h6v6H9z"/>',
  printer: '<path d="M7 8V3.5h10V8"/><rect x="3.5" y="8" width="17" height="8" rx="2"/><path d="M7 13.5h10V20.5H7z"/>',
  arrowr: '<path d="M5 12h14m-5-5 5 5-5 5"/>',
});
/* real Windows classes (DeviceClass in upper case) -> name and icon */
const CLS = {
  DISPLAY: [t('Display adapters'), 'display'], MEDIA: [t('Sound, video and game controllers'), 'audio'], AUDIOENDPOINT: [t('Audio inputs and outputs'), 'speaker'],
  AUDIOPROCESSINGOBJECT: [t('Audio effects'), 'audio'], NET: [t('Network adapters'), 'wifi'], BLUETOOTH: ['Bluetooth', 'bt'], SYSTEM: [t('System devices'), 'sys'],
  PROCESSOR: [t('Processors'), 'cpu'], USB: [t('USB controllers'), 'usb'], USBDEVICE: [t('USB devices'), 'usb'], HIDCLASS: [t('Human interface devices'), 'mouse'],
  KEYBOARD: [t('Keyboards'), 'keyboard'], MOUSE: [t('Mice and pointing devices'), 'mouse'], DISKDRIVE: [t('Disk drives'), 'ssd'], SCSIADAPTER: [t('Storage controllers'), 'ssd'],
  HDC: [t('IDE/ATA controllers'), 'ssd'], MONITOR: [t('Monitors'), 'display'], CAMERA: [t('Cameras'), 'camera'], IMAGE: [t('Imaging devices'), 'camera'],
  BATTERY: [t('Batteries'), 'battery'], FIRMWARE: [t('Firmware'), 'chip'], SECURITYDEVICES: [t('Security devices'), 'shield'], SOFTWARECOMPONENT: [t('Software components'), 'package'],
  SOFTWAREDEVICE: [t('Software devices'), 'package'], PRINTQUEUE: [t('Print queues'), 'printer'], PRINTER: [t('Printers'), 'printer'], COMPUTER: [t('Computer'), 'sys'],
  VOLUME: [t('Storage volumes'), 'ssd'], VOLUMESNAPSHOT: [t('Volume shadow copies'), 'ssd'], EXTENSION: [t('Driver extensions'), 'package'], MIDIENDPOINT: [t('MIDI devices'), 'audio'],
  SENSOR: [t('Sensors'), 'temp'], BIOMETRIC: [t('Biometric devices'), 'user'], PORTS: [t('Ports'), 'usb'], WPD: [t('Portable devices'), 'ssd'], SMARTCARDREADER: [t('Smart card readers'), 'lock'],
  NETSERVICE: [t('Network services'), 'globe'], NETTRANS: [t('Network protocols'), 'globe'], NETCLIENT: [t('Network clients'), 'globe'], LEGACYDRIVER: [t('Legacy drivers'), 'package'],
  OTHERHARDWARE: [t('Other devices'), 'chip'], OTHER: [t('Other devices'), 'chip'], UCM: [t('USB-C connectors'), 'usb'], DOT4: [t('Printing'), 'printer'],
};
const clsInfo = c => CLS[(c || 'OTHER').toUpperCase()] || [(c || 'Other').charAt(0) + (c || 'other').slice(1).toLowerCase(), 'chip'];
const agoText = ts => { if (!ts) return t('never'); const s = (Date.now() - ts * 1000) / 1000; if (s < 90) return t('just now'); if (s < 3600) return t('{n} min ago', { n: Math.round(s / 60) }); if (s < 86400) return t('{n} h ago', { n: Math.round(s / 3600) }); const d = Math.round(s / 86400); return d === 1 ? t('yesterday') : t('{n} days ago', { n: d }); };

/* our own confirmation dialog (no confirm()) */
function ask(title, body, ok = t('Continue'), danger = false) {
  return new Promise(res => {
    const o = document.createElement('div'); o.className = 'dq-o';
    o.innerHTML = `<div class="dq-s"></div><div class="dq" role="dialog" aria-modal="true"><h3>${esc(title)}</h3><p>${body}</p><div class="dq-a"><button class="btn ghost" data-n>${t('Cancel')}</button><button class="btn ${danger ? 'danger' : 'pri'}" data-y>${esc(ok)}</button></div></div>`;
    $('#v-drivers').appendChild(o);
    anim($('.dq-s', o), [{ opacity: 0 }, { opacity: 1 }], { d: 200 });
    anim($('.dq', o), [{ opacity: 0, transform: 'translate3d(0,12px,0) scale(.96)', filter: 'blur(6px)' }, { opacity: 1, transform: 'none', filter: 'blur(0px)' }], { d: 380, e: EASE.spring });
    const done = v => { anim(o, [{ opacity: 1 }, { opacity: 0 }], { d: 160 }).finished.then(() => o.remove()).catch(() => o.remove()); document.removeEventListener('keydown', key, true); res(v); };
    const key = e => { if (e.key === 'Escape') { e.stopImmediatePropagation(); done(false); } if (e.key === 'Enter') { e.preventDefault(); done(true); } };
    document.addEventListener('keydown', key, true);
    o.addEventListener('click', e => { if (e.target.closest('[data-y]')) done(true); else if (e.target.closest('[data-n]') || e.target.classList.contains('dq-s')) done(false); });
    setTimeout(() => $('[data-y]', o).focus(), 30);
  });
}
/* engine/backups.py reason codes, when the engine sent no text of its own */
const RP_WHY = {
  needs_admin: t('Creating a restore point needs administrator rights.'),
  protection_off: t('System Protection is turned off for the system drive, so Windows cannot create restore points.'),
  service_disabled: t('The Volume Shadow Copy service is disabled, and restore points depend on it.'),
  policy: t('Restore points are turned off by a policy on this PC.'),
  failed: t('Windows did not create a new restore point and gave no reason.'),
};
const needAdmin = (r, why) => { if (r && r.needAdmin) { SH.requireAdmin(why); return true; } return false; };

/* ---------- sample data ---------- */
let seed = 7; const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
const pick = a => a[Math.floor(rnd() * a.length)];
const pad = n => String(n).padStart(2, '0');
const MS = { provider: 'Microsoft', version: '10.0.26100.1', date: '2006-06-21', inbox: true };
const CLASSES = [
  ['Display', t('Display adapters'), 'display', 2], ['Media', t('Sound, video and game controllers'), 'audio', 6], ['AudioEndpoint', t('Audio inputs and outputs'), 'speaker', 10],
  ['Net', t('Network adapters'), 'wifi', 9], ['Bluetooth', 'Bluetooth', 'bt', 12], ['System', t('System devices'), 'sys', 98], ['Processor', t('Processors'), 'cpu', 24],
  ['USB', t('USB controllers'), 'usb', 26], ['HIDClass', t('Human interface devices'), 'mouse', 22], ['Keyboard', t('Keyboards'), 'keyboard', 3], ['Mouse', t('Mice and pointing devices'), 'mouse', 4],
  ['DiskDrive', t('Disk drives'), 'ssd', 2], ['SCSIAdapter', t('Storage controllers'), 'ssd', 3], ['Monitor', t('Monitors'), 'display', 2], ['Camera', t('Cameras'), 'camera', 2],
  ['Battery', t('Batteries'), 'battery', 3], ['Firmware', t('Firmware'), 'chip', 3], ['SecurityDevices', t('Security devices'), 'shield', 1], ['SoftwareComponent', t('Software components'), 'package', 34],
  ['SoftwareDevice', t('Software devices'), 'package', 22], ['PrintQueue', t('Print queues'), 'printer', 6], ['Computer', t('Computer'), 'sys', 1], ['Volume', t('Storage volumes'), 'ssd', 8],
];
const D = (name, o = {}) => ({ name, ...(o.inbox === false || o.provider ? o : { ...MS, ...o }) });
const SPEC = {
  Display: [D('NVIDIA GeForce RTX 5070 Laptop GPU', { provider: 'NVIDIA', version: '32.0.16.1742', date: '2026-10-14', inf: 'oem41.inf', hw: 'PCI\\VEN_10DE&DEV_2F58' }), D('Intel(R) UHD Graphics', { provider: 'Intel Corporation', version: '32.0.101.7088', date: '2026-09-03', inf: 'oem38.inf', hw: 'PCI\\VEN_8086&DEV_A788' })],
  Media: [D('Realtek High Definition Audio', { provider: 'Realtek Semiconductor Corp.', version: '6.0.9733.1', date: '2025-11-20', inf: 'oem12.inf', hw: 'INTELAUDIO\\FUNC_01&VEN_10EC&DEV_0256' }), D('NVIDIA High Definition Audio', { provider: 'NVIDIA', version: '1.4.3.2', date: '2025-06-10' }),
    D('NVIDIA Virtual Audio Device (Wave Extensible) (WDM)', { provider: 'NVIDIA', version: '4.65.0.3', date: '2024-03-02' }), D('Intel(R) Smart Sound Technology for USB Audio', { provider: 'Intel Corporation', version: '10.29.0.10467', date: '2024-08-30' }),
    D('Intel(R) Smart Sound Technology BUS', { provider: 'Intel Corporation', version: '10.29.0.10467', date: '2024-08-30' }), D('USB Audio Device')],
  AudioEndpoint: ['Speakers (Realtek(R) Audio)', 'Microphone (Realtek(R) Audio)', 'Headphones (USB Audio Device)', 'Microphone (USB Audio Device)', '24E4 (NVIDIA High Definition Audio)', 'Speakers (NVIDIA Broadcast)', 'Microphone (NVIDIA Broadcast)', 'Stereo Mix (Realtek(R) Audio)', 'Speakers (Steam Streaming Speakers)', 'Microphone (Steam Streaming Microphone)'].map(n => D(n, { inf: 'audioendpoint.inf' })),
  Net: [D('Realtek 8852CE WiFi 6E PCI-E NIC', { provider: 'Realtek Semiconductor Corp.', version: '6001.16.159.0', date: '2025-09-12', inf: 'oem22.inf', hw: 'PCI\\VEN_10EC&DEV_C852' }), D('Realtek Gaming 2.5GbE Family Controller', { provider: 'Realtek', version: '10.68.815.2024', date: '2024-08-15' }),
    ...['IP', 'IPv6', 'L2TP', 'PPTP', 'SSTP', 'IKEv2', 'Network Monitor'].map(x => D(`WAN Miniport (${x})`, { inf: 'netrasa.inf' }))],
  Bluetooth: [D('Realtek Bluetooth 5.3 Adapter', { provider: 'Realtek Semiconductor Corp.', version: '1.10.1061.3005', date: '2025-03-04', inf: 'oem30.inf', hw: 'USB\\VID_0BDA&PID_5852' }), D('Microsoft Bluetooth Enumerator'), D('Microsoft Bluetooth LE Enumerator'), D('Bluetooth Device (RFCOMM Protocol TDI)'), D('Bluetooth Device (Personal Area Network)'),
    D('Galaxy Buds2 Pro'), D('Galaxy Buds2 Pro Avrcp Transport'), D('Galaxy Buds2 Pro Hands-Free'), D('Xbox Wireless Controller'), D('Audio/Video Remote Control Service'), D('AVRCP Transport Service'), D('Bluetooth LE Input Device')],
  System: [D('Intel(R) Management Engine Interface #1', { provider: 'Intel', version: '2406.5.5.0', date: '2024-04-11', inf: 'oem15.inf', hw: 'PCI\\VEN_8086&DEV_7A68' }), D('ASUS System Control Interface v3', { provider: 'ASUSTeK Computer Inc.', version: '3.1.38.0', date: '2025-02-17', inf: 'oem9.inf', hw: 'ACPI\\ATK4002' }),
    D('Intel(R) Serial IO I2C Host Controller - 7A4C', { provider: 'Intel Corporation', version: '30.100.2405.44', date: '2024-02-05' }), D('Intel(R) Serial IO I2C Host Controller - 7A4D', { provider: 'Intel Corporation', version: '30.100.2405.44', date: '2024-02-05' }),
    D('Intel(R) Serial IO GPIO Host Controller - INTC1056', { provider: 'Intel Corporation', version: '30.100.2405.44', date: '2024-02-05' }), D('Intel(R) Dynamic Tuning Technology', { provider: 'Intel', version: '9.0.11903.47811', date: '2024-05-22' }),
    D('Intel(R) GNA Scoring Accelerator module', { provider: 'Intel Corporation', version: '3.5.0.1578', date: '2023-09-14' }), D('Intel(R) Platform Monitoring Technology (PMT) Driver', { provider: 'Intel Corporation', version: '1.0.0.12', date: '2023-06-01' }),
    D('Intel(R) SMBus - 7A23', { provider: 'INTEL', version: '10.1.19.7', date: '2023-01-12' }), D('Intel(R) SPI (flash) Controller - 7A24', { provider: 'INTEL', version: '10.1.19.7', date: '2023-01-12' }),
    D('NVIDIA Platform Controllers and Framework', { provider: 'NVIDIA', version: '32.0.15.6070', date: '2025-08-01' }),
    ...['ACPI Power Button', 'ACPI Lid', 'ACPI Sleep Button', 'ACPI Thermal Zone', 'Programmable interrupt controller', 'High precision event timer', 'System CMOS/real time clock', 'Composite Bus Enumerator', 'Virtual Display Adapter Enumerator', 'Volume Manager', 'UEFI firmware interface', 'PCI standard RAM Controller', 'PCI standard ISA bridge', 'Microsoft Software Device Enumerator', 'Hyper-V controller'].map(n => D(n))],
  Processor: Array.from({ length: 24 }, () => D('Intel(R) Core(TM) i7-14650HX', { inf: 'cpu.inf' })),
  USB: [D('Intel(R) USB 3.20 eXtensible Host Controller - 1.20 (Microsoft)', { inf: 'usbxhci.inf' }), D('USB Root Hub (USB 3.0)', { inf: 'usbhub3.inf' }), D('Intel(R) USB4 Host Router', { provider: 'Intel', version: '1.60.4.1', date: '2024-07-02' }), D('Realtek USB 2.0 Card Reader', { provider: 'Realtek Semiconductor Corp.', version: '10.0.26100.21337', date: '2024-11-05' })],
  HIDClass: [D('Intel(R) HID Event Filter', { provider: 'Intel Corporation', version: '2.2.2.1', date: '2024-01-10' }), D('ASUS Precision Touchpad', { provider: 'ASUSTeK', version: '16.0.0.32', date: '2024-03-28' }), D('I2C HID Device'), D('HID-compliant touch pad'), D('ASUS HID Keyboard')],
  Keyboard: [D('HID Keyboard Device'), D('HID Keyboard Device'), D('Standard PS/2 Keyboard')],
  Mouse: [D('HID-compliant mouse'), D('HID-compliant mouse'), D('HID-compliant mouse'), D('ASUS Precision Touchpad', { provider: 'ASUSTeK', version: '16.0.0.32', date: '2024-03-28' })],
  DiskDrive: [D('WD PC SN5000S SDEQNSJ-1T00-1002', { inf: 'disk.inf' }), D('Generic- SD/MMC/MS PRO USB Device', { inf: 'disk.inf' })],
  SCSIAdapter: [D('Standard NVM Express Controller', { inf: 'stornvme.inf' }), D('Intel(R) RST VMD Controller 9A0B', { provider: 'Intel Corporation', version: '19.5.2.1049', date: '2023-11-03' }), D('Microsoft Storage Spaces Controller')],
  Monitor: [D('Generic PnP Monitor (MNG007DA5)', { inf: 'monitor.inf' }), D('24E4 (external monitor)', { inf: 'monitor.inf' })],
  Camera: [D('USB2.0 HD UVC WebCam', { provider: 'Azurewave', version: '3.4.8.1', date: '2023-07-19' }), D('USB2.0 HD IR UVC WebCam', { provider: 'Azurewave', version: '3.4.8.1', date: '2023-07-19' })],
  Battery: [D('Microsoft ACPI-Compliant Control Method Battery'), D('Microsoft AC Adapter'), D('ASUS Battery Device', { provider: 'ASUSTeK', version: '1.0.0.6', date: '2024-02-20' })],
  Firmware: [D('System Firmware', { provider: 'ASUSTeK Computer Inc.', version: '312.0.0.0', date: '2026-05-07' }), D('Intel(R) Management Engine Firmware', { provider: 'Intel', version: '18.0.5.2141', date: '2024-03-01' }), D('Realtek Device Firmware', { provider: 'Realtek', version: '1.0.0.27', date: '2024-06-18' })],
  SecurityDevices: [D('Trusted Platform Module 2.0', { inf: 'tpm.inf' })],
  SoftwareComponent: ['Intel(R) Graphics Command Center', 'Intel(R) iCLS Client', 'Intel(R) Dynamic Application Loader Host Interface', 'Realtek Audio Effects Component', 'Realtek Audio Universal Service', 'Realtek Hardware Support Application', 'Realtek Asio Component', 'NVIDIA WMI', 'NVIDIA Broadcast Component', 'ASUS Armoury Crate Control Interface', 'ASUS Software Component', 'ASUS Optimization Interface', 'Intel(R) Innovation Platform Framework', 'Intel(R) Connectivity Network Service'].map(n => D(n, { provider: pick(['Intel Corporation', 'Realtek', 'NVIDIA', 'ASUSTeK']), version: `${1 + Math.floor(rnd() * 30)}.${Math.floor(rnd() * 10)}.${Math.floor(rnd() * 900)}.${Math.floor(rnd() * 9000)}`, date: `202${3 + Math.floor(rnd() * 3)}-${pad(1 + Math.floor(rnd() * 12))}-${pad(1 + Math.floor(rnd() * 27))}` })),
  SoftwareDevice: ['Microsoft Radio Device Enumeration Bus', 'Microsoft Device Association Root Enumerator', 'Microsoft GS Wavetable Synth', 'Windows Hello Software Device'].map(n => D(n)),
  PrintQueue: ['Microsoft Print to PDF', 'OneNote (Desktop)', 'Fax', 'Microsoft XPS Document Writer', 'HP DeskJet 2700 series', 'Root Print Queue'].map(n => D(n, { inf: 'printqueue.inf' })),
  Computer: [D('ACPI x64-based PC', { inf: 'hal.inf' })],
  Volume: [],
};
const GEN = {
  System: i => i % 3 ? D(`PCI Express Root Port #${i}`, { provider: 'INTEL', version: '10.1.19.7', date: '2023-01-12' }) : D('Motherboard resources'),
  USB: i => D(pick(['Generic USB Hub', 'USB Composite Device', 'USB Input Device', 'USB Mass Storage Device', 'USB Device Controller']) + (i > 4 ? ` (${i})` : '')),
  HIDClass: () => D(pick(['HID-compliant consumer control device', 'HID-compliant vendor-defined device', 'HID-compliant system controller', 'USB Input Device'])),
  SoftwareComponent: i => D(`${pick(['NVIDIA', 'Intel', 'Realtek', 'ASUS'])} software component ${i}`, { provider: pick(['NVIDIA', 'Intel Corporation', 'Realtek', 'ASUSTeK']), version: `${1 + Math.floor(rnd() * 9)}.${Math.floor(rnd() * 20)}.${Math.floor(rnd() * 999)}.0`, date: `202${2 + Math.floor(rnd() * 4)}-${pad(1 + Math.floor(rnd() * 12))}-${pad(1 + Math.floor(rnd() * 27))}` }),
  SoftwareDevice: i => D(pick(['Generic software device', 'Microsoft Software Device Enumerator', 'Windows Mixed Reality bridge device']) + ` ${i}`),
  Volume: () => D('Generic volume', { inf: 'volume.inf' }),
};
let N = 1;
const DRIVERS = [];
CLASSES.forEach(([key, label, icon, count]) => {
  const list = (SPEC[key] || []).slice(); let i = list.length + 1;
  while (list.length < count) list.push((GEN[key] || (() => D(`${label} ${i}`)))(i++));
  list.slice(0, count).forEach(d => DRIVERS.push({
    id: 'd' + (N++), cls: key, clsName: label, icon, ...d,
    inf: d.inf || (d.inbox ? key.toLowerCase() + '.inf' : 'oem' + (40 + Math.floor(rnd() * 80)) + '.inf'),
    hw: d.hw || (key === 'USB' || key === 'HIDClass' ? `USB\\VID_${(0x0400 + Math.floor(rnd() * 0x2000)).toString(16).toUpperCase().padStart(4, '0')}` : `ACPI\\${key.slice(0, 4).toUpperCase()}${1000 + Math.floor(rnd() * 8999)}`),
    status: 'ok',
  }));
});
const ageOf = d => d.inbox || !d.date ? null : (TODAY - new Date(d.date)) / 3.15576e10;
const ageColor = a => a == null ? 'var(--faint)' : a < 1 ? 'var(--ok)' : a < 3 ? 'var(--accent2)' : a < 5 ? 'var(--warn)' : 'var(--bad)';
const ageText = a => { if (a == null) return t('Included with Windows'); if (a >= 1) return t('{n} years', { n: fmt1(a) }); if (a * 12 < 1) return t('this month');
  const n = Math.max(1, Math.round(a * 12)); return n === 1 ? t('{n} month', { n }) : t('{n} months', { n }); };
/* dates follow the interface language (Oct 14, 2026 / 14 oct 2026 / 2026年10月14日) */
const LOCALE = (SH.i18n && SH.i18n.locale) || 'en-US';
const fmtDate = s => { const [y, m, d] = s.split('-'); const dt = new Date(+y, +m - 1, +d); return isNaN(dt) ? s : dt.toLocaleDateString(LOCALE, { year: 'numeric', month: 'short', day: 'numeric' }); };
const byName = n => DRIVERS.find(d => d.name === n);

const UPDATES = [
  { id: 'u1', drv: 'Realtek High Definition Audio', title: 'Realtek Semiconductor Corp. - MEDIA - 6.0.9786.1', ver: '6.0.9786.1', date: '2026-10-07', mb: 62.4, reboot: true },
  { id: 'u2', drv: 'Intel(R) Management Engine Interface #1', title: 'Intel - System - 2441.6.1.0', ver: '2441.6.1.0', date: '2026-08-02', mb: 2.8, reboot: true },
  { id: 'u3', drv: 'Realtek Bluetooth 5.3 Adapter', title: 'Realtek Semiconductor Corp. - Bluetooth - 1.10.1081.3010', ver: '1.10.1081.3010', date: '2026-09-18', mb: 4.1, reboot: false },
  { id: 'u4', drv: 'ASUS System Control Interface v3', title: 'ASUSTeK Computer Inc. - System - 3.1.41.0', ver: '3.1.41.0', date: '2026-07-21', mb: 11.0, reboot: false },
].map(u => ({ ...u, d: byName(u.drv) }));

const API = {
  async lastSearch() { await wait(120); return { when: t('{n} days ago', { n: 2 }), updates: UPDATES.filter(u => !u.installed) }; },
  async search(onPhase) {
    const phases = [t('Connecting to Windows Update'), t('Requesting the driver catalog for your PC'), t('Comparing with your {n} installed drivers', { n: 303 }), t('Checking signatures and compatibility')];
    for (let i = 0; i < phases.length; i++) { onPhase(phases[i], i); await wait(1500 + i * 350); }
    return UPDATES.filter(u => !u.installed);
  },
  /* design tests can set SH.sampleRestorePoint = { ok: false, reason: 'protection_off' } to see a failure */
  async restorePoint() { await wait(1700); return SH.sampleRestorePoint || { ok: true, reason: 'created' }; },
  async install(u, onProgress) {
    for (let p = 0; p <= 1.0001; p += .04 + rnd() * .06) { onProgress('download', Math.min(1, p)); await wait(60); }
    onProgress('install', 0); await wait(900 + rnd() * 900); onProgress('done', 1);
    u.installed = true; u.d.version = u.ver; u.d.date = u.date; return { ok: true, reboot: u.reboot };
  },
  backups: [
    { id: 'b2', date: '2026-10-28', count: 186, gb: 1.9, path: 'C:\\Users\\user\\Documents\\StellarHub\\Driver backups\\2026-10-28' },
    { id: 'b1', date: '2026-10-02', count: 179, gb: 1.8, path: 'C:\\Users\\user\\Documents\\StellarHub\\Driver backups\\2026-10-02' },
  ],
  async exportDrivers(thirdOnly, onFile) {
    const list = DRIVERS.filter(d => !thirdOnly || !d.inbox); const total = thirdOnly ? 187 : 303;
    for (let i = 1; i <= total; i++) { const d = list[i % list.length]; onFile(i, total, `${d.inf}  ${d.name}`); await wait(18 + rnd() * 22); }
    return { count: total, gb: thirdOnly ? 2.0 : 2.7 };
  },
  store: { supported: true, packages: 86, mb: 79.8, old: [
    { inf: 'oem4.inf', name: 'asussci2.inf', provider: 'ASUSTeK COMPUTER INC.', cls: 'SYSTEM', version: '3.1.70.0', date: '2026-08-19', newer: '3.1.72.0', newerDate: '2026-09-14', mb: 48.5 },
    { inf: 'oem18.inf', name: 'cui_dch.inf', provider: 'Intel Corporation', cls: 'SOFTWARECOMPONENT', version: '32.0.101.6629', date: '2025-02-18', newer: '32.0.101.7088', newerDate: '2026-06-17', mb: 21.3 },
    { inf: 'oem3.inf', name: 'netrtwlane602.inf', provider: 'Realtek Semiconductor Corp.', cls: 'NET', version: '6001.16.170.0', date: '2025-07-31', newer: '6001.16.172.0', newerDate: '2025-10-16', mb: 9.7 },
  ] },
  history: [
    { date: '2026-11-09', name: 'NVIDIA GeForce RTX 5070 Laptop GPU', from: '32.0.15.8157', to: '32.0.16.1742', ok: true, rp: true, src: 'Windows Update' },
    { date: '2026-11-02', name: 'Intel(R) UHD Graphics', from: '31.0.101.5590', to: '32.0.101.7088', ok: true, rp: true, src: 'Windows Update' },
    { date: '2026-10-21', name: 'Realtek 8852CE WiFi 6E PCI-E NIC', from: '6001.16.142.0', to: '6001.16.159.0', ok: true, rp: false, src: 'Windows Update' },
    { date: '2026-10-21', name: 'Realtek Bluetooth 5.3 Adapter', from: '1.10.1043.3001', to: '1.10.1061.3005', ok: false, rp: false, src: 'Windows Update', err: t('The installer returned code {code}: the same or a newer version was already installed.', { code: '0x80070103' }) },
    { date: '2026-10-05', name: 'NVIDIA High Definition Audio', from: '1.4.2.6', to: '1.4.3.2', ok: true, rp: true, src: 'Windows Update' },
    { date: '2026-10-03', name: 'System Firmware', from: '310.0.0.0', to: '312.0.0.0', ok: true, rp: true, src: 'Windows Update' },
  ],
  ghosts: [
    { id: 'g1', name: 'SanDisk Cruzer Blade USB Device', cls: 'DiskDrive', last: t('{n} days ago', { n: 21 }) },
    { id: 'g2', name: 'Xbox Wireless Controller', cls: 'HIDClass', last: t('{n} days ago', { n: 9 }) },
    { id: 'g3', name: 'HP DeskJet 2700 series (USB)', cls: 'Printer', last: t('{n} days ago', { n: 34 }) },
  ],
};

/* ---------- data layer: real engine inside the app, sample data outside ---------- */
const fmtDateS = s => s ? fmtDate(s.slice(0, 10)) : '–';
/* narrow table columns: when the language's short month form is long ("14 de out. de 2026"), use digits (14/10/2026) */
const fmtDateCol = s => { const m = fmtDateS(s); if (!s || m.length <= 13) return m; const [y, mo, d] = s.slice(0, 10).split('-'); return new Date(+y, +mo - 1, +d).toLocaleDateString(LOCALE, { year: 'numeric', month: '2-digit', day: '2-digit' }); };
const mapDrv = d => { const [clsName, icon] = clsInfo(d.cls); return { ...d, clsName, icon }; };
const mapUpd = u => {
  const cur = u.current; const [clsName, icon] = clsInfo(cur ? cur.cls : u.cls);
  return { id: u.id, title: u.title, ver: u.ver, date: u.date, mb: u.mb || 0, reboot: !!u.reboot, isNew: !cur,
    d: { name: cur ? cur.name : (u.model || u.title), icon, version: cur ? cur.version : '', clsName, provider: u.maker || (cur && cur.provider) || '' } };
};
let drvCache = null;
const DATA = {
  async drivers(fresh) {
    if (!REAL) return DRIVERS;
    if (drvCache && !fresh) return drvCache;
    drvCache = ((await SH.engine('drivers', 'list_drivers', !!fresh)) || []).map(mapDrv); return drvCache;
  },
  async lastSearch() {
    if (!REAL) { const r = await API.lastSearch(); return { ...r, at: 1 }; }
    const r = await SH.engine('drivers', 'last_search') || {}; return { at: r.at, when: r.at ? agoText(r.at) : null, updates: (r.updates || []).map(mapUpd) };
  },
  search(onPhase) {
    if (!REAL) { let stop = false; const p = API.search((t, i) => !stop && onPhase(t, i)).then(r => { if (stop) throw Object.assign(new Error('cancelled'), { cancelled: true }); return r; }); p.cancel = () => { stop = true; }; return p; }
    const j = SH.job('drivers', 'search', [], { onProgress: m => { if (m.kind === 'progress') onPhase(m.text, (m.data || {}).phase, m); } });
    const p = j.then(r => (r.updates || []).map(mapUpd)); p.cancel = j.cancel; return p;
  },
  /* onStep(id, phase, data): id = 'rp' or the update id; phase = run|download|install|done|error|skip */
  async install(todo, onStep) {
    if (!REAL) {
      onStep('rp', 'run'); const rp = await API.restorePoint(); onStep('rp', rp.ok ? 'done' : 'skip', rp); let reboot = false;
      for (const u of todo) { const r = await API.install(u, (ph, p) => onStep(u.id, ph === 'done' ? 'done' : ph, { p })); reboot = reboot || r.reboot; onStep(u.id, 'done', { result: { ok: true, reboot: r.reboot } }); }
      return { results: todo.map(u => ({ id: u.id, ok: true, reboot: u.reboot })), reboot, restorePoint: rp };
    }
    return SH.job('drivers', 'install', [todo.map(u => u.id), true], { onProgress: m => { const d = m.data || {}; if (m.kind === 'progress' && d.step) onStep(d.step, d.phase, d); } });
  },
  async problems() {
    if (!REAL) return { errors: [], disabled: [], ghosts: API.ghosts.map(g => ({ ...g, lastText: g.last })) };
    const r = await SH.engine('drivers', 'problems') || {};
    r.ghosts = (r.ghosts || []).map(g => ({ ...g, lastText: g.last ? agoText(Date.parse(g.last) / 1000) : t('a while ago') })); return r;
  },
  async backups() { return REAL ? (await SH.engine('drivers', 'backups') || []) : API.backups; },
  async history() {
    if (!REAL) return API.history;
    return ((await SH.engine('drivers', 'history')) || []).map(h => ({ date: (h.date || '').slice(0, 10), name: h.name, cls: h.cls, to: h.ver, from: '', ok: h.ok, src: 'Windows Update', err: h.err, title: h.title }));
  },
};

/* ---------- interface helpers ---------- */
const CHECK = '<span class="check"><svg class="i" viewBox="0 0 24 24"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg></span>';
/* "select all" box with three states: none, some (a dash) or all */
const allCheck = (id, label) => `<span class="check" role="checkbox" tabindex="0" aria-checked="false" id="${id}" aria-label="${esc(label)}" title="${esc(t('Select all'))}"><svg class="i" viewBox="0 0 24 24"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg></span>`;
function setTri(box, n, total) {
  if (!box) return;
  const st = !total || !n ? 'false' : n === total ? 'true' : 'mixed';
  box.classList.toggle('on', st === 'true'); box.classList.toggle('some', st === 'mixed'); box.setAttribute('aria-checked', st);
}
/* the empty state, centred in its panel */
const emptyBox = (title, body, icon = 'check') => `<div class="empty du-empty"><span class="du-ei${icon === 'check' ? ' ok' : ''}">${ic(icon)}</span><b>${title}</b><span class="du-et">${body}</span></div>`;
function flip(container, mutate) {
  const kids = [...container.children]; const first = new Map(kids.map(e => [e, e.getBoundingClientRect().top]));
  mutate();
  [...container.children].forEach(e => { const f = first.get(e); if (f == null) return; const d = f - e.getBoundingClientRect().top; if (Math.abs(d) > .5) anim(e, [{ transform: `translateY(${d}px)` }, { transform: 'none' }], { d: 460, e: EASE.spring }); });
}
function removeRow(row, container) {
  anim(row, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateX(28px) scale(.97)' }], { d: 220 }).finished.then(() => flip(container, () => row.remove())).catch(() => row.remove());
}
function ringSVG(cls = 'ring', col = 'var(--ok)') {
  return `<svg class="${cls}" viewBox="0 0 64 64"><circle cx="32" cy="32" r="27" fill="none" style="stroke:var(--raise2)" stroke-width="4"/><circle class="rg" cx="32" cy="32" r="27" fill="none" style="stroke:${col}" stroke-width="4" stroke-linecap="round" stroke-dasharray="169.6" stroke-dashoffset="169.6" transform="rotate(-90 32 32)"/><path class="ck" d="m21 33 7.5 7.5L44 25" fill="none" style="stroke:${col}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="40" stroke-dashoffset="40"/></svg>`;
}
function warnSVG(cls = 'ring') {
  return `<svg class="${cls}" viewBox="0 0 64 64"><circle cx="32" cy="32" r="27" fill="none" style="stroke:var(--raise2)" stroke-width="4"/><circle class="rg" cx="32" cy="32" r="27" fill="none" style="stroke:var(--warn)" stroke-width="4" stroke-linecap="round" stroke-dasharray="169.6" stroke-dashoffset="169.6" transform="rotate(-90 32 32)"/><path class="ck" d="M32 20v15M32 43v1" fill="none" style="stroke:var(--warn)" stroke-width="4.5" stroke-linecap="round" stroke-dasharray="40" stroke-dashoffset="40"/></svg>`;
}
function playRing(svg, delay = 0) {
  if (!svg) return;
  anim($('.rg', svg), [{ strokeDashoffset: 169.6 }, { strokeDashoffset: 0 }], { d: 900, delay });
  anim($('.ck', svg), [{ strokeDashoffset: 40 }, { strokeDashoffset: 0 }], { d: 420, delay: delay + 650, e: EASE.out });
}
function segHTML(opts, on) { return `<div class="seg"><span class="ind"></span>${opts.map(([v, l]) => `<button data-v="${v}"${v === on ? ' class="on"' : ''}>${l}</button>`).join('')}</div>`; }
function wireSeg(seg, cb) {
  requestAnimationFrame(() => SH.placeSeg(seg, true));
  seg.addEventListener('click', e => { const b = e.target.closest('button'); if (!b || b.classList.contains('on')) return; $$('button', seg).forEach(x => x.classList.toggle('on', x === b)); SH.placeSeg(seg); cb(b.dataset.v); });
}
function swap(el, html, dir = 1) {
  anim(el, [{ opacity: 1, transform: 'none', filter: 'blur(0px)' }, { opacity: 0, transform: `translate3d(${-dir * 16}px,0,0)`, filter: 'blur(6px)' }], { d: 150 }).finished.then(() => {
    el.innerHTML = html; anim(el, [{ opacity: 0, transform: `translate3d(${dir * 22}px,0,0)`, filter: 'blur(6px)' }, { opacity: 1, transform: 'none', filter: 'blur(0px)' }], { d: 420, e: EASE.spring });
  }).catch(() => { el.innerHTML = html; });
}
const stagger = (els, base = 0, step = 35) => els.forEach((el, i) => anim(el, [{ opacity: 0, transform: 'translate3d(0,10px,0)' }, { opacity: 1, transform: 'none' }], { d: 420, delay: base + Math.min(i, 16) * step, e: EASE.spring }));
const skRows = n => `<div class="sk-rows">${Array.from({ length: n }, (_, k) => `<div class="sk-row"><div class="sk a" style="--dl:${k * .1}s"></div><div class="sk b" style="--w:${[44, 36, 52, 30, 41, 47][k % 6]}%;--dl:${k * .1}s"></div><div class="sk c"></div></div>`).join('')}</div>`;
const errBox = (msg, retry) => `<div class="empty"><b>${t('Could not read it')}</b>${esc(msg)}${retry ? `<div style="margin-top:12px"><button class="btn sec sm" data-retry>${t('Try again')}</button></div>` : ''}</div>`;

/* ================= Updates ================= */
function renderUpdates(el, ctx) {
  el.innerHTML = `<div class="du-wrap">
    <div class="pan du-hero" data-asm>
      <div class="du-radar" id="duRadar"><i style="--in:14px"></i><i style="--in:30px"></i><span class="sweep"></span><span class="core"></span></div>
      <div class="du-hero-t"><h3 id="duTitle">${t('Loading…')}</h3><p><span class="phase" id="duPhase">${t('Only drivers signed by Microsoft, from Windows Update. No telemetry.')}</span></p><div class="du-indet" id="duIndet"><span></span></div></div>
      <div class="du-hero-a"><span class="du-time" id="duTime"></span><button class="btn sec" id="duSearch">${ic('search')}${t('Search again')}</button></div>
    </div>
    <div class="pan du-list" id="duList" data-asm></div>
    <div class="du-actbar" id="duBar" data-asm><span class="t" id="duSel"></span><button class="btn ghost" id="duNone">${t('Clear selection')}</button><button class="btn pri lg" id="duInstall">${ic('download')}${t('Install')}</button></div>
  </div>`;
  const st = { updates: [], sel: new Set(), busy: false, searching: null };
  const list = $('#duList', el);
  function head(n, when) {
    $('#duTitle', el).textContent = when == null ? t('Look for new drivers') : n ? (n === 1 ? t('{n} new driver for your PC', { n }) : t('{n} new drivers for your PC', { n })) : t('Your drivers are up to date');
    $('#duPhase', el).textContent = when == null ? t('You have not searched yet. Windows Update takes one to three minutes.') : t('Last search: {when}. Only drivers signed by Microsoft, from Windows Update.', { when });
    ctx.setBadge('updates', n);
  }
  function rowHTML(u) {
    const d = u.d; const vtxt = u.isNew ? t('New for this PC, version {ver}', { ver: esc(u.ver) }) : t('{from} to {to}', { from: esc(d.version), to: esc(u.ver) });
    return `<div class="du-row du-cols${st.sel.has(u.id) ? ' sel' : ''}" data-u="${u.id}">${CHECK.replace('class="check"', `class="check${st.sel.has(u.id) ? ' on' : ''}"`)}
      <div class="nm"><span class="ri">${ic(d.icon)}</span><div style="min-width:0"><b title="${esc(u.title || d.name)}">${esc(d.name)}</b><span>${vtxt}</span></div></div>
      <span class="c">${esc(d.clsName)}<br><span class="faint">${esc(d.provider)}</span></span><span class="c">${fmtDateCol(u.date)}</span><span class="c">${fmt1(u.mb)} MB</span>
      <span>${u.reboot ? `<span class="chip warn">${t('Needs a restart')}</span>` : `<span class="chip">${t('No restart')}</span>`}</span></div>`;
  }
  function drawList(animate, never) {
    if (never) list.innerHTML = emptyBox(t('You have not searched yet'), t('Click "{btn}" and StellarHub will ask Windows Update which drivers are available for your PC.', { btn: t('Search again') }), 'search');
    else if (!st.updates.length) list.innerHTML = emptyBox(t('Nothing to install'), t('Your drivers match the latest that Windows Update offers for this PC.'));
    else list.innerHTML = `<div class="tbl-head du-cols">${allCheck('duAll', t('Select all drivers'))}<span>${t('Driver')}</span><span>${t('Class')}</span><span>${t('Date')}</span><span>${t('Size')}</span><span></span></div><div class="rows" id="duRows">${st.updates.map(rowHTML).join('')}</div>`;
    if (animate) stagger($$('.du-row', list), 60);
    syncBar();
  }
  function syncBar() {
    const mb = st.updates.filter(u => st.sel.has(u.id)).reduce((a, u) => a + u.mb, 0);
    $('#duSel', el).innerHTML = st.sel.size ? t('<b>{n} selected</b>, {mb} MB. A restore point will be created before installing.', { n: st.sel.size, mb: fmt1(mb) }) : t('Choose the drivers you want to install.');
    $('#duInstall', el).disabled = !st.sel.size || st.busy; $('#duNone', el).style.visibility = st.sel.size ? 'visible' : 'hidden';
    const bar = $('#duBar', el); bar.style.display = st.updates.length && !st.busy ? '' : 'none';
    setTri($('#duAll', el), st.updates.filter(u => st.sel.has(u.id)).length, st.updates.length);
  }
  list.addEventListener('keydown', e => { if ((e.key === ' ' || e.key === 'Enter') && e.target.id === 'duAll') { e.preventDefault(); e.target.click(); } });
  list.addEventListener('click', e => {
    if (st.busy) return;
    if (e.target.closest('#duAll')) { if (st.sel.size === st.updates.length) st.sel.clear(); else st.updates.forEach(u => st.sel.add(u.id)); $$('.du-row', list).forEach(r => { const on = st.sel.has(r.dataset.u); r.classList.toggle('sel', on); $('.check', r).classList.toggle('on', on); }); anim($('#duAll', el), [{ transform: 'scale(.8)' }, { transform: 'scale(1)' }], { d: 300, e: EASE.spring }); syncBar(); return; }
    const r = e.target.closest('.du-row'); if (!r) return; const id = r.dataset.u;
    st.sel.has(id) ? st.sel.delete(id) : st.sel.add(id); r.classList.toggle('sel', st.sel.has(id)); $('.check', r).classList.toggle('on', st.sel.has(id));
    anim($('.check', r), [{ transform: 'scale(.8)' }, { transform: 'scale(1)' }], { d: 300, e: EASE.spring }); syncBar();
  });
  $('#duNone', el).addEventListener('click', () => { st.sel.clear(); drawList(false); });
  /* search (with cancel) */
  let t0 = 0, timer = 0, lastPhase = -1;
  const sbtn = $('#duSearch', el);
  const setSearchBtn = busy => { sbtn.innerHTML = busy ? `${ic('x')}${t('Cancel')}` : `${ic('search')}${t('Search again')}`; sbtn.classList.toggle('ghost', busy); sbtn.classList.toggle('sec', !busy); };
  function phaseText(txt) {
    const ph = $('#duPhase', el); anim(ph, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translate3d(0,-6px,0)' }], { d: 140 }).finished.then(() => { ph.textContent = txt + '…'; anim(ph, [{ opacity: 0, transform: 'translate3d(0,6px,0)' }, { opacity: 1, transform: 'none' }], { d: 300, e: EASE.spring }); }).catch(() => {});
  }
  function blips(radar) { for (let k = 0; k < 2; k++) { const b = document.createElement('span'); b.className = 'blip'; const a = Math.random() * 6.28, r = 16 + Math.random() * 26; b.style.left = 46 + Math.cos(a) * r + 'px'; b.style.top = 46 + Math.sin(a) * r + 'px'; radar.appendChild(b); anim(b, [{ opacity: 0, transform: 'scale(0)' }, { opacity: 1, transform: 'scale(1.6)', offset: .4 }, { opacity: .85, transform: 'scale(1)' }], { d: 600, e: EASE.out }); } }
  async function search() {
    if (st.searching) { st.searching.cancel(); return; }
    if (st.busy) return; st.busy = true; syncBar(); setSearchBtn(true); lastPhase = -1;
    const radar = $('#duRadar', el); radar.classList.add('on'); $$('.blip', radar).forEach(b => b.remove());
    $('#duIndet', el).classList.add('on');
    t0 = performance.now(); timer = setInterval(() => { const s = Math.floor((performance.now() - t0) / 1000); $('#duTime', el).textContent = s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`; }, 250);
    list.innerHTML = skRows(4); stagger($$('.sk-row', list));
    $('#duTitle', el).textContent = t('Looking for new drivers');
    st.searching = DATA.search((txt, i) => { if (i === lastPhase || !txt) return; lastPhase = i; phaseText(txt); if (i >= 2) blips(radar); });
    let res = null, err = null;
    try { res = await st.searching; } catch (e) { err = e; }
    st.searching = null; clearInterval(timer); $('#duTime', el).textContent = '';
    radar.classList.remove('on'); $('#duIndet', el).classList.remove('on'); setSearchBtn(false); st.busy = false;
    if (err) {
      if (err.cancelled) { const r = await DATA.lastSearch(); st.updates = r.updates; st.sel = new Set(st.updates.map(u => u.id)); head(st.updates.length, r.when); drawList(true, !r.at); SH.toast(t('Search cancelled.')); return; }
      $('#duTitle', el).textContent = t('Windows Update did not respond'); $('#duPhase', el).textContent = err.message; list.innerHTML = errBox(t('Check your connection and try again. Sometimes Windows Update is busy installing something else.')); syncBar(); return;
    }
    st.updates = res || []; st.sel = new Set(st.updates.map(u => u.id)); head(st.updates.length, t('just now'));
    SH.setPending('drivers', st.updates.length);
    anim($('#duTitle', el), [{ opacity: 0, transform: 'translate3d(0,8px,0)', filter: 'blur(4px)' }, { opacity: 1, transform: 'none', filter: 'blur(0px)' }], { d: 420, e: EASE.spring });
    drawList(true);
  }
  sbtn.addEventListener('click', search);
  ctx.el()._searchDrivers = () => { if (!st.busy) search(); };
  /* installation */
  $('#duInstall', el).addEventListener('click', async () => {
    if (!st.sel.size || st.busy) return;
    if (REAL && !SH.state.admin) { SH.requireAdmin(t('to install drivers. Windows only allows it with administrator rights.')); return; }
    const todo = st.updates.filter(u => st.sel.has(u.id));
    const n = todo.length;
    const okGo = await ask(n === 1 ? t('Install {n} driver', { n }) : t('Install {n} drivers', { n }),
      t('A restore point is created first so you can go back.') + (todo.some(u => u.reboot) ? ' ' + t('Some of them will ask to restart the PC when done.') : ''), t('Install'));
    if (!okGo) return;
    st.busy = true; syncBar(); sbtn.disabled = true;
    $('#duTitle', el).textContent = n === 1 ? t('Installing {n} driver', { n }) : t('Installing {n} drivers', { n }); $('#duPhase', el).textContent = t('Do not turn off the PC. You can keep using StellarHub.');
    $('#duRadar', el).classList.add('on');
    const steps = [{ id: 'rp', name: t('Restore point'), sub: t('To go back if something goes wrong') }, ...todo.map(u => ({ id: u.id, name: u.d.name, sub: `${fmt1(u.mb)} MB`, u }))];
    list.innerHTML = `<div class="du-inst">${steps.map(s => `<div class="du-step" data-s="${s.id}"><span class="st">${ic(s.id === 'rp' ? 'restore' : 'download')}</span><div><b>${esc(s.name)}</b><span class="sub">${esc(s.sub)}</span></div><div class="bar"><span style="transform:scaleX(0)"></span></div><span class="res"><span class="chip">${t('Queued')}</span></span></div>`).join('')}</div>`;
    stagger($$('.du-step', list), 40, 50);
    const springs = new Map(steps.map(s => [s.id, new Spring(0, 120, 18)]));
    const tk = dt => { if (SH.state.view !== 'drivers') return; springs.forEach((sp, id) => { if (sp.idle) return; sp.step(dt); const b = $(`.du-step[data-s="${id}"] .bar>span`, list); if (b) b.style.transform = `scaleX(${sp.v.toFixed(4)})`; }); };
    tickers.add(tk);
    const setRes = (id, html, cls) => { const s = $(`.du-step[data-s="${id}"]`, list); if (!s) return; s.classList.remove('run', 'ok'); if (cls) s.classList.add(cls); const r = $('.res', s); r.innerHTML = html; anim(r, [{ opacity: 0, transform: 'scale(.8)' }, { opacity: 1, transform: 'none' }], { d: 320, e: EASE.spring }); };
    const markOk = id => { const ok = $(`.du-step[data-s="${id}"] .st`, list); if (ok) { ok.innerHTML = ic('check'); anim(ok, [{ transform: 'scale(.6)' }, { transform: 'scale(1)' }], { d: 420, e: EASE.spring }); } };
    const seen = {};
    let rpMade = false;
    /* why the restore point was not created (engine/backups.py reason codes), with the way to fix it */
    const rpWhy = d => {
      const row = $('.du-step[data-s="rp"]', list); if (!row) return; row.classList.add('rpwarn');
      const s = $('.sub', row); if (s) s.textContent = d.msg || RP_WHY[d.reason] || RP_WHY.failed;
      const fix = ['protection_off', 'service_disabled', 'policy'].includes(d.reason) ? 'protect' : 'retry';
      let b = $('.du-rpfix', row); if (b) b.remove();
      b = document.createElement('button'); b.className = 'btn sm sec du-rpfix';
      b.innerHTML = fix === 'protect' ? `${ic('shield')}${d.reason === 'protection_off' ? t('Turn on protection') : t('See how to fix it')}` : `${ic('restore')}${t('Try again')}`;
      s.after(b); anim(b, [{ opacity: 0, transform: 'translate3d(0,4px,0)' }, { opacity: 1, transform: 'none' }], { d: 260, e: EASE.spring });
      b.addEventListener('click', async () => {
        if (fix === 'protect') { SH.go('settings', { section: 'backups' }); return; }
        b.disabled = true; setRes('rp', `<span class="chip acc">${t('Creating')}</span>`, 'run');
        let r;
        try { r = REAL ? await SH.job('backups', 'create_point', [t('StellarHub: before installing drivers')]) : await API.restorePoint(); }
        catch (e) { r = { ok: false, reason: 'failed', msg: e.message }; }
        if (r && r.ok) { rpMade = true; b.remove(); row.classList.remove('rpwarn'); if (s) s.textContent = t('To go back if something goes wrong'); setRes('rp', `<span class="chip ok">${t('Created')}</span>`, 'ok'); markOk('rp'); }
        else { setRes('rp', `<span class="chip warn">${t('Not created')}</span>`, 'ok'); rpWhy(r || {}); }
      });
    };
    const onStep = (id, phase, d = {}) => {
      const sp = springs.get(id); if (!sp || seen[id] === phase) return; seen[id] = phase;
      if (id === 'rp') {
        if (phase === 'run') { setRes('rp', `<span class="chip acc">${t('Creating')}</span>`, 'run'); sp.t = .6; }
        else if (phase === 'done') { sp.t = 1; rpMade = true; setRes('rp', `<span class="chip ok">${t('Created')}</span>`, 'ok'); markOk('rp'); }
        else if (phase === 'skip') { sp.t = 1; setRes('rp', `<span class="chip warn">${t('Not created')}</span>`, 'ok'); rpWhy(d); }
        return;
      }
      if (phase === 'download') { sp.t = .35; setRes(id, `<span class="chip acc">${t('Downloading')}</span>`, 'run'); }
      else if (phase === 'install') { sp.t = .8; setRes(id, `<span class="chip acc">${t('Installing')}</span>`, 'run'); }
      else if (phase === 'done') { sp.t = 1; const rb = d.result && d.result.reboot; setRes(id, rb ? `<span class="chip warn">${t('Done, needs a restart')}</span>` : `<span class="chip ok">${t('Installed')}</span>`, 'ok'); markOk(id); }
      else if (phase === 'error') { sp.t = 1; setRes(id, `<span class="chip bad">${t('Failed')}</span>`, 'ok'); const s = $(`.du-step[data-s="${id}"] .sub`, list); if (s) s.textContent = (d.result && (d.result.msg || (d.result.hresult ? t('Code 0x{code}', { code: d.result.hresult }) : ''))) || t('Windows Update could not install it.'); }
    };
    let out = null, err = null;
    try { out = await DATA.install(todo, onStep); } catch (e) { err = e; }
    await wait(400); tickers.delete(tk);
    $('#duRadar', el).classList.remove('on'); st.busy = false; sbtn.disabled = false;
    if (out && out.needAdmin) { SH.requireAdmin(t('to install drivers.')); }
    const results = (out && out.results) || [];
    const okIds = new Set(results.filter(r => r.ok).map(r => r.id)); const failed = results.filter(r => !r.ok).length;
    const reboot = !!(out && out.reboot);
    st.updates = st.updates.filter(u => !okIds.has(u.id)); st.sel.clear(); head(st.updates.length, t('just now')); drvCache = null;
    if (REAL) SH.setPending('drivers', st.updates.length);
    const nOk = okIds.size;
    if (nOk) SH.logActivity(nOk === 1 ? t('{n} driver installed', { n: nOk }) : t('{n} drivers installed', { n: nOk }), { sub: todo.filter(u => okIds.has(u.id)).map(u => u.d.name).slice(0, 2).join(', '), ic: 'drivers', go: 'drivers', tab: 'history' });
    const done = document.createElement('div'); done.className = 'pan du-done';
    const ttl = err ? t('The installation was interrupted') : !nOk ? t('No driver was installed')
      : failed ? (nOk === 1 ? t('{n} driver installed, {failed} with errors', { n: nOk, failed }) : t('{n} drivers installed, {failed} with errors', { n: nOk, failed }))
      : (nOk === 1 ? t('{n} driver installed', { n: nOk }) : t('{n} drivers installed', { n: nOk }));
    done.innerHTML = `${okIds.size && !err ? ringSVG('ring') : warnSVG('ring')}<div><h3>${ttl}</h3><p>${err ? esc(err.message) : reboot ? t('Restart the PC to finish.') : nOk ? t('No restart needed.') : t('See the reason on each row.')} ${nOk && rpMade ? t('The restore point stays saved in case you want to go back.') : ''}</p></div>
      <div class="a">${reboot ? `<button class="btn ghost" data-x="later">${t('Later')}</button><button class="btn pri" data-x="reboot">${t('Restart in 1 minute')}</button>` : `<button class="btn sec" data-x="later">${t('Close')}</button>`}</div>`;
    list.before(done); anim(done, [{ opacity: 0, transform: 'translate3d(0,-10px,0) scale(.97)', filter: 'blur(6px)' }, { opacity: 1, transform: 'none', filter: 'blur(0px)' }], { d: 520, e: EASE.spring }); playRing($('svg', done), 150);
    done.addEventListener('click', async e => {
      const b = e.target.closest('[data-x]'); if (!b) return;
      if (b.dataset.x === 'reboot') {
        if (REAL) await SH.engine('drivers', 'restart', 60);
        SH.toast(t('The PC will restart in 1 minute.'), { ms: 9000, action: { label: t('Cancel'), run: async () => { if (REAL) await SH.engine('drivers', 'cancel_restart'); SH.toast(t('Restart cancelled.')); } } });
      }
      anim(done, [{ opacity: 1 }, { opacity: 0, transform: 'scale(.97)' }], { d: 220 }).finished.then(() => done.remove()).catch(() => done.remove());
    });
    drawList(true);
  });
  DATA.lastSearch().then(r => { st.updates = r.updates; st.sel = new Set(r.updates.map(u => u.id)); head(r.updates.length, r.when); drawList(true, REAL && !r.at); })
    .catch(e => { $('#duTitle', el).textContent = t('Look for new drivers'); list.innerHTML = errBox(e.message); });
}

/* ================= All drivers ================= */
async function renderAll(el) {
  el.classList.add('fill');
  el.innerHTML = `<div class="pan da-left" data-asm><div class="da-tools"><label class="field">${ic('search')}<input id="daQ" placeholder="${t('Search for a driver, manufacturer or version')}" spellcheck="false"></label>
      ${segHTML([['all', t('All')], ['2', t('Over 2 years')], ['5', t('Over 5 years')], ['inbox', t('From Windows')], ['bad', t('With problems')]], 'all')}<span class="cnt" id="daCnt">${t('Reading…')}</span></div>
      <div class="da-scroll" id="daScroll">${skRows(9)}</div></div>
    <div class="pan da-detail" id="daDetail" data-asm><div class="dd-empty"><div>${ic('drivers')}<div>${t('Choose a driver to see its details,<br>go back to a previous version or disable it.')}</div></div></div></div>`;
  const scroll = $('#daScroll', el); let q = '', age = 'all', selected = null, ALL = [];
  wireSeg($('.seg', el), v => { age = v; filter(); });
  async function load(fresh) {
    try { ALL = await DATA.drivers(fresh); } catch (e) { scroll.innerHTML = errBox(e.message, true); return; }
    const order = Object.keys(CLS); const keys = [...new Set(ALL.map(d => d.cls))].sort((a, b) => (order.indexOf(a.toUpperCase()) + 1 || 99) - (order.indexOf(b.toUpperCase()) + 1 || 99));
    const groups = keys.map(k => ({ key: k, label: clsInfo(k)[0], icon: clsInfo(k)[1], items: ALL.filter(d => d.cls === k) }));
    scroll.innerHTML = groups.map((g, gi) => `<div class="da-grp${gi < 2 ? ' open' : ''}" data-g="${g.key}"><button class="da-gh">${ic('chev', 'i cv')}<span class="ri">${ic(g.icon)}</span><b>${esc(g.label)}</b><span class="n">${g.items.length}</span></button>
        <div class="da-body"><div><div class="da-in">${g.items.map(d => { const a = ageOf(d); return `<button class="da-row${d.status !== 'ok' ? ' bad' : ''}" data-d="${d.id}"><span class="n1">${esc(d.name)}<small>${d.status === 'off' ? t('{provider}, disabled', { provider: esc(d.provider) }) : d.status === 'err' ? t('{provider}, with an error', { provider: esc(d.provider) }) : esc(d.provider)}</small></span><span class="v">${esc(d.version)}</span><span class="v">${d.inbox ? '–' : fmtDateCol(d.date)}</span><span class="age" style="--c:${ageColor(a)}"><i></i>${ageText(a)}</span></button>`; }).join('')}</div></div></div></div>`).join('');
    $('#daCnt', el).textContent = ALL.length === 1 ? t('{n} driver', { n: ALL.length }) : t('{n} drivers', { n: ALL.length });
    stagger($$('.da-grp', scroll).slice(0, 10), 0, 30); filter(true);
  }
  scroll.addEventListener('click', e => {
    if (e.target.closest('[data-retry]')) { scroll.innerHTML = skRows(9); load(true); return; }
    const gh = e.target.closest('.da-gh'); if (gh) { const g = gh.parentElement; g.classList.toggle('open'); if (g.classList.contains('open')) stagger($$('.da-row:not([hidden])', g).slice(0, 14), 60, 18); return; }
    const r = e.target.closest('.da-row'); if (r) select(r.dataset.d, r);
  });
  function filter(quiet) {
    let n = 0; const qq = q.toLowerCase();
    $$('.da-grp', scroll).forEach(g => {
      let vis = 0;
      $$('.da-row', g).forEach(r => { const d = ALL.find(x => x.id === r.dataset.d); if (!d) return; const a = ageOf(d);
        const okAge = age === 'all' || (age === 'inbox' ? d.inbox : age === 'bad' ? d.status !== 'ok' : a != null && a >= +age);
        const okQ = !qq || (d.name + ' ' + d.provider + ' ' + d.version).toLowerCase().includes(qq);
        r.hidden = !(okAge && okQ); if (!r.hidden) vis++; });
      g.hidden = !vis; n += vis; $('.n', g).textContent = vis;
      if ((qq || age !== 'all') && vis) g.classList.add('open');
    });
    $('#daCnt', el).textContent = n === 1 ? t('{n} driver', { n }) : t('{n} drivers', { n });
    if (!quiet) stagger($$('.da-grp:not([hidden])', scroll).slice(0, 8), 0, 30);
  }
  let qt = 0; $('#daQ', el).addEventListener('input', e => { q = e.target.value.trim(); clearTimeout(qt); qt = setTimeout(filter, 120); });
  function detailHTML(d) {
    const a = ageOf(d);
    return `<div class="dd-in"><span class="chip">${ic(d.icon)}${esc(d.clsName)}</span><h3>${esc(d.name)}</h3><div class="who">${esc(d.provider)}</div>
      <dl><dt>${t('Version')}</dt><dd>${esc(d.version)}</dd><dt>${t('Date')}</dt><dd>${fmtDateS(d.date)}</dd><dt>${t('Age')}</dt><dd><span class="age" style="--c:${ageColor(a)}"><i></i>${ageText(a)}</span></dd><dt>${t('INF file')}</dt><dd>${esc(d.inf || '–')}</dd><dt>${t('Hardware ID')}</dt><dd>${esc(d.hw || '–')}</dd>
        <dt>${t('Status')}</dt><dd>${d.status === 'off' ? `<span class="chip warn">${t('Disabled')}</span>` : d.status === 'err' ? `<span class="chip bad">${t('Error {code}', { code: d.code })}</span>` : `<span class="chip ok">${t('Working')}</span>`}</dd></dl>
      ${d.inbox ? `<div class="dnote">${t('Windows dates all of its built-in drivers June 21, 2006. That does not mean they are old: they are updated with Windows.')}</div>` : a > 3 ? `<div class="dnote">${t('This driver is more than 3 years old. Check Updates to see whether Windows Update offers a newer one.')}</div>` : ''}
      <div class="acts"><button class="btn sec" data-a="toggle">${ic('power')}${d.status === 'off' ? t('Enable the device') : t('Disable the device')}</button><button class="btn ghost" data-a="devmgmt">${ic('external')}${t('Open Device Manager')}</button></div>
      <div class="dd-files" id="ddVers"><div class="faint" style="border:0">${t('Versions stored on this PC')}</div>${REAL && d.instance ? '<div><span class="sk" style="height:10px;width:60%"></span></div>' : `<div><span>${esc(d.inf || '–')}</span><span class="faint">${t('the installed one')}</span></div>`}</div></div>`;
  }
  async function loadVersions(d) {
    if (!REAL || !d.instance) return;
    let vs = []; try { vs = await SH.engine('drivers', 'driver_versions', d.instance) || []; } catch { vs = []; }
    if (selected !== d) return; const box = $('#ddVers', el); if (!box) return;
    box.innerHTML = `<div class="faint" style="border:0">${t('Versions stored on this PC')}</div>${vs.length ? vs.map(v => `<div><span>${esc(v.version || '–')}<small class="faint"> ${esc(v.inf)}${v.original ? ` (${esc(v.original)})` : ''}</small></span>${v.installed ? `<span class="chip ok">${t('Installed')}</span>` : v.older ? `<button class="btn sm sec" data-rb="${esc(v.inf)}">${ic('restore')}${t('Go back to this one')}</button>` : `<span class="faint">${t('Windows generic')}</span>`}</div>`).join('') : `<div><span class="faint">${t('Windows does not keep other versions of this driver.')}</span></div>`}`;
    stagger($$('div', box).slice(1), 0, 40);
  }
  function select(id, row) {
    const d = ALL.find(x => x.id === id); if (!d) return; selected = d;
    $$('.da-row.sel', scroll).forEach(x => x.classList.remove('sel')); row.classList.add('sel');
    swap($('#daDetail', el), detailHTML(d)); setTimeout(() => loadVersions(d), 200);
  }
  $('#daDetail', el).addEventListener('click', async e => {
    const b = e.target.closest('[data-a],[data-rb]'); if (!b || !selected) return; const d = selected;
    if (b.dataset.a === 'devmgmt') { if (await SH.call('run_tool', 'devmgmt') === undefined) SH.toast(t('This only works inside the app.')); return; }
    if (b.dataset.rb) {
      if (REAL && !SH.state.admin) { SH.requireAdmin(t('to go back to a previous driver version.')); return; }
      if (!await ask(t('Go back to the previous version'), t('{name} will switch to the <b>{pkg}</b> package. A restore point is created first. It may ask for a restart.', { name: esc(d.name), pkg: esc(b.dataset.rb) }), t('Go back to this one'))) return;
      b.disabled = true; b.innerHTML = `${ic('restore')}${t('Installing…')}`;
      try { const r = REAL ? await SH.job('drivers', 'rollback', [d.instance, b.dataset.rb, d.hw]) : { ok: true }; if (needAdmin(r, t('to roll back a driver.'))) return;
        SH.toast(r.ok ? (r.reboot ? t('{name}: previous version installed. Restart to finish.', { name: d.name }) : t('{name}: previous version installed.', { name: d.name })) : t('It did not work: {msg}', { msg: r.msg })); if (r.ok) { SH.logActivity(t('Driver rolled back'), { sub: d.name, ic: 'restore', go: 'drivers', tab: 'all' }); drvCache = null; await load(true); }
      } catch (er) { SH.toast(t('It did not work: {msg}', { msg: er.message })); }
      return;
    }
    if (b.dataset.a === 'toggle') {
      const enable = d.status === 'off';
      if (REAL && !SH.state.admin) { SH.requireAdmin(t('to disable or enable devices.')); return; }
      if (!enable && !await ask(t('Disable the device'), t('{name} will stop working until you enable it again here or from Device Manager.', { name: esc(d.name) }), t('Disable'), true)) return;
      const apply = async en => { const r = REAL ? await SH.job('drivers', 'set_enabled', [d.instance, en]) : { ok: true }; if (needAdmin(r, t('to disable devices.'))) return false; if (!r.ok) { SH.toast(t('Windows did not allow it: {msg}', { msg: r.msg || '' })); return false; } d.status = en ? 'ok' : 'off'; const row = $(`.da-row[data-d="${d.id}"]`, scroll); if (row && selected === d) swap($('#daDetail', el), detailHTML(d)); return true; };
      if (await apply(enable)) SH.toast(enable ? t('Device enabled.') : t('Device disabled.'), { action: { label: t('Undo'), run: () => apply(!enable) } });
    }
  });
  load(false);
}

/* ================= Problems ================= */
async function renderProblems(el) {
  el.innerHTML = `<div class="du-wrap"><div class="pan dp-hero" data-asm>${ringSVG('ring', 'var(--accent2)')}<div><h3>${t('Checking your devices')}</h3><p>${t('One moment.')}</p></div></div><div class="dp-grid"><div class="pan" data-asm>${skRows(4)}</div><div class="pan" data-asm>${skRows(3)}</div></div></div>`;
  let P; try { P = await DATA.problems(); } catch (e) { el.innerHTML = `<div class="du-wrap"><div class="pan">${errBox(e.message)}</div></div>`; return; }
  const bad = P.errors.length;
  const errRow = x => `<div class="row" data-id="${esc(x.id)}"><span class="ri" style="color:var(--warn)">${ic('alert')}</span><span class="rt"><b>${esc(x.name)}</b><span>${esc(x.why)} ${t('Code {code}.', { code: x.code })}</span></span><button class="btn sm sec" data-act="search">${t('Find a driver')}</button><button class="btn sm ghost" data-act="devmgmt" title="${t('Open in Device Manager')}">${ic('external')}</button></div>`;
  const disRow = x => `<div class="row" data-id="${esc(x.id)}"><span class="ri">${ic('power')}</span><span class="rt"><b>${esc(x.name)}</b><span>${t('Disabled. It will not work until you enable it.')}</span></span><button class="btn sm sec" data-act="enable">${t('Enable')}</button></div>`;
  const ghRow = g => `<div class="row" data-id="${esc(g.id)}"><span class="ri">${ic(clsInfo(g.cls)[1])}</span><span class="rt"><b>${esc(g.name)}</b><span>${t('{cls}, last connected {when}', { cls: esc(clsInfo(g.cls)[0]), when: esc(g.lastText) })}</span></span><button class="btn sm ghost" data-act="rm">${t('Remove')}</button></div>`;
  el.innerHTML = `<div class="du-wrap">
    <div class="pan dp-hero" data-asm>${bad ? warnSVG('ring') : ringSVG('ring')}<div><h3>${bad ? (bad === 1 ? t('{n} device with problems', { n: bad }) : t('{n} devices with problems', { n: bad })) : t('No devices with problems')}</h3>
      <p>${bad ? t('Below you can see what is wrong with each one in plain words and what you can do.') : t('Every driver loads correctly and there are no devices without a driver.')} ${REAL ? t('Checked just now.') : t('Checked a moment ago.')}</p></div>
      <button class="btn ghost sm" id="dpRe" style="margin-left:auto">${ic('restore')}${t('Check again')}</button></div>
    <div class="dp-grid">
      <div class="pan" data-asm><h4>${bad ? t('With problems') : SH.tc('drivers', 'Disabled')} <em>${bad ? bad : P.disabled.length}</em></h4>
        <div class="rows dp-list">${bad ? P.errors.map(errRow).join('') + (P.disabled.length ? `<div class="dp-sub">${SH.tc('drivers', 'Disabled')}</div>${P.disabled.map(disRow).join('')}` : '') : P.disabled.length ? P.disabled.map(disRow).join('') : emptyBox(t('Nothing disabled'), t('All of your devices are active.'))}</div></div>
      <div class="pan" data-asm><h4>${t('Devices that are no longer connected')} <em id="dpGn">${P.ghosts.length}</em></h4>
        <p class="muted" style="font-size:12.5px;margin:-4px 0 10px">${t('Windows remembers every device you have ever connected (USB drives, controllers, phones). Removing them does not delete anything of yours; if you connect them again, they reinstall by themselves.')}</p>
        <div class="rows dp-list" id="dpG">${P.ghosts.length ? P.ghosts.map(ghRow).join('') : emptyBox(t('All clear'), t('There are no stored disconnected devices.'))}</div>
        ${P.ghosts.length ? `<div style="margin-top:10px;flex:none"><button class="btn sec sm" id="dpAll">${t('Remove all')}</button></div>` : ''}</div>
    </div></div>`;
  SH.assemble(el, 0, 40);
  setTimeout(() => playRing($('.dp-hero svg', el)), 300 * SH.motion());
  $('#dpRe', el).addEventListener('click', () => renderProblems(el));
  const box = $('#dpG', el); let ghostsLeft = P.ghosts.length;
  const rmOne = async row => { const r = REAL ? await SH.job('drivers', 'remove_device', [row.dataset.id]) : { ok: true }; if (needAdmin(r, t('to remove devices from Windows.'))) return false; if (!r.ok) { SH.toast(t('Windows did not remove it: {msg}', { msg: r.msg || '' })); return false; } removeRow(row, box); ghostsLeft = Math.max(0, ghostsLeft - 1); $('#dpGn', el).textContent = ghostsLeft; return true; };
  el.addEventListener('click', async e => {
    const b = e.target.closest('[data-act]'); if (!b) return; const row = b.closest('.row');
    if (b.dataset.act === 'devmgmt') { if (await SH.call('run_tool', 'devmgmt') === undefined) SH.toast(t('This only works inside the app.')); }
    else if (b.dataset.act === 'search') { SH.go('drivers', { tab: 'updates' }); setTimeout(() => { const v = $('#v-drivers'); v && v._searchDrivers && v._searchDrivers(); }, 400); }
    else if (b.dataset.act === 'enable') {
      if (REAL && !SH.state.admin) { SH.requireAdmin(t('to enable devices.')); return; }
      const r = REAL ? await SH.job('drivers', 'set_enabled', [row.dataset.id, true]) : { ok: true }; if (needAdmin(r, t('to enable devices.'))) return;
      if (r.ok) { SH.toast(t('Device enabled.')); removeRow(row, row.parentElement); } else SH.toast(t('Windows did not allow it: {msg}', { msg: r.msg || '' }));
    } else if (b.dataset.act === 'rm') {
      if (REAL && !SH.state.admin) { SH.requireAdmin(t('to remove devices from Windows.')); return; }
      if (!await ask(t('Remove the device'), t('Windows will forget <b>{name}</b>. If you connect it again, it installs again by itself.', { name: esc($('b', row).textContent) }), t('Remove'))) return;
      if (await rmOne(row)) SH.toast(t('Device removed.'));
    }
  });
  const all = $('#dpAll', el);
  if (all) all.addEventListener('click', async () => {
    if (REAL && !SH.state.admin) { SH.requireAdmin(t('to remove devices from Windows.')); return; }
    const rows = $$('.row', box); if (!await ask(rows.length === 1 ? t('Remove {n} disconnected device', { n: rows.length }) : t('Remove {n} disconnected devices', { n: rows.length }), t('Windows will forget them. Any you connect again reinstall by themselves.'), t('Remove all'))) return;
    all.disabled = true; let n = 0; for (const r of rows) { if (await rmOne(r)) n++; await wait(60); }
    SH.toast(n === 1 ? t('{n} device removed.', { n }) : t('{n} devices removed.', { n })); if (n) SH.logActivity(t('Disconnected devices removed'), { sub: n === 1 ? t('{n} device', { n }) : t('{n} devices', { n }), ic: 'usb', go: 'drivers', tab: 'problems' });
  });
}

/* ================= Backup ================= */
async function renderBackup(el) {
  const dest0 = REAL ? (await SH.engine('drivers', 'default_backup_dir')) : 'C:\\Users\\user\\Documents\\StellarHub\\Driver backups';
  let drv = []; try { drv = await DATA.drivers(); } catch { drv = []; }
  const third = new Set(drv.filter(d => !d.inbox && /^oem\d+\.inf$/i.test(d.inf || '')).map(d => d.inf.toLowerCase())).size || 187;
  el.innerHTML = `<div class="du-wrap">
    <div class="pan db-hero" data-asm>
      <div><h3>${t('Driver backup')}</h3><p>${t('Saves the {n} manufacturer drivers on this PC (NVIDIA, Intel, Realtek, ASUS…) to a folder. If you reinstall Windows or something breaks, you can reinstall them all from here without hunting for anything. The Windows drivers do not need saving: they come with Windows.', { n: third })}</p>
        <div class="db-dest"><label class="field">${ic('folder')}<input id="dbPath" value="${esc(dest0)}" spellcheck="false"></label><button class="btn sec" id="dbPick">${t('Choose…')}</button></div></div>
      <button class="btn pri lg" id="dbGo">${ic('download')}${t('Create backup')}</button>
      <div class="db-prog" id="dbProg"><div class="big"><span id="dbN">0</span><small>${t('of {total}', { total: `<span id="dbT">${third}</span>` })}</small></div><div class="w"><div class="bar"><span id="dbBar" style="transform:scaleX(0)"></span></div><div class="f" id="dbF">${t('Preparing…')}</div></div></div>
    </div>
    <div class="db-lower"><div class="pan db-list" data-asm><h4>${t('Saved backups')} <em id="dbCount">–</em></h4>
      <div class="tbl-head db-cols"><span>${t('Date')}</span><span>${t('Drivers')}</span><span>${t('Size')}</span><span>${t('Folder')}</span><span></span></div><div class="rows" id="dbRows">${skRows(2)}</div></div>
    <div class="pan db-store" data-asm><h4>${allCheck('dsAll', t('Select all old copies'))}${t('Old driver copies')} <em id="dsCount">–</em></h4>
      <p class="ds-note">${t('Previous versions Windows kept after a driver update. Only copies that a newer version replaced and no device uses (not even a disconnected one) are listed, and Windows refuses to remove anything in use.')}</p>
      <div class="rows" id="dsRows">${skRows(2)}</div>
      <div class="ds-foot" id="dsFoot" hidden><span class="muted" id="dsSum"></span><button class="btn sec" id="dsGo">${ic('trash')}${t('Remove selected')}</button></div></div></div></div>`;
  const rows = $('#dbRows', el); let LIST = [];
  const rowHTML = (b, i) => `<div class="db-row db-cols" data-i="${i}"><b style="font-weight:500">${fmtDateCol(b.date)}</b><span class="muted">${b.count}</span><span class="muted">${fmt1(b.gb)} GB</span><span class="p" title="${esc(b.path)}">${esc(b.path)}</span><span class="a"><button class="btn sm sec" data-a="restore">${ic('restore')}${t('Restore')}</button><button class="btn sm ghost" data-a="open" title="${t('Open folder')}">${ic('folder')}</button><button class="btn sm ghost" data-a="del" title="${t('Send to the Recycle Bin')}">${ic('trash')}</button></span></div>`;
  async function loadList(anim_) {
    try { LIST = await DATA.backups(); } catch { LIST = []; }
    rows.innerHTML = LIST.length ? LIST.map(rowHTML).join('') : emptyBox(t('No backups yet'), t('Create the first one with the button above. It takes a minute or two.'), 'download');
    $('#dbCount', el).textContent = LIST.length; if (anim_) stagger($$('.db-row', rows), 0, 40);
  }
  loadList(true);
  $('#dbPick', el).addEventListener('click', async () => { if (!REAL) { SH.toast(t('The folder picker only works inside the app.')); return; } const p = await SH.engine('drivers', 'pick_folder', $('#dbPath', el).value); if (p) $('#dbPath', el).value = p; });
  $('#dbGo', el).addEventListener('click', async e => {
    const btn = e.currentTarget; if (btn.disabled) return;
    if (REAL && !SH.state.admin) { SH.requireAdmin(t('to copy the system drivers (Windows requires it).')); return; }
    btn.disabled = true;
    const prog = $('#dbProg', el); prog.classList.add('on'); anim(prog, [{ opacity: 0, transform: 'translate3d(0,8px,0)' }, { opacity: 1, transform: 'none' }], { d: 380, e: EASE.spring });
    const sp = new Spring(0, 110, 18); const tk = dt => { sp.step(dt); $('#dbBar', el).style.transform = `scaleX(${sp.v.toFixed(4)})`; }; tickers.add(tk);
    let r = null;
    try {
      if (REAL) r = await SH.job('drivers', 'export', [$('#dbPath', el).value.trim() || null], { onProgress: m => { const d = m.data || {}; if (d.total) { $('#dbN', el).textContent = d.n || 0; $('#dbT', el).textContent = d.total; } if (m.text) $('#dbF', el).textContent = m.text; sp.t = m.pct || 0; } });
      else { const x = await API.exportDrivers(true, (i, t, f) => { $('#dbN', el).textContent = i; $('#dbT', el).textContent = t; $('#dbF', el).textContent = f; sp.t = i / t; }); r = { ok: true, count: x.count, gb: x.gb }; API.backups.unshift({ id: 'b' + Date.now(), date: new Date().toISOString().slice(0, 10), count: x.count, gb: x.gb, path: $('#dbPath', el).value + '\\' + new Date().toISOString().slice(0, 10) }); }
    } catch (er) { r = { ok: false, msg: er.message }; }
    await wait(400); tickers.delete(tk); btn.disabled = false;
    anim(prog, [{ opacity: 1 }, { opacity: 0 }], { d: 200 }).finished.then(() => prog.classList.remove('on')).catch(() => {});
    if (needAdmin(r, t('to copy the drivers.'))) return;
    if (!r || !r.ok) { SH.toast(t('The backup could not be created: {msg}', { msg: (r && r.msg) || t('unknown error') })); return; }
    await loadList(false); const nr = rows.firstElementChild; if (nr) { nr.classList.add('fresh'); anim(nr, [{ opacity: 0, transform: 'scale(.96)' }, { opacity: 1, transform: 'none' }], { d: 420, e: EASE.spring }); setTimeout(() => nr.classList.remove('fresh'), 2400); }
    SH.logActivity(t('Driver backup'), { sub: t('{n} drivers saved', { n: r.count }), ic: 'download', go: 'drivers', tab: 'backup' });
    SH.toast(t('Backup created: {n} drivers, {gb} GB.', { n: r.count, gb: fmt1(r.gb) }), { action: { label: t('Open folder'), run: () => REAL ? SH.engine('drivers', 'open_folder', r.path) : SH.toast(t('Only inside the app.')) } });
  });
  /* ---- old copies in the DriverStore (read-only scan; removal re-checked by the engine and refused by Windows if in use) ---- */
  const ds = $('#dsRows', el), dsSel = new Set(); let OLD = [];
  const dsRow = o => `<div class="ds-row${dsSel.has(o.inf) ? ' sel' : ''}" data-inf="${esc(o.inf)}">${CHECK.replace('class="check"', `class="check${dsSel.has(o.inf) ? ' on' : ''}"`)}
    <span class="ri">${ic(clsInfo(o.cls)[1])}</span><span class="rt"><b>${esc(o.provider)} · ${esc(o.name)}</b><span>${t('{version} ({date}), replaced by {newer} ({newerDate})', { version: esc(o.version), date: fmtDateS(o.date), newer: esc(o.newer), newerDate: fmtDateS(o.newerDate) })}</span></span>
    <span class="muted ds-mb">${o.mb >= 1 ? fmt1(o.mb) + ' MB' : '<1 MB'}</span></div>`;
  const dsSync = () => {
    const mb = OLD.filter(o => dsSel.has(o.inf)).reduce((s, o) => s + o.mb, 0);
    $('#dsSum', el).textContent = dsSel.size ? t('{n} selected · {mb} MB', { n: dsSel.size, mb: fmt1(mb) }) : t('Nothing selected');
    $('#dsGo', el).disabled = !dsSel.size; $('#dsFoot', el).hidden = !OLD.length;
    setTri($('#dsAll', el), dsSel.size, OLD.length); $('#dsAll', el).hidden = !OLD.length;
  };
  async function loadStore(fresh) {
    let r; try { r = REAL ? await SH.engine('drivers', 'store_packages', !!fresh) : API.store; } catch { r = null; }
    OLD = (r && r.old) || []; dsSel.clear(); OLD.forEach(o => dsSel.add(o.inf));
    $('#dsCount', el).textContent = OLD.length;
    ds.innerHTML = !r ? emptyBox(t('The driver store could not be read'), t('Try again in a moment.'), 'alert')
      : r.supported === false ? emptyBox(t('Not available on this Windows version'), t('It needs Windows 11 22H2 or newer.'), 'info')
      : !OLD.length ? emptyBox(t('Nothing to clean'), r.packages ? t('The {n} manufacturer driver packages in the store are all current or in use.', { n: r.packages }) : esc(r.msg || ''))
      : OLD.map(dsRow).join('');
    if (OLD.length) stagger($$('.ds-row', ds), 0, 40);
    dsSync();
  }
  loadStore(false);
  const dsAll = $('#dsAll', el);
  dsAll.addEventListener('click', () => {
    if (!OLD.length) return; const on = dsSel.size !== OLD.length; dsSel.clear(); if (on) OLD.forEach(o => dsSel.add(o.inf));
    $$('.ds-row', ds).forEach(r => { const v = dsSel.has(r.dataset.inf); r.classList.toggle('sel', v); $('.check', r).classList.toggle('on', v); });
    anim(dsAll, [{ transform: 'scale(.8)' }, { transform: 'scale(1)' }], { d: 300, e: EASE.spring }); dsSync();
  });
  dsAll.addEventListener('keydown', e => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); dsAll.click(); } });
  ds.addEventListener('click', e => {
    const row = e.target.closest('.ds-row'); if (!row) return; const k = row.dataset.inf;
    if (dsSel.has(k)) dsSel.delete(k); else dsSel.add(k);
    row.classList.toggle('sel', dsSel.has(k)); $('.check', row).classList.toggle('on', dsSel.has(k)); dsSync();
  });
  $('#dsGo', el).addEventListener('click', async e => {
    const btn = e.currentTarget; if (btn.disabled || !dsSel.size) return;
    if (REAL && !SH.state.admin) { SH.requireAdmin(t('to remove packages from the Windows driver store.')); return; }
    const pick = OLD.filter(o => dsSel.has(o.inf)), mb = pick.reduce((s, o) => s + o.mb, 0);
    const askTxt = pick.length === 1
      ? t('{n} old copy ({mb} MB) will be removed from the driver store. The current versions stay installed. Removed copies cannot be used to roll a driver back, so create a backup above first if you might want them.', { n: pick.length, mb: fmt1(mb) })
      : t('{n} old copies ({mb} MB) will be removed from the driver store. The current versions stay installed. Removed copies cannot be used to roll a driver back, so create a backup above first if you might want them.', { n: pick.length, mb: fmt1(mb) });
    if (!await ask(t('Remove old driver copies'), askTxt, t('Remove'), true)) return;
    btn.disabled = true; btn.innerHTML = `${ic('trash')}${t('Removing…')}`;
    let r;
    try { r = REAL ? await SH.job('drivers', 'delete_packages', [pick.map(o => o.inf)], { onProgress: m => { if (m.text) $('#dsSum', el).textContent = m.text; } }) : { ok: true, results: pick.map(o => ({ inf: o.inf, ok: true })), freedMb: mb }; }
    catch (er) { r = { ok: false, msg: er.message }; }
    btn.innerHTML = `${ic('trash')}${t('Remove selected')}`;
    if (needAdmin(r, t('to remove packages from the driver store.'))) { dsSync(); return; }
    const okN = ((r && r.results) || []).filter(x => x.ok).length, bad = ((r && r.results) || []).filter(x => !x.ok);
    if (!REAL) { API.store.old = API.store.old.filter(o => !dsSel.has(o.inf)); API.store.mb = 0; }
    await loadStore(true);
    const freed = fmt1((r && r.freedMb) || 0);
    if (okN) SH.logActivity(t('Old driver copies removed'), { sub: okN === 1 ? t('{n} package, {mb} MB', { n: okN, mb: freed }) : t('{n} packages, {mb} MB', { n: okN, mb: freed }), ic: 'trash', go: 'drivers', tab: 'backup' });
    SH.toast(okN ? (okN === 1 ? t('Removed {n} old copy ({mb} MB).', { n: okN, mb: freed }) : t('Removed {n} old copies ({mb} MB).', { n: okN, mb: freed })) + (bad.length ? ' ' + t('{n} kept: Windows reported them in use.', { n: bad.length }) : '')
      : bad.length ? t('Nothing was removed: {msg}', { msg: bad[0].msg }) : r && r.msg ? t('Nothing was removed: {msg}', { msg: r.msg }) : t('Nothing was removed (they are in use now).'));
  });

  rows.addEventListener('click', async e => {
    const b = e.target.closest('[data-a]'); if (!b) return; const row = b.closest('.db-row'); const bk = LIST[+row.dataset.i]; if (!bk) return;
    if (b.dataset.a === 'open') { if (!REAL || !await SH.engine('drivers', 'open_folder', bk.path)) SH.toast(REAL ? t('That folder no longer exists.') : t('Only inside the app.')); }
    if (b.dataset.a === 'restore') {
      if (REAL && !SH.state.admin) { SH.requireAdmin(t('to reinstall drivers from a backup.')); return; }
      if (!await ask(t('Reinstall from the backup'), t('The {n} drivers from the {date} backup will be installed. Any that are already the same or newer stay as they are. It may ask for a restart.', { n: bk.count, date: fmtDateS(bk.date) }), t('Reinstall'))) return;
      b.disabled = true; b.innerHTML = `${ic('restore')}${t('Reinstalling…')}`;
      try { const r = REAL ? await SH.job('drivers', 'restore_backup', [bk.path]) : { ok: true }; if (needAdmin(r, t('to reinstall drivers.'))) return; SH.toast(r.ok ? (r.reboot ? t('Backup reinstalled. Restart to finish.') : t('Backup reinstalled.')) : t('It did not work: {msg}', { msg: r.msg })); if (r.ok) { drvCache = null; SH.logActivity(t('Drivers reinstalled from a backup'), { sub: fmtDateS(bk.date), ic: 'restore', go: 'drivers', tab: 'backup' }); } }
      catch (er) { SH.toast(t('It did not work: {msg}', { msg: er.message })); }
      b.disabled = false; b.innerHTML = `${ic('restore')}${t('Restore')}`;
    }
    if (b.dataset.a === 'del') {
      if (!await ask(t('Send the backup to the Recycle Bin'), t('The {date} backup ({gb} GB) will go to the Recycle Bin. You can recover it from there.', { date: fmtDateS(bk.date), gb: fmt1(bk.gb) }), t('Send to the Recycle Bin'), true)) return;
      const r = REAL ? await SH.job('drivers', 'delete_backup', [bk.path]) : { ok: true };
      if (r && r.ok) { if (!REAL) API.backups.splice(API.backups.indexOf(bk), 1); removeRow(row, rows); $('#dbCount', el).textContent = Math.max(0, LIST.length - 1); SH.toast(t('Backup sent to the Recycle Bin.')); }
      else SH.toast(t('It did not work: {msg}', { msg: (r && r.msg) || '' }));
    }
  });
}

/* ================= History ================= */
async function renderHistory(el) {
  el.innerHTML = `<div class="pan" data-asm>${skRows(6)}</div>`;
  let H; try { H = await DATA.history(); } catch (e) { el.innerHTML = `<div class="pan">${errBox(e.message)}</div>`; return; }
  /* month headings and days in the interface language */
  const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
  const monthOf = (y, m) => cap(new Date(+y, +m - 1, 1).toLocaleDateString(LOCALE, { month: 'long', year: 'numeric' }));
  const dayOf = (y, m, d) => new Date(+y, +m - 1, +d).toLocaleDateString(LOCALE, { month: 'short', day: 'numeric' });
  if (!H.length) { el.innerHTML = `<div class="pan dh-pan">${emptyBox(t('No driver installations'), t('Windows Update has not installed any drivers on this PC yet.'), 'clock')}</div>`; return; }
  let html = `<div class="pan dh-pan" data-asm><div class="dh-note">${t('What Windows Update installed on this PC, including what it did on its own. To go back to a previous version, choose the driver in "{tab}".', { tab: t('All drivers') })}</div>`, cur = '';
  H.forEach((h, i) => {
    if (!h.date) return; const [y, m, d] = h.date.split('-'); const key = `${y}-${m}`;
    if (key !== cur) { cur = key; html += `<div class="dh-month">${monthOf(y, m)}</div>`; }
    html += `<div class="dh-row" data-h="${i}"><span class="d">${dayOf(y, m, d)}</span><span style="min-width:0"><b style="font-weight:500;display:block" title="${esc(h.title || h.name)}">${esc(h.name)}${h.cls ? `<span class="faint" style="font-weight:400"> · ${esc(h.cls)}</span>` : ''}</b><span class="faint" style="font-size:12px">${h.err ? esc(h.err) : esc(h.src)}</span></span>
      <span class="ver">${h.from ? `${esc(h.from)}${ic('arrowr')}` : ''}<b>${esc(h.to || '–')}</b></span><span>${h.ok ? `<span class="chip ok">${t('Installed')}</span>` : `<span class="chip bad">${t('Failed')}</span>`}</span><span></span></div>`;
  });
  el.innerHTML = html + '</div>';
  setTimeout(() => stagger($$('.dh-row', el).slice(0, 18), 80, 30), 10);
}

function updateDesc() {
  DATA.drivers().then(L => { const p = $('#v-drivers .mhead p'); if (p && L && L.length) p.textContent = t('Your {n} drivers, new versions from Windows Update and backups.', { n: L.length }); }).catch(() => {});
}
SH.module({
  id: 'drivers', real: true,
  enter() { if (REAL) updateDesc(); },
  actions(el, ctx) {
    el.innerHTML = `<button class="btn ghost" id="duRestore">${ic('restore')}${t('Restore points')}</button><button class="btn pri" id="duHeadSearch">${ic('search')}${t('Check for updates')}</button>`;
    $('#duHeadSearch', el).addEventListener('click', () => { ctx.setTab('updates'); setTimeout(() => { const v = $('#v-drivers'); v && v._searchDrivers && v._searchDrivers(); }, 260 * SH.motion()); });
    $('#duRestore', el).addEventListener('click', async () => { if (await SH.call('run_tool', 'rstrui') === undefined) SH.toast(t('This only works inside the app.')); });
  },
  renderTab(tab, el, ctx) {
    if (tab === 'updates') renderUpdates(el, ctx);
    else if (tab === 'all') renderAll(el);
    else if (tab === 'problems') renderProblems(el);
    else if (tab === 'backup') renderBackup(el);
    else if (tab === 'history') renderHistory(el);
  },
  enterTab(tab, el) { if (tab === 'all' || tab === 'backup') requestAnimationFrame(() => $$('.seg', el).forEach(s => SH.placeSeg(s, true))); },
});
SH.on('boot', async () => {
  const v = $('#v-drivers .subnav [data-tab="updates"] .bd'); if (!v) return;
  let n;
  if (REAL) {
    const r = (await SH.engine('drivers', 'last_search').catch(() => null)) || { updates: [] }; n = r.updates.length;
    /* Home > Needs attention: the last real search counts as a check */
    const p = (SH.state.settings.pending || {}).drivers; if (r.at && (!p || p.at < r.at * 1000)) SH.setPending('drivers', n);
  } else n = UPDATES.filter(u => !u.installed).length;
  v.hidden = !n; v.textContent = n;
});
SH.actions.add([
  { t: t('Look for new drivers on Windows Update'), go: 'drivers', tab: 'updates', ic: 'drivers' },
  { t: t('Show drivers older than 5 years'), go: 'drivers', tab: 'all', ic: 'clock' },
  { t: t('Remove devices I no longer connect'), go: 'drivers', tab: 'problems', ic: 'usb' },
  { t: t('Back up the drivers'), go: 'drivers', tab: 'backup', ic: 'download' },
  { t: t('History of installed drivers'), go: 'drivers', tab: 'history', ic: 'clock' },
]);
})();
