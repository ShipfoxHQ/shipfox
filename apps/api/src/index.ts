import {defaultModules, runServer} from '@shipfox/api-server';
import {captureException, closeErrorMonitoring} from '@shipfox/node-error-monitoring';
import {logger} from '@shipfox/node-opentelemetry';

const STARTUP_ERROR_MONITORING_SHUTDOWN_TIMEOUT_MS = 2_000;
let hasReportedRunServerStartupFailure = false;

try {
  await runServer({
    modules: await defaultModules(),
    onStartupFailure: (error) => {
      captureException(error);
      hasReportedRunServerStartupFailure = true;
    },
  });
} catch (error) {
  logger().error({error}, 'Fatal startup error');
  if (!hasReportedRunServerStartupFailure) captureException(error);
  try {
    await closeErrorMonitoring(STARTUP_ERROR_MONITORING_SHUTDOWN_TIMEOUT_MS);
  } finally {
    process.exit(1);
  }
}
