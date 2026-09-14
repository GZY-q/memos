package store

import (
	"context"
)

// AuditLog is one persisted sensitive administrative or authentication event.
type AuditLog struct {
	// ID is the system generated unique identifier.
	ID int32
	// CreatedTs is the Unix timestamp when the event was recorded.
	CreatedTs int64
	// ActorUserID is the authenticated user id, 0 when anonymous.
	ActorUserID int32
	// ActorUsername is the authenticated username, or the attempted username
	// on a failed sign-in. Never stores passwords or tokens.
	ActorUsername string
	// Action is a stable short identifier such as auth.sign_in.
	Action string
	// Procedure is the RPC procedure or HTTP route that was invoked.
	Procedure string
	// ClientIP is the caller address.
	ClientIP string
	// Outcome is success, denied, or error.
	Outcome string
	// Detail is a JSON object of non-sensitive key/value context.
	Detail string
}

// FindAuditLog filters a ListAuditLogs query. All fields are optional.
type FindAuditLog struct {
	// ID selects one event by primary key.
	ID *int32
	// ActorUserID selects events for one user.
	ActorUserID *int32
	// ActorUsername selects events recorded under an exact username, including
	// failed sign-in attempts that never resolved a user id.
	ActorUsername *string
	// Action selects events with an exact action id.
	Action *string
	// Outcome selects success / denied / error.
	Outcome *string
	// Limit caps the result size. Drivers apply a sane default when unset.
	Limit *int
	// Offset skips the first N matching rows (offset-based pagination).
	Offset *int
	// SinceTs keeps only events with created_ts >= SinceTs (unix seconds).
	SinceTs *int64
}

// CreateAuditLog persists a new audit event.
func (s *Store) CreateAuditLog(ctx context.Context, create *AuditLog) (*AuditLog, error) {
	return s.driver.CreateAuditLog(ctx, create)
}

// ListAuditLogs returns audit events matching find, newest first.
func (s *Store) ListAuditLogs(ctx context.Context, find *FindAuditLog) ([]*AuditLog, error) {
	return s.driver.ListAuditLogs(ctx, find)
}

// auditDefaultListLimit bounds ListAuditLogs when FindAuditLog.Limit is unset.
const auditDefaultListLimit = 200

// AuditDefaultListLimit exposes the driver-default list cap for callers.
func AuditDefaultListLimit() int {
	return auditDefaultListLimit
}
