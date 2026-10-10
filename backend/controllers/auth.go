package controllers

import (
	"errors"
	"log/slog"
	"net/http"
	"training-app/backend/request"
	"training-app/backend/response"
	"training-app/backend/service"
)

type AuthController struct{ Service *service.AuthService }

func (c *AuthController) Register(w http.ResponseWriter, r *http.Request) {
	var input request.Register
	if err := DecodeJSON(w, r, &input); err != nil {
		WriteError(w, http.StatusBadRequest, err.Error())
		return
	}
	data, err := c.Service.Register(r.Context(), input)
	if err != nil {
		var validation service.ValidationError
		switch {
		case errors.As(err, &validation):
			WriteError(w, http.StatusBadRequest, err.Error())
		case errors.Is(err, service.ErrEmailRegistered):
			WriteError(w, http.StatusConflict, err.Error())
		default:
			slog.Error("registration failed", "error", err)
			WriteError(w, http.StatusInternalServerError, "could not create account")
		}
		return
	}
	WriteJSON(w, http.StatusCreated, response.Response{Success: true, Data: data})
}

func (c *AuthController) Login(w http.ResponseWriter, r *http.Request) {
	var input request.Login
	if err := DecodeJSON(w, r, &input); err != nil {
		WriteError(w, http.StatusBadRequest, err.Error())
		return
	}
	data, err := c.Service.Login(r.Context(), input)
	if err != nil {
		if errors.Is(err, service.ErrInvalidCredentials) {
			WriteError(w, http.StatusUnauthorized, err.Error())
			return
		}
		slog.Error("login failed", "error", err)
		WriteError(w, http.StatusInternalServerError, "could not sign in")
		return
	}
	WriteJSON(w, http.StatusOK, response.Response{Success: true, Data: data})
}
