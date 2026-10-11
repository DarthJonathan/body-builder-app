<script lang="ts">
  import { tick, untrack } from 'svelte';
  import { ArrowLeft, X, GripVertical, CheckCircle2, Dumbbell, Calendar, Scale, Utensils, Heart, ExternalLink } from 'lucide-svelte';
  import type { AppSnapshot, CreateGoalPlan, GoalAnswers, GoalPreview, NutritionTargets, TargetCalculation, ProgramRecommendations, ProgramSelection } from '../domain';
  import { shiftDate } from '../domain';
  import { defaultDays, GOAL_SOURCES, validateGoalCreation, validateGoalAnswers, paceAdjustment, recommendedSplit } from '../goals';
  import { EXPERT_GOAL_VERSION, EXPERT_SOURCES, currentSelection, selectionEqual } from '../expert';
  import { calculateNutritionTargets } from '../nutrition';
  import { hasAppleHealth, readAppleHealth } from '../health';
  import { client } from '../client';
  import { exercises } from '../catalogue';

  let { snapshot, today, oncancel, oncreate }: { snapshot: AppSnapshot; today: string; oncancel: () => void; oncreate: (input: CreateGoalPlan) => Promise<void> } = $props();
  const initial = untrack(()=>structuredClone($state.snapshot(snapshot)));
  const initialToday = untrack(()=>today);
  const previous = initial.goalPlans?.at(-1)?.answers;
  const stored = previous?.nutrition ?? [...initial.targets].sort((a,b)=>b.effectiveDate.localeCompare(a.effectiveDate))[0]?.calculation?.input;
  const currentProgram = initial.programs.find(p=>p.id===initial.activeProgramId);
  const latestWeight = [...initial.weights].filter(w=>w.date<=initialToday).sort((a,b)=>b.date.localeCompare(a.date))[0]?.weight;
  let step = $state(0);
  let error = $state('');
  let saving = $state(false);
  let goal = $state<GoalAnswers['goal']>(initial.profile.goal);
  let experience = $state<GoalAnswers['experience']>(previous?.experience ?? 'beginner');
  let restrictions = $state<GoalAnswers['restrictions']>('none');
  let equipment = $state<GoalAnswers['equipment']>(previous?.equipment ?? 'full-gym');
  let days = $state(previous?.daysPerWeek ?? 3);
  let minutes = $state<GoalAnswers['sessionMinutes']>(previous?.sessionMinutes ?? 45);
  let focus = $state<GoalAnswers['focus']>(previous?.focus ?? 'balanced');
  let priority = $state<NonNullable<GoalAnswers['trainingPriority']>>(previous?.trainingPriority ?? 'hypertrophy');
  let recommendations = $state<ProgramRecommendations | null>(null);
  let selection = $state<ProgramSelection | undefined>();
  let split = $state<GoalAnswers['split']>(recommendedSplit(previous?.daysPerWeek ?? 3));
  let workoutDays = $state(defaultDays(previous?.daysPerWeek ?? 3));
  let nutritionExperience = $state<GoalAnswers['nutritionExperience']>(previous?.nutritionExperience ?? 'new');
  let age = $state<number | undefined>(stored?.age);
  let sex = $state<TargetCalculation['sex'] | ''>(stored?.sex ?? '');
  let height = $state<number | undefined>(stored?.heightCm);
  let weight = $state<number | undefined>(latestWeight || stored?.weightKg || initial.profile.startWeight || undefined);
  let activity = $state<TargetCalculation['activity'] | ''>(stored?.activity ?? '');
  let startDate = $state(initialToday);
  let pace = $state<GoalAnswers['pace']>('gentle');
  const cachedHealth = initial.healthEnergy && Date.now()-Date.parse(initial.healthEnergy.syncedAt)<86400000 ? initial.healthEnergy : undefined;
  let health = $state<AppSnapshot['healthEnergy']>(cachedHealth);
  let healthConsent = $state(false);
  let useHealth = $state(false);
  let healthBusy = $state(false);
  let healthMessage = $state('');
  let preview = $state<GoalPreview | null>(null);
  let targetDraft = $state<NutritionTargets | null>(null);
  let editTargets = $state(false);
  let schedulePolicy = $state<CreateGoalPlan['schedulePolicy']>('keep-existing');
  let draggedDay = $state<number | null>(null);
  let dropDay = $state<number | null>(null);
  const weekdays = ['MON','TUE','WED','THU','FRI','SAT','SUN'];
  const sections = ['Getting Started','Your Workout Plan','Your Workout Plan','Your Workout Plan','Your Workout Plan','Your Nutrition Plan','Your Nutrition Plan','Your Nutrition Plan','Your Nutrition Plan','Workout','Nutrition','Your Plan'];
  let heading = $state<HTMLHeadingElement>();
  let selectedMatch = $derived(recommendations?.matches.find(m=>selectionEqual(m.selection,selection)));
  let trainingPreview = $derived(restrictions==='keep-current' ? currentProgram : selectedMatch?.program);
  let estimate = $derived.by(() => { try {return calculateNutritionTargets(answers().nutrition,'goal-target-preview');} catch {return null;} });
  let calendarConflicts = $derived(snapshot.schedule.filter(s=>s.date>=startDate && s.date<shiftDate(startDate,28) && s.workoutId && !snapshot.sessions.some(w=>w.date===s.date)).length);
  function answers(): GoalAnswers {
    return { goal,startDate,experience,restrictions,equipment,daysPerWeek:days,sessionMinutes:minutes,focus,split,workoutDays:[...workoutDays],nutritionExperience,pace,trainingPriority:priority,programSelection:selection ? $state.snapshot(selection) : undefined,
      nutrition:{ age:age!, sex:sex as TargetCalculation['sex'], heightCm:height!, weightKg:weight!, activity:activity as TargetCalculation['activity'], goal,effectiveDate:startDate,calorieAdjustment:paceAdjustment(goal,pace),proteinPerKg:trainingPreview?.details?.nutrition.proteinPerKg ?? stored?.proteinPerKg ?? 1.6,fatPercent:trainingPreview?.details?.nutrition.fatPercent ?? stored?.fatPercent ?? 25,
      ...(useHealth && health && (!hasAppleHealth() || healthConsent) ? {healthEnergy:$state.snapshot(health)} : {}) } };
  }
  function changeDays(next: number) {days=next;split=recommendedSplit(next);workoutDays=defaultDays(next);}
  function swapDays(from: number,to: number) {workoutDays=workoutDays.map(d=>d===from ? to : d===to ? from : d);}
  function dragStart(event: PointerEvent,day: number) {event.preventDefault();draggedDay=day;dropDay=day;event.currentTarget instanceof HTMLElement && event.currentTarget.setPointerCapture(event.pointerId);}
  function dragMove(event: PointerEvent) { if(draggedDay===null)return;const el=document.elementFromPoint(event.clientX,event.clientY)?.closest<HTMLElement>('[data-goal-day]');dropDay=el ? Number(el.dataset.goalDay) : null; }
  function dragEnd() {if(draggedDay!==null && dropDay!==null)swapDays(draggedDay,dropDay);draggedDay=null;dropDay=null;}
  async function moveStep(next: number) {step=next;error='';window.scrollTo(0,0);await tick();heading?.focus();}
  async function next() {
    if(saving)return;error='';
    try {
      if(step===1 && restrictions==='keep-current' && !currentProgram)throw new Error('Choose no restrictions to build a starting plan, or add an individually suitable program first.');
      if(step===2) {
        saving=true;preview=null;targetDraft=null;
        if(restrictions==='keep-current' && currentProgram) {selection=await currentSelection(currentProgram);recommendations=null;}
        else {recommendations=await client.recommendPrograms({goal,experience,equipment,daysPerWeek:days,sessionMinutes:minutes,focus,trainingPriority:priority});selection=recommendations.matches[0]?.selection;}
      }
      if(step===3 && !selection)throw new Error('No eligible plan is selected. Go back to change your training days, time or equipment, or cancel to import a suitable program.');
      if(step===6) {if(startDate<today || startDate>shiftDate(today,28))throw new Error('Choose today or a start date within the next 28 days.'); validateGoalAnswers(answers());calculateNutritionTargets(answers().nutrition,'goal-target-preview');}
      if(step===8) {saving=true;const result=await client.previewGoalPlan(answers());preview=result;targetDraft=structuredClone(result.targets);editTargets=false;}
      if(step===10 && targetDraft) {if(editTargets){targetDraft.mode='manual';targetDraft.manuallyOverridden=true;}validateGoalCreation({version:EXPERT_GOAL_VERSION,answers:answers(),targets:$state.snapshot(targetDraft),schedulePolicy},currentProgram,preview ?? undefined);}
      if(step===11) {if(!preview || !targetDraft)throw new Error('Preview your plan first.');saving=true;await oncreate({version:EXPERT_GOAL_VERSION,answers:answers(),targets:$state.snapshot(targetDraft),schedulePolicy});return;}
      await moveStep(step+1);
    } catch(e){error=e instanceof Error ? e.message : 'Could not prepare your plan. Try again.';} finally {saving=false;}
  }
  async function syncHealth() {
    if(!healthConsent || healthBusy)return;healthBusy=true;healthMessage='';
    try {health=await readAppleHealth();useHealth=true;healthMessage=`${health.days.length} complete days read. Your data is saved to your private account only when you create the plan.`;}
    catch(e){useHealth=false;health=undefined;healthMessage=e instanceof Error ? e.message : 'Apple Health could not be read. Use the equation estimate.';}
    finally {healthBusy=false;}
  }
</script>

<main class="goal-wizard" aria-label="Create a goal plan" aria-busy={saving}>
  <header><button aria-label={step===0 ? 'Back to Progress' : 'Previous question'} onclick={()=>step===0 ? oncancel() : moveStep(step-1)} disabled={saving}><ArrowLeft size={25}/></button><strong>{sections[step]}</strong><button aria-label="Cancel goal setup" onclick={oncancel} disabled={saving}><X size={22}/></button></header>
  <div class="goal-progress" role="progressbar" aria-label="Goal setup progress" aria-valuemin={0} aria-valuemax={12} aria-valuenow={step+1}><span style={`width:${(step+1)/12*100}%`}></span></div>
  <div class="goal-content">
  {#if step===0}
    <h1 bind:this={heading} tabindex="-1"><span>{snapshot.profile.displayName.split(' ')[0]},</span> what’s your goal right now?</h1>
    <p>This helps us build a starting plan for you. You can always change it later.</p>
    <div class="choices" role="radiogroup" aria-label="Your goal">{#each [{value:'lose-fat',name:'Get Lean / Lose Fat',note:'Lose fat while supporting muscle and strength.'},{value:'build-muscle',name:'Build Muscle',note:'Build muscle and improve your strength.'},{value:'maintain',name:'Maintain',note:'Maintain weight while improving fitness.'}] as option}<label class:selected={goal===option.value}><input type="radio" name="goal" value={option.value} bind:group={goal}/><div><strong>{option.name}</strong><small>{option.note}</small></div></label>{/each}</div>
  {:else if step===1}
    <h1 bind:this={heading} tabindex="-1">Where are you starting?</h1><p>Choose the experience that best describes your recent, consistent training.</p>
    <div class="choices" role="radiogroup" aria-label="Training experience">{#each [{value:'beginner',name:'Beginner',note:'New to lifting or returning after a long break.'},{value:'intermediate',name:'Intermediate',note:'Training consistently and comfortable with the main movements.'},{value:'advanced',name:'Experienced',note:'Several years of consistent, structured training.'}] as option}<label class:selected={experience===option.value}><input type="radio" name="experience" value={option.value} bind:group={experience}/><div><strong>{option.name}</strong><small>{option.note}</small></div></label>{/each}</div>
    <fieldset><legend>Any current exercise restrictions?</legend><label class="inline-choice"><input type="radio" name="restrictions" value="none" bind:group={restrictions}/>No restrictions on my exercise selection</label><label class="inline-choice"><input type="radio" name="restrictions" value="keep-current" bind:group={restrictions} disabled={!currentProgram}/>Keep my current, individually suitable workouts</label></fieldset><p class="fine-print">If an injury or health condition limits exercise, retain a suitable program rather than generating a general routine. Your answers are not a medical assessment.</p>
  {:else if step===2}
    <h1 bind:this={heading} tabindex="-1">Make room for your workouts.</h1><p>More isn’t always better. Pick a schedule you can follow consistently.</p>
    <fieldset><legend>Days per week</legend><div class="segments">{#each [2,3,4,5,6] as count}<button class:selected={days===count} aria-pressed={days===count} onclick={()=>changeDays(count)}>{count}</button>{/each}</div></fieldset>
    <fieldset><legend>Time per session</legend><div class="segments">{#each [30,45,60] as time}<button class:selected={minutes===time} aria-pressed={minutes===time} onclick={()=>minutes=time as GoalAnswers['sessionMinutes']}>{time} min</button>{/each}</div></fieldset>
    <fieldset><legend>Available equipment</legend><div class="choices compact"><label class:selected={equipment==='full-gym'}><input type="radio" name="equipment" value="full-gym" bind:group={equipment}/><div><strong>Full Gym</strong><small>Barbells, dumbbells, benches, cables and machines.</small></div></label><label class:selected={equipment==='dumbbells'}><input type="radio" name="equipment" value="dumbbells" bind:group={equipment}/><div><strong>Dumbbells & Bench</strong><small>A pair of dumbbells and an adjustable bench.</small></div></label></div></fieldset>
    <label for="training-priority">Training priority</label><select id="training-priority" bind:value={priority}><option value="hypertrophy">Muscle growth</option><option value="strength">Strength in the main lifts</option><option value="general">General fitness</option></select>
    <label for="goal-focus">Muscle focus</label><select id="goal-focus" bind:value={focus}><option value="balanced">Balanced full body</option><option value="glutes">Glutes, with balanced upper-body training</option></select>
  {:else if step===3}
    <h1 bind:this={heading} tabindex="-1">Recommended Programs</h1>
    {#if restrictions==='keep-current'}
      <div class="summary-card"><strong>Keep {currentProgram?.name}</strong><p>Your existing exercises stay intact. You identified this program as individually suitable; we do not infer suitability from the questionnaire.</p></div>
    {:else if recommendations}
      <p>{recommendations.explanation}</p>
      <div class="choices compact" role="radiogroup" aria-label="Eligible programs">
        {#each recommendations.matches as match,index}
          <label class:selected={selectionEqual(selection,match.selection)}><input type="radio" name="recommended-program" checked={selectionEqual(selection,match.selection)} onchange={()=>selection=match.selection} aria-label={match.program.name}/><div>{#if index===0}<small class="recommended">BEST PREFERENCE MATCH</small>{/if}<strong>{match.program.name}</strong><small>{match.score}/100 preference fit · {match.selection.scope==='personal' ? 'Your private program' : 'Starter library'}</small></div></label>
        {/each}
      </div>
      {#if selectedMatch}<section class="summary-card" aria-label="Selected program explanation"><h2>Why this plan?</h2>{#each selectedMatch.reasons as reason}<p>{reason}</p>{/each}{#each selectedMatch.differences as difference}<p>{difference}</p>{/each}<details><summary>Preview workouts</summary>{#each selectedMatch.program.workouts as workout}<p>{workout.name} · {workout.exercises.length} exercises</p>{/each}</details></section>{/if}
      <details class="evidence"><summary>Matching rules & excluded plans</summary><p>{recommendations.policy}</p>{#each recommendations.excluded as excluded}<p><strong>{excluded.name}</strong><br/>{excluded.reasons.join(' ')}</p>{/each}</details>
    {/if}
  {:else if step===4}
    <h1 bind:this={heading} tabindex="-1">Ready?</h1><p>Here is your weekly workout schedule. Drag the handles to move days, or use the day selector.</p>
    <div class="goal-schedule">{#each weekdays as day,index}<div class="schedule-row" data-goal-day={index} class:drop-target={dropDay===index && draggedDay!==null}><b>{day}</b><div class:rest={workoutDays.indexOf(index)<0}><strong>{workoutDays.indexOf(index)<0 ? 'Rest' : trainingPreview?.workouts[workoutDays.indexOf(index) % (trainingPreview?.workouts.length || 1)]?.name}</strong>{#if workoutDays.indexOf(index)>=0}<select aria-label={`Day for workout ${workoutDays.indexOf(index)+1}`} value={index} onchange={(e)=>swapDays(index,Number(e.currentTarget.value))}>{#each weekdays as label,weekday}<option value={weekday}>{label}</option>{/each}</select>{/if}<button class="drag-handle" aria-label={`Move ${day} schedule`} onpointerdown={(e)=>dragStart(e,index)} onpointermove={dragMove} onpointerup={dragEnd} onpointercancel={()=>{draggedDay=null;dropDay=null;}} onkeydown={(e)=>{if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();swapDays(index,(index+(e.key==='ArrowDown'?1:6))%7);}}}><GripVertical size={21}/></button></div></div>{/each}</div><p class="fine-print">Arrow keys also move a focused handle. The week repeats for the first four weeks; you can edit dates later.</p>
  {:else if step===5}
    <h1 bind:this={heading} tabindex="-1">How familiar are you with nutrition?</h1><div class="choices" role="radiogroup" aria-label="Nutrition experience">{#each [{value:'new',name:'I’m new to nutrition tracking',note:'Show me how to get started.'},{value:'familiar',name:'I know the basics',note:'I understand protein, carbs and fats.'},{value:'confident',name:'I’m confident tracking my food',note:'I can work with calorie and macro targets.'}] as option}<label class:selected={nutritionExperience===option.value}><input type="radio" name="nutrition" value={option.value} bind:group={nutritionExperience}/><div><strong>{option.name}</strong><small>{option.note}</small></div></label>{/each}</div><p class="fine-print">This changes the guidance you see, not your calorie calculation.</p>
  {:else if step===6}
    <h1 bind:this={heading} tabindex="-1">Your starting body stats.</h1><p>These inputs estimate resting energy and maintenance calories. HealthKit energy can replace that estimate in the next step.</p>
    <form id="goal-body-form" onsubmit={(e)=>{e.preventDefault();next();}}><div class="form-grid"><div><label for="goal-age">Age</label><input id="goal-age" type="number" min="18" max="100" step="1" bind:value={age} required/></div><div><label for="goal-sex">Equation sex</label><select id="goal-sex" bind:value={sex} required><option value="" disabled>Choose</option><option value="female">Female</option><option value="male">Male</option></select></div><div><label for="goal-height">Height (cm)</label><input id="goal-height" type="number" min="100" max="250" step="any" bind:value={height} required/></div><div><label for="goal-weight">Weight (kg)</label><input id="goal-weight" type="number" min="30" max="350" step="any" bind:value={weight} required/></div></div><label for="goal-activity">Usual activity, including exercise</label><select id="goal-activity" bind:value={activity} required><option value="" disabled>Choose</option><option value="sedentary">Mostly sitting · low activity</option><option value="light">Lightly active</option><option value="moderate">Moderately active</option><option value="active">Very active</option><option value="very-active">Extremely active</option></select><label for="goal-start">Goal start date</label><input id="goal-start" type="date" min={today} max={shiftDate(today,28)} bind:value={startDate} required/></form><p class="fine-print">The resting-energy equation was developed for adults. Equation sex is a formula input; it is not your gender identity. All weights are stored in kg.</p>
  {:else if step===7}
    <h1 bind:this={heading} tabindex="-1">Your starting energy estimate.</h1>
    {#if estimate}<div class="energy-numbers"><div><Scale size={23}/><span>Resting energy<strong>{estimate.calculation?.restingCalories} <small>kcal/day</small></strong></span></div><div><Heart size={23}/><span>Maintenance calories<strong>{estimate.calculation?.maintenanceCalories} <small>kcal/day</small></strong></span></div></div>{/if}
    <p>Resting energy powers basic body functions. Maintenance includes activity. These are estimates; your weight trend and food log help you review them.</p>
    <section class="summary-card"><h2>Apple Health</h2>{#if hasAppleHealth()}<p>Read the last 14 completed days of resting and active energy. At least seven days with 90% resting-energy time coverage are needed.</p><label class="inline-choice"><input type="checkbox" bind:checked={healthConsent} onchange={(e)=>{if(!e.currentTarget.checked)useHealth=false;}}/>I agree to use these energy summaries and sync them to my private BodyBuilder account when I create the plan.</label><button class="secondary-button" disabled={!healthConsent || healthBusy} onclick={syncHealth}>{healthBusy ? 'Reading Apple Health…' : 'Connect Apple Health'}</button>{#if health}<label class="inline-choice"><input type="checkbox" bind:checked={useHealth} disabled={!healthConsent}/>Use Apple Health energy for this plan</label><p class="fine-print">{health.sources.join(', ')} · {health.days[0].date} to {health.days.at(-1)?.date}. No activity multiplier is added.</p>{/if}{:else}<p>Direct sync is available in the BodyBuilder iPhone app. In the PWA, we use your body stats and activity level.</p>{#if health}<label class="inline-choice"><input type="checkbox" bind:checked={useHealth}/>Use the recent Apple Health summary saved to my account</label><p class="fine-print">{health.days.length} complete days · synced {new Date(health.syncedAt).toLocaleString()}</p>{/if}{/if}{#if healthMessage}<p role="status" class="fine-print">{healthMessage}</p>{/if}</section>
  {:else if step===8}
    <h1 bind:this={heading} tabindex="-1">Choose a starting pace.</h1><p>{goal==='build-muscle' ? 'A small calorie surplus supports your training while limiting unnecessary fat gain.' : goal==='lose-fat' ? 'Use a modest deficit alongside resistance training. Review your weight trend, energy and recovery.' : 'We’ll start near estimated maintenance calories.'}</p>
    <div class="choices" role="radiogroup" aria-label="Goal pace">{#each (goal==='maintain' ? ['gentle'] : ['gentle','moderate']) as option}<label class:selected={pace===option}><input type="radio" name="pace" value={option} bind:group={pace}/><div><strong>{goal==='maintain' ? 'Maintain' : option==='gentle' ? 'Gentle' : 'Moderate'}</strong><small>{paceAdjustment(goal,option as GoalAnswers['pace'])} kcal per day from maintenance</small></div></label>{/each}</div><p class="fine-print">This is a starting adjustment, not a promise of weekly fat loss or muscle gain. You can override the targets next.</p>
  {:else if step===9 && preview}
    <h1 bind:this={heading} tabindex="-1">Your personal approach to <span>{goal==='build-muscle' ? 'building muscle' : goal==='lose-fat' ? 'losing fat' : 'maintenance'}.</span></h1><p>Review the starting workouts. You can edit every exercise and prescription after creating the plan.</p>
    <div class="summary-card"><h2>{preview.program.name}</h2><p><Dumbbell size={19}/> {experience} · {days} days/week · {minutes} minute budget</p><p>{equipment==='full-gym' ? 'Full gym' : 'Dumbbells & adjustable bench'} · {focus==='glutes' ? 'Glute emphasis' : 'Balanced focus'}</p></div>
    {#each preview.program.workouts as workout}<details class="workout-detail"><summary>{workout.name}<small>{workout.exercises.length} exercises</small></summary>{#each workout.exercises as exercise}<div><strong>{exercises.find(e=>e.id===exercise.exerciseId)?.name}</strong><small>{exercise.sets} sets · {exercise.repsMin}–{exercise.repsMax} {exercise.seconds ? 'seconds' : 'reps'}{exercise.perSide ? ' per side' : ''} · {exercise.restSeconds}s rest</small></div>{/each}</details>{/each}
  {:else if step===10 && targetDraft}
    <h1 bind:this={heading} tabindex="-1">Here are your <span>nutrition targets</span> to get started.</h1><p>Use the Nutrition tab to log food and review your daily totals.</p><div class="target-list">{#each [{key:'calories',label:'Daily Calories',unit:'kcal',color:'blue'},{key:'protein',label:'Daily Protein',unit:'g',color:'purple'},{key:'carbs',label:'Daily Carbs',unit:'g',color:'green'},{key:'fat',label:'Daily Fat',unit:'g',color:'yellow'}] as item}<div class={item.color}><span>{item.label}</span>{#if editTargets}<input aria-label={item.label} type="number" min={item.key==='calories'?1:0} max={item.key==='calories'?20000:10000} step="1" bind:value={targetDraft[item.key as 'calories'|'protein'|'carbs'|'fat']}/>{:else}<strong>{targetDraft[item.key as 'calories'|'protein'|'carbs'|'fat']} <small>{item.unit}</small></strong>{/if}</div>{/each}</div><button class="quiet-link" onclick={()=>{editTargets=!editTargets;if(!editTargets && preview)targetDraft=structuredClone($state.snapshot(preview.targets));}}>{editTargets ? 'Restore calculated targets' : 'Override targets manually'}</button><p class="fine-print">{editTargets ? 'Your edited values will be saved as a manual override, retaining the original estimate.' : 'Calculated from your inputs. Protein, carbs and fat are starting targets, not mandatory meal plans.'}</p>
  {:else if step===11 && preview && targetDraft}
    <h1 bind:this={heading} tabindex="-1">Your plan, ready to start.</h1><div class="summary-card"><h2><CheckCircle2 size={24}/>{preview.program.name}</h2><p><Calendar size={19}/> Starts {startDate} · {days} days per week</p><p><Utensils size={19}/>{targetDraft.calories} kcal · {targetDraft.protein}g protein per day</p></div>
    {#if calendarConflicts>0}<fieldset><legend>{calendarConflicts} upcoming workouts already scheduled</legend><label class="inline-choice"><input type="radio" name="schedule-policy" value="keep-existing" bind:group={schedulePolicy}/>Keep those dates; fill the remaining days</label><label class="inline-choice"><input type="radio" name="schedule-policy" value="replace-upcoming" bind:group={schedulePolicy}/>Replace unstarted dates with this plan</label></fieldset>{/if}<p class="fine-print">A repeating four-week schedule is created. Past or started sessions stay intact. Earlier programs and food logs are retained.</p>
    <h2>Progress reviews</h2><p>Use Review My Progress in the Progress tab. It compares repeated sets, effort, weights and food logs, explains suggested adjustments and links to your editable program or targets.</p>
    <h2>Food tracking</h2><p>{nutritionExperience==='new' ? 'Start by searching a food, choosing the amount you ate, and adding it to a meal. The daily bars compare your food log with these targets.' : 'Search the food database or log custom foods with their calorie and macro values.'} Optional “Ask AI” and meal photos provide estimates for you to review before logging.</p>
    <details class="evidence"><summary>Why this plan? Research & calculation</summary>{#each preview.rationale as reason}<p>{reason}</p>{/each}{#each [...EXPERT_SOURCES,...GOAL_SOURCES] as source}<a href={source.url} target="_blank" rel="noopener noreferrer">{source.name}<ExternalLink size={14}/></a>{/each}<p>These starting rules are BodyBuilder app policy informed by research. Your plan and calorie targets do not change automatically.</p></details>
  {/if}
  {#if error}<p class="form-error" role="alert">{error}</p>{/if}
  </div>
  <footer>{#if step===6}<button class="primary-button" type="submit" form="goal-body-form" disabled={saving}>Continue</button>{:else}<button class="primary-button" onclick={next} disabled={saving}>{saving ? 'Preparing your plan…' : step===0 ? 'Let’s do it!' : step===9 ? 'See Nutrition Targets' : step===11 ? 'Create Goal Plan' : 'Continue'}</button>{/if}</footer>
</main>

<style>
  .goal-wizard{max-width:460px;margin:0 auto;min-height:100dvh;background:#10161d;color:#e0e2e5;padding:24px 20px calc(125px + env(safe-area-inset-bottom));box-sizing:border-box}
  header{display:flex;align-items:center;gap:14px;padding:4px 0 22px;font-size:17px}header strong{flex:1}header button{border:0;background:transparent;color:inherit;padding:4px;display:flex}
  .goal-progress{height:4px;background:#dfe2e7;border-radius:8px;overflow:hidden}.goal-progress span{display:block;height:100%;background:#579aff;transition:width .2s}
  .goal-content{padding-top:28px}h1{font-size:26px;line-height:1.18;letter-spacing:-.5px;font-weight:750;margin:0 0 21px;outline:none}h1 span{color:#579aff}p{font-size:15px;line-height:1.5;color:#9b9fa5;margin:0 0 24px}h2{font-size:18px;display:flex;align-items:center;gap:10px;margin:0 0 14px}
  .choices{display:grid;gap:16px;margin:40px 0 28px}.choices label{display:flex;align-items:center;gap:18px;border:2px solid #858b95;border-radius:9px;padding:18px;cursor:pointer;min-height:61px}.choices label.selected{border-color:#579aff;color:#579aff}.choices input{appearance:none;width:21px;height:21px;min-height:21px;padding:0;box-sizing:border-box;flex-shrink:0;border:2px solid currentColor;border-radius:50%;margin:0}.choices input:checked{background:#579aff;box-shadow:inset 0 0 0 2px #10161d}.choices input:focus-visible{outline:3px solid #fff;outline-offset:4px}.choices strong{font-size:15px;font-weight:650;display:block}.choices small{font-size:12px;line-height:1.4;display:block;margin-top:5px;color:inherit}.compact{margin:12px 0;gap:12px}.compact label{padding:14px;min-height:45px}
  fieldset{border:0;padding:0;margin:24px 0}legend{font-size:15px;margin-bottom:12px;font-weight:600}.inline-choice{display:flex;gap:10px;align-items:flex-start;font-size:13px;line-height:1.5;margin:13px 0}.inline-choice input{accent-color:#579aff;margin-top:3px;flex-shrink:0;width:17px;height:17px;min-height:17px;padding:0;box-sizing:border-box}
  .segments{display:flex;gap:9px}.segments button{flex:1;padding:14px 5px;border:1px solid #68717d;border-radius:8px;background:transparent;color:inherit;font-size:15px}.segments button.selected{color:#579aff;border:2px solid #579aff;background:#233148}
  label:not(.inline-choice){font-size:14px}input:not([type=radio],[type=checkbox]),select{width:100%;min-width:0;box-sizing:border-box;border:1px solid #354356;background:#131b24;border-radius:10px;color:#e0e2e5;padding:14px 11px;font:inherit;font-size:16px;margin:7px 0 16px}.form-grid{display:grid;grid-template-columns:1fr 1fr;gap:0 14px}.recommended{background:#305b44;border:1px solid #74c58c;color:#7ed195!important;display:inline-block!important;padding:6px 9px;border-radius:20px;margin:0 0 12px!important;font-size:10px!important;width:max-content}
  .summary-card,.workout-detail{background:#20262e;border-radius:12px;padding:18px;margin:20px 0}.summary-card p:last-child{margin:0}.summary-card p{display:flex;gap:10px;align-items:flex-start;font-size:14px} :global(svg){flex-shrink:0}.fine-print{font-size:12px;line-height:1.5;margin:15px 0}.goal-schedule{display:grid;gap:13px;margin-top:32px}.schedule-row{display:flex;align-items:center;gap:14px}.schedule-row>b{font-size:11px;width:30px;flex-shrink:0}.schedule-row>div{min-width:0;flex:1;display:flex;align-items:center;gap:8px;background:#19222d;border-radius:13px;padding:16px 11px;min-height:27px}.schedule-row>div.rest{background:#2c333d}.schedule-row strong{flex:1;font-size:14px}.schedule-row select{width:61px;margin:0;padding:7px 2px;border:0;font-size:11px;min-height:31px}.drag-handle{background:transparent;color:#88919e;border:0;touch-action:none;padding:4px;display:flex}.drop-target>div{outline:2px solid #579aff}
  .energy-numbers{background:#233148;border-radius:12px;padding:20px;margin-bottom:25px}.energy-numbers>div{display:flex;gap:15px;margin:10px 0 18px;font-size:13px}.energy-numbers strong{display:block;color:#579aff;font-size:27px;margin-top:5px}.energy-numbers small{font-size:12px;color:#c6ccd5}
  details summary{cursor:pointer;font-weight:600;display:flex;justify-content:space-between;gap:10px;font-size:15px}details small{font-size:11px;color:#939dab}.workout-detail>div{padding-top:17px}.workout-detail>div strong{display:block;font-size:13px}.workout-detail>div small{display:block;margin-top:4px}.target-list>div{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:22px 15px;border:1px solid #354356;border-radius:10px;margin-bottom:14px}.target-list strong{font-size:21px}.target-list small{font-size:12px}.target-list span{color:#dfe2e7;font-size:14px}.target-list input{width:110px;margin:0}.blue{color:#579aff}.purple{color:#c69aff}.green{color:#4ad097}.yellow{color:#f8c653}
  .evidence{border-top:1px solid #354356;padding-top:22px}.evidence p{font-size:13px;margin:16px 0}.evidence a{color:#579aff;display:flex;align-items:center;gap:8px;font-size:12px;line-height:1.4;padding:8px 0}.form-error{color:#ff9f9f;background:#432633;padding:15px;border-radius:9px;font-size:14px}
  footer{position:fixed;bottom:0;left:50%;transform:translateX(-50%);width:min(100%,460px);box-sizing:border-box;padding:22px 20px calc(28px + env(safe-area-inset-bottom));background:linear-gradient(transparent,#10161d 15%)}footer button{border-radius:99px;min-height:54px;width:100%;font-size:15px;font-weight:650;background:#579aff;color:#09182b;border:0}.secondary-button{width:100%;padding:14px;border:1px solid #579aff;border-radius:9px;background:#233148;color:#579aff;font-size:14px}.quiet-link{color:#579aff;background:transparent;border:0;font-size:14px;padding:14px 0}button:disabled{opacity:.5}button:focus-visible{outline:2px solid #fff;outline-offset:3px}
  @media(min-width:650px){.goal-wizard{border-left:1px solid #26313e;border-right:1px solid #26313e}}@media(prefers-reduced-motion:reduce){.goal-progress span{transition:none}}
</style>
