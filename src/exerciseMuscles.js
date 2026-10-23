import { getPushupMuscleRole } from './muscleRoles.js';
// Deliberately limited, source-name categories for instructional visualization.
// These roles are not simulated force, EMG measurements or a complete roster.
const connective = /tendon|ligament|retinaculum|membrane|aponeurosis/;
export function getExerciseMuscleRole(exercise,name,{isBone=false,isTendon=false}={}) {
  const n=String(name).replace(/_/g,' ').toLowerCase();
  if(isBone||isTendon||connective.test(n))return 'none';
  if(exercise==='pushup')return getPushupMuscleRole(n);
  if(exercise==='squat'){
    if(/gluteus maximus|vastus (lateralis|medialis|intermedius)|rectus femoris/.test(n))return 'primary';
    if(/gluteus medius|adductor magnus|biceps femoris|semitendinosus|semimembranosus|gastrocnemius|soleus|rectus abdominis|external oblique|internal oblique|transversus abdominis|iliocostalis (thoracis|lumborum)|longissimus thoracis|multifidus (thoracis|lumborum)/.test(n))return 'support';
  }
  if(exercise==='curl'||exercise==='dumbbell-curl'){
    if(/biceps brachii|brachialis/.test(n)&&!/coracobrachialis/.test(n))return 'primary';
    if(/brachioradialis|supinator|pronator teres|flexor carpi|extensor carpi|rectus abdominis|external oblique|internal oblique|transversus abdominis/.test(n))return 'support';
  }
  return 'none';
}
