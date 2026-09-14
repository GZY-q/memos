package v1

import (
	"context"
	"strconv"
	"strings"

	"connectrpc.com/connect"
	pkgerrors "github.com/pkg/errors"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	v1pb "github.com/usememos/memos/proto/gen/api/v1"
	"github.com/usememos/memos/server/audit"
	"github.com/usememos/memos/server/auth"
)

// Sensitive Connect procedures audited on every call. Keep this list small:
// phase one covers auth, user admin, and PAT lifecycle only.
const (
	signOutProcedure           = "/memos.api.v1.AuthService/SignOut"
	updateUserProcedure        = "/memos.api.v1.UserService/UpdateUser"
	deleteUserProcedure        = "/memos.api.v1.UserService/DeleteUser"
	createAccessTokenProcedure = "/memos.api.v1.UserService/CreatePersonalAccessToken"
	deleteAccessTokenProcedure = "/memos.api.v1.UserService/DeletePersonalAccessToken"
	exportAuditAction          = "user.export"
	exportAuditProcedure       = "GET /api/v1/export/me"
)

// sensitiveAuditActions maps Connect procedure path to a stable audit action id.
var sensitiveAuditActions = map[string]string{
	signInProcedure:            "auth.sign_in",
	signOutProcedure:           "auth.sign_out",
	createUserProcedure:        "user.create",
	updateUserProcedure:        "user.update",
	deleteUserProcedure:        "user.delete",
	createAccessTokenProcedure: "pat.create",
	deleteAccessTokenProcedure: "pat.delete",
}

// AuditInterceptor records sensitive administrative and authentication Connect
// calls as structured audit events. It must run after AuthInterceptor so the
// caller identity is already present in context for protected procedures.
type AuditInterceptor struct {
	logger audit.Logger
}

// NewAuditInterceptor creates an interceptor that writes audit events through
// logger. A nil logger falls back to the process-wide audit default.
func NewAuditInterceptor(logger audit.Logger) *AuditInterceptor {
	return &AuditInterceptor{logger: logger}
}

func (in *AuditInterceptor) WrapUnary(next connect.UnaryFunc) connect.UnaryFunc {
	return func(ctx context.Context, req connect.AnyRequest) (connect.AnyResponse, error) {
		procedure := req.Spec().Procedure
		action, sensitive := sensitiveAuditActions[procedure]
		if !sensitive {
			return next(ctx, req)
		}

		clientIP := clientIPFromRequest(req.Header(), req.Peer().Addr)
		resp, err := next(ctx, req)
		in.loggerFor().LogEvent(ctx, buildConnectAuditEvent(ctx, action, procedure, clientIP, req, resp, err))
		return resp, err
	}
}

func (in *AuditInterceptor) loggerFor() audit.Logger {
	if in != nil && in.logger != nil {
		return in.logger
	}
	return audit.Default()
}

func (*AuditInterceptor) WrapStreamingClient(next connect.StreamingClientFunc) connect.StreamingClientFunc {
	return next
}

func (*AuditInterceptor) WrapStreamingHandler(next connect.StreamingHandlerFunc) connect.StreamingHandlerFunc {
	return next
}

// buildConnectAuditEvent fills actor, outcome, and non-sensitive detail for a
// sensitive Connect call. Passwords and tokens are never copied into Detail.
func buildConnectAuditEvent(ctx context.Context, action, procedure, clientIP string, req connect.AnyRequest, resp connect.AnyResponse, err error) audit.Event {
	event := audit.Event{
		Action:    action,
		Procedure: procedure,
		ClientIP:  clientIP,
		Outcome:   classifyAuditOutcome(action, err),
		Detail:    map[string]string{},
	}

	// Authenticated caller identity when AuthInterceptor already ran.
	if claims := auth.GetUserClaims(ctx); claims != nil {
		event.ActorUserID = claims.UserID
		event.ActorUsername = claims.Username
	} else if userID := auth.GetUserID(ctx); userID != 0 {
		event.ActorUserID = userID
	}

	switch action {
	case "auth.sign_in":
		applySignInAuditDetail(req, resp, err, &event)
	case "user.create":
		applyCreateUserAuditDetail(req, &event)
	case "user.update":
		applyUpdateUserAuditDetail(req, &event)
	case "user.delete":
		applyDeleteUserAuditDetail(req, &event)
	case "pat.create":
		applyCreatePATAuditDetail(req, &event)
	case "pat.delete":
		applyDeletePATAuditDetail(req, &event)
	default:
		// Actions without extra detail still carry actor/outcome/procedure.
	}

	if len(event.Detail) == 0 {
		event.Detail = nil
	}
	return event
}

// classifyAuditOutcome maps a handler error to an audit outcome code.
// Failed credential checks (sign-in InvalidArgument/Unauthenticated) are
// denied rather than error so operators can alert on auth abuse separately.
func classifyAuditOutcome(action string, err error) audit.Outcome {
	if err == nil {
		return audit.OutcomeSuccess
	}
	code := auditCodeFromError(err)
	if action == "auth.sign_in" {
		switch code {
		case connect.CodeInternal, connect.CodeUnavailable, connect.CodeDataLoss, connect.CodeUnimplemented:
			return audit.OutcomeError
		default:
			return audit.OutcomeDenied
		}
	}
	switch code {
	case connect.CodeUnauthenticated, connect.CodePermissionDenied, connect.CodeResourceExhausted:
		return audit.OutcomeDenied
	default:
		return audit.OutcomeError
	}
}

// auditCodeFromError maps Connect and gRPC errors onto a Connect code.
func auditCodeFromError(err error) connect.Code {
	var connectErr *connect.Error
	if pkgerrors.As(err, &connectErr) {
		return connectErr.Code()
	}
	if st, ok := status.FromError(err); ok && st.Code() != codes.OK && st.Code() != codes.Unknown {
		return connect.Code(st.Code())
	}
	return connect.CodeUnknown
}

// applySignInAuditDetail records the attempted username on failure and the
// authenticated actor on success. Password material is never inspected.
func applySignInAuditDetail(req connect.AnyRequest, resp connect.AnyResponse, err error, event *audit.Event) {
	signInReq, ok := req.Any().(*v1pb.SignInRequest)
	if ok {
		if creds := signInReq.GetPasswordCredentials(); creds != nil {
			event.Detail["auth_method"] = "password"
			// Failed attempts: record who was tried. Never the password.
			if err != nil && event.ActorUsername == "" {
				event.ActorUsername = creds.GetUsername()
			}
		} else if signInReq.GetSsoCredentials() != nil {
			event.Detail["auth_method"] = "sso"
		}
	}
	if err != nil || resp == nil {
		return
	}
	signInResp, ok := resp.Any().(*v1pb.SignInResponse)
	if !ok || signInResp.GetUser() == nil {
		return
	}
	// Successful sign-in is not authenticated yet in context; take actor from response.
	event.ActorUsername = signInResp.GetUser().GetUsername()
	event.Detail["user_name"] = signInResp.GetUser().GetName()
}

// applyCreateUserAuditDetail records the username and requested role of the new
// account. The first bootstrap user may be anonymous; actor fields stay empty.
func applyCreateUserAuditDetail(req connect.AnyRequest, event *audit.Event) {
	createReq, ok := req.Any().(*v1pb.CreateUserRequest)
	if !ok || createReq.GetUser() == nil {
		return
	}
	user := createReq.GetUser()
	event.Detail["username"] = user.GetUsername()
	event.Detail["requested_role"] = user.GetRole().String()
	if createReq.GetValidateOnly() {
		event.Detail["validate_only"] = "true"
	}
}

// applyUpdateUserAuditDetail records which user fields changed, including role.
// Password changes are flagged without revealing the new password.
func applyUpdateUserAuditDetail(req connect.AnyRequest, event *audit.Event) {
	updateReq, ok := req.Any().(*v1pb.UpdateUserRequest)
	if !ok || updateReq.GetUser() == nil {
		return
	}
	user := updateReq.GetUser()
	event.Detail["target"] = user.GetName()
	if user.GetUsername() != "" {
		event.Detail["target_username"] = user.GetUsername()
	}
	paths := updateReq.GetUpdateMask().GetPaths()
	if len(paths) > 0 {
		event.Detail["update_mask"] = strings.Join(paths, ",")
	}
	for _, path := range paths {
		switch path {
		case "role":
			event.Detail["role"] = user.GetRole().String()
		case "password":
			// Flag only; never log the password.
			event.Detail["password_changed"] = "true"
		case "state":
			event.Detail["state"] = user.GetState().String()
		default:
			// Other mask paths are already listed in update_mask.
		}
	}
}

// applyDeleteUserAuditDetail records the deleted user resource name.
func applyDeleteUserAuditDetail(req connect.AnyRequest, event *audit.Event) {
	deleteReq, ok := req.Any().(*v1pb.DeleteUserRequest)
	if !ok {
		return
	}
	event.Detail["target"] = deleteReq.GetName()
}

// applyCreatePATAuditDetail records the PAT parent user. The generated token
// plaintext is never copied into the event.
func applyCreatePATAuditDetail(req connect.AnyRequest, event *audit.Event) {
	createReq, ok := req.Any().(*v1pb.CreatePersonalAccessTokenRequest)
	if !ok {
		return
	}
	event.Detail["parent"] = createReq.GetParent()
	if createReq.GetExpiresInDays() > 0 {
		event.Detail["expires_in_days"] = strconv.Itoa(int(createReq.GetExpiresInDays()))
	}
}

// applyDeletePATAuditDetail records the revoked PAT resource name only.
func applyDeletePATAuditDetail(req connect.AnyRequest, event *audit.Event) {
	deleteReq, ok := req.Any().(*v1pb.DeletePersonalAccessTokenRequest)
	if !ok {
		return
	}
	event.Detail["target"] = deleteReq.GetName()
}
