package integration_test

import (
	"encoding/json"
	"math"
	"net/http"
	"reflect"
	"strings"
	"testing"

	"training-app/backend/dao"
	"training-app/backend/providers"
)

const usdaBananaSource = "USDA FoodData Central · SR Legacy April 2018 · FDC 173944 · CC0-1.0 · https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_sr_legacy_food_csv_2018-04.zip"

func validCalculation() object {
	return object{"age": 28, "sex": "female", "heightCm": 165, "weightKg": 56.5, "activity": "moderate", "goal": "build-muscle", "effectiveDate": "2026-10-10", "calorieAdjustment": 250, "proteinPerKg": 1.6, "fatPercent": 25}
}

func calculateThroughAPI(t *testing.T, a *testAPI, token string, input object) object {
	t.Helper()
	response := a.send(http.MethodPost, "/api/v1/nutrition/calculate", token, input)
	requireStatus(t, response, http.StatusOK)
	if !strings.Contains(response.header.Get("Cache-Control"), "no-store") {
		t.Fatal("personal calculation responses must never enter public caches")
	}
	return dataObject(t, response)
}

func requireNoAIUsage(t *testing.T, a *testAPI, user object) {
	t.Helper()
	var count int64
	if err := a.db.Model(&providers.Usage{}).Where("user_id = ?", user["id"]).Count(&count).Error; err != nil {
		t.Fatal(err)
	}
	if count != 0 {
		t.Fatal("regular calculation and database search must not reserve any AI quota")
	}
}

func TestNutritionCalculatorPreviewIsAuthenticatedReadOnlyAndIndependentOfAI(t *testing.T) {
	a := newTestAPI(t)
	token, user := a.register("Calculator Account", "calculator@example.com")
	before := a.snapshot(token)
	if before["provider"].(map[string]any)["enabled"] != false {
		t.Fatal("this case needs a disabled AI provider")
	}
	requireStatus(t, a.send(http.MethodPost, "/api/v1/nutrition/calculate", "", validCalculation()), http.StatusUnauthorized)
	preview := calculateThroughAPI(t, a, token, validCalculation())
	second := calculateThroughAPI(t, a, token, validCalculation())
	if preview["id"] == second["id"] || preview["id"] == "nutrition-preview" {
		t.Fatal("the API must issue a fresh preview ID for every unsaved calculation")
	}
	for key, expected := range map[string]any{"calories": float64(2260), "protein": float64(90), "carbs": float64(333), "fat": float64(63), "mode": "calculated", "manuallyOverridden": false, "effectiveDate": "2026-10-10"} {
		if preview[key] != expected {
			t.Fatalf("unexpected %s: %#v", key, preview[key])
		}
	}
	metadata := preview["calculation"].(map[string]any)
	if metadata["version"] != "mifflin-st-jeor-v1" || metadata["restingCalories"] != float64(1295) || metadata["maintenanceCalories"] != float64(2008) {
		t.Fatal("the read-only preview must include the frozen equation and whole-calorie estimates")
	}
	encoded, _ := json.Marshal(validCalculation())
	var expectedInput object
	_ = json.Unmarshal(encoded, &expectedInput)
	if !reflect.DeepEqual(metadata["input"], expectedInput) {
		t.Fatal("the response inferred or changed personal inputs")
	}
	if !reflect.DeepEqual(a.snapshot(token), before) {
		t.Fatal("preview or recalculation modified targets, profile, or revision before explicit apply")
	}
	requireNoAIUsage(t, a, user)
	var receipts int64
	if err := a.db.Model(&dao.MutationReceipt{}).Where("user_id = ?", user["id"]).Count(&receipts).Error; err != nil || receipts != 0 {
		t.Fatalf("read-only calculations must not leave mutation receipts: %d, %v", receipts, err)
	}
}

func TestNutritionCalculatorRejectsMissingNullMalformedAndOutOfPolicyInputs(t *testing.T) {
	a := newTestAPI(t)
	token, user := a.register("Calculator Validation", "calculator-validation@example.com")
	before := a.snapshot(token)
	for field := range validCalculation() {
		for _, null := range []bool{false, true} {
			input := validCalculation()
			if null {
				input[field] = nil
			} else {
				delete(input, field)
			}
			requireStatus(t, a.send(http.MethodPost, "/api/v1/nutrition/calculate", token, input), http.StatusBadRequest)
		}
	}
	for _, testCase := range []struct {
		field string
		value any
	}{
		{"age", 28.5}, {"age", "28"}, {"sex", ""}, {"sex", "unknown"},
		{"heightCm", 65}, {"weightKg", 400}, {"activity", "extreme"}, {"goal", "unknown"},
		{"effectiveDate", "2026-02-30"}, {"calorieAdjustment", "NaN"}, {"calorieAdjustment", 501},
		{"proteinPerKg", .7}, {"fatPercent", 41}, {"weightLb", 150}, {"heightIn", 65}, {"unit", "lb"},
	} {
		input := validCalculation()
		input[testCase.field] = testCase.value
		requireStatus(t, a.send(http.MethodPost, "/api/v1/nutrition/calculate", token, input), http.StatusBadRequest)
	}
	for _, input := range []object{
		{"age": 100, "sex": "female", "heightCm": 100, "weightKg": 30, "activity": "sedentary", "goal": "lose-fat", "effectiveDate": "2026-10-10", "calorieAdjustment": -500, "proteinPerKg": 1.6, "fatPercent": 25},
		{"age": 100, "sex": "female", "heightCm": 100, "weightKg": 350, "activity": "sedentary", "goal": "lose-fat", "effectiveDate": "2026-10-10", "calorieAdjustment": -500, "proteinPerKg": 3, "fatPercent": 40},
	} {
		requireStatus(t, a.send(http.MethodPost, "/api/v1/nutrition/calculate", token, input), http.StatusBadRequest)
	}
	if !reflect.DeepEqual(a.snapshot(token), before) {
		t.Fatal("rejected calculation requests changed durable private state")
	}
	requireNoAIUsage(t, a, user)
}

func TestNutritionApplyManualOverrideAndDatedHistoryPreservePrivateProvenance(t *testing.T) {
	a := newTestAPI(t)
	token, user := a.register("Calculated History", "calculated-history@example.com")
	otherToken, _ := a.register("Other Calculator", "other-calculator@example.com")
	otherBefore := a.snapshot(otherToken)
	preview := calculateThroughAPI(t, a, token, validCalculation())
	state := a.apply(token, a.snapshot(token), "saveTargets", preview)
	first := onlyRecord(t, state, "targets")
	firstID := first["id"]
	provenance := clone(t, first["calculation"].(map[string]any))
	for index, tamper := range []func(object){
		func(value object) { delete(value, "calculation") },
		func(value object) { value["calories"] = value["calories"].(float64) + 10 },
		func(value object) { value["calculation"].(map[string]any)["version"] = "invented-v2" },
		func(value object) { value["calculation"].(map[string]any)["restingCalories"] = float64(9999) },
		func(value object) {
			value["calculation"].(map[string]any)["input"].(map[string]any)["effectiveDate"] = "2026-10-11"
		},
	} {
		changed := clone(t, first)
		tamper(changed)
		requireStatus(t, a.mutation(token, state, "bad-provenance-"+string(rune('a'+index)), "saveTargets", changed), http.StatusBadRequest)
		if !reflect.DeepEqual(a.snapshot(token), state) {
			t.Fatal("unreproducible provenance changed the saved target or revision")
		}
	}
	manual := clone(t, first)
	manual["mode"], manual["manuallyOverridden"], manual["calories"] = "manual", false, 2400
	delete(manual, "calculation")
	state = a.apply(token, state, "saveTargets", manual)
	override := onlyRecord(t, state, "targets")
	if override["id"] != firstID || override["mode"] != "manual" || override["manuallyOverridden"] != true || !reflect.DeepEqual(override["calculation"], provenance) {
		t.Fatal("manual override must preserve the dated ID, original calculation, and explicit override flag")
	}
	changedMetadata := clone(t, override)
	changedMetadata["calculation"].(map[string]any)["input"].(map[string]any)["age"] = float64(29)
	requireStatus(t, a.mutation(token, state, "rewritten-manual-provenance", "saveTargets", changedMetadata), http.StatusBadRequest)
	if !reflect.DeepEqual(a.snapshot(token), state) {
		t.Fatal("manual override accepted different historical inputs")
	}
	// Recalculation is a draft until applied, including a new future effective date.
	input := validCalculation()
	input["effectiveDate"], input["calorieAdjustment"] = "2026-10-11", 0
	later := calculateThroughAPI(t, a, token, input)
	if !reflect.DeepEqual(a.snapshot(token), state) {
		t.Fatal("recalculation silently replaced an existing manual target")
	}
	state = a.apply(token, state, "saveTargets", later)
	if len(records(t, state, "targets")) != 2 {
		t.Fatal("applying a later target must retain the earlier manual history")
	}
	for _, target := range records(t, state, "targets") {
		if target["effectiveDate"] == "2026-10-10" && !reflect.DeepEqual(target, override) {
			t.Fatal("future calculation rewrote the earlier date")
		}
	}
	state = a.apply(token, state, "saveCheckIn", object{"id": "daily-calculator-weight", "date": "2026-10-11", "weight": 60, "notes": "Weight must not automatically change targets"})
	if len(records(t, state, "targets")) != 2 || !reflect.DeepEqual(a.snapshot(otherToken), otherBefore) {
		t.Fatal("daily measurements or another account changed nutrition history")
	}
	requireNoAIUsage(t, a, user)
	// Existing records without provenance remain readable, even though creating
	// a new calculated target without metadata is prohibited above.
	legacy := object{"id": "legacy-calculated", "effectiveDate": "2026-10-09", "mode": "calculated", "manuallyOverridden": false, "calories": 2000, "protein": 100, "carbs": 250, "fat": 60}
	state["targets"] = append(state["targets"].([]any), legacy)
	encoded, err := json.Marshal(state)
	if err != nil {
		t.Fatal(err)
	}
	if err := a.db.Model(&dao.TrainingDocument{}).Where("user_id = ?", user["id"]).Update("state", dao.JSON(encoded)).Error; err != nil {
		t.Fatal(err)
	}
	if len(records(t, a.snapshot(token), "targets")) != 3 {
		t.Fatal("legacy provenance-free history became unreadable")
	}
}

func TestUSDAFoodSearchSurvivesUpstreamFailureAndPreservesQuantityAttribution(t *testing.T) {
	a := newTestAPI(t)
	token, user := a.register("USDA Account", "usda-account@example.com")
	before := a.snapshot(token)
	response := a.send(http.MethodGet, "/api/v1/foods/search?q=banana", token, nil)
	requireStatus(t, response, http.StatusOK)
	var foods []object
	if err := json.Unmarshal(response.data.Data, &foods); err != nil {
		t.Fatal(err)
	}
	var banana object
	for _, item := range foods {
		if item["id"] == "usda:173944" {
			banana = item
		}
	}
	if banana == nil || banana["name"] != "Bananas, raw" || banana["serving"] != "100 g" || banana["source"] != usdaBananaSource {
		t.Fatalf("local search must return the genuine pinned USDA record: %#v", banana)
	}
	for key, expected := range map[string]float64{"calories": 89, "protein": 1.09, "carbs": 22.84, "fat": .33} {
		if banana[key] != expected {
			t.Fatalf("USDA %s per 100g was changed: %#v", key, banana[key])
		}
	}
	if !reflect.DeepEqual(a.snapshot(token), before) {
		t.Fatal("food database search must never save a food or change targets")
	}
	// The configured external endpoint is the local 502 stub, not a paid API.
	requireStatus(t, a.send(http.MethodGet, "/api/v1/foods/search?q=unmatched-bodybuilder-nutrition-91827", token, nil), http.StatusServiceUnavailable)
	entry := food("usda-food-entry", "2026-10-10", "Bananas, raw")
	entry["foodId"], entry["databaseSource"], entry["serving"], entry["source"], entry["quantity"] = banana["id"], banana["source"], "100 g", "database", 2
	for _, key := range []string{"calories", "protein", "carbs", "fat"} {
		entry[key] = banana[key].(float64) * 2
	}
	state := a.apply(token, before, "saveFood", entry)
	saved := onlyRecord(t, state, "foodEntries")
	if saved["databaseSource"] != usdaBananaSource || saved["serving"] != "100 g" || saved["quantity"] != float64(2) {
		t.Fatal("saving a reviewed serving lost database attribution")
	}
	for key, expected := range map[string]float64{"calories": 178, "protein": 2.18, "carbs": 45.68, "fat": .66} {
		if math.Abs(saved[key].(float64)-expected) > 1e-9 {
			t.Fatalf("USDA %s must scale with reviewed quantity: %#v", key, saved[key])
		}
	}
	oversized := clone(t, saved)
	oversized["databaseSource"] = strings.Repeat("s", 1001)
	requireStatus(t, a.mutation(token, state, "overlong-database-source", "saveFood", oversized), http.StatusBadRequest)
	if !reflect.DeepEqual(a.snapshot(token), state) {
		t.Fatal("invalid database attribution changed the saved food")
	}
	requireNoAIUsage(t, a, user)
}
