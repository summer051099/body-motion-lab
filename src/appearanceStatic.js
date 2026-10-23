import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import './appearanceStatic.css';
const scene = new THREE.Scene(); scene.background = new THREE.Color('#eae9e7');
scene.add(new THREE.HemisphereLight(0xffffff, 0xb7afa6, 2));
const key = new THREE.DirectionalLight(0xfffcf8, 3); key.position.set(-2,4,3); scene.add(key);
const fill = new THREE.DirectionalLight(0xf4f5fa, 1); fill.position.set(3,2,-2); scene.add(fill);
const model = new THREE.Group(); scene.add(model);
const views = []; const target = new THREE.Vector3(0,.855,.075);
const positions = { front: [0,.85,4], side:[4,.85,.075], back:[0,.85,-4], oblique:[3,.85,3.075] };
function reset(view) {
 const height = 1.77, aspect = view.canvas.clientWidth / view.canvas.clientHeight;
 view.camera.left=-height*aspect/2;view.camera.right=height*aspect/2;view.camera.top=height/2;view.camera.bottom=-height/2;
 view.camera.zoom=1;view.camera.position.fromArray(positions[view.id]);view.camera.lookAt(target);view.camera.updateProjectionMatrix();view.controls.target.copy(target);view.controls.update();view.render();
}
for(const id of ['front','side','back','oblique']){
 const canvas=document.getElementById(id), renderer=new THREE.WebGLRenderer({canvas,antialias:true,preserveDrawingBuffer:true});
 renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.0;
 const camera=new THREE.OrthographicCamera(-.4,.4,.915,-.915,.01,20);const controls=new OrbitControls(camera,canvas);controls.enableDamping=false;controls.minZoom=.6;controls.maxZoom=4;controls.target.copy(target);
 const view={id,canvas,renderer,camera,controls,render(){renderer.render(scene,camera)}};views.push(view);controls.addEventListener('change',()=>view.render());
 new ResizeObserver(()=>{const r=canvas.getBoundingClientRect();renderer.setSize(r.width,r.height,false);reset(view)}).observe(canvas.parentElement);
}
const render=()=>views.forEach(v=>v.render()); document.getElementById('reset').onclick=()=>views.forEach(reset);
async function load(url){
 const r=await fetch(url);if(!r.ok)throw Error('模型尚未生成：'+url);const data=await r.json();
 const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(data.positions,3));geometry.setAttribute('normal',new THREE.Float32BufferAttribute(data.normals,3));geometry.setIndex(data.indices);geometry.computeBoundingBox();
 const material=new THREE.MeshStandardMaterial({color:'#c4c0b9',roughness:.72,metalness:0});const mesh=new THREE.Mesh(geometry,material);mesh.name='Unified athlete appearance';
 model.clear();model.add(mesh);model.position.y=-geometry.boundingBox.min.y;
 document.getElementById('asset-name').textContent='静态外观对照';document.getElementById('geometry-info').textContent='1 个网格 · '+geometry.attributes.position.count.toLocaleString()+' 顶点';
 views.forEach(reset);render();return mesh;
}
const asset=new URLSearchParams(location.search).get('asset')||'/appearance/athlete-surface.json';
load(asset).then(mesh=>{window.veloraAppearance={scene,model,mesh,views,load,render,reset:()=>views.forEach(reset),asset};}).catch(error=>{document.getElementById('error').textContent=error.message});
