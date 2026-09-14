package tts

import (
	"net/http"
	"time"
)

const defaultHTTPTimeout = 2 * time.Minute

// Options is the resolved option set passed to provider implementations.
type Options struct {
	HTTPClient *http.Client
}

// SynthesizerOption customizes a Synthesizer.
type SynthesizerOption func(*Options)

// WithHTTPClient overrides the HTTP client used by the synthesizer.
func WithHTTPClient(client *http.Client) SynthesizerOption {
	return func(o *Options) {
		if client != nil {
			o.HTTPClient = client
		}
	}
}

// ApplyOptions resolves a SynthesizerOption slice into Options with defaults.
func ApplyOptions(opts []SynthesizerOption) Options {
	resolved := Options{HTTPClient: &http.Client{Timeout: defaultHTTPTimeout}}
	for _, apply := range opts {
		apply(&resolved)
	}
	return resolved
}
