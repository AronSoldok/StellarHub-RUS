"""Motor del Driver Updater. Todo real:
- inventario: Win32_PnPSignedDriver (+ estado de cada dispositivo en Win32_PnPEntity)
- búsqueda e instalación: Windows Update (COM Microsoft.Update.Session), solo drivers firmados, sin telemetría
- problemas: dispositivos con error (ConfigManagerErrorCode), deshabilitados y desconectados ("fantasma")
- copia de seguridad: pnputil /export-driver y /add-driver
- historial: historial de Windows Update filtrado a drivers
- versiones guardadas y revertir: pnputil /enum-devices /drivers + UpdateDriverForPlugAndPlayDevices
Lo que modifica el sistema exige administrador: se comprueba aquí y se devuelve {"needAdmin": True}.
"""
import ctypes
import json
import os
import re
import subprocess
import threading
import time

from .jobs import Cancelled
from .ps import ps_json, run, NO_WINDOW

EXPORTS = {"list_drivers", "last_search", "problems", "history", "backups", "default_backup_dir", "pick_folder",
           "open_folder", "driver_versions", "restart", "cancel_restart", "is_admin"}
JOBS = {"search", "install", "export", "restore_backup", "set_enabled", "remove_device", "rollback", "delete_backup"}

DATA = os.path.join(os.environ.get("ProgramData", r"C:\ProgramData"), "StellarHub")
LAST = os.path.join(DATA, "drivers_last_search.json")
KNOWN_BACKUPS = os.path.join(DATA, "drivers_backups.json")
INF_DIR = os.path.join(os.environ.get("WINDIR", r"C:\Windows"), "INF")

_cache = {"drivers": None, "at": 0}
_lock = threading.Lock()


def is_admin():
    try:
        return bool(ctypes.windll.shell32.IsUserAnAdmin())
    except Exception:
        return False


def _need_admin():
    return None if is_admin() else {"needAdmin": True}


def _save_json(path, data):
    try:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        tmp = path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(data, fh, ensure_ascii=False)
        os.replace(tmp, path)
    except OSError:
        pass


def _load_json(path, default):
    try:
        with open(path, encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return default


def _ps_job(job, script, timeout=900):
    """PowerShell que se puede cancelar: si el usuario cancela, se mata el proceso."""
    pre = ("$ProgressPreference='SilentlyContinue'; [Console]::OutputEncoding=[Text.Encoding]::UTF8; ")
    p = subprocess.Popen(["powershell.exe", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
                          "-Command", pre + script], stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                         stdin=subprocess.DEVNULL, creationflags=NO_WINDOW)
    out = {}

    def reader():
        out["o"], out["e"] = p.communicate()
    t = threading.Thread(target=reader, daemon=True)
    t.start()
    t0 = time.monotonic()
    while t.is_alive():
        t.join(0.3)
        if job.cancelled:
            p.kill()
            raise Cancelled()
        if time.monotonic() - t0 > timeout:
            p.kill()
            raise TimeoutError("Windows Update no respondió a tiempo")
    return (out.get("o") or b"").decode("utf-8", "replace"), (out.get("e") or b"").decode("utf-8", "replace")


def _json_lines(text):
    out = []
    for line in text.splitlines():
        line = line.strip()
        if line.startswith("{") or line.startswith("["):
            try:
                out.append(json.loads(line))
            except ValueError:
                pass
    return out


# ================= inventario =================
_INV = r"""
$st=@{}; Get-CimInstance Win32_PnPEntity | ForEach-Object { $st[$_.DeviceID] = $_.ConfigManagerErrorCode }
Get-CimInstance Win32_PnPSignedDriver | Where-Object { $_.DeviceName -and $_.DriverVersion } | ForEach-Object {
  [pscustomobject]@{ n=$_.DeviceName; c="$($_.DeviceClass)"; p=$_.DriverProviderName; v=$_.DriverVersion
    d= if ($_.DriverDate) { $_.DriverDate.ToString('yyyy-MM-dd') } else { '' }
    inf=$_.InfName; hw=$_.HardWareID; id=$_.DeviceID; s=$_.IsSigned; m=$_.Manufacturer; e=$st[$_.DeviceID] } }
"""


def list_drivers(fresh=False):
    """Drivers instalados. inbox=True para los que vienen con Windows (fecha 21/06/2006, proveedor Microsoft)."""
    with _lock:
        if not fresh and _cache["drivers"] and time.time() - _cache["at"] < 120:
            return _cache["drivers"]
        rows = ps_json(_INV, timeout=120, as_list=True) or []
        out = []
        for i, r in enumerate(rows):
            inbox = (r.get("p") or "").lower() == "microsoft" and (r.get("d") or "").startswith("2006-06-2")
            e = r.get("e")
            out.append({"id": f"d{i}", "name": r.get("n") or "", "cls": (r.get("c") or "OTHER").upper(), "provider": r.get("p") or "",
                        "version": r.get("v") or "", "date": r.get("d") or "", "inbox": inbox, "inf": r.get("inf") or "",
                        "hw": r.get("hw") or "", "instance": r.get("id") or "", "maker": r.get("m") or "",
                        "status": "off" if e == 22 else ("err" if e not in (None, 0) else "ok"), "code": e})
        _cache.update(drivers=out, at=time.time())
        return out


# ================= búsqueda en Windows Update =================
_SEARCH = r"""
$s = New-Object -ComObject Microsoft.Update.Session
$s.ClientApplicationID = 'StellarHub'
$r = $s.CreateUpdateSearcher().Search("IsInstalled=0 and Type='Driver' and IsHidden=0")
$out = foreach ($u in $r.Updates) {
  $dv = $null; try { $dv = [datetime]$u.DriverVerDate } catch {}
  [pscustomobject]@{ id=[string]$u.Identity.UpdateID; title=[string]$u.Title; cls=[string]$u.DriverClass
    maker=[string]$u.DriverManufacturer; provider=[string]$u.DriverProvider; model=[string]$u.DriverModel; hw=[string]$u.DriverHardwareID
    date= if ($dv -and $dv.Year -ge 1995) { $dv.ToString('yyyy-MM-dd') } else { '' }
    mb=[math]::Round($u.MaxDownloadSize / 1MB, 1); reboot=[bool]($u.InstallationBehavior.RebootBehavior -ne 0)
    eula=[bool]$u.EulaAccepted }
}
ConvertTo-Json -InputObject @($out) -Depth 4 -Compress
"""


def _ver_from_title(t):
    m = re.findall(r"\d+(?:\.\d+){1,}", t or "")
    return m[-1] if m else ""


def _match(update, drivers):
    hw = (update.get("hw") or "").lower()
    model = (update.get("model") or "").lower()
    best = None
    for d in drivers:
        dh = (d.get("hw") or "").lower()
        if hw and dh and (dh.startswith(hw) or hw.startswith(dh)):
            if best is None or len(dh) > len(best.get("hw") or ""):
                best = d
    if not best and model:
        best = next((d for d in drivers if d["name"].lower() == model), None)
    return best


def search(job):
    """Pregunta a Windows Update qué drivers hay para este equipo (solo lectura)."""
    job.progress(.05, "Conectando con Windows Update", phase=0, force=True)
    drivers = []
    t = threading.Thread(target=lambda: drivers.extend(list_drivers()), daemon=True)
    t.start()
    phases = ["Pidiendo el catálogo de drivers para tu equipo", "Esperando la respuesta de Windows Update",
              "Comparando con tus drivers instalados"]
    done = {}

    def run_search():
        try:
            done["out"] = _ps_job(job, _SEARCH, timeout=600)
        except Exception as e:  # noqa: BLE001
            done["err"] = e
    th = threading.Thread(target=run_search, daemon=True)
    th.start()
    i, t0 = 0, time.monotonic()
    while th.is_alive():
        th.join(1.0)
        job.check()
        el = time.monotonic() - t0
        ph = min(len(phases) - 1, int(el // 6))
        if ph != i or el < 2:
            i = ph
        job.progress(min(.85, .1 + el / 90), phases[i] if el > 1 else "Conectando con Windows Update", phase=i + 1, secs=int(el))
    if "err" in done:
        if isinstance(done["err"], Cancelled):
            raise done["err"]
        raise RuntimeError(f"Windows Update no respondió: {done['err']}")
    out, err = done.get("out", ("", ""))
    data = _json_lines(out)
    ups = data[0] if data and isinstance(data[0], list) else (data if data and isinstance(data[0], dict) else [])
    if not data and err.strip():
        raise RuntimeError("Windows Update devolvió un error: " + err.strip().splitlines()[-1][:300])
    t.join(60)
    job.progress(.92, "Comparando con tus drivers instalados", phase=3)
    res = []
    for u in ups:
        d = _match(u, drivers)
        res.append({"id": u["id"], "title": u["title"], "ver": _ver_from_title(u["title"]), "date": u.get("date") or "",
                    "mb": u.get("mb") or 0, "reboot": bool(u.get("reboot")), "cls": (u.get("cls") or "").upper(),
                    "maker": u.get("maker") or u.get("provider") or "", "model": u.get("model") or "", "hw": u.get("hw") or "",
                    "current": ({"name": d["name"], "version": d["version"], "date": d["date"], "cls": d["cls"],
                                 "provider": d["provider"], "instance": d["instance"]} if d else None)})
    payload = {"at": time.time(), "updates": res}
    _save_json(LAST, payload)
    job.progress(1, "Listo", phase=4)
    return payload


def last_search():
    """Resultado de la última búsqueda (se guarda en disco), sin tocar Windows Update."""
    return _load_json(LAST, {"at": None, "updates": []})


# ================= instalación =================
_INSTALL = r"""
$ids = '__IDS__' | ConvertFrom-Json
function Say($o) { [Console]::Out.WriteLine(($o | ConvertTo-Json -Compress)); [Console]::Out.Flush() }
$s = New-Object -ComObject Microsoft.Update.Session
$s.ClientApplicationID = 'StellarHub'
Say @{ step='search' }
$r = $s.CreateUpdateSearcher().Search("IsInstalled=0 and Type='Driver' and IsHidden=0")
$todo = @(); foreach ($u in $r.Updates) { if ($ids -contains [string]$u.Identity.UpdateID) { $todo += $u } }
if ($todo.Count -eq 0) { Say @{ step='none' }; return }
foreach ($u in $todo) {
  $id = [string]$u.Identity.UpdateID
  try {
    if (-not $u.EulaAccepted) { $u.AcceptEula() }
    $col = New-Object -ComObject Microsoft.Update.UpdateColl; [void]$col.Add($u)
    Say @{ step='download'; id=$id }
    $dl = $s.CreateUpdateDownloader(); $dl.Updates = $col; $dr = $dl.Download()
    if ($dr.ResultCode -ne 2 -and $dr.ResultCode -ne 3) { Say @{ step='error'; id=$id; code=$dr.ResultCode; msg='La descarga falló' }; continue }
    Say @{ step='install'; id=$id }
    $ins = $s.CreateUpdateInstaller(); $ins.Updates = $col; $res = $ins.Install()
    $c = $res.GetUpdateResult(0).ResultCode; $h = '{0:X8}' -f $res.GetUpdateResult(0).HResult
    Say @{ step='done'; id=$id; code=$c; ok=($c -eq 2 -or $c -eq 3); reboot=[bool]$res.RebootRequired; hresult=$h }
  } catch { Say @{ step='error'; id=$id; msg=$_.Exception.Message } }
}
Say @{ step='end' }
"""


def _restore_point(desc):
    out = ps_json(f"""
try {{ Enable-ComputerRestore -Drive "$env:SystemDrive\\" -ErrorAction SilentlyContinue
  Checkpoint-Computer -Description '{desc}' -RestorePointType MODIFY_SETTINGS -ErrorAction Stop
  [pscustomobject]@{{ ok=$true }} }} catch {{ [pscustomobject]@{{ ok=$false; msg=$_.Exception.Message }} }}""", timeout=240) or {}
    return out


def install(job, ids, restore_point=True):
    """Instala los drivers elegidos (ids de Windows Update), uno a uno, con punto de restauración antes."""
    need = _need_admin()
    if need:
        return need
    ids = [str(i) for i in (ids or []) if re.fullmatch(r"[0-9a-fA-F-]{36}", str(i))]
    if not ids:
        return {"results": [], "reboot": False}
    rp = {"ok": None}
    if restore_point:
        job.progress(.02, "Creando el punto de restauración", step="rp", phase="run", force=True)
        rp = _restore_point("StellarHub: antes de instalar drivers")
        job.progress(.08, "Punto de restauración", step="rp", phase="done" if rp.get("ok") else "skip",
                     msg=None if rp.get("ok") else "Windows no creó uno nuevo (solo permite uno cada 24 h o está desactivado).", force=True)
    results, reboot = {}, False
    n = len(ids)

    def on_line(line):
        nonlocal reboot
        for m in _json_lines(line):
            st, uid = m.get("step"), m.get("id")
            k = list(results).index(uid) if uid in results else len(results)
            if st == "download":
                results.setdefault(uid, {"id": uid, "ok": False})
                job.progress(.1 + .9 * (k / n), "Descargando", step=uid, phase="download", force=True)
            elif st == "install":
                job.progress(.1 + .9 * ((k + .6) / n), "Instalando", step=uid, phase="install", force=True)
            elif st in ("done", "error"):
                r = results.setdefault(uid, {"id": uid})
                r.update(ok=bool(m.get("ok")), code=m.get("code"), msg=m.get("msg"), reboot=bool(m.get("reboot")), hresult=m.get("hresult"))
                reboot = reboot or r["reboot"]
                job.progress(.1 + .9 * ((k + 1) / n), "Hecho" if r["ok"] else "Falló", step=uid, phase="done" if r["ok"] else "error",
                             result=r, force=True)
            elif st == "none":
                job.progress(1, "Esos drivers ya no están disponibles", force=True)
    script = _INSTALL.replace("__IDS__", json.dumps(ids))
    code, _ = run(["powershell.exe", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command",
                   "[Console]::OutputEncoding=[Text.Encoding]::UTF8; $ProgressPreference='SilentlyContinue'; " + script],
                  on_line=on_line, job=job, timeout=3600)
    job.check()
    # lo instalado ya no está pendiente
    last = last_search()
    okids = {k for k, v in results.items() if v.get("ok")}
    last["updates"] = [u for u in last.get("updates", []) if u["id"] not in okids]
    _save_json(LAST, last)
    _cache["at"] = 0
    return {"results": list(results.values()), "reboot": reboot, "restorePoint": rp, "pending": len(last["updates"])}


def restart(seconds=60):
    subprocess.run(["shutdown", "/r", "/t", str(int(seconds)), "/c", "StellarHub reinicia el equipo para terminar de instalar drivers."],
                   creationflags=NO_WINDOW)
    return True


def cancel_restart():
    subprocess.run(["shutdown", "/a"], creationflags=NO_WINDOW)
    return True


# ================= problemas =================
CODES = {
    1: "No está bien configurado.", 3: "El driver está dañado o el sistema va justo de memoria.", 10: "El dispositivo no puede arrancar.",
    12: "No encuentra recursos libres suficientes.", 14: "Necesita reiniciar el equipo para funcionar.", 18: "Hay que reinstalar sus drivers.",
    19: "Su configuración en el registro está dañada.", 21: "Windows lo está quitando.", 22: "Está deshabilitado.",
    24: "No está presente, no funciona bien o le faltan drivers.", 28: "No tiene driver instalado.", 29: "Está deshabilitado en el firmware (BIOS).",
    31: "Windows no puede cargar sus drivers.", 32: "Su servicio de driver está deshabilitado.", 37: "El driver falló al iniciarse.",
    39: "El driver falta o está dañado.", 41: "Windows cargó el driver pero no encuentra el dispositivo.",
    43: "Windows lo detuvo porque informó de un problema.", 45: "No está conectado ahora mismo.", 48: "Windows bloqueó su driver por problemas conocidos.",
    52: "Windows no puede verificar la firma digital de su driver.",
}
_PROBLEMS = r"""
$err = @(Get-CimInstance Win32_PnPEntity -Filter 'ConfigManagerErrorCode<>0' | ForEach-Object {
  [pscustomobject]@{ name=$_.Name; cls=[string]$_.PNPClass; id=$_.DeviceID; code=$_.ConfigManagerErrorCode; maker=$_.Manufacturer } })
$keep = @('DiskDrive','USB','HIDClass','Printer','Bluetooth','Media','Net','Image','Camera','WPD','Monitor','AudioEndpoint','Keyboard','Mouse','PrintQueue','SmartCardReader','Ports','Biometric','MEDIA','USBDevice','AndroidUsbDeviceClass')
$g = @(Get-PnpDevice -ErrorAction SilentlyContinue | Where-Object { -not $_.Present -and $keep -contains $_.Class -and $_.FriendlyName } | Select-Object -First 120)
$last = @{}
if ($g.Count) { try { Get-PnpDeviceProperty -InstanceId $g.InstanceId -KeyName 'DEVPKEY_Device_LastArrivalDate' -ErrorAction SilentlyContinue | ForEach-Object { if ($_.Data) { $last[$_.InstanceId] = ([datetime]$_.Data).ToString('o') } } } catch {} }
$gh = @($g | ForEach-Object { [pscustomobject]@{ name=$_.FriendlyName; cls=[string]$_.Class; id=$_.InstanceId; last=$last[$_.InstanceId] } })
[pscustomobject]@{ errors=$err; ghosts=$gh }
"""


def problems():
    r = ps_json(_PROBLEMS, timeout=120) or {}
    errs = []
    for e in (r.get("errors") or []):
        c = e.get("code")
        if c in (45,):
            continue
        errs.append({**e, "why": CODES.get(c, f"Windows informa del código {c}."), "disabled": c == 22})
    ghosts = sorted((r.get("ghosts") or []), key=lambda g: g.get("last") or "", reverse=True)
    return {"errors": [e for e in errs if not e["disabled"]], "disabled": [e for e in errs if e["disabled"]], "ghosts": ghosts,
            "at": time.time()}


def set_enabled(job, instance_id, enable):
    need = _need_admin()
    if need:
        return need
    iid = str(instance_id).replace("'", "''")
    cmd = "Enable-PnpDevice" if enable else "Disable-PnpDevice"
    out = ps_json(f"try {{ {cmd} -InstanceId '{iid}' -Confirm:$false -ErrorAction Stop; [pscustomobject]@{{ok=$true}} }} "
                  f"catch {{ [pscustomobject]@{{ok=$false; msg=$_.Exception.Message}} }}", timeout=90) or {}
    _cache["at"] = 0
    return out


def remove_device(job, instance_id):
    """Quita un dispositivo (normalmente uno que ya no está conectado). Su driver sigue en el equipo."""
    need = _need_admin()
    if need:
        return need
    code, out = run(["pnputil", "/remove-device", str(instance_id)], encoding="cp1252", job=job, timeout=120)
    return {"ok": code == 0, "msg": out.strip().splitlines()[-1] if out.strip() else ""}


# ================= historial =================
_HIST = r"""
$s = New-Object -ComObject Microsoft.Update.Session; $se = $s.CreateUpdateSearcher()
$n = $se.GetTotalHistoryCount(); if ($n -le 0) { return }
$h = $se.QueryHistory(0, [Math]::Min($n, 400))
$out = foreach ($e in $h) {
  $isDrv = $false
  try { foreach ($c in $e.Categories) { if ($c.Name -eq 'Drivers' -or $c.Type -eq 'UpdateClassification' -and $c.Name -match 'Driver') { $isDrv = $true } } } catch {}
  if (-not $isDrv -and $e.Title -match '^.+ - .+ - [\d.]+$') { $isDrv = $true }
  if ($isDrv -and $e.Operation -eq 1) {
    [pscustomobject]@{ date=$e.Date.ToLocalTime().ToString('o'); title=[string]$e.Title; code=[int]$e.ResultCode; hr=('{0:X8}' -f $e.HResult) } }
}
$out
"""


def history():
    out = ps_json(_HIST, timeout=120, as_list=True) or []
    res = []
    for e in out:
        t = e.get("title") or ""
        parts = [p.strip() for p in t.split(" - ")]
        name = parts[0] if len(parts) >= 3 else t
        res.append({"date": e.get("date"), "title": t, "name": name, "cls": parts[1] if len(parts) >= 3 else "",
                    "ver": _ver_from_title(t), "ok": e.get("code") in (2, 3), "code": e.get("code"),
                    "err": None if e.get("code") in (2, 3) else f"Windows Update devolvió 0x{e.get('hr')}"})
    return res


# ================= copias de seguridad =================
def default_backup_dir():
    docs = os.path.join(os.path.expanduser("~"), "Documents")
    try:
        import winreg
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, r"Software\Microsoft\Windows\CurrentVersion\Explorer\Shell Folders") as k:
            docs = winreg.QueryValueEx(k, "Personal")[0]
    except OSError:
        pass
    return os.path.join(docs, "StellarHub", "Copias de drivers")


def _dir_stats(path):
    n, size = 0, 0
    for root, _d, files in os.walk(path):
        for f in files:
            try:
                size += os.path.getsize(os.path.join(root, f))
            except OSError:
                pass
            if f.lower().endswith(".inf"):
                n += 1
    return n, size


def backups():
    roots = set(_load_json(KNOWN_BACKUPS, []))
    base = default_backup_dir()
    out = []
    cands = set(roots)
    if os.path.isdir(base):
        for d in os.listdir(base):
            cands.add(os.path.join(base, d))
    for p in cands:
        if not os.path.isdir(p):
            continue
        n, size = _dir_stats(p)
        if n == 0:
            continue
        out.append({"path": p, "count": n, "gb": round(size / 1024 ** 3, 2), "date": time.strftime("%Y-%m-%d", time.localtime(os.path.getmtime(p))),
                    "ts": os.path.getmtime(p)})
    return sorted(out, key=lambda b: b["ts"], reverse=True)


def pick_folder(initial=None):
    import webview
    try:
        w = webview.windows[0]
        r = w.create_file_dialog(webview.FOLDER_DIALOG, directory=initial or default_backup_dir())
    except Exception:
        return None
    if not r:
        return None
    return r[0] if isinstance(r, (list, tuple)) else r


def open_folder(path):
    if path and os.path.isdir(path):
        os.startfile(path)
        return True
    return False


def _third_party_count():
    return len([f for f in os.listdir(INF_DIR) if re.fullmatch(r"oem\d+\.inf", f, re.I)]) if os.path.isdir(INF_DIR) else 0


def export(job, folder=None):
    """Exporta todos los drivers de fabricantes (los de Windows vienen con Windows y no se pueden exportar)."""
    need = _need_admin()
    if need:
        return need
    base = folder or default_backup_dir()
    dest = os.path.join(base, time.strftime("%Y-%m-%d %H%M"))
    os.makedirs(dest, exist_ok=True)
    total = max(1, _third_party_count())
    seen = set()

    def on_line(line):
        for inf in re.findall(r"oem\d+\.inf", line, re.I):
            if inf.lower() not in seen:
                seen.add(inf.lower())
                job.progress(len(seen) / total, line.strip()[:160], n=len(seen), total=total)
    job.progress(0, "Preparando la copia", n=0, total=total, force=True)
    code, out = run(["pnputil", "/export-driver", "*", dest], on_line=on_line, encoding="cp1252", job=job, timeout=3600)
    job.check()
    n, size = _dir_stats(dest)
    known = set(_load_json(KNOWN_BACKUPS, []))
    if os.path.dirname(dest) != default_backup_dir():
        known.add(dest)
        _save_json(KNOWN_BACKUPS, sorted(known))
    if n == 0:
        try:
            os.rmdir(dest)
        except OSError:
            pass
        return {"ok": False, "msg": out.strip().splitlines()[-1] if out.strip() else "pnputil no exportó nada"}
    return {"ok": True, "path": dest, "count": n, "gb": round(size / 1024 ** 3, 2)}


def restore_backup(job, path):
    need = _need_admin()
    if need:
        return need
    if not path or not os.path.isdir(path):
        return {"ok": False, "msg": "La carpeta de la copia ya no existe."}
    total = max(1, _dir_stats(path)[0])
    done = [0]

    def on_line(line):
        if re.search(r"\.inf", line, re.I):
            done[0] += 1
            job.progress(min(1, done[0] / total), line.strip()[:160], n=done[0], total=total)
    code, out = run(["pnputil", "/add-driver", os.path.join(path, "*.inf"), "/subdirs", "/install"], on_line=on_line,
                    encoding="cp1252", job=job, timeout=3600)
    _cache["at"] = 0
    return {"ok": code in (0, 3010), "reboot": code == 3010, "msg": out.strip().splitlines()[-1] if out.strip() else ""}


def delete_backup(job, path):
    """Manda la copia a la papelera (se puede recuperar desde ahí)."""
    known = {b["path"] for b in backups()}
    if path not in known:
        return {"ok": False, "msg": "Esa carpeta no es una copia de StellarHub."}
    from ctypes import wintypes

    class SHFILEOPSTRUCTW(ctypes.Structure):
        _fields_ = [("hwnd", wintypes.HWND), ("wFunc", ctypes.c_uint), ("pFrom", wintypes.LPCWSTR), ("pTo", wintypes.LPCWSTR),
                    ("fFlags", ctypes.c_ushort), ("fAnyOperationsAborted", wintypes.BOOL), ("hNameMappings", ctypes.c_void_p),
                    ("lpszProgressTitle", wintypes.LPCWSTR)]
    op = SHFILEOPSTRUCTW(None, 3, path + "\0\0", None, 0x0040 | 0x0010 | 0x0004 | 0x0400, False, None, None)  # DELETE, ALLOWUNDO|NOCONFIRMATION|SILENT|NOERRORUI
    r = ctypes.windll.shell32.SHFileOperationW(ctypes.byref(op))
    return {"ok": r == 0 and not op.fAnyOperationsAborted}


# ================= versiones guardadas y revertir =================
def driver_versions(instance_id):
    """Paquetes de driver del almacén que sirven para este dispositivo (el instalado y los anteriores)."""
    code, out = run(["pnputil", "/enum-devices", "/instanceid", str(instance_id), "/drivers"], encoding="cp1252", timeout=60)
    if code != 0:
        return []
    res, cur = [], None
    for line in out.splitlines():
        m = re.search(r":\s*((?:oem\d+|[\w.-]+)\.inf)\s*$", line, re.I)
        if m and line.startswith((" ", "\t")):
            if cur is not None and not cur["version"]:
                cur["original"] = m.group(1)  # "Nombre original" del mismo paquete, no otro paquete
            else:
                cur = {"inf": m.group(1), "version": "", "date": "", "installed": False, "original": ""}
                res.append(cur)
            continue
        if cur is None:
            continue
        v = re.search(r"(\d{1,2})/(\d{1,2})/(\d{4})\s+(\d+(?:\.\d+)+)", line)
        if v:
            cur["date"] = f"{v.group(3)}-{int(v.group(1)):02d}-{int(v.group(2)):02d}"
            cur["version"] = v.group(4)
        if re.search(r"instalad|installed", line, re.I) and re.search(r"estado|status", line, re.I):
            cur["installed"] = True
    # el que hay que poner al revertir: el más nuevo de los no instalados que sea más viejo que el instalado
    inst = next((r for r in res if r["installed"]), None)

    def vkey(s):
        return tuple(int(x) for x in re.findall(r"\d+", s or "0"))
    for r in res:
        # solo paquetes de fabricante (oemNN.inf): volver al driver genérico de Windows no es "la versión anterior"
        r["older"] = bool(inst and not r["installed"] and re.fullmatch(r"oem\d+\.inf", r["inf"], re.I)
                          and vkey(r["version"]) < vkey(inst["version"]))
    return res


def rollback(job, instance_id, inf, hwid):
    """Vuelve a una versión anterior que ya está en el almacén de drivers (fuerza ese INF para el dispositivo)."""
    need = _need_admin()
    if need:
        return need
    if not re.fullmatch(r"oem\d+\.inf", str(inf), re.I):
        return {"ok": False, "msg": "Solo se puede volver a drivers de fabricantes guardados en el equipo."}
    path = os.path.join(INF_DIR, inf)
    if not os.path.isfile(path):
        return {"ok": False, "msg": "Ese driver ya no está en el equipo."}
    job.progress(.1, "Creando el punto de restauración", force=True)
    rp = _restore_point("StellarHub: antes de revertir un driver")
    job.progress(.4, "Instalando la versión anterior", force=True)
    reboot = ctypes.c_int(0)
    newdev = ctypes.windll.newdev
    newdev.UpdateDriverForPlugAndPlayDevicesW.argtypes = [ctypes.c_void_p, ctypes.c_wchar_p, ctypes.c_wchar_p, ctypes.c_uint, ctypes.POINTER(ctypes.c_int)]
    ok = newdev.UpdateDriverForPlugAndPlayDevicesW(None, str(hwid), path, 1, ctypes.byref(reboot))  # INSTALLFLAG_FORCE
    err = ctypes.GetLastError()
    _cache["at"] = 0
    return {"ok": bool(ok), "reboot": bool(reboot.value), "restorePoint": rp, "msg": None if ok else f"Windows devolvió el error {err}."}
