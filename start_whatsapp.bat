@echo off
SETLOCAL EnableDelayedExpansion

:: Get the directory where the script is located
SET "PROJECT_ROOT=%~dp0"
CD /D "%PROJECT_ROOT%"

:: Check if venv exists (Windows path standard is Scripts\python.exe)
IF EXIST "whatsapp\venv\Scripts\python.exe" (
    SET "PYTHON_EXEC=whatsapp\venv\Scripts\python.exe"
    echo 🟢 Using existing virtual environment...
) ELSE (
    echo 🔴 Virtual environment not found at whatsapp\venv\Scripts\python.exe
    echo Please ensure you have created the virtual environment correctly.
    echo Try running: python -m venv whatsapp\venv
    PAUSE
    EXIT /B 1
)

:: Run the server
echo 🚀 Starting WhatsApp Server...
"%PYTHON_EXEC%" "whatsapp\server.py"

PAUSE
