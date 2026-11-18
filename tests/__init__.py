import os
import tempfile

# The tests never write to C:\ProgramData\StellarHub: they use their own data folder.
os.environ.setdefault("STELLARHUB_DATA", os.path.join(tempfile.gettempdir(), "stellarhub_testdata"))

# Engine messages are compared in English: pin the language whatever Windows uses.
os.environ.setdefault("STELLARHUB_LANG", "en")
