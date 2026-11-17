"""Program Remover: el motor real (heredado de MiniRevo, en stellarhub/engine/removal) visto desde la interfaz.

Llamadas rápidas (EXPORTS) y tareas largas (JOBS, reciben `job`). Las tareas avisan de su avance con
job.progress(pct, texto, **datos); los datos van en el mensaje 'job' de la interfaz.
Nada de esto borra sin que la interfaz lo pida explícitamente (desinstalar, eliminar restos, vaciar).
"""
import csv
import ctypes
import os
import shutil
import subprocess
import threading
import time
import urllib.parse
import webbrowser
import winreg
from ctypes import wintypes

from .removal import (hunter, index, monitor, paths, quarantine, registry, scanner, settings, system, uninstaller)
from .removal import icons as _icons
from .removal import programs as _pm
from .removal.registry import RegRef

EXPORTS = {"init", "programs", "icons", "details", "quarantine_list", "quarantine_delete", "quarantine_empty",
           "history", "clear_history", "set_settings", "traces", "trace_rename", "trace_delete", "hunter_file",
           "open_path", "open_regedit", "search_web", "export_programs", "forget_scan"}
JOBS = {"background", "scan", "remove", "uninstall", "batch_uninstall", "monitor_start", "monitor_stop",
        "trace_scan", "quarantine_restore", "hunter_window"}

UI_FIELDS = ("id", "name", "version", "publisher", "location", "size", "date", "kind", "kind_label", "source",
             "arch", "user", "protected", "broken", "orphan", "no_uninstaller", "can_quiet", "url",
             "location_inferred", "msi_code", "no_remove")

_progs = {}
_progs_lock = threading.Lock()
_scans = {}              # clave -> {"program": p, "items": [...]}
_migrated = False


class _Cancel:
    """El motor de MiniRevo espera un threading.Event; aquí la cancelación vive en el job."""
    def __init__(self, job):
        self.job = job

    def is_set(self):
        return bool(self.job and self.job.cancelled)

    def set(self):
        if self.job:
            self.job.cancelled = True


def _ui(p):
    return {k: p.get(k) for k in UI_FIELDS}


def _all():
    with _progs_lock:
        return list(_progs.values())


def _get(pid):
    with _progs_lock:
        p = _progs.get(pid)
    if not p:
        if not _progs:
            programs_list()  # la lista se perdió (p. ej. tras recargar): se rehace
            with _progs_lock:
                p = _progs.get(pid)
    if not p:
        raise KeyError("Programa no encontrado; actualiza la lista")
    return p


def _progress(job, **extra):
    def cb(frac, label=""):
        job.check()
        job.progress(frac, label, **extra)
    return cb


# ------------------------------------------------------------ arranque y ajustes
def _migrate():
    """Una sola vez: lo que había guardado MiniRevo (cuarentena, historial, rastreos, cachés) pasa a StellarHub."""
    global _migrated
    if _migrated:
        return
    _migrated = True
    old = os.path.join(os.environ.get("ProgramData", r"C:\ProgramData"), "MiniRevo")
    new = paths.DATA_DIR
    mark = os.path.join(new, ".migrado")
    if not os.path.isdir(old) or os.path.exists(mark) or os.path.normcase(old) == os.path.normcase(new):
        return
    try:
        os.makedirs(new, exist_ok=True)
        for name in ("quarantine", "monitor", "cache"):
            src, dst = os.path.join(old, name), os.path.join(new, name)
            if os.path.isdir(src) and not os.path.exists(dst):
                shutil.copytree(src, dst)
        for name in ("history.jsonl", "settings.json"):
            src, dst = os.path.join(old, name), os.path.join(new, name)
            if os.path.isfile(src) and not os.path.exists(dst):
                shutil.copy2(src, dst)
        with open(mark, "w", encoding="utf-8") as fh:
            fh.write(time.strftime("%Y-%m-%d %H:%M:%S"))
    except OSError as e:
        print("remover: migración incompleta:", e)


def init():
    _migrate()
    s = settings.load()
    try:
        purged = quarantine.purge(int(s["quarantine_days"]))
    except Exception:
        purged = 0
    return {"admin": system.is_admin(), "settings": s, "pending_reboot": system.pending_reboot(),
            "quarantine": quarantine.stats(), "purged": purged}


def set_settings(changes):
    return settings.save(changes or {})


# ------------------------------------------------------------ programas
def programs_list(fresh=False):
    """Win32 al momento + Tienda de la caché; los iconos que estén en caché van incluidos."""
    _migrate()
    win = _pm.get_win32_programs()
    store = _pm.cached_store_apps() if settings.load().get("show_store", True) else []
    with _progs_lock:
        keep = {k: v for k, v in _progs.items() if v.get("source") == "store"}
        _progs.clear()
        _progs.update({p["id"]: p for p in win})
        _progs.update(keep or {p["id"]: p for p in store})
        progs = sorted(_progs.values(), key=lambda p: p["name"].lower())
    out = []
    for p in progs:
        s = _pm.real_size(p, cached_only=True)
        if s:
            p["size"] = s
        d = _ui(p)
        d["icon"] = _icons.get_icon(p, extract=False)
        out.append(d)
    return out


def programs(fresh=False):
    """Nombre público para la interfaz: remover.programs()."""
    return programs_list(fresh)


def icons(ids):
    """Iconos reales (data URI PNG) de los programas pedidos; extrae los que no estén en caché."""
    out = {}
    for pid in ids or []:
        with _progs_lock:
            p = _progs.get(pid)
        if p:
            ic = _icons.get_icon(p)
            if ic:
                out[pid] = ic
    return out


def background(job):
    """Después de pintar la lista: iconos que faltan, apps de la Tienda actualizadas y tamaños reales.
    Todo llega a la interfaz por lotes en job.progress(..., icons=..., sizes=..., store=...)."""
    if not _progs:
        programs_list()
    # 1. iconos
    missing = [p for p in _all() if not _icons.get_icon(p, extract=False)]
    batch = {}
    for n, p in enumerate(missing):
        job.check()
        ic = _icons.get_icon(p)
        if ic:
            batch[p["id"]] = ic
        if len(batch) >= 10:
            job.progress(n / max(1, len(missing)) * .3, "Iconos", force=True, icons=batch, sizes={}, store=None)
            batch = {}
    if batch:
        job.progress(.3, "Iconos", force=True, icons=batch, sizes={}, store=None)
    threading.Thread(target=index.warm, daemon=True, name="index-warm").start()
    # 2. Tienda
    if settings.load().get("show_store", True):
        job.check()
        store = _pm.get_store_apps()
        if store:
            _pm.save_store_cache(store)
            with _progs_lock:
                for k in [k for k, v in _progs.items() if v.get("source") == "store"]:
                    del _progs[k]
                for p in store:
                    _progs[p["id"]] = p
            job.progress(.45, "Tienda", force=True, icons={}, sizes={},
                         store=[{**_ui(p), "icon": _icons.get_icon(p, extract=False)} for p in store])
            sb = {}
            for p in store:
                job.check()
                if not _icons.get_icon(p, extract=False):
                    ic = _icons.get_icon(p)
                    if ic:
                        sb[p["id"]] = ic
            if sb:
                job.progress(.5, "Iconos de la Tienda", force=True, icons=sb, sizes={}, store=None)
    # 3. tamaños reales en disco
    from concurrent.futures import ThreadPoolExecutor, as_completed
    progs = _all()
    sizes, last, done = {}, time.time(), 0
    with ThreadPoolExecutor(max_workers=4) as ex:
        futs = {ex.submit(_pm.real_size, p): p for p in progs}
        for fut in as_completed(futs):
            if job.cancelled:
                break
            done += 1
            p = futs[fut]
            try:
                s = fut.result()
            except Exception:
                s = None
            if s and s != p.get("size"):
                p["size"] = s
                sizes[p["id"]] = s
            if sizes and time.time() - last > 0.3:
                job.progress(.5 + .5 * done / max(1, len(progs)), "Tamaños", force=True, icons={}, sizes=sizes, store=None)
                sizes, last = {}, time.time()
    _pm.save_size_cache()
    if sizes:
        job.progress(1, "Tamaños", force=True, icons={}, sizes=sizes, store=None)
    return True


def details(pid):
    p = _get(pid)
    info = uninstaller.prepare(p)
    key = RegRef.from_str(p["key"]).display() if p.get("key") else ""
    return {**_ui(p), **info, "key_display": key, "package": p.get("package", ""),
            "uninstall_string": p.get("uninstall", ""), "quiet_string": p.get("quiet", "")}


# ------------------------------------------------------------ restos
def _scan_into(key, p, level, job, still=None, base=0.0, span=1.0, step=None):
    def prog(frac, label=""):
        job.check()
        job.progress(base + span * frac, label, step=step or "scan", label=label)
    res = scanner.scan(p, _all(), level=level, still_installed=still, progress=prog)
    _scans[key] = {"program": p, "items": res["items"]}
    res["key"] = key
    res["program"] = _ui(p)
    return res


def scan(job, pid, level="moderate"):
    """Busca restos de un programa (sin tocar nada)."""
    return _scan_into(pid, _get(pid), level, job)


def forget_scan(key):
    _scans.pop(key, None)
    return True


def remove(job, scan_key, item_ids):
    """Elimina los restos elegidos de un escaneo. Por defecto van a la cuarentena (se pueden restaurar)."""
    sc = _scans.get(scan_key)
    if not sc:
        raise KeyError("El escaneo caducó; vuelve a escanear")
    wanted = set(item_ids or [])
    items = [i for i in sc["items"] if i["id"] in wanted and not i.get("blocked")]
    s = settings.load()
    p = sc["program"]
    excl = [paths.norm_path(x) for x in s.get("exclusions", [])]
    items = [i for i in items if not (i["kind"] in ("file", "folder") and
                                      any(paths.is_within(i["target"], e) for e in excl))]
    res = quarantine.remove(p, items, _all(), mode=s["delete_mode"],
                            progress=lambda f, l="": job.progress(f, l))
    settings.log("remove", p.get("name", "?"), {"ok": res["ok"], "failed": res["failed"], "freed": res["freed"],
                                                 "session": res["session"], "mode": s["delete_mode"]})
    _scans.pop(scan_key, None)
    return res


# ------------------------------------------------------------ desinstalación
def _step(job, step, status, detail=""):
    job.progress(None, detail or status, force=True, step=step, status=status, detail=detail)


def uninstall(job, pid, opts=None):
    """Punto de restauración -> cerrar el programa -> desinstalador oficial (esperando a todos sus procesos)
    -> escaneo de restos. Los restos NO se borran aquí: la interfaz los muestra y el usuario elige."""
    opts = opts or {}
    p = _get(pid)
    mode = opts.get("mode", "normal")  # normal | quiet | forced
    level = opts.get("level", settings.load()["default_level"])
    out = {"program": _ui(p), "mode": mode}
    prot = p.get("protected") or {}
    if prot.get("blocked"):
        raise PermissionError("Este componente es esencial para Windows y no se puede desinstalar")
    if mode == "forced" and prot.get("no_force"):
        raise PermissionError("Por seguridad, este programa solo se puede quitar con su desinstalador oficial")
    if opts.get("restore_point", True) and p.get("source") != "store":
        _step(job, "restore", "running")
        ok, msg = system.create_restore_point(f"StellarHub: {p['name']}") if system.is_admin() else (
            False, "Hacen falta permisos de administrador")
        _step(job, "restore", "done" if ok else "warn", "" if ok else (msg or "")[-200:])
        out["restore_point"] = ok
    else:
        _step(job, "restore", "skipped")
    job.check()
    _step(job, "close", "running")
    closed = uninstaller.close_processes(p)
    _step(job, "close", "done", ", ".join(closed))
    out["closed"] = closed
    if mode != "forced":
        _step(job, "uninstall", "running")
        r = uninstaller.uninstall(p, quiet=(mode == "quiet"), cancel=_Cancel(job),
                                  on_tick=lambda s, n: _step(job, "uninstall", "running", f"{int(s)} s, {n} proceso(s)"))
        out["uninstall"] = r
        if r.get("cancelled"):
            _step(job, "uninstall", "warn", "Cancelado")
            return {**out, "cancelled": True}
        _step(job, "uninstall", "done" if r.get("ok") else "warn",
              "" if r.get("ok") else ("El programa sigue registrado" if r.get("still_registered") else r.get("error", "")))
        settings.log("uninstall", p["name"], {"ok": r.get("ok"), "seconds": r.get("seconds"), "mode": mode})
    else:
        _step(job, "uninstall", "skipped")
        settings.log("uninstall", p["name"], {"ok": True, "mode": "forced"})
    _step(job, "scan", "running")
    still = uninstaller.still_registered(p) if mode != "forced" else False
    res = _scan_into(pid, p, level, job, still=still, step="scan")
    _step(job, "scan", "done", f"{len(res['items'])} elementos")
    out["scan"] = res
    out["still_registered"] = still
    return out


def batch_uninstall(job, pids, opts=None):
    opts = opts or {}
    level = opts.get("level", "safe")
    if opts.get("restore_point", True) and system.is_admin():
        _step(job, "restore", "running")
        ok, msg = system.create_restore_point(f"StellarHub: {len(pids)} programas")
        _step(job, "restore", "done" if ok else "warn", "" if ok else (msg or "")[-200:])
    results = []
    for n, pid in enumerate(pids):
        if job.cancelled:
            break
        p = _get(pid)
        job.progress(n / max(1, len(pids)), p["name"], force=True, index=n, total=len(pids), pid=pid, status="running")
        entry = {"program": _ui(p)}
        try:
            if (p.get("protected") or {}).get("blocked"):
                raise PermissionError("Componente esencial de Windows")
            uninstaller.close_processes(p)
            quiet = bool(opts.get("quiet", True)) and p.get("can_quiet")
            r = uninstaller.uninstall(p, quiet=quiet, cancel=_Cancel(job))
            entry["uninstall"] = r
            still = uninstaller.still_registered(p)
            sc = scanner.scan(p, _all(), level=level, still_installed=still)
            _scans[pid] = {"program": p, "items": sc["items"]}
            sc["key"] = pid
            entry["scan"] = sc
            settings.log("uninstall", p["name"], {"ok": r.get("ok"), "mode": "batch"})
            status = "done" if r.get("ok") else "warn"
        except Exception as e:
            entry["error"] = str(e)
            status = "error"
        results.append(entry)
        job.progress((n + 1) / max(1, len(pids)), p["name"], force=True, index=n, total=len(pids), pid=pid, status=status)
    return {"results": results}


# ------------------------------------------------------------ instalación vigilada
def monitor_start(job, name):
    job.progress(.1, "Tomando la foto inicial", force=True)
    return monitor.start(name)


def monitor_stop(job, mid):
    job.progress(.1, "Comparando las fotos", force=True)
    r = monitor.stop(mid)
    settings.log("watch", (r or {}).get("name") if isinstance(r, dict) else str(mid), {})
    return r


def traces():
    return monitor.traces()


def trace_rename(mid, name):
    monitor.rename(mid, name)
    return True


def trace_delete(mid):
    monitor.delete(mid)
    return True


def trace_scan(job, mid):
    if not _progs:
        programs_list()
    meta = next((t for t in monitor.traces() if t["id"] == mid), {"name": "Rastreo"})
    items = monitor.trace_items(mid, _all())
    key = f"trace:{mid}"
    _scans[key] = {"program": {"name": meta["name"], "id": key}, "items": items}
    return {"key": key, "items": items, "name": meta["name"],
            "total_size": sum(i.get("size", 0) for i in items if not i["blocked"])}


# ------------------------------------------------------------ cuarentena e historial
def quarantine_list():
    return quarantine.sessions()


def quarantine_restore(job, sid, only=None):
    r = quarantine.restore(sid, lambda f, l="": job.progress(f, l), only=only)
    settings.log("restore", sid, {"ok": r["ok"], "failed": r["failed"], "partial": bool(only)})
    return r


def quarantine_delete(sid):
    quarantine.delete_session(sid)
    settings.log("delete_session", sid, {})
    return True


def quarantine_empty():
    n = 0
    for s in quarantine.sessions():
        quarantine.delete_session(s["id"])
        n += s.get("count", 0)
    settings.log("empty", "Cuarentena vaciada", {"items": n})
    return n


def history():
    return settings.history()


def clear_history():
    settings.clear_history()
    return True


# ------------------------------------------------------------ modo cazador
_u32 = ctypes.windll.user32


def hunter_window(job):
    """Minimiza StellarHub, cuenta 3 s y mira qué ventana queda bajo el cursor."""
    me = _u32.GetForegroundWindow()
    if me:
        _u32.ShowWindow(me, 6)  # SW_MINIMIZE
    for n in (3, 2, 1):
        job.check()
        job.progress((3 - n) / 3, str(n), force=True, count=n)
        time.sleep(1)
    info = hunter.window_at_cursor()
    if me:
        _u32.ShowWindow(me, 9)  # SW_RESTORE
        _u32.SetForegroundWindow(me)
    if not _progs:
        programs_list()
    if not info or not info.get("path"):
        return {"found": False, "info": info}
    p = hunter.find_program(info["path"], _all())
    return {"found": bool(p), "info": info, "program": _ui(p) if p else None}


class _OFN(ctypes.Structure):
    _fields_ = [("lStructSize", wintypes.DWORD), ("hwndOwner", wintypes.HWND), ("hInstance", wintypes.HINSTANCE),
                ("lpstrFilter", wintypes.LPCWSTR), ("lpstrCustomFilter", wintypes.LPWSTR), ("nMaxCustFilter", wintypes.DWORD),
                ("nFilterIndex", wintypes.DWORD), ("lpstrFile", wintypes.LPWSTR), ("nMaxFile", wintypes.DWORD),
                ("lpstrFileTitle", wintypes.LPWSTR), ("nMaxFileTitle", wintypes.DWORD), ("lpstrInitialDir", wintypes.LPCWSTR),
                ("lpstrTitle", wintypes.LPCWSTR), ("Flags", wintypes.DWORD), ("nFileOffset", wintypes.WORD),
                ("nFileExtension", wintypes.WORD), ("lpstrDefExt", wintypes.LPCWSTR), ("lCustData", wintypes.LPARAM),
                ("lpfnHook", ctypes.c_void_p), ("lpTemplateName", wintypes.LPCWSTR), ("pvReserved", ctypes.c_void_p),
                ("dwReserved", wintypes.DWORD), ("FlagsEx", wintypes.DWORD)]


def _file_dialog(save, title, filt, default="", ext=""):
    """Diálogo nativo de Windows (abrir o guardar) sin depender de la ventana de pywebview."""
    buf = ctypes.create_unicode_buffer(default, 1024)
    ofn = _OFN()
    ofn.lStructSize = ctypes.sizeof(_OFN)
    ofn.hwndOwner = _u32.GetForegroundWindow()
    ofn.lpstrFilter = filt
    ofn.lpstrFile = ctypes.cast(buf, wintypes.LPWSTR)
    ofn.nMaxFile = 1024
    ofn.lpstrTitle = title
    ofn.lpstrDefExt = ext or None
    ofn.Flags = (0x2 | 0x800) if save else (0x1000 | 0x800 | 0x80000)  # OVERWRITEPROMPT|PATHMUSTEXIST / FILEMUSTEXIST|NOCHANGEDIR
    fn = ctypes.windll.comdlg32.GetSaveFileNameW if save else ctypes.windll.comdlg32.GetOpenFileNameW
    return buf.value if fn(ctypes.byref(ofn)) else None


def hunter_file():
    path = _file_dialog(False, "Elige un programa o acceso directo",
                        "Programas y accesos (*.exe;*.lnk;*.url)\0*.exe;*.lnk;*.url\0Todos (*.*)\0*.*\0\0")
    if not path:
        return None
    if not _progs:
        programs_list()
    p = hunter.find_program(path, _all())
    return {"found": bool(p), "info": {"path": hunter.resolve_target(path)}, "program": _ui(p) if p else None}


# ------------------------------------------------------------ utilidades
def open_path(path):
    if path and os.path.exists(path):
        subprocess.Popen(["explorer", "/select,", path] if os.path.isfile(path) else ["explorer", path])
        return True
    parent = os.path.dirname(path or "")
    if parent and os.path.isdir(parent):
        subprocess.Popen(["explorer", parent])
        return True
    return False


def open_regedit(display):
    key = (display or "").split("  →  ")[0]
    full = {"HKLM": "HKEY_LOCAL_MACHINE", "HKCU": "HKEY_CURRENT_USER", "HKU": "HKEY_USERS", "HKCR": "HKEY_CLASSES_ROOT"}
    hive, _, rest = key.partition("\\")
    target = f"{full.get(hive, hive)}\\{rest}"
    last = registry.get_value(winreg.HKEY_CURRENT_USER, r"Software\Microsoft\Windows\CurrentVersion\Applets\Regedit",
                              "LastKey") or ""
    prefix = last.split("\\HKEY_")[0] if "\\HKEY_" in last else "Equipo"
    with winreg.CreateKey(winreg.HKEY_CURRENT_USER, r"Software\Microsoft\Windows\CurrentVersion\Applets\Regedit") as k:
        winreg.SetValueEx(k, "LastKey", 0, winreg.REG_SZ, f"{prefix}\\{target}")
    subprocess.Popen(["regedit", "/m"])
    return True


def search_web(name):
    webbrowser.open("https://www.google.com/search?q=" + urllib.parse.quote(f"{name} desinstalar"))
    return True


def export_programs():
    path = _file_dialog(True, "Guardar la lista de programas", "CSV (*.csv)\0*.csv\0\0",
                        default="programas.csv", ext="csv")
    if not path:
        return None
    if not _progs:
        programs_list()
    with open(path, "w", newline="", encoding="utf-8-sig") as f:
        w = csv.writer(f, delimiter=";")
        w.writerow(["Nombre", "Versión", "Fabricante", "Tamaño (MB)", "Instalado", "Tipo", "Carpeta"])
        for p in sorted(_all(), key=lambda p: p["name"].lower()):
            w.writerow([p["name"], p.get("version"), p.get("publisher"), round((p.get("size") or 0) / 1048576, 1),
                        p.get("date"), p.get("kind_label"), p.get("location")])
    return path
