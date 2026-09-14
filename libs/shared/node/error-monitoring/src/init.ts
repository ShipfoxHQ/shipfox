import {context} from '@opentelemetry/api';
import * as Sentry from '@sentry/node';
import {
  SentryAsyncLocalStorageContextManager,
  setOpenTelemetryContextAsyncContextStrategy,
} from '@sentry/opentelemetry';
import {config} from './config.js';

const image = config.SENTRY_IMAGE;
const [imageName, imageTag] = image?.split(':') ?? [];
const release = imageTag?.split('-')[0];

Sentry.init({
  dsn: config.SENTRY_DSN,
  environment: config.SENTRY_ENVIRONMENT,
  release,
  sendDefaultPii: false,
  skipOpenTelemetrySetup: true,
});

// The OpenTelemetry preload runs first. Replace its default manager before the app graph loads
// so OpenTelemetry spans and Sentry scopes share one async context.
context.disable();
context.setGlobalContextManager(new SentryAsyncLocalStorageContextManager().enable());
setOpenTelemetryContextAsyncContextStrategy();

Sentry.setTag('image', image);
Sentry.setTag('image-name', imageName);
Sentry.setTag('image-tag', imageTag);
