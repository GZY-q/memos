package v1

import (
	"net/http"
	"testing"

	"github.com/labstack/echo/v5"
	"github.com/stretchr/testify/require"

	"github.com/usememos/memos/store"
)

func TestParseAuditLogQueryParams(t *testing.T) {
	t.Parallel()

	t.Run("defaults", func(t *testing.T) {
		find := &store.FindAuditLog{}
		require.NoError(t, parseAuditLogQueryParams("", "", "", "", "", "", find))
		require.NotNil(t, find.Limit)
		require.Equal(t, auditLogsDefaultLimit, *find.Limit)
		require.Nil(t, find.Offset)
		require.Nil(t, find.SinceTs)
	})

	t.Run("limit capped", func(t *testing.T) {
		find := &store.FindAuditLog{}
		require.NoError(t, parseAuditLogQueryParams("9999", "", "", "", "", "", find))
		require.Equal(t, auditLogsMaxLimit, *find.Limit)
	})

	t.Run("offset and since", func(t *testing.T) {
		find := &store.FindAuditLog{}
		require.NoError(t, parseAuditLogQueryParams("50", "100", "1700000000", "auth.sign_in", "success", "alice", find))
		require.Equal(t, 50, *find.Limit)
		require.Equal(t, 100, *find.Offset)
		require.Equal(t, int64(1700000000), *find.SinceTs)
		require.Equal(t, "auth.sign_in", *find.Action)
		require.Equal(t, "success", *find.Outcome)
		require.Equal(t, "alice", *find.ActorUsername)
	})

	t.Run("rejects negative offset", func(t *testing.T) {
		find := &store.FindAuditLog{}
		err := parseAuditLogQueryParams("", "-1", "", "", "", "", find)
		require.Error(t, err)
		httpErr, ok := err.(*echo.HTTPError)
		require.True(t, ok)
		require.Equal(t, http.StatusBadRequest, httpErr.Code)
	})

	t.Run("rejects non-numeric since", func(t *testing.T) {
		find := &store.FindAuditLog{}
		err := parseAuditLogQueryParams("", "", "yesterday", "", "", "", find)
		require.Error(t, err)
	})

	t.Run("rejects invalid limit", func(t *testing.T) {
		find := &store.FindAuditLog{}
		require.Error(t, parseAuditLogQueryParams("abc", "", "", "", "", "", find))
		require.Error(t, parseAuditLogQueryParams("0", "", "", "", "", "", find))
	})
}
