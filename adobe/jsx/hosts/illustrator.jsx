/* Soma Agente bridge for Illustrator 2025+ (CEP).
   Coordinates for the agent are points measured from the top-left of the
   active artboard, y pointing down; they are converted to Illustrator's
   document coordinates (y up) here. Items are addressed by their uuid. */
$.evalFile(new File(new File($.fileName).parent.fsName + "/_common.jsx"));
AEAgent.host = "illustrator";
AEAgent.hostName = "Illustrator";

AEAgent._mutating = {
    create_document: false, create_shape: true, create_text: true, set_item_properties: true, group_items: true,
    ungroup_item: true, delete_items: true, duplicate_item: true, arrange_item: true, place_image: true,
    add_artboard: true, execute_script: true
};

AEAgent._around = function (run) {
    var system = app.coordinateSystem;
    var level = app.userInteractionLevel;
    app.coordinateSystem = CoordinateSystem.DOCUMENTCOORDINATESYSTEM;
    app.userInteractionLevel = UserInteractionLevel.DONTDISPLAYALERTS;
    try { return run(); } finally {
        app.coordinateSystem = system;
        app.userInteractionLevel = level;
    }
};

AEAgent._wrapMutation = function (tool, fn) {
    var data = fn();
    try { app.redraw(); } catch (e) { /* no document */ }
    return { data: data, undoable: app.documents.length > 0 };
};

AEAgent._doc = function () {
    if (!app.documents.length) { throw new Error("No Illustrator document is open. Create one with create_document or open a file."); }
    return app.activeDocument;
};

AEAgent._artboard = function (doc, index) {
    var i = index === undefined ? doc.artboards.getActiveArtboardIndex() : Number(index);
    if (i < 0 || i >= doc.artboards.length) { throw new Error("Artboard " + index + " does not exist."); }
    var r = doc.artboards[i].artboardRect;
    return { index: i, left: r[0], top: r[1], width: r[2] - r[0], height: r[1] - r[3], name: doc.artboards[i].name };
};

/* Agent (artboard, y down) <-> document (y up). */
AEAgent._toDoc = function (doc, x, y) { var a = AEAgent._artboard(doc); return [a.left + Number(x), a.top - Number(y)]; };
AEAgent._box = function (doc, bounds) {
    var a = AEAgent._artboard(doc);
    return { x: AEAgent._round(bounds[0] - a.left), y: AEAgent._round(a.top - bounds[1]), width: AEAgent._round(bounds[2] - bounds[0]), height: AEAgent._round(bounds[1] - bounds[3]) };
};

AEAgent._color = function (doc, hex) {
    if (hex === null || hex === "none") { return new NoColor(); }
    var c = AEAgent._rgb(hex);
    if (doc.documentColorSpace === DocumentColorSpace.CMYK) {
        var k = 1 - Math.max(c.r, c.g, c.b) / 255;
        var cmyk = new CMYKColor();
        if (k >= 1) { cmyk.black = 100; return cmyk; }
        cmyk.cyan = (1 - c.r / 255 - k) / (1 - k) * 100;
        cmyk.magenta = (1 - c.g / 255 - k) / (1 - k) * 100;
        cmyk.yellow = (1 - c.b / 255 - k) / (1 - k) * 100;
        cmyk.black = k * 100;
        return cmyk;
    }
    var rgb = new RGBColor();
    rgb.red = c.r; rgb.green = c.g; rgb.blue = c.b;
    return rgb;
};

AEAgent._colorHex = function (color) {
    try {
        if (color.typename === "RGBColor") { return AEAgent._hex(color.red, color.green, color.blue); }
        if (color.typename === "CMYKColor") {
            var k = color.black / 100;
            return AEAgent._hex(255 * (1 - color.cyan / 100) * (1 - k), 255 * (1 - color.magenta / 100) * (1 - k), 255 * (1 - color.yellow / 100) * (1 - k));
        }
        if (color.typename === "GrayColor") { var g = 255 * (1 - color.gray / 100); return AEAgent._hex(g, g, g); }
        if (color.typename === "NoColor") { return "none"; }
        return color.typename;
    } catch (e) { return null; }
};

AEAgent._itemInfo = function (doc, item, depth) {
    var info = { uuid: item.uuid, type: item.typename, name: item.name || null };
    try { info.bounds = AEAgent._box(doc, item.visibleBounds); } catch (e) { /* empty group */ }
    try { if (item.hidden) { info.hidden = true; } if (item.locked) { info.locked = true; } } catch (e2) { /* n/a */ }
    try { if (item.opacity !== 100) { info.opacity = AEAgent._round(item.opacity, 1); } } catch (e3) { /* n/a */ }
    if (item.typename === "PathItem") {
        info.fill = item.filled ? AEAgent._colorHex(item.fillColor) : "none";
        info.stroke = item.stroked ? AEAgent._colorHex(item.strokeColor) : "none";
        if (item.stroked) { info.strokeWidth = AEAgent._round(item.strokeWidth); }
    } else if (item.typename === "TextFrame") {
        info.text = item.contents;
        try {
            var attrs = item.textRange.characterAttributes;
            info.fontSize = AEAgent._round(attrs.size);
            info.font = attrs.textFont.name;
            info.color = AEAgent._colorHex(attrs.fillColor);
        } catch (e4) { /* mixed */ }
    } else if (item.typename === "GroupItem") {
        if (depth > 0) {
            info.children = [];
            for (var i = 0; i < item.pageItems.length; i += 1) { info.children.push(AEAgent._itemInfo(doc, item.pageItems[i], depth - 1)); }
        } else {
            info.childCount = item.pageItems.length;
        }
    }
    try { info.layer = item.layer.name; } catch (e5) { /* n/a */ }
    return info;
};

AEAgent._item = function (doc, uuid) {
    var item = null;
    try { item = doc.getPageItemFromUuid(String(uuid)); } catch (e) { item = null; }
    if (!item) { throw new Error("Item " + uuid + " was not found. Use list_items to get current uuids."); }
    return item;
};

AEAgent._targetLayer = function (doc, name) {
    if (!name) { return doc.activeLayer; }
    try { return doc.layers.getByName(String(name)); } catch (e) {
        var layer = doc.layers.add();
        layer.name = String(name);
        return layer;
    }
};

AEAgent._finishItem = function (doc, item, args) {
    if (args.name) { item.name = String(args.name); }
    if (args.fill !== undefined && item.typename === "PathItem") {
        if (args.fill === "none" || args.fill === null) { item.filled = false; } else { item.filled = true; item.fillColor = AEAgent._color(doc, args.fill); }
    }
    if (args.stroke !== undefined && item.typename === "PathItem") {
        if (args.stroke === "none" || args.stroke === null) { item.stroked = false; } else { item.stroked = true; item.strokeColor = AEAgent._color(doc, args.stroke); }
    }
    if (args.strokeWidth !== undefined && item.typename === "PathItem") { item.stroked = true; item.strokeWidth = Number(args.strokeWidth); }
    if (args.opacity !== undefined) { item.opacity = Number(args.opacity); }
    return AEAgent._itemInfo(doc, item, 1);
};

AEAgent.document_overview = function () {
    var open = [];
    for (var d = 0; d < app.documents.length; d += 1) { open.push(app.documents[d].name); }
    if (!app.documents.length) { return { openDocuments: open, active: null }; }
    var doc = app.activeDocument;
    var artboards = [];
    for (var i = 0; i < doc.artboards.length; i += 1) {
        var r = doc.artboards[i].artboardRect;
        artboards.push({ index: i, name: doc.artboards[i].name, width: AEAgent._round(r[2] - r[0]), height: AEAgent._round(r[1] - r[3]) });
    }
    var layers = [];
    for (var l = 0; l < doc.layers.length; l += 1) {
        layers.push({ name: doc.layers[l].name, visible: doc.layers[l].visible, locked: doc.layers[l].locked, items: doc.layers[l].pageItems.length });
    }
    var selection = [];
    var sel = doc.selection;
    if (sel && sel.length) { for (var s = 0; s < sel.length && s < 30; s += 1) { try { selection.push({ uuid: sel[s].uuid, type: sel[s].typename, name: sel[s].name || null }); } catch (e) { /* text range */ } } }
    return {
        openDocuments: open,
        active: {
            name: doc.name,
            colorSpace: doc.documentColorSpace === DocumentColorSpace.CMYK ? "CMYK" : "RGB",
            units: "points (1 pt = 1 px at 72 ppi)",
            artboards: artboards,
            activeArtboard: doc.artboards.getActiveArtboardIndex(),
            layers: layers,
            selection: selection,
            totalItems: doc.pageItems.length,
            saved: doc.saved
        }
    };
};

AEAgent.list_items = function (args) {
    var doc = AEAgent._doc();
    var depth = args.maxDepth === undefined ? 3 : Number(args.maxDepth);
    var limit = Number(args.limit || 300);
    var out = [];
    for (var l = 0; l < doc.layers.length && out.length < limit; l += 1) {
        var layer = doc.layers[l];
        if (args.layer && layer.name !== args.layer) { continue; }
        for (var i = 0; i < layer.pageItems.length && out.length < limit; i += 1) {
            out.push(AEAgent._itemInfo(doc, layer.pageItems[i], depth));
        }
    }
    return { document: doc.name, artboard: AEAgent._artboard(doc), order: "front to back within each layer", items: out, truncated: out.length >= limit };
};

AEAgent.create_document = function (args) {
    var space = String(args.colorSpace || "RGB").toUpperCase() === "CMYK" ? DocumentColorSpace.CMYK : DocumentColorSpace.RGB;
    var doc = app.documents.add(space, Number(args.width || 1920), Number(args.height || 1080));
    if (args.name) { try { doc.artboards[0].name = String(args.name); } catch (e) { /* keep default */ } }
    return { name: doc.name, artboard: AEAgent._artboard(doc, 0) };
};

AEAgent.add_artboard = function (args) {
    var doc = AEAgent._doc();
    var last = doc.artboards[doc.artboards.length - 1].artboardRect;
    var w = Number(args.width || (last[2] - last[0])), h = Number(args.height || (last[1] - last[3]));
    var left = last[2] + Number(args.gap === undefined ? 40 : args.gap);
    var board = doc.artboards.add([left, last[1], left + w, last[1] - h]);
    if (args.name) { board.name = String(args.name); }
    doc.artboards.setActiveArtboardIndex(doc.artboards.length - 1);
    return AEAgent._artboard(doc);
};

AEAgent.create_shape = function (args) {
    var doc = AEAgent._doc();
    var layer = AEAgent._targetLayer(doc, args.layer);
    var x = Number(args.x || 0), y = Number(args.y || 0);
    var w = args.width === undefined ? 100 : Number(args.width), h = args.height === undefined ? 100 : Number(args.height);
    var p = AEAgent._toDoc(doc, x, y);
    var shape = String(args.shape || "rectangle");
    var item;
    if (shape === "rectangle") {
        item = args.cornerRadius ? layer.pathItems.roundedRectangle(p[1], p[0], w, h, Number(args.cornerRadius), Number(args.cornerRadius)) : layer.pathItems.rectangle(p[1], p[0], w, h);
    } else if (shape === "ellipse") {
        item = layer.pathItems.ellipse(p[1], p[0], w, h);
    } else if (shape === "polygon") {
        item = layer.pathItems.polygon(p[0] + w / 2, p[1] - h / 2, Math.min(w, h) / 2, Number(args.sides || 6));
    } else if (shape === "star") {
        item = layer.pathItems.star(p[0] + w / 2, p[1] - h / 2, Math.min(w, h) / 2, Math.min(w, h) / 2 * Number(args.innerRatio || 0.5), Number(args.points || 5));
    } else if (shape === "line") {
        item = layer.pathItems.add();
        var end = AEAgent._toDoc(doc, x + w, y + h);
        item.setEntirePath([p, end]);
        if (args.stroke === undefined) { args.stroke = "#000000"; }
        if (args.fill === undefined) { args.fill = "none"; }
    } else {
        throw new Error("Unknown shape " + shape + ". Use rectangle, ellipse, polygon, star or line.");
    }
    if (args.fill === undefined) { args.fill = "#E70E77"; }
    if (args.stroke === undefined) { args.stroke = "none"; }
    return AEAgent._finishItem(doc, item, args);
};

AEAgent.create_text = function (args) {
    var doc = AEAgent._doc();
    var layer = AEAgent._targetLayer(doc, args.layer);
    var p = AEAgent._toDoc(doc, args.x || 0, args.y || 0);
    var frame;
    if (args.width) {
        var rect = layer.pathItems.rectangle(p[1], p[0], Number(args.width), Number(args.height || Number(args.size || 24) * 6));
        frame = layer.textFrames.areaText(rect);
    } else {
        frame = layer.textFrames.add();
    }
    frame.contents = String(args.text || "Text");
    var attrs = frame.textRange.characterAttributes;
    attrs.size = Number(args.size || 24);
    if (args.font) { attrs.textFont = app.textFonts.getByName(String(args.font)); }
    attrs.fillColor = AEAgent._color(doc, args.color || "#000000");
    var aligns = { left: Justification.LEFT, center: Justification.CENTER, right: Justification.RIGHT };
    if (args.align && aligns[args.align]) { frame.textRange.paragraphAttributes.justification = aligns[args.align]; }
    if (!args.width) {
        // Point text: put the top-left of its visible bounds at x/y.
        var b = frame.visibleBounds;
        frame.translate(p[0] - b[0], p[1] - b[1]);
    }
    if (args.name) { frame.name = String(args.name); }
    return AEAgent._itemInfo(doc, frame, 0);
};

AEAgent.set_item_properties = function (args) {
    var doc = AEAgent._doc();
    var item = AEAgent._item(doc, args.uuid);
    if (args.rotate) { item.rotate(Number(args.rotate)); }
    if (args.width !== undefined || args.height !== undefined || args.scale !== undefined) {
        var vb = item.visibleBounds;
        var cw = vb[2] - vb[0], ch = vb[1] - vb[3];
        var sx = args.scale !== undefined ? Number(args.scale) : (args.width !== undefined ? Number(args.width) / cw * 100 : null);
        var sy = args.scale !== undefined ? Number(args.scale) : (args.height !== undefined ? Number(args.height) / ch * 100 : null);
        if (sx === null) { sx = sy; }
        if (sy === null) { sy = sx; }
        item.resize(sx, sy, true, true, true, true, args.scaleStrokes === false ? 100 : (sx + sy) / 2, Transformation.CENTER);
    }
    if (args.x !== undefined || args.y !== undefined) {
        var box = AEAgent._box(doc, item.visibleBounds);
        var target = AEAgent._toDoc(doc, args.x === undefined ? box.x : args.x, args.y === undefined ? box.y : args.y);
        var cur = item.visibleBounds;
        item.translate(target[0] - cur[0], target[1] - cur[1]);
    }
    if (args.dx !== undefined || args.dy !== undefined) { item.translate(Number(args.dx || 0), -Number(args.dy || 0)); }
    if (args.hidden !== undefined) { item.hidden = !!args.hidden; }
    if (args.locked !== undefined) { item.locked = !!args.locked; }
    if (item.typename === "TextFrame") {
        if (args.text !== undefined) { item.contents = String(args.text); }
        var attrs = item.textRange.characterAttributes;
        if (args.fontSize !== undefined) { attrs.size = Number(args.fontSize); }
        if (args.font !== undefined) { attrs.textFont = app.textFonts.getByName(String(args.font)); }
        if (args.color !== undefined) { attrs.fillColor = AEAgent._color(doc, args.color); }
        if (args.tracking !== undefined) { attrs.tracking = Number(args.tracking); }
    }
    return AEAgent._finishItem(doc, item, args);
};

AEAgent.group_items = function (args) {
    var doc = AEAgent._doc();
    var uuids = args.uuids || [];
    if (!uuids.length) { throw new Error("Pass the uuids to group."); }
    var first = AEAgent._item(doc, uuids[0]);
    var group = first.parent.groupItems.add();
    group.move(first, ElementPlacement.PLACEBEFORE);
    for (var i = uuids.length - 1; i >= 0; i -= 1) { AEAgent._item(doc, uuids[i]).move(group, ElementPlacement.PLACEATEND); }
    if (args.name) { group.name = String(args.name); }
    return AEAgent._itemInfo(doc, group, 1);
};

AEAgent.ungroup_item = function (args) {
    var doc = AEAgent._doc();
    var group = AEAgent._item(doc, args.uuid);
    if (group.typename !== "GroupItem") { throw new Error("Item " + args.uuid + " is not a group."); }
    var released = [];
    while (group.pageItems.length) {
        var child = group.pageItems[0];
        child.move(group, ElementPlacement.PLACEBEFORE);
        released.push(child.uuid);
    }
    group.remove();
    return { released: released };
};

AEAgent.delete_items = function (args) {
    var doc = AEAgent._doc();
    var removed = [];
    var uuids = args.uuids || [];
    for (var i = 0; i < uuids.length; i += 1) {
        var item = AEAgent._item(doc, uuids[i]);
        removed.push({ uuid: uuids[i], type: item.typename, name: item.name || null });
        item.remove();
    }
    return { removed: removed };
};

AEAgent.duplicate_item = function (args) {
    var doc = AEAgent._doc();
    var item = AEAgent._item(doc, args.uuid);
    var copy = item.duplicate();
    if (args.dx !== undefined || args.dy !== undefined) { copy.translate(Number(args.dx || 0), -Number(args.dy || 0)); }
    if (args.name) { copy.name = String(args.name); }
    return AEAgent._itemInfo(doc, copy, 1);
};

AEAgent.arrange_item = function (args) {
    var doc = AEAgent._doc();
    var item = AEAgent._item(doc, args.uuid);
    var orders = { front: ZOrderMethod.BRINGTOFRONT, back: ZOrderMethod.SENDTOBACK, forward: ZOrderMethod.BRINGFORWARD, backward: ZOrderMethod.SENDBACKWARD };
    item.zOrder(orders[args.order] || ZOrderMethod.BRINGTOFRONT);
    return AEAgent._itemInfo(doc, item, 0);
};

AEAgent.place_image = function (args) {
    var doc = AEAgent._doc();
    var file = new File(String(args.path || ""));
    if (!file.exists) { throw new Error("File not found: " + args.path); }
    var layer = AEAgent._targetLayer(doc, args.layer);
    var placed = layer.placedItems.add();
    placed.file = file;
    var item = placed;
    if (args.embed !== false) { placed.embed(); item = doc.selection && doc.selection.length ? doc.selection[0] : layer.pageItems[0]; }
    if (args.width !== undefined) {
        var vb = item.visibleBounds;
        var s = Number(args.width) / (vb[2] - vb[0]) * 100;
        item.resize(s, s);
    }
    var b = item.visibleBounds;
    var target = AEAgent._toDoc(doc, args.x || 0, args.y || 0);
    item.translate(target[0] - b[0], target[1] - b[1]);
    if (args.name) { item.name = String(args.name); }
    return AEAgent._itemInfo(doc, item, 0);
};

/* Exports the artboard as PNG so the agent can look at the result. */
AEAgent.preview_artboard = function (args) {
    var doc = AEAgent._doc();
    var previous = doc.artboards.getActiveArtboardIndex();
    var index = args.artboard === undefined ? previous : Number(args.artboard);
    doc.artboards.setActiveArtboardIndex(index);
    var a = AEAgent._artboard(doc, index);
    var max = Number(args.maxSize || 1568);
    var scale = Math.min(400, Math.max(10, max / Math.max(a.width, a.height) * 100));
    var options = new ExportOptionsPNG24();
    options.artBoardClipping = true;
    options.antiAliasing = true;
    options.transparency = false;
    options.horizontalScale = scale;
    options.verticalScale = scale;
    var file = AEAgent._tempFile(".png");
    doc.exportFile(file, ExportType.PNG24, options);
    doc.artboards.setActiveArtboardIndex(previous);
    return { frames: [{ path: file.fsName, time: 0, frame: index }], artboard: a.name, scalePercent: AEAgent._round(scale), reason: args.reason || null };
};

AEAgent.undo_last_action = function () {
    AEAgent._doc();
    app.undo();
    app.redraw();
    return { reverted: true, note: "Illustrator undoes one step at a time; call again if the previous tool made several changes." };
};
