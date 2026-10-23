# Velora Motion Lab

A reusable anatomical human rig based on the BodyExplorer source meshes. The main page demonstrates push-up, squat and dumbbell curl with **one 79-bone hierarchy**, immutable source bindings and a separately bound, closed athlete exterior. Changing exercise selects trajectories, corrective strengths, muscle-role colors and equipment sockets; it does not rebind or rebuild the person.

## Run

```sh
npm install
npm run dev -- --port 4173
npm run build
```

Open http://127.0.0.1:4173/. The previous accepted push-up is retained at `/pushup.html`; the earlier elbow experiment remains at `/elbow.html`. All three pages are included in the static build.

## Shared rig

- 79 control/deformation bones: pelvis, segmented lumbar/thoracic/cervical chain, head, independent clavicles and scapulae, arms with twist stations, wrists, five articulated fingers per hand, hips, knees, ankle/foot, toe hinges and independent patellar drivers.
- Joint landmarks use the original bone geometry. Hip/shoulder fits and tibial joint sections are reused; finger pivots come from source bone segments. The shared neutral hand uses the same open-palm correction for every exercise.
- 467 anatomical soft-tissue meshes and 201 rigid anatomical bone meshes share a single skeleton. Four-influence anatomical skinning blends texture dual quaternions with linear attachment deformation for selected leg muscles and an explicit quadriceps surface envelope, avoiding a per-bone vertex-uniform limit. CPU geometry checks use the same hybrid blend and local envelope.
- Shoulder, elbow, hip and knee corrective morphs augment the shared skin. Anatomical bone meshes use rigid single-bone influences.
- Analytic two-bone IK preserves segment lengths and clamps unreachable effectors. Elbow/knee limits constrain the solve; authored hip/wrist/ankle ranges are checked and reported by the clip sampler.
- Push-up hand/toe anchors and standing full-foot support remain fixed. Dumbbells use explicit hand sockets; articulated digits are fitted around a 12 mm radius handle, including thumb opposition and distal finger-tendon following.
- Deep red and light red classify selected main and supporting muscle roles for the current exercise. They are not measured activation intensity. Gray does not mean no participation.

## Module boundaries

| Module | Responsibility |
|---|---|
| `src/universalSkeleton.js` | Common rest hierarchy, measured landmarks, finger mapping |
| `src/humanRig.js` | One-time anatomical binding, texture DQ, shared corrective shapes, equipment and diagnostics |
| `src/rigConstraints.js` | Two-bone IK, range checks, orientation frames and exact repetition endpoints |
| `src/exerciseClips.js` | Three authored trajectories, contact targets, finger FK and equipment sockets |
| `src/exerciseMuscles.js` | Per-exercise anatomical role categories |
| `src/appearanceLayer.js` | Closed visible athlete skin, source muscle-ID surface colors, shared-skeleton integration |
| `src/universalMain.js` | Viewer, cameras and 1/3/5 repetitions at three seconds per cycle |

See `docs/universal-rig.md` for reuse and extension. Machine-readable landmarks and the bone manifest are in `output/universal-rig/`.

## Acceptance

`output/universal-rig/acceptance-check.mjs` independently checks one rig through push-up → squat → curl → push-up. It hashes every skin index/weight array, bind inverse, bind matrix and neutral vertex buffer, checks object identity, and recomputes segment lengths from actual world pivots. It checks full geometry at the start, midpoint and end of each exercise, with intermediate samples at six further stages, plus actual support vertices and anatomical bone rigidity.

Results: `output/universal-rig/acceptance-result.json` and `.md`. Rendering checks cover all three actions, a close view of the hand/bar, the hip/knee view, visibility controls, single-play completion and mobile layout. Three-second, silent sample exports are under `output/universal-rig/clips/`. No generation API or external inference is used.

## Squat deformation revision

The original shared-rig numerical gates did not test the later-reported hip/knee surface intersections. The revision adds attachment-specific lower-body weights (`src/legBinding.js`), paired patellar drivers, a continuous quadriceps front-envelope correction, IT-tract clearance and a pronated squat hand pose. No anatomy is hidden to pass the review. The revised case includes multi-phase hip/knee/underside close views, explicit patellar upper-edge distances, fixed-view three-second clips and an independent visual report under `output/squat-fix/`. The 79-bone rig and all static binding data remain shared across exercise switches.

## Interpretation and remaining scope

This is the reusable graphics foundation verified against the three included actions. A new exercise should reuse its skeleton and static binding, then add a trajectory, contact/equipment targets and any necessary pose-specific corrective refinement. Passing these three cases does not validate every overhead, seated, loaded or extreme-range pose. The range rules and fitted grips are authored animation constraints, not a force/contact physics solver or a clinical movement assessment.

The original segmented anatomy remains available in the appearance selector. The default athlete exterior is a separate, closed three-dimensional surface with a faceless head, complete hands and feet. Its surface stores original muscle IDs; action colors are computed on that visible surface rather than shown through a hidden shell. New exercises still require visual review of joint deformation, contact and grip.

## Appearance asset pipeline

The three layers are independent: the existing Rig Layer evaluates IK/FK, clips and equipment; the native Muscle Layer retains all 467 named soft-tissue meshes and role mappings; the Appearance Layer renders a closed source-derived athlete surface on the same Skeleton. No exercise switch rebuilds a skeleton or skin.

Offline tools in `tools/appearance/` export the immutable corrected source geometry/binding, reconstruct the surface in Blender and transfer a continuous exterior binding plus muscle ID field. Runtime `athlete-skin.json` describes packed attributes in `athlete-skin.bin`. Four muscle IDs/weights per surface vertex allow smooth anatomical boundaries; five transferred corrective channels remain available. Head/hand skinning is authored against the existing head and phalange chains. Surface colors can be controlled through `window.veloraLab.appearance.setColors({neutral,primary,support})`, and the viewer retains the original highlighter toggles.

The exterior is a genuine indexed 3D mesh, not a camera-facing image or texture substitute. Editable model sources and generated audit artifacts are under `output/appearance/`. Numerical source-rig reports apply only to native geometry; the exterior has separate topology, posed-surface and visual checks. See the final exterior acceptance report for the current review status.

## Retained experiments

The former 19-bone push-up source is unchanged in `src/pushupRig.js`. Its accepted motion, two-tier color export and reports remain in `output/pushup/`, `output/pushup-v2/`, `output/rig/` and `output/audit/`. Those old reports apply to the old scene; the shared rig has its own independent acceptance. The elbow trial and its original debug controls are retained separately.

## Source and attribution

Upstream: https://github.com/JohanBellander/BodyExplorer

The upstream author states the source-code license is MIT in its README. The anatomical models have their own licenses:

- BodyParts3D, © The Database Center for Life Science (DBCLS), CC Attribution-ShareAlike 2.1 Japan: https://creativecommons.org/licenses/by-sa/2.1/jp/deed.en
- Z-Anatomy, Gauthier Kervyn, CC BY-SA 4.0: https://creativecommons.org/licenses/by-sa/4.0/

The included `public/` model files and mesh mapping were retrieved from upstream. The unmodified upstream README and relevant JavaScript files are retained in `upstream/`. This experiment adds display-coordinate conversion, gray/red materials, camera views, experimental rigging and weights. Source dataset licenses continue to apply to the assets and their adaptations.
