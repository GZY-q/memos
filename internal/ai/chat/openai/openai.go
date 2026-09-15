// Package openai implements chat.Completer against the OpenAI
// /chat/completions endpoint (and any OpenAI-compatible third-party endpoint
// such as DeepSeek, Moonshot, Ollama, vLLM, or Groq).
package openai

import (
	"context"
	"net/url"
	"strings"

	openaisdk "github.com/openai/openai-go/v3"
	openaioption "github.com/openai/openai-go/v3/option"
	"github.com/pkg/errors"

	"github.com/usememos/memos/internal/ai"
	"github.com/usememos/memos/internal/ai/chat"
)

const defaultEndpoint = "https://api.openai.com/v1"

// Completer implements chat.Completer for OpenAI-compatible chat-completions endpoints.
type Completer struct {
	client openaisdk.Client
}

// New constructs a Completer from a provider config.
func New(cfg ai.ProviderConfig, options chat.Options) (*Completer, error) {
	endpoint, err := normalizeEndpoint(cfg.Endpoint)
	if err != nil {
		return nil, err
	}
	if cfg.APIKey == "" {
		return nil, errors.New("OpenAI API key is required")
	}

	clientOptions := []openaioption.RequestOption{
		openaioption.WithAPIKey(cfg.APIKey),
		openaioption.WithBaseURL(endpoint),
	}
	// WithHTTPClient(nil) would override the SDK default with a nil client.
	if options.HTTPClient != nil {
		clientOptions = append(clientOptions, openaioption.WithHTTPClient(options.HTTPClient))
	}

	return &Completer{
		client: openaisdk.NewClient(clientOptions...),
	}, nil
}

// Complete sends one chat-completions request and returns the first choice.
func (c *Completer) Complete(ctx context.Context, req chat.Request) (*chat.Response, error) {
	if strings.TrimSpace(req.Model) == "" {
		return nil, errors.New("model is required")
	}
	if strings.TrimSpace(req.User) == "" {
		return nil, errors.New("user message is required")
	}

	messages := make([]openaisdk.ChatCompletionMessageParamUnion, 0, 2)
	if system := strings.TrimSpace(req.System); system != "" {
		messages = append(messages, openaisdk.SystemMessage(system))
	}
	messages = append(messages, openaisdk.UserMessage(req.User))

	params := openaisdk.ChatCompletionNewParams{
		Model:    openaisdk.ChatModel(req.Model),
		Messages: messages,
	}
	if req.Temperature > 0 {
		params.Temperature = openaisdk.Float(req.Temperature)
	}
	if req.MaxTokens > 0 {
		params.MaxTokens = openaisdk.Int(req.MaxTokens)
	}

	resp, err := c.client.Chat.Completions.New(ctx, params)
	if err != nil {
		return nil, errors.Wrap(err, "failed to send OpenAI chat completion request")
	}
	if len(resp.Choices) == 0 {
		return nil, errors.New("chat completion response did not include any choices")
	}

	choice := resp.Choices[0]
	text := strings.TrimSpace(choice.Message.Content)
	if text == "" {
		return nil, errors.New("chat completion response did not include text")
	}
	return &chat.Response{
		Text:         text,
		FinishReason: choice.FinishReason,
	}, nil
}

func normalizeEndpoint(endpoint string) (string, error) {
	endpoint = strings.TrimSpace(endpoint)
	if endpoint == "" {
		endpoint = defaultEndpoint
	}
	parsed, err := url.Parse(endpoint)
	if err != nil {
		return "", errors.Wrap(err, "invalid OpenAI endpoint")
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return "", errors.Errorf("unsupported endpoint scheme %q", parsed.Scheme)
	}
	return strings.TrimRight(endpoint, "/"), nil
}
