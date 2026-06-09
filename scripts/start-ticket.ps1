param(
  [Parameter(Mandatory = $true)]
  [string]$TicketName
)

$ErrorActionPreference = "Stop"
$root = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $root

node tools/harness-cli/index.js start-ticket $TicketName
