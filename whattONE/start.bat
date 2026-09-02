@echo off
chcp 65001 >nul 2>&1
title whattONE v2 — أداة واتساب المتقدمة
color 0A
cd /d "%~dp0"
set SCRIPT_DIR=%~dp0
set VENV=%SCRIPT_DIR%venv

echo.
echo  ╔══════════════════════════════════════════════════════╗
echo  ║                                                      ║
echo  ║   🟢  whattONE v2.0 — أداة واتساب المتقدمة          ║
echo  ║                                                      ║
echo  ╠══════════════════════════════════════════════════════╣
echo  ║   📝 قوالب: غياب • تأخر • استئذان • رسالة عامة       ║
echo  ║   📥 استيراد: CSV / Excel                            ║
echo  ╚══════════════════════════════════════════════════════╝
echo.

:: ═══════════════════════════════════════
:: 1) Check Python
:: ═══════════════════════════════════════
echo  [1/4] 🔍 فحص Python...
python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo.
    echo  ❌ Python غير مثبت!
    echo.
    echo  📥 قم بتحميل Python من الرابط التالي:
    echo     https://www.python.org/downloads/
    echo.
    echo  ⚠️  تأكد من تفعيل "Add Python to PATH" اثناء التثبيت
    echo.
    pause
    exit /b 1
)
for /f "tokens=2" %%v in ('python --version 2^>^&1') do echo        ✅ Python %%v

:: ═══════════════════════════════════════
:: 2) Check/Install Chrome
:: ═══════════════════════════════════════
echo  [2/4] 🔍 فحص Google Chrome...
if exist "C:\Program Files\Google\Chrome\Application\chrome.exe" (
    echo        ✅ Chrome متوفر
) else if exist "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe" (
    echo        ✅ Chrome متوفر
) else (
    echo        ⚠️  Chrome غير متوفر - يجب تثبيته لتشغيل البوت
    echo        📥 https://www.google.com/chrome/
)

:: ═══════════════════════════════════════
:: 3) Setup Virtual Environment
:: ═══════════════════════════════════════
echo  [3/4] 📦 تجهيز البيئة...
if not exist "%VENV%" (
    echo        📦 إنشاء البيئة الافتراضية...
    python -m venv "%VENV%"
    if %errorlevel% neq 0 (
        echo  ❌ فشل إنشاء البيئة الافتراضية
        pause
        exit /b 1
    )
    echo        📥 تثبيت المتطلبات...
    "%VENV%\Scripts\pip" install --upgrade pip >nul 2>&1
    "%VENV%\Scripts\pip" install -r "%SCRIPT_DIR%requirements.txt"
    if %errorlevel% neq 0 (
        echo  ❌ فشل تثبيت المتطلبات
        pause
        exit /b 1
    )
    echo        ✅ تم التثبيت بنجاح
) else (
    echo        ✅ البيئة جاهزة
)

:: ═══════════════════════════════════════
:: 4) Load .env if exists
:: ═══════════════════════════════════════
if exist "%SCRIPT_DIR%.env" (
    for /f "usebackq tokens=* delims=" %%a in (`type "%SCRIPT_DIR%.env" ^| findstr /v "^#" ^| findstr /v "^$"`) do set "%%a"
)

:: ═══════════════════════════════════════
:: 5) Kill existing on port
:: ═══════════════════════════════════════
set PORT=5005
if defined WHATTONE_PORT set PORT=%WHATTONE_PORT%

for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":%PORT% " ^| findstr "LISTENING" 2^>nul') do (
    taskkill /PID %%p /F >nul 2>&1
)

:: ═══════════════════════════════════════
:: 6) Cleanup session locks
:: ═══════════════════════════════════════
if exist "%SCRIPT_DIR%session_data\SingletonLock" del /f "%SCRIPT_DIR%session_data\SingletonLock" >nul 2>&1
if exist "%SCRIPT_DIR%session_data\SingletonSocket" del /f "%SCRIPT_DIR%session_data\SingletonSocket" >nul 2>&1
if exist "%SCRIPT_DIR%session_data\SingletonCookie" del /f "%SCRIPT_DIR%session_data\SingletonCookie" >nul 2>&1

:: ═══════════════════════════════════════
:: 7) Launch
:: ═══════════════════════════════════════
echo  [4/4] 🚀 تشغيل الخادم...
echo.
echo  ╔══════════════════════════════════════════════════════╗
echo  ║  🌐 Dashboard: http://localhost:%PORT%                  ║
echo  ║  📡 API:       http://localhost:%PORT%/api/status        ║
echo  ╠══════════════════════════════════════════════════════╣
echo  ║  ⚠️  لا تغلق هذه النافذة اثناء عمل البوت!            ║  
echo  ╚══════════════════════════════════════════════════════╝
echo.

:: Open browser automatically
start "" "http://localhost:%PORT%"

:: Start server
"%VENV%\Scripts\python" "%SCRIPT_DIR%server.py"

echo.
echo  ════════════════════════════════════
echo   تم إيقاف الخادم
echo  ════════════════════════════════════
pause
