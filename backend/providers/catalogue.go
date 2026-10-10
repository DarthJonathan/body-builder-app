package providers

import (
	"crypto/sha256"
	_ "embed"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"sync"
	"unicode"

	"training-app/backend/domain"
)

const usdaArchiveURL = "https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_sr_legacy_food_csv_2018-04.zip"
const usdaArchiveSHA256 = "b80817294b8850530aaedf2e515c02593b1824f763a0ff356e5c2081643e6fd0"
const usdaCatalogueSHA256 = "8bd98ec521817eed325107db87f057fc2c6ecdd0da6a21cb1f94253c70b37ffb"
const usdaRecordCount = 7_793

//go:embed data/usda-sr-legacy-2018-04.json
var usdaCatalogue []byte

//go:embed data/usda-sr-legacy-2018-04.manifest.json
var usdaManifest []byte

var bundledFoodsOnce sync.Once
var bundledFoods []domain.Food
var bundledFoodsError error

// BundledFoods returns the reproducible, complete USDA SR Legacy catalogue.
// The copy keeps a caller from modifying the shared embedded reference data.
func BundledFoods() ([]domain.Food, error) {
	bundledFoodsOnce.Do(func() { bundledFoods, bundledFoodsError = loadBundledFoods() })
	if bundledFoodsError != nil {
		return nil, bundledFoodsError
	}
	return copyFoods(bundledFoods), nil
}

func loadBundledFoods() ([]domain.Food, error) {
	var manifest struct {
		SchemaVersion     int    `json:"schemaVersion"`
		ImporterVersion   string `json:"importerVersion"`
		Release           string `json:"release"`
		DownloadURL       string `json:"downloadURL"`
		License           string `json:"license"`
		ArchiveSHA256     string `json:"archiveSha256"`
		CatalogueSHA256   string `json:"catalogueSha256"`
		RecordCount       int    `json:"recordCount"`
		SourceRecordCount int    `json:"sourceRecordCount"`
		Serving           string `json:"serving"`
	}
	if err := json.Unmarshal(usdaManifest, &manifest); err != nil {
		return nil, errors.New("embedded USDA manifest could not be decoded")
	}
	digest := sha256.Sum256(usdaCatalogue)
	if manifest.SchemaVersion != 1 || manifest.ImporterVersion != "usda-sr-legacy-v1" || manifest.Release != "SR Legacy April 2018" || manifest.DownloadURL != usdaArchiveURL || manifest.License != "CC0-1.0" || manifest.ArchiveSHA256 != usdaArchiveSHA256 || manifest.CatalogueSHA256 != usdaCatalogueSHA256 || hex.EncodeToString(digest[:]) != usdaCatalogueSHA256 || manifest.RecordCount != usdaRecordCount || manifest.SourceRecordCount != usdaRecordCount || manifest.Serving != "100 g" {
		return nil, errors.New("embedded USDA catalogue provenance/checksum does not match the pinned release")
	}
	var foods []domain.Food
	if err := json.Unmarshal(usdaCatalogue, &foods); err != nil || len(foods) != usdaRecordCount {
		return nil, errors.New("embedded USDA catalogue is incomplete or could not be decoded")
	}
	seen := make(map[string]bool, len(foods))
	for _, food := range foods {
		fdcID := strings.TrimPrefix(food.ID, "usda:")
		if fdcID == food.ID || fdcID == "" || strings.IndexFunc(fdcID, func(character rune) bool { return character < '0' || character > '9' }) >= 0 || seen[food.ID] || !validText(food.Name, 200) || food.Serving != "100 g" || !validNutrients(food.Nutrients, 1_000, 100) || food.Source != usdaSource(fdcID) {
			return nil, errors.New("embedded USDA catalogue contains an invalid or unattributed record")
		}
		seen[food.ID] = true
	}
	return foods, nil
}

func usdaSource(fdcID string) string {
	return fmt.Sprintf("USDA FoodData Central · SR Legacy April 2018 · FDC %s · CC0-1.0 · %s", fdcID, usdaArchiveURL)
}

func foodWords(value string) []string {
	return strings.FieldsFunc(strings.ToLower(value), func(character rune) bool { return !unicode.IsLetter(character) && !unicode.IsNumber(character) })
}

// All query words must match name-word prefixes (e.g. banana -> bananas).
// Exact short ingredient names rank ahead of incidental matches in long meals.
// Descriptions and source nutrition are never changed or collapsed together.
func (service *Service) localFoods(query string) []domain.Food {
	words := foodWords(query)
	if len(words) == 0 {
		return []domain.Food{}
	}
	type match struct {
		food  domain.Food
		score int
	}
	matches := []match{}
	for _, food := range service.options.FallbackFoods {
		nameWords := foodWords(food.Name)
		score, matched := len(nameWords)*3, true
		for _, word := range words {
			best := -1
			for index, candidate := range nameWords {
				if !strings.HasPrefix(candidate, word) {
					continue
				}
				penalty := 4 + index*4
				if candidate == word {
					penalty = index * 4
				} else if candidate == word+"s" || candidate == word+"es" {
					penalty = 1 + index*4
				}
				if best == -1 || penalty < best {
					best = penalty
				}
			}
			if best == -1 {
				matched = false
				break
			}
			score += best
		}
		if matched {
			matches = append(matches, match{food: food, score: score})
		}
	}
	sort.SliceStable(matches, func(left, right int) bool {
		if matches[left].score != matches[right].score {
			return matches[left].score < matches[right].score
		}
		if matches[left].food.Name != matches[right].food.Name {
			return matches[left].food.Name < matches[right].food.Name
		}
		return matches[left].food.ID < matches[right].food.ID
	})
	if len(matches) > 20 {
		matches = matches[:20]
	}
	foods := make([]domain.Food, 0, len(matches))
	for _, match := range matches {
		foods = append(foods, match.food)
	}
	return foods
}
