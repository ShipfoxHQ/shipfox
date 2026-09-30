import {render, screen} from '@testing-library/react';
import type {AgentModel, ModelLock} from '#core/models.js';
import {ModelLockNotices} from './model-lock.js';

const CREDITS_LOCK: ModelLock = {
  label: 'Add credits to use',
  message: 'A step that uses this model fails until you add credits.',
  action: {reason: 'add-credits', message: 'Add credits', url: '/billing'},
};

function model(label: string, locked?: ModelLock): AgentModel {
  return {id: label.toLowerCase().replaceAll(' ', '-'), label, locked};
}

describe('ModelLockNotices', () => {
  test('renders nothing when no model is locked', () => {
    const {container} = render(<ModelLockNotices models={[model('Claude Haiku 4.5')]} />);

    expect(container).toBeEmptyDOMElement();
  });

  test('names the locked model and links to the required action', () => {
    render(<ModelLockNotices models={[model('Claude Opus 4.8', CREDITS_LOCK)]} />);

    expect(screen.getByText('Claude Opus 4.8 is not available')).toBeInTheDocument();
    expect(screen.getByText(CREDITS_LOCK.message)).toBeInTheDocument();
    expect(screen.getByRole('link', {name: 'Add credits'})).toHaveAttribute('href', '/billing');
  });

  test('groups models that share a reason into one notice', () => {
    render(
      <ModelLockNotices
        models={[
          model('Claude Opus 4.8', CREDITS_LOCK),
          model('Claude Haiku 4.5'),
          model('Claude Sonnet 4.8', CREDITS_LOCK),
        ]}
      />,
    );

    expect(
      screen.getByText('Claude Opus 4.8 and Claude Sonnet 4.8 are not available'),
    ).toBeInTheDocument();
    expect(screen.getAllByRole('link', {name: 'Add credits'})).toHaveLength(1);
  });

  test('counts the models when more than two share a reason', () => {
    render(
      <ModelLockNotices
        models={['A', 'B', 'C'].map((label) => model(`Model ${label}`, CREDITS_LOCK))}
      />,
    );

    expect(screen.getByText('3 models are not available')).toBeInTheDocument();
  });

  test('renders one notice per distinct reason', () => {
    render(
      <ModelLockNotices
        models={[
          model('Claude Opus 4.8', CREDITS_LOCK),
          model('GPT-5.5 Pro', {
            label: 'Ask an owner',
            message: 'Ask an owner to enable this model.',
          }),
        ]}
      />,
    );

    expect(screen.getByText('Claude Opus 4.8 is not available')).toBeInTheDocument();
    expect(screen.getByText('GPT-5.5 Pro is not available')).toBeInTheDocument();
  });
});
