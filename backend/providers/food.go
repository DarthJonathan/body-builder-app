package providers

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"
	"training-app/backend/domain"
	"unicode/utf8"
)

const foodSearchesPerMinute = 10
const foodCacheLifetime = 5 * time.Minute
const maxFoodCacheEntries = 100

type foodCacheEntry struct {
	foods     []domain.Food
	expiresAt time.Time
}
type foodFlight struct {
	done  chan struct{}
	foods []domain.Food
	err   error
}
type foodSearch struct {
	service  *Service
	mutex    sync.Mutex
	cache    map[string]foodCacheEntry
	inflight map[string]*foodFlight
	requests []time.Time
}

func newFoodSearch(service *Service) *foodSearch {
	return &foodSearch{service: service, cache: make(map[string]foodCacheEntry), inflight: make(map[string]*foodFlight)}
}
func copyFoods(foods []domain.Food) []domain.Food { return append([]domain.Food{}, foods...) }

// SearchFoods returns attributed local USDA ingredient matches first. Only a
// query with no local match reaches the keyless Open Food Facts keyword API.
func (service *Service) SearchFoods(ctx context.Context, query string) ([]domain.Food, error) {
	query = strings.Join(strings.Fields(query), " ")
	if !utf8.ValidString(query) || utf8.RuneCountInString(query) > 200 {
		return nil, apiError(http.StatusBadRequest, "invalid_food_query", "Enter a food search up to 200 characters.")
	}
	if utf8.RuneCountInString(query) < 2 {
		return []domain.Food{}, nil
	}
	if err := ctx.Err(); err != nil {
		return nil, apiError(http.StatusGatewayTimeout, "food_provider_timeout", "Food search was cancelled. Please try again.")
	}
	if foods := service.localFoods(query); len(foods) > 0 {
		return foods, nil
	}
	timeout := service.options.Timeout
	if timeout > 8*time.Second {
		timeout = 8 * time.Second
	}
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	key := strings.ToLower(query)
	search := service.food
	now := service.options.Now()
	search.mutex.Lock()
	if cached, found := search.cache[key]; found && now.Before(cached.expiresAt) {
		foods := copyFoods(cached.foods)
		search.mutex.Unlock()
		return foods, nil
	}
	if flight, found := search.inflight[key]; found {
		search.mutex.Unlock()
		select {
		case <-flight.done:
			return copyFoods(flight.foods), flight.err
		case <-ctx.Done():
			return nil, apiError(http.StatusGatewayTimeout, "food_provider_timeout", "Food search took too long. Please try again or log food manually.")
		}
	}
	retained := search.requests[:0]
	for _, requestedAt := range search.requests {
		if now.Sub(requestedAt) < time.Minute {
			retained = append(retained, requestedAt)
		}
	}
	search.requests = retained
	if len(search.requests) >= foodSearchesPerMinute {
		search.mutex.Unlock()
		return service.foodFallback(query, apiError(http.StatusTooManyRequests, "food_rate_limited", "Food search has reached its 10 searches per minute limit. Wait a minute, use a saved food, or log food manually."))
	}
	search.requests = append(search.requests, now)
	flight := &foodFlight{done: make(chan struct{})}
	search.inflight[key] = flight
	search.mutex.Unlock()
	foods, err := search.fetch(ctx, query)
	if err != nil {
		foods, err = service.foodFallback(query, err)
	}
	search.mutex.Lock()
	if err == nil {
		if len(search.cache) >= maxFoodCacheEntries {
			oldestKey := ""
			var oldest time.Time
			for candidate, entry := range search.cache {
				if oldestKey == "" || entry.expiresAt.Before(oldest) {
					oldestKey, oldest = candidate, entry.expiresAt
				}
			}
			delete(search.cache, oldestKey)
		}
		search.cache[key] = foodCacheEntry{foods: copyFoods(foods), expiresAt: service.options.Now().Add(foodCacheLifetime)}
	}
	flight.foods, flight.err = copyFoods(foods), err
	delete(search.inflight, key)
	close(flight.done)
	search.mutex.Unlock()
	return foods, err
}

func (service *Service) foodFallback(query string, upstreamError error) ([]domain.Food, error) {
	foods := service.localFoods(query)
	if len(foods) == 0 {
		return nil, upstreamError
	}
	return foods, nil
}

type offProduct struct {
	Code        json.RawMessage            `json:"code"`
	Name        string                     `json:"product_name"`
	EnglishName string                     `json:"product_name_en"`
	Brands      string                     `json:"brands"`
	Serving     string                     `json:"serving_size"`
	Nutriments  map[string]json.RawMessage `json:"nutriments"`
}

func (search *foodSearch) fetch(ctx context.Context, query string) ([]domain.Food, error) {
	endpoint, _ := url.Parse(search.service.options.FoodSearchURL)
	parameters := endpoint.Query()
	parameters.Set("search_terms", query)
	parameters.Set("search_simple", "1")
	parameters.Set("action", "process")
	parameters.Set("json", "1")
	parameters.Set("page_size", "20")
	parameters.Set("page", "1")
	parameters.Set("fields", "code,product_name,product_name_en,brands,serving_size,nutriments")
	endpoint.RawQuery = parameters.Encode()
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint.String(), nil)
	if err != nil {
		return nil, foodUnavailable()
	}
	request.Header.Set("Accept", "application/json")
	request.Header.Set("User-Agent", search.service.options.FoodUserAgent)
	response, err := search.service.http.Do(request)
	if err != nil {
		if ctx.Err() != nil {
			return nil, apiError(http.StatusGatewayTimeout, "food_provider_timeout", "Food search took too long. Please try again or log food manually.")
		}
		return nil, foodUnavailable()
	}
	defer response.Body.Close()
	if response.StatusCode == http.StatusTooManyRequests {
		return nil, apiError(http.StatusTooManyRequests, "food_rate_limited", "Open Food Facts has reached its search limit. Try later, use a saved food, or log food manually.")
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return nil, foodUnavailable()
	}
	body, err := io.ReadAll(io.LimitReader(response.Body, maxResponseBytes+1))
	if err != nil || len(body) > maxResponseBytes {
		return nil, foodUnavailable()
	}
	var payload struct {
		Products *[]offProduct `json:"products"`
	}
	if err := json.Unmarshal(body, &payload); err != nil || payload.Products == nil {
		return nil, foodUnavailable()
	}
	foods := make([]domain.Food, 0, 20)
	seen := make(map[string]bool)
	for _, product := range *payload.Products {
		food, valid := product.food()
		if !valid || seen[food.ID] {
			continue
		}
		foods, seen[food.ID] = append(foods, food), true
		if len(foods) == 20 {
			break
		}
	}
	return foods, nil
}

func foodUnavailable() error {
	return apiError(http.StatusServiceUnavailable, "food_provider_unavailable", "Open Food Facts is unavailable. Use a saved food or log food manually, and try search again later.")
}

func (product offProduct) food() (domain.Food, bool) {
	var code string
	if err := json.Unmarshal(product.Code, &code); err != nil {
		code = string(product.Code)
	}
	if len(code) < 4 || len(code) > 24 || strings.IndexFunc(code, func(character rune) bool { return character < '0' || character > '9' }) >= 0 {
		return domain.Food{}, false
	}
	name := strings.TrimSpace(product.Name)
	if name == "" {
		name = strings.TrimSpace(product.EnglishName)
	}
	if !validText(name, 200) {
		return domain.Food{}, false
	}
	if brand := strings.TrimSpace(product.Brands); brand != "" && validText(brand, 100) && !strings.Contains(strings.ToLower(name), strings.ToLower(brand)) {
		combined := name + " · " + brand
		if validText(combined, 200) {
			name = combined
		}
	}
	serving := strings.TrimSpace(product.Serving)
	nutrients, valid := product.nutrients("_serving", 10_000, 1_000)
	if !valid || !validText(serving, 150) {
		nutrients, valid = product.nutrients("_100g", 1_000, 100)
		serving = "100 g"
	}
	if !valid {
		return domain.Food{}, false
	}
	return domain.Food{ID: "off:" + code, Name: name, Serving: serving, Source: "Open Food Facts (ODbL) · https://world.openfoodfacts.org/product/" + code, Nutrients: nutrients}, true
}

func (product offProduct) nutrients(suffix string, maxCalories, maxMacros float64) (domain.Nutrients, bool) {
	calories, caloriePresent := offNumber(product.Nutriments["energy-kcal"+suffix])
	protein, proteinPresent := offNumber(product.Nutriments["proteins"+suffix])
	carbs, carbsPresent := offNumber(product.Nutriments["carbohydrates"+suffix])
	fat, fatPresent := offNumber(product.Nutriments["fat"+suffix])
	nutrients := domain.Nutrients{Calories: calories, Protein: protein, Carbs: carbs, Fat: fat}
	return nutrients, caloriePresent && proteinPresent && carbsPresent && fatPresent && validNutrients(nutrients, maxCalories, maxMacros)
}

func offNumber(raw json.RawMessage) (float64, bool) {
	if len(raw) == 0 {
		return 0, false
	}
	var number float64
	if err := json.Unmarshal(raw, &number); err == nil {
		return number, finiteRange(number, 0, 100_000) && string(raw) != "null"
	}
	var encoded string
	if err := json.Unmarshal(raw, &encoded); err != nil {
		return 0, false
	}
	parsed, err := strconv.ParseFloat(strings.TrimSpace(encoded), 64)
	return parsed, err == nil && finiteRange(parsed, 0, 100_000)
}
