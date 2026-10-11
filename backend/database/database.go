package database

import (
	"context"
	"fmt"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
	"time"
	"training-app/backend/config"
	"training-app/backend/dao"
	"training-app/backend/providers"
)

func Open(cfg config.Config) (*gorm.DB, error) {
	db, err := gorm.Open(postgres.Open(cfg.DatabaseURL), &gorm.Config{
		NamingStrategy: dao.NamingStrategy(cfg.Schema),
		Logger:         logger.Default.LogMode(logger.Silent),
		TranslateError: true,
	})
	if err != nil {
		return nil, fmt.Errorf("connect database: %w", err)
	}
	pool, err := db.DB()
	if err != nil {
		return nil, err
	}
	pool.SetMaxIdleConns(5)
	pool.SetMaxOpenConns(20)
	pool.SetConnMaxLifetime(30 * time.Minute)
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	if err := pool.PingContext(ctx); err != nil {
		return nil, fmt.Errorf("ping database: %w", err)
	}
	return db, nil
}

func Migrate(db *gorm.DB, dbSchema string) error {
	// Config validates this identifier before it reaches the database.
	if err := db.Exec(fmt.Sprintf(`CREATE SCHEMA IF NOT EXISTS "%s"`, dbSchema)).Error; err != nil {
		return err
	}
	if err := db.AutoMigrate(&dao.User{}, &dao.TrainingDocument{}, &dao.MutationReceipt{}, &dao.ProgramTemplate{}); err != nil {
		return err
	}
	return providers.Migrate(db)
}
