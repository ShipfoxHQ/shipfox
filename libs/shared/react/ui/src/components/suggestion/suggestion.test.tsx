import {render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {Suggestion, Suggestions} from './suggestion.js';

describe('Suggestion', () => {
  test('passes its prompt to onClick', async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();
    render(
      <Suggestions>
        <Suggestion suggestion="Why did this run fail?" onClick={onClick} />
      </Suggestions>,
    );

    await user.click(screen.getByRole('button', {name: 'Why did this run fail?'}));

    expect(onClick).toHaveBeenCalledExactlyOnceWith('Why did this run fail?');
  });

  test('does not submit a surrounding form', async () => {
    const onSubmit = vi.fn((event: SubmitEvent) => event.preventDefault());
    const user = userEvent.setup();
    const {container} = render(
      <form>
        <Suggestion suggestion="Summarize this run" />
      </form>,
    );
    container.querySelector('form')?.addEventListener('submit', onSubmit);

    await user.click(screen.getByRole('button', {name: 'Summarize this run'}));

    expect(onSubmit).not.toHaveBeenCalled();
  });
});
