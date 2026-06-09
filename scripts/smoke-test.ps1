# ==============================================================================
# [Harness] Smoke Test for CLI Flow (PowerShell)
# Usage: .\scripts\smoke-test.ps1
# ==============================================================================

$ErrorActionPreference = "Stop"
$root = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $root

$TicketName = "smoke-test-ticket"

Write-Host "[Smoke Test] Cleaning up old test files..."
Remove-Item -Path ".harness/tasks/backlog/$TicketName.md" -ErrorAction SilentlyContinue
Remove-Item -Path ".harness/tasks/active/$TicketName.md" -ErrorAction SilentlyContinue
Remove-Item -Path ".harness/tasks/archive/$TicketName.md" -ErrorAction SilentlyContinue
Remove-Item -Path "observability/metrics/$TicketName.verify.json" -ErrorAction SilentlyContinue
Remove-Item -Path "observability/metrics/$TicketName.start.json" -ErrorAction SilentlyContinue
Remove-Item -Path "observability/metrics/$TicketName.done.json" -ErrorAction SilentlyContinue

Write-Host "[Smoke Test] 1. Running check..."
& .\scripts\check-environment.ps1

Write-Host "[Smoke Test] 2. Creating ticket..."
& .\scripts\create-ticket.ps1 -TicketName $TicketName -Type "chore" `
  -Goal "Verify cli quoting works" `
  -Scope "Test scope with spaces" `
  -OutOfScope "Test out of scope" `
  -Acceptance "Test criteria" `
  -Risk "low"

if (-not (Test-Path ".harness/tasks/backlog/$TicketName.md")) {
  Write-Error "Error: Backlog ticket file was not created."
  exit 1
}

Write-Host "[Smoke Test] 3. Starting ticket..."
& .\scripts\start-ticket.ps1 -TicketName $TicketName

if (-not (Test-Path ".harness/tasks/active/$TicketName.md")) {
  Write-Error "Error: Active ticket file was not created."
  exit 1
}

Write-Host "[Smoke Test] 4. Verifying task..."
$env:TASK_ID = $TicketName
& .\scripts\verify-task.ps1 -Offline

if (-not (Test-Path "observability/metrics/$TicketName.verify.json")) {
  Write-Error "Error: Verify metric JSON file was not created."
  exit 1
}

Write-Host "[Smoke Test] 5. Completing task..."
& .\scripts\complete-task.ps1 -TaskName $TicketName

if (-not (Test-Path ".harness/tasks/archive/$TicketName.md")) {
  Write-Error "Error: Archive ticket file was not created."
  exit 1
}

if (-not (Test-Path "observability/metrics/$TicketName.done.json")) {
  Write-Error "Error: Done metric JSON file was not created."
  exit 1
}

Write-Host "[Smoke Test] Cleaning up test files..."
Remove-Item -Path ".harness/tasks/archive/$TicketName.md" -ErrorAction SilentlyContinue
Remove-Item -Path "observability/metrics/$TicketName.done.json" -ErrorAction SilentlyContinue

Write-Host "[Smoke Test] Success! Complete harness flow works seamlessly."
