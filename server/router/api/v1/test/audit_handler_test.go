package test

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/labstack/echo/v5"
	"github.com/stretchr/testify/require"

	"github.com/usememos/memos/server/auth"
	apiv1 "github.com/usememos/memos/server/router/api/v1"
	"github.com/usememos/memos/store"
)

type auditLogEntryJSON struct {
	ID            int32           `json:"id"`
	CreatedAt     string          `json:"createdAt"`
	ActorUserID   int32           `json:"actorUserId"`
	ActorUsername string          `json:"actorUsername"`
	Action        string          `json:"action"`
	Procedure     string          `json:"procedure"`
	ClientIP      string          `json:"clientIp"`
	Outcome       string          `json:"outcome"`
	Detail        json.RawMessage `json:"detail"`
}

type auditLogsResponseJSON struct {
	Logs []auditLogEntryJSON `json:"logs"`
}

func generateAuditToken(t *testing.T, secret string, user *store.User) string {
	t.Helper()
	token, _, err := auth.GenerateAccessTokenV2(
		user.ID,
		user.Username,
		string(user.Role),
		string(user.RowStatus),
		[]byte(secret),
	)
	require.NoError(t, err)
	return token
}

func seedAuditLog(ctx context.Context, t *testing.T, s *store.Store, log *store.AuditLog) *store.AuditLog {
	t.Helper()
	created, err := s.CreateAuditLog(ctx, log)
	require.NoError(t, err)
	return created
}

func doAuditLogsRequest(t *testing.T, e *echo.Echo, token, query string) *httptest.ResponseRecorder {
	t.Helper()
	target := "/api/v1/audit-logs"
	if query != "" {
		target += "?" + query
	}
	req := httptest.NewRequest(http.MethodGet, target, nil)
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)
	return rec
}

func TestAuditLogs_AccessControl(t *testing.T) {
	ctx := context.Background()
	ts := NewTestService(t)
	defer ts.Cleanup()

	admin, err := ts.CreateHostUser(ctx, "audit-admin")
	require.NoError(t, err)
	regular, err := ts.CreateRegularUser(ctx, "audit-regular")
	require.NoError(t, err)

	adminToken := generateAuditToken(t, ts.Secret, admin)
	regularToken := generateAuditToken(t, ts.Secret, regular)

	e := echo.New()
	apiv1.RegisterAuditLogRoutes(e, ts.Store, ts.Secret)

	t.Run("anonymous returns 401", func(t *testing.T) {
		rec := doAuditLogsRequest(t, e, "", "")
		require.Equal(t, http.StatusUnauthorized, rec.Code)
	})

	t.Run("invalid token returns 401", func(t *testing.T) {
		rec := doAuditLogsRequest(t, e, "not-a-real-token", "")
		require.Equal(t, http.StatusUnauthorized, rec.Code)
	})

	t.Run("regular user returns 403", func(t *testing.T) {
		rec := doAuditLogsRequest(t, e, regularToken, "")
		require.Equal(t, http.StatusForbidden, rec.Code)
	})

	t.Run("admin can read", func(t *testing.T) {
		rec := doAuditLogsRequest(t, e, adminToken, "")
		require.Equal(t, http.StatusOK, rec.Code)
		require.Equal(t, "application/json; charset=utf-8", rec.Header().Get(echo.HeaderContentType))

		var payload auditLogsResponseJSON
		require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &payload))
		require.NotNil(t, payload.Logs)
	})
}

func TestAuditLogs_QueryFilters(t *testing.T) {
	ctx := context.Background()
	ts := NewTestService(t)
	defer ts.Cleanup()

	admin, err := ts.CreateHostUser(ctx, "audit-filter-admin")
	require.NoError(t, err)
	adminToken := generateAuditToken(t, ts.Secret, admin)

	seedAuditLog(ctx, t, ts.Store, &store.AuditLog{
		ActorUserID:   admin.ID,
		ActorUsername: "audit-filter-admin",
		Action:        "auth.sign_in",
		Procedure:     "/memos.api.v1.AuthService/SignIn",
		ClientIP:      "203.0.113.10",
		Outcome:       "success",
		Detail:        `{"auth_method":"password"}`,
	})
	seedAuditLog(ctx, t, ts.Store, &store.AuditLog{
		ActorUsername: "intruder",
		Action:        "auth.sign_in",
		Procedure:     "/memos.api.v1.AuthService/SignIn",
		ClientIP:      "198.51.100.7",
		Outcome:       "denied",
		Detail:        `{"auth_method":"password"}`,
	})
	seedAuditLog(ctx, t, ts.Store, &store.AuditLog{
		ActorUserID:   admin.ID,
		ActorUsername: "audit-filter-admin",
		Action:        "user.export",
		Procedure:     "GET /api/v1/export/me",
		ClientIP:      "203.0.113.10",
		Outcome:       "success",
		Detail:        `{"format":"json","memo_count":"2"}`,
	})

	e := echo.New()
	apiv1.RegisterAuditLogRoutes(e, ts.Store, ts.Secret)

	t.Run("all logs returned with detail passthrough", func(t *testing.T) {
		rec := doAuditLogsRequest(t, e, adminToken, "")
		require.Equal(t, http.StatusOK, rec.Code)

		var payload auditLogsResponseJSON
		require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &payload))
		require.GreaterOrEqual(t, len(payload.Logs), 3)

		byAction := map[string]auditLogEntryJSON{}
		for _, entry := range payload.Logs {
			byAction[entry.Action] = entry
		}

		signIn, ok := byAction["auth.sign_in"]
		require.True(t, ok)
		require.NotEmpty(t, signIn.CreatedAt)
		require.Equal(t, "success", signIn.Outcome)
		require.JSONEq(t, `{"auth_method":"password"}`, string(signIn.Detail))

		export, ok := byAction["user.export"]
		require.True(t, ok)
		require.JSONEq(t, `{"format":"json","memo_count":"2"}`, string(export.Detail))
	})

	t.Run("action filter applies", func(t *testing.T) {
		rec := doAuditLogsRequest(t, e, adminToken, "action=user.export")
		require.Equal(t, http.StatusOK, rec.Code)

		var payload auditLogsResponseJSON
		require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &payload))
		require.NotEmpty(t, payload.Logs)
		for _, entry := range payload.Logs {
			require.Equal(t, "user.export", entry.Action)
		}
	})

	t.Run("outcome filter applies", func(t *testing.T) {
		rec := doAuditLogsRequest(t, e, adminToken, "outcome=denied")
		require.Equal(t, http.StatusOK, rec.Code)

		var payload auditLogsResponseJSON
		require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &payload))
		require.Len(t, payload.Logs, 1)
		require.Equal(t, "denied", payload.Logs[0].Outcome)
		require.Equal(t, "intruder", payload.Logs[0].ActorUsername)
	})

	t.Run("username filter applies", func(t *testing.T) {
		rec := doAuditLogsRequest(t, e, adminToken, "username=intruder")
		require.Equal(t, http.StatusOK, rec.Code)

		var payload auditLogsResponseJSON
		require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &payload))
		require.Len(t, payload.Logs, 1)
		require.Equal(t, "intruder", payload.Logs[0].ActorUsername)
		require.Equal(t, "auth.sign_in", payload.Logs[0].Action)
	})
}

func TestAuditLogs_Limit(t *testing.T) {
	ctx := context.Background()
	ts := NewTestService(t)
	defer ts.Cleanup()

	admin, err := ts.CreateHostUser(ctx, "audit-limit-admin")
	require.NoError(t, err)
	adminToken := generateAuditToken(t, ts.Secret, admin)

	const total = 5
	for i := 0; i < total; i++ {
		seedAuditLog(ctx, t, ts.Store, &store.AuditLog{
			ActorUserID:   admin.ID,
			ActorUsername: "audit-limit-admin",
			Action:        "user.update",
			Procedure:     "/memos.api.v1.UserService/UpdateUser",
			ClientIP:      "203.0.113.10",
			Outcome:       "success",
			Detail:        fmt.Sprintf(`{"seq":"%d"}`, i),
		})
	}

	e := echo.New()
	apiv1.RegisterAuditLogRoutes(e, ts.Store, ts.Secret)

	t.Run("limit caps result size", func(t *testing.T) {
		rec := doAuditLogsRequest(t, e, adminToken, "limit=2")
		require.Equal(t, http.StatusOK, rec.Code)

		var payload auditLogsResponseJSON
		require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &payload))
		require.Len(t, payload.Logs, 2)
	})

	t.Run("limit above max is clamped", func(t *testing.T) {
		rec := doAuditLogsRequest(t, e, adminToken, "limit=5000")
		require.Equal(t, http.StatusOK, rec.Code)

		var payload auditLogsResponseJSON
		require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &payload))
		require.GreaterOrEqual(t, len(payload.Logs), total)
		require.LessOrEqual(t, len(payload.Logs), 500)
	})

	t.Run("invalid limit returns 400", func(t *testing.T) {
		rec := doAuditLogsRequest(t, e, adminToken, "limit=abc")
		require.Equal(t, http.StatusBadRequest, rec.Code)
	})

	t.Run("non-positive limit returns 400", func(t *testing.T) {
		rec := doAuditLogsRequest(t, e, adminToken, "limit=0")
		require.Equal(t, http.StatusBadRequest, rec.Code)
	})
}

func TestAuditLogs_NewestFirstAndFields(t *testing.T) {
	ctx := context.Background()
	ts := NewTestService(t)
	defer ts.Cleanup()

	admin, err := ts.CreateHostUser(ctx, "audit-fields-admin")
	require.NoError(t, err)
	adminToken := generateAuditToken(t, ts.Secret, admin)

	first := seedAuditLog(ctx, t, ts.Store, &store.AuditLog{
		ActorUserID:   admin.ID,
		ActorUsername: "audit-fields-admin",
		Action:        "pat.create",
		Procedure:     "/memos.api.v1.UserService/CreatePersonalAccessToken",
		ClientIP:      "203.0.113.10",
		Outcome:       "success",
		Detail:        `{"parent":"users/1","expires_in_days":"30"}`,
		CreatedTs:     1700000000,
	})
	second := seedAuditLog(ctx, t, ts.Store, &store.AuditLog{
		ActorUserID:   admin.ID,
		ActorUsername: "audit-fields-admin",
		Action:        "pat.delete",
		Procedure:     "/memos.api.v1.UserService/DeletePersonalAccessToken",
		ClientIP:      "203.0.113.10",
		Outcome:       "success",
		Detail:        `{"target":"users/1/tokens/2"}`,
		CreatedTs:     1700000100,
	})

	e := echo.New()
	apiv1.RegisterAuditLogRoutes(e, ts.Store, ts.Secret)

	rec := doAuditLogsRequest(t, e, adminToken, "action=pat.delete")
	require.Equal(t, http.StatusOK, rec.Code)

	var payload auditLogsResponseJSON
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &payload))
	require.Len(t, payload.Logs, 1)
	entry := payload.Logs[0]
	require.Equal(t, second.ID, entry.ID)
	require.Equal(t, admin.ID, entry.ActorUserID)
	require.Equal(t, "audit-fields-admin", entry.ActorUsername)
	require.Equal(t, "pat.delete", entry.Action)
	require.Equal(t, "/memos.api.v1.UserService/DeletePersonalAccessToken", entry.Procedure)
	require.Equal(t, "203.0.113.10", entry.ClientIP)
	require.Equal(t, "success", entry.Outcome)
	require.JSONEq(t, `{"target":"users/1/tokens/2"}`, string(entry.Detail))
	require.NotEqual(t, first.ID, entry.ID)
}
