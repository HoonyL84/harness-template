param(
  [switch]$Offline,
  [switch]$Diagnose,
  [switch]$AutoFix
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
if ($AutoFix) {
  $nodeArgs += "--auto-fix"
}
$nodeArgs += $args

& node @nodeArgs
