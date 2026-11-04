import type {WorkflowModel} from '@shipfox/api-definitions-dto';
import type {IntegrationsModuleClient} from '@shipfox/api-integration-core-dto/inter-module';
import type {ProjectsModuleClient} from '@shipfox/api-projects-dto/inter-module';
import {loadProjectCheckoutDefaults} from './default-checkout.js';
import {SourceConnectionUnavailableError} from './errors.js';
import {jobChecksOutProjectSource} from './step-config/index.js';

export interface AssertProjectSourceAdmitsParams {
  model: WorkflowModel;
  /** The jobs to admit. Undefined admits every job of the model. */
  jobKeys?: readonly string[] | undefined;
  projectId: string;
  projects: Pick<ProjectsModuleClient, 'getProjectById' | 'getProjectAccessPolicy'>;
  integrations: Pick<
    IntegrationsModuleClient,
    'resolveConnectionById' | 'listSourceControlConnectionIds'
  >;
}

/**
 * Work that checks out the project's default repository cannot start while that connection is
 * gone or not active. It holds for any provider, so a disabled connection blocks the same way.
 */
export async function assertProjectSourceAdmits(
  params: AssertProjectSourceAdmitsParams,
): Promise<void> {
  const {model, jobKeys, projectId} = params;
  const jobs = model.jobs.filter((job) => jobKeys === undefined || jobKeys.includes(job.key));
  // A managed project may have no default checkout, so a job that needs none here needs none there.
  if (!jobs.some((job) => jobChecksOutProjectSource({job, projectId}))) return;

  const {project} = await params.projects.getProjectById({projectId});
  if (project === null || project === undefined) {
    throw new SourceConnectionUnavailableError(projectId, null, 'missing');
  }
  const defaults = await loadProjectCheckoutDefaults({
    project,
    projects: params.projects,
    integrations: params.integrations,
  });
  const noDefaultCheckout = defaults === null || defaults.defaultCheckout === null;
  if (!jobs.some((job) => jobChecksOutProjectSource({job, projectId, noDefaultCheckout}))) return;
  // A job that checks out the project by id on a managed project has no default repository.
  const connectionId = defaults?.defaultCheckout?.connectionId ?? project.sourceConnectionId;
  const connection = await params.integrations.resolveConnectionById({connectionId});
  if (connection === null || connection === undefined) {
    throw new SourceConnectionUnavailableError(projectId, connectionId, 'missing');
  }
  if (connection.lifecycleStatus !== 'active') {
    throw new SourceConnectionUnavailableError(projectId, connectionId, connection.lifecycleStatus);
  }
}
