(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) { module.exports = api; }
  root.AEToolLibrary = api;
}(typeof window !== "undefined" ? window : this, function () {
  "use strict";
  var icons = { spark: "✦", text: "T", shape: "◇", motion: "↗", color: "◉", layers: "▤", code: "{ }", wrench: "⚒", duplicate: "⧉", align: "⇆", grid: "▦", camera: "◫", search: "⌕", folder: "□", trim: "⌁", split: "⑂", anchor: "⌖", effects: "ƒx", keyframe: "◆", export: "⇧", time: "◷", link: "↔", eye: "◉", batch: "▥" };
  var types = ["number", "text", "boolean", "color", "select"];
  function validKey(key) {
    return /^[a-zA-Z][a-zA-Z0-9_]{0,39}$/.test(key) && ["constructor", "prototype", "__proto__"].indexOf(key) === -1;
  }
  function normalize(source) {
    if (!source || typeof source !== "object") { throw new Error("A tool definition is required."); }
    var name = String(source.name || "").trim();
    var code = String(source.code || "").trim();
    if (!name || name.length > 60) { throw new Error("Tool names must have 1–60 characters."); }
    if (!code || code.length > 100000) { throw new Error("A tool needs a script of up to 100,000 characters."); }
    // Parse only. Never execute a saved script in the panel's Node-enabled context.
    new Function("options", code);
    var seen = {};
    var fields = source.options || [];
    if (!Array.isArray(fields) || fields.length > 16) { throw new Error("Use up to 16 tool options."); }
    fields = fields.map(function (field) {
      if (!validKey(field.key) || seen[field.key]) { throw new Error("Option keys must be unique simple identifiers."); }
      seen[field.key] = true;
      if (types.indexOf(field.type) === -1) { throw new Error("Unsupported option type: " + field.type); }
      var value = { key: field.key, label: String(field.label || field.key).slice(0, 80), type: field.type, defaultValue: field.defaultValue, help: String(field.help || "").slice(0, 240), group: String(field.group || "Options").slice(0, 60) };
      if (["constructor", "prototype", "__proto__"].indexOf(value.group) !== -1) { throw new Error("Choose a different option group name."); }
      if (field.type === "select") {
        if (!Array.isArray(field.choices) || !field.choices.length || field.choices.length > 30) { throw new Error("Dropdowns need 1–30 choices."); }
        value.choices = field.choices.map(function (choice) { return String(choice).slice(0, 120); });
      }
      ["min", "max", "step"].forEach(function (key) {
        if (field[key] !== undefined) {
          if (typeof field[key] !== "number" || !isFinite(field[key])) { throw new Error("Invalid numeric option constraint."); }
          value[key] = field[key];
        }
      });
      if (value.min !== undefined && value.max !== undefined && value.min > value.max) { throw new Error("Option minimum exceeds maximum."); }
      if (value.step !== undefined && value.step <= 0) { throw new Error("Option step must be positive."); }
      value.defaultValue = coerce(value, field.defaultValue);
      return value;
    });
    return {
      id: source.id && /^tool-[a-zA-Z0-9-]+$/.test(source.id) ? source.id : "tool-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10),
      name: name, description: String(source.description || "").slice(0, 600),
      icon: Object.prototype.hasOwnProperty.call(icons, source.icon) ? source.icon : "spark",
      color: /^#[0-9a-f]{6}$/i.test(source.color || "") ? source.color : "#10a37f",
      code: code, options: fields, actionLabel: String(source.actionLabel || "Run tool").slice(0, 50), updatedAt: new Date().toISOString()
    };
  }
  function coerce(field, value) {
    if (field.type === "number") {
      if (value === undefined) { value = field.min === undefined ? 0 : field.min; }
      if (value === "" || value === null || typeof value === "boolean") { throw new Error(field.label + " needs a number."); }
      value = Number(value);
      if (!isFinite(value) || (field.min !== undefined && value < field.min) || (field.max !== undefined && value > field.max)) {
        throw new Error(field.label + " is outside its allowed range.");
      }
      return value;
    }
    if (field.type === "boolean") { return value === true; }
    if (field.type === "color") {
      value = value === undefined ? "#ffffff" : String(value);
      if (!/^#[0-9a-f]{6}$/i.test(value)) { throw new Error(field.label + " needs a hex color."); }
      return value;
    }
    if (field.type === "select") {
      value = value === undefined ? field.choices[0] : String(value);
      if (field.choices.indexOf(value) === -1) { throw new Error("Choose a valid " + field.label + "."); }
      return value;
    }
    return String(value === undefined ? "" : value).slice(0, 4000);
  }
  function values(tool, input) {
    var output = {};
    tool.options.forEach(function (field) {
      output[field.key] = coerce(field, input && Object.prototype.hasOwnProperty.call(input, field.key) ? input[field.key] : field.defaultValue);
    });
    return output;
  }
  function script(tool, input) {
    var json = JSON.stringify(values(tool, input)).replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
    return "return (function(options) {\n" + tool.code + "\n})(" + json + ");";
  }
  function Store(adapter) { this.adapter = adapter; this.items = []; }
  Store.prototype.load = function () {
    var raw = this.adapter.read();
    if (!raw) { return this.items; }
    var data = JSON.parse(raw);
    if (data.version !== 1 || !Array.isArray(data.tools)) { throw new Error("The saved tool library has an unsupported format."); }
    this.items = data.tools.map(normalize);
    return this.items;
  };
  Store.prototype.commit = function (items) {
    this.adapter.write(JSON.stringify({ version: 1, tools: items }, null, 2));
    this.items = items;
  };
  Store.prototype.save = function (definition) {
    var tool = normalize(definition);
    var next = this.items.slice();
    var index = next.findIndex(function (item) { return item.id === tool.id; });
    if (index === -1) { next.push(tool); } else { next[index] = tool; }
    this.commit(next);
    return tool;
  };
  Store.prototype.remove = function (id) { this.commit(this.items.filter(function (tool) { return tool.id !== id; })); };
  Store.prototype.move = function (id, direction) {
    var next = this.items.slice();
    var index = next.findIndex(function (tool) { return tool.id === id; });
    var target = index + direction;
    if (index < 0 || target < 0 || target >= next.length) { return; }
    var item = next.splice(index, 1)[0]; next.splice(target, 0, item); this.commit(next);
  };
  Store.prototype.moveTo = function (id, targetId) {
    if (id === targetId) { return; }
    var next = this.items.slice();
    var from = next.findIndex(function (tool) { return tool.id === id; });
    var target = next.findIndex(function (tool) { return tool.id === targetId; });
    if (from < 0 || target < 0) { return; }
    var item = next.splice(from, 1)[0]; next.splice(target, 0, item); this.commit(next);
  };
  var optionSchema = {
    type: "object", properties: {
      key: { type: "string" }, label: { type: "string" }, type: { type: "string", enum: types },
      help: { type: "string", description: "Short hover explanation." }, group: { type: "string", description: "UI section heading." },
      defaultValue: { oneOf: [{ type: "string" }, { type: "number" }, { type: "boolean" }] },
      min: { type: "number" }, max: { type: "number" }, step: { type: "number" },
      choices: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 30 }
    }, required: ["key", "label", "type", "defaultValue"], additionalProperties: false
  };
  var namespace = { type: "namespace", name: "tool_library", description: "Create and maintain reusable local After Effects tools pinned to the panel dock.", tools: [
    { type: "function", name: "list_tools", description: "List saved tool metadata without script bodies.", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
    { type: "function", name: "get_tool", description: "Read one saved script and its option definitions before editing it.", inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"], additionalProperties: false } },
    { type: "function", name: "save_tool", description: "Save or update a reusable ExtendScript tool and pin it to the dock. Saving does not execute the script. Use options.key values through the options object in code. Existing id updates that tool; omit id for a new tool. Only available in Create tools mode.", inputSchema: {
      type: "object", properties: {
        id: { type: "string" }, name: { type: "string", minLength: 1, maxLength: 60 }, description: { type: "string" }, actionLabel: { type: "string" },
        icon: { type: "string", enum: Object.keys(icons) }, color: { type: "string", pattern: "^#[0-9a-fA-F]{6}$" },
        code: { type: "string", minLength: 1, description: "ES3-compatible ExtendScript function body. Receives options. Validate all targets before modifying them. No hardcoded project IDs; resolve targets at runtime. Return a small JSON-safe result. No file/network/process access, project save/close/export, dialogs, or nested Undo commands." },
        options: { type: "array", items: optionSchema, maxItems: 16 }
      }, required: ["name", "description", "icon", "color", "code", "options"], additionalProperties: false
    } }
  ] };
  namespace.tools.push({ type: "function", name: "preview_tool", description: "Show a non-executable UI draft to the user while planning or building. Does not save a tool or change After Effects. No script is needed.", inputSchema: {
    type: "object", properties: { name: { type: "string" }, description: { type: "string" }, actionLabel: { type: "string" }, options: { type: "array", items: optionSchema, maxItems: 16 } },
    required: ["name", "description", "options"], additionalProperties: false
  } });
  return { icons: icons, normalize: normalize, values: values, script: script, Store: Store, namespace: namespace };
}));
