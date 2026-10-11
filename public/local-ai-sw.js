const CACHE_NAME = "apex-local-ai-offline-v1";
const PAGE = "/local-ai";
const ASSETS = [
  PAGE,
  "/vendor/wllama/runtime.js",
  "/vendor/wllama/src/wasm/wllama.wasm",
  "/vendor/wllama-compat/wasm/wllama.wasm",
  "/vendor/wllama-compat/wasm/wllama.js"
];

async function cacheJavaScriptTree(path, cache, seen) {
  const url = new URL(path, self.location.origin);
  if (url.origin !== self.location.origin || seen.has(url.href)) return;
  seen.add(url.href);
  const response = await fetch(url.href, { cache: "reload" });
  if (!response.ok) throw new Error("Offline cache asset returned HTTP " + response.status + ": " + url.pathname);
  await cache.put(url.href, response.clone());
  if (!url.pathname.endsWith(".js")) return;
  const source = await response.text();
  const imports = [...source.matchAll(/(?:\bfrom\s*|\bimport\s*\()\s*["']([^"']+)["']/g)]
    .map(match => match[1])
    .filter(specifier => specifier.startsWith("/") || specifier.startsWith("./") || specifier.startsWith("../"));
  await Promise.all(imports.map(specifier => cacheJavaScriptTree(new URL(specifier, url).href, cache, seen).catch(() => false)));
}

self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await Promise.all(ASSETS.map(async asset => {
      try {
        if (asset.endsWith(".js")) await cacheJavaScriptTree(asset, cache, new Set());
        else {
          const response = await fetch(asset, { cache: "reload" });
          if (response.ok) await cache.put(asset, response);
        }
      } catch {
        // Keep the worker installable even if one asset is temporarily unavailable.
      }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(name => name.startsWith("apex-local-ai-offline-") && name !== CACHE_NAME).map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  const isLocalAiPage = url.pathname === PAGE;
  const isRuntimeAsset = url.pathname.startsWith("/vendor/wllama/") || url.pathname.startsWith("/vendor/wllama-compat/");
  if (!isLocalAiPage && !isRuntimeAsset) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(request, { ignoreSearch: isLocalAiPage });
    if (cached) return cached;
    try {
      const response = await fetch(request);
      if (response.ok) await cache.put(request, response.clone());
      return response;
    } catch {
      if (isLocalAiPage) return new Response("Apex Studio Local AI is not cached for offline use yet. Open this page online once, then retry.", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } });
      return new Response("This AI runtime asset is not available offline yet.", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } });
    }
  })());
});
