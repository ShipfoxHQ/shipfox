import {projectsInterModuleContract} from '@shipfox/api-projects-dto/inter-module';
import type {InferenceSegmentInputDto} from '@shipfox/api-usage-dto';
import {
  type UsageModuleClient,
  usageInterModuleContract,
} from '@shipfox/api-usage-dto/inter-module';
import {createInterModuleKnownError} from '@shipfox/inter-module';
import {createInMemoryInterModuleTransport} from '@shipfox/node-module/inter-module';
import {listInferenceSegments} from '#db/inference-segments.js';
import {createUsageInterModulePresentation} from './inter-module.js';

describe('usage inter-module presentation', () => {
  const requireProjectForWorkspace = vi.fn();
  const transport = createInMemoryInterModuleTransport();
  const usage: UsageModuleClient = transport.createClient(usageInterModuleContract);
  transport.register(createUsageInterModulePresentation({projects: {requireProjectForWorkspace}}));
  transport.seal();

  beforeEach(() => {
    requireProjectForWorkspace.mockReset();
    requireProjectForWorkspace.mockResolvedValue({project: {}});
  });

  it('records a conversation segment once its project belongs to the workspace', async () => {
    const segment = conversationSegment();

    const result = await usage.recordInferenceSegments({segments: [segment]});

    expect(result).toEqual({recorded: 1, duplicates: 0});
    expect(requireProjectForWorkspace).toHaveBeenCalledWith({
      workspaceId: segment.workspaceId,
      projectId: segment.projectId,
    });
  });

  it('records nothing when the project belongs to another workspace', async () => {
    const segment = conversationSegment();
    requireProjectForWorkspace.mockRejectedValue(
      createInterModuleKnownError(
        projectsInterModuleContract.methods.requireProjectForWorkspace,
        'project-workspace-mismatch',
        {projectId: segment.projectId, workspaceId: segment.workspaceId},
      ),
    );

    await expect(usage.recordInferenceSegments({segments: [segment]})).rejects.toThrow();

    const page = await listInferenceSegments({workspaceId: segment.workspaceId});
    expect(page.segments).toHaveLength(0);
  });
});

function conversationSegment(): InferenceSegmentInputDto {
  return {
    segmentKey: `gateway:${crypto.randomUUID()}`,
    source: 'gateway',
    workspaceId: crypto.randomUUID(),
    projectId: crypto.randomUUID(),
    conversationId: crypto.randomUUID(),
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
