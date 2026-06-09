param(
  [switch]$Offline
)

$ErrorActionPreference = "Stop"
$root = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $root

$nodeArgs = @("tools/harness-cli/index.js", "verify")
if ($Offline) {
  $nodeArgs += "--offline"
}

node @nodeArgs
