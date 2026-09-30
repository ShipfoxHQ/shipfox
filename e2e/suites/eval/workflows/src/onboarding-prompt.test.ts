import {describe, expect, it} from '@shipfox/vitest/vi';
import {FIRST_WORKFLOW_PROMPT} from '@shipfox/workflow-templates/prompt';
import {resolvePrompt} from './onboarding-prompt.js';

describe('resolvePrompt', () => {
  it('uses the first-workflow panel prompt for generic', () => {
    expect(resolvePrompt('generic')).toBe(FIRST_WORKFLOW_PROMPT);
  });

  it('builds the template prompt the docs page copies', () => {
    expect(resolvePrompt('template:ticket-to-pr')).toBe(
      'Use Shipfox to create a workflow from the ticket-to-pr template.',
    );
  });

  it('names each role choice from the query string', () => {
    expect(resolvePrompt('template:ticket-to-pr?tracker=linear&report=none')).toBe(
      'Use Shipfox to create a workflow from the ticket-to-pr template, with Linear as the tracker and without the report part.',
    );
  });

  it('passes literal text through', () => {
    expect(resolvePrompt('Make the app faster')).toBe('Make the app faster');
  });
});
