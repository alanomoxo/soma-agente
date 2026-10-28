# Soma Agente

**Agente de IA de código aberto para quem cria.** Converse em português (ou em qualquer idioma) e o Soma trabalha direto dentro do seu programa: After Effects, Photoshop, Illustrator, Premiere Pro, Blender, Cinema 4D, Figma e Cavalry.

O projeto é livre e feito para ajudar a comunidade de motion design, 3D e design: use, estude, adapte e contribua.

> **English:** Soma Agente is an open-source AI agent for creative apps (After Effects, Photoshop, Illustrator, Premiere Pro, Blender, Cinema 4D, Figma, Cavalry). You chat with Claude, ChatGPT or Antigravity using your own account, and it inspects the open document, makes the change and checks the result. MIT licensed, community-driven.

## O que ele faz

- **Trabalha dentro do programa:** cria e edita camadas, formas, textos, keyframes, materiais, clipes na timeline, frames no Figma, e confere o resultado olhando uma prévia em imagem.
- **Você escolhe a IA:** Claude (Claude Code), ChatGPT (Codex) ou Antigravity (CLI `agy`), sempre com a **sua** conta. Nenhuma chave de API é guardada pelo Soma.
- **Voz, imagens, vídeos e referências:** grave o pedido no microfone (transcrição local com whisper.cpp), anexe imagens e vídeos de referência.
- **Eases precisos** no After Effects (cubic-bezier, presets Expo, Back, etc.).
- **Skills e conectores:** ensine fluxos ao agente com skills (`SKILL.md`) e ligue outros serviços por MCP (Notion, Google Drive, bancos de dados, ferramentas locais). O próprio agente pode criar skills, instalar skills do GitHub e cadastrar conectores, e tudo vale para todos os programas.
- **Soma Hub + Antigravity:** um servidor MCP local que deixa o Antigravity comandar todos os programas abertos de uma vez (por exemplo: renderizar no Blender, montar no Photoshop e animar no After Effects).
- **Português e inglês:** instalador e plugins nos dois idiomas. Troque no instalador (English/Português), no painel Adobe (Configurações > Aparência) ou no seletor de idioma do Blender, Cinema 4D e Figma; a escolha vale para todos.
- **Atualização automática:** o Soma Hub verifica as [Releases](../../releases) deste repositório e instala as versões novas sozinho.

## Instalar

### Windows
1. Baixe `Soma-Agente-Instalador.exe` na [última Release](../../releases/latest).
2. Abra o arquivo. Se aparecer a tela azul **"O Windows protegeu o computador"**, veja logo abaixo: é normal.
3. Marque os programas e clique em **Instalar**. Não precisa ser administrador. Na primeira instalação é preciso internet: o instalador baixa o Python oficial do python.org (cerca de 11 MB, com SHA-256 conferido) para o Soma Hub.

### A tela "O Windows protegeu o computador" é normal

Ao abrir o instalador, o Windows pode mostrar esta tela azul do Microsoft Defender SmartScreen:

> **O Windows protegeu o computador**
> O Microsoft Defender SmartScreen impediu que um aplicativo não reconhecido fosse iniciado.

**Ela não quer dizer que foi encontrado um vírus.** O SmartScreen mostra esse aviso para todo programa novo que ainda não tem assinatura digital paga nem muitos downloads registrados na Microsoft. É o caso do Soma Agente: um projeto gratuito e de código aberto, publicado por uma pessoa, não por uma empresa. Conforme mais gente baixar, o aviso tende a sumir.

Para continuar:

1. Clique em **Mais informações** (o link embaixo do texto).
2. Confira que aparece *Aplicativo: Soma-Agente-Instalador.exe*.
3. Clique em **Executar assim mesmo**.

Pode seguir sem medo, desde que você tenha baixado o arquivo **desta página de Releases**. Todo o código está aberto neste repositório, o instalador é compilado só a partir dele e não pede permissão de administrador. Baixe sempre daqui, nunca de sites de terceiros.

**Quer ter certeza de que o arquivo é o oficial?** O navegador pode mostrar avisos parecidos ("arquivo pouco baixado") e alguns antivírus dão alertas genéricos em programas novos sem assinatura. Para conferir, compare o SHA-256 (no PowerShell, na pasta onde está o arquivo):

```powershell
Get-FileHash .\Soma-Agente-Instalador.exe -Algorithm SHA256
```

O resultado deve ser igual ao do arquivo `Soma-Agente-Instalador.exe.sha256` da mesma Release. Se o seu antivírus bloquear o arquivo, abra uma *issue* informando o nome do antivírus e da detecção para enviarmos como falso positivo.

Onde abrir depois:

| Programa | Onde |
|---|---|
| After Effects, Photoshop, Illustrator, Premiere Pro | Window > Extensions > Soma Agente |
| Blender (4.2+) | 3D View > barra lateral (N) > aba **Soma** |
| Cinema 4D (2024+) | Extensions > Soma Agente |
| Figma (app desktop) | Plugins > Development > Import plugin from manifest (uma vez) |
| Cavalry | menu **Scripts > Soma Agente** |
| Antigravity | servidor MCP **soma**, configurado pelo instalador |

Passo a passo completo: [`installer/COMO-INSTALAR.txt`](installer/COMO-INSTALAR.txt).

### Mac
Baixe `Soma-Agente-Mac.zip` na Release. O painel Adobe tem instalador (`Instalar-macOS.command`); Blender, Cinema 4D e Figma são copiados à mão (instruções no zip).

## Atualizações automáticas

O instalador coloca o **Soma Hub**, que inicia com o Windows. A cada poucas horas ele lê a última Release deste repositório e, se houver versão nova:

1. baixa `Soma-Agente-Instalador.exe` e confere o SHA-256 publicado em `Soma-Agente-Instalador.exe.sha256` (se não bater, não instala);
2. espera os programas Adobe fecharem (o painel avisa) e roda o instalador em modo `/silent /update`, atualizando só o que já está instalado;
3. guarda a versão anterior em backup.

Cada programa também confere o GitHub ao abrir e mostra **Atualizar agora** quando há versão nova; dá para verificar na hora em *Verificar atualizações* ou perguntando no chat ("tem atualização?").

Para desligar a instalação automática: crie o arquivo `%APPDATA%\AE Agent\auto-update-off.txt`.

## Skills e conectores

- **Skills** ficam em `%APPDATA%\AE Agent\skills\<nome>\SKILL.md`, no formato aberto de Agent Skills (front matter com `name` e `description`, depois as instruções). O agente vê a lista e lê a skill quando o pedido combinar. Peça "crie uma skill com minhas convenções de nomes" ou "instale a skill https://github.com/…/tree/main/skills/…".
- **Conectores** são servidores MCP (`command` + `args` para stdio, ou `url` + `headers` para HTTP), em `%APPDATA%\AE Agent\connectors.json`. Funcionam com Claude, ChatGPT (Codex) e Antigravity.
- **Segurança:** conectores executam programas no seu PC. Os que o agente cadastrar, e as skills baixadas da internet, ficam pendentes até você aprovar no painel (aba **Skills** ou a barra de aprovação no chat; no Cinema 4D aparece uma pergunta; no Blender, um quadro no painel).

## Como funciona

```
Programa (painel / add-on / plugin) ──MCP local──► Claude Code · Codex · agy
        ▲                                          (sua conta, no seu PC)
        └──── Soma Hub (127.0.0.1:47821) ◄── Antigravity (todos os apps)
```

- **adobe/** – painel CEP único para AE, PS, AI e PPro. `js/hosts/*.js` define ferramentas e instruções de cada programa; `jsx/hosts/*.jsx` executa no ExtendScript.
- **python/soma_core/** – núcleo compartilhado (Blender, Cinema 4D, Hub): encontra as CLIs, roda as conversas e serve as ferramentas por MCP.
- **blender/**, **cinema4d/** – add-on e plugin com as ferramentas de cada programa.
- **figma/** – plugin (`plugin/`) e Soma Hub (`hub/`), que também faz a ponte do Figma.
- **installer/** – instalador do Windows (C#, .NET Framework 4.8, sem dependências).

## Compilar e publicar

```powershell
# gerar o instalador em dist\
powershell -ExecutionPolicy Bypass -File tools\build.ps1

# publicar uma versão (muda a versão, compila, cria a tag e a Release no GitHub)
powershell -ExecutionPolicy Bypass -File tools\release.ps1 -Version 1.5.1 -Notes "O que mudou"
```

Todo Soma Hub instalado recebe a Release nova automaticamente.

Assinatura digital (opcional): com um certificado de assinatura de código, defina `SOMA_SIGN_THUMBPRINT` (certificado no repositório do Windows, token ou nuvem) ou `SOMA_SIGN_PFX` e `SOMA_SIGN_PFX_PASSWORD` antes de compilar. O `build.ps1` assina o instalador com `signtool` (Windows SDK) e carimbo de tempo antes de gerar o SHA-256.

Com o certificado Certum Open Source (cartão + leitor): conecte o leitor com o cartão, abra o proCertum CardManager e pegue a impressão digital do certificado:

```powershell
Get-ChildItem Cert:\CurrentUser\My -CodeSigningCert | Select-Object Subject, Thumbprint, NotAfter
$env:SOMA_SIGN_THUMBPRINT = "<Thumbprint>"
powershell -ExecutionPolicy Bypass -File tools\build.ps1
```

O PIN do cartão é pedido na hora de assinar.

## Contribuir

Contribuições são bem-vindas: novas ferramentas para algum programa, correções, traduções, suporte a outras IAs ou programas.

1. Abra uma *issue* descrevendo a ideia ou o problema.
2. Faça um fork, crie um branch e envie um *pull request*.
3. Mantenha o estilo do código ao redor e teste no programa de verdade quando possível.

## Privacidade e segurança

- O Soma roda no seu computador e usa as CLIs oficiais da IA escolhida com o seu login; seus arquivos não passam por servidores do Soma.
- Os servidores MCP locais escutam só em `127.0.0.1` e exigem token; o Hub recusa pedidos vindos de páginas web.
- O Antigravity recebe permissão automática apenas para as três ferramentas do Hub.

## Licença

[MIT](LICENSE) — livre para usar, modificar e distribuir.
