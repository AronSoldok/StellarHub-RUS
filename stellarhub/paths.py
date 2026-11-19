"""Where StellarHub keeps the user's data: in their profile, or next to the program in the portable version.

The portable version is the same program with a file named `StellarHub.portable` next to StellarHub.exe. Then
the settings, logs, history and the interface cache live in a `Data` folder beside it (so they travel on the USB
drive) and StellarHub leaves nothing in Windows' startup entries or scheduled tasks.

What it saves before changing the system (registry and service backups, the uninstaller's quarantine, driver
backups) stays in ProgramData on each PC on purpose: a backup of one PC's registry belongs to that PC, so the change
can be undone there whichever drive StellarHub runs from.
"""
import os
import sys

FROZEN = bool(getattr(sys, "frozen", False))
MARKER = "StellarHub.portable"


def program_dir():
    """The folder StellarHub.exe is in (the project folder when running from source)."""
    if FROZEN:
        return os.path.dirname(os.path.abspath(sys.executable))
    return os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _portable():
    if os.environ.get("STELLARHUB_PORTABLE") == "1":  # tests run the source as if it were portable
        return True
    return FROZEN and os.path.isfile(os.path.join(program_dir(), MARKER))


PORTABLE = _portable()


_portable_data = None


def _portable_data_dir():
    """<program>\\Data, or, when the drive is read-only or full (a locked USB stick, a read-only share), a folder for
    this copy in %LOCALAPPDATA% so StellarHub still starts and works."""
    global _portable_data
    if _portable_data:
        return _portable_data
    d = os.environ.get("STELLARHUB_PORTABLE_DATA") or os.path.join(program_dir(), "Data")
    try:
        os.makedirs(d, exist_ok=True)
        probe = os.path.join(d, ".write-test")
        with open(probe, "w") as fh:
            fh.write("1")
        os.remove(probe)
    except OSError:
        import hashlib
        tag = hashlib.sha1(os.path.normcase(program_dir()).encode("utf-8")).hexdigest()[:8]
        d = os.path.join(os.environ.get("LOCALAPPDATA") or os.path.expanduser("~"), "StellarHub", "Portable-" + tag)
    _portable_data = d
    return d


def data_dir():
    """Settings, logs, history: %APPDATA%\\StellarHub, or <program>\\Data in the portable version."""
    if PORTABLE:
        return _portable_data_dir()
    return os.path.join(os.environ.get("APPDATA") or os.path.expanduser("~"), "StellarHub")


def local_dir():
    """Machine-local cache (the interface's browser profile): %LOCALAPPDATA%\\StellarHub, or <program>\\Data\\Local."""
    if PORTABLE:
        return os.path.join(data_dir(), "Local")
    return os.path.join(os.environ.get("LOCALAPPDATA") or data_dir(), "StellarHub")


def settings_file():
    return os.path.join(data_dir(), "settings.json")
