import {
  computeActionBump,
  parseRegistryVersion,
  type RegistryBump,
  type RegistryPackageKind,
} from '@shipfox/registry-format';
import {actionManifestSchema} from '@shipfox/workflow-document';
import {computeTemplateBump, workflowTemplateManifestSchema} from '@shipfox/workflow-templates';

const BUMP_RANK: Record<RegistryBump, number> = {patch: 0, minor: 1, major: 2};

export function bumpRank(bump: RegistryBump): number {
  return BUMP_RANK[bump];
}

export function maxBump(a: RegistryBump, b: RegistryBump): RegistryBump {
  return bumpRank(b) > bumpRank(a) ? b : a;
}

/** The minimum bump between two stored manifests, by the rules the registry applies. */
export function computeMinimumBump({
  kind,
  previous,
  next,
}: {
  kind: RegistryPackageKind;
  previous: Record<string, unknown>;
  next: Record<string, unknown>;
}): RegistryBump {
  if (kind === 'template') {
    return computeTemplateBump({
      previous: workflowTemplateManifestSchema.parse(previous),
      next: workflowTemplateManifestSchema.parse(next),
    });
  }
  return computeActionBump({
    previous: actionManifestSchema.parse(previous),
    next: actionManifestSchema.parse(next),
  });
}

/** The bump a version change represents: the highest component that changed. */
export function versionBump({previous, next}: {previous: string; next: string}): RegistryBump {
  const before = parseRegistryVersion(previous);
  const after = parseRegistryVersion(next);
  if (!(before && after)) throw new TypeError(`${previous} or ${next} is not an exact version`);
  if (after.major !== before.major) return 'major';
  if (after.minor !== before.minor) return 'minor';
  return 'patch';
}
