package integration_test

import (
	"net/http"
	"reflect"
	"testing"
	"time"
	"training-app/backend/dao"
)

func expertPreferences(days int) object {
	return object{"goal": "build-muscle", "experience": "beginner", "equipment": "full-gym", "daysPerWeek": days, "sessionMinutes": 45, "focus": "balanced", "trainingPriority": "hypertrophy"}
}
func expertMatch(t *testing.T, a *testAPI, token string, days int, id, scope string) object {
	t.Helper()
	response := a.send(http.MethodPost, "/api/v1/programs/recommendations", token, expertPreferences(days))
	requireStatus(t, response, 200)
	if response.header.Get("Cache-Control") != "no-store" {
		t.Fatal("recommendation cache could expose personal plans")
	}
	for _, m := range records(t, dataObject(t, response), "matches") {
		selection := m["selection"].(map[string]any)
		if selection["id"] == id && selection["scope"] == scope {
			return m
		}
	}
	t.Fatalf("missing %s %s", scope, id)
	return nil
}
func libraryGoalAnswers(selection any) object {
	a := goalAnswers()
	a["daysPerWeek"] = 2
	a["workoutDays"] = []int{0, 3}
	a["trainingPriority"] = "hypertrophy"
	a["programSelection"] = selection
	return a
}
func TestExpertLibraryCreationRevalidatesPublishedContentAndIsAtomic(t *testing.T) {
	a := newTestAPI(t)
	admin, user := a.register("Expert Admin", "expert-admin@example.test")
	member, _ := a.register("Member", "expert-member@example.test")
	if err := a.db.Model(&dao.User{}).Where("id = ?", user["id"]).Update("role", "admin").Error; err != nil {
		t.Fatal(err)
	}
	doc := importDocument(t, "expert-shared")
	doc["name"] = "Shared expert foundation"
	requireStatus(t, a.send(http.MethodPut, "/api/v1/admin/programs", admin, object{"document": doc, "baseRevision": 0}), 200)
	requireStatus(t, a.send(http.MethodPost, "/api/v1/programs/recommendations", "", expertPreferences(2)), 401)
	requireStatus(t, a.send(http.MethodGet, "/api/v1/progress/review", "", nil), 401)
	match := expertMatch(t, a, member, 2, "expert-shared", "shared")
	input := goalInput(t, a, member, libraryGoalAnswers(match["selection"]))
	before := a.snapshot(member)
	updated := clone(t, doc)
	updated["version"] = 2
	documentPrescription(t, updated)["sets"] = 3
	requireStatus(t, a.send(http.MethodPut, "/api/v1/admin/programs", admin, object{"document": updated, "baseRevision": 1}), 200)
	requireStatus(t, a.mutation(member, before, "stale-expert-plan", "createGoalPlan", input), 409)
	if !reflect.DeepEqual(before, a.snapshot(member)) {
		t.Fatal("stale selection partially committed a goal")
	}
	fresh := expertMatch(t, a, member, 2, "expert-shared", "shared")
	input = goalInput(t, a, member, libraryGoalAnswers(fresh["selection"]))
	input["targets"].(map[string]any)["mode"] = "manual"
	input["targets"].(map[string]any)["manuallyOverridden"] = true
	input["targets"].(map[string]any)["calories"] = 2400
	response := a.mutation(member, before, "expert-retry", "createGoalPlan", input)
	requireStatus(t, response, 200)
	saved := dataObject(t, response)
	p := onlyRecord(t, saved, "programs")
	plan := onlyRecord(t, saved, "goalPlans")
	if plan["version"] != "goal-library-v2" || documentPrescription(t, p)["sets"] != float64(3) || p["details"].(map[string]any)["version"] != float64(2) || onlyRecord(t, saved, "targets")["calories"] != float64(2400) {
		t.Fatal("library prescriptions or manual target lost")
	}
	if p["details"].(map[string]any)["key"] != "copy-"+p["id"].(string) || len(records(t, saved, "schedule")) != 28 {
		t.Fatal("missing private identity or calendar")
	}
	requireStatus(t, a.mutation(member, before, "expert-retry", "createGoalPlan", input), 200)
	if !reflect.DeepEqual(saved, a.snapshot(member)) {
		t.Fatal("retry duplicated goal")
	}
	other, _ := a.register("Other Member", "expert-other@example.test")
	reviewResponse := a.send(http.MethodGet, "/api/v1/progress/review", other, nil)
	requireStatus(t, reviewResponse, 200)
	if dataObject(t, reviewResponse)["programId"] != "" {
		t.Fatal("review leaked another program")
	}
}
func TestExpertPersonalMatchingAndProgressReportsStayPrivateAndReadOnly(t *testing.T) {
	a := newTestAPI(t)
	alice, _ := a.register("Alice Expert", "expert-alice@example.test")
	bob, _ := a.register("Bob Expert", "expert-bob@example.test")
	state := a.apply(alice, a.snapshot(alice), "importProgram", object{"document": importDocument(t, "expert-private")})
	p := onlyRecord(t, state, "programs")
	pID := p["id"].(string)
	match := expertMatch(t, a, alice, 2, pID, "personal")
	requireStatus(t, a.send(http.MethodPost, "/api/v1/goals/preview", bob, libraryGoalAnswers(match["selection"])), 409)
	report := a.send(http.MethodPost, "/api/v1/programs/recommendations", bob, expertPreferences(2))
	requireStatus(t, report, 200)
	for _, m := range records(t, dataObject(t, report), "matches") {
		if m["selection"].(map[string]any)["scope"] == "personal" {
			t.Fatal("private match leaked")
		}
	}
	workout := documentWorkout(t, p)
	workoutID := workout["id"].(string)
	for i := 1; i >= 0; i-- {
		date := time.Now().UTC().AddDate(0, 0, -i).Format("2006-01-02")
		state = a.apply(alice, state, "startWorkout", object{"date": date, "workoutId": workoutID})
		sessions := records(t, state, "sessions")
		session := clone(t, sessions[len(sessions)-1])
		entry := records(t, session, "exercises")[0]
		rx := entry["prescription"].(map[string]any)
		for _, set := range records(t, entry, "sets") {
			set["weight"], set["reps"], set["effort"], set["completed"] = float64(50), rx["repsMax"], "medium", true
		}
		state = a.apply(alice, state, "saveSession", session)
		state = a.apply(alice, state, "finishSession", object{"sessionId": session["id"], "finishedAt": time.Now().UTC().Format(time.RFC3339Nano)})
	}
	response := a.send(http.MethodGet, "/api/v1/progress/review", alice, nil)
	requireStatus(t, response, 200)
	result := dataObject(t, response)
	suggestions := records(t, result, "training")
	if len(suggestions) != 1 || suggestions[0]["kind"] != "increase-load" || suggestions[0]["suggestedLoadKg"] != 51.25 {
		t.Fatalf("missing repeated performance review %s", response.body)
	}
	if !reflect.DeepEqual(state, a.snapshot(alice)) {
		t.Fatal("read-only review changed records")
	}
	requireStatus(t, a.send(http.MethodGet, "/api/v1/progress/review", bob, nil), 200)
	if len(records(t, dataObject(t, a.send(http.MethodGet, "/api/v1/progress/review", bob, nil)), "training")) > 0 {
		t.Fatal("progress data leaked")
	}
}
