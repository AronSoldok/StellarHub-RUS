"""Icono de StellarHub en la bandeja del sistema (pystray), con su menú."""
import threading

from PIL import Image, ImageDraw


def make_icon_image(size=64):
    """El logo dibujado: planeta coral con su anillo hielo, sobre transparente."""
    s = size * 4  # se dibuja grande y se reduce para que quede suave
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    ring = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    rd = ImageDraw.Draw(ring)
    rd.ellipse((s * .06, s * .33, s * .94, s * .67), outline=(158, 214, 255, 255), width=int(s * .07))
    ring = ring.rotate(24, resample=Image.BICUBIC)
    img.alpha_composite(ring)
    r = s * .25
    d.ellipse((s / 2 - r, s / 2 - r, s / 2 + r, s / 2 + r), fill=(255, 122, 102, 255))
    d.ellipse((s * .78, s * .26, s * .9, s * .38), fill=(158, 214, 255, 255))
    return img.resize((size, size), Image.LANCZOS)


class Tray:
    def __init__(self, api):
        self.api = api
        self.icon = None

    def start(self):
        import pystray
        from pystray import Menu, MenuItem as Item

        a = self.api

        def go(mod, tab=None):
            def run(icon, item):
                a.show_main()
                t = f", {{tab: '{tab}'}}" if tab else ""
                a._js(f"SH.go('{mod}'{t})")
            return run

        menu = Menu(
            Item("Abrir StellarHub", lambda i, it: a.show_main(), default=True),
            Item("Widget siempre visible", lambda i, it: a.widget_toggle(), checked=lambda it: a._widget is not None),
            Menu.SEPARATOR,
            Item("Live Monitor", go("monitor")),
            Item("Optimizar todo", go("optimizer", "overview")),
            Item("Buscar actualizaciones", go("updater", "overview")),
            Item("Analizar el disco", go("storage", "map")),
            Menu.SEPARATOR,
            Item("Activar el modo administrador", lambda i, it: a.relaunch_admin(), visible=lambda it: not a.info()["admin"]),
            Item("Ajustes", lambda i, it: (a.show_main(), a._js("SH.go('settings')"))),
            Menu.SEPARATOR,
            Item("Salir de StellarHub", lambda i, it: a.quit()),
        )
        self.icon = pystray.Icon("StellarHub", make_icon_image(), "StellarHub", menu)
        threading.Thread(target=self.icon.run, daemon=True, name="tray").start()

    def notify(self, text, title="StellarHub"):
        try:
            self.icon and self.icon.notify(text, title)
        except Exception:
            pass

    def refresh(self):
        try:
            self.icon and self.icon.update_menu()
        except Exception:
            pass

    def stop(self):
        try:
            self.icon and self.icon.stop()
        except Exception:
            pass
