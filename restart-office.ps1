# Restarts the Brick Office server in place. The Quest link, pairing and page token survive, so a headset that is
# already in the office reconnects by itself. Worker terminals restart (their Claude/Codex sessions start fresh).
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$port = if ($env:OFFICE_PORT) { $env:OFFICE_PORT } else { 8120 }
$base = "http://127.0.0.1:$port"
$token = (Invoke-RestMethod "$base/api/state").token
Invoke-RestMethod -Method Post "$base/api/server/restart" -Headers @{ 'X-Office-Token' = $token } | Out-Null
Start-Sleep -Seconds 2
for ($i = 0; $i -lt 60; $i++) {
    try { Invoke-RestMethod "$base/api/state" -TimeoutSec 2 | Out-Null; Write-Output 'Brick Office restarted.'; exit 0 } catch { Start-Sleep -Milliseconds 500 }
}
throw 'The office server did not come back. See data\server-error.log.'
