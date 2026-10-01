import {describe, expect, it} from '@shipfox/vitest/vi';
import {shippedTemplateLoader} from '@shipfox/workflow-templates';
import {discoverOnboardingCases} from './onboarding-run.js';

const cases = await discoverOnboardingCases();
const templateCases = cases.filter(({definition}) => definition.expect.template !== undefined);

describe('shipped onboarding cases', () => {
  it('holds the first ten cases, each run three times', () => {
    expect(cases).toHaveLength(10);
    expect(cases.filter(({definition}) => definition.k !== 3)).toEqual([]);
  });

  it('covers every outcome', () => {
    const outcomes = new Set(cases.map(({definition}) => definition.expect.outcome));

    expect([...outcomes].sort()).toEqual([
      'blocked_on_connection',
      'needs_clarification',
      'validated',
    ]);
  });

  it('covers named, generic, and literal prompts, with and without a template', () => {
    const prompts = cases.map(({definition}) => definition.prompt);

    expect(prompts.some((prompt) => prompt.startsWith('template:'))).toBe(true);
    expect(prompts).toContain('generic');
    expect(prompts.some((prompt) => prompt !== 'generic' && !prompt.startsWith('template:'))).toBe(
      true,
    );
    expect(
      cases.some(
        ({definition}) =>
          definition.expect.outcome === 'validated' && definition.expect.template === undefined,
      ),
    ).toBe(true);
  });

  it.each(
    templateCases.map(({id, definition}) => [id, definition] as const),
  )('%s expects a template, bindings, and options the catalog offers', async (_id, definition) => {
    const found = await shippedTemplateLoader.get({package: definition.expect.template ?? ''});
    if (found === undefined) throw new Error(`${definition.expect.template} is not shipped.`);
    const {roles, options} = found.manifest;

    for (const [role, provider] of Object.entries(definition.expect.bindings ?? {})) {
      expect(roles[role]?.providers, `role ${role}`).toContain(provider);
      expect(definition.workspace.connections, `connection for ${role}`).toContain(provider);
    }
    for (const [option, choice] of Object.entries(definition.expect.options ?? {})) {
      const declared = options.find(({id}) => id === option);
      expect(
        declared?.choices.map(({id}) => id),
        `option ${option}`,
      ).toContain(choice);
    }
  });

  it('keeps the connection a blocked case misses out of its workspace', () => {
    for (const {definition} of cases) {
      const missing = definition.expect.missing_provider;
      if (missing === undefined) continue;
      expect(definition.workspace.connections).not.toContain(missing);
    }
  });
});
