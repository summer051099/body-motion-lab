import * as THREE from 'three';

// One common rest hierarchy for every exercise. Source meshes are BodyParts3D
// geometry exposed through BodyExplorer; axes and joint pivots are authored
// estimates fitted to those source bones, not clinical motion measurements.
// See output/universal-rig/source-landmarks.json and derive-landmarks.py.
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const SIDES = ['left', 'right'];
const FINGER_NAMES = ['thumb', 'index', 'middle', 'ring', 'little'];
const FINGER_POINTS = {
  "left": {
    "thumb": {
      "points": [
        [
          0.27782813,
          0.79348397,
          0.12688862
        ],
        [
          0.30529088,
          0.76538625,
          0.13839033
        ],
        [
          0.31463049,
          0.73956895,
          0.13840604
        ],
        [
          0.32290879,
          0.72003132,
          0.13955974
        ]
      ],
      "sourceNames": [
        "left first metacarpal bone",
        "proximal phalanx of left thumb",
        "distal phalanx of left thumb"
      ]
    },
    "index": {
      "points": [
        [
          0.2672511,
          0.78486788,
          0.12005619
        ],
        [
          0.28477098,
          0.72064939,
          0.10643432
        ],
        [
          0.29829712,
          0.68714234,
          0.10744802
        ],
        [
          0.30624096,
          0.6734142,
          0.11906217
        ],
        [
          0.30796781,
          0.66303051,
          0.12900248
        ]
      ],
      "sourceNames": [
        "left second metacarpal bone",
        "proximal phalanx of left index finger",
        "middle phalanx of left index finger",
        "distal phalanx of left index finger"
      ]
    },
    "middle": {
      "points": [
        [
          0.26132205,
          0.78354365,
          0.1125693
        ],
        [
          0.26548259,
          0.72199491,
          0.10705196
        ],
        [
          0.27250914,
          0.68472564,
          0.11309974
        ],
        [
          0.27492537,
          0.66348869,
          0.12275073
        ],
        [
          0.27704212,
          0.65458912,
          0.13353917
        ]
      ],
      "sourceNames": [
        "left third metacarpal bone",
        "proximal phalanx of left middle finger",
        "middle phalanx of left middle finger",
        "distal phalanx of left middle finger"
      ]
    },
    "ring": {
      "points": [
        [
          0.25028262,
          0.78372675,
          0.11956309
        ],
        [
          0.24740784,
          0.72695151,
          0.10990856
        ],
        [
          0.24917278,
          0.69109213,
          0.11503726
        ],
        [
          0.24941446,
          0.67046967,
          0.12542424
        ],
        [
          0.25018886,
          0.66571218,
          0.13793778
        ]
      ],
      "sourceNames": [
        "left fourth metacarpal bone",
        "proximal phalanx of left ring finger",
        "middle phalanx of left ring finger",
        "distal phalanx of left ring finger"
      ]
    },
    "little": {
      "points": [
        [
          0.24198215,
          0.78491801,
          0.12385272
        ],
        [
          0.22955822,
          0.73402128,
          0.11609148
        ],
        [
          0.22586631,
          0.70473376,
          0.11937914
        ],
        [
          0.22286442,
          0.68763763,
          0.12379815
        ],
        [
          0.22146642,
          0.67757112,
          0.13082755
        ]
      ],
      "sourceNames": [
        "left fifth metacarpal bone",
        "proximal phalanx of left little finger",
        "middle phalanx of left little finger",
        "distal phalanx of left little finger"
      ]
    }
  },
  "right": {
    "thumb": {
      "points": [
        [
          -0.27570736,
          0.79225701,
          0.12976636
        ],
        [
          -0.30557306,
          0.76543209,
          0.13864925
        ],
        [
          -0.31354992,
          0.73873305,
          0.13736031
        ],
        [
          -0.32238957,
          0.71965665,
          0.13906295
        ]
      ],
      "sourceNames": [
        "right first metacarpal bone",
        "proximal phalanx of right thumb",
        "distal phalanx of right thumb"
      ]
    },
    "index": {
      "points": [
        [
          -0.26738539,
          0.78480273,
          0.12027679
        ],
        [
          -0.28662656,
          0.72118422,
          0.10683874
        ],
        [
          -0.29909593,
          0.68752655,
          0.10787781
        ],
        [
          -0.30548486,
          0.67326105,
          0.11896757
        ],
        [
          -0.30784619,
          0.66292512,
          0.12910509
        ]
      ],
      "sourceNames": [
        "right second metacarpal bone",
        "proximal phalanx of right index finger",
        "middle phalanx of right index finger",
        "distal phalanx of right index finger"
      ]
    },
    "middle": {
      "points": [
        [
          -0.2624194,
          0.78387523,
          0.11196011
        ],
        [
          -0.26617776,
          0.72262353,
          0.10773791
        ],
        [
          -0.27230121,
          0.6849966,
          0.11316508
        ],
        [
          -0.27569894,
          0.66389245,
          0.12310523
        ],
        [
          -0.27778178,
          0.65452653,
          0.1337225
        ]
      ],
      "sourceNames": [
        "right third metacarpal bone",
        "proximal phalanx of right middle finger",
        "middle phalanx of right middle finger",
        "distal phalanx of right middle finger"
      ]
    },
    "ring": {
      "points": [
        [
          -0.25020662,
          0.7835362,
          0.11886148
        ],
        [
          -0.24723037,
          0.72752935,
          0.11055335
        ],
        [
          -0.24878564,
          0.69143918,
          0.11564106
        ],
        [
          -0.25019558,
          0.67094368,
          0.12580594
        ],
        [
          -0.25067154,
          0.66591454,
          0.13806196
        ]
      ],
      "sourceNames": [
        "right fourth metacarpal bone",
        "proximal phalanx of right ring finger",
        "middle phalanx of right ring finger",
        "distal phalanx of right ring finger"
      ]
    },
    "little": {
      "points": [
        [
          -0.23913284,
          0.78608716,
          0.12416804
        ],
        [
          -0.23041461,
          0.73431343,
          0.11690833
        ],
        [
          -0.22634739,
          0.70436224,
          0.11861048
        ],
        [
          -0.22286762,
          0.68803546,
          0.12427077
        ],
        [
          -0.22123487,
          0.67752784,
          0.13019417
        ]
      ],
      "sourceNames": [
        "right fifth metacarpal bone",
        "proximal phalanx of right little finger",
        "middle phalanx of right little finger",
        "distal phalanx of right little finger"
      ]
    }
  }
};

const SPINE_POINTS = {
  pelvis: [.00019618, .81078609, .07914801],
  lumbar: [-.00071355, .92971396, .05866075],
  lumbarUpper: [-.00065920, 1.04359007, .06935120],
  thorax: [-.00070580, 1.12845004, .04594015],
  chest: [-.00069440, 1.23922992, .03320666],
  neck: [-.00064885, 1.37827492, .05564915],
  neckUpper: [-.00065175, 1.43137002, .06297315],
  head: [-.00056695, 1.47182000, .06412000],
};
const SPINE_SOURCE = {
  pelvis: 'midpoint of fitted left/right femoral head centres',
  lumbar: 'fifth lumbar vertebra bounds centre',
  lumbarUpper: 'first lumbar vertebra bounds centre',
  thorax: 'tenth thoracic vertebra bounds centre',
  chest: 'sixth thoracic vertebra bounds centre',
  neck: 'seventh cervical vertebra bounds centre',
  neckUpper: 'third cervical vertebra bounds centre',
  head: 'atlas bounds centre',
};

function makeRest(side) {
  const sign = side === 'left' ? 1 : -1;
  return {
    shoulder: V(sign * .1647, 1.3150, .0758),
    elbow: V(sign * .2240, 1.0390, .0730),
    wrist: V(sign * .2580, .8050, .1120),
    hip: side === 'left' ? V(.08865097, .81071426, .07912430) : V(-.08825862, .81085791, .07917172),
    knee: V(sign * .0728, .3670, .0826),
    ankle: V(sign * .0713, .0066, .0744),
    mtp: V(sign * .105, -.056, .185),
  };
}

/**
 * Creates a shared 79-bone, parent-before-child bind hierarchy. All rest points
 * are absolute source-space positions in metres; bone.position is local.
 * Rotation axes remain identity at bind time, so pose authors may specify
 * world rotations consistently. Twist helpers intentionally share the pivot
 * of the main segment and do not introduce false segment lengths.
 *
 * Each finger contains its palm/metacarpal segment. The thumb has 3 segments
 * (CMC/MCP/IP), the other digits 4 (CMC/MCP/PIP/DIP). fingerData describes each
 * segment's start and end in the SAME neutral-hand bind space as the meshes.
 */
export function buildUniversalSkeleton() {
  const root = new THREE.Bone();
  root.name = 'velora-humanoid-root';
  const joints = [{ bone: root, rest: V(), parent: -1, role: 'root', source: 'unchanged source origin' }];
  const boneIndex = { body: 0, root: 0, [root.name]: 0 };
  const spine = {}, chains = {}, rest = {}, fingerData = {};
  function addJoint(name, point, parent, role, source) {
    const bone = new THREE.Bone();
    bone.name = name;
    const index = joints.length;
    bone.position.copy(point).sub(joints[parent].rest);
    joints[parent].bone.add(bone);
    bone.userData.rigRole = role;
    joints.push({ bone, rest: point.clone(), parent, role, source });
    boneIndex[name] = index;
    return index;
  }
  let parent = 0;
  for (const [name, point] of Object.entries(SPINE_POINTS)) {
    spine[name] = addJoint(`spine-${name}`, V(...point), parent, name, SPINE_SOURCE[name]);
    parent = spine[name];
  }
  for (const side of SIDES) {
    const r = rest[side] = makeRest(side);
    const clavicle = addJoint(`${side}-clavicle`, (side === 'left' ? V(.01123860, 1.31821096, .13108562) : V(-.01307868, 1.32054925, .13079722)), spine.chest,
      'clavicle', 'mean medial 10% of source clavicle vertices by absolute x');
    // The glenoid pivot preserves the previously accepted push-up shoulder
    // contact solution while keeping an independent scapulothoracic control.
    const scapula = addJoint(`${side}-scapulothoracic`, r.shoulder, clavicle,
      'scapula', 'source humeral head fit / glenoid shoulder articulation');
    const upper = addJoint(`${side}-humerus`, r.shoulder, scapula, 'upper-arm', 'source humeral head fit');
    const upperTwist = addJoint(`${side}-upper-arm-twist`, r.shoulder, upper, 'twist-helper', 'shared humeral pivot');
    const forearm = addJoint(`${side}-ulna-proximal-forearm`, r.elbow, upperTwist,
      'forearm', 'source distal humerus / proximal ulna articulation');
    const twist1 = addJoint(`${side}-forearm-pronation-1`, r.elbow, forearm, 'twist-helper', 'shared elbow pivot');
    const twist2 = addJoint(`${side}-forearm-pronation-2`, r.elbow, twist1, 'twist-helper', 'shared elbow pivot');
    const twist3 = addJoint(`${side}-radius-distal-pronation`, r.elbow, twist2, 'twist-helper', 'shared elbow pivot');
    const hand = addJoint(`${side}-carpus-palm`, r.wrist, twist3,
      'hand', 'source distal radius and ulna fitted wrist');
    const fingers = {};
    fingerData[side] = {};
    for (const finger of FINGER_NAMES) {
      const data = FINGER_POINTS[side][finger];
      const points = data.points.map(p => V(...p));
      const kinds = finger === 'thumb' ? ['metacarpal', 'proximal', 'distal'] : ['metacarpal', 'proximal', 'middle', 'distal'];
      let fingerParent = hand;
      fingers[finger] = [];
      fingerData[side][finger] = [];
      kinds.forEach((kind, i) => {
        const index = addJoint(`${side}-${finger}-${kind}`, points[i], fingerParent,
          `finger-${kind}`, data.sourceNames[i]);
        fingers[finger].push(index);
        fingerData[side][finger].push({ index, restPoint: points[i].clone(), nextPoint: points[i + 1].clone(),
          sourceName: data.sourceNames[i], kind });
        fingerParent = index;
      });
    }
    const thigh = addJoint(`${side}-femur`, r.hip, spine.pelvis, 'thigh', 'sphere fit to source femoral head');
    const thighTwist = addJoint(`${side}-thigh-twist`, r.hip, thigh, 'twist-helper', 'shared hip pivot');
    const shin = addJoint(`${side}-tibia`, r.knee, thighTwist, 'shin', 'source tibial plateau centre');
    const shinTwist = addJoint(`${side}-shin-twist`, r.knee, shin, 'twist-helper', 'shared knee pivot');
    const foot = addJoint(`${side}-tarsus`, r.ankle, shinTwist, 'foot', 'source distal tibial ankle centre');
    const toe = addJoint(`${side}-metatarsophalangeal`, r.mtp, foot,
      'toe', 'authored common toe hinge fitted to source metatarsal support');
    chains[side] = { clavicle, scapula, upper, upperTwist, forearm, twist1, twist2, twist3,
      hand, fingers, thigh, thighTwist, shin, shinTwist, foot, toe,
      lengths: { upper: r.elbow.distanceTo(r.shoulder), lower: r.wrist.distanceTo(r.elbow),
        thigh: r.knee.distanceTo(r.hip), shin: r.ankle.distanceTo(r.knee) } };
  }
  // Paired rigid patellar drivers track the femoral trochlea independently
  // of the tibia. Append to preserve existing driver indices.
  for(const side of SIDES){
    const sign=side==='left'?1:-1;
    rest[side].patella=V(sign*.08142,.38113,.11183);
    chains[side].patella=addJoint(`${side}-patella`,rest[side].patella,chains[side].shin,'patella','source patella bounds centre; authored trochlear trajectory');
  }
  root.updateMatrixWorld(true);
  return { root, joints, boneIndex, chains, spine, rest, fingerData,
    bindSpace: { units: 'metres', up: 'Y', neutralHand: { thresholdY: .79, slopeZ: .45 } },
    schemaVersion: 'velora-humanoid-2' };
}

const normalName = name => String(name).replace(/_/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
function pointSegmentDistanceSquared(point, a, b) {
  const ab = b.clone().sub(a);
  const t = THREE.MathUtils.clamp(point.clone().sub(a).dot(ab) / Math.max(ab.lengthSq(), 1e-10), 0, 1);
  return point.distanceToSquared(a.clone().addScaledVector(ab, t));
}

/**
 * Weight helper for hand-region vertices in the shared neutral bind space.
 * Exact source finger/metacarpal bone names are rigid (one influence). Soft
 * tissue is blended locally to nearby digit segments, with a palm influence
 * near the wrist. Forearm muscles should still be weighted by the arm binder;
 * call this only for their distal hand/tendon vertices or intrinsic hand parts.
 */
export function getFingerBinding(name, position, side, schema) {
  const hand = schema.chains[side].hand;
  const n = normalName(name);
  const p = position?.isVector3 ? position : Array.isArray(position)
    ? V(...position) : V(position.x, position.y, position.z);
  const data = schema.fingerData[side];
  const allSegments = FINGER_NAMES.flatMap(finger => data[finger]);
  const rigid = allSegments.find(segment => normalName(segment.sourceName) === n);
  if (rigid) return [[rigid.index, 1]];
  let namedFinger = null;
  if (/thumb|pollicis/.test(n)) namedFinger = 'thumb';
  else if (/index finger|indicis/.test(n)) namedFinger = 'index';
  else if (/middle finger/.test(n)) namedFinger = 'middle';
  else if (/ring finger/.test(n)) namedFinger = 'ring';
  else if (/little finger|digiti minimi/.test(n)) namedFinger = 'little';
  const candidates = (namedFinger ? data[namedFinger] : allSegments)
    .map(segment => ({ index: segment.index, distance: pointSegmentDistanceSquared(p, segment.restPoint, segment.nextPoint) }))
    .sort((a, b) => a.distance - b.distance);
  const nearest = Math.sqrt(candidates[0].distance);
  if (p.y >= .795 || nearest > .045) return [[hand, 1]];
  const palm = THREE.MathUtils.smoothstep(p.y, .725, .790);
  const selected = candidates.slice(0, palm > .001 ? 3 : 4);
  const influence = selected.map(c => [c.index, 1 / (c.distance + .000016)]);
  const total = influence.reduce((sum, [, w]) => sum + w, 0);
  for (const entry of influence) entry[1] = entry[1] / total * (1 - palm);
  if (palm > .001) influence.push([hand, palm]);
  return influence.filter(([, weight]) => weight > 1e-6);
}
