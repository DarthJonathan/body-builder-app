package catalogue

import (
	_ "embed"
	"encoding/json"
	"training-app/backend/domain"
)

//go:embed catalogue.json
var encoded []byte

type Catalogue struct {
	Exercises []domain.Exercise        `json:"exercises"`
	Muscles   []domain.Muscle          `json:"muscles"`
	Templates []domain.ProgramTemplate `json:"templates"`
	Foods     []domain.Food            `json:"foods"`
	Readings  []json.RawMessage        `json:"readings"`
}

func Load() Catalogue {
	var data Catalogue
	if err := json.Unmarshal(encoded, &data); err != nil {
		panic("invalid embedded training catalogue: " + err.Error())
	}
	return data
}
