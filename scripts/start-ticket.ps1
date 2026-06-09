param(
  [Parameter(Mandatory = $true)]
  [string]$TicketName
)

$ErrorActionPreference = "Stop"
$root = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $root

$backlogFile = Join-Path ".harness/tasks/backlog" "$TicketName.md"
$activeFile = Join-Path ".harness/tasks/active" "$TicketName.md"

if (-not (Test-Path $backlogFile)) {
  throw "Backlog ticket not found: $backlogFile"
}

if (Test-Path $activeFile) {
  throw "Active task already exists: $activeFile"
}

New-Item -ItemType Directory -Force -Path ".harness/tasks/active" | Out-Null
Move-Item -LiteralPath $backlogFile -Destination $activeFile

Write-Host "Promoted ticket to active: $activeFile"
Write-Host "Next: implement, verify, commit, then archive with complete-task."
