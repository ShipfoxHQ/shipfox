import {Buffer} from 'node:buffer';
import {
  COMPOSITE_ACTION_MAX_BYTES,
  COMPOSITE_ACTION_MAX_FILES,
  collectCompositeActions,
} from '@shipfox/registry-format';
import {
  type ActionBundleFile,
  type ActionManifest,
  actionManifestSchema,
  isCompositeActionManifest,
} from '@shipfox/workflow-document';
import {parse as parseYaml} from 'yaml';
import {VersionRefusedError} from '#publish/errors.js';
import {describeIssues} from '#publish/issues.js';

const ACTION_MANIFEST_PATH = 'action.yml';
const ACTION_MAIN = 'index.mjs';
const ACTION_POST = 'post.mjs';
const ACTION_FILES = [ACTION_MANIFEST_PATH, ACTION_MAIN, ACTION_POST, 'LICENSE'];

/**
 * Reads an `action-bundle@1`. A JavaScript action holds the manifest, the entry file, the post
 * entry file when the manifest declares one, and a license when present. A composite action holds
 * the manifest and any files its steps read, within the limits of a repository action. `actions`
 * lists the exact registry actions a composite action uses.
 */
export function readActionBundle(files: readonly ActionBundleFile[]): {
  manifest: ActionManifest;
  actions: string[];
} {
  const manifestFile = files.find(({path}) => path === ACTION_MANIFEST_PATH);
  if (!manifestFile) {
    throw new VersionRefusedError(
      'invalid-bundle',
      `An action bundle needs ${ACTION_MANIFEST_PATH}`,
    );
  }
  const manifest = parseManifest(manifestFile.content);
  if (isCompositeActionManifest(manifest)) {
    checkCompositeFiles(files);
    const actions = collectCompositeActions(manifest);
    if (!actions.ok) {
      throw new VersionRefusedError(
        'invalid-manifest',
        `${ACTION_MANIFEST_PATH} uses ${JSON.stringify(actions.uses)}: ${actions.message}`,
      );
    }
    return {manifest, actions: actions.actions};
  }

  checkJavascriptFiles({files, manifest});
  return {manifest, actions: []};
}

function parseManifest(content: string): ActionManifest {
  let document: unknown;
  try {
    document = parseYaml(content);
  } catch (error) {
    throw new VersionRefusedError('invalid-manifest', `${ACTION_MANIFEST_PATH} is not valid YAML`, {
      cause: error,
    });
  }
  const manifest = actionManifestSchema.safeParse(document);
  if (!manifest.success) {
    throw new VersionRefusedError(
      'invalid-manifest',
      `${ACTION_MANIFEST_PATH} is invalid: ${describeIssues(manifest.error)}`,
    );
  }
  return manifest.data;
}

// An instance stores a composite action like a repository action, so it must fit the same limits.
function checkCompositeFiles(files: readonly ActionBundleFile[]): void {
  if (files.length > COMPOSITE_ACTION_MAX_FILES) {
    throw new VersionRefusedError(
      'too-large',
      `A composite action bundle holds at most ${COMPOSITE_ACTION_MAX_FILES} files`,
    );
  }
  const bytes = files.reduce((total, {content}) => total + Buffer.byteLength(content, 'utf8'), 0);
  if (bytes > COMPOSITE_ACTION_MAX_BYTES) {
    throw new VersionRefusedError(
      'too-large',
      `A composite action bundle holds at most ${COMPOSITE_ACTION_MAX_BYTES} bytes of files`,
    );
  }
}

function checkJavascriptFiles({
  files,
  manifest,
}: {
  files: readonly ActionBundleFile[];
  manifest: ActionManifest;
}): void {
  const unexpected = files.find(({path}) => !ACTION_FILES.includes(path));
  if (unexpected) {
    throw new VersionRefusedError(
      'invalid-bundle',
      `An action bundle holds ${ACTION_FILES.join(', ')} only, not ${JSON.stringify(unexpected.path)}`,
    );
  }
  if (!files.some(({path}) => path === ACTION_MAIN)) {
    throw new VersionRefusedError(
      'invalid-bundle',
      `An action bundle needs ${ACTION_MANIFEST_PATH} and ${ACTION_MAIN}`,
    );
  }
  if (manifest.main !== ACTION_MAIN) {
    throw new VersionRefusedError('invalid-manifest', `An action's main must be ${ACTION_MAIN}`);
  }
  const {post} = manifest;
  if (post !== undefined && post !== ACTION_POST) {
    throw new VersionRefusedError('invalid-manifest', `An action's post must be ${ACTION_POST}`);
  }
  if ((post !== undefined) !== files.some(({path}) => path === ACTION_POST)) {
    throw new VersionRefusedError(
      'invalid-bundle',
      `An action bundle holds ${ACTION_POST} if and only if its manifest sets post`,
    );
  }
}
