"""Static athlete art candidate. Frozen rig, clips and production mesh untouched.

The original closed exterior is the continuous base. True geometry is faired,
re-proportioned, and sculpted with deliberately curved anatomical footprints.
The final muscle ID field guides native-muscle geodesic relief. All four views
are renders of this one three-dimensional mesh; no image projection is used.
"""
import bpy,bmesh,json,math,heapq,time,os,re
from pathlib import Path
import numpy as np

ROOT=Path(__file__).resolve().parents[2];OUT=ROOT/'public/appearance';REPORT=ROOT/'output/appearance/art-body'
REPORT.mkdir(exist_ok=True,parents=True);START=time.time();PREFIX='athlete-art-candidate'
KNEE_TARGET=float(os.environ.get('ART_KNEE_TARGET','.460'))
FOREARM_PRONATION=float(os.environ.get('ART_FOREARM_PRONATION','0'))*math.pi/180
stages=[]

def log(stage,**data):
    row={'stage':stage,'seconds':round(time.time()-START,2),**data};stages.append(row);print(json.dumps(row),flush=True)

def smooth(a,b,x):
    t=np.clip((x-a)/(b-a),0,1);return t*t*(3-2*t)

def normals(p,f):
    n=np.zeros_like(p);fn=np.cross(p[f[:,1]]-p[f[:,0]],p[f[:,2]]-p[f[:,0]])
    for k in range(3):np.add.at(n,f[:,k],fn)
    return n/np.maximum(np.linalg.norm(n,axis=1,keepdims=True),1e-12)

def edges_adjacency(p,f):
    e=np.sort(np.concatenate([f[:,[0,1]],f[:,[1,2]],f[:,[2,0]]]),axis=1);e=np.unique(e,axis=0)
    adj=[[] for _ in range(len(p))]
    for a,b in e:
        d=float(np.linalg.norm(p[a]-p[b]));adj[a].append((int(b),d));adj[b].append((int(a),d))
    return e,adj

def geodesic_to_boundary(labels,adj):
    d=np.full(len(labels),np.inf);heap=[]
    for i,row in enumerate(adj):
        if labels[i] and any(labels[j]!=labels[i] for j,_ in row):d[i]=0;heap.append((0.,i))
    heapq.heapify(heap)
    while heap:
        cost,i=heapq.heappop(heap)
        if cost>d[i]:continue
        for j,w in adj[i]:
            if labels[j]!=labels[i]:continue
            alt=cost+w
            if alt<d[j]:d[j]=alt;heapq.heappush(heap,(alt,j))
    d[~np.isfinite(d)]=0
    return d

def fair(p,e,mask,pairs=16,maximum=.018):
    original=p.copy();src=np.r_[e[:,0],e[:,1]];dst=np.r_[e[:,1],e[:,0]]
    weights=1/np.maximum(np.linalg.norm(p[src]-p[dst],axis=1),.0008)
    totals=np.bincount(src,weights=weights,minlength=len(p))
    for _ in range(pairs):
        for strength in [.49,-.515]:
            average=np.stack([np.bincount(src,weights=weights*p[dst,k],minlength=len(p))/totals for k in range(3)],axis=1)
            p+=(average-p)*(strength*mask[:,None])
    delta=p-original;length=np.linalg.norm(delta,axis=1);p=original+delta*np.minimum(1,maximum/np.maximum(length,1e-12))[:,None]
    return p

def outline(points,steps=12):
    """Closed cubic Bezier perimeter, represented as Catmull-to-Bezier spans."""
    q=np.array(points,float);out=[]
    for j,p1 in enumerate(q):
        p0=q[(j-1)%len(q)];p2=q[(j+1)%len(q)];p3=q[(j+2)%len(q)]
        c1=p1+(p2-p0)/6;c2=p2-(p3-p1)/6
        for k in range(steps):
            t=k/steps;out.append((1-t)**3*p1+3*(1-t)**2*t*c1+3*(1-t)*t*t*c2+t**3*p2)
    return np.array(out)

def polygon_distance(xy,poly):
    d=np.full(len(xy),np.inf);inside=np.zeros(len(xy),bool);x,y=xy.T
    for a,b in zip(poly,np.roll(poly,-1,axis=0)):
        ab=b-a;den=float(ab@ab)
        t=np.clip(((xy-a)@ab)/max(den,1e-12),0,1)
        d=np.minimum(d,np.linalg.norm(xy-(a+t[:,None]*ab),axis=1))
        cross=((a[1]>y)!=(b[1]>y))&(x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1]+1e-20)+a[0])
        inside^=cross
    return np.where(inside,d,-d)

def sculpt_patch(p,n,boundary,center,radii,amplitude,face='front',groove=.0013):
    """A continuous convex muscle relief defined by its anatomical perimeter."""
    ax=np.abs(p[:,0]);xy=np.stack([ax,p[:,1]],axis=1);poly=outline(boundary)
    box=(xy[:,0]>poly[:,0].min()-.008)&(xy[:,0]<poly[:,0].max()+.008)&(xy[:,1]>poly[:,1].min()-.008)&(xy[:,1]<poly[:,1].max()+.008)
    if face=='front':box&=(p[:,2]>.11)&(n[:,2]>-.1)
    else:box&=(p[:,2]<.095)&(n[:,2]<.2)
    idx=np.flatnonzero(box)
    if not len(idx):return
    d=polygon_distance(xy[idx],poly);taper=smooth(0,.012,d)
    gaussian=np.exp(-.45*(((xy[idx,0]-center[0])/radii[0])**2+((xy[idx,1]-center[1])/radii[1])**2))
    bulge=amplitude*taper*gaussian
    crease=groove*np.exp(-(d/.0028)**2)
    scale=smooth(.08,.25,abs(n[idx,2]))
    p[idx]+=n[idx]*((bulge-crease)*scale)[:,None]

def main():
    surface=json.loads((OUT/'athlete-surface.json').read_text());meta=json.loads((OUT/'athlete-skin.json').read_text());raw=(OUT/meta['binary']).read_bytes()
    p=np.array(surface['positions'],float).reshape(-1,3);f=np.array(surface['indices'],np.int32).reshape(-1,3);base=p.copy()
    def attr(name):
        a=meta['attributes'][name];dt={'Float32Array':'<f4','Uint16Array':'<u2','Uint32Array':'<u4'}[a['type']]
        return np.frombuffer(raw,dtype=dt,count=a['length'],offset=a['offset']).reshape(-1,a['itemSize'])
    ids=attr('muscleIds');mw=attr('muscleWeights');dominant=ids[np.arange(len(p)),np.argmax(mw,axis=1)].astype(int)
    registry=meta['registry'];names=np.array(['']+[s.lower() for s in registry],object);vertex_names=names[dominant]
    def named(regex):return np.array([bool(re.search(regex,s)) for s in vertex_names])
    e,adj=edges_adjacency(p,f);native_d=geodesic_to_boundary(dominant,adj);log('read frozen exterior',vertices=len(p),triangles=len(f))
    x,y,z=p.T;ax=abs(x)
    # Clean low-frequency sculpture before defining deliberate muscle borders.
    torso=smooth(.75,.82,y)*(1-smooth(1.25,1.31,y))*(1-smooth(.145,.185,ax))
    forearm=smooth(.835,.88,y)*(1-smooth(1.005,1.035,y))*smooth(.17,.205,ax)
    glute=smooth(.67,.72,y)*(1-smooth(.90,.95,y))*(1-smooth(.10,.14,z))*(1-smooth(.145,.175,ax))
    limb=named(r'pectoralis|deltoid|biceps brachii|triceps|vastus|rectus femoris|gastrocnemius')*1.
    mask=np.maximum.reduce([torso*.48,forearm,glute,limb*.30])
    mask*=1-smooth(1.31,1.35,y)
    p=fair(p,e,mask,pairs=25,maximum=.022)
    log('surface fairing complete',maximumDisplacement=float(np.linalg.norm(p-base,axis=1).max()))
    # Reference V taper: broader shoulder/cage, 10% tighter waist, fuller hips.
    x,y,z=p.T;ax=abs(x);side=np.sign(x)
    body=(1-smooth(.145,.195,ax))
    scale=np.interp(y,[.65,.77,.82,.95,1.04,1.16,1.27,1.34],[1,1.07,1.07,.90,.93,1.075,1.09,1])
    p[:,0]*=1+(scale-1)*body
    # Widen proximal arms while leaving the wrist / existing hand span intact.
    arm=smooth(.145,.195,ax)*smooth(.805,.86,y)*(1-smooth(1.355,1.39,y))
    p[:,0]+=side*.018*smooth(.805,1.315,y)*arm
    # Muscle radius increases are local to their own limb axes.
    for sign in [-1,1]:
        side_mask=(np.sign(p[:,0])==sign)
        yy=p[:,1]
        thigh=side_mask*smooth(.425,.48,yy)*(1-smooth(.745,.81,yy))
        cx=sign*np.interp(yy,[.367,.811],[.073,.0885]);cz=np.interp(yy,[.367,.811],[.0826,.079])
        p[:,0]=cx+(p[:,0]-cx)*(1+.075*thigh)
        p[:,2]=cz+(p[:,2]-cz)*(1+.075*thigh)
    n=normals(p,f)
    # Broad rounded pectoral fan, including a curved inferior border.
    sculpt_patch(p,n,[(.009,1.316),(.083,1.316),(.165,1.294),(.186,1.265),(.166,1.201),(.119,1.167),(.057,1.153),(.013,1.169)],
        (.086,1.235),(.081,.073),.020,'front',.0015)
    # Broad back planes: latissimus and infraspinatus, deliberately shaped.
    n=normals(p,f)
    sculpt_patch(p,n,[(.012,1.267),(.103,1.277),(.173,1.242),(.156,1.118),(.098,.953),(.015,.910),(.008,1.08)],
        (.086,1.135),(.080,.175),.010,'back',.0012)
    sculpt_patch(p,n,[(.038,1.306),(.109,1.300),(.169,1.258),(.128,1.204),(.058,1.231)],
        (.104,1.255),(.060,.050),.006,'back',.0012)
    # Wrapped deltoid teardrop volume, with three gently separated bundles.
    n=normals(p,f)
    for sign in [-1,1]:
        s=np.array([sign*.183,1.315,.076]);end=np.array([sign*.229,1.045,.086]);down=(end-s)/np.linalg.norm(end-s)
        lateral=np.array([sign,0,0.]);lateral-=down*(lateral@down);lateral/=np.linalg.norm(lateral);front=np.cross(lateral,down);front*=np.sign(front[2])
        d=p-s;t=d@down;u=d@lateral;v=d@front;theta=np.arctan2(v,u)
        region=(np.sign(p[:,0])==sign)&(u>-.005)&(t>-.05)&(t<.19)
        envelope=smooth(-.050,-.017,t)*(1-smooth(.130,.185,t))*np.exp(-((t-.040)/.084)**2)
        wrapped=(1-smooth(1.36,1.70,abs(theta)))
        relief=.013*envelope*wrapped
        for center in [-.82,0,.82]:relief+=.0022*envelope*np.exp(-((theta-center)/.34)**2)
        for line in [-.43,.43]:relief-=.0014*envelope*np.exp(-((theta-line)/.065)**2)
        p[region]+=n[region]*relief[region,None]
    # Native geodesic muscle bellies: actual source outline, not generic blobs.
    n=normals(p,f);relief=np.zeros(len(p))
    amplitudes=[(r'biceps brachii',.0048),(r'triceps brachii',.0036),(r'rectus femoris',.0062),
        (r'vastus (lateralis|medialis)',.0055),(r'biceps femoris|semitendinosus|semimembranosus',.0035),(r'gastrocnemius',.0045)]
    for regex,amplitude in amplitudes:
        chosen=named(regex)
        for mid in np.unique(dominant[chosen]):
            region=chosen&(dominant==mid);dd=native_d[region]
            if not len(dd):continue
            radius=max(float(np.quantile(dd,.96)),.008)
            belly=np.sin(np.clip(dd/radius,0,1)*math.pi/2)**1.15
            relief[region]+=amplitude*belly
    # Protect knee, groin, elbow, ankle and neck transitions from lobe inflation.
    yy=p[:,1];xx=abs(p[:,0]);zz=p[:,2]
    relief*=1-np.exp(-((yy-.375)/.040)**2)
    relief*=1-np.exp(-((yy-1.044)/.032)**2)
    relief*=smooth(.08,.12,yy)*(1-smooth(1.315,1.36,yy))
    relief[(yy>.76)&(yy<.91)&(xx<.16)]=0
    p+=n*relief[:,None]
    # Paired, curved rectus lobes with controlled lower taper.
    n=normals(p,f);x,y,z=p.T;ax=abs(x)
    abs_mask=smooth(.170,.192,z)*(1-smooth(.071,.083,ax))*smooth(.825,.86,y)*(1-smooth(1.15,1.18,y))
    ab=np.zeros(len(p))
    for center,width,amp in [(1.125,.028,.0070),(1.047,.028,.0070),(.969,.029,.0067),(.889,.041,.0058)]:
        curved=center+.13*(ax-.034)
        ab+=amp*np.exp(-((ax-.034)/.028)**4-((y-curved)/width)**2)
    ab-=.0018*np.exp(-(x/.0038)**2)
    p+=n*(ab*abs_mask)[:,None]
    # Clean, full gluteal surfaces over the faired source, not broken fragments.
    n=normals(p,f)
    sculpt_patch(p,n,[(.009,.901),(.085,.910),(.149,.851),(.143,.755),(.099,.694),(.030,.707),(.008,.774)],
        (.083,.803),(.071,.105),.009,'back',.0010)
    # Fine pectoral fibre divisions stay shallow within the large curved lobes.
    x,y,z=p.T;ax=abs(x);n=normals(p,f);groove=np.zeros(len(p))
    chest=smooth(.168,.195,z)*smooth(.012,.027,ax)*(1-smooth(.155,.185,ax))*smooth(1.16,1.18,y)*(1-smooth(1.30,1.32,y))
    for intercept,slope in [(1.284,-.10),(1.246,.035),(1.205,.25)]:groove+=.0010*np.exp(-((y-(intercept+slope*ax))/.0022)**2)
    p-=n*(groove*chest)[:,None]
    # Static reference leg proportions: knee up, longer shins, shorter thighs.
    y=p[:,1].copy();p[:,1]=np.interp(y,[-.074,.0066,.375,.811,1.8],[-.074,.0066,KNEE_TARGET,.811,1.8])
    # Raise only the central crotch web to the reference without lifting thighs.
    xx=p[:,0];yy=p[:,1];zz=p[:,2]
    p[:,1]+=.026*np.exp(-(xx/.035)**4-((yy-.727)/.050)**2)*(1-smooth(.13,.17,zz))
    # Optional static forearm pronation is geometry authoring, not a rig edit.
    if FOREARM_PRONATION:
        for sign in [-1,1]:
            elbow=np.array([sign*.229,1.045,.086]);wrist=np.array([sign*.258,.805,.112]);axis=wrist-elbow;axis/=np.linalg.norm(axis)
            mask=(np.sign(p[:,0])==sign)&(abs(p[:,0])>.18)&(p[:,1]<1.045)
            angle=FOREARM_PRONATION*sign*(1-smooth(.805,1.045,p[mask,1]));v=p[mask]-wrist
            p[mask]=wrist+v*np.cos(angle[:,None])+np.cross(axis,v)*np.sin(angle[:,None])+axis*(v@axis)[:,None]*(1-np.cos(angle[:,None]))
    n=normals(p,f)
    log('static sculpture complete',maximumDisplacement=float(np.linalg.norm(p-base,axis=1).max()),kneeTarget=KNEE_TARGET)
    bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
    mesh=bpy.data.meshes.new('Unified athlete static sculpture');mesh.from_pydata(p.tolist(),[],f.tolist());mesh.update()
    obj=bpy.data.objects.new('Velora static reference sculpture candidate',mesh);bpy.context.collection.objects.link(obj);bpy.context.view_layer.objects.active=obj;obj.select_set(True)
    for poly in mesh.polygons:poly.use_smooth=True
    material=bpy.data.materials.new('Warm grey matte sculpture');material.use_nodes=True;shader=material.node_tree.nodes.get('Principled BSDF');shader.inputs['Base Color'].default_value=(.43,.405,.37,1);shader.inputs['Roughness'].default_value=.77;mesh.materials.append(material)
    bm=bmesh.new();bm.from_mesh(mesh);boundary=sum(e.is_boundary for e in bm.edges);nonmanifold=sum(not e.is_manifold for e in bm.edges);bm.free()
    result={'name':obj.name,'units':'metres','up':'Y','vertices':len(p),'triangles':len(f),'boundaryEdges':boundary,'nonManifoldEdges':nonmanifold,
        'purpose':'Static reference art candidate, source rig/production appearance unchanged','construction':'Continuous source mesh, localized fairing, authored Bezier muscle footprints, native-ID geodesic relief and static anatomical proportion remap','kneeTargetY':KNEE_TARGET}
    data={'positions':p.reshape(-1).tolist(),'normals':n.reshape(-1).tolist(),'indices':f.reshape(-1).tolist(),'meta':result}
    (OUT/f'{PREFIX}.json').write_text(json.dumps(data,separators=(',',':')))
    bpy.ops.wm.save_as_mainfile(filepath=str(OUT/f'{PREFIX}.blend'))
    bpy.ops.export_scene.gltf(filepath=str(OUT/f'{PREFIX}.glb'),export_format='GLB',use_selection=True,export_yup=False)
    log('candidate exported',**result);(REPORT/'build-report.json').write_text(json.dumps({'stages':stages,'result':result},indent=2))

if __name__=='__main__':main()
