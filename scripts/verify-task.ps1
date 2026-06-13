param(
  [switch]$Offline,
  [switch]$Diagnose,
  [switch]$AutoFix,
  [switch]$Quick,
  [switch]$Full
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
if ($Quick) {
  $nodeArgs += "--quick"
}
if ($Full) {
  $nodeArgs += "--full"
}
$nodeArgs += $args

& node @nodeArgs
