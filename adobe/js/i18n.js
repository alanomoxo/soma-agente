// Panel language: English (the source text) or Portuguese (Brazil).
// The choice is shared by every Soma program in <data folder>/language.txt
// ("pt" or "en"); without it the Adobe program's language decides.
// Fixed texts are translated from the PT table below, also when the panel
// writes them later (a MutationObserver watches the page). Chat messages are
// left alone. Texts built from variables use L(english, portuguese).
(function () {
  "use strict";

  function nodeRequire() {
    try { if (window.cep_node && typeof window.cep_node.require === "function") { return window.cep_node.require; } } catch (error) { /* browser */ }
    return typeof require === "function" ? require : null;
  }

  function languageFile() {
    var req = nodeRequire();
    if (!req) { return null; }
    try {
      var path = req("path"), os = req("os"), proc = req("process"), env = proc.env;
      var dir = proc.platform === "win32" ? path.join(env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "AE Agent") : path.join(os.homedir(), "Library", "Application Support", "AE Agent");
      return { fs: req("fs"), dir: dir, file: path.join(dir, "language.txt") };
    } catch (error) { return null; }
  }

  function hostLocale() {
    try { return JSON.parse(window.__adobe_cep__.getHostEnvironment()).appUILocale || ""; } catch (error) { return navigator.language || ""; }
  }

  function savedChoice() {
    var match = /[?&]lang=(pt|en)/.exec(window.location.search);
    if (match) { return match[1]; }
    var f = languageFile();
    try { var value = f && f.fs.existsSync(f.file) ? String(f.fs.readFileSync(f.file, "utf8")).trim().toLowerCase() : ""; return value === "pt" || value === "en" ? value : "auto"; } catch (error) { return "auto"; }
  }

  var choice = savedChoice();
  var lang = choice !== "auto" ? choice : (/^pt/i.test(hostLocale()) ? "pt" : "en");

  var PT = {
    // Header, chat and composer
    "New chat (pinned references are sent again)": "Nova conversa (as referências fixadas são enviadas de novo)",
    "New chat": "Nova conversa",
    "Revert the last Soma Agente run (mouse click only)": "Desfazer a última execução do Soma Agente (só com clique do mouse)",
    "Revert last run": "Desfazer a última execução",
    "Settings: connection, instructions, and appearance": "Configurações: conexão, instruções e aparência",
    "Settings": "Configurações",
    "Analyzing the request": "Analisando o pedido",
    "Inspecting the active composition before making changes.": "Inspecionando a composição ativa antes de mudar algo.",
    "What are we making?": "O que vamos criar?",
    "Message Soma Agente": "Mensagem para o Soma Agente",
    "Message": "Mensagem",
    "Choose a model": "Escolha um modelo",
    "Choose the AI": "Escolha a IA",
    "Use Claude (Claude Code on this computer)": "Usar o Claude (Claude Code neste computador)",
    "Use ChatGPT (Codex on this computer)": "Usar o ChatGPT (Codex neste computador)",
    "Use Antigravity (agy CLI on this computer)": "Usar o Antigravity (CLI agy neste computador)",
    "Model": "Modelo",
    "Reasoning": "Raciocínio",
    "References": "Referências",
    "Save images, videos, audio, or documents as references": "Salvar imagens, vídeos, áudios ou documentos como referências",
    "+ Add": "+ Adicionar",
    "Click a reference to attach it. Pinned references are sent automatically at the start of every new chat.": "Clique numa referência para anexá-la. As fixadas são enviadas sozinhas no começo de cada nova conversa.",
    "Ease curves": "Curvas de ease",
    "Ease": "Ease",
    "Apply now to the keyframes selected in the timeline (no AI request; undo with Ctrl+Z in After Effects)": "Aplicar agora nos keyframes selecionados na timeline (sem pedir à IA; desfaça com Ctrl+Z no After Effects)",
    "Apply to selected keys": "Aplicar nos keys selecionados",
    "Write a request for the agent in the message box": "Escrever um pedido para o agente na caixa de mensagem",
    "Ask the agent": "Pedir ao agente",
    "Attach images, videos, audio, or documents": "Anexar imagens, vídeos, áudios ou documentos",
    "Attach files": "Anexar arquivos",
    "Saved references": "Referências salvas",
    "Ease curves for keyframes": "Curvas de ease para keyframes",
    "Record a voice instruction (transcribed into the message box)": "Gravar um pedido por voz (transcrito na caixa de mensagem)",
    "Record a voice instruction": "Gravar um pedido por voz",
    "Stop recording": "Parar a gravação",
    "Choose the model and reasoning effort": "Escolher o modelo e o nível de raciocínio",
    "Loading models…": "Carregando modelos…",
    "Default model": "Modelo padrão",
    "Send": "Enviar",
    "Stop request": "Parar o pedido",
    "Stopping…": "Parando…",
    "Retry stop": "Tentar parar de novo",
    "Local bridge": "Ponte local",
    "Return to send · Shift+Return for a new line": "Enter para enviar · Shift+Enter para nova linha",
    "Attached reference": "Referência anexada",
    "Attach to the message": "Anexar à mensagem",
    "Reference name": "Nome da referência",
    "Note for the agent (e.g. match this typography)": "Nota para o agente (ex.: use esta tipografia)",
    "Note for the agent": "Nota para o agente",
    "Send automatically at the start of every new chat": "Enviar sozinho no começo de cada nova conversa",
    "Delete this reference and its saved copy": "Apagar esta referência e a cópia salva",
    "Saved in References": "Salva em Referências",
    "Save to References": "Salvar em Referências",
    // Models
    "The default model of your Claude account.": "O modelo padrão da sua conta Claude.",
    "Most capable; best for complex compositions.": "O mais capaz; melhor para composições complexas.",
    "Fast and capable for everyday edits.": "Rápido e capaz para o dia a dia.",
    "Fastest; for simple changes.": "O mais rápido; para mudanças simples.",
    "The default model of your ChatGPT account.": "O modelo padrão da sua conta ChatGPT.",
    "The model selected in Antigravity.": "O modelo escolhido no Antigravity.",
    "Claude (default)": "Claude (padrão)",
    "ChatGPT (default)": "ChatGPT (padrão)",
    "Antigravity (default)": "Antigravity (padrão)",
    // Progress
    "Stopping the request": "Parando o pedido",
    "Request stopped": "Pedido interrompido",
    "No further agent actions will run.": "O agente não vai executar mais nenhuma ação.",
    "The run stopped": "A execução parou",
    "Run complete": "Concluído",
    "See the result above for completed work and any verification limits.": "Veja acima o que foi feito e o que não pôde ser conferido.",
    "Preparing attachments": "Preparando os anexos",
    "Extracting video frames and transcribing audio before sending.": "Extraindo quadros dos vídeos e transcrevendo o áudio antes de enviar.",
    "Reading the attachments": "Lendo os anexos",
    "Building an inspection and verification plan for the active composition.": "Planejando como inspecionar e conferir o documento ativo.",
    "A step needs correction": "Uma etapa precisa de correção",
    "Reverting the last run": "Desfazendo a última execução",
    "Last run reverted": "Última execução desfeita",
    "The composition is back to the state before that agent run.": "O documento voltou ao estado de antes dessa execução.",
    "Revert stopped": "Desfazer interrompido",
    // Settings
    "Close settings": "Fechar configurações",
    "Settings sections": "Seções das configurações",
    "Connection and persistent instructions": "Conexão e instruções permanentes",
    "Agent": "Agente",
    "Voice transcription and video analysis": "Transcrição de voz e análise de vídeo",
    "Voice & video": "Voz e vídeo",
    "Skills and MCP connectors shared by every Soma program": "Skills e conectores MCP usados por todos os programas Soma",
    "Skills": "Skills",
    "Stored tools, previews, and exports": "Ferramentas salvas, prévias e exportações",
    "Tools": "Ferramentas",
    "Accent color and dock layout": "Cor de destaque, idioma e layout",
    "Appearance": "Aparência",
    "AI": "IA",
    "Choose which AI runs Soma Agente. All use your own account on this computer: Claude through Claude Code, ChatGPT through Codex, Antigravity through its CLI (agy). Switching starts a new chat.": "Escolha qual IA roda o Soma Agente. Todas usam a sua conta neste computador: o Claude pelo Claude Code, o ChatGPT pelo Codex e o Antigravity pela CLI (agy). Trocar começa uma nova conversa.",
    "Checking…": "Verificando…",
    "Connect or diagnose Claude": "Conectar ou diagnosticar o Claude",
    "Connection diagnosis": "Diagnóstico da conexão",
    "Checking the agents available on this computer…": "Verificando as IAs disponíveis neste computador…",
    "Check again": "Verificar de novo",
    "Copy report": "Copiar relatório",
    "Copied": "Copiado",
    "Updates": "Atualizações",
    "Soma Agente checks GitHub for new versions when it opens.": "O Soma Agente procura versões novas no GitHub quando abre.",
    "Check for updates": "Verificar atualizações",
    "Update now": "Atualizar agora",
    "Persistent instructions": "Instruções permanentes",
    "Your preferences are included with every request. Planning mode remains read-only.": "Suas preferências vão junto com todo pedido.",
    "Naming conventions, preferred frame rate, organization, workflow…": "Convenções de nomes, frame rate preferido, organização, fluxo de trabalho…",
    "Save instructions for future requests": "Salvar as instruções para os próximos pedidos",
    "Save instructions": "Salvar instruções",
    "Saved. New requests will use these instructions.": "Salvo. Os próximos pedidos vão usar estas instruções.",
    "Voice transcription": "Transcrição de voz",
    "The microphone button records your voice and writes the transcript into the message box so you can check it before sending. Attached audio files are transcribed the same way.": "O botão do microfone grava sua voz e escreve a transcrição na caixa de mensagem para você conferir antes de enviar. Áudios anexados são transcritos do mesmo jeito.",
    "Where speech is converted to text": "Onde a fala vira texto",
    "On this computer: whisper.cpp (free, offline)": "Neste computador: whisper.cpp (grátis, offline)",
    "OpenAI API (your API key)": "API da OpenAI (sua chave de API)",
    "Groq API (your API key)": "API da Groq (sua chave de API)",
    "Spoken language": "Idioma falado",
    "Detect automatically": "Detectar automaticamente",
    "Larger models are more accurate but slower": "Modelos maiores são mais precisos, porém mais lentos",
    "Install": "Instalar",
    "Reinstall": "Reinstalar",
    "How to": "Como fazer",
    "Download": "Baixar",
    "Installed": "Instalado",
    "API key": "Chave de API",
    "Paste the key from your provider account": "Cole a chave da sua conta no provedor",
    "The key is saved only in this panel on this computer. Recordings are sent to the provider you chose.": "A chave fica salva só neste painel, neste computador. As gravações vão para o provedor escolhido.",
    "Send automatically after transcribing": "Enviar sozinho depois de transcrever",
    "Video analysis": "Análise de vídeo",
    "The AI cannot watch video directly, so attached videos are sent as timestamped frames plus a transcript of their audio. This needs FFmpeg.": "A IA não assiste vídeo diretamente, então vídeos anexados vão como quadros com horário e a transcrição do áudio. Isso precisa do FFmpeg.",
    "More frames show motion in more detail but use more of your AI usage": "Mais quadros mostram o movimento com mais detalhe, mas gastam mais do seu uso da IA",
    "6 (light)": "6 (leve)",
    "12 (balanced)": "12 (equilibrado)",
    "20 (detailed)": "20 (detalhado)",
    "32 (maximum)": "32 (máximo)",
    "Frames per video": "Quadros por vídeo",
    "Transcribe the audio of attached videos": "Transcrever o áudio dos vídeos anexados",
    "Downloading…": "Baixando…",
    "Open folder": "Abrir pasta",
    "Base (148 MB, fastest)": "Base (148 MB, o mais rápido)",
    "Small (488 MB, recommended)": "Small (488 MB, recomendado)",
    "Large v3 Turbo (574 MB, most accurate)": "Large v3 Turbo (574 MB, o mais preciso)",
    "Engine": "Mecanismo",
    "Language": "Idioma",
    "Reusable instructions (SKILL.md) the agent follows when a request matches, in every Soma program. Ask the agent to create one, or add your own.": "Instruções reutilizáveis (SKILL.md) que o agente segue quando o pedido combina, em todos os programas Soma. Peça para o agente criar uma ou adicione a sua.",
    "Pick a SKILL.md file (its folder is copied)": "Escolher um arquivo SKILL.md (a pasta dele é copiada)",
    "Import SKILL.md…": "Importar SKILL.md…",
    "Install from a URL (SKILL.md or GitHub folder)": "Instalar de um link (SKILL.md ou pasta do GitHub)",
    "Install skill": "Instalar skill",
    "Connectors (MCP)": "Conectores (MCP)",
    "Other MCP servers the AI can use next to this program: Notion, Google Drive, databases, local tools… A connector runs a program on this computer, so connectors added by the agent wait for your approval.": "Outros servidores MCP que a IA pode usar junto com este programa: Notion, Google Drive, bancos de dados, ferramentas locais… Um conector roda um programa neste computador, então os que o agente adicionar esperam a sua aprovação.",
    "Add a connector (JSON)": "Adicionar um conector (JSON)",
    "Add connector": "Adicionar conector",
    "No skills yet. Try: “create a skill with my naming conventions”.": "Nenhuma skill ainda. Tente: “crie uma skill com minhas convenções de nomes”.",
    "No connectors yet.": "Nenhum conector ainda.",
    "Approve": "Aprovar",
    "Reject": "Recusar",
    "Turn off": "Desligar",
    "Turn on": "Ligar",
    "Delete": "Apagar",
    "Remove": "Remover",
    "pending": "pendente",
    "disabled": "desligado",
    "Accent color": "Cor de destaque",
    "Soma pink": "Rosa Soma",
    "Soma orange": "Laranja Soma",
    "Soma purple": "Roxo Soma",
    "Blue": "Azul",
    "Green": "Verde",
    "Choose a custom color": "Escolher uma cor",
    "Choose a custom accent color": "Escolher uma cor de destaque",
    "Open the color picker": "Abrir o seletor de cores",
    "Use Soma pink": "Usar o rosa Soma",
    "Panel language": "Idioma do painel",
    "Automatic": "Automático",
    "Used by every Soma program. The panel reloads to apply it.": "Vale para todos os programas Soma. O painel recarrega para aplicar.",
    "Tool library": "Biblioteca de ferramentas",
    "Open": "Abrir",
    "Export": "Exportar",
    "No saved tools yet.": "Nenhuma ferramenta salva ainda.",
    // Connection status
    "Not checked": "Não verificado",
    "Not found": "Não encontrado",
    "Login required": "Login necessário",
    "Could not start": "Não iniciou",
    "API key connected": "Chave de API conectada",
    "Claude ready": "Claude pronto",
    "ChatGPT ready": "ChatGPT pronto",
    "Antigravity ready": "Antigravity pronto",
    "Claude Code was not found on this computer. Install the Claude desktop app (claude.ai/download) or the Claude Code CLI, then click Check again.": "O Claude Code não foi encontrado neste computador. Instale o app Claude (claude.ai/download) ou a CLI do Claude Code e clique em Verificar de novo.",
    "Codex was not found on this computer. Install the Codex app (chatgpt.com/codex) or the Codex CLI, then click Check again.": "O Codex não foi encontrado neste computador. Instale o app Codex (chatgpt.com/codex) ou a CLI do Codex e clique em Verificar de novo.",
    "The Antigravity CLI (agy) was not found. Install it from antigravity.google (Getting started > CLI), then click Check again.": "A CLI do Antigravity (agy) não foi encontrada. Instale pelo antigravity.google (Getting started > CLI) e clique em Verificar de novo.",
    // Banners
    "A Claude login window opened. Finish signing in to your Claude account in the browser; this panel connects automatically.": "Abriu uma janela de login do Claude. Termine de entrar na sua conta no navegador; o painel conecta sozinho.",
    "A ChatGPT login window opened. Finish signing in to your ChatGPT account in the browser; this panel connects automatically.": "Abriu uma janela de login do ChatGPT. Termine de entrar na sua conta no navegador; o painel conecta sozinho.",
    "An Antigravity window opened. Sign in there, then close it; this panel connects automatically.": "Abriu uma janela do Antigravity. Entre na sua conta e feche a janela; o painel conecta sozinho.",
    "Antigravity is signed in, but the Soma Hub is not running. Reinstall Soma Agente (it starts the hub) or open “Soma Hub” from the Start menu.": "O Antigravity está conectado, mas o Soma Hub não está rodando. Reinstale o Soma Agente (ele inicia o hub) ou abra o “Soma Hub” no menu Iniciar.",
    "Wait for the current request to finish before switching the AI.": "Espere o pedido atual terminar antes de trocar a IA.",
    "Wait for the voice transcription to finish.": "Espere a transcrição de voz terminar.",
    "Wait for the current request to finish.": "Espere o pedido atual terminar.",
    "Wait for the current request to finish before starting a new chat.": "Espere o pedido atual terminar antes de começar uma nova conversa.",
    "The recording was too short. Click the microphone, speak, then click it again to stop.": "A gravação ficou curta demais. Clique no microfone, fale e clique de novo para parar.",
    "No speech was recognized. Check the microphone and the language in Settings → Voice & video.": "Nenhuma fala reconhecida. Confira o microfone e o idioma em Configurações → Voz e vídeo.",
    "Voice transcription is ready. Click the microphone to record.": "A transcrição de voz está pronta. Clique no microfone para gravar.",
    "Voice transcription is still being set up. Click the microphone again when the download finishes.": "A transcrição de voz ainda está sendo preparada. Clique no microfone de novo quando o download terminar.",
    "Setting up voice…": "Preparando a voz…",
    "Installing whisper.cpp…": "Instalando o whisper.cpp…",
    "Installing whisper.cpp": "Instalando o whisper.cpp",
    "Installing FFmpeg…": "Instalando o FFmpeg…",
    "Enter a color as six hex digits, for example #ef4444.": "Digite a cor com seis dígitos hexadecimais, por exemplo #ef4444.",
    "On macOS, open Terminal and run:  brew install whisper-cpp  (needs Homebrew from brew.sh). Then click Check again.": "No macOS, abra o Terminal e rode:  brew install whisper-cpp  (precisa do Homebrew, brew.sh). Depois clique em Verificar de novo.",
    "This folder is only available inside the installed panel.": "Esta pasta só está disponível no painel instalado.",
    "Voice transcription needs the installed panel.": "A transcrição de voz precisa do painel instalado.",
    "whisper.cpp is not installed.": "O whisper.cpp não está instalado.",
    "The transcription model is not downloaded.": "O modelo de transcrição não foi baixado.",
    "Choose a transcription engine.": "Escolha um mecanismo de transcrição.",
    "FFmpeg is not installed.": "O FFmpeg não está instalado.",
    "The download was interrupted. Try again.": "O download foi interrompido. Tente de novo.",
    "The download timed out. Check the internet connection and try again.": "O download demorou demais. Confira a internet e tente de novo.",
    "Not installed (about 25 MB). Needed for most video formats and for video audio.": "Não instalado (cerca de 25 MB). Necessário para a maioria dos vídeos e para o áudio deles.",
    "Not installed (9 MB download)": "Não instalado (download de 9 MB)",
    "Not found. In Terminal run: brew install whisper-cpp": "Não encontrado. No Terminal, rode: brew install whisper-cpp",
    // Host profiles: welcome text and suggestions
    "Describe a change, speak it with the microphone, or attach images, videos, audio, and documents as references. I’ll inspect the active composition, make the edit, and verify the result.": "Descreva uma mudança, fale no microfone ou anexe imagens, vídeos, áudios e documentos como referência. Eu inspeciono a composição ativa, faço a edição e confiro o resultado.",
    "Describe a change, speak it with the microphone, or attach images, videos, audio, and documents as references. I’ll inspect the active composition, make the edit, and verify the result": "Descreva uma mudança, fale no microfone ou anexe imagens, vídeos, áudios e documentos como referência. Eu inspeciono a composição ativa, faço a edição e confiro o resultado.",
    "List the layers in this comp": "Liste as camadas desta comp",
    "Add a centered title that says “Hello”": "Adicione um título centralizado escrito “Olá”",
    "Find the title and turn it into an Essential Graphics control": "Encontre o título e transforme num controle do Essential Graphics",
    "Recreate the animation in the attached video": "Recrie a animação do vídeo anexado",
    "Describe an edit, speak it with the microphone, or attach images and references. I’ll inspect the open document, make the change in Photoshop, and check the result.": "Descreva uma edição, fale no microfone ou anexe imagens e referências. Eu inspeciono o documento aberto, faço a mudança no Photoshop e confiro o resultado.",
    "List the layers in this document": "Liste as camadas deste documento",
    "Create a 1080×1080 post with a pink background and a centered title": "Crie um post 1080×1080 com fundo rosa e um título centralizado",
    "Place the attached image and fit it to the canvas": "Coloque a imagem anexada e ajuste ao canvas",
    "Recreate the layout of the attached reference": "Recrie o layout da referência anexada",
    "Describe the artwork, speak it with the microphone, or attach references. I’ll inspect the open document, draw or edit it in Illustrator, and check the result.": "Descreva a arte, fale no microfone ou anexe referências. Eu inspeciono o documento aberto, desenho ou edito no Illustrator e confiro o resultado.",
    "List what is on this artboard": "Liste o que tem nesta prancheta",
    "Draw a centered pink circle with a white title on top": "Desenhe um círculo rosa centralizado com um título branco por cima",
    "Create a 1080×1350 artboard for an Instagram post": "Crie uma prancheta 1080×1350 para um post do Instagram",
    "Describe the edit, speak it with the microphone, or attach references. I’ll inspect the active sequence, make the change in Premiere Pro, and check the frames.": "Descreva a edição, fale no microfone ou anexe referências. Eu inspeciono a sequência ativa, faço a mudança no Premiere Pro e confiro os quadros.",
    "List the clips on the timeline": "Liste os clipes da timeline",
    "Add a cross dissolve between every clip on V1": "Adicione um cross dissolve entre todos os clipes da V1",
    "Import the attached files and put them on the timeline in order": "Importe os arquivos anexados e coloque na timeline em ordem",
    "Add a marker at every cut": "Adicione um marcador em cada corte"
  };

  // Texts with variable parts: [pattern, Portuguese with $1, $2…].
  var RULES = [
    [/^(.+) copilot$/, "Copiloto do $1"],
    [/^Message Soma Agente · (.+)$/, "Mensagem para o Soma Agente · $1"],
    [/^Connect your (.+) account or check connection status$/, "Conectar sua conta $1 ou ver o status da conexão"],
    [/^Connect your (.+) account before sending the first request\.$/, "Conecte sua conta $1 antes de enviar o primeiro pedido."],
    [/^Your (.+) account is connected\. Account details are hidden\.$/, "Sua conta $1 está conectada. Os detalhes da conta ficam ocultos."],
    [/^(.+) connected$/, "$1 conectado"],
    [/^Connect (Claude|ChatGPT|Antigravity)$/, "Conectar $1"],
    [/^Install (Claude|ChatGPT|Antigravity|Codex)$/, "Instalar $1"],
    [/^Connected and ready \((.+)\)\.$/, "Conectado e pronto ($1)."],
    [/^(Claude Code|Codex|The Antigravity CLI) is available \((.+)\), but it is not signed in\. Click Connect (.+) and finish the login in your browser\.$/, "$1 está disponível ($2), mas sem login. Clique em Conectar $3 e termine o login no navegador."],
    [/^Step (\d+) complete$/, "Etapa $1 concluída"],
    [/^(.+)\. Continuing with verification\.$/, "$1. Seguindo para a conferência."],
    [/^(.+) failed\. The agent is inspecting the result and choosing another approach\.$/, "$1 falhou. O agente está olhando o resultado e escolhendo outro caminho."],
    [/^Working in (.+)$/, "Trabalhando no $1"],
    [/^No further tools will start\. If an (.+) script is already running, wait for it to return or press Esc in (.+)\.$/, "Nenhuma ferramenta nova vai começar. Se um script do $1 já estiver rodando, espere terminar ou aperte Esc no $2."],
    [/^Packaging images, video frames, and transcripts for (.+)\.$/, "Preparando imagens, quadros de vídeo e transcrições para o $1."],
    [/^Restoring (\d+) (.+) undo steps?\.$/, "Restaurando $1 passo(s) de desfazer do $2."],
    [/^(\d+) of (\d+) undo steps restored\.$/, "$1 de $2 passos de desfazer restaurados."],
    [/^Soma Agente (.+) is ready\. Save your work and close the Adobe programs; the update installs automatically and you can reopen them right after\.$/, "O Soma Agente $1 está pronto. Salve seu trabalho e feche os programas Adobe; a atualização instala sozinha e você pode reabrir logo depois."],
    [/^“(.+)” could not be prepared: (.+) Remove it to send the message\.$/, "Não deu para preparar “$1”: $2 Remova o anexo para enviar a mensagem."],
    [/^“(.+)” is not supported\. Attach images, videos, audio, PDFs, or text documents\.$/, "“$1” não é suportado. Anexe imagens, vídeos, áudios, PDFs ou documentos de texto."],
    [/^Could not attach “(.+)”: (.+)$/, "Não deu para anexar “$1”: $2"],
    [/^“(.+)” is already attached\.$/, "“$1” já está anexado."],
    [/^“(.+)” is already in References\.$/, "“$1” já está nas Referências."],
    [/^Saved “(.+)” to References\. Open the bookmark button to add a note or pin it to every new chat\.$/, "“$1” foi salvo nas Referências. Abra o botão de marcador para adicionar uma nota ou fixar em toda nova conversa."],
    [/^Could not save the reference: (.+)$/, "Não deu para salvar a referência: $1"],
    [/^Could not add the reference: (.+)$/, "Não deu para adicionar a referência: $1"],
    [/^Could not open the folder: (.+)$/, "Não deu para abrir a pasta: $1"],
    [/^Microphone recording failed: (.+)$/, "A gravação do microfone falhou: $1"],
    [/^Voice transcription failed: (.+)$/, "A transcrição de voz falhou: $1"],
    [/^Sign-in could not start: (.+)$/, "Não deu para iniciar o login: $1"],
    [/^Set up voice transcription first: (.+)$/, "Prepare a transcrição de voz primeiro: $1"],
    [/^Setting up voice transcription on this computer \(one time, about (\d+) MB\)\. Click the microphone again when it finishes\.$/, "Preparando a transcrição de voz neste computador (uma vez só, cerca de $1 MB). Clique no microfone de novo quando terminar."],
    [/^Downloading the (.+) model…?$/, "Baixando o modelo $1…"],
    [/^(.+) downloaded$/, "$1 baixado"],
    [/^Not downloaded \((\d+) MB\)$/, "Não baixado ($1 MB)"],
    [/^Available inside the installed (.+) panel\.$/, "Disponível no painel instalado do $1."],
    [/^Applied (.+) to (\d+) segments? on (\d+) propert(?:y|ies)\.(.*) Undo with the revert arrow or Ctrl\+Z in (.+)\.$/, "$1 aplicado em $2 segmento(s) de $3 propriedade(s).$4 Desfaça com a seta de desfazer ou Ctrl+Z no $5."],
    [/^Microphone access was not granted\. (.+)$/, "O acesso ao microfone não foi liberado. $1"],
    [/^This (.+) panel cannot access the microphone\. (.+)$/, "Este painel do $1 não consegue usar o microfone. $2"],
    [/^The last run could not be fully reverted: (.+)$/, "Não deu para desfazer toda a última execução: $1"],
    [/^The request started, but its acknowledgement failed: (.+) Use Stop before trying again\.$/, "O pedido começou, mas a confirmação falhou: $1 Use Parar antes de tentar de novo."],
    [/^Imported skill “(.+)”\.$/, "Skill “$1” importada."],
    [/^Installed skill “(.+)”\.$/, "Skill “$1” instalada."],
    [/^Connector “(.+)” added\. It is available from the next message\.$/, "Conector “$1” adicionado. Ele funciona a partir da próxima mensagem."],
    [/^Could not add it: (.+)$/, "Não deu para adicionar: $1"],
    [/^The agent wants to add (this|these)\. Approve only what you trust: connectors run programs on this computer\.$/, "O agente quer adicionar isto. Aprove só o que você confia: conectores rodam programas neste computador."],
    [/^Connector: (.+)$/, "Conector: $1"],
    [/^Open the panel inside (.+) to apply eases\.$/, "Abra o painel dentro do $1 para aplicar eases."],
    [/^References are available inside the installed (.+) panel\.$/, "As referências ficam disponíveis no painel instalado do $1."],
    [/^Attachments work inside the installed (.+) panel\.$/, "Os anexos funcionam no painel instalado do $1."],
    [/^Open inside (.+)$/, "Abra dentro do $1"],
    [/^Install this folder as a CEP extension, restart (.+), then open Window → Extensions → Soma Agente\.$/, "Instale esta pasta como extensão CEP, reinicie o $1 e abra Window → Extensions → Soma Agente."],
    [/^(Claude Code|Codex \(ChatGPT\)) was not found\. (.+)$/, "$1 não foi encontrado. Veja Configurações → Agente."],
    [/^(.+) not found\. Use soma_list_skills\.$/, "$1 não encontrado."]
  ];

  function translate(text) {
    if (lang !== "pt" || !text) { return text; }
    var trimmed = text.trim();
    if (!trimmed) { return text; }
    var out = PT.hasOwnProperty(trimmed) ? PT[trimmed] : null;
    // "Claude: <diagnosis>" keeps the AI name and translates the rest.
    var prefixed = out === null && /^(Claude|ChatGPT|Antigravity): (.+)$/.exec(trimmed);
    if (prefixed && translate(prefixed[2]) !== prefixed[2]) { out = prefixed[1] + ": " + translate(prefixed[2]); }
    if (out === null) {
      for (var i = 0; i < RULES.length; i += 1) {
        if (RULES[i][0].test(trimmed)) { out = trimmed.replace(RULES[i][0], RULES[i][1]); break; }
      }
    }
    if (out === null) { return text; }
    var start = text.indexOf(trimmed);
    return text.slice(0, start) + out + text.slice(start + trimmed.length);
  }

  var ATTRIBUTES = ["title", "placeholder", "aria-label", "alt"];
  // Chat transcripts, scripts and editable values keep their own language.
  function skipped(element) {
    return !!(element && element.closest && element.closest(".message-body, pre, script, style, [data-no-translate]"));
  }

  function translateNode(node) {
    if (lang !== "pt" || !node) { return; }
    if (node.nodeType === 3) {
      if (!skipped(node.parentElement) && !(node.parentElement && node.parentElement.closest("textarea"))) {
        var value = translate(node.nodeValue);
        if (value !== node.nodeValue) { node.nodeValue = value; }
      }
      return;
    }
    if (node.nodeType !== 1 || skipped(node)) { return; }
    ATTRIBUTES.forEach(function (name) {
      if (node.hasAttribute(name)) {
        var current = node.getAttribute(name), next = translate(current);
        if (next !== current) { node.setAttribute(name, next); }
      }
    });
    for (var child = node.firstChild; child; child = child.nextSibling) { translateNode(child); }
  }

  function start() {
    if (lang !== "pt") { return; }
    document.documentElement.lang = "pt-BR";
    translateNode(document.body);
    new MutationObserver(function (mutations) {
      mutations.forEach(function (m) {
        if (m.type === "characterData") { translateNode(m.target); }
        else if (m.type === "attributes") { translateNode(m.target); }
        else { Array.prototype.forEach.call(m.addedNodes, translateNode); }
      });
    }).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRIBUTES });
  }

  window.SomaI18n = {
    lang: lang,
    choice: choice,
    // L("English", "Português"): picks the text for the current language.
    L: function (en, pt) { return lang === "pt" ? pt : en; },
    t: translate,
    start: start,
    // Saves "pt", "en" or "auto" for every Soma program.
    setChoice: function (value) {
      var f = languageFile();
      if (!f) { return; }
      try {
        if (value === "auto") { if (f.fs.existsSync(f.file)) { f.fs.unlinkSync(f.file); } }
        else { if (!f.fs.existsSync(f.dir)) { f.fs.mkdirSync(f.dir, { recursive: true }); } f.fs.writeFileSync(f.file, value); }
      } catch (error) { /* read-only data folder */ }
    }
  };
}());
