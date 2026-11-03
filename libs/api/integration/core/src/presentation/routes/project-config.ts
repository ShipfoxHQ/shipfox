import {
  AUTH_USER,
  rejectImpersonatedSession,
  requireUserContext,
  requireWorkspaceResourceAccess,
} from '@shipfox/api-auth-context';
import {
  getProjectConfigParamsSchema,
  linkProjectConfigBodySchema,
  linkProjectConfigParamsSchema,
  linkProjectConfigResponseSchema,
  listProjectConfigCommitsParamsSchema,
  listProjectConfigCommitsQuerySchema,
  listProjectConfigCommitsResponseSchema,
  listProjectConfigFilesParamsSchema,
  listProjectConfigFilesQuerySchema,
  listProjectConfigFilesResponseSchema,
  openProjectConfigPullRequestParamsSchema,
  openProjectConfigPullRequestResponseSchema,
  projectConfigResponseSchema,
  readProjectConfigFileParamsSchema,
  readProjectConfigFileQuerySchema,
  readProjectConfigFileResponseSchema,
} from '@shipfox/api-integration-core-dto';
import type {ProjectsModuleClient} from '@shipfox/api-projects-dto/inter-module';
import {ClientError, defineRoute, type RouteExport} from '@shipfox/node-fastify';
import type {FastifyRequest} from 'fastify';
import type {ConfigLinkService} from '#core/config-link-service.js';
import {
  type ConfigProject,
  type ProjectConfigService,
  toConfigProject,
} from '#core/project-config-service.js';
import {
  toLinkProjectConfigDto,
  toProjectConfigCommitsDto,
  toProjectConfigDto,
  toProjectConfigFilesDto,
} from '#presentation/dto/project-config.js';
import {integrationRouteErrorHandler} from './errors.js';

export interface CreateProjectConfigRoutesParams {
  projects: ProjectsModuleClient;
  projectConfig: ProjectConfigService;
  configLink?: ConfigLinkService | undefined;
}

export function createProjectConfigRoutes(params: CreateProjectConfigRoutesParams): RouteExport[] {
  const {projectConfig} = params;

  /** A move changes a customer's repository for good, so support sessions can't start one. */
  function requireActorId(request: FastifyRequest): string {
    rejectImpersonatedSession(request);
    return requireUserContext(request).userId;
  }

  async function loadProject(request: FastifyRequest, projectId: string): Promise<ConfigProject> {
    const {project} = await params.projects.getProjectById({projectId});
    const notFound = new ClientError('Project not found', 'project-not-found', {status: 404});
    if (!project) throw notFound;
    requireWorkspaceResourceAccess({
      request,
      workspaceId: project.workspaceId,
      notFoundError: notFound,
    });
    return toConfigProject(project);
  }

  const getConfig = defineRoute({
    method: 'GET',
    path: '/projects/:projectId/config',
    auth: AUTH_USER,
    description: "Read where a project's config lives and the head of its default branch.",
    schema: {
      params: getProjectConfigParamsSchema,
      response: {200: projectConfigResponseSchema},
    },
    errorHandler: integrationRouteErrorHandler,
    handler: async (request) => {
      const project = await loadProject(request, request.params.projectId);
      return toProjectConfigDto(await projectConfig.getConfigSource(project));
    },
  });

  const listFiles = defineRoute({
    method: 'GET',
    path: '/projects/:projectId/config/files',
    auth: AUTH_USER,
    description: "List the files under .shipfox/ in a project's active repository.",
    schema: {
      params: listProjectConfigFilesParamsSchema,
      querystring: listProjectConfigFilesQuerySchema,
      response: {200: listProjectConfigFilesResponseSchema},
    },
    errorHandler: integrationRouteErrorHandler,
    handler: async (request) => {
      const project = await loadProject(request, request.params.projectId);
      return toProjectConfigFilesDto(await projectConfig.listConfigFiles(project, request.query));
    },
  });

  const readFile = defineRoute({
    method: 'GET',
    path: '/projects/:projectId/config/files/*',
    auth: AUTH_USER,
    description: "Read one file under .shipfox/ in a project's active repository.",
    schema: {
      params: readProjectConfigFileParamsSchema,
      querystring: readProjectConfigFileQuerySchema,
      response: {200: readProjectConfigFileResponseSchema},
    },
    errorHandler: integrationRouteErrorHandler,
    handler: async (request) => {
      const {projectId, '*': path} = request.params;
      const project = await loadProject(request, projectId);
      return await projectConfig.readConfigFile(project, {path, ref: request.query.ref});
    },
  });

  const listCommits = defineRoute({
    method: 'GET',
    path: '/projects/:projectId/config/commits',
    auth: AUTH_USER,
    description: 'List the commits that changed a config path, newest first.',
    schema: {
      params: listProjectConfigCommitsParamsSchema,
      querystring: listProjectConfigCommitsQuerySchema,
      response: {200: listProjectConfigCommitsResponseSchema},
    },
    errorHandler: integrationRouteErrorHandler,
    handler: async (request) => {
      const project = await loadProject(request, request.params.projectId);
      return toProjectConfigCommitsDto(
        await projectConfig.listConfigCommits(project, request.query),
      );
    },
  });

  const routes = [getConfig, listFiles, readFile, listCommits];
  const {configLink} = params;
  if (!configLink) return routes;

  const link = defineRoute({
    method: 'POST',
    path: '/projects/:projectId/config/link',
    auth: AUTH_USER,
    description:
      "Move a managed project's config to a repository: check it, open a pull request that adds .shipfox/, and move the config source. Retrying a stopped move resumes it.",
    schema: {
      params: linkProjectConfigParamsSchema,
      body: linkProjectConfigBodySchema,
      response: {200: linkProjectConfigResponseSchema},
    },
    errorHandler: integrationRouteErrorHandler,
    handler: async (request) => {
      const project = await loadProject(request, request.params.projectId);
      const result = await configLink.link(project, {
        actorId: requireActorId(request),
        connectionId: request.body.connection_id,
        externalRepositoryId: request.body.external_repository_id,
        dryRun: request.body.dry_run,
      });
      return toLinkProjectConfigDto(result);
    },
  });

  const openPullRequest = defineRoute({
    method: 'POST',
    path: '/projects/:projectId/config/link/pull-request',
    auth: AUTH_USER,
    description: 'Open a new pull request for a moved project after the previous one closed.',
    schema: {
      params: openProjectConfigPullRequestParamsSchema,
      response: {200: openProjectConfigPullRequestResponseSchema},
    },
    errorHandler: integrationRouteErrorHandler,
    handler: async (request) => {
      const project = await loadProject(request, request.params.projectId);
      requireActorId(request);
      return {pull_request: await configLink.openNewPullRequest(project)};
    },
  });

  return [...routes, link, openPullRequest];
}
