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
	for _, template := range catalogue.Load().Templates {
		t.Run(template.ID, func(t *testing.T) {
			s := &TrainingService{Catalogue: catalogue.Load(), Now: func() time.Time { return time.Date(2026, 10, 9, 12, 0, 0, 0, time.UTC) }}
			state := emptySnapshot(dao.User{ID: "user-one", DisplayName: "User", Role: "user"}, s.now())
			state.Schedule = []domain.ScheduleEntry{{ID: "rest-day", Date: "2026-10-09"}}
			before, _ := json.Marshal(s.Catalogue.Templates)
			payload, _ := json.Marshal(map[string]string{"templateId": template.ID})
			for i := 0; i < 2; i++ {
				if err := s.apply(&state, "useTemplate", payload); err != nil {
					t.Fatal(err)
				}
			}
			first := state.Programs[0]
			encodedSecond, _ := json.Marshal(state.Programs[1])
			var second domain.Program
			_ = json.Unmarshal(encodedSecond, &second)
			if len(state.Programs) != 2 || first.ID == second.ID || first.ID == template.ID {
				t.Fatal("template copies share private identities")
			}
			if len(state.Schedule) != 1 || state.Schedule[0].WorkoutID != nil || len(state.Sessions) != 0 {
				t.Fatal("choosing a program changed the calendar/history")
			}
			if first.SourceName != template.SourceName || first.SourceReviewedAt != template.SourceReviewedAt || first.AdaptationNote != template.AdaptationNote {
				t.Fatal("copy lost source/adaptation details")
			}
			ids := map[string]bool{}
			for wi, original := range template.Workouts {
				a, b := first.Workouts[wi], second.Workouts[wi]
				if a.ID == original.ID || a.ID == b.ID {
					t.Fatal("workout copies share identities")
				}
				groups := map[string]string{}
				for pi, source := range original.Exercises {
					copy := a.Exercises[pi]
					if copy.ID == source.ID || copy.ID == b.Exercises[pi].ID || ids[copy.ID] {
						t.Fatal("prescription copies share identities")
					}
					ids[copy.ID] = true
					if source.Superset != "" {
						if copy.Superset == source.Superset || copy.Superset == b.Exercises[pi].Superset {
							t.Fatal("copies share superset IDs")
						}
						if previous := groups[source.Superset]; previous != "" && previous != copy.Superset {
							t.Fatal("copy broke superset pairing")
						}
						groups[source.Superset] = copy.Superset
					}
					copy.ID, copy.Superset = source.ID, source.Superset
					if copy != source {
						t.Fatal("copy changed a source prescription")
					}
				}
			}
			state.Programs[0].Workouts[0].Exercises[0].Sets = 7
			if !reflect.DeepEqual(state.Programs[1], second) {
				t.Fatal("editing one copy changed another")
			}
			after, _ := json.Marshal(s.Catalogue.Templates)
			if !reflect.DeepEqual(before, after) {
				t.Fatal("copy changed shared templates")
			}
		})
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
