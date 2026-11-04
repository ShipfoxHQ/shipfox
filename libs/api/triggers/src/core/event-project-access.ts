import {evaluateResourceAccess, type ProjectAccessPolicy} from '@shipfox/api-projects-dto';
import type {ProjectsModuleClient} from '@shipfox/api-projects-dto/inter-module';
import type {TriggerEventResource} from './entities/received-event.js';

/** The projects module answers at most this many policies per call. */
const POLICY_BATCH_SIZE = 100;

export type ProjectAccessPolicyClient = Pick<
  ProjectsModuleClient,
  'getProjectAccessPolicies' | 'getProjectAccessPolicy'
>;

export type EventProjectAccessDenial = 'project-access' | 'project-deleted';

export interface EventProjectAccess {
  /** Loads the policies of the projects not loaded yet. A failure is transient, so callers replay. */
  load(projectIds: Iterable<string>): Promise<void>;
  /** Why the project can't take the event, or undefined when it can. The policies must be loaded. */
  denial(projectId: string): EventProjectAccessDenial | undefined;
}

/**
 * Checks events against project access for one event. A project the projects module doesn't return
 * is deleted. An event with no resource passes when its connection does.
 */
export function createEventProjectAccess(params: {
  projects: Pick<ProjectsModuleClient, 'getProjectAccessPolicies'>;
  workspaceId: string;
  connectionId: string;
  resource: TriggerEventResource | null | undefined;
}): EventProjectAccess {
  // A null policy is a project the projects module no longer returns.
  const policies = new Map<string, ProjectAccessPolicy | null>();

  return {
    async load(projectIds) {
      const missing = [...new Set(projectIds)].filter((projectId) => !policies.has(projectId));
      for (let offset = 0; offset < missing.length; offset += POLICY_BATCH_SIZE) {
        const batch = missing.slice(offset, offset + POLICY_BATCH_SIZE);
        const {policies: loaded} = await params.projects.getProjectAccessPolicies({
          workspaceId: params.workspaceId,
          projectIds: batch,
        });
        const byProject = new Map(loaded.map((policy) => [policy.projectId, policy]));
        for (const projectId of batch) policies.set(projectId, byProject.get(projectId) ?? null);
      }
    },
    denial(projectId) {
      const policy = policies.get(projectId);
      if (policy === undefined) throw new Error(`Project access was not loaded for ${projectId}`);
      if (policy === null) return 'project-deleted';
      return eventDenial(policy, params);
    },
  };
}

/** Whether a policy takes an event from the connection. A replayed event reads its stored resource. */
export function eventDenial(
  policy: ProjectAccessPolicy,
  event: {connectionId: string; resource: TriggerEventResource | null | undefined},
): 'project-access' | undefined {
  const decision = evaluateResourceAccess(policy, {
    connectionId: event.connectionId,
    target: event.resource
      ? {
          kind: 'external-id',
          resourceKind: event.resource.kind,
          externalId: event.resource.externalId,
        }
      : null,
  });
  return decision.allowed ? undefined : 'project-access';
}
