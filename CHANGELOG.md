# Changelog

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
