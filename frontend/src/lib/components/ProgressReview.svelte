<script lang="ts">
  import { ExternalLink, ArrowRight } from 'lucide-svelte';
  import type { ProgressReview } from '../domain';
  let { report, onworkout, onnutrition, onrefresh, refreshing=false }: {report:ProgressReview;onworkout:(id:string)=>void;onnutrition:()=>void;onrefresh:()=>void;refreshing?:boolean}=$props();
</script>
<div class="review" aria-label="Progress recommendations">
  <p class="muted">As of {report.asOf} · {report.programName || 'Choose a program to review training'}</p>
  <h3>Training</h3><p>{report.trainingSummary}</p>
  {#each report.training as item}
    <section class="review-card"><h4>{item.name}</h4><strong class="blue">{item.kind==='increase-load' ? 'Consider a load increase' : 'Review repeated difficult sets'}</strong><p>{item.message}</p>
      {#if item.suggestedLoadKg}<p>{item.observedLoadKg} kg → about {item.suggestedLoadKg} kg. Round to available equipment; the meaning of your logged weight stays the same.</p>{/if}
      <ul>{#each item.evidence as evidence}<li>{evidence}</li>{/each}</ul><small>Sessions: {item.dates.join(', ')}</small>
      <button class="quiet-link" onclick={()=>onworkout(item.workoutId)}>Review Workout <ArrowRight size={16}/></button>
    </section>
  {/each}
  <p class="muted">{report.adherence.completed} of {report.adherence.scheduled} scheduled workouts completed in the last {report.adherence.windowDays} days. Unscheduled sessions are considered for exercise progression.</p>
  <h3>Nutrition & weight trend</h3><section class="review-card"><p>{report.nutrition.message}</p>
    {#if report.nutrition.weeklyChangeKg!==undefined}<strong class="blue">{report.nutrition.weeklyChangeKg>0?'+':''}{report.nutrition.weeklyChangeKg} kg between weekly averages</strong>{/if}
    <ul>{#each report.nutrition.evidence as evidence}<li>{evidence}</li>{/each}</ul>
    {#if report.nutrition.averageLoggedCalories!==undefined}<p class="muted">Average recorded: {report.nutrition.averageLoggedCalories} kcal on qualifying log days. This may exclude unlogged food.</p>{/if}
    <button class="quiet-link" onclick={onnutrition}>Review Nutrition Targets <ArrowRight size={16}/></button>
  </section>
  <details><summary>How these suggestions work</summary><p>{report.policy}</p>{#each report.sources as source}<a href={source.url} target="_blank" rel="noopener noreferrer">{source.name}<ExternalLink size={14}/></a>{/each}</details>
  <button class="secondary-button" disabled={refreshing} onclick={onrefresh}>{refreshing?'Reviewing…':'Refresh Review'}</button>
</div>
<style>
  .review p{font-size:14px;line-height:1.55;margin:12px 0 20px}.review-card{padding:18px;border:1px solid #354356;border-radius:14px;margin:16px 0;background:#151d27}h3{font-size:20px;margin:24px 0 10px}h4{font-size:17px;margin:0 0 12px}.blue{color:#579aff}.muted,small{color:#9aa4b2}ul{padding-left:20px;font-size:13px;color:#b9c2d0;line-height:1.6}li{margin:8px 0}details{border-top:1px solid #354356;padding:18px 0;font-size:13px}summary{cursor:pointer}a{display:flex;gap:8px;align-items:center;color:#579aff;padding:9px 0}.quiet-link{background:none;border:0;display:flex;align-items:center;gap:10px;color:#579aff;padding:14px 0;font:inherit;font-size:14px}.secondary-button{width:100%;padding:15px;border:1px solid #579aff;border-radius:12px;background:#233148;color:#579aff;font-size:14px}button:disabled{opacity:.5}
</style>
