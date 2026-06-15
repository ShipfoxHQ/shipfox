vi.mock('#workspace/workspace.js', () => ({
  createJobDir: vi.fn(),
}));

import {executeSetupStep} from '#execution/setup-step.js';
import {createJobDir} from '#workspace/workspace.js';

const mockCreateJobDir = vi.mocked(createJobDir);

const CWD = '/tmp/shipfox-test-root/job-1';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('executeSetupStep', () => {
  it('prepares the workspace and succeeds', async () => {
    mockCreateJobDir.mockResolvedValue();

    const result = await executeSetupStep({cwd: CWD});

    expect(mockCreateJobDir).toHaveBeenCalledWith(CWD);
    expect(result).toEqual({success: true, output: '', error: null, exit_code: 0});
  });

  it('reports workspace_prep_failed when creating the directory fails', async () => {
    mockCreateJobDir.mockRejectedValue(new Error('mkdir denied'));

    const result = await executeSetupStep({cwd: CWD});

    expect(result.success).toBe(false);
    expect(result.exit_code).toBeNull();
    expect(result.error).toEqual({message: 'mkdir denied', reason: 'workspace_prep_failed'});
  });
});
