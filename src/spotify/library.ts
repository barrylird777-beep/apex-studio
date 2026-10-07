import crypto from "node:crypto";

const API = "https://api.spotify.com/v1";
const TOKEN_URL = "https://accounts.spotify.com/api/token";
const AUTH_URL = "https://accounts.spotify.com/authorize";
const PAGE_SIZE = 50;
const SCOPE = "user-library-read";

type SpotifyTrack = {
  added_at: string;
  track: {
    id: string;
    name: string;
    uri: string;
    duration_ms: number;
    explicit: boolean;
    external_urls?: { spotify?: string };
    artists?: Array<{ id: string; name: string; uri: string }>;
    album?: {
      id: string;
      name: string;
      release_date?: string;
      uri: string;
      external_urls?: { spotify?: string };
    };
  } | null;
};

type SavedTracksPage = {
  href: string;
  items: SpotifyTrack[];
  limit: number;
  next: string | null;
  offset: number;
  previous: string | null;
  total: number;
};

let accessToken: string | null = null;
let accessExpiresAt = 0;

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function basicAuth(): string {
  return Buffer.from(`${required("SPOTIFY_CLIENT_ID")}:${required("SPOTIFY_CLIENT_SECRET")}`).toString("base64");
}

export function spotifyConfigured(): boolean {
  return Boolean(
    process.env.SPOTIFY_CLIENT_ID &&
    process.env.SPOTIFY_CLIENT_SECRET &&
    process.env.SPOTIFY_REFRESH_TOKEN
  );
}

export function spotifyRedirectUri(): string {
  return process.env.SPOTIFY_REDIRECT_URI ||
    `${process.env.PUBLIC_BASE_URL || "http://localhost:3001"}/api/spotify/callback`;
}

export function spotifyAuthorizeUrl(state: string): string {
  const url = new URL(AUTH_URL);
  url.searchParams.set("client_id", required("SPOTIFY_CLIENT_ID"));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", spotifyRedirectUri());
  url.searchParams.set("scope", SCOPE);
  url.searchParams.set("state", state);
  return url.toString();
}

export function newSpotifyState(): string {
  return crypto.randomBytes(32).toString("hex");
}

async function refreshAccessToken(): Promise<string> {
  const refreshToken = required("SPOTIFY_REFRESH_TOKEN");
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basicAuth()}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });

  const data = await response.json() as {
    access_token?: string;
    expires_in?: number;
    refresh_token?: string;
    error?: string;
    error_description?: string;
  };

  if (!response.ok || !data.access_token) {
    if (data.error === "invalid_grant") {
      throw new Error("Spotify authorization expired. Re-authorize the Spotify connection.");
    }
    throw new Error(data.error_description || data.error || "Spotify token refresh failed");
  }

  accessToken = data.access_token;
  accessExpiresAt = Date.now() + Math.max(30, (data.expires_in ?? 3600) - 60) * 1000;

  // Spotify may rotate the refresh token. Surface it so the caller can persist it.
  if (data.refresh_token && data.refresh_token !== refreshToken) {
    process.env.SPOTIFY_REFRESH_TOKEN = data.refresh_token;
  }

  return accessToken;
}

async function getAccessToken(): Promise<string> {
  if (accessToken && Date.now() < accessExpiresAt) return accessToken;
  return refreshAccessToken();
}

async function spotifyGet<T>(path: string): Promise<T> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const token = await getAccessToken();
    const response = await fetch(`${API}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (response.status === 401) {
      accessToken = null;
      accessExpiresAt = 0;
      continue;
    }

    if (response.status === 429) {
      const retryAfter = Number(response.headers.get("retry-after") || "2");
      await new Promise(resolve => setTimeout(resolve, Math.min(30000, Math.max(1000, retryAfter * 1000))));
      continue;
    }

    const data = await response.json() as T & { error?: { message?: string } };
    if (!response.ok) {
      throw new Error(data?.error?.message || `Spotify API error ${response.status}`);
    }
    return data;
  }

  throw new Error("Spotify API retry budget exhausted");
}

export async function fetchSavedTracks(): Promise<{
  total: number;
  fetched: number;
  tracks: SpotifyTrack[];
}> {
  const first = await spotifyGet<SavedTracksPage>(`/me/tracks?limit=${PAGE_SIZE}&offset=0`);
  const tracks: SpotifyTrack[] = [...first.items];

  for (let offset = first.items.length; offset < first.total; offset += PAGE_SIZE) {
    const page = await spotifyGet<SavedTracksPage>(
      `/me/tracks?limit=${PAGE_SIZE}&offset=${offset}`
    );
    tracks.push(...page.items);
    if (!page.items.length) break;
  }

  return { total: first.total, fetched: tracks.length, tracks };
}

export async function fetchSavedTracksPage(offset = 0, limit = PAGE_SIZE) {
  const safeLimit = Math.min(PAGE_SIZE, Math.max(1, Math.floor(limit)));
  const safeOffset = Math.max(0, Math.floor(offset));
  return spotifyGet<SavedTracksPage>(`/me/tracks?limit=${safeLimit}&offset=${safeOffset}`);
}

export async function fetchSpotifyProfile() {
  return spotifyGet<{
    id?: string;
    account_id?: string;
    display_name?: string;
    product?: string;
  }>("/me");
}

export async function exchangeSpotifyCode(code: string): Promise<{
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope: string;
}> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: spotifyRedirectUri(),
  });

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basicAuth()}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });

  const data = await response.json() as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
    error?: string;
    error_description?: string;
  };

  if (!response.ok || !data.access_token) {
    throw new Error(data.error_description || data.error || "Spotify authorization failed");
  }

  accessToken = data.access_token;
  accessExpiresAt = Date.now() + Math.max(30, (data.expires_in ?? 3600) - 60) * 1000;

  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_in: data.expires_in ?? 3600,
    scope: data.scope ?? SCOPE,
  };
}
