@echo off
chcp 65001 >nul
cd /d "%~dp0"
if exist "%~dp0installer\install.ps1" goto run
echo.
echo Архив не распакован: рядом с INSTALL.bat нет папки installer.
echo Закройте это окно, нажмите на скачанный архив правой кнопкой мыши,
echo выберите "Извлечь все", откройте распакованную папку и запустите INSTALL.bat оттуда.
echo.
pause
exit /b 1
:run
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0installer\install.ps1"
echo.
pause
