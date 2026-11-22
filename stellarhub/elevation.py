"""Administrator mode: the scheduled task that opens StellarHub elevated without the Windows prompt, deciding at the
start whether this copy must relaunch elevated, and the relaunch itself."""
import ctypes
import os
import sys
import time
from pathlib import Path

from . import config, instance, paths, settings
from .log import phase

ADMIN_TASK = r"StellarHub\Open as administrator"
START_HIDDEN = str(Path(paths.local_dir()) / "start-hidden")  # see elevate_on_start
LEGACY_ADMIN_TASKS = (r"StellarHub\Abrir como administrador",)  # name used by earlier versions


def ensure_admin_task():
    """Creates (or updates) the scheduled task that opens StellarHub elevated without the UAC prompt."""
    if config.PORTABLE:
        return False  # the portable version asks Windows each time instead of leaving a task on the PC
    import subprocess
    from . import schtask
    exe, args = config.launch_cmd("--from-task")
    ok = schtask.create(ADMIN_TASK, exe, args, "Opens StellarHub as administrator without the Windows prompt "
                                               "(Settings > Administrator > Always open as administrator).")
    if ok:  # replace tasks left by earlier versions under another name
        for old in LEGACY_ADMIN_TASKS:
            subprocess.run(["schtasks", "/delete", "/tn", old, "/f"], capture_output=True, creationflags=0x08000000)
    return ok


def repair_update_task():
    """The updater's task, if an older installer made it the old way (it didn't run on battery): made again."""
    if config.PORTABLE or not config.FROZEN:
        return
    try:
        from . import schtask
        from .engine import selfupdate
        if selfupdate._task_exists() and schtask.outdated(schtask.query_xml(selfupdate.TASK)):
            selfupdate.ensure_task()
    except Exception as e:
        print("update task:", e)


def delete_admin_task():
    import subprocess
    for name in (ADMIN_TASK, *LEGACY_ADMIN_TASKS):
        subprocess.run(["schtasks", "/delete", "/tn", name, "/f"], capture_output=True, creationflags=0x08000000)


def wants_elevation():
    """Permanent administrator mode is on and this copy is not elevated (nor a test copy, nor already the elevated one)."""
    if config.is_admin() or config.ISOLATED or "--no-elevate" in sys.argv or "--from-task" in sys.argv:
        return False
    try:
        return bool(settings.read().get("alwaysAdmin"))
    except AttributeError:
        return False


def elevate_on_start():
    """If the user chose permanent administrator mode and this copy is not elevated: relaunch elevated
    (first through the scheduled task, with no prompt; if it does not exist, with the UAC prompt). Returns True if we must exit.
    The start screen is already up ("Opening as administrator…") and stays until the elevated copy takes over."""
    if not wants_elevation():
        return False
    hidden = "--tray" in sys.argv
    import subprocess
    phase("elevating")
    if hidden:  # the task can't take arguments: the elevated copy reads this note and stays in the tray
        try:
            Path(START_HIDDEN).parent.mkdir(parents=True, exist_ok=True)
            Path(START_HIDDEN).touch()
        except OSError:
            pass
    splash = _hand_over_splash()
    ran_at = time.time()
    if not config.PORTABLE and task_opens_this_copy(ADMIN_TASK) and subprocess.run(
            ["schtasks", "/run", "/tn", ADMIN_TASK], capture_output=True, creationflags=0x08000000, timeout=15).returncode == 0:
        # a copy the task did start but that is slow to reach the lock (a cold logon, an antivirus scan) gets up to a
        # minute: ending it after 8 s brought the Windows prompt at every such logon
        if elevated_copy_started() or (_copy_started_since(ran_at) and elevated_copy_started(52)):
            phase("elevated copy started (task)")
            _until_taken_over(splash)
            return True
        # Windows kept the task waiting (a task made by an older version doesn't start on battery) or it failed:
        # drop it and ask Windows the usual way; the elevated copy then makes the task again, the right way
        from . import schtask
        schtask.end(ADMIN_TASK)
    # no task, or it opens another copy (e.g. the source version before installing): ask Windows once;
    # the elevated copy then points the task at itself
    exe, args = config.launch_cmd("--no-elevate" + (" --tray" if hidden else ""))
    if ctypes.windll.shell32.ShellExecuteW(None, "runas", exe, args, config.base_dir(), 1) > 32:
        elevated_copy_started(10)  # keep the start screen up until the elevated copy has its own
        phase("elevated copy started (UAC)")
        _until_taken_over(splash)
        return True
    print("[start] administrator mode was declined: opening in normal mode", flush=True)
    if splash is not None:
        splash.hand_over(False)
    return False  # the user said no: stay in normal mode


def _hand_over_splash():
    """The start screen up in this process, marked for the elevated copy to take over (splash.hand_over), or None."""
    try:
        from . import splash
        if splash.showing():
            splash.hand_over()
            return splash
    except Exception as e:
        print("splash handoff:", e)
    return None


def _until_taken_over(splash, seconds=4):
    """This copy is about to exit: give the elevated copy's start screen (bounded) time to replace this one, so the
    screen is never empty in between."""
    if splash is None:
        return
    end = time.monotonic() + seconds
    while time.monotonic() < end and not splash.handed() and splash.showing():
        time.sleep(0.02)


def _copy_started_since(t):
    """True if another copy of this program has started since `t` (the one the task launched, still starting)."""
    try:
        from .instance import other_copies
        return any(p.create_time() >= t - 1 for p in other_copies())
    except Exception:
        return False


def elevated_copy_started(seconds=8):
    """After running the administrator task: True once the elevated copy holds the single-instance mutex (it takes
    it within a second or two of starting). From a normal copy an elevated mutex can't be opened: access denied
    also means it exists."""
    k32 = ctypes.windll.kernel32
    k32.OpenMutexW.restype = ctypes.c_void_p
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        h = k32.OpenMutexW(0x00100000, False, instance.mutex_name())  # SYNCHRONIZE
        err = k32.GetLastError()
        if h:
            k32.CloseHandle(ctypes.c_void_p(h))
            return True
        if err == 5:  # ERROR_ACCESS_DENIED: it exists, owned by the elevated copy
            return True
        time.sleep(0.15)
    return False


def task_opens_this_copy(name):
    """True if the scheduled task exists and launches this same program (the exe, or run.py from source)."""
    import re
    import subprocess
    try:
        r = subprocess.run(["schtasks", "/query", "/tn", name, "/xml"], capture_output=True, timeout=10,
                           creationflags=0x08000000)
    except (OSError, subprocess.SubprocessError):
        return False
    if r.returncode != 0:
        return False
    raw = r.stdout
    xml = raw.decode("utf-16", "replace") if raw[:2] in (b"\xff\xfe", b"\xfe\xff") else raw.decode("oem", "replace")
    exe, _args = config.launch_cmd()
    cmd = re.search(r"<Command>(.*?)</Command>", xml, re.S)
    arg = re.search(r"<Arguments>(.*?)</Arguments>", xml, re.S)

    def norm(t):
        return os.path.normcase(t.replace("&quot;", '"').strip().strip('"'))
    if not cmd or norm(cmd.group(1)) != norm(exe):
        return False
    return config.FROZEN or (arg is not None and norm(str(Path(config.base_dir()) / "run.py")) in norm(arg.group(1)))


def relaunch_elevated():
    """Asks Windows (UAC) for an elevated copy of this program that waits for this process to exit (it frees the
    single-instance lock and the WebView2 data). True if Windows gave permission; the caller then quits."""
    args = [a for a in sys.argv[1:] if a not in ("--tray",)]
    if "--wait-pid" in args:
        i = args.index("--wait-pid")
        del args[i:i + 2]
    args += ["--wait-pid", str(os.getpid())]
    params = " ".join(f'"{a}"' for a in args)
    if not config.FROZEN:
        params = f'"{Path(config.base_dir()) / "run.py"}" {params}'
    return ctypes.windll.shell32.ShellExecuteW(None, "runas", config.gui_python(), params, config.base_dir(), 1) > 32
