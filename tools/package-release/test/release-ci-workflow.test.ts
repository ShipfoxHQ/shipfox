import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parse} from 'yaml';

const packageDirectory = dirname(fileURLToPath(import.meta.url));
const workflowPath = resolve(packageDirectory, '../../../.github/workflows/ci.yml');
const mainRefConditionPattern = /github\.ref == 'refs\/heads\/main'/;
const npmPublicationPattern = /release:publish|publish:closure|changeset publish|npm publish/u;
const pullRequestBaseExpression =
  '${{' + " github.event_name == 'pull_request' && github.event.pull_request.base.sha || '' }}";
const pullRequestRequiredExpression =
  '${{' + " github.event_name == 'pull_request' && needs.release-mode.outputs.mode != 'normal' }}";
const e2eRunCondition =
  "always() && (needs.release-mode.result != 'success' || needs.release-mode.outputs.mode == 'normal')";

function readWorkflow() {
  return readFile(workflowPath, 'utf8');
}

describe('generated release CI path', () => {
  test('uses deterministic classification only for release PR fixture data', async () => {
    const workflow = await readWorkflow();

    assert.ok(workflow.includes('release-classification:'));
    assert.ok(workflow.includes('--base "$BASE_SHA"'));
    assert.ok(workflow.includes('--head "$HEAD_SHA"'));
    assert.ok(workflow.includes('steps.release-app-token.outputs.app-slug'));
    assert.ok(workflow.includes('gh api "/users/$' + '{RELEASE_APP_SLUG}[bot]" --jq .id'));
    assert.ok(workflow.includes('--release-app-id "$RELEASE_BOT_USER_ID"'));
    assert.ok(workflow.includes('generated_release=false'));
    assert.ok(workflow.includes('classification" == generated-release'));
  });

  test('runs normal CI for normal, malformed, and main-push fixture conditions', async () => {
    const workflow = await readWorkflow();

    assert.ok(workflow.includes('mode=normal'));
    assert.ok(workflow.includes("needs.release-mode.outputs.mode == 'normal'"));
    assert.ok(
      workflow.includes(
        "needs.release-mode.result != 'success' || needs.release-mode.outputs.mode == 'normal'",
      ),
    );
  });

  test('classifies version-only main commits and reuses immutable image digests', async () => {
    const workflow = await readWorkflow();
    const parsedWorkflow = parse(workflow);
    const releaseClassification = parsedWorkflow.jobs['release-classification'];
    const imageClassification = parsedWorkflow.jobs['release-image-classification'];

    assert.ok(workflow.includes('classify-main'));
    assert.ok(workflow.includes('package-release-workflow.mjs classify-main'));
    assert.ok(workflow.includes('release-mode:'));
    assert.equal(releaseClassification.permissions, undefined);
    assert.equal(imageClassification.permissions.packages, 'read');
    assert.match(imageClassification.if, mainRefConditionPattern);
    assert.ok(workflow.includes('mode=version-only-main'));
    assert.ok(workflow.includes('version_only_previous_revision'));
    assert.ok(workflow.includes('steps.classify-images.outputs.version_only_main'));
    assert.ok(workflow.includes('verify-image-reuse'));
    assert.ok(workflow.includes('--image-repository ghcr.io/shipfoxhq/api'));
    assert.ok(workflow.includes('--image-repository ghcr.io/shipfoxhq/client'));
    assert.ok(workflow.includes('--image-repository ghcr.io/shipfoxhq/provisioner-docker'));
    assert.ok(workflow.includes('--image-repository ghcr.io/shipfoxhq/provisioner-ec2'));
    assert.ok(workflow.includes('--image-repository ghcr.io/shipfoxhq/runner'));
    assert.ok(workflow.includes('Reuse previous application image digest'));
    assert.ok(workflow.includes("needs.release-mode.outputs.mode == 'version-only-main'"));
    assert.ok(
      workflow.includes(
        "needs.release-mode.outputs.mode == 'version-only-main' && needs.external-package-contracts.result == 'skipped'",
      ),
    );
    assert.ok(
      workflow.includes(
        'previous_reference="$APPLICATION_IMAGE_REPOSITORY:revision-$PREVIOUS_REVISION"',
      ),
    );
    assert.ok(workflow.includes('for tag in "revision-$GITHUB_SHA" "sha-$' + '{GITHUB_SHA:0:7}"'));
    assert.ok(workflow.includes('revision-$GITHUB_SHA'));
    assert.ok(workflow.includes('Claim immutable application image revision tag'));
    assert.ok(workflow.includes('Retag existing application image for this revision'));
    assert.ok(!workflow.includes('previous_reference="$APPLICATION_IMAGE_REPOSITORY:sha-'));
    assert.ok(workflow.includes('oras tag "$APPLICATION_IMAGE_REPOSITORY@$digest"'));
    assert.ok(workflow.includes('--reuse-from-revision "$PREVIOUS_REVISION"'));
    assert.ok(workflow.includes('application image rebuilds, and Packer runner candidates'));
  });

  test('keeps version-only static verification independent from publication timing', async () => {
    const workflow = await readWorkflow();
    const parsedWorkflow = parse(workflow);
    const staticVerification = parsedWorkflow.jobs['static-verification'];

    assert.equal(
      staticVerification.env.SHIPFOX_PUBLICATION_REGISTRY_BASE,
      pullRequestBaseExpression,
    );
    assert.equal(
      staticVerification.env.SHIPFOX_PUBLICATION_REGISTRY_REQUIRED,
      pullRequestRequiredExpression,
    );
  });

  test('keeps required checks successful when the image matrix is intentionally skipped', async () => {
    const workflow = await readWorkflow();

    assert.ok(workflow.includes('name: Static verification'));
    assert.ok(workflow.includes('name: Unit and story tests'));
    assert.ok(workflow.includes('name: E2E tests'));
    assert.ok(workflow.includes('name: Build images'));
    assert.ok(
      workflow.includes('needs.release-mode.outputs.mode }}" = "generated-release"') &&
        workflow.includes('needs.build-image.result }}" = "skipped"'),
    );
  });

  test('publishes a package candidate only after normal main CI passes', async () => {
    const parsedWorkflow = parse(await readWorkflow());
    const candidate = parsedWorkflow.jobs['publish-package-candidate'];
    const steps: Array<{name: string; if?: string; run?: string}> = candidate.steps;
    const stepIndex = (name: string) => steps.findIndex((step) => step.name === name);

    assert.deepEqual(candidate.needs, [
      'release-mode',
      'static-verification',
      'external-package-contracts',
      'publication-preflight',
      'tests',
      'e2e',
    ]);
    assert.ok(candidate.if.includes("github.event_name == 'push'"));
    assert.match(candidate.if, mainRefConditionPattern);
    assert.ok(candidate.if.includes("needs.release-mode.outputs.mode == 'normal'"));
    for (const job of candidate.needs.slice(1)) {
      assert.ok(candidate.if.includes(`needs.${job}.result == 'success'`), job);
    }
    assert.deepEqual(candidate.permissions, {contents: 'read'});
    assert.ok(
      stepIndex('Pack candidate bundle') < stepIndex('Check packing restored the working tree'),
    );
    assert.ok(
      stepIndex('Check packing restored the working tree') < stepIndex('Upload candidate bundle'),
    );
    assert.ok(stepIndex('Upload candidate bundle') < stepIndex('Notify Cloud'));
    for (const name of ['Mint Cloud dispatch token', 'Notify Cloud']) {
      assert.equal(steps[stepIndex(name)]?.if, "steps.upload.outputs.pointer_advanced == 'true'");
    }
    assert.ok(steps.every((step) => !npmPublicationPattern.test(step.run ?? '')));
  });

  test('reports the E2E suite matrix through one required check', async () => {
    const parsedWorkflow = parse(await readWorkflow());
    const e2eCheck = parsedWorkflow.jobs.e2e;
    const e2eSuites = parsedWorkflow.jobs['e2e-suite'];

    assert.equal(e2eCheck.name, 'E2E tests');
    assert.ok(e2eCheck.needs.includes('e2e-suite'));
    assert.equal(e2eCheck.if, e2eRunCondition);
    assert.equal(e2eSuites.if, e2eRunCondition);
  });
});
