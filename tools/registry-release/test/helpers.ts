import {join} from 'node:path';
import {decodeActionBundle} from '@shipfox/workflow-document';
import {type BuiltBlob, type BuiltPackage, buildPackage} from '../src/build.js';
import type {ActionRepository} from './fixtures/action-repository.js';
import {TEMPLATE_PATH, type TemplateRepository} from './fixtures/template-repository.js';

export const TOOL_VERSION = '0.1.0';

export function buildFixture(
  repository: TemplateRepository,
  {name = 'fixture-template'}: {name?: string} = {},
): Promise<BuiltPackage> {
  return buildPackage({
    configured: {
      package: `shipfox/${name}`,
      kind: 'template',
      root: repository.root,
      path: TEMPLATE_PATH,
      directory: join(repository.root, TEMPLATE_PATH),
      publish: true,
    },
    toolVersion: TOOL_VERSION,
  });
}

export function buildActionFixture(repository: ActionRepository): Promise<BuiltPackage> {
  return buildPackage({configured: repository.configured, toolVersion: TOOL_VERSION});
}

/** The files of a content bundle or source archive, by path. */
export async function blobFiles(blob: BuiltBlob): Promise<Record<string, string>> {
  const files = await decodeActionBundle({gzip: blob.gzip, digest: blob.digest});
  return Object.fromEntries(files.map(({path, content}) => [path, content]));
}
