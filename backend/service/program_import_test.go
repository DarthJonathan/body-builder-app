package service

import (
	"encoding/json"
	"reflect"
	"testing"
	"training-app/backend/domain"
)

func cloneDocument(t *testing.T, d domain.ProgramDocument) domain.ProgramDocument {
	t.Helper()
	raw, _ := json.Marshal(d)
	var copy domain.ProgramDocument
	if err := json.Unmarshal(raw, &copy); err != nil {
		t.Fatal(err)
	}
	return copy
}
func TestProgramImportIdentityReferencesAndHistory(t *testing.T) {
	s := NewTrainingService(nil)
	doc := cloneDocument(t, s.Catalogue.Programs[0])
	doc.Key = "personal-import"
	state := domain.AppSnapshot{Programs: []domain.Program{}, Schedule: []domain.ScheduleEntry{}, Sessions: []domain.WorkoutSession{}}
	if err := s.importProgram(&state, doc); err != nil {
		t.Fatal(err)
	}
	original := state.Programs[0]
	if err := s.importProgram(&state, cloneDocument(t, doc)); err != nil {
		t.Fatal(err)
	}
	if len(state.Programs) != 1 || state.ActiveProgramID != original.ID {
		t.Fatal("retry duplicated program")
	}
	workoutID := original.Workouts[0].ID
	state.Schedule = append(state.Schedule, domain.ScheduleEntry{ID: "assignment", Date: "2026-10-11", WorkoutID: &workoutID})
	state.Sessions = append(state.Sessions, domain.WorkoutSession{ID: "logged-history", WorkoutID: workoutID, Name: original.Workouts[0].Name, Exercises: []domain.SessionExercise{{ID: "historical", Prescription: original.Workouts[0].Exercises[0]}}})
	history := state.Sessions[0]
	next := cloneDocument(t, doc)
	next.Name = "Updated"
	next.Workouts[0].Exercises[0].Sets++
	if err := s.importProgram(&state, next); err == nil {
		t.Fatal("same-version changes accepted")
	}
	next.Version++
	if err := s.importProgram(&state, next); err != nil {
		t.Fatal(err)
	}
	updated := state.Programs[0]
	if updated.ID != original.ID || updated.Workouts[0].ID != workoutID || updated.Workouts[0].Exercises[0].ID != original.Workouts[0].Exercises[0].ID {
		t.Fatal("IDs changed")
	}
	if !reflect.DeepEqual(state.Sessions[0], history) {
		t.Fatal("import rewrote history")
	}
	removed := cloneDocument(t, next)
	removed.Version++
	removed.DaysPerWeek = 1
	removed.Workouts = removed.Workouts[1:]
	if err := s.importProgram(&state, removed); err == nil {
		t.Fatal("removed an assigned workout")
	}
	state.Schedule = nil
	if err := s.importProgram(&state, removed); err == nil {
		t.Fatal("removed an unfinished session's workout")
	}
	finished := "2026-10-11T12:00:00Z"
	state.Sessions[0].FinishedAt = &finished
	if err := s.importProgram(&state, removed); err != nil {
		t.Fatal("finished sessions are independent snapshots", err)
	}
	if state.Sessions[0].Exercises[0].Prescription.Sets != history.Exercises[0].Prescription.Sets {
		t.Fatal("lost historical prescription")
	}
}
