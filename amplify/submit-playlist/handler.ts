import { randomUUID } from 'node:crypto';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import bcrypt from 'bcryptjs';
import type { Schema } from '../data/resource';

const MAX_TRACKS = 11;
const RATE_LIMIT_PER_HOUR = 10;
const SPOTIFY_RETRY_BUDGET_MS = 20_000;

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

// Any Error thrown here reaches the browser as the GraphQL error message, so keep them readable.
export const handler: Schema['submitPlaylist']['functionHandler'] = async (event) => {
  const env = requireEnv(
    'ENTRY_TABLE_NAME',
    'RATE_LIMIT_TABLE_NAME',
    'MASTER_PLAYLIST_ID',
    'SPOTIFY_CLIENT_ID',
    'SPOTIFY_CLIENT_SECRET',
    'SPOTIFY_REFRESH_TOKEN',
    'SHARED_PASSWORD_HASH',
  );

  await enforceRateLimit(env.RATE_LIMIT_TABLE_NAME, clientIp(event.request.headers));

  const { password, digestOptIn } = event.arguments;
  const name = event.arguments.name.trim();
  const email = event.arguments.email.trim().toLowerCase();
  const playlistId = parsePlaylistId(event.arguments.playlistUrl);

  if (!password || !(await bcrypt.compare(password, env.SHARED_PASSWORD_HASH))) {
    throw new Error('Wrong password.');
  }
  if (name.length < 1 || name.length > 60) throw new Error('Please enter your name (up to 60 characters).');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) throw new Error('Please enter a valid email address.');
  if (!playlistId) throw new Error('That does not look like a Spotify playlist link. Use Share > Copy link to playlist in Spotify.');

  const accessToken = await refreshSpotifyToken(env);
  const items = await fetchPlaylistItems(accessToken, playlistId);
  if (items.total === 0) throw new Error('That playlist is empty.');
  if (items.total > MAX_TRACKS) {
    throw new Error(`That playlist has ${items.total} songs. The limit is ${MAX_TRACKS}. Trim it down and try again.`);
  }
  const uris = items.items
    .filter((i) => !i.is_local && i.item && (i.item.type === 'track' || i.item.type === 'episode'))
    .map((i) => i.item!.uri);
  if (uris.length === 0) throw new Error('Those songs are local files, which Spotify cannot add to another playlist.');

  await addToMasterPlaylist(accessToken, env.MASTER_PLAYLIST_ID, uris);

  const now = new Date().toISOString();
  const entry = {
    id: randomUUID(),
    name,
    email,
    playlistUrl: `https://open.spotify.com/playlist/${playlistId}`,
    playlistId,
    trackCount: items.total,
    digestOptIn,
    addedAt: now,
    createdAt: now,
    updatedAt: now,
  };
  await ddb.send(new PutCommand({ TableName: env.ENTRY_TABLE_NAME, Item: { ...entry, __typename: 'Entry' } }));
  return entry;
};

function requireEnv<K extends string>(...keys: K[]): Record<K, string> {
  const out = {} as Record<K, string>;
  for (const key of keys) {
    const value = process.env[key];
    if (!value) throw new Error(`Server misconfiguration: ${key} is not set.`);
    out[key] = value;
  }
  return out;
}

function clientIp(headers: Record<string, string | undefined>): string {
  const forwarded = headers['x-forwarded-for'] ?? headers['X-Forwarded-For'];
  return forwarded?.split(',')[0]?.trim() || 'unknown';
}

// Counts every attempt (including wrong passwords) per IP per clock hour. Rows expire via TTL.
async function enforceRateLimit(tableName: string, ip: string): Promise<void> {
  const hour = Math.floor(Date.now() / 3_600_000);
  const result = await ddb.send(
    new UpdateCommand({
      TableName: tableName,
      Key: { pk: `${ip}#${hour}` },
      UpdateExpression: 'ADD #count :one SET #expiresAt = if_not_exists(#expiresAt, :expiresAt)',
      ExpressionAttributeNames: { '#count': 'count', '#expiresAt': 'expiresAt' },
      ExpressionAttributeValues: { ':one': 1, ':expiresAt': Math.floor(Date.now() / 1000) + 2 * 3600 },
      ReturnValues: 'UPDATED_NEW',
    }),
  );
  if ((result.Attributes?.count as number) > RATE_LIMIT_PER_HOUR) {
    throw new Error('Too many attempts from your network. Try again in an hour.');
  }
}

export function parsePlaylistId(input: string): string | null {
  const trimmed = input.trim();
  if (/^[A-Za-z0-9]{22}$/.test(trimmed)) return trimmed;
  const m = trimmed.match(/(?:open\.spotify\.com\/(?:[a-z-]+\/)?playlist\/|spotify:playlist:)([A-Za-z0-9]{22})/);
  return m ? m[1] : null;
}

async function refreshSpotifyToken(env: {
  SPOTIFY_CLIENT_ID: string;
  SPOTIFY_CLIENT_SECRET: string;
  SPOTIFY_REFRESH_TOKEN: string;
}): Promise<string> {
  const res = await spotifyFetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${env.SPOTIFY_CLIENT_ID}:${env.SPOTIFY_CLIENT_SECRET}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: env.SPOTIFY_REFRESH_TOKEN }),
  });
  if (!res.ok) {
    console.error('Spotify token refresh failed', res.status, await res.text());
    throw new Error('Server misconfiguration: could not sign in to Spotify.');
  }
  const body = (await res.json()) as { access_token: string };
  return body.access_token;
}

type PlaylistItems = {
  total: number;
  items: Array<{ is_local: boolean; item: { uri: string; type: string } | null }>;
};

async function fetchPlaylistItems(accessToken: string, playlistId: string): Promise<PlaylistItems> {
  const params = new URLSearchParams({ fields: 'total,items(is_local,item(uri,type))', limit: '50' });
  const res = await spotifyFetch(`https://api.spotify.com/v1/playlists/${playlistId}/items?${params}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (res.status === 403 || res.status === 404) {
    throw new Error(
      "Spotify won't let us read that playlist. Make sure it is public, or add the master playlist's owner as a collaborator, then try again.",
    );
  }
  if (!res.ok) {
    console.error('Spotify playlist fetch failed', res.status, await res.text());
    throw new Error('Spotify returned an error while reading that playlist. Try again in a minute.');
  }
  return (await res.json()) as PlaylistItems;
}

async function addToMasterPlaylist(accessToken: string, masterPlaylistId: string, uris: string[]): Promise<void> {
  const res = await spotifyFetch(`https://api.spotify.com/v1/playlists/${masterPlaylistId}/items`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ uris }),
  });
  if (!res.ok) {
    console.error('Spotify add to master playlist failed', res.status, await res.text());
    throw new Error('Spotify returned an error while adding your songs to the master playlist. Try again in a minute.');
  }
}

// fetch that honours Retry-After on 429 within a fixed time budget, then gives up with a clear message.
async function spotifyFetch(url: string, init: RequestInit): Promise<Response> {
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
