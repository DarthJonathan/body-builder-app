<script lang="ts">
  import { untrack } from 'svelte';
  import type { Program, ProgramDocument, ProgramTemplate } from '../domain';
  import { exercises, muscles } from '../catalogue';
  import bundled from '../program-library.json';
  import { documentFromProgram, MAX_PROGRAM_TEXT, parseProgramText, programFromDocument, sameProgramDocument } from '../program-documents';
  import ProgramGuide from './ProgramGuide.svelte';
  let { programs, templates, admin, initialText='', sharedReady=true, onimport, onpublish }: {
    programs: Program[]; templates: ProgramTemplate[]; admin: boolean; initialText?:string; sharedReady?:boolean;
    onimport:(document:ProgramDocument)=>Promise<string>;onpublish:(document:ProgramDocument,revision:number)=>Promise<string>;
  }=$props();
  let source=$state(untrack(()=>initialText)), selected=$state(''), target=$state('personal'), preview=$state<ProgramDocument|null>(null);
  let failure=$state(''), success=$state(''), busy=$state(false), lastSaved=$state('');
  let validatedText=$state('');
  let compiled=$derived.by(()=>{let n=0;return preview ? programFromDocument(preview,exercises,muscles,prefix=>`preview-${prefix}-${n++}`) : null;});
  let existing=$derived(preview ? (target==='shared' ? templates.find(p=>p.id===preview?.key) : programs.find(p=>p.details?.key===preview?.key)) : undefined);
  let changed=$derived(preview && existing ? !sameProgramDocument(documentFromProgram(existing),preview) : false);
  let versionError=$derived(preview && existing?.details && changed && preview.version<=existing.details.version ? `Increase version above ${existing.details.version} before updating this plan.` : '');
  let stale=$derived(source!==validatedText);
  let samples=bundled as ProgramDocument[];
  function invalidate(){preview=null;failure='';success='';lastSaved='';}
  function loadExample(){
    invalidate();
    if(selected.startsWith('personal:')) {const p=programs.find(p=>p.id===selected.slice(9));if(p)source=JSON.stringify(documentFromProgram(p),null,2);}
    else if(selected.startsWith('shared:')) {const p=templates.find(p=>p.id===selected.slice(7));if(p)source=JSON.stringify(documentFromProgram(p),null,2);}
    else {const p=samples.find(p=>p.key===selected);if(p)source=JSON.stringify(p,null,2);}
  }
  async function upload(event:Event){
    const input=event.currentTarget as HTMLInputElement,file=input.files?.[0];if(!file)return;
    invalidate();
    if(file.size>MAX_PROGRAM_TEXT){failure='Choose a JSON file under 128 KiB.';input.value='';return;}
    try{source=await file.text();selected='';}catch{failure='Could not read this file. Try pasting its text.';}input.value='';
  }
  function validate(){try{failure='';success='';preview=parseProgramText(source,new Set(exercises.map(e=>e.id)));validatedText=source;}catch(e){preview=null;failure=e instanceof Error?e.message:'Invalid program.';}}
  async function save(){
    if(!preview || stale || versionError || (target==='shared' && (!admin || !sharedReady)))return;
    const captured=JSON.parse(JSON.stringify(preview)) as ProgramDocument;busy=true;failure='';success='';
    try{success=target==='shared'?await onpublish(captured,(existing as ProgramTemplate|undefined)?.revision ?? 0):await onimport(captured);lastSaved=source+'|'+target;}
    catch(e){failure=e instanceof Error?e.message:'Could not save this plan.';}finally{busy=false;}
  }
  async function copy(){try{await navigator.clipboard.writeText(source);success='Program JSON copied.';}catch{failure='Clipboard access is unavailable. Select the JSON text to copy it, or download the file.';}}
  function download(){
    try{const doc=parseProgramText(source,new Set(exercises.map(e=>e.id)));const url=URL.createObjectURL(new Blob([JSON.stringify(doc,null,2)+'\n'],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=`${doc.key}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(e){failure=e instanceof Error?e.message:'Preview valid JSON before downloading.';}
  }
</script>
<div class="program-import">
  <p class="muted">Paste one JSON plan, upload a file, or load an example. Keep its <code>key</code> to update it; increase <code>version</code> when changing it.</p>
  <label for="plan-example">Load a plan or export your program</label>
  <select id="plan-example" bind:value={selected} onchange={loadExample} disabled={busy}><option value="">Choose an example or saved program</option><optgroup label="Generated plans">{#each samples as p}<option value={p.key}>{p.name}</option>{/each}</optgroup>{#if programs.length}<optgroup label="Your programs">{#each programs as p}<option value={`personal:${p.id}`}>{p.name}</option>{/each}</optgroup>{/if}{#if admin}<optgroup label="Shared library">{#each templates.filter(p=>p.details) as p}<option value={`shared:${p.id}`}>{p.name} · v{p.details?.version}</option>{/each}</optgroup>{/if}</select>
  <label for="plan-json-file">Upload JSON</label><input id="plan-json-file" type="file" accept=".json,application/json,text/plain" onchange={upload} disabled={busy}/>
  {#if admin}<label for="plan-destination">Save to</label><select id="plan-destination" bind:value={target} onchange={()=>{success='';lastSaved='';}} disabled={busy}><option value="personal">My personal programs</option><option value="shared">Shared starter library (admin)</option></select>{:else}<p class="muted">Imports are private to your account.</p>{/if}
  <label for="program-json">Program JSON</label><textarea id="program-json" bind:value={source} oninput={invalidate} rows="12" spellcheck="false" autocapitalize="off" autocomplete="off" disabled={busy} placeholder={'{ "schemaVersion": "bodybuilder.program.v1", ... }'}></textarea>
  <div class="text-actions"><button class="secondary-button" onclick={validate} disabled={busy || !source.trim()}>Validate & Preview</button><button class="quiet-link" onclick={copy} disabled={busy || !source}>Copy JSON</button><button class="quiet-link" onclick={download} disabled={busy || !source}>Download JSON</button></div>
  <details class="exercise-reference"><summary>Exercise ID reference ({exercises.length})</summary><p class="muted">Use these exact IDs in <code>exerciseId</code>.</p><ul>{#each exercises as exercise}<li><code>{exercise.id}</code><span>{exercise.name} · {exercise.equipment}</span></li>{/each}</ul></details>
  {#if failure}<p class="form-error" role="alert">{failure}</p>{/if}
  {#if preview && compiled}
    <section class="import-preview" aria-label="Program import preview"><p class="eyebrow">{existing?'UPDATE':'CREATE'} · {preview.key} · VERSION {preview.version}</p><ProgramGuide program={compiled}/>
      <p class="muted">{target==='shared'?'This template will be available to everyone. Existing personal copies retain their own prescriptions.':'This becomes your active private program. Assign its workouts from your schedule. Nutrition targets are set separately.'}</p>
      {#if versionError}<p class="form-error" role="alert">{versionError}</p>{/if}
      <button class="primary-button" onclick={save} disabled={busy || stale || !!versionError || (target==='shared' && !sharedReady) || lastSaved===source+'|'+target}>{busy?'Saving…':target==='shared'?'Publish Shared Plan':existing?'Update My Program':'Import My Program'}</button>
    </section>
  {/if}
  {#if success}<p class="import-success" role="status">{success}</p>{/if}
</div>
<style>
.program-import{overflow-wrap:anywhere}.program-import p{font-size:15px;line-height:1.5}.program-import label{display:block;margin:22px 0 9px;color:#bac3cf;font-size:15px}.program-import select,.program-import textarea,.program-import input{width:100%;min-width:0}.program-import textarea{font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre;overflow:auto;min-height:240px;padding:14px}.text-actions{display:flex;gap:10px;flex-wrap:wrap;margin:15px 0 22px}.text-actions button{font-size:14px;padding:10px 14px}.exercise-reference{border:1px solid #344253;border-radius:14px;padding:14px}.exercise-reference summary{cursor:pointer;font-size:14px;font-weight:600}.exercise-reference ul{list-style:none;padding:0;max-height:240px;overflow:auto}.exercise-reference li{font-size:12px;display:grid;gap:3px;margin:12px 0}.exercise-reference span{color:#aeb7c4}.program-import code{color:#8bb5ff;font-size:.9em}.import-preview{border-top:1px solid #344253;padding-top:24px;margin-top:24px}.import-preview>.primary-button{width:100%;margin-top:14px}.import-success{color:#7bc791;background:#172b23;border:1px solid #385c49;border-radius:12px;padding:14px}
</style>
