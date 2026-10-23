import { defineFunction, secret } from '@aws-amplify/backend';

export const manageEntry = defineFunction({
  name: 'manage-entry',
  entry: './handler.ts',
  runtime: 22,
  timeoutSeconds: 30,
  // Same stack as the data API, like submit-playlist, to avoid a circular dependency.
  resourceGroupName: 'data',
  environment: {
    // Needed to remove/re-add songs in the master playlist on delete/restore.
    SPOTIFY_CLIENT_ID: secret('SPOTIFY_CLIENT_ID'),
    SPOTIFY_CLIENT_SECRET: secret('SPOTIFY_CLIENT_SECRET'),
    SPOTIFY_REFRESH_TOKEN: secret('SPOTIFY_REFRESH_TOKEN'),
  },
});
