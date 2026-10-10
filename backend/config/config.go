package config

import (
	"encoding/base64"
	"errors"
	"os"
	"regexp"
	"strconv"
	"strings"
)

type Config struct {
	Port                  string
	Host                  string
	DatabaseURL           string
	Schema                string
	JWTSecret             string
	TokenExpiryHours      int
	ProviderEncryptionKey []byte
	OpenAIURL             string
	AnthropicURL          string
	OpenRouterURL         string
	FoodSearchURL         string
	AuthRateLimit         int
}

func Load() (Config, error) {
	cfg := Config{
		Port:             value("PORT", "8081"),
		Host:             value("API_HOST", "127.0.0.1"),
		DatabaseURL:      strings.TrimSpace(os.Getenv("DATABASE_URL")),
		Schema:           value("DB_SCHEMA", "training"),
		JWTSecret:        os.Getenv("JWT_SECRET"),
		TokenExpiryHours: 168,
		OpenAIURL:        strings.TrimSpace(os.Getenv("OPENAI_API_URL")),
		AnthropicURL:     strings.TrimSpace(os.Getenv("ANTHROPIC_API_URL")),
		OpenRouterURL:    strings.TrimSpace(os.Getenv("OPENROUTER_API_URL")),
		FoodSearchURL:    strings.TrimSpace(os.Getenv("FOOD_SEARCH_URL")),
		AuthRateLimit:    60,
	}
	if cfg.DatabaseURL == "" {
		return cfg, errors.New("DATABASE_URL is required")
	}
	if !regexp.MustCompile(`^[a-z][a-z0-9_]*$`).MatchString(cfg.Schema) {
		return cfg, errors.New("DB_SCHEMA must contain lowercase letters, numbers and underscores")
	}
	if len(cfg.JWTSecret) < 32 {
		return cfg, errors.New("JWT_SECRET must contain at least 32 characters")
	}
	if raw := strings.TrimSpace(os.Getenv("PROVIDER_ENCRYPTION_KEY")); raw != "" {
		key, err := base64.StdEncoding.DecodeString(raw)
		if err != nil || len(key) != 32 {
			return cfg, errors.New("PROVIDER_ENCRYPTION_KEY must be a base64-encoded 32-byte key")
		}
		cfg.ProviderEncryptionKey = key
	}
	if raw := os.Getenv("JWT_TOKEN_EXPIRY_HOURS"); raw != "" {
		hours, err := strconv.Atoi(raw)
		if err != nil || hours < 1 || hours > 720 {
			return cfg, errors.New("JWT_TOKEN_EXPIRY_HOURS must be between 1 and 720")
		}
		cfg.TokenExpiryHours = hours
	}
	return cfg, nil
}

func value(key, fallback string) string {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		return v
	}
	return fallback
}
