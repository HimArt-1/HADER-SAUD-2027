@echo off
REM =============================================================================
REM نظام حاضر - Desktop Development Mode
REM =============================================================================

cd /d "%~dp0"

echo 🚀 Starting Hader Desktop in Development Mode...
echo.

REM Check if node_modules exists
if not exist "node_modules\" (
    echo 📦 Installing dependencies...
    call npm install
)

echo 🖥️  Starting Electron + Vite...
echo.

call npm run electron:dev
