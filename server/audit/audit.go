// Package audit records sensitive administrative and authentication events
// as structured in-process logs. Phase one intentionally has no database
// table so SQLite, MySQL, and PostgreSQL stay schema-identical.
package audit

import (
	"context"
	"log/slog"
	"sync/atomic"
	"time"
)

// Message is the slog message used for every audit event. Operators can
// grep process logs for this constant (JSON handler: "msg":"audit").
const Message = "audit"

// Outcome is the result of a sensitive operation.
type Outcome string

// Audit outcomes. denied covers authentication/authorization rejections;
// error covers unexpected server-side failures.
const (
	OutcomeSuccess Outcome = "success"
	OutcomeDenied  Outcome = "denied"
	OutcomeError   Outcome = "error"
)

// Event is one sensitive administrative or authentication action.
// Detail must never contain passwords, access tokens, or PAT plaintext.
type Event struct {
	// Time is when the action completed. Zero values are filled by the logger.
	Time time.Time
	// ActorUserID is the authenticated user id, 0 when anonymous.
	ActorUserID int32
	// ActorUsername is the authenticated username, empty when anonymous.
	// For failed sign-in attempts this is the attempted username.
	ActorUsername string
	// Action is a stable short identifier such as auth.sign_in.
	Action string
	// Procedure is the RPC procedure or HTTP route that was invoked.
	Procedure string
	// ClientIP is the caller address, preferring reverse-proxy headers.
	ClientIP string
	// Outcome is success, denied, or error.
	Outcome Outcome
	// Detail holds non-sensitive context. Never store passwords or tokens.
	Detail map[string]string
}

// Logger writes audit events. Implementations must be safe for concurrent use.
type Logger interface {
	// LogEvent records one audit event.
	LogEvent(ctx context.Context, event Event)
}

// SlogLogger emits audit events through the process slog default logger.
type SlogLogger struct{}

// NewSlogLogger returns a Logger that writes structured slog attributes.
func NewSlogLogger() *SlogLogger {
	return &SlogLogger{}
}

// LogEvent writes event as a slog record. Success uses INFO; denied and error
// use WARN so failed admin/auth attempts stand out without elevating to ERROR.
func (*SlogLogger) LogEvent(ctx context.Context, event Event) {
	level := slog.LevelInfo
	if event.Outcome == OutcomeDenied || event.Outcome == OutcomeError {
		level = slog.LevelWarn
	}
	attrs := slogAttrs(event)
	slog.LogAttrs(ctx, level, Message, attrs...)
}

func slogAttrs(event Event) []slog.Attr {
	ts := event.Time
	if ts.IsZero() {
		ts = time.Now()
	}
	attrs := []slog.Attr{
		slog.Time("time", ts),
		slog.Int("actor_user_id", int(event.ActorUserID)),
		slog.String("actor_username", event.ActorUsername),
		slog.String("action", event.Action),
		slog.String("procedure", event.Procedure),
		slog.String("client_ip", event.ClientIP),
		slog.String("outcome", string(event.Outcome)),
	}
	// Flatten detail as detail.<key> so text and JSON handlers stay greppable
	// (e.g. detail.format=json) without nested-group encoding differences.
	for key, value := range event.Detail {
		attrs = append(attrs, slog.String("detail."+key, value))
	}
	return attrs
}

var defaultLogger atomic.Pointer[loggerBox]

type loggerBox struct {
	logger Logger
}

// SetDefault installs the process-wide audit logger. Passing nil restores the
// SlogLogger default.
func SetDefault(logger Logger) {
	if logger == nil {
		logger = NewSlogLogger()
	}
	defaultLogger.Store(&loggerBox{logger: logger})
}

// Default returns the process-wide audit logger, never nil.
func Default() Logger {
	if box := defaultLogger.Load(); box != nil && box.logger != nil {
		return box.logger
	}
	return NewSlogLogger()
}

// Log records event using the process-wide default logger.
func Log(ctx context.Context, event Event) {
	Default().LogEvent(ctx, event)
}
