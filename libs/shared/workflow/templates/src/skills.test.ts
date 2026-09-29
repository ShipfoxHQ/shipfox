import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {getShippedSkillResource, listShippedSkillResources} from './skills.js';

const semanticVersionPattern = /^\d+\.\d+\.\d+$/u;

describe('shipped skill resources', () => {
  test('embeds the template procedure and template guide bytes', () => {
    const skill = getShippedSkillResource('skill://shipfox/create-workflow-from-template/SKILL.md');
    expect(skill?.revision).toBe(14);
    expect(skill?.text).toContain('skill://shipfox/validate-workflow-change/SKILL.md');
    expect(skill?.text).toContain('skill://shipfox/test-workflow-change/SKILL.md');

    const guide = getShippedSkillResource(
      'skill://shipfox/create-workflow-from-template/references/ticket-to-pr.md',
    );
    expect(guide?.text).toBe(
      readFileSync(
        new URL('../../catalog/templates/ticket-to-pr/GUIDE.md', import.meta.url),
        'utf8',
      ),
    );
    const dependencyGuide = getShippedSkillResource(
      'skill://shipfox/create-workflow-from-template/references/fix-dependency-ci.md',
    );
    expect(dependencyGuide?.text).toBe(
      readFileSync(
        new URL('../../catalog/templates/fix-dependency-ci/GUIDE.md', import.meta.url),
        'utf8',
      ),
    );
    const failedRunGuide = getShippedSkillResource(
      'skill://shipfox/create-workflow-from-template/references/report-failed-runs.md',
    );
    expect(failedRunGuide?.text).toBe(
      readFileSync(
        new URL('../../catalog/templates/report-failed-runs/GUIDE.md', import.meta.url),
        'utf8',
      ),
    );
    const askCodebaseGuide = getShippedSkillResource(
      'skill://shipfox/create-workflow-from-template/references/ask-codebase.md',
    );
    expect(askCodebaseGuide?.text).toBe(
      readFileSync(
        new URL('../../catalog/templates/ask-codebase/GUIDE.md', import.meta.url),
        'utf8',
      ),
    );
    const slackDispatcherGuide = getShippedSkillResource(
      'skill://shipfox/create-workflow-from-template/references/slack-dispatcher.md',
    );
    expect(slackDispatcherGuide?.text).toBe(
      readFileSync(
        new URL('../../catalog/templates/slack-dispatcher/GUIDE.md', import.meta.url),
        'utf8',
      ),
    );
    const slackTicketGuide = getShippedSkillResource(
      'skill://shipfox/create-workflow-from-template/references/slack-to-ticket.md',
    );
    expect(slackTicketGuide?.text).toBe(
      readFileSync(
        new URL('../../catalog/templates/slack-to-ticket/GUIDE.md', import.meta.url),
        'utf8',
      ),
    );
    const defaultBranchGuide = getShippedSkillResource(
      'skill://shipfox/create-workflow-from-template/references/fix-default-branch-ci.md',
    );
    expect(defaultBranchGuide?.text).toBe(
      readFileSync(
        new URL('../../catalog/templates/fix-default-branch-ci/GUIDE.md', import.meta.url),
        'utf8',
      ),
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

  test('keeps every skill under the 8 KiB limit', () => {
    const skills = listShippedSkillResources().filter(({uri}) => uri.endsWith('/SKILL.md'));

    expect(skills.length).toBeGreaterThan(0);
    for (const {uri, text} of skills) {
      expect(Buffer.byteLength(text, 'utf8'), uri).toBeLessThanOrEqual(8 * 1024);
    }
  });

  test('mentions options, writes, and prerequisites instead of guide wording', () => {
    const template = getShippedSkillResource(
      'skill://shipfox/create-workflow-from-template/SKILL.md',
    )?.text;

    expect(template).toContain('`options`');
    expect(template).toContain('`prerequisites`');
    expect(template).toContain('`writes`');
    expect(template).not.toContain('Expected writes');
    expect(template).not.toContain('keep chosen `# option:` blocks');
  });

  test('keeps workflow tool identifiers in their corresponding skills', () => {
    const template = getShippedSkillResource(
      'skill://shipfox/create-workflow-from-template/SKILL.md',
    );
    const authoring = getShippedSkillResource('skill://shipfox/write-a-workflow/SKILL.md');
    const testing = getShippedSkillResource('skill://shipfox/test-workflow-change/SKILL.md');

    expect(authoring?.revision).toBe(3);
    expect(testing?.revision).toBe(2);
    for (const identifier of ['get_workflow_template', 'get_workflow_authoring_context']) {
      expect(template?.text).toContain(identifier);
    }
    for (const identifier of [
      'get_workflow_authoring_context',
      'list_workspace_models',
      'list_trigger_events',
    ]) {
      expect(authoring?.text).toContain(identifier);
    }
    for (const identifier of [
      'create_dev_run',
      'run_url',
      'run_id',
      'get_workflow_run',
      'get_step_logs',
    ]) {
      expect(testing?.text).toContain(identifier);
    }
  });

  test('binds the default template model per recommendation group', () => {
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
