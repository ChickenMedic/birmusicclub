import { defineBackend } from '@aws-amplify/backend';
import { Stack } from 'aws-cdk-lib';
import { AttributeType, BillingMode, Table } from 'aws-cdk-lib/aws-dynamodb';
import { auth } from './auth/resource';
import { data } from './data/resource';
import { submitPlaylist } from './submit-playlist/resource';

const backend = defineBackend({
  auth,
  data,
  submitPlaylist,
});

// Nobody signs in to this site. Cognito exists only so the identity pool can hand guests
// read-only credentials. Block self sign-up so no one can register and read the
// authenticated-only email field.
backend.auth.resources.cfnResources.cfnUserPool.adminCreateUserConfig = {
  allowAdminCreateUserOnly: true,
};

// The submit Lambda writes entries straight to the model's table.
const entryTable = backend.data.resources.tables['Entry'];
const submitLambda = backend.submitPlaylist.resources.lambda;
entryTable.grantWriteData(submitLambda);
backend.submitPlaylist.addEnvironment('ENTRY_TABLE_NAME', entryTable.tableName);

// Per-IP attempt counters for rate limiting. Rows expire on their own via TTL.
const rateLimitTable = new Table(Stack.of(submitLambda), 'RateLimitTable', {
  partitionKey: { name: 'pk', type: AttributeType.STRING },
  billingMode: BillingMode.PAY_PER_REQUEST,
  timeToLiveAttribute: 'expiresAt',
});
rateLimitTable.grantReadWriteData(submitLambda);
backend.submitPlaylist.addEnvironment('RATE_LIMIT_TABLE_NAME', rateLimitTable.tableName);
