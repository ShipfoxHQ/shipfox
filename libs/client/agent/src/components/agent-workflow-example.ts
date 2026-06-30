import type {CodeBlockHighlightedLineRange} from '@shipfox/react-ui';

const YAML_PLAIN_SCALAR_LEADING_INDICATOR_RE = /^[@`[\]{}#,&*!?|>'"%:]/;

export interface AgentWorkflowExample {
  code: string;
  highlightedLineRange: CodeBlockHighlightedLineRange;
}

export function buildAgentWorkflowExample({
  providerId,
  model,
}: {
  providerId: string;
  model: string;
}): AgentWorkflowExample {
  const lines = [
    'name: Agent',
    'triggers:',
    '  on_demand:',
    '    source: manual',
    '    event: fire',
    'jobs:',
    '  agent:',
    '    runner: ubuntu-latest',
    '    steps:',
    '      - name: implement',
    `        provider: ${formatYamlPlainOrSingleQuotedScalar(providerId)}`,
    `        model: ${formatYamlPlainOrSingleQuotedScalar(model)}`,
    '        prompt: Describe the change you want the agent to make.',
  ];
  const providerLineIndex = lines.findIndex((line) => line.trimStart().startsWith('provider:'));
  const modelLineIndex = lines.findIndex((line) => line.trimStart().startsWith('model:'));

  return {
    code: lines.join('\n'),
    highlightedLineRange: {
      startLine: providerLineIndex + 1,
      endLine: modelLineIndex + 1,
    },
  };
}

function formatYamlPlainOrSingleQuotedScalar(value: string): string {
  if (!requiresYamlSingleQuotes(value)) return value;
  return `'${value.replaceAll("'", "''")}'`;
}

function requiresYamlSingleQuotes(value: string): boolean {
  return (
    YAML_PLAIN_SCALAR_LEADING_INDICATOR_RE.test(value) ||
    value.includes(': ') ||
    value.includes('#')
  );
}
