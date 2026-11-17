"""Limpiador de archivos basura. Lista cerrada de ubicaciones: nunca borra fuera de ellas.

Solo vacia el CONTENIDO de las carpetas; nunca la carpeta en si. Los archivos en uso se saltan.
"""
import ctypes
import glob
import os
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

from . import paths, system

RECENT_GRACE = 3600  # no tocar temporales modificados en la ultima hora (instaladores en curso)
WALK_WORKERS = 4     # hilos por categoria al recorrer carpetas
CAT_WORKERS = 3      # categorias medidas a la vez
DELETE_WORKERS = 6   # hilos al borrar


def _k(name, *rest):
    base = paths.kf(name)
    return os.path.join(base, *rest) if base else None


def _browser(label, user_data, proc, extra=()):
    subs = ["Cache", "Code Cache", "GPUCache", "DawnCache", "DawnGraphiteCache", "DawnWebGPUCache",
            "GrShaderCache", "ShaderCache", os.path.join("Service Worker", "CacheStorage"),
            os.path.join("Service Worker", "ScriptCache")] + list(extra)
    return {"label": label, "group": "Navegadores", "process": proc,
            "globs": [os.path.join(user_data, prof, s) for prof in ("Default", "Profile *", "Guest Profile",
                                                                   "System Profile") for s in subs] +
                     [os.path.join(user_data, s) for s in ("ShaderCache", "GrShaderCache", "GraphiteDawnCache")]}


def categories():
    local, roam, win = paths.kf("LocalAppData") or "", paths.kf("RoamingAppData") or "", paths.kf("Windows") or ""
    pd = paths.kf("ProgramData") or ""
    c = {
        "user_temp": {"label": "Temporales del usuario", "group": "Windows", "globs": [paths.kf("Temp")],
                      "grace": True, "default": True,
                      "desc": "Archivos que los programas dejan en %TEMP%. Se respetan los de la última hora."},
        "win_temp": {"label": "Temporales de Windows", "group": "Windows", "globs": [os.path.join(win, "Temp")],
                     "grace": True, "default": True, "admin": True},
        "thumbs": {"label": "Caché de miniaturas", "group": "Windows", "default": True,
                   "files": [os.path.join(local, "Microsoft", "Windows", "Explorer", "thumbcache_*.db"),
                             os.path.join(local, "Microsoft", "Windows", "Explorer", "iconcache_*.db")],
                   "desc": "Windows las vuelve a crear al abrir las carpetas."},
        "dumps": {"label": "Volcados de errores e informes", "group": "Windows", "default": True,
                  "globs": [os.path.join(local, "CrashDumps"), os.path.join(win, "Minidump"),
                            os.path.join(pd, "Microsoft", "Windows", "WER", "ReportArchive"),
                            os.path.join(pd, "Microsoft", "Windows", "WER", "ReportQueue"),
                            os.path.join(local, "Microsoft", "Windows", "WER", "ReportArchive"),
                            os.path.join(local, "Microsoft", "Windows", "WER", "ReportQueue")],
                  "files": [os.path.join(win, "MEMORY.DMP")]},
        "wu_cache": {"label": "Descargas de Windows Update", "group": "Windows", "default": False, "admin": True,
                     "globs": [os.path.join(win, "SoftwareDistribution", "Download")],
                     "desc": "Actualizaciones ya instaladas. Desmarcado por defecto."},
        "do_cache": {"label": "Optimización de distribución", "group": "Windows", "default": False, "admin": True,
                     "globs": [os.path.join(win, "ServiceProfiles", "NetworkService", "AppData", "Local",
                                            "Microsoft", "Windows", "DeliveryOptimization", "Cache")]},
        "chrome": _browser("Google Chrome", os.path.join(local, "Google", "Chrome", "User Data"), "chrome.exe"),
        "edge": _browser("Microsoft Edge", os.path.join(local, "Microsoft", "Edge", "User Data"), "msedge.exe"),
        "brave": _browser("Brave", os.path.join(local, "BraveSoftware", "Brave-Browser", "User Data"), "brave.exe"),
        "opera": {"label": "Opera", "group": "Navegadores", "process": "opera.exe",
                  "globs": [os.path.join(local, "Opera Software", "Opera Stable", "Cache"),
                            os.path.join(local, "Opera Software", "Opera GX Stable", "Cache")]},
        "firefox": {"label": "Firefox", "group": "Navegadores", "process": "firefox.exe",
                    "globs": [os.path.join(local, "Mozilla", "Firefox", "Profiles", "*", "cache2"),
                              os.path.join(local, "Mozilla", "Firefox", "Profiles", "*", "startupCache")]},
        "discord": {"label": "Discord", "group": "Aplicaciones", "process": "discord.exe",
                    "globs": [os.path.join(roam, "discord", s) for s in ("Cache", "Code Cache", "GPUCache")]},
        "spotify": {"label": "Spotify", "group": "Aplicaciones", "process": "spotify.exe",
                    "globs": [os.path.join(local, "Spotify", "Data"), os.path.join(local, "Spotify", "Browser", "Cache")]},
        "steam_web": {"label": "Steam (navegador interno)", "group": "Aplicaciones", "process": "steamwebhelper.exe",
                      "globs": [os.path.join(local, "Steam", "htmlcache")]},
        "nvidia": {"label": "Caché de sombreadores NVIDIA/DirectX", "group": "Aplicaciones", "default": False,
                   "globs": [os.path.join(local, "NVIDIA", "DXCache"), os.path.join(local, "NVIDIA", "GLCache"),
                             os.path.join(local, "D3DSCache")],
                   "desc": "Los juegos la regeneran; tras limpiar, la primera partida puede tardar más en cargar."},
        "recycle": {"label": "Papelera de reciclaje", "group": "Windows", "default": True, "recycle": True},
    }
    for k, v in c.items():
        v.setdefault("default", v.get("group") != "Aplicaciones" or k in ("discord", "steam_web"))
        v.setdefault("desc", "")
        v["id"] = k
    return c


def _expand(cat):
    dirs, files = [], []
    for g in cat.get("globs", []):
        if g:
            dirs += [d for d in glob.glob(g) if os.path.isdir(d) and not paths.is_reparse_point(d)]
    for g in cat.get("files", []):
        if g:
            files += [f for f in glob.glob(g) if os.path.isfile(f)]
    return dirs, files


def _list_dir(cur, grace, now, collect):
    """Una carpeta: devuelve (subcarpetas, archivos, bytes, [(ruta, tamano)] si collect).

    En Windows DirEntry.stat() sale del listado (FindNextFile): sin llamadas extra por archivo.
    """
    subdirs, files, size, found = [], 0, 0, []
    try:
        it = os.scandir(cur)
    except OSError:
        return subdirs, files, size, found
    with it:
        for e in it:
            try:
                if e.is_dir(follow_symlinks=False):
                    if not e.is_junction() and not e.is_symlink():
                        subdirs.append(e.path)
                    continue
                st = e.stat(follow_symlinks=False)
            except OSError:
                continue
            if grace and now - st.st_mtime < RECENT_GRACE:
                continue
            files += 1
            size += st.st_size
            if collect:
                found.append((e.path, st.st_size))
    return subdirs, files, size, found


def _walk(dirs, grace, collect=False, workers=WALK_WORKERS):
    """Recorre varias carpetas con varios hilos (scandir suelta el GIL mientras espera al disco).

    Medido en este PC, 508.000 temporales: 1 hilo 10-22 s, 4 hilos 4,9 s, 8 o mas hilos, peor.
    Devuelve (archivos, bytes, [(ruta, tamano)] si collect).
    """
    now = time.time()
    work = list(dirs)
    if not work:
        return 0, 0, []
    lock = threading.Lock()
    cond = threading.Condition(lock)
    state = {"pending": len(work), "files": 0, "size": 0}
    found = []

    def worker():
        files = size = 0
        mine = []
        while True:
            with cond:
                while not work and state["pending"]:
                    cond.wait()
                if not work:
                    break
                cur = work.pop()
            subs, f, s, fl = _list_dir(cur, grace, now, collect)
            files += f
            size += s
            mine += fl
            with cond:
                work.extend(subs)
                state["pending"] += len(subs) - 1
                cond.notify_all()
        with lock:
            state["files"] += files
            state["size"] += size
            found.extend(mine)

    threads = [threading.Thread(target=worker, daemon=True) for _ in range(max(1, workers))]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    return state["files"], state["size"], found


def _remove_empty_dirs(root):
    """Borra las subcarpetas vacias (de la mas profunda a la menos), nunca la raiz.

    No usa os.walk: en Windows os.walk ENTRA en los junctions y borraria carpetas vacias de fuera de
    la categoria. Aqui un enlace o junction ni se recorre ni se borra.
    """
    def visit(d):
        try:
            entries = list(os.scandir(d))
        except OSError:
            return
        for e in entries:
            try:
                attrs = e.stat(follow_symlinks=False).st_file_attributes
            except OSError:
                continue
            if attrs & 0x10 and not attrs & 0x400:   # carpeta de verdad, no enlace
                visit(e.path)
                try:
                    os.rmdir(e.path)   # solo funciona si quedo vacia
                except OSError:
                    pass
    visit(root)


class _SHQUERYRBINFO(ctypes.Structure):
    _fields_ = [("cbSize", ctypes.c_uint32), ("i64Size", ctypes.c_int64), ("i64NumItems", ctypes.c_int64)]


def recycle_info():
    info = _SHQUERYRBINFO()
    info.cbSize = ctypes.sizeof(info)
    if ctypes.windll.shell32.SHQueryRecycleBinW(None, ctypes.byref(info)) == 0:
        return info.i64Size, info.i64NumItems
    return 0, 0


def running(proc, names=None):
    if not proc:
        return False
    if names is None:
        names = {p["name"].lower() for p in system.list_processes()}
    return proc.lower() in names


def _measure(c):
    if c.get("recycle"):
        size, count = recycle_info()
        return size, count
    dirs, files = _expand(c)
    count, size, _ = _walk(dirs, c.get("grace"))
    for f in files:
        try:
            size += os.path.getsize(f)
            count += 1
        except OSError:
            pass
    return size, count


def scan(progress=None, on_item=None):
    """Mide todas las categorias a la vez; on_item(resultado) se llama en cuanto termina cada una."""
    cats = categories()
    admin = system.is_admin()
    procs = {p["name"].lower() for p in system.list_processes()}
    order = {k: i for i, k in enumerate(cats)}
    out, done = [], 0
    with ThreadPoolExecutor(max_workers=CAT_WORKERS) as ex:
        futs = {ex.submit(_measure, c): k for k, c in cats.items()}
        for fut in as_completed(futs):
            k = futs[fut]
            c = cats[k]
            try:
                size, count = fut.result()
            except Exception:
                size, count = 0, 0
            item = {"id": k, "label": c["label"], "group": c["group"], "desc": c["desc"], "size": size,
                    "count": count, "default": c["default"] and size > 0,
                    "needs_admin": bool(c.get("admin")) and not admin,
                    "busy": running(c.get("process"), procs), "process": c.get("process", "")}
            out.append(item)
            done += 1
            if on_item:
                on_item(item)
            if progress:
                progress(done / len(cats), c["label"])
    out.sort(key=lambda i: order[i["id"]])
    if progress:
        progress(1, "Listo")
    return out


def _delete_chunk(chunk):
    freed = deleted = skipped = 0
    for fp, s in chunk:
        try:
            os.remove(fp)
            freed += s
            deleted += 1
        except OSError:
            skipped += 1
    return freed, deleted, skipped


def _delete_many(found):
    """Borra los archivos con varios hilos (os.remove suelta el GIL). Devuelve (bytes, borrados, saltados)."""
    if len(found) < 200:
        return _delete_chunk(found)
    n = DELETE_WORKERS
    chunks = [found[i::n] for i in range(n)]
    with ThreadPoolExecutor(max_workers=n) as ex:
        res = list(ex.map(_delete_chunk, chunks))
    return tuple(sum(r[i] for r in res) for i in range(3))


def clean(ids, progress=None):
    cats = categories()
    freed = deleted = skipped = 0
    for i, k in enumerate(ids):
        c = cats.get(k)
        if not c:
            continue
        if progress:
            progress(i / max(len(ids), 1), c["label"])
        if c.get("recycle"):
            size, count = recycle_info()
            if ctypes.windll.shell32.SHEmptyRecycleBinW(None, None, 0x7) in (0, -2147418113):
                freed += size
                deleted += count
            continue
        dirs, files = _expand(c)
        for d in dirs:
            f, dl, sk = _delete_many(_walk([d], c.get("grace"), collect=True)[2])
            freed += f
            deleted += dl
            skipped += sk
            _remove_empty_dirs(d)  # carpetas vacias (nunca la raiz de la categoria ni a traves de enlaces)
        for f in files:
            try:
                s = os.path.getsize(f)
                os.remove(f)
                freed += s
                deleted += 1
            except OSError:
                skipped += 1
    if progress:
        progress(1, "Listo")
    return {"freed": freed, "deleted": deleted, "skipped": skipped}
