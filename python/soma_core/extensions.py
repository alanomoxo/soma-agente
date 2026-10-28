"""Skills and connectors shared by every Soma program.

Skills follow the open SKILL.md format (a folder with SKILL.md: front matter
`name` and `description`, then instructions). The agent sees the list and
reads a skill with soma_read_skill when a request matches it.

Connectors are MCP servers (stdio command or HTTP URL) given to the AI next to
the program's own tools. A connector runs a program on this computer, so one
added by the agent (or installed from the internet) stays pending until the
user approves it in a Soma panel. The same goes for skills downloaded from a
URL, because their text becomes instructions for the agent.

Everything lives in the shared data folder:
    skills/<slug>/SKILL.md          (a file named .disabled or .pending marks state)
    connectors.json                 {"connectors": {name: {...}}}
"""
import json
import os
import re
import shutil
import urllib.parse
import urllib.request

from . import system

SLUG = re.compile(r"[^a-z0-9-]+")


def _skills_dir():
    path = os.path.join(system.data_directory(), "skills")
    os.makedirs(path, exist_ok=True)
    return path


def _connectors_file():
    return os.path.join(system.data_directory(), "connectors.json")


def slugify(name):
    slug = SLUG.sub("-", str(name or "").strip().lower()).strip("-")
    if not slug:
        raise ValueError("Give the skill or connector a name (letters, numbers, dashes).")
    return slug[:60]


def parse_skill(text):
    """Front matter (name, description) and body of a SKILL.md."""
    meta, body = {}, text
    match = re.match(r"^---\s*\n(.*?)\n---\s*\n?(.*)$", text, re.S)
    if match:
        body = match.group(2)
        block = None
        for line in match.group(1).splitlines():
            # Indented lines continue a block value (description: > or |).
            if block and re.match(r"^\s+\S", line):
                meta[block] = (meta[block] + " " if meta[block] else "") + line.strip()
                continue
            block = None
            if ":" in line:
                key, value = line.split(":", 1)
                key, value = key.strip().lower(), value.strip()
                if re.match(r"^[>|][-+]?$", value):
                    block, meta[key] = key, ""
                    continue
                meta[key] = value.strip('"').strip("'")
    return meta, body


# ------------------------------------------------------------------ skills
def list_skills():
    skills = []
    root = _skills_dir()
    for slug in sorted(os.listdir(root)):
        file = os.path.join(root, slug, "SKILL.md")
        if not os.path.isfile(file):
            continue
        with open(file, "r", encoding="utf-8", errors="replace") as handle:
            meta, _ = parse_skill(handle.read())
        state = "pending" if os.path.exists(os.path.join(root, slug, ".pending")) else ("disabled" if os.path.exists(os.path.join(root, slug, ".disabled")) else "enabled")
        skills.append({"name": slug, "title": meta.get("name") or slug, "description": meta.get("description", ""), "state": state})
    return skills


def read_skill(name):
    slug = slugify(name)
    folder = os.path.join(_skills_dir(), slug)
    file = os.path.join(folder, "SKILL.md")
    if not os.path.isfile(file):
        raise ValueError("Skill %s not found. Use soma_list_skills." % name)
    if os.path.exists(os.path.join(folder, ".pending")):
        raise ValueError("Skill %s is waiting for the user's approval in the Soma panel." % slug)
    with open(file, "r", encoding="utf-8", errors="replace") as handle:
        text = handle.read()
    others = []
    for path, _dirs, files in os.walk(folder):
        for f in files:
            if f not in ("SKILL.md", ".disabled", ".pending"):
                others.append(os.path.relpath(os.path.join(path, f), folder))
    return {"name": slug, "folder": folder, "skill": text, "files": others[:100]}


def write_skill(name, description, instructions, pending=False):
    slug = slugify(name)
    folder = os.path.join(_skills_dir(), slug)
    os.makedirs(folder, exist_ok=True)
    text = "---\nname: %s\ndescription: %s\n---\n\n%s\n" % (name, str(description or "").replace("\n", " "), str(instructions or "").strip())
    with open(os.path.join(folder, "SKILL.md"), "w", encoding="utf-8") as handle:
        handle.write(text)
    _mark(folder, "pending" if pending else "enabled")
    return {"name": slug, "state": "pending" if pending else "enabled", "folder": folder}


def _mark(folder, state):
    for flag in (".pending", ".disabled"):
        try:
            os.remove(os.path.join(folder, flag))
        except OSError:
            pass
    if state in ("pending", "disabled"):
        open(os.path.join(folder, "." + state), "w").close()


def set_skill_state(name, state):
    folder = os.path.join(_skills_dir(), slugify(name))
    if not os.path.isdir(folder):
        raise ValueError("Skill %s not found." % name)
    _mark(folder, state)


def delete_skill(name):
    folder = os.path.join(_skills_dir(), slugify(name))
    if os.path.isdir(folder):
        shutil.rmtree(folder)
    return {"deleted": slugify(name)}


def _get(url):
    request = urllib.request.Request(url, headers={"User-Agent": "SomaAgente", "Accept": "application/vnd.github+json"})
    with urllib.request.urlopen(request, timeout=60) as response:
        return response.read()


def install_skill_from_url(url):
    """A raw SKILL.md URL, or a GitHub folder URL (github.com/<owner>/<repo>/tree/<ref>/<path>).
    Downloaded skills wait for the user's approval."""
    match = re.match(r"https://github\.com/([^/]+)/([^/]+)/tree/([^/]+)/(.+?)/?$", url)
    if match:
        owner, repo, ref, path = match.groups()
        slug = slugify(path.split("/")[-1])
        folder = os.path.join(_skills_dir(), slug)
        os.makedirs(folder, exist_ok=True)

        def fetch(sub, target):
            api = "https://api.github.com/repos/%s/%s/contents/%s?ref=%s" % (owner, repo, urllib.parse.quote(sub), urllib.parse.quote(ref))
            for item in json.loads(_get(api).decode("utf-8")):
                destination = os.path.join(target, item["name"])
                if item["type"] == "dir":
                    os.makedirs(destination, exist_ok=True)
                    fetch(item["path"], destination)
                elif item["type"] == "file" and item.get("size", 0) < 5_000_000:
                    with open(destination, "wb") as handle:
                        handle.write(_get(item["download_url"]))
        fetch(path, folder)
    else:
        text = _get(url.replace("https://github.com/", "https://raw.githubusercontent.com/").replace("/blob/", "/")).decode("utf-8", "replace")
        meta, _ = parse_skill(text)
        slug = slugify(meta.get("name") or os.path.splitext(os.path.basename(urllib.parse.urlparse(url).path))[0])
        folder = os.path.join(_skills_dir(), slug)
        os.makedirs(folder, exist_ok=True)
        with open(os.path.join(folder, "SKILL.md"), "w", encoding="utf-8") as handle:
            handle.write(text)
    if not os.path.isfile(os.path.join(folder, "SKILL.md")):
        shutil.rmtree(folder, ignore_errors=True)
        raise ValueError("No SKILL.md found at %s." % url)
    _mark(folder, "pending")
    return {"name": slug, "state": "pending", "note": "Downloaded skills need the user's approval in the Soma panel before use."}


# -------------------------------------------------------------- connectors
def load_connectors():
    try:
        with open(_connectors_file(), "r", encoding="utf-8") as handle:
            data = json.load(handle)
        return data.get("connectors", {}) if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def save_connectors(connectors):
    with open(_connectors_file(), "w", encoding="utf-8") as handle:
        json.dump({"connectors": connectors}, handle, indent=2)


def add_connector(spec, added_by="agent"):
    name = slugify(spec.get("name"))
    if not spec.get("command") and not spec.get("url"):
        raise ValueError("A connector needs a command (stdio MCP server) or a url (HTTP MCP server).")
    entry = {"description": str(spec.get("description") or ""), "addedBy": added_by, "state": "pending" if added_by != "user" else "enabled"}
    if spec.get("url"):
        entry.update({"url": str(spec["url"]), "headers": dict(spec.get("headers") or {})})
    else:
        entry.update({"command": str(spec["command"]), "args": [str(a) for a in (spec.get("args") or [])], "env": {str(k): str(v) for k, v in (spec.get("env") or {}).items()}})
    connectors = load_connectors()
    connectors[name] = entry
    save_connectors(connectors)
    return {"name": name, "state": entry["state"]}


def set_connector_state(name, state):
    connectors = load_connectors()
    if name not in connectors:
        raise ValueError("Connector %s not found." % name)
    connectors[name]["state"] = state
    save_connectors(connectors)


def remove_connector(name):
    connectors = load_connectors()
    connectors.pop(slugify(name), None)
    save_connectors(connectors)
    return {"removed": slugify(name)}


def active_connectors():
    return {name: c for name, c in load_connectors().items() if c.get("state") == "enabled"}


def pending():
    """Things waiting for the user's approval, for the panels."""
    items = [{"kind": "connector", "name": n, "detail": c.get("url") or " ".join([c.get("command", "")] + c.get("args", [])), "description": c.get("description", "")}
             for n, c in load_connectors().items() if c.get("state") == "pending"]
    items += [{"kind": "skill", "name": s["name"], "detail": s["description"], "description": s["title"]} for s in list_skills() if s["state"] == "pending"]
    return items


def approve(kind, name, accept):
    if kind == "connector":
        if accept:
            set_connector_state(name, "enabled")
        else:
            remove_connector(name)
    else:
        if accept:
            set_skill_state(name, "enabled")
        else:
            delete_skill(name)


# ------------------------------------------------------------ agent side
def instructions():
    skills = [s for s in list_skills() if s["state"] == "enabled"]
    connectors = active_connectors()
    lines = ["Skills and connectors: you can extend yourself. soma_create_skill saves reusable know-how the user asks you to remember (a workflow, a style guide); "
             "soma_install_skill downloads a SKILL.md or a GitHub skill folder; soma_add_connector registers an MCP server (stdio command or HTTP URL). "
             "Downloaded skills and new connectors only work after the user approves them in the Soma panel, so tell the user to approve them; connectors become available from the next message.",
             UPDATE_INSTRUCTIONS]
    if skills:
        lines.append("Available skills (call soma_read_skill before using one whose description matches the request): " +
                     "; ".join("%s — %s" % (s["name"], s["description"] or s["title"]) for s in skills) + ".")
    if connectors:
        lines.append("Connected MCP servers you can use alongside the program's tools: " + ", ".join(
            "%s%s" % (n, (" (" + c["description"] + ")") if c.get("description") else "") for n, c in connectors.items()) + ".")
    return " ".join(lines)


TOOLS = [
    {"name": "soma_list_skills", "description": "List the Soma skills (reusable instructions) with their state.", "inputSchema": {"type": "object", "properties": {}, "additionalProperties": False}},
    {"name": "soma_read_skill", "description": "Read a skill's SKILL.md (and list its extra files) before following it.", "inputSchema": {"type": "object", "properties": {"name": {"type": "string"}}, "required": ["name"], "additionalProperties": False}},
    {"name": "soma_create_skill", "description": "Create or update a skill from instructions you write (what to do, steps, preferences). Ready immediately, in every Soma program.",
     "inputSchema": {"type": "object", "properties": {"name": {"type": "string"}, "description": {"type": "string", "description": "When to use it, one sentence."}, "instructions": {"type": "string", "description": "Markdown instructions."}}, "required": ["name", "description", "instructions"], "additionalProperties": False}},
    {"name": "soma_install_skill", "description": "Download a skill from a URL: a SKILL.md file or a GitHub folder (github.com/<owner>/<repo>/tree/<branch>/<path>). Waits for the user's approval.",
     "inputSchema": {"type": "object", "properties": {"url": {"type": "string"}}, "required": ["url"], "additionalProperties": False}},
    {"name": "soma_delete_skill", "description": "Delete a skill.", "inputSchema": {"type": "object", "properties": {"name": {"type": "string"}}, "required": ["name"], "additionalProperties": False}},
    {"name": "soma_list_connectors", "description": "List the MCP connectors and their state (enabled, pending approval, disabled).", "inputSchema": {"type": "object", "properties": {}, "additionalProperties": False}},
    {"name": "soma_add_connector", "description": "Register an MCP server as a connector: either command + args (+ env) for a stdio server, or url (+ headers) for an HTTP server. The user must approve it in the Soma panel; it is usable from the next message.",
     "inputSchema": {"type": "object", "properties": {"name": {"type": "string"}, "description": {"type": "string"}, "command": {"type": "string"}, "args": {"type": "array", "items": {"type": "string"}},
                                                       "env": {"type": "object", "additionalProperties": {"type": "string"}}, "url": {"type": "string"}, "headers": {"type": "object", "additionalProperties": {"type": "string"}}},
                     "required": ["name"], "additionalProperties": False}},
    {"name": "soma_remove_connector", "description": "Remove a connector.", "inputSchema": {"type": "object", "properties": {"name": {"type": "string"}}, "required": ["name"], "additionalProperties": False}},
    {"name": "soma_check_update", "description": "Check GitHub now for a newer Soma Agente: returns the installed version, the latest version, whether an update is available and its release notes.",
     "inputSchema": {"type": "object", "properties": {}, "additionalProperties": False}},
    {"name": "soma_install_update", "description": "Install the latest Soma Agente now (only after the user asked for it). It installs as soon as no Adobe program is open, so tell the user to save and close them.",
     "inputSchema": {"type": "object", "properties": {}, "additionalProperties": False}},
]

UPDATE_INSTRUCTIONS = ("Updates: soma_check_update checks GitHub for a newer Soma Agente; when the user asks about updates or new versions, call it and answer with "
                       "the installed and latest versions and what changed. soma_install_update installs it, only when the user asks.")

HUB_URL = "http://127.0.0.1:47821"


def hub_update(action, force=False):
    """Asks the Soma Hub to check ("check") or install ("install") the latest Release."""
    request = urllib.request.Request(HUB_URL + "/hub/update/" + action, data=json.dumps({"force": force}).encode("utf-8"),
                                     method="POST", headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(request, timeout=90) as response:
            return json.loads(response.read().decode("utf-8"))
    except OSError:
        raise RuntimeError("The Soma Hub is not running, so updates cannot be checked. Reinstall Soma Agente or open “Soma Hub” from the Start menu.")


def call(name, args):
    """Runs a soma_* tool; returns the usual {"ok", "data"|"error"} dict."""
    try:
        if name == "soma_list_skills":
            data = {"skills": list_skills()}
        elif name == "soma_read_skill":
            data = read_skill(args.get("name"))
        elif name == "soma_create_skill":
            data = write_skill(args.get("name"), args.get("description"), args.get("instructions"))
        elif name == "soma_install_skill":
            data = install_skill_from_url(str(args.get("url") or ""))
        elif name == "soma_delete_skill":
            data = delete_skill(args.get("name"))
        elif name == "soma_list_connectors":
            data = {"connectors": [dict(c, name=n, env=sorted((c.get("env") or {}).keys()), headers=sorted((c.get("headers") or {}).keys())) for n, c in load_connectors().items()]}
        elif name == "soma_add_connector":
            data = add_connector(args, "agent")
            data["note"] = "Ask the user to approve the connector in the Soma panel; it works from the next message."
        elif name == "soma_remove_connector":
            data = remove_connector(args.get("name"))
        elif name == "soma_check_update":
            data = hub_update("check", force=True)
        elif name == "soma_install_update":
            data = hub_update("install")
        else:
            return {"ok": False, "error": "Unknown tool %s" % name}
        return {"ok": True, "data": data}
    except Exception as error:  # noqa: BLE001 - reported to the model
        return {"ok": False, "error": "%s: %s" % (type(error).__name__, error)}


# ------------------------------------------------------ provider configs
def claude_servers():
    servers = {}
    for name, c in active_connectors().items():
        if c.get("url"):
            servers[name] = {"type": "http", "url": c["url"], "headers": c.get("headers") or {}}
        else:
            servers[name] = {"command": c["command"], "args": c.get("args") or [], "env": c.get("env") or {}}
    return servers


def sync_antigravity():
    """Antigravity reads one global MCP config: keep a soma-<name> entry per enabled
    connector (stale ones removed) and allow headless agy to call their tools."""
    wanted = {}
    for name, c in active_connectors().items():
        if c.get("url"):
            wanted["soma-" + name] = {"serverUrl": c["url"], "headers": c.get("headers") or {}}
        else:
            wanted["soma-" + name] = {"command": c["command"], "args": c.get("args") or [], "env": c.get("env") or {}}
    for path in system.antigravity_config_paths():
        try:
            with open(path, "r", encoding="utf-8") as handle:
                text = handle.read().strip()
            config = json.loads(text) if text else {}
        except (OSError, ValueError):
            continue
        servers = config.setdefault("mcpServers", {})
        before = json.dumps(servers, sort_keys=True)
        for key in [k for k in servers if k.startswith("soma-")]:
            del servers[key]
        servers.update(wanted)
        if json.dumps(servers, sort_keys=True) != before:
            with open(path, "w", encoding="utf-8") as handle:
                json.dump(config, handle, indent=2)
    settings_path = os.path.join(system.HOME, ".gemini", "antigravity-cli", "settings.json")
    try:
        with open(settings_path, "r", encoding="utf-8") as handle:
            text = handle.read().strip()
        settings = json.loads(text) if text else {}
    except OSError:
        settings = {}
    except ValueError:
        return
    allow = settings.setdefault("permissions", {}).setdefault("allow", [])
    rules = ["mcp(%s/*)" % key for key in wanted]
    kept = [r for r in allow if not r.startswith("mcp(soma-")]
    if kept + rules != allow:
        settings["permissions"]["allow"] = kept + rules
        os.makedirs(os.path.dirname(settings_path), exist_ok=True)
        with open(settings_path, "w", encoding="utf-8") as handle:
            json.dump(settings, handle, indent=2)


def codex_overrides():
    """-c overrides for codex exec, one MCP server per connector."""
    args = []
    for name, c in active_connectors().items():
        key = "mcp_servers.%s" % name
        if c.get("url"):
            args += ["-c", "%s.url=%s" % (key, json.dumps(c["url"]))]
            if c.get("headers"):
                args += ["-c", "%s.http_headers={%s}" % (key, ", ".join("%s = %s" % (json.dumps(k), json.dumps(v)) for k, v in c["headers"].items()))]
        else:
            args += ["-c", "%s.command=%s" % (key, json.dumps(c["command"])), "-c", "%s.args=%s" % (key, json.dumps(c.get("args") or []))]
            if c.get("env"):
                args += ["-c", "%s.env={%s}" % (key, ", ".join("%s = %s" % (json.dumps(k), json.dumps(v)) for k, v in c["env"].items()))]
        args += ["-c", "%s.default_tools_approval_mode=\"approve\"" % key]
    return args
