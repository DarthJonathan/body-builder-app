package domain_test

import (
	"encoding/json"
	"strings"
	"testing"
	"training-app/backend/catalogue"
	"training-app/backend/domain"
)

func TestProgramDocumentsAndStableConversion(t *testing.T) {
	c := catalogue.Load()
	known := map[string]bool{}
	for _, e := range c.Exercises {
		known[e.ID] = true
	}
	if len(c.Programs) != 10 || len(c.Templates) != 17 {
		t.Fatal("expected ten authored plans plus seven original templates")
	}
	for _, doc := range c.Programs {
		t.Run(doc.Key, func(t *testing.T) {
			if err := domain.ValidateProgramDocument(doc, known); err != nil {
				t.Fatal(err)
			}
			count := 0
			makeID := func(prefix string) string { count++; return prefix + strings.Repeat("x", count) }
			p := domain.ProgramFromDocument(doc, c.Exercises, c.Muscles, makeID, nil)
			if !domain.SameProgramDocument(doc, domain.DocumentFromProgram(p)) {
				t.Fatal("lost document details during conversion")
			}
			next := doc
			next.Version++
			next.Name += " revised"
			updated := domain.ProgramFromDocument(next, c.Exercises, c.Muscles, makeID, &p)
			if updated.ID != p.ID || updated.Workouts[0].ID != p.Workouts[0].ID || updated.Workouts[0].Exercises[0].ID != p.Workouts[0].Exercises[0].ID {
				t.Fatal("upsert replaced stable record IDs")
			}
			// This is a checked-in cross-language ID convention, also verified by TS.
			template := domain.TemplateFromDocument(doc, c.Exercises, c.Muscles, 0)
			if template.Workouts[0].ID != doc.Key+"-workout-1" {
				t.Fatal("template identity differs from the frontend convention")
			}
		})
	}
}

func TestProgramJSONStrictness(t *testing.T) {
	c := catalogue.Load()
	encoded, _ := json.Marshal(c.Programs[0])
	known := map[string]bool{}
	for _, e := range c.Exercises {
		known[e.ID] = true
	}
	cases := []struct {
		name   string
		change func(map[string]any)
	}{
		{"unsupported format", func(d map[string]any) { d["schemaVersion"] = "future" }},
		{"fractional version", func(d map[string]any) { d["version"] = 1.5 }},
		{"control character", func(d map[string]any) { d["name"] = "Plan\x00" }},
		{"unknown field", func(d map[string]any) { d["unknown"] = true }},
		{"invalid date", func(d map[string]any) { d["reviewedAt"] = "2026-02-30" }},
		{"unsafe citation", func(d map[string]any) { d["evidence"].([]any)[0].(map[string]any)["url"] = "javascript:alert(1)" }},
		{"duplicate workout keys", func(d map[string]any) {
			w := d["workouts"].([]any)
			w[1].(map[string]any)["key"] = w[0].(map[string]any)["key"]
		}},
	}
	for _, item := range []struct {
		name   string
		field  string
		value  any
		remove bool
	}{{"unknown exercise", "exerciseId", "missing", false}, {"missing rest", "restSeconds", nil, true}, {"null rest", "restSeconds", nil, false}, {"null bool", "perSide", nil, false}, {"empty superset", "superset", "", false}, {"extra prescription field", "extra", true, false}, {"invalid sets", "sets", 0, false}} {
		item := item
		cases = append(cases, struct {
			name   string
			change func(map[string]any)
		}{item.name, func(d map[string]any) {
			rx := d["workouts"].([]any)[0].(map[string]any)["exercises"].([]any)[0].(map[string]any)
			if item.remove {
				delete(rx, item.field)
			} else {
				rx[item.field] = item.value
			}
		}})
	}
	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			var obj map[string]any
			_ = json.Unmarshal(encoded, &obj)
			test.change(obj)
			raw, _ := json.Marshal(obj)
			var doc domain.ProgramDocument
			err := json.Unmarshal(raw, &doc)
			if err == nil {
				err = domain.ValidateProgramDocument(doc, known)
			}
			if err == nil {
				t.Fatal("accepted invalid input")
			}
		})
	}
	var doc domain.ProgramDocument
	if err := json.Unmarshal([]byte(strings.Repeat(" ", domain.MaxProgramDocumentBytes+1)), &doc); err == nil {
		t.Fatal("accepted oversized document")
	}
}
