import { defineFunction, secret } from '@aws-amplify/backend';

// Every few minutes: retries entries whose songs are not in the master playlist yet (the case
// until the owner's collaborator invite has been accepted) and re-reads synced entries so
// songs swapped in their playlist are followed in the master playlist.
export const syncPending = defineFunction({
  name: 'sync-pending',
  entry: './handler.ts',
  runtime: 22,
  timeoutSeconds: 300,
  schedule: 'every 10m',
  resourceGroupName: 'data',
  environment: {
    SPOTIFY_CLIENT_ID: secret('SPOTIFY_CLIENT_ID'),
    SPOTIFY_CLIENT_SECRET: secret('SPOTIFY_CLIENT_SECRET'),
    SPOTIFY_REFRESH_TOKEN: secret('SPOTIFY_REFRESH_TOKEN'),
  },
});
