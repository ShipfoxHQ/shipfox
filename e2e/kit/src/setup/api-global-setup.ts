import {preflightCheck} from '@shipfox/e2e-core';

export default async function apiGlobalSetup(): Promise<void> {
  await preflightCheck({requireClient: false});
}
