import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { getPushupMuscleRole, getPushupSupportGroup } from './muscleRoles.js';

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
const IDENTITY = new THREE.Quaternion();
const REST_ANKLE = V(0, .0066, .0744);
const TOP_ELBOW_FLEXION = 8 * Math.PI / 180;
const ANGLE_BOTTOM = 7.0 * Math.PI / 180;
const REST = {
  left: { shoulder: V(.1647, 1.3150, .0758), elbow: V(.2240, 1.0390, .0730), wrist: V(.2580, .8050, .1120), ankle: V(.0713, .0066, .0744), mtp: V(.105, -.056, .185) },
  right: { shoulder: V(-.1647, 1.3150, .0758), elbow: V(-.2240, 1.0390, .0730), wrist: V(-.2580, .8050, .1120), ankle: V(-.0713, .0066, .0744), mtp: V(-.105, -.056, .185) },
};
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
  if (b.max.y < 1.42 && b.min.y > .59) {
    if (isBone && /humerus/.test(n)) return 'upperArmBone';
    if (isBone && /radius|ulna/.test(n)) return 'forearmBone';
    if (isBone && /finger|thumb|metacarpal|scaphoid|lunate|triquetr|pisiform|trapezium|trapezoid|capitate|hamate/.test(n)) return 'hand';
    if (!isBone && /biceps brachii|triceps brachii|brachialis|coracobrachialis|anconeus/.test(n)) return 'upperArm';
    if (!isBone && /pronator|supinator|brachioradialis|carpi|digitorum (profundus|superficialis)|extensor (pollicis|indicis|digiti|digitorum)|flexor pollicis longus|abductor pollicis longus|palmaris|interosseous membrane/.test(n)) return 'forearm';
    if (cy < .82 && (b.min.x > .17 || b.max.x < -.17)) return 'hand';
  }
  if (/deltoid|pectoralis major|subscapularis|supraspinatus|infraspinatus|teres major|teres minor/.test(n)) return 'shoulder';
  if (/scapula|clavicle/.test(n) && isBone) return 'scapula';
  if (/latissimus dorsi/.test(n)) return 'latissimus';
  return 'body';
}

function quatFromTwoFrames(restDirection, direction, restSecondary, secondary) {
  const rY = restDirection.clone().normalize();
  const rX = restSecondary.clone().addScaledVector(rY, -restSecondary.dot(rY)).normalize();
  const rZ = rX.clone().cross(rY).normalize();
  const tY = direction.clone().normalize();
  const tX = secondary.clone().addScaledVector(tY, -secondary.dot(tY)).normalize();
  const tZ = tX.clone().cross(tY).normalize();
  const r = new THREE.Matrix4().makeBasis(rX, rY, rZ);
  const t = new THREE.Matrix4().makeBasis(tX, tY, tZ);
  return new THREE.Quaternion().setFromRotationMatrix(t.multiply(r.transpose())).normalize();
}

function solveTwoBone(shoulder, wrist, lengths, side) {
  const axis = wrist.clone().sub(shoulder);
  const rawDistance = axis.length();
  const d = clamp(rawDistance, Math.abs(lengths.upper - lengths.lower) + .00001, lengths.upper + lengths.lower - .00001);
  axis.normalize();
  // The pole points backwards and outwards, producing the ~45-degree tucked
  // elbow path in the transverse plane rather than a lateral T-pose flare.
  const pole = V(side * .7071, .12, -.7071);
  pole.addScaledVector(axis, -pole.dot(axis)).normalize();
  const along = (lengths.upper ** 2 - lengths.lower ** 2 + d * d) / (2 * d);
  const height = Math.sqrt(Math.max(0, lengths.upper ** 2 - along * along));
  const elbow = shoulder.clone().addScaledVector(axis, along).addScaledVector(pole, height);
  const elbowFlexion = Math.acos(clamp((d * d - lengths.upper ** 2 - lengths.lower ** 2) / (2 * lengths.upper * lengths.lower), -1, 1));
  return { elbow, rawDistance, reachable: rawDistance <= lengths.upper + lengths.lower, elbowFlexion };
}

export async function createPushupRig({ onProgress = () => {}, materials: suppliedMaterials = {}, modelUrl = '/anatomy.glb', skeletonUrl = '/skeleton.glb' } = {}) {
  const group = new THREE.Group();
  group.name = 'BodyExplorer-pushup-anatomical-rig';
  const musclesGroup = new THREE.Group(), bonesGroup = new THREE.Group();
  musclesGroup.name = 'muscular-system'; bonesGroup.name = 'skeletal-system';
  group.add(musclesGroup, bonesGroup);
  const materials = { ...materialDefaults(), ...suppliedMaterials };
  const muscles = [], bones = [], allMeshes = [], contacts = { hands: [], toes: [] };
  const root = new THREE.Bone(); root.name = 'thorax-pelvis-straight-chain'; group.add(root);
  const joints = [{ bone: root, rest: V() }];
  const boneIndex = { body: 0 };
  const chains = {};
  function addJoint(name, point, parent) {
    const bone = new THREE.Bone(); bone.name = name;
    const idx = joints.length;
    bone.position.copy(point).sub(parent ? joints[parent].rest : V());
    (parent === undefined ? root : joints[parent].bone).add(bone);
    joints.push({ bone, rest: point.clone(), parent: parent === undefined ? 0 : parent });
    boneIndex[name] = idx;
    return idx;
  }
  for (const side of ['left', 'right']) {
    const r = REST[side];
    const scapula = addJoint(`${side}-scapulothoracic`, r.shoulder);
    const upper = addJoint(`${side}-humerus`, r.shoulder, scapula);
    const forearm = addJoint(`${side}-ulna-proximal-forearm`, r.elbow, upper);
    const twist1 = addJoint(`${side}-forearm-pronation-1`, r.elbow, forearm);
    const twist2 = addJoint(`${side}-forearm-pronation-2`, r.elbow, twist1);
    const twist3 = addJoint(`${side}-radius-distal-pronation`, r.elbow, twist2);
    const hand = addJoint(`${side}-carpus-palm`, r.wrist, twist3);
    const foot = addJoint(`${side}-tarsus`, r.ankle);
    const toe = addJoint(`${side}-metatarsophalangeal`, r.mtp, foot);
    chains[side] = { scapula, upper, forearm, twist1, twist2, twist3, hand, foot, toe,
      lengths: { upper: r.elbow.distanceTo(r.shoulder), lower: r.wrist.distanceTo(r.elbow) } };
  }
  group.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(joints.map(j => j.bone));
  // Rest inverse matrices are captured before the first push-up pose is applied.
  skeleton.calculateInverses();

  // Dual-quaternion blending retains cross-sectional volume through shoulder
  // elevation and distributed pronation. CPU sampling uses the identical blend
  // as the vertex shader, so contact/strain inspection measures rendered skin.
  const dqReal = joints.map(() => new THREE.Vector4(0, 0, 0, 1));
  const dqDual = joints.map(() => new THREE.Vector4());
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
    }
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
    vector.applyMatrix4(this.bindMatrix).applyQuaternion(q).add(V(d.x * 2, d.y * 2, d.z * 2));
    return vector.applyMatrix4(this.bindMatrixInverse);
  }
  const dqDeclarations = `
    #ifdef USE_SKINNING
      uniform vec4 rigDQReal[${joints.length}];
      uniform vec4 rigDQDual[${joints.length}];
      vec4 rigQuatMultiply(vec4 a, vec4 b) {
        return vec4(a.w*b.xyz + b.w*a.xyz + cross(a.xyz,b.xyz), a.w*b.w-dot(a.xyz,b.xyz));
      }
      vec3 rigQuatRotate(vec4 q, vec3 p) {
        return p + 2.0 * cross(q.xyz, cross(q.xyz,p) + q.w*p);
      }
    #endif
  `;
  const dqBase = `
    #ifdef USE_SKINNING
      ivec4 rigIds=ivec4(skinIndex);
      vec4 rigReference=rigDQReal[rigIds.x];
      vec4 rigSigns=vec4(dot(rigReference,rigDQReal[rigIds.x])<0.0?-1.0:1.0,
        dot(rigReference,rigDQReal[rigIds.y])<0.0?-1.0:1.0,
        dot(rigReference,rigDQReal[rigIds.z])<0.0?-1.0:1.0,
        dot(rigReference,rigDQReal[rigIds.w])<0.0?-1.0:1.0);
      vec4 rigWeights=skinWeight*rigSigns;
      vec4 rigReal=rigWeights.x*rigDQReal[rigIds.x]+rigWeights.y*rigDQReal[rigIds.y]+rigWeights.z*rigDQReal[rigIds.z]+rigWeights.w*rigDQReal[rigIds.w];
      vec4 rigDual=rigWeights.x*rigDQDual[rigIds.x]+rigWeights.y*rigDQDual[rigIds.y]+rigWeights.z*rigDQDual[rigIds.z]+rigWeights.w*rigDQDual[rigIds.w];
      float rigInverseLength=1.0/length(rigReal);
      rigReal*=rigInverseLength; rigDual*=rigInverseLength;
      rigDual-=rigReal*dot(rigReal,rigDual);
    #endif
  `;
  function configureDQMaterial(material) {
    const priorHook = material.onBeforeCompile;
    material.onBeforeCompile = (shader, renderer) => {
      priorHook?.call(material, shader, renderer);
      shader.uniforms.rigDQReal = { value: dqReal };
      shader.uniforms.rigDQDual = { value: dqDual };
      shader.vertexShader = shader.vertexShader
        .replace('#include <skinning_pars_vertex>', '#include <skinning_pars_vertex>\n' + dqDeclarations)
        .replace('#include <skinbase_vertex>', dqBase)
        .replace('#include <skinnormal_vertex>', `
          #ifdef USE_SKINNING
            objectNormal=rigQuatRotate(rigReal,objectNormal);
            #ifdef USE_TANGENT
              objectTangent=rigQuatRotate(rigReal,objectTangent);
            #endif
          #endif
        `)
        .replace('#include <skinning_vertex>', `
          #ifdef USE_SKINNING
            vec3 rigTranslation=2.0*rigQuatMultiply(rigDual,vec4(-rigReal.xyz,rigReal.w)).xyz;
            transformed=(bindMatrixInverse*vec4(rigQuatRotate(rigReal,(bindMatrix*vec4(transformed,1.0)).xyz)+rigTranslation,1.0)).xyz;
          #endif
        `);
    };
    material.customProgramCacheKey = () => 'anatomical-dual-quaternion-v1';
    material.needsUpdate = true;
  }
  Object.values(materials).forEach(configureDQMaterial);
  const depthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  const distanceMaterial = new THREE.MeshDistanceMaterial();
  configureDQMaterial(depthMaterial); configureDQMaterial(distanceMaterial);

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
    const highlightRole = getPushupMuscleRole(n, { isBone, isTendon: tendon });
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
    const elbowCorrection = new Float32Array(p.array.length), shoulderCorrection = new Float32Array(p.array.length);
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i), ax = Math.abs(x);
      let entries = [[0, 1]];
      if (region === 'upperArmBone') entries = [[c.upper, 1]];
      if (region === 'forearmBone') entries = [[/radius/.test(n) ? c.twist3 : c.forearm, 1]];
      if (region === 'hand') entries = [[c.hand, 1]];
      if (region === 'scapula') entries = [[c.scapula, 1]];
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
        entries = [[c.upper, humerus], [c.scapula, (1 - humerus) * scapular], [0, (1 - humerus) * (1 - scapular)]];
      }
      if (region === 'latissimus') {
        const insertion = smooth(.1, .165, ax) * smooth(1.16, 1.29, y);
        entries = [[0, 1 - insertion], [c.upper, insertion]];
      }
      if (region === 'lowerLeg' && isBone) {
        entries = /tibia|fibula|patella/.test(n) ? [[0, 1]] : /toe|sesamoid/.test(n) ? [[c.toe, 1]] : [[c.foot, 1]];
      }
      if (region === 'lowerLeg' && !isBone) {
        const foot = 1 - smooth(-.015, .08, y);
        const toe = (1 - smooth(-.028, .02, y)) * smooth(.159, .198, z);
        entries = [[0, 1 - foot], [c.foot, foot * (1 - toe)], [c.toe, foot * toe]];
      }
      entries = entries.filter(([, weight]) => weight > .000001);
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
    }
    geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndices, 4));
    geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeights, 4));
    geometry.morphTargetsRelative = true;
    geometry.morphAttributes.position = [new THREE.Float32BufferAttribute(elbowCorrection, 3), new THREE.Float32BufferAttribute(shoulderCorrection, 3)];
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
    mesh.morphTargetDictionary = { elbowVolume: 0, shoulderVolume: 1 };
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
  const pose = { phase: 0, depth: 0, bodyPitch: 0, arms: {}, landmarks: {} };
  const desiredWorld = Array.from({ length: joints.length }, () => new THREE.Matrix4());
  const worldQuaternions = Array.from({ length: joints.length }, () => new THREE.Quaternion());
  function targetJoint(index, position, quaternion) {
    desiredWorld[index].compose(position, quaternion, V(1, 1, 1));
    worldQuaternions[index].copy(quaternion);
  }
  function setPhase(inputPhase) {
    const phase = clamp(Number(inputPhase), 0, 1);
    // C2-smooth starts, reversal and end; exactly one descent and ascent.
    const depth = (1 - Math.cos(phase * Math.PI * 2)) * .5;
    const pitch = THREE.MathUtils.lerp(topPitch, ANGLE_BOTTOM, depth);
    const bodyQ = new THREE.Quaternion().setFromAxisAngle(AXIS_X, Math.PI / 2 - pitch);
    const bodyPoint = point => point.clone().sub(REST_ANKLE).applyQuaternion(bodyQ).add(ankleWorld);
    const bodyOrigin = bodyPoint(V());
    targetJoint(0, bodyOrigin, bodyQ);
    pose.phase = phase; pose.depth = depth; pose.bodyPitch = pitch;
    pose.landmarks = {
      head: bodyPoint(V(0, 1.54, .075)), shoulderCenter: bodyPoint(V(0, 1.315, .075)),
      hipCenter: bodyPoint(V(0, .811, .079)), kneeCenter: bodyPoint(V(0, .367, .0826)),
      ankleCenter: ankleWorld.clone(),
    };
    for (const side of ['left', 'right']) {
      const sign = side === 'left' ? 1 : -1, r = REST[side], c = chains[side];
      const shoulder = bodyPoint(r.shoulder);
      const wrist = handTargets[side].clone();
      const solved = solveTwoBone(shoulder, wrist, c.lengths, sign);
      const upperDir = solved.elbow.clone().sub(shoulder), lowerDir = wrist.clone().sub(solved.elbow);
      const restUpper = r.elbow.clone().sub(r.shoulder), restLower = r.wrist.clone().sub(r.elbow);
      // Full segment frames control axial twist in addition to the long axis.
      const planeNormal = upperDir.clone().cross(lowerDir).normalize();
      if (planeNormal.dot(V(sign, 0, 0)) < 0) planeNormal.negate();
      const restSecondary = V(sign, 0, 0);
      const upperQ = quatFromTwoFrames(restUpper, upperDir, restSecondary, planeNormal);
      const forearmQ = quatFromTwoFrames(restLower, lowerDir, restSecondary, planeNormal);
      const distalSecondary = restSecondary.clone().applyQuaternion(handQ);
      const distalForearmQ = quatFromTwoFrames(restLower, lowerDir, restSecondary, distalSecondary);
      const twistQ1 = forearmQ.clone().slerp(distalForearmQ, 1 / 3);
      const twistQ2 = forearmQ.clone().slerp(distalForearmQ, 2 / 3);
      const scapulaQ = bodyQ.clone().multiply(new THREE.Quaternion().setFromAxisAngle(AXIS_Y, sign * (.035 + .025 * (1 - depth))));
      targetJoint(c.scapula, shoulder, scapulaQ);
      targetJoint(c.upper, shoulder, upperQ);
      targetJoint(c.forearm, solved.elbow, forearmQ);
      targetJoint(c.twist1, solved.elbow, twistQ1);
      targetJoint(c.twist2, solved.elbow, twistQ2);
      targetJoint(c.twist3, solved.elbow, distalForearmQ);
      targetJoint(c.hand, wrist, handQ);
      const a = ankleWorld.clone(); a.x = r.ankle.x;
      targetJoint(c.foot, a, footQ);
      targetJoint(c.toe, toeTargets[side], toeQ);
      pose.arms[side] = { shoulder, elbow: solved.elbow, wrist, lengths: c.lengths, elbowFlexion: solved.elbowFlexion, reachable: solved.reachable, rawDistance: solved.rawDistance };
    }
    for (let i = 0; i < joints.length; i++) {
      const j = joints[i], local = desiredWorld[i].clone();
      if (i > 0) local.premultiply(desiredWorld[j.parent].clone().invert());
      local.decompose(j.bone.position, j.bone.quaternion, j.bone.scale);
    }
    for (const mesh of allMeshes) {
      const flex = pose.arms[mesh.userData.side]?.elbowFlexion || 0;
      mesh.morphTargetInfluences[0] = Math.sin(flex * .5) ** 2;
      mesh.morphTargetInfluences[1] = .75 + .25 * depth;
    }
    group.updateMatrixWorld(true); skeleton.update(); updateDualQuaternions();
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
  function getPoseDiagnostics(includeGeometry = true) {
    const landmarks = Object.fromEntries(Object.entries(pose.landmarks).map(([key, value]) => [key, value.toArray()]));
    const arms = Object.fromEntries(Object.entries(pose.arms).map(([side, a]) => [side, {
      shoulder: a.shoulder.toArray(), elbow: a.elbow.toArray(), wrist: a.wrist.toArray(),
      upperLength: a.shoulder.distanceTo(a.elbow), forearmLength: a.elbow.distanceTo(a.wrist),
      restUpperLength: a.lengths.upper, restForearmLength: a.lengths.lower,
      elbowFlexionDeg: THREE.MathUtils.radToDeg(a.elbowFlexion), reachable: a.reachable,
    }]));
    return { phase: pose.phase, depth: pose.depth, bodyPitchDeg: THREE.MathUtils.radToDeg(pose.bodyPitch), landmarks, arms,
      handAnchors: Object.fromEntries(Object.entries(handTargets).map(([s, v]) => [s, v.toArray()])),
      toeAnchors: Object.fromEntries(Object.entries(toeTargets).map(([s, v]) => [s, v.toArray()])),
      ...(includeGeometry ? { handGeometry: contactStats(contacts.hands), toeGeometry: contactStats(contacts.toes) } : {}) };
  }
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
    supportMuscleGroups: muscles.filter(m => m.userData.highlightRole === 'support').reduce((groups, mesh) => {
      const key = getPushupSupportGroup(mesh.name);
      (groups[key] ||= []).push(mesh.name);
      return groups;
    }, {}),
    highlightRoleCounts: muscles.reduce((counts, mesh) => {
      counts[mesh.userData.highlightRole]++;
      return counts;
    }, { primary: 0, support: 0, none: 0 }),
    method: 'Semantic/spatial four-weight dual-quaternion skeletal binding, analytic planted-contact arm IK, distributed forearm pronation with rigid radius/ulna, shoulder/elbow volume corrective morphs, MTP toe extension, digit extension corrective.',
  };
  setPhase(0);
  onProgress('全身绑定完成');
  let highlightEnabled = true, supportHighlightEnabled = true;
  function updateHighlightMaterials() {
    for (const mesh of muscles) {
      const role = mesh.userData.highlightRole;
      mesh.material = highlightEnabled && role === 'primary' ? materials.red
        : highlightEnabled && supportHighlightEnabled && role === 'support' ? materials.support
        : mesh.userData.originalMaterial;
    }
  }
  return {
    group, muscles, bones, musclesGroup, bonesGroup, skeleton, joints, materials, diagnostics,
    setPhase, getPoseDiagnostics, inspectGeometry,
    setBonesVisible(visible) { bonesGroup.visible = !!visible; },
    setHighlightEnabled(enabled) { highlightEnabled = !!enabled; updateHighlightMaterials(); },
    setSupportHighlightEnabled(enabled) { supportHighlightEnabled = !!enabled; updateHighlightMaterials(); },
    setWireframe(enabled) { for (const material of Object.values(materials)) material.wireframe = !!enabled; },
    dispose() { allMeshes.forEach(mesh => mesh.geometry.dispose()); Object.values(materials).forEach(material => material.dispose()); skeleton.dispose(); depthMaterial.dispose(); distanceMaterial.dispose(); },
  };
}
