import {describe, expect, it} from '@shipfox/vitest/vi';
import {templateRoleBindings} from './composer.js';
import {shippedTemplateLoader} from './loader.js';
import {createDirectoryTemplateLoader} from './testing.js';

const headerLine = /^# shipfox-template:.*\n/m;
const catalog = new URL('../../catalog/templates', import.meta.url).pathname;

describe('createDirectoryTemplateLoader', () => {
  const loader = createDirectoryTemplateLoader(catalog);

  it('serves the catalog packages at their package.json versions', async () => {
    const templates = await loader.list();

    expect(templates.map(({package: name, version}) => `${name}@${version}`)).toEqual(
      (await shippedTemplateLoader.list()).map(({id}) => `shipfox/${id}@1.0.0`),
    );
    await expect(loader.versions({package: 'ticket-to-pr'})).resolves.toEqual(['1.0.0']);
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
