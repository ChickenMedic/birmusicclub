import { defineBackend } from '@aws-amplify/backend';
import { Stack } from 'aws-cdk-lib';
import { AttributeType, BillingMode, Table } from 'aws-cdk-lib/aws-dynamodb';
import { auth } from './auth/resource';
import { data } from './data/resource';
import { submitPlaylist } from './submit-playlist/resource';
import { manageEntry } from './manage-entry/resource';
import { syncPending } from './sync-pending/resource';
import { siteStats } from './site-stats/resource';

const backend = defineBackend({
  auth,
  data,
  submitPlaylist,
  manageEntry,
  syncPending,
  siteStats,
});

// Nobody signs in to this site. Cognito exists only so the identity pool can hand guests
// read-only credentials. Block self sign-up so no one can register and read the
// authenticated-only fields.
backend.auth.resources.cfnResources.cfnUserPool.adminCreateUserConfig = {
  allowAdminCreateUserOnly: true,
};

// All three Lambdas talk straight to the model's table.
const entryTable = backend.data.resources.tables['Entry'];
const submitLambda = backend.submitPlaylist.resources.lambda;
entryTable.grantWriteData(submitLambda);
backend.submitPlaylist.addEnvironment('ENTRY_TABLE_NAME', entryTable.tableName);

const manageLambda = backend.manageEntry.resources.lambda;
entryTable.grantReadWriteData(manageLambda);
backend.manageEntry.addEnvironment('ENTRY_TABLE_NAME', entryTable.tableName);

const syncLambda = backend.syncPending.resources.lambda;
entryTable.grantReadWriteData(syncLambda);
backend.syncPending.addEnvironment('ENTRY_TABLE_NAME', entryTable.tableName);

// Per-IP attempt counters for rate limiting. Rows expire on their own via TTL.
const rateLimitTable = new Table(Stack.of(submitLambda), 'RateLimitTable', {
  partitionKey: { name: 'pk', type: AttributeType.STRING },
  billingMode: BillingMode.PAY_PER_REQUEST,
  timeToLiveAttribute: 'expiresAt',
});
// It also holds when a Spotify back-off ends, which every Lambda that calls Spotify checks,
// and the site's visit counter.
for (const fn of [backend.submitPlaylist, backend.manageEntry, backend.syncPending, backend.siteStats]) {
  rateLimitTable.grantReadWriteData(fn.resources.lambda);
  fn.addEnvironment('RATE_LIMIT_TABLE_NAME', rateLimitTable.tableName);
}
