import type {IntegrationsModuleClient} from '@shipfox/api-integration-core-dto/inter-module';
import type {WorkspaceCreatedEvent} from '@shipfox/api-workspaces-dto';
import {ensureDefaultProject} from '#core/default-project.js';

export async function onWorkspaceCreated(
  payload: WorkspaceCreatedEvent,
  deps: {integrations: IntegrationsModuleClient},
): Promise<void> {
  await ensureDefaultProject({
    actorId: payload.creatorUserId,
    workspaceId: payload.workspaceId,
    integrations: deps.integrations,
  });
}
