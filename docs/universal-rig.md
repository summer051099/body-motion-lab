# Reusing the Velora human rig

```js
import { createHumanRig } from '../src/humanRig.js';
const person = await createHumanRig(); // load and bind once
scene.add(person.group);
person.setExercise('squat');
person.setPhase(0.5);
person.setExercise('curl'); // same meshes, weights, bind inverses and skeleton
person.setPhase(0.5);
```

`setPhase` samples one complete repetition on `[0,1]`; `0` and `1` are exactly the same pose. The viewer plays once over three seconds. `getPoseDiagnostics()` reports world landmarks, limbs, limits/residuals, finger joints, sockets and support geometry. `inspectGeometry({stride:1})` inspects all rendered deformed vertices. `getBindingSignature()` is a lightweight viewer identity check; the acceptance script independently hashes all static binding buffers.

## Add a trajectory, keep the binding

Add metadata and a sampler to `exerciseClips.js`, plus muscle-role categories if appropriate. The sampler receives the existing `joints`, `rest`, `chains`, `spine`, `fingerData` and calibrated contact anchors. Return a world target position/quaternion for every bone, a pose-diagnostics object and equipment transforms. No sampler may instantiate bones, call `mesh.bind`, alter neutral geometry/weights, or change the bind inverses.

Targets are converted into parent-relative transforms by `humanRig.js`. Thus standing, lowered and prone poses share the same rest hierarchy. Pelvis/spine controls and shoulder-girdle controls remain independently addressable. Twist helpers share segment pivots and do not add artificial limb length; upper-arm/thigh/shin helpers are weighted but the three current clips do not independently exercise their axial twist range.

Use `solveTwoBoneIK` with a stable pole vector and measured segment lengths. It returns a reachable end point and a residual to the requested end, rather than stretching the bone. Keep feet or hands on explicit anchors when the action calls for support. The included elbow/knee limit ranges constrain the solver. Other joint ranges are authored limits checked against the completed trajectory; they do not automatically infer a valid whole-body exercise from an arbitrary end target.

## Equipment and fingers

An equipment socket is a hand joint index plus a rest-space offset/orientation. Current dumbbell transforms come from that socket on every frame. Its cylinder radius is 12 mm, plates are centred at ±90 mm, and the grasp fit uses the same finger pivots as the skin. Five fingers have articulated FK chains; the thumb opposes the other digits. A new grip size needs its own fitted grip parameters and mesh review. A bench/bar/cable should add explicit equipment/contact targets rather than independent unrelated animation tracks.

## Corrective deformation

Shared elbow/shoulder/hip/knee morphs are pose-driven. The DQ shader and the CPU sampling path use the same blend, including corrective morph positions. An anatomical source bone must remain single-influence rigid; soft tissue may blend up to four influences. Preserve mesh identity so an exercise-specific red region follows the anatomy directly.

For a new extreme pose, inspect shoulder, hip, elbow and knee close views, check rigid bone lengths, full vertex floor clearance, and equipment contact. Add a local corrective keyed by the pose parameter if needed. Do not rebuild the skeleton or introduce an exercise-specific set of skin weights.

## Portability

The neutral source GLBs have no rig. This repository creates and reuses the rig at runtime; it does not yet deliver a DCC-authored FBX or a certified retargeting profile. Texture DQ is the runtime skinning contract. A plain GLTF export would need to account for consumers that only support linear-blend skinning and for procedural constraints/sockets. Source asset licenses and attribution in the README continue to apply to derived assets.
