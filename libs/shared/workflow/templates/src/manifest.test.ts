import {describe, expect, it} from '@shipfox/vitest/vi';
import {workflowTemplateManifestSchema} from './manifest.js';

describe('workflowTemplateManifestSchema', () => {
  it('accepts project-bound roles and declared option metadata', () => {
    const manifest = workflowTemplateManifestSchema.parse({
      id: 'fixture',
      revision: 1,
      added_at: '2026-10-01',
      title: 'Fixture',
      summary: 'A fixture template.',
      roles: {source: {from: 'project', providers: ['github']}},
      options: [
        {
          id: 'mode',
          question: 'Which mode should run?',
          choices: [{id: 'fast', default: true, tradeoff: 'Uses fewer checks.'}],
          applies_to: ['source'],
        },
      ],
      slots: ['setup_commands'],
      secrets: ['TOKEN'],
      variables: ['COMMAND'],
    });

    const sourceRole = manifest.roles.source;
    if (sourceRole === undefined) throw new Error('Source role was not parsed');

    expect(sourceRole.from).toBe('project');
    expect(manifest.options[0]?.choices[0]?.default).toBe(true);
  });
});
