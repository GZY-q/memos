package chat

import "net/http"

// Options configures a Completer implementation.
type Options struct {
	// HTTPClient overrides the provider HTTP client. Nil uses the SDK default.
	HTTPClient *http.Client
}

// ApplyOptions builds Options from an optional mutator slice.
func ApplyOptions(mutators []func(*Options)) Options {
	var options Options
	for _, mutate := range mutators {
		if mutate != nil {
			mutate(&options)
		}
	}
	return options
}
