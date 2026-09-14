package ark

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/usememos/memos/internal/ai"
	"github.com/usememos/memos/internal/ai/tts"
)

func TestSynthesizeCollectsStreamedAudio(t *testing.T) {
	chunkAudio := []byte("hello-ark-audio")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		require.Equal(t, http.MethodPost, r.Method)
		require.Equal(t, "/api/v3/plan/tts/unidirectional", r.URL.Path)
		require.Equal(t, "test-key", r.Header.Get("X-Api-Key"))
		require.Equal(t, "seed-tts-2.0", r.Header.Get("X-Api-Resource-Id"))

		var body map[string]any
		require.NoError(t, json.NewDecoder(r.Body).Decode(&body))
		reqParams, ok := body["req_params"].(map[string]any)
		require.True(t, ok)
		require.Equal(t, "你好", reqParams["text"])
		require.Equal(t, "zh_female_vv_uranus_bigtts", reqParams["speaker"])

		w.Header().Set("Content-Type", "text/event-stream")
		encoder := json.NewEncoder(w)
		require.NoError(t, encoder.Encode(map[string]any{"code": 0, "data": base64.StdEncoding.EncodeToString(chunkAudio)}))
		require.NoError(t, encoder.Encode(map[string]any{"code": 0, "data": base64.StdEncoding.EncodeToString(chunkAudio)}))
		require.NoError(t, encoder.Encode(map[string]any{"code": 20000000}))
	}))
	defer server.Close()

	synthesizer, err := New(ai.ProviderConfig{
		APIKey:   "test-key",
		Endpoint: server.URL + "/api/v3/plan",
	}, tts.ApplyOptions(nil))
	require.NoError(t, err)

	resp, err := synthesizer.Synthesize(context.Background(), tts.Request{
		Text:    "你好",
		Speaker: "zh_female_vv_uranus_bigtts",
		Model:   "seed-tts-2.0",
	})
	require.NoError(t, err)
	require.Equal(t, "audio/mpeg", resp.ContentType)
	require.Equal(t, append(append([]byte{}, chunkAudio...), chunkAudio...), resp.Audio)
}

func TestSynthesizeRejectsEmptyText(t *testing.T) {
	synthesizer, err := New(ai.ProviderConfig{APIKey: "test-key"}, tts.ApplyOptions(nil))
	require.NoError(t, err)

	_, err = synthesizer.Synthesize(context.Background(), tts.Request{Speaker: "zh_female_vv_uranus_bigtts"})
	require.Error(t, err)
}

func TestSynthesizeSurfacesStreamErrorCode(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		encoder := json.NewEncoder(w)
		require.NoError(t, encoder.Encode(map[string]any{"code": 45000001, "message": "invalid speaker"}))
	}))
	defer server.Close()

	synthesizer, err := New(ai.ProviderConfig{
		APIKey:   "test-key",
		Endpoint: server.URL + "/api/v3/plan",
	}, tts.ApplyOptions(nil))
	require.NoError(t, err)

	_, err = synthesizer.Synthesize(context.Background(), tts.Request{
		Text:    "你好",
		Speaker: "bad-speaker",
	})
	require.ErrorContains(t, err, "45000001")
}
