package domain

import (
	"math"
	"testing"
)

func TestCheckInRejectsImpossibleDatesWeightsAndOversizedNotes(t *testing.T) {
	valid := CheckIn{ID: "checkin-one", Date: "2026-10-09", Weight: 56.5, Notes: "A training day"}
	if err := ValidateCheckIn(valid); err != nil {
		t.Fatal(err)
	}
	cases := []CheckIn{valid, valid, valid, valid, valid}
	cases[0].Date = "2026-02-30"
	cases[1].Weight = -1
	cases[2].Weight = 701
	cases[3].Weight = math.Inf(1)
	cases[4].ID = ""
	for _, input := range cases {
		if err := ValidateCheckIn(input); err == nil {
			t.Fatalf("accepted invalid check-in: %#v", input)
		}
	}
}
func TestLessonPermitsPrivateTextNotesButRejectsUnsafeURLs(t *testing.T) {
	lesson := Lesson{ID: "note-one", Title: "Training cues", Category: "Training", SavedAt: "2026-10-09T12:00:00Z"}
	if err := ValidateLesson(lesson); err != nil {
		t.Fatal("text-only notes should work:", err)
	}
	for _, link := range []string{"javascript:alert(1)", "https://secret:password@example.com", "https:///missing-host", "relative/article"} {
		lesson.URL = link
		if err := ValidateLesson(lesson); err == nil {
			t.Fatal("accepted unsafe lesson link", link)
		}
	}
}
func TestNutritionRejectsNonFiniteValuesAndInvalidSources(t *testing.T) {
	food := FoodEntry{ID: "food-one", Name: "My meal", Date: "2026-10-09", Meal: "Lunch", Quantity: 1, Serving: "bowl", Source: "manual", Nutrients: Nutrients{Calories: 350, Protein: 20, Carbs: 40, Fat: 12}}
	if err := ValidateFood(food); err != nil {
		t.Fatal(err)
	}
	food.Protein = math.NaN()
	if err := ValidateFood(food); err == nil {
		t.Fatal("accepted NaN")
	}
	food.Protein = 20
	food.Source = "untrusted"
	if err := ValidateFood(food); err == nil {
		t.Fatal("accepted unsupported source")
	}
}
