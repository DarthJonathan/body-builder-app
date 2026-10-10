package service

import (
	"github.com/golang-jwt/jwt/v5"
	"strings"
	"testing"
	"time"
	"training-app/backend/request"
)

func TestRegistrationPreservesPasswordAndNormalizesIdentity(t *testing.T) {
	password := "  password with spaces  "
	result, err := ValidateRegistration(request.Register{Email: "  IVANA@example.com  ", DisplayName: " Ivana ", Password: password})
	if err != nil {
		t.Fatal(err)
	}
	if result.Email != "ivana@example.com" || result.DisplayName != "Ivana" {
		t.Fatalf("identity not normalized: %#v", result)
	}
	if result.Password != password {
		t.Fatal("password was modified")
	}
}

func TestRegistrationRejectsInvalidIdentityAndBcryptOverflow(t *testing.T) {
	inputs := []request.Register{
		{Email: "not-an-email", DisplayName: "Ivana", Password: "password123"},
		{Email: "Name <ivana@example.com>", DisplayName: "Ivana", Password: "password123"},
		{Email: "ivana@example.com", DisplayName: " ", Password: "password123"},
		{Email: "ivana@example.com", DisplayName: "Ivana", Password: "short"},
		{Email: "ivana@example.com", DisplayName: "Ivana", Password: strings.Repeat("é", 37)},
	}
	for _, input := range inputs {
		if _, err := ValidateRegistration(input); err == nil {
			t.Errorf("accepted invalid input: email=%q, name=%q, password bytes=%d", input.Email, input.DisplayName, len(input.Password))
		}
	}
}

func TestSessionRejectsWrongSignerAlgorithmAudienceAndExpiry(t *testing.T) {
	secret := []byte(strings.Repeat("a", 32))
	service := &AuthService{Secret: secret}
	valid := jwt.RegisteredClaims{Subject: "user-one", Issuer: "training-app", Audience: jwt.ClaimStrings{"training-app"}, ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Hour))}
	type tokenCase struct {
		name      string
		algorithm jwt.SigningMethod
		claims    jwt.RegisteredClaims
		key       []byte
		valid     bool
	}
	expired := valid
	expired.ExpiresAt = jwt.NewNumericDate(time.Now().Add(-time.Hour))
	noExpiry := valid
	noExpiry.ExpiresAt = nil
	wrongAudience := valid
	wrongAudience.Audience = jwt.ClaimStrings{"another-app"}
	noUser := valid
	noUser.Subject = ""
	cases := []tokenCase{
		{"valid", jwt.SigningMethodHS256, valid, secret, true},
		{"wrong signer", jwt.SigningMethodHS256, valid, []byte(strings.Repeat("b", 32)), false},
		{"wrong algorithm", jwt.SigningMethodHS384, valid, secret, false},
		{"expired", jwt.SigningMethodHS256, expired, secret, false},
		{"no expiry", jwt.SigningMethodHS256, noExpiry, secret, false},
		{"wrong audience", jwt.SigningMethodHS256, wrongAudience, secret, false},
		{"no identity", jwt.SigningMethodHS256, noUser, secret, false},
	}
	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			raw, err := jwt.NewWithClaims(test.algorithm, test.claims).SignedString(test.key)
			if err != nil {
				t.Fatal(err)
			}
			id, err := service.ParseToken(raw)
			if test.valid && (err != nil || id != "user-one") {
				t.Fatalf("valid session failed: %v", err)
			}
			if !test.valid && err == nil {
				t.Fatal("unsafe session accepted")
			}
		})
	}
	if _, err := service.ParseToken("broken-token"); err == nil {
		t.Fatal("malformed token accepted")
	}
}
