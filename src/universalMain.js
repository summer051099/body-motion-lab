import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createHumanRig } from './humanRig.js';
import { createAppearanceLayer } from './appearanceLayer.js';
import './universal.css';

const $ = id => document.getElementById(id);
const exerciseInfo = {
  pushup: {
    name: '俯卧撑', english: 'PUSH-UP', detail: '02 / 肩臂与手掌',
    description: '双手与脚趾支撑，以肩肘协调运动完成下降和推起。',
    jointLabel: '肘关节屈曲', contact: '手掌 / 脚趾', contactNote: '固定支撑',
    primary: [['胸大肌', 'Pectoralis major'], ['三角肌前束', 'Anterior deltoid'], ['肱三头肌', 'Triceps brachii']],
    support: '前锯肌、背阔肌、中下斜方肌、胸腰段背部稳定肌群与腹壁肌群。',
  },
  squat: {
    name: '深蹲', english: 'SQUAT', detail: '02 / 髋、膝与脚掌',
    description: '双手松握拳向前平举，双脚保持支撑，髋膝协调完成下蹲和站起。',
    jointLabel: '膝关节屈曲', contact: '双脚 / 地面', contactNote: '保持脚掌支撑',
    primary: [['股四头肌', 'Quadriceps femoris'], ['臀大肌', 'Gluteus maximus']],
    support: '大收肌、腘绳肌、臀中肌、腓肠肌与比目鱼肌、胸腰段背部及腹壁稳定肌群。',
  },
  curl: {
    name: '哑铃弯举', english: 'DUMBBELL CURL', detail: '02 / 肩肘、手腕与抓握',
    description: '双手抓握哑铃，上臂保持稳定，以肘关节屈伸完成一次弯举和放回。',
    jointLabel: '肘关节屈曲', contact: '双手 / 哑铃', contactNote: '手指抓握器械',
    primary: [['肱二头肌', 'Biceps brachii'], ['肱肌', 'Brachialis']],
    support: '肱桡肌、旋后肌与旋前圆肌、腕屈伸肌群、腹壁稳定肌群。',
  },
};

const state = {
  ready: false, exercise: Object.hasOwn(exerciseInfo, new URLSearchParams(location.search).get('exercise')) ? new URLSearchParams(location.search).get('exercise') : 'pushup', phase: 0, duration: 3, playing: false,
  repetitions: 1, repetitionIndex: 0,
  highlight: true, support: true, bones: false, joints: false, wireframe: false,
  view: 'oblique', bindingStable: true, exportMode: false,
};
const scene = new THREE.Scene();
scene.background = new THREE.Color('#f7f7f5');
scene.add(new THREE.HemisphereLight(0xffffff, 0xb4afa7, 1.5));
const key = new THREE.DirectionalLight(0xfffcf8, 2.8);
key.position.set(-1.5, 4, 2);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
Object.assign(key.shadow.camera, { near: .2, far: 12, left: -2.2, right: 2.2, top: 2.2, bottom: -2.2 });
key.shadow.bias = -.00012;
key.shadow.normalBias = .001;
key.shadow.radius = 3;
scene.add(key);
const fill = new THREE.DirectionalLight(0xf7f7fa, 1.0);
fill.position.set(2, 1.8, -2);
scene.add(fill);
const floor = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.ShadowMaterial({ opacity: .11 }));
floor.rotation.x = -Math.PI / 2;
floor.position.y = -.001;
floor.receiveShadow = true;
scene.add(floor);

let rig, appearance, skeletonHelper, playStart = 0, playStartPhase = 0, initialBindingSignature;
let viewReady = false;
function makeView(id, isDetail = false) {
  const canvas = $(id);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.03;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const camera = new THREE.PerspectiveCamera(30, 1, .02, 100);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.minDistance = isDetail ? .4 : 1.1;
  controls.maxDistance = isDetail ? 5 : 10;
  controls.target.set(0, .27, isDetail ? .48 : 0);
  camera.position.set(isDetail ? 1.05 : 1.4, isDetail ? .65 : .72, isDetail ? 1.45 : 1.4);
  controls.update();
  const resize = () => {
    if (!isDetail && state.exportMode) return;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    renderer.setSize(rect.width, rect.height, false);
    camera.aspect = rect.width / rect.height;
    camera.updateProjectionMatrix();
    if (viewReady && !isDetail) setView(state.view);
  };
  new ResizeObserver(resize).observe(canvas.parentElement);
  resize();
  return { canvas, renderer, camera, controls, resize };
}
const full = makeView('body-canvas');
const detail = makeView('detail-canvas', true);
viewReady = true;
window.addEventListener('resize', () => { full.resize(); detail.resize(); renderNow(); });

function setCamera(view, position, target, frameAspect = false) {
  view.controls.target.fromArray(target);
  const offset = new THREE.Vector3().fromArray(position).sub(view.controls.target);
  if (frameAspect) {
    const minimumAspect = state.exercise === 'pushup' ? 1.35 : .9;
    offset.multiplyScalar(Math.max(1, minimumAspect / view.camera.aspect));
  }
  view.camera.position.copy(view.controls.target).add(offset);
  view.controls.update();
}
function setView(name = 'oblique') {
  const valid = ['oblique', 'side', 'front', 'back', 'upper'];
  state.view = valid.includes(name) ? name : 'oblique';
  const standing = state.exercise !== 'pushup';
  const positions = standing ? {
    oblique: [3.05, 1.25, 3.08], side: [4.25, 1.0, .03], front: [0, 1.0, 4.25],
    back: [0, 1.0, -4.25], upper: [1.65, 1.2, 2.2],
  } : {
    oblique: [1.4, .72, 1.4], side: [2.6, .65, .05], front: [.02, .85, 2.6],
    back: [1.6, 2.35, -1.1], upper: [.85, .55, 1.05],
  };
  const target = standing
    ? [0, state.view === 'upper' ? (state.exercise === 'squat' ? .65 : 1.1) : .85, .03]
    : [0, .27, state.view === 'upper' ? .48 : 0];
  setCamera(full, positions[state.view], target, state.view !== 'upper');
  for (const button of document.querySelectorAll('[data-view]')) {
    const active = button.dataset.view === state.view;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  }
}
function setDetailView() {
  if (state.exercise === 'pushup') setCamera(detail, [.75, .58, 1.1], [0, .28, .4]);
  else if (state.exercise === 'squat') setCamera(detail, [1.3, .85, 1.5], [0, .52, .03]);
  else setCamera(detail, [1.1, 1.25, 1.3], [0, 1.07, .08]);
}
function count(value) { return Array.isArray(value) ? value.length : Number.isFinite(value) ? value : 0; }
function getPose() { return rig?.getPoseDiagnostics?.(false) || {}; }
function formatAngle(value) { return Number.isFinite(value) ? Math.round(value) + '°' : '—'; }
function updateLabels(d = {}) {
  $('phase').value = String(Math.round(state.phase * 1000));
  $('phase-value').textContent = Math.round(state.phase * 100) + '%';
  const limb = state.exercise === 'squat' ? d.legs : d.arms;
  const angleName = state.exercise === 'squat' ? 'kneeFlexionDeg' : 'elbowFlexionDeg';
  const left = limb?.left?.[angleName], right = limb?.right?.[angleName];
  $('joint-value').textContent = Number.isFinite(left) && Number.isFinite(right)
    ? (Math.abs(left - right) < .5 ? formatAngle(right) : formatAngle(left) + ' / ' + formatAngle(right))
    : formatAngle(Number.isFinite(right) ? right : left);
  $('joint-metric-note').textContent = Number.isFinite(left) && Number.isFinite(right) && Math.abs(left - right) >= .5 ? '左 / 右关节角度' : '左右关节角度';
  $('cycle-value').textContent = ((state.repetitionIndex + state.phase) * state.duration).toFixed(2) + ' / ' + (state.repetitions * state.duration).toFixed(2) + ' s';
  const rep = '第 ' + (state.repetitionIndex + 1) + ' / ' + state.repetitions + ' 次';
  $('state-label').textContent = state.playing ? '正在播放 · ' + rep : state.phase >= 1 && state.repetitionIndex === state.repetitions - 1 ? state.repetitions + ' 次完成 · 已返回起始' : rep + ' · 暂停检查';
  $('phase-name').textContent = state.phase < .035 ? '起始' : state.phase > .965 ? '返回起始' : state.phase < .46 ? '去程' : state.phase < .54 ? '终点' : '返回';
  for (const button of document.querySelectorAll('[data-phase]')) {
    button.classList.toggle('active', Math.abs(Number(button.dataset.phase) - state.phase) < .005);
  }
}
function updateExerciseInfo() {
  const info = exerciseInfo[state.exercise];
  $('exercise-eyebrow').textContent = info.english + ' / ' + state.repetitions + ' REPETITION' + (state.repetitions > 1 ? 'S' : '');
  $('exercise-title').textContent = info.name + ' · ' + (state.repetitions > 1 ? '连续 ' + state.repetitions + ' 次' : '全程演示');
  $('repetitions').value = String(state.repetitions);
  $('repetition-note').textContent = '每次 3 秒 · 共 ' + state.repetitions + ' 次（' + (state.repetitions * 3) + ' 秒）';
  $('exercise-description').textContent = info.description;
  $('detail-label').textContent = info.detail;
  $('joint-metric-label').textContent = info.jointLabel;
  $('contact-value').textContent = info.contact;
  $('contact-metric-note').textContent = info.contactNote;
  $('support-description').textContent = info.support;
  $('muscle-list').replaceChildren(...info.primary.map(([name, english]) => {
    const row = document.createElement('div');
    const dot = document.createElement('i');
    const title = document.createElement('span');
    const translation = document.createElement('small');
    title.textContent = name; translation.textContent = english;
    row.append(dot, title, translation); return row;
  }));
  for (const button of document.querySelectorAll('[data-exercise]')) {
    const active = button.dataset.exercise === state.exercise;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  }
  document.title = 'Velora Motion Lab · ' + info.name;
}
function updateRigInfo() {
  if (!rig) return;
  const diagnostics = rig.diagnostics || {};
  const jointCount = diagnostics.jointCount || rig.skeleton?.bones?.length;
  $('joint-count').textContent = Number.isFinite(jointCount) ? jointCount + ' 根' : '—';
  $('muscle-count').textContent = count(diagnostics.muscleMeshes || rig.muscles) + ' 块';
  $('bone-count').textContent = count(diagnostics.boneMeshes || rig.bones) + ' 块';
  if (appearance) $('appearance-stats').textContent = '1 网格 · ' + (appearance.geometry.index.count / 3000).toFixed(1) + ' 千面';
  $('binding-state').textContent = state.bindingStable ? '共用 · 已保留' : '绑定发生变化';
  const primary = count(diagnostics.activeMuscles), support = count(diagnostics.supportMuscles);
  $('status').textContent = state.bindingStable ? (jointCount ? jointCount + ' 根骨骼 · 同一绑定' : '同一绑定 · 模型已就绪') : '绑定检查未通过';
  $('status').title = '当前动作：主要肌群 ' + primary + ' 块，辅助肌群 ' + support + ' 块';
}
function signatureKey(value) {
  return typeof value === 'string' ? value : value == null ? null : JSON.stringify(value);
}
function applyPhase(value) {
  const phase = Number(value);
  state.phase = THREE.MathUtils.clamp(Number.isFinite(phase) ? phase : 0, 0, 1);
  if (rig) updateLabels(rig.setPhase(state.phase) || getPose());
}
function setPlaying(value) {
  if (!state.ready) return;
  if (value && state.phase >= 1 && state.repetitionIndex >= state.repetitions - 1) { state.repetitionIndex = 0; applyPhase(0); }
  state.playing = Boolean(value);
  playStart = performance.now();
  playStartPhase = state.repetitionIndex + state.phase;
  $('play').innerHTML = (state.playing ? '暂停动作' : '播放 ' + state.repetitions + ' 次') + ' <span>' + (state.repetitions * 3) + ' s</span>';
  updateLabels(getPose());
}
function setExercise(id) {
  if (!Object.hasOwn(exerciseInfo, id)) throw new Error('未知动作：' + id);
  if (!rig) { state.exercise = id; updateExerciseInfo(); return; }
  setPlaying(false);
  rig.setExercise(id);
  state.exercise = id;
  state.repetitions = id === 'squat' ? 3 : 1;
  state.repetitionIndex = 0;
  state.phase = 0;
  const signature = signatureKey(rig.getBindingSignature?.());
  state.bindingStable = initialBindingSignature == null || signature === initialBindingSignature;
  rig.setBonesVisible(state.bones);
  rig.setHighlightEnabled(state.highlight);
  rig.setSupportHighlightEnabled(state.support);
  rig.setWireframe(state.wireframe);
  applyPhase(0);
  updateExerciseInfo();
  setPlaying(false);
  updateRigInfo();
  setView('oblique');
  setDetailView();
  renderNow();
}
function renderNow() {
  skeletonHelper?.updateMatrixWorld(true);
  full.controls.update();
  detail.controls.update();
  full.renderer.render(scene, full.camera);
  detail.renderer.render(scene, detail.camera);
}
let lastTime = -1;
function animate(time) {
  requestAnimationFrame(animate);
  if (document.hidden) return;
  if (state.playing && rig) {
    const next = playStartPhase + (time - playStart) / (state.duration * 1000);
    const finished = next >= state.repetitions;
    state.repetitionIndex = Math.min(state.repetitions - 1, Math.floor(next));
    applyPhase(finished ? 1 : next % 1);
    if (finished) setPlaying(false);
  }
  if (time - lastTime >= 30) { renderNow(); lastTime = time; }
}
requestAnimationFrame(animate);

$('play').addEventListener('click', () => setPlaying(!state.playing));
$('phase').addEventListener('input', event => { setPlaying(false); applyPhase(Number(event.target.value) / 1000); });
$('repetitions').addEventListener('change', event => {
  setPlaying(false);
  state.repetitions = Number(event.target.value);
  state.repetitionIndex = 0;
  applyPhase(0);
  updateExerciseInfo();
  setPlaying(false);
});
for (const button of document.querySelectorAll('[data-exercise]')) button.addEventListener('click', () => setExercise(button.dataset.exercise));
for (const button of document.querySelectorAll('[data-phase]')) button.addEventListener('click', () => { setPlaying(false); applyPhase(Number(button.dataset.phase)); });
for (const button of document.querySelectorAll('[data-view]')) button.addEventListener('click', () => { setView(button.dataset.view); renderNow(); });
$('highlight-enabled').addEventListener('change', event => { state.highlight = event.target.checked; rig?.setHighlightEnabled(state.highlight); renderNow(); });
$('support-enabled').addEventListener('change', event => { state.support = event.target.checked; rig?.setSupportHighlightEnabled(state.support); renderNow(); });
$('bones').addEventListener('change', event => { state.bones = event.target.checked; rig?.setBonesVisible(state.bones); renderNow(); });
$('appearance').addEventListener('change', event => { appearance?.setMode(event.target.value); renderNow(); });
$('wireframe').addEventListener('change', event => { state.wireframe = event.target.checked; rig?.setWireframe(state.wireframe); renderNow(); });
$('joints').addEventListener('change', event => { state.joints = event.target.checked; if (skeletonHelper) skeletonHelper.visible = state.joints; renderNow(); });

async function init() {
  rig = await createHumanRig({ onProgress(message) { $('loading-text').textContent = String(message); } });
  appearance = await createAppearanceLayer(rig, { onProgress(message) { $('loading-text').textContent = String(message); } });
  scene.add(rig.group);
  rig.group.traverse(object => { if (object.isMesh) { object.castShadow = true; object.receiveShadow = true; } });
  skeletonHelper = new THREE.SkeletonHelper(rig.group);
  skeletonHelper.visible = state.joints;
  skeletonHelper.material.depthTest = false;
  skeletonHelper.renderOrder = 10;
  scene.add(skeletonHelper);
  initialBindingSignature = signatureKey(rig.getBindingSignature?.());
  state.ready = true;
  window.veloraLab = {
    state, rig, appearance, scene, full, detail,
    setExercise,
    setPlaying,
    setPhase(phase) { setPlaying(false); applyPhase(phase); renderNow(); },
    setView(name) { setView(name); renderNow(); },
    renderNow,
    diagnostics(options) { return { ...rig.diagnostics, ...rig.inspectGeometry(options), bindingStable: state.bindingStable, exercise: state.exercise }; },
    setExportSize(width, height) {
      state.exportMode = true;
      full.renderer.setPixelRatio(1);
      full.renderer.setSize(width, height, false);
      full.camera.aspect = width / height;
      full.camera.updateProjectionMatrix();
      setView(state.view);
      renderNow();
    },
    restoreSize() {
      state.exportMode = false;
      full.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
      full.resize(); detail.resize(); renderNow();
    },
    screenshot() { renderNow(); return full.canvas.toDataURL('image/png'); },
  };
  setExercise(state.exercise);
  $('loading')?.remove();
  for (const control of document.querySelectorAll('.sidebar button, .sidebar input')) control.disabled = false;
  renderNow();
}
init().catch(error => {
  console.error(error);
  state.ready = false;
  $('loading')?.remove();
  $('error').hidden = false;
  $('error').textContent = '人体绑定载入失败：' + (error?.message || String(error)) + '。请刷新页面重试。';
  $('status').textContent = '载入失败';
});
