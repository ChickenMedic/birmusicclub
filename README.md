# BIR Music Club

Coworkers share Spotify playlists (max 11 songs each) and the songs get added to a master playlist. See PLAN.md.

## Stack

- Amplify Gen 2 (TypeScript) on AWS: AppSync data API over DynamoDB, Lambdas, SES, EventBridge.
- Vite + React frontend hosted on Amplify Hosting at https://birmusicclub.com.
- Public site reads the `Entry` model as a guest through the Cognito identity pool. Nobody signs in; the user pool is admin-create-only.

## Secrets (SSM Parameter Store via Amplify)

Amplify Gen 2 `secret('NAME')` reads SSM Parameter Store at `/amplify/<appId>/<branch>/NAME`. Set these in the Amplify console under **Hosting > Secrets** (or `npx ampx sandbox secret set NAME` for a sandbox). They are only ever read by Lambdas, never shipped to the browser.

| Secret                  | Value                                                            |
| ----------------------- | ---------------------------------------------------------------- |
| `SPOTIFY_CLIENT_ID`     | From the Spotify developer dashboard                             |
| `SPOTIFY_CLIENT_SECRET` | From the Spotify developer dashboard                             |
| `SPOTIFY_REFRESH_TOKEN` | Output of `npm run get-refresh-token`                            |
| `SHARED_PASSWORD_HASH`  | bcrypt hash of the shared submit password (cost 10 is plenty)    |

Non-secret config (`MASTER_PLAYLIST_ID`) goes in Amplify **Hosting > Environment variables** and is wired to the Lambda in Phase 2.

## Local commands

```
npm install
npm run typecheck          # frontend + amplify backend
npm run get-refresh-token  # one-time, needs .env with Spotify client ID/secret
```
