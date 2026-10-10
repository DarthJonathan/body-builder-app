package providers

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"training-app/backend/domain"
)

const completeFoodResponse = `{"products":[{"code":"12345678","product_name":"Granola","brands":"Example brand","serving_size":"30 g","nutriments":{"energy-kcal_serving":120,"proteins_serving":4.2,"carbohydrates_serving":15,"fat_serving":4.8,"energy-kcal_100g":400,"proteins_100g":14,"carbohydrates_100g":50,"fat_100g":16}}]}`

func TestFoodSearchUsesKeylessKeywordAPIAndGenuineAttributedValues(t *testing.T) {
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		calls.Add(1)
		if request.Method != http.MethodGet || request.Header.Get("Authorization") != "" || request.Header.Get("x-api-key") != "" {
			t.Error("food search is not keyless GET")
		}
		if request.Header.Get("User-Agent") != "BodyBuilder/test (test@example.test)" {
			t.Error("food search lacks the configured User-Agent")
		}
		query := request.URL.Query()
		if query.Get("search_terms") != "Granola & milk" || query.Get("json") != "1" || query.Get("search_simple") != "1" || query.Get("action") != "process" || query.Get("page_size") != "20" || !strings.Contains(query.Get("fields"), "nutriments") {
			t.Errorf("incorrect keyword query: %v", query)
		}
		writer.Header().Set("Content-Type", "application/json")
		writer.Write([]byte(completeFoodResponse))
	}))
	defer server.Close()
	store := newMemoryStore()
	service := newTestService(t, store, server.URL, func(options *Options) { options.FoodUserAgent = "BodyBuilder/test (test@example.test)" })
	foods, err := service.SearchFoods(context.Background(), "  Granola   & milk  ")
	if err != nil || len(foods) != 1 {
		t.Fatalf("food search failed: %#v, %v", foods, err)
	}
	food := foods[0]
	if food.ID != "off:12345678" || food.Name != "Granola · Example brand" || food.Serving != "30 g" || food.Calories != 120 || food.Protein != 4.2 || food.Carbs != 15 || food.Fat != 4.8 {
		t.Fatalf("food serving values changed: %#v", food)
	}
	if !strings.Contains(food.Source, "Open Food Facts (ODbL)") || !strings.Contains(food.Source, "https://world.openfoodfacts.org/product/12345678") {
		t.Fatalf("food lost attribution: %s", food.Source)
	}
	if store.requestCount() != 0 || calls.Load() != 1 {
		t.Fatal("keyless food search consumed AI usage")
	}
}

func TestFoodSearchDoesNotFabricateMissingNutrientsOrConfuseServingUnits(t *testing.T) {
	response := `{"products":[
	{"code":"11111111","product_name":"Missing protein","nutriments":{"energy-kcal_100g":100,"carbohydrates_100g":10,"fat_100g":0}},
	{"code":"22222222","product_name":"Missing kcal","nutriments":{"energy_100g":400,"proteins_100g":1,"carbohydrates_100g":10,"fat_100g":0}},
	{"code":"33333333","product_name":"Null fat","nutriments":{"energy-kcal_100g":100,"proteins_100g":1,"carbohydrates_100g":10,"fat_100g":null}},
	{"code":"44444444","product_name":"Impossible macros","nutriments":{"energy-kcal_100g":100,"proteins_100g":999,"carbohydrates_100g":10,"fat_100g":1}},
	{"code":"../../bad","product_name":"Unsafe barcode","nutriments":{"energy-kcal_100g":100,"proteins_100g":1,"carbohydrates_100g":10,"fat_100g":1}},
	{"code":"55555555","product_name":"Oats","serving_size":"30 g","nutriments":{"energy-kcal_serving":100,"proteins_serving":3,"fat_serving":2,"energy-kcal_100g":"350","proteins_100g":"12","carbohydrates_100g":"64","fat_100g":"6"}},
	{"code":66666666,"product_name_en":"Plain water","nutriments":{"energy-kcal_100g":0,"proteins_100g":0,"carbohydrates_100g":0,"fat_100g":0}},
	{"code":"55555555","product_name":"Duplicate oats","nutriments":{"energy-kcal_100g":999,"proteins_100g":1,"carbohydrates_100g":1,"fat_100g":1}}
	]}`
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) { writer.Write([]byte(response)) }))
	defer server.Close()
	service := newTestService(t, newMemoryStore(), server.URL, nil)
	foods, err := service.SearchFoods(context.Background(), "foods")
	if err != nil || len(foods) != 2 {
		t.Fatalf("missing/invalid products were accepted: %#v, %v", foods, err)
	}
	if foods[0].Name != "Oats" || foods[0].Serving != "100 g" || foods[0].Calories != 350 || foods[0].Protein != 12 || foods[0].Carbs != 64 || foods[0].Fat != 6 {
		t.Fatalf("partial serving data became invented nutrition: %#v", foods[0])
	}
	if foods[1].Name != "Plain water" || foods[1].Calories != 0 || foods[1].Fat != 0 {
		t.Fatal("explicit genuine zeros must remain valid")
	}
}

func TestFoodCacheIsNormalizedBoundedAndExpires(t *testing.T) {
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		calls.Add(1)
		writer.Write([]byte(completeFoodResponse))
	}))
	defer server.Close()
	clock := time.Date(2026, 10, 9, 0, 0, 0, 0, time.UTC)
	service := newTestService(t, newMemoryStore(), server.URL, func(options *Options) { options.Now = func() time.Time { return clock } })
	first, err := service.SearchFoods(context.Background(), "Granola")
	if err != nil {
		t.Fatal(err)
	}
	first[0].Name = "Changed by caller"
	second, err := service.SearchFoods(context.Background(), "  GRANOLA  ")
	if err != nil || second[0].Name == "Changed by caller" || calls.Load() != 1 {
		t.Fatal("cache was not normalized or its result was mutable")
	}
	clock = clock.Add(6 * time.Minute)
	if _, err := service.SearchFoods(context.Background(), "granola"); err != nil || calls.Load() != 2 {
		t.Fatal("cached food search did not expire")
	}
	for index := 0; index < maxFoodCacheEntries+3; index++ {
		clock = clock.Add(time.Minute)
		if _, err := service.SearchFoods(context.Background(), "food "+strconv.Itoa(index)); err != nil {
			t.Fatal(err)
		}
	}
	if len(service.food.cache) > maxFoodCacheEntries {
		t.Fatal("food cache grew without a bound")
	}
}

func TestFoodSearchCoalescesConcurrentRequests(t *testing.T) {
	var calls atomic.Int32
	started := make(chan struct{})
	release := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		if calls.Add(1) == 1 {
			close(started)
		}
		<-release
		writer.Write([]byte(completeFoodResponse))
	}))
	defer server.Close()
	service := newTestService(t, newMemoryStore(), server.URL, nil)
	var wait sync.WaitGroup
	wait.Add(1)
	go func() {
		defer wait.Done()
		if _, err := service.SearchFoods(context.Background(), "Granola"); err != nil {
			t.Errorf("first request: %v", err)
		}
	}()
	<-started
	for index := 0; index < 7; index++ {
		wait.Add(1)
		go func() {
			defer wait.Done()
			if _, err := service.SearchFoods(context.Background(), "GRANOLA"); err != nil {
				t.Errorf("coalesced request: %v", err)
			}
		}()
	}
	close(release)
	wait.Wait()
	if calls.Load() != 1 {
		t.Fatalf("same keyword triggered %d upstream requests", calls.Load())
	}
}

func TestFoodRateGateCountsOnlyUncachedUpstreamRequests(t *testing.T) {
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		calls.Add(1)
		writer.Write([]byte(`{"products":[]}`))
	}))
	defer server.Close()
	clock := time.Date(2026, 10, 9, 0, 0, 0, 0, time.UTC)
	service := newTestService(t, newMemoryStore(), server.URL, func(options *Options) { options.Now = func() time.Time { return clock } })
	for index := 0; index < 10; index++ {
		if _, err := service.SearchFoods(context.Background(), "food "+strconv.Itoa(index)); err != nil {
			t.Fatal(err)
		}
	}
	_, err := service.SearchFoods(context.Background(), "food 11")
	requireCode(t, err, "food_rate_limited", 429)
	if _, err := service.SearchFoods(context.Background(), "food 0"); err != nil {
		t.Fatal("a cached search was blocked by the rate gate")
	}
	if calls.Load() != 10 {
		t.Fatal("rate gate allowed more than ten upstream requests")
	}
	clock = clock.Add(time.Minute)
	if _, err := service.SearchFoods(context.Background(), "food 11"); err != nil || calls.Load() != 11 {
		t.Fatal("sliding rate gate did not reopen after a minute")
	}
}

func TestFoodSearchFailuresRemainVisibleWithoutGenuineFallback(t *testing.T) {
	cases := []struct {
		name           string
		status         int
		body, code     string
		expectedStatus int
	}{
		{"outage", 502, `{"error":"upstream internals"}`, "food_provider_unavailable", 503},
		{"upstream quota", 429, `{"error":"upstream internals"}`, "food_rate_limited", 429},
		{"malformed", 200, `not json`, "food_provider_unavailable", 503},
		{"missing products", 200, `{"count":0}`, "food_provider_unavailable", 503},
		{"oversized", 200, strings.Repeat("x", maxResponseBytes+1), "food_provider_unavailable", 503},
	}
	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
				writer.WriteHeader(test.status)
				writer.Write([]byte(test.body))
			}))
			defer server.Close()
			service := newTestService(t, newMemoryStore(), server.URL, nil)
			foods, err := service.SearchFoods(context.Background(), "granola")
			requireCode(t, err, test.code, test.expectedStatus)
			if len(foods) != 0 {
				t.Fatal("failed search silently returned fabricated food")
			}
			if strings.Contains(err.Error(), "upstream internals") {
				t.Fatal("upstream details leaked through food error")
			}
		})
	}
}

func TestFoodFallbackRequiresAttributionAndPreservesItsSource(t *testing.T) {
	// Synthetic values are injected only into this isolated validation test.
	// The application supplies the independently pinned USDA catalogue.
	reference := domain.Food{ID: "test-only-reference", Name: "Reference oats", Serving: "100 g", Source: "Test-only reference dataset · https://example.test/food/oats", Nutrients: domain.Nutrients{Calories: 350, Protein: 12, Carbs: 64, Fat: 6}}
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) { writer.WriteHeader(502) }))
	defer server.Close()
	service := newTestService(t, newMemoryStore(), server.URL, func(options *Options) { options.FallbackFoods = []domain.Food{reference} })
	foods, err := service.SearchFoods(context.Background(), "oats")
	if err != nil || len(foods) != 1 || foods[0].Source != reference.Source || foods[0].ID != reference.ID {
		t.Fatalf("fallback was relabelled as upstream data: %#v, %v", foods, err)
	}
	_, err = service.SearchFoods(context.Background(), "missing food")
	requireCode(t, err, "food_provider_unavailable", 503)
	for _, source := range []string{"", "Preview food catalogue"} {
		invalid := reference
		invalid.Source = source
		_, err := newWithStore(Options{FallbackFoods: []domain.Food{invalid}}, newMemoryStore())
		if err == nil {
			t.Fatal("unattributed/preview fixture accepted as live fallback")
		}
	}
}

func TestFoodQueryValidationAndTimeout(t *testing.T) {
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		calls.Add(1)
		time.Sleep(80 * time.Millisecond)
		json.NewEncoder(writer).Encode(map[string]any{"products": []any{}})
	}))
	defer server.Close()
	service := newTestService(t, newMemoryStore(), server.URL, func(options *Options) { options.Timeout = 10 * time.Millisecond })
	for _, query := range []string{"", "a", " "} {
		foods, err := service.SearchFoods(context.Background(), query)
		if err != nil || len(foods) != 0 {
			t.Fatal("empty or single-character query should avoid upstream")
		}
	}
	for _, query := range []string{strings.Repeat("a", 201), string([]byte{0xff})} {
		_, err := service.SearchFoods(context.Background(), query)
		requireCode(t, err, "invalid_food_query", 400)
	}
	if calls.Load() != 0 {
		t.Fatal("invalid query called upstream")
	}
	_, err := service.SearchFoods(context.Background(), "oats")
	requireCode(t, err, "food_provider_timeout", 504)
}
