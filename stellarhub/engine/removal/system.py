"""Consultas al sistema: tareas programadas, servicios, procesos, reinicio pendiente."""
import ctypes
import json
import os
import re
import subprocess
import winreg
import xml.etree.ElementTree as ET
from ctypes import wintypes

from . import paths, registry, safety

NOWIN = 0x08000000


def is_admin():
    try:
        return bool(ctypes.windll.shell32.IsUserAnAdmin())
    except Exception:
        return False


def run(args, timeout=120, **kw):
    """subprocess sin ventana; devuelve (codigo, salida)."""
    try:
        r = subprocess.run(args, capture_output=True, text=True, encoding="utf-8", errors="replace",
                           creationflags=NOWIN, timeout=timeout, **kw)
        return r.returncode, (r.stdout or "") + (r.stderr or "")
    except subprocess.TimeoutExpired:
        return -1, "Tiempo de espera agotado"
    except OSError as e:
        return -1, str(e)


def powershell(cmd, timeout=120):
    return run(["powershell", "-NoProfile", "-NonInteractive", "-Command",
                "[Console]::OutputEncoding=[Text.Encoding]::UTF8; " + cmd], timeout=timeout)


# ---------------------------------------------------------------- tareas programadas
_NS = {"t": "http://schemas.microsoft.com/windows/2004/02/mit/task"}


def _parse_task_xml(text, uri):
    try:
        root = ET.fromstring(text)
    except ET.ParseError:
        return None
    cmds = []
    for ex in root.findall(".//t:Actions/t:Exec", _NS):
        c = (ex.findtext("t:Command", "", _NS) or "").strip().strip('"')
        a = (ex.findtext("t:Arguments", "", _NS) or "").strip()
        cmds.append((os.path.expandvars(c), a))
    enabled = (root.findtext(".//t:Settings/t:Enabled", "true", _NS) or "true").lower() != "false"
    logon = root.find(".//t:Triggers/t:LogonTrigger", _NS) is not None
    boot = root.find(".//t:Triggers/t:BootTrigger", _NS) is not None
    author = root.findtext(".//t:RegistrationInfo/t:Author", "", _NS) or ""
    return {"path": uri, "name": uri.rsplit("\\", 1)[-1], "commands": cmds, "enabled": enabled,
            "logon": logon, "boot": boot, "author": author}


_TASK_SPLIT = re.compile(r"<!-- (.*?) -->")


def _tasks_schtasks(include_microsoft=False):
    """Todas las tareas en un solo XML con schtasks: ~0,2 s frente a ~2 s de Get-ScheduledTask.

    La consola se pone en UTF-8 (chcp 65001) para que los nombres con tildes salgan bien.
    Devuelve None si no se pudo leer (se usa entonces PowerShell).
    """
    try:
        r = subprocess.run("cmd /d /c chcp 65001 >nul & schtasks /query /xml ONE", capture_output=True,
                           creationflags=NOWIN, timeout=60)
        txt = r.stdout.decode("utf-8")
    except (OSError, subprocess.TimeoutExpired, UnicodeDecodeError):
        return None
    if r.returncode != 0 or "<Tasks>" not in txt:
        return None
    parts = _TASK_SPLIT.split(txt)
    out = []
    for i in range(1, len(parts) - 1, 2):
        uri = parts[i].strip()
        if not include_microsoft and uri.lower().startswith("\\microsoft\\"):
            continue
        body = parts[i + 1].replace("\r", "").strip()
        if body.endswith("</Tasks>"):
            body = body[:-len("</Tasks>")].rstrip()
        t = _parse_task_xml(body, uri)
        if t:
            out.append(t)
    return out


def list_tasks(include_microsoft=False):
    tasks_dir = os.path.join(paths.kf("Windows") or r"C:\Windows", "System32", "Tasks")
    out = []
    if is_admin() and os.path.isdir(tasks_dir):
        for dp, dn, fn in os.walk(tasks_dir):
            rel = os.path.relpath(dp, tasks_dir)
            if not include_microsoft and (rel.lower() == "microsoft" or rel.lower().startswith("microsoft\\")):
                dn[:] = []
                continue
            for f in fn:
                full = os.path.join(dp, f)
                try:
                    with open(full, "rb") as fh:
                        raw = fh.read()
                    text = raw.decode("utf-16") if raw[:2] in (b"\xff\xfe", b"\xfe\xff") else raw.decode("utf-8", "replace")
                except OSError:
                    continue
                uri = "\\" + os.path.relpath(full, tasks_dir)
                t = _parse_task_xml(text.lstrip("\ufeff"), uri)
                if t:
                    out.append(t)
        return out
    out = _tasks_schtasks(include_microsoft)
    if out is not None:
        return out
    out = []
    code, txt = powershell(
        "Get-ScheduledTask | Where-Object { $_.TaskPath -notlike '\\Microsoft\\*' } | ForEach-Object { "
        "[pscustomobject]@{ P=$_.TaskPath + $_.TaskName; N=$_.TaskName; S=[string]$_.State; "
        "C=@($_.Actions | ForEach-Object { @($_.Execute, $_.Arguments) }); "
        "L=[bool]($_.Triggers | Where-Object { $_.CimClass.CimClassName -eq 'MSFT_TaskLogonTrigger' }) } } | "
        "ConvertTo-Json -Compress -Depth 4", timeout=60)
    try:
        data = json.loads(txt) if txt.strip().startswith(("[", "{")) else []
    except ValueError:
        data = []
    for d in (data if isinstance(data, list) else [data]):
        c = d.get("C") or []
        cmds = [(os.path.expandvars((c[i] or "").strip('"')), c[i + 1] or "") for i in range(0, len(c) - 1, 2)]
        out.append({"path": d["P"], "name": d["N"], "commands": cmds, "enabled": d.get("S") != "Disabled",
                    "logon": bool(d.get("L")), "boot": False, "author": ""})
    return out


def delete_task(path):
    return run(["schtasks", "/Delete", "/TN", path, "/F"])


def export_task(path):
    code, xml = run(["schtasks", "/Query", "/TN", path, "/XML"])
    return xml if code == 0 else None


def set_task_enabled(path, enabled):
    return run(["schtasks", "/Change", "/TN", path, "/ENABLE" if enabled else "/DISABLE"])


# ---------------------------------------------------------------- servicios
def list_services():
    hk = winreg.HKEY_LOCAL_MACHINE
    base = r"SYSTEM\CurrentControlSet\Services"
    out = []
    for name in registry.subkeys(hk, base):
        img = registry.get_value(hk, f"{base}\\{name}", "ImagePath")
        if not img:
            continue
        out.append({"name": name, "image": str(img), "exe": safety.image_path(str(img)),
                    "start": registry.get_value(hk, f"{base}\\{name}", "Start"),
                    "type": registry.get_value(hk, f"{base}\\{name}", "Type"),
                    "display": str(registry.get_value(hk, f"{base}\\{name}", "DisplayName") or name)})
    return out


def stop_service(name):
    return run(["sc", "stop", name], timeout=60)


def delete_service(name):
    stop_service(name)
    return run(["sc", "delete", name], timeout=60)


# ---------------------------------------------------------------- procesos
class PROCESSENTRY32W(ctypes.Structure):
    _fields_ = [("dwSize", wintypes.DWORD), ("cntUsage", wintypes.DWORD), ("th32ProcessID", wintypes.DWORD),
                ("th32DefaultHeapID", ctypes.c_size_t), ("th32ModuleID", wintypes.DWORD),
                ("cntThreads", wintypes.DWORD), ("th32ParentProcessID", wintypes.DWORD),
                ("pcPriClassBase", ctypes.c_long), ("dwFlags", wintypes.DWORD), ("szExeFile", ctypes.c_wchar * 260)]


_k32 = ctypes.windll.kernel32
_k32.OpenProcess.restype = wintypes.HANDLE
_k32.CreateToolhelp32Snapshot.restype = wintypes.HANDLE


def _proc_path(pid):
    h = _k32.OpenProcess(0x1000, False, pid)  # PROCESS_QUERY_LIMITED_INFORMATION
    if not h:
        return ""
    try:
        buf = ctypes.create_unicode_buffer(1024)
        n = wintypes.DWORD(1024)
        if _k32.QueryFullProcessImageNameW(h, 0, buf, ctypes.byref(n)):
            return buf.value
        return ""
    finally:
        _k32.CloseHandle(h)


def list_processes():
    snap = _k32.CreateToolhelp32Snapshot(0x2, 0)
    out = []
    if not snap or snap == wintypes.HANDLE(-1).value:
        return out
    try:
        e = PROCESSENTRY32W()
        e.dwSize = ctypes.sizeof(e)
        ok = _k32.Process32FirstW(snap, ctypes.byref(e))
        while ok:
            out.append({"pid": e.th32ProcessID, "ppid": e.th32ParentProcessID, "name": e.szExeFile,
                        "path": _proc_path(e.th32ProcessID)})
            ok = _k32.Process32NextW(snap, ctypes.byref(e))
    finally:
        _k32.CloseHandle(snap)
    return out


def processes_in(folders):
    """Procesos cuyo .exe esta dentro de alguna de las carpetas (nunca de Windows ni MiniRevo)."""
    win = paths.kf("Windows")
    me = os.getpid()
    out = []
    for p in list_processes():
        if not p["path"] or p["pid"] in (0, 4, me):
            continue
        if win and paths.is_within(p["path"], win):
            continue
        if any(paths.is_within(p["path"], s) for s in paths.self_paths()):
            continue
        if any(f and paths.is_within(p["path"], f) for f in folders):
            out.append(p)
    return out


def kill(pid):
    h = _k32.OpenProcess(0x0001, False, pid)  # PROCESS_TERMINATE
    if not h:
        return False
    try:
        return bool(_k32.TerminateProcess(h, 1))
    finally:
        _k32.CloseHandle(h)


# ---------------------------------------------------------------- varios
def pending_reboot():
    hk = winreg.HKEY_LOCAL_MACHINE
    if registry.get_value(hk, r"SYSTEM\CurrentControlSet\Control\Session Manager", "PendingFileRenameOperations"):
        return True
    for k in (r"SOFTWARE\Microsoft\Windows\CurrentVersion\Component Based Servicing\RebootPending",
              r"SOFTWARE\Microsoft\Windows\CurrentVersion\WindowsUpdate\Auto Update\RebootRequired"):
        try:
            winreg.CloseKey(winreg.OpenKey(hk, k))
            return True
        except OSError:
            pass
    return False


def broadcast_env_change():
    try:
        res = ctypes.c_ulong()
        ctypes.windll.user32.SendMessageTimeoutW(0xFFFF, 0x1A, 0, "Environment", 0x2, 3000, ctypes.byref(res))
    except Exception:
        pass


def delete_on_reboot(path):
    """Programa el borrado de un archivo/carpeta vacia al reiniciar (requiere admin)."""
    try:
        return bool(_k32.MoveFileExW(str(path), None, 0x4))  # MOVEFILE_DELAY_UNTIL_REBOOT
    except Exception:
        return False


def create_restore_point(description):
    """Crea un punto de restauracion saltandose el limite de 1 cada 24 h (y lo deja como estaba)."""
    key = r"SOFTWARE\Microsoft\Windows NT\CurrentVersion\SystemRestore"
    hk = winreg.HKEY_LOCAL_MACHINE
    old = registry.get_value(hk, key, "SystemRestorePointCreationFrequency")
    changed = False
    try:
        with winreg.CreateKeyEx(hk, key, 0, winreg.KEY_SET_VALUE | registry.V64) as k:
            winreg.SetValueEx(k, "SystemRestorePointCreationFrequency", 0, winreg.REG_DWORD, 0)
            changed = True
    except OSError:
        pass
    desc = description.replace("'", "")[:60]
    code, out = powershell(f"Enable-ComputerRestore -Drive $env:SystemDrive -ErrorAction SilentlyContinue; "
                           f"Checkpoint-Computer -Description '{desc}' -RestorePointType APPLICATION_UNINSTALL "
                           f"-ErrorAction Stop", timeout=300)
    if changed:
        try:
            with winreg.OpenKey(hk, key, 0, winreg.KEY_SET_VALUE | registry.V64) as k:
                if old is None:
                    winreg.DeleteValue(k, "SystemRestorePointCreationFrequency")
                else:
                    winreg.SetValueEx(k, "SystemRestorePointCreationFrequency", 0, winreg.REG_DWORD, old)
        except OSError:
            pass
    return code == 0, out.strip()
