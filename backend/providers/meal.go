package providers

import (
	"bytes"
	"encoding/json"
	"image"
	"image/jpeg"
	"image/png"
	"io"
	"math"
	"mime"
	"net/http"
	"strings"
	"training-app/backend/domain"
	"unicode"
	"unicode/utf8"
)

const mealPrompt = "Estimate the edible foods visible in this meal photo. Return a draft for the user to review, with 1 to 20 items and an assumptions string explaining uncertain ingredients and portion sizes. For every item provide a concise name, positive quantity, human-readable serving unit, and TOTAL calories (kcal), protein (g), carbs (g), and fat (g) for that item's estimated quantity; do not return per-unit nutrients. Use only plausible nonnegative finite numbers. Do not claim exact measurement from the photo. If food cannot be identified, return an empty items array and explain why in assumptions."

// Decode the entire image before it is accepted. Re-encoding removes EXIF and
// other metadata from the bytes sent to the provider and prevents polyglots.
func validatePhoto(data []byte, declaredMIME string) ([]byte, string, error) {
	if len(data) == 0 || len(data) > MaxImageBytes {
		return nil, "", apiError(http.StatusBadRequest, "invalid_meal_image", "Choose a JPEG or PNG meal photo up to 7 MB.")
	}
	detected := http.DetectContentType(data)
	if detected != "image/jpeg" && detected != "image/png" {
		return nil, "", apiError(http.StatusBadRequest, "unsupported_meal_image", "Use a JPEG or PNG photo. Convert HEIC or WebP photos to JPEG or PNG first.")
	}
	if declaredMIME != "" && declaredMIME != "application/octet-stream" {
		declared, _, err := mime.ParseMediaType(declaredMIME)
		if err != nil || declared != detected {
			return nil, "", apiError(http.StatusBadRequest, "invalid_meal_image", "The photo format does not match its declared file type.")
		}
	}
	configuration, _, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil || configuration.Width < 1 || configuration.Height < 1 || configuration.Width > 8_000 || configuration.Height > 8_000 || int64(configuration.Width)*int64(configuration.Height) > MaxImagePixels {
		return nil, "", apiError(http.StatusBadRequest, "invalid_meal_image", "Choose a valid photo no larger than 8000 pixels per side and 16 megapixels.")
	}
	decoded, format, err := image.Decode(bytes.NewReader(data))
	if err != nil || (format != "jpeg" && format != "png") {
		return nil, "", apiError(http.StatusBadRequest, "invalid_meal_image", "The photo is damaged or could not be decoded. Choose another JPEG or PNG photo.")
	}
	var clean bytes.Buffer
	if format == "jpeg" {
		err = jpeg.Encode(&clean, decoded, &jpeg.Options{Quality: 88})
	} else {
		err = png.Encode(&clean, decoded)
	}
	if err != nil || clean.Len() > MaxImageBytes {
		return nil, "", apiError(http.StatusBadRequest, "invalid_meal_image", "The decoded photo is too large. Resize it or save it as a smaller JPEG before uploading.")
	}
	return clean.Bytes(), detected, nil
}

// Primitive types and required properties are the common structured-output
// subset supported by all three providers. Numeric limits are enforced below.
func mealSchema() map[string]any {
	item := map[string]any{
		"type": "object", "additionalProperties": false,
		"required":   []string{"name", "quantity", "serving", "calories", "protein", "carbs", "fat"},
		"properties": map[string]any{"name": map[string]any{"type": "string"}, "quantity": map[string]any{"type": "number"}, "serving": map[string]any{"type": "string"}, "calories": map[string]any{"type": "number"}, "protein": map[string]any{"type": "number"}, "carbs": map[string]any{"type": "number"}, "fat": map[string]any{"type": "number"}},
	}
	return map[string]any{"type": "object", "additionalProperties": false, "required": []string{"items", "assumptions"}, "properties": map[string]any{"items": map[string]any{"type": "array", "items": item}, "assumptions": map[string]any{"type": "string"}}}
}

func parseMeal(answer string) (domain.MealEstimate, error) {
	type draftItem struct {
		Name     *string  `json:"name"`
		Quantity *float64 `json:"quantity"`
		Serving  *string  `json:"serving"`
		Calories *float64 `json:"calories"`
		Protein  *float64 `json:"protein"`
		Carbs    *float64 `json:"carbs"`
		Fat      *float64 `json:"fat"`
	}
	var draft struct {
		Items       *[]draftItem `json:"items"`
		Assumptions *string      `json:"assumptions"`
	}
	decoder := json.NewDecoder(strings.NewReader(answer))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&draft); err != nil {
		return domain.MealEstimate{}, invalidMeal()
	}
	if err := decoder.Decode(new(any)); err != io.EOF {
		return domain.MealEstimate{}, invalidMeal()
	}
	if draft.Items == nil || draft.Assumptions == nil || !validText(*draft.Assumptions, 2_000) || len(*draft.Items) > maxDraftItems {
		return domain.MealEstimate{}, invalidMeal()
	}
	if len(*draft.Items) == 0 {
		return domain.MealEstimate{}, apiError(http.StatusUnprocessableEntity, "meal_not_recognized", "The assistant could not identify food in this photo. Try a clearer meal photo or enter the food manually.")
	}
	estimate := domain.MealEstimate{Items: make([]domain.MealItem, 0, len(*draft.Items)), Assumptions: strings.TrimSpace(*draft.Assumptions), Preview: false}
	for _, item := range *draft.Items {
		if item.Name == nil || item.Serving == nil || item.Quantity == nil || item.Calories == nil || item.Protein == nil || item.Carbs == nil || item.Fat == nil || !validText(*item.Name, 200) || !validText(*item.Serving, 150) || !finiteRange(*item.Quantity, 0, 10_000) || *item.Quantity == 0 {
			return domain.MealEstimate{}, invalidMeal()
		}
		nutrients := domain.Nutrients{Calories: *item.Calories, Protein: *item.Protein, Carbs: *item.Carbs, Fat: *item.Fat}
		if !validNutrients(nutrients, 10_000, 1_000) {
			return domain.MealEstimate{}, invalidMeal()
		}
		estimate.Items = append(estimate.Items, domain.MealItem{Nutrients: nutrients, Name: strings.TrimSpace(*item.Name), Quantity: *item.Quantity, Serving: strings.TrimSpace(*item.Serving)})
	}
	return estimate, nil
}

func invalidMeal() error {
	return invalidOutput("The assistant returned an invalid nutrition estimate. Try a clearer meal photo or enter the food manually.")
}
func finiteRange(value, minimum, maximum float64) bool {
	return !math.IsNaN(value) && !math.IsInf(value, 0) && value >= minimum && value <= maximum
}
func validNutrients(nutrients domain.Nutrients, maxCalories, maxMacros float64) bool {
	return finiteRange(nutrients.Calories, 0, maxCalories) && finiteRange(nutrients.Protein, 0, maxMacros) && finiteRange(nutrients.Carbs, 0, maxMacros) && finiteRange(nutrients.Fat, 0, maxMacros)
}
func validText(value string, maxRunes int) bool {
	return utf8.ValidString(value) && strings.TrimSpace(value) != "" && utf8.RuneCountInString(value) <= maxRunes && strings.IndexFunc(value, func(character rune) bool {
		return unicode.IsControl(character) && character != '\n' && character != '\t'
	}) < 0
}
