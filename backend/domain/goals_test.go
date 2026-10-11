package domain_test

import (
	"encoding/json"
	"os"
	"reflect"
	"testing"
	"training-app/backend/catalogue"
	"training-app/backend/domain"
)

func goalSample() domain.GoalAnswers {
	return domain.GoalAnswers{Goal: "build-muscle", StartDate: "2026-10-09", Experience: "beginner", Restrictions: "none", Equipment: "full-gym", DaysPerWeek: 3, SessionMinutes: 45, Focus: "balanced", Split: "full-body", WorkoutDays: []int{0, 2, 4}, NutritionExperience: "new", Pace: "gentle", Nutrition: domain.TargetCalculation{Age: 30, Sex: "male", HeightCM: 175, WeightKG: 70, Activity: "moderate", Goal: "build-muscle", EffectiveDate: "2026-10-09", CalorieAdjustment: 150, ProteinPerKG: 1.6, FatPercent: 25}}
}
func TestGoalGoldenParity(t *testing.T) {
	raw, err := os.ReadFile("../../docs/fixtures/goal-plans.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixtures struct {
		Version string `json:"version"`
		Cases   []struct {
			Name     string             `json:"name"`
			Answers  domain.GoalAnswers `json:"answers"`
			Expected struct {
				Exercises [][]string `json:"exercises"`
				Sets      int        `json:"sets"`
				domain.Nutrients
				RestingCalories     float64 `json:"restingCalories"`
				MaintenanceCalories float64 `json:"maintenanceCalories"`
			} `json:"expected"`
		} `json:"cases"`
	}
	if err := json.Unmarshal(raw, &fixtures); err != nil {
		t.Fatal(err)
	}
	c := catalogue.Load()
	for _, sample := range fixtures.Cases {
		t.Run(sample.Name, func(t *testing.T) {
			p, err := domain.PreviewGoal(sample.Answers, c.GoalRules, c.Exercises, c.Muscles, nil)
			if err != nil {
				t.Fatal(err)
			}
			if p.Version != fixtures.Version || p.Targets.Nutrients != sample.Expected.Nutrients || p.Targets.Calculation.RestingCalories != sample.Expected.RestingCalories || p.Targets.Calculation.MaintenanceCalories != sample.Expected.MaintenanceCalories {
				t.Fatalf("unexpected nutrition: %+v", p.Targets)
			}
			var ids [][]string
			for _, w := range p.Program.Workouts {
				list := []string{}
				for _, e := range w.Exercises {
					list = append(list, e.ExerciseID)
					if e.Sets != sample.Expected.Sets {
						t.Fatal("wrong starting dose")
					}
				}
				ids = append(ids, list)
			}
			if !reflect.DeepEqual(ids, sample.Expected.Exercises) {
				t.Fatalf("unexpected exercise selection: %v", ids)
			}
		})
	}
}
func TestGoalAvailabilityEquipmentAndValidation(t *testing.T) {
	c := catalogue.Load()
	known := map[string]bool{}
	muscles := map[string]bool{}
	for _, e := range c.Exercises {
		known[e.ID] = true
	}
	for _, m := range c.Muscles {
		muscles[m.ID] = true
	}
	for _, equipment := range []string{"full-gym", "dumbbells"} {
		for days := 2; days <= 6; days++ {
			for _, split := range domain.CompatibleSplits(days) {
				for _, minutes := range []int{30, 45, 60} {
					a := goalSample()
					a.Equipment = equipment
					a.DaysPerWeek = days
					a.Split = split
					a.SessionMinutes = minutes
					a.WorkoutDays = append([]int{}, c.GoalRules.DefaultDays[string(rune('0'+days))]...)
					p, err := domain.PreviewGoal(a, c.GoalRules, c.Exercises, c.Muscles, nil)
					if err != nil {
						t.Fatal(err)
					}
					if len(p.Program.Workouts) != days {
						t.Fatal("frequency changed")
					}
					if err := domain.ValidateProgram(p.Program, known, muscles); err != nil {
						t.Fatal(err)
					}
					if equipment == "dumbbells" {
						for _, w := range p.Program.Workouts {
							for _, rx := range w.Exercises {
								for _, e := range c.Exercises {
									if e.ID == rx.ExerciseID && (e.Equipment == "Barbell" || e.Equipment == "Cable" || e.Equipment == "Machine") {
										t.Fatalf("unavailable equipment: %s", e.ID)
									}
								}
							}
						}
					}
				}
			}
		}
	}
	for _, change := range []func(*domain.GoalAnswers){func(a *domain.GoalAnswers) { a.WorkoutDays = []int{0, 0, 4} }, func(a *domain.GoalAnswers) { a.Split = "ppl" }, func(a *domain.GoalAnswers) { a.DaysPerWeek = 7 }, func(a *domain.GoalAnswers) { a.Nutrition.Goal = "maintain" }, func(a *domain.GoalAnswers) { a.Nutrition.CalorieAdjustment = 500 }, func(a *domain.GoalAnswers) { a.Restrictions = "keep-current" }} {
		a := goalSample()
		change(&a)
		if _, err := domain.PreviewGoal(a, c.GoalRules, c.Exercises, c.Muscles, nil); err == nil {
			t.Fatal("accepted incompatible/unsupported answers")
		}
	}
}
func TestHealthEnergyDoesNotDoubleCountActivityAndRejectsPartialDays(t *testing.T) {
	a := goalSample()
	h := domain.HealthEnergy{Source: "apple-health", SyncedAt: "2026-10-09T12:00:00Z", Timezone: "UTC", Sources: []string{"Apple Watch"}}
	for i := 1; i <= 7; i++ {
		h.Days = append(h.Days, domain.HealthEnergyDay{Date: "2026-10-0" + string(rune('0'+i)), RestingCalories: 1600, ActiveCalories: 400, CoverageHours: 24, DayHours: 24})
	}
	a.Nutrition.HealthEnergy = &h
	p, err := domain.CalculateNutrition(a.Nutrition)
	if err != nil {
		t.Fatal(err)
	}
	if p.Calculation.MaintenanceCalories != 2000 || p.Calories != 2150 || p.Calculation.Version != "apple-health-energy-v1" {
		t.Fatalf("activity was double-counted: %+v", p)
	}
	if err := domain.ValidateCalculationProvenance(p); err != nil {
		t.Fatal(err)
	}
	p.Calculation.Version = domain.NutritionCalculationVersion
	if domain.ValidateCalculationProvenance(p) == nil {
		t.Fatal("accepted false equation provenance")
	}
	h.Days[0].CoverageHours = 12
	if _, err := domain.CalculateNutrition(a.Nutrition); err == nil {
		t.Fatal("used an incomplete day")
	}
}
