"""Program icons as PNG (data URI), with an on-disk cache.

Cold extraction takes ~200 ms per program (antivirus + disk); warm, < 1 ms.
"""
import base64
import ctypes
import hashlib
import os
import re
import threading
from ctypes import wintypes

from . import paths
from .programs import exe_from_command, msi_info

_lock = threading.Lock()
_net = None


def _dotnet():
    global _net
    if _net is None:
        try:
            import clr  # pythonnet (ships with pywebview)
            clr.AddReference("System.Drawing")
            from System import IntPtr
            from System.Drawing import Icon
            from System.Drawing.Imaging import ImageFormat
            from System.IO import MemoryStream
            _net = (IntPtr, Icon, ImageFormat, MemoryStream)
        except Exception:
            _net = False
    return _net


_shell32 = ctypes.windll.shell32
_user32 = ctypes.windll.user32
_shell32.SHDefExtractIconW.argtypes = [wintypes.LPCWSTR, ctypes.c_int, wintypes.UINT,
                                       ctypes.POINTER(wintypes.HICON), ctypes.POINTER(wintypes.HICON), wintypes.UINT]


def _hicon_png(path, idx, size=48):
    net = _dotnet()
    if not net:
        return None
    IntPtr, Icon, ImageFormat, MemoryStream = net
    h = wintypes.HICON()
    try:
        hr = _shell32.SHDefExtractIconW(path, idx, 0, ctypes.byref(h), None, (size & 0xFFFF) | (size << 16))
    except Exception:
        return None
    if hr != 0 or not h.value:
        return None
    try:
        with _lock:
            bmp = Icon.FromHandle(IntPtr(h.value)).ToBitmap()
            ms = MemoryStream()
            bmp.Save(ms, ImageFormat.Png)
            data = bytes(ms.ToArray())
            bmp.Dispose()
        return data
    except Exception:
        return None
    finally:
        _user32.DestroyIcon(h)


def parse_icon_spec(spec):
    spec = os.path.expandvars((spec or "").strip())
    m = re.match(r'^"?(.*?)"?(?:,\s*(-?\d+))?$', spec)
    if not m:
        return None, 0
    return m.group(1).strip('" '), int(m.group(2) or 0)


def _candidates(p):
    """Possible icon sources, in order of preference."""
    if p.get("source") == "store":
        if p.get("icon"):
            yield p["icon"], None
        return
    path, idx = parse_icon_spec(p.get("icon"))
    if path:
        yield path, idx
    if p.get("msi_code"):
        mi = msi_info(p["msi_code"], "ProductIcon")
        if mi:
            yield mi, 0
    loc = p.get("location")
    if loc and os.path.isdir(loc):
        try:
            exes = [f for f in os.listdir(loc) if f.lower().endswith(".exe")
                    and not re.match(r"(unins|uninst|setup|update|crash|helper)", f, re.I)]
        except OSError:
            exes = []
        key = paths.norm_name(p.get("name", ""))[:6]
        exes.sort(key=lambda f: (key not in paths.norm_name(f), -_safe_size(os.path.join(loc, f))))
        for f in exes[:2]:
            yield os.path.join(loc, f), 0
    u = exe_from_command(p.get("uninstall"))
    if u:
        yield u, 0


def _safe_size(f):
    try:
        return os.path.getsize(f)
    except OSError:
        return 0


def get_icon(p, extract=True):
    """PNG data URI of the icon, or None.

    extract=False: only looks at the disk cache (microseconds) and returns None if the first candidate
    has not been extracted yet, so the result matches what the full extraction will return later.
    """
    for path, idx in _candidates(p):
        if not path or not os.path.isfile(path):
            continue
        try:
            st = os.stat(path)
        except OSError:
            continue
        key = hashlib.sha1(f"{paths.norm_path(path)}|{idx}|{st.st_mtime}|{st.st_size}".encode()).hexdigest()
        cache = paths.data_path("cache", "icons", f"{key}.png", make=False)
        try:
            with open(cache, "rb") as f:
                data = f.read()
        except OSError:
            data = None
        if data:
            return "data:image/png;base64," + base64.b64encode(data).decode()
        if data is not None:
            continue  # negative cache: this candidate has no icon
        if not extract:
            return None
        os.makedirs(os.path.dirname(cache), exist_ok=True)
        if idx is None:  # plain PNG (Store)
            with open(path, "rb") as f:
                data = f.read()
        else:  # .exe, .dll or .ico
            data = _hicon_png(path, idx or 0)
        try:
            with open(cache, "wb") as f:
                f.write(data or b"")
        except OSError:
            pass
        if data:
            return "data:image/png;base64," + base64.b64encode(data).decode()
    return None


def icon_for_file(path):
    return get_icon({"source": "file", "icon": path})
