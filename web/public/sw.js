/**
 * Minimal offline shell for the Memos SPA.
 *
 * Strategy: hashed /assets/ are content-addressed and immutable, so they are
 * served cache-first. Navigations and other shell files stay network-first
 * with a cache fallback so a flaky network still opens the app. API/SSE/RPC
 * calls are never cached — auth and freshness must stay server-authoritative.
 */
const CACHE_NAME = "memos-shell-v2";
const SHELL_URLS = ["/", "/logo.webp", "/site.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(SHELL_URLS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

const isShellRequest = (request) => {
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return false;
  if (request.method !== "GET") return false;
  // Never touch auth-sensitive or streaming endpoints.
  if (url.pathname.startsWith("/api/")) return false;
  if (url.pathname.startsWith("/file/")) return false;
  if (url.pathname.startsWith("/o/")) return false;
  if (url.pathname.includes("sse")) return false;
  return true;
};

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (!isShellRequest(request)) return;

  const url = new URL(request.url);
  const isNavigation = request.mode === "navigate";

  // Hashed assets are immutable by contract: cache-first, no network round-trip.
  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ??
          fetch(request).then((response) => {
            if (response && response.ok) {
              const copy = response.clone();
              void caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
            }
            return response;
          }),
      ),
    );
    return;
  }

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response && response.ok && (isNavigation || request.destination === "script" || request.destination === "style" || request.destination === "image")) {
          const copy = response.clone();
          void caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(request);
        if (cached) return cached;
        if (isNavigation) {
          const shell = await caches.match("/");
          if (shell) return shell;
        }
        return Response.error();
      }),
  );
});
