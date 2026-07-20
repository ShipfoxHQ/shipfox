import {
  AUTH_LEASED_JOB,
  AUTH_PROVISIONER_TOKEN,
  AUTH_RUNNER_REGISTRATION_TOKEN,
  AUTH_RUNNER_SESSION,
  AUTH_USER,
} from '@shipfox/api-auth-context';
import type {AuthMethod} from '@shipfox/node-fastify';
import {closeApp, createApp} from '@shipfox/node-fastify';
import type {FastifyInstance} from 'fastify';
import {createPlannedProvisionedCapacity, issueCapacityBootstrapCredential} from '#core/index.js';
import {
  createCapacityBootstrapAuthMethod,
  createCapacitySessionAuthMethod,
} from '#presentation/auth/index.js';
import {createRunnerRoutes} from './index.js';

const passthroughAuth = (name: string): AuthMethod => ({
  name,
  authenticate: () => Promise.resolve(),
});

describe('capacity sessions', () => {
  let app: FastifyInstance;
  let capacityId: string;
  let provisionerId: string;

  beforeAll(async () => {
    app = await createApp({
      auth: [
        passthroughAuth(AUTH_USER),
        passthroughAuth(AUTH_PROVISIONER_TOKEN),
        passthroughAuth(AUTH_RUNNER_REGISTRATION_TOKEN),
        passthroughAuth(AUTH_RUNNER_SESSION),
        passthroughAuth(AUTH_LEASED_JOB),
        createCapacityBootstrapAuthMethod(),
        createCapacitySessionAuthMethod(),
      ],
      routes: createRunnerRoutes(),
      swagger: false,
    });
    await app.ready();
  });

  afterAll(async () => {
    await closeApp();
  });

  beforeEach(async () => {
    provisionerId = crypto.randomUUID();
    const capacity = await createPlannedProvisionedCapacity({
      provisionerId,
      providerKind: null,
      templateKey: null,
    });
    capacityId = capacity.capacityId;
  });

  it('exchanges a bootstrap credential once and limits the session to its own capacity', async () => {
    const bootstrapCredential = await issueCapacityBootstrapCredential({
      capacityId,
      provisionerId,
      ttlSeconds: 60,
    });

    const exchange = await app.inject({
      method: 'POST',
      url: '/capacity/sessions',
      headers: {authorization: `Bearer ${bootstrapCredential}`},
      payload: {},
    });

    expect(exchange.statusCode).toBe(200);
    const sessionToken = exchange.json<{session_token: string}>().session_token;

    const declared = await app.inject({
      method: 'POST',
      url: '/capacity/declare',
      headers: {authorization: `Bearer ${sessionToken}`},
      payload: {labels: ['Linux', 'x64']},
    });
    const attached = await app.inject({
      method: 'POST',
      url: '/capacity/provider-runner',
      headers: {authorization: `Bearer ${sessionToken}`},
      payload: {provisioned_runner_id: 'provider-1'},
    });
    const repeatedAttach = await app.inject({
      method: 'POST',
      url: '/capacity/provider-runner',
      headers: {authorization: `Bearer ${sessionToken}`},
      payload: {provisioned_runner_id: 'provider-2'},
    });
    const jobRead = await app.inject({
      method: 'POST',
      url: '/runners/jobs/request',
      headers: {authorization: `Bearer ${sessionToken}`},
    });
    const replay = await app.inject({
      method: 'POST',
      url: '/capacity/sessions',
      headers: {authorization: `Bearer ${bootstrapCredential}`},
      payload: {},
    });

    expect(declared.json()).toEqual({accepted: true});
    expect(attached.json()).toEqual({attached: true});
    expect(repeatedAttach.json()).toEqual({attached: false});
    expect(jobRead.statusCode).not.toBe(200);
    expect(replay.statusCode).toBe(401);
  });
});
