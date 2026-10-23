"""Source-derived, closed athlete exterior. Run with Blender --background --python.

The anatomical source and rig are preserved. This creates a separate appearance
surface from the true source muscle forms, with completion of missing skin
envelopes and a faceless sculpted head. Output uses Three.js runtime axes, metres.
"""
import bpy, bmesh, json, math, struct, time, re, os
from pathlib import Path
from mathutils import Vector
import numpy as np

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'public/appearance'
REPORT = ROOT / 'output/appearance'
OUT.mkdir(exist_ok=True, parents=True)
REPORT.mkdir(exist_ok=True, parents=True)
START = time.time()
VOXEL = float(os.environ.get('APPEARANCE_VOXEL', '.0023'))
TARGET_FACES = int(os.environ.get('APPEARANCE_TARGET_FACES', '165000'))
PREFIX = os.environ.get('APPEARANCE_OUTPUT_PREFIX', 'athlete-surface')
parts = []
log = {'source': [], 'stages': [], 'voxelMetres': VOXEL}

def note(stage, **data):
    item = {'stage': stage, 'seconds': round(time.time()-START, 2), **data}
    log['stages'].append(item)
    print(json.dumps(item), flush=True)

def mesh_object(name, vertices, faces):
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    parts.append(obj)
    return obj

def glb_parts(filename):
    raw = (ROOT/'public'/filename).read_bytes()
    n = struct.unpack_from('<I',raw,12)[0]
    doc = json.loads(raw[20:20+n])
    binary = raw[28+n:]
    def array(ai):
        a = doc['accessors'][ai]; v = doc['bufferViews'][a['bufferView']]
        dt = {5126:'<f4', 5125:'<u4', 5123:'<u2', 5121:'u1'}[a['componentType']]
        w = {'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4}[a['type']]
        off = v.get('byteOffset',0)+a.get('byteOffset',0)
        if v.get('byteStride',0):
            return np.ndarray((a['count'],w),dt,binary,offset=off,strides=(v['byteStride'],np.dtype(dt).itemsize)).copy()
        return np.frombuffer(binary,dt,a['count']*w,off).reshape(-1,w).copy()
    rows=[]
    for m in doc['meshes']:
        p=m['primitives'][0]
        v=array(p['attributes']['POSITION']).astype(np.float64)
        v=v[:,[0,2,1]]/1000
        v[:,2] *= -1
        f=array(p['indices']).reshape(-1,3)
        # This axis transform is right-handed (no winding reversal).
        n=m['name'].lower()
        c=v.mean(0)
        hand = ((c[1]<.82 and (v[:,0].min()>.17 or v[:,0].max()<-.17)) or
                bool(re.search(r'finger|thumb|metacarpal|scaphoid|lunate|triquetr|pisiform|trapezium|trapezoid|capitate|hamate',n)))
        forearm = (filename=='anatomy.glb' and bool(re.search(r'pronator|supinator|brachioradialis|carpi|digitorum (profundus|superficialis)|extensor (pollicis|indicis|digiti|digitorum)|flexor pollicis longus|abductor pollicis longus|palmaris|interosseous membrane',n)))
        if hand or forearm:
            v[:,2] -= .45*np.maximum(0,.79-v[:,1])
        rows.append({'name':m['name'],'positions':v,'faces':f,'hand':hand,'forearm':forearm})
    return rows

def smooth(t):
    t=np.clip(t,0,1); return t*t*(3-2*t)

def lean(vertices):
    """Reduce radii around source bone axes; do not move any rig pivot."""
    v=vertices.copy(); x,y,z=v.T; ax=np.abs(x); side=np.sign(x)
    # Chest/waist stay source-shaped; soften the original deep muscle bulk.
    torso=(1-smooth((ax-.135)/.075))*smooth((y-.77)/.12)*(1-smooth((y-1.30)/.09))
    v[:,0] *= 1-.045*torso
    v[:,2] = .09+(v[:,2]-.09)*(1-.095*torso)
    # Long limbs: shrink local cross sections without shortening bone chains.
    for lo,hi,c0,c1,amount in [(.41,.79,(.073,.083),(.088,.079),.065),
                              (.035,.35,(.071,.074),(.073,.083),.055),
                              (1.06,1.30,(.220,.083),(.165,.076),.07),
                              (.84,1.02,(.258,.112),(.220,.083),.04)]:
        t=np.clip((y-lo)/(hi-lo),0,1)
        cx=side*(c0[0]+(c1[0]-c0[0])*t); cz=c0[1]+(c1[1]-c0[1])*t
        mask=smooth((y-lo)/.04)*(1-smooth((y-hi+.04)/.04))
        if lo>.80: mask*=smooth((ax-.145)/.04)
        else: mask*=1-smooth((ax-.175)/.025)
        v[:,0]=cx+(v[:,0]-cx)*(1-amount*mask)
        v[:,2]=cz+(v[:,2]-cz)*(1-amount*mask)
    return v

def ellipsoid(name, center, scale, segments=32, rings=20):
    vertices=[]; faces=[]
    for j in range(rings+1):
        t=math.pi*j/rings
        for i in range(segments):
            a=2*math.pi*i/segments
            vertices.append((center[0]+scale[0]*math.sin(t)*math.cos(a),
                             center[1]+scale[1]*math.cos(t),
                             center[2]+scale[2]*math.sin(t)*math.sin(a)))
    for j in range(rings):
        for i in range(segments):
            a=j*segments+i;b=j*segments+(i+1)%segments
            faces.append((a,b,b+segments,a+segments))
    return mesh_object(name,vertices,faces)

def capsule(name,a,b,ra,rb=None,radial=20):
    a,b=Vector(a),Vector(b); rb=ra if rb is None else rb
    direction=(b-a).normalized(); seed=Vector((0,0,1))
    if abs(direction.dot(seed))>.9: seed=Vector((1,0,0))
    u=direction.cross(seed).normalized(); v=direction.cross(u).normalized()
    vertices=[]; faces=[]
    profile=[]
    for j in range(5):
        t=-math.pi/2+j*math.pi/8
        profile.append((a+direction*(ra*math.sin(t)),ra*math.cos(t)))
    profile.append((b,rb))
    for j in range(1,5):
        t=j*math.pi/8
        profile.append((b+direction*(rb*math.sin(t)),rb*math.cos(t)))
    for c,r in profile:
        for i in range(radial):
            q=c+r*(u*math.cos(i*2*math.pi/radial)+v*math.sin(i*2*math.pi/radial))
            vertices.append(q)
    for j in range(len(profile)-1):
        for i in range(radial):
            a0=j*radial+i; a1=j*radial+(i+1)%radial
            faces.append((a0,a1,a1+radial,a0+radial))
    return mesh_object(name,vertices,faces)

def convex_envelope(name, vertices, inflate=0):
    bm=bmesh.new()
    for p in vertices: bm.verts.new(p)
    bm.verts.ensure_lookup_table()
    bmesh.ops.convex_hull(bm,input=list(bm.verts),use_existing_faces=False)
    loose=[v for v in bm.verts if not v.link_faces]
    bmesh.ops.delete(bm,geom=loose,context='VERTS')
    bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces))
    bm.normal_update()
    if inflate:
        for v in bm.verts: v.co += v.normal*inflate
    mesh=bpy.data.meshes.new(name);bm.to_mesh(mesh);bm.free()
    obj=bpy.data.objects.new(name,mesh);bpy.context.collection.objects.link(obj);parts.append(obj)
    return obj

def head_loft():
    # One closed scalp / jaw / chin. The face is a single uninterrupted surface.
    rings=[(1.420,.026,.029,.126),(1.433,.039,.040,.124),(1.451,.053,.052,.119),
           (1.480,.064,.064,.109),(1.517,.069,.073,.098),(1.553,.069,.073,.091),
           (1.588,.061,.065,.086),(1.618,.044,.049,.084),(1.636,.015,.018,.084),
           (1.639,.001,.001,.084)]
    # Catmull-Rom profile prevents the visible planar bands of a sparse loft.
    controls=[np.array(r) for r in rings]
    refined=[]
    for j in range(len(controls)-1):
        p0=controls[max(0,j-1)];p1=controls[j];p2=controls[j+1];p3=controls[min(len(controls)-1,j+2)]
        for k in range(6):
            t=k/6
            refined.append(.5*((2*p1)+(-p0+p2)*t+(2*p0-5*p1+4*p2-p3)*t*t+(-p0+3*p1-3*p2+p3)*t*t*t))
    refined.append(controls[-1]);rings=refined
    vertices=[];faces=[]; n=64
    for y,rx,rz,z in rings:
        for i in range(n):
            a=2*math.pi*i/n
            # Front contour has a soft facial plane; no eyes, mouth, nose.
            s=math.sin(a)
            vertices.append((rx*math.cos(a),y,z+rz*(s if s<0 else s**.82)))
    faces.append(tuple(range(n-1,-1,-1)))
    for j in range(len(rings)-1):
        for i in range(n):
            faces.append((j*n+i,j*n+(i+1)%n,(j+1)*n+(i+1)%n,(j+1)*n+i))
    faces.append(tuple((len(rings)-1)*n+i for i in range(n)))
    obj=mesh_object('Complete faceless head',vertices,faces)
    for sign in [-1,1]:
        # Low, soft helix and a shallow concha, with an attached rounded lobe.
        ev=[];ef=[];nt=48;nr=10
        for j in range(nr+1):
            r=j/nr
            for i in range(nt):
                a=2*math.pi*i/nt;sy=math.sin(a)
                y=1.507+(.021 if sy>0 else .018)*r*sy
                z=.088+.0105*r*math.cos(a)-.002*r*sy
                rim=.0020*math.exp(-((r-.83)/.16)**2)
                ev.append((sign*(.067+.005*r**.75+rim),y,z))
        for j in range(nr):
            for i in range(nt):ef.append((j*nt+i,j*nt+(i+1)%nt,(j+1)*nt+(i+1)%nt,(j+1)*nt+i))
        back=len(ev);ev.append((sign*.061,1.507,.088))
        for i in range(nt):ef.append((nr*nt+i,nr*nt+(i+1)%nt,back))
        mesh_object('Complete soft sculpted ear',ev,ef)
    return obj

def apply_modifier(obj,mod):
    bpy.context.view_layer.objects.active=obj
    bpy.ops.object.modifier_apply(modifier=mod.name)

def remesh(obj,size):
    mod=obj.modifiers.new('Unified true 3D skin volume','REMESH');mod.mode='VOXEL';mod.voxel_size=size;mod.use_smooth_shade=True
    apply_modifier(obj,mod)

def displace(obj,amount):
    mod=obj.modifiers.new('Skin envelope offset','DISPLACE');mod.strength=amount;mod.mid_level=0
    apply_modifier(obj,mod)

def toe_cleft(obj,sign,start,end,width=.0022):
    """A rounded web-space cut is real geometry, not a painted toe line."""
    a=Vector((sign*start[0],-.056,start[1]));b=Vector((sign*end[0],-.056,end[1]))
    mid=(a+b)*.5;direction=(b-a).normalized();length=(b-a).length
    bpy.ops.mesh.primitive_cube_add(size=1,location=mid)
    cutter=bpy.context.object;cutter.name='Rounded interdigital web space'
    # Cube local X follows the toe direction, local Y is vertical, local Z width.
    u=direction;v=Vector((0,1,0));w=u.cross(v)
    from mathutils import Matrix
    cutter.rotation_euler=Matrix((u,v,w)).transposed().to_euler()
    cutter.scale=(length,.065,width)
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    bevel=cutter.modifiers.new('Natural web rounding','BEVEL');bevel.width=width*.46;bevel.segments=3
    apply_modifier(cutter,bevel)
    boolean=obj.modifiers.new('True toe separation','BOOLEAN');boolean.operation='DIFFERENCE';boolean.solver='EXACT';boolean.object=cutter
    apply_modifier(obj,boolean)
    bpy.data.objects.remove(cutter,do_unlink=True)

def main():
    bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
    muscles=glb_parts('anatomy.glb');bones=glb_parts('skeleton.glb')
    bone_names={b['name'] for b in bones}
    log['source']=[{'asset':'anatomy.glb','meshes':len(muscles),'vertices':sum(len(r['positions']) for r in muscles)},
                   {'asset':'skeleton.glb','meshes':len(bones),'vertices':sum(len(r['positions']) for r in bones)}]
    note('read sources')
    # Preserve source muscle shape; remove detailed face / skull anatomy only.
    for row in muscles+bones:
        vertices=row['positions'];faces=row['faces']
        is_bone=row['name'] in bone_names
        if re.search(r'iliotibial tract|interosseous membrane|palmar aponeurosis',row['name']):continue
        # Exposed vertebral / scapular / jaw fragments have no place in the new
        # exterior. Their muscle contours are retained, and closed soft tissue
        # replaces their visual contribution.
        if is_bone and vertices[:,1].max()>1.29: continue
        if vertices[:,1].max()>1.435 and not re.search(r'sternocleidomastoid|trapezius|longus colli|semispinalis|splenius',row['name']): continue
        keep=np.all(vertices[faces,1]<1.435,axis=1)
        # End effectors receive a complete, source-fitted exterior below.
        if row['hand'] or vertices[:,1].max()<.015: continue
        if not np.any(keep):continue
        vv=lean(vertices)
        mesh_object(row['name'],vv.tolist(),faces[keep].tolist())
    note('source contours constructed',objects=len(parts))
    # Internal volume completion sits beneath major surface muscle contours.
    ellipsoid('Thoracic closed core',(0,1.176,.091),(.135,.17,.105))
    ellipsoid('Waist closed core',(0,1.001,.099),(.102,.14,.087))
    ellipsoid('Pelvic closed core',(0,.823,.084),(.123,.116,.083))
    ellipsoid('Pelvic perineum',(0,.754,.084),(.050,.055,.050))
    capsule('Complete neck',(0,1.302,.081),(0,1.444,.088),.049,.038,32)
    head_loft()
    # Close joint interiors without changing visible major-muscle anatomy.
    for sign in [-1,1]:
        ellipsoid('Scapular soft tissue',(sign*.102,1.258,.029),(.081,.095,.047))
        ellipsoid('Posterior neck transition',(sign*.023,1.360,.055),(.035,.077,.042))
        ellipsoid('Collar neck soft transition',(sign*.036,1.337,.110),(.025,.045,.035))
        ellipsoid('Filled supraclavicular transition',(sign*.147,1.328,.068),(.037,.028,.035))
        capsule('Soft clavicular contour',(sign*.018,1.326,.128),(sign*.157,1.318,.088),.012,.016,28)
        for name,a,b,ra,rb in [('hip',(sign*.088,.805,.079),(sign*.080,.70,.081),.054,.052),
                              ('knee',(sign*.073,.407,.082),(sign*.073,.337,.083),.038,.036),
                              ('elbow',(sign*.218,1.07,.083),(sign*.228,1.018,.088),.031,.029),
                              ('ankle',(sign*.071,.05,.074),(sign*.071,-.025,.079),.027,.029),
                              ('wrist',(sign*.256,.843,.111),(sign*.261,.775,.115),.025,.024)]:
            capsule(name,a,b,ra,rb)
    # Source bone-fitted palms. Individual digits retain distinct web spaces.
    src=(ROOT/'src/universalSkeleton.js').read_text()
    finger_text=src.split('const FINGER_POINTS = ',1)[1].split(';',1)[0]
    finger_data=json.loads(finger_text)
    for side,sign in [('left',1),('right',-1)]:
        palm_rows=[r for r in bones if side in r['name'] and re.search(r'metacarpal|scaphoid|lunate|triquetr|pisiform|trapezium|trapezoid|capitate|hamate',r['name'])]
        palm=np.concatenate([r['positions'] for r in palm_rows])
        # Bone hull + 4.5 mm soft tissue, with full thenar/hypothenar volume.
        convex_envelope(side+' complete palm',palm[::2],.0045)
        for finger in ['thumb','index','middle','ring','little']:
            pp=finger_data[side][finger]['points']
            radii={'thumb':[.012,.0105,.0095,.0085], 'index':[.010,.0092,.0083,.0075,.007],
                   'middle':[.010,.0094,.0085,.0076,.007], 'ring':[.0095,.009,.008,.0072,.0068],
                   'little':[.009,.0082,.0074,.0067,.0062]}[finger]
            for j in range(1,len(pp)-1):
                capsule(side+' '+finger+' skin',pp[j],pp[j+1],radii[j],radii[j+1],16)
            capsule(side+' '+finger+' web',pp[0],pp[1],radii[0],radii[1],16)
        # Hind and mid-foot source envelope; keep toe tips independently shaped.
        foot_rows=[r for r in bones if side in r['name'] and r['positions'][:,1].max()<.015 and not re.search(r'phalanx',r['name'])]
        foot=np.concatenate([r['positions'] for r in foot_rows])
        convex_envelope(side+' complete foot',foot[::2],.004)
        for toe,rad in [('big',.011),('second',.0078),('third',.007),('fourth',.0064),('little',.006)]:
            toe_rows=[r for r in bones if f'{side} {toe} toe' in r['name']]
            for row in toe_rows:
                vv=row['positions'];lo=vv.min(0);hi=vv.max(0);c=vv.mean(0)
                a=c.copy();b=c.copy();a[2]=lo[2]+rad*.3;b[2]=hi[2]-rad*.3
                capsule(side+' '+toe+' toe skin',a,b,rad,rad*.9,16)
    note('complete head and distal envelopes',objects=len(parts))
    bpy.ops.object.select_all(action='DESELECT')
    for p in parts:p.select_set(True)
    bpy.context.view_layer.objects.active=parts[0]
    bpy.ops.object.join(); obj=bpy.context.object;obj.name='Velora lean athlete appearance'
    # A three-dimensional morphological closing blends narrow dissection seams.
    remesh(obj,VOXEL)
    note('initial union',vertices=len(obj.data.vertices),faces=len(obj.data.polygons))
    displace(obj,.0038)
    remesh(obj,VOXEL)
    displace(obj,-.0028)
    mod=obj.modifiers.new('Natural source contour smoothing','SMOOTH');mod.factor=.9;mod.iterations=8
    apply_modifier(obj,mod)
    # Anatomical dissection has many millimetre-scale cut edges. Smooth these
    # over the body while preserving separate fingers, toes and major contours.
    vg=obj.vertex_groups.new(name='Body surface refinement')
    for vertex in obj.data.vertices:
        x,y,z=vertex.co
        protect_hand=(abs(x)>.17 and y<.83)
        if protect_hand or y<.02: continue
        weight=.50
        if y>1.30:weight=1
        if .31<y<.43:weight=1
        if .83<y<1.05 and abs(x)>.16:weight=.95
        vg.add([vertex.index],weight,'REPLACE')
    mod=obj.modifiers.new('Body sculpt finish','SMOOTH');mod.factor=.82;mod.iterations=20;mod.vertex_group=vg.name
    apply_modifier(obj,mod)
    note('smooth exterior',vertices=len(obj.data.vertices),faces=len(obj.data.polygons))
    # Keep only the connected body, removing invisible enclosed artifacts.
    bm=bmesh.new();bm.from_mesh(obj.data)
    unseen=set(bm.verts);components=[]
    while unseen:
        seed=unseen.pop();stack=[seed];comp=[seed]
        while stack:
            v=stack.pop()
            for edge in v.link_edges:
                n=edge.other_vert(v)
                if n in unseen:unseen.remove(n);stack.append(n);comp.append(n)
        components.append(comp)
    largest=max(components,key=len)
    remove=[v for comp in components if comp is not largest for v in comp]
    bmesh.ops.delete(bm,geom=remove,context='VERTS')
    bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces))
    bm.to_mesh(obj.data);bm.free()
    # Shallow geometric rectus bellies preserve a readable athlete abdomen
    # without exaggerating its volume or changing the muscle ID mapping.
    for vertex in obj.data.vertices:
        x,y,z=vertex.co
        if .815<y<1.17 and abs(x)<.079 and z>.17:
            front=float(smooth((z-.17)/.025))
            bulge=sum(.0025*math.exp(-((abs(x)-.034)/.024)**2-((y-c)/.026)**2) for c in [1.125,1.047,.971,.899])
            vertex.co.z+=bulge*front
    # Exterior-only plantar correction against the existing support calibration.
    foot=[v for v in obj.data.vertices if v.co.y<-.03]
    lowest=min(v.co.y for v in foot);delta=-.0738-lowest
    for v in foot:v.co.y+=delta*(1-float(smooth((v.co.y+.074)/.014)))
    note('connected exterior',removedComponents=len(components)-1,removedVertices=len(remove))
    # Preserve fine fingers, face and muscle definition while limiting cost.
    tri_est=sum(len(p.vertices)-2 for p in obj.data.polygons)
    if tri_est>TARGET_FACES:
        mod=obj.modifiers.new('Product mesh budget','DECIMATE');mod.ratio=TARGET_FACES/tri_est
        apply_modifier(obj,mod)
    # Global anatomical seam closing must not leave a mitten-shaped forefoot.
    # Rounded, tapering 3D web spaces separate all five source-fitted toe tips.
    for sign in [-1,1]:
        for start,end in [((.112,.198),(.131,.252)),((.132,.197),(.150,.246)),
                          ((.145,.187),(.166,.232)),((.157,.174),(.178,.217))]:
            toe_cleft(obj,sign,start,end)
    # Exact Boolean intersections may produce sub-micron duplicate vertices.
    bm=bmesh.new();bm.from_mesh(obj.data)
    bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=.000002)
    bmesh.ops.dissolve_degenerate(bm,edges=list(bm.edges),dist=.000001)
    # A Boolean can leave an infinitesimal triangular flap attached along one
    # edge. Remove only those surplus faces; the two primary faces remain.
    flaps=[f for f in bm.faces if sum(e.is_boundary for e in f.edges)>=2 and any(len(e.link_faces)>2 for e in f.edges)]
    if flaps:bmesh.ops.delete(bm,geom=flaps,context='FACES')
    bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(obj.data);bm.free()
    mod=obj.modifiers.new('Unified surface triangles','TRIANGULATE');apply_modifier(obj,mod)
    bm=bmesh.new();bm.from_mesh(obj.data)
    flaps=[f for f in bm.faces if sum(e.is_boundary for e in f.edges)>=2 and any(len(e.link_faces)>2 for e in f.edges)]
    if flaps:bmesh.ops.delete(bm,geom=flaps,context='FACES')
    bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(obj.data);bm.free()
    for p in obj.data.polygons:p.use_smooth=True
    obj.data.update()
    # Closed surface diagnosis, before export.
    bm=bmesh.new();bm.from_mesh(obj.data)
    boundary=sum(e.is_boundary for e in bm.edges);nonmanifold=sum(not e.is_manifold for e in bm.edges)
    remaining=set(bm.verts);component_sizes=[]
    while remaining:
        seed=remaining.pop();stack=[seed];size=1
        while stack:
            v=stack.pop()
            for edge in v.link_edges:
                n=edge.other_vert(v)
                if n in remaining:remaining.remove(n);stack.append(n);size+=1
        component_sizes.append(size)
    bm.free()
    positions=[c for v in obj.data.vertices for c in v.co]
    normals=[c for v in obj.data.vertices for c in v.normal]
    indices=[int(i) for p in obj.data.polygons for i in p.vertices]
    meta={'name':obj.name,'units':'metres','up':'Y','source':'BodyExplorer / BodyParts3D + Z-Anatomy',
          'construction':'Source-derived voxel union, closed local soft-tissue envelopes, faceless head loft; runtime rig unchanged',
          'vertices':len(obj.data.vertices),'triangles':len(obj.data.polygons),'boundaryEdges':boundary,'nonManifoldEdges':nonmanifold,
          'surfaceComponents':len(component_sizes),'componentVertexCounts':sorted(component_sizes,reverse=True),'voxelMetres':VOXEL}
    (OUT/f'{PREFIX}.json').write_text(json.dumps({'positions':positions,'normals':normals,'indices':indices,'meta':meta},separators=(',',':')))
    # Native editable artifact keeps authored geometry and rebuild provenance.
    material=bpy.data.materials.new('Warm grey matte sculpture');material.diffuse_color=(.57,.55,.51,1);material.use_nodes=True
    p=material.node_tree.nodes.get('Principled BSDF');p.inputs['Base Color'].default_value=(.57,.55,.51,1);p.inputs['Roughness'].default_value=.78
    obj.data.materials.clear();obj.data.materials.append(material)
    bpy.ops.object.select_all(action='DESELECT');obj.select_set(True);bpy.context.view_layer.objects.active=obj
    bpy.ops.wm.save_as_mainfile(filepath=str(OUT/f'{PREFIX}.blend'))
    # JSON is authoritative for runtime axes. GLB handles standard glTF axis conversion.
    bpy.ops.export_scene.gltf(filepath=str(OUT/f'{PREFIX}.glb'),export_format='GLB',use_selection=True,export_yup=False)
    note('exported',**meta)
    log['result']=meta;log['totalSeconds']=round(time.time()-START,2)
    (REPORT/('build-report.json' if PREFIX=='athlete-surface' else f'{PREFIX}-build-report.json')).write_text(json.dumps(log,indent=2))

if __name__=='__main__':main()
