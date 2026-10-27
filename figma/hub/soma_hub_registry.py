"""Soma Hub: one MCP server over every program that has Soma open.

Each Soma panel/add-on registers its own local MCP endpoint here every 30 s
(POST /hub/register). An outside agent such as Antigravity connects once to
http://127.0.0.1:47821/mcp (bearer token from hub-token.txt) and gets three
stable tools: list_apps, get_app_tools and call_app_tool, which forward to the
right program. The Figma plugin is reached directly through the bridge.
"""
import json
import os
import secrets
import threading
import time
import urllib.request

from soma_core import VERSION, system

APP_TTL = 90
TOKEN_FILE = os.path.join(system.data_directory(), "hub-token.txt")

INSTRUCTIONS = (
    "Soma Hub connects you to the creative programs open on this computer (After Effects, Photoshop, "
    "Illustrator, Premiere Pro, Blender, Cinema 4D, Figma). Call list_apps to see which are open, "
    "get_app_tools to read a program's tools, then call_app_tool to act. You can chain programs in one "
    "task, for example render a frame in Blender, place it in Photoshop and animate it in After Effects. "
    "Each program's tools include an inspection tool, a preview tool that returns an image, and a scripting "
    "fallback; inspect before editing and check previews before declaring success."
)


def hub_token():
    """Shared secret for the /mcp endpoint, created once and kept in the data folder."""
    try:
        with open(TOKEN_FILE, "r", encoding="utf-8") as handle:
            token = handle.read().strip()
            if token:
                return token
    except OSError:
        pass
    token = secrets.token_hex(24)
    with open(TOKEN_FILE, "w", encoding="utf-8") as handle:
        handle.write(token)
    return token


class Registry:
    def __init__(self, figma_host):
        self.apps = {}
        self.lock = threading.Lock()
        self.figma = figma_host
        self.token = hub_token()
        self.activity = []

    # ----------------------------------------------------------------- apps
    def register(self, body):
        app_id = str(body.get("id") or "")
        if not app_id or not body.get("url") or not body.get("token"):
            return False
        with self.lock:
            self.apps[app_id] = {
                "id": app_id, "name": body.get("name") or app_id, "namespace": body.get("namespace") or app_id,
                "url": body["url"], "token": body["token"], "seen": time.time(),
            }
        return True

    def unregister(self, body):
        with self.lock:
            entry = self.apps.get(str(body.get("id") or ""))
            if entry and entry["url"] == body.get("url"):
                self.apps.pop(entry["id"], None)

    def live(self):
        now = time.time()
        with self.lock:
            for app_id in [k for k, v in self.apps.items() if now - v["seen"] > APP_TTL]:
                self.apps.pop(app_id, None)
            apps = [dict(v) for v in self.apps.values()]
        if self.figma.tools and now - getattr(self.figma, "last_poll", 0) < 60:
            apps.append({"id": "figma", "name": "Figma", "namespace": "figma"})
        return apps

    def find(self, app):
        key = str(app or "").lower().replace(" ", "").replace("_", "")
        for entry in self.live():
            names = {entry["id"].lower(), entry["name"].lower().replace(" ", ""), entry["namespace"].lower().replace("_", "")}
            if key in names:
                return entry
        raise ValueError("%s is not open with Soma right now. Open apps: %s" % (app, ", ".join(e["id"] for e in self.live()) or "none"))

    # ------------------------------------------------------------- forwarding
    @staticmethod
    def _rpc(entry, method, params, timeout):
        body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode("utf-8")
        request = urllib.request.Request(entry["url"], data=body, method="POST", headers={
            "Content-Type": "application/json", "Accept": "application/json, text/event-stream",
            "Authorization": "Bearer " + entry["token"], "X-Soma-Caller": "hub",
        })
        with urllib.request.urlopen(request, timeout=timeout) as response:
            reply = json.loads(response.read().decode("utf-8"))
        if reply.get("error"):
            raise RuntimeError(reply["error"].get("message") or "Tool call failed.")
        return reply.get("result") or {}

    def app_tools(self, app):
        entry = self.find(app)
        if entry["id"] == "figma":
            return entry, self.figma.tools
        return entry, self._rpc(entry, "tools/list", {}, 30).get("tools", [])

    def call(self, app, tool, arguments):
        entry = self.find(app)
        self.activity.append({"time": time.time(), "app": entry["id"], "tool": tool})
        del self.activity[:-50]
        if entry["id"] == "figma":
            result = self.figma.call_tool(tool, arguments or {})
            images = result.pop("images", None) or []
            content = [{"type": "text", "text": json.dumps(result, default=str)}]
            for path in images:
                try:
                    import base64
                    with open(path, "rb") as handle:
                        content.append({"type": "image", "mimeType": "image/png", "data": base64.b64encode(handle.read()).decode("ascii")})
                    os.remove(path)
                except OSError:
                    pass
            return {"content": content, "isError": result.get("ok") is not True}
        return self._rpc(entry, "tools/call", {"name": tool, "arguments": arguments or {}}, 3600)

    # -------------------------------------------------------------- MCP side
    TOOLS = [
        {"name": "list_apps", "description": "Programs that have Soma open right now, with their app id.",
         "inputSchema": {"type": "object", "properties": {}, "additionalProperties": False}},
        {"name": "get_app_tools", "description": "The tools of one open program (name, description, input schema). Read this before calling a program's tools.",
         "inputSchema": {"type": "object", "properties": {"app": {"type": "string", "description": "App id from list_apps, e.g. aftereffects, photoshop, illustrator, premierepro, blender, cinema4d, figma."}}, "required": ["app"], "additionalProperties": False}},
        {"name": "call_app_tool", "description": "Run one tool in one open program and return its result (text, plus images for preview tools).",
         "inputSchema": {"type": "object", "properties": {"app": {"type": "string"}, "tool": {"type": "string"}, "arguments": {"type": "object"}}, "required": ["app", "tool"], "additionalProperties": False}},
    ]

    def handle(self, message):
        if not isinstance(message, dict) or message.get("id") is None:
            return None
        params = message.get("params") or {}
        method = message.get("method")

        def reply(result):
            return {"jsonrpc": "2.0", "id": message["id"], "result": result}

        def text(value, error=False):
            return reply({"content": [{"type": "text", "text": json.dumps(value, default=str)}], "isError": error})

        if method == "initialize":
            return reply({"protocolVersion": params.get("protocolVersion") or "2025-06-18",
                          "capabilities": {"tools": {"listChanged": False}},
                          "serverInfo": {"name": "soma", "title": "Soma Hub", "version": VERSION},
                          "instructions": INSTRUCTIONS})
        if method == "ping":
            return reply({})
        if method == "tools/list":
            return reply({"tools": self.TOOLS})
        if method == "tools/call":
            name = params.get("name")
            args = params.get("arguments") or {}
            try:
                if name == "list_apps":
                    return text({"apps": [{"app": e["id"], "name": e["name"]} for e in self.live()]})
                if name == "get_app_tools":
                    entry, tools = self.app_tools(args.get("app"))
                    return text({"app": entry["id"], "tools": tools})
                if name == "call_app_tool":
                    return reply(self.call(args.get("app"), args.get("tool"), args.get("arguments")))
                return text({"error": "Unknown tool %s" % name}, True)
            except Exception as error:  # noqa: BLE001 - reported to the agent
                return text({"ok": False, "error": "%s: %s" % (type(error).__name__, error)}, True)
        return {"jsonrpc": "2.0", "id": message["id"], "error": {"code": -32601, "message": "Method not supported: %s" % method}}
