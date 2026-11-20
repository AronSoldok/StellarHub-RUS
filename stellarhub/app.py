"""StellarHub: the entry point. main() only wires the pieces together:

  config      constants and locations            startup    everything before the window exists
  settings    settings.json                      instance   single-instance lock and handoff
  elevation   administrator mode and its task    autostart  "open with Windows"
  winmgr      window mechanics (DPI, corners...) api        what the interface can call (pywebview js_api)
  log         [phase] timeline and the log file  jssender   ordered evaluate_js per window

The names below are re-exported because tests, the engine (autopilot, hangar read SETTINGS) and run.py use them."""
import json
import os
import sys
import threading
import time
from pathlib import Path

from . import config, instance, startup, winmgr
from .api import Api
from .api.engine_api import attach_telemetry
from .config import APP_ID, BG, DATA_DIR, FROZEN, ISOLATED, PORTABLE, SETTINGS, UI_DIR, WEB_DIR, base_dir, is_admin  # noqa: F401
from .i18n import tr
from .instance import ask_running_to_show as _ask_running_to_show, listen_single as _listen_single  # noqa: F401
from .jssender import Sender as _Sender  # noqa: F401
from .log import LogOnce as _LogOnce, fatal as _fatal, phase as _phase, rotate_log as _rotate_log  # noqa: F401
from .startup import refresh_ui_cache  # noqa: F401
from .winmgr import panel_geometry as _panel_geometry, style_titlebar  # noqa: F401


def main():
    if startup.run_command(sys.argv):
        return
    launch = startup.prepare()
    startup.start_prefetch()  # imports and the tray icon load while the start screen comes up
    startup.show_splash(launch)
    if not startup.acquire(launch):
        return
    if not startup.start_background_work(launch):
        return  # the installer (or the new portable copy) takes over and opens StellarHub again, updated
    if not startup.webview2_present():
        startup.no_webview2()
        return
    import webview
    _phase("webview imported")

    api = Api()
    _phase("api built")
    title = tr("StellarHub (administrator)") if is_admin() else "StellarHub"
    from .chrome import Chrome
    _phase("chrome imported")

    window = webview.create_window(
        title, url=str(Path(config.UI_DIR) / "index.html"), js_api=api,
        width=1600, height=960, min_size=(1100, 700), frameless=True, easy_drag=False, shadow=True,
        background_color=BG, text_select=False, hidden=launch.hidden,
        x=-32000 if launch.splash else None, y=-32000 if launch.splash else None,
    )
    api._attach(window)
    if launch.splash:
        api._reveal_pending = True
        t = threading.Timer(45, api._reveal)  # whatever happens, never leave only the start screen
        t.daemon = True
        t.start()

    def on_state(maxed):  # called from the window thread: never wait here
        api._js(f"window.SH && SH.emit('win', {{max: {'true' if maxed else 'false'}}})")

    api._chrome = Chrome(window, on_state)
    # with the start screen up, the window is placed and maximized when it is revealed (Api._reveal)
    window.events.shown += lambda: (None if api._reveal_pending else api._chrome.setup(start_max=True), winmgr.grant_media(window))
    window.events.closing += api._on_closing
    for ev in (window.events.minimized, window.events.restored, window.events.maximized):
        ev += api._win_state
    startup.let_windows_shut_down(api)

    from .tray import Tray
    api._tray = Tray(api)

    def start_tray():  # the icon is drawn and registered off the start path (the window does not wait for it)
        try:
            api._tray.start()
        except Exception as e:  # without a tray the app still works; the X quits completely
            print("tray:", e)
            api._tray = None
    threading.Thread(target=start_tray, daemon=True, name="tray-start").start()

    _phase("tray started")
    instance.listen_single(api)

    # engine: long-task notifications and real telemetry
    from .engine import jobs
    jobs.set_emitter(lambda ev, data: api._js(f"window.SH && SH.emit({json.dumps(ev)}, {json.dumps(data)})",
                                              lossy=isinstance(data, dict) and data.get("kind") == "progress"))
    api._visible = not launch.hidden
    attach_telemetry(api, window)

    # Autopilot: runs the routines while the app is open, also hidden in the tray
    try:
        from .engine import autopilot
        if not ISOLATED:  # a test copy must not run the user's routines or write their Autopilot state
            autopilot.attach((lambda title, text: api._tray.notify(text, title)) if api._tray else None)
    except Exception as e:
        print("autopilot:", e)

    # freeze detector: if the window or the page stops answering, every thread's stack goes to the log once
    winmgr.watch_ui(window, lambda: max([s.busy_for() for s in list(api._senders.values())] or [0]))
    window.events.loaded += lambda: _phase("page loaded")
    _phase("engine attached")
    startup.refresh_ui_cache()
    startup.set_browser_args()  # sounds may play without a click (the start sound)
    _phase("window created, starting webview")
    webview.start(gui="edgechromium", debug=launch.debug, http_server=True, http_port=startup.ui_port(),
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
