// Getting an entry's songs into the master playlist and keeping them there. Shared by
// submit-playlist (first try), manage-entry ("Check now" on a card) and sync-pending (the
// scheduled run).
//
// An entry is "pending" until syncedAt is set. That happens when Spotify lets us read the
// playlist (the owner has invited our account to collaborate) and it passes the song limit.
// After that, refreshEntry re-reads the playlist so songs the owner swaps are followed.
import { DynamoDBDocumentClient, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { maxTracksFor } from '../config';
import { addToMasterPlaylist, addableUris, fetchPlaylistItems, PlaylistUnreadableError, removeFromMasterPlaylist } from './spotify';

export type SyncableEntry = {
  id: string;
  name: string;
  playlistId: string;
  addedAt?: string;
  trackCount?: number;
  trackUris?: string[];
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

  // Entries from before syncedAt existed already have their songs in the master playlist
  // (trackUris was recorded when they were added). Mark them synced; never re-add them.
  if (!entry.syncedAt && entry.trackUris && entry.trackUris.length > 0) {
    const syncedAt = entry.addedAt ?? now;
    await ddb.send(
      new UpdateCommand({
        TableName: tableName,
        Key: { id: entry.id },
        UpdateExpression: 'SET syncedAt = :syncedAt, updatedAt = :now REMOVE syncError',
        ExpressionAttributeValues: { ':syncedAt': syncedAt, ':now': now },
      }),
    );
    return { status: 'synced', trackCount: entry.trackCount ?? entry.trackUris.length, trackUris: entry.trackUris, syncedAt };
  }

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

// Every entry that has not been deleted, with the fields the sync code needs.
export async function scanActiveEntries(ddb: DynamoDBDocumentClient, tableName: string): Promise<SyncableEntry[]> {
  const entries: SyncableEntry[] = [];
  let startKey: Record<string, unknown> | undefined;
  do {
    const page = await ddb.send(
      new ScanCommand({
        TableName: tableName,
        FilterExpression: 'attribute_not_exists(deletedAt)',
        ProjectionExpression: 'id, #name, playlistId, addedAt, trackCount, trackUris, syncedAt, syncError',
        ExpressionAttributeNames: { '#name': 'name' },
        ExclusiveStartKey: startKey,
      }),
    );
    entries.push(...((page.Items ?? []) as SyncableEntry[]));
    startKey = page.LastEvaluatedKey;
  } while (startKey);
  return entries;
}

// The songs every active entry other than this one contributes. Adding or removing one of
// these for this entry must leave the master playlist alone.
export function urisHeldByOthers(entries: SyncableEntry[], entry: { id: string }): Set<string> {
  const held = new Set<string>();
  for (const other of entries) {
    if (other.id === entry.id) continue;
    for (const uri of other.trackUris ?? []) held.add(uri);
  }
  return held;
}

export type RefreshResult =
  | { status: 'unchanged' }
  | { status: 'changed'; added: number; removed: number; trackCount: number; trackUris: string[]; syncedAt: string }
  | { status: 'unreadable' }
  | { status: 'rejected'; syncError: string };

// Re-reads a synced entry's playlist and makes the master playlist follow whatever changed:
// songs the owner removed come out (unless someone else also picked them) and songs they
// added go in (unless they are already there from someone else). The entry's recorded song
// list is updated to match. A playlist that now breaks a rule records why and leaves the
// master playlist as it was; one we can no longer read is left alone.
export async function refreshEntry(
  ddb: DynamoDBDocumentClient,
  tableName: string,
  accessToken: string,
  entry: SyncableEntry,
  heldByOthers: Set<string>,
): Promise<RefreshResult> {
  const now = new Date().toISOString();

  let items;
  try {
    items = await fetchPlaylistItems(accessToken, entry.playlistId);
  } catch (err) {
    if (!(err instanceof PlaylistUnreadableError)) throw err;
    return { status: 'unreadable' };
  }

  const limit = maxTracksFor(entry.name);
  const uris = addableUris(items);
  let syncError: string | undefined;
  if (items.total === 0) syncError = 'The playlist is empty, so its songs stay in the Master Mix. Add songs and they will be picked up.';
  else if (items.total > limit) {
    syncError = `The playlist now has ${items.total} songs. The limit is ${limit}. Trim it down and the changes will be picked up.`;
  } else if (uris.length === 0) syncError = 'Those songs are local files, which Spotify cannot add to another playlist.';

  if (syncError) {
    if (syncError !== entry.syncError) {
      await ddb.send(
        new UpdateCommand({
          TableName: tableName,
          Key: { id: entry.id },
          UpdateExpression: 'SET syncError = :err, updatedAt = :now',
          ExpressionAttributeValues: { ':err': syncError, ':now': now },
        }),
      );
    }
    return { status: 'rejected', syncError };
  }

  // Entries that predate recorded song lists already have their songs in the master playlist.
  // Record what the playlist holds now and start tracking changes from here.
  const untracked = entry.trackUris === undefined;
  const before = new Set(entry.trackUris ?? uris);
  const after = new Set(uris);
  const removed = [...before].filter((uri) => !after.has(uri));
  const added = [...after].filter((uri) => !before.has(uri));

  if (!untracked && removed.length === 0 && added.length === 0 && items.total === entry.trackCount && !entry.syncError) {
    return { status: 'unchanged' };
  }

  const toRemove = removed.filter((uri) => !heldByOthers.has(uri));
  const toAdd = added.filter((uri) => !heldByOthers.has(uri));
  if (toRemove.length > 0) await removeFromMasterPlaylist(accessToken, toRemove);
  if (toAdd.length > 0) await addToMasterPlaylist(accessToken, toAdd);

  const changedSongs = removed.length > 0 || added.length > 0;
  await ddb.send(
    new UpdateCommand({
      TableName: tableName,
      Key: { id: entry.id },
      UpdateExpression: `SET trackCount = :count, trackUris = :uris, updatedAt = :now${changedSongs ? ', syncedAt = :now' : ''} REMOVE syncError`,
      ExpressionAttributeValues: { ':now': now, ':count': items.total, ':uris': uris },
    }),
  );
  if (!changedSongs) return { status: 'unchanged' };
  return { status: 'changed', added: added.length, removed: removed.length, trackCount: items.total, trackUris: uris, syncedAt: now };
}
