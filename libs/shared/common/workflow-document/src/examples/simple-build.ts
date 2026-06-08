import type {WorkflowDocument} from '#document/workflow-document.js';

export const simpleBuildWorkflowDocument = {
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
      steps: [{run: 'npm install'}, {name: 'build', run: 'npm run build'}],
    },
  },
} satisfies WorkflowDocument;
