param([switch]$NoOpen)
# Starts the Brick Office server (if it is not already running) and opens the dashboard.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$port = if ($env:OFFICE_PORT) { $env:OFFICE_PORT } else { 8120 }
$url = "http://127.0.0.1:$port/api/state"
function Test-Office { try { Invoke-RestMethod -Uri $url -TimeoutSec 2 | Out-Null; $true } catch { $false } }
if (-not (Test-Office)) {
    $python = (Get-Command python).Source
    $env:PYTHONIOENCODING = 'utf-8'; $env:PYTHONUNBUFFERED = '1'
    Start-Process -FilePath $python -ArgumentList @('"' + (Join-Path $root 'server.py') + '"') -WorkingDirectory $root -WindowStyle Hidden `
        -RedirectStandardOutput (Join-Path $root 'data\server.log') -RedirectStandardError (Join-Path $root 'data\server-error.log')
    for ($i = 0; $i -lt 60 -and -not (Test-Office); $i++) { Start-Sleep -Milliseconds 500 }
    if (-not (Test-Office)) { throw 'The office server did not start. See data\server-error.log.' }
}
if (-not $NoOpen) { Start-Process "http://localhost:$port" }
