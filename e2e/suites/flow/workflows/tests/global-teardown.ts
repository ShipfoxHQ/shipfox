import {deleteOrg} from '@shipfox/e2e-driver-gitea';
import {readSuiteContext, suiteFailed} from '#suite-context.js';

export default async function globalTeardown(): Promise<void> {
  const failed = suiteFailed();
  let org: string;
  try {
    org = readSuiteContext().org;
  } catch {
    return;
  }

  // Keep gitea state on failure for inspection; a fully green run deletes its org,
  // which cascades to its repos. Leaked orgs are harmless: names are unique and a
  // compose volume reset wipes the instance.
  if (failed) {
    process.stdout.write(`platform-e2e teardown: run had failures; keeping gitea org ${org}\n`);
    return;
  }
  await deleteOrg({org}).catch((error: unknown) => {
    process.stderr.write(`platform-e2e teardown: deleteOrg failed: ${String(error)}\n`);
  });
}
