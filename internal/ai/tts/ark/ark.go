// Package ark implements tts.Synthesizer against the Volcengine Ark Agent Plan
// HTTP unidirectional TTS endpoint.
package ark

import (
	"bufio"
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"strings"

	"github.com/pkg/errors"

	"github.com/usememos/memos/internal/ai"
	"github.com/usememos/memos/internal/ai/tts"
)

const (
	defaultEndpoint   = "https://openspeech.bytedance.com/api/v3/plan"
	ttsPath           = "/tts/unidirectional"
	defaultFormat     = "mp3"
	defaultSampleRate = 24000
	contentTypeMP3    = "audio/mpeg"
)

// Synthesizer implements tts.Synthesizer for Volcengine Ark Agent Plan TTS.
type Synthesizer struct {
	endpoint   string
	apiKey     string
	httpClient *http.Client
}

// New constructs a Synthesizer from a provider config.
func New(cfg ai.ProviderConfig, options tts.Options) (*Synthesizer, error) {
	endpoint, err := normalizeEndpoint(cfg.Endpoint)
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(cfg.APIKey) == "" {
		return nil, errors.New("Volcengine Ark API key is required")
	}
	httpClient := options.HTTPClient
	if httpClient == nil {
		httpClient = &http.Client{}
	}
	return &Synthesizer{
		endpoint:   endpoint,
		apiKey:     strings.TrimSpace(cfg.APIKey),
		httpClient: httpClient,
	}, nil
}

// Synthesize sends text to the Ark unidirectional TTS HTTP endpoint.
func (s *Synthesizer) Synthesize(ctx context.Context, req tts.Request) (*tts.Response, error) {
	text := strings.TrimSpace(req.Text)
	if text == "" {
		return nil, errors.New("text is required")
	}
	speaker := strings.TrimSpace(req.Speaker)
	if speaker == "" {
		return nil, errors.New("speaker is required")
	}
	resourceID := strings.TrimSpace(req.Model)
	if resourceID == "" {
		resourceID = ai.DefaultArkTTSModel
	}

	payload := map[string]any{
		"req_params": map[string]any{
			"text":    text,
			"speaker": speaker,
			"audio_params": map[string]any{
				"format":      defaultFormat,
				"sample_rate": defaultSampleRate,
			},
		},
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return nil, errors.Wrap(err, "failed to encode TTS request")
	}

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, s.endpoint+ttsPath, bytes.NewReader(body))
	if err != nil {
		return nil, errors.Wrap(err, "failed to create TTS request")
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Connection", "keep-alive")
	httpReq.Header.Set("X-Api-Key", s.apiKey)
	httpReq.Header.Set("X-Api-Resource-Id", resourceID)

	resp, err := s.httpClient.Do(httpReq)
	if err != nil {
		return nil, errors.Wrap(err, "failed to send TTS request")
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		message, _ := io.ReadAll(io.LimitReader(resp.Body, 2048))
		return nil, errors.Errorf("TTS request failed with status %d: %s", resp.StatusCode, strings.TrimSpace(string(message)))
	}

	audio, err := collectAudio(resp.Body)
	if err != nil {
		return nil, err
	}
	if len(audio) == 0 {
		return nil, errors.New("TTS response did not include audio data")
	}
	return &tts.Response{
		Audio:       audio,
		ContentType: contentTypeMP3,
	}, nil
}

type streamChunk struct {
	Code int    `json:"code"`
	Data string `json:"data"`
	Msg  string `json:"message"`
}

func collectAudio(body io.Reader) ([]byte, error) {
	var audio []byte
	scanner := bufio.NewScanner(body)
	// Audio chunks are base64-encoded; allow a large line size for long streams.
	scanner.Buffer(make([]byte, 0, 64*1024), 4*1024*1024)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		var chunk streamChunk
		if err := json.Unmarshal([]byte(line), &chunk); err != nil {
			return nil, errors.Wrap(err, "failed to decode TTS stream chunk")
		}
		if chunk.Code == 20000000 {
			break
		}
		if chunk.Code != 0 {
			return nil, errors.Errorf("TTS stream returned code %d: %s", chunk.Code, chunk.Msg)
		}
		if chunk.Data == "" {
			continue
		}
		decoded, err := base64.StdEncoding.DecodeString(chunk.Data)
		if err != nil {
			return nil, errors.Wrap(err, "failed to decode TTS audio chunk")
		}
		audio = append(audio, decoded...)
	}
	if err := scanner.Err(); err != nil {
		return nil, errors.Wrap(err, "failed to read TTS stream")
	}
	return audio, nil
}

func normalizeEndpoint(endpoint string) (string, error) {
	endpoint = strings.TrimSpace(endpoint)
	if endpoint == "" {
		endpoint = defaultEndpoint
	}
	parsed, err := url.ParseRequestURI(endpoint)
	if err != nil {
		return "", errors.Wrap(err, "invalid Volcengine Ark endpoint")
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return "", errors.New("invalid Volcengine Ark endpoint scheme")
	}
	return strings.TrimRight(endpoint, "/"), nil
}
