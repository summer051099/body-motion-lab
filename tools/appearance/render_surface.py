import bpy, math, sys, os
from mathutils import Vector, Matrix
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
ASSET=os.environ.get('APPEARANCE_ASSET','athlete-surface')
RENDER_PREFIX=os.environ.get('APPEARANCE_RENDER_PREFIX','')
bpy.ops.wm.open_mainfile(filepath=str(ROOT/f'public/appearance/{ASSET}.blend'))
scene=bpy.context.scene
scene.render.engine='CYCLES';scene.cycles.samples=32
scene.render.resolution_x=640;scene.render.resolution_y=1040;scene.render.resolution_percentage=100
scene.world.color=(.8,.8,.8)
scene.view_settings.view_transform='AgX'
scene.render.image_settings.file_format='PNG'
scene.render.film_transparent=False
world=scene.world;world.use_nodes=True
nodes=world.node_tree.nodes;links=world.node_tree.links
nodes.clear();out=nodes.new('ShaderNodeOutputWorld');mix=nodes.new('ShaderNodeMixShader');path=nodes.new('ShaderNodeLightPath')
ambient=nodes.new('ShaderNodeBackground');ambient.inputs[0].default_value=(.78,.78,.78,1);ambient.inputs[1].default_value=.20
backdrop=nodes.new('ShaderNodeBackground');backdrop.inputs[0].default_value=(1,1,1,1);backdrop.inputs[1].default_value=1
links.new(path.outputs['Is Camera Ray'],mix.inputs[0]);links.new(ambient.outputs[0],mix.inputs[1]);links.new(backdrop.outputs[0],mix.inputs[2]);links.new(mix.outputs[0],out.inputs[0])
bpy.ops.object.camera_add();cam=bpy.context.object;cam.data.type='ORTHO';cam.data.ortho_scale=1.86;scene.camera=cam
for name,power,loc,size in [('Key',230,(2,3,3),1.8),('Fill',55,(-3,1,2),2.5),('Rim',160,(-2,2,-3),2.5)]:
    bpy.ops.object.light_add(type='AREA',location=loc);light=bpy.context.object;light.name=name;light.data.energy=power;light.data.shape='DISK';light.data.size=size
    light.rotation_euler=(Vector((0,.8,.08))-light.location).to_track_quat('-Z','Y').to_euler()
for name,loc in [('front',(0,.80,3)),('side',(3,.80,.08)),('back',(0,.80,-3)),('three-quarter',(2.2,.80,2.2))]:
    cam.location=loc
    forward=(Vector((0,.80,.08))-cam.location).normalized();right=forward.cross(Vector((0,1,0))).normalized();up=right.cross(forward)
    cam.rotation_euler=Matrix((right,up,-forward)).transposed().to_euler()
    scene.render.filepath=str(ROOT/f'output/appearance/{RENDER_PREFIX}rest-{name}.png')
    bpy.ops.render.render(write_still=True)
for name,loc,target,scale in [('feet',(.32,.18,.50),(.08,-.035,.15),.34),
                              ('hands',(.62,.74,.40),(.27,.735,.115),.24),
                              ('head',(.34,1.48,.70),(0,1.47,.09),.47)]:
    scene.render.resolution_x=840;scene.render.resolution_y=840;cam.data.ortho_scale=scale
    cam.location=loc;forward=(Vector(target)-cam.location).normalized();right=forward.cross(Vector((0,1,0))).normalized();up=right.cross(forward)
    cam.rotation_euler=Matrix((right,up,-forward)).transposed().to_euler()
    scene.render.filepath=str(ROOT/f'output/appearance/{RENDER_PREFIX}detail-{name}.png')
    bpy.ops.render.render(write_still=True)
