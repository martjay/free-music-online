@echo off
setlocal EnableExtensions
cd /d "%~dp0"

echo Free Music Online Android build
echo.

set "MODE=apk"
set "TARGETS=aarch64"
if /I "%~1"=="aab" (
    set "MODE=aab"
    set "TARGETS=aarch64"
)
if /I "%~1"=="all" (
    set "MODE=apk"
    set "TARGETS="
)

call :prepare
if errorlevel 1 goto :failed
call :android_env
if errorlevel 1 goto :failed
call :rust_android_targets
if errorlevel 1 goto :failed

if not exist "src-tauri\gen\android\" (
    echo.
    echo First Android build: generating src-tauri\gen\android
    echo.
    call %PNPM% tauri android init --ci --skip-targets-install
    if errorlevel 1 goto :failed
)

call :gradle_net
if errorlevel 1 goto :failed
call :android_sign_prepare
if errorlevel 1 goto :failed
call :android_icons
if errorlevel 1 goto :failed

echo.
if /I "%MODE%"=="aab" (
    echo Building a signed-ready Android App Bundle for phones ^(arm64^).
    echo This compiles Rust for Android in release mode.
    echo.
    call %PNPM% tauri android build --aab --target aarch64 --ci
) else if "%TARGETS%"=="" (
    echo Building a universal Android APK for all ABIs.
    echo This compiles Rust for Android in release mode and takes longer.
    echo.
    call %PNPM% tauri android build --apk --ci
) else (
    echo Building an Android APK for phones ^(arm64^).
    echo This compiles Rust for Android in release mode.
    echo.
    call %PNPM% tauri android build --apk --target aarch64 --ci
)
if errorlevel 1 goto :failed
call :android_sign_outputs
if errorlevel 1 goto :failed

echo.
echo Build finished. Packages are under:
echo   src-tauri\gen\android\app\build\outputs\apk
echo   src-tauri\gen\android\app\build\outputs\bundle
echo.
if exist "src-tauri\gen\android\app\build\outputs\apk" (
    dir /s /b "src-tauri\gen\android\app\build\outputs\apk\*.apk" 2>nul
)
if exist "src-tauri\gen\android\app\build\outputs\bundle" (
    dir /s /b "src-tauri\gen\android\app\build\outputs\bundle\*.aab" 2>nul
)
echo.
echo Sideload the arm64 APK onto a phone. Google Play uploads need an AAB:
echo   build-apk.bat aab
echo Install the signed APK (not *-unsigned.apk). Vivo/OPPO reject unsigned packages.
echo The sideload keystore is %USERPROFILE%\.anhe-player\sideload.p12 — keep it to update the same app.
echo.
pause
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

:android_env
call :find_java
if not defined JAVA_HOME (
    echo JAVA_HOME was not found.
    echo Install Android Studio and reopen this window, or set JAVA_HOME
    echo to Android Studio's jbr folder, for example:
    echo   C:\Program Files\Android\Android Studio\jbr
    exit /b 1
)
if not exist "%JAVA_HOME%\bin\java.exe" (
    echo JAVA_HOME does not contain java.exe:
    echo   %JAVA_HOME%
    exit /b 1
)

if not defined ANDROID_HOME if exist "%LOCALAPPDATA%\Android\Sdk" set "ANDROID_HOME=%LOCALAPPDATA%\Android\Sdk"
if not defined ANDROID_HOME if exist "%USERPROFILE%\AppData\Local\Android\Sdk" set "ANDROID_HOME=%USERPROFILE%\AppData\Local\Android\Sdk"
if not defined ANDROID_HOME (
    echo ANDROID_HOME was not found.
    echo Install Android Studio, open SDK Manager, and install:
    echo   Android SDK Platform, Platform-Tools, Build-Tools,
    echo   Command-line Tools, and NDK ^(Side by side^).
    echo Then set ANDROID_HOME to the SDK folder, usually:
    echo   %LOCALAPPDATA%\Android\Sdk
    exit /b 1
)
if not exist "%ANDROID_HOME%\platform-tools" (
    echo Android SDK Platform-Tools were not found under:
    echo   %ANDROID_HOME%
    echo Open Android Studio SDK Manager and install Platform-Tools.
    exit /b 1
)

if not defined NDK_HOME call :find_ndk
if not defined NDK_HOME (
    echo NDK_HOME was not found.
    echo In Android Studio SDK Manager, install "NDK ^(Side by side^)".
    echo Then set NDK_HOME to a versioned folder, for example:
    echo   %ANDROID_HOME%\ndk\27.1.12297006
    exit /b 1
)
if not exist "%NDK_HOME%\toolchains\llvm\prebuilt\windows-x86_64\bin" (
    echo NDK_HOME does not look like an NDK install:
    echo   %NDK_HOME%
    echo Point it at the versioned folder inside Sdk\ndk, not Sdk\ndk itself.
    exit /b 1
)

echo JAVA_HOME=%JAVA_HOME%
echo ANDROID_HOME=%ANDROID_HOME%
echo NDK_HOME=%NDK_HOME%

set "ANDROID_NDK_HOME=%NDK_HOME%"
set "NDK_LLVM=%NDK_HOME%\toolchains\llvm\prebuilt\windows-x86_64\bin"
rem Do not put NDK clang on PATH or set CC/CXX globally. Host crates such as
rem vswhom-sys would then compile Windows code with the Android compiler.
set "CARGO_TARGET_AARCH64_LINUX_ANDROID_LINKER=%NDK_LLVM%\aarch64-linux-android24-clang.cmd"
set "CC_aarch64_linux_android=%NDK_LLVM%\aarch64-linux-android24-clang.cmd"
set "CXX_aarch64_linux_android=%NDK_LLVM%\aarch64-linux-android24-clang++.cmd"
set "AR_aarch64_linux_android=%NDK_LLVM%\llvm-ar.exe"
set "CARGO_TARGET_ARMV7_LINUX_ANDROIDEABI_LINKER=%NDK_LLVM%\armv7a-linux-androideabi24-clang.cmd"
set "CC_armv7_linux_androideabi=%NDK_LLVM%\armv7a-linux-androideabi24-clang.cmd"
set "CARGO_TARGET_I686_LINUX_ANDROID_LINKER=%NDK_LLVM%\i686-linux-android24-clang.cmd"
set "CC_i686_linux_android=%NDK_LLVM%\i686-linux-android24-clang.cmd"
set "CARGO_TARGET_X86_64_LINUX_ANDROID_LINKER=%NDK_LLVM%\x86_64-linux-android24-clang.cmd"
set "CC_x86_64_linux_android=%NDK_LLVM%\x86_64-linux-android24-clang.cmd"

call :check_developer_mode
exit /b 0

:find_java
if defined JAVA_HOME if exist "%JAVA_HOME%\bin\java.exe" exit /b 0
if exist "%ProgramFiles%\Android\Android Studio\jbr\bin\java.exe" (
    set "JAVA_HOME=%ProgramFiles%\Android\Android Studio\jbr"
    exit /b 0
)
if exist "%LOCALAPPDATA%\Programs\Android Studio\jbr\bin\java.exe" (
    set "JAVA_HOME=%LOCALAPPDATA%\Programs\Android Studio\jbr"
    exit /b 0
)
for /d %%J in ("%ProgramFiles%\Microsoft\jdk-17*") do (
    if exist "%%J\bin\java.exe" (
        set "JAVA_HOME=%%J"
        exit /b 0
    )
)
for /d %%J in ("%ProgramFiles%\Eclipse Adoptium\jdk-17*") do (
    if exist "%%J\bin\java.exe" (
        set "JAVA_HOME=%%J"
        exit /b 0
    )
)
exit /b 0

:find_ndk
if not exist "%ANDROID_HOME%\ndk" exit /b 0
set "NDK_HOME="
for /d %%N in ("%ANDROID_HOME%\ndk\*") do set "NDK_HOME=%%N"
exit /b 0

:rust_android_targets
where rustup >nul 2>&1
if errorlevel 1 (
    echo rustup was not found. Install Rust from https://rustup.rs and reopen this window.
    exit /b 1
)
echo Adding Rust Android targets if they are missing...
if "%TARGETS%"=="" (
    rustup target add aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android
) else (
    rustup target add aarch64-linux-android
)
if errorlevel 1 exit /b 1
exit /b 0

:gradle_net
if not exist "src-tauri\gen\android\gradle\wrapper\gradle-wrapper.properties" exit /b 0
echo Configuring Gradle download ^(China mirror + system proxy if present^)...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\android-gradle-net.ps1"
if exist "src-tauri\gen\android\.anhe-gradle-env.cmd" call "src-tauri\gen\android\.anhe-gradle-env.cmd"
exit /b 0

:android_icons
if not exist "src-tauri\gen\android\app\src\main\res\" exit /b 0
echo Copying app icons into the Android project...
xcopy /E /I /Y "src-tauri\icons\android\*" "src-tauri\gen\android\app\src\main\res\" >nul
if errorlevel 1 (
    echo Failed to copy Android launcher icons.
    exit /b 1
)
exit /b 0

:android_sign_prepare
echo Configuring a local sideload keystore for Android signing...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\android-sign.ps1" -Prepare
if errorlevel 1 exit /b 1
exit /b 0

:android_sign_outputs
echo Signing unsigned APKs...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\android-sign.ps1" -SignOutputs
if errorlevel 1 exit /b 1
exit /b 0

:check_developer_mode
reg query "HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\AppModelUnlock" /v AllowDevelopmentWithoutDevLicense >nul 2>&1
if errorlevel 1 goto :devmode_warn
for /f "tokens=3" %%V in ('reg query "HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\AppModelUnlock" /v AllowDevelopmentWithoutDevLicense 2^>nul') do set "DEVMODE=%%V"
if /I "%DEVMODE%"=="0x1" exit /b 0
:devmode_warn
echo.
echo Warning: Windows Developer Mode looks off. Tauri's Android build creates
echo a symlink to the Rust library and fails without it.
echo Turn on Settings ^> System ^> For developers ^> Developer Mode, then rerun.
echo.
exit /b 0

:failed
echo.
echo Android build failed. See the messages above.
pause
exit /b 1
