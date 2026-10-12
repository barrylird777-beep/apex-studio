# Spotify Library Bridge

Apex can pull the authenticated user's saved Spotify tracks directly from Spotify's Web API instead of relying on the ChatGPT Spotify connector's collection-only view.

## Required environment

- `SPOTIFY_CLIENT_ID`
- `SPOTIFY_CLIENT_SECRET`
- `SPOTIFY_REDIRECT_URI` (recommended; otherwise `PUBLIC_BASE_URL/api/spotify/callback`)
- `SPOTIFY_REFRESH_TOKEN` after the first OAuth connection

The Spotify app must request:

`user-library-read`

## OAuth setup

1. Register an app in Spotify for Developers.
2. Add the exact redirect URI from `SPOTIFY_REDIRECT_URI`.
3. Deploy Apex.
4. Open `/api/spotify/connect`.
5. Approve access in Spotify.
6. Copy the one-time refresh token from the callback page into Railway as `SPOTIFY_REFRESH_TOKEN`.
7. Delete the token from browser history/page history after saving it to Railway.

## Library endpoints

- `GET /api/spotify/status`
- `GET /api/spotify/connect`
- `GET /api/spotify/callback`
- `GET /api/spotify/profile`
- `GET /api/spotify/tracks?offset=0&limit=50`
- `GET /api/spotify/tracks/all`

`/tracks/all` follows Spotify pagination until the reported library total is reached. A 3,333-track library requires 67 pages at 50 tracks per page.

## Important

Spotify now gives refresh tokens a six-month lifetime. The connection must be reauthorized when Spotify returns `invalid_grant`; the bridge deliberately surfaces that condition instead of retrying forever.
