import {getServiceMetricsProvider} from '@shipfox/node-opentelemetry';

export interface AuthServiceMetricsReader {
  countOpenImpersonationWindows(): Promise<number>;
}

export function registerAuthServiceMetrics(reader: AuthServiceMetricsReader): void {
  const meter = getServiceMetricsProvider().getMeter('auth');
  const openImpersonationWindows = meter.createObservableGauge('auth_impersonation_windows_open', {
    description: 'Impersonation windows currently open across all actors',
  });

  meter.addBatchObservableCallback(
    async (observer) => {
      observer.observe(openImpersonationWindows, await reader.countOpenImpersonationWindows());
    },
    [openImpersonationWindows],
  );
}
