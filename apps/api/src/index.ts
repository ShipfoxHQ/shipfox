import {defaultModules, runServer} from '@shipfox/api-server';
import {closeErrorMonitoring, reportError} from '@shipfox/node-error-monitoring';
import {logger} from '@shipfox/node-opentelemetry';

const STARTUP_ERROR_MONITORING_SHUTDOWN_TIMEOUT_MS = 2_000;
try {
  await runServer({
    modules: await defaultModules(),
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
