import { type ClientSchema, a, defineData } from '@aws-amplify/backend';
import { submitPlaylist } from '../submit-playlist/resource';
import { manageEntry } from '../manage-entry/resource';

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
      // Secret handed to the submitting browser so it can rename/delete/restore its own entry.
      editToken: a.string().authorization(backendOnly),
      // Spotify URIs that were added to the master playlist, so delete/restore can sync it.
      trackUris: a.string().array().authorization(backendOnly),
      playlistUrl: a.url().required(),
      playlistId: a.string().required(),
      trackCount: a.integer().required(),
      digestOptIn: a.boolean().required(),
      addedAt: a.datetime().required(),
      // Set when the owner deletes the entry. The record is kept so it can be restored.
      deletedAt: a.datetime(),
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
    deletedAt: a.string(),
    editToken: a.string(),
  }),

  // The only way to create an entry. The Lambda rate limits by IP, validates the playlist
  // against Spotify, adds its songs to the master playlist, and saves the Entry.
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

  // Rename, delete (soft) or restore an entry. Requires the editToken from submitPlaylist.
  // Delete removes the entry's songs from the master playlist; restore adds them back.
  manageEntry: a
    .mutation()
    .arguments({
      id: a.string().required(),
      editToken: a.string().required(),
      action: a.enum(['rename', 'delete', 'restore']),
      name: a.string(),
    })
    .returns(a.ref('SubmittedEntry'))
    .authorization((allow) => [allow.guest()])
    .handler(a.handler.function(manageEntry)),
});

export type Schema = ClientSchema<typeof schema>;

export const data = defineData({
  schema,
  authorizationModes: {
    defaultAuthorizationMode: 'identityPool',
  },
});
