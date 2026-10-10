package controllers

import (
	"net/http/httptest"
	"strings"
	"testing"
)

func TestDecodeJSONRejectsUnknownTrailingAndOversizedBodies(t *testing.T) {
	for _, body := range []string{
		`{"name":"Ivana","userId":"another-user"}`,
		`{"name":"Ivana"} {"name":"Nathan"}`,
		`{"name":"` + strings.Repeat("a", 256*1024) + `"}`,
		``,
	} {
		var input struct {
			Name string `json:"name"`
		}
		req := httptest.NewRequest("POST", "/", strings.NewReader(body))
		if err := DecodeJSON(httptest.NewRecorder(), req, &input); err == nil {
			t.Error("invalid or oversized request accepted")
		}
	}
}
