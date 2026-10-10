import fs from 'node:fs';
import crypto from 'node:crypto';

const args = process.argv.slice(2);
const input = args.find(arg => !arg.startsWith('--')) ?? '/private/tmp/bodybuilder-exercises.json';
const requestedIds = args.find(arg => arg.startsWith('--ids='))?.slice(6).split(',');
const sourceRef = args.find(arg => arg.startsWith('--ref='))?.slice(6) ?? 'main';
if (requestedIds && !/^[a-f0-9]{40}$/.test(sourceRef)) throw new Error('Scoped imports require --ref=<40-character commit SHA>.');
const raw = fs.readFileSync(input, 'utf8');
const records = JSON.parse(raw);
const mapping = {
  deadlift: 'Barbell_Deadlift', 'hip-thrust': 'Barbell_Hip_Thrust', 'reverse-lunge': 'Elevated_Back_Lunge',
  kickback: 'One-Legged_Cable_Kickback', 'machine-sit-up': 'Ab_Crunch_Machine', plank: 'Plank',
  pushup: 'Pushups', 'lat-pulldown': 'Wide-Grip_Lat_Pulldown', 'shoulder-press': 'Dumbbell_Shoulder_Press',
  'supported-row': 'Dumbbell_Incline_Row', 'lateral-raise': 'Cable_Seated_Lateral_Raise', 'preacher-curl': 'One_Arm_Dumbbell_Preacher_Curl',
  squat: 'Barbell_Squat', 'calf-raise': 'Calf_Press_On_The_Leg_Press_Machine', 'machine-abduction': 'Thigh_Abductor',
  'walking-lunge': 'Barbell_Walking_Lunge', 'dead-bug': 'Dead_Bug', 'flat-dumbbell-press': 'Dumbbell_Bench_Press',
  'cable-row': 'Seated_Cable_Rows', 'rear-delt-fly': 'Reverse_Flyes', 'tricep-extension': 'Seated_Triceps_Press',
  'romanian-deadlift': 'Romanian_Deadlift', 'split-squat': 'Split_Squat_with_Dumbbells', 'leg-curl': 'Seated_Leg_Curl',
  'leg-extension': 'Leg_Extensions', 'bench-press': 'Barbell_Bench_Press_-_Medium_Grip', 'barbell-row': 'Bent_Over_Barbell_Row',
  'overhead-press': 'Standing_Military_Press', chinup: 'Chin-Up', 'pec-deck': 'Butterfly',
  'triceps-pushdown': 'Triceps_Pushdown', 'cable-curl': 'Standing_Biceps_Cable_Curl', 'incline-press': 'Incline_Dumbbell_Press',
  'rack-pull': 'Rack_Pulls', 'military-press': 'Standing_Military_Press', 'machine-chest-press': 'Machine_Bench_Press',
  'machine-shoulder-press': 'Machine_Shoulder_Military_Press', 'dumbbell-curl': 'Dumbbell_Bicep_Curl',
  'triceps-dip': 'Dip_Machine', 'cable-crunch': 'Cable_Crunch', 'cable-pull-through': 'Pull_Through',
  'standing-calf-raise': 'Standing_Calf_Raises', 'seated-calf-raise': 'Seated_Calf_Raise',
  'dumbbell-rdl': 'Stiff-Legged_Dumbbell_Deadlift', 'leg-press': 'Leg_Press', 'hack-squat': 'Hack_Squat',
  hyperextension: 'Hyperextensions_Back_Extensions', 'weighted-sit-up': 'Decline_Crunch',
  'reverse-crunch': 'Reverse_Crunch', 'hanging-leg-raise': 'Hanging_Leg_Raise',
  'dumbbell-squat': 'Dumbbell_Squat', 'dumbbell-row': 'Bent_Over_Two-Dumbbell_Row',
  'dumbbell-lateral-raise': 'Side_Lateral_Raise', 'dumbbell-lunge': 'Dumbbell_Lunges',
  'standing-dumbbell-press': 'Standing_Dumbbell_Press', 'dumbbell-fly': 'Dumbbell_Flyes',
  'hammer-curl': 'Hammer_Curls', 'seated-dumbbell-extension': 'Seated_Triceps_Press',
  'dumbbell-step-up': 'Dumbbell_Step_Ups', 'one-arm-dumbbell-row': 'One-Arm_Dumbbell_Row',
  'dumbbell-rear-delt-fly': 'Reverse_Flyes', 'close-grip-dumbbell-press': 'Close-Grip_Dumbbell_Press',
  'good-morning': 'Good_Morning', 'bodyweight-kickback': 'Glute_Kickback', 'goblet-squat': 'Goblet_Squat',
  crunch: 'Crunches', 'glute-bridge': 'Butt_Lift_Bridge', 'lying-leg-raise': 'Flat_Bench_Lying_Leg_Raise',
  'face-pull': 'Face_Pull', 'barbell-curl': 'Barbell_Curl', 'skullcrusher': 'Lying_Triceps_Press',
  'incline-barbell-press': 'Barbell_Incline_Bench_Press_-_Medium_Grip', 'incline-dumbbell-curl': 'Incline_Dumbbell_Curl',
  'front-squat': 'Front_Barbell_Squat', 'barbell-lunge': 'Barbell_Lunge'
};
const notes = {
  'goblet-squat': 'Source demonstration uses a kettlebell.',
  'glute-bridge': 'Source demonstration shows repeated bridges. The glute template prescribes a hold at the top.',
  'lying-leg-raise': 'Source demonstration uses a flat bench.'
};
for (const id of requestedIds ?? []) if (!mapping[id]) throw new Error(`Unknown exercise mapping: ${id}`);
const entries = Object.entries(mapping).filter(([id]) => !requestedIds || requestedIds.includes(id));
for (const [localId, sourceId] of entries) {
  const record = records.find(r => r.id === sourceId);
  if (!record?.images?.[0] || !record.instructions?.length) throw new Error(`Missing source record for ${localId}: ${sourceId}`);
}
const output = 'static/images/exercises';
fs.mkdirSync(output, { recursive: true });
const guidePath = 'src/lib/exercise-guides.json';
const provenancePath = 'static/images/exercise-provenance.json';
const source = requestedIds ? JSON.parse(fs.readFileSync(guidePath, 'utf8')) : {};
const previousProvenance = requestedIds ? JSON.parse(fs.readFileSync(provenancePath, 'utf8')) : {};
let success = 0;
const failures = [];
for (let i = 0; i < entries.length; i += 5) {
  await Promise.all(entries.slice(i, i + 5).map(async ([localId, sourceId]) => {
    const record = records.find(r => r.id === sourceId);
    if (!record) { console.log(`No source record: ${sourceId}`); return; }
    const url = `https://raw.githubusercontent.com/yuhonas/free-exercise-db/${sourceRef}/exercises/${record.images[0]}`;
    source[localId] = {
      sourceId, sourceName: record.name, imageURL: url,
      sourceURL: `https://github.com/yuhonas/free-exercise-db/blob/${sourceRef}/exercises/${sourceId}.json`,
      instructions: record.instructions, licence: 'Unlicense',
      note: notes[localId] ?? (requestedIds ? 'Free Exercise DB demonstration.' : 'Preview demonstration. Variations may differ from the screenshot exercise.')
    };
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error('Not JPEG');
      fs.writeFileSync(`${output}/${localId}.jpg`, bytes);
      source[localId].imageSha256 = crypto.createHash('sha256').update(bytes).digest('hex');
      success++;
    } catch (e) { failures.push(localId); console.log(`Image unavailable for ${localId}: ${e.message}`); }
  }));
}
if (requestedIds && failures.length) throw new Error(`Scoped import failed for ${failures.join(', ')}; existing guide metadata was preserved.`);
const imported = new Date().toISOString();
const datasetSha256 = crypto.createHash('sha256').update(raw).digest('hex');
fs.writeFileSync(guidePath, JSON.stringify(source, null, 2) + '\n');
fs.writeFileSync(provenancePath, JSON.stringify({
  ...previousProvenance,
  source: 'https://github.com/yuhonas/free-exercise-db', imported: previousProvenance.imported ?? imported,
  datasetSha256: previousProvenance.datasetSha256 ?? datasetSha256, licence: 'Unlicense',
  imports: [...(previousProvenance.imports ?? []), { sourceRef, imported, datasetSha256, exerciseIds: entries.map(([id]) => id) }],
  entries: Object.fromEntries(Object.entries(source).map(([id, value]) => [id, { ...value, instructions: undefined }]))
}, null, 2) + '\n');
console.log(`Imported ${success} exercise photographs at ${sourceRef}; ${Object.keys(source).length} source guides retained.`);
