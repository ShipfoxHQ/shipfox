import type {IntegrationSourceControlService} from '@shipfox/api-integration-core';

// Boot-set holder for the integration source-control service, mirroring the db()
// singleton. The composition root injects it once at startup; routes read it.
// Workflows cannot construct the service itself (it needs the integration provider
// registry and connection lookup that live in @shipfox/api-integration-core).
let _sourceControl: IntegrationSourceControlService | undefined;

export function setSourceControl(service: IntegrationSourceControlService): void {
  _sourceControl = service;
}

export function sourceControl(): IntegrationSourceControlService {
  if (!_sourceControl) {
    throw new Error('workflows: source-control integration is not configured');
  }
  return _sourceControl;
}
