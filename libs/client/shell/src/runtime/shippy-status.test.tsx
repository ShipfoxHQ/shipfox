import {render, screen} from '@testing-library/react';
import {ShellProviders} from '../testing/index.js';
import {type ShippyState, useCurrentShippyStatus, useShippyStatus} from './shippy-status.js';

function Dock({state, unread}: {state: ShippyState; unread: number}) {
  useShippyStatus({state, unread});
  return null;
}

function Launcher() {
  const {state, unread} = useCurrentShippyStatus();
  return <output>{`${state} ${unread}`}</output>;
}

function tree(state?: ShippyState, unread = 0) {
  return (
    <ShellProviders>
      {state ? <Dock state={state} unread={unread} /> : null}
      <Launcher />
    </ShellProviders>
  );
}

describe('useShippyStatus', () => {
  test('reads idle while no dock publishes', () => {
    render(tree());

    expect(screen.getByRole('status')).toHaveTextContent('idle 0');
  });

  test('follows the published state and clears it when the dock unmounts', () => {
    const {rerender} = render(tree('working'));
    expect(screen.getByRole('status')).toHaveTextContent('working 0');

    rerender(tree('reply_ready', 2));
    expect(screen.getByRole('status')).toHaveTextContent('reply_ready 2');

    rerender(tree());
    expect(screen.getByRole('status')).toHaveTextContent('idle 0');
  });
});
