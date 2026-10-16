import {jamAgentToolCatalog, jamAgentToolSelectionCatalog} from './agent-tools.js';

const commentNudgePattern = /createComment|post a comment/i;

describe('Jam agent tool catalog', () => {
  it('keeps the allow-list and selection catalog deliberate', () => {
    expect(jamAgentToolCatalog).toMatchSnapshot();
    expect(jamAgentToolSelectionCatalog).toMatchSnapshot();
  });

  it('offers the ten read tools and no write tool', () => {
    expect(jamAgentToolCatalog.map((entry) => entry.id)).toEqual([
      'getDetails',
      'getConsoleLogs',
      'getNetworkRequests',
      'getUserEvents',
      'getMetadata',
      'getVideoTranscript',
      'getVideoChapters',
      'searchJams',
      'getScreenshots',
      'getFrames',
    ]);
  });

  it('never tells an agent to post a comment', () => {
    const nudges = jamAgentToolCatalog
      .filter((entry) => commentNudgePattern.test(entry.description))
      .map((entry) => entry.id);

    expect(nudges).toEqual([]);
  });
});

// A tool step compiles every input schema with strict Ajv and no format plugin, which rejects an
// unknown format such as `date-time` and fails every call to the tool.
describe('Jam agent tool input schemas', () => {
  it('declare no format, $schema or intent keyword', () => {
    const offenders = jamAgentToolCatalog
      .filter((entry) => {
        const schema = JSON.stringify(entry.inputSchema);
        return (
          schema.includes('"format"') || schema.includes('"$schema"') || schema.includes('"intent"')
        );
      })
      .map((entry) => entry.id);

    expect(offenders).toEqual([]);
  });

  it('leaves the query version of searchJams to the provider', () => {
    const search = jamAgentToolCatalog.find((entry) => entry.id === 'searchJams');

    expect(JSON.stringify(search?.inputSchema)).not.toContain('"v"');
    expect('required' in (search?.inputSchema ?? {})).toBe(false);
  });
});
