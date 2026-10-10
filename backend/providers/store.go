package providers

import (
	"context"
	"errors"
	"net/http"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// Config is the single global settings row. Ciphertext includes its random nonce.
// Never serialize this persistence record; PublicConfig returns a safe API view.
type Config struct {
	ID                uint      `gorm:"primaryKey" json:"-"`
	Provider          string    `gorm:"size:30;not null" json:"-"`
	Model             string    `gorm:"size:200;not null" json:"-"`
	Enabled           bool      `gorm:"not null" json:"-"`
	EncryptedKey      []byte    `gorm:"type:bytea" json:"-"`
	DailyRequestLimit int       `gorm:"not null" json:"-"`
	CreatedAt         time.Time `json:"-"`
	UpdatedAt         time.Time `json:"-"`
}

// Usage counters survive server restarts and are atomically locked per user/day.
type Usage struct {
	UserID    string    `gorm:"primaryKey;size:128" json:"-"`
	Day       string    `gorm:"primaryKey;size:10" json:"-"`
	Requests  int       `gorm:"not null" json:"-"`
	CreatedAt time.Time `json:"-"`
	UpdatedAt time.Time `json:"-"`
}

func Migrate(db *gorm.DB) error {
	return db.AutoMigrate(&Config{}, &Usage{})
}

func defaultConfig() Config {
	return Config{ID: 1, Provider: "openai", DailyRequestLimit: DefaultDailyRequestLimit}
}

type gormStore struct{ db *gorm.DB }

func (store gormStore) Load(ctx context.Context) (Config, error) {
	var config Config
	err := store.db.WithContext(ctx).First(&config, 1).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return defaultConfig(), nil
	}
	return config, err
}

func (store gormStore) Update(ctx context.Context, apply func(*Config) error) (Config, error) {
	var config Config
	err := store.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		initial := defaultConfig()
		if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&initial).Error; err != nil {
			return err
		}
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&config, 1).Error; err != nil {
			return err
		}
		if err := apply(&config); err != nil {
			return err
		}
		return tx.Save(&config).Error
	})
	return config, err
}

func (store gormStore) Reserve(ctx context.Context, userID, day string, limit int) error {
	return store.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		usage := Usage{UserID: userID, Day: day}
		if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&usage).Error; err != nil {
			return err
		}
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("user_id = ? AND day = ?", userID, day).First(&usage).Error; err != nil {
			return err
		}
		if usage.Requests >= limit {
			return apiError(http.StatusTooManyRequests, "daily_ai_limit", "Your daily AI request limit has been reached. It resets at midnight UTC.")
		}
		return tx.Model(&Usage{}).Where("user_id = ? AND day = ?", userID, day).UpdateColumn("requests", usage.Requests+1).Error
	})
}
