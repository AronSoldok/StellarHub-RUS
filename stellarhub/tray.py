"""StellarHub icon in the system tray (pystray), with its menu."""
import threading

from PIL import Image, ImageDraw


def make_icon_image(size=64):
    """The drawn logo: a coral planet with its ice ring, on a transparent background."""
    s = size * 4  # drawn large and scaled down so it looks smooth
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
            Item("Open StellarHub", lambda i, it: a.show_main(), default=True),
            Item("Always-on-top widget", lambda i, it: a.widget_toggle(), checked=lambda it: a._widget is not None),
            Menu.SEPARATOR,
            Item("Live Monitor", go("monitor")),
            Item("Optimize everything", go("optimizer", "overview")),
            Item("Check for updates", go("updater", "overview")),
            Item("Analyze the disk", go("storage", "map")),
            Menu.SEPARATOR,
            Item("Turn on administrator mode", lambda i, it: a.relaunch_admin(), visible=lambda it: not a.info()["admin"]),
            Item("Settings", lambda i, it: (a.show_main(), a._js("SH.go('settings')"))),
            Menu.SEPARATOR,
            Item("Quit StellarHub", lambda i, it: a.quit()),
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
