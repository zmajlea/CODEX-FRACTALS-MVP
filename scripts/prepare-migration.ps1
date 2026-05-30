# Copies the initial migration SQL to clipboard and opens the Supabase SQL Editor.
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$sqlPath = Join-Path $root "supabase\migrations\20260530000000_initial_schema.sql"
$editorUrl = "https://supabase.com/dashboard/project/tswdwmtrirdhtwqmsasz/sql/new"

if (-not (Test-Path $sqlPath)) {
  Write-Error "Migration not found: $sqlPath"
}

Get-Content -Raw $sqlPath | Set-Clipboard
Write-Host ""
Write-Host "=== MIGRATION READY IN CLIPBOARD ===" -ForegroundColor Green
Write-Host "File: $sqlPath"
Write-Host ""
Write-Host "1. In Supabase SQL Editor (signed in), click inside the query editor"
Write-Host "2. Press Ctrl+V to paste"
Write-Host "3. Press Ctrl+Enter (or click Run)"
Write-Host "4. Wait for Success, then run: npm run db:verify"
Write-Host ""
Start-Process $editorUrl
