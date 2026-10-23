"""Static reference head / neck sculpt, entirely real 3D geometry.

Import create_head(parts=None) from a Blender authoring script, or run this file
with Blender --background --python to write the isolated candidate and 4 views.
Nothing in public/appearance or src is modified.
"""
import bpy, bmesh, json, math, time
from pathlib import Path
from mathutils import Vector, Matrix
import numpy as np

ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'output/appearance/art-head'
# Each y ring stores half-width and the front/back silhouette depths. The chin,
# cheek/jaw angle, temporal width, occipital bulge and crown are independently
# shaped; this is not an ellipsoid with attached ears.
HEAD_PROFILE=np.array([
 [1.433,.003,.145,.133], [1.439,.020,.158,.115],
 [1.449,.035,.168,.088], [1.462,.049,.175,.056],
 [1.478,.059,.181,.030], [1.500,.066,.184,.009],
 [1.525,.071,.186,-.002], [1.550,.0735,.184,-.008],
 [1.575,.072,.176,-.006], [1.598,.064,.161,.008],
 [1.618,.049,.140,.029], [1.634,.028,.113,.057],
 [1.642,.003,.090,.083]
],dtype=float)
NECK_PROFILE=np.array([
 [1.298,.118,.151,-.009], [1.310,.095,.144,-.003],
 [1.325,.074,.136,.005], [1.345,.056,.125,.014],
 [1.370,.043,.114,.023], [1.397,.036,.104,.029],
 [1.425,.034,.095,.032], [1.455,.035,.088,.033],
 [1.487,.036,.087,.029]
],dtype=float)

def sm(t):
 t=max(0,min(1,float(t)));return t*t*(3-2*t)
def window(y,a,b,c,d):return sm((y-a)/(b-a))*(1-sm((y-c)/(d-c)))
def angle_delta(a,b):return math.atan2(math.sin(a-b),math.cos(a-b))

def slopes(profile):
 x=profile[:,0];v=profile[:,1:];h=np.diff(x);delta=np.diff(v,axis=0)/h[:,None];m=np.zeros_like(v)
 m[0]=delta[0];m[-1]=delta[-1]
 for i in range(1,len(x)-1):
  for j in range(v.shape[1]):
   a,b=delta[i-1,j],delta[i,j]
   if a*b>0:
    w1=2*h[i]+h[i-1];w2=h[i]+2*h[i-1];m[i,j]=(w1+w2)/(w1/a+w2/b)
 return m
HM=slopes(HEAD_PROFILE);NM=slopes(NECK_PROFILE)
def sample(profile,m,y):
 k=min(len(profile)-2,max(0,int(np.searchsorted(profile[:,0],y)-1)))
 h=profile[k+1,0]-profile[k,0];t=np.clip((y-profile[k,0])/h,0,1)
 return (2*t**3-3*t*t+1)*profile[k,1:]+(t**3-2*t*t+t)*h*m[k]+(-2*t**3+3*t*t)*profile[k+1,1:]+(t**3-t*t)*h*m[k+1]

def object_mesh(name,vertices,faces):
 mesh=bpy.data.meshes.new(name);mesh.from_pydata(vertices,[],faces);mesh.update()
 bm=bmesh.new();bm.from_mesh(mesh);bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces))
 if bm.calc_volume(signed=True)<0:bmesh.ops.reverse_faces(bm,faces=list(bm.faces))
 bm.to_mesh(mesh);bm.free();obj=bpy.data.objects.new(name,mesh);bpy.context.collection.objects.link(obj)
 return obj

def loft(name,profile,m,rows=128,n=128,neck=False):
 vertices=[];faces=[]
 for y in np.linspace(profile[0,0],profile[-1,0],rows):
  rx,front,back=sample(profile,m,y);center=(front+back)*.5;rf=front-center;rb=center-back
  for i in range(n):
   a=2*math.pi*i/n;c=math.cos(a);s=math.sin(a)
   x=rx*c;z=center+(rf if s>=0 else rb)*s
   if not neck:
    # Broad uninterrupted frontal plane; no brow, eye, mouth or nose geometry.
    if s>0:z+=.013*window(y,1.440,1.475,1.545,1.581)*4*s*(1-s)
   else:
    u=max(0,min(1,(y-1.325)/.159));ridge=0
    for sign in [-1,1]:
     theta=1.32-1.64*u
     if sign<0:theta=math.pi-theta
     width=.18+.06*math.sin(math.pi*u)
     ridge+=.0062*(math.sin(math.pi*u)**.65)*math.exp(-(angle_delta(a,theta)/width)**2)
     # Soft clavicular head branching from the same SCM belly.
     theta2=1.05-1.37*u
     if sign<0:theta2=math.pi-theta2
     ridge+=.0035*(math.sin(math.pi*u)**.9)*math.exp(-(angle_delta(a,theta2)/.21)**2)
    # Upper trapezius / nape flow, with a shallow central nuchal furrow.
    for theta in [-.83,math.pi+.83]:ridge+=.0045*window(y,1.305,1.335,1.432,1.475)*math.exp(-(angle_delta(a,theta)/.42)**2)
    ridge-=.0011*window(y,1.335,1.370,1.432,1.470)*math.exp(-(angle_delta(a,-math.pi/2)/.20)**2)
    x+=ridge*c;z+=ridge*s
   vertices.append((x,float(y),z))
 for j in range(rows-1):
  for i in range(n):
   a=j*n+i;b=j*n+(i+1)%n;faces.append((a,b,b+n,a+n))
 faces.append(tuple(range(n-1,-1,-1)));faces.append(tuple((rows-1)*n+i for i in range(n)))
 return object_mesh(name,vertices,faces)

def skull_x(y,z):
 rx,front,back=sample(HEAD_PROFILE,HM,y);center=(front+back)*.5;r=(front-center) if z>=center else (center-back)
 return float(rx*math.sqrt(max(.01,1-((z-center)/r)**2)))

def ear(sign):
 # Closed auricle surfaces. The root conforms to the actual skull; a raised
 # helix, conchal bowl, interrupted antihelix and tragal lip are sculpted into
 # one disk and joined volumetrically to the head, not separate ear balls.
 vertices=[];faces=[];n=112;nr=28;cy=1.516;cz=.053
 def point(r,a,front):
  c=math.cos(a);s=math.sin(a)
  y=cy+r*.0295*c*(1-.06*s)
  z=cz+r*.0175*s*(1+.08*c)+r*.0021*(1-c)*.5
  root=skull_x(y,z)-.0017
  if front:
   helix=.0113*math.exp(-((r-.83)/.105)**2)
   concha=.0010+.0018*r
   anti=.0050*math.exp(-((r-.45)/.095)**2)*(1-.60*max(0,s))
   tragus=.0040*math.exp(-((angle_delta(a,math.pi/2))/.34)**2)*math.exp(-((r-.57)/.20)**2)
   extension=(helix+concha+anti+tragus)*sm((1-r)/.08)
   x=root+extension
  else:x=root-.0024*(1-r*r)
  return (sign*x,y,z)
 for side in [True,False]:
  for j in range(nr+1):
   r=max(.001,j/nr)
   for i in range(n):vertices.append(point(r,2*math.pi*i/n,side))
 offset=(nr+1)*n
 for side in [0,1]:
  off=side*offset
  for j in range(nr):
   for i in range(n):
    a=off+j*n+i;b=off+j*n+(i+1)%n;faces.append((a,b,b+n,a+n))
  faces.append(tuple(off+i for i in range(n)))
 for i in range(n):
  a=nr*n+i;b=nr*n+(i+1)%n;faces.append((a,b,b+offset,a+offset))
 return object_mesh(('Left' if sign>0 else 'Right')+' anatomically shaped auricle',vertices,faces)

def apply(obj,mod):
 bpy.context.view_layer.objects.active=obj;bpy.ops.object.modifier_apply(modifier=mod.name)

def create_head(parts=None,name='Velora reference head and neck',voxel=.00085,target_triangles=62000):
 owned=[loft('Shaped faceless cranium and tapered mandible',HEAD_PROFILE,HM),loft('Continuous neck SCM and trapezius',NECK_PROFILE,NM,112,128,True),ear(1),ear(-1)]
 bpy.ops.object.select_all(action='DESELECT')
 for obj in owned:obj.select_set(True)
 bpy.context.view_layer.objects.active=owned[0];bpy.ops.object.join();obj=bpy.context.object;obj.name=name
 mod=obj.modifiers.new('Continuous sculpted head neck and ear skin','REMESH');mod.mode='VOXEL';mod.voxel_size=voxel;mod.use_smooth_shade=True;apply(obj,mod)
 mod=obj.modifiers.new('Sculpt surface relaxation','SMOOTH');mod.factor=.30;mod.iterations=2;apply(obj,mod)
 obj.data.calc_loop_triangles();triangles=len(obj.data.loop_triangles)
 if triangles>target_triangles:
  mod=obj.modifiers.new('Preserve sculpt curvature for product mesh','DECIMATE');mod.ratio=target_triangles/triangles;mod.use_collapse_triangulate=True;apply(obj,mod)
 for face in obj.data.polygons:face.use_smooth=True
 obj.data.update()
 if parts is not None:parts.append(obj)
 return obj

def set_camera(cam,location,target):
 cam.location=location;forward=(Vector(target)-cam.location).normalized();right=forward.cross(Vector((0,1,0))).normalized();up=right.cross(forward)
 cam.rotation_euler=Matrix((right,up,-forward)).transposed().to_euler()

def studio(obj):
 scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=48
 scene.render.resolution_x=840;scene.render.resolution_y=1024;scene.render.resolution_percentage=100
 scene.render.image_settings.file_format='PNG';scene.view_settings.view_transform='AgX'
 mat=bpy.data.materials.new('Uniform pale warm gray matte sculpture');mat.use_nodes=True
 bsdf=mat.node_tree.nodes.get('Principled BSDF');bsdf.inputs['Base Color'].default_value=(.67,.65,.62,1);bsdf.inputs['Roughness'].default_value=.78
 obj.data.materials.clear();obj.data.materials.append(mat)
 world=bpy.data.worlds.new('Neutral studio') if not scene.world else scene.world;scene.world=world;world.use_nodes=True
 nodes=world.node_tree.nodes;links=world.node_tree.links;nodes.clear()
 out=nodes.new('ShaderNodeOutputWorld');mix=nodes.new('ShaderNodeMixShader');lp=nodes.new('ShaderNodeLightPath')
 amb=nodes.new('ShaderNodeBackground');amb.inputs[0].default_value=(.86,.86,.86,1);amb.inputs[1].default_value=.32
 bg=nodes.new('ShaderNodeBackground');bg.inputs[0].default_value=(.87,.87,.87,1);bg.inputs[1].default_value=1
 links.new(lp.outputs['Is Camera Ray'],mix.inputs[0]);links.new(amb.outputs[0],mix.inputs[1]);links.new(bg.outputs[0],mix.inputs[2]);links.new(mix.outputs[0],out.inputs[0])
 bpy.ops.object.camera_add();cam=bpy.context.object;cam.data.type='ORTHO';cam.data.ortho_scale=.374;scene.camera=cam
 target=(0,1.477,.078)
 for name,power,loc,size in [('Soft key',36,(-.50,2.02,.75),.65),('Face fill',12,(.64,1.68,.70),.85),('Rim',20,(.45,1.95,-.65),.70)]:
  bpy.ops.object.light_add(type='AREA',location=loc);light=bpy.context.object;light.name=name;light.data.energy=power;light.data.shape='DISK';light.data.size=size
  light.rotation_euler=(Vector(target)-light.location).to_track_quat('-Z','Y').to_euler()
 return scene,cam,target

def export(obj):
 OUT.mkdir(parents=True,exist_ok=True);obj.data.calc_loop_triangles();p=[list(v.co) for v in obj.data.vertices];n=[list(v.normal) for v in obj.data.vertices];f=[list(t.vertices) for t in obj.data.loop_triangles]
 bm=bmesh.new();bm.from_mesh(obj.data);boundary=sum(e.is_boundary for e in bm.edges);nonmanifold=sum(not e.is_manifold for e in bm.edges);bm.free()
 meta={'name':obj.name,'units':'metres','up':'Y','scope':'Static art candidate only; no motion, skin or runtime changes','vertices':len(p),'triangles':len(f),'boundaryEdges':boundary,'nonManifoldEdges':nonmanifold,'crownY':1.642,'chinY':1.433,'cranialWidthMetres':.147,'cranialDepthMetres':.194,'reference':'codex-clipboard-fd4e04e6-98d4-482d-8134-d5cd80f9b0e1.png','construction':'Sculpted cranium/jaw/faceless frontal plane, skull-conforming helix/concha/antihelix ears, continuous SCM and trapezius neck'}
 (OUT/'head-neck.json').write_text(json.dumps({'positions':np.asarray(p).reshape(-1).tolist(),'normals':np.asarray(n).reshape(-1).tolist(),'indices':np.asarray(f).reshape(-1).tolist(),'meta':meta}))
 (OUT/'head-report.json').write_text(json.dumps(meta,indent=2));bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'head-neck.blend'))
 bpy.ops.object.select_all(action='DESELECT');obj.select_set(True);bpy.context.view_layer.objects.active=obj
 bpy.ops.export_scene.gltf(filepath=str(OUT/'head-neck.glb'),export_format='GLB',use_selection=True,export_yup=False)
 return meta

def main():
 start=time.time();bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
 obj=create_head();scene,cam,target=studio(obj);meta=export(obj);print(json.dumps(meta),flush=True)
 views=[('front',(0,1.477,1.08)),('side',(1,1.477,.078)),('back',(0,1.477,-.92)),('three-quarter',(.707,1.477,.785))]
 for name,location in views:
  set_camera(cam,location,target);scene.render.filepath=str(OUT/f'head-{name}.png');bpy.ops.render.render(write_still=True)
 print(json.dumps({'stage':'head candidate complete','seconds':round(time.time()-start,2)}),flush=True)

if __name__=='__main__':main()
