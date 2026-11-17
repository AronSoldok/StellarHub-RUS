"""Motor del Super Optimizer: limpieza, arranque, servicios, registro, reparación y rendimiento. De verdad.

Reglas: lo que cambia el sistema guarda antes una copia para deshacer (estado de servicios, .reg, ajustes previos);
lo que exige administrador lo comprueba y devuelve {"needAdmin": True} en vez de fallar a medias; nunca se tocan
servicios fuera de una lista cerrada ni claves del registro que no estén rotas de verdad.
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


# =============================================================== limpieza
def clean_scan(job):
    """Mide de verdad cada categoría del limpiador (sin borrar nada)."""
    cats = cleaner.categories()
    out = []

    def on_item(it):
        c = cats[it["id"]]
        dirs, files = ([], []) if c.get("recycle") else cleaner._expand(c)
        pths = [_short(d) for d in dirs[:4]] + [_short(f) for f in files[:2]]
        if c.get("recycle"):
            pths = ["Todas las unidades"]
        out.append({"id": it["id"], "g": it["group"], "label": it["label"], "size": it["size"], "files": it["count"],
                    "def": bool(c.get("default")), "admin": bool(c.get("admin")), "needs_admin": it["needs_admin"],
                    "busy": it["process"] if it["busy"] else "", "desc": it["desc"] or _DESC.get(it["id"], ""),
                    "paths": pths or ["(no existe en este equipo)"]})
        job.progress(len(out) / len(cats), it["label"], done=len(out))

    cleaner.scan(on_item=on_item)
    order = list(cats)
    out.sort(key=lambda x: order.index(x["id"]))
    return out


_DESC = {
    "win_temp": "Restos de instalaciones y tareas del sistema.",
    "dumps": "Copias de memoria de programas que se cerraron mal. Solo sirven para depurar.",
    "do_cache": "Trozos de actualizaciones que tu PC comparte con otros equipos.",
    "recycle": "Lo que borraste. Después de vaciarla no se puede recuperar.",
    "chrome": "Caché de páginas, código y GPU. No toca contraseñas, historial ni pestañas.",
    "edge": "Caché de páginas, código y GPU. No toca contraseñas, historial ni pestañas.",
    "brave": "Caché de páginas, código y GPU. No toca contraseñas, historial ni pestañas.",
    "opera": "Caché de páginas.", "firefox": "Caché de páginas y de arranque.",
    "discord": "Imágenes y vídeos ya vistos.",
    "spotify": "Canciones en caché que no están descargadas para escuchar sin conexión.",
    "steam_web": "Caché de la tienda y la comunidad.",
}


def clean(job, ids):
    """Limpia las categorías elegidas, una a una, avisando de lo liberado. Los archivos en uso se saltan."""
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
        job.progress(n / max(1, len(ids)), f"Limpiando {c['label'].lower()}…", id=cid, freed=total["freed"])
        r = cleaner.clean([cid])
        total["per"][cid] = r["freed"]
        for k in ("freed", "deleted", "skipped"):
            total[k] += r[k]
        job.progress((n + 1) / max(1, len(ids)), c["label"], id=cid, freed=total["freed"], catFreed=r["freed"], force=True)
    return total


# =============================================================== arranque
_PF_TASK = r"Software\Classes\Local Settings\Software\Microsoft\Windows\CurrentVersion\AppModel\SystemAppData"
_IMPACT_CACHE = {}


def _packaged_startup():
    """Apps de la Tienda con tarea de inicio (lo que el Administrador de tareas lista además del Run y la carpeta)."""
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
                # 0 desactivada, 1 desactivada por el usuario, 2 activada, 3 desactivada por directiva, 4 activada por directiva
                on = state in (2, 4) if state is not None else default_on
                dn = names.get(pfn) or st.get("DisplayName") or p.get("Name")
                if dn and (dn.startswith("ms-resource:") or dn == p.get("Name")):
                    dn = (_resource(p, dn) if dn.startswith("ms-resource:") else None) or _manifest_name(p, root) or p.get("Name").split(".")[-1]
                out.append({"id": f"pkg|{pfn}|{tid}", "name": dn, "pub": p.get("Pub") or pubname, "on": on,
                            "origin": "tienda", "path": f"Tarea de inicio de la app ({tid})", "target": loc,
                            "locked": state in (3, 4)})
    with ThreadPoolExecutor(max_workers=8) as ex:
        list(ex.map(one, pk))
    return out


def _resource(p, ref):
    """Resuelve un 'ms-resource:' de una app de la Tienda a su texto (como hace el Explorador)."""
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
    """Impacto medido por Windows (lo mismo que usa el Administrador de tareas). Solo legible como administrador."""
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
            lvl = "alto" if cpu > 1000 or disk > 3e6 else "medio" if cpu > 300 or disk > 3e5 else "bajo"
            data[os.path.basename(name)] = lvl
    _IMPACT_CACHE.update(t=time.time(), d=data)
    return data


_REC = ("steam", "discord", "spotify", "epicgames", "onedrive", "teams", "skype", "adobe", "creative cloud",
        "battle.net", "origin", "ea desktop", "ubisoft", "dropbox", "googledrive", "zoom", "riot", "roblox")
_REVIEW = ("wscript.exe", "cscript.exe", "powershell.exe", "pwsh.exe", "cmd.exe", "mshta.exe", "rundll32.exe")


def startup_list(job):
    """Lo mismo que el Administrador de tareas > Aplicaciones de arranque: registro (Run), carpeta Inicio y apps de la Tienda."""
    job.progress(.1, "Registro y carpeta Inicio")
    base = [e for e in startup.list_entries() if e["type"] in ("run", "folder")]
    job.progress(.4, "Apps de la Tienda")
    try:
        pk = _packaged_startup()
    except Exception:
        pk = []
    job.progress(.85, "Impacto al arrancar")
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
        level = ("ninguno" if not on else imp.get(exe_name.lower(), "sin medir" if not measured else "bajo"))
        hk = "HKLM" if any(x["id"].startswith("run|HKLM") or x["id"].startswith("folder|HKLM") for x in es) else "HKCU"
        it = {"id": "grp|" + key, "ids": [x["id"] for x in es], "name": exe_name, "pub": e.get("company") or "",
              "on": on, "impact": level, "origin": "carpeta" if e["type"] == "folder" else "registro",
              "path": (f"{e['where']}: {e['name']}" if len(es) == 1 else f"{e['where']}"),
              "target": e.get("exe") or "", "hklm": hk == "HKLM", "missing": any(x.get("missing") for x in es),
              "children": [x["command"] for x in es] if len(es) > 1 or e["type"] == "folder" else [],
              "count": len(es) if len(es) > 1 else 0}
        if exe_name.lower() in _REVIEW:
            it["review"] = True
            it["note"] = "Ejecuta un script al iniciar sesión. Revisa qué es antes de tocarlo: puede ser tuyo."
        if any(r in (exe_name + " " + it["pub"]).lower() for r in _REC) and on:
            it["rec"] = True
        if exe_name.lower() == "securityhealthsystray.exe":
            it["note"] = "El icono de Seguridad de Windows en la bandeja. Conviene dejarlo."
        items.append(it)
    for p in pk:
        p["ids"] = [p["id"]]
        p["impact"] = "ninguno" if not p["on"] else imp.get((p["name"] or "").lower() + ".exe", "sin medir" if not measured else "bajo")
        if p["on"] and any(r in (p["name"] + " " + p["pub"]).lower() for r in _REC):
            p["rec"] = True
        items.append(p)
    job.progress(1, "Listo")
    return {"items": items, "measured": measured, "admin": _admin()}


def startup_set(ids, enabled):
    """Habilita o deshabilita como el Administrador de tareas (reversible). ids: los de la entrada (puede ser un grupo)."""
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
    """Tiempo de BIOS del último arranque (lo mismo que enseña el Administrador de tareas) y los últimos arranques
    medidos por Windows (eso último necesita administrador)."""
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


# =============================================================== servicios
# Lista cerrada: solo estos se pueden cambiar desde StellarHub. Nada crítico del sistema.
SERVICES = [
    {"id": "DiagTrack", "svc": ["DiagTrack"], "name": "Telemetría de Windows", "desc": "Envía datos de uso y diagnóstico a Microsoft.", "bal": "disabled", "max": "disabled"},
    {"id": "dmwappushservice", "svc": ["dmwappushservice"], "name": "Mensajes de telemetría (WAP Push)", "desc": "Ayuda a la telemetría a recibir mensajes.", "bal": "disabled", "max": "disabled"},
    {"id": "Fax", "svc": ["Fax"], "name": "Fax", "desc": "Enviar y recibir faxes.", "bal": "disabled", "max": "disabled"},
    {"id": "RetailDemo", "svc": ["RetailDemo"], "name": "Modo demostración de tienda", "desc": "Solo lo usan los PC de exposición.", "bal": "disabled", "max": "disabled"},
    {"id": "MapsBroker", "svc": ["MapsBroker"], "name": "Mapas descargados", "desc": "Actualiza los mapas sin conexión de la app Mapas.", "bal": "manual", "max": "disabled"},
    {"id": "RemoteRegistry", "svc": ["RemoteRegistry"], "name": "Registro remoto", "desc": "Permite cambiar el registro desde otro equipo.", "bal": "disabled", "max": "disabled"},
    {"id": "WerSvc", "svc": ["WerSvc"], "name": "Informe de errores", "desc": "Envía a Microsoft los informes cuando algo falla.", "bal": None, "max": "disabled"},
    {"id": "Spooler", "svc": ["Spooler"], "name": "Cola de impresión", "desc": "Necesaria para imprimir.", "bal": "manual", "max": "disabled", "printers": True},
    {"id": "SysMain", "svc": ["SysMain"], "name": "SysMain (precarga de apps)", "desc": "Carga en memoria las apps que más usas. En un SSD rápido apenas se nota.", "bal": None, "max": "manual"},
    {"id": "WSearch", "svc": ["WSearch"], "name": "Indexado de búsqueda", "desc": "Prepara el índice para buscar archivos al instante.", "bal": None, "max": "manual", "warn": "Buscar archivos desde Inicio será más lento."},
    {"id": "Xbox", "svc": ["XblAuthManager", "XblGameSave", "XboxNetApiSvc", "XboxGipSvc"], "name": "Servicios de Xbox", "desc": "Inicio de sesión, partidas guardadas y red de Xbox Live.", "bal": None, "max": "manual", "warn": "Si juegas con Game Pass o la app de Xbox, déjalos."},
    {"id": "lfsvc", "svc": ["lfsvc"], "name": "Geolocalización", "desc": "Da tu ubicación a las apps que la piden.", "bal": None, "max": "disabled", "warn": "Las apps que usan tu ubicación dejarán de saberla."},
    {"id": "PhoneSvc", "svc": ["PhoneSvc"], "name": "Servicio de telefonía", "desc": "Llamadas desde el PC a través del móvil.", "bal": None, "max": "manual"},
    {"id": "WbioSrvc", "svc": ["WbioSrvc"], "name": "Biometría", "desc": "Huella y reconocimiento facial de Windows Hello.", "bal": None, "max": None, "warn": "Si usas huella o cara para entrar, no lo toques."},
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
                it["warn"] = f"Tienes impresoras instaladas ({', '.join(printers[:2])}): déjalo como está."
            else:
                it["desc"] += " Tu PC no tiene impresoras instaladas."
                it["warn"] = "Si algún día imprimes, vuelve a activarlo."
        out.append(it)
    return {"items": out, "admin": _admin()}


def services_apply(changes):
    """changes: {id_del_catálogo: 'auto'|'manual'|'disabled'}. Guarda el estado anterior y devuelve su id para deshacer."""
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


# =============================================================== registro
def _exists(p):
    p = os.path.expandvars((p or "").strip().strip('"'))
    return bool(p) and os.path.exists(p)


def _abs_missing(cmd):
    """El ejecutable de un comando si es una ruta absoluta que ya no existe; si no, None."""
    from .removal.safety import image_path
    exe = image_path(cmd or "")
    if not exe or not os.path.isabs(exe):
        return None
    if exe.lower().endswith(("msiexec.exe", "rundll32.exe")):
        return None
    return exe if not os.path.exists(exe) else None


def registry_scan(job):
    """Busca entradas rotas de verdad (apuntan a archivos que ya no existen). No cambia nada."""
    groups = {}

    def add(g, ref, why):
        groups.setdefault(g, []).append({"id": ref.to_str(), "k": ref.display(), "why": why})

    HK = winreg.HKEY_LOCAL_MACHINE
    # 1. desinstaladores rotos
    job.progress(.05, "Desinstaladores")
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
                add("Desinstaladores rotos", RegRef(hive, p, view), f"«{name}»: el desinstalador {miss} ya no existe.")
    # 2. App Paths
    job.progress(.25, "Rutas de programa")
    for hive, root, view in (("HKLM", HK, V64), ("HKLM", HK, V32), ("HKCU", winreg.HKEY_CURRENT_USER, 0)):
        base = r"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths"
        for sub in registry.subkeys(root, base, view):
            p = f"{base}\\{sub}"
            d = registry.get_value(root, p, "", view)
            if not d:
                continue
            target = os.path.expandvars(str(d).strip().strip('"'))
            if os.path.isabs(target) and not os.path.exists(target):
                add("Rutas de programa rotas", RegRef(hive, p, view), f"Apunta a {target}, que ya no existe.")
    # 3. inicio que apunta a nada
    job.progress(.45, "Inicio")
    for hive, root, view in (("HKCU", winreg.HKEY_CURRENT_USER, 0), ("HKLM", HK, V64), ("HKLM", HK, V32)):
        base = r"SOFTWARE\Microsoft\Windows\CurrentVersion\Run"
        for name, data, _ in registry.values(root, base, view):
            miss = _abs_missing(str(data))
            if miss:
                add("Inicio que apunta a nada", RegRef(hive, base, view, name), f"Arranca {miss}, que no existe.")
    # 4. archivos compartidos inexistentes
    job.progress(.6, "Archivos compartidos")
    for view in (V64, V32):
        base = r"SOFTWARE\Microsoft\Windows\CurrentVersion\SharedDLLs"
        for name, data, _ in registry.values(HK, base, view):
            if os.path.isabs(name) and not os.path.exists(name):
                add("Archivos compartidos inexistentes", RegRef("HKLM", base, view, name), "El archivo ya no existe.")
    # 5. tipos de archivo huérfanos (solo los del usuario)
    job.progress(.75, "Tipos de archivo")
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
            add("Tipos de archivo huérfanos", RegRef("HKCU", f"{cls}\\{sub}"), f"Dice que lo abre «{prog}», que ya no existe.")
    for sub in registry.subkeys(cu, cls):
        if sub.startswith(".") or sub.startswith("{"):
            continue
        cmd = registry.get_value(cu, f"{cls}\\{sub}\\shell\\open\\command", "")
        miss = _abs_missing(str(cmd)) if cmd else None
        if miss:
            add("Tipos de archivo huérfanos", RegRef("HKCU", f"{cls}\\{sub}"), f"Clase de un programa que ya no está ({miss}).")
    # 6. menú contextual roto
    job.progress(.88, "Menú contextual")
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
                    add("Menú contextual roto", RegRef(hive, f"{hp}\\{h}"), f"Añade «{h}» al clic derecho, pero {os.path.basename(path)} ya no existe.")
    job.progress(1, "Listo")
    order = ["Desinstaladores rotos", "Rutas de programa rotas", "Tipos de archivo huérfanos", "Inicio que apunta a nada",
             "Archivos compartidos inexistentes", "Menú contextual roto"]
    return [{"g": g, "items": groups[g]} for g in order if g in groups]


def registry_fix(job, ids):
    """Exporta cada clave a .reg y luego borra la entrada rota. Devuelve la carpeta de la copia (para deshacer)."""
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
    job.progress(1, "Listo")
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


# =============================================================== reparación
def _stream(job, cmd, pct_re=r"(\d{1,3}(?:[.,]\d)?)\s*%", weight=(0.0, 1.0)):
    """Ejecuta mostrando cada línea al momento (también las que se reescriben con \\r, como el % de SFC y DISM)."""
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
                    continue  # barras de progreso de DISM: solo actualizan el %
            job.log(line)
        if job.cancelled:
            p.kill()
            job.stop()
    if buf.strip():
        job.log(buf.strip())
    return p.wait()


def _restart_explorer(job):
    subprocess.run(["taskkill", "/f", "/im", "explorer.exe"], capture_output=True, creationflags=NO_WINDOW)
    job.log("Explorador cerrado.")
    for _ in range(12):  # Windows lo vuelve a abrir solo (AutoRestartShell)
        time.sleep(.5)
        if any(p["name"].lower() == "explorer.exe" for p in rsys.list_processes()):
            job.log("Explorador abierto de nuevo.")
            return
    # si no volvió: se abre con un token sin elevar (abrirlo desde un proceso admin lo dejaría elevado)
    subprocess.Popen(["runas", "/trustlevel:0x20000", "explorer.exe"], creationflags=NO_WINDOW)
    job.log("Explorador abierto de nuevo.")


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
            job.progress(.05 + i * .08, f"Deteniendo {s}")
            _stream(job, ["net", "stop", s, "/y"], weight=(0, 0))
        stamp = time.strftime("%Y%m%d%H%M%S")
        for i, d in enumerate([os.path.join(win, "SoftwareDistribution"), os.path.join(win, "System32", "catroot2")]):
            job.progress(.45 + i * .12, f"Renombrando {os.path.basename(d)}")
            try:
                os.rename(d, f"{d}.old-{stamp}")
                job.log(f"{d} → {os.path.basename(d)}.old-{stamp}")
            except OSError as e:
                job.log(f"No se pudo renombrar {d}: {e}")
        for i, s in enumerate(reversed(svcs)):
            job.progress(.75 + i * .06, f"Arrancando {s}")
            _stream(job, ["net", "start", s], weight=(0, 0))
        job.log("Windows Update está listo para volver a buscar.")
        code = 0
    elif rid == "net":
        job.progress(.1, "DNS")
        _stream(job, ["ipconfig", "/flushdns"], weight=(0, 0))
        job.progress(.4, "Winsock")
        _stream(job, ["netsh", "winsock", "reset"], weight=(0, 0))
        job.progress(.7, "TCP/IP")
        _stream(job, ["netsh", "int", "ip", "reset"], weight=(0, 0))
        job.log("Hecho. Reinicia el PC para terminar.")
        code = 0
    elif rid == "icons":
        local = os.environ.get("LOCALAPPDATA", "")
        job.progress(.1, "Cerrando el Explorador")
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
        job.log(f"{n} archivos de caché de iconos borrados.")
        job.progress(.55, "Caché de fuentes")
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
            job.log("La caché de fuentes necesita el modo administrador: se salta.")
        subprocess.run(["ie4uinit.exe", "-show"], capture_output=True, creationflags=NO_WINDOW)
        job.progress(.85, "Abriendo el Explorador")
        _restart_explorer(job)
        code = 0
    elif rid == "explorer":
        job.progress(.3, "Reiniciando el Explorador")
        _restart_explorer(job)
        code = 0
    else:
        raise ValueError(rid)
    job.progress(1, "Listo")
    return {"code": code}


def restore_point(job, desc="StellarHub, antes de optimizar"):
    if not _admin():
        return _need_admin()
    job.progress(.1, "Creando el punto de restauración…")
    ok, out = rsys.create_restore_point(desc)
    job.progress(1, "Listo")
    return {"ok": ok, "msg": out[-300:]}


# =============================================================== rendimiento
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
    for code in (0x1043, 0x1025, 0x1003, 0x1017, 0x1005, 0x1007, 0x101B):  # áreas, sombras, menús, tooltips, combos, listas, cursor
        spi(code, 0, ctypes.c_void_p(1 if on else 0), 3)


def perf_set(key, value):
    """Cambia un ajuste de rendimiento en el mismo sitio donde lo guarda Windows. Devuelve el estado leído de nuevo."""
    prev = perf_read()
    if key in ("ac", "dc"):
        if value not in _OVERLAY_GUID:
            raise ValueError(value)
        current_src = "ac" if _plugged() else "dc"
        if key == current_src:
            r = ctypes.windll.powrprof.PowerSetActiveOverlayScheme(ctypes.byref(_guid(_OVERLAY_GUID[value])))
            if r != 0:
                raise OSError(f"Windows no aceptó el modo (código {r})")
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
