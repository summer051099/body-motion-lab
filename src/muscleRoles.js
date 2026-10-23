// Editorial categories for a standard push-up demonstration. These names are
// anatomical source-mesh names, not a prediction or measurement of activation.
// Primary muscles retain the original fourteen parts. Support includes only
// the specified shoulder-girdle and thoracolumbar/core stabilizing groups.
const bilateral = names => names.flatMap(name => ['left', 'right'].map(side => name.replace('{side}', side)));

export const PRIMARY_PUSHUP_MUSCLES = Object.freeze(bilateral([
  'abdominal part of {side} pectoralis major',
  'clavicular part of {side} pectoralis major',
  'sternocostal part of {side} pectoralis major',
  'clavicular part of {side} deltoid',
  'lateral head of {side} triceps brachii',
  'long head of {side} triceps brachii',
  'medial head of {side} triceps brachii',
]));

export const SUPPORT_PUSHUP_MUSCLE_GROUPS = Object.freeze(Object.fromEntries(Object.entries({
  serratusAnterior: ['{side} serratus anterior'],
  latissimusDorsi: ['{side} latissimus dorsi'],
  middleLowerTrapezius: ['transverse part of {side} trapezius', 'ascending part of {side} trapezius'],
  thoracolumbarErectors: [
    '{side} iliocostalis thoracis', '{side} iliocostalis lumborum',
    '{side} longissimus thoracis', '{side} spinalis thoracis',
  ],
  thoracolumbarMultifidus: ['{side} multifidus thoracis', '{side} multifidus lumborum'],
  abdominalWall: [
    '{side} rectus abdominis', '{side} external oblique',
    '{side} internal oblique', '{side} transversus abdominis',
  ],
}).map(([group, names]) => [group, Object.freeze(bilateral(names))])));

const primaryNames = new Set(PRIMARY_PUSHUP_MUSCLES);
const supportGroupsByName = new Map(Object.entries(SUPPORT_PUSHUP_MUSCLE_GROUPS)
  .flatMap(([group, names]) => names.map(name => [name, group])));
const normalizeName = name => String(name).replace(/_/g, ' ').toLowerCase().trim().replace(/\s+/g, ' ');
const connectiveTissue = /\b(tendon|ligament|retinaculum|membrane|aponeurosis)\b/;

// Exact source-name allowlists deliberately exclude cervical/head/neck
// erectors, descending trapezius, serratus posterior, and hand/toe muscles.
// An ambiguous source label such as "spinalis" is left neutral.
export function getPushupMuscleRole(name, { isBone = false, isTendon = false } = {}) {
  const normalized = normalizeName(name);
  if (isBone || isTendon || connectiveTissue.test(normalized)) return 'none';
  if (primaryNames.has(normalized)) return 'primary';
  if (supportGroupsByName.has(normalized)) return 'support';
  return 'none';
}

export function getPushupSupportGroup(name) {
  return supportGroupsByName.get(normalizeName(name)) || null;
}
