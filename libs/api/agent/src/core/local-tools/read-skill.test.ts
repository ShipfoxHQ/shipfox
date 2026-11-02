import {listShippedSkillResources} from '@shipfox/workflow-templates';
import {createReadSkillTool} from './read-skill.js';

describe('read_skill', () => {
  it('reads a shipped skill by URI', () => {
    const skill = listShippedSkillResources()[0];
    if (skill === undefined) throw new Error('No shipped skill to read');

    const result = createReadSkillTool().execute({uri: skill.uri});

    expect(result).toEqual({content: [{type: 'text', text: skill.text}]});
  });

  it('offers every shipped skill in the description', () => {
    const tool = createReadSkillTool();

    for (const skill of listShippedSkillResources()) {
      expect(tool.description).toContain(skill.uri);
    }
  });

  it('answers not found for an unknown skill', () => {
    const result = createReadSkillTool().execute({uri: 'skill://shipfox/missing/SKILL.md'});

    expect(result).toMatchObject({isError: true, content: [{text: 'Skill not found'}]});
  });

  it.each([
    {uri: 'docs://shipfox/home'},
    {uri: 'file:///etc/passwd'},
    {uri: 42},
    {},
  ])('rejects a URI outside the shipped skills: %j', (input) => {
    const result = createReadSkillTool().execute(input);

    expect(result).toMatchObject({isError: true});
  });
});
