"""Cinema 4D tools for Soma Agente. Called on the main thread from the dialog's
Timer (Agent.pump), so the c4d API is safe to use here."""
import contextlib
import io
import json
import math
import os
import tempfile
import time
import traceback

import c4d

MUTATING = {"execute_python", "create_object", "set_transform", "set_material", "add_keyframes", "delete_objects", "duplicate_object", "set_frame", "set_parent"}

# Looked up by name so a constant missing in some Cinema 4D version only drops
# that primitive instead of stopping the whole plugin from loading.
PRIMITIVES = {name: getattr(c4d, const) for name, const in (
    ("cube", "Ocube"), ("sphere", "Osphere"), ("plane", "Oplane"), ("cylinder", "Ocylinder"), ("cone", "Ocone"),
    ("torus", "Otorus"), ("disc", "Odisc"), ("capsule", "Ocapsule"), ("pyramid", "Opyramid"), ("platonic", "Oplatonic"),
    ("null", "Onull"), ("camera", "Ocamera"), ("light", "Olight"), ("text", "Osplinetext"),
) if hasattr(c4d, const)}


def _doc():
    return c4d.documents.GetActiveDocument()


def _vec(values):
    return c4d.Vector(float(values[0]), float(values[1]), float(values[2]))


def _list(vector, digits=3):
    return [round(vector.x, digits), round(vector.y, digits), round(vector.z, digits)]


def _deg(vector):
    return [round(math.degrees(vector.x), 2), round(math.degrees(vector.y), 2), round(math.degrees(vector.z), 2)]


def _color(value):
    if isinstance(value, (list, tuple)):
        return _vec(value)
    text = str(value).lstrip("#")
    if len(text) != 6:
        raise ValueError("Colors are hex like #E70E77 or [r, g, b] in 0..1.")
    return c4d.Vector(int(text[0:2], 16) / 255.0, int(text[2:4], 16) / 255.0, int(text[4:6], 16) / 255.0)


def _walk(op):
    while op:
        yield op
        for child in _walk(op.GetDown()):
            yield child
        op = op.GetNext()


def _path(op):
    names = []
    while op:
        names.append(op.GetName())
        op = op.GetUp()
    return "/".join(reversed(names))


def _object(name):
    doc = _doc()
    name = str(name)
    for op in _walk(doc.GetFirstObject()):
        if op.GetName() == name or _path(op) == name:
            return op
    raise ValueError("Object “%s” not found. Use get_scene_info for current names (or parent/child paths)." % name)


def _summary(op):
    info = {"name": op.GetName(), "path": _path(op), "type": op.GetTypeName(),
            "position": _list(op.GetAbsPos()), "rotation_hpb_deg": _deg(op.GetAbsRot()), "scale": _list(op.GetAbsScale())}
    try:
        radius = op.GetRad()
        if radius.GetLength() > 0:
            info["size"] = _list(radius * 2)
    except Exception:  # noqa: BLE001 - not every object has bounds
        pass
    tags = [t.GetTypeName() for t in op.GetTags()]
    if tags:
        info["tags"] = tags
    mats = []
    for tag in op.GetTags():
        if tag.CheckType(c4d.Ttexture) and tag[c4d.TEXTURETAG_MATERIAL]:
            mats.append(tag[c4d.TEXTURETAG_MATERIAL].GetName())
    if mats:
        info["materials"] = mats
    if op.GetDown():
        info["children"] = sum(1 for _ in _iter_children(op))
    if op.GetCTracks():
        info["animated"] = True
    if op[c4d.ID_BASEOBJECT_VISIBILITY_EDITOR] == c4d.OBJECT_OFF:
        info["hidden"] = True
    return info


def _iter_children(op):
    child = op.GetDown()
    while child:
        yield child
        child = child.GetNext()


def get_scene_info(args):
    doc = _doc()
    rd = doc.GetActiveRenderData()
    fps = doc.GetFps()
    limit = int(args.get("limit", 300))
    objects = []
    for op in _walk(doc.GetFirstObject()):
        if len(objects) >= limit:
            break
        objects.append(_summary(op))
    active = doc.GetActiveObject()
    return {
        "document": doc.GetDocumentName(),
        "fps": fps,
        "frame": doc.GetTime().GetFrame(fps),
        "frame_start": doc.GetMinTime().GetFrame(fps), "frame_end": doc.GetMaxTime().GetFrame(fps),
        "resolution": [int(rd[c4d.RDATA_XRES]), int(rd[c4d.RDATA_YRES])],
        "render_engine": rd[c4d.RDATA_RENDERENGINE],
        "active_object": active.GetName() if active else None,
        "selected": [op.GetName() for op in doc.GetActiveObjects(c4d.GETACTIVEOBJECTFLAGS_CHILDREN)],
        "materials": [m.GetName() for m in doc.GetMaterials()],
        "units": "centimeters (C4D default), Y up, rotations as H/P/B degrees",
        "objects": objects,
    }


def get_object_info(args):
    op = _object(args.get("name"))
    info = _summary(op)
    params = {}
    description = op.GetDescription(c4d.DESCFLAGS_DESC_NONE)
    for bc, paramid, _group in description:
        name = bc[c4d.DESC_NAME]
        if not name or paramid[0].dtype not in (c4d.DTYPE_REAL, c4d.DTYPE_LONG, c4d.DTYPE_BOOL, c4d.DTYPE_VECTOR, c4d.DTYPE_STRING):
            continue
        try:
            value = op[paramid]
        except Exception:  # noqa: BLE001
            continue
        if isinstance(value, c4d.Vector):
            value = _list(value)
        elif isinstance(value, float):
            value = round(value, 4)
        params[name] = value
        if len(params) >= 60:
            break
    info["parameters"] = params
    tracks = []
    for track in op.GetCTracks()[:30]:
        curve = track.GetCurve()
        keys = []
        for i in range(min(curve.GetKeyCount(), 30)):
            key = curve.GetKey(i)
            keys.append([key.GetTime().GetFrame(_doc().GetFps()), round(key.GetValue(), 4)])
        tracks.append({"track": track.GetName(), "keys": keys})
    if tracks:
        info["tracks"] = tracks
    return info


def _insert(doc, op, args):
    parent = _object(args["parent"]) if args.get("parent") else None
    doc.InsertObject(op, parent=parent)
    doc.AddUndo(c4d.UNDOTYPE_NEWOBJ, op)


def create_object(args):
    doc = _doc()
    kind = str(args.get("type", "cube")).lower()
    if kind not in PRIMITIVES:
        raise ValueError("Unknown type %s. Use one of: %s." % (kind, ", ".join(PRIMITIVES)))
    op = c4d.BaseObject(PRIMITIVES[kind])
    size = args.get("size")
    if size is not None:
        s = float(size)
        settings = {
            "cube": lambda: op.__setitem__(c4d.PRIM_CUBE_LEN, c4d.Vector(s, s, s)),
            "sphere": lambda: op.__setitem__(c4d.PRIM_SPHERE_RAD, s / 2),
            "plane": lambda: (op.__setitem__(c4d.PRIM_PLANE_WIDTH, s), op.__setitem__(c4d.PRIM_PLANE_HEIGHT, s)),
            "cylinder": lambda: (op.__setitem__(c4d.PRIM_CYLINDER_RADIUS, s / 2), op.__setitem__(c4d.PRIM_CYLINDER_HEIGHT, s)),
            "cone": lambda: (op.__setitem__(c4d.PRIM_CONE_BRAD, s / 2), op.__setitem__(c4d.PRIM_CONE_HEIGHT, s)),
            "torus": lambda: op.__setitem__(c4d.PRIM_TORUS_OUTERRAD, s / 2),
            "disc": lambda: op.__setitem__(c4d.PRIM_DISC_ORAD, s / 2),
            "text": lambda: op.__setitem__(c4d.PRIM_TEXT_HEIGHT, s),
        }
        if kind in settings:
            settings[kind]()
    if kind == "text":
        op[c4d.PRIM_TEXT_TEXT] = str(args.get("text") or "Text")
    if kind == "light" and args.get("light_type"):
        types = {"omni": c4d.LIGHT_TYPE_OMNI, "spot": c4d.LIGHT_TYPE_SPOT, "infinite": c4d.LIGHT_TYPE_DISTANT, "area": c4d.LIGHT_TYPE_AREA}
        op[c4d.LIGHT_TYPE] = types.get(args["light_type"], c4d.LIGHT_TYPE_OMNI)
    if args.get("name"):
        op.SetName(str(args["name"]))
    if args.get("position"):
        op.SetAbsPos(_vec(args["position"]))
    if args.get("rotation_hpb_deg"):
        op.SetAbsRot(_vec([math.radians(v) for v in args["rotation_hpb_deg"]]))
    if args.get("scale"):
        op.SetAbsScale(_vec(args["scale"]))
    _insert(doc, op, args)
    if args.get("color") and kind not in ("null", "camera", "light"):
        set_material({"name": op.GetName(), "color": args["color"]}, op=op)
    return _summary(op)


def set_transform(args):
    doc = _doc()
    op = _object(args.get("name"))
    doc.AddUndo(c4d.UNDOTYPE_CHANGE, op)
    if args.get("position") is not None:
        op.SetAbsPos(_vec(args["position"]))
    if args.get("rotation_hpb_deg") is not None:
        op.SetAbsRot(_vec([math.radians(v) for v in args["rotation_hpb_deg"]]))
    if args.get("scale") is not None:
        op.SetAbsScale(_vec(args["scale"]))
    if args.get("new_name"):
        op.SetName(str(args["new_name"]))
    if args.get("visible") is not None:
        state = c4d.OBJECT_UNDEF if args["visible"] else c4d.OBJECT_OFF
        op[c4d.ID_BASEOBJECT_VISIBILITY_EDITOR] = state
        op[c4d.ID_BASEOBJECT_VISIBILITY_RENDER] = state
    return _summary(op)


def set_parent(args):
    doc = _doc()
    op = _object(args.get("name"))
    doc.AddUndo(c4d.UNDOTYPE_CHANGE, op)
    matrix = op.GetMg()
    op.Remove()
    parent = _object(args["parent"]) if args.get("parent") else None
    doc.InsertObject(op, parent=parent)
    op.SetMg(matrix)
    return _summary(op)


def set_material(args, op=None):
    doc = _doc()
    op = op or _object(args.get("name"))
    mat_name = args.get("material") or (op.GetName() + " Material")
    mat = doc.SearchMaterial(mat_name)
    if mat is None:
        mat = c4d.BaseMaterial(c4d.Mmaterial)
        mat.SetName(mat_name)
        doc.InsertMaterial(mat)
        doc.AddUndo(c4d.UNDOTYPE_NEWOBJ, mat)
    else:
        doc.AddUndo(c4d.UNDOTYPE_CHANGE, mat)
    if args.get("color") is not None:
        mat[c4d.MATERIAL_COLOR_COLOR] = _color(args["color"])
    if args.get("brightness") is not None:
        mat[c4d.MATERIAL_COLOR_BRIGHTNESS] = float(args["brightness"])
    if args.get("emission_color") is not None:
        mat[c4d.MATERIAL_USE_LUMINANCE] = True
        mat[c4d.MATERIAL_LUMINANCE_COLOR] = _color(args["emission_color"])
    if args.get("transparency") is not None:
        mat[c4d.MATERIAL_USE_TRANSPARENCY] = float(args["transparency"]) > 0
        mat[c4d.MATERIAL_TRANSPARENCY_BRIGHTNESS] = float(args["transparency"])
    mat.Message(c4d.MSG_UPDATE)
    tag = op.GetTag(c4d.Ttexture)
    if tag is None:
        tag = op.MakeTag(c4d.Ttexture)
        doc.AddUndo(c4d.UNDOTYPE_NEWOBJ, tag)
    tag[c4d.TEXTURETAG_MATERIAL] = mat
    return {"object": op.GetName(), "material": mat.GetName()}


TRACKS = {"position": c4d.ID_BASEOBJECT_POSITION, "rotation": c4d.ID_BASEOBJECT_ROTATION, "scale": c4d.ID_BASEOBJECT_SCALE}
AXES = {"x": c4d.VECTOR_X, "y": c4d.VECTOR_Y, "z": c4d.VECTOR_Z}
INTERPOLATIONS = {"spline": c4d.CINTERPOLATION_SPLINE, "linear": c4d.CINTERPOLATION_LINEAR, "step": c4d.CINTERPOLATION_STEP}


def add_keyframes(args):
    doc = _doc()
    op = _object(args.get("name"))
    prop = str(args.get("property", "position")).lower()
    if prop not in TRACKS:
        raise ValueError("property must be position, rotation (H/P/B degrees) or scale; use execute_python for other parameters.")
    fps = doc.GetFps()
    interpolation = INTERPOLATIONS.get(str(args.get("interpolation", "spline")).lower(), c4d.CINTERPOLATION_SPLINE)
    doc.AddUndo(c4d.UNDOTYPE_CHANGE, op)
    count = 0
    for key in args.get("keyframes") or []:
        value = key["value"]
        if not isinstance(value, (list, tuple)):
            raise ValueError("Keyframe values are [x, y, z] (rotation: [H, P, B] degrees).")
        for axis, component in zip(("x", "y", "z"), value):
            if component is None:
                continue
            descid = c4d.DescID(c4d.DescLevel(TRACKS[prop], c4d.DTYPE_VECTOR, 0), c4d.DescLevel(AXES[axis], c4d.DTYPE_REAL, 0))
            track = op.FindCTrack(descid)
            if track is None:
                track = c4d.CTrack(op, descid)
                op.InsertTrackSorted(track)
            curve = track.GetCurve()
            added = curve.AddKey(c4d.BaseTime(int(key["frame"]), fps))
            ckey = added["key"]
            ckey.SetValue(curve, math.radians(component) if prop == "rotation" else float(component))
            ckey.SetInterpolation(curve, interpolation)
            count += 1
    return {"object": op.GetName(), "property": prop, "keys_set": count}


def delete_objects(args):
    doc = _doc()
    removed = []
    for name in args.get("names") or []:
        op = _object(name)
        doc.AddUndo(c4d.UNDOTYPE_DELETEOBJ, op)
        removed.append(op.GetName())
        op.Remove()
    return {"removed": removed}


def duplicate_object(args):
    doc = _doc()
    op = _object(args.get("name"))
    copy = op.GetClone()
    if args.get("new_name"):
        copy.SetName(str(args["new_name"]))
    doc.InsertObject(copy, parent=op.GetUp(), pred=op)
    doc.AddUndo(c4d.UNDOTYPE_NEWOBJ, copy)
    if args.get("offset"):
        copy.SetAbsPos(op.GetAbsPos() + _vec(args["offset"]))
    return _summary(copy)


def set_frame(args):
    doc = _doc()
    fps = doc.GetFps()
    if args.get("frame_start") is not None:
        doc.SetMinTime(c4d.BaseTime(int(args["frame_start"]), fps))
        doc.SetLoopMinTime(c4d.BaseTime(int(args["frame_start"]), fps))
    if args.get("frame_end") is not None:
        doc.SetMaxTime(c4d.BaseTime(int(args["frame_end"]), fps))
        doc.SetLoopMaxTime(c4d.BaseTime(int(args["frame_end"]), fps))
    if args.get("frame") is not None:
        doc.SetTime(c4d.BaseTime(int(args["frame"]), fps))
        doc.ExecutePasses(None, True, True, True, c4d.BUILDFLAGS_NONE)
    return {"frame": doc.GetTime().GetFrame(fps), "frame_start": doc.GetMinTime().GetFrame(fps), "frame_end": doc.GetMaxTime().GetFrame(fps)}


def execute_python(args):
    code = str(args.get("code") or "")
    if not code.strip():
        raise ValueError("Python code is required.")
    doc = _doc()
    namespace = {"c4d": c4d, "doc": doc, "op": doc.GetActiveObject(), "math": math, "result": None}
    output = io.StringIO()
    with contextlib.redirect_stdout(output):
        exec(compile(code, "<soma>", "exec"), namespace)  # noqa: S102 - the agent's scripting fallback
    result = namespace.get("result")
    try:
        json.dumps(result)
    except (TypeError, ValueError):
        result = repr(result)
    printed = output.getvalue()
    return {"result": result, "printed": printed[-4000:] if printed else None}


def preview_render(args):
    """Renders the active camera view with the fast Viewport renderer (or the
    document's own renderer with full: true) and returns PNG images."""
    doc = _doc()
    fps = doc.GetFps()
    original = doc.GetTime()
    rd = doc.GetActiveRenderData().GetClone()
    max_size = int(args.get("max_size", 1280))
    w, h = int(rd[c4d.RDATA_XRES]), int(rd[c4d.RDATA_YRES])
    scale = min(1.0, max_size / float(max(w, h)))
    w, h = max(16, int(w * scale)), max(16, int(h * scale))
    rd[c4d.RDATA_XRES], rd[c4d.RDATA_YRES] = w, h
    if not args.get("full"):
        rd[c4d.RDATA_RENDERENGINE] = c4d.RDATA_RENDERENGINE_PREVIEWHARDWARE
    images = []
    try:
        for frame in args.get("frames") or [original.GetFrame(fps)]:
            doc.SetTime(c4d.BaseTime(int(frame), fps))
            doc.ExecutePasses(None, True, True, True, c4d.BUILDFLAGS_NONE)
            bmp = c4d.bitmaps.BaseBitmap()
            bmp.Init(w, h, 24)
            result = c4d.documents.RenderDocument(doc, rd.GetDataInstance(), bmp, c4d.RENDERFLAGS_EXTERNAL)
            if result != c4d.RENDERRESULT_OK:
                raise RuntimeError("Render failed (code %s)." % result)
            path = os.path.join(tempfile.gettempdir(), "soma-c4d-%d-%d.png" % (int(time.time() * 1000), int(frame)))
            if bmp.Save(path, c4d.FILTER_PNG) != c4d.IMAGERESULT_OK:
                raise RuntimeError("Could not save the preview image.")
            images.append(path)
    finally:
        doc.SetTime(original)
        doc.ExecutePasses(None, True, True, True, c4d.BUILDFLAGS_NONE)
    return {"ok": True, "data": {"frames": len(images), "size": [w, h]}, "images": images}


def undo_last_action(args):
    doc = _doc()
    doc.DoUndo()
    return {"reverted": True}


HANDLERS = {
    "get_scene_info": get_scene_info, "get_object_info": get_object_info, "create_object": create_object,
    "set_transform": set_transform, "set_parent": set_parent, "set_material": set_material, "add_keyframes": add_keyframes,
    "delete_objects": delete_objects, "duplicate_object": duplicate_object, "set_frame": set_frame,
    "execute_python": execute_python, "preview_render": preview_render, "undo_last_action": undo_last_action,
}

VEC3 = {"type": "array", "items": {"type": "number"}, "minItems": 3, "maxItems": 3}
COLOR = {"description": "Hex color like #E70E77, or [r, g, b] 0..1."}


def _tool(name, description, properties=None, required=None):
    return {"name": name, "description": description,
            "inputSchema": {"type": "object", "properties": properties or {}, "required": required or [], "additionalProperties": False}}


TOOLS = [
    _tool("get_scene_info", "The active document: fps, frame range, resolution, renderer, selection, materials, and every object (path, type, position, H/P/B rotation, scale, size, tags, materials).", {"limit": {"type": "integer"}}),
    _tool("get_object_info", "One object's parameters (by name or parent/child path) and its animation tracks.", {"name": {"type": "string"}}, ["name"]),
    _tool("create_object", "Add an object: " + ", ".join(PRIMITIVES) + ". size is the edge/diameter/height in cm; rotation is H/P/B degrees.",
          {"type": {"type": "string", "enum": list(PRIMITIVES)}, "name": {"type": "string"}, "position": VEC3, "rotation_hpb_deg": VEC3, "scale": VEC3, "size": {"type": "number"}, "color": COLOR, "text": {"type": "string"}, "light_type": {"type": "string", "enum": ["omni", "spot", "infinite", "area"]}, "parent": {"type": "string"}}, ["type"]),
    _tool("set_transform", "Move/rotate (H/P/B degrees)/scale, rename or show/hide an object.", {"name": {"type": "string"}, "position": VEC3, "rotation_hpb_deg": VEC3, "scale": VEC3, "new_name": {"type": "string"}, "visible": {"type": "boolean"}}, ["name"]),
    _tool("set_parent", "Move an object under another (or to the top level with no parent), keeping its world position.", {"name": {"type": "string"}, "parent": {"type": "string"}}, ["name"]),
    _tool("set_material", "Assign a Standard material: color, brightness, emission (luminance), transparency.", {"name": {"type": "string"}, "material": {"type": "string"}, "color": COLOR, "brightness": {"type": "number"}, "emission_color": COLOR, "transparency": {"type": "number"}}, ["name"]),
    _tool("add_keyframes", "Animate position, rotation (H/P/B degrees) or scale with keyframes [{frame, value: [x, y, z]}] (use null to skip an axis).", {"name": {"type": "string"}, "property": {"type": "string", "enum": ["position", "rotation", "scale"]}, "keyframes": {"type": "array", "items": {"type": "object"}}, "interpolation": {"type": "string", "enum": ["spline", "linear", "step"]}}, ["name", "property", "keyframes"]),
    _tool("delete_objects", "Delete objects by name.", {"names": {"type": "array", "items": {"type": "string"}, "minItems": 1}}, ["names"]),
    _tool("duplicate_object", "Duplicate an object, optionally offset.", {"name": {"type": "string"}, "new_name": {"type": "string"}, "offset": VEC3}, ["name"]),
    _tool("set_frame", "Set the current frame and/or the document frame range.", {"frame": {"type": "integer"}, "frame_start": {"type": "integer"}, "frame_end": {"type": "integer"}}),
    _tool("preview_render", "Render the active camera view (fast Viewport renderer; full: true uses the document's renderer) at the given frames and return PNG images for visual inspection.", {"frames": {"type": "array", "items": {"type": "integer"}, "maxItems": 6}, "full": {"type": "boolean"}, "max_size": {"type": "integer"}, "reason": {"type": "string"}}),
    _tool("execute_python", "General fallback: run Cinema 4D Python (c4d, doc, op = active object). Set `result` to a small JSON-safe value; print() output is returned. Wrap changes in doc.StartUndo()/doc.AddUndo(...)/doc.EndUndo().", {"summary": {"type": "string"}, "code": {"type": "string"}}, ["summary", "code"]),
    _tool("undo_last_action", "Cinema 4D Undo, one step (each Soma tool is one step).", {}),
]

INSTRUCTIONS = " ".join([
    "You are Soma Agente, embedded inside Maxon Cinema 4D. Use the cinema_4d MCP tools to do the user's requested work directly in the active document.",
    "Cinema 4D is Y-up, units are centimeters by default, rotations are H/P/B in degrees. Refer to objects by name (or parent/child path when names repeat).",
    "Inspect get_scene_info before editing unless the current turn already has fresh results. Each editing tool is one Undo step; undo_last_action steps back once.",
    "After visual changes, call preview_render and look at the images before declaring success; for animation check the start, middle and end frames.",
    "Use the dedicated tools first and execute_python for anything else (MoGraph, deformers, generators, Redshift materials, render settings). Never ask the user to do a UI step a tool can do.",
    "Do not save or overwrite files, render to disk, or delete things the user did not ask to delete. Attached images are references; each lists its file path if the user wants it used.",
    "Before finishing, check every requirement against current tool results. Keep replies short and concrete, in plain text without Markdown.",
    "Always write to the user (progress updates and final replies) in the language the user writes in.",
])


class C4DHost:
    id = "cinema4d"
    name = "Cinema 4D"
    namespace = "cinema_4d"
    instructions = INSTRUCTIONS
    tools = TOOLS

    def call_tool(self, name, args):
        handler = HANDLERS.get(name)
        if handler is None:
            return {"ok": False, "error": "Unknown tool: %s" % name}
        doc = _doc()
        mutating = name in MUTATING
        if mutating:
            doc.StartUndo()
        try:
            data = handler(args or {})
        except Exception as error:  # noqa: BLE001 - reported to the model
            detail = traceback.format_exc(limit=3) if name == "execute_python" else ""
            return {"ok": False, "error": ("%s: %s %s" % (type(error).__name__, error, detail)).strip()}
        finally:
            if mutating:
                doc.EndUndo()
            c4d.EventAdd()
        if isinstance(data, dict) and "images" in data and "ok" in data:
            return data
        return {"ok": True, "data": data}
