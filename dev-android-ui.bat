@echo off
setlocal EnableExtensions
cd /d "%~dp0"

rem Android layout preview on Windows: Tauri desktop + phone window + ?mobile=1.
rem Uses the same userData as the Windows app, so installed plugins show up.
rem Does not build an APK. Does not change the Windows installer window size.

set "PORT=47321"
set "CONFIG=%~dp0src-tauri\tauri.mobile-preview.conf.json"
set "ATTACH=%~dp0src-tauri\tauri.mobile-preview.attach.conf.json"

where pnpm >nul 2>&1
if errorlevel 1 (
    echo pnpm not found. Install pnpm first.
    exit /b 1
)

set "SKIP_VITE="
powershell -NoProfile -Command "try { (Invoke-WebRequest -UseBasicParsing -TimeoutSec 1 http://127.0.0.1:%PORT%/mainWindow.html).StatusCode | Out-Null; exit 0 } catch { exit 1 }" >nul 2>&1
if not errorlevel 1 set "SKIP_VITE=1"

echo Starting Tauri Android layout preview:
echo   window 390x844  url /mainWindow.html?mobile=1
echo   plugins from this machine's Free Music Online userData
echo.

if defined SKIP_VITE (
    echo Vite already on port %PORT%, attaching Tauri webview.
    pnpm tauri dev --config "%CONFIG%" --config "%ATTACH%" --no-dev-server-wait
) else (
    pnpm tauri dev --config "%CONFIG%"
)
exit /b %ERRORLEVEL%
