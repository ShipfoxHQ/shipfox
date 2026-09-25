import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {getShippedSkillResource, listShippedSkillResources} from './skills.js';

const semanticVersionPattern = /^\d+\.\d+\.\d+$/u;

describe('shipped skill resources', () => {
  test('embeds the template procedure and template guide bytes', () => {
    const skill = getShippedSkillResource('skill://shipfox/create-workflow-from-template/SKILL.md');
    expect(skill?.revision).toBe(3);
    expect(skill?.text).toContain('revision: 3');
    expect(skill?.text).toContain('## 1. Orient');
    expect(skill?.text).toContain('## 9. Deliver');
    expect(skill?.text).toContain('skill://shipfox/validate-workflow-change/SKILL.md');
    expect(skill?.text).toContain('skill://shipfox/test-workflow-change/SKILL.md');
    expect(skill?.text).not.toContain('setup-procedure.md');
    expect(
      getShippedSkillResource(
        'skill://shipfox/create-workflow-from-template/references/setup-procedure.md',
      ),
    ).toBeUndefined();

    const guide = getShippedSkillResource(
      'skill://shipfox/create-workflow-from-template/references/ticket-to-pr.md',
    );
    expect(guide?.text).toBe(
      readFileSync(new URL('../assets/ticket-to-pr/GUIDE.md', import.meta.url), 'utf8'),
    );
    const dependencyGuide = getShippedSkillResource(
      'skill://shipfox/create-workflow-from-template/references/fix-dependency-ci.md',
    );
    expect(dependencyGuide?.text).toBe(
      readFileSync(new URL('../assets/fix-dependency-ci/GUIDE.md', import.meta.url), 'utf8'),
    );
  });

  test('requires model confirmation, project-scoped replay, and a decision on partial writes', () => {
    const text =
      getShippedSkillResource('skill://shipfox/create-workflow-from-template/SKILL.md')?.text ?? '';

    expect(text).toContain(
      'Never bind a model and thinking combination the user has not confirmed.',
    );
    expect(text).toContain('Do not ask a separate thinking-level question.');
    expect(text).toContain('`outcome: list`');
    expect(text).toContain('Never rank or compare them.');
    expect(text).toContain('If `model_provider_configured` is `false`, stop');
    expect(text).not.toContain('no-compatible-model');
    expect(text).toContain('state what a real run will write before listing events');
    expect(text).toContain('Keep only events of the selected project');
    expect(text).toContain('The event check does not verify this');
    expect(text).toContain('Repeat the expected writes from step 6 in one line');
    expect(text).toContain(
      "Bind the confirmed entry's `provider`, model, `harness`, and `thinking`.",
    );
    expect(text).toContain('Before any repeat real run, after a failure or after edits');
    expect(text).toContain('stop, or repeat the writes with their agreement');
    expect(text).toContain(
      'Never rerun a writing step without one of these. Stop and ask the user after five failed real runs.',
    );
  });

  test('asks one explained question at a time', () => {
    const text =
      getShippedSkillResource('skill://shipfox/create-workflow-from-template/SKILL.md')?.text ?? '';

    expect(text).toContain('one option per message');
    expect(text).toContain('Ask one question per message and wait for the answer.');
    expect(text).toContain('restate what it decides and what each answer entails');
    expect(text).not.toContain('one batch of questions');
    expect(text).not.toContain('pick for me');
  });

  test('manifests every embedded skill file with its exact size and digest', () => {
    const manifest = getShippedSkillResource('skill://shipfox/manifest');
    if (manifest === undefined) throw new Error('Missing skill manifest');
    const parsed = JSON.parse(manifest.text) as {
      library_version: string;
      files: Array<{uri: string; size: number; sha256: string}>;
    };
    expect(parsed.library_version).toMatch(semanticVersionPattern);
    expect(parsed.files).toHaveLength(listShippedSkillResources().length - 2);
    for (const file of parsed.files) {
      const resource = getShippedSkillResource(file.uri);
      expect(resource).toBeDefined();
      if (resource === undefined) continue;
      expect(file.size).toBe(Buffer.byteLength(resource.text, 'utf8'));
      expect(file.sha256).toBe(createHash('sha256').update(resource.text).digest('hex'));
    }
  });
});
