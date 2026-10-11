package service

import (
	"context"
	"errors"
	"reflect"
	"time"
	"training-app/backend/domain"
)

func activeGoalProgram(data *domain.AppSnapshot) *domain.Program {
	for i := range data.Programs {
		if data.Programs[i].ID == data.ActiveProgramID {
			return &data.Programs[i]
		}
	}
	return nil
}
func (s *TrainingService) goalPreview(ctx context.Context, data *domain.AppSnapshot, a domain.GoalAnswers) (domain.GoalPreview, error) {
	if a.Nutrition.HealthEnergy != nil {
		if err := domain.ValidateRecentHealthEnergy(*a.Nutrition.HealthEnergy, s.now()); err != nil {
			return domain.GoalPreview{}, invalidTraining(err)
		}
	}
	if a.TrainingPriority != "" || a.ProgramSelection != nil {
		if err := domain.ValidateGoalAnswers(a); err != nil {
			return domain.GoalPreview{}, invalidTraining(err)
		}
		library, err := s.ProgramTemplates(ctx)
		if err != nil {
			return domain.GoalPreview{}, err
		}
		preview, err := domain.PreviewExpertGoal(a, library, *data, s.Catalogue.ExpertRules, s.Catalogue.Exercises)
		if err != nil {
			return domain.GoalPreview{}, &TrainingError{Status: 409, Code: "program_selection_changed", Message: err.Error()}
		}
		return preview, nil
	}
	preview, err := domain.PreviewGoal(a, s.Catalogue.GoalRules, s.Catalogue.Exercises, s.Catalogue.Muscles, activeGoalProgram(data))
	if err != nil {
		return domain.GoalPreview{}, invalidTraining(err)
	}
	return preview, nil
}
func (s *TrainingService) PreviewGoalPlan(ctx context.Context, userID string, a domain.GoalAnswers) (domain.GoalPreview, error) {
	data, err := s.GetSnapshot(ctx, userID)
	if err != nil {
		return domain.GoalPreview{}, err
	}
	return s.goalPreview(ctx, &data, a)
}
func (s *TrainingService) createGoalPlan(data *domain.AppSnapshot, in domain.CreateGoalPlan) error {
	if in.Version != domain.GoalVersion && in.Version != domain.ExpertGoalVersion {
		return invalidTraining(errors.New("unsupported goal plan version"))
	}
	if err := domain.Choice(in.SchedulePolicy, "schedule policy", "keep-existing", "replace-upcoming"); err != nil {
		return invalidTraining(err)
	}
	if in.Version == domain.ExpertGoalVersion && (in.Answers.TrainingPriority == "" || in.Answers.ProgramSelection == nil) || in.Version == domain.GoalVersion && (in.Answers.TrainingPriority != "" || in.Answers.ProgramSelection != nil) {
		return invalidTraining(errors.New("goal version must match the reviewed program selection"))
	}
	ctx := context.Background()
	if s.DB != nil {
		ctx = s.DB.Statement.Context
		if in.Version == domain.ExpertGoalVersion {
			if err := s.DB.Exec("SELECT pg_advisory_xact_lock_shared(hashtext(?))", "bodybuilder-program-library").Error; err != nil {
				return err
			}
		}
	}
	preview, err := s.goalPreview(ctx, data, in.Answers)
	if err != nil {
		return err
	}
	if err := domain.ValidateTargets(in.Targets); err != nil {
		return invalidTraining(err)
	}
	if in.Targets.EffectiveDate != in.Answers.StartDate || !reflect.DeepEqual(in.Targets.Calculation, preview.Targets.Calculation) {
		return invalidTraining(errors.New("preview the current goal inputs before creating your plan"))
	}
	zone, err := time.LoadLocation(data.Profile.Timezone)
	if err != nil {
		zone = time.UTC
	}
	today := s.now().In(zone)
	if in.Answers.StartDate < today.Format("2006-01-02") || in.Answers.StartDate > today.AddDate(0, 0, 28).Format("2006-01-02") {
		return invalidTraining(errors.New("start your new goal today or within the next 28 days"))
	}
	if len(data.GoalPlans) >= 100 {
		return invalidTraining(errors.New("this account already has 100 goal plans"))
	}
	program := preview.Program
	if in.Answers.Restrictions == "none" {
		program.ID = newRecordID("program")
		for i := range program.Workouts {
			w := &program.Workouts[i]
			w.ID = newRecordID("workout")
			for j := range w.Exercises {
				w.Exercises[j].ID = newRecordID("prescription")
			}
		}
		if program.Details != nil {
			details := *program.Details
			details.Key = "copy-" + program.ID
			program.Details = &details
		}
		data.Programs = append(data.Programs, program)
		data.ActiveProgramID = program.ID
	}
	targets := in.Targets
	targets.ID = newRecordID("targets")
	for _, existing := range data.Targets {
		if existing.EffectiveDate == targets.EffectiveDate {
			targets.ID = existing.ID
		}
	}
	data.Targets = upsert(data.Targets, targets, func(t domain.NutritionTargets) string { return t.ID })
	data.Profile.Goal = in.Answers.Goal
	data.Profile.StartWeight = in.Answers.Nutrition.WeightKG
	data.Profile.GoalStartedAt = in.Answers.StartDate
	start, _ := time.Parse("2006-01-02", in.Answers.StartDate)
	for i := 0; i < 28; i++ {
		date := start.AddDate(0, 0, i)
		key := date.Format("2006-01-02")
		protected := false
		for _, session := range data.Sessions {
			if session.Date == key {
				protected = true
				break
			}
		}
		if protected {
			continue
		}
		if in.SchedulePolicy == "keep-existing" {
			for _, existing := range data.Schedule {
				if existing.Date == key && existing.WorkoutID != nil {
					protected = true
					break
				}
			}
		}
		if protected {
			continue
		}
		day := (int(date.Weekday()) + 6) % 7
		var workoutID *string
		for index, weekday := range in.Answers.WorkoutDays {
			if weekday == day {
				value := program.Workouts[index%len(program.Workouts)].ID
				workoutID = &value
				break
			}
		}
		assignDate(data, key, workoutID)
	}
	in.Targets = targets
	data.GoalPlans = append(data.GoalPlans, domain.GoalPlan{CreateGoalPlan: in, ID: newRecordID("goal"), CreatedAt: s.now().Format(time.RFC3339Nano), ProgramID: program.ID, Rationale: preview.Rationale})
	if in.Answers.Nutrition.HealthEnergy != nil {
		data.HealthEnergy = in.Answers.Nutrition.HealthEnergy
	}
	return nil
}

func (s *TrainingService) RecommendPrograms(ctx context.Context, userID string, input domain.TrainingPreferences) (domain.ProgramRecommendations, error) {
	if err := domain.ValidateTrainingPreferences(input); err != nil {
		return domain.ProgramRecommendations{}, invalidTraining(err)
	}
	data, err := s.GetSnapshot(ctx, userID)
	if err != nil {
		return domain.ProgramRecommendations{}, err
	}
	library, err := s.ProgramTemplates(ctx)
	if err != nil {
		return domain.ProgramRecommendations{}, err
	}
	result, err := domain.RankPrograms(input, library, data.Programs, s.Catalogue.ExpertRules, s.Catalogue.Exercises)
	if err != nil {
		return result, invalidTraining(err)
	}
	return result, nil
}
func (s *TrainingService) ReviewProgress(ctx context.Context, userID string) (domain.ProgressReview, error) {
	data, err := s.GetSnapshot(ctx, userID)
	if err != nil {
		return domain.ProgressReview{}, err
	}
	zone, err := time.LoadLocation(data.Profile.Timezone)
	if err != nil {
		zone = time.UTC
	}
	return domain.ReviewProgress(data, s.now().In(zone).Format("2006-01-02"), s.Catalogue.ExpertRules, s.Catalogue.Exercises), nil
}
