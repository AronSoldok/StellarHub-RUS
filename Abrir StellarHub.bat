@echo off
rem Abre StellarHub sin consola. Para ver errores: python run.py --debug
start "" pythonw "%~dp0run.py" %*
