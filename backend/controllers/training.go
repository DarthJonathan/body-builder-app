package controllers

import (
	"errors"
	"log/slog"
	"net/http"
	"training-app/backend/domain"
	"training-app/backend/response"
	"training-app/backend/service"
)

type TrainingController struct {
	Service  *service.TrainingService
	UserID   func(*http.Request) string
	Decorate func(*http.Request, *domain.AppSnapshot) error
}

func (c *TrainingController) Snapshot(w http.ResponseWriter, r *http.Request) {
	data, err := c.Service.GetSnapshot(r.Context(), c.UserID(r))
	if err != nil {
		TrainingFailure(w, err)
		return
	}
	if c.Decorate != nil {
		if err := c.Decorate(r, &data); err != nil {
			TrainingFailure(w, err)
			return
		}
	}
	WriteJSON(w, 200, response.Response{Success: true, Data: data})
}
func (c *TrainingController) Mutate(w http.ResponseWriter, r *http.Request) {
	var mutation domain.Mutation
	if err := DecodeJSONLimit(w, r, &mutation, 1024*1024+4096); err != nil {
		WriteError(w, 400, err.Error())
		return
	}
	data, err := c.Service.Mutate(r.Context(), c.UserID(r), mutation)
	if err != nil {
		var failure *service.TrainingError
		if errors.As(err, &failure) && failure.Snapshot != nil && c.Decorate != nil {
			if decorated := c.Decorate(r, failure.Snapshot); decorated != nil {
				TrainingFailure(w, decorated)
				return
			}
		}
		TrainingFailure(w, err)
		return
	}
	if c.Decorate != nil {
		if err := c.Decorate(r, &data); err != nil {
			TrainingFailure(w, err)
			return
		}
	}
	WriteJSON(w, 200, response.Response{Success: true, Data: data})
}
func TrainingFailure(w http.ResponseWriter, err error) {
	var failure *service.TrainingError
	if errors.As(err, &failure) {
		WriteJSON(w, failure.Status, response.Response{Success: false, Error: failure.Message, Code: failure.Code, Data: failure.Snapshot})
		return
	}
	slog.Error("training operation failed", "error", err)
	WriteError(w, 500, "could not save or load your training data; please try again")
}
