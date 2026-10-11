package domain_test

import (
	"encoding/json"
	"fmt"
	"os"
	"reflect"
	"testing"
	"training-app/backend/catalogue"
	"training-app/backend/domain"
)

func TestExpertRecommendationGolden(t *testing.T) {
	raw, err := os.ReadFile("../../docs/fixtures/program-recommendations.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixture struct {
		Version string
		Digests map[string]string
		Cases   []struct {
			Name  string
			Input domain.TrainingPreferences
			TopID *string
			Score int
		}
	}
	if err := json.Unmarshal(raw, &fixture); err != nil {
		t.Fatal(err)
	}
	c := catalogue.Load()
	for _, sample := range fixture.Cases {
		t.Run(sample.Name, func(t *testing.T) {
			report, err := domain.RankPrograms(sample.Input, c.Templates, nil, c.ExpertRules, c.Exercises)
			if err != nil {
				t.Fatal(err)
			}
			if report.Version != fixture.Version {
				t.Fatal("version drift")
			}
			if sample.TopID == nil {
				if len(report.Matches) > 0 {
					t.Fatal("invented a fit")
				}
			} else if len(report.Matches) == 0 || report.Matches[0].Selection.ID != *sample.TopID || report.Matches[0].Score != sample.Score {
				t.Fatalf("unexpected top: %+v", report.Matches)
			}
			if len(report.Matches)+len(report.Excluded) != len(c.Templates) {
				t.Fatal("missing candidates")
			}
		})
	}
	for _, p := range c.Templates {
		if want, ok := fixture.Digests[p.ID]; ok {
			if got := domain.ProgramDigest(p.Program); got != want {
				t.Fatalf("digest drift %s: %s != %s", p.ID, got, want)
			}
		}
	}
}
func TestExpertPreservesDoseAndRejectsChangedOrForeignSelection(t *testing.T) {
	c := catalogue.Load()
	a := goalSample()
	a.TrainingPriority = "hypertrophy"
	report, err := domain.RankPrograms(domain.GoalPreferences(a), c.Templates, nil, c.ExpertRules, c.Exercises)
	if err != nil {
		t.Fatal(err)
	}
	a.ProgramSelection = &report.Matches[0].Selection
	p, err := domain.PreviewExpertGoal(a, c.Templates, domain.AppSnapshot{}, c.ExpertRules, c.Exercises)
	if err != nil {
		t.Fatal(err)
	}
	if p.Version != domain.ExpertGoalVersion || !reflect.DeepEqual(p.Program.Workouts, report.Matches[0].Program.Workouts) {
		t.Fatal("selected plan was replaced with generated exercises")
	}
	for _, change := range []func(*domain.ProgramTemplate){func(p *domain.ProgramTemplate) { p.Workouts[0].Exercises[0].Sets++ }, func(p *domain.ProgramTemplate) { p.Details.Version++ }, func(p *domain.ProgramTemplate) { p.Revision++ }} {
		fresh := catalogue.Load()
		for i := range fresh.Templates {
			if fresh.Templates[i].ID == a.ProgramSelection.ID {
				change(&fresh.Templates[i])
			}
		}
		if _, err := domain.PreviewExpertGoal(a, fresh.Templates, domain.AppSnapshot{}, c.ExpertRules, c.Exercises); err == nil {
			t.Fatal("stale selection accepted")
		}
	}
	own := p.Program
	own.ID = "private-foundation"
	private, err := domain.RankPrograms(domain.GoalPreferences(a), nil, []domain.Program{own}, c.ExpertRules, c.Exercises)
	if err != nil || len(private.Matches) != 1 {
		t.Fatal("private plan missing")
	}
	a.ProgramSelection = &private.Matches[0].Selection
	if _, err := domain.PreviewExpertGoal(a, c.Templates, domain.AppSnapshot{}, c.ExpertRules, c.Exercises); err == nil {
		t.Fatal("another account's personal ID accepted")
	}
	a.Restrictions = "keep-current"
	selection := domain.CurrentSelection(own)
	a.ProgramSelection = &selection
	data := domain.AppSnapshot{ActiveProgramID: own.ID, Programs: []domain.Program{own}}
	if _, err := domain.PreviewExpertGoal(a, c.Templates, data, c.ExpertRules, c.Exercises); err != nil {
		t.Fatal(err)
	}
	data.Programs[0].Workouts[0].Exercises[0].RepsMax++
	if _, err := domain.PreviewExpertGoal(a, c.Templates, data, c.ExpertRules, c.Exercises); err == nil {
		t.Fatal("changed current program accepted")
	}
}
func TestRecordedProgressGolden(t *testing.T) {
	raw, err := os.ReadFile("../../docs/fixtures/progress-reviews.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixture struct {
		Version string
		Cases   []struct {
			Name     string
			AsOf     string
			Snapshot domain.AppSnapshot
			Kind     string
		}
	}
	if err := json.Unmarshal(raw, &fixture); err != nil {
		t.Fatal(err)
	}
	c := catalogue.Load()
	for _, sample := range fixture.Cases {
		t.Run(sample.Name, func(t *testing.T) {
			before, _ := json.Marshal(sample.Snapshot)
			r := domain.ReviewProgress(sample.Snapshot, sample.AsOf, c.ExpertRules, c.Exercises)
			kind := ""
			if len(r.Training) > 0 {
				kind = r.Training[0].Kind
			}
			if r.Version != fixture.Version || kind != sample.Kind {
				t.Fatalf("unexpected review %+v", r)
			}
			if kind == "increase-load" && (r.Training[0].SuggestedLoadKG == nil || *r.Training[0].SuggestedLoadKG != 51.25) {
				t.Fatal("wrong increase")
			}
			after, _ := json.Marshal(sample.Snapshot)
			if string(before) != string(after) {
				t.Fatal("review mutated history")
			}
		})
	}
}
func TestNutritionReviewRequiresStableCoverageAndRespectsManualTargets(t *testing.T) {
	c := catalogue.Load()
	input := goalSample().Nutrition
	input.EffectiveDate = "2026-09-01"
	target, err := domain.CalculateNutrition(input)
	if err != nil {
		t.Fatal(err)
	}
	target.ID = "nutrition"
	data := domain.AppSnapshot{Targets: []domain.NutritionTargets{target}}
	for i := 1; i <= 14; i++ {
		date := fmt.Sprintf("2026-10-%02d", i)
		data.Weights = append(data.Weights, domain.WeightEntry{Date: date, Weight: 70})
		for _, meal := range []string{"Breakfast", "Dinner"} {
			data.FoodEntries = append(data.FoodEntries, domain.FoodEntry{Date: date, Meal: meal, Nutrients: domain.Nutrients{Calories: 1100}})
		}
	}
	r := domain.ReviewProgress(data, "2026-10-15", c.ExpertRules, c.Exercises)
	if r.Nutrition.Status != "review-trend" || *r.Nutrition.AverageLoggedCalories != 2200 || *r.Nutrition.WeeklyChangeKG != 0 {
		t.Fatalf("unexpected nutrition %+v", r.Nutrition)
	}
	data.Targets[0].Mode = "manual"
	if domain.ReviewProgress(data, "2026-10-15", c.ExpertRules, c.Exercises).Nutrition.Status != "manual-targets" {
		t.Fatal("manual target overwritten")
	}
	data.Targets[0].Mode = "calculated"
	next := target
	next.ID = "new-target"
	next.EffectiveDate = "2026-10-10"
	data.Targets = append(data.Targets, next)
	if domain.ReviewProgress(data, "2026-10-15", c.ExpertRules, c.Exercises).Nutrition.Status != "insufficient-data" {
		t.Fatal("unstable targets accepted")
	}
	data.Targets = data.Targets[:1]
	data.FoodEntries = data.FoodEntries[:4]
	if domain.ReviewProgress(data, "2026-10-15", c.ExpertRules, c.Exercises).Nutrition.Status != "insufficient-data" {
		t.Fatal("sparse logging accepted")
	}
}
