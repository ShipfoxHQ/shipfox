import {describe, expect, it} from '@shipfox/vitest/vi';
import {buildTemplatePrompt, buildUpgradePrompt} from './prompt.js';

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

describe('buildUpgradePrompt', () => {
  it('names the template, the workflow file, and the target version', () => {
    expect(
      buildUpgradePrompt({
        package: 'shipfox/ticket-to-pr',
        configPath: '.shipfox/workflows/ticket.yml',
        version: '1.3.0',
      }),
    ).toBe(
      'Use Shipfox to upgrade the ticket-to-pr workflow in `.shipfox/workflows/ticket.yml` to 1.3.0.',
    );
  });

  it('keeps the namespace of a third-party template', () => {
    expect(buildUpgradePrompt({package: 'acme/ticket-to-pr', version: '2.0.0'})).toBe(
      'Use Shipfox to upgrade the acme/ticket-to-pr workflow to 2.0.0.',
    );
  });

  it('leaves out the file when the definition has no path', () => {
    expect(
      buildUpgradePrompt({package: 'shipfox/ticket-to-pr', configPath: null, version: '1.3.0'}),
    ).toBe('Use Shipfox to upgrade the ticket-to-pr workflow to 1.3.0.');
  });
});
