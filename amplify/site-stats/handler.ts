import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import type { Schema } from '../data/resource';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

// One row in the rate-limit table (which already doubles as a small key-value store) holds the
// total number of visits. It has no expiresAt, so the table's TTL never removes it.
const VISITS_KEY = 'site#visits';

// Handles both operations: the recordVisit mutation adds one visit and returns the new total;
// the siteStats query returns the total as it is. The browser calls recordVisit once per tab
// session and siteStats on later reloads, so refreshing the page does not inflate the count.
export const handler: Schema['recordVisit']['functionHandler'] = async (event) => {
  const tableName = process.env.RATE_LIMIT_TABLE_NAME;
  if (!tableName) throw new Error('Server misconfiguration: RATE_LIMIT_TABLE_NAME is not set.');

  if (event.info.fieldName === 'recordVisit') {
    const result = await ddb.send(
      new UpdateCommand({
        TableName: tableName,
        Key: { pk: VISITS_KEY },
        UpdateExpression: 'ADD visits :one',
        ExpressionAttributeValues: { ':one': 1 },
        ReturnValues: 'UPDATED_NEW',
      }),
    );
    return { visits: (result.Attributes?.visits as number | undefined) ?? 0 };
  }

  const item = (await ddb.send(new GetCommand({ TableName: tableName, Key: { pk: VISITS_KEY } }))).Item;
  return { visits: (item?.visits as number | undefined) ?? 0 };
};
