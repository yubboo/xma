@echo off
setlocal EnableExtensions
set "CALLER_CWD=%CD%"
cd /d "%~dp0"
set "SCRIPT=%~dp0scripts\windows\xma-console.ps1"
if not exist "%SCRIPT%" (
  echo [ERROR] scripts\windows\xma-console.ps1 not found.
  if "%~1"=="" pause
  exit /b 1
)

if /I "%~1"=="cli" (
  if "%~2"=="" (
    powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT%" cli "%CALLER_CWD%"
  ) else (
    powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT%" %*
  )
) else (
  powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT%" %*
)
set "RC=%ERRORLEVEL%"

if not "%~1"=="" exit /b %RC%

echo.
if "%RC%"=="0" (
  echo [OK] XMA Development Console finished.
) else (
  echo [ERROR] XMA Development Console exited with code %RC%.
)
echo This window will stay open so you can review the result.
echo.
pause
exit /b %RC%
