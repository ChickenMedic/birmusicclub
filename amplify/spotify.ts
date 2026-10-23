// Spotify helpers shared by the Lambdas. Credentials come from the function's environment
// (Amplify secrets resolved at runtime).
import { MASTER_PLAYLIST_ID } from '../config';

const SPOTIFY_RETRY_BUDGET_MS = 20_000;
const MAX_ITEMS_PER_REQUEST = 100;

export async function refreshSpotifyToken(): Promise<string> {
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
  const refreshToken = process.env.SPOTIFY_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) throw new Error('Server misconfiguration: Spotify secrets are not set.');

  const res = await spotifyFetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }),
  });
  if (!res.ok) {
    console.error('Spotify token refresh failed', res.status, await res.text());
    throw new Error('Server misconfiguration: could not sign in to Spotify.');
  }
  const body = (await res.json()) as { access_token: string };
  return body.access_token;
}

export async function addToMasterPlaylist(accessToken: string, uris: string[]): Promise<void> {
  for (const chunk of chunks(uris)) {
    const res = await spotifyFetch(`https://api.spotify.com/v1/playlists/${MASTER_PLAYLIST_ID}/items`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ uris: chunk }),
    });
    if (!res.ok) {
      console.error('Spotify add to master playlist failed', res.status, await res.text());
      throw new Error('Spotify returned an error while adding songs to the master playlist. Try again in a minute.');
    }
  }
}

export async function removeFromMasterPlaylist(accessToken: string, uris: string[]): Promise<void> {
  for (const chunk of chunks(uris)) {
    const res = await spotifyFetch(`https://api.spotify.com/v1/playlists/${MASTER_PLAYLIST_ID}/items`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: chunk.map((uri) => ({ uri })) }),
    });
    if (!res.ok) {
      console.error('Spotify remove from master playlist failed', res.status, await res.text());
      throw new Error('Spotify returned an error while removing songs from the master playlist. Try again in a minute.');
    }
  }
}

// fetch that honours Retry-After on 429 within a fixed time budget, then gives up with a clear message.
export async function spotifyFetch(url: string, init: RequestInit): Promise<Response> {
  const deadline = Date.now() + SPOTIFY_RETRY_BUDGET_MS;
  for (;;) {
    const res = await fetch(url, init);
    if (res.status !== 429) return res;
    const retryAfterSec = Number(res.headers.get('retry-after') ?? '1') || 1;
    const waitMs = retryAfterSec * 1000;
    if (Date.now() + waitMs > deadline) {
      throw new Error(`Spotify is rate limiting us. Try again in about ${retryAfterSec} seconds.`);
    }
    await new Promise((r) => setTimeout(r, waitMs));
  }
}

function chunks(items: string[]): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < items.length; i += MAX_ITEMS_PER_REQUEST) out.push(items.slice(i, i + MAX_ITEMS_PER_REQUEST));
  return out;
}
