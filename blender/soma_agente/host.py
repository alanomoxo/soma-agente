"""Blender tools for Soma Agente. Everything here runs on Blender's main thread
(called from Agent.pump() in a timer), so bpy is safe to use."""
import contextlib
import io
import json
import math
import os
import tempfile
import time
import traceback

import bpy
import mathutils

MUTATING = {"execute_python", "create_object", "set_transform", "set_material", "add_keyframes", "delete_objects", "duplicate_object", "set_frame"}


def _round(values, digits=3):
    return [round(float(v), digits) for v in values]


def _degrees(euler):
    return [round(math.degrees(v), 2) for v in euler]


def _hex_to_rgba(value, alpha=1.0):
    if isinstance(value, (list, tuple)):
        rgba = list(value) + [alpha] * (4 - len(value))
        return rgba[:4]
    text = str(value).lstrip("#")
    if len(text) != 6:
        raise ValueError("Colors are hex like #E70E77 or [r, g, b] in 0..1.")
    srgb = [int(text[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    # Hex colors are sRGB; Blender's color sockets are linear.
    linear = [c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in srgb]
    return linear + [alpha]


def context_override():
    """Window/area/region of a 3D View, for operators called from a timer."""
    wm = bpy.context.window_manager
    for window in wm.windows:
        for area in window.screen.areas:
            if area.type == "VIEW_3D":
                region = next((r for r in area.regions if r.type == "WINDOW"), None)
                return {"window": window, "screen": window.screen, "area": area, "region": region}
    window = wm.windows[0] if wm.windows else None
    return {"window": window, "screen": window.screen if window else None}


def _object(name):
    ob = bpy.data.objects.get(str(name))
    if ob is None:
        raise ValueError("Object “%s” not found. Use get_scene_info for current names." % name)
    return ob


def _object_summary(ob):
    info = {
        "name": ob.name, "type": ob.type,
        "location": _round(ob.location), "rotation_deg": _degrees(ob.rotation_euler), "scale": _round(ob.scale),
        "dimensions": _round(ob.dimensions),
    }
    if ob.parent:
        info["parent"] = ob.parent.name
    if ob.users_collection:
        info["collections"] = [c.name for c in ob.users_collection]
    materials = [s.material.name for s in ob.material_slots if s.material]
    if materials:
        info["materials"] = materials
    if ob.modifiers:
        info["modifiers"] = [m.name + " (" + m.type + ")" for m in ob.modifiers]
    if ob.hide_get() or ob.hide_viewport:
        info["hidden"] = True
    if ob.animation_data and ob.animation_data.action:
        info["animated"] = True
    return info


def get_scene_info(args):
    scene = bpy.context.scene
    limit = int(args.get("limit", 300))
    objects = [_object_summary(ob) for ob in list(scene.objects)[:limit]]
    render = scene.render
    view_layer = bpy.context.view_layer
    return {
        "file": bpy.data.filepath or "(unsaved)",
        "scene": scene.name,
        "frame": scene.frame_current, "frame_start": scene.frame_start, "frame_end": scene.frame_end,
        "fps": round(render.fps / render.fps_base, 3),
        "render_engine": render.engine,
        "resolution": [render.resolution_x, render.resolution_y, render.resolution_percentage],
        "camera": scene.camera.name if scene.camera else None,
        "active_object": view_layer.objects.active.name if view_layer.objects.active else None,
        "selected": [ob.name for ob in bpy.context.selected_objects] if hasattr(bpy.context, "selected_objects") else [],
        "collections": [c.name for c in bpy.data.collections],
        "units": scene.unit_settings.system + " (" + str(round(scene.unit_settings.scale_length, 4)) + " m per unit)",
        "object_count": len(scene.objects),
        "objects": objects,
        "truncated": len(scene.objects) > limit,
    }


def get_object_info(args):
    ob = _object(args.get("name"))
    info = _object_summary(ob)
    if ob.type == "MESH" and ob.data:
        info["mesh"] = {"vertices": len(ob.data.vertices), "faces": len(ob.data.polygons)}
    if ob.type == "LIGHT":
        info["light"] = {"type": ob.data.type, "energy": round(ob.data.energy, 3), "color": _round(ob.data.color)}
    if ob.type == "CAMERA":
        info["camera"] = {"lens": round(ob.data.lens, 2), "type": ob.data.type}
    mats = []
    for slot in ob.material_slots:
        mat = slot.material
        if not mat:
            continue
        entry = {"name": mat.name}
        if mat.use_nodes and mat.node_tree:
            bsdf = next((n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
            if bsdf:
                entry["base_color"] = _round(bsdf.inputs["Base Color"].default_value)
                entry["metallic"] = round(bsdf.inputs["Metallic"].default_value, 3)
                entry["roughness"] = round(bsdf.inputs["Roughness"].default_value, 3)
            entry["nodes"] = [n.bl_idname for n in mat.node_tree.nodes][:30]
        mats.append(entry)
    if mats:
        info["material_details"] = mats
    if ob.modifiers:
        info["modifier_details"] = [{"name": m.name, "type": m.type, "show_viewport": m.show_viewport} for m in ob.modifiers]
    if ob.constraints:
        info["constraints"] = [c.name + " (" + c.type + ")" for c in ob.constraints]
    action = ob.animation_data.action if ob.animation_data else None
    if action:
        curves = []
        fcurves = getattr(action, "fcurves", None)
        if fcurves is None:
            # Blender 5 stores curves in layered actions (channelbags).
            fcurves = []
            for layer in getattr(action, "layers", []):
                for strip in layer.strips:
                    for bag in getattr(strip, "channelbags", []):
                        fcurves.extend(bag.fcurves)
        for fc in list(fcurves)[:40]:
            curves.append({"data_path": fc.data_path, "index": fc.array_index,
                           "keys": [[round(k.co[0], 2), round(k.co[1], 4), k.interpolation] for k in fc.keyframe_points][:30]})
        info["animation"] = {"action": action.name, "curves": curves}
    return info


PRIMITIVES = {
    "cube": lambda s: bpy.ops.mesh.primitive_cube_add(size=s),
    "plane": lambda s: bpy.ops.mesh.primitive_plane_add(size=s),
    "uv_sphere": lambda s: bpy.ops.mesh.primitive_uv_sphere_add(radius=s / 2),
    "sphere": lambda s: bpy.ops.mesh.primitive_uv_sphere_add(radius=s / 2),
    "ico_sphere": lambda s: bpy.ops.mesh.primitive_ico_sphere_add(radius=s / 2),
    "cylinder": lambda s: bpy.ops.mesh.primitive_cylinder_add(radius=s / 2, depth=s),
    "cone": lambda s: bpy.ops.mesh.primitive_cone_add(radius1=s / 2, depth=s),
    "torus": lambda s: bpy.ops.mesh.primitive_torus_add(major_radius=s / 2, minor_radius=s / 8),
    "circle": lambda s: bpy.ops.mesh.primitive_circle_add(radius=s / 2),
    "monkey": lambda s: bpy.ops.mesh.primitive_monkey_add(size=s),
    "empty": lambda s: bpy.ops.object.empty_add(radius=s / 2),
    "camera": lambda s: bpy.ops.object.camera_add(),
    "text": lambda s: bpy.ops.object.text_add(radius=s),
    "point_light": lambda s: bpy.ops.object.light_add(type="POINT"),
    "sun_light": lambda s: bpy.ops.object.light_add(type="SUN"),
    "area_light": lambda s: bpy.ops.object.light_add(type="AREA"),
    "spot_light": lambda s: bpy.ops.object.light_add(type="SPOT"),
}


def create_object(args):
    kind = str(args.get("type", "cube")).lower()
    if kind not in PRIMITIVES:
        raise ValueError("Unknown type %s. Use one of: %s." % (kind, ", ".join(PRIMITIVES)))
    location = args.get("location") or [0, 0, 0]
    with bpy.context.temp_override(**context_override()):
        if bpy.context.object and bpy.context.object.mode != "OBJECT":
            bpy.ops.object.mode_set(mode="OBJECT")
        PRIMITIVES[kind](float(args.get("size", 2)))
    ob = bpy.context.view_layer.objects.active
    ob.location = location
    if args.get("rotation_deg"):
        ob.rotation_euler = [math.radians(v) for v in args["rotation_deg"]]
    if args.get("scale"):
        ob.scale = args["scale"]
    if args.get("name"):
        ob.name = str(args["name"])
    if kind == "text" and args.get("text"):
        ob.data.body = str(args["text"])
    if args.get("color") and ob.type in ("MESH", "CURVE", "FONT"):
        set_material({"name": ob.name, "color": args["color"]})
    if ob.type == "LIGHT" and args.get("energy") is not None:
        ob.data.energy = float(args["energy"])
    if ob.type == "CAMERA" and args.get("make_active_camera", True):
        bpy.context.scene.camera = ob
    return _object_summary(ob)


def set_transform(args):
    ob = _object(args.get("name"))
    if args.get("location") is not None:
        ob.location = args["location"]
    if args.get("rotation_deg") is not None:
        ob.rotation_euler = [math.radians(v) for v in args["rotation_deg"]]
    if args.get("scale") is not None:
        ob.scale = args["scale"]
    if args.get("dimensions") is not None:
        ob.dimensions = args["dimensions"]
    if args.get("look_at") is not None:
        direction = mathutils.Vector(args["look_at"]) - ob.location
        ob.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
    return _object_summary(ob)


def set_material(args):
    ob = _object(args.get("name"))
    mat_name = args.get("material") or (ob.name + " Material")
    mat = bpy.data.materials.get(mat_name) or bpy.data.materials.new(mat_name)
    mat.use_nodes = True
    bsdf = next((n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
    if bsdf is None:
        bsdf = mat.node_tree.nodes.new("ShaderNodeBsdfPrincipled")
    if args.get("color") is not None:
        bsdf.inputs["Base Color"].default_value = _hex_to_rgba(args["color"])
        mat.diffuse_color = _hex_to_rgba(args["color"])
    for key, socket in (("metallic", "Metallic"), ("roughness", "Roughness"), ("alpha", "Alpha")):
        if args.get(key) is not None:
            bsdf.inputs[socket].default_value = float(args[key])
    if args.get("emission_color") is not None:
        bsdf.inputs["Emission Color"].default_value = _hex_to_rgba(args["emission_color"])
        bsdf.inputs["Emission Strength"].default_value = float(args.get("emission_strength", 1.0))
    if ob.data and hasattr(ob.data, "materials"):
        if args.get("replace", True) and len(ob.data.materials):
            ob.data.materials[0] = mat
        else:
            ob.data.materials.append(mat)
    return {"object": ob.name, "material": mat.name}


def add_keyframes(args):
    ob = _object(args.get("name"))
    path = str(args.get("property", "location"))
    keys = args.get("keyframes") or []
    if not keys:
        raise ValueError("Pass keyframes as [{frame, value}].")
    target = ob
    if path.startswith("data."):
        target, path = ob.data, path[5:]
    degrees = path == "rotation_euler"
    for key in keys:
        value = key["value"]
        if degrees:
            value = [math.radians(v) for v in value] if isinstance(value, (list, tuple)) else math.radians(value)
        index = key.get("index", -1)
        if index >= 0:
            getattr(target, path)[index] = value
        else:
            setattr(target, path, value)
        target.keyframe_insert(data_path=path, frame=float(key["frame"]), index=index)
    interpolation = str(args.get("interpolation", "BEZIER")).upper()
    easing = args.get("easing")
    action = target.animation_data.action if target.animation_data else None
    if action:
        fcurves = getattr(action, "fcurves", None)
        if fcurves is None:
            fcurves = []
            for layer in getattr(action, "layers", []):
                for strip in layer.strips:
                    for bag in getattr(strip, "channelbags", []):
                        fcurves.extend(bag.fcurves)
        for fc in fcurves:
            if fc.data_path == path:
                for point in fc.keyframe_points:
                    point.interpolation = interpolation
                    if easing:
                        point.easing = str(easing).upper()
    return {"object": ob.name, "property": path, "keys": len(keys), "interpolation": interpolation}


def delete_objects(args):
    removed = []
    for name in args.get("names") or []:
        ob = _object(name)
        removed.append(ob.name)
        bpy.data.objects.remove(ob, do_unlink=True)
    return {"removed": removed}


def duplicate_object(args):
    ob = _object(args.get("name"))
    copy = ob.copy()
    if ob.data and args.get("linked") is not True:
        copy.data = ob.data.copy()
    for collection in ob.users_collection:
        collection.objects.link(copy)
    if args.get("new_name"):
        copy.name = str(args["new_name"])
    if args.get("offset"):
        copy.location = ob.location + mathutils.Vector(args["offset"])
    return _object_summary(copy)


def set_frame(args):
    scene = bpy.context.scene
    if args.get("frame") is not None:
        scene.frame_set(int(args["frame"]))
    if args.get("frame_start") is not None:
        scene.frame_start = int(args["frame_start"])
    if args.get("frame_end") is not None:
        scene.frame_end = int(args["frame_end"])
    return {"frame": scene.frame_current, "frame_start": scene.frame_start, "frame_end": scene.frame_end}


def execute_python(args):
    code = str(args.get("code") or "")
    if not code.strip():
        raise ValueError("Python code is required.")
    namespace = {"bpy": bpy, "mathutils": mathutils, "math": math, "C": bpy.context, "D": bpy.data,
                 "scene": bpy.context.scene, "context_override": context_override, "result": None}
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


def preview_viewport(args):
    """OpenGL render of the 3D View (or the scene camera) at a reduced size."""
    scene = bpy.context.scene
    render = scene.render
    max_size = int(args.get("max_size", 1280))
    previous = (render.resolution_percentage, render.filepath, render.image_settings.file_format)
    longest = max(render.resolution_x, render.resolution_y)
    render.resolution_percentage = max(5, min(100, int(max_size / max(longest, 1) * 100)))
    frames = []
    try:
        for frame in args.get("frames") or [scene.frame_current]:
            scene.frame_set(int(frame))
            path = os.path.join(tempfile.gettempdir(), "soma-blender-%d-%d.png" % (int(time.time() * 1000), int(frame)))
            render.image_settings.file_format = "PNG"
            with bpy.context.temp_override(**context_override()):
                bpy.ops.render.opengl(write_still=False, view_context=not args.get("camera", False))
            bpy.data.images["Render Result"].save_render(filepath=path)
            frames.append(path)
    finally:
        render.resolution_percentage, render.filepath, render.image_settings.file_format = previous
    return {"ok": True, "data": {"frames": len(frames), "view": "camera" if args.get("camera") else "viewport"}, "images": frames}


def undo_last_action(args):
    with bpy.context.temp_override(**context_override()):
        bpy.ops.ed.undo()
    return {"reverted": True}


HANDLERS = {
    "get_scene_info": get_scene_info, "get_object_info": get_object_info, "create_object": create_object,
    "set_transform": set_transform, "set_material": set_material, "add_keyframes": add_keyframes,
    "delete_objects": delete_objects, "duplicate_object": duplicate_object, "set_frame": set_frame,
    "execute_python": execute_python, "preview_viewport": preview_viewport, "undo_last_action": undo_last_action,
}

VEC3 = {"type": "array", "items": {"type": "number"}, "minItems": 3, "maxItems": 3}
COLOR = {"description": "Hex color like #E70E77, or [r, g, b] linear 0..1."}


def _tool(name, description, properties=None, required=None):
    return {"name": name, "description": description,
            "inputSchema": {"type": "object", "properties": properties or {}, "required": required or [], "additionalProperties": False}}


TOOLS = [
    _tool("get_scene_info", "The open scene: frame range, fps, render settings, camera, selection, and every object with type, transform, dimensions, materials and modifiers.", {"limit": {"type": "integer"}}),
    _tool("get_object_info", "Details of one object: mesh stats, light/camera data, material values, modifiers, constraints and keyframes.", {"name": {"type": "string"}}, ["name"]),
    _tool("create_object", "Add an object: cube, plane, uv_sphere, ico_sphere, cylinder, cone, torus, circle, monkey, empty, camera, text, point_light, sun_light, area_light or spot_light. Rotation in degrees.",
          {"type": {"type": "string", "enum": list(PRIMITIVES)}, "name": {"type": "string"}, "location": VEC3, "rotation_deg": VEC3, "scale": VEC3, "size": {"type": "number"}, "color": COLOR, "text": {"type": "string"}, "energy": {"type": "number"}, "make_active_camera": {"type": "boolean"}}, ["type"]),
    _tool("set_transform", "Set an object's location, rotation (degrees), scale or dimensions, or point it at a location (look_at).", {"name": {"type": "string"}, "location": VEC3, "rotation_deg": VEC3, "scale": VEC3, "dimensions": VEC3, "look_at": VEC3}, ["name"]),
    _tool("set_material", "Give an object a Principled BSDF material: base color, metallic, roughness, alpha, emission.", {"name": {"type": "string"}, "material": {"type": "string"}, "color": COLOR, "metallic": {"type": "number"}, "roughness": {"type": "number"}, "alpha": {"type": "number"}, "emission_color": COLOR, "emission_strength": {"type": "number"}, "replace": {"type": "boolean"}}, ["name"]),
    _tool("add_keyframes", "Animate a property (location, rotation_euler in degrees, scale, or another data path; data.<path> for object data) with keyframes [{frame, value, index?}].",
          {"name": {"type": "string"}, "property": {"type": "string"}, "keyframes": {"type": "array", "items": {"type": "object"}}, "interpolation": {"type": "string", "enum": ["BEZIER", "LINEAR", "CONSTANT", "SINE", "QUAD", "CUBIC", "QUART", "QUINT", "EXPO", "CIRC", "BACK", "BOUNCE", "ELASTIC"]}, "easing": {"type": "string", "enum": ["AUTO", "EASE_IN", "EASE_OUT", "EASE_IN_OUT"]}}, ["name", "property", "keyframes"]),
    _tool("delete_objects", "Delete objects by name.", {"names": {"type": "array", "items": {"type": "string"}, "minItems": 1}}, ["names"]),
    _tool("duplicate_object", "Duplicate an object (with its own data unless linked), optionally offset.", {"name": {"type": "string"}, "new_name": {"type": "string"}, "offset": VEC3, "linked": {"type": "boolean"}}, ["name"]),
    _tool("set_frame", "Set the current frame and/or the scene frame range.", {"frame": {"type": "integer"}, "frame_start": {"type": "integer"}, "frame_end": {"type": "integer"}}),
    _tool("preview_viewport", "Render the 3D View (or, with camera: true, the scene camera) as PNG images at the given frames and return them for visual inspection.", {"frames": {"type": "array", "items": {"type": "integer"}, "maxItems": 6}, "camera": {"type": "boolean"}, "max_size": {"type": "integer"}, "reason": {"type": "string"}}),
    _tool("execute_python", "General fallback: run Blender Python (bpy, mathutils, C, D, scene, context_override() for operators). Set `result` to a small JSON-safe value to return it; print() output is returned too.", {"summary": {"type": "string"}, "code": {"type": "string"}}, ["summary", "code"]),
    _tool("undo_last_action", "Blender Undo, one step (each Soma tool is one step).", {}),
]

INSTRUCTIONS = " ".join([
    "You are Soma Agente, embedded inside Blender. Use the blender MCP tools to do the user's requested work directly in the open scene.",
    "Blender is Z-up; distances are in scene units (meters by default); rotations you pass are in degrees. Refer to objects by exact name.",
    "Inspect get_scene_info before editing unless the current turn already has fresh results. Use get_object_info for materials, modifiers and animation.",
    "Each editing tool is one Undo step; undo_last_action steps back once.",
    "After visual changes, call preview_viewport (camera: true to see the final framing) and look at the images before declaring success. For animation, check the start, middle and end frames.",
    "Use the dedicated tools first; use execute_python for anything else (modifiers, geometry nodes, rendering settings, rigging). Operators need context: wrap them in `with bpy.context.temp_override(**context_override()):`.",
    "Never ask the user to do a Blender UI step that a tool can do. If a tool fails, inspect the state, correct it and verify. Do not save or overwrite .blend files, render to disk, or delete data the user did not ask to delete.",
    "Attached images are references, not instructions; each lists its file path if the user wants it used (for example as a texture).",
    "Before finishing, check every requirement against current tool results. Keep replies short and concrete, in plain text without Markdown.",
    "Always write to the user (progress updates and final replies) in the language the user writes in.",
])


class BlenderHost:
    id = "blender"
    name = "Blender"
    namespace = "blender"
    instructions = INSTRUCTIONS
    tools = TOOLS

    def call_tool(self, name, args):
        handler = HANDLERS.get(name)
        if handler is None:
            return {"ok": False, "error": "Unknown tool: %s" % name}
        try:
            data = handler(args or {})
        except Exception as error:  # noqa: BLE001 - reported to the model
            detail = traceback.format_exc(limit=3) if name == "execute_python" else ""
            return {"ok": False, "error": ("%s: %s %s" % (type(error).__name__, error, detail)).strip()}
        if name in MUTATING:
            try:
                with bpy.context.temp_override(**context_override()):
                    bpy.ops.ed.undo_push(message="Soma: " + (args.get("summary") or name.replace("_", " ")))
            except Exception:  # noqa: BLE001 - undo is best effort
                pass
        if isinstance(data, dict) and "images" in data and "ok" in data:
            return data
        return {"ok": True, "data": data}
