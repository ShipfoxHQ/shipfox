import {fileURLToPath} from 'node:url';
import {describe, expect, it} from '@shipfox/vitest/vi';
import {templateRoleBindings} from './composer.js';
import {shippedTemplateLoader, type TemplateLoader} from './loader.js';
import {createDirectoryTemplateLoader} from './testing.js';

const headerLine = /^# shipfox-template:.*\n/m;
const catalog = fileURLToPath(new URL('../../catalog/templates', import.meta.url));

describe('createDirectoryTemplateLoader', () => {
  const loader = createDirectoryTemplateLoader(catalog);

  it('serves the same packages and versions as the embedded copy', async () => {
    const summary = async (source: TemplateLoader) =>
      (await source.list()).map(({package: name, version}) => `${name}@${version}`);

    expect(await summary(loader)).toEqual(await summary(shippedTemplateLoader));
    await expect(loader.versions({package: 'ticket-to-pr'})).resolves.toEqual(
      await shippedTemplateLoader.versions({package: 'ticket-to-pr'}),
    );
  });

  it('composes the same workflow as the embedded copy for every binding, apart from the header revision', async () => {
    for (const template of await shippedTemplateLoader.list()) {
      for (const bindings of templateRoleBindings(template.manifest.roles)) {
        const params = {package: template.package, bindings};

        const [directory, embedded] = await Promise.all([
          loader.compose(params),
          shippedTemplateLoader.compose(params),
        ]);

        expect(directory?.replace(headerLine, ''), template.id).toBe(
          embedded?.replace(headerLine, ''),
        );
      }
    }
  });

  it('returns nothing for an unknown package', async () => {
    await expect(loader.get({package: 'shipfox/unknown'})).resolves.toBeUndefined();
    await expect(
      loader.compose({package: 'shipfox/unknown', bindings: {}}),
    ).resolves.toBeUndefined();
  });
});
