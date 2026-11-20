"""Real PC information: model, type, components, displays and the Home figures.
pc_info() answers instantly with what was saved last time and refreshes in the background.

Languages: the saved copy (pcinfo.json) is language-neutral. Sentences are stored in English, and the ones built from
data as {"tr": "English {x}", "kw": {...}}; _localize() translates them each time the UI asks, so changing the
language never needs a new measurement. Row labels (rows[i][0]) stay in English on purpose: the interface looks rows
up by them and translates them where it shows them (they are marked with N_ so they reach the dictionaries)."""
import ctypes
import json
import os
import threading
import time
import winreg
from ctypes import wintypes

import psutil

from ..i18n import tc, tr
from .ps import ps_json, gather

EXPORTS = {"pc_info", "pc_info_fresh", "displays", "screen_thumb", "counts", "health"}


def health():
    """Real summary for Home: antivirus, devices with errors and the latest restore point."""
    r = ps_json(r"""
$mp = Get-CimInstance -Namespace root/Microsoft/Windows/Defender -ClassName MSFT_MpComputerStatus -ErrorAction SilentlyContinue
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

CACHE_VERSION = 5  # bump when labels or fields change, so an old cache is not shown
_CACHE = os.path.join(os.environ.get("ProgramData", r"C:\ProgramData"), "StellarHub", "pcinfo.json")
_lock = threading.Lock()
_mem = None

CHASSIS = {  # Win32_SystemEnclosure.ChassisTypes
    3: ("desktop", "Desktop"), 4: ("desktop", "Desktop"), 5: ("desktop", "Desktop"),
    6: ("desktop", "Mini tower"), 7: ("desktop", "Tower"), 8: ("laptop", "Laptop"), 9: ("laptop", "Laptop"),
    10: ("laptop", "Laptop"), 11: ("laptop", "Handheld"), 13: ("aio", "All-in-one"), 14: ("laptop", "Laptop"),
    15: ("desktop", "Compact PC"), 16: ("desktop", "Compact PC"), 30: ("tablet", "Tablet"), 31: ("laptop", "Convertible"),
    32: ("laptop", "Detachable"), 34: ("desktop", "Embedded PC"), 35: ("desktop", "Mini PC"), 36: ("desktop", "Stick PC"),
}
PNP_VENDORS = {
    "AUO": "AU Optronics", "BOE": "BOE", "CMN": "Chimei Innolux", "SDC": "Samsung Display", "LGD": "LG Display",
    "SHP": "Sharp", "IVO": "InfoVision", "CSO": "CSOT", "MNG": "CSOT", "NCP": "Nanjing CEC", "AOC": "AOC", "DEL": "Dell",
    "SAM": "Samsung", "SEC": "Samsung", "GSM": "LG", "ACR": "Acer", "ACI": "ASUS", "AUS": "ASUS", "BNQ": "BenQ",
    "HWP": "HP", "HPN": "HP", "LEN": "Lenovo", "MSI": "MSI", "VSC": "ViewSonic", "PHL": "Philips", "GBT": "Gigabyte",
    "AOU": "AOC", "HKC": "HKC", "CSW": "CSOT", "KOS": "KOORUI", "XMI": "Xiaomi", "HSD": "HannStar", "ENC": "Eizo", "NEC": "NEC",
}
GB = 1024 ** 3


def N_(text):
    """Marks a row label for the dictionaries; it stays in English here and is translated where it is shown."""
    return text


def _T(text, ctx=None, **kw):
    """A sentence to translate when the info is sent to the UI (see _localize); ctx as in i18n.tc."""
    d = {"tr": text}
    if ctx:
        d["ctx"] = ctx
    if kw:
        d["kw"] = kw
    return d


def _numfmt(v):
    """A number the engine measured, written with the interface language's decimal separator."""
    from ..i18n import language
    txt = f"{v['num']:.{v.get('d', 1)}f}"
    return txt.replace(".", ",") if language() in ("es", "pt", "it", "fr") else txt


def _tv(x):
    if isinstance(x, dict) and "tr" in x:
        kw = {k: _numfmt(v) if isinstance(v, dict) and "num" in v else v for k, v in (x.get("kw") or {}).items()}
        return tc(x["ctx"], x["tr"], **kw) if x.get("ctx") else tr(x["tr"], **kw)
    return x


def _localize(info):
    """A copy of the info with its texts in the interface language (the saved copy stays neutral)."""
    if not info:
        return info
    out = dict(info)
    out["model"] = _tv(info.get("model"))
    out["typeName"] = tr(info["typeName"]) if info.get("typeName") else info.get("typeName")
    comps = []
    for c in info.get("components") or []:
        c = dict(c)
        c["name"] = tr(c["name"]) if c.get("name") else c.get("name")
        c["title"] = _tv(c.get("title"))
        c["rows"] = [[r[0], _tv(r[1])] for r in c.get("rows") or []]
        comps.append(c)
    out["components"] = comps
    return out


_PLACEHOLDERS = {"", "system product name", "system manufacturer", "system version", "to be filled by o.e.m.",
                 "to be filled by oem", "o.e.m.", "oem", "default string", "not applicable", "not specified", "none",
                 "invalid", "all series", "base board product name", "base board manufacturer", "x.x", "unknown"}


def _placeholder(s):
    """A BIOS default instead of a real name."""
    return (s or "").strip().lower() in _PLACEHOLDERS


def _virtual(maker, model):
    s = f"{maker} {model}".lower()
    for k in ("virtualbox", "vmware", "virtual machine", "qemu", "kvm", "parallels", "hyper-v", "xen"):
        if k in s:
            return True
    return False


SCRIPT = r"""
$cs = Get-CimInstance Win32_ComputerSystem; $en = Get-CimInstance Win32_SystemEnclosure; $os = Get-CimInstance Win32_OperatingSystem
$bb = Get-CimInstance Win32_BaseBoard | Select-Object -First 1
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
  bios=$bios.SMBIOSBIOSVersion; biosDate=$bios.ReleaseDate; board=$bb.Product; boardMaker=$bb.Manufacturer
  cpu=[pscustomobject]@{ name="$($cpu.Name)".Trim(); cores=$cpu.NumberOfCores; threads=$cpu.NumberOfLogicalProcessors; maxMhz=$cpu.MaxClockSpeed; l2=$cpu.L2CacheSize; l3=$cpu.L3CacheSize; socket=$cpu.SocketDesignation }
  gpus=@(Get-CimInstance Win32_VideoController | ForEach-Object { [pscustomobject]@{ name=$_.Name; driver=$_.DriverVersion; driverDate=$_.DriverDate; ram=$_.AdapterRAM; w=$_.CurrentHorizontalResolution; h=$_.CurrentVerticalResolution; hz=$_.CurrentRefreshRate } })
  ram=@(Get-CimInstance Win32_PhysicalMemory | ForEach-Object { [pscustomobject]@{ cap=$_.Capacity; speed=$_.Speed; maker=$_.Manufacturer; part="$($_.PartNumber)".Trim(); slot=$_.DeviceLocator; type=$_.SMBIOSMemoryType } })
  slots=(Get-CimInstance Win32_PhysicalMemoryArray | Measure-Object -Property MemoryDevices -Sum).Sum
  disks=@(Get-PhysicalDisk | ForEach-Object { [pscustomobject]@{ id="$($_.DeviceId)"; name=$_.FriendlyName; media="$($_.MediaType)"; bus="$($_.BusType)"; size=$_.Size; health="$($_.HealthStatus)" } })
  audio=@(Get-CimInstance Win32_SoundDevice | Where-Object { $_.Status -eq 'OK' } | ForEach-Object { $_.Name })
  monitors=$mons; monSizes=$sizes; monConn=$conn
}
"""


# Loading the Storage and NetAdapter modules costs about a second each: they run in their own PowerShell at the same
# time as the main script instead of one after the other.
SCRIPT_SYSDISK = r"(Get-Partition -DriveLetter $env:SystemDrive[0] -ErrorAction SilentlyContinue | Select-Object -First 1).DiskNumber"
SCRIPT_NETS = r"""@(Get-NetAdapter -Physical -ErrorAction SilentlyContinue | Where-Object Status -eq 'Up' | ForEach-Object { [pscustomobject]@{ name=$_.InterfaceDescription; speed=$_.LinkSpeed; media="$($_.PhysicalMediaType)" } })"""


def _query():
    """The same data the old single script returned, from three PowerShell processes running at once."""
    def safe(fn, default):
        try:
            return fn()
        except Exception:
            return default
    r, disk, nets = gather(lambda: ps_json(SCRIPT, 90),
                           lambda: safe(lambda: ps_json(SCRIPT_SYSDISK, 60), None),
                           lambda: safe(lambda: ps_json(SCRIPT_NETS, 60, True), []))
    r = r or {}
    r["sysDisk"], r["nets"] = disk, nets
    return r


def _clean(s):
    return (s or "").replace("(R)", "").replace("(TM)", "").replace("(tm)", "").replace("  ", " ").strip()


def _gpu_vram(name):
    # AdapterRAM tops out at 4 GB because it is 32-bit: for NVIDIA, nvidia-smi is asked instead
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
    """The same count as the Program Remover's Programs tab: every Win32 entry it lists (not just the ones with a unique
    name) plus the Microsoft Store apps it knows about."""
    from .removal import programs as _pm, settings as _rs
    seen = set()
    try:
        for hive, view in _pm.SOURCES:
            for keyname in _pm.registry.subkeys(_pm.registry.HIVES[hive], _pm.UNINSTALL, view):
                p = _pm._read_entry(hive, view, keyname)
                if p:
                    seen.add((p["name"].lower(), p["version"].lower(), p["user"]))
    except Exception:
        pass
    n = len(seen)
    try:
        if _rs.load().get("show_store", True):
            n += len(_pm.cached_store_apps())
    except Exception:
        pass
    return n


def _drivers_count():
    # the Drivers inventory is the same query: one shared (and cached) measurement for both
    from . import drivers
    return len(drivers.list_drivers(max_age=600))


def counts():
    du = psutil.disk_usage("C:\\")
    return {"programs": _programs_count(), "drivers": _drivers_count(), "freeC": round(du.free / GB)}


def displays():
    """Connected displays with their real position (for screenshots) and refresh rate."""
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
    """JPEG thumbnail (data URL) of what that display is showing right now."""
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
    r = _query()
    maker, model = (r.get("maker") or "").strip(), (r.get("model") or "").strip()
    family = (r.get("family") or "").strip()
    ch = (r.get("chassis") or [0])[0] if r.get("chassis") else 0
    ptype, pname = CHASSIS.get(ch, ("laptop" if r.get("pcType") == 2 else "desktop",
                                    "Laptop" if r.get("pcType") == 2 else "Desktop"))
    if _virtual(maker, model):
        ptype, pname = "virtual", "Virtual machine"  # typeName: translated in _localize
    # many desktop boards leave the BIOS defaults in the system name ("System Product Name", "To be filled by
    # O.E.M."): then the motherboard says what the PC is, e.g. "ASUS ROG STRIX Z790-E GAMING WIFI"
    board, board_maker = (r.get("board") or "").strip(), (r.get("boardMaker") or "").strip()
    if _placeholder(maker) and not _placeholder(board_maker):
        maker = board_maker
    if _placeholder(model):
        model = "" if _placeholder(board) else board
    if _placeholder(family):
        family = ""
    nice = family or model
    BRANDS = {"asustek": "ASUS", "asus": "ASUS", "asrock": "ASRock", "biostar": "Biostar", "evga": "EVGA", "nzxt": "NZXT",
              "intel": "Intel", "medion": "Medion", "fujitsu": "Fujitsu", "alienware": "Alienware", "framework": "Framework",
              "gigabyte technology": "Gigabyte","hewlett-packard": "HP", "hp": "HP", "lenovo": "Lenovo", "dell": "Dell", "acer": "Acer",
              "micro-star": "MSI", "msi": "MSI", "gigabyte": "Gigabyte", "samsung": "Samsung", "microsoft": "Microsoft",
              "apple": "Apple", "razer": "Razer", "huawei": "Huawei", "xiaomi": "Xiaomi", "lg": "LG", "toshiba": "Toshiba"}
    first = (maker.split() or [""])[0].lower().strip(",.")
    brand = BRANDS.get(first, maker.split()[0].title() if maker else "")
    if brand and nice and not nice.lower().startswith(brand.lower()):
        nice = f"{brand} {nice}"
    code = model.split("_")[-1] if "_" in model else (model if model != nice else "")
    osname = (r.get("os") or "Windows").replace("Microsoft ", "").strip()
    os_full = f"{osname} {r.get('osVer') or ''}".strip()
    cpu = r.get("cpu") or {}
    gpus = [g for g in (r.get("gpus") or []) if g.get("name")]
    from .telemetry import gpu_kind, gpu_rank
    real = [g for g in gpus if gpu_kind(g["name"]) != "virtual"] or gpus
    discrete = sorted((gpu_rank(g["name"]), i) for i, g in enumerate(real) if gpu_kind(g["name"]) == "discrete")
    dgpu = real[discrete[0][1]] if discrete else (real[0] if real else {})
    igpu = next((g for g in real if g is not dgpu and gpu_kind(g["name"]) == "integrated"), None)
    rams = r.get("ram") or []
    ram_total = sum(int(m.get("cap") or 0) for m in rams)
    ram_speed = max((int(m.get("speed") or 0) for m in rams), default=0)
    ram_type = {34: "DDR5", 26: "DDR4", 24: "DDR3", 35: "LPDDR5", 30: "LPDDR4"}.get((rams[0].get("type") if rams else 0), "")
    slots = int(r.get("slots") or len(rams) or 1)
    disks = r.get("disks") or []
    sd = str(r.get("sysDisk") if r.get("sysDisk") is not None else "")
    sysd = next((d for d in disks if str(d.get("id")) == sd), disks[0] if disks else {})
    du = psutil.disk_usage("C:\\")
    nets = r.get("nets") or []
    net = nets[0] if nets else {}
    audio = r.get("audio") or []
    # displays: commercial name from WMI + size in inches
    sizes = {s["inst"]: s for s in (r.get("monSizes") or [])}
    conn = {c["inst"]: c.get("tech") for c in (r.get("monConn") or [])}
    mons = []
    for m in r.get("monitors") or []:
        sz = sizes.get(m["inst"]) or {}
        diag = round(((sz.get("w") or 0) ** 2 + (sz.get("h") or 0) ** 2) ** .5 / 2.54) if sz.get("w") else None
        vendor = PNP_VENDORS.get((m.get("maker") or "").upper(), m.get("maker") or "")
        internal = conn.get(m["inst"]) in (6, 11, 13, 0x80000000, -2147483648)  # internal: LVDS, eDP, UDI embedded
        label = (m.get("name") or "").strip()
        mons.append({"vendor": vendor, "name": label, "code": m.get("code"), "inches": diag, "internal": internal})
    batt = psutil.sensors_battery()
    comps = []
    comps.append({"id": "cpu", "name": "Processor", "title": _clean(cpu.get("name", "")),
                  "rows": [[N_("Cores"), str(cpu.get("cores", "–"))], [N_("Threads"), str(cpu.get("threads", "–"))],
                           [N_("Base clock"), _T("{v} GHz", v={"num": (cpu.get('maxMhz') or 0) / 1000, "d": 1})],
                           [N_("L3 cache"), f"{round((cpu.get('l3') or 0) / 1024)} MB"]]})
    if dgpu:
        vr = _gpu_vram(dgpu["name"])
        comps.append({"id": "gpu", "name": "Graphics", "title": _clean(dgpu["name"]),
                      "rows": ([[N_("Memory"), f"{vr} GB"]] if vr else []) + ([[N_("Integrated"), _clean(igpu["name"])]] if igpu else []) +
                              [[N_("Driver"), dgpu.get("driver") or "–"]], "vram": vr})
    comps.append({"id": "ram", "name": "Memory", "title": f"{round(ram_total / GB)} GB {ram_type}".strip(),
                  "rows": [[N_("Speed"), f"{ram_speed} MT/s" if ram_speed else "–"],
                           [N_("Manufacturer"), (rams[0].get("maker") or "–").strip() if rams else "–"],
                           [N_("Modules"), _T("{n} of {slots} slots, free slots available" if slots > len(rams) else "{n} of {slots} slots",
                                              n=len(rams), slots=slots)]],
                  "slots": slots, "modules": len(rams)})
    size = sysd.get("size") or 0
    # 256 GB is "256 GB", not "0.3 TB"
    cap = f"{round(size / 1e12, 1):g} TB" if size >= 0.95e12 else f"{round(size / 1e9):d} GB"
    comps.append({"id": "ssd", "name": "Storage", "title": f"{sysd['name']} {cap}" if sysd.get("name") else _T("Disk {size}", size=cap),
                  "rows": [[N_("Type"), f"{sysd.get('media', '')} {sysd.get('bus', '')}".strip() or "–"],
                           [N_("Used on C:"), f"{round(du.used / GB)} GB"], [N_("Free on C:"), f"{round(du.free / GB)} GB"],
                           [N_("Disks"), str(len(disks))]], "bar": round(du.used / du.total, 3)})
    if mons:
        comps.append({"id": "display", "name": "Displays", "title": _T("{n} displays" if len(mons) > 1 else "{n} display", n=len(mons)),
                      "rows": [[(N_("Internal") if m["internal"] else N_("External")), " ".join(x for x in (m["vendor"], m["name"] or m["code"], f'{m["inches"]}"' if m["inches"] else "") if x)] for m in mons],
                      "monitors": mons})
    if batt is not None:
        comps.append({"id": "battery", "name": "Battery",
                      "title": _T("{pct}%, charging", pct=round(batt.percent)) if batt.power_plugged else f"{round(batt.percent)}%",
                      "rows": [[N_("Status"), _T("Plugged in" if batt.power_plugged else "On battery", ctx="battery")]]})
    if net:
        comps.append({"id": "wifi", "name": "Network", "title": net.get("name") or _T("Network"),
                      "rows": [[N_("Link"), net.get("speed", "–")], [N_("Type"), net.get("media", "–")]]})
    if audio:
        comps.append({"id": "audio", "name": "Audio", "title": audio[0], "rows": [[N_("Others"), ", ".join(audio[1:3]) or "–"]]})
    comps.append({"id": "sys", "name": "System", "title": os_full,
                  "rows": [[N_("Build"), f"{r.get('build', '')}.{r.get('ubr', '')}".strip(".")], [N_("BIOS"), r.get("bios") or "–"],
                           [N_("Motherboard"), r.get("board") or "–"]]})
    return {"model": nice or model or _T("This PC"), "code": code, "type": ptype, "typeName": pname, "maker": maker,
            "os": os_full, "build": str(r.get("build", "")), "bios": r.get("bios", ""), "components": comps,
            "facts": {"drivers": None, "programs": _programs_count(), "freeC": round(du.free / GB)}, "ts": time.time(), "v": CACHE_VERSION}


def _save(info):
    try:
        os.makedirs(os.path.dirname(_CACHE), exist_ok=True)
        with open(_CACHE, "w", encoding="utf-8") as fh:
            json.dump(info, fh, ensure_ascii=False)
    except OSError:
        pass


STALE_AFTER = 30 * 60  # facts (drivers, disks, GPU) older than this are measured again in the background
_refreshing = threading.Event()


def pc_info_fresh():
    global _mem
    t0 = time.time()
    with _lock:
        if _mem and _mem.get("ts", 0) >= t0:  # another caller measured while this one waited for the lock
            return _localize(_mem)
        def count():
            try:
                return _drivers_count()
            except Exception:
                return None
        info, n_drivers = gather(_build, count)  # the slowest query runs while the rest is measured
        if n_drivers is not None:
            info["facts"]["drivers"] = n_drivers
        _mem = info
        _save(info)
        return _localize(info)


def _refresh_bg():
    try:
        pc_info_fresh()
    except Exception:
        pass
    finally:
        _refreshing.clear()


def _refresh_async():
    """One background measurement at a time; never blocks the caller."""
    if _refreshing.is_set():
        return
    _refreshing.set()
    threading.Thread(target=_refresh_bg, daemon=True).start()


def pc_info():
    """What was measured last (instantly); older than STALE_AFTER it is measured again in the background, so the
    next call (the UI asks again when Home is shown after a while) has the new data. The first time it waits."""
    global _mem
    if _mem:
        if time.time() - _mem.get("ts", 0) > STALE_AFTER:
            _refresh_async()
        return _localize(_mem)
    try:
        with open(_CACHE, encoding="utf-8") as fh:
            cached = json.load(fh)
        if cached.get("v") != CACHE_VERSION:
            return pc_info_fresh()
        _mem = cached
        _refresh_async()
        return _localize(_mem)
    except (OSError, ValueError):
        return pc_info_fresh()
