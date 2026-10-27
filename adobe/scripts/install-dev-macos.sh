#!/bin/zsh
set -euo pipefail

source_dir="$(cd "$(dirname "$0")/.." && pwd)"
target_parent="$HOME/Library/Application Support/Adobe/CEP/extensions"
target_dir="$target_parent/com.framepilot.aeagent"
backup_parent="$HOME/Library/Application Support/Adobe/CEP/extension-backups"

debug_mode="$(defaults read com.adobe.CSXS.12 PlayerDebugMode 2>/dev/null || true)"
if [[ "$debug_mode" != "1" && "${1:-}" != "--enable-debug" ]]; then
  echo "CEP development mode is not enabled. No files were changed."
  echo "For a first development install, explicitly rerun with --enable-debug."
  exit 1
fi

if pgrep -f '/Adobe After Effects.*Contents/MacOS/After Effects' >/dev/null; then
  echo "Feche o After Effects antes de instalar."
  exit 1
fi
has_claude=0; has_codex=0
if command -v claude >/dev/null || [[ -x "$HOME/.local/bin/claude" ]] || [[ -d "$HOME/Library/Application Support/Claude/claude-code" ]]; then has_claude=1; fi
if command -v codex >/dev/null || [[ -x "/Applications/Codex.app/Contents/Resources/codex" ]] || [[ -x "/opt/homebrew/bin/codex" ]] || [[ -x "/usr/local/bin/codex" ]]; then has_codex=1; fi
[[ $has_claude == 1 ]] && echo "  Claude: pronto" || echo "  Claude: não instalado (claude.ai/download)"
[[ $has_codex == 1 ]] && echo "  ChatGPT (Codex): pronto" || echo "  ChatGPT (Codex): não instalado (chatgpt.com/codex)"
if [[ $has_claude == 0 && $has_codex == 0 ]]; then
  echo "  Aviso: instale o app Claude ou o app Codex para o agente funcionar."
fi
mkdir -p "$HOME/Library/Application Support/AE Agent"
record="$HOME/Library/Application Support/AE Agent/cep-debug-before-install.txt"
if [[ ! -e "$record" ]]; then
  print -r -- "${debug_mode:-ABSENT}" > "$record"
fi
mkdir -p "$target_parent"

stage_dir="$(mktemp -d "$target_parent/.ae-agent-stage.XXXXXX")"
backup_dir=""
trap 'rm -rf "$stage_dir"' EXIT
ditto "$source_dir" "$stage_dir"
if [ -e "$target_dir" ]; then
  mkdir -p "$backup_parent"
  backup_dir="$backup_parent/com.framepilot.aeagent-$(date +%Y%m%d-%H%M%S)-$$"
  mv "$target_dir" "$backup_dir"
  echo "  Versão anterior guardada em: $backup_dir"
fi
if ! mv "$stage_dir" "$target_dir"; then
  if [[ -n "$backup_dir" && ! -e "$target_dir" ]]; then
    mv "$backup_dir" "$target_dir"
  fi
  exit 1
fi

if [[ "${1:-}" == "--enable-debug" && "$debug_mode" != "1" ]]; then
  defaults write com.adobe.CSXS.12 PlayerDebugMode 1
fi

echo "  Soma Agente instalado em: $target_dir"
