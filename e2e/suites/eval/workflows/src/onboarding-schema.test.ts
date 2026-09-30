import {fileURLToPath} from 'node:url';
import {describe, expect, it} from '@shipfox/vitest/vi';
import {loadOnboardingCase, parseOnboardingCase} from './onboarding-schema.js';

const invalidPromptPattern = /template prompt reads/iu;
const githubPattern = /github/iu;

const validCase = {
  prompt: 'generic',
  workspace: {connections: ['github'], project: {repository: 'acme/report-cli'}},
  persona: 'You lead a small team.',
};

describe('onboarding case schema', () => {
  it('loads the fixture case', async () => {
    const fixture = await loadOnboardingCase(
      fileURLToPath(new URL('../cases/onboarding/fixture/case.yaml', import.meta.url)),
    );

    expect(fixture.prompt).toBe('template:ticket-to-pr');
    expect(fixture.workspace.connections).toEqual(['github']);
  });

  it('defaults the repeat count, turn limit, and timeout', () => {
    const parsed = parseOnboardingCase(validCase);

    expect(parsed).toMatchObject({k: 3, max_turns: 40, timeout_seconds: 1200});
  });

  it('accepts a template prompt with choices and literal text', () => {
    expect(() =>
      parseOnboardingCase({...validCase, prompt: 'template:ticket-to-pr?tracker=linear'}),
    ).not.toThrow();
    expect(() => parseOnboardingCase({...validCase, prompt: 'Make the app faster'})).not.toThrow();
  });

  it('rejects a malformed template prompt', () => {
    expect(() => parseOnboardingCase({...validCase, prompt: 'template:'})).toThrow(
      invalidPromptPattern,
    );
  });

  it('rejects a template choice without a provider', () => {
    expect(() =>
      parseOnboardingCase({...validCase, prompt: 'template:ticket-to-pr?tracker'}),
    ).toThrow(invalidPromptPattern);
  });

  it('requires the github connection a project runs on', () => {
    expect(() =>
      parseOnboardingCase({
        ...validCase,
        workspace: {...validCase.workspace, connections: ['linear']},
      }),
    ).toThrow(githubPattern);
  });

  it('rejects unknown fields so a typo is not silently ignored', () => {
    expect(() => parseOnboardingCase({...validCase, personna: 'typo'})).toThrow();
  });
});
