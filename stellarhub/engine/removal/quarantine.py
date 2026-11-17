"""Eliminacion segura con cuarentena restaurable.

Cada eliminacion crea una sesion en ProgramData\\MiniRevo\\quarantine\\<id> con:
  manifest.json  - que se quito, de donde y como devolverlo
  files\\         - archivos y carpetas movidos
  reg\\           - copias .reg de claves, servicios
  tasks\\         - XML de tareas programadas
La seguridad se vuelve a comprobar elemento a elemento justo antes de tocar nada.
"""
import base64
import datetime
import json
import os
import re
import shutil
import stat
import time
import winreg

from . import index, paths, registry, safety, system
from .paths import is_within, norm_path
from .registry import RegRef

ORDER = {"service": 0, "task": 1, "fwrule": 2, "regvalue": 3, "regkey": 4, "envpath": 5, "file": 6, "folder": 7}


def qroot():
    return paths.data_path("quarantine")


def _session_dir(sid):
    return os.path.join(qroot(), sid)


def _save(manifest):
    d = _session_dir(manifest["id"])
    os.makedirs(d, exist_ok=True)
    tmp = os.path.join(d, "manifest.json.tmp")
    for attempt in range(5):  # el antivirus puede tener el archivo abierto un instante
        try:
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(manifest, f, ensure_ascii=False, indent=1)
            os.replace(tmp, os.path.join(d, "manifest.json"))
            return
        except PermissionError:
            if attempt == 4:
                raise
            time.sleep(0.1 * (attempt + 1))


def _slug(s):
    return re.sub(r"[^A-Za-z0-9]+", "-", s or "x").strip("-")[:30] or "x"


# ---------------------------------------------------------------- utilidades de archivos
def _make_writable(func, path, exc):
    try:
        os.chmod(path, stat.S_IWRITE)
        func(path)
    except Exception:
        raise exc[1] if isinstance(exc, tuple) else exc


def _rmtree(path):
    shutil.rmtree(path, onexc=_make_writable)


def _move_tree(src, dst, result):
    """Mueve src a dst. Si algo esta bloqueado, mueve lo que pueda y programa el resto para el reinicio."""
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    try:
        os.replace(src, dst) if os.path.splitdrive(src)[0].lower() == os.path.splitdrive(dst)[0].lower() \
            else shutil.move(src, dst)
        return
    except OSError:
        pass
    if os.path.isfile(src):
        try:
            shutil.copy2(src, dst)
            os.remove(src)
        except OSError:
            if system.delete_on_reboot(src):
                result["reboot"] += 1
            else:
                raise
        return
    # carpeta con archivos en uso: archivo a archivo
    for dp, dn, fn in os.walk(src, topdown=True):
        dn[:] = [d for d in dn if not paths.is_reparse_point(os.path.join(dp, d))]
        rel = os.path.relpath(dp, src)
        tdir = os.path.join(dst, rel) if rel != "." else dst
        os.makedirs(tdir, exist_ok=True)
        for f in fn:
            s, t = os.path.join(dp, f), os.path.join(tdir, f)
            try:
                os.replace(s, t)
            except OSError:
                try:
                    shutil.copy2(s, t)
                    os.remove(s)
                except OSError:
                    if system.delete_on_reboot(s):
                        result["reboot"] += 1
    _remove_empty_dirs(src, result)


def _remove_empty_dirs(root, result):
    for dp, dn, fn in os.walk(root, topdown=False):
        try:
            os.rmdir(dp)
        except OSError:
            if system.delete_on_reboot(dp):
                result["reboot"] += 1


def _delete_tree(path, result):
    if os.path.isdir(path):
        try:
            _rmtree(path)
            return
        except OSError:
            pass
        for dp, dn, fn in os.walk(path, topdown=False):
            for f in fn:
                fp = os.path.join(dp, f)
                try:
                    os.chmod(fp, stat.S_IWRITE)
                    os.remove(fp)
                except OSError:
                    if system.delete_on_reboot(fp):
                        result["reboot"] += 1
        _remove_empty_dirs(path, result)
    else:
        try:
            os.chmod(path, stat.S_IWRITE)
            os.remove(path)
        except OSError:
            if system.delete_on_reboot(path):
                result["reboot"] += 1
            else:
                raise


def _real_move(src, dst):
    """Mover de vuelta a su sitio. Con la Python de la Store, AppData se virtualiza: se usa un proceso hijo."""
    os.makedirs(os.path.dirname(dst), exist_ok=True) if not paths.running_packaged() else None
    if paths.running_packaged():
        ps_src, ps_dst = src.replace("'", "''"), dst.replace("'", "''")
        code, out = system.powershell(
            f"New-Item -ItemType Directory -Force -Path (Split-Path -LiteralPath '{ps_dst}') | Out-Null; "
            f"Move-Item -LiteralPath '{ps_src}' -Destination '{ps_dst}' -Force -ErrorAction Stop")
        if code != 0:
            raise OSError(out.strip()[:300])
        return
    if os.path.splitdrive(src)[0].lower() == os.path.splitdrive(dst)[0].lower():
        os.replace(src, dst)
    else:
        shutil.move(src, dst)


# ---------------------------------------------------------------- valores del registro
def _pack_value(data, typ):
    if isinstance(data, bytes):
        return {"b64": base64.b64encode(data).decode(), "type": typ}
    return {"v": data, "type": typ}


def _unpack_value(d):
    return (base64.b64decode(d["b64"]) if "b64" in d else d["v"]), d["type"]


# ---------------------------------------------------------------- eliminar
def remove(program, items, programs=(), mode="quarantine", progress=None):
    """Elimina los elementos (dicts del escaner). Devuelve el resumen."""
    progress = progress or (lambda *a: None)
    base = datetime.datetime.now().strftime("%Y%m%d-%H%M%S") + "-" + _slug(program.get("name"))
    # sesion unica: dos eliminaciones del mismo programa en el mismo segundo no pueden compartir carpeta
    # (la segunda sobrescribiria el manifiesto y lo de la primera ya no se podria restaurar)
    sid, n = base, 1
    while True:
        try:
            os.makedirs(_session_dir(sid))
            break
        except FileExistsError:
            n += 1
            sid = f"{base}-{n}"
    sdir = _session_dir(sid)
    manifest = {"id": sid, "program": program.get("name"), "publisher": program.get("publisher", ""),
                "created": time.time(), "mode": mode, "items": []}
    ctx = safety.Context(target=program, programs=programs)
    result = {"ok": 0, "failed": 0, "skipped": 0, "reboot": 0, "freed": 0, "errors": [], "session": sid}
    items = sorted(items, key=lambda i: ORDER.get(i["kind"], 9))
    fw_batch = []
    for n, it in enumerate(items):
        progress(n / max(len(items), 1), it.get("display", it["target"])[:80])
        rec = {"kind": it["kind"], "target": it["target"], "display": it.get("display", it["target"]),
               "status": "pending"}
        manifest["items"].append(rec)
        try:
            blocked = _recheck(it, ctx)
            if blocked:
                rec.update(status="skipped", error=f"Bloqueado por seguridad: {blocked}")
                result["skipped"] += 1
                continue
            k = it["kind"]
            if k in ("file", "folder"):
                _do_path(it, rec, sdir, n, mode, result)
            elif k == "regkey":
                ref = RegRef.from_str(it["target"])
                if not registry.key_exists(ref):
                    rec["status"] = "gone"
                    continue
                regf = os.path.join(sdir, "reg", f"{n}.reg")
                if not registry.export_key(ref, regf):
                    raise OSError("No se pudo hacer la copia .reg; por seguridad no se borra")
                rec.update(reg_file=regf, view=ref.view)
                registry.delete_tree(ref)
            elif k == "regvalue":
                ref = RegRef.from_str(it["target"])
                cur = registry.read_value_full(ref)
                if cur is None:
                    rec["status"] = "gone"
                    continue
                rec["value"] = _pack_value(*cur)
                registry.delete_value(ref)
            elif k == "service":
                regf = os.path.join(sdir, "reg", f"{n}.reg")
                registry.export_key(RegRef("HKLM", rf"SYSTEM\CurrentControlSet\Services\{it['target']}"), regf)
                rec["reg_file"] = regf
                code, out = system.delete_service(it["target"])
                if code not in (0, 1060):  # 1060 = ya no existe
                    raise OSError(out.strip()[:200])
            elif k == "task":
                xml = system.export_task(it["target"])
                if xml:
                    tf = os.path.join(sdir, "tasks", f"{n}.xml")
                    os.makedirs(os.path.dirname(tf), exist_ok=True)
                    with open(tf, "w", encoding="utf-16") as f:
                        f.write(xml)
                    rec["task_file"] = tf
                code, out = system.delete_task(it["target"])
                if code != 0:
                    raise OSError(out.strip()[:200])
            elif k == "fwrule":
                rec["fw_data"] = it.get("fw_data", "")
                fw_batch.append((it["target"], rec))
                continue  # se aplica en bloque al final
            elif k == "envpath":
                _do_envpath(it, rec)
            if rec["status"] == "pending":
                rec["status"] = "done"
            result["ok"] += 1
        except Exception as e:
            rec.update(status="failed", error=str(e)[:300])
            result["failed"] += 1
            result["errors"].append(f"{rec['display'][:90]}: {str(e)[:160]}")
        finally:
            _save(manifest)
    if fw_batch:
        names = ",".join("'" + n.replace("'", "''") + "'" for n, _ in fw_batch)
        code, out = system.powershell(f"Remove-NetFirewallRule -Name {names} -ErrorAction SilentlyContinue; "
                                      f"exit 0")
        fw = r"SYSTEM\CurrentControlSet\Services\SharedAccess\Parameters\FirewallPolicy\FirewallRules"
        for name, rec in fw_batch:
            ref = RegRef("HKLM", fw, 0, name)
            if registry.value_exists(ref):
                try:
                    registry.delete_value(ref)
                except OSError as e:
                    rec.update(status="failed", error=str(e))
                    result["failed"] += 1
                    continue
            rec["status"] = "done"
            result["ok"] += 1
        _save(manifest)
    manifest["result"] = {k: v for k, v in result.items() if k != "errors"}
    _save(manifest)
    index.invalidate()
    progress(1.0, "Listo")
    return result


def _recheck(it, ctx):
    k = it["kind"]
    if k in ("file", "folder"):
        if not os.path.lexists(it["target"]):
            return None
        return ctx.check_path(it["target"])[0]
    if k in ("regkey", "regvalue"):
        return safety.reg_rule(RegRef.from_str(it["target"]))
    if k == "service":
        return safety.service_rule(it["target"])
    if k == "task" and it["target"].lower().startswith("\\microsoft\\"):
        return "Tarea de Microsoft"
    return None


def _do_path(it, rec, sdir, n, mode, result):
    src = it["target"]
    if not os.path.lexists(src):
        rec["status"] = "gone"
        return
    if paths.is_reparse_point(src):
        rec["link_target"] = os.readlink(src) if hasattr(os, "readlink") else ""
        (os.rmdir if os.path.isdir(src) else os.remove)(src)  # quita el enlace, nunca su contenido
        rec["status"] = "done"
        return
    size = paths.path_size(src)
    before = result["reboot"]
    if mode == "delete":
        _delete_tree(src, result)
    else:
        dst = os.path.join(sdir, "files", f"{n}_{_slug(os.path.basename(src))}")
        _move_tree(src, dst, result)
        rec["stored"] = dst
    if result["reboot"] > before:
        rec["reboot"] = result["reboot"] - before
    result["freed"] += size
    rec["size"] = size


def _do_envpath(it, rec):
    scope, entry = it["target"].split("|", 1)
    if scope == "user":
        hive, path = winreg.HKEY_CURRENT_USER, "Environment"
    else:
        hive, path = winreg.HKEY_LOCAL_MACHINE, r"SYSTEM\CurrentControlSet\Control\Session Manager\Environment"
    with winreg.OpenKey(hive, path, 0, winreg.KEY_READ | winreg.KEY_SET_VALUE) as k:
        val, typ = winreg.QueryValueEx(k, "Path")
        parts = [p for p in str(val).split(";")]
        new = [p for p in parts if p.strip().lower().rstrip("\\") != entry.strip().lower().rstrip("\\")]
        if len(new) == len(parts):
            rec["status"] = "gone"
            return
        rec["env_old_index"] = parts.index(next(p for p in parts if p not in new))
        winreg.SetValueEx(k, "Path", 0, typ, ";".join(new))
    system.broadcast_env_change()


# ---------------------------------------------------------------- sesiones
def sessions():
    out = []
    root = qroot()
    for sid in sorted(os.listdir(root), reverse=True) if os.path.isdir(root) else []:
        mf = os.path.join(root, sid, "manifest.json")
        try:
            with open(mf, encoding="utf-8") as f:
                m = json.load(f)
        except (OSError, ValueError):
            continue
        items = m.get("items", [])
        out.append({"id": sid, "program": m.get("program"), "publisher": m.get("publisher", ""), "created": m.get("created"), "mode": m.get("mode"),
                    "restored": m.get("restored", False),
                    "count": sum(1 for i in items if i["status"] == "done"),
                    "size": sum(i.get("size", 0) for i in items if i["status"] == "done"),
                    "restorable": m.get("mode") == "quarantine" and not m.get("restored"),
                    "items": [{"idx": n, "kind": i["kind"], "display": i["display"], "status": i["status"],
                               "target": i.get("target", ""), "size": i.get("size", 0),
                               "error": i.get("error", "")} for n, i in enumerate(items)]})
    return out


def restore(sid, progress=None, only=None):
    """Devuelve a su sitio lo guardado en una sesión. Con `only` (índices de sessions()[..]["items"]) solo esos."""
    progress = progress or (lambda *a: None)
    only = None if only is None else {int(x) for x in only}
    mf = os.path.join(_session_dir(sid), "manifest.json")
    with open(mf, encoding="utf-8") as f:
        m = json.load(f)
    res = {"ok": 0, "failed": 0, "errors": [], "needs_reboot": False}
    items = [i for n, i in enumerate(m["items"]) if i["status"] == "done" and (only is None or n in only)]
    # al reves: primero carpetas/archivos, luego registro, luego servicios
    items.sort(key=lambda i: -ORDER.get(i["kind"], 9))
    for n, it in enumerate(items):
        progress(n / max(len(items), 1), it["display"][:80])
        try:
            k = it["kind"]
            if k in ("file", "folder"):
                if not it.get("stored"):
                    raise OSError("Se eliminó de forma definitiva o era un enlace")
                if os.path.lexists(it["target"]):
                    raise OSError("Ya existe algo en la ruta original")
                _real_move(it["stored"], it["target"])
            elif k in ("regkey", "service"):
                ok, out = registry.import_reg(it["reg_file"], it.get("view", 0))
                if not ok:
                    raise OSError(out)
                if k == "service":
                    res["needs_reboot"] = True
            elif k == "regvalue":
                data, typ = _unpack_value(it["value"])
                registry.set_value(RegRef.from_str(it["target"]), data, typ)
            elif k == "task" and it.get("task_file"):
                code, out = system.run(["schtasks", "/Create", "/TN", it["target"], "/XML", it["task_file"], "/F"])
                if code != 0:
                    raise OSError(out)
            elif k == "fwrule":
                fw = r"SYSTEM\CurrentControlSet\Services\SharedAccess\Parameters\FirewallPolicy\FirewallRules"
                registry.set_value(RegRef("HKLM", fw, 0, it["target"]), it["fw_data"], winreg.REG_SZ)
                res["needs_reboot"] = True
            elif k == "envpath":
                scope, entry = it["target"].split("|", 1)
                hive, path = ((winreg.HKEY_CURRENT_USER, "Environment") if scope == "user" else
                              (winreg.HKEY_LOCAL_MACHINE, r"SYSTEM\CurrentControlSet\Control\Session Manager\Environment"))
                with winreg.OpenKey(hive, path, 0, winreg.KEY_READ | winreg.KEY_SET_VALUE) as kk:
                    val, typ = winreg.QueryValueEx(kk, "Path")
                    parts = str(val).split(";")
                    parts.insert(min(it.get("env_old_index", len(parts)), len(parts)), entry)
                    winreg.SetValueEx(kk, "Path", 0, typ, ";".join(parts))
                system.broadcast_env_change()
            it["status"] = "restored"
            res["ok"] += 1
        except Exception as e:
            res["failed"] += 1
            res["errors"].append(f"{it['display'][:90]}: {str(e)[:160]}")
    m["restored"] = not any(i["status"] == "done" for i in m["items"])
    _save(m)
    index.invalidate()
    progress(1.0, "Listo")
    return res


def delete_session(sid):
    d = _session_dir(sid)
    if is_within(d, qroot()) and norm_path(d) != norm_path(qroot()):
        _rmtree(d)


def purge(days=14):
    cutoff = time.time() - days * 86400
    n = 0
    for s in sessions():
        if (s.get("created") or 0) < cutoff:
            delete_session(s["id"])
            n += 1
    return n


def stats():
    s = sessions()
    return {"sessions": len(s), "size": sum(x["size"] for x in s if x["restorable"])}
