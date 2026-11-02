import {projectsInterModuleContract} from '@shipfox/api-projects-dto/inter-module';
import type {InferenceSegmentInputDto} from '@shipfox/api-usage-dto';
import {createInterModuleKnownError} from '@shipfox/inter-module';
import {assertConversationProjects} from './conversation-projects.js';

describe('assertConversationProjects', () => {
  const requireProjectForWorkspace = vi.fn();
  const projects = {requireProjectForWorkspace};

  beforeEach(() => {
    requireProjectForWorkspace.mockReset();
    requireProjectForWorkspace.mockResolvedValue({project: {}});
  });

  it('asks once for each project in a batch', async () => {
    const first = conversationSegment();
    const second = conversationSegment();

    await assertConversationProjects({projects, segments: [first, second]});

    expect(requireProjectForWorkspace).toHaveBeenCalledTimes(1);
    expect(requireProjectForWorkspace).toHaveBeenCalledWith({
      workspaceId: WORKSPACE_ID,
      projectId: PROJECT_ID,
    });
  });

  it('leaves step segments to the job execution projection', async () => {
    const {conversationId, agentKey, ...base} = conversationSegment();
    const step = {
      ...base,
      workflowRunId: crypto.randomUUID(),
      workflowRunAttemptId: crypto.randomUUID(),
      jobId: crypto.randomUUID(),
      jobExecutionId: crypto.randomUUID(),
      stepId: crypto.randomUUID(),
      stepAttemptId: crypto.randomUUID(),
    };

    await assertConversationProjects({projects, segments: [step]});

    expect(requireProjectForWorkspace).not.toHaveBeenCalled();
  });

  it('reports a project of another workspace as an identity mismatch', async () => {
    requireProjectForWorkspace.mockRejectedValue(
      createInterModuleKnownError(
        projectsInterModuleContract.methods.requireProjectForWorkspace,
        'project-workspace-mismatch',
        {projectId: PROJECT_ID, workspaceId: WORKSPACE_ID},
      ),
    );

    await expect(
      assertConversationProjects({projects, segments: [conversationSegment()]}),
    ).rejects.toThrow(`Inference segment identity mismatch for project ${PROJECT_ID}`);
  });

  it('accepts the last tokens of a deleted project', async () => {
    requireProjectForWorkspace.mockRejectedValue(
      createInterModuleKnownError(
        projectsInterModuleContract.methods.requireProjectForWorkspace,
        'project-not-found',
        {projectId: PROJECT_ID},
      ),
    );

    await expect(
      assertConversationProjects({projects, segments: [conversationSegment()]}),
    ).resolves.toBeUndefined();
  });

  it('surfaces a failed lookup unchanged, so the caller can retry', async () => {
    const outage = new Error('Projects is unavailable');
    requireProjectForWorkspace.mockRejectedValue(outage);

    await expect(
      assertConversationProjects({projects, segments: [conversationSegment()]}),
    ).rejects.toBe(outage);
  });
});

const WORKSPACE_ID = '00000000-0000-4000-8000-000000000001';
const PROJECT_ID = '00000000-0000-4000-8000-000000000002';

function conversationSegment(): InferenceSegmentInputDto {
  return {
    segmentKey: `gateway:${crypto.randomUUID()}`,
    source: 'gateway',
    workspaceId: WORKSPACE_ID,
    projectId: PROJECT_ID,
    conversationId: crypto.randomUUID(),
    agentKey: 'shippy',
    upstream: 'openai',
    model: 'gpt-5',
    dialect: 'openai-responses',
    windowStart: '2026-09-04T10:00:00.000Z',
    windowEnd: '2026-09-04T10:01:00.000Z',
    requestCount: 1,
    inputTokens: 10,
    outputTokens: 20,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    reasoningTokens: 0,
    webSearchRequests: 0,
  };
}
