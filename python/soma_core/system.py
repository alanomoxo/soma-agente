"""Finding Claude Code and Codex on this computer, and where Soma keeps its data.

Mirrors js/platform.js of the Adobe panel so every program finds the same
binaries and shares the same data folder (claude-path.txt / codex-path.txt).
"""
import glob
import json
import os
import subprocess
import sys

WINDOWS = sys.platform == "win32"
HOME = os.path.expanduser("~")


def data_directory():
    if WINDOWS:
        base = os.environ.get("APPDATA") or os.path.join(HOME, "AppData", "Roaming")
        path = os.path.join(base, "AE Agent")
    else:
        path = os.path.join(HOME, "Library", "Application Support", "AE Agent")
    os.makedirs(path, exist_ok=True)
    return path


def _executable(path):
    try:
        if not os.path.isfile(path):
            return False
        if WINDOWS:
            return path.lower().endswith(".exe")
        return os.access(path, os.X_OK)
    except OSError:
        return False


def _saved(name):
    file = os.path.join(data_directory(), name)
    try:
        with open(file, "r", encoding="utf-8") as handle:
            return handle.read().strip()
    except OSError:
        return None


def _path_dirs():
    """PATH of this process plus, on Windows, the saved user and machine PATH
    (a CLI installed after login is not yet in the inherited PATH)."""
    sep = ";" if WINDOWS else ":"
    values = [os.environ.get("PATH", "")]
    if WINDOWS:
        import winreg
        for hive, key in ((winreg.HKEY_CURRENT_USER, "Environment"),
                          (winreg.HKEY_LOCAL_MACHINE, r"SYSTEM\CurrentControlSet\Control\Session Manager\Environment")):
            try:
                with winreg.OpenKey(hive, key) as handle:
                    values.append(winreg.QueryValueEx(handle, "Path")[0])
            except OSError:
                pass
    dirs = []
    for value in values:
        for d in value.split(sep):
            d = os.path.expandvars(d.strip().strip('"'))
            if d and d.lower() not in [x.lower() for x in dirs]:
                dirs.append(d)
    return dirs


def _on_path(exe):
    found = [os.path.join(d, exe) for d in _path_dirs()]
    if WINDOWS:
        local = os.environ.get("LOCALAPPDATA") or os.path.join(HOME, "AppData", "Local")
        found.append(os.path.join(local, "Microsoft", "WinGet", "Links", exe))
    return found


def _in_node_modules(scope, exe):
    """Native binaries that npm, pnpm or nvm installs keep inside node_modules
    (on Windows npm only puts .cmd shims on the PATH)."""
    if WINDOWS:
        roaming = os.environ.get("APPDATA") or os.path.join(HOME, "AppData", "Roaming")
        local = os.environ.get("LOCALAPPDATA") or os.path.join(HOME, "AppData", "Local")
        roots = [os.path.join(roaming, "npm"), os.path.join(local, "pnpm")]
        shim = os.path.splitext(exe)[0] + ".cmd"
        roots += [d for d in _path_dirs() if os.path.isfile(os.path.join(d, shim))]
    else:
        roots = ["/opt/homebrew/lib", "/usr/local/lib", os.path.join(HOME, ".npm-global", "lib")]
    found = []
    for root in roots:
        modules = [os.path.join(root, "node_modules")] + glob.glob(os.path.join(root, "global", "*", "node_modules"))
        for module in modules:
            base = os.path.join(module, scope)
            for path, dirs, files in os.walk(base):
                if path[len(base):].count(os.sep) >= 9:
                    dirs[:] = []
                if exe in files:
                    found.append(os.path.join(path, exe))
    return found


def _version_key(name):
    parts = []
    for piece in name.split("."):
        parts.append(int(piece) if piece.isdigit() else 0)
    return parts


def find_claude():
    exe = "claude.exe" if WINDOWS else "claude"
    candidates = [os.environ.get("CLAUDE_BIN"), _saved("claude-path.txt"), os.path.join(HOME, ".local", "bin", exe)]
    roots = []
    if WINDOWS:
        roaming = os.environ.get("APPDATA") or os.path.join(HOME, "AppData", "Roaming")
        local = os.environ.get("LOCALAPPDATA") or os.path.join(HOME, "AppData", "Local")
        roots.append(os.path.join(roaming, "Claude", "claude-code"))
        for parent in (os.path.join(local, "Claude-Data"), os.path.join(local, "Packages")):
            for folder in glob.glob(os.path.join(parent, "Claude_*")):
                roots.append(os.path.join(folder, "claude-code"))
                roots.append(os.path.join(folder, "LocalCache", "Roaming", "Claude", "claude-code"))
    else:
        candidates += ["/opt/homebrew/bin/claude", "/usr/local/bin/claude", os.path.join(HOME, ".claude", "local", "claude")]
        roots.append(os.path.join(HOME, "Library", "Application Support", "Claude", "claude-code"))
    versions = []
    for root in roots:
        try:
            for name in os.listdir(root):
                if all(p.isdigit() for p in name.split(".")):
                    versions.append((name, os.path.join(root, name)))
        except OSError:
            pass
    for _, folder in sorted(versions, key=lambda v: _version_key(v[0]), reverse=True):
        for path, _dirs, files in os.walk(folder):
            if exe in files:
                candidates.append(os.path.join(path, exe))
    candidates += _on_path(exe) + _in_node_modules("@anthropic-ai", exe)
    for candidate in candidates:
        if candidate and _executable(candidate):
            return candidate
    return None


def find_codex():
    exe = "codex.exe" if WINDOWS else "codex"
    candidates = [os.environ.get("CODEX_BIN"), _saved("codex-path.txt")]
    if WINDOWS:
        local = os.environ.get("LOCALAPPDATA") or os.path.join(HOME, "AppData", "Local")
        bundled = glob.glob(os.path.join(local, "OpenAI", "Codex", "bin", "*", exe))
        candidates += sorted(bundled, key=lambda p: os.path.getmtime(p), reverse=True)
    else:
        candidates += ["/Applications/Codex.app/Contents/Resources/codex", "/opt/homebrew/bin/codex", "/usr/local/bin/codex"]
    candidates.append(os.path.join(HOME, ".local", "bin", exe))
    candidates += _on_path(exe) + _in_node_modules("@openai", exe)
    for candidate in candidates:
        if candidate and _executable(candidate):
            return candidate
    return None


def find_agy():
    """Antigravity CLI (agy): saved path, its installer's folder, ~/.local/bin, PATH."""
    exe = "agy.exe" if WINDOWS else "agy"
    candidates = [os.environ.get("AGY_BIN"), _saved("agy-path.txt")]
    if WINDOWS:
        local = os.environ.get("LOCALAPPDATA") or os.path.join(HOME, "AppData", "Local")
        candidates.append(os.path.join(local, "agy", "bin", exe))
        candidates.append(os.path.join(local, "Programs", "Antigravity", "bin", exe))
    candidates.append(os.path.join(HOME, ".local", "bin", exe))
    candidates += _on_path(exe)
    for candidate in candidates:
        if candidate and _executable(candidate):
            return candidate
    return None


HUB_TOKEN_FILE = "hub-token.txt"


def antigravity_config_paths():
    """MCP config files read by the Antigravity CLI/IDE and by the Antigravity app."""
    gemini = os.path.join(HOME, ".gemini")
    return [os.path.join(gemini, "config", "mcp_config.json"), os.path.join(gemini, "antigravity", "mcp_config.json")]


def ensure_antigravity_config():
    """Adds the Soma Hub (soma) to Antigravity's MCP config, keeping every other server.
    Returns False when the hub has never run (no token yet)."""
    try:
        with open(os.path.join(data_directory(), HUB_TOKEN_FILE), "r", encoding="utf-8") as handle:
            token = handle.read().strip()
    except OSError:
        return False
    if not token:
        return False
    entry = {"serverUrl": "http://127.0.0.1:47821/mcp", "headers": {"Authorization": "Bearer " + token}, "timeoutSeconds": 3600}
    for path in antigravity_config_paths():
        try:
            with open(path, "r", encoding="utf-8") as handle:
                text = handle.read().strip()
            config = json.loads(text) if text else {}
        except (OSError, ValueError):
            config = {}
        if not isinstance(config, dict):
            continue
        servers = config.setdefault("mcpServers", {})
        if servers.get("soma") == entry:
            continue
        servers["soma"] = entry
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as handle:
            json.dump(config, handle, indent=2)
    _allow_soma_tools()
    return True


SOMA_TOOL_RULES = ["mcp(soma/*)"]


def _allow_soma_tools():
    """Headless agy denies MCP tools unless allowed; allow only the three Soma Hub tools."""
    path = os.path.join(HOME, ".gemini", "antigravity-cli", "settings.json")
    try:
        with open(path, "r", encoding="utf-8") as handle:
            text = handle.read().strip()
        settings = json.loads(text) if text else {}
    except (OSError, ValueError):
        settings = {}
    if not isinstance(settings, dict):
        return
    permissions = settings.setdefault("permissions", {})
    allow = permissions.setdefault("allow", [])
    missing = [rule for rule in SOMA_TOOL_RULES if rule not in allow]
    if not missing:
        return
    allow.extend(missing)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(settings, handle, indent=2)


def environment(binary):
    """Inherited environment with the binary's folder (and, on macOS, the usual
    install folders) on PATH, as apps started from the Dock get a minimal PATH."""
    env = dict(os.environ)
    sep = ";" if WINDOWS else ":"
    entries = [os.path.dirname(binary)]
    if not WINDOWS:
        entries += ["/usr/local/bin", "/opt/homebrew/bin", os.path.join(HOME, ".local", "bin"), "/usr/bin", "/bin"]
    for item in env.get("PATH", "").split(sep):
        if item and item not in entries:
            entries.append(item)
    env["PATH"] = sep.join(entries)
    # Python hosts (Blender, Cinema 4D) set these for their own interpreter.
    for key in ("PYTHONHOME", "PYTHONPATH"):
        env.pop(key, None)
    return env


def hidden_window_flags():
    return subprocess.CREATE_NO_WINDOW if WINDOWS else 0


def open_url(url):
    try:
        if WINDOWS:
            os.startfile(url)  # noqa: S606 - opens the default browser
        else:
            subprocess.Popen(["open", url])
    except OSError:
        pass


INSTALL_SCRIPTS = {"claude": "https://claude.ai/install.ps1", "antigravity": "https://antigravity.google/cli/install.ps1"}


def install_cli(provider, done_text):
    """Runs the official installer of Claude Code or the Antigravity CLI in a
    visible PowerShell window. Returns the process, or None when not on Windows."""
    if not WINDOWS or provider not in INSTALL_SCRIPTS:
        return None
    command = "irm %s | iex; Write-Host ''; Write-Host '%s'; Start-Sleep -Seconds 6" % (INSTALL_SCRIPTS[provider], done_text.replace("'", "''"))
    return subprocess.Popen(["powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command],
                            creationflags=subprocess.CREATE_NEW_CONSOLE)


def has_claude_app():
    """The Claude chat app (it does not include Claude Code)."""
    local = os.environ.get("LOCALAPPDATA") or os.path.join(HOME, "AppData", "Local")
    if not WINDOWS:
        return os.path.isdir("/Applications/Claude.app")
    return bool(glob.glob(os.path.join(local, "Packages", "Claude_*"))) or os.path.isdir(os.path.join(local, "AnthropicClaude"))


def has_antigravity_app():
    """The Antigravity app (the agy CLI is installed separately)."""
    local = os.environ.get("LOCALAPPDATA") or os.path.join(HOME, "AppData", "Local")
    return os.path.isfile(os.path.join(local, "Programs", "Antigravity", "Antigravity.exe")) if WINDOWS else os.path.isdir("/Applications/Antigravity.app")


def open_login_window(binary, args, title):
    """Runs `<binary> <args>` in a visible terminal so the user can sign in."""
    if WINDOWS:
        command = 'start "%s" "%s" %s' % (title, binary, " ".join(args))
        subprocess.Popen(["cmd.exe", "/d", "/c", command], creationflags=subprocess.CREATE_NEW_CONSOLE)
    else:
        script = os.path.join(data_directory(), title.lower().replace(" ", "-") + ".command")
        quoted = "'" + binary.replace("'", "'\\''") + "'"
        with open(script, "w", encoding="utf-8") as handle:
            handle.write("#!/bin/zsh\n%s %s\necho\necho 'You can close this window.'\n" % (quoted, " ".join(args)))
        os.chmod(script, 0o755)
        subprocess.Popen(["open", "-a", "Terminal", script])
