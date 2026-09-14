package sqlite

import (
	"context"
	"strings"

	"github.com/pkg/errors"

	"github.com/usememos/memos/store"
)

func (d *DB) CreateAuditLog(ctx context.Context, create *store.AuditLog) (*store.AuditLog, error) {
	if create.Detail == "" {
		create.Detail = "{}"
	}
	fields := []string{"`actor_user_id`", "`actor_username`", "`action`", "`procedure`", "`client_ip`", "`outcome`", "`detail`"}
	if create.CreatedTs != 0 {
		fields = append(fields, "`created_ts`")
	}
	args := []any{create.ActorUserID, create.ActorUsername, create.Action, create.Procedure, create.ClientIP, create.Outcome, create.Detail}
	if create.CreatedTs != 0 {
		args = append(args, create.CreatedTs)
	}
	placeholders := make([]string, len(fields))
	for i := range placeholders {
		placeholders[i] = "?"
	}
	stmt := "INSERT INTO `audit_log` (" + strings.Join(fields, ", ") + ") VALUES (" + strings.Join(placeholders, ", ") + ") RETURNING `id`, `created_ts`"
	if err := d.db.QueryRowContext(ctx, stmt, args...).Scan(&create.ID, &create.CreatedTs); err != nil {
		return nil, errors.Wrap(err, "failed to insert audit log")
	}
	return create, nil
}

func (d *DB) ListAuditLogs(ctx context.Context, find *store.FindAuditLog) ([]*store.AuditLog, error) {
	where, args := []string{"1 = 1"}, []any{}
	if find.ID != nil {
		where, args = append(where, "`id` = ?"), append(args, *find.ID)
	}
	if find.ActorUserID != nil {
		where, args = append(where, "`actor_user_id` = ?"), append(args, *find.ActorUserID)
	}
	if find.ActorUsername != nil {
		where, args = append(where, "`actor_username` = ?"), append(args, *find.ActorUsername)
	}
	if find.Action != nil {
		where, args = append(where, "`action` = ?"), append(args, *find.Action)
	}
	if find.Outcome != nil {
		where, args = append(where, "`outcome` = ?"), append(args, *find.Outcome)
	}
	limit := store.AuditDefaultListLimit()
	if find.Limit != nil && *find.Limit > 0 {
		limit = *find.Limit
	}
	query := "SELECT `id`, `created_ts`, `actor_user_id`, `actor_username`, `action`, `procedure`, `client_ip`, `outcome`, `detail` FROM `audit_log` WHERE " +
		strings.Join(where, " AND ") + " ORDER BY `created_ts` DESC, `id` DESC LIMIT ?"
	args = append(args, limit)

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
