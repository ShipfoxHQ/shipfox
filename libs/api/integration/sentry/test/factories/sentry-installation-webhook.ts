import {Factory} from 'fishery';

// Raw Sentry installation webhook payload, shaped exactly as Sentry delivers it
// over the wire. Tests serialize the built object to form a signed request body;
// the route parses and validates it with the production Zod schema. Build-only —
// the payload is never persisted, so there is no onCreate handler.
export interface SentryInstallationWebhookPayload {
  action: string;
  installation: {uuid: string};
}

export const sentryInstallationWebhookFactory = Factory.define<SentryInstallationWebhookPayload>(
  ({sequence}) => ({
    action: 'created',
    installation: {uuid: `install-${sequence}`},
  }),
);
