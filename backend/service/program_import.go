package service

import (
	"errors"
	"training-app/backend/domain"
)

func (s *TrainingService) importProgram(data *domain.AppSnapshot, doc domain.ProgramDocument) error {
	known := map[string]bool{}
	for _, e := range s.Catalogue.Exercises {
		known[e.ID] = true
	}
	if err := domain.ValidateProgramDocument(doc, known); err != nil {
		return invalidTraining(err)
	}
	var existing *domain.Program
	for i := range data.Programs {
		if data.Programs[i].Details != nil && data.Programs[i].Details.Key == doc.Key {
			existing = &data.Programs[i]
			break
		}
	}
	if existing != nil {
		if domain.SameProgramDocument(domain.DocumentFromProgram(*existing), doc) {
			data.ActiveProgramID = existing.ID
			return nil
		}
		if doc.Version <= existing.Details.Version {
			return &TrainingError{Status: 409, Code: "program_version_conflict", Message: "increase the document version before updating this program"}
		}
		for _, w := range existing.Workouts {
			retained := false
			for _, next := range doc.Workouts {
				if next.Key == w.Key {
					retained = true
					break
				}
			}
			if retained {
				continue
			}
			for _, entry := range data.Schedule {
				if entry.WorkoutID != nil && *entry.WorkoutID == w.ID {
					return invalidTraining(errors.New("keep the keys of assigned workouts; remove their calendar assignments before removing a workout"))
				}
			}
			for _, session := range data.Sessions {
				if session.FinishedAt == nil && session.WorkoutID == w.ID {
					return invalidTraining(errors.New("finish the active session before removing its workout"))
				}
			}
		}
	}
	p := domain.ProgramFromDocument(doc, s.Catalogue.Exercises, s.Catalogue.Muscles, newRecordID, existing)
	data.Programs = upsert(data.Programs, p, func(p domain.Program) string { return p.ID })
	data.ActiveProgramID = p.ID
	return nil
}
