import assert from 'node:assert/strict';
import {test} from 'node:test';
import {startJamMock} from '../src/jam-mock.mjs';

const VIDEO = '4ea19ea4-b021-474f-b254-5df55d37d702';
const SCREENSHOT = '64bc4070-8ada-45a6-a15d-f60851f85ddd';

async function withMock(run) {
  const mock = await startJamMock(new URL('http://127.0.0.1:0'));
  try {
    await run(mock.endpoint);
  } finally {
    await mock.stop();
  }
}

async function rpc({endpoint, token, method, params, id = 1}) {
  return await fetch(new URL('/mcp', endpoint), {
    method: 'POST',
    headers: {'content-type': 'application/json', authorization: `Bearer ${token}`},
    body: JSON.stringify({jsonrpc: '2.0', id, method, params}),
  });
}

async function call({endpoint, token = 'jam_pat_test', tool, args}) {
  const response = await rpc({
    endpoint,
    token,
    method: 'tools/call',
    params: {name: tool, arguments: args},
  });
  assert.equal(response.status, 200);
  return (await response.json()).result;
}

async function control(endpoint, body) {
  const response = await fetch(new URL('/__e2e/control', endpoint), {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify(body),
  });
  assert.equal(response.status, 200);
}

async function introspect(endpoint, token) {
  const response = await fetch(new URL('/oauth/introspect', endpoint), {
    method: 'POST',
    headers: {'content-type': 'application/x-www-form-urlencoded'},
    body: new URLSearchParams({token}),
  });
  return await response.json();
}

const textOf = (result, index = 0) => result.content[index].text;

test('introspects a read token, a CLI-only token, and a revoked token', async () => {
  await withMock(async (endpoint) => {
    const read = await introspect(endpoint, 'jam_pat_read');
    assert.equal(read.active, true);
    assert.equal(read.scope, 'cli:read mcp:read');
    assert.equal(typeof read.team_id, 'string');

    assert.equal((await introspect(endpoint, 'jam_pat_cli-only')).scope, 'cli:read cli:write');
    assert.deepEqual(await introspect(endpoint, 'jam_pat_revoked'), {active: false});
    assert.deepEqual(await introspect(endpoint, 'not-a-pat'), {active: false});
  });
});

test('lists the members whose ids introspection returns', async () => {
  await withMock(async (endpoint) => {
    const {user_id: userId} = await introspect(endpoint, 'jam_pat_read');
    const {users} = JSON.parse(textOf(await call({endpoint, tool: 'listMembers', args: {}})));

    assert.equal(users.find((user) => user.id === userId)?.role, 'Admin');
  });
});

test('rejects a revoked token at initialize with the challenge Jam sends', async () => {
  await withMock(async (endpoint) => {
    const response = await rpc({endpoint, token: 'jam_pat_revoked', method: 'initialize'});

    assert.equal(response.status, 401);
    assert.match(response.headers.get('www-authenticate') ?? '', /^Bearer resource_metadata=/u);
    assert.equal((await response.json()).error, 'invalid_token');
  });
});

test('rejects a token the control route revokes', async () => {
  await withMock(async (endpoint) => {
    assert.equal((await rpc({endpoint, token: 'jam_pat_live', method: 'initialize'})).status, 200);
    await control(endpoint, {revoke_token: 'jam_pat_live'});

    assert.equal((await rpc({endpoint, token: 'jam_pat_live', method: 'initialize'})).status, 401);
  });
});

test('rejects the requests of an open session once its token is revoked', async () => {
  await withMock(async (endpoint) => {
    const token = 'jam_pat_midsession';
    assert.equal((await rpc({endpoint, token, method: 'initialize'})).status, 200);
    assert.equal((await rpc({endpoint, token, method: 'tools/list'})).status, 200);

    await control(endpoint, {revoke_token: token});

    assert.equal((await rpc({endpoint, token, method: 'tools/list'})).status, 401);
    const response = await rpc({
      endpoint,
      token,
      method: 'tools/call',
      params: {name: 'getMetadata', arguments: {jamId: VIDEO}},
    });
    assert.equal(response.status, 401);
    assert.deepEqual(await (await fetch(new URL(`/__e2e/calls?token=${token}`, endpoint))).json(), []);
  });
});

test('answers a notification with 202, an unknown method with an error, and a bad body with 400', async () => {
  await withMock(async (endpoint) => {
    const token = 'jam_pat_methods';
    const post = (body) =>
      fetch(new URL('/mcp', endpoint), {
        method: 'POST',
        headers: {'content-type': 'application/json', authorization: `Bearer ${token}`},
        body,
      });

    const notification = await post(
      JSON.stringify({jsonrpc: '2.0', method: 'notifications/cancelled', params: {requestId: 1}}),
    );
    assert.equal(notification.status, 202);
    assert.equal(await notification.text(), '');

    const unknown = await rpc({endpoint, token, method: 'resources/list', id: 7});
    assert.equal(unknown.status, 200);
    const answer = await unknown.json();
    assert.equal(answer.id, 7);
    assert.equal(answer.error.code, -32601);

    assert.equal((await post('null')).status, 400);
  });
});

test('reads a Jam by its link or its id', async () => {
  await withMock(async (endpoint) => {
    for (const jamId of [VIDEO, `https://jam.dev/c/${VIDEO}`]) {
      const result = await call({endpoint, tool: 'getDetails', args: {jamId}});

      assert.equal(JSON.parse(textOf(result)).type, 'video');
      assert.match(textOf(result, 1), /^## Investigation Guide/u);
    }
    const screenshot = await call({endpoint, tool: 'getDetails', args: {jamId: SCREENSHOT}});
    assert.equal(JSON.parse(textOf(screenshot)).type, 'screenshot');
  });
});

test('answers a Jam it cannot resolve or find with the errors Jam returns', async () => {
  await withMock(async (endpoint) => {
    const badLink = await call({
      endpoint,
      tool: 'getDetails',
      args: {jamId: 'https://jam.dev/c/not-a-uuid'},
    });
    assert.equal(badLink.isError, true);
    assert.match(textOf(badLink), /^MCP error -32602: Could not resolve Jam ID from:/u);

    const missing = await call({
      endpoint,
      tool: 'getDetails',
      args: {jamId: '00000000-0000-4000-8000-000000000000'},
    });
    assert.equal(missing.isError, true);
    assert.equal(textOf(missing), 'JamNotFound: Could not find jam');
  });
});

test('filters the console, network and event reads', async () => {
  await withMock(async (endpoint) => {
    const errors = JSON.parse(
      textOf(
        await call({
          endpoint,
          tool: 'getConsoleLogs',
          args: {jamId: VIDEO, logLevel: ['error']},
        }),
      ),
    );
    assert.equal(errors.total, 2);
    assert.match(errors.events[1].console_message, /coupon_lookup_failed/u);

    const all = JSON.parse(
      textOf(await call({endpoint, tool: 'getConsoleLogs', args: {jamId: VIDEO}})),
    );
    assert.equal(all.total, 5);

    const failed = JSON.parse(
      textOf(
        await call({
          endpoint,
          tool: 'getNetworkRequests',
          args: {jamId: VIDEO, statusCode: ['5xx']},
        }),
      ),
    );
    assert.equal(failed.total, 1);
    assert.equal(failed.events[0].network_error_message, 'coupon_lookup_failed');

    for (const statusCode of [['500'], [500]]) {
      const exact = JSON.parse(
        textOf(await call({endpoint, tool: 'getNetworkRequests', args: {jamId: VIDEO, statusCode}})),
      );
      assert.equal(exact.total, 1);
    }
    const none = JSON.parse(
      textOf(
        await call({endpoint, tool: 'getNetworkRequests', args: {jamId: VIDEO, statusCode: ['404']}}),
      ),
    );
    assert.equal(none.total, 0);

    const events = JSON.parse(
      textOf(await call({endpoint, tool: 'getUserEvents', args: {jamId: VIDEO}})),
    );
    assert.equal(events.total, 5);
  });
});

test('answers the video reads and the prose that Jam sends for a missing part', async () => {
  await withMock(async (endpoint) => {
    const transcript = JSON.parse(
      textOf(await call({endpoint, tool: 'getVideoTranscript', args: {jamId: VIDEO}})),
    );
    assert.equal(transcript.format, 'webvtt');
    assert.match(transcript.transcript, /Acme checkout page/u);

    const chapters = JSON.parse(
      textOf(await call({endpoint, tool: 'getVideoChapters', args: {jamId: VIDEO}})),
    );
    assert.equal(chapters.status, 'skipped');

    const metadata = await call({endpoint, tool: 'getMetadata', args: {jamId: VIDEO}});
    assert.match(textOf(metadata), /^No custom metadata found/u);
  });
});

test('searches Jams by title and by transcript, newest first', async () => {
  await withMock(async (endpoint) => {
    const byTitle = JSON.parse(
      textOf(await call({endpoint, tool: 'searchJams', args: {v: 1, text: 'checkout'}})),
    );
    assert.deepEqual(
      byTitle.jams.map((jam) => jam.id),
      [SCREENSHOT, VIDEO],
    );

    const byTranscript = JSON.parse(
      textOf(
        await call({
          endpoint,
          tool: 'searchJams',
          args: {v: 1, text: 'coupon', textIn: ['transcript']},
        }),
      ),
    );
    assert.deepEqual(
      byTranscript.jams.map((jam) => jam.id),
      [VIDEO],
    );

    const ids = async (args) =>
      JSON.parse(textOf(await call({endpoint, tool: 'searchJams', args: {v: 1, ...args}}))).jams.map(
        (jam) => jam.id,
      );
    // Without `textIn` every place is searched, and with it only the places it names.
    assert.deepEqual(await ids({text: 'coupon'}), [VIDEO]);
    assert.deepEqual(await ids({text: 'coupon', textIn: ['title', 'transcript']}), [VIDEO]);
    assert.deepEqual(await ids({text: 'coupon', textIn: ['title']}), []);
    assert.deepEqual(await ids({text: 'error', textIn: ['title']}), [SCREENSHOT]);
  });
});

test('returns the screenshot of a screenshot Jam as an image', async () => {
  await withMock(async (endpoint) => {
    const result = await call({endpoint, tool: 'getScreenshots', args: {jamId: SCREENSHOT}});

    assert.equal(result.content.length, 1);
    assert.equal(result.content[0].type, 'image');
    assert.equal(result.content[0].mimeType, 'image/png');
    assert.ok(Buffer.from(result.content[0].data, 'base64').subarray(1, 4).equals(Buffer.from('PNG')));

    const onVideo = await call({endpoint, tool: 'getScreenshots', args: {jamId: VIDEO}});
    assert.match(textOf(onVideo), /^This is a video Jam, so it has no screenshots/u);
  });
});

test('returns frames with a label each, an overview grid, and Jam limits', async () => {
  await withMock(async (endpoint) => {
    const frames = await call({
      endpoint,
      tool: 'getFrames',
      args: {jamId: VIDEO, fromMs: 0, toMs: 9000, count: 3},
    });
    assert.deepEqual(
      frames.content.map((block) => block.type),
      ['text', 'image', 'text', 'image', 'text', 'image'],
    );
    assert.deepEqual(
      frames.content.filter((block) => block.type === 'text').map((block) => block.text),
      ['t=0ms', 't=4500ms', 't=9000ms'],
    );
    assert.equal(frames.content[1].mimeType, 'image/jpeg');

    const at = await call({endpoint, tool: 'getFrames', args: {jamId: VIDEO, at: [1200, 5000]}});
    assert.deepEqual(
      at.content.filter((block) => block.type === 'text').map((block) => block.text),
      ['t=1200ms', 't=5000ms'],
    );

    const overview = await call({
      endpoint,
      tool: 'getFrames',
      args: {jamId: VIDEO, overview: true},
    });
    assert.deepEqual(
      overview.content.map((block) => block.type),
      ['text', 'image'],
    );

    const tooMany = await call({endpoint, tool: 'getFrames', args: {jamId: VIDEO, count: 100}});
    assert.equal(tooMany.isError, true);
    assert.match(textOf(tooMany), /`window.count` must be at most 30/u);

    const onScreenshot = await call({
      endpoint,
      tool: 'getFrames',
      args: {jamId: SCREENSHOT, overview: true},
    });
    assert.match(textOf(onScreenshot), /^NOT_A_VIDEO:/u);
  });
});

test('records calls and counts MCP requests by token', async () => {
  await withMock(async (endpoint) => {
    await rpc({endpoint, token: 'jam_pat_recorded', method: 'initialize'});
    await call({endpoint, token: 'jam_pat_recorded', tool: 'getMetadata', args: {jamId: VIDEO}});
    await call({endpoint, token: 'jam_pat_other', tool: 'getMetadata', args: {jamId: VIDEO}});

    const calls = await (await fetch(new URL('/__e2e/calls?token=jam_pat_recorded', endpoint))).json();
    assert.deepEqual(calls, [
      {
        kind: 'mcp',
        token: 'jam_pat_recorded',
        tool_name: 'getMetadata',
        arguments: {jamId: VIDEO},
      },
    ]);
    const count = await (
      await fetch(new URL('/__e2e/mcp-request-count?token=jam_pat_recorded', endpoint))
    ).json();
    assert.deepEqual(count, {count: 2});
  });
});

test('holds the calls of a stale token until the control route releases them with a 401', async () => {
  await withMock(async (endpoint) => {
    const token = 'jam_pat_stale_held';
    const held = rpc({
      endpoint,
      token,
      method: 'tools/call',
      params: {name: 'getMetadata', arguments: {jamId: VIDEO}},
    });
    const outcome = await Promise.race([
      held.then(() => 'answered'),
      new Promise((resolve) => setTimeout(() => resolve('held'), 200)),
    ]);
    assert.equal(outcome, 'held');

    await control(endpoint, {revoke_token: token});
    await control(endpoint, {release_token: token});

    assert.equal((await held).status, 401);
  });
});
