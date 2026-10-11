package dao

import (
	"database/sql/driver"
	"fmt"
	"time"
)

type JSON []byte

func (j JSON) Value() (driver.Value, error) { return string(j), nil }
func (j *JSON) Scan(value any) error {
	switch v := value.(type) {
	case []byte:
		*j = append((*j)[:0], v...)
	case string:
		*j = append((*j)[:0], v...)
	default:
		return fmt.Errorf("unexpected JSON value type %T", value)
	}
	return nil
}

// A document lock makes cross-record invariants and mutation retries atomic.
type TrainingDocument struct {
	UserID    string `gorm:"type:uuid;primaryKey"`
	User      User   `gorm:"foreignKey:UserID;constraint:OnDelete:CASCADE" json:"-"`
	Revision  int64  `gorm:"not null;default:0"`
	State     JSON   `gorm:"type:jsonb;not null"`
	CreatedAt time.Time
	UpdatedAt time.Time
}

type MutationReceipt struct {
	UserID      string `gorm:"type:uuid;primaryKey"`
	MutationID  string `gorm:"primaryKey;size:180"`
	PayloadHash string `gorm:"not null;size:64"`
	Revision    int64  `gorm:"not null"`
	CreatedAt   time.Time
}

// Shared starter templates are independent from users' private program copies.
type ProgramTemplate struct {
	Key        string `gorm:"primaryKey;size:80"`
	Revision   int64  `gorm:"not null"`
	Definition JSON   `gorm:"type:jsonb;not null"`
	UpdatedBy  string `gorm:"type:uuid;not null"`
	CreatedAt  time.Time
	UpdatedAt  time.Time
}
