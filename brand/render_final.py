"""
Final pass. The root cause behind every off-color render in the previous three attempts: Blender's
color inputs (Emission Color, Base Color, node Background Color) expect LINEAR color values, not
sRGB. Feeding naive hex/255 floats straight in — which is what "#8B2E23" -> (0.545, 0.180, 0.137)
naively looks like it should be — makes Blender re-gamma-encode an already-sRGB value, which is why
the oxblood red kept rendering lighter and more coral than the true hex, in every attempt regardless
of the view_transform or lighting fix applied. srgb_to_linear() below is the actual fix.

Also converges the hero image onto the exact same flat, centered, orthographic recipe that already
proved reliable for the favicon, instead of a fourth attempt at a novel 3D camera composition — one
correct recipe, reused, beats a new risk each time.
"""

import bpy
import os

HERE = os.path.dirname(bpy.data.filepath) or os.path.dirname(os.path.abspath(__file__))


def srgb_to_linear(c: float) -> float:
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hex_to_linear_rgba(hex_str: str, alpha: float = 1.0):
    hex_str = hex_str.lstrip("#")
    r, g, b = (int(hex_str[i : i + 2], 16) / 255.0 for i in (0, 2, 4))
    return (srgb_to_linear(r), srgb_to_linear(g), srgb_to_linear(b), alpha)


PAPER = hex_to_linear_rgba("EDF2EA")
RED = hex_to_linear_rgba("8B2E23")


def clear_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for block in list(bpy.data.meshes):
        bpy.data.meshes.remove(block)
    for block in list(bpy.data.curves):
        bpy.data.curves.remove(block)


def set_accurate_color_pipeline():
    scene = bpy.context.scene
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "None"


def make_emission_material(name, rgba):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links
    nodes.clear()
    emission = nodes.new("ShaderNodeEmission")
    emission.inputs["Color"].default_value = rgba
    emission.inputs["Strength"].default_value = 1.0
    output = nodes.new("ShaderNodeOutputMaterial")
    links.new(emission.outputs["Emission"], output.inputs["Surface"])
    return mat


def add_tick_curve(bevel):
    curve = bpy.data.curves.new("tick", type="CURVE")
    curve.dimensions = "3D"
    curve.bevel_depth = bevel
    curve.bevel_resolution = 8
    spline = curve.splines.new("POLY")
    points = [(-0.65, -0.05, 0), (-0.15, -0.55, 0), (0.75, 0.5, 0)]
    spline.points.add(len(points) - 1)
    for i, (x, y, z) in enumerate(points):
        spline.points[i].co = (x, y, z, 1)
    obj = bpy.data.objects.new("Tick", curve)
    bpy.context.collection.objects.link(obj)
    return obj


def render_flat(output_path, width, height, ortho_scale, plane_size, tick_x_offset, bevel, samples):
    clear_scene()
    set_accurate_color_pipeline()

    mat_paper = make_emission_material("PaperFlat", PAPER)
    mat_red = make_emission_material("RedFlat", RED)

    bpy.ops.mesh.primitive_plane_add(size=plane_size, location=(0, 0, 0))
    bg = bpy.context.active_object
    bg.scale = (width / height, 1, 1) if width != height else (1, 1, 1)
    bg.data.materials.append(mat_paper)

    tick = add_tick_curve(bevel=bevel)
    tick.location = (tick_x_offset, 0, 0.01)
    tick.data.materials.append(mat_red)

    bpy.ops.object.camera_add(location=(0, 0, 2.3), rotation=(0, 0, 0))
    cam = bpy.context.active_object
    cam.data.type = "ORTHO"
    cam.data.ortho_scale = ortho_scale
    bpy.context.scene.camera = cam

    world = bpy.data.worlds["World"]
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = PAPER

    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.samples = samples
    scene.render.resolution_x = width
    scene.render.resolution_y = height
    scene.render.film_transparent = False
    scene.render.image_settings.file_format = "PNG"
    scene.render.filepath = output_path
    bpy.ops.render.render(write_still=True)
    print(f"Rendered: {output_path}")


# Favicon: square, mark centered and large.
render_flat(
    os.path.join(HERE, "favicon-512.png"),
    width=512, height=512, ortho_scale=2.15, plane_size=2.4,
    tick_x_offset=0, bevel=0.09, samples=64,
)

# OG hero: wide canvas, mark kept at the same true size/proportion, positioned left-of-center so a
# social platform's own title-text overlay (which most place lower-right) doesn't collide with it.
render_flat(
    os.path.join(HERE, "og-image.png"),
    width=1200, height=630, ortho_scale=5.0, plane_size=8.4,
    tick_x_offset=-1.3, bevel=0.16, samples=96,
)
