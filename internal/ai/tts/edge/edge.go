// Package edge implements tts.Synthesizer against Microsoft Edge's free
// read-aloud service (the same backend as the edge-tts project).
//
// The service is reached over WebSocket at speech.platform.bing.com. It
// requires no API key, but the WebSocket handshake is gated on an Edge
// User-Agent and a time-based Sec-MS-GEC token. Browsers cannot set the
// User-Agent on a WebSocket (Chrome/Firefox handshakes get 403), so memos
// always proxies synthesis through this client. Audio is a concatenated
// MP3 stream (24 kHz, 48 kbps mono).
package edge

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/tls"
	"encoding/binary"
	"encoding/hex"
	"fmt"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/gorilla/websocket"
	"github.com/pkg/errors"

	"github.com/usememos/memos/internal/ai"
	"github.com/usememos/memos/internal/ai/tts"
)

// voiceNamePattern matches Edge neural-voice short names such as
// zh-CN-XiaoxiaoNeural, zh-CN-shanghai-YunxiNeural or en-US-EmmaMultilingualNeural.
// It also blocks SSML/quote injection via the voice field.
var voiceNamePattern = regexp.MustCompile(`^[A-Za-z]{2,3}-[A-Za-z]+(?:-[A-Za-z]+){1,2}$`)

const (
	trustedClientToken = "6A5AA1D4EAFF4E9FB37E23D68491D6F4"
	wssURL             = "wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1?TrustedClientToken=" + trustedClientToken
	secMSGecVersion    = "1-143.0.3650.75"
	chromiumMajor      = "143"
	edgeUserAgent      = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
		"(KHTML, like Gecko) Chrome/" + chromiumMajor + ".0.0.0 Safari/537.36 Edg/" + chromiumMajor + ".0.0.0"
	extensionOrigin = "chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold"
	outputFormat    = "audio-24khz-48kbitrate-mono-mp3"
	// maxChunkBytes matches edge-tts: each SSML request stays under 4096 bytes.
	maxChunkBytes = 4096
	// windowsEpochOffset is seconds between 1601-01-01 and 1970-01-01.
	windowsEpochOffset = 11644473600
	contentTypeMP3     = "audio/mpeg"
)

// Synthesizer implements tts.Synthesizer for the Microsoft Edge read-aloud service.
type Synthesizer struct {
	defaultVoice string
	dialer       *websocket.Dialer
}

// New constructs a Synthesizer from a provider config. Edge TTS is keyless;
// the API key and endpoint are ignored if present.
func New(_ ai.ProviderConfig, _ tts.Options) (*Synthesizer, error) {
	dialer := &websocket.Dialer{
		Proxy:             http.ProxyFromEnvironment,
		HandshakeTimeout:  15 * time.Second,
		EnableCompression: true,
		TLSClientConfig:   &tls.Config{MinVersion: tls.VersionTLS12},
	}
	return &Synthesizer{defaultVoice: ai.DefaultEdgeTTSSpeaker, dialer: dialer}, nil
}

// Synthesize converts text to a single concatenated MP3 payload.
func (s *Synthesizer) Synthesize(ctx context.Context, req tts.Request) (*tts.Response, error) {
	text := sanitize(req.Text)
	if strings.TrimSpace(text) == "" {
		return nil, errors.New("text is required")
	}
	voice := strings.TrimSpace(req.Speaker)
	if voice == "" {
		voice = s.defaultVoice
	}
	if !voiceNamePattern.MatchString(voice) {
		return nil, errors.Errorf("invalid Edge voice name %q", voice)
	}

	var combined []byte
	for _, chunk := range splitTextByByteLength(xmlEscape(text), maxChunkBytes) {
		audio, err := s.synthesizeChunk(ctx, voice, chunk)
		if err != nil {
			return nil, err
		}
		combined = append(combined, audio...)
	}
	if len(combined) == 0 {
		return nil, errors.New("no audio was received from the speech service")
	}
	return &tts.Response{Audio: combined, ContentType: contentTypeMP3}, nil
}

func (s *Synthesizer) synthesizeChunk(ctx context.Context, voice string, text []byte) ([]byte, error) {
	connectionID := randomHex(16)
	requestID := randomHex(16)

	endpoint := fmt.Sprintf("%s&ConnectionId=%s&Sec-MS-GEC=%s&Sec-MS-GEC-Version=%s",
		wssURL, connectionID, generateSecMSGec(time.Now()), url.QueryEscape(secMSGecVersion))

	header := http.Header{}
	header.Set("User-Agent", edgeUserAgent)
	header.Set("Origin", extensionOrigin)
	header.Set("Pragma", "no-cache")
	header.Set("Cache-Control", "no-cache")
	header.Set("Accept-Encoding", "gzip, deflate, br, zstd")
	header.Set("Accept-Language", "en-US,en;q=0.9")
	header.Set("Cookie", "muid="+strings.ToUpper(randomHex(16))+";")

	conn, resp, err := s.dialer.DialContext(ctx, endpoint, header)
	if err != nil {
		if resp != nil {
			_ = resp.Body.Close()
			return nil, errors.Wrapf(err, "speech service connection failed: HTTP %d", resp.StatusCode)
		}
		return nil, errors.Wrap(err, "speech service connection failed")
	}
	defer conn.Close()

	if err := conn.WriteMessage(websocket.TextMessage, []byte(speechConfig())); err != nil {
		return nil, errors.Wrap(err, "failed to send speech config")
	}
	ssml := buildSSML(voice, string(text))
	if err := conn.WriteMessage(websocket.TextMessage, []byte(ssmlMessage(requestID, ssml))); err != nil {
		return nil, errors.Wrap(err, "failed to send SSML")
	}

	var audio []byte
	for {
		messageType, data, err := conn.ReadMessage()
		if err != nil {
			return nil, errors.Wrap(err, "speech service read failed")
		}
		switch messageType {
		case websocket.TextMessage:
			switch textHeaderPath(data) {
			case "turn.end":
				if len(audio) == 0 {
					return nil, errors.New("no audio was received from the speech service")
				}
				return audio, nil
			case "response", "turn.start", "audio.metadata":
				// control / metadata frames
			default:
				return nil, errors.Errorf("unexpected speech response: %q", truncateText(data))
			}
		case websocket.BinaryMessage:
			chunk, isAudio, err := parseAudioBinary(data)
			if err != nil {
				return nil, err
			}
			if isAudio {
				audio = append(audio, chunk...)
			}
		default:
			// Ignore unknown frame types (ping/pong/continuation).
		}
	}
}

func speechConfig() string {
	return "X-Timestamp:" + jsDate() + "\r\n" +
		"Content-Type:application/json; charset=utf-8\r\n" +
		"Path:speech.config\r\n\r\n" +
		`{"context":{"synthesis":{"audio":{"metadataoptions":{"sentenceBoundaryEnabled":"false","wordBoundaryEnabled":"false"},"outputFormat":"` +
		outputFormat + `"}}}}` + "\r\n"
}

func buildSSML(voice, escapedText string) string {
	return "<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'>" +
		"<voice name='" + voice + "'>" +
		"<prosody pitch='+0Hz' rate='+0%' volume='+0%'>" +
		escapedText +
		"</prosody></voice></speak>"
}

func ssmlMessage(requestID, ssml string) string {
	return "X-RequestId:" + requestID + "\r\n" +
		"Content-Type:application/ssml+xml\r\n" +
		"X-Timestamp:" + jsDate() + "Z\r\n" + // trailing Z mirrors a Microsoft-side quirk
		"Path:ssml\r\n\r\n" +
		ssml
}

// parseAudioBinary extracts the MP3 payload from a binary frame. Layout:
// the first two bytes are a big-endian uint16 header length N; bytes [2:2+N]
// hold the CRLF-delimited header section, and audio starts immediately at
// offset 2+N.
func parseAudioBinary(data []byte) (payload []byte, isAudio bool, err error) {
	if len(data) < 2 {
		return nil, false, errors.New("binary speech frame too short")
	}
	headerLength := int(binary.BigEndian.Uint16(data[:2]))
	headerEnd := 2 + headerLength
	if headerEnd > len(data) {
		return nil, false, errors.New("binary speech frame header length exceeds frame")
	}
	header := string(data[2:headerEnd])
	if !strings.Contains(header, "Path:audio") {
		return nil, false, nil
	}
	return data[headerEnd:], true, nil
}

// textHeaderPath returns the Path value from a text control frame's preamble.
func textHeaderPath(data []byte) string {
	preamble := data
	if idx := strings.Index(string(data), "\r\n\r\n"); idx >= 0 {
		preamble = data[:idx]
	}
	for _, line := range strings.Split(string(preamble), "\r\n") {
		if rest, ok := strings.CutPrefix(line, "Path:"); ok {
			return strings.TrimSpace(rest)
		}
	}
	return ""
}

// generateSecMSGec computes the DRM token: SHA256 of the current Windows
// FILETIME (100-ns ticks, floored to 5 minutes) concatenated with the
// trusted client token, uppercased hex.
func generateSecMSGec(now time.Time) string {
	unix := now.Unix() + windowsEpochOffset
	unix -= unix % 300
	ticks := unix * 10_000_000
	sum := sha256.Sum256([]byte(fmt.Sprintf("%d%s", ticks, trustedClientToken)))
	return strings.ToUpper(hex.EncodeToString(sum[:]))
}

func jsDate() string {
	return time.Now().UTC().Format("Mon Jan 02 2006 15:04:05 GMT+0000 (Coordinated Universal Time)")
}

// randomHex returns the hex encoding of n random bytes (2*n characters).
func randomHex(n int) string {
	b := make([]byte, n)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

// xmlEscape escapes only &, <, > (matching xml.sax.saxutils.escape).
func xmlEscape(s string) string {
	r := strings.NewReplacer("&", "&amp;", "<", "&lt;", ">", "&gt;")
	return r.Replace(s)
}

// sanitize replaces control characters the service rejects (common in OCR text).
func sanitize(s string) string {
	var b strings.Builder
	for _, r := range s {
		if r <= 8 || (r >= 11 && r <= 12) || (r >= 14 && r <= 31) {
			b.WriteRune(' ')
			continue
		}
		b.WriteRune(r)
	}
	return b.String()
}

// splitTextByByteLength breaks escaped text into <=limit UTF-8 chunks,
// preferring newline/space boundaries and never splitting an XML entity.
// The boundary character (newline/space) is kept at the end of the leading
// chunk so words do not get glued back together in the spoken audio.
// Ported from the edge-tts Python implementation.
func splitTextByByteLength(text string, limit int) [][]byte {
	data := []byte(text)
	var chunks [][]byte
	for len(data) > limit {
		window := data[:limit]
		splitAt := 0
		if i := bytes.LastIndexByte(window, '\n'); i >= 0 {
			splitAt = i + 1
		} else if i := bytes.LastIndexByte(window, ' '); i >= 0 {
			splitAt = i + 1
		} else {
			splitAt = safeUTF8Split(data, limit)
		}
		splitAt = adjustForXMLEntity(data, splitAt)
		if splitAt <= 0 || splitAt >= len(data) {
			// Pathological input (e.g. an unterminated entity at position 0);
			// fall back to a safe UTF-8 boundary so progress is guaranteed.
			splitAt = safeUTF8Split(data, limit)
		}
		chunks = append(chunks, data[:splitAt])
		data = bytes.TrimLeft(data[splitAt:], " \t\r\n")
	}
	if len(bytes.TrimSpace(data)) > 0 {
		chunks = append(chunks, data)
	}
	return chunks
}

// safeUTF8Split walks back from `at` to the largest valid UTF-8 boundary.
func safeUTF8Split(b []byte, at int) int {
	for at > 0 && !utf8.Valid(b[:at]) {
		at--
	}
	return at
}

// adjustForXMLEntity moves the split point before an unterminated '&' entity
// so an escape like "&amp;" is never broken across two chunks.
func adjustForXMLEntity(b []byte, at int) int {
	for at > 0 {
		amp := bytes.LastIndexByte(b[:at], '&')
		if amp < 0 {
			break
		}
		if bytes.IndexByte(b[amp:at], ';') >= 0 {
			break
		}
		at = amp
	}
	return at
}

func truncateText(b []byte) string {
	s := string(b)
	if len(s) > 200 {
		return s[:200]
	}
	return s
}
