import type {Project} from '@shipfox/api-projects';
import {Factory} from 'fishery';

// Build-only: the workflows routes resolve projects through a mocked
// `getProjectById`, so these are never persisted (the projects table lives in
// @shipfox/api-projects). Typed against the real `Project` so the mock cannot
// drift from the contract under test.
export const projectFactory = Factory.define<Project>(({sequence}) => ({
  id: crypto.randomUUID(),
  workspaceId: crypto.randomUUID(),
  sourceConnectionId: crypto.randomUUID(),
  sourceExternalRepositoryId: `acme/repo-${sequence}`,
  name: `Project ${sequence}`,
  createdAt: new Date(),
  updatedAt: new Date(),
}));
