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

from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont

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
    """The start screen: the StellarHub logo floating on the desktop in a soft patch of space (a warm glow behind the
    planet, a cool one toward the moon, a few faint stars fading out), its name and the status line. The planet's
    ring is the loading indicator: a light runs around it, hidden by the planet while it passes behind. The version
    and its codename are engraved on the planet. Everything is drawn at twice the size and scaled down (smooth
    edges); the static scene once, per frame only the light and the status line. ImageDraw REPLACES pixels (alpha
    included): translucent things are drawn on their own transparent layer and composited."""

    SS = 2  # supersampling

    def __init__(self, scale):
        s = self.s = scale
        W, H = int(700 * s), int(640 * s)
        self.size = (W, H)
        cx = W // 2
        n = self.n = int(340 * s)                          # logo size
        lx, ly = cx - n // 2, int(58 * s)
        self.logo_at = (lx, ly)
        base = Image.new("RGBA", (W, H), (0, 0, 0, 0))

        # --- the patch of space: dark enough to read on a light wallpaper, no edges anywhere
        sky = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        sd = ImageDraw.Draw(sky)
        sd.ellipse((cx - int(215 * s), int(70 * s), cx + int(215 * s), int(560 * s)), fill=(6, 9, 20, 246))  # near-opaque: text behind doesn't show
        base.alpha_composite(sky.filter(ImageFilter.GaussianBlur(int(46 * s))))
        neb = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        nd = ImageDraw.Draw(neb)
        pcx, pcy = cx, ly + n * .53
        r = int(130 * s)
        nd.ellipse((pcx - r, pcy - r, pcx + r, pcy + r), fill=(255, 112, 92, 64))               # warm, behind the planet
        r2 = int(90 * s)
        mx, my = cx + n * .30, ly + n * .16
        nd.ellipse((mx - r2, my - r2, mx + r2, my + r2), fill=(120, 190, 255, 40))               # cool, toward the moon
        base.alpha_composite(neb.filter(ImageFilter.GaussianBlur(int(55 * s))))
        import random
        rnd = random.Random(7)
        stars = Image.new("RGBA", (W * 2, H * 2), (0, 0, 0, 0))
        st = ImageDraw.Draw(stars)
        for _ in range(46):
            a, d = rnd.uniform(0, 6.283), rnd.uniform(.32, 1.0)
            x = cx + math.cos(a) * d * 215 * s
            y = ly + n * .62 + math.sin(a) * d * 230 * s
            fade = (1 - d) ** .8
            rr = rnd.choice((.7, .9, 1.1, 1.5)) * s
            st.ellipse((2 * (x - rr), 2 * (y - rr), 2 * (x + rr), 2 * (y + rr)), fill=(225, 238, 255, int(40 + 170 * fade)))
        base.alpha_composite(stars.resize((W, H), Image.LANCZOS))

        # --- the logo, textured, with the version engraved on the planet
        try:
            from .tray import make_icon_image
            logo = make_icon_image(n, tile=False).convert("RGBA")
            logo = self._texture(logo)
            shadow = Image.new("RGBA", logo.size, (0, 0, 0, 0))
            shadow.putalpha(logo.getchannel("A").point(lambda v: v * 120 // 255))
            base.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(int(14 * s))), (lx, ly + int(10 * s)))
            base.alpha_composite(logo, (lx, ly))
        except Exception as e:
            print("splash logo:", e)

        # --- the name, with a real shadow
        self.name_y = name_y = ly + n + int(18 * s)
        name = _brand_font(int(46 * s))
        self._shadowed(base, (cx, name_y), "StellarHub", name, (243, 246, 252, 255), dy=int(4 * s), blur=int(9 * s), a=235)
        self.small = _font("segoeui.ttf", int(17 * s))
        self.status_xy = (cx, name_y + int(40 * s))
        # nothing may end in a hard edge: everything fades out before the window's border
        fade = Image.new("L", (W, H), 0)
        ImageDraw.Draw(fade).ellipse((int(40 * s), int(30 * s), W - int(40 * s), H - int(30 * s)), fill=255)
        self.fade = fade = fade.filter(ImageFilter.GaussianBlur(int(48 * s)))
        base.putalpha(ImageChops.multiply(base.getchannel("A"), fade))
        self.base = base

    def _texture(self, logo):
        """Soft gas-giant bands on the planet, fine grooves on the ring, and the version engraved on the planet."""
        n = logo.width
        cx, cy, pr = n * .5, n * .53, n * .2
        A = logo.getchannel("A")
        px = logo.load()
        # planet / ring masks from the colors: the planet is warm (red > blue), the ring cool (blue > red)
        warm = Image.new("L", logo.size, 0)
        cool = Image.new("L", logo.size, 0)
        wp, cp = warm.load(), cool.load()
        for y in range(n):
            for x in range(n):
                r, g, b, a = px[x, y]
                if a > 8:
                    if r > b + 20 and math.hypot(x - cx, y - cy) <= pr + 1:
                        wp[x, y] = a
                    elif b > r + 10:
                        cp[x, y] = a
        tex = Image.new("RGBA", logo.size, (0, 0, 0, 0))
        td = ImageDraw.Draw(tex)
        import random
        rnd = random.Random(3)
        y = cy - pr
        while y < cy + pr:                                   # bands: uneven widths, a little tilted below
            h = rnd.uniform(.035, .09) * pr
            td.rectangle((cx - pr, y, cx + pr, y + h), fill=(120, 30, 30, rnd.choice((0, 14, 22, 30))))
            y += h
        tex = tex.rotate(-12, resample=Image.BICUBIC, center=(cx, cy)).filter(ImageFilter.GaussianBlur(n * .004))
        bands = Image.new("RGBA", logo.size, (0, 0, 0, 0))
        bands.alpha_composite(tex)
        bands.putalpha(ImageChops.multiply(bands.getchannel("A"), warm))
        logo.alpha_composite(bands)
        grooves = Image.new("RGBA", logo.size, (0, 0, 0, 0))
        gd = ImageDraw.Draw(grooves)
        rx, ry, rw = n * .385, n * .135, n * .064
        k = 0.0
        while k < rw:                                        # fine concentric grooves across the ring's width
            gd.ellipse((cx - rx + k, cy - ry + k, cx + rx - k, cy + ry - k), outline=(20, 50, 90, 46 if int(k / (rw / 7)) % 2 else 18), width=max(1, int(n * .003)))
            k += rw / 7
        grooves = grooves.rotate(20, resample=Image.BICUBIC, center=(cx, cy))
        grooves.putalpha(ImageChops.multiply(grooves.getchannel("A"), cool))
        logo.alpha_composite(grooves)
        # the version, engraved: a dark cut with a faint light edge under it, on the visible half of the planet
        try:
            from . import CODENAME
        except ImportError:
            CODENAME = ""
        eng = Image.new("RGBA", logo.size, (0, 0, 0, 0))
        ed = ImageDraw.Draw(eng)
        f1, f2 = _brand_font(max(8, int(n * .052))), _font("seguisb.ttf", max(8, int(n * .04)))
        for (txt, f, yy) in ((CODENAME, f1, cy - pr * .46), (VERSION, f2, cy - pr * .17)):
            ed.text((cx, yy + n * .004), txt, font=f, fill=(255, 210, 196, 90), anchor="mm")     # light edge
            ed.text((cx, yy), txt, font=f, fill=(92, 24, 22, 150), anchor="mm")                 # the cut
        eng.putalpha(ImageChops.multiply(eng.getchannel("A"), warm))
        logo.alpha_composite(eng)
        self.planet_mask = warm
        return logo

    def _shadowed(self, img, xy, text, font, fill, dy, blur, a):
        W, H = img.size
        sh = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        ImageDraw.Draw(sh).text((xy[0], xy[1] + dy), text, font=font, fill=(0, 0, 0, a), anchor="mm")
        img.alpha_composite(sh.filter(ImageFilter.GaussianBlur(blur)))
        tx = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        ImageDraw.Draw(tx).text(xy, text, font=font, fill=fill, anchor="mm")
        img.alpha_composite(tx)

    LEVELS = 16

    def _sprites(self):
        """Soft glow and crisp core dots, pre-rendered at several intensities (ice at the tail, coral near the head),
        drawn 4x larger and scaled down in premultiplied color (no dark fringe), with room for the whole blur."""
        n = self.n
        rw = n * .064
        self.margin = int(rw * 4)
        self._glow, self._core = [], []

        def sprite(radius, color, blur):
            size = int(2 * radius + 6 * blur + 4) | 1
            im = Image.new("RGBA", (size * 4, size * 4), (0, 0, 0, 0))
            c = size * 2
            ImageDraw.Draw(im).ellipse((c - radius * 4, c - radius * 4, c + radius * 4, c + radius * 4), fill=color)
            if blur:
                im = im.filter(ImageFilter.GaussianBlur(blur * 4))
            return im.convert("RGBa").resize((size, size), Image.LANCZOS).convert("RGBA")

        for i in range(self.LEVELS + 1):
            w = i / self.LEVELS
            gcol = (255, 140, 118, int(78 * w)) if w > .55 else (160, 214, 255, int(58 * w))
            self._glow.append(sprite(rw * (.8 + 1.1 * w), gcol, rw * .9))
            ccol = (int(205 + 50 * w), int(234 - 70 * w ** 3), int(255 - 110 * w ** 3), int(235 * w))
            self._core.append(sprite(rw * (.3 + .2 * w), ccol, 0))
        self._headspr = sprite(rw * .5, (255, 248, 242, 255), 0)
        m = self.margin
        hole = Image.new("L", ((n + 2 * m) * 4, (n + 2 * m) * 4), 255)
        cx, cy, pr = (m + n * .5) * 4, (m + n * .53) * 4, n * .2 * 4
        ImageDraw.Draw(hole).ellipse((cx - pr, cy - pr, cx + pr, cy + pr), fill=0)
        self._hole = hole.resize((n + 2 * m, n + 2 * m), Image.LANCZOS)

    def frame(self, t, status):
        """The ring's light: same geometry as tray.make_icon_image (center (.5, .53), radii .385 x .135 minus half
        the ring width .064, tilted 20 degrees). Only the stretch of the back half that is behind the planet goes
        on the masked layer, so there is no seam where the halves meet; the trail fades to nothing."""
        if not hasattr(self, "_glow"):
            self._sprites()
        im = self.base.copy()
        n, m = self.n, self.margin
        N = n + 2 * m
        cx, cy, pr = m + n * .5, m + n * .53, n * .2
        rw = n * .064
        rx, ry = n * .385 - rw / 2, n * .135 - rw / 2
        ca, sa = math.cos(math.radians(20)), math.sin(math.radians(20))
        head = (t * .42) % 1.0 * 2 * math.pi
        trail, steps = 2.6, 150
        hidden = Image.new("RGBA", (N, N), (0, 0, 0, 0))   # what passes behind the planet
        shown = Image.new("RGBA", (N, N), (0, 0, 0, 0))

        def put(layer, spr, x, y):
            layer.alpha_composite(spr, (int(round(x - spr.width / 2)), int(round(y - spr.height / 2))))

        pts = []
        for i in range(steps, -1, -1):
            f = 1 - i / steps
            a = head - trail * (1 - f)
            dx, dy = rx * math.cos(a), ry * math.sin(a)
            x, y = cx + dx * ca + dy * sa, cy - dx * sa + dy * ca      # same rotation as Image.rotate(20)
            behind = dy < 0 and abs(dx) < pr * 1.15                    # only near the planet can it be hidden
            pts.append((f, behind, x, y))
        for f, behind, x, y in pts[::3]:
            lvl = int(round(f ** 2.2 * self.LEVELS))
            if lvl:
                put(hidden if behind else shown, self._glow[lvl], x, y)
        for f, behind, x, y in pts:
            lvl = int(round(f ** 2.2 * self.LEVELS))
            if lvl:
                put(hidden if behind else shown, self._core[lvl], x, y)
        f, behind, x, y = pts[-1]
        put(hidden if behind else shown, self._headspr, x, y)
        hidden.putalpha(ImageChops.multiply(hidden.getchannel("A"), self._hole))
        hidden.alpha_composite(shown)
        lx, ly = self.logo_at
        layer = Image.new("RGBA", im.size, (0, 0, 0, 0))
        layer.alpha_composite(hidden, (lx - m, ly - m))
        layer.putalpha(ImageChops.multiply(layer.getchannel("A"), self.fade))
        im.alpha_composite(layer)
        if status:
            self._shadowed(im, self.status_xy, status, self.small, (236, 241, 249, 228), dy=int(2 * self.s), blur=int(4 * self.s), a=235)
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
    try:  # this thread draws at the real pixel size (otherwise Windows stretches the window at 125 %/150 %)
        u32.SetThreadDpiAwarenessContext(ctypes.c_void_p(-4))  # PER_MONITOR_AWARE_V2
    except (AttributeError, OSError):
        pass
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
        time.sleep(1 / 60)
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
