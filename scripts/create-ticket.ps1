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

$backlogDir = ".harness/tasks/backlog"
$ticketFile = Join-Path $backlogDir "$TicketName.md"

if (Test-Path $ticketFile) {
  throw "Ticket already exists: $ticketFile"
}

New-Item -ItemType Directory -Force -Path $backlogDir | Out-Null

$content = @"
# TICKET: $TicketName

## Type
$Type

## Goal
- $Goal

## Scope
- $Scope

## Out of Scope
- $OutOfScope

## Acceptance Criteria
- [ ] $Acceptance

## Risk
- $Risk

## Notes
- Created from backlog workflow.
"@

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$absoluteTicketFile = Join-Path (Resolve-Path $backlogDir) "$TicketName.md"
[System.IO.File]::WriteAllText($absoluteTicketFile, $content.TrimEnd() + "`n", $utf8NoBom)
Write-Host "Created ticket: $ticketFile"
