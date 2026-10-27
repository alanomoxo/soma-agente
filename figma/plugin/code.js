// Soma Agente for Figma: tool implementations (plugin sandbox).
// The UI (ui.html) relays tool calls from the local Soma bridge to `run`.
figma.showUI(__html__, { width: 400, height: 640, themeColors: false, title: "Soma Agente" });

function hexToPaint(hex, opacity) {
  if (hex === "none" || hex === null) { return null; }
  var m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ""));
  if (!m) { throw new Error("Colors are hex like #E70E77."); }
  var n = parseInt(m[1], 16);
  var paint = { type: "SOLID", color: { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 } };
  if (opacity !== undefined) { paint.opacity = opacity; }
  return paint;
}

function paintToHex(paint) {
  if (!paint || paint.type !== "SOLID") { return paint ? paint.type : null; }
  function c(v) { var s = Math.round(v * 255).toString(16); return s.length < 2 ? "0" + s : s; }
  return "#" + c(paint.color.r) + c(paint.color.g) + c(paint.color.b);
}

function round(v) { return Math.round(v * 100) / 100; }

function node(id) {
  var found = figma.getNodeById(String(id));
  if (!found) { throw new Error("Node " + id + " not found. Use list_nodes for current ids."); }
  return found;
}

function parentFor(args) {
  if (args.parentId) { return node(args.parentId); }
  return figma.currentPage;
}

function summary(n, depth) {
  var info = { id: n.id, name: n.name, type: n.type };
  if ("x" in n) { info.x = round(n.x); info.y = round(n.y); }
  if ("width" in n) { info.width = round(n.width); info.height = round(n.height); }
  if ("visible" in n && !n.visible) { info.visible = false; }
  if ("rotation" in n && n.rotation) { info.rotation = round(n.rotation); }
  if ("opacity" in n && n.opacity !== 1) { info.opacity = round(n.opacity); }
  if ("fills" in n && Array.isArray(n.fills) && n.fills.length) { info.fills = n.fills.map(paintToHex); }
  if ("strokes" in n && Array.isArray(n.strokes) && n.strokes.length) { info.strokes = n.strokes.map(paintToHex); }
  if ("cornerRadius" in n && typeof n.cornerRadius === "number" && n.cornerRadius) { info.cornerRadius = n.cornerRadius; }
  if ("layoutMode" in n && n.layoutMode !== "NONE") {
    info.autoLayout = { direction: n.layoutMode, gap: n.itemSpacing, padding: [n.paddingTop, n.paddingRight, n.paddingBottom, n.paddingLeft] };
  }
  if (n.type === "TEXT") {
    info.text = n.characters.slice(0, 500);
    if (typeof n.fontSize === "number") { info.fontSize = n.fontSize; }
    if (n.fontName !== figma.mixed) { info.font = n.fontName.family + " " + n.fontName.style; }
  }
  if ("children" in n) {
    if (depth > 0) { info.children = n.children.slice(0, 200).map(function (c) { return summary(c, depth - 1); }); }
    else { info.childCount = n.children.length; }
  }
  return info;
}

async function loadFont(family, style) {
  var font = { family: family || "Inter", style: style || "Regular" };
  await figma.loadFontAsync(font);
  return font;
}

async function applyProps(n, args) {
  if (args.name !== undefined) { n.name = String(args.name); }
  if (args.x !== undefined) { n.x = Number(args.x); }
  if (args.y !== undefined) { n.y = Number(args.y); }
  if ((args.width !== undefined || args.height !== undefined) && "resize" in n) {
    n.resize(Math.max(0.01, Number(args.width !== undefined ? args.width : n.width)), Math.max(0.01, Number(args.height !== undefined ? args.height : n.height)));
  }
  if (args.rotation !== undefined && "rotation" in n) { n.rotation = Number(args.rotation); }
  if (args.opacity !== undefined && "opacity" in n) { n.opacity = Number(args.opacity); }
  if (args.visible !== undefined && "visible" in n) { n.visible = !!args.visible; }
  if (args.fill !== undefined && "fills" in n) { var f = hexToPaint(args.fill); n.fills = f ? [f] : []; }
  if (args.stroke !== undefined && "strokes" in n) { var s = hexToPaint(args.stroke); n.strokes = s ? [s] : []; }
  if (args.strokeWeight !== undefined && "strokeWeight" in n) { n.strokeWeight = Number(args.strokeWeight); }
  if (args.cornerRadius !== undefined && "cornerRadius" in n) { n.cornerRadius = Number(args.cornerRadius); }
  if (args.autoLayout && "layoutMode" in n) {
    var al = args.autoLayout;
    n.layoutMode = al.direction === "HORIZONTAL" ? "HORIZONTAL" : (al.direction === "NONE" ? "NONE" : "VERTICAL");
    if (al.gap !== undefined) { n.itemSpacing = Number(al.gap); }
    if (al.padding !== undefined) { var p = Number(al.padding); n.paddingTop = n.paddingRight = n.paddingBottom = n.paddingLeft = p; }
    if (al.align) { n.primaryAxisAlignItems = al.align; }
    if (al.crossAlign) { n.counterAxisAlignItems = al.crossAlign; }
    if (al.hug) { n.primaryAxisSizingMode = "AUTO"; n.counterAxisSizingMode = "AUTO"; }
  }
  if (n.type === "TEXT") {
    var needsFont = args.text !== undefined || args.fontSize !== undefined || args.fontFamily !== undefined || args.fontStyle !== undefined || args.color !== undefined || args.align !== undefined;
    if (needsFont) {
      var current = n.fontName === figma.mixed ? { family: "Inter", style: "Regular" } : n.fontName;
      var font = await loadFont(args.fontFamily || current.family, args.fontStyle || current.style);
      if (n.fontName === figma.mixed || args.fontFamily || args.fontStyle) { n.fontName = font; }
      if (args.text !== undefined) { n.characters = String(args.text); }
      if (args.fontSize !== undefined) { n.fontSize = Number(args.fontSize); }
      if (args.color !== undefined) { n.fills = [hexToPaint(args.color)]; }
      if (args.align !== undefined) { n.textAlignHorizontal = String(args.align).toUpperCase(); }
    }
  }
}

var tools = {
  get_document_info: async function () {
    var sel = figma.currentPage.selection.map(function (n) { return { id: n.id, name: n.name, type: n.type }; });
    return {
      file: figma.root.name,
      pages: figma.root.children.map(function (p) { return { id: p.id, name: p.name }; }),
      currentPage: { id: figma.currentPage.id, name: figma.currentPage.name },
      selection: sel,
      topLevel: figma.currentPage.children.slice(0, 100).map(function (n) { return summary(n, 0); })
    };
  },
  list_nodes: async function (args) {
    var root = args.id ? node(args.id) : figma.currentPage;
    return summary(root, args.depth === undefined ? 3 : Number(args.depth));
  },
  create_frame: async function (args) {
    var frame = figma.createFrame();
    parentFor(args).appendChild(frame);
    frame.resize(Number(args.width || 1080), Number(args.height || 1080));
    if (args.fill === undefined) { args.fill = "#FFFFFF"; }
    await applyProps(frame, args);
    return summary(frame, 0);
  },
  create_shape: async function (args) {
    var kind = String(args.shape || "rectangle");
    var n = kind === "ellipse" ? figma.createEllipse() : kind === "line" ? figma.createLine() : kind === "polygon" ? figma.createPolygon() : kind === "star" ? figma.createStar() : figma.createRectangle();
    parentFor(args).appendChild(n);
    if (kind === "polygon" && args.sides) { n.pointCount = Number(args.sides); }
    if (kind === "star" && args.points) { n.pointCount = Number(args.points); }
    if (kind === "line") {
      n.resize(Math.max(0.01, Number(args.width || 100)), 0);
      if (args.stroke === undefined) { args.stroke = "#000000"; }
      delete args.height;
    } else {
      n.resize(Number(args.width || 100), Number(args.height || 100));
      if (args.fill === undefined) { args.fill = "#E70E77"; }
    }
    await applyProps(n, args);
    return summary(n, 0);
  },
  create_text: async function (args) {
    var t = figma.createText();
    parentFor(args).appendChild(t);
    t.fontName = await loadFont(args.fontFamily, args.fontStyle);
    t.characters = String(args.text || "Text");
    t.fontSize = Number(args.fontSize || 24);
    t.fills = [hexToPaint(args.color || "#000000")];
    if (args.width) { t.textAutoResize = "HEIGHT"; t.resize(Number(args.width), t.height); }
    var rest = Object.assign({}, args);
    delete rest.text; delete rest.fontFamily; delete rest.fontStyle; delete rest.fontSize; delete rest.color; delete rest.width;
    await applyProps(t, rest);
    if (args.align) { t.textAlignHorizontal = String(args.align).toUpperCase(); }
    return summary(t, 0);
  },
  set_properties: async function (args) {
    var n = node(args.id);
    await applyProps(n, args);
    return summary(n, 1);
  },
  delete_nodes: async function (args) {
    var removed = [];
    (args.ids || []).forEach(function (id) { var n = node(id); removed.push({ id: n.id, name: n.name }); n.remove(); });
    return { removed: removed };
  },
  duplicate_node: async function (args) {
    var n = node(args.id);
    var copy = n.clone();
    if (args.dx) { copy.x = n.x + Number(args.dx); }
    if (args.dy) { copy.y = n.y + Number(args.dy); }
    if (args.name) { copy.name = String(args.name); }
    return summary(copy, 0);
  },
  group_nodes: async function (args) {
    var nodes = (args.ids || []).map(node);
    if (!nodes.length) { throw new Error("Pass the ids to group."); }
    var group = figma.group(nodes, nodes[0].parent);
    if (args.name) { group.name = String(args.name); }
    return summary(group, 1);
  },
  move_to_parent: async function (args) {
    var n = node(args.id);
    var parent = node(args.parentId);
    if (args.index !== undefined) { parent.insertChild(Number(args.index), n); } else { parent.appendChild(n); }
    return summary(n, 0);
  },
  place_image: async function (args) {
    if (!args.imageBase64) { throw new Error("Pass the path of an image file."); }
    var image = figma.createImage(figma.base64Decode(args.imageBase64));
    var size = await image.getSizeAsync();
    var rect = figma.createRectangle();
    parentFor(args).appendChild(rect);
    var w = Number(args.width || size.width);
    var h = Number(args.height || (w / size.width * size.height));
    rect.resize(w, h);
    rect.fills = [{ type: "IMAGE", imageHash: image.hash, scaleMode: args.scaleMode || "FILL" }];
    rect.name = args.name || "Image";
    if (args.x !== undefined) { rect.x = Number(args.x); }
    if (args.y !== undefined) { rect.y = Number(args.y); }
    return summary(rect, 0);
  },
  select_and_zoom: async function (args) {
    var nodes = (args.ids || []).map(node);
    figma.currentPage.selection = nodes;
    if (nodes.length) { figma.viewport.scrollAndZoomIntoView(nodes); }
    return { selected: nodes.length };
  },
  export_preview: async function (args) {
    var target = args.id ? node(args.id) : (figma.currentPage.selection[0] || figma.currentPage.children[0]);
    if (!target || !("exportAsync" in target)) { throw new Error("Nothing to export; pass a frame id."); }
    var longest = Math.max(target.width, target.height) || 1;
    var scale = Math.min(4, Math.max(0.05, Number(args.maxSize || 1400) / longest));
    var bytes = await target.exportAsync({ format: "PNG", constraint: { type: "SCALE", value: scale } });
    return { __png: figma.base64Encode(bytes), node: target.name, scale: round(scale) };
  },
  run_plugin_code: async function (args) {
    var fn = new Function("figma", "return (async function () {\n" + String(args.code || "") + "\n})();");
    var result = await fn(figma);
    return result === undefined ? { executed: true } : JSON.parse(JSON.stringify(result));
  }
};

var mutating = { create_frame: 1, create_shape: 1, create_text: 1, set_properties: 1, delete_nodes: 1, duplicate_node: 1, group_nodes: 1, move_to_parent: 1, place_image: 1, run_plugin_code: 1 };

async function run(call) {
  try {
    var fn = tools[call.name];
    if (!fn) { throw new Error("Unknown tool " + call.name); }
    var data = await fn(call.args || {});
    if (mutating[call.name]) { figma.commitUndo(); }
    var result = { ok: true, data: data };
    if (data && data.__png) { result.pngBase64 = data.__png; delete data.__png; }
    return result;
  } catch (error) {
    return { ok: false, error: String(error && error.message || error) };
  }
}

figma.ui.onmessage = async function (msg) {
  if (msg && msg.type === "tool") {
    var result = await run(msg.call);
    figma.ui.postMessage({ type: "tool-result", id: msg.call.id, result: result });
  } else if (msg && msg.type === "notify") {
    figma.notify(String(msg.text || ""));
  }
};
