import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {getShippedSkillResource, listShippedSkillResources} from './skills.js';

const semanticVersionPattern = /^\d+\.\d+\.\d+$/u;

describe('shipped skill resources', () => {
  test('embeds the current playbook revision and template guide bytes', () => {
    const skill = getShippedSkillResource('skill://shipfox/create-workflow-from-template/SKILL.md');
    expect(skill?.revision).toBe(1);
    expect(skill?.text).toContain('revision: 1');

    const guide = getShippedSkillResource(
      'skill://shipfox/create-workflow-from-template/references/ticket-to-pr.md',
    );
    expect(guide?.text).toBe(
      readFileSync(new URL('../assets/ticket-to-pr/GUIDE.md', import.meta.url), 'utf8'),
    );
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
