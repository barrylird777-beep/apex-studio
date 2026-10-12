(() => {
  const nativeFetch = window.fetch.bind(window);
  window.fetch = (input, init = {}) => {
    const rawUrl = typeof input === "string" ? input : input && input.url;
    let url;
    try {
      url = new URL(rawUrl, window.location.href);
    } catch {
      return nativeFetch(input, init);
    }
    if (url.origin !== window.location.origin || !url.pathname.startsWith("/api/")) return nativeFetch(input, init);

    const path = url.pathname;
    if (
      path.startsWith("/api/internal/") ||
      path === "/api/rapid/stripe/webhook" ||
      path === "/api/kash-korner/opportunities" ||
      path === "/api/kernelodies/library" ||
      path.startsWith("/api/kernelodies/library/")
    ) return nativeFetch(input, init);

    const headers = new Headers(input instanceof Request ? input.headers : undefined);
    new Headers(init.headers || {}).forEach((value, key) => headers.set(key, value));
    const hasOtherAuth = headers.has("authorization") ||
      headers.has("x-apex-opportunity-token") ||
      headers.has("x-apex-worker-token") ||
      headers.has("x-kernelodies-token");
    const token = sessionStorage.getItem("apex.phone.sessionToken") || "";
    if (token && !hasOtherAuth && !headers.has("x-apex-shortcut-token")) {
      headers.set("x-apex-shortcut-token", token);
    }
    return nativeFetch(input, { ...init, headers });
  };
})();