import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {buildTemplatePagePrompt} from './prompt';
import type {TemplateRole} from './types';

const tracker: TemplateRole = {
  role: 'tracker',
  providers: ['linear'],
  upcoming: [],
  optional: true,
  fromProject: false,
};
const source: TemplateRole = {
  role: 'source',
  providers: ['github'],
  upcoming: [],
  optional: false,
  fromProject: true,
};
const chat: TemplateRole = {
  role: 'chat',
  providers: ['slack', 'linear'],
  upcoming: [],
  optional: false,
  fromProject: false,
};

describe('buildTemplatePagePrompt', () => {
  it('names only the template when the page offers no choice', () => {
    assert.equal(
      buildTemplatePagePrompt('fix-dependency-ci', [source], {source: 'github'}),
      'Use Shipfox to create a workflow from the fix-dependency-ci template.',
    );
  });

  it('names each provider choice and each skipped optional role', () => {
    assert.equal(
      buildTemplatePagePrompt('ticket-to-pr', [tracker, source], {
        tracker: 'linear',
        source: 'github',
      }),
      'Use Shipfox to create a workflow from the ticket-to-pr template, with Linear as the tracker.',
    );
    assert.equal(
      buildTemplatePagePrompt('ticket-to-pr', [chat, tracker, source], {chat: 'slack'}),
      'Use Shipfox to create a workflow from the ticket-to-pr template, with Slack as the chat and without the tracker part.',
    );
  });
});
