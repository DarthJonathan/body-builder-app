package domain

import (
	"errors"
	"fmt"
	"strings"
)

const GoalVersion = "goal-planner-v1"

type GoalAnswers struct {
	Goal                string            `json:"goal"`
	StartDate           string            `json:"startDate"`
	Experience          string            `json:"experience"`
	Restrictions        string            `json:"restrictions"`
	Equipment           string            `json:"equipment"`
	DaysPerWeek         int               `json:"daysPerWeek"`
	SessionMinutes      int               `json:"sessionMinutes"`
	Focus               string            `json:"focus"`
	Split               string            `json:"split"`
	WorkoutDays         []int             `json:"workoutDays"`
	NutritionExperience string            `json:"nutritionExperience"`
	Pace                string            `json:"pace"`
	Nutrition           TargetCalculation `json:"nutrition"`
	TrainingPriority    string            `json:"trainingPriority,omitempty"`
	ProgramSelection    *ProgramSelection `json:"programSelection,omitempty"`
}
type GoalRoutine struct {
	Name      string   `json:"name"`
	Exercises []string `json:"exercises"`
}
type GoalSource struct {
	Name string `json:"name"`
	URL  string `json:"url"`
}
type GoalRules struct {
	Version     string                              `json:"version"`
	ReviewedAt  string                              `json:"reviewedAt"`
	Sources     []GoalSource                        `json:"sources"`
	Routines    map[string]map[string][]GoalRoutine `json:"routines"`
	DefaultDays map[string][]int                    `json:"defaultDays"`
	SplitLabels map[string]string                   `json:"splitLabels"`
}
type GoalPreview struct {
	Version       string            `json:"version"`
	Program       Program           `json:"program"`
	Targets       NutritionTargets  `json:"targets"`
	Rationale     []string          `json:"rationale"`
	Selection     *ProgramSelection `json:"selection,omitempty"`
	ExpertVersion string            `json:"expertVersion,omitempty"`
}
type CreateGoalPlan struct {
	Version        string           `json:"version"`
	Answers        GoalAnswers      `json:"answers"`
	Targets        NutritionTargets `json:"targets"`
	SchedulePolicy string           `json:"schedulePolicy"`
}
type GoalPlan struct {
	CreateGoalPlan
	ID        string   `json:"id"`
	CreatedAt string   `json:"createdAt"`
	ProgramID string   `json:"programId"`
	Rationale []string `json:"rationale"`
}

func PaceAdjustment(goal, pace string) float64 {
	if goal == "maintain" {
		return 0
	}
	if goal == "build-muscle" {
		if pace == "gentle" {
			return 150
		}
		return 250
	}
	if pace == "gentle" {
		return -200
	}
	return -300
}
func CompatibleSplits(days int) []string {
	if days <= 3 {
		return []string{"full-body"}
	}
	if days == 4 {
		return []string{"upper-lower", "full-body"}
	}
	if days == 5 {
		return []string{"hybrid", "upper-lower"}
	}
	return []string{"ppl", "upper-lower"}
}
func ValidateGoalAnswers(a GoalAnswers) error {
	if a.TrainingPriority != "" {
		if err := Choice(a.TrainingPriority, "training priority", "hypertrophy", "strength", "general"); err != nil {
			return err
		}
	}
	for _, c := range []struct {
		value, name string
		choices     []string
	}{
		{a.Goal, "goal", []string{"build-muscle", "maintain", "lose-fat"}}, {a.Experience, "experience", []string{"beginner", "intermediate", "advanced"}}, {a.Restrictions, "restrictions", []string{"none", "keep-current"}}, {a.Equipment, "equipment", []string{"full-gym", "dumbbells"}}, {a.Focus, "focus", []string{"balanced", "glutes"}}, {a.NutritionExperience, "nutrition experience", []string{"new", "familiar", "confident"}}, {a.Pace, "pace", []string{"gentle", "moderate"}}, {a.Split, "split", CompatibleSplits(a.DaysPerWeek)},
	} {
		if err := Choice(c.value, c.name, c.choices...); err != nil {
			return err
		}
	}
	if a.DaysPerWeek < 2 || a.DaysPerWeek > 6 || (a.SessionMinutes != 30 && a.SessionMinutes != 45 && a.SessionMinutes != 60) {
		return errors.New("choose two to six training days and a 30, 45 or 60 minute time budget")
	}
	if len(a.WorkoutDays) != a.DaysPerWeek {
		return errors.New("assign each workout to a weekday")
	}
	seen := map[int]bool{}
	for _, d := range a.WorkoutDays {
		if d < 0 || d > 6 || seen[d] {
			return errors.New("workout weekdays must be unique")
		}
		seen[d] = true
	}
	if err := ValidateTargetCalculation(a.Nutrition); err != nil {
		return err
	}
	if a.Nutrition.Goal != a.Goal || a.Nutrition.EffectiveDate != a.StartDate || a.Nutrition.CalorieAdjustment != PaceAdjustment(a.Goal, a.Pace) {
		return errors.New("nutrition inputs must match the goal, start date and chosen pace")
	}
	return nil
}
func PreviewGoal(a GoalAnswers, rules GoalRules, exercises []Exercise, muscles []Muscle, current *Program) (GoalPreview, error) {
	if err := ValidateGoalAnswers(a); err != nil {
		return GoalPreview{}, err
	}
	if rules.Version != GoalVersion || len(rules.Sources) == 0 {
		return GoalPreview{}, errors.New("goal rules unavailable")
	}
	targets, err := CalculateNutrition(a.Nutrition)
	if err != nil {
		return GoalPreview{}, err
	}
	targets.ID = "goal-target-preview"
	dose := "Three"
	sets := 3
	if a.Experience == "beginner" {
		dose = "Two"
		sets = 2
	}
	energy := "Resting energy uses Mifflin–St Jeor; maintenance adds an activity factor. Both are initial estimates."
	if a.Nutrition.HealthEnergy != nil {
		energy = "Maintenance uses the average of complete Apple Health resting + active energy days, without an activity multiplier. This is device-estimated expenditure, not a laboratory BMR measurement."
	}
	rationale := []string{fmt.Sprintf("%d weekly sessions fit your availability. Split choice follows your schedule; no split is universally best.", a.DaysPerWeek), dose + " working sets per exercise are a starting dose. Build gradually; adjust volume and load using your logged performance and recovery.", fmt.Sprintf("Plan around %d minutes, allowing extra time for warm-up and rest. This is a time budget, not a guarantee.", a.SessionMinutes), "Keep repetitions controlled. Training to failure is optional. Review load increases when you complete the prescribed range with good technique.", energy, fmt.Sprintf("%g kcal/day is the starting goal adjustment. Protein starts at %g g/kg. Targets remain editable; assess weight trends over several weeks.", PaceAdjustment(a.Goal, a.Pace), a.Nutrition.ProteinPerKG)}
	var program Program
	if a.Restrictions == "keep-current" {
		if current == nil || len(current.Workouts) == 0 {
			return GoalPreview{}, errors.New("an existing individually suitable program is needed to keep your current workouts")
		}
		program = *current
		rationale[1] = "Your current workout prescriptions are retained. These answers do not establish whether exercises are suitable for a medical condition or injury."
	} else {
		groups := rules.Routines[a.Equipment]
		routine := groups[a.Split]
		if a.Split == "hybrid" {
			routine = append(append([]GoalRoutine{}, groups["upper-lower"]...), groups["full-body"][0])
		}
		if len(routine) == 0 {
			return GoalPreview{}, errors.New("goal routine unavailable")
		}
		count := 6
		if a.SessionMinutes == 30 {
			count = 4
		} else if a.SessionMinutes == 45 {
			count = 5
		}
		known := map[string]Exercise{}
		for _, e := range exercises {
			known[e.ID] = e
		}
		program = Program{ID: "goal-preview", Name: fmt.Sprintf("%d-Day %s", a.DaysPerWeek, rules.SplitLabels[a.Split]), Level: strings.ToUpper(a.Experience[:1]) + a.Experience[1:], Goal: a.Goal, Source: rules.Sources[0].URL, SourceName: "BodyBuilder evidence-informed starting plan", SourceReviewedAt: rules.ReviewedAt, AdaptationNote: "Exercise selection, split and starting doses are BodyBuilder app policy informed by the linked research. Edit to suit your preferences and progress.", Workouts: []Workout{}}
		for i := 0; i < a.DaysPerWeek; i++ {
			item := routine[i%len(routine)]
			selected := append([]string{}, item.Exercises...)
			if a.Focus == "glutes" && (strings.HasPrefix(item.Name, "Lower") || strings.HasPrefix(item.Name, "Full") || item.Name == "Legs") {
				glute := "hip-thrust"
				if a.Equipment == "dumbbells" {
					glute = "glute-bridge"
				}
				selected = []string{glute}
				for _, e := range item.Exercises {
					if e != glute {
						selected = append(selected, e)
					}
				}
			}
			if len(selected) > count {
				selected = selected[:count]
			}
			name := item.Name
			if i >= len(routine) {
				name += " · 2"
			}
			w := Workout{ID: fmt.Sprintf("goal-workout-%d", i), Name: name, Exercises: []Prescription{}, Muscles: []Muscle{}, Warmup: []string{"Start with 5 minutes of easy movement.", "Use lighter practice sets before your first demanding lifts."}}
			trained := map[string]bool{}
			for j, eid := range selected {
				e, ok := known[eid]
				if !ok {
					return GoalPreview{}, fmt.Errorf("exercise %s is unavailable", eid)
				}
				for _, m := range e.Muscles {
					trained[m] = true
				}
				p := Prescription{ID: fmt.Sprintf("goal-prescription-%d-%d", i, j), ExerciseID: eid, Sets: sets, RepsMin: 8, RepsMax: 12, RestSeconds: 120}
				if j >= 4 {
					p.RestSeconds = 90
				}
				if eid == "plank" {
					p.Seconds = true
					p.RepsMin = 20
					p.RepsMax = 40
				}
				p.PerSide = eid == "reverse-lunge" || eid == "dumbbell-lunge" || eid == "one-arm-dumbbell-row"
				w.Exercises = append(w.Exercises, p)
			}
			for _, m := range muscles {
				if trained[m.ID] {
					w.Muscles = append(w.Muscles, m)
				}
			}
			program.Workouts = append(program.Workouts, w)
		}
	}
	return GoalPreview{Version: GoalVersion, Program: program, Targets: targets, Rationale: rationale}, nil
}
