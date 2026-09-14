package v1

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/labstack/echo/v5"
	"github.com/pkg/errors"

	"github.com/usememos/memos/server/auth"
	"github.com/usememos/memos/store"
)

const (
	// exportPath is the authenticated backup export endpoint for the current user.
	exportPath = "/api/v1/export/me"

	// exportBatchSize is the page size used when listing memos for export.
	exportBatchSize = 100

	// exportFormatJSON is the default machine-readable export format.
	exportFormatJSON = "json"

	// exportFormatMarkdown produces a human-readable markdown dump.
	exportFormatMarkdown = "markdown"

	// exportSchemaVersion is the payload version for the JSON export format.
	exportSchemaVersion = 1
)

// exportPayload is the stable backup document returned by GET /api/v1/export/me.
// Field names are part of the on-disk backup contract; keep them stable.
type exportPayload struct {
	Version     int                `json:"version"`
	ExportedAt  string             `json:"exportedAt"`
	User        exportUser         `json:"user"`
	Memos       []exportMemo       `json:"memos"`
	Attachments []exportAttachment `json:"attachments"`
}

// exportUser identifies the account the export belongs to.
type exportUser struct {
	ID       int32  `json:"id"`
	Username string `json:"username"`
}

// exportMemo is one memo owned by the current user.
type exportMemo struct {
	UID            string   `json:"uid"`
	Content        string   `json:"content"`
	Visibility     string   `json:"visibility"`
	Pinned         bool     `json:"pinned"`
	State          string   `json:"state"`
	CreatedAt      string   `json:"createdAt"`
	UpdatedAt      string   `json:"updatedAt"`
	Tags           []string `json:"tags,omitempty"`
	ParentUID      string   `json:"parentUid,omitempty"`
	AttachmentUIDs []string `json:"attachmentUids,omitempty"`
}

// exportAttachment is attachment metadata for the current user.
// Binary content is intentionally omitted; the download URL pattern is stable.
type exportAttachment struct {
	UID       string `json:"uid"`
	Filename  string `json:"filename"`
	Type      string `json:"type"`
	Size      int64  `json:"size"`
	MemoUID   string `json:"memoUid,omitempty"`
	CreatedAt string `json:"createdAt"`
	UpdatedAt string `json:"updatedAt"`
}

// RegisterExportRoutes registers the authenticated memo export endpoint.
// The route is intentionally outside PublicMethods: it always requires a
// signed-in user (Bearer access token, PAT, or refresh cookie).
func RegisterExportRoutes(router sseRouteRegistrar, storeInstance *store.Store, secret string) {
	authenticator := auth.NewAuthenticator(storeInstance, secret)
	router.GET(exportPath, func(c *echo.Context) error {
		return handleExportMe(c, storeInstance, authenticator)
	})
}

// handleExportMe exports the authenticated user's memos and attachment metadata.
// There is no username or user-id parameter: the identity always comes from the
// credential, so the endpoint cannot be used to export another account.
func handleExportMe(c *echo.Context, storeInstance *store.Store, authenticator *auth.Authenticator) error {
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

	payload, err := buildExportPayload(ctx, storeInstance, user)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to build export").Wrap(err)
	}

	format := strings.ToLower(strings.TrimSpace(c.QueryParam("format")))
	if format == "" {
		format = exportFormatJSON
	}

	switch format {
	case exportFormatJSON:
		c.Response().Header().Set(echo.HeaderContentType, "application/json; charset=utf-8")
		c.Response().Header().Set(echo.HeaderContentDisposition, exportContentDisposition(user.Username, "json"))
		c.Response().Header().Set(echo.HeaderCacheControl, "private, no-store")
		return c.JSON(http.StatusOK, payload)
	case exportFormatMarkdown:
		body := renderExportMarkdown(payload)
		c.Response().Header().Set(echo.HeaderContentType, "text/markdown; charset=utf-8")
		c.Response().Header().Set(echo.HeaderContentDisposition, exportContentDisposition(user.Username, "md"))
		c.Response().Header().Set(echo.HeaderCacheControl, "private, no-store")
		return c.String(http.StatusOK, body)
	default:
		return echo.NewHTTPError(http.StatusBadRequest, "unsupported format; use json or markdown")
	}
}

// exportContentDisposition builds a download filename for the current user.
func exportContentDisposition(username, ext string) string {
	safe := strings.Map(func(r rune) rune {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '-' || r == '_' || r == '.' {
			return r
		}
		return '-'
	}, username)
	if safe == "" {
		safe = "user"
	}
	return fmt.Sprintf("attachment; filename=\"memos-export-%s.%s\"", safe, ext)
}

// buildExportPayload collects every memo and attachment owned by the user.
func buildExportPayload(ctx context.Context, storeInstance *store.Store, user *store.User) (*exportPayload, error) {
	memos, err := listAllUserMemos(ctx, storeInstance, user.ID)
	if err != nil {
		return nil, errors.Wrap(err, "failed to list user memos")
	}
	attachments, err := listAllUserAttachments(ctx, storeInstance, user.ID)
	if err != nil {
		return nil, errors.Wrap(err, "failed to list user attachments")
	}

	attachmentsByMemoID := make(map[int32][]string)
	for _, attachment := range attachments {
		if attachment.MemoID != nil {
			attachmentsByMemoID[*attachment.MemoID] = append(attachmentsByMemoID[*attachment.MemoID], attachment.UID)
		}
	}

	payload := &exportPayload{
		Version:     exportSchemaVersion,
		ExportedAt:  time.Now().UTC().Format(time.RFC3339),
		User:        exportUser{ID: user.ID, Username: user.Username},
		Memos:       make([]exportMemo, 0, len(memos)),
		Attachments: make([]exportAttachment, 0, len(attachments)),
	}

	for _, memo := range memos {
		item := exportMemo{
			UID:        memo.UID,
			Content:    memo.Content,
			Visibility: string(memo.Visibility),
			Pinned:     memo.Pinned,
			State:      string(memo.RowStatus),
			CreatedAt:  formatExportTimestamp(memo.CreatedTs),
			UpdatedAt:  formatExportTimestamp(memo.UpdatedTs),
		}
		if memo.Payload != nil && len(memo.Payload.Tags) > 0 {
			item.Tags = append([]string(nil), memo.Payload.Tags...)
		}
		if memo.ParentUID != nil {
			item.ParentUID = *memo.ParentUID
		}
		if uids := attachmentsByMemoID[memo.ID]; len(uids) > 0 {
			item.AttachmentUIDs = append([]string(nil), uids...)
		}
		payload.Memos = append(payload.Memos, item)
	}

	for _, attachment := range attachments {
		item := exportAttachment{
			UID:       attachment.UID,
			Filename:  attachment.Filename,
			Type:      attachment.Type,
			Size:      attachment.Size,
			CreatedAt: formatExportTimestamp(attachment.CreatedTs),
			UpdatedAt: formatExportTimestamp(attachment.UpdatedTs),
		}
		if attachment.MemoUID != nil {
			item.MemoUID = *attachment.MemoUID
		}
		payload.Attachments = append(payload.Attachments, item)
	}

	return payload, nil
}

// listAllUserMemos pages through every memo the user created, including
// archived memos and comments.
func listAllUserMemos(ctx context.Context, storeInstance *store.Store, userID int32) ([]*store.Memo, error) {
	creatorID := userID
	result := make([]*store.Memo, 0)
	offset := 0
	for {
		limit := exportBatchSize
		pageOffset := offset
		batch, err := storeInstance.ListMemos(ctx, &store.FindMemo{
			CreatorID: &creatorID,
			Limit:     &limit,
			Offset:    &pageOffset,
		})
		if err != nil {
			return nil, errors.Wrap(err, "failed to list memos")
		}
		result = append(result, batch...)
		if len(batch) < exportBatchSize {
			return result, nil
		}
		offset += exportBatchSize
	}
}

// listAllUserAttachments returns attachment metadata for every attachment the
// user uploaded, including ones not yet linked to a memo.
func listAllUserAttachments(ctx context.Context, storeInstance *store.Store, userID int32) ([]*store.Attachment, error) {
	creatorID := userID
	attachments, err := storeInstance.ListAttachments(ctx, &store.FindAttachment{
		CreatorID:        &creatorID,
		SkipDefaultLimit: true,
	})
	if err != nil {
		return nil, errors.Wrap(err, "failed to list attachments")
	}
	return attachments, nil
}

// renderExportMarkdown renders a human-readable dump of the export payload.
func renderExportMarkdown(payload *exportPayload) string {
	var b strings.Builder
	fmt.Fprintf(&b, "# Memos export for %s\n\n", payload.User.Username)
	fmt.Fprintf(&b, "- User ID: %d\n", payload.User.ID)
	fmt.Fprintf(&b, "- Exported at: %s\n", payload.ExportedAt)
	fmt.Fprintf(&b, "- Memos: %d\n", len(payload.Memos))
	fmt.Fprintf(&b, "- Attachments: %d\n\n", len(payload.Attachments))

	if len(payload.Memos) == 0 {
		b.WriteString("_No memos._\n")
		return b.String()
	}

	for _, memo := range payload.Memos {
		fmt.Fprintf(&b, "## %s\n\n", memo.CreatedAt)
		fmt.Fprintf(&b, "- UID: `%s`\n", memo.UID)
		fmt.Fprintf(&b, "- Visibility: %s\n", memo.Visibility)
		fmt.Fprintf(&b, "- State: %s\n", memo.State)
		if memo.Pinned {
			b.WriteString("- Pinned: true\n")
		}
		if len(memo.Tags) > 0 {
			fmt.Fprintf(&b, "- Tags: %s\n", strings.Join(memo.Tags, ", "))
		}
		if memo.ParentUID != "" {
			fmt.Fprintf(&b, "- Parent: `%s`\n", memo.ParentUID)
		}
		if len(memo.AttachmentUIDs) > 0 {
			fmt.Fprintf(&b, "- Attachments: %s\n", strings.Join(memo.AttachmentUIDs, ", "))
		}
		b.WriteString("\n")
		b.WriteString(memo.Content)
		b.WriteString("\n\n---\n\n")
	}

	if len(payload.Attachments) > 0 {
		b.WriteString("## Attachment index\n\n")
		for _, attachment := range payload.Attachments {
			memoRef := attachment.MemoUID
			if memoRef == "" {
				memoRef = "(unlinked)"
			}
			fmt.Fprintf(&b, "- `%s` %s (%s, %d bytes) → memo `%s`\n",
				attachment.UID, attachment.Filename, attachment.Type, attachment.Size, memoRef)
		}
		b.WriteString("\n")
	}

	return b.String()
}

// formatExportTimestamp converts a unix seconds value to RFC3339 UTC.
func formatExportTimestamp(ts int64) string {
	if ts <= 0 {
		return ""
	}
	return time.Unix(ts, 0).UTC().Format(time.RFC3339)
}
