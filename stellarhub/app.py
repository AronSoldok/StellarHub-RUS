"""Ventana de StellarHub (pywebview + WebView2) y la API que ve la interfaz."""
import ctypes
import hashlib
import json
import os
import shutil
import sys
import threading
import time

from . import VERSION

APP_ID = "StellarHub.App"
BG = "#060A14"


def base_dir():
    return getattr(sys, "_MEIPASS", os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


UI_DIR = os.path.join(base_dir(), "stellarhub", "ui")
DATA_DIR = os.path.join(os.environ.get("APPDATA") or os.path.expanduser("~"), "StellarHub")
WEB_DIR = os.path.join(os.environ.get("LOCALAPPDATA") or DATA_DIR, "StellarHub", "webview")
SETTINGS = os.path.join(DATA_DIR, "settings.json")


def is_admin():
    try:
        return bool(ctypes.windll.shell32.IsUserAnAdmin())
    except Exception:
        return False


def _gui_python():
    """pythonw.exe si existe, para no abrir una consola al relanzar."""
    exe = sys.executable
    if not getattr(sys, "frozen", False) and exe.lower().endswith("python.exe"):
        w = exe[:-10] + "pythonw.exe"
        if os.path.exists(w):
            return w
    return exe


class Api:
    """Todo lo público de esta clase es invocable desde JS como window.pywebview.api.<nombre>."""

    def __init__(self):
        self._window = None
        self._chrome = None
        self._widget = None
        self._tray = None
        self._sampler = None
        self._visible = True
        self._quitting = False
        self._told_tray = False
        self._lock = threading.Lock()

    def _attach(self, window):
        self._window = window

    # ---------- información ----------
    def info(self):
        return {"version": VERSION, "admin": is_admin()}

    # ---------- ajustes ----------
    def settings_get(self):
        try:
            with open(SETTINGS, encoding="utf-8") as fh:
                data = json.load(fh)
                return data if isinstance(data, dict) else {}
        except (OSError, ValueError):
            return {}

    def settings_set(self, changes):
        if not isinstance(changes, dict):
            return False
        with self._lock:
            data = self.settings_get()
            data.update(changes)
            os.makedirs(DATA_DIR, exist_ok=True)
            tmp = SETTINGS + ".tmp"
            with open(tmp, "w", encoding="utf-8") as fh:
                json.dump(data, fh, ensure_ascii=False, indent=2)
            os.replace(tmp, SETTINGS)
        return True

    # ---------- marco propio de la ventana ----------
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

    # ---------- ventana ----------
    def set_zoom(self, factor):
        """Zoom real de WebView2 (el mismo que Ctrl + rueda), no un escalado CSS."""
        try:
            factor = max(0.75, min(2.0, float(factor)))
            form = self._window.native
            from System import Action  # pythonnet, viene con pywebview

            def apply():
                form.webview.ZoomFactor = factor

            form.Invoke(Action(apply))
            return True
        except Exception:
            return False

    def relaunch_admin(self):
        """Abre una copia elevada y cierra esta. Si el usuario dice que no en UAC, sigue todo igual."""
        if is_admin():
            return True
        # la copia elevada espera a que esta termine (libera la "copia única" y los datos de WebView2)
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
            threading.Timer(0.05, self.quit).start()
            return True
        return False

    # ---------- cerrar, ocultar en la bandeja y salir ----------
    def _js(self, code, target=None):
        """Avisa a la interfaz SIN esperar. evaluate_js espera la respuesta de WebView2, que llega por el hilo
        de la ventana: llamado desde ese hilo (eventos, Invoke, redimensionar) la bloquearía para siempre."""
        w = target or self._window

        def run():
            try:
                w.evaluate_js(code)
            except Exception:
                pass
        threading.Thread(target=run, daemon=True).start()

    def close_main(self):
        """La X: con "cerrar a la bandeja" activado solo oculta la ventana; si no, sale de la app."""
        if self._tray is not None and self.settings_get().get("trayOnClose", True):
            self._window.hide()
            self._visible = False
            self._tele_refresh()
            if not self._told_tray:
                self._told_tray = True
                self._tray.notify("StellarHub sigue en la bandeja. Ábrelo desde aquí o sal con clic derecho > Salir.")
            return "hidden"
        self.quit()
        return "quit"

    def quit(self):
        self._quitting = True
        if self._sampler:
            self._sampler.stop()
        self.widget_close()
        if self._tray is not None:
            self._tray.stop()
        threading.Timer(0.05, lambda: self._window.destroy()).start()
        return True

    def _on_closing(self):
        """Alt+F4 o cerrar desde la barra de tareas: igual que la X. Corre en el hilo de la ventana, así que
        decide y cancela al momento; ocultar o salir se hace después, fuera de este hilo."""
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
        """Abrir con Windows (minimizado en la bandeja): entrada en HKCU\\...\\Run."""
        import winreg
        key = r"Software\Microsoft\Windows\CurrentVersion\Run"
        try:
            with winreg.OpenKey(winreg.HKEY_CURRENT_USER, key, 0, winreg.KEY_SET_VALUE) as k:
                if on:
                    cmd = f'"{sys.executable}" --tray' if getattr(sys, "frozen", False) else \
                        f'"{_gui_python()}" "{os.path.join(base_dir(), "run.py")}" --tray'
                    winreg.SetValueEx(k, "StellarHub", 0, winreg.REG_SZ, cmd)
                else:
                    try:
                        winreg.DeleteValue(k, "StellarHub")
                    except FileNotFoundError:
                        pass
            return True
        except OSError:
            return False

    # ---------- widget siempre visible ----------
    def widget_toggle(self, width=400, height=190):
        """Abre o cierra el widget. Devuelve True si queda abierto."""
        import webview
        if self._widget is not None:
            self.widget_close()
            return False
        w, h = max(160, min(1100, int(width or 400))), max(32, min(600, int(height or 190)))
        x = y = None
        try:
            scr = webview.screens[0]
            x, y = scr.width - w - 28, 72
        except Exception:
            pass
        self._widget = webview.create_window(
            "StellarHub widget", url=os.path.join(UI_DIR, "widget.html"), js_api=self,
            width=w, height=h, x=x, y=y, frameless=True, easy_drag=True, on_top=True, min_size=(120, 30),
            resizable=False, background_color=BG, focus=False,
        )
        wref = self._widget
        self._widget.events.closed += lambda: self._widget_gone(wref)
        self._widget.events.shown += lambda: (_round_corners(wref), self._widget_keep_on_top(wref))
        self.settings_set({"widgetWasOpen": True})
        self._tele_refresh()
        self._tray and self._tray.refresh()
        self._js("SH.emit('widget', {on: true})")
        return True

    def _widget_keep_on_top(self, w):
        """La barra de tareas también es "siempre visible" y, al tocarla, se pone delante de todo.
        - Ventana de herramientas: sale en todos los escritorios virtuales y no aparece en Alt+Tab.
        - Un hilo vuelve a ponerla arriba cada poco (sin activarla ni moverla) mientras el widget exista."""
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
            print("widget estilo:", e)
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

    def _widget_gone(self, w=None):
        if w is not None and self._widget is not w:
            return  # era un widget anterior ya sustituido
        self._widget = None
        self._tray and self._tray.refresh()
        self._js("SH.emit('widget', {on: false})")

    def widget_close(self):
        """Se cierra un instante después de responder: si la llamada viene del propio widget, destruirlo
        mientras pywebview aún le está devolviendo el resultado puede dejarlo colgado."""
        w = self._widget
        self._widget = None
        if w is not None:
            def kill():
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
        """El botón mini/grande del propio widget: guarda y avisa a la ventana principal."""
        mode = "mini" if mode == "mini" else "full"
        self.settings_set({"widgetMode": mode})
        self._js(f"SH.state.settings.widgetMode='{mode}'; SH.emit('widget-mode','{mode}')")
        return mode

    def widget_is_open(self):
        return self._widget is not None

    def widget_update(self, conf):
        """Ajustes del widget cambiados en la ventana principal: se aplican al momento."""
        if self._widget is not None:
            self._js(f"window.SH && SH.widgetApply && SH.widgetApply({json.dumps(conf)})", self._widget)
        return True

    def widget_resize(self, width, height):
        """Cambia el tamaño manteniendo fija la esquina superior derecha (el widget suele vivir a la derecha)."""
        if self._widget is not None:
            try:
                from webview.window import FixPoint
                self._widget.resize(int(width), int(height), fix_point=FixPoint.NORTH | FixPoint.EAST)
            except Exception as e:
                print("widget_resize:", e)
        return True

    def log_js_error(self, msg):
        """Errores de la interfaz al registro (stellarhub.log), para poder diagnosticar."""
        print("[interfaz]", str(msg)[:2000], flush=True)
        return True

    # ---------- motor real ----------
    def engine(self, mod, fn, args=None):
        """SH.engine(mod, fn, ...args): llamada rápida a stellarhub/engine/<mod>.py (solo lo que está en EXPORTS)."""
        from . import engine as E
        try:
            return {"ok": True, "data": E.resolve(mod, fn, "call")(*(args or []))}
        except Exception as e:
            import traceback
            print(f"[motor {mod}.{fn}]", traceback.format_exc())
            return {"ok": False, "error": str(e)}

    def engine_job(self, mod, fn, args=None):
        """SH.job(...): tarea larga; el progreso llega como SH.emit('job', ...). Devuelve el id de la tarea."""
        from . import engine as E
        from .engine import jobs
        try:
            return {"ok": True, "id": jobs.start(f"{mod}.{fn}", E.resolve(mod, fn, "job"), *(args or []))}
        except Exception as e:
            return {"ok": False, "error": str(e)}

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

    def tele_rate(self, ms):
        if self._sampler:
            self._sampler.set_rate(float(ms) / 1000)
        return True

    def _tele_push(self, data):
        """Cada muestra de telemetría va a la ventana principal (si se ve) y al widget (si está abierto).
        Se llama desde el hilo del muestreador, nunca desde el de la ventana."""
        payload = json.dumps(data)
        if self._visible:
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

    def _tele_refresh(self):
        if self._sampler:
            stats = self.settings_get().get("widgetStats") or []
            gpu_in_widget = any(s.startswith("gpu") or s == "vram" for s in stats)
            self._sampler.set_active(self._visible or self._widget is not None,
                                     gpu=self._visible or (self._widget is not None and gpu_in_widget))

    # ---------- administrador permanente ----------
    def set_always_admin(self, on):
        """Con esto activado StellarHub se abre siempre como administrador. Se usa una tarea programada con
        privilegios altos para que Windows no pregunte en cada arranque (crearla sí necesita ser admin)."""
        self.settings_set({"alwaysAdmin": bool(on)})
        if on and is_admin():
            return _ensure_admin_task()
        if not on:
            _delete_admin_task()
        return True

    # ---------- acerca de ----------
    def project_stats(self):
        """Bytes de código por lenguaje, como la barra de lenguajes de GitHub."""
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

    # ---------- herramientas de Windows y datos ----------
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
        r = self._window.create_file_dialog(webview.SAVE_DIALOG, save_filename="StellarHub-ajustes.json",
                                            file_types=("Ajustes de StellarHub (*.json)",))
        if not r:
            return None
        path = r if isinstance(r, str) else r[0]
        with open(path, "w", encoding="utf-8") as fh:
            json.dump(self.settings_get(), fh, ensure_ascii=False, indent=2)
        return path

    def import_settings(self):
        import webview
        r = self._window.create_file_dialog(webview.OPEN_DIALOG, file_types=("Ajustes de StellarHub (*.json)",))
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

    def reset_settings(self):
        """Devuelve los ajustes guardados (para poder deshacer) y los borra."""
        old = self.settings_get()
        try:
            os.remove(SETTINGS)
        except OSError:
            pass
        return old

    def open_url(self, url):
        if isinstance(url, str) and url.startswith(("https://", "http://", "ms-settings:")):
            os.startfile(url)
            return True
        return False


def refresh_ui_cache():
    """WebView2 guarda los .js/.css en su caché HTTP: tras cambiar la interfaz seguiría mostrando la vieja.
    Si cambia algún archivo de la interfaz, se vacía esa caché."""
    h = hashlib.sha1()
    for root, _dirs, files in sorted(os.walk(UI_DIR)):
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


def _round_corners(window):
    """Esquinas redondeadas de Windows 11 para ventanas sin marco, con un filo sutil dibujado por Windows
    (la interfaz del widget no dibuja borde propio: así no se ve un doble marco en las esquinas)."""
    try:
        hwnd = window.native.Handle.ToInt32()
        dwm = ctypes.windll.dwmapi
        pref = ctypes.c_int(2)  # DWMWCP_ROUND
        dwm.DwmSetWindowAttribute(hwnd, 33, ctypes.byref(pref), 4)
        border = ctypes.c_int(0x00473A2C)  # #2C3A47 en BGR
        dwm.DwmSetWindowAttribute(hwnd, 34, ctypes.byref(border), 4)
    except Exception:
        pass


def _grant_media(window):
    """Cámara y micrófono para la propia interfaz de StellarHub (Device Tester) sin el aviso del navegador.
    Lo único que puede bloquearlos es la privacidad de Windows, y la app enlaza a esos ajustes."""
    state = {"done": False}

    def hook():
        """Corre en el hilo de la ventana (WebView2 solo se puede tocar desde ahí). Devuelve True si quedó puesto."""
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
                print("permisos:", e)
                return
            time.sleep(0.15)
    threading.Thread(target=wait_and_hook, daemon=True).start()


def style_titlebar(window):
    """Barra de título oscura y del mismo color que el fondo (Windows 11)."""
    try:
        hwnd = window.native.Handle.ToInt32()
        dwm = ctypes.windll.dwmapi
        on = ctypes.c_int(1)
        dwm.DwmSetWindowAttribute(hwnd, 20, ctypes.byref(on), 4)  # modo oscuro
        r, g, b = int(BG[1:3], 16), int(BG[3:5], 16), int(BG[5:7], 16)
        color = ctypes.c_int(r | (g << 8) | (b << 16))
        dwm.DwmSetWindowAttribute(hwnd, 35, ctypes.byref(color), 4)  # fondo del título
        text = ctypes.c_int(0x00F6EDE8)
        dwm.DwmSetWindowAttribute(hwnd, 36, ctypes.byref(text), 4)  # texto del título
    except Exception:
        pass


def _log_to_file():
    """Con pythonw no hay consola: los errores van a %APPDATA%\\StellarHub\\stellarhub.log."""
    if sys.stderr is None or "pythonw" in os.path.basename(sys.executable).lower():
        try:
            os.makedirs(DATA_DIR, exist_ok=True)
            fh = open(os.path.join(DATA_DIR, "stellarhub.log"), "a", encoding="utf-8", buffering=1)
            sys.stdout = sys.stderr = fh
        except OSError:
            pass


ADMIN_TASK = r"StellarHub\Abrir como administrador"


def _launch_cmd(extra=""):
    if getattr(sys, "frozen", False):
        return sys.executable, extra.strip()
    return _gui_python(), f'"{os.path.join(base_dir(), "run.py")}" {extra}'.strip()


def _ensure_admin_task():
    """Crea (o actualiza) la tarea programada que abre StellarHub elevado sin el aviso de UAC."""
    import subprocess
    exe, args = _launch_cmd("--from-task")
    tr = f'"{exe}" {args}'
    r = subprocess.run(["schtasks", "/create", "/tn", ADMIN_TASK, "/tr", tr, "/sc", "once", "/st", "00:00",
                        "/sd", "01/01/2000", "/rl", "highest", "/it", "/f"],
                       capture_output=True, text=True, creationflags=0x08000000)
    return r.returncode == 0


def _delete_admin_task():
    import subprocess
    subprocess.run(["schtasks", "/delete", "/tn", ADMIN_TASK, "/f"], capture_output=True, creationflags=0x08000000)


def _elevate_on_start():
    """Si el usuario eligió el modo administrador permanente y esta copia no lo es: se relanza elevada
    (primero por la tarea programada, sin aviso; si no existe, con el aviso de UAC). Devuelve True si hay que salir."""
    if is_admin() or "--no-elevate" in sys.argv or "--from-task" in sys.argv:
        return False
    try:
        with open(SETTINGS, encoding="utf-8") as fh:
            if not json.load(fh).get("alwaysAdmin"):
                return False
    except (OSError, ValueError):
        return False
    import subprocess
    r = subprocess.run(["schtasks", "/run", "/tn", ADMIN_TASK], capture_output=True, creationflags=0x08000000)
    if r.returncode == 0:
        return True
    exe, args = _launch_cmd("--no-elevate")
    if ctypes.windll.shell32.ShellExecuteW(None, "runas", exe, args, base_dir(), 1) > 32:
        return True
    return False  # dijo que no: sigue en modo normal


SINGLE_PORT = 47821  # una sola copia: la segunda le pide a la primera que se muestre y se cierra


def _already_running():
    import socket
    try:
        with socket.create_connection(("127.0.0.1", SINGLE_PORT), timeout=0.6) as s:
            s.sendall(b"show")
        return True
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
                    if conn.recv(16).startswith(b"show"):
                        api.show_main()
            except OSError:
                break
    threading.Thread(target=loop, daemon=True, name="single").start()


def _wait_for_previous():
    """--wait-pid N: al relanzarse como administrador, espera a que la copia anterior se haya cerrado."""
    if "--wait-pid" not in sys.argv:
        return
    try:
        pid = int(sys.argv[sys.argv.index("--wait-pid") + 1])
    except (IndexError, ValueError):
        return
    k32 = ctypes.windll.kernel32
    h = k32.OpenProcess(0x00100000, False, pid)  # SYNCHRONIZE
    if h:
        k32.WaitForSingleObject(h, 15000)
        k32.CloseHandle(h)


def main():
    _log_to_file()
    _wait_for_previous()
    if _already_running():
        return
    if _elevate_on_start():
        return
    if is_admin():
        try:
            with open(SETTINGS, encoding="utf-8") as fh:
                if json.load(fh).get("alwaysAdmin"):
                    threading.Thread(target=_ensure_admin_task, daemon=True).start()
        except (OSError, ValueError):
            pass
    try:
        ctypes.windll.shell32.SetCurrentProcessExplicitAppUserModelID(APP_ID)
    except Exception:
        pass
    import webview

    api = Api()
    title = "StellarHub" + ("  (administrador)" if is_admin() else "")
    from .chrome import Chrome

    start_hidden = "--tray" in sys.argv
    window = webview.create_window(
        title, url=os.path.join(UI_DIR, "index.html"), js_api=api,
        width=1600, height=960, min_size=(1100, 700), frameless=True, easy_drag=False, shadow=True,
        background_color=BG, text_select=False, hidden=start_hidden,
    )
    api._attach(window)

    def on_state(maxed):  # se llama desde el hilo de la ventana: nunca esperar aquí
        api._js(f"window.SH && SH.emit('win', {{max: {'true' if maxed else 'false'}}})")

    api._chrome = Chrome(window, on_state)
    window.events.shown += lambda: (api._chrome.setup(start_max=True), _grant_media(window))
    window.events.closing += api._on_closing

    from .tray import Tray
    try:
        api._tray = Tray(api)
        api._tray.start()
    except Exception as e:  # sin bandeja la app sigue funcionando; la X cierra del todo
        print("bandeja:", e)
        api._tray = None

    _listen_single(api)

    # motor: avisos de tareas largas y telemetría real
    from .engine import jobs
    jobs.set_emitter(lambda ev, data: api._js(f"window.SH && SH.emit({json.dumps(ev)}, {json.dumps(data)})"))
    try:
        from .engine.telemetry import Sampler
        api._sampler = Sampler(api._tele_push)
        rate = float(api.settings_get().get("teleRate") or 1000) / 1000
        api._sampler.set_rate(rate)
        api._visible = not start_hidden
        window.events.loaded += lambda: (api._sampler.start(), api._tele_refresh())
    except Exception as e:
        print("telemetría:", e)

    refresh_ui_cache()
    webview.start(gui="edgechromium", debug="--debug" in sys.argv, http_server=True,
                  private_mode=False, storage_path=WEB_DIR)
    if api._tray is not None:
        api._tray.stop()
