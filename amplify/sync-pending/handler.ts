import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { refreshSpotifyToken } from '../spotify';
import { syncEntry, type SyncableEntry } from '../sync';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

// Scheduled: find active entries that are not in the master playlist yet and try each one.
export const handler = async (): Promise<void> => {
  const tableName = process.env.ENTRY_TABLE_NAME;
  if (!tableName) throw new Error('ENTRY_TABLE_NAME is not set.');

  const pending: SyncableEntry[] = [];
  let startKey: Record<string, unknown> | undefined;
  do {
    const page = await ddb.send(
      new ScanCommand({
        TableName: tableName,
        FilterExpression: 'attribute_not_exists(syncedAt) AND attribute_not_exists(deletedAt)',
        ProjectionExpression: 'id, #name, playlistId, addedAt, trackCount, trackUris, syncError',
        ExpressionAttributeNames: { '#name': 'name' },
        ExclusiveStartKey: startKey,
      }),
    );
    pending.push(...((page.Items ?? []) as SyncableEntry[]));
    startKey = page.LastEvaluatedKey;
  } while (startKey);

  if (pending.length === 0) return;
  console.log(`${pending.length} pending entries`);

  const accessToken = await refreshSpotifyToken();
  for (const entry of pending) {
    try {
      const result = await syncEntry(ddb, tableName, accessToken, entry);
      console.log(entry.name, entry.playlistId, result.status, result.status === 'rejected' ? result.syncError : '');
    } catch (err) {
      console.error('sync failed for', entry.name, entry.playlistId, err);
    }
  }
};
