package v1

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"sync"
	"testing"
	"time"

	"connectrpc.com/connect"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/protobuf/types/known/emptypb"
)

func TestSlidingWindowLimiterAllowsUnderLimit(t *testing.T) {
	limiter := newSlidingWindowLimiter(time.Minute, 64)
	fixed := time.Unix(1_700_000_000, 0)
	limiter.now = func() time.Time { return fixed }

	key := rateLimitKey{ip: "203.0.113.1", procedure: signInProcedure}
	for i := 0; i < 10; i++ {
		ok, retry := limiter.allow(key, 10)
		require.True(t, ok, "request %d should be allowed", i+1)
		assert.Zero(t, retry)
	}
}

func TestSlidingWindowLimiterBlocksOverLimit(t *testing.T) {
	limiter := newSlidingWindowLimiter(time.Minute, 64)
	fixed := time.Unix(1_700_000_000, 0)
	limiter.now = func() time.Time { return fixed }

	key := rateLimitKey{ip: "203.0.113.1", procedure: signInProcedure}
	for i := 0; i < 10; i++ {
		ok, _ := limiter.allow(key, 10)
		require.True(t, ok)
	}

	ok, retry := limiter.allow(key, 10)
	assert.False(t, ok)
	assert.GreaterOrEqual(t, retry, time.Second)
	assert.LessOrEqual(t, retry, time.Minute)
}

func TestSlidingWindowLimiterIsolatesIPs(t *testing.T) {
	limiter := newSlidingWindowLimiter(time.Minute, 64)
	fixed := time.Unix(1_700_000_000, 0)
	limiter.now = func() time.Time { return fixed }

	first := rateLimitKey{ip: "203.0.113.1", procedure: signInProcedure}
	second := rateLimitKey{ip: "198.51.100.7", procedure: signInProcedure}

	for i := 0; i < 10; i++ {
		ok, _ := limiter.allow(first, 10)
		require.True(t, ok)
	}

	ok, _ := limiter.allow(first, 10)
	assert.False(t, ok)

	ok, _ = limiter.allow(second, 10)
	assert.True(t, ok, "a different IP must not inherit the other bucket")
}

func TestSlidingWindowLimiterIsolatesProcedures(t *testing.T) {
	limiter := newSlidingWindowLimiter(time.Minute, 64)
	fixed := time.Unix(1_700_000_000, 0)
	limiter.now = func() time.Time { return fixed }

	ip := "203.0.113.1"
	signIn := rateLimitKey{ip: ip, procedure: signInProcedure}
	create := rateLimitKey{ip: ip, procedure: createUserProcedure}

	for i := 0; i < 10; i++ {
		ok, _ := limiter.allow(signIn, 10)
		require.True(t, ok)
	}

	ok, _ := limiter.allow(signIn, 10)
	assert.False(t, ok)

	ok, _ = limiter.allow(create, 10)
	assert.True(t, ok, "a different procedure must not share the SignIn bucket")
}

func TestSlidingWindowLimiterRefillsAfterWindow(t *testing.T) {
	limiter := newSlidingWindowLimiter(time.Minute, 64)
	fixed := time.Unix(1_700_000_000, 0)
	limiter.now = func() time.Time { return fixed }

	key := rateLimitKey{ip: "203.0.113.1", procedure: signInProcedure}
	for i := 0; i < 10; i++ {
		ok, _ := limiter.allow(key, 10)
		require.True(t, ok)
	}
	ok, _ := limiter.allow(key, 10)
	require.False(t, ok)

	limiter.now = func() time.Time { return fixed.Add(61 * time.Second) }
	ok, _ = limiter.allow(key, 10)
	assert.True(t, ok, "budget should refill after the window elapses")
}

func TestSlidingWindowLimiterPrunesExpiredBuckets(t *testing.T) {
	limiter := newSlidingWindowLimiter(time.Minute, 2)
	fixed := time.Unix(1_700_000_000, 0)
	limiter.now = func() time.Time { return fixed }

	ok, _ := limiter.allow(rateLimitKey{ip: "203.0.113.1", procedure: signInProcedure}, 1)
	require.True(t, ok)
	ok, _ = limiter.allow(rateLimitKey{ip: "198.51.100.1", procedure: signInProcedure}, 1)
	require.True(t, ok)

	// Third unique IP is refused while the map is full of live buckets.
	ok, _ = limiter.allow(rateLimitKey{ip: "192.0.2.9", procedure: signInProcedure}, 1)
	assert.False(t, ok)

	// After the window elapses, prune frees capacity for new IPs.
	limiter.now = func() time.Time { return fixed.Add(2 * time.Minute) }
	ok, _ = limiter.allow(rateLimitKey{ip: "192.0.2.9", procedure: signInProcedure}, 1)
	assert.True(t, ok)
}

func TestSlidingWindowLimiterConcurrentAccess(t *testing.T) {
	limiter := newSlidingWindowLimiter(time.Minute, 1024)
	key := rateLimitKey{ip: "203.0.113.1", procedure: signInProcedure}

	var allowed int
	var mu sync.Mutex
	var wg sync.WaitGroup
	for i := 0; i < 50; i++ {
		wg.Go(func() {
			if ok, _ := limiter.allow(key, 10); ok {
				mu.Lock()
				allowed++
				mu.Unlock()
			}
		})
	}
	wg.Wait()
	assert.Equal(t, 10, allowed, "exactly the configured budget should succeed under concurrency")
}

func TestClientIPFromRequest(t *testing.T) {
	tests := []struct {
		name     string
		header   http.Header
		peerAddr string
		want     string
	}{
		{
			name:   "prefers first X-Forwarded-For hop",
			header: http.Header{"X-Forwarded-For": []string{"203.0.113.1, 198.51.100.1"}},
			want:   "203.0.113.1",
		},
		{
			name:   "falls back to X-Real-Ip",
			header: http.Header{"X-Real-Ip": []string{"198.51.100.7"}},
			want:   "198.51.100.7",
		},
		{
			name:     "uses peer address when headers absent",
			peerAddr: "192.0.2.55:44321",
			want:     "192.0.2.55",
		},
		{
			name:     "strips IPv6 port",
			peerAddr: "[2001:db8::1]:8080",
			want:     "2001:db8::1",
		},
		{
			name: "unknown when nothing available",
			want: "unknown",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.want, clientIPFromRequest(tt.header, tt.peerAddr))
		})
	}
}

func TestNewRateLimitErrorSetsRetryAfter(t *testing.T) {
	err := newRateLimitError(30 * time.Second)
	var connectErr *connect.Error
	require.ErrorAs(t, err, &connectErr)
	assert.Equal(t, connect.CodeResourceExhausted, connectErr.Code())
	assert.Equal(t, "30", connectErr.Meta().Get("Retry-After"))
}

// connectUnaryResult is the subset of an HTTP response needed by rate-limit tests.
type connectUnaryResult struct {
	statusCode int
	header     http.Header
}

// postConnectUnary issues a minimal Connect unary JSON request against handler
// and closes the response body before returning.
func postConnectUnary(t *testing.T, serverURL, procedure, clientIP string) connectUnaryResult {
	t.Helper()
	body, err := json.Marshal(map[string]any{})
	require.NoError(t, err)

	req, err := http.NewRequestWithContext(
		context.Background(),
		http.MethodPost,
		serverURL+procedure,
		bytes.NewReader(body),
	)
	require.NoError(t, err)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Forwarded-For", clientIP)

	resp, err := http.DefaultClient.Do(req)
	require.NoError(t, err)
	defer func() { _ = resp.Body.Close() }()

	// Drain the body so keep-alive connections can be reused.
	_, _ = io.Copy(io.Discard, resp.Body)
	return connectUnaryResult{statusCode: resp.StatusCode, header: resp.Header}
}

func TestRateLimitInterceptorAllowsUnderLimit(t *testing.T) {
	interceptor := NewRateLimitInterceptor(RateLimitConfig{
		Limits: map[string]int{signInProcedure: 3},
		Window: time.Minute,
	})

	var calls int
	handler := connect.NewUnaryHandler(
		signInProcedure,
		func(_ context.Context, _ *connect.Request[emptypb.Empty]) (*connect.Response[emptypb.Empty], error) {
			calls++
			return connect.NewResponse(&emptypb.Empty{}), nil
		},
		connect.WithInterceptors(interceptor),
	)
	server := httptest.NewServer(handler)
	defer server.Close()

	for i := 0; i < 3; i++ {
		resp := postConnectUnary(t, server.URL, signInProcedure, "203.0.113.10")
		assert.Equal(t, http.StatusOK, resp.statusCode, "request %d", i+1)
	}
	assert.Equal(t, 3, calls)
}

func TestRateLimitInterceptorBlocksOverLimitWithRetryAfter(t *testing.T) {
	interceptor := NewRateLimitInterceptor(RateLimitConfig{
		Limits: map[string]int{signInProcedure: 2},
		Window: time.Minute,
	})

	var calls int
	handler := connect.NewUnaryHandler(
		signInProcedure,
		func(_ context.Context, _ *connect.Request[emptypb.Empty]) (*connect.Response[emptypb.Empty], error) {
			calls++
			return connect.NewResponse(&emptypb.Empty{}), nil
		},
		connect.WithInterceptors(interceptor),
	)
	server := httptest.NewServer(handler)
	defer server.Close()

	for i := 0; i < 2; i++ {
		resp := postConnectUnary(t, server.URL, signInProcedure, "203.0.113.10")
		require.Equal(t, http.StatusOK, resp.statusCode)
	}

	resp := postConnectUnary(t, server.URL, signInProcedure, "203.0.113.10")
	assert.Equal(t, http.StatusTooManyRequests, resp.statusCode)
	assert.NotEmpty(t, resp.header.Get("Retry-After"), "Retry-After should be present")
	seconds, err := strconv.Atoi(resp.header.Get("Retry-After"))
	require.NoError(t, err)
	assert.GreaterOrEqual(t, seconds, 1)
	assert.Equal(t, 2, calls, "handler must not run once the limit is exceeded")
}

func TestRateLimitInterceptorIsolatesClientIPs(t *testing.T) {
	interceptor := NewRateLimitInterceptor(RateLimitConfig{
		Limits: map[string]int{signInProcedure: 1},
		Window: time.Minute,
	})

	handler := connect.NewUnaryHandler(
		signInProcedure,
		func(_ context.Context, _ *connect.Request[emptypb.Empty]) (*connect.Response[emptypb.Empty], error) {
			return connect.NewResponse(&emptypb.Empty{}), nil
		},
		connect.WithInterceptors(interceptor),
	)
	server := httptest.NewServer(handler)
	defer server.Close()

	resp := postConnectUnary(t, server.URL, signInProcedure, "203.0.113.10")
	require.Equal(t, http.StatusOK, resp.statusCode)

	resp = postConnectUnary(t, server.URL, signInProcedure, "203.0.113.10")
	assert.Equal(t, http.StatusTooManyRequests, resp.statusCode)

	resp = postConnectUnary(t, server.URL, signInProcedure, "198.51.100.20")
	assert.Equal(t, http.StatusOK, resp.statusCode, "a different IP must still be allowed")
}

func TestRateLimitInterceptorSkipsUnlistedProcedures(t *testing.T) {
	interceptor := NewRateLimitInterceptor(RateLimitConfig{
		Limits: map[string]int{signInProcedure: 1},
		Window: time.Minute,
	})

	var calls int
	handler := connect.NewUnaryHandler(
		"/memos.api.v1.InstanceService/GetInstanceProfile",
		func(_ context.Context, _ *connect.Request[emptypb.Empty]) (*connect.Response[emptypb.Empty], error) {
			calls++
			return connect.NewResponse(&emptypb.Empty{}), nil
		},
		connect.WithInterceptors(interceptor),
	)
	server := httptest.NewServer(handler)
	defer server.Close()

	for i := 0; i < 5; i++ {
		resp := postConnectUnary(t, server.URL, "/memos.api.v1.InstanceService/GetInstanceProfile", "203.0.113.10")
		assert.Equal(t, http.StatusOK, resp.statusCode)
	}
	assert.Equal(t, 5, calls)
}

func TestDefaultRateLimitConfigCoversAuthEndpoints(t *testing.T) {
	config := DefaultRateLimitConfig()
	assert.Equal(t, time.Minute, config.Window)
	assert.Equal(t, 10, config.Limits[signInProcedure])
	assert.Equal(t, 10, config.Limits[refreshTokenProcedure])
	assert.Equal(t, 10, config.Limits[createUserProcedure])
}
