import fs from 'node:fs';import crypto from 'node:crypto';import * as THREE from 'three';
import {createHumanRig} from '../../src/humanRig.js';import{createAppearanceLayer}from'../../src/appearanceLayer.js';
globalThis.ProgressEvent??=class{constructor(t,o){Object.assign(this,o)}};
const base='http://127.0.0.1:4173';
const rig=await createHumanRig({modelUrl:base+'/anatomy.glb',skeletonUrl:base+'/skeleton.glb'});
const layer=await createAppearanceLayer(rig);const mesh=layer.mesh,g=mesh.geometry,p=g.attributes.position;
const regions=Array.from({length:p.count},(_,i)=>{const y=p.getY(i),x=p.getX(i),z=p.getZ(i);const side=x>0?'left':'right';return {side,kind:y<.02?'foot':y<.81&&Math.abs(x)>.18?'hand':'body'};});
const samples=[];
for(const ex of ['pushup','squat','curl']){rig.setExercise(ex);for(const phase of [0,.125,.25,.375,.5,.625,.75,.875,1]){rig.setPhase(phase);let min=Infinity,max=-Infinity,bad=0;const by={};const posed=new Float32Array(p.count*3);for(let i=0;i<p.count;i++){const v=mesh.getVertexPosition(i,new THREE.Vector3());v.toArray(posed,i*3);min=Math.min(min,v.y);max=Math.max(max,v.y);if(v.y<-.003)bad++;const {side,kind}=regions[i];const key=side+'-'+kind;const s=by[key]??={min:Infinity,max:-Infinity,below:0,count:0};s.min=Math.min(s.min,v.y);s.max=Math.max(s.max,v.y);s.count++;if(v.y<-.003)s.below++;}const hash=crypto.createHash('sha256').update(Buffer.from(posed.buffer)).digest('hex');samples.push({exercise:ex,phase,min,max,bad,by,hash});console.log(JSON.stringify({ex,phase,min,bad}));}}
fs.writeFileSync('output/appearance/posed-surface-check.json',JSON.stringify({vertices:p.count,samples},null,2));
