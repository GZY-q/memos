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

// DefaultTTSModel returns the built-in TTS model / resource id for a provider.
func DefaultTTSModel(providerType ProviderType) (string, error) {
	switch providerType {
	case ProviderVolcengineArk:
		return DefaultArkTTSModel, nil
	default:
		return "", errors.Wrapf(ErrCapabilityUnsupported, "provider type %q", providerType)
	}
}

// DefaultTTSSpeaker returns the built-in TTS speaker for a provider.
func DefaultTTSSpeaker(providerType ProviderType) (string, error) {
	switch providerType {
	case ProviderVolcengineArk:
		return DefaultArkTTSSpeaker, nil
	default:
		return "", errors.Wrapf(ErrCapabilityUnsupported, "provider type %q", providerType)
	}
}
