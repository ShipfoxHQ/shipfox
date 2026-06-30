import type {ProvisionedRunnerLaunch, ProvisionerIdentity} from '@shipfox/provisioner-core';
import {canonicalizeLabels, parseLabelList} from '@shipfox/runner-labels';
import type {DockerContainerView} from '#docker-engine.js';
import type {DockerTemplateSpec} from '#templates.js';

const LEADING_SLASH = /^\//;

export const SHIPFOX_LABELS = {
  provisionedRunnerId: 'shipfox.provisioned_runner_id',
  provisionerId: 'shipfox.provisioner_id',
  reservationId: 'shipfox.reservation_id',
  templateKey: 'shipfox.template_key',
  workspaceId: 'shipfox.workspace_id',
  labels: 'shipfox.labels',
} as const;

export interface ParsedContainerIdentity {
  readonly provisionedRunnerId: string;
  readonly provisionerId?: string;
  readonly reservationId?: string;
  readonly templateKey?: string;
  readonly workspaceId?: string;
  readonly labels: readonly string[];
}

export function buildContainerLabels(args: {
  launch: ProvisionedRunnerLaunch<DockerTemplateSpec>;
  identity: ProvisionerIdentity;
}): Record<string, string> {
  return {
    [SHIPFOX_LABELS.provisionedRunnerId]: args.launch.provisionedRunnerId,
    [SHIPFOX_LABELS.provisionerId]: args.identity.id,
    [SHIPFOX_LABELS.reservationId]: args.launch.reservationId,
    [SHIPFOX_LABELS.templateKey]: args.launch.template.key,
    [SHIPFOX_LABELS.workspaceId]: args.identity.workspaceId,
    [SHIPFOX_LABELS.labels]: args.launch.template.labels.join(','),
  };
}

export function parseContainerIdentity(
  view: Pick<DockerContainerView, 'name' | 'labels'>,
): ParsedContainerIdentity {
  const provisionedRunnerId =
    view.labels[SHIPFOX_LABELS.provisionedRunnerId] ?? view.name.replace(LEADING_SLASH, '');
  const labels = canonicalizeLabels(parseLabelList(view.labels[SHIPFOX_LABELS.labels] ?? ''));

  return {
    provisionedRunnerId,
    ...(view.labels[SHIPFOX_LABELS.provisionerId]
      ? {provisionerId: view.labels[SHIPFOX_LABELS.provisionerId]}
      : {}),
    ...(view.labels[SHIPFOX_LABELS.reservationId]
      ? {reservationId: view.labels[SHIPFOX_LABELS.reservationId]}
      : {}),
    ...(view.labels[SHIPFOX_LABELS.templateKey]
      ? {templateKey: view.labels[SHIPFOX_LABELS.templateKey]}
      : {}),
    ...(view.labels[SHIPFOX_LABELS.workspaceId]
      ? {workspaceId: view.labels[SHIPFOX_LABELS.workspaceId]}
      : {}),
    labels,
  };
}
