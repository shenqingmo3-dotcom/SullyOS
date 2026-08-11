$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$runtimeDir = Join-Path $scriptDir ".runtime"
$requirements = Join-Path $scriptDir "requirements.txt"
$serverScript = Join-Path $scriptDir "server.py"
$tokenFile = Join-Path $runtimeDir "access-token.txt"

$pythonCommand = Get-Command python -ErrorAction SilentlyContinue
$pythonExe = if ($pythonCommand) { $pythonCommand.Source } else { $null }

if (-not $pythonExe) {
    $codexPython = Join-Path $env:USERPROFILE ".cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe"
    if (Test-Path -LiteralPath $codexPython) {
        $pythonExe = $codexPython
    }
}

if (-not $pythonExe) {
    throw "Python was not found. Install Python 3.11 or newer and enable Add Python to PATH."
}

$previousPythonPath = $env:PYTHONPATH
$env:PYTHONPATH = if ($previousPythonPath) {
    "$runtimeDir;$previousPythonPath"
} else {
    $runtimeDir
}

$runtimeReady = $false
if (Test-Path -LiteralPath (Join-Path $runtimeDir "bleak\__init__.py")) {
    & $pythonExe -c "import bleak; import winrt._winrt" 2>$null
    $runtimeReady = ($LASTEXITCODE -eq 0)
}

if (-not $runtimeReady) {
    New-Item -ItemType Directory -Force -Path $runtimeDir | Out-Null
    Write-Host "Installing Windows Bluetooth dependencies for the current Python version..."
    & $pythonExe -m pip install --disable-pip-version-check --upgrade --force-reinstall --target $runtimeDir -r $requirements
    if ($LASTEXITCODE -ne 0) {
        throw "The Bluetooth dependency could not be installed."
    }
}

if (-not (Test-Path -LiteralPath $tokenFile)) {
    $tokenBytes = New-Object byte[] 32
    $random = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        $random.GetBytes($tokenBytes)
    }
    finally {
        $random.Dispose()
    }
    $newToken = [Convert]::ToBase64String($tokenBytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
    Set-Content -LiteralPath $tokenFile -Value $newToken -Encoding Ascii -NoNewline
}
$accessToken = (Get-Content -LiteralPath $tokenFile -Raw).Trim()
if (-not $accessToken) {
    throw "The local MCP access token is empty."
}

$env:GALAKU_DEVICE_NAME = "K134"
$env:GALAKU_DEVICE_ADDRESS = "DF:49:D6:C2:7E:64"
$env:GALAKU_MCP_HOST = "127.0.0.1"
$env:GALAKU_MCP_PORT = "8765"
$env:GALAKU_ACCESS_TOKEN = $accessToken
if (-not $env:GALAKU_MAX_VIBRATION) {
    $env:GALAKU_MAX_VIBRATION = "85"
}
if (-not $env:GALAKU_MAX_SUCTION) {
    $env:GALAKU_MAX_SUCTION = "85"
}

Set-Location -LiteralPath $scriptDir
Write-Host ""
Write-Host "SullyOS Bearer Token:"
Write-Host $accessToken
Write-Host ""
& $pythonExe $serverScript
