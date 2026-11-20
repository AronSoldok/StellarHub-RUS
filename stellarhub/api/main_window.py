"""The main window: custom frame, zoom, close/hide in the tray, quit, show, administrator relaunch."""
import ctypes
import threading
import time

from .. import config, elevation, paths, settings, winmgr
from ..i18n import tr


class MainWindowApi:
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
        if config.is_admin():
            return True
        # the elevated copy waits for this one to exit (it frees the single-instance lock and the WebView2 data)
        r = elevation.relaunch_elevated()
        if r:
            self._handoff = True  # main() keeps the start screen up until the new copy shows its own
            try:
                from .. import splash
                splash.show()
                splash.status(tr("Opening as administrator…"))
            except Exception:
                pass
            threading.Timer(0.05, lambda: self.quit(True)).start()
            return True
        print("[start] relaunch as administrator: Windows did not give permission", flush=True)
        return False

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
            from ..engine import jobs
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
                raise RuntimeError("no dialogs")  # a test copy: answer yes
            # a native box: it works the same from the window, the tray menu and the tray panel
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
            from ..engine import autopilot
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
            # the user quit with the window on screen: its exit sound plays while it fades (not for an update or the
            # administrator relaunch, which reopen it)
            sound = not force and settings.plays_exit_sound(self.settings_get())
            self._js(f"window.SH && SH.leave && SH.leave({'true' if sound else 'false'})")
            delay = settings.EXIT_SOUND_WAIT if sound else 0.3
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
                winmgr.grant_media(self._window)
            elif self._chrome and self._chrome.max:
                self._chrome._ui(self._chrome._maximize)
            from System import Action
            form = self._window.native
            form.BeginInvoke(Action(lambda: (form.Activate(), form.BringToFront())))
        except Exception:
            pass
        return True

    def _win_state(self, *_):
        """Minimized, restored or maximized (window thread): a minimized window is not 'visible' for the UI work."""
        try:
            from System.Windows.Forms import FormWindowState
            self._minimized = self._window.native.WindowState == FormWindowState.Minimized
        except Exception:
            return
        # off the window thread: it reads the settings and stops the GPU session, none of which it may wait for
        threading.Thread(target=self._tele_refresh, daemon=True, name="tele-refresh").start()

