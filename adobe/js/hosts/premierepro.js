// Premiere Pro profile: tools, instructions and UI copy for the Soma panel.
(function () {
  "use strict";
  var H = window.SomaHosts;
  var T = H.tool;
  var num = { type: "number" };
  var clipRef = {
    track: { type: "string", description: "Track name like V1 or A2." },
    clip: { type: "integer", minimum: 0, description: "Clip index on that track, from list_timeline." }
  };
  function withClip(extra) {
    var props = { track: clipRef.track, clip: clipRef.clip };
    for (var key in extra) { if (extra.hasOwnProperty(key)) { props[key] = extra[key]; } }
    return props;
  }
  var item = {
    nodeId: { type: "string", description: "Project item nodeId from list_project_items." },
    itemName: { type: "string", description: "Exact project item name, when the nodeId is unknown." }
  };

  H.register({
    id: "premierepro",
    appCodes: ["PPRO"],
    name: "Premiere Pro",
    namespace: "premiere_pro",
    description: "Inspect and edit the open Adobe Premiere Pro project and active sequence.",
    features: { eases: false, undo: false },
    welcome: "Describe the edit, speak it with the microphone, or attach references. I’ll inspect the active sequence, make the change in Premiere Pro, and check the frames.",
    suggestions: [
      "List the clips on the timeline",
      "Add a cross dissolve between every clip on V1",
      "Import the attached files and put them on the timeline in order",
      "Add a marker at every cut"
    ],
    instructions: [
      "You are Soma Agente, embedded inside Adobe Premiere Pro. Use the premiere_pro MCP tools to do the user's requested work directly in the open project and active sequence.",
      "Times are in seconds on the sequence timeline. Timeline clips are addressed by track (V1, A1, …) and clip index from list_timeline; indexes change after edits, so list the timeline again before the next edit.",
      "Inspect project_overview and list_timeline before editing unless the current turn already has fresh results. Project items are addressed by nodeId from list_project_items.",
      "Motion Position values are normalized: [0.5, 0.5] is the frame center. Scale is a percent. Opacity is 0 to 100. Use get_clip_components to read exact component and property names before set_clip_property.",
      "After visual changes, call preview_frames at representative times and look at the images before declaring success.",
      "Premiere Pro has no scripted Undo; the user can undo with Ctrl+Z (Cmd+Z). Make careful, minimal changes and verify each step.",
      "execute_script runs Premiere Pro ExtendScript (app.project, app.project.activeSequence, and the QE DOM after app.enableQE()). Return a small JSON-safe value. Do not save, close, export media, or delete project items unless the user asked for that exact side effect."
    ].concat(H.commonInstructions("Premiere Pro")),
    tools: [
      T("project_overview", "Project name, sequences, and the active sequence's frame size, frame rate, duration, playhead and track counts.", {}),
      T("list_timeline", "Clips of the active sequence by track with start, end, in/out points and media path.", { includeAudio: { type: "boolean" } }),
      T("list_project_items", "Project panel tree (bins, clips, sequences) with nodeIds and media paths.", { maxDepth: { type: "integer", minimum: 0, maximum: 10 } }),
      T("import_files", "Import media files into the project, optionally into a bin (created if missing).", { paths: { type: "array", items: { type: "string" }, minItems: 1 }, binName: { type: "string" } }, ["paths"]),
      T("add_clip_to_timeline", "Put a project item on a track at a time (default: playhead), overwriting by default or inserting.", { nodeId: item.nodeId, itemName: item.itemName, track: clipRef.track, time: num, mode: { type: "string", enum: ["overwrite", "insert"] } }),
      T("move_clip", "Move a clip to a new start time, or by a number of seconds.", withClip({ start: num, by: num }), ["track", "clip"]),
      T("trim_clip", "Change a clip's in point, out point, or end on the timeline.", withClip({ inPoint: num, outPoint: num, end: num }), ["track", "clip"]),
      T("remove_clip", "Remove a clip, optionally closing the gap (ripple).", withClip({ ripple: { type: "boolean" } }), ["track", "clip"]),
      T("set_clip_enabled", "Enable or disable a clip.", withClip({ enabled: { type: "boolean" } }), ["track", "clip", "enabled"]),
      T("rename_clip", "Rename a clip on the timeline.", withClip({ name: { type: "string" } }), ["track", "clip", "name"]),
      T("get_clip_components", "A clip's effects (components) and their properties with current values.", withClip({}), ["track", "clip"]),
      T("set_clip_property", "Set a component property (e.g. Motion > Scale, Opacity > Opacity) to a value, or animate it with keyframes at timeline times.", withClip({ component: { type: "string", description: "Component name as shown by get_clip_components, its matchName, or the English name Motion / Opacity / Time Remapping / Volume." }, property: { type: "string", description: "Property name (localized or English for the built-in components)." }, propertyIndex: { type: "integer", description: "Property index from get_clip_components; overrides property." }, value: {}, keyframes: { type: "array", items: { type: "object", properties: { time: num, value: {} }, required: ["time", "value"] } }, removeKeyframes: { type: "boolean" } }), ["track", "clip", "component"]),
      T("add_video_effect", "Apply a video effect by its English name (e.g. Gaussian Blur, Lumetri Color, Crop).", withClip({ effectName: { type: "string" } }), ["track", "clip", "effectName"]),
      T("add_transition", "Add a transition at the start or end of a clip (video: Cross Dissolve by default; audio: Constant Power).", withClip({ transitionName: { type: "string" }, at: { type: "string", enum: ["start", "end"] }, duration: num }), ["track", "clip"]),
      T("add_marker", "Add a sequence marker.", { time: num, name: { type: "string" }, comments: { type: "string" }, duration: num }, ["time"]),
      T("set_playhead", "Move the playhead.", { time: num }, ["time"]),
      T("create_sequence_from_clips", "Create a sequence from project items (in order) and open it.", { name: { type: "string" }, nodeIds: { type: "array", items: { type: "string" }, minItems: 1 } }, ["nodeIds"]),
      T("preview_frames", "Export frames of the active sequence at the given times (default: playhead) and return them as images for visual inspection.", { times: { type: "array", items: num, minItems: 1, maxItems: 8 }, reason: { type: "string" } }),
      T("execute_script", "General fallback: run Premiere Pro ExtendScript. Provide a user-facing summary and a function body that returns a small JSON-safe value.", { summary: { type: "string", minLength: 1 }, code: { type: "string", minLength: 1 } }, ["summary", "code"])
    ],
    mutating: {},
    presentation: function (tool, args) {
      var target = args.track ? args.track + " clip " + args.clip : "the clip";
      var copy = {
        project_overview: ["Reading the project", "Checking sequences, frame size, and frame rate."],
        list_timeline: ["Mapping the timeline", "Reading every clip with its timing."],
        list_project_items: ["Reading the Project panel", "Listing bins, clips, and sequences."],
        import_files: ["Importing media", "Adding " + ((args.paths || []).length) + " file(s) to the project."],
        add_clip_to_timeline: ["Editing the timeline", "Placing a clip on " + (args.track || "V1") + "."],
        move_clip: ["Moving a clip", "Repositioning " + target + "."],
        trim_clip: ["Trimming", "Adjusting " + target + "."],
        remove_clip: ["Removing a clip", "Deleting " + target + (args.ripple ? " and closing the gap." : ".")],
        set_clip_enabled: ["Updating a clip", (args.enabled ? "Enabling " : "Disabling ") + target + "."],
        rename_clip: ["Renaming a clip", "Naming " + target + " “" + (args.name || "") + "”."],
        get_clip_components: ["Inspecting effects", "Reading the effects on " + target + "."],
        set_clip_property: ["Adjusting " + (args.property || "a property"), (args.keyframes ? "Animating " : "Setting ") + (args.component || "") + " on " + target + "."],
        add_video_effect: ["Adding an effect", "Applying " + (args.effectName || "an effect") + " to " + target + "."],
        add_transition: ["Adding a transition", (args.transitionName || "Cross Dissolve") + " on " + target + "."],
        add_marker: ["Adding a marker", "At " + (args.time || 0) + " s."],
        set_playhead: ["Moving the playhead", "To " + (args.time || 0) + " s."],
        create_sequence_from_clips: ["Creating a sequence", "“" + (args.name || "Soma Sequence") + "”."],
        preview_frames: ["Checking the frames", args.reason || "Exporting frames to inspect visually."],
        execute_script: ["Applying a custom Premiere Pro operation", args.summary || "Running ExtendScript."]
      };
      if (window.SomaI18n.lang === "pt") {
        var alvo = args.track ? "o clipe " + args.clip + " da " + args.track : "o clipe";
        copy = {
          project_overview: ["Lendo o projeto", "Conferindo sequências, tamanho de quadro e frame rate."],
          list_timeline: ["Mapeando a timeline", "Lendo cada clipe com o seu tempo."],
          list_project_items: ["Lendo o painel Project", "Listando bins, clipes e sequências."],
          import_files: ["Importando mídia", "Adicionando " + ((args.paths || []).length) + " arquivo(s) ao projeto."],
          add_clip_to_timeline: ["Editando a timeline", "Colocando um clipe na " + (args.track || "V1") + "."],
          move_clip: ["Movendo um clipe", "Reposicionando " + alvo + "."],
          trim_clip: ["Aparando", "Ajustando " + alvo + "."],
          remove_clip: ["Removendo um clipe", "Apagando " + alvo + (args.ripple ? " e fechando o espaço." : ".")],
          set_clip_enabled: ["Atualizando um clipe", (args.enabled ? "Ativando " : "Desativando ") + alvo + "."],
          rename_clip: ["Renomeando um clipe", "Dando a " + alvo + " o nome “" + (args.name || "") + "”."],
          get_clip_components: ["Inspecionando efeitos", "Lendo os efeitos de " + alvo + "."],
          set_clip_property: ["Ajustando " + (args.property || "uma propriedade"), (args.keyframes ? "Animando " : "Definindo ") + (args.component || "") + " em " + alvo + "."],
          add_video_effect: ["Adicionando um efeito", "Aplicando " + (args.effectName || "um efeito") + " em " + alvo + "."],
          add_transition: ["Adicionando uma transição", (args.transitionName || "Cross Dissolve") + " em " + alvo + "."],
          add_marker: ["Adicionando um marcador", "Em " + (args.time || 0) + " s."],
          set_playhead: ["Movendo o indicador de reprodução", "Para " + (args.time || 0) + " s."],
          create_sequence_from_clips: ["Criando uma sequência", "“" + (args.name || "Soma Sequence") + "”."],
          preview_frames: ["Conferindo os quadros", args.reason || "Exportando quadros para conferir."],
          execute_script: ["Aplicando uma operação personalizada no Premiere Pro", args.summary || "Executando ExtendScript."]
        };
      }
      return copy[tool];
    }
  });
}());
