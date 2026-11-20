"""The start screen: a small card in the middle of the screen with the logo while StellarHub opens (like FL Studio's).

It appears right after the double click, long before the WebView2 window is ready, and fades out when the main window
shows up (app.py calls close() from Api.ui_ready). The first start can take a while (Windows describes the hardware),
so after a few seconds it says so.

A plain Win32 layered window with per-pixel alpha (rounded corners, soft shadow), drawn with Pillow and animated on
its own thread with its own message loop, so it never waits on the main window.
"""
import ctypes
import math
import ctypes.wintypes as wt
import os
import threading
import time

from PIL import Image, ImageDraw, ImageFilter, ImageFont

from . import VERSION
from .i18n import tr

# own instances of the DLLs: the argument types set here must not change how the rest of the app calls them
u32, g32, k32 = ctypes.WinDLL("user32"), ctypes.WinDLL("gdi32"), ctypes.WinDLL("kernel32")
WNDPROC = ctypes.WINFUNCTYPE(ctypes.c_ssize_t, wt.HWND, wt.UINT, wt.WPARAM, wt.LPARAM)


def _sig(fn, res, *args):
    fn.restype, fn.argtypes = res, list(args)


class BLENDFUNCTION(ctypes.Structure):
    _fields_ = [("BlendOp", ctypes.c_ubyte), ("BlendFlags", ctypes.c_ubyte), ("SourceConstantAlpha", ctypes.c_ubyte),
                ("AlphaFormat", ctypes.c_ubyte)]


_sig(u32.DefWindowProcW, ctypes.c_ssize_t, wt.HWND, wt.UINT, wt.WPARAM, wt.LPARAM)
_sig(u32.CreateWindowExW, wt.HWND, wt.DWORD, wt.LPCWSTR, wt.LPCWSTR, wt.DWORD, ctypes.c_int, ctypes.c_int, ctypes.c_int,
     ctypes.c_int, wt.HWND, wt.HMENU, wt.HINSTANCE, wt.LPVOID)
_sig(u32.GetDC, wt.HDC, wt.HWND)
_sig(u32.ReleaseDC, ctypes.c_int, wt.HWND, wt.HDC)
_sig(u32.UpdateLayeredWindow, wt.BOOL, wt.HWND, wt.HDC, ctypes.POINTER(wt.POINT), ctypes.POINTER(wt.SIZE), wt.HDC,
     ctypes.POINTER(wt.POINT), wt.COLORREF, ctypes.POINTER(BLENDFUNCTION), wt.DWORD)
_sig(u32.ShowWindow, wt.BOOL, wt.HWND, ctypes.c_int)
_sig(u32.DestroyWindow, wt.BOOL, wt.HWND)
_sig(u32.LoadCursorW, wt.HANDLE, wt.HINSTANCE, ctypes.c_void_p)
_sig(u32.PeekMessageW, wt.BOOL, ctypes.POINTER(wt.MSG), wt.HWND, wt.UINT, wt.UINT, wt.UINT)
_sig(u32.TranslateMessage, wt.BOOL, ctypes.POINTER(wt.MSG))
_sig(u32.DispatchMessageW, ctypes.c_ssize_t, ctypes.POINTER(wt.MSG))
_sig(u32.UnregisterClassW, wt.BOOL, wt.LPCWSTR, wt.HINSTANCE)
_sig(u32.SystemParametersInfoW, wt.BOOL, wt.UINT, wt.UINT, ctypes.c_void_p, wt.UINT)
_sig(k32.GetModuleHandleW, wt.HMODULE, wt.LPCWSTR)
_sig(g32.CreateCompatibleDC, wt.HDC, wt.HDC)
_sig(g32.CreateDIBSection, wt.HBITMAP, wt.HDC, ctypes.c_void_p, wt.UINT, ctypes.POINTER(ctypes.c_void_p), wt.HANDLE, wt.DWORD)
_sig(g32.SelectObject, wt.HGDIOBJ, wt.HDC, wt.HGDIOBJ)
_sig(g32.DeleteObject, wt.BOOL, wt.HGDIOBJ)
_sig(g32.DeleteDC, wt.BOOL, wt.HDC)


class WNDCLASSEXW(ctypes.Structure):
    _fields_ = [("cbSize", wt.UINT), ("style", wt.UINT), ("lpfnWndProc", WNDPROC), ("cbClsExtra", ctypes.c_int),
                ("cbWndExtra", ctypes.c_int), ("hInstance", wt.HINSTANCE), ("hIcon", wt.HICON), ("hCursor", wt.HANDLE),
                ("hbrBackground", wt.HBRUSH), ("lpszMenuName", wt.LPCWSTR), ("lpszClassName", wt.LPCWSTR), ("hIconSm", wt.HICON)]


class BITMAPINFOHEADER(ctypes.Structure):
    _fields_ = [("biSize", wt.DWORD), ("biWidth", ctypes.c_long), ("biHeight", ctypes.c_long), ("biPlanes", wt.WORD),
                ("biBitCount", wt.WORD), ("biCompression", wt.DWORD), ("biSizeImage", wt.DWORD), ("biXPelsPerMeter", ctypes.c_long),
                ("biYPelsPerMeter", ctypes.c_long), ("biClrUsed", wt.DWORD), ("biClrImportant", wt.DWORD)]


_state ={"thread": None, "closing": None, "hwnd": None, "status": ""}
_lock = threading.Lock()


def _font(name, size):
    try:
        return ImageFont.truetype(os.path.join(os.environ.get("WINDIR", r"C:\Windows"), "Fonts", name), size)
    except OSError:
        return ImageFont.load_default()


def _brand_font(size):
    """The name in the app's brand face (Unbounded 500, bundled with the UI), like the top bar and the installer."""
    try:
        f = ImageFont.truetype(os.path.join(os.path.dirname(os.path.abspath(__file__)), "ui", "fonts", "unbounded-latin.woff2"), size)
        try:
            f.set_variation_by_axes([500])
        except (OSError, AttributeError):
            pass
        return f
    except OSError:
        return _font("seguisb.ttf", size)


class _Card:
    """The start screen: the StellarHub logo floating on the desktop (no card behind it), its name, a comet sweeping
    a thin track and the status line. A soft shadow under everything keeps it readable on light wallpapers too.
    The version and its codename hide on the planet, small. Everything static is drawn once; per frame only the
    comet and the status line. ImageDraw REPLACES pixels, alpha included, so every translucent thing is drawn on
    its own transparent layer and composited."""

    def __init__(self, scale):
        s = self.s = scale
        W, H = int(380 * s), int(340 * s)
        self.size = (W, H)
        base = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        cx = W // 2
        logo_size = int(176 * s)
        ly = int(26 * s)
        # a dark halo, very soft: no edge, no shape, only enough to separate the logo and the text from the desktop
        halo = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        hd = ImageDraw.Draw(halo)
        hd.ellipse((cx - int(110 * s), int(24 * s), cx + int(110 * s), int(214 * s)), fill=(5, 8, 18, 135))   # the logo
        hd.rounded_rectangle((cx - int(135 * s), int(222 * s), cx + int(135 * s), int(312 * s)), radius=int(40 * s), fill=(5, 8, 18, 120))  # name, bar, status
        base.alpha_composite(halo.filter(ImageFilter.GaussianBlur(int(26 * s))))
        # a warm glow behind the planet
        glow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        gy, gr = ly + int(logo_size * .53), int(58 * s)
        ImageDraw.Draw(glow).ellipse((cx - gr, gy - gr, cx + gr, gy + gr), fill=(255, 122, 102, 70))
        base.alpha_composite(glow.filter(ImageFilter.GaussianBlur(int(30 * s))))
        # the logo, with the version on the planet
        try:
            from .tray import make_icon_image
            logo = make_icon_image(logo_size, tile=False).convert("RGBA")
            shadow = Image.new("RGBA", logo.size, (0, 0, 0, 0))
            shadow.putalpha(logo.getchannel("A").point(lambda a: a * 90 // 255))
            base.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(int(8 * s))), (cx - logo.width // 2, ly + int(6 * s)))
            tag = Image.new("RGBA", logo.size, (0, 0, 0, 0))
            td = ImageDraw.Draw(tag)
            pcx, pcy, pr = logo.width / 2, logo.height * .53, logo.width * .2   # make_icon_image's planet (large tier)
            try:
                from . import CODENAME
            except ImportError:
                CODENAME = ""
            td.text((pcx, pcy - pr * .42), CODENAME, font=_brand_font(max(7, int(9 * s))), fill=(70, 22, 18, 150), anchor="mm")
            td.text((pcx, pcy - pr * .1), VERSION, font=_font("seguisb.ttf", max(7, int(8 * s))), fill=(70, 22, 18, 120), anchor="mm")
            logo.alpha_composite(tag)
            base.alpha_composite(logo, (cx - logo.width // 2, ly))
            self.logo_at = (cx - logo.width // 2, ly, logo.width)
        except Exception:
            pass
        # the name, with its own soft shadow
        name_y = ly + logo_size + int(14 * s)
        name = _brand_font(int(26 * s))
        sh = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        ImageDraw.Draw(sh).text((cx, name_y + int(2 * s)), "StellarHub", font=name, fill=(0, 0, 0, 200), anchor="mm")
        base.alpha_composite(sh.filter(ImageFilter.GaussianBlur(int(5 * s))))
        txt = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        ImageDraw.Draw(txt).text((cx, name_y), "StellarHub", font=name, fill=(240, 244, 251, 255), anchor="mm")
        base.alpha_composite(txt)
        self.base = base
        self.small = _font("segoeui.ttf", int(12 * s))
        self.status_x, self.status_y = cx, name_y + int(34 * s)

    def frame(self, t, status):
        """The loading indicator is the planet's ring: a light runs around it with a glowing trail, hidden by the
        planet while it passes behind. Same geometry as tray.make_icon_image (large tier): center (.5, .53), radii
        .385 x .135 of the logo minus half the ring width (.064), tilted 20 degrees; the half above the center is
        the back of the ring."""
        im = self.base.copy()
        if getattr(self, "logo_at", None):
            lx, ly, n = self.logo_at
            cx, cy, pr = n * .5, n * .53, n * .2
            rw = n * .064
            rx, ry = n * .385 - rw / 2, n * .135 - rw / 2
            head = (t * 1.15) % 1.0 * 2 * math.pi           # one turn every ~0.87 s
            trail = 2.3                                      # radians of glowing trail behind the head
            glow = Image.new("RGBA", (n, n), (0, 0, 0, 0))
            core = Image.new("RGBA", (n, n), (0, 0, 0, 0))
            gd, cd = ImageDraw.Draw(glow), ImageDraw.Draw(core)
            steps = 64
            for i in range(steps, -1, -1):                   # from the end of the trail to the head
                f = 1 - i / steps                            # 0 at the end of the trail, 1 at the head
                a = head - trail * (1 - f)
                x, y = cx + rx * math.cos(a), cy + ry * math.sin(a)
                if y < cy and math.hypot(x - cx, y - cy) < pr * .98:
                    continue                                 # behind the planet
                w = f ** 2.2
                r = rw * (.38 + .2 * w)
                col = (int(200 + 55 * w), int(232 - 60 * w ** 3), int(255 - 100 * w ** 3))
                cd.ellipse((x - r, y - r, x + r, y + r), fill=col + (int(40 + 200 * w),))
                rg = rw * (.9 + 1.1 * w)
                gd.ellipse((x - rg, y - rg, x + rg, y + rg), fill=(255, 150, 125, int(70 * w)) if w > .7 else (170, 220, 255, int(60 * w)))
            hx, hy = cx + rx * math.cos(head), cy + ry * math.sin(head)
            if not (hy < cy and math.hypot(hx - cx, hy - cy) < pr * .98):
                r = rw * .55
                cd.ellipse((hx - r, hy - r, hx + r, hy + r), fill=(255, 246, 240, 255))
            glow = glow.filter(ImageFilter.GaussianBlur(max(2, rw * .9)))
            glow.alpha_composite(core)
            glow = glow.rotate(20, resample=Image.BICUBIC, center=(cx, cy))
            im.alpha_composite(glow, (lx, ly))
        if status:
            s = self.s
            st = Image.new("RGBA", im.size, (0, 0, 0, 0))
            ImageDraw.Draw(st).text((self.status_x, self.status_y + 1), status, font=self.small, fill=(0, 0, 0, 210), anchor="mm")
            im.alpha_composite(st.filter(ImageFilter.GaussianBlur(int(3 * s))))
            tx = Image.new("RGBA", im.size, (0, 0, 0, 0))
            ImageDraw.Draw(tx).text((self.status_x, self.status_y), status, font=self.small, fill=(232, 238, 248, 200), anchor="mm")
            im.alpha_composite(tx)
        return im


def _blit(hwnd, img, alpha, pos):
    """Puts an RGBA image on the layered window (premultiplied BGRA, as UpdateLayeredWindow wants)."""
    w, h = img.size
    raw = img.convert("RGBa").tobytes("raw", "BGRa")
    bmi = BITMAPINFOHEADER(ctypes.sizeof(BITMAPINFOHEADER), w, -h, 1, 32, 0, 0, 0, 0, 0, 0)
    bits = ctypes.c_void_p()
    screen = u32.GetDC(None)
    mem = g32.CreateCompatibleDC(screen)
    bmp = g32.CreateDIBSection(screen, ctypes.byref(bmi), 0, ctypes.byref(bits), None, 0)
    try:
        ctypes.memmove(bits, raw, len(raw))
        old = g32.SelectObject(mem, bmp)
        blend = BLENDFUNCTION(0, 0, max(0, min(255, int(alpha))), 1)
        u32.UpdateLayeredWindow(hwnd, screen, ctypes.byref(wt.POINT(*pos)), ctypes.byref(wt.SIZE(w, h)), mem,
                                ctypes.byref(wt.POINT(0, 0)), 0, ctypes.byref(blend), 2)
        g32.SelectObject(mem, old)
    finally:
        g32.DeleteObject(bmp)
        g32.DeleteDC(mem)
        u32.ReleaseDC(None, screen)


def _run(ready):
    try:
        dpi = u32.GetDpiForSystem() if hasattr(u32, "GetDpiForSystem") else 96
    except Exception:
        dpi = 96
    card = _Card(dpi / 96)
    wa = wt.RECT()
    u32.SystemParametersInfoW(0x0030, 0, ctypes.byref(wa), 0)  # work area of the primary monitor
    W, H = card.size
    pos = (wa.left + (wa.right - wa.left - W) // 2, wa.top + (wa.bottom - wa.top - H) // 2 - int(20 * dpi / 96))

    proc = WNDPROC(lambda h, m, w, l: u32.DefWindowProcW(h, m, w, l))
    hinst = k32.GetModuleHandleW(None)
    wc = WNDCLASSEXW(ctypes.sizeof(WNDCLASSEXW), 0, proc, 0, 0, hinst, None, u32.LoadCursorW(None, 32514),
                     None, None, "StellarHubSplash", None)  # IDC_APPSTARTING: the arrow with the little wheel
    u32.RegisterClassExW(ctypes.byref(wc))
    # layered + tool window (no taskbar button) + topmost, as start screens are
    hwnd = u32.CreateWindowExW(0x00080000 | 0x00000080 | 0x00000008, "StellarHubSplash", "StellarHub", 0x80000000,
                               pos[0], pos[1], W, H, None, None, hinst, None)
    _state["hwnd"] = hwnd
    t0 = time.monotonic()
    _blit(hwnd, card.frame(0, ""), 0, pos)
    u32.ShowWindow(hwnd, 4)  # SW_SHOWNOACTIVATE: the user's current window keeps the focus
    ready.set()
    msg = wt.MSG()
    fade_in, fade_out = .22, .28
    closing_at = None
    while True:
        while u32.PeekMessageW(ctypes.byref(msg), None, 0, 0, 1):
            u32.TranslateMessage(ctypes.byref(msg))
            u32.DispatchMessageW(ctypes.byref(msg))
        now = time.monotonic() - t0
        if _state["closing"] is not None and closing_at is None:
            closing_at = now
        if now > 6 and not _state["status"]:
            _state["status"] = tr("Getting to know your PC. The first start takes a little longer.")
        alpha = 255 * min(1, now / fade_in)
        if closing_at is not None:
            k = (now - closing_at) / fade_out
            if k >= 1:
                break
            alpha *= 1 - k * k
        try:
            _blit(hwnd, card.frame(now, _state["status"]), alpha, pos)
        except Exception:
            pass
        time.sleep(1 / 40)
    u32.DestroyWindow(hwnd)
    u32.UnregisterClassW("StellarHubSplash", hinst)
    _state["hwnd"] = None
    del proc


def show():
    """Shows the start screen (once). Returns right away; the card lives on its own thread."""
    with _lock:
        if _state["thread"] is not None:
            return
        ready = threading.Event()
        th = threading.Thread(target=_run, args=(ready,), name="splash", daemon=True)
        _state["thread"] = th
        th.start()
    ready.wait(2)


def status(text):
    _state["status"] = text or ""


def close():
    """Fades the start screen out (a no-op if it isn't showing)."""
    th = _state["thread"]
    if th is None:
        return
    _state["closing"] = True


def other_showing():
    """True if a start screen of ANOTHER StellarHub process is on screen (the copy this one hands over to)."""
    found = []

    @ctypes.WINFUNCTYPE(wt.BOOL, wt.HWND, wt.LPARAM)
    def cb(h, _):
        buf = ctypes.create_unicode_buffer(32)
        u32.GetClassNameW(h, buf, 32)
        if buf.value == "StellarHubSplash" and h != _state["hwnd"] and u32.IsWindowVisible(h):
            found.append(h)
        return True
    try:
        u32.EnumWindows(cb, 0)
    except Exception:
        return False
    return bool(found)


def showing():
    th = _state["thread"]
    return bool(th and th.is_alive())
