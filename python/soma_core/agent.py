"""The Soma agent loop shared by Blender, Cinema 4D and the Figma bridge.

A host (the program) provides its tools; the agent exposes them through a local
MCP server and runs Claude Code or Codex headless for each turn, exactly like
the Adobe panel does. Tool calls arrive on the MCP server's threads and are
queued for the host's main thread: hosts call Agent.pump() from a timer.

Host interface (duck-typed):
    id, name, namespace         short id, display name, MCP server name
    instructions                system instructions (str)
    tools                       list of {"name", "description", "inputSchema"}
    call_tool(name, args)       runs on the main thread, returns
                                {"ok": bool, "data": ..., "error": str, "images": [png paths]}
"""
import base64
import json
import os
import platform
import queue
import secrets
import subprocess
import threading
import time
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from . import extensions, system
from .i18n import L

VERSION = "1.7.3"
FEEDBACK_URL = "https://github.com/alanomoxo/soma-agente/issues/new"
CLAUDE_EFFORTS = ["low", "medium", "high", "xhigh", "max"]
CLAUDE_MODELS = [
    {"id": "default", "model": None, "name": "Claude (default)", "efforts": [], "effort": None},
    {"id": "opus", "model": "opus", "name": "Claude Opus", "efforts": CLAUDE_EFFORTS, "effort": "high"},
    {"id": "sonnet", "model": "sonnet", "name": "Claude Sonnet", "efforts": CLAUDE_EFFORTS, "effort": "medium"},
    {"id": "haiku", "model": "haiku", "name": "Claude Haiku", "efforts": [], "effort": None},
]
PROVIDERS = {"claude": "Claude", "chatgpt": "ChatGPT", "antigravity": "Antigravity"}
AGY_DEFAULT = {"id": "default", "model": None, "name": "Antigravity (default)", "efforts": [], "effort": None}
HUB_URL = "http://127.0.0.1:47821"
IMAGE_TYPES = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp"}


def codex_home():
    return os.environ.get("CODEX_HOME") or os.path.join(system.HOME, ".codex")


def codex_models():
    models = [{"id": "default", "model": None, "name": "ChatGPT (default)", "efforts": [], "effort": None}]
    try:
        with open(os.path.join(codex_home(), "models_cache.json"), "r", encoding="utf-8") as handle:
            cache = json.load(handle)
        for m in cache.get("models", []):
            if m.get("slug") and m.get("visibility") != "hide":
                models.append({
                    "id": m["slug"], "model": m["slug"], "name": m.get("display_name") or m["slug"],
                    "efforts": [level.get("effort") for level in m.get("supported_reasoning_levels", []) if level.get("effort")],
                    "effort": m.get("default_reasoning_level"),
                })
    except (OSError, ValueError):
        pass
    return models



def feedback_url(program, ai=""):
    """New-issue link for suggestions and bug reports, with what the person is running."""
    body = L("**Version:** %s\n**Program:** %s\n**System:** %s\n**AI:** %s\n\n**What happened, or what do you suggest?**\n\n",
             "**Versão:** %s\n**Programa:** %s\n**Sistema:** %s\n**IA:** %s\n\n**O que aconteceu ou o que você sugere?**\n\n") % (
        VERSION, program, platform.platform(terse=True), ai or "-")
    return FEEDBACK_URL + "?" + urllib.parse.urlencode({"title": "[%s %s] " % (program, VERSION), "body": body})


class Settings:
    """Per-program preferences in the shared data folder."""

    def __init__(self, host_id):
        self.path = os.path.join(system.data_directory(), "soma-%s.json" % host_id)
        try:
            with open(self.path, "r", encoding="utf-8") as handle:
                self.values = json.load(handle)
        except (OSError, ValueError):
            self.values = {}

    def get(self, key, default=None):
        return self.values.get(key, default)

    def set(self, key, value):
        self.values[key] = value
        try:
            with open(self.path, "w", encoding="utf-8") as handle:
                json.dump(self.values, handle, indent=2)
        except OSError:
            pass


class _QuietServer(ThreadingHTTPServer):
    """Clients closing their connection early is normal; don't print tracebacks."""
    daemon_threads = True

    def handle_error(self, request, client_address):
        pass


class McpServer:
    """Streamable-HTTP MCP endpoint (JSON responses) on 127.0.0.1 with a bearer token."""

    def __init__(self, agent):
        self.agent = agent
        self.token = secrets.token_hex(24)
        self.httpd = None
        self.url = None

    def start(self):
        if self.httpd:
            return
        server = self

        class Handler(BaseHTTPRequestHandler):
            protocol_version = "HTTP/1.1"

            def log_message(self, *args):
                pass

            def _send(self, code, body=None):
                data = json.dumps(body).encode("utf-8") if body is not None else b""
                self.send_response(code)
                if body is not None:
                    self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                if data:
                    self.wfile.write(data)

            def do_DELETE(self):
                self._send(200 if self._authorized() else 401)

            def do_GET(self):
                self._send(405)

            def _authorized(self):
                return self.path.split("?")[0] == "/mcp" and self.headers.get("Authorization") == "Bearer " + server.token

            def do_POST(self):
                if not self._authorized():
                    self._send(401)
                    return
                length = int(self.headers.get("Content-Length") or 0)
                try:
                    body = json.loads(self.rfile.read(length).decode("utf-8"))
                except ValueError:
                    self._send(400, {"jsonrpc": "2.0", "id": None, "error": {"code": -32700, "message": "Parse error"}})
                    return
                batch = isinstance(body, list)
                external = self.headers.get("X-Soma-Caller") == "hub"
                replies = [r for r in (server.handle(m, external) for m in (body if batch else [body])) if r is not None]
                if not replies:
                    self._send(202)
                    return
                self._send(200, replies if batch else replies[0])

        self.httpd = _QuietServer(("127.0.0.1", 0), Handler)
        self.url = "http://127.0.0.1:%d/mcp" % self.httpd.server_address[1]
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()

    def stop(self):
        if self.httpd:
            self.httpd.shutdown()
            self.httpd.server_close()
            self.httpd = None

    def handle(self, message, external=False):
        if not isinstance(message, dict) or message.get("id") is None:
            return None
        params = message.get("params") or {}
        method = message.get("method")

        def reply(result):
            return {"jsonrpc": "2.0", "id": message["id"], "result": result}

        if method == "initialize":
            return reply({"protocolVersion": params.get("protocolVersion") or "2025-06-18",
                          "capabilities": {"tools": {"listChanged": False}},
                          "serverInfo": {"name": self.agent.host.namespace, "title": "Soma Agente", "version": VERSION}})
        if method == "ping":
            return reply({})
        if method == "tools/list":
            return reply({"tools": list(self.agent.host.tools) + extensions.TOOLS})
        if method == "tools/call":
            name = params.get("name") or ""
            if name.startswith("soma_"):
                # Skills and connectors are files in the data folder: no main thread needed.
                result = extensions.call(name, params.get("arguments") or {})
                return reply({"content": [{"type": "text", "text": json.dumps(result, default=str)}], "isError": not result.get("ok")})
            result = self.agent.call_tool_from_mcp(name, params.get("arguments") or {}, external)
            return reply(result)
        return {"jsonrpc": "2.0", "id": message["id"], "error": {"code": -32601, "message": "Method not supported: %s" % method}}


class Agent:
    def __init__(self, host):
        self.host = host
        self.settings = Settings(host.id)
        self.provider = self.settings.get("provider", "claude")
        if self.provider not in PROVIDERS:
            self.provider = "claude"
        self.messages = []
        self.revision = 0
        self.busy = False
        self.status = L("Starting…", "Iniciando…")
        self.thread_id = None
        self.proc = None
        self.binary = None
        self.version = ""
        self.signed_in = None
        self.stop_requested = False
        self.lock = threading.RLock()
        self.tool_requests = queue.Queue()
        self.mcp = McpServer(self)
        self.turn_counter = 0
        self._temp_files = []

    # ------------------------------------------------------------------ state
    def _changed(self):
        self.revision += 1

    def add_message(self, role, text, key=None, **extra):
        with self.lock:
            if key is not None:
                for message in self.messages:
                    if message.get("key") == key:
                        message["text"] = text
                        message.update(extra)
                        self._changed()
                        return message
            message = {"role": role, "text": text, "key": key, "time": time.time()}
            message.update(extra)
            self.messages.append(message)
            self._changed()
            return message

    def set_status(self, text):
        self.status = text
        self._changed()

    @property
    def provider_name(self):
        return PROVIDERS[self.provider]

    def models(self):
        if self.provider == "antigravity":
            return [AGY_DEFAULT] + getattr(self, "_agy_models", [])
        return CLAUDE_MODELS if self.provider == "claude" else codex_models()

    def selected_model(self):
        models = self.models()
        wanted = self.settings.get("model." + self.provider)
        for model in models:
            if model["id"] == wanted:
                return model
        return models[0]

    def select_model(self, model_id):
        self.settings.set("model." + self.provider, model_id)
        self._changed()

    def selected_effort(self):
        model = self.selected_model()
        wanted = self.settings.get("effort." + self.provider)
        if wanted in model["efforts"]:
            return wanted
        return model["effort"] if model["effort"] in model["efforts"] else (model["efforts"][0] if model["efforts"] else None)

    def select_effort(self, effort):
        self.settings.set("effort." + self.provider, effort)
        self._changed()

    # ------------------------------------------------------------ lifecycle
    def start(self):
        self.mcp.start()
        self.refresh()
        if not getattr(self.host, "remote", False):
            threading.Thread(target=self._hub_heartbeat, daemon=True).start()
            threading.Thread(target=self._update_loop, daemon=True).start()

    # -------------------------------------------------------------- updates
    def _update_loop(self):
        """Asks the Soma Hub to check GitHub when the program opens, then every few hours."""
        time.sleep(5)
        while self.mcp.httpd:
            self.check_update()
            time.sleep(3 * 3600)

    def check_update(self, force=False):
        """Latest Release info from the Soma Hub ({} when the hub is off)."""
        try:
            self.update = extensions.hub_update("check", force)
        except RuntimeError as error:
            self.update = {}
            if force:
                self.add_message("error", str(error))
        if force and self.update:
            if self.update.get("status") == "error":
                self.add_message("error", L("Could not check for updates: ", "Não deu para verificar atualizações: ") + str(self.update.get("detail")))
            elif not self.update.get("available"):
                self.add_message("status", L("You have the latest version (%s).", "Você está na versão mais recente (%s).") % self.update.get("current", VERSION))
        self._changed()
        return self.update

    def install_update(self):
        """Installs the newer version as soon as no Adobe program is open."""
        try:
            self.update = extensions.hub_update("install")
        except RuntimeError as error:
            self.add_message("error", str(error))
        self._changed()

    def update_text(self):
        """One line for the panel when a newer version exists, else ""."""
        u = getattr(self, "update", None) or {}
        if not (u.get("available") and u.get("latest")):
            return ""
        if u.get("requested") and u.get("status") == "waiting":
            return u.get("detail") or L("Close the Adobe programs to install %s", "Feche os programas Adobe para instalar a %s") % u["latest"]
        if u.get("requested"):
            return L("Installing %s — reopen %s afterwards", "Instalando a %s — reabra o %s depois") % (u["latest"], self.host.name)
        return L("Soma Agente %s is available (you have %s)", "Soma Agente %s disponível (você tem a %s)") % (u["latest"], u.get("current", VERSION))

    def shutdown(self):
        self.stop()
        self._hub_post("/hub/unregister")
        self.mcp.stop()

    # ----------------------------------------------------------------- hub
    def _hub_post(self, path):
        """Tells the Soma Hub where this program's tools are; skipped when the hub is not running."""
        if not self.mcp.url:
            return
        body = json.dumps({"id": self.host.id, "name": self.host.name, "namespace": self.host.namespace,
                           "url": self.mcp.url, "token": self.mcp.token}).encode("utf-8")
        try:
            request = urllib.request.Request(HUB_URL + path, data=body, method="POST", headers={"Content-Type": "application/json"})
            urllib.request.urlopen(request, timeout=3).read()
        except OSError:
            pass

    def _hub_heartbeat(self):
        while self.mcp.httpd:
            self._hub_post("/hub/register")
            time.sleep(30)

    def refresh(self):
        """Finds the binary and checks the sign-in in the background."""
        def work():
            if self.provider == "antigravity":
                self._refresh_agy()
                return
            self.binary = system.find_claude() if self.provider == "claude" else system.find_codex()
            if not self.binary:
                self.signed_in = None
                if self.provider == "claude":
                    self.set_status((L("The Claude app does not include Claude Code — ", "O app do Claude não inclui o Claude Code — ") if system.has_claude_app()
                                     else L("Claude Code not found — ", "Claude Code não encontrado — ")) +
                                    L("click Connect to install it (needs a Pro or Max plan)", "clique em Conectar para instalar (precisa do plano Pro ou Max)"))
                else:
                    self.set_status(L("Codex not found — install the Codex app (chatgpt.com/codex)", "Codex não encontrado — instale o app Codex (chatgpt.com/codex)"))
                return
            env = system.environment(self.binary)
            try:
                out = subprocess.run([self.binary, "--version"], capture_output=True, text=True, timeout=30, env=env, creationflags=system.hidden_window_flags())
                self.version = (out.stdout or "").strip()
                if self.provider == "claude":
                    out = subprocess.run([self.binary, "auth", "status"], capture_output=True, text=True, timeout=30, env=env, creationflags=system.hidden_window_flags())
                    try:
                        self.signed_in = bool(json.loads(out.stdout or "{}").get("loggedIn"))
                    except ValueError:
                        self.signed_in = False
                else:
                    out = subprocess.run([self.binary, "login", "status"], capture_output=True, text=True, timeout=30, env=env, creationflags=system.hidden_window_flags())
                    self.signed_in = out.returncode == 0 and "logged in" in ((out.stdout or "") + (out.stderr or "")).lower()
            except (OSError, subprocess.SubprocessError) as error:
                self.signed_in = None
                self.set_status(L("Could not start %s: %s", "Não deu para iniciar o %s: %s") % (self.provider_name, error))
                return
            self.set_status(L("%s ready", "%s pronto") % self.provider_name if self.signed_in else L("%s is not signed in — click Connect", "%s sem login — clique em Conectar") % self.provider_name)
        threading.Thread(target=work, daemon=True).start()

    def _refresh_agy(self):
        """Antigravity: find agy and list the account's models (agy models works
        only when signed in, so it doubles as the sign-in check)."""
        self.binary = system.find_agy()
        if not self.binary:
            self.signed_in = None
            self.set_status((L("The Antigravity app does not include its CLI (agy) — ", "O app do Antigravity não inclui a CLI (agy) — ") if system.has_antigravity_app()
                             else L("Antigravity CLI (agy) not found — ", "CLI do Antigravity (agy) não encontrada — ")) +
                            L("click Connect to install it", "clique em Conectar para instalar"))
            return
        try:
            out = subprocess.run([self.binary, "models"], capture_output=True, text=True, timeout=45,
                                 env=system.environment(self.binary), creationflags=system.hidden_window_flags(), stdin=subprocess.DEVNULL)
            models = []
            for line in (out.stdout or "").splitlines():
                parts = line.split("\t")
                if len(parts) == 2 and parts[0].strip() and " " not in parts[0].strip():
                    models.append({"id": parts[0].strip(), "model": parts[0].strip(), "name": parts[1].strip(), "efforts": [], "effort": None})
            self._agy_models = models
            self.signed_in = out.returncode == 0 and bool(models)
        except (OSError, subprocess.SubprocessError):
            self.signed_in = False
        if self.signed_in and not system.ensure_antigravity_config():
            self.set_status(L("Antigravity ready, but the Soma Hub is not running — reinstall Soma or start “Soma Hub”", "Antigravity pronto, mas o Soma Hub não está rodando — reinstale o Soma ou abra o “Soma Hub”"))
            return
        self.set_status(L("Antigravity ready", "Antigravity pronto") if self.signed_in else L("Antigravity is not signed in — click Connect", "Antigravity sem login — clique em Conectar"))

    def set_provider(self, provider):
        if provider not in PROVIDERS or provider == self.provider:
            return
        if self.busy:
            self.add_message("error", L("Wait for the current request to finish before switching the AI.", "Espere o pedido atual terminar antes de trocar a IA."))
            return
        self.provider = provider
        self.settings.set("provider", provider)
        # The conversation continues: the new AI starts its own session and gets
        # the chat so far with the next message (see _with_history).
        with self.lock:
            self.thread_id = None
        if any(m["role"] in ("user", "assistant") for m in self.messages):
            self.add_message("status", L("Switched to %s — the conversation continues.", "Trocado para o %s — a conversa continua.") % self.provider_name)
        self.set_status(L("Starting %s…", "Iniciando o %s…") % self.provider_name)
        self.refresh()

    def open_feedback(self):
        """A new GitHub issue prefilled with the version, program, system and AI."""
        system.open_url(feedback_url(self.host.name, self.provider_name))

    def login(self):
        if not self.binary:
            # Claude Code and the agy CLI have official one-line installers; run them and check again after.
            proc = system.install_cli(self.provider, L("Done. This window closes in a few seconds.", "Pronto. Esta janela fecha em alguns segundos."))
            if proc is None:
                system.open_url({"claude": "https://code.claude.com/docs/en/setup", "chatgpt": "https://chatgpt.com/codex", "antigravity": "https://antigravity.google/docs/getting-started"}[self.provider])
                return
            self.set_status(L("Installing %s in the window that opened…", "Instalando o %s na janela que abriu…") % ("Claude Code" if self.provider == "claude" else "Antigravity CLI"))
            threading.Thread(target=lambda: (proc.wait(), self.refresh()), daemon=True).start()
            return
        if self.provider == "antigravity":
            system.open_login_window(self.binary, [], "Antigravity login")
        elif self.provider == "claude":
            system.open_login_window(self.binary, ["auth", "login"], "Claude login")
        else:
            system.open_login_window(self.binary, ["login"], "ChatGPT login")
        self.set_status(L("Finish signing in in the browser, then click Check", "Termine o login no navegador e clique em Verificar"))

        def poll():
            deadline = time.time() + 300
            while time.time() < deadline and not self.signed_in:
                time.sleep(4)
                self.refresh()
        threading.Thread(target=poll, daemon=True).start()

    def new_chat(self):
        if self.busy:
            return
        with self.lock:
            self.thread_id = None
            self.messages = []
            self._changed()

    # ------------------------------------------------------------- tools
    def call_tool_from_mcp(self, name, args, external=False):
        """Runs on an MCP server thread: hands the call to the main thread and waits.
        External calls come from another agent (Antigravity) through the Soma Hub."""
        if external:
            self.add_message("tool", "Antigravity · " + self._tool_label(name, args), state="done", tool=name)
        elif self.busy and self.stop_requested:
            return {"content": [{"type": "text", "text": json.dumps({"ok": False, "error": "Request stopped; the tool was not run."})}], "isError": True}
        done = threading.Event()
        holder = {}
        self.tool_requests.put((name, args, holder, done))
        done.wait()
        result = holder.get("result") or {"ok": False, "error": "The tool did not return."}
        images = result.pop("images", None) or []
        content = [{"type": "text", "text": json.dumps(result, default=str)}]
        for path in images:
            try:
                with open(path, "rb") as handle:
                    data = base64.b64encode(handle.read()).decode("ascii")
                content.append({"type": "image", "mimeType": "image/png", "data": data})
            except OSError:
                pass
            finally:
                try:
                    os.remove(path)
                except OSError:
                    pass
        return {"content": content, "isError": result.get("ok") is not True}

    def pump(self, budget=0.05):
        """Main thread: runs queued tool calls. Returns True when something ran."""
        ran = False
        started = time.time()
        while time.time() - started < budget:
            try:
                name, args, holder, done = self.tool_requests.get_nowait()
            except queue.Empty:
                break
            ran = True
            try:
                holder["result"] = self.host.call_tool(name, args)
            except Exception as error:  # noqa: BLE001 - every failure goes back to the model
                holder["result"] = {"ok": False, "error": "%s: %s" % (type(error).__name__, error)}
            finally:
                done.set()
        return ran

    # -------------------------------------------------------------- turns
    def send(self, text, images=None):
        text = (text or "").strip()
        images = [p for p in (images or []) if p and os.path.isfile(p)]
        if self.busy or (not text and not images):
            return False
        if not self.binary or not self.signed_in:
            self.add_message("error", L("Connect your %s account first (Connect button).", "Conecte sua conta %s primeiro (botão Conectar).") % self.provider_name)
            return False
        label = text + ("" if not images else L("\n[%d image(s) attached]", "\n[%d imagem(ns) anexada(s)]") % len(images))
        prompt = self._with_history(text)
        self.add_message("user", label)
        self.busy = True
        self.stop_requested = False
        self.set_status(L("Working…", "Trabalhando…"))
        threading.Thread(target=self._run_turn, args=(prompt, images), daemon=True).start()
        return True

    def _with_history(self, text):
        """A new session (after switching the AI) gets the chat so far, so the
        conversation carries on where the previous AI left it."""
        if self.thread_id is not None:
            return text
        lines = []
        for m in self.messages:
            if m["role"] == "user":
                lines.append("User: " + m["text"])
            elif m["role"] == "assistant":
                lines.append("Assistant: " + m["text"])
        if not lines:
            return text
        history = "\n\n".join(lines)[-12000:]
        return ("<previous_conversation>\nThe conversation so far in this program (possibly with another AI). "
                "Continue from it; the work it describes is already in the document.\n\n%s\n</previous_conversation>\n\n%s" % (history, text))

    def stop(self):
        self.stop_requested = True
        proc = self.proc
        if proc:
            try:
                proc.kill()
            except OSError:
                pass

    def _instructions(self):
        extra = (self.settings.get("instructions") or "").strip()
        return self.host.instructions + " " + extensions.instructions() + ((" Persistent user instructions for every request: " + extra) if extra else "")

    def _finish(self, error=None):
        self.proc = None
        self.busy = False
        if self.stop_requested:
            self.add_message("status", L("Stopped.", "Interrompido."))
        elif error:
            self.add_message("error", error)
        self.set_status(L("%s ready", "%s pronto") % self.provider_name)
        for path in self._temp_files:
            try:
                os.remove(path)
            except OSError:
                pass
        self._temp_files = []

    def _run_turn(self, text, images):
        self.turn_counter += 1
        key = "t%d:" % self.turn_counter
        try:
            if self.provider == "claude":
                error = self._run_claude(text, images, key)
            elif self.provider == "antigravity":
                error = self._run_agy(text, images, key)
            else:
                error = self._run_codex(text, images, key)
        except Exception as failure:  # noqa: BLE001
            error = "%s: %s" % (type(failure).__name__, failure)
        self._finish(error)

    def _tool_label(self, name, args):
        summary = args.get("summary") if isinstance(args, dict) else None
        return summary or name.replace("_", " ")

    def _run_claude(self, text, images, key):
        data_dir = system.data_directory()
        prompt_path = os.path.join(data_dir, "system-prompt-%s.txt" % self.host.id)
        with open(prompt_path, "w", encoding="utf-8") as handle:
            handle.write(self._instructions())
        config_path = os.path.join(data_dir, "mcp-config-%s.json" % self.host.id)
        servers = extensions.claude_servers()
        servers[self.host.namespace] = {"type": "http", "url": self.mcp.url, "headers": {"Authorization": "Bearer " + self.mcp.token}}
        with open(config_path, "w", encoding="utf-8") as handle:
            json.dump({"mcpServers": servers}, handle)
        allowed = ",".join("mcp__" + name for name in servers)
        args = [self.binary, "-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose",
                "--system-prompt-file", prompt_path, "--mcp-config", config_path, "--strict-mcp-config",
                "--tools", "", "--allowedTools", allowed, "--permission-mode", "dontAsk"]
        if self.thread_id:
            args += ["--resume", self.thread_id]
        model = self.selected_model()
        if model["model"]:
            args += ["--model", model["model"]]
        effort = self.selected_effort()
        if effort and model["efforts"]:
            args += ["--effort", effort]
        content = []
        for number, path in enumerate(images, 1):
            ext = os.path.splitext(path)[1].lower()
            if ext not in IMAGE_TYPES:
                continue
            with open(path, "rb") as handle:
                raw = handle.read()
            if len(raw) > 4_800_000:
                content.append({"type": "text", "text": "Attachment %d (%s) is too large to send as an image." % (number, path)})
                continue
            content.append({"type": "text", "text": "Attachment %d: image file at %s" % (number, path)})
            content.append({"type": "image", "source": {"type": "base64", "media_type": IMAGE_TYPES[ext], "data": base64.b64encode(raw).decode("ascii")}})
        content.append({"type": "text", "text": text or "Use the attached references."})
        prefix = "mcp__" + self.host.namespace + "__"

        self.proc = subprocess.Popen(args, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                     cwd=data_dir, env=system.environment(self.binary), creationflags=system.hidden_window_flags())
        stderr = []
        threading.Thread(target=lambda: stderr.append(self.proc.stderr.read().decode("utf-8", "replace")), daemon=True).start()
        self.proc.stdin.write((json.dumps({"type": "user", "message": {"role": "user", "content": content}, "parent_tool_use_id": None, "session_id": ""}) + "\n").encode("utf-8"))
        self.proc.stdin.close()
        tools = {}
        final = None
        auth_failed = False
        for raw_line in self.proc.stdout:
            try:
                message = json.loads(raw_line.decode("utf-8"))
            except ValueError:
                continue
            if message.get("session_id"):
                self.thread_id = message["session_id"]
            kind = message.get("type")
            if kind == "assistant" and message.get("message"):
                if message.get("error") == "authentication_failed":
                    auth_failed = True
                for index, block in enumerate(message["message"].get("content") or []):
                    if block.get("type") == "text" and block.get("text") and not message.get("error"):
                        self.add_message("assistant", block["text"], key=key + message["message"].get("id", "") + ":%d" % index)
                    elif block.get("type") == "tool_use":
                        name = str(block.get("name", "")).replace(prefix, "")
                        if name.startswith("mcp__"):
                            # A connector's tool: show it as "<connector>: <tool>".
                            parts = name.split("__", 2)
                            name = "%s: %s" % (parts[1], parts[2]) if len(parts) == 3 else name
                        tools[block.get("id")] = name
                        self.add_message("tool", self._tool_label(name, block.get("input") or {}), key=key + str(block.get("id")), state="running", tool=name)
            elif kind == "user" and isinstance((message.get("message") or {}).get("content"), list):
                for block in message["message"]["content"]:
                    if block.get("type") == "tool_result" and block.get("tool_use_id") in tools:
                        k = key + str(block["tool_use_id"])
                        for m in self.messages:
                            if m.get("key") == k:
                                m["state"] = "failed" if block.get("is_error") else "done"
                        self._changed()
            elif kind == "result":
                final = message
        self.proc.wait()
        if self.stop_requested:
            return None
        if auth_failed:
            self.signed_in = False
            return L("Claude is not signed in. Click Connect and finish the login in your browser.", "O Claude está sem login. Clique em Conectar e termine o login no navegador.")
        if final and not final.get("is_error"):
            return None
        if not final:
            self.thread_id = None
        detail = (final and (final.get("result") or " ".join(final.get("errors") or []))) or "".join(stderr).strip()
        return detail or "Claude Code exited with code %s." % self.proc.returncode

    def _run_agy(self, text, images, key):
        """Antigravity CLI. It has no per-run MCP option, so it reaches this program
        through the Soma Hub registered in Antigravity's MCP config (server "soma")."""
        extensions.sync_antigravity()
        if not system.ensure_antigravity_config():
            return "The Soma Hub is not running, so Antigravity cannot reach %s. Reinstall Soma Agente or start “Soma Hub” from the Start menu." % self.host.name
        workspace = os.path.join(system.data_directory(), "antigravity-workspace")
        os.makedirs(workspace, exist_ok=True)
        prompt = []
        if not self.thread_id:
            prompt.append("<soma_instructions>\n%s\nYou reach %s through the soma MCP server: call get_app_tools with app=\"%s\" once, then call_app_tool with app=\"%s\" for every action. "
                          "Skills and connectors are managed with the soma_* tools of the same soma server (soma_create_skill, soma_read_skill, soma_add_connector...). "
                          "Other open programs are listed by list_apps if the user asks to combine programs. Do not use the terminal, browser or file-editing tools for work in %s.\n</soma_instructions>"
                          % (self._instructions(), self.host.name, self.host.id, self.host.id, self.host.name))
        for number, path in enumerate(images, 1):
            prompt.append("[Attached image #%d, file path: %s]" % (number, path))
        prompt.append(text or "Use the attached references.")
        # Headless agy only runs tools allowed in its settings: the three Soma Hub
        # tools (see system.ensure_antigravity_config); everything else is denied.
        args = [self.binary, "-p", "\n\n".join(prompt), "--output-format", "stream-json"]
        model = self.selected_model()
        if model["model"]:
            args += ["--model", model["model"]]
        if self.thread_id:
            args += ["--conversation", self.thread_id]
        self.proc = subprocess.Popen(args, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                     cwd=workspace, env=system.environment(self.binary), creationflags=system.hidden_window_flags())
        stderr = []
        threading.Thread(target=lambda: stderr.append(self.proc.stderr.read().decode("utf-8", "replace")), daemon=True).start()
        texts = {}
        result = None
        for raw_line in self.proc.stdout:
            try:
                event = json.loads(raw_line.decode("utf-8"))
            except ValueError:
                continue
            kind = event.get("event")
            if event.get("conversation_id"):
                self.thread_id = event["conversation_id"]
            if kind == "step_update":
                step = event.get("step_update") or {}
                index = step.get("step_index")
                step_type = step.get("step_type") or ""
                if step.get("conversation_id"):
                    self.thread_id = step["conversation_id"]
                if step_type == "agent_response":
                    texts[index] = texts.get(index, "") + (step.get("text_delta") or "")
                    if texts[index].strip():
                        self.add_message("assistant", texts[index].strip(), key="%sstep%s" % (key, index))
                elif step_type and step_type != "user_input":
                    params = (step.get("tool_info") or {}).get("parameters") or {}
                    inner = params.get("Arguments") if isinstance(params.get("Arguments"), dict) else {}
                    label = inner.get("tool") or params.get("ToolName") or step.get("tool_name") or step_type
                    label = str(label).replace("_", " ")
                    state = {"DONE": "done", "ERROR": "failed", "FAILED": "failed"}.get(step.get("state"), "running")
                    self.add_message("tool", str(label), key="%sstep%s" % (key, index), state=state, tool=step_type)
            elif kind == "result":
                result = event.get("result") or {}
                if result.get("conversation_id"):
                    self.thread_id = result["conversation_id"]
        self.proc.wait()
        if self.stop_requested:
            return None
        if result and result.get("status") == "SUCCESS":
            if not texts and result.get("response"):
                self.add_message("assistant", result["response"].strip(), key=key + "final")
            return None
        detail = (result and (result.get("error") or result.get("status"))) or "".join(stderr).strip()[-1500:]
        if "auth" in detail.lower() or "login" in detail.lower():
            self.signed_in = False
            return L("Antigravity is not signed in. Click Connect and finish the login.", "O Antigravity está sem login. Clique em Conectar e termine o login.")
        return detail or "Antigravity exited with code %s." % self.proc.returncode

    def _run_codex(self, text, images, key):
        data_dir = system.data_directory()
        ns = self.host.namespace
        args = [self.binary, "exec", "--json", "--skip-git-repo-check", "--ignore-user-config", "-s", "read-only", "-C", data_dir,
                "-c", "mcp_servers.%s.url=%s" % (ns, json.dumps(self.mcp.url)),
                "-c", "mcp_servers.%s.bearer_token_env_var=\"SOMA_MCP_TOKEN\"" % ns,
                "-c", "mcp_servers.%s.default_tools_approval_mode=\"approve\"" % ns,
                "-c", "mcp_servers.%s.tool_timeout_sec=3600" % ns,
                "-c", "approval_policy=\"never\"",
                "-c", "developer_instructions=" + json.dumps(self._instructions())] + extensions.codex_overrides()
        model = self.selected_model()
        if model["model"]:
            args += ["-m", model["model"]]
        effort = self.selected_effort()
        if effort and model["efforts"]:
            args += ["-c", "model_reasoning_effort=" + json.dumps(effort)]
        if self.thread_id:
            args.append("resume")
        prompt = []
        for number, path in enumerate(images, 1):
            args.append("--image=" + path)
            prompt.append("[Attached image #%d: %s]" % (number, path))
        if self.thread_id:
            args.append(self.thread_id)
        args.append("-")
        prompt.append(text or "Use the attached references.")
        env = system.environment(self.binary)
        env["SOMA_MCP_TOKEN"] = self.mcp.token
        self.proc = subprocess.Popen(args, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                     cwd=data_dir, env=env, creationflags=system.hidden_window_flags())
        stderr = []
        threading.Thread(target=lambda: stderr.append(self.proc.stderr.read().decode("utf-8", "replace")), daemon=True).start()
        self.proc.stdin.write("\n\n".join(prompt).encode("utf-8"))
        self.proc.stdin.close()
        completed = False
        failure = None
        for raw_line in self.proc.stdout:
            try:
                event = json.loads(raw_line.decode("utf-8"))
            except ValueError:
                continue
            kind = event.get("type")
            item = event.get("item") or {}
            if kind == "thread.started" and event.get("thread_id"):
                self.thread_id = event["thread_id"]
            elif kind in ("item.started", "item.completed") and item:
                if item.get("type") == "agent_message" and kind == "item.completed" and item.get("text"):
                    self.add_message("assistant", item["text"], key=key + item.get("id", ""))
                elif item.get("type") == "mcp_tool_call":
                    state = "running" if kind == "item.started" else ("done" if item.get("status") == "completed" and not item.get("error") else "failed")
                    self.add_message("tool", self._tool_label(item.get("tool", ""), item.get("arguments") or {}), key=key + item.get("id", ""), state=state, tool=item.get("tool"))
            elif kind == "turn.completed":
                completed = True
            elif kind == "turn.failed":
                failure = (event.get("error") or {}).get("message") or "ChatGPT could not finish the request."
            elif kind == "error" and event.get("message"):
                failure = event["message"]
        self.proc.wait()
        if self.stop_requested:
            return None
        if completed and not failure:
            return None
        detail = failure or "".join(stderr).strip() or "Codex exited with code %s." % self.proc.returncode
        lowered = detail.lower()
        if "not logged in" in lowered or "unauthorized" in lowered or "401" in lowered:
            self.signed_in = False
            return L("ChatGPT is not signed in. Click Connect and finish the login in your browser.", "O ChatGPT está sem login. Clique em Conectar e termine o login no navegador.")
        return detail
