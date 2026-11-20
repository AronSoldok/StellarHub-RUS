"""The start screen: a small card in the middle of the screen with the logo while StellarHub opens (like FL Studio's).

It appears right after the double click, long before the WebView2 window is ready, and fades out when the main window
shows up (app.py calls close() from Api.ui_ready). The first start can take a while (Windows describes the hardware),
so after a few seconds it says so.

A plain Win32 layered window with per-pixel alpha (rounded corners, soft shadow), drawn with Pillow and animated on
its own thread with its own message loop, so it never waits on the main window.
"""
import ctypes
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
    """Draws the card: everything static once, then the moving bar and the status line per frame."""

    def __init__(self, scale):
        s = self.s = scale
        self.cw, self.ch, self.pad = int(400 * s), int(250 * s), int(36 * s)
        W, H = self.cw + 2 * self.pad, self.ch + 2 * self.pad
        self.size = (W, H)
        base = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        # soft shadow
        sh = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        ImageDraw.Draw(sh).rounded_rectangle((self.pad, self.pad + int(8 * s), self.pad + self.cw, self.pad + self.ch + int(8 * s)),
                                             radius=int(24 * s), fill=(0, 0, 0, 150))
        base.alpha_composite(sh.filter(ImageFilter.GaussianBlur(int(16 * s))))
        # the card: deep space gradient, a warm glow behind the logo, a hairline border
        card = Image.new("RGBA", (self.cw, self.ch))
        top, bottom = (17, 27, 52), (6, 10, 20)
        d = ImageDraw.Draw(card)
        for y in range(self.ch):
            f = y / max(1, self.ch - 1)
            d.line((0, y, self.cw, y), fill=tuple(int(top[i] + (bottom[i] - top[i]) * f) for i in range(3)) + (255,))
        glow = Image.new("RGBA", card.size, (0, 0, 0, 0))
        gx, gy, gr = self.cw // 2, int(92 * s), int(70 * s)
        ImageDraw.Draw(glow).ellipse((gx - gr, gy - gr, gx + gr, gy + gr), fill=(255, 122, 102, 60))
        card.alpha_composite(glow.filter(ImageFilter.GaussianBlur(int(34 * s))))
        mask = Image.new("L", card.size, 0)
        ImageDraw.Draw(mask).rounded_rectangle((0, 0, self.cw - 1, self.ch - 1), radius=int(22 * s), fill=255)
        card.putalpha(mask)
        # ImageDraw REPLACES pixels (alpha included): anything translucent is drawn on its own transparent layer and
        # composited, or it would punch see-through holes in the card
        edge = Image.new("RGBA", card.size, (0, 0, 0, 0))
        ImageDraw.Draw(edge).rounded_rectangle((0, 0, self.cw - 1, self.ch - 1), radius=int(22 * s),
                                               outline=(158, 214, 255, 38), width=max(1, int(s)))
        card.alpha_composite(edge)
        # logo, name, version
        try:
            from .tray import make_icon_image
            logo = make_icon_image(int(86 * s), tile=False).convert("RGBA")
            card.alpha_composite(logo, (self.cw // 2 - logo.width // 2, gy - logo.height // 2))
        except Exception:
            pass
        txt = Image.new("RGBA", card.size, (0, 0, 0, 0))
        d = ImageDraw.Draw(txt)
        name = _brand_font(int(22 * s))
        d.text((self.cw // 2, int(160 * s)), "StellarHub", font=name, fill=(233, 238, 247, 255), anchor="mm")
        d.text((self.cw - int(16 * s), self.ch - int(14 * s)), VERSION, font=_font("segoeui.ttf", int(11 * s)),
               fill=(232, 238, 248, 90), anchor="rs")
        card.alpha_composite(txt)
        base.alpha_composite(card, (self.pad, self.pad))
        self.base = base
        self.small = _font("segoeui.ttf", int(12 * s))
        self.bar = (self.pad + self.cw // 2 - int(80 * s), self.pad + int(186 * s), int(160 * s), max(2, int(3 * s)))

    def frame(self, t, status):
        im = self.base.copy()
        layer = Image.new("RGBA", im.size, (0, 0, 0, 0))  # drawn apart and composited: see _Card.__init__
        d = ImageDraw.Draw(layer)
        x, y, w, h = self.bar
        d.rounded_rectangle((x, y, x + w, y + h), radius=h, fill=(232, 238, 248, 22))
        seg = int(w * .36)
        pos = int((t * .9 % 1.6 - .3) * w)  # an indeterminate sweep, like the app's loading bars
        a, b = max(x, x + pos), min(x + w, x + pos + seg)
        if b > a:
            for i in range(a, b):  # ice blue to coral
                f = (i - (x + pos)) / max(1, seg)
                col = (int(158 + (255 - 158) * f), int(214 + (122 - 214) * f), int(255 + (102 - 255) * f), 235)
                d.line((i, y, i, y + h - 1), fill=col)
        if status:
            d.text((x + w // 2, y + int(24 * self.s)), status, font=self.small, fill=(232, 238, 248, 140), anchor="mm")
        im.alpha_composite(layer)
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
