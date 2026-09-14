package test

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/usememos/memos/store"
)

func TestAuditLogCreateAndList(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	ts := NewTestingStore(ctx, t)

	created, err := ts.CreateAuditLog(ctx, &store.AuditLog{
		ActorUserID:   7,
		ActorUsername: "alice",
		Action:        "auth.sign_in",
		Procedure:     "/memos.api.v1.AuthService/SignIn",
		ClientIP:      "203.0.113.10",
		Outcome:       "success",
		Detail:        `{"ok":"true"}`,
	})
	require.NoError(t, err)
	require.NotZero(t, created.ID)
	require.NotZero(t, created.CreatedTs)

	denied, err := ts.CreateAuditLog(ctx, &store.AuditLog{
		ActorUsername: "bob",
		Action:        "auth.sign_in",
		Outcome:       "denied",
		Detail:        "{}",
	})
	require.NoError(t, err)

	list, err := ts.ListAuditLogs(ctx, &store.FindAuditLog{})
	require.NoError(t, err)
	require.GreaterOrEqual(t, len(list), 2)

	action := "auth.sign_in"
	filtered, err := ts.ListAuditLogs(ctx, &store.FindAuditLog{Action: &action})
	require.NoError(t, err)
	require.GreaterOrEqual(t, len(filtered), 2)

	outcome := "denied"
	deniedOnly, err := ts.ListAuditLogs(ctx, &store.FindAuditLog{Outcome: &outcome})
	require.NoError(t, err)
	require.NotEmpty(t, deniedOnly)
	require.Equal(t, "bob", deniedOnly[0].ActorUsername)
	require.Equal(t, denied.ID, deniedOnly[0].ID)

	username := "alice"
	byUsername, err := ts.ListAuditLogs(ctx, &store.FindAuditLog{ActorUsername: &username})
	require.NoError(t, err)
	require.NotEmpty(t, byUsername)
	for _, row := range byUsername {
		require.Equal(t, "alice", row.ActorUsername)
	}

	// Offset pagination: skip the first row and still receive the rest.
	all, err := ts.ListAuditLogs(ctx, &store.FindAuditLog{})
	require.NoError(t, err)
	require.GreaterOrEqual(t, len(all), 2)
	offset := 1
	paged, err := ts.ListAuditLogs(ctx, &store.FindAuditLog{Offset: &offset})
	require.NoError(t, err)
	require.Equal(t, len(all)-1, len(paged))
	require.Equal(t, all[1].ID, paged[0].ID)

	// SinceTs keeps only events at or after the cutoff.
	since := all[0].CreatedTs
	sinceOnly, err := ts.ListAuditLogs(ctx, &store.FindAuditLog{SinceTs: &since})
	require.NoError(t, err)
	require.NotEmpty(t, sinceOnly)
	for _, row := range sinceOnly {
		require.GreaterOrEqual(t, row.CreatedTs, since)
	}
}
