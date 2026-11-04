import {
  defaultCheckoutRepository,
  evaluateConnectionAccess,
  type ProjectAccessPolicy,
} from '@shipfox/api-projects-dto';
import type {IntegrationConnection} from '@shipfox/client-integrations';
import type {AccessDraft, ProjectAccessConfigSource} from '#core/project-access.js';

function toPolicy({
  projectId,
  configSource,
  draft,
}: {
  projectId: string;
  configSource: ProjectAccessConfigSource;
  draft: AccessDraft;
}): ProjectAccessPolicy {
  return {
    projectId,
    configSource: {
      managed: configSource.kind === 'managed',
      connectionId: configSource.connectionId,
      externalRepositoryId: configSource.externalRepositoryId,
      lookupName: configSource.lookupName,
    },
    connections:
      draft.mode === 'all'
        ? 'all'
        : draft.connections.map(({connectionId, resources}) => ({
            connectionId,
            resources:
              resources === 'all'
                ? 'all'
                : resources.map(({kind, externalId, lookupName}) => ({
                    kind,
                    externalId,
                    lookupName,
                  })),
          })),
  };
}

interface CheckoutTarget {
  connectionId: string;
  externalRepositoryId: string;
}

function repositoryName(drafts: AccessDraft[], target: CheckoutTarget): string {
  for (const draft of drafts) {
    for (const connection of draft.connections) {
      if (connection.connectionId !== target.connectionId || connection.resources === 'all') {
        continue;
      }
      const match = connection.resources.find(
        (resource) => resource.externalId === target.externalRepositoryId,
      );
      if (match) return match.displayName;
    }
  }
  return target.externalRepositoryId;
}

function isSameCheckout(left: CheckoutTarget | null, right: CheckoutTarget | null): boolean {
  return (
    left?.connectionId === right?.connectionId &&
    left?.externalRepositoryId === right?.externalRepositoryId
  );
}

/**
 * What a save changes beyond the list itself: the repository jobs check out when they set no
 * `checkout`, and, on the default project, the interaction connections whose unclaimed requests
 * would get no answer.
 */
export function accessChangeWarnings({
  projectId,
  isDefaultProject,
  configSource,
  saved,
  draft,
  connections,
  providerName,
}: {
  projectId: string;
  isDefaultProject: boolean;
  configSource: ProjectAccessConfigSource;
  saved: AccessDraft;
  draft: AccessDraft;
  connections: readonly IntegrationConnection[];
  providerName: (provider: string) => string;
}): string[] {
  const before = toPolicy({projectId, configSource, draft: saved});
  const after = toPolicy({projectId, configSource, draft});
  const sourceControlConnectionIds = connections
    .filter(
      (connection) =>
        connection.lifecycleStatus === 'active' &&
        connection.capabilities.includes('source_control'),
    )
    .map((connection) => connection.id);

  return [
    ...checkoutWarnings({before, after, saved, draft, sourceControlConnectionIds}),
    ...(isDefaultProject ? interactionWarnings({before, after, connections, providerName}) : []),
  ];
}

function checkoutWarnings({
  before,
  after,
  saved,
  draft,
  sourceControlConnectionIds,
}: {
  before: ProjectAccessPolicy;
  after: ProjectAccessPolicy;
  saved: AccessDraft;
  draft: AccessDraft;
  sourceControlConnectionIds: string[];
}): string[] {
  const checkoutBefore = defaultCheckoutRepository(before, {sourceControlConnectionIds});
  const checkoutAfter = defaultCheckoutRepository(after, {sourceControlConnectionIds});
  if (isSameCheckout(checkoutBefore, checkoutAfter)) return [];
  const warnings: string[] = [];
  if (checkoutBefore) {
    const name = repositoryName([saved, draft], checkoutBefore);
    warnings.push(`Jobs that don't set checkout will stop checking out ${name}.`);
  }
  if (checkoutAfter) {
    const name = repositoryName([draft, saved], checkoutAfter);
    warnings.push(`Jobs that don't set checkout will check out ${name}.`);
  }
  return warnings;
}

/** The default project answers unclaimed requests, so leaving out their connection silences them. */
function interactionWarnings({
  before,
  after,
  connections,
  providerName,
}: {
  before: ProjectAccessPolicy;
  after: ProjectAccessPolicy;
  connections: readonly IntegrationConnection[];
  providerName: (provider: string) => string;
}): string[] {
  const providers = new Set<string>();
  for (const connection of connections) {
    if (!connection.capabilities.includes('interaction')) continue;
    const wasAllowed = evaluateConnectionAccess(before, {connectionId: connection.id}).allowed;
    const isAllowed = evaluateConnectionAccess(after, {connectionId: connection.id}).allowed;
    if (wasAllowed && !isAllowed) providers.add(providerName(connection.provider));
  }
  return [...providers].map(
    (provider) => `${provider} requests that no agent claims will get no answer.`,
  );
}
