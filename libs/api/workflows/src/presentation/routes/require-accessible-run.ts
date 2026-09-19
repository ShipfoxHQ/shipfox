import type {ProjectsModuleClient} from '@shipfox/api-projects-dto/inter-module';
import {ClientError} from '@shipfox/node-fastify';
import type {FastifyRequest} from 'fastify';
import {getWorkflowRunAccessScopeById} from '#db/index.js';
import {recordWorkflowRunAccessCheckDuration} from '#metrics/instance.js';
import {requireProjectAccess} from './project-access.js';

interface RequireAccessibleRunParams {
  request: FastifyRequest;
  id: string;
  projects: ProjectsModuleClient;
  onLookup?: ((found: boolean) => void) | undefined;
  onAccessDenied?: (() => void) | undefined;
}

export async function requireAccessibleRunScope(params: RequireAccessibleRunParams) {
  const startedAt = performance.now();
  let outcome: 'success' | 'not_found' | 'error' = 'success';
  try {
    const run = await loadRunScope(params);
    if (!run) {
      throw new ClientError('Run not found', 'not-found', {status: 404});
    }
    await requireRunProjectAccess(params, run.projectId);
    return run;
  } catch (error: unknown) {
    outcome = accessCheckOutcome(error);
    throw error;
  } finally {
    recordAccessCheckDuration('total', outcome, startedAt);
  }
}

async function loadRunScope(params: RequireAccessibleRunParams) {
  const startedAt = performance.now();
  let run: Awaited<ReturnType<typeof getWorkflowRunAccessScopeById>>;
  try {
    run = await getWorkflowRunAccessScopeById(params.id);
  } catch (error) {
    recordAccessCheckDuration('run_lookup', 'error', startedAt);
    throw error;
  }
  recordAccessCheckDuration('run_lookup', run ? 'success' : 'not_found', startedAt);
  params.onLookup?.(run !== undefined);
  return run;
}

async function requireRunProjectAccess(params: RequireAccessibleRunParams, projectId: string) {
  const startedAt = performance.now();
  try {
    await requireProjectAccess(params.request, projectId, params.projects);
    recordAccessCheckDuration('project_lookup', 'success', startedAt);
  } catch (error: unknown) {
    const accessDenied =
      error instanceof ClientError &&
      (error.status === 404 || (error.status === 403 && error.code === 'forbidden'));
    recordAccessCheckDuration('project_lookup', accessDenied ? 'not_found' : 'error', startedAt);
    if (!accessDenied) throw error;
    params.onAccessDenied?.();
    throw new ClientError('Run not found', 'not-found', {status: 404});
  }
}

function accessCheckOutcome(error: unknown): 'not_found' | 'error' {
  return error instanceof ClientError && error.status === 404 ? 'not_found' : 'error';
}

function recordAccessCheckDuration(
  phase: Parameters<typeof recordWorkflowRunAccessCheckDuration>[0],
  outcome: Parameters<typeof recordWorkflowRunAccessCheckDuration>[1],
  startedAt: number,
): void {
  recordWorkflowRunAccessCheckDuration(phase, outcome, performance.now() - startedAt);
}
