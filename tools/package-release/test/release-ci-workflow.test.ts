import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const packageDirectory = dirname(fileURLToPath(import.meta.url));
const workflowPath = resolve(packageDirectory, '../../../.github/workflows/ci.yml');

function readWorkflow() {
  return readFile(workflowPath, 'utf8');
}

describe('generated release CI path', () => {
  test('uses deterministic classification only for release PR fixture data', async () => {
    const workflow = await readWorkflow();

    assert.ok(workflow.includes('release-classification:'));
    assert.ok(workflow.includes('--base "$BASE_SHA"'));
    assert.ok(workflow.includes('--head "$HEAD_SHA"'));
    assert.ok(workflow.includes('--release-app-id "$RELEASE_BOT_APP_ID"'));
    assert.ok(workflow.includes('generated_release=false'));
    assert.ok(workflow.includes('classification" == generated-release'));
  });

  test('runs normal CI for normal, malformed, and main-push fixture conditions', async () => {
    const workflow = await readWorkflow();

    assert.ok(
      workflow.includes(
        "github.event_name != 'pull_request' || needs.release-classification.outputs.generated_release != 'true'",
      ),
    );
    assert.ok(
      workflow.includes(
        "always() && (github.event_name != 'pull_request' || needs.release-classification.outputs.generated_release != 'true')",
      ),
    );
  });

  test('keeps required checks successful when the image matrix is intentionally skipped', async () => {
    const workflow = await readWorkflow();

    assert.ok(workflow.includes('name: Static verification'));
    assert.ok(workflow.includes('name: Unit and story tests'));
    assert.ok(workflow.includes('name: E2E tests'));
    assert.ok(workflow.includes('name: Build images'));
    assert.ok(
      workflow.includes('needs.release-classification.outputs.generated_release }}" = "true"') &&
        workflow.includes('needs.build-image.result }}" = "skipped"'),
    );
  });
});
