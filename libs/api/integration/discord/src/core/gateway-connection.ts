import {setTimeout as sleep} from 'node:timers/promises';
import {REST} from '@discordjs/rest';
import {WebSocketManager, WebSocketShardEvents} from '@discordjs/ws';
import {reportError} from '@shipfox/node-error-monitoring';
import {logger} from '@shipfox/node-opentelemetry';
import {GatewayIntentBits} from 'discord-api-types/v10';
import {createDiscordApiClient} from '#api/client.js';
import {config} from '#config.js';
import {
  flushDiscordGatewaySession,
  getDiscordGatewaySession,
  startDiscordGatewaySession,
} from '#db/gateway-sessions.js';
import {gatewayBackoffMs} from './gateway-backoff.js';
import {
  type DispatchHandlers,
  DispatchQueue,
  type GatewayDispatchPayload,
} from './gateway-dispatch-queue.js';
import {
  createIdentifyGuard,
  GATEWAY_ERROR_BOUNDARY,
  type IdentifyGuardOptions,
} from './gateway-identify-guard.js';
import {
  GATEWAY_SHARD_COUNT,
  GATEWAY_SHARD_ID,
  GatewaySessionState,
} from './gateway-session-state.js';

export const GATEWAY_INTENTS =
  GatewayIntentBits.Guilds |
  GatewayIntentBits.GuildMessages |
  GatewayIntentBits.GuildMessageReactions |
  GatewayIntentBits.MessageContent;

/** Discord ends the session on close code `1000`, so our own destroys use another code. */
export const GATEWAY_KEEP_SESSION_CLOSE_CODE = 4000;

export const GATEWAY_FLUSH_INTERVAL_MS = 5_000;
/** A connection that stayed ready this long is healthy, so the next failure backs off from the start. */
export const GATEWAY_STABLE_MS = 60_000;
const DESTROY_TIMEOUT_MS = 5_000;
const STOPPED = new Error('Discord Gateway stopped');
const API_VERSION_RE = /\/v(\d+)$/;
const TRAILING_SLASHES_RE = /\/+$/;

export interface DiscordGatewayRunOptions {
  /** Dispatch handlers by event name. A dispatch without a handler is skipped and committed. */
  handlers?: DispatchHandlers;
  botToken?: string;
  apiBaseUrl?: string;
  getGatewayBot?: IdentifyGuardOptions['getGatewayBot'];
  identifySpacingMs?: number;
  flushIntervalMs?: number;
  stableMs?: number;
  /** Delay before the next connection attempt. Defaults to 5 s doubling up to 5 minutes, jittered. */
  backoffMs?: (attempt: number) => number;
}

export interface DiscordGatewayRun {
  /** Destroys the socket with a resumable close code and writes the cursors. */
  stop(): Promise<void>;
}

/**
 * Connects one shard and keeps it connected until stopped. Resumes from the committed cursor stored
 * in the sessions row, and rebuilds the manager after a handler or connect failure.
 */
export function startDiscordGatewayRun(options: DiscordGatewayRunOptions = {}): DiscordGatewayRun {
  const botToken = options.botToken ?? config.DISCORD_BOT_TOKEN;
  const apiBaseUrl = options.apiBaseUrl ?? config.DISCORD_API_BASE_URL;
  const flushIntervalMs = options.flushIntervalMs ?? GATEWAY_FLUSH_INTERVAL_MS;
  const stableMs = options.stableMs ?? GATEWAY_STABLE_MS;
  const stopController = new AbortController();
  const {signal} = stopController;

  const persistence = createSessionPersistence();
  let loadedState: GatewaySessionState | undefined;
  const rest = createRest({apiBaseUrl, botToken});
  const guard = createIdentifyGuard({
    getGatewayBot:
      options.getGatewayBot ??
      (() => createDiscordApiClient({botToken, baseUrl: apiBaseUrl}).getGatewayBot()),
    ...(options.identifySpacingMs === undefined ? {} : {spacingMs: options.identifySpacingMs}),
    ...(options.backoffMs ? {backoffMs: options.backoffMs} : {}),
  });

  const flushTimer = setInterval(() => {
    if (loadedState) void persistence.flush(loadedState);
  }, flushIntervalMs);
  flushTimer.unref();

  const finished = runUntilStopped().catch((error: unknown) => {
    logger().error({err: error}, 'Discord Gateway connection loop failed');
    reportError(error, {boundary: GATEWAY_ERROR_BOUNDARY});
  });

  /** The row is read in the background: a database outage must not block the leader's callback. */
  async function loadState(): Promise<GatewaySessionState | undefined> {
    for (let attempt = 0; !signal.aborted; attempt++) {
      try {
        const stored = await getDiscordGatewaySession({shardId: GATEWAY_SHARD_ID});
        const state: GatewaySessionState = new GatewaySessionState({
          stored,
          onSessionChange: () => persistence.writeSessionChange(state),
        });
        return state;
      } catch (error) {
        logger().error({err: error}, 'Discord Gateway could not read its session row');
        reportError(error, {boundary: GATEWAY_ERROR_BOUNDARY});
        if (!(await sleepUnlessStopped(backoffMs(attempt)))) return undefined;
      }
    }
    return undefined;
  }

  function backoffMs(attempt: number): number {
    return options.backoffMs?.(attempt) ?? gatewayBackoffMs({attempt});
  }

  async function sleepUnlessStopped(ms: number): Promise<boolean> {
    try {
      await sleep(ms, undefined, {signal});
      return true;
    } catch {
      return false;
    }
  }

  async function runUntilStopped(): Promise<void> {
    loadedState = await loadState();
    const state = loadedState;
    if (!state) return;
    let attempt = 0;
    while (!signal.aborted) {
      const {failure, readyAt} = await runManager(state);
      if (!failure) return;
      logger().error({err: failure}, 'Discord Gateway connection failed');
      reportError(failure, {boundary: GATEWAY_ERROR_BOUNDARY});
      if (readyAt !== undefined && Date.now() - readyAt >= stableMs) attempt = 0;
      if (!(await sleepUnlessStopped(backoffMs(attempt++)))) return;
    }
  }

  /** Resolves with the failure that ended the manager, or without one when stopped. */
  async function runManager(
    state: GatewaySessionState,
  ): Promise<{failure?: Error; readyAt?: number}> {
    let readyAt: number | undefined;
    let fail: (error: Error) => void = () => undefined;
    const failed = new Promise<Error>((resolve) => {
      fail = resolve;
    });
    const onStop = () => fail(STOPPED);
    signal.addEventListener('abort', onStop, {once: true});

    const manager = new WebSocketManager({
      token: botToken,
      rest,
      shardCount: GATEWAY_SHARD_COUNT,
      intents: GATEWAY_INTENTS,
      retrieveSessionInfo: state.retrieve,
      updateSessionInfo: state.update,
      buildIdentifyThrottler: () => guard,
    });
    const queue = new DispatchQueue({state, handlers: options.handlers ?? {}, onFailure: fail});
    manager.on(WebSocketShardEvents.Dispatch, (payload: GatewayDispatchPayload) =>
      queue.push(payload),
    );
    manager.on(WebSocketShardEvents.Ready, () => {
      readyAt = Date.now();
    });
    manager.on(WebSocketShardEvents.Resumed, () => {
      readyAt = Date.now();
    });
    manager.on(WebSocketShardEvents.Error, (error) => {
      logger().warn({err: error}, 'Discord Gateway shard error');
    });
    manager.on(WebSocketShardEvents.SocketError, (error) => {
      logger().warn({err: error}, 'Discord Gateway socket error');
    });
    manager.connect().catch((error: unknown) => fail(toError(error)));

    const outcome = await failed;
    signal.removeEventListener('abort', onStop);
    queue.drop();
    await destroyKeepingSession(manager, state);
    return {
      ...(outcome === STOPPED ? {} : {failure: outcome}),
      ...(readyAt === undefined ? {} : {readyAt}),
    };
  }

  async function destroyKeepingSession(
    manager: WebSocketManager,
    state: GatewaySessionState,
  ): Promise<void> {
    try {
      await state.keepingSession(() =>
        withDeadline(
          Promise.resolve(
            manager.destroy({
              code: GATEWAY_KEEP_SESSION_CLOSE_CODE,
              reason: 'Shipfox Gateway shutdown',
            }),
          ),
          DESTROY_TIMEOUT_MS,
        ),
      );
    } catch (error) {
      logger().warn({err: error}, 'Discord Gateway destroy did not finish');
    }
  }

  return {
    async stop() {
      stopController.abort();
      await finished;
      clearInterval(flushTimer);
      if (loadedState) await persistence.flush(loadedState);
    },
  };
}

function createRest(params: {apiBaseUrl: string; botToken: string}): REST {
  const base = params.apiBaseUrl.replace(TRAILING_SLASHES_RE, '');
  const version = API_VERSION_RE.exec(base)?.[1];
  return new REST({
    api: version ? base.replace(API_VERSION_RE, '') : base,
    ...(version ? {version} : {}),
  }).setToken(params.botToken);
}

/** Row writes run one at a time, so a slow write can never overtake a newer one. */
function createSessionPersistence() {
  let chain: Promise<void> = Promise.resolve();
  let flushedVersion = -1;

  function enqueue(write: () => Promise<void>): Promise<void> {
    chain = chain.then(write).catch((error: unknown) => {
      logger().error({err: error}, 'Discord Gateway session write failed');
      reportError(error, {boundary: GATEWAY_ERROR_BOUNDARY});
    });
    return chain;
  }

  function flush(state: GatewaySessionState): Promise<void> {
    return enqueue(async () => {
      const version = state.version;
      if (version === flushedVersion) return;
      const snapshot = state.snapshot();
      await flushDiscordGatewaySession({shardId: GATEWAY_SHARD_ID, ...snapshot});
      flushedVersion = version;
    });
  }

  /** A new session is written at once: the resume point must never pair an old session with new cursors. */
  function writeSessionChange(state: GatewaySessionState): void {
    void enqueue(async () => {
      const {sessionId, resumeGatewayUrl} = state.snapshot();
      if (sessionId && resumeGatewayUrl) {
        await startDiscordGatewaySession({shardId: GATEWAY_SHARD_ID, sessionId, resumeGatewayUrl});
      }
    });
    void flush(state);
  }

  return {flush, writeSessionChange};
}

async function withDeadline<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Timed out after ${ms} ms`)), ms);
  });
  try {
    return await Promise.race([promise, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
