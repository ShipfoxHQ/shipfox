import type {IntegrationSourceControlService} from '@shipfox/api-integration-core';
import {clearSourceControl, setSourceControl, sourceControl} from './source-control.js';

describe('sourceControl', () => {
  it('returns the configured service', () => {
    const service = {} as IntegrationSourceControlService;
    setSourceControl(service);

    expect(sourceControl()).toBe(service);
  });

  it('throws when the source-control integration is not configured', () => {
    clearSourceControl();

    expect(() => sourceControl()).toThrow('source-control integration is not configured');
  });
});
