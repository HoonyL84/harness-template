param(
  [Parameter(Mandatory = $true)]
  [string]$TicketName,

  [Parameter(Mandatory = $true)]
  [ValidateSet("feat", "fix", "refactor", "docs", "chore", "test", "experiment")]
  [string]$Type,

  [Parameter(Mandatory = $true)]
  [string]$Goal,

  [string]$Scope = "[Define scope]",
  [string]$OutOfScope = "[Define exclusions]",
  [string]$Acceptance = "[Define acceptance criteria]",
  [string]$Risk = "low"
)

$ErrorActionPreference = "Stop"
$root = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $root

$nodeArgs = @(
  "tools/harness-cli/index.js",
  "create-ticket",
  $TicketName,
  $Type,
  "--goal", $Goal,
  "--scope", $Scope,
  "--out-of-scope", $OutOfScope,
  "--acceptance", $Acceptance,
  "--risk", $Risk
)

& node @nodeArgs
