import type {ActionBundleFile} from '@shipfox/workflow-document';
import {VersionRefusedError} from '#publish/errors.js';

/**
 * A source archive holds text files that rebuild the version. Build output, installed
 * dependencies, and npm credentials never belong in it.
 */
export function checkSourceArchive(files: readonly ActionBundleFile[]): void {
  for (const {path} of files) {
    const segments = path.split('/');
    if (segments.includes('node_modules') || segments.at(-1) === '.npmrc') {
      throw new VersionRefusedError(
        'invalid-bundle',
        `The source archive must not contain ${JSON.stringify(path)}`,
      );
    }
  }
}
