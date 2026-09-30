import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const packageDirectory = dirname(fileURLToPath(import.meta.url));
const workflowsDirectory = resolve(packageDirectory, '../../../.github/workflows');

function readWorkflow(name: string) {
  return readFile(resolve(workflowsDirectory, name), 'utf8');
}

const JOB_HEADER = /^ {2}([a-z][a-z0-9-]*):\s*$/u;

/** Splits a workflow into the text of each top-level job, keyed by job id. */
function jobBlocks(workflow: string): Record<string, string> {
  const jobsStart = workflow.indexOf('\njobs:\n');
  const blocks: Record<string, string> = {};
  let current: string | undefined;
  for (const line of workflow.slice(jobsStart + '\njobs:\n'.length).split('\n')) {
    const header = JOB_HEADER.exec(line);
    if (header?.[1]) {
      current = header[1];
      blocks[current] = '';
    } else if (current) {
      blocks[current] += `${line}\n`;
    }
  }
  return blocks;
}

describe('package release workflows', () => {
  test('cancels superseded release-PR updates without publication authority', async () => {
    const workflow = await readWorkflow('update-release-pr.yml');

    assert.ok(workflow.includes('cancel-in-progress: true'));
    assert.ok(workflow.includes('package-release-workflow.mjs plan'));
    assert.ok(workflow.includes("has_changesets == 'true'"));
    assert.ok(workflow.includes('version: pnpm exec changeset version'));
    assert.ok(!workflow.includes('release:publish'));
    assert.ok(!workflow.includes('id-token: write'));
  });

  test('publishes only exact merged release revisions in non-cancelable isolation', async () => {
    const workflow = await readWorkflow('publish-packages.yml');

    assert.ok(workflow.includes('types: [closed]'));
    assert.ok(workflow.includes('workflow_dispatch:'));
    assert.ok(workflow.includes('Exact merged release revision to recover'));
    assert.ok(workflow.includes('cancel-in-progress: false'));
    assert.ok(workflow.includes('ref: $' + '{{ needs.authorize-release.outputs.revision }}'));
    assert.ok(workflow.includes('verify-generated-release'));
    assert.ok(workflow.includes('SHIPFOX_PUBLICATION_REGISTRY_BASE:'));
    assert.ok(workflow.includes('NPM_CONFIG_PROVENANCE: "true"'));
    assert.ok(workflow.includes('package-release-workflow.mjs authorize'));
    assert.ok(workflow.includes('steps.release-app-token.outputs.app-slug'));
    assert.ok(workflow.includes('gh api "/users/$' + '{RELEASE_APP_SLUG}[bot]" --jq .id'));
    assert.ok(workflow.includes('--release-app-id "$RELEASE_BOT_USER_ID"'));
    assert.ok(
      workflow.indexOf('await-published-versions') > workflow.indexOf('release:publish'),
      'npm readiness must be checked after publication and before the job succeeds',
    );
    assert.ok(
      workflow.indexOf('name: published-versions') > workflow.indexOf('await-published-versions'),
      'the versions artifact must appear only once npm serves every version',
    );
    assert.ok(workflow.includes('path: $' + '{{ runner.temp }}/published-versions.json'));
    assert.equal(
      workflow.match(
        /SHIPFOX_PUBLISHED_VERSIONS_PATH: \$\{\{ runner\.temp \}\}\/published-versions\.json/gu,
      )?.length,
      2,
    );
  });

  test('gates every publisher on one release-tree verification', async () => {
    const workflow = await readWorkflow('publish-packages.yml');
    const jobs = jobBlocks(workflow);

    assert.ok(jobs['verify-release']?.includes('verify-generated-release'));
    assert.equal(workflow.match(/verify-generated-release/gu)?.length, 1);
    for (const name of ['publish', 'publish-registry']) {
      const job = jobs[name];
      assert.ok(job, `${name} job is missing`);
      assert.ok(
        job.includes('needs: [authorize-release, verify-release]'),
        `${name} must wait for verify-release`,
      );
      assert.ok(
        job.includes('ref: $' + '{{ needs.authorize-release.outputs.revision }}'),
        `${name} must check out the authorized revision`,
      );
    }
  });

  test('publishes to the registry from a GitHub-hosted runner without an environment', async () => {
    const workflow = await readWorkflow('publish-packages.yml');
    const job = jobBlocks(workflow)['publish-registry'];

    assert.ok(job);
    assert.ok(job.includes('runs-on: ubuntu-latest'));
    assert.ok(!job.includes('environment:'));
    assert.ok(job.includes('pnpm install --frozen-lockfile'));
    assert.ok(job.includes('cli.js publish'));
    assert.ok(workflow.includes('id-token: write'));
  });
});
