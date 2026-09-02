@echo off
chcp 65001 > nul
setlocal enabledelayedexpansion

echo ==========================================
echo     نظام حاضر - Hader System
echo ==========================================
echo.

REM Check if Node.js is installed
where node >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo [خطأ] Node.js غير مثبت
    echo الرجاء تثبيت Node.js من: https://nodejs.org/
    pause
    exit /b 1
)

REM Check if Python is installed
where python >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo [خطأ] Python غير مثبت
    echo الرجاء تثبيت Python من: https://python.org/
    pause
    exit /b 1
)

for /f "tokens=*" %%i in ('node --version') do set NODE_VER=%%i
for /f "tokens=*" %%i in ('python --version') do set PY_VER=%%i

echo [OK] Node.js: %NODE_VER%
echo [OK] Python: %PY_VER%
echo.

REM Check for .env file
if not exist ".env" (
    echo [تنبيه] ملف .env غير موجود
    echo جاري إنشاء نسخة من .env.example...
    copy .env.example .env > nul
    echo [مهم] الرجاء تعديل ملف .env وإضافة بيانات Supabase
)

REM Install Node.js dependencies if needed
if not exist "node_modules" (
    echo [جاري] تثبيت مكتبات Node.js...
    call npm install
)

REM Setup Python virtual environment
if not exist "whatsapp\venv" (
    echo [جاري] إنشاء بيئة Python...
    cd whatsapp
    python -m venv venv
    call venv\Scripts\activate.bat
    pip install -r requirements.txt
    cd ..
)

echo.
echo ==========================================
echo     اختر وضع التشغيل - Select Mode
echo ==========================================
echo 1) تشغيل الواجهة فقط (Frontend Only)
echo 2) تشغيل خادم الواتساب فقط (WhatsApp Server Only)
echo 3) تشغيل الكل (Full System)
echo 4) بناء للإنتاج (Build for Production)
echo.

set /p choice="اختر (1-4): "

if "%choice%"=="1" (
    echo [جاري] تشغيل الواجهة...
    echo افتح المتصفح على: http://localhost:5173
    call npm run dev
) else if "%choice%"=="2" (
    echo [جاري] تشغيل خادم الواتساب...
    echo الخادم يعمل على: http://localhost:5050
    cd whatsapp
    call venv\Scripts\activate.bat
    python server.py
) else if "%choice%"=="3" (
    echo [جاري] تشغيل النظام الكامل...
    echo.
    echo الواجهة: http://localhost:5173
    echo خادم الواتساب: http://localhost:5050
    echo.

    REM Start WhatsApp server in new window
    start "WhatsApp Server" cmd /k "cd whatsapp && venv\Scripts\activate.bat && python server.py"

    REM Start frontend
    timeout /t 3 > nul
    call npm run dev
) else if "%choice%"=="4" (
    echo [جاري] بناء للإنتاج...
    call npm run build
    echo [OK] تم البناء بنجاح
    echo ملفات الإنتاج في مجلد: dist/
    pause
) else (
    echo اختيار غير صحيح
    pause
    exit /b 1
)
