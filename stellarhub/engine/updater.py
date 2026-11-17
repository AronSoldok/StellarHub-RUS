"""Motor del Program Updater: todo lo que se puede actualizar en el equipo, de verdad.

- Programas, Tienda, componentes y herramientas de desarrollo: winget (tabla de `winget upgrade` y `winget list`).
  Los iconos salen del programa instalado (registro de desinstalación), con el mismo extractor que el Program Remover.
- Windows Update (software, no drivers): COM Microsoft.Update.Session (buscar, historial, instalar), pausa en el
  registro como hace Configuración, reinicio pendiente.
- Desarrollo: pip (del Python del usuario) y npm globales.
Las tareas largas (buscar e instalar) son JOBS con progreso real; buscar es de solo lectura.
"""
import ctypes
import json
import os
import re
import subprocess
import sys
import threading
import time
import winreg
from concurrent.futures import ThreadPoolExecutor

from .ps import ps_json, NO_WINDOW

EXPORTS = {"status", "notes", "pin", "unpin", "set_pause", "store_auto", "set_store_auto", "icon_for"}
JOBS = {"scan_apps", "scan_windows", "scan_dev", "install"}

# ---------------------------------------------------------------- utilidades
def _admin():
    try:
        return bool(ctypes.windll.shell32.IsUserAnAdmin())
    except Exception:
        return False


def _exe(name):
    from shutil import which
    return which(name) or which(name + ".exe") or which(name + ".cmd")


def _python():
    """El Python del usuario (no pythonw): el mismo con el que corre StellarHub."""
    exe = sys.executable
    if exe.lower().endswith("pythonw.exe"):
        cand = exe[:-11] + "python.exe"
        if os.path.exists(cand):
            return cand
    return exe


def _stream(cmd, on_text=None, job=None, timeout=None, env=None):
    """Ejecuta y entrega el texto a trozos partiendo por \\r y \\n (winget pinta las barras con \\r).
    Devuelve (código, salida). Si el job se cancela, mata el proceso."""
    p = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL,
                         creationflags=NO_WINDOW, env=env)
    out, buf = [], b""
    t0 = time.monotonic()
    while True:
        if job is not None and job.cancelled:
            p.kill()
            break
        if timeout and time.monotonic() - t0 > timeout:
            p.kill()
            break
        ch = p.stdout.read1(4096) if hasattr(p.stdout, "read1") else p.stdout.read(1)
        if not ch:
            break
        buf += ch
        parts = re.split(rb"[\r\n]", buf)
        buf = parts.pop()
        for raw in parts:
            s = raw.decode("utf-8", "replace")
            out.append(s)
            if on_text and s.strip():
                on_text(s)
    if buf:
        s = buf.decode("utf-8", "replace")
        out.append(s)
        if on_text and s.strip():
            on_text(s)
    try:
        p.wait(timeout=10)
    except subprocess.TimeoutExpired:
        p.kill()
    return p.returncode, "\n".join(out)


def _winget(args, timeout=180):
    exe = _exe("winget")
    if not exe:
        return None
    r = subprocess.run([exe, *args, "--accept-source-agreements", "--disable-interactivity"],
                       capture_output=True, timeout=timeout, creationflags=NO_WINDOW)
    return r.stdout.decode("utf-8", "replace")


def parse_table(text):
    """Tabla de winget a lista de dicts {name,id,version,available,source}. Columnas por posición de la cabecera
    (sirve en español e inglés y con anchos variables)."""
    lines = [ln.split("\r")[-1] for ln in text.splitlines()]
    hdr_i = next((i for i in range(len(lines) - 1) if re.match(r"^-{10,}\s*$", lines[i + 1] or "")), None)
    if hdr_i is None:
        return []
    hdr = lines[hdr_i]
    starts = [m.start() for m in re.finditer(r"\S+(?: \S+)*", hdr)]
    names = [m.group(0).lower() for m in re.finditer(r"\S+(?: \S+)*", hdr)]
    keys = []
    for n in names:
        if n in ("name", "nombre"):
            keys.append("name")
        elif n in ("id", "identificador"):
            keys.append("id")
        elif n in ("version", "versión"):
            keys.append("version")
        elif n in ("available", "disponible"):
            keys.append("available")
        elif n in ("source", "origen", "fuente"):
            keys.append("source")
        else:
            keys.append(n)
    rows = []
    for ln in lines[hdr_i + 2:]:
        if not ln.strip():
            break
        if len(ln) < starts[min(1, len(starts) - 1)]:
            break
        d = {}
        for j, k in enumerate(keys):
            a = starts[j]
            b = starts[j + 1] if j + 1 < len(starts) else len(ln)
            d[k] = ln[a:b].strip()
        if not d.get("id") or " " in d["id"] and not d["id"].startswith(("ARP\\", "MSIX\\")):
            # una línea de resumen ("14 upgrades available.") o algo que no es una fila
            if re.search(r"\d+ (upgrades|actualizaciones|package|paquete)", ln, re.I):
                break
            continue
        rows.append(d)
    return rows


# ---------------------------------------------------------------- categorías
RUNTIME_RE = re.compile(r"^(Microsoft\.(DotNet|VCRedist|EdgeWebView2Runtime|DirectX|WindowsAppRuntime|UI\.Xaml|VCLibs)|"
                        r"EclipseAdoptium\.|Oracle\.JavaRuntime|Oracle\.JDK|Microsoft\.OpenJDK|Azul\.|Amazon\.Corretto)", re.I)
DEV_RE = re.compile(r"^(Python\.Python|OpenJS\.NodeJS|Git\.Git|GitHub\.(cli|GitHubDesktop)|Microsoft\.PowerShell|astral-sh\.|"
                    r"Microsoft\.WSL|Kitware\.CMake|Rustlang\.|GoLang\.|CoreyButler\.NVMforWindows|Yarn\.|pnpm\.|Docker\.)", re.I)
STORE_IDS = {"microsoft.appinstaller", "microsoft.windowsterminal"}


def _category(row):
    i = row.get("id", "")
    if (row.get("source") or "").lower() == "msstore" or i.lower() in STORE_IDS or i.startswith("MSIX\\"):
        return "store"
    if RUNTIME_RE.match(i):
        return "runtimes"
    if DEV_RE.match(i):
        return "dev"
    return "apps"


# ---------------------------------------------------------------- iconos y editor (del programa instalado)
_prog_idx = None
_prog_lock = threading.Lock()


def _norm(s):
    s = (s or "").lower().replace("…", "")
    s = re.sub(r"\(.*?\)|v?\d+(\.\d+)+|x64|x86|64-bit|32-bit", " ", s)
    return re.sub(r"[^a-z0-9áéíóúñü]+", "", s)


def _programs():
    global _prog_idx
    with _prog_lock:
        if _prog_idx is None:
            from .removal import programs
            try:
                progs = programs.get_win32_programs()
            except Exception:
                progs = []
            try:
                progs += programs.cached_store_apps() or []
            except Exception:
                pass
            by_key = {p.get("keyname", "").lower(): p for p in progs if p.get("keyname")}
            by_name = {}
            for p in progs:
                by_name.setdefault(_norm(p["name"]), p)
            _prog_idx = (progs, by_key, by_name)
        return _prog_idx


def _match(row):
    progs, by_key, by_name = _programs()
    rid = row.get("id", "")
    if rid.startswith("ARP\\"):
        p = by_key.get(rid.split("\\")[-1].lower())
        if p:
            return p
    n = _norm(row.get("name", ""))
    if not n:
        return None
    if n in by_name:
        return by_name[n]
    trunc = row.get("name", "").endswith("…")
    for k, p in by_name.items():
        if k and (k.startswith(n) if trunc else (k.startswith(n) or n.startswith(k)) and min(len(k), len(n)) >= 4):
            return p
    return None


def _icon(p):
    if not p:
        return None
    try:
        from .removal.icons import get_icon
        return get_icon(p)
    except Exception:
        return None


def icon_for(name):
    return _icon(_match({"name": name}))


# ---------------------------------------------------------------- buscar: programas, Tienda, componentes
def _pins():
    out = _winget(["pin", "list"], timeout=60) or ""
    return {r["id"]: r.get("version", "") for r in parse_table(out)}


def scan_apps(job):
    """Solo lectura: lo que winget puede actualizar y lo que hay instalado fuera de winget."""
    if not _exe("winget"):
        return {"winget": False}
    job.progress(.05, "Preguntando a winget qué hay nuevo…")
    pool = ThreadPoolExecutor(4)
    f_up = pool.submit(lambda: parse_table(_winget(["upgrade", "--include-unknown"], timeout=240) or ""))
    f_ls = pool.submit(lambda: parse_table(_winget(["list"], timeout=240) or ""))
    f_pin = pool.submit(_pins)
    f_prog = pool.submit(_programs)
    ups = f_up.result()
    job.check()
    job.progress(.45, f"{len(ups)} actualizaciones encontradas. Leyendo lo instalado…")
    installed = f_ls.result()
    pins = f_pin.result()
    f_prog.result()
    job.check()
    up_ids = {u["id"] for u in ups}
    items = []
    for u in ups:
        if not u.get("available"):
            continue
        p = _match(u)
        items.append({"id": u["id"], "wid": u["id"], "kind": "winget", "name": u["name"].replace("…", "").strip(),
                      "pub": (p or {}).get("publisher") or (u.get("source") == "msstore" and "Microsoft Store") or "",
                      "from": "desconocida" if (u.get("version") or "").lower() in ("", "unknown", "desconocido") else u["version"],
                      "to": u["available"], "source": u.get("source") or "",
                      "cat": _category(u), "mb": None, "admin": False, "reboot": False, "notes": [],
                      "pinned": u["id"] in pins, "user": bool((p or {}).get("user")), "_p": p})
    # fuera de winget: programas del registro (ARP) que winget no sabe actualizar
    unknown, store_ok, rt_ok, dev_ok = [], [], [], []
    for r in installed:
        rid = r.get("id", "")
        if rid in up_ids:
            continue
        if rid.startswith("ARP\\") and not r.get("source"):
            p = _match(r)
            unknown.append({"name": r["name"].replace("…", "").strip(), "ver": r.get("version", ""),
                            "pub": (p or {}).get("publisher", ""), "url": (p or {}).get("url", ""), "_p": p})
        elif rid.startswith("MSIX\\") or (r.get("source") or "").lower() == "msstore":
            store_ok.append({"name": r["name"], "ver": r.get("version", "")})
        else:
            c = _category(r)
            if c == "runtimes":
                rt_ok.append({"name": r["name"], "ver": r.get("version", ""), "pub": "", "id": rid})
            elif c == "dev":
                dev_ok.append({"name": r["name"], "ver": r.get("version", ""), "id": rid})
    # componentes: sin duplicados ni paquetes-marco de la Tienda que nadie reconoce
    noise = re.compile(r"UWP|Native Runtime Package|^Microsoft\.(UI\.Xaml|VCLibs|WindowsAppRuntime)", re.I)
    seen = set()
    rt_ok = [x for x in rt_ok if not noise.search(x["name"]) and not ((x["name"], x["ver"]) in seen or seen.add((x["name"], x["ver"])))]
    # WebView2 no siempre aparece en winget
    wv = _webview2()
    if wv and not any("webview2" in x["name"].lower() for x in rt_ok + [i for i in items if i["cat"] == "runtimes"]):
        rt_ok.append({"name": "WebView2 Runtime", "ver": wv, "pub": "Microsoft", "id": "Microsoft.EdgeWebView2Runtime"})
    job.progress(.6, "Sacando los iconos de cada programa…")
    todo = [x for x in items + unknown if x.get("_p")]
    done = [0]

    def ic(x):
        x["icon"] = _icon(x["_p"])
        done[0] += 1
        if done[0] % 4 == 0:
            job.progress(.6 + .38 * done[0] / max(1, len(todo)), "Sacando los iconos de cada programa…")
    list(ThreadPoolExecutor(6).map(ic, todo))
    for x in items + unknown:
        x.pop("_p", None)
    unknown.sort(key=lambda x: x["name"].lower())
    store_ok.sort(key=lambda x: x["name"].lower())
    return {"winget": True, "items": items, "unknown": unknown, "storeOk": store_ok, "runtimesOk": rt_ok,
            "devOk": dev_ok, "pins": pins, "ts": time.time()}


def _webview2():
    for root, path in ((winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}"),
                       (winreg.HKEY_CURRENT_USER, r"Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}")):
        try:
            with winreg.OpenKey(root, path) as k:
                return winreg.QueryValueEx(k, "pv")[0]
        except OSError:
            pass
    return None


def notes(wid):
    """Notas de la versión que publica el fabricante en winget (si las hay)."""
    out = _winget(["show", "--id", wid, "--exact"], timeout=60) or ""
    lines, take, url = [], False, ""
    for ln in out.splitlines():
        if re.match(r"^\s*(Release Notes|Notas de la versión)\s*:", ln, re.I):
            take = True
            rest = ln.split(":", 1)[1].strip()
            if rest:
                lines.append(rest)
            continue
        m = re.match(r"^\s*(Release Notes Url|Dirección URL de las notas de la versión)\s*:\s*(\S+)", ln, re.I)
        if m:
            url = m.group(2)
            take = False
            continue
        if take:
            if re.match(r"^\S.*:\s*", ln) and not ln.startswith(" "):
                take = False
                continue
            if ln.strip():
                lines.append(ln.strip())
    clean = [re.sub(r"^[-*•]\s*", "", x) for x in lines if not x.startswith("#")][:8]
    return {"notes": clean, "url": url}


def pin(wid):
    """Quedarse en la versión actual (winget pin)."""
    out = _winget(["pin", "add", "--id", wid, "--exact"], timeout=60) or ""
    return {"ok": True, "out": out[-300:]}


def unpin(wid):
    out = _winget(["pin", "remove", "--id", wid, "--exact"], timeout=60) or ""
    return {"ok": True, "out": out[-300:]}


# ---------------------------------------------------------------- Windows Update
_WU_SCAN = r"""
$s=New-Object -ComObject Microsoft.Update.Session; $se=$s.CreateUpdateSearcher()
$r=$se.Search("IsInstalled=0 and Type='Software' and IsHidden=0")
$ups=@(foreach($u in $r.Updates){ [pscustomobject]@{ id=$u.Identity.UpdateID; title=$u.Title; kb=@($u.KBArticleIDs);
  cats=@($u.Categories | ForEach-Object { $_.Name }); mb=[math]::Round($u.MaxDownloadSize/1MB,1);
  reboot=[bool]($u.InstallationBehavior.RebootBehavior -ne 0); browse=[bool]$u.BrowseOnly; sev=$u.MsrcSeverity; desc=$u.Description } })
$n=$se.GetTotalHistoryCount(); $h=@(if($n){ $se.QueryHistory(0,[math]::Min($n,40)) | ForEach-Object { [pscustomobject]@{ t=$_.Title; d=$_.Date.ToString('o'); rc=[int]$_.ResultCode; hr=$_.HResult } } })
$ux=Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\WindowsUpdate\UX\Settings' -ErrorAction SilentlyContinue
$mp=Get-MpComputerStatus -ErrorAction SilentlyContinue
$av=@(Get-CimInstance -Namespace root\SecurityCenter2 AntiVirusProduct -ErrorAction SilentlyContinue | ForEach-Object { [pscustomobject]@{ n=$_.displayName; st=$_.productState } })
$cv=Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion'
[pscustomobject]@{ updates=$ups; hist=$h; reboot=(New-Object -ComObject Microsoft.Update.SystemInfo).RebootRequired;
  pause=$ux.PauseUpdatesExpiryTime; mpMode="$($mp.AMRunningMode)"; sig=$mp.AntivirusSignatureVersion;
  sigDate=$(if($mp.AntivirusSignatureLastUpdated){$mp.AntivirusSignatureLastUpdated.ToString('o')}else{$null}); av=$av;
  build="$($cv.CurrentBuild).$($cv.UBR)"; ver=$cv.DisplayVersion; prod=$cv.ProductName }
"""


def _pretty_title(t):
    t = re.sub(r"^9[A-Z0-9]{11}-", "", t or "")  # entradas de la Tienda: "9NRZT3Q9R3DL-Microsoft.X"
    return t


def _wu_cat(u):
    cats = " ".join(u.get("cats") or []).lower()
    t = (u.get("title") or "").lower()
    if u.get("browse") or "preview" in t or "vista previa" in t:
        return "optional"
    if "security" in cats or "seguridad" in cats or "critical" in cats or "crítica" in cats or "definition" in cats \
            or "definici" in cats or "malicious" in t or "malintencionado" in t or u.get("sev"):
        return "security"
    return "windows"


def scan_windows(job):
    """Solo lectura: búsqueda real en Windows Update (tarda 20-60 s), historial, pausa, reinicio y antivirus."""
    job.progress(.1, "Buscando en Windows Update…")
    stop = threading.Event()

    def tick():  # la búsqueda de Windows no da progreso: avanzamos despacio para que se vea vivo
        p = .1
        while not stop.wait(1.0):
            p = min(.9, p + (.9 - p) * .06)
            job.progress(p, "Buscando en Windows Update…")
    threading.Thread(target=tick, daemon=True).start()
    try:
        r = ps_json(_WU_SCAN, timeout=300) or {}
    finally:
        stop.set()
    ups = []
    for u in r.get("updates") or []:
        cat = _wu_cat(u)
        kb = (u.get("kb") or [None])[0]
        ups.append({"id": "wu:" + u["id"], "uid": u["id"], "kind": "wu", "name": _pretty_title(u["title"]),
                    "pub": "Windows Update", "from": "", "to": f"KB{kb}" if kb else "", "kb": f"KB{kb}" if kb else "",
                    "cat": "windows" if cat == "optional" else cat, "optional": cat == "optional", "mb": u.get("mb"),
                    "admin": True, "reboot": bool(u.get("reboot")), "notes": [u["desc"]] if u.get("desc") else []})
    hist, seen = [], set()
    for h in r.get("hist") or []:
        key = (h["t"], (h.get("d") or "")[:16])
        if key in seen:
            continue
        seen.add(key)
        hist.append({"t": _pretty_title(h["t"]), "d": h["d"], "ok": h["rc"] in (2, 3), "hr": f"0x{(h.get('hr') or 0) & 0xFFFFFFFF:08X}"})
    av = [a["n"] for a in (r.get("av") or []) if a.get("n")]
    third = [a for a in av if "defender" not in a.lower()]
    mode = (r.get("mpMode") or "").strip()
    defender_on = mode.lower() in ("normal", "ejecución normal") or (mode and "passive" not in mode.lower() and "not" not in mode.lower())
    prod = r.get("prod") or "Windows"
    try:  # el registro sigue diciendo "Windows 10" en Windows 11
        if int(str(r.get("build", "0")).split(".")[0]) >= 22000:
            prod = prod.replace("Windows 10", "Windows 11")
    except ValueError:
        pass
    r["prod"] = prod
    return {"updates": ups, "history": hist, "reboot": bool(r.get("reboot")), "pause": r.get("pause"),
            "defender": {"on": bool(defender_on), "mode": mode, "sig": r.get("sig"), "sigDate": r.get("sigDate"), "others": third},
            "build": r.get("build"), "version": r.get("ver"), "product": r.get("prod"), "admin": _admin(), "ts": time.time()}


def set_pause(weeks):
    """Pausar Windows Update N semanas (0 = reanudar). Las mismas claves que usa Configuración. Necesita admin."""
    if not _admin():
        return {"needAdmin": True}
    path = r"SOFTWARE\Microsoft\WindowsUpdate\UX\Settings"
    keys = ("PauseFeatureUpdatesStartTime", "PauseFeatureUpdatesEndTime", "PauseQualityUpdatesStartTime",
            "PauseQualityUpdatesEndTime", "PauseUpdatesStartTime", "PauseUpdatesExpiryTime")
    with winreg.CreateKeyEx(winreg.HKEY_LOCAL_MACHINE, path, 0, winreg.KEY_SET_VALUE | winreg.KEY_WOW64_64KEY) as k:
        if int(weeks) <= 0:
            for n in keys:
                try:
                    winreg.DeleteValue(k, n)
                except OSError:
                    pass
            return {"ok": True, "pause": None}
        now = time.gmtime()
        end = time.gmtime(time.time() + int(weeks) * 7 * 86400)
        fmt = lambda t: time.strftime("%Y-%m-%dT%H:%M:%SZ", t)
        for n in keys:
            winreg.SetValueEx(k, n, 0, winreg.REG_SZ, fmt(now) if n.endswith("StartTime") else fmt(end))
    return {"ok": True, "pause": fmt(end)}


def store_auto():
    """¿La Tienda actualiza sola? (directiva AutoDownload: 2 = no, 4 o sin directiva = sí)."""
    try:
        with winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\Policies\Microsoft\WindowsStore") as k:
            v = winreg.QueryValueEx(k, "AutoDownload")[0]
            return {"on": v != 2, "policy": True}
    except OSError:
        return {"on": True, "policy": False}


def set_store_auto(on):
    if not _admin():
        return {"needAdmin": True}
    with winreg.CreateKeyEx(winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\Policies\Microsoft\WindowsStore", 0, winreg.KEY_SET_VALUE) as k:
        if on:
            try:
                winreg.DeleteValue(k, "AutoDownload")
            except OSError:
                pass
        else:
            winreg.SetValueEx(k, "AutoDownload", 0, winreg.REG_DWORD, 2)
    return store_auto()


# ---------------------------------------------------------------- desarrollo
def scan_dev(job):
    """Solo lectura: paquetes de pip desactualizados (del Python del usuario), npm globales y versiones."""
    out = {"python": None, "pip": [], "node": None, "npm": [], "git": None, "tools": []}
    py = _python()
    job.progress(.1, "Preguntando a pip…")
    try:
        r = subprocess.run([py, "--version"], capture_output=True, text=True, timeout=20, creationflags=NO_WINDOW)
        out["python"] = (r.stdout or r.stderr).strip().replace("Python ", "")
        r = subprocess.run([py, "-m", "pip", "list", "--outdated", "--format=json", "--disable-pip-version-check"],
                           capture_output=True, timeout=180, creationflags=NO_WINDOW)
        out["pip"] = [[p["name"], p["version"], p["latest_version"]] for p in json.loads(r.stdout.decode("utf-8", "replace") or "[]")]
    except Exception as e:
        out["pipError"] = str(e)[:200]
    job.check()
    job.progress(.6, "Preguntando a npm…")
    node = _exe("node")
    if node:
        try:
            out["node"] = subprocess.run([node, "--version"], capture_output=True, text=True, timeout=15, creationflags=NO_WINDOW).stdout.strip().lstrip("v")
            npm = _exe("npm")
            r = subprocess.run([npm, "outdated", "-g", "--json"], capture_output=True, timeout=90, creationflags=NO_WINDOW)
            data = json.loads(r.stdout.decode("utf-8", "replace") or "{}")
            out["npm"] = [[n, d.get("current", ""), d.get("latest", "")] for n, d in data.items()]
        except Exception as e:
            out["npmError"] = str(e)[:200]
    job.progress(.85, "Mirando el resto de herramientas…")
    for name, cmd, rx in (("Git", ["git", "--version"], r"(\d+\.\d+\.\d+(?:\.windows\.\d+)?)"),
                          ("PowerShell 7", ["pwsh", "--version"], r"(\d+\.\d+\.\d+)"),
                          ("WSL", ["wsl", "--version"], r"(\d+\.\d+\.\d+(?:\.\d+)?)"),
                          ("uv", ["uv", "--version"], r"(\d+\.\d+\.\d+)")):
        exe = _exe(cmd[0])
        if not exe:
            continue
        try:
            r = subprocess.run([exe, *cmd[1:]], capture_output=True, timeout=15, creationflags=NO_WINDOW)
            txt = r.stdout.decode("utf-16-le" if b"\x00" in r.stdout else "utf-8", "replace")
            m = re.search(rx, txt)
            if m:
                if name == "Git":
                    out["git"] = m.group(1)
                else:
                    out["tools"].append([name, m.group(1)])
        except Exception:
            pass
    return out


# ---------------------------------------------------------------- instalar (cambia el sistema: solo desde la interfaz)
_SIZE = {"KB": 1 / 1024, "MB": 1, "GB": 1024}


def _winget_upgrade(job, it, report):
    exe = _exe("winget")
    cmd = [exe, "upgrade", "--id", it["wid"], "--exact", "--silent", "--accept-package-agreements",
           "--accept-source-agreements", "--disable-interactivity"]
    if (it.get("source") or "").lower() == "msstore":
        cmd += ["--source", "msstore"]
    if it.get("force"):
        cmd += ["--force"]
    state = {"phase": "down", "p": 0.0, "mb": None}

    def on_text(s):
        m = re.search(r"([\d.,]+)\s*(KB|MB|GB)\s*/\s*([\d.,]+)\s*(KB|MB|GB)", s)
        if m:
            got = float(m.group(1).replace(",", ".")) * _SIZE[m.group(2)]
            tot = float(m.group(3).replace(",", ".")) * _SIZE[m.group(4)]
            state["mb"] = tot
            state["p"] = got / tot if tot else 0
            report("down", state["p"], mb=tot)
            return
        m = re.search(r"(\d{1,3})\s*%", s)
        if m and state["phase"] == "down":
            state["p"] = int(m.group(1)) / 100
            report("down", state["p"], mb=state["mb"])
            return
        low = s.lower()
        if any(w in low for w in ("starting package install", "iniciando la instalación", "installing", "instalando")):
            state["phase"] = "inst"
            report("inst", 1, mb=state["mb"])
        job.log(s)
    code, out = _stream(cmd, on_text, job=job, timeout=3600)
    if job.cancelled:
        return "cancel", "Cancelada"
    if code == 0 or re.search(r"Successfully installed|Instalado correctamente|se instaló correctamente", out, re.I):
        return "done", None
    hexc = f"0x{code & 0xFFFFFFFF:08X}" if code is not None else "?"
    msgs = {"0x8A15002B": "Ya no hay una versión nueva que instalar.", "0x8A150011": "El instalador falló.",
            "0x8A15010C": "La actualización necesita cerrar el programa primero.",
            "0x8A150056": "El programa está abierto: ciérralo y reinténtalo.", "0x8A150077": "Hay que reiniciar para terminar.",
            "0x80073D02": "La app está abierta: ciérrala y reinténtalo."}
    tail = [ln for ln in out.splitlines() if ln.strip()][-1:] or [""]
    return "fail", msgs.get(hexc, f"El instalador devolvió {hexc}. {tail[0][:120]}")


_WU_INSTALL = r"""
$ids = @('%s')
$s=New-Object -ComObject Microsoft.Update.Session; $se=$s.CreateUpdateSearcher()
$r=$se.Search("IsInstalled=0 and Type='Software'")
$col=New-Object -ComObject Microsoft.Update.UpdateColl
foreach($u in $r.Updates){ if($ids -contains $u.Identity.UpdateID){ if(-not $u.EulaAccepted){$u.AcceptEula()}; [void]$col.Add($u) } }
if($col.Count -eq 0){ Write-Output 'RESULT|none'; exit }
$dl=$s.CreateUpdateDownloader(); $dl.Updates=$col; Write-Output 'PHASE|down'; [void]$dl.Download()
Write-Output 'PHASE|inst'; $in=$s.CreateUpdateInstaller(); $in.Updates=$col; $res=$in.Install()
Write-Output ("RESULT|{0}|{1}" -f $res.ResultCode, [int]$res.RebootRequired)
"""


def _wu_install(job, it, report):
    if not _admin():
        return "admin", "Necesita el modo administrador"
    script = _WU_INSTALL % it["uid"].replace("'", "")
    res = {"st": "fail", "msg": "Windows Update no respondió."}

    def on_text(s):
        if s.startswith("PHASE|"):
            report("down" if s.endswith("down") else "inst", 0.5 if s.endswith("down") else 1)
        elif s.startswith("RESULT|"):
            parts = s.split("|")
            if parts[1] == "none":
                res.update(st="fail", msg="Ya no está disponible.")
            else:
                ok = parts[1] in ("2", "3")
                res.update(st="done" if ok else "fail", msg=None if ok else f"Windows Update devolvió el código {parts[1]}.",
                           reboot=len(parts) > 2 and parts[2] == "1")
        else:
            job.log(s)
    _stream(["powershell.exe", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
            on_text, job=job, timeout=7200)
    if job.cancelled:
        return "cancel", "Cancelada"
    return res["st"], res.get("msg"), res.get("reboot")


def _pkg_install(job, it, report):
    if it["kind"] == "pip":
        cmd = [_python(), "-m", "pip", "install", "-U", "--disable-pip-version-check", *it["pkgs"]]
    else:
        cmd = [_exe("npm"), "install", "-g", *[p + "@latest" for p in it["pkgs"]]]
    report("inst", 0.3)
    code, out = _stream(cmd, job.log, job=job, timeout=3600)
    if job.cancelled:
        return "cancel", "Cancelada"
    return ("done", None) if code == 0 else ("fail", ([ln for ln in out.splitlines() if ln.strip()] or ["Falló"])[-1][:160])


def _defender_update(job, it, report):
    report("down", .3)
    code, out = _stream(["powershell.exe", "-NoProfile", "-Command", "Update-MpSignature -ErrorAction Stop; 'ok'"],
                        job.log, job=job, timeout=900)
    return ("done", None) if "ok" in out else ("fail", "Defender no está activo o no pudo actualizarse.")


def install(job, items):
    """Instala en cola. items: [{kind: winget|wu|pip|npm|defender, ...}]. Progreso: data.items[i] = {st, p, mb, msg}."""
    states = [{"st": "queued", "p": 0, "mb": it.get("mb"), "msg": None} for it in items]
    job.data["items"] = states
    reboot = False
    for i, it in enumerate(items):
        if job.cancelled:
            for s in states[i:]:
                s["st"] = "cancel"
            break
        cur = states[i]

        def report(phase, p, mb=None, cur=cur, i=i):
            cur["st"], cur["p"] = phase, max(0, min(1, p))
            if mb:
                cur["mb"] = mb
            done = sum(1 for s in states if s["st"] in ("done", "fail", "admin", "cancel"))
            job.progress((done + (cur["p"] * .8 if phase == "down" else .9)) / len(states), it.get("name", ""), cur=i, items=states)
        report("down", 0)
        try:
            k = it.get("kind")
            r = (_winget_upgrade if k == "winget" else _wu_install if k == "wu" else _defender_update if k == "defender"
                 else _pkg_install)(job, it, report)
        except Exception as e:
            r = ("fail", str(e)[:160])
        cur["st"], cur["msg"] = r[0], r[1]
        if len(r) > 2 and r[2]:
            reboot = True
        if cur["st"] == "done":
            cur["p"] = 1
        job.progress(sum(1 for s in states if s["st"] in ("done", "fail", "admin", "cancel")) / len(states),
                     it.get("name", ""), force=True, cur=i, items=states)
    return {"items": states, "reboot": reboot}


def status():
    return {"admin": _admin(), "winget": bool(_exe("winget"))}
