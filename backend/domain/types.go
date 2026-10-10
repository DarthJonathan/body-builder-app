// Package domain contains the versioned API records shared with the frontend.
package domain

import "encoding/json"

type Nutrients struct {
	Calories float64 `json:"calories"`
	Protein  float64 `json:"protein"`
	Carbs    float64 `json:"carbs"`
	Fat      float64 `json:"fat"`
}

type Profile struct {
	ID            string  `json:"id"`
	DisplayName   string  `json:"displayName"`
	Email         string  `json:"email"`
	Timezone      string  `json:"timezone"`
	Unit          string  `json:"unit"`
	Goal          string  `json:"goal"`
	StartWeight   float64 `json:"startWeight"`
	GoalStartedAt string  `json:"goalStartedAt"`
	Role          string  `json:"role"`
}

type Muscle struct {
	ID         string   `json:"id"`
	Name       string   `json:"name"`
	Image      string   `json:"image"`
	Percentage *float64 `json:"percentage,omitempty"`
}
type Exercise struct {
	ID           string   `json:"id"`
	Name         string   `json:"name"`
	Image        string   `json:"image"`
	Muscles      []string `json:"muscles"`
	Equipment    string   `json:"equipment"`
	Instructions []string `json:"instructions"`
	Source       string   `json:"source,omitempty"`
	SourceName   string   `json:"sourceName,omitempty"`
	SourceNote   string   `json:"sourceNote,omitempty"`
	Weighted     bool     `json:"weighted"`
}
type Prescription struct {
	ID          string `json:"id"`
	ExerciseID  string `json:"exerciseId"`
	Sets        int    `json:"sets"`
	RepsMin     int    `json:"repsMin"`
	RepsMax     int    `json:"repsMax"`
	PerSide     bool   `json:"perSide,omitempty"`
	Seconds     bool   `json:"seconds,omitempty"`
	AMRAPLast   bool   `json:"amrapLast,omitempty"`
	RestSeconds int    `json:"restSeconds"`
	Superset    string `json:"superset,omitempty"`
}
type Workout struct {
	ID        string         `json:"id"`
	Name      string         `json:"name"`
	Muscles   []Muscle       `json:"muscles"`
	Exercises []Prescription `json:"exercises"`
	Warmup    []string       `json:"warmup"`
}
type Program struct {
	ID               string    `json:"id"`
	Name             string    `json:"name"`
	Level            string    `json:"level"`
	Goal             string    `json:"goal"`
	Workouts         []Workout `json:"workouts"`
	Source           string    `json:"source,omitempty"`
	SourceName       string    `json:"sourceName,omitempty"`
	SourceReviewedAt string    `json:"sourceReviewedAt,omitempty"`
	AdaptationNote   string    `json:"adaptationNote,omitempty"`
}
type ProgramTemplate struct {
	Program
	Description string `json:"description"`
	DaysPerWeek int    `json:"daysPerWeek"`
	Equipment   string `json:"equipment"`
}
type ScheduleEntry struct {
	ID        string  `json:"id"`
	Date      string  `json:"date"`
	WorkoutID *string `json:"workoutId"`
}
type LoggedSet struct {
	ID        string  `json:"id"`
	Weight    float64 `json:"weight"`
	Reps      int     `json:"reps"`
	Effort    *string `json:"effort"`
	Completed bool    `json:"completed"`
}
type SessionExercise struct {
	ID           string       `json:"id"`
	ExerciseID   string       `json:"exerciseId"`
	Prescription Prescription `json:"prescription"`
	Notes        string       `json:"notes"`
	Sets         []LoggedSet  `json:"sets"`
}
type WorkoutSession struct {
	ID           string            `json:"id"`
	WorkoutID    string            `json:"workoutId"`
	Name         string            `json:"name"`
	Date         string            `json:"date"`
	StartedAt    string            `json:"startedAt"`
	FinishedAt   *string           `json:"finishedAt"`
	Exercises    []SessionExercise `json:"exercises"`
	RestDeadline *string           `json:"restDeadline"`
	RestDuration int               `json:"restDuration"`
}
type Food struct {
	Nutrients
	ID      string `json:"id"`
	Name    string `json:"name"`
	Serving string `json:"serving"`
	Source  string `json:"source"`
}
type FoodEntry struct {
	Nutrients
	ID             string  `json:"id"`
	FoodID         string  `json:"foodId,omitempty"`
	Name           string  `json:"name"`
	Date           string  `json:"date"`
	Meal           string  `json:"meal"`
	Quantity       float64 `json:"quantity"`
	Serving        string  `json:"serving"`
	Source         string  `json:"source"`
	DatabaseSource string  `json:"databaseSource,omitempty"`
}
type NutritionTargets struct {
	Nutrients
	ID                 string                `json:"id"`
	EffectiveDate      string                `json:"effectiveDate"`
	Mode               string                `json:"mode"`
	ManuallyOverridden bool                  `json:"manuallyOverridden"`
	Calculation        *NutritionCalculation `json:"calculation,omitempty"`
}

type TargetCalculation struct {
	Age               int     `json:"age"`
	Sex               string  `json:"sex"`
	HeightCM          float64 `json:"heightCm"`
	WeightKG          float64 `json:"weightKg"`
	Activity          string  `json:"activity"`
	Goal              string  `json:"goal"`
	EffectiveDate     string  `json:"effectiveDate"`
	CalorieAdjustment float64 `json:"calorieAdjustment"`
	ProteinPerKG      float64 `json:"proteinPerKg"`
	FatPercent        float64 `json:"fatPercent"`
}

type NutritionCalculation struct {
	Version             string            `json:"version"`
	Input               TargetCalculation `json:"input"`
	RestingCalories     float64           `json:"restingCalories"`
	MaintenanceCalories float64           `json:"maintenanceCalories"`
}
type CheckIn struct {
	ID     string  `json:"id"`
	Date   string  `json:"date"`
	Weight float64 `json:"weight"`
	Notes  string  `json:"notes"`
}
type WeightEntry struct {
	ID     string  `json:"id"`
	Date   string  `json:"date"`
	Weight float64 `json:"weight"`
}
type Lesson struct {
	ID        string `json:"id"`
	Title     string `json:"title"`
	URL       string `json:"url"`
	Notes     string `json:"notes"`
	Category  string `json:"category"`
	Source    string `json:"source"`
	Completed bool   `json:"completed"`
	SavedAt   string `json:"savedAt"`
}
type ProviderConfig struct {
	Provider          string `json:"provider"`
	Model             string `json:"model"`
	Enabled           bool   `json:"enabled"`
	Configured        bool   `json:"configured"`
	DailyRequestLimit int    `json:"dailyRequestLimit,omitempty"`
}
type MealItem struct {
	Nutrients
	Name     string  `json:"name"`
	Quantity float64 `json:"quantity"`
	Serving  string  `json:"serving"`
}
type MealEstimate struct {
	Items       []MealItem `json:"items"`
	Assumptions string     `json:"assumptions"`
	Preview     bool       `json:"preview"`
}
type AppSnapshot struct {
	Revision        int64              `json:"revision"`
	Profile         Profile            `json:"profile"`
	Programs        []Program          `json:"programs"`
	ActiveProgramID string             `json:"activeProgramId"`
	Schedule        []ScheduleEntry    `json:"schedule"`
	Sessions        []WorkoutSession   `json:"sessions"`
	FoodEntries     []FoodEntry        `json:"foodEntries"`
	Targets         []NutritionTargets `json:"targets"`
	CheckIns        []CheckIn          `json:"checkIns"`
	Weights         []WeightEntry      `json:"weights"`
	Lessons         []Lesson           `json:"lessons"`
	Provider        ProviderConfig     `json:"provider"`
}
type Mutation struct {
	ID           string          `json:"id"`
	BaseRevision int64           `json:"baseRevision"`
	Operation    string          `json:"operation"`
	Payload      json.RawMessage `json:"payload"`
}
