import { defineFunction } from '@aws-amplify/backend';

// Serves the visit counter shown in the hero: recordVisit bumps it, siteStats just reads it.
export const siteStats = defineFunction({
  name: 'site-stats',
  entry: './handler.ts',
  runtime: 22,
  timeoutSeconds: 10,
  // Same stack as the data API, like the other Lambdas, to avoid a circular dependency.
  resourceGroupName: 'data',
});
