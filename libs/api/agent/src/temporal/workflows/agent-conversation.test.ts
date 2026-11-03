import {resolve} from 'node:path';
import {ApplicationFailure} from '@temporalio/common';
import {TestWorkflowEnvironment} from '@temporalio/testing';
import {Worker} from '@temporalio/worker';
import {CONVERSATION_WAKE_SIGNAL_NAME, MODEL_CALLS_PER_TURN} from '../constants.js';

const TASK_QUEUE = 'test-agent-conversation';
const WORKFLOWS_PATH = resolve(import.meta.dirname, '../../../dist/temporal/workflows/index.js');

interface Call {
  name: string;
  input: unknown;
}

interface Scenario {
  /** What each beginTurn answers, in order. An exhausted list answers "no turn". */
  turns: ({turnId: string} | undefined | (() => Promise<{turnId: string} | undefined>))[];
  modelCall: (input: {modelCallIndex: number; turnId: string}) => Promise<unknown> | unknown;
  /** Whether the claim before a model call finds a requested stop. */
  stopRequested?: () => boolean;
  compact: (input: unknown) => Promise<{compacted: boolean}> | {compacted: boolean};
}

let testEnv: TestWorkflowEnvironment;
let worker: Worker;
let workerRun: Promise<void>;
let calls: Call[] = [];
let scenario: Scenario;

function named(name: string): unknown[] {
  return calls.filter((call) => call.name === name).map((call) => call.input);
}

beforeAll(async () => {
  testEnv = await TestWorkflowEnvironment.createLocal();
  worker = await Worker.create({
    connection: testEnv.nativeConnection,
    taskQueue: TASK_QUEUE,
    workflowsPath: WORKFLOWS_PATH,
    activities: {
      beginTurn: async (input: unknown) => {
        calls.push({name: 'beginTurn', input});
        const next = scenario.turns.shift();
        return typeof next === 'function' ? await next() : next;
      },
      claimPendingInputs: (input: unknown) => {
        calls.push({name: 'claimPendingInputs', input});
        return {claimed: 0, stopRequested: scenario.stopRequested?.() ?? false};
      },
      modelCall: async (input: {modelCallIndex: number; turnId: string}) => {
        calls.push({name: 'modelCall', input});
        return await scenario.modelCall(input);
      },
      compactConversation: async (input: unknown) => {
        calls.push({name: 'compactConversation', input});
        return await scenario.compact(input);
      },
      toolCall: (input: unknown) => {
        calls.push({name: 'toolCall', input});
        return {status: 'success'};
      },
      finishTurn: (input: unknown) => {
        calls.push({name: 'finishTurn', input});
      },
    },
  });
  workerRun = worker.run();
  workerRun.catch(() => undefined);
}, 60_000);

afterAll(async () => {
  worker?.shutdown();
  await workerRun;
  await testEnv?.teardown();
}, 15_000);

beforeEach(() => {
  calls = [];
  scenario = {
    turns: [],
    modelCall: () => ({stopReason: 'stop', toolCallCount: 0}),
    compact: () => ({compacted: true}),
  };
});

async function run(conversationId = crypto.randomUUID()) {
  await testEnv.client.workflow.execute('agentConversationWorkflow', {
    taskQueue: TASK_QUEUE,
    workflowId: `agent-conversation:${conversationId}`,
    args: [{conversationId}],
  });
  return conversationId;
}

describe('agentConversationWorkflow', () => {
  it('alternates claims, model calls, and tool calls until the model stops calling tools', async () => {
    scenario.turns = [{turnId: 'turn-1'}];
    scenario.modelCall = ({modelCallIndex}) =>
      modelCallIndex === 0
        ? {stopReason: 'toolUse', toolCallCount: 2}
        : {stopReason: 'stop', toolCallCount: 0};

    const conversationId = await run();

    expect(calls.map((call) => call.name)).toEqual([
      'beginTurn',
      'claimPendingInputs',
      'modelCall',
      'toolCall',
      'toolCall',
      'claimPendingInputs',
      'modelCall',
      'finishTurn',
      'beginTurn',
    ]);
    expect(named('toolCall')).toEqual([
      {conversationId, turnId: 'turn-1', modelCallIndex: 0, callIndex: 0},
      {conversationId, turnId: 'turn-1', modelCallIndex: 0, callIndex: 1},
    ]);
    expect(named('finishTurn')).toEqual([{conversationId, turnId: 'turn-1', status: 'succeeded'}]);
  });

  it('fails a turn with step_limit after 25 model calls and makes no 26th', async () => {
    scenario.turns = [{turnId: 'turn-1'}];
    scenario.modelCall = () => ({stopReason: 'toolUse', toolCallCount: 1});

    const conversationId = await run();

    expect(named('modelCall')).toHaveLength(MODEL_CALLS_PER_TURN);
    expect(named('finishTurn')).toEqual([
      {conversationId, turnId: 'turn-1', status: 'failed', failureCode: 'step_limit'},
    ]);
  });

  it('records the cause of a failed model call and goes on to the next turn', async () => {
    scenario.turns = [{turnId: 'turn-1'}, {turnId: 'turn-2'}];
    let attempt = 0;
    scenario.modelCall = () => {
      attempt += 1;
      if (attempt === 1) throw ApplicationFailure.nonRetryable('Bad request', 'provider_error');
      return {stopReason: 'stop', toolCallCount: 0};
    };

    const conversationId = await run();

    expect(named('finishTurn')).toEqual([
      {conversationId, turnId: 'turn-1', status: 'failed', failureCode: 'provider_error'},
      {conversationId, turnId: 'turn-2', status: 'succeeded'},
    ]);
    expect(named('modelCall')).toHaveLength(2);
  });

  it('finishes the turn as stopped when the claim finds a stop request, and makes no model call', async () => {
    scenario.turns = [{turnId: 'turn-1'}];
    scenario.stopRequested = () => true;

    const conversationId = await run();

    expect(named('modelCall')).toHaveLength(0);
    expect(named('claimPendingInputs')).toEqual([{conversationId, turnId: 'turn-1'}]);
    expect(named('finishTurn')).toEqual([{conversationId, turnId: 'turn-1', status: 'stopped'}]);
  });

  it('finishes the turn as stopped when the model call was stopped, then goes on to the next turn', async () => {
    scenario.turns = [{turnId: 'turn-1'}, {turnId: 'turn-2'}];
    scenario.modelCall = ({turnId}) =>
      turnId === 'turn-1'
        ? {stopReason: 'stopped', toolCallCount: 0}
        : {stopReason: 'stop', toolCallCount: 0};

    const conversationId = await run();

    expect(named('toolCall')).toHaveLength(0);
    expect(named('finishTurn')).toEqual([
      {conversationId, turnId: 'turn-1', status: 'stopped'},
      {conversationId, turnId: 'turn-2', status: 'succeeded'},
    ]);
  });

  it('retries a transient model failure without failing the turn', async () => {
    scenario.turns = [{turnId: 'turn-1'}];
    let attempt = 0;
    scenario.modelCall = () => {
      attempt += 1;
      if (attempt === 1) throw ApplicationFailure.retryable('Overloaded', 'provider_unavailable');
      return {stopReason: 'stop', toolCallCount: 0};
    };

    const conversationId = await run();

    expect(named('modelCall')).toHaveLength(2);
    expect(named('finishTurn')).toEqual([{conversationId, turnId: 'turn-1', status: 'succeeded'}]);
  });

  it('reads an unknown failure as internal_error', async () => {
    scenario.turns = [{turnId: 'turn-1'}];
    scenario.modelCall = () => {
      throw ApplicationFailure.nonRetryable('Odd', 'something_else');
    };

    const conversationId = await run();

    expect(named('finishTurn')).toEqual([
      {conversationId, turnId: 'turn-1', status: 'failed', failureCode: 'internal_error'},
    ]);
  });

  it('compacts, then repeats the same model call, without using up a call of the budget', async () => {
    scenario.turns = [{turnId: 'turn-1'}];
    scenario.modelCall = ({modelCallIndex}) =>
      calls.filter((call) => call.name === 'modelCall').length === 1
        ? {stopReason: 'compact', toolCallCount: 0, compactionCause: 'overflow'}
        : {stopReason: 'stop', toolCallCount: 0, modelCallIndex};

    const conversationId = await run();

    expect(calls.map((call) => call.name).slice(0, 7)).toEqual([
      'beginTurn',
      'claimPendingInputs',
      'modelCall',
      'compactConversation',
      'claimPendingInputs',
      'modelCall',
      'finishTurn',
    ]);
    expect(named('compactConversation')).toEqual([
      {conversationId, turnId: 'turn-1', modelCallIndex: 0, cause: 'overflow'},
    ]);
    expect(named('modelCall')).toEqual([
      {conversationId, turnId: 'turn-1', modelCallIndex: 0},
      {conversationId, turnId: 'turn-1', modelCallIndex: 0},
    ]);
    expect(named('finishTurn')).toEqual([{conversationId, turnId: 'turn-1', status: 'succeeded'}]);
  });

  it('fails the turn when a second compaction in a row is needed for the same call', async () => {
    scenario.turns = [{turnId: 'turn-1'}];
    scenario.modelCall = () => ({
      stopReason: 'compact',
      toolCallCount: 0,
      compactionCause: 'estimate',
    });

    const conversationId = await run();

    expect(named('compactConversation')).toHaveLength(1);
    expect(named('modelCall')).toHaveLength(2);
    expect(named('finishTurn')).toEqual([
      {conversationId, turnId: 'turn-1', status: 'failed', failureCode: 'context_overflow'},
    ]);
  });

  it('fails the turn when there is nothing to summarize', async () => {
    scenario.turns = [{turnId: 'turn-1'}];
    scenario.modelCall = () => ({
      stopReason: 'compact',
      toolCallCount: 0,
      compactionCause: 'estimate',
    });
    scenario.compact = () => ({compacted: false});

    const conversationId = await run();

    expect(named('modelCall')).toHaveLength(1);
    expect(named('finishTurn')).toEqual([
      {conversationId, turnId: 'turn-1', status: 'failed', failureCode: 'context_overflow'},
    ]);
  });

  it('may compact again for a later call of the same turn', async () => {
    scenario.turns = [{turnId: 'turn-1'}];
    const compactAt = new Set([0, 1]);
    scenario.modelCall = ({modelCallIndex}) => {
      const done = calls.filter(
        (call) =>
          call.name === 'compactConversation' &&
          (call.input as {modelCallIndex: number}).modelCallIndex === modelCallIndex,
      );
      if (compactAt.has(modelCallIndex) && done.length === 0) {
        return {stopReason: 'compact', toolCallCount: 0, compactionCause: 'estimate'};
      }
      return modelCallIndex === 0
        ? {stopReason: 'toolUse', toolCallCount: 1}
        : {stopReason: 'stop', toolCallCount: 0};
    };

    await run();

    expect(named('compactConversation')).toHaveLength(2);
    expect(named('finishTurn')).toMatchObject([{status: 'succeeded'}]);
  });

  it('looks again when a wake arrives while it finds nothing to do', async () => {
    const conversationId = crypto.randomUUID();
    scenario.turns = [
      async () => {
        await testEnv.client.workflow
          .getHandle(`agent-conversation:${conversationId}`)
          .signal(CONVERSATION_WAKE_SIGNAL_NAME);
        return undefined;
      },
      {turnId: 'turn-1'},
    ];

    await run(conversationId);

    expect(named('beginTurn')).toHaveLength(3);
    expect(named('finishTurn')).toHaveLength(1);
  });
});
