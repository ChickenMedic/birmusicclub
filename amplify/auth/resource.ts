import { defineAuth } from '@aws-amplify/backend';

// Required for the identity pool that gives the public site guest read access to the data API.
export const auth = defineAuth({
  loginWith: {
    email: true,
  },
});
