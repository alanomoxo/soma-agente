// Soma Agente for Cavalry: a chat panel (Scripts > Soma Agente).
// Cavalry scripts cannot start programs, so the Soma Hub (a small local server
// installed with Soma) runs the AI (Claude Code, Codex or agy). This panel polls
// the hub for chat updates and tool calls, runs the tools with Cavalry's api
// module, and posts the results back.
var HUB = "http://127.0.0.1:47821";
var somaTimer = null;
var DEMO = null; // tests: function (state) returning a fake hub state

// Errors go to the JavaScript console and to AE Agent/soma-cavalry.log (through the hub).
var somaLines = [];
function somaLog(text) {
    console.log("Soma Agente: " + text);
    somaLines.push(new Date().toISOString() + " " + text);
    try { api.writeToFile(api.getPreferencesFolder() + "/soma-agente.log", somaLines.slice(-200).join("\n"), true); } catch (e) { /* read-only folder */ }
    try { new api.WebClient(HUB).post("/cavalry/log", JSON.stringify({ text: String(text) }), "application/json"); } catch (e) { /* hub off */ }
}

function somaMain() {
var client = new api.WebClient(HUB);
var revision = -1, state = null, online = false, registered = false, attachments = [];
var lang = "pt", rendering = false, rendered = false;
function L(en, pt) { return lang === "pt" ? pt : en; }

// ------------------------------------------------------------------ hub
function hubGet(path) {
    client.get(path);
    if (client.status() !== 200) { throw new Error("hub " + client.status()); }
    return JSON.parse(client.body());
}

function hubPost(path, body) {
    client.post(path, JSON.stringify(body || {}), "application/json");
    if (client.status() !== 200) { throw new Error("hub " + client.status()); }
    return JSON.parse(client.body() || "{}");
}

// ---------------------------------------------------------------- tools
function T(name, description, properties, required) {
    return { name: name, description: description, inputSchema: { type: "object", properties: properties || {}, required: required || [], additionalProperties: false } };
}
var str = { type: "string" }, num = { type: "number" }, int = { type: "integer" };
var TOOLS = [
    T("get_scene_info", "Active composition (id, name, resolution, frame range, fps, current frame), its top-level layers and the selection."),
    T("list_layers", "Layer tree of the active composition with id, name, type and children.", { depth: int }),
    T("get_attributes", "Attributes of a layer with their current values. filter keeps ids containing the text (e.g. position, color).", { layerId: str, filter: str }, ["layerId"]),
    T("create_layer", "Create a layer. type: a primitive (rectangle, ellipse, polygon, star, line, arc, capsule, cross, ring, superEllipse, triangle) or any layer type (textShape, null, duplicator, …). attributes are set right after (e.g. {\"position\": [0, 100], \"material.materialColor\": \"#E70E77\"}).",
        { type: str, name: str, attributes: { type: "object" }, parentId: str }, ["type"]),
    T("set_attributes", "Set attributes on a layer, e.g. {\"position.x\": 120, \"rotation\": 45, \"material.materialColor\": \"#FFFFFF\", \"text\": \"Hello\"}.", { layerId: str, attributes: { type: "object" } }, ["layerId", "attributes"]),
    T("set_keyframes", "Animate one attribute: keyframes [{frame, value}], interpolation bezier (default), linear or step.",
        { layerId: str, attribute: str, keyframes: { type: "array", items: { type: "object" } }, interpolation: str }, ["layerId", "attribute", "keyframes"]),
    T("delete_layers", "Delete layers.", { layerIds: { type: "array", items: str } }, ["layerIds"]),
    T("rename_layer", "Rename a layer.", { layerId: str, name: str }, ["layerId", "name"]),
    T("parent_layer", "Parent a layer to another layer (a group, null, duplicator…).", { layerId: str, parentId: str }, ["layerId", "parentId"]),
    T("connect_attributes", "Connect an output attribute of one layer to an input of another (Cavalry's node connections).", { fromLayerId: str, fromAttribute: str, toLayerId: str, toAttribute: str }, ["fromLayerId", "fromAttribute", "toLayerId", "toAttribute"]),
    T("select_layers", "Select layers.", { layerIds: { type: "array", items: str } }, ["layerIds"]),
    T("set_frame", "Move the playhead.", { frame: int }, ["frame"]),
    T("import_asset", "Import an image, video or SVG file into the Assets window and, for images, create a layer that shows it.", { path: str }, ["path"]),
    T("preview_frame", "Render a frame of the active composition to PNG and return it as an image for visual inspection.", { frame: int, scale: num, reason: str }),
    T("execute_script", "General fallback: run Cavalry JavaScript (the api module is in scope; return a small JSON-safe value).", { summary: str, code: str }, ["summary", "code"])
];

var PRIMITIVES = ["rectangle", "ellipse", "polygon", "star", "line", "arc", "capsule", "cross", "ring", "superEllipse", "triangle", "cog", "plus"];

function safeGet(id, attr) { try { return api.get(id, attr); } catch (e) { return undefined; } }

function layerInfo(id) {
    return { id: id, name: api.getNiceName(id), type: api.getLayerType(id) };
}

function tree(ids, depth) {
    return ids.map(function (id) {
        var info = layerInfo(id);
        var children = [];
        try { children = api.getChildren(id) || []; } catch (e) { children = []; }
        if (children.length) { info.children = depth > 0 ? tree(children, depth - 1) : children.length; }
        return info;
    });
}

function setAll(id, attributes) {
    var values = {};
    Object.keys(attributes || {}).forEach(function (key) { values[key] = attributes[key]; });
    if (Object.keys(values).length) { api.set(id, values); }
}

var RUN = {
    get_scene_info: function () {
        var comp = api.getActiveComp();
        var info = { compId: comp, name: comp ? api.getNiceName(comp) : null, frame: api.getFrame() };
        ["resolution", "startFrame", "endFrame", "fps", "backgroundColor"].forEach(function (attr) {
            var value = safeGet(comp, attr);
            if (value !== undefined) { info[attr] = value; }
        });
        info.layers = (api.getCompLayers(true) || []).map(layerInfo);
        info.selection = api.getSelection() || [];
        return info;
    },
    list_layers: function (a) { return tree(api.getCompLayers(true) || [], a.depth === undefined ? 4 : a.depth); },
    get_attributes: function (a) {
        var out = {}, filter = (a.filter || "").toLowerCase();
        (api.getAttributes(a.layerId) || []).forEach(function (attr) {
            if (filter && attr.toLowerCase().indexOf(filter) < 0) { return; }
            var value = safeGet(a.layerId, attr);
            if (value !== undefined && JSON.stringify(value).length < 400) { out[attr] = value; }
        });
        return { layer: layerInfo(a.layerId), attributes: out };
    },
    create_layer: function (a) {
        var type = String(a.type);
        var id = PRIMITIVES.indexOf(type) >= 0 ? api.primitive(type, a.name || type) : api.create(type, a.name || type);
        if (!id) { throw new Error("Cavalry could not create a layer of type " + type + "."); }
        if (a.parentId) { api.parent(id, a.parentId); }
        setAll(id, a.attributes);
        return layerInfo(id);
    },
    set_attributes: function (a) { setAll(a.layerId, a.attributes); return { layer: layerInfo(a.layerId) }; },
    set_keyframes: function (a) {
        var type = { bezier: 0, linear: 1, step: 2 }[String(a.interpolation || "bezier").toLowerCase()];
        a.keyframes.forEach(function (k) {
            var values = {}; values[a.attribute] = k.value;
            api.keyframe(a.layerId, k.frame, values);
            if (type !== 0) { var mod = {}; mod[a.attribute] = { frame: k.frame, type: type }; api.modifyKeyframe(a.layerId, mod); }
        });
        return { layer: layerInfo(a.layerId), attribute: a.attribute, keyframes: api.getKeyframeTimes(a.layerId, a.attribute) };
    },
    delete_layers: function (a) { a.layerIds.forEach(function (id) { api.deleteLayer(id); }); return { deleted: a.layerIds }; },
    rename_layer: function (a) { api.rename(a.layerId, a.name); return layerInfo(a.layerId); },
    parent_layer: function (a) { api.parent(a.layerId, a.parentId); return layerInfo(a.layerId); },
    connect_attributes: function (a) { api.connect(a.fromLayerId, a.fromAttribute, a.toLayerId, a.toAttribute, true); return { connected: true }; },
    select_layers: function (a) { api.select(a.layerIds); return { selection: api.getSelection() }; },
    set_frame: function (a) { api.setFrame(a.frame); return { frame: api.getFrame() }; },
    import_asset: function (a) {
        var asset = api.loadAsset(a.path, false);
        var layer = null;
        if (/\.(png|jpe?g|gif|webp|bmp|tiff?)$/i.test(a.path)) {
            layer = api.primitive("rectangle", a.path.split(/[\\/]/).pop());
            try { api.connect(asset, "id", layer, "material.materialImage", true); } catch (e) { /* older versions: asset stays in the Assets window */ }
        }
        return { assetId: asset, layer: layer ? layerInfo(layer) : null };
    },
    preview_frame: function (a) {
        var previous = api.getFrame();
        if (a.frame !== undefined) { api.setFrame(a.frame); }
        // Written next to the Cavalry preferences; the hub deletes it after reading.
        var path = api.getPreferencesFolder() + "/soma-preview-" + Date.now();
        api.renderPNGFrame(path, a.scale || 50);
        if (a.frame !== undefined) { api.setFrame(previous); }
        return { frame: a.frame === undefined ? previous : a.frame, imagePaths: [path + ".png"] };
    },
    execute_script: function (a) {
        var result = (new Function("api", "cavalry", a.code))(api, typeof cavalry !== "undefined" ? cavalry : undefined);
        return result === undefined ? null : JSON.parse(JSON.stringify(result));
    }
};

function runTool(call) {
    var result;
    try {
        var fn = RUN[call.name];
        if (!fn) { throw new Error("Unknown tool " + call.name); }
        result = { ok: true, data: fn(call.args || {}) };
        if (result.data && result.data.imagePaths) { result.imagePaths = result.data.imagePaths; }
    } catch (error) {
        result = { ok: false, error: String(error && error.message || error) };
    }
    hubPost("/cavalry/tool-result", { id: call.id, result: result });
}

// ------------------------------------------------------------------- UI
var C = { card: "#26262b", user: "#3b2547", pink: "#E70E77", text: "#ececf1", dim: "#8e8e96", green: "#52d98b", orange: "#f4833d", red: "#ff626d", errorBg: "#3d1d22", errorText: "#ffb3b9" };

function label(text, size, color) {
    var l = new ui.Label(text || "");
    if (size) { l.setFontSize(size); }
    if (color) { l.setTextColor(color); }
    return l;
}

function vbox(margins, spacing) {
    var v = new ui.VLayout();
    v.setMargins(margins[0], margins[1], margins[2], margins[3]);
    v.setSpaceBetween(spacing);
    return v;
}

function card(layout, color, radius) {
    var c = new ui.Container();
    c.setLayout(layout);
    c.setBackgroundColor(color);
    var r = radius || 8;
    c.setRadius(r, r, r, r);
    return c;
}

function button(color) {
    var b = new ui.Button("");
    if (color) { b.setBackgroundColor(color); }
    return b;
}

ui.setTitle("Soma Agente");
ui.setMargins(10, 10, 10, 10);
ui.setSpaceBetween(8);

// Header: brand, status and New chat
var title = label("", 15, C.text);
title.setMarkdown("**Soma** Agente");
var dot = label("●", 11, C.dim);
var status = label("", 11, C.dim);
var newChat = button();
var header = new ui.HLayout();
header.setSpaceBetween(6);
header.add(title);
header.addStretch();
header.add(newChat);
var statusRow = new ui.HLayout();
statusRow.setSpaceBetween(6);
statusRow.add(dot, status);

// Which AI, model and language
var provider = new ui.DropDown();
["Claude", "ChatGPT", "Antigravity"].forEach(function (p) { provider.addEntry(p); });
var model = new ui.DropDown();
var language = new ui.DropDown();
["Auto", "Português", "English"].forEach(function (p) { language.addEntry(p); });
var pickers = new ui.HLayout();
pickers.setSpaceBetween(6);
pickers.add(provider, model);
pickers.addStretch();
pickers.add(language);

// Sign-in card and notice card (approvals, updates)
var connectText = label("", 12, C.text);
var connect = button(C.pink);
var connectRow = new ui.HLayout();
connectRow.add(connectText);
connectRow.addStretch();
connectRow.add(connect);
var connectBox = vbox([12, 10, 12, 10], 6);
connectBox.add(connectRow);
var connectCard = card(connectBox, C.card, 10);

var notice = label("", 12, C.text);
var noticeYes = button(C.pink);
var noticeNo = button();
var noticeRow = new ui.HLayout();
noticeRow.setSpaceBetween(6);
noticeRow.add(notice);
noticeRow.addStretch();
noticeRow.add(noticeYes, noticeNo);
var noticeBox = vbox([12, 10, 12, 10], 6);
noticeBox.add(noticeRow);
var noticeCard = card(noticeBox, "#2f2635", 10);

// Conversation: shows the current turn; a new turn gets a new scroll view so it starts at the top.
var chatHost = new ui.VLayout();
chatHost.setMargins(0, 0, 0, 0);
var chat = null, showHistory = false, shownStart = -1;
function newScroll() {
    chatHost.clear();
    chat = vbox([0, 0, 8, 0], 8);
    var scroll = new ui.ScrollView();
    scroll.setLayout(chat);
    chatHost.add(scroll);
}
newScroll();

// Composer
var attached = label("", 11, C.dim);
var prompt = new ui.MultiLineEdit();
prompt.setFixedHeight(56);
prompt.setFontSize(12);
var attach = button();
var send = button(C.pink);
var actions = new ui.HLayout();
actions.setSpaceBetween(6);
actions.add(attach);
actions.addStretch();
actions.add(send);
var composerBox = vbox([8, 8, 8, 8], 6);
composerBox.add(attached, prompt, actions);
var composer = card(composerBox, C.card, 10);

ui.add(header, pickers, statusRow, connectCard, noticeCard, chatHost, composer);
ui.setMinimumWidth(360);
ui.setMinimumHeight(560);

var noticeAction = null, noticeReject = null, shownChat = null;
var SUGGESTIONS = [
    ["Bouncing pink ball", "Bola rosa quicando", "Make a pink ball that bounces three times", "Crie uma bola rosa que quica três vezes"],
    ["Animated title", "Título animado", "Add a title \"Hello\" that slides in from the left", "Adicione um título \"Olá\" que entra deslizando da esquerda"],
    ["Grid of circles", "Grade de círculos", "Make a 5x5 grid of circles that pulse one after another", "Crie uma grade 5x5 de círculos que pulsam um depois do outro"]
];

function applyTexts() {
    newChat.setText(L("+ New chat", "+ Nova conversa"));
    newChat.setToolTip(L("Start a new conversation", "Começar uma nova conversa"));
    connect.setText(L("Connect", "Conectar"));
    send.setText(state && state.busy ? L("Stop", "Parar") : L("Send", "Enviar"));
    send.setBackgroundColor(state && state.busy ? "#5a2a30" : C.pink);
    attach.setText(L("+ Image", "+ Imagem"));
    attach.setToolTip(L("Attach a reference image", "Anexar uma imagem de referência"));
    prompt.setPlaceholder(L("Message Soma Agente", "Mensagem para o Soma Agente"));
}

function showNotice(text, yes, no, onYes, onNo) {
    notice.setText(text || "");
    noticeCard.setHidden(!text);
    noticeYes.setText(yes || ""); noticeYes.setHidden(!yes);
    noticeNo.setText(no || ""); noticeNo.setHidden(!no);
    noticeAction = onYes; noticeReject = onNo;
}

function showStatus(text, color, signedIn) {
    // Signed out, the sign-in card shows the status instead.
    status.setText(signedIn ? text : "");
    dot.setHidden(!signedIn);
    dot.setTextColor(color);
    connectText.setText(text);
    connectCard.setHidden(!!signedIn);
}

// ------------------------------------------------------------- messages
function emptyView() {
    var box = vbox([16, 18, 16, 16], 8);
    var head = label(L("What should we make?", "O que vamos criar?"), 15, C.text);
    head.setAlignment(1);
    var hint = label(L("Describe it in your own words. Soma inspects the scene, makes the change and checks it with a preview frame.",
        "Descreva com suas palavras. O Soma inspeciona a cena, faz a mudança e confere com um quadro de prévia."), 11, C.dim);
    hint.setAlignment(1);
    box.add(head, hint);
    box.addSpacing(4);
    SUGGESTIONS.forEach(function (s) {
        var b = button("#33333a");
        b.setText(L(s[0], s[1]));
        b.onClick = function () { prompt.setText(L(s[2], s[3])); };
        box.add(b);
    });
    return card(box, C.card, 12);
}

function bubble(m) {
    var row = new ui.HLayout();
    if (m.role === "tool") {
        row.addSpacing(12);
        row.add(label(({ running: "◌  ", done: "✓  ", failed: "✗  " }[m.state] || "•  ") + m.text, 11, m.state === "failed" ? C.red : (m.state === "running" ? C.text : C.dim)));
        return row;
    }
    if (m.role === "status") {
        var note = label(m.text, 11, C.dim);
        note.setAlignment(1);
        row.add(note);
        return row;
    }
    var box = vbox([12, 8, 12, 10], 3);
    var body = label("", 12, m.role === "error" ? C.errorText : C.text);
    if (m.role === "assistant") {
        box.add(label("Soma", 10, C.pink));
        body.setMarkdown(m.text);
    } else {
        if (m.role === "error") { box.add(label(L("Something went wrong", "Algo deu errado"), 10, C.red)); }
        body.setText(m.text);
    }
    box.add(body);
    var bg = m.role === "user" ? C.user : (m.role === "error" ? C.errorBg : C.card);
    if (m.role === "user") { row.addSpacing(40); row.add(card(box, bg, 12)); }
    else { row.add(card(box, bg, 12)); row.addSpacing(40); }
    return row;
}

function renderChat() {
    var all = state.messages, start = 0;
    for (var i = all.length - 1; i >= 0 && !showHistory; i--) { if (all[i].role === "user") { start = i; break; } }
    if (showHistory) { start = Math.max(0, all.length - 60); }
    var messages = all.slice(start);
    var key = lang + showHistory + start + JSON.stringify(messages);
    if (key === shownChat) { return; }
    shownChat = key;
    if (start !== shownStart) { newScroll(); shownStart = start; } else { chat.clear(); }
    if (start > 0 || showHistory) {
        var toggle = button("#2c2c31");
        toggle.setText(showHistory ? L("Hide earlier messages", "Ocultar mensagens anteriores") : L("Show " + start + " earlier messages", "Mostrar " + start + " mensagens anteriores"));
        toggle.onClick = function () { showHistory = !showHistory; renderChat(); };
        chat.add(toggle);
    }
    if (!all.length) { chat.add(emptyView()); }
    messages.forEach(function (m) { chat.add(bubble(m)); });
    chat.addStretch();
}

function fitComposer() {
    composer.setFixedHeight(attachments.length ? 138 : 114);
}

function render() {
    rendering = true;
    try { renderState(); } finally { rendering = false; }
}

function renderState() {
    if (state.lang && state.lang !== lang) { lang = state.lang; }
    applyTexts();
    provider.setValue(["claude", "chatgpt", "antigravity"].indexOf(state.provider));
    model.clear();
    state.models.forEach(function (m) { model.addEntry(m.name); });
    state.models.forEach(function (m, i) { if (m.id === state.model) { model.setValue(i); } });
    language.setValue(["auto", "pt", "en"].indexOf(state.languageChoice || "auto"));
    showStatus(state.status, state.busy ? C.orange : (state.signedIn ? C.green : C.orange), state.signedIn);
    connect.setHidden(false);
    var pending = (state.pending || [])[0];
    var update = state.update || {};
    if (pending) {
        showNotice(L("The agent wants to add ", "O agente quer adicionar ") + pending.kind + ": " + pending.name, L("Approve", "Aprovar"), L("Reject", "Recusar"),
            function () { hubPost("/cavalry/extensions/approve", { kind: pending.kind, name: pending.name, accept: true }); },
            function () { hubPost("/cavalry/extensions/approve", { kind: pending.kind, name: pending.name, accept: false }); });
    } else if (update.available && update.latest) {
        showNotice(update.requested ? (update.detail || L("Installing Soma Agente ", "Instalando o Soma Agente ") + update.latest)
            : L("Soma Agente " + update.latest + " is available (you have " + update.current + ").", "O Soma Agente " + update.latest + " está disponível (você tem a " + update.current + ")."),
            update.requested ? null : L("Update now", "Atualizar agora"), null, function () { hubPost("/hub/update/install"); }, null);
    } else {
        showNotice(null);
    }
    renderChat();
    attached.setText(attachments.length ? L("Attached: ", "Anexado: ") + attachments.map(function (p) { return p.split(/[\\/]/).pop(); }).join(", ") : "");
    attached.setHidden(!attachments.length);
    fitComposer();
}

var polling = false;
function poll() {
    // The web client waits inside Cavalry's event loop, so the timer can fire again meanwhile.
    if (polling) { return; }
    polling = true;
    try { pollOnce(); } finally { polling = false; }
}

function pollOnce() {
    if (DEMO) { state = DEMO(state); render(); return; }
    try {
        if (!registered) {
            hubPost("/cavalry/register", { tools: TOOLS });
            registered = true; online = true; revision = -1;
            somaLog("registered");
        }
        var s = hubGet("/cavalry/state?wait=0&since=" + revision);
        (s.toolCalls || []).forEach(runTool);
        if (s.revision !== revision || (s.toolCalls || []).length) {
            state = s; revision = s.revision;
            if (!rendered) { somaLog("first render"); rendered = true; }
            render();
        }
    } catch (error) {
        if (online || registered || revision === -1) {
            somaLog("poll: " + (error && error.stack || error));
            online = false; registered = false; revision = -2;
            showStatus(L("Soma Hub is not running. Reinstall Soma Agente or open “Soma Hub” from the Start menu.", "O Soma Hub não está rodando. Reinstale o Soma Agente ou abra o “Soma Hub” no menu Iniciar."), C.red, false);
            connect.setHidden(true);
        }
    }
}

provider.onValueChanged = function () { if (rendering) { return; } hubPost("/cavalry/provider", { provider: ["claude", "chatgpt", "antigravity"][provider.getValue()] }); };
model.onValueChanged = function () { if (rendering) { return; } if (state && state.models[model.getValue()]) { hubPost("/cavalry/model", { model: state.models[model.getValue()].id }); } };
language.onValueChanged = function () { if (rendering) { return; } hubPost("/cavalry/language", { language: ["auto", "pt", "en"][language.getValue()] }); };
newChat.onClick = function () { hubPost("/cavalry/new"); };
connect.onClick = function () { hubPost("/cavalry/login"); };
noticeYes.onClick = function () { if (noticeAction) { noticeAction(); } };
noticeNo.onClick = function () { if (noticeReject) { noticeReject(); } };
attach.onClick = function () {
    var path = api.presentOpenFile("", L("Attach a reference image", "Anexar uma imagem de referência"), "Images (*.png *.jpg *.jpeg *.gif *.webp)");
    if (path) { attachments.push(path); render(); }
};
send.onClick = function () {
    if (state && state.busy) { hubPost("/cavalry/stop"); return; }
    var text = prompt.getText().trim();
    if (!text && !attachments.length) { return; }
    var r = hubPost("/cavalry/send", { text: text, paths: attachments });
    if (r.ok) { prompt.clear(); attachments = []; showHistory = false; }
};

function Poller() { this.onTimeout = function () { try { poll(); } catch (e) { somaLog("timer: " + (e && e.stack || e)); } }; }
somaTimer = new api.Timer(new Poller());
somaTimer.setInterval(250);
somaTimer.setRepeating(true);
somaTimer.start();
ui.onClose = function () { somaTimer.stop(); };
applyTexts();
showNotice(null);
attached.setHidden(true);
fitComposer();
showStatus(L("Connecting to Soma…", "Conectando ao Soma…"), C.dim, false);
connect.setHidden(true);
somaLog("ui ready");
ui.show();
poll();
}

somaLog("starting");
try { somaMain(); } catch (error) { somaLog("startup failed: " + (error && error.stack || error)); }
