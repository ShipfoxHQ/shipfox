import {getServiceMetricsProvider} from '@shipfox/node-opentelemetry';
import type {Ec2Engine, Ec2InstanceState} from '#ec2-engine.js';

export interface RegisterEc2ServiceMetricsOptions {
  readonly engine: Ec2Engine;
  readonly provisionerId: string;
}

export function registerEc2ServiceMetrics(options: RegisterEc2ServiceMetricsOptions): void {
  const meter = getServiceMetricsProvider().getMeter('provisioner-ec2');
  const managedInstances = meter.createObservableGauge<{
    state: Ec2InstanceState;
  }>('ec2_provisioner_managed_instances', {
    description: 'EC2 runner instances currently managed by the provisioner, by EC2 state',
  });

  meter.addBatchObservableCallback(
    async (observer) => {
      const instances = await options.engine.listManaged(options.provisionerId);
      const counts = new Map<Ec2InstanceState, number>();
      for (const instance of instances)
        counts.set(instance.state, (counts.get(instance.state) ?? 0) + 1);
      for (const [state, count] of counts) observer.observe(managedInstances, count, {state});
    },
    [managedInstances],
  );
}
