$ErrorActionPreference = "Stop"

$root = "C:\Users\13950\Desktop\ea web demo"
$node = "C:\Users\13950\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"

Set-Location $root

powershell -ExecutionPolicy Bypass -File ".\start-mysql-dev.ps1"

$existing = Get-NetTCPConnection -LocalPort 5173 -ErrorAction SilentlyContinue |
  Where-Object { $_.State -eq "Listen" } |
  Select-Object -First 1

if ($existing) {
  Write-Host "App server is already listening on http://127.0.0.1:5173/index.html"
  exit 0
}

Start-Process -FilePath $node `
  -ArgumentList "server.js" `
  -WorkingDirectory $root `
  -WindowStyle Hidden

Start-Sleep -Seconds 2

$started = Get-NetTCPConnection -LocalPort 5173 -ErrorAction SilentlyContinue |
  Where-Object { $_.State -eq "Listen" } |
  Select-Object -First 1

if ($started) {
  Write-Host "App server started at http://127.0.0.1:5173/index.html"
} else {
  throw "App server did not start."
}
