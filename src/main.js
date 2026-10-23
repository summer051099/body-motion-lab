import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createPushupRig } from './pushupRig.js';
import './pushup.css';
const $ = id => document.getElementById(id);
const state = { ready:false, phase:0, duration:3, playing:false, highlight:true, support:true, bones:true, wireframe:false, view:'oblique' };
const scene = new THREE.Scene();
scene.background = new THREE.Color('#ffffff');
scene.add(new THREE.HemisphereLight(0xffffff, 0x6e786a, 1.6));
const key = new THREE.DirectionalLight(0xffffff,3.2);
key.position.set(-1.5,4,2);key.castShadow=true;key.shadow.mapSize.set(2048,2048);
Object.assign(key.shadow.camera,{near:.2,far:10,left:-1.7,right:1.7,top:1.7,bottom:-1.7});
key.shadow.bias=-.00012;key.shadow.normalBias=.001;key.shadow.radius=3;scene.add(key);
const fill = new THREE.DirectionalLight(0xf1f6ed,1.25);fill.position.set(2,1.8,-2);scene.add(fill);
const floor = new THREE.Mesh(new THREE.PlaneGeometry(200,200),new THREE.ShadowMaterial({opacity:.15}));
floor.rotation.x=-Math.PI/2;floor.position.y=-.001;floor.receiveShadow=true;scene.add(floor);
function makeView(id,detail=false){
 const canvas=$(id),renderer=new THREE.WebGLRenderer({canvas,antialias:true,powerPreference:'high-performance',preserveDrawingBuffer:true});
 renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.03;renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
 const camera=new THREE.PerspectiveCamera(30,1,.02,100),controls=new OrbitControls(camera,canvas);
 controls.enableDamping=true;controls.minDistance=detail?.45:1.5;controls.maxDistance=detail?4:8;controls.target.set(0,.28,detail?.48:0);camera.position.set(detail?1.05:1.4,detail?.65:.72,detail?1.45:1.4);controls.update();
 const resize=()=>{const r=canvas.getBoundingClientRect();if(!r.width||!r.height)return;renderer.setSize(r.width,r.height,false);camera.aspect=r.width/r.height;camera.updateProjectionMatrix();};
 new ResizeObserver(resize).observe(canvas.parentElement);resize();return {canvas,renderer,camera,controls,resize};
}
const full=makeView('body-canvas'),detail=makeView('detail-canvas',true);let rig,skeletonHelper,playStart=0,playStartPhase=0;
function updateLabels(d){
 $('phase').value=String(Math.round(state.phase*1000));$('phase-value').textContent=Math.round(state.phase*100)+'%';$('elbow-value').textContent=d?Math.round(d.arms.right.elbowFlexionDeg)+'°':'—';
 $('cycle-value').textContent=(state.phase*state.duration).toFixed(2)+' / '+state.duration.toFixed(2)+' s';$('state-label').textContent=state.playing?'连续循环播放':'暂停 · 可以拖动检查';
 $('phase-name').textContent=state.phase<.035||state.phase>.965?'高位支撑':state.phase<.46?'控制下降':state.phase<.54?'最低位置':'推起复位';
 for(const b of document.querySelectorAll('[data-phase]'))b.classList.toggle('active',Math.abs(Number(b.dataset.phase)-state.phase)<.005);
}
function applyPhase(phase){state.phase=THREE.MathUtils.clamp(Number(phase),0,1);if(rig)updateLabels(rig.setPhase(state.phase));}
function setPlaying(value){state.playing=value;playStart=performance.now();playStartPhase=state.phase===1?0:state.phase;$('play').innerHTML=(value?'暂停动作':'播放完整动作')+' <span>'+state.duration+' s</span>';if(rig)updateLabels(rig.getPoseDiagnostics(false));}
function setView(name){state.view=name;const p={oblique:[1.4,.72,1.4],side:[2.6,.65,.05],front:[.02,.85,2.6],back:[1.6,2.35,-1.1],upper:[.85,.55,1.05]};full.controls.target.set(0,.27,name==='upper'?.48:0);full.camera.position.fromArray(p[name]||p.oblique);full.controls.update();for(const b of document.querySelectorAll('[data-view]'))b.classList.toggle('active',b.dataset.view===name);}
function renderNow(){if(skeletonHelper)skeletonHelper.updateMatrixWorld(true);full.controls.update();detail.controls.update();full.renderer.render(scene,full.camera);detail.renderer.render(scene,detail.camera);}
let lastTime=-1;
function animate(time){requestAnimationFrame(animate);if(document.hidden)return;if(state.playing&&rig)applyPhase((playStartPhase+(time-playStart)/(state.duration*1000))%1);if(time-lastTime>=30){renderNow();lastTime=time;}}
requestAnimationFrame(animate);
$('play').addEventListener('click',()=>setPlaying(!state.playing));$('phase').addEventListener('input',e=>{setPlaying(false);applyPhase(Number(e.target.value)/1000);});$('duration').addEventListener('change',e=>{state.duration=Number(e.target.value);setPlaying(false);});
for(const b of document.querySelectorAll('[data-phase]'))b.addEventListener('click',()=>{setPlaying(false);applyPhase(Number(b.dataset.phase));});
for(const b of document.querySelectorAll('[data-view]'))b.addEventListener('click',()=>setView(b.dataset.view));
$('highlight-enabled').addEventListener('change',e=>{state.highlight=e.target.checked;rig?.setHighlightEnabled(state.highlight);});$('support-enabled').addEventListener('change',e=>{state.support=e.target.checked;rig?.setSupportHighlightEnabled(state.support);});$('bones').addEventListener('change',e=>{state.bones=e.target.checked;rig?.setBonesVisible(state.bones);});$('wireframe').addEventListener('change',e=>{state.wireframe=e.target.checked;rig?.setWireframe(state.wireframe);});$('joints').addEventListener('change',e=>{if(skeletonHelper)skeletonHelper.visible=e.target.checked;});
async function init(){
 rig=await createPushupRig({onProgress:message=>{$('loading-text').textContent=message;}});scene.add(rig.group);rig.setBonesVisible(state.bones);rig.setHighlightEnabled(state.highlight);rig.setSupportHighlightEnabled(state.support);rig.group.traverse(m=>{if(m.isMesh){m.castShadow=true;m.receiveShadow=true;}});
 skeletonHelper=new THREE.SkeletonHelper(rig.group);skeletonHelper.visible=false;skeletonHelper.material.depthTest=false;skeletonHelper.renderOrder=10;scene.add(skeletonHelper);state.ready=true;applyPhase(0);
 const d=rig.getPoseDiagnostics(true);$('contact-value').textContent=(Math.min(d.handGeometry.left.minY,d.handGeometry.right.minY)*1000).toFixed(1)+' mm';$('loading').remove();$('status').textContent='主要 '+rig.diagnostics.activeMuscles.length+' 块 · 辅助 '+rig.diagnostics.supportMuscles.length+' 块';$('play').disabled=false;$('phase').disabled=false;
 window.pushupLab={state,rig,scene,full,detail,setPhase(p){setPlaying(false);applyPhase(p);renderNow();},setView(name){setView(name);renderNow();},renderNow,diagnostics(options){return {...rig.diagnostics,...rig.inspectGeometry(options)};},setExportSize(w,h){full.renderer.setPixelRatio(1);full.renderer.setSize(w,h,false);full.camera.aspect=w/h;full.camera.updateProjectionMatrix();renderNow();},restoreSize(){full.renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));full.resize();},screenshot(){renderNow();return full.canvas.toDataURL('image/png');}};
 renderNow();
}
init().catch(e=>{console.error(e);$('loading')?.remove();$('error').hidden=false;$('error').textContent='载入失败：'+e.message;$('status').textContent='载入失败';});
