package middleware

import (
	"context"
	"net/http"
	"strings"
	"training-app/backend/controllers"
	"training-app/backend/dao"
	"training-app/backend/service"
)

type contextKey string

const userIDKey contextKey = "userID"

func UserID(ctx context.Context) string {
	id, _ := ctx.Value(userIDKey).(string)
	return id
}

func Auth(auth *service.AuthService) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			parts := strings.Fields(r.Header.Get("Authorization"))
			if len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") {
				controllers.WriteError(w, http.StatusUnauthorized, "sign in to continue")
				return
			}
			id, err := auth.ParseToken(parts[1])
			if err != nil {
				controllers.WriteError(w, http.StatusUnauthorized, "your session has expired")
				return
			}
			var user dao.User
			if auth.DB == nil || auth.DB.WithContext(r.Context()).Select("id").Where("id = ?", id).First(&user).Error != nil {
				controllers.WriteError(w, http.StatusUnauthorized, "account unavailable; sign in again")
				return
			}
			next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), userIDKey, id)))
		})
	}
}
