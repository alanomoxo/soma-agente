#!/bin/bash
# Soma Agente for the Mac: double-click to install (or uninstall).
# Like the Windows installer: lists the programs found on this Mac, installs
# the chosen ones, keeps backups of what it replaces, and says where to open
# Soma in each program. Plain bash 3.2 (the one macOS ships) and macOS tools.
# No "set -u": bash 3.2 treats an empty array as unset.

HERE="$(cd "$(dirname "$0")" && pwd)"
FILES="$HERE/Arquivos"
VERSION="$(cat "$FILES/VERSION" 2>/dev/null || echo "")"
SUPPORT="$HOME/Library/Application Support"
DATA="$SUPPORT/AE Agent"
BACKUPS="$DATA/backups"
STAMP="$(date +%Y%m%d-%H%M%S)"
CEP="$SUPPORT/Adobe/CEP/extensions"
CEP_TARGET="$CEP/com.framepilot.aeagent"
HUB_HOME="$SUPPORT/Soma Agente/figma"
AGENT_PLIST="$HOME/Library/LaunchAgents/com.alanomoxo.somahub.plist"
CAVALRY_SCRIPTS="$SUPPORT/Cavalry/Scripts"
# SOMA_APPLICATIONS and SOMA_PYTHON pick another Applications folder or Python (tests, custom setups).
APPLICATIONS="${SOMA_APPLICATIONS:-/Applications}"
mkdir -p "$DATA" "$BACKUPS"
# Files downloaded with the zip keep Apple's quarantine flag; clear it so the
# installed panels and plugins open without more warnings.
xattr -dr com.apple.quarantine "$HERE" 2>/dev/null || true

# ------------------------------------------------------------------ language
choice="$(cat "$DATA/language.txt" 2>/dev/null || true)"
PT=0
if [ "$choice" = "pt" ]; then PT=1
elif [ "$choice" != "en" ] && defaults read -g AppleLocale 2>/dev/null | grep -qi '^pt'; then PT=1
fi
t() { if [ "$PT" = 1 ]; then printf '%s' "$1"; else printf '%s' "$2"; fi; }

# ------------------------------------------------------------------ dialogs
# dialog "message" "default button" "button" ["button"...] -> prints the button clicked ("" if closed)
dialog() {
  osascript - "$@" <<'APPLESCRIPT' 2>/dev/null
on run argv
  set buttonList to {}
  repeat with i from 3 to count of argv
    set end of buttonList to item i of argv
  end repeat
  try
    set answer to display dialog (item 1 of argv) with title "Soma Agente" buttons buttonList default button (item 2 of argv) with icon note
    return button returned of answer
  on error
    return ""
  end try
end run
APPLESCRIPT
}

# pick "prompt" "OK" "Cancel" checked... -- items... -> prints the chosen items, one per line
pick() {
  osascript - "$@" <<'APPLESCRIPT' 2>/dev/null
on run argv
  set chosenByDefault to {}
  set itemList to {}
  set inItems to false
  repeat with i from 4 to count of argv
    set value to item i of argv
    if value is "--" then
      set inItems to true
    else if inItems then
      set end of itemList to value
    else
      set end of chosenByDefault to value
    end if
  end repeat
  set answer to choose from list itemList with title "Soma Agente" with prompt (item 1 of argv) default items chosenByDefault OK button name (item 2 of argv) cancel button name (item 3 of argv) with multiple selections allowed
  if answer is false then return ""
  set AppleScript's text item delimiters to linefeed
  return answer as text
end run
APPLESCRIPT
}

step() { printf '  %s\n' "$1"; }

# Moves an existing install aside (backups/<kind>/<name>-<stamp>) before it is replaced or removed.
shelve() {
  if [ -e "$1" ]; then
    mkdir -p "$BACKUPS/$2"
    mv "$1" "$BACKUPS/$2/$3-$STAMP"
  fi
}

running() { pgrep -if "$1" >/dev/null 2>&1; }

# ------------------------------------------------------------------ detection
ADOBE_APPS="After Effects|Photoshop|Illustrator|Premiere Pro"
adobe_found() { ls -d "$APPLICATIONS/Adobe $1"* >/dev/null 2>&1; }

blender_targets() {
  for dir in "$SUPPORT/Blender/"*; do
    [ -d "$dir" ] || continue
    version="$(basename "$dir")"
    major="${version%%.*}"; minor="${version#*.}"; minor="${minor%%.*}"
    case "$major$minor" in *[!0-9]*|"") continue ;; esac
    if [ "$major" -gt 4 ] || { [ "$major" -eq 4 ] && [ "$minor" -ge 2 ]; }; then echo "$dir"; fi
  done
}

c4d_targets() {
  for dir in "$HOME/Library/Preferences/Maxon/Maxon Cinema 4D 20"*; do
    [ -d "$dir" ] || continue
    year="$(basename "$dir" | sed -n 's/^Maxon Cinema 4D \(20[0-9][0-9]\).*/\1/p')"
    [ -n "$year" ] && [ "$year" -ge 2024 ] && echo "$dir"
  done
}

versions() { while read -r dir; do basename "$dir" | sed 's/^Maxon Cinema 4D \(20[0-9][0-9]\).*/\1/'; done | paste -sd ',' - | sed 's/,/, /g'; }

figma_found() { [ -d "$APPLICATIONS/Figma.app" ] || [ -d "$HOME/Applications/Figma.app" ]; }
cavalry_found() { [ -d "$APPLICATIONS/Cavalry.app" ] || [ -d "$SUPPORT/Cavalry" ]; }

find_python() {
  if [ -n "${SOMA_PYTHON:-}" ]; then echo "$SOMA_PYTHON"; return; fi
  for candidate in /opt/homebrew/bin/python3 /usr/local/bin/python3 /Library/Frameworks/Python.framework/Versions/Current/bin/python3; do
    if [ -x "$candidate" ] && "$candidate" -c 'import sys; sys.exit(sys.version_info < (3, 8))' 2>/dev/null; then echo "$candidate"; return; fi
  done
  # /usr/bin/python3 is only a stub until Apple's command line tools are installed.
  if xcode-select -p >/dev/null 2>&1 && /usr/bin/python3 -c 'import sys; sys.exit(sys.version_info < (3, 8))' 2>/dev/null; then echo /usr/bin/python3; fi
}

# ------------------------------------------------------------------ install steps
install_adobe() {
  step "$(t "Instalando o painel Adobe…" "Installing the Adobe panel…")"
  mkdir -p "$CEP"
  stage="$(mktemp -d "$CEP/.soma-stage.XXXXXX")"
  ditto "$FILES/Adobe" "$stage"
  shelve "$CEP_TARGET" "adobe" "com.framepilot.aeagent"
  mv "$stage" "$CEP_TARGET"
  # Adobe loads panels that are not from its store only with PlayerDebugMode on (CEP 11 and 12).
  for version in 11 12; do
    record="$DATA/cep-debug-before-install-$version.txt"
    [ "$version" = 12 ] && record="$DATA/cep-debug-before-install.txt"
    if [ ! -e "$record" ]; then
      (defaults read "com.adobe.CSXS.$version" PlayerDebugMode 2>/dev/null || echo ABSENT) > "$record"
    fi
    defaults write "com.adobe.CSXS.$version" PlayerDebugMode 1
  done
}

BLENDER_STARTUP='# Soma Agente: switches the add-on on once after installation.
import os

import addon_utils
import bpy

MARKER = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "addons", "soma_agente", ".enabled-once")


def _enable():
    if os.path.exists(MARKER):
        return None
    addon_utils.enable("soma_agente", default_set=True, persistent=True)
    try:
        bpy.ops.wm.save_userpref()
    except Exception:
        pass
    with open(MARKER, "w") as handle:
        handle.write("1")
    return None


def register():
    bpy.app.timers.register(_enable, first_interval=1.0)


def unregister():
    pass
'

install_blender() {
  blender_targets | while read -r target; do
    step "$(t "Instalando no Blender" "Installing in Blender") $(basename "$target")…"
    mkdir -p "$target/scripts/addons" "$target/scripts/startup"
    shelve "$target/scripts/addons/soma_agente" "blender" "soma_agente-$(basename "$target")"
    ditto "$FILES/Blender/soma_agente" "$target/scripts/addons/soma_agente"
    printf '%s' "$BLENDER_STARTUP" > "$target/scripts/startup/soma_agente_autoenable.py"
  done
}

install_c4d() {
  c4d_targets | while read -r target; do
    step "$(t "Instalando no" "Installing in") $(basename "$target")…"
    mkdir -p "$target/plugins"
    shelve "$target/plugins/soma_agente" "cinema4d" "soma_agente-$(basename "$target" | tr ' ' '_')"
    ditto "$FILES/Cinema 4D/soma_agente" "$target/plugins/soma_agente"
  done
}

install_cavalry() {
  step "$(t "Instalando no Cavalry…" "Installing in Cavalry…")"
  mkdir -p "$CAVALRY_SCRIPTS"
  shelve "$CAVALRY_SCRIPTS/Soma Agente.js" "cavalry" "Soma Agente.js"
  cp "$FILES/Cavalry/Soma Agente.js" "$CAVALRY_SCRIPTS/Soma Agente.js"
}

# The Soma Hub runs the agents of Figma and Cavalry (they cannot start programs) and starts at login.
install_hub() {
  python="$1"
  step "$(t "Instalando o Soma Hub…" "Installing the Soma Hub…")"
  launchctl bootout "gui/$(id -u)" "$AGENT_PLIST" >/dev/null 2>&1 || true
  mkdir -p "$(dirname "$HUB_HOME")"
  shelve "$HUB_HOME" "figma" "figma"
  ditto "$FILES/Figma" "$HUB_HOME"
  mkdir -p "$(dirname "$AGENT_PLIST")"
  cat > "$AGENT_PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.alanomoxo.somahub</string>
  <key>ProgramArguments</key>
  <array><string>$python</string><string>$HUB_HOME/bridge/soma_hub.py</string></array>
  <key>WorkingDirectory</key><string>$HUB_HOME/bridge</string>
  <key>RunAtLoad</key><true/>
  <key>StandardErrorPath</key><string>$DATA/soma-hub-error.log</string>
</dict>
</plist>
PLIST
  launchctl bootstrap "gui/$(id -u)" "$AGENT_PLIST" >/dev/null 2>&1 || launchctl load "$AGENT_PLIST" >/dev/null 2>&1 || true
}

# ------------------------------------------------------------------ uninstall
uninstall() {
  answer="$(dialog "$(t "Remover o Soma Agente de todos os programas deste Mac? Nada é apagado: os arquivos vão para a pasta de backups do Soma." "Remove Soma Agente from every program on this Mac? Nothing is deleted: the files go to Soma's backups folder.")" "$(t "Remover" "Remove")" "$(t "Cancelar" "Cancel")" "$(t "Remover" "Remove")")"
  [ "$answer" = "$(t "Remover" "Remove")" ] || exit 0
  echo
  step "$(t "Removendo…" "Removing…")"
  shelve "$CEP_TARGET" "adobe" "com.framepilot.aeagent-removed"
  for version in 11 12; do
    record="$DATA/cep-debug-before-install-$version.txt"
    [ "$version" = 12 ] && record="$DATA/cep-debug-before-install.txt"
    [ -e "$record" ] || continue
    previous="$(cat "$record")"
    if [ "$previous" = "ABSENT" ]; then defaults delete "com.adobe.CSXS.$version" PlayerDebugMode >/dev/null 2>&1 || true
    else defaults write "com.adobe.CSXS.$version" PlayerDebugMode "$previous"; fi
    rm -f "$record"
  done
  blender_targets | while read -r target; do
    shelve "$target/scripts/addons/soma_agente" "blender" "soma_agente-removed-$(basename "$target")"
    rm -f "$target/scripts/startup/soma_agente_autoenable.py"
  done
  c4d_targets | while read -r target; do
    shelve "$target/plugins/soma_agente" "cinema4d" "soma_agente-removed-$(basename "$target" | tr ' ' '_')"
  done
  shelve "$CAVALRY_SCRIPTS/Soma Agente.js" "cavalry" "Soma Agente-removed.js"
  launchctl bootout "gui/$(id -u)" "$AGENT_PLIST" >/dev/null 2>&1 || true
  rm -f "$AGENT_PLIST"
  shelve "$HUB_HOME" "figma" "figma-removed"
  rm -f "$DATA/installed-version.txt"
  step "$(t "Pronto." "Done.")"
  dialog "$(t "O Soma Agente foi removido. Os arquivos estão em" "Soma Agente was removed. The files are in") $BACKUPS" "OK" "OK" >/dev/null
  exit 0
}

# ------------------------------------------------------------------ main
clear 2>/dev/null || true
echo
echo "  SOMA. Agente $VERSION"
echo "  ------------------------------------------"
echo "  $(t "Siga as janelas que aparecem na tela." "Follow the windows on screen.")"
echo

start="$(dialog "$(t "Este instalador coloca o Soma Agente nos programas que você escolher. Feche esses programas antes de continuar." "This installer adds Soma Agente to the programs you choose. Close those programs before continuing.")" "$(t "Continuar" "Continue")" "$(t "Desinstalar" "Uninstall")" "$(t "Cancelar" "Cancel")" "$(t "Continuar" "Continue")")"
if [ "$start" = "$(t "Desinstalar" "Uninstall")" ]; then uninstall; fi
[ "$start" = "$(t "Continuar" "Continue")" ] || exit 0

# What is on this Mac, already checked in the list.
items=(); missing=()
IFS='|'; for name in $ADOBE_APPS; do
  if adobe_found "$name"; then items+=("$name"); else missing+=("$name"); fi
done; unset IFS
blender="$(blender_targets | while read -r d; do basename "$d"; done | paste -sd ',' - | sed 's/,/, /g')"
if [ -n "$blender" ]; then items+=("Blender ($blender)"); else missing+=("$(t "Blender 4.2+ (abra o Blender uma vez)" "Blender 4.2+ (open Blender once)")"); fi
c4d="$(c4d_targets | versions)"
if [ -n "$c4d" ]; then items+=("Cinema 4D ($c4d)"); else missing+=("$(t "Cinema 4D 2024+ (abra o C4D uma vez)" "Cinema 4D 2024+ (open C4D once)")"); fi
if figma_found; then items+=("Figma"); else missing+=("Figma"); fi
if cavalry_found; then items+=("Cavalry"); else missing+=("Cavalry"); fi

if [ "${#items[@]}" -eq 0 ]; then
  dialog "$(t "Não encontrei nenhum programa compatível neste Mac: After Effects, Photoshop, Illustrator, Premiere Pro, Blender 4.2+, Cinema 4D 2024+, Figma ou Cavalry." "No supported program was found on this Mac: After Effects, Photoshop, Illustrator, Premiere Pro, Blender 4.2+, Cinema 4D 2024+, Figma or Cavalry.")" "OK" "OK" >/dev/null
  exit 0
fi
prompt="$(t "Escolha onde instalar o Soma Agente:" "Choose where to install Soma Agente:")"
if [ "${#missing[@]}" -gt 0 ]; then
  prompt="$prompt

$(t "Não encontrados:" "Not found:") $(printf '%s, ' "${missing[@]}" | sed 's/, $//')"
fi
chosen="$(pick "$prompt" "$(t "Instalar" "Install")" "$(t "Cancelar" "Cancel")" "${items[@]}" -- "${items[@]}")"
[ -n "$chosen" ] || exit 0
has() { printf '%s\n' "$chosen" | grep -q "^$1"; }

# Programs that are open would keep the old version (or overwrite the new one).
open_apps=()
has "After Effects" && running "Adobe After Effects" && open_apps+=("After Effects")
has "Photoshop" && running "Adobe Photoshop" && open_apps+=("Photoshop")
has "Illustrator" && running "Adobe Illustrator" && open_apps+=("Illustrator")
has "Premiere Pro" && running "Adobe Premiere Pro" && open_apps+=("Premiere Pro")
has "Blender" && running "Blender.app" && open_apps+=("Blender")
has "Cinema 4D" && running "Cinema 4D" && open_apps+=("Cinema 4D")
if [ "${#open_apps[@]}" -gt 0 ]; then
  again="$(dialog "$(t "Feche antes de instalar:" "Close before installing:") $(printf '%s, ' "${open_apps[@]}" | sed 's/, $//')" "$(t "Já fechei" "Done")" "$(t "Cancelar" "Cancel")" "$(t "Já fechei" "Done")")"
  [ "$again" = "$(t "Já fechei" "Done")" ] || exit 0
fi

# Figma and Cavalry need the Soma Hub, which needs Python 3.
python=""
if has "Figma" || has "Cavalry"; then
  python="$(find_python)"
  if [ -z "$python" ]; then
    get="$(dialog "$(t "O Figma e o Cavalry precisam do Python 3, que ainda não está neste Mac. Instale o Python e rode este instalador de novo. Os outros programas são instalados agora." "Figma and Cavalry need Python 3, which is not on this Mac yet. Install Python and run this installer again. The other programs are installed now.")" "$(t "Baixar o Python" "Download Python")" "$(t "Continuar sem" "Continue without")" "$(t "Baixar o Python" "Download Python")")"
    [ "$get" = "$(t "Baixar o Python" "Download Python")" ] && open "https://www.python.org/downloads/macos/"
  fi
fi

echo "  $(t "Instalando…" "Installing…")"
lines=()
if has "After Effects" || has "Photoshop" || has "Illustrator" || has "Premiere Pro"; then
  install_adobe
  for name in "After Effects" "Photoshop" "Illustrator" "Premiere Pro"; do has "$name" && lines+=("$name: Window > Extensions > Soma Agente"); done
fi
if has "Blender"; then install_blender; lines+=("$(t "Blender: 3D View > barra lateral (tecla N) > aba Soma" "Blender: 3D View > sidebar (N key) > Soma tab")"); fi
if has "Cinema 4D"; then install_c4d; lines+=("$(t "Cinema 4D: menu Extensions > Soma Agente" "Cinema 4D: Extensions menu > Soma Agente")"); fi
if has "Cavalry"; then install_cavalry; lines+=("$(t "Cavalry: menu Scripts > Soma Agente" "Cavalry: Scripts menu > Soma Agente")"); fi
if [ -n "$python" ]; then
  install_hub "$python"
  if has "Figma"; then
    printf '%s' "$HUB_HOME/plugin/manifest.json" | pbcopy
    lines+=("$(t "Figma: Plugins > Development > Import plugin from manifest… (o caminho já está copiado: cole com Cmd+V)" "Figma: Plugins > Development > Import plugin from manifest… (the path is copied: paste with Cmd+V)")")
  fi
elif has "Figma" || has "Cavalry"; then
  lines+=("$(t "Figma e Cavalry: instale o Python 3 e rode este instalador de novo." "Figma and Cavalry: install Python 3 and run this installer again.")")
fi
[ -n "$VERSION" ] && printf '%s' "$VERSION" > "$DATA/installed-version.txt"
step "$(t "Pronto." "Done.")"
echo

summary="$(t "Pronto! Reabra os programas e, na primeira vez, escolha a IA e conecte sua conta." "Done! Reopen the programs and, the first time, pick the AI and connect your account.")

$(printf '• %s\n' "${lines[@]}")

$(t "Para atualizar, baixe a versão nova no GitHub e rode este instalador de novo." "To update, download the new version from GitHub and run this installer again.")"
dialog "$summary" "OK" "$(t "Abrir o GitHub" "Open GitHub")" "OK" | grep -q "GitHub" && open "https://github.com/alanomoxo/soma-agente/releases/latest"
printf '%s\n' "${lines[@]}" | sed 's/^/  /'
echo
echo "  $(t "Pode fechar esta janela." "You can close this window.")"
