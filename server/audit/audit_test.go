package audit_test

import (
	"bytes"
	"context"
	"encoding/json"
	"log/slog"
	"strings"
	"testing"
	"time"

	"github.com/usememos/memos/server/audit"
)

// captureLogger is a Logger that records events for assertions.
type captureLogger struct {
	events []audit.Event
}

func (l *captureLogger) LogEvent(_ context.Context, event audit.Event) {
	l.events = append(l.events, event)
}

func TestSlogLoggerWritesStructuredJSONLine(t *testing.T) {
	var buf bytes.Buffer
	previous := slog.Default()
	t.Cleanup(func() { slog.SetDefault(previous) })
	slog.SetDefault(slog.New(slog.NewJSONHandler(&buf, nil)))

	logger := audit.NewSlogLogger()
	logger.LogEvent(context.Background(), audit.Event{
		Time:          time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC),
		ActorUserID:   7,
		ActorUsername: "alice",
		Action:        "auth.sign_in",
		Procedure:     "/memos.api.v1.AuthService/SignIn",
		ClientIP:      "203.0.113.9",
		Outcome:       audit.OutcomeSuccess,
		Detail:        map[string]string{"auth_method": "password"},
	})

	line := strings.TrimSpace(buf.String())
	if line == "" {
		t.Fatal("expected a JSON log line")
	}
	var record map[string]any
	if err := json.Unmarshal([]byte(line), &record); err != nil {
		t.Fatalf("log line is not JSON: %v\nline=%s", err, line)
	}
	if record["msg"] != audit.Message {
		t.Fatalf("msg = %v, want %q", record["msg"], audit.Message)
	}
	if record["level"] != "INFO" {
		t.Fatalf("level = %v, want INFO", record["level"])
	}
	if record["action"] != "auth.sign_in" {
		t.Fatalf("action = %v", record["action"])
	}
	if record["actor_username"] != "alice" {
		t.Fatalf("actor_username = %v", record["actor_username"])
	}
	if record["detail.auth_method"] != "password" {
		t.Fatalf("detail.auth_method = %v", record["detail.auth_method"])
	}
}

func TestSlogLoggerUsesWarnForDeniedAndError(t *testing.T) {
	var buf bytes.Buffer
	previous := slog.Default()
	t.Cleanup(func() { slog.SetDefault(previous) })
	slog.SetDefault(slog.New(slog.NewJSONHandler(&buf, nil)))

	logger := audit.NewSlogLogger()
	logger.LogEvent(context.Background(), audit.Event{
		Action:  "auth.sign_in",
		Outcome: audit.OutcomeDenied,
	})
	logger.LogEvent(context.Background(), audit.Event{
		Action:  "user.delete",
		Outcome: audit.OutcomeError,
	})

	lines := strings.Split(strings.TrimSpace(buf.String()), "\n")
	if len(lines) != 2 {
		t.Fatalf("expected 2 log lines, got %d: %q", len(lines), buf.String())
	}
	for _, line := range lines {
		var record map[string]any
		if err := json.Unmarshal([]byte(line), &record); err != nil {
			t.Fatalf("log line is not JSON: %v\nline=%s", err, line)
		}
		if record["level"] != "WARN" {
			t.Fatalf("level = %v, want WARN", record["level"])
		}
	}
}

func TestDefaultAndSetDefault(t *testing.T) {
	previous := audit.Default()
	t.Cleanup(func() { audit.SetDefault(previous) })

	capture := &captureLogger{}
	audit.SetDefault(capture)
	if audit.Default() != capture {
		t.Fatal("Default() did not return the installed logger")
	}

	audit.Log(context.Background(), audit.Event{Action: "user.export", Outcome: audit.OutcomeSuccess})
	if len(capture.events) != 1 || capture.events[0].Action != "user.export" {
		t.Fatalf("captured events = %+v", capture.events)
	}

	audit.SetDefault(nil)
	if audit.Default() == nil {
		t.Fatal("Default() must never return nil")
	}
	// Swallow the default logger write so the test stays quiet.
	audit.Log(context.Background(), audit.Event{Action: "noop", Outcome: audit.OutcomeSuccess})
}
