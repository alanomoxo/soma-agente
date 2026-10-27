#!/bin/zsh
# Soma Agente: double-click to install on the Mac.
set -euo pipefail
cd "$(dirname "$0")"
clear
print ""
print "  SOMA. Agente — instalador para After Effects"
print "  ---------------------------------------------"
print ""
print "  O painel vai para a pasta de extensões do After Effects e o Mac passa"
print "  a aceitar painéis não assinados (PlayerDebugMode do CEP 12)."
print "  Feche o After Effects antes de continuar."
print ""
read '?  Aperte Return para instalar (ou feche esta janela para cancelar). '
if zsh ./install-dev-macos.sh --enable-debug; then
  print ""
  print "  Pronto! Abra o After Effects > Window > Extensions > Soma Agente."
  print "  Na primeira vez, clique na engrenagem e conecte sua conta (Claude ou ChatGPT)."
else
  print ""
  print "  Não deu para instalar. Leia a mensagem acima."
fi
print ""
read '?  Aperte Return para fechar. '
