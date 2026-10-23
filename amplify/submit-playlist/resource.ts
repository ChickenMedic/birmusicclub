import { defineFunction, secret } from '@aws-amplify/backend';

// Non-secret config comes from Amplify Hosting > Environment variables and is baked in at deploy.
const masterPlaylistId = process.env.MASTER_PLAYLIST_ID;
if (!masterPlaylistId) {
  throw new Error('Set the MASTER_PLAYLIST_ID environment variable in Amplify Hosting (the Spotify ID of the master playlist).');
}

export const submitPlaylist = defineFunction({
  name: 'submit-playlist',
  entry: './handler.ts',
  runtime: 22,
  timeoutSeconds: 30,
  // Lives in the data stack: it is both the handler of a data mutation and a writer to the
  // Entry table, which would otherwise be a circular dependency between nested stacks.
  resourceGroupName: 'data',
  environment: {
    MASTER_PLAYLIST_ID: masterPlaylistId,
    // Secrets are stored in SSM Parameter Store and fetched into memory when the function runs.
    SPOTIFY_CLIENT_ID: secret('SPOTIFY_CLIENT_ID'),
    SPOTIFY_CLIENT_SECRET: secret('SPOTIFY_CLIENT_SECRET'),
    SPOTIFY_REFRESH_TOKEN: secret('SPOTIFY_REFRESH_TOKEN'),
    SHARED_PASSWORD_HASH: secret('SHARED_PASSWORD_HASH'),
  },
});
