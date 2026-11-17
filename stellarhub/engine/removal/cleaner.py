"""Junk file cleaner. A closed list of locations: it never deletes outside them.

It only empties the CONTENTS of the folders, never the folder itself. Files in use are skipped.
"""
import ctypes
import glob
import os
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

from . import paths, system

RECENT_GRACE = 3600  # don't touch temp files modified in the last hour (installers still running)
WALK_WORKERS = 4     # threads per category when walking folders
CAT_WORKERS = 3      # categories measured at the same time
DELETE_WORKERS = 6   # threads when deleting


def _k(name, *rest):
    base = paths.kf(name)
    return os.path.join(base, *rest) if base else None


def _browser(label, user_data, proc, extra=()):
    subs = ["Cache", "Code Cache", "GPUCache", "DawnCache", "DawnGraphiteCache", "DawnWebGPUCache",
            "GrShaderCache", "ShaderCache", os.path.join("Service Worker", "CacheStorage"),
            os.path.join("Service Worker", "ScriptCache")] + list(extra)
    return {"label": label, "group": "Browsers", "process": proc,
            "globs": [os.path.join(user_data, prof, s) for prof in ("Default", "Profile *", "Guest Profile",
                                                                   "System Profile") for s in subs] +
                     [os.path.join(user_data, s) for s in ("ShaderCache", "GrShaderCache", "GraphiteDawnCache")]}


def categories():
    local, roam, win = paths.kf("LocalAppData") or "", paths.kf("RoamingAppData") or "", paths.kf("Windows") or ""
    pd = paths.kf("ProgramData") or ""
    c = {
        "user_temp": {"label": "User temporary files", "group": "Windows", "globs": [paths.kf("Temp")],
                      "grace": True, "default": True,
                      "desc": "Files programs leave in %TEMP%. Files from the last hour are kept."},
        "win_temp": {"label": "Windows temporary files", "group": "Windows", "globs": [os.path.join(win, "Temp")],
                     "grace": True, "default": True, "admin": True},
        "thumbs": {"label": "Thumbnail cache", "group": "Windows", "default": True,
                   "files": [os.path.join(local, "Microsoft", "Windows", "Explorer", "thumbcache_*.db"),
                             os.path.join(local, "Microsoft", "Windows", "Explorer", "iconcache_*.db")],
                   "desc": "Windows rebuilds them when you open folders."},
        "dumps": {"label": "Crash dumps and error reports", "group": "Windows", "default": True,
                  "globs": [os.path.join(local, "CrashDumps"), os.path.join(win, "Minidump"),
                            os.path.join(pd, "Microsoft", "Windows", "WER", "ReportArchive"),
                            os.path.join(pd, "Microsoft", "Windows", "WER", "ReportQueue"),
                            os.path.join(local, "Microsoft", "Windows", "WER", "ReportArchive"),
                            os.path.join(local, "Microsoft", "Windows", "WER", "ReportQueue")],
                  "files": [os.path.join(win, "MEMORY.DMP")]},
        "wu_cache": {"label": "Windows Update downloads", "group": "Windows", "default": False, "admin": True,
                     "globs": [os.path.join(win, "SoftwareDistribution", "Download")],
                     "desc": "Updates that are already installed. Unchecked by default."},
        "do_cache": {"label": "Delivery Optimization", "group": "Windows", "default": False, "admin": True,
                     "globs": [os.path.join(win, "ServiceProfiles", "NetworkService", "AppData", "Local",
                                            "Microsoft", "Windows", "DeliveryOptimization", "Cache")]},
        "chrome": _browser("Google Chrome", os.path.join(local, "Google", "Chrome", "User Data"), "chrome.exe"),
        "edge": _browser("Microsoft Edge", os.path.join(local, "Microsoft", "Edge", "User Data"), "msedge.exe"),
        "brave": _browser("Brave", os.path.join(local, "BraveSoftware", "Brave-Browser", "User Data"), "brave.exe"),
        "opera": {"label": "Opera", "group": "Browsers", "process": "opera.exe",
                  "globs": [os.path.join(local, "Opera Software", "Opera Stable", "Cache"),
                            os.path.join(local, "Opera Software", "Opera GX Stable", "Cache")]},
        "firefox": {"label": "Firefox", "group": "Browsers", "process": "firefox.exe",
                    "globs": [os.path.join(local, "Mozilla", "Firefox", "Profiles", "*", "cache2"),
                              os.path.join(local, "Mozilla", "Firefox", "Profiles", "*", "startupCache")]},
        "discord": {"label": "Discord", "group": "Apps", "process": "discord.exe",
                    "globs": [os.path.join(roam, "discord", s) for s in ("Cache", "Code Cache", "GPUCache")]},
        "spotify": {"label": "Spotify", "group": "Apps", "process": "spotify.exe",
                    "globs": [os.path.join(local, "Spotify", "Data"), os.path.join(local, "Spotify", "Browser", "Cache")]},
        "steam_web": {"label": "Steam (built-in browser)", "group": "Apps", "process": "steamwebhelper.exe",
                      "globs": [os.path.join(local, "Steam", "htmlcache")]},
        "nvidia": {"label": "NVIDIA/DirectX shader cache", "group": "Apps", "default": False,
                   "globs": [os.path.join(local, "NVIDIA", "DXCache"), os.path.join(local, "NVIDIA", "GLCache"),
                             os.path.join(local, "D3DSCache")],
                   "desc": "Games rebuild it; after cleaning, the first session may take longer to load."},
        "recycle": {"label": "Recycle Bin", "group": "Windows", "default": True, "recycle": True},
    }
    for k, v in c.items():
        v.setdefault("default", v.get("group") != "Apps" or k in ("discord", "steam_web"))
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
    """One folder: return (subfolders, files, bytes, [(path, size)] if collect).

    On Windows DirEntry.stat() comes from the listing (FindNextFile): no extra call per file.
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
    """Walk several folders with several threads (scandir releases the GIL while waiting for the disk).

    Measured on a real PC, 508,000 temp files: 1 thread 10-22 s, 4 threads 4.9 s, 8 or more threads, worse.
    Return (files, bytes, [(path, size)] if collect).
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
    """Delete empty subfolders (deepest first), never the root.

    It does not use os.walk: on Windows os.walk DOES enter junctions and would delete empty folders outside
    the category. Here a link or junction is neither walked nor deleted.
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
            if attrs & 0x10 and not attrs & 0x400:   # a real folder, not a link
                visit(e.path)
                try:
                    os.rmdir(e.path)   # only works if it ended up empty
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
    """Measure every category at once; on_item(result) is called as soon as each one finishes."""
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
    """Delete the files with several threads (os.remove releases the GIL). Return (bytes, deleted, skipped)."""
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
            _remove_empty_dirs(d)  # empty folders (never the category root, never through links)
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
