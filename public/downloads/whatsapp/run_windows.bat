@echo off
setlocal DisableDelayedExpansion
chcp 65001 >nul 2>&1
title Hader WhatsApp Server
pushd "%~dp0"
if errorlevel 1 goto folder_error

echo ======================================================
echo HADER WHATSAPP SERVER - Windows
echo Keep this window open while using WhatsApp in Hader.
echo ======================================================
echo.
echo [1/4] Checking package files...
if not exist "server.py" goto missing_files
if not exist "whatsapp_pro_tool.py" goto missing_files
if not exist "sqlite_db.py" goto missing_files
if not exist "requirements.txt" goto missing_files

echo [2/4] Preparing Python...
if exist "venv\Scripts\python.exe" goto check_venv
py -3 -c "import sys; sys.exit(sys.version_info.major != 3)" >nul 2>&1
if not errorlevel 1 goto create_with_py
python -c "import sys; sys.exit(sys.version_info.major != 3)" >nul 2>&1
if errorlevel 1 goto python_error
python -m venv venv
if errorlevel 1 goto venv_error
goto check_venv

:create_with_py
py -3 -m venv venv
if errorlevel 1 goto venv_error

:check_venv
"venv\Scripts\python.exe" --version
if errorlevel 1 goto venv_error

echo [3/4] Installing dependencies. First setup needs Internet.
"venv\Scripts\python.exe" -m pip install -r requirements.txt --disable-pip-version-check
if errorlevel 1 goto dependencies_error

set "WHATSAPP_SERVER_HOST=127.0.0.1"
set "WHATSAPP_SERVER_PORT=5001"
set "FLASK_ENV=production"
set "PYTHONIOENCODING=utf-8"
set "PYTHONUTF8=1"
echo.
echo [4/4] Starting server at http://127.0.0.1:5001
echo After startup, check http://127.0.0.1:5001/api/status
echo Then open Hader and start the WhatsApp engine from the dashboard.
echo.
"venv\Scripts\python.exe" server.py
set "HADER_EXIT_CODE=%errorlevel%"
echo.
echo Server stopped. Exit code: %HADER_EXIT_CODE%
echo If an error appears above, copy it before closing this window.
goto finish

:missing_files
echo [ERROR] Required package files are missing.
echo Extract ALL files from the ZIP into one folder, then try again.
goto failed

:python_error
echo [ERROR] A working Python 3 installation was not found.
echo Install Python 3 from https://www.python.org/downloads/windows/
echo Enable Add Python to PATH, then close this window and try again.
goto failed

:venv_error
echo [ERROR] The Python virtual environment could not be created or used.
echo Copy the error above. If this package was moved from another PC,
echo rename only its venv folder to venv-old and try again.
goto failed

:dependencies_error
echo [ERROR] Dependency installation failed. Details appear above.
echo Check your Internet connection and try again.
goto failed

:folder_error
echo [ERROR] Cannot open the package folder. Extract the ZIP first.
pause
exit /b 1

:failed
set "HADER_EXIT_CODE=1"

:finish
echo.
pause
popd
exit /b %HADER_EXIT_CODE%
