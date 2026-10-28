import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { refreshSpotifyToken } from '../spotify';
import { refreshEntry, scanActiveEntries, syncEntry, urisHeldByOthers } from '../sync';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

// Scheduled: put pending entries' songs into the master playlist once their playlist can be
// read, and re-read every synced entry so songs the owner has swapped since are followed.
export const handler = async (): Promise<void> => {
  const tableName = process.env.ENTRY_TABLE_NAME;
  if (!tableName) throw new Error('ENTRY_TABLE_NAME is not set.');

  const entries = await scanActiveEntries(ddb, tableName);
  if (entries.length === 0) return;
  const pending = entries.filter((e) => !e.syncedAt);
  console.log(`${entries.length} active entries, ${pending.length} pending`);

  const accessToken = await refreshSpotifyToken();

  for (const entry of pending) {
    try {
      const result = await syncEntry(ddb, tableName, accessToken, entry);
      console.log(entry.name, entry.playlistId, result.status, result.status === 'rejected' ? result.syncError : '');
      if (result.status === 'synced') {
        // So the refresh pass below sees this entry's songs as taken.
        entry.syncedAt = result.syncedAt;
        entry.trackUris = result.trackUris;
        entry.trackCount = result.trackCount;
      }
    } catch (err) {
      console.error('sync failed for', entry.name, entry.playlistId, err);
    }
  }

  for (const entry of entries) {
    if (!entry.syncedAt || pending.includes(entry)) continue;
    try {
      const result = await refreshEntry(ddb, tableName, accessToken, entry, urisHeldByOthers(entries, entry));
      if (result.status === 'changed') {
        console.log(entry.name, entry.playlistId, `changed: +${result.added} -${result.removed}, now ${result.trackCount} songs`);
        entry.trackUris = result.trackUris;
        entry.trackCount = result.trackCount;
      } else if (result.status !== 'unchanged') {
        console.log(entry.name, entry.playlistId, result.status, result.status === 'rejected' ? result.syncError : '');
      }
    } catch (err) {
      console.error('refresh failed for', entry.name, entry.playlistId, err);
    }
  }
};
