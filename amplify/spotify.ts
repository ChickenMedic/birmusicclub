// Spotify helpers shared by the Lambdas. Credentials come from the function's environment
// (Amplify secrets resolved at runtime).
import { MASTER_PLAYLIST_ID, SPOTIFY_OWNER_NAME } from '../config';

const SPOTIFY_RETRY_BUDGET_MS = 20_000;
const MAX_ITEMS_PER_REQUEST = 100;

// Amplify resolves secret() values from SSM Parameter Store when the function starts. If a
// parameter is missing it leaves this placeholder in the env var instead of failing, so treat it
// as unset and say which secrets are missing rather than sending garbage to Spotify.
const SSM_PLACEHOLDER = '<value will be resolved during runtime>';

function readSecrets(names: string[]): string[] {
  const values = names.map((n) => process.env[n]?.trim());
  const missing = names.filter((_, i) => !values[i] || values[i] === SSM_PLACEHOLDER);
  if (missing.length > 0) {
    console.error('Spotify secrets missing from SSM', missing, 'config:', process.env.AMPLIFY_SSM_ENV_CONFIG);
    throw new Error(`Server misconfiguration: Spotify secrets not found in Amplify (${missing.join(', ')}). Add them under Hosting > Secrets for this app and branch, then redeploy.`);
  }
  return values as string[];
}

export async function refreshSpotifyToken(): Promise<string> {
  const [clientId, clientSecret, refreshToken] = readSecrets(['SPOTIFY_CLIENT_ID', 'SPOTIFY_CLIENT_SECRET', 'SPOTIFY_REFRESH_TOKEN']);

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

export type PlaylistItems = {
  total: number;
  items: Array<{ is_local: boolean; item: { uri: string; type: string } | null }>;
};

// Reads a playlist's items. Only works for playlists the app's account owns or collaborates on.
export async function fetchPlaylistItems(accessToken: string, playlistId: string): Promise<PlaylistItems> {
  const params = new URLSearchParams({ fields: 'total,items(is_local,item(uri,type))', limit: '50' });
  const res = await spotifyFetch(`https://api.spotify.com/v1/playlists/${playlistId}/items?${params}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (res.status === 403 || res.status === 404) {
    throw new Error(
      `Spotify won't let this site read that playlist yet. Open it in Spotify, tap the three dots, choose Invite collaborators, and send the invite link to ${SPOTIFY_OWNER_NAME}. Once accepted, try again.`,
    );
  }
  if (!res.ok) {
    console.error('Spotify playlist fetch failed', res.status, await res.text());
    throw new Error('Spotify returned an error while reading that playlist. Try again in a minute.');
  }
  return (await res.json()) as PlaylistItems;
}

// The URIs that can be added to another playlist (no local files).
export function addableUris(items: PlaylistItems): string[] {
  return items.items
    .filter((i) => !i.is_local && i.item && (i.item.type === 'track' || i.item.type === 'episode'))
    .map((i) => i.item!.uri);
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
