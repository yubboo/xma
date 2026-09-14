@echo off
setlocal EnableExtensions DisableDelayedExpansion
set "CALLER_CWD=%CD%"
set "ROOT=%~dp0"
set "SCRIPT=%ROOT%scripts\windows\xma-console.ps1"

if not exist "%SCRIPT%" (
  echo [ERROR] scripts\windows\xma-console.ps1 not found.
  if "%~1"=="" pause
  exit /b 1
)

pushd "%ROOT%" >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Cannot enter XMA source directory: "%ROOT%"
  if "%~1"=="" pause
  exit /b 1
)

if /I "%~1"=="cli" (
  if "%~2"=="" (
    powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT%" -Command cli -Workspace "%CALLER_CWD%"
  ) else (
    powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT%" -Command cli -Workspace "%~2"
  )
) else if "%~1"=="" (
  powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT%" -Command menu
) else (
  powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT%" -Command "%~1"
)
set "RC=%ERRORLEVEL%"
popd >nul 2>&1

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
