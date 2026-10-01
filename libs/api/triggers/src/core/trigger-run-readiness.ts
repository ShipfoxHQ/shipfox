import type {WorkflowsModuleClient} from '@shipfox/api-workflows-dto/inter-module';
import {readConfigSecretInputs} from './config.js';
import type {TriggerSubscription} from './entities/subscription.js';

type DefinitionReadiness = Awaited<
  ReturnType<WorkflowsModuleClient['checkRunReadiness']>
>['definitions'][number];

export type RunSecretInputReference = DefinitionReadiness['secretInputs'][number];

export interface RunIssueTrigger {
  source: string;
  event?: string;
  name: string;
}

export type TriggerRunIssue =
  | {
      kind: 'trigger-secret-missing';
      key: string;
      trigger: RunIssueTrigger;
      effect: 'blocks-start';
    }
  | {
      kind: 'secret-input-unmapped';
      key: string;
      trigger: RunIssueTrigger;
      locations: RunSecretInputReference['locations'];
      moreLocations?: number;
      effect: 'fails-job';
    };

/** True when a trigger maps secrets, so its sources have to be looked up to check them. */
export function subscriptionMapsSecrets(subscription: TriggerSubscription): boolean {
  return Object.keys(readConfigSecretInputs(subscription) ?? {}).length > 0;
}

/**
 * Report what one trigger's `secrets:` mapping leaves unmet for its workflow. Mirrors the fire
 * paths: they pin each mapped source, so a source defined at neither project nor workspace
 * scope refuses the start, and a `secrets.inputs.K` the mapping omits fails the step that reads
 * it. `definedSecretNames` is the union of both scopes, as `getSecret` resolves them.
 */
export function checkTriggerSecretReadiness(params: {
  subscription: TriggerSubscription;
  secretInputs: readonly RunSecretInputReference[];
  definedSecretNames: ReadonlySet<string>;
}): TriggerRunIssue[] {
  const {subscription, secretInputs, definedSecretNames} = params;
  const mapping = readConfigSecretInputs(subscription) ?? {};
  const trigger: RunIssueTrigger = {
    source: subscription.source,
    ...(subscription.event === null ? {} : {event: subscription.event}),
    name: subscription.name,
  };

  const missingSources = [...new Set(Object.values(mapping))].filter(
    (source) => !definedSecretNames.has(source),
  );

  return [
    ...missingSources.map(
      (key): TriggerRunIssue => ({
        kind: 'trigger-secret-missing',
        key,
        trigger,
        effect: 'blocks-start',
      }),
    ),
    ...secretInputs
      .filter(({key}) => !Object.hasOwn(mapping, key))
      .map(
        ({key, locations, moreLocations}): TriggerRunIssue => ({
          kind: 'secret-input-unmapped',
          key,
          trigger,
          locations,
          ...(moreLocations === undefined ? {} : {moreLocations}),
          effect: 'fails-job',
        }),
      ),
  ];
}
