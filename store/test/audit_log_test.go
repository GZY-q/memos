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
}
