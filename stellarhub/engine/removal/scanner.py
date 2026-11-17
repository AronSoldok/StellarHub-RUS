"""Escaner de restos con puntuacion de confianza (0-100).

Cada candidato acumula evidencias; todo pasa despues por safety.Context, que puede bloquearlo.
Ver minirevo_docs/DISENO.md para la tabla de puntuaciones y las reglas.
"""
import functools
import os
import re
import time

from . import index, paths, registry, safety
from . import programs as progmod
from .paths import is_within, kf, norm_name, norm_path
from .registry import V32, V64, RegRef

LEVELS = {"safe": 90, "moderate": 70, "advanced": 50}
LEVEL_ORDER = ["safe", "moderate", "advanced"]
PRESELECT = 85

COMMON = {
    "notepad", "photos", "update", "updater", "player", "studio", "launcher", "service", "services", "driver",
    "client", "helper", "tools", "tool", "manager", "browser", "editor", "plugin", "plugins", "audio", "video",
    "music", "games", "game", "media", "cloud", "sync", "agent", "apps", "data", "cache", "logs", "temp",
    "config", "settings", "common", "shared", "runtime", "framework", "engine", "desktop", "portal", "center",
    "control", "panel", "system", "windows", "microsoft", "google", "files", "program", "programs", "setup",
    "install", "installer", "uninstall", "support", "drivers", "help", "docs", "documents", "user", "users",
    "local", "global", "default", "public", "backup", "backups", "downloads", "download", "assets", "resources",
    "bin", "lib", "plugins", "presets", "preset", "sounds", "samples", "projects", "library", "packages",
    "package", "store", "office", "security", "network", "mail", "chat", "phone", "camera", "photo", "image",
    "images", "converter", "recorder", "viewer", "reader", "monitor", "assistant", "connect", "link", "hub",
    "home", "power", "light", "lighting", "remote", "mobile", "device", "devices", "printer", "scanner",
    "edge", "dawn", "medal", "brave", "copilot", "terminal", "python", "node", "java", "steam",
}
_VERSION = re.compile(
    r"(\s*[-–]\s*)?\s*(\bversion\b|\bversión\b|\bv)?\s*\d+(\.\d+)+[\w.\-]*|\s*\((x64|x86|64-bit|32-bit|64 bit|"
    r"32 bit|amd64|arm64|user|usuario|[a-z]{2}-[a-z]{2})[^)]*\)|\s+(x64|x86|64-bit|32-bit|amd64|arm64)\b|"
    r"\s+-\s+[a-z]{2}-[a-z]{2}$", re.I)
_PUB_SUFFIX = re.compile(r"[,.]?\s*\b(inc|incorporated|ltd|llc|gmbh|corp|corporation|co|company|limited|s\.?a|ag|"
                         r"bv|b\.v|pty|srl|s\.l|sl|oy|ab|as|kg|plc|software|technologies|technology|"
                         r"semiconductor|computer)\b\.?", re.I)
_BUNDLE_EXT = (".vst3", ".clap", ".aaxplugin", ".vst", ".bundle", ".component")


@functools.lru_cache(maxsize=65536)
def strip_version(name):
    prev = None
    s = name
    while s != prev:
        prev = s
        s = _VERSION.sub("", s).strip(" -–_,")
    return s


def publisher_tokens(pub):
    out = set()
    if not pub:
        return out
    clean = _PUB_SUFFIX.sub("", pub).strip(" ,.")
    for cand in (pub, clean, clean.split(" ")[0] if clean else ""):
        t = norm_name(cand)
        if len(t) >= 4 and t not in COMMON:
            out.add(t)
    return out


def name_tokens(p):
    """Tokens de nombre de un programa: {token: (puntos, motivo)}. Copia nueva: quien llama puede cambiarla."""
    return dict(_name_tokens(p.get("name", ""), p.get("publisher") or ""))


@functools.lru_cache(maxsize=4096)
def _name_tokens(name, publisher):
    p = {"name": name, "publisher": publisher}
    tokens = {}

    def add(tok, pts, why):
        if len(tok) >= 3 and (tok not in tokens or tokens[tok][0] < pts):
            tokens[tok] = (pts, why)

    name = p.get("name", "")
    stripped = strip_version(name)
    add(norm_name(name), 85, "nombre completo")
    add(norm_name(stripped), 82, "nombre sin versión")
    add(norm_name(re.sub(r"\s+\d+$", "", stripped)), 72, "nombre sin número de versión")
    # nombre sin el fabricante: "Xfer Records Serum 2" -> "Serum 2"
    pub_words = [w for w in re.split(r"[\s,]+", _PUB_SUFFIX.sub("", p.get("publisher") or "")) if w]
    for i in range(len(pub_words), 0, -1):
        prefix = " ".join(pub_words[:i])
        if prefix and stripped.lower().startswith(prefix.lower() + " "):
            prod = stripped[len(prefix):].strip()
            add(norm_name(prod), 76, "nombre del producto")
            add(norm_name(re.sub(r"\s+\d+$", "", prod)), 68, "nombre del producto sin número")
            break
    return tokens


class Identity:
    """Todo lo que identifica a un programa: nombres, fabricante, carpetas, ejecutables."""

    def __init__(self, p, all_programs=()):
        self.p = p
        name = p.get("name", "")
        self.tokens = name_tokens(p)  # token -> (puntos, motivo)

        def add(tok, pts, why):
            if len(tok) >= 3 and (tok not in self.tokens or self.tokens[tok][0] < pts):
                self.tokens[tok] = (pts, why)

        full = norm_name(name)
        self.vendor = publisher_tokens(p.get("publisher"))
        if p.get("source") == "store":
            add(norm_name(p.get("package_name", "")), 90, "paquete de la Tienda")
            fam = p.get("family", "")
            if fam:
                add(norm_name(fam), 95, "familia del paquete")
        # ejecutables principales
        self.locations = []        # normalizadas (para comparar)
        self.location_paths = []   # tal cual (para mostrar y borrar)
        loc = p.get("location")
        if loc and os.path.isabs(loc) and norm_path(loc) not in safety.protected_exact():
            self.locations.append(norm_path(loc))
            self.location_paths.append(os.path.normpath(loc))
        self.exes = set()
        if loc and os.path.isdir(loc):
            try:
                for f in os.listdir(loc):
                    if f.lower().endswith(".exe") and not re.match(r"(unins|uninst|setup|update|crash|helper|"
                                                                   r"vc_?redist|dotnet)", f, re.I):
                        t = norm_name(f[:-4])
                        if len(t) >= 4:
                            self.exes.add(f.lower())
                            add(t, 70, "nombre del ejecutable")
            except OSError:
                pass
        # tokens que tambien identifican a OTROS programas instalados -> no valen
        # (FabFilter Pro-C 2 y Pro-C 3 comparten "pro-c": ninguno de los dos puede reclamarlo)
        self.shared = {}
        mine = set(self.tokens)
        self.foreign_locs = []
        for o in all_programs:
            if o.get("id") == p.get("id"):
                continue
            for t in name_tokens(o):
                if t in mine:
                    self.shared[t] = o.get("name", "")
            ol = norm_path(o.get("location"))
            # carpetas de otros programas iguales o anidadas dentro de la nuestra (Wallpaper Engine en Steam)
            if ol and ol not in safety.protected_exact() and any(is_within(ol, l) for l in self.locations):
                self.foreign_locs.append(ol)
        # InstallLocation que en realidad es la carpeta del FABRICANTE (Epic Games\ con juegos dentro):
        # se reduce a las subcarpetas que coinciden con el producto (Epic Games\Launcher)
        self.vendor_location = ""
        if self.locations and self.is_vendor(os.path.basename(self.locations[0])):
            self.vendor_location = self.location_paths[0]
            narrowed = []
            for e in _safe_listdir(self.vendor_location):
                full = os.path.join(self.vendor_location, e)
                m = self.match(e, in_vendor=True)
                if os.path.isdir(full) and m and m[0] >= 70:
                    narrowed.append(full)
            self.location_paths = narrowed
            self.locations = [norm_path(x) for x in narrowed]
            self.exes = set()
        if any(fl in self.locations for fl in self.foreign_locs):
            # carpeta compartida con otra entrada: sus .exe no identifican a este programa
            for exe in self.exes:
                t = norm_name(exe[:-4])
                if self.tokens.get(t, (0, ""))[1] == "nombre del ejecutable":
                    del self.tokens[t]
            self.exes = set()
        for t in list(self.tokens):
            if t in self.shared and t != full:
                del self.tokens[t]
            elif t in self.shared:  # el nombre completo identico en dos entradas: muy debil
                self.tokens[t] = (60, self.tokens[t][1] + ", compartido con «" + self.shared[t] + "»")

    def match(self, entry_name, in_vendor=False):
        """(puntos, motivo) si el nombre coincide, si no None."""
        stem = entry_name
        low = stem.lower()
        for ext in _BUNDLE_EXT + (".lnk", ".url", ".exe", ".dll", ".ini", ".log", ".json", ".xml", ".dat", ".cfg"):
            if low.endswith(ext):
                stem = stem[: -len(ext)]
                break
        n = norm_name(stem)
        if not n:
            return None
        hit = self.tokens.get(n)
        if not hit:
            hit2 = self.tokens.get(norm_name(strip_version(stem)))
            if hit2:
                hit = (hit2[0] - 4, hit2[1] + " (otra versión)")
        if not hit:
            return None
        pts, why = hit
        if (len(n) < 5 or n in COMMON) and not in_vendor:
            pts -= 30
            why += ", nombre corto o genérico"
        if in_vendor:
            pts = min(pts + 10, 95)
        return pts, why

    def is_vendor(self, entry_name):
        n = norm_name(entry_name)
        return bool(n) and (n in self.vendor or any(len(v) >= 5 and n == v for v in self.vendor))

    def refs_location(self, text):
        """True si el texto apunta a NUESTRA carpeta (y no a la de otro programa anidado o igual)."""
        if not text or not self.locations:
            return False
        t = os.path.expandvars(str(text)).lower().replace("/", "\\")
        if any(_contains_path(t, fl) for fl in self.foreign_locs):
            return False
        return any(_contains_path(t, loc) for loc in self.locations)


def _is_game_library(d):
    """Carpeta con juegos dentro (Steam, Epic, GOG...): nunca se preselecciona."""
    for marker in ("steamapps", "SteamLibrary", ".egstore", "GOG Games"):
        if os.path.exists(os.path.join(d, marker)):
            return True
    try:
        return any(os.path.exists(os.path.join(d, e, ".egstore")) for e in os.listdir(d)[:200])
    except OSError:
        return False


def _safe_listdir(d):
    try:
        return os.listdir(d)
    except OSError:
        return []


def _contains_path(t, loc):
    i = t.find(loc)
    while i != -1:
        end = i + len(loc)
        if end == len(t) or t[end] in '\\"\', ;|':
            return True
        i = t.find(loc, i + 1)
    return False


class Scanner:
    def __init__(self, program, all_programs, level="moderate", still_installed=None, progress=None):
        self.p = program
        self.all = list(all_programs)
        cap = (program.get("protected") or {}).get("scan_level_max")
        if cap and LEVEL_ORDER.index(level) > LEVEL_ORDER.index(cap):
            level = cap
        self.level = level
        self.id = Identity(program, self.all)
        self.ctx = safety.Context(target=program, programs=self.all)
        self.items = {}
        self.progress = progress or (lambda *a: None)
        self.still_installed = still_installed if still_installed is not None else self._still_installed()
        self.vendor_dirs = set()

    # ---------------------------------------------------------- utilidades
    def _still_installed(self):
        if self.p.get("source") == "store":
            return False
        key = self.p.get("key")
        return bool(key) and registry.key_exists(RegRef.from_str(key))

    def add(self, kind, target, score, reason, display=None, group=None, extra=None):
        if score < LEVELS["advanced"]:
            return
        if kind in ("folder", "file"):
            target = os.path.normpath(target)
            display = display or target
        key = f"{kind}:{target.lower() if isinstance(target, str) else target}"
        it = self.items.get(key)
        if it:
            if score > it["score"]:
                it["score"] = score
            if reason not in it["reasons"]:
                it["reasons"].append(reason)
            return
        self.items[key] = {"kind": kind, "target": target, "score": score, "reasons": [reason],
                           "display": display or target, "group": group, **(extra or {})}

    # ---------------------------------------------------------- archivos
    def _listdir(self, d):
        try:
            return os.listdir(d)
        except OSError:
            return []

    @staticmethod
    def _entries(d):
        """(nombre, ruta, es_carpeta) sin una llamada extra por entrada: el tipo viene del propio listado.

        Enlaces y junctions se comprueban con isdir (siguen el enlace, igual que antes), porque un
        junction roto figura como carpeta en el listado pero isdir dice que no.
        """
        out = []
        try:
            with os.scandir(d) as it:
                for e in it:
                    try:
                        if e.is_symlink() or e.is_junction():
                            isd = os.path.isdir(e.path)
                        else:
                            isd = e.is_dir(follow_symlinks=False)
                    except OSError:
                        isd = False
                    out.append((e.name, e.path, isd))
        except OSError:
            pass
        return out

    def scan_dir(self, root, vendor_depth=True, label="", bonus=0):
        if not root or not os.path.isdir(root):
            return
        for e, full, is_dir in self._entries(root):
            m = self.id.match(e)
            if m and bonus and m[0] >= 70:
                m = (min(m[0] + bonus, 95), m[1])
            if m:
                self.add("folder" if is_dir else "file", full, m[0], f"Nombre coincide ({m[1]}){label}")
            elif is_dir and vendor_depth and self.id.is_vendor(e):
                self.vendor_dirs.add(full)
                for e2 in self._listdir(full):
                    m2 = self.id.match(e2, in_vendor=True)
                    if m2:
                        f2 = os.path.join(full, e2)
                        self.add("folder" if os.path.isdir(f2) else "file", f2, m2[0],
                                 f"Dentro de la carpeta del fabricante ({m2[1]}){label}")

    def scan_files(self):
        k = paths.known_folders()
        pf, pf86, cf, cf86 = k.get("ProgramFiles"), k.get("ProgramFilesX86"), k.get("ProgramFilesCommon"), \
            k.get("ProgramFilesCommonX86")
        local, roam = k.get("LocalAppData"), k.get("RoamingAppData")
        # carpeta de instalacion
        for loc in self.id.location_paths:
            if os.path.exists(loc):
                if self.id.vendor_location:
                    self.add("folder", loc, 90, "Carpeta del producto dentro de la carpeta de instalación del fabricante",
                             extra={"is_location": True})
                elif self.p.get("location_inferred"):
                    self.add("folder", loc, 80, "Carpeta deducida del icono o del desinstalador",
                             extra={"is_location": True})
                else:
                    self.add("folder", loc, 100, "Carpeta de instalación del programa", extra={"is_location": True})
        if self.id.vendor_location:
            self.vendor_dirs.add(self.id.vendor_location)
        # archivos del desinstalador fuera de la carpeta (Inno: unins000.exe + .dat)
        u = progmod.exe_from_command(self.p.get("uninstall"))
        if u and os.path.isfile(u) and not any(is_within(u, l) for l in self.id.locations) and \
                self.p.get("kind") == "inno":
            for f in (u, u[:-4] + ".dat", u[:-4] + ".msg"):
                if os.path.isfile(f):
                    self.add("file", f, 95, "Desinstalador del programa")
        roots = [pf, pf86, cf, cf86, k.get("ProgramData"), local, roam, k.get("LocalAppDataLow"),
                 os.path.join(local, "Programs") if local else None, k.get("UserProgramFiles")]
        for r in roots:
            self.scan_dir(r)
        # plugins de audio
        for r in [os.path.join(cf, "VST3") if cf else None, os.path.join(cf, "VST2") if cf else None,
                  os.path.join(cf, "VST") if cf else None, os.path.join(cf, "CLAP") if cf else None,
                  os.path.join(cf, "Avid", "Audio", "Plug-Ins") if cf else None,
                  os.path.join(pf, "VSTPlugins") if pf else None, os.path.join(pf, "Steinberg", "VSTPlugins") if pf else None,
                  os.path.join(pf86, "VSTPlugins") if pf86 else None, os.path.join(pf86, "Steinberg", "VSTPlugins") if pf86 else None,
                  os.path.join(cf86, "VST3") if cf86 else None]:
            self.scan_dir(r, label=" · plugin de audio", bonus=10)
        # temporales
        self.scan_dir(k.get("Temp"), vendor_depth=False, label=" · temporal")
        # datos personales (nunca preseleccionados)
        for r in (k.get("Documents"), k.get("SavedGames")):
            self.scan_dir(r, label=" · datos del usuario")
        # carpetas de WinGet
        if local:
            wg = os.path.join(local, "Microsoft", "WinGet", "Packages")
            kn = norm_name(self.p.get("keyname", "").split("_")[0])
            for e in self._listdir(wg):
                if kn and norm_name(e.split("_")[0]) == kn:
                    self.add("folder", os.path.join(wg, e), 95, "Paquete de WinGet del programa")
        # Tienda: datos de la app
        if self.p.get("source") == "store" and self.p.get("family") and local:
            d = os.path.join(local, "Packages", self.p["family"])
            if os.path.isdir(d):
                self.add("folder", d, 95, "Datos de la app de la Tienda", extra={"store_data": True})

    def scan_shortcuts(self):
        k = paths.known_folders()
        roots = [k.get("Programs"), k.get("CommonPrograms")]
        for r in roots:
            self.scan_dir(r, label=" · menú Inicio")
        for f, info in index.shortcut_files():
            tgt = info.get("target", "")
            if self.id.refs_location(tgt) or self.id.refs_location(info.get("workdir")):
                self.add("file", f, 95, "Acceso directo que apunta al programa", group="Accesos directos")
            elif tgt and os.path.isabs(tgt) and not os.path.exists(tgt) and not tgt.lower().startswith(
                    ("http", "steam:", "com.epicgames")) and self.id.match(os.path.basename(f)):
                self.add("file", f, 90, "Acceso directo roto con el nombre del programa", group="Accesos directos")
            else:
                m = self.id.match(os.path.basename(f))
                if m:
                    self.add("file", f, m[0], f"Acceso directo con el nombre del programa ({m[1]})",
                             group="Accesos directos")
        # carpetas del menu Inicio que quedan vacias tras quitar sus accesos
        for r in roots:
            for e in self._listdir(r):
                d = os.path.join(r, e) if r else None
                if d and os.path.isdir(d):
                    inner = [os.path.join(dp, f) for dp, _, fn in os.walk(d) for f in fn
                             if f.lower() != "desktop.ini"]
                    if inner and all(f"file:{x.lower()}" in self.items for x in inner):
                        self.add("folder", d, 92, "Carpeta del menú Inicio solo con accesos del programa",
                                 group="Accesos directos")

    # ---------------------------------------------------------- registro
    def _reg_add(self, ref, score, reason, group="Registro"):
        self.add("regvalue" if ref.value is not None else "regkey", ref.to_str(), score, reason,
                 display=ref.display(), group=group)

    def scan_registry_names(self):
        roots = [("HKCU", "Software", 0), ("HKLM", "SOFTWARE", V64), ("HKLM", "SOFTWARE", V32),
                 ("HKCU", r"Software\AppDataLow\Software", 0)]
        for hive, base, view in roots:
            for sub in registry.subkeys(registry.HIVES[hive], base, view):
                m = self.id.match(sub)
                if m:
                    self._reg_add(RegRef(hive, f"{base}\\{sub}", view), m[0], f"Clave con el nombre del programa ({m[1]})")
                elif self.id.is_vendor(sub):
                    vend = f"{base}\\{sub}"
                    children = registry.subkeys(registry.HIVES[hive], vend, view)
                    hits = 0
                    for s2 in children:
                        m2 = self.id.match(s2, in_vendor=True)
                        if m2:
                            hits += 1
                            self._reg_add(RegRef(hive, f"{vend}\\{s2}", view), m2[0],
                                          f"Clave del producto dentro del fabricante ({m2[1]})")
                    if children and hits == len(children) and not registry.values(registry.HIVES[hive], vend, view):
                        self._reg_add(RegRef(hive, vend, view), 60, "Clave del fabricante que quedaría vacía")

    def scan_registry_refs(self):
        p = self.p
        # entrada de desinstalacion
        if p.get("key"):
            ref = RegRef.from_str(p["key"])
            if registry.key_exists(ref):
                self.add("regkey", ref.to_str(), 100, "Entrada de desinstalación del programa",
                         display=ref.display(), group="Registro", extra={"is_uninstall_key": True})
        others = {o.get("id") for o in self.all if o.get("id") != p.get("id")}
        for hive, view, kn, path, vals in index.uninstall_entries():
            if f"{hive}|{view}|{kn}" in others or f"{hive}|{view}|{kn}" == p.get("id"):
                continue
            if any(self.id.refs_location(vals.get(x)) for x in ("InstallLocation", "UninstallString", "DisplayIcon")):
                self._reg_add(RegRef(hive, path, view), 90, "Entrada de desinstalación oculta que apunta al programa")
        # App Paths
        for hive, view, path, sub, default, extra_path in index.app_paths():
            if self.id.refs_location(default) or self.id.refs_location(extra_path):
                self._reg_add(RegRef(hive, path, view), 95, "Registro de la ruta del ejecutable (App Paths)")
            elif sub.lower() in self.id.exes:
                self._reg_add(RegRef(hive, path, view), 75, "App Paths con el nombre del ejecutable")
        # Run / RunOnce + StartupApproved
        approved = index.startup_approved()
        for hive, base, view, name, data in index.run_values():
            if self.id.refs_location(data):
                score = 95
            else:
                m = self.id.match(name)
                score = m[0] if m else 0
            if score >= LEVELS["advanced"]:
                self._reg_add(RegRef(hive, base, view, name), min(score, 95), "Se inicia con Windows", group="Inicio")
                for shive, sbase, sname, _ in approved.get(name.lower(), []):
                    if shive == hive:
                        self._reg_add(RegRef(shive, sbase, 0, sname), min(score, 90), "Estado de inicio del programa",
                                      group="Inicio")
        # servicios
        for s in index.services():
            score = 0
            if self.id.refs_location(s["exe"]) or self.id.refs_location(s["image"]):
                score, why = 95, "Servicio que ejecuta un archivo del programa"
            else:
                m = self.id.match(s["name"]) or self.id.match(s["display"])
                win = kf("Windows")
                if m and m[0] >= 80 and not (win and is_within(s["exe"], win)):
                    score, why = min(m[0], 85), f"Servicio con el nombre del programa ({m[1]})"
            if score:
                self.add("service", s["name"], score, why, display=f"Servicio: {s['display']} ({s['name']})",
                         group="Servicios y tareas", extra={"service": s})
        # tareas programadas
        for t in index.tasks():
            if t["path"].lower().startswith("\\microsoft\\"):
                continue
            if any(self.id.refs_location(c) or self.id.refs_location(a) for c, a in t["commands"]):
                score, why = 95, "Tarea programada que ejecuta el programa"
            else:
                m = self.id.match(t["name"].split("_{")[0].split("-S-1-5")[0])
                if not m:
                    continue
                score, why = min(m[0], 85), f"Tarea con el nombre del programa ({m[1]})"
            self.add("task", t["path"], score, why, display=f"Tarea: {t['path']}", group="Servicios y tareas")
        # SharedDLLs con contador 1 dentro de la carpeta
        for view, base, name, data in index.shared_dlls():
            if self.id.refs_location(name) and str(data) in ("0", "1"):
                self._reg_add(RegRef("HKLM", base, view, name), 92, "Contador de archivo compartido (solo lo usa este programa)")
        # reglas del firewall
        for name, data in index.firewall_rules():
            m = re.search(r"\|App=([^|]+)", str(data))
            if m and self.id.refs_location(m.group(1)):
                nm = re.search(r"\|Name=([^|]+)", str(data))
                self.add("fwrule", name, 95, "Regla del firewall para el programa",
                         display=f"Firewall: {nm.group(1) if nm else name}", group="Servicios y tareas",
                         extra={"fw_data": str(data)})
        # entradas del PATH
        for scope, entry in index.env_paths():
            if self.id.refs_location(entry):
                self.add("envpath", f"{scope}|{entry}", 95, "Entrada del PATH dentro de la carpeta del programa",
                         display=f"PATH ({'usuario' if scope == 'user' else 'sistema'}): {entry}", group="Registro")
        # registro de Windows Installer
        code = p.get("msi_code")
        if code and not progmod.msi_installed(code):
            packed = progmod.pack_guid(code)
            if packed:
                for ref in (RegRef("HKLM", rf"SOFTWARE\Classes\Installer\Products\{packed}"),
                            RegRef("HKLM", rf"SOFTWARE\Classes\Installer\Features\{packed}"),
                            RegRef("HKCU", rf"Software\Microsoft\Installer\Products\{packed}"),
                            RegRef("HKLM", rf"SOFTWARE\Microsoft\Windows\CurrentVersion\Installer\UserData\S-1-5-18\Products\{packed}", V64)):
                    if registry.key_exists(ref):
                        self._reg_add(ref, 95, "Registro de Windows Installer de un producto ya desinstalado")

    def scan_classes(self):
        """ProgIDs, CLSIDs y asociaciones que apuntan al programa (nivel moderado o superior)."""
        if not self.id.locations:
            return
        cl = index.classes()
        progids = set()
        for hive, base, sub, cmd, icon in cl["progids"]:
            if self.id.refs_location(cmd) or self.id.refs_location(icon):
                progids.add(sub.lower())
                self._reg_add(RegRef(hive, f"{base}\\{sub}"), 90, "Tipo de archivo registrado por el programa")
        for hive, exe in cl["apps"]:
            if exe in self.id.exes:
                base = r"SOFTWARE\Classes" if hive == "HKLM" else r"Software\Classes"
                self._reg_add(RegRef(hive, rf"{base}\Applications\{exe}"), 85,
                              "Registro de la aplicación para «Abrir con»")
        for hive, cp, server in cl["clsids"]:
            if self.id.refs_location(server):
                self._reg_add(RegRef(hive, cp), 92, "Componente COM del programa")
        for hive, base, ext, name in cl["openwith"]:
            if name.lower() in progids:
                self._reg_add(RegRef(hive, rf"{base}\{ext}\OpenWithProgids", 0, name), 90,
                              f"Asociación de archivos {ext}")

    # ---------------------------------------------------------- final
    def finish(self):
        out = []
        min_score = LEVELS[self.level]
        # carpeta del fabricante que quedaria vacia
        for vd in self.vendor_dirs:
            inner = self._listdir(vd)
            if inner and all(any(k.endswith(os.path.join(vd, e).lower()) for k in self.items) for e in inner):
                self.add("folder", vd, 60, "Carpeta del fabricante que quedaría vacía")
        items = list(self.items.values())
        # quitar lo que ya esta contenido en otro elemento con igual o mayor confianza
        paths_sel = sorted([i for i in items if i["kind"] == "folder"], key=lambda i: len(i["target"]))
        regs_sel = sorted([i for i in items if i["kind"] == "regkey"], key=lambda i: len(i["target"]))
        for it in items:
            if it["kind"] in ("folder", "file"):
                for par in paths_sel:
                    if par is not it and is_within(it["target"], par["target"]) and par["score"] >= it["score"]:
                        it["covered"] = True
                        break
            elif it["kind"] in ("regkey", "regvalue"):
                r = RegRef.from_str(it["target"])
                for par in regs_sel:
                    pr = RegRef.from_str(par["target"])
                    if par is it or pr.hive != r.hive or pr.view != r.view:
                        continue
                    if (r.path.lower() + "\\").startswith(pr.path.lower() + "\\") and par["score"] >= it["score"] \
                            and (r.value is not None or r.path.lower() != pr.path.lower()):
                        it["covered"] = True
                        break
        n = 0
        for it in items:
            if it.get("covered") or it["score"] < min_score:
                continue
            blocked, personal = None, False
            if it["kind"] in ("folder", "file"):
                blocked, personal = self.ctx.check_path(it["target"])
                if not os.path.lexists(it["target"]):
                    continue
                if paths.is_reparse_point(it["target"]):
                    it["reasons"].append("Es un enlace: solo se quitará el enlace, no su contenido")
                if not blocked and it["kind"] == "folder" and _is_game_library(it["target"]):
                    personal = True
                    it["reasons"].append("Contiene una biblioteca de juegos")
                it["size"] = paths.path_size(it["target"]) if not blocked else 0
            elif it["kind"] in ("regkey", "regvalue"):
                blocked = safety.reg_rule(RegRef.from_str(it["target"]))
            elif it["kind"] == "service":
                blocked = safety.service_rule(it["target"], {k: it["service"][k] for k in ("type", "start", "image")})
                it.pop("service", None)
            elif it["kind"] == "task" and it["target"].lower().startswith("\\microsoft\\"):
                blocked = "Tarea de Microsoft"
            installed_part = self.still_installed and (it.get("is_location") or it.get("is_uninstall_key"))
            if installed_part:
                it["reasons"].append("El programa sigue instalado: márcalo solo si sabes que está roto")
            if personal:
                it["reasons"].append("Contiene datos tuyos (proyectos, presets, partidas…)")
            it.update({
                "id": f"i{n}", "blocked": blocked, "personal": personal,
                "level": next(l for l in LEVEL_ORDER if it["score"] >= LEVELS[l]),
                "selected": not blocked and not personal and not installed_part and it["score"] >= PRESELECT,
                "group": "Bloqueado por seguridad" if blocked else ("Datos personales" if personal else
                                                                    it.get("group") or _group(it["kind"])),
            })
            n += 1
            out.append(it)
        out.sort(key=lambda i: (bool(i["blocked"]), -i["score"], i["display"].lower()))
        return out

    def run(self):
        t0 = time.perf_counter()
        steps = [("Carpetas y archivos", self.scan_files), ("Accesos directos", self.scan_shortcuts),
                 ("Registro por nombre", self.scan_registry_names),
                 ("Servicios, tareas, inicio y firewall", self.scan_registry_refs)]
        if self.level != "safe":
            steps.append(("Tipos de archivo y componentes COM", self.scan_classes))
        for i, (label, fn) in enumerate(steps):
            self.progress(i / len(steps), label)
            try:
                fn()
            except Exception as e:  # un paso que falla no tumba el escaneo
                self.progress(i / len(steps), f"{label}: error {e}")
        self.progress(0.97, "Aplicando reglas de seguridad")
        items = self.finish()
        self.progress(1.0, "Listo")
        return {"items": items, "level": self.level, "elapsed": round(time.perf_counter() - t0, 2),
                "still_installed": self.still_installed,
                "total_size": sum(i.get("size", 0) for i in items if not i["blocked"])}


def _group(kind):
    return {"folder": "Archivos y carpetas", "file": "Archivos y carpetas", "regkey": "Registro",
            "regvalue": "Registro", "service": "Servicios y tareas", "task": "Servicios y tareas",
            "fwrule": "Servicios y tareas", "envpath": "Registro"}.get(kind, "Otros")


def scan(program, all_programs, level="moderate", still_installed=None, progress=None):
    return Scanner(program, all_programs, level, still_installed, progress).run()
