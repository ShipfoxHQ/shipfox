import {getServiceMetricsProvider} from '@shipfox/node-opentelemetry';
import {countAllOpenImpersonationWindows} from '#db/impersonation-windows.js';

export interface AuthServiceMetricsReader {
  countOpenImpersonationWindows(): Promise<number>;
}

export function registerAuthServiceMetrics(
  reader: AuthServiceMetricsReader = {
    countOpenImpersonationWindows: countAllOpenImpersonationWindows,
  },
): void {
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
