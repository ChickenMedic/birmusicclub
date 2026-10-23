// Shared by the frontend and the submit Lambda. Nothing here is secret.

// The "BIR Music Club" playlist on Sam's Spotify account that every submission is appended to.
export const MASTER_PLAYLIST_ID = '0t6ow4TnTqHTd4RJYrGYsV';

// Spotify only lets this app read playlists its account owns or collaborates on, so coworkers
// must invite this user as a collaborator before submitting.
export const SPOTIFY_OWNER_NAME = 'ChickenMed';

export const MAX_TRACKS = 11;
