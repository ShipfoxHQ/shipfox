import {parseSessionRecord} from './parse-session.js';

function record(data: unknown): {data: string; ts: number} {
  return {data: JSON.stringify(data), ts: 1_700_000_000_000};
}

describe('repository context session rows', () => {
  it.each(['pi', 'claude'] as const)('renders what a %s step loaded', (harness) => {
    const rows = parseSessionRecord(
      record({
        type: 'shipfox_repository_context',
        instructionsEnabled: true,
        skillsEnabled: true,
        instructions: [
          {path: 'AGENTS.md', bytes: 120, truncated: false},
          {path: 'packages/api/AGENTS.md', bytes: 65_536, truncated: true},
        ],
        skills: [
          {name: 'review', path: '.agents/skills/review'},
          {name: 'tdd', path: '~/.agents/skills/tdd'},
          {name: 'debug', path: '~/.agents/skills/debug'},
        ],
      }),
      harness,
    );

    expect(rows).toEqual([
      {
        kind: 'lifecycle',
        timestamp: 1_700_000_000_000,
        label: 'Repository context',
        detail:
          'Instructions: AGENTS.md, packages/api/AGENTS.md (truncated). ' +
          'Skills: review (.agents/skills); tdd, debug (~/.agents/skills).',
        meta: [],
        tone: 'default',
        terminalFailure: false,
      },
    ]);
  });

  it('distinguishes turned-off context from context that was not found', () => {
    const rows = parseSessionRecord(
      record({
        type: 'shipfox_repository_context',
        instructionsEnabled: true,
        skillsEnabled: false,
        instructions: [],
        skills: [],
      }),
      'pi',
    );

    expect(rows[0]).toMatchObject({detail: 'Instructions: none found. Skills: off.'});
  });
});
