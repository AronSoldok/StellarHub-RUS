"""Super Optimizer engine: cleanup, startup, services, registry, repair and performance. For real.

Rules: anything that changes the system saves a copy first so it can be undone (service states, .reg, previous
settings); anything that needs administrator rights checks for them and returns {"needAdmin": True} instead of
failing halfway; services outside a closed list and registry keys that are not really broken are never touched.
"""
import codecs
import ctypes
import glob
import json
import os
import re
import subprocess
import threading
import time
import winreg
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor

from .ps import ps, ps_json, NO_WINDOW
from .removal import cleaner, paths, registry, startup
from .removal.registry import RegRef, V32, V64
from .removal import system as rsys

EXPORTS = {"perf_read", "perf_set", "startup_set", "services_list", "services_apply", "services_undo",
           "registry_undo", "open_location", "open_startup_page", "boot_info", "bg_set", "power_plan_set"}
JOBS = {"clean_scan", "clean", "startup_list", "registry_scan", "registry_fix", "repair", "restore_point"}

DATA = os.path.join(os.environ.get("ProgramData", r"C:\ProgramData"), "StellarHub", "optimizer")


def _admin():
    try:
        return bool(ctypes.windll.shell32.IsUserAnAdmin())
    except Exception:
        return False


def _need_admin():
    return {"needAdmin": True}


def _short(p, n=64):
    p = p.replace(os.path.expanduser("~"), "%USERPROFILE%")
    return p if len(p) <= n else p[:18] + "…" + p[-(n - 19):]


# =============================================================== cleanup
def clean_scan(job):
    """Measures every cleaner category for real (without deleting anything)."""
    cats = cleaner.categories()
    out = []

    def on_item(it):
        c = cats[it["id"]]
        dirs, files = ([], []) if c.get("recycle") else cleaner._expand(c)
        pths = [_short(d) for d in dirs[:4]] + [_short(f) for f in files[:2]]
        if c.get("recycle"):
            pths = ["All drives"]
        out.append({"id": it["id"], "g": it["group"], "label": it["label"], "size": it["size"], "files": it["count"],
                    "def": bool(c.get("default")), "admin": bool(c.get("admin")), "needs_admin": it["needs_admin"],
                    "busy": it["process"] if it["busy"] else "", "desc": it["desc"] or _DESC.get(it["id"], ""),
                    "paths": pths or ["(not present on this PC)"]})
        job.progress(len(out) / len(cats), it["label"], done=len(out))

    cleaner.scan(on_item=on_item)
    order = list(cats)
    out.sort(key=lambda x: order.index(x["id"]))
    return out


_DESC = {
    "win_temp": "Leftovers from installations and system tasks.",
    "dumps": "Memory copies of programs that crashed. Only useful for debugging.",
    "do_cache": "Pieces of updates your PC shares with other computers.",
    "recycle": "Things you deleted. Once emptied, they can't be recovered.",
    "chrome": "Page, code and GPU cache. Doesn't touch passwords, history or tabs.",
    "edge": "Page, code and GPU cache. Doesn't touch passwords, history or tabs.",
    "brave": "Page, code and GPU cache. Doesn't touch passwords, history or tabs.",
    "opera": "Page cache.", "firefox": "Page and startup cache.",
    "discord": "Images and videos you've already seen.",
    "spotify": "Cached songs that aren't downloaded for offline listening.",
    "steam_web": "Store and community cache.",
}


def clean(job, ids):
    """Cleans the chosen categories one by one, reporting what was freed. Files in use are skipped."""
    cats = cleaner.categories()
    admin = _admin()
    total = {"freed": 0, "deleted": 0, "skipped": 0, "per": {}, "skippedCats": []}
    ids = [i for i in ids if i in cats]
    for n, cid in enumerate(ids):
        job.check()
        c = cats[cid]
        if c.get("admin") and not admin:
            total["skippedCats"].append(cid)
            continue
        job.progress(n / max(1, len(ids)), f"Cleaning {c['label'].lower()}…", id=cid, freed=total["freed"])
        r = cleaner.clean([cid])
        total["per"][cid] = r["freed"]
        for k in ("freed", "deleted", "skipped"):
            total[k] += r[k]
        job.progress((n + 1) / max(1, len(ids)), c["label"], id=cid, freed=total["freed"], catFreed=r["freed"], force=True)
    return total


# =============================================================== startup
_PF_TASK = r"Software\Classes\Local Settings\Software\Microsoft\Windows\CurrentVersion\AppModel\SystemAppData"
_IMPACT_CACHE = {}


def _packaged_startup():
    """Store apps with a startup task (what Task Manager lists besides Run and the Startup folder)."""
    pk = ps_json("Get-AppxPackage -PackageTypeFilter Main | Select-Object Name, PackageFamilyName, PackageFullName, InstallLocation, "
                 "@{n='Pub';e={$_.PublisherDisplayName}}", timeout=60, as_list=True)
    names = {}
    for a in ps_json("Get-StartApps | Select-Object Name, AppID", timeout=40, as_list=True):
        app_id = a.get("AppID") or ""
        if "!" in app_id:
            names.setdefault(app_id.split("!")[0], a.get("Name"))
    out = []

    def one(p):
        loc = p.get("InstallLocation") or ""
        mf = os.path.join(loc, "AppxManifest.xml")
        if not loc or not os.path.isfile(mf):
            return
        try:
            txt = open(mf, "rb").read().decode("utf-8", "ignore")
        except OSError:
            return
        if "windows.startupTask" not in txt:
            return
        try:
            root = ET.fromstring(txt.encode("utf-8"))
        except ET.ParseError:
            return
        pubname = ""
        for el in root.iter():
            if el.tag.endswith("PublisherDisplayName") and el.text:
                pubname = el.text.strip()
        for ext in root.iter():
            if not ext.tag.endswith("Extension") or ext.get("Category") != "windows.startupTask":
                continue
            for st in ext:
                if not st.tag.endswith("StartupTask"):
                    continue
                tid = st.get("TaskId")
                default_on = (st.get("Enabled") or "false").lower() == "true"
                pfn = p.get("PackageFamilyName")
                state = registry.get_value(winreg.HKEY_CURRENT_USER, f"{_PF_TASK}\\{pfn}\\{tid}", "State")
                # 0 disabled, 1 disabled by the user, 2 enabled, 3 disabled by policy, 4 enabled by policy
                on = state in (2, 4) if state is not None else default_on
                dn = names.get(pfn) or st.get("DisplayName") or p.get("Name")
                if dn and (dn.startswith("ms-resource:") or dn == p.get("Name")):
                    dn = (_resource(p, dn) if dn.startswith("ms-resource:") else None) or _manifest_name(p, root) or p.get("Name").split(".")[-1]
                out.append({"id": f"pkg|{pfn}|{tid}", "name": dn, "pub": p.get("Pub") or pubname, "on": on,
                            "origin": "store", "path": f"App startup task ({tid})", "target": loc,
                            "locked": state in (3, 4)})
    with ThreadPoolExecutor(max_workers=8) as ex:
        list(ex.map(one, pk))
    return out


def _resource(p, ref):
    """Resolves a Store app 'ms-resource:' to its text (like File Explorer does)."""
    name = p.get("Name") or ""
    res = ref[len("ms-resource:"):]
    if not res.startswith("//"):
        res = f"//{name}/{res if '/' in res else 'Resources/' + res}"
    buf = ctypes.create_unicode_buffer(512)
    src = f"@{{{p.get('PackageFullName')}? ms-resource:{res}}}".replace("? ", "?")
    try:
        if ctypes.windll.shlwapi.SHLoadIndirectString(src, buf, 512, None) == 0 and buf.value:
            return buf.value
    except Exception:
        pass
    return None


def _manifest_name(p, root):
    for el in root.iter():
        if el.tag.endswith("VisualElements") and el.get("DisplayName"):
            dn = el.get("DisplayName")
            return _resource(p, dn) if dn.startswith("ms-resource:") else dn
    return None


def _impacts():
    """Impact measured by Windows (the same one Task Manager uses). Only readable as administrator."""
    if _IMPACT_CACHE.get("t", 0) > time.time() - 600:
        return _IMPACT_CACHE["d"]
    data = {}
    folder = os.path.join(os.environ.get("WINDIR", r"C:\Windows"), "System32", "wdi", "LogFiles", "StartupInfo")
    try:
        files = sorted(glob.glob(os.path.join(folder, "*.xml")), key=os.path.getmtime)
    except OSError:
        files = []
    for f in files[-3:]:
        try:
            root = ET.parse(f).getroot()
        except (OSError, ET.ParseError):
            continue
        for p in root.iter():
            if not p.tag.endswith("Process"):
                continue
            name = (p.get("Name") or "").lower()
            vals = {c.tag.split("}")[-1]: c.text for c in p}
            try:
                cpu = float(vals.get("CpuUsage") or 0) / 1000  # ms
                disk = float(vals.get("DiskUsage") or 0)  # bytes
            except ValueError:
                continue
            lvl = "high" if cpu > 1000 or disk > 3e6 else "medium" if cpu > 300 or disk > 3e5 else "low"
            data[os.path.basename(name)] = lvl
    _IMPACT_CACHE.update(t=time.time(), d=data)
    return data


_REC = ("steam", "discord", "spotify", "epicgames", "onedrive", "teams", "skype", "adobe", "creative cloud",
        "battle.net", "origin", "ea desktop", "ubisoft", "dropbox", "googledrive", "zoom", "riot", "roblox")
_REVIEW = ("wscript.exe", "cscript.exe", "powershell.exe", "pwsh.exe", "cmd.exe", "mshta.exe", "rundll32.exe")


def startup_list(job):
    """The same as Task Manager > Startup apps: registry (Run), Startup folder and Store apps."""
    job.progress(.1, "Registry and Startup folder")
    base = [e for e in startup.list_entries() if e["type"] in ("run", "folder")]
    job.progress(.4, "Store apps")
    try:
        pk = _packaged_startup()
    except Exception:
        pk = []
    job.progress(.85, "Startup impact")
    imp = _impacts()
    measured = bool(imp)
    groups = {}
    for e in base:
        exe = e.get("exe") or ""
        key = os.path.basename(exe).lower() or e["name"].lower()
        groups.setdefault(key, []).append(e)
    items = []
    for key, es in groups.items():
        e = es[0]
        on = any(x["enabled"] for x in es)
        exe_name = os.path.basename(e.get("exe") or "") or e["name"]
        level = ("none" if not on else imp.get(exe_name.lower(), "unmeasured" if not measured else "low"))
        hk = "HKLM" if any(x["id"].startswith("run|HKLM") or x["id"].startswith("folder|HKLM") for x in es) else "HKCU"
        it = {"id": "grp|" + key, "ids": [x["id"] for x in es], "name": exe_name, "pub": e.get("company") or "",
              "on": on, "impact": level, "origin": "folder" if e["type"] == "folder" else "registry",
              "path": (f"{e['where']}: {e['name']}" if len(es) == 1 else f"{e['where']}"),
              "target": e.get("exe") or "", "hklm": hk == "HKLM", "missing": any(x.get("missing") for x in es),
              "children": [x["command"] for x in es] if len(es) > 1 or e["type"] == "folder" else [],
              "count": len(es) if len(es) > 1 else 0}
        if exe_name.lower() in _REVIEW:
            it["review"] = True
            it["note"] = "Runs a script when you sign in. Check what it is before touching it: it may be yours."
        if any(r in (exe_name + " " + it["pub"]).lower() for r in _REC) and on:
            it["rec"] = True
        if exe_name.lower() == "securityhealthsystray.exe":
            it["note"] = "The Windows Security icon in the system tray. Best left on."
        items.append(it)
    for p in pk:
        p["ids"] = [p["id"]]
        p["impact"] = "none" if not p["on"] else imp.get((p["name"] or "").lower() + ".exe", "unmeasured" if not measured else "low")
        if p["on"] and any(r in (p["name"] + " " + p["pub"]).lower() for r in _REC):
            p["rec"] = True
        items.append(p)
    job.progress(1, "Done")
    return {"items": items, "measured": measured, "admin": _admin()}


def startup_set(ids, enabled):
    """Enables or disables like Task Manager does (reversible). ids: those of the entry (it can be a group)."""
    done = []
    for i in ids:
        if i.startswith("pkg|"):
            _, pfn, tid = i.split("|", 2)
            with winreg.CreateKeyEx(winreg.HKEY_CURRENT_USER, f"{_PF_TASK}\\{pfn}\\{tid}", 0, winreg.KEY_SET_VALUE) as k:
                winreg.SetValueEx(k, "State", 0, winreg.REG_DWORD, 2 if enabled else 1)
        else:
            if (i.startswith("run|HKLM") or i.startswith("folder|HKLM")) and not _admin():
                return _need_admin()
            startup.set_enabled(i, bool(enabled))
        done.append(i)
    return {"ok": True, "changed": done}


def boot_info():
    """BIOS time of the last boot (the same Task Manager shows) and the latest boots measured by Windows
    (the latter needs administrator rights)."""
    bios = registry.get_value(winreg.HKEY_LOCAL_MACHINE, r"SYSTEM\CurrentControlSet\Control\Session Manager\Power", "FwPOSTTime")
    boots = []
    if _admin():
        ev = ps_json("Get-WinEvent -FilterHashtable @{LogName='Microsoft-Windows-Diagnostics-Performance/Operational'; Id=100} "
                     "-MaxEvents 7 -ErrorAction SilentlyContinue | ForEach-Object { $x=[xml]$_.ToXml(); "
                     "[pscustomobject]@{ t=$_.TimeCreated.ToString('o'); ms=[int](($x.Event.EventData.Data | Where-Object Name -eq 'MainPathBootTime').'#text') } }",
                     timeout=30, as_list=True)
        boots = [{"t": e.get("t"), "s": round((e.get("ms") or 0) / 1000, 1)} for e in reversed(ev) if e.get("ms")]
    return {"bios": round(bios / 1000, 1) if isinstance(bios, int) else None, "boots": boots, "admin": _admin()}


def open_location(path):
    p = os.path.expandvars(path or "")
    if os.path.isfile(p):
        subprocess.Popen(["explorer.exe", "/select,", p], creationflags=NO_WINDOW)
        return True
    if os.path.isdir(p):
        os.startfile(p)
        return True
    return False


def open_startup_page():
    subprocess.Popen(["taskmgr.exe", "/7", "/startup"], creationflags=NO_WINDOW)
    return True


# =============================================================== services
# Closed list: only these can be changed from StellarHub. Nothing critical to the system.
SERVICES = [
    {"id": "DiagTrack", "svc": ["DiagTrack"], "name": "Windows telemetry", "desc": "Sends usage and diagnostic data to Microsoft.", "bal": "disabled", "max": "disabled"},
    {"id": "dmwappushservice", "svc": ["dmwappushservice"], "name": "Telemetry messages (WAP Push)", "desc": "Helps telemetry receive messages.", "bal": "disabled", "max": "disabled"},
    {"id": "Fax", "svc": ["Fax"], "name": "Fax", "desc": "Send and receive faxes.", "bal": "disabled", "max": "disabled"},
    {"id": "RetailDemo", "svc": ["RetailDemo"], "name": "Retail demo mode", "desc": "Only used by display PCs in stores.", "bal": "disabled", "max": "disabled"},
    {"id": "MapsBroker", "svc": ["MapsBroker"], "name": "Downloaded maps", "desc": "Updates offline maps for the Maps app.", "bal": "manual", "max": "disabled"},
    {"id": "RemoteRegistry", "svc": ["RemoteRegistry"], "name": "Remote registry", "desc": "Lets another computer change this PC's registry.", "bal": "disabled", "max": "disabled"},
    {"id": "WerSvc", "svc": ["WerSvc"], "name": "Error reporting", "desc": "Sends reports to Microsoft when something fails.", "bal": None, "max": "disabled"},
    {"id": "Spooler", "svc": ["Spooler"], "name": "Print spooler", "desc": "Needed to print.", "bal": "manual", "max": "disabled", "printers": True},
    {"id": "SysMain", "svc": ["SysMain"], "name": "SysMain (app preloading)", "desc": "Loads the apps you use most into memory. On a fast SSD it's barely noticeable.", "bal": None, "max": "manual"},
    {"id": "WSearch", "svc": ["WSearch"], "name": "Search indexing", "desc": "Builds the index that makes file search instant.", "bal": None, "max": "manual", "warn": "Searching for files from Start will be slower."},
    {"id": "Xbox", "svc": ["XblAuthManager", "XblGameSave", "XboxNetApiSvc", "XboxGipSvc"], "name": "Xbox services", "desc": "Xbox Live sign-in, saved games and networking.", "bal": None, "max": "manual", "warn": "If you play with Game Pass or the Xbox app, leave them on."},
    {"id": "lfsvc", "svc": ["lfsvc"], "name": "Geolocation", "desc": "Gives your location to apps that ask for it.", "bal": None, "max": "disabled", "warn": "Apps that use your location will no longer know it."},
    {"id": "PhoneSvc", "svc": ["PhoneSvc"], "name": "Phone service", "desc": "Calls from the PC through your phone.", "bal": None, "max": "manual"},
    {"id": "WbioSrvc", "svc": ["WbioSrvc"], "name": "Biometrics", "desc": "Windows Hello fingerprint and face recognition.", "bal": None, "max": None, "warn": "If you sign in with your fingerprint or face, don't touch it."},
]
_START = {"Auto": "auto", "Automatic": "auto", "Manual": "manual", "Disabled": "disabled", "Boot": "auto", "System": "auto"}
_START_PS = {"auto": "Automatic", "manual": "Manual", "disabled": "Disabled"}


def _printers():
    pr = ps_json("Get-CimInstance Win32_Printer | Select-Object Name", timeout=20, as_list=True)
    virt = ("pdf", "xps", "onenote", "fax", "anydesk", "send to", "evernote", "snagit", "cutepdf", "writer")
    return [p["Name"] for p in pr if p.get("Name") and not any(v in p["Name"].lower() for v in virt)]


def services_list():
    names = [s for e in SERVICES for s in e["svc"]]
    flt = " OR ".join(f"Name='{n}'" for n in names)
    rows = ps_json(f"Get-CimInstance Win32_Service -Filter \"{flt}\" | Select-Object Name, State, StartMode", timeout=30, as_list=True)
    st = {r["Name"]: r for r in rows}
    printers = _printers()
    out = []
    for e in SERVICES:
        present = [st[s] for s in e["svc"] if s in st]
        if not present:
            continue
        modes = [_START.get(p.get("StartMode"), "manual") for p in present]
        cur = "auto" if "auto" in modes else "manual" if "manual" in modes else "disabled"
        it = {k: e[k] for k in ("id", "name", "desc", "bal", "max") if k in e}
        it.update({"svc": [p["Name"] for p in present], "run": any(p.get("State") == "Running" for p in present), "start": cur})
        if e.get("warn"):
            it["warn"] = e["warn"]
        if e.get("printers"):
            if printers:
                it["bal"] = None
                it["warn"] = f"You have printers installed ({', '.join(printers[:2])}): leave it as it is."
            else:
                it["desc"] += " Your PC has no printers installed."
                it["warn"] = "If you ever need to print, turn it back on."
        out.append(it)
    return {"items": out, "admin": _admin()}


def services_apply(changes):
    """changes: {catalog_id: 'auto'|'manual'|'disabled'}. Saves the previous state and returns its id for undo."""
    if not _admin():
        return _need_admin()
    cat = {e["id"]: e for e in SERVICES}
    before = ps_json("Get-CimInstance Win32_Service | Select-Object Name, StartMode, State", timeout=30, as_list=True)
    prev = {r["Name"]: _START.get(r.get("StartMode"), "manual") for r in before}
    backup = {"t": time.time(), "prev": {}}
    results = []
    for cid, mode in changes.items():
        e = cat.get(cid)
        if not e or mode not in _START_PS:
            continue
        for svc in e["svc"]:
            if svc not in prev:
                continue
            backup["prev"][svc] = prev[svc]
            cmd = f"Set-Service -Name '{svc}' -StartupType {_START_PS[mode]} -ErrorAction Stop"
            if mode == "disabled":
                cmd += f"; Stop-Service -Name '{svc}' -Force -ErrorAction SilentlyContinue"
            out = ps(cmd + "; 'ok'", timeout=40)
            results.append({"svc": svc, "ok": "ok" in out.splitlines()[-1:] if out else False})
    os.makedirs(os.path.join(DATA, "services"), exist_ok=True)
    bid = time.strftime("%Y%m%d-%H%M%S")
    with open(os.path.join(DATA, "services", bid + ".json"), "w", encoding="utf-8") as fh:
        json.dump(backup, fh)
    return {"ok": all(r["ok"] for r in results), "results": results, "backup": bid}


def services_undo(bid):
    if not _admin():
        return _need_admin()
    f = os.path.join(DATA, "services", os.path.basename(str(bid)) + ".json")
    with open(f, encoding="utf-8") as fh:
        prev = json.load(fh)["prev"]
    for svc, mode in prev.items():
        ps(f"Set-Service -Name '{svc}' -StartupType {_START_PS.get(mode, 'Manual')} -ErrorAction SilentlyContinue", timeout=40)
        if mode == "auto":
            ps(f"Start-Service -Name '{svc}' -ErrorAction SilentlyContinue", timeout=40)
    return {"ok": True, "restored": len(prev)}


# =============================================================== registry
def _exists(p):
    p = os.path.expandvars((p or "").strip().strip('"'))
    return bool(p) and os.path.exists(p)


def _abs_missing(cmd):
    """The executable of a command if it is an absolute path that no longer exists; otherwise None."""
    from .removal.safety import image_path
    exe = image_path(cmd or "")
    if not exe or not os.path.isabs(exe):
        return None
    if exe.lower().endswith(("msiexec.exe", "rundll32.exe")):
        return None
    return exe if not os.path.exists(exe) else None


def registry_scan(job):
    """Looks for genuinely broken entries (pointing to files that no longer exist). Changes nothing."""
    groups = {}

    def add(g, ref, why):
        groups.setdefault(g, []).append({"id": ref.to_str(), "k": ref.display(), "why": why})

    HK = winreg.HKEY_LOCAL_MACHINE
    # 1. broken uninstallers
    job.progress(.05, "Uninstallers")
    for hive, root, view in (("HKLM", HK, V64), ("HKLM", HK, V32), ("HKCU", winreg.HKEY_CURRENT_USER, 0)):
        base = r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall"
        for sub in registry.subkeys(root, base, view):
            p = f"{base}\\{sub}"
            us = registry.get_value(root, p, "UninstallString", view)
            name = registry.get_value(root, p, "DisplayName", view)
            if not us or not name or registry.get_value(root, p, "SystemComponent", view) == 1:
                continue
            miss = _abs_missing(str(us))
            loc = registry.get_value(root, p, "InstallLocation", view)
            if miss and not (loc and _exists(str(loc))):
                add("Broken uninstallers", RegRef(hive, p, view), f"\"{name}\": the uninstaller {miss} no longer exists.")
    # 2. App Paths
    job.progress(.25, "App paths")
    for hive, root, view in (("HKLM", HK, V64), ("HKLM", HK, V32), ("HKCU", winreg.HKEY_CURRENT_USER, 0)):
        base = r"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths"
        for sub in registry.subkeys(root, base, view):
            p = f"{base}\\{sub}"
            d = registry.get_value(root, p, "", view)
            if not d:
                continue
            target = os.path.expandvars(str(d).strip().strip('"'))
            if os.path.isabs(target) and not os.path.exists(target):
                add("Broken app paths", RegRef(hive, p, view), f"Points to {target}, which no longer exists.")
    # 3. startup entries that point to nothing
    job.progress(.45, "Startup")
    for hive, root, view in (("HKCU", winreg.HKEY_CURRENT_USER, 0), ("HKLM", HK, V64), ("HKLM", HK, V32)):
        base = r"SOFTWARE\Microsoft\Windows\CurrentVersion\Run"
        for name, data, _ in registry.values(root, base, view):
            miss = _abs_missing(str(data))
            if miss:
                add("Startup entries pointing nowhere", RegRef(hive, base, view, name), f"Starts {miss}, which doesn't exist.")
    # 4. shared files that no longer exist
    job.progress(.6, "Shared files")
    for view in (V64, V32):
        base = r"SOFTWARE\Microsoft\Windows\CurrentVersion\SharedDLLs"
        for name, data, _ in registry.values(HK, base, view):
            if os.path.isabs(name) and not os.path.exists(name):
                add("Missing shared files", RegRef("HKLM", base, view, name), "The file no longer exists.")
    # 5. orphaned file types (the user's only)
    job.progress(.75, "File types")
    cu, cls = winreg.HKEY_CURRENT_USER, r"Software\Classes"
    for sub in registry.subkeys(cu, cls):
        if not sub.startswith("."):
            continue
        prog = registry.get_value(cu, f"{cls}\\{sub}", "")
        if not prog:
            continue
        in_cu = registry.key_exists(RegRef("HKCU", f"{cls}\\{prog}"))
        in_lm = registry.key_exists(RegRef("HKLM", f"SOFTWARE\\Classes\\{prog}"))
        if not in_cu and not in_lm and not registry.subkeys(cu, f"{cls}\\{sub}"):
            add("Orphaned file types", RegRef("HKCU", f"{cls}\\{sub}"), f"Says it opens with \"{prog}\", which no longer exists.")
    for sub in registry.subkeys(cu, cls):
        if sub.startswith(".") or sub.startswith("{"):
            continue
        cmd = registry.get_value(cu, f"{cls}\\{sub}\\shell\\open\\command", "")
        miss = _abs_missing(str(cmd)) if cmd else None
        if miss:
            add("Orphaned file types", RegRef("HKCU", f"{cls}\\{sub}"), f"Class of a program that is gone ({miss}).")
    # 6. broken context menu entries
    job.progress(.88, "Context menu")
    for scope in ("*", "Directory", r"Directory\Background", "Folder"):
        for hive, root, base in (("HKLM", HK, r"SOFTWARE\Classes"), ("HKCU", cu, r"Software\Classes")):
            hp = f"{base}\\{scope}\\shellex\\ContextMenuHandlers"
            for h in registry.subkeys(root, hp):
                clsid = registry.get_value(root, f"{hp}\\{h}", "") or (h if h.startswith("{") else "")
                if not clsid or not clsid.startswith("{"):
                    continue
                dll = None
                for vroot, vbase, vview in ((HK, r"SOFTWARE\Classes", V64), (cu, r"Software\Classes", 0), (HK, r"SOFTWARE\Classes", V32)):
                    dll = registry.get_value(vroot, f"{vbase}\\CLSID\\{clsid}\\InprocServer32", "", vview)
                    if dll:
                        break
                if not dll:
                    continue
                path = os.path.expandvars(str(dll).strip('"'))
                if os.path.isabs(path) and not os.path.exists(path):
                    add("Broken context menu entries", RegRef(hive, f"{hp}\\{h}"), f"Adds \"{h}\" to the right-click menu, but {os.path.basename(path)} no longer exists.")
    job.progress(1, "Done")
    order = ["Broken uninstallers", "Broken app paths", "Orphaned file types", "Startup entries pointing nowhere",
             "Missing shared files", "Broken context menu entries"]
    return [{"g": g, "items": groups[g]} for g in order if g in groups]


def registry_fix(job, ids):
    """Exports each key to .reg and then deletes the broken entry. Returns the backup folder (for undo)."""
    refs = [RegRef.from_str(i) for i in ids]
    if any(r.hive == "HKLM" for r in refs) and not _admin():
        return _need_admin()
    bid = time.strftime("%Y%m%d-%H%M%S")
    folder = os.path.join(DATA, "registry", bid)
    os.makedirs(folder, exist_ok=True)
    fixed, failed, manifest = 0, [], []
    for n, ref in enumerate(refs):
        job.check()
        job.progress(n / max(1, len(refs)), ref.display())
        f = os.path.join(folder, f"{n:03d}.reg")
        if not registry.export_key(ref, f):
            failed.append(ref.display())
            continue
        try:
            if ref.value is not None:
                registry.delete_value(ref)
            else:
                registry.delete_tree(ref)
            fixed += 1
            manifest.append({"file": f, "view": ref.view, "k": ref.display()})
        except OSError as e:
            failed.append(f"{ref.display()}: {e}")
    with open(os.path.join(folder, "manifest.json"), "w", encoding="utf-8") as fh:
        json.dump(manifest, fh, ensure_ascii=False)
    job.progress(1, "Done")
    return {"fixed": fixed, "failed": failed, "backup": bid, "folder": folder}


def registry_undo(bid):
    folder = os.path.join(DATA, "registry", os.path.basename(str(bid)))
    with open(os.path.join(folder, "manifest.json"), encoding="utf-8") as fh:
        man = json.load(fh)
    if any(m["k"].upper().startswith("HKLM") for m in man) and not _admin():
        return _need_admin()
    ok = 0
    for m in man:
        r, _ = registry.import_reg(m["file"], m.get("view", 0))
        ok += bool(r)
    return {"ok": ok == len(man), "restored": ok, "folder": folder}


# =============================================================== repair
def _stream(job, cmd, pct_re=r"(\d{1,3}(?:[.,]\d)?)\s*%", weight=(0.0, 1.0)):
    """Runs a command showing every line as it comes (also the ones rewritten with \\r, like the SFC and DISM %)."""
    job.log("> " + (cmd if isinstance(cmd, str) else " ".join(cmd)))
    p = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL,
                         creationflags=NO_WINDOW, shell=isinstance(cmd, str))
    dec = None
    buf = ""
    last = ""
    lo, hi = weight
    while True:
        chunk = p.stdout.read1(4096) if hasattr(p.stdout, "read1") else p.stdout.read(4096)
        if not chunk:
            break
        if dec is None:
            utf16 = chunk.count(b"\x00") > len(chunk) // 3
            dec = codecs.getincrementaldecoder("utf-16-le" if utf16 else "cp850")(errors="replace")
        buf += dec.decode(chunk)
        parts = re.split(r"[\r\n]+", buf)
        buf = parts.pop()
        for line in parts:
            line = line.strip().replace("\x00", "")
            if not line or line == last:
                continue
            last = line
            m = re.search(pct_re, line)
            if m:
                try:
                    job.progress(lo + (hi - lo) * float(m.group(1).replace(",", ".")) / 100, line)
                except ValueError:
                    pass
                if re.fullmatch(r"[\[\]=\s\d.,%]+", line):
                    continue  # DISM progress bars: they only update the %
            job.log(line)
        if job.cancelled:
            p.kill()
            job.stop()
    if buf.strip():
        job.log(buf.strip())
    return p.wait()


def _restart_explorer(job):
    subprocess.run(["taskkill", "/f", "/im", "explorer.exe"], capture_output=True, creationflags=NO_WINDOW)
    job.log("File Explorer closed.")
    for _ in range(12):  # Windows reopens it by itself (AutoRestartShell)
        time.sleep(.5)
        if any(p["name"].lower() == "explorer.exe" for p in rsys.list_processes()):
            job.log("File Explorer is open again.")
            return
    # if it didn't come back: open it with a non-elevated token (opening it from an admin process would leave it elevated)
    subprocess.Popen(["runas", "/trustlevel:0x20000", "explorer.exe"], creationflags=NO_WINDOW)
    job.log("File Explorer is open again.")


REPAIR_ADMIN = {"sfc", "dism", "chkdsk", "wu", "net"}


def repair(job, rid):
    if rid in REPAIR_ADMIN and not _admin():
        return _need_admin()
    win = os.environ.get("WINDIR", r"C:\Windows")
    if rid == "sfc":
        code = _stream(job, ["sfc", "/scannow"])
    elif rid == "dism":
        code = _stream(job, ["DISM", "/Online", "/Cleanup-Image", "/RestoreHealth"])
    elif rid == "chkdsk":
        code = _stream(job, ["chkdsk", "C:", "/scan"])
    elif rid == "wu":
        svcs = ["wuauserv", "cryptSvc", "bits", "msiserver"]
        for i, s in enumerate(svcs):
            job.progress(.05 + i * .08, f"Stopping {s}")
            _stream(job, ["net", "stop", s, "/y"], weight=(0, 0))
        stamp = time.strftime("%Y%m%d%H%M%S")
        for i, d in enumerate([os.path.join(win, "SoftwareDistribution"), os.path.join(win, "System32", "catroot2")]):
            job.progress(.45 + i * .12, f"Renaming {os.path.basename(d)}")
            try:
                os.rename(d, f"{d}.old-{stamp}")
                job.log(f"{d} → {os.path.basename(d)}.old-{stamp}")
            except OSError as e:
                job.log(f"Couldn't rename {d}: {e}")
        for i, s in enumerate(reversed(svcs)):
            job.progress(.75 + i * .06, f"Starting {s}")
            _stream(job, ["net", "start", s], weight=(0, 0))
        job.log("Windows Update is ready to search again.")
        code = 0
    elif rid == "net":
        job.progress(.1, "DNS")
        _stream(job, ["ipconfig", "/flushdns"], weight=(0, 0))
        job.progress(.4, "Winsock")
        _stream(job, ["netsh", "winsock", "reset"], weight=(0, 0))
        job.progress(.7, "TCP/IP")
        _stream(job, ["netsh", "int", "ip", "reset"], weight=(0, 0))
        job.log("Done. Restart the PC to finish.")
        code = 0
    elif rid == "icons":
        local = os.environ.get("LOCALAPPDATA", "")
        job.progress(.1, "Closing File Explorer")
        subprocess.run(["taskkill", "/f", "/im", "explorer.exe"], capture_output=True, creationflags=NO_WINDOW)
        time.sleep(.6)
        n = 0
        for pat in (os.path.join(local, "Microsoft", "Windows", "Explorer", "iconcache_*.db"),
                    os.path.join(local, "Microsoft", "Windows", "Explorer", "thumbcache_*.db"), os.path.join(local, "IconCache.db")):
            for f in glob.glob(pat):
                try:
                    os.remove(f)
                    n += 1
                except OSError:
                    pass
        job.log(f"{n} icon cache files deleted.")
        job.progress(.55, "Font cache")
        if _admin():
            _stream(job, ["net", "stop", "FontCache", "/y"], weight=(0, 0))
            fc = os.path.join(win, "ServiceProfiles", "LocalService", "AppData", "Local", "FontCache")
            for f in glob.glob(os.path.join(fc, "*FontCache*")):
                try:
                    os.remove(f)
                except OSError:
                    pass
            _stream(job, ["net", "start", "FontCache"], weight=(0, 0))
        else:
            job.log("The font cache needs administrator mode: skipped.")
        subprocess.run(["ie4uinit.exe", "-show"], capture_output=True, creationflags=NO_WINDOW)
        job.progress(.85, "Opening File Explorer")
        _restart_explorer(job)
        code = 0
    elif rid == "explorer":
        job.progress(.3, "Restarting File Explorer")
        _restart_explorer(job)
        code = 0
    else:
        raise ValueError(rid)
    job.progress(1, "Done")
    return {"code": code}


def restore_point(job, desc="StellarHub, before optimizing"):
    if not _admin():
        return _need_admin()
    job.progress(.1, "Creating the restore point…")
    ok, out = rsys.create_restore_point(desc)
    job.progress(1, "Done")
    return {"ok": ok, "msg": out[-300:]}


# =============================================================== performance
_OVERLAY = {"961cc777-2547-4f9d-8174-7d86181b8a7a": "efficiency", "00000000-0000-0000-0000-000000000000": "balanced",
            "ded574b5-45a0-4f42-8737-46345c09c238": "best", "3af9b8d9-7c97-431d-ad78-34a8bfea439f": "efficiency"}
_OVERLAY_GUID = {"efficiency": "961cc777-2547-4f9d-8174-7d86181b8a7a", "balanced": "00000000-0000-0000-0000-000000000000",
                 "best": "ded574b5-45a0-4f42-8737-46345c09c238"}
_PS_KEY = r"SYSTEM\CurrentControlSet\Control\Power\User\PowerSchemes"
_VIS = {0: "auto", 1: "appearance", 2: "performance", 3: "custom"}


def _overlay(name):
    v = registry.get_value(winreg.HKEY_LOCAL_MACHINE, _PS_KEY, name)
    return _OVERLAY.get(str(v).lower(), "balanced") if v else "balanced"


def _plans():
    code, out = rsys.run(["powercfg", "/list"])
    plans = []
    for m in re.finditer(r"([0-9a-f]{8}-[0-9a-f-]{27})\s+\(([^)]+)\)\s*(\*)?", out, re.I):
        plans.append({"guid": m.group(1), "name": m.group(2), "on": bool(m.group(3))})
    code, a = rsys.run(["powercfg", "/a"])
    standby = "S0" in a.split("\n\n")[0] if a else False
    return plans, standby


def _bg_apps():
    base = r"Software\Microsoft\Windows\CurrentVersion\BackgroundAccessApplications"
    names = {}
    for a in ps_json("Get-StartApps | Select-Object Name, AppID", timeout=30, as_list=True):
        if "!" in (a.get("AppID") or ""):
            names.setdefault(a["AppID"].split("!")[0], a["Name"])
    out = []
    for pfn in registry.subkeys(winreg.HKEY_CURRENT_USER, base):
        if pfn not in names:
            continue
        p = f"{base}\\{pfn}"
        dbu = registry.get_value(winreg.HKEY_CURRENT_USER, p, "DisabledByUser")
        dis = registry.get_value(winreg.HKEY_CURRENT_USER, p, "Disabled")
        v = "never" if dbu == 1 or dis == 1 else ("always" if dbu == 0 and dis == 0 else "opt")
        out.append({"id": pfn, "n": names[pfn], "v": v})
    out.sort(key=lambda x: x["n"].lower())
    return out


def perf_read():
    plans, standby = _plans()
    gm = registry.get_value(winreg.HKEY_CURRENT_USER, r"Software\Microsoft\GameBar", "AutoGameModeEnabled")
    hags = registry.get_value(winreg.HKEY_LOCAL_MACHINE, r"SYSTEM\CurrentControlSet\Control\GraphicsDrivers", "HwSchMode")
    vis = registry.get_value(winreg.HKEY_CURRENT_USER, r"Software\Microsoft\Windows\CurrentVersion\Explorer\VisualEffects", "VisualFXSetting")
    return {"ac": _overlay("ActiveOverlayAcPowerScheme"), "dc": _overlay("ActiveOverlayDcPowerScheme"),
            "plans": plans, "standby": standby, "visual": _VIS.get(vis if isinstance(vis, int) else 0, "auto"),
            "gameMode": gm != 0, "hags": hags == 2 if hags is not None else None, "bg": _bg_apps(), "admin": _admin()}


class _GUID(ctypes.Structure):
    _fields_ = [("Data1", ctypes.c_ulong), ("Data2", ctypes.c_ushort), ("Data3", ctypes.c_ushort), ("Data4", ctypes.c_ubyte * 8)]


def _guid(s):
    import uuid
    u = uuid.UUID(s)
    g = _GUID()
    g.Data1, g.Data2, g.Data3 = u.fields[0], u.fields[1], u.fields[2]
    for i, b in enumerate(u.bytes[8:]):
        g.Data4[i] = b
    return g


def _plugged():
    import psutil
    b = psutil.sensors_battery()
    return True if b is None else bool(b.power_plugged)


def _apply_visual(mode):
    spi = ctypes.windll.user32.SystemParametersInfoW
    on = mode != "performance"

    class ANIMATIONINFO(ctypes.Structure):
        _fields_ = [("cbSize", ctypes.c_uint), ("iMinAnimate", ctypes.c_int)]
    ai = ANIMATIONINFO(ctypes.sizeof(ANIMATIONINFO), 1 if on else 0)
    spi(0x0049, ai.cbSize, ctypes.byref(ai), 3)  # SPI_SETANIMATION
    for code in (0x1043, 0x1025, 0x1003, 0x1017, 0x1005, 0x1007, 0x101B):  # client areas, shadows, menus, tooltips, combo boxes, lists, cursor
        spi(code, 0, ctypes.c_void_p(1 if on else 0), 3)


def perf_set(key, value):
    """Changes a performance setting in the same place Windows stores it. Returns the state read back again."""
    prev = perf_read()
    if key in ("ac", "dc"):
        if value not in _OVERLAY_GUID:
            raise ValueError(value)
        current_src = "ac" if _plugged() else "dc"
        if key == current_src:
            r = ctypes.windll.powrprof.PowerSetActiveOverlayScheme(ctypes.byref(_guid(_OVERLAY_GUID[value])))
            if r != 0:
                raise OSError(f"Windows didn't accept the mode (code {r})")
        else:
            if not _admin():
                return _need_admin()
            name = "ActiveOverlayAcPowerScheme" if key == "ac" else "ActiveOverlayDcPowerScheme"
            with winreg.CreateKeyEx(winreg.HKEY_LOCAL_MACHINE, _PS_KEY, 0, winreg.KEY_SET_VALUE | V64) as k:
                winreg.SetValueEx(k, name, 0, winreg.REG_SZ, _OVERLAY_GUID[value])
    elif key == "visual":
        inv = {v: k for k, v in _VIS.items()}
        if value not in inv:
            raise ValueError(value)
        with winreg.CreateKeyEx(winreg.HKEY_CURRENT_USER, r"Software\Microsoft\Windows\CurrentVersion\Explorer\VisualEffects", 0, winreg.KEY_SET_VALUE) as k:
            winreg.SetValueEx(k, "VisualFXSetting", 0, winreg.REG_DWORD, inv[value])
        _apply_visual(value)
    elif key == "gameMode":
        with winreg.CreateKeyEx(winreg.HKEY_CURRENT_USER, r"Software\Microsoft\GameBar", 0, winreg.KEY_SET_VALUE) as k:
            winreg.SetValueEx(k, "AutoGameModeEnabled", 0, winreg.REG_DWORD, 1 if value else 0)
    elif key == "hags":
        if not _admin():
            return _need_admin()
        with winreg.CreateKeyEx(winreg.HKEY_LOCAL_MACHINE, r"SYSTEM\CurrentControlSet\Control\GraphicsDrivers", 0, winreg.KEY_SET_VALUE | V64) as k:
            winreg.SetValueEx(k, "HwSchMode", 0, winreg.REG_DWORD, 2 if value else 1)
    else:
        raise ValueError(key)
    now = perf_read()
    now["prev"] = {key: prev.get(key)}
    return now


def power_plan_set(guid):
    if not re.fullmatch(r"[0-9a-fA-F-]{36}", guid or ""):
        raise ValueError(guid)
    code, out = rsys.run(["powercfg", "/setactive", guid])
    if code != 0:
        raise OSError(out.strip()[:200])
    return perf_read()


def bg_set(pfn, mode):
    base = rf"Software\Microsoft\Windows\CurrentVersion\BackgroundAccessApplications\{pfn}"
    with winreg.CreateKeyEx(winreg.HKEY_CURRENT_USER, base, 0, winreg.KEY_SET_VALUE) as k:
        if mode == "never":
            winreg.SetValueEx(k, "DisabledByUser", 0, winreg.REG_DWORD, 1)
            winreg.SetValueEx(k, "Disabled", 0, winreg.REG_DWORD, 1)
        elif mode == "always":
            winreg.SetValueEx(k, "DisabledByUser", 0, winreg.REG_DWORD, 0)
            winreg.SetValueEx(k, "Disabled", 0, winreg.REG_DWORD, 0)
        elif mode == "opt":
            for n in ("DisabledByUser", "Disabled"):
                try:
                    winreg.DeleteValue(k, n)
                except OSError:
                    pass
        else:
            raise ValueError(mode)
    return {"ok": True}
