"""Soma Agente for Cinema 4D: Extensions > Soma Agente opens a dockable chat
with Claude, ChatGPT or Antigravity that edits the active document."""
import os
import sys
import threading
import time
import traceback

import c4d
from c4d import gui

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)


def log(text):
    """Problems go to the Python console and to AE Agent/soma-c4d.log."""
    print("[Soma Agente] " + text)
    try:
        base = os.environ.get("APPDATA") or os.path.join(os.path.expanduser("~"), "Library", "Application Support")
        folder = os.path.join(base, "AE Agent")
        os.makedirs(folder, exist_ok=True)
        with open(os.path.join(folder, "soma-c4d.log"), "a", encoding="utf-8") as handle:
            handle.write("%s %s\n" % (time.strftime("%Y-%m-%d %H:%M:%S"), text))
    except OSError:
        pass


try:
    from soma_core import Agent, extensions  # noqa: E402
    from soma_core import i18n  # noqa: E402
    from soma_core.i18n import L  # noqa: E402
    from soma_c4d_host import C4DHost  # noqa: E402
    LOAD_ERROR = None
except Exception:  # noqa: BLE001 - shown in the dialog instead of a silent missing plugin
    LOAD_ERROR = traceback.format_exc()
    L = lambda en, pt: en  # noqa: E731
    log("Could not load: " + LOAD_ERROR)

# Outside Maxon's shared test range (1000001-1000010), which other plugins
# also use; an id clash stops the command from registering at all.
PLUGIN_ID = 1990421

ID_PROVIDER, ID_MODEL, ID_EFFORT, ID_STATUS, ID_CONNECT, ID_CHECK = 1001, 1002, 1003, 1004, 1005, 1006
ID_FEEDBACK = 1030
ID_LOG, ID_PROMPT, ID_SEND, ID_STOP, ID_ATTACH, ID_CLEAR, ID_NEW, ID_ATTACHED = 1010, 1011, 1012, 1013, 1014, 1015, 1016, 1017
ID_LANGUAGE = 1018
LANGUAGES = ["auto", "pt", "en"]
PROVIDERS = ["claude", "chatgpt", "antigravity"]

_agent = None


def agent():
    global _agent
    if LOAD_ERROR:
        raise RuntimeError("Soma Agente could not load its files:\n" + LOAD_ERROR)
    if _agent is None:
        _agent = Agent(C4DHost())
        _agent.start()
    return _agent


class SomaDialog(gui.GeDialog):
    def __init__(self):
        super().__init__()
        self.revision = -1
        self.attachments = []
        self.models = []
        self.efforts = []

    def CreateLayout(self):
        self.SetTitle("Soma Agente")
        self.GroupBegin(0, c4d.BFH_SCALEFIT | c4d.BFV_SCALEFIT, cols=1)
        self.GroupBorderSpace(6, 6, 6, 6)

        self.GroupBegin(0, c4d.BFH_SCALEFIT, cols=3)
        self.AddComboBox(ID_PROVIDER, c4d.BFH_SCALEFIT)
        self.AddChild(ID_PROVIDER, 0, "Claude")
        self.AddChild(ID_PROVIDER, 1, "ChatGPT")
        self.AddChild(ID_PROVIDER, 2, "Antigravity")
        self.AddComboBox(ID_MODEL, c4d.BFH_SCALEFIT)
        self.AddComboBox(ID_EFFORT, c4d.BFH_SCALEFIT)
        self.GroupEnd()

        self.GroupBegin(0, c4d.BFH_SCALEFIT, cols=4)
        self.AddStaticText(ID_STATUS, c4d.BFH_SCALEFIT, name=L("Starting…", "Iniciando…"))
        self.AddButton(ID_CONNECT, c4d.BFH_RIGHT, name="Connect")
        self.AddButton(ID_CHECK, c4d.BFH_RIGHT, name="Check")
        self.AddButton(ID_FEEDBACK, c4d.BFH_RIGHT, name="Feedback")
        self.GroupEnd()

        self.AddMultiLineEditText(ID_LOG, c4d.BFH_SCALEFIT | c4d.BFV_SCALEFIT, initw=360, inith=380,
                                  style=c4d.DR_MULTILINE_READONLY | c4d.DR_MULTILINE_WORDWRAP)
        self.AddStaticText(ID_ATTACHED, c4d.BFH_SCALEFIT, name="")
        self.AddMultiLineEditText(ID_PROMPT, c4d.BFH_SCALEFIT, initw=360, inith=70, style=c4d.DR_MULTILINE_WORDWRAP)

        self.GroupBegin(0, c4d.BFH_SCALEFIT, cols=6)
        self.AddButton(ID_SEND, c4d.BFH_SCALEFIT, name="Send")
        self.AddButton(ID_STOP, c4d.BFH_LEFT, name="Stop")
        self.AddButton(ID_ATTACH, c4d.BFH_LEFT, name="Attach image")
        self.AddButton(ID_CLEAR, c4d.BFH_LEFT, name="Clear")
        self.AddButton(ID_NEW, c4d.BFH_LEFT, name="New chat")
        self.AddComboBox(ID_LANGUAGE, c4d.BFH_RIGHT)
        self.AddChild(ID_LANGUAGE, 0, "Auto")
        self.AddChild(ID_LANGUAGE, 1, "Português")
        self.AddChild(ID_LANGUAGE, 2, "English")
        self.GroupEnd()
        self.GroupEnd()
        return True

    def InitValues(self):
        self.SetTimer(150)
        self.apply_texts()
        self.safely(lambda: self.refresh(force=True))
        return True

    def apply_texts(self):
        """Button captions in the current language (also after switching it)."""
        for cid, en, pt in ((ID_CONNECT, "Connect", "Conectar"), (ID_CHECK, "Check", "Verificar"), (ID_SEND, "Send", "Enviar"),
                            (ID_STOP, "Stop", "Parar"), (ID_ATTACH, "Attach image", "Anexar imagem"), (ID_CLEAR, "Clear", "Limpar"),
                            (ID_NEW, "New chat", "Nova conversa"), (ID_FEEDBACK, "Suggest / report bug", "Sugerir / reportar bug")):
            self.SetString(cid, L(en, pt))
        if not LOAD_ERROR:
            self.SetInt32(ID_LANGUAGE, LANGUAGES.index(i18n.choice()))
        self.LayoutChanged(0)

    def ask_pending(self):
        """Connectors the agent added (and downloaded skills) need the user's OK."""
        asked = getattr(self, "asked", set())
        self.asked = asked
        for item in extensions.pending():
            key = item["kind"] + ":" + item["name"]
            if key in asked:
                continue
            asked.add(key)
            question = (L("Soma Agente: the agent wants to add a %s.\n\n%s\n%s\n\nConnectors run programs on this computer. Approve?",
                          "Soma Agente: o agente quer adicionar: %s.\n\n%s\n%s\n\nConectores rodam programas neste computador. Aprovar?")
                        % (item["kind"], item["name"], item["detail"] or item["description"]))
            extensions.approve(item["kind"], item["name"], gui.QuestionDialog(question))
        # A newer Soma Agente on GitHub: offer it once per version.
        update = getattr(agent(), "update", None) or {}
        if update.get("available") and not update.get("requested") and update.get("latest") not in asked:
            asked.add(update.get("latest"))
            if gui.QuestionDialog(L("Soma Agente %s is available (you have %s).\n\nUpdate now? Reopen Cinema 4D after it installs.",
                                    "O Soma Agente %s está disponível (você tem a %s).\n\nAtualizar agora? Reabra o Cinema 4D depois que instalar.")
                                  % (update.get("latest"), update.get("current"))):
                threading.Thread(target=agent().install_update, daemon=True).start()

    def safely(self, action):
        """Runs dialog work; a failure is logged and shown instead of breaking the panel."""
        try:
            action()
        except Exception:  # noqa: BLE001
            detail = traceback.format_exc()
            if detail != getattr(self, "last_error", None):
                self.last_error = detail
                log(detail)
                self.SetString(ID_STATUS, L("Error — see the message below", "Erro — veja a mensagem abaixo"))
                self.SetString(ID_LOG, L("Soma Agente hit an error (also saved to AE Agent/soma-c4d.log):", "O Soma Agente encontrou um erro (salvo também em AE Agent/soma-c4d.log):") + "\n\n" + detail)

    # -------------------------------------------------------------- render
    def refresh(self, force=False):
        a = agent()
        if not force and a.revision == self.revision:
            return
        self.revision = a.revision
        self.SetInt32(ID_PROVIDER, PROVIDERS.index(a.provider))
        models = a.models()
        if [m["id"] for m in models] != [m["id"] for m in self.models]:
            self.FreeChildren(ID_MODEL)
            for i, m in enumerate(models):
                self.AddChild(ID_MODEL, i, m["name"])
            self.models = models
            self.LayoutChanged(ID_MODEL)
        current = a.selected_model()
        ids = [m["id"] for m in models]
        self.SetInt32(ID_MODEL, ids.index(current["id"]) if current["id"] in ids else 0)
        efforts = current["efforts"] or []
        if efforts != self.efforts:
            self.FreeChildren(ID_EFFORT)
            for i, e in enumerate(efforts or ["default"]):
                self.AddChild(ID_EFFORT, i, e.capitalize())
            self.efforts = efforts
            self.LayoutChanged(ID_EFFORT)
        effort = a.selected_effort()
        self.SetInt32(ID_EFFORT, efforts.index(effort) if effort in efforts else 0)
        self.Enable(ID_EFFORT, bool(efforts))
        self.SetString(ID_STATUS, a.status + ("  ·  " + a.update_text() if a.update_text() else ""))
        self.Enable(ID_CONNECT, not a.signed_in)
        self.Enable(ID_SEND, not a.busy)
        self.Enable(ID_STOP, a.busy)
        lines = []
        for m in a.messages:
            role = m["role"]
            if role == "tool":
                mark = {"running": "…", "done": "✓", "failed": "✗"}.get(m.get("state"), "•")
                lines.append("   %s %s" % (mark, m["text"]))
            elif role == "user":
                lines.append("\n" + L("You: ", "Você: ") + m["text"])
            elif role == "assistant":
                lines.append("\nSoma: " + m["text"])
            else:
                lines.append("\n[" + role + "] " + m["text"])
        if not lines:
            lines = [L("Describe what you want in the scene. Soma inspects the document, makes the change, and checks the result with a quick render.", "Descreva o que você quer na cena. O Soma inspeciona o documento, faz a mudança e confere o resultado com um render rápido.")]
        self.SetString(ID_LOG, "\n".join(lines).strip())
        try:
            self.SetMultiLinePos(ID_LOG, 10 ** 6, 0)
        except Exception:  # noqa: BLE001 - older versions
            pass
        names = ", ".join(os.path.basename(p) for p in self.attachments)
        self.SetString(ID_ATTACHED, (L("Attached: ", "Anexado: ") + names) if names else "")

    def Timer(self, msg):
        def tick():
            agent().pump()
            self.refresh()
            self.ask_pending()
        self.safely(tick)

    # -------------------------------------------------------------- input
    def Command(self, cid, msg):
        self.safely(lambda: self.handle(cid))
        return True

    def handle(self, cid):
        a = agent()
        if cid == ID_PROVIDER:
            a.set_provider(PROVIDERS[self.GetInt32(ID_PROVIDER)])
        elif cid == ID_MODEL:
            index = self.GetInt32(ID_MODEL)
            if 0 <= index < len(self.models):
                a.select_model(self.models[index]["id"])
        elif cid == ID_EFFORT:
            index = self.GetInt32(ID_EFFORT)
            if 0 <= index < len(self.efforts):
                a.select_effort(self.efforts[index])
        elif cid == ID_CONNECT:
            a.login()
        elif cid == ID_CHECK:
            a.refresh()
            threading.Thread(target=lambda: a.check_update(True), daemon=True).start()
        elif cid == ID_FEEDBACK:
            a.open_feedback()
        elif cid == ID_SEND:
            if a.send(self.GetString(ID_PROMPT), self.attachments):
                self.SetString(ID_PROMPT, "")
                self.attachments = []
        elif cid == ID_STOP:
            a.stop()
        elif cid == ID_ATTACH:
            path = c4d.storage.LoadDialog(type=c4d.FILESELECTTYPE_IMAGES, title=L("Attach a reference image", "Anexar uma imagem de referência"))
            if path:
                self.attachments.append(path)
        elif cid == ID_CLEAR:
            self.attachments = []
        elif cid == ID_NEW:
            a.new_chat()
        elif cid == ID_LANGUAGE:
            i18n.set_choice(LANGUAGES[self.GetInt32(ID_LANGUAGE)])
            self.apply_texts()
        self.refresh(force=True)


class SomaCommand(c4d.plugins.CommandData):
    dialog = None

    def Execute(self, doc):
        if self.dialog is None:
            self.dialog = SomaDialog()
        return self.dialog.Open(dlgtype=c4d.DLG_TYPE_ASYNC, pluginid=PLUGIN_ID, defaultw=380, defaulth=640)

    def RestoreLayout(self, sec_ref):
        if self.dialog is None:
            self.dialog = SomaDialog()
        return self.dialog.Restore(pluginid=PLUGIN_ID, secret=sec_ref)


def PluginMessage(mid, data):
    if mid == c4d.C4DPL_ENDACTIVITY and _agent is not None:
        _agent.shutdown()
    return False


if __name__ == "__main__":
    try:
        icon = c4d.bitmaps.BaseBitmap()
        icon_path = os.path.join(HERE, "res", "soma-icon.png")
        if not os.path.isfile(icon_path) or icon.InitWith(icon_path)[0] != c4d.IMAGERESULT_OK:
            icon = None
        if c4d.plugins.RegisterCommandPlugin(id=PLUGIN_ID, str="Soma Agente", info=0, icon=icon,
                                             help=L("Chat with Claude, ChatGPT or Antigravity to edit the scene", "Converse com o Claude, o ChatGPT ou o Antigravity para editar a cena"), dat=SomaCommand()):
            log("Registered (Extensions > Soma Agente).")
        else:
            log("Cinema 4D refused to register the command (plugin id %d already in use?)." % PLUGIN_ID)
    except Exception:  # noqa: BLE001
        log("Registration failed: " + traceback.format_exc())
