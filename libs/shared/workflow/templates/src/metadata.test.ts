import {describe, expect, it} from '@shipfox/vitest/vi';
import {workflowTemplateManifestSchema} from './manifest.js';
import {deriveTemplateMetadata, workflowTemplateMetadataSchema} from './metadata.js';

function manifest(fields: Record<string, unknown> = {}) {
  return workflowTemplateManifestSchema.parse({
    title: 'Task to pull request',
    summary: 'Turn a task into a tested pull request.',
    starts: 'A task arrives from your coding agent or a tracker',
    roles: {
      source: {from: 'project', providers: ['github']},
      tracker: {
        providers: ['linear', 'jira'],
        optional: true,
        question: 'Should the workflow read tasks from a tracker?',
        tradeoff: 'The tracker adds a trigger and a write-back.',
      },
    },
    options: [
      {
        id: 'feedback_loop',
        question: 'Should the workflow answer review comments?',
        choices: [{id: 'on', default: true, label: 'Answer them'}, {id: 'off'}],
        tradeoffs: {on: 'One more agent run for each review.'},
        applies_to: ['source'],
      },
    ],
    slots: [{id: 'test_command', description: 'The command that runs the tests.'}],
    secrets: [{name: 'REGISTRY_TOKEN', description: 'Reads the private registry.'}],
    variables: [{name: 'REGISTRY_URL', description: 'The private registry URL.'}],
    ...fields,
  });
}

describe('deriveTemplateMetadata', () => {
  it('lists the providers of every role once, in manifest order', () => {
    const template = manifest({
      roles: {
        source: {providers: ['github', 'gitea']},
        tracker: {providers: ['linear', 'github'], optional: true, question: 'Q?', tradeoff: 'T.'},
      },
    });

    const metadata = deriveTemplateMetadata({manifest: template, contentBytes: 0});

    expect(metadata.integrations).toEqual(['github', 'gitea', 'linear']);
  });

  it('describes the slots, secrets, and variables', () => {
    const metadata = deriveTemplateMetadata({manifest: manifest(), contentBytes: 0});

    expect(metadata.interface).toEqual({
      slots: [{id: 'test_command', description: 'The command that runs the tests.'}],
      secrets: [{name: 'REGISTRY_TOKEN', description: 'Reads the private registry.'}],
      variables: [{name: 'REGISTRY_URL', description: 'The private registry URL.'}],
    });
  });

  it('describes the roles and options with their questions and tradeoffs', () => {
    const metadata = deriveTemplateMetadata({manifest: manifest(), contentBytes: 0});

    expect(metadata.choices).toEqual({
      roles: [
        {id: 'source', providers: ['github'], optional: false, from: 'project'},
        {
          id: 'tracker',
          providers: ['linear', 'jira'],
          optional: true,
          question: 'Should the workflow read tasks from a tracker?',
          tradeoff: 'The tracker adds a trigger and a write-back.',
        },
      ],
      options: [
        {
          id: 'feedback_loop',
          question: 'Should the workflow answer review comments?',
          tradeoffs: {on: 'One more agent run for each review.'},
          applies_to: ['source'],
          choices: [{id: 'on', default: true, label: 'Answer them'}, {id: 'off'}],
        },
      ],
    });
  });

  it('records the content bundle size', () => {
    const metadata = deriveTemplateMetadata({manifest: manifest(), contentBytes: 2048});

    expect(metadata.size).toBe(2048);
  });

  it('validates against its schema after a JSON round trip', () => {
    const metadata = deriveTemplateMetadata({manifest: manifest(), contentBytes: 2048});

    const parsed = workflowTemplateMetadataSchema.parse(JSON.parse(JSON.stringify(metadata)));

    expect(parsed).toEqual(JSON.parse(JSON.stringify(metadata)));
  });
});
