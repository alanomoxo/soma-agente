// Illustrator profile: tools, instructions and UI copy for the Soma panel.
(function () {
  "use strict";
  var H = window.SomaHosts;
  var T = H.tool;
  var num = { type: "number" };
  var hex = { type: "string", description: "Hex color such as #E70E77, or \"none\"." };
  var uuid = { type: "string", description: "Item uuid from list_items or document_overview." };

  H.register({
    id: "illustrator",
    appCodes: ["ILST"],
    name: "Illustrator",
    namespace: "illustrator",
    description: "Inspect and modify the active Adobe Illustrator document.",
    features: { eases: false, undo: true },
    welcome: "Describe the artwork, speak it with the microphone, or attach references. I’ll inspect the open document, draw or edit it in Illustrator, and check the result.",
    suggestions: [
      "List what is on this artboard",
      "Draw a centered pink circle with a white title on top",
      "Create a 1080×1350 artboard for an Instagram post",
      "Recreate the layout of the attached reference"
    ],
    instructions: [
      "You are Soma Agente, embedded inside Adobe Illustrator. Use the illustrator MCP tools to do the user's requested work directly in the open document.",
      "Positions and sizes are in points, with x and y measured from the top-left corner of the active artboard and y pointing down. Items are addressed by uuid. Inspect document_overview and list_items before editing unless the current turn already has fresh results.",
      "After visual changes, call preview_artboard and look at the image before declaring success.",
      "Fonts use PostScript names (for example Inter-Bold, ArialMT); when unsure, read app.textFonts with execute_script.",
      "undo_last_action runs Illustrator's Edit > Undo once; a tool that made several changes may need several undos.",
      "execute_script runs Illustrator ExtendScript (app, app.activeDocument). Note that Illustrator's own coordinates have y pointing up. Return a small JSON-safe value. Do not save, close, or overwrite files unless the user asked for that exact side effect."
    ].concat(H.commonInstructions("Illustrator")),
    tools: [
      T("document_overview", "Open documents and the active document's color space, artboards, layers and selection.", {}),
      T("list_items", "Items on the document (optionally one layer), front to back, with uuid, type, name, bounds (artboard coordinates), fill/stroke and text.", { layer: { type: "string" }, maxDepth: { type: "integer", minimum: 0, maximum: 8 }, limit: { type: "integer", minimum: 1, maximum: 1000 } }),
      T("create_document", "Create a new document with one artboard.", { width: num, height: num, colorSpace: { type: "string", enum: ["RGB", "CMYK"] }, name: { type: "string" } }, ["width", "height"]),
      T("add_artboard", "Add an artboard to the right of the last one and make it active.", { width: num, height: num, gap: num, name: { type: "string" } }),
      T("create_shape", "Draw a rectangle (optional cornerRadius), ellipse, polygon, star or line. x/y is the top-left of its box; a line goes from x,y to x+width,y+height.", { shape: { type: "string", enum: ["rectangle", "ellipse", "polygon", "star", "line"] }, x: num, y: num, width: num, height: num, fill: hex, stroke: hex, strokeWidth: num, cornerRadius: num, sides: { type: "integer" }, points: { type: "integer" }, innerRatio: num, opacity: num, name: { type: "string" }, layer: { type: "string" } }, ["shape", "width", "height"]),
      T("create_text", "Add point text (top-left at x/y) or area text when width is given.", { text: { type: "string" }, x: num, y: num, size: num, font: { type: "string" }, color: hex, align: { type: "string", enum: ["left", "center", "right"] }, width: num, height: num, name: { type: "string" }, layer: { type: "string" } }, ["text"]),
      T("set_item_properties", "Move (x/y top-left or dx/dy), resize (width/height or scale percent), rotate, recolor, rename, hide/lock an item; for text also text, fontSize, font, color, tracking.", { uuid: uuid, x: num, y: num, dx: num, dy: num, width: num, height: num, scale: num, scaleStrokes: { type: "boolean" }, rotate: num, fill: hex, stroke: hex, strokeWidth: num, opacity: num, name: { type: "string" }, hidden: { type: "boolean" }, locked: { type: "boolean" }, text: { type: "string" }, fontSize: num, font: { type: "string" }, color: hex, tracking: num }, ["uuid"]),
      T("group_items", "Group items.", { uuids: { type: "array", items: { type: "string" }, minItems: 1 }, name: { type: "string" } }, ["uuids"]),
      T("ungroup_item", "Release a group's items.", { uuid: uuid }, ["uuid"]),
      T("delete_items", "Delete items.", { uuids: { type: "array", items: { type: "string" }, minItems: 1 } }, ["uuids"]),
      T("duplicate_item", "Duplicate an item, optionally offset by dx/dy.", { uuid: uuid, dx: num, dy: num, name: { type: "string" } }, ["uuid"]),
      T("arrange_item", "Change stacking order.", { uuid: uuid, order: { type: "string", enum: ["front", "back", "forward", "backward"] } }, ["uuid", "order"]),
      T("place_image", "Place an image or vector file (embedded by default); top-left at x/y, optionally scaled to width.", { path: { type: "string" }, x: num, y: num, width: num, embed: { type: "boolean" }, name: { type: "string" }, layer: { type: "string" } }, ["path"]),
      T("preview_artboard", "Export the artboard (default: active) as PNG and return it as an image for visual inspection.", { artboard: { type: "integer", minimum: 0 }, maxSize: { type: "integer", minimum: 256, maximum: 2000 }, reason: { type: "string" } }),
      T("execute_script", "General fallback: run Illustrator ExtendScript. Provide a user-facing summary and a function body that returns a small JSON-safe value.", { summary: { type: "string", minLength: 1 }, code: { type: "string", minLength: 1 } }, ["summary", "code"]),
      T("undo_last_action", "Run Illustrator's Edit > Undo once.", {})
    ],
    mutating: { create_shape: true, create_text: true, set_item_properties: true, group_items: true, ungroup_item: true, delete_items: true, duplicate_item: true, arrange_item: true, place_image: true, add_artboard: true, execute_script: true },
    presentation: function (tool, args) {
      var copy = {
        document_overview: ["Reading the document", "Checking artboards, layers, and the selection."],
        list_items: ["Mapping the artwork", "Reading items with their positions, colors, and text."],
        create_document: ["Creating a document", (args.width || "") + "×" + (args.height || "") + " pt."],
        add_artboard: ["Adding an artboard", "Creating “" + (args.name || "a new artboard") + "”."],
        create_shape: ["Drawing", "Adding a " + (args.shape || "shape") + "."],
        create_text: ["Adding text", "“" + String(args.text || "").slice(0, 40) + "”"],
        set_item_properties: ["Adjusting an item", "Updating its position, size, or style."],
        group_items: ["Grouping", "Grouping " + ((args.uuids || []).length) + " items."],
        ungroup_item: ["Ungrouping", "Releasing the group's items."],
        delete_items: ["Removing items", "Deleting the items that are no longer needed."],
        duplicate_item: ["Duplicating", "Copying an item."],
        arrange_item: ["Reordering", "Moving an item " + (args.order || "") + "."],
        place_image: ["Placing a file", "Adding the file to the artboard."],
        preview_artboard: ["Checking the result", args.reason || "Exporting a preview to inspect visually."],
        execute_script: ["Applying a custom Illustrator operation", args.summary || "Running ExtendScript."],
        undo_last_action: ["Undoing", "Reverting the last change."]
      };
      if (window.SomaI18n.lang !== "pt") { return copy[tool]; }
      var pt = {
        document_overview: ["Lendo o documento", "Conferindo pranchetas, camadas e seleção."],
        list_items: ["Mapeando a arte", "Lendo os itens com posição, cores e texto."],
        create_document: ["Criando um documento", (args.width || "") + "×" + (args.height || "") + " pt."],
        add_artboard: ["Adicionando uma prancheta", "Criando “" + (args.name || "uma nova prancheta") + "”."],
        create_shape: ["Desenhando", "Adicionando uma forma (" + (args.shape || "forma") + ")."],
        create_text: ["Adicionando texto", "“" + String(args.text || "").slice(0, 40) + "”"],
        set_item_properties: ["Ajustando um item", "Atualizando posição, tamanho ou estilo."],
        group_items: ["Agrupando", "Agrupando " + ((args.uuids || []).length) + " itens."],
        ungroup_item: ["Desagrupando", "Soltando os itens do grupo."],
        delete_items: ["Removendo itens", "Apagando os itens que não são mais necessários."],
        duplicate_item: ["Duplicando", "Copiando um item."],
        arrange_item: ["Reorganizando", "Movendo um item (" + (args.order || "") + ")."],
        place_image: ["Colocando um arquivo", "Adicionando o arquivo na prancheta."],
        preview_artboard: ["Conferindo o resultado", args.reason || "Exportando uma prévia para conferir."],
        execute_script: ["Aplicando uma operação personalizada no Illustrator", args.summary || "Executando ExtendScript."],
        undo_last_action: ["Desfazendo", "Voltando a última mudança."]
      };
      return pt[tool];
    }
  });
}());
