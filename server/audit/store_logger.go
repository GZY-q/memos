package audit

import (
	"context"
	"encoding/json"
	"log/slog"
	"time"

	"github.com/usememos/memos/store"
)

// StoreLogger persists events to the database and still emits slog lines so
// operators can grep process logs without querying the table.
type StoreLogger struct {
	store *store.Store
	inner Logger
}

// NewStoreLogger wraps a store and an inner logger (nil means SlogLogger).
func NewStoreLogger(s *store.Store, inner Logger) *StoreLogger {
	if inner == nil {
		inner = NewSlogLogger()
	}
	return &StoreLogger{store: s, inner: inner}
}

// LogEvent writes the slog record first, then best-effort inserts into audit_log.
// Database failures are logged as warnings and never fail the original request.
func (l *StoreLogger) LogEvent(ctx context.Context, event Event) {
	l.inner.LogEvent(ctx, event)
	if l.store == nil {
		return
	}
	detail := "{}"
	if len(event.Detail) > 0 {
		if bytes, err := json.Marshal(event.Detail); err == nil {
			detail = string(bytes)
		}
	}
	ts := event.Time
	if ts.IsZero() {
		ts = time.Now()
	}
	_, err := l.store.CreateAuditLog(ctx, &store.AuditLog{
		CreatedTs:     ts.Unix(),
		ActorUserID:   event.ActorUserID,
		ActorUsername: event.ActorUsername,
		Action:        event.Action,
		Procedure:     event.Procedure,
		ClientIP:      event.ClientIP,
		Outcome:       string(event.Outcome),
		Detail:        detail,
	})
	if err != nil {
		slog.WarnContext(ctx, "failed to persist audit event",
			slog.String("action", event.Action),
			slog.String("error", err.Error()),
		)
	}
}
