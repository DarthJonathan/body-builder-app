package server

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"time"
	"training-app/backend/config"
	"training-app/backend/controllers"
	"training-app/backend/dao"
	"training-app/backend/domain"
	"training-app/backend/middleware"
	"training-app/backend/providers"
	"training-app/backend/response"
	"training-app/backend/service"

	"github.com/gorilla/mux"
	"github.com/hashicorp/go-uuid"
	"gorm.io/gorm"
)

func NewRouter(db *gorm.DB, cfg config.Config) http.Handler {
	auth := &service.AuthService{DB: db, Secret: []byte(cfg.JWTSecret), Expiry: time.Duration(cfg.TokenExpiryHours) * time.Hour}
	if auth.Expiry <= 0 {
		auth.Expiry = 168 * time.Hour
	}
	authController := &controllers.AuthController{Service: auth}
	training := service.NewTrainingService(db)
	bundledFoods, bundledFoodError := providers.BundledFoods()
	provider, providerInitError := providers.New(providers.Options{DB: db, EncryptionKey: cfg.ProviderEncryptionKey, OpenAIURL: cfg.OpenAIURL, AnthropicURL: cfg.AnthropicURL, OpenRouterURL: cfg.OpenRouterURL, FoodSearchURL: cfg.FoodSearchURL, FoodUserAgent: "BodyBuilder/0.1 (personal training PWA)", Timeout: 30 * time.Second, FallbackFoods: bundledFoods})
	providerInitError = errors.Join(providerInitError, bundledFoodError)
	if providerInitError != nil {
		slog.Error("provider configuration unavailable", "error", providerInitError)
	}
	available := func(w http.ResponseWriter) bool {
		if providerInitError != nil {
			controllers.WriteError(w, 503, "provider configuration is unavailable")
			return false
		}
		return true
	}
	controller := &controllers.TrainingController{Service: training, UserID: func(r *http.Request) string { return middleware.UserID(r.Context()) }, Decorate: func(r *http.Request, data *domain.AppSnapshot) error {
		if providerInitError != nil {
			return nil
		}
		settings, err := provider.PublicConfig(r.Context())
		if err != nil {
			return err
		}
		data.Provider = settings
		return nil
	}}
	router := mux.NewRouter()
	router.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			id, _ := uuid.GenerateUUID()
			w.Header().Set("X-Request-Id", id)
			w.Header().Set("X-Content-Type-Options", "nosniff")
			next.ServeHTTP(w, r)
		})
	})
	router.NotFoundHandler = http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { controllers.WriteError(w, 404, "endpoint not found") })
	router.MethodNotAllowedHandler = http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { controllers.WriteError(w, 405, "method not allowed") })
	router.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) {
		pool, err := db.DB()
		if err != nil {
			controllers.WriteError(w, 503, "database unavailable")
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
		defer cancel()
		if err := pool.PingContext(ctx); err != nil {
			controllers.WriteError(w, 503, "database unavailable")
			return
		}
		controllers.WriteJSON(w, 200, response.Response{Success: true})
	}).Methods("GET")
	limit := cfg.AuthRateLimit
	if limit <= 0 {
		limit = 60
	}
	limited := middleware.RateLimit(limit, time.Minute)
	router.Handle("/api/v1/auth/register", limited(http.HandlerFunc(authController.Register))).Methods("POST")
	router.Handle("/api/v1/auth/login", limited(http.HandlerFunc(authController.Login))).Methods("POST")
	protected := router.PathPrefix("/api/v1").Subrouter()
	protected.Use(middleware.Auth(auth))
	protected.Use(middleware.RateLimit(240, time.Minute))
	protected.HandleFunc("/me", func(w http.ResponseWriter, r *http.Request) {
		var user dao.User
		if err := db.WithContext(r.Context()).Where("id = ?", middleware.UserID(r.Context())).First(&user).Error; err != nil {
			controllers.WriteError(w, 401, "account unavailable")
			return
		}
		controllers.WriteJSON(w, 200, response.Response{Success: true, Data: user})
	}).Methods("GET")
	protected.HandleFunc("/snapshot", controller.Snapshot).Methods("GET")
	protected.HandleFunc("/mutations", controller.Mutate).Methods("POST")
	protected.HandleFunc("/goals/preview", func(w http.ResponseWriter, r *http.Request) {
		var input domain.GoalAnswers
		if err := controllers.DecodeJSON(w, r, &input); err != nil {
			controllers.WriteError(w, 400, err.Error())
			return
		}
		result, err := training.PreviewGoalPlan(r.Context(), middleware.UserID(r.Context()), input)
		if err != nil {
			controllers.TrainingFailure(w, err)
			return
		}
		controllers.WriteJSON(w, 200, response.Response{Success: true, Data: result})
	}).Methods("POST")
	protected.HandleFunc("/programs/recommendations", func(w http.ResponseWriter, r *http.Request) {
		var input domain.TrainingPreferences
		if err := controllers.DecodeJSON(w, r, &input); err != nil {
			controllers.WriteError(w, 400, err.Error())
			return
		}
		result, err := training.RecommendPrograms(r.Context(), middleware.UserID(r.Context()), input)
		if err != nil {
			controllers.TrainingFailure(w, err)
			return
		}
		controllers.WriteJSON(w, 200, response.Response{Success: true, Data: result})
	}).Methods("POST")
	protected.HandleFunc("/progress/review", func(w http.ResponseWriter, r *http.Request) {
		result, err := training.ReviewProgress(r.Context(), middleware.UserID(r.Context()))
		if err != nil {
			controllers.TrainingFailure(w, err)
			return
		}
		controllers.WriteJSON(w, 200, response.Response{Success: true, Data: result})
	}).Methods("GET")
	protected.HandleFunc("/nutrition/calculate", func(w http.ResponseWriter, r *http.Request) {
		var input domain.TargetCalculation
		if err := controllers.DecodeJSON(w, r, &input); err != nil {
			controllers.WriteError(w, 400, err.Error())
			return
		}
		result, err := domain.CalculateNutrition(input)
		if err != nil {
			controllers.WriteError(w, 400, err.Error())
			return
		}
		id, err := uuid.GenerateUUID()
		if err != nil {
			controllers.WriteError(w, 503, "could not prepare nutrition targets; try again")
			return
		}
		result.ID = "targets-" + id
		controllers.WriteJSON(w, 200, response.Response{Success: true, Data: result})
	}).Methods("POST")
	protected.HandleFunc("/catalogue", func(w http.ResponseWriter, r *http.Request) {
		library, err := training.ProgramTemplates(r.Context())
		if err != nil {
			controllers.TrainingFailure(w, err)
			return
		}
		data := training.Catalogue
		data.Templates = library
		controllers.WriteJSON(w, 200, response.Response{Success: true, Data: data})
	}).Methods("GET")
	protected.HandleFunc("/programs/templates", func(w http.ResponseWriter, r *http.Request) {
		library, err := training.ProgramTemplates(r.Context())
		if err != nil {
			controllers.TrainingFailure(w, err)
			return
		}
		controllers.WriteJSON(w, 200, response.Response{Success: true, Data: library})
	}).Methods("GET")
	protected.HandleFunc("/foods/search", func(w http.ResponseWriter, r *http.Request) {
		query := strings.TrimSpace(r.URL.Query().Get("q"))
		if err := domain.Text(query, "food search", 200, true); err != nil {
			controllers.WriteError(w, 400, err.Error())
			return
		}
		state, err := training.GetSnapshot(r.Context(), middleware.UserID(r.Context()))
		if err != nil {
			controllers.TrainingFailure(w, err)
			return
		}
		foods := []domain.Food{}
		seen := map[string]bool{}
		terms := strings.Fields(strings.ToLower(query))
		for _, entry := range state.FoodEntries {
			matches := true
			for _, term := range terms {
				if !strings.Contains(strings.ToLower(entry.Name+" "+entry.Serving), term) {
					matches = false
				}
			}
			key := strings.ToLower(entry.Name + " " + entry.Serving)
			if matches && !seen[key] {
				seen[key] = true
				foods = append(foods, savedFood(entry))
			}
		}
		if query != "" && providerInitError != nil && len(foods) == 0 {
			controllers.WriteError(w, 503, "food search is unavailable; use a saved food or enter a serving manually")
			return
		}
		if query != "" && providerInitError == nil {
			external, err := provider.SearchFoods(r.Context(), query)
			if err != nil && len(foods) == 0 {
				providerFailure(w, err)
				return
			}
			for _, food := range external {
				key := strings.ToLower(food.Name + " " + food.Serving)
				if !seen[key] {
					seen[key] = true
					foods = append(foods, food)
				}
			}
		}
		if len(foods) > 30 {
			foods = foods[:30]
		}
		controllers.WriteJSON(w, 200, response.Response{Success: true, Data: foods})
	}).Methods("GET")
	admin := func(r *http.Request) bool {
		var user dao.User
		return db.WithContext(r.Context()).Where("id = ? AND role = ?", middleware.UserID(r.Context()), "admin").First(&user).Error == nil
	}
	protected.HandleFunc("/admin/programs", func(w http.ResponseWriter, r *http.Request) {
		if !admin(r) {
			controllers.WriteError(w, 403, "only an administrator can publish shared programs")
			return
		}
		var input service.PublishProgram
		if err := controllers.DecodeJSON(w, r, &input); err != nil {
			controllers.WriteError(w, 400, err.Error())
			return
		}
		result, err := training.PublishProgram(r.Context(), middleware.UserID(r.Context()), input)
		if err != nil {
			controllers.TrainingFailure(w, err)
			return
		}
		controllers.WriteJSON(w, 200, response.Response{Success: true, Data: result})
	}).Methods("PUT")
	protected.HandleFunc("/admin/provider", func(w http.ResponseWriter, r *http.Request) {
		if !admin(r) {
			controllers.WriteError(w, 403, "only an administrator can configure providers")
			return
		}
		if !available(w) {
			return
		}
		var input providers.SaveConfigRequest
		if err := controllers.DecodeJSON(w, r, &input); err != nil {
			controllers.WriteError(w, 400, err.Error())
			return
		}
		result, err := provider.SaveConfig(r.Context(), true, input)
		if err != nil {
			providerFailure(w, err)
			return
		}
		controllers.WriteJSON(w, 200, response.Response{Success: true, Data: result})
	}).Methods("PUT")
	protected.HandleFunc("/admin/provider/test", func(w http.ResponseWriter, r *http.Request) {
		if !admin(r) {
			controllers.WriteError(w, 403, "only an administrator can test provider settings")
			return
		}
		if !available(w) {
			return
		}
		result, err := provider.TestConfig(r.Context(), middleware.UserID(r.Context()), true)
		if err != nil {
			providerFailure(w, err)
			return
		}
		controllers.WriteJSON(w, 200, response.Response{Success: true, Data: result})
	}).Methods("POST")
	protected.HandleFunc("/assistant/question", func(w http.ResponseWriter, r *http.Request) {
		if !available(w) {
			return
		}
		var input struct {
			Question string `json:"question"`
		}
		if err := controllers.DecodeJSON(w, r, &input); err != nil {
			controllers.WriteError(w, 400, err.Error())
			return
		}
		result, err := provider.Ask(r.Context(), middleware.UserID(r.Context()), input.Question)
		if err != nil {
			providerFailure(w, err)
			return
		}
		controllers.WriteJSON(w, 200, response.Response{Success: true, Data: result})
	}).Methods("POST")
	protected.HandleFunc("/assistant/meal", func(w http.ResponseWriter, r *http.Request) {
		if !available(w) {
			return
		}
		r.Body = http.MaxBytesReader(w, r.Body, 8*1024*1024)
		if err := r.ParseMultipartForm(8 * 1024 * 1024); err != nil {
			controllers.WriteError(w, 400, "choose a JPEG or PNG photo smaller than 7 MB")
			return
		}
		if r.MultipartForm != nil {
			defer r.MultipartForm.RemoveAll()
		}
		image, header, err := r.FormFile("image")
		if err != nil {
			controllers.WriteError(w, 400, "choose a meal photo first")
			return
		}
		defer image.Close()
		encoded, err := io.ReadAll(io.LimitReader(image, providers.MaxImageBytes+1))
		if err != nil || len(encoded) > providers.MaxImageBytes {
			controllers.WriteError(w, 400, "choose a JPEG or PNG photo smaller than 7 MB")
			return
		}
		result, err := provider.EstimateMeal(r.Context(), middleware.UserID(r.Context()), encoded, header.Header.Get("Content-Type"))
		if err != nil {
			providerFailure(w, err)
			return
		}
		controllers.WriteJSON(w, 200, response.Response{Success: true, Data: result})
	}).Methods("POST")
	return router
}

// A food-log entry stores totals for its quantity; search offers one serving.
func savedFood(entry domain.FoodEntry) domain.Food {
	hash := sha256.Sum256([]byte(entry.ID))
	quantity := entry.Quantity
	if quantity <= 0 {
		quantity = 1
	}
	source := entry.DatabaseSource
	if source == "" {
		source = "Your saved food log"
	}
	return domain.Food{
		ID: "saved-" + hex.EncodeToString(hash[:16]), Name: entry.Name,
		Serving: entry.Serving, Source: source,
		Nutrients: domain.Nutrients{Calories: entry.Calories / quantity, Protein: entry.Protein / quantity, Carbs: entry.Carbs / quantity, Fat: entry.Fat / quantity},
	}
}

func providerFailure(w http.ResponseWriter, err error) {
	var failure *providers.Error
	if errors.As(err, &failure) {
		controllers.WriteJSON(w, failure.Status, response.Response{Success: false, Error: failure.Message, Code: failure.Code})
		return
	}
	slog.Error("provider operation failed", "error", err)
	controllers.WriteError(w, 503, "the provider is unavailable; your saved records are unchanged")
}
