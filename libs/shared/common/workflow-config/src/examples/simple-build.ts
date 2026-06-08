import type {WorkflowConfig} from '#config/workflow-config.js';

export const simpleBuildWorkflowConfig = {
  name: 'simple build',
  triggers: {
    main_push: {
      source: 'github',
      event: 'push',
      filter: 'event.ref == "refs/heads/main"',
    },
  },
  jobs: {
    build: {
      steps: [
        {run: 'npm install'},
        {
          id: 'build',
          run: 'npm run build',
          gate: {
            success_if: 'exit_code == 0',
          },
        },
      ],
    },
  },
} satisfies WorkflowConfig;
