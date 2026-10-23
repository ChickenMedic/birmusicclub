import { defineFunction, secret } from '@aws-amplify/backend';

export const submitPlaylist = defineFunction({
  name: 'submit-playlist',
  entry: './handler.ts',
  runtime: 22,
  timeoutSeconds: 30,
  // Lives in the data stack: it is both the handler of a data mutation and a writer to the
  // Entry table, which would otherwise be a circular dependency between nested stacks.
  resourceGroupName: 'data',
  environment: {
    // Secrets are stored in SSM Parameter Store and fetched into memory when the function runs.
    SPOTIFY_CLIENT_ID: secret('SPOTIFY_CLIENT_ID'),
    SPOTIFY_CLIENT_SECRET: secret('SPOTIFY_CLIENT_SECRET'),
    SPOTIFY_REFRESH_TOKEN: secret('SPOTIFY_REFRESH_TOKEN'),
  },
});
