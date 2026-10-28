import { defineFunction, secret } from '@aws-amplify/backend';

// Once a day (09:00 UTC, 3 am Mountain): retries entries whose songs are not in the master
// playlist yet (the case until the owner's collaborator invite has been accepted) and re-reads
// synced entries so songs swapped in their playlist are followed in the master playlist.
export const syncPending = defineFunction({
  name: 'sync-pending',
  entry: './handler.ts',
  runtime: 22,
  timeoutSeconds: 300,
  // Kept rare so we stay well under Spotify's limits. The buttons on the cards do the same
  // for one entry on demand.
  schedule: '0 9 * * ? *',
  resourceGroupName: 'data',
  environment: {
    SPOTIFY_CLIENT_ID: secret('SPOTIFY_CLIENT_ID'),
    SPOTIFY_CLIENT_SECRET: secret('SPOTIFY_CLIENT_SECRET'),
    SPOTIFY_REFRESH_TOKEN: secret('SPOTIFY_REFRESH_TOKEN'),
  },
});
