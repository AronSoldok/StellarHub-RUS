"""Gestor de inicio: Run, carpeta Inicio, tareas al iniciar sesion y servicios automaticos.

Desactivar usa el mismo mecanismo que el Administrador de tareas (StartupApproved), asi que es
reversible y Windows lo entiende. Quitar del todo pasa por la cuarentena.
"""
import ctypes
import os
import struct
import time
import winreg
from concurrent.futures import ThreadPoolExecutor

from . import index, paths, registry, safety, shortcuts, system
from .registry import V32, V64, RegRef

_SA = r"Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved"


def file_company(path):
    """CompanyName de la informacion de version del ejecutable."""
    try:
        ver = ctypes.windll.version
        size = ver.GetFileVersionInfoSizeW(path, None)
        if not size:
            return ""
        buf = ctypes.create_string_buffer(size)
        if not ver.GetFileVersionInfoW(path, 0, size, buf):
            return ""
        ptr, ln = ctypes.c_void_p(), ctypes.c_uint()
        if not ver.VerQueryValueW(buf, r"\VarFileInfo\Translation", ctypes.byref(ptr), ctypes.byref(ln)) or not ln.value:
            return ""
        lang, cp = struct.unpack("<HH", ctypes.string_at(ptr, 4))
        for key in (f"\\StringFileInfo\\{lang:04x}{cp:04x}\\CompanyName", "\\StringFileInfo\\040904b0\\CompanyName"):
            if ver.VerQueryValueW(buf, key, ctypes.byref(ptr), ctypes.byref(ln)) and ln.value:
                return ctypes.wstring_at(ptr, ln.value - 1).strip()
    except Exception:
        pass
    return ""


def _approved(hive, sub, name):
    data = registry.get_value(registry.HIVES[hive], f"{_SA}\\{sub}", name)
    if isinstance(data, bytes) and data:
        return data[0] % 2 == 0  # 02/06 activado, 03/07 desactivado
    return True


def _set_approved(hive, sub, name, enabled):
    if enabled:
        data = b"\x02" + b"\x00" * 11
    else:
        ft = int((time.time() + 11644473600) * 10_000_000)
        data = b"\x03\x00\x00\x00" + struct.pack("<Q", ft)
    with winreg.CreateKeyEx(registry.HIVES[hive], f"{_SA}\\{sub}", 0, winreg.KEY_SET_VALUE) as k:
        winreg.SetValueEx(k, name, 0, winreg.REG_BINARY, data)


def list_entries():
    out = []
    # claves Run
    for hive, view, sa in (("HKCU", 0, "Run"), ("HKLM", V64, "Run"), ("HKLM", V32, "Run32")):
        base = r"Software\Microsoft\Windows\CurrentVersion\Run"
        for name, data, _ in registry.values(registry.HIVES[hive], base, view):
            exe = safety.image_path(str(data))
            out.append({"id": f"run|{hive}|{view}|{name}", "type": "run", "name": name, "command": str(data),
                        "exe": exe, "enabled": _approved(hive, sa, name),
                        "where": "Registro (usuario)" if hive == "HKCU" else
                                 f"Registro (todos los usuarios{', 32 bits' if view == V32 else ''})"})
    # carpetas Inicio
    for folder, hive, label in ((paths.kf("Startup"), "HKCU", "Carpeta Inicio (usuario)"),
                                (paths.kf("CommonStartup"), "HKLM", "Carpeta Inicio (todos)")):
        if not folder or not os.path.isdir(folder):
            continue
        for f in os.listdir(folder):
            if f.lower() == "desktop.ini":
                continue
            full = os.path.join(folder, f)
            tgt = shortcuts.read_shortcut(full).get("target") or full
            out.append({"id": f"folder|{hive}|{full}", "type": "folder", "name": os.path.splitext(f)[0],
                        "command": tgt, "exe": tgt, "enabled": _approved(hive, "StartupFolder", f), "where": label})
    # tareas al iniciar sesion / arrancar
    for t in index.tasks():
        if not (t["logon"] or t["boot"]) or t["path"].lower().startswith("\\microsoft\\"):
            continue
        cmd = t["commands"][0] if t["commands"] else ("", "")
        out.append({"id": f"task|{t['path']}", "type": "task", "name": t["name"], "command": f"{cmd[0]} {cmd[1]}".strip(),
                    "exe": cmd[0], "enabled": t["enabled"], "where": "Tarea programada"})
    # servicios automaticos de terceros
    win = paths.kf("Windows")
    for s in index.services():
        if s["start"] != 2 or not isinstance(s["type"], int) or not s["type"] & 0x30:
            continue
        if win and paths.is_within(s["exe"], win):
            continue
        out.append({"id": f"service|{s['name']}", "type": "service", "name": s["display"], "command": s["image"],
                    "exe": s["exe"], "enabled": True, "where": "Servicio automático",
                    "locked": safety.service_rule(s["name"]) is not None})
    def finish(e):
        e["company"] = file_company(e["exe"]) if e.get("exe") and os.path.isfile(e["exe"]) else ""
        e["missing"] = bool(e.get("exe")) and os.path.isabs(e["exe"]) and not os.path.exists(e["exe"])
    with ThreadPoolExecutor(max_workers=6) as ex:
        list(ex.map(finish, out))
    return out


def set_enabled(entry_id, enabled):
    kind, rest = entry_id.split("|", 1)
    if kind == "run":
        hive, view, name = rest.split("|", 2)
        _set_approved(hive, "Run32" if int(view) == V32 else "Run", name, enabled)
    elif kind == "folder":
        hive, full = rest.split("|", 1)
        _set_approved(hive, "StartupFolder", os.path.basename(full), enabled)
    elif kind == "task":
        code, out = system.set_task_enabled(rest, enabled)
        index.invalidate("tasks")
        if code != 0:
            raise OSError(out.strip()[:200])
    elif kind == "service":
        reason = safety.service_rule(rest)
        if reason:
            raise PermissionError(reason)
        code, out = system.run(["sc", "config", rest, "start=", "auto" if enabled else "demand"])
        index.invalidate("services")
        if code != 0:
            raise OSError(out.strip()[:200])


def removal_item(entry_id):
    """Elemento para la cuarentena que quita la entrada del todo."""
    kind, rest = entry_id.split("|", 1)
    if kind == "run":
        hive, view, name = rest.split("|", 2)
        ref = RegRef(hive, r"Software\Microsoft\Windows\CurrentVersion\Run", int(view), name)
        return {"kind": "regvalue", "target": ref.to_str(), "display": ref.display()}
    if kind == "folder":
        _, full = rest.split("|", 1)
        return {"kind": "file", "target": full, "display": full}
    if kind == "task":
        return {"kind": "task", "target": rest, "display": f"Tarea: {rest}"}
    raise ValueError("Los servicios solo se pueden desactivar desde aquí")
