import {
  ClaapRecordingUrlError,
  claapAgentToolCatalog,
  claapAgentToolSelectionCatalog,
  parseClaapRecordingUrl,
} from './agent-tools.js';

describe('Claap agent tool catalog', () => {
  it('keeps the allow-list and selection catalog deliberate', () => {
    expect(claapAgentToolCatalog).toMatchSnapshot();
    expect(claapAgentToolSelectionCatalog).toMatchSnapshot();
  });

  it('exposes only the five read tools and marks every tool but list_workspaces sensitive', () => {
    expect(claapAgentToolCatalog.map((entry) => [entry.id, entry.sensitive])).toEqual([
      ['list_workspaces', false],
      ['get_recordings', true],
      ['get_recording', true],
      ['get_recording_transcript', true],
      ['search_recording_transcripts', true],
    ]);
  });

  it('keeps the empty upstream schema for list_workspaces', () => {
    expect(
      claapAgentToolCatalog.find((entry) => entry.id === 'list_workspaces')?.inputSchema,
    ).toEqual({properties: {}, type: 'object'});
  });

  it('lets the two single-recording tools take a recording ID or a share URL', () => {
    for (const id of ['get_recording', 'get_recording_transcript']) {
      const schema = claapAgentToolCatalog.find((entry) => entry.id === id)?.inputSchema;
      expect(Object.keys(schema?.properties ?? {}).sort()).toEqual(['recordingId', 'recordingUrl']);
      expect(schema?.required).toBeUndefined();
    }
  });
});

// A tool step compiles every input schema with strict Ajv and no format plugin, which rejects an
// unknown format such as `date` and fails every call to the tool.
describe('Claap agent tool input schemas', () => {
  it('declare no format keyword', () => {
    const withFormat = claapAgentToolCatalog
      .filter((entry) => JSON.stringify(entry.inputSchema).includes('"format"'))
      .map((entry) => entry.id);

    expect(withFormat).toEqual([]);
  });

  it('never ask the caller for a workspace ID', () => {
    const withWorkspaceId = claapAgentToolCatalog
      .filter((entry) => declaresName(entry.inputSchema, 'workspaceId'))
      .map((entry) => entry.id);

    expect(withWorkspaceId).toEqual([]);
  });
});

// The description of recordingUrl mentions the workspace ID, so look at names, not text.
function declaresName(schema: unknown, name: string): boolean {
  if (Array.isArray(schema)) return schema.some((item) => declaresName(item, name));
  if (typeof schema !== 'object' || schema === null) return false;
  return Object.entries(schema).some(([key, value]) => {
    if (key === 'required' && Array.isArray(value) && value.includes(name)) return true;
    if (key === 'properties' && typeof value === 'object' && value !== null && name in value) {
      return true;
    }
    return declaresName(value, name);
  });
}

describe('parseClaapRecordingUrl', () => {
  it('reads the workspace and recording IDs from a share URL', () => {
    expect(
      parseClaapRecordingUrl(
        'https://app.claap.io/noe-x-guillaume-14-10-2026-c-q2IqD9wUHb-oDgGKdqbnP3A',
      ),
    ).toEqual({workspaceId: 'q2IqD9wUHb', recordingId: 'oDgGKdqbnP3A'});
  });

  it('ignores the query string and the fragment', () => {
    expect(
      parseClaapRecordingUrl('https://app.claap.io/call-c-wsId1-recId2?t=42&utm=x#comments'),
    ).toEqual({workspaceId: 'wsId1', recordingId: 'recId2'});
  });

  it('accepts a non-ASCII slug', () => {
    expect(
      parseClaapRecordingUrl('https://app.claap.io/réunion-équipe-été-c-wsId1-recId2'),
    ).toEqual({workspaceId: 'wsId1', recordingId: 'recId2'});
  });

  it('uses the last path segment and the last -c- marker', () => {
    expect(parseClaapRecordingUrl('https://app.claap.io/a/b/demo-c-x-c-wsId1-recId2')).toEqual({
      workspaceId: 'wsId1',
      recordingId: 'recId2',
    });
  });

  it.each([
    'https://example.com/call-c-wsId1-recId2',
    'https://app.claap.io.evil.example/call-c-wsId1-recId2',
    'http://app.claap.io/call-c-wsId1-recId2',
  ])('rejects another host: %s', (value) => {
    expect(() => parseClaapRecordingUrl(value)).toThrow(ClaapRecordingUrlError);
  });

  it.each([
    'https://app.claap.io/',
    'https://app.claap.io/call',
    'https://app.claap.io/call-c-wsId1',
    'https://app.claap.io/call-c-wsId1-recId2/extra',
  ])('rejects a URL without the recording segment: %s', (value) => {
    expect(() => parseClaapRecordingUrl(value)).toThrow(ClaapRecordingUrlError);
  });

  it('rejects text that is not a URL', () => {
    expect(() => parseClaapRecordingUrl('not a url')).toThrow(ClaapRecordingUrlError);
  });
});
