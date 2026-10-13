const ORIGIN = "https://apex-studio-production.up.railway.app";

const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

function stripHopByHopHeaders(headers) {
  // RFC 9110: Connection can nominate additional hop-by-hop headers.
  // Remove those nominated fields before removing Connection itself.
  const nominated = (headers.get("connection") || "")
    .split(",")
    .map(value => value.trim().toLowerCase())
    .filter(Boolean);
  for (const name of HOP_BY_HOP) headers.delete(name);
  for (const name of nominated) headers.delete(name);
}

export default {
  async fetch(request) {
    if (request.method === "CONNECT") {
      return new Response("Method not allowed", { status: 405 });
    }

    const incoming = new URL(request.url);
    const upstream = new URL(incoming.pathname + incoming.search, ORIGIN);
    const headers = new Headers(request.headers);
    stripHopByHopHeaders(headers);

    // Never forward a caller-supplied Host header or trust caller-supplied
    // forwarding metadata. fetch() derives Host from the fixed HTTPS origin.
    headers.delete("host");
    headers.delete("x-forwarded-host");
    headers.delete("x-forwarded-proto");
    headers.delete("forwarded");

    const init = {
      method: request.method,
      headers,
      redirect: "manual",
    };
    if (request.method !== "GET" && request.method !== "HEAD") {
      init.body = request.body;
    }

    let upstreamResponse;
    try {
      upstreamResponse = await fetch(upstream, init);
    } catch {
      return new Response("APEX origin unavailable", {
        status: 502,
        headers: { "cache-control": "no-store" },
      });
    }

    const responseHeaders = new Headers(upstreamResponse.headers);
    stripHopByHopHeaders(responseHeaders);
    responseHeaders.set("cache-control", "no-store");
    responseHeaders.delete("server");

    // Keep redirects on the edge endpoint instead of sending clients around
    // the edge to the Railway hostname.
    const location = responseHeaders.get("location");
    if (location) {
      try {
        const redirectUrl = new URL(location, ORIGIN);
        if (redirectUrl.origin === ORIGIN) {
          const edgeRedirect = new URL(request.url);
          edgeRedirect.pathname = redirectUrl.pathname;
          edgeRedirect.search = redirectUrl.search;
          responseHeaders.set("location", edgeRedirect.toString());
        }
      } catch {
        // Preserve malformed/non-origin Location values; do not guess.
      }
    }

    return new Response(upstreamResponse.body, {
      status: upstreamResponse.status,
      statusText: upstreamResponse.statusText,
      headers: responseHeaders,
    });
  },
};
