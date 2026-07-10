# ==============================================================================
# [Harness] Smoke Test for CLI Flow (PowerShell)
# Usage: .\scripts\smoke-test.ps1
# ==============================================================================

$ErrorActionPreference = "Stop"
$root = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $root

$TicketName = "smoke-test-ticket"
$ConfigPath = ".harness/config.json"
$ConfigBackup = [System.IO.File]::ReadAllBytes((Resolve-Path $ConfigPath))

function Test-L5Checkpoint {
  Write-Host "[Smoke Test] Checking interactive L5 checkpoint..."
  $previousLevel = $env:HARNESS_AUTONOMY_LEVEL
  try {
    $env:HARNESS_AUTONOMY_LEVEL = "5"
    & node "tools/harness-cli/index.js" autonomy
    if ($LASTEXITCODE -ne 0) {
      throw "Error: Interactive L5 checkpoint failed."
    }
    & node "tools/harness-cli/index.js" autonomy --verify-current
    if ($LASTEXITCODE -ne 0) {
      throw "Error: Interactive L5 verification failed."
    }
  } finally {
    $env:HARNESS_AUTONOMY_LEVEL = $previousLevel
  }
}

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
  Remove-Item -Path ".harness/safe-l5.patch" -ErrorAction SilentlyContinue
  Remove-Item -Path ".harness/risky-l5.patch" -ErrorAction SilentlyContinue
  Remove-Item -Path ".harness/protected-l5.patch" -ErrorAction SilentlyContinue
  Remove-Item -Path "observability/autonomy/state.json" -ErrorAction SilentlyContinue
  Remove-Item -Path "smoke-fingerprint.tmp" -ErrorAction SilentlyContinue
  Remove-Item -Path "smoke-generated.tmp" -ErrorAction SilentlyContinue
  Get-ChildItem "observability/metrics" -Filter "cleanup-*.json" -ErrorAction SilentlyContinue |
    Remove-Item -Force -ErrorAction SilentlyContinue
  [System.IO.File]::WriteAllBytes((Join-Path $root $ConfigPath), $ConfigBackup)
}

# Clean up before run
Cleanup-TestFiles

try {
  Write-Host "[Smoke Test] 1. Running check..."
  & .\scripts\check-environment.ps1

  $preExistingActiveCount = @(
    Get-ChildItem ".harness/tasks/active" -Filter "*.md" -File |
      Where-Object { $_.Name -ne ".gitkeep" -and $_.BaseName -ne $TicketName }
  ).Count
  if ($preExistingActiveCount -gt 1) {
    throw "Error: Smoke test requires at most one pre-existing active ticket."
  }
  if ($preExistingActiveCount -eq 1) {
    Test-L5Checkpoint
  }

  Write-Host "[Smoke Test] 2. Creating ticket..."
  & .\scripts\create-ticket.ps1 -TicketName $TicketName -Type "test" `
    -Goal "Verify cli quoting works" `
    -Scope "Test scope with spaces" `
    -OutOfScope "Test out of scope" `
    -Acceptance "Test criteria" `
    -Risk "low"

  if (-not (Test-Path ".harness/tasks/backlog/$TicketName.md")) {
    throw "Error: Backlog ticket file was not created."
  }

  Write-Host "[Smoke Test] 3. Starting ticket..."
  if ($preExistingActiveCount -eq 1) {
    $previousErrorActionPreference = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    & node "tools/harness-cli/index.js" start-ticket $TicketName 2>$null
    $parallelStartExitCode = $LASTEXITCODE
    $ErrorActionPreference = $previousErrorActionPreference
    if ($parallelStartExitCode -eq 0) {
      throw "Error: Parallel ticket started without explicit opt-in."
    }
    $startOutput = (& .\scripts\start-ticket.ps1 -TicketName $TicketName -AllowParallel 2>&1 | Out-String)
  } else {
    $startOutput = (& .\scripts\start-ticket.ps1 -TicketName $TicketName 2>&1 | Out-String)
  }
  Write-Host $startOutput
  $hasOrigin = (Test-Path ".git/config") -and
    (Select-String -Path ".git/config" -Pattern '^\[remote "origin"\]$' -Quiet)
  $expectedStartGuidance = if ($hasOrigin) { "commit and push" } else { "commit, run complete-task" }
  if (-not $startOutput.Contains($expectedStartGuidance)) {
    throw "Error: Start guidance did not match remote availability."
  }

  if (-not (Test-Path ".harness/tasks/active/$TicketName.md")) {
    throw "Error: Active ticket file was not created."
  }

  if ($preExistingActiveCount -eq 0) {
    Test-L5Checkpoint
  }

  Write-Host "[Smoke Test] 4. Verifying task..."
  if ($preExistingActiveCount -eq 1) {
    $previousErrorActionPreference = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    & node "tools/harness-cli/index.js" verify --offline 2>$null
    $ambiguousVerifyExitCode = $LASTEXITCODE
    $ErrorActionPreference = $previousErrorActionPreference
    if ($ambiguousVerifyExitCode -eq 0) {
      throw "Error: Ambiguous verification ran without an explicit task."
    }
  }
  $env:TASK_ID = $TicketName
  & .\scripts\verify-task.ps1 -Offline

  if (-not (Test-Path "observability/metrics/$TicketName.verify.json")) {
    throw "Error: Verify metric JSON file was not created."
  }
  $verifyRecord = Get-Content "observability/metrics/$TicketName.verify.json" -Raw | ConvertFrom-Json
  if ($verifyRecord.last_full.result -ne "pass") {
    throw "Error: Full verification record was not stored separately."
  }
  $quickConfigBackup = [System.IO.File]::ReadAllBytes((Resolve-Path $ConfigPath))
  $quickConfig = Get-Content $ConfigPath -Raw | ConvertFrom-Json
  $quickConfig.verify.quick = [PSCustomObject]@{
    "__smoke_unmatched__/**" = @('node -e "process.exit(0)"')
  }
  $quickConfigJson = $quickConfig | ConvertTo-Json -Depth 10
  [System.IO.File]::WriteAllText((Join-Path $root $ConfigPath), $quickConfigJson, [System.Text.UTF8Encoding]::new($false))
  try {
    & .\scripts\verify-task.ps1 -Offline -Quick
  } finally {
    [System.IO.File]::WriteAllBytes((Join-Path $root $ConfigPath), $quickConfigBackup)
  }
  $verifyRecord = Get-Content "observability/metrics/$TicketName.verify.json" -Raw | ConvertFrom-Json
  if ($verifyRecord.last_full.result -ne "pass" -or $verifyRecord.last_quick.result -ne "inconclusive") {
    throw "Error: Inconclusive quick verification did not preserve the full verification record."
  }

  Write-Host "[Smoke Test] 5. Checking stale fingerprint rejection..."
  Set-Content -Path "smoke-fingerprint.tmp" -Value "changed after full verify" -NoNewline
  $previousErrorActionPreference = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  & node "tools/harness-cli/index.js" complete-task $TicketName 2>$null
  $staleCompleteExitCode = $LASTEXITCODE
  $ErrorActionPreference = $previousErrorActionPreference
  if ($staleCompleteExitCode -eq 0) {
    throw "Error: Completion accepted content changed after full verification."
  }
  Remove-Item "smoke-fingerprint.tmp" -Force

  Write-Host "[Smoke Test] 6. Checking quick/full isolation and approved cleanup..."
  $config = Get-Content $ConfigPath -Raw | ConvertFrom-Json
  $config.verify.quick = [PSCustomObject]@{
    "**/*" = @("node -e `"require('fs').writeFileSync('smoke-generated.tmp','generated')`"")
  }
  $configJson = $config | ConvertTo-Json -Depth 10
  [System.IO.File]::WriteAllText((Join-Path $root $ConfigPath), $configJson, [System.Text.UTF8Encoding]::new($false))
  & .\scripts\verify-task.ps1 -Offline
  $previousErrorActionPreference = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  & .\scripts\verify-task.ps1 -Offline -Quick 2>$null
  $quickExitCode = $LASTEXITCODE
  $ErrorActionPreference = $previousErrorActionPreference
  if ($quickExitCode -eq 0) {
    throw "Error: Quick verification did not detect its generated worktree artifact."
  }
  $verifyRecord = Get-Content "observability/metrics/$TicketName.verify.json" -Raw | ConvertFrom-Json
  if ($verifyRecord.last_full.result -ne "pass" -or $verifyRecord.last_quick.result -ne "fail") {
    throw "Error: Quick verification overwrote or failed to preserve the full verification record."
  }
  $cleanupOutput = (& node "tools/harness-cli/index.js" cleanup --dry-run 2>&1 | Out-String)
  Write-Host $cleanupOutput
  if ($cleanupOutput -notmatch "Manifest ID:\s*([a-f0-9]{12})") {
    throw "Error: Cleanup dry-run did not produce an integrity-bound manifest."
  }
  $manifestId = $Matches[1]
  & node "tools/harness-cli/index.js" cleanup --approve $manifestId
  if (Test-Path "smoke-generated.tmp") {
    throw "Error: Approved cleanup did not remove the verification-generated file."
  }

  Write-Host "[Smoke Test] 7. Completing task..."
  $completeOutput = (& .\scripts\complete-task.ps1 -TaskName $TicketName 2>&1 | Out-String)
  Write-Host $completeOutput
  $expectedCompleteGuidance = if ($hasOrigin) { "commit and push the archived" } else { "commit the archived" }
  if (-not $completeOutput.Contains($expectedCompleteGuidance)) {
    throw "Error: Completion guidance did not match remote availability."
  }

  if (-not (Test-Path ".harness/tasks/archive/$TicketName.md")) {
    throw "Error: Archive ticket file was not created."
  }
  if (-not (Select-String -Path ".harness/tasks/archive/$TicketName.md" -Pattern "## Completion" -Quiet)) {
    throw "Error: Archive ticket completion metadata was not recorded."
  }

  if (-not (Test-Path "observability/metrics/$TicketName.done.json")) {
    throw "Error: Done metric JSON file was not created."
  }

  Write-Host "[Smoke Test] 8. Validating config fail-closed and help bypass..."
  [System.IO.File]::WriteAllText((Join-Path $root $ConfigPath), "{ invalid json", [System.Text.UTF8Encoding]::new($false))
  $previousErrorActionPreference = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  & node "tools/harness-cli/index.js" validate-prompts 2>$null
  $invalidConfigExitCode = $LASTEXITCODE
  $ErrorActionPreference = $previousErrorActionPreference
  if ($invalidConfigExitCode -eq 0) {
    throw "Error: Invalid config did not fail closed."
  }
  & node "tools/harness-cli/index.js" help *> $null
  if ($LASTEXITCODE -ne 0) {
    throw "Error: Help did not bypass invalid config."
  }
  [System.IO.File]::WriteAllBytes((Join-Path $root $ConfigPath), $ConfigBackup)

  Write-Host "[Smoke Test] 9. Validating L4.5 auto-fix policy..."
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

  Write-Host "[Smoke Test] 10. Validating L5 policy and opt-in gate..."
  & node "tools/harness-cli/index.js" validate-prompts
  if ($LASTEXITCODE -ne 0) {
    throw "Error: Prompt template validation failed."
  }
  & node "tools/harness-cli/index.js" validate-api-retry
  if ($LASTEXITCODE -ne 0) {
    throw "Error: API retry policy validation failed."
  }
  & node "tools/harness-cli/index.js" validate-recovery
  if ($LASTEXITCODE -ne 0) {
    throw "Error: Recovery diagnostics policy validation failed."
  }
  if (Select-String -Path "tools/harness-cli/index.js" -Pattern 'git reset --hard|git clean -fd' -Quiet) {
    throw "Error: Destructive Git recovery command was introduced."
  }
  @"
diff --git a/src/new-feature.js b/src/new-feature.js
new file mode 100644
--- /dev/null
+++ b/src/new-feature.js
@@ -0,0 +1 @@
+export const enabled = true;
"@ | Set-Content -Encoding UTF8 ".harness/safe-l5.patch"
  & node "tools/harness-cli/index.js" validate-l5-patch ".harness/safe-l5.patch"

  @"
diff --git a/package.json b/package.json
--- a/package.json
+++ b/package.json
@@ -1 +1 @@
-{}
+{"private":true}
"@ | Set-Content -Encoding UTF8 ".harness/risky-l5.patch"
  & node "tools/harness-cli/index.js" validate-l5-patch ".harness/risky-l5.patch"

  @"
diff --git a/.env.local b/.env.local
--- a/.env.local
+++ b/.env.local
@@ -1 +1 @@
-SECRET=old
+SECRET=new
"@ | Set-Content -Encoding UTF8 ".harness/protected-l5.patch"
  & node "tools/harness-cli/index.js" validate-l5-patch ".harness/protected-l5.patch"
  if ($LASTEXITCODE -eq 0) {
    throw "Error: Protected secret patch was not rejected."
  }

  $previousLevel = $env:HARNESS_AUTONOMY_LEVEL
  $env:HARNESS_AUTONOMY_LEVEL = "4.5"
  & node "tools/harness-cli/index.js" autonomy
  if ($LASTEXITCODE -eq 0) {
    throw "Error: L5 autonomy ran without explicit opt-in."
  }
  $env:HARNESS_AUTONOMY_LEVEL = $previousLevel

  Write-Host "[Smoke Test] Success! Complete harness flow works seamlessly."
} finally {
  Cleanup-TestFiles
}
