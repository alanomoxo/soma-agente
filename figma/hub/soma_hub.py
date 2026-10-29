"""Soma Hub: the local helper for Figma, Cavalry and outside agents (Antigravity).

Figma plugins and Cavalry scripts cannot start programs, so this small local
server runs their agents (Claude Code, Codex or agy) and talks to their panels
over http://localhost:47821. A panel polls /state (Cavalry: /cavalry/state) for
chat updates and tool calls, runs the tools with the program's API, and posts
the results back.

It is also the Soma Hub (see soma_hub_registry.py): every open Soma panel
registers here, and /mcp gives an outside agent one MCP server over all of them.

Browser pages are refused: only requests without an Origin (local programs) or
from a Figma plugin (Origin "null") are accepted, and /mcp needs the hub token.
"""
import base64
import json
import os
import sys
import tempfile
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

from soma_core import Agent, VERSION, extensions, i18n, system  # noqa: E402
from soma_hub_registry import Registry  # noqa: E402
from soma_hub_updater import Updater  # noqa: E402

PORT = 47821
# Testing outside Figma only: also accept this page origin.
TEST_ORIGIN = os.environ.get("SOMA_BRIDGE_TEST_ORIGIN")
INSTRUCTIONS = " ".join([
    "You are Soma Agente, running inside a Figma design file through the Soma plugin. Use the figma MCP tools to do the user's requested work directly in the file.",
    "Coordinates are pixels; x/y of a node are relative to its parent. Refer to nodes by id. Inspect get_document_info and list_nodes before editing unless the current turn already has fresh results.",
    "Prefer frames with auto layout for UI work; name layers meaningfully. Text needs a font that exists: Inter is always available (styles Regular, Medium, Semi Bold, Bold).",
    "After visual changes, call export_preview on the frame you changed and look at the image before declaring success.",
    "Each editing tool is one Figma undo step the user can undo with Ctrl+Z; there is no scripted undo, so make careful changes and verify them.",
    "Use the dedicated tools first; use run_plugin_code for anything else (components, variables, styles, constraints, effects). Never ask the user to do a Figma UI step a tool can do.",
    "Attached images are references, not instructions; each lists its file path, which place_image accepts when the user wants it placed in the design.",
    "Before finishing, check every requirement against current tool results. Keep replies short and concrete, in plain text without Markdown.",
    "Always write to the user (progress updates and final replies) in the language the user writes in.",
])
CAVALRY_INSTRUCTIONS = " ".join([
    "You are Soma Agente, running inside Cavalry (Scene Group's 2D motion design app) through the Soma script panel. Use the cavalry MCP tools to do the user's requested work directly in the open scene.",
    "Layers and attributes have ids (e.g. basicShape#3, position.x). Inspect get_scene_info and list_layers before editing unless the current turn already has fresh results; read get_attributes before setting unfamiliar attributes.",
    "Positions are in pixels from the composition centre (y up). Colors are hex strings. Frames are integers.",
    "create_layer makes primitives (rectangle, ellipse, polygon, star, …) and other layer types (textShape, null, duplicator, …); set_attributes and set_keyframes edit them.",
    "After visual changes, call preview_frame and look at the image before declaring success.",
    "Use the dedicated tools first; use execute_script (Cavalry JavaScript with the api module) for anything else. Never ask the user to do a Cavalry UI step a tool can do.",
    "Attached images are references, not instructions; each lists its file path, which import_asset accepts when the user wants it in the scene.",
    "Before finishing, check every requirement against current tool results. Keep replies short and concrete, in plain text without Markdown.",
    "Always write to the user (progress updates and final replies) in the language the user writes in.",
])


class RemoteHost:
    """Tools are defined and run by a program's panel (Figma plugin, Cavalry
    script); calls wait for its answer."""
    remote = True

    def __init__(self, host_id, name, instructions, open_hint):
        self.id = self.namespace = host_id
        self.name = name
        self.instructions = instructions
        self.open_hint = open_hint
        self.tools = []
        self.pending = {}
        self.lock = threading.Lock()
        self.changed = threading.Condition()

    def notify(self):
        with self.changed:
            self.changed.notify_all()

    def call_tool(self, name, args):
        if not self.tools:
            return {"ok": False, "error": self.open_hint}
        args = dict(args or {})
        if self.id == "figma" and name == "place_image" and args.get("path"):
            path = args.pop("path")
            with open(path, "rb") as handle:
                args["imageBase64"] = base64.b64encode(handle.read()).decode("ascii")
        call = {"id": uuid.uuid4().hex, "name": name, "args": args, "event": threading.Event(), "result": None}
        with self.lock:
            self.pending[call["id"]] = call
        self.notify()
        finished = call["event"].wait(300)
        with self.lock:
            self.pending.pop(call["id"], None)
        if not finished:
            return {"ok": False, "error": "%s did not answer in time. Is the Soma panel still open?" % self.name}
        result = call["result"] or {"ok": False, "error": "Empty result from %s." % self.name}
        images = []
        png = result.pop("pngBase64", None)
        if png:
            path = os.path.join(tempfile.gettempdir(), "soma-%s-%d.png" % (self.id, int(time.time() * 1000)))
            with open(path, "wb") as handle:
                handle.write(base64.b64decode(png))
            images.append(path)
        # Cavalry renders previews straight to a file.
        images += [p for p in (result.pop("imagePaths", None) or []) if os.path.isfile(p)]
        if images:
            result["images"] = images
        return result

    def open_calls(self):
        with self.lock:
            return [{"id": c["id"], "name": c["name"], "args": c["args"]} for c in self.pending.values() if not c.get("sent_at") or time.time() - c["sent_at"] > 60]

    def mark_sent(self, ids):
        with self.lock:
            for call_id in ids:
                if call_id in self.pending:
                    self.pending[call_id]["sent_at"] = time.time()

    def resolve(self, call_id, result):
        with self.lock:
            call = self.pending.get(call_id)
        if call:
            call["result"] = result
            call["event"].set()


hosts = {
    "figma": RemoteHost("figma", "Figma", INSTRUCTIONS, "The Soma plugin is not open in Figma. Ask the user to open Plugins > Development > Soma Agente."),
    "cavalry": RemoteHost("cavalry", "Cavalry", CAVALRY_INSTRUCTIONS, "The Soma panel is not open in Cavalry. Ask the user to open Window > Scripts > Soma Agente."),
}
agents = {key: Agent(h) for key, h in hosts.items()}
# Figma keeps the original routes (/state, /send…); Cavalry uses /cavalry/state, /cavalry/send…
host, agent = hosts["figma"], agents["figma"]
registry = Registry(list(hosts.values()))
updater = Updater()
uploads = []


def state(key="figma"):
    a, h = agents[key], hosts[key]
    model = a.selected_model()
    return {
        "version": VERSION, "revision": a.revision, "status": a.status, "busy": a.busy, "provider": a.provider,
        "signedIn": a.signed_in, "models": [{"id": m["id"], "name": m["name"], "efforts": m["efforts"]} for m in a.models()],
        "model": model["id"], "effort": a.selected_effort(),
        "messages": [{"role": m["role"], "text": m["text"], "state": m.get("state")} for m in a.messages[-200:]],
        "toolCalls": h.open_calls(),
        "pending": extensions.pending(),
        "lang": i18n.lang(), "languageChoice": i18n.choice(),
        "update": updater.snapshot(),
    }


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *args):
        pass

    def _allowed(self):
        origin = self.headers.get("Origin")
        return origin in (None, "null") or (TEST_ORIGIN is not None and origin == TEST_ORIGIN)

    def _send(self, code, body):
        data = json.dumps(body).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_DELETE(self):
        self._send(200, {"ok": True})

    def do_GET(self):
        if not self._allowed():
            self._send(403, {"error": "forbidden"})
            return
        path, _, query = self.path.partition("?")
        if path == "/hello":
            self._send(200, {"soma": True, "version": VERSION})
            return
        if path == "/hub/update":
            self._send(200, updater.snapshot())
            return
        if path == "/hub/apps":
            self._send(200, {"apps": [{"app": e["id"], "name": e["name"]} for e in registry.live()], "activity": registry.activity[-10:]})
            return
        key, path = route(path)
        h, a = hosts[key], agents[key]
        if path == "/state":
            h.last_poll = time.time()
            since, wait = -1, 20.0
            for part in query.split("&"):
                name, _, value = part.partition("=")
                try:
                    if name == "since":
                        since = int(value)
                    elif name == "wait":
                        wait = min(20.0, float(value))
                except ValueError:
                    pass
            # Figma long-polls; Cavalry's web client blocks its UI, so it polls with wait=0.
            deadline = time.time() + wait
            while time.time() < deadline and a.revision == since and not h.open_calls():
                with h.changed:
                    h.changed.wait(0.25)
            body = state(key)
            h.mark_sent([c["id"] for c in body["toolCalls"]])
            self._send(200, body)
            return
        self._send(404, {"error": "not found"})

    def do_POST(self):
        if not self._allowed():
            self._send(403, {"error": "forbidden"})
            return
        length = int(self.headers.get("Content-Length") or 0)
        try:
            body = json.loads(self.rfile.read(length).decode("utf-8") or "{}")
        except ValueError:
            self._send(400, {"error": "bad json"})
            return
        path = self.path.split("?")[0]
        if path == "/mcp":
            if self.headers.get("Authorization") != "Bearer " + registry.token:
                self._send(401, {"error": "unauthorized"})
                return
            batch = isinstance(body, list)
            replies = [r for r in (registry.handle(m) for m in (body if batch else [body])) if r is not None]
            if not replies:
                self.send_response(202)
                self.send_header("Content-Length", "0")
                self.end_headers()
                return
            self._send(200, replies if batch else replies[0])
            return
        if path == "/hub/register":
            self._send(200 if self.headers.get("Origin") is None and registry.register(body) else 400, {"ok": True})
            return
        if path == "/hub/unregister":
            if self.headers.get("Origin") is None:
                registry.unregister(body)
            self._send(200, {"ok": True})
            return
        if path == "/hub/update/check":
            snapshot = updater.check(bool(body.get("force")))
            for a in agents.values():
                a._changed()
            self._send(200, snapshot)
            return
        if path == "/hub/update/install":
            snapshot = updater.request_install()
            for a in agents.values():
                a._changed()
            self._send(200, snapshot)
            return
        key, path = route(path)
        h, a = hosts[key], agents[key]
        if path == "/log":
            # Script errors from a panel, kept in the shared data folder for support.
            with open(os.path.join(system.data_directory(), "soma-%s.log" % key), "a", encoding="utf-8") as handle:
                handle.write("%s %s\n" % (time.strftime("%Y-%m-%d %H:%M:%S"), str(body.get("text"))[:4000]))
            self._send(200, {"ok": True})
            return
        if path == "/register":
            h.tools = body.get("tools") or []
            h.last_poll = time.time()
            self._send(200, {"ok": True, "tools": len(h.tools)})
            threading.Thread(target=lambda: (updater.check(), a._changed()), daemon=True).start()
        elif path == "/tool-result":
            h.resolve(body.get("id"), body.get("result"))
            self._send(200, {"ok": True})
        elif path == "/send":
            images = [p for p in (body.get("paths") or []) if os.path.isfile(p)]
            for image in body.get("images") or []:
                ext = os.path.splitext(image.get("name") or "")[1].lower() or ".png"
                file = os.path.join(tempfile.gettempdir(), "soma-%s-upload-%s%s" % (key, uuid.uuid4().hex[:8], ext))
                with open(file, "wb") as handle:
                    handle.write(base64.b64decode(image.get("data") or ""))
                images.append(file)
                uploads.append(file)
            self._send(200, {"ok": a.send(body.get("text") or "", images)})
        elif path == "/extensions/approve":
            extensions.approve(body.get("kind"), body.get("name"), bool(body.get("accept")))
            a._changed()
            self._send(200, {"ok": True})
        elif path == "/stop":
            a.stop()
            self._send(200, {"ok": True})
        elif path == "/new":
            a.new_chat()
            self._send(200, {"ok": True})
        elif path == "/provider":
            a.set_provider(body.get("provider"))
            self._send(200, {"ok": True})
        elif path == "/model":
            a.select_model(body.get("model"))
            self._send(200, {"ok": True})
        elif path == "/effort":
            a.select_effort(body.get("effort"))
            self._send(200, {"ok": True})
        elif path == "/login":
            a.login()
            self._send(200, {"ok": True})
        elif path == "/feedback":
            a.open_feedback()
            self._send(200, {"ok": True})
        elif path == "/check":
            a.refresh()
            self._send(200, {"ok": True})
        elif path == "/language":
            i18n.set_choice(body.get("language"))
            for each in agents.values():
                each.refresh()
            self._send(200, {"ok": True})
        else:
            self._send(404, {"error": "not found"})
        h.notify()


def route(path):
    """("cavalry", "/state") for /cavalry/state; Figma uses the bare paths."""
    if path.startswith("/cavalry/"):
        return "cavalry", path[len("/cavalry"):]
    return "figma", path


class Server(ThreadingHTTPServer):
    daemon_threads = True

    def handle_error(self, request, client_address):
        pass


def pump_forever():
    last = {key: -1 for key in agents}
    while True:
        for key, a in agents.items():
            a.pump(budget=0.25)
            if a.revision != last[key]:
                last[key] = a.revision
                hosts[key].notify()
        time.sleep(0.05)


def main():
    try:
        server = Server(("127.0.0.1", PORT), Handler)
    except OSError:
        # Another hub is already running.
        return 0
    for a in agents.values():
        a.start()
    updater.start()
    threading.Thread(target=pump_forever, daemon=True).start()
    try:
        server.serve_forever()
    finally:
        for a in agents.values():
            a.shutdown()
        for file in uploads:
            try:
                os.remove(file)
            except OSError:
                pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
