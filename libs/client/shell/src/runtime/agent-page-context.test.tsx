import {render, screen} from '@testing-library/react';
import {ShellProviders} from '../testing/index.js';
import {
  type AgentPageContext,
  useAgentPageContext,
  useCurrentAgentPageContext,
} from './agent-page-context.js';

function Page({context}: {context: AgentPageContext}) {
  useAgentPageContext(context);
  return null;
}

function Reader({onRender}: {onRender?: () => void}) {
  onRender?.();
  return <output>{JSON.stringify(useCurrentAgentPageContext() ?? null)}</output>;
}

describe('useAgentPageContext', () => {
  test('publishes the page and clears it on unmount', () => {
    const tree = (page?: AgentPageContext) => (
      <ShellProviders>
        {page ? <Page context={page} /> : null}
        <Reader />
      </ShellProviders>
    );
    const {rerender} = render(tree({page: 'workflow', definitionId: 'definition'}));
    expect(screen.getByRole('status')).toHaveTextContent(
      '{"page":"workflow","definitionId":"definition"}',
    );

    rerender(tree());

    expect(screen.getByRole('status')).toHaveTextContent('null');
  });

  test('follows the page as its data loads', () => {
    const tree = (status?: string) => (
      <ShellProviders>
        <Page context={{page: 'run', runId: 'run', status}} />
        <Reader />
      </ShellProviders>
    );
    const {rerender} = render(tree());

    rerender(tree('failed'));

    expect(screen.getByRole('status')).toHaveTextContent(
      '{"page":"run","runId":"run","status":"failed"}',
    );
  });

  test('keeps the next page when navigation swaps pages in one commit', () => {
    const tree = (page: AgentPageContext) => (
      <ShellProviders>
        <Page key={page.page} context={page} />
        <Reader />
      </ShellProviders>
    );
    const {rerender} = render(tree({page: 'runs'}));

    rerender(tree({page: 'workflows'}));

    expect(screen.getByRole('status')).toHaveTextContent('{"page":"workflows"}');
  });

  test('does not notify readers when a page re-renders with equal values', () => {
    const onRender = vi.fn();
    const tree = () => (
      <ShellProviders>
        <Page context={{page: 'runs'}} />
        <Reader onRender={onRender} />
      </ShellProviders>
    );
    const {rerender} = render(tree());
    const rendersAfterMount = onRender.mock.calls.length;

    rerender(tree());

    expect(onRender).toHaveBeenCalledTimes(rendersAfterMount + 1);
  });
});
