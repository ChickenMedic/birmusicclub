import { type ClientSchema, a, defineData } from '@aws-amplify/backend';

const schema = a.schema({
  Entry: a
    .model({
      name: a.string().required(),
      // Hidden from guests: only signed-in users could read it, and sign-up is disabled.
      // The backend Lambdas (Phase 2 submit, Phase 4 digest) read/write the table directly.
      email: a.email().required().authorization((allow) => [allow.authenticated()]),
      playlistUrl: a.url().required(),
      playlistId: a.string().required(),
      trackCount: a.integer().required(),
      digestOptIn: a.boolean().required(),
      addedAt: a.datetime().required(),
    })
    .authorization((allow) => [allow.guest().to(['read'])]),
});

export type Schema = ClientSchema<typeof schema>;

export const data = defineData({
  schema,
  authorizationModes: {
    defaultAuthorizationMode: 'identityPool',
  },
});
