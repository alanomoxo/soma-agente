/* Soma Agente bridge for Photoshop 2025+ (CEP). Positions and sizes are pixels. */
$.evalFile(new File(new File($.fileName).parent.fsName + "/_common.jsx"));
AEAgent.host = "photoshop";
AEAgent.hostName = "Photoshop";

AEAgent._mutating = {
    create_text_layer: true, create_shape_layer: true, set_layer_properties: true, transform_layer: true,
    set_text: true, duplicate_layer: true, delete_layers: true, arrange_layer: true, group_layers: true,
    place_image: true, fill_layer: true, add_adjustment_layer: true, execute_script: true, resize_document: true
};

/* Every tool works in pixels; the user's unit preferences are restored after. */
AEAgent._around = function (run) {
    var ruler = app.preferences.rulerUnits;
    var type = app.preferences.typeUnits;
    var dialogs = app.displayDialogs;
    app.preferences.rulerUnits = Units.PIXELS;
    app.preferences.typeUnits = TypeUnits.PIXELS;
    app.displayDialogs = DialogModes.NO;
    try { return run(); } finally {
        app.preferences.rulerUnits = ruler;
        app.preferences.typeUnits = type;
        app.displayDialogs = dialogs;
    }
};

/* One History state per tool, named after it, so Undo reverts the whole tool. */
AEAgent._pending = null;
AEAgent._runPending = function () {
    var job = AEAgent._pending;
    try { job.data = job.fn(); } catch (error) { job.error = error; }
};
AEAgent._wrapMutation = function (tool, fn) {
    if (!app.documents.length) { return { data: fn(), undoable: false }; }
    var doc = app.activeDocument;
    var before = doc.historyStates.length;
    AEAgent._pending = { fn: fn, data: null, error: null };
    doc.suspendHistory("Soma: " + tool.replace(/_/g, " "), "AEAgent._runPending()");
    var job = AEAgent._pending;
    AEAgent._pending = null;
    if (job.error) { throw job.error; }
    var undoable = false;
    try { undoable = app.activeDocument === doc && doc.historyStates.length !== before; } catch (e) { undoable = false; }
    return { data: job.data, undoable: undoable };
};

AEAgent._doc = function () {
    if (!app.documents.length) { throw new Error("No Photoshop document is open. Create one with create_document or open a file."); }
    return app.activeDocument;
};

AEAgent._px = function (value) {
    try { return AEAgent._round(value.as("px"), 1); } catch (e) { return AEAgent._round(Number(value), 1); }
};

AEAgent._color = function (hex) {
    var c = AEAgent._rgb(hex);
    var color = new SolidColor();
    color.rgb.red = c.r; color.rgb.green = c.g; color.rgb.blue = c.b;
    return color;
};

AEAgent._enumName = function (value) { return String(value).replace(/^[A-Za-z]+\./, ""); };

AEAgent._bounds = function (layer) {
    var b = layer.bounds;
    var l = AEAgent._px(b[0]), t = AEAgent._px(b[1]), r = AEAgent._px(b[2]), btm = AEAgent._px(b[3]);
    return { x: l, y: t, width: AEAgent._round(r - l, 1), height: AEAgent._round(btm - t, 1) };
};

AEAgent._layerInfo = function (layer, depth) {
    var info = { id: layer.id, name: layer.name, visible: layer.visible, opacity: AEAgent._round(layer.opacity, 1) };
    var isGroup = layer.typename === "LayerSet";
    info.kind = isGroup ? "group" : AEAgent._enumName(layer.kind);
    try { info.blendMode = AEAgent._enumName(layer.blendMode); } catch (e) { /* not available */ }
    try { info.bounds = AEAgent._bounds(layer); } catch (e2) { /* empty layer */ }
    try { if (layer.allLocked) { info.locked = true; } } catch (e3) { /* background */ }
    if (!isGroup) {
        try { if (layer.isBackgroundLayer) { info.background = true; } } catch (e4) { /* n/a */ }
        if (layer.kind === LayerKind.TEXT) {
            var t = layer.textItem;
            info.text = { contents: t.contents };
            try { info.text.size = AEAgent._px(t.size); } catch (e5) { /* mixed */ }
            try { info.text.font = t.font; } catch (e6) { /* mixed */ }
            try { info.text.color = "#" + t.color.rgb.hexValue; } catch (e7) { /* mixed */ }
        }
    } else if (depth > 0) {
        info.children = [];
        for (var i = 0; i < layer.layers.length; i += 1) { info.children.push(AEAgent._layerInfo(layer.layers[i], depth - 1)); }
    } else {
        info.childCount = layer.layers.length;
    }
    return info;
};

AEAgent._findLayer = function (args, container) {
    var doc = AEAgent._doc();
    var scope = container || doc;
    for (var i = 0; i < scope.layers.length; i += 1) {
        var layer = scope.layers[i];
        if ((args.layerId !== undefined && layer.id === Number(args.layerId)) || (args.layerId === undefined && args.layerName !== undefined && layer.name === String(args.layerName))) {
            return layer;
        }
        if (layer.typename === "LayerSet") {
            var found = AEAgent._findLayerOrNull(args, layer);
            if (found) { return found; }
        }
    }
    if (container) { return null; }
    throw new Error("Layer not found: " + (args.layerId !== undefined ? "id " + args.layerId : "“" + args.layerName + "”") + ". Use list_layers to get current ids.");
};
AEAgent._findLayerOrNull = function (args, container) { return AEAgent._findLayer(args, container); };

AEAgent._targetLayer = function (args) {
    if (args.layerId === undefined && args.layerName === undefined) { return AEAgent._doc().activeLayer; }
    return AEAgent._findLayer(args);
};

AEAgent.document_overview = function () {
    var open = [];
    for (var i = 0; i < app.documents.length; i += 1) { open.push(app.documents[i].name); }
    if (!app.documents.length) { return { openDocuments: open, active: null }; }
    var doc = app.activeDocument;
    var active = {
        name: doc.name,
        width: AEAgent._px(doc.width),
        height: AEAgent._px(doc.height),
        resolution: doc.resolution,
        mode: AEAgent._enumName(doc.mode),
        bitsPerChannel: AEAgent._enumName(doc.bitsPerChannel),
        topLevelLayers: doc.layers.length,
        saved: doc.saved
    };
    try { active.path = doc.fullName.fsName; } catch (e) { active.path = null; }
    try { active.activeLayer = { id: doc.activeLayer.id, name: doc.activeLayer.name }; } catch (e2) { /* none */ }
    return { openDocuments: open, active: active };
};

AEAgent.list_layers = function (args) {
    var doc = AEAgent._doc();
    var depth = args.maxDepth === undefined ? 4 : Number(args.maxDepth);
    var layers = [];
    for (var i = 0; i < doc.layers.length; i += 1) { layers.push(AEAgent._layerInfo(doc.layers[i], depth)); }
    return { document: doc.name, order: "top to bottom", layers: layers };
};

AEAgent.create_document = function (args) {
    var fills = { white: DocumentFill.WHITE, transparent: DocumentFill.TRANSPARENT, background: DocumentFill.BACKGROUNDCOLOR };
    var doc = app.documents.add(Number(args.width || 1920), Number(args.height || 1080), Number(args.resolution || 72),
        String(args.name || "Soma"), NewDocumentMode.RGB, fills[args.fill || "white"] || DocumentFill.WHITE);
    return { name: doc.name, width: AEAgent._px(doc.width), height: AEAgent._px(doc.height) };
};

AEAgent.create_text_layer = function (args) {
    var doc = AEAgent._doc();
    var layer = doc.artLayers.add();
    layer.kind = LayerKind.TEXT;
    var t = layer.textItem;
    if (args.boxWidth) {
        t.kind = TextType.PARAGRAPHTEXT;
        t.width = Number(args.boxWidth);
        t.height = Number(args.boxHeight || Number(args.size || 48) * 4);
    }
    t.contents = String(args.text || "Text");
    t.size = Number(args.size || 48);
    if (args.font) { t.font = String(args.font); }
    t.color = AEAgent._color(args.color || "#000000");
    var justify = { left: Justification.LEFT, center: Justification.CENTER, right: Justification.RIGHT };
    if (args.align && justify[args.align]) { t.justification = justify[args.align]; }
    t.position = [Number(args.x === undefined ? AEAgent._px(doc.width) / 2 : args.x), Number(args.y === undefined ? AEAgent._px(doc.height) / 2 : args.y)];
    if (args.name) { layer.name = String(args.name); }
    return AEAgent._layerInfo(layer, 0);
};

AEAgent.create_shape_layer = function (args) {
    var doc = AEAgent._doc();
    var x = Number(args.x || 0), y = Number(args.y || 0), w = Number(args.width || 100), h = Number(args.height || 100);
    var c = AEAgent._rgb(args.color || "#E70E77");
    var desc = new ActionDescriptor();
    var ref = new ActionReference();
    ref.putClass(stringIDToTypeID("contentLayer"));
    desc.putReference(charIDToTypeID("null"), ref);
    var layerDesc = new ActionDescriptor();
    var fill = new ActionDescriptor();
    var rgb = new ActionDescriptor();
    rgb.putDouble(charIDToTypeID("Rd  "), c.r);
    rgb.putDouble(charIDToTypeID("Grn "), c.g);
    rgb.putDouble(charIDToTypeID("Bl  "), c.b);
    fill.putObject(charIDToTypeID("Clr "), charIDToTypeID("RGBC"), rgb);
    layerDesc.putObject(charIDToTypeID("Type"), stringIDToTypeID("solidColorLayer"), fill);
    var shape = new ActionDescriptor();
    shape.putUnitDouble(charIDToTypeID("Top "), charIDToTypeID("#Pxl"), y);
    shape.putUnitDouble(charIDToTypeID("Left"), charIDToTypeID("#Pxl"), x);
    shape.putUnitDouble(charIDToTypeID("Btom"), charIDToTypeID("#Pxl"), y + h);
    shape.putUnitDouble(charIDToTypeID("Rght"), charIDToTypeID("#Pxl"), x + w);
    if (args.shape !== "ellipse" && args.cornerRadius) {
        shape.putUnitDouble(charIDToTypeID("Rds "), charIDToTypeID("#Pxl"), Number(args.cornerRadius));
    }
    layerDesc.putObject(charIDToTypeID("Shp "), args.shape === "ellipse" ? charIDToTypeID("Elps") : charIDToTypeID("Rctn"), shape);
    desc.putObject(charIDToTypeID("Usng"), stringIDToTypeID("contentLayer"), layerDesc);
    executeAction(charIDToTypeID("Mk  "), desc, DialogModes.NO);
    var layer = doc.activeLayer;
    if (args.name) { layer.name = String(args.name); }
    return AEAgent._layerInfo(layer, 0);
};

AEAgent.set_layer_properties = function (args) {
    var layer = AEAgent._targetLayer(args);
    if (args.newName !== undefined) { layer.name = String(args.newName); }
    if (args.visible !== undefined) { layer.visible = !!args.visible; }
    if (args.opacity !== undefined) { layer.opacity = Number(args.opacity); }
    if (args.fillOpacity !== undefined) { layer.fillOpacity = Number(args.fillOpacity); }
    if (args.blendMode !== undefined) { layer.blendMode = eval("BlendMode." + String(args.blendMode).toUpperCase().replace(/[^A-Z]/g, "")); }
    if (args.locked !== undefined) { layer.allLocked = !!args.locked; }
    if (args.x !== undefined || args.y !== undefined) {
        var b = AEAgent._bounds(layer);
        layer.translate((args.x === undefined ? b.x : Number(args.x)) - b.x, (args.y === undefined ? b.y : Number(args.y)) - b.y);
    }
    if (args.dx !== undefined || args.dy !== undefined) { layer.translate(Number(args.dx || 0), Number(args.dy || 0)); }
    return AEAgent._layerInfo(layer, 0);
};

AEAgent.transform_layer = function (args) {
    var layer = AEAgent._targetLayer(args);
    var anchors = { center: AnchorPosition.MIDDLECENTER, topleft: AnchorPosition.TOPLEFT, topright: AnchorPosition.TOPRIGHT, bottomleft: AnchorPosition.BOTTOMLEFT, bottomright: AnchorPosition.BOTTOMRIGHT, top: AnchorPosition.TOPCENTER, bottom: AnchorPosition.BOTTOMCENTER, left: AnchorPosition.MIDDLELEFT, right: AnchorPosition.MIDDLERIGHT };
    var anchor = anchors[String(args.anchor || "center").toLowerCase()] || AnchorPosition.MIDDLECENTER;
    if (args.width !== undefined || args.height !== undefined) {
        var b = AEAgent._bounds(layer);
        var sx = args.width !== undefined ? Number(args.width) / b.width * 100 : null;
        var sy = args.height !== undefined ? Number(args.height) / b.height * 100 : null;
        layer.resize(sx === null ? sy : sx, sy === null ? sx : sy, anchor);
    } else if (args.scale !== undefined || args.scaleX !== undefined || args.scaleY !== undefined) {
        var s = args.scale === undefined ? 100 : Number(args.scale);
        layer.resize(args.scaleX === undefined ? s : Number(args.scaleX), args.scaleY === undefined ? s : Number(args.scaleY), anchor);
    }
    if (args.rotate) { layer.rotate(Number(args.rotate), anchor); }
    return AEAgent._layerInfo(layer, 0);
};

AEAgent.set_text = function (args) {
    var layer = AEAgent._targetLayer(args);
    if (layer.typename === "LayerSet" || layer.kind !== LayerKind.TEXT) { throw new Error("“" + layer.name + "” is not a text layer."); }
    var t = layer.textItem;
    if (args.text !== undefined) { t.contents = String(args.text); }
    if (args.size !== undefined) { t.size = Number(args.size); }
    if (args.font !== undefined) { t.font = String(args.font); }
    if (args.color !== undefined) { t.color = AEAgent._color(args.color); }
    if (args.tracking !== undefined) { t.tracking = Number(args.tracking); }
    if (args.leading !== undefined) { t.useAutoLeading = false; t.leading = Number(args.leading); }
    return AEAgent._layerInfo(layer, 0);
};

AEAgent.duplicate_layer = function (args) {
    var layer = AEAgent._targetLayer(args);
    var copy = layer.duplicate();
    if (args.newName) { copy.name = String(args.newName); }
    return AEAgent._layerInfo(copy, 0);
};

AEAgent.delete_layers = function (args) {
    var ids = args.layerIds || [];
    var removed = [];
    for (var i = 0; i < ids.length; i += 1) {
        var layer = AEAgent._findLayer({ layerId: ids[i] });
        removed.push({ id: layer.id, name: layer.name });
        layer.remove();
    }
    return { removed: removed };
};

AEAgent.arrange_layer = function (args) {
    var layer = AEAgent._targetLayer(args);
    if (args.relativeToLayerId !== undefined) {
        var other = AEAgent._findLayer({ layerId: args.relativeToLayerId });
        layer.move(other, args.placement === "below" ? ElementPlacement.PLACEAFTER : ElementPlacement.PLACEBEFORE);
    } else {
        var orders = { front: ElementPlacement.PLACEATBEGINNING, back: ElementPlacement.PLACEATEND };
        layer.move(layer.parent, orders[args.order] || ElementPlacement.PLACEATBEGINNING);
    }
    return AEAgent._layerInfo(layer, 0);
};

AEAgent.group_layers = function (args) {
    var doc = AEAgent._doc();
    var ids = args.layerIds || [];
    if (!ids.length) { throw new Error("Pass layerIds to group."); }
    var first = AEAgent._findLayer({ layerId: ids[0] });
    var group = doc.layerSets.add();
    group.name = String(args.name || "Group");
    group.move(first, ElementPlacement.PLACEBEFORE);
    for (var i = ids.length - 1; i >= 0; i -= 1) {
        AEAgent._findLayer({ layerId: ids[i] }).move(group, ElementPlacement.INSIDE);
    }
    return AEAgent._layerInfo(group, 1);
};

AEAgent.place_image = function (args) {
    var doc = AEAgent._doc();
    var file = new File(String(args.path || ""));
    if (!file.exists) { throw new Error("File not found: " + args.path); }
    var desc = new ActionDescriptor();
    desc.putPath(charIDToTypeID("null"), file);
    desc.putEnumerated(charIDToTypeID("FTcs"), charIDToTypeID("QCSt"), charIDToTypeID("Qcsa"));
    executeAction(charIDToTypeID("Plc "), desc, DialogModes.NO);
    var layer = doc.activeLayer;
    if (args.name) { layer.name = String(args.name); }
    if (args.x !== undefined || args.y !== undefined) {
        var b = AEAgent._bounds(layer);
        layer.translate((args.x === undefined ? b.x : Number(args.x)) - b.x, (args.y === undefined ? b.y : Number(args.y)) - b.y);
    }
    return AEAgent._layerInfo(layer, 0);
};

AEAgent.fill_layer = function (args) {
    var doc = AEAgent._doc();
    var layer = doc.artLayers.add();
    layer.name = String(args.name || "Fill");
    doc.selection.selectAll();
    doc.selection.fill(AEAgent._color(args.color || "#FFFFFF"));
    doc.selection.deselect();
    if (args.toBack) { layer.move(doc, ElementPlacement.PLACEATEND); }
    return AEAgent._layerInfo(layer, 0);
};

AEAgent.add_adjustment_layer = function (args) {
    var doc = AEAgent._doc();
    var kinds = { brightnessContrast: "brightnessEvent", hueSaturation: "hueSaturation", levels: "levels", curves: "curves", vibrance: "vibrance", blackAndWhite: "blackAndWhite", exposure: "exposure", invert: "invert" };
    var id = kinds[args.type];
    if (!id) { throw new Error("Use one of: " + (function () { var k = []; for (var n in kinds) { k.push(n); } return k.join(", "); }()) + ". For settings, adjust it afterwards with execute_script."); }
    var desc = new ActionDescriptor();
    var ref = new ActionReference();
    ref.putClass(stringIDToTypeID("adjustmentLayer"));
    desc.putReference(charIDToTypeID("null"), ref);
    var layerDesc = new ActionDescriptor();
    var typeDesc = new ActionDescriptor();
    if (args.type === "brightnessContrast") {
        typeDesc.putInteger(charIDToTypeID("Brgh"), Number(args.brightness || 0));
        typeDesc.putInteger(charIDToTypeID("Cntr"), Number(args.contrast || 0));
        typeDesc.putBoolean(stringIDToTypeID("useLegacy"), false);
    } else if (args.type === "hueSaturation") {
        typeDesc.putBoolean(charIDToTypeID("Clrz"), false);
    }
    layerDesc.putObject(charIDToTypeID("Type"), stringIDToTypeID(id), typeDesc);
    desc.putObject(charIDToTypeID("Usng"), stringIDToTypeID("adjustmentLayer"), layerDesc);
    executeAction(charIDToTypeID("Mk  "), desc, DialogModes.NO);
    var layer = doc.activeLayer;
    if (args.name) { layer.name = String(args.name); }
    return AEAgent._layerInfo(layer, 0);
};

AEAgent.resize_document = function (args) {
    var doc = AEAgent._doc();
    var w = args.width === undefined ? null : UnitValue(Number(args.width), "px");
    var h = args.height === undefined ? null : UnitValue(Number(args.height), "px");
    if (args.canvas) {
        doc.resizeCanvas(w || doc.width, h || doc.height, AnchorPosition.MIDDLECENTER);
    } else {
        doc.resizeImage(w, h, null, ResampleMethod.BICUBIC);
    }
    return { width: AEAgent._px(doc.width), height: AEAgent._px(doc.height) };
};

/* Saves a flattened copy as PNG so the agent can look at the result. */
AEAgent.preview_document = function (args) {
    var doc = AEAgent._doc();
    var max = Number(args.maxSize || 1568);
    var dup = doc.duplicate("soma-preview", true);
    try {
        app.activeDocument = dup;
        if (dup.bitsPerChannel !== BitsPerChannelType.EIGHT) { dup.bitsPerChannel = BitsPerChannelType.EIGHT; }
        if (dup.mode !== DocumentMode.RGB) { dup.changeMode(ChangeMode.RGB); }
        var w = AEAgent._px(dup.width), h = AEAgent._px(dup.height);
        var scale = Math.min(1, max / Math.max(w, h));
        if (scale < 1) { dup.resizeImage(UnitValue(Math.round(w * scale), "px"), UnitValue(Math.round(h * scale), "px"), null, ResampleMethod.BICUBIC); }
        var file = AEAgent._tempFile(".png");
        dup.saveAs(file, new PNGSaveOptions(), true, Extension.LOWERCASE);
        return { frames: [{ path: file.fsName, time: 0, frame: 0 }], width: w, height: h, reason: args.reason || null };
    } finally {
        dup.close(SaveOptions.DONOTSAVECHANGES);
        app.activeDocument = doc;
    }
};

AEAgent.undo_last_action = function () {
    var doc = AEAgent._doc();
    var states = doc.historyStates;
    var currentName = doc.activeHistoryState.name;
    var index = -1;
    for (var i = 0; i < states.length; i += 1) { if (states[i].name === currentName) { index = i; } }
    if (index < 1) { throw new Error("There is no earlier History state to go back to."); }
    doc.activeHistoryState = states[index - 1];
    return { reverted: true, now: states[index - 1].name };
};
