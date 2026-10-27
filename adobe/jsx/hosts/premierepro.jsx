/* Soma Agente bridge for Premiere Pro 2025+ (CEP). Times are in seconds.
   Timeline clips are addressed as { track: "V1" | "A2", clip: <index> }. */
$.evalFile(new File(new File($.fileName).parent.fsName + "/_common.jsx"));
AEAgent.host = "premierepro";
AEAgent.hostName = "Premiere Pro";

AEAgent._mutating = {
    import_files: true, add_clip_to_timeline: true, move_clip: true, trim_clip: true, remove_clip: true,
    set_clip_property: true, add_video_effect: true, add_transition: true, add_marker: true,
    create_sequence_from_clips: true, set_clip_enabled: true, rename_clip: true, execute_script: true
};

AEAgent._time = function (seconds) { var t = new Time(); t.seconds = Number(seconds); return t; };
AEAgent._sec = function (time) { try { return AEAgent._round(time.seconds, 3); } catch (e) { return null; } };

AEAgent._project = function () {
    if (!app.project) { throw new Error("No Premiere Pro project is open."); }
    return app.project;
};

AEAgent._sequence = function () {
    var seq = AEAgent._project().activeSequence;
    if (!seq) { throw new Error("No sequence is open in the Timeline. Open one, or create it with create_sequence_from_clips."); }
    return seq;
};

AEAgent._track = function (seq, name) {
    var m = /^([VA])(\d+)$/i.exec(String(name || ""));
    if (!m) { throw new Error("Tracks are named like V1 or A2."); }
    var list = m[1].toUpperCase() === "V" ? seq.videoTracks : seq.audioTracks;
    var index = Number(m[2]) - 1;
    if (index < 0 || index >= list.numTracks) { throw new Error("Track " + name + " does not exist (the sequence has " + list.numTracks + ")."); }
    return list[index];
};

AEAgent._clip = function (args) {
    var seq = AEAgent._sequence();
    var track = AEAgent._track(seq, args.track);
    var index = Number(args.clip);
    if (!(index >= 0 && index < track.clips.numItems)) { throw new Error("Clip " + args.clip + " does not exist on " + args.track + ". Use list_timeline."); }
    return track.clips[index];
};

AEAgent._clipInfo = function (clip, index) {
    var info = { clip: index, name: clip.name, start: AEAgent._sec(clip.start), end: AEAgent._sec(clip.end), inPoint: AEAgent._sec(clip.inPoint), outPoint: AEAgent._sec(clip.outPoint) };
    try { info.duration = AEAgent._round(clip.end.seconds - clip.start.seconds, 3); } catch (e) { /* n/a */ }
    try { if (clip.disabled) { info.disabled = true; } } catch (e2) { /* n/a */ }
    try { if (clip.isSelected()) { info.selected = true; } } catch (e3) { /* n/a */ }
    try { info.mediaPath = clip.projectItem ? clip.projectItem.getMediaPath() : null; } catch (e4) { /* n/a */ }
    return info;
};

AEAgent._item = function (args) {
    var root = AEAgent._project().rootItem;
    var match = null;
    function walk(bin) {
        for (var i = 0; i < bin.children.numItems && !match; i += 1) {
            var child = bin.children[i];
            if ((args.nodeId && child.nodeId === String(args.nodeId)) || (!args.nodeId && args.itemName && child.name === String(args.itemName))) { match = child; return; }
            if (child.type === ProjectItemType.BIN) { walk(child); }
        }
    }
    walk(root);
    if (!match) { throw new Error("Project item not found: " + (args.nodeId || args.itemName) + ". Use list_project_items."); }
    return match;
};

AEAgent.project_overview = function () {
    var project = AEAgent._project();
    var sequences = [];
    for (var i = 0; i < project.sequences.numSequences; i += 1) {
        var s = project.sequences[i];
        sequences.push({ name: s.name, sequenceID: s.sequenceID, duration: AEAgent._round(Number(s.end) / 254016000000, 2) });
    }
    var active = null;
    var seq = project.activeSequence;
    if (seq) {
        var settings = seq.getSettings();
        var fps = null;
        try { fps = AEAgent._round(1 / settings.videoFrameRate.seconds, 3); } catch (e) { fps = null; }
        active = {
            name: seq.name,
            width: settings.videoFrameWidth,
            height: settings.videoFrameHeight,
            fps: fps,
            duration: AEAgent._round(Number(seq.end) / 254016000000, 2),
            playhead: AEAgent._sec(seq.getPlayerPosition()),
            videoTracks: seq.videoTracks.numTracks,
            audioTracks: seq.audioTracks.numTracks
        };
    }
    return { project: project.name, path: project.path, sequences: sequences, activeSequence: active };
};

AEAgent.list_timeline = function (args) {
    var seq = AEAgent._sequence();
    var tracks = [];
    function collect(list, prefix) {
        for (var t = 0; t < list.numTracks; t += 1) {
            var track = list[t];
            var clips = [];
            for (var c = 0; c < track.clips.numItems; c += 1) { clips.push(AEAgent._clipInfo(track.clips[c], c)); }
            var entry = { track: prefix + (t + 1), name: track.name, clips: clips };
            try { if (track.isMuted()) { entry.muted = true; } } catch (e) { /* n/a */ }
            tracks.push(entry);
        }
    }
    collect(seq.videoTracks, "V");
    if (args.includeAudio !== false) { collect(seq.audioTracks, "A"); }
    return { sequence: seq.name, tracks: tracks };
};

AEAgent.list_project_items = function (args) {
    var depth = args.maxDepth === undefined ? 4 : Number(args.maxDepth);
    var types = {}; types[ProjectItemType.CLIP] = "clip"; types[ProjectItemType.BIN] = "bin"; types[ProjectItemType.FILE] = "file"; types[ProjectItemType.ROOT] = "root";
    function walk(bin, level) {
        var out = [];
        for (var i = 0; i < bin.children.numItems; i += 1) {
            var child = bin.children[i];
            var info = { name: child.name, nodeId: child.nodeId, type: types[child.type] || String(child.type) };
            if (child.type === ProjectItemType.BIN) {
                if (level < depth) { info.children = walk(child, level + 1); } else { info.childCount = child.children.numItems; }
            } else {
                try { info.mediaPath = child.getMediaPath(); } catch (e) { /* n/a */ }
                try { if (child.isSequence()) { info.sequence = true; } } catch (e2) { /* n/a */ }
            }
            out.push(info);
        }
        return out;
    }
    return { items: walk(AEAgent._project().rootItem, 0) };
};

AEAgent.import_files = function (args) {
    var project = AEAgent._project();
    var paths = args.paths || [];
    for (var i = 0; i < paths.length; i += 1) { if (!new File(paths[i]).exists) { throw new Error("File not found: " + paths[i]); } }
    var bin = project.rootItem;
    if (args.binName) {
        bin = null;
        for (var b = 0; b < project.rootItem.children.numItems; b += 1) {
            var child = project.rootItem.children[b];
            if (child.type === ProjectItemType.BIN && child.name === args.binName) { bin = child; }
        }
        if (!bin) { bin = project.rootItem.createBin(String(args.binName)); }
    }
    var ok = project.importFiles(paths, true, bin, false);
    var imported = [];
    for (var j = 0; j < bin.children.numItems; j += 1) {
        var item = bin.children[j];
        try { for (var p = 0; p < paths.length; p += 1) { if (item.getMediaPath() && new File(item.getMediaPath()).fsName === new File(paths[p]).fsName) { imported.push({ name: item.name, nodeId: item.nodeId }); } } } catch (e) { /* bins */ }
    }
    return { imported: imported, ok: ok !== false };
};

AEAgent.add_clip_to_timeline = function (args) {
    var seq = AEAgent._sequence();
    var item = AEAgent._item(args);
    var track = AEAgent._track(seq, args.track || "V1");
    var time = args.time === undefined ? AEAgent._sec(seq.getPlayerPosition()) : Number(args.time);
    if (args.mode === "insert") { track.insertClip(item, time); } else { track.overwriteClip(item, time); }
    for (var c = 0; c < track.clips.numItems; c += 1) {
        if (Math.abs(track.clips[c].start.seconds - time) < 0.02) { return AEAgent._clipInfo(track.clips[c], c); }
    }
    return { added: true, track: args.track || "V1", time: time };
};

AEAgent.move_clip = function (args) {
    var clip = AEAgent._clip(args);
    var delta = args.start !== undefined ? Number(args.start) - clip.start.seconds : Number(args.by || 0);
    clip.move(AEAgent._time(delta));
    return AEAgent._clipInfo(clip, Number(args.clip));
};

AEAgent.trim_clip = function (args) {
    var clip = AEAgent._clip(args);
    if (args.inPoint !== undefined) { clip.inPoint = AEAgent._time(args.inPoint); }
    if (args.outPoint !== undefined) { clip.outPoint = AEAgent._time(args.outPoint); }
    if (args.end !== undefined) { clip.end = AEAgent._time(args.end); }
    return AEAgent._clipInfo(clip, Number(args.clip));
};

AEAgent.remove_clip = function (args) {
    var clip = AEAgent._clip(args);
    var info = AEAgent._clipInfo(clip, Number(args.clip));
    clip.remove(!!args.ripple, true);
    return { removed: info };
};

AEAgent.set_clip_enabled = function (args) {
    var clip = AEAgent._clip(args);
    clip.disabled = !args.enabled;
    return AEAgent._clipInfo(clip, Number(args.clip));
};

AEAgent.rename_clip = function (args) {
    var clip = AEAgent._clip(args);
    clip.name = String(args.name);
    return AEAgent._clipInfo(clip, Number(args.clip));
};

AEAgent._propValue = function (prop) {
    try {
        var v = prop.getValue();
        if (v instanceof Array) { var out = []; for (var i = 0; i < v.length; i += 1) { out.push(AEAgent._round(v[i], 4)); } return out; }
        if (typeof v === "number") { return AEAgent._round(v, 4); }
        if (typeof v === "boolean" || typeof v === "string") { return v.length > 200 ? v.slice(0, 200) : v; }
        return null;
    } catch (e) { return null; }
};

AEAgent.get_clip_components = function (args) {
    var clip = AEAgent._clip(args);
    var components = [];
    for (var c = 0; c < clip.components.numItems; c += 1) {
        var comp = clip.components[c];
        var props = [];
        for (var p = 0; p < comp.properties.numItems; p += 1) {
            var prop = comp.properties[p];
            var entry = { index: p, name: prop.displayName, value: AEAgent._propValue(prop) };
            try { if (prop.isTimeVarying()) { entry.keyframed = true; } } catch (e) { /* n/a */ }
            props.push(entry);
        }
        components.push({ index: c, name: comp.displayName, matchName: comp.matchName, properties: props });
    }
    return { clip: AEAgent._clipInfo(clip, Number(args.clip)), components: components, note: "Motion Position is normalized (0.5, 0.5 = frame center)." };
};

/* Premiere shows component and property names in the UI language, so the
   built-in ones also answer to their English names (by matchName and index). */
AEAgent._aliases = {
    "motion": { matchName: "AE.ADBE Motion", props: { "position": 0, "scale": 1, "scale width": 2, "uniform scale": 3, "rotation": 4, "anchor point": 5, "anti-flicker filter": 6 } },
    "opacity": { matchName: "AE.ADBE Opacity", props: { "opacity": 0, "blend mode": 1 } },
    "time remapping": { matchName: "AE.ADBE Time Remapping", props: { "speed": 0 } },
    "volume": { matchName: "Audio Levels", props: { "level": 1 } }
};

AEAgent._findProperty = function (clip, componentName, propertyName, propertyIndex) {
    var alias = AEAgent._aliases[String(componentName).toLowerCase()];
    for (var c = 0; c < clip.components.numItems; c += 1) {
        var comp = clip.components[c];
        if (comp.displayName === componentName || comp.matchName === componentName || (alias && comp.matchName === alias.matchName)) {
            if (propertyIndex !== undefined && propertyIndex < comp.properties.numItems) { return comp.properties[propertyIndex]; }
            for (var p = 0; p < comp.properties.numItems; p += 1) {
                if (comp.properties[p].displayName === propertyName) { return comp.properties[p]; }
            }
            var index = alias && alias.props[String(propertyName).toLowerCase()];
            if (index !== undefined && index < comp.properties.numItems) { return comp.properties[index]; }
            throw new Error("Property “" + propertyName + "” not found on " + componentName + ". Use get_clip_components (or propertyIndex).");
        }
    }
    throw new Error("Component “" + componentName + "” not found on the clip. Use get_clip_components (names follow Premiere's language; English names and matchNames work for Motion, Opacity, Time Remapping and Volume).");
};

AEAgent.set_clip_property = function (args) {
    var clip = AEAgent._clip(args);
    var prop = AEAgent._findProperty(clip, String(args.component), String(args.property || ""), args.propertyIndex);
    if (args.keyframes && args.keyframes.length) {
        if (!prop.isTimeVarying()) { prop.setTimeVarying(true); }
        for (var k = 0; k < args.keyframes.length; k += 1) {
            // Keyframe times are seconds on the timeline; Premiere wants clip-media time.
            var key = args.keyframes[k];
            var mediaTime = clip.inPoint.seconds + (Number(key.time) - clip.start.seconds);
            prop.addKey(AEAgent._time(mediaTime));
            prop.setValueAtKey(AEAgent._time(mediaTime), key.value, true);
        }
    } else {
        if (prop.isTimeVarying() && args.removeKeyframes) { prop.setTimeVarying(false); }
        prop.setValue(args.value, true);
    }
    return { property: args.property, value: AEAgent._propValue(prop), keyframed: prop.isTimeVarying() };
};

/* QE DOM items include empty gaps, so they are matched by start time. */
AEAgent._qeClip = function (args) {
    var clip = AEAgent._clip(args);
    app.enableQE();
    var qeSeq = qe.project.getActiveSequence();
    var m = /^([VA])(\d+)$/i.exec(String(args.track));
    var qeTrack = m[1].toUpperCase() === "V" ? qeSeq.getVideoTrackAt(Number(m[2]) - 1) : qeSeq.getAudioTrackAt(Number(m[2]) - 1);
    for (var i = 0; i < qeTrack.numItems; i += 1) {
        var item = qeTrack.getItemAt(i);
        if (item && item.type !== "Empty" && Math.abs(item.start.secs - clip.start.seconds) < 0.02) { return { qe: item, clip: clip }; }
    }
    throw new Error("Could not reach the clip through Premiere's QE interface.");
};

AEAgent.add_video_effect = function (args) {
    var found = AEAgent._qeClip(args);
    var effect = qe.project.getVideoEffectByName(String(args.effectName));
    if (!effect) { throw new Error("Video effect “" + args.effectName + "” not found. Use the English effect name, e.g. Gaussian Blur, Lumetri Color, Crop."); }
    found.qe.addVideoEffect(effect);
    return { added: args.effectName, clip: AEAgent._clipInfo(found.clip, Number(args.clip)) };
};

AEAgent.add_transition = function (args) {
    var found = AEAgent._qeClip(args);
    var isVideo = /^V/i.test(String(args.track));
    var name = String(args.transitionName || (isVideo ? "Cross Dissolve" : "Constant Power"));
    var transition = isVideo ? qe.project.getVideoTransitionByName(name) : qe.project.getAudioTransitionByName(name);
    if (!transition) { throw new Error("Transition “" + name + "” not found. Use the English name, e.g. Cross Dissolve, Dip to Black."); }
    var frames = Math.max(1, Math.round(Number(args.duration || 1) * 30));
    var duration = "00;00;" + (frames >= 30 ? ("0" + Math.floor(frames / 30)).slice(-2) : "00") + ";" + ("0" + (frames % 30)).slice(-2);
    found.qe.addTransition(transition, args.at !== "end", duration);
    return { added: name, at: args.at === "end" ? "end" : "start", clip: AEAgent._clipInfo(found.clip, Number(args.clip)) };
};

AEAgent.add_marker = function (args) {
    var seq = AEAgent._sequence();
    var marker = seq.markers.createMarker(Number(args.time || 0));
    if (args.name) { marker.name = String(args.name); }
    if (args.comments) { marker.comments = String(args.comments); }
    if (args.duration) { marker.end = AEAgent._time(Number(args.time || 0) + Number(args.duration)); }
    return { time: Number(args.time || 0), name: args.name || "" };
};

AEAgent.set_playhead = function (args) {
    var seq = AEAgent._sequence();
    seq.setPlayerPosition(AEAgent._time(args.time).ticks);
    return { playhead: AEAgent._sec(seq.getPlayerPosition()) };
};

AEAgent.create_sequence_from_clips = function (args) {
    var project = AEAgent._project();
    var items = [];
    var ids = args.nodeIds || [];
    for (var i = 0; i < ids.length; i += 1) { items.push(AEAgent._item({ nodeId: ids[i] })); }
    if (!items.length) { throw new Error("Pass the nodeIds of the clips to put in the sequence."); }
    var seq = project.createNewSequenceFromClips(String(args.name || "Soma Sequence"), items, project.rootItem);
    if (seq) { project.activeSequence = seq; }
    return { created: !!seq, name: seq ? seq.name : null };
};

/* Exports frames as PNG so the agent can look at the edit. Premiere writes the
   files asynchronously; the panel waits until each PNG is complete. */
AEAgent.preview_frames = function (args) {
    var seq = AEAgent._sequence();
    app.enableQE();
    var qeSeq = qe.project.getActiveSequence();
    var original = seq.getPlayerPosition().ticks;
    var times = args.times && args.times.length ? args.times : [AEAgent._sec(seq.getPlayerPosition())];
    var frames = [];
    for (var i = 0; i < times.length && i < 8; i += 1) {
        seq.setPlayerPosition(AEAgent._time(times[i]).ticks);
        var file = AEAgent._tempFile("");
        qeSeq.exportFramePNG(qeSeq.CTI.timecode, file.fsName);
        frames.push({ path: file.fsName + ".png", time: Number(times[i]), frame: i });
    }
    seq.setPlayerPosition(original);
    return { frames: frames, reason: args.reason || null };
};
