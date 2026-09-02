@echo off
chcp 65001 >nul 2>&1
title whattONE — إنشاء اختصار سطح المكتب
color 0A

echo.
echo  ╔══════════════════════════════════════════╗
echo  ║  🟢 إنشاء اختصار whattONE على سطح المكتب ║
echo  ╚══════════════════════════════════════════╝
echo.

set SCRIPT_DIR=%~dp0
set SHORTCUT_NAME=whattONE
set DESKTOP=%USERPROFILE%\Desktop

:: Create VBScript to make shortcut
set VBS_FILE=%TEMP%\create_shortcut.vbs

echo Set oWS = WScript.CreateObject("WScript.Shell") > "%VBS_FILE%"
echo sLinkFile = "%DESKTOP%\%SHORTCUT_NAME%.lnk" >> "%VBS_FILE%"
echo Set oLink = oWS.CreateShortcut(sLinkFile) >> "%VBS_FILE%"
echo oLink.TargetPath = "%SCRIPT_DIR%start.bat" >> "%VBS_FILE%"
echo oLink.WorkingDirectory = "%SCRIPT_DIR%" >> "%VBS_FILE%"
echo oLink.Description = "whattONE v2 - أداة واتساب المتقدمة" >> "%VBS_FILE%"
echo oLink.WindowStyle = 1 >> "%VBS_FILE%"

:: Use icon if exists, otherwise use default
if exist "%SCRIPT_DIR%whattone.ico" (
    echo oLink.IconLocation = "%SCRIPT_DIR%whattone.ico" >> "%VBS_FILE%"
) else (
    echo oLink.IconLocation = "shell32.dll,13" >> "%VBS_FILE%"
)

echo oLink.Save >> "%VBS_FILE%"

cscript //nologo "%VBS_FILE%"
del "%VBS_FILE%" >nul 2>&1

if exist "%DESKTOP%\%SHORTCUT_NAME%.lnk" (
    echo  ✅ تم إنشاء الاختصار على سطح المكتب بنجاح!
    echo.
    echo  📌 ستجد أيقونة "whattONE" على سطح المكتب
    echo  🖱️  انقر مرتين على الأيقونة لتشغيل الأداة
) else (
    echo  ❌ فشل إنشاء الاختصار
)

echo.
pause
