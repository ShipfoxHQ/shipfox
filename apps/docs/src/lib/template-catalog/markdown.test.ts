import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {serializeTemplateCatalog, serializeTemplateDetail} from './markdown';
import type {TemplateCatalogEntry, TemplateDetail} from './types';

const WRITES_PATTERN =
  /## What it writes\n\n- GitHub: Pushes a branch\.\n- With a tracker, comments on the ticket\.\n\n/;
const PREREQUISITES_HEADING_PATTERN = /## Before you start/;
const PREREQUISITES_PATTERN =
  /## Before you start\n\n- Invite the Shipfox app to the channel\.\n\n/;

const entry: TemplateCatalogEntry = {
  id: 'ask-codebase',
  title: 'Ask the codebase in Slack',
  summary: 'Answer questions about your code in Slack.',
  revision: 1,
  addedAt: '2026-09-26',
  keywords: ['questions'],
  starts: 'Someone mentions the Shipfox app in Slack',
  flow: [{kind: 'trigger', provider: 'slack', title: 'Someone asks', detail: 'They mention it.'}],
  writes: [{provider: 'slack', action: 'Replies once in the thread.'}],
  roles: [
    {role: 'chat', providers: ['slack'], optional: false, fromProject: false},
    {role: 'source', providers: ['github'], optional: false, fromProject: true},
  ],
  href: '/examples/ask-codebase',
};

function detail(overrides: Partial<TemplateDetail>): TemplateDetail {
  return {
    ...entry,
    prerequisites: [],
    options: [],
    models: [],
    variants: [{bindings: {chat: 'slack', source: 'github'}, yaml: 'name: ask\n'}],
    related: [],
    ...overrides,
  };
}

describe('serializeTemplateCatalog', () => {
  it('lists each example with its start and integrations', () => {
    assert.equal(
      serializeTemplateCatalog([entry]),
      '- [Ask the codebase in Slack](/examples/ask-codebase): Answer questions about your code in Slack. Starts when: Someone mentions the Shipfox app in Slack. Integrations: Slack, GitHub.',
    );
  });
});

describe('serializeTemplateDetail', () => {
  it('names the provider of a write and leaves out one that depends on the reader', () => {
    const markdown = serializeTemplateDetail(
      detail({
        writes: [
          {provider: 'github', action: 'Pushes a branch.'},
          {action: 'With a tracker, comments on the ticket.'},
        ],
      }),
    );

    assert.match(markdown, WRITES_PATTERN);
  });

  it('lists the prerequisites only when the template has some', () => {
    assert.doesNotMatch(serializeTemplateDetail(detail({})), PREREQUISITES_HEADING_PATTERN);
    assert.match(
      serializeTemplateDetail(detail({prerequisites: ['Invite the Shipfox app to the channel.']})),
      PREREQUISITES_PATTERN,
    );
  });
});
