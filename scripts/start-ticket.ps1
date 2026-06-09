param(
  [Parameter(Mandatory = $true)]
  [string]$TicketName
)

$ErrorActionPreference = "Stop"
$root = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $root

$nodeArgs = @("tools/harness-cli/index.js", "start-ticket", $TicketName)
& node @nodeArgs
