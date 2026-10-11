import { readFile, writeFile, mkdir } from 'node:fs/promises';
import ts from 'typescript';

// Derive the backend catalogue from the same pinned source as the UI, avoiding
// separately maintained template/exercise IDs. Preview workout/food fixtures
// deliberately stay out of the live catalogue.
const root = new URL('../', import.meta.url);
const source = await readFile(new URL('src/lib/catalogue.ts', root), 'utf8');
const guides = await readFile(new URL('src/lib/exercise-guides.json', root), 'utf8');
const documents = await readFile(new URL('src/lib/program-library.json',root),'utf8');
const helperSource=(await readFile(new URL('src/lib/program-documents.ts',root),'utf8')).replace(/import[^;]+from '\.\/domain';/g,'');
const helper=ts.transpileModule(`const id = () => { throw new Error('An ID factory is required for catalogue generation'); };\n${helperSource}`,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
const helperURL=`data:text/javascript;base64,${Buffer.from(helper).toString('base64')}`;
const standalone = source.replace(/import sourceGuides from[^;]+;/, `const sourceGuides = ${guides};`)
  .replace(/import programDocuments from[^;]+;/,`const programDocuments = ${documents};`)
  .replace(/import \{ templateFromDocument \} from[^;]+;/,`import { templateFromDocument } from '${helperURL}';`)
  .replace(/import type[^;]+;/g, '');
const compiled = ts.transpileModule(standalone, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
const catalogue = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
const target = new URL('../backend/catalogue/', root);
await mkdir(target, { recursive: true });
await writeFile(new URL('catalogue.json', target), JSON.stringify({ exercises: catalogue.exercises, muscles: catalogue.muscles, templates: catalogue.templates.filter(t=>!t.details), programDocuments: JSON.parse(documents), readings: catalogue.readings, foods: [], goalRules: JSON.parse(await readFile(new URL('src/lib/goal-rules.json', root), 'utf8')), expertRules: JSON.parse(await readFile(new URL('src/lib/expert-rules.json',root),'utf8')) }, null, 2) + '\n');
console.log(`Exported ${catalogue.exercises.length} exercise guides and ${catalogue.templates.length} starter templates. No personal/food fixtures exported.`);
