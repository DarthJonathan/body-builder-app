import fs from 'node:fs';
import crypto from 'node:crypto';

const input = process.argv[2] ?? '/private/tmp/bodybuilder-exercises.json';
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
  'reverse-crunch': 'Reverse_Crunch', 'hanging-leg-raise': 'Hanging_Leg_Raise'
};
const output = 'static/images/exercises';
fs.mkdirSync(output, { recursive: true });
const source = {};
let success = 0;
const entries = Object.entries(mapping);
for (let i = 0; i < entries.length; i += 5) {
  await Promise.all(entries.slice(i, i + 5).map(async ([localId, sourceId]) => {
    const record = records.find(r => r.id === sourceId);
    if (!record) { console.log(`No source record: ${sourceId}`); return; }
    const url = `https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises/${record.images[0]}`;
    source[localId] = {
      sourceId, sourceName: record.name, imageURL: url,
      sourceURL: `https://github.com/yuhonas/free-exercise-db/blob/main/exercises/${sourceId}.json`,
      instructions: record.instructions, licence: 'Unlicense',
      note: 'Preview demonstration. Variations may differ from the screenshot exercise.'
    };
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error('Not JPEG');
      fs.writeFileSync(`${output}/${localId}.jpg`, bytes);
      success++;
    } catch (e) { console.log(`Image unavailable for ${localId}: ${e.message}`); }
  }));
}
fs.writeFileSync('src/lib/exercise-guides.json', JSON.stringify(source, null, 2) + '\n');
fs.writeFileSync('static/images/exercise-provenance.json', JSON.stringify({
  source: 'https://github.com/yuhonas/free-exercise-db', imported: new Date().toISOString(),
  datasetSha256: crypto.createHash('sha256').update(raw).digest('hex'), licence: 'Unlicense',
  entries: Object.fromEntries(Object.entries(source).map(([id, value]) => [id, { ...value, instructions: undefined }]))
}, null, 2) + '\n');
console.log(`Imported ${success} exercise photographs and ${Object.keys(source).length} source guides.`);
