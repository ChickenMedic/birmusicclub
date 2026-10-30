import { randomBytes } from 'node:crypto';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import type { Schema } from '../data/resource';
import { addToMasterPlaylist, addableUris, fetchPlaylistItems, readOptionalSecret, refreshSpotifyToken, removeFromMasterPlaylist } from '../spotify';
import { refreshEntry, scanActiveEntries, syncEntry, urisHeldByOthers } from '../sync';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

type EntryItem = {
  id: string;
  name: string;
  playlistUrl: string;
  playlistId: string;
  trackCount: number;
  addedAt: string;
  syncedAt?: string;
  syncError?: string;
  deletedAt?: string;
  claimed?: boolean;
  editToken?: string;
  trackUris?: string[];
};

const NOT_YOURS = 'Only the browser that submitted this playlist (or the admin) can do that.';

// rename and sync are open to everyone. sync puts a pending entry's songs in the master playlist
// or, for an entry already in it, re-reads the playlist and follows any swapped songs.
// delete and restore need the editToken that
// submitPlaylist handed out (the submitting browser keeps it in localStorage) or the admin key.
// Delete/restore keep the master playlist in sync, without touching songs that another
// active entry also contributed.
// "claim" exists for entries created before edit tokens were introduced: it issues a token
// (once) and backfills the song list from Spotify.
export const handler: Schema['manageEntry']['functionHandler'] = async (event) => {
  const tableName = process.env.ENTRY_TABLE_NAME;
  if (!tableName) throw new Error('Server misconfiguration: ENTRY_TABLE_NAME is not set.');

  const { id, editToken, action } = event.arguments;
  if (!id) throw new Error(NOT_YOURS);

  const current = (await ddb.send(new GetCommand({ TableName: tableName, Key: { id } }))).Item as EntryItem | undefined;
  if (!current) throw new Error('That playlist no longer exists. Refresh the page.');

  const now = new Date().toISOString();

  switch (action) {
    case 'rename': {
      const name = (event.arguments.name ?? '').trim();
      if (name.length < 1 || name.length > 60) throw new Error('Please enter a name (up to 60 characters).');
      const result = await ddb.send(
        new UpdateCommand({
          TableName: tableName,
          Key: { id },
          UpdateExpression: 'SET #name = :name, updatedAt = :now',
          ExpressionAttributeNames: { '#name': 'name' },
          ExpressionAttributeValues: { ':name': name, ':now': now },
          ReturnValues: 'ALL_NEW',
        }),
      );
      return publicFields(result.Attributes as EntryItem);
    }
    case 'sync': {
      if (current.deletedAt) return publicFields(current);
      if (current.syncedAt) {
        const others = urisHeldByOthers(await scanActiveEntries(ddb, tableName), current);
        const result = await refreshEntry(ddb, tableName, await refreshSpotifyToken(), current, others);
        if (result.status === 'changed') {
          return publicFields({ ...current, trackCount: result.trackCount, trackUris: result.trackUris, syncedAt: result.syncedAt, syncError: undefined });
        }
        if (result.status === 'rejected') return publicFields({ ...current, syncError: result.syncError });
        return publicFields(result.status === 'unchanged' ? { ...current, syncError: undefined } : current);
      }
      const result = await syncEntry(ddb, tableName, await refreshSpotifyToken(), current);
      if (result.status === 'synced') {
        return publicFields({ ...current, trackCount: result.trackCount, trackUris: result.trackUris, syncedAt: result.syncedAt, syncError: undefined });
      }
      return publicFields({ ...current, syncError: result.status === 'rejected' ? result.syncError : undefined });
    }
    case 'claim': {
      if (current.editToken) throw new Error('This playlist has already been claimed.');
      const accessToken = await refreshSpotifyToken();
      const items = await fetchPlaylistItems(accessToken, current.playlistId);
      const token = randomBytes(16).toString('hex');
      try {
        const result = await ddb.send(
          new UpdateCommand({
            TableName: tableName,
            Key: { id },
            UpdateExpression: 'SET editToken = :token, claimed = :true, trackUris = :uris, trackCount = :count, syncedAt = if_not_exists(syncedAt, :now), updatedAt = :now',
            ConditionExpression: 'attribute_not_exists(editToken)',
            ExpressionAttributeValues: { ':token': token, ':true': true, ':uris': addableUris(items), ':count': items.total, ':now': now },
            ReturnValues: 'ALL_NEW',
          }),
        );
        return { ...publicFields(result.Attributes as EntryItem), editToken: token };
      } catch (err) {
        if ((err as { name?: string }).name === 'ConditionalCheckFailedException') throw new Error('This playlist has already been claimed.');
        throw err;
      }
    }
  }

  // delete / restore
  const adminKey = readOptionalSecret('ADMIN_KEY');
  const isAdmin = !!adminKey && editToken === adminKey;
  const isOwner = !!editToken && current.editToken === editToken;
  if (!isAdmin && !isOwner) throw new Error(NOT_YOURS);

  switch (action) {
    case 'delete': {
      if (current.deletedAt) return publicFields(current);
      const uris = await urisNotHeldByOthers(tableName, current);
      if (uris.length > 0) await removeFromMasterPlaylist(await refreshSpotifyToken(), uris);
      return publicFields(await update(tableName, id, 'SET deletedAt = :now, updatedAt = :now', { ':now': now }));
    }
    case 'restore': {
      if (!current.deletedAt) return publicFields(current);
      const uris = await urisNotHeldByOthers(tableName, current);
      if (uris.length > 0) await addToMasterPlaylist(await refreshSpotifyToken(), uris);
      return publicFields(await update(tableName, id, 'REMOVE deletedAt SET updatedAt = :now', { ':now': now }));
    }
    default:
      throw new Error('Unknown action.');
  }
};

async function update(tableName: string, id: string, expression: string, values: Record<string, unknown>): Promise<EntryItem> {
  const result = await ddb.send(
    new UpdateCommand({
      TableName: tableName,
      Key: { id },
      UpdateExpression: expression,
      ExpressionAttributeValues: values,
      ReturnValues: 'ALL_NEW',
    }),
  );
  return result.Attributes as EntryItem;
}

// This entry's songs minus any that another active entry also contributed, so that
// removing/re-adding them never affects someone else's picks in the master playlist.
async function urisNotHeldByOthers(tableName: string, entry: EntryItem): Promise<string[]> {
  const own = entry.trackUris ?? [];
  if (own.length === 0) return [];
  const held = urisHeldByOthers(await scanActiveEntries(ddb, tableName), entry);
  return own.filter((uri) => !held.has(uri));
}

function publicFields(item: EntryItem) {
  return {
    id: item.id,
    name: item.name,
    playlistUrl: item.playlistUrl,
    playlistId: item.playlistId,
    trackCount: item.trackCount,
    addedAt: item.addedAt,
    syncedAt: item.syncedAt ?? null,
    syncError: item.syncError ?? null,
    deletedAt: item.deletedAt ?? null,
    claimed: item.claimed ?? false,
    trackUris: item.trackUris ?? null,
  };
}
