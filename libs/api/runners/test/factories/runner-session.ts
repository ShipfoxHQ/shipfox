import {Factory} from 'fishery';
import type {RunnerSession} from '#core/entities/runner-session.js';
import {createRunnerSession} from '#db/runner-sessions.js';

export const runnerSessionFactory = Factory.define<RunnerSession>(({onCreate}) => {
  onCreate((session) => {
    return createRunnerSession({
      workspaceId: session.workspaceId,
      scope: session.scope,
      registrationTokenId: session.registrationTokenId,
      labels: session.labels,
      toolCapabilities: session.toolCapabilities,
    });
  });

  return {
    id: crypto.randomUUID(),
    workspaceId: crypto.randomUUID(),
    scope: 'workspace',
    registrationTokenId: crypto.randomUUID(),
    registrationTokenKind: 'manual',
    provisionerId: null,
    providerRunnerId: null,
    labels: ['linux', 'x64'],
    toolCapabilities: null,
    toolCapabilitiesReportedAt: null,
    maxClaims: null,
    claimsUsed: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
});
