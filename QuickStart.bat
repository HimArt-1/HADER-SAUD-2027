@echo off
chcp 65001 > nul 2>&1
title نظام حاضر - Quick Start
cd /d "%~dp0"

:: ╔══════════════════════════════════════════════════════════════════╗
:: ║  🚀 نظام حاضر - تشغيل سريع | Hader Quick Start (Windows)        ║
:: ╚══════════════════════════════════════════════════════════════════╝

echo.
echo 🎓 نظام حاضر - جاري التشغيل...
echo.

:: Check Node.js
where node >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo ❌ Node.js غير مثبت!
    echo الرجاء تثبيته من: https://nodejs.org/
    pause
    exit /b 1
)

:: Create .env if missing
if not exist ".env" (
    if exist ".env.example" copy ".env.example" ".env" > nul
)

:: Install dependencies if needed
if not exist "node_modules" call npm install

echo ╔════════════════════════════════════════════════════╗
echo ║  🌐 الرابط: http://localhost:5173                  ║
echo ║  📝 للإيقاف: Ctrl+C أو أغلق النافذة                ║
echo ╚════════════════════════════════════════════════════╝
echo.

:: Open browser after 3 seconds
start "" cmd /c "timeout /t 3 >nul && start http://localhost:5173"

:: Start the app
call npm run dev
