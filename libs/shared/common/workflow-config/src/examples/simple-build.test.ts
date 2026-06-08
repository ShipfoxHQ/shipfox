import {workflowConfigSchema} from '#config/workflow-config.js';
import {simpleBuildWorkflowConfig} from './simple-build.js';

describe('simpleBuildWorkflowConfig', () => {
  it('matches the workflow config schema', () => {
    const result = workflowConfigSchema.safeParse(simpleBuildWorkflowConfig);

    expect(result.success).toBe(true);
  });
});
