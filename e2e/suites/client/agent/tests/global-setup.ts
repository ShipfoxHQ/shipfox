import globalSetup from '@shipfox/e2e-kit/global-setup';
import {requireOllamaModel} from '@shipfox/e2e-setup-agent';

export default async function agentGlobalSetup(): Promise<void> {
  await globalSetup();
  await requireOllamaModel();
}
