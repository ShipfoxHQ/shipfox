import type {WorkflowModel} from '@shipfox/api-definitions-dto';
import type {IntegrationsModuleClient} from '@shipfox/api-integration-core-dto/inter-module';
import type {ProjectsModuleClient} from '@shipfox/api-projects-dto/inter-module';
import {SourceConnectionUnavailableError} from './errors.js';
import {jobChecksOutProjectSource} from './step-config/index.js';

export interface AssertProjectSourceAdmitsParams {
  model: WorkflowModel;
  /** The jobs to admit. Undefined admits every job of the model. */
  jobKeys?: readonly string[] | undefined;
  projectId: string;
  projects: Pick<ProjectsModuleClient, 'getProjectById'>;
  integrations: Pick<IntegrationsModuleClient, 'resolveConnectionById'>;
}

/**
 * Work that checks out the project's source cannot start while that connection is gone or not
 * active. It holds for any provider, so a disabled connection blocks the same way.
 */
export async function assertProjectSourceAdmits(
  params: AssertProjectSourceAdmitsParams,
): Promise<void> {
  const {model, jobKeys, projectId} = params;
  const needsSource = model.jobs
    .filter((job) => jobKeys === undefined || jobKeys.includes(job.key))
    .some((job) => jobChecksOutProjectSource({job, projectId}));
  if (!needsSource) return;

  const {project} = await params.projects.getProjectById({projectId});
  if (project === null || project === undefined) {
    throw new SourceConnectionUnavailableError(projectId, null, 'missing');
  }
  const connection = await params.integrations.resolveConnectionById({
    connectionId: project.sourceConnectionId,
  });
  if (connection === null || connection === undefined) {
    throw new SourceConnectionUnavailableError(projectId, project.sourceConnectionId, 'missing');
  }
  if (connection.lifecycleStatus !== 'active') {
    throw new SourceConnectionUnavailableError(
      projectId,
      project.sourceConnectionId,
      connection.lifecycleStatus,
    );
  }
}
