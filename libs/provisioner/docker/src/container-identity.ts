import type {ProviderRunnerLaunch, ProvisionerIdentity} from '@shipfox/provisioner-core';
import {canonicalizeLabels, parseLabelList} from '@shipfox/runner-labels';
import type {DockerContainerView} from '#docker-engine.js';
import type {DockerTemplateSpec} from '#templates.js';

const LEADING_SLASH = /^\//;

export const SHIPFOX_LABELS = {
  runnerInstanceId: 'shipfox.runner_instance_id',
  providerRunnerId: 'shipfox.provider_runner_id',
  provisionerId: 'shipfox.provisioner_id',
  reservationId: 'shipfox.reservation_id',
  templateKey: 'shipfox.template_key',
  workspaceId: 'shipfox.workspace_id',
  labels: 'shipfox.labels',
} as const;

export interface ParsedContainerIdentity {
  readonly runnerInstanceId?: string;
  readonly providerRunnerId: string;
  readonly provisionerId?: string;
  readonly reservationId?: string;
  readonly templateKey?: string;
  readonly workspaceId?: string;
  readonly labels: readonly string[];
}

export function buildContainerLabels(args: {
  launch: ProviderRunnerLaunch<DockerTemplateSpec>;
  identity: ProvisionerIdentity;
}): Record<string, string> {
  return {
    [SHIPFOX_LABELS.runnerInstanceId]: args.launch.runnerInstanceId ?? args.launch.providerRunnerId,
    [SHIPFOX_LABELS.providerRunnerId]: args.launch.providerRunnerId,
    [SHIPFOX_LABELS.provisionerId]: args.identity.id,
    ...(args.launch.reservationId
      ? {[SHIPFOX_LABELS.reservationId]: args.launch.reservationId}
      : {}),
    [SHIPFOX_LABELS.templateKey]: args.launch.template.key,
    ...(args.identity.workspaceId ? {[SHIPFOX_LABELS.workspaceId]: args.identity.workspaceId} : {}),
    [SHIPFOX_LABELS.labels]: args.launch.template.labels.join(','),
  };
}

export function parseContainerIdentity(
  view: Pick<DockerContainerView, 'name' | 'labels'>,
): ParsedContainerIdentity {
  const providerRunnerId =
    view.labels[SHIPFOX_LABELS.providerRunnerId] ?? view.name.replace(LEADING_SLASH, '');
  const labels = canonicalizeLabels(parseLabelList(view.labels[SHIPFOX_LABELS.labels] ?? ''));

  return {
    ...(view.labels[SHIPFOX_LABELS.runnerInstanceId]
      ? {runnerInstanceId: view.labels[SHIPFOX_LABELS.runnerInstanceId]}
      : {}),
    providerRunnerId,
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
