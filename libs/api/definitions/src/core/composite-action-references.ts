import {
  type ActionManifest,
  actionPathRelativePart,
  isCompositeActionManifest,
  parseWorkflowActionRef,
  WORKFLOW_ACTION_PATH_PREFIX,
} from '@shipfox/workflow-document';

export type CompositeUsesResult = {ok: true; key: string} | {ok: false; message: string};

/**
 * Resolves a `uses` inside a composite action to the key resolved actions are
 * stored under: `./` from the repository root, `${{ action.path }}/` inside
 * the composite directory, and registry references as written. A registry
 * composite can only use registry actions.
 */
export function resolveCompositeUses(params: {
  uses: string;
  /** The key of the composite action that holds the step. */
  parentKey: string;
  parentIsRegistry: boolean;
}): CompositeUsesResult {
  const relativePath = actionPathRelativePart(params.uses);
  if (relativePath !== undefined) {
    if (params.parentIsRegistry) {
      return {
        ok: false,
        message: `A registry composite action cannot use \`${WORKFLOW_ACTION_PATH_PREFIX}\` in \`uses\`. It can use registry actions only.`,
      };
    }
    return {ok: true, key: `${params.parentKey}/${relativePath}`};
  }

  const ref = parseWorkflowActionRef(params.uses);
  if (!ref.ok) return {ok: false, message: ref.message};
  if (ref.ref.kind === 'local' && params.parentIsRegistry) {
    return {
      ok: false,
      message: 'A registry composite action can use registry actions only, not repository paths.',
    };
  }
  return {ok: true, key: params.uses};
}

/** The `uses` of each step of a composite action, in step order. */
export function compositeActionUses(
  manifest: ActionManifest,
): readonly {stepIndex: number; uses: string}[] {
  if (!isCompositeActionManifest(manifest)) return [];
  return manifest.steps.flatMap((step, stepIndex) =>
    step.uses === undefined ? [] : [{stepIndex, uses: step.uses}],
  );
}
