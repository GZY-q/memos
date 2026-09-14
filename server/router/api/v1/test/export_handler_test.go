package test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/labstack/echo/v5"
	"github.com/stretchr/testify/require"

	storepb "github.com/usememos/memos/proto/gen/store"
	"github.com/usememos/memos/server/auth"
	apiv1 "github.com/usememos/memos/server/router/api/v1"
	"github.com/usememos/memos/store"
)

type exportMemoJSON struct {
	UID            string   `json:"uid"`
	Content        string   `json:"content"`
	Visibility     string   `json:"visibility"`
	Tags           []string `json:"tags"`
	AttachmentUIDs []string `json:"attachmentUids"`
}

type exportAttachmentJSON struct {
	UID      string `json:"uid"`
	Filename string `json:"filename"`
	MemoUID  string `json:"memoUid"`
}

type exportPayloadJSON struct {
	Version    int    `json:"version"`
	ExportedAt string `json:"exportedAt"`
	User       struct {
		ID       int32  `json:"id"`
		Username string `json:"username"`
	} `json:"user"`
	Memos       []exportMemoJSON       `json:"memos"`
	Attachments []exportAttachmentJSON `json:"attachments"`
}

func TestExportMe_Authentication(t *testing.T) {
	ctx := context.Background()
	ts := NewTestService(t)
	defer ts.Cleanup()

	user, err := ts.CreateRegularUser(ctx, "export-user")
	require.NoError(t, err)

	_, err = ts.Store.CreateMemo(ctx, &store.Memo{
		UID:        "export-memo-auth",
		CreatorID:  user.ID,
		Content:    "only mine",
		Visibility: store.Private,
		Payload:    &storepb.MemoPayload{Tags: []string{"backup"}},
	})
	require.NoError(t, err)

	token, _, err := auth.GenerateAccessTokenV2(
		user.ID,
		user.Username,
		string(user.Role),
		string(user.RowStatus),
		[]byte(ts.Secret),
	)
	require.NoError(t, err)

	e := echo.New()
	apiv1.RegisterExportRoutes(e, ts.Store, ts.Secret)

	t.Run("no credentials returns 401", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/v1/export/me", nil)
		rec := httptest.NewRecorder()
		e.ServeHTTP(rec, req)
		require.Equal(t, http.StatusUnauthorized, rec.Code)
	})

	t.Run("invalid token returns 401", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/v1/export/me", nil)
		req.Header.Set("Authorization", "Bearer not-a-real-token")
		rec := httptest.NewRecorder()
		e.ServeHTTP(rec, req)
		require.Equal(t, http.StatusUnauthorized, rec.Code)
	})

	t.Run("valid token returns only own memos", func(t *testing.T) {
		other, err := ts.CreateRegularUser(ctx, "export-other")
		require.NoError(t, err)
		_, err = ts.Store.CreateMemo(ctx, &store.Memo{
			UID:        "export-other-memo",
			CreatorID:  other.ID,
			Content:    "other user private memo",
			Visibility: store.Private,
		})
		require.NoError(t, err)

		req := httptest.NewRequest(http.MethodGet, "/api/v1/export/me", nil)
		req.Header.Set("Authorization", "Bearer "+token)
		rec := httptest.NewRecorder()
		e.ServeHTTP(rec, req)
		require.Equal(t, http.StatusOK, rec.Code)
		require.Equal(t, "application/json; charset=utf-8", rec.Header().Get(echo.HeaderContentType))

		var payload exportPayloadJSON
		require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &payload))
		require.Equal(t, 1, payload.Version)
		require.Equal(t, user.ID, payload.User.ID)
		require.Equal(t, "export-user", payload.User.Username)
		require.Len(t, payload.Memos, 1)
		require.Equal(t, "export-memo-auth", payload.Memos[0].UID)
		require.Equal(t, "only mine", payload.Memos[0].Content)
		require.Equal(t, "PRIVATE", payload.Memos[0].Visibility)
		require.Equal(t, []string{"backup"}, payload.Memos[0].Tags)

		for _, memo := range payload.Memos {
			require.NotEqual(t, "export-other-memo", memo.UID)
		}
	})

	t.Run("markdown format includes content", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/v1/export/me?format=markdown", nil)
		req.Header.Set("Authorization", "Bearer "+token)
		rec := httptest.NewRecorder()
		e.ServeHTTP(rec, req)
		require.Equal(t, http.StatusOK, rec.Code)
		require.Equal(t, "text/markdown; charset=utf-8", rec.Header().Get(echo.HeaderContentType))
		require.Contains(t, rec.Body.String(), "only mine")
		require.Contains(t, rec.Body.String(), "export-memo-auth")
		require.NotContains(t, rec.Body.String(), "other user private memo")
	})

	t.Run("unsupported format returns 400", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/v1/export/me?format=zip", nil)
		req.Header.Set("Authorization", "Bearer "+token)
		rec := httptest.NewRecorder()
		e.ServeHTTP(rec, req)
		require.Equal(t, http.StatusBadRequest, rec.Code)
	})
}

func TestExportMe_AttachmentMetadata(t *testing.T) {
	ctx := context.Background()
	ts := NewTestService(t)
	defer ts.Cleanup()

	user, err := ts.CreateRegularUser(ctx, "export-attachments")
	require.NoError(t, err)

	memo, err := ts.Store.CreateMemo(ctx, &store.Memo{
		UID:        "export-with-attachment",
		CreatorID:  user.ID,
		Content:    "memo with attachment",
		Visibility: store.Private,
	})
	require.NoError(t, err)

	_, err = ts.Store.CreateAttachment(ctx, &store.Attachment{
		UID:       "export-att-1",
		Filename:  "note.txt",
		Type:      "text/plain",
		Size:      12,
		Blob:      []byte("hello export"),
		CreatorID: user.ID,
		MemoID:    &memo.ID,
	})
	require.NoError(t, err)

	token, _, err := auth.GenerateAccessTokenV2(
		user.ID,
		user.Username,
		string(user.Role),
		string(user.RowStatus),
		[]byte(ts.Secret),
	)
	require.NoError(t, err)

	e := echo.New()
	apiv1.RegisterExportRoutes(e, ts.Store, ts.Secret)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/export/me", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)
	require.Equal(t, http.StatusOK, rec.Code)

	var payload exportPayloadJSON
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &payload))
	require.Len(t, payload.Attachments, 1)
	require.Equal(t, "export-att-1", payload.Attachments[0].UID)
	require.Equal(t, "note.txt", payload.Attachments[0].Filename)
	require.Equal(t, "export-with-attachment", payload.Attachments[0].MemoUID)
	require.Len(t, payload.Memos, 1)
	require.Equal(t, []string{"export-att-1"}, payload.Memos[0].AttachmentUIDs)
}

func TestExportMe_UsesOnlyAuthenticatedIdentity(t *testing.T) {
	ctx := context.Background()
	ts := NewTestService(t)
	defer ts.Cleanup()

	owner, err := ts.CreateRegularUser(ctx, "export-owner")
	require.NoError(t, err)
	intruder, err := ts.CreateRegularUser(ctx, "export-intruder")
	require.NoError(t, err)

	_, err = ts.Store.CreateMemo(ctx, &store.Memo{
		UID:        "owner-secret-memo",
		CreatorID:  owner.ID,
		Content:    "owner secret",
		Visibility: store.Private,
	})
	require.NoError(t, err)

	intruderToken, _, err := auth.GenerateAccessTokenV2(
		intruder.ID,
		intruder.Username,
		string(intruder.Role),
		string(intruder.RowStatus),
		[]byte(ts.Secret),
	)
	require.NoError(t, err)

	e := echo.New()
	apiv1.RegisterExportRoutes(e, ts.Store, ts.Secret)

	// Even if a client tries to target another username via query, the handler
	// only uses the authenticated identity.
	req := httptest.NewRequest(http.MethodGet, "/api/v1/export/me?username=export-owner", nil)
	req.Header.Set("Authorization", "Bearer "+intruderToken)
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)
	require.Equal(t, http.StatusOK, rec.Code)

	var payload exportPayloadJSON
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &payload))
	require.Equal(t, "export-intruder", payload.User.Username)
	require.Empty(t, payload.Memos)
}
