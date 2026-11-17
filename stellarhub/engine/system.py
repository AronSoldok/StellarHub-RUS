"""Información real del equipo: modelo, tipo, componentes, pantallas y cifras de Inicio.
pc_info() responde al momento con lo guardado de la última vez y refresca en segundo plano."""
import ctypes
import json
import os
import threading
import time
import winreg
from ctypes import wintypes

import psutil

from .ps import ps_json

EXPORTS = {"pc_info", "pc_info_fresh", "displays", "screen_thumb", "counts", "health"}


def health():
    """Resumen real para Inicio: antivirus, dispositivos con error y último punto de restauración."""
    r = ps_json(r"""
$mp = Get-MpComputerStatus -ErrorAction SilentlyContinue
$err = @(Get-CimInstance Win32_PnPEntity -Filter 'ConfigManagerErrorCode<>0' -ErrorAction SilentlyContinue | Where-Object { $_.ConfigManagerErrorCode -ne 22 })
$rp = $null; try { $rp = Get-ComputerRestorePoint -ErrorAction Stop | Sort-Object SequenceNumber | Select-Object -Last 1 } catch {}
$av = @(Get-CimInstance -Namespace root\SecurityCenter2 AntiVirusProduct -ErrorAction SilentlyContinue | ForEach-Object { $_.displayName })
[pscustomobject]@{
  defender = if ($mp) { [bool]$mp.RealTimeProtectionEnabled } else { $null }
  sigAge = if ($mp) { $mp.AntivirusSignatureAge } else { $null }
  antivirus = $av
  deviceErrors = $err.Count
  errorNames = @($err | Select-Object -First 5 | ForEach-Object { $_.Name })
  restore = if ($rp) { $rp.ConvertToDateTime($rp.CreationTime).ToString('o') } else { $null }
  restoreAccess = [bool]([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}""", timeout=40) or {}
    return r

_CACHE = os.path.join(os.environ.get("ProgramData", r"C:\ProgramData"), "StellarHub", "pcinfo.json")
_lock = threading.Lock()
_mem = None

CHASSIS = {  # Win32_SystemEnclosure.ChassisTypes
    3: ("desktop", "PC de sobremesa"), 4: ("desktop", "PC de sobremesa"), 5: ("desktop", "PC de sobremesa"),
    6: ("desktop", "Mini torre"), 7: ("desktop", "Torre"), 8: ("laptop", "Portátil"), 9: ("laptop", "Portátil"),
    10: ("laptop", "Portátil"), 11: ("laptop", "Portátil de mano"), 13: ("aio", "Todo en uno"), 14: ("laptop", "Portátil"),
    15: ("desktop", "PC compacto"), 16: ("desktop", "PC compacto"), 30: ("tablet", "Tablet"), 31: ("laptop", "Convertible"),
    32: ("laptop", "Desmontable"), 34: ("desktop", "PC empotrado"), 35: ("desktop", "Mini PC"), 36: ("desktop", "Stick PC"),
}
PNP_VENDORS = {
    "AUO": "AU Optronics", "BOE": "BOE", "CMN": "Chimei Innolux", "SDC": "Samsung Display", "LGD": "LG Display",
    "SHP": "Sharp", "IVO": "InfoVision", "CSO": "CSOT", "MNG": "CSOT", "NCP": "Nanjing CEC", "AOC": "AOC", "DEL": "Dell",
    "SAM": "Samsung", "SEC": "Samsung", "GSM": "LG", "ACR": "Acer", "ACI": "ASUS", "AUS": "ASUS", "BNQ": "BenQ",
    "HWP": "HP", "HPN": "HP", "LEN": "Lenovo", "MSI": "MSI", "VSC": "ViewSonic", "PHL": "Philips", "GBT": "Gigabyte",
    "AOU": "AOC", "HKC": "HKC", "CSW": "CSOT", "KOS": "KOORUI", "XMI": "Xiaomi", "HSD": "HannStar", "ENC": "Eizo", "NEC": "NEC",
}
GB = 1024 ** 3


def _virtual(maker, model):
    s = f"{maker} {model}".lower()
    for k in ("virtualbox", "vmware", "virtual machine", "qemu", "kvm", "parallels", "hyper-v", "xen"):
        if k in s:
            return True
    return False


SCRIPT = r"""
$cs = Get-CimInstance Win32_ComputerSystem; $en = Get-CimInstance Win32_SystemEnclosure; $os = Get-CimInstance Win32_OperatingSystem
$cpu = Get-CimInstance Win32_Processor | Select-Object -First 1; $bios = Get-CimInstance Win32_BIOS
$disp = (Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion')
$mons = @(Get-CimInstance -Namespace root\wmi WmiMonitorID -ErrorAction SilentlyContinue | ForEach-Object {
  $n = ($_.UserFriendlyName | Where-Object {$_}) ; $m = ($_.ManufacturerName | Where-Object {$_}); $c = ($_.ProductCodeID | Where-Object {$_})
  [pscustomobject]@{ inst=$_.InstanceName; name=(-join ($n | ForEach-Object {[char]$_})); maker=(-join ($m | ForEach-Object {[char]$_})); code=(-join ($c | ForEach-Object {[char]$_})) } })
$sizes = @(Get-CimInstance -Namespace root\wmi WmiMonitorBasicDisplayParams -ErrorAction SilentlyContinue | ForEach-Object { [pscustomobject]@{ inst=$_.InstanceName; w=$_.MaxHorizontalImageSize; h=$_.MaxVerticalImageSize } })
$conn = @(Get-CimInstance -Namespace root\wmi WmiMonitorConnectionParams -ErrorAction SilentlyContinue | ForEach-Object { [pscustomobject]@{ inst=$_.InstanceName; tech=$_.VideoOutputTechnology } })
[pscustomobject]@{
  maker=$cs.Manufacturer; model=$cs.Model; family=$cs.SystemFamily; chassis=@($en.ChassisTypes); pcType=$cs.PCSystemType
  os=$os.Caption; osVer=$disp.DisplayVersion; build=$os.BuildNumber; ubr=$disp.UBR; installDate=$os.InstallDate
  bios=$bios.SMBIOSBIOSVersion; biosDate=$bios.ReleaseDate; board=(Get-CimInstance Win32_BaseBoard).Product
  cpu=[pscustomobject]@{ name=$cpu.Name.Trim(); cores=$cpu.NumberOfCores; threads=$cpu.NumberOfLogicalProcessors; maxMhz=$cpu.MaxClockSpeed; l2=$cpu.L2CacheSize; l3=$cpu.L3CacheSize; socket=$cpu.SocketDesignation }
  gpus=@(Get-CimInstance Win32_VideoController | ForEach-Object { [pscustomobject]@{ name=$_.Name; driver=$_.DriverVersion; driverDate=$_.DriverDate; ram=$_.AdapterRAM; w=$_.CurrentHorizontalResolution; h=$_.CurrentVerticalResolution; hz=$_.CurrentRefreshRate } })
  ram=@(Get-CimInstance Win32_PhysicalMemory | ForEach-Object { [pscustomobject]@{ cap=$_.Capacity; speed=$_.Speed; maker=$_.Manufacturer; part=$_.PartNumber.Trim(); slot=$_.DeviceLocator; type=$_.SMBIOSMemoryType } })
  slots=(Get-CimInstance Win32_PhysicalMemoryArray | Measure-Object -Property MemoryDevices -Sum).Sum
  disks=@(Get-PhysicalDisk | ForEach-Object { [pscustomobject]@{ name=$_.FriendlyName; media="$($_.MediaType)"; bus="$($_.BusType)"; size=$_.Size; health="$($_.HealthStatus)" } })
  nets=@(Get-NetAdapter -Physical -ErrorAction SilentlyContinue | Where-Object Status -eq 'Up' | ForEach-Object { [pscustomobject]@{ name=$_.InterfaceDescription; speed=$_.LinkSpeed; media="$($_.PhysicalMediaType)" } })
  audio=@(Get-CimInstance Win32_SoundDevice | Where-Object { $_.Status -eq 'OK' } | ForEach-Object { $_.Name })
  monitors=$mons; monSizes=$sizes; monConn=$conn
}
"""


def _clean(s):
    return (s or "").replace("(R)", "").replace("(TM)", "").replace("(tm)", "").replace("  ", " ").strip()


def _gpu_vram(name):
    # AdapterRAM se queda en 4 GB por ser de 32 bits: para NVIDIA se pregunta a nvidia-smi
    if "nvidia" in name.lower():
        try:
            import subprocess
            out = subprocess.run(["nvidia-smi", "--query-gpu=memory.total", "--format=csv,noheader,nounits"],
                                 capture_output=True, text=True, timeout=5, creationflags=0x08000000).stdout.strip()
            return round(int(out.splitlines()[0]) / 1024)
        except Exception:
            return None
    return None


def _programs_count():
    seen = set()
    for hive, path in ((winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall"),
                       (winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall"),
                       (winreg.HKEY_CURRENT_USER, r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall")):
        try:
            with winreg.OpenKey(hive, path) as k:
                for i in range(winreg.QueryInfoKey(k)[0]):
                    try:
                        with winreg.OpenKey(k, winreg.EnumKey(k, i)) as s:
                            name = winreg.QueryValueEx(s, "DisplayName")[0]
                            try:
                                if winreg.QueryValueEx(s, "SystemComponent")[0] == 1:
                                    continue
                            except OSError:
                                pass
                            seen.add(name.strip().lower())
                    except OSError:
                        pass
        except OSError:
            pass
    return len(seen)


def _drivers_count():
    d = ps_json("(Get-CimInstance Win32_PnPSignedDriver | Where-Object { $_.DeviceName -and $_.DriverVersion }).Count", timeout=60)
    return d if isinstance(d, int) else None


def counts():
    du = psutil.disk_usage("C:\\")
    return {"programs": _programs_count(), "drivers": _drivers_count(), "freeC": round(du.free / GB)}


def displays():
    """Pantallas conectadas con su posición real (para capturas) y frecuencia."""
    user32 = ctypes.windll.user32
    out = []

    class MONITORINFOEX(ctypes.Structure):
        _fields_ = [("cbSize", wintypes.DWORD), ("rcMonitor", wintypes.RECT), ("rcWork", wintypes.RECT),
                    ("dwFlags", wintypes.DWORD), ("szDevice", wintypes.WCHAR * 32)]

    class DEVMODE(ctypes.Structure):
        _fields_ = [("dmDeviceName", wintypes.WCHAR * 32), ("dmSpecVersion", wintypes.WORD), ("dmDriverVersion", wintypes.WORD),
                    ("dmSize", wintypes.WORD), ("dmDriverExtra", wintypes.WORD), ("dmFields", wintypes.DWORD),
                    ("dmPositionX", ctypes.c_long), ("dmPositionY", ctypes.c_long), ("dmDisplayOrientation", wintypes.DWORD),
                    ("dmDisplayFixedOutput", wintypes.DWORD), ("dmColor", ctypes.c_short), ("dmDuplex", ctypes.c_short),
                    ("dmYResolution", ctypes.c_short), ("dmTTOption", ctypes.c_short), ("dmCollate", ctypes.c_short),
                    ("dmFormName", wintypes.WCHAR * 32), ("dmLogPixels", wintypes.WORD), ("dmBitsPerPel", wintypes.DWORD),
                    ("dmPelsWidth", wintypes.DWORD), ("dmPelsHeight", wintypes.DWORD), ("dmDisplayFlags", wintypes.DWORD),
                    ("dmDisplayFrequency", wintypes.DWORD)]

    def cb(hmon, hdc, rect, data):
        mi = MONITORINFOEX()
        mi.cbSize = ctypes.sizeof(mi)
        user32.GetMonitorInfoW(hmon, ctypes.byref(mi))
        dm = DEVMODE()
        dm.dmSize = ctypes.sizeof(dm)
        user32.EnumDisplaySettingsW(mi.szDevice, -1, ctypes.byref(dm))  # ENUM_CURRENT_SETTINGS
        r = mi.rcMonitor
        out.append({"device": mi.szDevice, "x": dm.dmPositionX, "y": dm.dmPositionY, "w": dm.dmPelsWidth, "h": dm.dmPelsHeight,
                    "hz": dm.dmDisplayFrequency, "primary": bool(mi.dwFlags & 1), "lw": r.right - r.left, "lh": r.bottom - r.top})
        return True
    proto = ctypes.WINFUNCTYPE(ctypes.c_int, wintypes.HMONITOR, wintypes.HDC, ctypes.POINTER(wintypes.RECT), wintypes.LPARAM)
    user32.EnumDisplayMonitors(None, None, proto(cb), 0)
    return out


def screen_thumb(index=0, width=480):
    """Miniatura JPEG (data URL) de lo que se ve ahora en esa pantalla."""
    import base64
    import io
    from PIL import ImageGrab
    mons = displays()
    if not mons:
        return None
    m = mons[max(0, min(int(index), len(mons) - 1))]
    img = ImageGrab.grab(bbox=(m["x"], m["y"], m["x"] + m["w"], m["y"] + m["h"]), all_screens=True)
    width = max(120, min(960, int(width)))
    img.thumbnail((width, width), resample=3)
    buf = io.BytesIO()
    img.convert("RGB").save(buf, "JPEG", quality=70)
    return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()


def _build():
    r = ps_json(SCRIPT, timeout=90) or {}
    maker, model = (r.get("maker") or "").strip(), (r.get("model") or "").strip()
    family = (r.get("family") or "").strip()
    ch = (r.get("chassis") or [0])[0] if r.get("chassis") else 0
    ptype, pname = CHASSIS.get(ch, ("laptop" if r.get("pcType") == 2 else "desktop",
                                    "Portátil" if r.get("pcType") == 2 else "PC de sobremesa"))
    if _virtual(maker, model):
        ptype, pname = "virtual", "Máquina virtual"
    nice = family if family and family.lower() not in ("to be filled by o.e.m.", "default string", "") else model
    BRANDS = {"asustek": "ASUS", "hewlett-packard": "HP", "hp": "HP", "lenovo": "Lenovo", "dell": "Dell", "acer": "Acer",
              "micro-star": "MSI", "msi": "MSI", "gigabyte": "Gigabyte", "samsung": "Samsung", "microsoft": "Microsoft",
              "apple": "Apple", "razer": "Razer", "huawei": "Huawei", "xiaomi": "Xiaomi", "lg": "LG", "toshiba": "Toshiba"}
    first = (maker.split() or [""])[0].lower().strip(",.")
    brand = BRANDS.get(first, maker.split()[0].title() if maker else "")
    if brand and not nice.lower().startswith(brand.lower()):
        nice = f"{brand} {nice}"
    code = model.split("_")[-1] if "_" in model else (model if model != nice else "")
    osname = (r.get("os") or "Windows").replace("Microsoft ", "").strip()
    os_full = f"{osname} {r.get('osVer') or ''}".strip()
    cpu = r.get("cpu") or {}
    gpus = [g for g in (r.get("gpus") or []) if g.get("name")]
    dgpu = next((g for g in gpus if any(k in g["name"].lower() for k in ("nvidia", "radeon rx", "arc"))), gpus[0] if gpus else {})
    igpu = next((g for g in gpus if g is not dgpu), None)
    rams = r.get("ram") or []
    ram_total = sum(int(m.get("cap") or 0) for m in rams)
    ram_speed = max((int(m.get("speed") or 0) for m in rams), default=0)
    ram_type = {34: "DDR5", 26: "DDR4", 24: "DDR3", 35: "LPDDR5", 30: "LPDDR4"}.get((rams[0].get("type") if rams else 0), "")
    slots = int(r.get("slots") or len(rams) or 1)
    disks = r.get("disks") or []
    sysd = disks[0] if disks else {}
    du = psutil.disk_usage("C:\\")
    nets = r.get("nets") or []
    net = nets[0] if nets else {}
    audio = r.get("audio") or []
    # pantallas: nombre comercial a partir de WMI + tamaño en pulgadas
    sizes = {s["inst"]: s for s in (r.get("monSizes") or [])}
    conn = {c["inst"]: c.get("tech") for c in (r.get("monConn") or [])}
    mons = []
    for m in r.get("monitors") or []:
        sz = sizes.get(m["inst"]) or {}
        diag = round(((sz.get("w") or 0) ** 2 + (sz.get("h") or 0) ** 2) ** .5 / 2.54) if sz.get("w") else None
        vendor = PNP_VENDORS.get((m.get("maker") or "").upper(), m.get("maker") or "")
        internal = conn.get(m["inst"]) in (11, 0x80000000, -2147483648)  # interna (eDP/LVDS)
        label = (m.get("name") or "").strip()
        mons.append({"vendor": vendor, "name": label, "code": m.get("code"), "inches": diag, "internal": internal})
    batt = psutil.sensors_battery()
    comps = []
    comps.append({"id": "cpu", "name": "Procesador", "title": _clean(cpu.get("name", "")),
                  "rows": [["Núcleos", str(cpu.get("cores", "–"))], ["Hilos", str(cpu.get("threads", "–"))],
                           ["Frecuencia base", f"{(cpu.get('maxMhz') or 0) / 1000:.1f} GHz".replace(".", ",")],
                           ["Caché L3", f"{round((cpu.get('l3') or 0) / 1024)} MB"]]})
    if dgpu:
        vr = _gpu_vram(dgpu["name"])
        comps.append({"id": "gpu", "name": "Gráficos", "title": _clean(dgpu["name"]),
                      "rows": ([["Memoria", f"{vr} GB"]] if vr else []) + ([["Integrada", _clean(igpu["name"])]] if igpu else []) +
                              [["Driver", dgpu.get("driver") or "–"]], "vram": vr})
    comps.append({"id": "ram", "name": "Memoria", "title": f"{round(ram_total / GB)} GB {ram_type}".strip(),
                  "rows": [["Velocidad", f"{ram_speed} MT/s" if ram_speed else "–"],
                           ["Fabricante", (rams[0].get("maker") or "–").strip() if rams else "–"],
                           ["Módulos", f"{len(rams)} de {slots} ranuras" + (", hay libres" if slots > len(rams) else "")]],
                  "slots": slots, "modules": len(rams)})
    comps.append({"id": "ssd", "name": "Almacenamiento", "title": f"{sysd.get('name', 'Disco')} {round((sysd.get('size') or 0) / 1e12, 1):g} TB".replace(".", ","),
                  "rows": [["Tipo", f"{sysd.get('media', '')} {sysd.get('bus', '')}".strip() or "–"],
                           ["Usado en C:", f"{round(du.used / GB)} GB"], ["Libre en C:", f"{round(du.free / GB)} GB"],
                           ["Discos", str(len(disks))]], "bar": round(du.used / du.total, 3)})
    if mons:
        main = next((m for m in mons if m["internal"]), mons[0])
        comps.append({"id": "display", "name": "Pantallas", "title": f"{len(mons)} pantalla{'s' if len(mons) > 1 else ''}",
                      "rows": [[("Interna" if m["internal"] else "Externa"), " ".join(x for x in (m["vendor"], m["name"] or m["code"], f'{m["inches"]}"' if m["inches"] else "") if x)] for m in mons],
                      "monitors": mons})
    if batt is not None:
        comps.append({"id": "battery", "name": "Batería", "title": f"{round(batt.percent)} %" + (" y cargando" if batt.power_plugged else ""),
                      "rows": [["Estado", "Enchufado" if batt.power_plugged else "Con batería"]]})
    if net:
        comps.append({"id": "wifi", "name": "Red", "title": net.get("name", "Red"), "rows": [["Enlace", net.get("speed", "–")], ["Tipo", net.get("media", "–")]]})
    if audio:
        comps.append({"id": "audio", "name": "Audio", "title": audio[0], "rows": [["Otros", ", ".join(audio[1:3]) or "–"]]})
    comps.append({"id": "sys", "name": "Sistema", "title": os_full,
                  "rows": [["Compilación", f"{r.get('build', '')}.{r.get('ubr', '')}".strip(".")], ["BIOS", r.get("bios") or "–"],
                           ["Placa base", r.get("board") or "–"]]})
    return {"model": nice or model or "Este equipo", "code": code, "type": ptype, "typeName": pname, "maker": maker,
            "os": os_full, "build": str(r.get("build", "")), "bios": r.get("bios", ""), "components": comps,
            "facts": {"drivers": None, "programs": _programs_count(), "freeC": round(du.free / GB)}, "ts": time.time()}


def _save(info):
    try:
        os.makedirs(os.path.dirname(_CACHE), exist_ok=True)
        with open(_CACHE, "w", encoding="utf-8") as fh:
            json.dump(info, fh, ensure_ascii=False)
    except OSError:
        pass


def pc_info_fresh():
    global _mem
    with _lock:
        info = _build()
        try:
            info["facts"]["drivers"] = _drivers_count()
        except Exception:
            pass
        _mem = info
        _save(info)
        return info


def pc_info():
    """Lo guardado (al instante) y se refresca en segundo plano; la primera vez espera a medirlo."""
    global _mem
    if _mem:
        return _mem
    try:
        with open(_CACHE, encoding="utf-8") as fh:
            _mem = json.load(fh)
        threading.Thread(target=pc_info_fresh, daemon=True).start()
        return _mem
    except (OSError, ValueError):
        return pc_info_fresh()
