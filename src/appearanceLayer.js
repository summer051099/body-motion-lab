import * as THREE from 'three';
import { getExerciseMuscleRole } from './exerciseMuscles.js';

// A source-derived, closed exterior. Muscle IDs remain on the rendered surface;
// vertex colors are rebuilt only on a role/color change, never per animation frame.
export async function createAppearanceLayer(rig, { url = '/appearance/athlete-skin.json', onProgress = () => {} } = {}) {
  onProgress('正在读取完整运动员外观与肌群映射');
  const resolvedUrl = new URL(url, globalThis.location?.href || 'http://127.0.0.1:4173/');
  const metadata = await (await fetch(resolvedUrl)).json();
  const buffer = await (await fetch(new URL(metadata.binary, resolvedUrl))).arrayBuffer();
  const constructors = { Float32Array, Uint32Array, Uint16Array, Uint8Array };
  function array(descriptor) { return new constructors[descriptor.type](buffer, descriptor.offset, descriptor.length); }
  function attribute(descriptor) { return new THREE.BufferAttribute(array(descriptor), descriptor.itemSize); }
  const geometry = new THREE.BufferGeometry();
  for (const [name, descriptor] of Object.entries(metadata.attributes)) geometry.setAttribute(name, attribute(descriptor));
  geometry.setIndex(attribute(metadata.index));
  geometry.morphTargetsRelative = true;
  geometry.morphAttributes.position = metadata.morphs.map(attribute);
  geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: .83, metalness: 0, side: THREE.FrontSide });
  const colors = new Float32Array(geometry.attributes.position.count * 3);
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const mesh = rig.bindAppearanceGeometry(geometry, material);
  mesh.name = 'Velora source-derived athlete exterior';
  const group = new THREE.Group(); group.name = 'appearance-layer'; group.add(mesh); rig.group.add(group);
  let mode = 'athlete', exercise = 'pushup', enabled = true, support = true;
  const palette = { neutral: new THREE.Color('#bdb8b0'), primary: new THREE.Color('#bd302b'), support: new THREE.Color('#dfa09a') };
  const registry = metadata.registry;
  const ids = geometry.attributes.muscleIds, weights = geometry.attributes.muscleWeights;
  const rolePalette = [];
  function updateColors() {
    rolePalette[0] = palette.neutral;
    registry.forEach((name, i) => {
      const role = getExerciseMuscleRole(exercise, name);
      rolePalette[i + 1] = enabled && role === 'primary' ? palette.primary : enabled && support && role === 'support' ? palette.support : palette.neutral;
    });
    for (let i = 0; i < ids.count; i++) {
      let r = 0, g = 0, b = 0, sum = 0;
      for (let k = 0; k < 4; k++) {
        const w = weights.array[i * 4 + k];
        const color = rolePalette[Math.round(ids.array[i * 4 + k])] || palette.neutral;
        r += color.r * w; g += color.g * w; b += color.b * w; sum += w;
      }
      if (sum < 1e-8) { r = palette.neutral.r; g = palette.neutral.g; b = palette.neutral.b; }
      colors[i * 3] = r; colors[i * 3 + 1] = g; colors[i * 3 + 2] = b;
    }
    geometry.attributes.color.needsUpdate = true;
  }
  let bonesVisible = false;
  const originalSetBonesVisible = rig.setBonesVisible.bind(rig);
  rig.setBonesVisible = value => { bonesVisible = Boolean(value); originalSetBonesVisible(mode === 'anatomy' && bonesVisible); };
  const layer = {
    mesh, group, geometry, material, metadata,
    setMode(value) {
      mode = value === 'anatomy' ? 'anatomy' : 'athlete';
      group.visible = mode === 'athlete'; rig.musclesGroup.visible = mode === 'anatomy';
      originalSetBonesVisible(mode === 'anatomy' && bonesVisible);
      return mode;
    },
    getMode: () => mode,
    setPose(pose) {
      // All currently accepted clips are bilateral. The side-specific source
      // shape keys have been transferred to one coherent neutral exterior.
      const a = pose.arms?.left, l = pose.legs?.left;
      const values = [Math.sin((a?.elbowFlexion || 0) * .5) ** 2, .75 + .25 * (pose.depth || 0), Math.sin((l?.hipFlexion || 0) * .5) ** 2, Math.sin((l?.kneeFlexion || 0) * .5) ** 2, 0];
      for (let i = 0; i < mesh.morphTargetInfluences.length; i++) mesh.morphTargetInfluences[i] = values[i] || 0;
    },
    setHighlight(value) { ({ exercise, enabled, support } = value); updateColors(); },
    setColors(value = {}) { for (const key of Object.keys(palette)) if (value[key] !== undefined) palette[key].set(value[key]); updateColors(); },
    setWireframe(value) { material.wireframe = Boolean(value); },
    inspect({ stride = 1 } = {}) {
      const bounds = new THREE.Box3(), p = new THREE.Vector3(); let finite = true, samples = 0;
      for (let i = 0; i < geometry.attributes.position.count; i += stride) {
        mesh.getVertexPosition(i, p).applyMatrix4(mesh.matrixWorld); finite &&= p.toArray().every(Number.isFinite); bounds.expandByPoint(p); samples++;
      }
      return { finite, samples, min: bounds.min.toArray(), max: bounds.max.toArray(), vertices: geometry.attributes.position.count, triangles: geometry.index.count / 3, meshes: 1, mode };
    },
    dispose() { geometry.dispose(); material.dispose(); },
  };
  rig.attachAppearanceLayer(layer); layer.setMode('athlete');
  return layer;
}
