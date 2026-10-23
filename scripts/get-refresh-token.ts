// One-time setup: get a Spotify refresh token for the account that owns the master playlist.
//
// Step 1:  node scripts/get-refresh-token.ts
//          Prints the Spotify consent URL (and tries to open it). Approve in the browser.
//          Spotify redirects to https://birmusicclub.com/callback?code=... (that page need not exist).
// Step 2:  node scripts/get-refresh-token.ts "<the full URL you were redirected to>"
//          Exchanges the code and prints the refresh token.
//
// Env: SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET (required; read from .env if present)
// The Spotify app must have exactly this redirect URI registered: https://birmusicclub.com/callback

import { exec } from 'node:child_process';

try {
  process.loadEnvFile('.env');
} catch {
  // no .env file; rely on the environment
}

const REDIRECT_URI = 'https://birmusicclub.com/callback';
// The submit Lambda reads submitted playlists and adds tracks to the master playlist.
const SCOPES = [
  'playlist-read-private',
  'playlist-read-collaborative',
  'playlist-modify-public',
  'playlist-modify-private',
].join(' ');

const clientId = process.env.SPOTIFY_CLIENT_ID;
const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
if (!clientId || !clientSecret) {
  console.error('Set SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET (in the environment or a .env file).');
  process.exit(1);
}

const redirectedUrl = process.argv[2];

function printAuthUrl(): void {
  const authUrl = new URL('https://accounts.spotify.com/authorize');
  authUrl.search = new URLSearchParams({
    client_id: clientId as string,
    response_type: 'code',
    redirect_uri: REDIRECT_URI,
    scope: SCOPES,
  }).toString();
  console.log('Open this URL, approve, then run this script again with the URL you land on:\n');
  console.log(authUrl.toString());
  const cmd =
    process.platform === 'win32' ? `start "" "${authUrl}"`
    : process.platform === 'darwin' ? `open "${authUrl}"`
    : `xdg-open "${authUrl}"`;
  exec(cmd, () => undefined);
}

async function exchangeCode(pasted: string): Promise<void> {
  let redirected: URL;
  try {
    redirected = new URL(pasted.trim());
  } catch {
    throw new Error('That is not a URL. Pass the whole address bar contents, starting with https://');
  }
  const error = redirected.searchParams.get('error');
  const code = redirected.searchParams.get('code');
  if (error) throw new Error(`Spotify returned an error: ${error}`);
  if (!code) throw new Error('No code parameter in that URL.');

  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT_URI }),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`Token request failed (HTTP ${res.status}): ${body}`);
  const token = JSON.parse(body) as { refresh_token: string; scope: string };

  console.log('Refresh token (keep secret; store it as the SPOTIFY_REFRESH_TOKEN secret in Amplify):');
  console.log(token.refresh_token);
  console.log('Granted scopes: ' + token.scope);
}

// Avoid process.exit() after fetch: on Windows, Node 24 can abort if exit races an in-flight fetch teardown.
if (redirectedUrl) {
  exchangeCode(redirectedUrl).catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
} else {
  printAuthUrl();
}
