package service

import (
	"encoding/json"
	"errors"
	"reflect"
	"sort"
	"strings"
	"time"
	"training-app/backend/domain"

	"github.com/hashicorp/go-uuid"
)

func newRecordID(prefix string) string {
	id, err := uuid.GenerateUUID()
	if err != nil {
		panic(err)
	}
	return prefix + "-" + id
}
func upsert[T any](values []T, value T, getID func(T) string) []T {
	for i, v := range values {
		if getID(v) == getID(value) {
			values[i] = value
			return values
		}
	}
	return append(values, value)
}
func upsertDate[T any](values []T, value T, getDate func(T) string, getID func(T) string, setID func(*T, string), prefix string) []T {
	for i, v := range values {
		if getDate(v) == getDate(value) {
			setID(&value, getID(v))
			values[i] = value
			return values
		}
	}
	for _, v := range values {
		if getID(v) == getID(value) {
			setID(&value, newRecordID(prefix))
			break
		}
	}
	values = append(values, value)
	sort.Slice(values, func(i, j int) bool { return getDate(values[i]) < getDate(values[j]) })
	return values
}
func findWorkout(s *domain.AppSnapshot, id string) *domain.Workout {
	for pi := range s.Programs {
		for wi := range s.Programs[pi].Workouts {
			w := &s.Programs[pi].Workouts[wi]
			if w.ID == id {
				return w
			}
		}
	}
	return nil
}
func assignDate(s *domain.AppSnapshot, date string, workoutID *string) {
	s.Schedule = upsertDate(s.Schedule, domain.ScheduleEntry{ID: newRecordID("schedule"), Date: date, WorkoutID: workoutID}, func(v domain.ScheduleEntry) string { return v.Date }, func(v domain.ScheduleEntry) string { return v.ID }, func(v *domain.ScheduleEntry, id string) { v.ID = id }, "schedule")
}
func (s *TrainingService) apply(data *domain.AppSnapshot, operation string, payload json.RawMessage) error {
	switch operation {
	case "importProgram":
		input, err := decodePayload[struct {
			Document domain.ProgramDocument `json:"document"`
		}](payload)
		if err != nil {
			return err
		}
		return s.importProgram(data, input.Document)
	case "createGoalPlan":
		input, err := decodePayload[domain.CreateGoalPlan](payload)
		if err != nil {
			return err
		}
		return s.createGoalPlan(data, input)
	case "saveHealthEnergy":
		input, err := decodePayload[struct {
			Energy *domain.HealthEnergy `json:"energy"`
		}](payload)
		if err != nil {
			return err
		}
		if input.Energy != nil {
			if err := domain.ValidateRecentHealthEnergy(*input.Energy, s.now()); err != nil {
				return invalidTraining(err)
			}
		}
		data.HealthEnergy = input.Energy
	case "updateProfile":
		patch, err := decodePayload[map[string]json.RawMessage](payload)
		if err != nil {
			return err
		}
		allowed := map[string]bool{"displayName": true, "timezone": true, "unit": true, "goal": true, "startWeight": true, "goalStartedAt": true}
		for field := range patch {
			if !allowed[field] {
				return &TrainingError{Status: 403, Code: "profile_field_forbidden", Message: "account identity, email, and role cannot be changed in profile settings"}
			}
		}
		original, _ := json.Marshal(data.Profile)
		var merged map[string]json.RawMessage
		_ = json.Unmarshal(original, &merged)
		for k, v := range patch {
			merged[k] = v
		}
		encoded, _ := json.Marshal(merged)
		profile, err := decodePayload[domain.Profile](encoded)
		if err != nil {
			return err
		}
		profile.DisplayName = strings.TrimSpace(profile.DisplayName)
		if err := domain.ValidateProfile(profile); err != nil {
			return invalidTraining(err)
		}
		data.Profile = profile
	case "saveProgram":
		p, err := decodePayload[domain.Program](payload)
		if err != nil {
			return err
		}
		knownExercises := map[string]bool{}
		knownMuscles := map[string]bool{}
		for _, e := range s.Catalogue.Exercises {
			knownExercises[e.ID] = true
		}
		for _, m := range s.Catalogue.Muscles {
			knownMuscles[m.ID] = true
		}
		if err := domain.ValidateProgram(p, knownExercises, knownMuscles); err != nil {
			return invalidTraining(err)
		}
		for _, other := range data.Programs {
			if other.ID == p.ID {
				continue
			}
			if p.Details != nil && other.Details != nil && p.Details.Key == other.Details.Key {
				return invalidTraining(errors.New("a program key already belongs to another private program"))
			}
			for _, w := range other.Workouts {
				for _, candidate := range p.Workouts {
					if candidate.ID == w.ID {
						return invalidTraining(errors.New("a workout belongs to another program; use a private template copy"))
					}
				}
			}
		}
		p.Name = strings.TrimSpace(p.Name)
		data.Programs = upsert(data.Programs, p, func(v domain.Program) string { return v.ID })
		data.ActiveProgramID = p.ID
	case "useTemplate":
		in, err := decodePayload[struct {
			TemplateID string `json:"templateId"`
		}](payload)
		if err != nil {
			return err
		}
		chosen, err := s.findProgramTemplate(in.TemplateID)
		if err != nil {
			return err
		}
		encoded, _ := json.Marshal(chosen.Program)
		var p domain.Program
		_ = json.Unmarshal(encoded, &p)
		p.ID = newRecordID("program")
		if p.Details != nil {
			p.Details.Key = "copy-" + p.ID
		}
		for wi := range p.Workouts {
			w := &p.Workouts[wi]
			w.ID = newRecordID("workout")
			groups := map[string]string{}
			for pi := range w.Exercises {
				rx := &w.Exercises[pi]
				rx.ID = newRecordID("prescription")
				if rx.Superset != "" {
					if groups[rx.Superset] == "" {
						groups[rx.Superset] = newRecordID("superset")
					}
					rx.Superset = groups[rx.Superset]
				}
			}
		}
		data.Programs = append(data.Programs, p)
		data.ActiveProgramID = p.ID
	case "assignWorkout", "startWorkout":
		in, err := decodePayload[struct {
			Date      string  `json:"date"`
			WorkoutID *string `json:"workoutId"`
		}](payload)
		if err != nil {
			return err
		}
		if err := domain.Date(in.Date); err != nil {
			return invalidTraining(err)
		}
		var workout *domain.Workout
		if in.WorkoutID != nil {
			workout = findWorkout(data, *in.WorkoutID)
			if workout == nil {
				return missingTraining("that workout is unavailable in this account")
			}
		}
		if operation == "startWorkout" {
			if workout == nil || len(workout.Exercises) == 0 {
				return invalidTraining(errors.New("choose a workout with at least one exercise"))
			}
			var running *domain.WorkoutSession
			for i := range data.Sessions {
				if data.Sessions[i].FinishedAt == nil {
					running = &data.Sessions[i]
					break
				}
			}
			if running != nil && (running.WorkoutID != workout.ID || running.Date != in.Date) {
				return &TrainingError{Status: 409, Code: "session_active", Message: "finish the active workout before starting another"}
			}
			if running == nil {
				session := domain.WorkoutSession{ID: newRecordID("session"), WorkoutID: workout.ID, Name: workout.Name, Date: in.Date, StartedAt: s.now().Format("2006-01-02T15:04:05.999999999Z07:00"), Exercises: []domain.SessionExercise{}, RestDuration: 90}
				for _, rx := range workout.Exercises {
					exercise := domain.SessionExercise{ID: newRecordID("session-exercise"), ExerciseID: rx.ExerciseID, Prescription: rx, Sets: []domain.LoggedSet{}}
					for i := 0; i < rx.Sets; i++ {
						exercise.Sets = append(exercise.Sets, domain.LoggedSet{ID: newRecordID("set")})
					}
					session.Exercises = append(session.Exercises, exercise)
				}
				data.Sessions = append(data.Sessions, session)
			}
		}
		assignDate(data, in.Date, in.WorkoutID)
	case "saveSession":
		value, err := decodePayload[domain.WorkoutSession](payload)
		if err != nil {
			return err
		}
		if err := domain.ValidateSession(value); err != nil {
			return invalidTraining(err)
		}
		var existing *domain.WorkoutSession
		for i := range data.Sessions {
			if data.Sessions[i].ID == value.ID {
				existing = &data.Sessions[i]
				break
			}
		}
		if existing == nil {
			return missingTraining("that session is unavailable in this account")
		}
		if existing.FinishedAt != nil {
			return &TrainingError{Status: 409, Code: "session_finished", Message: "this workout was already finished on another device"}
		}
		if existing.WorkoutID != value.WorkoutID || existing.Name != value.Name || existing.Date != value.Date || existing.StartedAt != value.StartedAt || !reflect.DeepEqual(existing.FinishedAt, value.FinishedAt) || len(existing.Exercises) != len(value.Exercises) {
			return invalidTraining(errors.New("session identity and timing are fixed; use Finish to complete it"))
		}
		for _, item := range value.Exercises {
			var original *domain.SessionExercise
			for i := range existing.Exercises {
				if existing.Exercises[i].ID == item.ID {
					original = &existing.Exercises[i]
					break
				}
			}
			if original == nil || original.ExerciseID != item.ExerciseID || !reflect.DeepEqual(original.Prescription, item.Prescription) {
				return invalidTraining(errors.New("session prescriptions are snapshots; edit your program for a future workout"))
			}
		}
		*existing = value
	case "finishSession":
		in, err := decodePayload[struct {
			SessionID  string  `json:"sessionId"`
			FinishedAt *string `json:"finishedAt,omitempty"`
		}](payload)
		if err != nil {
			return err
		}
		var found bool
		for i := range data.Sessions {
			session := &data.Sessions[i]
			if session.ID == in.SessionID {
				found = true
				if session.FinishedAt == nil {
					finished := s.now()
					if in.FinishedAt != nil {
						parsed, err := time.Parse(time.RFC3339Nano, *in.FinishedAt)
						started, startError := time.Parse(time.RFC3339Nano, session.StartedAt)
						if err != nil || startError != nil || parsed.Before(started) || parsed.After(s.now().Add(5*time.Minute)) {
							return invalidTraining(errors.New("completion time must follow the workout start and cannot be in the future"))
						}
						finished = parsed.UTC()
					}
					value := finished.Format(time.RFC3339Nano)
					session.FinishedAt = &value
				}
				session.RestDeadline = nil
				break
			}
		}
		if !found {
			return missingTraining("that session is unavailable in this account")
		}
	case "saveFood":
		value, err := decodePayload[domain.FoodEntry](payload)
		if err != nil {
			return err
		}
		if err := domain.ValidateFood(value); err != nil {
			return invalidTraining(err)
		}
		value.Name = strings.TrimSpace(value.Name)
		value.Serving = strings.TrimSpace(value.Serving)
		data.FoodEntries = upsert(data.FoodEntries, value, func(v domain.FoodEntry) string { return v.ID })
	case "deleteFood":
		in, err := decodePayload[struct {
			ID string `json:"id"`
		}](payload)
		if err != nil {
			return err
		}
		found := false
		for i, v := range data.FoodEntries {
			if v.ID == in.ID {
				data.FoodEntries = append(data.FoodEntries[:i], data.FoodEntries[i+1:]...)
				found = true
				break
			}
		}
		if !found {
			return missingTraining("that food entry is unavailable in this account")
		}
	case "copyFoods":
		in, err := decodePayload[struct {
			FromDate string `json:"fromDate"`
			ToDate   string `json:"toDate"`
		}](payload)
		if err != nil {
			return err
		}
		if err := domain.Date(in.FromDate); err != nil {
			return invalidTraining(err)
		}
		if err := domain.Date(in.ToDate); err != nil {
			return invalidTraining(err)
		}
		if in.FromDate == in.ToDate {
			return invalidTraining(errors.New("choose a different date to copy meals to"))
		}
		copies := []domain.FoodEntry{}
		for _, entry := range data.FoodEntries {
			if entry.Date == in.FromDate {
				entry.ID = newRecordID("food")
				entry.Date = in.ToDate
				copies = append(copies, entry)
			}
		}
		if len(copies) == 0 {
			return missingTraining("there are no foods on that date to copy")
		}
		data.FoodEntries = append(data.FoodEntries, copies...)
	case "saveTargets":
		value, err := decodePayload[domain.NutritionTargets](payload)
		if err != nil {
			return err
		}
		if value.Mode == "manual" {
			for _, existing := range data.Targets {
				if existing.EffectiveDate != value.EffectiveDate || existing.Calculation == nil {
					continue
				}
				if value.Calculation != nil && !reflect.DeepEqual(value.Calculation, existing.Calculation) {
					return invalidTraining(errors.New("manual overrides keep the original calculation; recalculate and apply to change its inputs"))
				}
				value.Calculation = existing.Calculation
				value.ManuallyOverridden = true
			}
		}
		if err := domain.ValidateTargets(value); err != nil {
			return invalidTraining(err)
		}
		data.Targets = upsertDate(data.Targets, value, func(v domain.NutritionTargets) string { return v.EffectiveDate }, func(v domain.NutritionTargets) string { return v.ID }, func(v *domain.NutritionTargets, id string) { v.ID = id }, "targets")
	case "saveCheckIn":
		value, err := decodePayload[domain.CheckIn](payload)
		if err != nil {
			return err
		}
		if err := domain.ValidateCheckIn(value); err != nil {
			return invalidTraining(err)
		}
		data.CheckIns = upsertDate(data.CheckIns, value, func(v domain.CheckIn) string { return v.Date }, func(v domain.CheckIn) string { return v.ID }, func(v *domain.CheckIn, id string) { v.ID = id }, "checkin")
		data.Weights = upsertDate(data.Weights, domain.WeightEntry{ID: newRecordID("weight"), Date: value.Date, Weight: value.Weight}, func(v domain.WeightEntry) string { return v.Date }, func(v domain.WeightEntry) string { return v.ID }, func(v *domain.WeightEntry, id string) { v.ID = id }, "weight")
	case "saveWeight":
		value, err := decodePayload[domain.WeightEntry](payload)
		if err != nil {
			return err
		}
		if err := domain.ValidateWeight(value); err != nil {
			return invalidTraining(err)
		}
		data.Weights = upsertDate(data.Weights, value, func(v domain.WeightEntry) string { return v.Date }, func(v domain.WeightEntry) string { return v.ID }, func(v *domain.WeightEntry, id string) { v.ID = id }, "weight")
		for i := range data.CheckIns {
			if data.CheckIns[i].Date == value.Date {
				data.CheckIns[i].Weight = value.Weight
			}
		}
	case "saveLesson":
		value, err := decodePayload[domain.Lesson](payload)
		if err != nil {
			return err
		}
		if err := domain.ValidateLesson(value); err != nil {
			return invalidTraining(err)
		}
		value.Title = strings.TrimSpace(value.Title)
		value.URL = strings.TrimSpace(value.URL)
		data.Lessons = upsert(data.Lessons, value, func(v domain.Lesson) string { return v.ID })
	case "deleteLesson":
		in, err := decodePayload[struct {
			ID string `json:"id"`
		}](payload)
		if err != nil {
			return err
		}
		found := false
		for i, v := range data.Lessons {
			if v.ID == in.ID {
				data.Lessons = append(data.Lessons[:i], data.Lessons[i+1:]...)
				found = true
				break
			}
		}
		if !found {
			return missingTraining("that lesson is unavailable in this account")
		}
	default:
		return invalidTraining(errors.New("unknown training operation"))
	}
	return nil
}
