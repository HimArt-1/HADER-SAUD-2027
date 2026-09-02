@echo off
chcp 65001 > nul 2>&1
setlocal enabledelayedexpansion
title نظام حاضر - Hader System

:: ╔══════════════════════════════════════════════════════════════════════════════╗
:: ║                         🎓 نظام حاضر - HADER System                          ║
:: ║                         Windows Application Launcher                          ║
:: ╚══════════════════════════════════════════════════════════════════════════════╝
:: انقر مرتين على هذا الملف لتشغيل النظام
:: Double-click this file to launch the system

:: Navigate to script directory
cd /d "%~dp0"

:: Colors (using PowerShell for colored output)
set "GREEN=[92m"
set "RED=[91m"
set "YELLOW=[93m"
set "CYAN=[96m"
set "WHITE=[97m"
set "MAGENTA=[95m"
set "NC=[0m"

cls
echo.
echo %CYAN%╔══════════════════════════════════════════════════════════════════╗%NC%
echo %CYAN%║%NC%                                                                  %CYAN%║%NC%
echo %CYAN%║%NC%   %WHITE%🎓  نـظـام حـاضـر  -  HADER System%NC%                          %CYAN%║%NC%
echo %CYAN%║%NC%   %GREEN%نظام إدارة الحضور والانصراف المدرسي%NC%                          %CYAN%║%NC%
echo %CYAN%║%NC%                                                                  %CYAN%║%NC%
echo %CYAN%╚══════════════════════════════════════════════════════════════════╝%NC%
echo.

:: Check dependencies
echo %MAGENTA%━━━ فحص المتطلبات ━━━%NC%
echo.

:: Check Node.js
where node >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo %RED%[✗]%NC% Node.js غير مثبت!
    echo.
    echo الرجاء تثبيت Node.js من:
    echo %CYAN%https://nodejs.org/%NC%
    echo.
    pause
    exit /b 1
)

for /f "tokens=*" %%i in ('node --version') do set NODE_VER=%%i
echo %GREEN%[✓]%NC% Node.js: %NODE_VER%

:: Check npm
for /f "tokens=*" %%i in ('npm --version') do set NPM_VER=%%i
echo %GREEN%[✓]%NC% npm: v%NPM_VER%

:: Check Python
set HAS_PYTHON=0
where python >nul 2>&1
if %ERRORLEVEL% equ 0 (
    for /f "tokens=*" %%i in ('python --version 2^>^&1') do set PY_VER=%%i
    echo %GREEN%[✓]%NC% Python: !PY_VER!
    set HAS_PYTHON=1
) else (
    echo %YELLOW%[!]%NC% Python غير مثبت (مطلوب لخادم الواتساب)
)

echo.

:: Check/Create .env file
if not exist ".env" (
    echo %YELLOW%[!]%NC% ملف .env غير موجود - جاري إنشاؤه...
    if exist ".env.example" (
        copy ".env.example" ".env" > nul
        echo %GREEN%[✓]%NC% تم إنشاء .env
        echo %YELLOW%[!]%NC% تذكر: عدّل ملف .env وأضف بيانات Supabase
    )
) else (
    echo %GREEN%[✓]%NC% ملف .env موجود
)

:: Install dependencies if needed
if not exist "node_modules" (
    echo.
    echo %CYAN%[i]%NC% جاري تثبيت المكتبات (أول مرة فقط)...
    call npm install
    echo.
)

:: Menu
:menu
echo.
echo %MAGENTA%━━━ قائمة التشغيل ━━━%NC%
echo.
echo   %WHITE%1)%NC% 🚀 تشغيل سريع (الواجهة فقط)
echo   %WHITE%2)%NC% 📱 تشغيل مع الواتساب (النظام الكامل)
echo   %WHITE%3)%NC% 🔧 تشغيل خادم الواتساب فقط
echo   %WHITE%4)%NC% 📦 بناء نسخة الإنتاج
echo   %WHITE%5)%NC% 🔄 تحديث المكتبات
echo   %WHITE%6)%NC% ❌ خروج
echo.
set /p choice="اختر رقم (1-6): "

if "%choice%"=="1" goto frontend
if "%choice%"=="2" goto fullsystem
if "%choice%"=="3" goto whatsapp
if "%choice%"=="4" goto build
if "%choice%"=="5" goto update
if "%choice%"=="6" goto exit
goto menu

:frontend
echo.
echo %CYAN%[i]%NC% جاري تشغيل الواجهة...
echo.
echo %GREEN%╔════════════════════════════════════════════════════╗%NC%
echo %GREEN%║%NC%  🌐 افتح المتصفح على: %CYAN%http://localhost:5173%NC%      %GREEN%║%NC%
echo %GREEN%║%NC%  📝 للإيقاف: اضغط %WHITE%Ctrl+C%NC%                         %GREEN%║%NC%
echo %GREEN%╚════════════════════════════════════════════════════╝%NC%
echo.

:: Auto-open browser after 3 seconds
start "" cmd /c "timeout /t 3 >nul && start http://localhost:5173"

call npm run dev
goto end

:fullsystem
if %HAS_PYTHON%==0 (
    echo %RED%[✗]%NC% Python مطلوب لتشغيل خادم الواتساب
    pause
    goto menu
)

echo.
echo %CYAN%[i]%NC% جاري تشغيل النظام الكامل...

:: Setup Python venv if needed
if not exist "whatsapp\venv" (
    echo %CYAN%[i]%NC% إنشاء بيئة Python...
    cd whatsapp
    python -m venv venv
    call venv\Scripts\activate.bat
    pip install -r requirements.txt
    cd ..
)

echo.
echo %GREEN%╔════════════════════════════════════════════════════╗%NC%
echo %GREEN%║%NC%  🌐 الواجهة: %CYAN%http://localhost:5173%NC%               %GREEN%║%NC%
echo %GREEN%║%NC%  📱 الواتساب: %CYAN%http://localhost:5001%NC%              %GREEN%║%NC%
echo %GREEN%║%NC%  📝 للإيقاف: أغلق النوافذ أو اضغط %WHITE%Ctrl+C%NC%          %GREEN%║%NC%
echo %GREEN%╚════════════════════════════════════════════════════╝%NC%
echo.

:: Start WhatsApp server in new window
start "Hader WhatsApp Server" cmd /k "cd /d "%~dp0whatsapp" && call venv\Scripts\activate.bat && python server.py"

:: Wait a bit then open browser
timeout /t 3 >nul
start http://localhost:5173

:: Start frontend
call npm run dev
goto end

:whatsapp
if %HAS_PYTHON%==0 (
    echo %RED%[✗]%NC% Python مطلوب
    pause
    goto menu
)

echo.
echo %CYAN%[i]%NC% جاري تشغيل خادم الواتساب...

if not exist "whatsapp\venv" (
    cd whatsapp
    python -m venv venv
    call venv\Scripts\activate.bat
    pip install -r requirements.txt
) else (
    cd whatsapp
    call venv\Scripts\activate.bat
)

echo.
echo %GREEN%╔════════════════════════════════════════════════════╗%NC%
echo %GREEN%║%NC%  📱 الخادم: %CYAN%http://localhost:5001%NC%                 %GREEN%║%NC%
echo %GREEN%╚════════════════════════════════════════════════════╝%NC%
echo.

python server.py
cd ..
goto end

:build
echo.
echo %CYAN%[i]%NC% جاري بناء نسخة الإنتاج...
call npm run build
echo.
echo %GREEN%[✓]%NC% تم البناء بنجاح!
echo %CYAN%[i]%NC% الملفات في مجلد: dist/
echo.
pause
goto menu

:update
echo.
echo %CYAN%[i]%NC% جاري تحديث المكتبات...
call npm install

if %HAS_PYTHON%==1 (
    if exist "whatsapp\venv" (
        cd whatsapp
        call venv\Scripts\activate.bat
        pip install -r requirements.txt --upgrade
        cd ..
    )
)

echo %GREEN%[✓]%NC% تم التحديث بنجاح!
echo.
pause
goto menu

:exit
echo.
echo %CYAN%[i]%NC% إلى اللقاء! 👋
timeout /t 2 >nul
exit /b 0

:end
