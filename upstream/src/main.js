import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { buildBody, highlightMaterial, selectedMaterial, boneMaterial } from './bodyBuilder.js';
import { MUSCLE_GROUPS } from './muscleData.js';

// ───────────── Highlight Colors ─────────────
// 8 preset colors for user-assigned part highlighting

const HIGHLIGHT_COLORS = [
  { name: 'Red',    hex: '#e74c3c' },
  { name: 'Orange', hex: '#e67e22' },
  { name: 'Yellow', hex: '#f1c40f' },
  { name: 'Green',  hex: '#2ecc71' },
  { name: 'Cyan',   hex: '#1abc9c' },
  { name: 'Blue',   hex: '#3498db' },
  { name: 'Purple', hex: '#9b59b6' },
  { name: 'Pink',   hex: '#e91e90' },
];

// Pre-create a MeshStandardMaterial for each highlight color (reusable)
const highlightColorMaterials = HIGHLIGHT_COLORS.map((c) => {
  return new THREE.MeshStandardMaterial({
    color: new THREE.Color(c.hex),
    roughness: 0.4,
    metalness: 0.0,
    emissive: new THREE.Color(c.hex).multiplyScalar(0.15),
    side: THREE.DoubleSide,
    flatShading: false,
  });
});

// ───────────── Scene Setup ─────────────

const canvas = document.getElementById('canvas3d');
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  alpha: false,
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.6;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1a1a2e);

const camera = new THREE.PerspectiveCamera(
  50,
  window.innerWidth / window.innerHeight,
  0.1,
  200
);
camera.position.set(0, 5, 35);

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.minDistance = 2;
controls.maxDistance = 100;
controls.target.set(0, 5, 0);
controls.enableZoom = false; // we handle zoom ourselves
controls.update();

// ───────────── Cursor-directed Zoom ─────────────
// Zooms toward the 3D point under the cursor instead of the orbit center.

const zoomRaycaster = new THREE.Raycaster();
const zoomMouse = new THREE.Vector2();

canvas.addEventListener('wheel', (event) => {
  event.preventDefault();

  // Normalize scroll delta across browsers
  const delta = -Math.sign(event.deltaY);
  const zoomSpeed = 0.04;

  // Current distance from camera to orbit target
  const offset = camera.position.clone().sub(controls.target);
  const dist = offset.length();

  // Don't zoom past limits
  if (delta > 0 && dist <= controls.minDistance) return;
  if (delta < 0 && dist >= controls.maxDistance) return;

  // Raycast from cursor into the scene
  zoomMouse.x = (event.clientX / window.innerWidth) * 2 - 1;
  zoomMouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
  zoomRaycaster.setFromCamera(zoomMouse, camera);

  // Try to find a 3D hit point under the cursor
  let hitPoint = null;
  const allTargets = [...muscleMeshes];
  if (skeletonGroup) {
    skeletonGroup.traverse((child) => {
      if (child.isMesh && child.visible) allTargets.push(child);
    });
  }
  const intersects = zoomRaycaster.intersectObjects(allTargets, false);
  if (intersects.length > 0) {
    hitPoint = intersects[0].point.clone();
  }

  // Zoom factor
  const factor = 1 - delta * zoomSpeed;
  const newDist = THREE.MathUtils.clamp(dist * factor, controls.minDistance, controls.maxDistance);

  if (hitPoint && delta > 0) {
    // Zooming in: shift orbit target toward the cursor hit point
    const shiftStrength = 0.15;
    controls.target.lerp(hitPoint, shiftStrength);
  }

  // Move camera along the offset direction
  offset.normalize().multiplyScalar(newDist);
  camera.position.copy(controls.target).add(offset);
  controls.update();
}, { passive: false });

// ───────────── Lighting ─────────────

const ambientLight = new THREE.AmbientLight(0x8088a0, 1.4);
scene.add(ambientLight);

const keyLight = new THREE.DirectionalLight(0xffeedd, 1.8);
keyLight.position.set(10, 20, 15);
keyLight.castShadow = true;
keyLight.shadow.mapSize.width = 2048;
keyLight.shadow.mapSize.height = 2048;
keyLight.shadow.camera.near = 1;
keyLight.shadow.camera.far = 60;
keyLight.shadow.camera.left = -20;
keyLight.shadow.camera.right = 20;
keyLight.shadow.camera.top = 30;
keyLight.shadow.camera.bottom = -20;
scene.add(keyLight);

const fillLight = new THREE.DirectionalLight(0x9999dd, 1.0);
fillLight.position.set(-10, 10, -10);
scene.add(fillLight);

const rimLight = new THREE.DirectionalLight(0xff6666, 0.5);
rimLight.position.set(0, 5, -20);
scene.add(rimLight);

const bottomLight = new THREE.DirectionalLight(0x778899, 0.6);
bottomLight.position.set(0, -10, 5);
scene.add(bottomLight);

// Hemisphere light for natural feel
const hemiLight = new THREE.HemisphereLight(0xbbddff, 0x553333, 0.8);
scene.add(hemiLight);

// Front fill light to ensure muscles facing camera are well-lit
const frontLight = new THREE.DirectionalLight(0xffffff, 0.8);
frontLight.position.set(0, 10, 20);
scene.add(frontLight);

// ───────────── Ground Grid ─────────────

const gridHelper = new THREE.GridHelper(60, 30, 0x333355, 0x222244);
gridHelper.position.y = -16;
scene.add(gridHelper);

// Ground plane for shadows
const groundGeo = new THREE.PlaneGeometry(60, 60);
const groundMat = new THREE.ShadowMaterial({ opacity: 0.3 });
const ground = new THREE.Mesh(groundGeo, groundMat);
ground.rotation.x = -Math.PI / 2;
ground.position.y = -16;
ground.receiveShadow = true;
scene.add(ground);

// ───────────── Loading Overlay ─────────────

const loadingOverlay = document.getElementById('loading-overlay');
const loadingBar = document.getElementById('loading-bar');
const loadingText = document.getElementById('loading-text');

function updateLoadingProgress(pct) {
  if (loadingBar) loadingBar.style.width = `${pct}%`;
  if (loadingText) loadingText.textContent = `Loading anatomy model... ${pct}%`;
}

function hideLoadingOverlay() {
  if (loadingOverlay) {
    loadingOverlay.style.opacity = '0';
    setTimeout(() => { loadingOverlay.style.display = 'none'; }, 500);
  }
}

// ───────────── Shared State ─────────────
// These are populated asynchronously after GLB loads
let muscleMeshes = [];
let skeletonGroup = null;
let bodyGroup = null;

// Computed camera framing — updated after model loads
let defaultCameraPos = new THREE.Vector3(0, 5, 35);
let defaultLookAt = new THREE.Vector3(0, 5, 0);

// Manually hidden parts
const hiddenMeshes = new Set();

// ───────────── Raycasting & Interaction ─────────────

const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
let hoveredMesh = null;
let selectedMesh = null;

canvas.addEventListener('mousemove', onMouseMove);
canvas.addEventListener('click', onClick);

function onMouseMove(event) {
  if (muscleMeshes.length === 0) return;

  mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
  mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

  raycaster.setFromCamera(mouse, camera);
  const visibleMeshes = muscleMeshes.filter(m => m.visible);
  const intersects = raycaster.intersectObjects(visibleMeshes, false);

  // Unhover previous
  if (hoveredMesh && hoveredMesh !== selectedMesh) {
    resetMeshAppearance(hoveredMesh);
  }

  if (intersects.length > 0) {
    const mesh = intersects[0].object;
    if (mesh !== selectedMesh) {
      hoveredMesh = mesh;
      highlightMesh(mesh, 0.3);
    }
    canvas.style.cursor = 'pointer';
  } else {
    hoveredMesh = null;
    canvas.style.cursor = 'default';
  }
}

function onClick(event) {
  if (muscleMeshes.length === 0) return;

  mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
  mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

  raycaster.setFromCamera(mouse, camera);
  const visibleMeshes = muscleMeshes.filter(m => m.visible);
  const intersects = raycaster.intersectObjects(visibleMeshes, false);

  // Deselect previous
  if (selectedMesh) {
    resetMeshAppearance(selectedMesh);
    selectedMesh = null;
  }

  if (intersects.length > 0) {
    const mesh = intersects[0].object;
    selectedMesh = mesh;
    highlightMesh(mesh, 0.6);
    showInfoPanel(mesh.userData);
  } else {
    hideInfoPanel();
  }
}

function highlightMesh(mesh, intensity) {
  // Swap to highlight or selected material (intensity > 0.5 = selected)
  if (intensity > 0.5) {
    mesh.material = selectedMaterial;
  } else {
    mesh.material = highlightMaterial;
  }
}

function resetMeshAppearance(mesh) {
  // If mesh has a custom highlight color, restore that; otherwise restore the group material
  if (mesh.userData.customMaterial) {
    mesh.material = mesh.userData.customMaterial;
  } else if (mesh.userData.originalMaterial) {
    mesh.material = mesh.userData.originalMaterial;
  }
}

// ───────────── Info Panel ─────────────

const infoPanel = document.getElementById('info-panel');
const infoName = document.getElementById('info-name');
const infoType = document.getElementById('info-type');
const infoDetails = document.getElementById('info-details');
const infoClose = document.getElementById('info-close');

infoClose.addEventListener('click', () => {
  hideInfoPanel();
  if (selectedMesh) {
    resetMeshAppearance(selectedMesh);
    selectedMesh = null;
  }
});

function showInfoPanel(userData) {
  const data = userData.muscleData;
  const info = data.info;

  infoName.textContent = userData.displayName;
  infoType.textContent = data.type;
  infoType.className = `badge ${data.type}`;

  let html = '';
  if (data.type === 'muscle') {
    html += `<p><strong>Group:</strong> ${MUSCLE_GROUPS[data.group]?.label || data.group}</p>`;
    html += `<p><strong>Origin:</strong> ${info.origin}</p>`;
    html += `<p><strong>Insertion:</strong> ${info.insertion}</p>`;
    html += `<p><strong>Action:</strong> ${info.action}</p>`;
    if (info.innervation) {
      html += `<p><strong>Innervation:</strong> ${info.innervation}</p>`;
    }
  } else {
    html += `<p><strong>Group:</strong> ${MUSCLE_GROUPS[data.group]?.label || data.group}</p>`;
    html += `<p><strong>From:</strong> ${info.origin}</p>`;
    html += `<p><strong>To:</strong> ${info.insertion}</p>`;
    html += `<p><strong>Function:</strong> ${info.action}</p>`;
    if (info.notes) {
      html += `<p><strong>Notes:</strong> ${info.notes}</p>`;
    }
  }

  infoDetails.innerHTML = html;

  // Build external reference links
  const infoLinks = document.getElementById('info-links');
  infoLinks.innerHTML = '';
  const searchTerm = getAnatomySearchTerm(data.rawName);
  const wikiUrl = `https://en.wikipedia.org/wiki/${encodeURIComponent(searchTerm.replace(/\s+/g, '_'))}_muscle`;
  const wikiSearchUrl = `https://en.wikipedia.org/w/index.php?search=${encodeURIComponent(searchTerm + ' muscle anatomy')}`;
  const kenHubUrl = `https://www.kenhub.com/en/search?q=${encodeURIComponent(searchTerm)}`;

  const wikiLink = document.createElement('a');
  wikiLink.href = wikiSearchUrl;
  wikiLink.target = '_blank';
  wikiLink.rel = 'noopener noreferrer';
  wikiLink.textContent = 'Wikipedia';
  infoLinks.appendChild(wikiLink);

  const kenHubLink = document.createElement('a');
  kenHubLink.href = kenHubUrl;
  kenHubLink.target = '_blank';
  kenHubLink.rel = 'noopener noreferrer';
  kenHubLink.textContent = 'Kenhub';
  infoLinks.appendChild(kenHubLink);

  infoPanel.classList.remove('hidden');

  // Update color picker swatch active states
  updateColorSwatchStates();
}

/**
 * Extract a clean anatomical search term from the raw BP3D mesh name.
 * Strips left/right, part qualifiers, and duplicate numbers.
 * e.g. "abdominal part of left pectoralis major" -> "pectoralis major"
 * e.g. "left gluteus maximus" -> "gluteus maximus"
 * e.g. "left calcaneal tendon" -> "calcaneal tendon"
 */
function getAnatomySearchTerm(rawName) {
  let term = rawName.toLowerCase()
    .replace(/\s*\(\d+\)\s*$/, '')            // remove (2), (3) etc
    .replace(/_/g, ' ')
    .replace(/\b(left|right)\b/g, '')          // remove left/right
    .replace(/\b\w+\s+part\s+of\s+/g, '')     // "abdominal part of" -> ""
    .replace(/\b\w+\s+head\s+of\s+/g, '')     // "long head of" -> ""
    .replace(/\b\w+\s+belly\s+of\s+/g, '')    // "anterior belly of" -> ""
    .replace(/\bset\s+of\b/g, '')              // "set of" -> ""
    .replace(/\s+/g, ' ')
    .trim();
  return term;
}

function hideInfoPanel() {
  infoPanel.classList.add('hidden');
}

// ───────────── Color Highlight Picker ─────────────

const colorSwatches = document.getElementById('color-swatches');
const btnClearColor = document.getElementById('btn-clear-color');

// Build swatch buttons once
HIGHLIGHT_COLORS.forEach((color, index) => {
  const swatch = document.createElement('div');
  swatch.className = 'color-swatch';
  swatch.style.backgroundColor = color.hex;
  swatch.title = color.name;
  swatch.dataset.colorIndex = index;

  swatch.addEventListener('click', () => {
    if (!selectedMesh) return;
    // Assign this highlight color material to the selected mesh
    selectedMesh.userData.customMaterial = highlightColorMaterials[index];
    selectedMesh.userData.customColorIndex = index;
    selectedMesh.material = highlightColorMaterials[index];
    updateColorSwatchStates();
  });

  colorSwatches.appendChild(swatch);
});

btnClearColor.addEventListener('click', () => {
  if (!selectedMesh) return;
  // Remove custom color, restore to selected material (since it's still selected)
  delete selectedMesh.userData.customMaterial;
  delete selectedMesh.userData.customColorIndex;
  selectedMesh.material = selectedMaterial;
  updateColorSwatchStates();
});

function updateColorSwatchStates() {
  const swatches = colorSwatches.querySelectorAll('.color-swatch');
  swatches.forEach((swatch) => {
    const idx = parseInt(swatch.dataset.colorIndex, 10);
    if (selectedMesh && selectedMesh.userData.customColorIndex === idx) {
      swatch.classList.add('active');
    } else {
      swatch.classList.remove('active');
    }
  });
}

// ───────────── Hide / Show Parts ─────────────

const btnHidePart = document.getElementById('btn-hide-part');
const hiddenPanel = document.getElementById('hidden-panel');
const hiddenCountSpan = document.getElementById('hidden-count');
const hiddenList = document.getElementById('hidden-list');
const btnShowAll = document.getElementById('btn-show-all');

function updateHiddenUI() {
  hiddenCountSpan.textContent = hiddenMeshes.size;
  if (hiddenMeshes.size > 0) {
    hiddenPanel.classList.remove('hidden');
  } else {
    hiddenPanel.classList.add('hidden');
  }

  // Rebuild the list
  hiddenList.innerHTML = '';
  for (const mesh of hiddenMeshes) {
    const li = document.createElement('li');

    const nameSpan = document.createElement('span');
    nameSpan.className = 'hidden-part-name';
    nameSpan.textContent = mesh.userData.displayName;
    nameSpan.title = mesh.userData.displayName;
    li.appendChild(nameSpan);

    const btn = document.createElement('button');
    btn.textContent = 'Show';
    btn.addEventListener('click', () => {
      hiddenMeshes.delete(mesh);
      updateMuscleVisibility();
      updateHiddenUI();
    });
    li.appendChild(btn);

    hiddenList.appendChild(li);
  }
}

btnHidePart.addEventListener('click', () => {
  if (!selectedMesh) return;

  hiddenMeshes.add(selectedMesh);
  selectedMesh.visible = false;
  resetMeshAppearance(selectedMesh);
  selectedMesh = null;
  hideInfoPanel();
  updateHiddenUI();
});

btnShowAll.addEventListener('click', () => {
  hiddenMeshes.clear();
  updateMuscleVisibility();
  updateHiddenUI();
});

// ───────────── UI Controls ─────────────

// Search
const searchInput = document.getElementById('search');
const searchResults = document.getElementById('search-results');

searchInput.addEventListener('input', () => {
  const query = searchInput.value.toLowerCase().trim();
  searchResults.innerHTML = '';

  if (query.length < 2 || muscleMeshes.length === 0) return;

  const matches = muscleMeshes.filter((m) =>
    m.userData.displayName.toLowerCase().includes(query)
  );

  for (const mesh of matches.slice(0, 10)) {
    const div = document.createElement('div');
    div.className = 'search-item';
    div.textContent = mesh.userData.displayName;
    div.addEventListener('click', () => {
      // Select this muscle
      if (selectedMesh) resetMeshAppearance(selectedMesh);
      selectedMesh = mesh;
      highlightMesh(mesh, 0.6);
      showInfoPanel(mesh.userData);
      searchInput.value = '';
      searchResults.innerHTML = '';

      // Zoom to muscle
      zoomToMesh(mesh);
    });
    searchResults.appendChild(div);
  }
});

function zoomToMesh(mesh) {
  mesh.geometry.computeBoundingBox();
  const box = mesh.geometry.boundingBox;
  const center = new THREE.Vector3();
  box.getCenter(center);
  mesh.localToWorld(center);

  // Scale zoom distance based on mesh size
  const size = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z);
  const zoomDist = Math.max(maxDim * 3, 8);

  // Camera approaches from current viewing direction
  const dir = new THREE.Vector3();
  camera.getWorldDirection(dir);
  const targetPos = center.clone().sub(dir.multiplyScalar(zoomDist));

  animateCamera(targetPos, center, 1000);
}

// Muscle group filters
const filterContainer = document.getElementById('muscle-group-filters');
const activeGroups = new Set(Object.keys(MUSCLE_GROUPS));

for (const [key, group] of Object.entries(MUSCLE_GROUPS)) {
  const btn = document.createElement('button');
  btn.className = 'filter-btn active';
  btn.textContent = group.label;
  btn.dataset.group = key;
  btn.style.borderColor = group.color;

  btn.addEventListener('click', () => {
    btn.classList.toggle('active');
    if (activeGroups.has(key)) {
      activeGroups.delete(key);
    } else {
      activeGroups.add(key);
    }
    updateMuscleVisibility();
  });

  filterContainer.appendChild(btn);
}

function updateMuscleVisibility() {
  for (const mesh of muscleMeshes) {
    if (hiddenMeshes.has(mesh)) {
      mesh.visible = false;
      continue;
    }
    const group = mesh.userData.muscleData.group;
    const isTendon = mesh.userData.muscleData.type === 'tendon';
    const tendonVisible = document.getElementById('toggle-tendons').checked;

    mesh.visible = activeGroups.has(group) && (!isTendon || tendonVisible);
  }
}

// View buttons
document.getElementById('btn-front').addEventListener('click', () => {
  const dist = defaultCameraPos.distanceTo(defaultLookAt);
  animateCamera(
    new THREE.Vector3(defaultLookAt.x, defaultLookAt.y, defaultLookAt.z + dist),
    defaultLookAt.clone(), 800
  );
});

document.getElementById('btn-back').addEventListener('click', () => {
  const dist = defaultCameraPos.distanceTo(defaultLookAt);
  animateCamera(
    new THREE.Vector3(defaultLookAt.x, defaultLookAt.y, defaultLookAt.z - dist),
    defaultLookAt.clone(), 800
  );
});

document.getElementById('btn-side').addEventListener('click', () => {
  const dist = defaultCameraPos.distanceTo(defaultLookAt);
  animateCamera(
    new THREE.Vector3(defaultLookAt.x + dist, defaultLookAt.y, defaultLookAt.z),
    defaultLookAt.clone(), 800
  );
});

document.getElementById('btn-reset').addEventListener('click', () => {
  animateCamera(defaultCameraPos.clone(), defaultLookAt.clone(), 800);
  // Reset all filters
  activeGroups.clear();
  Object.keys(MUSCLE_GROUPS).forEach((k) => activeGroups.add(k));
  document.querySelectorAll('.filter-btn').forEach((b) => b.classList.add('active'));
  document.getElementById('muscle-opacity-slider').value = 1;
  setMuscleOpacity(1);
  document.getElementById('skeleton-opacity-slider').value = 0.6;
  setSkeletonOpacity(0.6);
  // Restore all hidden parts
  hiddenMeshes.clear();
  updateHiddenUI();
  // Clear all custom highlight colors
  for (const mesh of muscleMeshes) {
    if (mesh.userData.customMaterial) {
      delete mesh.userData.customMaterial;
      delete mesh.userData.customColorIndex;
      mesh.material = mesh.userData.originalMaterial;
    }
  }
  if (selectedMesh) {
    resetMeshAppearance(selectedMesh);
    selectedMesh = null;
  }
  hideInfoPanel();
  updateMuscleVisibility();
});

function animateCamera(targetPosition, lookAtTarget, duration) {
  const startPosition = camera.position.clone();
  const startTarget = controls.target.clone();
  const startTime = performance.now();

  function update() {
    const elapsed = performance.now() - startTime;
    const t = Math.min(elapsed / duration, 1);
    // Ease in-out
    const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;

    camera.position.lerpVectors(startPosition, targetPosition, ease);
    controls.target.lerpVectors(startTarget, lookAtTarget, ease);
    controls.update();

    if (t < 1) requestAnimationFrame(update);
  }
  update();
}

// Toggle skeleton
document.getElementById('toggle-skeleton').addEventListener('change', (e) => {
  if (skeletonGroup) skeletonGroup.visible = e.target.checked;
});

// Toggle tendons
document.getElementById('toggle-tendons').addEventListener('change', () => {
  updateMuscleVisibility();
});

// Muscle opacity slider
document.getElementById('muscle-opacity-slider').addEventListener('input', (e) => {
  setMuscleOpacity(parseFloat(e.target.value));
});

// Skeleton opacity slider
document.getElementById('skeleton-opacity-slider').addEventListener('input', (e) => {
  setSkeletonOpacity(parseFloat(e.target.value));
});

function setMuscleOpacity(opacity) {
  // Since materials are shared, collect unique materials and set opacity once
  const seen = new Set();
  for (const mesh of muscleMeshes) {
    const mat = mesh.userData.originalMaterial;
    if (mat && !seen.has(mat)) {
      seen.add(mat);
      mat.opacity = opacity;
      mat.transparent = opacity < 1;
      mat.depthWrite = opacity >= 1;
    }
  }
  // Also update the active highlight/selected materials if in use
  highlightMaterial.opacity = opacity;
  highlightMaterial.transparent = opacity < 1;
  highlightMaterial.depthWrite = opacity >= 1;
  selectedMaterial.opacity = opacity;
  selectedMaterial.transparent = opacity < 1;
  selectedMaterial.depthWrite = opacity >= 1;
  // Also update custom highlight color materials
  for (const mat of highlightColorMaterials) {
    mat.opacity = opacity;
    mat.transparent = opacity < 1;
    mat.depthWrite = opacity >= 1;
  }
}

function setSkeletonOpacity(opacity) {
  boneMaterial.opacity = opacity;
  boneMaterial.transparent = opacity < 1;
  // depthWrite off when transparent to avoid z-fighting
  boneMaterial.depthWrite = opacity >= 1;
}

// ───────────── Resize ─────────────

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ───────────── Animation Loop ─────────────

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}

// Start animation loop immediately (renders scene even while loading)
animate();

// ───────────── Load Anatomy Model (Async) ─────────────

async function initBody() {
  try {
    updateLoadingProgress(0);

    const result = await buildBody((pct) => {
      updateLoadingProgress(pct);
    });

    bodyGroup = result.bodyGroup;
    muscleMeshes = result.muscleMeshes;
    skeletonGroup = result.skeletonGroup;

    scene.add(bodyGroup);

    // Make skeleton visible by default (matches HTML checked state)
    skeletonGroup.visible = true;

    // Compute bounding box of entire body for camera adjustment
    const bodyBox = new THREE.Box3().setFromObject(bodyGroup);
    const bodyCenter = bodyBox.getCenter(new THREE.Vector3());
    const bodySize = bodyBox.getSize(new THREE.Vector3());
    console.log('Body bounding box:', bodyBox.min.toArray().map(v => v.toFixed(1)), 'to', bodyBox.max.toArray().map(v => v.toFixed(1)));
    console.log('Body center:', bodyCenter.toArray().map(v => v.toFixed(1)), 'size:', bodySize.toArray().map(v => v.toFixed(1)));

    // Adjust camera to frame the model properly
    const maxDim = Math.max(bodySize.x, bodySize.y, bodySize.z);
    const fov = camera.fov * (Math.PI / 180);
    let cameraZ = (maxDim / 2) / Math.tan(fov / 2);
    cameraZ *= 1.3; // Add some padding

    // Adjust grid and ground to be at model's feet
    const feetY = bodyBox.min.y - 0.5;
    gridHelper.position.y = feetY;
    ground.position.y = feetY;

    // Update shadow camera to cover the model
    keyLight.shadow.camera.top = bodySize.y + 5;
    keyLight.shadow.camera.bottom = feetY;
    keyLight.shadow.camera.left = -bodySize.x;
    keyLight.shadow.camera.right = bodySize.x;
    keyLight.shadow.camera.far = maxDim * 3;
    keyLight.shadow.camera.updateProjectionMatrix();

    // Animate camera to frame the model
    const viewTarget = new THREE.Vector3(bodyCenter.x, bodyCenter.y, bodyCenter.z);
    const viewPos = new THREE.Vector3(bodyCenter.x, bodyCenter.y, bodyCenter.z + cameraZ);

    // Store computed defaults for view buttons
    defaultCameraPos = viewPos.clone();
    defaultLookAt = viewTarget.clone();

    animateCamera(viewPos, viewTarget, 1200);

    console.log(`Body Explorer: ${muscleMeshes.length} muscle/tendon meshes loaded`);

    hideLoadingOverlay();
  } catch (error) {
    console.error('Failed to load anatomy model:', error);
    if (loadingText) {
      loadingText.textContent = 'Failed to load anatomy model. Check console for details.';
      loadingText.style.color = '#e74c3c';
    }
  }
}

initBody();
