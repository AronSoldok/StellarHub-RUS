import os
import tempfile

# Las pruebas nunca escriben en C:\ProgramData\StellarHub: usan su propia carpeta de datos.
os.environ.setdefault("STELLARHUB_DATA", os.path.join(tempfile.gettempdir(), "stellarhub_testdata"))
