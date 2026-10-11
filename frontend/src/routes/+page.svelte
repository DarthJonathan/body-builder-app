<script lang="ts">
  import { onMount, tick, untrack } from 'svelte';
  import { pushState, replaceState } from '$app/navigation';
  import { page } from '$app/state';
  import { Apple, ArrowLeft, ArrowRight, ArrowUp, ArrowDown, BookOpen, Calendar, Camera, Check, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Clipboard, Copy, Dumbbell, EllipsisVertical, ExternalLink, FileText, Flame, History, Home, Info, Link, LoaderCircle, LogOut, MessageCircle, Pencil, Play, Plus, RotateCcw, Scale, Search, Settings, Timer, Trash2, Trophy, UserCircle, Utensils, X, Zap, ChartLine } from 'lucide-svelte';
  import Sheet from '$lib/components/Sheet.svelte';
  import ProgressReview from '$lib/components/ProgressReview.svelte';
  import GoalWizard from '$lib/components/GoalWizard.svelte';
  import ProgramImport from '$lib/components/ProgramImport.svelte';
  import ProgramGuide from '$lib/components/ProgramGuide.svelte';
  import { documentFromProgram } from '$lib/program-documents';
  import type { ProgramDocument, ProgramTemplate, ProgressReview as ProgressReviewReport } from '$lib/domain';
  import { GOAL_SOURCES } from '$lib/goals';
  import { hasAppleHealth, readAppleHealth } from '$lib/health';
  import { client, previewToday, isMockPreview, syncState } from '$lib/client';
  import { APIError } from '$lib/api';
  import { exercises, muscles, templates, readings, foods } from '$lib/catalogue';
  import { MEALS, id, localDate, shiftDate, weekDates, sumNutrients, targetsForDate } from '$lib/domain';
  import { ACTIVITY_FACTORS, DEFAULT_FAT_PERCENT, DEFAULT_PROTEIN_PER_KG, GOAL_ADJUSTMENTS, validateTargetCalculation } from '$lib/nutrition';
  import type { AppSnapshot, Tab, Workout, WorkoutSession, SessionExercise, Prescription, FoodEntry, Food, Meal, Lesson, CheckIn, NutritionTargets, ProviderConfig, MealEstimate, Reading, Exercise, Program, Goal, Effort, TargetCalculation } from '$lib/domain';

  let data = $state<AppSnapshot | null>(null);
  let loading = $state(true);
  let loggedOut = $state(false);
  let activeTab = $state<Tab>('dashboard');
  type View = 'goal' | 'tabs' | 'preview' | 'session' | 'program-edit' | 'history';
  type NavigationState = { accountEmail?: string; bodybuilderView?: View; tab?: Tab; sourceTab?: Tab; date?: string; workoutId?: string; sessionId?: string; programId?: string; editWorkoutId?: string };
  let view = $state<View>('tabs');
  let selectedDate = $state(previewToday());
  let previewWorkoutId = $state('');
  let sessionDraft = $state<WorkoutSession | null>(null);
  let programDraft = $state<Program | null>(null);
  let programLibrary = $state<ProgramTemplate[]>(structuredClone(templates));
  let libraryLoaded = $state(false);
  let libraryLoading = $state(false);
  let libraryError = $state('');
  let importText = $state('');
  let guideProgram = $state<Program | null>(null);
  let editWorkoutId = $state('');
  let collapsed = $state<Record<string, boolean>>({});
  let expandedMeal = $state<Record<string, boolean>>({});
  let progressSection = $state('');
  let progressReport = $state<ProgressReviewReport | null>(null);
  let progressReviewLoading = $state(false);
  let progressReviewGeneration=0;
  let breakdown = $state(false);
  let nutritionMode = $state<'consumed' | 'remaining'>('consumed');
  let insightVisible = $state(true);
  let requests = $state(0);
  let busy = $derived(requests > 0);
  let error = $state('');
  let notice = $state('');
  let now = $state(Date.now());
  let sheetOpen = $state(false);
  let sheet = $state('');
  let sheetTitle = $state('');
  let search = $state('');
  let foodSearching = $state(false);
  let foodResults = $state<Food[]>([]);
  let selectedMeal = $state<Meal>('Breakfast');
  let foodDraft = $state<FoodEntry | null>(null);
  let checkInDraft = $state<CheckIn | null>(null);
  let targetDraft = $state<NutritionTargets | null>(null);
  let lessonDraft = $state<Lesson | null>(null);
  let selectedExerciseId = $state('');
  let selectedPrescriptionId = $state('');
  let prescriptionDraft = $state<Prescription | null>(null);
  let selectedSessionExerciseId = $state('');
  let selectedSetId = $state('');
  let lessonFilter = $state('All');
  let lessonSearch = $state('');
  let profileName = $state('');
  let profileEmail = $state('');
  let profileUnit = $state<'kg' | 'lb'>('kg');
  let profileTimezone = $state('UTC');
  let signInEmail = $state('');
  let signInName = $state('');
  let signInPassword = $state('');
  let authMode = $state<'signin' | 'register'>('signin');
  let providerDraft = $state<ProviderConfig | null>(null);
  let providerKey = $state('');
  let providerTest = $state('');
  let answerPreview = $state(isMockPreview);
  type CalculatorDraft = Omit<TargetCalculation, 'age' | 'sex' | 'heightCm' | 'weightKg' | 'activity'> & {
    age: number | undefined; sex: TargetCalculation['sex'] | ''; heightCm: number | undefined;
    weightKg: number | undefined; activity: TargetCalculation['activity'] | '';
  };
  let calculatorDraft = $state<CalculatorDraft | null>(null);
  let calculatorWeight = $state<number | undefined>(undefined);
  let calculatorWeightSource = $state('');
  let calculatorPreview = $state<NutritionTargets | null>(null);
  let calculatorOffline = $state(false);
  let calculatorPreviewSignature = '';
  let question = $state('');
  let answer = $state('');
  let photo = $state<File | null>(null);
  let photoURL = $state('');
  let mealEstimate = $state<MealEstimate | null>(null);
  let estimateItems = $state<FoodEntry[]>([]);
  let copyDate = $state(shiftDate(localDate(), -1));
  let weightDraft = $state(0);
  let restSeconds = $state(60);
  let historySession = $state<WorkoutSession | null>(null);
  let workoutName = $state('');
  let workoutSourceTab = $state<Tab>('workout');
  let requestQueue: Promise<unknown> = Promise.resolve();
  let calculatorGeneration = 0;
  let searchRevision = 0;
  let draftRevision = 0;
  let noticeTimer: ReturnType<typeof setTimeout>;
  let searchTimer: ReturnType<typeof setTimeout>;
  const scrolls: Partial<Record<Tab, number>> = {};
  let today = $derived(isMockPreview ? localDate(new Date(now)) : dateInTimezone(now, data?.profile.timezone));
  let previousToday = $state(previewToday());
  const tabs: { id: Tab; label: string; icon: typeof Home }[] = [
    { id: 'lessons', label: 'Lessons', icon: BookOpen }, { id: 'nutrition', label: 'Nutrition', icon: Apple },
    { id: 'dashboard', label: 'Dashboard', icon: Home }, { id: 'workout', label: 'Workout', icon: Dumbbell },
    { id: 'progress', label: 'Progress', icon: ChartLine }
  ];
  const titles: Record<string, string> = {
    'progress-review':'Review My Progress',
    checkin: 'Daily Check-in', targets: 'Nutrition Targets', 'food-search': 'Add Food', 'food-edit': 'Food Details',
    'meal-photo': 'Estimate from Photo', warmup: 'Workout Warmup', 'exercise-detail': 'Exercise Guide',
    'exercise-picker': 'Add Exercise', prescription: 'Edit Exercise', effort: 'How did that set feel?',
    templates: 'Choose a Program', 'lesson-edit': 'Your Lesson', 'lesson-detail': 'Lesson Notes',
    'program-import': 'Import / Export Programs', 'program-guide': 'Program Details',
    account: 'Account Information', provider: 'AI Settings', ask: 'Ask AI', goal: 'Your Goal', 'goal-details': 'Your Goal Plan', health: 'Apple Health',
    weight: 'Log Your Weight', copy: 'Copy a Food Log', 'history-detail': 'Workout Summary',
    'workout-settings': 'Edit Workout', 'session-menu': 'Workout Options', rest: 'Rest Timer',
    sync: 'Sync Conflict', 'pending-changes': 'Pending Changes', calculate: 'Calculate Nutrition Targets', 'calculate-preview': 'Target Preview'
  };
  let activeProgram = $derived(data?.programs.find(p => p.id === data?.activeProgramId) ?? data?.programs[0]);
  let selectedWorkout = $derived(data?.programs.flatMap(p => p.workouts).find(w => w.id === previewWorkoutId));
  let editingWorkout = $derived(programDraft?.workouts.find(w => w.id === editWorkoutId));
  let selectedGuide = $derived(exercises.find(e => e.id === selectedExerciseId));
  let unfinished = $derived(data?.sessions.find(s => !s.finishedAt));
  let daySchedule = $derived(data?.schedule.find(s => s.date === selectedDate));
  let dayWorkout = $derived(data?.programs.flatMap(p => p.workouts).find(w => w.id === daySchedule?.workoutId));
  let todaysWorkout = $derived(data?.programs.flatMap(p => p.workouts).find(w => w.id === data?.schedule.find(s => s.date === today)?.workoutId));
  let datedFoods = $derived(data?.foodEntries.filter(f => f.date === selectedDate) ?? []);
  let nutrients = $derived(sumNutrients(datedFoods));
  let targets = $derived(data ? targetsForDate(data, selectedDate) : { calories: 0, protein: 0, carbs: 0, fat: 0 });
  let todayNutrients = $derived(sumNutrients(data?.foodEntries.filter(f=>f.date===today) ?? []));
  let todayTargets = $derived(data ? targetsForDate(data,today) : {calories:0,protein:0,carbs:0,fat:0});
  let dayCheckIn = $derived(data?.checkIns.find(c => c.date === selectedDate));
  let dayFinished = $derived(data?.sessions.some(s => s.date === selectedDate && s.finishedAt));
  let checklistCount = $derived(Number(!!data?.weights.some(w => w.date === selectedDate)) + Number(datedFoods.length > 0) + Number(!!dayFinished));
  let currentWeight = $derived([...(data?.weights ?? [])].filter(w=>w.date<=today).sort((a,b) => b.date.localeCompare(a.date))[0]);
  let previousWeight = $derived([...(data?.weights ?? [])].filter(w=>w.date<=today && w.date>=shiftDate(today,-13)).sort((a,b) => a.date.localeCompare(b.date))[0]);
  let finishedSessions = $derived(data?.sessions.filter(s => s.finishedAt).sort((a,b) => b.startedAt.localeCompare(a.startedAt)) ?? []);
  let completion = $derived(sessionDraft?.exercises.reduce((n,e) => n + e.sets.filter(s => s.completed).length, 0) ?? 0);
  let totalSets = $derived(sessionDraft?.exercises.reduce((n,e) => n + e.sets.length, 0) ?? 0);
  let completedExercises = $derived(sessionDraft?.exercises.filter(e => e.sets.every(s => s.completed)).length ?? 0);
  let remainingRest = $derived(sessionDraft?.restDeadline ? Math.max(0, Math.ceil((new Date(sessionDraft.restDeadline).getTime() - now) / 1000)) : 0);
  let visibleLessons = $derived(data?.lessons.filter(l => (lessonFilter === 'All' || (lessonFilter === 'Completed' ? l.completed : !l.completed)) && `${l.title} ${l.notes} ${l.category}`.toLowerCase().includes(lessonSearch.toLowerCase())) ?? []);

  $effect(() => {
    const navigation = page.state as NavigationState;
    untrack(() => restoreNavigation(navigation));
  });
  $effect(() => {
    const currentDay = today;
    untrack(() => {
      if (currentDay === previousToday) return;
      if (selectedDate === previousToday) {
        selectedDate = currentDay;
        if (data && !loggedOut) replaceState('', navigationState(view));
      }
      previousToday = currentDay;
    });
  });
  $effect(() => { client.setEditing?.(sheetOpen || view === 'goal' || view === 'program-edit' || view === 'session'); });
  $effect(() => { if (!sheetOpen) providerKey = ''; });
  $effect(() => {
    const signature = calculationSignature();
    untrack(() => {
      if (calculatorPreview && signature !== calculatorPreviewSignature) {
        calculatorPreview = null; calculatorOffline = false;
        if (sheetOpen && sheet === 'calculate-preview') openSheet('calculate');
      }
    });
  });
  onMount(() => {
    const unsubscribe = client.subscribe?.(snapshot => {
      if (!snapshot) {
        if (data) clearPrivateDrafts();
        data = null; loggedOut = true; view = 'tabs';
      } else {
        if (data && data.profile.id !== snapshot.profile.id) clearPrivateDrafts();
        data = snapshot; loggedOut = false;
      }
    });
    client.getSnapshot().then(s => {
      data = s;
      restoreNavigation(page.state as NavigationState);
      const active = s.sessions.find(item => !item.finishedAt);
      if (active) {
        sessionDraft = clone(active); view = 'session';
        replaceState('', navigationState('session'));
      }
    }).catch(e => {
      if (!isMockPreview && e instanceof APIError && e.status === 401) { loggedOut = true; if (e.code === 'expired_auth') error = message(e); }
      else error = message(e);
    }).finally(() => { loading = false; });
    const timer = setInterval(() => { now = Date.now(); }, 1000);
    return () => { unsubscribe?.(); client.setEditing?.(false); clearInterval(timer); clearTimeout(noticeTimer); clearTimeout(searchTimer); if (photoURL) URL.revokeObjectURL(photoURL); };
  });
  function navigationState(next: View): NavigationState {
    return { accountEmail: data?.profile.email.toLowerCase(), bodybuilderView: next, tab: activeTab, sourceTab: workoutSourceTab, date: selectedDate, workoutId: previewWorkoutId, sessionId: sessionDraft?.id, programId: programDraft?.id, editWorkoutId };
  }
  function restoreNavigation(navigation: NavigationState) {
    if (!data || loggedOut) return;
    if (navigation.bodybuilderView && navigation.accountEmail !== data.profile.email.toLowerCase()) {
      sheetOpen = false; view = 'tabs'; activeTab = 'dashboard'; selectedDate = today;
      return;
    }
    let next = navigation.bodybuilderView ?? 'tabs';
    const validTab = (value: Tab | undefined) => tabs.some(tab => tab.id === value);
    if (next === 'preview' && !data.programs.some(p => p.workouts.some(w => w.id === navigation.workoutId))) next = 'tabs';
    if (next === 'session') {
      const session = data.sessions.find(s => s.id === navigation.sessionId && !s.finishedAt);
      if (!session) next = 'tabs';
      else if (sessionDraft?.id !== session.id) sessionDraft = clone(session);
    }
    if (next === 'program-edit') {
      const program = data.programs.find(p => p.id === navigation.programId);
      if (!program) next = 'tabs';
      else {
        if (programDraft?.id !== program.id) programDraft = clone(program);
        editWorkoutId = program.workouts.some(w => w.id === navigation.editWorkoutId) ? navigation.editWorkoutId! : program.workouts[0]?.id ?? '';
      }
    }
    if (view !== next || (validTab(navigation.tab) && activeTab !== navigation.tab)) sheetOpen = false;
    if (validTab(navigation.tab)) activeTab = navigation.tab!;
    if (validTab(navigation.sourceTab)) workoutSourceTab = navigation.sourceTab!;
    if (navigation.date && /^\d{4}-\d{2}-\d{2}$/.test(navigation.date)) selectedDate = navigation.date;
    if (navigation.workoutId) previewWorkoutId = navigation.workoutId;
    view = next;
  }
  function clearPrivateDrafts() {
    draftRevision++; searchRevision++;
    programDraft = null; sessionDraft = null; historySession = null;
    progressReport=null;progressReviewLoading=false;progressReviewGeneration++;
    programLibrary=structuredClone(templates);libraryLoaded=false;libraryLoading=false;libraryError='';importText='';guideProgram=null;
    foodDraft = null; checkInDraft = null; lessonDraft = null; targetDraft = null; providerDraft = null; prescriptionDraft = null;
    question = ''; answer = ''; mealEstimate = null; estimateItems = []; photo = null;
    if (photoURL) URL.revokeObjectURL(photoURL);
    photoURL = '';
    profileName = ''; profileEmail = ''; profileUnit = 'kg'; profileTimezone = 'UTC'; signInEmail = ''; signInName = ''; signInPassword = '';
    providerKey = ''; providerTest = ''; clearCalculator(); answerPreview = isMockPreview;
    selectedExerciseId = ''; selectedPrescriptionId = ''; selectedSessionExerciseId = ''; selectedSetId = '';
    previewWorkoutId = ''; editWorkoutId = ''; workoutName = ''; workoutSourceTab = 'workout';
    search = ''; foodResults = []; foodSearching=false; clearTimeout(searchTimer); lessonSearch = ''; lessonFilter = 'All'; selectedMeal = 'Breakfast';
    weightDraft = 0; restSeconds = 60; copyDate = shiftDate(today, -1);
    collapsed = {}; expandedMeal = {}; progressSection = ''; breakdown = false; nutritionMode = 'consumed'; insightVisible = true;
    sheetOpen = false; sheet = ''; sheetTitle = ''; error = ''; notice = ''; clearTimeout(noticeTimer);
    for (const tab of tabs) delete scrolls[tab.id];
  }
  function message(e: unknown): string { return e instanceof Error ? e.message : 'Something went wrong. Please try again.'; }
  function dateInTimezone(timestamp: number, timezone?: string): string {
    try {
      const parts = new Intl.DateTimeFormat('en', { timeZone: timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(timestamp));
      return ['year','month','day'].map(part=>parts.find(value=>value.type===part)?.value).join('-');
    } catch { return localDate(new Date(timestamp)); }
  }
  function toast(text: string) { notice = text; clearTimeout(noticeTimer); noticeTimer = setTimeout(() => { notice = ''; }, 3500); }
  function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)); }
  async function mutate(action: () => Promise<AppSnapshot>, close = false): Promise<boolean> {
    requests++; error = '';
    const revision = draftRevision;
    try { const result = await action(); if (revision !== draftRevision) return false; data = result; if (close) sheetOpen = false; return true; }
    catch (e) { error = message(e); return false; }
    finally { requests--; }
  }
  async function loadProgressReview() {
    const revision=draftRevision,generation=++progressReviewGeneration;progressReviewLoading=true;error='';
    try {const result=await client.reviewProgress();if(revision===draftRevision && generation===progressReviewGeneration && sheetOpen && sheet==='progress-review')progressReport=result;}
    catch(e){if(revision===draftRevision && generation===progressReviewGeneration)error=message(e);}
    finally{if(revision===draftRevision && generation===progressReviewGeneration)progressReviewLoading=false;}
  }
  function openProgressReview(){progressReport=null;openSheet('progress-review');void loadProgressReview();}
  function reviewWorkout(workoutId:string){const workout=activeProgram?.workouts.find(w=>w.id===workoutId);if(workout){sheetOpen=false;showWorkout(workout,'progress');}}
  function reviewTargets(){selectedDate=today;openTargets();}
  function openSheet(kind: string) { if (sheet === 'provider' && kind !== 'provider') providerKey = ''; if(kind!=='food-search') { searchRevision++; foodSearching=false; clearTimeout(searchTimer); } sheet = kind; sheetTitle = titles[kind] ?? kind; error = ''; sheetOpen = true; if(kind==='templates' || kind==='program-import') void loadProgramLibrary(); }
  async function loadProgramLibrary() {
    const revision=draftRevision;libraryLoading=true;libraryError='';
    try {const result=await client.listProgramTemplates();if(revision===draftRevision){programLibrary=result;libraryLoaded=true;}}
    catch(e){if(revision===draftRevision){libraryLoaded=false;libraryError=message(e);}}
    finally{if(revision===draftRevision)libraryLoading=false;}
  }
  function openProgramImport(program?:Program){importText=program ? JSON.stringify(documentFromProgram(program),null,2) : '';openSheet('program-import');}
  async function importProgramDocument(document:ProgramDocument):Promise<string>{
    const revision=draftRevision;requests++;
    try {const snapshot=await client.importProgram(document);if(revision!==draftRevision)throw new Error('The account changed. Open the importer again.');data=snapshot;
      return $syncState.operations.includes('importProgram')?'Queued for sync. The program will appear after the server acknowledges it.':'Program saved. Choose a date on your schedule to assign a workout.';
    }finally{requests--;}
  }
  async function publishProgramDocument(document:ProgramDocument,baseRevision:number):Promise<string>{
    if(!libraryLoaded)throw new Error('Reload the shared library before publishing so its latest revision can be checked.');
    const revision=draftRevision;requests++;
    try {const template=await client.publishProgram(document,baseRevision);if(revision!==draftRevision)throw new Error('The account changed. Open the library again.');
      const at=programLibrary.findIndex(p=>p.id===template.id);if(at<0)programLibrary.push(template);else programLibrary[at]=template;
      return 'Shared plan published. Everyone can choose it from the program library.';
    }finally{requests--;}
  }
  function dateTitle(date = selectedDate) {
    const label = date === today ? 'Today' : date === shiftDate(today, 1) ? 'Tomorrow' : date === shiftDate(today, -1) ? 'Yesterday' : new Date(`${date}T12:00:00`).toLocaleDateString('en', { weekday: 'short' });
    return `${label}, ${new Date(`${date}T12:00:00`).toLocaleDateString('en', { month: 'short', day: 'numeric' })}`;
  }
  function dayName(date: string, format: 'long' | 'short' = 'short') { return new Date(`${date}T12:00:00`).toLocaleDateString('en', { weekday: format }); }
  function dateChange(amount: number) { selectedDate = shiftDate(selectedDate, amount); }
  async function selectTab(tab: Tab) {
    scrolls[activeTab] = window.scrollY; activeTab = tab; view = 'tabs'; error = ''; sheetOpen = false; replaceState('',navigationState('tabs'));
    await tick(); window.scrollTo({ top: scrolls[tab] ?? 0, behavior: 'instant' });
  }
  function navigate(next: View) { replaceState('', navigationState(view)); view = next; pushState('', navigationState(next)); window.scrollTo(0, 0); }
  function goBack() { view = 'tabs'; activeTab = workoutSourceTab; sheetOpen = false; replaceState('', navigationState('tabs')); window.scrollTo(0, 0); }
  function showWorkout(workout: Workout, sourceTab: Tab = 'workout') { previewWorkoutId = workout.id; workoutSourceTab = sourceTab; navigate('preview'); }
  async function startWorkout() {
    if (!selectedWorkout) return;
    if (unfinished) { resumeWorkout(); return; }
    if (await mutate(() => client.startWorkout(selectedWorkout!.id, selectedDate))) {
      const active = data?.sessions.find(s=>!s.finishedAt);
      if (active) { sessionDraft = clone(active); navigate('session'); }
      else toast('Workout start is pending. Connect to open your session.');
    }
  }
  function resumeWorkout() { if (!unfinished) return; sessionDraft = clone(unfinished); workoutSourceTab = activeTab; navigate('session'); }
  async function persistSession() {
    if (!sessionDraft) return false;
    const captured = clone(sessionDraft);
    let ok = false;
    requestQueue = requestQueue.then(async () => { ok = await mutate(() => client.saveSession(captured)); });
    await requestQueue; return ok;
  }
  async function completeSet(exercise: SessionExercise, setId: string) {
    const set = exercise.sets.find(s => s.id === setId); if (!set) return;
    set.completed = !set.completed;
    if (set.completed && sessionDraft) { sessionDraft.restDeadline = new Date(Date.now() + exercise.prescription.restSeconds * 1000).toISOString(); sessionDraft.restDuration = exercise.prescription.restSeconds; }
    await persistSession();
  }
  function showEffort(exerciseId: string, setId: string) { selectedSessionExerciseId = exerciseId; selectedSetId = setId; openSheet('effort'); }
  async function setEffort(effort: Effort) { const set = sessionDraft?.exercises.find(e => e.id === selectedSessionExerciseId)?.sets.find(s => s.id === selectedSetId); if (set) { set.effort = effort; if (await persistSession()) sheetOpen = false; } }
  async function finishWorkout() { if (!sessionDraft) return; const finishedAt=new Date().toISOString(); if (!(await persistSession())) return; if (await mutate(() => client.finishSession(sessionDraft!.id,finishedAt))) { historySession = clone(data!.sessions.find(s => s.id === sessionDraft!.id)!); sessionDraft = null; view = 'tabs'; activeTab = 'workout'; replaceState('', navigationState('tabs')); openSheet('history-detail'); toast('Workout saved. Great work!'); } }
  function guide(exerciseId: string) { selectedExerciseId = exerciseId; openSheet('exercise-detail'); }
  function previousSet(exerciseId: string, index: number) { const session = finishedSessions.find(s => s.exercises.some(e => e.exerciseId === exerciseId)); const set = session?.exercises.find(e => e.exerciseId === exerciseId)?.sets[index]; return set ? `${set.weight ? `${displayWeight(set.weight)} × ` : ''}${set.reps}` : '—'; }
  function displayWeight(weight: number) { return data?.profile.unit === 'lb' ? Math.round(weight * 2.20462 * 10) / 10 : weight; }
  function toKg(weight: number) { return data?.profile.unit === 'lb' ? Math.round(weight / 2.20462 * 100) / 100 : weight; }
  function time(seconds: number) { return `${Math.floor(seconds / 60)}:${String(Math.max(0, seconds % 60)).padStart(2, '0')}`; }
  function elapsed(session: WorkoutSession) { const seconds = Math.max(0, Math.floor(((session.finishedAt ? new Date(session.finishedAt).getTime() : now) - new Date(session.startedAt).getTime()) / 1000)); return seconds < 60 ? `${seconds} secs` : `${Math.floor(seconds / 60)} min`; }
  function exerciseFor(exerciseId: string): Exercise { return exercises.find(e => e.id === exerciseId) ?? { id: exerciseId, name: 'Exercise', image: '/images/exercise-placeholder.svg', muscles: [], equipment: '', instructions: [], weighted: true }; }
  function reps(p: Prescription) { const range = p.repsMin === p.repsMax ? String(p.repsMin) : `${p.repsMin}–${p.repsMax}`; return `${range} ${p.seconds ? 'second holds' : 'reps'}${p.perSide ? ' per side' : ''}${p.amrapLast ? ' · final set AMRAP' : ''}`; }
  function mealTotals(meal: Meal) { return sumNutrients(datedFoods.filter(f => f.meal === meal)); }
  function progress(value: number, target: number) { return target > 0 ? Math.min(100, Math.max(0, value / target * 100)) : 0; }
  function macroValue(key: 'calories' | 'protein' | 'carbs' | 'fat') { return Math.round(nutritionMode === 'remaining' ? Math.max(0, targets[key] - nutrients[key]) : nutrients[key]); }
  function calorieTargetLabel() { if (!targets.calories) return 'Set target'; return !isMockPreview || (data && targetsForDate(data, selectedDate).manuallyOverridden) ? String(targets.calories) : `${targets.calories-50}–${targets.calories+50}`; }
  function openCheckIn() { checkInDraft = clone(dayCheckIn ?? { id: id('checkin'), date: selectedDate, weight: currentWeight?.weight ?? data?.profile.startWeight ?? 0, notes: '' }); weightDraft = displayWeight(checkInDraft.weight); openSheet('checkin'); }
  async function saveCheckIn(event: SubmitEvent) { event.preventDefault(); if (!checkInDraft) return; const next = { ...clone(checkInDraft), weight: toKg(weightDraft) }; if (await mutate(() => client.saveCheckIn(next), true)) toast('Daily check-in saved'); }
  function openWeight() { weightDraft = displayWeight(currentWeight?.weight ?? data?.profile.startWeight ?? 0); openSheet('weight'); }
  function openTargets() { targetDraft = data ? clone(targetsForDate(data, selectedDate)) : null; if(targetDraft && (targetDraft.id==='empty' || targetDraft.effectiveDate!==selectedDate)) targetDraft.id=id('targets'); if(targetDraft) targetDraft.effectiveDate=selectedDate; clearCalculator(); openSheet('targets'); }
  function clearCalculator() { calculatorGeneration++; calculatorDraft = null; calculatorWeight = undefined; calculatorWeightSource = ''; calculatorPreview = null; calculatorOffline = false; calculatorPreviewSignature = ''; }
  function calculationSignature() { return JSON.stringify({ input: calculatorDraft, weight: calculatorWeight, unit: data?.profile.unit }); }
  function calculationInput(): TargetCalculation {
    if (!calculatorDraft) throw new Error('Enter your calculation inputs first.');
    const unchangedWeight = calculatorDraft.weightKg !== undefined && calculatorWeight === displayWeight(calculatorDraft.weightKg);
    const input = { ...clone(calculatorDraft), weightKg: unchangedWeight ? calculatorDraft.weightKg : toKg(calculatorWeight ?? NaN) };
    validateTargetCalculation(input); return input;
  }
  async function openCalculator() {
    if (!data) return;
    const revision = draftRevision, accountId = data.profile.id;
    const effectiveDate = targetDraft?.effectiveDate ?? selectedDate;
    const goal = data.profile.goal;
    clearCalculator();
    const generation = calculatorGeneration;
    calculatorDraft = { age: undefined, sex: '', heightCm: undefined, weightKg: undefined, activity: '', goal, effectiveDate, calorieAdjustment: GOAL_ADJUSTMENTS[goal], proteinPerKg: DEFAULT_PROTEIN_PER_KG, fatPercent: DEFAULT_FAT_PERCENT };
    openSheet('calculate'); requests++;
    try {
      const acknowledged = await client.getAcknowledgedSnapshot?.();
      if (revision !== draftRevision || generation !== calculatorGeneration || data?.profile.id !== accountId || !sheetOpen || sheet !== 'calculate') return;
      const prior = [...(acknowledged?.targets ?? [])].filter(target => target.calculation && target.effectiveDate <= effectiveDate).sort((a,b) => b.effectiveDate.localeCompare(a.effectiveDate))[0]?.calculation?.input;
      if (prior) { const { healthEnergy: _health, ...equationInputs } = clone(prior); calculatorDraft = { ...equationInputs, effectiveDate }; }
      const measured = [...(acknowledged?.weights ?? [])].filter(weight => weight.date <= effectiveDate && weight.date <= today).sort((a,b) => b.date.localeCompare(a.date))[0];
      if (calculatorDraft && measured) { calculatorDraft.weightKg = measured.weight; calculatorWeightSource = `Saved weight · ${dateTitle(measured.date)}`; }
      else if (prior) calculatorWeightSource = 'Weight from your previous calculation';
      calculatorWeight = calculatorDraft?.weightKg === undefined ? undefined : displayWeight(calculatorDraft.weightKg);
    } catch (errorValue) { if (revision === draftRevision && generation === calculatorGeneration && sheetOpen && sheet === 'calculate') error = message(errorValue); }
    finally { requests--; }
  }
  function changeCalculationGoal() { if (calculatorDraft) calculatorDraft.calorieAdjustment = GOAL_ADJUSTMENTS[calculatorDraft.goal]; }
  async function previewTargets(event: SubmitEvent) {
    event.preventDefault(); if (!client.calculateTargets || !calculatorDraft) return;
    const revision = draftRevision, signature = calculationSignature(), generation = calculatorGeneration;
    requests++; error = ''; calculatorPreview = null; calculatorOffline = false;
    try {
      const input = calculationInput(); let offline = false;
      const result = await client.calculateTargets(input, () => { offline = true; });
      if (revision !== draftRevision || generation !== calculatorGeneration || signature !== calculationSignature() || !sheetOpen || sheet !== 'calculate') return;
      calculatorPreviewSignature = signature; calculatorPreview = result; calculatorOffline = offline;
      openSheet('calculate-preview');
    } catch (errorValue) { if (revision === draftRevision && generation === calculatorGeneration && sheetOpen && sheet === 'calculate') error = message(errorValue); }
    finally { requests--; }
  }
  function editCalculation() { calculatorPreview = null; calculatorOffline = false; openSheet('calculate'); }
  function cancelCalculation() { clearCalculator(); if (targetDraft) openSheet('targets'); else sheetOpen = false; }
  async function applyTargets() {
    if (!calculatorPreview || calculatorPreviewSignature !== calculationSignature()) { error = 'Your inputs changed. Preview them again before applying.'; return; }
    const captured = clone(calculatorPreview);
    if (await mutate(() => client.saveTargets(captured), true)) { targetDraft = null; clearCalculator(); toast('Nutrition targets applied'); }
  }
  async function saveManualTargets(event: SubmitEvent) {
    event.preventDefault(); if (!targetDraft) return;
    const captured = { ...clone(targetDraft), mode: 'manual' as const, manuallyOverridden: true };
    if (await mutate(() => client.saveTargets(captured), true)) { clearCalculator(); toast('Nutrition targets saved'); }
  }
  function openFoodSearch(meal: Meal = 'Breakfast') { selectedMeal = meal; search = ''; foodResults = isMockPreview ? foods.slice(0, 12) : []; openSheet('food-search'); if(!isMockPreview) void searchFoods(); }
  function scheduleFoodSearch() { clearTimeout(searchTimer); searchRevision++; foodSearching=true; searchTimer=setTimeout(()=>void searchFoods(),300); }
  async function searchFoods() { clearTimeout(searchTimer); const revision = ++searchRevision; foodSearching=true; foodResults=[]; error = ''; try { const results = await client.searchFoods(search); if (revision === searchRevision) foodResults = results; } catch (e) { if(revision===searchRevision && sheet==='food-search') {foodResults=[];error = message(e);} } finally { if(revision===searchRevision) foodSearching=false; } }
  function selectFood(food: Food) { foodDraft = { id: id('food'), foodId: food.id, name: food.name, date: selectedDate, meal: selectedMeal, quantity: 1, serving: food.serving, source: 'database', databaseSource: food.source, calories: food.calories, protein: food.protein, carbs: food.carbs, fat: food.fat }; openSheet('food-edit'); }
  function manualFood() { foodDraft = { id: id('food'), name: '', date: selectedDate, meal: selectedMeal, quantity: 1, serving: '1 serving', source: 'manual', calories: 0, protein: 0, carbs: 0, fat: 0 }; openSheet('food-edit'); }
  function editFood(entry: FoodEntry) { foodDraft = clone(entry); selectedMeal = entry.meal; openSheet('food-edit'); }
  async function saveFood(event: SubmitEvent) { event.preventDefault(); if (!foodDraft) return; if (await mutate(() => client.saveFood(clone(foodDraft!)), true)) { expandedMeal[selectedMeal] = true; toast('Food added to your log'); } }
  function updateQuantity(next: number) { if (!foodDraft || !(next > 0)) return; const ratio = next / foodDraft.quantity; for (const key of ['calories','protein','carbs','fat'] as const) foodDraft[key] = Math.round(foodDraft[key] * ratio * 1_000_000) / 1_000_000; foodDraft.quantity = next; }
  function openPhoto() { mealEstimate = null; estimateItems = []; photo = null; if (photoURL) URL.revokeObjectURL(photoURL); photoURL = ''; openSheet('meal-photo'); }
  function fileChanged(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0]; if (!file) return;
    photo = null; mealEstimate = null; estimateItems = []; error = '';
    if (photoURL) URL.revokeObjectURL(photoURL); photoURL = '';
    if (isMockPreview ? !file.type.startsWith('image/') : !['image/jpeg','image/png'].includes(file.type)) { error = isMockPreview ? 'Please choose a photo.' : 'Choose a JPEG or PNG photo. Convert HEIC or other image formats before uploading.'; input.value = ''; return; }
    const maximum = isMockPreview ? 10 * 1024 * 1024 : 7_000_000;
    if (file.size > maximum) { error = `Please choose a photo smaller than ${isMockPreview ? 10 : 7} MB.`; input.value = ''; return; }
    photo = file; photoURL = URL.createObjectURL(file);
    if (!isMockPreview) {
      const image = new Image(); image.src = photoURL;
      const invalidPhoto = (text: string) => { if(photo !== file) return; error=text; photo=null; if(photoURL) URL.revokeObjectURL(photoURL); photoURL=''; input.value=''; };
      image.onload = () => { if(image.width>8000 || image.height>8000 || image.width*image.height>16_000_000) invalidPhoto('Choose a photo up to 8,000 pixels per side and 16 megapixels. Resize it before uploading.'); };
      image.onerror = () => invalidPhoto('This photo could not be read. Choose a valid JPEG or PNG image.');
    }
  }
  async function estimatePhoto() { if (!photo) return; const revision=draftRevision; requests++; error = ''; try { const estimate = await client.estimateMeal(photo); if(revision!==draftRevision) return; mealEstimate=estimate; estimateItems = estimate.items.map(item => ({ ...item, id: id('food'), date: selectedDate, meal: selectedMeal, source: 'ai-estimate' })); } catch(e) { if(revision===draftRevision) error = message(e); } finally { requests--; } }
  async function saveEstimate(event: SubmitEvent) { event.preventDefault(); for (const item of estimateItems) { if (!(await mutate(() => client.saveFood({ ...clone(item), meal: selectedMeal })))) return; } sheetOpen = false; expandedMeal[selectedMeal] = true; toast('Meal saved to your food log'); }
  function openLesson(lesson?: Lesson) { lessonDraft = clone(lesson ?? { id: id('lesson'), title: '', url: '', notes: '', category: 'Training', source: 'Personal', completed: false, savedAt: new Date().toISOString() }); openSheet(lesson ? 'lesson-detail' : 'lesson-edit'); }
  async function saveLesson(event: SubmitEvent) { event.preventDefault(); if (lessonDraft && await mutate(() => client.saveLesson(clone(lessonDraft!)), true)) toast('Lesson saved'); }
  function saveReading(reading: Reading) { const exists = data?.lessons.some(l => l.url === reading.url); if (exists) { toast('Already in your library'); return; } void mutate(() => client.saveLesson({ id: id('lesson'), title: reading.title, url: reading.url, notes: '', category: reading.category, source: reading.source, completed: false, savedAt: new Date().toISOString() })).then(ok => { if(ok) toast('Added to your library'); }); }
  function openAccount() { if (!data) return; profileName = data.profile.displayName; profileEmail = data.profile.email; profileUnit = data.profile.unit; profileTimezone = data.profile.timezone; openSheet('account'); }
  async function saveProfile(event: SubmitEvent) { event.preventDefault(); if (await mutate(() => client.updateProfile({ displayName: profileName, unit: profileUnit, ...(!isMockPreview ? { timezone: profileTimezone } : {}) }), true)) toast('Account updated'); }
  async function signIn(event: SubmitEvent) {
    event.preventDefault(); requests++; error = '';
    const email = signInEmail, name = signInName, password = signInPassword;
    try {
      const snapshot = !isMockPreview && authMode === 'register' && client.signUp ? await client.signUp(name,email,password) : await client.signIn(email,isMockPreview ? name : password);
      clearPrivateDrafts(); data = snapshot; loggedOut = false; selectedDate = dateInTimezone(Date.now(),snapshot.profile.timezone); activeTab = 'dashboard'; view = 'tabs';
      const active = snapshot.sessions.find(s=>!s.finishedAt); if(active) { sessionDraft=clone(active); view='session'; }
      replaceState('',navigationState(view)); sheetOpen = false;
      toast(isMockPreview ? 'Preview account opened' : authMode === 'register' ? 'Your account is ready' : 'Welcome back');
    } catch(errorValue) { error = message(errorValue); } finally { signInPassword = ''; requests--; }
  }
  async function switchAccount(event: SubmitEvent) { event.preventDefault(); if (await mutate(() => client.signIn(profileEmail), true)) { clearPrivateDrafts(); view = 'tabs'; activeTab = 'dashboard'; selectedDate = today; replaceState('',navigationState('tabs')); toast('Preview account switched'); } }
  async function signOut() { requests++; error = ''; try { await client.signOut(); clearPrivateDrafts(); authMode='signin'; data = null; loggedOut = true; sheetOpen = false; view = 'tabs'; replaceState('',navigationState('tabs')); } catch(e) { error = message(e); } finally { requests--; } }
  function openProvider() { if(data) providerDraft = clone(data.provider); providerKey = ''; providerTest = ''; openSheet('provider'); }
  async function saveProvider(event: SubmitEvent) {
    event.preventDefault(); if(!providerDraft) return;
    const settings = {...clone(providerDraft), ...(!isMockPreview && providerKey.trim() ? {apiKey:providerKey.trim()} : {})};
    if(await mutate(()=>client.saveProvider(settings),true)) { providerKey=''; providerDraft=data ? clone(data.provider) : null; toast(isMockPreview ? 'AI preview settings saved' : 'AI settings saved'); }
  }
  async function testProvider() { if(!client.testProvider) return; const revision=draftRevision; requests++; error=''; providerTest=''; try { const result=await client.testProvider(); if(revision===draftRevision) providerTest=result.message || 'Provider connection succeeded'; } catch(errorValue) { if(revision===draftRevision) error=message(errorValue); } finally { requests--; } }
  async function ask() { if (!question.trim()) return; const revision=draftRevision; requests++; answer = ''; error = ''; try { const response=await client.askQuestion(question); if(revision===draftRevision) { answer=response.answer; answerPreview=response.preview; } } catch(e) { if(revision===draftRevision) error = message(e); } finally { requests--; } }
  async function refresh() { if(client.refresh) await mutate(()=>client.refresh!()); }
  async function resolveConflict(resolution: 'keep-local' | 'use-server') {
    if (!client.resolveConflict) return;
    if (await mutate(()=>client.resolveConflict!(resolution),true)) {
      if (resolution === 'use-server') {
        programDraft=null; sessionDraft=null; historySession=null; foodDraft=null; checkInDraft=null; targetDraft=null; lessonDraft=null; prescriptionDraft=null;
        clearCalculator();
        view='tabs'; replaceState('',navigationState('tabs'));
      } else if (sessionDraft && data) {
        const saved=data.sessions.find(s=>s.id===sessionDraft?.id); if(saved) sessionDraft=clone(saved);
      }
      toast(resolution === 'keep-local' ? 'Your changes are ready to sync' : 'Latest saved data opened');
    }
  }
  async function useProgram(templateId: string) {
    const previousId=data?.activeProgramId;
    if(await mutate(()=>client.useTemplate(templateId),true)) {
      activeTab='workout';
      toast(data?.activeProgramId!==previousId ? 'Program added. Choose a day to schedule it.' : 'Program creation is pending. Connect to open it.');
    }
  }
  async function copyFoodLog(event: SubmitEvent) {
    event.preventDefault();
    if(await mutate(()=>client.copyFoods(copyDate,selectedDate),true)) toast(!isMockPreview && $syncState.pending ? 'Food log copy is pending. Connect to finish it.' : 'Food log copied');
  }
  function editProgram() { if(!activeProgram) return; programDraft = clone(activeProgram); editWorkoutId = programDraft.workouts[0]?.id ?? ''; workoutSourceTab = 'workout'; navigate('program-edit'); }
  function editCurrentWorkout() { if (!selectedWorkout || !data) return; const owner=data?.programs.find(p=>p.workouts.some(w=>w.id===selectedWorkout!.id)); if(!owner) return; programDraft=clone(owner); editWorkoutId = selectedWorkout.id; navigate('program-edit'); }
  async function saveProgram() { if (!programDraft) return; if(await mutate(() => client.saveProgram(clone(programDraft!)))) { goBack(); toast('Program saved'); } }
  function editPrescription(p: Prescription) { selectedPrescriptionId = p.id; prescriptionDraft = clone(p); openSheet('prescription'); }
  function applyPrescription(event: SubmitEvent) { event.preventDefault(); if (!prescriptionDraft || !editingWorkout) return; const at = editingWorkout.exercises.findIndex(p => p.id === selectedPrescriptionId); if(at >= 0) editingWorkout.exercises[at] = clone(prescriptionDraft); sheetOpen = false; }
  function addExercise(exerciseId: string) { if(!editingWorkout) return; editingWorkout.exercises.push({ id: id('prescription'), exerciseId, sets: 3, repsMin: 8, repsMax: 12, restSeconds: 60 }); sheetOpen = false; }
  function moveExercise(index: number, amount: number) { if (!editingWorkout) return; const next = index + amount; if(next < 0 || next >= editingWorkout.exercises.length) return; const list = [...editingWorkout.exercises]; [list[index],list[next]] = [list[next],list[index]]; editingWorkout.exercises = list; }
  function showHistory() { workoutSourceTab = activeTab; navigate('history'); }
  function openGoal() { workoutSourceTab=activeTab; sheetOpen=false; navigate('goal'); }
  async function createGoalPlan(input: import('$lib/domain').CreateGoalPlan) {
    const accountId=data?.profile.id;
    if (!(await mutate(()=>client.createGoalPlan(input)))) throw new Error(error || 'Could not create the goal plan.');
    if(data?.profile.id!==accountId)return;
    goBack();toast($syncState.pending ? 'Goal plan is pending. Connect to apply it.' : 'Goal, workout schedule and nutrition targets created');
  }
  async function syncAppleHealth() {
    const revision=draftRevision;error='';requests++;
    try { const energy=await readAppleHealth();if(revision!==draftRevision)return;const saved=await mutate(()=>client.saveHealthEnergy(energy));if(saved && revision===draftRevision)toast('Apple Health energy synced. Review a new goal to update calorie targets.'); }
    catch(e){if(revision===draftRevision)error=message(e);}finally{requests--;}
  }
  function goalName(goal: Goal | undefined) { return goal === 'lose-fat' ? 'Lose Fat' : goal === 'maintain' ? 'Maintain Weight' : 'Build Muscle'; }
  function habitDays() { const last7 = Array.from({length:7}, (_,i) => shiftDate(today,-i)); return last7.filter(day => data?.foodEntries.some(f => f.date === day)).length; }
  function consistency() { const scheduled = data?.schedule.filter(s => s.workoutId && s.date <= today && s.date >= shiftDate(today,-20)) ?? []; return scheduled.length ? Math.min(100, Math.round(scheduled.filter(s => data?.sessions.some(w => w.date === s.date && w.workoutId === s.workoutId && w.finishedAt)).length / scheduled.length * 100)) : 0; }
</script>

{#snippet accountButtons()}
  <div class="header-actions">
    <button class="assistant-avatar" aria-label="Profile information" onclick={openAccount}><span class="header-initials">{data?.profile.displayName.slice(0,1)}</span></button>
    <button class="icon-button account-icon" aria-label="Account information" onclick={openAccount}><UserCircle size={25} strokeWidth={2.3} /></button>
  </div>
{/snippet}
{#snippet dateNavigation()}
  <header class="date-header"><div class="date-navigation"><button class="icon-button" aria-label="Previous day" onclick={() => dateChange(-1)}><ChevronLeft size={23} /></button><span>{dateTitle()}</span><button class="icon-button" aria-label="Next day" onclick={() => dateChange(1)}><ChevronRight size={23} /></button></div>{@render accountButtons()}</header>
{/snippet}
{#snippet exerciseImage(exercise: Exercise, extra = '')}
  <img class="exercise-image {extra}" src={exercise.image} alt="" onerror={(e) => { const img = e.currentTarget as HTMLImageElement; if(!img.src.endsWith('exercise-placeholder.svg')) img.src = '/images/exercise-placeholder.svg'; }} />
{/snippet}
{#snippet macro(key: 'protein' | 'carbs' | 'fat', label: string)}
  <div class="macro macro-{key}"><span>{label}</span><div class="macro-track"><i style:width="{progress(nutrients[key], targets[key])}%"></i></div><div class="macro-caption">{#if nutrients[key] >= targets[key] && targets[key] > 0}<CheckCircle2 size={13} class="good" />{/if}<b>{macroValue(key)}</b><span>/ {targets[key]}g{isMockPreview && key === 'protein' ? '+' : ''}</span></div></div>
{/snippet}
{#snippet weightChart()}
  {@const entries = [...(data?.weights ?? [])].filter(w=>w.date<=today && w.date>=shiftDate(today,-13)).sort((a,b) => a.date.localeCompare(b.date))}
  <div class="chart-box" role="img" aria-label="Weight history chart">
    {#if entries.length > 1}
      {@const values = entries.map(e => displayWeight(e.weight))}
      {@const min = Math.min(...values) - .4}
      {@const max = Math.max(...values) + .4}
      <div class="chart-axis"><span>{max.toFixed(1)}</span><span>{((max+min)/2).toFixed(1)}</span><span>{min.toFixed(1)}</span></div>
      <svg viewBox="0 0 300 112" preserveAspectRatio="none" aria-hidden="true"><defs><linearGradient id="chart-gradient" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#579aff" stop-opacity=".25" /><stop offset="100%" stop-color="#579aff" stop-opacity="0" /></linearGradient></defs><path d="M0,112 L{entries.map((e,i) => `${i/(entries.length-1)*300},${102-(displayWeight(e.weight)-min)/(max-min)*94}`).join(' L')} L300,112 Z" fill="url(#chart-gradient)"/><path d="M{entries.map((e,i) => `${i/(entries.length-1)*300},${102-(displayWeight(e.weight)-min)/(max-min)*94}`).join(' L')}" fill="none" stroke="#579aff" stroke-width="2.5" vector-effect="non-scaling-stroke"/>{#each entries as e,i}<circle cx={i/(entries.length-1)*300} cy={102-(displayWeight(e.weight)-min)/(max-min)*94} r="3.3" fill="#579aff"/>{/each}</svg>
      <div class="chart-dates"><span>{new Date(`${entries[0].date}T12:00:00`).toLocaleDateString('en', {month:'short',day:'numeric'})}</span><span>{new Date(`${entries[entries.length-1].date}T12:00:00`).toLocaleDateString('en', {month:'short',day:'numeric'})}</span></div>
    {:else}<p class="muted">Log your weight to see your trend.</p>{/if}
  </div>
{/snippet}

{#if loading}
  <main class="loading-screen"><Dumbbell size={42} class="blue" /><h1>BodyBuilder</h1><LoaderCircle class="spin muted" size={25}/><p>Getting your day ready</p></main>
{:else if loggedOut || !data}
  <main class="account-screen">
    <div class="account-brand"><Dumbbell size={25}/><span>BodyBuilder</span></div>
    <section class="account-card"><div class="account-mark"><Dumbbell size={34}/></div><h1>Make time for you.</h1><p>Your training, nutrition and progress.<br/>All in one place.</p>
      {#if isMockPreview}<div class="preview-callout"><Info size={17}/><span>Local preview · enter an email to explore your own preview account. No password needed.</span></div>{:else}<div class="auth-options">{#if authMode==='signin'}<span class="active">Sign In</span><button onclick={()=>{authMode='register';error='';}}>Create Account</button>{:else}<button onclick={()=>{authMode='signin';error='';}}>Sign In</button><span class="active">Create Account</span>{/if}</div>{/if}
      <form onsubmit={signIn} aria-label={isMockPreview ? 'Open preview account' : authMode==='register' ? 'Create your account' : 'Sign in to your account'}>
        {#if isMockPreview || authMode==='register'}<label for="sign-in-name">Your name</label><input id="sign-in-name" bind:value={signInName} autocomplete="given-name" placeholder="Your name" required maxlength="80"/>{/if}
        <label for="sign-in-email">Email</label><input id="sign-in-email" type="email" bind:value={signInEmail} autocomplete="email" placeholder="you@example.com" required/>
        {#if !isMockPreview}<label for="sign-in-password">Password</label><input id="sign-in-password" type="password" bind:value={signInPassword} autocomplete={authMode==='register' ? 'new-password' : 'current-password'} minlength={authMode==='register' ? 8 : undefined} required/><p class="auth-note">{authMode==='register' ? 'At least 8 characters. Your records are private to your account.' : 'Sign in to sync your training across your devices.'}</p>{/if}
        {#if error}<p role="alert" class="form-error">{error}</p>{/if}<button class="primary-button" disabled={busy}>{isMockPreview ? 'Open preview' : authMode==='register' ? 'Create Account' : 'Sign In'} <ArrowRight size={19}/></button>
      </form>
    </section>
  </main>
{:else if view === 'goal'}
  {#key data.profile.id}<GoalWizard snapshot={data} {today} oncancel={goBack} oncreate={createGoalPlan}/>{/key}
{:else}
  <div class="app-shell" class:in-workout={view !== 'tabs'}>
    {#if error && !sheetOpen}<div class="error-banner" role="alert"><span>{error}</span><button class="icon-button" aria-label="Dismiss error" onclick={() => error = ''}><X size={18}/></button></div>{/if}
    {#if !isMockPreview && !['synced','signed-out'].includes($syncState.phase)}
      <div class="sync-banner" class:sync-conflict={$syncState.phase==='conflict'} class:sync-in-session={view==='session'} class:sync-above-rest={view==='session' && remainingRest > 0} role="status" data-testid="sync-status">
        <span>{#if $syncState.phase==='conflict'}<strong>Sync conflict</strong><small>Your {$syncState.pending} pending {$syncState.pending===1?'change is':'changes are'} safe on this device.</small>{:else if $syncState.phase==='offline'}<strong>Offline</strong><small>{$syncState.pending ? `${$syncState.pending} pending changes saved on this device` : 'Your saved data is available on this device'}</small>{:else if $syncState.phase==='error'}<strong>Changes need attention</strong><small>{$syncState.message}</small>{:else if $syncState.phase==='syncing'}<strong>Syncing changes</strong>{:else}<strong>Pending changes</strong><small>{$syncState.message || `${$syncState.pending} saved on this device`}</small>{/if}</span>
        {#if $syncState.phase==='conflict'}<button onclick={()=>openSheet('sync')}>Review Conflict</button>{:else if $syncState.phase==='error'}<button onclick={()=>openSheet('pending-changes')}>Review</button>{:else if $syncState.phase!=='syncing'}<button disabled={busy} onclick={refresh}>Retry Sync</button>{/if}
      </div>
    {/if}
    {#if view === 'tabs'}
      {#if activeTab === 'dashboard'}
        <section class="week-panel">
          <header class="week-header"><div class="streak"><Flame size={20} fill="#f5d281" color="#f5d281"/><strong>{finishedSessions.length}</strong></div><button class="icon-button" aria-label="Previous week" onclick={() => dateChange(-7)}><ChevronLeft size={20}/></button><button class="week-label" onclick={() => selectedDate = today}>{weekDates(selectedDate).includes(today) ? 'This Week' : new Date(`${selectedDate}T12:00:00`).toLocaleDateString('en', {month:'short',day:'numeric'})}</button><button class="icon-button" aria-label="Next week" onclick={() => dateChange(7)}><ChevronRight size={20}/></button>{@render accountButtons()}</header>
          <div class="week-calendar" aria-label="Weekly calendar">{#each weekDates(selectedDate) as day}
            {@const done = data.sessions.some(s => s.date === day && s.finishedAt)}{@const scheduled = data.schedule.some(s => s.date === day && s.workoutId)}
            <button class="calendar-day" class:selected={selectedDate === day} class:day-complete={done} aria-label={dateTitle(day)} aria-pressed={selectedDate === day} onclick={() => selectedDate = day}><span class="day-letter">{dayName(day).slice(0,1)}</span><span class="day-ring" class:today={day === today}><span>{Number(day.slice(-2))}</span></span>{#if scheduled}<span class="workout-badge"><Dumbbell size={12}/></span>{/if}</button>
          {/each}</div><div class="panel-handle" aria-hidden="true"></div>
        </section>
        <main class="tab-content dashboard-content">
          <h1 class="greeting">{new Date().getHours() < 12 ? 'Morning' : new Date().getHours() < 18 ? 'Afternoon' : 'Evening'}, {data.profile.displayName.split(' ')[0]}!</h1>
          <div class="section-heading"><h2>{selectedDate === today ? "Today's" : selectedDate === shiftDate(today,1) ? "Tomorrow's" : "Your"} checklist</h2><span class="completion-text">{checklistCount}/3 completed <ChevronUp size={19}/></span></div>
          <div class="checklist">
            <button class="checklist-card" onclick={openWeight}><span class="icon-box"><Scale size={26}/></span><span class="row-copy"><strong>Log your weight</strong><span>{currentWeight ? `Last: ${displayWeight(currentWeight.weight)} ${data.profile.unit} · ${currentWeight.date === today ? 'today' : currentWeight.date === shiftDate(today,-1) ? 'yesterday' : currentWeight.date}` : 'A little progress, every day'}</span></span>{#if data.weights.some(w => w.date === selectedDate)}<CheckCircle2 class="good" size={21}/>{:else}<ChevronRight class="blue" size={26}/>{/if}</button>
            <button class="checklist-card" onclick={() => selectTab('nutrition')}><span class="icon-box"><Utensils size={26}/></span><span class="row-copy"><strong>Update your food log</strong><span>{datedFoods.length ? `${Math.round(nutrients.calories)} calories logged` : 'Start logging today'}</span></span>{#if datedFoods.length}<CheckCircle2 class="good" size={21}/>{:else}<ChevronRight class="blue" size={26}/>{/if}</button>
            <button class="checklist-card" onclick={() => { if(unfinished) resumeWorkout(); else if(dayWorkout) showWorkout(dayWorkout, 'dashboard'); else selectTab('workout'); }}><span class="icon-box"><Dumbbell size={26}/></span><span class="row-copy"><strong>{unfinished ? 'Continue your workout' : dayFinished ? 'Workout completed' : 'Complete your workout'}</strong><span>{dayWorkout ? `${dayWorkout.name} · ${dayWorkout.exercises.length ? Math.round(dayWorkout.exercises.reduce((n,e) => n + e.sets * (e.restSeconds + 45),0)/60) : 45} min` : 'Rest day · take time to recover'}</span></span>{#if dayFinished}<CheckCircle2 class="good" size={21}/>{:else}<ChevronRight class="blue" size={26}/>{/if}</button>
          </div>
          {#if insightVisible}<aside class="insight-card"><button class="icon-button" aria-label="Dismiss training insight" onclick={() => insightVisible = false}><X size={20}/></button><h2>Fuel your training</h2><p>{datedFoods.length ? `You've logged ${Math.round(nutrients.calories)} calories today. Keep your food log up to date to see how your nutrition supports your training.` : 'Small habits make a big difference. Log your meals and give your body the fuel it needs for your next workout.'}</p></aside>{/if}
          <div class="thin-divider"></div>
          <button class="checklist-card checkin-card" onclick={openCheckIn}><span class="icon-box"><Clipboard size={25}/></span><span class="row-copy"><strong>{dayCheckIn ? 'Daily Check-in Complete' : 'Daily Check-in'}</strong><span>{dayCheckIn ? `${displayWeight(dayCheckIn.weight)} ${data.profile.unit} · tap to edit` : 'Weight and a note about your day'}</span></span>{#if dayCheckIn}<CheckCircle2 class="good" size={21}/>{:else}<ChevronRight class="blue" size={25}/>{/if}</button>
          <button class="quiet-link" onclick={() => selectTab('progress')}>See your progress <ArrowRight size={16}/></button><button class="quiet-link" onclick={()=>{question=''; answer=''; openSheet('ask');}}><MessageCircle size={16}/>Ask AI</button>
        </main>
      {:else if activeTab === 'nutrition'}
        <main class="tab-content nutrition-content">
          {@render dateNavigation()}
          <section class="nutrition-summary">
            <div class="segmented-control"><button class:active={nutritionMode === 'consumed'} onclick={() => nutritionMode = 'consumed'}>Consumed</button><button class:active={nutritionMode === 'remaining'} onclick={() => nutritionMode = 'remaining'}>Remaining</button></div>
            <div class="calorie-total"><strong data-testid="calorie-total">{macroValue('calories')}</strong><span>/ {calorieTargetLabel()} cal</span></div>
            <div class="calorie-track"><span style:width="{progress(nutrients.calories, targets.calories)}%"></span></div>
            <div class="macro-grid">{@render macro('protein','Protein')}{@render macro('carbs','Carbs')}{@render macro('fat','Fat')}</div>
            <button class="breakdown-toggle" aria-expanded={breakdown} onclick={() => breakdown = !breakdown}>Full Breakdown {#if breakdown}<ChevronUp size={17}/>{:else}<ChevronDown size={17}/>{/if}</button>
            {#if breakdown}<div class="full-breakdown"><div><span>Calorie target</span><b>{targets.calories} cal</b></div><div><span>Logged foods</span><b>{datedFoods.length}</b></div><div><span>Target setting</span><b>{targetsForDate(data, selectedDate).mode === 'manual' ? 'Manual override' : isMockPreview ? 'Preview estimate' : 'Calculated'}</b></div><button class="quiet-link" onclick={openTargets}>Edit your targets <Pencil size={14}/></button></div>{/if}
          </section>
          <div class="section-heading food-heading"><h1>Food Log</h1><div class="inline-actions"><button class="icon-button" aria-label="Nutrition settings" onclick={openTargets}><Settings size={21}/></button><button class="icon-button" aria-label="Copy food log" onclick={() => { copyDate = shiftDate(selectedDate,-1); openSheet('copy'); }}><Copy size={23}/></button></div></div>
          <div class="meal-list">{#each MEALS as meal}
            {@const total = mealTotals(meal)}{@const entries = datedFoods.filter(f => f.meal === meal)}
            <section class="meal-card"><div class="meal-heading"><button class="meal-name" aria-expanded={!!expandedMeal[meal]} onclick={() => expandedMeal[meal] = !expandedMeal[meal]}>{#if expandedMeal[meal]}<ChevronUp size={17}/>{:else}<ChevronDown size={17}/>{/if}<span>{meal}</span></button><span class="pill calorie-pill">{Math.round(total.calories)} Cal</span><span class="pill protein-pill">{Math.round(total.protein)} P</span><button class="icon-button blue" aria-label={`Add food to ${meal}`} onclick={() => openFoodSearch(meal)}><Plus size={26}/></button></div>
              {#if expandedMeal[meal]}<div class="meal-entries">{#each entries as entry (entry.id)}<button class="food-entry" onclick={() => editFood(entry)}><span><strong>{entry.name}</strong><small>{entry.quantity} × {entry.serving}</small>{#if entry.databaseSource}<small class="database-source-preview">{entry.databaseSource}</small>{/if}</span><span class="food-entry-calories">{Math.round(entry.calories)} <small>cal</small></span><ChevronRight size={18}/></button>{:else}<p class="meal-empty">Nothing logged yet.</p>{#if isMockPreview}<button class="suggested-food" onclick={() => {selectedMeal=meal;selectFood(foods[0]);}}><span>{foods[0]?.name ?? 'Add a food'}<small>Suggested from the food library</small></span><ChevronRight size={20}/></button>{:else}<button class="suggested-food" onclick={()=>openFoodSearch(meal)}><span>Add a food<small>Search your saved foods or enter a serving</small></span><ChevronRight size={20}/></button>{/if}{/each}</div>{/if}
            </section>
          {/each}</div>
          <div class="nutrition-search"><button onclick={() => openFoodSearch()}><Search size={22}/><span>Search for a food</span></button><button class="camera-button" aria-label="Estimate from Photo" onclick={openPhoto}><Camera size={24}/></button></div>
        </main>
      {:else if activeTab === 'workout'}
        <main class="tab-content workout-content">
          <header class="program-header"><button class="program-choice" onclick={() => openSheet('templates')}><span class="program-icon"><Dumbbell size={24}/></span><span><small>{activeProgram?.level ?? 'Your plan'} · {goalName(activeProgram?.goal)} <Pencil size={12}/></small><strong>{activeProgram?.name ?? 'Choose a training program'}</strong></span></button>{@render accountButtons()}</header>
          {#if unfinished}<button class="resume-banner" onclick={resumeWorkout}><Timer size={19}/><span><b>Workout in progress</b><small>{unfinished.name} · pick up where you left off</small></span><Play size={20}/></button>{/if}
          <section class="workout-hero"><div class="hero-copy"><p>Today's Workout</p><h1>{todaysWorkout?.name ?? 'Rest & Recover'}</h1><button class="primary-button" onclick={() => { if(todaysWorkout) { selectedDate = today; showWorkout(todaysWorkout); } else openSheet('templates'); }}>{todaysWorkout ? 'Get Started' : 'Explore Programs'}</button></div><img src="/images/hero.svg" alt="" class="hero-image"/></section>
          <div class="section-heading schedule-heading"><h2>This Week's Schedule</h2><button class="icon-button" aria-label="Program options" onclick={()=>activeProgram ? editProgram() : openSheet('templates')}><EllipsisVertical size={22}/></button></div>
          <div class="schedule-list">{#each weekDates(today) as day}
            {@const schedule = data.schedule.find(s => s.date === day)}{@const workout = data.programs.flatMap(p=>p.workouts).find(w => w.id === schedule?.workoutId)}{@const done = data.sessions.some(s => s.date === day && s.workoutId === workout?.id && s.finishedAt)}
            <div class="schedule-row"><span class="schedule-day" class:is-today={day === today}>{dayName(day).toUpperCase()}</span><div class="schedule-card" class:complete={done} class:rest={!workout}>
              <button class="schedule-main" onclick={() => { selectedDate = day; if(workout) showWorkout(workout); else openSheet(activeProgram ? 'session-menu' : 'templates'); }}><span class="icon-box">{#if workout}<Dumbbell size={25}/>{:else}<Timer size={25}/>{/if}</span><span class="schedule-copy">{#if done}<small>Complete <CheckCircle2 size={13}/></small>{/if}<strong>{workout?.name ?? 'Rest'}</strong></span></button>
              {#if !workout}<button class="add-workout" onclick={() => { selectedDate = day; openSheet('session-menu'); }}><Plus size={15} fill="currentColor"/><span>Add Workout</span></button>{:else if day === today && !done}<button class="start-schedule" onclick={() => { selectedDate = day; showWorkout(workout); }}><Play size={16}/>Start</button>{/if}
              <button class="icon-button" aria-label={`Options for ${dayName(day)} workout`} onclick={() => { selectedDate = day; editWorkoutId = workout?.id ?? ''; openSheet('session-menu'); }}><EllipsisVertical size={21}/></button>
            </div></div>
          {/each}</div>
          <div class="workout-bottom-actions"><button class="secondary-button" onclick={() => openProgramImport()}><FileText size={17}/>Import / Export</button><button class="secondary-button" onclick={() => openSheet('templates')}><Plus size={17}/>Choose a Program</button><button class="quiet-link" onclick={showHistory}><History size={18}/>Workout History</button></div>
        </main>
      {:else if activeTab === 'progress'}
        <main class="tab-content progress-content">
          <header class="standard-header"><h1>Progress</h1>{@render accountButtons()}</header>
          <section class="goal-card"><div class="goal-label"><span>CURRENT GOAL</span><button onclick={openGoal}>Change <ChevronRight size={15}/></button></div><h1>{goalName(data.profile.goal)}</h1><p>{data.profile.goal === 'build-muscle' ? 'Stronger, one workout at a time' : data.profile.goal === 'lose-fat' ? 'Build habits that last' : 'Keep showing up for yourself'}</p><div class="goal-meta"><span><Calendar size={15}/>Started <b>{new Date(`${data.profile.goalStartedAt}T12:00:00`).toLocaleDateString('en', {month:'short',day:'numeric',year:'numeric'})}</b></span>{#if data.profile.startWeight>0}<span><Scale size={15}/><b>{displayWeight(data.profile.startWeight)} {data.profile.unit}</b> at start</span>{:else}<button class="goal-start-weight" onclick={openGoal}><Scale size={15}/>Set your starting weight</button>{/if}</div></section>
          {#if data.goalPlans?.length}<button class="quiet-link" onclick={()=>openSheet('goal-details')}>View Goal Plan & Research</button>{/if}
          <button class="secondary-button" onclick={openProgressReview}><ChartLine size={19}/>Review My Progress</button>
          <section class="progress-card"><button class="progress-summary" onclick={() => progressSection = progressSection === 'weight' ? '' : 'weight'} aria-expanded={progressSection === 'weight'}><span class="icon-box"><Scale size={28}/></span><span class="progress-copy"><small>WEIGHT</small><strong>{currentWeight ? displayWeight(currentWeight.weight) : '—'} <em>{data.profile.unit}</em></strong><span>Last logged {currentWeight?.date === today ? 'today' : currentWeight?.date ?? 'never'}</span></span><span class="progress-side"><b class="weight-change">{currentWeight && previousWeight ? `${currentWeight.weight >= previousWeight.weight ? '+' : ''}${(displayWeight(currentWeight.weight)-displayWeight(previousWeight.weight)).toFixed(1)}` : '—'} {data.profile.unit}</b><small>Last 14 days</small></span><ChevronDown size={18} class={progressSection === 'weight' ? 'rotated' : ''}/></button>{#if progressSection === 'weight'}<div class="progress-expanded">{@render weightChart()}<button class="secondary-button" onclick={openWeight}><Plus size={17}/>Log Weight</button></div>{/if}</section>
          <section class="progress-card"><button class="progress-summary" onclick={() => progressSection = progressSection === 'nutrition' ? '' : 'nutrition'} aria-expanded={progressSection === 'nutrition'}><span class="icon-box"><Utensils size={28}/></span><span class="progress-copy"><small>NUTRITION</small><strong>{habitDays()} of 7 <em>days</em></strong><span>Logged this week</span></span><span class="progress-side"><b class="neutral-badge">{Math.max(0,Math.round(todayTargets.calories - todayNutrients.calories)).toLocaleString()} Cal</b><small>Remaining Today</small></span><ChevronDown size={18} class={progressSection === 'nutrition' ? 'rotated' : ''}/></button>{#if progressSection === 'nutrition'}<div class="progress-expanded"><div class="nutrition-history">{#each Array.from({length:7}, (_,i) => shiftDate(today,-6+i)) as day}{@const total = sumNutrients(data.foodEntries.filter(f => f.date === day))}<div><span>{dayName(day)}</span><i style:height="{Math.max(5,progress(total.calories,targetsForDate(data,day).calories)*.85)}px"></i><small>{Math.round(total.calories)}</small></div>{/each}</div><button class="quiet-link" onclick={() => selectTab('nutrition')}>Open your food log <ArrowRight size={16}/></button></div>{/if}</section>
          <section class="progress-card"><button class="progress-summary" onclick={() => progressSection = progressSection === 'workouts' ? '' : 'workouts'} aria-expanded={progressSection === 'workouts'}><span class="icon-box"><Dumbbell size={28}/></span><span class="progress-copy"><small>WORKOUTS</small><strong>{consistency()}% <em>consistent</em></strong><span>Last 3 weeks</span></span><span class="progress-side"><b class="trophy-badge"><Trophy size={14}/>{finishedSessions.filter(s => weekDates(today).includes(s.date)).length}</b><small>This week</small></span><ChevronDown size={18} class={progressSection === 'workouts' ? 'rotated' : ''}/></button>{#if progressSection === 'workouts'}<div class="progress-expanded"><p class="muted">{finishedSessions.length} workouts completed. Every session counts.</p><button class="secondary-button" onclick={showHistory}><History size={17}/>View Workout History</button></div>{/if}</section>
          <div class="section-heading checkin-heading"><h2>DAILY CHECK-INS</h2><button class="icon-button blue" aria-label="Add daily check-in" onclick={openCheckIn}><Plus size={23}/></button></div>
          <div class="checkin-history">{#each [...data.checkIns].sort((a,b) => b.date.localeCompare(a.date)).slice(0,14) as checkIn (checkIn.id)}<button class="history-checkin" onclick={() => { selectedDate = checkIn.date; openCheckIn(); }}><span class="checkin-date"><b>{new Date(`${checkIn.date}T12:00:00`).toLocaleDateString('en', {month:'short',day:'numeric'})}</b><small>{dayName(checkIn.date)}</small></span><span class="checkin-note"><strong>{displayWeight(checkIn.weight)} {data.profile.unit}</strong><small>{checkIn.notes || 'Daily check-in complete'}</small></span><ChevronRight size={18}/></button>{:else}<div class="empty-card"><Clipboard size={28}/><h3>A moment for your progress</h3><p>Check in with your weight and a note each day.</p><button class="primary-button" onclick={openCheckIn}>Check in</button></div>{/each}</div>
        </main>
      {:else if activeTab === 'lessons'}
        <main class="tab-content lessons-content">
          <header class="standard-header"><h1>Lessons</h1>{@render accountButtons()}</header>
          <section class="lesson-hero"><span class="eyebrow">YOUR KNOWLEDGE, YOUR PROGRESS</span><h2>Learn. Train. Grow.</h2><p>Keep the ideas that help you move forward.</p><BookOpen size={77} strokeWidth={1.1}/></section>
          <div class="section-heading library-heading"><h2>Your Library</h2><button class="icon-button blue" aria-label="Add lesson" onclick={() => openLesson()}><Plus size={25}/></button></div>
          <div class="lesson-search search-field"><Search size={20}/><input aria-label="Search your lessons" placeholder="Search your library" bind:value={lessonSearch}/></div>
          <div class="lesson-filters">{#each ['All','To learn','Completed'] as filter}<button class:active={lessonFilter === filter} onclick={() => lessonFilter = filter}>{filter}</button>{/each}</div>
          <div class="lesson-library">{#each visibleLessons as lesson (lesson.id)}<article class="lesson-card"><button class="lesson-main" onclick={() => openLesson(lesson)}><span class="lesson-icon"><BookOpen size={25}/></span><span class="lesson-copy"><small>{lesson.category} · {lesson.source}</small><strong>{lesson.title}</strong><span>{lesson.notes || 'Tap to add your notes'}</span></span><ChevronRight size={18}/></button><div class="lesson-card-bottom"><a href={lesson.url} target="_blank" rel="noopener noreferrer">Open lesson <ExternalLink size={13}/></a><button class:lesson-completed={lesson.completed} disabled={busy} aria-label={`${lesson.completed ? 'Mark incomplete' : 'Complete'} ${lesson.title}`} onclick={() => mutate(() => client.saveLesson({...lesson, completed: !lesson.completed}))}><CheckCircle2 size={15}/>{lesson.completed ? 'Completed' : 'Mark complete'}</button></div></article>{:else}<div class="empty-card"><BookOpen size={29}/><h3>{lessonSearch ? 'No matching lessons' : 'Make room for a good idea'}</h3><p>{lessonSearch ? 'Try a different search.' : 'Add a link and your own notes, or save a lesson below.'}</p><button class="secondary-button" onclick={() => openLesson()}><Plus size={17}/>Add a Lesson</button></div>{/each}</div>
          <div class="section-heading discover-heading"><h2>Explore & Learn</h2><span class="muted">Free resources</span></div>
          <div class="reading-list">{#each readings as reading}<article class="reading-card"><span class="reading-category">{reading.category}</span><h3>{reading.title}</h3><p>{reading.description}</p><div><a href={reading.url} target="_blank" rel="noopener noreferrer">{reading.source} <ExternalLink size={12}/></a><button aria-label={`Save ${reading.title} to library`} disabled={busy} onclick={() => saveReading(reading)}>{#if data.lessons.some(l => l.url === reading.url)}<Check size={16}/>Saved{:else}<Plus size={16}/>Save{/if}</button></div></article>{/each}</div>
        </main>
      {/if}
      {#if selectedDate !== today && (activeTab === 'dashboard' || activeTab === 'nutrition')}<button class="back-today" onclick={() => selectedDate = today}><Calendar size={19}/>Back to Today</button>{/if}
      <nav class="bottom-nav" aria-label="Main navigation">{#each tabs as tab}<button class:active={activeTab === tab.id} aria-current={activeTab === tab.id ? 'page' : undefined} onclick={() => selectTab(tab.id)}><tab.icon size={24} strokeWidth={2.1} fill={activeTab === tab.id && (tab.id === 'dashboard' || tab.id === 'nutrition') ? 'currentColor' : 'none'}/><span>{tab.label}</span></button>{/each}</nav>
    {:else if view === 'preview' && selectedWorkout}
      <header class="detail-header"><button class="icon-button" aria-label="Back to workouts" onclick={goBack}><ArrowLeft size={26}/></button><div><small>{selectedDate === today ? "Today's" : selectedDate === shiftDate(today,1) ? "Tomorrow's" : "Your"} Workout</small><h1>{selectedWorkout.name}<button class="icon-button muted" aria-label="Edit workout" onclick={editCurrentWorkout}><Pencil size={16}/></button></h1></div><button class="power-button" aria-label="Workout options" onclick={() => { editWorkoutId = selectedWorkout.id; openSheet('session-menu'); }}><Zap size={23} fill="currentColor"/></button></header>
      <main class="detail-content workout-preview">
        <h2>Target Muscles</h2><div class="muscle-carousel">{#each selectedWorkout.muscles as muscle}<div class="muscle-card"><img src={muscle.image} alt=""/><span>{muscle.name}<small>{muscle.percentage ? `${muscle.percentage}%` : ''}</small></span></div>{/each}</div>
        <div class="section-heading exercise-heading"><h2>{selectedWorkout.exercises.length} Exercises <button class="icon-button muted" aria-label="Add or edit exercises" onclick={editCurrentWorkout}><Plus size={27}/></button></h2><button class="icon-button muted" aria-label="Exercise history" onclick={showHistory}><History size={21}/></button></div>
        <div class="preview-exercises">{#each selectedWorkout.exercises as prescription,i (prescription.id)}{@const exercise = exerciseFor(prescription.exerciseId)}{@const groupStart = prescription.superset && selectedWorkout.exercises[i-1]?.superset !== prescription.superset}{@const groupEnd = prescription.superset && selectedWorkout.exercises[i+1]?.superset !== prescription.superset}<div class="preview-exercise" class:superset-start={groupStart} class:superset-middle={prescription.superset && !groupStart && !groupEnd} class:superset-end={groupEnd && !groupStart}><button class="preview-exercise-main" onclick={() => guide(exercise.id)}>{@render exerciseImage(exercise)}<span>{#if groupStart}<small class="superset-label"><b>{prescription.sets} SETS</b> · SUPERSET <Zap size={12} fill="currentColor"/></small>{/if}<strong>{exercise.name}</strong><small>{#if !prescription.superset}<b>{prescription.sets} sets</b> · {/if}{reps(prescription)}</small></span></button><button class="icon-button" aria-label={`Edit ${exercise.name}`} onclick={() => { const owner=data?.programs.find(p=>p.workouts.some(w=>w.id===selectedWorkout!.id)); if(owner) {programDraft=clone(owner); editWorkoutId=selectedWorkout.id; editPrescription(prescription);} }}><EllipsisVertical size={23}/></button></div>{/each}</div>
      </main><div class="workout-footer"><button class="outline-button" onclick={() => openSheet('warmup')}>See Warmup</button><button class="primary-button" disabled={busy} onclick={startWorkout}>{unfinished ? 'Resume Workout' : 'Start Workout'}</button></div>
    {:else if view === 'session' && sessionDraft}
      <header class="session-header"><div class="session-title-row"><button class="icon-button" aria-label="Back to workouts" onclick={goBack}><ArrowLeft size={25}/></button><div class="session-title"><small>Today's Workout</small><h1>{sessionDraft.name}</h1></div><button class="finish-button" disabled={busy} onclick={finishWorkout}><CheckCircle2 size={18}/>Finish</button></div><div class="session-progress"><span><Timer size={16}/>{elapsed(sessionDraft)}</span><div class="session-track"><i style:width="{totalSets ? completion/totalSets*100 : 0}%"></i></div><small>{completedExercises}/{sessionDraft.exercises.length}</small></div></header>
      <main class="session-content">{#each sessionDraft.exercises as sessionExercise (sessionExercise.id)}{@const exercise = exerciseFor(sessionExercise.exerciseId)}<section class="session-exercise" class:all-complete={sessionExercise.sets.every(s => s.completed)}><div class="session-exercise-heading"><button class="session-guide" onclick={() => guide(exercise.id)}>{@render exerciseImage(exercise)}<span><strong>{exercise.name}</strong><small>{reps(sessionExercise.prescription)}</small></span></button><button class="icon-button" aria-label={`Options for ${exercise.name}`} onclick={() => { selectedSessionExerciseId = sessionExercise.id; openSheet('session-menu'); }}><EllipsisVertical size={21}/></button><button class="icon-button" aria-label={`${collapsed[sessionExercise.id] ? 'Expand' : 'Collapse'} ${exercise.name}`} onclick={() => collapsed[sessionExercise.id] = !collapsed[sessionExercise.id]}>{#if collapsed[sessionExercise.id]}<ChevronDown size={21}/>{:else}<ChevronUp size={21}/>{/if}</button></div>
      {#if !collapsed[sessionExercise.id]}<label class="notes-label" for={`notes-${sessionExercise.id}`}><Pencil size={17} fill="currentColor"/>NOTES</label><textarea class="session-notes" id={`notes-${sessionExercise.id}`} value={sessionExercise.notes} oninput={(e)=>sessionExercise.notes=e.currentTarget.value} onchange={persistSession} placeholder="Add notes…" rows="1"></textarea>
        <div class="set-table" class:bodyweight={!exercise.weighted}><div class="set-table-heading"><span>SET</span><span>PREVIOUS</span>{#if exercise.weighted}<span>{data.profile.unit.toUpperCase()}</span>{/if}<span>{sessionExercise.prescription.seconds ? 'SEC' : 'REPS'}</span><span>EFFORT</span><span class="sr-only">Complete</span></div>
        {#each sessionExercise.sets as set,index (set.id)}<div class="set-row" class:set-complete={set.completed}><span class="set-number">{index+1}</span><span class="previous-value">{previousSet(exercise.id,index)}</span>{#if exercise.weighted}<input type="number" min="0" max="2000" step="0.5" inputmode="decimal" aria-label={`${exercise.name} set ${index+1} weight`} value={displayWeight(set.weight)} oninput={(e) => set.weight = toKg(Number(e.currentTarget.value))} onchange={persistSession}/>{/if}<input type="number" min="0" max="500" inputmode="numeric" aria-label={`${exercise.name} set ${index+1} ${sessionExercise.prescription.seconds ? 'seconds' : 'reps'}`} value={set.reps} oninput={(e)=>set.reps=Number(e.currentTarget.value)} onchange={persistSession}/><button class="effort-button" class:has-effort={!!set.effort} class:hard={set.effort === 'hard'} class:medium={set.effort === 'medium'} aria-label={`Effort for ${exercise.name} set ${index+1}${set.effort ? `: ${set.effort}` : ''}`} onclick={() => showEffort(sessionExercise.id,set.id)}>{set.effort ? set.effort.slice(0,1).toUpperCase() : '—'}</button><button class="complete-set" class:checked={set.completed} aria-label={`${set.completed ? 'Uncomplete' : 'Complete'} ${exercise.name} set ${index+1}`} aria-pressed={set.completed} disabled={busy} onclick={() => completeSet(sessionExercise,set.id)}><Check size={17}/></button></div>{/each}</div>
        <div class="session-exercise-actions"><button onclick={() => { restSeconds = sessionExercise.prescription.restSeconds; selectedSessionExerciseId = sessionExercise.id; openSheet('rest'); }}><Timer size={16} fill="currentColor"/>Rest: {time(sessionExercise.prescription.restSeconds)}</button><button disabled={busy} onclick={() => { sessionExercise.sets.push({id:id('set'),weight:0,reps:0,effort:null,completed:false}); persistSession(); }}><Plus size={19}/>Add Set</button></div>
      {/if}</section>{/each}</main>
      {#if remainingRest > 0}<div class="rest-floating" role="status"><Timer size={22}/><span><small>Rest timer</small><b data-testid="rest-countdown">{time(remainingRest)}</b></span><button aria-label="Add 30 seconds rest" onclick={() => { if(sessionDraft) sessionDraft.restDeadline = new Date(new Date(sessionDraft.restDeadline!).getTime()+30000).toISOString(); persistSession(); }}>+30s</button><button class="icon-button" aria-label="Skip rest" onclick={() => { if(sessionDraft) sessionDraft.restDeadline = null; persistSession(); }}><X size={20}/></button></div>{/if}
    {:else if view === 'program-edit' && programDraft}
      <header class="edit-program-header"><button class="icon-button" aria-label="Cancel editing program" onclick={goBack}><ArrowLeft size={25}/></button><h1>Edit Program</h1><button class="save-program-button" disabled={busy} onclick={saveProgram}>Save</button></header>
      <main class="edit-program-content"><button class="secondary-button" onclick={() => openProgramImport(programDraft!)}>Export Program JSON</button>{#if programDraft.details}<button class="quiet-link" onclick={() => { guideProgram=clone(programDraft!);openSheet('program-guide'); }}>Progression &amp; Nutrition Guidance</button>{/if}<label for="program-name">Program name</label><input id="program-name" bind:value={programDraft.name} maxlength="100"/><div class="workout-picker">{#each programDraft.workouts as workout}<button class:active={editWorkoutId === workout.id} onclick={() => editWorkoutId = workout.id}>{workout.name}</button>{/each}</div>
        {#if editingWorkout}<section class="program-day-card"><div class="section-heading"><div><small class="muted">DAY {programDraft.workouts.indexOf(editingWorkout)+1}</small><h2>{editingWorkout.name}</h2></div><button class="icon-button" aria-label="Rename workout" onclick={() => { workoutName = editingWorkout.name; openSheet('workout-settings'); }}><Pencil size={20}/></button></div><div class="thin-divider"></div><h3>Target Muscles</h3><div class="program-muscles">{#each editingWorkout.muscles as muscle}<div><img src={muscle.image} alt=""/><span>{muscle.name}</span></div>{/each}</div><div class="section-heading"><h3>Exercises</h3><button class="icon-button blue" aria-label="Add exercise" onclick={() => { search=''; openSheet('exercise-picker'); }}><Plus size={23}/></button></div><div class="editing-exercises">{#each editingWorkout.exercises as p,index (p.id)}{@const exercise=exerciseFor(p.exerciseId)}<article class="editing-exercise"><button class="editing-exercise-main" onclick={() => editPrescription(p)}>{@render exerciseImage(exercise)}<span>{#if p.superset}<small class="superset-label">{p.sets} SETS · SUPERSET</small>{/if}<strong>{exercise.name}</strong><small><b>{p.sets} sets</b> · {reps(p)}</small></span></button><div class="editing-actions"><button class="icon-button" disabled={index===0} aria-label={`Move ${exercise.name} up`} onclick={() => moveExercise(index,-1)}><ArrowUp size={17}/></button><button class="icon-button" disabled={index===editingWorkout.exercises.length-1} aria-label={`Move ${exercise.name} down`} onclick={() => moveExercise(index,1)}><ArrowDown size={17}/></button><button class="icon-button danger" aria-label={`Remove ${exercise.name}`} onclick={() => { if(editingWorkout) editingWorkout.exercises = editingWorkout.exercises.filter(item => item.id !== p.id); }}><Trash2 size={17}/></button></div></article>{/each}</div><button class="outline-button add-exercise-button" onclick={() => { search=''; openSheet('exercise-picker'); }}><Plus size={18}/>Add Exercise</button></section>{/if}
      </main>
    {:else if view === 'history'}
      <header class="detail-header history-header"><button class="icon-button" aria-label="Back to workouts" onclick={goBack}><ArrowLeft size={25}/></button><h1>Workout History</h1></header><main class="history-content">{#each finishedSessions as session (session.id)}<button class="history-session" onclick={() => { historySession=clone(session); openSheet('history-detail'); }}><span class="icon-box"><Dumbbell size={25}/></span><span><strong>{session.name}</strong><small>{new Date(session.startedAt).toLocaleDateString('en', {month:'short',day:'numeric',year:'numeric'})} · {elapsed(session)} · {session.exercises.reduce((n,e) => n+e.sets.filter(s => s.completed).length,0)} sets</small></span><ChevronRight size={20}/></button>{:else}<div class="empty-card"><History size={30}/><h3>Your next chapter starts here</h3><p>Finish a workout to see it in your history.</p></div>{/each}</main>
    {/if}
  </div>
{/if}

{#if notice}<div class="toast" role="status"><CheckCircle2 size={17}/>{notice}</div>{/if}
{#if busy}<div class="request-progress" aria-label="Saving" role="status"></div>{/if}
<Sheet bind:open={sheetOpen} title={sheetTitle} description={sheet === 'effort' ? 'Choose your own effort level. Your effort rating is separate from completing a set.' : ''}>
  {#if error}<div class="form-error" role="alert">{error}</div>{/if}
  {#if sheet === 'progress-review'}
    {#if progressReport}<ProgressReview report={progressReport} onworkout={reviewWorkout} onnutrition={reviewTargets} onrefresh={()=>void loadProgressReview()} refreshing={progressReviewLoading}/>{:else if progressReviewLoading}<p role="status" class="muted">Reviewing your recorded progress…</p>{:else}<button class="secondary-button" onclick={()=>void loadProgressReview()}>Retry Review</button>{/if}
  {:else if sheet === 'checkin' && checkInDraft}
    <form onsubmit={saveCheckIn}><p class="muted form-intro">{dateTitle(checkInDraft.date)} · a moment to check in with yourself.</p><label for="checkin-weight">Weight ({data?.profile.unit ?? 'kg'})</label><input id="checkin-weight" type="number" min="1" max="1000" step=".1" inputmode="decimal" bind:value={weightDraft} required/><label for="checkin-notes">Notes</label><textarea id="checkin-notes" bind:value={checkInDraft.notes} placeholder="How was your day?" rows="4" maxlength="3000"></textarea><button class="primary-button" disabled={busy}>Save Check-in</button></form>
  {:else if sheet === 'weight'}
    <form onsubmit={async(e) => {e.preventDefault(); if(await mutate(() => client.saveWeight({id:id('weight'),date:selectedDate,weight:toKg(weightDraft)}),true)) toast('Weight saved'); }}><p class="muted form-intro">{dateTitle()}</p><label for="weight-value">Weight ({data?.profile.unit ?? 'kg'})</label><input id="weight-value" type="number" min="1" max="1000" step=".1" inputmode="decimal" bind:value={weightDraft} required/><button class="primary-button" disabled={busy}>Save Weight</button></form>
  {:else if sheet === 'targets' && targetDraft}
    <p class="muted form-intro">Calculate a starting point, or set your own targets. Changes apply from {dateTitle(targetDraft.effectiveDate).toLowerCase()} onward.</p>
    <button class="secondary-button calculator-entry" disabled={busy} onclick={openCalculator}><ChartLine size={18}/>Calculate Targets</button>
    {#if targetDraft.calculation}<div class="calculation-saved"><span class="eyebrow">{targetDraft.mode === 'manual' ? 'MANUAL OVERRIDE' : 'CALCULATED TARGETS'}</span><p>{targetDraft.calculation.version === 'apple-health-energy-v1' ? 'Apple Health resting + active energy' : 'Mifflin–St Jeor'} · {targetDraft.calculation.input.proteinPerKg} g/kg protein · {targetDraft.calculation.input.fatPercent}% fat</p><small>Original calculation: {targetDraft.calculation.input.effectiveDate}. Editing values keeps these inputs for reference.</small></div>{/if}
    <form onsubmit={saveManualTargets}><div class="form-grid"><div><label for="target-calories">Calories</label><input id="target-calories" type="number" min="500" max="10000" inputmode="numeric" bind:value={targetDraft.calories} required/></div><div><label for="target-protein">Protein (g)</label><input id="target-protein" type="number" min="0" max="1000" inputmode="numeric" bind:value={targetDraft.protein} required/></div><div><label for="target-carbs">Carbs (g)</label><input id="target-carbs" type="number" min="0" max="2000" inputmode="numeric" bind:value={targetDraft.carbs} required/></div><div><label for="target-fat">Fat (g)</label><input id="target-fat" type="number" min="0" max="1000" inputmode="numeric" bind:value={targetDraft.fat} required/></div></div><button class="primary-button" disabled={busy}>Save Targets</button></form>
  {:else if sheet === 'calculate' && calculatorDraft}
    <p class="muted form-intro">Enter your details, then review the calorie and macro estimate. Your saved targets stay as they are until you apply it.</p>
    <form onsubmit={previewTargets}>
      <fieldset class="calculator-fields" disabled={busy}>
        <div class="form-grid">
          <div><label for="calculation-age">Age</label><input id="calculation-age" type="number" min="18" max="100" step="1" inputmode="numeric" bind:value={calculatorDraft.age} placeholder="Years" required/></div>
          <div><label for="calculation-sex">Equation sex</label><select id="calculation-sex" bind:value={calculatorDraft.sex} required><option value="" disabled>Choose</option><option value="female">Female</option><option value="male">Male</option></select></div>
          <div><label for="calculation-height">Height (cm)</label><input id="calculation-height" type="number" min="100" max="250" step="any" inputmode="decimal" bind:value={calculatorDraft.heightCm} placeholder="Centimeters" required/></div>
          <div><label for="calculation-weight">Weight ({data?.profile.unit ?? 'kg'})</label><input id="calculation-weight" type="number" min={displayWeight(30)} max={displayWeight(350)} step="any" inputmode="decimal" bind:value={calculatorWeight} placeholder={data?.profile.unit === 'lb' ? 'Pounds' : 'Kilograms'} required/></div>
        </div>
        {#if calculatorWeightSource}<p class="source-label calculation-weight-source">{calculatorWeightSource}. You can change this value.</p>{/if}
        <label for="calculation-activity">Activity level</label><select id="calculation-activity" bind:value={calculatorDraft.activity} required><option value="" disabled>Choose your activity level</option><option value="sedentary">Sedentary · 1.2</option><option value="light">Lightly active · 1.375</option><option value="moderate">Moderately active · 1.55</option><option value="active">Active · 1.725</option><option value="very-active">Very active · 1.9</option></select>
        <div class="form-grid"><div><label for="calculation-goal">Goal</label><select id="calculation-goal" bind:value={calculatorDraft.goal} onchange={changeCalculationGoal}><option value="build-muscle">Build Muscle</option><option value="maintain">Maintain</option><option value="lose-fat">Lose Fat</option></select></div><div><label for="calculation-date">Effective date</label><input id="calculation-date" type="date" bind:value={calculatorDraft.effectiveDate} required/></div></div>
        <div class="calculator-settings"><h3>Adjust your estimate</h3><p>App starting settings: +250 calories for muscle gain, 0 for maintenance, −300 for fat loss; 1.6 g/kg protein and 25% fat. These are editable.</p></div>
        <label for="calculation-adjustment">Calorie adjustment (kcal/day)</label><input id="calculation-adjustment" type="number" min="-500" max="500" step="any" inputmode="decimal" bind:value={calculatorDraft.calorieAdjustment} required/>
        <div class="form-grid"><div><label for="calculation-protein">Protein (g/kg/day)</label><input id="calculation-protein" type="number" min=".8" max="3" step="any" inputmode="decimal" bind:value={calculatorDraft.proteinPerKg} required/></div><div><label for="calculation-fat">Fat (% of calories)</label><input id="calculation-fat" type="number" min="15" max="40" step="any" inputmode="decimal" bind:value={calculatorDraft.fatPercent} required/></div></div>
      </fieldset>
      <button class="primary-button" disabled={busy}>{#if busy}<LoaderCircle size={18} class="spin"/>{/if}Preview Targets</button>
      <button class="quiet-link calculator-cancel" type="button" disabled={busy} onclick={cancelCalculation}>Cancel</button>
    </form>
  {:else if sheet === 'calculate-preview' && calculatorPreview?.calculation}
    {@const calculation = calculatorPreview.calculation}
    {@const input = calculation.input}
    <p class="muted form-intro">Review this starting estimate before applying it from {dateTitle(calculatorPreview.effectiveDate).toLowerCase()}.</p>
    {#if calculatorOffline}<div class="preview-callout"><Info size={17}/><span>Calculated on this device while offline, using the same Mifflin–St Jeor equation. Apply to save it here and sync when connected.</span></div>{/if}
    <section class="calculation-totals" aria-label="Calculated nutrition targets"><div class="calculation-calories"><strong data-testid="calculated-calories">{calculatorPreview.calories.toLocaleString('en')}</strong><span>calories / day</span></div><div class="calculation-macros"><div><strong data-testid="calculated-protein">{calculatorPreview.protein}</strong><span>g Protein</span></div><div><strong data-testid="calculated-carbs">{calculatorPreview.carbs}</strong><span>g Carbs</span></div><div><strong data-testid="calculated-fat">{calculatorPreview.fat}</strong><span>g Fat</span></div></div></section>
    <dl class="calculation-breakdown"><div><dt>Equation</dt><dd>Mifflin–St Jeor</dd></div><div class="calculation-equation"><dt>Resting formula</dt><dd>10 × {input.weightKg} + 6.25 × {input.heightCm} − 5 × {input.age} {input.sex === 'male' ? '+ 5' : '− 161'}</dd></div><div><dt>Resting calories</dt><dd>{calculation.restingCalories.toLocaleString('en')} kcal</dd></div><div><dt>Activity multiplier</dt><dd>{input.activity.replace('-', ' ')} × {ACTIVITY_FACTORS[input.activity]}</dd></div><div><dt>Estimated maintenance</dt><dd>{calculation.maintenanceCalories.toLocaleString('en')} kcal/day</dd></div><div><dt>Calorie adjustment</dt><dd>{input.calorieAdjustment > 0 ? '+' : ''}{input.calorieAdjustment} kcal/day</dd></div><div><dt>Goal</dt><dd>{input.goal === 'build-muscle' ? 'Build Muscle' : input.goal === 'lose-fat' ? 'Lose Fat' : 'Maintain'}</dd></div><div><dt>Protein setting</dt><dd>{input.proteinPerKg} g/kg/day</dd></div><div><dt>Fat setting</dt><dd>{input.fatPercent}% of calories</dd></div><div><dt>Effective date</dt><dd>{calculatorPreview.effectiveDate}</dd></div></dl>
    <p class="source-label">Mifflin–St Jeor estimates resting energy. Activity multipliers, goal adjustments, and macro allocations follow the app settings you chose. Version {calculation.version}.</p>
    <div class="calculation-actions"><button class="secondary-button" disabled={busy} onclick={editCalculation}><Pencil size={17}/>Edit Inputs</button><button class="primary-button" disabled={busy} onclick={applyTargets}><Check size={18}/>Apply Targets</button></div><button class="quiet-link calculator-cancel" disabled={busy} onclick={cancelCalculation}>Cancel</button>
  {:else if sheet === 'food-search'}
    <div class="form-intro"><label for="food-meal">Add to</label><select id="food-meal" bind:value={selectedMeal}>{#each MEALS as meal}<option>{meal}</option>{/each}</select></div><form class="search-field" onsubmit={(e) => {e.preventDefault(); searchFoods(); }}><Search size={21}/><input aria-label="Search foods" placeholder="Search a food or ingredient" bind:value={search} oninput={()=>{if(isMockPreview) scheduleFoodSearch();}}/>{#if !isMockPreview}<button class="food-search-submit" type="submit">Search</button>{/if}</form>{#if foodSearching}<p class="source-label" role="status">Searching foods…</p>{/if}<div class="food-search-results">{#each foodResults as food}<button onclick={() => selectFood(food)}><span><strong>{food.name}</strong><small>{food.serving} · {food.source}</small></span><span>{food.calories} <small>cal</small></span><Plus size={20} class="blue"/></button>{:else}{#if !foodSearching}<p class="muted">{search ? 'No matching foods. Add a food manually below.' : 'Search for a food, or add your own serving below.'}</p>{/if}{/each}</div><button class="secondary-button" onclick={manualFood}><Plus size={18}/>Add Food Manually</button><button class="quiet-link" onclick={openPhoto}><Camera size={18}/>Estimate from Photo</button>
  {:else if sheet === 'food-edit' && foodDraft}
    <form onsubmit={saveFood}><label for="food-name">Food name</label><input id="food-name" bind:value={foodDraft.name} required maxlength="200"/><div class="form-grid"><div><label for="entry-meal">Meal</label><select id="entry-meal" bind:value={foodDraft.meal} onchange={() => selectedMeal=foodDraft!.meal}>{#each MEALS as meal}<option>{meal}</option>{/each}</select></div><div><label for="food-quantity">Quantity</label><input id="food-quantity" type="number" min=".001" max="10000" step="any" inputmode="decimal" value={foodDraft.quantity} oninput={(e)=>updateQuantity(Number(e.currentTarget.value))} required/></div></div><label for="food-serving">Serving size</label><input id="food-serving" bind:value={foodDraft.serving} required/><div class="form-grid nutrients-form">{#each [['calories','Calories'],['protein','Protein (g)'],['carbs','Carbs (g)'],['fat','Fat (g)']] as [key,label]}<div><label for={`food-${key}`}>{label}</label><input id={`food-${key}`} type="number" min="0" max={key === 'calories' ? 100000 : 10000} step="any" inputmode="decimal" bind:value={foodDraft[key as 'calories'|'protein'|'carbs'|'fat']} required/></div>{/each}</div><p class="source-label">{foodDraft.source === 'ai-estimate' ? `${isMockPreview ? 'Preview AI estimate' : 'AI estimate'} · review before saving` : foodDraft.source === 'manual' ? 'Your custom food · values for the selected quantity' : 'Database food · values for the selected quantity'}</p>{#if foodDraft.databaseSource}<p class="source-label database-source" data-testid="food-database-source">{foodDraft.databaseSource}</p>{/if}<button class="primary-button" disabled={busy}>Save Food</button>{#if data?.foodEntries.some(f => f.id === foodDraft?.id)}<button type="button" class="danger-link" disabled={busy} onclick={() => mutate(() => client.deleteFood(foodDraft!.id),true)}>Delete Food</button>{/if}</form>
  {:else if sheet === 'meal-photo'}
    <p class="muted form-intro">Choose a meal photo, review the estimate, then save it to your log.</p>{#if isMockPreview}<div class="preview-callout"><Info size={17}/><span>Preview only · the sample estimate is simulated and does not analyze your photo.</span></div>{:else}<p class="source-label">Your photo is sent to the configured AI provider. Estimates can be inaccurate; review and edit every item before saving. JPEG or PNG, up to 7 MB.</p>{#if !data?.provider.enabled || !data?.provider.configured}<div class="preview-callout"><Info size={17}/><span>A configured AI provider is needed to estimate your meal. An administrator can add it in AI Provider Settings.</span></div>{/if}{/if}<label class="photo-drop" for="meal-image">{#if photoURL}<img src={photoURL} alt="Your selected meal"/><span>Change photo</span>{:else}<Camera size={36}/><strong>Add a meal photo</strong><span>Take a photo or choose from your library</span>{/if}</label><input class="sr-only" id="meal-image" aria-label="Meal photo" type="file" accept={isMockPreview ? 'image/*' : 'image/jpeg,image/png'} capture="environment" onchange={fileChanged}/>
    {#if !mealEstimate}<button class="primary-button" disabled={busy || !photo} onclick={estimatePhoto}>{#if busy}<LoaderCircle class="spin" size={18}/>{/if}Estimate Nutrition</button>{:else}<form onsubmit={saveEstimate}><div class="estimate-warning"><strong>Review your estimate</strong><p>{mealEstimate.assumptions}</p></div><label for="estimate-meal">Meal</label><select id="estimate-meal" bind:value={selectedMeal}>{#each MEALS as meal}<option>{meal}</option>{/each}</select>{#each estimateItems as item,i}<section class="estimate-item"><label for={`estimate-name-${i}`}>Food {i+1}</label><input id={`estimate-name-${i}`} bind:value={item.name} required/><div class="form-grid">{#each [['calories','Calories'],['protein','Protein (g)'],['carbs','Carbs (g)'],['fat','Fat (g)']] as [key,label]}<div><label for={`estimate-${i}-${key}`}>{label}</label><input id={`estimate-${i}-${key}`} type="number" min="0" max="10000" step="any" bind:value={item[key as 'calories'|'protein'|'carbs'|'fat']} required/></div>{/each}</div></section>{/each}<button class="primary-button" disabled={busy}>Save Meal to Log</button></form>{/if}
  {:else if sheet === 'copy'}
    <form onsubmit={copyFoodLog}><p class="muted form-intro">Copy meals from a previous day into {dateTitle().toLowerCase()}. Existing foods stay in your log.</p><label for="copy-date">Copy from</label><input id="copy-date" type="date" bind:value={copyDate} required max={shiftDate(selectedDate,-1)}/><button class="primary-button" disabled={busy}>Copy Food Log</button></form>
  {:else if sheet === 'warmup' && selectedWorkout}
    <p class="muted form-intro">A few minutes to get ready for {selectedWorkout.name}.</p><ol class="warmup-list">{#each selectedWorkout.warmup as step}<li><span>{step}</span></li>{/each}</ol><button class="primary-button" disabled={busy} onclick={async()=>{sheetOpen=false; await startWorkout(); }}>Start Workout</button>
  {:else if sheet === 'exercise-detail' && selectedGuide}
    <div class="exercise-guide-image">{@render exerciseImage(selectedGuide)}</div><h2 class="guide-title">{selectedGuide.name}</h2><p class="muted">{selectedGuide.equipment} · {selectedGuide.muscles.map(m=>muscles.find(item=>item.id===m)?.name??m).join(', ')}</p>{#if selectedGuide.sourceName || selectedGuide.sourceNote}<div class="guide-source-note"><strong>Technique reference: {selectedGuide.sourceName ?? selectedGuide.name}</strong>{#if selectedGuide.sourceNote}<p>{selectedGuide.sourceNote}</p>{/if}</div>{/if}<h3 class="guide-subtitle">How to perform</h3><ol class="guide-steps">{#each selectedGuide.instructions as step}<li>{step}</li>{:else}<li>Set up the equipment securely and use a controlled, comfortable range of motion.</li>{/each}</ol>{#if selectedGuide.source}<a class="quiet-link" href={selectedGuide.source} target="_blank" rel="noopener noreferrer">Exercise source <ExternalLink size={15}/></a>{/if}
  {:else if sheet === 'effort'}
    <div class="effort-options">{#each [{value:'easy',label:'Easy',description:'Comfortable. Plenty left in the tank.',color:'green'},{value:'medium',label:'Medium',description:'Challenging, but under control.',color:'blue'},{value:'hard',label:'Hard',description:'A tough set. You gave it your all.',color:'yellow'}] as option}<button class={`effort-option ${option.color}`} disabled={busy} onclick={()=>setEffort(option.value as Effort)}><span class="effort-dot"></span><span><strong>{option.label}</strong><small>{option.description}</small></span><ChevronRight size={20}/></button>{/each}<button class="quiet-link" disabled={busy} onclick={()=>setEffort(null)}>Clear effort rating</button></div>
  {:else if sheet === 'rest'}
    <form onsubmit={async(e)=>{e.preventDefault(); if(sessionDraft) { sessionDraft.restDeadline=new Date(Date.now()+restSeconds*1000).toISOString(); sessionDraft.restDuration=restSeconds; if(await persistSession()) sheetOpen=false; } }}><label for="rest-duration">Rest duration (seconds)</label><input id="rest-duration" type="number" min="5" max="900" step="5" inputmode="numeric" bind:value={restSeconds} required/><div class="rest-presets">{#each [30,60,90,120] as seconds}<button type="button" class:active={restSeconds===seconds} onclick={()=>restSeconds=seconds}>{time(seconds)}</button>{/each}</div><button class="primary-button" disabled={busy}><Timer size={18}/>Start Rest Timer</button></form>
  {:else if sheet === 'program-import' && data}
    {#if libraryError}<p role="alert" class="source-label">{libraryError}</p><button class="quiet-link" disabled={libraryLoading} onclick={() => loadProgramLibrary()}>Reload Library</button>{/if}
    <ProgramImport programs={data.programs} templates={programLibrary} admin={data.profile.role==='admin'} initialText={importText} sharedReady={libraryLoaded && !libraryLoading} onimport={importProgramDocument} onpublish={publishProgramDocument}/>
  {:else if sheet === 'program-guide' && guideProgram}
    <ProgramGuide program={guideProgram}/><button class="secondary-button" onclick={() => openProgramImport(guideProgram!)}>Export Plan JSON</button>
  {:else if sheet === 'templates'}
    <button class="secondary-button" onclick={() => openProgramImport()}><FileText size={17}/>Import / Export Programs</button>
    {#if libraryLoading}<p class="source-label" role="status">Loading program library…</p>{/if}{#if libraryError}<p class="source-label" role="alert">{libraryError} Showing bundled plans.</p><button class="quiet-link" onclick={() => loadProgramLibrary()}>Reload Library</button>{/if}
    <p class="muted form-intro">Choose a starting point. Your program is a private, editable copy. Select a day on your schedule to assign its workouts.</p>{#if data && data.programs.length>1}<h3 class="guide-subtitle">Your Programs</h3><div class="action-list">{#each data.programs as program}<button disabled={busy} onclick={()=>mutate(()=>client.saveProgram(clone(program)),true)}><Dumbbell size={18}/>{program.name}{#if program.id===data.activeProgramId}<Check size={17}/>{/if}</button>{/each}</div><h3 class="guide-subtitle">Starter Templates</h3>{/if}<div class="template-list">{#each programLibrary as template}<article class="template-card"><span class="eyebrow">{template.level} · {template.daysPerWeek} DAYS / WEEK</span><h3>{template.name}</h3><p>{template.description}</p>{#if template.sourceName}<p class="source-label">{template.details ? 'Evidence:' : template.adaptationNote ? 'Adapted from' : 'Source:'} {template.sourceName}</p>{/if}{#if template.adaptationNote}<p class="source-label">{template.adaptationNote}</p>{/if}<div class="template-detail"><Dumbbell size={15}/>{template.equipment}</div><button class="quiet-link" onclick={() => {guideProgram=clone(template);openSheet('program-guide');}}>Preview Plan</button><div class="template-actions"><a href={template.source} target="_blank" rel="noopener noreferrer">View source <ExternalLink size={13}/></a><button class="primary-button" disabled={busy} onclick={()=>useProgram(template.id)}>Use Program</button></div></article>{/each}</div>
  {:else if sheet === 'exercise-picker'}
    <div class="search-field"><Search size={20}/><input aria-label="Search exercises" bind:value={search} placeholder="Search an exercise"/></div><div class="exercise-picker-results">{#each exercises.filter(e=>`${e.name} ${e.equipment}`.toLowerCase().includes(search.toLowerCase())) as exercise}<button onclick={()=>addExercise(exercise.id)}>{@render exerciseImage(exercise)}<span><strong>{exercise.name}</strong><small>{exercise.equipment}</small></span><Plus size={20} class="blue"/></button>{/each}</div>
  {:else if sheet === 'prescription' && prescriptionDraft}
    <form onsubmit={(e)=>{applyPrescription(e); if(view==='preview' && programDraft) mutate(()=>client.saveProgram(clone(programDraft!))); }}><h3 class="form-intro">{exerciseFor(prescriptionDraft.exerciseId).name}</h3><div class="form-grid"><div><label for="prescription-sets">Sets</label><input id="prescription-sets" type="number" min="1" max="20" bind:value={prescriptionDraft.sets} required/></div><div><label for="prescription-rest">Rest (seconds)</label><input id="prescription-rest" type="number" min="5" max="900" bind:value={prescriptionDraft.restSeconds} required/></div><div><label for="prescription-min">Minimum reps</label><input id="prescription-min" type="number" min="1" max="500" bind:value={prescriptionDraft.repsMin} required/></div><div><label for="prescription-max">Maximum reps</label><input id="prescription-max" type="number" min={prescriptionDraft.repsMin} max="500" bind:value={prescriptionDraft.repsMax} required/></div></div><label for="prescription-superset">Superset group (optional)</label><select id="prescription-superset" bind:value={prescriptionDraft.superset}><option value="">None</option>{#if prescriptionDraft.superset && !['A','B','C'].includes(prescriptionDraft.superset)}<option value={prescriptionDraft.superset}>Current superset group</option>{/if}<option value="A">A</option><option value="B">B</option><option value="C">C</option></select><label class="checkbox-label"><input type="checkbox" bind:checked={prescriptionDraft.perSide}/>Reps per side</label><button class="primary-button" disabled={busy}>Save Exercise</button></form>
  {:else if sheet === 'workout-settings'}
    <form onsubmit={(e)=>{e.preventDefault(); if(editingWorkout) editingWorkout.name=workoutName; sheetOpen=false; }}><label for="workout-name">Workout name</label><input id="workout-name" bind:value={workoutName} maxlength="100" required/><button class="primary-button">Save Workout Name</button></form>
  {:else if sheet === 'session-menu'}
    <div class="action-list">{#if view === 'session' && sessionDraft}<button onclick={()=>{const item=sessionDraft?.exercises.find(e=>e.id===selectedSessionExerciseId); if(item) guide(item.exerciseId); }}><BookOpen size={19}/>Exercise Guide</button><button onclick={()=>{const item=sessionDraft?.exercises.find(e=>e.id===selectedSessionExerciseId); if(item) {restSeconds=item.prescription.restSeconds; openSheet('rest');} }}><Timer size={19}/>Set Rest Timer</button>{:else}<p class="muted form-intro">{dateTitle()} · choose a workout for this day</p>{#each activeProgram?.workouts ?? [] as workout}<button disabled={busy} onclick={()=>mutate(()=>client.assignWorkout(selectedDate,workout.id),true)}><Dumbbell size={20}/>{workout.name}<ChevronRight size={18}/></button>{/each}<button disabled={busy} onclick={()=>mutate(()=>client.assignWorkout(selectedDate,null),true)}><Timer size={20}/>Make this a Rest Day</button>{#if activeProgram}<button onclick={()=>{sheetOpen=false; editProgram(); }}><Pencil size={20}/>Edit Program</button>{/if}<button onclick={()=>openSheet('templates')}><Plus size={20}/>Choose a Program</button>{/if}</div>
  {:else if (sheet === 'lesson-edit' || sheet === 'lesson-detail') && lessonDraft}
    <form onsubmit={saveLesson}><label for="lesson-title">Title</label><input id="lesson-title" bind:value={lessonDraft.title} required maxlength="200"/><label for="lesson-url">Lesson link</label><input id="lesson-url" type="url" bind:value={lessonDraft.url} required placeholder="https://…"/><label for="lesson-category">Category</label><select id="lesson-category" bind:value={lessonDraft.category}>{#if !['Training','Nutrition','Recovery','Mindset','Other'].includes(lessonDraft.category)}<option>{lessonDraft.category}</option>{/if}{#each ['Training','Nutrition','Recovery','Mindset','Other'] as category}<option>{category}</option>{/each}</select><label for="lesson-notes">Your notes</label><textarea id="lesson-notes" bind:value={lessonDraft.notes} placeholder="What would you like to remember?" rows="5" maxlength="10000"></textarea><label class="checkbox-label"><input type="checkbox" bind:checked={lessonDraft.completed}/>Completed</label><button class="primary-button" disabled={busy}>Save Lesson</button>{#if sheet === 'lesson-detail'}<a class="quiet-link" href={lessonDraft.url} target="_blank" rel="noopener noreferrer">Open lesson <ExternalLink size={16}/></a><button class="danger-link" type="button" disabled={busy} onclick={()=>mutate(()=>client.deleteLesson(lessonDraft!.id),true)}>Delete Lesson</button>{/if}</form>
  {:else if sheet === 'account' && data}
    <div class="account-profile"><span class="profile-avatar">{data.profile.displayName.slice(0,1)}</span><div><h3>{data.profile.displayName}</h3><p>{data.profile.email}</p></div></div>
    {#if isMockPreview}<div class="preview-callout"><Info size={17}/><span>Local preview data · saved on this browser for this email. Live accounts and device sync come with the backend.</span></div>{:else}<p class="source-label">Your records are private to your account. {$syncState.pending ? `${$syncState.pending} changes are waiting to sync from this device.` : 'Saved changes sync across your signed-in devices.'}</p>{/if}
    <form onsubmit={saveProfile}><label for="profile-name">Display name</label><input id="profile-name" bind:value={profileName} required maxlength="80"/><label for="profile-unit">Weight unit</label><select id="profile-unit" bind:value={profileUnit}><option value="kg">Kilograms (kg)</option><option value="lb">Pounds (lb)</option></select>{#if !isMockPreview}<label for="profile-timezone">Timezone</label><input id="profile-timezone" bind:value={profileTimezone} placeholder="Asia/Singapore" required maxlength="100"/><p class="source-label">Daily logs follow this timezone.</p>{/if}<button class="primary-button" disabled={busy}>Save Account</button></form>
    {#if isMockPreview}<div class="thin-divider"></div><form onsubmit={switchAccount}><label for="preview-email">Switch preview account</label><input id="preview-email" type="email" bind:value={profileEmail} required/><button class="secondary-button" disabled={busy}><UserCircle size={18}/>Switch Account</button></form>{/if}
    <div class="action-list account-actions"><button onclick={()=>{question=''; answer=''; openSheet('ask');}}><MessageCircle size={19}/>Ask AI <ChevronRight size={18}/></button>{#if data.profile.role==='admin'}<button onclick={() => openProgramImport()}><BookOpen size={19}/>Manage Program Library <ChevronRight size={18}/></button><button onclick={openProvider}><Settings size={19}/>AI Provider Settings <ChevronRight size={18}/></button>{/if}{#if !isMockPreview}<button disabled={busy} onclick={refresh}><RotateCcw size={19}/>Sync Now <ChevronRight size={18}/></button>{/if}{#if isMockPreview}<button disabled={busy} onclick={async()=>{if(await mutate(()=>client.resetPreview(),true)) { clearPrivateDrafts(); selectedDate=today; activeTab='dashboard'; view='tabs'; replaceState('',navigationState('tabs')); toast('Preview data restored'); } }}><RotateCcw size={19}/>Reset Preview Data</button>{/if}<button disabled={busy} onclick={signOut}><LogOut size={19}/>Sign Out</button></div>
    <button class="secondary-button" onclick={()=>openSheet('health')}>Apple Health</button>
  {:else if sheet === 'provider' && providerDraft}
    {#if isMockPreview}<div class="preview-callout"><Info size={17}/><span>Preview configuration only. Real provider keys are added securely with the backend.</span></div>{:else}<p class="muted form-intro">Configure AI for all accounts. The key is stored securely on the server and is never returned to your device.</p><p class="source-label">{providerDraft.configured ? 'A key is saved. Leave the API key blank to keep it.' : 'No key is saved. Add an API key to enable AI.'}</p>{/if}
    <form onsubmit={saveProvider}><label for="provider-name">Provider</label><select id="provider-name" bind:value={providerDraft.provider}><option value="openai">OpenAI</option><option value="anthropic">Anthropic</option><option value="openrouter">OpenRouter</option></select><label for="provider-model">Model</label><input id="provider-model" bind:value={providerDraft.model} placeholder="Model identifier" required maxlength="150"/>{#if !isMockPreview}<label for="provider-key">API key</label><input id="provider-key" type="password" bind:value={providerKey} autocomplete="off" placeholder={providerDraft.configured ? 'Leave blank to keep saved key' : 'Provider API key'} maxlength="4096"/><label for="provider-limit">Daily request limit</label><input id="provider-limit" type="number" min="1" max="1000" step="1" bind:value={providerDraft.dailyRequestLimit} placeholder="20" inputmode="numeric"/>{/if}<label class="checkbox-label"><input type="checkbox" bind:checked={providerDraft.enabled}/>{isMockPreview ? 'Enable AI preview' : 'Enable AI'}</label><button class="primary-button" disabled={busy}>Save AI Settings</button></form>
    {#if !isMockPreview}<button class="secondary-button provider-test" disabled={busy || !providerDraft.configured} onclick={testProvider}>Test Connection</button>{#if providerTest}<p class="provider-result" role="status">{providerTest}</p>{/if}{/if}
  {:else if sheet === 'ask'}
    {#if isMockPreview}<div class="preview-callout"><Info size={17}/><span>Preview only · responses are simulated. No AI service is contacted.</span></div>{:else}<p class="muted form-intro">Ask a training or nutrition question. Only the question you submit is sent to the configured AI provider.</p>{#if !data?.provider.enabled || !data?.provider.configured}<div class="preview-callout"><Info size={17}/><span>AI is not configured yet. An administrator can add a provider in account settings.</span></div>{/if}{/if}
    <form onsubmit={(e)=>{e.preventDefault(); ask(); }}><label for="ai-question">Your question</label><textarea id="ai-question" bind:value={question} placeholder="How can I get more consistent with training?" rows="3" required maxlength="2000"></textarea><button class="primary-button" disabled={busy || !question.trim()}><MessageCircle size={18}/>Ask AI</button></form>{#if answer}<article class="ai-answer"><span class="eyebrow">{answerPreview ? 'PREVIEW RESPONSE' : 'AI RESPONSE'}</span><p>{answer}</p></article>{/if}
  {:else if sheet === 'sync'}
    <p class="muted form-intro">Another device saved newer data before these changes reached the server. Your {$syncState.pending} pending {$syncState.pending===1?'change is':'changes are'} still saved on this device.</p>
    <div class="sync-options"><section><h3>Keep My Changes</h3><p>Apply your pending edits over the latest saved data. This can replace values changed by another device.</p><button class="primary-button" disabled={busy} onclick={()=>resolveConflict('keep-local')}>Keep My Changes</button></section><section><h3>Use Latest Saved Data</h3><p>Discard all pending edits on this device and open the data already saved to your account.</p><button class="secondary-button" disabled={busy} onclick={()=>resolveConflict('use-server')}>Use Latest Saved Data</button></section></div>
  {:else if sheet === 'pending-changes'}
    <p class="form-intro muted">{$syncState.message || 'These changes could not be synced.'} Your {$syncState.pending} pending changes remain on this device.</p><p class="source-label">Discarding pending changes removes them from this device. Records already saved to your account stay intact.</p><button class="secondary-button" disabled={busy} onclick={refresh}>Retry Sync</button><button class="danger-link" disabled={busy} onclick={async()=>{if(client.discardPending && await mutate(()=>client.discardPending!(),true)) { sessionDraft=null; programDraft=null; view='tabs'; replaceState('',navigationState('tabs')); toast('Pending changes discarded'); } }}>Discard Pending Changes</button>
  {:else if sheet === 'goal-details' && data?.goalPlans?.length}
    {@const plan=data.goalPlans.at(-1)!}
    <h3>{data.programs.find(p=>p.id===plan.programId)?.name ?? 'Your starting plan'}</h3>
    <p class="muted">{plan.answers.experience} · {plan.answers.daysPerWeek} days/week · {plan.answers.sessionMinutes} minute budget · Starts {plan.answers.startDate}</p>
    <p>{plan.targets.calories} kcal · {plan.targets.protein}g protein · {plan.targets.carbs}g carbs · {plan.targets.fat}g fat per day at creation</p>
    {#each plan.rationale as reason}<p class="source-label">{reason}</p>{/each}
    {#each GOAL_SOURCES as source}<a class="source-link" href={source.url} target="_blank" rel="noopener noreferrer">{source.name}<ExternalLink size={15}/></a>{/each}
    <p class="source-label">Starting plan details are retained here. Check Nutrition and your program editor for later manual changes.</p>
    <button class="primary-button" onclick={openGoal}>Create New Goal</button>
  {:else if sheet === 'health'}
    <p class="muted">The iPhone app reads resting and active energy for the last 14 completed days. Seven complete days are needed. Data is synced to your private account when you press Sync.</p>
    {#if data?.healthEnergy}<p>{data.healthEnergy.days.length} days · Last synced {new Date(data.healthEnergy.syncedAt).toLocaleString()}</p><p class="source-label">{data.healthEnergy.sources.join(', ')} · {data.healthEnergy.timezone}</p>{/if}
    {#if hasAppleHealth()}<button class="primary-button" disabled={busy} onclick={syncAppleHealth}>Sync Apple Health</button>{:else}<p class="source-label">Open BodyBuilder’s iPhone app for HealthKit access. The PWA uses the equation estimate.</p>{/if}
    <p class="source-label">Sync does not silently change your food targets. Create a goal to review the new estimate. To revoke access, use Apple Health’s app permissions.</p>
    {#if data?.healthEnergy}<button class="danger-link" disabled={busy} onclick={()=>mutate(()=>client.saveHealthEnergy(null),true)}>Remove saved energy summary</button><p class="source-label">Previously saved goal calculations retain their original energy provenance.</p>{/if}
  {:else if sheet === 'history-detail' && historySession}
    <div class="workout-summary-mark"><CheckCircle2 size={37}/></div><h2 class="summary-title">{historySession.name}</h2><p class="summary-date">{new Date(historySession.startedAt).toLocaleDateString('en', {weekday:'long',month:'short',day:'numeric'})}</p><div class="summary-stats"><div><Timer size={20}/><b>{elapsed(historySession)}</b><span>Duration</span></div><div><Dumbbell size={20}/><b>{historySession.exercises.reduce((n,e)=>n+e.sets.filter(s=>s.completed).length,0)}</b><span>Sets completed</span></div><div><Trophy size={20}/><b>{Math.round(historySession.exercises.reduce((n,e)=>n+e.sets.filter(s=>s.completed).reduce((sum,set)=>sum+set.weight*set.reps,0),0)).toLocaleString()}</b><span>Volume (kg)</span></div></div><div class="history-exercises">{#each historySession.exercises as exercise}<div><strong>{exerciseFor(exercise.exerciseId).name}</strong><small>{exercise.sets.filter(s=>s.completed).length}/{exercise.sets.length} sets completed</small><p>{exercise.sets.map(s=>`${s.weight ? `${s.weight}kg × ` : ''}${s.reps} reps${s.effort ? ` · ${s.effort}` : ''}`).join(' / ')}</p>{#if exercise.notes}<p class="muted">{exercise.notes}</p>{/if}</div>{/each}</div>
  {/if}
</Sheet>
