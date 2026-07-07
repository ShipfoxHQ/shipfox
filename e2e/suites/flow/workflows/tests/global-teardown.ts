import {deleteOrg} from '@shipfox/e2e-driver-gitea';
import {stopFakeOpenAiModelProvider} from '@shipfox/e2e-driver-model-provider';
import {readSuiteContext, suiteFailed} from '#suite-context.js';

export default async function globalTeardown(): Promise<void> {
  const failed = suiteFailed();
  let context: ReturnType<typeof readSuiteContext>;
  try {
    context = readSuiteContext();
  } catch {
    return;
  }

  await stopFakeOpenAiModelProvider({runId: context.fakeModelProviderRunId}).catch(
    (error: unknown) => {
      process.stderr.write(
        `platform-e2e teardown: stopFakeOpenAiModelProvider failed: ${String(error)}\n`,
      );
    },
  );

  // Keep gitea state on failure for inspection; a fully green run deletes its org,
  // which cascades to its repos. Leaked orgs are harmless: names are unique and a
  // compose volume reset wipes the instance.
  if (failed) {
    process.stdout.write(
      `platform-e2e teardown: run had failures; keeping gitea org ${context.org}\n`,
    );
    return;
  }
  await deleteOrg({org: context.org}).catch((error: unknown) => {
    process.stderr.write(`platform-e2e teardown: deleteOrg failed: ${String(error)}\n`);
  });
}
