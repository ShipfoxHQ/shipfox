import {render, screen, within} from '@testing-library/react';
import {
  type WorkflowSourceDocument,
  type WorkflowSourceLineRange,
  WorkflowSourceView,
} from './workflow-source-view.js';

const workflowSourceFixture: WorkflowSourceDocument = {
  path: '.shipfox/workflows/deploy.yml',
  format: 'yaml',
  content: [
    'name: deploy-production',
    'on:',
    '  push:',
    '    branches:',
    '      - main',
    '',
    'jobs:',
    '  build:',
    '    runs-on: ubuntu-latest',
    '    steps:',
    '      - uses: actions/checkout@v4',
    '      - name: Install dependencies',
    '        run: pnpm install --frozen-lockfile',
    '      - name: Build',
    '        run: pnpm turbo build --filter=@shipfox/client...',
    '  deploy:',
    '    needs: build',
    '    steps:',
    '      - name: Publish image',
    '        run: ./scripts/publish-image.sh production',
  ].join('\n'),
};

const workflowSourceFixtureRange: WorkflowSourceLineRange = {
  startLine: 12,
  endLine: 15,
  label: 'Selected step: Build',
};

function WorkflowSourceViewFixture({
  selectedRange = workflowSourceFixtureRange,
}: {
  selectedRange?: WorkflowSourceLineRange | null;
}) {
  return <WorkflowSourceView source={workflowSourceFixture} selectedRange={selectedRange} />;
}

describe('WorkflowSourceView', () => {
  test('renders source metadata, line count, and line numbers', () => {
    render(<WorkflowSourceViewFixture />);

    expect(screen.getByRole('region', {name: 'Workflow source'})).toBeInTheDocument();
    expect(screen.getByText('.shipfox/workflows/deploy.yml')).toBeInTheDocument();
    expect(screen.getByText('yaml')).toBeInTheDocument();
    expect(screen.getByText('20 lines')).toBeInTheDocument();
    expect(screen.getByText('name: deploy-production')).toBeInTheDocument();
    expect(screen.getByText('20')).toBeInTheDocument();
  });

  test('highlights the selected source range', () => {
    render(<WorkflowSourceViewFixture />);

    expect(screen.getByText('Selected step: Build')).toBeInTheDocument();
    expect(screen.getByRole('region', {name: 'Workflow source code'})).toHaveAttribute(
      'tabindex',
      '0',
    );

    const highlightedLines = document.querySelectorAll('[data-highlighted="true"]');
    expect(highlightedLines).toHaveLength(4);
    expect(within(highlightedLines[0] as HTMLElement).getByText('12')).toBeInTheDocument();
    expect(highlightedLines[3]?.textContent).toBe(
      '15        run: pnpm turbo build --filter=@shipfox/client...',
    );
  });

  test('uses a line-range label when selected range metadata has no label', () => {
    render(<WorkflowSourceViewFixture selectedRange={{startLine: 12, endLine: 15}} />);

    expect(screen.getByText('Lines 12-15')).toBeInTheDocument();
    expect(document.querySelectorAll('[data-highlighted="true"]')).toHaveLength(4);
  });

  test('renders the missing-location state without highlighted lines', () => {
    render(<WorkflowSourceViewFixture selectedRange={null} />);

    expect(screen.getByText('No step source location')).toBeInTheDocument();
    expect(document.querySelectorAll('[data-highlighted="true"]')).toHaveLength(0);
  });

  test('does not highlight a stale source range outside the document', () => {
    render(<WorkflowSourceViewFixture selectedRange={{startLine: 100, endLine: 104}} />);

    expect(screen.getByText('No step source location')).toBeInTheDocument();
    expect(document.querySelectorAll('[data-highlighted="true"]')).toHaveLength(0);
  });

  test('renders the missing-source state for empty source content', () => {
    render(<WorkflowSourceView source={{content: '', format: 'yaml'}} />);

    expect(screen.getByText('No source document')).toBeInTheDocument();
    expect(
      screen.getByText('The workflow source snapshot is not available for this run.'),
    ).toBeInTheDocument();
  });

  test('renders a single-line source without adding a trailing blank line', () => {
    render(<WorkflowSourceView source={{content: 'name: deploy-production\n', format: 'yaml'}} />);

    expect(screen.getByText('1 line')).toBeInTheDocument();
    expect(screen.getByText('name: deploy-production')).toBeInTheDocument();
    expect(screen.queryByText('2')).not.toBeInTheDocument();
  });

  test('normalizes CRLF source content', () => {
    render(
      <WorkflowSourceView source={{content: 'name: deploy\r\njobs:\r\n  test:', format: 'yaml'}} />,
    );

    expect(screen.getByText('3 lines')).toBeInTheDocument();
    expect(screen.getByText('name: deploy').textContent).toBe('name: deploy');
    expect(screen.getByText('jobs:').textContent).toBe('jobs:');
  });

  test('keeps long source lines intact for horizontal scrolling', () => {
    render(
      <WorkflowSourceView
        source={{
          ...workflowSourceFixture,
          content: [
            workflowSourceFixture.content,
            '      - run: node ./scripts/deploy.js --environment production --region us-east-1 --image ghcr.io/shipfox/platform/worker:sha-0123456789abcdef',
          ].join('\n'),
        }}
        selectedRange={{...workflowSourceFixtureRange, startLine: 21, endLine: 21}}
      />,
    );

    expect(screen.getByText('21').closest('[data-highlighted="true"]')?.textContent).toBe(
      '21      - run: node ./scripts/deploy.js --environment production --region us-east-1 --image ghcr.io/shipfox/platform/worker:sha-0123456789abcdef',
    );
    expect(screen.getByText('21 lines')).toBeInTheDocument();
  });
});
