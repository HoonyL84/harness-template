param(
  [switch]$Offline,
  [switch]$Diagnose
)

$ErrorActionPreference = "Stop"
$root = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $root

$nodeArgs = @("tools/harness-cli/index.js", "verify")
if ($Offline) {
  $nodeArgs += "--offline"
}
if ($Diagnose) {
  $nodeArgs += "--diagnose"
}
$nodeArgs += $args

& node @nodeArgs
