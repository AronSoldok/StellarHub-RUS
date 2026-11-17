"""Autopilot: runs the user's routines for real while StellarHub is open (also hidden in the tray).

Routines are saved by the UI in the app settings (key "autopilotRoutines"; format defined in ui/js/modules/autopilot.js):
    {id, on, name, color, pausedUntil, triggers:[{k,p}], condMode:'all'|'any', conds:[{k,p}], acts:[{k,p}],
     after:{onFail, retries, limit, okThen, failThen, okRoutine, failRoutine}, notify:{when, toast, tray}}

How it works
- A background thread wakes up every few seconds, re-reads the routines (so edits apply at once), evaluates the
  triggers against real system state and, when one fires, checks the conditions and runs the actions in order by
  calling the other engines (optimizer, updater, drivers, storage, remover…). Runs go through engine/jobs.py, so the
  UI gets live progress, and every run is written to a log (autopilot/log.json next to settings.json).
- Scheduled times that were missed while StellarHub was closed are caught up if they are less than 12 hours old.
  A routine never fires for times that passed before it existed.
- Things Windows does not let a background app detect reliably are marked unavailable (capabilities()), and the UI
  says so instead of pretending.

Techniques (and why):
- Idle time: GetLastInputInfo vs GetTickCount, masked to 32 bits so the 49.7-day tick wraparound doesn't break it.
- Full screen: SHQueryUserNotificationState (2 = busy/full screen, 3 = Direct3D exclusive full screen,
  4 = presentation mode). Microsoft sends no event when it changes, so it is polled.
- Locked session: LogonUI.exe is running while the lock screen is shown.
- Microphone/camera in use: CapabilityAccessManager\\ConsentStore; an app whose LastUsedTimeStop is 0 with a start
  time set is using the device right now.
- Power: GetSystemPowerStatus (AC line, battery %).
"""
import ctypes
import json
import os
import subprocess
import threading
import time
import uuid
import winreg
from ctypes import wintypes
from datetime import datetime, timedelta

import psutil

from . import jobs

EXPORTS = {"start", "status", "dry_run", "capabilities", "log", "clear_log"}
JOBS = {"run"}

NO_WINDOW = 0x08000000
TICK = 10            # seconds between checks
CATCH_UP = 12 * 3600  # missed scheduled runs younger than this still run

_lock = threading.RLock()
_thread = None
_stop = threading.Event()
_running = set()          # routine ids running right now
_queue = []               # (rid, routine, manual, reason)
_notify = None            # set by attach(): function(title, text)
_mute_timer = None


# =============================================================== small helpers
def _admin():
    try:
        return bool(ctypes.windll.shell32.IsUserAnAdmin())
    except Exception:
        return False


def _settings_path():
    import sys
    app = sys.modules.get("stellarhub.app")
    if app is not None and getattr(app, "SETTINGS", None):
        return app.SETTINGS
    return os.path.join(os.environ.get("APPDATA") or os.path.expanduser("~"), "StellarHub", "settings.json")


def _data_dir():
    """Log and trigger state live next to settings.json (a copy of the settings gets its own log: safe for tests)."""
    sp = _settings_path()
    stem = os.path.splitext(os.path.basename(sp))[0]
    return os.path.join(os.path.dirname(sp), "autopilot" if stem == "settings" else stem + "_autopilot")


def _log_file():
    return os.path.join(_data_dir(), "log.json")


def _state_file():
    return os.path.join(_data_dir(), "state.json")


def _settings():
    try:
        with open(_settings_path(), encoding="utf-8") as fh:
            d = json.load(fh)
            return d if isinstance(d, dict) else {}
    except (OSError, ValueError):
        return {}


def _load(path, default):
    try:
        with open(path, encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return default


def _save(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False)
    os.replace(tmp, path)


def _emit(kind, **data):
    try:
        jobs._emit("autopilot", {"kind": kind, **data})
    except Exception:
        pass


def attach(notify=None):
    """Called by the app at startup: how to show a Windows/tray notification. Also starts the scheduler."""
    global _notify
    if notify:
        _notify = notify
    start()


def _say_notify(title, text):
    if _notify:
        try:
            _notify(title, text)
            return
        except Exception:
            pass
    _emit("toast", text=f"{title}: {text}")


# =============================================================== system state
class _LASTINPUTINFO(ctypes.Structure):
    _fields_ = [("cbSize", wintypes.UINT), ("dwTime", wintypes.DWORD)]


def idle_seconds():
    li = _LASTINPUTINFO()
    li.cbSize = ctypes.sizeof(li)
    if not ctypes.windll.user32.GetLastInputInfo(ctypes.byref(li)):
        return 0
    now = ctypes.windll.kernel32.GetTickCount() & 0xFFFFFFFF
    return ((now - li.dwTime) & 0xFFFFFFFF) / 1000.0  # masked: survives the 49.7-day wraparound


class _SPS(ctypes.Structure):
    _fields_ = [("ACLineStatus", ctypes.c_byte), ("BatteryFlag", ctypes.c_byte), ("BatteryLifePercent", ctypes.c_byte),
                ("SystemStatusFlag", ctypes.c_byte), ("BatteryLifeTime", wintypes.DWORD), ("BatteryFullLifeTime", wintypes.DWORD)]


def battery_saver():
    s = _SPS()
    return bool(ctypes.windll.kernel32.GetSystemPowerStatus(ctypes.byref(s)) and (s.SystemStatusFlag & 1))


def power():
    """(plugged: bool|None, battery %: int|None)."""
    s = _SPS()
    if not ctypes.windll.kernel32.GetSystemPowerStatus(ctypes.byref(s)):
        return None, None
    ac = {0: False, 1: True}.get(s.ACLineStatus & 0xFF)
    pct = s.BatteryLifePercent & 0xFF
    no_battery = (s.BatteryFlag & 0xFF) == 128
    return ac, (None if pct == 255 or no_battery else pct)


def fullscreen_state():
    """0 = nothing, otherwise the QUERY_USER_NOTIFICATION_STATE value (2 busy/full screen, 3 D3D full screen, 4 presentation)."""
    st = ctypes.c_int(0)
    try:
        if ctypes.windll.shell32.SHQueryUserNotificationState(ctypes.byref(st)) != 0:
            return 0
    except Exception:
        return 0
    return st.value if st.value in (2, 3, 4) else 0


def locked():
    return any((p.info.get("name") or "").lower() == "logonui.exe" for p in psutil.process_iter(["name"]))


def _consent_in_use(cap):
    """True if an app is using the microphone/webcam right now (LastUsedTimeStop == 0 with a start set)."""
    base = rf"Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\{cap}"

    def scan(path):
        try:
            with winreg.OpenKey(winreg.HKEY_CURRENT_USER, path) as k:
                for i in range(winreg.QueryInfoKey(k)[0]):
                    sub = winreg.EnumKey(k, i)
                    if sub == "NonPackaged":
                        if scan(path + "\\NonPackaged"):
                            return True
                        continue
                    try:
                        with winreg.OpenKey(k, sub) as s:
                            start = winreg.QueryValueEx(s, "LastUsedTimeStart")[0]
                            stop = winreg.QueryValueEx(s, "LastUsedTimeStop")[0]
                            if start and not stop:
                                return True
                    except OSError:
                        pass
        except OSError:
            pass
        return False
    return scan(base)


def in_call():
    return _consent_in_use("microphone") or _consent_in_use("webcam")


def wifi_ssid():
    try:
        raw = subprocess.run(["netsh", "wlan", "show", "interfaces"], capture_output=True, timeout=5,
                             creationflags=NO_WINDOW).stdout
        try:
            out = raw.decode("utf-8")
        except UnicodeDecodeError:
            out = raw.decode("cp850", "replace")
        for line in out.splitlines():
            k, _, v = line.partition(":")
            if k.strip().upper() == "SSID":   # "SSID" on English and Spanish Windows ("BSSID" is a different line)
                return v.strip() or None
    except Exception:
        pass
    return None


def metered():
    """True/False, or None if Windows didn't answer."""
    try:
        out = subprocess.run(["powershell.exe", "-NoProfile", "-NonInteractive", "-Command",
                              "[void][Windows.Networking.Connectivity.NetworkInformation,Windows.Networking.Connectivity,ContentType=WindowsRuntime];"
                              "$p=[Windows.Networking.Connectivity.NetworkInformation]::GetInternetConnectionProfile();"
                              "if($p){$p.GetConnectionCost().NetworkCostType}"], capture_output=True, timeout=15,
                             creationflags=NO_WINDOW).stdout.decode("utf-8", "replace").strip()
        if not out:
            return None
        return out.lower() not in ("unrestricted", "unknown")
    except Exception:
        return None


def free_gb(drive):
    try:
        return psutil.disk_usage(drive.rstrip("\\") + "\\").free / 1024 ** 3
    except OSError:
        return None


# apps the UI offers, mapped to their process names
APP_PROCS = {
    "steam": ["steam.exe"], "epic games": ["epicgameslauncher.exe"], "fl studio": ["fl64.exe", "fl.exe"],
    "brave": ["brave.exe"], "discord": ["discord.exe"], "obs studio": ["obs64.exe", "obs32.exe", "obs.exe"],
    "medal": ["medal.exe"], "spotify": ["spotify.exe"], "onedrive": ["onedrive.exe"],
}


def app_running(app):
    a = (app or "").strip().lower()
    if a == "any game":
        return fullscreen_state() == 3
    names = set(APP_PROCS.get(a, [a if a.endswith(".exe") else a + ".exe"]))
    return any((p.info.get("name") or "").lower() in names for p in psutil.process_iter(["name"]))


def gpu_temp():
    try:
        out = subprocess.run(["nvidia-smi", "--query-gpu=temperature.gpu", "--format=csv,noheader,nounits"],
                             capture_output=True, text=True, timeout=5, creationflags=NO_WINDOW).stdout.strip()
        return float(out.splitlines()[0])
    except Exception:
        return None


def cpu_temp():
    if not _admin():
        return None
    try:
        import clr  # noqa: F401
        clr.AddReference("System.Management")
        from System.Management import ManagementObjectSearcher
        en = ManagementObjectSearcher(r"root\WMI", "SELECT CurrentTemperature FROM MSAcpi_ThermalZoneTemperature").Get().GetEnumerator()
        temps = []
        while en.MoveNext():   # never list()/len(): a denied WMI query would crash the process through pythonnet
            c = int(en.Current["CurrentTemperature"]) / 10 - 273.15
            if 25 < c < 110:
                temps.append(c)
        return max(temps) if temps else None
    except Exception:
        return None


def _downloads_dir(name):
    name = (name or "").strip() or "Downloads"
    if os.path.isabs(name):
        return name
    try:
        from .removal import paths as _p
        d = _p.kf("Downloads")
        if d and name.lower() == "downloads":
            return d
    except Exception:
        pass
    return os.path.join(os.path.expanduser("~"), name)


# =============================================================== capabilities
CLEAN_MAP = {
    "Windows temporary files": ["win_temp"], "User temporary files": ["user_temp"],
    "Browser caches": ["chrome", "edge", "brave", "opera", "firefox"], "Thumbnails": ["thumbs"],
    "Crash dumps": ["dumps"], "Windows Update leftovers": ["wu_cache"], "Delivery Optimization": ["do_cache"],
    "Shader caches": ["nvidia"], "Old logs": [], "Program leftovers": [],
}
UNAVAILABLE = {
    "t": {"shutdown": "Windows only tells the app in front that it's shutting down, so StellarHub can't run things on shutdown yet."},
    "c": {},
    "a": {},
}


def _engine_has(mod, fn, kind="call"):
    try:
        from . import resolve
        resolve(mod, fn, kind)
        return True
    except Exception:
        return False


def capabilities():
    """What works for real. {t:{k:reason}, c:{...}, a:{...}} lists only what is NOT available, with the reason."""
    out = {"t": dict(UNAVAILABLE["t"]), "c": {}, "a": {}}
    need = {
        "clean": ("optimizer", "clean", "job"), "recycle": ("optimizer", "clean", "job"),
        "restore": ("optimizer", "restore_point", "job"), "sfc": ("optimizer", "repair", "job"),
        "explorer": ("optimizer", "repair", "job"), "plan": ("optimizer", "perf_set", "call"),
        "game": ("optimizer", "perf_set", "call"), "drvScan": ("drivers", "search", "job"),
        "drvInstall": ("drivers", "install", "job"), "drvBackup": ("drivers", "export", "job"),
        "apps": ("updater", "install", "job"), "winUpd": ("updater", "scan_windows", "job"),
        "store": ("updater", "install", "job"), "defender": ("updater", "install", "job"),
        "quar": ("remover", "quarantine_list", "call"), "dupes": ("storage", "duplicates", "job"),
        "scanDisk": ("storage", "scan", "job"), "oldDl": ("storage", "trash", "call"),
    }
    for k, (m, f, kind) in need.items():
        if not _engine_has(m, f, kind):
            out["a"][k] = f"The {m} engine isn't available in this version."
    if not _gpu_ok():
        out["c"]["__gpu"] = "No NVIDIA graphics card found: graphics card temperature can't be read."
    return out


_gpu_cache = {}


def _gpu_ok():
    if "ok" not in _gpu_cache:
        _gpu_cache["ok"] = gpu_temp() is not None
    return _gpu_cache["ok"]


# =============================================================== log and state
def log(limit=100):
    return _load(_log_file(), [])[:limit]


def clear_log():
    with _lock:
        _save(_log_file(), [])
    _emit("log")
    return True


def _append_log(entry):
    with _lock:
        lg = _load(_log_file(), [])
        lg.insert(0, entry)
        _save(_log_file(), lg[:200])
    _emit("log", entry=entry)


def _state():
    return _load(_state_file(), {"fired": {}, "ev": {}, "last": {}})


def _save_state(st):
    with _lock:
        _save(_state_file(), st)


def status():
    return {"running": bool(_thread and _thread.is_alive()), "busy": sorted(_running), "queued": [q[0] for q in _queue],
            "admin": _admin(), "tick": TICK, "catchUpHours": CATCH_UP // 3600}


# =============================================================== schedule maths
def _hm(s, default="09:00"):
    try:
        h, m = (s or default).split(":")
        return int(h), int(m)
    except ValueError:
        h, m = default.split(":")
        return int(h), int(m)


def _last_occurrence(trig, now):
    """Most recent scheduled time <= now for time triggers, or None."""
    k, p = trig.get("k"), trig.get("p") or {}
    if k == "once":
        try:
            t = datetime.fromisoformat(f"{p.get('date')}T{p.get('time') or '10:00'}")
        except ValueError:
            return None
        return t if t <= now else None
    if k in ("daily", "weekdays", "monthly"):
        h, m = _hm(p.get("time"))
        for back in range(0, 63):
            d = (now - timedelta(days=back)).replace(hour=h, minute=m, second=0, microsecond=0)
            if d > now:
                continue
            wd = d.weekday()
            if k == "daily":
                return d
            if k == "weekdays" and wd in (p.get("days") or []):
                return d
            if k == "monthly":
                mode = p.get("mode") or "day"
                if mode == "day" and d.day == int(p.get("day") or 1):
                    return d
                if mode != "day" and wd == int(p.get("weekday") or 0):
                    if mode == "first" and d.day <= 7:
                        return d
                    if mode == "last" and (d + timedelta(days=7)).month != d.month:
                        return d
        return None
    return None


# =============================================================== triggers
def _trig_key(rid, i, trig):
    return f"{rid}:{i}:{trig.get('k')}"


def _check_triggers(r, st, now, ctx):
    """Returns a reason text if any trigger of routine r fires now, else None. Updates st (fired/ev)."""
    rid = r.get("id")
    reason = None
    for i, t in enumerate(r.get("triggers") or []):
        k, p = t.get("k"), t.get("p") or {}
        key = _trig_key(rid, i, t)
        ev = st["ev"].setdefault(key, {})
        sig = json.dumps(p, sort_keys=True)
        if ev.get("sig") != sig:          # new or edited trigger: start from now, never fire for the past
            ev.clear()
            ev["sig"] = sig
            ev["since"] = now.timestamp()
            st["fired"][key] = now.timestamp()
            ev["init"] = True
        fired_at = st["fired"].get(key, 0)
        hit = None
        if k in ("once", "daily", "weekdays", "monthly"):
            occ = _last_occurrence(t, now)
            if occ and occ.timestamp() > fired_at and now.timestamp() - occ.timestamp() <= CATCH_UP:
                hit = f"scheduled for {occ.strftime('%a %H:%M')}"
                st["fired"][key] = occ.timestamp()
        elif k == "everyN":
            every = max(1, float(p.get("hours") or 6)) * 3600
            if now.timestamp() - fired_at >= every:
                hit = f"every {p.get('hours')} h"
                st["fired"][key] = now.timestamp()
        elif k == "boot":
            boot = psutil.boot_time()
            up = time.time() - boot
            delay = float(p.get("delay") or 0) * 60
            if ev.get("init"):
                ev["boot"] = boot   # a new trigger never fires for a startup that already happened
            elif ev.get("boot") != boot and delay <= up <= delay + 1800:
                ev["boot"] = boot
                hit = "Windows started"
            elif ev.get("boot") != boot and up > delay + 1800:
                ev["boot"] = boot   # StellarHub opened long after startup: that startup is gone
        elif k == "login":
            users = [u for u in psutil.users() if u.name.lower() == os.environ.get("USERNAME", "").lower()]
            started = max((u.started for u in users), default=None)
            if started and ev.get("login") != started:
                if time.time() - started <= 1800 and not ev.get("init"):
                    hit = "you signed in"
                ev["login"] = started
        elif k in ("lock", "unlock"):
            cur = ctx.setdefault("locked", locked())
            prev = ev.get("v")
            ev["v"] = cur
            if prev is not None and prev != cur and cur == (k == "lock"):
                hit = "the PC was locked" if k == "lock" else "the PC was unlocked"
        elif k == "idle":
            idle = ctx.setdefault("idle", idle_seconds())
            need = float(p.get("min") or 15) * 60
            if idle < 60:
                ev["armed"] = True
            elif idle >= need and ev.get("armed", True):
                ev["armed"] = False
                hit = f"{int(idle // 60)} min without using the PC"
        elif k in ("plugIn", "plugOut", "batteryBelow"):
            ac, pct = ctx.setdefault("power", power())
            if k == "batteryBelow":
                below = pct is not None and pct < float(p.get("pct") or 20)
                if below and ev.get("v") is False:
                    hit = f"battery at {pct}%"
                ev["v"] = below
            else:
                prev = ev.get("v")
                ev["v"] = ac
                if prev is not None and ac is not None and prev != ac and ac == (k == "plugIn"):
                    hit = "the charger was plugged in" if k == "plugIn" else "the charger was unplugged"
        elif k == "diskBelow":
            fg = free_gb(p.get("drive") or "C:")
            lim = float(p.get("gb") or 50)
            if fg is not None:
                if fg < lim and ev.get("v") is not True:
                    hit = f"{p.get('drive')} has {fg:.1f} GB free"
                    ev["v"] = True
                elif fg >= lim + 1:
                    ev["v"] = False
        elif k == "download":
            d = _downloads_dir(p.get("folder"))
            seen = ev.setdefault("files", {})
            cur = {}
            try:
                for e in os.scandir(d):
                    if e.is_file(follow_symlinks=False):
                        n = e.name.lower()
                        if n.endswith((".crdownload", ".part", ".partial", ".tmp", ".download", ".opdownload")):
                            continue
                        cur[e.name] = e.stat().st_size
            except OSError:
                cur = None
            if cur is not None:
                if ev.get("ready"):
                    pend = ev.setdefault("pend", {})
                    for n, sz in cur.items():
                        if n not in seen:
                            if pend.get(n) == sz:           # size stable for one whole tick: the download finished
                                hit = f"{n} finished downloading"
                                pend.pop(n, None)
                                seen[n] = sz
                            else:
                                pend[n] = sz
                    for n in list(pend):
                        if n not in cur:
                            pend.pop(n)
                    for n in list(seen):
                        if n not in cur:
                            seen.pop(n)
                else:
                    ev["files"] = dict(cur)
                    ev["ready"] = True
        elif k in ("newDrivers", "newUpdates"):
            pend = (ctx.setdefault("settings", _settings()).get("pending") or {}).get("drivers" if k == "newDrivers" else "apps") or {}
            at, n = pend.get("at"), pend.get("n") or 0
            if at and at != ev.get("at"):
                if n > 0 and ev.get("at") is not None:
                    hit = f"{n} {'drivers' if k == 'newDrivers' else 'apps'} waiting"
                ev["at"] = at
        elif k == "wifi":
            ssid = ctx.setdefault("ssid", wifi_ssid())
            want = (p.get("ssid") or "").strip().lower()
            cur = (ssid or "").lower() == want and bool(want)
            if cur and ev.get("v") is False:
                hit = f"connected to {ssid}"
            ev["v"] = cur
        elif k in ("appOpen", "appClose"):
            cur = app_running(p.get("app"))
            prev = ev.get("v")
            ev["v"] = cur
            if prev is not None and prev != cur and cur == (k == "appOpen"):
                hit = f"{p.get('app')} {'opened' if cur else 'closed'}"
        elif k in ("temp", "ram"):
            if k == "temp":
                val = gpu_temp() if p.get("sensor") == "gpu" else cpu_temp()
                over = val is not None and val > float(p.get("deg") or 85)
            else:
                val = psutil.virtual_memory().percent
                over = val > float(p.get("pct") or 90)
            if over:
                if not ev.get("since"):
                    ev["since"] = time.time()
                if ev.get("since") and time.time() - ev["since"] >= float(p.get("min") or 3) * 60 and not ev.get("fired"):
                    ev["fired"] = True
                    hit = (f"{'graphics card' if p.get('sensor') == 'gpu' else 'processor'} at {val:.0f} °C" if k == "temp"
                           else f"memory at {val:.0f}%")
            else:
                ev["since"] = None
                ev["fired"] = False
        ev.pop("init", None)
        if hit and not reason:
            reason = hit
    return reason


# =============================================================== conditions
def _eval_cond(c, r, ctx):
    k, p = c.get("k"), c.get("p") or {}
    now = datetime.now()
    if k in ("plugged", "battery"):
        ac, pct = ctx.setdefault("power", power())
        if k == "plugged":
            if ac is None:
                return True, "this PC has no battery: always plugged in"
            return ac, "it's plugged in" if ac else "it's on battery"
        if pct is None:
            return True, "this PC has no battery"
        return pct >= float(p.get("pct") or 50), f"the battery is at {pct}%"
    if k == "idle":
        s = ctx.setdefault("idle", idle_seconds())
        return s >= float(p.get("min") or 5) * 60, (f"unused for {int(s // 60)} min" if s >= 60 else "you're using it right now")
    if k == "noFull":
        fs = ctx.setdefault("full", fullscreen_state())
        return fs == 0, {0: "nothing is in full screen", 2: "an app is in full screen", 3: "a game is in full screen", 4: "a presentation is running"}[fs]
    if k == "cpu":
        v = ctx.setdefault("cpu", psutil.cpu_percent(interval=1))
        return v < float(p.get("pct") or 30), f"the processor is at {v:.0f}%"
    if k == "noMeeting":
        busy = ctx.setdefault("call", in_call())
        return not busy, "the microphone or camera is in use" if busy else "microphone and camera are free"
    if k == "window":
        t = now.strftime("%H:%M")
        a, b = p.get("from") or "22:00", p.get("to") or "08:00"
        inside = (a <= t < b) if a <= b else (t >= a or t < b)
        return inside, f"it's {t} now"
    if k == "days":
        wd = now.weekday()
        return wd in (p.get("days") or []), f"today is {now.strftime('%A')}"
    if k == "unmetered":
        m = ctx.setdefault("metered", metered())
        if m is None:
            return True, "Windows didn't say whether the connection is metered"
        return not m, "the connection is metered" if m else "the connection isn't metered"
    if k == "onWifi":
        ssid = ctx.setdefault("ssid", wifi_ssid())
        want = (p.get("ssid") or "").strip()
        return bool(ssid) and ssid.lower() == want.lower(), f"you're on “{ssid}”" if ssid else "you're not on Wi-Fi"
    if k == "junk":
        j = ((ctx.setdefault("settings", _settings()).get("pending") or {}).get("junk") or {})
        if j.get("n") is None:
            return False, "Super Optimizer hasn't measured the junk yet"
        return float(j["n"]) >= float(p.get("gb") or 5), f"there are {float(j['n']):.1f} GB of junk"
    if k == "diskFree":
        fg = free_gb(p.get("drive") or "C:")
        if fg is None:
            return False, f"{p.get('drive')} isn't available"
        return fg < float(p.get("gb") or 100), f"{p.get('drive')} has {fg:.0f} GB free"
    if k == "admin":
        a = _admin()
        return a, "StellarHub is running as administrator" if a else "StellarHub is in normal mode"
    if k == "notSince":
        last = _state()["last"].get(r.get("id"))
        if not last:
            return True, "it has never run"
        h = (time.time() - last) / 3600
        return h >= float(p.get("hours") or 24), f"it ran {max(1, round(h))} h ago"
    if k == "app":
        on = app_running(p.get("app"))
        want_open = p.get("st") == "open"
        return on == want_open, f"{p.get('app')} is {'open' if on else 'closed'}"
    return True, ""


def _conds_ok(r, ctx):
    ev = [(c, *_eval_cond(c, r, ctx)) for c in (r.get("conds") or [])]
    if not ev:
        return True, ev
    oks = [e[1] for e in ev]
    return (all(oks) if r.get("condMode", "all") == "all" else any(oks)), ev


# =============================================================== actions
class _Sub:
    """Lets an action call another engine's long job inside this run: logs and cancel are forwarded."""

    def __init__(self, parent, label):
        self.parent, self.label = parent, label
        self.data = {}
        self.id = parent.id

    @property
    def cancelled(self):
        return self.parent.cancelled

    def progress(self, pct=None, text=None, force=False, **data):
        self.data.update(data)
        if text:
            self.parent.progress(text=f"{self.label}: {text}", force=force)

    def log(self, line):
        self.parent.log(line)

    def check(self):
        self.parent.check()

    def stop(self):
        self.parent.stop()


def _call(mod, fn, *args):
    from . import resolve
    return resolve(mod, fn, "call")(*args)


class _NeedAdmin(Exception):
    pass


def _job(job, label, mod, fn, *args):
    from . import resolve
    out = resolve(mod, fn, "job")(_Sub(job, label), *args)
    if isinstance(out, dict) and out.get("needAdmin"):
        raise _NeedAdmin()
    return out


POWER_PLANS = {"saver": "a1841308-3540-4fab-bc81-f71556f20b4a", "balanced": "381b4222-f694-41f0-9685-ff5bb260df2e",
               "high": "8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c", "max": "e9a42b02-d5df-448d-aa00-03f14749eb61"}
OVERLAY = {"saver": "efficiency", "balanced": "balanced", "high": "best", "max": "best"}
ADMIN_ACTS = {"drvInstall", "winUpd", "restore", "sfc"}


def _no_admin_needed(k, p):
    """Admin actions that are read-only in this mode (only look, or ask first)."""
    return (k == "winUpd" and p.get("mode", "search") in ("search", "download")) or (k == "drvInstall" and p.get("mode", "ask") == "ask")


def _act(job, a, r):
    """Runs one action. Returns (kind, text, gb_freed, updated). kind: ok | skip | decide | bad."""
    k, p = a.get("k"), a.get("p") or {}
    if k in ADMIN_ACTS and not _admin() and not _no_admin_needed(k, p):
        return "skip", "skipped: needs administrator mode", 0, 0
    if k == "clean":
        ids = sorted({i for c in (p.get("cats") or []) for i in CLEAN_MAP.get(c, [])})
        if not ids:
            return "skip", "none of the chosen categories can be cleaned yet", 0, 0
        res = _job(job, "Cleanup", "optimizer", "clean", ids) or {}
        gb = (res.get("freed") or 0) / 1024 ** 3
        sk = res.get("skippedCats") or []
        txt = f"{gb:.1f} GB freed" + (f", {len(sk)} categories skipped (need administrator)" if sk else "")
        return ("ok" if not sk else "skip"), txt, gb, 0
    if k == "recycle":
        res = _job(job, "Recycle Bin", "optimizer", "clean", ["recycle"]) or {}
        gb = (res.get("freed") or 0) / 1024 ** 3
        return "ok", f"Recycle Bin emptied ({gb:.1f} GB)", gb, 0
    if k == "oldDl":
        if p.get("to") == "quar":
            return "skip", "moving downloads to quarantine isn't available yet: choose the Recycle Bin", 0, 0
        d = _downloads_dir("Downloads")
        limit = time.time() - float(p.get("days") or 30) * 86400
        n = size = 0
        try:
            for e in os.scandir(d):
                job.check()
                try:
                    stt = e.stat(follow_symlinks=False)
                except OSError:
                    continue
                if e.is_symlink() or stt.st_mtime > limit:
                    continue
                res = _call("storage", "trash", e.path) or {}
                if res.get("ok"):
                    n += 1
                    size += stt.st_size if e.is_file(follow_symlinks=False) else 0
        except OSError as ex:
            return "bad", f"couldn't read the downloads folder ({ex})", 0, 0
        return "ok", f"{n} old downloads sent to the Recycle Bin", size / 1024 ** 3, 0
    if k == "quar":
        age = float(p.get("age") or 14) * 86400
        n = 0
        for s in _call("remover", "quarantine_list") or []:
            when = s.get("created")
            try:
                ts = float(when) if isinstance(when, (int, float)) else datetime.fromisoformat(str(when)).timestamp()
            except (TypeError, ValueError):
                continue
            if time.time() - ts >= age:
                _call("remover", "quarantine_delete", s["id"])
                n += 1
        return "ok", f"{n} quarantine {'entry' if n == 1 else 'entries'} removed", 0, 0
    if k == "dupes":
        _job(job, "Disk scan", "storage", "scan", "C:\\")
        res = _job(job, "Duplicates", "storage", "duplicates", max(1, int(float(p.get("min") or 50)))) or {}
        groups = res.get("groups") or []
        waste = res.get("wasted") or 0
        return "ok", f"{len(groups)} groups of duplicates found" + (f", {waste / 1024 ** 3:.1f} GB repeated" if waste else ""), 0, 0
    if k == "drvScan":
        res = _job(job, "Drivers", "drivers", "search") or {}
        n = len(res.get("updates") or [])
        _emit("pending", key="drivers", n=n)
        return "ok", f"{n} new {'driver' if n == 1 else 'drivers'} found", 0, 0
    if k == "drvInstall":
        res = _job(job, "Drivers", "drivers", "search") or {}
        ups = res.get("updates") or []
        if not ups:
            return "ok", "no new drivers", 0, 0
        if p.get("mode", "ask") == "ask":
            return "decide", f"{len(ups)} new {'driver is' if len(ups) == 1 else 'drivers are'} waiting for your approval in Driver Updater", 0, 0
        pick = [u for u in ups if p.get("mode") == "all" or not u.get("optional")]
        out = _job(job, "Drivers", "drivers", "install", [u["id"] for u in pick]) or {}
        if out.get("needAdmin"):
            return "skip", "skipped: needs administrator mode", 0, 0
        ok = sum(1 for x in (out.get("results") or []) if x.get("ok"))
        return ("ok" if ok == len(pick) else "skip"), f"{ok} of {len(pick)} drivers installed", 0, ok
    if k == "drvBackup":
        out = _job(job, "Driver backup", "drivers", "export", None)
        if isinstance(out, dict) and out.get("needAdmin"):
            return "skip", "skipped: needs administrator mode", 0, 0
        keep = int(float(p.get("keep") or 3))
        old = (_call("drivers", "backups") or [])[keep:]
        for b in old:
            _job(job, "Old backups", "drivers", "delete_backup", b["path"])
        return "ok", "drivers backed up" + (f", {len(old)} old {'copy' if len(old) == 1 else 'copies'} sent to the Recycle Bin" if old else ""), 0, 0
    if k in ("apps", "store"):
        res = _job(job, "Apps", "updater", "scan_apps") or {}
        items = [i for i in (res.get("items") or []) if not i.get("pinned")]
        if k == "store":
            items = [i for i in items if (i.get("source") or "").lower() == "msstore"]
        elif p.get("scope") == "list":
            want = [w.lower() for w in (p.get("list") or [])]
            items = [i for i in items if any(w in (i.get("name") or "").lower() for w in want)]
        elif p.get("scope") == "sec":
            return _act(job, {"k": "winUpd", "p": {"mode": "install", "only": "security"}}, r)
        if not items:
            _emit("pending", key="apps", n=0)
            return "ok", "everything is already up to date", 0, 0
        for i in items:
            i.pop("_p", None)
        out = _job(job, "Apps", "updater", "install", items) or {}
        done = sum(1 for s in (out.get("items") or []) if s.get("st") == "done") if isinstance(out, dict) else 0
        return ("ok" if done == len(items) else "skip"), f"{done} of {len(items)} apps updated", 0, done
    if k == "winUpd":
        res = _job(job, "Windows Update", "updater", "scan_windows") or {}
        ups = res.get("updates") or []
        if p.get("only") == "security":
            ups = [u for u in ups if u.get("cat") == "security"]
        if p.get("mode", "search") in ("search", "download") or not ups:
            note = " (downloading on its own isn't available yet)" if p.get("mode") == "download" else ""
            return "ok", f"{len(ups)} Windows {'update' if len(ups) == 1 else 'updates'} available{note}", 0, 0
        out = _job(job, "Windows Update", "updater", "install", ups) or {}
        done = sum(1 for s in (out.get("items") or []) if s.get("st") == "done") if isinstance(out, dict) else 0
        return ("ok" if done == len(ups) else "skip"), f"{done} of {len(ups)} Windows updates installed", 0, done
    if k == "defender":
        out = _job(job, "Defender", "updater", "install", [{"kind": "defender", "name": "Defender definitions"}]) or {}
        st = ((out.get("items") or [{}])[0] or {}).get("st") if isinstance(out, dict) else None
        return ("ok" if st == "done" else "skip"), "Defender definitions updated" if st == "done" else "Defender isn't active (another antivirus protects the PC)", 0, 0
    if k == "restore":
        res = _job(job, "Restore point", "optimizer", "restore_point", f"StellarHub Autopilot: {r.get('name', '')}") or {}
        if res.get("needAdmin"):
            return "skip", "skipped: needs administrator mode", 0, 0
        ok = bool(res.get("ok"))
        return ("ok" if ok else "skip"), "restore point created" if ok else (res.get("msg") or "Windows didn't create a restore point"), 0, 0
    if k == "sfc":
        kinds = ["sfc", "dism"] if p.get("kind") == "both" else [p.get("kind") or "sfc"]
        for t in kinds:
            _job(job, t.upper(), "optimizer", "repair", t)
        return "ok", f"{' and '.join(x.upper() for x in kinds)} finished", 0, 0
    if k == "net":
        if p.get("kind") == "full":
            _job(job, "Network", "optimizer", "repair", "net")
            return "ok", "network reset (a restart finishes it)", 0, 0
        code = subprocess.run(["ipconfig", "/flushdns"], capture_output=True, creationflags=NO_WINDOW).returncode
        return ("ok" if code == 0 else "bad"), "DNS cache flushed" if code == 0 else "ipconfig couldn't flush the DNS cache", 0, 0
    if k == "explorer":
        _job(job, "File Explorer", "optimizer", "repair", "explorer")
        return "ok", "File Explorer restarted", 0, 0
    if k == "scanDisk":
        drive = (p.get("drive") or "C:").rstrip("\\") + "\\"
        _job(job, "Disk", "storage", "scan", drive)
        cmp_ = _call("storage", "compare") or {}
        grew = sum(c.get("delta", 0) for c in (cmp_.get("changes") or []) if isinstance(c, dict) and c.get("delta", 0) > 0)
        gb = grew / 1024 ** 3 if grew > 1024 ** 2 else grew
        if cmp_.get("prev") is None:
            return "ok", f"{drive[:2]} analyzed (next time it can compare)", 0, 0
        warn = gb > float(p.get("gb") or 10)
        return ("decide" if warn else "ok"), f"{drive[:2]} grew {gb:.1f} GB since the last analysis" + (" — have a look in Storage Checker" if warn else ""), 0, 0
    if k == "plan":
        guid = POWER_PLANS.get(p.get("plan") or "balanced")
        try:
            _call("optimizer", "power_plan_set", guid)
            return "ok", f"switched to the {p.get('plan')} power plan", 0, 0
        except Exception:
            ac, _pct = power()
            key = "dc" if ac is False else "ac"
            _call("optimizer", "perf_set", key, OVERLAY.get(p.get("plan"), "balanced"))
            return "ok", f"power mode set to {OVERLAY.get(p.get('plan'))}", 0, 0
    if k == "game":
        _call("optimizer", "perf_set", "gameMode", p.get("on", "on") == "on")
        return "ok", f"Game Mode turned {p.get('on', 'on')}", 0, 0
    if k == "closeApp":
        a_ = (p.get("app") or "").lower()
        names = set(APP_PROCS.get(a_, [a_ + ".exe"]))
        procs = [pr for pr in psutil.process_iter(["name"]) if (pr.info.get("name") or "").lower() in names]
        for pr in procs:
            try:
                pr.terminate()
            except psutil.Error:
                pass
        psutil.wait_procs(procs, timeout=5)
        return "ok", f"{p.get('app')} closed" if procs else f"{p.get('app')} wasn't open", 0, 0
    if k == "openApp":
        path = (p.get("path") or "").strip().strip('"')
        if not path or not os.path.exists(path):
            return "bad", f"“{path or '…'}” doesn't exist", 0, 0
        os.startfile(path)
        return "ok", f"opened {os.path.basename(path)}", 0, 0
    if k == "cmd":
        cmd = (p.get("cmd") or "").strip()
        if not cmd:
            return "bad", "no command to run", 0, 0
        if p.get("as") == "admin" and not _admin():
            return "skip", "skipped: the command needs administrator mode", 0, 0
        limit = max(1, float((r.get("after") or {}).get("limit") or 60)) * 60
        try:
            pr = subprocess.run(["cmd.exe", "/c", cmd], capture_output=True, timeout=limit, creationflags=NO_WINDOW)
        except subprocess.TimeoutExpired:
            return "bad", "the command took too long and was stopped", 0, 0
        for line in (pr.stdout or b"").decode("utf-8", "replace").splitlines()[-20:]:
            job.log(line)
        return ("ok" if pr.returncode == 0 else "bad"), f"command finished (exit code {pr.returncode})", 0, 0
    if k == "widget":
        _emit("widget", on=p.get("st", "open") == "open")
        return "ok", f"widget {'opened' if p.get('st', 'open') == 'open' else 'closed'}", 0, 0
    if k == "mute":
        return _mute(float(p.get("min") or 60))
    if k == "wait":
        end = time.time() + float(p.get("min") or 1) * 60
        while time.time() < end:
            job.check()
            time.sleep(1)
        return "ok", f"waited {p.get('min')} min", 0, 0
    if k == "power":
        what, count = p.get("what", "sleep"), int(float(p.get("count") or 0))
        if what in ("restart", "off"):
            subprocess.run(["shutdown", "/r" if what == "restart" else "/s", "/t", str(max(0, count)),
                            "/c", "StellarHub Autopilot. To cancel: shutdown /a"], creationflags=NO_WINDOW)
            return "ok", f"{'restart' if what == 'restart' else 'shutdown'} scheduled in {count} s (cancel with shutdown /a)", 0, 0
        if count:
            _say_notify("StellarHub Autopilot", f"The PC will sleep in {count} s. Move the mouse or press Cancel in StellarHub to stop it.")
            end = time.time() + count
            while time.time() < end:
                job.check()
                if idle_seconds() < 2:
                    return "skip", "sleep cancelled: you used the PC", 0, 0
                time.sleep(1)
        ctypes.windll.powrprof.SetSuspendState(False, False, False)
        return "ok", "the PC went to sleep", 0, 0
    return "skip", "this action isn't available yet", 0, 0


def _mute(minutes):
    """Turns Windows notifications off and back on after `minutes` (PushNotifications\\ToastEnabled)."""
    global _mute_timer
    key = r"Software\Microsoft\Windows\CurrentVersion\PushNotifications"
    try:
        with winreg.CreateKeyEx(winreg.HKEY_CURRENT_USER, key, 0, winreg.KEY_SET_VALUE | winreg.KEY_QUERY_VALUE) as k:
            winreg.SetValueEx(k, "ToastEnabled", 0, winreg.REG_DWORD, 0)
    except OSError as e:
        return "bad", f"couldn't mute notifications ({e})", 0, 0

    def back():
        try:
            with winreg.CreateKeyEx(winreg.HKEY_CURRENT_USER, key, 0, winreg.KEY_SET_VALUE) as k:
                winreg.SetValueEx(k, "ToastEnabled", 0, winreg.REG_DWORD, 1)
        except OSError:
            pass
    if _mute_timer:
        _mute_timer.cancel()
    _mute_timer = threading.Timer(minutes * 60, back)
    _mute_timer.daemon = True
    _mute_timer.start()
    return "ok", f"notifications muted for {int(minutes)} min", 0, 0


# =============================================================== running a routine
def _find(rid):
    for r in _settings().get("autopilotRoutines") or []:
        if r.get("id") == rid:
            return r
    return None


def _quiet_now(nt):
    if not nt.get("quiet"):
        return False
    t = datetime.now().strftime("%H:%M")
    a, b = nt.get("qFrom") or "23:00", nt.get("qTo") or "08:00"
    return (a <= t < b) if a <= b else (t >= a or t < b)


def _maybe_notify(r, st, res, force=False):
    nt = _settings().get("autopilotNotify") or {}
    rn = r.get("notify") or {}
    when = rn.get("when") or nt.get("when") or "decide"
    want = force or when == "always" or (when == "decide" and st in ("bad", "decide")) or (when == "errors" and st == "bad")
    if nt.get("batterySaver", True) and battery_saver() and st not in ("bad", "decide"):
        want = False
    if not want or _quiet_now(nt) or (nt.get("noGame", True) and fullscreen_state()):
        return
    if rn.get("toast", True) is False and rn.get("tray", True) is False:
        return
    _say_notify(f"Autopilot: {r.get('name', 'Routine')}", ", ".join(res) or "Done")


def _after_power(what, r):
    """"When it finishes: sleep / shut down". Shutting down gives 60 s to cancel (shutdown /a)."""
    if what == "off":
        subprocess.run(["shutdown", "/s", "/t", "60", "/c", f"StellarHub Autopilot finished “{r.get('name', '')}”. To cancel: shutdown /a"],
                       creationflags=NO_WINDOW)
    elif what == "sleep":
        _say_notify("StellarHub Autopilot", f"“{r.get('name', '')}” finished. The PC will sleep in 60 s unless you use it.")
        def later():
            end = time.time() + 60
            while time.time() < end:
                if idle_seconds() < 2:
                    return
                time.sleep(1)
            ctypes.windll.powrprof.SetSuspendState(False, False, False)
        threading.Thread(target=later, daemon=True).start()


def run(job, rid, manual=True, routine=None, reason=""):
    """Runs a routine now (from "Run now", or from the scheduler). Returns the log entry."""
    r = routine or _find(rid)
    if not r:
        raise ValueError("That routine doesn't exist anymore.")
    rid = r.get("id") or rid
    if rid in _running:
        raise RuntimeError("That routine is already running.")
    _running.add(rid)
    started = time.time()
    steps, gb, upd = [], 0.0, 0
    after = r.get("after") or {}
    limit = max(1, float(after.get("limit") or 60)) * 60
    acts = r.get("acts") or []
    failed = cancelled = False
    try:
        if reason:
            steps.append(["ok", f"Started because {reason}"])
        for i, a in enumerate(acts):
            job.check()
            if time.time() - started > limit:
                steps.append(["bad", f"Stopped: it went over the {int(limit // 60)} min limit"])
                failed = True
                break
            job.progress(i / max(1, len(acts)), f"Step {i + 1} of {len(acts)}", step=i, total=len(acts), force=True)
            tries = 1 + (int(after.get("retries") or 0) if after.get("onFail") == "retry" else 0)
            for attempt in range(tries):
                try:
                    kind, text, g, u = _act(job, a, r)
                except jobs.Cancelled:
                    raise
                except _NeedAdmin:
                    kind, text, g, u = "skip", "skipped: needs administrator mode", 0, 0
                except Exception as e:
                    kind, text, g, u = "bad", f"failed: {e}", 0, 0
                if kind != "bad" or attempt == tries - 1:
                    break
                job.log(f"Retrying ({attempt + 2} of {tries})…")
                time.sleep(5)
            gb += g or 0
            upd += u or 0
            label = a.get("k")
            steps.append([kind, f"{_ACT_NAMES.get(label, label)}: {text}"])
            if kind == "bad":
                failed = True
                if after.get("onFail") in ("stop", "retry"):
                    if i < len(acts) - 1:
                        steps.append(["skip", "The rest was skipped because a step failed"])
                    break
        job.progress(1, "Finished", force=True)
    except jobs.Cancelled:
        steps.append(["skip", "Cancelled"])
        cancelled = True
    finally:
        _running.discard(rid)
    st = "bad" if failed else ("warn" if any(s[0] in ("skip", "decide") for s in steps) else "ok")
    res = []
    if gb >= .05:
        res.append(f"{gb:.1f} GB freed")
    if upd:
        res.append(f"{upd} updated")
    sk = sum(1 for s in steps if s[0] == "skip")
    dc = sum(1 for s in steps if s[0] == "decide")
    if dc:
        res.append(f"{dc} waiting for you")
    if sk:
        res.append(f"{sk} {'step' if sk == 1 else 'steps'} skipped")
    if failed:
        res.append("something failed")
    entry = {"id": uuid.uuid4().hex[:10], "rid": rid, "when": datetime.now().astimezone().isoformat(), "name": r.get("name", "Routine"),
             "color": r.get("color", 0), "st": st, "gb": round(gb, 2), "upd": upd, "manual": bool(manual),
             "res": res or ["Done"], "steps": [[("decide" if k == "decide" else k), t] for k, t in steps],
             "secs": round(time.time() - started)}
    _append_log(entry)
    with _lock:
        s = _state()
        s["last"][rid] = time.time()
        _save_state(s)
    with _lock:
        s = _state()
        rt = s.setdefault("retry", {})
        if failed and not manual and after.get("tomorrow", True):
            rt[rid] = (datetime.now() + timedelta(days=1)).timestamp()
        else:
            rt.pop(rid, None)
        _save_state(s)
    _maybe_notify(r, "bad" if failed else ("decide" if dc else st), res, force=failed and after.get("failThen") == "notify")
    if not failed and not cancelled and after.get("okThen") in ("sleep", "off"):
        _after_power(after["okThen"], r)
    nxt = after.get("failRoutine") if failed and after.get("failThen") == "routine" else (
        after.get("okRoutine") if not failed and after.get("okThen") == "routine" else None)
    if nxt and nxt != rid:
        _enqueue(nxt, None, False, f"“{r.get('name')}” {'failed' if failed else 'finished'}")
    return entry


_ACT_NAMES = {
    "clean": "Cleanup", "recycle": "Recycle Bin", "oldDl": "Old downloads", "quar": "Quarantine", "dupes": "Duplicates",
    "drvScan": "Drivers", "drvInstall": "Drivers", "drvBackup": "Driver backup", "apps": "Apps", "winUpd": "Windows Update",
    "store": "Store apps", "defender": "Defender", "restore": "Restore point", "sfc": "Windows files", "net": "Network",
    "explorer": "File Explorer", "scanDisk": "Disk analysis", "plan": "Power plan", "game": "Game Mode",
    "closeApp": "Close app", "openApp": "Open app", "cmd": "Command", "widget": "Widget", "mute": "Notifications",
    "wait": "Wait", "power": "Power",
}


def dry_run(routine):
    """Evaluates a routine right now without running anything: real conditions, what each action would do."""
    r = routine if isinstance(routine, dict) else (_find(routine) or {})
    ctx = {}
    ok, ev = _conds_ok(r, ctx)
    caps = capabilities()["a"]
    acts = []
    for a in r.get("acts") or []:
        k, p = a.get("k"), a.get("p") or {}
        note = ""
        if k in caps:
            note = caps[k]
        elif k in ADMIN_ACTS and not _admin() and not _no_admin_needed(k, p):
            note = "would be skipped: needs administrator"
        elif k == "drvInstall" and p.get("mode", "ask") == "ask":
            note = "would ask you first"
        elif k == "clean" and not any(CLEAN_MAP.get(c) for c in (p.get("cats") or [])):
            note = "none of the chosen categories can be cleaned yet"
        acts.append({"k": k, "note": note})
    return {"ok": ok, "conds": [[o, d] for _c, o, d in ev], "acts": acts, "admin": _admin(),
            "running": rid_running(r.get("id"))}


def rid_running(rid):
    return rid in _running


# =============================================================== the scheduler
_PRIO = {"high": 0, "normal": 1, "low": 2}


def _enqueue(rid, routine, manual, reason):
    """Queues a run; higher priority routines go first when several are waiting."""
    with _lock:
        if rid in _running or any(q[0] == rid for q in _queue):
            return False
        pr = _PRIO.get(((routine or _find(rid) or {}).get("priority")) or "normal", 1)
        pos = next((i for i, q in enumerate(_queue) if q[4] > pr), len(_queue))
        _queue.insert(pos, (rid, routine, manual, reason, pr))
    _emit("queue", queued=[q[0] for q in _queue])
    return True


def _worker():
    while not _stop.is_set():
        item = None
        with _lock:
            if _queue:
                item = _queue.pop(0)
        if not item:
            _stop.wait(1)
            continue
        rid, routine, manual, reason, _pr = item
        done = threading.Event()

        def go(job, rid=rid, routine=routine, manual=manual, reason=reason):
            try:
                return run(job, rid, manual, routine, reason)
            finally:
                done.set()
        jobs.start("autopilot.run", go)
        done.wait(timeout=24 * 3600)


def _tick():
    s = _settings()
    routines = [r for r in (s.get("autopilotRoutines") or []) if isinstance(r, dict)]
    if s.get("autopilotSchema") not in (None, 2):
        return
    st = _state()
    now = datetime.now()
    ctx = {"settings": s}
    nt = s.get("autopilotNotify") or {}
    alive = set()
    known = {r.get("id") for r in routines}
    defer = st.setdefault("deferred", {})
    retry = st.setdefault("retry", {})
    gaming = bool(nt.get("noGame", True)) and ctx.setdefault("full", fullscreen_state()) != 0
    if not gaming:                         # runs held back while something was in full screen
        for rid, why in list(defer.items()):
            defer.pop(rid)
            if rid in known:
                _enqueue(rid, None, False, why + " (held back while something was in full screen)")
    for rid, at in list(retry.items()):    # "Try again the next day"
        if rid not in known:
            retry.pop(rid)
        elif time.time() >= at and not gaming:
            retry.pop(rid)
            _enqueue(rid, None, False, "it failed yesterday and is trying again")
    _weekly(st, nt, now)
    for r in routines:
        rid = r.get("id")
        for i, t in enumerate(r.get("triggers") or []):
            alive.add(_trig_key(rid, i, t))
        if not r.get("on", True) or not r.get("acts"):
            continue
        pz = r.get("pausedUntil")
        if pz:
            try:
                if now <= datetime.fromisoformat(pz + "T23:59"):
                    continue
            except ValueError:
                pass
        try:
            reason = _check_triggers(r, st, now, ctx)
        except Exception as e:
            print("[autopilot trigger]", e)
            reason = None
        if not reason or rid in _running:
            continue
        ok, ev = _conds_ok(r, ctx)
        if not ok:
            failed = [d for _c, o, d in ev if not o]
            _append_log({"id": uuid.uuid4().hex[:10], "rid": rid, "when": datetime.now().astimezone().isoformat(), "name": r.get("name", "Routine"),
                         "color": r.get("color", 0), "st": "skip", "gb": 0, "upd": 0, "manual": False,
                         "res": [f"Skipped: {failed[0] if failed else 'a condition was not met'}"],
                         "steps": [["ok", f"Started because {reason}"]] + [["skip", f"Not met: {d}"] for d in failed]})
            continue
        if gaming:
            defer[rid] = reason
            continue
        _enqueue(rid, None, False, reason)
    for key in list(st["ev"]):            # forget triggers that no longer exist
        if key not in alive:
            st["ev"].pop(key, None)
            st["fired"].pop(key, None)
    _save_state(st)


def _weekly(st, nt, now):
    """One notification with the whole week, on the chosen day after 18:00."""
    if not nt.get("weekly", True) or now.weekday() != int(nt.get("weeklyDay", 6)) or now.hour < 18:
        return
    wk = now.strftime("%G-%V")
    if st.get("weekly") == wk:
        return
    st["weekly"] = wk
    since = time.time() - 7 * 86400
    week = []
    for e in log(200):
        try:
            if datetime.fromisoformat(e["when"]).timestamp() >= since:
                week.append(e)
        except (KeyError, ValueError):
            pass
    if not week:
        return
    gb = sum(e.get("gb") or 0 for e in week)
    upd = sum(e.get("upd") or 0 for e in week)
    bad = sum(1 for e in week if e.get("st") == "bad")
    parts = [f"{len(week)} {'run' if len(week) == 1 else 'runs'}"]
    if gb >= .1:
        parts.append(f"{gb:.1f} GB freed")
    if upd:
        parts.append(f"{upd} updated")
    if bad:
        parts.append(f"{bad} with problems")
    _say_notify("Autopilot this week", ", ".join(parts))


def _loop():
    while not _stop.is_set():
        try:
            _tick()
        except Exception as e:
            print("[autopilot]", e)
        _stop.wait(TICK)


def start():
    """Starts the scheduler once (safe to call many times)."""
    global _thread
    with _lock:
        if _thread and _thread.is_alive():
            return status()
        _stop.clear()
        _thread = threading.Thread(target=_loop, daemon=True, name="autopilot")
        _thread.start()
        threading.Thread(target=_worker, daemon=True, name="autopilot-worker").start()
    return status()


def stop():
    _stop.set()
