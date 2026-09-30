import {
  InMemorySpanExporter,
  NodeTracerProvider,
  type ReadableSpan,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-node';
import {afterAll, afterEach, beforeAll, describe, expect, it} from '@shipfox/vitest/vi';
import {exportClaudeTranscript, parseClaudeTranscript} from './claude-transcript.js';

const OBSERVATION_TYPE = 'langfuse.observation.type';

function line(entry: Record<string, unknown>): string {
  return JSON.stringify(entry);
}

function assistant({
  at,
  id,
  content,
  usage,
  stopReason = null,
}: {
  at: string;
  id: string;
  content: unknown[];
  usage: Record<string, number>;
  stopReason?: string | null;
}): string {
  return line({
    type: 'assistant',
    timestamp: at,
    sessionId: 'session-1',
    message: {
      id,
      role: 'assistant',
      model: 'claude-sonnet-5-5',
      content,
      stop_reason: stopReason,
      usage,
    },
  });
}

function toolResult({
  at,
  toolUseId,
  content,
  isError = false,
}: {
  at: string;
  toolUseId: string;
  content: unknown;
  isError?: boolean;
}): string {
  return line({
    type: 'user',
    timestamp: at,
    sessionId: 'session-1',
    message: {
      role: 'user',
      content: [{type: 'tool_result', tool_use_id: toolUseId, content, is_error: isError}],
    },
  });
}

/** Two turns, four model calls, and three tool calls, two of them in parallel. */
const transcript = [
  line({type: 'summary', summary: 'Ignored', leafUuid: 'leaf'}),
  line({
    type: 'user',
    timestamp: '2026-09-29T10:00:00.000Z',
    sessionId: 'session-1',
    message: {role: 'user', content: 'Set up the ticket-to-pr template.'},
  }),
  // One response, split over two lines that share a message id.
  assistant({
    at: '2026-09-29T10:00:02.000Z',
    id: 'msg_1',
    content: [{type: 'text', text: 'I will read the manifest.'}],
    usage: {input_tokens: 100, output_tokens: 1, cache_read_input_tokens: 40},
  }),
  assistant({
    at: '2026-09-29T10:00:03.000Z',
    id: 'msg_1',
    content: [{type: 'tool_use', id: 'toolu_1', name: 'Read', input: {file_path: 'README.md'}}],
    usage: {input_tokens: 100, output_tokens: 25, cache_read_input_tokens: 40},
    stopReason: 'tool_use',
  }),
  toolResult({
    at: '2026-09-29T10:00:04.000Z',
    toolUseId: 'toolu_1',
    content: [{type: 'text', text: '# Shipfox'}],
  }),
  assistant({
    at: '2026-09-29T10:00:06.000Z',
    id: 'msg_2',
    content: [{type: 'tool_use', id: 'toolu_2', name: 'Bash', input: {command: 'ls'}}],
    usage: {input_tokens: 150, output_tokens: 10},
  }),
  assistant({
    at: '2026-09-29T10:00:06.500Z',
    id: 'msg_2',
    content: [{type: 'tool_use', id: 'toolu_3', name: 'Bash', input: {command: 'false'}}],
    usage: {input_tokens: 150, output_tokens: 20},
    stopReason: 'tool_use',
  }),
  toolResult({at: '2026-09-29T10:00:07.000Z', toolUseId: 'toolu_2', content: 'package.json'}),
  toolResult({
    at: '2026-09-29T10:00:08.000Z',
    toolUseId: 'toolu_3',
    content: 'exit 1',
    isError: true,
  }),
  assistant({
    at: '2026-09-29T10:00:10.000Z',
    id: 'msg_3',
    content: [{type: 'text', text: 'The template is set up.'}],
    usage: {input_tokens: 200, output_tokens: 6},
    stopReason: 'end_turn',
  }),
  line({
    type: 'user',
    timestamp: '2026-09-29T10:01:00.000Z',
    sessionId: 'session-1',
    message: {role: 'user', content: [{type: 'text', text: 'Thanks. Did it validate?'}]},
  }),
  assistant({
    at: '2026-09-29T10:01:03.000Z',
    id: 'msg_4',
    content: [{type: 'text', text: 'Yes.'}],
    usage: {input_tokens: 220, output_tokens: 2},
    stopReason: 'end_turn',
  }),
  '{"type":"assistant","message":',
].join('\n');

describe('parseClaudeTranscript', () => {
  it('reads one generation per model call and one tool call per tool use', () => {
    const parsed = parseClaudeTranscript({jsonl: transcript});

    expect(parsed.sessionId).toBe('session-1');
    expect(parsed.turns.map((turn) => turn.generations.length)).toEqual([3, 1]);
    const [first, second, third] = parsed.turns[0]?.generations ?? [];
    expect(first).toMatchObject({
      id: 'msg_1',
      model: 'claude-sonnet-5-5',
      text: 'I will read the manifest.',
      input: ['Set up the ticket-to-pr template.'],
      usage: {input: 100, output: 25, cache_read_input_tokens: 40},
    });
    expect(second?.tools.map((tool) => tool.id)).toEqual(['toolu_2', 'toolu_3']);
    expect(third?.input).toEqual([
      {tool_use_id: 'toolu_2', content: 'package.json'},
      {tool_use_id: 'toolu_3', content: 'exit 1'},
    ]);
  });

  it('takes timestamps from the transcript', () => {
    const [turn] = parseClaudeTranscript({jsonl: transcript}).turns;
    const [first, second] = turn?.generations ?? [];

    // A generation runs from the input it saw to the last line of its response.
    expect(first?.start.toISOString()).toBe('2026-09-29T10:00:00.000Z');
    expect(first?.end.toISOString()).toBe('2026-09-29T10:00:03.000Z');
    // A tool runs from the line that called it to the line that answered.
    expect(first?.tools[0]?.start.toISOString()).toBe('2026-09-29T10:00:03.000Z');
    expect(first?.tools[0]?.end.toISOString()).toBe('2026-09-29T10:00:04.000Z');
    expect(first?.tools[0]?.output).toBe('# Shipfox');
    expect(second?.tools[1]).toMatchObject({isError: true, output: 'exit 1'});
    expect(turn?.end.toISOString()).toBe('2026-09-29T10:00:10.000Z');
  });

  it('gives untimed SDK messages the last known time', () => {
    const fallbackTime = new Date('2026-09-29T09:00:00.000Z');
    const jsonl = [
      line({type: 'system', subtype: 'init', session_id: 'sdk-1'}),
      line({type: 'user', message: {role: 'user', content: 'Hi'}}),
      line({
        type: 'assistant',
        message: {id: 'msg-1', role: 'assistant', content: [{type: 'text', text: 'Hello'}]},
      }),
    ].join('\n');

    const {sessionId, turns} = parseClaudeTranscript({jsonl, fallbackTime});

    expect(sessionId).toBe('sdk-1');
    expect(turns[0]?.generations[0]).toMatchObject({start: fallbackTime, end: fallbackTime});
  });
});

describe('exportClaudeTranscript', () => {
  const exporter = new InMemorySpanExporter();
  const provider = new NodeTracerProvider({spanProcessors: [new SimpleSpanProcessor(exporter)]});

  beforeAll(() => {
    provider.register();
  });

  afterAll(async () => {
    await provider.shutdown();
  });

  afterEach(() => {
    exporter.reset();
  });

  function spansOfType(spans: ReadableSpan[], type: string): ReadableSpan[] {
    return spans.filter((span) => span.attributes[OBSERVATION_TYPE] === type);
  }

  it('exports one generation per model call and one span per tool call', () => {
    const exported = exportClaudeTranscript({jsonl: transcript, metadata: {case: 'onboarding/a'}});

    const spans = exporter.getFinishedSpans();
    expect(exported).toEqual({turns: 2, generations: 4, tools: 3});
    expect(spansOfType(spans, 'generation')).toHaveLength(4);
    expect(spansOfType(spans, 'tool').map((span) => span.name)).toEqual([
      'Tool: Read',
      'Tool: Bash',
      'Tool: Bash',
    ]);
    expect(spansOfType(spans, 'agent')).toHaveLength(1);
    expect(spansOfType(spans, 'span').map((span) => span.name)).toEqual(['Turn 1', 'Turn 2']);
  });

  it('uses transcript times and nests observations under the turn and session', () => {
    exportClaudeTranscript({jsonl: transcript});

    const spans = exporter.getFinishedSpans();
    const [session] = spansOfType(spans, 'agent');
    const [turn] = spansOfType(spans, 'span');
    const [generation] = spansOfType(spans, 'generation');
    const [tool] = spansOfType(spans, 'tool');
    const millis = (time: [number, number]) => time[0] * 1000 + time[1] / 1e6;

    expect(millis(generation?.startTime ?? [0, 0])).toBe(Date.parse('2026-09-29T10:00:00.000Z'));
    expect(millis(generation?.endTime ?? [0, 0])).toBe(Date.parse('2026-09-29T10:00:03.000Z'));
    expect(millis(tool?.endTime ?? [0, 0])).toBe(Date.parse('2026-09-29T10:00:04.000Z'));
    expect(generation?.parentSpanContext?.spanId).toBe(turn?.spanContext().spanId);
    expect(tool?.parentSpanContext?.spanId).toBe(turn?.spanContext().spanId);
    expect(turn?.parentSpanContext?.spanId).toBe(session?.spanContext().spanId);
  });

  it('reports usage, model, and a failed tool', () => {
    exportClaudeTranscript({jsonl: transcript});

    const spans = exporter.getFinishedSpans();
    const [generation] = spansOfType(spans, 'generation');
    const failed = spansOfType(spans, 'tool')[2];

    expect(generation?.attributes['langfuse.observation.model.name']).toBe('claude-sonnet-5-5');
    expect(
      JSON.parse(String(generation?.attributes['langfuse.observation.usage_details'])),
    ).toEqual({input: 100, output: 25, cache_read_input_tokens: 40});
    expect(failed?.attributes['langfuse.observation.level']).toBe('ERROR');
  });

  it('warns about a tool whose result never arrives', () => {
    // A run that hits its turn or time limit ends right after the tool call.
    const cutOff = [
      line({
        type: 'user',
        timestamp: '2026-09-29T10:00:00.000Z',
        message: {role: 'user', content: 'Run the tests.'},
      }),
      assistant({
        at: '2026-09-29T10:00:02.000Z',
        id: 'msg_1',
        content: [{type: 'tool_use', id: 'toolu_1', name: 'Bash', input: {command: 'npm test'}}],
        usage: {input_tokens: 10, output_tokens: 5},
        stopReason: 'tool_use',
      }),
    ].join('\n');

    exportClaudeTranscript({jsonl: cutOff});

    const [tool] = spansOfType(exporter.getFinishedSpans(), 'tool');
    expect(tool?.attributes['langfuse.observation.level']).toBe('WARNING');
    expect(tool?.attributes['langfuse.observation.status_message']).toBe(
      'No tool result in the transcript',
    );
    expect(tool?.attributes['langfuse.observation.output']).toBeUndefined();
  });

  it('attaches the raw JSONL as media on the session span', () => {
    exportClaudeTranscript({jsonl: transcript});

    const [session] = spansOfType(exporter.getFinishedSpans(), 'agent');
    const output = String(session?.attributes['langfuse.observation.output']);

    expect(output).toContain(
      `data:application/x-ndjson;base64,${Buffer.from(transcript).toString('base64')}`,
    );
    expect(output).toContain('Yes.');
  });

  it('nests the session under the active span', () => {
    const tracer = provider.getTracer('test');
    tracer.startActiveSpan('item', (item) => {
      exportClaudeTranscript({jsonl: transcript});
      item.end();
    });

    const spans = exporter.getFinishedSpans();
    const item = spans.find((span) => span.name === 'item');
    const [session] = spansOfType(spans, 'agent');

    expect(session?.parentSpanContext?.spanId).toBe(item?.spanContext().spanId);
  });
});
