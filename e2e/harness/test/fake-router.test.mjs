import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createServer} from 'node:http';
import {test} from 'node:test';
import {routeKeys, startFakeRouter} from '../src/fake-router.mjs';

async function startFake(label) {
  const requests = [];
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    requests.push({url: request.url, body: Buffer.concat(chunks).toString('utf8')});
    response.writeHead(200, {'content-type': 'application/json'}).end(JSON.stringify({label}));
  });
  server.listen({host: '127.0.0.1', port: 0});
  await once(server, 'listening');
  return {
    requests,
    origin: `http://127.0.0.1:${server.address().port}`,
    stop: async () => {
      server.close();
      server.closeAllConnections();
      await once(server, 'close');
    },
  };
}

async function withRouter(run) {
  const router = await startFakeRouter({name: 'test', endpoint: new URL('http://127.0.0.1:0')});
  try {
    await run(router.endpoint);
  } finally {
    await router.stop();
  }
}

async function register(endpoint, keys, target) {
  return await fetch(new URL('/__fakes/routes', endpoint), {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify({keys, target}),
  });
}

test('routes each credential to the fake that registered it', async () => {
  const first = await startFake('first');
  const second = await startFake('second');
  try {
    await withRouter(async (endpoint) => {
      assert.equal((await register(endpoint, ['token-a'], first.origin)).status, 201);
      assert.equal((await register(endpoint, ['token-b'], second.origin)).status, 201);

      const call = async (authorization, path = '/thing') =>
        await (await fetch(new URL(path, endpoint), {headers: {authorization}})).json();

      assert.deepEqual(await call('Bearer token-a'), {label: 'first'});
      assert.deepEqual(await call('bearer token-b'), {label: 'second'});
      assert.deepEqual(await call('token token-a', '/other?q=1'), {label: 'first'});
      assert.equal(first.requests.at(-1).url, '/other?q=1');
    });
  } finally {
    await first.stop();
    await second.stop();
  }
});

test('forwards request bodies and routes basic credentials by password', async () => {
  const fake = await startFake('git');
  try {
    await withRouter(async (endpoint) => {
      await register(endpoint, ['installation-token'], fake.origin);
      const basic = Buffer.from('x-access-token:installation-token').toString('base64');

      const response = await fetch(new URL('/github.com/acme/app.git/git-receive-pack', endpoint), {
        method: 'POST',
        headers: {authorization: `Basic ${basic}`},
        body: 'pack-data',
      });

      assert.equal(response.status, 200);
      assert.deepEqual(fake.requests.at(-1), {
        url: '/github.com/acme/app.git/git-receive-pack',
        body: 'pack-data',
      });
    });
  } finally {
    await fake.stop();
  }
});

test('routes a GitHub token mint by installation', async () => {
  const fake = await startFake('github');
  try {
    await withRouter(async (endpoint) => {
      await register(endpoint, ['installation:77', 'ghs_token'], fake.origin);

      const response = await fetch(new URL('/app/installations/77/access_tokens', endpoint), {
        method: 'POST',
        headers: {authorization: 'Bearer app-jwt'},
        body: '{}',
      });

      assert.deepEqual(await response.json(), {label: 'github'});
    });
  } finally {
    await fake.stop();
  }
});

test('answers 404 for a credential no fake registered', async () => {
  await withRouter(async (endpoint) => {
    const unknown = await fetch(new URL('/thing', endpoint), {
      headers: {authorization: 'Bearer nobody'},
    });
    const anonymous = await fetch(new URL('/thing', endpoint));

    assert.equal(unknown.status, 404);
    assert.equal(anonymous.status, 404);
  });
});

test('stops routing a credential once its fake unregisters', async () => {
  const fake = await startFake('gone');
  try {
    await withRouter(async (endpoint) => {
      const {id} = await (await register(endpoint, ['token-a'], fake.origin)).json();

      const removed = await fetch(new URL(`/__fakes/routes/${id}`, endpoint), {method: 'DELETE'});
      const after = await fetch(new URL('/thing', endpoint), {
        headers: {authorization: 'Bearer token-a'},
      });

      assert.equal(removed.status, 204);
      assert.equal(after.status, 404);
    });
  } finally {
    await fake.stop();
  }
});

test('refuses a credential another live fake holds, and takes over a dead one', async () => {
  const live = await startFake('live');
  const dead = await startFake('dead');
  const replacement = await startFake('replacement');
  try {
    await withRouter(async (endpoint) => {
      await register(endpoint, ['shared'], live.origin);
      const conflict = await register(endpoint, ['shared'], replacement.origin);
      assert.equal(conflict.status, 409);

      await register(endpoint, ['stale'], dead.origin);
      await dead.stop();
      const takeover = await register(endpoint, ['stale'], replacement.origin);
      assert.equal(takeover.status, 201);
      const response = await fetch(new URL('/thing', endpoint), {
        headers: {authorization: 'Bearer stale'},
      });
      assert.deepEqual(await response.json(), {label: 'replacement'});
    });
  } finally {
    await live.stop();
    await replacement.stop();
  }
});

test('answers 502 when the registered fake is unreachable', async () => {
  const fake = await startFake('unreachable');
  try {
    await withRouter(async (endpoint) => {
      await register(endpoint, ['token-a'], fake.origin);
      await fake.stop();

      const response = await fetch(new URL('/thing', endpoint), {
        headers: {authorization: 'Bearer token-a'},
      });

      assert.equal(response.status, 502);
    });
  } finally {
    await fake.stop().catch(() => undefined);
  }
});

test('lists mint keys before credentials', () => {
  const keys = routeKeys({
    method: 'POST',
    url: '/app/installations/5/access_tokens',
    headers: {authorization: 'Bearer app-jwt'},
  });

  assert.deepEqual(keys, ['installation:5', 'app-jwt']);
});
