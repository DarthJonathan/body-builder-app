package domain

import (
	"errors"
	"fmt"
	"math"
	"net/url"
	"regexp"
	"strings"
	"time"
	_ "time/tzdata" // Keep account timezones available in the minimal production image.
	"unicode/utf8"
)

var identifierPattern = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,179}$`)

func Identifier(value string) error {
	if !identifierPattern.MatchString(value) {
		return errors.New("record ID is missing or invalid")
	}
	return nil
}
func Text(value, label string, max int, empty bool) error {
	if (!empty && strings.TrimSpace(value) == "") || utf8.RuneCountInString(value) > max {
		return fmt.Errorf("%s must contain %s at most %d characters", label, map[bool]string{true: "", false: "text and "}[empty], max)
	}
	return nil
}
func Date(value string) error {
	parsed, err := time.Parse("2006-01-02", value)
	if err != nil || parsed.Format("2006-01-02") != value {
		return errors.New("enter a valid calendar date")
	}
	return nil
}
func Timestamp(value string) error {
	if _, err := time.Parse(time.RFC3339Nano, value); err != nil {
		return errors.New("enter a valid timestamp")
	}
	return nil
}
func Number(value float64, label string, min, max float64) error {
	if math.IsNaN(value) || math.IsInf(value, 0) || value < min || value > max {
		return fmt.Errorf("%s must be between %g and %g", label, min, max)
	}
	return nil
}
func Choice(value, label string, options ...string) error {
	for _, option := range options {
		if value == option {
			return nil
		}
	}
	return fmt.Errorf("choose a valid %s", label)
}
func ValidateNutrients(n Nutrients) error {
	for _, v := range []struct {
		value float64
		label string
		max   float64
	}{{n.Calories, "calories", 100000}, {n.Protein, "protein", 10000}, {n.Carbs, "carbs", 10000}, {n.Fat, "fat", 10000}} {
		if err := Number(v.value, v.label, 0, v.max); err != nil {
			return err
		}
	}
	return nil
}
func ValidateProfile(p Profile) error {
	if err := Text(p.DisplayName, "display name", 80, false); err != nil {
		return err
	}
	if err := Text(p.Timezone, "timezone", 100, false); err != nil {
		return err
	}
	if _, err := time.LoadLocation(p.Timezone); err != nil {
		return errors.New("choose a valid timezone")
	}
	if err := Choice(p.Unit, "weight unit", "kg", "lb"); err != nil {
		return err
	}
	if err := Choice(p.Goal, "goal", "build-muscle", "maintain", "lose-fat"); err != nil {
		return err
	}
	if err := Number(p.StartWeight, "starting weight in kg", 0, 700); err != nil {
		return err
	}
	return Date(p.GoalStartedAt)
}
func ValidatePrescription(p Prescription) error {
	if err := Identifier(p.ID); err != nil {
		return err
	}
	if err := Identifier(p.ExerciseID); err != nil {
		return err
	}
	if p.Sets < 1 || p.Sets > 100 || p.RepsMin < 0 || p.RepsMax < 1 || p.RepsMax > 10000 || p.RepsMin > p.RepsMax || p.RestSeconds < 0 || p.RestSeconds > 3600 {
		return errors.New("check the set count, rep range, and rest duration")
	}
	return Text(p.Superset, "superset", 180, true)
}
func ValidateProgram(p Program, knownExercises map[string]bool, knownMuscles map[string]bool) error {
	if p.Details != nil {
		if err := ValidateProgramMetadata(*p.Details); err != nil {
			return err
		}
	}
	if err := Identifier(p.ID); err != nil {
		return err
	}
	if err := Text(p.Name, "program name", 150, false); err != nil {
		return err
	}
	if err := Text(p.Level, "program level", 80, false); err != nil {
		return err
	}
	if err := Choice(p.Goal, "program goal", "build-muscle", "maintain", "lose-fat"); err != nil {
		return err
	}
	if len(p.Workouts) < 1 || len(p.Workouts) > 30 {
		return errors.New("a program needs between 1 and 30 workouts")
	}
	if err := Text(p.Source, "program source", 2000, true); err != nil {
		return err
	}
	if err := Text(p.SourceName, "program source name", 150, true); err != nil {
		return err
	}
	if p.SourceReviewedAt != "" {
		if err := Date(p.SourceReviewedAt); err != nil {
			return err
		}
	}
	if err := Text(p.AdaptationNote, "program adaptation note", 2000, true); err != nil {
		return err
	}
	workouts := map[string]bool{}
	for _, w := range p.Workouts {
		if w.Key != "" {
			if err := ValidateProgramKey(w.Key); err != nil {
				return err
			}
		}
		if err := Identifier(w.ID); err != nil {
			return err
		}
		if workouts[w.ID] {
			return errors.New("workout IDs must be unique")
		}
		workouts[w.ID] = true
		if err := Text(w.Name, "workout name", 150, false); err != nil {
			return err
		}
		if w.Exercises == nil || len(w.Exercises) > 100 || w.Muscles == nil || len(w.Muscles) > 30 || w.Warmup == nil || len(w.Warmup) > 30 {
			return errors.New("workout lists are missing or too long")
		}
		ids := map[string]bool{}
		for _, p := range w.Exercises {
			if p.Key != "" {
				if err := ValidateProgramKey(p.Key); err != nil {
					return err
				}
			}
			if err := ValidatePrescription(p); err != nil {
				return err
			}
			if !knownExercises[p.ExerciseID] {
				return errors.New("choose an exercise from the exercise library")
			}
			if ids[p.ID] {
				return errors.New("exercise prescription IDs must be unique")
			}
			ids[p.ID] = true
		}
		for _, m := range w.Muscles {
			if !knownMuscles[m.ID] {
				return errors.New("choose a known target muscle")
			}
			if m.Percentage != nil {
				if err := Number(*m.Percentage, "muscle percentage", 0, 100); err != nil {
					return err
				}
			}
		}
		for _, instruction := range w.Warmup {
			if err := Text(instruction, "warmup instruction", 1000, false); err != nil {
				return err
			}
		}
	}
	return nil
}
func ValidateSession(s WorkoutSession) error {
	if err := Identifier(s.ID); err != nil {
		return err
	}
	if err := Identifier(s.WorkoutID); err != nil {
		return err
	}
	if err := Date(s.Date); err != nil {
		return err
	}
	if err := Timestamp(s.StartedAt); err != nil {
		return err
	}
	if s.FinishedAt != nil {
		if err := Timestamp(*s.FinishedAt); err != nil {
			return err
		}
		finished, _ := time.Parse(time.RFC3339Nano, *s.FinishedAt)
		started, _ := time.Parse(time.RFC3339Nano, s.StartedAt)
		if finished.Before(started) {
			return errors.New("finish time must follow start time")
		}
	}
	if s.RestDeadline != nil {
		if err := Timestamp(*s.RestDeadline); err != nil {
			return err
		}
	}
	if s.RestDuration < 0 || s.RestDuration > 3600 || s.Exercises == nil || len(s.Exercises) > 100 {
		return errors.New("session values are invalid")
	}
	ids := map[string]bool{}
	for _, e := range s.Exercises {
		if err := Identifier(e.ID); err != nil {
			return err
		}
		if ids[e.ID] {
			return errors.New("session exercise IDs must be unique")
		}
		ids[e.ID] = true
		if err := ValidatePrescription(e.Prescription); err != nil {
			return err
		}
		if e.ExerciseID != e.Prescription.ExerciseID {
			return errors.New("session exercise does not match its prescription")
		}
		if err := Text(e.Notes, "exercise notes", 5000, true); err != nil {
			return err
		}
		if e.Sets == nil || len(e.Sets) > 100 {
			return errors.New("too many sets")
		}
		setIDs := map[string]bool{}
		for _, set := range e.Sets {
			if err := Identifier(set.ID); err != nil {
				return err
			}
			if setIDs[set.ID] {
				return errors.New("set IDs must be unique")
			}
			setIDs[set.ID] = true
			if err := Number(set.Weight, "set weight", 0, 2000); err != nil {
				return err
			}
			if set.Reps < 0 || set.Reps > 10000 {
				return errors.New("repetitions are out of range")
			}
			if set.Effort != nil {
				if err := Choice(*set.Effort, "effort", "easy", "medium", "hard"); err != nil {
					return err
				}
			}
		}
	}
	return nil
}
func ValidateFood(f FoodEntry) error {
	if err := Identifier(f.ID); err != nil {
		return err
	}
	if err := Text(f.Name, "food name", 200, false); err != nil {
		return err
	}
	if err := Date(f.Date); err != nil {
		return err
	}
	if err := Choice(f.Meal, "meal", "Breakfast", "Lunch", "Dinner", "Snacks"); err != nil {
		return err
	}
	if err := Choice(f.Source, "food source", "database", "manual", "ai-estimate"); err != nil {
		return err
	}
	if f.FoodID != "" {
		if err := Identifier(f.FoodID); err != nil {
			return err
		}
	}
	if err := Number(f.Quantity, "serving quantity", .001, 10000); err != nil {
		return err
	}
	if err := Text(f.Serving, "serving", 150, false); err != nil {
		return err
	}
	if err := Text(f.DatabaseSource, "database source", 1000, true); err != nil {
		return err
	}
	return ValidateNutrients(f.Nutrients)
}
func ValidateTargets(t NutritionTargets) error {
	if err := Identifier(t.ID); err != nil {
		return err
	}
	if err := Date(t.EffectiveDate); err != nil {
		return err
	}
	if err := Choice(t.Mode, "target mode", "manual", "calculated"); err != nil {
		return err
	}
	if err := ValidateNutrients(t.Nutrients); err != nil {
		return err
	}
	if err := Number(t.Calories, "calorie target", 1, 20000); err != nil {
		return err
	}
	return ValidateCalculationProvenance(t)
}
func ValidateCheckIn(c CheckIn) error {
	if err := Identifier(c.ID); err != nil {
		return err
	}
	if err := Date(c.Date); err != nil {
		return err
	}
	if err := Text(c.Notes, "check-in notes", 5000, true); err != nil {
		return err
	}
	return Number(c.Weight, "weight in kg", 1, 700)
}
func ValidateWeight(w WeightEntry) error {
	if err := Identifier(w.ID); err != nil {
		return err
	}
	if err := Date(w.Date); err != nil {
		return err
	}
	return Number(w.Weight, "weight in kg", 1, 700)
}
func ValidateLesson(l Lesson) error {
	if err := Identifier(l.ID); err != nil {
		return err
	}
	if err := Text(l.Title, "lesson title", 200, false); err != nil {
		return err
	}
	if err := Text(l.URL, "lesson link", 2000, true); err != nil {
		return err
	}
	if l.URL != "" {
		u, err := url.Parse(l.URL)
		if err != nil || u.Host == "" || u.User != nil || (u.Scheme != "http" && u.Scheme != "https") {
			return errors.New("lesson links must use https:// or http:// without credentials")
		}
	}
	if err := Text(l.Notes, "lesson notes", 10000, true); err != nil {
		return err
	}
	if err := Text(l.Category, "lesson category", 100, false); err != nil {
		return err
	}
	if err := Text(l.Source, "lesson source", 150, true); err != nil {
		return err
	}
	return Timestamp(l.SavedAt)
}
