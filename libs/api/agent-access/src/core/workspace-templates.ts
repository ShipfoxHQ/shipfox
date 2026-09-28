import type {IntegrationsModuleClient} from '@shipfox/api-integration-core-dto/inter-module';
import type {
  TemplateLoader,
  WorkflowTemplate,
  WorkflowTemplateRole,
} from '@shipfox/workflow-templates';

export type WorkspaceTemplateGroup = 'try_now' | 'starts_on_event' | 'needs_connection';

const GROUP_ORDER: readonly WorkspaceTemplateGroup[] = [
  'try_now',
  'starts_on_event',
  'needs_connection',
];

export interface WorkspaceTemplateRole {
  name: string;
  declaration: WorkflowTemplateRole;
  providers: {provider: string; connectionSlugs: string[]}[];
}

export interface WorkspaceTemplate {
  template: WorkflowTemplate;
  roles: WorkspaceTemplateRole[];
  compatible: boolean;
  /** Providers of required roles that have no active connection. */
  missingProviders: string[];
  group: WorkspaceTemplateGroup;
}

/** Lists templates with the workspace's compatibility, in loader order. */
export async function listWorkspaceTemplates(params: {
  templates: TemplateLoader;
  integrations: IntegrationsModuleClient;
  workspaceId: string;
}): Promise<WorkspaceTemplate[]> {
  const connections = await listActiveConnections(params.integrations, params.workspaceId);
  return params.templates.list().map((template) => toWorkspaceTemplate(template, connections));
}

/** Orders templates by group, then by the manifest rank. */
export function rankWorkspaceTemplates(
  templates: readonly WorkspaceTemplate[],
): WorkspaceTemplate[] {
  return [...templates].sort(
    (left, right) =>
      GROUP_ORDER.indexOf(left.group) - GROUP_ORDER.indexOf(right.group) ||
      left.template.manifest.rank - right.template.manifest.rank,
  );
}

function toWorkspaceTemplate(
  template: WorkflowTemplate,
  connections: readonly WorkspaceConnection[],
): WorkspaceTemplate {
  const roles = Object.entries(template.manifest.roles).map(([name, declaration]) => ({
    name,
    declaration,
    providers: declaration.providers.map((provider) => ({
      provider,
      connectionSlugs: connectionSlugs(connections, provider),
    })),
  }));
  const requiredRoles = roles.filter(({declaration}) => declaration.optional !== true);
  const missingProviders = requiredRoles.flatMap(({providers}) =>
    providers
      .filter(({connectionSlugs}) => connectionSlugs.length === 0)
      .map(({provider}) => provider),
  );
  const compatible = requiredRoles.every(({providers}) =>
    providers.some(({connectionSlugs}) => connectionSlugs.length > 0),
  );

  return {
    template,
    roles,
    compatible,
    missingProviders: [...new Set(missingProviders)],
    group: templateGroup(compatible, template.startsManually),
  };
}

function templateGroup(compatible: boolean, startsManually: boolean): WorkspaceTemplateGroup {
  if (!compatible) return 'needs_connection';
  return startsManually ? 'try_now' : 'starts_on_event';
}

export async function listActiveConnections(
  integrations: IntegrationsModuleClient,
  workspaceId: string,
): Promise<readonly WorkspaceConnection[]> {
  const connections: WorkspaceConnection[] = [];
  let cursor: WorkspaceConnectionCursor | undefined;

  while (true) {
    const page = await integrations.listConnectionsByWorkspace({
      workspaceId,
      limit: 100,
      ...(cursor === undefined ? {} : {cursor}),
    });
    connections.push(...page.connections);
    if (page.nextCursor === null) break;
    cursor = page.nextCursor;
  }

  return connections.filter((connection) => connection.lifecycleStatus === 'active');
}

type WorkspaceConnectionPage = Awaited<
  ReturnType<IntegrationsModuleClient['listConnectionsByWorkspace']>
>;
export type WorkspaceConnection = WorkspaceConnectionPage['connections'][number];
type WorkspaceConnectionCursor = NonNullable<WorkspaceConnectionPage['nextCursor']>;

export function connectionSlugs(
  connections: readonly WorkspaceConnection[],
  provider: string,
): string[] {
  return connections.filter((connection) => connection.provider === provider).map(({slug}) => slug);
}
