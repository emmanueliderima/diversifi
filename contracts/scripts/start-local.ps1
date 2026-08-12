$ErrorActionPreference = 'Stop'
$contractsRoot = Split-Path -Parent $PSScriptRoot
$node = Start-Process -FilePath 'bun' -ArgumentList 'x','hardhat','node','--hostname','127.0.0.1' -WorkingDirectory $contractsRoot -WindowStyle Hidden -PassThru
for ($attempt = 0; $attempt -lt 30; $attempt++) { try { Invoke-RestMethod -Uri 'http://127.0.0.1:8545' -Method Post -ContentType 'application/json' -Body '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}' | Out-Null; break } catch { Start-Sleep -Milliseconds 500 }; if ($attempt -eq 29) { Stop-Process -Id $node.Id -Force; throw 'Hardhat node did not become ready.' } }
Push-Location $contractsRoot
try { bun run local:deploy; if ($LASTEXITCODE -ne 0) { Stop-Process -Id $node.Id -Force -ErrorAction SilentlyContinue; exit $LASTEXITCODE } } finally { Pop-Location }
Write-Output "Local MVP deployed on http://127.0.0.1:8545. Hardhat node PID: $($node.Id)"
