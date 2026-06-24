import {captureException, closeErrorMonitoring} from '@shipfox/node-error-monitoring';
import {logger} from '@shipfox/node-opentelemetry';
import {run} from '#core/run.js';

const STARTUP_ERROR_MONITORING_SHUTDOWN_TIMEOUT_MS = 2_000;

try {
  await run();
} catch (error) {
  logger().error({error}, 'Fatal startup error');
  captureException(error);
  try {
    await closeErrorMonitoring(STARTUP_ERROR_MONITORING_SHUTDOWN_TIMEOUT_MS);
  } finally {
    process.exit(1);
  }
}
