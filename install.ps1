# Nerveplane installer for Windows (no Bun required).
#   irm https://raw.githubusercontent.com/sumanyumuku98/Nerveplane/main/install.ps1 | iex
$ErrorActionPreference = "Stop"

$repo = "sumanyumuku98/Nerveplane"
$asset = "nerveplane-windows-x64.exe"
$dest = if ($env:NERVEPLANE_BIN_DIR) { $env:NERVEPLANE_BIN_DIR } else { Join-Path $env:LOCALAPPDATA "Nerveplane" }
$url = "https://github.com/$repo/releases/latest/download/$asset"

New-Item -ItemType Directory -Force -Path $dest | Out-Null
$out = Join-Path $dest "nerveplane.exe"
Write-Host "Downloading $asset..."
Invoke-WebRequest -Uri $url -OutFile $out

# Add to the user PATH if missing.
$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ($userPath -notlike "*$dest*") {
  [Environment]::SetEnvironmentVariable("Path", "$userPath;$dest", "User")
  Write-Host "Added $dest to your PATH (restart your shell to pick it up)."
}

Write-Host "Installed nerveplane -> $out"
& $out --version
Write-Host "Next: nerveplane daemon  .  nerveplane init  .  nerveplane install claude-code"
