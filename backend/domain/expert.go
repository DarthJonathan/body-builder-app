package domain

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"sort"
	"strings"
)

const ExpertGoalVersion = "goal-library-v2"

type ExpertRules struct {
	Version       string `json:"version"`
	ReviewVersion string `json:"reviewVersion"`
	ReviewedAt    string `json:"reviewedAt"`
	Weights       struct {
		Experience int `json:"experience"`
		Focus      int `json:"focus"`
		Purpose    int `json:"purpose"`
		Time       int `json:"time"`
	} `json:"weights"`
	DumbbellEquipment []string `json:"dumbbellEquipment"`
	Progress          struct {
		WindowDays        int     `json:"windowDays"`
		IncreaseExposures int     `json:"increaseExposures"`
		StallExposures    int     `json:"stallExposures"`
		IncreasePercent   float64 `json:"increasePercent"`
	} `json:"progress"`
	Nutrition struct {
		WindowDays                 int     `json:"windowDays"`
		WeightsPerWeek             int     `json:"weightsPerWeek"`
		LoggedDays                 int     `json:"loggedDays"`
		MinimumMeals               int     `json:"minimumMeals"`
		MaximumWeeklyChangePercent float64 `json:"maximumWeeklyChangePercent"`
	} `json:"nutrition"`
	Sources        []GoalSource `json:"sources"`
	MatchingPolicy string       `json:"matchingPolicy"`
	ReviewPolicy   string       `json:"reviewPolicy"`
}
type TrainingPreferences struct {
	Goal             string `json:"goal"`
	Experience       string `json:"experience"`
	Equipment        string `json:"equipment"`
	DaysPerWeek      int    `json:"daysPerWeek"`
	SessionMinutes   int    `json:"sessionMinutes"`
	Focus            string `json:"focus"`
	TrainingPriority string `json:"trainingPriority"`
}
type ProgramSelection struct {
	Scope    string `json:"scope"`
	ID       string `json:"id"`
	Version  int    `json:"version"`
	Revision int64  `json:"revision"`
	Digest   string `json:"digest"`
}
type ProgramMatch struct {
	Selection   ProgramSelection `json:"selection"`
	Program     Program          `json:"program"`
	Score       int              `json:"score"`
	Reasons     []string         `json:"reasons"`
	Differences []string         `json:"differences"`
}
type ProgramExclusion struct {
	ID      string   `json:"id"`
	Name    string   `json:"name"`
	Scope   string   `json:"scope"`
	Reasons []string `json:"reasons"`
}
type ProgramRecommendations struct {
	Version     string             `json:"version"`
	Matches     []ProgramMatch     `json:"matches"`
	Excluded    []ProgramExclusion `json:"excluded"`
	Explanation string             `json:"explanation"`
	Policy      string             `json:"policy"`
	Sources     []GoalSource       `json:"sources"`
}

func GoalPreferences(a GoalAnswers) TrainingPreferences {
	return TrainingPreferences{a.Goal, a.Experience, a.Equipment, a.DaysPerWeek, a.SessionMinutes, a.Focus, a.TrainingPriority}
}
func ValidateTrainingPreferences(a TrainingPreferences) error {
	for _, c := range []struct {
		value, name string
		allowed     []string
	}{
		{a.Goal, "goal", []string{"build-muscle", "maintain", "lose-fat"}}, {a.Experience, "experience", []string{"beginner", "intermediate", "advanced"}}, {a.Equipment, "equipment", []string{"full-gym", "dumbbells"}}, {a.Focus, "focus", []string{"balanced", "glutes"}}, {a.TrainingPriority, "training priority", []string{"hypertrophy", "strength", "general"}},
	} {
		if err := Choice(c.value, c.name, c.allowed...); err != nil {
			return err
		}
	}
	if a.DaysPerWeek < 2 || a.DaysPerWeek > 6 || (a.SessionMinutes != 30 && a.SessionMinutes != 45 && a.SessionMinutes != 60) {
		return errors.New("choose two to six training days and a 30, 45 or 60 minute time budget")
	}
	return nil
}

var selectionDigest = regexp.MustCompile(`^[a-f0-9]{64}$`)

func ValidateSelection(s *ProgramSelection) error {
	if s == nil || !selectionDigest.MatchString(s.Digest) || s.Version < 0 || s.Version > 1000000 || s.Revision < 0 {
		return errors.New("review a current program recommendation first")
	}
	if err := Choice(s.Scope, "selection scope", "shared", "personal", "current"); err != nil {
		return err
	}
	return Identifier(s.ID)
}
func sameSelection(a, b *ProgramSelection) bool { return a != nil && b != nil && *a == *b }
func normalizeDigest(v any) any {
	switch x := v.(type) {
	case map[string]any:
		out := map[string]any{}
		for k, v := range x {
			if v == nil {
				continue
			}
			if b, ok := v.(bool); ok && !b {
				continue
			}
			out[k] = normalizeDigest(v)
		}
		return out
	case []any:
		for i, v := range x {
			x[i] = normalizeDigest(v)
		}
		return x
	default:
		return v
	}
}
func ProgramDigest(p Program) string {
	var content any = p
	if p.Details != nil {
		content = DocumentFromProgram(p)
	}
	raw, _ := json.Marshal(content)
	var value any
	_ = json.Unmarshal(raw, &value)
	var buf bytes.Buffer
	encoder := json.NewEncoder(&buf)
	encoder.SetEscapeHTML(false)
	_ = encoder.Encode(normalizeDigest(value))
	hash := sha256.Sum256(bytes.TrimSuffix(buf.Bytes(), []byte("\n")))
	return hex.EncodeToString(hash[:])
}
func CurrentSelection(p Program) ProgramSelection {
	v := 0
	if p.Details != nil {
		v = p.Details.Version
	}
	return ProgramSelection{Scope: "current", ID: p.ID, Version: v, Digest: ProgramDigest(p)}
}
func copyProgram(p Program) Program {
	raw, _ := json.Marshal(p)
	var result Program
	_ = json.Unmarshal(raw, &result)
	return result
}
func experienceRank(value string) int {
	switch value {
	case "beginner":
		return 0
	case "intermediate":
		return 1
	default:
		return 2
	}
}
func RankPrograms(a TrainingPreferences, shared []ProgramTemplate, personal []Program, rules ExpertRules, exercises []Exercise) (ProgramRecommendations, error) {
	if err := ValidateTrainingPreferences(a); err != nil {
		return ProgramRecommendations{}, err
	}
	if rules.Version != "program-expert-v1" {
		return ProgramRecommendations{}, errors.New("program recommendation rules unavailable")
	}
	result := ProgramRecommendations{Version: rules.Version, Matches: []ProgramMatch{}, Excluded: []ProgramExclusion{}, Policy: rules.MatchingPolicy, Sources: rules.Sources}
	known := map[string]bool{}
	equipment := map[string]string{}
	for _, e := range exercises {
		known[e.ID] = true
		equipment[e.ID] = e.Equipment
	}
	visit := func(p Program, scope string, revision int64) {
		d := p.Details
		reasons := []string{}
		if d == nil {
			reasons = append(reasons, "Suitability metadata is missing; this program remains available for manual selection.")
		} else {
			if err := ValidateProgramDocument(DocumentFromProgram(p), known); err != nil {
				reasons = append(reasons, "The current prescriptions need a valid structured export before matching.")
			}
			if d.DaysPerWeek != a.DaysPerWeek || len(p.Workouts) != a.DaysPerWeek {
				reasons = append(reasons, fmt.Sprintf("Needs %d training days; you selected %d.", len(p.Workouts), a.DaysPerWeek))
			}
			if d.SessionMinutes > a.SessionMinutes {
				reasons = append(reasons, fmt.Sprintf("Estimated %d minutes exceeds your %d-minute budget.", d.SessionMinutes, a.SessionMinutes))
			}
			if !Contains(d.Goals, a.Goal) {
				reasons = append(reasons, "This program does not list your selected goal.")
			}
			minRank := 3
			for _, e := range d.Experience {
				if experienceRank(e) < minRank {
					minRank = experienceRank(e)
				}
			}
			if minRank > experienceRank(a.Experience) {
				reasons = append(reasons, "Its starting experience is higher than your reported level.")
			}
			if a.Equipment == "dumbbells" {
				bad := d.Equipment != "dumbbells"
				for _, w := range p.Workouts {
					for _, rx := range w.Exercises {
						if !Contains(rules.DumbbellEquipment, equipment[rx.ExerciseID]) {
							bad = true
						}
					}
				}
				if bad {
					reasons = append(reasons, "Needs equipment beyond dumbbells and a bench.")
				}
			}
		}
		if len(reasons) > 0 {
			result.Excluded = append(result.Excluded, ProgramExclusion{p.ID, p.Name, scope, reasons})
			return
		}
		differences := []string{}
		why := []string{fmt.Sprintf("Exactly %d workouts fit your training days.", a.DaysPerWeek), fmt.Sprintf("The declared %d-minute sessions fit your %d-minute budget.", d.SessionMinutes, a.SessionMinutes), "Your equipment and " + strings.ReplaceAll(a.Goal, "-", " ") + " goal match."}
		score := rules.Weights.Time / 2
		if d.SessionMinutes == a.SessionMinutes {
			score = rules.Weights.Time
		}
		if Contains(d.Experience, a.Experience) {
			score += rules.Weights.Experience
			why = append(why, "Your training experience is explicitly supported.")
		} else {
			differences = append(differences, "Uses a lower starting dose than your reported experience; review whether it is challenging enough.")
		}
		if d.Focus == a.Focus {
			score += rules.Weights.Focus
			if a.Focus == "glutes" {
				why = append(why, "Prioritizes your glute focus.")
			} else {
				why = append(why, "Matches your balanced muscle focus.")
			}
		} else {
			differences = append(differences, fmt.Sprintf("Its %s focus differs from your %s preference.", d.Focus, a.Focus))
		}
		if d.Purpose == a.TrainingPriority {
			score += rules.Weights.Purpose
			why = append(why, "Matches your "+a.TrainingPriority+" training priority.")
		} else {
			differences = append(differences, fmt.Sprintf("Uses a %s emphasis rather than your %s priority.", d.Purpose, a.TrainingPriority))
		}
		result.Matches = append(result.Matches, ProgramMatch{Selection: ProgramSelection{Scope: scope, ID: p.ID, Version: d.Version, Revision: revision, Digest: ProgramDigest(p)}, Program: copyProgram(p), Score: score, Reasons: why, Differences: differences})
	}
	for _, p := range shared {
		visit(p.Program, "shared", p.Revision)
	}
	for _, p := range personal {
		visit(p, "personal", 0)
	}
	sort.Slice(result.Matches, func(i, j int) bool {
		a, b := result.Matches[i], result.Matches[j]
		if a.Score != b.Score {
			return a.Score > b.Score
		}
		if a.Program.Name != b.Program.Name {
			return a.Program.Name < b.Program.Name
		}
		if a.Selection.Scope != b.Selection.Scope {
			return a.Selection.Scope < b.Selection.Scope
		}
		return a.Selection.ID < b.Selection.ID
	})
	result.Explanation = "Eligible programs are ranked by your preferences. Choose the recommendation or another eligible plan; no split is universally best."
	if len(result.Matches) == 0 {
		result.Explanation = "No library program meets all of these constraints. Change your days, time or equipment, import a suitable structured plan, or retain your current individually suitable workouts."
	}
	return result, nil
}
func Contains(values []string, v string) bool {
	for _, item := range values {
		if item == v {
			return true
		}
	}
	return false
}
func NutritionGuidance(a GoalAnswers, p Program) []string {
	energy := "Maintenance starts from Mifflin–St Jeor resting energy and your reported activity factor."
	if a.Nutrition.HealthEnergy != nil {
		energy = "Maintenance uses complete Apple Health resting + active energy days without adding an activity multiplier."
	}
	instructions := "Use your individual calorie and macro targets when logging food."
	if p.Details != nil {
		instructions = p.Details.Nutrition.Instructions
	}
	tracking := "Compare consistent food logging, weekly weight averages and training performance; use manual overrides when appropriate."
	if a.NutritionExperience == "new" {
		tracking = "Start with food search and measured portions. Log each meal and your daily weight before drawing conclusions from trends."
	} else if a.NutritionExperience == "familiar" {
		tracking = "Review daily calories and protein alongside your weight trend; record portions consistently."
	}
	return []string{energy, fmt.Sprintf("%g kcal/day is the starting goal adjustment; it is not a predicted rate of weight change.", a.Nutrition.CalorieAdjustment), fmt.Sprintf("Protein %g g/kg; fat %g%% of calories; carbohydrate fills the remaining energy. Targets remain editable.", a.Nutrition.ProteinPerKG, a.Nutrition.FatPercent), instructions, tracking}
}
func PreviewExpertGoal(a GoalAnswers, shared []ProgramTemplate, data AppSnapshot, rules ExpertRules, exercises []Exercise) (GoalPreview, error) {
	if err := ValidateGoalAnswers(a); err != nil {
		return GoalPreview{}, err
	}
	if err := ValidateTrainingPreferences(GoalPreferences(a)); err != nil {
		return GoalPreview{}, err
	}
	if err := ValidateSelection(a.ProgramSelection); err != nil {
		return GoalPreview{}, err
	}
	var program Program
	reasons := []string{}
	if a.Restrictions == "keep-current" {
		found := false
		for _, p := range data.Programs {
			if p.ID == data.ActiveProgramID {
				sel := CurrentSelection(p)
				if len(p.Workouts) == 0 || !sameSelection(a.ProgramSelection, &sel) {
					break
				}
				program = copyProgram(p)
				found = true
				break
			}
		}
		if !found {
			return GoalPreview{}, errors.New("your current program changed; review it again before creating the goal")
		}
		reasons = append(reasons, "Retaining the program you identified as individually suitable; no new suitability assessment is inferred.")
	} else {
		report, err := RankPrograms(GoalPreferences(a), shared, data.Programs, rules, exercises)
		if err != nil {
			return GoalPreview{}, err
		}
		found := false
		for _, m := range report.Matches {
			if sameSelection(a.ProgramSelection, &m.Selection) {
				program = copyProgram(m.Program)
				reasons = append(reasons, m.Reasons...)
				reasons = append(reasons, m.Differences...)
				found = true
				break
			}
		}
		if !found {
			return GoalPreview{}, errors.New("the selected plan changed or no longer matches your answers; reload the recommendations and preview again")
		}
		reasons = append(reasons, report.Policy, "Eligible alternatives were compared; no split is universally best.")
	}
	program.Goal = a.Goal
	targets, err := CalculateNutrition(a.Nutrition)
	if err != nil {
		return GoalPreview{}, err
	}
	targets.ID = "goal-target-preview"
	return GoalPreview{Version: ExpertGoalVersion, Program: program, Targets: targets, Rationale: append(reasons, NutritionGuidance(a, program)...), Selection: a.ProgramSelection, ExpertVersion: rules.Version}, nil
}
