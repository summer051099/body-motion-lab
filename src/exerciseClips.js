import * as THREE from 'three';
import { JOINT_LIMITS, quatFromTwoFrames, repetitionDepth, solveTwoBoneIK } from './rigConstraints.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const X = V(1, 0, 0), Y = V(0, 1, 0), Z = V(0, 0, 1);
const Q = () => new THREE.Quaternion();
const rotateX = angle => Q().setFromAxisAngle(X, angle);
const rad = THREE.MathUtils.degToRad;
const lerp = THREE.MathUtils.lerp;
const SIDES = ['left', 'right'];
const REST_ANKLE = V(0, .0066, .0744);
const BOTTOM_PITCH = rad(7);

// The clips author trajectories and constraints against a shared neutral bind.
// They neither create bones nor alter bind inverses / vertex weights. This is
// deterministic instructional animation, not a biomechanical force simulation.
export const EXERCISES = Object.freeze({
  pushup: Object.freeze({ id: 'pushup', name: '俯卧撑', label: '俯卧撑', durationSeconds: 3,
    summary: '固定掌部与足趾，下降一次，再推起一次。',
    primaryGroups: ['胸大肌', '三角肌前束', '肱三头肌'],
    supportGroups: ['前锯肌', '中下斜方肌', '背阔肌', '竖脊肌', '腹壁'] }),
  squat: Object.freeze({ id: 'squat', name: '深蹲', label: '深蹲', durationSeconds: 3,
    summary: '双足固定，屈髋屈膝下蹲，再站回原位。',
    primaryGroups: ['股四头肌', '臀大肌'],
    supportGroups: ['大收肌', '腘绳肌', '小腿肌群', '竖脊肌', '腹壁', '臀中肌'] }),
  curl: Object.freeze({ id: 'curl', name: '哑铃弯举', label: '哑铃弯举', durationSeconds: 3,
    summary: '上臂靠近躯干，双手保持抓握，完成一次弯举。',
    primaryGroups: ['肱二头肌', '肱肌'],
    supportGroups: ['肱桡肌', '前臂握持肌群', '腹壁'] }),
});

function standingTranslation(context) {
  const value = context.standingOffset;
  return value?.isVector3 ? value.clone() : Array.isArray(value) ? V(...value) : V(0, typeof value === 'number' ? value : .086, 0);
}
function restAt(context, index, fallback) { return Number.isInteger(index) ? context.joints[index].rest : fallback; }
function targetSetter(targets) {
  return (index, position, quaternion) => {
    if (Number.isInteger(index) && targets[index]) {
      targets[index].position.copy(position); targets[index].quaternion.copy(quaternion).normalize();
    }
  };
}
function transformed(point, pivot, position, quaternion) { return point.clone().sub(pivot).applyQuaternion(quaternion).add(position); }
function lengthsForLeg(r) { return { upper: r.hip.distanceTo(r.knee), lower: r.knee.distanceTo(r.ankle) }; }
function solvedRecord(start, solved, lengths, kind = 'arm') {
  return { ...(kind === 'arm' ? { shoulder: start, elbow: solved.joint, wrist: solved.end } : { hip: start, knee: solved.joint, ankle: solved.end }),
    lengths, flexion: solved.flexion, elbowFlexion: solved.flexion, kneeFlexion: solved.flexion,
    reachable: solved.reachable, residual: solved.residual, requestedEnd: solved.requestedEnd,
    rawDistance: solved.rawDistance };
}

function armTargets(context, targets, side, shoulder, solved, handQ, bodyQ, depth) {
  const c = context.chains[side], r = context.rest[side], sign = side === 'left' ? 1 : -1;
  const set = targetSetter(targets), elbow = solved.joint, wrist = solved.end;
  const upperDir = elbow.clone().sub(shoulder), lowerDir = wrist.clone().sub(elbow);
  const restUpper = r.elbow.clone().sub(r.shoulder), restLower = r.wrist.clone().sub(r.elbow);
  const normal = upperDir.clone().cross(lowerDir);
  if (normal.lengthSq() < 1e-10) normal.set(sign, 0, 0);
  normal.normalize();
  if (normal.dot(V(sign, 0, 0)) < 0) normal.negate();
  const restSecondary = V(sign, 0, 0);
  const upperQ = quatFromTwoFrames(restUpper, upperDir, restSecondary, normal);
  const forearmQ = quatFromTwoFrames(restLower, lowerDir, restSecondary, normal);
  const distalQ = quatFromTwoFrames(restLower, lowerDir, restSecondary, restSecondary.clone().applyQuaternion(handQ));
  const scapulaQ = bodyQ.clone().multiply(Q().setFromAxisAngle(Y, sign * (.035 + .025 * (1 - depth))));
  set(c.scapula, shoulder, scapulaQ);
  // Clavicle has its own pivot and orientation; no shared scapular bone.
  if (Number.isInteger(c.clavicle)) {
    const pivot = context.joints[c.clavicle].rest;
    set(c.clavicle, pivot.clone().sub(r.shoulder).applyQuaternion(bodyQ).add(shoulder),
      bodyQ.clone().multiply(Q().setFromAxisAngle(Z, sign * .025 * depth)));
  }
  set(c.upper, shoulder, upperQ); set(c.upperTwist, shoulder, upperQ);
  set(c.forearm, elbow, forearmQ);
  set(c.twist1, elbow, forearmQ.clone().slerp(distalQ, 1 / 3));
  set(c.twist2, elbow, forearmQ.clone().slerp(distalQ, 2 / 3));
  set(c.twist3, elbow, distalQ); set(c.hand, wrist, handQ);
  return { upperQ, forearmQ, distalQ, handQ, wrist };
}

function legTargets(context, targets, side, hip, solved) {
  const c = context.chains[side], r = context.rest[side], set = targetSetter(targets);
  // A sagittal pole with a small outward component preserves bilateral knees.
  const secondary = X;
  const thighQ = quatFromTwoFrames(r.knee.clone().sub(r.hip), solved.joint.clone().sub(hip), secondary, secondary);
  const shinQ = quatFromTwoFrames(r.ankle.clone().sub(r.knee), solved.end.clone().sub(solved.joint), secondary, secondary);
  set(c.thigh, hip, thighQ); set(c.thighTwist, hip, thighQ);
  set(c.shin, solved.joint, shinQ); set(c.shinTwist, solved.joint, shinQ);
}

function fingerSegments(context, side, finger) {
  const indices = context.chains[side].fingers?.[finger] || [];
  return indices.map((index, order) => {
    const supplied = context.fingerData?.[side]?.[finger]?.[order];
    const point = context.joints[index].rest;
    const nextIndex = indices[order + 1];
    const nextPoint = supplied?.nextPoint || (Number.isInteger(nextIndex) ? context.joints[nextIndex].rest : point.clone().add(V(0, -.016, 0)));
    return { index, restPoint: point, nextPoint, order, kind: supplied?.kind };
  });
}

// Cylinder grips are fitted once from the actual rest-space phalange pivots.
// The cached angles then drive ordinary joint FK on every animation frame.
const gripCache = new WeakMap();
function gripDefinition(context, side) {
  let cache = gripCache.get(context.joints);
  if (!cache) { cache = {}; gripCache.set(context.joints, cache); }
  if (cache[side]) return cache[side];
  const sign = side === 'left' ? 1 : -1;
  const names = ['index', 'middle', 'ring', 'little'];
  const mcps = names.map(name => {
    const segments = fingerSegments(context, side, name);
    return segments[Math.min(1, segments.length - 1)]?.restPoint;
  }).filter(Boolean);
  const center = mcps.length ? mcps.reduce((sum, p) => sum.add(p), V()).multiplyScalar(1 / mcps.length).add(V(0, .010, .017))
    : context.rest[side].wrist.clone().add(V(0, -.07, .025));
  const axis = V(1, -sign * .25, -sign * .11).normalize();
  const up = Y.clone().addScaledVector(axis, -axis.y).normalize();
  const forward = axis.clone().cross(up).normalize();
  if (forward.z < 0) forward.negate();
  const radial = point => {
    const vector = point.clone().sub(center);
    return vector.addScaledVector(axis, -vector.dot(axis));
  };
  function localRotation(finger, order, angles) {
    if (finger === 'thumb') return order === 0
      ? Q().setFromAxisAngle(Z, -sign * rad(angles[0])).multiply(Q().setFromAxisAngle(Y, sign * rad(angles[1]))).multiply(rotateX(-rad(angles[2])))
      : rotateX(-rad(angles[order + 2]));
    return order === 0 ? Q() : rotateX(-rad(angles[order - 1]));
  }
  function fk(finger, angles) {
    const segments = fingerSegments(context, side, finger);
    if (!segments.length) return [];
    let parentPosition = segments[0].restPoint.clone(), parentRest = segments[0].restPoint, parentQ = Q();
    const points = [];
    for (const [order, segment] of segments.entries()) {
      const position = transformed(segment.restPoint, parentRest, parentPosition, parentQ);
      parentQ.multiply(localRotation(finger, order, angles));
      points.push(position); parentPosition = position; parentRest = segment.restPoint;
    }
    points.push(transformed(segments.at(-1).nextPoint, parentRest, parentPosition, parentQ));
    return points;
  }
  function fit(finger) {
    const thumb = finger === 'thumb';
    let best = thumb ? [48, -23, 0, 38, 42] : [77, 65, 40];
    const limits = thumb ? [[0, 85], [-60, 60], [-50, 60], [0, 75], [0, 80]] : [[35, 95], [30, 110], [0, 80]];
    const desired = [up.clone().multiplyScalar(-.012).addScaledVector(forward, .017),
      up.clone().multiplyScalar(.014).addScaledVector(forward, .014), up.clone().multiplyScalar(.018).addScaledVector(forward, -.006)];
    const thumbTarget = center.clone().addScaledVector(axis, sign * .035).addScaledVector(up, .006).addScaledVector(forward, -.016);
    function cost(angles) {
      const points = fk(finger, angles);
      if (!points.length) return 0;
      if (thumb) return points.at(-1).distanceToSquared(thumbTarget) * 3 + radial(points[2]).lengthSq() * .1;
      let value = 0;
      for (let i = 0; i < 3; i++) value += radial(points[i + 2]).distanceToSquared(desired[i]);
      // Bone centerlines stay outside the 12 mm handle plus a 5 mm pad allowance.
      for (let i = 1; i < points.length - 1; i++) for (let k = 0; k <= 8; k++) {
        const distance = radial(points[i].clone().lerp(points[i + 1], k / 8)).length();
        value += Math.max(0, .017 - distance) ** 2 * 6;
      }
      return value;
    }
    let bestCost = cost(best);
    for (const step of [30, 15, 7, 3, 1]) for (let iteration = 0; iteration < 20; iteration++) {
      let improved = false;
      for (let component = 0; component < best.length; component++) for (const direction of [-1, 1]) {
        const candidate = best.slice();
        candidate[component] = THREE.MathUtils.clamp(candidate[component] + direction * step, ...limits[component]);
        const candidateCost = cost(candidate);
        if (candidateCost < bestCost) { best = candidate; bestCost = candidateCost; improved = true; }
      }
      if (!improved) break;
    }
    return { angles: best, radialTipDistance: radial(fk(finger, best).at(-1)).length(), fitError: bestCost };
  }
  const fingers = Object.fromEntries(['thumb', ...names].map(name => [name, fit(name)]));
  return cache[side] = { center, axis, localRotation, fingers, radius: .012 };
}

// A relaxed closed fist has no cylinder socket. Fit it independently of the
// dumbbell grasp: each digit bends in its own MCP/PIP plane, with the thumb
// resting on the palmar OUTSIDE of the folded fingers. This definition is
// cached per shared bind and changes no wrist, forearm or other clip target.
const fistCache = new WeakMap();
function fistDefinition(context, side) {
  let cache = fistCache.get(context.joints);
  if (!cache) { cache = {}; fistCache.set(context.joints, cache); }
  if (cache[side]) return cache[side];
  const sign = side === 'left' ? 1 : -1;
  const names = ['index', 'middle', 'ring', 'little'];
  const axes = Object.fromEntries(names.map(finger => {
    const segments = fingerSegments(context, side, finger);
    const proximal = segments[2].restPoint.clone().sub(segments[1].restPoint);
    return [finger, Z.clone().cross(proximal).normalize()];
  }));
  function localRotation(finger, order, angles) {
    if (finger === 'thumb') return order === 0
      ? Q().setFromAxisAngle(Z, -sign * rad(angles[0])).multiply(Q().setFromAxisAngle(Y, sign * rad(angles[1]))).multiply(rotateX(-rad(angles[2])))
      : rotateX(-rad(angles[order + 2]));
    return order === 0 ? Q() : Q().setFromAxisAngle(axes[finger], -rad(angles[order - 1]));
  }
  function fk(finger, angles) {
    const segments = fingerSegments(context, side, finger);
    let parentPosition = segments[0].restPoint.clone(), parentRest = parentPosition, parentQ = Q();
    const points = [];
    for (const [order, segment] of segments.entries()) {
      const position = transformed(segment.restPoint, parentRest, parentPosition, parentQ);
      parentQ.multiply(localRotation(finger, order, angles));
      points.push(position); parentPosition = position; parentRest = segment.restPoint;
    }
    points.push(transformed(segments.at(-1).nextPoint, parentRest, parentPosition, parentQ));
    return points;
  }
  const fingers = Object.fromEntries(names.map(name => [name, { angles: [88, 85, 25] }]));
  const folded = Object.fromEntries(names.map(name => [name, fk(name, fingers[name].angles)]));
  const thumbTarget = folded.index[2].clone().lerp(folded.middle[2], .4).add(V(0, .008, .022));
  function segmentDistance(point, a, b) {
    const ab = b.clone().sub(a), t = THREE.MathUtils.clamp(point.clone().sub(a).dot(ab) / Math.max(ab.lengthSq(), 1e-12), 0, 1);
    return point.distanceTo(a.clone().addScaledVector(ab, t));
  }
  function thumbCost(angles) {
    const points = fk('thumb', angles);
    let cost = points.at(-1).distanceToSquared(thumbTarget) * 4
      + 1e-8 * ((angles[3] - 40) ** 2 + (angles[4] - 30) ** 2);
    for (const point of points.slice(2)) for (const finger of names) for (let i = 1; i < 4; i++) {
      cost += Math.max(0, .013 - segmentDistance(point, folded[finger][i], folded[finger][i + 1])) ** 2 * 15;
    }
    for (let i = 1; i < 3; i++) for (let k = 0; k <= 5; k++) {
      const point = points[i].clone().lerp(points[i + 1], k / 5);
      for (const finger of ['index', 'middle']) for (let j = 1; j < 4; j++) {
        cost += Math.max(0, .012 - segmentDistance(point, folded[finger][j], folded[finger][j + 1])) ** 2 * 15;
      }
    }
    return cost;
  }
  let angles = [22, -30, -35, 55, 30], bestCost = thumbCost(angles);
  const limits = [[0, 85], [-65, 65], [-50, 70], [0, 70], [0, 75]];
  for (const step of [30, 15, 7, 3, 1, .25]) for (let iteration = 0; iteration < 30; iteration++) {
    let improved = false;
    for (let component = 0; component < angles.length; component++) for (const direction of [-1, 1]) {
      const candidate = angles.slice();
      candidate[component] = THREE.MathUtils.clamp(candidate[component] + direction * step, ...limits[component]);
      const cost = thumbCost(candidate);
      if (cost < bestCost) { angles = candidate; bestCost = cost; improved = true; }
    }
    if (!improved) break;
  }
  fingers.thumb = { angles, fitError: bestCost };
  return cache[side] = { localRotation, fingers };
}

// All finger transforms are derived from the same bind pivots used for open
// palm support. Metacarpals remain part of the shared skeleton in both poses.
function poseFingers(context, targets, side, hand, mode = 'open') {
  const set = targetSetter(targets), r = context.rest[side];
  const grip = mode === 'grip' ? gripDefinition(context, side) : null;
  const fist = mode === 'fist' ? fistDefinition(context, side) : null;
  const data = {};
  for (const finger of ['thumb', 'index', 'middle', 'ring', 'little']) {
    const segments = fingerSegments(context, side, finger);
    let parentPosition = hand.wrist.clone(), parentRest = r.wrist, parentQ = hand.handQ.clone();
    const joints = [];
    for (let order = 0; order < segments.length; order++) {
      const segment = segments[order];
      const position = transformed(segment.restPoint, parentRest, parentPosition, parentQ);
      let localQ = Q();
      if (grip) localQ = grip.localRotation(finger, order, grip.fingers[finger].angles);
      else if (fist) localQ = fist.localRotation(finger, order, fist.fingers[finger].angles);
      else if (mode === 'relaxed') {
        const angle = finger === 'thumb' ? (order === 0 ? 6 : 10) : (order === 0 && segments.length === 4 ? 0 : 10);
        localQ = rotateX(-rad(angle));
      }
      const quaternion = parentQ.clone().multiply(localQ);
      set(segment.index, position, quaternion);
      joints.push({ position: position.clone(), quaternion: quaternion.clone(), index: segment.index });
      parentPosition = position; parentRest = segment.restPoint; parentQ = quaternion;
    }
    const last = segments.at(-1);
    data[finger] = { joints, tip: last ? transformed(last.nextPoint, parentRest, parentPosition, parentQ) : hand.wrist.clone(),
      ...(grip ? { flexionDegrees: grip.fingers[finger].angles.slice(), radialTipDistance: grip.fingers[finger].radialTipDistance } : {}),
      ...(fist ? { mode: 'fist', flexionDegrees: fist.fingers[finger].angles.slice() } : {}) };
  }
  return data;
}

function appendDumbbell(context, side, hand, fingers) {
  const grip = gripDefinition(context, side);
  const position = transformed(grip.center, context.rest[side].wrist, hand.wrist, hand.handQ);
  const axis = grip.axis.clone().applyQuaternion(hand.handQ).normalize();
  const barQ = Q().setFromUnitVectors(X, grip.axis);
  return { id: `${side}-dumbbell`, type: 'dumbbell', side, position, quaternion: hand.handQ.clone().multiply(barQ), axis,
    radius: grip.radius, gripLength: .125, plateRadius: .065, plateThickness: .045,
    socket: { joint: context.chains[side].hand, restCenter: grip.center.clone(), localOffset: grip.center.clone().sub(context.rest[side].wrist),
      localQuaternion: barQ },
    fingerTips: Object.fromEntries(Object.entries(fingers).map(([name, data]) => [name, data.tip.clone()])) };
}

function constraintsSummary(pose) {
  const jointLimitViolations = [];
  const check = (joint, side, value) => {
    if (!Number.isFinite(value)) return;
    const limits = JOINT_LIMITS[joint];
    if (value < limits.min - 1e-6 || value > limits.max + 1e-6) jointLimitViolations.push({ joint, side, value, limits });
  };
  for (const [side, arm] of Object.entries(pose.arms)) { check('elbow', side, arm.flexion); check('wrist', side, arm.wristFlexion); }
  for (const [side, leg] of Object.entries(pose.legs)) {
    if (pose.exercise !== 'pushup') check('knee', side, leg.flexion);
    check('hip', side, leg.hipFlexion); check('ankle', side, leg.ankleFlexion);
  }
  const segments = [...Object.values(pose.arms), ...Object.values(pose.legs)];
  const maxSegmentLengthError = Math.max(0, ...segments.flatMap(segment => {
    const start = segment.shoulder || segment.hip, middle = segment.elbow || segment.knee, end = segment.wrist || segment.ankle;
    return start && middle && end ? [Math.abs(start.distanceTo(middle) - segment.lengths.upper), Math.abs(middle.distanceTo(end) - segment.lengths.lower)] : [0];
  }));
  return { clampedEndpoints: segments.filter(s => !s.reachable).length,
    maxEndpointResidual: Math.max(0, ...segments.map(s => s.residual || 0)),
    noSegmentStretch: maxSegmentLengthError < 1e-7, maxSegmentLengthError, jointLimitViolations, jointLimits: JOINT_LIMITS,
    authoredMotion: true, forceSimulation: false };
}

function samplePushup(phaseInfo, context) {
  const { phase, depth } = phaseInfo;
  const ankleWorld = context.ankleWorld?.clone() || V(0, .139, -.81);
  const pitch = lerp(context.topPitch ?? .35, BOTTOM_PITCH, depth), bodyQ = rotateX(Math.PI / 2 - pitch);
  const bodyPoint = point => point.clone().sub(REST_ANKLE).applyQuaternion(bodyQ).add(ankleWorld);
  const targets = context.joints.map(j => ({ position: bodyPoint(j.rest), quaternion: bodyQ.clone() }));
  const set = targetSetter(targets);
  const handQ = Q().setFromAxisAngle(Y, Math.PI).multiply(rotateX(Math.PI / 2));
  const footQ = rotateX(Math.PI / 3), toeQ = rotateX(rad(-4));
  const pose = { phase, depth, exercise: 'pushup', bodyPitch: pitch, arms: {}, legs: {}, fingers: {}, landmarks: {
    head: bodyPoint(V(0, 1.54, .075)), shoulderCenter: bodyPoint(V(0, 1.315, .075)),
    hipCenter: bodyPoint(V(0, .811, .079)), kneeCenter: bodyPoint(V(0, .367, .0826)), ankleCenter: ankleWorld.clone() } };
  for (const side of SIDES) {
    const r = context.rest[side], c = context.chains[side], sign = side === 'left' ? 1 : -1;
    const shoulder = bodyPoint(r.shoulder);
    const wrist = context.handTargets?.[side]?.clone() || V(sign * .270, .1, .280);
    const solved = solveTwoBoneIK(shoulder, wrist, c.lengths, V(sign * .7071, .12, -.7071));
    const hand = armTargets(context, targets, side, shoulder, solved, handQ, bodyQ, depth);
    pose.arms[side] = { ...solvedRecord(shoulder, solved, c.lengths), wristFlexion: hand.distalQ.angleTo(handQ) };
    pose.fingers[side] = poseFingers(context, targets, side, hand, 'open');
    const ankle = ankleWorld.clone(); ankle.x = r.ankle.x;
    const toe = context.toeTargets?.[side]?.clone() || r.mtp.clone().sub(r.ankle).applyQuaternion(footQ).add(ankle);
    set(c.foot, ankle, footQ); set(c.toe, toe, toeQ);
    pose.legs[side] = { hip: bodyPoint(r.hip), knee: bodyPoint(r.knee), ankle, lengths: lengthsForLeg(r), flexion: 0, kneeFlexion: 0, reachable: true, residual: 0 };
  }
  pose.constraints = constraintsSummary(pose);
  return { targets, pose, equipment: [], contacts: { mode: 'hands-and-toes',
    hands: Object.fromEntries(SIDES.map(s => [s, targets[context.chains[s].hand].position.clone()])),
    toes: Object.fromEntries(SIDES.map(s => [s, targets[context.chains[s].toe].position.clone()])), feet: {}, fixed: true } };
}

function axialTargets(context, targets, pelvisPosition, angles) {
  const spine = context.spine || {}, set = targetSetter(targets);
  const order = ['pelvis', 'lumbar', 'lumbarUpper', 'thorax', 'chest', 'neck', 'neckUpper', 'head'];
  let previousRest = restAt(context, spine.pelvis, V(0, .811, .079));
  let previousPosition = pelvisPosition.clone(), previousQ = rotateX(angles.pelvis || 0);
  for (const name of order) {
    const index = spine[name]; if (!Number.isInteger(index)) continue;
    const rest = context.joints[index].rest;
    const position = name === 'pelvis' ? pelvisPosition.clone() : transformed(rest, previousRest, previousPosition, previousQ);
    const quaternion = rotateX(angles[name] ?? angles.chest ?? 0);
    set(index, position, quaternion); previousRest = rest; previousPosition = position; previousQ = quaternion;
  }
}
function torsoFrame(context, targets) {
  const index = context.spine?.chest ?? context.spine?.thorax ?? 0;
  return { rest: context.joints[index].rest, position: targets[index].position, quaternion: targets[index].quaternion };
}

function sampleStanding(phaseInfo, context, id) {
  const { phase, depth } = phaseInfo, offset = standingTranslation(context), isSquat = id === 'squat';
  const targets = context.joints.map(j => ({ position: j.rest.clone().add(offset), quaternion: Q() }));
  const set = targetSetter(targets), pelvisIndex = context.spine?.pelvis;
  const pelvisRest = restAt(context, pelvisIndex, V(0, .811, .079));
  const pelvisPosition = pelvisRest.clone().add(offset).add(V(0, (isSquat ? -.008 - .490 * depth : -.003), isSquat ? -.270 * depth * (1 + .85 * (1 - depth)) : 0));
  const pitch = isSquat ? rad(31) * depth : 0;
  axialTargets(context, targets, pelvisPosition, { pelvis: pitch * .95, lumbar: pitch, lumbarUpper: pitch,
    thorax: pitch, chest: pitch, neck: pitch * .75, neckUpper: pitch * .55, head: pitch * .45 });
  const torso = torsoFrame(context, targets), pelvisQ = Number.isInteger(pelvisIndex) ? targets[pelvisIndex].quaternion : Q();
  const bodyPoint = point => transformed(point, torso.rest, torso.position, torso.quaternion);
  const pose = { phase, depth, exercise: id, bodyPitch: pitch, arms: {}, legs: {}, fingers: {}, landmarks: {
    head: bodyPoint(V(0, 1.54, .075)), shoulderCenter: bodyPoint(V(0, 1.315, .075)), hipCenter: pelvisPosition.clone(),
    kneeCenter: V(), ankleCenter: V() } };
  const equipment = [], contacts = { mode: 'feet', feet: {}, toes: {}, hands: {}, fixed: true };
  for (const side of SIDES) {
    const r = context.rest[side], c = context.chains[side], sign = side === 'left' ? 1 : -1;
    const footOffset = offset.clone(); footOffset.x += sign * (isSquat ? .082 : .027);
    const ankle = r.ankle.clone().add(footOffset), toe = r.mtp.clone().add(footOffset);
    const hip = transformed(r.hip, pelvisRest, pelvisPosition, pelvisQ), legLengths = lengthsForLeg(r);
    const leg = solveTwoBoneIK(hip, ankle, legLengths, V(sign * .16, .03, 1), JOINT_LIMITS.knee);
    legTargets(context, targets, side, hip, leg);
    // Planned root paths are reachable. A future clip can inspect residuals if
    // it asks for an unreachable planted foot rather than silently stretching.
    set(c.foot, leg.end, Q()); set(c.toe, toe.clone().add(leg.end.clone().sub(ankle)), Q());
    const localThigh = leg.joint.clone().sub(hip).applyQuaternion(pelvisQ.clone().invert());
    const hipFlexion = Math.atan2(localThigh.z, -localThigh.y);
    const ankleFlexion = Math.atan2(leg.joint.z - leg.end.z, leg.joint.y - leg.end.y)
      - Math.atan2(r.knee.z - r.ankle.z, r.knee.y - r.ankle.y);
    pose.legs[side] = { ...solvedRecord(hip, leg, legLengths, 'leg'), hipFlexion, ankleFlexion };
    contacts.feet[side] = leg.end.clone(); contacts.toes[side] = targets[c.toe].position.clone();
    pose.landmarks.kneeCenter.add(leg.joint.clone().multiplyScalar(.5)); pose.landmarks.ankleCenter.add(leg.end.clone().multiplyScalar(.5));
    const shoulder = bodyPoint(r.shoulder);
    let arm, handQ;
    if (isSquat) {
      const restWrist = bodyPoint(r.wrist);
      const balancedWrist = shoulder.clone().add(V(sign * .015, -.13, .470));
      const wrist = restWrist.lerp(balancedWrist, depth);
      arm = solveTwoBoneIK(shoulder, wrist, c.lengths, V(sign * .08, -1, -.1));
      const lower = arm.end.clone().sub(arm.joint);
      handQ = quatFromTwoFrames(r.wrist.clone().sub(r.elbow), lower, V(sign, 0, 0), V(sign, 0, 0));
      // The anatomical bind is supinated: lifting that frame forward without
      // pronation leaves both palms facing up. Rotate around the forearm's
      // longitudinal axis so the hanging hands face inward and the balancing
      // hands face down with a slight inward angle. armTargets distributes
      // this orientation over the existing three pronation helpers; the hand
      // and distal radius retain the same frame, keeping the wrist neutral.
      handQ.premultiply(Q().setFromAxisAngle(lower.clone().normalize(), sign * rad(70 + 75 * depth)));
    } else {
      const upper = r.elbow.clone().sub(r.shoulder);
      const elbow = shoulder.clone().add(upper);
      const flexion = rad(12 + 106 * depth);
      const lowerDir = upper.clone().normalize().applyQuaternion(rotateX(-flexion));
      const wrist = elbow.clone().addScaledVector(lowerDir, c.lengths.lower);
      const requested = solveTwoBoneIK(shoulder, wrist, c.lengths, elbow.clone().sub(shoulder).addScaledVector(wrist.clone().sub(shoulder).normalize(), -.1));
      // Explicit elbow path: upper arm stays still, flexion rotates around its
      // lateral hinge. Segment endpoints satisfy the same shared IK limits.
      const measuredFlex = Math.acos(THREE.MathUtils.clamp(upper.clone().normalize().dot(lowerDir), -1, 1));
      arm = { ...requested, joint: elbow, elbow, end: wrist, requestedEnd: wrist.clone(), residual: 0,
        reachable: true, clamped: false, flexion: measuredFlex, elbowFlexion: measuredFlex };
      handQ = quatFromTwoFrames(r.wrist.clone().sub(r.elbow), lowerDir, V(sign, 0, 0), V(sign, 0, 0));
    }
    const hand = armTargets(context, targets, side, shoulder, arm, handQ, torso.quaternion, depth);
    pose.arms[side] = { ...solvedRecord(shoulder, arm, c.lengths), wristFlexion: hand.distalQ.angleTo(handQ) };
    pose.fingers[side] = poseFingers(context, targets, side, hand, isSquat ? 'fist' : 'grip');
    if (!isSquat) equipment.push(appendDumbbell(context, side, hand, pose.fingers[side]));
  }
  pose.constraints = constraintsSummary(pose);
  return { targets, pose, equipment, contacts };
}

/** Sample a clip without touching the shared skeleton or static binding. */
export function sampleExercise(id, inputPhase, context) {
  if (!context?.joints?.length || !context.chains || !context.rest) throw new TypeError('Exercise sampling requires a standard rig context.');
  const key = id === 'dumbbell-curl' || id === 'dumbbellCurl' ? 'curl' : id;
  if (!EXERCISES[key]) throw new RangeError(`Unknown exercise: ${id}`);
  const phaseInfo = repetitionDepth(inputPhase);
  return key === 'pushup' ? samplePushup(phaseInfo, context) : sampleStanding(phaseInfo, context, key);
}
