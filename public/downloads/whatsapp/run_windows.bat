@echo off
setlocal enabledelayedexpansion
chcp 65001 > nul 2>&1
title Hader WhatsApp Pro Server v3.0 — Windows Edition
color 0B

:: ======================================================
::   HADER WHATSAPP PRO SERVER — WINDOWS RUNNER v3.0
:: ======================================================
echo.
echo    =======================================================
echo       HADER WHATSAPP PRO SERVER  [Windows Edition v3.0]
echo    =======================================================
echo.

:: Resolve script directory
cd /d "%~dp0"

:: ══════════════════════════════════════════════════════
:: PHASE 1 — Environment Cleanup
:: ══════════════════════════════════════════════════════
echo [1/6] Cleaning up previous sessions...
taskkill /F /IM chromedriver.exe /T  > nul 2>&1
:: Only kill python processes running server.py to avoid killing other python apps
wmic process where "name='python.exe' and CommandLine like '%%server.py%%'" call terminate > nul 2>&1
echo [OK] Cleanup done.

:: ══════════════════════════════════════════════════════
:: PHASE 2 — Port Check
:: ══════════════════════════════════════════════════════
echo [2/6] Checking Port 5001...
netstat -ano | findstr ":5001 " | findstr "LISTENING" > nul 2>&1
if %errorlevel% == 0 (
    echo [!] Port 5001 is in use — freeing it...
    for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":5001 " ^| findstr "LISTENING"') do (
        if not "%%a"=="" taskkill /F /PID %%a > nul 2>&1
    )
    timeout /t 1 /nobreak > nul
    echo [OK] Port 5001 released.
) else (
    echo [OK] Port 5001 is available.
)

:: ══════════════════════════════════════════════════════
:: PHASE 3 — Verify Required Files
:: ══════════════════════════════════════════════════════
echo [3/6] Verifying required files...
if not exist "server.py" (
    echo.
    echo [ERROR] server.py not found in: %cd%
    echo         Make sure you extracted all files correctly.
    echo.
    pause
    exit /b 1
)
if not exist "whatsapp_pro_tool.py" (
    echo.
    echo [ERROR] whatsapp_pro_tool.py not found.
    echo.
    pause
    exit /b 1
)
if not exist "requirements.txt" (
    echo.
    echo [ERROR] requirements.txt not found.
    echo.
    pause
    exit /b 1
)
echo [OK] All required files present.

:: ══════════════════════════════════════════════════════
:: PHASE 4 — Python Detection
:: ══════════════════════════════════════════════════════
echo [4/6] Detecting Python...
where python > nul 2>&1
if %errorlevel% neq 0 (
    echo.
    echo [ERROR] Python 3 is NOT installed or not in PATH.
    echo         Download from: https://www.python.org/
    echo         IMPORTANT: Check "Add Python to PATH" during installation!
    echo.
    pause
    exit /b 1
)

for /f "tokens=*" %%v in ('python --version 2^>^&1') do set PYTHON_VER=%%v
echo [OK] Found: %PYTHON_VER%

:: ══════════════════════════════════════════════════════
:: PHASE 5 — Virtual Environment & Dependencies
:: ══════════════════════════════════════════════════════
if not exist "venv" (
    echo [5/6] Creating virtual environment (first run only)...
    python -m venv venv
    if %errorlevel% neq 0 (
        echo.
        echo [ERROR] Failed to create virtual environment.
        echo         Make sure Python 3 is installed correctly.
        echo.
        pause
        exit /b 1
    )
)

echo [5/6] Activating virtual environment...
call "venv\Scripts\activate.bat"
if %errorlevel% neq 0 (
    echo [ERROR] Failed to activate virtual environment.
    pause
    exit /b 1
)

echo [5/6] Installing / verifying dependencies from requirements.txt...
python -m pip install --upgrade pip --quiet --disable-pip-version-check
pip install -r requirements.txt --quiet --disable-pip-version-check

if %errorlevel% neq 0 (
    echo.
    echo [ERROR] Dependency installation failed.
    echo         Try running manually: pip install -r requirements.txt
    echo.
    pause
    exit /b 1
)
echo [OK] Dependencies ready.

:: Create required directories
if not exist "uploads"          mkdir uploads
if not exist "certificates"     mkdir certificates
if not exist "logs"             mkdir logs
if not exist "whatsapp_session" mkdir whatsapp_session

:: ══════════════════════════════════════════════════════
:: PHASE 6 — Launch Server
:: ══════════════════════════════════════════════════════
echo.
echo    =======================================================
echo    [OK] SYSTEM READY — Starting server on port 5001
echo    Keep this window open. Minimise for background work.
echo    =======================================================
echo.

set FLASK_ENV=production
set WHATSAPP_SERVER_PORT=5001
set PYTHONIOENCODING=utf-8
set PYTHONUTF8=1

echo [6/6] Launching server...
python server.py

if %errorlevel% neq 0 (
    echo.
    echo [CRITICAL ERROR] Server exited with code %errorlevel%.
    echo                  Check logs\server.log for details.
    echo.
)

echo.
echo [INFO] Session ended.
pause
