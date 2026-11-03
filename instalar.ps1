# Soma Agente: installs the latest version from PowerShell, for when the
# browser download is blocked or the antivirus removes the installer.
#   irm https://raw.githubusercontent.com/alanomoxo/soma-agente/main/instalar.ps1 | iex
# Downloads Soma-Agente-Instalador.exe from the latest GitHub Release, checks
# it against the published SHA-256 and opens it.
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$pt = (Get-UICulture).Name -like 'pt*'
function Say($pt_text, $en_text) { if ($pt) { Write-Host "  $pt_text" } else { Write-Host "  $en_text" } }

Write-Host ''
Write-Host '  SOMA. Agente' -ForegroundColor Magenta
Write-Host ''
try {
    $release = Invoke-RestMethod 'https://api.github.com/repos/alanomoxo/soma-agente/releases/latest' -Headers @{ 'User-Agent' = 'SomaAgente-Install' }
    $exe = $release.assets | Where-Object { $_.name -eq 'Soma-Agente-Instalador.exe' }
    $sum = $release.assets | Where-Object { $_.name -eq 'Soma-Agente-Instalador.exe.sha256' }
    if (-not $exe -or -not $sum) { throw 'The latest release has no Windows installer.' }

    $folder = Join-Path $env:LOCALAPPDATA 'Soma Agente\download'
    New-Item -ItemType Directory -Force $folder | Out-Null
    $path = Join-Path $folder ('Soma-Agente-Instalador-' + $release.tag_name.TrimStart('v') + '.exe')
    $sumPath = $path + '.sha256'
    Say "Baixando o Soma Agente $($release.tag_name)..." "Downloading Soma Agente $($release.tag_name)..."
    Invoke-WebRequest $exe.browser_download_url -OutFile $path -UseBasicParsing
    Invoke-WebRequest $sum.browser_download_url -OutFile $sumPath -UseBasicParsing

    $expected = ((Get-Content $sumPath -Raw).Trim() -split '\s+')[0].TrimStart('*').ToLower()
    $actual = (Get-FileHash $path -Algorithm SHA256).Hash.ToLower()
    if ($actual -ne $expected) {
        Remove-Item $path, $sumPath -Force
        throw 'The download does not match the published SHA-256.'
    }
    Say 'Arquivo conferido (SHA-256 igual ao publicado no GitHub).' 'File checked (SHA-256 matches the one published on GitHub).'
    Say 'Abrindo o instalador...' 'Opening the installer...'
    Start-Process $path
    Start-Sleep -Seconds 6
    if (-not (Test-Path $path)) {
        Write-Host ''
        Say 'O antivírus removeu o instalador (falso positivo). Para liberar:' 'The antivirus removed the installer (a false positive). To allow it:'
        Say 'Segurança do Windows > Proteção contra vírus e ameaças > Histórico de proteção >' 'Windows Security > Virus & threat protection > Protection history >'
        Say 'clique no item do Soma > Ações > Restaurar (ou Permitir no dispositivo).' 'click the Soma item > Actions > Restore (or Allow on device).'
        Say 'Depois rode este comando de novo.' 'Then run this command again.'
    } else {
        Say 'Pronto: siga a janela do instalador.' 'Done: follow the installer window.'
    }
} catch {
    Write-Host ''
    Say "Não deu para instalar: $($_.Exception.Message)" "Could not install: $($_.Exception.Message)"
    Say 'Baixe pelo navegador em github.com/alanomoxo/soma-agente/releases' 'Download it from github.com/alanomoxo/soma-agente/releases'
}
Write-Host ''
