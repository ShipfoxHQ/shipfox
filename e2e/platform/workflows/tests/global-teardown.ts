import {deleteOrg} from '@shipfox/e2e-helper-integrations-gitea';
import {stopProvisioner} from '@shipfox/e2e-helper-runners';
import {getProvisionerHandle, readSuiteContext, suiteFailed} from '#suite-context.js';

export default async function globalTeardown(): Promise<void> {
  const handle = getProvisionerHandle();
  if (handle) {
    await stopProvisioner(handle).catch((error: unknown) => {
      process.stderr.write(`platform-e2e teardown: stopProvisioner failed: ${String(error)}\n`);
    });
  }

  let org: string;
  try {
    org = readSuiteContext().org;
  } catch {
    return;
  }

  // Keep gitea state on failure for inspection; a fully green run deletes its org,
  // which cascades to its repos. Leaked orgs are harmless: names are unique and a
  // compose volume reset wipes the instance.
  if (suiteFailed()) {
    process.stdout.write(`platform-e2e teardown: run had failures; keeping gitea org ${org}\n`);
    return;
  }
  await deleteOrg({org}).catch((error: unknown) => {
    process.stderr.write(`platform-e2e teardown: deleteOrg failed: ${String(error)}\n`);
  });
}
