import * as Sentry from '@sentry/node';
import {setOpenTelemetryContextAsyncContextStrategy} from '@sentry/opentelemetry';
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

// Shipfox owns the OpenTelemetry SDK, so only bind Sentry scopes to its async context.
setOpenTelemetryContextAsyncContextStrategy();

Sentry.setTag('image', image);
Sentry.setTag('image-name', imageName);
Sentry.setTag('image-tag', imageTag);
