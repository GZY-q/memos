package edge

import (
	"context"
	"encoding/binary"
	"os"
	"strings"
	"testing"
	"time"
	"unicode/utf8"

	"github.com/stretchr/testify/require"

	"github.com/usememos/memos/internal/ai"
	"github.com/usememos/memos/internal/ai/tts"
)

func makeAudioFrame(header string, audio []byte) []byte {
	hb := []byte(header)
	frame := make([]byte, 2+len(hb)+len(audio))
	binary.BigEndian.PutUint16(frame[:2], uint16(len(hb)))
	copy(frame[2:], hb)
	copy(frame[2+len(hb):], audio)
	return frame
}

func TestParseAudioBinary(t *testing.T) {
	header := "X-RequestId:abc\r\nContent-Type:audio/mpeg\r\nX-StreamId:def\r\nPath:audio\r\n"
	audio := []byte{0xFF, 0xFB, 0x90, 0x00, 0x01, 0x02}
	frame := makeAudioFrame(header, audio)

	payload, isAudio, err := parseAudioBinary(frame)
	require.NoError(t, err)
	require.True(t, isAudio)
	require.Equal(t, audio, payload)
}

func TestParseAudioBinaryNonAudio(t *testing.T) {
	header := "X-RequestId:abc\r\nPath:turn.end\r\n"
	frame := makeAudioFrame(header, nil)
	_, isAudio, err := parseAudioBinary(frame)
	require.NoError(t, err)
	require.False(t, isAudio)
}

func TestParseAudioBinaryErrors(t *testing.T) {
	_, _, err := parseAudioBinary([]byte{0x00})
	require.Error(t, err)

	// Declared header length exceeds frame.
	bad := []byte{0xFF, 0xFF, 'a'}
	_, _, err = parseAudioBinary(bad)
	require.Error(t, err)
}

func TestTextHeaderPath(t *testing.T) {
	msg := []byte("X-RequestId:abc\r\nX-Content-Type:application/json\r\nPath:turn.end\r\n\r\n{}")
	require.Equal(t, "turn.end", textHeaderPath(msg))
}

func TestGenerateSecMSGec(t *testing.T) {
	// Deterministic for a fixed instant; verifies 5-minute flooring and
	// uppercase 64-hex-char SHA256 output.
	// 1_700_000_100 is an exact 5-minute boundary, so +2m stays in the same window.
	now := time.Unix(1_700_000_100, 0).UTC()
	tok := generateSecMSGec(now)
	require.Len(t, tok, 64)
	require.Equal(t, strings.ToUpper(tok), tok)

	// Two timestamps within the same 5-minute window produce the same token.
	require.Equal(t, tok, generateSecMSGec(now.Add(2*time.Minute)))
	require.NotEqual(t, tok, generateSecMSGec(now.Add(6*time.Minute)))
}

func TestSplitTextASCII(t *testing.T) {
	text := strings.Repeat("hello world ", 400) // 4800 bytes, spaces every 12
	chunks := splitTextByByteLength(text, 4096)
	require.Greater(t, len(chunks), 1)
	for _, c := range chunks {
		require.LessOrEqual(t, len(c), 4096)
		require.True(t, utf8.Valid(c))
	}
	// Reassembly (minus stripped boundary spaces) still covers all content.
	require.Equal(t, strings.ReplaceAll(text, " ", ""), strings.ReplaceAll(string(joinChunks(chunks)), " ", ""))
}

func TestSplitTextCJKNoSpaces(t *testing.T) {
	text := strings.Repeat("你", 5000) // 15000 bytes, no boundaries
	chunks := splitTextByByteLength(text, 4096)
	require.Greater(t, len(chunks), 1)
	for _, c := range chunks {
		require.LessOrEqual(t, len(c), 4096)
		require.True(t, utf8.Valid(c), "chunk must end on a UTF-8 boundary")
	}
	require.Equal(t, text, string(joinChunks(chunks)))
}

func TestSplitTextPreservesXMLEntity(t *testing.T) {
	// The entity straddles the 4096 boundary: '&' is at index 4094.
	text := strings.Repeat("a", 4094) + "&amp;" + strings.Repeat("b", 20)
	chunks := splitTextByByteLength(text, 4096)
	require.Greater(t, len(chunks), 1)
	for _, c := range chunks {
		// After removing complete entities, no dangling "&" or "amp;" may remain.
		stripped := strings.ReplaceAll(string(c), "&amp;", "")
		require.NotContains(t, stripped, "&")
		require.NotContains(t, stripped, "amp;")
	}
	joined := string(joinChunks(chunks))
	require.Contains(t, joined, "&amp;")
	require.Equal(t, text, strings.ReplaceAll(joined, " ", ""))
}

func TestXMLEscape(t *testing.T) {
	require.Equal(t, "a &amp; b &lt; c &gt; d", xmlEscape("a & b < c > d"))
}

func TestSanitize(t *testing.T) {
	out := sanitize("a\x00b\x07c\x0bd\x0ce\x1ff")
	require.Equal(t, "a b c d e f", out)
	require.Equal(t, "正常\t文本\n换行", sanitize("正常\t文本\n换行"))
}

func TestBuildSSML(t *testing.T) {
	ssml := buildSSML("zh-CN-XiaoxiaoNeural", "你好 &amp; 世界")
	require.Contains(t, ssml, "name='zh-CN-XiaoxiaoNeural'")
	require.Contains(t, ssml, "你好 &amp; 世界")
	require.True(t, strings.HasPrefix(ssml, "<speak"))
	require.True(t, strings.HasSuffix(ssml, "</speak>"))
}

func TestNewDefaultVoice(t *testing.T) {
	s, err := New(ai.ProviderConfig{Type: ai.ProviderEdge}, tts.Options{})
	require.NoError(t, err)
	require.Equal(t, ai.DefaultEdgeTTSSpeaker, s.defaultVoice)
}

func TestSynthesizeRejectsEmpty(t *testing.T) {
	s, err := New(ai.ProviderConfig{Type: ai.ProviderEdge}, tts.Options{})
	require.NoError(t, err)
	_, err = s.Synthesize(context.Background(), tts.Request{Text: "   "})
	require.Error(t, err)
}

func TestSynthesizeRejectsInvalidVoice(t *testing.T) {
	s, err := New(ai.ProviderConfig{Type: ai.ProviderEdge}, tts.Options{})
	require.NoError(t, err)
	_, err = s.Synthesize(context.Background(), tts.Request{Text: "hello", Speaker: "'; drop table"})
	require.Error(t, err)
}

func joinChunks(chunks [][]byte) []byte {
	var out []byte
	for _, c := range chunks {
		out = append(out, c...)
	}
	return out
}

// TestLiveSynthesis hits the real Edge service. Gated on MEMOS_EDGE_LIVE=1
// so normal test runs stay offline.
func TestLiveSynthesis(t *testing.T) {
	if os.Getenv("MEMOS_EDGE_LIVE") == "" {
		t.Skip("set MEMOS_EDGE_LIVE=1 to run the live synthesis test")
	}
	s, err := New(ai.ProviderConfig{Type: ai.ProviderEdge}, tts.Options{})
	require.NoError(t, err)
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	resp, err := s.Synthesize(ctx, tts.Request{Text: "你好，这是 memos 后端 Edge 语音合成的真机测试。Hello world."})
	require.NoError(t, err)
	require.Equal(t, contentTypeMP3, resp.ContentType)
	require.Greater(t, len(resp.Audio), 1000)
	// MP3 sync word or LAME tag present.
	head := resp.Audio[:4]
	require.True(t, head[0] == 0xFF && (head[1]&0xE0) == 0xE0 || strings.HasPrefix(string(head), "ID3"),
		"expected MP3 sync header, got % x", head)
}
