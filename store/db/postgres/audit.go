package postgres

import (
	"context"
	"fmt"
	"strings"

	"github.com/pkg/errors"

	"github.com/usememos/memos/store"
)

func (d *DB) CreateAuditLog(ctx context.Context, create *store.AuditLog) (*store.AuditLog, error) {
	if create.Detail == "" {
		create.Detail = "{}"
	}
	fields := []string{"actor_user_id", "actor_username", "action", "procedure", "client_ip", "outcome", "detail"}
	args := []any{create.ActorUserID, create.ActorUsername, create.Action, create.Procedure, create.ClientIP, create.Outcome, create.Detail}
	if create.CreatedTs != 0 {
		fields = append(fields, "created_ts")
		args = append(args, create.CreatedTs)
	}
	stmt := "INSERT INTO audit_log (" + strings.Join(fields, ", ") + ") VALUES (" + placeholders(len(args)) + ") RETURNING id, created_ts"
	if err := d.db.QueryRowContext(ctx, stmt, args...).Scan(&create.ID, &create.CreatedTs); err != nil {
		return nil, errors.Wrap(err, "failed to insert audit log")
	}
	return create, nil
}

func (d *DB) ListAuditLogs(ctx context.Context, find *store.FindAuditLog) ([]*store.AuditLog, error) {
	where, args := []string{"1 = 1"}, []any{}
	if find.ID != nil {
		where, args = append(where, "id = "+placeholder(len(args)+1)), append(args, *find.ID)
	}
	if find.ActorUserID != nil {
		where, args = append(where, "actor_user_id = "+placeholder(len(args)+1)), append(args, *find.ActorUserID)
	}
	if find.ActorUsername != nil {
		where, args = append(where, "actor_username = "+placeholder(len(args)+1)), append(args, *find.ActorUsername)
	}
	if find.Action != nil {
		where, args = append(where, "action = "+placeholder(len(args)+1)), append(args, *find.Action)
	}
	if find.Outcome != nil {
		where, args = append(where, "outcome = "+placeholder(len(args)+1)), append(args, *find.Outcome)
	}
	if find.SinceTs != nil {
		where, args = append(where, "created_ts >= "+placeholder(len(args)+1)), append(args, *find.SinceTs)
	}
	limit := store.AuditDefaultListLimit()
	if find.Limit != nil && *find.Limit > 0 {
		limit = *find.Limit
	}
	offset := 0
	if find.Offset != nil && *find.Offset > 0 {
		offset = *find.Offset
	}
	query := "SELECT id, created_ts, actor_user_id, actor_username, action, procedure, client_ip, outcome, detail FROM audit_log WHERE " +
		strings.Join(where, " AND ") + fmt.Sprintf(" ORDER BY created_ts DESC, id DESC LIMIT %d OFFSET %d", limit, offset)

	rows, err := d.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, errors.Wrap(err, "failed to list audit logs")
	}
	defer rows.Close()

	list := make([]*store.AuditLog, 0)
	for rows.Next() {
		row := &store.AuditLog{}
		if err := rows.Scan(
			&row.ID,
			&row.CreatedTs,
			&row.ActorUserID,
			&row.ActorUsername,
			&row.Action,
			&row.Procedure,
			&row.ClientIP,
			&row.Outcome,
			&row.Detail,
		); err != nil {
			return nil, err
		}
		list = append(list, row)
	}
	return list, rows.Err()
}
