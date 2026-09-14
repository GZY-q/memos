package v1

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"connectrpc.com/connect"
	pkgerrors "github.com/pkg/errors"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/protobuf/types/known/emptypb"
	"google.golang.org/protobuf/types/known/fieldmaskpb"

	v1pb "github.com/usememos/memos/proto/gen/api/v1"
	"github.com/usememos/memos/server/audit"
	"github.com/usememos/memos/server/auth"
)

// captureAuditLogger records audit events for interceptor assertions.
type captureAuditLogger struct {
	events []audit.Event
}

func (l *captureAuditLogger) LogEvent(_ context.Context, event audit.Event) {
	l.events = append(l.events, event)
}

func (l *captureAuditLogger) last(t *testing.T) audit.Event {
	t.Helper()
	require.NotEmpty(t, l.events, "expected at least one audit event")
	return l.events[len(l.events)-1]
}

// claimsInjectorInterceptor injects auth claims so AuditInterceptor sees an actor.
type claimsInjectorInterceptor struct {
	claims *auth.UserClaims
}

func (c *claimsInjectorInterceptor) WrapUnary(next connect.UnaryFunc) connect.UnaryFunc {
	return func(ctx context.Context, req connect.AnyRequest) (connect.AnyResponse, error) {
		return next(auth.SetUserClaimsInContext(ctx, c.claims), req)
	}
}

func (*claimsInjectorInterceptor) WrapStreamingClient(next connect.StreamingClientFunc) connect.StreamingClientFunc {
	return next
}

func (*claimsInjectorInterceptor) WrapStreamingHandler(next connect.StreamingHandlerFunc) connect.StreamingHandlerFunc {
	return next
}

// postConnectJSON issues a Connect unary JSON request against a test server.
func postConnectJSON(t *testing.T, serverURL, procedure, clientIP string, body string) int {
	t.Helper()
	req, err := http.NewRequestWithContext(
		context.Background(),
		http.MethodPost,
		serverURL+procedure,
		strings.NewReader(body),
	)
	require.NoError(t, err)
	req.Header.Set("Content-Type", "application/json")
	if clientIP != "" {
		req.Header.Set("X-Forwarded-For", clientIP)
	}

	resp, err := http.DefaultClient.Do(req)
	require.NoError(t, err)
	defer func() { _ = resp.Body.Close() }()
	return resp.StatusCode
}

func TestAuditInterceptorRecordsSignInSuccessWithoutPassword(t *testing.T) {
	capture := &captureAuditLogger{}
	interceptor := NewAuditInterceptor(capture)

	handler := connect.NewUnaryHandler(
		signInProcedure,
		func(_ context.Context, _ *connect.Request[v1pb.SignInRequest]) (*connect.Response[v1pb.SignInResponse], error) {
			return connect.NewResponse(&v1pb.SignInResponse{
				User: &v1pb.User{Username: "alice", Name: BuildUserName("alice")},
			}), nil
		},
		connect.WithInterceptors(interceptor),
	)
	server := httptest.NewServer(handler)
	defer server.Close()

	body := `{"passwordCredentials":{"username":"alice","password":"super-secret-password"}}`
	statusCode := postConnectJSON(t, server.URL, signInProcedure, "203.0.113.50", body)
	require.Equal(t, http.StatusOK, statusCode)
	require.Len(t, capture.events, 1)

	event := capture.last(t)
	assert.Equal(t, "auth.sign_in", event.Action)
	assert.Equal(t, signInProcedure, event.Procedure)
	assert.Equal(t, "203.0.113.50", event.ClientIP)
	assert.Equal(t, audit.OutcomeSuccess, event.Outcome)
	assert.Equal(t, "alice", event.ActorUsername)
	assert.Equal(t, "password", event.Detail["auth_method"])

	encoded, err := json.Marshal(event)
	require.NoError(t, err)
	assert.NotContains(t, string(encoded), "super-secret-password")
}

func TestAuditInterceptorRecordsFailedSignInUsernameOnly(t *testing.T) {
	capture := &captureAuditLogger{}
	interceptor := NewAuditInterceptor(capture)

	handler := connect.NewUnaryHandler(
		signInProcedure,
		func(_ context.Context, _ *connect.Request[v1pb.SignInRequest]) (*connect.Response[v1pb.SignInResponse], error) {
			return nil, connect.NewError(
				connect.CodeInvalidArgument,
				pkgerrors.New(unmatchedUsernameAndPasswordError),
			)
		},
		connect.WithInterceptors(interceptor),
	)
	server := httptest.NewServer(handler)
	defer server.Close()

	body := `{"passwordCredentials":{"username":"bob","password":"hunter2-plaintext"}}`
	statusCode := postConnectJSON(t, server.URL, signInProcedure, "198.51.100.9", body)
	require.Equal(t, http.StatusBadRequest, statusCode)
	require.Len(t, capture.events, 1)

	event := capture.last(t)
	assert.Equal(t, audit.OutcomeDenied, event.Outcome)
	assert.Equal(t, "bob", event.ActorUsername, "failed attempts must record the attempted username")
	assert.Equal(t, "198.51.100.9", event.ClientIP)

	encoded, err := json.Marshal(event)
	require.NoError(t, err)
	assert.NotContains(t, string(encoded), "hunter2-plaintext")
}

func TestAuditInterceptorRecordsUpdateUserRoleChange(t *testing.T) {
	capture := &captureAuditLogger{}
	interceptor := NewAuditInterceptor(capture)

	handler := connect.NewUnaryHandler(
		updateUserProcedure,
		func(ctx context.Context, _ *connect.Request[v1pb.UpdateUserRequest]) (*connect.Response[v1pb.User], error) {
			claims := auth.GetUserClaims(ctx)
			require.NotNil(t, claims, "auth claims must be in context")
			return connect.NewResponse(&v1pb.User{Username: "bob"}), nil
		},
		connect.WithInterceptors(
			&claimsInjectorInterceptor{claims: &auth.UserClaims{UserID: 1, Username: "admin", Role: "ADMIN"}},
			interceptor,
		),
	)
	server := httptest.NewServer(handler)
	defer server.Close()

	updateMask, err := json.Marshal(map[string]any{
		"user":       map[string]any{"name": BuildUserName("bob"), "role": "ADMIN"},
		"updateMask": "role",
	})
	require.NoError(t, err)

	statusCode := postConnectJSON(t, server.URL, updateUserProcedure, "203.0.113.8", string(updateMask))
	require.Equal(t, http.StatusOK, statusCode)
	require.Len(t, capture.events, 1)

	event := capture.last(t)
	assert.Equal(t, "user.update", event.Action)
	assert.Equal(t, audit.OutcomeSuccess, event.Outcome)
	assert.Equal(t, int32(1), event.ActorUserID)
	assert.Equal(t, "admin", event.ActorUsername)
	assert.Equal(t, "role", event.Detail["update_mask"])
	assert.Equal(t, "ADMIN", event.Detail["role"])
}

func TestAuditInterceptorSkipsNonSensitiveProcedures(t *testing.T) {
	capture := &captureAuditLogger{}
	interceptor := NewAuditInterceptor(capture)

	handler := connect.NewUnaryHandler(
		"/memos.api.v1.InstanceService/GetInstanceProfile",
		func(_ context.Context, _ *connect.Request[emptypb.Empty]) (*connect.Response[emptypb.Empty], error) {
			return connect.NewResponse(&emptypb.Empty{}), nil
		},
		connect.WithInterceptors(interceptor),
	)
	server := httptest.NewServer(handler)
	defer server.Close()

	statusCode := postConnectJSON(t, server.URL, "/memos.api.v1.InstanceService/GetInstanceProfile", "203.0.113.1", `{}`)
	require.Equal(t, http.StatusOK, statusCode)
	assert.Empty(t, capture.events)
}

func TestAuditInterceptorRecordsCreateAndDeleteUser(t *testing.T) {
	capture := &captureAuditLogger{}
	interceptor := NewAuditInterceptor(capture)

	createHandler := connect.NewUnaryHandler(
		createUserProcedure,
		func(_ context.Context, _ *connect.Request[v1pb.CreateUserRequest]) (*connect.Response[v1pb.User], error) {
			return connect.NewResponse(&v1pb.User{Username: "carol"}), nil
		},
		connect.WithInterceptors(interceptor),
	)
	createServer := httptest.NewServer(createHandler)
	defer createServer.Close()

	createBody, err := json.Marshal(map[string]any{
		"user": map[string]any{"username": "carol", "password": "not-logged-password", "role": "USER"},
	})
	require.NoError(t, err)
	require.Equal(t, http.StatusOK, postConnectJSON(t, createServer.URL, createUserProcedure, "203.0.113.2", string(createBody)))

	createEvent := capture.last(t)
	assert.Equal(t, "user.create", createEvent.Action)
	assert.Equal(t, "carol", createEvent.Detail["username"])
	encoded, err := json.Marshal(createEvent)
	require.NoError(t, err)
	assert.NotContains(t, string(encoded), "not-logged-password")

	deleteHandler := connect.NewUnaryHandler(
		deleteUserProcedure,
		func(ctx context.Context, _ *connect.Request[v1pb.DeleteUserRequest]) (*connect.Response[emptypb.Empty], error) {
			require.NotNil(t, auth.GetUserClaims(ctx))
			return connect.NewResponse(&emptypb.Empty{}), nil
		},
		connect.WithInterceptors(
			&claimsInjectorInterceptor{claims: &auth.UserClaims{UserID: 2, Username: "admin"}},
			interceptor,
		),
	)
	deleteServer := httptest.NewServer(deleteHandler)
	defer deleteServer.Close()

	deleteBody, err := json.Marshal(map[string]any{"name": BuildUserName("carol")})
	require.NoError(t, err)
	require.Equal(t, http.StatusOK, postConnectJSON(t, deleteServer.URL, deleteUserProcedure, "203.0.113.3", string(deleteBody)))

	deleteEvent := capture.last(t)
	assert.Equal(t, "user.delete", deleteEvent.Action)
	assert.Equal(t, "admin", deleteEvent.ActorUsername)
	assert.Equal(t, BuildUserName("carol"), deleteEvent.Detail["target"])
}

func TestClassifyAuditOutcome(t *testing.T) {
	internal := connect.NewError(connect.CodeInternal, pkgerrors.New("boom"))
	invalid := connect.NewError(connect.CodeInvalidArgument, pkgerrors.New(unmatchedUsernameAndPasswordError))
	denied := connect.NewError(connect.CodePermissionDenied, pkgerrors.New("no"))

	assert.Equal(t, audit.OutcomeSuccess, classifyAuditOutcome("auth.sign_in", nil))
	assert.Equal(t, audit.OutcomeDenied, classifyAuditOutcome("auth.sign_in", invalid))
	assert.Equal(t, audit.OutcomeError, classifyAuditOutcome("auth.sign_in", internal))
	assert.Equal(t, audit.OutcomeDenied, classifyAuditOutcome("user.delete", denied))
	assert.Equal(t, audit.OutcomeError, classifyAuditOutcome("user.delete", invalid))
	assert.Equal(t, audit.OutcomeError, classifyAuditOutcome("user.create", pkgerrors.New("unexpected")))
}

func TestApplyUpdateUserAuditDetailFlagsPasswordChange(t *testing.T) {
	req := connect.NewRequest(&v1pb.UpdateUserRequest{
		User: &v1pb.User{
			Name:     BuildUserName("alice"),
			Username: "alice",
			Password: "new-secret-value",
		},
		UpdateMask: &fieldmaskpb.FieldMask{Paths: []string{"password"}},
	})
	event := audit.Event{Detail: map[string]string{}}
	applyUpdateUserAuditDetail(req, &event)

	assert.Equal(t, "true", event.Detail["password_changed"])
	assert.Equal(t, "password", event.Detail["update_mask"])
	encoded, err := json.Marshal(event.Detail)
	require.NoError(t, err)
	assert.NotContains(t, string(encoded), "new-secret-value")
}

func TestApplyCreatePATAuditDetailOmitsToken(t *testing.T) {
	req := connect.NewRequest(&v1pb.CreatePersonalAccessTokenRequest{
		Parent:        BuildUserName("alice"),
		ExpiresInDays: 30,
	})
	event := audit.Event{Detail: map[string]string{}}
	applyCreatePATAuditDetail(req, &event)

	assert.Equal(t, BuildUserName("alice"), event.Detail["parent"])
	assert.Equal(t, "30", event.Detail["expires_in_days"])
	assert.NotContains(t, fmt.Sprint(event.Detail), "memos_pat_")
}
