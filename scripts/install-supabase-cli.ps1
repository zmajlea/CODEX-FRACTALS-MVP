# Ensures Supabase CLI binary is present on Windows (fixes missing supabase-go.exe).
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $root

$binDir = Join-Path $root "node_modules\@supabase\cli-windows-x64\bin"
$goBin = Join-Path $binDir "supabase-go.exe"

if (Test-Path $goBin) {
  Write-Host "Supabase CLI OK:" $goBin
  & (Join-Path $root "node_modules\.bin\supabase.cmd") --version
  exit 0
}

Write-Host "Supabase Windows binary missing — reinstalling..."
Remove-Item -Recurse -Force (Join-Path $root "node_modules\@supabase\cli-windows-x64") -ErrorAction SilentlyContinue
npm install @supabase/cli-windows-x64@2.102.0 --no-save

if (-not (Test-Path $goBin)) {
  Write-Host ""
  Write-Host "npm optional binary still missing. Try global install:"
  Write-Host "  npm install -g supabase"
  Write-Host "  supabase login"
  exit 1
}

Write-Host "Supabase CLI installed."
& (Join-Path $root "node_modules\.bin\supabase.cmd") --version
