// Photoshop profile: tools, instructions and UI copy for the Soma panel.
(function () {
  "use strict";
  var H = window.SomaHosts;
  var T = H.tool;
  var layerRef = {
    layerId: { type: "integer", description: "Layer id from list_layers. Omit both layerId and layerName to use the active layer." },
    layerName: { type: "string", description: "Exact layer name, when the id is unknown." }
  };
  function withLayer(extra) {
    var props = { layerId: layerRef.layerId, layerName: layerRef.layerName };
    for (var key in extra) { if (extra.hasOwnProperty(key)) { props[key] = extra[key]; } }
    return props;
  }
  var hex = { type: "string", description: "Hex color such as #E70E77." };
  var num = { type: "number" };

  H.register({
    id: "photoshop",
    appCodes: ["PHXS", "PHSP"],
    name: "Photoshop",
    namespace: "photoshop",
    description: "Inspect and modify the active Adobe Photoshop document.",
    features: { eases: false, undo: true },
    welcome: "Describe an edit, speak it with the microphone, or attach images and references. I’ll inspect the open document, make the change in Photoshop, and check the result.",
    suggestions: [
      "List the layers in this document",
      "Create a 1080×1080 post with a pink background and a centered title",
      "Place the attached image and fit it to the canvas",
      "Recreate the layout of the attached reference"
    ],
    instructions: [
      "You are Soma Agente, embedded inside Adobe Photoshop. Use the photoshop MCP tools to do the user's requested work directly in the open document.",
      "All positions and sizes are in pixels, with x and y measured from the top-left corner of the canvas. Inspect document_overview and list_layers before editing unless the current turn already has fresh results; refer to layers by id.",
      "Each editing tool is one Photoshop History state, so the user can undo it. undo_last_action steps History back one state.",
      "After visual changes, call preview_document and look at the image before declaring success.",
      "Text sizes are in pixels. Fonts use PostScript names (for example Inter-Bold, ArialMT); when unsure, read app.fonts with execute_script.",
      "execute_script runs Photoshop ExtendScript (app, activeDocument, Action Manager via executeAction). Return a small JSON-safe value. Do not save, close, or overwrite files unless the user asked for that exact side effect."
    ].concat(H.commonInstructions("Photoshop")),
    tools: [
      T("document_overview", "Open documents and the active document's size, resolution, mode and active layer.", {}),
      T("list_layers", "Layer tree of the active document, top to bottom, with ids, kinds, visibility, opacity, blend mode, bounds and text contents.", { maxDepth: { type: "integer", minimum: 0, maximum: 10 } }),
      T("create_document", "Create a new RGB document.", { width: num, height: num, resolution: num, name: { type: "string" }, fill: { type: "string", enum: ["white", "transparent", "background"] } }, ["width", "height"]),
      T("create_text_layer", "Add a text layer. x/y is the text baseline start (point text) or the top-left of the box when boxWidth is set.", { text: { type: "string" }, x: num, y: num, size: num, font: { type: "string" }, color: hex, align: { type: "string", enum: ["left", "center", "right"] }, boxWidth: num, boxHeight: num, name: { type: "string" } }, ["text"]),
      T("create_shape_layer", "Add a vector rectangle or ellipse shape layer filled with a color.", { shape: { type: "string", enum: ["rectangle", "ellipse"] }, x: num, y: num, width: num, height: num, color: hex, cornerRadius: num, name: { type: "string" } }, ["width", "height"]),
      T("set_layer_properties", "Rename, show/hide, lock, set opacity/fill/blend mode, or move a layer (x/y = new top-left, or dx/dy).", withLayer({ newName: { type: "string" }, visible: { type: "boolean" }, locked: { type: "boolean" }, opacity: num, fillOpacity: num, blendMode: { type: "string", description: "Photoshop blend mode such as NORMAL, MULTIPLY, SCREEN, OVERLAY, SOFTLIGHT." }, x: num, y: num, dx: num, dy: num })),
      T("transform_layer", "Scale (percent or to a target width/height in pixels) and/or rotate a layer around an anchor.", withLayer({ scale: num, scaleX: num, scaleY: num, width: num, height: num, rotate: num, anchor: { type: "string", enum: ["center", "topleft", "topright", "bottomleft", "bottomright", "top", "bottom", "left", "right"] } })),
      T("set_text", "Change a text layer's contents, size, font, color, tracking or leading.", withLayer({ text: { type: "string" }, size: num, font: { type: "string" }, color: hex, tracking: num, leading: num })),
      T("duplicate_layer", "Duplicate a layer.", withLayer({ newName: { type: "string" } })),
      T("delete_layers", "Delete layers by id.", { layerIds: { type: "array", items: { type: "integer" }, minItems: 1 } }, ["layerIds"]),
      T("arrange_layer", "Move a layer to the front/back of its group, or above/below another layer.", withLayer({ order: { type: "string", enum: ["front", "back"] }, relativeToLayerId: { type: "integer" }, placement: { type: "string", enum: ["above", "below"] } })),
      T("group_layers", "Put layers into a new group.", { layerIds: { type: "array", items: { type: "integer" }, minItems: 1 }, name: { type: "string" } }, ["layerIds"]),
      T("place_image", "Place an image file as a smart object layer; optionally move its top-left to x/y.", { path: { type: "string" }, x: num, y: num, name: { type: "string" } }, ["path"]),
      T("fill_layer", "Add a new layer filled with a solid color (optionally sent to the back as a background).", { color: hex, name: { type: "string" }, toBack: { type: "boolean" } }, ["color"]),
      T("add_adjustment_layer", "Add an adjustment layer: brightnessContrast (with brightness/contrast), hueSaturation, levels, curves, vibrance, blackAndWhite, exposure or invert.", { type: { type: "string", enum: ["brightnessContrast", "hueSaturation", "levels", "curves", "vibrance", "blackAndWhite", "exposure", "invert"] }, brightness: num, contrast: num, name: { type: "string" } }, ["type"]),
      T("resize_document", "Resize the image (resample) or, with canvas: true, the canvas around the center.", { width: num, height: num, canvas: { type: "boolean" } }),
      T("preview_document", "Render a flattened PNG preview of the active document (longest side up to maxSize) and return it as an image for visual inspection.", { maxSize: { type: "integer", minimum: 256, maximum: 2000 }, reason: { type: "string" } }),
      T("execute_script", "General fallback: run Photoshop ExtendScript. Provide a user-facing summary and a function body that returns a small JSON-safe value. Runs as one History state.", { summary: { type: "string", minLength: 1 }, code: { type: "string", minLength: 1 } }, ["summary", "code"]),
      T("undo_last_action", "Step Photoshop History back one state (reverts the last tool).", {})
    ],
    mutating: { create_text_layer: true, create_shape_layer: true, set_layer_properties: true, transform_layer: true, set_text: true, duplicate_layer: true, delete_layers: true, arrange_layer: true, group_layers: true, place_image: true, fill_layer: true, add_adjustment_layer: true, execute_script: true, resize_document: true },
    presentation: function (tool, args) {
      var target = args.layerId !== undefined ? "layer " + args.layerId : (args.layerName ? "“" + args.layerName + "”" : "the active layer");
      var copy = {
        document_overview: ["Reading the document", "Checking size, resolution, mode, and the active layer."],
        list_layers: ["Mapping the layers", "Reading every layer with its position, visibility, and text."],
        create_document: ["Creating a document", (args.width || "") + "×" + (args.height || "") + " px."],
        create_text_layer: ["Adding text", "“" + String(args.text || "").slice(0, 40) + "”"],
        create_shape_layer: ["Drawing a shape", "Adding a " + (args.shape || "rectangle") + " shape layer."],
        set_layer_properties: ["Adjusting a layer", "Updating " + target + "."],
        transform_layer: ["Transforming a layer", "Scaling or rotating " + target + "."],
        set_text: ["Editing text", "Updating " + target + "."],
        duplicate_layer: ["Duplicating a layer", "Copying " + target + "."],
        delete_layers: ["Removing layers", "Deleting the layers that are no longer needed."],
        arrange_layer: ["Reordering layers", "Moving " + target + " in the stack."],
        group_layers: ["Grouping layers", "Creating “" + (args.name || "Group") + "”."],
        place_image: ["Placing an image", "Adding the file as a smart object."],
        fill_layer: ["Adding a color fill", "Filling a new layer with " + (args.color || "a color") + "."],
        add_adjustment_layer: ["Adding an adjustment", "Creating a " + (args.type || "") + " adjustment layer."],
        resize_document: ["Resizing", args.canvas ? "Changing the canvas size." : "Resampling the image."],
        preview_document: ["Checking the result", args.reason || "Rendering a preview to inspect visually."],
        execute_script: ["Applying a custom Photoshop operation", args.summary || "Running ExtendScript."],
        undo_last_action: ["Undoing", "Stepping History back one state."]
      };
      if (window.SomaI18n.lang !== "pt") { return copy[tool]; }
      var alvo = args.layerId !== undefined ? "a camada " + args.layerId : (args.layerName ? "“" + args.layerName + "”" : "a camada ativa");
      var pt = {
        document_overview: ["Lendo o documento", "Conferindo tamanho, resolução, modo e camada ativa."],
        list_layers: ["Mapeando as camadas", "Lendo cada camada com posição, visibilidade e texto."],
        create_document: ["Criando um documento", (args.width || "") + "×" + (args.height || "") + " px."],
        create_text_layer: ["Adicionando texto", "“" + String(args.text || "").slice(0, 40) + "”"],
        create_shape_layer: ["Desenhando uma forma", "Adicionando uma camada de forma (" + (args.shape || "retângulo") + ")."],
        set_layer_properties: ["Ajustando uma camada", "Atualizando " + alvo + "."],
        transform_layer: ["Transformando uma camada", "Escalando ou girando " + alvo + "."],
        set_text: ["Editando texto", "Atualizando " + alvo + "."],
        duplicate_layer: ["Duplicando uma camada", "Copiando " + alvo + "."],
        delete_layers: ["Removendo camadas", "Apagando as camadas que não são mais necessárias."],
        arrange_layer: ["Reorganizando camadas", "Movendo " + alvo + " na pilha."],
        group_layers: ["Agrupando camadas", "Criando “" + (args.name || "Grupo") + "”."],
        place_image: ["Colocando uma imagem", "Adicionando o arquivo como objeto inteligente."],
        fill_layer: ["Adicionando um preenchimento", "Preenchendo uma nova camada com " + (args.color || "uma cor") + "."],
        add_adjustment_layer: ["Adicionando um ajuste", "Criando uma camada de ajuste " + (args.type || "") + "."],
        resize_document: ["Redimensionando", args.canvas ? "Mudando o tamanho do canvas." : "Reamostrando a imagem."],
        preview_document: ["Conferindo o resultado", args.reason || "Gerando uma prévia para conferir."],
        execute_script: ["Aplicando uma operação personalizada no Photoshop", args.summary || "Executando ExtendScript."],
        undo_last_action: ["Desfazendo", "Voltando um estado no Histórico."]
      };
      return pt[tool];
    }
  });
}());
