import type {WorkflowDocumentJob} from '@shipfox/workflow-document';
import type {
  WorkflowEnvTemplates,
  WorkflowFieldTemplate,
  WorkflowModelJobContainer,
} from '../entities/workflow-model.js';
import type {
  WorkflowModelValidationIssue,
  WorkflowModelValidationIssuePathSegment,
} from './invalid-workflow-model-error.js';
import {
  parseInterpolationField,
  type StoredInterpolationField,
} from './parse-interpolation-field.js';

type ContainerObject = Exclude<WorkflowDocumentJob['container'], string | undefined>;
type ContainerTemplates = NonNullable<WorkflowModelJobContainer['templates']>;

interface ContainerParams {
  container: ContainerObject;
  path: readonly WorkflowModelValidationIssuePathSegment[];
  issues: WorkflowModelValidationIssue[];
}

export function normalizeJobContainer(params: {
  container: WorkflowDocumentJob['container'];
  sourceName: string;
  issues: WorkflowModelValidationIssue[];
}): WorkflowModelJobContainer | undefined {
  if (params.container === undefined) return undefined;
  const container =
    typeof params.container === 'string' ? {image: params.container} : params.container;
  const templates = containerTemplates({
    container,
    path: ['jobs', params.sourceName, 'container'],
    issues: params.issues,
  });
  const env = Object.fromEntries(
    Object.entries(container.env ?? {}).map(([key, value]) => [key, String(value)]),
  );
  return {
    image: container.image,
    ...(container.credentials === undefined ? {} : {credentials: container.credentials}),
    ...(Object.keys(env).length === 0 ? {} : {env}),
    ...(container.options === undefined ? {} : {options: container.options}),
    dockerSocket: container.docker_socket ?? true,
    ...(Object.keys(templates).length === 0 ? {} : {templates}),
  };
}

function containerTemplates(params: ContainerParams): ContainerTemplates {
  const {container} = params;
  const field = (
    name: StoredInterpolationField,
    source: string | undefined,
    path: readonly WorkflowModelValidationIssuePathSegment[],
  ): WorkflowFieldTemplate | undefined =>
    source === undefined
      ? undefined
      : parseInterpolationField({
          field: name,
          source,
          path: [...params.path, ...path],
          issues: params.issues,
          // The container is built when the execution is created, before any
          // job runs, so its fields can only read what exists at that point.
          fillSite: 'execution-creation',
        });
  const image = field('job.container.image', container.image, ['image']);
  const options = field('job.container.options', container.options, ['options']);
  const username = field('job.container.credentials', container.credentials?.username, [
    'credentials',
    'username',
  ]);
  const password = field('job.container.credentials', container.credentials?.password, [
    'credentials',
    'password',
  ]);
  const env = envTemplates(params, field);
  return {
    ...(image === undefined ? {} : {image}),
    ...(options === undefined ? {} : {options}),
    ...(username === undefined ? {} : {username}),
    ...(password === undefined ? {} : {password}),
    ...(env === undefined ? {} : {env}),
  };
}

function envTemplates(
  params: ContainerParams,
  field: (
    name: StoredInterpolationField,
    source: string | undefined,
    path: readonly WorkflowModelValidationIssuePathSegment[],
  ) => WorkflowFieldTemplate | undefined,
): WorkflowEnvTemplates | undefined {
  const templates: Record<string, WorkflowFieldTemplate> = Object.create(null) as Record<
    string,
    WorkflowFieldTemplate
  >;
  for (const [key, value] of Object.entries(params.container.env ?? {})) {
    if (typeof value !== 'string') continue;
    const template = field('job.container.env.value', value, ['env', key]);
    if (template !== undefined) templates[key] = template;
  }
  return Object.keys(templates).length === 0 ? undefined : templates;
}
