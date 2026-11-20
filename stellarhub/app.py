"""StellarHub window (pywebview + WebView2) and the API the UI sees."""
import ctypes
import hashlib
import json
import os
import shutil
import sys
import collections
import threading
import time

from . import VERSION
from . import paths
from .i18n import tr

APP_ID = "StellarHub.App"
BG = "#060A14"


def _since_start():
    """Seconds since this process was created (Windows' own creation time: includes the interpreter/exe start)."""
    try:
        from ctypes import wintypes as wt
        k32 = ctypes.windll.kernel32
        k32.GetCurrentProcess.restype = ctypes.c_void_p
        c, e, kt, ut = (wt.FILETIME() for _ in range(4))
        k32.GetProcessTimes(ctypes.c_void_p(k32.GetCurrentProcess()), ctypes.byref(c), ctypes.byref(e), ctypes.byref(kt), ctypes.byref(ut))
        created = ((c.dwHighDateTime << 32) | c.dwLowDateTime) / 1e7 - 11644473600
        return max(0.0, time.time() - created)
    except Exception:
        return 0.0


_PHASES_SEEN = set()


def _phase(name, once=True):
    """One log line per start phase, with the time since the process was created: [phase] 1.23 s name.
    That is how a slow start is told apart from a slow piece of it."""
    if once and name in _PHASES_SEEN:
        return
    _PHASES_SEEN.add(name)
    try:
        print(f"[phase] {_since_start():6.2f} s  {name}", flush=True)
    except Exception:
        pass


def base_dir():
    return getattr(sys, "_MEIPASS", os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


UI_DIR = os.path.join(base_dir(), "stellarhub", "ui")
PORTABLE = paths.PORTABLE  # the portable version keeps everything in a Data folder next to the program
DATA_DIR = paths.data_dir()
WEB_DIR = os.path.join(paths.local_dir(), "webview")
# STELLARHUB_ISOLATED=1: a test copy that runs next to the user's (own lock, ports and browser profile)
ISOLATED = os.environ.get("STELLARHUB_ISOLATED") == "1"
if ISOLATED:
    import tempfile
    WEB_DIR = os.path.join(tempfile.gettempdir(), f"stellarhub_isolated_{os.getpid()}")
SETTINGS = os.path.join(DATA_DIR, "settings.json")


FROZEN = bool(getattr(sys, "frozen", False))  # running as the installed StellarHub.exe


def _migrate_store_python_data():
    """Python from the Microsoft Store keeps %APPDATA% in a private copy (LocalCache, Roaming). When the
    installed StellarHub.exe starts for the first time and the real folder has no settings, it brings over
    the settings and the Autopilot log a source run left there, so nothing is lost when switching."""
    if os.path.exists(SETTINGS) or PORTABLE:
        return
    pkgs = os.path.join(os.environ.get("LOCALAPPDATA") or "", "Packages")
    try:
        cands = [os.path.join(pkgs, d, "LocalCache", "Roaming", "StellarHub") for d in os.listdir(pkgs)
                 if d.startswith("PythonSoftwareFoundation.Python.")]
    except OSError:
        return
    cands = [c for c in cands if os.path.isfile(os.path.join(c, "settings.json"))]
    if not cands:
        return
    src = max(cands, key=lambda c: os.path.getmtime(os.path.join(c, "settings.json")))
    try:
        os.makedirs(DATA_DIR, exist_ok=True)
        shutil.copy2(os.path.join(src, "settings.json"), SETTINGS)
        if os.path.isdir(os.path.join(src, "autopilot")):
            shutil.copytree(os.path.join(src, "autopilot"), os.path.join(DATA_DIR, "autopilot"), dirs_exist_ok=True)
    except OSError:
        pass


def _read_settings():
    try:
        with open(SETTINGS, encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return {}


def is_admin():
    try:
        return bool(ctypes.windll.shell32.IsUserAnAdmin())
    except Exception:
        return False


def _gui_python():
    """pythonw.exe if it exists, so relaunching does not open a console."""
    exe = sys.executable
    if not getattr(sys, "frozen", False) and exe.lower().endswith("python.exe"):
        w = exe[:-10] + "pythonw.exe"
        if os.path.exists(w):
            return w
    return exe


class _Sender:
    """One thread per window that runs its evaluate_js calls IN ORDER from a bounded queue. evaluate_js waits for
    WebView2's reply, which arrives on the window thread, so nobody on that thread may call it directly: they put the
    code here instead. Under pressure the oldest "lossy" item (job progress) goes first, never an "end"."""
    LIMIT = 600

    def __init__(self, window):
        self.window = window
        self._q = collections.deque()
        self._cv = threading.Condition()
        self._stop = False
        threading.Thread(target=self._run, daemon=True, name="js-sender").start()

    def put(self, code, lossy=False):
        with self._cv:
            if self._stop:
                return
            if len(self._q) >= self.LIMIT:
                for i, (_, l) in enumerate(self._q):
                    if l:
                        del self._q[i]
                        break
                else:
                    self._q.popleft()
            self._q.append((code, lossy))
            self._cv.notify()

    def stop(self):
        with self._cv:
            self._stop = True
            self._q.clear()
            self._cv.notify()

    def _run(self):
        while True:
            with self._cv:
                while not self._q and not self._stop:
                    self._cv.wait()
                if self._stop:
                    return
                code, _ = self._q.popleft()
            try:
                self.window.evaluate_js(code)
            except Exception:
                pass


class Api:
    """Everything public in this class can be called from JS as window.pywebview.api.<name>."""

    def __init__(self):
        self._window = None
        self._chrome = None
        self._widget = None
        self._tray = None
        self._panel = None          # the tray panel (left click on the tray icon), created on first use
        self._panel_ready = False
        self._panel_shown = False
        self._panel_hidden_at = 0.0
        self._sampler = None
        self._visible = True
        self._minimized = False
        self._quitting = False
        self._told_tray = False
        self._lock = threading.Lock()
        self._senders = {}          # window -> _Sender
        self._widget_pos_timer = None

    def _attach(self, window):
        self._window = window

    # ---------- information ----------
    def info(self):
        return {"version": VERSION, "admin": is_admin(), "portable": PORTABLE}

    _reveal_pending = False

    def _reveal(self):
        """The start screen gives way to the window: show it, fade the page in, fade the card out."""
        if not self._reveal_pending:
            return
        self._reveal_pending = False
        self._js("window.SH && SH.enter && SH.enter()")
        try:  # from off screen to the primary monitor, where show_main maximizes it
            import ctypes.wintypes as wt
            wa = wt.RECT()
            ctypes.windll.user32.SystemParametersInfoW(0x0030, 0, ctypes.byref(wa), 0)
            self._window.move(wa.left + 60, wa.top + 40)
        except Exception as e:
            print("reveal:", e)
        self.show_main()
        try:
            from . import splash
            threading.Timer(.12, splash.close).start()
        except Exception:
            pass

    def phase(self, name):
        """The UI reports its own steps (boot data loaded...) into the start timeline in the log."""
        _phase("ui: " + str(name)[:40])
        return True

    def ui_ready(self):
        """The interface finished its first frame: logs how long the start took, from the process launch."""
        _phase("ui_ready")
        self._reveal()
        _phase("revealed")
        try:
            import psutil
            secs = time.time() - psutil.Process().create_time()
            print(f"[startup] interface ready in {secs:.2f} s ({'installed' if FROZEN else 'source'}, "
                  f"{'administrator' if is_admin() else 'normal'})", flush=True)
        except Exception:
            pass

    # ---------- settings ----------
    def settings_get(self):
        try:
            return _load_settings_strict()
        except OSError:
            return {}

    def settings_set(self, changes):
        if not isinstance(changes, dict):
            return False
        with self._lock:
            try:
                data = _load_settings_strict()
            except OSError:
                return False  # the file is there but can't be read right now: never overwrite it with less
            data.update(changes)
            _write_json(SETTINGS, data)
        if "language" in changes:
            self._language_changed(changes["language"])
        if any(k in changes for k in self.LOOK_KEYS):
            self._look_changed()
        if "measurePing" in changes and self._sampler:
            self._sampler.ping_on = changes["measurePing"] is not False
        return True

    def _language_changed(self, pref):
        """New interface language: the engine and tray follow, and the widget reloads in the new language
        (the main window reloads itself)."""
        from . import i18n
        i18n.set_language(pref)
        if self._tray is not None and hasattr(self._tray, "rebuild"):
            try:
                self._tray.rebuild()
            except Exception:
                pass
        reload = f"try{{localStorage.setItem('sh.lang', {json.dumps(pref or 'auto')})}}catch(e){{}};location.reload()"
        if self._widget is not None:
            self._js(reload, self._widget)
        if self._panel is not None:   # built once: it reloads (hidden) in the new language
            self._js(reload, self._panel)

    LOOK_KEYS = ("theme", "accent", "accent2", "intensity", "animSpeed")

    def _look_changed(self):
        """Theme, accent or animation changed: the widget and the tray panel re-read the settings and re-apply them."""
        for w in (self._widget, self._panel):
            if w is not None:
                self._js("window.SH && SH.lookChanged && SH.lookChanged()", w)

    # ---------- custom window frame ----------
    def win_drag(self):
        self._chrome and self._chrome.drag()

    def win_resize(self, edge):
        self._chrome and self._chrome.resize(edge)

    def win_toggle_max(self):
        return self._chrome.toggle_max() if self._chrome else False

    def win_min(self):
        self._chrome and self._chrome.minimize()

    def win_close(self):
        self.close_main()

    def win_state(self):
        return {"max": bool(self._chrome and self._chrome.max), "frameless": self._chrome is not None}

    # ---------- window ----------
    def set_zoom(self, factor):
        """Real WebView2 zoom (the same as Ctrl + wheel), not CSS scaling."""
        try:
            factor = max(0.75, min(2.0, float(factor)))
            form = self._window.native
            from System import Action  # pythonnet, ships with pywebview

            def apply():
                form.webview.ZoomFactor = factor

            form.Invoke(Action(apply))
            return True
        except Exception:
            return False

    def relaunch_admin(self):
        """Opens an elevated copy and closes this one. If the user says no in UAC, nothing changes."""
        if is_admin():
            return True
        # the elevated copy waits for this one to exit (it frees the single-instance lock and the WebView2 data)
        args = [a for a in sys.argv[1:] if a not in ("--tray",)]
        if "--wait-pid" in args:
            i = args.index("--wait-pid")
            del args[i:i + 2]
        args += ["--wait-pid", str(os.getpid())]
        params = " ".join(f'"{a}"' for a in args)
        if not getattr(sys, "frozen", False):
            params = f'"{os.path.join(base_dir(), "run.py")}" {params}'
        r = ctypes.windll.shell32.ShellExecuteW(None, "runas", _gui_python(), params, base_dir(), 1)
        if r > 32:
            self._handoff = True  # main() keeps the start screen up until the new copy shows its own
            try:
                from . import splash
                splash.show()
                splash.status(tr("Opening as administrator…"))
            except Exception:
                pass
            threading.Timer(0.05, lambda: self.quit(True)).start()
            return True
        print("[start] relaunch as administrator: Windows did not give permission", flush=True)
        return False

    # ---------- close, hide in the tray and quit ----------
    def _js(self, code, target=None, lossy=False):
        """Notifies the UI WITHOUT waiting, and in order (one sender thread per window)."""
        w = target or self._window
        if w is None:
            return
        with self._lock:
            sd = self._senders.get(w)
            if sd is None:
                sd = self._senders[w] = _Sender(w)
        sd.put(code, lossy)

    def _sender_drop(self, w):
        with self._lock:
            sd = self._senders.pop(w, None)
        if sd is not None:
            sd.stop()

    def close_main(self):
        """The X: with "close to the tray" on it only hides the window; otherwise it quits the app."""
        if self._tray is not None and self.settings_get().get("trayOnClose", True):
            self._window.hide()
            self._visible = False
            self._tele_refresh()
            if not self._told_tray:
                self._told_tray = True
                self._tray.notify(tr("StellarHub is still running in the tray. Open it from here, or right-click > Quit to exit."))
            return "hidden"
        self.quit()
        return "quit"

    def _confirm_quit(self):
        """The user asked to quit while engine jobs run (a driver or winget install, a backup, a restore point):
        say so and let them back out. True = go ahead (the jobs are cancelled and given a moment to stop)."""
        try:
            from .engine import jobs
            busy = jobs.running()
        except Exception:
            return True
        if not busy:
            return True
        name = str(busy[0].get("text") or busy[0].get("name") or "")[:60]
        more = len(busy) - 1
        msg = tr("{x} is still running. Quit anyway?", x=name + (f" (+{more})" if more > 0 else ""))
        try:
            if not paths.dialogs_allowed():
                raise RuntimeError("no dialogs")  # a test copy: answer yes  # a native box: it works the same from the window, the tray menu and the tray panel
            if ctypes.windll.user32.MessageBoxW(None, msg, "StellarHub", 0x04 | 0x20 | 0x00040000) != 6:  # Yes/No, ?, topmost
                return False
        except Exception:
            pass
        for j in busy:
            jobs.cancel(j.get("id"))
        end = time.monotonic() + 1.5
        while jobs.running() and time.monotonic() < end:
            time.sleep(0.1)
        return True

    def quit(self, force=False):
        """force: the update, the installer or the administrator relaunch asked for it: never ask."""
        if not force and not self._quitting and not self._confirm_quit():
            return False
        self._quitting = True
        if self._sampler:
            self._sampler.stop()
        try:
            from .engine import autopilot
            autopilot.stop()
        except Exception:
            pass
        self.widget_close()
        pw = self._panel  # the tray panel is a window of its own: if it stays, the app does not end
        if pw is not None:
            try:
                pw.destroy()
            except Exception:
                pass
        if self._tray is not None:
            self._tray.stop()
        delay = 0.05
        if self._visible:
            self._js("window.SH && SH.leave && SH.leave()")
            delay = 0.3
        threading.Timer(delay, lambda: self._window.destroy()).start()
        return True

    def _on_closing(self):
        """Alt+F4 or closing from the taskbar: same as the X. It runs on the window thread, so it decides
        and cancels right away; hiding or quitting happens afterwards, off this thread."""
        if self._quitting:
            return True
        if self._tray is not None and self.settings_get().get("trayOnClose", True):
            threading.Timer(0.01, self.close_main).start()
            return False
        threading.Timer(0.01, self.quit).start()
        return False

    def show_main(self):
        self._visible = True
        self._tele_refresh()
        try:
            self._window.show()
            self._window.restore()
            if self._chrome and not getattr(self._chrome, "_done", False):
                self._chrome.setup(start_max=True)
                _grant_media(self._window)
            elif self._chrome and self._chrome.max:
                self._chrome._ui(self._chrome._maximize)
            from System import Action
            form = self._window.native
            form.BeginInvoke(Action(lambda: (form.Activate(), form.BringToFront())))
        except Exception:
            pass
        return True

    def set_autostart(self, on):
        """Open with Windows (minimized to the tray): an entry in HKCU\\...\\Run."""
        if PORTABLE and on:
            return False  # a USB drive is not always there: the portable version doesn't add itself to startup
        import winreg
        key = r"Software\Microsoft\Windows\CurrentVersion\Run"
        try:
            with winreg.OpenKey(winreg.HKEY_CURRENT_USER, key, 0, winreg.KEY_SET_VALUE) as k:
                if on:
                    winreg.SetValueEx(k, "StellarHub", 0, winreg.REG_SZ, _autostart_cmd())
                else:
                    try:
                        winreg.DeleteValue(k, "StellarHub")
                    except FileNotFoundError:
                        pass
            return True
        except OSError:
            return False

    # ---------- always-on-top widget ----------
    def widget_toggle(self, width=400, height=190):
        """Opens or closes the widget. Returns True if it ends up open."""
        import webview
        if self._widget is not None:
            self.widget_close()
            return False
        w, h = max(160, min(1100, int(width or 400))), max(32, min(600, int(height or 190)))
        x = y = None
        saved = self._widget_saved_pos(w)
        if saved:
            x, y = saved
        else:
            try:
                import ctypes.wintypes as wt
                wa = wt.RECT()
                ctypes.windll.user32.SystemParametersInfoW(0x0030, 0, ctypes.byref(wa), 0)  # SPI_GETWORKAREA (primary)
                dpi = _sys_scale()
                x, y = int(wa.right / dpi) - w - 28, int(wa.top / dpi) + 72
            except Exception:
                try:
                    scr = webview.screens[0]
                    x, y = scr.width - w - 28, 72
                except Exception:
                    pass
        self._widget = webview.create_window(
            tr("StellarHub widget"), url=os.path.join(UI_DIR, "widget.html"), js_api=self,
            width=w, height=h, x=x, y=y, frameless=True, easy_drag=True, on_top=True, min_size=(120, 30),
            resizable=False, background_color=BG, focus=False,
        )
        wref = self._widget
        self._widget.events.closed += lambda: self._widget_gone(wref)
        self._widget.events.shown += lambda: (_round_corners(wref), self._widget_keep_on_top(wref), self._widget_track(wref))
        self.settings_set({"widgetWasOpen": True})
        self._tele_refresh()
        self._tray and self._tray.refresh()
        self._js("SH.emit('widget', {on: true})")
        return True

    def _widget_keep_on_top(self, w):
        """The taskbar is also "always on top" and, when touched, it jumps in front of everything.
        - Tool window: shows on every virtual desktop and does not appear in Alt+Tab.
        - A thread puts it back on top every so often (without activating or moving it) while the widget exists."""
        try:
            hwnd = w.native.Handle.ToInt32()
        except Exception:
            return
        u = ctypes.windll.user32
        GWL_EXSTYLE, WS_EX_TOOLWINDOW, WS_EX_APPWINDOW = -20, 0x00000080, 0x00040000
        try:
            u.GetWindowLongPtrW.restype = ctypes.c_ssize_t
            u.SetWindowLongPtrW.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.c_ssize_t]
            ex = u.GetWindowLongPtrW(ctypes.c_void_p(hwnd), GWL_EXSTYLE)
            u.SetWindowLongPtrW(ctypes.c_void_p(hwnd), GWL_EXSTYLE, (ex | WS_EX_TOOLWINDOW) & ~WS_EX_APPWINDOW)
        except Exception as e:
            print("widget style:", e)
        HWND_TOPMOST = ctypes.c_void_p(-1)
        FLAGS = 0x0001 | 0x0002 | 0x0010 | 0x0200  # NOSIZE | NOMOVE | NOACTIVATE | NOOWNERZORDER

        def keep():
            while self._widget is w and not self._quitting:
                try:
                    u.SetWindowPos(ctypes.c_void_p(hwnd), HWND_TOPMOST, 0, 0, 0, 0, FLAGS)
                except Exception:
                    break
                time.sleep(0.35)
        threading.Thread(target=keep, daemon=True, name="widget-top").start()

    def _widget_saved_pos(self, w):
        """Where the widget was left: (x, y) in logical px for create_window, or None when there is nothing saved or
        that spot is no longer on any screen (monitor unplugged). The right edge is what is kept: the widget
        resizes with its top-right corner fixed."""
        pos = self.settings_get().get("widgetPos")
        try:
            right, top = float(pos["r"]), float(pos["y"])
        except Exception:
            return None
        k = _sys_scale()
        x, y = int(right - w), int(top)
        if not _on_screen(int((x + w / 2) * k), int((y + 12) * k)) or not _on_screen(int((x + w - 24) * k), int((y + 12) * k)):
            return None
        return x, y

    def _widget_track(self, w):
        """Saves the position (debounced) every time the widget is moved or resized; also the size is in
        widgetSize_<mode>, saved by widget_drag_resize."""
        try:
            from System import Action, EventHandler
            form = w.native

            def changed(sender, args):
                t = self._widget_pos_timer
                if t is not None:
                    t.cancel()
                t = self._widget_pos_timer = threading.Timer(0.6, lambda: self._widget_save_pos(w))
                t.daemon = True
                t.start()
            form.BeginInvoke(Action(lambda: (form.add_LocationChanged(EventHandler(changed)), form.add_SizeChanged(EventHandler(changed)))))
        except Exception as e:
            print("widget track:", e)

    def _widget_save_pos(self, w):
        if self._widget is not w:
            return
        try:
            form = w.native
            loc, size = form.Location, form.Size
            if loc.X <= -30000:
                return
            k = _sys_scale()
            self.settings_set({"widgetPos": {"r": round((loc.X + size.Width) / k, 1), "y": round(loc.Y / k, 1)}})
        except Exception as e:
            print("widget pos:", e)

    def _widget_gone(self, w=None):
        if w is not None and self._widget is not w:
            return  # it was an earlier widget that has already been replaced
        self._widget = None
        if w is not None:
            self._sender_drop(w)
        self._tray and self._tray.refresh()
        self._js("SH.emit('widget', {on: false})")

    def widget_close(self):
        """It closes a moment after replying: if the call comes from the widget itself, destroying it
        while pywebview is still returning the result to it can leave it hanging."""
        w = self._widget
        if w is not None:
            self._widget_save_pos(w)
        self._widget = None
        if w is not None:
            def kill():
                self._sender_drop(w)
                try:
                    w.destroy()
                except Exception:
                    pass
            threading.Timer(0.08, kill).start()
        self.settings_set({"widgetWasOpen": False}) if not self._quitting else None
        self._tele_refresh()
        self._tray and self._tray.refresh()
        self._js("SH.emit('widget', {on: false})")
        return True

    def widget_mode(self, mode):
        """The widget's own small/large button: saves it and tells the main window."""
        mode = "mini" if mode == "mini" else "full"
        self.settings_set({"widgetMode": mode})
        self._js(f"SH.state.settings.widgetMode='{mode}'; SH.emit('widget-mode','{mode}')")
        return mode

    def widget_is_open(self):
        return self._widget is not None

    def widget_update(self, conf):
        """Widget settings changed in the main window: applied instantly."""
        if self._widget is not None:
            self._js(f"window.SH && SH.widgetApply && SH.widgetApply({json.dumps(conf)})", self._widget)
        return True

    def widget_resize(self, width, height):
        """Resizes it keeping the top-right corner fixed (the widget usually lives on the right)."""
        if self._widget is not None:
            try:
                from webview.window import FixPoint
                self._widget.resize(int(width), int(height), fix_point=FixPoint.NORTH | FixPoint.EAST)
            except Exception as e:
                print("widget_resize:", e)
        return True

    def widget_limits(self, min_w, min_h, max_w, max_h):
        """Smallest and largest size the user can drag the widget to (device pixels), computed by the widget
        from what it shows. Windows enforces them during the resize loop."""
        w = self._widget
        if w is None:
            return False
        try:
            from System import Action
            from System.Drawing import Size
            form = w.native

            def apply():
                form.MinimumSize = Size(int(min_w), int(min_h))
                form.MaximumSize = Size(int(max_w), int(max_h))
            form.BeginInvoke(Action(apply))
            return True
        except Exception as e:
            print("widget_limits:", e)
            return False

    def widget_drag_resize(self, edge):
        """The user drags an edge of the widget: Windows' own resize loop (smooth, like any window).
        When it ends, the new size is saved for that widget size mode so it is kept next time."""
        w = self._widget
        hit = {"w": 10, "e": 11, "n": 12, "nw": 13, "ne": 14, "s": 15, "sw": 16, "se": 17}.get(edge)
        if w is None or not hit:
            return False
        try:
            from System import Action
            form = w.native
            u = ctypes.windll.user32

            def go():
                if not (u.GetAsyncKeyState(0x01) & 0x8000):
                    return  # the button was already released: do not start a loop stuck to the cursor
                u.ReleaseCapture()
                u.SendMessageW(form.Handle.ToInt32(), 0x00A1, hit, 0)  # WM_NCLBUTTONDOWN: blocks until released
                mode = self.settings_get().get("widgetMode") or "full"
                self.settings_set({f"widgetSize_{mode}": [w.width, w.height]})
                self._js("window.SH && SH.widgetResized && SH.widgetResized()", w)
            form.BeginInvoke(Action(go))
            return True
        except Exception as e:
            print("widget_drag_resize:", e)
            return False

    # ---------- tray panel (left click on the tray icon) ----------
    PANEL_W, PANEL_H = 344, 452  # CSS pixels

    def tray_panel_toggle(self):
        """Shows the panel above the tray icon, or hides it if it is showing."""
        if self._panel_shown:
            return self.panel_hide()
        if time.time() - self._panel_hidden_at < 0.35:
            return False  # the click that just took the focus away from it: leave it closed
        if self._panel is None:
            self._panel_create()
            return True
        if self._panel_ready:
            self._panel_place_and_show()
        return True

    def _panel_create(self):
        import webview
        self._panel = webview.create_window(
            "StellarHub", url=os.path.join(UI_DIR, "tray.html"), js_api=self, width=self.PANEL_W, height=self.PANEL_H,
            frameless=True, easy_drag=False, on_top=True, resizable=False, hidden=True, focus=True, background_color=BG)
        pw = self._panel

        def loaded():
            if self._panel_ready:
                return
            self._panel_ready = True
            self._panel_setup(pw)
            self._panel_place_and_show()
        pw.events.loaded += loaded
        pw.events.closed += lambda: (setattr(self, "_panel", None), setattr(self, "_panel_ready", False), self._sender_drop(pw))

    def _panel_setup(self, pw):
        """Tool window (no taskbar button, no Alt+Tab), rounded corners, and hide as soon as it loses focus."""
        try:
            from System import Action, EventHandler
            form = pw.native
            hwnd = form.Handle.ToInt32()
            u = ctypes.windll.user32
            u.GetWindowLongPtrW.restype = ctypes.c_ssize_t
            u.SetWindowLongPtrW.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.c_ssize_t]
            ex = u.GetWindowLongPtrW(ctypes.c_void_p(hwnd), -20)
            u.SetWindowLongPtrW(ctypes.c_void_p(hwnd), -20, (ex | 0x00000080) & ~0x00040000)
            _round_corners(pw)

            def on_deactivate(sender, args):
                if self._panel_shown:
                    self._panel_shown = False
                    self._panel_hidden_at = time.time()
                    form.Hide()
                    self._tele_refresh()
            form.BeginInvoke(Action(lambda: form.add_Deactivate(EventHandler(on_deactivate))))
        except Exception as e:
            print("tray panel setup:", e)

    def _panel_place_and_show(self):
        """Above the tray (or next to it when the taskbar is on a side), inside the work area of the monitor
        under the cursor, in device pixels at the process (system) scaling."""
        pw = self._panel
        if pw is None:
            return
        try:
            from System import Action
            import ctypes.wintypes as wt
            u = ctypes.windll.user32
            pt = wt.POINT()
            u.GetCursorPos(ctypes.byref(pt))
            mon = u.MonitorFromPoint(pt, 2)

            class MONITORINFO(ctypes.Structure):
                _fields_ = [("cbSize", wt.DWORD), ("rcMonitor", wt.RECT), ("rcWork", wt.RECT), ("dwFlags", wt.DWORD)]
            mi = MONITORINFO()
            mi.cbSize = ctypes.sizeof(mi)
            u.GetMonitorInfoW(mon, ctypes.byref(mi))
            x, y, w, h = _panel_geometry((pt.x, pt.y), _rect(mi.rcWork), _rect(mi.rcMonitor), _sys_scale(),
                                         self.PANEL_W, self.PANEL_H)
            form = pw.native
            tray_hwnd = getattr(getattr(self._tray, "icon", None), "_hwnd", None)

            def show():
                hwnd = form.Handle.ToInt32()
                if tray_hwnd:  # the tray click lets this process take the foreground: hand it to the panel
                    u.SetForegroundWindow(ctypes.c_void_p(tray_hwnd))
                u.SetWindowPos(ctypes.c_void_p(hwnd), ctypes.c_void_p(-1), x, y, w, h, 0x0040)  # TOPMOST, SHOWWINDOW
                form.Show()
                form.Activate()
                u.SetForegroundWindow(ctypes.c_void_p(hwnd))
            self._panel_shown = True
            form.BeginInvoke(Action(show))
            self._tele_refresh()
            self._js("window.SH && SH.panelShown && SH.panelShown()", pw)
        except Exception as e:
            print("tray panel:", e)

    def panel_hide(self):
        pw = self._panel
        if pw is None or not self._panel_shown:
            return False
        self._panel_shown = False
        self._panel_hidden_at = time.time()
        self._tele_refresh()
        try:
            from System import Action
            form = pw.native
            form.BeginInvoke(Action(form.Hide))
        except Exception:
            pass
        return True

    def panel_go(self, mod=None, tab=None):
        """From the panel: open the main window (on a module, a tab or the settings)."""
        self.panel_hide()
        self.show_main()
        if mod == "settings":
            self._js("SH.go('settings')")
        elif mod:
            t = f", {{tab: {json.dumps(tab)}}}" if tab else ""
            self._js(f"SH.go({json.dumps(mod)}{t})")
        return True

    def log_js_error(self, msg):
        """UI errors go to the log (stellarhub.log), to help diagnose problems."""
        print("[ui]", str(msg)[:2000], flush=True)
        return True

    # ---------- real engine ----------
    def engine(self, mod, fn, args=None):
        """SH.engine(mod, fn, ...args): quick call into stellarhub/engine/<mod>.py (only what is in EXPORTS)."""
        from . import engine as E
        try:
            return {"ok": True, "data": E.resolve(mod, fn, "call")(*(args or []))}
        except Exception as e:
            import traceback
            print(f"[engine {mod}.{fn}]", traceback.format_exc())
            return {"ok": False, "error": str(e)}

    def engine_job(self, mod, fn, args=None):
        """SH.job(...): long task; progress arrives as SH.emit('job', ...). Returns the task id."""
        from . import engine as E
        from .engine import jobs
        try:
            return {"ok": True, "id": jobs.start(f"{mod}.{fn}", E.resolve(mod, fn, "job"), *(args or []))}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    def jobs_running(self):
        """Tasks still running in Python: after the page reloads (language change) the UI asks for them."""
        from .engine import jobs
        return jobs.running()

    def job_cancel(self, job_id):
        from .engine import jobs
        return jobs.cancel(job_id)

    def pc_info(self):
        from .engine import system
        return system.pc_info()

    def screen_thumb(self, index=0, width=480):
        from .engine import system
        try:
            return system.screen_thumb(index, width)
        except Exception:
            return None

    def tele_rate(self, ms, lite=False):
        """The UI sends the refresh period it wants (already slower on battery) and whether it is in its
        lighter mode, so the sampler also skips the slow extras (latency every 6 s, Wi-Fi every minute)."""
        if self._sampler:
            self._sampler.lite = bool(lite)
            self._sampler.set_rate(float(ms) / 1000)
        return True

    def _tele_push(self, data):
        """Each telemetry sample goes to the main window (if visible) and to the widget (if open).
        Called from the sampler thread, never from the window thread."""
        payload = json.dumps(data)
        if self._visible and not self._minimized:
            try:
                self._window.evaluate_js(f"window.SH && SH.tele.push && SH.tele.push({payload})")
            except Exception:
                pass
        w = self._widget
        if w is not None:
            try:
                w.evaluate_js(f"window.SH && SH.tele.push && SH.tele.push({payload})")
            except Exception:
                pass
        pw = self._panel
        if pw is not None and self._panel_shown:
            try:
                pw.evaluate_js(f"window.SH && SH.tele.push && SH.tele.push({payload})")
            except Exception:
                pass

    def _wv_visible(self, window, on):
        """Tells WebView2 whether the window can be seen. A WebView2 whose window is hidden in the tray keeps
        painting and running requestAnimationFrame at full speed (measured: 11% GPU and over 100% CPU for a window
        nobody sees) unless its controller gets IsVisible = False. The WinForms control keeps that controller in a
        private field, and does not update it when the form is hidden."""
        if window is None:
            return
        try:
            from System import Action
            from System.Reflection import BindingFlags
            form = window.native

            def apply():
                try:
                    wv = form.webview
                    f = wv.GetType().GetField("_coreWebView2Controller", BindingFlags.NonPublic | BindingFlags.Instance)
                    c = f.GetValue(wv) if f is not None else None
                    if c is not None and c.IsVisible != on:
                        c.IsVisible = on
                except Exception as e:
                    print("webview visibility:", e)
            form.BeginInvoke(Action(apply))
        except Exception:
            pass

    def _win_state(self, *_):
        """Minimized, restored or maximized (window thread): a minimized window is not 'visible' for the UI work."""
        try:
            from System.Windows.Forms import FormWindowState
            self._minimized = self._window.native.WindowState == FormWindowState.Minimized
        except Exception:
            return
        self._tele_refresh()

    def _tele_refresh(self):
        shown = self._visible and not self._minimized
        self._wv_visible(self._window, shown)
        self._wv_visible(self._panel, self._panel_shown)
        self._wv_visible(self._widget, True)   # (re)assert: a widget WebView2 only ever renders while it exists
        if self._sampler:
            stats = self.settings_get().get("widgetStats") or []
            gpu_in_widget = any(s.startswith("gpu") or s == "vram" for s in stats)
            self._sampler.set_active(shown or self._widget is not None or self._panel_shown,
                                     gpu=shown or self._panel_shown or (self._widget is not None and gpu_in_widget))

    # ---------- permanent administrator mode ----------
    def set_always_admin(self, on):
        """With this on, StellarHub always opens as administrator. A scheduled task with highest privileges is
        used so Windows does not ask at every start (creating it does require admin)."""
        self.settings_set({"alwaysAdmin": bool(on)})
        if on and is_admin():
            return _ensure_admin_task()
        if not on:
            _delete_admin_task()
        return True

    # ---------- about ----------
    def project_stats(self):
        """Bytes of code per language, like GitHub's language bar."""
        if FROZEN:  # the installed app has no .py files: the build saved the numbers
            try:
                with open(os.path.join(base_dir(), "stellarhub", "project_stats.json"), encoding="utf-8") as fh:
                    return json.load(fh)
            except (OSError, ValueError):
                pass
        langs = {".py": "Python", ".js": "JavaScript", ".css": "CSS", ".html": "HTML"}
        out = {}
        root = os.path.join(base_dir(), "stellarhub")
        for dirpath, dirs, files in os.walk(root):
            dirs[:] = [d for d in dirs if d not in ("vendor", "fonts", "__pycache__")]
            for f in files:
                lang = langs.get(os.path.splitext(f)[1].lower())
                if lang:
                    try:
                        out[lang] = out.get(lang, 0) + os.path.getsize(os.path.join(dirpath, f))
                    except OSError:
                        pass
        return out

    # ---------- Windows tools and data ----------
    TOOLS = {
        "devmgmt": "devmgmt.msc", "services": "services.msc", "eventvwr": "eventvwr.msc", "taskschd": "taskschd.msc",
        "diskmgmt": "diskmgmt.msc", "regedit": "regedit.exe", "msconfig": "msconfig.exe", "msinfo32": "msinfo32.exe",
        "resmon": "resmon.exe", "control": "control.exe", "powercfg": "powercfg.cpl", "sysdm": "sysdm.cpl",
        "ncpa": "ncpa.cpl", "appwiz": "appwiz.cpl", "perf": "SystemPropertiesPerformance.exe", "cleanmgr": "cleanmgr.exe",
        "dfrgui": "dfrgui.exe", "rstrui": "rstrui.exe", "taskmgr": "taskmgr.exe", "cmd": "cmd.exe", "powershell": "powershell.exe",
    }

    def run_tool(self, name):
        exe = self.TOOLS.get(name)
        if not exe:
            return False
        try:
            os.startfile(exe)
            return True
        except OSError:
            return False

    def open_data_dir(self):
        os.makedirs(DATA_DIR, exist_ok=True)
        os.startfile(DATA_DIR)
        return True

    def export_settings(self):
        import webview
        r = self._window.create_file_dialog(webview.SAVE_DIALOG, save_filename="StellarHub-settings.json",
                                            file_types=(tr("StellarHub settings") + " (*.json)",))
        if not r:
            return None
        path = r if isinstance(r, str) else r[0]
        with open(path, "w", encoding="utf-8") as fh:
            json.dump(self.settings_get(), fh, ensure_ascii=False, indent=2)
        return path

    def import_settings(self):
        import webview
        r = self._window.create_file_dialog(webview.OPEN_DIALOG, file_types=(tr("StellarHub settings") + " (*.json)",))
        if not r:
            return None
        try:
            with open(r[0], encoding="utf-8") as fh:
                data = json.load(fh)
        except (OSError, ValueError):
            return False
        if not isinstance(data, dict):
            return False
        self.settings_set(data)
        return data

    # what "Reset settings" keeps: the user's own data (routines and their log, history, kits, ignored updates,
    # exclusions, test results), not preferences
    KEEP_ON_RESET = ("autopilotRoutines", "autopilotLog", "autopilotSchema", "autopilotNotify", "activity", "pending",
                     "hangarKits", "updIgnored", "updSchedule", "cleanExclusions", "testerKbMissing", "cpsBest", "uiPort",
                     "language")

    def reset_settings(self):
        """Puts the preferences back to their defaults and returns the old settings (so it can be undone). The user's
        data in the settings file is kept, and what lives outside it follows: no Windows startup entry and no
        always-as-administrator task once their switches are off."""
        old = self.settings_get()
        keep = {k: old[k] for k in self.KEEP_ON_RESET if k in old}
        with self._lock:
            try:
                _write_json(SETTINGS, keep)
            except OSError:
                return old
        if old.get("startWithWindows"):
            self.set_autostart(False)
        if old.get("alwaysAdmin"):
            try:
                _delete_admin_task()
            except Exception:
                pass
        return old

    def open_url(self, url):
        if isinstance(url, str) and url.startswith(("https://", "http://", "ms-settings:")):
            os.startfile(url)
            return True
        return False


def refresh_ui_cache():
    """WebView2 keeps the .js/.css in its HTTP cache: after a UI change it would keep showing the old one.
    If any UI file changes, that cache is cleared."""
    h = hashlib.sha1()
    if FROZEN:  # installed: the UI only changes with a new build, so the version and build time identify it
        try:
            h.update(f"{VERSION}|{os.path.getmtime(sys.executable)}".encode())
        except OSError:
            h.update(VERSION.encode())
    for root, _dirs, files in ([] if FROZEN else sorted(os.walk(UI_DIR))):
        for f in sorted(files):
            if f.endswith((".html", ".js", ".css")):
                p = os.path.join(root, f)
                h.update(p[len(UI_DIR):].encode())
                try:
                    with open(p, "rb") as fh:
                        h.update(fh.read())
                except OSError:
                    pass
    stamp = os.path.join(WEB_DIR, "ui.version")
    try:
        with open(stamp, encoding="utf-8") as fh:
            if fh.read().strip() == h.hexdigest():
                return
    except OSError:
        pass
    for sub in (("EBWebView", "Default", "Cache"), ("EBWebView", "Default", "Code Cache")):
        shutil.rmtree(os.path.join(WEB_DIR, *sub), ignore_errors=True)
    try:
        os.makedirs(WEB_DIR, exist_ok=True)
        with open(stamp, "w", encoding="utf-8") as fh:
            fh.write(h.hexdigest())
    except OSError:
        pass


def _sys_scale():
    """The scale this process renders at. pywebview makes it system-DPI aware: every window, on any monitor, is laid
    out at the primary monitor's scale (Windows stretches it on the others), so that is the one to size with."""
    try:
        return ctypes.windll.user32.GetDpiForSystem() / 96
    except Exception:
        return 1.0


def _rect(r):
    return (r.left, r.top, r.right, r.bottom)


def _panel_geometry(pt, work, mon, k, pw, ph):
    """Where the tray panel goes, in device pixels: (x, y, w, h). pt = the click, work/mon = (l, t, r, b) of the work
    area and of the monitor under it. This process is system-DPI aware: the page renders at the system scale k on
    every monitor and the coordinates Windows gives (cursor, monitors) are in that same space, so the panel is sized
    with k, not with the monitor's own scale. The taskbar is the edge where the work area is smaller than the monitor
    (any edge, any monitor); with an auto-hidden taskbar the edge closest to the click is used."""
    w, h, m = int(pw * k), int(ph * k), int(10 * k)
    wl, wt_, wr, wb = work
    ml, mt, mr, mb = mon
    gaps = {"bottom": mb - wb, "top": wt_ - mt, "right": mr - wr, "left": wl - ml}
    edge = max(gaps, key=gaps.get)
    if gaps[edge] <= 0:
        near = {"bottom": mb - pt[1], "top": pt[1] - mt, "right": mr - pt[0], "left": pt[0] - ml}
        edge = min(near, key=near.get)
    if edge == "bottom":
        x, y = pt[0] - w // 2, wb - h - m
    elif edge == "top":
        x, y = pt[0] - w // 2, wt_ + m
    elif edge == "right":
        x, y = wr - w - m, pt[1] - h // 2
    else:
        x, y = wl + m, pt[1] - h // 2
    x = max(wl + m, min(x, wr - w - m))
    y = max(wt_ + m, min(y, wb - h - m))
    return x, y, w, h


def _on_screen(x, y):
    """Is this point (device pixels) on a connected monitor?"""
    try:
        import ctypes.wintypes as wt
        return bool(ctypes.windll.user32.MonitorFromPoint(wt.POINT(int(x), int(y)), 0))
    except Exception:
        return True


def _round_corners(window):
    """Windows 11 rounded corners for frameless windows, with a subtle edge drawn by Windows
    (the widget UI draws no border of its own, so there is no double frame at the corners)."""
    try:
        hwnd = window.native.Handle.ToInt32()
        dwm = ctypes.windll.dwmapi
        pref = ctypes.c_int(2)  # DWMWCP_ROUND
        dwm.DwmSetWindowAttribute(hwnd, 33, ctypes.byref(pref), 4)
        border = ctypes.c_int(0x00473A2C)  # #2C3A47 in BGR
        dwm.DwmSetWindowAttribute(hwnd, 34, ctypes.byref(border), 4)
    except Exception:
        pass


def _grant_media(window):
    """Camera and microphone for StellarHub's own UI (Device Tester) without the browser prompt.
    The only thing that can block them is Windows privacy, and the app links to those settings."""
    state = {"done": False}

    def hook():
        """Runs on the window thread (WebView2 can only be touched from there). Returns True if it got hooked."""
        if state["done"]:
            return True
        form = window.native
        core = form.webview.CoreWebView2
        if core is None:
            return False
        from Microsoft.Web.WebView2.Core import CoreWebView2PermissionKind as K, CoreWebView2PermissionState as St

        def on_perm(sender, args):
            local = str(args.Uri).startswith(("http://127.0.0.1", "http://localhost"))
            if local and args.PermissionKind in (K.Camera, K.Microphone, K.ClipboardRead, K.Notifications):
                args.State = St.Allow
        core.PermissionRequested += on_perm
        state["done"] = True
        return True

    def wait_and_hook():
        import time
        from System import Func, Boolean
        form = window.native
        for _ in range(100):
            try:
                if form.Invoke(Func[Boolean](hook)):
                    return
            except Exception as e:
                print("permissions:", e)
                return
            time.sleep(0.15)
    threading.Thread(target=wait_and_hook, daemon=True).start()


def style_titlebar(window):
    """Dark title bar in the same color as the background (Windows 11)."""
    try:
        hwnd = window.native.Handle.ToInt32()
        dwm = ctypes.windll.dwmapi
        on = ctypes.c_int(1)
        dwm.DwmSetWindowAttribute(hwnd, 20, ctypes.byref(on), 4)  # dark mode
        r, g, b = int(BG[1:3], 16), int(BG[3:5], 16), int(BG[5:7], 16)
        color = ctypes.c_int(r | (g << 8) | (b << 16))
        dwm.DwmSetWindowAttribute(hwnd, 35, ctypes.byref(color), 4)  # title background
        text = ctypes.c_int(0x00F6EDE8)
        dwm.DwmSetWindowAttribute(hwnd, 36, ctypes.byref(text), 4)  # title text
    except Exception:
        pass


class _LogOnce:
    """Wraps the log file: the same line repeated back to back (a failing sampler, a UI error every second) is
    written once and then counted, so the log stays readable and small."""

    def __init__(self, fh):
        self.fh, self.last, self.n, self.buf = fh, None, 0, ""

    def write(self, text):
        self.buf += text
        while "\n" in self.buf:
            line, self.buf = self.buf.split("\n", 1)
            key = line.strip()
            if key and key == self.last:
                self.n += 1
                continue
            self._flush_repeats()
            self.last = key or None
            self.fh.write(line + "\n")
        return len(text)

    def _flush_repeats(self):
        if self.n:
            self.fh.write(f"  (the same line {self.n} more time{'s' if self.n > 1 else ''})\n")
            self.n = 0

    def flush(self):
        try:
            self._flush_repeats()
            self.fh.flush()
        except (OSError, ValueError):
            pass

    def isatty(self):
        return False


def _rotate_log(path, limit=2 * 1024 * 1024):
    """Above 2 MB the log becomes stellarhub.log.1 (one older copy is kept) and a new one starts."""
    try:
        if os.path.getsize(path) > limit:
            os.replace(path, path + ".1")
    except OSError:
        pass


def _log_to_file():
    """With pythonw there is no console: errors go to the stellarhub.log in the data folder."""
    if sys.stderr is None or "pythonw" in os.path.basename(sys.executable).lower():
        try:
            os.makedirs(DATA_DIR, exist_ok=True)
            path = os.path.join(DATA_DIR, "stellarhub.log")
            _rotate_log(path)
            sys.stdout = sys.stderr = _LogOnce(open(path, "a", encoding="utf-8", buffering=1))
        except OSError:
            pass


ADMIN_TASK = r"StellarHub\Open as administrator"
_START_HIDDEN = os.path.join(paths.local_dir(), "start-hidden")  # see _elevate_on_start
LEGACY_ADMIN_TASKS = (r"StellarHub\Abrir como administrador",)  # name used by earlier versions


def _launch_cmd(extra=""):
    if getattr(sys, "frozen", False):
        return sys.executable, extra.strip()
    return _gui_python(), f'"{os.path.join(base_dir(), "run.py")}" {extra}'.strip()


def _ensure_admin_task():
    """Creates (or updates) the scheduled task that opens StellarHub elevated without the UAC prompt."""
    if PORTABLE:
        return False  # the portable version asks Windows each time instead of leaving a task on the PC
    import subprocess
    from . import schtask
    exe, args = _launch_cmd("--from-task")
    ok = schtask.create(ADMIN_TASK, exe, args, "Opens StellarHub as administrator without the Windows prompt "
                                               "(Settings > Administrator > Always open as administrator).")
    if ok:  # replace tasks left by earlier versions under another name
        for old in LEGACY_ADMIN_TASKS:
            subprocess.run(["schtasks", "/delete", "/tn", old, "/f"], capture_output=True, creationflags=0x08000000)
    return ok


def _repair_update_task():
    """The updater's task, if an older installer made it the old way (it didn't run on battery): made again."""
    if PORTABLE or not FROZEN:
        return
    try:
        from . import schtask
        from .engine import selfupdate
        if selfupdate._task_exists() and schtask.outdated(schtask.query_xml(selfupdate.TASK)):
            selfupdate.ensure_task()
    except Exception as e:
        print("update task:", e)


def _delete_admin_task():
    import subprocess
    for name in (ADMIN_TASK, *LEGACY_ADMIN_TASKS):
        subprocess.run(["schtasks", "/delete", "/tn", name, "/f"], capture_output=True, creationflags=0x08000000)


def _wants_elevation():
    """Permanent administrator mode is on and this copy is not elevated (nor a test copy, nor already the elevated one)."""
    if is_admin() or ISOLATED or "--no-elevate" in sys.argv or "--from-task" in sys.argv:
        return False
    try:
        with open(SETTINGS, encoding="utf-8") as fh:
            return bool(json.load(fh).get("alwaysAdmin"))
    except (OSError, ValueError):
        return False


def _elevate_on_start():
    """If the user chose permanent administrator mode and this copy is not elevated: relaunch elevated
    (first through the scheduled task, with no prompt; if it does not exist, with the UAC prompt). Returns True if we must exit.
    The start screen is already up ("Opening as administrator…") and stays until the elevated copy takes over."""
    if not _wants_elevation():
        return False
    hidden = "--tray" in sys.argv
    import subprocess
    _phase("elevating")
    if hidden:  # the task can't take arguments: the elevated copy reads this note and stays in the tray
        try:
            os.makedirs(os.path.dirname(_START_HIDDEN), exist_ok=True)
            open(_START_HIDDEN, "w").close()
        except OSError:
            pass
    if not PORTABLE and _task_opens_this_copy(ADMIN_TASK) and subprocess.run(
            ["schtasks", "/run", "/tn", ADMIN_TASK], capture_output=True, creationflags=0x08000000, timeout=15).returncode == 0:
        if _elevated_copy_started():
            _phase("elevated copy started (task)")
            return True
        # Windows kept the task waiting (a task made by an older version doesn't start on battery) or it failed:
        # drop it and ask Windows the usual way; the elevated copy then makes the task again, the right way
        from . import schtask
        schtask.end(ADMIN_TASK)
    # no task, or it opens another copy (e.g. the source version before installing): ask Windows once;
    # the elevated copy then points the task at itself
    exe, args = _launch_cmd("--no-elevate" + (" --tray" if hidden else ""))
    if ctypes.windll.shell32.ShellExecuteW(None, "runas", exe, args, base_dir(), 1) > 32:
        _elevated_copy_started(10)  # keep the start screen up until the elevated copy has its own
        _phase("elevated copy started (UAC)")
        return True
    print("[start] administrator mode was declined: opening in normal mode", flush=True)
    return False  # the user said no: stay in normal mode


def _elevated_copy_started(seconds=8):
    """After running the administrator task: True once the elevated copy holds the single-instance mutex (it takes
    it within a second or two of starting). From a normal copy an elevated mutex can't be opened: access denied
    also means it exists."""
    k32 = ctypes.windll.kernel32
    k32.OpenMutexW.restype = ctypes.c_void_p
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        h = k32.OpenMutexW(0x00100000, False, _mutex_name())  # SYNCHRONIZE
        err = k32.GetLastError()
        if h:
            k32.CloseHandle(ctypes.c_void_p(h))
            return True
        if err == 5:  # ERROR_ACCESS_DENIED: it exists, owned by the elevated copy
            return True
        time.sleep(0.15)
    return False


def _task_opens_this_copy(name):
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
    exe, _args = _launch_cmd()
    cmd = re.search(r"<Command>(.*?)</Command>", xml, re.S)
    arg = re.search(r"<Arguments>(.*?)</Arguments>", xml, re.S)

    def norm(t):
        return os.path.normcase(t.replace("&quot;", '"').strip().strip('"'))
    if not cmd or norm(cmd.group(1)) != norm(exe):
        return False
    return FROZEN or (arg is not None and norm(os.path.join(base_dir(), "run.py")) in norm(arg.group(1)))


def _autostart_cmd():
    exe, args = _launch_cmd("--tray")
    return f'"{exe}" {args}'


def _sync_launch_entries():
    """After installing (or moving) StellarHub, the "open with Windows" entry must open this copy."""
    if PORTABLE or not _read_settings().get("startWithWindows"):
        return
    import winreg
    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, r"Software\Microsoft\Windows\CurrentVersion\Run", 0,
                            winreg.KEY_READ | winreg.KEY_SET_VALUE) as k:
            try:
                cur = winreg.QueryValueEx(k, "StellarHub")[0]
            except FileNotFoundError:
                cur = None
            if cur != _autostart_cmd():
                winreg.SetValueEx(k, "StellarHub", 0, winreg.REG_SZ, _autostart_cmd())
    except OSError:
        pass


def _quit_running():
    """--quit: asks the running copy to close (installer and uninstaller) and waits until it is gone."""
    import socket
    try:
        with socket.create_connection(("127.0.0.1", SINGLE_PORT), timeout=1.5) as s:
            s.sendall(b"quit")
            s.settimeout(3)
            if s.recv(8) != b"bye":
                return _wait_other_copies_gone()
    except OSError:
        return _wait_other_copies_gone()  # not answering (or not running): make sure it is gone anyway
    for _ in range(80):  # up to 8 s
        time.sleep(0.1)
        try:
            socket.create_connection(("127.0.0.1", SINGLE_PORT), timeout=0.2).close()
        except OSError:
            break
    _wait_other_copies_gone()


def _wait_other_copies_gone(seconds=12):
    """Waits until no other StellarHub.exe from this folder is running; if one is still there after the wait, it
    is ended, so the files can be replaced or removed."""
    try:
        import psutil
    except ImportError:
        return
    me, exe = os.getpid(), os.path.normcase(sys.executable)

    def others():
        out = []
        for pr in psutil.process_iter(["pid", "name", "exe"]):
            try:
                if pr.info["pid"] != me and (pr.info["name"] or "").lower() == os.path.basename(exe).lower() \
                        and (pr.info["exe"] is None or os.path.normcase(pr.info["exe"]) == exe):
                    out.append(pr)
            except (psutil.Error, OSError):
                continue
        return out
    if not FROZEN:
        return
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        if not others():
            return
        time.sleep(0.2)
    for pr in others():
        try:
            pr.kill()
        except (psutil.Error, OSError):
            pass


SETUP_KEYS = {"language": str, "startWithWindows": bool, "alwaysAdmin": bool, "widgetWasOpen": bool, "autoUpdate": bool}


def _warm():
    """--warm (the installer, once the files are in place, with its progress window up): loads every DLL of the
    program once. The first time Windows runs a new file, Defender / SmartScreen scan it, and that can take 15-20 s
    on the first start of a fresh install or update, with nothing on screen. Paying it here, while the installer
    shows its progress, makes the first real start as fast as any other."""
    t0 = time.monotonic()
    k32 = ctypes.windll.kernel32
    k32.LoadLibraryExW.restype = ctypes.c_void_p
    n = 0
    for root, _dirs, files in os.walk(base_dir()):
        for f in files:
            if f.lower().endswith((".dll", ".pyd")):
                path = os.path.join(root, f)
                h = k32.LoadLibraryExW(path, None, 0x1)  # DONT_RESOLVE_DLL_REFERENCES: mapped (and scanned), not run
                if h:
                    k32.FreeLibrary(ctypes.c_void_p(h))
                n += 1
            elif f.lower().endswith(".exe"):
                try:
                    with open(os.path.join(root, f), "rb") as fh:
                        fh.read(1 << 20)
                except OSError:
                    pass
    print(f"[warm] {n} libraries in {time.monotonic() - t0:.1f} s", flush=True)


def _cli_setup(pairs):
    """--setup key=value ...: the choices made in the installer, written to this user's settings.
    The installer runs it as the user who installs (not elevated), so it lands in their profile.
    Only the keys in SETUP_KEYS are accepted; anything else is ignored."""
    changes = {}
    for p in pairs:
        k, sep, v = p.partition("=")
        kind = SETUP_KEYS.get(k)
        if not sep or kind is None:
            continue
        changes[k] = v.strip().lower() in ("1", "true", "yes", "on") if kind is bool else v.strip()[:16]
    if not changes:
        return
    data = _read_settings()
    data.update(changes)
    try:
        os.makedirs(DATA_DIR, exist_ok=True)
        tmp = SETTINGS + ".tmp"
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(data, fh, ensure_ascii=False, indent=2)
        os.replace(tmp, SETTINGS)
    except OSError:
        return
    if "startWithWindows" in changes:
        import winreg
        try:
            with winreg.OpenKey(winreg.HKEY_CURRENT_USER, r"Software\Microsoft\Windows\CurrentVersion\Run", 0,
                                winreg.KEY_SET_VALUE) as k:
                if changes["startWithWindows"]:
                    winreg.SetValueEx(k, "StellarHub", 0, winreg.REG_SZ, _autostart_cmd())
                else:
                    try:
                        winreg.DeleteValue(k, "StellarHub")
                    except FileNotFoundError:
                        pass
        except OSError:
            pass


def _uninstall_cleanup():
    """--uninstall-cleanup: removes what StellarHub registered in Windows outside its own folder."""
    _delete_admin_task()
    try:
        from .engine import selfupdate
        selfupdate.delete_task()
    except Exception:
        pass
    import winreg
    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, r"Software\Microsoft\Windows\CurrentVersion\Run", 0,
                            winreg.KEY_READ | winreg.KEY_SET_VALUE) as k:
            cur = winreg.QueryValueEx(k, "StellarHub")[0]
            if os.path.normcase(sys.executable) in os.path.normcase(cur):
                winreg.DeleteValue(k, "StellarHub")
    except OSError:
        pass


def _let_windows_shut_down(api):
    """Closing the window normally hides it to the tray (_on_closing cancels the close). When Windows is signing out,
    restarting or shutting down, that cancel would block it ("StellarHub is preventing restart"), so on SessionEnding
    StellarHub marks itself as quitting and lets every close through."""
    try:
        import clr  # noqa: F401
        clr.AddReference("System")
        from Microsoft.Win32 import SystemEvents, SessionEndingEventHandler

        def ending(sender, args):
            api._quitting = True
            try:
                from .engine import autopilot
                autopilot.stop()
            except Exception:
                pass
        SystemEvents.SessionEnding += SessionEndingEventHandler(ending)
        api._session_handler = ending  # keep a reference so it is not collected
    except Exception as e:
        print("session end hook:", e)


_WV2 = r"Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}"


def _webview2_present():
    """Microsoft's documented check for the WebView2 runtime. The installer adds it when missing; the portable
    version can't, so it says what to do instead of failing without a word."""
    import winreg
    for hive, key in ((winreg.HKEY_LOCAL_MACHINE, "SOFTWARE\\WOW6432Node\\" + _WV2), (winreg.HKEY_LOCAL_MACHINE, "SOFTWARE\\" + _WV2),
                      (winreg.HKEY_CURRENT_USER, "SOFTWARE\\" + _WV2)):
        try:
            with winreg.OpenKey(hive, key) as k:
                v = winreg.QueryValueEx(k, "pv")[0]
                if v and v != "0.0.0.0":
                    return True
        except OSError:
            continue
    return False


def _no_webview2():
    msg = tr("StellarHub needs the Microsoft Edge WebView2 Runtime, and this PC doesn't have it. Download it from Microsoft now?")
    if ctypes.windll.user32.MessageBoxW(None, msg, "StellarHub", 0x04 | 0x30) == 6:  # Yes/No with a warning icon; IDYES
        import webbrowser
        webbrowser.open("https://go.microsoft.com/fwlink/p/?LinkId=2124703")


def _install_staged_update(splash_on):
    """A version with new features (x.Y.0) downloaded in the background is installed here, at the start, before
    the window: the start screen says "Updating to…" and StellarHub opens again already updated. Never with
    "Install new features automatically" off, and never blocks the start if anything is off."""
    if not FROZEN or ISOLATED and not os.environ.get("STELLARHUB_UPDATE_URL"):
        return False
    try:
        from .engine import selfupdate
        if not selfupdate.staged():
            return False
        if _load_settings_strict().get("autoUpdateFeatures") is False:
            return False
        say = None
        if splash_on:
            from . import splash
            say = splash.status
        if not selfupdate.apply_staged_at_start(say=say):
            if say:
                say("")
            return False
        # the start screen stays up ("Installing the update…") until this process exits: the updater puts up the
        # same card right away, and then the installer's own progress window
        return True
    except Exception as e:
        print("staged update:", e)
        if splash_on:
            _fatal(tr("The update could not be installed. StellarHub will open again as it was."))
        return False


def _load_settings_strict():
    """settings.json as a dict. Missing: {}. Unreadable for a moment (antivirus, backup software): a few retries,
    then OSError. Damaged: kept as settings.json.bad and {} (so it is never silently overwritten)."""
    for i in range(6):
        try:
            with open(SETTINGS, encoding="utf-8") as fh:
                data = json.load(fh)
            return data if isinstance(data, dict) else {}
        except FileNotFoundError:
            return {}
        except ValueError:
            # keep each damaged copy (settings.json.bad-<time>, the last 3), so a second corruption can't erase the first
            try:
                shutil.copy2(SETTINGS, SETTINGS + ".bad-" + time.strftime("%Y%m%d-%H%M%S"))
                import glob
                for old in sorted(glob.glob(glob.escape(SETTINGS) + ".bad-*"))[:-3]:
                    os.remove(old)
            except OSError:
                pass
            return {}
        except OSError:
            if i == 5:
                raise
            time.sleep(.05)
    return {}


def _write_json(path, data):
    """Writes through a temp file and os.replace, retrying while another program has the file open for a moment."""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False, indent=2)
    for i in range(20):
        try:
            os.replace(tmp, path)
            return
        except PermissionError:
            if i == 19:
                raise
            time.sleep(.05)


UI_PORT = 47822  # the interface's local web server. pywebview's default (42001) is shared by every pywebview app


def _ui_port():
    """A stable port for the interface: the page's local storage (language, small preferences) belongs to the
    address, so it must not change between starts. If ours is taken, pick a free one and remember it."""
    import socket

    def free(port):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            try:
                s.bind(("127.0.0.1", port))
                return True
            except OSError:
                return False
    saved = _read_settings().get("uiPort")
    for port in ([] if ISOLATED else ([saved] if isinstance(saved, int) else []) + [UI_PORT]):
        if free(port):
            return port
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
    if ISOLATED:
        return port
    try:
        data = _load_settings_strict()
        data["uiPort"] = port
        _write_json(SETTINGS, data)
    except OSError:
        pass
    return port


def _session_id():
    sid = ctypes.c_ulong(0)
    try:
        if ctypes.windll.kernel32.ProcessIdToSessionId(os.getpid(), ctypes.byref(sid)):
            return sid.value
    except Exception:
        pass
    return 0


# single instance: a second copy asks the first one to show itself, then exits. One port per Windows session, so
# a second user signed in on the same PC (fast user switching, Remote Desktop) gets their own StellarHub
SINGLE_PORT = 47830 + _session_id() % 70
# STELLARHUB_LOCK_ID: isolated test copies that must see each other (the single-instance tests) share this id
LOCK_ID = os.environ.get("STELLARHUB_LOCK_ID") or str(os.getpid())
if ISOLATED:
    SINGLE_PORT = 47900 + sum(map(ord, LOCK_ID)) % 90


def _ask_running_to_show(wait=1.5):
    """Asks the running copy to show its window. True only if it ANSWERED that it did (it replies "ok" once the
    window is up), so a copy that is quitting, hung or deaf is told apart from one that obeyed."""
    import socket
    try:
        with socket.create_connection(("127.0.0.1", SINGLE_PORT), timeout=min(wait, 0.5)) as s:
            s.settimeout(wait)
            s.sendall(b"show")
            return s.recv(4).startswith(b"ok")
    except OSError:
        return False


def _listen_single(api):
    import socket
    srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        srv.bind(("127.0.0.1", SINGLE_PORT))
    except OSError:
        return
    srv.listen(2)

    def loop():
        while True:
            try:
                conn, _ = srv.accept()
                with conn:
                    conn.settimeout(2)  # a client that connects and says nothing must not block "show" or "quit"
                    msg = conn.recv(16)
                    if msg.startswith(b"show"):
                        t = threading.Thread(target=api.show_main, daemon=True, name="single-show")
                        t.start()
                        t.join(1.2)  # a window thread that is stuck must not keep the other copy waiting
                        if not t.is_alive():
                            conn.sendall(b"ok")
                    elif msg.startswith(b"quit"):  # the installer closes the running copy before updating it
                        conn.sendall(b"bye")
                        threading.Timer(0.05, lambda: api.quit(True)).start()
            except OSError:
                time.sleep(0.05)  # one bad client never ends the listener
                continue
    threading.Thread(target=loop, daemon=True, name="single").start()


def _wait_for_previous(seconds=10):
    """--wait-pid N: when relaunching as administrator, wait (bounded) for the previous copy to close. If it is
    still there after that, it is stuck quitting: it is ended, so the handoff can never deadlock."""
    if "--wait-pid" not in sys.argv:
        return
    try:
        pid = int(sys.argv[sys.argv.index("--wait-pid") + 1])
    except (IndexError, ValueError):
        return
    k32 = ctypes.windll.kernel32
    k32.OpenProcess.restype = ctypes.c_void_p
    h = k32.OpenProcess(0x00100000 | 0x0001, False, pid)  # SYNCHRONIZE | PROCESS_TERMINATE
    if not h:
        return  # already gone (or not ours to wait for)
    try:
        if k32.WaitForSingleObject(ctypes.c_void_p(h), int(seconds * 1000)) == 0:
            _phase("previous copy exited")
            return
        print(f"[start] the previous copy (pid {pid}) is still there after {seconds} s: ending it", flush=True)
        k32.TerminateProcess(ctypes.c_void_p(h), 0)
        k32.WaitForSingleObject(ctypes.c_void_p(h), 3000)
        _phase("previous copy ended")
    finally:
        k32.CloseHandle(ctypes.c_void_p(h))


_MUTEX = None  # held for the whole life of the process
_MUTEX_NAME = r"Local\StellarHub.SingleInstance"


def _mutex_name():
    return _MUTEX_NAME + (f".test{LOCK_ID}" if ISOLATED else "")


def _mutex_exists():
    """True if another copy holds the single-instance mutex (an elevated copy's mutex can't be opened from a
    normal one: access denied also means it exists)."""
    k32 = ctypes.windll.kernel32
    k32.OpenMutexW.restype = ctypes.c_void_p
    h = k32.OpenMutexW(0x00100000, False, _mutex_name())  # SYNCHRONIZE
    err = k32.GetLastError()
    if h:
        k32.CloseHandle(ctypes.c_void_p(h))
        return True
    return err == 5


def _claim_single_instance(wait=0.0):
    """One StellarHub per Windows session, normal or elevated: a named mutex. True if this copy got it. With
    `wait` (a copy started by the scheduled task or relaunched as administrator) it keeps trying that many
    seconds, to give the previous copy time to exit."""
    global _MUTEX
    k32 = ctypes.windll.kernel32
    k32.CreateMutexW.restype = ctypes.c_void_p
    end = time.monotonic() + wait
    while True:
        h = k32.CreateMutexW(None, False, _mutex_name())
        err = k32.GetLastError()
        if h and err != 183:  # 183 = ERROR_ALREADY_EXISTS
            _MUTEX = h
            return True
        if h:
            k32.CloseHandle(ctypes.c_void_p(h))
        # no handle with error 5 = it exists but belongs to an elevated copy: also "already running"
        if time.monotonic() >= end:
            return False
        time.sleep(0.1)


def _other_copies():
    """The other StellarHub processes that could be holding the lock (not workers, updaters or installer helpers)."""
    try:
        import psutil
    except ImportError:
        return []
    me, out = os.getpid(), []
    mine = os.path.normcase(sys.executable)
    run_py = os.path.normcase(os.path.join(base_dir(), "run.py"))
    for pr in psutil.process_iter(["pid", "name", "exe", "cmdline"]):
        try:
            if pr.info["pid"] == me:
                continue
            cmd = [os.path.normcase(a) for a in (pr.info["cmdline"] or [])]
            if any(a.startswith(("--multiprocessing", "--self-update", "--finish-update", "--quit", "--setup",
                                 "--admin-task", "--update-task", "--uninstall-cleanup")) for a in cmd):
                continue
            if FROZEN:
                same = (pr.info["name"] or "").lower() == os.path.basename(mine) and \
                    (pr.info["exe"] is None or os.path.normcase(pr.info["exe"]) == mine)
            else:
                same = run_py in cmd
            if same:
                out.append(pr)
        except (psutil.Error, OSError):
            continue
    return out


def _fatal(msg):
    """A last resort that never stays silent: the log and a Windows message box."""
    print("[start]", msg, flush=True)
    try:
        from . import splash
        splash.close()
    except Exception:
        pass
    if not paths.dialogs_allowed():
        return
    try:
        ctypes.windll.user32.MessageBoxW(None, msg, "StellarHub", 0x10 | 0x00040000)  # error icon, topmost
    except Exception:
        pass


def _take_over_running_copy():
    """The single-instance lock is taken. Returns True when this copy got it (and must start), False when it has
    nothing more to do: the running copy showed itself, or the user was told why not.
      1. ask it to show itself (it answers "ok" once its window is up);
      2. no answer: it may be starting, or quitting: keep asking and trying for the lock for a while, with the
         start screen saying "Opening StellarHub…";
      3. still nothing: it is stuck: end it (only an old one: a copy that is just starting is given time) and
         take over;
      4. cannot end it (an administrator copy, from a normal one): say so in a message, never exit silently."""
    _phase("another copy holds the lock")
    try:
        from . import splash
        if splash.showing():
            splash.status(tr("Opening StellarHub…"))
    except Exception:
        pass
    if _ask_running_to_show(1.5):
        _phase("running copy showed itself")
        return False
    t0 = time.monotonic()
    while time.monotonic() - t0 < 12:
        if _claim_single_instance(0):
            _phase("lock released by the other copy")
            return True
        if _ask_running_to_show(0.6):
            _phase("running copy showed itself (late)")
            return False
        time.sleep(0.2)
    others = _other_copies()
    # a copy that is still starting (or installing a staged update) has its start screen up: give it its time
    # (the update can take a couple of minutes); one with no start screen and no answer is stuck
    try:
        from . import splash
        end = time.monotonic() + 130
        while time.monotonic() < end and splash.other_showing():
            if _claim_single_instance(0):
                return True
            if _ask_running_to_show(0.6):
                return False
            time.sleep(0.3)
    except Exception:
        pass
    print(f"[start] the running copy does not answer ({[p.pid for p in others]}): ending it", flush=True)
    try:
        from . import splash
        if splash.showing():
            splash.status(tr("StellarHub did not answer. Closing it…"))
    except Exception:
        pass
    for pr in others:
        try:
            for ch in pr.children(recursive=True):
                try:
                    ch.kill()
                except Exception:
                    pass
            pr.kill()
        except Exception as e:
            print("[start] could not end", pr.pid, e, flush=True)
    end = time.monotonic() + 5
    while time.monotonic() < end:
        if _claim_single_instance(0):
            _phase("took over after ending the stuck copy")
            return True
        time.sleep(0.2)
    _fatal(tr("StellarHub is already running but is not answering, and it could not be closed (it may be running "
              "as administrator). End it from Task Manager and open StellarHub again."))
    return False


def main():
    if any(a.startswith("--multiprocessing") for a in sys.argv[1:]):
        return  # a worker process that freeze_support() did not catch: never boot the app from it
    if "--quit" in sys.argv:
        return _quit_running()
    if "--uninstall-cleanup" in sys.argv:
        return _uninstall_cleanup()
    if "--warm" in sys.argv:
        _log_to_file()
        return _warm()
    if "--setup" in sys.argv:
        return _cli_setup(sys.argv[sys.argv.index("--setup") + 1:])
    if "--admin-task" in sys.argv:
        on = sys.argv[sys.argv.index("--admin-task") + 1:][:1] == ["on"]
        return _ensure_admin_task() if on else _delete_admin_task()
    if "--self-update" in sys.argv:  # the updater (see engine/selfupdate.py): no window, never a second app
        _log_to_file()
        from .engine import selfupdate
        return selfupdate.run_updater()
    if "--finish-update" in sys.argv:  # a new portable copy putting itself in place (engine/selfupdate.py)
        from .engine import selfupdate
        i = sys.argv.index("--finish-update")
        return selfupdate.finish_update(sys.argv[i + 1], sys.argv[i + 2] if len(sys.argv) > i + 2 else "0")
    if "--update-task" in sys.argv:  # the installer, as administrator
        from .engine import selfupdate
        on = sys.argv[sys.argv.index("--update-task") + 1:][:1] == ["on"]
        return selfupdate.ensure_task() if on else selfupdate.delete_task()
    _log_to_file()
    _phase("main")
    if FROZEN:
        _migrate_store_python_data()
    from . import i18n
    i18n.set_language(os.environ.get("STELLARHUB_LANG") or _read_settings().get("language"))
    start_hidden = "--tray" in sys.argv
    if "--from-task" in sys.argv and os.path.exists(_START_HIDDEN):
        start_hidden = True
    handoff = "--wait-pid" in sys.argv or "--from-task" in sys.argv  # a copy the previous one is handing over to
    splash_on = not start_hidden and os.environ.get("STELLARHUB_NO_SPLASH") != "1"
    if splash_on:  # the start screen comes first, before anything that can wait (StellarHub opens with it, like FL Studio)
        try:
            from . import splash
            splash.show()
            if handoff or _wants_elevation():
                splash.status(tr("Opening as administrator…"))
        except Exception as e:
            print("splash:", e)
            splash_on = False
    _phase("splash shown" if splash_on else "no splash")
    _wait_for_previous()
    claimed = False
    if not handoff and _mutex_exists():  # already running (even elevated): show it, or take over if it is stuck
        if not _take_over_running_copy():
            return
        claimed = True
    if not claimed:
        if _elevate_on_start():
            return
        if not _claim_single_instance(10 if handoff else 0) and not _take_over_running_copy():
            return
    _phase("single-instance claimed")
    try:
        os.remove(_START_HIDDEN)
    except OSError:
        pass
    if not start_hidden and _install_staged_update(splash_on):
        return  # the installer (or the new portable copy) takes over and opens StellarHub again, updated
    if not ISOLATED:  # a test copy never takes over the user's "open with Windows" entry or administrator task
        threading.Thread(target=_sync_launch_entries, daemon=True).start()
    if PORTABLE:
        from .engine import selfupdate
        threading.Thread(target=selfupdate.cleanup_after_update, daemon=True).start()
    if is_admin() and not ISOLATED:
        try:
            with open(SETTINGS, encoding="utf-8") as fh:
                if json.load(fh).get("alwaysAdmin"):
                    threading.Thread(target=_ensure_admin_task, daemon=True).start()
        except (OSError, ValueError):
            pass
        threading.Thread(target=_repair_update_task, daemon=True).start()
    try:
        ctypes.windll.shell32.SetCurrentProcessExplicitAppUserModelID(APP_ID)
    except Exception:
        pass
    if not _webview2_present():
        _no_webview2()
        return
    import webview

    api = Api()
    title = tr("StellarHub (administrator)") if is_admin() else "StellarHub"
    from .chrome import Chrome

    window = webview.create_window(
        title, url=os.path.join(UI_DIR, "index.html"), js_api=api,
        width=1600, height=960, min_size=(1100, 700), frameless=True, easy_drag=False, shadow=True,
        background_color=BG, text_select=False, hidden=start_hidden,
        x=-32000 if splash_on else None, y=-32000 if splash_on else None,
    )
    api._attach(window)
    if splash_on:
        api._reveal_pending = True
        t = threading.Timer(45, api._reveal)  # whatever happens, never leave only the start screen
        t.daemon = True
        t.start()

    def on_state(maxed):  # called from the window thread: never wait here
        api._js(f"window.SH && SH.emit('win', {{max: {'true' if maxed else 'false'}}})")

    api._chrome = Chrome(window, on_state)
    # with the start screen up, the window is placed and maximized when it is revealed (Api._reveal)
    window.events.shown += lambda: (None if api._reveal_pending else api._chrome.setup(start_max=True), _grant_media(window))
    window.events.closing += api._on_closing
    for ev in (window.events.minimized, window.events.restored, window.events.maximized):
        ev += api._win_state
    _let_windows_shut_down(api)

    from .tray import Tray
    try:
        api._tray = Tray(api)
        api._tray.start()
    except Exception as e:  # without a tray the app still works; the X quits completely
        print("tray:", e)
        api._tray = None

    _listen_single(api)

    # engine: long-task notifications and real telemetry
    from .engine import jobs
    jobs.set_emitter(lambda ev, data: api._js(f"window.SH && SH.emit({json.dumps(ev)}, {json.dumps(data)})",
                                              lossy=isinstance(data, dict) and data.get("kind") == "progress"))
    try:
        from .engine.telemetry import Sampler
        api._sampler = Sampler(api._tele_push)
        rate = float(api.settings_get().get("teleRate") or 1000) / 1000
        api._sampler.set_rate(rate)
        api._sampler.ping_on = api.settings_get().get("measurePing", True) is not False
        api._visible = not start_hidden
        window.events.loaded += lambda: (api._sampler.start(), api._tele_refresh())
    except Exception as e:
        print("telemetry:", e)

    # Autopilot: runs the routines while the app is open, also hidden in the tray
    try:
        from .engine import autopilot
        if not ISOLATED:  # a test copy must not run the user's routines or write their Autopilot state
            autopilot.attach((lambda title, text: api._tray.notify(text, title)) if api._tray else None)
    except Exception as e:
        print("autopilot:", e)

    window.events.loaded += lambda: _phase("page loaded")
    refresh_ui_cache()
    _phase("window created, starting webview")
    webview.start(gui="edgechromium", debug="--debug" in sys.argv, http_server=True, http_port=_ui_port(),
                  private_mode=False, storage_path=WEB_DIR)
    if api._tray is not None:
        api._tray.stop()
    if getattr(api, "_handoff", False):  # no gap on screen: wait (bounded) until the new copy's start screen is up
        try:
            from . import splash
            end = time.monotonic() + 5
            while time.monotonic() < end and not splash.other_showing():
                time.sleep(0.05)
        except Exception:
            pass
    # The window is gone and settings are saved as they change. Background scans still running in thread pools
    # (winget, PowerShell...) would keep the process alive until they finish, so end it now.
    try:
        sys.stdout.flush()
        sys.stderr.flush()
    except Exception:
        pass
    os._exit(0)
