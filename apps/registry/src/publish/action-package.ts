import {
  type ActionBundleFile,
  type ActionManifest,
  actionManifestSchema,
} from '@shipfox/workflow-document';
import {parse as parseYaml} from 'yaml';
import {VersionRefusedError} from '#publish/errors.js';
import {describeIssues} from '#publish/issues.js';

const ACTION_MANIFEST_PATH = 'action.yml';
const ACTION_MAIN = 'index.mjs';
const ACTION_POST = 'post.mjs';
const ACTION_FILES = [ACTION_MANIFEST_PATH, ACTION_MAIN, ACTION_POST, 'LICENSE'];

/**
 * Reads an `action-bundle@1`: the manifest, the entry file, the post entry file when the
 * manifest declares one, and a license when present.
 */
export function readActionBundle(files: readonly ActionBundleFile[]): {manifest: ActionManifest} {
  const unexpected = files.find(({path}) => !ACTION_FILES.includes(path));
  if (unexpected) {
    throw new VersionRefusedError(
      'invalid-bundle',
      `An action bundle holds ${ACTION_FILES.join(', ')} only, not ${JSON.stringify(unexpected.path)}`,
    );
  }
  const manifestFile = files.find(({path}) => path === ACTION_MANIFEST_PATH);
  if (!(manifestFile && files.some(({path}) => path === ACTION_MAIN))) {
    throw new VersionRefusedError(
      'invalid-bundle',
      `An action bundle needs ${ACTION_MANIFEST_PATH} and ${ACTION_MAIN}`,
    );
  }

  let document: unknown;
  try {
    document = parseYaml(manifestFile.content);
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
  if (manifest.data.main !== ACTION_MAIN) {
    throw new VersionRefusedError('invalid-manifest', `An action's main must be ${ACTION_MAIN}`);
  }
  const {post} = manifest.data;
  if (post !== undefined && post !== ACTION_POST) {
    throw new VersionRefusedError('invalid-manifest', `An action's post must be ${ACTION_POST}`);
  }
  if ((post !== undefined) !== files.some(({path}) => path === ACTION_POST)) {
    throw new VersionRefusedError(
      'invalid-bundle',
      `An action bundle holds ${ACTION_POST} if and only if its manifest sets post`,
    );
  }
  return {manifest: manifest.data};
}
