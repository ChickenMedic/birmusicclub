import { type ClientSchema, a, defineData } from '@aws-amplify/backend';
import { submitPlaylist } from '../submit-playlist/resource';

const schema = a.schema({
  Entry: a
    .model({
      name: a.string().required(),
      // Hidden from guests: only signed-in users could read it, and sign-up is disabled.
      // The backend Lambdas (Phase 2 submit, Phase 4 digest) read/write the table directly
      // and always set it. It is nullable only because Amplify rejects field-level rules
      // on required fields.
      email: a.email().authorization((allow) => [allow.authenticated().to(['read'])]),
      playlistUrl: a.url().required(),
      playlistId: a.string().required(),
      trackCount: a.integer().required(),
      digestOptIn: a.boolean().required(),
      addedAt: a.datetime().required(),
    })
    // authenticated() is listed only so the field-level rule on email is allowed; the user
    // pool is admin-create-only, so no authenticated user ever exists.
    .authorization((allow) => [allow.guest().to(['read']), allow.authenticated().to(['read'])]),

  // The only write path. The Lambda checks the shared password, rate limits by IP, validates
  // the playlist against Spotify, adds its songs to the master playlist, and saves the Entry.
  submitPlaylist: a
    .mutation()
    .arguments({
      name: a.string().required(),
      email: a.string().required(),
      playlistUrl: a.string().required(),
      digestOptIn: a.boolean().required(),
      password: a.string().required(),
    })
    .returns(a.ref('Entry'))
    .authorization((allow) => [allow.guest()])
    .handler(a.handler.function(submitPlaylist)),
});

export type Schema = ClientSchema<typeof schema>;

export const data = defineData({
  schema,
  authorizationModes: {
    defaultAuthorizationMode: 'identityPool',
  },
});
