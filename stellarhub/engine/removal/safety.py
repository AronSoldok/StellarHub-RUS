"""Reglas duras de seguridad. Nada se borra sin pasar por aqui.

Principio: ante la duda, se bloquea. Un resto que se queda es una molestia;
algo del sistema que se borra es un PC roto.
"""
import os
import re
import winreg

from . import paths, registry
from .paths import is_within, kf, norm_path

# ================================================================ rutas

def _j(base, *parts):
    return os.path.join(base, *parts) if base else None


def protected_exact():
    """Carpetas que no se pueden borrar (ni ellas ni ninguna carpeta que las contenga)."""
    k = paths.known_folders()
    pf, pf86 = k.get("ProgramFiles"), k.get("ProgramFilesX86")
    cf, cf86 = k.get("ProgramFilesCommon"), k.get("ProgramFilesCommonX86")
    local, roam, pd = k.get("LocalAppData"), k.get("RoamingAppData"), k.get("ProgramData")
    prof = k.get("Profile")
    out = [
        k.get("SystemDrive"), k.get("Windows"), pf, pf86, cf, cf86, pd, prof, local, roam, k.get("LocalAppDataLow"),
        k.get("Desktop"), k.get("Documents"), k.get("Downloads"), k.get("Music"), k.get("Pictures"),
        k.get("Videos"), k.get("SavedGames"), k.get("OneDrive"), k.get("Public"), k.get("PublicDesktop"),
        k.get("StartMenu"), k.get("CommonStartMenu"), k.get("Programs"), k.get("CommonPrograms"),
        k.get("Startup"), k.get("CommonStartup"), k.get("Temp"), k.get("UserProgramFiles"),
        _j(prof, "AppData"), _j(local, "Programs"), _j(local, "Temp"), _j(prof, ".."),
        _j(local, "Microsoft", "WinGet", "Packages"),
        # carpetas compartidas de plugins de audio
        _j(cf, "VST3"), _j(cf, "VST2"), _j(cf, "VST"), _j(cf, "CLAP"), _j(cf, "Avid"),
        _j(cf, "Avid", "Audio"), _j(cf, "Avid", "Audio", "Plug-Ins"), _j(pf, "VSTPlugins"),
        _j(pf, "Steinberg"), _j(pf, "Steinberg", "VSTPlugins"), _j(pf, "Common Files", "Steinberg"),
        _j(pf86, "VSTPlugins"), _j(pf86, "Steinberg", "VSTPlugins"), _j(cf86, "VST3"),
    ]
    # raices de todas las unidades
    for letter in "ABCDEFGHIJKLMNOPQRSTUVWXYZ":
        out.append(f"{letter}:\\")
    return {norm_path(p) for p in out if p}


def forbidden_trees():
    """Arboles en los que no se toca NADA (salvo excepciones)."""
    k = paths.known_folders()
    win, pf, pf86 = k.get("Windows"), k.get("ProgramFiles"), k.get("ProgramFilesX86")
    cf, cf86, pd = k.get("ProgramFilesCommon"), k.get("ProgramFilesCommonX86"), k.get("ProgramData")
    local, roam, prof = k.get("LocalAppData"), k.get("RoamingAppData"), k.get("Profile")
    sysd = k.get("SystemDrive", "C:\\")
    out = [
        win, _j(pf, "WindowsApps"), _j(pf, "Windows Defender"), _j(pf, "Windows Defender Advanced Threat Protection"),
        _j(pf, "Windows NT"), _j(pf, "Windows Mail"), _j(pf, "Windows Media Player"), _j(pf, "Windows Photo Viewer"),
        _j(pf, "Windows Sidebar"), _j(pf, "Windows Security"), _j(pf, "Internet Explorer"), _j(pf, "ModifiableWindowsApps"),
        _j(pf86, "Windows Defender"), _j(pf86, "Windows NT"), _j(pf86, "Windows Mail"), _j(pf86, "Windows Media Player"),
        _j(pf86, "Windows Photo Viewer"), _j(pf86, "Windows Sidebar"), _j(pf86, "Internet Explorer"),
        _j(pf, "dotnet"), _j(pf86, "dotnet"), _j(pf, "Windows Kits"), _j(pf86, "Windows Kits"),
        _j(cf, "microsoft shared"), _j(cf, "System"), _j(cf, "Services"),
        _j(cf86, "microsoft shared"), _j(cf86, "System"), _j(cf86, "Services"),
        _j(pd, "Microsoft"), _j(pd, "Package Cache"), _j(pd, "Packages"),
        _j(local, "Microsoft"), _j(roam, "Microsoft"), _j(local, "Packages"), _j(local, "Windows"),
        _j(prof, "..", "Default"), _j(prof, "..", "All Users"), _j(prof, "..", "Default User"),
        _j(sysd, "System Volume Information"), _j(sysd, "$Recycle.Bin"), _j(sysd, "Recovery"), _j(sysd, "Boot"),
        _j(sysd, "PerfLogs"), _j(sysd, "$WinREAgent"), _j(sysd, "Config.Msi"),
    ]
    return {norm_path(p) for p in out if p}


def forbidden_exceptions():
    """Subarboles permitidos DENTRO de un arbol prohibido."""
    k = paths.known_folders()
    local = k.get("LocalAppData")
    out = [k.get("Programs"), k.get("CommonPrograms"), k.get("Startup"), k.get("CommonStartup"),
           _j(local, "Microsoft", "WinGet", "Packages"),
           _j(k.get("RoamingAppData"), "Microsoft", "Internet Explorer", "Quick Launch")]
    return {norm_path(p) for p in out if p}


def personal_roots():
    k = paths.known_folders()
    return {norm_path(k.get(n)) for n in ("Documents", "Pictures", "Music", "Videos", "Downloads",
                                          "OneDrive", "SavedGames") if k.get(n)}


def read_shared_dlls():
    out = {}
    for view in registry.hklm_views():
        for name, data, _ in registry.values(winreg.HKEY_LOCAL_MACHINE,
                                             r"SOFTWARE\Microsoft\Windows\CurrentVersion\SharedDLLs", view):
            try:
                out[norm_path(name)] = max(out.get(norm_path(name), 0), int(data))
            except (TypeError, ValueError):
                pass
    return out


class Context:
    """Todo lo que hace falta para decidir si algo se puede borrar al limpiar un programa."""

    def __init__(self, target=None, programs=(), extra_protected=(), shared_dlls=None):
        self.protected = protected_exact() | paths.self_paths() | {norm_path(p) for p in extra_protected}
        self.forbidden = forbidden_trees() | paths.self_paths()
        self.exceptions = forbidden_exceptions()
        self.personal = personal_roots()
        self.shared_dlls = read_shared_dlls() if shared_dlls is None else shared_dlls
        self.target = target
        tloc = norm_path(target.get("location")) if target else ""
        self.target_loc = tloc if tloc and tloc not in self.protected else ""
        self.others = []  # (ruta, nombre)
        for p in programs:
            if target is not None and p.get("id") == target.get("id"):
                continue
            loc = norm_path(p.get("location"))
            if loc and loc not in self.protected and os.path.isabs(loc):
                self.others.append((loc, p.get("name", "?")))

    # -------------------------------------------------------------- archivos
    def check_path(self, path):
        """Devuelve (motivo_de_bloqueo | None, es_personal)."""
        n = norm_path(path)
        if not n or not os.path.isabs(n) or len(n) <= 3:
            return "Raíz de unidad o ruta no válida", False
        for p in self.protected:
            if is_within(p, n):
                return ("Carpeta protegida del sistema" if p == n else
                        "Contiene una carpeta protegida del sistema"), False
        for f in self.forbidden:
            if is_within(n, f) and not any(is_within(n, e) for e in self.exceptions):
                return "Zona protegida de Windows", False
            if is_within(f, n):
                return "Contiene una zona protegida de Windows", False
        for loc, name in self.others:
            # A) borrar esto se llevaria por delante a otro programa instalado: siempre bloqueado
            if is_within(loc, n):
                return f"Contiene «{name}», que sigue instalado", False
            # B) esta dentro de otro programa
            if is_within(n, loc):
                # Dentro de otro programa: solo vale si es la carpeta del programa objetivo anidada (p. ej. un juego en Steam)
                if not (self.target_loc and is_within(self.target_loc, loc) and is_within(n, self.target_loc)):
                    return f"Pertenece a «{name}», que sigue instalado", False
        for dll, count in self.shared_dlls.items():
            if count > 1 and is_within(dll, n):
                return "Contiene archivos compartidos con otros programas (SharedDLLs)", False
        personal = any(is_within(n, r) for r in self.personal)
        desk = kf("Desktop")
        if desk and is_within(n, desk) and os.path.isdir(path):
            personal = True
        return None, personal

    # -------------------------------------------------------------- registro
    def check_reg(self, ref):
        return reg_rule(ref)


# ================================================================ registro
_SW_BLOCK = {"microsoft", "classes", "policies", "wow6432node", "clients", "registeredapplications",
             "odbc", "intel", "nvidia corporation", "realtek", "amd", "ati technologies", "khronos",
             "wow6432node", "partner", "regex"}
_CLASSES_BLOCK = {"*", "directory", "folder", "drive", "allfilesystemobjects", "clsid", "interface", "typelib",
                  "appid", "installer", "wow6432node", "applications", "systemfileassociations", "mime",
                  "local settings", "protocols", "exefile", "lnkfile", "batfile", "cmdfile", "comfile",
                  "dllfile", "msi.package", "unknown", "http", "https", "ftp", "mailto", "file", "network",
                  "drivefile", "zapfile", "inffile", "regfile", "txtfile", "htmlfile", "jsfile", "vbsfile",
                  "microsoft.powershellscript.1", "progid"}
_GUID = r"\{[0-9a-f-]{36}\}"
_CV = r"software\\(?:wow6432node\\)?microsoft\\windows\\currentversion"


def _canon(ref):
    """Ruta canonica en minusculas: 'hkcu\\software\\x' (HKU\\SID se trata como HKCU)."""
    hive, path = ref.hive.upper(), ref.path.lower().strip("\\")
    if hive == "HKU":
        parts = path.split("\\", 1)
        hive, path = "HKCU", (parts[1] if len(parts) > 1 else "")
    if hive == "HKCR":
        hive, path = "HKLM", "software\\classes\\" + path
    return hive.lower(), path


def reg_rule(ref):
    """Motivo de bloqueo o None si la clave/valor es eliminable."""
    hive, p = _canon(ref)
    parts = p.split("\\") if p else []
    is_val = ref.value is not None
    if len(parts) < 2 and not is_val:
        return "Clave raíz del registro"
    # valores que se pueden quitar uno a uno
    if is_val:
        if re.fullmatch(_CV + r"\\(run|runonce|runonceex)", p):
            return None
        if re.fullmatch(_CV + r"\\explorer\\startupapproved\\[^\\]+", p):
            return None
        if re.fullmatch(_CV + r"\\shareddlls", p):
            return None
        if re.fullmatch(r"software\\classes\\\.[^\\]+\\openwithprogids", p):
            return None
        if re.fullmatch(r"software\\classes\\applications\\[^\\]+", p):
            return None
        if re.fullmatch(r"software\\registeredapplications", p) or re.fullmatch(
                r"software\\wow6432node\\registeredapplications", p):
            return None
        if p.startswith("software\\") and len(parts) >= 3 and parts[1] not in _SW_BLOCK:
            return None
        return "Valor en zona protegida del registro"
    # claves
    if re.fullmatch(_CV + r"\\uninstall\\[^\\]+", p) or re.fullmatch(_CV + r"\\app paths\\[^\\]+", p):
        return None
    if re.fullmatch(_CV + r"\\installer\\userdata\\[^\\]+\\products\\[0-9a-f]{32}", p):
        return None
    if hive == "hklm" and re.fullmatch(r"system\\(currentcontrolset|controlset00\d)\\services\\[^\\]+", p):
        return service_rule(parts[-1])
    if p.startswith("software\\classes\\") or p.startswith("software\\wow6432node\\classes\\"):
        rest = p.split("classes\\", 1)[1].split("\\")
        head = rest[0]
        if head in ("clsid", "appid", "typelib") and len(rest) == 2 and re.fullmatch(_GUID, rest[1]):
            return None
        if head == "installer" and len(rest) == 3 and rest[1] in ("products", "features", "upgradecodes") \
                and re.fullmatch(r"[0-9a-f]{32}", rest[2]):
            return None
        if head == "applications" and len(rest) == 2 and rest[1].endswith(".exe"):
            return None
        if len(rest) == 1 and head and not head.startswith(".") and head not in _CLASSES_BLOCK \
                and not head.startswith("windows.") and not head.startswith("microsoft."):
            return None
        return "Zona protegida del registro (Classes)"
    if p.startswith("software\\"):
        sub = parts[1] if parts[1] != "wow6432node" else (parts[2] if len(parts) > 2 else "")
        depth = len(parts) - (1 if parts[1] == "wow6432node" else 0)
        if not sub or sub in _SW_BLOCK:
            return "Zona protegida del registro"
        if sub == "appdatalow":
            return None if len(parts) >= 4 and parts[2] == "software" and parts[3] not in _SW_BLOCK else \
                "Zona protegida del registro"
        if depth >= 2:
            return None
    return "Zona protegida del registro"


# ================================================================ servicios
_CRITICAL_SVC = {"wuauserv", "bits", "cryptsvc", "eventlog", "rpcss", "lsm", "winmgmt", "windefend",
                 "mpssvc", "bfe", "dhcp", "dnscache", "netlogon", "schedule", "plugplay", "power",
                 "audiosrv", "audioendpointbuilder", "msiserver", "trustedinstaller", "wscsvc", "sense"}


def service_info(name):
    base = rf"SYSTEM\CurrentControlSet\Services\{name}"
    hk = winreg.HKEY_LOCAL_MACHINE
    return {
        "name": name,
        "start": registry.get_value(hk, base, "Start"),
        "type": registry.get_value(hk, base, "Type"),
        "image": registry.get_value(hk, base, "ImagePath") or "",
        "display": registry.get_value(hk, base, "DisplayName") or name,
    }


def service_rule(name, info=None):
    info = info or service_info(name)
    if name.lower() in _CRITICAL_SVC:
        return "Servicio esencial de Windows"
    typ, start = info.get("type"), info.get("start")
    if typ is None and start is None:
        return None  # ya no existe: la clave es un resto
    if isinstance(typ, int) and typ & 0x0F:
        return "Driver del sistema: solo lo puede quitar su desinstalador oficial"
    if isinstance(start, int) and start <= 1:
        return "Se carga al arrancar Windows: borrarlo podría impedir el arranque"
    img = norm_path(_image_path(info.get("image", "")))
    win = norm_path(kf("Windows"))
    if img and win and is_within(img, win):
        return "Servicio alojado en Windows"
    return None


def _image_path(cmd):
    cmd = os.path.expandvars((cmd or "").strip())
    if cmd.lower().startswith("\\systemroot\\"):
        cmd = os.path.join(kf("Windows") or r"C:\Windows", cmd[12:])
    if cmd.startswith('"'):
        return cmd[1:].split('"', 1)[0]
    m = re.match(r"(.+?\.(exe|sys|dll))\b", cmd, re.I)
    return m.group(1) if m else cmd.split(" ")[0]


image_path = _image_path


# ================================================================ programas
_PROTECTED_PROGRAMS = [
    ("security", "Antivirus / seguridad",
     r"kaspersky|avast|\bavg\b|norton|mcafee|\beset\b|bitdefender|malwarebytes|sophos|trend ?micro|panda dome|"
     r"avira|webroot|f-secure|comodo|zonealarm|windows defender|microsoft defender|360 total security|gdata|g data"),
    ("runtime", "Componente compartido (otros programas dependen de él)",
     r"visual c\+\+|\.net (runtime|framework|desktop runtime)|desktop runtime|asp\.net|directx|webview2|"
     r"microsoft windows desktop runtime|vcredist|redistributable|java\(tm\)|java \d+|openjdk|python launcher|"
     r"microsoft gameinput|windows sdk|windows software development kit|universal crt|msvc|xna framework|"
     r"physx|vulkan runtime|openal|microsoft update health|windows pc health|application compatibility"),
    ("driver", "Driver o software de hardware",
     r"driver|controlador|chipset|nvidia|realtek|intel\(r\)|intel .*(management|serial|graphics|wireless|"
     r"bluetooth|rapid)|amd (chipset|software|radeon)|radeon|thunderbolt|bluetooth|touchpad|synaptics|elan |"
     r"dolby|asio|framework service|armoury|aura (service|lighting)|rog live|asus .*service|logitech g hub|"
     r"razer synapse|icue|wintun|tap-windows|npcap|winpcap|usb|vbcable|vb-audio|virtual audio"),
    ("network", "Red / VPN (instala drivers de red)", r"\bvpn\b|wireguard|openvpn|zerotier|tailscale|hamachi"),
    ("windows", "Componente de Windows",
     r"^microsoft edge|^microsoft onedrive|^windows |^microsoft windows|^update for|^security update|"
     r"^microsoft 365|^microsoft office|^office 16|click-to-run|^copilot$|^microsoft teams"),
]


def classify_program(p):
    """Devuelve dict con categoria protegida o None."""
    text = f"{p.get('name', '')} | {p.get('publisher', '')}".lower()
    for cat, label, rx in _PROTECTED_PROGRAMS:
        if re.search(rx, text):
            return {"category": cat, "label": label, "no_force": True,
                    "scan_level_max": "safe" if cat in ("security", "windows", "runtime") else "moderate"}
    if "microsoft" in (p.get("publisher") or "").lower():
        return {"category": "microsoft", "label": "Software de Microsoft", "no_force": False,
                "scan_level_max": "moderate"}
    return None
