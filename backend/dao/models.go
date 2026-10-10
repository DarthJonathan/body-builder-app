package dao

import (
	"gorm.io/gorm/schema"
	"time"
)

// The database naming strategy keeps training tables in their own schema.
func NamingStrategy(dbSchema string) schema.NamingStrategy {
	return schema.NamingStrategy{TablePrefix: dbSchema + ".", SingularTable: false}
}

type User struct {
	ID           string    `gorm:"type:uuid;primaryKey" json:"id"`
	Email        string    `gorm:"not null;uniqueIndex;size:254" json:"email"`
	DisplayName  string    `gorm:"not null;size:80" json:"displayName"`
	Role         string    `gorm:"not null;default:user;size:20" json:"role"`
	PasswordHash string    `gorm:"not null" json:"-"`
	CreatedAt    time.Time `json:"createdAt"`
	UpdatedAt    time.Time `json:"updatedAt"`
}
