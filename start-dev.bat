@echo off
setlocal
cd /d "%~dp0"

echo AnhePlayer development start
echo.

call :prepare
if errorlevel 1 goto :failed

echo.
echo Starting the desktop app. The first launch compiles Rust and can take several minutes.
echo Close this window to stop the app.
echo.

call %PNPM% tauri:dev
if errorlevel 1 goto :failed
exit /b 0

:prepare
set "PATH=%USERPROFILE%\.cargo\bin;%PATH%"

where node >nul 2>&1
if errorlevel 1 (
    echo Node.js was not found. Install Node.js 22 and reopen this window.
    exit /b 1
)

where cargo >nul 2>&1
if errorlevel 1 (
    echo Rust was not found. Install rustup, then reopen this window.
    echo Expected cargo at %USERPROFILE%\.cargo\bin\cargo.exe
    exit /b 1
)

set "PNPM=pnpm"
where pnpm >nul 2>&1
if not errorlevel 1 goto :pnpm_ready
echo pnpm is not on PATH. This window will call it through corepack.
if not exist "%TEMP%\anhe-player-pnpm" mkdir "%TEMP%\anhe-player-pnpm"
echo @echo off> "%TEMP%\anhe-player-pnpm\pnpm.cmd"
echo corepack pnpm %%*>> "%TEMP%\anhe-player-pnpm\pnpm.cmd"
set "PATH=%TEMP%\anhe-player-pnpm;%PATH%"
:pnpm_ready

if not exist "node_modules\" (
    echo Installing dependencies...
    call %PNPM% install
    if errorlevel 1 exit /b 1
)
exit /b 0

:failed
echo.
echo Start failed. See the messages above.
pause
exit /b 1
