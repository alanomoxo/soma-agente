"""Soma Agente for Blender: chat with Claude or ChatGPT from the 3D View
sidebar (N panel > Soma) and let it edit the scene."""

bl_info = {
    "name": "Soma Agente",
    "author": "Soma",
    "version": (1, 6, 3),
    "blender": (4, 2, 0),
    "location": "3D View > Sidebar (N) > Soma",
    "description": "AI agent (Claude or ChatGPT) that edits your scene from a chat",
    "category": "3D View",
}

import os
import textwrap
import threading

import bpy
from bpy.props import CollectionProperty, EnumProperty, StringProperty
from bpy.types import Operator, Panel, PropertyGroup

from .soma_core import Agent, extensions, i18n
from .soma_core.i18n import L
from .host import BlenderHost

_state = {"agent": None, "revision": -1, "model_items": [], "effort_items": []}


def agent():
    if _state["agent"] is None:
        _state["agent"] = Agent(BlenderHost())
        _state["agent"].start()
    return _state["agent"]


def _redraw():
    for window in bpy.context.window_manager.windows:
        for area in window.screen.areas:
            if area.type == "VIEW_3D":
                area.tag_redraw()


def _tick():
    a = _state["agent"]
    if a is None:
        return 0.5
    a.pump()
    if a.revision != _state["revision"]:
        _state["revision"] = a.revision
        _redraw()
    return 0.1 if a.busy or not a.tool_requests.empty() else 0.25


# ------------------------------------------------------------------ properties
def _provider_items(self, context):
    return [("claude", "Claude", L("Claude Code with your Claude account", "Claude Code com a sua conta Claude")), ("chatgpt", "ChatGPT", L("Codex with your ChatGPT account", "Codex com a sua conta ChatGPT")),
            ("antigravity", "Antigravity", L("Antigravity CLI (agy) with your Google account", "CLI do Antigravity (agy) com a sua conta Google"))]


PROVIDER_IDS = ["claude", "chatgpt", "antigravity"]


def _get_provider(self):
    return PROVIDER_IDS.index(agent().provider) if agent().provider in PROVIDER_IDS else 0


def _set_provider(self, value):
    agent().set_provider(PROVIDER_IDS[value])


def _model_items(self, context):
    items = [(m["id"], m["name"], "") for m in agent().models()]
    _state["model_items"] = items
    return items


def _get_model(self):
    a = agent()
    ids = [m["id"] for m in a.models()]
    current = a.selected_model()["id"]
    return ids.index(current) if current in ids else 0


def _set_model(self, value):
    models = agent().models()
    if 0 <= value < len(models):
        agent().select_model(models[value]["id"])


def _effort_items(self, context):
    efforts = agent().selected_model()["efforts"] or ["default"]
    items = [(e, e.capitalize(), "") for e in efforts]
    _state["effort_items"] = items
    return items


def _get_effort(self):
    a = agent()
    efforts = a.selected_model()["efforts"]
    effort = a.selected_effort()
    return efforts.index(effort) if effort in efforts else 0


def _set_effort(self, value):
    efforts = agent().selected_model()["efforts"]
    if 0 <= value < len(efforts):
        agent().select_effort(efforts[value])


def _send(wm):
    images = [item.path for item in wm.soma_attachments]
    if agent().send(wm.soma_prompt, images):
        _state["clearing"] = True
        wm.soma_prompt = ""
        wm.soma_attachments.clear()
        _state["clearing"] = False


def _send_on_enter(self, context):
    if self.soma_prompt.strip() and not _state.get("clearing"):
        _send(self)


class SomaAttachment(PropertyGroup):
    path: StringProperty()


LANGUAGES = ["auto", "pt", "en"]


def _language_items(self, context):
    _state["language_items"] = [("auto", L("Automatic language", "Idioma automático"), ""), ("pt", "Português (Brasil)", ""), ("en", "English", "")]
    return _state["language_items"]


def _get_language(self):
    return LANGUAGES.index(i18n.choice())


def _set_language(self, value):
    i18n.set_choice(LANGUAGES[value])
    _redraw()


def _tip(en, pt):
    """Operator tooltip in the current language."""
    return classmethod(lambda cls, context, properties: L(en, pt))


# ------------------------------------------------------------------ operators
class SOMA_OT_send(Operator):
    bl_idname = "soma.send"
    bl_label = "Send"
    bl_description = "Send the message to Soma Agente"
    description = _tip("Send the message to Soma Agente", "Enviar a mensagem para o Soma Agente")

    def execute(self, context):
        _send(context.window_manager)
        return {"FINISHED"}


class SOMA_OT_stop(Operator):
    bl_idname = "soma.stop"
    bl_label = "Stop"
    bl_description = "Stop the current request"
    description = _tip("Stop the current request", "Parar o pedido atual")

    def execute(self, context):
        agent().stop()
        return {"FINISHED"}


class SOMA_OT_new_chat(Operator):
    bl_idname = "soma.new_chat"
    bl_label = "New chat"
    bl_description = "Start a new conversation"
    description = _tip("Start a new conversation", "Começar uma nova conversa")

    def execute(self, context):
        agent().new_chat()
        return {"FINISHED"}


class SOMA_OT_connect(Operator):
    bl_idname = "soma.connect"
    bl_label = "Connect"
    bl_description = "Sign in to your Claude or ChatGPT account (opens a terminal and the browser)"
    description = _tip("Sign in to your AI account (opens a terminal and the browser)", "Entrar na sua conta da IA (abre um terminal e o navegador)")

    def execute(self, context):
        agent().login()
        return {"FINISHED"}


class SOMA_OT_check(Operator):
    bl_idname = "soma.check"
    bl_label = "Check"
    bl_description = "Check the connection again"
    description = _tip("Check the connection again", "Verificar a conexão de novo")

    def execute(self, context):
        agent().refresh()
        return {"FINISHED"}


class SOMA_OT_attach(Operator):
    bl_idname = "soma.attach"
    bl_label = "Attach image"
    bl_description = "Attach a reference image (PNG, JPG, GIF, WebP)"
    description = _tip("Attach a reference image (PNG, JPG, GIF, WebP)", "Anexar uma imagem de referência (PNG, JPG, GIF, WebP)")
    filepath: StringProperty(subtype="FILE_PATH")
    filter_glob: StringProperty(default="*.png;*.jpg;*.jpeg;*.gif;*.webp", options={"HIDDEN"})

    def invoke(self, context, event):
        context.window_manager.fileselect_add(self)
        return {"RUNNING_MODAL"}

    def execute(self, context):
        if self.filepath and os.path.isfile(self.filepath):
            context.window_manager.soma_attachments.add().path = self.filepath
        return {"FINISHED"}


class SOMA_OT_clear_attachments(Operator):
    bl_idname = "soma.clear_attachments"
    bl_label = "Remove attachments"

    def execute(self, context):
        context.window_manager.soma_attachments.clear()
        return {"FINISHED"}


class SOMA_OT_approve(Operator):
    bl_idname = "soma.approve"
    bl_label = "Approve"
    bl_description = "Approve or reject a connector or skill the agent wants to add"
    description = _tip("Approve or reject a connector or skill the agent wants to add", "Aprovar ou recusar um conector ou skill que o agente quer adicionar")
    kind: StringProperty()
    name: StringProperty()
    accept: bpy.props.BoolProperty(default=True)

    def execute(self, context):
        extensions.approve(self.kind, self.name, self.accept)
        return {"FINISHED"}


class SOMA_OT_update(Operator):
    bl_idname = "soma.update"
    bl_label = "Update"
    bl_description = "Install the latest Soma Agente from GitHub"
    description = _tip("Install the latest Soma Agente from GitHub", "Instalar a versão mais nova do Soma Agente pelo GitHub")
    check_only: bpy.props.BoolProperty(default=False)

    def execute(self, context):
        if self.check_only:
            threading.Thread(target=lambda: agent().check_update(True), daemon=True).start()
        else:
            threading.Thread(target=agent().install_update, daemon=True).start()
        return {"FINISHED"}


class SOMA_OT_open_chat(Operator):
    bl_idname = "soma.open_chat"
    bl_label = "Full chat as text"
    bl_description = "Copy the whole conversation into a Text datablock (Text Editor > Soma Chat)"
    description = _tip("Copy the whole conversation into a Text datablock (Text Editor > Soma Chat)", "Copiar a conversa inteira para um texto (Text Editor > Soma Chat)")

    def execute(self, context):
        text = bpy.data.texts.get("Soma Chat") or bpy.data.texts.new("Soma Chat")
        lines = []
        for m in agent().messages:
            lines.append("[%s] %s" % (m["role"], m["text"]))
        text.from_string("\n\n".join(lines))
        self.report({"INFO"}, L("Open the Text Editor and choose “Soma Chat”.", "Abra o Text Editor e escolha “Soma Chat”."))
        return {"FINISHED"}


# ------------------------------------------------------------------ panel
ROLE_ICONS = {"user": "USER", "assistant": "OUTLINER_DATA_LIGHT", "tool": "TOOL_SETTINGS", "error": "ERROR", "status": "INFO"}
STATE_ICONS = {"running": "SORTTIME", "done": "CHECKMARK", "failed": "CANCEL"}


class SOMA_PT_chat(Panel):
    bl_label = "Soma Agente"
    bl_idname = "SOMA_PT_chat"
    bl_space_type = "VIEW_3D"
    bl_region_type = "UI"
    bl_category = "Soma"

    def draw(self, context):
        layout = self.layout
        wm = context.window_manager
        a = agent()

        row = layout.row(align=True)
        row.prop(wm, "soma_provider", expand=True)
        row = layout.row(align=True)
        row.prop(wm, "soma_model", text="")
        if a.selected_model()["efforts"]:
            row.prop(wm, "soma_effort", text="")

        try:
            pending = extensions.pending()
        except Exception:  # noqa: BLE001 - never break the panel
            pending = []
        for item in pending:
            ask = layout.box()
            ask.label(text=L("Agent wants to add a %s: %s", "O agente quer adicionar %s: %s") % (L(item["kind"], {"skill": "a skill", "connector": "o conector"}.get(item["kind"], item["kind"])), item["name"]), icon="QUESTION")
            ask.label(text=(item["detail"] or item["description"])[:70])
            row = ask.row(align=True)
            yes = row.operator("soma.approve", text=L("Approve", "Aprovar"), icon="CHECKMARK")
            yes.kind, yes.name, yes.accept = item["kind"], item["name"], True
            no = row.operator("soma.approve", text=L("Reject", "Recusar"), icon="X")
            no.kind, no.name, no.accept = item["kind"], item["name"], False

        update = a.update_text()
        if update:
            ask = layout.box()
            ask.label(text=update, icon="IMPORT")
            if not (getattr(a, "update", None) or {}).get("requested"):
                ask.operator("soma.update", text=L("Update now", "Atualizar agora"), icon="IMPORT").check_only = False

        box = layout.box()
        status = box.row()
        status.label(text=a.status, icon="CHECKMARK" if a.signed_in and not a.busy else ("SORTTIME" if a.busy else "INFO"))
        if not a.signed_in:
            buttons = box.row(align=True)
            buttons.operator("soma.connect", text=L("Connect", "Conectar"), icon="URL")
            buttons.operator("soma.check", text=L("Check", "Verificar"), icon="FILE_REFRESH")

        chars = max(24, int(context.region.width / (7 * context.preferences.system.ui_scale)))
        chat = layout.column(align=True)
        visible = a.messages[-14:]
        if not visible:
            hint = chat.box()
            for line in textwrap.wrap(L("Describe what you want in the scene. Soma inspects it, makes the change, and checks the result in the viewport.", "Descreva o que você quer na cena. O Soma inspeciona, faz a mudança e confere o resultado no viewport."), chars):
                hint.label(text=line)
        for message in visible:
            role = message["role"]
            block = chat.box()
            if role == "tool":
                block.label(text=message["text"], icon=STATE_ICONS.get(message.get("state"), "TOOL_SETTINGS"))
                continue
            lines = []
            for paragraph in message["text"].splitlines() or [""]:
                lines.extend(textwrap.wrap(paragraph, chars) or [""])
            first = True
            for line in lines[:40]:
                block.label(text=line, icon=ROLE_ICONS.get(role, "BLANK1") if first else "BLANK1")
                first = False
            if len(lines) > 40:
                block.label(text=L("… (Full chat as text shows the rest)", "… (Conversa completa em texto mostra o resto)"), icon="BLANK1")

        layout.separator()
        if wm.soma_attachments:
            att = layout.box()
            for item in wm.soma_attachments:
                att.label(text=os.path.basename(item.path), icon="IMAGE_DATA")
            att.operator("soma.clear_attachments", text=L("Remove attachments", "Remover anexos"), icon="X")
        col = layout.column(align=True)
        col.prop(wm, "soma_prompt", text="", icon="TEXT")
        row = col.row(align=True)
        if a.busy:
            row.operator("soma.stop", text=L("Stop", "Parar"), icon="CANCEL")
        else:
            row.operator("soma.send", text=L("Send", "Enviar"), icon="PLAY")
        row.operator("soma.attach", text="", icon="IMAGE_DATA")
        row.operator("soma.new_chat", text=L("New chat", "Nova conversa"), icon="ADD")
        row.operator("soma.open_chat", text="", icon="TEXT")
        row = layout.row(align=True)
        row.prop(context.window_manager, "soma_language", text="")
        row.operator("soma.update", text=L("Check for updates", "Verificar atualizações"), icon="FILE_REFRESH").check_only = True


CLASSES = (SomaAttachment, SOMA_OT_approve, SOMA_OT_send, SOMA_OT_stop, SOMA_OT_new_chat, SOMA_OT_connect, SOMA_OT_check,
           SOMA_OT_attach, SOMA_OT_clear_attachments, SOMA_OT_open_chat, SOMA_OT_update, SOMA_PT_chat)


def register():
    for cls in CLASSES:
        bpy.utils.register_class(cls)
    wm = bpy.types.WindowManager
    wm.soma_prompt = StringProperty(name="Message", description="Message for Soma Agente (Enter sends)", update=_send_on_enter)
    wm.soma_attachments = CollectionProperty(type=SomaAttachment)
    wm.soma_provider = EnumProperty(name="AI", items=_provider_items, get=_get_provider, set=_set_provider)
    wm.soma_model = EnumProperty(name="Model", items=_model_items, get=_get_model, set=_set_model)
    wm.soma_effort = EnumProperty(name="Reasoning", items=_effort_items, get=_get_effort, set=_set_effort)
    wm.soma_language = EnumProperty(name="Language", items=_language_items, get=_get_language, set=_set_language)
    i18n.hint(getattr(bpy.app.translations, "locale", ""))
    bpy.app.timers.register(_tick, first_interval=0.5, persistent=True)
    agent()


def unregister():
    if bpy.app.timers.is_registered(_tick):
        bpy.app.timers.unregister(_tick)
    if _state["agent"] is not None:
        _state["agent"].shutdown()
        _state["agent"] = None
    wm = bpy.types.WindowManager
    for name in ("soma_prompt", "soma_attachments", "soma_provider", "soma_model", "soma_effort", "soma_language"):
        if hasattr(wm, name):
            delattr(wm, name)
    for cls in reversed(CLASSES):
        bpy.utils.unregister_class(cls)
