// Admin tool: make the master playlist match exactly the songs of the active (non-deleted)
// entries on the site, with each song once. Use it after test submissions, failed deletes,
// or manual edits in Spotify.
//
//   npm run resync-master              # dry run: report what would change
//   npm run resync-master -- --apply   # remove orphans and duplicates, add missing
//
// Reads entries from the live site's public API as a guest (same as the browser does) and
// each entry's playlist from Spotify with the credentials in .env.
//
// Spotify's remove-by-URI deletes every copy of a song (it ignored per-position removal when
// we tried it), so duplicates are fixed by removing the song and adding it back once. Those
// songs move to the end of the playlist.

import { Amplify } from 'aws-amplify';
import { generateClient } from 'aws-amplify/data';
import type { Schema } from '../amplify/data/resource';
import { MASTER_PLAYLIST_ID } from '../config';
import { addableUris, addToMasterPlaylist, fetchPlaylistItems, refreshSpotifyToken, removeFromMasterPlaylist, spotifyFetch } from '../amplify/spotify';

const SITE = 'https://birmastermix.com';
const apply = process.argv.includes('--apply');

try {
  process.loadEnvFile('.env');
} catch {
  // rely on the environment
}

const outputs = await (await fetch(`${SITE}/amplify_outputs.json`)).json();
Amplify.configure(outputs);
const client = generateClient<Schema>({ authMode: 'identityPool' });

const { data: entries, errors } = await client.models.Entry.list({
  selectionSet: ['id', 'name', 'playlistId', 'trackCount', 'deletedAt'],
  limit: 500,
});
if (errors?.length) throw new Error(errors[0].message);
const active = entries.filter((e) => !e.deletedAt);
console.log(`${entries.length} entries, ${active.length} active`);

const token = await refreshSpotifyToken();

// Every song an active entry contributes, with who contributed it. If any playlist cannot be
// read we stop: otherwise its songs would look like orphans and get removed.
const wanted = new Map<string, string[]>();
for (const entry of active) {
  const uris = addableUris(await fetchPlaylistItems(token, entry.playlistId));
  console.log(`  ${entry.name}: ${uris.length} songs`);
  for (const uri of uris) wanted.set(uri, [...(wanted.get(uri) ?? []), entry.name]);
}

const have = await fetchAllMasterUris(token);
console.log(`master playlist: ${have.length} rows`);

const counts = new Map<string, number>();
for (const uri of have) counts.set(uri, (counts.get(uri) ?? 0) + 1);
const orphans = [...counts.keys()].filter((uri) => !wanted.has(uri));
const duplicated = [...counts].filter(([uri, n]) => n > 1 && wanted.has(uri)).map(([uri]) => uri);
const missing = [...wanted.keys()].filter((uri) => !counts.has(uri));

console.log(`\n${orphans.length} songs in master that no active entry has`);
for (const uri of orphans) console.log(`  - ${uri}`);
console.log(`${duplicated.length} songs in master more than once (will be removed and re-added once)`);
console.log(`${missing.length} songs from active entries missing in master`);
for (const uri of missing) console.log(`  + ${uri}  (${wanted.get(uri)!.join(', ')})`);

if (!apply) {
  console.log('\nDry run. Re-run with --apply to make these changes.');
} else {
  const toRemove = [...orphans, ...duplicated];
  const toAdd = [...duplicated, ...missing];
  if (toRemove.length > 0) await removeFromMasterPlaylist(token, toRemove);
  if (toAdd.length > 0) await addToMasterPlaylist(token, toAdd);
  const after = await fetchAllMasterUris(token);
  console.log(`\nDone: removed ${toRemove.length} songs (all copies), added ${toAdd.length}. Master now has ${after.length} rows, ${new Set(after).size} unique.`);
}

async function fetchAllMasterUris(accessToken: string): Promise<string[]> {
  const uris: string[] = [];
  let url: string | null = `https://api.spotify.com/v1/playlists/${MASTER_PLAYLIST_ID}/items?${new URLSearchParams({
    fields: 'next,items(is_local,item(uri,type))',
    limit: '100',
  })}`;
  while (url) {
    const res = await spotifyFetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!res.ok) throw new Error(`Could not read master playlist: ${res.status} ${await res.text()}`);
    const page = (await res.json()) as { next: string | null; items: Array<{ is_local: boolean; item: { uri: string; type: string } | null }> };
    uris.push(...addableUris({ total: 0, items: page.items }));
    url = page.next;
  }
  return uris;
}
