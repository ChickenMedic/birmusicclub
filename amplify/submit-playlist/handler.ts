import { randomBytes, randomUUID } from 'node:crypto';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import type { Schema } from '../data/resource';
import { addToMasterPlaylist, refreshSpotifyToken, spotifyFetch } from '../spotify';
import { MAX_TRACKS, SPOTIFY_OWNER_NAME } from '../../config';

const RATE_LIMIT_PER_HOUR = 10;

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

// Any Error thrown here reaches the browser as the GraphQL error message, so keep them readable.
export const handler: Schema['submitPlaylist']['functionHandler'] = async (event) => {
  const entryTable = process.env.ENTRY_TABLE_NAME;
  const rateLimitTable = process.env.RATE_LIMIT_TABLE_NAME;
  if (!entryTable || !rateLimitTable) throw new Error('Server misconfiguration: table names are not set.');

  await enforceRateLimit(rateLimitTable, clientIp(event.request.headers));

  const { digestOptIn } = event.arguments;
  const name = event.arguments.name.trim();
  // Email is only kept for people who want the weekly digest.
  const email = digestOptIn ? (event.arguments.email ?? '').trim().toLowerCase() : undefined;
  const playlistId = parsePlaylistId(event.arguments.playlistUrl);

  if (name.length < 1 || name.length > 60) throw new Error('Please enter your name (up to 60 characters).');
  if (digestOptIn && (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254)) {
    throw new Error('Please enter a valid email address for the weekly digest, or untick the box.');
  }
  if (!playlistId) throw new Error('That does not look like a Spotify playlist link. In Spotify use Share > Copy link to playlist.');

  const accessToken = await refreshSpotifyToken();
  const items = await fetchPlaylistItems(accessToken, playlistId);
  if (items.total === 0) throw new Error('That playlist is empty.');
  if (items.total > MAX_TRACKS) {
    throw new Error(`That playlist has ${items.total} songs. The limit is ${MAX_TRACKS}. Trim it down and try again.`);
  }
  const uris = items.items
    .filter((i) => !i.is_local && i.item && (i.item.type === 'track' || i.item.type === 'episode'))
    .map((i) => i.item!.uri);
  if (uris.length === 0) throw new Error('Those songs are local files, which Spotify cannot add to another playlist.');

  await addToMasterPlaylist(accessToken, uris);

  const now = new Date().toISOString();
  const editToken = randomBytes(16).toString('hex');
  const entry = {
    id: randomUUID(),
    name,
    playlistUrl: `https://open.spotify.com/playlist/${playlistId}`,
    playlistId,
    trackCount: items.total,
    addedAt: now,
  };
  await ddb.send(
    new PutCommand({
      TableName: entryTable,
      Item: {
        ...entry,
        ...(email ? { email } : {}),
        editToken,
        trackUris: uris,
        digestOptIn,
        createdAt: now,
        updatedAt: now,
        __typename: 'Entry',
      },
    }),
  );
  return { ...entry, editToken };
};

function clientIp(headers: Record<string, string | undefined>): string {
  const forwarded = headers['x-forwarded-for'] ?? headers['X-Forwarded-For'];
  return forwarded?.split(',')[0]?.trim() || 'unknown';
}

// Counts every attempt per IP per clock hour. Rows expire via TTL.
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
      `Spotify won't let this site read that playlist yet. Open it in Spotify, tap the three dots, choose Invite collaborators, and send the invite link to ${SPOTIFY_OWNER_NAME}. Once accepted, try again.`,
    );
  }
  if (!res.ok) {
    console.error('Spotify playlist fetch failed', res.status, await res.text());
    throw new Error('Spotify returned an error while reading that playlist. Try again in a minute.');
  }
  return (await res.json()) as PlaylistItems;
}
