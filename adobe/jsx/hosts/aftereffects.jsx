/* AE Agent host bridge for After Effects 25+ / CEP 12. */

var AEAgent = AEAgent || {};
AEAgent.host = "aftereffects";
AEAgent._undoRecords = AEAgent._undoRecords || [];

AEAgent._revision = function () {
    try { return typeof app.project.revision === "number" ? app.project.revision : null; } catch (error) { return null; }
};

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
    if (value === null) {
        return "null";
    }
    var type = typeof value;
    if (type === "string") {
        return AEAgent._quote(value);
    }
    if (type === "number") {
        return isFinite(value) ? String(value) : "null";
    }
    if (type === "boolean") {
        return value ? "true" : "false";
    }
    var i;
    var parts = [];
    if (value instanceof Array) {
        for (i = 0; i < value.length; i += 1) {
            parts.push(value[i] === undefined ? "null" : AEAgent._stringify(value[i]));
        }
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
    return "null";
};

AEAgent._parse = function (value) {
    /* The panel creates this string with JSON.stringify before URI encoding. */
    return eval("(" + value + ")");
};

AEAgent._result = function (ok, data, error, undoable) {
    return AEAgent._stringify({
        ok: ok,
        data: data === undefined ? null : data,
        error: error || null,
        undoable: undoable === true
    });
};

AEAgent._activeComp = function () {
    if (!app.project) {
        throw new Error("No After Effects project is open.");
    }
    if (!(app.project.activeItem instanceof CompItem)) {
        throw new Error("Open or select a composition first.");
    }
    return app.project.activeItem;
};

AEAgent._copyArray = function (value) {
    if (!(value instanceof Array)) {
        return value;
    }
    var copy = [];
    for (var i = 0; i < value.length; i += 1) {
        copy.push(value[i]);
    }
    return copy;
};

AEAgent._propertyValue = function (group, matchName) {
    try {
        var property = group.property(matchName);
        return property ? AEAgent._copyArray(property.value) : null;
    } catch (error) {
        return null;
    }
};

AEAgent._layerType = function (layer) {
    if (layer instanceof TextLayer) {
        return "text";
    }
    if (layer instanceof ShapeLayer) {
        return "shape";
    }
    if (layer instanceof CameraLayer) {
        return "camera";
    }
    if (layer instanceof LightLayer) {
        return "light";
    }
    if (layer instanceof AVLayer) {
        if (layer.nullLayer) {
            return "null";
        }
        if (layer.adjustmentLayer) {
            return "adjustment";
        }
        return "av";
    }
    return "unknown";
};

AEAgent._layerSummary = function (layer) {
    var transform = layer.property("ADBE Transform Group");
    var layerId = null;
    try {
        layerId = layer.id;
    } catch (error) {
        layerId = null;
    }
    return {
        index: layer.index,
        id: layerId,
        name: layer.name,
        type: AEAgent._layerType(layer),
        selected: layer.selected,
        enabled: layer.enabled,
        locked: layer.locked,
        shy: layer.shy,
        threeDLayer: layer.threeDLayer,
        inPoint: layer.inPoint,
        outPoint: layer.outPoint,
        startTime: layer.startTime,
        transform: transform ? {
            anchorPoint: AEAgent._propertyValue(transform, "ADBE Anchor Point"),
            position: AEAgent._propertyValue(transform, "ADBE Position"),
            scale: AEAgent._propertyValue(transform, "ADBE Scale"),
            rotation: AEAgent._propertyValue(transform, "ADBE Rotate Z"),
            opacity: AEAgent._propertyValue(transform, "ADBE Opacity")
        } : null
    };
};

AEAgent.project_overview = function () {
    if (!app.project) {
        return { projectOpen: false, activeComp: null };
    }
    var active = app.project.activeItem;
    var comp = active instanceof CompItem ? active : null;
    return {
        projectOpen: true,
        projectName: app.project.file ? app.project.file.name : "Untitled Project",
        projectPath: app.project.file ? app.project.file.fullName : null,
        itemCount: app.project.numItems,
        activeComp: comp ? {
            id: comp.id,
            name: comp.name,
            width: comp.width,
            height: comp.height,
            pixelAspect: comp.pixelAspect,
            duration: comp.duration,
            frameRate: comp.frameRate,
            time: comp.time,
            layerCount: comp.numLayers,
            selectedLayerCount: comp.selectedLayers.length
        } : null
    };
};

AEAgent.project_map = function () {
    if (!app.project) { return { projectOpen: false, items: [] }; }
    var items = [];
    for (var i = 1; i <= app.project.numItems; i += 1) {
        var item = app.project.item(i);
        var summary = { id: item.id, name: item.name, type: item instanceof CompItem ? "composition" : item instanceof FootageItem ? "footage" : item instanceof FolderItem ? "folder" : "item", parentFolderId: item.parentFolder ? item.parentFolder.id : null };
        if (item instanceof CompItem) {
            summary.width = item.width; summary.height = item.height; summary.duration = item.duration; summary.frameRate = item.frameRate; summary.layers = [];
            for (var l = 1; l <= item.numLayers; l += 1) {
                var layer = item.layer(l); var layerInfo = AEAgent._layerSummary(layer);
                try { layerInfo.sourceId = layer.source ? layer.source.id : null; } catch (ignored) { layerInfo.sourceId = null; }
                try { layerInfo.parentLayerId = layer.parent ? layer.parent.id : null; } catch (ignored2) { layerInfo.parentLayerId = null; }
                try { layerInfo.trackMatteLayerId = layer.trackMatteLayer ? layer.trackMatteLayer.id : null; layerInfo.trackMatteType = String(layer.trackMatteType); } catch (ignored3) {}
                summary.layers.push(layerInfo);
            }
        } else if (item instanceof FootageItem) {
            try { summary.filePath = item.file ? item.file.fsName : null; summary.missing = !!(item.file && !item.file.exists); } catch (ignored4) {}
        }
        items.push(summary);
    }
    return { projectOpen: true, projectName: app.project.file ? app.project.file.name : "Untitled Project", activeItemId: app.project.activeItem ? app.project.activeItem.id : null, itemCount: items.length, items: items };
};

AEAgent.list_layers = function () {
    var comp = AEAgent._activeComp();
    var layers = [];
    for (var i = 1; i <= comp.numLayers; i += 1) {
        layers.push(AEAgent._layerSummary(comp.layer(i)));
    }
    return {
        compId: comp.id,
        compName: comp.name,
        count: layers.length,
        layers: layers
    };
};

AEAgent.get_selected_layers = function () {
    var comp = AEAgent._activeComp();
    var selected = comp.selectedLayers;
    var layers = [];
    for (var i = 0; i < selected.length; i += 1) {
        layers.push(AEAgent._layerSummary(selected[i]));
    }
    return {
        compId: comp.id,
        compName: comp.name,
        count: layers.length,
        layers: layers
    };
};

AEAgent._safePropertyValue = function (property) {
    try {
        var value = property.value;
        if (value instanceof Array) {
            return AEAgent._copyArray(value);
        }
        if (value === null || typeof value === "number" || typeof value === "string" || typeof value === "boolean") {
            return value;
        }
        return String(value);
    } catch (error) {
        return null;
    }
};

AEAgent._propertyContext = function (property) {
    var path = [];
    var current = property;
    var layer = null;
    while (current) {
        if (current instanceof Layer) {
            layer = current;
            break;
        }
        path.unshift(current.matchName || current.name);
        try {
            current = current.propertyGroup(1);
        } catch (error) {
            current = null;
        }
    }
    return { layer: layer, path: path };
};

AEAgent._propertySummary = function (property) {
    var context = AEAgent._propertyContext(property);
    var layer = context.layer;
    var layerId = null;
    if (layer) {
        try {
            layerId = layer.id;
        } catch (error) {
            layerId = null;
        }
    }
    var expression = null;
    var expressionError = null;
    var expressionEnabled = false;
    var canSetExpression = false;
    try {
        canSetExpression = property.canSetExpression;
        expressionEnabled = property.expressionEnabled;
        expression = property.expression || null;
        expressionError = property.expressionError || null;
    } catch (error2) {
        expression = null;
    }
    return {
        layerId: layerId,
        layerIndex: layer ? layer.index : null,
        layerName: layer ? layer.name : null,
        name: property.name,
        matchName: property.matchName,
        propertyPath: context.path,
        value: AEAgent._safePropertyValue(property),
        numKeys: property.numKeys || 0,
        canSetExpression: canSetExpression,
        expressionEnabled: expressionEnabled,
        expression: expression,
        expressionError: expressionError
    };
};

AEAgent.get_selected_properties = function () {
    var comp = AEAgent._activeComp();
    var selected = comp.selectedProperties;
    var properties = [];
    for (var i = 0; i < selected.length; i += 1) {
        if (selected[i].propertyType === PropertyType.PROPERTY) {
            properties.push(AEAgent._propertySummary(selected[i]));
        }
    }
    return {
        compId: comp.id,
        compName: comp.name,
        count: properties.length,
        properties: properties
    };
};

AEAgent._number = function (value, fallback, minimum, maximum) {
    var number = Number(value);
    if (isNaN(number)) {
        number = fallback;
    }
    if (minimum !== undefined && number < minimum) {
        number = minimum;
    }
    if (maximum !== undefined && number > maximum) {
        number = maximum;
    }
    return number;
};

AEAgent._color = function (value, fallback) {
    var color = fallback;
    if (typeof value === "string") {
        var hex = value.replace("#", "");
        if (/^[0-9a-fA-F]{6}$/.test(hex)) {
            color = [
                parseInt(hex.substr(0, 2), 16) / 255,
                parseInt(hex.substr(2, 2), 16) / 255,
                parseInt(hex.substr(4, 2), 16) / 255
            ];
        }
    } else if (value instanceof Array && value.length >= 3) {
        color = [Number(value[0]), Number(value[1]), Number(value[2])];
    }
    for (var i = 0; i < 3; i += 1) {
        color[i] = AEAgent._number(color[i], fallback[i], 0, 1);
    }
    return color;
};

AEAgent._position = function (value, comp) {
    if (!(value instanceof Array) || value.length < 2) {
        return [comp.width / 2, comp.height / 2];
    }
    return [Number(value[0]), Number(value[1])];
};

AEAgent._findLayer = function (comp, args) {
    var i;
    if (args.layerId !== undefined && args.layerId !== null) {
        for (i = 1; i <= comp.numLayers; i += 1) {
            try {
                if (comp.layer(i).id === Number(args.layerId)) {
                    return comp.layer(i);
                }
            } catch (error) {
                // Older hosts can fall back to the layer index.
            }
        }
    }
    if (args.index !== undefined && args.index !== null) {
        i = Math.round(Number(args.index));
        if (i >= 1 && i <= comp.numLayers) {
            return comp.layer(i);
        }
    }
    throw new Error("The requested layer no longer exists. Inspect the layer list again.");
};

AEAgent._resolveProperty = function (layer, propertyPath) {
    if (!(propertyPath instanceof Array) || propertyPath.length === 0) {
        throw new Error("A propertyPath from get_selected_properties is required.");
    }
    var current = layer;
    for (var i = 0; i < propertyPath.length; i += 1) {
        try {
            current = current.property(propertyPath[i]);
        } catch (error) {
            current = null;
        }
        if (!current) {
            throw new Error("Could not find property path segment “" + propertyPath[i] + "” on “" + layer.name + "”. Inspect the selected properties again.");
        }
    }
    if (current.propertyType !== PropertyType.PROPERTY) {
        throw new Error("The propertyPath points to a group instead of an editable property.");
    }
    return current;
};

AEAgent._propertyPathSegment = function (parent, child) {
    var matchName = child.matchName || "";
    if (!matchName || !parent || !parent.numProperties) {
        return child.propertyIndex || child.name;
    }
    var matches = 0;
    for (var i = 1; i <= parent.numProperties; i += 1) {
        var candidate = parent.property(i);
        if (candidate && candidate.matchName === matchName) {
            matches += 1;
        }
    }
    return matches === 1 ? matchName : (child.propertyIndex || child.name);
};

AEAgent._propertySummaryAtPath = function (property, propertyPath) {
    var summary = AEAgent._propertySummary(property);
    summary.propertyPath = AEAgent._copyArray(propertyPath);
    return summary;
};

AEAgent._walkProperties = function (parent, path, depth, options, output) {
    if (!parent || !parent.numProperties || depth > options.maxDepth || output.length >= options.maxProperties) {
        return;
    }
    for (var i = 1; i <= parent.numProperties && output.length < options.maxProperties; i += 1) {
        var child = parent.property(i);
        if (!child) {
            continue;
        }
        var childPath = AEAgent._copyArray(path);
        childPath.push(AEAgent._propertyPathSegment(parent, child));
        var haystack = String(child.name || "") + " " + String(child.matchName || "");
        var matchesSearch = !options.search || haystack.toLowerCase().indexOf(options.search) !== -1;
        if (child.propertyType === PropertyType.PROPERTY) {
            if (matchesSearch) {
                var summary = AEAgent._propertySummaryAtPath(child, childPath);
                if (!options.includeValues) {
                    delete summary.value;
                    delete summary.expression;
                }
                output.push(summary);
            }
        } else if (depth < options.maxDepth) {
            AEAgent._walkProperties(child, childPath, depth + 1, options, output);
        }
    }
};

AEAgent.get_layer_properties = function (args) {
    var comp = AEAgent._activeComp();
    var layer = AEAgent._findLayer(comp, args);
    var options = {
        maxDepth: Math.round(AEAgent._number(args.maxDepth, 12, 1, 30)),
        maxProperties: Math.round(AEAgent._number(args.maxProperties, 500, 1, 2000)),
        includeValues: args.includeValues !== false,
        search: String(args.search || "").toLowerCase()
    };
    var properties = [];
    AEAgent._walkProperties(layer, [], 1, options, properties);
    return {
        compId: comp.id,
        compName: comp.name,
        layer: AEAgent._layerSummary(layer),
        count: properties.length,
        truncated: properties.length >= options.maxProperties,
        properties: properties
    };
};

AEAgent._targetLayers = function (comp, args) {
    if (args.layerId !== undefined || args.index !== undefined) {
        return [AEAgent._findLayer(comp, args)];
    }
    var layers = [];
    for (var i = 1; i <= comp.numLayers; i += 1) {
        layers.push(comp.layer(i));
    }
    return layers;
};

AEAgent.list_expressions = function (args) {
    args = args || {};
    var comp = AEAgent._activeComp();
    var layers = AEAgent._targetLayers(comp, args);
    var expressions = [];
    for (var i = 0; i < layers.length; i += 1) {
        var properties = [];
        AEAgent._walkProperties(layers[i], [], 1, {
            maxDepth: Math.round(AEAgent._number(args.maxDepth, 16, 1, 30)),
            maxProperties: Math.round(AEAgent._number(args.maxProperties, 1000, 1, 4000)),
            includeValues: true,
            search: ""
        }, properties);
        for (var j = 0; j < properties.length; j += 1) {
            if (properties[j].expression) {
                expressions.push(properties[j]);
            }
        }
    }
    return { compId: comp.id, compName: comp.name, count: expressions.length, expressions: expressions };
};

AEAgent._keyframeSummary = function (property, propertyPath) {
    var keys = [];
    for (var i = 1; i <= property.numKeys; i += 1) {
        var key = { index: i, time: property.keyTime(i), value: AEAgent._copyArray(property.keyValue(i)) };
        try {
            key.inInterpolation = String(property.keyInInterpolationType(i));
            key.outInterpolation = String(property.keyOutInterpolationType(i));
            var inEase = property.keyInTemporalEase(i);
            var outEase = property.keyOutTemporalEase(i);
            key.inTemporalEase = [];
            key.outTemporalEase = [];
            for (var e = 0; e < inEase.length; e += 1) { key.inTemporalEase.push({ speed: inEase[e].speed, influence: inEase[e].influence }); }
            for (var o = 0; o < outEase.length; o += 1) { key.outTemporalEase.push({ speed: outEase[o].speed, influence: outEase[o].influence }); }
        } catch (error) {
            // Interpolation metadata is not available for every property type.
        }
        keys.push(key);
    }
    var summary = AEAgent._propertySummaryAtPath(property, propertyPath);
    summary.keyframes = keys;
    return summary;
};

AEAgent.get_keyframes = function (args) {
    args = args || {};
    var comp = AEAgent._activeComp();
    var animated = [];
    if (args.propertyPath instanceof Array && args.propertyPath.length > 0) {
        var exactLayer = AEAgent._findLayer(comp, args);
        var exactProperty = AEAgent._resolveProperty(exactLayer, args.propertyPath);
        if (exactProperty.numKeys > 0) {
            animated.push(AEAgent._keyframeSummary(exactProperty, args.propertyPath));
        }
    } else {
        var layers = AEAgent._targetLayers(comp, args || {});
        for (var i = 0; i < layers.length; i += 1) {
            var properties = [];
            AEAgent._walkProperties(layers[i], [], 1, {
                maxDepth: Math.round(AEAgent._number(args.maxDepth, 16, 1, 30)),
                maxProperties: Math.round(AEAgent._number(args.maxProperties, 1000, 1, 4000)),
                includeValues: false,
                search: ""
            }, properties);
            for (var j = 0; j < properties.length; j += 1) {
                if (properties[j].numKeys > 0) {
                    var property = AEAgent._resolveProperty(layers[i], properties[j].propertyPath);
                    animated.push(AEAgent._keyframeSummary(property, properties[j].propertyPath));
                }
            }
        }
    }
    return { compId: comp.id, compName: comp.name, animatedPropertyCount: animated.length, properties: animated };
};

AEAgent.rename_composition = function (args) {
    var comp = AEAgent._activeComp();
    var name = String(args.name || "");
    if (!name) {
        throw new Error("A non-empty composition name is required.");
    }
    var previousName = comp.name;
    comp.name = name;
    return { compId: comp.id, previousName: previousName, name: comp.name };
};

AEAgent.set_property_value = function (args) {
    var comp = AEAgent._activeComp();
    var layer = AEAgent._findLayer(comp, args);
    if (layer.locked) {
        throw new Error("Unlock “" + layer.name + "” before changing its properties.");
    }
    var property = AEAgent._resolveProperty(layer, args.propertyPath);
    var value = args.value;
    var current = AEAgent._safePropertyValue(property);
    if (current instanceof Array && value instanceof Array) {
        value = AEAgent._fitDimensions(value, current);
    }
    property.setValue(value);
    return AEAgent._propertySummary(property);
};

AEAgent.add_effect = function (args) {
    var comp = AEAgent._activeComp();
    var layer = AEAgent._findLayer(comp, args);
    if (layer.locked) {
        throw new Error("Unlock “" + layer.name + "” before adding an effect.");
    }
    var matchName = String(args.matchName || "");
    if (!matchName) {
        throw new Error("An effect match name is required.");
    }
    var effects = layer.property("ADBE Effect Parade");
    if (!effects || !effects.canAddProperty(matchName)) {
        throw new Error("The effect “" + matchName + "” is not available in this After Effects installation.");
    }
    var effect = effects.addProperty(matchName);
    if (!effect) {
        throw new Error("After Effects did not add the requested effect.");
    }
    if (args.name) {
        effect.name = String(args.name);
    }
    var propertyValues = args.propertyValues instanceof Array ? args.propertyValues : [];
    for (var i = 0; i < propertyValues.length; i += 1) {
        var entry = propertyValues[i];
        var effectProperty = effect.property(entry.property);
        if (!effectProperty || effectProperty.propertyType !== PropertyType.PROPERTY) {
            throw new Error("Could not find effect property “" + entry.property + "”.");
        }
        var effectValue = entry.value;
        var current = AEAgent._safePropertyValue(effectProperty);
        if (current instanceof Array && effectValue instanceof Array) {
            effectValue = AEAgent._fitDimensions(effectValue, current);
        }
        effectProperty.setValue(effectValue);
    }
    var path = ["ADBE Effect Parade", effect.propertyIndex];
    var properties = [];
    AEAgent._walkProperties(effect, path, 1, {
        maxDepth: 8,
        maxProperties: 200,
        includeValues: true,
        search: ""
    }, properties);
    return {
        layerId: AEAgent._layerSummary(layer).id,
        layerIndex: layer.index,
        layerName: layer.name,
        effectName: effect.name,
        matchName: effect.matchName,
        effectPath: path,
        properties: properties
    };
};

AEAgent.create_expression_control = function (args) {
    var comp = AEAgent._activeComp();
    var layer = AEAgent._findLayer(comp, args);
    if (layer.locked) {
        throw new Error("Unlock “" + layer.name + "” before adding a control.");
    }
    var types = {
        dropdown: "ADBE Dropdown Control",
        slider: "ADBE Slider Control",
        checkbox: "ADBE Checkbox Control",
        color: "ADBE Color Control",
        point: "ADBE Point Control",
        angle: "ADBE Angle Control",
        layer: "ADBE Layer Control"
    };
    var controlType = String(args.controlType || "").toLowerCase();
    var matchName = types[controlType];
    if (!matchName) {
        throw new Error("Unsupported expression control type: " + controlType);
    }
    var effects = layer.property("ADBE Effect Parade");
    if (!effects || !effects.canAddProperty(matchName)) {
        throw new Error("The requested expression control is not available.");
    }
    var effect = effects.addProperty(matchName);
    effect.name = String(args.name || effect.name);
    var control = effect.property(1);
    if (controlType === "dropdown") {
        if (!(args.menuItems instanceof Array) || args.menuItems.length < 1) {
            throw new Error("Dropdown controls require at least one menu item.");
        }
        var menuItems = [];
        for (var i = 0; i < args.menuItems.length; i += 1) {
            menuItems.push(String(args.menuItems[i]));
        }
        if (typeof control.setPropertyParameters !== "function") {
            throw new Error("This After Effects version cannot configure dropdown menu items through scripting.");
        }
        control = control.setPropertyParameters(menuItems);
    }
    if (args.initialValue !== undefined) {
        var initialValue = args.initialValue;
        if (controlType === "color") {
            initialValue = AEAgent._color(initialValue, [1, 1, 1]);
        }
        control.setValue(initialValue);
    }
    var path = ["ADBE Effect Parade", effect.propertyIndex, control.propertyIndex];
    var addedToTemplate = false;
    var displayName = String(args.essentialGraphicsName || "");
    if (displayName) {
        if (!control.canAddToMotionGraphicsTemplate(comp)) {
            throw new Error("The new control cannot be added to this Motion Graphics template.");
        }
        if (typeof control.addToMotionGraphicsTemplateAs === "function") {
            addedToTemplate = control.addToMotionGraphicsTemplateAs(comp, displayName);
        } else {
            addedToTemplate = control.addToMotionGraphicsTemplate(comp);
        }
        if (addedToTemplate === false) {
            throw new Error("After Effects did not add the new control to Essential Graphics.");
        }
        addedToTemplate = true;
    }
    return {
        layerId: AEAgent._layerSummary(layer).id,
        layerIndex: layer.index,
        layerName: layer.name,
        controlType: controlType,
        effectName: effect.name,
        property: AEAgent._propertySummaryAtPath(control, path),
        addedToEssentialGraphics: addedToTemplate,
        essentialGraphicsName: displayName || null
    };
};

AEAgent.execute_script = function (args) {
    var code = String(args.code || "");
    if (!code) {
        throw new Error("ExtendScript code is required.");
    }
    var runner = eval("(function () {\n" + code + "\n})");
    var result = runner();
    return result === undefined ? { executed: true } : result;
};

AEAgent.preview_frames = function (args) {
    var comp = AEAgent._activeComp();
    if (typeof comp.saveFrameToPng !== "function") {
        throw new Error("This After Effects build does not expose saveFrameToPng for scripted visual verification.");
    }
    var times = args.times instanceof Array ? args.times : [];
    if (times.length === 0) {
        var start = comp.workAreaDuration > 0 ? comp.workAreaStart : 0;
        var duration = comp.workAreaDuration > 0 ? comp.workAreaDuration : comp.duration;
        var end = Math.min(comp.duration - comp.frameDuration, start + duration - comp.frameDuration);
        times = [start, start + duration * 0.25, start + duration * 0.5, start + duration * 0.75, end];
    }
    var limit = Math.round(AEAgent._number(args.maxFrames, 8, 1, 8));
    var folder = new Folder(Folder.temp.fsName + "/ae-agent-previews");
    if (!folder.exists && !folder.create()) {
        throw new Error("After Effects could not create the temporary preview folder.");
    }
    var frames = [];
    var seen = {};
    var stamp = new Date().getTime();
    for (var i = 0; i < times.length && frames.length < limit; i += 1) {
        var time = AEAgent._number(times[i], 0, 0, Math.max(0, comp.duration - comp.frameDuration));
        time = Math.round(time / comp.frameDuration) * comp.frameDuration;
        var frameNumber = Math.round(time / comp.frameDuration);
        if (seen[frameNumber]) {
            continue;
        }
        seen[frameNumber] = true;
        var file = new File(folder.fsName + "/comp-" + comp.id + "-" + stamp + "-f" + frameNumber + ".png");
        comp.saveFrameToPng(time, file);
        frames.push({ time: time, frame: frameNumber, path: file.fsName });
    }
    return {
        compId: comp.id,
        compName: comp.name,
        width: comp.width,
        height: comp.height,
        frameRate: comp.frameRate,
        count: frames.length,
        frames: frames
    };
};

AEAgent.undo_last_action = function () {
    var records = AEAgent._undoRecords;
    var last = records.length ? records[records.length - 1] : null;
    if (!last || last.project !== app.project || last.revision !== AEAgent._revision()) {
        AEAgent._undoRecords = [];
        throw new Error("The project changed outside the agent, or there is no verified agent Undo step. Use After Effects Undo history to choose the action to revert.");
    }
    // 16 is Edit > Undo. Do not look it up by name: findMenuCommandId("Undo")
    // resolves to Edit > Purge > Undo, which erases the whole Undo history.
    var commandId = 16;
    app.executeCommand(commandId);
    records.pop();
    if (records.length) { records[records.length - 1].revision = AEAgent._revision(); }
    return { reverted: true, commandId: commandId };
};

AEAgent.create_text_layer = function (args) {
    var comp = AEAgent._activeComp();
    if (args.text === undefined || args.text === null) {
        throw new Error("Text content is required.");
    }
    var layer = comp.layers.addText(String(args.text));
    layer.name = args.name ? String(args.name) : String(args.text).substr(0, 80);
    layer.property("ADBE Transform Group").property("ADBE Position").setValue(AEAgent._position(args.position, comp));

    var sourceText = layer.property("ADBE Text Properties").property("ADBE Text Document");
    var documentValue = sourceText.value;
    if (args.fontSize !== undefined) {
        documentValue.fontSize = AEAgent._number(args.fontSize, documentValue.fontSize, 1, 1000);
    }
    if (args.fillColor !== undefined) {
        documentValue.applyFill = true;
        documentValue.fillColor = AEAgent._color(args.fillColor, [1, 1, 1]);
    }
    sourceText.setValue(documentValue);
    layer.selected = true;
    return AEAgent._layerSummary(layer);
};

AEAgent.create_shape_layer = function (args) {
    var comp = AEAgent._activeComp();
    var width = AEAgent._number(args.width, Math.round(comp.width * 0.5), 1, 100000);
    var height = AEAgent._number(args.height, Math.round(comp.height * 0.25), 1, 100000);
    var roundness = AEAgent._number(args.roundness, 0, 0, 100000);
    var strokeWidth = AEAgent._number(args.strokeWidth, 0, 0, 10000);
    var layer = comp.layers.addShape();
    layer.name = args.name ? String(args.name) : "Agent Rectangle";

    var root = layer.property("ADBE Root Vectors Group");
    var group = root.addProperty("ADBE Vector Group");
    group.name = "Rectangle";
    var contents = group.property("ADBE Vectors Group");
    var rectangle = contents.addProperty("ADBE Vector Shape - Rect");
    rectangle.property("ADBE Vector Rect Size").setValue([width, height]);
    rectangle.property("ADBE Vector Rect Roundness").setValue(roundness);

    var fill = contents.addProperty("ADBE Vector Graphic - Fill");
    fill.property("ADBE Vector Fill Color").setValue(AEAgent._color(args.fillColor, [0.55, 0.32, 1]));
    if (strokeWidth > 0) {
        var stroke = contents.addProperty("ADBE Vector Graphic - Stroke");
        stroke.property("ADBE Vector Stroke Color").setValue(AEAgent._color(args.strokeColor, [1, 1, 1]));
        stroke.property("ADBE Vector Stroke Width").setValue(strokeWidth);
    }

    layer.property("ADBE Transform Group").property("ADBE Position").setValue(AEAgent._position(args.position, comp));
    layer.selected = true;
    return AEAgent._layerSummary(layer);
};

AEAgent._fitDimensions = function (value, current) {
    if (!(value instanceof Array)) {
        throw new Error("Expected an array of transform values.");
    }
    var result = [];
    for (var i = 0; i < current.length; i += 1) {
        result.push(value[i] === undefined ? current[i] : Number(value[i]));
    }
    return result;
};

AEAgent._setSpatial = function (property, value) {
    var current = AEAgent._copyArray(property.value);
    var fitted = AEAgent._fitDimensions(value, current);
    if (property.dimensionsSeparated) {
        for (var i = 0; i < fitted.length; i += 1) {
            property.getSeparationFollower(i).setValue(fitted[i]);
        }
    } else {
        property.setValue(fitted);
    }
};

AEAgent.set_layer_transform = function (args) {
    var comp = AEAgent._activeComp();
    var layer = AEAgent._findLayer(comp, args);
    if (layer.locked) {
        throw new Error("Unlock “" + layer.name + "” before changing its transform.");
    }
    var transform = layer.property("ADBE Transform Group");
    if (args.anchorPoint !== undefined) {
        AEAgent._setSpatial(transform.property("ADBE Anchor Point"), args.anchorPoint);
    }
    if (args.position !== undefined) {
        AEAgent._setSpatial(transform.property("ADBE Position"), args.position);
    }
    if (args.scale !== undefined) {
        AEAgent._setSpatial(transform.property("ADBE Scale"), args.scale);
    }
    if (args.rotation !== undefined) {
        transform.property("ADBE Rotate Z").setValue(Number(args.rotation));
    }
    if (args.opacity !== undefined) {
        transform.property("ADBE Opacity").setValue(AEAgent._number(args.opacity, 100, 0, 100));
    }
    return AEAgent._layerSummary(layer);
};

AEAgent.rename_layer = function (args) {
    var comp = AEAgent._activeComp();
    var layer = AEAgent._findLayer(comp, args);
    if (!args.name) {
        throw new Error("A non-empty layer name is required.");
    }
    if (layer.locked) {
        throw new Error("Unlock “" + layer.name + "” before renaming it.");
    }
    layer.name = String(args.name);
    return AEAgent._layerSummary(layer);
};

AEAgent.remove_layer = function (args) {
    var comp = AEAgent._activeComp();
    var layer = AEAgent._findLayer(comp, args);
    var expectedName = String(args.expectedName || "");
    if (!expectedName || layer.name !== expectedName) {
        throw new Error("Layer deletion requires expectedName to exactly match the current layer name.");
    }
    if (layer.locked) { throw new Error("Unlock “" + layer.name + "” before deleting it."); }
    var result = { compId: comp.id, removedLayerId: layer.id, removedLayerName: layer.name, previousIndex: layer.index };
    layer.remove();
    return result;
};

AEAgent.move_layer = function (args) {
    var comp = AEAgent._activeComp();
    var layer = AEAgent._findLayer(comp, args);
    if (layer.locked) { throw new Error("Unlock “" + layer.name + "” before moving it."); }
    if (args.beforeLayerId !== undefined) {
        layer.moveBefore(AEAgent._findLayer(comp, { layerId: args.beforeLayerId }));
    } else if (args.afterLayerId !== undefined) {
        layer.moveAfter(AEAgent._findLayer(comp, { layerId: args.afterLayerId }));
    } else {
        throw new Error("Provide beforeLayerId or afterLayerId.");
    }
    return AEAgent._layerSummary(layer);
};

AEAgent.duplicate_layer = function (args) {
    var comp = AEAgent._activeComp(); var layer = AEAgent._findLayer(comp, args);
    if (layer.locked) { throw new Error("Unlock “" + layer.name + "” before duplicating it."); }
    var copy = layer.duplicate(); if (args.name) { copy.name = String(args.name); }
    return { originalLayerId: layer.id, duplicate: AEAgent._layerSummary(copy) };
};

AEAgent.duplicate_composition = function (args) {
    var comp = AEAgent._activeComp(); var copy = comp.duplicate();
    if (args.name) { copy.name = String(args.name); }
    return { originalCompositionId: comp.id, compositionId: copy.id, name: copy.name };
};

AEAgent.set_layer_attributes = function (args) {
    var comp = AEAgent._activeComp(); var layer = AEAgent._findLayer(comp, args);
    if (layer.locked && args.locked !== false) { throw new Error("Unlock “" + layer.name + "” before changing its attributes."); }
    var fields = ["enabled", "solo", "shy", "locked", "threeDLayer", "guideLayer", "adjustmentLayer", "motionBlur", "collapseTransformation"];
    for (var i = 0; i < fields.length; i += 1) { if (args[fields[i]] !== undefined && fields[i] in layer) { layer[fields[i]] = args[fields[i]] === true; } }
    if (args.inPoint !== undefined) { layer.inPoint = AEAgent._number(args.inPoint, layer.inPoint, -100000, 100000); }
    if (args.outPoint !== undefined) { layer.outPoint = AEAgent._number(args.outPoint, layer.outPoint, -100000, 100000); }
    if (args.startTime !== undefined) { layer.startTime = AEAgent._number(args.startTime, layer.startTime, -100000, 100000); }
    if (args.stretch !== undefined) { layer.stretch = AEAgent._number(args.stretch, layer.stretch, -100000, 100000); }
    return AEAgent._layerSummary(layer);
};

AEAgent.precompose_layers = function (args) {
    var comp = AEAgent._activeComp(); var ids = args.layerIds || []; var indices = [];
    if (!(ids instanceof Array) || !ids.length) { throw new Error("Provide at least one layerId to precompose."); }
    for (var i = 0; i < ids.length; i += 1) { indices.push(AEAgent._findLayer(comp, { layerId: ids[i] }).index); }
    var name = String(args.name || ""); if (!name) { throw new Error("A precomposition name is required."); }
    var nested = comp.layers.precompose(indices, name, args.moveAllAttributes !== false);
    return { compositionId: nested.id, name: nested.name, sourceLayerIds: ids };
};

AEAgent.set_parent = function (args) {
    var comp = AEAgent._activeComp(); var child = AEAgent._findLayer(comp, args);
    var parent = args.parentLayerId === null ? null : AEAgent._findLayer(comp, { layerId: args.parentLayerId });
    if (parent && parent.id === child.id) { throw new Error("A layer cannot parent itself."); }
    if (args.preserveWorldTransform === false) { child.setParentWithJump(parent); } else { child.parent = parent; }
    return { layerId: child.id, parentLayerId: parent ? parent.id : null };
};

AEAgent.set_track_matte = function (args) {
    var comp = AEAgent._activeComp(); var layer = AEAgent._findLayer(comp, args);
    if (!(layer instanceof AVLayer)) { throw new Error("Track mattes require an AV layer."); }
    if (args.matteLayerId === null) { layer.removeTrackMatte(); return { layerId: layer.id, matteLayerId: null }; }
    var matte = AEAgent._findLayer(comp, { layerId: args.matteLayerId }); var kinds = { alpha: TrackMatteType.ALPHA, alpha_inverted: TrackMatteType.ALPHA_INVERTED, luma: TrackMatteType.LUMA, luma_inverted: TrackMatteType.LUMA_INVERTED };
    if (!kinds[args.type]) { throw new Error("Choose alpha, alpha_inverted, luma, or luma_inverted."); }
    if (typeof layer.setTrackMatte !== "function") { throw new Error("This After Effects build does not expose the modern Track Matte API."); }
    layer.setTrackMatte(matte, kinds[args.type]);
    return { layerId: layer.id, matteLayerId: matte.id, type: args.type };
};

AEAgent.create_control_layer = function (args) {
    var comp = AEAgent._activeComp(); var type = String(args.type || "null"); var name = String(args.name || type); var layer;
    if (type === "camera") { layer = comp.layers.addCamera(name, AEAgent._position(args.position, comp)); }
    else if (type === "light") { layer = comp.layers.addLight(name, AEAgent._position(args.position, comp)); }
    else { layer = comp.layers.addNull(args.duration === undefined ? comp.duration : AEAgent._number(args.duration, comp.duration, 0.001, 100000)); layer.name = name; }
    return AEAgent._layerSummary(layer);
};

AEAgent.measure_layer_bounds = function (args) {
    var comp = AEAgent._activeComp(); var layer = AEAgent._findLayer(comp, args); var times = args.times || [comp.time]; var samples = [];
    if (typeof layer.sourceRectAtTime !== "function") { throw new Error("This layer does not expose sourceRectAtTime."); }
    for (var i = 0; i < times.length; i += 1) { var time = AEAgent._number(times[i], comp.time, 0, comp.duration); var rect = layer.sourceRectAtTime(time, args.includeExtents === true); samples.push({ time: time, left: rect.left, top: rect.top, width: rect.width, height: rect.height, right: rect.left + rect.width, bottom: rect.top + rect.height }); }
    return { layerId: layer.id, layerName: layer.name, samples: samples };
};

AEAgent.sample_property = function (args) {
    var comp = AEAgent._activeComp(); var layer = AEAgent._findLayer(comp, args); var property = AEAgent._resolveProperty(layer, args.propertyPath); var samples = [];
    for (var i = 0; i < args.times.length; i += 1) { var time = AEAgent._number(args.times[i], comp.time, 0, comp.duration); samples.push({ time: time, value: AEAgent._copyArray(property.valueAtTime(time, args.preExpression === true)) }); }
    return { layerId: layer.id, propertyPath: args.propertyPath, samples: samples };
};

AEAgent.set_expression = function (args) {
    var comp = AEAgent._activeComp();
    var layer = AEAgent._findLayer(comp, args);
    if (layer.locked) {
        throw new Error("Unlock “" + layer.name + "” before setting an expression.");
    }
    var property = AEAgent._resolveProperty(layer, args.propertyPath);
    if (!property.canSetExpression) {
        throw new Error("“" + property.name + "” does not support expressions.");
    }
    property.expression = String(args.expression);
    property.expressionEnabled = args.enabled === false ? false : String(args.expression).length > 0;
    return AEAgent._propertySummary(property);
};

AEAgent.set_keyframes = function (args) {
    var comp = AEAgent._activeComp();
    var layer = AEAgent._findLayer(comp, args);
    if (layer.locked) {
        throw new Error("Unlock “" + layer.name + "” before setting keyframes.");
    }
    if (!(args.keyframes instanceof Array) || args.keyframes.length === 0) {
        throw new Error("At least one keyframe is required.");
    }
    var property = AEAgent._resolveProperty(layer, args.propertyPath);
    var writtenKeyIndices = [];
    for (var i = 0; i < args.keyframes.length; i += 1) {
        var keyframe = args.keyframes[i];
        var time = Number(keyframe.time);
        if (isNaN(time) || time < 0 || time > comp.duration) {
            throw new Error("Keyframe time must be between 0 and " + comp.duration + " seconds.");
        }
        var value = keyframe.value;
        var current = AEAgent._safePropertyValue(property);
        if (current instanceof Array && value instanceof Array) {
            value = AEAgent._fitDimensions(value, current);
        }
        property.setValueAtTime(time, value);
        writtenKeyIndices.push(property.nearestKeyIndex(time));
    }
    var interpolation = String(args.interpolation || "linear").toLowerCase();
    var influence = AEAgent._number(args.influence, 33.333, 0.1, 100);
    var speed = AEAgent._number(args.speed, 0, -1000000, 1000000);
    for (var n = 0; n < writtenKeyIndices.length; n += 1) {
        var k = writtenKeyIndices[n];
        if (interpolation === "hold") {
            property.setInterpolationTypeAtKey(k, KeyframeInterpolationType.HOLD, KeyframeInterpolationType.HOLD);
        } else if (interpolation === "easy_ease" || interpolation === "bezier") {
            property.setInterpolationTypeAtKey(k, KeyframeInterpolationType.BEZIER, KeyframeInterpolationType.BEZIER);
            var dimensions = 1;
            if (typeof PropertyValueType !== "undefined" && property.propertyValueType === PropertyValueType.TwoD) { dimensions = 2; }
            if (typeof PropertyValueType !== "undefined" && property.propertyValueType === PropertyValueType.ThreeD) { dimensions = 3; }
            var easeIn = []; var easeOut = [];
            for (var d = 0; d < dimensions; d += 1) { easeIn.push(new KeyframeEase(speed, influence)); easeOut.push(new KeyframeEase(speed, influence)); }
            property.setTemporalEaseAtKey(k, easeIn, easeOut);
        } else {
            property.setInterpolationTypeAtKey(k, KeyframeInterpolationType.LINEAR, KeyframeInterpolationType.LINEAR);
        }
    }
    return AEAgent._keyframeSummary(property, args.propertyPath);
};

AEAgent.remove_keyframes = function (args) {
    var comp = AEAgent._activeComp(); var layer = AEAgent._findLayer(comp, args); var property = AEAgent._resolveProperty(layer, args.propertyPath); var removed = 0;
    if (args.all === true) { for (var i = property.numKeys; i >= 1; i -= 1) { property.removeKey(i); removed += 1; } }
    else {
        var indices = (args.indices || []).slice().sort(function (a, b) { return b - a; });
        for (var j = 0; j < indices.length; j += 1) { var index = Math.round(indices[j]); if (index < 1 || index > property.numKeys) { throw new Error("Keyframe index " + index + " does not exist."); } property.removeKey(index); removed += 1; }
    }
    return { layerId: layer.id, propertyPath: args.propertyPath, removed: removed, remaining: property.numKeys };
};

AEAgent.set_keyframe_easing = function (args) {
    var comp = AEAgent._activeComp(); var layer = AEAgent._findLayer(comp, args); var property = AEAgent._resolveProperty(layer, args.propertyPath); var indices = args.indices || []; var influence = AEAgent._number(args.influence, 33.333, 0.1, 100); var speed = AEAgent._number(args.speed, 0, -1000000, 1000000);
    if (!indices.length) { for (var a = 1; a <= property.numKeys; a += 1) { indices.push(a); } }
    for (var i = 0; i < indices.length; i += 1) {
        var key = Math.round(indices[i]); if (key < 1 || key > property.numKeys) { throw new Error("Keyframe index " + key + " does not exist."); }
        var type = args.interpolation === "hold" ? KeyframeInterpolationType.HOLD : args.interpolation === "linear" ? KeyframeInterpolationType.LINEAR : KeyframeInterpolationType.BEZIER;
        property.setInterpolationTypeAtKey(key, type, type);
        if (type === KeyframeInterpolationType.BEZIER) { var dimensions = 1; if (typeof PropertyValueType !== "undefined" && property.propertyValueType === PropertyValueType.TwoD) { dimensions = 2; } if (typeof PropertyValueType !== "undefined" && property.propertyValueType === PropertyValueType.ThreeD) { dimensions = 3; } var incoming = []; var outgoing = []; for (var d = 0; d < dimensions; d += 1) { incoming.push(new KeyframeEase(speed, influence)); outgoing.push(new KeyframeEase(speed, influence)); } property.setTemporalEaseAtKey(key, incoming, outgoing); }
    }
    return AEAgent._keyframeSummary(property, args.propertyPath);
};

// Converts one CSS-style cubic-bezier(x1, y1, x2, y2) into After Effects temporal
// ease for a keyframe segment. AE draws an outgoing value-graph handle at
// (influence * duration, speed * influence * duration), so matching the curve's
// first control point gives influence = x1 and speed = y1 / x1 * delta / duration
// (mirrored for the incoming side). Spatial speeds cannot be negative.
AEAgent._easeSegment = function (bezier, duration, delta, spatial) {
    var x1 = Math.min(1, Math.max(0.001, bezier[0])), y1 = bezier[1];
    var x2 = Math.min(0.999, Math.max(0, bezier[2])), y2 = bezier[3];
    var rate = duration > 0 ? delta / duration : 0;
    var result = {
        outLinear: Math.abs(bezier[0] - bezier[1]) < 1e-6,
        inLinear: Math.abs(bezier[2] - bezier[3]) < 1e-6,
        outSpeed: y1 / x1 * rate,
        outInfluence: Math.min(100, Math.max(0.1, x1 * 100)),
        inSpeed: (1 - y2) / (1 - x2) * rate,
        inInfluence: Math.min(100, Math.max(0.1, (1 - x2) * 100)),
        clamped: false
    };
    if (spatial && result.outSpeed < 0) { result.outSpeed = 0; result.clamped = true; }
    if (spatial && result.inSpeed < 0) { result.inSpeed = 0; result.clamped = true; }
    return result;
};

// The inverse, for reading the curve a segment currently has.
AEAgent._segmentBezier = function (outEase, inEase, duration, delta) {
    var rate = duration > 0 ? delta / duration : 0;
    var x1 = outEase.influence / 100, x2 = 1 - inEase.influence / 100;
    if (Math.abs(rate) < 1e-9) { return null; }
    return [x1, outEase.speed * x1 / rate, x2, 1 - inEase.speed * (1 - x2) / rate];
};

AEAgent._isSpatial = function (property) {
    return typeof PropertyValueType !== "undefined" && (property.propertyValueType === PropertyValueType.TwoD_SPATIAL || property.propertyValueType === PropertyValueType.ThreeD_SPATIAL);
};

// Per-dimension value change across a segment. Properties with a single ease
// dimension but an array value (spatial, color) use the straight distance.
AEAgent._segmentDeltas = function (property, a, b, dimensions) {
    var v0 = property.keyValue(a), v1 = property.keyValue(b), deltas = [], i;
    if (typeof v0 === "number" && typeof v1 === "number") { return [v1 - v0]; }
    if (!(v0 instanceof Array) || !(v1 instanceof Array)) { return null; }
    if (dimensions > 1) {
        for (i = 0; i < dimensions; i += 1) { deltas.push(Number(v1[i] || 0) - Number(v0[i] || 0)); }
        return deltas;
    }
    var sum = 0;
    for (i = 0; i < Math.min(v0.length, v1.length); i += 1) { sum += Math.pow(Number(v1[i]) - Number(v0[i]), 2); }
    return [Math.sqrt(sum)];
};

AEAgent._easeArray = function (eases) {
    var copy = [];
    for (var i = 0; i < eases.length; i += 1) { copy.push(new KeyframeEase(eases[i].speed, eases[i].influence)); }
    return copy;
};

// Segments between consecutive listed keys; a single key eases both of its sides.
AEAgent._easeSegments = function (property, keys) {
    var sorted = keys.slice().sort(function (x, y) { return x - y; }), segments = [], i;
    if (sorted.length === 1) {
        if (sorted[0] > 1) { segments.push([sorted[0] - 1, sorted[0]]); }
        if (sorted[0] < property.numKeys) { segments.push([sorted[0], sorted[0] + 1]); }
        return segments;
    }
    for (i = 0; i + 1 < sorted.length; i += 1) {
        if (sorted[i + 1] !== sorted[i]) { segments.push([sorted[i], sorted[i + 1]]); }
    }
    return segments;
};

AEAgent._applyEaseToProperty = function (property, keys, bezier) {
    var segments = AEAgent._easeSegments(property, keys);
    if (!segments.length) { throw new Error("“" + property.name + "” needs at least two keyframes to ease between."); }
    var spatial = AEAgent._isSpatial(property), approximate = false, clamped = false, report = [];
    var BEZIER = KeyframeInterpolationType.BEZIER, LINEAR = KeyframeInterpolationType.LINEAR;
    for (var s = 0; s < segments.length; s += 1) {
        var a = segments[s][0], b = segments[s][1];
        var duration = property.keyTime(b) - property.keyTime(a);
        var outEase = property.keyOutTemporalEase(a), inEase = property.keyInTemporalEase(b);
        var deltas = AEAgent._segmentDeltas(property, a, b, outEase.length);
        if (!deltas) { deltas = []; for (var z = 0; z < outEase.length; z += 1) { deltas.push(0); } if (Math.abs(bezier[1]) > 1e-6 || Math.abs(bezier[3] - 1) > 1e-6) { approximate = true; } }
        var shape = AEAgent._easeSegment(bezier, duration, 1, spatial);
        // Interpolation first: switching a side to linear resets its ease.
        property.setInterpolationTypeAtKey(a, property.keyInInterpolationType(a), shape.outLinear ? LINEAR : BEZIER);
        property.setInterpolationTypeAtKey(b, shape.inLinear ? LINEAR : BEZIER, property.keyOutInterpolationType(b));
        try { property.setTemporalContinuousAtKey(a, false); property.setTemporalAutoBezierAtKey(a, false); } catch (e1) { /* not every property supports it */ }
        try { property.setTemporalContinuousAtKey(b, false); property.setTemporalAutoBezierAtKey(b, false); } catch (e2) { /* not every property supports it */ }
        var newOut = [], newIn = [];
        for (var d = 0; d < outEase.length; d += 1) {
            var ease = AEAgent._easeSegment(bezier, duration, deltas[d] || 0, spatial);
            if (ease.clamped) { clamped = true; }
            newOut.push(new KeyframeEase(ease.outSpeed, ease.outInfluence));
            newIn.push(new KeyframeEase(ease.inSpeed, ease.inInfluence));
        }
        if (!shape.outLinear) { property.setTemporalEaseAtKey(a, AEAgent._easeArray(property.keyInTemporalEase(a)), newOut); }
        if (!shape.inLinear) { property.setTemporalEaseAtKey(b, newIn, AEAgent._easeArray(property.keyOutTemporalEase(b))); }
        report.push({ fromKey: a, toKey: b, fromTime: property.keyTime(a), toTime: property.keyTime(b) });
    }
    return { property: property.name, segments: report, approximate: approximate, overshootClampedForSpatial: clamped };
};

AEAgent._layerOf = function (property) {
    return property.propertyGroup(property.propertyDepth);
};

// Properties to ease: the timeline's selected keyframes, or one property by path.
AEAgent._easeTargets = function (args) {
    var comp = AEAgent._activeComp(), targets = [], i, k;
    if (args.useSelectedKeys === true) {
        var selected = comp.selectedProperties;
        for (i = 0; i < selected.length; i += 1) {
            if (selected[i].propertyType === PropertyType.PROPERTY && selected[i].numKeys > 0 && selected[i].selectedKeys.length > 0) {
                targets.push({ property: selected[i], keys: selected[i].selectedKeys.slice(0) });
            }
        }
        if (!targets.length) { throw new Error("No keyframes are selected in the timeline. Select keyframes, or pass layerId and propertyPath."); }
        return targets;
    }
    var layer = AEAgent._findLayer(comp, args);
    var property = AEAgent._resolveProperty(layer, args.propertyPath);
    var keys = [];
    if (args.keyIndices instanceof Array && args.keyIndices.length) {
        for (k = 0; k < args.keyIndices.length; k += 1) {
            var index = Math.round(Number(args.keyIndices[k]));
            if (index < 1 || index > property.numKeys) { throw new Error("Keyframe index " + index + " does not exist on “" + property.name + "”."); }
            keys.push(index);
        }
    } else {
        for (k = 1; k <= property.numKeys; k += 1) { keys.push(k); }
    }
    targets.push({ property: property, keys: keys });
    return targets;
};

AEAgent.apply_ease_curve = function (args) {
    var bezier = args.bezier;
    if (!(bezier instanceof Array) || bezier.length !== 4) { throw new Error("A cubic-bezier [x1, y1, x2, y2] or a preset is required."); }
    for (var b = 0; b < 4; b += 1) { bezier[b] = Number(bezier[b]); if (isNaN(bezier[b])) { throw new Error("The cubic-bezier values must be numbers."); } }
    if (bezier[0] < 0 || bezier[0] > 1 || bezier[2] < 0 || bezier[2] > 1) { throw new Error("cubic-bezier x values must be between 0 and 1."); }
    var targets = AEAgent._easeTargets(args), results = [];
    for (var i = 0; i < targets.length; i += 1) {
        var layer = AEAgent._layerOf(targets[i].property);
        if (layer.locked) { throw new Error("Unlock “" + layer.name + "” before changing its easing."); }
        var result = AEAgent._applyEaseToProperty(targets[i].property, targets[i].keys, bezier);
        result.layer = layer.name;
        result.layerId = layer.id;
        results.push(result);
    }
    return { bezier: bezier, properties: results };
};

AEAgent.get_ease_curves = function (args) {
    var targets = AEAgent._easeTargets(args), results = [];
    for (var i = 0; i < targets.length; i += 1) {
        var property = targets[i].property, segments = [];
        var pairs = AEAgent._easeSegments(property, targets[i].keys);
        for (var s = 0; s < pairs.length; s += 1) {
            var a = pairs[s][0], c = pairs[s][1], duration = property.keyTime(c) - property.keyTime(a);
            var outType = property.keyOutInterpolationType(a), inType = property.keyInInterpolationType(c);
            var entry = { fromKey: a, toKey: c, fromTime: property.keyTime(a), toTime: property.keyTime(c), outInterpolation: String(outType), inInterpolation: String(inType) };
            if (outType === KeyframeInterpolationType.HOLD) { entry.hold = true; segments.push(entry); continue; }
            var outEase = property.keyOutTemporalEase(a), inEase = property.keyInTemporalEase(c);
            var deltas = AEAgent._segmentDeltas(property, a, c, outEase.length) || [];
            entry.dimensions = [];
            for (var d = 0; d < outEase.length; d += 1) {
                var curve = outType === KeyframeInterpolationType.LINEAR && inType === KeyframeInterpolationType.LINEAR ? [0, 0, 1, 1] : AEAgent._segmentBezier(outEase[d], inEase[d], duration, deltas[d] || 0);
                if (curve && outType === KeyframeInterpolationType.LINEAR) { curve[0] = 0; curve[1] = 0; }
                if (curve && inType === KeyframeInterpolationType.LINEAR) { curve[2] = 1; curve[3] = 1; }
                entry.dimensions.push({
                    cubicBezier: curve ? [Math.round(curve[0] * 1000) / 1000, Math.round(curve[1] * 1000) / 1000, Math.round(curve[2] * 1000) / 1000, Math.round(curve[3] * 1000) / 1000] : null,
                    outSpeed: outEase[d].speed, outInfluence: outEase[d].influence, inSpeed: inEase[d].speed, inInfluence: inEase[d].influence
                });
            }
            segments.push(entry);
        }
        var layer = AEAgent._layerOf(property);
        results.push({ layer: layer.name, layerId: layer.id, property: property.name, segments: segments });
    }
    return { properties: results };
};

AEAgent.configure_motion_graphics_template = function (args) {
    var comp = AEAgent._activeComp();
    var name = String(args.templateName || "");
    if (!name) {
        throw new Error("A Motion Graphics template name is required.");
    }
    comp.motionGraphicsTemplateName = name;
    var opened = false;
    if (args.openPanel !== false && typeof comp.openInEssentialGraphics === "function") {
        opened = comp.openInEssentialGraphics();
    }
    return {
        compId: comp.id,
        compName: comp.name,
        templateName: comp.motionGraphicsTemplateName,
        essentialGraphicsOpened: opened
    };
};

AEAgent.add_property_to_essential_graphics = function (args) {
    var comp = AEAgent._activeComp();
    var layer = AEAgent._findLayer(comp, args);
    if (layer.locked) {
        throw new Error("Unlock “" + layer.name + "” before adding an Essential Graphics control.");
    }
    var property = AEAgent._resolveProperty(layer, args.propertyPath);
    if (!property.canAddToMotionGraphicsTemplate(comp)) {
        throw new Error("“" + property.name + "” cannot be added to this Motion Graphics template.");
    }
    var displayName = String(args.displayName || property.name);
    var added;
    if (typeof property.addToMotionGraphicsTemplateAs === "function") {
        added = property.addToMotionGraphicsTemplateAs(comp, displayName);
    } else {
        added = property.addToMotionGraphicsTemplate(comp);
    }
    if (added === false) {
        throw new Error("After Effects did not add “" + property.name + "” to Essential Graphics.");
    }
    return {
        added: true,
        displayName: displayName,
        property: AEAgent._propertySummary(property),
        templateName: comp.motionGraphicsTemplateName
    };
};

AEAgent.export_motion_graphics_template = function (args) {
    var comp = AEAgent._activeComp();
    if (!app.project.file) {
        throw new Error("Save the After Effects project before exporting a Motion Graphics template.");
    }
    if (app.project.dirty) {
        throw new Error("Save the latest project changes before exporting the Motion Graphics template.");
    }
    var name = String(args.templateName || "");
    if (!name || /[\\\/:*?\"<>|]/.test(name)) {
        throw new Error("Use a template name without file-path characters.");
    }
    var folder = new Folder(String(args.outputFolder || ""));
    if (!folder.exists) {
        throw new Error("The output folder does not exist: " + folder.fsName);
    }
    var destination = new File(folder.fsName + "/" + name + ".mogrt");
    if (destination.exists) {
        throw new Error("A template already exists at “" + destination.fsName + "”. Choose a new name; AE Agent will not overwrite it.");
    }
    comp.motionGraphicsTemplateName = name;
    var exported = comp.exportAsMotionGraphicsTemplate(false, folder.fsName);
    if (!exported) {
        throw new Error("After Effects did not export the Motion Graphics template.");
    }
    return { exported: true, path: destination.fsName, templateName: name };
};

AEAgent.invoke = function (encodedPayload) {
    var payload;
    var mutating = {
        create_text_layer: true,
        create_shape_layer: true,
        rename_composition: true,
        set_layer_transform: true,
        rename_layer: true,
        remove_layer: true,
        move_layer: true,
        duplicate_layer: true,
        duplicate_composition: true,
        set_layer_attributes: true,
        precompose_layers: true,
        set_parent: true,
        set_track_matte: true,
        create_control_layer: true,
        remove_keyframes: true,
        set_keyframe_easing: true,
        apply_ease_curve: true,
        set_property_value: true,
        set_expression: true,
        set_keyframes: true,
        add_effect: true,
        create_expression_control: true,
        execute_script: true,
        configure_motion_graphics_template: true,
        add_property_to_essential_graphics: true
    };
    var undoOpen = false;
    var beforeRevision = AEAgent._revision();
    var beforeProject = app.project;
    try {
        payload = AEAgent._parse(decodeURIComponent(encodedPayload));
        if (!payload || !payload.tool || typeof AEAgent[payload.tool] !== "function" || payload.tool.charAt(0) === "_") {
            throw new Error("Unknown After Effects tool.");
        }
        if (mutating[payload.tool]) {
            var last = AEAgent._undoRecords.length ? AEAgent._undoRecords[AEAgent._undoRecords.length - 1] : null;
            if (last && (last.project !== beforeProject || last.revision !== beforeRevision)) { AEAgent._undoRecords = []; }
            app.beginUndoGroup("AE Agent: " + payload.tool.replace(/_/g, " "));
            undoOpen = true;
        }
        var data = AEAgent[payload.tool](payload.args || {});
        if (undoOpen) { app.endUndoGroup(); undoOpen = false; }
        var undoable = !!mutating[payload.tool] && beforeRevision !== null && beforeProject === app.project && AEAgent._revision() !== beforeRevision;
        if (undoable) { AEAgent._undoRecords.push({ project: app.project, revision: AEAgent._revision() }); }
        return AEAgent._result(true, data, null, undoable);
    } catch (error) {
        if (undoOpen) {
            try {
                app.endUndoGroup();
                undoOpen = false;
                if (beforeRevision !== null && beforeProject === app.project && AEAgent._revision() !== beforeRevision) {
                    app.executeCommand(16);
                    if (AEAgent._undoRecords.length) { AEAgent._undoRecords[AEAgent._undoRecords.length - 1].revision = AEAgent._revision(); }
                }
            } catch (rollbackError) {
                // Preserve the original tool error. After Effects will retain its normal Undo history.
            }
        }
        return AEAgent._result(false, null, error.toString());
    } finally {
        if (undoOpen) {
            app.endUndoGroup();
        }
    }
};
