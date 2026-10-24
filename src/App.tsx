import { useEffect, useState, type CSSProperties, type FormEvent } from 'react';
import { generateClient } from 'aws-amplify/data';
import type { Schema } from '../amplify/data/resource';
import { isFounder, MASTER_PLAYLIST_ID, MAX_TRACKS, SPOTIFY_OWNER_NAME } from '../config';

const client = generateClient<Schema>({ authMode: 'identityPool' });

type EntryCard = {
  id: string;
  name: string;
  playlistId: string;
  trackCount: number;
  addedAt: string;
  deletedAt: string | null;
  claimed: boolean;
};

type Action = 'rename' | 'delete' | 'restore' | 'claim';

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
  if (!token && action !== 'claim') throw new Error('Only the browser that submitted this playlist can change it.');
  const { data, errors } = await client.mutations.manageEntry({ id: entry.id, editToken: token ?? undefined, action, name });
  if (!data) throw new Error(errors?.[0]?.message ?? 'Could not save. Try again.');
  if (action === 'claim' && data.editToken) saveEditToken(data.id, data.editToken);
  return {
    id: data.id,
    name: data.name,
    playlistId: data.playlistId,
    trackCount: data.trackCount,
    addedAt: data.addedAt,
    deletedAt: data.deletedAt ?? null,
    claimed: data.claimed ?? false,
  };
}

// A mirror ball: small tiles laid out on a sphere, each lit by a fixed light so the
// shading reads as 3D, slowly rotating with the odd tile glinting.
const BALL = { cx: 60, cy: 90, r: 54, latStep: 12, lonStep: 12 };
const LIGHT = (() => {
  const v = [-0.45, 0.55, 0.7];
  const len = Math.hypot(...v);
  return v.map((x) => x / len);
})();
const rad = (deg: number) => (deg * Math.PI) / 180;

function sphereTiles(offsetDeg: number) {
  const { cx, cy, r, latStep, lonStep } = BALL;
  const tiles: { key: string; points: string; fill: string }[] = [];
  const phase = Math.floor(offsetDeg / 24);
  for (let lat = -84; lat < 84; lat += latStep) {
    for (let lon0 = 0; lon0 < 360; lon0 += lonStep) {
      const lon = lon0 + offsetDeg;
      const cLat = rad(lat + latStep / 2);
      const cLon = rad(lon + lonStep / 2);
      const n = [Math.cos(cLat) * Math.sin(cLon), Math.sin(cLat), Math.cos(cLat) * Math.cos(cLon)];
      if (n[2] <= 0.03) continue; // back of the ball
      const gap = 0.14;
      const corners: [number, number][] = [
        [lat + latStep * gap, lon + lonStep * gap],
        [lat + latStep * (1 - gap), lon + lonStep * gap],
        [lat + latStep * (1 - gap), lon + lonStep * (1 - gap)],
        [lat + latStep * gap, lon + lonStep * (1 - gap)],
      ];
      const points = corners
        .map(([la, lo]) => `${(cx + r * Math.cos(rad(la)) * Math.sin(rad(lo))).toFixed(1)},${(cy - r * Math.sin(rad(la))).toFixed(1)}`)
        .join(' ');
      const diffuse = Math.max(0, n[0] * LIGHT[0] + n[1] * LIGHT[1] + n[2] * LIGHT[2]);
      const seed = (lat * 73856093) ^ (lon0 * 19349663) ^ (phase * 83492791);
      const glint = Math.abs(seed) % 9 === 0;
      const lightness = Math.min(100, 30 + diffuse * 52 + (glint ? 28 : 0));
      tiles.push({ key: `${lat}-${lon0}`, points, fill: `hsl(210 ${glint ? 10 : 22}% ${lightness.toFixed(0)}%)` });
    }
  }
  return tiles;
}

// Thin rays that burst out of the ball now and then, as if a spotlight just caught it.
const RAYS: { a: number; len: string; c: string }[] = [
  { a: -160, len: '46vh', c: 'rgba(255,255,255,0.7)' },
  { a: -135, len: '62vh', c: 'rgba(29,185,84,0.8)' },
  { a: -112, len: '38vh', c: 'rgba(255,255,255,0.55)' },
  { a: -88, len: '70vh', c: 'rgba(255,205,80,0.75)' },
  { a: -62, len: '44vh', c: 'rgba(80,230,230,0.7)' },
  { a: -35, len: '66vh', c: 'rgba(255,255,255,0.65)' },
  { a: -12, len: '40vh', c: 'rgba(255,79,216,0.7)' },
  { a: 14, len: '58vh', c: 'rgba(255,255,255,0.6)' },
  { a: 38, len: '48vh', c: 'rgba(84,160,255,0.75)' },
  { a: 64, len: '72vh', c: 'rgba(255,255,255,0.7)' },
  { a: 92, len: '42vh', c: 'rgba(29,185,84,0.7)' },
  { a: 118, len: '60vh', c: 'rgba(255,205,80,0.65)' },
  { a: 142, len: '36vh', c: 'rgba(200,120,255,0.7)' },
  { a: 170, len: '54vh', c: 'rgba(255,255,255,0.6)' },
];

function DiscoBall() {
  const [offset, setOffset] = useState(0);
  useEffect(() => {
    const still =
      window.matchMedia('(prefers-reduced-motion: reduce)').matches || window.matchMedia('(max-width: 700px)').matches;
    if (still) return;
    const id = window.setInterval(() => setOffset((o) => (o + 0.9) % 360), 50);
    return () => window.clearInterval(id);
  }, []);
  const { cx, cy, r } = BALL;
  return (
    <div className="disco-wrap" aria-hidden="true">
      <div className="rays">
        {RAYS.map((ray, i) => (
          <span key={i} className="ray" style={{ '--a': `${ray.a}deg`, '--len': ray.len, '--c': ray.c } as CSSProperties} />
        ))}
      </div>
      <svg className="disco" viewBox="0 0 120 150" width="132" height="165">
        <defs>
          <radialGradient id="disco-shine" cx="36%" cy="30%" r="70%">
            <stop offset="0" stopColor="#ffffff" stopOpacity="0.55" />
            <stop offset="0.4" stopColor="#ffffff" stopOpacity="0" />
            <stop offset="1" stopColor="#000000" stopOpacity="0.5" />
          </radialGradient>
        </defs>
        <line x1={cx} y1="0" x2={cx} y2={cy - r - 4} stroke="#8d99a8" strokeWidth="2" />
        <circle cx={cx} cy={cy - r - 4} r="3" fill="#aab4c0" />
        <circle cx={cx} cy={cy} r={r} fill="#2b323b" />
        {sphereTiles(offset).map((t) => (
          <polygon key={t.key} points={t.points} fill={t.fill} />
        ))}
        <circle cx={cx} cy={cy} r={r} fill="url(#disco-shine)" />
      </svg>
      <span className="sparkle s1">✦</span>
      <span className="sparkle s2">✦</span>
      <span className="sparkle s3">✦</span>
      <span className="sparkle s4">✦</span>
    </div>
  );
}

function Equalizer() {
  return (
    <span className="eq" aria-hidden="true">
      <i />
      <i />
      <i />
      <i />
    </span>
  );
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
    <button type="button" className={`copy${copied ? ' copied' : ''}`} onClick={copy}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {copied ? (
          <path d="M20 6 9 17l-5-5" />
        ) : (
          <>
            <rect x="9" y="9" width="13" height="13" rx="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
          </>
        )}
      </svg>
      {copied ? 'Copied to clipboard' : `Copy "${SPOTIFY_OWNER_NAME}"`}
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
  const [mode, setMode] = useState<'view' | 'rename' | 'delete' | 'claim'>('view');
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

  if (mode === 'claim') {
    return (
      <div className="entry-head">
        <h3>{entry.name}</h3>
        <p className="meta">This gives this browser the key to rename or delete this playlist. Only do it if it's yours.</p>
        <ConfirmWord
          word="mine"
          label="Yes, it's mine"
          onConfirm={async () => {
            onChanged(await manage(entry, 'claim'));
            setMode('view');
          }}
          onCancel={reset}
        />
      </div>
    );
  }

  if (mode === 'delete') {
    return (
      <div className="entry-head">
        <h3>{entry.name}</h3>
        <p className="meta">This removes your songs from the Master Mix. You can restore it later.</p>
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
      <h3>{entry.name}</h3>
      <p className="meta">
        {entry.trackCount} song{entry.trackCount === 1 ? '' : 's'} · {dateFormat.format(new Date(entry.addedAt))}
      </p>
      <div className="owner-actions">
        {mine && (
          <>
            <button type="button" className="link" onClick={() => setMode('rename')}>
              Edit name
            </button>
            <button type="button" className="link" onClick={() => setMode('delete')}>
              Delete
            </button>
          </>
        )}
        {!mine && !entry.claimed && (
          <button type="button" className="link" onClick={() => setMode('claim')}>
            This is my playlist
          </button>
        )}
      </div>
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
        selectionSet: ['id', 'name', 'playlistId', 'trackCount', 'addedAt', 'deletedAt', 'claimed'],
        limit: 500,
      });
      if (errors?.length) throw new Error(errors[0].message);
      setEntries(
        data
          .map((e) => ({ ...e, deletedAt: e.deletedAt ?? null, claimed: e.claimed ?? false }))
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
      setEntries((prev) => [{ ...data, deletedAt: null, claimed: true }, ...(prev ?? [])]);
      setSubmitSuccess(`Added! Your ${data.trackCount} song${data.trackCount === 1 ? '' : 's'} are now in the Master Mix.`);
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
  const totalSongs = active?.reduce((sum, e) => sum + e.trackCount, 0) ?? 0;

  return (
    <div className="page">
      <div className="lights" aria-hidden="true">
        <span className="beam b1" />
        <span className="beam b2" />
        <span className="beam b3" />
        <span className="beam b4" />
        <span className="beam b5" />
        <span className="beam b6" />
        <span className="beam b7" />
        <span className="beam b8" />
        <span className="beam b9" />
        <span className="beam b10" />
      </div>
      <header className="hero">
        <DiscoBall />
        <h1>BIR Music Club</h1>
        <p className="eyebrow">
          <Equalizer />
          BIR Master Mix
          <Equalizer />
        </p>
        <p className="tagline">
          Everyone picks {MAX_TRACKS} songs. They all land in one Master Mix.
        </p>
        <p className="stats">
          {active && active.length > 0
            ? `${active.length} playlist${active.length === 1 ? '' : 's'} · ${totalSongs} song${totalSongs === 1 ? '' : 's'} in the mix`
            : ' '}
        </p>
      </header>

      <section className="card master">
        <div className="card-head">
          <h2>The Master Mix</h2>
          <a href={`https://open.spotify.com/playlist/${MASTER_PLAYLIST_ID}`} target="_blank" rel="noreferrer">
            Open in Spotify
          </a>
        </div>
        <SpotifyEmbed playlistId={MASTER_PLAYLIST_ID} title="BIR Master Mix" height={720} />
        <p className="hint embed-fallback">
          Player not loading?{' '}
          <a href={`https://open.spotify.com/playlist/${MASTER_PLAYLIST_ID}`} target="_blank" rel="noreferrer">
            Open the Master Mix in Spotify
          </a>
          .
        </p>
      </section>

      <section className="card submit" id="submit">
        <h2>Add your playlist</h2>
        <p className="lede">
          Pick up to {MAX_TRACKS} songs. Your playlist gets its own card below, and the songs are added to the Master Mix
          automatically.
        </p>
        <ol className="steps">
          <li>
            <strong>Make a playlist in Spotify</strong> with up to {MAX_TRACKS} songs.
          </li>
          <li>
            <strong>Invite {SPOTIFY_OWNER_NAME} to it.</strong> Open the playlist, tap the three dots, choose{' '}
            <em>Invite collaborators</em>, and send the invite link to Sam. Spotify only lets this site read playlists
            it has been invited to. It is a one-time thing per playlist, and nobody else can edit yours.
            <div className="copy-row">
              <CopyName />
            </div>
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
            <article className={`card entry${isFounder(entry.name) ? ' founder' : ''}`} key={entry.id}>
              <EntryHeader entry={entry} onChanged={onChanged} />
              <SpotifyEmbed playlistId={entry.playlistId} title={`${entry.name}'s playlist`} height={460} />
              <p className="entry-foot">
                <a href={`https://open.spotify.com/playlist/${entry.playlistId}`} target="_blank" rel="noreferrer">
                  Open in Spotify
                </a>
              </p>
            </article>
          ))}
        </div>
      </section>

      {myDeleted.length > 0 && (
        <section className="card deleted">
          <h2>Your deleted playlists</h2>
          <p className="lede">Only you can see these. Restoring puts the songs back in the Master Mix.</p>
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
