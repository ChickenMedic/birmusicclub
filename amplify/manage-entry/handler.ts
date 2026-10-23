import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import type { Schema } from '../data/resource';
import { addToMasterPlaylist, refreshSpotifyToken, removeFromMasterPlaylist } from '../spotify';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

type EntryItem = {
  id: string;
  name: string;
  playlistUrl: string;
  playlistId: string;
  trackCount: number;
  addedAt: string;
  deletedAt?: string;
  editToken?: string;
  trackUris?: string[];
};

const NOT_YOURS = 'Only the browser that submitted this playlist can change it.';

// Rename, soft-delete or restore an entry. The caller must present the editToken that
// submitPlaylist handed out; the submitting browser keeps it in localStorage.
// Delete/restore keep the master playlist in sync, without touching songs that another
// active entry also contributed.
export const handler: Schema['manageEntry']['functionHandler'] = async (event) => {
  const tableName = process.env.ENTRY_TABLE_NAME;
  if (!tableName) throw new Error('Server misconfiguration: ENTRY_TABLE_NAME is not set.');

  const { id, editToken, action } = event.arguments;
  if (!id || !editToken) throw new Error(NOT_YOURS);

  const current = (await ddb.send(new GetCommand({ TableName: tableName, Key: { id } }))).Item as EntryItem | undefined;
  if (!current || current.editToken !== editToken) throw new Error(NOT_YOURS);

  const now = new Date().toISOString();

  switch (action) {
    case 'rename': {
      const name = (event.arguments.name ?? '').trim();
      if (name.length < 1 || name.length > 60) throw new Error('Please enter a name (up to 60 characters).');
      return publicFields(await update(tableName, id, editToken, 'SET #name = :name, updatedAt = :now', { ':name': name, ':now': now }, { '#name': 'name' }));
    }
    case 'delete': {
      if (current.deletedAt) return publicFields(current);
      const uris = await urisNotHeldByOthers(tableName, current);
      if (uris.length > 0) await removeFromMasterPlaylist(await refreshSpotifyToken(), uris);
      return publicFields(await update(tableName, id, editToken, 'SET deletedAt = :now, updatedAt = :now', { ':now': now }));
    }
    case 'restore': {
      if (!current.deletedAt) return publicFields(current);
      const uris = await urisNotHeldByOthers(tableName, current);
      if (uris.length > 0) await addToMasterPlaylist(await refreshSpotifyToken(), uris);
      return publicFields(await update(tableName, id, editToken, 'REMOVE deletedAt SET updatedAt = :now', { ':now': now }));
    }
    default:
      throw new Error('Unknown action.');
  }
};

async function update(
  tableName: string,
  id: string,
  editToken: string,
  expression: string,
  values: Record<string, unknown>,
  names?: Record<string, string>,
): Promise<EntryItem> {
  try {
    const result = await ddb.send(
      new UpdateCommand({
        TableName: tableName,
        Key: { id },
        UpdateExpression: expression,
        ConditionExpression: 'editToken = :token',
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: { ...values, ':token': editToken },
        ReturnValues: 'ALL_NEW',
      }),
    );
    return result.Attributes as EntryItem;
  } catch (err) {
    if ((err as { name?: string }).name === 'ConditionalCheckFailedException') throw new Error(NOT_YOURS);
    throw err;
  }
}

// This entry's songs minus any that another active entry also contributed, so that
// removing/re-adding them never affects someone else's picks in the master playlist.
async function urisNotHeldByOthers(tableName: string, entry: EntryItem): Promise<string[]> {
  const own = entry.trackUris ?? [];
  if (own.length === 0) return [];
  const held = new Set<string>();
  let startKey: Record<string, unknown> | undefined;
  do {
    const page = await ddb.send(
      new ScanCommand({
        TableName: tableName,
        FilterExpression: 'attribute_not_exists(deletedAt) AND id <> :id',
        ExpressionAttributeValues: { ':id': entry.id },
        ProjectionExpression: 'trackUris',
        ExclusiveStartKey: startKey,
      }),
    );
    for (const item of page.Items ?? []) for (const uri of (item.trackUris as string[] | undefined) ?? []) held.add(uri);
    startKey = page.LastEvaluatedKey;
  } while (startKey);
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
    deletedAt: item.deletedAt ?? null,
  };
}
