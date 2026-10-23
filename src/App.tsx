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
  deletedAt: string | null;
};

type Action = 'rename' | 'delete' | 'restore';

const dateFormat = new Intl.DateTimeFormat('en-CA', { month: 'short', day: 'numeric', year: 'numeric' });

// Edit keys live only in the browser that submitted the entry.
const editKey = (id: string) => `bir-edit-${id}`;
function loadEditToken(id: string): string | null {
  try {
    return localStorage.getItem(editKey(id));
  } catch {
    return null;
  }
}
function saveEditToken(id: string, token: string) {
  try {
    localStorage.setItem(editKey(id), token);
  } catch {
    // private mode or storage blocked; editing just won't be offered
  }
}

async function manage(entry: EntryCard, action: Action, name?: string): Promise<EntryCard> {
  const token = loadEditToken(entry.id);
  if (!token) throw new Error('Only the browser that submitted this playlist can change it.');
  const { data, errors } = await client.mutations.manageEntry({ id: entry.id, editToken: token, action, name });
  if (!data) throw new Error(errors?.[0]?.message ?? 'Could not save. Try again.');
  return {
    id: data.id,
    name: data.name,
    playlistId: data.playlistId,
    trackCount: data.trackCount,
    addedAt: data.addedAt,
    deletedAt: data.deletedAt ?? null,
  };
}

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

function CopyName() {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(SPOTIFY_OWNER_NAME);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      window.prompt('Copy this name:', SPOTIFY_OWNER_NAME);
    }
  }
  return (
    <button type="button" className="copy" onClick={copy} title="Copy to clipboard">
      {SPOTIFY_OWNER_NAME}
      <span className="copy-state">{copied ? 'Copied!' : 'Copy'}</span>
    </button>
  );
}

// "Type the word to confirm" control used for delete and restore.
function ConfirmWord({
  word,
  label,
  danger,
  onConfirm,
  onCancel,
}: {
  word: string;
  label: string;
  danger?: boolean;
  onConfirm: () => Promise<void>;
  onCancel: () => void;
}) {
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready = typed.trim().toLowerCase() === word;

  async function go(e: FormEvent) {
    e.preventDefault();
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Try again.');
      setBusy(false);
    }
  }

  return (
    <form className="confirm" onSubmit={go}>
      <label>
        Type <strong>{word}</strong> to confirm
        <input value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus autoComplete="off" spellCheck={false} />
      </label>
      <div className="rename-actions">
        <button type="submit" className={`small${danger ? ' danger' : ''}`} disabled={!ready || busy}>
          {busy ? 'Working…' : label}
        </button>
        <button type="button" className="small ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </div>
      {error && <p className="alert error">{error}</p>}
    </form>
  );
}

function EntryHeader({ entry, onChanged }: { entry: EntryCard; onChanged: (updated: EntryCard) => void }) {
  const mine = loadEditToken(entry.id) !== null;
  const [mode, setMode] = useState<'view' | 'rename' | 'delete'>('view');
  const [draft, setDraft] = useState(entry.name);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setMode('view');
    setDraft(entry.name);
    setError(null);
  }

  async function saveName(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      onChanged(await manage(entry, 'rename', draft));
      setMode('view');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not save. Try again.');
    } finally {
      setSaving(false);
    }
  }

  if (mode === 'rename') {
    return (
      <form className="entry-head rename" onSubmit={saveName}>
        <input value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={60} required autoFocus aria-label="Name" />
        <div className="rename-actions">
          <button type="submit" className="small" disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button type="button" className="small ghost" onClick={reset}>
            Cancel
          </button>
        </div>
        {error && <p className="alert error">{error}</p>}
      </form>
    );
  }

  if (mode === 'delete') {
    return (
      <div className="entry-head">
        <h3>{entry.name}</h3>
        <p className="meta">This removes your songs from the master playlist. You can restore it later.</p>
        <ConfirmWord
          word="delete"
          label="Delete playlist"
          danger
          onConfirm={async () => onChanged(await manage(entry, 'delete'))}
          onCancel={reset}
        />
      </div>
    );
  }

  return (
    <div className="entry-head">
      <h3>
        {entry.name}
        {mine && (
          <span className="owner-actions">
            <button type="button" className="link" onClick={() => setMode('rename')}>
              Edit name
            </button>
            <button type="button" className="link" onClick={() => setMode('delete')}>
              Delete
            </button>
          </span>
        )}
      </h3>
      <p className="meta">
        {entry.trackCount} song{entry.trackCount === 1 ? '' : 's'} · {dateFormat.format(new Date(entry.addedAt))}
      </p>
    </div>
  );
}

function DeletedEntry({ entry, onChanged }: { entry: EntryCard; onChanged: (updated: EntryCard) => void }) {
  const [confirming, setConfirming] = useState(false);
  return (
    <li className="deleted-item">
      <div>
        <strong>{entry.name}</strong>
        <span className="meta">
          {' '}
          · {entry.trackCount} song{entry.trackCount === 1 ? '' : 's'} · deleted{' '}
          {entry.deletedAt ? dateFormat.format(new Date(entry.deletedAt)) : ''}
        </span>
      </div>
      {confirming ? (
        <ConfirmWord
          word="restore"
          label="Restore playlist"
          onConfirm={async () => onChanged(await manage(entry, 'restore'))}
          onCancel={() => setConfirming(false)}
        />
      ) : (
        <button type="button" className="small ghost" onClick={() => setConfirming(true)}>
          Restore
        </button>
      )}
    </li>
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
        selectionSet: ['id', 'name', 'playlistId', 'trackCount', 'addedAt', 'deletedAt'],
        limit: 500,
      });
      if (errors?.length) throw new Error(errors[0].message);
      setEntries(
        data
          .map((e) => ({ ...e, deletedAt: e.deletedAt ?? null }))
          .sort((a, b) => b.addedAt.localeCompare(a.addedAt)),
      );
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
      const { data, errors } = await client.mutations.submitPlaylist({
        name,
        email: digestOptIn ? email : undefined,
        playlistUrl,
        digestOptIn,
      });
      if (!data) throw new Error(errors?.[0]?.message ?? 'Something went wrong. Try again.');
      if (data.editToken) saveEditToken(data.id, data.editToken);
      setEntries((prev) => [{ ...data, deletedAt: null }, ...(prev ?? [])]);
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

  function onChanged(updated: EntryCard) {
    setEntries((prev) => (prev ?? []).map((e) => (e.id === updated.id ? { ...e, ...updated } : e)));
  }

  const active = entries?.filter((e) => !e.deletedAt) ?? null;
  const myDeleted = entries?.filter((e) => e.deletedAt && loadEditToken(e.id) !== null) ?? [];

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
        <p className="lede">
          Pick up to {MAX_TRACKS} songs. Your playlist gets its own card below, and the songs are added to the master
          playlist automatically.
        </p>
        <ol className="steps">
          <li>
            <strong>Make a playlist in Spotify</strong> with up to {MAX_TRACKS} songs.
          </li>
          <li>
            <strong>Invite <CopyName /> to it.</strong> Open the playlist, tap the three dots, choose{' '}
            <em>Invite collaborators</em>, and send the invite link to Sam. Spotify only lets this site read playlists
            it has been invited to. It is a one-time thing per playlist, and nobody else can edit yours.
          </li>
          <li>
            <strong>Paste the link below.</strong> Tap <em>Share</em>, then <em>Copy link to playlist</em>.
          </li>
        </ol>
        <form onSubmit={onSubmit}>
          <div className="row">
            <label>
              Your name
              <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} required autoComplete="name" />
            </label>
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
          </div>
          <label className="check">
            <input type="checkbox" checked={digestOptIn} onChange={(e) => setDigestOptIn(e.target.checked)} />
            Email me on Mondays with what's new (optional)
          </label>
          {digestOptIn && (
            <label>
              Email
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                autoFocus
              />
            </label>
          )}
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
          <p className="hint">Not working? Make sure Sam has accepted your invite first.</p>
        </form>
      </section>

      <section className="entries">
        <div className="card-head">
          <h2>Everyone's playlists</h2>
          {active && <span className="count">{active.length}</span>}
        </div>
        {loadError && <p className="alert error">{loadError}</p>}
        {!loadError && entries === null && <p className="muted">Loading…</p>}
        {active?.length === 0 && (
          <p className="muted">
            No playlists yet. <a href="#submit">Be the first.</a>
          </p>
        )}
        <div className="grid">
          {active?.map((entry) => (
            <article className="card entry" key={entry.id}>
              <EntryHeader entry={entry} onChanged={onChanged} />
              <SpotifyEmbed playlistId={entry.playlistId} title={`${entry.name}'s playlist`} height={352} />
            </article>
          ))}
        </div>
      </section>

      {myDeleted.length > 0 && (
        <section className="card deleted">
          <h2>Your deleted playlists</h2>
          <p className="lede">Only you can see these. Restoring puts the songs back in the master playlist.</p>
          <ul className="deleted-list">
            {myDeleted.map((entry) => (
              <DeletedEntry key={entry.id} entry={entry} onChanged={onChanged} />
            ))}
          </ul>
        </section>
      )}

      <footer>
        <p>Made for the BIR office. Not affiliated with Spotify.</p>
      </footer>
    </div>
  );
}
