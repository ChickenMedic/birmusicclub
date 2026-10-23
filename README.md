# BIR Music Club

Coworkers share Spotify playlists (max 11 songs each) and the songs get added to a master playlist. See PLAN.md.

## Stack

- Amplify Gen 2 (TypeScript) on AWS: AppSync data API over DynamoDB, Lambdas, SES, EventBridge.
- Vite + React frontend hosted on Amplify Hosting at https://birmusicclub.com.
- Public site reads the `Entry` model as a guest through the Cognito identity pool. Nobody signs in; the user pool is admin-create-only.
- The only write path is the `submitPlaylist` mutation, handled by `amplify/submit-playlist/handler.ts`.

## Amplify console configuration

All of these are read only by the submit Lambda, never shipped to the browser.

**Hosting > Secrets** (stored in SSM Parameter Store at `/amplify/<appId>/<branch>/<NAME>`):

| Secret                  | Value                                                     |
| ----------------------- | --------------------------------------------------------- |
| `SPOTIFY_CLIENT_ID`     | From the Spotify developer dashboard                      |
| `SPOTIFY_CLIENT_SECRET` | From the Spotify developer dashboard                      |
| `SPOTIFY_REFRESH_TOKEN` | Output of `npm run get-refresh-token`                     |
| `SHARED_PASSWORD_HASH`  | bcrypt hash of the shared submit password (see below)     |

**Hosting > Environment variables:**

| Variable             | Value                                                                  |
| -------------------- | ---------------------------------------------------------------------- |
| `MASTER_PLAYLIST_ID` | The 22-character ID from the master playlist's Spotify link            |

Generate the password hash locally (the password itself is never stored anywhere):

```
node -e "console.log(require('bcryptjs').hashSync(process.argv[1], 10))" 'the-shared-password'
```

## Submit flow

1. Rate limit: 10 attempts per IP per hour, counted in a small DynamoDB table with TTL.
2. Check the password against the bcrypt hash.
3. Parse the playlist ID from the pasted link, refresh the Spotify access token, read the playlist.
4. Reject if empty or over 11 songs. Spotify 429s are retried honouring Retry-After within a 20 second budget.
5. Add the songs to the master playlist, then save the entry.

## Local commands

```
npm install
npm run typecheck          # frontend + amplify backend
npm run get-refresh-token  # one-time, needs .env with Spotify client ID/secret
```
