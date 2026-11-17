"""Run PowerShell and console programs without opening windows, in UTF-8, with live output when needed."""
import json
import subprocess
import threading

NO_WINDOW = 0x08000000
_PRE = ("$ProgressPreference='SilentlyContinue'; $ErrorActionPreference='Continue'; "
        "[Console]::OutputEncoding=[Text.Encoding]::UTF8; ")
# At startup several modules query Windows at once; a dozen PowerShell processes in parallel starve each
# other and hit their timeouts on a busy PC. At most 3 run at the same time; the rest wait their turn,
# and a script's timeout only starts counting once it actually runs.
_SLOTS = threading.BoundedSemaphore(3)


def ps(script, timeout=90):
    """Returns the output (text) of a PowerShell script."""
    with _SLOTS:
        r = subprocess.run(["powershell.exe", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
                            "-Command", _PRE + script], capture_output=True, timeout=timeout, creationflags=NO_WINDOW)
    return r.stdout.decode("utf-8", "replace")


def ps_json(script, timeout=90, as_list=False):
    """Runs `script | ConvertTo-Json` and returns the object. With as_list it always returns a list."""
    # strip(): in PowerShell 5 a line cannot start with "|"
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
    """Runs a program. With on_line it gets each line as soon as it is printed (for live consoles).
    If `job` is passed and the user cancels, the process is killed. Returns (exit code, full output)."""
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
    # sfc/dism/chkdsk write UTF-16 or the OEM code page depending on the version
    if raw.count(b"\x00") > len(raw) // 3:
        return raw.decode("utf-16-le", "replace").replace("\x00", "")
    try:
        return raw.decode(enc)
    except UnicodeDecodeError:
        return raw.decode("cp850", "replace")
