$ErrorActionPreference = 'Stop'
if (Get-Process -Name AfterFX -ErrorAction SilentlyContinue) { throw 'Feche o After Effects antes de instalar.' }
$source = Split-Path $PSScriptRoot -Parent
$target = Join-Path $env:APPDATA 'Adobe\CEP\extensions\com.framepilot.aeagent'
$backupRoot = Join-Path $env:APPDATA 'Adobe\CEP\extension-backups'
$data = Join-Path $env:APPDATA 'AE Agent'

# Claude Code: the panel finds it on its own (Claude desktop app or standalone CLI).
$claude = @()
if ($env:CLAUDE_BIN) { $claude += $env:CLAUDE_BIN }
$claude += Join-Path $env:USERPROFILE '.local\bin\claude.exe'
foreach ($root in @((Join-Path $env:APPDATA 'Claude\claude-code'), (Join-Path $env:LOCALAPPDATA 'Claude-Data'), (Join-Path $env:LOCALAPPDATA 'Packages'))) {
    if (Test-Path $root) { $claude += Get-ChildItem $root -Recurse -Filter claude.exe -File -Depth 5 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty FullName }
}
$found = $claude | Where-Object { $_ -and (Test-Path -LiteralPath $_ -PathType Leaf) } | Select-Object -First 1
if ($found) { Write-Host "Claude Code encontrado: $found" }
else { Write-Warning 'Claude Code nao foi encontrado. Para usar o Claude, instale o app Claude desktop (claude.ai/download); para o ChatGPT, o app Codex (chatgpt.com/codex).' }

Write-Host 'Este painel nao e assinado. A instalacao habilita extensoes de desenvolvimento no CEP 12 para este usuario.'
if ((Read-Host 'Digite INSTALAR para continuar') -cne 'INSTALAR') { throw 'Instalacao cancelada.' }
New-Item -ItemType Directory -Force -Path (Split-Path $target), $backupRoot, $data | Out-Null
$stage = "$target.staging-$([Guid]::NewGuid().ToString('N'))"
Copy-Item -LiteralPath $source -Destination $stage -Recurse
$backup = $null
try {
    if (Test-Path $target) {
        $backup = Join-Path $backupRoot ('com.framepilot.aeagent-' + (Get-Date -Format 'yyyyMMdd-HHmmss-fff'))
        Move-Item -LiteralPath $target -Destination $backup
    }
    Move-Item -LiteralPath $stage -Destination $target
} catch {
    if ($backup -and !(Test-Path $target)) { Move-Item -LiteralPath $backup -Destination $target }
    throw
}
$registry = 'HKCU:\Software\Adobe\CSXS.12'
New-Item -Path $registry -Force | Out-Null
$previous = (Get-ItemProperty $registry -Name PlayerDebugMode -ErrorAction SilentlyContinue).PlayerDebugMode
$record = Join-Path $data 'cep-debug-before-install.txt'
if (!(Test-Path $record)) { [IO.File]::WriteAllText($record, $(if ($null -eq $previous) { 'ABSENT' } else { [string]$previous })) }
New-ItemProperty -Path $registry -Name PlayerDebugMode -PropertyType String -Value '1' -Force | Out-Null
Write-Host "Instalado: $target"
if ($backup) { Write-Host "Backup: $backup" }
Write-Host 'Abra o After Effects > Window > Extensions > Soma Agente. Na engrenagem, conecte sua conta (Claude ou ChatGPT).'
