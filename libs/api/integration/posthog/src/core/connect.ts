import {randomUUID} from 'node:crypto';
import type {PosthogRegion} from '@shipfox/api-integration-posthog-dto';
import type {IntegrationConnection} from '@shipfox/api-integration-spi';
import type {PosthogApiClient, PosthogProject} from '#api/client.js';
import type {PosthogCredentialStore} from './credentials.js';
import {
  PosthogApiKeyPrefixError,
  PosthogNoProjectAccessError,
  PosthogProjectNotAccessibleError,
} from './errors.js';

export interface CreatePosthogConnectionInput {
  id: string;
  workspaceId: string;
  region: PosthogRegion;
  apiKey: string;
  projectId: string;
  projectName: string;
  organizationId: string;
}

export interface PosthogConnectionCreator {
  createConnection(input: CreatePosthogConnectionInput): Promise<IntegrationConnection<'posthog'>>;
}

export interface ConnectPosthogInput {
  workspaceId: string;
  region: PosthogRegion;
  apiKey: string;
  projectId?: string | undefined;
}

export type PosthogConnectResult =
  | {status: 'select-project'; projects: PosthogProject[]}
  | {status: 'connected'; connection: IntegrationConnection<'posthog'>}
  | {status: 'already-connected'; connectionId: string};

export interface HandlePosthogConnectParams extends ConnectPosthogInput {
  posthog: PosthogApiClient;
  credentials: PosthogCredentialStore;
  getExistingConnection: (input: {
    workspaceId: string;
    externalAccountId: string;
  }) => Promise<IntegrationConnection<'posthog'> | undefined>;
  createConnection: PosthogConnectionCreator['createConnection'];
}

export async function handlePosthogConnect(
  params: HandlePosthogConnectParams,
): Promise<PosthogConnectResult> {
  assertPersonalApiKey(params.apiKey);
  const projects = await params.posthog.listProjects({
    region: params.region,
    apiKey: params.apiKey,
  });
  if (projects.length === 0) throw new PosthogNoProjectAccessError();

  const project = resolveProject(projects, params.projectId);
  if (!project) return {status: 'select-project', projects};

  const externalAccountId = `${params.region}:${project.id}`;
  const existing = await params.getExistingConnection({
    workspaceId: params.workspaceId,
    externalAccountId,
  });
  if (existing) return {status: 'already-connected', connectionId: existing.id};

  await params.posthog.validateQuery({
    region: params.region,
    apiKey: params.apiKey,
    projectId: project.id,
  });

  const connectionId = randomUUID();
  try {
    await params.credentials.setApiKey({
      connectionId,
      workspaceId: params.workspaceId,
      apiKey: params.apiKey,
    });
    const connection = await params.createConnection({
      id: connectionId,
      workspaceId: params.workspaceId,
      region: params.region,
      apiKey: params.apiKey,
      projectId: project.id,
      projectName: project.name,
      organizationId: project.organizationId,
    });
    return {status: 'connected', connection};
  } catch (error) {
    await params.credentials
      .deleteApiKey({connectionId, workspaceId: params.workspaceId})
      .catch(() => undefined);
    throw error;
  }
}

export function assertPersonalApiKey(apiKey: string): void {
  if (!apiKey.startsWith('phx_')) throw new PosthogApiKeyPrefixError();
}

function resolveProject(
  projects: PosthogProject[],
  projectId: string | undefined,
): PosthogProject | undefined {
  if (projectId !== undefined) {
    const project = projects.find((candidate) => candidate.id === projectId);
    if (!project) throw new PosthogProjectNotAccessibleError(projectId);
    return project;
  }
  return projects.length === 1 ? projects[0] : undefined;
}
