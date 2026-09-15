package ai

import "github.com/pkg/errors"

const (
	// DefaultOpenAITranscriptionModel is the built-in OpenAI transcription model.
	DefaultOpenAITranscriptionModel = "whisper-1"
	// DefaultGeminiTranscriptionModel is the built-in Gemini transcription model.
	DefaultGeminiTranscriptionModel = "gemini-2.5-flash"
	// DefaultArkTTSModel is the Volcengine Ark Agent Plan TTS resource id.
	DefaultArkTTSModel = "seed-tts-2.0"
	// DefaultArkTTSSpeaker is the default Volcengine Ark TTS voice.
	DefaultArkTTSSpeaker = "zh_female_vv_uranus_bigtts"
	// DefaultEdgeTTSSpeaker is the default Microsoft Edge neural voice.
	DefaultEdgeTTSSpeaker = "zh-CN-XiaoxiaoNeural"
	// DefaultOpenAIWritingModel is the built-in OpenAI-compatible chat model
	// used when WritingConfig.model is empty. Custom endpoints should set
	// their own model id (deepseek-chat, qwen-plus, llama3.1, …).
	DefaultOpenAIWritingModel = "gpt-4o-mini"
	// DefaultWritingSystemPrompt is applied when WritingConfig.system_prompt
	// is empty. It keeps assistant output as raw markdown suitable for paste.
	DefaultWritingSystemPrompt = "You are a writing assistant embedded in a personal memo app. " +
		"Follow the user's instruction on the provided text. " +
		"Return only the resulting markdown text — no preamble, no explanations, no surrounding quotes, and no code fences unless the content itself requires them."
)

// DefaultTranscriptionModel returns the built-in transcription model for a provider.
func DefaultTranscriptionModel(providerType ProviderType) (string, error) {
	switch providerType {
	case ProviderOpenAI:
		return DefaultOpenAITranscriptionModel, nil
	case ProviderGemini:
		return DefaultGeminiTranscriptionModel, nil
	default:
		return "", errors.Wrapf(ErrCapabilityUnsupported, "provider type %q", providerType)
	}
}

// DefaultWritingModel returns the built-in chat model for a writing-assistant provider.
func DefaultWritingModel(providerType ProviderType) (string, error) {
	switch providerType {
	case ProviderOpenAI:
		return DefaultOpenAIWritingModel, nil
	default:
		return "", errors.Wrapf(ErrCapabilityUnsupported, "provider type %q", providerType)
	}
}

// DefaultTTSModel returns the built-in TTS model / resource id for a provider.
func DefaultTTSModel(providerType ProviderType) (string, error) {
	switch providerType {
	case ProviderVolcengineArk:
		return DefaultArkTTSModel, nil
	case ProviderEdge:
		// Edge read-aloud has no model / resource id concept.
		return "", nil
	default:
		return "", errors.Wrapf(ErrCapabilityUnsupported, "provider type %q", providerType)
	}
}

// DefaultTTSSpeaker returns the built-in TTS speaker for a provider.
func DefaultTTSSpeaker(providerType ProviderType) (string, error) {
	switch providerType {
	case ProviderVolcengineArk:
		return DefaultArkTTSSpeaker, nil
	case ProviderEdge:
		return DefaultEdgeTTSSpeaker, nil
	default:
		return "", errors.Wrapf(ErrCapabilityUnsupported, "provider type %q", providerType)
	}
}
