import type {WorkflowsJobEventDeliveredEventDto} from '@shipfox/api-workflows-dto';
import {onJobEventDelivered} from './on-job-event-delivered.js';

const signalMock = vi.fn();
const getHandleMock = vi.fn(() => ({signal: signalMock}));

vi.mock('@shipfox/node-opentelemetry', () => ({
  logger: () => ({debug: vi.fn()}),
}));

vi.mock('@shipfox/node-temporal', () => ({
  temporalClient: () => ({workflow: {getHandle: getHandleMock}}),
}));

function buildPayload(
  overrides: Partial<WorkflowsJobEventDeliveredEventDto> = {},
): WorkflowsJobEventDeliveredEventDto {
  return {
    jobId: crypto.randomUUID(),
    disposition: 'fire',
    eventRef: crypto.randomUUID(),
    eventName: 'pull_request_review',
    ...overrides,
  };
}

describe('onJobEventDelivered', () => {
  beforeEach(() => {
    getHandleMock.mockClear();
    signalMock.mockReset();
    signalMock.mockResolvedValue(undefined);
  });

  it('signals the listener workflow when a fire event is delivered', async () => {
    const payload = buildPayload({disposition: 'fire'});

    await onJobEventDelivered(payload);

    expect(getHandleMock).toHaveBeenCalledWith(`job-listener:${payload.jobId}`);
    expect(signalMock).toHaveBeenCalledWith('events-available');
  });

  it('signals the listener workflow when a resolve event is delivered', async () => {
    const payload = buildPayload({disposition: 'resolve'});

    await onJobEventDelivered(payload);

    expect(getHandleMock).toHaveBeenCalledWith(`job-listener:${payload.jobId}`);
    expect(signalMock).toHaveBeenCalledWith('resolve');
  });

  it('discards a delivered event when the listener workflow already terminated', async () => {
    const notFound = new Error('gone');
    notFound.name = 'WorkflowNotFoundError';
    signalMock.mockRejectedValueOnce(notFound);

    const result = onJobEventDelivered(buildPayload());

    await expect(result).resolves.toBeUndefined();
    expect(signalMock).toHaveBeenCalledTimes(1);
  });

  it('rethrows a non-terminal signal failure', async () => {
    const failure = new Error('temporal unavailable');
    signalMock.mockRejectedValueOnce(failure);

    const result = onJobEventDelivered(buildPayload());

    await expect(result).rejects.toBe(failure);
  });
});
