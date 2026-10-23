"""Transfer anatomical IDs and the unchanged Velora binding to the closed exterior.

Run: blender --background --python tools/appearance/transfer-surface.py
The source mesh is immutable; all fields are barycentrically sampled in regional
rest-space BVHs, then diffused only across connected exterior vertices. Hands
receive explicit phalange skinning because exposed source tendons are unsuitable
for a complete soft-tissue finger envelope.
"""
import json, time, math, hashlib, re
from pathlib import Path
from collections import Counter, defaultdict
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree

ROOT=Path(__file__).resolve().parents[2]
SRC=ROOT/'output/appearance'
OUT=ROOT/'public/appearance'
START=time.time()
COLOR_RULES=json.loads((Path(__file__).with_name('transfer-muscle-regions.json')).read_text())

def log(stage,**kw): print(json.dumps({'stage':stage,'seconds':round(time.time()-START,2),**kw}),flush=True)
def smooth(t):
    t=np.clip(t,0,1);return t*t*(3-2*t)

def lean(v):
    # The same radius reduction as the source-derived appearance builder. Pivots
    # stay fixed, and source morph vectors remain relative to the existing rig.
    v=v.copy();x,y,z=v.T;ax=np.abs(x);side=np.sign(x)
    torso=(1-smooth((ax-.135)/.075))*smooth((y-.77)/.12)*(1-smooth((y-1.30)/.09))
    v[:,0]*=1-.045*torso;v[:,2]=.09+(v[:,2]-.09)*(1-.095*torso)
    for lo,hi,c0,c1,amount in [(.41,.79,(.073,.083),(.088,.079),.065),(.035,.35,(.071,.074),(.073,.083),.055),(1.06,1.30,(.220,.083),(.165,.076),.07),(.84,1.02,(.258,.112),(.220,.083),.04)]:
        t=np.clip((y-lo)/(hi-lo),0,1);cx=side*(c0[0]+(c1[0]-c0[0])*t);cz=c0[1]+(c1[1]-c0[1])*t
        mask=smooth((y-lo)/.04)*(1-smooth((y-hi+.04)/.04))
        mask*=smooth((ax-.145)/.04) if lo>.8 else 1-smooth((ax-.175)/.025)
        v[:,0]=cx+(v[:,0]-cx)*(1-amount*mask);v[:,2]=cz+(v[:,2]-cz)*(1-amount*mask)
    return v

def region(p):
    x,y,z=p;ax=abs(x);side='left' if x>=0 else 'right'
    if y>1.405:return 'head'
    if y<.838 and ax>.185:return side+'-hand'
    if .81<y<1.382 and ax>(.163+.05*max(0,1.2-y)):return side+'-arm'
    if y<.790:return side+'-leg' if ax>.022 else 'pelvis'
    return 'torso'

manifest=json.loads((SRC/'source-binding.json').read_text());raw=(SRC/manifest['binary']).read_bytes()
dtypes={'Float32Array':'<f4','Uint16Array':'<u2','Uint32Array':'<u4'}
def read(a):return np.frombuffer(raw,dtypes[a['type']],a['length'],a['offset']).reshape(-1,a['itemSize'])
# The lists collect complete source triangles, retaining the exact original
# per-corner weights, morphs and muscle ID at every sampled point.
groups=defaultdict(lambda:{'p':[],'si':[],'sw':[],'lin':[],'quad':[],'morph':[],'id':[]})
for m in manifest['meshes']:
    a=m['attributes'];p=read(a['position']);si=read(a['skinIndex']);sw=read(a['skinWeight']);lin=read(a['rigLinearBlend']);quad=read(a['rigQuadEnvelope']);f=read(m['indices']).reshape(-1,3).astype(np.int64)
    pp=lean(p.astype(np.float64));centers=pp[f].mean(axis=1)
    masks=defaultdict(list)
    for fi,c in enumerate(centers):masks[region(c)].append(fi)
    morph=[read(q) for q in m['morphs']]
    for key,rows in masks.items():
        g=groups[key];ff=f[np.asarray(rows)].reshape(-1)
        g['p'].append(pp[ff]);g['si'].append(si[ff]);g['sw'].append(sw[ff]);g['lin'].append(lin[ff]);g['quad'].append(quad[ff]);g['morph'].append(np.stack([q[ff] for q in morph],axis=1));g['id'].extend([m['id']]*len(rows))
log('source grouped',groups={k:len(g['id']) for k,g in groups.items()})
for key,g in groups.items():
    for name in ['p','si','sw','lin','quad','morph']:g[name]=np.concatenate(g[name])
    g['id']=np.asarray(g['id'],dtype=np.uint16)
    faces=np.arange(len(g['p'])).reshape(-1,3)
    g['bvh']=BVHTree.FromPolygons(g['p'].tolist(),faces.tolist(),all_triangles=True)
log('regional BVHs ready')
# Skin transfer and color transfer are separate tasks. A thin iliotibial fascia
# must not become a neutral stripe across a quadriceps highlight, and a deep
# muscle / nearby skeletal triangle must not mask the real superficial muscle.
major_ids={i+1 for i,name in enumerate(manifest['registry']) if any(re.search(pattern,name) for pattern in COLOR_RULES['majorMusclePatterns']) and not any(re.search(pattern,name) for pattern in COLOR_RULES['excludePatterns'])}
neutral_margin_ids={i+1 for i,name in enumerate(manifest['registry']) if any(re.search(pattern,name) for pattern in COLOR_RULES['neutralSourcePatterns'])}
tendon_ids={i+1 for i,name in enumerate(manifest['registry']) if re.search(r'tendon|ligament|retinaculum|membrane|fascia|aponeurosis|iliotibial',name)}
for key,g in groups.items():
    take=np.isin(g['id'],list(major_ids));g['colorIDs']=g['id'][take]
    if take.any():
        cp=g['p'].reshape(-1,3,3)[take].reshape(-1,3)
        cf=np.arange(len(cp)).reshape(-1,3)
        g['colorBVH']=BVHTree.FromPolygons(cp.tolist(),cf.tolist(),all_triangles=True)
    else:g['colorBVH']=None
log('separate superficial muscle ID BVHs ready',eligibleSourceMuscles=len(major_ids))
shape_bytes=(OUT/'athlete-surface.json').read_bytes();shape=json.loads(shape_bytes)
p=np.asarray(shape['positions'],dtype=np.float32).reshape(-1,3);normal=np.asarray(shape['normals'],dtype=np.float32).reshape(-1,3);faces=np.asarray(shape['indices'],dtype=np.uint32).reshape(-1,3);N=len(p);B=len(manifest['bones'])
skin=np.zeros((N,B),dtype=np.float32);linear=np.zeros(N,dtype=np.float32);quad=np.zeros((N,2),dtype=np.float32);morph=np.zeros((N,5,3),dtype=np.float32);ids=np.zeros(N,dtype=np.uint16);distance=np.zeros(N,dtype=np.float32);color_distance=np.full(N,np.nan,dtype=np.float32);regions=[]

def bary(point,tri):
    a,b,c=tri;v0=b-a;v1=c-a;v2=point-a
    d00=v0@v0;d01=v0@v1;d11=v1@v1;d20=v2@v0;d21=v2@v1;den=d00*d11-d01*d01
    if abs(den)<1e-18:return np.array([1.,0,0])
    v=(d11*d20-d01*d21)/den;w=(d00*d21-d01*d20)/den
    v=np.clip(np.array([1-v-w,v,w]),0,1);return v/max(v.sum(),1e-9)

for i,point in enumerate(p):
    key=region(point);regions.append(key);g=groups[key]
    hit,n,fi,d=g['bvh'].find_nearest(Vector(point))
    if hit is None:raise RuntimeError('No nearest source '+key)
    # An outer surface can move a few mm into a rounded source muscle. The
    # closest true triangle and its barycentrics preserve that muscle boundary.
    inds=np.arange(fi*3,fi*3+3);bw=bary(np.asarray(hit),g['p'][inds]);ids[i]=g['id'][fi];distance[i]=d
    for corner,bc in zip(inds,bw):
        for bone,w in zip(g['si'][corner],g['sw'][corner]):skin[i,bone]+=float(w*bc)
    linear[i]=bw@g['lin'][inds,0]
    # Quad index is a discrete bone identifier, never interpolate its number.
    quad[i,0]=g['quad'][inds[np.argmax(bw)],0];quad[i,1]=bw@g['quad'][inds,1]
    morph[i]=np.tensordot(bw,g['morph'][inds],axes=(0,0))
    # Labels come from the nearest original superficial muscle surface in the
    # same anatomical region; no ellipsoid or synthetic red patch is involved.
    original_id=int(ids[i]);ids[i]=0
    if g['colorBVH'] is not None and key!='head' and not key.endswith('-hand'):
        ch,cn,cfi,cd=g['colorBVH'].find_nearest(Vector(point))
        category='arm' if key.endswith('-arm') else 'leg' if key.endswith('-leg') else key
        limit=COLOR_RULES['projectionDistanceMetres'].get(category,.025)
        if ch is not None and cd<=limit:
            ids[i]=g['colorIDs'][cfi];color_distance[i]=cd
            # Prefer a source outer-facing triangle along the actual exterior
            # normal when the nearest triangle lies on an internal muscle wall.
            if float(np.dot(np.asarray(cn),normal[i]))<.1:
                origin=Vector(point+normal[i]*.045)
                rh,rn,rfi,rd=g['colorBVH'].ray_cast(origin,Vector(-normal[i]),.09)
                if rh is not None and abs(rd-.045)<=limit and float(np.dot(np.asarray(rn),normal[i]))>.1:
                    ids[i]=g['colorIDs'][rfi];color_distance[i]=abs(rd-.045)
    x,y,z=point
    # Genuine skeletal / tendon endpoints retain neutral skin. This gate uses
    # the actual closest source bone/tendon, not a painted synthetic primitive.
    source_joint=original_id==0 and d<.006 and ((.322<y<.415 and z>.087) or (.995<y<1.077 and key.endswith('-arm')) or (1.298<y<1.366 and abs(x)<.183) or (.865<y<.940 and abs(x)<.17))
    terminal_tendon=original_id in tendon_ids and (y<.175 or (.797<y<.865 and abs(x)>.185))
    if source_joint or terminal_tendon or (original_id in neutral_margin_ids and d<.008) or y<.035:ids[i]=0
    if i and i%20000==0:log('source transfer',vertices=i,total=N)
log('barycentric transfer complete',vertices=N)
# Exterior adjacency, no disconnected patch/color projection. Smoothing is
# prevented from crossing the arm/torso or left/right leg regional gate.
edges=np.concatenate([faces[:,[0,1]],faces[:,[1,2]],faces[:,[2,0]]]);edges=np.unique(np.sort(edges,axis=1),axis=0)
regions=np.asarray(regions);keep=regions[edges[:,0]]==regions[edges[:,1]];edges=edges[keep];adj=[[] for _ in range(N)]
for a,b in edges:adj[a].append(int(b));adj[b].append(int(a))
# Remove split-source skin discontinuities while preserving a narrow joint
# transition. Source rig morph channels follow the same surface interpolation.
for iteration in range(3):
    prev=skin.copy();prev_m=morph.copy();prev_l=linear.copy()
    for i,neighbors in enumerate(adj):
        if not neighbors:continue
        skin[i]=prev[i]*.5+prev[neighbors].mean(axis=0)*.5
        morph[i]=prev_m[i]*.6+prev_m[neighbors].mean(axis=0)*.4
        linear[i]=prev_l[i]*.6+prev_l[neighbors].mean()*.4
log('connected surface weights smoothed')
# The new exterior is one continuous skin. Original separate anatomical sheets
# have deliberately rigid origin/insertion weights; those are unsuitable at a
# united deltopectoral fold or gluteal crease. Author joint fields independently
# of the muscle ID segmentation, then solve them over the connected skin.
full_edges=np.concatenate([faces[:,[0,1]],faces[:,[1,2]],faces[:,[2,0]]]);full_edges=np.unique(np.sort(full_edges,axis=1),axis=0)
color_adj=[[] for _ in range(N)]
for ca,cb in full_edges:color_adj[ca].append(int(cb));color_adj[cb].append(int(ca))
ei=full_edges[:,0];ej=full_edges[:,1]
degree=np.bincount(np.concatenate([ei,ej]),minlength=N).astype(np.float32)
def fair_scalar(values, free, pins, iterations=180):
    values=values.astype(np.float32).copy();fixed=~free
    for iteration in range(iterations):
        totals=np.bincount(ei,weights=values[ej],minlength=N)+np.bincount(ej,weights=values[ei],minlength=N)
        values[free]=.28*values[free]+.72*(totals[free]/np.maximum(degree[free],1))
        values[fixed]=pins[fixed]
    return np.clip(values,0,1)
ax=np.abs(p[:,0]);yy=p[:,1]
shoulder_zone=(yy>1.11)&(yy<1.425)&(ax>.035)
# Every torso interior is a chest anchor. Every proper upper-arm cross-section
# and lateral deltoid cap is an arm anchor. The intervening armpit/clavicle band
# is a harmonic transition 30-50mm wide rather than per-muscle rigid islands.
w_arm=smooth((ax-.105)/.10)
body_pin=(ax<.112)|((ax<.142)&(yy<1.225))|(yy>1.391)
arm_pin=((ax>.181)&(yy<1.245))|((ax>.213)&(yy<1.355))
shoulder_pins=w_arm.copy();shoulder_pins[body_pin]=0;shoulder_pins[arm_pin]=1
w_arm=fair_scalar(shoulder_pins,shoulder_zone&~body_pin&~arm_pin,shoulder_pins,220)
shoulder_blend=smooth((yy-1.11)/.028)*(1-smooth((yy-1.391)/.034))*smooth((ax-.035)/.04)
for side,sign in [('left',1),('right',-1)]:
    sel=shoulder_zone&(p[:,0]*sign>0)
    authored=np.zeros((int(sel.sum()),B),dtype=np.float32)
    authored[:,manifest['spine']['chest']]=1-w_arm[sel]
    authored[:,manifest['chains'][side]['upper']]=w_arm[sel]
    alpha=shoulder_blend[sel,None]
    skin[sel]=skin[sel]*(1-alpha)+authored*alpha
    linear[sel]*=1-shoulder_blend[sel]
# Smooth true-skin hip bend. Both gluteal surfaces and the medial pelvic bridge
# share one scalar field; no separate muscle insertion band can form a skirt.
hip_zone=(yy>.635)&(yy<.945)&(ax<.178)
center_factor=1-(1-smooth((ax-.006)/.039))*smooth((yy-.665)/.075)
w_thigh=smooth((.895-yy)/.225)*center_factor
hip_pins=w_thigh.copy();hip_pin=(yy>.89)|(yy<.68)|(ax<.011)
w_thigh=fair_scalar(hip_pins,hip_zone&~hip_pin,hip_pins,100)
leg_zone=(yy>.075)&(yy<.945)&(ax<.178)
leg_blend=smooth((yy-.075)/.035)*(1-smooth((yy-.905)/.04))*(1-smooth((ax-.15)/.028))
w_shin=1-smooth((yy-.300)/.145)
# A complete hamstring skin region follows its femur; its lower surface must not
# retain the source muscle's far-away shin insertion weight. Continuous knee
# weights take over only around the actual joint, not along the whole thigh.
for side,sign in [('left',1),('right',-1)]:
    sel=leg_zone&(p[:,0]*sign>0);authored=np.zeros((int(sel.sum()),B),dtype=np.float32)
    authored[:,manifest['spine']['pelvis']]=(1-w_thigh[sel])*(1-w_shin[sel])
    authored[:,manifest['chains'][side]['thigh']]=w_thigh[sel]*(1-w_shin[sel])
    authored[:,manifest['chains'][side]['shin']]=w_shin[sel]
    alpha=leg_blend[sel,None];skin[sel]=skin[sel]*(1-alpha)+authored*alpha
    # Moderate LBS keeps the deep-squat gluteal roll from ballooning; DQ still
    # supplies volume, and a consistent knee band avoids per-muscle islands.
    hip_mix=.60*smooth((yy[sel]-.65)/.065)*(1-smooth((yy[sel]-.90)/.045))
    knee_mix=.62*(1-smooth(np.abs(yy[sel]-.367)/.105))
    mix=np.maximum(hip_mix,knee_mix)
    linear[sel]=linear[sel]*(1-leg_blend[sel])+mix*leg_blend[sel]
    quad[sel,1]*=(1-leg_blend[sel])
    morph[sel,3,:]*=(1-leg_blend[sel,None])
# The disconnected anatomical correctives are intentionally not projected onto
# the united shoulder/hip skin. DQ and the continuous joint fields retain volume.
morph[:,1,:]=0;morph[:,2,:]=0
log('unified shoulder and hip fields authored',shoulderVertices=int(shoulder_zone.sum()),hipVertices=int(hip_zone.sum()))
# Exact soft tissue FK: palm follows carpus; each finger follows its own actual
# source phalange chain, with a short two-bone blend at a bending knuckle.
hand_counts=Counter()
def vec(v):return np.array([v['x'],v['y'],v['z']],dtype=np.float64)
def hand_skin(point,side):
    chain=manifest['chains'][side];fingers=manifest['fingerData'][side];candidates=[]
    for name,segs in fingers.items():
        for order,s in enumerate(segs):
            if name!='thumb' and order==0:continue
            a=vec(s['restPoint']);b=vec(s['nextPoint']);v=b-a;length=np.linalg.norm(v);t=float(np.dot(point-a,v)/(length*length));u=np.clip(t,0,1);dist=np.linalg.norm(point-a-v*u)
            # The common palm is rigid except thenar tissue at thumb root.
            if name!='thumb' and point[1]>a[1]+.009:continue
            if name=='thumb' and abs(point[0])<.280 and point[1]>.768:continue
            candidates.append((dist,name,order,t,length))
    out=np.zeros(B,dtype=np.float32)
    if not candidates:out[chain['hand']]=1;return out,'palm'
    dist,name,order,t,length=min(candidates)
    segs=fingers[name];s=segs[order];a=vec(s['restPoint'])
    # Only the distal exterior can attach to fingers. The interdigit web uses
    # each nearest branch rather than averaging separate finger skeletons.
    if dist>.018 or (name!='thumb' and point[1]>segs[1]['restPoint']['y']+.010):out[chain['hand']]=1;return out,'palm'
    current=s['index'];previous=chain['hand'] if order<=1 and name!='thumb' else (chain['hand'] if order==0 else segs[order-1]['index'])
    next_bone=segs[min(order+1,len(segs)-1)]['index']
    blend_width=min(.009,length*.3)
    along=t*length
    wprev=.5*(1-smooth(along/blend_width)) if along<blend_width else 0
    wnext=.5*smooth((along-(length-blend_width))/blend_width) if along>length-blend_width and order<len(segs)-1 else 0
    # Across a joint, each neighboring segment gives matching 50/50 weights.
    if t<0:wprev=.5+.5*smooth(-along/blend_width)
    if t>1 and order<len(segs)-1:wnext=.5+.5*smooth((along-length)/blend_width)
    out[current]=max(0,1-wprev-wnext);out[previous]+=wprev;out[next_bone]+=wnext
    return out,name
for i,key in enumerate(regions):
    point=p[i]
    if key.endswith('-hand'):
        side=key.split('-')[0];skin[i],part=hand_skin(point,side);morph[i]=0;linear[i]=0;quad[i]=0;ids[i]=0;hand_counts[side+'-'+part]+=1
    elif key=='head':
        # Smooth sculpted scalp and featureless face rotate as a complete head.
        w=float(smooth((point[1]-1.422)/.035));skin[i]=0;skin[i,manifest['spine']['head']]=w;skin[i,manifest['spine']['neckUpper']]=1-w;morph[i]=0;linear[i]=0;quad[i]=0;ids[i]=0
# Connected soft-tissue webs blend to the neighboring finger chain smoothly.
# FK and the bone-center grip do not change; this only removes nearest-branch
# skinning discontinuities along the complete palm surface.
hand_vertices=np.flatnonzero(np.char.endswith(regions.astype(str),'-hand')&(yy<.797))
for iteration in range(4):
    previous=skin.copy()
    for i in hand_vertices:
        neighbors=adj[i]
        if neighbors:skin[i]=previous[i]*.65+previous[neighbors].mean(axis=0)*.35
# A normalized full influence field lets us keep exactly four indices at output.
skin=np.maximum(skin,0);top=np.argsort(skin,axis=1)[:,-4:][:,::-1];sw=np.take_along_axis(skin,top,axis=1);discarded=np.maximum(0,skin.sum(axis=1)-sw.sum(axis=1));sw/=np.maximum(sw.sum(axis=1,keepdims=True),1e-12)
assert np.all(np.isfinite(sw));assert np.max(abs(sw.sum(axis=1)-1))<1e-5
# Preserve the exact ID set, soften only the outer two edge rings. All neutral
# synthetic regions carry ID0, never a red hidden mesh under the exterior.
mi=np.zeros((N,4),dtype=np.float32);mw=np.zeros((N,4),dtype=np.float32);mi[:,0]=ids;mw[:,0]=1
for iteration in range(COLOR_RULES['edgeBlendIterations']):
    pi=mi.copy();pw=mw.copy()
    for i,neighbors in enumerate(color_adj):
        if not neighbors or regions[i]=='head' or regions[i].endswith('-hand'):continue
        out=defaultdict(float)
        for mid,w in zip(pi[i],pw[i]):out[int(mid)]+=float(w)*.65
        scale=.35/len(neighbors)
        for j in neighbors:
            for mid,w in zip(pi[j],pw[j]):out[int(mid)]+=float(w)*scale
        best=sorted(out.items(),key=lambda item:item[1],reverse=True)[:4];den=sum(w for _,w in best)
        mi[i]=0;mw[i]=0
        for k,(mid,w) in enumerate(best):mi[i,k]=mid;mw[i,k]=w/den
log('muscle ID field ready',distinctIds=len(set(ids.tolist())),hands=dict(hand_counts))
# Padding makes every descriptor safe for direct typed-array construction.
chunks=[];offset=0
def put(a,itemSize):
    global offset
    a=np.ascontiguousarray(a);pad=(-offset)%4
    if pad:chunks.append(bytes(pad));offset+=pad
    descriptor={'offset':offset,'length':int(a.size),'itemSize':itemSize,'type':{'f':'Float32Array','u':'Uint16Array' if a.dtype.itemsize==2 else 'Uint32Array'}[a.dtype.kind]}
    chunks.append(a.tobytes());offset+=a.nbytes;return descriptor
attrs={'position':put(p.astype('<f4'),3),'normal':put(normal.astype('<f4'),3),'skinIndex':put(top.astype('<u2'),4),'skinWeight':put(sw.astype('<f4'),4),'rigLinearBlend':put(linear.astype('<f4'),1),'rigQuadEnvelope':put(quad.astype('<f4'),2),'muscleIds':put(mi.astype('<f4'),4),'muscleWeights':put(mw.astype('<f4'),4)}
index=put(faces.astype('<u4'),1);morphs=[put(morph[:,i,:].astype('<f4'),3) for i in range(5)]
used=Counter(int(i) for row in mi for i in row if i)
meta={'version':1,'vertices':N,'triangles':len(faces),'surfaceSHA256':hashlib.sha256(shape_bytes).hexdigest(),'sourceRegistryCount':len(manifest['registry']),'mappedMuscleIds':len(used),'sourceDistanceMetres':{'mean':float(distance.mean()),'p50':float(np.quantile(distance,.5)),'p95':float(np.quantile(distance,.95)),'max':float(distance.max())},'sourceDistanceByRegion':{key:{'mean':float(distance[regions==key].mean()),'p95':float(np.quantile(distance[regions==key],.95)),'max':float(distance[regions==key].max())} for key in sorted(set(regions))},'weightSumMaxError':float(np.max(abs(sw.sum(axis=1)-1))),'binaryBytes':offset,'top4DiscardedWeight':{'mean':float(discarded.mean()),'max':float(discarded.max())},'binding':'Unchanged 79-bone Velora hierarchy; regional barycentric source transfer, surface smoothing, explicit complete hand/phalange weights','handVertexCounts':dict(hand_counts),'muscleVertices':{manifest['registry'][i-1]:count for i,count in used.items()},'jointBindingRevision':4,'colorProjection':{'method':'Separate regional closest-triangle BVH over configurable original superficial major muscles; true joint/tendon endpoints remain neutral; two edge-ring blending','eligibleSourceMuscleIds':sorted(major_ids),'rules':'tools/appearance/transfer-muscle-regions.json','projectedVertices':int(np.count_nonzero(ids)),'neutralVertices':int(np.count_nonzero(ids==0)),'distanceMeanMetres':float(np.nanmean(color_distance[ids>0])),'distanceP95Metres':float(np.nanquantile(color_distance[ids>0],.95))},'jointBinding':'Connected harmonic shoulder field (chest/humerus), unified pelvis/femur/tibia skin fields with consistent hip/knee DQ-LBS bands, complete hand web fairing; original muscle IDs independent; source shoulder/hip strip morphs disabled','elapsedSeconds':round(time.time()-START,2)}
(OUT/'athlete-skin.bin').write_bytes(b''.join(chunks));(OUT/'athlete-skin.json').write_text(json.dumps({'binary':'athlete-skin.bin','attributes':attrs,'index':index,'morphs':morphs,'registry':manifest['registry'],'bones':manifest['bones'],'meta':meta},ensure_ascii=False,indent=2));(SRC/'transfer-report.json').write_text(json.dumps(meta,ensure_ascii=False,indent=2));log('complete',**{k:v for k,v in meta.items() if k!='muscleVertices'})
