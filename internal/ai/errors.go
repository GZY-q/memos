package ai

import "github.com/pkg/errors"

var (
	// ErrProviderNotFound indicates that a requested provider ID does not exist.
	ErrProviderNotFound = errors.New("AI provider not found")
	// ErrCapabilityUnsupported indicates that the provider does not support the requested capability.
	ErrCapabilityUnsupported = errors.New("AI provider capability unsupported")
	// ErrSTTNotSupported indicates that the provider does not have a dedicated
	// speech-to-text endpoint. Use the audiollm package for multimodal audio
	// understanding when this is returned.
	ErrSTTNotSupported = errors.New("provider does not support speech-to-text capability")
	// ErrAudioLLMNotSupported indicates that the provider does not have a
	// multimodal-audio LLM available in this codebase.
	ErrAudioLLMNotSupported = errors.New("provider does not support multimodal audio capability")
	// ErrTTSNotSupported indicates that the provider does not have a dedicated
	// text-to-speech endpoint in this codebase.
	ErrTTSNotSupported = errors.New("provider does not support text-to-speech capability")
	// ErrChatNotSupported indicates that the provider does not speak the
	// OpenAI Chat Completions protocol used by the writing assistant.
	ErrChatNotSupported = errors.New("provider does not support chat completion capability")
)
