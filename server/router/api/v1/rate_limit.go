package v1

import (
	"context"
	"net"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"connectrpc.com/connect"
	pkgerrors "github.com/pkg/errors"
)

// Default auth-related procedures and their per-IP request budgets.
const (
	defaultRateLimitWindow     = time.Minute
	defaultAuthRateLimit       = 10
	defaultRateLimitMaxBuckets = 4096

	signInProcedure       = "/memos.api.v1.AuthService/SignIn"
	refreshTokenProcedure = "/memos.api.v1.AuthService/RefreshToken"
	createUserProcedure   = "/memos.api.v1.UserService/CreateUser"
)

// RateLimitConfig configures the in-process IP rate limiter for Connect handlers.
type RateLimitConfig struct {
	// Limits maps full Connect procedure paths to the maximum number of
	// requests allowed per client IP within Window. Procedures not listed are
	// not rate limited.
	Limits map[string]int
	// Window is the sliding window used to enforce Limits.
	Window time.Duration
	// MaxBuckets caps the number of tracked (IP, procedure) pairs so a flood
	// of unique source addresses cannot grow the map without bound.
	MaxBuckets int
}

// DefaultRateLimitConfig returns the default policy: SignIn, RefreshToken, and
// CreateUser are restricted to 10 requests per minute per client IP.
func DefaultRateLimitConfig() RateLimitConfig {
	return RateLimitConfig{
		Limits: map[string]int{
			signInProcedure:       defaultAuthRateLimit,
			refreshTokenProcedure: defaultAuthRateLimit,
			createUserProcedure:   defaultAuthRateLimit,
		},
		Window:     defaultRateLimitWindow,
		MaxBuckets: defaultRateLimitMaxBuckets,
	}
}

// rateLimitKey identifies a sliding-window bucket for one client IP and procedure.
type rateLimitKey struct {
	ip        string
	procedure string
}

// slidingWindowLimiter enforces a fixed request budget per key inside a sliding
// window. It is safe for concurrent use.
type slidingWindowLimiter struct {
	mu         sync.Mutex
	windows    map[rateLimitKey][]time.Time
	window     time.Duration
	maxBuckets int
	now        func() time.Time
}

func newSlidingWindowLimiter(window time.Duration, maxBuckets int) *slidingWindowLimiter {
	if window <= 0 {
		window = defaultRateLimitWindow
	}
	if maxBuckets <= 0 {
		maxBuckets = defaultRateLimitMaxBuckets
	}
	return &slidingWindowLimiter{
		windows:    make(map[rateLimitKey][]time.Time),
		window:     window,
		maxBuckets: maxBuckets,
		now:        time.Now,
	}
}

// allow records a hit for key when under the given limit. It returns whether
// the request is permitted and, when refused, how long the caller should wait.
func (l *slidingWindowLimiter) allow(key rateLimitKey, limit int) (bool, time.Duration) {
	if limit <= 0 {
		return true, 0
	}
	now := l.now()
	cutoff := now.Add(-l.window)

	l.mu.Lock()
	defer l.mu.Unlock()

	if len(l.windows) >= l.maxBuckets {
		l.pruneLocked(cutoff)
	}

	hits := l.windows[key]
	// Drop timestamps that have left the window.
	kept := hits[:0]
	for _, ts := range hits {
		if ts.After(cutoff) {
			kept = append(kept, ts)
		}
	}
	hits = kept

	if len(hits) >= limit {
		l.windows[key] = hits
		retryAfter := hits[0].Add(l.window).Sub(now)
		if retryAfter < time.Second {
			retryAfter = time.Second
		}
		return false, retryAfter
	}

	if _, exists := l.windows[key]; !exists && len(l.windows) >= l.maxBuckets {
		// Still at capacity after prune: fail closed rather than grow unbounded.
		return false, l.window
	}

	l.windows[key] = append(hits, now)
	return true, 0
}

func (l *slidingWindowLimiter) pruneLocked(cutoff time.Time) {
	for key, hits := range l.windows {
		kept := hits[:0]
		for _, ts := range hits {
			if ts.After(cutoff) {
				kept = append(kept, ts)
			}
		}
		if len(kept) == 0 {
			delete(l.windows, key)
			continue
		}
		l.windows[key] = kept
	}
}

// RateLimitInterceptor applies per-IP sliding-window limits to selected Connect
// procedures, primarily public authentication endpoints that are attractive
// brute-force targets.
type RateLimitInterceptor struct {
	config  RateLimitConfig
	limiter *slidingWindowLimiter
}

// NewRateLimitInterceptor creates a Connect interceptor that enforces the given
// per-IP request budgets. Pass DefaultRateLimitConfig for the stock policy.
func NewRateLimitInterceptor(config RateLimitConfig) *RateLimitInterceptor {
	if config.Window <= 0 {
		config.Window = defaultRateLimitWindow
	}
	if config.MaxBuckets <= 0 {
		config.MaxBuckets = defaultRateLimitMaxBuckets
	}
	if config.Limits == nil {
		config.Limits = DefaultRateLimitConfig().Limits
	}
	return &RateLimitInterceptor{
		config:  config,
		limiter: newSlidingWindowLimiter(config.Window, config.MaxBuckets),
	}
}

func (in *RateLimitInterceptor) WrapUnary(next connect.UnaryFunc) connect.UnaryFunc {
	return func(ctx context.Context, req connect.AnyRequest) (connect.AnyResponse, error) {
		procedure := req.Spec().Procedure
		limit, limited := in.config.Limits[procedure]
		if !limited || limit <= 0 {
			return next(ctx, req)
		}

		ip := clientIPFromRequest(req.Header(), req.Peer().Addr)
		if ok, retryAfter := in.limiter.allow(rateLimitKey{ip: ip, procedure: procedure}, limit); !ok {
			return nil, newRateLimitError(retryAfter)
		}
		return next(ctx, req)
	}
}

// AllowHTTP records a hit for the given procedure and request headers. It is
// shared with the gRPC-Gateway middleware so OpenAPI clients cannot bypass the
// Connect path budgets. Returns false (and a Retry-After duration) when the
// client is over budget.
func (in *RateLimitInterceptor) AllowHTTP(procedure string, header http.Header, peerAddr string) (bool, time.Duration) {
	limit, limited := in.config.Limits[procedure]
	if !limited || limit <= 0 {
		return true, 0
	}
	ip := clientIPFromRequest(header, peerAddr)
	return in.limiter.allow(rateLimitKey{ip: ip, procedure: procedure}, limit)
}

func (*RateLimitInterceptor) WrapStreamingClient(next connect.StreamingClientFunc) connect.StreamingClientFunc {
	return next
}

func (*RateLimitInterceptor) WrapStreamingHandler(next connect.StreamingHandlerFunc) connect.StreamingHandlerFunc {
	return next
}

// newRateLimitError builds a Connect ResourceExhausted error carrying Retry-After.
func newRateLimitError(retryAfter time.Duration) error {
	seconds := int(retryAfter.Seconds())
	if seconds < 1 {
		seconds = 1
	}
	connectErr := connect.NewError(
		connect.CodeResourceExhausted,
		pkgerrors.New("rate limit exceeded"),
	)
	connectErr.Meta().Set("Retry-After", strconv.Itoa(seconds))
	return connectErr
}

// clientIPFromRequest derives the client address used for rate-limit bucketing.
// It prefers reverse-proxy headers already trusted elsewhere in this package,
// then falls back to the transport peer address.
func clientIPFromRequest(header http.Header, peerAddr string) string {
	if header != nil {
		if xff := header.Get("X-Forwarded-For"); xff != "" {
			if ip := strings.TrimSpace(strings.Split(xff, ",")[0]); ip != "" {
				return ip
			}
		}
		if xri := header.Get("X-Real-Ip"); xri != "" {
			if ip := strings.TrimSpace(xri); ip != "" {
				return ip
			}
		}
	}
	return hostFromAddr(peerAddr)
}

// hostFromAddr strips the port from a host:port peer address, leaving IPv6
// literals intact.
func hostFromAddr(addr string) string {
	if addr == "" {
		return "unknown"
	}
	host, _, err := net.SplitHostPort(addr)
	if err != nil {
		return addr
	}
	if host == "" {
		return "unknown"
	}
	return host
}
