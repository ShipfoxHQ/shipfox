import {render, screen} from '@testing-library/react';
import {ShellProviders} from '../testing/index.js';
import {type ShippyState, useCurrentShippyStatus, useShippyStatus} from './shippy-status.js';

function Dock({state}: {state: ShippyState}) {
  useShippyStatus({state});
  return null;
}

function Launcher() {
  return <output>{useCurrentShippyStatus().state}</output>;
}

function tree(state?: ShippyState) {
  return (
    <ShellProviders>
      {state ? <Dock state={state} /> : null}
      <Launcher />
    </ShellProviders>
  );
}

describe('useShippyStatus', () => {
  test('reads idle while no dock publishes', () => {
    render(tree());

    expect(screen.getByRole('status')).toHaveTextContent('idle');
  });

  test('follows the published state and clears it when the dock unmounts', () => {
    const {rerender} = render(tree('working'));
    expect(screen.getByRole('status')).toHaveTextContent('working');

    rerender(tree('reply_ready'));
    expect(screen.getByRole('status')).toHaveTextContent('reply_ready');

    rerender(tree());
    expect(screen.getByRole('status')).toHaveTextContent('idle');
  });
});
