// Getting an entry's songs into the master playlist. Shared by submit-playlist (first try),
// manage-entry ("Check now" on a pending card) and sync-pending (the scheduled retry).
//
// An entry is "pending" until syncedAt is set. That happens when Spotify lets us read the
// playlist (the owner has invited our account to collaborate) and it passes the song limit.
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { maxTracksFor } from '../config';
import { addToMasterPlaylist, addableUris, fetchPlaylistItems, PlaylistUnreadableError } from './spotify';

export type SyncableEntry = {
  id: string;
  name: string;
  playlistId: string;
  syncedAt?: string;
  syncError?: string;
};

export type SyncResult =
  | { status: 'synced'; trackCount: number; trackUris: string[]; syncedAt: string }
  | { status: 'unreadable' }
  | { status: 'rejected'; syncError: string };

// Reads the playlist and, if it qualifies, adds its songs to the master playlist and marks the
// entry synced. A playlist we cannot read yet leaves the entry pending (and clears any old
// error); one that breaks a rule records why so the card can show it.
export async function syncEntry(
  ddb: DynamoDBDocumentClient,
  tableName: string,
  accessToken: string,
  entry: SyncableEntry,
): Promise<SyncResult> {
  const now = new Date().toISOString();
  let outcome: SyncResult;
  try {
    const items = await fetchPlaylistItems(accessToken, entry.playlistId);
    const limit = maxTracksFor(entry.name);
    const uris = addableUris(items);
    if (items.total === 0) outcome = { status: 'rejected', syncError: 'The playlist is empty.' };
    else if (items.total > limit) {
      outcome = { status: 'rejected', syncError: `The playlist has ${items.total} songs. The limit is ${limit}. Trim it down and it will be picked up.` };
    } else if (uris.length === 0) {
      outcome = { status: 'rejected', syncError: 'Those songs are local files, which Spotify cannot add to another playlist.' };
    } else {
      await addToMasterPlaylist(accessToken, uris);
      outcome = { status: 'synced', trackCount: items.total, trackUris: uris, syncedAt: now };
    }
  } catch (err) {
    if (!(err instanceof PlaylistUnreadableError)) throw err;
    outcome = { status: 'unreadable' };
  }

  if (outcome.status === 'synced') {
    await ddb.send(
      new UpdateCommand({
        TableName: tableName,
        Key: { id: entry.id },
        UpdateExpression: 'SET syncedAt = :now, trackCount = :count, trackUris = :uris, updatedAt = :now REMOVE syncError',
        ExpressionAttributeValues: { ':now': now, ':count': outcome.trackCount, ':uris': outcome.trackUris },
      }),
    );
  } else if (outcome.status === 'rejected' && outcome.syncError !== entry.syncError) {
    await ddb.send(
      new UpdateCommand({
        TableName: tableName,
        Key: { id: entry.id },
        UpdateExpression: 'SET syncError = :err, updatedAt = :now',
        ExpressionAttributeValues: { ':err': outcome.syncError, ':now': now },
      }),
    );
  } else if (outcome.status === 'unreadable' && entry.syncError) {
    await ddb.send(
      new UpdateCommand({
        TableName: tableName,
        Key: { id: entry.id },
        UpdateExpression: 'REMOVE syncError SET updatedAt = :now',
        ExpressionAttributeValues: { ':now': now },
      }),
    );
  }
  return outcome;
}
