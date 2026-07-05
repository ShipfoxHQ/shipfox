import {requireOllamaModel} from '@shipfox/e2e-helper-agent';
import globalSetup from '@shipfox/e2e-kit/global-setup';

export default async function agentGlobalSetup(): Promise<void> {
  await globalSetup();
  await requireOllamaModel();
}
