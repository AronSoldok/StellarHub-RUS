@echo off
rem Opens StellarHub without a console. To see errors: python run.py --debug
start "" pythonw "%~dp0run.py" %*
