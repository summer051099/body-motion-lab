import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { getExerciseMuscleRole } from './exerciseMuscles.js';
import { buildUniversalSkeleton, getFingerBinding } from './universalSkeleton.js';
import { EXERCISES, sampleExercise } from './exerciseClips.js';
import { HIP_MUSCLES, anatomicalLegWeights } from './legBinding.js';

// Procedural anatomical binding of the source's separate, unrigged meshes.
// Joint centers were fitted to the humeral head, tibial plateau and ankle
// geometry. This is an authored demonstration rig, not a validated motion-capture
// dataset or a claim of a clinical/anatomist-reviewed deformation model.
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const clamp = THREE.MathUtils.clamp;
const smooth = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const AXIS_X = V(1, 0, 0), AXIS_Y = V(0, 1, 0);
const REST_ANKLE = V(0, .0066, .0744);
const TOP_ELBOW_FLEXION = 8 * Math.PI / 180;
const ANGLE_BOTTOM = 7.0 * Math.PI / 180;
const materialDefaults = () => ({
  neutral: new THREE.MeshStandardMaterial({ color: '#a7aaa5', roughness: .66, metalness: 0, side: THREE.DoubleSide }),
  tendon: new THREE.MeshStandardMaterial({ color: '#c4c5bd', roughness: .72, side: THREE.DoubleSide }),
  red: new THREE.MeshStandardMaterial({ color: '#c9342d', roughness: .56, side: THREE.DoubleSide }),
  support: new THREE.MeshStandardMaterial({ color: '#e9a09a', roughness: .61, side: THREE.DoubleSide }),
  bone: new THREE.MeshStandardMaterial({ color: '#deddd4', roughness: .68, side: THREE.DoubleSide }),
});

function convertGeometry(source) {
  const g = source.clone();
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    p.setXYZ(i, x / 1000, z / 1000, -y / 1000);
  }
  if (g.attributes.normal) {
    const n = g.attributes.normal;
    for (let i = 0; i < n.count; i++) {
      const x = n.getX(i), y = n.getY(i), z = n.getZ(i);
      n.setXYZ(i, x, z, -y);
    }
  }
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

function spatialSide(box) {
  return box.getCenter(V()).x < 0 ? 'right' : 'left';
}

function meshRegion(n, b, isBone) {
  const cy = (b.min.y + b.max.y) * .5;
  // Spatial gates intentionally precede generic names: e.g. pronator teres is
  // not teres major, and flexor digitorum longus belongs to the foot/lower leg.
  if (b.max.y < .49) return 'lowerLeg';
  if (!isBone && HIP_MUSCLES.test(n)) return 'hip';
  if (b.max.y < 1.42 && b.min.y > .59) {
    if (isBone && /humerus/.test(n)) return 'upperArmBone';
    if (isBone && /radius|ulna/.test(n)) return 'forearmBone';
    if (isBone && /finger|thumb|metacarpal|scaphoid|lunate|triquetr|pisiform|trapezium|trapezoid|capitate|hamate/.test(n)) return 'hand';
    if (!isBone && /biceps brachii|triceps brachii|brachialis|coracobrachialis|anconeus/.test(n)) return 'upperArm';
    if (!isBone && /pronator|supinator|brachioradialis|carpi|digitorum (profundus|superficialis)|extensor (pollicis|indicis|digiti|digitorum)|flexor pollicis longus|abductor pollicis longus|palmaris|interosseous membrane/.test(n)) return 'forearm';
    if (cy < .82 && (b.min.x > .17 || b.max.x < -.17)) return 'hand';
  }
  if (isBone && /femur/.test(n)) return 'thigh';
  if (/gastrocnemius|soleus|tibialis|fibularis|peroneus|popliteus|plantaris/.test(n) && b.max.y<.65) return 'lowerLeg';
  if (/gluteus|vastus|rectus femoris|biceps femoris|semitendinosus|semimembranosus|adductor|gracilis|sartorius|obturator|piriformis|pectineus|tensor fasciae|iliotibial tract/.test(n) && b.max.y<1.04 && b.min.y<.75) return 'thigh';
  if (/deltoid|pectoralis major|subscapularis|supraspinatus|infraspinatus|teres major|teres minor/.test(n)) return 'shoulder';
  if (/scapula|clavicle/.test(n) && isBone) return 'scapula';
  if (/latissimus dorsi/.test(n)) return 'latissimus';
  return 'body';
}

export async function createHumanRig({ onProgress = () => {}, materials: suppliedMaterials = {}, modelUrl = '/anatomy.glb', skeletonUrl = '/skeleton.glb' } = {}) {
  const group = new THREE.Group();
  group.name = 'Velora-shared-human-rig-v1';
  const musclesGroup = new THREE.Group(), bonesGroup = new THREE.Group();
  musclesGroup.name = 'muscular-system'; bonesGroup.name = 'skeletal-system';
  group.add(musclesGroup, bonesGroup);
  const materials = { ...materialDefaults(), ...suppliedMaterials };
  const muscles = [], bones = [], allMeshes = [], contacts = { hands: [], toes: [] };
  // Exterior assets use this same skeleton and pose evaluation. The source
  // buffers remain untouched for semantic muscle IDs and regression checks.
  const surfaceLayers = new Set();
  const schema = buildUniversalSkeleton();
  const { root, joints, chains, spine, rest: REST } = schema;
  group.add(root);
  group.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(joints.map(j => j.bone));
  // Bind exactly once. Exercise switching never rebuilds or rebinds the skin.
  skeleton.calculateInverses();
  let exercise = 'pushup';
  // Dual-quaternion blending retains cross-sectional volume through shoulder
  // elevation and distributed pronation. CPU sampling uses the identical blend
  // as the vertex shader, so contact/strain inspection measures rendered skin.
  const dqReal = joints.map(() => new THREE.Vector4(0, 0, 0, 1));
  const dqDual = joints.map(() => new THREE.Vector4());
  const dqPixels = new Float32Array(joints.length * 8);
  const dqTexture = new THREE.DataTexture(dqPixels, 2, joints.length, THREE.RGBAFormat, THREE.FloatType);
  dqTexture.minFilter = dqTexture.magFilter = THREE.NearestFilter;
  dqTexture.generateMipmaps = false;
  const transformMatrix = new THREE.Matrix4(), rotationQ = new THREE.Quaternion();
  const translation = V(), unitScale = V();
  const translationQ = new THREE.Quaternion(), dualQ = new THREE.Quaternion();
  function updateDualQuaternions() {
    for (let i = 0; i < joints.length; i++) {
      transformMatrix.multiplyMatrices(skeleton.bones[i].matrixWorld, skeleton.boneInverses[i]);
      transformMatrix.decompose(translation, rotationQ, unitScale);
      translationQ.set(translation.x, translation.y, translation.z, 0);
      dualQ.multiplyQuaternions(translationQ, rotationQ);
      dqReal[i].set(rotationQ.x, rotationQ.y, rotationQ.z, rotationQ.w);
      dqDual[i].set(dualQ.x * .5, dualQ.y * .5, dualQ.z * .5, dualQ.w * .5);
      dqReal[i].toArray(dqPixels, i * 8); dqDual[i].toArray(dqPixels, i * 8 + 4);
    }
    dqTexture.needsUpdate = true;
  }
  function dualQuaternionSkin(index, vector) {
    const indices = this.geometry.attributes.skinIndex, weights = this.geometry.attributes.skinWeight;
    const ids = [indices.getX(index), indices.getY(index), indices.getZ(index), indices.getW(index)];
    const ws = [weights.getX(index), weights.getY(index), weights.getZ(index), weights.getW(index)];
    const reference = dqReal[ids[0]];
    const real = new THREE.Vector4(0, 0, 0, 0), dual = new THREE.Vector4(0, 0, 0, 0);
    for (let k = 0; k < 4; k++) {
      const sign = reference.dot(dqReal[ids[k]]) < 0 ? -1 : 1;
      real.addScaledVector(dqReal[ids[k]], ws[k] * sign);
      dual.addScaledVector(dqDual[ids[k]], ws[k] * sign);
    }
    const invLength = 1 / real.length();
    real.multiplyScalar(invLength); dual.multiplyScalar(invLength);
    dual.addScaledVector(real, -real.dot(dual));
    const q = new THREE.Quaternion(real.x, real.y, real.z, real.w);
    const d = new THREE.Quaternion(dual.x, dual.y, dual.z, dual.w);
    d.multiply(q.clone().conjugate());
    vector.applyMatrix4(this.bindMatrix);
    const source=vector.clone();
    vector.applyQuaternion(q).add(V(d.x * 2, d.y * 2, d.z * 2));
    const linearMix=this.geometry.attributes.rigLinearBlend?.getX(index)||0;
    if(linearMix>0){
      const linear=V();
      for(let k=0;k<4;k++)if(ws[k]>0){
        const rr=dqReal[ids[k]],dd=dqDual[ids[k]],rq=new THREE.Quaternion(rr.x,rr.y,rr.z,rr.w);
        const tq=new THREE.Quaternion(dd.x,dd.y,dd.z,dd.w).multiply(rq.clone().conjugate());
        linear.addScaledVector(source.clone().applyQuaternion(rq).add(V(2*tq.x,2*tq.y,2*tq.z)),ws[k]);
      }
      vector.lerp(linear,linearMix);
    }
    const envelope=this.geometry.attributes.rigQuadEnvelope;
    if(envelope && envelope.getY(index)>0){
      const idx=envelope.getX(index),rr=dqReal[idx],dd=dqDual[idx];
      const qr=new THREE.Quaternion(rr.x,rr.y,rr.z,rr.w),qi=qr.clone().conjugate();
      const tq=new THREE.Quaternion(dd.x,dd.y,dd.z,dd.w).multiply(qi);
      const local=vector.clone().sub(V(tq.x*2,tq.y*2,tq.z*2)).applyQuaternion(qi);
      const excess=Math.max(0,local.z-source.z-.003)*envelope.getY(index);
      vector.sub(V(0,0,excess).applyQuaternion(qr));
    }
    return vector.applyMatrix4(this.bindMatrixInverse);
  }
  const dqDeclarations = `
    #ifdef USE_SKINNING
      attribute float rigLinearBlend;
      attribute vec2 rigQuadEnvelope;
      uniform sampler2D rigDQTexture;
      vec4 rigDQReal(int i) { return texture2D(rigDQTexture,vec2(0.25,(float(i)+0.5)/${joints.length}.0)); }
      vec4 rigDQDual(int i) { return texture2D(rigDQTexture,vec2(0.75,(float(i)+0.5)/${joints.length}.0)); }
      vec4 rigQuatMultiply(vec4 a, vec4 b) {
        return vec4(a.w*b.xyz + b.w*a.xyz + cross(a.xyz,b.xyz), a.w*b.w-dot(a.xyz,b.xyz));
      }
      vec3 rigBonePosition(int i,vec3 p) {
        vec4 q=rigDQReal(i),d=rigDQDual(i);
        vec3 t=2.0*rigQuatMultiply(d,vec4(-q.xyz,q.w)).xyz;
        return p+2.0*cross(q.xyz,cross(q.xyz,p)+q.w*p)+t;
      }
      vec3 rigQuatRotate(vec4 q, vec3 p) {
        return p + 2.0 * cross(q.xyz, cross(q.xyz,p) + q.w*p);
      }
    #endif
  `;
  const dqBase = `
    #ifdef USE_SKINNING
      ivec4 rigIds=ivec4(skinIndex);
      vec4 rigReference=rigDQReal(rigIds.x);
      vec4 rigSigns=vec4(dot(rigReference,rigDQReal(rigIds.x))<0.0?-1.0:1.0,
        dot(rigReference,rigDQReal(rigIds.y))<0.0?-1.0:1.0,
        dot(rigReference,rigDQReal(rigIds.z))<0.0?-1.0:1.0,
        dot(rigReference,rigDQReal(rigIds.w))<0.0?-1.0:1.0);
      vec4 rigWeights=skinWeight*rigSigns;
      vec4 rigReal=rigWeights.x*rigDQReal(rigIds.x)+rigWeights.y*rigDQReal(rigIds.y)+rigWeights.z*rigDQReal(rigIds.z)+rigWeights.w*rigDQReal(rigIds.w);
      vec4 rigDual=rigWeights.x*rigDQDual(rigIds.x)+rigWeights.y*rigDQDual(rigIds.y)+rigWeights.z*rigDQDual(rigIds.z)+rigWeights.w*rigDQDual(rigIds.w);
      float rigInverseLength=1.0/length(rigReal);
      rigReal*=rigInverseLength; rigDual*=rigInverseLength;
      rigDual-=rigReal*dot(rigReal,rigDual);
    #endif
  `;
  function configureDQMaterial(material, exteriorNormals = false) {
    const priorHook = material.onBeforeCompile;
    material.onBeforeCompile = (shader, renderer) => {
      priorHook?.call(material, shader, renderer);
      shader.uniforms.rigDQTexture = { value: dqTexture };
      shader.vertexShader = shader.vertexShader
        .replace('#include <skinning_pars_vertex>', '#include <skinning_pars_vertex>\n' + dqDeclarations)
        .replace('#include <skinbase_vertex>', dqBase)
        .replace('#include <skinnormal_vertex>', `
          #ifdef USE_SKINNING
            ${exteriorNormals ? `
            vec3 rigDQNormal=rigQuatRotate(rigReal,objectNormal);
            vec3 rigLinearNormal=skinWeight.x*rigQuatRotate(rigDQReal(rigIds.x),objectNormal)
              +skinWeight.y*rigQuatRotate(rigDQReal(rigIds.y),objectNormal)
              +skinWeight.z*rigQuatRotate(rigDQReal(rigIds.z),objectNormal)
              +skinWeight.w*rigQuatRotate(rigDQReal(rigIds.w),objectNormal);
            objectNormal=normalize(mix(rigDQNormal,rigLinearNormal,rigLinearBlend));
            ` : 'objectNormal=rigQuatRotate(rigReal,objectNormal);'}
            #ifdef USE_TANGENT
              objectTangent=rigQuatRotate(rigReal,objectTangent);
            #endif
          #endif
        `)
        .replace('#include <skinning_vertex>', `
          #ifdef USE_SKINNING
            vec3 rigTranslation=2.0*rigQuatMultiply(rigDual,vec4(-rigReal.xyz,rigReal.w)).xyz;
            vec3 rigRestPosition=(bindMatrix*vec4(transformed,1.0)).xyz;
            vec3 rigDQPosition=rigQuatRotate(rigReal,rigRestPosition)+rigTranslation;
            vec3 rigLinearPosition=skinWeight.x*rigBonePosition(rigIds.x,rigRestPosition)+skinWeight.y*rigBonePosition(rigIds.y,rigRestPosition)+skinWeight.z*rigBonePosition(rigIds.z,rigRestPosition)+skinWeight.w*rigBonePosition(rigIds.w,rigRestPosition);
            vec3 rigSkinnedPosition=mix(rigDQPosition,rigLinearPosition,rigLinearBlend);
            if(rigQuadEnvelope.y>0.0){
              int rigFemurId=int(rigQuadEnvelope.x);
              vec4 rigFQ=rigDQReal(rigFemurId),rigFD=rigDQDual(rigFemurId);
              vec3 rigFT=2.0*rigQuatMultiply(rigFD,vec4(-rigFQ.xyz,rigFQ.w)).xyz;
              vec3 rigLocal=rigQuatRotate(vec4(-rigFQ.xyz,rigFQ.w),rigSkinnedPosition-rigFT);
              float rigExcess=max(0.0,rigLocal.z-rigRestPosition.z-0.003)*rigQuadEnvelope.y;
              rigSkinnedPosition-=rigQuatRotate(rigFQ,vec3(0.0,0.0,rigExcess));
            }
            transformed=(bindMatrixInverse*vec4(rigSkinnedPosition,1.0)).xyz;
          #endif
        `);
    };
    material.customProgramCacheKey = () => 'velora-anatomical-envelope-v3-' + joints.length;
    material.needsUpdate = true;
  }
  Object.values(materials).forEach(material => configureDQMaterial(material));
  const depthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  const distanceMaterial = new THREE.MeshDistanceMaterial();
  configureDQMaterial(depthMaterial); configureDQMaterial(distanceMaterial);

  const spineStations=[spine.pelvis,spine.lumbar,spine.lumbarUpper,spine.thorax,spine.chest,spine.neck,spine.neckUpper,spine.head].filter((v,i,a)=>v!==undefined&&a.indexOf(v)===i).sort((a,b)=>joints[a].rest.y-joints[b].rest.y);
  function torsoWeights(y){
    if(y<=joints[spineStations[0]].rest.y)return [[spineStations[0],1]];
    for(let i=1;i<spineStations.length;i++){
      const a=spineStations[i-1],b=spineStations[i];
      if(y<=joints[b].rest.y){const t=smooth(joints[a].rest.y,joints[b].rest.y,y);return [[a,1-t],[b,t]];}
    }
    return [[spineStations.at(-1),1]];
  }
  const loader = new GLTFLoader();
  onProgress('正在读取肌肉与骨骼几何');
  const gltfs = await Promise.all([loader.loadAsync(modelUrl), loader.loadAsync(skeletonUrl)]);
  let vertices = 0, triangles = 0, maxWeightError = 0;
  const regionCounts = {};
  function build(child, isBone) {
    const name = child.name.replace(/_/g, ' '), n = name.toLowerCase();
    const geometry = convertGeometry(child.geometry);
    const sourceBounds = geometry.boundingBox.clone();
    const region = meshRegion(n, sourceBounds, isBone);
    const side = spatialSide(sourceBounds), sign = side === 'left' ? 1 : -1;
    const r = REST[side], c = chains[side];
    const tendon = /tendon|ligament|retinaculum|membrane|aponeurosis/.test(n);
    const highlightRole = getExerciseMuscleRole(exercise, n, { isBone, isTendon: tendon });
    const active = highlightRole === 'primary';
    const originalMaterial = isBone ? materials.bone : tendon ? materials.tendon : materials.neutral;
    const p = geometry.attributes.position;
    // Extend the slightly flexed source digits into the palm plane. The same
    // correction is applied to hand bones and muscle/tendon vertices, avoiding
    // a fingertip-ground intersection from using the untouched resting pose.
    if (region === 'hand' || region === 'forearm') {
      for (let i = 0; i < p.count; i++) {
        const y = p.getY(i);
        p.setZ(i, p.getZ(i) - .45 * Math.max(0, .79 - y));
      }
      geometry.computeVertexNormals();
    }
    const skinIndices = new Uint16Array(p.count * 4), skinWeights = new Float32Array(p.count * 4);
    const elbowCorrection = new Float32Array(p.array.length), shoulderCorrection = new Float32Array(p.array.length), hipCorrection = new Float32Array(p.array.length), kneeCorrection = new Float32Array(p.array.length), fasciaCorrection = new Float32Array(p.array.length);
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i), ax = Math.abs(x);
      let entries = torsoWeights(y);
      if (region === 'upperArmBone') entries = [[c.upper, 1]];
      if (region === 'forearmBone') entries = [[/radius/.test(n) ? c.twist3 : c.forearm, 1]];
      if (region === 'hand') entries = isBone && !/phalanx|metacarpal/.test(n) ? [[c.hand,1]] : getFingerBinding(n,V(x,y,z),side,schema) || [[c.hand,1]];
      if (region === 'scapula') entries = [[/clavicle/.test(n) ? c.clavicle : c.scapula, 1]];
      if (region === 'upperArm') {
        // Cross-elbow muscle insertions follow the proximal ulna/radius. The
        // belly remains on the humerus, unlike a whole-mesh rigid attachment.
        const distal = 1 - smooth(r.elbow.y - .012, r.elbow.y + .073, y);
        const proximal = smooth(1.28, 1.34, y) * (1 - smooth(.14, .19, ax));
        entries = [[c.upper, (1 - distal) * (1 - proximal)], [c.forearm, distal], [c.scapula, (1 - distal) * proximal]];
      }
      if (region === 'forearm') {
        const upper = smooth(r.elbow.y - .045, r.elbow.y + .022, y);
        const hand = 1 - smooth(.802, .855, y);
        const twist = (1 - smooth(.815, 1.020, y)) * 3;
        const station = Math.min(2, Math.floor(twist)), mix = twist - station;
        const twistBones = [c.forearm, c.twist1, c.twist2, c.twist3];
        entries = [[twistBones[station], (1 - upper) * (1 - hand) * (1 - mix)], [twistBones[station + 1], (1 - upper) * (1 - hand) * mix], [c.upper, upper], [c.hand, (1 - upper) * hand]];
      }
      if (region === 'forearm' && !isBone && y < .78 && /digitorum|pollicis|indicis|digiti minimi/.test(n)) {
        const handWeight=entries.find(([idx])=>idx===c.hand)?.[1]||0;
        const digitMix=1-smooth(.735,.78,y);
        entries=entries.filter(([idx])=>idx!==c.hand);
        entries.push([c.hand,handWeight*(1-digitMix)]);
        for(const [idx,w] of getFingerBinding(n,V(x,y,z),side,schema)) entries.push([idx,w*handWeight*digitMix]);
      }
      if (region === 'shoulder') {
        let humerus;
        if (/pectoralis major/.test(n)) {
          const insertionDistance = Math.sqrt((ax - .18) ** 2 + (y - 1.275) ** 2 + (z - .092) ** 2);
          humerus = 1 - smooth(.016, .115, insertionDistance);
          humerus *= smooth(.09, .165, ax);
        } else if (/deltoid/.test(n)) {
          humerus = (1 - smooth(1.205, 1.347, y)) * smooth(.105, .18, ax);
          humerus = clamp(humerus * 1.25, 0, 1);
        } else {
          const d = Math.sqrt((ax - .165) ** 2 + (y - 1.31) ** 2 + (z - .075) ** 2);
          humerus = (1 - smooth(.015, .092, d)) * smooth(.12, .17, ax);
        }
        const scapular = /pectoralis major/.test(n) ? .22 : .7;
        entries = [[c.upper, humerus], [c.scapula, (1 - humerus) * scapular], [spine.chest, (1 - humerus) * (1 - scapular)]];
      }
      if (region === 'latissimus') {
        const insertion = smooth(.1, .165, ax) * smooth(1.16, 1.29, y);
        entries = [[torsoWeights(y)[0][0], 1 - insertion], [c.upper, insertion]];
      }
      if (region === 'lowerLeg' && isBone) {
        entries = /patella/.test(n) ? [[c.patella,1]] : /tibia|fibula/.test(n) ? [[c.shin, 1]] : /toe|sesamoid/.test(n) ? [[c.toe, 1]] : [[c.foot, 1]];
      }
      if (region === 'lowerLeg' && !isBone) {
        const foot = 1 - smooth(-.015, .08, y);
        const toe = (1 - smooth(-.028, .02, y)) * smooth(.159, .198, z);
        entries = [[c.shin, 1 - foot], [c.foot, foot * (1 - toe)], [c.toe, foot * toe]];
      }
      if (region === 'thigh' && isBone) entries=[[c.thigh,1]];
      if (!isBone && /hip|thigh|lowerLeg/.test(region)) {
        const specific=anatomicalLegWeights(n,{x,y,z},sourceBounds,r,c,spine,torsoWeights(y));
        if(specific)entries=specific;
      }
      // Rigid anatomical bones do not bend at distributed spine stations.
      if (isBone && region === 'body') {
        const tw = torsoWeights(sourceBounds.getCenter(V()).y).sort((a,b)=>b[1]-a[1]);
        entries = [[tw[0][0],1]];
      }
      // Optional twist helpers share their parent pivot; blend in the muscle
      // belly without creating fictitious segment length.
      if (!isBone && region === 'upperArm') {
        const e=entries.find(e=>e[0]===c.upper);
        if(e){const w=e[1]*.4;e[1]-=w;entries.push([c.upperTwist,w]);}
      }
      if (!isBone && region === 'thigh') {
        const e=entries.find(e=>e[0]===c.thigh);
        if(e){const w=e[1]*.35;e[1]-=w;entries.push([c.thighTwist,w]);}
      }
      if (!isBone && region === 'lowerLeg') {
        const e=entries.find(e=>e[0]===c.shin);
        if(e){const w=e[1]*.35;e[1]-=w;entries.push([c.shinTwist,w]);}
      }
      // Consolidate, normalize and keep the strongest four influences.
      const combined = new Map();
      for(const [idx,w] of entries) combined.set(idx,(combined.get(idx)||0)+w);
      entries = [...combined].filter(([,weight])=>weight>.000001).sort((a,b)=>b[1]-a[1]).slice(0,4);

      const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
      let totalStored = 0;
      for (let k = 0; k < 4; k++) {
        skinIndices[i * 4 + k] = entries[k]?.[0] || 0;
        skinWeights[i * 4 + k] = (entries[k]?.[1] || 0) / total;
        totalStored += skinWeights[i * 4 + k];
      }
      maxWeightError = Math.max(maxWeightError, Math.abs(totalStored - 1));
      // Corrective shape keys counter the LBS radial loss at a flexed elbow.
      // Their support is limited to the joint; they do not scale whole muscles.
      const ew = entries.find(([index]) => index === c.forearm)?.[1] || 0;
      const uw = entries.find(([index]) => index === c.upper)?.[1] || 0;
      const blend = isBone ? 0 : 4 * ew * uw;
      elbowCorrection[i * 3] = (x - r.elbow.x) * .05 * blend;
      elbowCorrection[i * 3 + 1] = 0;
      elbowCorrection[i * 3 + 2] = (z - r.elbow.z) * .05 * blend;
      const shoulderBlend = !isBone && region === 'shoulder' ? 4 * uw * (1 - uw) : 0;
      shoulderCorrection[i * 3] = (x - r.shoulder.x) * .025 * shoulderBlend;
      shoulderCorrection[i * 3 + 1] = (y - r.shoulder.y) * .025 * shoulderBlend;
      shoulderCorrection[i * 3 + 2] = (z - r.shoulder.z) * .025 * shoulderBlend;
      const thighW=entries.find(([idx])=>idx===c.thigh)?.[1]||0;
      const pelvisW=entries.find(([idx])=>idx===spine.pelvis)?.[1]||0;
      const shinW=entries.find(([idx])=>idx===c.shin)?.[1]||0;
      const hw=isBone?0:4*thighW*pelvisW,kw=isBone?0:4*thighW*shinW;
      hipCorrection[i*3]=(x-r.hip.x)*.08*hw;
      hipCorrection[i*3+2]=(z-r.hip.z)*.08*hw;
      kneeCorrection[i*3]=(x-r.knee.x)*.08*kw;
      kneeCorrection[i*3+2]=(z-r.knee.z)*.08*kw;
      if(/iliotibial tract/.test(n)){
        // Keep this thin outer fascial layer outside the independently sliding
        // quadriceps surface during flexion, tapering to its fixed end points.
        fasciaCorrection[i*3]=sign*.012*smooth(.32,.43,y)*(1-smooth(.77,.92,y));
      }
    }
    const linearBlend=new Float32Array(p.count);
    if(!isBone && (region==='hip'||region==='thigh')) linearBlend.fill(/vastus|rectus femoris/.test(n)?1:/gluteus/.test(n)?.85:.65);
    const quadEnvelope=new Float32Array(p.count*2);
    if(!isBone && /vastus|rectus femoris/.test(n))for(let i=0;i<p.count;i++){
      const y=p.getY(i);
      quadEnvelope[i*2]=c.thigh;
      // The tendon stays attached to patella; only the proximal transition is
      // constrained to the original femoral front envelope to avoid a loop.
      quadEnvelope[i*2+1]=smooth(.390,.450,y)*(1-smooth(.58,.68,y));
    }
    geometry.setAttribute('rigQuadEnvelope',new THREE.Float32BufferAttribute(quadEnvelope,2));
    geometry.setAttribute('rigLinearBlend',new THREE.Float32BufferAttribute(linearBlend,1));
    geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndices, 4));
    geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeights, 4));
    geometry.morphTargetsRelative = true;
    geometry.morphAttributes.position = [new THREE.Float32BufferAttribute(elbowCorrection, 3), new THREE.Float32BufferAttribute(shoulderCorrection, 3), new THREE.Float32BufferAttribute(hipCorrection, 3), new THREE.Float32BufferAttribute(kneeCorrection, 3), new THREE.Float32BufferAttribute(fasciaCorrection,3)];
    geometry.computeBoundingBox(); geometry.computeBoundingSphere();
    const mesh = new THREE.SkinnedMesh(geometry, active ? materials.red : highlightRole === 'support' ? materials.support : originalMaterial);
    mesh.name = name;
    mesh.bind(skeleton, new THREE.Matrix4());
    mesh.applyBoneTransform = dualQuaternionSkin;
    mesh.customDepthMaterial = depthMaterial;
    mesh.customDistanceMaterial = distanceMaterial;
    mesh.frustumCulled = false;
    mesh.castShadow = true; mesh.receiveShadow = true;
    Object.assign(mesh.userData, { side, region, tendon, active, highlightRole, isBone, originalMaterial, sourceVertexCount: p.count, sourceIndexCount: geometry.index?.count || 0 });
    mesh.morphTargetDictionary = { elbowVolume: 0, shoulderVolume: 1, hipVolume:2, kneeVolume:3, fasciaClearance:4 };
    (isBone ? bonesGroup : musclesGroup).add(mesh);
    (isBone ? bones : muscles).push(mesh); allMeshes.push(mesh);
    regionCounts[region] = (regionCounts[region] || 0) + 1;
    vertices += p.count; triangles += (geometry.index?.count || p.count) / 3;
    // Contact samples include every hand/toe vertex rather than just bone pivots.
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i), z = p.getZ(i);
      if ((region === 'hand' || region === 'forearm') && y < .79) contacts.hands.push({ mesh, index: i, side });
      if (region === 'lowerLeg' && y < -.035 && z > .198) contacts.toes.push({ mesh, index: i, side });
    }
  }
  gltfs.forEach((gltf, idx) => gltf.scene.traverse(child => { if (child.isMesh) build(child, idx === 1); }));
  onProgress('正在校准掌部与足趾接触');
  const handQ = new THREE.Quaternion().setFromAxisAngle(AXIS_Y, Math.PI)
    .multiply(new THREE.Quaternion().setFromAxisAngle(AXIS_X, Math.PI / 2));
  const footQ = new THREE.Quaternion().setFromAxisAngle(AXIS_X, Math.PI / 3);
  const toeQ = new THREE.Quaternion().setFromAxisAngle(AXIS_X, -4 * Math.PI / 180);
  const ankleWorld = V(0, .139, -.81);
  const handTargets = { left: V(.270, .1, .280), right: V(-.270, .1, .280) };
  // Calibrate complete source geometry against floor. Each planted hand has a
  // constant transform throughout the cycle; no generated screen-space masks.
  for (const side of ['left', 'right']) {
    let min = Infinity;
    for (const sample of contacts.hands) if (sample.side === side) {
      const v = V().fromBufferAttribute(sample.mesh.geometry.attributes.position, sample.index).sub(REST[side].wrist).applyQuaternion(handQ);
      min = Math.min(min, v.y);
    }
    handTargets[side].y = -min + .002;
  }
  const toeTargets = {};
  let calibratedAnkleY = -Infinity;
  for (const side of ['left', 'right']) {
    const r = REST[side];
    const mtpRelative = r.mtp.clone().sub(r.ankle).applyQuaternion(footQ);
    let min = Infinity;
    for (const sample of contacts.toes) if (sample.side === side) {
      const local = V().fromBufferAttribute(sample.mesh.geometry.attributes.position, sample.index).sub(r.mtp).applyQuaternion(toeQ);
      min = Math.min(min, local.y);
    }
    calibratedAnkleY = Math.max(calibratedAnkleY, .001 - mtpRelative.y - min);
  }
  // A 1.5 mm subpixel clearance also covers the plantar edge of the
  // proximal toe phalanges, outside the distal-toe calibration subset.
  ankleWorld.y = calibratedAnkleY + .0015;
  for (const side of ['left', 'right']) {
    const r = REST[side], a = ankleWorld.clone(); a.x = r.ankle.x;
    toeTargets[side] = r.mtp.clone().sub(r.ankle).applyQuaternion(footQ).add(a);
  }
  // Derive the top plank height from the actual planted wrist and measured
  // segment lengths, so reaching the floor never stretches an arm segment.
  let topPitch = ANGLE_BOTTOM;
  for (const side of ['left', 'right']) {
    const r = REST[side], lengths = chains[side].lengths;
    const desiredReach = Math.sqrt(lengths.upper ** 2 + lengths.lower ** 2 + 2 * lengths.upper * lengths.lower * Math.cos(TOP_ELBOW_FLEXION));
    let lo = ANGLE_BOTTOM, hi = .5;
    for (let step = 0; step < 50; step++) {
      const mid = (lo + hi) * .5;
      const q = new THREE.Quaternion().setFromAxisAngle(AXIS_X, Math.PI / 2 - mid);
      const shoulder = r.shoulder.clone().sub(REST_ANKLE).applyQuaternion(q).add(ankleWorld);
      if (shoulder.distanceTo(handTargets[side]) > desiredReach) hi = mid; else lo = mid;
    }
    topPitch = side === 'left' ? lo : Math.min(topPitch, lo);
  }
  let pose = { phase:0,depth:0,arms:{},legs:{},landmarks:{} }, equipment=[];
  let minRestY=Infinity;
  for(const mesh of allMeshes) minRestY=Math.min(minRestY,mesh.geometry.boundingBox.min.y);
  const standingOffset=-minRestY+.002;
  const context={...schema,handTargets,toeTargets,ankleWorld,topPitch,standingOffset};
  const equipmentGroup=new THREE.Group();equipmentGroup.name='bound-equipment';group.add(equipmentGroup);
  const dumbbells={};
  function makeDumbbell(){
    const g=new THREE.Group();
    const steel=new THREE.MeshStandardMaterial({color:'#65706a',metalness:.75,roughness:.27});
    const rubber=new THREE.MeshStandardMaterial({color:'#263b34',metalness:.15,roughness:.65});
    const shaft=new THREE.Mesh(new THREE.CylinderGeometry(.012,.012,.23,20),steel);shaft.rotation.z=-Math.PI/2;g.add(shaft);
    for(const x of [-.09,.09]) {const plate=new THREE.Mesh(new THREE.CylinderGeometry(.065,.065,.045,12),rubber);plate.rotation.z=-Math.PI/2;plate.position.x=x;plate.castShadow=true;g.add(plate);}
    g.traverse(m=>{if(m.isMesh){m.castShadow=true;m.receiveShadow=true;}});return g;
  }
  for(const side of ['left','right']){dumbbells[side]=makeDumbbell();equipmentGroup.add(dumbbells[side]);}
  function setPhase(inputPhase) {
    const phase=clamp(Number(inputPhase),0,1);
    const sampled=sampleExercise(exercise,phase,context);
    // The patella is a rigid body sliding around the knee, not part of tibia.
    // Its orientation bisects thigh/shin, with a small anterior arc clearance.
    for(const side of ['left','right']){
      const c=chains[side],r=REST[side];
      const thigh=sampled.targets[c.thigh],shin=sampled.targets[c.shin];
      const q=thigh.quaternion.clone().slerp(shin.quaternion,.5);
      const flex=sampled.pose.legs?.[side]?.kneeFlexion||0;
      const position=r.patella.clone().sub(r.knee).applyQuaternion(q).add(shin.position);
      position.add(V(0,0,.012*Math.sin(flex*.5)).applyQuaternion(q));
      sampled.targets[c.patella]={position,quaternion:q};
    }
    pose=sampled.pose;pose.phase=phase;pose.exercise=exercise;
    equipment=sampled.equipment||[];
    for(let i=0;i<joints.length;i++){
      const j=joints[i],t=sampled.targets[i];
      const world=new THREE.Matrix4().compose(t.position,t.quaternion,V(1,1,1));
      if(i>0){const p=sampled.targets[j.parent];world.premultiply(new THREE.Matrix4().compose(p.position,p.quaternion,V(1,1,1)).invert());}
      world.decompose(j.bone.position,j.bone.quaternion,j.bone.scale);
    }
    for(const mesh of allMeshes){
      const a=pose.arms?.[mesh.userData.side],l=pose.legs?.[mesh.userData.side];
      mesh.morphTargetInfluences[0]=Math.sin((a?.elbowFlexion||0)*.5)**2;
      mesh.morphTargetInfluences[1]=.75+.25*(pose.depth||0);
      mesh.morphTargetInfluences[2]=Math.sin((l?.hipFlexion||0)*.5)**2;
      mesh.morphTargetInfluences[3]=Math.sin((l?.kneeFlexion||0)*.5)**2;
      mesh.morphTargetInfluences[4]=smooth(.10,1.30,l?.kneeFlexion||0);
    }
    equipmentGroup.visible=exercise==='curl';
    for(const item of equipment){const g=dumbbells[item.side];if(g){g.position.copy(item.position);g.quaternion.copy(item.quaternion);}}
    group.updateMatrixWorld(true);skeleton.update();updateDualQuaternions();
    for (const layer of surfaceLayers) layer.setPose?.(pose);
    return getPoseDiagnostics(false);
  }
  function contactStats(list) {
    const bySide = {};
    for (const side of ['left', 'right']) bySide[side] = { minY: Infinity, maxY: -Infinity, min: V(Infinity, Infinity, Infinity), max: V(-Infinity, -Infinity, -Infinity), vertices: 0 };
    for (const { mesh, index, side } of list) {
      const v = mesh.getVertexPosition(index, V()).applyMatrix4(mesh.matrixWorld);
      const s = bySide[side]; s.minY = Math.min(s.minY, v.y); s.maxY = Math.max(s.maxY, v.y); s.min.min(v); s.max.max(v); s.vertices++;
    }
    return Object.fromEntries(Object.entries(bySide).map(([side, s]) => [side, { minY: s.minY, maxY: s.maxY, min: s.min.toArray(), max: s.max.toArray(), vertices: s.vertices }]));
  }
  function vectorJSON(value){
    if(value?.isVector3)return value.toArray();
    if(value?.isQuaternion)return value.toArray();
    if(Array.isArray(value))return value.map(vectorJSON);
    if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,vectorJSON(v)]));
    return value;
  }
  function getPoseDiagnostics(includeGeometry = true) {
    const data=vectorJSON(pose);
    for(const a of Object.values(data.arms||{})){
      if(a.elbowFlexion!==undefined)a.elbowFlexionDeg=THREE.MathUtils.radToDeg(a.elbowFlexion);
    }
    for(const l of Object.values(data.legs||{})){
      if(l.kneeFlexion!==undefined)l.kneeFlexionDeg=THREE.MathUtils.radToDeg(l.kneeFlexion);
      if(l.hipFlexion!==undefined)l.hipFlexionDeg=THREE.MathUtils.radToDeg(l.hipFlexion);
    }
    return {...data,equipment:vectorJSON(equipment),binding:getBindingSignature(),
      ...(includeGeometry?{handGeometry:contactStats(contacts.hands),toeGeometry:contactStats(contacts.toes)}:{})};
  }
  // An inexpensive deterministic signature; full audit additionally hashes every
  // static buffer and every bind inverse before/after exercise switches.
  function getBindingSignature(){return {skeletonUUID:skeleton.uuid,bindingCount:allMeshes.length,jointCount:joints.length,skinVersion:1};}
  function inspectGeometry({ stride = 31 } = {}) {
    let finite = true, minY = Infinity, maxY = -Infinity, tested = 0, topologyPreserved = true;
    const box = new THREE.Box3();
    for (const mesh of allMeshes) {
      topologyPreserved &&= mesh.geometry.attributes.position.count === mesh.userData.sourceVertexCount && (mesh.geometry.index?.count || 0) === mesh.userData.sourceIndexCount;
      for (let i = 0; i < mesh.geometry.attributes.position.count; i += stride) {
        const v = mesh.getVertexPosition(i, V()).applyMatrix4(mesh.matrixWorld);
        finite &&= v.toArray().every(Number.isFinite); minY = Math.min(minY, v.y); maxY = Math.max(maxY, v.y); tested++; box.expandByPoint(v);
      }
    }
    return { finite, topologyPreserved, tested, minY, maxY, bounds: { min: box.min.toArray(), max: box.max.toArray() }, ...getPoseDiagnostics(true) };
  }
  const diagnostics = {
    muscleMeshes: muscles.length, boneMeshes: bones.length, jointCount: joints.length,
    vertices, triangles, maxWeightError, regionCounts,
    originalSkins: gltfs.reduce((sum, g) => sum + (g.parser.json.skins?.length || 0), 0),
    originalAnimations: gltfs.reduce((sum, g) => sum + g.animations.length, 0),
    activeMuscles: muscles.filter(m => m.userData.active).map(m => m.name),
    supportMuscles: muscles.filter(m => m.userData.highlightRole === 'support').map(m => m.name),
    highlightRoleCounts: muscles.reduce((counts, mesh) => {
      counts[mesh.userData.highlightRole]++;
      return counts;
    }, { primary: 0, support: 0, none: 0 }),
    schemaVersion:'velora-human-v2',
    boneManifest:joints.map((j,i)=>({index:i,name:j.bone.name,parent:j.parent,rest:j.rest.toArray()})),
    method: 'Shared semantic/spatial four-weight dual-quaternion skeletal binding, analytic planted-contact arm IK, distributed forearm pronation with rigid radius/ulna, shoulder/elbow volume corrective morphs, MTP toe extension, digit extension corrective.',
  };
  setPhase(0);
  onProgress('通用人体绑定完成');
  let highlightEnabled = true, supportHighlightEnabled = true;
  function updateHighlightMaterials() {
    for (const mesh of muscles) {
      const role = mesh.userData.highlightRole;
      mesh.material = highlightEnabled && role === 'primary' ? materials.red
        : highlightEnabled && supportHighlightEnabled && role === 'support' ? materials.support
        : mesh.userData.originalMaterial;
    }
    for (const layer of surfaceLayers) layer.setHighlight?.({ exercise, enabled: highlightEnabled, support: supportHighlightEnabled });
  }
  return {
    group, muscles, bones, musclesGroup, bonesGroup, skeleton, joints, materials, diagnostics, schema, equipmentGroup,
    setPhase, getPoseDiagnostics, inspectGeometry, getBindingSignature,
    bindAppearanceGeometry(geometry, material) {
      configureDQMaterial(material, true);
      const dqKey = material.customProgramCacheKey();
      material.customProgramCacheKey = () => dqKey + '-appearance-v1';
      const mesh = new THREE.SkinnedMesh(geometry, material);
      mesh.bind(skeleton, new THREE.Matrix4());
      mesh.applyBoneTransform = dualQuaternionSkin;
      mesh.customDepthMaterial = depthMaterial;
      mesh.customDistanceMaterial = distanceMaterial;
      mesh.frustumCulled = false;
      mesh.castShadow = mesh.receiveShadow = true;
      return mesh;
    },
    attachAppearanceLayer(layer) {
      surfaceLayers.add(layer);
      layer.setPose?.(pose);
      layer.setHighlight?.({ exercise, enabled: highlightEnabled, support: supportHighlightEnabled });
      return () => surfaceLayers.delete(layer);
    },
    setExercise(id){
      if(!EXERCISES[id])throw new Error('Unknown exercise: '+id);
      exercise=id;
      for(const mesh of muscles){const role=getExerciseMuscleRole(id,mesh.name,{isTendon:mesh.userData.tendon});mesh.userData.highlightRole=role;mesh.userData.active=role==='primary';}
      diagnostics.activeMuscles=muscles.filter(m=>m.userData.highlightRole==='primary').map(m=>m.name);
      diagnostics.supportMuscles=muscles.filter(m=>m.userData.highlightRole==='support').map(m=>m.name);
      diagnostics.highlightRoleCounts=muscles.reduce((c,m)=>(c[m.userData.highlightRole]++,c),{primary:0,support:0,none:0});
      updateHighlightMaterials();return setPhase(0);
    },
    setBonesVisible(visible) { bonesGroup.visible = !!visible; },
    setHighlightEnabled(enabled) { highlightEnabled = !!enabled; updateHighlightMaterials(); },
    setSupportHighlightEnabled(enabled) { supportHighlightEnabled = !!enabled; updateHighlightMaterials(); },
    setWireframe(enabled) { for (const material of Object.values(materials)) material.wireframe = !!enabled; for (const layer of surfaceLayers) layer.setWireframe?.(enabled); },
    dispose() { for (const layer of surfaceLayers) layer.dispose?.(); allMeshes.forEach(mesh => mesh.geometry.dispose()); Object.values(materials).forEach(material => material.dispose()); skeleton.dispose(); dqTexture.dispose(); equipmentGroup.traverse(m=>{if(m.isMesh){m.geometry.dispose();m.material.dispose();}}); depthMaterial.dispose(); distanceMaterial.dispose(); },
  };
}
