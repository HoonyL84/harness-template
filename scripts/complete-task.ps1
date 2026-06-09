param(
  [Parameter(Mandatory = $true)]
  [string]$TaskName,

  [switch]$Force
)

$ErrorActionPreference = "Stop"
$root = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $root

$nodeArgs = @("tools/harness-cli/index.js", "complete-task", $TaskName)
if ($Force) {
  $nodeArgs += "--force"
}

node @nodeArgs
