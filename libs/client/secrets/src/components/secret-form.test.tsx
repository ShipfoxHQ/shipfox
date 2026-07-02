import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {render, screen} from '@testing-library/react';
import {SecretForm} from './secret-form.js';

function renderEditForm() {
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <SecretForm
        workspaceId="11111111-1111-4111-8111-111111111111"
        mode="edit"
        existingKey="API_TOKEN"
        onSaved={() => undefined}
        onCancel={() => undefined}
      />
    </QueryClientProvider>,
  );
}

describe('SecretForm write-only invariant', () => {
  test('never prefills the value when editing an existing secret', () => {
    renderEditForm();

    const value = screen.getByLabelText('Value') as HTMLTextAreaElement;

    expect(value.value).toBe('');
  });

  test('locks the name and keeps it uneditable when editing', () => {
    renderEditForm();

    const name = screen.getByLabelText('Name') as HTMLInputElement;

    expect(name.value).toBe('API_TOKEN');
    expect(name).toBeDisabled();
  });
});
