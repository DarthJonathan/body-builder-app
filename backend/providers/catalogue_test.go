package providers

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"training-app/backend/domain"
)

func TestBundledUSDACatalogueHasPinnedCompleteSourceValues(t *testing.T) {
	foods, err := BundledFoods()
	if err != nil || len(foods) != 7793 {
		t.Fatalf("pinned complete catalogue unavailable: %d, %v", len(foods), err)
	}
	digest := sha256.Sum256(usdaCatalogue)
	if hex.EncodeToString(digest[:]) != "8bd98ec521817eed325107db87f057fc2c6ecdd0da6a21cb1f94253c70b37ffb" {
		t.Fatal("catalogue changed without a reproducible source update")
	}
	var raw []map[string]json.RawMessage
	if err := json.Unmarshal(usdaCatalogue, &raw); err != nil || len(raw) != len(foods) {
		t.Fatalf("invalid source records: %v", err)
	}
	byID := make(map[string]domain.Food, len(foods))
	for index, food := range foods {
		if _, duplicate := byID[food.ID]; duplicate {
			t.Fatalf("duplicated FDC ID: %s", food.ID)
		}
		byID[food.ID] = food
		fdcID := strings.TrimPrefix(food.ID, "usda:")
		if identifier, err := strconv.Atoi(fdcID); err != nil || identifier <= 0 || fdcID == food.ID {
			t.Fatalf("food lost its actual FDC ID: %#v", food)
		}
		if food.Serving != "100 g" || food.Source != "USDA FoodData Central · SR Legacy April 2018 · FDC "+fdcID+" · CC0-1.0 · https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_sr_legacy_food_csv_2018-04.zip" {
			t.Fatalf("incorrect units or source: %#v", food)
		}
		for _, field := range []string{"calories", "protein", "carbs", "fat"} {
			if len(raw[index][field]) == 0 || string(raw[index][field]) == "null" {
				t.Fatalf("missing %s became an invented numeric zero in %s", field, food.ID)
			}
		}
		if food.Calories < 0 || food.Calories > 1000 || food.Protein < 0 || food.Protein > 100 || food.Carbs < 0 || food.Carbs > 100 || food.Fat < 0 || food.Fat > 100 {
			t.Fatalf("invalid per100g source nutrition: %#v", food)
		}
	}
	banana := byID["usda:173944"]
	if banana.Name != "Bananas, raw" || banana.Calories != 89 || banana.Protein != 1.09 || banana.Carbs != 22.84 || banana.Fat != 0.33 {
		t.Fatalf("banana source values were changed or derived from macros: %#v", banana)
	}
	water := byID["usda:174158"]
	if water.Name != "Water, bottled, generic" || water.Calories != 0 || water.Protein != 0 || water.Carbs != 0 || water.Fat != 0 {
		t.Fatalf("explicit source zeros were lost: %#v", water)
	}
	oliveOil := byID["usda:171413"]
	if oliveOil.Name != "Oil, olive, salad or cooking" || oliveOil.Calories != 884 || oliveOil.Fat != 100 || oliveOil.Protein != 0 || oliveOil.Carbs != 0 {
		t.Fatalf("source energy was recalculated or macros were fabricated: %#v", oliveOil)
	}
	foods[0].Name, foods[0].Source = "caller modification", "caller modification"
	copy, err := BundledFoods()
	if err != nil || copy[0].Name == "caller modification" || copy[0].Source == "caller modification" {
		t.Fatal("one caller mutated the shared embedded catalogue")
	}
}

func TestUSDAManifestDocumentsUnitsLicenseAndArchive(t *testing.T) {
	var manifest struct {
		Release           string         `json:"release"`
		ArchiveSHA256     string         `json:"archiveSha256"`
		ArchiveBytes      int            `json:"archiveBytes"`
		RecordCount       int            `json:"recordCount"`
		SourceRecordCount int            `json:"sourceRecordCount"`
		SkippedRecords    map[string]int `json:"skippedRecords"`
		License           string         `json:"license"`
		Nutrients         []struct {
			Field string `json:"field"`
			ID    int    `json:"id"`
			Unit  string `json:"unit"`
		} `json:"nutrients"`
	}
	if err := json.Unmarshal(usdaManifest, &manifest); err != nil {
		t.Fatal(err)
	}
	if manifest.Release != "SR Legacy April 2018" || manifest.ArchiveBytes != 6074592 || manifest.ArchiveSHA256 != "b80817294b8850530aaedf2e515c02593b1824f763a0ff356e5c2081643e6fd0" || manifest.License != "CC0-1.0" || manifest.RecordCount != 7793 || manifest.SourceRecordCount != 7793 || len(manifest.SkippedRecords) != 0 {
		t.Fatalf("source provenance changed: %#v", manifest)
	}
	expected := map[string]struct {
		id   int
		unit string
	}{"calories": {1008, "KCAL"}, "protein": {1003, "G"}, "carbs": {1005, "G"}, "fat": {1004, "G"}}
	if len(manifest.Nutrients) != len(expected) {
		t.Fatal("four source nutrient definitions are required")
	}
	for _, nutrient := range manifest.Nutrients {
		definition, found := expected[nutrient.Field]
		if !found || definition.id != nutrient.ID || definition.unit != nutrient.Unit {
			t.Fatalf("unit conversion or source ID changed: %#v", nutrient)
		}
		delete(expected, nutrient.Field)
	}
	if len(expected) != 0 {
		t.Fatal("manifest duplicated a nutrient rather than documenting all four")
	}
}

func TestLocalUSDASearchCoversIngredientsWithoutAnyUpstreamOrAIUsage(t *testing.T) {
	foods, err := BundledFoods()
	if err != nil {
		t.Fatal(err)
	}
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		calls.Add(1)
		writer.WriteHeader(http.StatusBadGateway)
	}))
	defer server.Close()
	store := newMemoryStore()
	service := newTestService(t, store, server.URL, func(options *Options) { options.FallbackFoods = foods })
	enableProvider(t, service, "openai", 1)
	// Constructor and search results must not retain mutable caller-owned data.
	foods[0].Name = "external mutation"
	for _, query := range []string{"banana", "rice white cooked", "chicken breast", "oat", "milk", "egg", "tofu", "lentil", "bread", "broccoli", "apple", "potato"} {
		results, err := service.SearchFoods(context.Background(), query)
		if err != nil || len(results) == 0 || len(results) > 20 {
			t.Fatalf("common ingredient unavailable offline (%s): %#v, %v", query, results, err)
		}
		for _, result := range results {
			if !strings.HasPrefix(result.ID, "usda:") || !strings.Contains(result.Source, "CC0-1.0") || result.Serving != "100 g" {
				t.Fatalf("local search returned unattributed or changed data: %#v", result)
			}
		}
	}
	results, err := service.SearchFoods(context.Background(), "  BANANA  ")
	if err != nil || results[0].ID != "usda:173944" || results[0].Calories != 89 {
		t.Fatalf("simple raw ingredient did not rank first: %#v, %v", results, err)
	}
	results[0].Name = "changed search result"
	results, err = service.SearchFoods(context.Background(), "banana")
	if err != nil || results[0].Name != "Bananas, raw" {
		t.Fatal("local search result mutated later searches")
	}
	if calls.Load() != 0 || store.requestCount() != 0 || len(service.food.requests) != 0 {
		t.Fatal("local USDA searches contacted an upstream or consumed a paid/search quota")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, err = service.SearchFoods(ctx, "banana")
	requireCode(t, err, "food_provider_timeout", 504)
}

func TestLocalUSDASearchKeepsRawAndCookedNutritionDistinct(t *testing.T) {
	foods, err := BundledFoods()
	if err != nil {
		t.Fatal(err)
	}
	service := newTestService(t, newMemoryStore(), "http://example.test/must-not-be-contacted", func(options *Options) { options.FallbackFoods = foods })
	for _, test := range []struct {
		query, id string
		calories  float64
		carbs     float64
	}{
		{"rice white long grain regular raw enriched", "usda:168877", 365, 79.95},
		{"rice white long grain regular enriched cooked", "usda:168878", 130, 28.17},
	} {
		results, err := service.SearchFoods(context.Background(), test.query)
		if err != nil || len(results) == 0 || results[0].ID != test.id || results[0].Calories != test.calories || results[0].Carbs != test.carbs {
			t.Fatalf("preparation state collapsed (%s): %#v, %v", test.query, results, err)
		}
	}
	// Word matching must not confuse the middle of another word with an ingredient.
	for _, result := range service.localFoods("rice") {
		if strings.Contains(strings.ToLower(result.Name), "licorice") && !strings.Contains(strings.ToLower(result.Name), " rice") {
			t.Fatalf("substring match returned licorice for rice: %#v", result)
		}
	}
}

func TestLocalUSDASearchRemainsAvailableAfterOnlineRateLimitAndOutage(t *testing.T) {
	foods, err := BundledFoods()
	if err != nil {
		t.Fatal(err)
	}
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		calls.Add(1)
		if request.Method != http.MethodGet || request.Header.Get("Authorization") != "" || request.Header.Get("x-api-key") != "" {
			t.Error("food lookup used paid-provider protocol or credentials")
		}
		writer.WriteHeader(http.StatusBadGateway)
	}))
	defer server.Close()
	store := newMemoryStore()
	clock := time.Date(2026, 10, 9, 0, 0, 0, 0, time.UTC)
	service := newTestService(t, store, server.URL, func(options *Options) {
		options.FallbackFoods = foods
		options.Now = func() time.Time { return clock }
	})
	for index := 0; index < 10; index++ {
		results, err := service.SearchFoods(context.Background(), "zzunmatchedbrand"+strconv.Itoa(index))
		requireCode(t, err, "food_provider_unavailable", 503)
		if len(results) != 0 {
			t.Fatal("an unmatched query silently substituted unrelated local food")
		}
	}
	_, err = service.SearchFoods(context.Background(), "zzunmatchedbrand11")
	requireCode(t, err, "food_rate_limited", 429)
	results, err := service.SearchFoods(context.Background(), "banana")
	if err != nil || len(results) == 0 || results[0].ID != "usda:173944" || results[0].Calories != 89 || calls.Load() != 10 || store.requestCount() != 0 {
		t.Fatalf("online failure/gate blocked or changed a local ingredient: %#v, %v, %d upstream calls", results, err, calls.Load())
	}
}

func TestUnmatchedPackagedQueryUsesOpenFoodFactsWithUSDACatalogueInstalled(t *testing.T) {
	foods, err := BundledFoods()
	if err != nil {
		t.Fatal(err)
	}
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		calls.Add(1)
		if request.Method != http.MethodGet || request.URL.Query().Get("search_terms") != "zznewpackagedbrand granola" || request.Header.Get("Authorization") != "" {
			t.Error("unmatched packaged-food lookup bypassed the keyless OFF search")
		}
		writer.Write([]byte(completeFoodResponse))
	}))
	defer server.Close()
	store := newMemoryStore()
	service := newTestService(t, store, server.URL, func(options *Options) { options.FallbackFoods = foods })
	results, err := service.SearchFoods(context.Background(), "zznewpackagedbrand granola")
	if err != nil || len(results) != 1 || results[0].ID != "off:12345678" || !strings.Contains(results[0].Source, "Open Food Facts (ODbL)") || calls.Load() != 1 || store.requestCount() != 0 {
		t.Fatalf("upstream search/source was replaced by fabricated food or AI: %#v, %v", results, err)
	}
}
