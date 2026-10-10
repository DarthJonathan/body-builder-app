package providers

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
	"training-app/backend/domain"
	"unicode"
	"unicode/utf8"
)

type Service struct {
	store   settingsStore
	aead    cipher.AEAD
	http    *http.Client
	options Options
	slots   chan struct{}
	food    *foodSearch
}

func New(options Options) (*Service, error) {
	if options.DB == nil {
		return nil, errors.New("provider service requires a database")
	}
	return newWithStore(options, gormStore{db: options.DB})
}

func newWithStore(options Options, store settingsStore) (*Service, error) {
	if len(options.EncryptionKey) != 0 && len(options.EncryptionKey) != 32 {
		return nil, errors.New("provider encryption key must contain 32 bytes")
	}
	var aead cipher.AEAD
	if len(options.EncryptionKey) == 32 {
		block, err := aes.NewCipher(options.EncryptionKey)
		if err != nil {
			return nil, err
		}
		aead, err = cipher.NewGCM(block)
		if err != nil {
			return nil, err
		}
	}
	// AES has expanded the key internally; do not retain another raw copy.
	options.EncryptionKey = nil
	if options.Timeout == 0 {
		options.Timeout = 25 * time.Second
	}
	if options.Timeout < time.Millisecond || options.Timeout > 60*time.Second {
		return nil, errors.New("provider timeout must be between one millisecond and sixty seconds")
	}
	if options.Now == nil {
		options.Now = time.Now
	}
	urls := []*string{&options.OpenAIURL, &options.AnthropicURL, &options.OpenRouterURL, &options.FoodSearchURL}
	defaults := []string{"https://api.openai.com/v1/responses", "https://api.anthropic.com/v1/messages", "https://openrouter.ai/api/v1/chat/completions", "https://world.openfoodfacts.org/cgi/search.pl"}
	for index, value := range urls {
		if *value == "" {
			*value = defaults[index]
		}
		parsed, err := url.Parse(*value)
		if err != nil || parsed.Host == "" || parsed.User != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Fragment != "" {
			return nil, errors.New("provider endpoints must be absolute HTTP(S) URLs without credentials or fragments")
		}
	}
	if options.FoodUserAgent == "" {
		options.FoodUserAgent = "BodyBuilder/0.1 (+http://localhost:3000)"
	}
	if strings.ContainsAny(options.FoodUserAgent, "\r\n") {
		return nil, errors.New("food provider User-Agent must be a single line")
	}
	for _, food := range options.FallbackFoods {
		if food.ID == "" || food.Name == "" || food.Serving == "" || food.Source == "" || strings.Contains(strings.ToLower(food.Source), "preview") || !validNutrients(food.Nutrients, 100_000, 10_000) {
			return nil, errors.New("food fallback requires genuine attributed data with complete nutrition values")
		}
	}
	options.FallbackFoods = append([]domain.Food(nil), options.FallbackFoods...)
	client := http.Client{}
	if options.HTTPClient != nil {
		client = *options.HTTPClient
	}
	if client.Timeout == 0 || client.Timeout > options.Timeout {
		client.Timeout = options.Timeout
	}
	// In particular, never forward Anthropic's x-api-key across a redirect.
	client.CheckRedirect = func(_ *http.Request, _ []*http.Request) error { return http.ErrUseLastResponse }
	service := &Service{store: store, aead: aead, http: &client, options: options, slots: make(chan struct{}, 4)}
	service.food = newFoodSearch(service)
	return service, nil
}

func publicConfig(config Config) domain.ProviderConfig {
	return domain.ProviderConfig{Provider: config.Provider, Model: config.Model, Enabled: config.Enabled, Configured: len(config.EncryptedKey) > 0, DailyRequestLimit: config.DailyRequestLimit}
}

func (service *Service) PublicConfig(ctx context.Context) (domain.ProviderConfig, error) {
	config, err := service.store.Load(ctx)
	if err != nil {
		return domain.ProviderConfig{}, storageError(err)
	}
	return publicConfig(config), nil
}

func (service *Service) SaveConfig(ctx context.Context, isAdmin bool, request SaveConfigRequest) (domain.ProviderConfig, error) {
	if !isAdmin {
		return domain.ProviderConfig{}, apiError(http.StatusForbidden, "admin_required", "Only an administrator can change AI provider settings.")
	}
	if service.aead == nil {
		return domain.ProviderConfig{}, apiError(http.StatusServiceUnavailable, "provider_encryption_unavailable", "The server's provider encryption secret is not configured.")
	}
	request.Provider = strings.TrimSpace(request.Provider)
	request.Model = strings.TrimSpace(request.Model)
	if request.Provider != "openai" && request.Provider != "anthropic" && request.Provider != "openrouter" {
		return domain.ProviderConfig{}, apiError(http.StatusBadRequest, "invalid_provider", "Choose OpenAI, Anthropic, or OpenRouter.")
	}
	if !utf8.ValidString(request.Model) || len(request.Model) > 200 || strings.IndexFunc(request.Model, unicode.IsControl) >= 0 || (request.Enabled && request.Model == "") {
		return domain.ProviderConfig{}, apiError(http.StatusBadRequest, "invalid_model", "Enter a model identifier up to 200 characters before enabling the provider.")
	}
	if request.DailyRequestLimit != nil && (*request.DailyRequestLimit < 1 || *request.DailyRequestLimit > MaxDailyRequestLimit) {
		return domain.ProviderConfig{}, apiError(http.StatusBadRequest, "invalid_daily_limit", "The daily per-user AI request limit must be between 1 and 500.")
	}
	var suppliedKey *string
	if request.APIKey != nil {
		trimmed := strings.TrimSpace(*request.APIKey)
		if len(trimmed) > 4_096 || !utf8.ValidString(trimmed) || strings.IndexFunc(trimmed, unicode.IsSpace) >= 0 || strings.IndexFunc(trimmed, unicode.IsControl) >= 0 {
			return domain.ProviderConfig{}, apiError(http.StatusBadRequest, "invalid_api_key", "Enter a valid API key without spaces or line breaks.")
		}
		suppliedKey = &trimmed
	}
	config, err := service.store.Update(ctx, func(config *Config) error {
		if config.Provider != request.Provider {
			config.EncryptedKey = nil
		}
		config.Provider, config.Model, config.Enabled = request.Provider, request.Model, request.Enabled
		if request.DailyRequestLimit != nil {
			config.DailyRequestLimit = *request.DailyRequestLimit
		}
		if suppliedKey != nil {
			if *suppliedKey == "" {
				config.EncryptedKey = nil
			} else {
				if strings.Contains(config.Model, *suppliedKey) {
					return apiError(http.StatusBadRequest, "invalid_model", "The model field must contain a model identifier, not an API key.")
				}
				ciphertext, err := service.encrypt(config.Provider, *suppliedKey)
				if err != nil {
					return err
				}
				config.EncryptedKey = ciphertext
			}
		}
		if config.Enabled && len(config.EncryptedKey) == 0 {
			return apiError(http.StatusBadRequest, "provider_key_required", "Add an API key before enabling this provider.")
		}
		if len(config.EncryptedKey) > 0 {
			retainedKey, err := service.decrypt(*config)
			if err != nil && config.Enabled {
				return err
			}
			if err == nil && strings.Contains(config.Model, retainedKey) {
				return apiError(http.StatusBadRequest, "invalid_model", "The model field must contain a model identifier, not an API key.")
			}
		}
		return nil
	})
	if err != nil {
		return domain.ProviderConfig{}, storageError(err)
	}
	return publicConfig(config), nil
}

func (service *Service) encrypt(provider, key string) ([]byte, error) {
	nonce := make([]byte, service.aead.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return nil, apiError(http.StatusInternalServerError, "provider_encryption_failed", "The provider key could not be encrypted.")
	}
	return service.aead.Seal(nonce, nonce, []byte(key), []byte("bodybuilder/provider/"+provider)), nil
}

func (service *Service) decrypt(config Config) (string, error) {
	if service.aead == nil || len(config.EncryptedKey) < service.aead.NonceSize()+service.aead.Overhead() {
		return "", apiError(http.StatusServiceUnavailable, "provider_key_unavailable", "The provider key is unavailable. Ask an administrator to replace it.")
	}
	nonce := config.EncryptedKey[:service.aead.NonceSize()]
	plaintext, err := service.aead.Open(nil, nonce, config.EncryptedKey[service.aead.NonceSize():], []byte("bodybuilder/provider/"+config.Provider))
	if err != nil {
		return "", apiError(http.StatusServiceUnavailable, "provider_key_unavailable", "The provider key could not be decrypted. Ask an administrator to replace it.")
	}
	return string(plaintext), nil
}

func storageError(err error) error {
	var providerError *Error
	if errors.As(err, &providerError) {
		return err
	}
	return apiError(http.StatusServiceUnavailable, "provider_storage_unavailable", "AI provider settings are temporarily unavailable.")
}

func (service *Service) preparedConfig(ctx context.Context, userID string) (Config, string, error) {
	if strings.TrimSpace(userID) == "" || len(userID) > 128 {
		return Config{}, "", apiError(http.StatusUnauthorized, "authentication_required", "Sign in to use the assistant.")
	}
	config, err := service.store.Load(ctx)
	if err != nil {
		return Config{}, "", storageError(err)
	}
	if !config.Enabled || config.Model == "" || len(config.EncryptedKey) == 0 {
		return Config{}, "", apiError(http.StatusServiceUnavailable, "provider_not_configured", "The assistant is not configured. An administrator can add a provider API key and model.")
	}
	key, err := service.decrypt(config)
	if err != nil {
		return Config{}, "", err
	}
	return config, key, nil
}

func (service *Service) reserve(ctx context.Context, userID string, config Config) error {
	limit := config.DailyRequestLimit
	if limit < 1 || limit > MaxDailyRequestLimit {
		return apiError(http.StatusServiceUnavailable, "invalid_provider_limit", "The configured AI request limit needs an administrator's attention.")
	}
	return storageErrorOrNil(service.store.Reserve(ctx, userID, service.options.Now().UTC().Format("2006-01-02"), limit))
}

func storageErrorOrNil(err error) error {
	if err == nil {
		return nil
	}
	return storageError(err)
}

func (service *Service) acquire(ctx context.Context) error {
	select {
	case service.slots <- struct{}{}:
		return nil
	case <-ctx.Done():
		return apiError(http.StatusGatewayTimeout, "provider_timeout", "The assistant is busy or took too long. Please try again.")
	}
}

func (service *Service) Ask(ctx context.Context, userID, question string) (QuestionResult, error) {
	question = strings.TrimSpace(question)
	if !utf8.ValidString(question) || question == "" || utf8.RuneCountInString(question) > MaxQuestionRunes {
		return QuestionResult{}, apiError(http.StatusBadRequest, "invalid_question", "Enter a question between 1 and 2000 characters.")
	}
	ctx, cancel := context.WithTimeout(ctx, service.options.Timeout)
	defer cancel()
	if err := service.acquire(ctx); err != nil {
		return QuestionResult{}, err
	}
	defer func() { <-service.slots }()
	config, key, err := service.preparedConfig(ctx, userID)
	if err != nil {
		return QuestionResult{}, err
	}
	if err = service.reserve(ctx, userID, config); err != nil {
		return QuestionResult{}, err
	}
	answer, err := service.requestAI(ctx, config, key, question, nil, "", false)
	if err != nil {
		return QuestionResult{}, err
	}
	return QuestionResult{Answer: answer, Preview: false}, nil
}

func (service *Service) TestConfig(ctx context.Context, userID string, isAdmin bool) (QuestionResult, error) {
	if !isAdmin {
		return QuestionResult{}, apiError(http.StatusForbidden, "admin_required", "Only an administrator can test AI provider settings.")
	}
	return service.Ask(ctx, userID, "Reply briefly that the API connection is working.")
}

func (service *Service) EstimateMeal(ctx context.Context, userID string, data []byte, declaredMIME string) (domain.MealEstimate, error) {
	ctx, cancel := context.WithTimeout(ctx, service.options.Timeout)
	defer cancel()
	if err := service.acquire(ctx); err != nil {
		return domain.MealEstimate{}, err
	}
	defer func() { <-service.slots }()
	photo, mime, err := validatePhoto(data, declaredMIME)
	if err != nil {
		return domain.MealEstimate{}, err
	}
	config, key, err := service.preparedConfig(ctx, userID)
	if err != nil {
		return domain.MealEstimate{}, err
	}
	if err = service.reserve(ctx, userID, config); err != nil {
		return domain.MealEstimate{}, err
	}
	answer, err := service.requestAI(ctx, config, key, mealPrompt, photo, mime, true)
	if err != nil {
		return domain.MealEstimate{}, err
	}
	return parseMeal(answer)
}
