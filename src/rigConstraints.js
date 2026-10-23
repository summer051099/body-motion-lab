import * as THREE from 'three';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const clamp = THREE.MathUtils.clamp;
const rad = THREE.MathUtils.degToRad;

// Authored limits for this exercise library. They are animation safety limits,
// not patient-specific clinical ranges or a substitute for motion review.
export const JOINT_LIMITS = Object.freeze({
  elbow: Object.freeze({ min: rad(4), max: rad(145) }),
  knee: Object.freeze({ min: rad(3), max: rad(145) }),
  hip: Object.freeze({ min: rad(-30), max: rad(125) }),
  wrist: Object.freeze({ min: rad(-80), max: rad(95) }),
  ankle: Object.freeze({ min: rad(-45), max: rad(30) }),
  fingerMcp: Object.freeze({ min: 0, max: rad(95) }),
  fingerPip: Object.freeze({ min: 0, max: rad(110) }),
  fingerDip: Object.freeze({ min: 0, max: rad(80) }),
});

/** Analytic two-segment IK, with endpoint clamping instead of bone stretching.
 * flexion is zero at a straight joint; pole is a world-space direction.
 */
export function solveTwoBoneIK(start, requestedEnd, lengths, pole, limits = JOINT_LIMITS.elbow) {
  const upper = lengths.upper, lower = lengths.lower;
  if (!(upper > 0 && lower > 0)) throw new RangeError('Two-bone IK needs positive segment lengths.');
  const axis = requestedEnd.clone().sub(start);
  const requestedDistance = axis.length();
  if (requestedDistance < 1e-10) axis.set(0, -1, 0); else axis.multiplyScalar(1 / requestedDistance);
  const distanceAt = flexion => Math.sqrt(Math.max(0, upper ** 2 + lower ** 2 + 2 * upper * lower * Math.cos(flexion)));
  const minimum = Math.max(Math.abs(upper - lower) + 1e-8, distanceAt(limits.max));
  const maximum = Math.min(upper + lower - 1e-8, distanceAt(limits.min));
  const distance = clamp(requestedDistance, minimum, maximum);
  const end = start.clone().addScaledVector(axis, distance);
  const bend = pole.clone().addScaledVector(axis, -pole.dot(axis));
  if (bend.lengthSq() < 1e-12) {
    const fallback = Math.abs(axis.y) < .9 ? V(0, 1, 0) : V(0, 0, 1);
    bend.copy(fallback).addScaledVector(axis, -fallback.dot(axis));
  }
  bend.normalize();
  const along = (upper ** 2 - lower ** 2 + distance ** 2) / (2 * distance);
  const height = Math.sqrt(Math.max(0, upper ** 2 - along ** 2));
  const joint = start.clone().addScaledVector(axis, along).addScaledVector(bend, height);
  const flexion = Math.acos(clamp((distance ** 2 - upper ** 2 - lower ** 2) / (2 * upper * lower), -1, 1));
  return { joint, elbow: joint, knee: joint, end, requestedEnd: requestedEnd.clone(),
    requestedDistance, rawDistance: requestedDistance, distance, flexion, elbowFlexion: flexion,
    residual: end.distanceTo(requestedEnd), reachable: Math.abs(distance - requestedDistance) < 1e-7,
    clamped: Math.abs(distance - requestedDistance) >= 1e-7, limits: { ...limits } };
}

/** A full orientation frame avoids the uncontrolled axial twist of lookAt. */
export function quatFromTwoFrames(restDirection, direction, restSecondary, secondary) {
  const makeFrame = (long, other) => {
    const y = long.clone().normalize();
    if (y.lengthSq() < .5) y.set(0, 1, 0);
    const x = other.clone().addScaledVector(y, -other.dot(y));
    if (x.lengthSq() < 1e-12) {
      const fallback = Math.abs(y.x) < .9 ? V(1, 0, 0) : V(0, 0, 1);
      x.copy(fallback).addScaledVector(y, -fallback.dot(y));
    }
    x.normalize();
    return new THREE.Matrix4().makeBasis(x, y, x.clone().cross(y).normalize());
  };
  const rest = makeFrame(restDirection, restSecondary), posed = makeFrame(direction, secondary);
  return new THREE.Quaternion().setFromRotationMatrix(posed.multiply(rest.transpose())).normalize();
}

/** One complete repetition, exact endpoints and a stationary turnaround. */
export function repetitionDepth(inputPhase) {
  const phase = clamp(Number.isFinite(Number(inputPhase)) ? Number(inputPhase) : 0, 0, 1);
  // Snap the analytic periodic endpoints to the same floating point pose.
  return { phase, depth: phase === 0 || phase === 1 ? 0 : (1 - Math.cos(phase * Math.PI * 2)) * .5 };
}
