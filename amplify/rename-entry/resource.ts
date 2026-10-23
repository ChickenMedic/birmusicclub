import { defineFunction } from '@aws-amplify/backend';

export const renameEntry = defineFunction({
  name: 'rename-entry',
  entry: './handler.ts',
  runtime: 22,
  timeoutSeconds: 10,
  // Same stack as the data API, like submit-playlist, to avoid a circular dependency.
  resourceGroupName: 'data',
});
