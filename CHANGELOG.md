# Changelog

## 1.7.10
- Ctrl+V (Cmd+V no Mac) anexa mídia no chat: arquivos copiados no Explorer ou no Finder (vídeo, imagem, PDF, documentos) e imagens copiadas ou prints. Funciona no painel Adobe e no Figma; no Blender, no Cinema 4D e no Cavalry, que só colam texto no campo de mensagem, há um botão Colar.

## 1.7.9
- Blender, Cinema 4D, Figma e Cavalry: o chat aceita imagens, vídeos, áudios, PDFs e documentos (Word, PowerPoint, Excel, LibreOffice, RTF, texto, CSV, JSON, legendas e código), e não só imagens. Vídeos viram quadros com o tempo de cada um, e o áudio é transcrito quando a transcrição de voz está instalada. O FFmpeg é baixado sozinho na primeira vez que alguém manda um vídeo.
- Painel Adobe: aceita Word, PowerPoint, Excel e LibreOffice, e o ChatGPT e o Antigravity também leem PDFs (pelo texto extraído; o Claude continua lendo o PDF inteiro).

## 1.7.8
- ChatGPT: quando a conta não aceita o modelo escolhido (erro "model is not supported"), o Soma troca de modelo sozinho, reenvia o pedido e avisa em português. O modelo recusado sai da lista por 7 dias. Vale para o painel Adobe, o Blender, o Cinema 4D, o Figma e o Cavalry.

## 1.7.7
- After Effects: arraste camadas da Timeline ou itens do painel Project (comps, footage, solids, pastas) para o chat. Cada um vira uma referência (um chip acima da caixa de mensagem e um @Nome no texto), e a IA recebe exatamente qual é: nome, índice, comp e IDs.
- Arrastar para o painel não mostra mais o cursor de proibido.

## 1.7.6
- Painel Adobe no Mac: dá para digitar normalmente no chat. Espaço, Delete e as outras teclas ficam no painel enquanto você digita (antes iam para o After Effects, e o espaço tocava a prévia), e Cmd+C, Cmd+V, Cmd+X, Cmd+A e Cmd+Z funcionam no texto. Fora do campo de texto, os atalhos do programa continuam normais.
- Painel Adobe: Ctrl/Cmd+Z dentro de um campo de texto desfaz o texto digitado.
- Mac: o Soma encontra o Claude Code, o Codex e o Antigravity instalados por nvm, volta, bun ou Homebrew, mesmo com o programa aberto pelo Dock (ele lê o PATH do Terminal), e o Claude Code instalado por npm abre normalmente. Vale para o painel Adobe, o Blender, o Cinema 4D e o Soma Hub.
- Mac: os botões "Instalar Claude Code" e "Instalar CLI do Antigravity" rodam o instalador oficial no Terminal e o Soma verifica de novo quando termina.
- Mac: "Atualizar agora" abre a página de download em vez de ficar parado em "Instalando…", e a verificação de atualização funciona mesmo sem o Soma Hub.
- Mac: o instalador instala o Soma Hub sempre que o Python 3 existe; conexões HTTPS usam os certificados do macOS (o Python do python.org não confiava em nenhum); o FFmpeg baixado é liberado e assinado localmente se o Mac impedir que ele abra.

## 1.7.5
- Mac: instalador de dois cliques ("Instalar Soma Agente.command") com janelas do macOS em português ou inglês. Ele lista os programas encontrados (After Effects, Photoshop, Illustrator, Premiere Pro, Blender, Cinema 4D, Figma e Cavalry), instala os escolhidos, liga o add-on do Blender, inicia o Soma Hub junto com o Mac, copia o caminho do plugin do Figma e mostra onde abrir o Soma em cada programa. Também desinstala, guardando backups, e o zip traz um LEIA-ME curto.

## 1.7.4
- After Effects: o Ctrl+Z volta o trabalho da IA passo a passo. A IA faz uma camada, animação ou efeito por vez, e cada passo aparece no menu Editar com o nome do que fez (por exemplo "Desfazer Soma: Cria o título").
- Painel Adobe: botão "Desfazer o último passo" ao lado de "Desfazer a última execução".

## 1.7.3
- Botão "Sugerir ou reportar um problema" em todos os painéis: abre uma issue no GitHub já preenchida com a versão do Soma, o programa, o sistema e a IA em uso. No painel Adobe fica em Configurações > Agente; no Blender, em Opções; no Cinema 4D, ao lado de Verificar; no Cavalry e no Figma, no botão "?" do topo.

## 1.7.2
- Cavalry: acabamento do painel — botões e menus arredondados sem borda, fundo mais escuro, status alinhado, avisos ocupando a largura toda e sugestões centralizadas.

## 1.7.1
- Cavalry: painel redesenhado com balões de conversa, cartões arredondados, texto formatado nas respostas, status com indicador colorido, sugestões para começar e a conversa atual sempre à vista ("Mostrar mensagens anteriores" para o resto).
- Blender: painel redesenhado com o ícone do Soma, botão "+" de nova conversa no cabeçalho, mensagens separadas por quem falou, passos da IA agrupados, sugestões para começar, caixa de mensagem maior e um submenu "Opções" (idioma, atualizações, conversa em texto).

## 1.7.0
- Cavalry: painel de chat (Scripts > Soma Agente) ligado ao Soma Hub, com ferramentas para ler a cena, criar e animar camadas, conectar atributos, importar arquivos e conferir com um quadro de prévia. Escolha Cavalry no instalador.
- Trocar de IA mantém a conversa: a nova IA recebe o histórico junto com a próxima mensagem.
- Botão "+ Nova conversa" visível em todos os painéis.

## 1.6.3
- O próprio agente confere atualizações: cada programa verifica o GitHub ao abrir e mostra "Atualizar agora" quando há versão nova (painel Adobe, Blender, Cinema 4D e Figma).
- Botão "Verificar atualizações" (Configurações > Agente no painel Adobe; painel do Blender; botão Verificar no Cinema 4D).
- Pergunte no chat "tem atualização?": a IA usa as novas ferramentas soma_check_update e soma_install_update.
- Quem tem só o app do Claude ou do Antigravity agora vê o que falta: o botão "Instalar Claude Code" / "Instalar CLI do Antigravity" roda o instalador oficial numa janela e o Soma verifica de novo sozinho. Avisa que o Claude Code precisa do plano Pro ou Max.
- Corrigido: no painel Adobe, os botões que abrem páginas não faziam nada; "Verificar de novo" agora mostra que está verificando e "Copiar relatório" funciona dentro dos programas Adobe.

## 1.6.2
- Português (Brasil) e inglês em tudo: instalador (botão English/Português no topo), painel Adobe (Configurações > Aparência > Idioma), Blender, Cinema 4D e Figma. A escolha vale para todos os programas; sem escolha, segue o idioma do programa ou do Windows.
- Detecção das IAs mais completa: Claude Code e Codex instalados por npm, pnpm, nvm ou WinGet, PATH atualizado sem reiniciar e a CLI do Antigravity em qualquer pasta do PATH.

## 1.6.1
- Instalador bem menor (de 11 MB para cerca de 0,3 MB): o Python do Soma Hub é baixado do python.org na instalação (com SHA-256 conferido) em vez de vir embutido, o que reduz alertas falsos de antivírus.
- O instalador não baixa nem executa mais outro programa: se houver versão nova, ele abre a página da Release. O Soma Hub continua atualizando sozinho.
- Informações de autor e licença no arquivo do instalador.

## 1.6.0
- Skills (SKILL.md) e conectores MCP em todos os programas, com Claude, ChatGPT e Antigravity.
- O agente cria skills, instala skills do GitHub e cadastra conectores; conectores e skills baixadas esperam aprovação do usuário.
- Aba Skills no painel Adobe e aprovação no Blender, Cinema 4D e Figma.

## 1.5.1
- O instalador consulta o GitHub ao abrir: se houver versão mais nova, baixa, confere o SHA-256 e instala a mais recente.

## 1.5.0
- Código aberto no GitHub (licença MIT).
- Atualização automática: o Soma Hub instala as novas Releases deste repositório (com verificação SHA-256), esperando os programas Adobe fecharem.
- Instalador legível em qualquer escala de tela.

## 1.4.1
- Instalador não falha mais com "acesso negado" quando a pasta do Soma Hub está aberta.
- Cinema 4D: ID próprio do plugin, carregamento tolerante e log de erros.

## 1.4.0
- Corrigido: no Photoshop e no Premiere todas as ferramentas falhavam.
- Antigravity como terceira IA e Soma Hub para comandar todos os apps.

## 1.3.0
- Photoshop, Illustrator, Premiere Pro, Blender, Cinema 4D e Figma.
- Instalador com seleção de programas.

## 1.2.0
- Marca Soma e escolha entre Claude e ChatGPT.

## 1.1.0
- Eases precisos e correção da transcrição de voz.

## 1.0.0
- Voz, imagens, vídeos e referências no After Effects.
