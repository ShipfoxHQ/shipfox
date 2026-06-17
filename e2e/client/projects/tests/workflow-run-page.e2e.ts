import {argosScreenshot} from '@shipfox/playwright';
import {expect, test} from './test.js';

const testJobName = /^Test\b/u;
const browserSmokeStepName = /\bBrowser smoke\b/u;
const buildJobName = /^Build\b/u;
const installDependenciesStepName = /\bInstall dependencies\b/u;
const jobSearchParamUrl = /[?&]job=/u;
const succeededRunName = /Deploy pipeline succeeded/u;
const runningRunName = /Deploy pipeline running/u;

test('renders real workflow run page scenarios and keeps section interactions in sync', async ({
  page,
  auth,
  workspaces,
  workflows,
}) => {
  const user = await auth.createUser();
  const workspace = await workspaces.create({
    userId: user.user.id,
    name: 'Workflow Run Page Workspace',
  });
  const fixture = await workflows.createRunPageFixture({
    workspaceId: workspace.id,
    projectName: 'Checkout Automation',
  });
  await auth.loginAs(page, user);

  await page.goto(
    projectRunUrl(fixture.project.workspace_id, fixture.project.id, fixture.runs.failed.id),
  );

  const runSummary = page.getByRole('region', {name: 'Workflow run summary'});
  const jobsRegion = page.getByRole('region', {name: 'Workflow jobs'});
  const stepOverview = page.getByLabel('Step overview');

  await expect(page.getByRole('complementary', {name: 'Workflow runs'})).toBeVisible();
  await expect(page.getByRole('main', {name: 'Workflow run details'})).toBeVisible();
  await expect(jobsRegion).toContainText('3 jobs across 1 stage');
  await expect(runSummary.getByText('Deploy pipeline failed')).toBeVisible();
  await expect(jobsRegion.getByRole('button', {name: testJobName})).toBeVisible();
  await expect(page.getByRole('button', {name: browserSmokeStepName})).toBeVisible();
  await expect(stepOverview.getByText('Browser smoke failed on checkout summary')).toBeVisible();
  await expect(
    stepOverview.getByText('turbo test:e2e --filter=@shipfox/e2e-client-projects'),
  ).toBeVisible();
  await argosScreenshot(page, 'projects/workflow-run-page/failed-run');

  await jobsRegion.getByRole('button', {name: buildJobName}).click();
  await expect(page.getByRole('button', {name: installDependenciesStepName})).toHaveAttribute(
    'aria-current',
    'true',
  );
  await expect(stepOverview.getByText('pnpm install --frozen-lockfile')).toBeVisible();
  await expect(page).toHaveURL(jobSearchParamUrl);
  await argosScreenshot(page, 'projects/workflow-run-page/selected-build-job');

  await page.getByRole('button', {name: succeededRunName}).click();
  await expect(runSummary.getByText('Deploy pipeline succeeded')).toBeVisible();
  await expect(page.getByText('Succeeded').first()).toBeVisible();
  await argosScreenshot(page, 'projects/workflow-run-page/succeeded-run');

  await page.getByRole('button', {name: runningRunName}).click();
  await expect(runSummary.getByText('Deploy pipeline running')).toBeVisible();
  await expect(page.getByText('Running').first()).toBeVisible();
  await jobsRegion.getByRole('button', {name: testJobName}).click();
  await expect(page.getByRole('button', {name: browserSmokeStepName})).toBeVisible();
  await argosScreenshot(page, 'projects/workflow-run-page/running-run');
});

function projectRunUrl(workspaceId: string, projectId: string, runId: string): string {
  return `/workspaces/${workspaceId}/projects/${projectId}/runs/${runId}`;
}
