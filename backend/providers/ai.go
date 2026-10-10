package providers

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"strings"
	"unicode/utf8"
)

const assistantPrompt = "You are BodyBuilder's training and nutrition assistant. Answer clearly and briefly. Use only personal details that the user explicitly includes in their question; you do not have access to their account, workouts, food log, or check-ins. State uncertainty when the evidence is incomplete."

func (service *Service) requestAI(ctx context.Context, config Config, key, prompt string, photo []byte, mime string, structured bool) (string, error) {
	var endpoint string
	var payload map[string]any
	encodedImage := ""
	if len(photo) > 0 {
		encodedImage = base64.StdEncoding.EncodeToString(photo)
	}
	maxTokens := 1_200
	if structured {
		maxTokens = 2_400
	}
	switch config.Provider {
	case "openai":
		endpoint = service.options.OpenAIURL
		content := []any{map[string]any{"type": "input_text", "text": prompt}}
		if encodedImage != "" {
			content = append(content, map[string]any{"type": "input_image", "image_url": "data:" + mime + ";base64," + encodedImage, "detail": "auto"})
		}
		payload = map[string]any{"model": config.Model, "instructions": assistantPrompt, "input": []any{map[string]any{"role": "user", "content": content}}, "max_output_tokens": maxTokens, "store": false}
		if structured {
			payload["text"] = map[string]any{"format": map[string]any{"type": "json_schema", "name": "meal_estimate", "strict": true, "schema": mealSchema()}}
		}
	case "anthropic":
		endpoint = service.options.AnthropicURL
		content := make([]any, 0, 2)
		if encodedImage != "" {
			content = append(content, map[string]any{"type": "image", "source": map[string]any{"type": "base64", "media_type": mime, "data": encodedImage}})
		}
		content = append(content, map[string]any{"type": "text", "text": prompt})
		payload = map[string]any{"model": config.Model, "system": assistantPrompt, "messages": []any{map[string]any{"role": "user", "content": content}}, "max_tokens": maxTokens, "stream": false}
		if structured {
			payload["output_config"] = map[string]any{"format": map[string]any{"type": "json_schema", "schema": mealSchema()}}
		}
	case "openrouter":
		endpoint = service.options.OpenRouterURL
		content := []any{map[string]any{"type": "text", "text": prompt}}
		if encodedImage != "" {
			content = append(content, map[string]any{"type": "image_url", "image_url": map[string]any{"url": "data:" + mime + ";base64," + encodedImage}})
		}
		payload = map[string]any{"model": config.Model, "messages": []any{map[string]any{"role": "system", "content": assistantPrompt}, map[string]any{"role": "user", "content": content}}, "max_tokens": maxTokens, "stream": false}
		if structured {
			payload["response_format"] = map[string]any{"type": "json_schema", "json_schema": map[string]any{"name": "meal_estimate", "strict": true, "schema": mealSchema()}}
			payload["provider"] = map[string]any{"require_parameters": true}
		}
	default:
		return "", apiError(http.StatusServiceUnavailable, "invalid_provider", "The configured AI provider needs an administrator's attention.")
	}
	encoded, err := json.Marshal(payload)
	if err != nil {
		return "", apiError(http.StatusInternalServerError, "provider_request_failed", "The assistant request could not be prepared.")
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(encoded))
	if err != nil {
		return "", apiError(http.StatusInternalServerError, "provider_request_failed", "The assistant request could not be prepared.")
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Accept", "application/json")
	if config.Provider == "anthropic" {
		request.Header.Set("x-api-key", key)
		request.Header.Set("anthropic-version", "2023-06-01")
	} else {
		request.Header.Set("Authorization", "Bearer "+key)
	}
	response, err := service.http.Do(request)
	if err != nil {
		return "", requestError(ctx, err)
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return "", upstreamStatusError(response.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(response.Body, maxResponseBytes+1))
	if err != nil {
		return "", requestError(ctx, err)
	}
	if len(body) > maxResponseBytes {
		return "", invalidOutput("The assistant response was too large. Try a shorter question or a simpler meal.")
	}
	answer, err := readAnswer(config.Provider, body)
	if err != nil {
		return "", err
	}
	answer = strings.TrimSpace(answer)
	if !utf8.ValidString(answer) || answer == "" || len(answer) > maxAnswerBytes {
		return "", invalidOutput("The assistant returned an empty or oversized response. Please try again.")
	}
	// Some API failures and test proxies echo credentials. Never expose the key,
	// even when the upstream surprisingly includes it in a successful answer.
	answer = strings.ReplaceAll(answer, key, "[redacted]")
	return answer, nil
}

func requestError(ctx context.Context, err error) error {
	var networkError net.Error
	if ctx.Err() != nil || (errors.As(err, &networkError) && networkError.Timeout()) {
		return apiError(http.StatusGatewayTimeout, "provider_timeout", "The assistant took too long. Please try again.")
	}
	return apiError(http.StatusBadGateway, "provider_unavailable", "The AI provider could not be reached. Please try again later.")
}

func upstreamStatusError(status int) error {
	switch status {
	case http.StatusUnauthorized, http.StatusForbidden:
		return apiError(http.StatusBadGateway, "provider_authentication_failed", "The AI provider rejected its credentials. Ask an administrator to check the API key.")
	case http.StatusTooManyRequests:
		return apiError(http.StatusTooManyRequests, "provider_rate_limited", "The AI provider's usage limit was reached. Please try again later.")
	case http.StatusBadRequest, http.StatusNotFound, http.StatusUnprocessableEntity:
		return apiError(http.StatusBadGateway, "provider_configuration_error", "The AI provider rejected this model or request. Ask an administrator to choose a model that supports the requested feature.")
	default:
		return apiError(http.StatusBadGateway, "provider_unavailable", "The AI provider could not complete this request. Please try again later.")
	}
}

func invalidOutput(message string) error {
	return apiError(http.StatusBadGateway, "invalid_provider_output", message)
}

func readAnswer(provider string, body []byte) (string, error) {
	switch provider {
	case "openai":
		var response struct {
			Status string `json:"status"`
			Output []struct {
				Type    string `json:"type"`
				Content []struct {
					Type string `json:"type"`
					Text string `json:"text"`
				} `json:"content"`
			} `json:"output"`
		}
		if err := json.Unmarshal(body, &response); err != nil {
			return "", invalidOutput("The AI provider returned an unreadable response.")
		}
		if response.Status != "completed" {
			return "", invalidOutput("The assistant response was incomplete. Try a shorter question or a simpler meal.")
		}
		var parts []string
		for _, output := range response.Output {
			if output.Type != "message" {
				continue
			}
			for _, content := range output.Content {
				if content.Type == "refusal" {
					return "", apiError(http.StatusUnprocessableEntity, "provider_refusal", "The assistant could not answer this request. Try rephrasing it.")
				}
				if content.Type == "output_text" {
					parts = append(parts, content.Text)
				}
			}
		}
		return strings.Join(parts, "\n"), nil
	case "anthropic":
		var response struct {
			StopReason string `json:"stop_reason"`
			Content    []struct {
				Type string `json:"type"`
				Text string `json:"text"`
			} `json:"content"`
		}
		if err := json.Unmarshal(body, &response); err != nil {
			return "", invalidOutput("The AI provider returned an unreadable response.")
		}
		if response.StopReason == "refusal" {
			return "", apiError(http.StatusUnprocessableEntity, "provider_refusal", "The assistant could not answer this request. Try rephrasing it.")
		}
		if response.StopReason != "end_turn" {
			return "", invalidOutput("The assistant response was incomplete. Try a shorter question or a simpler meal.")
		}
		var parts []string
		for _, content := range response.Content {
			if content.Type == "text" {
				parts = append(parts, content.Text)
			}
		}
		return strings.Join(parts, "\n"), nil
	case "openrouter":
		var response struct {
			Choices []struct {
				FinishReason string `json:"finish_reason"`
				Message      struct {
					Content string  `json:"content"`
					Refusal *string `json:"refusal"`
				} `json:"message"`
			} `json:"choices"`
		}
		if err := json.Unmarshal(body, &response); err != nil {
			return "", invalidOutput("The AI provider returned an unreadable response.")
		}
		if len(response.Choices) != 1 {
			return "", invalidOutput("The AI provider returned an unreadable response.")
		}
		choice := response.Choices[0]
		if choice.FinishReason == "content_filter" || (choice.Message.Refusal != nil && *choice.Message.Refusal != "") {
			return "", apiError(http.StatusUnprocessableEntity, "provider_refusal", "The assistant could not answer this request. Try rephrasing it.")
		}
		if choice.FinishReason != "stop" {
			return "", invalidOutput("The assistant response was incomplete. Try a shorter question or a simpler meal.")
		}
		return choice.Message.Content, nil
	}
	return "", invalidOutput("The AI provider returned an unreadable response.")
}
