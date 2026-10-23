import { defineBackend } from '@aws-amplify/backend';
import { auth } from './auth/resource';
import { data } from './data/resource';

const backend = defineBackend({
  auth,
  data,
});

// Nobody signs in to this site. Cognito exists only so the identity pool can hand guests
// read-only credentials. Block self sign-up so no one can register and read the
// authenticated-only email field.
backend.auth.resources.cfnResources.cfnUserPool.adminCreateUserConfig = {
  allowAdminCreateUserOnly: true,
};
