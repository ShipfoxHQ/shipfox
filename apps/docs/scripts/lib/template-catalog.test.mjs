import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {shippedTemplateLoader} from '@shipfox/workflow-templates';
import {buildTemplateCatalogDocument} from './template-catalog.mjs';

const SHIPFOX_NAMESPACE_PREFIX = 'shipfox/';
const {templates} = buildTemplateCatalogDocument();

describe('buildTemplateCatalogDocument', () => {
  it('lists every shipped template in rank order', () => {
    const shipped = shippedTemplateLoader.list();
    const ranks = templates.map((template) => shippedTemplateLoader.get(template.id).rank);

    assert.equal(templates.length, shipped.length);
    assert.deepEqual(
      ranks,
      [...ranks].sort((a, b) => a - b),
    );
  });

  it('takes the page metadata from the manifest', () => {
    for (const template of templates) {
      const {manifest} = shippedTemplateLoader.get(template.id);

      assert.equal(template.starts, manifest.starts, template.id);
      assert.deepEqual(template.keywords, manifest.keywords, template.id);
      assert.deepEqual(template.writes, manifest.writes, template.id);
      assert.deepEqual(template.prerequisites, manifest.prerequisites, template.id);
      assert.equal(template.flow.length, manifest.flow.length, template.id);
    }
  });

  it('renames the manifest loop key and keeps the flow providers', () => {
    const [step] = shippedTemplateLoader
      .list()
      .flatMap(({id, manifest}) => manifest.flow.map((flowStep, index) => ({id, index, flowStep})))
      .filter(({flowStep}) => flowStep.loops_to !== undefined);
    assert.ok(step, 'a shipped template has a looping flow step');

    const rendered = templates.find((template) => template.id === step.id).flow[step.index];

    assert.equal(rendered.loopsTo, step.flowStep.loops_to);
    assert.equal('loops_to' in rendered, false);
    assert.equal(rendered.provider, step.flowStep.provider);
  });

  it('resolves related packages to catalog entries', () => {
    for (const template of templates) {
      const {manifest} = shippedTemplateLoader.get(template.id);

      assert.deepEqual(
        template.related.map((related) => related.id),
        manifest.related.map((name) => name.slice(SHIPFOX_NAMESPACE_PREFIX.length)),
        template.id,
      );
    }
  });
});
