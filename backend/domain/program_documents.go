package domain

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"reflect"
	"regexp"
	"strings"
)

const MaxProgramDocumentBytes = 128 * 1024

const ProgramFormat = "bodybuilder.program.v1"

type ProgramEvidence struct {
	Title string `json:"title"`
	URL   string `json:"url"`
}
type ProgramProgression struct {
	Method       string `json:"method"`
	Instructions string `json:"instructions"`
	Stall        string `json:"stall"`
}
type ProgramNutrition struct {
	ProteinPerKG float64 `json:"proteinPerKg"`
	FatPercent   float64 `json:"fatPercent"`
	Instructions string  `json:"instructions"`
}
type ProgramMetadata struct {
	Key            string             `json:"key"`
	Version        int                `json:"version"`
	Name           string             `json:"name"`
	Description    string             `json:"description"`
	Experience     []string           `json:"experience"`
	Goals          []string           `json:"goals"`
	Equipment      string             `json:"equipment"`
	DaysPerWeek    int                `json:"daysPerWeek"`
	SessionMinutes int                `json:"sessionMinutes"`
	Focus          string             `json:"focus"`
	Purpose        string             `json:"purpose"`
	ReviewedAt     string             `json:"reviewedAt"`
	Notes          string             `json:"notes"`
	Progression    ProgramProgression `json:"progression"`
	Nutrition      ProgramNutrition   `json:"nutrition"`
	Evidence       []ProgramEvidence  `json:"evidence"`
}
type DocumentPrescription struct {
	Key         string `json:"key"`
	ExerciseID  string `json:"exerciseId"`
	Sets        int    `json:"sets"`
	RepsMin     int    `json:"repsMin"`
	RepsMax     int    `json:"repsMax"`
	RestSeconds int    `json:"restSeconds"`
	PerSide     bool   `json:"perSide,omitempty"`
	Seconds     bool   `json:"seconds,omitempty"`
	AMRAPLast   bool   `json:"amrapLast,omitempty"`
	Superset    string `json:"superset,omitempty"`
}
type DocumentWorkout struct {
	Key       string                 `json:"key"`
	Name      string                 `json:"name"`
	Warmup    []string               `json:"warmup"`
	Exercises []DocumentPrescription `json:"exercises"`
}
type ProgramDocument struct {
	ProgramMetadata
	SchemaVersion string            `json:"schemaVersion"`
	Workouts      []DocumentWorkout `json:"workouts"`
}

// A document has no nullable fields. Require zero-valued fields such as restSeconds
// explicitly, rather than interpreting omitted or null JSON as a prescription.
func (p *ProgramDocument) UnmarshalJSON(raw []byte) error {
	if len(raw) > MaxProgramDocumentBytes {
		return errors.New("program document must be under 128 KiB")
	}
	type plain ProgramDocument
	var value plain
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&value); err != nil {
		return err
	}
	var shape map[string]any
	if err := json.Unmarshal(raw, &shape); err != nil {
		return err
	}
	if err := noNullProgramFields(shape); err != nil {
		return err
	}
	if err := requiredProgramFields(shape, "program", "schemaVersion", "key", "version", "name", "description", "experience", "goals", "equipment", "daysPerWeek", "sessionMinutes", "focus", "purpose", "reviewedAt", "notes", "progression", "nutrition", "evidence", "workouts"); err != nil {
		return err
	}
	for _, field := range []struct {
		key      string
		required []string
	}{{"progression", []string{"method", "instructions", "stall"}}, {"nutrition", []string{"proteinPerKg", "fatPercent", "instructions"}}} {
		if err := requiredProgramFields(shape[field.key], field.key, field.required...); err != nil {
			return err
		}
	}
	if items, ok := shape["evidence"].([]any); ok {
		for _, item := range items {
			if err := requiredProgramFields(item, "evidence", "title", "url"); err != nil {
				return err
			}
		}
	}
	if items, ok := shape["workouts"].([]any); ok {
		for _, item := range items {
			if err := requiredProgramFields(item, "workout", "key", "name", "warmup", "exercises"); err != nil {
				return err
			}
			if prescriptions, ok := item.(map[string]any)["exercises"].([]any); ok {
				for _, rx := range prescriptions {
					if err := requiredProgramFields(rx, "exercise", "key", "exerciseId", "sets", "repsMin", "repsMax", "restSeconds"); err != nil {
						return err
					}
					if group, exists := rx.(map[string]any)["superset"]; exists {
						if text, ok := group.(string); !ok || ValidateProgramKey(text) != nil {
							return errors.New("use a valid superset key or omit superset")
						}
					}
				}
			}
		}
	}
	*p = ProgramDocument(value)
	return nil
}
func requiredProgramFields(value any, label string, fields ...string) error {
	object, ok := value.(map[string]any)
	if !ok {
		return fmt.Errorf("%s must be an object", label)
	}
	for _, field := range fields {
		if _, exists := object[field]; !exists {
			return fmt.Errorf("%s is missing %s", label, field)
		}
	}
	return nil
}
func noNullProgramFields(value any) error {
	if value == nil {
		return errors.New("program fields cannot be null; omit optional fields instead")
	}
	switch item := value.(type) {
	case map[string]any:
		for _, v := range item {
			if err := noNullProgramFields(v); err != nil {
				return err
			}
		}
	case []any:
		for _, v := range item {
			if err := noNullProgramFields(v); err != nil {
				return err
			}
		}
	}
	return nil
}

var programKey = regexp.MustCompile(`^[a-z][a-z0-9-]{1,79}$`)

func ValidateProgramKey(key string) error {
	if !programKey.MatchString(key) {
		return errors.New("program, workout and exercise keys must be 2–80 lowercase letters, digits or hyphens, starting with a letter")
	}
	return nil
}
func uniqueChoices(values []string, name string, choices ...string) error {
	if len(values) == 0 || len(values) > len(choices) {
		return fmt.Errorf("choose supported %s", name)
	}
	seen := map[string]bool{}
	for _, v := range values {
		if seen[v] {
			return fmt.Errorf("%s must be unique", name)
		}
		seen[v] = true
		if err := Choice(v, name, choices...); err != nil {
			return err
		}
	}
	return nil
}
func programText(value, label string, max int) error {
	if err := Text(value, label, max, false); err != nil {
		return err
	}
	for _, r := range value {
		if r < 32 && r != '\n' && r != '\r' && r != '\t' {
			return fmt.Errorf("%s contains an unsupported control character", label)
		}
	}
	return nil
}
func ValidateProgramMetadata(p ProgramMetadata) error {
	if err := ValidateProgramKey(p.Key); err != nil {
		return err
	}
	if p.Version < 1 || p.Version > 1_000_000 || p.DaysPerWeek < 1 || p.DaysPerWeek > 7 || p.SessionMinutes < 15 || p.SessionMinutes > 180 {
		return errors.New("check program version, training days and session minutes")
	}
	for _, field := range []struct {
		value, name string
		max         int
	}{{p.Name, "program name", 150}, {p.Description, "description", 2000}, {p.Notes, "plan notes", 2000}, {p.Progression.Instructions, "progression instructions", 3000}, {p.Progression.Stall, "stall guidance", 3000}, {p.Nutrition.Instructions, "nutrition instructions", 3000}} {
		if err := programText(field.value, field.name, field.max); err != nil {
			return err
		}
	}
	if err := uniqueChoices(p.Experience, "experience", "beginner", "intermediate", "advanced"); err != nil {
		return err
	}
	if err := uniqueChoices(p.Goals, "goals", "build-muscle", "maintain", "lose-fat"); err != nil {
		return err
	}
	for _, field := range []struct {
		value, name string
		choices     []string
	}{{p.Equipment, "equipment", []string{"full-gym", "dumbbells"}}, {p.Focus, "focus", []string{"balanced", "glutes"}}, {p.Purpose, "purpose", []string{"hypertrophy", "strength", "general"}}, {p.Progression.Method, "progression method", []string{"double-progression", "linear-progression", "manual"}}} {
		if err := Choice(field.value, field.name, field.choices...); err != nil {
			return err
		}
	}
	if err := Date(p.ReviewedAt); err != nil {
		return err
	}
	if err := Number(p.Nutrition.ProteinPerKG, "protein per kg", 1, 2.5); err != nil {
		return err
	}
	if err := Number(p.Nutrition.FatPercent, "fat percentage", 20, 35); err != nil {
		return err
	}
	if len(p.Evidence) < 1 || len(p.Evidence) > 10 {
		return errors.New("add 1–10 evidence links")
	}
	for _, e := range p.Evidence {
		if err := programText(e.Title, "evidence title", 200); err != nil {
			return err
		}
		if err := programText(e.URL, "evidence URL", 2000); err != nil {
			return err
		}
		u, err := url.Parse(e.URL)
		if err != nil || u.Scheme != "https" || u.Hostname() == "" || u.User != nil {
			return errors.New("evidence links must be HTTPS URLs")
		}
	}
	return nil
}
func ValidateProgramDocument(p ProgramDocument, known map[string]bool) error {
	encoded, err := json.Marshal(p)
	if err != nil || len(encoded) > MaxProgramDocumentBytes {
		return errors.New("program document must be under 128 KiB")
	}
	if p.SchemaVersion != ProgramFormat {
		return errors.New("unsupported program schemaVersion; use bodybuilder.program.v1")
	}
	if err := ValidateProgramMetadata(p.ProgramMetadata); err != nil {
		return err
	}
	if len(p.Workouts) != p.DaysPerWeek {
		return errors.New("provide one distinct workout for each training day")
	}
	keys := map[string]bool{}
	for _, w := range p.Workouts {
		if err := ValidateProgramKey(w.Key); err != nil {
			return err
		}
		if keys[w.Key] {
			return errors.New("workout keys must be unique")
		}
		keys[w.Key] = true
		if err := programText(w.Name, "workout name", 150); err != nil {
			return err
		}
		if len(w.Warmup) < 1 || len(w.Warmup) > 10 || len(w.Exercises) < 1 || len(w.Exercises) > 20 {
			return errors.New("each workout needs 1–10 warmups and 1–20 exercises")
		}
		for _, v := range w.Warmup {
			if err := programText(v, "warmup instruction", 1000); err != nil {
				return err
			}
		}
		rxkeys := map[string]bool{}
		for _, r := range w.Exercises {
			if err := ValidateProgramKey(r.Key); err != nil {
				return err
			}
			if rxkeys[r.Key] {
				return errors.New("exercise keys must be unique within each workout")
			}
			rxkeys[r.Key] = true
			if !known[r.ExerciseID] {
				return fmt.Errorf("unknown exercise ID: %s; use the exercise reference", r.ExerciseID)
			}
			if r.Sets < 1 || r.Sets > 10 || r.RepsMin < 1 || r.RepsMax > 600 || r.RepsMax < r.RepsMin || r.RestSeconds < 0 || r.RestSeconds > 600 {
				return errors.New("check sets, rep/seconds range and rest seconds")
			}
			if r.Seconds && r.AMRAPLast {
				return errors.New("timed holds cannot have an AMRAP set")
			}
			if r.Superset != "" {
				if err := ValidateProgramKey(r.Superset); err != nil {
					return err
				}
			}
		}
	}
	return nil
}
func ProgramFromDocument(doc ProgramDocument, exercises []Exercise, muscles []Muscle, makeID func(string) string, existing *Program) Program {
	meta := doc.ProgramMetadata
	p := Program{ID: makeID("program"), Name: doc.Name, Level: "", Goal: doc.Goals[0], Source: doc.Evidence[0].URL, SourceName: "Program evidence", SourceReviewedAt: doc.ReviewedAt, AdaptationNote: doc.Notes, Details: &meta, Workouts: []Workout{}}
	for i, v := range doc.Experience {
		if i > 0 {
			p.Level += " / "
		}
		p.Level += strings.ToUpper(v[:1]) + v[1:]
	}
	if existing != nil {
		p.ID = existing.ID
	}
	known := map[string]Exercise{}
	for _, e := range exercises {
		known[e.ID] = e
	}
	for _, w := range doc.Workouts {
		item := Workout{ID: makeID("workout"), Key: w.Key, Name: w.Name, Warmup: w.Warmup, Muscles: []Muscle{}, Exercises: []Prescription{}}
		var previous *Workout
		if existing != nil {
			for i := range existing.Workouts {
				if existing.Workouts[i].Key == w.Key {
					previous = &existing.Workouts[i]
					item.ID = previous.ID
					break
				}
			}
		}
		trained := map[string]bool{}
		for _, r := range w.Exercises {
			rx := Prescription{ID: makeID("prescription"), Key: r.Key, ExerciseID: r.ExerciseID, Sets: r.Sets, RepsMin: r.RepsMin, RepsMax: r.RepsMax, RestSeconds: r.RestSeconds, PerSide: r.PerSide, Seconds: r.Seconds, AMRAPLast: r.AMRAPLast, Superset: r.Superset}
			if previous != nil {
				for _, old := range previous.Exercises {
					if old.Key == r.Key {
						rx.ID = old.ID
						break
					}
				}
			}
			item.Exercises = append(item.Exercises, rx)
			for _, m := range known[r.ExerciseID].Muscles {
				trained[m] = true
			}
		}
		for _, m := range muscles {
			if trained[m.ID] {
				item.Muscles = append(item.Muscles, m)
			}
		}
		p.Workouts = append(p.Workouts, item)
	}
	return p
}
func DocumentFromProgram(p Program) ProgramDocument {
	if p.Details == nil {
		return ProgramDocument{}
	}
	meta := *p.Details
	meta.Name = p.Name
	meta.DaysPerWeek = len(p.Workouts)
	doc := ProgramDocument{ProgramMetadata: meta, SchemaVersion: ProgramFormat, Workouts: []DocumentWorkout{}}
	for _, w := range p.Workouts {
		wk := w.Key
		if wk == "" {
			wk = w.ID
		}
		item := DocumentWorkout{Key: wk, Name: w.Name, Warmup: w.Warmup, Exercises: []DocumentPrescription{}}
		for _, r := range w.Exercises {
			rk := r.Key
			if rk == "" {
				rk = r.ID
			}
			item.Exercises = append(item.Exercises, DocumentPrescription{Key: rk, ExerciseID: r.ExerciseID, Sets: r.Sets, RepsMin: r.RepsMin, RepsMax: r.RepsMax, RestSeconds: r.RestSeconds, PerSide: r.PerSide, Seconds: r.Seconds, AMRAPLast: r.AMRAPLast, Superset: documentSuperset(r.Superset)})
		}
		doc.Workouts = append(doc.Workouts, item)
	}
	return doc
}
func documentSuperset(value string) string {
	if value == "" || programKey.MatchString(value) {
		return value
	}
	return "group-" + strings.ToLower(value)
}
func SameProgramDocument(a, b ProgramDocument) bool { return reflect.DeepEqual(a, b) }
func TemplateFromDocument(doc ProgramDocument, exercises []Exercise, muscles []Muscle, revision int64) ProgramTemplate {
	counter := 0
	p := ProgramFromDocument(doc, exercises, muscles, func(prefix string) string {
		value := fmt.Sprintf("%s-%s-%d", doc.Key, prefix, counter)
		counter++
		return value
	}, nil)
	p.ID = doc.Key
	return ProgramTemplate{Program: p, Description: doc.Description, DaysPerWeek: doc.DaysPerWeek, Equipment: map[string]string{"full-gym": "Full gym", "dumbbells": "Dumbbells and bench"}[doc.Equipment], Revision: revision}
}
