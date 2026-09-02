@echo off
chcp 65001 >nul 2>&1
title whattONE — مُثبّت ويندوز
color 0A
cd /d "%~dp0"
set SCRIPT_DIR=%~dp0

echo.
echo  ╔══════════════════════════════════════════════════════╗
echo  ║  🟢  whattONE v2.0 — مُثبّت التطبيق لويندوز        ║
echo  ╠══════════════════════════════════════════════════════╣
echo  ║  سيتم إنشاء:                                        ║
echo  ║  • اختصار على سطح المكتب                             ║
echo  ║  • اختصار في قائمة ابدأ                              ║
echo  ║  • تثبيت المتطلبات تلقائياً                          ║
echo  ╚══════════════════════════════════════════════════════╝
echo.

:: ═══════════════════════════════════════
:: 1) Check Python
:: ═══════════════════════════════════════
echo  [1/5] 🔍 فحص Python...
python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo.
    echo  ❌ Python غير مثبت!
    echo.
    echo  📥 سيتم فتح صفحة تحميل Python...
    start "" "https://www.python.org/downloads/"
    echo.
    echo  ⚠️  بعد التثبيت، تأكد من تفعيل "Add Python to PATH"
    echo  ⚠️  ثم أعد تشغيل هذا الملف
    echo.
    pause
    exit /b 1
)
for /f "tokens=2" %%v in ('python --version 2^>^&1') do echo        ✅ Python %%v

:: ═══════════════════════════════════════
:: 2) Check Chrome
:: ═══════════════════════════════════════
echo  [2/5] 🔍 فحص Google Chrome...
if exist "C:\Program Files\Google\Chrome\Application\chrome.exe" (
    echo        ✅ Chrome متوفر
) else if exist "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe" (
    echo        ✅ Chrome متوفر
) else (
    echo        ⚠️  Chrome غير متوفر
    echo        📥 سيتم فتح صفحة تحميل Chrome...
    start "" "https://www.google.com/chrome/"
    echo        ⚠️  ثبّت Chrome ثم أكمل التثبيت
    pause
)

:: ═══════════════════════════════════════
:: 3) Setup venv
:: ═══════════════════════════════════════
echo  [3/5] 📦 تجهيز البيئة الافتراضية...
set VENV=%SCRIPT_DIR%venv

if not exist "%VENV%" (
    echo        📦 إنشاء البيئة الافتراضية...
    python -m venv "%VENV%"
    if %errorlevel% neq 0 (
        echo  ❌ فشل إنشاء البيئة
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
:: 4) Generate icon if needed
:: ═══════════════════════════════════════
echo  [4/5] 🎨 تجهيز الأيقونة...
if not exist "%SCRIPT_DIR%whattone.ico" (
    "%VENV%\Scripts\python" "%SCRIPT_DIR%generate_icon.py"
    echo        ✅ تم إنشاء الأيقونة
) else (
    echo        ✅ الأيقونة جاهزة
)

:: ═══════════════════════════════════════
:: 5) Create shortcuts
:: ═══════════════════════════════════════
echo  [5/5] 📌 إنشاء الاختصارات...

:: Desktop shortcut
set VBS_FILE=%TEMP%\whattone_shortcut.vbs
echo Set oWS = WScript.CreateObject("WScript.Shell") > "%VBS_FILE%"
echo sDesktop = oWS.SpecialFolders("Desktop") >> "%VBS_FILE%"
echo Set oLink = oWS.CreateShortcut(sDesktop ^& "\whattONE.lnk") >> "%VBS_FILE%"
echo oLink.TargetPath = "%SCRIPT_DIR%start.bat" >> "%VBS_FILE%"
echo oLink.WorkingDirectory = "%SCRIPT_DIR%" >> "%VBS_FILE%"
echo oLink.Description = "whattONE v2 - أداة واتساب المتقدمة" >> "%VBS_FILE%"
echo oLink.WindowStyle = 1 >> "%VBS_FILE%"
if exist "%SCRIPT_DIR%whattone.ico" (
    echo oLink.IconLocation = "%SCRIPT_DIR%whattone.ico" >> "%VBS_FILE%"
)
echo oLink.Save >> "%VBS_FILE%"

:: Start Menu shortcut
echo Set oLink2 = oWS.CreateShortcut(oWS.SpecialFolders("StartMenu") ^& "\whattONE.lnk") >> "%VBS_FILE%"
echo oLink2.TargetPath = "%SCRIPT_DIR%start.bat" >> "%VBS_FILE%"
echo oLink2.WorkingDirectory = "%SCRIPT_DIR%" >> "%VBS_FILE%"
echo oLink2.Description = "whattONE v2 - أداة واتساب المتقدمة" >> "%VBS_FILE%"
echo oLink2.WindowStyle = 1 >> "%VBS_FILE%"
if exist "%SCRIPT_DIR%whattone.ico" (
    echo oLink2.IconLocation = "%SCRIPT_DIR%whattone.ico" >> "%VBS_FILE%"
)
echo oLink2.Save >> "%VBS_FILE%"

cscript //nologo "%VBS_FILE%"
del "%VBS_FILE%" >nul 2>&1

echo        ✅ اختصار سطح المكتب
echo        ✅ اختصار قائمة ابدأ

echo.
echo  ╔══════════════════════════════════════════════════════╗
echo  ║  ✅ تم التثبيت بنجاح!                                ║
echo  ╠══════════════════════════════════════════════════════╣
echo  ║                                                      ║
echo  ║  📍 تم إنشاء:                                        ║
echo  ║     🖥️  اختصار على سطح المكتب                        ║
echo  ║     📋  اختصار في قائمة ابدأ                          ║
echo  ║                                                      ║
echo  ║  🖱️  انقر مرتين على أيقونة whattONE لتشغيل البرنامج ║
echo  ║  🌐  Dashboard: http://localhost:5005                 ║
echo  ║                                                      ║
echo  ╚══════════════════════════════════════════════════════╝
echo.
echo  هل تريد تشغيل whattONE الآن؟
set /p LAUNCH="  (y/n): "
if /i "%LAUNCH%"=="y" (
    start "" "%SCRIPT_DIR%start.bat"
)
echo.
pause
