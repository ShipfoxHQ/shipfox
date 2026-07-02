import {configureApiClient} from '@shipfox/client-api';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {render, screen, waitFor} from '@testing-library/react';
import {variable} from '#test/fixtures/secrets.js';
import {VariableForm} from './variable-form.js';

const FULL_VALUE_ERROR = /Could not load the current value/;

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    headers: {'content-type': 'application/json'},
    status: 200,
    ...init,
  });
}

function renderTruncatedEdit(fetchImpl: typeof fetch) {
  configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});
  const queryClient = new QueryClient({defaultOptions: {queries: {retry: false}}});
  return render(
    <QueryClientProvider client={queryClient}>
      <VariableForm
        workspaceId="11111111-1111-4111-8111-111111111111"
        mode="edit"
        existingKey="TLS_CERT"
        existingValue="-----BEGIN CERTIFICATE-----"
        existingValueTruncated
        onSaved={() => undefined}
        onCancel={() => undefined}
      />
    </QueryClientProvider>,
  );
}

describe('VariableForm truncated edit', () => {
  test('loads the full value and enables the update button', async () => {
    const fetchImpl = (() =>
      Promise.resolve(
        jsonResponse({variable: variable({value: 'full-certificate-body'})}),
      )) as unknown as typeof fetch;

    renderTruncatedEdit(fetchImpl);

    const value = (await screen.findByLabelText('Value')) as HTMLTextAreaElement;
    await waitFor(() => expect(value.value).toBe('full-certificate-body'));
    expect(screen.getByRole('button', {name: 'Update variable'})).toBeEnabled();
  });

  test('keeps the update button disabled and surfaces an error when the full value fails to load', async () => {
    const fetchImpl = (() =>
      Promise.resolve(
        jsonResponse({code: 'server-error', message: 'boom'}, {status: 500}),
      )) as unknown as typeof fetch;

    renderTruncatedEdit(fetchImpl);

    await screen.findByText(FULL_VALUE_ERROR);
    expect(screen.getByRole('button', {name: 'Update variable'})).toBeDisabled();
  });
});
