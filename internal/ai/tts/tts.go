// Package tts defines the text-to-speech capability for AI providers.
// Implementations call dedicated TTS endpoints (e.g. Volcengine Ark Agent Plan
// unidirectional TTS) and return deterministic audio output.
package tts

import "context"

// Synthesizer synthesizes speech audio from text using a provider's dedicated TTS endpoint.
type Synthesizer interface {
	Synthesize(ctx context.Context, req Request) (*Response, error)
}

// Request is the input to a TTS call.
type Request struct {
	Text    string
	Speaker string
	Model   string // provider-specific model / resource id (e.g. "seed-tts-2.0")
}

// Response is the output of a TTS call.
type Response struct {
	Audio       []byte
	ContentType string
}
