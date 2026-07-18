import type {ProvisionedRunnerLaunch, ProvisionerIdentity} from '@shipfox/provisioner-core';
import {canonicalizeLabels, parseLabelList} from '@shipfox/runner-labels';
import type {Ec2TemplateSpec} from '#templates.js';

export const SHIPFOX_TAGS = {
  provisionedRunnerId: 'shipfox.provisioned_runner_id',
  provisionerId: 'shipfox.provisioner_id',
  reservationId: 'shipfox.reservation_id',
  templateKey: 'shipfox.template_key',
  workspaceId: 'shipfox.workspace_id',
  labels: 'shipfox.labels',
} as const;

export interface ParsedInstanceIdentity {
  readonly provisionedRunnerId: string;
  readonly provisionerId?: string;
  readonly reservationId?: string;
  readonly templateKey?: string;
  readonly workspaceId?: string;
  readonly labels: readonly string[];
}

export function buildInstanceTags(args: {
  launch: ProvisionedRunnerLaunch<Ec2TemplateSpec>;
  identity: ProvisionerIdentity;
}): Record<string, string> {
  return {
    [SHIPFOX_TAGS.provisionedRunnerId]: args.launch.provisionedRunnerId,
    [SHIPFOX_TAGS.provisionerId]: args.identity.id,
    [SHIPFOX_TAGS.reservationId]: args.launch.reservationId,
    [SHIPFOX_TAGS.templateKey]: args.launch.template.key,
    [SHIPFOX_TAGS.workspaceId]: args.identity.workspaceId,
    [SHIPFOX_TAGS.labels]: args.launch.template.labels.join(','),
    Name: args.launch.provisionedRunnerId,
  };
}

export function parseInstanceIdentity(view: {
  tags: Readonly<Record<string, string>>;
}): ParsedInstanceIdentity {
  const provisionedRunnerId = view.tags[SHIPFOX_TAGS.provisionedRunnerId] ?? view.tags.Name ?? '';
  const labels = canonicalizeLabels(parseLabelList(view.tags[SHIPFOX_TAGS.labels] ?? ''));

  return {
    provisionedRunnerId,
    ...(view.tags[SHIPFOX_TAGS.provisionerId]
      ? {provisionerId: view.tags[SHIPFOX_TAGS.provisionerId]}
      : {}),
    ...(view.tags[SHIPFOX_TAGS.reservationId]
      ? {reservationId: view.tags[SHIPFOX_TAGS.reservationId]}
      : {}),
    ...(view.tags[SHIPFOX_TAGS.templateKey]
      ? {templateKey: view.tags[SHIPFOX_TAGS.templateKey]}
      : {}),
    ...(view.tags[SHIPFOX_TAGS.workspaceId]
      ? {workspaceId: view.tags[SHIPFOX_TAGS.workspaceId]}
      : {}),
    labels,
  };
}
