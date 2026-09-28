import {describe, expect, it} from '@shipfox/vitest/vi';
import {buildTemplatePrompt} from './prompt.js';

describe('buildTemplatePrompt', () => {
  it('names only the template without choices', () => {
    expect(buildTemplatePrompt({templateId: 'ticket-to-pr'})).toBe(
      'Use Shipfox to create a workflow from the ticket-to-pr template.',
    );
  });

  it('joins the choices the user made', () => {
    expect(
      buildTemplatePrompt({
        templateId: 'ticket-to-pr',
        choices: ['with Linear as the tracker', 'without the report part'],
      }),
    ).toBe(
      'Use Shipfox to create a workflow from the ticket-to-pr template, with Linear as the tracker and without the report part.',
    );
  });
});
