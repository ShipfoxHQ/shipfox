import {applyProjectAgents, listProjectAgents, type ProjectAgentFile} from './agents.js';

function validFile(
  key: string,
  overrides: Partial<{contentHash: string; instructions: string}> = {},
) {
  return {
    key,
    configPath: `.shipfox/agents/${key}.yml`,
    contentHash: overrides.contentHash ?? `hash-${key}`,
    valid: true,
    config: {description: `The ${key} agent.`, instructions: overrides.instructions ?? 'Help.'},
  } satisfies ProjectAgentFile;
}

function invalidFile(key: string) {
  return {
    key,
    configPath: `.shipfox/agents/${key}.yml`,
    valid: false,
    errors: [{message: 'A custom agent requires "instructions".', path: 'instructions'}],
  } satisfies ProjectAgentFile;
}

describe('project agent queries', () => {
  let projectId: string;

  beforeEach(() => {
    projectId = crypto.randomUUID();
  });

  it('inserts one row per key and lists them by key', async () => {
    const result = await applyProjectAgents({
      projectId,
      files: [validFile('triage'), validFile('reviewer')],
    });

    expect(result).toEqual({appliedCount: 2, deletedCount: 0});
    expect((await listProjectAgents(projectId)).map((agent) => agent.key)).toEqual([
      'reviewer',
      'triage',
    ]);
  });

  it('leaves an unchanged row untouched', async () => {
    await applyProjectAgents({projectId, files: [validFile('reviewer')]});
    const [before] = await listProjectAgents(projectId);

    const result = await applyProjectAgents({projectId, files: [validFile('reviewer')]});

    expect(result.appliedCount).toBe(0);
    const [after] = await listProjectAgents(projectId);
    expect(after?.updatedAt).toEqual(before?.updatedAt);
  });

  it('replaces the config when the content changes', async () => {
    await applyProjectAgents({projectId, files: [validFile('reviewer')]});

    const result = await applyProjectAgents({
      projectId,
      files: [validFile('reviewer', {contentHash: 'hash-2', instructions: 'Review harder.'})],
    });

    expect(result.appliedCount).toBe(1);
    const [row] = await listProjectAgents(projectId);
    expect(row?.config.instructions).toBe('Review harder.');
    expect(row?.contentHash).toBe('hash-2');
  });

  it('keeps the last valid config when the file turns invalid, and clears the errors when it recovers', async () => {
    await applyProjectAgents({projectId, files: [validFile('reviewer')]});

    await applyProjectAgents({projectId, files: [invalidFile('reviewer')]});
    const [invalid] = await listProjectAgents(projectId);
    expect(invalid?.config.instructions).toBe('Help.');
    expect(invalid?.contentHash).toBe('hash-reviewer');
    expect(invalid?.errors).toEqual([
      {message: 'A custom agent requires "instructions".', path: 'instructions'},
    ]);

    // The recovered file has the content it had before it broke.
    await applyProjectAgents({projectId, files: [validFile('reviewer')]});
    const [recovered] = await listProjectAgents(projectId);
    expect(recovered?.errors).toEqual([]);
  });

  it('creates no row for a file that was never valid', async () => {
    const result = await applyProjectAgents({projectId, files: [invalidFile('reviewer')]});

    expect(result).toEqual({appliedCount: 0, deletedCount: 0});
    expect(await listProjectAgents(projectId)).toEqual([]);
  });

  it('deletes the rows of keys that have no file, and only for this project', async () => {
    const otherProjectId = crypto.randomUUID();
    await applyProjectAgents({projectId, files: [validFile('reviewer'), validFile('triage')]});
    await applyProjectAgents({projectId: otherProjectId, files: [validFile('reviewer')]});

    const result = await applyProjectAgents({projectId, files: [invalidFile('triage')]});

    expect(result.deletedCount).toBe(1);
    expect((await listProjectAgents(projectId)).map((agent) => agent.key)).toEqual(['triage']);
    expect(await listProjectAgents(otherProjectId)).toHaveLength(1);
  });

  it('deletes every row of the project when no file remains', async () => {
    await applyProjectAgents({projectId, files: [validFile('reviewer')]});

    const result = await applyProjectAgents({projectId, files: []});

    expect(result.deletedCount).toBe(1);
    expect(await listProjectAgents(projectId)).toEqual([]);
  });
});
