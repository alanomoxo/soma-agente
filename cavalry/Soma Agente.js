// Soma Agente for Cavalry: a chat panel (Scripts > Soma Agente).
// Cavalry scripts cannot start programs, so the Soma Hub (a small local server
// installed with Soma) runs the AI (Claude Code, Codex or agy). This panel polls
// the hub for chat updates and tool calls, runs the tools with Cavalry's api
// module, and posts the results back.
var HUB = "http://127.0.0.1:47821";
var somaTimer = null;

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
ui.setTitle("Soma Agente");
var provider = new ui.DropDown();
["Claude", "ChatGPT", "Antigravity"].forEach(function (p) { provider.addEntry(p); });
var model = new ui.DropDown();
var newChat = new ui.Button("");
var status = new ui.Label("");
var connect = new ui.Button("");
var log = new ui.MultiLineEdit();
log.setReadOnly(true);
log.setMinimumHeight(320);
var notice = new ui.Label("");
var noticeYes = new ui.Button("");
var noticeNo = new ui.Button("");
var attached = new ui.Label("");
var prompt = new ui.MultiLineEdit();
prompt.setMinimumHeight(70);
var send = new ui.Button("");
var attach = new ui.Button("");
var language = new ui.DropDown();
["Auto", "Português", "English"].forEach(function (p) { language.addEntry(p); });

var top = new ui.HLayout(); top.add(provider, model, newChat);
var statusRow = new ui.HLayout(); statusRow.add(status); statusRow.addStretch(); statusRow.add(connect);
var noticeRow = new ui.HLayout(); noticeRow.add(notice); noticeRow.addStretch(); noticeRow.add(noticeYes, noticeNo);
var actions = new ui.HLayout(); actions.add(attach, language); actions.addStretch(); actions.add(send);
ui.add(top, statusRow, noticeRow, log, attached, prompt, actions);
ui.setMinimumHeight(560);

var noticeAction = null, noticeReject = null;

function applyTexts() {
    newChat.setText(L("+ New chat", "+ Nova conversa"));
    connect.setText(L("Connect", "Conectar"));
    send.setText(state && state.busy ? L("Stop", "Parar") : L("Send", "Enviar"));
    attach.setText(L("+ Image", "+ Imagem"));
    prompt.setPlaceholder(L("Message Soma Agente", "Mensagem para o Soma Agente"));
}

function showNotice(text, yes, no, onYes, onNo) {
    notice.setText(text || "");
    notice.setHidden(!text);
    noticeYes.setText(yes || ""); noticeYes.setHidden(!yes);
    noticeNo.setText(no || ""); noticeNo.setHidden(!no);
    noticeAction = onYes; noticeReject = onNo;
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
    status.setText(state.status);
    status.setTextColor(state.signedIn ? "#52d98b" : "#f4833d");
    connect.setHidden(!!state.signedIn);
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
    var lines = [];
    state.messages.forEach(function (m) {
        if (m.role === "tool") { lines.push("   " + ({ running: "…", done: "✓", failed: "✗" }[m.state] || "•") + " " + m.text); }
        else if (m.role === "user") { lines.push("\n" + L("You: ", "Você: ") + m.text); }
        else if (m.role === "assistant") { lines.push("\nSoma: " + m.text); }
        else { lines.push("\n[" + m.role + "] " + m.text); }
    });
    log.setText(lines.length ? lines.join("\n").replace(/^\n+/, "") : L("Describe what you want in the scene. Soma inspects it, makes the change and checks the result with a preview frame.",
        "Descreva o que você quer na cena. O Soma inspeciona, faz a mudança e confere o resultado com um quadro de prévia."));
    attached.setText(attachments.length ? L("Attached: ", "Anexado: ") + attachments.map(function (p) { return p.split(/[\\/]/).pop(); }).join(", ") : "");
}

var polling = false;
function poll() {
    // The web client waits inside Cavalry's event loop, so the timer can fire again meanwhile.
    if (polling) { return; }
    polling = true;
    try { pollOnce(); } finally { polling = false; }
}

function pollOnce() {
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
            status.setText(L("Soma Hub is not running. Reinstall Soma Agente or open “Soma Hub” from the Start menu.", "O Soma Hub não está rodando. Reinstale o Soma Agente ou abra o “Soma Hub” no menu Iniciar."));
            status.setTextColor("#ff626d");
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
    if (r.ok) { prompt.clear(); attachments = []; }
};

function Poller() { this.onTimeout = function () { try { poll(); } catch (e) { somaLog("timer: " + (e && e.stack || e)); } }; }
somaTimer = new api.Timer(new Poller());
somaTimer.setInterval(250);
somaTimer.setRepeating(true);
somaTimer.start();
ui.onClose = function () { somaTimer.stop(); };
applyTexts();
showNotice(null);
status.setText(L("Connecting to Soma…", "Conectando ao Soma…"));
somaLog("ui ready");
ui.show();
poll();
}

somaLog("starting");
try { somaMain(); } catch (error) { somaLog("startup failed: " + (error && error.stack || error)); }
