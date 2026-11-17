"""StellarHub launcher.  Usage: pythonw run.py   (--debug opens the developer tools)"""
import os
import sys

if sys.platform != "win32":
    sys.exit("StellarHub only runs on Windows.")

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from stellarhub.app import main  # noqa: E402

if __name__ == "__main__":
    main()
