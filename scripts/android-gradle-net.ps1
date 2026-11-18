$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$android = Join-Path $root "src-tauri\gen\android"
$wrapper = Join-Path $android "gradle\wrapper\gradle-wrapper.properties"
$propsPath = Join-Path $android "gradle.properties"
$envCmd = Join-Path $android ".anhe-gradle-env.cmd"
$zipName = "gradle-9.6.1-bin.zip"
$huaweiUrl = "https://mirrors.huaweicloud.com/gradle/$zipName"
$officialUrl = "https://services.gradle.org/distributions/$zipName"

function Get-SystemProxyRaw {
    foreach ($name in @("HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy", "ALL_PROXY", "all_proxy")) {
        $value = [Environment]::GetEnvironmentVariable($name, "Process")
        if (-not $value) {
            $value = [Environment]::GetEnvironmentVariable($name, "User")
        }
        if ($value) {
            return $value
        }
    }

    try {
        $settings = Get-ItemProperty "HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings"
        if ($settings.ProxyEnable -eq 1 -and $settings.ProxyServer) {
            $server = [string]$settings.ProxyServer
            if ($server -match "(?i)https=([^;]+)") {
                return $Matches[1]
            }
            if ($server -match "(?i)http=([^;]+)") {
                return $Matches[1]
            }
            return $server
        }
    } catch {
    }

    return $null
}

function Parse-Proxy([string]$raw) {
    if ([string]::IsNullOrWhiteSpace($raw)) {
        return $null
    }

    $url = $raw.Trim()
    if ($url -notmatch "://") {
        $url = "http://$url"
    }

    $uri = [Uri]$url
    $port = $uri.Port
    if ($port -le 0) {
        $port = 80
    }

    return @{
        Url  = "http://$($uri.Host):$port"
        Host = $uri.Host
        Port = $port
    }
}

function Get-GradleDistHash([string]$url) {
    Add-Type -AssemblyName System.Numerics | Out-Null
    $md5 = [System.Security.Cryptography.MD5]::Create()
    try {
        $digest = $md5.ComputeHash([Text.Encoding]::UTF8.GetBytes($url))
    } finally {
        $md5.Dispose()
    }
    # Java BigInteger(1, md5) is unsigned big-endian; .NET 4.x is little-endian two's complement.
    $le = New-Object byte[] ($digest.Length + 1)
    for ($i = 0; $i -lt $digest.Length; $i++) {
        $le[$i] = $digest[$digest.Length - 1 - $i]
    }
    $value = [System.Numerics.BigInteger]::new($le)
    $chars = "0123456789abcdefghijklmnopqrstuvwxyz"
    if ($value -eq 0) {
        return "0"
    }
    $result = ""
    while ($value -gt 0) {
        $remainder = [System.Numerics.BigInteger]::Zero
        $value = [System.Numerics.BigInteger]::DivRem($value, 36, [ref]$remainder)
        $result = $chars[[int]$remainder] + $result
    }
    return $result
}

function Test-GradleZip([string]$path) {
    if (-not (Test-Path $path)) {
        return $false
    }
    $info = Get-Item $path
    if ($info.Length -lt 50MB) {
        return $false
    }
    $stream = [IO.File]::OpenRead($path)
    try {
        $magic = New-Object byte[] 4
        $null = $stream.Read($magic, 0, 4)
        return ($magic[0] -eq 0x50 -and $magic[1] -eq 0x4B)
    } finally {
        $stream.Dispose()
    }
}

function Remove-BrokenGradleDists {
    $rootDist = Join-Path $env:USERPROFILE ".gradle\wrapper\dists\gradle-9.6.1-bin"
    if (-not (Test-Path $rootDist)) {
        return
    }
    Get-ChildItem $rootDist -Recurse -Filter $zipName -File -ErrorAction SilentlyContinue | ForEach-Object {
        if (-not (Test-GradleZip $_.FullName)) {
            Write-Host "Removing invalid Gradle cache: $($_.FullName) ($($_.Length) bytes)"
            Remove-Item $_.Directory.FullName -Recurse -Force -ErrorAction SilentlyContinue
        }
    }
}

function Get-CurlArgs([string]$url, [string]$outFile, $proxy) {
    $curlArgs = @(
        "-L", "--fail", "--retry", "3",
        "--connect-timeout", "20",
        "-o", $outFile, $url
    )
    if ($proxy) {
        $curlArgs = @("--proxy", $proxy.Url) + $curlArgs
    }
    return $curlArgs
}

function Save-WrapperUrl([string]$url) {
    if (-not (Test-Path $wrapper)) {
        return
    }
    $escaped = $url -replace "https://", "https\://"
    $text = Get-Content -Raw $wrapper
    if ($text -notmatch "(?m)^distributionUrl=") {
        $text = $text.TrimEnd() + "`ndistributionUrl=$escaped`n"
    } else {
        $text = [regex]::Replace($text, "(?m)^distributionUrl=.*$", "distributionUrl=$escaped")
    }
    Set-Content -Path $wrapper -Value $text -NoNewline
}

$proxy = Parse-Proxy (Get-SystemProxyRaw)
$envLines = @("@echo off")

if (Test-Path $propsPath) {
    $lines = Get-Content $propsPath | Where-Object {
        $_ -notmatch "^\s*systemProp\.(http|https)\.proxy(Host|Port|User|Password)\s*="
    }

    if ($proxy) {
        $lines += @(
            "systemProp.http.proxyHost=$($proxy.Host)",
            "systemProp.http.proxyPort=$($proxy.Port)",
            "systemProp.https.proxyHost=$($proxy.Host)",
            "systemProp.https.proxyPort=$($proxy.Port)"
        )
    }

    Set-Content -Path $propsPath -Value ($lines -join "`n")
}

if ($proxy) {
    Write-Host "Gradle proxy: $($proxy.Host):$($proxy.Port)"
    $envLines += @(
        "set `"HTTP_PROXY=$($proxy.Url)`"",
        "set `"HTTPS_PROXY=$($proxy.Url)`"",
        "set `"http_proxy=$($proxy.Url)`"",
        "set `"https_proxy=$($proxy.Url)`""
    )
    $opts = "-Dhttp.proxyHost=$($proxy.Host) -Dhttp.proxyPort=$($proxy.Port) -Dhttps.proxyHost=$($proxy.Host) -Dhttps.proxyPort=$($proxy.Port)"
    $envLines += "set `"GRADLE_OPTS=%GRADLE_OPTS% $opts`""
} else {
    Write-Host "No Windows/system proxy detected."
}

Remove-BrokenGradleDists

$chosenUrl = $huaweiUrl
Write-Host "Gradle distribution: $chosenUrl"
Save-WrapperUrl $chosenUrl

$distHash = Get-GradleDistHash $chosenUrl
$distDir = Join-Path $env:USERPROFILE ".gradle\wrapper\dists\gradle-9.6.1-bin\$distHash"
$distZip = Join-Path $distDir $zipName
$distSha = "$distZip.sha256"
New-Item -ItemType Directory -Force -Path $distDir | Out-Null

if (-not (Test-GradleZip $distZip)) {
    Write-Host "Downloading Gradle 9.6.1 with curl (this is ~134MB)..."
    $tmpZip = Join-Path $env:TEMP $zipName
    if (Test-Path $tmpZip) {
        Remove-Item $tmpZip -Force
    }
    & curl.exe @(Get-CurlArgs $chosenUrl $tmpZip $proxy)
    if ($LASTEXITCODE -ne 0 -or -not (Test-GradleZip $tmpZip)) {
        Write-Host "Huawei mirror failed; trying services.gradle.org..."
        if (Test-Path $tmpZip) {
            Remove-Item $tmpZip -Force
        }
        $chosenUrl = $officialUrl
        Save-WrapperUrl $chosenUrl
        $distHash = Get-GradleDistHash $chosenUrl
        $distDir = Join-Path $env:USERPROFILE ".gradle\wrapper\dists\gradle-9.6.1-bin\$distHash"
        $distZip = Join-Path $distDir $zipName
        $distSha = "$distZip.sha256"
        New-Item -ItemType Directory -Force -Path $distDir | Out-Null
        & curl.exe @(Get-CurlArgs $chosenUrl $tmpZip $proxy)
    }
    if ($LASTEXITCODE -ne 0 -or -not (Test-GradleZip $tmpZip)) {
        throw "Failed to download a valid $zipName"
    }
    Move-Item -Force $tmpZip $distZip
}

$tmpSha = Join-Path $env:TEMP "$zipName.sha256"
& curl.exe @(Get-CurlArgs "$chosenUrl.sha256" $tmpSha $proxy)
if ($LASTEXITCODE -eq 0 -and (Test-Path $tmpSha)) {
    Move-Item -Force $tmpSha $distSha
    $expected = ((Get-Content -Raw $distSha) -split "\s+")[0].Trim().ToLowerInvariant()
    $actual = (Get-FileHash -Algorithm SHA256 $distZip).Hash.ToLowerInvariant()
    if ($expected -and $expected -ne $actual) {
        Remove-Item $distZip, $distSha -Force -ErrorAction SilentlyContinue
        throw "Gradle zip SHA-256 mismatch (expected $expected, got $actual)"
    }
    Write-Host "Gradle zip verified: $actual"
} else {
    Write-Host "No remote SHA-256; trusting zip magic and size only."
}

Write-Host "Gradle zip ready: $distZip"
Set-Content -Path $envCmd -Value ($envLines -join "`r`n")
