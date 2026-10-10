package integration_test

import (
	"bytes"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"gorm.io/gorm"
	"training-app/backend/config"
	"training-app/backend/database"
	"training-app/backend/server"
)

const password = "BodyBuilder-test-42!"

type object = map[string]any

type envelope struct {
	Success bool            `json:"success"`
	Error   string          `json:"error"`
	Code    string          `json:"code"`
	Data    json.RawMessage `json:"data"`
}

type apiResponse struct {
	status int
	header http.Header
	body   []byte
	data   envelope
}

type testAPI struct {
	t      *testing.T
	db     *gorm.DB
	cfg    config.Config
	server *httptest.Server
}

// Every case owns a freshly named schema. Missing PostgreSQL is a failed check,
// never a skipped integration suite that could be mistaken for verification.
func newTestAPI(t *testing.T) *testAPI {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Fatal("TEST_DATABASE_URL is required for real PostgreSQL integration tests")
	}
	var suffix [10]byte
	if _, err := rand.Read(suffix[:]); err != nil {
		t.Fatal(err)
	}
	schema := "bb_integration_" + hex.EncodeToString(suffix[:])
	// All provider traffic stays local even if a case configures a test key.
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadGateway)
		_, _ = io.WriteString(w, `{"error":{"message":"local test upstream unavailable"}}`)
	}))
	cfg := config.Config{
		DatabaseURL: dsn, Schema: schema,
		JWTSecret:        "integration-only-secret-at-least-thirty-two-characters",
		TokenExpiryHours: 24, ProviderEncryptionKey: bytes.Repeat([]byte{42}, 32),
		OpenAIURL: upstream.URL, AnthropicURL: upstream.URL,
		OpenRouterURL: upstream.URL, FoodSearchURL: upstream.URL,
	}
	db, err := database.Open(cfg)
	if err != nil {
		upstream.Close()
		t.Fatalf("open integration database: %v", err)
	}
	api := &testAPI{t: t, db: db, cfg: cfg}
	t.Cleanup(func() {
		if api.server != nil {
			api.server.Close()
		}
		// The identifier comes only from crypto/rand above, never user input.
		if err := db.Exec(fmt.Sprintf(`DROP SCHEMA IF EXISTS "%s" CASCADE`, schema)).Error; err != nil {
			t.Errorf("remove owned integration schema %s: %v", schema, err)
		}
		if pool, err := db.DB(); err == nil {
			_ = pool.Close()
		}
		upstream.Close()
	})
	if err := database.Migrate(db, schema); err != nil {
		t.Fatalf("migrate integration schema: %v", err)
	}
	api.server = httptest.NewServer(server.NewRouter(db, cfg))
	return api
}

func (a *testAPI) send(method, path, token string, payload any) apiResponse {
	a.t.Helper()
	var body io.Reader
	if payload != nil {
		encoded, err := json.Marshal(payload)
		if err != nil {
			a.t.Fatal(err)
		}
		body = bytes.NewReader(encoded)
	}
	request, err := http.NewRequest(method, a.server.URL+path, body)
	if err != nil {
		a.t.Fatal(err)
	}
	request.Header.Set("Content-Type", "application/json")
	if token != "" {
		request.Header.Set("Authorization", "Bearer "+token)
	}
	response, err := a.server.Client().Do(request)
	if err != nil {
		a.t.Fatalf("%s %s: %v", method, path, err)
	}
	defer response.Body.Close()
	encoded, err := io.ReadAll(response.Body)
	if err != nil {
		a.t.Fatal(err)
	}
	result := apiResponse{status: response.StatusCode, header: response.Header.Clone(), body: encoded}
	if err := json.Unmarshal(encoded, &result.data); err != nil {
		a.t.Fatalf("%s %s returned invalid JSON (%d): %s", method, path, result.status, encoded)
	}
	return result
}

func (a *testAPI) register(name, email string) (string, object) {
	a.t.Helper()
	response := a.send(http.MethodPost, "/api/v1/auth/register", "", object{
		"displayName": name, "email": email, "password": password,
	})
	requireStatus(a.t, response, http.StatusCreated)
	auth := dataObject(a.t, response)
	return textField(a.t, auth, "token"), auth["user"].(map[string]any)
}

func (a *testAPI) snapshot(token string) object {
	a.t.Helper()
	response := a.send(http.MethodGet, "/api/v1/snapshot", token, nil)
	requireStatus(a.t, response, http.StatusOK)
	if !strings.Contains(response.header.Get("Cache-Control"), "no-store") {
		a.t.Fatal("private snapshots must have Cache-Control: no-store")
	}
	return dataObject(a.t, response)
}

func (a *testAPI) mutation(token string, snapshot object, retryID, operation string, payload any) apiResponse {
	a.t.Helper()
	return a.send(http.MethodPost, "/api/v1/mutations", token, object{
		"id": retryID, "baseRevision": snapshot["revision"], "operation": operation, "payload": payload,
	})
}

func (a *testAPI) apply(token string, snapshot object, operation string, payload any) object {
	a.t.Helper()
	response := a.mutation(token, snapshot, fmt.Sprintf("retry-%d", time.Now().UnixNano()), operation, payload)
	requireStatus(a.t, response, http.StatusOK)
	return dataObject(a.t, response)
}

func requireStatus(t *testing.T, response apiResponse, expected int) {
	t.Helper()
	if response.status != expected {
		t.Fatalf("expected HTTP %d, received %d: %s", expected, response.status, response.body)
	}
	if expected >= 400 && (response.data.Success || response.data.Error == "") {
		t.Fatalf("an error response needs success:false and an error message: %s", response.body)
	}
	if expected < 400 && !response.data.Success {
		t.Fatalf("successful HTTP response returned success:false: %s", response.body)
	}
}

func dataObject(t *testing.T, response apiResponse) object {
	t.Helper()
	var result object
	if err := json.Unmarshal(response.data.Data, &result); err != nil {
		t.Fatalf("decode response data: %v; body: %s", err, response.body)
	}
	return result
}

func records(t *testing.T, snapshot object, field string) []object {
	t.Helper()
	values, ok := snapshot[field].([]any)
	if !ok {
		t.Fatalf("%s must be a JSON array, received %#v", field, snapshot[field])
	}
	result := make([]object, 0, len(values))
	for _, value := range values {
		record, ok := value.(map[string]any)
		if !ok {
			t.Fatalf("%s contains a non-object record: %#v", field, value)
		}
		result = append(result, record)
	}
	return result
}

func onlyRecord(t *testing.T, snapshot object, field string) object {
	t.Helper()
	values := records(t, snapshot, field)
	if len(values) != 1 {
		t.Fatalf("expected one %s record, found %d", field, len(values))
	}
	return values[0]
}

func textField(t *testing.T, value object, key string) string {
	t.Helper()
	text, ok := value[key].(string)
	if !ok || text == "" {
		t.Fatalf("%s must be a nonempty string: %#v", key, value[key])
	}
	return text
}

func clone(t *testing.T, value object) object {
	t.Helper()
	encoded, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	var result object
	if err := json.Unmarshal(encoded, &result); err != nil {
		t.Fatal(err)
	}
	return result
}

func personalProgram() object {
	return object{
		"id": "personal-program", "name": "My Integration Program", "level": "Beginner", "goal": "build-muscle",
		"workouts": []any{object{
			"id": "personal-workout", "name": "My Squat Day", "warmup": []string{"Warm up gradually"},
			"muscles":   []any{object{"id": "quadriceps", "name": "Quadriceps", "image": "/images/muscles/quadriceps.svg", "percentage": 100}},
			"exercises": []any{object{"id": "squat-prescription", "exerciseId": "squat", "sets": 3, "repsMin": 6, "repsMax": 10, "restSeconds": 90}},
		}},
	}
}

func food(id, date, name string) object {
	return object{"id": id, "name": name, "date": date, "meal": "Breakfast", "quantity": 1, "serving": "1 bowl", "source": "manual", "calories": 125, "protein": 10, "carbs": 15, "fat": 3}
}

func lesson(id, title string) object {
	return object{"id": id, "title": title, "url": "https://example.com/training", "notes": "Private technique notes", "category": "Training", "source": "Personal link", "completed": false, "savedAt": time.Now().UTC().Format(time.RFC3339Nano)}
}
