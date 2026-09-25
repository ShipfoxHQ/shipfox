import {createHash} from 'node:crypto';
import {McpError} from '@modelcontextprotocol/sdk/types.js';
import {connectAgentAccessClient} from './agent-access-client.js';
import {expect, test} from './test.js';

const SKILL_URI_PREFIX = 'skill://shipfox/';

test('serves skill resources whose listed digests match the served bytes', async ({
  request,
  auth,
}) => {
  const first = await connectAgentAccessClient({request, auth});
  const second = await connectAgentAccessClient({request, auth});
  try {
    const listed = await first.client.listResources();
    const listedBySecondGrant = await second.client.listResources();
    const templates = await first.client.listResourceTemplates();
    const skills = listed.resources.filter(({uri}) => uri.startsWith(SKILL_URI_PREFIX));
    const manifestRead = await first.client.readResource({uri: `${SKILL_URI_PREFIX}manifest`});
    const manifestContent = manifestRead.contents[0];
    const manifest = JSON.parse(
      manifestContent !== undefined && 'text' in manifestContent ? manifestContent.text : '',
    ) as {files: {uri: string}[]};

    expect(listedBySecondGrant).toEqual(listed);
    expect(listed.nextCursor).toBeUndefined();
    expect(
      templates.resourceTemplates.filter(({uriTemplate}) => uriTemplate.startsWith('skill:')),
    ).toEqual([]);
    expect(skills.map(({uri}) => uri).sort()).toEqual(
      [
        `${SKILL_URI_PREFIX}index`,
        `${SKILL_URI_PREFIX}manifest`,
        ...manifest.files.map(({uri}) => uri),
      ].sort(),
    );
    expect(skills.map(({uri}) => uri)).toContain(
      `${SKILL_URI_PREFIX}create-workflow-from-template/SKILL.md`,
    );
    for (const skill of skills) {
      const read = await first.client.readResource({uri: skill.uri});
      expect(read.contents).toHaveLength(1);
      const content = read.contents[0];
      if (content === undefined || !('text' in content)) {
        throw new Error(`${skill.uri} did not return one text content`);
      }
      expect(content.uri).toBe(skill.uri);
      expect(skill.size).toBe(Buffer.byteLength(content.text, 'utf8'));
      expect(skill._meta?.sha256).toBe(
        createHash('sha256').update(content.text, 'utf8').digest('hex'),
      );
    }
  } finally {
    await first.client.close();
    await second.client.close();
  }
});

test('rejects an unknown resource URI with invalid params', async ({request, auth}) => {
  const {client} = await connectAgentAccessClient({request, auth});
  const uri = `${SKILL_URI_PREFIX}missing/SKILL.md`;
  try {
    const error = await client.readResource({uri}).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(McpError);
    expect(error).toMatchObject({code: -32602, data: {uri}});
  } finally {
    await client.close();
  }
});
