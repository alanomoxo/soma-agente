# Publishes a new version: bumps the version everywhere, builds, commits, tags,
# pushes and creates the GitHub Release with the installer and its SHA-256.
# Every installed Soma Hub picks it up within a few hours and updates itself.
#   powershell -ExecutionPolicy Bypass -File tools\release.ps1 -Version 1.5.1 -Notes "What changed"
# Needs git and the GitHub CLI (gh) signed in to the repository owner.
param(
    [Parameter(Mandatory = $true)][string]$Version,
    [string]$Notes = ""
)
$ErrorActionPreference = 'Stop'
if ($Version -notmatch '^\d+\.\d+\.\d+$') { throw "Use a version like 1.5.1" }
$root = Split-Path $PSScriptRoot -Parent
Set-Location $root

function Set-Version($file, $pattern, $replacement) {
    $path = Join-Path $root $file
    $text = [IO.File]::ReadAllText($path)
    $new = [regex]::Replace($text, $pattern, $replacement)
    if ($new -eq $text) { throw "Version not found in $file ($pattern)" }
    [IO.File]::WriteAllText($path, $new, (New-Object Text.UTF8Encoding $false))
}

$parts = $Version.Split('.')
Set-Version "adobe\CSXS\manifest.xml" 'ExtensionBundleVersion="[\d.]+"' "ExtensionBundleVersion=""$Version"""
Set-Version "adobe\CSXS\manifest.xml" '(<Extension Id="[^"]+" Version=")[\d.]+"' "`${1}$Version"""
Set-Version "adobe\index.html" 'v\d+\.\d+\.\d+</span>' "v$Version</span>"
Set-Version "adobe\js\app.js" 'title: "Soma Agente", version: "[\d.]+"' "title: ""Soma Agente"", version: ""$Version"""
Set-Version "python\soma_core\agent.py" 'VERSION = "[\d.]+"' "VERSION = ""$Version"""
Set-Version "blender\soma_agente\__init__.py" '"version": \(\d+, \d+, \d+\)' """version"": ($($parts[0]), $($parts[1]), $($parts[2]))"
Set-Version "installer\Setup.cs" 'public const string Version = "[\d.]+";' "public const string Version = ""$Version"";"
Set-Version "installer\Setup.cs" 'AssemblyVersion\("[\d.]+"\)' "AssemblyVersion(""$Version.0"")"
Set-Version "installer\Setup.cs" 'AssemblyFileVersion\("[\d.]+"\)' "AssemblyFileVersion(""$Version.0"")"
Set-Version "installer\app.manifest" 'assemblyIdentity version="[\d.]+"' "assemblyIdentity version=""$Version.0"""
Set-Version "installer\COMO-INSTALAR.txt" 'SOMA AGENTE \d+\.\d+\.\d+' "SOMA AGENTE $Version"

& (Join-Path $PSScriptRoot "build.ps1")

git add -A
git commit -m "Release v$Version"
git tag "v$Version"
git push origin HEAD --tags

if (-not $Notes) { $Notes = "Soma Agente $Version" }
$dist = Join-Path $root "dist"
gh release create "v$Version" `
    (Join-Path $dist "Soma-Agente-Instalador.exe") (Join-Path $dist "Soma-Agente-Instalador.exe.sha256") (Join-Path $dist "Soma-Agente-Mac.zip") `
    --title "Soma Agente $Version" --notes $Notes
Write-Host "Published v$Version. Installed Soma Hubs update within a few hours."
