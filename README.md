# BIR Music Club

Coworkers share Spotify playlists (max 11 songs each) and the songs get added to a master playlist. See PLAN.md.

## Stack

- Amplify Gen 2 (TypeScript) on AWS: AppSync data API over DynamoDB, Lambdas, SES, EventBridge.
- Vite + React frontend hosted on Amplify Hosting at https://birmusicclub.com.
- Public site reads the `Entry` model as a guest through the Cognito identity pool. Nobody signs in; the user pool is admin-create-only.
- Entries are created by the `submitPlaylist` mutation (`amplify/submit-playlist/handler.ts`). It returns a per-entry `editToken` that the submitting browser keeps in localStorage.
- `manageEntry` (`amplify/manage-entry/handler.ts`) renames, soft-deletes or restores an entry when given that token. Delete removes the entry's songs from the master playlist and restore adds them back, skipping any song another active entry also contributed. Deleted entries keep their record (`deletedAt`) so restore is trivial.
- `config.ts` holds the master playlist ID, the Spotify account name, the song limit and the founders list (who get one extra song, matched by the name typed into the form); both the site and the Lambdas import it.

## Spotify constraint

The Spotify app is in development mode. It can only read the contents of playlists its own account (ChickenMed) owns or collaborates on. Coworkers must invite ChickenMed as a collaborator on their playlist before submitting; the form says so and the Lambda returns that instruction on a 403.

## Amplify console configuration

**Hosting > Secrets** (stored in SSM Parameter Store at `/amplify/<appId>/<branch>/<NAME>`, read only by the submit Lambda):

| Secret                  | Value                                       |
| ----------------------- | ------------------------------------------- |
| `SPOTIFY_CLIENT_ID`     | `SPOTIFY_CLIENT_ID` from the local `.env`     |
| `SPOTIFY_CLIENT_SECRET` | `SPOTIFY_CLIENT_SECRET` from the local `.env` |
| `SPOTIFY_REFRESH_TOKEN` | `SPOTIFY_REFRESH_TOKEN` from the local `.env` |

The shared password from the original plan is not implemented yet (deferred by Sam). Rate limiting is in place.

## Submit flow

1. Rate limit: 10 attempts per IP per hour, counted in a small DynamoDB table with TTL.
2. Email is optional and only collected (and validated) when the digest box is ticked.
3. Parse the playlist ID from the pasted link, refresh the Spotify access token, read the playlist.
3. Reject if unreadable (not a collaborator), empty, or over 11 songs. Spotify 429s are retried honouring Retry-After within a 20 second budget.
4. Add the songs to the master playlist, then save the entry.

## Local commands

```
npm install
npm run typecheck          # frontend + amplify backend
npm run get-refresh-token  # one-time; prints the consent URL, then run again with the redirect URL
```
