import {resolve} from 'node:path';
import {writeProductionWorkflowBundle} from '../bundle.js';

export async function runBundleCommand(entrypoints: string[]): Promise<void> {
  if (!entrypoints.length) {
    throw new Error(
      'Usage: shipfox-temporal-bundle <workflow-entrypoint> [...workflow-entrypoint]',
    );
  }

  for (const entrypoint of entrypoints) {
    await writeProductionWorkflowBundle(resolve(entrypoint));
  }
}
