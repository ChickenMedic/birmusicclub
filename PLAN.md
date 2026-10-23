# BIR Music Club — Plan

Small site at https://birmusicclub.com where coworkers share Spotify playlists (max 11 songs each), plus a master playlist on Sam's account. Hosted on personal AWS with Amplify Gen 2 (TypeScript). Work in phases; stop for review after each one. Keep it minimal, no extra features. No local test harness: test in prod.

## Phase 0
One-time script (`scripts/get-refresh-token.ts`) that runs the Spotify Authorization Code flow with redirect `https://birmusicclub.com/callback` and prints the refresh token for Sam's account.

## Phase 1
Scaffold Amplify Gen 2. DynamoDB model for entries (name, email, playlistUrl, playlistId, trackCount, digestOptIn, addedAt). Secrets (Spotify client ID/secret, refresh token, bcrypt hash of the shared password) come from SSM Parameter Store, never the frontend.

## Phase 2
Submit Lambda behind a custom mutation: verify password, rate limit by IP, parse playlist ID, refresh Spotify token, reject if over 11 tracks, save entry, add tracks to the master playlist. Honour Retry-After on 429.

## Phase 3
Frontend: master playlist embed at top, grid of Spotify embed iframes, submit form with digest opt-in checkbox, clear error messages.

## Phase 4
Weekly digest Lambda on an EventBridge schedule (Mondays 8am America/Edmonton). Emails opted-in users via SES listing people added in the last 7 days. Skip if none. Include an unsubscribe link.
