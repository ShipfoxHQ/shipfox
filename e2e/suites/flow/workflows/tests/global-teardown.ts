import {stopFakeOpenAiProvider} from '@shipfox/e2e-driver-agent-provider';
import {deleteOrg} from '@shipfox/e2e-driver-gitea';
import {readSuiteContext, suiteFailed} from '#suite-context.js';

export default async function globalTeardown(): Promise<void> {
  const failed = suiteFailed();
  let suite: ReturnType<typeof readSuiteContext>;
  try {
    suite = readSuiteContext();
  } catch {
    return;
  }

  await stopFakeOpenAiProvider({runId: suite.runId}).catch((error: unknown) => {
    process.stderr.write(
      `platform-e2e teardown: stopFakeOpenAiProvider failed: ${String(error)}\n`,
    );
  });

  // Keep gitea state on failure for inspection; a fully green run deletes its org,
  // which cascades to its repos. Leaked orgs are harmless: names are unique and a
  // compose volume reset wipes the instance.
  if (failed) {
    process.stdout.write(
      `platform-e2e teardown: run had failures; keeping gitea org ${suite.org}\n`,
    );
    return;
  }

  await deleteOrg({org: suite.org}).catch((error: unknown) => {
    process.stderr.write(`platform-e2e teardown: deleteOrg failed: ${String(error)}\n`);
  });
}
