param(
  [string]$Type,
  [string]$Role,
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$Prompt
)

$ErrorActionPreference = "Stop"
$root = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $root

$nodeArgs = @("tools/harness-cli/index.js", "run-agent")
if ($Type) {
  $nodeArgs += @("--type", $Type)
}
if ($Role) {
  $nodeArgs += @("--role", $Role)
}
if ($Prompt) {
  $nodeArgs += ($Prompt -join " ")
}

node @nodeArgs
