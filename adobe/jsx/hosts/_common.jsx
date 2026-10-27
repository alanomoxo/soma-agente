/* Shared helpers for the Photoshop, Illustrator and Premiere Pro bridges.
   Each bridge evaluates this file first, then adds its own tools to AEAgent
   and optionally the hooks _around (wraps every tool) and _wrapMutation
   (wraps tools listed in _mutating, returning { data, undoable }). */

var AEAgent = {};
AEAgent._mutating = {};

/* ExtendScript does not consistently provide the browser JSON object. */
AEAgent._quote = function (value) {
    return "\"" + String(value)
        .replace(/\\/g, "\\\\")
        .replace(/\"/g, "\\\"")
        .replace(/\r/g, "\\r")
        .replace(/\n/g, "\\n")
        .replace(/\t/g, "\\t") + "\"";
};

AEAgent._stringify = function (value) {
    if (value === null || value === undefined) { return "null"; }
    var type = typeof value;
    if (type === "string") { return AEAgent._quote(value); }
    if (type === "number") { return isFinite(value) ? String(value) : "null"; }
    if (type === "boolean") { return value ? "true" : "false"; }
    var i;
    var parts = [];
    if (value instanceof Array) {
        for (i = 0; i < value.length; i += 1) { parts.push(AEAgent._stringify(value[i])); }
        return "[" + parts.join(",") + "]";
    }
    if (type === "object") {
        for (i in value) {
            if (value.hasOwnProperty(i) && value[i] !== undefined && typeof value[i] !== "function") {
                parts.push(AEAgent._quote(i) + ":" + AEAgent._stringify(value[i]));
            }
        }
        return "{" + parts.join(",") + "}";
    }
    return AEAgent._quote(String(value));
};

AEAgent._parse = function (value) {
    /* The panel creates this string with JSON.stringify before URI encoding. */
    return eval("(" + value + ")");
};

AEAgent._result = function (ok, data, error, undoable) {
    return AEAgent._stringify({ ok: ok, data: data === undefined ? null : data, error: error || null, undoable: undoable === true });
};

AEAgent._round = function (value, digits) {
    var factor = Math.pow(10, digits === undefined ? 2 : digits);
    return Math.round(Number(value) * factor) / factor;
};

AEAgent._hex = function (r, g, b) {
    function part(v) { var s = Math.max(0, Math.min(255, Math.round(v))).toString(16); return s.length < 2 ? "0" + s : s; }
    return "#" + part(r) + part(g) + part(b);
};

AEAgent._rgb = function (hex) {
    var m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ""));
    if (!m) { throw new Error("Colors must be six-digit hex values such as #E70E77."); }
    var n = parseInt(m[1], 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
};

AEAgent._tempFile = function (extension) {
    var folder = new Folder(Folder.temp.fsName + "/soma-agente");
    if (!folder.exists) { folder.create(); }
    return new File(folder.fsName + "/preview-" + new Date().getTime() + "-" + Math.floor(Math.random() * 1000000) + extension);
};

AEAgent.execute_script = function (args) {
    var code = String(args.code || "");
    if (!code) { throw new Error("ExtendScript code is required."); }
    var runner = eval("(function () {\n" + code + "\n})");
    var result = runner();
    return result === undefined ? { executed: true } : result;
};

AEAgent.invoke = function (encodedPayload) {
    try {
        var payload = AEAgent._parse(decodeURIComponent(encodedPayload));
        var tool = payload && payload.tool;
        if (!tool || tool.charAt(0) === "_" || typeof AEAgent[tool] !== "function" || tool === "invoke") {
            throw new Error("Unknown " + AEAgent.hostName + " tool: " + tool);
        }
        var args = payload.args || {};
        var run = function () {
            if (AEAgent._mutating[tool] && AEAgent._wrapMutation) {
                return AEAgent._wrapMutation(tool, function () { return AEAgent[tool](args); });
            }
            return { data: AEAgent[tool](args), undoable: false };
        };
        var outcome = AEAgent._around ? AEAgent._around(run) : run();
        return AEAgent._result(true, outcome.data, null, outcome.undoable);
    } catch (error) {
        return AEAgent._result(false, null, String(error) + (error && error.line ? " (line " + error.line + ")" : ""));
    }
};
