# Builds the Windows installer (and the Mac bundle) from the sources.
#   powershell -ExecutionPolicy Bypass -File tools\build.ps1
# Output in dist\: Soma-Agente-Instalador.exe, its .sha256, Soma-Agente-Mac.zip,
# COMO-INSTALAR.txt. Needs only Windows (.NET Framework 4.8 csc) and internet
# the first time (official Python embeddable package for the Soma Hub).
param([string]$Out = "dist")
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem

$root = Split-Path $PSScriptRoot -Parent
$out = Join-Path $root $Out
$work = Join-Path $root "build-cache"
$stage = Join-Path $work "stage"
New-Item -ItemType Directory -Force $work, $out | Out-Null
if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
New-Item -ItemType Directory $stage | Out-Null

function Copy-Core($destination) {
    Copy-Item (Join-Path $root "python\soma_core") (Join-Path $destination "soma_core") -Recurse
    Get-ChildItem $destination -Recurse -Directory -Filter __pycache__ | Remove-Item -Recurse -Force
}

# Blender add-on and Cinema 4D plugin each carry their own copy of soma_core.
Copy-Item (Join-Path $root "blender\soma_agente") (Join-Path $stage "blender") -Recurse
Copy-Core (Join-Path $stage "blender")
Copy-Item (Join-Path $root "cinema4d\soma_agente") (Join-Path $stage "c4d") -Recurse
Copy-Core (Join-Path $stage "c4d")

# Figma plugin (logo inlined into the UI) + Soma Hub.
$figma = Join-Path $stage "figma"
New-Item -ItemType Directory (Join-Path $figma "plugin"), (Join-Path $figma "bridge") | Out-Null
Copy-Item (Join-Path $root "figma\plugin\code.js"), (Join-Path $root "figma\plugin\manifest.json") (Join-Path $figma "plugin")
$svg = [IO.File]::ReadAllText((Join-Path $root "adobe\img\soma-mark.svg"))
$inner = $svg.Substring($svg.IndexOf('>') + 1); $inner = $inner.Substring(0, $inner.LastIndexOf('</svg>'))
$ui = [IO.File]::ReadAllText((Join-Path $root "figma\plugin\ui.src.html")).Replace('{{MARK_JS}}', $inner.Replace("'", "\'")).Replace('{{MARK}}', $inner)
[IO.File]::WriteAllText((Join-Path $figma "plugin\ui.html"), $ui, (New-Object Text.UTF8Encoding $false))
Copy-Item (Join-Path $root "figma\hub\*.py") (Join-Path $figma "bridge")
Copy-Core (Join-Path $figma "bridge")

function New-Zip($zipPath, $source, $prefix) {
    if (Test-Path $zipPath) { Remove-Item $zipPath }
    $zip = [IO.Compression.ZipFile]::Open($zipPath, 'Create')
    $base = (Resolve-Path $source).Path.TrimEnd('\')
    Get-ChildItem $base -Recurse -File | Where-Object { $_.Name -notin '.debug', '.enabled-once' } | ForEach-Object {
        $name = $prefix + $_.FullName.Substring($base.Length + 1).Replace('\', '/')
        $entry = [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $_.FullName, $name, 'Optimal')
        $mode = if ($name -match '\.(command|sh)$') { 0x81ED } else { 0x81A4 }
        $entry.ExternalAttributes = $mode -shl 16
    }
    $zip.Dispose()
}

New-Zip (Join-Path $work "cep.zip") (Join-Path $root "adobe") ""
New-Zip (Join-Path $work "blender.zip") (Join-Path $stage "blender") ""
New-Zip (Join-Path $work "c4d.zip") (Join-Path $stage "c4d") ""
New-Zip (Join-Path $work "figma.zip") $figma ""

# Icon with PNG entries (16, 32, 48, 256).
$art = Join-Path $root "installer\art"
$sizes = 16, 32, 48, 256
$images = $sizes | ForEach-Object { , [IO.File]::ReadAllBytes((Join-Path $art "icon$_.png")) }
$ico = New-Object IO.MemoryStream; $w = New-Object IO.BinaryWriter $ico
$w.Write([UInt16]0); $w.Write([UInt16]1); $w.Write([UInt16]$sizes.Count)
$offset = 6 + 16 * $sizes.Count
for ($i = 0; $i -lt $sizes.Count; $i++) {
    $s = $sizes[$i] % 256
    $w.Write([byte]$s); $w.Write([byte]$s); $w.Write([byte]0); $w.Write([byte]0); $w.Write([UInt16]1); $w.Write([UInt16]32)
    $w.Write([UInt32]$images[$i].Length); $w.Write([UInt32]$offset); $offset += $images[$i].Length
}
foreach ($image in $images) { $w.Write($image) }
$w.Flush(); [IO.File]::WriteAllBytes((Join-Path $work "soma.ico"), $ico.ToArray())

$fx = Join-Path $env:WINDIR "Microsoft.NET\Framework64\v4.0.30319"
$exe = Join-Path $out "Soma-Agente-Instalador.exe"
& (Join-Path $fx "csc.exe") /nologo /target:winexe /optimize+ /codepage:65001 "/out:$exe" "/win32icon:$(Join-Path $work 'soma.ico')" "/win32manifest:$(Join-Path $root 'installer\app.manifest')" `
    "/resource:$(Join-Path $work 'cep.zip'),cep.zip" "/resource:$(Join-Path $work 'blender.zip'),blender.zip" "/resource:$(Join-Path $work 'c4d.zip'),c4d.zip" `
    "/resource:$(Join-Path $work 'figma.zip'),figma.zip" "/resource:$(Join-Path $root 'cavalry\Soma Agente.js'),cavalry.js" `
    "/resource:$(Join-Path $art 'wordmark.png'),wordmark.png" "/resource:$(Join-Path $art 'mark.png'),mark.png" `
    /reference:System.Windows.Forms.dll /reference:System.Drawing.dll "/reference:$fx\System.IO.Compression.dll" "/reference:$fx\System.IO.Compression.FileSystem.dll" "/reference:$fx\System.Web.Extensions.dll" `
    (Join-Path $root "installer\Setup.cs")
if ($LASTEXITCODE -ne 0) { throw "csc failed" }

# Code signing (optional, before hashing). Unsigned builds still work, but
# SmartScreen and antivirus heuristics trust signed files far more.
#   SOMA_SIGN_THUMBPRINT  certificate in the user store (token / cloud HSM)
#   SOMA_SIGN_PFX + SOMA_SIGN_PFX_PASSWORD  certificate file
#   SOMA_SIGNTOOL  signtool.exe path (default: newest Windows SDK)
if ($env:SOMA_SIGN_THUMBPRINT -or $env:SOMA_SIGN_PFX) {
    $signtool = $env:SOMA_SIGNTOOL
    if (-not $signtool) {
        $signtool = Get-ChildItem "${env:ProgramFiles(x86)}\Windows Kits\10\bin\*\x64\signtool.exe" -ErrorAction SilentlyContinue |
            Sort-Object FullName -Descending | Select-Object -First 1 -ExpandProperty FullName
    }
    if (-not $signtool) { throw "signtool.exe not found: install the Windows SDK or set SOMA_SIGNTOOL" }
    $cert = if ($env:SOMA_SIGN_THUMBPRINT) { @("/sha1", $env:SOMA_SIGN_THUMBPRINT) } else { @("/f", $env:SOMA_SIGN_PFX, "/p", $env:SOMA_SIGN_PFX_PASSWORD) }
    & $signtool sign @cert /fd SHA256 /tr "http://timestamp.digicert.com" /td SHA256 /d "Soma Agente" /du "https://github.com/alanomoxo/soma-agente" $exe
    if ($LASTEXITCODE -ne 0) { throw "signtool failed" }
}

# The Soma Hub only installs an update whose SHA-256 matches this file.
$hash = (Get-FileHash $exe -Algorithm SHA256).Hash.ToLower()
[IO.File]::WriteAllText("$exe.sha256", "$hash  Soma-Agente-Instalador.exe`n")

# Mac bundle: Adobe panel (with its installer script), Blender, Cinema 4D, Figma.
$mac = Join-Path $stage "mac"
New-Item -ItemType Directory (Join-Path $mac "Blender"), (Join-Path $mac "Cinema 4D") | Out-Null
Copy-Item (Join-Path $root "adobe") (Join-Path $mac "Soma Agente") -Recurse
Copy-Item (Join-Path $stage "blender") (Join-Path $mac "Blender\soma_agente") -Recurse
Copy-Item (Join-Path $stage "c4d") (Join-Path $mac "Cinema 4D\soma_agente") -Recurse
New-Item -ItemType Directory (Join-Path $mac "Cavalry") | Out-Null
Copy-Item (Join-Path $root "cavalry\Soma Agente.js") (Join-Path $mac "Cavalry")
Copy-Item $figma (Join-Path $mac "Figma") -Recurse
$macZip = Join-Path $out "Soma-Agente-Mac.zip"
New-Zip $macZip $mac ""
# Mark entries as made on Unix so macOS keeps the scripts executable.
$bytes = [IO.File]::ReadAllBytes($macZip)
for ($i = $bytes.Length - 22; $i -ge 0; $i--) { if ([BitConverter]::ToUInt32($bytes, $i) -eq 0x06054b50) { $eocd = $i; break } }
$count = [BitConverter]::ToUInt16($bytes, $eocd + 10); $p = [int][BitConverter]::ToUInt32($bytes, $eocd + 16)
for ($k = 0; $k -lt $count; $k++) {
    $bytes[$p + 4] = 30; $bytes[$p + 5] = 3
    $p += 46 + [BitConverter]::ToUInt16($bytes, $p + 28) + [BitConverter]::ToUInt16($bytes, $p + 30) + [BitConverter]::ToUInt16($bytes, $p + 32)
}
[IO.File]::WriteAllBytes($macZip, $bytes)

Copy-Item (Join-Path $root "installer\COMO-INSTALAR.txt") $out
Get-ChildItem $out | Select-Object Name, Length
