package integration_test

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"

	"training-app/backend/dao"
	"training-app/backend/domain"
	"training-app/backend/providers"
	"training-app/backend/server"
	"training-app/backend/service"
)

func TestPublicAccountsStartEmptyAndCannotElevateTheirRole(t *testing.T) {
	a := newTestAPI(t)
	token, user := a.register("First Account", " FIRST@example.com ")
	if user["email"] != "first@example.com" || user["role"] != "user" {
		t.Fatalf("registration must normalize email and create a normal user: %#v", user)
	}
	if _, exists := user["passwordHash"]; exists {
		t.Fatal("password hashes must never be returned")
	}
	snapshot := a.snapshot(token)
	if snapshot["revision"] != float64(0) {
		t.Fatalf("empty account revision must be zero: %#v", snapshot["revision"])
	}
	for _, field := range []string{"programs", "schedule", "sessions", "foodEntries", "targets", "checkIns", "weights", "lessons"} {
		if len(records(t, snapshot, field)) != 0 {
			t.Fatalf("public accounts must not inherit screenshot fixtures in %s", field)
		}
	}
	profile := snapshot["profile"].(map[string]any)
	if profile["id"] != user["id"] || profile["role"] != "user" || profile["email"] != "first@example.com" {
		t.Fatalf("profile identity must come from the authenticated account: %#v", profile)
	}
	requireStatus(t, a.send(http.MethodGet, "/api/v1/snapshot", "", nil), http.StatusUnauthorized)
	requireStatus(t, a.send(http.MethodPost, "/api/v1/auth/login", "", object{"email": "first@example.com", "password": "incorrect-password"}), http.StatusUnauthorized)
	requireStatus(t, a.send(http.MethodPost, "/api/v1/auth/register", "", object{"displayName": "Duplicate", "email": "first@example.com", "password": password}), http.StatusConflict)
	requireStatus(t, a.send(http.MethodPost, "/api/v1/auth/register", "", object{"displayName": "Admin injection", "email": "admin-injection@example.com", "password": password, "role": "admin"}), http.StatusBadRequest)
	for _, patch := range []object{{"role": "admin"}, {"id": "some-other-user"}, {"email": "hijacked@example.com"}} {
		response := a.mutation(token, snapshot, "forbidden-"+textField(t, patch, firstKey(patch)), "updateProfile", patch)
		if response.status != http.StatusForbidden && response.status != http.StatusBadRequest {
			t.Fatalf("immutable profile identity was accepted: %s", response.body)
		}
	}
	if current := a.snapshot(token); !reflect.DeepEqual(current, snapshot) {
		t.Fatal("rejected identity changes must not advance revision or mutate private state")
	}
	requireStatus(t, a.send(http.MethodPut, "/api/v1/admin/provider", token, object{"provider": "openai", "model": "test-model", "enabled": true, "apiKey": "fake-key"}), http.StatusForbidden)
	requireStatus(t, a.send(http.MethodPost, "/api/v1/admin/provider/test", token, nil), http.StatusForbidden)
	login := a.send(http.MethodPost, "/api/v1/auth/login", "", object{"email": "FIRST@example.com", "password": password})
	requireStatus(t, login, http.StatusOK)
	secondToken := textField(t, dataObject(t, login), "token")
	requireStatus(t, a.send(http.MethodGet, "/api/v1/me", secondToken, nil), http.StatusOK)
}

func firstKey(value object) string {
	for key := range value {
		return key
	}
	return ""
}

func TestCheckInAndWeightUpsertAtomicallyAndRetryDoesNotReplay(t *testing.T) {
	a := newTestAPI(t)
	token, _ := a.register("Check-in Account", "checkin@example.com")
	empty := a.snapshot(token)
	checkIn := object{"id": "client-checkin-first", "date": "2026-10-09", "weight": 58.3, "notes": "A daily note"}
	response := a.mutation(token, empty, "daily-retry", "saveCheckIn", checkIn)
	requireStatus(t, response, http.StatusOK)
	first := dataObject(t, response)
	checkInID := onlyRecord(t, first, "checkIns")["id"]
	weightID := onlyRecord(t, first, "weights")["id"]
	if onlyRecord(t, first, "weights")["weight"] != 58.3 {
		t.Fatal("check-in must commit its linked measurement in the same snapshot")
	}
	edited := a.apply(token, first, "saveCheckIn", object{"id": "different-client-id", "date": "2026-10-09", "weight": 59.1, "notes": "Edited daily note"})
	if onlyRecord(t, edited, "checkIns")["id"] != checkInID || onlyRecord(t, edited, "weights")["id"] != weightID {
		t.Fatal("date-based edits must preserve one authoritative check-in and weight ID")
	}
	if onlyRecord(t, edited, "checkIns")["weight"] != 59.1 || onlyRecord(t, edited, "weights")["weight"] != 59.1 {
		t.Fatal("check-in and Progress measurement diverged")
	}
	retry := a.mutation(token, empty, "daily-retry", "saveCheckIn", checkIn)
	requireStatus(t, retry, http.StatusOK)
	current := a.snapshot(token)
	if !reflect.DeepEqual(current, edited) {
		t.Fatal("an acknowledged retry changed the current revision or replaced a later edit")
	}
	// A standalone weight edit must keep the existing same-day check-in coherent.
	current = a.apply(token, current, "saveWeight", object{"id": "weight-from-other-device", "date": "2026-10-09", "weight": 59.4})
	if onlyRecord(t, current, "checkIns")["weight"] != 59.4 || onlyRecord(t, current, "weights")["weight"] != 59.4 {
		t.Fatal("same-date weight and check-in updates must remain coherent")
	}
	beforeRejected := clone(t, current)
	bad := a.mutation(token, current, "invalid-checkin", "saveCheckIn", object{"id": "bad", "date": "2026-02-30", "weight": -1, "notes": "Invalid"})
	requireStatus(t, bad, http.StatusBadRequest)
	if !reflect.DeepEqual(a.snapshot(token), beforeRejected) {
		t.Fatal("invalid paired update must roll back completely")
	}
}

func TestRealRecordsPersistAcrossRoutersAndSessionPrescriptionsRemainImmutable(t *testing.T) {
	a := newTestAPI(t)
	token, _ := a.register("Persistent Account", "persistent@example.com")
	state := a.snapshot(token)
	program := personalProgram()
	state = a.apply(token, state, "saveProgram", program)
	state = a.apply(token, state, "assignWorkout", object{"date": "2026-10-09", "workoutId": "personal-workout"})
	state = a.apply(token, state, "startWorkout", object{"date": "2026-10-09", "workoutId": "personal-workout"})
	session := clone(t, onlyRecord(t, state, "sessions"))
	exercise := onlyRecord(t, session, "exercises")
	set := records(t, exercise, "sets")[0]
	set["weight"], set["reps"], set["effort"], set["completed"] = 40, 8, "hard", false
	exercise["notes"] = "Keep this private session note"
	session["restDuration"] = 120
	session["restDeadline"] = time.Now().UTC().Add(120 * time.Second).Format(time.RFC3339Nano)
	state = a.apply(token, state, "saveSession", session)
	persisted := onlyRecord(t, state, "sessions")
	firstSet := records(t, onlyRecord(t, persisted, "exercises"), "sets")[0]
	if firstSet["effort"] != "hard" || firstSet["completed"] != false {
		t.Fatal("self-determined effort must remain independent of set completion")
	}
	originalPrescription := clone(t, onlyRecord(t, persisted, "exercises")["prescription"].(map[string]any))
	for _, field := range []string{"name", "date", "workoutId", "startedAt", "finishedAt"} {
		forged := clone(t, persisted)
		forged[field] = "forged-client-history"
		rejected := a.mutation(token, state, "forged-"+field, "saveSession", forged)
		if rejected.status != http.StatusBadRequest && rejected.status != http.StatusForbidden {
			t.Fatalf("forged immutable session field %s was accepted: %s", field, rejected.body)
		}
	}
	forgedPrescription := clone(t, persisted)
	onlyRecord(t, forgedPrescription, "exercises")["prescription"].(map[string]any)["repsMax"] = 500
	requireStatus(t, a.mutation(token, state, "forged-prescription", "saveSession", forgedPrescription), http.StatusBadRequest)
	program["workouts"].([]any)[0].(map[string]any)["exercises"].([]any)[0].(map[string]any)["repsMax"] = 12
	state = a.apply(token, state, "saveProgram", program)
	if !reflect.DeepEqual(onlyRecord(t, onlyRecord(t, state, "sessions"), "exercises")["prescription"], originalPrescription) {
		t.Fatal("program editing replaced an existing session prescription")
	}
	state = a.apply(token, state, "saveFood", food("food-private", "2026-10-09", "Private meal"))
	state = a.apply(token, state, "saveLesson", lesson("lesson-private", "Private lesson"))
	state = a.apply(token, state, "saveTargets", object{"id": "manual-target", "effectiveDate": "2026-10-09", "mode": "manual", "manuallyOverridden": true, "calories": 2100, "protein": 120, "carbs": 250, "fat": 65})
	state = a.apply(token, state, "finishSession", object{"sessionId": session["id"]})
	finishedAt := onlyRecord(t, state, "sessions")["finishedAt"]
	if finishedAt == nil || finishedAt == "" {
		t.Fatal("finishing a session must record authoritative completion")
	}
	state = a.apply(token, state, "finishSession", object{"sessionId": session["id"]})
	if len(records(t, state, "sessions")) != 1 || onlyRecord(t, state, "sessions")["finishedAt"] != finishedAt {
		t.Fatal("finishing the same session twice duplicated or rewrote completion history")
	}
	// A new router has no in-memory account state; records must be in PostgreSQL.
	restarted := httptest.NewServer(server.NewRouter(a.db, a.cfg))
	defer restarted.Close()
	originalServer := a.server
	a.server = restarted
	durable := a.snapshot(token)
	a.server = originalServer
	if !reflect.DeepEqual(durable, state) {
		t.Fatal("a new API router did not recover the same persisted document")
	}
}

func TestOfflineSessionCompletionPreservesStopTimeAndRejectsInvalidTimestamps(t *testing.T) {
	a := newTestAPI(t)
	token, user := a.register("Offline Completion Account", "offline-completion@example.com")
	state := a.apply(token, a.snapshot(token), "saveProgram", personalProgram())
	// A controlled service clock creates a real persisted historical session
	// without making this database integration case wait through an outage.
	started := time.Now().UTC().Add(-2 * time.Hour)
	training := service.NewTrainingService(a.db)
	training.Now = func() time.Time { return started }
	payload, err := json.Marshal(object{"date": started.Format("2006-01-02"), "workoutId": "personal-workout"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := training.Mutate(context.Background(), textField(t, user, "id"), domain.Mutation{
		ID: "historical-start", BaseRevision: int64(state["revision"].(float64)), Operation: "startWorkout", Payload: payload,
	}); err != nil {
		t.Fatalf("persist historical workout start: %v", err)
	}
	state = a.snapshot(token)
	session := onlyRecord(t, state, "sessions")
	for i, invalid := range []string{
		started.Add(-time.Second).Format(time.RFC3339Nano),
		time.Now().UTC().Add(6 * time.Minute).Format(time.RFC3339Nano),
		"not-a-timestamp", "",
	} {
		requireStatus(t, a.mutation(token, state, "invalid-finish-"+string(rune('a'+i)), "finishSession", object{"sessionId": session["id"], "finishedAt": invalid}), http.StatusBadRequest)
		if !reflect.DeepEqual(a.snapshot(token), state) {
			t.Fatal("invalid stop time changed the revision or session history")
		}
	}
	stopped := started.Add(30 * time.Minute)
	completion := object{"sessionId": session["id"], "finishedAt": stopped.In(time.FixedZone("UTC+8", 8*60*60)).Format(time.RFC3339Nano)}
	replayed := a.mutation(token, state, "offline-finish-retry", "finishSession", completion)
	requireStatus(t, replayed, http.StatusOK)
	finished := dataObject(t, replayed)
	if onlyRecord(t, finished, "sessions")["finishedAt"] != stopped.Format(time.RFC3339Nano) {
		t.Fatal("delayed completion used acknowledgement time instead of the recorded stop time in UTC")
	}
	// An old acknowledged operation must remain a no-op after later account edits.
	current := a.apply(token, finished, "saveLesson", lesson("after-completion", "A later account edit"))
	requireStatus(t, a.mutation(token, state, "offline-finish-retry", "finishSession", completion), http.StatusOK)
	if !reflect.DeepEqual(a.snapshot(token), current) {
		t.Fatal("retrying offline completion rewrote completion time or advanced the current revision")
	}
	var receipts int64
	if err := a.db.Model(&dao.MutationReceipt{}).Where("user_id = ? AND mutation_id = ?", user["id"], "offline-finish-retry").Count(&receipts).Error; err != nil {
		t.Fatal(err)
	}
	if receipts != 1 {
		t.Fatalf("completion should have one durable receipt, received %d", receipts)
	}
}

func TestTemplatesFoodCopyAndLessonCRUDUsePrivateRecords(t *testing.T) {
	a := newTestAPI(t)
	token, user := a.register("Template Account", "template@example.com")
	state := a.snapshot(token)
	state = a.apply(token, state, "useTemplate", object{"templateId": "beginner-3"})
	program := onlyRecord(t, state, "programs")
	if program["id"] == "beginner-3" || state["activeProgramId"] != program["id"] || len(records(t, state, "schedule")) != 0 {
		t.Fatal("template use must make a private active copy without assigning the calendar")
	}
	originalFood := food("original-food", "2026-10-09", "Original food")
	originalFood["quantity"], originalFood["calories"], originalFood["protein"], originalFood["carbs"], originalFood["fat"] = 2, 250, 20, 30, 6
	state = a.apply(token, state, "saveFood", originalFood)
	searched := a.send(http.MethodGet, "/api/v1/foods/search?q=Original", token, nil)
	requireStatus(t, searched, http.StatusOK)
	var foods []object
	if err := json.Unmarshal(searched.data.Data, &foods); err != nil {
		t.Fatal(err)
	}
	var perServing object
	for _, result := range foods {
		if result["name"] == "Original food" {
			perServing = result
		}
	}
	if perServing == nil || perServing["calories"] != float64(125) || perServing["protein"] != float64(10) || perServing["carbs"] != float64(15) || perServing["fat"] != float64(3) {
		t.Fatalf("saved quantity-two totals must be offered as one serving, received %#v", perServing)
	}
	if len(textField(t, perServing, "id")) > 180 || perServing["source"] != "Your saved food log" {
		t.Fatal("saved food search must return a valid bounded ID and source attribution")
	}
	state = a.apply(token, state, "copyFoods", object{"fromDate": "2026-10-09", "toDate": "2026-10-10"})
	entries := records(t, state, "foodEntries")
	if len(entries) != 2 || entries[0]["id"] == entries[1]["id"] {
		t.Fatal("food copying must create a separate ID and preserve the source log")
	}
	for _, entry := range entries {
		if entry["date"] == "2026-10-10" {
			state = a.apply(token, state, "deleteFood", object{"id": entry["id"]})
		}
	}
	if onlyRecord(t, state, "foodEntries")["date"] != "2026-10-09" {
		t.Fatal("deleting the copied food changed its source day")
	}
	// Direct service callers can preserve whitespace around RawMessage values,
	// unlike the outer HTTP decoder. Exercise that boundary against the real DB.
	encodedLesson, err := json.Marshal(lesson("whitespace-lesson", "Whitespace payload"))
	if err != nil {
		t.Fatal(err)
	}
	training := service.NewTrainingService(a.db)
	mutation := domain.Mutation{ID: "whitespace-retry", BaseRevision: int64(state["revision"].(float64)), Operation: "saveLesson", Payload: json.RawMessage(append(append([]byte(" \n\t"), encodedLesson...), []byte(" \r\n ")...))}
	if _, err := training.Mutate(context.Background(), textField(t, user, "id"), mutation); err != nil {
		t.Fatalf("valid JSON payload with surrounding whitespace was rejected: %v", err)
	}
	state = a.snapshot(token)
	if onlyRecord(t, state, "lessons")["title"] != "Whitespace payload" {
		t.Fatal("whitespace-padded mutation did not persist its lesson")
	}
	mutation.Payload = encodedLesson
	if _, err := training.Mutate(context.Background(), textField(t, user, "id"), mutation); err != nil {
		t.Fatalf("semantic retry without the whitespace was rejected: %v", err)
	}
	if !reflect.DeepEqual(a.snapshot(token), state) {
		t.Fatal("whitespace-only payload differences must not replay an acknowledged mutation")
	}
	state = a.apply(token, state, "deleteLesson", object{"id": "whitespace-lesson"})
	entry := lesson("my-lesson", "Initial lesson")
	state = a.apply(token, state, "saveLesson", entry)
	entry["title"], entry["notes"], entry["completed"] = "Edited lesson", "Edited notes", true
	state = a.apply(token, state, "saveLesson", entry)
	if onlyRecord(t, state, "lessons")["completed"] != true || onlyRecord(t, state, "lessons")["title"] != "Edited lesson" {
		t.Fatal("lesson edits must replace the private record without duplication")
	}
	state = a.apply(token, state, "deleteLesson", object{"id": "my-lesson"})
	if len(records(t, state, "lessons")) != 0 {
		t.Fatal("lesson deletion was not persisted")
	}
}

func TestAccountsCannotReadOrMutateAnotherAccountsRecordReferences(t *testing.T) {
	a := newTestAPI(t)
	nathan, _ := a.register("Nathan", "nathan-isolation@example.com")
	ivana, _ := a.register("Ivana", "ivana-isolation@example.com")
	nathanState := a.snapshot(nathan)
	nathanState = a.apply(nathan, nathanState, "saveProgram", personalProgram())
	nathanState = a.apply(nathan, nathanState, "saveFood", food("nathan-food", "2026-10-09", "Nathan only"))
	nathanState = a.apply(nathan, nathanState, "saveLesson", lesson("nathan-lesson", "Nathan only"))
	nathanState = a.apply(nathan, nathanState, "startWorkout", object{"date": "2026-10-09", "workoutId": "personal-workout"})
	ivanaState := a.snapshot(ivana)
	for _, field := range []string{"programs", "foodEntries", "lessons", "sessions"} {
		if len(records(t, ivanaState, field)) != 0 {
			t.Fatalf("another account exposed Nathan's %s", field)
		}
	}
	// Retry IDs are scoped to the authenticated user, even if two clients happen
	// to generate the same value. A receipt must never return another user's data.
	nathanRetry := a.mutation(nathan, nathanState, "shared-client-retry-id", "saveCheckIn", object{"id": "nathan-daily", "date": "2026-10-09", "weight": 58, "notes": "Nathan private check-in"})
	requireStatus(t, nathanRetry, http.StatusOK)
	nathanState = dataObject(t, nathanRetry)
	ivanaRetry := a.mutation(ivana, ivanaState, "shared-client-retry-id", "saveCheckIn", object{"id": "ivana-daily", "date": "2026-10-09", "weight": 59, "notes": "Ivana private check-in"})
	requireStatus(t, ivanaRetry, http.StatusOK)
	ivanaState = dataObject(t, ivanaRetry)
	if onlyRecord(t, ivanaState, "checkIns")["notes"] != "Ivana private check-in" || onlyRecord(t, nathanState, "checkIns")["notes"] != "Nathan private check-in" {
		t.Fatal("retry receipts crossed account boundaries")
	}
	for _, attack := range []struct {
		operation string
		payload   object
	}{
		{"assignWorkout", object{"date": "2026-10-09", "workoutId": "personal-workout"}},
		{"startWorkout", object{"date": "2026-10-09", "workoutId": "personal-workout"}},
		{"finishSession", object{"sessionId": onlyRecord(t, nathanState, "sessions")["id"]}},
		{"deleteFood", object{"id": "nathan-food"}},
		{"deleteLesson", object{"id": "nathan-lesson"}},
	} {
		requireStatus(t, a.mutation(ivana, ivanaState, "attack-"+attack.operation, attack.operation, attack.payload), http.StatusNotFound)
	}
	if !reflect.DeepEqual(a.snapshot(ivana), ivanaState) || !reflect.DeepEqual(a.snapshot(nathan), nathanState) {
		t.Fatal("foreign-record references changed either account")
	}
}

func TestConcurrentWritesConflictAndAcknowledgedRetryRemainsANoOp(t *testing.T) {
	a := newTestAPI(t)
	token, _ := a.register("Concurrent Account", "concurrent@example.com")
	base := a.snapshot(token)
	const count = 6
	type writeResult struct {
		id       string
		payload  object
		response apiResponse
		err      error
	}
	results := make(chan writeResult, count)
	var start sync.WaitGroup
	start.Add(1)
	for index := 0; index < count; index++ {
		go func(index int) {
			start.Wait()
			id := string(rune('a' + index))
			payload := lesson("concurrent-"+id, "Concurrent "+id)
			encoded, err := json.Marshal(object{"id": "concurrent-retry-" + id, "baseRevision": base["revision"], "operation": "saveLesson", "payload": payload})
			if err != nil {
				results <- writeResult{err: err}
				return
			}
			request, err := http.NewRequest(http.MethodPost, a.server.URL+"/api/v1/mutations", bytes.NewReader(encoded))
			if err != nil {
				results <- writeResult{err: err}
				return
			}
			request.Header.Set("Content-Type", "application/json")
			request.Header.Set("Authorization", "Bearer "+token)
			response, err := a.server.Client().Do(request)
			if err != nil {
				results <- writeResult{err: err}
				return
			}
			body, err := io.ReadAll(response.Body)
			_ = response.Body.Close()
			result := apiResponse{status: response.StatusCode, header: response.Header, body: body}
			if err == nil {
				err = json.Unmarshal(body, &result.data)
			}
			results <- writeResult{id: id, payload: payload, response: result, err: err}
		}(index)
	}
	start.Done()
	var winner writeResult
	successes, conflicts := 0, 0
	for index := 0; index < count; index++ {
		result := <-results
		if result.err != nil {
			t.Fatal(result.err)
		}
		switch result.response.status {
		case http.StatusOK:
			requireStatus(t, result.response, http.StatusOK)
			winner = result
			successes++
		case http.StatusConflict:
			requireStatus(t, result.response, http.StatusConflict)
			conflicts++
			if result.response.data.Code != "revision_conflict" || dataObject(t, result.response)["revision"] != float64(1) {
				t.Fatalf("stale writes need the current snapshot and revision_conflict code: %s", result.response.body)
			}
		default:
			t.Fatalf("unexpected concurrent result: %d %s", result.response.status, result.response.body)
		}
	}
	if successes != 1 || conflicts != count-1 {
		t.Fatalf("one write must win a shared base revision, received %d successful and %d conflict writes", successes, conflicts)
	}
	current := a.snapshot(token)
	if onlyRecord(t, current, "lessons")["id"] != winner.payload["id"] {
		t.Fatal("a losing write replaced the winning account state")
	}
	current = a.apply(token, current, "saveFood", food("after-concurrency", "2026-10-09", "Later edit"))
	retry := a.mutation(token, base, "concurrent-retry-"+winner.id, "saveLesson", winner.payload)
	requireStatus(t, retry, http.StatusOK)
	if !reflect.DeepEqual(a.snapshot(token), current) {
		t.Fatal("retrying an acknowledged operation replayed or reverted later state")
	}
}

func TestInvalidRecordsRollbackAndProviderErrorsDoNotSaveMeals(t *testing.T) {
	a := newTestAPI(t)
	token, user := a.register("Validation Account", "validation@example.com")
	base := a.snapshot(token)
	overlongLesson := lesson("overlong-lesson", strings.Repeat("L", 201))
	for _, invalid := range []struct {
		operation string
		payload   object
	}{
		{"saveFood", object{"id": "bad-food", "name": "Invalid", "date": "2026-10-09", "meal": "invalid", "quantity": 1, "serving": "one", "source": "manual", "calories": -1, "protein": 0, "carbs": 0, "fat": 0}},
		{"saveLesson", object{"id": "bad-lesson", "title": "Unsafe link", "url": "javascript:alert(1)", "notes": "", "category": "Training", "source": "Personal", "completed": false, "savedAt": time.Now().UTC().Format(time.RFC3339Nano)}},
		{"saveTargets", object{"id": "bad-target", "effectiveDate": "2026-02-30", "mode": "manual", "manuallyOverridden": true, "calories": 2000, "protein": 100, "carbs": 200, "fat": 60}},
		{"unknownOperation", object{}},
		{"updateProfile", object{"displayName": strings.Repeat("N", 81)}},
		{"saveFood", food("overlong-food", "2026-10-09", strings.Repeat("F", 201))},
		{"saveLesson", overlongLesson},
		{"saveCheckIn", object{"id": "overlong-notes", "date": "2026-10-09", "weight": 58, "notes": strings.Repeat("n", 5001)}},
	} {
		requireStatus(t, a.mutation(token, base, "invalid-"+invalid.operation, invalid.operation, invalid.payload), http.StatusBadRequest)
		if !reflect.DeepEqual(a.snapshot(token), base) {
			t.Fatalf("invalid %s changed persisted state", invalid.operation)
		}
	}
	requireStatus(t, a.mutation(token, base, strings.Repeat("r", 181), "saveLesson", lesson("valid-lesson", "Valid payload with invalid retry ID")), http.StatusBadRequest)
	if !reflect.DeepEqual(a.snapshot(token), base) {
		t.Fatal("a rejected overlong retry ID must not change the account")
	}
	missingProvider := a.send(http.MethodPost, "/api/v1/assistant/question", token, object{"question": "How should I organize a workout?"})
	if missingProvider.status < 400 || missingProvider.data.Success || missingProvider.data.Error == "" {
		t.Fatalf("an unconfigured provider must return a clear error: %s", missingProvider.body)
	}
	// Promote only this local test account; public routes cannot perform this action.
	if err := a.db.Model(&dao.User{}).Where("id = ?", user["id"]).Update("role", "admin").Error; err != nil {
		t.Fatal(err)
	}
	key := "fake-integration-key-never-send-to-paid-service"
	saved := a.send(http.MethodPut, "/api/v1/admin/provider", token, object{"provider": "openai", "model": "local-stub", "enabled": true, "apiKey": key, "dailyRequestLimit": 1})
	requireStatus(t, saved, http.StatusOK)
	if strings.Contains(string(saved.body), key) || strings.Contains(string(a.send(http.MethodGet, "/api/v1/snapshot", token, nil).body), key) {
		t.Fatal("provider credentials leaked through a public response")
	}
	var persistedConfig providers.Config
	if err := a.db.First(&persistedConfig, 1).Error; err != nil {
		t.Fatalf("read persisted provider settings: %v", err)
	}
	if len(persistedConfig.EncryptedKey) == 0 || bytes.Contains(persistedConfig.EncryptedKey, []byte(key)) {
		t.Fatal("the real PostgreSQL provider row must store ciphertext rather than the API key")
	}
	otherToken, _ := a.register("Ordinary Account", "ordinary-provider@example.com")
	public := a.snapshot(otherToken)
	provider := public["provider"].(map[string]any)
	if provider["configured"] != true || provider["enabled"] != true {
		t.Fatal("global configured provider status should be visible to ordinary accounts")
	}
	encodedPublic, _ := json.Marshal(public)
	if bytes.Contains(encodedPublic, []byte(key)) {
		t.Fatal("global provider status included its secret")
	}
	upstreamError := a.send(http.MethodPost, "/api/v1/assistant/question", token, object{"question": "Exercise question sent only to the local stub"})
	if upstreamError.status < 400 || upstreamError.data.Success || upstreamError.data.Error == "" {
		t.Fatalf("provider failure was reported as an answer: %s", upstreamError.body)
	}
	if len(records(t, a.snapshot(token), "foodEntries")) != 0 {
		t.Fatal("provider configuration or an assistant error must never insert a meal")
	}
	requireStatus(t, a.send(http.MethodPost, "/api/v1/assistant/question", token, object{"question": "The real PostgreSQL request budget should reject this second attempt"}), http.StatusTooManyRequests)
}
