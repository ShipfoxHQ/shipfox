export {addEventProcessor, captureException, close as closeErrorMonitoring} from '@sentry/node';
export {
  type ErrorReportContext,
  isErrorReported,
  markErrorReported,
  reportError,
} from './report-error.js';
