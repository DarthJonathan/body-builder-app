package service

import (
	"context"
	"errors"
	"fmt"
	"github.com/golang-jwt/jwt/v5"
	"github.com/hashicorp/go-uuid"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"
	"net/mail"
	"strings"
	"time"
	"training-app/backend/dao"
	"training-app/backend/request"
	"training-app/backend/response"
	"unicode/utf8"
)

var ErrInvalidCredentials = errors.New("email or password is incorrect")
var ErrEmailRegistered = errors.New("email is already registered")

type ValidationError struct{ Message string }

func (e ValidationError) Error() string { return e.Message }

type AuthService struct {
	DB     *gorm.DB
	Secret []byte
	Expiry time.Duration
}

func ValidateRegistration(req request.Register) (request.Register, error) {
	req.Email = strings.ToLower(strings.TrimSpace(req.Email))
	req.DisplayName = strings.TrimSpace(req.DisplayName)
	address, err := mail.ParseAddress(req.Email)
	if err != nil || address.Address != req.Email || len(req.Email) > 254 {
		return req, ValidationError{"enter a valid email address"}
	}
	if utf8.RuneCountInString(req.Password) < 8 || len(req.Password) > 72 {
		return req, ValidationError{"password must have at least 8 characters and at most 72 bytes"}
	}
	if req.DisplayName == "" || utf8.RuneCountInString(req.DisplayName) > 80 {
		return req, ValidationError{"name must have between 1 and 80 characters"}
	}
	return req, nil
}

func (s *AuthService) Register(ctx context.Context, req request.Register) (*response.AuthData, error) {
	req, err := ValidateRegistration(req)
	if err != nil {
		return nil, err
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		return nil, err
	}
	id, err := uuid.GenerateUUID()
	if err != nil {
		return nil, err
	}
	user := dao.User{ID: id, Email: req.Email, DisplayName: req.DisplayName, PasswordHash: string(hash)}
	if err := s.DB.WithContext(ctx).Create(&user).Error; err != nil {
		if errors.Is(err, gorm.ErrDuplicatedKey) {
			return nil, ErrEmailRegistered
		}
		return nil, fmt.Errorf("create user: %w", err)
	}
	return s.issueToken(user)
}

func (s *AuthService) Login(ctx context.Context, req request.Login) (*response.AuthData, error) {
	email := strings.ToLower(strings.TrimSpace(req.Email))
	var user dao.User
	if err := s.DB.WithContext(ctx).Where("email = ?", email).First(&user).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrInvalidCredentials
		}
		return nil, err
	}
	if err := bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(req.Password)); err != nil {
		return nil, ErrInvalidCredentials
	}
	return s.issueToken(user)
}

func (s *AuthService) issueToken(user dao.User) (*response.AuthData, error) {
	now := time.Now().UTC()
	expires := now.Add(s.Expiry)
	claims := jwt.RegisteredClaims{
		Subject:   user.ID,
		Issuer:    "training-app",
		Audience:  jwt.ClaimStrings{"training-app"},
		IssuedAt:  jwt.NewNumericDate(now),
		ExpiresAt: jwt.NewNumericDate(expires),
	}
	token, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString(s.Secret)
	if err != nil {
		return nil, err
	}
	return &response.AuthData{Token: token, ExpiresAt: expires, User: user}, nil
}

func (s *AuthService) ParseToken(raw string) (string, error) {
	claims := &jwt.RegisteredClaims{}
	token, err := jwt.ParseWithClaims(raw, claims, func(token *jwt.Token) (any, error) { return s.Secret, nil },
		jwt.WithValidMethods([]string{"HS256"}), jwt.WithIssuer("training-app"), jwt.WithAudience("training-app"), jwt.WithExpirationRequired())
	if err != nil || !token.Valid || claims.Subject == "" {
		return "", errors.New("invalid or expired session")
	}
	return claims.Subject, nil
}
