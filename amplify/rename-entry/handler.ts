import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import type { Schema } from '../data/resource';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

// Renames an entry. The caller must present the editToken that submitPlaylist handed out
// when the entry was created; the browser that submitted keeps it in localStorage.
export const handler: Schema['renameEntry']['functionHandler'] = async (event) => {
  const tableName = process.env.ENTRY_TABLE_NAME;
  if (!tableName) throw new Error('Server misconfiguration: ENTRY_TABLE_NAME is not set.');

  const { id, editToken } = event.arguments;
  const name = event.arguments.name.trim();
  if (name.length < 1 || name.length > 60) throw new Error('Please enter a name (up to 60 characters).');
  if (!id || !editToken) throw new Error('Only the browser that submitted this playlist can rename it.');

  try {
    const result = await ddb.send(
      new UpdateCommand({
        TableName: tableName,
        Key: { id },
        UpdateExpression: 'SET #name = :name, updatedAt = :now',
        ConditionExpression: 'editToken = :token',
        ExpressionAttributeNames: { '#name': 'name' },
        ExpressionAttributeValues: { ':name': name, ':now': new Date().toISOString(), ':token': editToken },
        ReturnValues: 'ALL_NEW',
      }),
    );
    const item = result.Attributes!;
    return {
      id: item.id as string,
      name: item.name as string,
      playlistUrl: item.playlistUrl as string,
      playlistId: item.playlistId as string,
      trackCount: item.trackCount as number,
      addedAt: item.addedAt as string,
    };
  } catch (err) {
    if ((err as { name?: string }).name === 'ConditionalCheckFailedException') {
      throw new Error('Only the browser that submitted this playlist can rename it.');
    }
    throw err;
  }
};
