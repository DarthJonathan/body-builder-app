package service

import (
	"encoding/json"
	"reflect"
	"testing"
	"time"
	"training-app/backend/catalogue"
	"training-app/backend/dao"
	"training-app/backend/domain"
)

func TestTemplateCreatesIndependentProgramAndPrescriptionIDs(t *testing.T) {
	s := &TrainingService{Catalogue: catalogue.Load(), Now: func() time.Time { return time.Date(2026, 10, 9, 12, 0, 0, 0, time.UTC) }}
	state := emptySnapshot(dao.User{ID: "user-one", DisplayName: "User", Role: "user"}, s.now())
	before, _ := json.Marshal(s.Catalogue.Templates)
	for i := 0; i < 2; i++ {
		if err := s.apply(&state, "useTemplate", json.RawMessage(`{"templateId":"upper-lower-4"}`)); err != nil {
			t.Fatal(err)
		}
	}
	if len(state.Programs) != 2 || state.Programs[0].ID == state.Programs[1].ID || state.Programs[0].Workouts[0].ID == state.Programs[1].Workouts[0].ID {
		t.Fatal("template copies share private identities")
	}
	state.Programs[0].Workouts[0].Exercises[0].Sets = 5
	after, _ := json.Marshal(s.Catalogue.Templates)
	if !reflect.DeepEqual(before, after) {
		t.Fatal("copy changed shared templates")
	}
}

func TestSessionPrescriptionIsFrozenWhenProgramChanges(t *testing.T) {
	s := &TrainingService{Catalogue: catalogue.Load(), Now: time.Now}
	state := emptySnapshot(dao.User{ID: "user-one", Role: "user"}, s.now())
	if err := s.apply(&state, "useTemplate", json.RawMessage(`{"templateId":"upper-lower-4"}`)); err != nil {
		t.Fatal(err)
	}
	workout := state.Programs[0].Workouts[0]
	payload, _ := json.Marshal(map[string]string{"date": "2026-10-09", "workoutId": workout.ID})
	if err := s.apply(&state, "startWorkout", payload); err != nil {
		t.Fatal(err)
	}
	original := state.Sessions[0].Exercises[0].Prescription
	state.Programs[0].Workouts[0].Exercises[0].Sets = 7
	if state.Sessions[0].Exercises[0].Prescription != original {
		t.Fatal("program edits changed session history")
	}
	forged := state.Sessions[0]
	forged.Exercises = append([]domain.SessionExercise(nil), forged.Exercises...)
	forged.Exercises[0].Prescription.Sets = 7
	encoded, _ := json.Marshal(forged)
	if err := s.apply(&state, "saveSession", encoded); err == nil {
		t.Fatal("accepted forged session prescription")
	}
}
