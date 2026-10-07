import type { IncomingMessage, ServerResponse } from "node:http";
import {
  exchangeSpotifyCode,
  fetchSavedTracks,
  fetchSavedTracksPage,
  fetchSpotifyProfile,
  newSpotifyState,
  spotifyAuthorizeUrl,
  spotifyConfigured,
  spotifyRedirectUri,
} from "./library.js";

const pendingStates = new Map<string, number>();
const STATE_TTL_MS = 10 * 60 * 1000;

function html(res: ServerResponse, status: number, body: string) {
  res.writeHead(status, { "content-type": "text/html; charset=utf-8" });
  res.end(body);
}

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

export function handleSpotifyRoute(req: IncomingMessage, res: ServerResponse, pathname: string, url: URL): boolean {
  if (!pathname.startsWith("/api/spotify/")) return false;

  void (async () => {
    try {
      if (pathname === "/api/spotify/status" && req.method === "GET") {
        return json(res, 200, {
          configured: spotifyConfigured(),
          redirect_uri: spotifyRedirectUri(),
          scope: "user-library-read",
        });
      }

      if (pathname === "/api/spotify/connect" && req.method === "GET") {
        const state = newSpotifyState();
        pendingStates.set(state, Date.now() + STATE_TTL_MS);
        for (const [key, expires] of pendingStates) {
          if (expires <= Date.now()) pendingStates.delete(key);
        }
        res.writeHead(302, { location: spotifyAuthorizeUrl(state) });
        return res.end();
      }

      if (pathname === "/api/spotify/callback" && req.method === "GET") {
        const state = url.searchParams.get("state") || "";
        const code = url.searchParams.get("code") || "";
        const error = url.searchParams.get("error");

        if (!state || !pendingStates.has(state) || (pendingStates.get(state) ?? 0) <= Date.now()) {
          return json(res, 400, { error: "Invalid or expired Spotify OAuth state" });
        }
        pendingStates.delete(state);

        if (error) return json(res, 400, { error: `Spotify authorization denied: ${error}` });
        if (!code) return json(res, 400, { error: "Missing Spotify authorization code" });

        const token = await exchangeSpotifyCode(code);
        if (!token.refresh_token) {
          return json(res, 502, { error: "Spotify did not return a refresh token" });
        }

        // This is intentionally a one-time setup handoff. The refresh token must be
        // placed in Railway/Apex environment variables; never commit it to Git.
        return html(res, 200, `<!doctype html><html><body style="font-family:system-ui;max-width:900px;margin:40px auto;padding:20px">
          <h1>Spotify connected</h1>
          <p>Put this value in <code>SPOTIFY_REFRESH_TOKEN</code> in your Railway environment, then remove it from this page/history.</p>
          <textarea style="width:100%;height:100px" readonly>${escapeHtml(token.refresh_token)}</textarea>
          <p>Scope: <code>${escapeHtml(token.scope)}</code></p>
          <p>Redirect URI: <code>${escapeHtml(spotifyRedirectUri())}</code></p>
        </body></html>`);
      }

      if (pathname === "/api/spotify/profile" && req.method === "GET") {
        return json(res, 200, await fetchSpotifyProfile());
      }

      if (pathname === "/api/spotify/tracks" && req.method === "GET") {
        const offset = Number(url.searchParams.get("offset") ?? "0");
        const limit = Number(url.searchParams.get("limit") ?? "50");
        if (!Number.isInteger(offset) || offset < 0) return json(res, 400, { error: "offset must be a non-negative integer" });
        if (!Number.isInteger(limit) || limit < 1 || limit > 50) return json(res, 400, { error: "limit must be 1-50" });
        return json(res, 200, await fetchSavedTracksPage(offset, limit));
      }

      if (pathname === "/api/spotify/tracks/all" && req.method === "GET") {
        const result = await fetchSavedTracks();
        return json(res, 200, result);
      }

      return json(res, 404, { error: "Unknown Spotify route" });
    } catch (error) {
      console.error("spotify route failed", error);
      return json(res, 502, { error: error instanceof Error ? error.message : "Spotify request failed" });
    }
  })();

  return true;
}
