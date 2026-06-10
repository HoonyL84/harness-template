# ==============================================================================
# [Harness] Smoke Test for CLI Flow (PowerShell)
# Usage: .\scripts\smoke-test.ps1
# ==============================================================================

$ErrorActionPreference = "Stop"
$root = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $root

$TicketName = "smoke-test-ticket"

function Cleanup-TestFiles {
  Write-Host "[Smoke Test] Cleaning up test files..."
  Remove-Item -Path ".harness/tasks/backlog/$TicketName.md" -ErrorAction SilentlyContinue
  Remove-Item -Path ".harness/tasks/active/$TicketName.md" -ErrorAction SilentlyContinue
  Remove-Item -Path ".harness/tasks/archive/$TicketName.md" -ErrorAction SilentlyContinue
  Remove-Item -Path "observability/metrics/$TicketName.verify.json" -ErrorAction SilentlyContinue
  Remove-Item -Path "observability/metrics/$TicketName.start.json" -ErrorAction SilentlyContinue
  Remove-Item -Path "observability/metrics/$TicketName.done.json" -ErrorAction SilentlyContinue
  Remove-Item -Path ".harness/valid-auto-fix.patch" -ErrorAction SilentlyContinue
  Remove-Item -Path ".harness/blocked-auto-fix.patch" -ErrorAction SilentlyContinue
  Remove-Item -Path ".harness/new-file-auto-fix.patch" -ErrorAction SilentlyContinue
}

# Clean up before run
Cleanup-TestFiles

try {
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
    throw "Error: Backlog ticket file was not created."
  }

  Write-Host "[Smoke Test] 3. Starting ticket..."
  & .\scripts\start-ticket.ps1 -TicketName $TicketName

  if (-not (Test-Path ".harness/tasks/active/$TicketName.md")) {
    throw "Error: Active ticket file was not created."
  }

  Write-Host "[Smoke Test] 4. Verifying task..."
  $env:TASK_ID = $TicketName
  & .\scripts\verify-task.ps1 -Offline

  if (-not (Test-Path "observability/metrics/$TicketName.verify.json")) {
    throw "Error: Verify metric JSON file was not created."
  }

  Write-Host "[Smoke Test] 5. Completing task..."
  & .\scripts\complete-task.ps1 -TaskName $TicketName

  if (-not (Test-Path ".harness/tasks/archive/$TicketName.md")) {
    throw "Error: Archive ticket file was not created."
  }

  if (-not (Test-Path "observability/metrics/$TicketName.done.json")) {
    throw "Error: Done metric JSON file was not created."
  }

  Write-Host "[Smoke Test] 6. Validating L4.5 auto-fix policy..."
  @"
diff --git a/packages/example/src/example.js b/packages/example/src/example.js
--- a/packages/example/src/example.js
+++ b/packages/example/src/example.js
@@ -1 +1 @@
-const value = 1;
+const value = 2;
"@ | Set-Content -Encoding UTF8 ".harness/valid-auto-fix.patch"
  & node "tools/harness-cli/index.js" validate-auto-fix ".harness/valid-auto-fix.patch"

  @"
diff --git a/package.json b/package.json
--- a/package.json
+++ b/package.json
@@ -1 +1 @@
-{}
+{"scripts":{}}
"@ | Set-Content -Encoding UTF8 ".harness/blocked-auto-fix.patch"

  & node "tools/harness-cli/index.js" validate-auto-fix ".harness/blocked-auto-fix.patch"
  if ($LASTEXITCODE -eq 0) {
    throw "Error: Protected package.json patch was not rejected."
  }

  @"
diff --git a/src/new-file.js b/src/new-file.js
new file mode 100644
--- /dev/null
+++ b/src/new-file.js
@@ -0,0 +1 @@
+export const created = true;
"@ | Set-Content -Encoding UTF8 ".harness/new-file-auto-fix.patch"

  & node "tools/harness-cli/index.js" validate-auto-fix ".harness/new-file-auto-fix.patch"
  if ($LASTEXITCODE -eq 0) {
    throw "Error: New file patch was not rejected."
  }

  Write-Host "[Smoke Test] Success! Complete harness flow works seamlessly."
} finally {
  Cleanup-TestFiles
}
