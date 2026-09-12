@echo off
setlocal EnableExtensions
cd /d "%~dp0"
set "SCRIPT=%~dp0scripts\windows\xma-sync.ps1"
if not exist "%SCRIPT%" (
  echo [ERROR] scripts\windows\xma-sync.ps1 not found.
  pause
  exit /b 1
)
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT%"
set "RC=%ERRORLEVEL%"
echo.
if "%RC%"=="0" (
  echo [OK] XMA source sync finished successfully.
) else (
  echo [ERROR] XMA source sync exited with code %RC%.
)
echo This window will stay open so you can review the result.
echo.
pause
exit /b %RC%
