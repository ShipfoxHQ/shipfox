import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {getShippedSkillResource, listShippedSkillResources} from './skills.js';

const semanticVersionPattern = /^\d+\.\d+\.\d+$/u;

describe('shipped skill resources', () => {
  test('embeds the template procedure and template guide bytes', () => {
    const skill = getShippedSkillResource('skill://shipfox/create-workflow-from-template/SKILL.md');
    expect(skill?.revision).toBe(6);
    expect(skill?.text).toContain('revision: 6');
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
    const failedRunGuide = getShippedSkillResource(
      'skill://shipfox/create-workflow-from-template/references/report-failed-runs.md',
    );
    expect(failedRunGuide?.text).toBe(
      readFileSync(new URL('../assets/report-failed-runs/GUIDE.md', import.meta.url), 'utf8'),
    );
    const askCodebaseGuide = getShippedSkillResource(
      'skill://shipfox/create-workflow-from-template/references/ask-codebase.md',
    );
    expect(askCodebaseGuide?.text).toBe(
      readFileSync(new URL('../assets/ask-codebase/GUIDE.md', import.meta.url), 'utf8'),
    );
    const defaultBranchGuide = getShippedSkillResource(
      'skill://shipfox/create-workflow-from-template/references/fix-default-branch-ci.md',
    );
    expect(defaultBranchGuide?.text).toBe(
      readFileSync(new URL('../assets/fix-default-branch-ci/GUIDE.md', import.meta.url), 'utf8'),
    );

    for (const name of [
      'create-workflow-from-template',
      'validate-workflow-change',
      'write-a-workflow',
    ]) {
      expect(getShippedSkillResource(`skill://shipfox/${name}/SKILL.md`)?.text).toBe(
        readFileSync(new URL(`../assets/skills/${name}/SKILL.md`, import.meta.url), 'utf8'),
      );
    }
  });

  test('requires model confirmation, project-scoped replay, and a decision on partial writes', () => {
    const text =
      getShippedSkillResource('skill://shipfox/create-workflow-from-template/SKILL.md')?.text ?? '';

    expect(text).toContain(
      'Never bind a model and thinking combination the user has not confirmed.',
    );
    expect(text).toContain(
      'skill://shipfox/create-workflow-from-template/references/choose-models.md',
    );
    expect(text).toContain('If any tool returns `content-too-large`, stop and report it.');
    expect(text).toContain("Never reconstruct a template's YAML by hand.");
    expect(text).toContain('If `model_provider_configured` is `false`, stop');
    expect(text).not.toContain('no-compatible-model');
    expect(text).toContain('state what a real run will write before listing events');
    expect(text).toContain('Keep only events of the selected project');
    expect(text).toContain('The event check does not verify this');
    expect(text).toContain(
      'Tell them they can say they cannot trigger the event or ask to skip the dev run.',
    );
    expect(text).toContain(
      'Skip the dev run only if the user says they cannot trigger an event or asks to skip it.',
    );
    expect(text).toContain('Repeat the expected writes from step 6 in one line');
    expect(text).toContain('Before any repeat real run, after a failure or after edits');
    expect(text).toContain('stop, or repeat the writes with their agreement');
    expect(text).toContain(
      'Never rerun a writing step without one of these. Stop and ask the user after five failed real runs.',
    );
  });

  test('asks about an optional role only when its provider is connected', () => {
    const text =
      getShippedSkillResource('skill://shipfox/create-workflow-from-template/SKILL.md')?.text ?? '';

    expect(text).toContain('only if it has a compatible provider.');
    expect(text).toContain('say in one sentence what connecting it adds; never ask.');
    expect(text).toContain('each accepted optional role.');
  });

  test('chooses models from the paged catalog when writing a workflow', () => {
    const text = getShippedSkillResource('skill://shipfox/write-a-workflow/SKILL.md')?.text ?? '';

    expect(text).toContain('revision: 3');
    expect(text).toContain('| Models and their thinking levels | `list_workspace_models` |');
    expect(text).toContain(
      '| The default model, runners, secret names, or variable names | `get_workflow_authoring_context` |',
    );
    expect(text).toContain('If `default_model` is null, go to step 2.');
    expect(text).toContain('when its `supported_thinking` includes it');
    expect(text).toContain('ask for a preference first');
    expect(text).toContain('Show at most one page. Never page through the whole catalog.');
    expect(text).toContain('Always write `provider` for a model from `list_workspace_models`');
    expect(text).toContain('If any tool returns `content-too-large`, stop and report it');
    expect(text).not.toContain('from the authoring context');
  });

  test('chooses template models per recommendation group', () => {
    const reference = getShippedSkillResource(
      'skill://shipfox/create-workflow-from-template/references/choose-models.md',
    );

    expect(reference?.text).toBe(
      readFileSync(
        new URL(
          '../assets/skills/create-workflow-from-template/references/choose-models.md',
          import.meta.url,
        ),
        'utf8',
      ),
    );
    for (const mode of ['`recommended`', '`template_default`', '`workspace_default`', '`choose`']) {
      expect(reference?.text).toContain(mode);
    }
    expect(reference?.text).toContain('`provider_required: true`');
    expect(reference?.text).toContain('always for a model chosen from `list_workspace_models`');
    expect(reference?.text).toContain('show at most one page');
    expect(reference?.text).toContain('Never rank or compare unscored models.');
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
