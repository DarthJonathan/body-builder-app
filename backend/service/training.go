package service

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"time"
	"training-app/backend/catalogue"
	"training-app/backend/dao"
	"training-app/backend/domain"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const MaxSnapshotBytes = 4 * 1024 * 1024

type TrainingError struct {
	Status   int
	Code     string
	Message  string
	Snapshot *domain.AppSnapshot
}

func (e *TrainingError) Error() string { return e.Message }
func invalidTraining(err error) error {
	return &TrainingError{Status: http.StatusBadRequest, Code: "invalid_input", Message: err.Error()}
}
func missingTraining(message string) error {
	return &TrainingError{Status: http.StatusNotFound, Code: "not_found", Message: message}
}

type TrainingService struct {
	DB        *gorm.DB
	Catalogue catalogue.Catalogue
	Now       func() time.Time
}

func NewTrainingService(db *gorm.DB) *TrainingService {
	return &TrainingService{DB: db, Catalogue: catalogue.Load(), Now: time.Now}
}

func emptySnapshot(user dao.User, now time.Time) domain.AppSnapshot {
	return domain.AppSnapshot{
		Profile:  domain.Profile{ID: user.ID, DisplayName: user.DisplayName, Email: user.Email, Role: user.Role, Timezone: "UTC", Unit: "kg", Goal: "build-muscle", GoalStartedAt: now.UTC().Format("2006-01-02")},
		Programs: []domain.Program{}, Schedule: []domain.ScheduleEntry{}, Sessions: []domain.WorkoutSession{}, FoodEntries: []domain.FoodEntry{}, Targets: []domain.NutritionTargets{}, CheckIns: []domain.CheckIn{}, Weights: []domain.WeightEntry{}, Lessons: []domain.Lesson{},
		Provider: domain.ProviderConfig{Provider: "openai", Enabled: false, Configured: false},
	}
}

func (s *TrainingService) now() time.Time {
	if s.Now != nil {
		return s.Now().UTC()
	}
	return time.Now().UTC()
}

func (s *TrainingService) load(tx *gorm.DB, userID string, lock bool) (dao.TrainingDocument, domain.AppSnapshot, error) {
	var user dao.User
	if err := tx.Where("id = ?", userID).First(&user).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return dao.TrainingDocument{}, domain.AppSnapshot{}, &TrainingError{Status: 401, Code: "account_unavailable", Message: "sign in to an available account"}
		}
		return dao.TrainingDocument{}, domain.AppSnapshot{}, err
	}
	initial := emptySnapshot(user, s.now())
	encoded, err := json.Marshal(initial)
	if err != nil {
		return dao.TrainingDocument{}, initial, err
	}
	doc := dao.TrainingDocument{UserID: userID, State: dao.JSON(encoded)}
	if err := tx.Omit("User").Clauses(clause.OnConflict{DoNothing: true}).Create(&doc).Error; err != nil {
		return doc, initial, err
	}
	query := tx.Where("user_id = ?", userID)
	if lock {
		query = query.Clauses(clause.Locking{Strength: "UPDATE"})
	}
	if err := query.First(&doc).Error; err != nil {
		return doc, initial, err
	}
	var state domain.AppSnapshot
	if err := json.Unmarshal(doc.State, &state); err != nil {
		return doc, state, err
	}
	state.Revision = doc.Revision
	state.Profile.ID = user.ID
	state.Profile.Email = user.Email
	state.Profile.Role = user.Role
	return doc, state, nil
}

func (s *TrainingService) GetSnapshot(ctx context.Context, userID string) (domain.AppSnapshot, error) {
	var snapshot domain.AppSnapshot
	err := s.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error { var err error; _, snapshot, err = s.load(tx, userID, false); return err })
	return snapshot, err
}

func (s *TrainingService) Mutate(ctx context.Context, userID string, mutation domain.Mutation) (domain.AppSnapshot, error) {
	if err := domain.Identifier(mutation.ID); err != nil {
		return domain.AppSnapshot{}, invalidTraining(err)
	}
	if mutation.BaseRevision < 0 {
		return domain.AppSnapshot{}, invalidTraining(errors.New("revision cannot be negative"))
	}
	if len(mutation.Payload) == 0 || len(mutation.Payload) > 1024*1024 {
		return domain.AppSnapshot{}, invalidTraining(errors.New("mutation payload is missing or too large"))
	}
	// Whitespace has no semantic effect, but changing an operation under a retry ID does.
	var compact bytes.Buffer
	if err := json.Compact(&compact, mutation.Payload); err != nil {
		return domain.AppSnapshot{}, invalidTraining(errors.New("invalid mutation payload"))
	}
	hash := sha256.Sum256(append([]byte(mutation.Operation+"\n"), compact.Bytes()...))
	mutationHash := hex.EncodeToString(hash[:])
	var result domain.AppSnapshot
	err := s.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		doc, state, err := s.load(tx, userID, true)
		if err != nil {
			return err
		}
		result = state
		var receipt dao.MutationReceipt
		err = tx.Where("user_id = ? AND mutation_id = ?", userID, mutation.ID).First(&receipt).Error
		if err == nil {
			if receipt.PayloadHash != mutationHash {
				return &TrainingError{Status: 409, Code: "retry_mismatch", Message: "this retry ID was already used for a different change"}
			}
			return nil
		}
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		if doc.Revision != mutation.BaseRevision {
			return &TrainingError{Status: 409, Code: "revision_conflict", Message: "another device changed this account; review your pending changes before syncing", Snapshot: &result}
		}
		if err := s.apply(&state, mutation.Operation, mutation.Payload); err != nil {
			return err
		}
		if len(state.Programs) > 100 || len(state.Schedule) > 5000 || len(state.Sessions) > 5000 || len(state.FoodEntries) > 20000 || len(state.Lessons) > 5000 || len(state.CheckIns) > 5000 || len(state.Targets) > 5000 || len(state.Weights) > 5000 {
			return invalidTraining(errors.New("this account has reached its record limit"))
		}
		state.Revision = doc.Revision + 1
		// Provider configuration is global, never persisted in a user's document.
		state.Provider = domain.ProviderConfig{Provider: "openai"}
		encoded, err := json.Marshal(state)
		if err != nil {
			return err
		}
		if len(encoded) > MaxSnapshotBytes {
			return invalidTraining(errors.New("this account has reached its storage limit"))
		}
		if err := tx.Model(&dao.TrainingDocument{}).Where("user_id = ?", userID).Updates(map[string]any{"state": dao.JSON(encoded), "revision": state.Revision}).Error; err != nil {
			return err
		}
		if mutation.Operation == "updateProfile" {
			if err := tx.Model(&dao.User{}).Where("id = ?", userID).Update("display_name", state.Profile.DisplayName).Error; err != nil {
				return err
			}
		}
		if err := tx.Create(&dao.MutationReceipt{UserID: userID, MutationID: mutation.ID, PayloadHash: mutationHash, Revision: state.Revision}).Error; err != nil {
			return err
		}
		result = state
		return nil
	})
	return result, err
}

func decodePayload[T any](encoded json.RawMessage) (T, error) {
	var value T
	encoded = bytes.TrimSpace(encoded)
	if len(encoded) == 0 || encoded[0] != '{' {
		return value, invalidTraining(errors.New("payload must be an object"))
	}
	d := json.NewDecoder(bytes.NewReader(encoded))
	d.DisallowUnknownFields()
	if err := d.Decode(&value); err != nil {
		return value, invalidTraining(errors.New("payload contains missing, invalid, or unsupported fields"))
	}
	if err := d.Decode(&struct{}{}); err != io.EOF {
		return value, invalidTraining(errors.New("payload must contain one object"))
	}
	return value, nil
}
