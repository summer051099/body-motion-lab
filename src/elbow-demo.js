import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { classifyMuscleGroup } from '../upstream/src/muscleData.js';
import './styles.css';

const $ = (id) => document.getElementById(id);
const state = { angle: 0, playing: false, mode: 'skin', highlight: 'biceps', enabled: true, bones: false, wireframe: false, isolate: false, ready: false };
const scene = new THREE.Scene();
scene.background = new THREE.Color('#e9ede5');
const hemisphere = new THREE.HemisphereLight(0xffffff, 0x66705c, 1.45);
hemisphere.layers.enable(1);
scene.add(hemisphere);
const keyLight = new THREE.DirectionalLight(0xffffff, 2.4);
keyLight.layers.enable(1);
keyLight.position.set(-3, 5, 5);
scene.add(keyLight);
const fillLight = new THREE.DirectionalLight(0xe6ede3, 1.1);
fillLight.layers.enable(1);
fillLight.position.set(3, 2, -2);
scene.add(fillLight);

const materials = {
  neutral: new THREE.MeshStandardMaterial({ color: '#a3aa9e', roughness: 0.64, metalness: 0, side: THREE.DoubleSide }),
  tendon: new THREE.MeshStandardMaterial({ color: '#d8d8c8', roughness: 0.7, side: THREE.DoubleSide }),
  red: new THREE.MeshStandardMaterial({ color: '#bc332b', roughness: 0.55, side: THREE.DoubleSide }),
  bone: new THREE.MeshStandardMaterial({ color: '#eee6cd', roughness: 0.65, side: THREE.DoubleSide }),
};
const body = new THREE.Group();
scene.add(body);
const bonesGroup = new THREE.Group();
body.add(bonesGroup);
bonesGroup.visible = false;
const muscleMeshes = [];
const boneMeshes = [];
const deformMeshes = [];
const elbow = new THREE.Vector3(-0.224, 1.039, 0.073);
const rootBone = new THREE.Bone();
rootBone.name = 'experimental-upper-arm';
const forearmBone = new THREE.Bone();
forearmBone.name = 'experimental-forearm';
forearmBone.position.copy(elbow);
rootBone.add(forearmBone);
body.add(rootBone);
body.updateMatrixWorld(true);
const skeleton = new THREE.Skeleton([rootBone, forearmBone]);
const pivotMarker = new THREE.Mesh(new THREE.SphereGeometry(0.005, 12, 8), new THREE.MeshBasicMaterial({ color: '#477647', depthTest: false }));
pivotMarker.position.copy(elbow);
pivotMarker.renderOrder = 20;
pivotMarker.layers.set(1);
body.add(pivotMarker);

function makeView(canvas, detail = false) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance', preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.7));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  const camera = new THREE.PerspectiveCamera(detail ? 31 : 30, 1, 0.01, 20);
  if (detail) camera.layers.set(1);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = detail ? 0.3 : 1.5;
  controls.maxDistance = detail ? 4 : 8;
  controls.target.copy(detail ? new THREE.Vector3(-0.22, 1.08, 0.19) : new THREE.Vector3(0, 0.83, 0));
  camera.position.copy(detail ? new THREE.Vector3(-1.3, 1.15, 1.25) : new THREE.Vector3(-1.45, 0.95, 3.75));
  const resize = () => {
    const { width, height } = canvas.getBoundingClientRect();
    if (!width || !height) return;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  };
  new ResizeObserver(resize).observe(canvas.parentElement);
  resize();
  controls.update();
  return { renderer, camera, controls, resize };
}
const fullView = makeView($('body-canvas'));
const detailView = makeView($('detail-canvas'), true);

function convertGeometry(source) {
  const geometry = source.clone();
  const p = geometry.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    p.setXYZ(i, x / 1000, z / 1000, -y / 1000);
  }
  if (geometry.attributes.normal) {
    const n = geometry.attributes.normal;
    for (let i = 0; i < n.count; i++) {
      const x = n.getX(i), y = n.getY(i), z = n.getZ(i);
      n.setXYZ(i, x, z, -y);
    }
  }
  p.needsUpdate = true;
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

const smoothstep = (a, b, x) => {
  const t = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
function prepareSkin(geometry, isBone) {
  const p = geometry.attributes.position;
  const indices = new Uint16Array(p.count * 4);
  const weights = new Float32Array(p.count * 4);
  const soft = new Float32Array(p.count);
  const rigid = new Float32Array(p.count);
  for (let i = 0; i < p.count; i++) {
    // An automatically derived height band, not anatomist-authored skin weights.
    const y = p.getY(i);
    soft[i] = isBone ? 1 : 1 - smoothstep(elbow.y - 0.065, elbow.y + 0.08, y);
    rigid[i] = isBone ? 1 : (y <= elbow.y ? 1 : 0);
    indices.set([0, 1, 0, 0], i * 4);
    weights.set([1 - soft[i], soft[i], 0, 0], i * 4);
  }
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(indices, 4));
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(weights, 4));
  return { soft, rigid };
}

function createMesh(child, isBone) {
  const name = child.name.replace(/_/g, ' ');
  // "pronator teres" is a forearm muscle; the upstream generic "teres"
  // shoulder match precedes it, so correct this specific classification.
  const group = /pronator teres/i.test(name) ? 'FOREARM' : classifyMuscleGroup(name);
  const side = /\bright\b/i.test(name) ? 'right' : /\bleft\b/i.test(name) ? 'left' : 'center';
  const geometry = convertGeometry(child.geometry);
  const bounds = geometry.boundingBox;
  // The upstream name classifier also matches some foot flexors. Never infer
  // animation membership from names alone: require the right arm's location.
  const armLocation = bounds.min.y > 0.55 && bounds.max.y < 1.43 && bounds.max.x < -0.1;
  const isArm = side === 'right' && armLocation && (isBone
    ? bounds.max.y < 1.075 && bounds.min.x < -0.18 && bounds.min.y > 0.55
    : ['UPPER_ARM', 'FOREARM', 'HAND'].includes(group));
  const tendon = /tendon|ligament|retinaculum|membrane/.test(name.toLowerCase());
  const material = isBone ? materials.bone : tendon ? materials.tendon : materials.neutral;
  let mesh;
  if (isArm) {
    const profiles = prepareSkin(geometry, isBone);
    mesh = new THREE.SkinnedMesh(geometry, material);
    mesh.bind(skeleton, new THREE.Matrix4());
    mesh.frustumCulled = false;
    mesh.userData.profiles = profiles;
    deformMeshes.push(mesh);
  } else {
    mesh = new THREE.Mesh(geometry, material);
  }
  mesh.name = name;
  Object.assign(mesh.userData, { group, side, tendon, isArm, isBone, originalMaterial: material });
  if (side === 'right' && armLocation && (isBone || ['UPPER_ARM', 'FOREARM', 'HAND', 'SHOULDER'].includes(group))) mesh.layers.enable(1);
  (isBone ? bonesGroup : body).add(mesh);
  (isBone ? boneMeshes : muscleMeshes).push(mesh);
}

function matchesHighlight(name) {
  const n = name.toLowerCase();
  if (state.highlight === 'biceps') return n.includes('right') && (n.includes('biceps brachii') || n.includes('right brachialis'));
  if (state.highlight === 'triceps') return n.includes('right') && n.includes('triceps brachii');
  if (state.highlight === 'chest') return n.includes('pectoralis major');
  if (state.highlight === 'quads') return /rectus femoris|vastus (lateralis|medialis|intermedius)/.test(n);
  return false;
}
const labels = { biceps: '右肱二头肌与肱肌', triceps: '右肱三头肌', chest: '双侧胸大肌', quads: '双侧股四头肌' };
function updateAppearance() {
  let selected = 0;
  for (const mesh of muscleMeshes) {
    const active = state.enabled && matchesHighlight(mesh.name);
    mesh.material = active ? materials.red : mesh.userData.originalMaterial;
    mesh.visible = !state.isolate || mesh.layers.isEnabled(1);
    if (active) selected++;
  }
  bonesGroup.visible = state.bones;
  for (const mesh of boneMeshes) mesh.visible = !state.isolate || mesh.layers.isEnabled(1);
  for (const material of Object.values(materials)) material.wireframe = state.wireframe;
  $('selected-count').textContent = String(selected);
  $('selected-label').textContent = state.enabled ? labels[state.highlight] : '高亮已关闭';
}

function setMode(mode) {
  state.mode = mode;
  for (const mesh of deformMeshes) {
    const profile = mode === 'rigid' ? mesh.userData.profiles.rigid : mesh.userData.profiles.soft;
    const w = mesh.geometry.attributes.skinWeight;
    for (let i = 0; i < w.count; i++) w.setXYZW(i, 1 - profile[i], profile[i], 0, 0);
    w.needsUpdate = true;
  }
  $('angle').disabled = mode === 'rest';
  $('play').disabled = mode === 'rest';
  if (mode === 'rest') setPlaying(false);
  applyAngle();
}
function applyAngle() {
  const angle = state.mode === 'rest' ? 0 : state.angle;
  forearmBone.rotation.x = -THREE.MathUtils.degToRad(angle);
  body.updateMatrixWorld(true);
  skeleton.update();
  $('angle-value').textContent = Math.round(angle) + '°';
  $('detail-angle').textContent = String(Math.round(angle));
  $('angle').value = String(Math.round(angle));
  $('state-label').textContent = state.mode === 'rest' ? '原始静态' : state.playing ? '循环播放' : '手动检查';
}
let playStart = 0;
function setPlaying(playing) {
  state.playing = playing;
  playStart = performance.now();
  $('play').innerHTML = playing ? '暂停循环 <span>4 s</span>' : '播放弯肘循环 <span>4 s</span>';
  applyAngle();
}

for (const button of document.querySelectorAll('[data-highlight]')) button.addEventListener('click', () => {
  state.highlight = button.dataset.highlight;
  for (const b of document.querySelectorAll('[data-highlight]')) {
    const active = b === button;
    b.classList.toggle('active', active);
    b.setAttribute('aria-pressed', String(active));
  }
  updateAppearance();
});
$('angle').addEventListener('input', (e) => { setPlaying(false); state.angle = Number(e.target.value); applyAngle(); });
for (const button of document.querySelectorAll('[data-angle]')) button.addEventListener('click', () => {
  if (state.mode === 'rest') { $('deform-mode').value = 'skin'; setMode('skin'); }
  setPlaying(false); state.angle = Number(button.dataset.angle); applyAngle();
});
$('deform-mode').addEventListener('change', (e) => setMode(e.target.value));
$('play').addEventListener('click', () => setPlaying(!state.playing));
for (const [id, key] of [['highlight-enabled', 'enabled'], ['bones', 'bones'], ['wireframe', 'wireframe'], ['isolate', 'isolate']]) {
  $(id).addEventListener('change', (e) => { state[key] = e.target.checked; updateAppearance(); });
}
function resetView(front = false) {
  fullView.controls.target.set(0, 0.83, 0);
  fullView.camera.position.set(front ? 0 : -1.45, 0.95, front ? 4 : 3.75);
  detailView.controls.target.set(-0.22, 1.08, 0.19);
  detailView.camera.position.set(-1.3, 1.15, 1.25);
  fullView.controls.update(); detailView.controls.update();
  $('front-view').classList.toggle('active', front);
  $('threequarter-view').classList.toggle('active', !front);
}
$('front-view').addEventListener('click', () => resetView(true));
$('threequarter-view').addEventListener('click', () => resetView(false));
$('reset-view').addEventListener('click', () => resetView(false));

function render(time) {
  requestAnimationFrame(render);
  if (state.playing && state.ready) {
    // One controlled flexion/extension, 0–110 degrees, in four seconds.
    const phase = ((time - playStart) % 4000) / 4000;
    state.angle = 55 * (1 - Math.cos(phase * Math.PI * 2));
    applyAngle();
  }
  fullView.controls.update(); detailView.controls.update();
  scene.background.set('#e9ede5');
  pivotMarker.visible = false;
  fullView.renderer.render(scene, fullView.camera);
  scene.background.set('#e2e7de');
  pivotMarker.visible = true;
  detailView.renderer.render(scene, detailView.camera);
}
requestAnimationFrame(render);

async function init() {
  const loader = new GLTFLoader();
  const models = await Promise.all([
    loader.loadAsync('/anatomy.glb', (e) => { if (e.total) $('loading-text').textContent = `正在载入肌肉网格… ${Math.round(e.loaded / e.total * 100)}%`; }),
    loader.loadAsync('/skeleton.glb'),
  ]);
  for (let i = 0; i < models.length; i++) models[i].scene.traverse((child) => { if (child.isMesh) createMesh(child, i === 1); });
  state.ready = true;
  $('mesh-count').textContent = String(muscleMeshes.length);
  $('rig-count').textContent = String(deformMeshes.filter(m => !m.userData.isBone).length);
  $('status').textContent = '模型已载入 · 自动蒙皮实验';
  $('loading').remove();
  updateAppearance(); applyAngle();
  window.motionLab = {
    state,
    setAngle(angle) { setPlaying(false); state.angle = THREE.MathUtils.clamp(angle, 0, 120); applyAngle(); },
    setMode,
    stats: { muscles: muscleMeshes.length, bones: boneMeshes.length, skinned: deformMeshes.length, originalSkins: models.reduce((n, m) => n + (m.parser.json.skins?.length || 0), 0), originalAnimations: models.reduce((n, m) => n + m.animations.length, 0) },
    landmark() {
      const wrist = new THREE.Vector3(-0.249, 0.81, 0.1);
      return wrist.sub(elbow).applyAxisAngle(new THREE.Vector3(1, 0, 0), -THREE.MathUtils.degToRad(state.mode === 'rest' ? 0 : state.angle)).add(elbow).toArray();
    },
    inspect() {
      const samples = [];
      for (const mesh of deformMeshes) {
        const positions = mesh.geometry.attributes.position;
        const weights = mesh.geometry.attributes.skinWeight;
        let maxWeightError = 0;
        let finite = true;
        for (let i = 0; i < positions.count; i++) {
          maxWeightError = Math.max(maxWeightError, Math.abs(weights.getX(i) + weights.getY(i) + weights.getZ(i) + weights.getW(i) - 1));
          if (i % 100 === 0) {
            const v = new THREE.Vector3().fromBufferAttribute(positions, i);
            mesh.applyBoneTransform(i, v);
            finite &&= v.toArray().every(Number.isFinite);
          }
        }
        samples.push({name:mesh.name, finite, maxWeightError});
      }
      return {angle:state.angle, mode:state.mode, meshes:samples, selected:muscleMeshes.filter(m => m.material === materials.red).map(m => m.name)};
    },
  };
}
init().catch((e) => {
  console.error(e);
  $('status').textContent = '载入失败';
  $('loading').remove();
  $('error').hidden = false;
  $('error').textContent = '模型载入失败：' + e.message + '。请检查 public 目录内的 GLB 文件是否完整。';
});
