import fs from 'node:fs';
import * as THREE from 'three';
import { createHumanRig } from '../../src/humanRig.js';
globalThis.ProgressEvent ??= class{constructor(type,options){this.type=type;Object.assign(this,options)}};
const rig=await createHumanRig({modelUrl:'http://127.0.0.1:4173/anatomy.glb',skeletonUrl:'http://127.0.0.1:4173/skeleton.glb'});
const registry=rig.muscles.map(m=>m.name).sort();
const chunks=[];let offset=0;
function attribute(a){if(!a)return null;const data=Buffer.from(a.array.buffer,a.array.byteOffset,a.array.byteLength);const pad=(4-offset%4)%4;if(pad){chunks.push(Buffer.alloc(pad));offset+=pad;}const out={offset,length:a.array.length,itemSize:a.itemSize,type:a.array.constructor.name};chunks.push(data);offset+=data.length;return out;}
const meshes=[...rig.muscles,...rig.bones].map(m=>({name:m.name,id:m.userData.isBone?0:registry.indexOf(m.name)+1,region:m.userData.region,side:m.userData.side,tendon:m.userData.tendon,isBone:m.userData.isBone,attributes:Object.fromEntries(['position','normal','skinIndex','skinWeight','rigLinearBlend','rigQuadEnvelope'].map(n=>[n,attribute(m.geometry.attributes[n])])),indices:attribute(m.geometry.index),morphs:m.geometry.morphAttributes.position.map(attribute)}));
const schema=rig.schema;
const manifest={version:1,binary:'source-binding.bin',coordinates:'runtime meters, already hand-corrected',registry,meshes,bones:rig.joints.map((j,i)=>({index:i,name:j.bone.name,parent:j.parent,rest:j.rest.toArray()})),chains:schema.chains,spine:schema.spine,fingerData:schema.fingerData,rest:Object.fromEntries(Object.entries(schema.rest).map(([side,points])=>[side,Object.fromEntries(Object.entries(points).map(([n,v])=>[n,v?.toArray?.()??v]))]))};
fs.writeFileSync('output/appearance/source-binding.bin',Buffer.concat(chunks));
fs.writeFileSync('output/appearance/source-binding.json',JSON.stringify(manifest,null,2));
console.log(JSON.stringify({meshes:meshes.length,bytes:offset,registry:registry.length}));
