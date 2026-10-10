// Package providers owns encrypted AI settings and bounded external API adapters.
package providers

import (
	"context"
	"net/http"
	"time"
	"training-app/backend/domain"

	"gorm.io/gorm"
)

const (
	MaxImageBytes            = 7_000_000
	MaxImagePixels           = 16_000_000
	MaxQuestionRunes         = 2_000
	DefaultDailyRequestLimit = 20
	MaxDailyRequestLimit     = 500
	maxResponseBytes         = 1_000_000
	maxAnswerBytes           = 16_000
	maxDraftItems            = 20
)

// URLs are server configuration, never fields in an administrator's API request.
// FallbackFoods is searched before online APIs and must be genuine, attributed
// reference data, never preview fixtures. The application uses BundledFoods().
type Options struct {
	DB            *gorm.DB
	EncryptionKey []byte
	HTTPClient    *http.Client
	OpenAIURL     string
	AnthropicURL  string
	OpenRouterURL string
	FoodSearchURL string
	FoodUserAgent string
	FallbackFoods []domain.Food
	Timeout       time.Duration
	Now           func() time.Time
}

type SaveConfigRequest struct {
	Provider          string  `json:"provider"`
	Model             string  `json:"model"`
	Enabled           bool    `json:"enabled"`
	APIKey            *string `json:"apiKey,omitempty"`
	DailyRequestLimit *int    `json:"dailyRequestLimit,omitempty"`
}

type QuestionResult struct {
	Answer  string `json:"answer"`
	Preview bool   `json:"preview"`
}

// Error messages intentionally omit keys, request bodies, and upstream bodies.
type Error struct {
	Status  int
	Code    string
	Message string
}

func (e *Error) Error() string { return e.Message }

func apiError(status int, code, message string) error {
	return &Error{Status: status, Code: code, Message: message}
}

type settingsStore interface {
	Load(context.Context) (Config, error)
	Update(context.Context, func(*Config) error) (Config, error)
	Reserve(context.Context, string, string, int) error
}
