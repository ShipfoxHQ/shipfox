import {createServer, type Server} from 'node:http';
import type {AddressInfo} from 'node:net';
import {type RawData, type WebSocket, WebSocketServer} from 'ws';

interface LoggedDispatch {
  s: number;
  t: string;
  d: unknown;
}

export interface FakeGatewayOptions {
  /** Send `GUILD_CREATE` right after `READY`, so the library can emit them out of order. */
  guildCreateAfterReady?: boolean;
}

export interface FakeGateway {
  /** Base URL for `DISCORD_API_BASE_URL`, including the version. */
  apiBaseUrl: string;
  /** Identify frames received. */
  readonly identifies: number;
  /** Resume frames received, with the sequence the client resumed from. */
  readonly resumes: {sessionId: string; seq: number}[];
  /** Close codes the client ended its sockets with. */
  readonly clientCloseCodes: number[];
  readonly gatewayBotCalls: number;
  readonly sessionId: string | undefined;
  setSessionStartLimit(params: {remaining: number; resetAfterMs: number; shards?: number}): void;
  /** Sends a dispatch to the connected client and records it for a later resume. */
  dispatch(t: string, d: unknown): number;
  /** Answers the next Resume with an Invalid Session that cannot be resumed. */
  rejectNextResume(): void;
  /** Ends the socket without a close frame, like a crashed process would. */
  dropSocket(): void;
  close(): Promise<void>;
}

export async function startFakeGateway(options: FakeGatewayOptions = {}): Promise<FakeGateway> {
  const server: Server = createServer();
  const sockets = new WebSocketServer({server});
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const {port} = server.address() as AddressInfo;
  const wsUrl = `ws://127.0.0.1:${port}`;

  let sessionCount = 0;
  let sessionId: string | undefined;
  let seq = 0;
  let log: LoggedDispatch[] = [];
  let identifies = 0;
  let gatewayBotCalls = 0;
  let rejectResume = false;
  let limit = {remaining: 1000, resetAfterMs: 60_000, shards: 1};
  let current: WebSocket | undefined;
  const resumes: {sessionId: string; seq: number}[] = [];
  const clientCloseCodes: number[] = [];

  server.on('request', (request, response) => {
    if (request.url?.endsWith('/gateway/bot')) {
      gatewayBotCalls++;
      response.setHeader('content-type', 'application/json');
      response.end(
        JSON.stringify({
          url: wsUrl,
          shards: limit.shards,
          session_start_limit: {
            total: 1000,
            remaining: limit.remaining,
            reset_after: limit.resetAfterMs,
            max_concurrency: 1,
          },
        }),
      );
      return;
    }
    response.statusCode = 404;
    response.end();
  });

  function send(socket: WebSocket, frame: unknown): void {
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(frame));
  }

  function record(t: string, d: unknown): LoggedDispatch {
    const entry = {s: ++seq, t, d};
    log.push(entry);
    return entry;
  }

  function sendDispatch(socket: WebSocket, entry: LoggedDispatch): void {
    send(socket, {op: 0, s: entry.s, t: entry.t, d: entry.d});
  }

  function identify(socket: WebSocket): void {
    identifies++;
    sessionId = `fake-session-${++sessionCount}`;
    seq = 0;
    log = [];
    sendDispatch(
      socket,
      record('READY', {
        v: 10,
        session_id: sessionId,
        resume_gateway_url: wsUrl,
        guilds: [],
        user: {id: 'bot-user'},
        application: {id: 'application'},
      }),
    );
    if (options.guildCreateAfterReady) {
      sendDispatch(socket, record('GUILD_CREATE', {id: 'guild-1'}));
    }
  }

  function resume(socket: WebSocket, data: {session_id: string; seq: number}): void {
    resumes.push({sessionId: data.session_id, seq: data.seq});
    if (rejectResume || data.session_id !== sessionId) {
      rejectResume = false;
      sessionId = undefined;
      send(socket, {op: 9, d: false});
      return;
    }
    for (const entry of log.filter((candidate) => candidate.s > data.seq)) {
      sendDispatch(socket, entry);
    }
    send(socket, {op: 0, s: ++seq, t: 'RESUMED', d: {}});
  }

  sockets.on('connection', (socket) => {
    current = socket;
    send(socket, {op: 10, d: {heartbeat_interval: 30_000}});
    socket.on('message', (raw: RawData) => {
      const frame = JSON.parse(raw.toString()) as {op: number; d: never};
      if (frame.op === 1) send(socket, {op: 11});
      if (frame.op === 2) identify(socket);
      if (frame.op === 6) resume(socket, frame.d);
    });
    socket.on('close', (code) => {
      clientCloseCodes.push(code);
      if (current === socket) current = undefined;
    });
  });

  return {
    apiBaseUrl: `http://127.0.0.1:${port}/api/v10`,
    get identifies() {
      return identifies;
    },
    resumes,
    clientCloseCodes,
    get gatewayBotCalls() {
      return gatewayBotCalls;
    },
    get sessionId() {
      return sessionId;
    },
    setSessionStartLimit(params) {
      limit = {
        remaining: params.remaining,
        resetAfterMs: params.resetAfterMs,
        shards: params.shards ?? limit.shards,
      };
    },
    dispatch(t, d) {
      const entry = record(t, d);
      if (current) sendDispatch(current, entry);
      return entry.s;
    },
    rejectNextResume() {
      rejectResume = true;
    },
    dropSocket() {
      current?.terminate();
    },
    async close() {
      for (const socket of sockets.clients) socket.terminate();
      await new Promise<void>((resolve) => sockets.close(() => resolve()));
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
