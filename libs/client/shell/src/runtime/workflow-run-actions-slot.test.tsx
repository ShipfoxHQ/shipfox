import {render, screen} from '@testing-library/react';
import type {PropsWithChildren} from 'react';
import {ChromeProvider, type ChromeSlots, type WorkflowRunActionsProps} from './chrome-context.js';
import {WorkflowRunActionsSlot} from './workflow-run-actions-slot.js';

const RUN_ID = '66666666-6666-4666-8666-666666666666';
const PROJECT_ID = '44444444-4444-4444-8444-444444444444';

function renderSlot(slot?: ChromeSlots['WorkflowRunActions']) {
  const chrome: ChromeSlots = {
    ProjectBreadcrumb: () => null,
    projectSlugResolver: async () => 'project',
    ...(slot ? {WorkflowRunActions: slot} : {}),
  };
  return render(
    <>
      <WorkflowRunActionsSlot workflowRunId={RUN_ID} projectId={PROJECT_ID} />
      <button type="button">Re-run workflow</button>
    </>,
    {
      wrapper: ({children}: PropsWithChildren) => (
        <ChromeProvider chrome={chrome}>{children}</ChromeProvider>
      ),
    },
  );
}

describe('WorkflowRunActionsSlot', () => {
  test('renders the slot with the run and project ids', () => {
    function Slot({workflowRunId, projectId}: WorkflowRunActionsProps) {
      return (
        <button type="button">
          {workflowRunId} {projectId}
        </button>
      );
    }

    renderSlot(Slot);

    expect(screen.getByRole('button', {name: `${RUN_ID} ${PROJECT_ID}`})).toBeVisible();
  });

  test('renders nothing when the slot is unset', () => {
    const {container} = render(
      <WorkflowRunActionsSlot workflowRunId={RUN_ID} projectId={PROJECT_ID} />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  test('renders nothing and reports the error when the slot throws', () => {
    const failure = new Error('Slot failed');
    const reportErrorSpy = vi.fn();
    vi.stubGlobal('reportError', reportErrorSpy);
    function Slot(): never {
      throw failure;
    }

    try {
      renderSlot(Slot);

      expect(screen.getAllByRole('button')).toHaveLength(1);
      expect(screen.getByRole('button', {name: 'Re-run workflow'})).toBeVisible();
      expect(reportErrorSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          cause: failure,
          message: 'Failed to render workflow run actions.',
        }),
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
