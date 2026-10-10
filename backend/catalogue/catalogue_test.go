package catalogue

import (
	"strings"
	"testing"
	"training-app/backend/domain"
)

func TestStarterCatalogueIsValid(t *testing.T) {
	c := Load()
	knownExercises, knownMuscles := map[string]bool{}, map[string]bool{}
	for _, e := range c.Exercises {
		if knownExercises[e.ID] || len(e.Instructions) == 0 || e.Image == "" {
			t.Fatalf("duplicate or incomplete exercise: %s", e.ID)
		}
		knownExercises[e.ID] = true
	}
	for _, m := range c.Muscles {
		knownMuscles[m.ID] = true
	}
	ids := map[string]bool{}
	for _, template := range c.Templates {
		t.Run(template.ID, func(t *testing.T) {
			if ids[template.ID] || template.SourceName == "" || template.SourceReviewedAt == "" || !strings.HasPrefix(template.Source, "https://") {
				t.Fatal("template is duplicate or missing source provenance")
			}
			ids[template.ID] = true
			if template.DaysPerWeek < 1 || template.DaysPerWeek > 7 || template.Equipment == "" {
				t.Fatal("missing frequency or equipment information")
			}
			if err := domain.ValidateProgram(template.Program, knownExercises, knownMuscles); err != nil {
				t.Fatal(err)
			}
			for _, w := range template.Workouts {
				if len(w.Exercises) == 0 {
					t.Fatal("empty starter workout")
				}
			}
		})
	}
	for _, id := range []string{"upper-lower-4", "beginner-3", "phul-4", "ppl-6", "barbell-5x5-3", "glute-focus-3", "dumbbell-full-body-3"} {
		if !ids[id] {
			t.Errorf("missing starter program %s", id)
		}
	}
}

func TestSourceSensitivePrescriptions(t *testing.T) {
	c := Load()
	templates := map[string]domain.ProgramTemplate{}
	exercises := map[string]domain.Exercise{}
	for _, template := range c.Templates {
		templates[template.ID] = template
	}
	for _, e := range c.Exercises {
		exercises[e.ID] = e
	}
	t.Run("5x5 deadlift has one working set and no AMRAP", func(t *testing.T) {
		for _, w := range templates["barbell-5x5-3"].Workouts {
			for _, p := range w.Exercises {
				sets := 5
				if p.ExerciseID == "deadlift" {
					sets = 1
				}
				if p.Sets != sets || p.RepsMin != 5 || p.RepsMax != 5 || p.AMRAPLast || p.Seconds {
					t.Fatalf("incorrect 5x5 prescription: %+v", p)
				}
			}
		}
	})
	t.Run("PPL alternates heavy movements and retains two supersets", func(t *testing.T) {
		ws := templates["ppl-6"].Workouts
		if len(ws) != 6 {
			t.Fatal("PPL needs both rotations")
		}
		for i, id := range []string{"deadlift", "bench-press", "squat", "barbell-row", "overhead-press", "squat"} {
			p := ws[i].Exercises[0]
			if p.ExerciseID != id || !p.AMRAPLast {
				t.Fatalf("lost heavy rotation/AMRAP at %d", i)
			}
		}
		for _, i := range []int{1, 4} {
			groups := map[string][]domain.Prescription{}
			for _, p := range ws[i].Exercises {
				if p.Superset != "" {
					groups[p.Superset] = append(groups[p.Superset], p)
				}
			}
			if len(groups) != 2 {
				t.Fatal("push session needs two independent superset pairs")
			}
			for _, pair := range groups {
				if len(pair) != 2 || pair[0].Sets != 3 || pair[1].Sets != 3 || pair[1].ExerciseID != "dumbbell-lateral-raise" || pair[0].ID == pair[1].ID {
					t.Fatalf("invalid superset pair: %+v", pair)
				}
			}
		}
	})
	t.Run("glute bridge remains a timed bodyweight hold", func(t *testing.T) {
		p := templates["glute-focus-3"].Workouts[2].Exercises[0]
		if p.ExerciseID != "glute-bridge" || !p.Seconds || p.RepsMin != 15 || p.RepsMax != 30 || exercises[p.ExerciseID].Weighted {
			t.Fatalf("lost bridge hold semantics: %+v", p)
		}
	})
	t.Run("dumbbell plan does not require a barbell or machines", func(t *testing.T) {
		for _, w := range templates["dumbbell-full-body-3"].Workouts {
			for _, p := range w.Exercises {
				if !strings.HasPrefix(exercises[p.ExerciseID].Equipment, "Dumbbells") {
					t.Fatal("unexpected equipment", p.ExerciseID)
				}
			}
		}
	})
	t.Run("PHUL keeps power and hypertrophy prescriptions distinct", func(t *testing.T) {
		ws := templates["phul-4"].Workouts
		if len(ws) != 4 || ws[0].Exercises[0].RepsMin != 3 || ws[0].Exercises[0].RepsMax != 5 || ws[2].Exercises[0].RepsMin != 8 || ws[2].Exercises[0].RepsMax != 12 {
			t.Fatal("PHUL lost the power/hypertrophy split")
		}
		if ws[0].Exercises[4].Sets != 2 || ws[1].Exercises[4].Sets != 4 || !ws[3].Exercises[1].PerSide {
			t.Fatal("PHUL lost variable-set defaults or unilateral logging")
		}
	})
}

func TestProgramProvenanceIsOptionalButValidated(t *testing.T) {
	c := Load()
	knownExercises, knownMuscles := map[string]bool{}, map[string]bool{}
	for _, e := range c.Exercises {
		knownExercises[e.ID] = true
	}
	for _, m := range c.Muscles {
		knownMuscles[m.ID] = true
	}
	p := c.Templates[0].Program
	p.SourceName, p.SourceReviewedAt, p.AdaptationNote = "", "", ""
	if err := domain.ValidateProgram(p, knownExercises, knownMuscles); err != nil {
		t.Fatal("legacy program rejected:", err)
	}
	for _, mutate := range []func(*domain.Program){
		func(p *domain.Program) { p.SourceName = strings.Repeat("x", 151) },
		func(p *domain.Program) { p.SourceReviewedAt = "2026-02-30" },
		func(p *domain.Program) { p.AdaptationNote = strings.Repeat("x", 2001) },
	} {
		invalid := p
		mutate(&invalid)
		if err := domain.ValidateProgram(invalid, knownExercises, knownMuscles); err == nil {
			t.Fatal("accepted invalid provenance")
		}
	}
}
