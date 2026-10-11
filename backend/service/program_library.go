package service

import (
	"context"
	"encoding/json"
	"errors"
	"training-app/backend/dao"
	"training-app/backend/domain"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type PublishProgram struct {
	Document     domain.ProgramDocument `json:"document"`
	BaseRevision int64                  `json:"baseRevision"`
}

func (s *TrainingService) ProgramTemplates(ctx context.Context) ([]domain.ProgramTemplate, error) {
	result := append([]domain.ProgramTemplate{}, s.Catalogue.Templates...)
	if s.DB == nil {
		return result, nil
	}
	var rows []dao.ProgramTemplate
	if err := s.DB.WithContext(ctx).Order("key").Find(&rows).Error; err != nil {
		return nil, err
	}
	for _, row := range rows {
		var doc domain.ProgramDocument
		if err := json.Unmarshal(row.Definition, &doc); err != nil {
			return nil, err
		}
		template := domain.TemplateFromDocument(doc, s.Catalogue.Exercises, s.Catalogue.Muscles, row.Revision)
		at := -1
		for i, item := range result {
			if item.ID == row.Key {
				at = i
				break
			}
		}
		if at < 0 {
			result = append(result, template)
		} else {
			result[at] = template
		}
	}
	return result, nil
}
func (s *TrainingService) findProgramTemplate(key string) (*domain.ProgramTemplate, error) {
	if s.DB != nil {
		var row dao.ProgramTemplate
		err := s.DB.Where("key = ?", key).First(&row).Error
		if err == nil {
			var doc domain.ProgramDocument
			if err := json.Unmarshal(row.Definition, &doc); err != nil {
				return nil, err
			}
			p := domain.TemplateFromDocument(doc, s.Catalogue.Exercises, s.Catalogue.Muscles, row.Revision)
			return &p, nil
		}
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, err
		}
	}
	for _, p := range s.Catalogue.Templates {
		if p.ID == key {
			return &p, nil
		}
	}
	return nil, missingTraining("that starter template is unavailable")
}
func (s *TrainingService) PublishProgram(ctx context.Context, userID string, input PublishProgram) (domain.ProgramTemplate, error) {
	known := map[string]bool{}
	for _, e := range s.Catalogue.Exercises {
		known[e.ID] = true
	}
	if err := domain.ValidateProgramDocument(input.Document, known); err != nil {
		return domain.ProgramTemplate{}, invalidTraining(err)
	}
	if input.BaseRevision < 0 {
		return domain.ProgramTemplate{}, invalidTraining(errors.New("revision cannot be negative"))
	}
	var result domain.ProgramTemplate
	err := s.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var user dao.User
		if err := tx.Where("id = ? AND role = ?", userID, "admin").First(&user).Error; err != nil {
			return &TrainingError{Status: 403, Code: "admin_required", Message: "only an administrator can publish shared programs"}
		}
		// Serialize library writes, including absent rows and the global size limit.
		if err := tx.Exec("SELECT pg_advisory_xact_lock(hashtext(?))", "bodybuilder-program-library").Error; err != nil {
			return err
		}
		var row dao.ProgramTemplate
		err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("key = ?", input.Document.Key).First(&row).Error
		found := err == nil
		if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		var existing *domain.ProgramDocument
		if found {
			var doc domain.ProgramDocument
			if err := json.Unmarshal(row.Definition, &doc); err != nil {
				return err
			}
			existing = &doc
			if domain.SameProgramDocument(doc, input.Document) {
				result = domain.TemplateFromDocument(doc, s.Catalogue.Exercises, s.Catalogue.Muscles, row.Revision)
				return nil
			}
		} else {
			for i := range s.Catalogue.Programs {
				if s.Catalogue.Programs[i].Key == input.Document.Key {
					existing = &s.Catalogue.Programs[i]
					break
				}
			}
			for _, legacy := range s.Catalogue.Templates {
				if legacy.ID == input.Document.Key && legacy.Details == nil {
					return invalidTraining(errors.New("use a new key for a source-based legacy template"))
				}
			}
		}
		if row.Revision != input.BaseRevision {
			return &TrainingError{Status: 409, Code: "library_revision_conflict", Message: "another administrator updated this template; reload the library before publishing"}
		}
		if existing != nil && !domain.SameProgramDocument(*existing, input.Document) && input.Document.Version <= existing.Version {
			return &TrainingError{Status: 409, Code: "program_version_conflict", Message: "increase the document version before updating this template"}
		}
		if !found {
			var count int64
			if err := tx.Model(&dao.ProgramTemplate{}).Count(&count).Error; err != nil {
				return err
			}
			if count >= 200 {
				return invalidTraining(errors.New("the shared library already has 200 published templates"))
			}
		}
		encoded, err := json.Marshal(input.Document)
		if err != nil {
			return err
		}
		row.Key = input.Document.Key
		row.Revision++
		row.Definition = dao.JSON(encoded)
		row.UpdatedBy = userID
		if err := tx.Save(&row).Error; err != nil {
			return err
		}
		result = domain.TemplateFromDocument(input.Document, s.Catalogue.Exercises, s.Catalogue.Muscles, row.Revision)
		return nil
	})
	return result, err
}
