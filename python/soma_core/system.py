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


def _on_path(exe):
    sep = ";" if WINDOWS else ":"
    return [os.path.join(d, exe) for d in os.environ.get("PATH", "").split(sep) if d]


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
    candidates += _on_path(exe)
    for candidate in candidates:
        if candidate and _executable(candidate):
            return candidate
    return None


def find_codex():
    exe = "codex.exe" if WINDOWS else "codex"
    candidates = [os.environ.get("CODEX_BIN"), _saved("codex-path.txt")]
    if WINDOWS:
        local = os.environ.get("LOCALAPPDATA") or os.path.join(HOME, "AppData", "Local")
        roaming = os.environ.get("APPDATA") or os.path.join(HOME, "AppData", "Roaming")
        bundled = glob.glob(os.path.join(local, "OpenAI", "Codex", "bin", "*", exe))
        candidates += sorted(bundled, key=lambda p: os.path.getmtime(p), reverse=True)
        candidates.append(os.path.join(roaming, "npm", "node_modules", "@openai", "codex", "vendor", "x86_64-pc-windows-msvc", "codex", exe))
    else:
        candidates += ["/Applications/Codex.app/Contents/Resources/codex", "/opt/homebrew/bin/codex", "/usr/local/bin/codex"]
    candidates.append(os.path.join(HOME, ".local", "bin", exe))
    candidates += _on_path(exe)
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


SOMA_TOOL_RULES = ["mcp(soma/list_apps)", "mcp(soma/get_app_tools)", "mcp(soma/call_app_tool)"]


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
