# Local CI — runs the same checks as the old GitHub Actions pipeline
# Usage: powershell -File scripts/ci.ps1
#        powershell -File scripts/ci.ps1 -Skip e2e    (skip slow E2E tests)

param(
    [ValidateSet("typecheck", "audit", "test-server", "test-client", "migrate", "build", "e2e")]
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
Run-Step "audit" @("docker compose exec server npm audit --audit-level=high", "docker compose exec client npm audit --audit-level=high")
Run-Step "test-server" @("docker compose exec server npm test")
Run-Step "test-client" @("docker compose exec client npm test")
Run-Step "migrate" @("docker compose exec server npx drizzle-kit migrate")
# Vite production build runs in its own step so Rolldown/Vite regressions (like
# the flag-emoji hash_placeholder panic) fail CI even when e2e is skipped.
Run-Step "build" @("docker compose exec client npm run build")
Run-Step "e2e" @("npx playwright test")

$stopwatch.Stop()
Write-Host "`n========================================" -ForegroundColor White

if ($failed.Count -gt 0) {
    Write-Host "  FAILED ($($stopwatch.Elapsed.TotalSeconds.ToString('0'))s): $($failed -join ', ')" -ForegroundColor Red
    exit 1
} else {
    $ran = 7 - $Skip.Count
    Write-Host "  ALL $ran STEPS PASSED ($($stopwatch.Elapsed.TotalSeconds.ToString('0'))s)" -ForegroundColor Green
    exit 0
}
