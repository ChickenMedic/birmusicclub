// One-time setup: get a Spotify refresh token for the account that owns the master playlist.
//
// Usage:   node scripts/get-refresh-token.ts
// Env:     SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET   (required; read from .env if present)
//
// Flow: the script opens Spotify's consent screen. Spotify then redirects the browser to
// https://birmusicclub.com/callback?code=...&state=... (the page itself does not need to exist).
// Copy the full URL from the address bar, paste it here, and the script prints the refresh token.
//
// The Spotify app must have exactly this redirect URI registered: https://birmusicclub.com/callback

import { randomBytes } from 'node:crypto';
import { exec } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

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

function openBrowser(url: string): void {
  const cmd =
    process.platform === 'win32' ? `start "" "${url}"`
    : process.platform === 'darwin' ? `open "${url}"`
    : `xdg-open "${url}"`;
  exec(cmd, () => undefined);
}

async function main(): Promise<void> {
  const state = randomBytes(16).toString('hex');
  const authUrl = new URL('https://accounts.spotify.com/authorize');
  authUrl.search = new URLSearchParams({
    client_id: clientId as string,
    response_type: 'code',
    redirect_uri: REDIRECT_URI,
    scope: SCOPES,
    state,
  }).toString();

  console.log('Opening the Spotify login in your browser. If it does not open, visit:\n' + authUrl.toString() + '\n');
  openBrowser(authUrl.toString());

  const rl = createInterface({ input: stdin, output: stdout });
  const pasted = (await rl.question('After approving, paste the full URL you were redirected to: ')).trim();
  rl.close();

  let redirected: URL;
  try {
    redirected = new URL(pasted);
  } catch {
    throw new Error('That is not a URL. Paste the whole address bar contents, starting with https://');
  }
  const error = redirected.searchParams.get('error');
  const code = redirected.searchParams.get('code');
  if (error) throw new Error(`Spotify returned an error: ${error}`);
  if (!code) throw new Error('No code parameter in that URL.');
  if (redirected.searchParams.get('state') !== state) throw new Error('State mismatch: use the URL from this run, not an older one.');

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

  console.log('\nRefresh token (keep secret; store it as the SPOTIFY_REFRESH_TOKEN secret in Amplify):');
  console.log(token.refresh_token);
  console.log('Granted scopes: ' + token.scope);
}

// Avoid process.exit() here: on Windows, Node 24 can abort if exit races an in-flight fetch teardown.
main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
