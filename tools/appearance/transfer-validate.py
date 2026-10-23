"""Validate exported exterior buffer contracts without loading a browser."""
import json, hashlib
from pathlib import Path
import numpy as np
ROOT=Path(__file__).resolve().parents[2]
base=ROOT/'public/appearance';meta=json.loads((base/'athlete-skin.json').read_text());raw=(base/meta['binary']).read_bytes();source=json.loads((ROOT/'output/appearance/source-binding.json').read_text())
dtypes={'Float32Array':'<f4','Uint16Array':'<u2','Uint32Array':'<u4'}
def read(d):
    a=np.frombuffer(raw,dtypes[d['type']],d['length'],d['offset']);return a.reshape(-1,d['itemSize'])
a={k:read(d) for k,d in meta['attributes'].items()};N=len(a['position']);bones=len(meta['bones']);checks={}
checks['finiteAttributes']=all(np.isfinite(v).all() for v in a.values())
checks['sameVertexCounts']=all(len(v)==N for v in a.values())
checks['indexRange']=bool(read(meta['index']).max()<N)
checks['skinIndexRange']=bool(a['skinIndex'].max()<bones)
checks['normalizedSkin']=bool(np.max(abs(a['skinWeight'].sum(axis=1)-1))<1e-5 and a['skinWeight'].min()>=0)
checks['normalizedMuscleField']=bool(np.max(abs(a['muscleWeights'].sum(axis=1)-1))<1e-5 and a['muscleWeights'].min()>=0)
checks['muscleIdRange']=bool(a['muscleIds'].max()<=len(meta['registry']) and a['muscleIds'].min()>=0 and np.all(a['muscleIds']==a['muscleIds'].astype(int)))
checks['originalRegistryExact']=meta['registry']==source['registry']
checks['originalSkeletonExact']=meta['bones']==source['bones']
q=a['rigQuadEnvelope'];active=q[:,1]>0
checks['discreteQuadIndices']=bool(np.all(q[active,0]==q[active,0].astype(int)) and set(q[active,0].tolist()).issubset({37.,71.}))
checks['fiveFiniteMorphs']=len(meta['morphs'])==5 and all(np.isfinite(read(d)).all() and len(read(d))==N for d in meta['morphs'])
checks['surfaceHashMatches']=meta['meta']['surfaceSHA256']==hashlib.sha256((base/'athlete-surface.json').read_bytes()).hexdigest()
if 'colorProjection' in meta['meta']:
    allowed=set(meta['meta']['colorProjection']['eligibleSourceMuscleIds'])|{0}
    checks['superficialIdAllowlist']=set(a['muscleIds'].reshape(-1).astype(int).tolist()).issubset(allowed)
result={'pass':all(checks.values()),'checks':{k:bool(v) for k,v in checks.items()},'vertices':N,'triangles':int(read(meta['index']).size//3),'bindingRevision':meta['meta'].get('jointBindingRevision'),'binaryBytes':len(raw),'binarySHA256':hashlib.sha256(raw).hexdigest()}
(ROOT/'output/appearance/transfer-validation.json').write_text(json.dumps(result,indent=2));print(json.dumps(result,indent=2))
if not result['pass']:raise SystemExit(1)
