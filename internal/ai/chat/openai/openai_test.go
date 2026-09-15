package openai_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/usememos/memos/internal/ai"
	"github.com/usememos/memos/internal/ai/chat"
	chatopenai "github.com/usememos/memos/internal/ai/chat/openai"
)

func TestCompleteSendsChatCompletions(t *testing.T) {
	t.Parallel()

	var gotPath string
	var gotAuth string
	var gotBody map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		gotAuth = r.Header.Get("Authorization")
		require.NoError(t, json.NewDecoder(r.Body).Decode(&gotBody))
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"id": "chatcmpl-1",
			"choices": []map[string]any{
				{
					"index":         0,
					"finish_reason": "stop",
					"message": map[string]any{
						"role":    "assistant",
						"content": " polished text ",
					},
				},
			},
		})
	}))
	defer server.Close()

	completer, err := chatopenai.New(ai.ProviderConfig{
		ID:       "openai-main",
		Type:     ai.ProviderOpenAI,
		Endpoint: server.URL + "/v1",
		APIKey:   "test-key",
	}, chat.ApplyOptions(nil))
	require.NoError(t, err)

	resp, err := completer.Complete(context.Background(), chat.Request{
		Model:  "gpt-4o-mini",
		System: "You are a writing assistant.",
		User:   "Instruction:\nPolish\n\nText:\nhello",
	})
	require.NoError(t, err)
	require.Equal(t, "/v1/chat/completions", gotPath)
	require.Equal(t, "Bearer test-key", gotAuth)
	require.Equal(t, "gpt-4o-mini", gotBody["model"])
	require.Equal(t, "polished text", resp.Text)
	require.Equal(t, "stop", resp.FinishReason)

	messages, ok := gotBody["messages"].([]any)
	require.True(t, ok)
	require.Len(t, messages, 2)
}

func TestCompleteRequiresModelAndUser(t *testing.T) {
	t.Parallel()

	completer, err := chatopenai.New(ai.ProviderConfig{
		Type:   ai.ProviderOpenAI,
		APIKey: "test-key",
	}, chat.ApplyOptions(nil))
	require.NoError(t, err)

	_, err = completer.Complete(context.Background(), chat.Request{User: "hello"})
	require.Error(t, err)

	_, err = completer.Complete(context.Background(), chat.Request{Model: "gpt-4o-mini"})
	require.Error(t, err)
}

func TestNewRejectsMissingKey(t *testing.T) {
	t.Parallel()

	_, err := chatopenai.New(ai.ProviderConfig{Type: ai.ProviderOpenAI}, chat.ApplyOptions(nil))
	require.Error(t, err)
}
