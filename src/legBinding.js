import * as THREE from 'three';
const clamp=THREE.MathUtils.clamp;
const smooth=(a,b,x)=>{const t=clamp((x-a)/(b-a),0,1);return t*t*(3-2*t);};
export const HIP_MUSCLES=/gluteus|obturator|piriformis|quadratus femoris|gemellus|tensor fasciae|iliacus|psoas major/;
export function anatomicalLegWeights(n,p,b,r,c,spine,base){
 const {x,y}=p,ax=Math.abs(x),top=b.max.y;
 if(/hallucis|pollicis|of .*foot|of .*hand/.test(n))return null;
 const hipMix=t=>[[spine.pelvis,1-t],[c.thigh,t]];
 if(/gluteus maximus/.test(n)){
  // Sacral and coccygeal origins stay on the pelvis, including the medial
  // lower fibres. Only the inferolateral insertion follows femur/IT tract.
  const insertion=clamp((ax-.02)/.125,0,1)*clamp((.92-y)/.25,0,1);
  return hipMix(insertion);
 }
 if(/gluteus medius|gluteus minimus/.test(n))return hipMix(smooth(.075,.14,ax)*(1-smooth(.785,.915,y)));
 if(/obturator|piriformis|quadratus femoris|gemellus/.test(n))return hipMix(smooth(.038,.125,ax));
 if(/tensor fasciae/.test(n))return hipMix(1-smooth(.76,.90,y));
 if(/iliacus|psoas major/.test(n)){
  const insertion=(1-smooth(.72,.84,y))*smooth(.035,.10,ax);
  return [...base.map(([i,w])=>[i,w*(1-insertion)]),[c.thigh,insertion]];
 }
 const quadriceps=/vastus|rectus femoris/.test(n);
 if(quadriceps){
  // Distal quadriceps tendon follows the patella; the actual distal patellar
  // ligament region reaches tibia. Vastus bellies remain on the femur.
  const femur=smooth(.395,.51,y),tibia=1-smooth(.305,.395,y);
  const pelvis=/rectus femoris/.test(n)?smooth(.79,.865,y):0;
  return [[c.thigh,femur*(1-pelvis)],[c.patella,(1-femur)*(1-tibia)*(1-pelvis)],[c.shin,(1-femur)*tibia*(1-pelvis)],[spine.pelvis,pelvis]];
 }
 if(/gastrocnemius|plantaris|popliteus/.test(n)){
  const femur=smooth(r.knee.y-.043,r.knee.y+.043,y);
  return [[c.thigh,femur],[c.shin,1-femur]];
 }
 if(/iliotibial tract/.test(n)){
  const pelvis=smooth(.82,.92,y),tibia=1-smooth(.325,.43,y);
  return [[spine.pelvis,pelvis],[c.thigh,(1-pelvis)*(1-tibia)],[c.shin,(1-pelvis)*tibia]];
 }
 if(/biceps femoris|semitendinosus|semimembranosus|sartorius|gracilis|adductor (brevis|longus|magnus|minimus)|pectineus/.test(n)){
  const t=clamp((y-b.min.y)/Math.max(.1,top-b.min.y),0,1);
  const crossesKnee=/biceps femoris|semitendinosus|semimembranosus|sartorius|gracilis|iliotibial tract/.test(n);
  const tibia=crossesKnee?(1-t)*(1-t):0;
  let pelvis=/short head/.test(n)?0:t*t;
  if(/adductor|pectineus/.test(n))pelvis*=1-smooth(.04,.11,ax);
  return [[spine.pelvis,pelvis],[c.thigh,(1-pelvis)*(1-tibia)],[c.shin,(1-pelvis)*tibia]];
 }
 return null;
}
