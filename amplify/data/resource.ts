import { type ClientSchema, a, defineData } from '@aws-amplify/backend';
import { submitPlaylist } from '../submit-playlist/resource';
import { manageEntry } from '../manage-entry/resource';
import { siteStats } from '../site-stats/resource';

// Fields only the backend may read. "authenticated" users cannot exist (sign-up is disabled),
// so this effectively hides the field from everyone using the API.
const backendOnly = (allow: Parameters<Parameters<ReturnType<typeof a.string>['authorization']>[0]>[0]) => [
  allow.authenticated().to(['read']),
];

const schema = a.schema({
  Entry: a
    .model({
      name: a.string().required(),
      // Only present when the person opted into the digest. Nullable because Amplify rejects
      // field-level rules on required fields.
      email: a.email().authorization(backendOnly),
      // Secret handed to the submitting browser so it can delete/restore its own entry.
      editToken: a.string().authorization(backendOnly),
      // Spotify URIs of the entry's songs, recorded when they went into the master playlist so
      // delete/restore and the daily refresh can keep it in step. Public: the site uses them to
      // count the songs picked by more than one person. They are no secret (the playlists are
      // embedded on the page).
      trackUris: a.string().array(),
      playlistUrl: a.url().required(),
      playlistId: a.string().required(),
      // 0 until the playlist has been read (see syncedAt).
      trackCount: a.integer().required(),
      digestOptIn: a.boolean().required(),
      addedAt: a.datetime().required(),
      // Set once the songs are in the master playlist. Unset means we could not read the
      // playlist yet (no collaborator invite) and sync-pending keeps retrying.
      syncedAt: a.datetime(),
      // Why the last sync attempt refused the playlist (too many songs, empty...), if it did.
      syncError: a.string(),
      // Set when the owner deletes the entry. The record is kept so it can be restored.
      deletedAt: a.datetime(),
      // False only for entries created before edit tokens existed; they show a one-time "claim" link.
      claimed: a.boolean(),
    })
    // authenticated() is listed only so the field-level rules above are allowed; the user
    // pool is admin-create-only, so no authenticated user ever exists.
    .authorization((allow) => [allow.guest().to(['read']), allow.authenticated().to(['read'])]),

  // What the mutations hand back: the public fields of the entry, plus editToken on creation.
  SubmittedEntry: a.customType({
    id: a.string().required(),
    name: a.string().required(),
    playlistUrl: a.string().required(),
    playlistId: a.string().required(),
    trackCount: a.integer().required(),
    addedAt: a.string().required(),
    syncedAt: a.string(),
    syncError: a.string(),
    deletedAt: a.string(),
    claimed: a.boolean(),
    trackUris: a.string().array(),
    editToken: a.string(),
  }),

  SiteStats: a.customType({
    visits: a.integer().required(),
  }),

  // The only way to create an entry. The Lambda rate limits by IP, saves the Entry, then tries
  // to read the playlist and add its songs to the master playlist (see amplify/sync.ts).
  submitPlaylist: a
    .mutation()
    .arguments({
      name: a.string().required(),
      // Only collected when digestOptIn is true.
      email: a.string(),
      playlistUrl: a.string().required(),
      digestOptIn: a.boolean().required(),
    })
    .returns(a.ref('SubmittedEntry'))
    .authorization((allow) => [allow.guest()])
    .handler(a.handler.function(submitPlaylist)),

  // rename: anyone. sync: anyone (retries putting a pending entry's songs in the master playlist).
  // delete/restore: the editToken from submitPlaylist, or the admin key.
  // Delete removes the entry's songs from the master playlist; restore adds them back.
  // "claim" issues a token for an entry that predates tokens (no editToken needed, works once).
  manageEntry: a
    .mutation()
    .arguments({
      id: a.string().required(),
      editToken: a.string(),
      action: a.enum(['rename', 'delete', 'restore', 'claim', 'sync']),
      name: a.string(),
    })
    .returns(a.ref('SubmittedEntry'))
    .authorization((allow) => [allow.guest()])
    .handler(a.handler.function(manageEntry)),

  // The visit counter in the hero. recordVisit counts one visit and returns the total;
  // siteStats only reads it (for reloads within the same tab session).
  recordVisit: a
    .mutation()
    .returns(a.ref('SiteStats'))
    .authorization((allow) => [allow.guest()])
    .handler(a.handler.function(siteStats)),
  siteStats: a
    .query()
    .returns(a.ref('SiteStats'))
    .authorization((allow) => [allow.guest()])
    .handler(a.handler.function(siteStats)),
});

export type Schema = ClientSchema<typeof schema>;

export const data = defineData({
  schema,
  authorizationModes: {
    defaultAuthorizationMode: 'identityPool',
  },
});
