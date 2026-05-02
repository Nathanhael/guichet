# Local CI — runs the same checks as the old GitHub Actions pipeline
# Usage: powershell -File scripts/ci.ps1
#        powershell -File scripts/ci.ps1 -Skip e2e    (skip slow E2E tests)

param(
    [ValidateSet("typecheck", "tenant-isolation-guard", "e2e-skip-guard", "lint", "audit", "test-server", "test-client", "migrate", "build", "e2e")]
    [string[]]$Skip = @()
)

$ErrorActionPreference = "Stop"
$failed = @()
$stopwatch = [System.Diagnostics.Stopwatch]::StartNew()

function Run-Step {
    param([string]$Name, [string[]]$Commands)
    if ($Skip -contains $Name) {
        Write-Host "`n  SKIP  $Name" -ForegroundColor Yellow
        return
    }
    Write-Host "`n  RUN   $Name" -ForegroundColor Cyan
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    $stepFailed = $false
    foreach ($cmd in $Commands) {
        Invoke-Expression $cmd
        if ($LASTEXITCODE -ne 0) {
            $stepFailed = $true
            break
        }
    }
    $sw.Stop()
    if ($stepFailed) {
        Write-Host "  FAIL  $Name ($($sw.Elapsed.TotalSeconds.ToString('0.0'))s)" -ForegroundColor Red
        $script:failed += $Name
    } else {
        Write-Host "  PASS  $Name ($($sw.Elapsed.TotalSeconds.ToString('0.0'))s)" -ForegroundColor Green
    }
}

Write-Host "`n========================================" -ForegroundColor White
Write-Host "  Guichet Local CI" -ForegroundColor White
Write-Host "========================================" -ForegroundColor White

Run-Step "typecheck" @("docker compose exec server npx tsc --noEmit", "docker compose exec client npx tsc --noEmit")
Run-Step "tenant-isolation-guard" @("docker compose exec server node scripts/check-trpc-tenant-isolation.mjs trpc/routers")
Run-Step "e2e-skip-guard" @("powershell -NoProfile -File scripts/check-e2e-skip-guard.ps1")
Run-Step "lint" @("docker compose exec server npm run lint", "docker compose exec client npm run lint")
Run-Step "audit" @("docker compose exec server npm audit --audit-level=high", "docker compose exec client npm audit --audit-level=high")
Run-Step "test-server" @("docker compose exec server npm test")
Run-Step "test-client" @("docker compose exec client npm test")
Run-Step "migrate" @("docker compose exec server npx drizzle-kit migrate")
# Vite production build runs in its own step so Rolldown/Vite regressions (like
# the flag-emoji hash_placeholder panic) fail CI even when e2e is skipped.
Run-Step "build" @("docker compose exec client npm run build")
# `$env:CI = '1'` flips playwright.config.ts:7 from `retries: 0` to `retries: 2`.
# Local CI hits transient worker-spawn races (`Cannot find module 'playwright/lib/common/process.js'`
# at 0ms) when something concurrent touches `node_modules` mid-run — Drive sync,
# antivirus realtime-scan, or a parallel-session npm op. Retries absorb the flake
# without masking real failures: a structurally broken test still fails 3×.
Run-Step "e2e" @('$env:CI = "1"; npx playwright test')

$stopwatch.Stop()
Write-Host "`n========================================" -ForegroundColor White

if ($failed.Count -gt 0) {
    Write-Host "  FAILED ($($stopwatch.Elapsed.TotalSeconds.ToString('0'))s): $($failed -join ', ')" -ForegroundColor Red
    exit 1
} else {
    $ran = 10 - $Skip.Count
    Write-Host "  ALL $ran STEPS PASSED ($($stopwatch.Elapsed.TotalSeconds.ToString('0'))s)" -ForegroundColor Green
    exit 0
}
