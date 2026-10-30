# BIR Master Mix

Coworkers share Spotify playlists (max 11 songs each) and the songs get added to a master playlist. See PLAN.md.

## Stack

- Amplify Gen 2 (TypeScript) on AWS: AppSync data API over DynamoDB, Lambdas, SES, EventBridge.
- Vite + React frontend hosted on Amplify Hosting at https://birmastermix.com (formerly birmusicclub.com).
- Public site reads the `Entry` model as a guest through the Cognito identity pool. Nobody signs in; the user pool is admin-create-only.
- Entries are created by the `submitPlaylist` mutation (`amplify/submit-playlist/handler.ts`). The card is saved first; getting its songs into the master playlist is a separate step (`amplify/sync.ts`) that only works once the playlist owner has invited ChickenMed to collaborate. Until then the entry has no `syncedAt` and `sync-pending` (scheduled once a day) retries it; a "Check now" button on the card does the same on demand. Once an entry is in the master playlist the same schedule re-reads its playlist and follows any changes: songs the owner removed come out of the master playlist (unless another active entry also has them) and songs they added go in (unless already there from someone else). An "Update song list" link on the card does that on demand. A playlist that grows over the limit or is emptied puts its changes on hold (`syncError`, shown on the card) and leaves the master playlist as it was until it passes again. It returns a per-entry `editToken` that the submitting browser keeps in localStorage.
- `manageEntry` (`amplify/manage-entry/handler.ts`) renames (anyone), syncs (anyone), soft-deletes or restores an entry (that token, or the `ADMIN_KEY` secret entered via the footer's Admin link). Delete removes the entry's songs from the master playlist and restore adds them back, skipping any song another active entry also contributed. Deleted entries keep their record (`deletedAt`) so restore is trivial.
- The hero shows four counters: playlists, songs in the mix (each song once, as the master playlist holds it), duplicate songs (picked by more than one person) and visits. The first three are computed in the browser from the public `trackUris` on each entry. Visits come from `siteStats` (`amplify/site-stats/handler.ts`): the `recordVisit` mutation adds one to a row in the RateLimitTable and the `siteStats` query reads it; the browser calls `recordVisit` once per tab session (sessionStorage) and the query on later reloads.
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
| `ADMIN_KEY`             | Any passphrase. Optional: lets Sam delete/restore anyone's entry after entering it via the site footer's Admin link. |

These must be **Secrets**, not Environment variables, and must be on the same Amplify app and branch that serves the site. If a secret is missing, Amplify leaves the text `<value will be resolved during runtime>` in the env var; the Lambdas detect that and name the missing secrets in the error. After adding or changing a secret, redeploy the branch.

The shared password from the original plan is not implemented yet (deferred by Sam). Rate limiting is in place.

## Submit flow

1. Rate limit: 10 attempts per IP per hour, counted in a small DynamoDB table with TTL.
2. Email is optional and only collected (and validated) when the digest box is ticked.
3. Parse the playlist ID from the pasted link and save the entry (`trackCount` 0, no `syncedAt`).
4. Try to sync: refresh the Spotify access token and read the playlist. Unreadable (not a collaborator yet) leaves it pending; empty or over the limit records `syncError` on the entry (shown on the card, retried daily); otherwise insert each song at a random position in the master playlist (so it stays shuffled as it grows) and set `syncedAt`. Spotify 429s are retried honouring Retry-After within a 20 second budget; a longer back-off is recorded in the RateLimitTable and every Lambda skips Spotify until it ends.

## Local commands

```
npm install
npm run typecheck          # frontend + amplify backend
npm run get-refresh-token  # one-time; prints the consent URL, then run again with the redirect URL
npm run resync-master      # dry run: compare the master playlist with active entries
npm run resync-master -- --apply  # remove orphan/duplicate songs, add missing ones
npm run resync-master -- --apply --shuffle  # rebuild the master playlist in random order
```
