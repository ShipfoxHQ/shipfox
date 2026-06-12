import type {IntegrationSourceControlService} from '@shipfox/api-integration-core';
import {setSourceControl, sourceControl} from './source-control.js';

describe('sourceControl', () => {
  it('returns the configured service', () => {
    const service = {} as IntegrationSourceControlService;
    setSourceControl(service);

    expect(sourceControl()).toBe(service);
  });

  it('throws when the source-control integration is not configured', () => {
    setSourceControl(undefined as unknown as IntegrationSourceControlService);

    expect(() => sourceControl()).toThrow('source-control integration is not configured');
  });
});
