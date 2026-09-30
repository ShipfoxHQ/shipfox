import {setLangfuseTracerProvider} from '@langfuse/tracing';
import type {ReadableSpan} from '@opentelemetry/sdk-trace-node';
import {
  InMemorySpanExporter,
  NodeTracerProvider,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-node';
import {afterAll, beforeEach, describe, expect, it} from '@shipfox/vitest/vi';
import {parsePiTranscript, recordPiTranscript} from './pi-transcript.js';

const exporter = new InMemorySpanExporter();
const provider = new NodeTracerProvider({spanProcessors: [new SimpleSpanProcessor(exporter)]});
setLangfuseTracerProvider(provider);

beforeEach(() => {
  exporter.reset();
});

afterAll(async () => {
  setLangfuseTracerProvider(null);
  await provider.shutdown();
});

const usage = {
  input: 120,
  output: 30,
  cacheRead: 10,
  cacheWrite: 0,
  totalTokens: 160,
  cost: {input: 0.001, output: 0.002, cacheRead: 0, cacheWrite: 0, total: 0.003},
};

function line(entry: unknown): string {
  return JSON.stringify(entry);
}

function message({timestamp, message: body}: {timestamp: string; message: object}): string {
  return line({type: 'message', timestamp, message: body});
}

const transcript = [
  line({type: 'session', version: 3, id: 's1', timestamp: '2026-09-30T10:00:00.000Z', cwd: '/w'}),
  message({
    timestamp: '2026-09-30T10:00:00.100Z',
    message: {
      role: 'user',
      content: [{type: 'text', text: 'Add a flag.'}],
      timestamp: Date.parse('2026-09-30T10:00:00.100Z'),
    },
  }),
  message({
    timestamp: '2026-09-30T10:00:03.000Z',
    message: {
      role: 'assistant',
      api: 'openai-completions',
      provider: 'shipfox',
      model: 'gpt-6-luna',
      stopReason: 'toolUse',
      usage,
      timestamp: Date.parse('2026-09-30T10:00:01.000Z'),
      content: [
        {type: 'thinking', thinking: 'Look at the file first.'},
        {type: 'text', text: 'Reading the file.'},
        {type: 'toolCall', id: 'call-1', name: 'read', arguments: {path: 'src/a.ts'}},
        {type: 'toolCall', id: 'call-2', name: 'bash', arguments: {command: 'npm test'}},
      ],
    },
  }),
  message({
    timestamp: '2026-09-30T10:00:03.500Z',
    message: {
      role: 'toolResult',
      toolCallId: 'call-1',
      toolName: 'read',
      content: [{type: 'text', text: 'export const a = 1;'}],
      isError: false,
      timestamp: Date.parse('2026-09-30T10:00:03.500Z'),
    },
  }),
  message({
    timestamp: '2026-09-30T10:00:06.000Z',
    message: {
      role: 'toolResult',
      toolCallId: 'call-2',
      toolName: 'bash',
      content: [{type: 'text', text: 'FAIL'}],
      isError: true,
      timestamp: Date.parse('2026-09-30T10:00:06.000Z'),
    },
  }),
  message({
    timestamp: '2026-09-30T10:00:09.000Z',
    message: {
      role: 'assistant',
      api: 'openai-completions',
      provider: 'shipfox',
      model: 'gpt-6-luna',
      stopReason: 'stop',
      usage,
      timestamp: Date.parse('2026-09-30T10:00:07.000Z'),
      content: [{type: 'text', text: 'Done.'}],
    },
  }),
].join('\n');

function byName(spans: ReadableSpan[], name: string): ReadableSpan {
  const span = spans.find((candidate) => candidate.name === name);
  if (!span) throw new Error(`No span named ${name}`);
  return span;
}

function millis(time: [number, number]): number {
  return time[0] * 1000 + time[1] / 1_000_000;
}

describe('parsePiTranscript', () => {
  it('finds one model call per assistant message and one execution per tool call', () => {
    const parsed = parsePiTranscript(transcript);

    expect(parsed.modelCalls).toHaveLength(2);
    expect(parsed.toolExecutions.map((execution) => execution.name)).toEqual(['read', 'bash']);
  });

  it('bounds a model call by its request and completion times', () => {
    const [first] = parsePiTranscript(transcript).modelCalls;

    expect(first?.startTime.toISOString()).toBe('2026-09-30T10:00:01.000Z');
    expect(first?.endTime.toISOString()).toBe('2026-09-30T10:00:03.000Z');
  });

  it('starts a tool when the requesting message completes and ends it at its result', () => {
    const [read, bash] = parsePiTranscript(transcript).toolExecutions;

    expect(read?.startTime.toISOString()).toBe('2026-09-30T10:00:03.000Z');
    expect(read?.endTime.toISOString()).toBe('2026-09-30T10:00:03.500Z');
    expect(bash?.startTime.toISOString()).toBe('2026-09-30T10:00:03.000Z');
    expect(bash).toMatchObject({endTime: new Date('2026-09-30T10:00:06.000Z'), isError: true});
  });

  it('gives each model call the messages that came before it', () => {
    const [first, second] = parsePiTranscript(transcript).modelCalls;

    expect(first?.input.map((item) => item.role)).toEqual(['user']);
    expect(second?.input.map((item) => item.role)).toEqual(['user', 'assistant', 'tool', 'tool']);
  });

  it('keeps thinking and tool calls out of the visible text', () => {
    const [first] = parsePiTranscript(transcript).modelCalls;

    expect(first?.output).toEqual({
      role: 'assistant',
      content: 'Reading the file.',
      thinking: 'Look at the file first.',
      tool_calls: [
        {id: 'call-1', name: 'read', arguments: {path: 'src/a.ts'}},
        {id: 'call-2', name: 'bash', arguments: {command: 'npm test'}},
      ],
    });
  });

  it('skips malformed lines and reports a tool call the session never answered', () => {
    const parsed = parsePiTranscript(
      [
        '{not json',
        message({
          timestamp: '2026-09-30T10:00:03.000Z',
          message: {
            role: 'assistant',
            content: [{type: 'toolCall', id: 'call-9', name: 'read', arguments: {}}],
          },
        }),
      ].join('\n'),
    );

    expect(parsed.modelCalls).toHaveLength(1);
    expect(parsed.skippedLines).toBe(1);
    expect(parsed.toolExecutions[0]?.result).toBeUndefined();
  });

  it('returns an empty transcript for empty input', () => {
    expect(parsePiTranscript('')).toEqual({
      modelCalls: [],
      toolExecutions: [],
      startTime: undefined,
      endTime: undefined,
      skippedLines: 0,
    });
  });
});

describe('recordPiTranscript', () => {
  it('nests generations and tool observations under a span for the step', () => {
    recordPiTranscript({step: 'implement', jsonl: transcript});

    const spans = exporter.getFinishedSpans();
    const step = byName(spans, 'implement');
    const children = spans.filter(
      (span) => span.parentSpanContext?.spanId === step.spanContext().spanId,
    );
    expect(children.map((span) => span.name).sort()).toEqual([
      'Tool: bash',
      'Tool: read',
      'model call 1',
      'model call 2',
    ]);
    expect(step.attributes['langfuse.observation.type']).toBe('agent');
  });

  it('records generations with model, usage, cost, and their own timestamps', () => {
    recordPiTranscript({step: 'implement', jsonl: transcript});

    const generation = byName(exporter.getFinishedSpans(), 'model call 1');
    expect(generation.attributes['langfuse.observation.type']).toBe('generation');
    expect(generation.attributes['langfuse.observation.model.name']).toBe('gpt-6-luna');
    expect(
      JSON.parse(generation.attributes['langfuse.observation.usage_details'] as string),
    ).toEqual({
      input: 120,
      output: 30,
      cache_read_input_tokens: 10,
      cache_creation_input_tokens: 0,
      total: 160,
    });
    expect(
      JSON.parse(generation.attributes['langfuse.observation.cost_details'] as string),
    ).toMatchObject({
      total: 0.003,
    });
    expect(millis(generation.startTime)).toBe(Date.parse('2026-09-30T10:00:01.000Z'));
    expect(millis(generation.endTime)).toBe(Date.parse('2026-09-30T10:00:03.000Z'));
  });

  it('records a tool observation with its input, output, and error level', () => {
    recordPiTranscript({step: 'implement', jsonl: transcript});

    const spans = exporter.getFinishedSpans();
    const read = byName(spans, 'Tool: read');
    const bash = byName(spans, 'Tool: bash');
    expect(read.attributes['langfuse.observation.type']).toBe('tool');
    expect(JSON.parse(read.attributes['langfuse.observation.input'] as string)).toEqual({
      path: 'src/a.ts',
    });
    expect(read.attributes['langfuse.observation.output']).toBe('export const a = 1;');
    expect(bash.attributes['langfuse.observation.level']).toBe('ERROR');
  });

  it('attaches the raw JSONL to the step span as base64 media', () => {
    recordPiTranscript({step: 'implement', jsonl: transcript});

    const step = byName(exporter.getFinishedSpans(), 'implement');
    const output = JSON.parse(step.attributes['langfuse.observation.output'] as string) as {
      transcript: string;
    };
    expect(output.transcript).toBe(
      `data:application/x-ndjson;base64,${Buffer.from(transcript).toString('base64')}`,
    );
  });

  it('spans the step from its first entry to its last', () => {
    recordPiTranscript({step: 'implement', jsonl: transcript});

    const step = byName(exporter.getFinishedSpans(), 'implement');
    expect(millis(step.startTime)).toBe(Date.parse('2026-09-30T10:00:00.000Z'));
    expect(millis(step.endTime)).toBe(Date.parse('2026-09-30T10:00:09.000Z'));
  });

  it('flags a failed model call and a tool that never answered', () => {
    const jsonl = message({
      timestamp: '2026-09-30T10:00:03.000Z',
      message: {
        role: 'assistant',
        stopReason: 'error',
        errorMessage: 'provider down',
        content: [{type: 'toolCall', id: 'call-9', name: 'read', arguments: {}}],
      },
    });

    recordPiTranscript({step: 'implement', jsonl});

    const spans = exporter.getFinishedSpans();
    const generation = byName(spans, 'model call 1');
    const tool = byName(spans, 'Tool: read');
    expect(generation.attributes['langfuse.observation.level']).toBe('ERROR');
    expect(generation.attributes['langfuse.observation.status_message']).toBe('provider down');
    expect(tool.attributes['langfuse.observation.level']).toBe('WARNING');
  });

  it('records the number of unreadable lines on the step span', () => {
    recordPiTranscript({step: 'implement', jsonl: `{not json\n${transcript}`});

    const step = byName(exporter.getFinishedSpans(), 'implement');
    const metadata = step.attributes['langfuse.observation.metadata.skipped_lines'];
    expect(metadata).toBe('1');
  });
});
