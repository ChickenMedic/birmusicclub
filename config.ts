// Shared by the frontend and the Lambdas. Nothing here is secret.

// The "BIR Master Mix" playlist on Sam's Spotify account that every submission is appended to.
export const MASTER_PLAYLIST_ID = '0t6ow4TnTqHTd4RJYrGYsV';

// Spotify only lets this app read playlists its account owns or collaborates on, so coworkers
// must invite this user as a collaborator before submitting.
export const SPOTIFY_OWNER_NAME = 'ChickenMed';

export const MAX_TRACKS = 11;

// The founders get one extra song. Matched on the name typed into the form, ignoring case,
// periods and extra spaces.
export const FOUNDERS = ['Chris O.', 'Katie U.'];
export const FOUNDER_MAX_TRACKS = 12;

const normalizeName = (name: string) => name.toLowerCase().replace(/[.\s]+/g, ' ').trim();

export function isFounder(name: string): boolean {
  const normalized = normalizeName(name);
  return FOUNDERS.some((f) => normalizeName(f) === normalized);
}

export function maxTracksFor(name: string): number {
  return isFounder(name) ? FOUNDER_MAX_TRACKS : MAX_TRACKS;
}
