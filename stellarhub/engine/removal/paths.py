"""Rutas del sistema, carpetas de datos de la app y utilidades de rutas."""
import ctypes
import os
import re
import sys
import uuid
from ctypes import wintypes
from functools import lru_cache

# ---------------------------------------------------------------- datos de la app
# Siempre en ProgramData: la Python de la Microsoft Store virtualiza lo que se crea en AppData.
DATA_DIR = (os.environ.get("STELLARHUB_DATA") or os.environ.get("MINIREVO_DATA")
            or os.path.join(os.environ.get("ProgramData", r"C:\ProgramData"), "StellarHub", "remover"))


def data_path(*parts, make=True):
    p = os.path.join(DATA_DIR, *parts)
    if make:
        os.makedirs(p if not os.path.splitext(parts[-1])[1] else os.path.dirname(p), exist_ok=True)
    return p


APP_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))  # carpeta de StellarHub: nunca se toca


# ---------------------------------------------------------------- carpetas conocidas
class _GUID(ctypes.Structure):
    _fields_ = [("Data1", wintypes.DWORD), ("Data2", wintypes.WORD), ("Data3", wintypes.WORD),
                ("Data4", ctypes.c_ubyte * 8)]

    def __init__(self, s):
        super().__init__()
        u = uuid.UUID(s)
        self.Data1, self.Data2, self.Data3 = u.fields[0], u.fields[1], u.fields[2]
        for i, b in enumerate(u.bytes[8:]):
            self.Data4[i] = b


KNOWN = {
    "Desktop": "B4BFCC3A-DB2C-424C-B029-7FE99A87C641",
    "Documents": "FDD39AD0-238F-46AF-ADB4-6C85480369C7",
    "Downloads": "374DE290-123F-4565-9164-39C4925E467B",
    "Music": "4BD8D571-6D19-48D3-BE97-422220080E43",
    "Pictures": "33E28130-4E1E-4676-835A-98395C3BC3BB",
    "Videos": "18989B1D-99B5-455B-841C-AB7C74E4DDFC",
    "Profile": "5E6C858F-0E22-4760-9AFE-EA3317B67173",
    "LocalAppData": "F1B32785-6FBA-4FCF-9D55-7B8E7F157091",
    "RoamingAppData": "3EB685DB-65F9-4CF6-A03A-E3EF65729F3D",
    "LocalAppDataLow": "A520A1A4-1780-4FF6-BD18-167343C5AF16",
    "ProgramData": "62AB5D82-FDC1-4DC3-A9DD-070D1D495D97",
    "ProgramFiles": "905E63B6-C1BF-494E-B29C-65B732D3D21A",
    "ProgramFilesX86": "7C5A40EF-A0FB-4BFC-874A-C0F2E0B9FA8E",
    "ProgramFilesCommon": "F7F1ED05-9F6D-47A2-AAAE-29D317C6F066",
    "ProgramFilesCommonX86": "DE974D24-D9C6-4D3E-BF91-F4455120B917",
    "UserProgramFiles": "5CD7AEE2-2219-4A67-B85D-6C9CE15660CB",
    "Windows": "F38BF404-1D43-42F2-9305-67DE0B28FC23",
    "StartMenu": "625B53C3-AB48-4EC1-BA1F-A1EF4146FC19",
    "CommonStartMenu": "A4115719-D62E-491D-AA7C-E74B8BE3B067",
    "Programs": "A77F5D77-2E2B-44C3-A6A2-ABA601054A51",
    "CommonPrograms": "0139D44E-6AFE-49F2-8690-3DAFCAE6FFB8",
    "Startup": "B97D20BB-F46A-4C97-BA10-5E3608430854",
    "CommonStartup": "82A5EA35-D9CD-47C5-9629-E15D2F714E6E",
    "PublicDesktop": "C4AA340D-F20F-4863-AFEF-F87EF2E6BA25",
    "Public": "DFDF76A2-C82A-4D63-906A-5644AC457385",
    "SavedGames": "4C5C32FF-BB9D-43B0-B5B4-2D72E54EAAA4",
    "OneDrive": "A52BBA46-E9E1-435F-B3D9-28DAA648C0F6",
}


def _known_folder(guid):
    path = ctypes.c_wchar_p()
    try:
        hr = ctypes.windll.shell32.SHGetKnownFolderPath(ctypes.byref(_GUID(guid)), 0, None, ctypes.byref(path))
        if hr != 0:
            return None
        return path.value
    except Exception:
        return None
    finally:
        if path:
            ctypes.windll.ole32.CoTaskMemFree(path)


@lru_cache(maxsize=1)
def known_folders():
    out = {k: _known_folder(g) for k, g in KNOWN.items()}
    env = os.environ
    out.setdefault("Temp", None)
    out["Temp"] = env.get("TEMP")
    if not out.get("OneDrive"):
        out["OneDrive"] = env.get("OneDrive")
    out["SystemDrive"] = (env.get("SystemDrive", "C:") + "\\")
    return {k: v for k, v in out.items() if v}


def kf(name):
    return known_folders().get(name)


# ---------------------------------------------------------------- utilidades
def norm_path(p):
    """Ruta normalizada para comparar (minusculas, sin barra final, variables expandidas)."""
    if not p:
        return ""
    return _norm_path(p if isinstance(p, str) else str(p))


@lru_cache(maxsize=1 << 17)
def _norm_path(p):
    p = os.path.expandvars(p.strip().strip('"'))
    if p.startswith("\\??\\"):
        p = p[4:]
    p = os.path.normcase(os.path.normpath(p))
    return p.rstrip("\\") if len(p) > 3 else p


def is_within(child, parent):
    """True si child es parent o esta dentro de parent."""
    c, p = norm_path(child), norm_path(parent)
    if not c or not p:
        return False
    return c == p or c.startswith(p.rstrip("\\") + "\\")


def is_reparse_point(path):
    try:
        attrs = ctypes.windll.kernel32.GetFileAttributesW(str(path))
        return attrs != 0xFFFFFFFF and bool(attrs & 0x400)
    except Exception:
        return False


_NOT_ALNUM = re.compile(r"[^a-z0-9]")


@lru_cache(maxsize=1 << 17)
def norm_name(s):
    return _NOT_ALNUM.sub("", (s or "").lower())


def folder_size(path, limit_files=None):
    """Tamano en bytes sin seguir enlaces. Devuelve (bytes, archivos).

    Los atributos y el tamano salen del propio listado (FindNextFile): ninguna llamada extra por archivo.
    """
    total = files = 0
    stack = [path]
    while stack:
        d = stack.pop()
        try:
            with os.scandir(d) as it:
                for e in it:
                    try:
                        st = e.stat(follow_symlinks=False)
                        if st.st_file_attributes & _REPARSE:   # enlace, junction o similar: no se sigue
                            continue
                        if st.st_file_attributes & _DIRECTORY:
                            stack.append(e.path)
                        else:
                            total += st.st_size
                            files += 1
                            if limit_files and files >= limit_files:
                                return total, files
                    except OSError:
                        pass
        except OSError:
            pass
    return total, files


_REPARSE, _DIRECTORY = 0x400, 0x10


def path_size(path):
    try:
        if os.path.isdir(path) and not is_reparse_point(path):
            return folder_size(path)[0]
        return os.path.getsize(path)
    except OSError:
        return 0


@lru_cache(maxsize=1)
def running_packaged():
    """True si este Python corre como app empaquetada (Python de la Microsoft Store)."""
    try:
        n = ctypes.c_uint32(0)
        rc = ctypes.windll.kernel32.GetCurrentPackageFullName(ctypes.byref(n), None)
        return rc != 15700  # APPMODEL_ERROR_NO_PACKAGE
    except Exception:
        return False


def self_paths():
    """Rutas que MiniRevo jamas puede tocar (su propio codigo, sus datos, su Python)."""
    out = {norm_path(APP_DIR), norm_path(DATA_DIR), norm_path(os.path.dirname(sys.executable))}
    if getattr(sys, "frozen", False):
        out.add(norm_path(os.path.dirname(sys.executable)))
    base = getattr(sys, "_MEIPASS", None)
    if base:
        out.add(norm_path(base))
    return {p for p in out if p}
