import {AGENT_OUTPUT_TOOL_NAMES, listHarnessDescriptors} from '@shipfox/api-agent-dto';
import {genericActionPresentation, pairSessionRows, resolveActionPresentation} from './activity.js';
import type {SessionViewRow} from './log-model.js';

/**
 * A representative input for every tool the runner can emit outside the integration catalog.
 * Adding a harness or Shipfox tool without an entry fails this suite on purpose.
 */
const representativeInputs: Record<string, unknown> = {
  read: {path: 'src/a.ts'},
  bash: {command: 'pnpm test'},
  edit: {path: 'src/a.ts', oldText: 'a', newText: 'b'},
  write: {path: 'src/a.ts', content: 'a'},
  grep: {pattern: 'TODO'},
  find: {pattern: '*.ts'},
  ls: {path: 'src'},
  web_search: {query: 'shipfox'},
  fetch_content: {url: 'https://shipfox.io'},
  get_search_content: {responseId: 'r1', url: 'https://shipfox.io'},
  Read: {file_path: 'src/a.ts'},
  Bash: {command: 'pnpm test'},
  Edit: {file_path: 'src/a.ts', old_string: 'a', new_string: 'b'},
  Write: {file_path: 'src/a.ts', content: 'a'},
  Glob: {pattern: '*.ts'},
  Grep: {pattern: 'TODO'},
  WebFetch: {url: 'https://shipfox.io', prompt: 'summarise'},
  WebSearch: {query: 'shipfox'},
  set_output: {key: 'summary', value: 'done'},
  mcp__shipfox_outputs__set_output: {key: 'summary', value: 'done'},
  mcp: {search: 'shipfox'},
};

/** Pi's discovery surface adds the proxy meta-tool outside both catalogs. */
const PI_MCP_PROXY_TOOL_NAME = 'mcp';

const emittedToolNames = [
  ...new Set([
    ...listHarnessDescriptors().flatMap((harness) => harness.tools.map((tool) => tool.name)),
    ...AGENT_OUTPUT_TOOL_NAMES,
    PI_MCP_PROXY_TOOL_NAME,
  ]),
];

function action(name: string, input: unknown) {
  const rows: {seq: number; lineNumber: number; row: SessionViewRow}[] = [
    {
      seq: 1,
      lineNumber: 1,
      row: {kind: 'tool-call', timestamp: 10, id: 'call', name, input: JSON.stringify(input)},
    },
    {
      seq: 2,
      lineNumber: 2,
      row: {
        kind: 'tool-result',
        timestamp: 20,
        toolCallId: 'call',
        toolName: name,
        output: 'result',
        isError: false,
      },
    },
  ];
  const [item] = pairSessionRows(rows);
  if (item?.kind !== 'action') throw new Error('expected paired action');
  return item.action;
}

describe('Activity presentation coverage', () => {
  test.each(emittedToolNames)('%s has a dedicated presentation', (name) => {
    expect(representativeInputs, `add a representative input for ${name}`).toHaveProperty(name);
    const paired = action(name, representativeInputs[name]);

    const presentation = resolveActionPresentation(paired);

    expect(presentation).not.toEqual(genericActionPresentation(paired));
    expect(['tool', 'unknown']).not.toContain(presentation.iconKind);
    expect(presentation.target).not.toBe(paired.request?.input);
  });
});
