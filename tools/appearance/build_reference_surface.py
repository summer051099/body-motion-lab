"""Measured major-muscle exterior, authored to the supplied athlete references.

This alternative builder removes millimetre-scale dissection cut edges before
surface reconstruction. Cross-sections follow the actual major source muscles;
the source muscle registry and runtime skeleton are not modified.
"""
import bpy,bmesh,json,math,importlib.util,time,re
import numpy as np
from pathlib import Path
from mathutils import Vector

ROOT=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('appearance_helpers',Path(__file__).with_name('build_surface.py'))
h=importlib.util.module_from_spec(spec);spec.loader.exec_module(h)
OUT=ROOT/'public/appearance';REPORT=ROOT/'output/appearance';START=time.time()
PREFIX='athlete-reference-candidate'
stages=[]

def note(stage,**kw):
    row={'stage':stage,'seconds':round(time.time()-START,2),**kw};stages.append(row);print(json.dumps(row),flush=True)

def soften_grid(r,passes=2,anglepasses=2):
    for _ in range(passes):
        p=np.pad(r,((1,1),(0,0)),mode='edge');r=.25*p[:-2]+.5*p[1:-1]+.25*p[2:]
    for _ in range(anglepasses):r=.25*np.roll(r,1,1)+.5*r+.25*np.roll(r,-1,1)
    return r

def radial_fit(points,ys,cxs,czs,rxs,rzs,n=96,window=.014,cap=False,name='Source-fitted surface',region=''):
    angles=np.arange(n)*2*math.pi/n
    radii=[]
    for y,cx,cz,rx,rz in zip(ys,cxs,czs,rxs,rzs):
        pool=points[np.abs(points[:,1]-y)<window]
        ellipse=1/np.sqrt((np.cos(angles)/rx)**2+(np.sin(angles)/rz)**2)
        if len(pool)<10:radii.append(ellipse);continue
        dx=pool[:,0]-cx;dz=pool[:,2]-cz;rad=np.hypot(dx,dz);a=np.arctan2(dz,dx)
        ring=np.zeros(n)
        for k,theta in enumerate(angles):
            da=np.abs(np.arctan2(np.sin(a-theta),np.cos(a-theta)))
            selected=rad[da<.09]
            ring[k]=np.percentile(selected,94) if len(selected)>2 else 0
        valid=np.flatnonzero(ring>0)
        if len(valid)<n:
            if len(valid)>5:
                ring=np.interp(np.arange(n),np.r_[valid-n,valid,valid+n],np.tile(ring[valid],3))
            else:ring=ellipse
        # A true outer skin envelope closes any residual source cut cavities.
        ring=np.maximum(ring,ellipse*.94)
        radii.append(ring)
    radii=soften_grid(np.array(radii),10,3)
    for j,(y,rx,rz) in enumerate(zip(ys,rxs,rzs)):
        ellipse=1/np.sqrt((np.cos(angles)/rx)**2+(np.sin(angles)/rz)**2)
        blend=0
        if region=='torso':blend=max(float(h.smooth((y-1.290)/.030)),float(1-h.smooth((y-.712)/.030)))
        if region=='arm':blend=float(h.smooth((y-1.305)/.024))
        if region=='leg':blend=max(float(1-h.smooth((y-.005)/.05)),float(h.smooth((y-.825)/.045)))
        radii[j]=radii[j]*(1-blend)+ellipse*blend
        # The envelope is a complete fairing core. Major true source muscles
        # are restored above it; this recess preserves their natural lobes.
        recess=.0043
        if region=='torso':recess*=float(1-h.smooth((y-1.27)/.025))
        if region=='arm':recess*=float(h.smooth((y-.84)/.04))
        if region=='leg':recess*=float(h.smooth((y-.03)/.05))
        radii[j]=np.maximum(.0008,radii[j]-recess)
    vertices=[];faces=[]
    for j,(y,cx,cz) in enumerate(zip(ys,cxs,czs)):
        for k,a in enumerate(angles):vertices.append((cx+radii[j,k]*math.cos(a),y,cz+radii[j,k]*math.sin(a)))
    for j in range(len(ys)-1):
        for k in range(n):faces.append((j*n+k,j*n+(k+1)%n,(j+1)*n+(k+1)%n,(j+1)*n+k))
    faces.append(tuple(range(n-1,-1,-1)));faces.append(tuple((len(ys)-1)*n+i for i in range(n)))
    return h.mesh_object(name,vertices,faces)

def authored_loft(name,rings,n=96):
    # Smooth interpolation of radius, center and y; same closed 3D volume in all views.
    controls=[np.array(r) for r in rings];refined=[]
    for j in range(len(controls)-1):
        p0=controls[max(0,j-1)];p1=controls[j];p2=controls[j+1];p3=controls[min(len(controls)-1,j+2)]
        for k in range(6):
            t=k/6;refined.append(.5*((2*p1)+(-p0+p2)*t+(2*p0-5*p1+4*p2-p3)*t*t+(-p0+3*p1-3*p2+p3)*t*t*t))
    refined.append(controls[-1]);vertices=[];faces=[]
    for y,rx,rz,cz in refined:
        for i in range(n):
            a=2*math.pi*i/n;s=math.sin(a)
            vertices.append((rx*math.cos(a),y,cz+rz*(s if s<0 else s**.76)))
    for j in range(len(refined)-1):
        for k in range(n):faces.append((j*n+k,j*n+(k+1)%n,(j+1)*n+(k+1)%n,(j+1)*n+k))
    faces.append(tuple(range(n-1,-1,-1)));faces.append(tuple((len(refined)-1)*n+i for i in range(n)))
    return h.mesh_object(name,vertices,faces)

def ear(sign):
    # Sculpted helix, antihelix, concha and attached lobe, fully volumetric.
    vertices=[];faces=[];nt=56;nr=10
    for j in range(nr+1):
        r=j/nr
        for i in range(nt):
            a=2*math.pi*i/nt;sy=math.sin(a);co=math.cos(a)
            y=1.507+(.022 if sy>0 else .019)*r*sy
            z=.088+.0105*r*co-.002*r*sy
            rim=.0040*math.exp(-((r-.83)/.15)**2)
            inner=.0014*math.exp(-((r-.48)/.14)**2)
            x=sign*(.065+.007*r**.75+rim+inner)
            vertices.append((x,y,z))
    for j in range(nr):
        for i in range(nt):faces.append((j*nt+i,j*nt+(i+1)%nt,(j+1)*nt+(i+1)%nt,(j+1)*nt+i))
    back=len(vertices);vertices.append((sign*.061,1.507,.088))
    for i in range(nt):faces.append((nr*nt+i,nr*nt+(i+1)%nt,back))
    return h.mesh_object('Sculpted ear helix',vertices,faces)

def end_effectors(bones):
    text=(ROOT/'src/universalSkeleton.js').read_text();finger_data=json.loads(text.split('const FINGER_POINTS = ',1)[1].split(';',1)[0])
    for side,sign in [('left',1),('right',-1)]:
        palm_rows=[r for r in bones if side in r['name'] and re.search(r'metacarpal|scaphoid|lunate|triquetr|pisiform|trapezium|trapezoid|capitate|hamate',r['name'])]
        palm=np.concatenate([r['positions'] for r in palm_rows]);h.convex_envelope(side+' complete palm',palm[::2],.0035)
        for finger in ['thumb','index','middle','ring','little']:
            pp=finger_data[side][finger]['points'];radii={'thumb':[.011,.010,.009,.008], 'index':[.0095,.0086,.0078,.007,.0066],
                'middle':[.0095,.0089,.008,.0071,.0066], 'ring':[.009,.0084,.0075,.0068,.0063], 'little':[.0085,.0077,.0069,.0063,.0059]}[finger]
            for j in range(len(pp)-1):h.capsule(side+' '+finger+' soft tissue',pp[j],pp[j+1],radii[j],radii[j+1],20)
        foot_rows=[r for r in bones if side in r['name'] and r['positions'][:,1].max()<.015 and not re.search(r'phalanx',r['name'])]
        foot=np.concatenate([r['positions'] for r in foot_rows]);h.convex_envelope(side+' complete foot',foot[::2],.0035)
        for toe,rad in [('big',.011),('second',.0078),('third',.007),('fourth',.0064),('little',.006)]:
            for row in [r for r in bones if f'{side} {toe} toe' in r['name']]:
                vv=row['positions'];lo=vv.min(0);hi=vv.max(0);c=vv.mean(0);a=c.copy();b=c.copy();a[2]=lo[2]+rad*.3;b[2]=hi[2]-rad*.3
                h.capsule(side+' '+toe+' toe',a,b,rad,rad*.9,20)

def sculpt_surface(obj):
    for v in obj.data.vertices:
        x,y,z=v.co;ax=abs(x)
        # Eight restrained rectus bellies and the linea alba are geometry.
        if .805<y<1.178 and ax<.085 and z>.155:
            front=h.smooth((z-.155)/.028)
            mask=h.smooth((y-.805)/.035)*(1-h.smooth((y-1.145)/.033))
            bulge=sum(.0038*math.exp(-((ax-.033)/.024)**2-((y-c)/.028)**2) for c in [1.125,1.047,.971,.899])
            line=.0028*math.exp(-(x/.0042)**2)*mask
            v.co.z+=(bulge-line)*front
        # Clean pectoral border and a few broad fibre separations, not ribs.
        if 1.15<y<1.33 and ax<.173 and z>.150:
            front=h.smooth((z-.15)/.035);side=h.smooth((ax-.006)/.013)*(1-h.smooth((ax-.15)/.025))
            center=.0025*math.exp(-(x/.0045)**2)
            grooves=0
            for intercept,slope in [(1.281,-.10),(1.247,.035),(1.208,.27)]:
                grooves+=.00125*math.exp(-((y-(intercept+slope*ax))/.0028)**2)*side
            lower=1.157+.30*ax
            edge=.0020*math.exp(-((y-lower)/.004)**2)*side
            v.co.z-=(center+grooves+edge)*front
        # Sculpted clavicle and soft supraclavicular hollow, no open pits.
        if 1.30<y<1.375 and ax<.17 and z>.1:
            line=1.329-.045*ax/.17
            v.co.z+=.0032*math.exp(-((y-line)/.006)**2)*(1-h.smooth((ax-.145)/.025))
        # Quadriceps divisions follow the longitudinal source muscle direction.
        if .435<y<.78 and .025<ax<.17 and z>.105:
            mask=h.smooth((y-.435)/.06)*(1-h.smooth((y-.735)/.045))*h.smooth((z-.105)/.025)
            track=.088+.012*(.70-y)
            v.co.z-=.0017*math.exp(-((ax-track)/.0038)**2)*mask
        # Smooth gluteal center crease; no detached scallops at its inferior edge.
        if .70<y<.92 and z<.065:
            v.co.z+=.0025*math.exp(-(x/.006)**2)*h.smooth((y-.70)/.04)*(1-h.smooth((y-.88)/.04))
    # Appearance-only plantar fairing. Existing bone/contact targets stay intact.
    foot=[v for v in obj.data.vertices if v.co.y<-.03]
    lowest=min(v.co.y for v in foot);delta=-.0738-lowest
    for v in foot:v.co.y+=delta*(1-float(h.smooth((v.co.y+.074)/.014)))

def main():
    bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
    muscles=h.glb_parts('anatomy.glb');bones=h.glb_parts('skeleton.glb')
    def points(regex,side=None):
        rows=[r['positions'] for r in muscles if re.search(regex,r['name']) and (not side or side in r['name'])]
        return h.lean(np.concatenate(rows))
    torso=points(r'pectoralis major|latissimus dorsi|trapezius|rectus abdominis|external oblique|gluteus (maximus|medius)')
    ys=np.linspace(.690,1.449,111);cxs=np.zeros(len(ys));czs=np.interp(ys,[.69,.85,1.0,1.18,1.30,1.37,1.449],[.082,.087,.099,.09,.076,.080,.095])
    rxs=np.interp(ys,[.69,.71,.74,.77,.85,1.,1.15,1.25,1.30,1.32,1.34,1.365,1.39,1.449],[.001,.035,.092,.115,.128,.108,.144,.165,.168,.151,.113,.071,.043,.035])
    rzs=np.interp(ys,[.69,.71,.74,.85,1.,1.15,1.25,1.30,1.32,1.34,1.365,1.39,1.449],[.001,.036,.075,.102,.103,.113,.115,.078,.064,.052,.041,.034,.033])
    radial_fit(torso,ys,cxs,czs,rxs,rzs,name='Source measured torso, pelvis and clean neck',region='torso')
    # Wider jaw, rounded scalp, fully featureless face.
    authored_loft('Reference faceless head',[(1.420,.026,.029,.126),(1.433,.039,.040,.124),(1.451,.053,.052,.119),
        (1.480,.064,.064,.109),(1.517,.069,.073,.098),(1.553,.069,.073,.091),(1.588,.061,.065,.086),
        (1.618,.044,.049,.084),(1.636,.015,.018,.084),(1.639,.001,.001,.084)])
    for sign in [-1,1]:ear(sign)
    for side,sign in [('left',1),('right',-1)]:
        arm=points(r'deltoid|biceps brachii|triceps brachii|brachialis|brachioradialis|flexor carpi|extensor carpi|extensor digitorum',side)
        ys=np.linspace(.775,1.362,87);cxs=sign*np.interp(ys,[.775,.805,1.045,1.315,1.342,1.362],[.261,.258,.220,.165,.178,.181]);czs=np.interp(ys,[.775,.805,1.045,1.315,1.362],[.115,.112,.086,.076,.076])
        rxs=np.interp(ys,[.775,.84,.94,1.045,1.16,1.28,1.315,1.335,1.350,1.362],[.023,.026,.034,.030,.038,.047,.046,.037,.025,.001])
        rzs=np.interp(ys,[.775,.84,.94,1.045,1.16,1.28,1.315,1.335,1.350,1.362],[.022,.027,.035,.029,.042,.046,.043,.035,.024,.001])
        radial_fit(arm,ys,cxs,czs,rxs,rzs,n=80,window=.013,name=side+' source-measured arm',region='arm')
        leg=points(r'gluteus|rectus femoris|vastus|biceps femoris|semitendinosus|semimembranosus|adductor (magnus|longus)|gastrocnemius|soleus|tibialis anterior|fibularis longus',side)
        ys=np.linspace(-.044,.911,131);cxs=sign*np.interp(ys,[-.044,.0066,.367,.811,.911],[.071,.071,.073,.0885,.09]);czs=np.interp(ys,[-.044,.0066,.367,.811,.911],[.076,.0744,.0826,.079,.078])
        rxs=np.interp(ys,[-.044,.045,.20,.32,.367,.45,.62,.76,.84,.88,.911],[.022,.028,.045,.039,.039,.050,.066,.072,.061,.030,.001])
        rzs=np.interp(ys,[-.044,.045,.20,.32,.367,.45,.62,.76,.84,.88,.911],[.025,.029,.055,.042,.038,.054,.072,.086,.075,.040,.001])
        radial_fit(leg,ys,cxs,czs,rxs,rzs,n=80,window=.014,name=side+' source-measured leg',region='leg')
    # Restore actual major-muscle geometry over the recessed fairing core.
    # These are the original muscle surfaces, not spheres or surface patches.
    superficial=r'pectoralis major|deltoid|biceps brachii|triceps brachii|brachialis|brachioradialis|flexor carpi|extensor carpi|pronator teres|latissimus dorsi|rectus abdominis|external oblique|gluteus (maximus|medius)|rectus femoris|vastus|biceps femoris|semitendinosus|semimembranosus|adductor (magnus|longus)|gastrocnemius|soleus|tibialis anterior|fibularis longus|infraspinatus|teres major'
    for row in muscles:
        if not re.search(superficial,row['name']):continue
        v=h.lean(row['positions']);faces=row['faces'];keep=np.ones(len(faces),dtype=bool)
        if re.search(r'carpi|brachioradialis|pronator',row['name']):keep=np.all(v[faces,1]>.84,axis=1)
        # The closed neck yoke owns all neck/collar transitions.
        keep &= np.all(v[faces,1]<1.365,axis=1)
        if np.any(keep):h.mesh_object('Source contour '+row['name'],v.tolist(),faces[keep].tolist())
    end_effectors(bones);note('source envelopes and major lobes authored',parts=len(h.parts))
    bpy.ops.object.select_all(action='DESELECT')
    for p in h.parts:p.select_set(True)
    bpy.context.view_layer.objects.active=h.parts[0];bpy.ops.object.join();obj=bpy.context.object;obj.name='Velora reference athlete exterior'
    h.remesh(obj,.0019);h.displace(obj,.0018);h.remesh(obj,.0019);h.displace(obj,-.0010)
    mod=obj.modifiers.new('Sculpt surface finish','SMOOTH');mod.factor=.75;mod.iterations=7;h.apply_modifier(obj,mod)
    note('unified exterior',vertices=len(obj.data.vertices),faces=len(obj.data.polygons))
    # Remove enclosed remesh islands, preserving the unique whole-body exterior.
    bm=bmesh.new();bm.from_mesh(obj.data);remaining=set(bm.verts);components=[]
    while remaining:
        seed=remaining.pop();stack=[seed];comp=[seed]
        while stack:
            v=stack.pop()
            for e in v.link_edges:
                n=e.other_vert(v)
                if n in remaining:remaining.remove(n);stack.append(n);comp.append(n)
        components.append(comp)
    largest=max(components,key=len);bmesh.ops.delete(bm,geom=[v for comp in components if comp is not largest for v in comp],context='VERTS')
    bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(obj.data);bm.free()
    sculpt_surface(obj)
    tri=sum(len(p.vertices)-2 for p in obj.data.polygons)
    if tri>175000:
        mod=obj.modifiers.new('Product geometry budget','DECIMATE');mod.ratio=175000/tri;h.apply_modifier(obj,mod)
    for sign in [-1,1]:
        for a,b in [((.112,.198),(.131,.252)),((.132,.197),(.150,.246)),((.145,.187),(.166,.232)),((.157,.174),(.178,.217))]:h.toe_cleft(obj,sign,a,b)
    mod=obj.modifiers.new('Triangles','TRIANGULATE');h.apply_modifier(obj,mod)
    for p in obj.data.polygons:p.use_smooth=True
    obj.data.update();bm=bmesh.new();bm.from_mesh(obj.data)
    boundary=sum(e.is_boundary for e in bm.edges);nonmanifold=sum(not e.is_manifold for e in bm.edges);bm.free()
    meta={'name':obj.name,'units':'metres','up':'Y','construction':'Source-measured major-muscle outer cross-sections, closed authoring of neck/head/end-effectors, continuous geometric anatomical sculpting',
          'source':'BodyExplorer / BodyParts3D + Z-Anatomy','vertices':len(obj.data.vertices),'triangles':len(obj.data.polygons),'boundaryEdges':boundary,'nonManifoldEdges':nonmanifold,'surfaceComponents':1,'voxelMetres':.0019}
    data={'positions':[c for v in obj.data.vertices for c in v.co],'normals':[c for v in obj.data.vertices for c in v.normal],
          'indices':[int(i) for p in obj.data.polygons for i in p.vertices],'meta':meta}
    (OUT/f'{PREFIX}.json').write_text(json.dumps(data,separators=(',',':')))
    mat=bpy.data.materials.new('Warm grey matte sculpture');mat.diffuse_color=(.43,.405,.37,1);mat.use_nodes=True
    p=mat.node_tree.nodes.get('Principled BSDF');p.inputs['Base Color'].default_value=(.43,.405,.37,1);p.inputs['Roughness'].default_value=.76
    obj.data.materials.clear();obj.data.materials.append(mat);bpy.ops.object.select_all(action='DESELECT');obj.select_set(True);bpy.context.view_layer.objects.active=obj
    bpy.ops.wm.save_as_mainfile(filepath=str(OUT/f'{PREFIX}.blend'))
    bpy.ops.export_scene.gltf(filepath=str(OUT/f'{PREFIX}.glb'),export_format='GLB',use_selection=True,export_yup=False)
    note('exported',**meta);(REPORT/'reference-candidate-build.json').write_text(json.dumps({'stages':stages,'result':meta},indent=2))

if __name__=='__main__':main()
