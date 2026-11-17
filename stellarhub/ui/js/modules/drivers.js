/* StellarHub · Driver Updater. Dentro de la app todo es real (stellarhub/engine/drivers.py): inventario de
   Win32_PnPSignedDriver, búsqueda e instalación con Windows Update, problemas, copias con pnputil, historial y
   versiones guardadas. Fuera de la app (navegador, pruebas de diseño) usa los datos de ejemplo de abajo. */
'use strict';
(() => {
const { $, $$, anim, EASE, Spring, tickers, ic, esc, fmt1 } = SH;
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
/* clases reales de Windows (DeviceClass en mayúsculas) -> nombre e icono */
const CLS = {
  DISPLAY: ['Adaptadores de pantalla', 'display'], MEDIA: ['Sonido, vídeo y juegos', 'audio'], AUDIOENDPOINT: ['Entradas y salidas de audio', 'speaker'],
  AUDIOPROCESSINGOBJECT: ['Efectos de audio', 'audio'], NET: ['Adaptadores de red', 'wifi'], BLUETOOTH: ['Bluetooth', 'bt'], SYSTEM: ['Dispositivos del sistema', 'sys'],
  PROCESSOR: ['Procesadores', 'cpu'], USB: ['Controladoras USB', 'usb'], USBDEVICE: ['Dispositivos USB', 'usb'], HIDCLASS: ['Dispositivos de interfaz humana', 'mouse'],
  KEYBOARD: ['Teclados', 'keyboard'], MOUSE: ['Ratones y punteros', 'mouse'], DISKDRIVE: ['Unidades de disco', 'ssd'], SCSIADAPTER: ['Controladoras de almacenamiento', 'ssd'],
  HDC: ['Controladoras IDE/ATA', 'ssd'], MONITOR: ['Monitores', 'display'], CAMERA: ['Cámaras', 'camera'], IMAGE: ['Dispositivos de imagen', 'camera'],
  BATTERY: ['Baterías', 'battery'], FIRMWARE: ['Firmware', 'chip'], SECURITYDEVICES: ['Dispositivos de seguridad', 'shield'], SOFTWARECOMPONENT: ['Componentes de software', 'package'],
  SOFTWAREDEVICE: ['Dispositivos de software', 'package'], PRINTQUEUE: ['Colas de impresión', 'printer'], PRINTER: ['Impresoras', 'printer'], COMPUTER: ['Equipo', 'sys'],
  VOLUME: ['Volúmenes', 'ssd'], VOLUMESNAPSHOT: ['Instantáneas de volumen', 'ssd'], EXTENSION: ['Extensiones de drivers', 'package'], MIDIENDPOINT: ['Dispositivos MIDI', 'audio'],
  SENSOR: ['Sensores', 'temp'], BIOMETRIC: ['Biometría', 'user'], PORTS: ['Puertos', 'usb'], WPD: ['Dispositivos portátiles', 'ssd'], SMARTCARDREADER: ['Lectores de tarjetas', 'lock'],
  NETSERVICE: ['Servicios de red', 'globe'], NETTRANS: ['Protocolos de red', 'globe'], NETCLIENT: ['Clientes de red', 'globe'], LEGACYDRIVER: ['Drivers heredados', 'package'],
  OTHERHARDWARE: ['Otros dispositivos', 'chip'], OTHER: ['Otros dispositivos', 'chip'], UCM: ['Conectores USB-C', 'usb'], DOT4: ['Impresión', 'printer'],
};
const clsInfo = c => CLS[(c || 'OTHER').toUpperCase()] || [(c || 'Otros').charAt(0) + (c || 'otros').slice(1).toLowerCase(), 'chip'];
const agoText = ts => { if (!ts) return 'nunca'; const s = (Date.now() - ts * 1000) / 1000; if (s < 90) return 'ahora mismo'; if (s < 3600) return `hace ${Math.round(s / 60)} min`; if (s < 86400) return `hace ${Math.round(s / 3600)} h`; const d = Math.round(s / 86400); return d === 1 ? 'ayer' : `hace ${d} días`; };

/* confirmación propia (nada de confirm()) */
function ask(title, body, ok = 'Continuar', danger = false) {
  return new Promise(res => {
    const o = document.createElement('div'); o.className = 'dq-o';
    o.innerHTML = `<div class="dq-s"></div><div class="dq" role="dialog" aria-modal="true"><h3>${esc(title)}</h3><p>${body}</p><div class="dq-a"><button class="btn ghost" data-n>Cancelar</button><button class="btn ${danger ? 'danger' : 'pri'}" data-y>${esc(ok)}</button></div></div>`;
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
const needAdmin = (r, why) => { if (r && r.needAdmin) { SH.requireAdmin(why); return true; } return false; };

/* ---------- datos simulados ---------- */
let seed = 7; const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
const pick = a => a[Math.floor(rnd() * a.length)];
const pad = n => String(n).padStart(2, '0');
const MS = { provider: 'Microsoft', version: '10.0.26100.1', date: '2006-06-21', inbox: true };
const CLASSES = [
  ['Display', 'Adaptadores de pantalla', 'display', 2], ['Media', 'Sonido, vídeo y juegos', 'audio', 6], ['AudioEndpoint', 'Entradas y salidas de audio', 'speaker', 10],
  ['Net', 'Adaptadores de red', 'wifi', 9], ['Bluetooth', 'Bluetooth', 'bt', 12], ['System', 'Dispositivos del sistema', 'sys', 98], ['Processor', 'Procesadores', 'cpu', 24],
  ['USB', 'Controladoras USB', 'usb', 26], ['HIDClass', 'Dispositivos de interfaz humana', 'mouse', 22], ['Keyboard', 'Teclados', 'keyboard', 3], ['Mouse', 'Ratones y punteros', 'mouse', 4],
  ['DiskDrive', 'Unidades de disco', 'ssd', 2], ['SCSIAdapter', 'Controladoras de almacenamiento', 'ssd', 3], ['Monitor', 'Monitores', 'display', 2], ['Camera', 'Cámaras', 'camera', 2],
  ['Battery', 'Baterías', 'battery', 3], ['Firmware', 'Firmware', 'chip', 3], ['SecurityDevices', 'Dispositivos de seguridad', 'shield', 1], ['SoftwareComponent', 'Componentes de software', 'package', 34],
  ['SoftwareDevice', 'Dispositivos de software', 'package', 22], ['PrintQueue', 'Colas de impresión', 'printer', 6], ['Computer', 'Equipo', 'sys', 1], ['Volume', 'Volúmenes', 'ssd', 8],
];
const D = (name, o = {}) => ({ name, ...(o.inbox === false || o.provider ? o : { ...MS, ...o }) });
const SPEC = {
  Display: [D('NVIDIA GeForce RTX 5070 Laptop GPU', { provider: 'NVIDIA', version: '32.0.16.1742', date: '2026-10-14', inf: 'oem41.inf', hw: 'PCI\\VEN_10DE&DEV_2F58' }), D('Intel(R) UHD Graphics', { provider: 'Intel Corporation', version: '32.0.101.7088', date: '2026-09-03', inf: 'oem38.inf', hw: 'PCI\\VEN_8086&DEV_A788' })],
  Media: [D('Realtek High Definition Audio', { provider: 'Realtek Semiconductor Corp.', version: '6.0.9733.1', date: '2025-11-20', inf: 'oem12.inf', hw: 'INTELAUDIO\\FUNC_01&VEN_10EC&DEV_0256' }), D('NVIDIA High Definition Audio', { provider: 'NVIDIA', version: '1.4.3.2', date: '2025-06-10' }),
    D('NVIDIA Virtual Audio Device (Wave Extensible) (WDM)', { provider: 'NVIDIA', version: '4.65.0.3', date: '2024-03-02' }), D('Intel(R) Smart Sound Technology for USB Audio', { provider: 'Intel Corporation', version: '10.29.0.10467', date: '2024-08-30' }),
    D('Intel(R) Smart Sound Technology BUS', { provider: 'Intel Corporation', version: '10.29.0.10467', date: '2024-08-30' }), D('Dispositivo de audio USB')],
  AudioEndpoint: ['Altavoces (Realtek(R) Audio)', 'Micrófono (Realtek(R) Audio)', 'Auriculares (Dispositivo de audio USB)', 'Micrófono (Dispositivo de audio USB)', '24E4 (NVIDIA High Definition Audio)', 'Altavoces (NVIDIA Broadcast)', 'Micrófono (NVIDIA Broadcast)', 'Mezcla estéreo (Realtek(R) Audio)', 'Altavoces (Steam Streaming Speakers)', 'Micrófono (Steam Streaming Microphone)'].map(n => D(n, { inf: 'audioendpoint.inf' })),
  Net: [D('Realtek 8852CE WiFi 6E PCI-E NIC', { provider: 'Realtek Semiconductor Corp.', version: '6001.16.159.0', date: '2025-09-12', inf: 'oem22.inf', hw: 'PCI\\VEN_10EC&DEV_C852' }), D('Realtek Gaming 2.5GbE Family Controller', { provider: 'Realtek', version: '10.68.815.2024', date: '2024-08-15' }),
    ...['IP', 'IPv6', 'L2TP', 'PPTP', 'SSTP', 'IKEv2', 'Network Monitor'].map(x => D(`WAN Miniport (${x})`, { inf: 'netrasa.inf' }))],
  Bluetooth: [D('Realtek Bluetooth 5.3 Adapter', { provider: 'Realtek Semiconductor Corp.', version: '1.10.1061.3005', date: '2025-03-04', inf: 'oem30.inf', hw: 'USB\\VID_0BDA&PID_5852' }), D('Enumerador de Bluetooth de Microsoft'), D('Enumerador de Bluetooth LE de Microsoft'), D('Dispositivo Bluetooth (protocolo RFCOMM TDI)'), D('Dispositivo Bluetooth (red de área personal)'),
    D('Galaxy Buds2 Pro'), D('Galaxy Buds2 Pro Avrcp Transport'), D('Galaxy Buds2 Pro Hands-Free'), D('Xbox Wireless Controller'), D('Servicio de control remoto de audio/vídeo'), D('Servicio de transporte AVRCP'), D('Dispositivo de entrada Bluetooth LE')],
  System: [D('Intel(R) Management Engine Interface #1', { provider: 'Intel', version: '2406.5.5.0', date: '2024-04-11', inf: 'oem15.inf', hw: 'PCI\\VEN_8086&DEV_7A68' }), D('ASUS System Control Interface v3', { provider: 'ASUSTeK Computer Inc.', version: '3.1.38.0', date: '2025-02-17', inf: 'oem9.inf', hw: 'ACPI\\ATK4002' }),
    D('Intel(R) Serial IO I2C Host Controller - 7A4C', { provider: 'Intel Corporation', version: '30.100.2405.44', date: '2024-02-05' }), D('Intel(R) Serial IO I2C Host Controller - 7A4D', { provider: 'Intel Corporation', version: '30.100.2405.44', date: '2024-02-05' }),
    D('Intel(R) Serial IO GPIO Host Controller - INTC1056', { provider: 'Intel Corporation', version: '30.100.2405.44', date: '2024-02-05' }), D('Intel(R) Dynamic Tuning Technology', { provider: 'Intel', version: '9.0.11903.47811', date: '2024-05-22' }),
    D('Intel(R) GNA Scoring Accelerator module', { provider: 'Intel Corporation', version: '3.5.0.1578', date: '2023-09-14' }), D('Intel(R) Platform Monitoring Technology (PMT) Driver', { provider: 'Intel Corporation', version: '1.0.0.12', date: '2023-06-01' }),
    D('Intel(R) SMBus - 7A23', { provider: 'INTEL', version: '10.1.19.7', date: '2023-01-12' }), D('Intel(R) SPI (flash) Controller - 7A24', { provider: 'INTEL', version: '10.1.19.7', date: '2023-01-12' }),
    D('NVIDIA Platform Controllers and Framework', { provider: 'NVIDIA', version: '32.0.15.6070', date: '2025-08-01' }),
    ...['Botón de alimentación ACPI', 'Tapa ACPI', 'Botón de suspensión ACPI', 'Zona térmica ACPI', 'Controlador programable de interrupciones', 'Temporizador de eventos de alta precisión', 'Reloj del sistema CMOS', 'Enumerador de bus de dispositivos compuestos', 'Enumerador de adaptador de pantalla virtual', 'Administrador de volúmenes', 'Interfaz de firmware UEFI', 'Controlador de memoria PCI estándar', 'Puente PCI a ISA', 'Enumerador de dispositivos de software', 'Controlador de Hyper-V'].map(n => D(n))],
  Processor: Array.from({ length: 24 }, () => D('Intel(R) Core(TM) i7-14650HX', { inf: 'cpu.inf' })),
  USB: [D('Intel(R) USB 3.20 eXtensible Host Controller - 1.20 (Microsoft)', { inf: 'usbxhci.inf' }), D('Concentrador raíz USB (USB 3.0)', { inf: 'usbhub3.inf' }), D('Intel(R) USB4 Host Router', { provider: 'Intel', version: '1.60.4.1', date: '2024-07-02' }), D('Realtek USB 2.0 Card Reader', { provider: 'Realtek Semiconductor Corp.', version: '10.0.26100.21337', date: '2024-11-05' })],
  HIDClass: [D('Intel(R) HID Event Filter', { provider: 'Intel Corporation', version: '2.2.2.1', date: '2024-01-10' }), D('ASUS Precision Touchpad', { provider: 'ASUSTeK', version: '16.0.0.32', date: '2024-03-28' }), D('Dispositivo HID de I2C'), D('Panel táctil compatible con HID'), D('Teclado HID para ASUS')],
  Keyboard: [D('Teclado HID'), D('Teclado HID'), D('Teclado PS/2 estándar')],
  Mouse: [D('Mouse compatible con HID'), D('Mouse compatible con HID'), D('Mouse compatible con HID'), D('ASUS Precision Touchpad', { provider: 'ASUSTeK', version: '16.0.0.32', date: '2024-03-28' })],
  DiskDrive: [D('WD PC SN5000S SDEQNSJ-1T00-1002', { inf: 'disk.inf' }), D('Generic- SD/MMC/MS PRO USB Device', { inf: 'disk.inf' })],
  SCSIAdapter: [D('Controladora NVM Express estándar', { inf: 'stornvme.inf' }), D('Intel(R) RST VMD Controller 9A0B', { provider: 'Intel Corporation', version: '19.5.2.1049', date: '2023-11-03' }), D('Controladora de espacios de almacenamiento de Microsoft')],
  Monitor: [D('Monitor PnP genérico (MNG007DA5)', { inf: 'monitor.inf' }), D('24E4 (monitor externo)', { inf: 'monitor.inf' })],
  Camera: [D('USB2.0 HD UVC WebCam', { provider: 'Azurewave', version: '3.4.8.1', date: '2023-07-19' }), D('USB2.0 HD IR UVC WebCam', { provider: 'Azurewave', version: '3.4.8.1', date: '2023-07-19' })],
  Battery: [D('Batería con método de control compatible con ACPI de Microsoft'), D('Adaptador de CA de Microsoft'), D('Dispositivo de batería ASUS', { provider: 'ASUSTeK', version: '1.0.0.6', date: '2024-02-20' })],
  Firmware: [D('System Firmware', { provider: 'ASUSTeK Computer Inc.', version: '312.0.0.0', date: '2026-05-07' }), D('Intel(R) Management Engine Firmware', { provider: 'Intel', version: '18.0.5.2141', date: '2024-03-01' }), D('Realtek Device Firmware', { provider: 'Realtek', version: '1.0.0.27', date: '2024-06-18' })],
  SecurityDevices: [D('Módulo de plataforma segura 2.0', { inf: 'tpm.inf' })],
  SoftwareComponent: ['Intel(R) Graphics Command Center', 'Intel(R) iCLS Client', 'Intel(R) Dynamic Application Loader Host Interface', 'Realtek Audio Effects Component', 'Realtek Audio Universal Service', 'Realtek Hardware Support Application', 'Realtek Asio Component', 'NVIDIA WMI', 'NVIDIA Broadcast Component', 'ASUS Armoury Crate Control Interface', 'ASUS Software Component', 'ASUS Optimization Interface', 'Intel(R) Innovation Platform Framework', 'Intel(R) Connectivity Network Service'].map(n => D(n, { provider: pick(['Intel Corporation', 'Realtek', 'NVIDIA', 'ASUSTeK']), version: `${1 + Math.floor(rnd() * 30)}.${Math.floor(rnd() * 10)}.${Math.floor(rnd() * 900)}.${Math.floor(rnd() * 9000)}`, date: `202${3 + Math.floor(rnd() * 3)}-${pad(1 + Math.floor(rnd() * 12))}-${pad(1 + Math.floor(rnd() * 27))}` })),
  SoftwareDevice: ['Enumerador de bus de dispositivos de radio de Microsoft', 'Enumerador raíz de asociación de dispositivos de Microsoft', 'Sintetizador de tabla de ondas GS de Microsoft', 'Dispositivo de software de Windows Hello'].map(n => D(n)),
  PrintQueue: ['Microsoft Print to PDF', 'OneNote (Desktop)', 'Fax', 'Microsoft XPS Document Writer', 'HP DeskJet 2700 series', 'Cola de impresión raíz'].map(n => D(n, { inf: 'printqueue.inf' })),
  Computer: [D('Equipo basado en x64 con ACPI', { inf: 'hal.inf' })],
  Volume: [],
};
const GEN = {
  System: i => i % 3 ? D(`Puerto raíz PCI Express #${i}`, { provider: 'INTEL', version: '10.1.19.7', date: '2023-01-12' }) : D('Recursos de placa base'),
  USB: i => D(pick(['Concentrador USB genérico', 'Dispositivo compuesto USB', 'Dispositivo de entrada USB', 'Dispositivo de almacenamiento USB', 'Controlador de dispositivo USB']) + (i > 4 ? ` (${i})` : '')),
  HIDClass: () => D(pick(['Dispositivo de control del consumidor compatible con HID', 'Dispositivo definido por el proveedor compatible con HID', 'Dispositivo de control del sistema compatible con HID', 'Dispositivo de entrada USB'])),
  SoftwareComponent: i => D(`Componente de software ${pick(['NVIDIA', 'Intel', 'Realtek', 'ASUS'])} ${i}`, { provider: pick(['NVIDIA', 'Intel Corporation', 'Realtek', 'ASUSTeK']), version: `${1 + Math.floor(rnd() * 9)}.${Math.floor(rnd() * 20)}.${Math.floor(rnd() * 999)}.0`, date: `202${2 + Math.floor(rnd() * 4)}-${pad(1 + Math.floor(rnd() * 12))}-${pad(1 + Math.floor(rnd() * 27))}` }),
  SoftwareDevice: i => D(pick(['Dispositivo de software genérico', 'Enumerador de dispositivos de software de Microsoft', 'Dispositivo de puente de Windows Mixed Reality']) + ` ${i}`),
  Volume: () => D('Volumen genérico', { inf: 'volume.inf' }),
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
const ageText = a => a == null ? 'Incluido en Windows' : a < 1 ? (a * 12 < 1 ? 'este mes' : `${Math.max(1, Math.round(a * 12))} ${Math.round(a * 12) === 1 ? 'mes' : 'meses'}`) : `${fmt1(a)} años`;
const fmtDate = s => { const [y, m, d] = s.split('-'); return `${+d} ${['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sept', 'oct', 'nov', 'dic'][+m - 1]} ${y}`; };
const byName = n => DRIVERS.find(d => d.name === n);

const UPDATES = [
  { id: 'u1', drv: 'Realtek High Definition Audio', title: 'Realtek Semiconductor Corp. - MEDIA - 6.0.9786.1', ver: '6.0.9786.1', date: '2026-10-07', mb: 62.4, reboot: true },
  { id: 'u2', drv: 'Intel(R) Management Engine Interface #1', title: 'Intel - System - 2441.6.1.0', ver: '2441.6.1.0', date: '2026-08-02', mb: 2.8, reboot: true },
  { id: 'u3', drv: 'Realtek Bluetooth 5.3 Adapter', title: 'Realtek Semiconductor Corp. - Bluetooth - 1.10.1081.3010', ver: '1.10.1081.3010', date: '2026-09-18', mb: 4.1, reboot: false },
  { id: 'u4', drv: 'ASUS System Control Interface v3', title: 'ASUSTeK Computer Inc. - System - 3.1.41.0', ver: '3.1.41.0', date: '2026-07-21', mb: 11.0, reboot: false },
].map(u => ({ ...u, d: byName(u.drv) }));

const API = {
  async lastSearch() { await wait(120); return { when: 'hace 2 días', updates: UPDATES.filter(u => !u.installed) }; },
  async search(onPhase) {
    const phases = ['Conectando con Windows Update', 'Pidiendo el catálogo de drivers para tu equipo', 'Comparando con tus 303 drivers instalados', 'Comprobando firmas y compatibilidad'];
    for (let i = 0; i < phases.length; i++) { onPhase(phases[i], i); await wait(1500 + i * 350); }
    return UPDATES.filter(u => !u.installed);
  },
  async restorePoint() { await wait(1700); return { created: true }; },
  async install(u, onProgress) {
    for (let p = 0; p <= 1.0001; p += .04 + rnd() * .06) { onProgress('download', Math.min(1, p)); await wait(60); }
    onProgress('install', 0); await wait(900 + rnd() * 900); onProgress('done', 1);
    u.installed = true; u.d.version = u.ver; u.d.date = u.date; return { ok: true, reboot: u.reboot };
  },
  backups: [
    { id: 'b2', date: '2026-10-28', count: 186, gb: 1.9, path: 'C:\\Users\\usuario\\Documents\\StellarHub\\Copias de drivers\\2026-10-28' },
    { id: 'b1', date: '2026-10-02', count: 179, gb: 1.8, path: 'C:\\Users\\usuario\\Documents\\StellarHub\\Copias de drivers\\2026-10-02' },
  ],
  async exportDrivers(thirdOnly, onFile) {
    const list = DRIVERS.filter(d => !thirdOnly || !d.inbox); const total = thirdOnly ? 187 : 303;
    for (let i = 1; i <= total; i++) { const d = list[i % list.length]; onFile(i, total, `${d.inf}  ${d.name}`); await wait(18 + rnd() * 22); }
    return { count: total, gb: thirdOnly ? 2.0 : 2.7 };
  },
  history: [
    { date: '2026-11-09', name: 'NVIDIA GeForce RTX 5070 Laptop GPU', from: '32.0.15.8157', to: '32.0.16.1742', ok: true, rp: true, src: 'Windows Update' },
    { date: '2026-11-02', name: 'Intel(R) UHD Graphics', from: '31.0.101.5590', to: '32.0.101.7088', ok: true, rp: true, src: 'Windows Update' },
    { date: '2026-10-21', name: 'Realtek 8852CE WiFi 6E PCI-E NIC', from: '6001.16.142.0', to: '6001.16.159.0', ok: true, rp: false, src: 'Windows Update' },
    { date: '2026-10-21', name: 'Realtek Bluetooth 5.3 Adapter', from: '1.10.1043.3001', to: '1.10.1061.3005', ok: false, rp: false, src: 'Windows Update', err: 'El instalador devolvió el código 0x80070103: ya había una versión igual o más nueva.' },
    { date: '2026-10-05', name: 'NVIDIA High Definition Audio', from: '1.4.2.6', to: '1.4.3.2', ok: true, rp: true, src: 'Windows Update' },
    { date: '2026-10-03', name: 'System Firmware', from: '310.0.0.0', to: '312.0.0.0', ok: true, rp: true, src: 'Windows Update' },
  ],
  ghosts: [
    { id: 'g1', name: 'SanDisk Cruzer Blade USB Device', cls: 'Unidades de disco', last: 'hace 3 semanas' },
    { id: 'g2', name: 'Xbox Wireless Controller', cls: 'Dispositivos de interfaz humana', last: 'hace 9 días' },
    { id: 'g3', name: 'HP DeskJet 2700 series (USB)', cls: 'Impresoras', last: 'hace 1 mes' },
  ],
};

/* ---------- capa de datos: motor real dentro de la app, ejemplo fuera ---------- */
const fmtDateS = s => s ? fmtDate(s.slice(0, 10)) : '–';
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
    if (!REAL) { let stop = false; const p = API.search((t, i) => !stop && onPhase(t, i)).then(r => { if (stop) throw Object.assign(new Error('cancelado'), { cancelled: true }); return r; }); p.cancel = () => { stop = true; }; return p; }
    const j = SH.job('drivers', 'search', [], { onProgress: m => { if (m.kind === 'progress') onPhase(m.text, (m.data || {}).phase, m); } });
    const p = j.then(r => (r.updates || []).map(mapUpd)); p.cancel = j.cancel; return p;
  },
  /* onStep(id, fase, datos): id = 'rp' o el id de la actualización; fase = run|download|install|done|error|skip */
  async install(todo, onStep) {
    if (!REAL) {
      onStep('rp', 'run'); await API.restorePoint(); onStep('rp', 'done'); let reboot = false;
      for (const u of todo) { const r = await API.install(u, (ph, p) => onStep(u.id, ph === 'done' ? 'done' : ph, { p })); reboot = reboot || r.reboot; onStep(u.id, 'done', { result: { ok: true, reboot: r.reboot } }); }
      return { results: todo.map(u => ({ id: u.id, ok: true, reboot: u.reboot })), reboot };
    }
    return SH.job('drivers', 'install', [todo.map(u => u.id), true], { onProgress: m => { const d = m.data || {}; if (m.kind === 'progress' && d.step) onStep(d.step, d.phase, d); } });
  },
  async problems() {
    if (!REAL) return { errors: [], disabled: [], ghosts: API.ghosts.map(g => ({ ...g, lastText: g.last })) };
    const r = await SH.engine('drivers', 'problems') || {};
    r.ghosts = (r.ghosts || []).map(g => ({ ...g, lastText: g.last ? agoText(Date.parse(g.last) / 1000) : 'hace tiempo' })); return r;
  },
  async backups() { return REAL ? (await SH.engine('drivers', 'backups') || []) : API.backups; },
  async history() {
    if (!REAL) return API.history;
    return ((await SH.engine('drivers', 'history')) || []).map(h => ({ date: (h.date || '').slice(0, 10), name: h.name, cls: h.cls, to: h.ver, from: '', ok: h.ok, src: 'Windows Update', err: h.err, title: h.title }));
  },
};

/* ---------- utilidades de interfaz ---------- */
const CHECK = '<span class="check"><svg class="i" viewBox="0 0 24 24"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg></span>';
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
const errBox = (msg, retry) => `<div class="empty"><b>No se pudo leer</b>${esc(msg)}${retry ? '<div style="margin-top:12px"><button class="btn sec sm" data-retry>Reintentar</button></div>' : ''}</div>`;

/* ================= Actualizaciones ================= */
function renderUpdates(el, ctx) {
  el.innerHTML = `<div class="du-wrap">
    <div class="pan du-hero" data-asm>
      <div class="du-radar" id="duRadar"><i style="--in:14px"></i><i style="--in:30px"></i><span class="sweep"></span><span class="core"></span></div>
      <div class="du-hero-t"><h3 id="duTitle">Cargando…</h3><p><span class="phase" id="duPhase">Solo drivers firmados por Microsoft, desde Windows Update. Sin telemetría.</span></p><div class="du-indet" id="duIndet"><span></span></div></div>
      <div class="du-hero-a"><span class="du-time" id="duTime"></span><button class="btn sec" id="duSearch">${ic('search')}Buscar de nuevo</button></div>
    </div>
    <div class="pan du-list" id="duList" data-asm></div>
    <div class="du-actbar" id="duBar" data-asm><span class="t" id="duSel"></span><button class="btn ghost" id="duNone">Quitar selección</button><button class="btn pri lg" id="duInstall">${ic('download')}Instalar</button></div>
  </div>`;
  const st = { updates: [], sel: new Set(), busy: false, searching: null };
  const list = $('#duList', el);
  function head(n, when) {
    $('#duTitle', el).textContent = when == null ? 'Busca drivers nuevos' : n ? `${n} ${n === 1 ? 'driver nuevo' : 'drivers nuevos'} para tu equipo` : 'Tus drivers están al día';
    $('#duPhase', el).textContent = when == null ? 'Todavía no has buscado. Windows Update tarda entre uno y tres minutos.' : `Última búsqueda: ${when}. Solo drivers firmados por Microsoft, desde Windows Update.`;
    ctx.setBadge('updates', n);
  }
  function rowHTML(u) {
    const d = u.d; const vtxt = u.isNew ? `Nuevo para este equipo, versión ${esc(u.ver)}` : `${esc(d.version)} a ${esc(u.ver)}`;
    return `<div class="du-row du-cols${st.sel.has(u.id) ? ' sel' : ''}" data-u="${u.id}">${CHECK.replace('class="check"', `class="check${st.sel.has(u.id) ? ' on' : ''}"`)}
      <div class="nm"><span class="ri">${ic(d.icon)}</span><div style="min-width:0"><b title="${esc(u.title || d.name)}">${esc(d.name)}</b><span>${vtxt}</span></div></div>
      <span class="c">${esc(d.clsName)}<br><span class="faint">${esc(d.provider)}</span></span><span class="c">${fmtDateS(u.date)}</span><span class="c">${fmt1(u.mb)} MB</span>
      <span>${u.reboot ? '<span class="chip warn">Pide reiniciar</span>' : '<span class="chip">Sin reinicio</span>'}</span></div>`;
  }
  function drawList(animate, never) {
    if (never) list.innerHTML = `<div class="empty"><b>Aún no has buscado</b>Pulsa «Buscar de nuevo» y StellarHub le preguntará a Windows Update qué drivers hay para tu equipo.</div>`;
    else if (!st.updates.length) list.innerHTML = `<div class="empty"><b>Nada que instalar</b>Tus drivers coinciden con lo último que ofrece Windows Update para este equipo.</div>`;
    else list.innerHTML = `<div class="tbl-head du-cols"><span class="check${st.sel.size === st.updates.length ? ' on' : ''}" id="duAll"><svg class="i" viewBox="0 0 24 24"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg></span><span>Driver</span><span>Clase</span><span>Fecha</span><span>Tamaño</span><span></span></div><div class="rows" id="duRows">${st.updates.map(rowHTML).join('')}</div>`;
    if (animate) stagger($$('.du-row', list), 60);
    syncBar();
  }
  function syncBar() {
    const mb = st.updates.filter(u => st.sel.has(u.id)).reduce((a, u) => a + u.mb, 0);
    $('#duSel', el).innerHTML = st.sel.size ? `<b>${st.sel.size} ${st.sel.size === 1 ? 'seleccionado' : 'seleccionados'}</b>, ${fmt1(mb)} MB. Se creará un punto de restauración antes de instalar.` : 'Elige los drivers que quieras instalar.';
    $('#duInstall', el).disabled = !st.sel.size || st.busy; $('#duNone', el).style.visibility = st.sel.size ? 'visible' : 'hidden';
    const bar = $('#duBar', el); bar.style.display = st.updates.length && !st.busy ? '' : 'none';
    const all = $('#duAll', el); if (all) all.classList.toggle('on', st.sel.size === st.updates.length && st.updates.length > 0);
  }
  list.addEventListener('click', e => {
    if (st.busy) return;
    if (e.target.closest('#duAll')) { if (st.sel.size === st.updates.length) st.sel.clear(); else st.updates.forEach(u => st.sel.add(u.id)); $$('.du-row', list).forEach(r => { const on = st.sel.has(r.dataset.u); r.classList.toggle('sel', on); $('.check', r).classList.toggle('on', on); }); syncBar(); return; }
    const r = e.target.closest('.du-row'); if (!r) return; const id = r.dataset.u;
    st.sel.has(id) ? st.sel.delete(id) : st.sel.add(id); r.classList.toggle('sel', st.sel.has(id)); $('.check', r).classList.toggle('on', st.sel.has(id));
    anim($('.check', r), [{ transform: 'scale(.8)' }, { transform: 'scale(1)' }], { d: 300, e: EASE.spring }); syncBar();
  });
  $('#duNone', el).addEventListener('click', () => { st.sel.clear(); drawList(false); });
  /* búsqueda (con cancelar) */
  let t0 = 0, timer = 0, lastPhase = -1;
  const sbtn = $('#duSearch', el);
  const setSearchBtn = busy => { sbtn.innerHTML = busy ? `${ic('x')}Cancelar` : `${ic('search')}Buscar de nuevo`; sbtn.classList.toggle('ghost', busy); sbtn.classList.toggle('sec', !busy); };
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
    $('#duTitle', el).textContent = 'Buscando drivers nuevos';
    st.searching = DATA.search((txt, i) => { if (i === lastPhase || !txt) return; lastPhase = i; phaseText(txt); if (i >= 2) blips(radar); });
    let res = null, err = null;
    try { res = await st.searching; } catch (e) { err = e; }
    st.searching = null; clearInterval(timer); $('#duTime', el).textContent = '';
    radar.classList.remove('on'); $('#duIndet', el).classList.remove('on'); setSearchBtn(false); st.busy = false;
    if (err) {
      if (err.cancelled) { const r = await DATA.lastSearch(); st.updates = r.updates; st.sel = new Set(st.updates.map(u => u.id)); head(st.updates.length, r.when); drawList(true, !r.at); SH.toast('Búsqueda cancelada.'); return; }
      $('#duTitle', el).textContent = 'Windows Update no respondió'; $('#duPhase', el).textContent = err.message; list.innerHTML = errBox('Comprueba tu conexión y vuelve a intentarlo. A veces Windows Update está ocupado instalando otra cosa.'); syncBar(); return;
    }
    st.updates = res || []; st.sel = new Set(st.updates.map(u => u.id)); head(st.updates.length, 'ahora mismo');
    SH.setPending('drivers', st.updates.length);
    anim($('#duTitle', el), [{ opacity: 0, transform: 'translate3d(0,8px,0)', filter: 'blur(4px)' }, { opacity: 1, transform: 'none', filter: 'blur(0px)' }], { d: 420, e: EASE.spring });
    drawList(true);
  }
  sbtn.addEventListener('click', search);
  ctx.el()._searchDrivers = () => { if (!st.busy) search(); };
  /* instalación */
  $('#duInstall', el).addEventListener('click', async () => {
    if (!st.sel.size || st.busy) return;
    if (REAL && !SH.state.admin) { SH.requireAdmin('para instalar drivers. Windows solo deja instalarlos con permisos de administrador.'); return; }
    const todo = st.updates.filter(u => st.sel.has(u.id));
    const okGo = await ask(`Instalar ${todo.length} ${todo.length === 1 ? 'driver' : 'drivers'}`,
      `Primero se crea un punto de restauración para poder volver atrás. ${todo.some(u => u.reboot) ? 'Alguno pedirá reiniciar el equipo al terminar.' : ''}`, 'Instalar');
    if (!okGo) return;
    st.busy = true; syncBar(); sbtn.disabled = true;
    $('#duTitle', el).textContent = `Instalando ${todo.length} ${todo.length === 1 ? 'driver' : 'drivers'}`; $('#duPhase', el).textContent = 'No apagues el equipo. Puedes seguir usando StellarHub.';
    $('#duRadar', el).classList.add('on');
    const steps = [{ id: 'rp', name: 'Punto de restauración', sub: 'Para volver atrás si algo sale mal' }, ...todo.map(u => ({ id: u.id, name: u.d.name, sub: `${fmt1(u.mb)} MB`, u }))];
    list.innerHTML = `<div class="du-inst">${steps.map(s => `<div class="du-step" data-s="${s.id}"><span class="st">${ic(s.id === 'rp' ? 'restore' : 'download')}</span><div><b>${esc(s.name)}</b><span class="sub">${esc(s.sub)}</span></div><div class="bar"><span style="transform:scaleX(0)"></span></div><span class="res"><span class="chip">En cola</span></span></div>`).join('')}</div>`;
    stagger($$('.du-step', list), 40, 50);
    const springs = new Map(steps.map(s => [s.id, new Spring(0, 120, 18)]));
    const tk = dt => { if (SH.state.view !== 'drivers') return; springs.forEach((sp, id) => { if (sp.idle) return; sp.step(dt); const b = $(`.du-step[data-s="${id}"] .bar>span`, list); if (b) b.style.transform = `scaleX(${sp.v.toFixed(4)})`; }); };
    tickers.add(tk);
    const setRes = (id, html, cls) => { const s = $(`.du-step[data-s="${id}"]`, list); if (!s) return; s.classList.remove('run', 'ok'); if (cls) s.classList.add(cls); const r = $('.res', s); r.innerHTML = html; anim(r, [{ opacity: 0, transform: 'scale(.8)' }, { opacity: 1, transform: 'none' }], { d: 320, e: EASE.spring }); };
    const markOk = id => { const ok = $(`.du-step[data-s="${id}"] .st`, list); if (ok) { ok.innerHTML = ic('check'); anim(ok, [{ transform: 'scale(.6)' }, { transform: 'scale(1)' }], { d: 420, e: EASE.spring }); } };
    const seen = {};
    const onStep = (id, phase, d = {}) => {
      const sp = springs.get(id); if (!sp || seen[id] === phase) return; seen[id] = phase;
      if (id === 'rp') {
        if (phase === 'run') { setRes('rp', '<span class="chip acc">Creando</span>', 'run'); sp.t = .6; }
        else if (phase === 'done') { sp.t = 1; setRes('rp', '<span class="chip ok">Creado</span>', 'ok'); markOk('rp'); }
        else if (phase === 'skip') { sp.t = 1; setRes('rp', '<span class="chip warn">No se creó</span>', 'ok'); const s = $('.du-step[data-s="rp"] .sub', list); if (s && d.msg) s.textContent = d.msg; }
        return;
      }
      if (phase === 'download') { sp.t = .35; setRes(id, '<span class="chip acc">Descargando</span>', 'run'); }
      else if (phase === 'install') { sp.t = .8; setRes(id, '<span class="chip acc">Instalando</span>', 'run'); }
      else if (phase === 'done') { sp.t = 1; const rb = d.result && d.result.reboot; setRes(id, rb ? '<span class="chip warn">Listo, pide reiniciar</span>' : '<span class="chip ok">Instalado</span>', 'ok'); markOk(id); }
      else if (phase === 'error') { sp.t = 1; setRes(id, '<span class="chip bad">Falló</span>', 'ok'); const s = $(`.du-step[data-s="${id}"] .sub`, list); if (s) s.textContent = (d.result && (d.result.msg || (d.result.hresult ? `Código 0x${d.result.hresult}` : ''))) || 'Windows Update no pudo instalarlo.'; }
    };
    let out = null, err = null;
    try { out = await DATA.install(todo, onStep); } catch (e) { err = e; }
    await wait(400); tickers.delete(tk);
    $('#duRadar', el).classList.remove('on'); st.busy = false; sbtn.disabled = false;
    if (out && out.needAdmin) { SH.requireAdmin('para instalar drivers.'); }
    const results = (out && out.results) || [];
    const okIds = new Set(results.filter(r => r.ok).map(r => r.id)); const failed = results.filter(r => !r.ok).length;
    const reboot = !!(out && out.reboot);
    st.updates = st.updates.filter(u => !okIds.has(u.id)); st.sel.clear(); head(st.updates.length, 'ahora mismo'); drvCache = null;
    if (REAL) SH.setPending('drivers', st.updates.length);
    if (okIds.size) SH.logActivity(`${okIds.size} ${okIds.size === 1 ? 'driver instalado' : 'drivers instalados'}`, { sub: todo.filter(u => okIds.has(u.id)).map(u => u.d.name).slice(0, 2).join(', '), ic: 'drivers', go: 'drivers', tab: 'history' });
    const done = document.createElement('div'); done.className = 'pan du-done';
    const ttl = err ? 'La instalación se interrumpió' : okIds.size ? `${okIds.size} ${okIds.size === 1 ? 'driver instalado' : 'drivers instalados'}${failed ? `, ${failed} con error` : ''}` : 'No se instaló ningún driver';
    done.innerHTML = `${okIds.size && !err ? ringSVG('ring') : warnSVG('ring')}<div><h3>${ttl}</h3><p>${err ? esc(err.message) : reboot ? 'Hay que reiniciar el equipo para terminar.' : okIds.size ? 'No hace falta reiniciar.' : 'Mira el motivo en cada fila.'} ${okIds.size ? 'El punto de restauración queda guardado por si quieres volver atrás.' : ''}</p></div>
      <div class="a">${reboot ? '<button class="btn ghost" data-x="later">Más tarde</button><button class="btn pri" data-x="reboot">Reiniciar en 1 minuto</button>' : '<button class="btn sec" data-x="later">Cerrar</button>'}</div>`;
    list.before(done); anim(done, [{ opacity: 0, transform: 'translate3d(0,-10px,0) scale(.97)', filter: 'blur(6px)' }, { opacity: 1, transform: 'none', filter: 'blur(0px)' }], { d: 520, e: EASE.spring }); playRing($('svg', done), 150);
    done.addEventListener('click', async e => {
      const b = e.target.closest('[data-x]'); if (!b) return;
      if (b.dataset.x === 'reboot') {
        if (REAL) await SH.engine('drivers', 'restart', 60);
        SH.toast('El equipo se reinicia en 1 minuto.', { ms: 9000, action: { label: 'Cancelar', run: async () => { if (REAL) await SH.engine('drivers', 'cancel_restart'); SH.toast('Reinicio cancelado.'); } } });
      }
      anim(done, [{ opacity: 1 }, { opacity: 0, transform: 'scale(.97)' }], { d: 220 }).finished.then(() => done.remove()).catch(() => done.remove());
    });
    drawList(true);
  });
  DATA.lastSearch().then(r => { st.updates = r.updates; st.sel = new Set(r.updates.map(u => u.id)); head(r.updates.length, r.when); drawList(true, REAL && !r.at); })
    .catch(e => { $('#duTitle', el).textContent = 'Busca drivers nuevos'; list.innerHTML = errBox(e.message); });
}

/* ================= Todos los drivers ================= */
async function renderAll(el) {
  el.classList.add('fill');
  el.innerHTML = `<div class="pan da-left" data-asm><div class="da-tools"><label class="field">${ic('search')}<input id="daQ" placeholder="Buscar un driver, fabricante o versión" spellcheck="false"></label>
      ${segHTML([['all', 'Todos'], ['2', 'Más de 2 años'], ['5', 'Más de 5 años'], ['inbox', 'De Windows'], ['bad', 'Con problemas']], 'all')}<span class="cnt" id="daCnt">Leyendo…</span></div>
      <div class="da-scroll" id="daScroll">${skRows(9)}</div></div>
    <div class="pan da-detail" id="daDetail" data-asm><div class="dd-empty"><div>${ic('drivers')}<div>Elige un driver para ver sus detalles,<br>volver a una versión anterior o deshabilitarlo.</div></div></div></div>`;
  const scroll = $('#daScroll', el); let q = '', age = 'all', selected = null, ALL = [];
  wireSeg($('.seg', el), v => { age = v; filter(); });
  async function load(fresh) {
    try { ALL = await DATA.drivers(fresh); } catch (e) { scroll.innerHTML = errBox(e.message, true); return; }
    const order = Object.keys(CLS); const keys = [...new Set(ALL.map(d => d.cls))].sort((a, b) => (order.indexOf(a.toUpperCase()) + 1 || 99) - (order.indexOf(b.toUpperCase()) + 1 || 99));
    const groups = keys.map(k => ({ key: k, label: clsInfo(k)[0], icon: clsInfo(k)[1], items: ALL.filter(d => d.cls === k) }));
    scroll.innerHTML = groups.map((g, gi) => `<div class="da-grp${gi < 2 ? ' open' : ''}" data-g="${g.key}"><button class="da-gh">${ic('chev', 'i cv')}<span class="ri">${ic(g.icon)}</span><b>${esc(g.label)}</b><span class="n">${g.items.length}</span></button>
        <div class="da-body"><div><div class="da-in">${g.items.map(d => { const a = ageOf(d); return `<button class="da-row${d.status !== 'ok' ? ' bad' : ''}" data-d="${d.id}"><span class="n1">${esc(d.name)}<small>${esc(d.provider)}${d.status === 'off' ? ', deshabilitado' : d.status === 'err' ? ', con error' : ''}</small></span><span class="v">${esc(d.version)}</span><span class="v">${d.inbox ? '–' : fmtDateS(d.date)}</span><span class="age" style="--c:${ageColor(a)}"><i></i>${ageText(a)}</span></button>`; }).join('')}</div></div></div></div>`).join('');
    $('#daCnt', el).textContent = `${ALL.length} drivers`;
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
    $('#daCnt', el).textContent = `${n} ${n === 1 ? 'driver' : 'drivers'}`;
    if (!quiet) stagger($$('.da-grp:not([hidden])', scroll).slice(0, 8), 0, 30);
  }
  let qt = 0; $('#daQ', el).addEventListener('input', e => { q = e.target.value.trim(); clearTimeout(qt); qt = setTimeout(filter, 120); });
  function detailHTML(d) {
    const a = ageOf(d);
    return `<div class="dd-in"><span class="chip">${ic(d.icon)}${esc(d.clsName)}</span><h3>${esc(d.name)}</h3><div class="who">${esc(d.provider)}</div>
      <dl><dt>Versión</dt><dd>${esc(d.version)}</dd><dt>Fecha</dt><dd>${fmtDateS(d.date)}</dd><dt>Antigüedad</dt><dd><span class="age" style="--c:${ageColor(a)}"><i></i>${ageText(a)}</span></dd><dt>Archivo INF</dt><dd>${esc(d.inf || '–')}</dd><dt>Id. de hardware</dt><dd>${esc(d.hw || '–')}</dd>
        <dt>Estado</dt><dd>${d.status === 'off' ? '<span class="chip warn">Deshabilitado</span>' : d.status === 'err' ? `<span class="chip bad">Error ${d.code}</span>` : '<span class="chip ok">Funciona bien</span>'}</dd></dl>
      ${d.inbox ? '<div class="dnote">Windows pone la fecha 21 de junio de 2006 a todos sus drivers incluidos. No significa que estén viejos: se actualizan con Windows.</div>' : a > 3 ? '<div class="dnote">Este driver tiene más de 3 años. Busca en Actualizaciones si Windows Update ofrece uno más nuevo.</div>' : ''}
      <div class="acts"><button class="btn sec" data-a="toggle">${ic('power')}${d.status === 'off' ? 'Habilitar' : 'Deshabilitar'} el dispositivo</button><button class="btn ghost" data-a="devmgmt">${ic('external')}Abrir el Administrador de dispositivos</button></div>
      <div class="dd-files" id="ddVers"><div class="faint" style="border:0">Versiones guardadas en el equipo</div>${REAL && d.instance ? '<div><span class="sk" style="height:10px;width:60%"></span></div>' : `<div><span>${esc(d.inf || '–')}</span><span class="faint">la instalada</span></div>`}</div></div>`;
  }
  async function loadVersions(d) {
    if (!REAL || !d.instance) return;
    let vs = []; try { vs = await SH.engine('drivers', 'driver_versions', d.instance) || []; } catch { vs = []; }
    if (selected !== d) return; const box = $('#ddVers', el); if (!box) return;
    box.innerHTML = `<div class="faint" style="border:0">Versiones guardadas en el equipo</div>${vs.length ? vs.map(v => `<div><span>${esc(v.version || '–')}<small class="faint"> ${esc(v.inf)}${v.original ? ` (${esc(v.original)})` : ''}</small></span>${v.installed ? '<span class="chip ok">Instalada</span>' : v.older ? `<button class="btn sm sec" data-rb="${esc(v.inf)}">${ic('restore')}Volver a esta</button>` : '<span class="faint">genérico de Windows</span>'}</div>`).join('') : '<div><span class="faint">Windows no guarda otras versiones de este driver.</span></div>'}`;
    stagger($$('div', box).slice(1), 0, 40);
  }
  function select(id, row) {
    const d = ALL.find(x => x.id === id); if (!d) return; selected = d;
    $$('.da-row.sel', scroll).forEach(x => x.classList.remove('sel')); row.classList.add('sel');
    swap($('#daDetail', el), detailHTML(d)); setTimeout(() => loadVersions(d), 200);
  }
  $('#daDetail', el).addEventListener('click', async e => {
    const b = e.target.closest('[data-a],[data-rb]'); if (!b || !selected) return; const d = selected;
    if (b.dataset.a === 'devmgmt') { if (await SH.call('run_tool', 'devmgmt') === undefined) SH.toast('Solo funciona dentro de la app.'); return; }
    if (b.dataset.rb) {
      if (REAL && !SH.state.admin) { SH.requireAdmin('para volver a la versión anterior de un driver.'); return; }
      if (!await ask('Volver a la versión anterior', `${esc(d.name)} pasará a usar el paquete <b>${esc(b.dataset.rb)}</b>. Antes se crea un punto de restauración. Puede pedir reiniciar.`, 'Volver a esta')) return;
      b.disabled = true; b.innerHTML = `${ic('restore')}Instalando…`;
      try { const r = REAL ? await SH.job('drivers', 'rollback', [d.instance, b.dataset.rb, d.hw]) : { ok: true }; if (needAdmin(r, 'para revertir un driver.')) return;
        SH.toast(r.ok ? `${d.name}: versión anterior instalada${r.reboot ? '. Reinicia para terminar.' : '.'}` : `No se pudo: ${r.msg}`); if (r.ok) { SH.logActivity('Driver revertido', { sub: d.name, ic: 'restore', go: 'drivers', tab: 'all' }); drvCache = null; await load(true); }
      } catch (er) { SH.toast(`No se pudo: ${er.message}`); }
      return;
    }
    if (b.dataset.a === 'toggle') {
      const enable = d.status === 'off';
      if (REAL && !SH.state.admin) { SH.requireAdmin('para deshabilitar o habilitar dispositivos.'); return; }
      if (!enable && !await ask('Deshabilitar el dispositivo', `${esc(d.name)} dejará de funcionar hasta que lo vuelvas a habilitar desde aquí o desde el Administrador de dispositivos.`, 'Deshabilitar', true)) return;
      const apply = async en => { const r = REAL ? await SH.job('drivers', 'set_enabled', [d.instance, en]) : { ok: true }; if (needAdmin(r, 'para deshabilitar dispositivos.')) return false; if (!r.ok) { SH.toast(`Windows no lo permitió: ${r.msg || ''}`); return false; } d.status = en ? 'ok' : 'off'; const row = $(`.da-row[data-d="${d.id}"]`, scroll); if (row && selected === d) swap($('#daDetail', el), detailHTML(d)); return true; };
      if (await apply(enable)) SH.toast(enable ? 'Dispositivo habilitado.' : 'Dispositivo deshabilitado.', { action: { label: 'Deshacer', run: () => apply(!enable) } });
    }
  });
  load(false);
}

/* ================= Problemas ================= */
async function renderProblems(el) {
  el.innerHTML = `<div class="du-wrap"><div class="pan dp-hero" data-asm>${ringSVG('ring', 'var(--accent2)')}<div><h3>Revisando tus dispositivos</h3><p>Un momento.</p></div></div><div class="dp-grid"><div class="pan" data-asm>${skRows(4)}</div><div class="pan" data-asm>${skRows(3)}</div></div></div>`;
  let P; try { P = await DATA.problems(); } catch (e) { el.innerHTML = `<div class="du-wrap"><div class="pan">${errBox(e.message)}</div></div>`; return; }
  const bad = P.errors.length;
  const errRow = x => `<div class="row" data-id="${esc(x.id)}"><span class="ri" style="color:var(--warn)">${ic('alert')}</span><span class="rt"><b>${esc(x.name)}</b><span>${esc(x.why)} Código ${x.code}.</span></span><button class="btn sm sec" data-act="search">Buscar driver</button><button class="btn sm ghost" data-act="devmgmt" title="Abrir en el Administrador de dispositivos">${ic('external')}</button></div>`;
  const disRow = x => `<div class="row" data-id="${esc(x.id)}"><span class="ri">${ic('power')}</span><span class="rt"><b>${esc(x.name)}</b><span>Deshabilitado. No funciona hasta que lo habilites.</span></span><button class="btn sm sec" data-act="enable">Habilitar</button></div>`;
  const ghRow = g => `<div class="row" data-id="${esc(g.id)}"><span class="ri">${ic(clsInfo(g.cls)[1])}</span><span class="rt"><b>${esc(g.name)}</b><span>${esc(clsInfo(g.cls)[0])}, conectado por última vez ${esc(g.lastText)}</span></span><button class="btn sm ghost" data-act="rm">Quitar</button></div>`;
  el.innerHTML = `<div class="du-wrap">
    <div class="pan dp-hero" data-asm>${bad ? warnSVG('ring') : ringSVG('ring')}<div><h3>${bad ? `${bad} ${bad === 1 ? 'dispositivo con problemas' : 'dispositivos con problemas'}` : 'Ningún dispositivo con problemas'}</h3>
      <p>${bad ? 'Abajo tienes qué le pasa a cada uno en palabras simples y qué puedes hacer.' : 'Todos los drivers cargan bien y no hay dispositivos sin driver.'} Revisado ${REAL ? 'ahora mismo' : 'hace un momento'}.</p></div>
      <button class="btn ghost sm" id="dpRe" style="margin-left:auto">${ic('restore')}Revisar otra vez</button></div>
    <div class="dp-grid">
      <div class="pan" data-asm><h4>${bad ? 'Con problemas' : 'Deshabilitados'} <em>${bad ? bad : P.disabled.length}</em></h4>
        <div class="rows dp-list">${bad ? P.errors.map(errRow).join('') + (P.disabled.length ? `<div class="dp-sub">Deshabilitados</div>${P.disabled.map(disRow).join('')}` : '') : P.disabled.length ? P.disabled.map(disRow).join('') : '<div class="empty" style="padding:20px"><b>Nada deshabilitado</b>Todos tus dispositivos están activos.</div>'}</div></div>
      <div class="pan" data-asm><h4>Dispositivos que ya no están conectados <em id="dpGn">${P.ghosts.length}</em></h4>
        <p class="muted" style="font-size:12.5px;margin:-4px 0 10px">Windows recuerda los dispositivos que conectaste alguna vez (memorias USB, mandos, móviles). Quitarlos no borra nada tuyo; si los vuelves a conectar, se reinstalan solos.</p>
        <div class="rows dp-list" id="dpG">${P.ghosts.length ? P.ghosts.map(ghRow).join('') : '<div class="empty" style="padding:20px"><b>Limpio</b>No hay dispositivos desconectados guardados.</div>'}</div>
        ${P.ghosts.length ? '<div style="margin-top:10px;flex:none"><button class="btn sec sm" id="dpAll">Quitar todos</button></div>' : ''}</div>
    </div></div>`;
  SH.assemble(el, 0, 40);
  setTimeout(() => playRing($('.dp-hero svg', el)), 300 * SH.motion());
  $('#dpRe', el).addEventListener('click', () => renderProblems(el));
  const box = $('#dpG', el);
  const rmOne = async row => { const r = REAL ? await SH.job('drivers', 'remove_device', [row.dataset.id]) : { ok: true }; if (needAdmin(r, 'para quitar dispositivos de Windows.')) return false; if (!r.ok) { SH.toast(`Windows no lo quitó: ${r.msg || ''}`); return false; } removeRow(row, box); const n = $('#dpGn', el); n.textContent = Math.max(0, +n.textContent - 1); return true; };
  el.addEventListener('click', async e => {
    const b = e.target.closest('[data-act]'); if (!b) return; const row = b.closest('.row');
    if (b.dataset.act === 'devmgmt') { if (await SH.call('run_tool', 'devmgmt') === undefined) SH.toast('Solo funciona dentro de la app.'); }
    else if (b.dataset.act === 'search') { SH.go('drivers', { tab: 'updates' }); setTimeout(() => { const v = $('#v-drivers'); v && v._searchDrivers && v._searchDrivers(); }, 400); }
    else if (b.dataset.act === 'enable') {
      if (REAL && !SH.state.admin) { SH.requireAdmin('para habilitar dispositivos.'); return; }
      const r = REAL ? await SH.job('drivers', 'set_enabled', [row.dataset.id, true]) : { ok: true }; if (needAdmin(r, 'para habilitar dispositivos.')) return;
      if (r.ok) { SH.toast('Dispositivo habilitado.'); removeRow(row, row.parentElement); } else SH.toast(`Windows no lo permitió: ${r.msg || ''}`);
    } else if (b.dataset.act === 'rm') {
      if (REAL && !SH.state.admin) { SH.requireAdmin('para quitar dispositivos de Windows.'); return; }
      if (!await ask('Quitar el dispositivo', `Windows olvidará <b>${esc($('b', row).textContent)}</b>. Si lo vuelves a conectar, se instala otra vez solo.`, 'Quitar')) return;
      if (await rmOne(row)) SH.toast('Dispositivo quitado.');
    }
  });
  const all = $('#dpAll', el);
  if (all) all.addEventListener('click', async () => {
    if (REAL && !SH.state.admin) { SH.requireAdmin('para quitar dispositivos de Windows.'); return; }
    const rows = $$('.row', box); if (!await ask(`Quitar ${rows.length} dispositivos desconectados`, 'Windows los olvidará. Los que vuelvas a conectar se reinstalan solos.', 'Quitar todos')) return;
    all.disabled = true; let n = 0; for (const r of rows) { if (await rmOne(r)) n++; await wait(60); }
    SH.toast(`${n} ${n === 1 ? 'dispositivo quitado' : 'dispositivos quitados'}.`); if (n) SH.logActivity('Dispositivos desconectados quitados', { sub: `${n} dispositivos`, ic: 'usb', go: 'drivers', tab: 'problems' });
  });
}

/* ================= Copia de seguridad ================= */
async function renderBackup(el) {
  const dest0 = REAL ? (await SH.engine('drivers', 'default_backup_dir')) : 'C:\\Users\\usuario\\Documents\\StellarHub\\Copias de drivers';
  let drv = []; try { drv = await DATA.drivers(); } catch { drv = []; }
  const third = new Set(drv.filter(d => !d.inbox && /^oem\d+\.inf$/i.test(d.inf || '')).map(d => d.inf.toLowerCase())).size || 187;
  el.innerHTML = `<div class="du-wrap">
    <div class="pan db-hero" data-asm>
      <div><h3>Copia de seguridad de los drivers</h3><p>Guarda en una carpeta los ${third} drivers de fabricantes de este equipo (NVIDIA, Intel, Realtek, ASUS…). Si formateas o algo falla, los reinstalas todos desde aquí sin buscar nada. Los de Windows no hace falta guardarlos: vienen con Windows.</p>
        <div class="db-dest"><label class="field">${ic('folder')}<input id="dbPath" value="${esc(dest0)}" spellcheck="false"></label><button class="btn sec" id="dbPick">Cambiar</button></div></div>
      <button class="btn pri lg" id="dbGo">${ic('download')}Crear copia</button>
      <div class="db-prog" id="dbProg"><div class="big"><span id="dbN">0</span><small>de <span id="dbT">${third}</span></small></div><div class="w"><div class="bar"><span id="dbBar" style="transform:scaleX(0)"></span></div><div class="f" id="dbF">Preparando…</div></div></div>
    </div>
    <div class="pan" data-asm><h4>Copias guardadas <em id="dbCount">–</em></h4>
      <div class="tbl-head db-cols"><span>Fecha</span><span>Drivers</span><span>Tamaño</span><span>Carpeta</span><span></span></div><div class="rows" id="dbRows">${skRows(2)}</div></div></div>`;
  const rows = $('#dbRows', el); let LIST = [];
  const rowHTML = (b, i) => `<div class="db-row db-cols" data-i="${i}"><b style="font-weight:500">${fmtDateS(b.date)}</b><span class="muted">${b.count}</span><span class="muted">${fmt1(b.gb)} GB</span><span class="p" title="${esc(b.path)}">${esc(b.path)}</span><span class="a"><button class="btn sm sec" data-a="restore">${ic('restore')}Restaurar</button><button class="btn sm ghost" data-a="open" title="Abrir carpeta">${ic('folder')}</button><button class="btn sm ghost" data-a="del" title="Mandar a la papelera">${ic('trash')}</button></span></div>`;
  async function loadList(anim_) {
    try { LIST = await DATA.backups(); } catch { LIST = []; }
    rows.innerHTML = LIST.length ? LIST.map(rowHTML).join('') : '<div class="empty" style="padding:24px"><b>Todavía no hay copias</b>Crea la primera con el botón de arriba. Tarda uno o dos minutos.</div>';
    $('#dbCount', el).textContent = LIST.length; if (anim_) stagger($$('.db-row', rows), 0, 40);
  }
  loadList(true);
  $('#dbPick', el).addEventListener('click', async () => { if (!REAL) { SH.toast('El selector de carpetas solo funciona dentro de la app.'); return; } const p = await SH.engine('drivers', 'pick_folder', $('#dbPath', el).value); if (p) $('#dbPath', el).value = p; });
  $('#dbGo', el).addEventListener('click', async e => {
    const btn = e.currentTarget; if (btn.disabled) return;
    if (REAL && !SH.state.admin) { SH.requireAdmin('para copiar los drivers del sistema (Windows lo exige).'); return; }
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
    if (needAdmin(r, 'para copiar los drivers.')) return;
    if (!r || !r.ok) { SH.toast(`La copia no se pudo crear: ${(r && r.msg) || 'error desconocido'}`); return; }
    await loadList(false); const nr = rows.firstElementChild; if (nr) { nr.classList.add('fresh'); anim(nr, [{ opacity: 0, transform: 'scale(.96)' }, { opacity: 1, transform: 'none' }], { d: 420, e: EASE.spring }); setTimeout(() => nr.classList.remove('fresh'), 2400); }
    SH.logActivity('Copia de los drivers', { sub: `${r.count} drivers guardados`, ic: 'download', go: 'drivers', tab: 'backup' });
    SH.toast(`Copia creada: ${r.count} drivers, ${fmt1(r.gb)} GB.`, { action: { label: 'Abrir carpeta', run: () => REAL ? SH.engine('drivers', 'open_folder', r.path) : SH.toast('Solo dentro de la app.') } });
  });
  rows.addEventListener('click', async e => {
    const b = e.target.closest('[data-a]'); if (!b) return; const row = b.closest('.db-row'); const bk = LIST[+row.dataset.i]; if (!bk) return;
    if (b.dataset.a === 'open') { if (!REAL || !await SH.engine('drivers', 'open_folder', bk.path)) SH.toast(REAL ? 'Esa carpeta ya no existe.' : 'Solo dentro de la app.'); }
    if (b.dataset.a === 'restore') {
      if (REAL && !SH.state.admin) { SH.requireAdmin('para reinstalar drivers desde una copia.'); return; }
      if (!await ask('Reinstalar desde la copia', `Se instalarán los ${bk.count} drivers de la copia del ${fmtDateS(bk.date)}. Los que ya estén igual o más nuevos no cambian. Puede pedir reiniciar.`, 'Reinstalar')) return;
      b.disabled = true; b.innerHTML = `${ic('restore')}Reinstalando…`;
      try { const r = REAL ? await SH.job('drivers', 'restore_backup', [bk.path]) : { ok: true }; if (needAdmin(r, 'para reinstalar drivers.')) return; SH.toast(r.ok ? `Copia reinstalada${r.reboot ? '. Reinicia para terminar.' : '.'}` : `No se pudo: ${r.msg}`); if (r.ok) { drvCache = null; SH.logActivity('Drivers reinstalados desde copia', { sub: fmtDateS(bk.date), ic: 'restore', go: 'drivers', tab: 'backup' }); } }
      catch (er) { SH.toast(`No se pudo: ${er.message}`); }
      b.disabled = false; b.innerHTML = `${ic('restore')}Restaurar`;
    }
    if (b.dataset.a === 'del') {
      if (!await ask('Mandar la copia a la papelera', `La copia del ${fmtDateS(bk.date)} (${fmt1(bk.gb)} GB) irá a la papelera de reciclaje. Desde ahí la puedes recuperar.`, 'Mandar a la papelera', true)) return;
      const r = REAL ? await SH.job('drivers', 'delete_backup', [bk.path]) : { ok: true };
      if (r && r.ok) { if (!REAL) API.backups.splice(API.backups.indexOf(bk), 1); removeRow(row, rows); $('#dbCount', el).textContent = Math.max(0, LIST.length - 1); SH.toast('Copia enviada a la papelera.'); }
      else SH.toast(`No se pudo: ${(r && r.msg) || ''}`);
    }
  });
}

/* ================= Historial ================= */
async function renderHistory(el) {
  el.innerHTML = `<div class="pan" data-asm>${skRows(6)}</div>`;
  let H; try { H = await DATA.history(); } catch (e) { el.innerHTML = `<div class="pan">${errBox(e.message)}</div>`; return; }
  const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  if (!H.length) { el.innerHTML = '<div class="pan"><div class="empty"><b>Sin instalaciones de drivers</b>Windows Update todavía no ha instalado drivers en este equipo.</div></div>'; return; }
  let html = `<div class="pan dh-pan" data-asm><div class="dh-note">Lo que Windows Update instaló en este equipo, incluido lo que hizo por su cuenta. Para volver a una versión anterior, elige el driver en «Todos los drivers».</div>`, cur = '';
  H.forEach((h, i) => {
    if (!h.date) return; const [y, m, d] = h.date.split('-'); const key = `${MONTHS[+m - 1]} de ${y}`;
    if (key !== cur) { cur = key; html += `<div class="dh-month">${key[0].toUpperCase() + key.slice(1)}</div>`; }
    html += `<div class="dh-row" data-h="${i}"><span class="d">${+d} ${MONTHS[+m - 1].slice(0, 3)}</span><span style="min-width:0"><b style="font-weight:500;display:block" title="${esc(h.title || h.name)}">${esc(h.name)}${h.cls ? `<span class="faint" style="font-weight:400"> · ${esc(h.cls)}</span>` : ''}</b><span class="faint" style="font-size:12px">${h.err ? esc(h.err) : esc(h.src)}</span></span>
      <span class="ver">${h.from ? `${esc(h.from)}${ic('arrowr')}` : ''}<b>${esc(h.to || '–')}</b></span><span>${h.ok ? '<span class="chip ok">Instalado</span>' : '<span class="chip bad">Falló</span>'}</span><span></span></div>`;
  });
  el.innerHTML = html + '</div>';
  setTimeout(() => stagger($$('.dh-row', el).slice(0, 18), 80, 30), 10);
}

function updateDesc() {
  DATA.drivers().then(L => { const p = $('#v-drivers .mhead p'); if (p && L && L.length) p.textContent = `Tus ${L.length} drivers, las versiones nuevas de Windows Update y copias de seguridad.`; }).catch(() => {});
}
SH.module({
  id: 'drivers', real: true,
  enter() { if (REAL) updateDesc(); },
  actions(el, ctx) {
    el.innerHTML = `<button class="btn ghost" id="duRestore">${ic('restore')}Puntos de restauración</button><button class="btn pri" id="duHeadSearch">${ic('search')}Buscar actualizaciones</button>`;
    $('#duHeadSearch', el).addEventListener('click', () => { ctx.setTab('updates'); setTimeout(() => { const v = $('#v-drivers'); v && v._searchDrivers && v._searchDrivers(); }, 260 * SH.motion()); });
    $('#duRestore', el).addEventListener('click', async () => { if (await SH.call('run_tool', 'rstrui') === undefined) SH.toast('Solo funciona dentro de la app.'); });
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
    /* Inicio > Por revisar: la última búsqueda real cuenta como revisión */
    const p = (SH.state.settings.pending || {}).drivers; if (r.at && (!p || p.at < r.at * 1000)) SH.setPending('drivers', n);
  } else n = UPDATES.filter(u => !u.installed).length;
  v.hidden = !n; v.textContent = n;
});
SH.actions.add([
  { t: 'Buscar drivers nuevos en Windows Update', go: 'drivers', tab: 'updates', ic: 'drivers' },
  { t: 'Ver drivers con más de 5 años', go: 'drivers', tab: 'all', ic: 'clock' },
  { t: 'Quitar dispositivos que ya no conecto', go: 'drivers', tab: 'problems', ic: 'usb' },
  { t: 'Copia de seguridad de los drivers', go: 'drivers', tab: 'backup', ic: 'download' },
  { t: 'Historial de drivers instalados', go: 'drivers', tab: 'history', ic: 'clock' },
]);
})();
