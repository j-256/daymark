const CACHE = "daymark-shell-__CACHE_VERSION__";
const FILES = [];
const PREFIX = "daymark-shell-";
self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      try {
        for (const path of FILES) {
          const response = await fetch(
            new Request(path, { credentials: "same-origin", redirect: "error", cache: "reload" }),
          );
          if (!response.ok || response.redirected) throw new Error("Shell cache unavailable");
          const type = response.headers.get("content-type") || "";
          if (
            (path.endsWith(".js") && !type.includes("javascript")) ||
            (path.endsWith(".css") && !type.includes("text/css"))
          )
            throw new Error("Unexpected shell asset");
          await cache.put(path, response);
        }
        await self.skipWaiting();
      } catch (error) {
        await caches.delete(CACHE);
        throw error;
      }
    })(),
  );
});
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys())
        if (key.startsWith(PREFIX) && key !== CACHE) await caches.delete(key);
      await self.clients.claim();
    })(),
  );
});
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (
    event.request.method !== "GET" ||
    url.origin !== self.location.origin ||
    url.pathname === "/api" ||
    url.pathname.startsWith("/api/") ||
    url.pathname === "/admin" ||
    url.pathname.startsWith("/admin/") ||
    url.pathname.startsWith("/cdn-cgi/") ||
    url.searchParams.has("access-login")
  )
    return;
  if (event.request.mode === "navigate") {
    event.respondWith(
      caches.open(CACHE).then(async (cache) => (await cache.match("/")) || fetch(event.request)),
    );
  } else if (FILES.includes(url.pathname)) {
    event.respondWith(
      caches
        .open(CACHE)
        .then(async (cache) => (await cache.match(url.pathname)) || fetch(event.request)),
    );
  }
});
