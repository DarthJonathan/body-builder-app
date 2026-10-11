package integration_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"reflect"
	"testing"
	"time"
	"training-app/backend/catalogue"
	"training-app/backend/dao"
	"training-app/backend/server"
)

func importDocument(t *testing.T, key string) object {
	t.Helper()
	doc := catalogue.Load().Programs[0]
	doc.Key = key
	raw, _ := json.Marshal(doc)
	var value object
	_ = json.Unmarshal(raw, &value)
	return value
}
func documentWorkout(t *testing.T, d object) object { return records(t, d, "workouts")[0] }
func documentPrescription(t *testing.T, d object) object {
	return records(t, documentWorkout(t, d), "exercises")[0]
}

func TestPrivateProgramUpsertsAreAtomicAndRetainReferences(t *testing.T) {
	api := newTestAPI(t)
	alice, _ := api.register("Alice", "import-alice@example.test")
	bob, _ := api.register("Bob", "import-bob@example.test")
	before := api.snapshot(alice)
	doc := importDocument(t, "my-foundation")
	response := api.mutation(alice, before, "import-first", "importProgram", object{"document": doc})
	requireStatus(t, response, 200)
	state := dataObject(t, response)
	p := onlyRecord(t, state, "programs")
	programID := textField(t, p, "id")
	w := documentWorkout(t, p)
	workoutID := textField(t, w, "id")
	rxID := textField(t, documentPrescription(t, p), "id")
	requireStatus(t, api.mutation(alice, before, "import-first", "importProgram", object{"document": doc}), 200)
	if len(records(t, api.snapshot(alice), "programs")) != 1 {
		t.Fatal("retry duplicated program")
	}
	state = api.apply(alice, state, "importProgram", object{"document": doc})
	if textField(t, onlyRecord(t, state, "programs"), "id") != programID {
		t.Fatal("equivalent import changed identity")
	}
	date := time.Now().UTC().Format("2006-01-02")
	state = api.apply(alice, state, "startWorkout", object{"workoutId": workoutID, "date": date})
	history := clone(t, onlyRecord(t, state, "sessions"))
	calendar := records(t, state, "schedule")
	next := clone(t, doc)
	next["name"] = "Foundation revised"
	documentPrescription(t, next)["sets"] = 3
	requireStatus(t, api.mutation(alice, state, "bad-version", "importProgram", object{"document": next}), 409)
	if !reflect.DeepEqual(state, api.snapshot(alice)) {
		t.Fatal("failed import modified state")
	}
	next["version"] = 2
	state = api.apply(alice, state, "importProgram", object{"document": next})
	updated := onlyRecord(t, state, "programs")
	if textField(t, updated, "id") != programID || textField(t, documentWorkout(t, updated), "id") != workoutID || textField(t, documentPrescription(t, updated), "id") != rxID {
		t.Fatal("update replaced IDs")
	}
	if !reflect.DeepEqual(records(t, state, "schedule"), calendar) || !reflect.DeepEqual(onlyRecord(t, state, "sessions"), history) || !reflect.DeepEqual(records(t, state, "targets"), records(t, before, "targets")) {
		t.Fatal("upsert rewrote calendar, historical prescriptions or nutrition")
	}
	invalid := clone(t, next)
	invalid["version"] = 3
	documentPrescription(t, invalid)["exerciseId"] = "unknown"
	requireStatus(t, api.mutation(alice, state, "invalid-exercise", "importProgram", object{"document": invalid}), 400)
	removed := clone(t, next)
	removed["version"] = 3
	removed["daysPerWeek"] = 1
	removed["workouts"] = removed["workouts"].([]any)[1:]
	requireStatus(t, api.mutation(alice, state, "assigned-removal", "importProgram", object{"document": removed}), 400)
	if !reflect.DeepEqual(state, api.snapshot(alice)) {
		t.Fatal("rejected imports were not atomic")
	}
	other := api.apply(bob, api.snapshot(bob), "importProgram", object{"document": doc})
	if textField(t, onlyRecord(t, other, "programs"), "id") == programID {
		t.Fatal("accounts share private program IDs")
	}
	// A fresh router has no in-memory copy of this user's imported records.
	api.server.Close()
	api.server = httptest.NewServer(server.NewRouter(api.db, api.cfg))
	if !reflect.DeepEqual(state, api.snapshot(alice)) {
		t.Fatal("import did not survive restart")
	}
}

func TestSharedLibraryAdminUpsertConflictAndPrivateCopyIsolation(t *testing.T) {
	api := newTestAPI(t)
	admin, user := api.register("Admin", "library-admin@example.test")
	member, _ := api.register("Member", "library-member@example.test")
	if err := api.db.Model(&dao.User{}).Where("id = ?", user["id"]).Update("role", "admin").Error; err != nil {
		t.Fatal(err)
	}
	doc := importDocument(t, "published-foundation")
	payload := object{"document": doc, "baseRevision": 0}
	requireStatus(t, api.send(http.MethodPut, "/api/v1/admin/programs", "", payload), 401)
	requireStatus(t, api.send(http.MethodPut, "/api/v1/admin/programs", member, payload), 403)
	published := api.send(http.MethodPut, "/api/v1/admin/programs", admin, payload)
	requireStatus(t, published, 200)
	template := dataObject(t, published)
	if template["revision"] != float64(1) {
		t.Fatal("missing published revision")
	}
	repeated := api.send(http.MethodPut, "/api/v1/admin/programs", admin, payload)
	requireStatus(t, repeated, 200)
	if !reflect.DeepEqual(dataObject(t, repeated), template) {
		t.Fatal("repeated publication changed revision")
	}
	state := api.apply(member, api.snapshot(member), "useTemplate", object{"templateId": doc["key"]})
	personal := clone(t, onlyRecord(t, state, "programs"))
	for _, path := range []string{"/api/v1/catalogue", "/api/v1/programs/templates"} {
		response := api.send(http.MethodGet, path, member, nil)
		requireStatus(t, response, 200)
		if path == "/api/v1/catalogue" {
			all := dataObject(t, response)
			found := false
			for _, item := range records(t, all, "templates") {
				if item["id"] == doc["key"] {
					found = true
				}
			}
			if !found {
				t.Fatal("catalogue omitted database library")
			}
		}
	}
	changed := clone(t, doc)
	changed["name"] = "Shared Foundation v2"
	requireStatus(t, api.send(http.MethodPut, "/api/v1/admin/programs", admin, object{"document": changed, "baseRevision": 1}), 409)
	changed["version"] = 2
	requireStatus(t, api.send(http.MethodPut, "/api/v1/admin/programs", admin, object{"document": changed, "baseRevision": 0}), 409)
	update := api.send(http.MethodPut, "/api/v1/admin/programs", admin, object{"document": changed, "baseRevision": 1})
	requireStatus(t, update, 200)
	if dataObject(t, update)["revision"] != float64(2) {
		t.Fatal("revision did not advance")
	}
	if !reflect.DeepEqual(onlyRecord(t, api.snapshot(member), "programs"), personal) {
		t.Fatal("publishing modified a user's copy")
	}
	invalid := clone(t, changed)
	invalid["version"] = 3
	documentPrescription(t, invalid)["restSeconds"] = nil
	requireStatus(t, api.send(http.MethodPut, "/api/v1/admin/programs", admin, object{"document": invalid, "baseRevision": 2}), 400)
	api.server.Close()
	api.server = httptest.NewServer(server.NewRouter(api.db, api.cfg))
	restored := api.apply(member, api.snapshot(member), "useTemplate", object{"templateId": doc["key"]})
	if records(t, restored, "programs")[1]["name"] != changed["name"] {
		t.Fatal("published update was not durable")
	}
	if err := api.db.Model(&dao.User{}).Where("id = ?", user["id"]).Update("role", "user").Error; err != nil {
		t.Fatal(err)
	}
	requireStatus(t, api.send(http.MethodPut, "/api/v1/admin/programs", admin, object{"document": changed, "baseRevision": 2}), 403)
}
