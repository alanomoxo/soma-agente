"""Soma Agente for Blender: chat with Claude or ChatGPT from the 3D View
sidebar (N panel > Soma) and let it edit the scene."""

bl_info = {
    "name": "Soma Agente",
    "author": "Soma",
    "version": (1, 7, 0),
    "blender": (4, 2, 0),
    "location": "3D View > Sidebar (N) > Soma",
    "description": "AI agent (Claude or ChatGPT) that edits your scene from a chat",
    "category": "3D View",
}

import os
import textwrap
import threading

import bpy
import bpy.utils.previews
from bpy.props import CollectionProperty, EnumProperty, StringProperty
from bpy.types import Operator, Panel, PropertyGroup

from .soma_core import Agent, extensions, i18n
from .soma_core.i18n import L
from .host import BlenderHost

_state = {"agent": None, "revision": -1, "model_items": [], "effort_items": [], "icons": None}


def soma_icon():
    icons = _state["icons"]
    return icons["soma"].icon_id if icons is not None and "soma" in icons else 0


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


class SOMA_OT_suggest(Operator):
    bl_idname = "soma.suggest"
    bl_label = "Suggestion"
    bl_description = "Put this example in the message box"
    description = _tip("Put this example in the message box", "Colocar este exemplo na caixa de mensagem")
    text: StringProperty()

    def execute(self, context):
        _state["clearing"] = True
        context.window_manager.soma_prompt = self.text
        _state["clearing"] = False
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
STATE_ICONS = {"running": "SORTTIME", "done": "CHECKMARK", "failed": "CANCEL"}
SUGGESTIONS = (  # (button en, button pt, prompt en, prompt pt)
    ("Spinning red cube", "Cubo vermelho girando", "Make a red cube that spins once", "Crie um cubo vermelho que gira uma vez"),
    ("Three-point lighting", "Luz de três pontos", "Light the scene with a three-point setup", "Ilumine a cena com três pontos de luz"),
    ("Orbiting camera", "Câmera orbitando", "Add a camera that orbits the selected object", "Adicione uma câmera orbitando o objeto selecionado"),
)


def _wrap(text, chars):
    lines = []
    for paragraph in (text or "").splitlines() or [""]:
        lines.extend(textwrap.wrap(paragraph, chars) or [""])
    return lines


def _text(layout, text, chars, limit=40):
    lines = _wrap(text, chars)
    col = layout.column(align=True)
    col.scale_y = 0.9
    for line in lines[:limit]:
        col.label(text=line)
    if len(lines) > limit:
        col.label(text=L("… (Full chat as text shows the rest)", "… (Conversa completa em texto mostra o resto)"))


def _icon_text(layout, text, chars, icon, limit=4):
    col = layout.column(align=True)
    col.scale_y = 0.9
    for i, line in enumerate(_wrap(text, chars)[:limit]):
        col.label(text=line, icon=icon if i == 0 else "BLANK1")
    return col


def _draw_tools(layout, tools, chars):
    col = layout.column(align=True)
    col.scale_y = 0.8
    for message in tools:
        row = col.row(align=True)
        row.active = message.get("state") != "done"
        text = message["text"]
        row.label(text=text if len(text) <= chars else text[:chars - 1] + "…", icon=STATE_ICONS.get(message.get("state"), "TOOL_SETTINGS"))


def _draw_message(layout, message, chars):
    role = message["role"]
    if role == "user":
        box = layout.box()
        head = box.row()
        head.alignment = "RIGHT"
        head.active = False
        head.label(text=L("You", "Você"), icon="USER")
        _text(box, message["text"], chars - 4)
    elif role == "assistant":
        col = layout.column()
        col.label(text="Soma", icon_value=soma_icon())
        _text(col, message["text"], chars)
    elif role == "error":
        box = layout.box()
        box.alert = True
        box.label(text=L("Something went wrong", "Algo deu errado"), icon="ERROR")
        _text(box, message["text"], chars - 4)
    else:
        _icon_text(layout, message["text"], chars, "INFO", 6).active = False


def _draw_empty(layout, chars):
    box = layout.box()
    col = box.column(align=True)
    row = col.row()
    row.alignment = "CENTER"
    row.template_icon(icon_value=soma_icon(), scale=3.0)
    row = col.row()
    row.alignment = "CENTER"
    row.label(text=L("What should we make?", "O que vamos criar?"))
    hint = col.column(align=True)
    hint.active = False
    for line in _wrap(L("Describe it in your own words. Soma inspects the scene, makes the change and checks the viewport.",
                        "Descreva com suas palavras. O Soma inspeciona a cena, faz a mudança e confere no viewport."), chars - 2):
        row = hint.row()
        row.alignment = "CENTER"
        row.label(text=line)
    col.separator()
    for label_en, label_pt, en, pt in SUGGESTIONS:
        col.operator("soma.suggest", text=L(label_en, label_pt), icon="LIGHT").text = L(en, pt)


class SOMA_PT_chat(Panel):
    bl_label = "Soma Agente"
    bl_idname = "SOMA_PT_chat"
    bl_space_type = "VIEW_3D"
    bl_region_type = "UI"
    bl_category = "Soma"

    def draw_header(self, context):
        self.layout.label(text="", icon_value=soma_icon())

    def draw_header_preset(self, context):
        row = self.layout.row(align=True)
        row.emboss = "NONE"
        row.operator("soma.new_chat", text="", icon="ADD")

    def draw(self, context):
        layout = self.layout
        wm = context.window_manager
        a = agent()
        chars = max(24, int(context.region.width / (7 * context.preferences.system.ui_scale)))

        # Which AI
        col = layout.column(align=True)
        row = col.row(align=True)
        row.scale_y = 1.25
        row.prop(wm, "soma_provider", expand=True)
        row = col.row(align=True)
        row.prop(wm, "soma_model", text="")
        if a.selected_model()["efforts"]:
            row.prop(wm, "soma_effort", text="")

        # Connection
        if a.signed_in:
            row = layout.row()
            row.active = a.busy
            row.label(text=a.status, icon="SORTTIME" if a.busy else "CHECKMARK")
        else:
            box = layout.box()
            _icon_text(box, a.status, chars - 4, "INFO")
            row = box.row(align=True)
            row.scale_y = 1.3
            row.operator("soma.connect", text=L("Connect", "Conectar"), icon="URL")
            row.operator("soma.check", text="", icon="FILE_REFRESH")

        # Approvals and updates
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
            _icon_text(ask, update, chars - 4, "IMPORT", 3)
            if not (getattr(a, "update", None) or {}).get("requested"):
                ask.operator("soma.update", text=L("Update now", "Atualizar agora"), icon="IMPORT").check_only = False

        # Conversation
        layout.separator()
        visible = a.messages[-14:]
        if not visible:
            _draw_empty(layout, chars)
        tools = []
        for message in visible:
            if message["role"] == "tool":
                tools.append(message)
                continue
            if tools:
                _draw_tools(layout, tools, chars)
                tools = []
            _draw_message(layout, message, chars)
            layout.separator(factor=0.5)
        if tools:
            _draw_tools(layout, tools, chars)

        # Composer
        layout.separator()
        box = layout.box()
        if wm.soma_attachments:
            row = box.row(align=True)
            names = ", ".join(os.path.basename(item.path) for item in wm.soma_attachments)
            row.label(text=names if len(names) <= chars - 6 else names[:chars - 7] + "…", icon="IMAGE_DATA")
            row.operator("soma.clear_attachments", text="", icon="X", emboss=False)
        row = box.row()
        row.scale_y = 1.5
        try:
            row.prop(wm, "soma_prompt", text="", placeholder=L("Message Soma Agente", "Mensagem para o Soma Agente"))
        except TypeError:  # placeholder needs Blender 4.1+
            row.prop(wm, "soma_prompt", text="", icon="TEXT")
        row = box.row(align=True)
        row.scale_y = 1.3
        row.operator("soma.attach", text="", icon="IMAGE_DATA")
        row.operator("soma.open_chat", text="", icon="TEXT")
        row.separator()
        if a.busy:
            stop = row.row(align=True)
            stop.alert = True
            stop.operator("soma.stop", text=L("Stop", "Parar"), icon="CANCEL")
        else:
            row.operator("soma.send", text=L("Send", "Enviar"), icon="PLAY")


class SOMA_PT_options(Panel):
    bl_label = ""
    bl_idname = "SOMA_PT_options"
    bl_parent_id = "SOMA_PT_chat"
    bl_space_type = "VIEW_3D"
    bl_region_type = "UI"
    bl_category = "Soma"
    bl_options = {"DEFAULT_CLOSED"}

    def draw_header(self, context):
        self.layout.label(text=L("Options", "Opções"), icon="PREFERENCES")

    def draw(self, context):
        layout = self.layout
        layout.use_property_split = False
        layout.prop(context.window_manager, "soma_language", text="", icon="WORLD")
        col = layout.column(align=True)
        col.operator("soma.new_chat", text=L("New chat", "Nova conversa"), icon="ADD")
        col.operator("soma.open_chat", text=L("Full chat as text", "Conversa completa em texto"), icon="TEXT")
        col.operator("soma.update", text=L("Check for updates", "Verificar atualizações"), icon="FILE_REFRESH").check_only = True
        col.operator("soma.connect", text=L("Sign in again", "Entrar de novo"), icon="URL")

CLASSES = (SomaAttachment, SOMA_OT_approve, SOMA_OT_send, SOMA_OT_stop, SOMA_OT_new_chat, SOMA_OT_connect, SOMA_OT_check,
           SOMA_OT_attach, SOMA_OT_clear_attachments, SOMA_OT_open_chat, SOMA_OT_update, SOMA_OT_suggest, SOMA_PT_chat, SOMA_PT_options)


def register():
    _state["icons"] = bpy.utils.previews.new()
    _state["icons"].load("soma", os.path.join(os.path.dirname(__file__), "icons", "soma.png"), "IMAGE")
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
    if _state["icons"] is not None:
        bpy.utils.previews.remove(_state["icons"])
        _state["icons"] = None
