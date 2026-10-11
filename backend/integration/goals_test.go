package integration_test

import (
	"net/http"
	"net/http/httptest"
	"reflect"
	"testing"
	"time"

	"training-app/backend/dao"
	"training-app/backend/server"
)

func goalAnswers() object {
	date := time.Now().UTC().Format("2006-01-02")
	return object{"goal": "build-muscle", "startDate": date, "experience": "beginner", "restrictions": "none", "equipment": "full-gym", "daysPerWeek": 3, "sessionMinutes": 45, "focus": "balanced", "split": "full-body", "workoutDays": []int{0, 2, 4}, "nutritionExperience": "new", "pace": "gentle", "nutrition": object{"age": 30, "sex": "male", "heightCm": 175, "weightKg": 70, "activity": "moderate", "goal": "build-muscle", "effectiveDate": date, "calorieAdjustment": 150, "proteinPerKg": 1.6, "fatPercent": 25}}
}

func goalInput(t *testing.T, a *testAPI, token string, answers object) object {
	t.Helper()
	response := a.send(http.MethodPost, "/api/v1/goals/preview", token, answers)
	requireStatus(t, response, http.StatusOK)
	if response.header.Get("Cache-Control") != "no-store" {
		t.Fatal("goal previews must not be publicly cached")
	}
	p := dataObject(t, response)
	return object{"version": p["version"], "answers": answers, "targets": p["targets"], "schedulePolicy": "replace-upcoming"}
}

func recentEnergy() object {
	now := time.Now().UTC()
	days := []any{}
	for i := 7; i >= 1; i-- {
		days = append(days, object{"date": now.AddDate(0, 0, -i).Format("2006-01-02"), "restingCalories": 1600, "activeCalories": 400, "coverageHours": 24, "dayHours": 24})
	}
	return object{"source": "apple-health", "syncedAt": now.Format(time.RFC3339Nano), "timezone": "UTC", "sources": []string{"Synthetic Watch"}, "days": days}
}

func TestGoalPreviewAndAtomicCreationArePrivateDurableAndRetrySafe(t *testing.T) {
	a := newTestAPI(t)
	token, user := a.register("Goal Account", "goal-account@example.test")
	other, _ := a.register("Other Goal Account", "other-goal@example.test")
	before := a.snapshot(token)
	answers := goalAnswers()
	requireStatus(t, a.send(http.MethodPost, "/api/v1/goals/preview", "", answers), http.StatusUnauthorized)
	input := goalInput(t, a, token, answers)
	if !reflect.DeepEqual(before, a.snapshot(token)) {
		t.Fatal("preview saved a program, goal, targets, or schedule")
	}
	requireNoAIUsage(t, a, user)
	var count int64
	if err := a.db.Model(&dao.MutationReceipt{}).Where("user_id = ?", user["id"]).Count(&count).Error; err != nil || count != 0 {
		t.Fatal("an unsaved preview wrote a mutation receipt")
	}
	targets := input["targets"].(map[string]any)
	targets["mode"], targets["manuallyOverridden"], targets["calories"] = "manual", true, 2400
	response := a.mutation(token, before, "create-goal-retry", "createGoalPlan", input)
	requireStatus(t, response, http.StatusOK)
	saved := dataObject(t, response)
	if saved["revision"].(float64) != before["revision"].(float64)+1 || len(records(t, saved, "schedule")) != 28 {
		t.Fatal("goal, program, targets, profile and four-week schedule did not commit in one revision")
	}
	program := onlyRecord(t, saved, "programs")
	goal := onlyRecord(t, saved, "goalPlans")
	if program["id"] == "goal-preview" || saved["activeProgramId"] != program["id"] || goal["programId"] != program["id"] {
		t.Fatal("goal must reference its new private program")
	}
	if onlyRecord(t, saved, "targets")["calories"] != float64(2400) || goal["targets"].(map[string]any)["id"] != onlyRecord(t, saved, "targets")["id"] {
		t.Fatal("manual override did not persist with the goal's original estimate")
	}
	if saved["profile"].(map[string]any)["startWeight"] != float64(70) {
		t.Fatal("the goal's starting weight did not persist")
	}
	current := a.apply(token, saved, "saveLesson", lesson("after-goal", "Saved after the goal"))
	requireStatus(t, a.mutation(token, before, "create-goal-retry", "createGoalPlan", input), http.StatusOK)
	if !reflect.DeepEqual(current, a.snapshot(token)) {
		t.Fatal("retry duplicated the goal or replaced later edits")
	}
	private := a.snapshot(other)
	if private["goalPlans"] != nil || private["healthEnergy"] != nil || len(records(t, private, "programs")) != 0 || len(records(t, private, "targets")) != 0 {
		t.Fatal("another account can see private goal data")
	}
	restarted := httptest.NewServer(server.NewRouter(a.db, a.cfg))
	defer restarted.Close()
	original := a.server
	a.server = restarted
	durable := a.snapshot(token)
	a.server = original
	if !reflect.DeepEqual(current, durable) {
		t.Fatal("new API router lost the persisted goal")
	}
}

func TestGoalFailuresRollBackAndProtectExistingSessionsAndLogs(t *testing.T) {
	a := newTestAPI(t)
	token, _ := a.register("Goal History", "goal-history@example.test")
	today := time.Now().UTC()
	date, tomorrow := today.Format("2006-01-02"), today.AddDate(0, 0, 1).Format("2006-01-02")
	state := a.apply(token, a.snapshot(token), "saveProgram", personalProgram())
	state = a.apply(token, state, "assignWorkout", object{"date": date, "workoutId": "personal-workout"})
	state = a.apply(token, state, "startWorkout", object{"date": date, "workoutId": "personal-workout"})
	state = a.apply(token, state, "assignWorkout", object{"date": tomorrow, "workoutId": "personal-workout"})
	state = a.apply(token, state, "saveFood", food("retained-food", date, "Retained lunch"))
	input := goalInput(t, a, token, goalAnswers())
	for _, corrupt := range []func(object){
		func(v object) { v["targets"].(map[string]any)["calculation"].(map[string]any)["restingCalories"] = 999 },
		func(v object) { v["answers"].(map[string]any)["workoutDays"] = []int{0, 0, 4} },
		func(v object) { v["version"] = "invented-version" },
		func(v object) { v["schedulePolicy"] = "delete-everything" },
		func(v object) {
			old := today.AddDate(0, 0, -1).Format("2006-01-02")
			answer := v["answers"].(map[string]any)
			answer["startDate"], answer["nutrition"].(map[string]any)["effectiveDate"] = old, old
			target := v["targets"].(map[string]any)
			target["effectiveDate"], target["calculation"].(map[string]any)["input"].(map[string]any)["effectiveDate"] = old, old
		},
	} {
		bad := clone(t, input)
		corrupt(bad)
		requireStatus(t, a.mutation(token, state, "rejected-goal", "createGoalPlan", bad), http.StatusBadRequest)
		if !reflect.DeepEqual(state, a.snapshot(token)) {
			t.Fatal("a rejected goal partially changed account data")
		}
	}
	base := clone(t, state)
	state = a.apply(token, state, "saveLesson", lesson("revision-change", "Another device changed this account"))
	requireStatus(t, a.mutation(token, base, "stale-goal", "createGoalPlan", input), http.StatusConflict)
	if !reflect.DeepEqual(state, a.snapshot(token)) {
		t.Fatal("stale creation changed the account")
	}
	input["schedulePolicy"] = "keep-existing"
	kept := a.apply(token, state, "createGoalPlan", input)
	for _, day := range []string{date, tomorrow} {
		for _, entry := range records(t, kept, "schedule") {
			if entry["date"] == day && entry["workoutId"] != "personal-workout" {
				t.Fatal("keep-existing changed an assigned day")
			}
		}
	}
	input["schedulePolicy"] = "replace-upcoming"
	replaced := a.apply(token, kept, "createGoalPlan", input)
	for _, entry := range records(t, replaced, "schedule") {
		if entry["date"] == date && entry["workoutId"] != "personal-workout" {
			t.Fatal("replace-upcoming changed a started session date")
		}
		if entry["date"] == tomorrow && entry["workoutId"] == "personal-workout" {
			t.Fatal("replace-upcoming failed to replace an unstarted assigned date")
		}
	}
	for _, field := range []string{"sessions", "foodEntries", "lessons"} {
		if !reflect.DeepEqual(state[field], replaced[field]) {
			t.Fatalf("goal creation changed %s history", field)
		}
	}
	if len(records(t, replaced, "programs")) != 3 || len(records(t, replaced, "goalPlans")) != 2 || len(records(t, replaced, "targets")) != 1 {
		t.Fatal("creation lost programs or duplicated same-date targets")
	}
}

func TestHealthSummaryValidationAndDatedGoalProvenance(t *testing.T) {
	a := newTestAPI(t)
	token, _ := a.register("Health Account", "health-account@example.test")
	state := a.snapshot(token)
	energy := recentEnergy()
	for _, corrupt := range []func(object){
		func(h object) { delete(h["days"].([]any)[0].(map[string]any), "activeCalories") },
		func(h object) { h["days"].([]any)[0].(map[string]any)["coverageHours"] = 12 },
		func(h object) { h["syncedAt"] = time.Now().Add(-48 * time.Hour).UTC().Format(time.RFC3339Nano) },
		func(h object) { h["syncedAt"] = time.Now().Add(time.Hour).UTC().Format(time.RFC3339Nano) },
	} {
		bad := clone(t, energy)
		corrupt(bad)
		requireStatus(t, a.mutation(token, state, "bad-health", "saveHealthEnergy", object{"energy": bad}), http.StatusBadRequest)
		if !reflect.DeepEqual(state, a.snapshot(token)) {
			t.Fatal("invalid Health data changed the account")
		}
	}
	state = a.apply(token, state, "saveHealthEnergy", object{"energy": energy})
	if !reflect.DeepEqual(state["healthEnergy"], clone(t, energy)) || len(records(t, state, "targets")) != 0 {
		t.Fatal("sync must save only the summary, without silently recalculating targets")
	}
	answers := goalAnswers()
	answers["nutrition"].(map[string]any)["healthEnergy"] = energy
	input := goalInput(t, a, token, answers)
	if input["targets"].(map[string]any)["calories"] != float64(2150) {
		t.Fatal("Apple Health maintenance was multiplied by activity again")
	}
	state = a.apply(token, state, "createGoalPlan", input)
	calculation := onlyRecord(t, state, "targets")["calculation"].(map[string]any)
	if calculation["version"] != "apple-health-energy-v1" || calculation["maintenanceCalories"] != float64(2000) {
		t.Fatal("the dated target has false energy provenance")
	}
	cleared := a.apply(token, state, "saveHealthEnergy", object{"energy": nil})
	if cleared["healthEnergy"] != nil || !reflect.DeepEqual(state["targets"], cleared["targets"]) || !reflect.DeepEqual(state["goalPlans"], cleared["goalPlans"]) {
		t.Fatal("removing a current Health summary rewrote historical estimates")
	}
}
