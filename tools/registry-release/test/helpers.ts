import {join} from 'node:path';
import {type BuiltPackage, buildPackage} from '../src/build.js';
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
      path: TEMPLATE_PATH,
      directory: join(repository.root, TEMPLATE_PATH),
    },
    toolVersion: TOOL_VERSION,
  });
}
