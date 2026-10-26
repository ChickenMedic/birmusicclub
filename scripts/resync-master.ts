// Admin tool: make the master playlist match exactly the songs of the active (non-deleted)
// entries on the site, with each song once. Use it after test submissions, failed deletes,
// or manual edits in Spotify.
//
//   npx tsx scripts/resync-master.ts            # dry run: report what would change
//   npx tsx scripts/resync-master.ts --apply    # remove orphans and duplicates, add missing
//
// Reads entries from the live site's public API as a guest (same as the browser does) and
// each entry's playlist from Spotify with the credentials in .env. Removals are done by
// position so the first occurrence of every song keeps its place in the playlist.

import { Amplify } from 'aws-amplify';
import { generateClient } from 'aws-amplify/data';
import type { Schema } from '../amplify/data/resource';
import { MASTER_PLAYLIST_ID } from '../config';
import { addableUris, addToMasterPlaylist, fetchPlaylistItems, refreshSpotifyToken, spotifyFetch } from '../amplify/spotify';

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

// Every song an active entry contributes, with who contributed it.
const wanted = new Map<string, string[]>();
for (const entry of active) {
  let uris: string[];
  try {
    uris = addableUris(await fetchPlaylistItems(token, entry.playlistId));
  } catch (err) {
    console.log(`  ! ${entry.name}: ${(err as Error).message}`);
    continue;
  }
  console.log(`  ${entry.name}: ${uris.length} songs`);
  for (const uri of uris) wanted.set(uri, [...(wanted.get(uri) ?? []), entry.name]);
}

let master = await fetchMaster(token);
console.log(`master playlist: ${master.rows.length} rows`);

const plan = removalPlan(master.rows);
const missing = [...wanted.keys()].filter((uri) => !master.rows.some((r) => r.uri === uri));

console.log(`\n${plan.orphans.length} songs in master that no active entry has`);
for (const uri of plan.orphans) console.log(`  - ${uri}`);
console.log(`${plan.duplicateRows} duplicate rows in master`);
console.log(`${missing.length} songs from active entries missing in master`);
for (const uri of missing) console.log(`  + ${uri}  (${wanted.get(uri)!.join(', ')})`);

if (!apply) {
  console.log('\nDry run. Re-run with --apply to make these changes.');
} else {
  let removed = 0;
  // Each DELETE is validated against one snapshot, so remove up to 100 rows, refetch, repeat.
  for (;;) {
    const items = removalPlan(master.rows).items.slice(0, 100);
    if (items.length === 0) break;
    const res = await spotifyFetch(`https://api.spotify.com/v1/playlists/${MASTER_PLAYLIST_ID}/items`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ items, snapshot_id: master.snapshot }),
    });
    if (!res.ok) throw new Error(`Remove failed: ${res.status} ${await res.text()}`);
    removed += items.reduce((n, i) => n + i.positions.length, 0);
    master = await fetchMaster(token);
  }
  if (missing.length > 0) await addToMasterPlaylist(token, missing);
  console.log(`\nDone: removed ${removed} rows, added ${missing.length}. Master now has ${master.rows.length + missing.length} rows.`);
}

type Row = { uri: string; position: number };

// Rows to delete: every row of an orphan song, and every row after the first of a wanted song.
function removalPlan(rows: Row[]) {
  const seen = new Set<string>();
  const positions = new Map<string, number[]>();
  let duplicateRows = 0;
  for (const row of rows) {
    const orphan = !wanted.has(row.uri);
    const dup = seen.has(row.uri);
    seen.add(row.uri);
    if (!orphan && !dup) continue;
    if (dup && !orphan) duplicateRows++;
    positions.set(row.uri, [...(positions.get(row.uri) ?? []), row.position]);
  }
  return {
    orphans: [...seen].filter((uri) => !wanted.has(uri)),
    duplicateRows,
    items: [...positions].map(([uri, p]) => ({ uri, positions: p })),
  };
}

async function fetchMaster(accessToken: string): Promise<{ snapshot: string; rows: Row[] }> {
  const meta = await spotifyFetch(`https://api.spotify.com/v1/playlists/${MASTER_PLAYLIST_ID}?fields=snapshot_id`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!meta.ok) throw new Error(`Could not read master playlist: ${meta.status} ${await meta.text()}`);
  const { snapshot_id } = (await meta.json()) as { snapshot_id: string };

  const rows: Row[] = [];
  let position = 0;
  let url: string | null = `https://api.spotify.com/v1/playlists/${MASTER_PLAYLIST_ID}/items?${new URLSearchParams({
    fields: 'next,items(is_local,item(uri,type))',
    limit: '100',
  })}`;
  while (url) {
    const res = await spotifyFetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!res.ok) throw new Error(`Could not read master playlist: ${res.status} ${await res.text()}`);
    const page = (await res.json()) as { next: string | null; items: Array<{ is_local: boolean; item: { uri: string; type: string } | null }> };
    for (const item of page.items) {
      // Positions count every row, including local files we can never remove by URI.
      if (!item.is_local && item.item) rows.push({ uri: item.item.uri, position });
      position++;
    }
    url = page.next;
  }
  return { snapshot: snapshot_id, rows };
}
