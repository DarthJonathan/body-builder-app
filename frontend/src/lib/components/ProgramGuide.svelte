<script lang="ts">
  import type { Program } from '../domain';
  import { exercises } from '../catalogue';
  let { program }: { program: Program }=$props();
</script>
<div class="plan-guide">
  <h3>{program.name}</h3>
  {#if program.details}
    <p class="muted">{program.details.description}</p>
    <p class="plan-meta">{program.details.daysPerWeek} days / week · about {program.details.sessionMinutes} minutes · {program.details.purpose}</p>
    <h4>Progression</h4><p>{program.details.progression.instructions}</p>
    <h4>When progress stalls</h4><p>{program.details.progression.stall}</p>
    <h4>Nutrition guidance</h4><p>{program.details.nutrition.instructions}</p>
    <p class="plan-meta">Starting defaults: {program.details.nutrition.proteinPerKg} g protein / kg · {program.details.nutrition.fatPercent}% of calories from fat. Personal targets remain editable.</p>
    <details><summary>Evidence & plan notes</summary><p class="muted">{program.details.notes}</p>{#each program.details.evidence as source}<p><a href={source.url} target="_blank" rel="noopener noreferrer">{source.title}</a></p>{/each}<small>Document {program.details.key} · version {program.details.version} · reviewed {program.details.reviewedAt}</small></details>
  {:else if program.adaptationNote}<p class="muted">{program.adaptationNote}</p>{/if}
  <h4>Workouts</h4>
  {#each program.workouts as workout}<details class="plan-workout"><summary>{workout.name} · {workout.exercises.length} exercises</summary><ol>{#each workout.exercises as rx}<li><b>{exercises.find(e=>e.id===rx.exerciseId)?.name ?? rx.exerciseId}</b><span>{rx.sets} sets · {rx.repsMin}–{rx.repsMax} {rx.seconds?'seconds':'reps'}{rx.perSide?' per side':''} · rest {rx.restSeconds}s{rx.amrapLast?' · last set AMRAP':''}{rx.superset?' · superset':''}</span></li>{/each}</ol><small>Warmup</small><ul>{#each workout.warmup as step}<li>{step}</li>{/each}</ul></details>{/each}
</div>
<style>
.plan-guide{overflow-wrap:anywhere}.plan-guide h3{font-size:24px;margin:0 0 12px}.plan-guide h4{font-size:18px;margin:24px 0 10px}.plan-guide p{line-height:1.55;font-size:15px}.plan-meta{color:var(--blue,#5798ff);font-size:14px!important}.plan-guide details{background:#141c25;border:1px solid #344253;border-radius:16px;padding:15px;margin:12px 0}.plan-guide summary{cursor:pointer;font-weight:600;font-size:15px;min-height:24px}.plan-guide a{color:var(--blue,#5798ff)}.plan-guide li{line-height:1.5;font-size:14px;margin:10px 0}.plan-guide li span{display:block;color:#aeb7c4}.plan-guide ol,.plan-guide ul{padding-left:22px}.plan-guide small{color:#aeb7c4}
</style>
