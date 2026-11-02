import {AUTH_USER, requireWorkspaceResourceAccess} from '@shipfox/api-auth-context';
import {
  getProjectConfigParamsSchema,
  listProjectConfigCommitsParamsSchema,
  listProjectConfigCommitsQuerySchema,
  listProjectConfigCommitsResponseSchema,
  listProjectConfigFilesParamsSchema,
  listProjectConfigFilesQuerySchema,
  listProjectConfigFilesResponseSchema,
  projectConfigResponseSchema,
  readProjectConfigFileParamsSchema,
  readProjectConfigFileQuerySchema,
  readProjectConfigFileResponseSchema,
} from '@shipfox/api-integration-core-dto';
import type {ProjectsModuleClient} from '@shipfox/api-projects-dto/inter-module';
import {ClientError, defineRoute, type RouteExport} from '@shipfox/node-fastify';
import type {FastifyRequest} from 'fastify';
import {
  type ConfigProject,
  type ProjectConfigService,
  toConfigProject,
} from '#core/project-config-service.js';
import {
  toProjectConfigCommitsDto,
  toProjectConfigDto,
  toProjectConfigFilesDto,
} from '#presentation/dto/project-config.js';
import {integrationRouteErrorHandler} from './errors.js';

export interface CreateProjectConfigRoutesParams {
  projects: ProjectsModuleClient;
  projectConfig: ProjectConfigService;
}

export function createProjectConfigRoutes(params: CreateProjectConfigRoutesParams): RouteExport[] {
  const {projectConfig} = params;

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

  return [getConfig, listFiles, readFile, listCommits];
}
