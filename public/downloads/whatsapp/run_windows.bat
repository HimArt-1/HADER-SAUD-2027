@echo off
setlocal enabledelayedexpansion
title Hader WhatsApp Pro Server v2.0
color 0B

echo.
echo    =======================================================
echo       _    _             _               _____           
echo      ^| ^|  ^| ^|           ^| ^|             ^|  __ \          
echo      ^| ^|__^| ^| __ _  __| ^| ___ _ __     ^| ^|__) ^| __ ___  
echo      ^|  __  ^|/ _` ^|/ _` ^|/ _ \ '__^|    ^|  ___/ '__/ _ \ 
echo      ^| ^|  ^| ^| (_^| ^| (_^| ^|  __/ ^|       ^| ^|   ^| ^| ^| (_) ^|
echo      ^|_^|  ^|_^|\__,_^|\__,_^|\___^|_^|       ^|_^|   ^|_^|  \___/ 
echo.
echo            PREMIUM WHATSAPP AUTOMATION ENGINE
echo    =======================================================
echo.

:: Set current directory to script location
cd /d %~dp0

:: 1. Check for Essential Files
echo [1/5] Checking project files...
if not exist server.py (
    echo.
    echo [❌ ERROR] server.py not found!
    echo Please make sure you extracted all files from the ZIP.
    echo Current location: %cd%
    echo.
    pause
    exit /b
)
echo [OK] Core files found.

:: 2. Check Python
echo [2/5] Checking Python environment...
where python >nul 2>&1
if %errorlevel% neq 0 (
    echo.
    echo [❌ ERROR] Python is not installed or not in your PATH.
    echo Please install Python 3.10+ from: https://www.python.org/
    echo ** IMPORTANT: Check "Add Python to PATH" during installation. **
    echo.
    pause
    exit /b
)
for /f "tokens=2" %%v in ('python --version') do set pyver=%%v
echo [OK] Python %pyver% detected.

:: 3. Setup Virtual Environment
if not exist venv (
    echo [3/5] Creating Virtual Environment (First time only)...
    python -m venv venv
    if %errorlevel% neq 0 (
        echo [❌ ERROR] Failed to create virtual environment.
        pause
        exit /b
    )
) else (
    echo [3/5] Virtual Environment found.
)

:: 4. Activate & Install
echo [4/5] Activating environment and syncing dependencies...
if exist venv\Scripts\activate.bat (
    call venv\Scripts\activate.bat
) else (
    echo [❌ ERROR] venv\Scripts\activate.bat not found.
    pause
    exit /b
)

:: Update pip
python -m pip install --upgrade pip --quiet

:: Install requirements
if exist requirements.txt (
    pip install -r requirements.txt --quiet
) else (
    echo [INFO] requirements.txt missing, installing core packages manually...
    pip install flask flask-cors selenium webdriver-manager pandas Pillow python-dotenv --quiet
)

if %errorlevel% neq 0 (
    echo [RETRY] Attempting dependency fix...
    pip install flask flask-cors selenium webdriver-manager pandas Pillow python-dotenv --quiet
)

:: 5. Launch
echo.
echo    =======================================================
echo    ✅ SYSTEM READY - Starting Server on Port 5001
echo    -------------------------------------------------------
echo    Keep this window open while using Hader.
echo    Minimize it if you like, but do not close it.
echo    =======================================================
echo.

:: Run server and capture any immediate crash
python server.py

if %errorlevel% neq 0 (
    echo.
    echo [❌ CRITICAL ERROR] Server stopped unexpectedly with exit code %errorlevel%
    echo Possible reasons:
    echo 1. Port 5001 is already in use by another app.
    echo 2. Missing dependencies (check logs above).
    echo 3. Chrome browser is not installed.
    echo.
    pause
)

echo.
echo Server session ended.
pause
