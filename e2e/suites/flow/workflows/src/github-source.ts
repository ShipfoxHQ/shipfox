import {composeWorkflow, loadShippedTemplates} from '@shipfox/workflow-templates';

export const GITHUB_SOURCE_RUNNER_LABEL_PLACEHOLDER = '__RUNNER_LABEL__';

// A task step and a fix step stand in for the parts of ticket-to-pr around the source parts,
// which are the shipped ones.
const workflow = `name: ticket-to-pr GitHub source parts
runner: ${GITHUB_SOURCE_RUNNER_LABEL_PLACEHOLDER}
triggers:
  manual:
    source: manual
jobs:
  implement:
    # part:source.checkout
    steps:
      - key: task
        run: |
          printf 'identifier=task-1\\nrepository=\\n' >> "$SHIPFOX_OUTPUT"
        outputs:
          identifier: string
          repository: string
      # part:source.prepare
      - key: fix
        run: |
          git config user.name Fixture
          git config user.email fixture@example.com
          git config commit.gpgsign false
          printf 'export const value = 2;\\n' > src/index.ts
          printf 'status=implemented\\npr_title=Change the value\\n' >> "$SHIPFOX_OUTPUT"
        outputs:
          status: string
          pr_title: string
      # part:source.push
`;

/** ticket-to-pr's GitHub `source.checkout`, `source.prepare`, and `source.push` parts, composed. */
export function githubSourcePartsWorkflowYaml(): string {
  const template = loadShippedTemplates().find(({id}) => id === 'ticket-to-pr');
  const parts = template?.parts.source?.github;
  if (parts === undefined) throw new Error('ticket-to-pr ships no GitHub source parts');
  return composeWorkflow(workflow, parts);
}
