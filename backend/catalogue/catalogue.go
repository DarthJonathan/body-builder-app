package catalogue

import (
	_ "embed"
	"encoding/json"
	"training-app/backend/domain"
)

//go:embed catalogue.json
var encoded []byte

type Catalogue struct {
	Exercises   []domain.Exercise        `json:"exercises"`
	Muscles     []domain.Muscle          `json:"muscles"`
	Templates   []domain.ProgramTemplate `json:"templates"`
	Foods       []domain.Food            `json:"foods"`
	GoalRules   domain.GoalRules         `json:"goalRules"`
	ExpertRules domain.ExpertRules       `json:"expertRules"`
	Programs    []domain.ProgramDocument `json:"programDocuments"`
	Readings    []json.RawMessage        `json:"readings"`
}

func Load() Catalogue {
	var data Catalogue
	if err := json.Unmarshal(encoded, &data); err != nil {
		panic("invalid embedded training catalogue: " + err.Error())
	}
	compiled := make([]domain.ProgramTemplate, 0, len(data.Programs)+len(data.Templates))
	for _, doc := range data.Programs {
		compiled = append(compiled, domain.TemplateFromDocument(doc, data.Exercises, data.Muscles, 0))
	}
	data.Templates = append(compiled, data.Templates...)
	return data
}
