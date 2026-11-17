"""Ejecutar PowerShell y programas de consola sin abrir ventanas, en UTF-8, con salida en vivo si hace falta."""
import json
import subprocess

NO_WINDOW = 0x08000000
_PRE = ("$ProgressPreference='SilentlyContinue'; $ErrorActionPreference='Continue'; "
        "[Console]::OutputEncoding=[Text.Encoding]::UTF8; ")


def ps(script, timeout=90):
    """Devuelve la salida (texto) de un script de PowerShell."""
    r = subprocess.run(["powershell.exe", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
                        "-Command", _PRE + script], capture_output=True, timeout=timeout, creationflags=NO_WINDOW)
    return r.stdout.decode("utf-8", "replace")


def ps_json(script, timeout=90, as_list=False):
    """Ejecuta `script | ConvertTo-Json` y devuelve el objeto. Con as_list siempre devuelve una lista."""
    # strip(): en PowerShell 5 una línea no puede empezar por "|"
    out = ps(f"{script.strip()} | ConvertTo-Json -Depth 6 -Compress", timeout=timeout).strip()
    if not out:
        return [] if as_list else None
    try:
        data = json.loads(out)
    except ValueError:
        return [] if as_list else None
    if as_list and not isinstance(data, list):
        data = [data]
    return data


def run(cmd, on_line=None, timeout=None, cwd=None, encoding=None, job=None):
    """Ejecuta un programa. Con on_line recibe cada línea en cuanto sale (para consolas en vivo).
    Si se pasa `job` y el usuario cancela, el proceso se termina. Devuelve (código, salida completa)."""
    p = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL,
                         cwd=cwd, creationflags=NO_WINDOW)
    out = []
    enc = encoding or "utf-8"
    try:
        for raw in iter(p.stdout.readline, b""):
            line = _decode(raw, enc)
            out.append(line)
            if on_line:
                on_line(line.rstrip("\r\n"))
            if job is not None and job.cancelled:
                p.kill()
                break
        p.wait(timeout=timeout)
    except subprocess.TimeoutExpired:
        p.kill()
    return p.returncode, "".join(out)


def _decode(raw, enc):
    # sfc/dism/chkdsk escriben en UTF-16 o en la página de códigos OEM según la versión
    if raw.count(b"\x00") > len(raw) // 3:
        return raw.decode("utf-16-le", "replace").replace("\x00", "")
    try:
        return raw.decode(enc)
    except UnicodeDecodeError:
        return raw.decode("cp850", "replace")
