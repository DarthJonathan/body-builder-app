package providers

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"errors"
	"hash/crc32"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// This test store models atomic settings replacement and quota reservations.
// Router integration tests exercise the same service with real PostgreSQL.
type memoryStore struct {
	mutex  sync.Mutex
	config Config
	usage  map[string]int
}

func newMemoryStore() *memoryStore {
	return &memoryStore{config: defaultConfig(), usage: make(map[string]int)}
}
func cloneConfig(config Config) Config {
	config.EncryptedKey = append([]byte(nil), config.EncryptedKey...)
	return config
}
func (store *memoryStore) Load(context.Context) (Config, error) {
	store.mutex.Lock()
	defer store.mutex.Unlock()
	return cloneConfig(store.config), nil
}
func (store *memoryStore) Update(_ context.Context, apply func(*Config) error) (Config, error) {
	store.mutex.Lock()
	defer store.mutex.Unlock()
	config := cloneConfig(store.config)
	if err := apply(&config); err != nil {
		return Config{}, err
	}
	store.config = cloneConfig(config)
	return cloneConfig(config), nil
}
func (store *memoryStore) Reserve(_ context.Context, userID, day string, limit int) error {
	store.mutex.Lock()
	defer store.mutex.Unlock()
	key := userID + "/" + day
	if store.usage[key] >= limit {
		return apiError(429, "daily_ai_limit", "Daily limit reached.")
	}
	store.usage[key]++
	return nil
}
func (store *memoryStore) requestCount() int {
	store.mutex.Lock()
	defer store.mutex.Unlock()
	total := 0
	for _, count := range store.usage {
		total += count
	}
	return total
}

func textPointer(value string) *string { return &value }
func integerPointer(value int) *int    { return &value }

func newTestService(t *testing.T, store *memoryStore, endpoint string, configure func(*Options)) *Service {
	t.Helper()
	options := Options{EncryptionKey: bytes.Repeat([]byte{42}, 32), OpenAIURL: endpoint, AnthropicURL: endpoint, OpenRouterURL: endpoint, FoodSearchURL: endpoint, Timeout: time.Second}
	if configure != nil {
		configure(&options)
	}
	service, err := newWithStore(options, store)
	if err != nil {
		t.Fatalf("construct service: %v", err)
	}
	return service
}

func enableProvider(t *testing.T, service *Service, provider string, limit int) {
	t.Helper()
	_, err := service.SaveConfig(context.Background(), true, SaveConfigRequest{Provider: provider, Model: "fixture-model", Enabled: true, APIKey: textPointer("fake-test-secret"), DailyRequestLimit: integerPointer(limit)})
	if err != nil {
		t.Fatalf("save config: %v", err)
	}
}

func requireCode(t *testing.T, err error, code string, status int) {
	t.Helper()
	var failure *Error
	if !errors.As(err, &failure) {
		t.Fatalf("wanted %s, got %v", code, err)
	}
	if failure.Code != code || failure.Status != status {
		t.Fatalf("wanted %s/%d, got %#v", code, status, failure)
	}
	if strings.Contains(failure.Message, "fake-test-secret") {
		t.Fatal("provider error exposed its API key")
	}
}

func TestSettingsAreEncryptedRestrictedAndNeverReturned(t *testing.T) {
	store := newMemoryStore()
	service := newTestService(t, store, "http://example.test/api", nil)
	initial, err := service.PublicConfig(context.Background())
	if err != nil || initial.Enabled || initial.Configured || initial.DailyRequestLimit != 20 {
		t.Fatalf("unexpected initial public settings: %#v, %v", initial, err)
	}
	request := SaveConfigRequest{Provider: "openai", Model: "fixture-model", Enabled: true, APIKey: textPointer("fake-test-secret"), DailyRequestLimit: integerPointer(5)}
	_, err = service.SaveConfig(context.Background(), false, request)
	requireCode(t, err, "admin_required", 403)
	_, err = service.TestConfig(context.Background(), "normal-user", false)
	requireCode(t, err, "admin_required", 403)
	configured, err := service.SaveConfig(context.Background(), true, request)
	if err != nil || !configured.Enabled || !configured.Configured || configured.DailyRequestLimit != 5 {
		t.Fatalf("unexpected configured settings: %#v, %v", configured, err)
	}
	stored, _ := store.Load(context.Background())
	firstCiphertext := append([]byte(nil), stored.EncryptedKey...)
	if bytes.Contains(firstCiphertext, []byte("fake-test-secret")) || len(firstCiphertext) <= len("fake-test-secret") {
		t.Fatal("stored provider key is not encrypted")
	}
	key, err := service.decrypt(stored)
	if err != nil || key != "fake-test-secret" {
		t.Fatal("encrypted key did not round-trip")
	}
	publicJSON, _ := json.Marshal(configured)
	persistenceJSON, _ := json.Marshal(stored)
	if bytes.Contains(publicJSON, []byte("fake-test-secret")) || bytes.Contains(publicJSON, []byte("apiKey")) || string(persistenceJSON) != "{}" {
		t.Fatalf("provider persistence leaked into an API view: %s / %s", publicJSON, persistenceJSON)
	}
	_, err = service.SaveConfig(context.Background(), true, request)
	if err != nil {
		t.Fatal(err)
	}
	stored, _ = store.Load(context.Background())
	if bytes.Equal(firstCiphertext, stored.EncryptedKey) {
		t.Fatal("saving the same key reused an encryption nonce")
	}
	retainedCiphertext := append([]byte(nil), stored.EncryptedKey...)
	request.APIKey = nil
	request.Model = "second-model"
	_, err = service.SaveConfig(context.Background(), true, request)
	stored, _ = store.Load(context.Background())
	if err != nil || !bytes.Equal(stored.EncryptedKey, retainedCiphertext) {
		t.Fatal("editing settings without a key must retain the saved key")
	}
	request.Model = "model-fake-test-secret"
	_, err = service.SaveConfig(context.Background(), true, request)
	requireCode(t, err, "invalid_model", 400)
	unchanged, _ := store.Load(context.Background())
	if unchanged.Model != "second-model" {
		t.Fatal("rejected settings changed stored configuration")
	}
	request.Provider, request.Model = "anthropic", "new-model"
	_, err = service.SaveConfig(context.Background(), true, request)
	requireCode(t, err, "provider_key_required", 400)
	unchanged, _ = store.Load(context.Background())
	if unchanged.Provider != "openai" {
		t.Fatal("failed provider switch changed stored provider")
	}
	request.Enabled = false
	disabled, err := service.SaveConfig(context.Background(), true, request)
	if err != nil || disabled.Configured {
		t.Fatal("changing provider retained another provider's key")
	}
}

func TestKeyTamperingRotationAndMissingServerSecret(t *testing.T) {
	store := newMemoryStore()
	service := newTestService(t, store, "http://example.test/api", nil)
	enableProvider(t, service, "openai", 20)
	store.config.EncryptedKey[len(store.config.EncryptedKey)-1] ^= 1
	_, err := service.Ask(context.Background(), "user", "How should I warm up?")
	requireCode(t, err, "provider_key_unavailable", 503)
	if store.requestCount() != 0 {
		t.Fatal("an undecryptable key consumed an AI request")
	}
	enableProvider(t, service, "openai", 20)
	rotated := newTestService(t, store, "http://example.test/api", func(options *Options) { options.EncryptionKey = bytes.Repeat([]byte{17}, 32) })
	_, err = rotated.Ask(context.Background(), "user", "How should I warm up?")
	requireCode(t, err, "provider_key_unavailable", 503)
	_, err = newWithStore(Options{EncryptionKey: []byte("short")}, store)
	if err == nil {
		t.Fatal("invalid encryption-secret length was accepted")
	}
	missing := newTestService(t, newMemoryStore(), "http://example.test/api", func(options *Options) { options.EncryptionKey = nil })
	public, err := missing.PublicConfig(context.Background())
	if err != nil || public.Enabled || public.Configured {
		t.Fatal("an unconfigured installation must expose disabled status")
	}
	_, err = missing.SaveConfig(context.Background(), true, SaveConfigRequest{Provider: "openai"})
	requireCode(t, err, "provider_encryption_unavailable", 503)
}

func TestSettingsValidationIsAtomic(t *testing.T) {
	store := newMemoryStore()
	service := newTestService(t, store, "http://example.test/api", nil)
	cases := []struct {
		name  string
		input SaveConfigRequest
		code  string
	}{
		{"unknown provider", SaveConfigRequest{Provider: "other"}, "invalid_provider"},
		{"missing model", SaveConfigRequest{Provider: "openai", Enabled: true, APIKey: textPointer("fake-test-secret")}, "invalid_model"},
		{"control character", SaveConfigRequest{Provider: "openai", Model: "mod\nel"}, "invalid_model"},
		{"zero limit", SaveConfigRequest{Provider: "openai", DailyRequestLimit: integerPointer(0)}, "invalid_daily_limit"},
		{"oversized limit", SaveConfigRequest{Provider: "openai", DailyRequestLimit: integerPointer(501)}, "invalid_daily_limit"},
		{"spaced key", SaveConfigRequest{Provider: "openai", APIKey: textPointer("fake test secret")}, "invalid_api_key"},
		{"enabled without key", SaveConfigRequest{Provider: "openai", Model: "fixture-model", Enabled: true}, "provider_key_required"},
	}
	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			_, err := service.SaveConfig(context.Background(), true, test.input)
			requireCode(t, err, test.code, 400)
			public, _ := service.PublicConfig(context.Background())
			if public.Configured || public.Enabled || public.Model != "" {
				t.Fatal("rejected input changed settings")
			}
		})
	}
}

func providerEnvelope(provider, answer string) map[string]any {
	switch provider {
	case "openai":
		return map[string]any{"status": "completed", "output": []any{map[string]any{"type": "message", "content": []any{map[string]any{"type": "output_text", "text": answer}}}}}
	case "anthropic":
		return map[string]any{"stop_reason": "end_turn", "content": []any{map[string]any{"type": "text", "text": answer}}}
	default:
		return map[string]any{"choices": []any{map[string]any{"finish_reason": "stop", "message": map[string]any{"content": answer}}}}
	}
}

const sampleMeal = `{"items":[{"name":"Rice and beans","quantity":1,"serving":"bowl","calories":420,"protein":16,"carbs":72,"fat":8}],"assumptions":"Assumes a medium bowl; portion size and oil are uncertain."}`

func TestAllProviderAdaptersAskAndReturnReviewedMealDrafts(t *testing.T) {
	for _, provider := range []string{"openai", "anthropic", "openrouter"} {
		t.Run(provider, func(t *testing.T) {
			var requests []map[string]any
			var requestMutex sync.Mutex
			server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
				if request.Method != http.MethodPost || request.Header.Get("Content-Type") != "application/json" {
					t.Error("AI request was not JSON POST")
				}
				if provider == "anthropic" {
					if request.Header.Get("x-api-key") != "fake-test-secret" || request.Header.Get("anthropic-version") != "2023-06-01" || request.Header.Get("Authorization") != "" {
						t.Error("Anthropic authentication/version headers are incorrect")
					}
				} else if request.Header.Get("Authorization") != "Bearer fake-test-secret" {
					t.Error("bearer authentication header is incorrect")
				}
				var payload map[string]any
				if err := json.NewDecoder(request.Body).Decode(&payload); err != nil {
					t.Error(err)
					writer.WriteHeader(400)
					return
				}
				if payload["model"] != "fixture-model" {
					t.Error("administrator's model was not forwarded")
				}
				requestMutex.Lock()
				requests = append(requests, payload)
				position := len(requests)
				requestMutex.Unlock()
				answer := "Warm up with light sets before working sets."
				if position == 2 {
					answer = sampleMeal
				}
				writer.Header().Set("Content-Type", "application/json")
				json.NewEncoder(writer).Encode(providerEnvelope(provider, answer))
			}))
			defer server.Close()
			store := newMemoryStore()
			service := newTestService(t, store, server.URL, nil)
			enableProvider(t, service, provider, 20)
			result, err := service.Ask(context.Background(), "user", "How should I warm up?")
			if err != nil || result.Answer != "Warm up with light sets before working sets." || result.Preview {
				t.Fatalf("bad answer: %#v, %v", result, err)
			}
			photo := tinyPNG(t)
			estimate, err := service.EstimateMeal(context.Background(), "user", photo, "image/png")
			if err != nil || estimate.Preview || len(estimate.Items) != 1 || estimate.Items[0].Calories != 420 || estimate.Items[0].Quantity != 1 || !strings.Contains(estimate.Assumptions, "uncertain") {
				t.Fatalf("bad nutrition draft: %#v, %v", estimate, err)
			}
			if store.requestCount() != 2 {
				t.Fatal("successful requests were not counted")
			}
			requestMutex.Lock()
			questionPayload, mealPayload := requests[0], requests[1]
			requestMutex.Unlock()
			serializedQuestion, _ := json.Marshal(questionPayload)
			if bytes.Contains(serializedQuestion, []byte("fake-test-secret")) || bytes.Contains(serializedQuestion, []byte(`"userId"`)) || bytes.Contains(serializedQuestion, []byte(`"snapshot"`)) {
				t.Fatal("private data or credentials appeared in the question body")
			}
			assertMealRequest(t, provider, mealPayload, photo)
			// The service has no training-document writer. A meal request must leave
			// only a usage counter and configuration in its persistence boundary.
			stored, _ := store.Load(context.Background())
			if stored.Model != "fixture-model" {
				t.Fatal("meal estimates unexpectedly changed settings")
			}
		})
	}
}

func assertMealRequest(t *testing.T, provider string, payload map[string]any, original []byte) {
	t.Helper()
	var content []any
	var encodedPhoto string
	switch provider {
	case "openai":
		if payload["store"] != false || payload["max_output_tokens"].(float64) > 2_400 {
			t.Fatal("OpenAI storage/output bounds were not set")
		}
		format := payload["text"].(map[string]any)["format"].(map[string]any)
		if format["type"] != "json_schema" || format["strict"] != true {
			t.Fatal("OpenAI structured output is missing")
		}
		content = payload["input"].([]any)[0].(map[string]any)["content"].([]any)
		image := content[1].(map[string]any)
		if image["type"] != "input_image" {
			t.Fatal("OpenAI image content type is incorrect")
		}
		encodedPhoto = strings.TrimPrefix(image["image_url"].(string), "data:image/png;base64,")
	case "anthropic":
		if payload["max_tokens"].(float64) > 2_400 {
			t.Fatal("Anthropic output bound is missing")
		}
		format := payload["output_config"].(map[string]any)["format"].(map[string]any)
		if format["type"] != "json_schema" {
			t.Fatal("Anthropic structured output is missing")
		}
		content = payload["messages"].([]any)[0].(map[string]any)["content"].([]any)
		image := content[0].(map[string]any)
		source := image["source"].(map[string]any)
		if image["type"] != "image" || source["type"] != "base64" || source["media_type"] != "image/png" {
			t.Fatal("Anthropic image content is incorrect")
		}
		encodedPhoto = source["data"].(string)
	case "openrouter":
		format := payload["response_format"].(map[string]any)
		if format["type"] != "json_schema" || format["json_schema"].(map[string]any)["strict"] != true || payload["provider"].(map[string]any)["require_parameters"] != true {
			t.Fatal("OpenRouter schema-compatible routing is missing")
		}
		content = payload["messages"].([]any)[1].(map[string]any)["content"].([]any)
		image := content[1].(map[string]any)
		if image["type"] != "image_url" {
			t.Fatal("OpenRouter image content type is incorrect")
		}
		encodedPhoto = strings.TrimPrefix(image["image_url"].(map[string]any)["url"].(string), "data:image/png;base64,")
	}
	decoded, err := base64.StdEncoding.DecodeString(encodedPhoto)
	if err != nil {
		t.Fatal("provider photo was not base64")
	}
	actual, _, err := image.Decode(bytes.NewReader(decoded))
	if err != nil || actual.Bounds().Dx() != 2 || actual.Bounds().Dy() != 2 {
		t.Fatal("provider photo could not be decoded")
	}
	if !bytes.Equal(decoded, original) {
		originalImage, _, err := image.Decode(bytes.NewReader(original))
		if err != nil || originalImage.At(0, 0) != actual.At(0, 0) {
			t.Fatal("photo processing changed image pixels")
		}
	}
}

func TestQuestionValidationDoesNotUseQuotaOrMakePaidRequests(t *testing.T) {
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { calls.Add(1) }))
	defer server.Close()
	store := newMemoryStore()
	service := newTestService(t, store, server.URL, nil)
	_, err := service.Ask(context.Background(), "user", "How should I warm up?")
	requireCode(t, err, "provider_not_configured", 503)
	enableProvider(t, service, "openai", 20)
	for _, question := range []string{"", " \n ", strings.Repeat("x", 2_001), string([]byte{0xff})} {
		_, err := service.Ask(context.Background(), "user", question)
		requireCode(t, err, "invalid_question", 400)
	}
	_, err = service.Ask(context.Background(), "", "Valid question")
	requireCode(t, err, "authentication_required", 401)
	if calls.Load() != 0 || store.requestCount() != 0 {
		t.Fatal("invalid input or disabled configuration consumed a request")
	}
}

func TestDailyQuotaIsPerUserAtomicPersistentAndResetsUTC(t *testing.T) {
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		calls.Add(1)
		json.NewEncoder(writer).Encode(providerEnvelope("openai", "Useful answer"))
	}))
	defer server.Close()
	store := newMemoryStore()
	clock := time.Date(2026, 10, 9, 23, 59, 0, 0, time.UTC)
	service := newTestService(t, store, server.URL, func(options *Options) { options.Now = func() time.Time { return clock } })
	enableProvider(t, service, "openai", 2)
	var wait sync.WaitGroup
	var successes atomic.Int32
	var quotaFailures atomic.Int32
	for index := 0; index < 8; index++ {
		wait.Add(1)
		go func() {
			defer wait.Done()
			_, err := service.Ask(context.Background(), "nathan", "How should I warm up?")
			if err == nil {
				successes.Add(1)
				return
			}
			var failure *Error
			if errors.As(err, &failure) && failure.Code == "daily_ai_limit" {
				quotaFailures.Add(1)
			} else {
				t.Errorf("unexpected concurrent error: %v", err)
			}
		}()
	}
	wait.Wait()
	if successes.Load() != 2 || quotaFailures.Load() != 6 || calls.Load() != 2 {
		t.Fatalf("quota was not atomic: success=%d quota=%d upstream=%d", successes.Load(), quotaFailures.Load(), calls.Load())
	}
	_, err := service.Ask(context.Background(), "ivana", "How should I warm up?")
	if err != nil {
		t.Fatal("another user's allowance was consumed")
	}
	restarted := newTestService(t, store, server.URL, func(options *Options) { options.Now = func() time.Time { return clock } })
	_, err = restarted.Ask(context.Background(), "nathan", "How should I warm up?")
	requireCode(t, err, "daily_ai_limit", 429)
	clock = clock.Add(2 * time.Minute)
	_, err = restarted.Ask(context.Background(), "nathan", "How should I warm up?")
	if err != nil {
		t.Fatal("quota did not reset at midnight UTC")
	}
	if calls.Load() != 4 {
		t.Fatalf("unexpected paid request count: %d", calls.Load())
	}
}

func TestProviderFailuresAreBoundedAndCredentialsAreRedacted(t *testing.T) {
	cases := []struct {
		name           string
		status         int
		response       string
		code           string
		expectedStatus int
	}{
		{"bad credentials", 401, `{"error":"fake-test-secret"}`, "provider_authentication_failed", 502},
		{"upstream limit", 429, `{"error":"fake-test-secret"}`, "provider_rate_limited", 429},
		{"unsupported model", 400, `{"error":"fake-test-secret"}`, "provider_configuration_error", 502},
		{"unavailable", 500, `{"error":"fake-test-secret"}`, "provider_unavailable", 502},
		{"malformed response", 200, `not json fake-test-secret`, "invalid_provider_output", 502},
		{"incomplete output", 200, `{"status":"incomplete","output":[]}`, "invalid_provider_output", 502},
		{"refusal", 200, `{"status":"completed","output":[{"type":"message","content":[{"type":"refusal","refusal":"No"}]}]}`, "provider_refusal", 422},
		{"oversized body", 200, strings.Repeat("x", maxResponseBytes+1), "invalid_provider_output", 502},
	}
	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
				writer.WriteHeader(test.status)
				io.WriteString(writer, test.response)
			}))
			defer server.Close()
			service := newTestService(t, newMemoryStore(), server.URL, nil)
			enableProvider(t, service, "openai", 20)
			_, err := service.Ask(context.Background(), "user", "Question")
			requireCode(t, err, test.code, test.expectedStatus)
		})
	}
	t.Run("successful response cannot echo key", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
			json.NewEncoder(writer).Encode(providerEnvelope("openai", "A fake-test-secret echoed by a proxy"))
		}))
		defer server.Close()
		service := newTestService(t, newMemoryStore(), server.URL, nil)
		enableProvider(t, service, "openai", 20)
		result, err := service.Ask(context.Background(), "user", "Question")
		if err != nil || strings.Contains(result.Answer, "fake-test-secret") || !strings.Contains(result.Answer, "[redacted]") {
			t.Fatalf("key echoed in answer: %#v, %v", result, err)
		}
	})
	t.Run("oversized extracted answer", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
			json.NewEncoder(writer).Encode(providerEnvelope("openai", strings.Repeat("x", maxAnswerBytes+1)))
		}))
		defer server.Close()
		service := newTestService(t, newMemoryStore(), server.URL, nil)
		enableProvider(t, service, "openai", 20)
		_, err := service.Ask(context.Background(), "user", "Question")
		requireCode(t, err, "invalid_provider_output", 502)
	})
	t.Run("timeout", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
			time.Sleep(80 * time.Millisecond)
			json.NewEncoder(writer).Encode(providerEnvelope("openai", "Late answer"))
		}))
		defer server.Close()
		service := newTestService(t, newMemoryStore(), server.URL, func(options *Options) { options.Timeout = 10 * time.Millisecond })
		enableProvider(t, service, "openai", 20)
		_, err := service.Ask(context.Background(), "user", "Question")
		requireCode(t, err, "provider_timeout", 504)
	})
	t.Run("redirect does not forward secrets", func(t *testing.T) {
		var downstreamCalls atomic.Int32
		downstream := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { downstreamCalls.Add(1) }))
		defer downstream.Close()
		server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
			http.Redirect(writer, request, downstream.URL, 307)
		}))
		defer server.Close()
		service := newTestService(t, newMemoryStore(), server.URL, nil)
		enableProvider(t, service, "anthropic", 20)
		_, err := service.Ask(context.Background(), "user", "Question")
		requireCode(t, err, "provider_unavailable", 502)
		if downstreamCalls.Load() != 0 {
			t.Fatal("credential-bearing redirect was followed")
		}
	})
}

func tinyPNG(t *testing.T) []byte {
	t.Helper()
	pixels := image.NewNRGBA(image.Rect(0, 0, 2, 2))
	pixels.SetNRGBA(0, 0, color.NRGBA{R: 240, G: 100, B: 40, A: 255})
	var encoded bytes.Buffer
	if err := png.Encode(&encoded, pixels); err != nil {
		t.Fatal(err)
	}
	return encoded.Bytes()
}

func TestMealImageValidationRejectsBeforeRequestAndStripsMetadata(t *testing.T) {
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		calls.Add(1)
		json.NewEncoder(writer).Encode(providerEnvelope("openai", sampleMeal))
	}))
	defer server.Close()
	store := newMemoryStore()
	service := newTestService(t, store, server.URL, nil)
	enableProvider(t, service, "openai", 20)
	pngBytes := tinyPNG(t)
	cases := []struct {
		name string
		data []byte
		mime string
		code string
	}{
		{"empty", nil, "image/png", "invalid_meal_image"},
		{"oversized", make([]byte, MaxImageBytes+1), "image/png", "invalid_meal_image"},
		{"HEIC", []byte("not supported HEIC"), "image/heic", "unsupported_meal_image"},
		{"false MIME", pngBytes, "image/jpeg", "invalid_meal_image"},
		{"damaged PNG", pngBytes[:len(pngBytes)/2], "image/png", "invalid_meal_image"},
		{"oversized dimension", changedPNGDimensions(pngBytes, 8_001, 1), "image/png", "invalid_meal_image"},
		{"oversized pixel count", changedPNGDimensions(pngBytes, 4_001, 4_000), "image/png", "invalid_meal_image"},
	}
	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			_, err := service.EstimateMeal(context.Background(), "user", test.data, test.mime)
			requireCode(t, err, test.code, 400)
		})
	}
	if calls.Load() != 0 || store.requestCount() != 0 {
		t.Fatal("invalid image consumed an API request")
	}
	withTrailingMetadata := append(append([]byte(nil), pngBytes...), []byte("PRIVATE METADATA")...)
	clean, mime, err := validatePhoto(withTrailingMetadata, "application/octet-stream")
	if err != nil || mime != "image/png" || bytes.Contains(clean, []byte("PRIVATE METADATA")) {
		t.Fatal("image metadata was forwarded")
	}
	decoded, _, err := image.Decode(bytes.NewReader(pngBytes))
	if err != nil {
		t.Fatal(err)
	}
	var jpegBytes bytes.Buffer
	if err := jpeg.Encode(&jpegBytes, decoded, nil); err != nil {
		t.Fatal(err)
	}
	if _, mime, err := validatePhoto(jpegBytes.Bytes(), "image/jpeg"); err != nil || mime != "image/jpeg" {
		t.Fatalf("valid JPEG rejected: %v", err)
	}
}

func changedPNGDimensions(original []byte, width, height uint32) []byte {
	modified := append([]byte(nil), original...)
	binary.BigEndian.PutUint32(modified[16:20], width)
	binary.BigEndian.PutUint32(modified[20:24], height)
	binary.BigEndian.PutUint32(modified[29:33], crc32.ChecksumIEEE(modified[12:29]))
	return modified
}

func TestMealDraftValidationRejectsMissingFabricatedAndInvalidFields(t *testing.T) {
	cases := []string{
		`{"assumptions":"No items array"}`,
		`{"items":null,"assumptions":"Null items"}`,
		`{"items":[{"name":"Rice","quantity":1,"serving":"bowl","calories":420,"protein":16,"carbs":72}],"assumptions":"Approximate"}`,
		strings.Replace(sampleMeal, `"calories":420`, `"calories":-1`, 1),
		strings.Replace(sampleMeal, `"protein":16`, `"protein":1001`, 1),
		strings.Replace(sampleMeal, `"quantity":1`, `"quantity":0`, 1),
		strings.Replace(sampleMeal, `"fat":8`, `"fat":null`, 1),
		strings.Replace(sampleMeal, `"fat":8`, `"fat":"8"`, 1),
		strings.Replace(sampleMeal, `"fat":8`, `"fat":8,"autoSave":true`, 1),
		sampleMeal + ` {"another":"object"}`,
		"```json\n" + sampleMeal + "\n```",
	}
	for index, answer := range cases {
		t.Run(strconvTestName(index), func(t *testing.T) { _, err := parseMeal(answer); requireCode(t, err, "invalid_provider_output", 502) })
	}
	_, err := parseMeal(`{"items":[],"assumptions":"No recognizable food."}`)
	requireCode(t, err, "meal_not_recognized", 422)
	estimate, err := parseMeal(strings.Replace(sampleMeal, `"fat":8`, `"fat":0`, 1))
	if err != nil || estimate.Items[0].Fat != 0 {
		t.Fatal("an explicit zero macro should remain valid")
	}
	if estimate.Preview {
		t.Fatal("real provider draft was marked as simulated")
	}
}

func strconvTestName(index int) string { return string(rune('A' + index)) }

func TestResponseFormatsHandleRefusalAndTruncationAcrossProviders(t *testing.T) {
	cases := []struct {
		provider, body, code string
		status               int
	}{
		{"anthropic", `{"stop_reason":"max_tokens","content":[{"type":"text","text":"Partial"}]}`, "invalid_provider_output", 502},
		{"anthropic", `{"stop_reason":"refusal","content":[]}`, "provider_refusal", 422},
		{"openrouter", `{"choices":[{"finish_reason":"length","message":{"content":"Partial"}}]}`, "invalid_provider_output", 502},
		{"openrouter", `{"choices":[{"finish_reason":"stop","message":{"content":"","refusal":"Refused"}}]}`, "provider_refusal", 422},
	}
	for _, test := range cases {
		_, err := readAnswer(test.provider, []byte(test.body))
		requireCode(t, err, test.code, test.status)
	}
}

func TestDraftContainsOnlySubmittedMealAndNoAccountData(t *testing.T) {
	// A draft item's values are totals for its quantity. The service preserves
	// them rather than multiplying them or inventing a food-log entry.
	draft, err := parseMeal(strings.Replace(sampleMeal, `"quantity":1`, `"quantity":2`, 1))
	if err != nil || draft.Items[0].Quantity != 2 || draft.Items[0].Calories != 420 || draft.Items[0].Protein != 16 {
		t.Fatalf("draft totals were changed: %#v, %v", draft, err)
	}
	serialized, _ := json.Marshal(draft)
	if bytes.Contains(serialized, []byte("foodId")) || bytes.Contains(serialized, []byte("date")) || bytes.Contains(serialized, []byte("userId")) {
		t.Fatal("an estimate should be an unsaved draft")
	}
}
