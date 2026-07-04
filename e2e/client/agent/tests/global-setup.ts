import {preflightCheck} from '@shipfox/e2e-core';
import {requireOllamaModel} from '@shipfox/e2e-helper-agent';

export default async function globalSetup(): Promise<void> {
  await preflightCheck();
  await requireOllamaModel();
}
