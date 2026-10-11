package domain

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"math"
)

const NutritionCalculationVersion = "mifflin-st-jeor-v1"

var activityFactors = map[string]float64{
	"sedentary": 1.2, "light": 1.375, "moderate": 1.55,
	"active": 1.725, "very-active": 1.9,
}

// Zero is a valid calorie adjustment, but omitted or null inputs are not choices.
// This also protects inputs nested inside durable target provenance.
func (input *TargetCalculation) UnmarshalJSON(raw []byte) error {
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(raw, &fields); err != nil || fields == nil {
		return errors.New("enter all nutrition calculator inputs")
	}
	for _, name := range []string{"age", "sex", "heightCm", "weightKg", "activity", "goal", "effectiveDate", "calorieAdjustment", "proteinPerKg", "fatPercent"} {
		value, ok := fields[name]
		if !ok || bytes.Equal(bytes.TrimSpace(value), []byte("null")) {
			return fmt.Errorf("%s is required for the nutrition calculator", name)
		}
	}
	type plain TargetCalculation
	var value plain
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&value); err != nil {
		return errors.New("check the nutrition calculator input fields and units")
	}
	*input = TargetCalculation(value)
	return nil
}

func ValidateTargetCalculation(input TargetCalculation) error {
	if input.Age < 18 || input.Age > 100 {
		return errors.New("the calculator accepts adult ages from 18 to 100")
	}
	if err := Choice(input.Sex, "equation sex", "female", "male"); err != nil {
		return err
	}
	if err := Choice(input.Activity, "activity level", "sedentary", "light", "moderate", "active", "very-active"); err != nil {
		return err
	}
	if err := Choice(input.Goal, "nutrition goal", "build-muscle", "maintain", "lose-fat"); err != nil {
		return err
	}
	for _, field := range []struct {
		value    float64
		name     string
		min, max float64
	}{
		{input.HeightCM, "height in cm", 100, 250},
		{input.WeightKG, "weight in kg", 30, 350},
		{input.CalorieAdjustment, "daily calorie adjustment", -500, 500},
		{input.ProteinPerKG, "protein in g per kg", .8, 3},
		{input.FatPercent, "fat percentage", 15, 40},
	} {
		if err := Number(field.value, field.name, field.min, field.max); err != nil {
			return err
		}
	}
	if input.HealthEnergy != nil {
		if err := ValidateHealthEnergy(*input.HealthEnergy); err != nil {
			return err
		}
	}
	return Date(input.EffectiveDate)
}

// CalculateNutrition is a deterministic, unsaved estimate. Activity multipliers,
// offsets, macro allocation and bounds are explicit versioned app policy, not
// part of the published resting-energy equation or measured energy expenditure.
func CalculateNutrition(input TargetCalculation) (NutritionTargets, error) {
	if err := ValidateTargetCalculation(input); err != nil {
		return NutritionTargets{}, err
	}
	constant := -161.0
	if input.Sex == "male" {
		constant = 5
	}
	resting := 10*input.WeightKG + 6.25*input.HeightCM - 5*float64(input.Age) + constant
	maintenance := resting * activityFactors[input.Activity]
	version := NutritionCalculationVersion
	if input.HealthEnergy != nil {
		resting, maintenance = HealthEnergyMean(*input.HealthEnergy)
		version = "apple-health-energy-v1"
	}
	calories := math.Round((maintenance+input.CalorieAdjustment)/10) * 10
	if err := Number(calories, "estimated calorie target", 1000, 10000); err != nil {
		return NutritionTargets{}, errors.New("the estimate is outside the calculator's 1000–10000 calorie range; check your inputs or enter manual targets")
	}
	protein := math.Round(input.WeightKG * input.ProteinPerKG)
	fat := math.Round(calories * input.FatPercent / 100 / 9)
	remaining := calories - protein*4 - fat*9
	if remaining < 0 {
		return NutritionTargets{}, errors.New("protein and fat use more than the calorie target; reduce those settings or increase the calorie target")
	}
	return NutritionTargets{
		ID: "nutrition-preview", EffectiveDate: input.EffectiveDate,
		Nutrients: Nutrients{Calories: calories, Protein: protein, Carbs: math.Round(remaining / 4), Fat: fat},
		Mode:      "calculated", ManuallyOverridden: false,
		Calculation: &NutritionCalculation{Version: version, Input: input, RestingCalories: math.Round(resting), MaintenanceCalories: math.Round(maintenance)},
	}, nil
}

func ValidateCalculationProvenance(target NutritionTargets) error {
	if target.Calculation == nil {
		if target.Mode == "calculated" {
			return errors.New("calculated targets require the original calculator inputs")
		}
		return nil
	}
	provenance := target.Calculation
	if provenance.Version != NutritionCalculationVersion && provenance.Version != "apple-health-energy-v1" {
		return errors.New("unsupported nutrition calculation version")
	}
	expected, err := CalculateNutrition(provenance.Input)
	if err != nil {
		return err
	}
	if provenance.Version != expected.Calculation.Version {
		return errors.New("calculation version does not match its energy source")
	}
	if provenance.RestingCalories != expected.Calculation.RestingCalories || provenance.MaintenanceCalories != expected.Calculation.MaintenanceCalories {
		return errors.New("calculation provenance does not match its inputs")
	}
	if target.Mode == "calculated" {
		if target.ManuallyOverridden || target.EffectiveDate != provenance.Input.EffectiveDate || target.Nutrients != expected.Nutrients {
			return errors.New("calculated targets must match the preview; save edited values as a manual override")
		}
	} else if !target.ManuallyOverridden {
		return errors.New("edited calculated targets must be marked as a manual override")
	}
	return nil
}
