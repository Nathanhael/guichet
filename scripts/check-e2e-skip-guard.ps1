# E2E skip-guard - fails CI if any `test.skip(...)` in testing/e2e/*.spec.ts
# is NOT an explicit env-flag opt-in (Bundle D, RFC #82).
#
# Allowed:
#   test.skip(!process.env.E2E_INCLUDE_SLA_LIFECYCLE, '...')
#   test.skip(!process.env.E2E_CHAT_DEMO, '...')
#   test.skip(!process.env.E2E_INCLUDE_QUEUE_LANG_AWARENESS, '...')
#
# Banned (the silent-failure pattern this whole bundle eliminated):
#   test.skip(!loginOk, '...')           # fixture-state predicate
#   test.skip(!hasTicket, '...')         # fixture-state predicate
#   test.skip(true, '...')               # inline always-skip
#   test.skip(condition, '...')          # any other predicate without process.env
#
# Use `test.fixme(...)` (Playwright's known-broken annotation) for tests that
# need a follow-up rewrite - the guard only checks `test.skip` calls, so
# fixme is allowed by construction.
#
# Multi-line test.skip( calls are handled: we walk each `test.skip(` open and
# scan forward through the file content until the matching close-paren, then
# check the entire span for `process.env`.

$ErrorActionPreference = 'Stop'

$specFiles = Get-ChildItem -Path 'testing/e2e' -Filter '*.spec.ts' -File

if (-not $specFiles) {
    Write-Host "e2e-skip-guard: clean (no spec files found)"
    exit 0
}

$bannedHits = @()
$allowedCount = 0

foreach ($file in $specFiles) {
    $content = Get-Content -Path $file.FullName -Raw
    if (-not $content) { continue }

    # Walk the file: find each `test.skip(` and span forward to the matching ).
    $idx = 0
    while ($true) {
        $start = $content.IndexOf('test.skip(', $idx)
        if ($start -lt 0) { break }

        # Skip if this `test.skip(` is preceded by a comment marker on the same
        # line (`//` or `*`) - the regex match in slice 1's wiki page snippet,
        # for example, isn't a real call.
        $lineStart = $content.LastIndexOf("`n", $start)
        if ($lineStart -lt 0) { $lineStart = 0 }
        $linePrefix = $content.Substring($lineStart, $start - $lineStart)
        if ($linePrefix -match '^\s*(//|\*)') {
            $idx = $start + 10
            continue
        }

        # Walk forward to the matching close-paren, accounting for nesting.
        $depth = 1
        $i = $start + 'test.skip('.Length
        while ($i -lt $content.Length -and $depth -gt 0) {
            $ch = $content[$i]
            if ($ch -eq '(') { $depth++ }
            elseif ($ch -eq ')') { $depth-- }
            $i++
        }

        $span = $content.Substring($start, $i - $start)

        if ($span -match 'process\.env') {
            $allowedCount++
        } else {
            # Compute line number for the banned hit.
            $lineNumber = ($content.Substring(0, $start) -split "`n").Count
            $relPath = $file.FullName -replace [regex]::Escape((Resolve-Path .).Path + [System.IO.Path]::DirectorySeparatorChar), ''
            $firstLine = ($span -split "`r?`n")[0].Trim()
            $bannedHits += [PSCustomObject]@{
                Path = $relPath
                Line = $lineNumber
                Snippet = $firstLine
            }
        }

        $idx = $i
    }
}

if ($bannedHits.Count -gt 0) {
    Write-Host ""
    Write-Host "e2e-skip-guard: FAIL - $($bannedHits.Count) banned test.skip call(s) found:" -ForegroundColor Red
    foreach ($h in $bannedHits) {
        Write-Host "  $($h.Path):$($h.Line): $($h.Snippet)" -ForegroundColor Red
    }
    Write-Host ""
    Write-Host "Bundle D / RFC #82: only env-flag opt-ins of the form" -ForegroundColor Yellow
    Write-Host "  test.skip(!process.env.X, '...')" -ForegroundColor Yellow
    Write-Host "are allowed in testing/e2e/. Use:" -ForegroundColor Yellow
    Write-Host "  - throw new Error(...)        for fixture/login pre-conditions" -ForegroundColor Yellow
    Write-Host "  - test.fixme(...)             for known-broken tests pending follow-up" -ForegroundColor Yellow
    Write-Host "  - ticketFixture.create(...)   to stage state instead of skipping when missing" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Pattern doc: wiki/patterns/e2e-skip-as-silent-failure.md"
    exit 1
}

Write-Host "e2e-skip-guard: clean ($allowedCount env-flag opt-in(s) allowed; 0 banned)"
exit 0
