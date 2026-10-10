package domain

import (
	"encoding/json"
	"math"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

func nutritionInput(t *testing.T) TargetCalculation {
	t.Helper()
	var input TargetCalculation
	if err := json.Unmarshal([]byte(`{"age":28,"sex":"female","heightCm":165,"weightKg":56.5,"activity":"moderate","goal":"build-muscle","effectiveDate":"2026-10-10","calorieAdjustment":250,"proteinPerKg":1.6,"fatPercent":25}`), &input); err != nil {
		t.Fatal(err)
	}
	return input
}

func calculationJSON(t *testing.T, target NutritionTargets) map[string]any {
	t.Helper()
	encoded, err := json.Marshal(target)
	if err != nil {
		t.Fatal(err)
	}
	var result map[string]any
	if err := json.Unmarshal(encoded, &result); err != nil {
		t.Fatal(err)
	}
	return result
}

func TestNutritionCalculationMatchesSharedGoldenFixtures(t *testing.T) {
	encoded, err := os.ReadFile(filepath.Join("..", "..", "docs", "fixtures", "nutrition-calculation.json"))
	if err != nil {
		t.Fatalf("read the shared Go/frontend calculation fixtures: %v", err)
	}
	var fixture struct {
		Version string `json:"version"`
		Cases   []struct {
			Name     string             `json:"name"`
			Input    TargetCalculation  `json:"input"`
			Expected map[string]float64 `json:"expected"`
		} `json:"cases"`
	}
	if err := json.Unmarshal(encoded, &fixture); err != nil {
		t.Fatal(err)
	}
	if fixture.Version != "mifflin-st-jeor-v1" || len(fixture.Cases) < 5 {
		t.Fatal("shared fixtures must include the frozen version and multiple independently calculated cases")
	}
	for _, testCase := range fixture.Cases {
		t.Run(testCase.Name, func(t *testing.T) {
			target, err := CalculateNutrition(testCase.Input)
			if err != nil {
				t.Fatal(err)
			}
			result := calculationJSON(t, target)
			if err := Identifier(target.ID); err != nil {
				t.Fatalf("calculation must return a valid preview ID: %v", err)
			}
			if result["mode"] != "calculated" || result["manuallyOverridden"] != false {
				t.Fatal("an unsaved calculation must retain calculated provenance")
			}
			metadata, ok := result["calculation"].(map[string]any)
			if !ok || metadata["version"] != fixture.Version {
				t.Fatal("calculated target must contain versioned metadata")
			}
			for key, expected := range testCase.Expected {
				actual := result[key]
				if key == "restingCalories" || key == "maintenanceCalories" {
					actual = metadata[key]
				}
				if actual != expected {
					t.Errorf("%s: expected %g, received %#v", key, expected, actual)
				}
			}
			inputJSON, _ := json.Marshal(testCase.Input)
			var input map[string]any
			_ = json.Unmarshal(inputJSON, &input)
			if !reflect.DeepEqual(metadata["input"], input) {
				t.Fatal("calculation metadata changed the explicit personal inputs")
			}
		})
	}
}

func TestNutritionActivityFactorsAndExplicitAdjustments(t *testing.T) {
	// These values are hand-calculated from a resting estimate of 1658.75 kcal.
	for _, testCase := range []struct {
		activity    string
		calories    float64
		maintenance float64
		fat, carbs  float64
	}{
		{"sedentary", 1990, 1991, 55, 262},
		{"light", 2280, 2281, 63, 316},
		{"moderate", 2570, 2571, 71, 371},
		{"active", 2860, 2861, 79, 425},
		{"very-active", 3150, 3152, 88, 478},
	} {
		t.Run(testCase.activity, func(t *testing.T) {
			var input TargetCalculation
			encoded := `{"age":28,"sex":"male","heightCm":175,"weightKg":70,"activity":"` + testCase.activity + `","goal":"maintain","effectiveDate":"2026-10-10","calorieAdjustment":0,"proteinPerKg":1.6,"fatPercent":25}`
			if err := json.Unmarshal([]byte(encoded), &input); err != nil {
				t.Fatal(err)
			}
			target, err := CalculateNutrition(input)
			if err != nil {
				t.Fatal(err)
			}
			if target.Calories != testCase.calories || target.Protein != 112 || target.Fat != testCase.fat || target.Carbs != testCase.carbs {
				t.Fatalf("activity allocation differs from frozen app policy: %#v", target)
			}
			metadata := calculationJSON(t, target)["calculation"].(map[string]any)
			if metadata["restingCalories"] != float64(1659) || metadata["maintenanceCalories"] != testCase.maintenance {
				t.Fatal("display estimates must round whole kcal separately from target math")
			}
		})
	}
	for _, testCase := range []struct {
		goal       string
		adjustment float64
		calories   float64
	}{
		{"build-muscle", 250, 2260}, {"maintain", 0, 2010}, {"lose-fat", -300, 1710},
		{"build-muscle", 0, 2010}, {"lose-fat", 120, 2130},
	} {
		input := nutritionInput(t)
		encoded, _ := json.Marshal(input)
		var explicit map[string]any
		_ = json.Unmarshal(encoded, &explicit)
		explicit["goal"], explicit["calorieAdjustment"] = testCase.goal, testCase.adjustment
		encoded, _ = json.Marshal(explicit)
		_ = json.Unmarshal(encoded, &input)
		target, err := CalculateNutrition(input)
		if err != nil || target.Calories != testCase.calories {
			t.Fatalf("goal %s must use the explicitly entered adjustment %g: %#v, %v", testCase.goal, testCase.adjustment, target, err)
		}
	}
	// Rounding resting calories early would yield 2010 rather than 2000 here.
	input := TargetCalculation{Age: 28, Sex: "male", HeightCM: 175, WeightKG: 71.2, Activity: "sedentary", Goal: "maintain", EffectiveDate: "2026-10-10", ProteinPerKG: 1.6, FatPercent: 25}
	precise, err := CalculateNutrition(input)
	if err != nil || precise.Calories != 2000 || precise.Protein != 114 || precise.Fat != 56 || precise.Carbs != 260 {
		t.Fatalf("target math must use unrounded resting and maintenance estimates: %#v, %v", precise, err)
	}
}

func TestNutritionCalculationJSONRequiresExplicitChoicesIncludingZeroAdjustment(t *testing.T) {
	base := nutritionInput(t)
	encoded := mustNutritionJSON(t, base)
	var fields map[string]any
	_ = json.Unmarshal(encoded, &fields)
	for field := range fields {
		for _, null := range []bool{false, true} {
			var changed map[string]any
			_ = json.Unmarshal(encoded, &changed)
			if null {
				changed[field] = nil
			} else {
				delete(changed, field)
			}
			var input TargetCalculation
			if err := json.Unmarshal(mustNutritionJSON(t, changed), &input); err == nil {
				t.Fatalf("accepted missing/null explicit input %s", field)
			}
		}
	}
	for _, invalid := range []string{"null", "[]", `{"age":NaN}`, `{"age":Infinity}`} {
		var input TargetCalculation
		if err := json.Unmarshal([]byte(invalid), &input); err == nil {
			t.Fatal("accepted malformed calculator JSON")
		}
	}
	fields["calorieAdjustment"] = 0
	var valid TargetCalculation
	if err := json.Unmarshal(mustNutritionJSON(t, fields), &valid); err != nil {
		t.Fatalf("explicit zero adjustment is a valid choice: %v", err)
	}
	fields["weightLb"] = 150
	if err := json.Unmarshal(mustNutritionJSON(t, fields), &valid); err == nil {
		t.Fatal("accepted ambiguous units outside the canonical kg/cm input contract")
	}
}

func TestNutritionCalculationRejectsInvalidAndNonFiniteInputs(t *testing.T) {
	for _, testCase := range []struct {
		field string
		value any
	}{
		{"age", 17}, {"age", 101}, {"sex", ""}, {"sex", "unspecified"},
		{"heightCm", 99}, {"heightCm", 251}, {"weightKg", 29}, {"weightKg", 351},
		{"activity", ""}, {"activity", "athlete"}, {"goal", "unknown"},
		{"effectiveDate", "2026-02-29"}, {"effectiveDate", "2026-10-10T00:00:00Z"},
		{"calorieAdjustment", -501}, {"calorieAdjustment", 501},
		{"proteinPerKg", .79}, {"proteinPerKg", 3.01}, {"fatPercent", 14.9}, {"fatPercent", 40.1},
	} {
		t.Run(testCase.field+"-"+strings.ReplaceAll(string(mustNutritionJSON(t, testCase.value)), "/", "_"), func(t *testing.T) {
			input := nutritionInput(t)
			var values map[string]any
			_ = json.Unmarshal(mustNutritionJSON(t, input), &values)
			values[testCase.field] = testCase.value
			if err := json.Unmarshal(mustNutritionJSON(t, values), &input); err != nil {
				t.Fatal(err)
			}
			if _, err := CalculateNutrition(input); err == nil {
				t.Fatalf("accepted invalid %s: %#v", testCase.field, testCase.value)
			}
		})
	}
	for _, field := range []string{"heightCm", "weightKg", "calorieAdjustment", "proteinPerKg", "fatPercent"} {
		for _, invalid := range []float64{math.NaN(), math.Inf(1), math.Inf(-1)} {
			input := nutritionInput(t)
			value := reflect.ValueOf(&input).Elem()
			for index := 0; index < value.NumField(); index++ {
				if strings.Split(value.Type().Field(index).Tag.Get("json"), ",")[0] == field {
					value.Field(index).SetFloat(invalid)
				}
			}
			if _, err := CalculateNutrition(input); err == nil {
				t.Fatalf("accepted non-finite %s", field)
			}
		}
	}
	for _, encoded := range []string{
		`{"age":100,"sex":"female","heightCm":100,"weightKg":30,"activity":"sedentary","goal":"lose-fat","effectiveDate":"2026-10-10","calorieAdjustment":-500,"proteinPerKg":1.6,"fatPercent":25}`,
		`{"age":100,"sex":"female","heightCm":100,"weightKg":350,"activity":"sedentary","goal":"lose-fat","effectiveDate":"2026-10-10","calorieAdjustment":-500,"proteinPerKg":3,"fatPercent":40}`,
	} {
		var input TargetCalculation
		_ = json.Unmarshal([]byte(encoded), &input)
		if _, err := CalculateNutrition(input); err == nil {
			t.Fatal("out-of-policy calories and impossible macro allocations must fail instead of being clamped")
		}
	}
}

func TestCalculatedNutritionRequiresReproducibleMetadata(t *testing.T) {
	calculated, err := CalculateNutrition(nutritionInput(t))
	if err != nil {
		t.Fatal(err)
	}
	if err := ValidateTargets(calculated); err != nil {
		t.Fatal(err)
	}
	for _, tamper := range []func(map[string]any){
		func(value map[string]any) { delete(value, "calculation") },
		func(value map[string]any) { value["calories"] = value["calories"].(float64) + 10 },
		func(value map[string]any) { value["protein"] = value["protein"].(float64) + 1 },
		func(value map[string]any) { value["manuallyOverridden"] = true },
		func(value map[string]any) { value["calculation"].(map[string]any)["version"] = "unrecognized-v2" },
		func(value map[string]any) {
			value["calculation"].(map[string]any)["maintenanceCalories"] = float64(9999)
		},
		func(value map[string]any) {
			value["calculation"].(map[string]any)["input"].(map[string]any)["effectiveDate"] = "2026-10-11"
		},
	} {
		value := calculationJSON(t, calculated)
		tamper(value)
		var changed NutritionTargets
		_ = json.Unmarshal(mustNutritionJSON(t, value), &changed)
		if err := ValidateTargets(changed); err == nil {
			t.Fatal("accepted calculated targets that cannot reproduce their provenance")
		}
	}
	manual := calculated
	manual.Mode, manual.ManuallyOverridden, manual.Calories = "manual", true, 2400
	if err := ValidateTargets(manual); err != nil {
		t.Fatalf("manual override must retain valid original provenance without reproducing overridden macros: %v", err)
	}
}

func mustNutritionJSON(t *testing.T, value any) []byte {
	t.Helper()
	encoded, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	return encoded
}
