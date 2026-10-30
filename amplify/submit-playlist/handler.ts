import { randomBytes, randomUUID } from 'node:crypto';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import type { Schema } from '../data/resource';
import { refreshSpotifyToken, SpotifyRateLimitError } from '../spotify';
import { syncEntry } from '../sync';

const RATE_LIMIT_PER_HOUR = 10;

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

// Creates the entry (the card on the page) straight away, then tries to put its songs in the
// master playlist. If Spotify will not let us read the playlist yet (no collaborator invite
// accepted), the entry stays pending and sync-pending retries it on a schedule.
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

  const now = new Date().toISOString();
  const editToken = randomBytes(16).toString('hex');
  const entry = {
    id: randomUUID(),
    name,
    playlistUrl: `https://open.spotify.com/playlist/${playlistId}`,
    playlistId,
    trackCount: 0,
    addedAt: now,
  };
  await ddb.send(
    new PutCommand({
      TableName: entryTable,
      Item: {
        ...entry,
        ...(email ? { email } : {}),
        editToken,
        claimed: true,
        trackUris: [],
        digestOptIn,
        createdAt: now,
        updatedAt: now,
        __typename: 'Entry',
      },
    }),
  );

  // The card is saved either way. If Spotify is making us wait, leave it pending for the
  // scheduled run instead of failing, so the browser still gets its edit token.
  let result: Awaited<ReturnType<typeof syncEntry>>;
  try {
    result = await syncEntry(ddb, entryTable, await refreshSpotifyToken(), entry);
  } catch (err) {
    if (!(err instanceof SpotifyRateLimitError)) throw err;
    result = { status: 'rejected', syncError: err.message };
  }
  return {
    ...entry,
    trackCount: result.status === 'synced' ? result.trackCount : 0,
    trackUris: result.status === 'synced' ? result.trackUris : [],
    syncedAt: result.status === 'synced' ? result.syncedAt : null,
    syncError: result.status === 'rejected' ? result.syncError : null,
    claimed: true,
    editToken,
  };
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
