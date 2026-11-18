param(
    [switch]$Prepare,
    [switch]$SignOutputs
)

$ErrorActionPreference = "Stop"

if (-not $Prepare -and -not $SignOutputs) {
    $Prepare = $true
    $SignOutputs = $true
}

$root = Split-Path -Parent $PSScriptRoot
$android = Join-Path $root "src-tauri\gen\android"
$appGradle = Join-Path $android "app\build.gradle.kts"
$keystoreDir = Join-Path $env:USERPROFILE ".anhe-player"
$keystore = Join-Path $keystoreDir "sideload.p12"
$passFile = Join-Path $keystoreDir "sideload.pass"
$propsFile = Join-Path $android "keystore.properties"
$aliasName = "upload"

function Get-JavaHome {
    if ($env:JAVA_HOME -and (Test-Path (Join-Path $env:JAVA_HOME "bin\keytool.exe"))) {
        return $env:JAVA_HOME
    }
    $candidates = @(
        "D:\KU\WEB\JAVA\jdk-21.0.8",
        "$env:ProgramFiles\Android\Android Studio\jbr",
        "$env:LOCALAPPDATA\Programs\Android Studio\jbr"
    )
    foreach ($candidate in $candidates) {
        if (Test-Path (Join-Path $candidate "bin\keytool.exe")) {
            return $candidate
        }
    }
    return $null
}

function Get-SdkHome {
    if ($env:ANDROID_HOME -and (Test-Path $env:ANDROID_HOME)) {
        return $env:ANDROID_HOME
    }
    if (Test-Path "$env:LOCALAPPDATA\Android\Sdk") {
        return "$env:LOCALAPPDATA\Android\Sdk"
    }
    if (Test-Path "F:\Android\Sdk") {
        return "F:\Android\Sdk"
    }
    return $null
}

function Get-BuildToolsDir([string]$sdk) {
    $tools = Join-Path $sdk "build-tools"
    if (-not (Test-Path $tools)) {
        return $null
    }
    return Get-ChildItem $tools -Directory | Sort-Object Name -Descending | Select-Object -First 1 -ExpandProperty FullName
}

function Get-OrCreatePassword {
    if (Test-Path $passFile) {
        return (Get-Content -Raw $passFile).Trim()
    }
    New-Item -ItemType Directory -Force -Path $keystoreDir | Out-Null
    $bytes = New-Object byte[] 18
    [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    $password = [Convert]::ToBase64String($bytes) -replace "[^A-Za-z0-9]", "A"
    Set-Content -Path $passFile -Value $password -NoNewline
    return $password
}

function Ensure-Keystore {
    $javaHome = Get-JavaHome
    if (-not $javaHome) {
        throw "keytool was not found. Set JAVA_HOME to a JDK."
    }
    $password = Get-OrCreatePassword
    if (-not (Test-Path $keystore)) {
        Write-Host "Creating sideload keystore: $keystore"
        $keytool = Join-Path $javaHome "bin\keytool.exe"
        $dname = "CN=Free Music Online, OU=Sideload, O=AnhePlayer, L=Local, ST=NA, C=CN"
        & $keytool -genkeypair -keystore $keystore -storetype PKCS12 -keyalg RSA -keysize 2048 -validity 10000 -alias $aliasName -storepass $password -keypass $password -dname $dname
        if ($LASTEXITCODE -ne 0) {
            throw "keytool failed to create the sideload keystore"
        }
    }
    return $password
}

function Write-KeystoreProperties([string]$password) {
    if (-not (Test-Path $android)) {
        return
    }
    $storePath = $keystore.Replace("\", "\\")
    @"
password=$password
keyAlias=$aliasName
storeFile=$storePath
"@ | Set-Content -Path $propsFile -Encoding ascii
}

function Patch-AppGradle {
    if (-not (Test-Path $appGradle)) {
        return
    }
    $text = Get-Content -Raw $appGradle
    if ($text -match "anhe-android-signing") {
        return
    }

    if ($text -notmatch "import java.io.FileInputStream") {
        $text = $text -replace "import java.util.Properties", "import java.io.FileInputStream`r`nimport java.util.Properties"
    }

    $signingBlock = @"
    // anhe-android-signing
    signingConfigs {
        create("release") {
            val keystorePropertiesFile = rootProject.file("keystore.properties")
            val keystoreProperties = Properties()
            if (keystorePropertiesFile.exists()) {
                keystoreProperties.load(FileInputStream(keystorePropertiesFile))
                keyAlias = keystoreProperties["keyAlias"] as String
                keyPassword = keystoreProperties["password"] as String
                storeFile = file(keystoreProperties["storeFile"] as String)
                storePassword = keystoreProperties["password"] as String
            }
        }
    }
"@
    if ($text -notmatch "signingConfigs\s*\{") {
        $text = $text -replace "(?m)^    buildTypes \{", ($signingBlock + "`r`n    buildTypes {")
    }

    if ($text -notmatch 'getByName\("release"\)[\s\S]*signingConfig') {
        $text = $text -replace '(?m)^        getByName\("release"\) \{', @"
        getByName("release") {
            val releaseSigning = signingConfigs.findByName("release")
            if (releaseSigning?.storeFile != null) {
                signingConfig = releaseSigning
            }
"@
    }

    Set-Content -Path $appGradle -Value $text -NoNewline
    Write-Host "Patched app/build.gradle.kts for release signing"
}

function Sign-UnsignedApks([string]$password) {
    $sdk = Get-SdkHome
    $buildTools = Get-BuildToolsDir $sdk
    if (-not $buildTools) {
        throw "Android SDK build-tools were not found under $sdk"
    }
    $zipalign = Join-Path $buildTools "zipalign.exe"
    $apksigner = Join-Path $buildTools "apksigner.bat"
    $apkRoot = Join-Path $android "app\build\outputs\apk"
    if (-not (Test-Path $apkRoot)) {
        return
    }

    $unsigned = Get-ChildItem $apkRoot -Recurse -Filter "*-unsigned.apk"
    foreach ($apk in $unsigned) {
        $alignedName = ($apk.BaseName -replace "-unsigned$", "-aligned") + ".apk"
        $signedName = ($apk.BaseName -replace "-unsigned$", "") + ".apk"
        $aligned = Join-Path $apk.DirectoryName $alignedName
        $signed = Join-Path $apk.DirectoryName $signedName
        if (Test-Path $aligned) {
            Remove-Item $aligned -Force
        }
        Write-Host "zipalign $($apk.Name)"
        & $zipalign -p -f 4 $apk.FullName $aligned
        if ($LASTEXITCODE -ne 0) {
            throw "zipalign failed for $($apk.FullName)"
        }
        if (Test-Path $signed) {
            Remove-Item $signed -Force
        }
        Write-Host "apksigner $($apk.Name) -> $(Split-Path $signed -Leaf)"
        & $apksigner sign --ks $keystore --ks-key-alias $aliasName --ks-pass "pass:$password" --key-pass "pass:$password" --v1-signing-enabled true --v2-signing-enabled true --v3-signing-enabled true --out $signed $aligned
        if ($LASTEXITCODE -ne 0) {
            throw "apksigner failed for $($apk.FullName)"
        }
        & $apksigner verify --verbose $signed
        Remove-Item $aligned -Force -ErrorAction SilentlyContinue
        Write-Host "Signed APK: $signed"
    }
}

if ($Prepare) {
    $password = Ensure-Keystore
    Write-KeystoreProperties $password
    Patch-AppGradle
    Write-Host "Sideload signing is ready."
}

if ($SignOutputs) {
    $password = Get-OrCreatePassword
    if (-not (Test-Path $keystore)) {
        $password = Ensure-Keystore
    }
    Sign-UnsignedApks $password
}
