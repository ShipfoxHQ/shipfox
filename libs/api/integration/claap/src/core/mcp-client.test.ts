import {StreamableHTTPError} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {ClaapIntegrationProviderError, ClaapInvalidApiKeyError} from './errors.js';
import {type CreateClaapMcpClient, listClaapWorkspaces} from './mcp-client.js';

const endpoint = new URL('https://api.claap.io/mcp');

function clientReturning(result: unknown): CreateClaapMcpClient {
  return vi.fn().mockResolvedValue({
    callTool: vi.fn().mockResolvedValue(result),
    close: vi.fn().mockResolvedValue(undefined),
  });
}

describe('listClaapWorkspaces', () => {
  it('calls list_workspaces with empty arguments and reads the text content', async () => {
    const callTool = vi.fn().mockResolvedValue({
      content: [
        {
          type: 'text',
          text: JSON.stringify({workspaces: [{workspaceId: 'q2IqD9wUHb', name: 'Mercateam'}]}),
        },
      ],
    });
    const close = vi.fn().mockResolvedValue(undefined);
    const createClient = vi.fn().mockResolvedValue({callTool, close});

    await expect(
      listClaapWorkspaces({endpoint, apiKey: 'cla_secret', createClient}),
    ).resolves.toEqual([{workspaceId: 'q2IqD9wUHb', name: 'Mercateam'}]);

    expect(createClient).toHaveBeenCalledWith({endpoint, apiKey: 'cla_secret'});
    expect(callTool).toHaveBeenCalledWith({toolId: 'list_workspaces', arguments: {}}, 30_000);
    expect(close).toHaveBeenCalled();
  });

  it('prefers structured content when Claap returns it', async () => {
    const createClient = clientReturning({
      content: [],
      structuredContent: {workspaces: [{workspaceId: 'ws1', name: 'One'}]},
    });

    await expect(
      listClaapWorkspaces({endpoint, apiKey: 'cla_secret', createClient}),
    ).resolves.toEqual([{workspaceId: 'ws1', name: 'One'}]);
  });

  it.each([401, 403])('reports an HTTP %s at initialize as an invalid key', async (status) => {
    const createClient = vi.fn().mockRejectedValue(new StreamableHTTPError(status, 'denied'));

    await expect(
      listClaapWorkspaces({endpoint, apiKey: 'cla_secret', createClient}),
    ).rejects.toBeInstanceOf(ClaapInvalidApiKeyError);
  });

  it('maps other transport failures to a provider error', async () => {
    const createClient = vi.fn().mockRejectedValue(new StreamableHTTPError(503, 'down'));

    await expect(
      listClaapWorkspaces({endpoint, apiKey: 'cla_secret', createClient}),
    ).rejects.toMatchObject({reason: 'provider-unavailable', status: 503});
  });

  it('rejects an isError result and closes the client', async () => {
    const close = vi.fn().mockResolvedValue(undefined);
    const createClient = vi.fn().mockResolvedValue({
      callTool: vi.fn().mockResolvedValue({isError: true, content: [{type: 'text', text: 'no'}]}),
      close,
    });

    await expect(
      listClaapWorkspaces({endpoint, apiKey: 'cla_secret', createClient}),
    ).rejects.toMatchObject({reason: 'provider-rejected'});
    expect(close).toHaveBeenCalled();
  });

  it.each([
    [{content: [{type: 'text', text: 'not json'}]}],
    [{content: [{type: 'text', text: '{"workspaces":"nope"}'}]}],
    [{content: [{type: 'text', text: '{"workspaces":[{"workspaceId":1,"name":"x"}]}'}]}],
  ])('rejects a response it cannot read', async (result) => {
    const createClient = clientReturning(result);

    const error = await listClaapWorkspaces({endpoint, apiKey: 'cla_secret', createClient}).catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(ClaapIntegrationProviderError);
    expect(error).toMatchObject({reason: 'malformed-provider-response'});
  });
});
