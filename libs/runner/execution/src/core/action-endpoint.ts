import {randomBytes} from 'node:crypto';
import {createServer} from 'node:http';
import type {AddressInfo} from 'node:net';
import type {ToolFailureResponseV1} from '@shipfox/actions/contract';

/** The per-step loopback endpoint an action process reaches through `SHIPFOX_ACTIONS_URL`. */
export interface ActionEndpoint {
  readonly url: string;
  /** Random bearer for this step. It dies when the endpoint closes. */
  readonly token: string;
  close(): Promise<void>;
}

const TOOLS_UNAVAILABLE: ToolFailureResponseV1 = {
  ok: false,
  call_id: null,
  error: {
    code: 'tools-unavailable',
    message: 'This runner does not serve tool calls to actions yet.',
    outcome_unknown: false,
  },
};

// Tool calls are not forwarded yet, so every authorized request gets a failure the SDK raises as
// a ToolCallError instead of a connection error.
export async function startActionEndpoint(): Promise<ActionEndpoint> {
  const token = randomBytes(32).toString('base64url');
  const server = createServer((request, response) => {
    request.resume();
    if (request.headers.authorization !== `Bearer ${token}`) {
      response.writeHead(401).end();
      return;
    }
    response
      .writeHead(503, {'content-type': 'application/json'})
      .end(JSON.stringify(TOOLS_UNAVAILABLE));
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const {port} = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}`,
    token,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
