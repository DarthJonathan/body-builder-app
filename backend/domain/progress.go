package domain

import (
	"fmt"
	"math"
	"sort"
	"time"
)

type TrainingSuggestion struct {
	WorkoutID       string   `json:"workoutId"`
	PrescriptionID  string   `json:"prescriptionId"`
	ExerciseID      string   `json:"exerciseId"`
	Name            string   `json:"name"`
	Kind            string   `json:"kind"`
	Message         string   `json:"message"`
	Evidence        []string `json:"evidence"`
	Dates           []string `json:"dates"`
	ObservedLoadKG  float64  `json:"observedLoadKg"`
	SuggestedLoadKG *float64 `json:"suggestedLoadKg,omitempty"`
}
type NutritionReview struct {
	Status                string   `json:"status"`
	Message               string   `json:"message"`
	Evidence              []string `json:"evidence"`
	WeeklyChangeKG        *float64 `json:"weeklyChangeKg,omitempty"`
	WeeklyChangePercent   *float64 `json:"weeklyChangePercent,omitempty"`
	AverageLoggedCalories *float64 `json:"averageLoggedCalories,omitempty"`
}
type ProgressReview struct {
	Version         string               `json:"version"`
	AsOf            string               `json:"asOf"`
	ProgramID       string               `json:"programId"`
	ProgramName     string               `json:"programName"`
	Training        []TrainingSuggestion `json:"training"`
	TrainingSummary string               `json:"trainingSummary"`
	Nutrition       NutritionReview      `json:"nutrition"`
	Adherence       struct {
		Scheduled  int `json:"scheduled"`
		Completed  int `json:"completed"`
		WindowDays int `json:"windowDays"`
	} `json:"adherence"`
	Policy  string       `json:"policy"`
	Sources []GoalSource `json:"sources"`
}

func shifted(date string, days int) string {
	d, _ := time.Parse("2006-01-02", date)
	return d.AddDate(0, 0, days).Format("2006-01-02")
}
func rounded(value float64) float64        { return math.Floor(value*100+0.5) / 100 }
func numberPointer(value float64) *float64 { v := rounded(value); return &v }
func reviewTarget(data AppSnapshot, date string) NutritionTargets {
	var target NutritionTargets
	for _, t := range data.Targets {
		if t.EffectiveDate <= date && t.EffectiveDate >= target.EffectiveDate {
			target = t
		}
	}
	return target
}

// ReviewProgress never mutates a snapshot or claims that sparse logs establish energy expenditure.
func ReviewProgress(data AppSnapshot, asOf string, rules ExpertRules, exercises []Exercise) ProgressReview {
	r := ProgressReview{Version: rules.ReviewVersion, AsOf: asOf, Training: []TrainingSuggestion{}, TrainingSummary: "Log complete working sets, load, repetitions and effort across repeated sessions to review progression.", Nutrition: NutritionReview{Status: "insufficient-data", Message: "Record weight on at least three days in each of two weeks, plus consistent meal logs, before reviewing a trend.", Evidence: []string{}}, Policy: rules.ReviewPolicy, Sources: rules.Sources}
	r.Adherence.WindowDays = rules.Progress.WindowDays
	var program *Program
	for i := range data.Programs {
		if data.Programs[i].ID == data.ActiveProgramID {
			program = &data.Programs[i]
			r.ProgramID = program.ID
			r.ProgramName = program.Name
			break
		}
	}
	since := shifted(asOf, -rules.Progress.WindowDays+1)
	sessions := []WorkoutSession{}
	for _, s := range data.Sessions {
		if s.FinishedAt != nil && s.Date >= since && s.Date <= asOf && len(*s.FinishedAt) >= 10 && (*s.FinishedAt)[:10] <= asOf {
			sessions = append(sessions, s)
		}
	}
	sort.Slice(sessions, func(i, j int) bool {
		if sessions[i].Date != sessions[j].Date {
			return sessions[i].Date > sessions[j].Date
		}
		return sessions[i].StartedAt > sessions[j].StartedAt
	})
	catalogue := map[string]Exercise{}
	for _, e := range exercises {
		catalogue[e.ID] = e
	}
	if program != nil {
		for _, w := range program.Workouts {
			for _, rx := range w.Exercises {
				e := catalogue[rx.ExerciseID]
				if !e.Weighted || rx.Seconds || rx.AMRAPLast {
					continue
				}
				type exposure struct {
					date  string
					entry SessionExercise
				}
				items := []exposure{}
				seen := map[string]bool{}
				for _, s := range sessions {
					if s.WorkoutID != w.ID || seen[s.Date] {
						continue
					}
					for _, entry := range s.Exercises {
						if entry.ExerciseID == rx.ExerciseID && entry.Prescription.ID == rx.ID {
							items = append(items, exposure{s.Date, entry})
							seen[s.Date] = true
							break
						}
					}
				}
				if len(items) < 2 || items[0].date < shifted(asOf, -14) {
					continue
				}
				valid := func(x exposure) bool {
					if x.entry.Prescription != rx || len(x.entry.Sets) != rx.Sets || len(x.entry.Sets) == 0 {
						return false
					}
					for _, s := range x.entry.Sets {
						if !s.Completed || s.Weight <= 0 || math.IsNaN(s.Weight) || math.IsInf(s.Weight, 0) || s.Weight != x.entry.Sets[0].Weight || s.Reps <= 0 || s.Effort == nil || !Contains([]string{"easy", "medium", "hard"}, *s.Effort) {
							return false
						}
					}
					return true
				}
				increase := len(items) >= rules.Progress.IncreaseExposures
				stall := len(items) >= rules.Progress.StallExposures
				for i, x := range items {
					if i < rules.Progress.IncreaseExposures {
						if !valid(x) || x.entry.Sets[0].Weight != items[0].entry.Sets[0].Weight {
							increase = false
						} else {
							for _, s := range x.entry.Sets {
								if s.Reps < rx.RepsMax || *s.Effort == "hard" {
									increase = false
								}
							}
						}
					}
					if i < rules.Progress.StallExposures {
						if !valid(x) || x.entry.Sets[0].Weight != items[0].entry.Sets[0].Weight {
							stall = false
						} else {
							for _, s := range x.entry.Sets {
								if s.Reps >= rx.RepsMin || *s.Effort != "hard" {
									stall = false
								}
							}
						}
					}
				}
				if !increase && !stall {
					continue
				}
				load := items[0].entry.Sets[0].Weight
				suggestion := TrainingSuggestion{WorkoutID: w.ID, PrescriptionID: rx.ID, ExerciseID: rx.ExerciseID, Name: e.Name, ObservedLoadKG: load, Dates: []string{}}
				count := rules.Progress.StallExposures
				if increase {
					count = rules.Progress.IncreaseExposures
					suggestion.Kind = "increase-load"
					suggestion.SuggestedLoadKG = numberPointer(load * (1 + rules.Progress.IncreasePercent/100))
					suggestion.Message = "Consider the smallest available load increase, around 2.5%, while retaining controlled technique."
					suggestion.Evidence = []string{fmt.Sprintf("All %d sets reached at least %d reps at %g kg in two separate sessions.", rx.Sets, rx.RepsMax, load), "Every set was marked easy or medium. These labels do not measure reps in reserve."}
				} else {
					suggestion.Kind = "review-stall"
					suggestion.Message = "Review technique, rest and recovery. Consider a lighter load that lets you reach the prescribed minimum before adding more work."
					suggestion.Evidence = []string{fmt.Sprintf("All prescribed sets stayed below %d reps at the same load in three separate sessions.", rx.RepsMin), "Every set was marked hard; this is a prompt to review, not a diagnosis of a plateau."}
				}
				for i := 0; i < count; i++ {
					suggestion.Dates = append(suggestion.Dates, items[i].date)
				}
				r.Training = append(r.Training, suggestion)
			}
		}
	}
	if len(r.Training) > 0 {
		plural := "s"
		if len(r.Training) == 1 {
			plural = ""
		}
		r.TrainingSummary = fmt.Sprintf("%d exercise%s with enough repeated observations to review. Suggestions do not edit your program.", len(r.Training), plural)
	}
	for _, s := range data.Schedule {
		if s.Date < since || s.Date > asOf || s.WorkoutID == nil {
			continue
		}
		r.Adherence.Scheduled++
		for _, entry := range sessions {
			if entry.Date == s.Date && entry.WorkoutID == *s.WorkoutID {
				r.Adherence.Completed++
				break
			}
		}
	}
	first, last := []float64{}, []float64{}
	logged, total := 0, 0.0
	target := reviewTarget(data, asOf)
	stable := true
	for i := 0; i < 14; i++ {
		date := shifted(asOf, i-14)
		weight := 0.0
		for _, w := range data.CheckIns {
			if w.Date == date {
				weight = w.Weight
				break
			}
		}
		for _, w := range data.Weights {
			if w.Date == date {
				weight = w.Weight
				break
			}
		}
		if weight >= 30 && weight <= 350 {
			if i < 7 {
				first = append(first, weight)
			} else {
				last = append(last, weight)
			}
		}
		meals := map[string]bool{}
		calories := 0.0
		for _, f := range data.FoodEntries {
			if f.Date == date && !math.IsNaN(f.Calories) && !math.IsInf(f.Calories, 0) && f.Calories >= 0 {
				meals[f.Meal] = true
				calories += f.Calories
			}
		}
		if len(meals) >= rules.Nutrition.MinimumMeals {
			logged++
			total += calories
		}
		if reviewTarget(data, date).ID != target.ID {
			stable = false
		}
	}
	r.Nutrition.Evidence = []string{fmt.Sprintf("%d weight days in the first week; %d in the second.", len(first), len(last)), fmt.Sprintf("%d of 14 completed days have entries in at least two meal groups. This does not confirm that entire days were logged.", logged)}
	if logged > 0 {
		r.Nutrition.AverageLoggedCalories = numberPointer(total / float64(logged))
	}
	if len(first) < rules.Nutrition.WeightsPerWeek || len(last) < rules.Nutrition.WeightsPerWeek {
		return r
	}
	avg := func(items []float64) float64 {
		sum := 0.0
		for _, w := range items {
			sum += w
		}
		return sum / float64(len(items))
	}
	change := avg(last) - avg(first)
	percent := change / avg(first) * 100
	r.Nutrition.WeeklyChangeKG = numberPointer(change)
	r.Nutrition.WeeklyChangePercent = numberPointer(percent)
	r.Nutrition.Evidence = append(r.Nutrition.Evidence, fmt.Sprintf("Weekly average weight changed %g kg (%g%%). Water and measurement conditions can affect this.", rounded(change), rounded(percent)))
	if target.Calculation == nil || target.Mode == "manual" || target.ManuallyOverridden {
		r.Nutrition.Status = "manual-targets"
		r.Nutrition.Message = "Your targets are manual. Review this weight trend alongside your food log; your chosen targets remain unchanged."
		return r
	}
	if !stable || logged < rules.Nutrition.LoggedDays {
		r.Nutrition.Message = "Review after two weeks with the same targets and at least ten days of consistent meal logs. Your current targets remain unchanged."
		return r
	}
	unusual := math.Abs(percent) > rules.Nutrition.MaximumWeeklyChangePercent
	mismatch := math.Abs(percent) > 0.5
	switch target.Calculation.Input.Goal {
	case "build-muscle":
		mismatch = percent <= 0 || percent > 0.5
	case "lose-fat":
		mismatch = percent >= 0 || percent < -1
	}
	r.Nutrition.Status = "on-track"
	r.Nutrition.Message = "The observed trend is within this goal’s initial review band. Keep logging and review training performance and recovery."
	if unusual || mismatch {
		r.Nutrition.Status = "review-trend"
		r.Nutrition.Message = "The observed trend differs from this goal’s review band. If these entries represent full days, review your portions, recovery and calorie target; a small 100 kcal adjustment can be reassessed after another two weeks."
	}
	if unusual {
		r.Nutrition.Message = "The weight change is unusually large. Verify weights, timing and logging before considering any calorie change."
	}
	r.Nutrition.Evidence = append(r.Nutrition.Evidence, "BodyBuilder review bands: muscle gain above 0% up to 0.5% per week; fat loss below 0% down to −1%; maintenance within ±0.5%. These are prompts to review, not validated outcome predictions.")
	return r
}
