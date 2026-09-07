import {defaultModules, runServer} from '@shipfox/api-server';
import {config as apiConfig} from '@shipfox/api-server/config';
import {closeErrorMonitoring, reportError} from '@shipfox/node-error-monitoring';
import {logger} from '@shipfox/node-opentelemetry';

const STARTUP_ERROR_MONITORING_SHUTDOWN_TIMEOUT_MS = 2_000;
try {
  const e2eManagedProviderBaseUrl =
    apiConfig.E2E_ENABLED && apiConfig.E2E_ADMIN_API_KEY
      ? apiConfig.E2E_MANAGED_PROVIDER_BASE_URL
      : undefined;
  const e2eManagedInference =
    e2eManagedProviderBaseUrl === undefined
      ? undefined
      : (await import('./e2e-managed-inference.js')).createE2eManagedInferenceProvider(
          e2eManagedProviderBaseUrl,
        );
  await runServer({
    modules: await defaultModules(
      e2eManagedInference === undefined
        ? {}
        : {
            agentModuleOptions: {managedProvider: e2eManagedInference.provider},
            extension: () => [e2eManagedInference.module],
          },
    ),
    onStartupFailure: (error) => {
      reportError(error, {boundary: 'api.startup'});
    },
  });
} catch (error) {
  logger().error({error}, 'Fatal startup error');
  reportError(error, {boundary: 'api.startup'});
  try {
    await closeErrorMonitoring(STARTUP_ERROR_MONITORING_SHUTDOWN_TIMEOUT_MS);
  } finally {
    process.exit(1);
  }
}
