package response

import (
	"time"
	"training-app/backend/dao"
)

type Response struct {
	Success bool   `json:"success"`
	Error   string `json:"error,omitempty"`
	Code    string `json:"code,omitempty"`
	Data    any    `json:"data,omitempty"`
}

type AuthData struct {
	Token     string    `json:"token"`
	ExpiresAt time.Time `json:"expiresAt"`
	User      dao.User  `json:"user"`
}
