"""Junk file cleaner. A closed list of locations: it never deletes outside them.

It only empties the CONTENTS of the category folders, never the category folder itself.

Temp folders (%TEMP%, Windows\\Temp) are where other programs keep their WORKING files, so they get extra care
(an incident deleted ~47 GB including the working folders of tools that were still running):
- decisions are made per FIRST-LEVEL entry of the temp folder, never file by file inside a folder;
- a first-level folder is left alone completely if anything inside it changed within the grace period
  (default 7 days, the user picks 1 / 7 / 30), if a running process uses it (its working folder, its exe, a
  path in its command line or an open file), if the user excluded it, or if it is a link/junction;
- loose files directly in the temp folder follow the same age rule one by one;
- reparse points (junctions, symlinks) are never followed, anywhere;
- files that are locked are skipped once and counted, never retried in a loop.
Sources for the rules: CCleaner keeps temp files younger than 24 h by default; BleachBit's maintainers agreed an
age limit is needed so files in use are not deleted (bleachbit.org forum, "Only clean temp files older than a set
amount of time"); Windows Disk Cleanup is conservative with Temp. We go further with the per-folder rule.
"""
import ctypes
import glob
import os
import re
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

from ...i18n import tr
from . import paths, safety, system

RECENT_GRACE = 3600        # legacy file-level grace (seconds) when grace=True is passed to _walk
TEMP_GRACE_DAYS = 7        # default for temp folders; the user can choose 1, 7 or 30 days
GRACE_CHOICES = (1, 7, 30)
WALK_WORKERS = 4           # threads per category when walking folders
CAT_WORKERS = 3            # categories measured at the same time
DELETE_WORKERS = 6         # threads when deleting
IN_USE_BUDGET = 6.0        # seconds spent at most asking processes for their open files
LOOSE = "(files directly in this folder)"   # English key; the row shows tr(LOOSE)
LOOSE_TOKEN = "loose:"      # exclude entry "loose:<temp folder>" skips the loose files of that folder only


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
        "user_temp": {"label": "User temporary files", "group": "Windows", "globs": [],
                      "grace": True, "temp": True, "default": True,
                      "desc": "Files programs leave in %TEMP%. Folders used recently or by a running program are kept."},
        "win_temp": {"label": "Windows temporary files", "group": "Windows", "globs": [],
                     "grace": True, "temp": True, "default": True, "admin": True},
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
    # the temp roots are emptied (first-level entries, permanently): validate them before they become a glob
    for k, root, sysd in (("user_temp", paths.user_temp_dir(), False),
                          ("win_temp", os.path.join(win, "Temp") if win else None, True)):
        why = safety.temp_root_problem(root, system_temp=sysd)
        if why:
            c[k]["refused"] = why          # no globs: nothing is scanned or deleted in this category
            c[k]["desc"] = why
            c[k]["default"] = False
        else:
            c[k]["globs"] = [root]
    for k, v in c.items():
        v.setdefault("default", v.get("group") != "Apps" or k in ("discord", "steam_web"))
        v.setdefault("desc", "")
        v["id"] = k
    return c


def _absolute(g):
    """Only absolute drive paths: an empty known folder must never turn a glob into one relative to the cwd."""
    return bool(g) and os.path.isabs(g) and g[1:2] == ":"


def _expand(cat):
    dirs, files = [], []
    if cat.get("refused"):
        return dirs, files
    for g in cat.get("globs", []):
        if _absolute(g):
            dirs += [d for d in glob.glob(g) if os.path.isdir(d) and not paths.is_reparse_point(d)]
    for g in cat.get("files", []):
        if _absolute(g):
            files += [f for f in glob.glob(g) if os.path.isfile(f)]
    return dirs, files


def _norm(p):
    return os.path.normcase(os.path.normpath(p)) if p else ""


def _grace_seconds(grace):
    """grace=True keeps the legacy 1-hour rule; a number is seconds; None/False/0 means no age filter."""
    if grace is True:
        return RECENT_GRACE
    return float(grace or 0)


def _list_dir(cur, grace, now, collect):
    """One folder: return (subfolders, files, bytes, [(path, size)] if collect, newest mtime seen).

    On Windows DirEntry.stat() comes from the listing (FindNextFile): no extra call per file. Links and junctions
    are never added to the subfolders, so they are never walked.
    """
    subdirs, files, size, found, newest = [], 0, 0, [], 0.0
    gs = _grace_seconds(grace)
    try:
        it = os.scandir(cur)
    except OSError:
        return subdirs, files, size, found, newest
    with it:
        for e in it:
            try:
                if e.is_dir(follow_symlinks=False):
                    if not e.is_junction() and not e.is_symlink():
                        subdirs.append(e.path)
                        newest = max(newest, e.stat(follow_symlinks=False).st_mtime)
                    continue
                st = e.stat(follow_symlinks=False)
            except OSError:
                continue
            newest = max(newest, st.st_mtime)
            if gs and now - st.st_mtime < gs:
                continue
            files += 1
            size += st.st_size
            if collect:
                found.append((e.path, st.st_size))
    return subdirs, files, size, found, newest


def _walk(dirs, grace, collect=False, workers=WALK_WORKERS, stats=None, cancel=None):
    """Walk several folders with several threads (scandir releases the GIL while waiting for the disk).

    Measured on a real PC, 508,000 temp files: 1 thread 10-22 s, 4 threads 4.9 s, 8 or more threads, worse.
    Return (files, bytes, [(path, size)] if collect). If `stats` is a dict it gets "newest" (latest mtime of any
    file or folder seen, including the roots' contents).
    """
    now = time.time()
    work = list(dirs)
    if not work:
        return 0, 0, []
    lock = threading.Lock()
    cond = threading.Condition(lock)
    state = {"pending": len(work), "files": 0, "size": 0, "newest": 0.0}
    found = []

    def worker():
        files = size = 0
        newest = 0.0
        mine = []
        while True:
            with cond:
                while not work and state["pending"]:
                    cond.wait()
                if not work:
                    break
                cur = work.pop()
            if cancel and cancel():
                subs, f, s, fl, nw = [], 0, 0, [], 0.0
            else:
                subs, f, s, fl, nw = _list_dir(cur, grace, now, collect)
            files += f
            size += s
            newest = max(newest, nw)
            mine += fl
            with cond:
                work.extend(subs)
                state["pending"] += len(subs) - 1
                cond.notify_all()
        with lock:
            state["files"] += files
            state["size"] += size
            state["newest"] = max(state["newest"], newest)
            found.extend(mine)

    threads = [threading.Thread(target=worker, daemon=True) for _ in range(max(1, workers))]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    if stats is not None:
        stats["newest"] = state["newest"]
    return state["files"], state["size"], found


def _remove_empty_dirs(root, remove_root=False):
    """Delete empty subfolders (deepest first); the root only if remove_root.

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
    if remove_root:
        try:
            os.rmdir(root)
        except OSError:
            pass


# ---------------------------------------------------------------- what running programs are using
_PATH_RE = re.compile(r"[A-Za-z]:\\[^\"'<>|*?\r\n]*")


def in_use_paths(budget=IN_USE_BUDGET):
    """{normalized path: process name} for everything running processes are using: their working folder, their
    executable, every absolute path in their command line and (time-boxed, best effort) their open files."""
    try:
        import psutil
    except ImportError:
        return {}
    out = {}
    t0 = time.monotonic()
    me = os.getpid()
    for p in psutil.process_iter(["name", "exe", "cwd", "cmdline"]):
        try:
            info = p.info
        except Exception:
            continue
        name = info.get("name") or tr("a program")
        cands = [info.get("exe"), info.get("cwd")]
        cmd = info.get("cmdline") or []
        cands += _PATH_RE.findall(" ".join(cmd) if isinstance(cmd, list) else str(cmd))
        for x in cands:
            if x:
                out.setdefault(_norm(x.strip().rstrip("\\")), name)
        if p.pid != me and time.monotonic() - t0 < budget:
            try:
                for f in p.open_files():
                    out.setdefault(_norm(f.path), name)
            except Exception:
                pass
    return out


def _user_for(path, in_use):
    """Name of a process using `path` or anything inside it, or None."""
    n = _norm(path)
    pre = n + os.sep
    for u, name in in_use.items():
        if u == n or u.startswith(pre):
            return name
    return None


def _excluded(path, exclude):
    if not exclude:
        return False
    n, base = _norm(path), os.path.basename(path).lower()
    for x in exclude:
        x = str(x).strip()
        if not x or x.startswith(LOOSE_TOKEN):
            continue
        if os.path.isabs(x):
            xn = _norm(x)
            if n == xn or n.startswith(xn + os.sep):
                return True
        elif base == x.lower():
            return True
    return False


def temp_entries(root, days=TEMP_GRACE_DAYS, exclude=(), in_use=None, cancel=None):
    """First-level view of a temp folder. Every row says whether it will be cleaned and why not.

    status: "clean" (will be emptied), "recent" (changed within the grace period), "in_use" (a running program
    uses it), "excluded" (the user said no), "link" (a junction/symlink: never followed or deleted).
    The loose files directly in `root` are summarized in one row named LOOSE.
    """
    if in_use is None:
        in_use = in_use_paths()
    skip_loose = any(_norm(str(x)[len(LOOSE_TOKEN):]) == _norm(root) for x in exclude or ()
                     if str(x).startswith(LOOSE_TOKEN))
    limit = max(0, float(days)) * 86400
    now = time.time()
    rows = []
    loose = {"name": tr(LOOSE), "path": root, "kind": "files", "size": 0, "files": 0, "kept": 0, "keptSize": 0,
             "newest": 0.0, "status": "clean", "reason": "", "items": []}
    try:
        it = list(os.scandir(root))
    except OSError:
        return rows
    for e in it:
        if cancel and cancel():
            break
        try:
            st = e.stat(follow_symlinks=False)
        except OSError:
            continue
        is_link = bool(getattr(st, "st_file_attributes", 0) & 0x400) or e.is_symlink() or e.is_junction()
        if is_link:
            rows.append({"name": e.name, "path": e.path, "kind": "link", "size": 0, "files": 0,
                         "newest": st.st_mtime, "status": "link", "reason": tr("Link to another folder: never followed")})
            continue
        if e.is_dir(follow_symlinks=False):
            stats = {}
            files, size, _ = _walk([e.path], None, stats=stats, cancel=cancel)
            newest = max(stats.get("newest", 0.0), st.st_mtime)
            row = {"name": e.name, "path": e.path, "kind": "dir", "size": size, "files": files, "newest": newest}
            user = _user_for(e.path, in_use)
            if _excluded(e.path, exclude):
                row.update(status="excluded", reason=tr("You chose to always keep it"))
            elif user:
                row.update(status="in_use", reason=tr("In use by {name}", name=user), process=user)
            elif now - newest < limit:
                row.update(status="recent", reason=tr("Used recently"))
            else:
                row.update(status="clean", reason="")
            rows.append(row)
            continue
        # a loose file
        loose["newest"] = max(loose["newest"], st.st_mtime)
        if skip_loose or _excluded(e.path, exclude) or _user_for(e.path, in_use) or now - st.st_mtime < limit:
            loose["kept"] += 1
            loose["keptSize"] += st.st_size
            continue
        loose["files"] += 1
        loose["size"] += st.st_size
        loose["items"].append((e.path, st.st_size))
    if loose["files"] or loose["kept"]:
        if skip_loose:
            loose.update(status="excluded", reason=tr("You chose to keep them"), files=loose["kept"],
                         size=loose["keptSize"], kept=0, keptSize=0)
        elif not loose["files"]:
            loose.update(status="recent", reason=tr("All of them are recent or in use"))
        rows.append(loose)
    rows.sort(key=lambda r: (r["status"] != "clean", -r["size"]))
    return rows


def _public_rows(rows, limit=300):
    """Rows without the internal file lists, ready to send to the interface."""
    out = []
    for r in rows[:limit]:
        out.append({k: v for k, v in r.items() if k != "items"})
    return out


# ---------------------------------------------------------------- measuring
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


def _measure(c, days=TEMP_GRACE_DAYS, exclude=(), in_use=None):
    """(bytes, files, rows). Temp categories only count what would really be deleted; rows explain the rest."""
    if c.get("recycle"):
        size, count = recycle_info()
        return size, count, None
    dirs, files = _expand(c)
    if c.get("temp"):
        size = count = 0
        rows = []
        for d in dirs:
            rs = temp_entries(d, days, exclude, in_use)
            for r in rs:
                r["root"] = d
            rows += rs
        for r in rows:
            if r["status"] == "clean":
                size += r["size"]
                count += r["files"]
        rows.sort(key=lambda r: (r["status"] != "clean", -r["size"]))
        return size, count, rows
    count, size, _ = _walk(dirs, c.get("grace"))
    for f in files:
        try:
            size += os.path.getsize(f)
            count += 1
        except OSError:
            pass
    return size, count, None


def scan(progress=None, on_item=None, days=TEMP_GRACE_DAYS, exclude=()):
    """Measure every category at once; on_item(result) is called as soon as each one finishes."""
    cats = categories()
    admin = system.is_admin()
    procs = {p["name"].lower() for p in system.list_processes()}
    in_use = in_use_paths() if any(c.get("temp") for c in cats.values()) else {}
    order = {k: i for i, k in enumerate(cats)}
    out, done = [], 0
    with ThreadPoolExecutor(max_workers=CAT_WORKERS) as ex:
        futs = {ex.submit(_measure, c, days, exclude, in_use): k for k, c in cats.items()}
        for fut in as_completed(futs):
            k = futs[fut]
            c = cats[k]
            try:
                size, count, rows = fut.result()
            except Exception:
                size, count, rows = 0, 0, None
            item = {"id": k, "label": tr(c["label"]), "group": tr(c["group"]), "desc": tr(c["desc"]) if c["desc"] else "", "size": size,
                    "count": count, "default": c["default"] and size > 0,
                    "needs_admin": bool(c.get("admin")) and not admin,
                    "busy": running(c.get("process"), procs), "process": c.get("process", "")}
            if c.get("refused"):
                item["skipped"] = True
                item["skipReason"] = c["refused"]
                item["desc"] = c["refused"]    # already translated; the UI shows desc under the row
            if rows is not None:
                item["rows"] = _public_rows(rows)
                kept = [r for r in rows if r["status"] != "clean"]
                item["keptSize"] = sum(r["size"] for r in kept) + sum(r.get("keptSize", 0) for r in rows)
                item["keptCount"] = len(kept)
            out.append(item)
            done += 1
            if on_item:
                on_item(item)
            if progress:
                progress(done / len(cats), tr(c["label"]))
    out.sort(key=lambda i: order[i["id"]])
    if progress:
        progress(1, tr("Done"))
    return out


# ---------------------------------------------------------------- deleting
class _Counter:
    def __init__(self, total_files, total_bytes):
        self.lock = threading.Lock()
        self.total, self.total_bytes = total_files, total_bytes
        self.deleted = self.freed = self.skipped = 0
        self.current = ""


def _delete_list(found, counter, cancel=None, label=""):
    """Delete (path, size) pairs with several threads (os.remove releases the GIL). Locked files are skipped once.
    Stops between files as soon as cancel() is true."""
    if not found:
        return
    n = 1 if len(found) < 200 else DELETE_WORKERS
    chunks = [found[i::n] for i in range(n)]

    def work(chunk):
        for fp, s in chunk:
            if cancel and cancel():
                return
            try:
                os.remove(fp)
                with counter.lock:
                    counter.freed += s
                    counter.deleted += 1
                    counter.current = label or os.path.dirname(fp)
            except OSError:
                with counter.lock:
                    counter.skipped += 1
    with ThreadPoolExecutor(max_workers=n) as ex:
        list(ex.map(work, chunks))


def _report(counter, on_progress, t0, extra=None):
    if not on_progress:
        return
    with counter.lock:
        el = max(0.001, time.monotonic() - t0)
        rate = counter.deleted / el
        left = max(0, counter.total - counter.deleted - counter.skipped)
        d = {"deleted": counter.deleted, "total": counter.total, "freed": counter.freed,
             "totalBytes": counter.total_bytes, "skipped": counter.skipped, "current": counter.current,
             "rate": round(rate), "eta": round(left / rate) if rate > 1 else None}
    if extra:
        d.update(extra)
    on_progress(d)


def clean(ids, progress=None, days=TEMP_GRACE_DAYS, exclude=(), cancel=None, on_progress=None, in_use=None):
    """Clean the chosen categories. Returns {"freed", "deleted", "skipped", "cancelled", "per": {id: bytes}}.

    on_progress(dict) gets real numbers several times a second: deleted, total, freed, current folder, files per
    second and estimated seconds left. cancel() is checked between files.
    """
    cats = categories()
    t0 = time.monotonic()
    plans = []   # (category id, [(path, size)], [folders to tidy afterwards], [(folder, remove_root)])
    total_files = total_bytes = 0
    need_in_use = any(cats.get(k, {}).get("temp") for k in ids)
    if need_in_use and in_use is None:
        in_use = in_use_paths()
    for k in ids:
        c = cats.get(k)
        if not c or c.get("recycle"):
            plans.append((k, None, []))
            continue
        dirs, files = _expand(c)
        found, tidy = [], []
        if c.get("temp"):
            for d in dirs:
                for r in temp_entries(d, days, exclude, in_use, cancel=cancel):
                    if r["status"] != "clean":
                        continue
                    if r["kind"] == "files":
                        found += r["items"]
                    else:
                        found += _walk([r["path"]], None, collect=True, cancel=cancel)[2]
                        tidy.append((r["path"], True))
        else:
            for d in dirs:
                found += _walk([d], c.get("grace"), collect=True, cancel=cancel)[2]
                tidy.append((d, False))
            for f in files:
                try:
                    found.append((f, os.path.getsize(f)))
                except OSError:
                    pass
        total_files += len(found)
        total_bytes += sum(s for _, s in found)
        plans.append((k, found, tidy))
        if progress:
            progress(0, tr("Preparing {name}", name=tr(c["label"]).lower()))
    counter = _Counter(total_files, total_bytes)
    per = {}
    stop = threading.Event()

    def ticker():
        while not stop.wait(0.2):
            _report(counter, on_progress, t0)
    tick = threading.Thread(target=ticker, daemon=True)
    tick.start()
    cancelled = False
    try:
        for k, found, tidy in plans:
            if cancel and cancel():
                cancelled = True
                break
            c = cats.get(k)
            if not c:
                continue
            before = counter.freed
            if found is None:   # Recycle Bin
                size, count = recycle_info()
                if ctypes.windll.shell32.SHEmptyRecycleBinW(None, None, 0x7) in (0, -2147418113):
                    with counter.lock:
                        counter.freed += size
                        counter.deleted += count
                per[k] = counter.freed - before
                continue
            if progress:
                progress(0, tr(c["label"]))
            # temp folders show the folder being emptied; other categories their name
            _delete_list(found, counter, cancel, label="" if c.get("temp") else tr(c["label"]))
            for folder, remove_root in tidy:
                _remove_empty_dirs(folder, remove_root=remove_root)  # never through links
            per[k] = counter.freed - before
            _report(counter, on_progress, t0, {"id": k, "catFreed": per[k]})
        if cancel and cancel():
            cancelled = True
    finally:
        stop.set()
    _report(counter, on_progress, t0)
    if progress:
        progress(1, tr("Done"))
    return {"freed": counter.freed, "deleted": counter.deleted, "skipped": counter.skipped,
            "cancelled": cancelled, "per": per}
