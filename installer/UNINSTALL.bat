@echo off
chcp 65001 >nul
cd /d "%~dp0"
if exist "%~dp0install.ps1" goto run
echo.
echo Архив не распакован: рядом с UNINSTALL.bat нет файла install.ps1.
echo Закройте это окно, распакуйте архив целиком (правая кнопка мыши, "Извлечь все")
echo и запустите installer\UNINSTALL.bat из распакованной папки.
echo.
pause
exit /b 1
:run
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1" -Uninstall
echo.
pause
