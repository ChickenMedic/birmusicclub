import { useEffect, useState, type FormEvent } from 'react';
import { generateClient } from 'aws-amplify/data';
import type { Schema } from '../amplify/data/resource';
import { MASTER_PLAYLIST_ID, MAX_TRACKS, SPOTIFY_OWNER_NAME } from '../config';

const client = generateClient<Schema>({ authMode: 'identityPool' });

type EntryCard = {
  id: string;
  name: string;
  playlistId: string;
  trackCount: number;
  addedAt: string;
};

const dateFormat = new Intl.DateTimeFormat('en-CA', { month: 'short', day: 'numeric', year: 'numeric' });

function SpotifyEmbed({ playlistId, title, height }: { playlistId: string; title: string; height: number }) {
  return (
    <iframe
      title={title}
      src={`https://open.spotify.com/embed/playlist/${playlistId}?utm_source=generator&theme=0`}
      width="100%"
      height={height}
      frameBorder="0"
      allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
      loading="lazy"
    />
  );
}

export default function App() {
  const [entries, setEntries] = useState<EntryCard[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [playlistUrl, setPlaylistUrl] = useState('');
  const [digestOptIn, setDigestOptIn] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitSuccess, setSubmitSuccess] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      const { data, errors } = await client.models.Entry.list({
        selectionSet: ['id', 'name', 'playlistId', 'trackCount', 'addedAt'],
        limit: 500,
      });
      if (errors?.length) throw new Error(errors[0].message);
      setEntries([...data].sort((a, b) => b.addedAt.localeCompare(a.addedAt)));
    }
    load().catch((err: unknown) => {
      console.error(err);
      setLoadError('Could not load the playlists. Try refreshing.');
    });
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitError(null);
    setSubmitSuccess(null);
    setSubmitting(true);
    try {
      const { data, errors } = await client.mutations.submitPlaylist({ name, email, playlistUrl, digestOptIn });
      if (!data) throw new Error(errors?.[0]?.message ?? 'Something went wrong. Try again.');
      setEntries((prev) => [data, ...(prev ?? [])]);
      setSubmitSuccess(`Added! Your ${data.trackCount} song${data.trackCount === 1 ? '' : 's'} are now in the master playlist.`);
      setName('');
      setEmail('');
      setPlaylistUrl('');
      setDigestOptIn(false);
    } catch (err: unknown) {
      setSubmitError(err instanceof Error ? err.message : 'Something went wrong. Try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="page">
      <header className="hero">
        <p className="eyebrow">Office playlist exchange</p>
        <h1>BIR Music Club</h1>
        <p className="tagline">
          Everyone picks {MAX_TRACKS} songs. They all land in one master playlist.
        </p>
      </header>

      <section className="card master">
        <div className="card-head">
          <h2>The master playlist</h2>
          <a href={`https://open.spotify.com/playlist/${MASTER_PLAYLIST_ID}`} target="_blank" rel="noreferrer">
            Open in Spotify
          </a>
        </div>
        <SpotifyEmbed playlistId={MASTER_PLAYLIST_ID} title="BIR Music Club master playlist" height={380} />
      </section>

      <section className="card submit" id="submit">
        <h2>Add your playlist</h2>
        <ol className="steps">
          <li>In Spotify, make a playlist with up to {MAX_TRACKS} songs.</li>
          <li>
            Open it, tap the three dots, choose <strong>Invite collaborators</strong>, and add{' '}
            <strong>{SPOTIFY_OWNER_NAME}</strong>. Spotify only lets this site read playlists it has been invited to.
          </li>
          <li>
            Tap <strong>Share</strong>, <strong>Copy link to playlist</strong>, and paste it below.
          </li>
        </ol>
        <form onSubmit={onSubmit}>
          <div className="row">
            <label>
              Your name
              <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} required autoComplete="name" />
            </label>
            <label>
              Email
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
            </label>
          </div>
          <label>
            Playlist link
            <input
              value={playlistUrl}
              onChange={(e) => setPlaylistUrl(e.target.value)}
              placeholder="https://open.spotify.com/playlist/..."
              required
              inputMode="url"
            />
          </label>
          <label className="check">
            <input type="checkbox" checked={digestOptIn} onChange={(e) => setDigestOptIn(e.target.checked)} />
            Email me a weekly digest of new playlists
          </label>
          {submitError && (
            <p className="alert error" role="alert">
              {submitError}
            </p>
          )}
          {submitSuccess && (
            <p className="alert success" role="status">
              {submitSuccess}
            </p>
          )}
          <button type="submit" disabled={submitting}>
            {submitting ? 'Checking with Spotify…' : 'Add my playlist'}
          </button>
        </form>
      </section>

      <section className="entries">
        <div className="card-head">
          <h2>Everyone's playlists</h2>
          {entries && <span className="count">{entries.length}</span>}
        </div>
        {loadError && <p className="alert error">{loadError}</p>}
        {!loadError && entries === null && <p className="muted">Loading…</p>}
        {entries?.length === 0 && (
          <p className="muted">
            No playlists yet. <a href="#submit">Be the first.</a>
          </p>
        )}
        <div className="grid">
          {entries?.map((entry) => (
            <article className="card entry" key={entry.id}>
              <div className="entry-head">
                <h3>{entry.name}</h3>
                <p className="meta">
                  {entry.trackCount} song{entry.trackCount === 1 ? '' : 's'} · {dateFormat.format(new Date(entry.addedAt))}
                </p>
              </div>
              <SpotifyEmbed playlistId={entry.playlistId} title={`${entry.name}'s playlist`} height={352} />
            </article>
          ))}
        </div>
      </section>

      <footer>
        <p>Made for the BIR office. Not affiliated with Spotify.</p>
      </footer>
    </div>
  );
}
