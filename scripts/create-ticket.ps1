param(
  [Parameter(Mandatory = $true)]
  [string]$TicketName,

  [Parameter(Mandatory = $true)]
  [ValidateSet("feat", "fix", "refactor", "docs", "chore", "experiment")]
  [string]$Type,

  [Parameter(Mandatory = $true)]
  [string]$Goal,

  [string]$Scope = "[작성 필요]",
  [string]$OutOfScope = "[작성 필요]",
  [string]$Acceptance = "검증 기준 작성",
  [string]$Risk = "낮음"
)

$ErrorActionPreference = "Stop"
$root = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $root

node tools/harness-cli/index.js create-ticket $TicketName $Type --goal $Goal --scope $Scope --out-of-scope $OutOfScope --acceptance $Acceptance --risk $Risk
