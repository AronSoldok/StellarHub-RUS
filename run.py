"""Lanzador de StellarHub.  Uso: pythonw run.py   (--debug abre las herramientas de desarrollo)"""
import os
import sys

if sys.platform != "win32":
    sys.exit("StellarHub solo funciona en Windows.")

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from stellarhub.app import main  # noqa: E402

if __name__ == "__main__":
    main()
