// Package chat defines the text-completion capability for AI providers.
// Implementations speak the OpenAI Chat Completions protocol so any
// OpenAI-compatible endpoint (OpenAI, DeepSeek, Ollama, vLLM, …) can serve
// the writing assistant through a custom endpoint.
package chat

import (
	"context"
)

// Completer runs one chat-completion turn.
type Completer interface {
	Complete(ctx context.Context, req Request) (*Response, error)
}

// Request is the input to a chat-completion call.
type Request struct {
	Model string // provider-specific chat model id
	// System is the system-level instruction. Empty means no system message.
	System string
	// User is the user-turn body, typically instruction + source text.
	User string
	// Temperature is optional; 0 means "do not send" (provider default).
	Temperature float64
	// MaxTokens is optional; 0 means "do not send" (provider default).
	MaxTokens int64
}

// Response is the output of a chat-completion call.
type Response struct {
	Text         string
	FinishReason string
}
