package v1

import (
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/labstack/echo/v5"

	"github.com/usememos/memos/server/auth"
	"github.com/usememos/memos/store"
)

const (
	// auditLogsPath is the instance-admin read-only audit query endpoint.
	auditLogsPath = "/api/v1/audit-logs"

	// auditLogsDefaultLimit is applied when the limit query parameter is absent.
	auditLogsDefaultLimit = 100

	// auditLogsMaxLimit caps the limit query parameter to bound result size.
	auditLogsMaxLimit = 500
)

// auditLogEntry is one audit event returned to the instance admin. Sensitive
// credentials are never present in the stored row; detail is passed through
// as the original JSON object.
type auditLogEntry struct {
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

// auditLogsResponse is the JSON body of GET /api/v1/audit-logs.
type auditLogsResponse struct {
	Logs []auditLogEntry `json:"logs"`
}

// RegisterAuditLogRoutes registers the admin-only audit log query endpoint.
// The route is intentionally outside PublicMethods: callers must be signed in
// and hold the instance admin role.
func RegisterAuditLogRoutes(router sseRouteRegistrar, storeInstance *store.Store, secret string) {
	authenticator := auth.NewAuthenticator(storeInstance, secret)
	router.GET(auditLogsPath, func(c *echo.Context) error {
		return handleListAuditLogs(c, storeInstance, authenticator)
	})
}

// handleListAuditLogs returns recent audit events for instance admins only.
// Regular users and anonymous callers are rejected before any row is read.
func handleListAuditLogs(c *echo.Context, storeInstance *store.Store, authenticator *auth.Authenticator) error {
	ctx := c.Request().Context()

	authHeader := c.Request().Header.Get(echo.HeaderAuthorization)
	cookieHeader := c.Request().Header.Get("Cookie")
	user, err := authenticator.AuthenticateToUser(ctx, authHeader, cookieHeader)
	if err != nil {
		return echo.NewHTTPError(http.StatusUnauthorized, "authentication required").Wrap(err)
	}
	if user == nil {
		return echo.NewHTTPError(http.StatusUnauthorized, "authentication required")
	}
	if user.Role != store.RoleAdmin {
		return echo.NewHTTPError(http.StatusForbidden, "instance admin required")
	}

	find := &store.FindAuditLog{}
	if err := applyAuditLogQueryParams(c, find); err != nil {
		return err
	}

	logs, err := storeInstance.ListAuditLogs(ctx, find)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to list audit logs").Wrap(err)
	}

	payload := auditLogsResponse{Logs: make([]auditLogEntry, 0, len(logs))}
	for _, row := range logs {
		payload.Logs = append(payload.Logs, auditLogEntry{
			ID:            row.ID,
			CreatedAt:     formatExportTimestamp(row.CreatedTs),
			ActorUserID:   row.ActorUserID,
			ActorUsername: row.ActorUsername,
			Action:        row.Action,
			Procedure:     row.Procedure,
			ClientIP:      row.ClientIP,
			Outcome:       row.Outcome,
			Detail:        auditLogDetailJSON(row.Detail),
		})
	}

	c.Response().Header().Set(echo.HeaderContentType, "application/json; charset=utf-8")
	c.Response().Header().Set(echo.HeaderCacheControl, "private, no-store")
	return c.JSON(http.StatusOK, payload)
}

// applyAuditLogQueryParams reads limit, action, outcome, and username from the
// request query string and applies them to find.
func applyAuditLogQueryParams(c *echo.Context, find *store.FindAuditLog) error {
	if raw := c.QueryParam("limit"); raw != "" {
		limit, err := strconv.Atoi(raw)
		if err != nil || limit <= 0 {
			return echo.NewHTTPError(http.StatusBadRequest, "invalid limit; must be a positive integer")
		}
		if limit > auditLogsMaxLimit {
			limit = auditLogsMaxLimit
		}
		find.Limit = &limit
	} else {
		limit := auditLogsDefaultLimit
		find.Limit = &limit
	}

	if action := c.QueryParam("action"); action != "" {
		find.Action = &action
	}
	if outcome := c.QueryParam("outcome"); outcome != "" {
		find.Outcome = &outcome
	}
	if username := c.QueryParam("username"); username != "" {
		find.ActorUsername = &username
	}
	return nil
}

// auditLogDetailJSON normalizes the stored detail string into valid JSON for
// the response. Empty or malformed values become an empty object so the field
// is always a JSON object and never breaks response encoding.
func auditLogDetailJSON(detail string) json.RawMessage {
	if detail == "" {
		return json.RawMessage("{}")
	}
	if !json.Valid([]byte(detail)) {
		return json.RawMessage("{}")
	}
	return json.RawMessage(detail)
}
