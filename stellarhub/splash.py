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
_sig(u32.SetWindowTextW, wt.BOOL, wt.HWND, wt.LPCWSTR)
_sig(u32.GetWindowTextW, ctypes.c_int, wt.HWND, wt.LPWSTR, ctypes.c_int)
_sig(u32.GetClassNameW, ctypes.c_int, wt.HWND, wt.LPWSTR, ctypes.c_int)
_sig(u32.IsWindowVisible, wt.BOOL, wt.HWND)
_sig(u32.ShowWindowAsync, wt.BOOL, wt.HWND, ctypes.c_int)
_sig(u32.GetWindowThreadProcessId, wt.DWORD, wt.HWND, ctypes.POINTER(wt.DWORD))
_sig(u32.PostMessageW, wt.BOOL, wt.HWND, wt.UINT, wt.WPARAM, wt.LPARAM)
_sig(u32.MsgWaitForMultipleObjects, wt.DWORD, wt.DWORD, ctypes.c_void_p, wt.BOOL, wt.DWORD, wt.DWORD)


class WNDCLASSEXW(ctypes.Structure):
    _fields_ = [("cbSize", wt.UINT), ("style", wt.UINT), ("lpfnWndProc", WNDPROC), ("cbClsExtra", ctypes.c_int),
                ("cbWndExtra", ctypes.c_int), ("hInstance", wt.HINSTANCE), ("hIcon", wt.HICON), ("hCursor", wt.HANDLE),
                ("hbrBackground", wt.HBRUSH), ("lpszMenuName", wt.LPCWSTR), ("lpszClassName", wt.LPCWSTR), ("hIconSm", wt.HICON)]


class BITMAPINFOHEADER(ctypes.Structure):
    _fields_ = [("biSize", wt.DWORD), ("biWidth", ctypes.c_long), ("biHeight", ctypes.c_long), ("biPlanes", wt.WORD),
                ("biBitCount", wt.WORD), ("biCompression", wt.DWORD), ("biSizeImage", wt.DWORD), ("biXPelsPerMeter", ctypes.c_long),
                ("biYPelsPerMeter", ctypes.c_long), ("biClrUsed", wt.DWORD), ("biClrImportant", wt.DWORD)]


_state = {"thread": None, "closing": None, "hwnd": None, "status": "", "handing": False, "handed": False,
          "titled": False}
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
        W, H = int(720 * s), int(640 * s)
        self.size = (W, H)
        cx = W // 2
        n = self.n = int(340 * s)                          # logo size
        lx, ly = cx - n // 2, int(84 * s)
        self.logo_at = (lx, ly)
        base = Image.new("RGBA", (W, H), (0, 0, 0, 0))

        # --- the patch of space: dark enough to read on a light wallpaper, no edges anywhere
        sky = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        sd = ImageDraw.Draw(sky)
        sd.ellipse((cx - int(225 * s), int(92 * s), cx + int(225 * s), int(548 * s)), fill=(6, 9, 20, 246))  # near-opaque: text behind doesn't show
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
        moon = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        mmx, mmy, mr = lx + n * .775, ly + n * .2, n * .048
        ImageDraw.Draw(moon).ellipse((mmx - mr * 2.6, mmy - mr * 2.6, mmx + mr * 2.6, mmy + mr * 2.6), fill=(158, 214, 255, 75))
        base.alpha_composite(moon.filter(ImageFilter.GaussianBlur(mr * 1.4)))
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
        self.name_y = name_y = ly + int(n * .72) + int(58 * s)   # the ring's lowest point is at .713 of the logo
        name = _brand_font(int(46 * s))
        self._shadowed(base, (cx, name_y), "StellarHub", name, (243, 246, 252, 255), dy=int(4 * s), blur=int(9 * s), a=235)
        self.small = _font("segoeui.ttf", int(17 * s))
        self.status_xy = (cx, name_y + int(40 * s))
        # nothing may end in a hard edge: everything fades out before the window's border
        lut = []
        for v in range(256):               # v: elliptic distance from the center, 255 at the window's edge
            r = v / 255
            k = 0 if r >= .9 else 1 if r <= .54 else (lambda u: u * u * (3 - 2 * u))((.9 - r) / .36)
            lut.append(int(255 * k))
        self.fade = fade = Image.radial_gradient("L").resize((W, H), Image.BILINEAR).point(lut)
        base.putalpha(ImageChops.multiply(base.getchannel("A"), fade))
        self.base = base
        self._moons = [self._moon(int(n * d), seed) + (cx + n * ox, ly + n * .53 + n * oy, amp * s, per, ph)
                       for d, ox, oy, seed, amp, per, ph in ((.085, -.47, -.17, 5, 3.4, 5.6, 0.0),
                                                             (.06, .52, .13, 9, 2.8, 4.7, 1.9),
                                                             (.042, -.13, -.46, 13, 2.2, 6.3, 3.7))]

    def _moon(self, size, seed):
        # a small grey moon: lit from the upper left like the planet, a few soft craters, a faint rim light
        import random
        rnd = random.Random(seed)
        S = size * 4
        im = Image.new("RGBA", (S + 8, S + 8), (0, 0, 0, 0))
        c, r = (S + 8) / 2, S / 2
        body = Image.new("RGBA", im.size, (0, 0, 0, 0))
        bd = ImageDraw.Draw(body)
        steps = 24
        for i in range(steps):               # a soft sphere: light upper left, darker lower right
            k = i / steps
            rr = r * (1 - k)
            ox, oy = -r * .35 * k, -r * .38 * k
            g = int(104 + 118 * k ** 1.2)
            bd.ellipse((c + ox - rr, c + oy - rr, c + ox + rr, c + oy + rr), fill=(g, g + 4, g + 12, 255))
        mask = Image.new("L", im.size, 0)
        ImageDraw.Draw(mask).ellipse((c - r, c - r, c + r, c + r), fill=255)
        body = body.filter(ImageFilter.GaussianBlur(S * .012))
        craters = Image.new("RGBA", im.size, (0, 0, 0, 0))   # their own layer: ImageDraw replaces alpha
        for _ in range(5):                   # a slightly darker floor with a lighter lip below it
            a, d = rnd.uniform(0, 6.283), rnd.uniform(0, .6)
            cr = r * rnd.uniform(.07, .14)
            x, y = c + math.cos(a) * d * r, c + math.sin(a) * d * r
            lip = Image.new("RGBA", im.size, (0, 0, 0, 0))
            ImageDraw.Draw(lip).ellipse((x - cr, y - cr + cr * .22, x + cr, y + cr + cr * .22), fill=(232, 236, 244, 46))
            craters.alpha_composite(lip)
            floor = Image.new("RGBA", im.size, (0, 0, 0, 0))
            ImageDraw.Draw(floor).ellipse((x - cr, y - cr, x + cr, y + cr), fill=(70, 74, 86, 58))
            craters.alpha_composite(floor)
        body.alpha_composite(craters.filter(ImageFilter.GaussianBlur(S * .008)))
        body.putalpha(ImageChops.multiply(body.getchannel("A"), mask))
        im.alpha_composite(body)
        rim = Image.new("L", im.size, 0)
        ImageDraw.Draw(rim).ellipse((c - r, c - r, c + r, c + r), outline=170, width=max(2, int(S * .03)))
        lit = Image.linear_gradient("L").rotate(45, expand=False).resize(im.size).point(lambda v: 255 - v)
        im.alpha_composite(Image.merge("RGBA", (Image.new("L", im.size, 225), Image.new("L", im.size, 236),
                                                  Image.new("L", im.size, 250), ImageChops.multiply(rim, lit))))
        small = im.convert("RGBa").resize((size + 2, size + 2), Image.LANCZOS).convert("RGBA")
        sh = Image.new("RGBA", (small.width + 16, small.height + 16), (0, 0, 0, 0))
        sh.paste(Image.new("RGBA", small.size, (0, 0, 0, 0)), (8, 8))
        shadow = Image.new("RGBA", sh.size, (0, 0, 0, 0))
        shadow.alpha_composite(Image.merge("RGBA", (Image.new("L", small.size, 0),) * 3 + (small.getchannel("A").point(lambda v: v * 90 // 255),)), (8, 10))
        shadow = shadow.filter(ImageFilter.GaussianBlur(3))
        shadow.alpha_composite(small, (8, 8))
        # 16 copies shifted by sixteenths of a pixel: the bob moves smoothly, not in whole-pixel steps
        pad = Image.new("RGBA", (shadow.width, shadow.height + 2), (0, 0, 0, 0))
        pad.alpha_composite(shadow, (0, 0))
        pm = pad.convert("RGBa")
        subs = [pm.transform(pad.size, Image.AFFINE, (1, 0, 0, 0, 1, -k / 16), resample=Image.BICUBIC).convert("RGBA")
                for k in range(16)]
        return (subs,)

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
        for (txt, f, yy, ink) in ((VERSION, f2, cy - pr * .33, 108), (CODENAME, f1, cy - pr * .07, 150)):
            ed.text((cx, yy + n * .004), txt, font=f, fill=(255, 210, 196, int(ink * .6)), anchor="mm")  # light edge
            ed.text((cx, yy), txt, font=f, fill=(92, 24, 22, ink), anchor="mm")                        # the cut
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

    TURN = 3.1  # seconds per turn

    def _with_moons(self, t):
        im = self.base.copy()
        layer = Image.new("RGBA", im.size, (0, 0, 0, 0))
        for subs, x, y, amp, per, ph in self._moons:
            spr = subs[0]
            top = y + amp * math.sin(t / per * 2 * math.pi + ph) - spr.height / 2
            whole = math.floor(top)
            spr = subs[min(15, int((top - whole) * 16))]
            layer.alpha_composite(spr, (int(round(x - spr.width / 2)), whole))
        layer.putalpha(ImageChops.multiply(layer.getchannel("A"), self.fade))
        im.alpha_composite(layer)
        return im

    def _ring_maps(self):
        """The visible ring of make_icon_image (same geometry: center (.5, .53), outer radii .385 x .135, width .064,
        tilted 20 degrees; the half above the center passes behind the planet of radius .2), drawn 4x and scaled
        down; an angle map (0-255 along the orbit) for the ring and for a wider glow region around it."""
        n = self.n
        m = self.margin = int(n * .09)
        N = n + 2 * m
        S = N * 4
        cx, cy = (m + n * .5) * 4, (m + n * .53) * 4
        rx, ry, rw, pr = n * .385 * 4, n * .135 * 4, n * .064 * 4, n * .2 * 4
        ring = Image.new("L", (S, S), 0)
        ImageDraw.Draw(ring).ellipse((cx - rx, cy - ry, cx + rx, cy + ry), outline=255, width=round(rw))
        ring = ring.rotate(20, resample=Image.BICUBIC, center=(cx, cy))
        upper = Image.new("L", (S, S), 0)
        ImageDraw.Draw(upper).rectangle((0, 0, S, cy), fill=255)
        upper = upper.rotate(20, resample=Image.NEAREST, center=(cx, cy))
        disc = Image.new("L", (S, S), 0)
        ImageDraw.Draw(disc).ellipse((cx - pr, cy - pr, cx + pr, cy + pr), fill=255)
        hidden = ImageChops.multiply(ImageChops.multiply(ring, upper), disc)     # back half behind the planet
        vis = ImageChops.subtract(ring, hidden).resize((N, N), Image.LANCZOS)
        self._hole = ImageChops.invert(disc).resize((N, N), Image.LANCZOS)
        self._back = upper.resize((N, N), Image.BILINEAR)
        self._vis = vis
        glowreg = vis.filter(ImageFilter.MaxFilter(5)).filter(ImageFilter.GaussianBlur(n * .03))
        # stop the glow where the planet hides the ring: the glow of the hidden stretch must not float over it
        self._glowreg = ImageChops.multiply(glowreg, ImageChops.invert(ImageChops.multiply(
            self._back, ImageChops.invert(self._hole))))
        # angle along the orbit for every pixel that matters
        ca, sa = math.cos(math.radians(20)), math.sin(math.radians(20))
        c1, c2 = m + n * .5, m + n * .53
        rxm, rym = n * .385 - n * .032, n * .135 - n * .032
        ang = Image.new("L", (N, N), 0)
        ap = ang.load()
        gp = self._glowreg.load()
        for y in range(N):
            for x in range(N):
                if gp[x, y] > 2:
                    dx, dy = x - c1, y - c2
                    ux, uy = dx * ca - dy * sa, dx * sa + dy * ca                # undo the 20 degree tilt
                    a = math.atan2(uy / rym, ux / rxm) % (2 * math.pi)
                    ap[x, y] = int(a / (2 * math.pi) * 256) % 256
        self._ang = ang
        self._geom = (c1, c2, rxm, rym, ca, sa, n * .2)
        rwp = n * .064
        hs = int(rwp * 14) | 1  # room for the whole halo: nothing may end in a square
        h = Image.new("RGBA", (hs * 4, hs * 4), (0, 0, 0, 0))
        hc = hs * 2
        hd = ImageDraw.Draw(h)
        hd.ellipse((hc - rwp * 5.5, hc - rwp * 5.5, hc + rwp * 5.5, hc + rwp * 5.5), fill=(255, 150, 125, 95))
        h = h.filter(ImageFilter.GaussianBlur(rwp * 3.2))
        ImageDraw.Draw(h).ellipse((hc - rwp * 2.4, hc - rwp * 2.4, hc + rwp * 2.4, hc + rwp * 2.4), fill=(255, 226, 214, 150))
        h = h.filter(ImageFilter.GaussianBlur(rwp * 1.2))
        ImageDraw.Draw(h).ellipse((hc - rwp * 1.25, hc - rwp * 1.25, hc + rwp * 1.25, hc + rwp * 1.25), fill=(255, 251, 247, 255))
        self._star = h.convert("RGBa").resize((hs, hs), Image.LANCZOS).convert("RGBA")

    @staticmethod
    def _lut(head, width, lead, gain):
        """Brightness (0-255) for each angle step: a trail fading over `width` radians behind the head, a short
        lead in front of it."""
        out = []
        for v in range(256):
            a = (v + .5) / 256 * 2 * math.pi
            d = (head - a) % (2 * math.pi)                 # how far behind the head
            k = math.exp(-d / width) if d < 2 * math.pi - lead * 4 else 0
            ahead = 2 * math.pi - d
            k = max(k, math.exp(-ahead / lead) if ahead < lead * 4 else 0)
            out.append(int(255 * gain * k))
        return out

    def frame(self, t, status):
        if not hasattr(self, "_maps_thread"):
            self._maps_thread = threading.Thread(target=self._ring_maps, daemon=True)
            self._maps_thread.start()
        if not hasattr(self, "_star"):            # still being prepared: the scene without the light
            im = self._with_moons(t)
            if status:
                self._shadowed(im, self.status_xy, status, self.small, (236, 241, 249, 228), dy=int(2 * self.s), blur=int(4 * self.s), a=235)
            return im
        if not hasattr(self, "_light_t0"):
            self._light_t0 = t
        im = self._with_moons(t)
        n, m = self.n, self.margin
        N = n + 2 * m
        head = (t / self.TURN) % 1.0 * 2 * math.pi
        # the ring lights up: ice-white along the trail, coral near the head, and a soft glow around it
        ice = Image.new("RGBA", (N, N), (246, 251, 255, 0))
        ice.putalpha(ImageChops.multiply(self._ang.point(self._lut(head, 1.05, .05, 1.0)), self._vis))
        coral = Image.new("RGBA", (N, N), (255, 158, 132, 0))
        coral.putalpha(ImageChops.multiply(self._ang.point(self._lut(head, .22, .04, .85)), self._vis))
        glow = Image.new("RGBA", (N, N), (255, 140, 118, 0))
        glow.putalpha(ImageChops.multiply(self._ang.point(self._lut(head, .5, .12, .7)), self._glowreg))
        layer = glow
        layer.alpha_composite(ice)
        layer.alpha_composite(coral)
        # the star at the head, hidden by the planet exactly at its edge
        c1, c2, rxm, rym, ca, sa, pr = self._geom
        dx, dy = rxm * math.cos(head), rym * math.sin(head)
        x, y = c1 + dx * ca + dy * sa, c2 - dx * sa + dy * ca
        star = Image.new("RGBA", (N, N), (0, 0, 0, 0))
        sp = self._star
        star.alpha_composite(sp, (int(round(x - sp.width / 2)), int(round(y - sp.height / 2))))
        if dy < 0:
            star.putalpha(ImageChops.multiply(star.getchannel("A"), self._hole))
        layer.alpha_composite(star)
        lx, ly = self.logo_at
        full = Image.new("RGBA", im.size, (0, 0, 0, 0))
        full.alpha_composite(layer, (lx - m, ly - m))
        fade_in = min(1.0, (t - self._light_t0) / .5)
        a = ImageChops.multiply(full.getchannel("A"), self.fade)
        full.putalpha(a if fade_in >= 1 else a.point(lambda v: int(v * fade_in)))
        im.alpha_composite(full)
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


# ---------------------------------------------------------------- one start screen, also across processes
# Several starts go through two processes: a normal copy that relaunches itself as administrator (at start, or from
# the window), the app that runs the updater for a staged update, the new portable copy that opens the updated app.
# Each used to put up its own start screen while the other one was still on screen: two translucent cards on top of
# each other, each with its own animation clock and the second fading in over the first, seen as a strong flicker.
#
# Now the process that gives way calls hand_over() before it starts the next one. Its window title then carries its
# animation clock (a wall-clock epoch), position, scale, light and status. The next process's show() finds that card
# and adopts it: the same card at the same place on the same clock, so its first frame is the frame the old card
# shows at that moment, with no fade-in. The swap itself: the new card asks the old one to hold still (WM_FREEZE);
# the old card stops on the frame it shows and writes that frame's time in its title; the new card draws exactly that
# frame, puts its window up and hides the old one (ShowWindowAsync), which the old card, by then only waiting on its
# message queue, does within a millisecond: the two are never on screen together for a whole frame. The old card
# also hides itself the moment it sees another start screen (a new card that could not ask it to hold still: one
# with fewer rights than it). A start screen that is not handing over is never doubled either: a copy launched while
# another copy is starting shows none of its own (other_starting(), startup.show_splash) until it really starts.
CLASS = "StellarHubSplash"
HANDOFF = "StellarHub handoff v1 "
FADE_IN, FADE_OUT = .22, .28
WM_FREEZE = 0x8000 + 0x57  # WM_APP + n: "hold still, I am about to replace you"
FREEZE_MAX = 0.5           # a card asked to hold still that is not replaced by then goes on animating


def handoff_title(epoch, light, pos, scale, status, frozen=None):
    """The window title of a card that is handing over (parse_handoff reads it in the next process)."""
    return (f"{HANDOFF}e={epoch:.4f} l={-1 if light is None else light:.4f} x={int(pos[0])} y={int(pos[1])} "
            f"s={scale:.5f}" + ("" if frozen is None else f" f={frozen:.4f}") + f"|{status or ''}")


def parse_handoff(title):
    """{"e", "l" (None: no light yet), "x", "y", "s", "f" (the time of the frame it holds still on, or None),
    "status"} from handoff_title(), or None."""
    if not isinstance(title, str) or not title.startswith(HANDOFF):
        return None
    fields, _, status = title[len(HANDOFF):].partition("|")
    try:
        kv = dict(f.split("=", 1) for f in fields.split())
        out = {"e": float(kv["e"]), "l": float(kv["l"]), "x": int(kv["x"]), "y": int(kv["y"]), "s": float(kv["s"]),
               "f": float(kv["f"]) if "f" in kv else None, "status": status}
    except (KeyError, ValueError):
        return None
    if out["l"] < 0:
        out["l"] = None
    if not (0.5 <= out["s"] <= 8) or not out["e"] > 0:
        return None
    return out


def _cards(exclude=None):
    """[(hwnd, title, visible)] for every start screen on this desktop but `exclude`."""
    found = []

    @ctypes.WINFUNCTYPE(wt.BOOL, wt.HWND, wt.LPARAM)
    def cb(h, _):
        buf = ctypes.create_unicode_buffer(32)
        u32.GetClassNameW(h, buf, 32)
        if buf.value == CLASS and h != exclude:
            t = ctypes.create_unicode_buffer(512)
            u32.GetWindowTextW(h, t, 512)
            found.append((h, t.value, bool(u32.IsWindowVisible(h))))
        return True
    try:
        u32.EnumWindows(cb, 0)
    except Exception:
        return []
    return found


def _handing_card():
    """(hwnd, parse_handoff info) of a visible card of another process that is handing over, or None."""
    me = os.getpid()
    for h, title, visible in _cards(_state["hwnd"]):
        info = parse_handoff(title) if visible else None
        if info is None:
            continue
        pid = wt.DWORD()
        u32.GetWindowThreadProcessId(h, ctypes.byref(pid))
        if pid.value != me:
            return h, info
    return None


def _title_of(h):
    t = ctypes.create_unicode_buffer(512)
    u32.GetWindowTextW(h, t, 512)
    return t.value


def _take_over(hwnd, old, info, card, epoch, pos):
    """The swap (see above): the old card holds still on a frame, this one shows that very frame and hides it."""
    t = None
    if u32.PostMessageW(old, WM_FREEZE, 0, 0):
        end = time.monotonic() + 0.3
        while time.monotonic() < end:
            got = parse_handoff(_title_of(old))
            if got is None:
                break
            if got["f"] is not None:
                info, t = got, got["f"]
                break
            time.sleep(0.002)
    if t is None:  # it could not be asked (it runs with more rights than this one): the frame of this moment
        t = time.time() - epoch
    if hasattr(card, "_star"):
        card._light_t0 = info["l"] if info["l"] is not None else t
    if info["status"] and not _state["status"]:
        _state["status"] = info["status"]
    _blit(hwnd, card.frame(t, _state["status"]), 255 * min(1, max(0.0, t) / FADE_IN), pos)
    u32.ShowWindow(hwnd, 4)
    u32.ShowWindowAsync(old, 0)  # SW_HIDE: the card this one replaces goes in the same instant
    print("[splash] took over the start screen of the previous process", flush=True)


def _run(ready):
    try:  # this thread draws at the real pixel size (otherwise Windows stretches the window at 125 %/150 %)
        u32.SetThreadDpiAwarenessContext(ctypes.c_void_p(-4))  # PER_MONITOR_AWARE_V2
    except (AttributeError, OSError):
        pass
    adopt = None
    try:
        adopt = _handing_card()
    except Exception as e:
        print("splash handoff:", e, flush=True)
    if adopt:
        _state["adopting"] = True
        info = adopt[1]
        scale, pos, epoch = info["s"], (info["x"], info["y"]), info["e"]
        card = _Card(scale)
        try:  # the ring's light is ready before the first frame, as it is on the card being replaced
            card._maps_thread = None
            card._ring_maps()
        except Exception as e:
            print("splash maps:", e, flush=True)
        if not _state["status"]:
            _state["status"] = info["status"]
    else:
        try:
            dpi = u32.GetDpiForSystem() if hasattr(u32, "GetDpiForSystem") else 96
        except Exception:
            dpi = 96
        scale = dpi / 96
        card = _Card(scale)
        wa = wt.RECT()
        u32.SystemParametersInfoW(0x0030, 0, ctypes.byref(wa), 0)  # work area of the primary monitor
        W, H = card.size
        pos = (wa.left + (wa.right - wa.left - W) // 2, wa.top + (wa.bottom - wa.top - H) // 2 - int(20 * scale))
        epoch = None
    W, H = card.size

    proc = WNDPROC(lambda h, m, w, l: u32.DefWindowProcW(h, m, w, l))
    hinst = k32.GetModuleHandleW(None)
    wc = WNDCLASSEXW(ctypes.sizeof(WNDCLASSEXW), 0, proc, 0, 0, hinst, None, u32.LoadCursorW(None, 32514),
                     None, None, CLASS, None)  # IDC_APPSTARTING: the arrow with the little wheel
    u32.RegisterClassExW(ctypes.byref(wc))
    # layered + tool window (no taskbar button) + topmost, as start screens are
    hwnd = u32.CreateWindowExW(0x00080000 | 0x00000080 | 0x00000008, CLASS, "StellarHub", 0x80000000,
                               pos[0], pos[1], W, H, None, None, hinst, None)
    _state["hwnd"] = hwnd
    if epoch is None:
        epoch = time.time()
        _blit(hwnd, card.frame(0, ""), 0, pos)
        u32.ShowWindow(hwnd, 4)  # SW_SHOWNOACTIVATE: the user's current window keeps the focus
    else:
        _take_over(hwnd, adopt[0], info, card, epoch, pos)
    ready.set()
    msg = wt.MSG()
    closing_at = None
    title = "StellarHub"
    frozen_at = shown_t = None
    while True:
        while u32.PeekMessageW(ctypes.byref(msg), None, 0, 0, 1):
            if msg.message == WM_FREEZE and msg.hWnd == hwnd:
                if _state["handing"] and shown_t is not None and frozen_at is None:
                    frozen_at = time.monotonic()
                continue
            u32.TranslateMessage(ctypes.byref(msg))
            u32.DispatchMessageW(ctypes.byref(msg))
        if frozen_at is not None and (not _state["handing"] or time.monotonic() - frozen_at > FREEZE_MAX):
            frozen_at = None  # nobody took over after all: go on
        now = time.time() - epoch
        if _state["closing"] is not None and closing_at is None:
            closing_at = now
        if now > 6 and not _state["status"]:
            _state["status"] = tr("Getting to know your PC. The first start takes a little longer.")
        handing = _state["handing"] and closing_at is None
        want = "StellarHub"
        if handing:
            want = handoff_title(epoch, getattr(card, "_light_t0", None), pos, scale, _state["status"],
                                 shown_t if frozen_at is not None else None)
        if want != title:
            u32.SetWindowTextW(hwnd, want)
            title = want
        _state["titled"] = handing
        if handing and not _state["handed"]:
            try:
                if not u32.IsWindowVisible(hwnd) or any(v for _h, _t, v in _cards(hwnd)):
                    u32.ShowWindow(hwnd, 0)  # the next process has its card up (or hid this one): this one goes
                    _state["handed"] = True
            except Exception:
                pass
        alpha = 255 * min(1, max(0.0, now) / FADE_IN)
        if closing_at is not None:
            k = (now - closing_at) / FADE_OUT
            if k >= 1 or _state["handed"]:
                break
            alpha *= 1 - k * k
        if not _state["handed"] and frozen_at is None:
            try:
                _blit(hwnd, card.frame(now, _state["status"]), alpha, pos)
                shown_t = now
            except Exception:
                pass
        if frozen_at is not None:  # holding still: only the messages, so the hide comes at once
            u32.MsgWaitForMultipleObjects(0, None, False, 2, 0x04FF)
        elif handing:  # wake up for the next process's ShowWindowAsync instead of sleeping through it
            u32.MsgWaitForMultipleObjects(0, None, False, 16, 0x04FF)  # QS_ALLINPUT
        else:
            time.sleep(1 / 60)
    u32.DestroyWindow(hwnd)
    u32.UnregisterClassW(CLASS, hinst)
    _state["hwnd"] = None
    _state["titled"] = False
    del proc


def show():
    """Shows the start screen (one at a time; again after an earlier one has closed). Returns once it is on screen
    (at most 2 s). If another process is handing its start screen over (hand_over), this one takes it over."""
    with _lock:
        th = _state["thread"]
        if th is not None and th.is_alive():
            if _state["closing"] is None:
                return
            th.join(1)  # an earlier one is fading out: let it go, then start again
            if th.is_alive():
                return
        _state.update(closing=None, handing=False, handed=False, titled=False, status="", adopting=False)
        ready = threading.Event()
        th = threading.Thread(target=_run, args=(ready,), name="splash", daemon=True)
        _state["thread"] = th
        th.start()
    # taking over another process's card prepares the ring's light first: worth the wait, since the other process
    # goes as soon as this one returns and holds the single-instance lock
    if not ready.wait(2) and _state.get("adopting"):
        ready.wait(5)


def hand_over(on=True, timeout=0.5):
    """Before starting the process that takes over (see above): marks this start screen as handing over. True once
    the next process can find it (its title says so); False if there is no start screen up. hand_over(False) takes
    the mark back (the next process did not start after all)."""
    _state["handing"] = bool(on)
    if not on:
        return False
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        if _state["titled"]:
            return True
        if not showing() or _state["closing"] is not None:
            return False
        time.sleep(0.005)
    return bool(_state["titled"])


def handed():
    """True once the next process's start screen is up and this one has hidden itself."""
    return bool(_state["handed"])


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
    return any(v for _h, _t, v in _cards(_state["hwnd"]))


def other_starting():
    """True if another StellarHub process shows its start screen without handing it over: a copy that is starting
    (this one then waits with no start screen of its own: two cards on top of each other flicker)."""
    return any(v and parse_handoff(t) is None for _h, t, v in _cards(_state["hwnd"]))


def showing():
    th = _state["thread"]
    return bool(th and th.is_alive())
